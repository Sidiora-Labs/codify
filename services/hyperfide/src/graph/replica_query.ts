import type pg from 'pg';
import {FoundationError,object} from '../policy/programme.js';
import type {ComponentContext} from '../components/registry.js';
import {assertPrimaryTransaction,assertTransactionStatement,StorageError} from '../storage/transactions.js';
import type {QuerySession} from '../storage/transactions.js';
import {canonical,exact,fail} from './extraction.js';
import type {JsonObject} from './extraction.js';
import {graphTransaction} from './ingestion.js';
import type {GraphScope} from './ingestion.js';
import {publishedGraph} from './publication.js';
import {readPublishedManifest} from './projection_extract.js';
import type {GraphQueryDescriptor,GraphQueryExecutor} from './query.js';

// Graph reads may be served from a physical replica or a bounded local cache, but only
// after the primary admitted the exact published manifest, scope and artifact custody in
// the same request. Neither route grants ownership or changes publication.
export interface GraphReadOptions {route:'PRIMARY'|'REPLICA';fallback:'NONE'|'PRIMARY';wait_ms:number;cache:'BYPASS'|'USE'}
export function graphReadOptions(value:unknown):GraphReadOptions{
 const v=exact(value,['route'],['fallback','wait_ms','cache']);
 const route=v.route,fallback=v.fallback??'NONE',wait=v.wait_ms??250,cache=v.cache??'BYPASS';
 if((route!=='PRIMARY'&&route!=='REPLICA')||(fallback!=='NONE'&&fallback!=='PRIMARY')||(cache!=='BYPASS'&&cache!=='USE')||!Number.isSafeInteger(wait)||Number(wait)<0||Number(wait)>5000)
  fail('GRAPH_INVALID','Invalid graph read options');
 if(route==='PRIMARY'&&fallback!=='NONE')fail('GRAPH_INVALID','Primary reads have no fallback route');
 return {route,fallback,wait_ms:Number(wait),cache};
}
const LSN=/^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/;
function lsn(value:string):bigint{if(!LSN.test(value))throw new StorageError('REPLICA_TOPOLOGY_MISMATCH','Canonical WAL position is required');const [high,low]=value.split('/');return (BigInt('0x'+high!)<<32n)+BigInt('0x'+low!);}
const REPLICA_CODES=['DATABASE_CONFIG_INVALID','REPLICA_REQUIRED','REPLICA_LAG','REPLICA_TOPOLOGY_MISMATCH','REPLICA_TOPOLOGY_PRIVILEGE_REQUIRED','REPLICA_VERSION_MISMATCH','DB_UNAVAILABLE','DB_OVERLOADED','TX_TIMEOUT','REPLICA_UNAVAILABLE'];
const OFFLINE_CODES=['DB_UNAVAILABLE','DB_OVERLOADED','TX_TIMEOUT'];

// Bounded by entry count and total bytes; least recently used entries are evicted first.
export class GraphQueryCache {
 private entries=new Map<string,{value:JsonObject;bytes:number}>();private bytes=0;hits=0;misses=0;evictions=0;
 constructor(readonly capacity:number,readonly maxBytes=16*1024*1024){}
 get(key:string):JsonObject|undefined{const entry=this.entries.get(key);if(entry===undefined){this.misses++;return undefined;}this.hits++;this.entries.delete(key);this.entries.set(key,entry);return entry.value;}
 set(key:string,value:JsonObject):void{
  const bytes=Buffer.byteLength(JSON.stringify(value))+Buffer.byteLength(key);if(this.capacity===0||bytes>this.maxBytes)return;
  this.remove(key);this.entries.set(key,{value,bytes});this.bytes+=bytes;
  while(this.entries.size>this.capacity||this.bytes>this.maxBytes){this.remove(this.entries.keys().next().value!);this.evictions++;}
 }
 private remove(key:string):void{const entry=this.entries.get(key);if(entry){this.bytes-=entry.bytes;this.entries.delete(key);}}
 describe():JsonObject{return {capacity:this.capacity,max_bytes:this.maxBytes,entries:this.entries.size,bytes:this.bytes,hits:this.hits,misses:this.misses,evictions:this.evictions,authority:'NONE'};}
}
export function cacheCapacity(env:Readonly<NodeJS.ProcessEnv>):number{
 const raw=env.HYPERFIDE_GRAPH_QUERY_CACHE_ENTRIES;if(raw===undefined)return 64;
 if(!/^(0|[1-9][0-9]{0,3})$/.test(raw)||Number(raw)>1024)throw new FoundationError('GRAPH_CONFIG_INVALID','Graph query cache capacity must be 0..1024');
 return Number(raw);
}
interface Barrier {lsn:string;system_id:string}
interface Admission {manifest:JsonObject;barrier:Barrier|null}
function route(manifest:JsonObject,value:JsonObject):JsonObject{return {...manifest,query_route:{exact_version:true,authority:'NONE',...value}};}
function replicaCode(error:unknown):string|null{
 if(error instanceof FoundationError)return REPLICA_CODES.includes(error.code)?error.code:null;
 return 'REPLICA_UNAVAILABLE';
}
async function admit(ctx:ComponentContext,s:GraphScope,manifestId:string,barrier:boolean):Promise<Admission>{
 try{
  return await graphTransaction(ctx,s,async tx=>{
   assertPrimaryTransaction(tx);const manifest=await publishedGraph(tx,s,manifestId);
   if(!barrier)return {manifest,barrier:null};
   const row=(await tx.query<{lsn:string;privileged:boolean}>("SELECT pg_current_wal_lsn()::text AS lsn,has_function_privilege(current_user,'pg_catalog.pg_control_system()','EXECUTE') AS privileged")).rows[0]!;
   if(!row.privileged)return {manifest,barrier:{lsn:row.lsn,system_id:''}};
   const system=(await tx.query<{id:string}>('SELECT system_identifier::text AS id FROM pg_control_system()')).rows[0]!.id;
   return {manifest,barrier:{lsn:row.lsn,system_id:system}};
  },false);
 }catch(error){
  if(error instanceof FoundationError&&!OFFLINE_CODES.includes(error.code))throw error;
  throw new FoundationError('GRAPH_AUTHORITY_OFFLINE','Primary admission is unavailable; replicas and caches are never consulted without current exact-version admission');
 }
}
async function replicaRead<T extends JsonObject>(ctx:ComponentContext,s:GraphScope,manifestId:string,admitted:Admission,options:GraphReadOptions,operation:(session:QuerySession,manifest:JsonObject)=>Promise<T>):Promise<T>{
 const barrier=admitted.barrier!;
 if(!barrier.system_id)throw new StorageError('REPLICA_TOPOLOGY_PRIVILEGE_REQUIRED','Trusted operator must grant pg_control_system observation to the runtime role');
 const signal=ctx.invocation?.signal;
 return ctx.resources.withReplicaConnection({timeoutMs:Math.min(30000,options.wait_ms+15000),...(signal?{signal}:{})},async session=>{
  const privileged=(await session.query<{ok:boolean}>("SELECT has_function_privilege(current_user,'pg_catalog.pg_control_system()','EXECUTE') AS ok")).rows[0]?.ok;
  if(!privileged)throw new StorageError('REPLICA_TOPOLOGY_PRIVILEGE_REQUIRED','Replica runtime role cannot observe cluster identity');
  const started=performance.now(),until=started+options.wait_ms;let replayed:string|null=null,observations=0;
  for(;;){
   observations++;
   const state=(await session.query<{system_id:string;replay_lsn:string|null;recovery:boolean}>('SELECT s.system_identifier::text AS system_id,pg_last_wal_replay_lsn()::text AS replay_lsn,pg_is_in_recovery() AS recovery FROM pg_control_system() s')).rows[0]!;
   if(!state.recovery||state.system_id!==barrier.system_id)throw new StorageError('REPLICA_TOPOLOGY_MISMATCH','Replica is not a standby of the admitting primary cluster');
   if(state.replay_lsn&&lsn(state.replay_lsn)>=lsn(barrier.lsn)){replayed=state.replay_lsn;break;}
   if(performance.now()>=until)throw new StorageError('REPLICA_LAG','Replica has not replayed the primary admission barrier within the requested wait');
   await new Promise(resolve=>setTimeout(resolve,Math.max(1,Math.min(25,until-performance.now()))));
  }
  const waited=Math.floor(performance.now()-started);
  await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  let valid=true;
  const snapshot:QuerySession=Object.freeze({
   query:async<R extends pg.QueryResultRow=pg.QueryResultRow>(sql:string,values?:readonly unknown[]):Promise<pg.QueryResult<R>>=>{if(!valid)throw new StorageError('TX_CLOSED','Replica graph snapshot expired');assertTransactionStatement(sql);return session.query<R>(sql,values);},
   remainingMs:()=>session.remainingMs(),signal:session.signal
  });
  try{
   const manifest=await readPublishedManifest(snapshot,s,manifestId).catch((error:unknown)=>{if(error instanceof FoundationError&&error.code==='GRAPH_VERSION_UNAVAILABLE')throw new StorageError('REPLICA_VERSION_MISMATCH','Replica snapshot lacks the admitted exact manifest');throw error;});
   if(manifest.manifest_digest!==admitted.manifest.manifest_digest||manifest.build_id!==admitted.manifest.build_id)throw new StorageError('REPLICA_VERSION_MISMATCH','Replica manifest identity differs from primary admission');
   const result=await operation(snapshot,route(manifest,{route:'REPLICA',cache:options.cache==='USE'?'MISS':'NONE',snapshot:'REPEATABLE_READ_REPLICA_AFTER_PRIMARY_BARRIER',
    barrier_lsn:barrier.lsn,replay_lsn:replayed,replay_wait_ms:waited,observations,fallback:null}));
   const after=(await snapshot.query<{recovery:boolean}>('SELECT pg_is_in_recovery() AS recovery')).rows[0]!;
   if(!after.recovery)throw new StorageError('REPLICA_TOPOLOGY_MISMATCH','Replica was promoted while reading');
   await session.query('COMMIT');
   return result;
  }finally{valid=false;}
 });
}
export function routedGraphQueryExecutor(primary:GraphQueryExecutor,cache:GraphQueryCache):GraphQueryExecutor{
 return async<T extends JsonObject>(ctx:ComponentContext,s:GraphScope,manifestId:string,query:GraphQueryDescriptor,operation:(session:QuerySession,manifest:JsonObject)=>Promise<T>):Promise<T>=>{
  if(query.read_options===undefined)return primary(ctx,s,manifestId,query,operation);
  const options=graphReadOptions(query.read_options);
  const admitted=await admit(ctx,s,manifestId,options.route==='REPLICA');
  const key=canonical({manifest_id:manifestId,manifest_digest:admitted.manifest.manifest_digest,build_id:admitted.manifest.build_id,kind:query.kind,input:query.input,max_bytes:query.max_bytes});
  if(options.cache==='USE'){
   const hit=cache.get(key);
   if(hit){const original=object(hit.provenance)?hit.provenance:{};return {...hit,provenance:{...original,route:'CACHE',cached_route:original.route??null,cache:'HIT',cache_authority:'NONE',admitted_by:'PRIMARY_EXACT_MANIFEST_THIS_REQUEST'}} as unknown as T;}
  }
  const store=(value:T):T=>{if(options.cache==='USE'&&value.complete===true)cache.set(key,value);return value;};
  const primaryRead=(fallback:JsonObject|null)=>primary(ctx,s,manifestId,query,(session,manifest)=>operation(session,route(manifest,{route:'PRIMARY',cache:options.cache==='USE'?'MISS':'NONE',snapshot:'SERIALIZABLE_PRIMARY',fallback})));
  if(options.route==='PRIMARY')return store(await primaryRead(null));
  try{return store(await replicaRead(ctx,s,manifestId,admitted,options,operation));}
  catch(error){
   const code=replicaCode(error);if(!code)throw error;
   if(options.fallback==='PRIMARY')return store(await primaryRead({requested:'REPLICA',reason:code}));
   if(code==='REPLICA_LAG')throw new FoundationError('GRAPH_REPLICA_LAG','Replica is behind the primary admission barrier; no primary fallback was declared');
   throw new FoundationError('GRAPH_REPLICA_UNAVAILABLE','Replica read refused ('+code+'); no primary fallback was declared');
  }
 };
}
