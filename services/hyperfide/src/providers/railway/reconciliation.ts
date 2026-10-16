import { Sandbox, ExecControlUnsupportedError } from 'railway';
import type { Component, ComponentContext } from '../../components/registry.js';
import {
  validateProviderOperation, validateProviderOutcome, validateInventory, validateCapabilityProfile,
  type ProviderAdapter, type ProviderScope, type ProviderOperation, type ProviderOutcome, type ResourceRef,
  type InventoryPage, type CapabilityProfile, type ProviderState
} from '../contract.js';
import { RailwayClient, RailwayRequestError, configuredClient, digest, hash, integer, object, sameScope, scope, text,
  validatePreparedBase, type PreparedRailwayBase } from './preparation.js';
import { RailwaySessionSpool } from './processes.js';
import { validateRuntimeProfile, runtimeOptions, runtimeGraphQLInput, type RailwayRuntimeProfile, type CredentialResolver } from './profile.js';

const fields='id status networkIsolation environmentId region idleTimeoutMinutes createdAt domains{prefix port domain}';
const sandboxQuery='query RailwayObserve($environmentId:String!,$id:String!){sandbox(environmentId:$environmentId,id:$id){'+fields+'}}';
const inventoryQuery='query RailwayInventory($environmentId:String!,$first:Int,$after:String){sandboxes(environmentId:$environmentId,first:$first,after:$after){edges{node{'+fields+'}}pageInfo{hasNextPage endCursor}}}';
const sessionQuery='query RailwaySessions($environmentId:String!,$id:String!,$after:String){sandboxSessions(environmentId:$environmentId,id:$id,after:$after){edges{node{name kind attached command createdAt foregroundActive runState{running exitCode exitedAt}}}pageInfo{hasNextPage endCursor}}}';
interface ProviderInfo {id:string;status:ProviderState;environmentId:string;region:string;idleTimeoutMinutes:number|null}
function info(value:unknown,client:RailwayClient):ProviderInfo {
  const v=object(value);
  text(v.id);if(!['CREATING','RUNNING','DESTROYING','DESTROYED','FAILED'].includes(String(v.status)))throw new Error('Railway status');
  if(v.environmentId!==client.config.environment_id||v.region!==client.config.region)throw new Error('Railway returned placement mismatch');
  return v as unknown as ProviderInfo;
}
export async function inventoryPage(client:RailwayClient,s:ProviderScope,cursor:string|null,pageSize:number,
  signal?:AbortSignal):Promise<InventoryPage> {
  client.assertScope(s);if(cursor!==null)text(cursor);integer(pageSize,1,1000);
  const data=await client.request<{sandboxes:{edges:Array<{node:unknown}>;pageInfo:{hasNextPage:boolean;endCursor:string|null}}}>(
    inventoryQuery,{environmentId:s.environment_id,first:pageSize,after:cursor},signal);
  const connection=object(data.sandboxes),page=object(connection.pageInfo);
  if(!Array.isArray(connection.edges)||typeof page.hasNextPage!=='boolean')throw new RailwayRequestError('PROTOCOL');
  const next=page.hasNextPage?text(page.endCursor):null;
  const seen=new Set<string>();
  const items=connection.edges.map(edge=>{
    const row=info(object(edge).node,client);
    if(seen.has(row.id))throw new RailwayRequestError('PROTOCOL');seen.add(row.id);
    return {native_sandbox_id:row.id,provider_state:row.status};
  });
  return {scope:s,requested_cursor:cursor,next_cursor:next,has_more:page.hasNextPage,complete:!page.hasNextPage,
    consistency:'BEST_EFFORT',snapshot_id:null,observed_at:new Date().toISOString(),items};
}
export async function completeInventory(client:RailwayClient,s:ProviderScope,signal?:AbortSignal,maxPages=10000):
  Promise<{pages:InventoryPage[];enumeration_complete:boolean;absence_authorized:false}> {
  integer(maxPages,1,10000);
  const pages:InventoryPage[]=[],tokens=new Set<string>();let cursor:string|null=null;
  for(let i=0;i<maxPages;i++){
    const page=await inventoryPage(client,s,cursor,1000,signal);pages.push(page);
    if(!page.has_more){validateInventory({scope:s,pages,evaluated_at:new Date().toISOString()});
      return {pages,enumeration_complete:true,absence_authorized:false};}
    if(page.next_cursor===null||tokens.has(page.next_cursor))throw new RailwayRequestError('PROTOCOL');
    tokens.add(page.next_cursor);cursor=page.next_cursor;
  }
  validateInventory({scope:s,pages,evaluated_at:new Date().toISOString()});
  return {pages,enumeration_complete:false,absence_authorized:false};
}
export async function completeSessions(client:RailwayClient,sandboxId:string,signal?:AbortSignal,maxPages=10000):
  Promise<{sessions:Array<Record<string,unknown>>;enumeration_complete:boolean;available:boolean}> {
  text(sandboxId);integer(maxPages,1,10000);
  const sessions:Array<Record<string,unknown>>=[],tokens=new Set<string>(),names=new Set<string>();
  let cursor:string|null=null;
  for(let i=0;i<maxPages;i++){
    const data=await client.request<{sandboxSessions:null|{edges:Array<{node:Record<string,unknown>}>;pageInfo:{hasNextPage:boolean;endCursor:string|null}}}>(
      sessionQuery,{environmentId:client.config.environment_id,id:sandboxId,after:cursor},signal);
    if(data.sandboxSessions===null)return {sessions,enumeration_complete:false,available:false};
    const page=object(data.sandboxSessions),pageInfo=object(page.pageInfo);
    if(!Array.isArray(page.edges)||typeof pageInfo.hasNextPage!=='boolean')throw new RailwayRequestError('PROTOCOL');
    for(const edge of page.edges){const node=object(object(edge).node);const name=text(node.name);
      if(names.has(name))throw new RailwayRequestError('PROTOCOL');names.add(name);sessions.push(node);}
    if(!pageInfo.hasNextPage)return {sessions,enumeration_complete:true,available:true};
    const next=text(pageInfo.endCursor);if(tokens.has(next))throw new RailwayRequestError('PROTOCOL');
    tokens.add(next);cursor=next;
  }
  return {sessions,enumeration_complete:false,available:true};
}
export interface ProviderPersistenceHooks {
  assignedBootGeneration(operation:ProviderOperation<'create'>):Promise<string>;
  persistEarlyResource(operation:ProviderOperation<'create'>,nativeSandboxId:string):Promise<ResourceRef>;
  recordObservation(operation:ProviderOperation,outcome:ProviderOutcome):Promise<void>;
}
export interface RailwayAdapterDependencies {
  persistence:ProviderPersistenceHooks;
  runtimeProfile(operation:ProviderOperation<'create'>):Promise<RailwayRuntimeProfile>;
  preparedBase(reference:string,scope:ProviderScope):Promise<PreparedRailwayBase>;
  allowFreshPreparation?(operation:ProviderOperation<'create'>,profile:RailwayRuntimeProfile):Promise<boolean>;
  verifyForkSource?(operation:ProviderOperation<'create'>,profile:RailwayRuntimeProfile,base:PreparedRailwayBase):Promise<boolean>;
  credentials:CredentialResolver;
  sessions:RailwaySessionSpool;
  capabilities?(operation:ProviderOperation<'capabilities'>):Promise<CapabilityProfile>;
  prepare?(operation:ProviderOperation<'prepare'>,signal:AbortSignal):Promise<{preparation_reference:string;preparation_digest:string}>;
  transfer?(operation:ProviderOperation<'transfer'>,client:RailwayClient,signal:AbortSignal):Promise<{
    artifact_digest:string;byte_count:string;complete:true}>;
}
function envelope(operation:ProviderOperation,resource:ResourceRef|null):Record<string,unknown> {
  return {schema_version:1,operation_id:operation.identity.operation_id,payload_digest:operation.identity.payload_digest,
    scope:operation.scope,observed_at:new Date().toISOString(),provider_request_id:null,resource};
}
function success(operation:ProviderOperation,resource:ResourceRef|null,result:unknown):ProviderOutcome {
  return {...envelope(operation,resource),status:'SUCCEEDED',acceptance:'CONFIRMED_ACCEPTED',result,error:null,
    reconcile_required:false,retry:'NEVER'} as ProviderOutcome;
}
function unknown(operation:ProviderOperation,resource:ResourceRef|null):ProviderOutcome {
  return {...envelope(operation,resource),status:'UNKNOWN',acceptance:'UNKNOWN',result:null,
    error:{code:'UNAVAILABLE',provider_code:null,message:'Railway outcome requires reconciliation',retry_after_ms:null},
    reconcile_required:true,retry:'AFTER_RECONCILIATION'} as ProviderOutcome;
}
function unsupported(operation:ProviderOperation):ProviderOutcome {
  return {...envelope(operation,operation.resource),status:'UNSUPPORTED',acceptance:'CONFIRMED_REJECTED',result:null,
    error:{code:'UNSUPPORTED',provider_code:null,message:'Railway capability not configured or qualified',retry_after_ms:null},
    reconcile_required:false,retry:'NEVER'} as ProviderOutcome;
}
function refused(operation:ProviderOperation):ProviderOutcome {
  return {...envelope(operation,operation.resource),status:'FAILED',acceptance:'CONFIRMED_REJECTED',result:null,
    error:{code:'INVALID_REQUEST',provider_code:null,message:'Railway deadline expired before dispatch',retry_after_ms:null},
    reconcile_required:false,retry:'NEVER'} as ProviderOutcome;
}
export type RailwayAdapter=ProviderAdapter&{
  readCapturedOutput(scope:ProviderScope,resource:ResourceRef,processRef:string,maxBytes:number):Promise<{
    stdout:Uint8Array;stderr:Uint8Array;exit_code:number;complete:true;spool_digest:string;
  }>;
};
export function createRailwayAdapter(client:RailwayClient,dependencies:RailwayAdapterDependencies):RailwayAdapter {
  const execute=async(operation:ProviderOperation,signal=AbortSignal.timeout(client.config.request_timeout_ms)):Promise<ProviderOutcome>=>{
    validateProviderOperation(operation);client.assertScope(operation.scope);
    const remaining=Date.parse(operation.deadline_at)-Date.now();
    signal=AbortSignal.any([signal,AbortSignal.timeout(Math.max(1,Math.min(remaining,2147483647)))]);
    let resource=operation.resource;
    let outcome:ProviderOutcome;
    if(signal.aborted||Date.now()>=Date.parse(operation.deadline_at))outcome=refused(operation);
    else try{
      switch(operation.kind){
        case 'capabilities':{
          if(!dependencies.capabilities){outcome=unsupported(operation);break;}
          const profile=await dependencies.capabilities(operation);validateCapabilityProfile(profile);
          if(!sameScope(profile.scope,operation.scope))throw new Error('Railway capability scope');
          outcome=success(operation,null,{profile});break;
        }
        case 'prepare':{
          if(!dependencies.prepare){outcome=unsupported(operation);break;}
          const result=await dependencies.prepare(operation,signal);
          if(result.preparation_digest!==operation.preparation_digest)throw new Error('Railway prepared content mismatch');
          outcome=success(operation,null,result);break;
        }
        case 'create':{
          const profile=validateRuntimeProfile(await dependencies.runtimeProfile(operation));
          if(!sameScope(profile.scope,operation.scope)||profile.preparation_digest!==operation.preparation_digest||
            hash(profile.resources)!==hash(operation.parameters.resources)||profile.network!==operation.parameters.network)
            throw new Error('Railway operation/profile mismatch');
          if(profile.source.kind==='FRESH'){
            if(!dependencies.allowFreshPreparation||!await dependencies.allowFreshPreparation(operation,profile)){
              outcome=unsupported(operation);break;
            }
          }else{
            const base=validatePreparedBase(await dependencies.preparedBase(operation.parameters.preparation_reference,operation.scope),
              operation.scope,digest(operation.preparation_digest));
            if(profile.source.kind==='CHECKPOINT'){
              if(profile.source.reference!==base.checkpoint.key)throw new Error('Railway approved checkpoint mismatch');
            }else if(!dependencies.verifyForkSource||!await dependencies.verifyForkSource(operation,profile,base)){
              outcome=unsupported(operation);break;
            }
          }
          const generation=await dependencies.persistence.assignedBootGeneration(operation);
          if(!/^[1-9][0-9]{0,18}$/.test(generation)||BigInt(generation)>9223372036854775807n)
            throw new Error('Railway assigned boot generation');
          const options=await runtimeOptions(profile,client,dependencies.credentials,signal);
          // This marker is correlation only; authenticated enrollment proves adoption authority.
          options.env={...options.env,HF_PROVISION_OPERATION_ID:operation.identity.operation_id};
          const data=await client.request<{sandboxCreate:unknown}>(
            'mutation RailwayCreate($input:SandboxCreateInput!){sandboxCreate(input:$input){'+fields+'}}',
            {input:runtimeGraphQLInput(profile,options)},signal);
          // Capture the returned ID before validating placement/status: even a malformed observation can orphan a real resource.
          const raw=object(data.sandboxCreate),nativeId=text(raw.id);
          resource={native_sandbox_id:nativeId,sandbox_boot_generation:generation};
          const persisted=await dependencies.persistence.persistEarlyResource(operation,nativeId);
          if(persisted.native_sandbox_id!==nativeId||persisted.sandbox_boot_generation!==generation)throw new Error('Railway persisted resource mismatch');
          const row=info(raw,client);
          if(row.status!=='CREATING'&&row.status!=='RUNNING'){outcome=unknown(operation,resource);break;}
          outcome=success(operation,resource,{provider_state:row.status});break;
        }
        case 'list':outcome=success(operation,null,{page:await inventoryPage(client,operation.scope,
          operation.parameters.cursor,operation.parameters.page_size,signal)});break;
        case 'observe':{
          const data=await client.request<{sandbox:unknown}>(sandboxQuery,
            {environmentId:operation.scope.environment_id,id:resource!.native_sandbox_id},signal);
          if(data.sandbox===null){outcome=success(operation,resource,{provider_state:'DESTROYED',health:'ABSENT'});break;}
          const row=info(data.sandbox,client);
          if(row.id!==resource!.native_sandbox_id)throw new Error('Railway observed ID mismatch');
          outcome=success(operation,resource,{provider_state:row.status,health:row.status==='RUNNING'?'HEALTHY':
            row.status==='DESTROYED'?'ABSENT':row.status==='FAILED'?'SUSPECT':'UNKNOWN'});break;
        }
        case 'execute':{
          const result=await dependencies.sessions.start(client,operation,dependencies.credentials,signal);
          outcome=success(operation,resource,result.result);break;
        }
        case 'inspect':outcome=success(operation,resource,dependencies.sessions.inspect(resource!,operation.parameters.process_ref));break;
        case 'attach':{
          // Native supervisor owns agent IPC. Reattachment recovers diagnostics, never resumes caller stdin.
          const inventory=await completeSessions(client,resource!.native_sandbox_id,signal);
          const row=inventory.sessions.find(item=>item.name===operation.parameters.process_ref);
          if(!inventory.available||!inventory.enumeration_complete||!row){outcome=unknown(operation,resource);break;}
          const state=object(row.runState);
          if(typeof state.running!=='boolean')throw new Error('Railway process state');
          if(state.running){
            outcome=success(operation,resource,{process_ref:operation.parameters.process_ref,phase:'STARTED',exit_code:null,
              timed_out:false,termination_confirmed:false,output:{complete:false,truncated:false,byte_count:'0',sha256:null}});
          }else{
            const exit=integer(state.exitCode,-2147483648,2147483647);
            outcome=success(operation,resource,{process_ref:operation.parameters.process_ref,phase:'EXITED',exit_code:exit,
              timed_out:false,termination_confirmed:true,output:{complete:false,truncated:false,byte_count:'0',sha256:null}});
          }break;
        }
        case 'stop':{
          const result=await dependencies.sessions.stop(client,resource!,operation.parameters.process_ref,operation.parameters.signal);
          if(!result.termination_confirmed||result.exit_code===null)throw new Error('Railway termination unknown');
          outcome=success(operation,resource,{process_ref:operation.parameters.process_ref,termination:'CONFIRMED',exit_code:result.exit_code});break;
        }
        case 'transfer':{
          if(!dependencies.transfer){outcome=unsupported(operation);break;}
          outcome=success(operation,resource,await dependencies.transfer(operation,client,signal));break;
        }
        case 'lifetime':{
          const data=await client.request<{sandbox:unknown}>(sandboxQuery,
            {environmentId:operation.scope.environment_id,id:resource!.native_sandbox_id},signal);
          const row=info(data.sandbox,client);
          if(row.id!==resource!.native_sandbox_id)throw new Error('Railway lifetime resource mismatch');
          const matches=operation.parameters.policy==='NO_IDLE_EXPIRY'?row.idleTimeoutMinutes===0:
            row.idleTimeoutMinutes!==null&&row.idleTimeoutMinutes*60000===operation.parameters.timeout_ms;
          // Heartbeat never changes the configured idle policy.
          outcome=matches?success(operation,resource,operation.parameters):unsupported(operation);break;
        }
        case 'destroy':{
          const response=await client.request<{sandboxDestroy:boolean}>(
            'mutation RailwayDestroy($environmentId:String!,$id:String!){sandboxDestroy(environmentId:$environmentId,id:$id)}',
            {environmentId:operation.scope.environment_id,id:resource!.native_sandbox_id},signal);
          if(response.sandboxDestroy!==true)throw new Error('Railway deletion unconfirmed');
          const observed=await client.request<{sandbox:unknown}>(sandboxQuery,
            {environmentId:operation.scope.environment_id,id:resource!.native_sandbox_id},signal);
          const terminal=observed.sandbox===null?null:info(observed.sandbox,client);
          if(terminal!==null&&terminal.id!==resource!.native_sandbox_id)throw new Error('Railway deletion resource mismatch');
          if(terminal===null||terminal.status==='DESTROYED')
            outcome=success(operation,resource,{deletion:'CONFIRMED'});
          else outcome=unknown(operation,resource);
          break;
        }
      }
    }catch(error){outcome=error instanceof ExecControlUnsupportedError?unsupported(operation):unknown(operation,resource);}
    // Normalize against the same public contract before durable observation publication.
    validateProviderOutcome({operation,outcome});
    try{await dependencies.persistence.recordObservation(operation,outcome);}catch{
      outcome=unknown(operation,resource);validateProviderOutcome({operation,outcome});
    }
    return outcome;
  };
  return {provider:'railway',capabilities:execute,prepare:execute,create:execute,list:execute,observe:execute,
    attach:execute,execute,inspect:execute,stop:execute,transfer:execute,lifetime:execute,destroy:execute,
    readCapturedOutput:async(s:ProviderScope,resource:ResourceRef,processRef:string,maxBytes:number)=>{
      client.assertScope(s);return dependencies.sessions.readCapturedOutput(resource,processRef,maxBytes);
    }} as RailwayAdapter;
}
export type RailwayRegistrar=(provider:'railway',factory:(scope:ProviderScope,hooks:ProviderPersistenceHooks)=>ProviderAdapter)=>()=>void;
export function registerRailwayProvider(registrar:RailwayRegistrar,client:RailwayClient,
  dependencies:(scope:ProviderScope,hooks:ProviderPersistenceHooks)=>RailwayAdapterDependencies):()=>void {
  return registrar('railway',(s,hooks)=>{client.assertScope(s);return createRailwayAdapter(client,dependencies(s,hooks));});
}
export function reconcileCreate(input:unknown):{decision:'ADOPT_CANDIDATE'|'QUARANTINE'|'NO_MATCH';
  candidate_id:string|null;retry_create:false;authority:'NONE'} {
  const v=object(input,['operation_id','baseline_ids','inventory_complete','candidates']);
  const operation=text(v.operation_id);
  if(!Array.isArray(v.baseline_ids)||!Array.isArray(v.candidates)||typeof v.inventory_complete!=='boolean')
    throw new Error('Railway reconciliation input');
  const baseline=new Set(v.baseline_ids.map(item=>text(item)));
  if(baseline.size!==v.baseline_ids.length||v.candidates.length>10000)throw new Error('Railway reconciliation bounds');
  const seen=new Set<string>(),verified:string[]=[];let ambiguous=false;
  for(const raw of v.candidates){
    const candidate=object(raw,['native_sandbox_id','marker_operation_id','authenticated_enrollment']);
    const id=text(candidate.native_sandbox_id);if(seen.has(id))throw new Error('Railway duplicate reconciliation candidate');seen.add(id);
    if(candidate.marker_operation_id!==null)text(candidate.marker_operation_id);
    if(typeof candidate.authenticated_enrollment!=='boolean')throw new Error('Railway enrollment observation');
    if(baseline.has(id))continue;
    if(candidate.marker_operation_id===operation&&candidate.authenticated_enrollment)verified.push(id);
    else ambiguous=true;
  }
  if(!v.inventory_complete||verified.length>1||ambiguous)
    return {decision:'QUARANTINE',candidate_id:null,retry_create:false,authority:'NONE'};
  if(verified.length===1)return {decision:'ADOPT_CANDIDATE',candidate_id:verified[0]!,retry_create:false,authority:'NONE'};
  return {decision:'NO_MATCH',candidate_id:null,retry_create:false,authority:'NONE'};
}
export function createComponent(_context:ComponentContext):Component {
  return {apiVersion:1,actions:{
    'railway.reconciliation.create':input=>reconcileCreate(input),
    'railway.inventory.list':async(input,context)=>{
      const v=object(input,['scope','max_pages']);const client=configuredClient(context);
      if(client.config.mode!=='component-fixture')throw new Error('Railway live inventory requires trusted pool binding');
      return {...await completeInventory(client,scope(v.scope),context.signal,integer(v.max_pages,1,10000)),
        ...client.provenance(),authority:'NONE'};
    },
    'railway.sessions.list':async(input,context)=>{
      const v=object(input,['sandbox_id','max_pages']);const client=configuredClient(context);
      if(client.config.mode!=='component-fixture')throw new Error('Railway live sessions require trusted sandbox binding');
      return {...await completeSessions(client,text(v.sandbox_id),context.signal,integer(v.max_pages,1,10000)),
        ...client.provenance(),authority:'NONE'};
    }
  }};
}
