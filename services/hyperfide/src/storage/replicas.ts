import type pg from 'pg';
import {createHmac,timingSafeEqual} from 'node:crypto';
import {FoundationError,object} from '../policy/programme.js';
import type {Component,ComponentContext} from '../components/registry.js';
import {requireAuthority} from '../hierarchy/packages.js';
import {assertInvocation,exact,frozen,DIGEST,UUID} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertTransactionStatement,bounded,deadlineFrom,StorageError} from './transactions.js';
import type {QuerySession} from './transactions.js';
import type {ServiceResources} from './runtime.js';
import {readSemanticDisposition} from './dispositions.js';

interface Scope {organisation_id:string;run_id:string;authority_epoch:string}
interface PacketInput {organisation_id:string;run_id:string;digest:string}
export interface ExecutionPacketReader {readExecutionPacket(snapshot:QuerySession,input:PacketInput):Promise<unknown>}
interface Topology {system_id:string;timeline:string;authority_epoch:string}
export interface CausalBarrier extends Topology,PacketInput {schema_version:1;deployment_id:string;lsn:string;issued_at:string;expires_at:string;signature:string}
export interface PacketReadOptions {digest:string;barrier?:CausalBarrier;timeoutMs?:number;waitMs?:number;preferReplica?:boolean;expected_graph_manifest_digest?:string|null}
const LSN=/^[0-9A-F]{1,8}\/[0-9A-F]{1,8}$/;
const FIELDS=['schema_version','deployment_id','system_id','timeline','authority_epoch','organisation_id','run_id','digest','lsn','issued_at','expires_at','signature'] as const;
function lsn(value:string):bigint{
 if(!LSN.test(value))throw new FoundationError('BARRIER_INVALID','Canonical WAL position is required');
 const [high,low]=value.split('/');return (BigInt('0x'+high!)<<32n)+BigInt('0x'+low!);
}
function remaining(deadline:number):number{
 const value=Math.floor(deadline-performance.now());
 if(value<=0)throw new StorageError('TX_TIMEOUT','Packet read deadline expired');
 return value;
}
// Trusted operator setup, never runtime DDL:
// GRANT EXECUTE ON FUNCTION pg_catalog.pg_control_system(),
// pg_catalog.pg_control_checkpoint() TO the scoped runtime database role.
async function topologyPrivileges(session:QuerySession,replica=false):Promise<void>{
 const row=(await session.query<{system:boolean;checkpoint:boolean}>("SELECT has_function_privilege(current_user,'pg_catalog.pg_control_system()','EXECUTE') AS system,has_function_privilege(current_user,'pg_catalog.pg_control_checkpoint()','EXECUTE') AS checkpoint")).rows[0];
 if(!row?.system||(replica&&!row.checkpoint))throw new FoundationError(replica?'REPLICA_TOPOLOGY_PRIVILEGE_REQUIRED':'TOPOLOGY_PRIVILEGE_REQUIRED','Trusted operator must grant the runtime role EXECUTE on the required pg_catalog control-system/checkpoint observation functions');
}
function scopeOf(invocation:InvocationContext):Scope{
 assertInvocation(invocation);const p=invocation.principal;
 return {organisation_id:p.organisation_id,run_id:p.run_id,authority_epoch:p.deployment_epoch};
}
function body(value:Omit<CausalBarrier,'signature'>|CausalBarrier):string{
 return JSON.stringify(FIELDS.filter(key=>key!=='signature').map(key=>[key,value[key]]));
}
function keyFrom(env:Readonly<NodeJS.ProcessEnv>):Buffer{
 const key=env.HYPERFIDE_CAUSAL_BARRIER_KEY;
 if(!key||!/^[a-f0-9]{64}$/.test(key))throw new FoundationError('BARRIER_CONFIG_INVALID','A trusted 256-bit causal barrier signing key is required');
 return Buffer.from(key,'hex');
}
function proof(key:Buffer,value:Omit<CausalBarrier,'signature'>|CausalBarrier):string{
 return createHmac('sha256',key).update('HYPERFIDE-CAUSAL-BARRIER-V1\n').update(body(value)).digest('hex');
}
// Packet snapshots only observe immutable accepted inputs; no snapshot is a primary authority capability.
export class PacketSnapshots {
 private readonly key:Buffer;private readonly deployment:string;
 constructor(private readonly resources:ServiceResources,private readonly reader:ExecutionPacketReader,env:Readonly<NodeJS.ProcessEnv>){
  this.key=keyFrom(env);this.deployment=env.HYPERFIDE_DEPLOYMENT_ID??'';
  if(!UUID.test(this.deployment))throw new FoundationError('BARRIER_CONFIG_INVALID','Trusted deployment identity is required');
 }
 private async topology(session:QuerySession,scope:Scope):Promise<Topology>{
  await topologyPrivileges(session);
  const row=(await session.query<{system_id:string;timeline:string;epoch:string;run_epoch:string;recovery:boolean}>(
   "SELECT s.system_identifier::text AS system_id,substring(pg_walfile_name(pg_current_wal_lsn()),1,8) AS timeline,e.epoch::text AS epoch,r.authority_epoch::text AS run_epoch,pg_is_in_recovery() AS recovery "+
   "FROM pg_control_system() s CROSS JOIN hyperfide.authority_epochs e JOIN hyperfide.runs r ON r.organisation_id=$1 AND r.id=$2 WHERE e.deployment_id=$3 AND e.state='ACTIVE'",
   [scope.organisation_id,scope.run_id,this.deployment])).rows[0];
  if(!row||row.recovery||row.epoch!==scope.authority_epoch||row.run_epoch!==scope.authority_epoch)
   throw new FoundationError('STALE_AUTHORITY','Current deployment and run authority are required for packet admission');
  return {system_id:row.system_id,timeline:row.timeline,authority_epoch:row.epoch};
 }
 private async admit(invocation:InvocationContext,deadline:number,digest:string):Promise<Topology>{
  const scope=scopeOf(invocation);
  return this.resources.gateway.withPrimaryTransaction({timeoutMs:remaining(deadline),signal:invocation.signal,guard:async tx=>{await readSemanticDisposition(tx,scope);await invocation.guard(tx);}},async tx=>{
   const packet=(await tx.query<{package_id:string;attempt_id:string;attempt_generation:string;package_generation:string;leader_generation:string}>(
    "SELECT p.package_id,p.attempt_id,p.attempt_generation::text,h.owner_generation::text AS package_generation,l.generation::text AS leader_generation FROM hyperfide.hierarchy_execution_packets p JOIN hyperfide.hierarchy_packages h ON h.organisation_id=p.organisation_id AND h.run_id=p.run_id AND h.package_id=p.package_id JOIN hyperfide.hierarchy_leaders l ON l.organisation_id=p.organisation_id AND l.run_id=p.run_id WHERE p.organisation_id=$1 AND p.run_id=$2 AND p.digest=$3",
    [scope.organisation_id,scope.run_id,digest])).rows[0];
   if(!packet)throw new FoundationError('PACKET_UNAVAILABLE','Exact packet is not available in the authenticated run');
   const principal=invocation.principal;
   if(principal.role!=='OPERATOR'){
    const roles=['LEADER','FEATURE_MANAGER','WORKER','VERIFIER','INTEGRATOR','INDEXER','COMMIT_WATCHER','ISSUE_WATCHER'] as const;
    if(!roles.some(role=>role===principal.role))throw new FoundationError('ROLE_DENIED','Role cannot read scoped engineering packets');
    await requireAuthority(tx,{...scope,session_id:principal.actor_id,leader_generation:packet.leader_generation,package_id:packet.package_id,package_generation:packet.package_generation,roles});
    if(principal.role==='WORKER'&&(principal.attempt_id!==packet.attempt_id||principal.attempt_generation!==packet.attempt_generation))
     throw new FoundationError('PACKET_SCOPE_MISMATCH','Worker can only read its current assigned attempt packet');
   }
   return this.topology(tx,scope);
  });
 }
 private validate(value:unknown,scope:Scope,digest:string,current:Topology):CausalBarrier{
  exact(value,FIELDS);
  if(value.schema_version!==1||value.deployment_id!==this.deployment||value.organisation_id!==scope.organisation_id||value.run_id!==scope.run_id||
    value.digest!==digest||value.authority_epoch!==scope.authority_epoch||typeof value.system_id!=='string'||!/^[0-9]{1,20}$/.test(value.system_id)||
    typeof value.timeline!=='string'||!/^[0-9A-F]{8}$/.test(value.timeline)||typeof value.lsn!=='string'||
    typeof value.issued_at!=='string'||typeof value.expires_at!=='string'||typeof value.signature!=='string'||!/^[a-f0-9]{64}$/.test(value.signature))
   throw new FoundationError('BARRIER_INVALID','Barrier identity or signature shape is invalid');
  lsn(value.lsn);
  const barrier=value as unknown as CausalBarrier;
  if(!timingSafeEqual(Buffer.from(value.signature,'hex'),Buffer.from(proof(this.key,barrier),'hex')))
   throw new FoundationError('BARRIER_INVALID','Barrier signature is invalid');
  const issued=Date.parse(value.issued_at),expiry=Date.parse(value.expires_at),now=Date.now();
  if(!Number.isFinite(issued)||!Number.isFinite(expiry)||expiry<=now||issued>now+1000||expiry<=issued||expiry-issued>300000)
   throw new FoundationError('BARRIER_EXPIRED','Barrier is expired or outside its bounded lifetime');
  if(value.system_id!==current.system_id||value.timeline!==current.timeline||value.authority_epoch!==current.authority_epoch)
   throw new FoundationError('BARRIER_OBSOLETE','Cluster, timeline or authority changed; request a fresh barrier');
  return barrier;
 }
 async mint(digest:string,invocation:InvocationContext,options:{timeoutMs?:number}={}):Promise<CausalBarrier>{
  if(!DIGEST.test(digest))throw new FoundationError('INVALID_REQUEST','Exact packet digest is required');
  const deadline=deadlineFrom(options.timeoutMs),scope=scopeOf(invocation);
  await this.admit(invocation,deadline,digest); // Admission commits before sampling its causal WAL barrier.
  return (await this.resources.observe({preferReplica:false,timeoutMs:remaining(deadline),signal:invocation.signal},async session=>{
   const topology=await this.topology(session,scope);
   await this.reader.readExecutionPacket(session,{organisation_id:scope.organisation_id,run_id:scope.run_id,digest});
   const position=(await session.query<{lsn:string}>('SELECT pg_current_wal_lsn()::text AS lsn')).rows[0]!.lsn;lsn(position);
   const now=Date.now(),unsigned={schema_version:1 as const,deployment_id:this.deployment,...topology,organisation_id:scope.organisation_id,run_id:scope.run_id,digest,lsn:position,issued_at:new Date(now).toISOString(),expires_at:new Date(now+300000).toISOString()};
   return frozen({...unsigned,signature:proof(this.key,unsigned)});
  })).value;
 }
 private validatePins(record:unknown,options:PacketReadOptions):void{
  if(options.expected_graph_manifest_digest===undefined)return;
  const expected=options.expected_graph_manifest_digest;
  if(expected!==null&&(typeof expected!=='string'||!DIGEST.test(expected)))throw new FoundationError('INVALID_REQUEST','Exact expected graph manifest digest is required');
  let graph:unknown;
  if(object(record)&&object(record.packet)&&object(record.packet.mandatory)&&object(record.packet.mandatory.inputs))graph=record.packet.mandatory.inputs.graph;
  const actual=object(graph)&&graph.required===true?graph.manifest_digest:null;
  if(expected!==actual)throw new FoundationError('PACKET_PIN_MISMATCH','Requested graph version differs from immutable packet; no other generation is substituted');
 }
 async read(options:PacketReadOptions,invocation:InvocationContext):Promise<unknown>{
  const deadline=deadlineFrom(options.timeoutMs),scope=scopeOf(invocation);
  if(!DIGEST.test(options.digest))throw new FoundationError('INVALID_REQUEST','Exact immutable packet digest is required');
  const wait=options.waitMs??250;
  if(!Number.isSafeInteger(wait)||wait<0||wait>5000)throw new FoundationError('INVALID_REQUEST','Replica wait must be from 0 to 5000 milliseconds');
  const current=await this.admit(invocation,deadline,options.digest);
  const barrier=options.barrier===undefined?undefined:this.validate(options.barrier,scope,options.digest,current);
  const packetInput={organisation_id:scope.organisation_id,run_id:scope.run_id,digest:options.digest};
  let fallback='primary-requested';
  if(options.preferReplica!==false&&barrier){
   try{
    return await this.resources.withReplicaConnection({timeoutMs:remaining(deadline),signal:invocation.signal},async session=>{
     await topologyPrivileges(session,true);
     const waitStarted=performance.now(),waitUntil=Math.min(deadline,waitStarted+wait);
     let observations=0,replayed:string|null=null;
     while(true){
      observations++;
      const state=(await session.query<{system_id:string;timeline:string;replay_lsn:string|null;recovery:boolean}>(
       "SELECT s.system_identifier::text AS system_id,lpad(upper(to_hex(c.timeline_id)),8,'0') AS timeline,pg_last_wal_replay_lsn()::text AS replay_lsn,pg_is_in_recovery() AS recovery FROM pg_control_system() s CROSS JOIN pg_control_checkpoint() c")).rows[0]!;
      if(!state.recovery||state.system_id!==barrier.system_id||state.timeline!==barrier.timeline)
       throw new StorageError('REPLICA_TOPOLOGY_MISMATCH','Replica cluster/timeline does not match admitted barrier');
      if(state.replay_lsn&&lsn(state.replay_lsn)>=lsn(barrier.lsn)){replayed=state.replay_lsn;break;}
      if(performance.now()>=waitUntil)throw new StorageError('REPLICA_LAG','Replica causal replay wait expired');
      await bounded(new Promise(resolve=>setTimeout(resolve,Math.min(25,Math.max(1,waitUntil-performance.now())))),deadline,invocation.signal);
     }
     const replayWaitMs=Math.floor(performance.now()-waitStarted);
     // The replay wait happens outside this transaction. Its first MVCC read is after the barrier.
     await session.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
     let valid=true;
     const snapshot:QuerySession=Object.freeze({
      query:async<R extends pg.QueryResultRow=pg.QueryResultRow>(text:string,values?:readonly unknown[]):Promise<pg.QueryResult<R>>=>{if(!valid)throw new StorageError('TX_CLOSED','Packet snapshot expired');assertTransactionStatement(text);return session.query<R>(text,values);},
      remainingMs:()=>session.remainingMs(),signal:session.signal
     });
     try{
      const epoch=(await snapshot.query<{epoch:string;run_epoch:string}>("SELECT e.epoch::text AS epoch,r.authority_epoch::text AS run_epoch FROM hyperfide.authority_epochs e JOIN hyperfide.runs r ON r.organisation_id=$1 AND r.id=$2 WHERE e.deployment_id=$3 AND e.state='ACTIVE'",[scope.organisation_id,scope.run_id,this.deployment])).rows[0];
      if(epoch?.epoch!==scope.authority_epoch||epoch.run_epoch!==scope.authority_epoch)throw new StorageError('REPLICA_LAG','Snapshot lacks current authority identity');
      const packet=await this.reader.readExecutionPacket(snapshot,packetInput);this.validatePins(packet,options);
      const observed=(await snapshot.query<{snapshot:string;recovery:boolean}>('SELECT pg_current_snapshot()::text AS snapshot,pg_is_in_recovery() AS recovery')).rows[0]!;
      if(!observed.recovery)throw new StorageError('REPLICA_TOPOLOGY_MISMATCH','Replica was promoted while reading');
      await session.query('COMMIT');
      return frozen({packet,authority:'NONE',execution_authority:false,route:'replica',freshness:'causal-snapshot',topology:current,barrier,snapshot:observed.snapshot,replica_evidence:{system_id:barrier.system_id,timeline:barrier.timeline,replay_lsn:replayed,observations,wait_ms:replayWaitMs,checked_before_snapshot:true},fallback:null});
     }finally{valid=false;}
    });
   }catch(error){
    const code=error instanceof FoundationError?error.code:'REPLICA_UNAVAILABLE';
    if(!['DATABASE_CONFIG_INVALID','REPLICA_REQUIRED','REPLICA_LAG','REPLICA_TOPOLOGY_MISMATCH','REPLICA_TOPOLOGY_PRIVILEGE_REQUIRED','DB_UNAVAILABLE','TX_TIMEOUT','REPLICA_UNAVAILABLE'].includes(code))throw error;
    fallback=code;
   }
  }else if(options.preferReplica!==false)fallback='barrier-required-for-replica';
  if(deadline<=performance.now())throw new StorageError('TX_TIMEOUT','Packet deadline expired before primary fallback');
  return (await this.resources.observe({preferReplica:false,timeoutMs:remaining(deadline),signal:invocation.signal},async snapshot=>{
   const topology=await this.topology(snapshot,scope);
   if(topology.system_id!==current.system_id||topology.timeline!==current.timeline||topology.authority_epoch!==current.authority_epoch)
    throw new FoundationError('BARRIER_OBSOLETE','Topology changed before primary snapshot assembly');
   const packet=await this.reader.readExecutionPacket(snapshot,packetInput);this.validatePins(packet,options);
   const row=(await snapshot.query<{snapshot:string}>('SELECT pg_current_snapshot()::text AS snapshot')).rows[0]!;
   return frozen({packet,authority:'NONE',execution_authority:false,route:'primary',freshness:barrier?'causal-primary-snapshot':'primary-snapshot',topology,barrier:barrier??null,snapshot:row.snapshot,fallback});
  })).value;
 }
}
export function createComponent(context:ComponentContext):Component{
 const reader=context.dependencies.require<ExecutionPacketReader>('3.2','hierarchy.packets.v1',(value):value is ExecutionPacketReader=>object(value)&&typeof value.readExecutionPacket==='function');
 const snapshots=new PacketSnapshots(context.resources,reader,context.env);
 const invocation=(ctx:ComponentContext):InvocationContext=>{const i=(ctx as ComponentContext&{invocation?:InvocationContext}).invocation;assertInvocation(i);return i;};
 return {apiVersion:1,actions:{
  'storage.packet.barrier':async(input,ctx)=>{exact(input,['digest']);if(typeof input.digest!=='string')throw new FoundationError('INVALID_REQUEST','Digest is required');return snapshots.mint(input.digest,invocation(ctx));},
  'storage.packet.read':async(input,ctx)=>{if(!object(input)||Object.keys(input).some(key=>!['digest','barrier','timeoutMs','waitMs','preferReplica','expected_graph_manifest_digest'].includes(key))||typeof input.digest!=='string'||(input.preferReplica!==undefined&&typeof input.preferReplica!=='boolean'))throw new FoundationError('INVALID_REQUEST','Versioned packet read options are required');return snapshots.read(input as unknown as PacketReadOptions,invocation(ctx));}
 },capabilities:Object.freeze({'storage.packets.v1':Object.freeze({mint:snapshots.mint.bind(snapshots),read:snapshots.read.bind(snapshots)})})};
}
