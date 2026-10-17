import fs from 'node:fs/promises';
import path from 'node:path';
import {execFile} from 'node:child_process';
import net from 'node:net';
import {createHash} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {object} from '../policy/programme.js';
import {isNativeAuthAuthority} from '../identity/native_auth.js';
import {exactAgentObject,agentString,agentError,agentDigest,agentTransaction} from './sessions.js';

export interface MainStartupBudget {schema_version:1;host_id:string;pool_id:string;allowance:{cpu_millis:string;memory_bytes:string;agent_slots:string};headroom:{cpu_millis:string;memory_bytes:string}}
export interface MainHostObservation {cpu_available_millis:string;memory_available_bytes:string;observed_at:string;source:'LINUX_PROCFS_CGROUP'}
export function validateSupervisorStartupBudget(declared:unknown,observation:unknown):{schema_version:1;sizing:'WITHIN_OBSERVED_HEADROOM';budget_digest:string;host_id:string;pool_id:string;observed_at:string;capacity_admitted:false;execution_started:false}{
 const b=exactAgentObject(declared,['schema_version','host_id','pool_id','allowance','headroom']),o=exactAgentObject(observation,['cpu_available_millis','memory_available_bytes','observed_at','source']);
 if(b.schema_version!==1||o.source!=='LINUX_PROCFS_CGROUP')agentError('SUPERVISOR_MAIN_BUDGET_INVALID');
 agentString(b.host_id,'uuid');agentString(b.pool_id,'uuid');
 const allowance=exactAgentObject(b.allowance,['cpu_millis','memory_bytes','agent_slots']),headroom=exactAgentObject(b.headroom,['cpu_millis','memory_bytes']);
 const decimal=(v:unknown,positive:boolean)=>{if(typeof v!=='string'||!(positive?/^[1-9][0-9]*$/:/^(0|[1-9][0-9]*)$/).test(v)||v.length>19||BigInt(v)>9223372036854775807n)agentError('SUPERVISOR_MAIN_BUDGET_INVALID');return BigInt(v);};
 const cpu=decimal(allowance.cpu_millis,true),memory=decimal(allowance.memory_bytes,true);decimal(allowance.agent_slots,true);
 const freeCpu=decimal(o.cpu_available_millis,false),freeMemory=decimal(o.memory_available_bytes,false);
 if(typeof o.observed_at!=='string'||!Number.isFinite(Date.parse(o.observed_at))||new Date(o.observed_at).toISOString()!==o.observed_at||Math.abs(Date.now()-Date.parse(o.observed_at))>60000)agentError('SUPERVISOR_MAIN_OBSERVATION_STALE');
 if(cpu+decimal(headroom.cpu_millis,false)>freeCpu||memory+decimal(headroom.memory_bytes,false)>freeMemory)agentError('SUPERVISOR_MAIN_HEADROOM_UNSATISFIED');
 return {schema_version:1,sizing:'WITHIN_OBSERVED_HEADROOM',budget_digest:agentDigest(b),host_id:String(b.host_id),pool_id:String(b.pool_id),observed_at:o.observed_at,capacity_admitted:false,execution_started:false};
}
type MapValue=Record<string,unknown>;
type Dimension={dimension:'CPU_MILLIS'|'MEMORY_BYTES'|'AGENT';capacity_account_id:string;quantity:string};
type Profile={profile_id:string;host_id:string;pool_id:string;restriction_profile_digest:string;cwd:string;home:string;temp:string;uid:number;gid:number;mcp_config_path:string;mcp_config_digest:string;bridge_binary_digest:string;mcp_policy_digest:string;expires_after_seconds:number;dimensions:Dimension[]};
interface PlacementAuthority {authorizeSupervisor(tx:PrimaryTransaction,i:InvocationContext,v:MapValue):Promise<MapValue>}
interface CredentialAuthority {inspectInTransaction(tx:PrimaryTransaction,i:InvocationContext,reference:string):Promise<{reference_id:string;status:string}>}
const credentialAuthority=(v:unknown):v is CredentialAuthority=>object(v)&&typeof v.inspectInTransaction==='function';
async function credentialCurrent(ctx:ComponentContext,tx:PrimaryTransaction,i:InvocationContext,native:{credential_reference:string}):Promise<void>{const value=await ctx.dependencies.require('14.2','identity.credentials',credentialAuthority).inspectInTransaction(tx,i,native.credential_reference);if(value.reference_id!==native.credential_reference||value.status!=='AVAILABLE')agentError('SUPERVISOR_CREDENTIAL_UNAVAILABLE');}
interface AllocationAuthority {allocateReservations(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;reservation_ids:string[]}):Promise<void>}
const allocationAuthority=(v:unknown):v is AllocationAuthority=>object(v)&&typeof v.allocateReservations==='function';
interface CapacityAuthority {reserveCapacity(tx:PrimaryTransaction,v:{organisation_id:string;run_id:string;request_id:string;dimensions:{capacity_account_id:string;quantity:string}[];expires_at:string}):Promise<unknown[]>}
const placementAuthority=(v:unknown):v is PlacementAuthority=>object(v)&&typeof v.authorizeSupervisor==='function';
const capacityAuthority=(v:unknown):v is CapacityAuthority=>object(v)&&typeof v.reserveCapacity==='function';
const allowedTools=new Set(['spec_status','spec_frontier','spec_resolve','graph_status','graph_search','graph_context','graph_traverse','fleet_status','fleet_entities','fleet_resources','hierarchy_inspect','hierarchy_view','hierarchy_acquire','hierarchy_configure','hierarchy_assign','human_submit','human_escalate','human_autonomous','human_status']);
function hash(b:Buffer):string{return 'sha256:'+createHash('sha256').update(b).digest('hex');}
async function pinned(filename:string,digest:string):Promise<Buffer>{
 if(!path.isAbsolute(filename))agentError('SUPERVISOR_CONFIG_INVALID');
 const s=await fs.lstat(filename);
 if(!s.isFile()||s.isSymbolicLink()||s.size<1||s.size>1048576||(s.mode&0o022)!==0)agentError('SUPERVISOR_CONFIG_INVALID');
 const b=await fs.readFile(filename);if(hash(b)!==digest)agentError('SUPERVISOR_CONFIG_DRIFT');return b;
}
async function profiles(ctx:ComponentContext):Promise<Profile[]>{
 const file=ctx.env.HF_SUPERVISOR_LAUNCH_PROFILES_FILE;if(!file)return [];
 if(!path.isAbsolute(file))agentError('SUPERVISOR_CONFIG_INVALID');
 const st=await fs.lstat(file);if(!st.isFile()||st.isSymbolicLink()||st.size>131072||(st.mode&0o077)!==0)agentError('SUPERVISOR_CONFIG_INVALID');
 const root=exactAgentObject(JSON.parse(await fs.readFile(file,'utf8')),['schema_version','profiles']);
 if(root.schema_version!==1||!Array.isArray(root.profiles)||root.profiles.length>64)agentError('SUPERVISOR_CONFIG_INVALID');
 const seen=new Set<string>(),homes=new Set<string>();
 return root.profiles.map(value=>{
 const p=exactAgentObject(value,['profile_id','host_id','pool_id','restriction_profile_digest','cwd','home','temp','uid','gid','mcp_config_path','mcp_config_digest','bridge_binary_digest','mcp_policy_digest','expires_after_seconds','dimensions']);
 agentString(p.profile_id);agentString(p.host_id);agentString(p.pool_id,'uuid');agentString(p.restriction_profile_digest,'digest');agentString(p.mcp_config_digest,'digest');agentString(p.bridge_binary_digest,'digest');agentString(p.mcp_policy_digest,'digest');
 for(const key of ['cwd','home','temp','mcp_config_path'])if(typeof p[key]!=='string'||!path.isAbsolute(p[key] as string))agentError('SUPERVISOR_CONFIG_INVALID');
 if(new Set([p.cwd,p.home,p.temp]).size!==3||seen.has(String(p.profile_id))||homes.has(String(p.home))||!Number.isSafeInteger(p.uid)||Number(p.uid)<1000||!Number.isSafeInteger(p.gid)||Number(p.gid)<1000||!Number.isSafeInteger(p.expires_after_seconds)||Number(p.expires_after_seconds)<30||Number(p.expires_after_seconds)>86400||!Array.isArray(p.dimensions)||p.dimensions.length!==3)agentError('SUPERVISOR_CONFIG_INVALID');
 const dimensions:Dimension[]=p.dimensions.map(item=>{const d=exactAgentObject(item,['dimension','capacity_account_id','quantity']);agentString(d.capacity_account_id,'uuid');const quantity=agentString(d.quantity,'decimal');if(BigInt(quantity)>9223372036854775807n||!['CPU_MILLIS','MEMORY_BYTES','AGENT'].includes(String(d.dimension))||d.dimension==='AGENT'&&quantity!=='1')agentError('SUPERVISOR_CONFIG_INVALID');return d as unknown as Dimension;});
 if(new Set(dimensions.map(d=>d.dimension)).size!==3||new Set(dimensions.map(d=>d.capacity_account_id)).size!==3)agentError('SUPERVISOR_CONFIG_INVALID');
 seen.add(String(p.profile_id));homes.add(String(p.home));return {...p,dimensions}as unknown as Profile;
 });
}
async function runtimeFiles(p:Profile,target?:{session_id:string;run_id:string}):Promise<MapValue>{
 for(const dir of [p.cwd,p.home,p.temp]){
  const st=await fs.lstat(dir);if(!st.isDirectory()||st.isSymbolicLink()||await fs.realpath(dir)!==path.resolve(dir))agentError('SUPERVISOR_CONFIG_INVALID');
  if(dir!==p.cwd&&(st.uid!==p.uid||(st.mode&0o077)!==0))agentError('SUPERVISOR_ISOLATION_REQUIRED');
 }
 const root=exactAgentObject(JSON.parse((await pinned(p.mcp_config_path,p.mcp_config_digest)).toString('utf8')),['mcpServers']);
 const servers=exactAgentObject(root.mcpServers,['hyperfide']);
 const server=exactAgentObject(servers.hyperfide,['command','args','env']);
 if(typeof server.command!=='string'||!path.isAbsolute(server.command)||!Array.isArray(server.args)||JSON.stringify(server.args)!=='["mcp"]')agentError('SUPERVISOR_BRIDGE_INVALID');
 const env=exactAgentObject(server.env,['HYPERFIDE_MODE','HYPERFIDE_AUTHORITY_DESCRIPTOR','HYPERFIDE_TRANSPORT_CONFIG','HYPERFIDE_MCP_TOOL_POLICY_FILE']);
 if(env.HYPERFIDE_MODE!=='distributed')agentError('SUPERVISOR_BRIDGE_INVALID');
 for(const key of ['HYPERFIDE_AUTHORITY_DESCRIPTOR','HYPERFIDE_TRANSPORT_CONFIG','HYPERFIDE_MCP_TOOL_POLICY_FILE'])if(typeof env[key]!=='string'||!path.isAbsolute(env[key] as string))agentError('SUPERVISOR_BRIDGE_INVALID');
 const cg=await fs.lstat(server.command);if(!cg.isFile()||cg.isSymbolicLink()||(cg.mode&0o022)!==0||cg.uid===p.uid||cg.size>134217728||hash(await fs.readFile(server.command))!==p.bridge_binary_digest)agentError('SUPERVISOR_BRIDGE_INVALID');
 const policy=exactAgentObject(JSON.parse((await pinned(env.HYPERFIDE_MCP_TOOL_POLICY_FILE as string,p.mcp_policy_digest)).toString('utf8')),['schema_version','allowed_tools','bootstrap_catalog','target_session_id','run_id','target_role']);
 if(target&&(policy.target_session_id!==target.session_id||policy.run_id!==target.run_id)||!['LEADER','FEATURE_MANAGER'].includes(String(policy.target_role)))agentError('SUPERVISOR_BRIDGE_IDENTITY_MISMATCH');
 agentString(policy.target_session_id,'uuid');agentString(policy.run_id,'uuid');
 if(policy.schema_version!==1||policy.bootstrap_catalog!==true||!Array.isArray(policy.allowed_tools)||!policy.allowed_tools.length||policy.allowed_tools.some(t=>typeof t!=='string'||!allowedTools.has(t))||new Set(policy.allowed_tools).size!==policy.allowed_tools.length)agentError('SUPERVISOR_BRIDGE_INVALID');
 // Policy enforcement belongs to the actual25 bridge. No generic authority tool is admitted here.
 return policy;
}
async function nativeAdapter(ctx:ComponentContext,p:Profile,native:MapValue,action:string,payload:MapValue):Promise<MapValue>{
 const binary=ctx.env.HF_SUPERVISOR_NATIVE_RUNNER,expected=ctx.env.HF_SUPERVISOR_NATIVE_RUNNER_DIGEST,root=ctx.env.HF_SUPERVISOR_PRIVATE_SPOOL;
 if(!binary||!path.isAbsolute(binary)||!expected||!root||!path.isAbsolute(root))agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');
 const st=await fs.lstat(binary),spool=await fs.lstat(root);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o022)!==0||st.size>134217728||hash(await fs.readFile(binary))!==expected||!spool.isDirectory()||spool.isSymbolicLink()||(spool.mode&0o077)!==0||await fs.realpath(root)!==path.resolve(root))agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');
 const directory=await fs.mkdtemp(path.join(root,'plan-')),snapshot=path.join(directory,'snapshot.json');
 try{
  await fs.writeFile(snapshot,JSON.stringify(native),{mode:0o600,flag:'wx'});
  const output=await new Promise<string>((resolve,reject)=>{
   const child=execFile(binary,['--component','13.1','--action',action],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HF_NATIVE_AUTH_SNAPSHOT_FILE:snapshot,HF_SUPERVISOR_MCP_CONFIG_FILE:p.mcp_config_path}},(error,stdout)=>error?reject(new Error('Pinned native supervisor adapter failed')):resolve(stdout));
   child.stdin?.end(JSON.stringify(payload));
  });
  const result=JSON.parse(output);if(result.ok!==true||!object(result.result))agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');return result.result;
 }finally{await fs.rm(directory,{recursive:true,force:true});}
}

async function nativePlan(ctx:ComponentContext,p:Profile,native:MapValue):Promise<string[]>{
 const result=await nativeAdapter(ctx,p,native,'connector.launch',{connector:native.connector,expected_version:(native.binary as MapValue).version,alias:native.configured_model_alias,auth_profile:native.profile_id,workspace:p.cwd,home:p.home,temp:p.temp,permission_mode:'supervision'});
 if(result.permission_mode!=='supervision'||result.dispatch_eligible!==false||!Array.isArray(result.argv)||result.argv.some((v:unknown)=>typeof v!=='string')||result.argv[0]!==((native.binary as MapValue).path)||result.profile_digest!==native.profile_digest)agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');
 return result.argv as string[];
}

type ProcessIdentity={pid:number;start_time:string;kernel_boot_id:string;pgid:number};
function hostIdentity(v:unknown):ProcessIdentity{
 const p=exactAgentObject(v,['pid','start_time','kernel_boot_id','pgid']);
 if(!Number.isSafeInteger(p.pid)||Number(p.pid)<1||!Number.isSafeInteger(p.pgid)||p.pgid!==p.pid)agentError('SUPERVISOR_HOST_INVALID');
 agentString(p.start_time,'decimal');agentString(p.kernel_boot_id,'uuid');return p as unknown as ProcessIdentity;
}
async function hostRequest(ctx:ComponentContext,request:MapValue):Promise<MapValue>{
 const socket=ctx.env.HYPERFIDE_SUPERVISORY_HOST_SOCKET;
 if(!socket||!path.isAbsolute(socket))agentError('SUPERVISOR_HOST_UNAVAILABLE');
 const st=await fs.lstat(socket);
 if(!st.isSocket()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o077)!==0)agentError('SUPERVISOR_HOST_UNAVAILABLE');
 const wire=Buffer.from(JSON.stringify(request)+'\n');
 if(wire.length>131072)agentError('SUPERVISOR_HOST_INVALID');
 return new Promise<MapValue>((resolve,reject)=>{
  const client=net.createConnection({path:socket});let pending=Buffer.alloc(0),finished=false;
  const finish=(error:Error|null,result?:MapValue)=>{if(finished)return;finished=true;client.destroy();if(error)reject(error);else resolve(result!);};
  client.setTimeout(15000,()=>finish(new Error('SUPERVISOR_HOST_UNCERTAIN')));
  client.once('connect',()=>client.write(wire));
  client.on('data',(data:Buffer)=>{
   pending=Buffer.concat([pending,data]);if(pending.length>1048576)return finish(new Error('SUPERVISOR_HOST_INVALID'));
   const newline=pending.indexOf(10);if(newline<0)return;
   if(newline!==pending.length-1)return finish(new Error('SUPERVISOR_HOST_INVALID'));
   try{const response=JSON.parse(pending.subarray(0,newline).toString('utf8'));
    if(!object(response)||response.ok!==true||!object(response.result))return finish(new Error('SUPERVISOR_HOST_REFUSED'));
    finish(null,response.result);
   }catch{finish(new Error('SUPERVISOR_HOST_INVALID'));}
  });
  client.once('error',()=>finish(new Error('SUPERVISOR_HOST_UNCERTAIN')));
  client.once('end',()=>{if(!finished)finish(new Error('SUPERVISOR_HOST_UNCERTAIN'));});
 });
}
async function sealPlan(ctx:ComponentContext,body:MapValue):Promise<{plan_path:string;plan_digest:string}>{
 const root=ctx.env.HF_SUPERVISOR_PLAN_ROOT;
 if(!root||!path.isAbsolute(root))agentError('SUPERVISOR_PLAN_ROOT_INVALID');
 const st=await fs.lstat(root);
 if(!st.isDirectory()||st.isSymbolicLink()||(st.mode&0o077)!==0||st.uid!==0||await fs.realpath(root)!==path.resolve(root))agentError('SUPERVISOR_PLAN_ROOT_INVALID');
 const id=agentString(body.launch_id,'uuid'),filename=path.join(root,id+'.json');
 const bytes=Buffer.from(JSON.stringify(body)+'\n'),digest=createHash('sha256').update(bytes).digest('hex');
 const f=await fs.open(filename,'wx',0o600);
 try{await f.writeFile(bytes);await f.sync();}finally{await f.close();}
 const directory=await fs.open(root,'r');try{await directory.sync();}finally{await directory.close();}
 return {plan_path:filename,plan_digest:digest};
}

export function createComponent(ctx:ComponentContext):Component{
 const inventory=profiles(ctx);void inventory.catch(()=>{});
 const action=(fn:(v:MapValue,i:InvocationContext)=>Promise<unknown>)=>async(v:unknown,c:ComponentContext)=>{assertInvocation(c.invocation);if(!object(v))agentError('AGENT_INPUT_INVALID');if(!['OPERATOR','COORDINATOR','LEADER'].includes(c.invocation.principal.role))agentError('SUPERVISOR_SCOPE_DENIED');return fn(v,c.invocation);};
 return {apiVersion:1,actions:{
 'supervisor.session.describe':action(async(v,_i)=>{exactAgentObject(v,[]);return {schema_version:1,configured_profiles:(await inventory).map(p=>p.profile_id),supported_connector:'claude',codex_restriction_support:'UNQUALIFIED',execution_started:false,grants_authority:false};}),
 'supervisor.session.launch':action(async(input,i)=>{
  const v=exactAgentObject(input,['session_id','leader_generation','package_id','package_generation','launch_id','profile_id']);
  for(const key of ['session_id','launch_id'])agentString(v[key],'uuid');agentString(v.leader_generation,'decimal');agentString(v.profile_id);
  if(v.package_id!==null)agentString(v.package_id,'uuid');if(v.package_generation!==null)agentString(v.package_generation,'decimal');
  const p=(await inventory).find(p=>p.profile_id===v.profile_id);if(!p)agentError('SUPERVISOR_MAIN_BUDGET_UNCONFIGURED');
  const toolPolicy=await runtimeFiles(p,{session_id:String(v.session_id),run_id:i.principal.run_id});
  const native=ctx.dependencies.require('14.3','identity.native-auth',isNativeAuthAuthority).resolve(p.profile_id);
  if(native.connector!=='claude'||native.binary.version!=='2.1.300')agentError('SUPERVISOR_RESTRICTION_UNSUPPORTED');
  if(native.qualification.state!=='QUALIFIED'||!native.qualification.live_qualified||!native.qualification.receipt_digest||!native.observed_model_id||!native.observed_provider_id||!native.capabilities.unattended)agentError('SUPERVISOR_NATIVE_UNQUALIFIED');
  const profileFile=ctx.env.HF_NATIVE_AUTH_PROFILES_FILE;if(!profileFile)agentError('SUPERVISOR_ISOLATION_REQUIRED');
  const configured=exactAgentObject(JSON.parse(await fs.readFile(profileFile,'utf8')),['schema_version','profiles']);
  const runtime=Array.isArray(configured.profiles)?configured.profiles.find(p=>object(p)&&p.profile_id===v.profile_id):undefined;
  if(!object(runtime)||agentDigest(runtime)!==native.profile_digest||runtime.runtime_home!==p.home||runtime.target_uid!==p.uid)agentError('SUPERVISOR_ISOLATION_REQUIRED');
  const requested=agentDigest(v),org=i.principal.organisation_id,run=i.principal.run_id,id=String(v.launch_id);
  const placement=ctx.dependencies.require('1.1','policy.placement.v1',placementAuthority),capacity=ctx.dependencies.require('5.1','scheduler.claims.v1',capacityAuthority);
  const committed=await agentTransaction(ctx,i,async tx=>{
   const actual=tx as PrimaryTransaction;
   await credentialCurrent(ctx,actual,i,native);
   const existing=await tx.query('SELECT * FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[org,run,id]);
   if(existing.rows[0]){if(existing.rows[0].request_digest!==requested)agentError('AGENT_OPERATION_CONFLICT');return {row:existing.rows[0],replayed:true};}
   const auth=await placement.authorizeSupervisor(actual,i,{session_id:v.session_id,leader_generation:v.leader_generation,package_id:v.package_id,package_generation:v.package_generation});
   if(auth.host_id!==p.host_id||auth.location!=='LOCAL_SUPERVISION'||auth.supervisor_session_id!==v.session_id||auth.supervisor_role!==toolPolicy.target_role||auth.restriction_profile_digest!==p.restriction_profile_digest||auth.restriction_evidence_digest!==native.qualification.receipt_digest)agentError('SUPERVISOR_RESTRICTION_UNQUALIFIED');
   const target=await tx.query('SELECT native_session_id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[org,run,v.session_id]);
   if(!target.rows[0]||target.rows[0].native_session_id!==null)agentError('SUPERVISOR_NATIVE_ALREADY_BOUND');
   const pool=await tx.query("SELECT provider,environment_key,state FROM hyperfide.provider_pools WHERE organisation_id=$1 AND id=$2 FOR SHARE",[org,p.pool_id]);
   if(pool.rows[0]?.provider!=='main'||pool.rows[0]?.environment_key!==p.host_id||pool.rows[0]?.state!=='ACTIVE')agentError('SUPERVISOR_MAIN_POOL_INVALID');
   for(const d of [...p.dimensions].sort((a,b)=>a.capacity_account_id.localeCompare(b.capacity_account_id))){
    const account=await tx.query('SELECT pool_id,dimension,capacity_class,qualification_state FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND id=$2 FOR UPDATE',[org,d.capacity_account_id]);
    const a=account.rows[0];if(!a||a.pool_id!==p.pool_id||a.dimension!==d.dimension||a.capacity_class!=='EXECUTION'||a.qualification_state!=='QUALIFIED')agentError('SUPERVISOR_MAIN_POOL_INVALID');
   }
   const expires=(await tx.query("SELECT clock_timestamp()+($1::text||' seconds')::interval AS expires",[p.expires_after_seconds])).rows[0]!.expires;
   const reservations=await capacity.reserveCapacity(actual,{organisation_id:org,run_id:run,request_id:id,dimensions:p.dimensions.map(d=>({capacity_account_id:d.capacity_account_id,quantity:d.quantity})),expires_at:new Date(expires).toISOString()});
   const row=(await tx.query("INSERT INTO hyperfide.supervisor_launches(organisation_id,run_id,id,session_id,profile_id,profile_digest,request_digest,host_id,placement,reservations,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'STARTING') RETURNING *",[org,run,id,v.session_id,p.profile_id,native.profile_digest,requested,p.host_id,{...auth,launcher_input:{session_id:v.session_id,leader_generation:v.leader_generation,package_id:v.package_id,package_generation:v.package_generation}},JSON.stringify(reservations)])).rows[0]!;
   return {row,replayed:false};
  });
  if(committed.replayed)return {launch:committed.row,replayed:true,execution_replayed:false,grants_authority:false};
  // Persist intent before the irreversible exec. A controller crash leaves visible UNKNOWN debt.
  await agentTransaction(ctx,i,async tx=>{const changed=await tx.query("UPDATE hyperfide.supervisor_launches SET state='SPAWNING' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='STARTING' RETURNING id",[org,run,id]);if(changed.rows.length!==1)agentError('SUPERVISOR_LAUNCH_UNCERTAIN');});
  await runtimeFiles(p);
  const binary=await fs.readFile(native.binary.path);if(hash(binary)!==native.binary.digest)agentError('SUPERVISOR_BINARY_DRIFT');
  const argv=await nativePlan(ctx,p,native as unknown as MapValue);
  const reservationIds=(await agentTransaction(ctx,i,tx=>tx.query('SELECT id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 ORDER BY id',[org,run,id]))).rows.map(r=>String(r.id));
  const plan={schema_version:1,purpose:'MAIN_SUPERVISOR',launch_id:id,session_id:v.session_id,run_id:run,organisation_id:org,leader_generation:v.leader_generation,package_id:v.package_id,package_generation:v.package_generation,profile_digest:native.profile_digest,restriction_profile_digest:p.restriction_profile_digest,binary_digest:native.binary.digest,capacity_reservation_ids:reservationIds,argv,cwd:p.cwd,uid:p.uid,gid:p.gid,home:p.home,temp:p.temp,env:{PATH:'/usr/bin:/bin',HOME:p.home,XDG_CONFIG_HOME:path.join(p.home,'.config'),TMPDIR:p.temp,LANG:'C.UTF-8'},expires_at:new Date(new Date(committed.row.created_at).getTime()+30000).toISOString(),max_runtime_seconds:p.expires_after_seconds};
  const sealed=await sealPlan(ctx,plan);
  const observed=await agentTransaction(ctx,i,async tx=>{
   await credentialCurrent(ctx,tx as PrimaryTransaction,i,native);
   const current=await placement.authorizeSupervisor(tx as PrimaryTransaction,i,{session_id:v.session_id,leader_generation:v.leader_generation,package_id:v.package_id,package_generation:v.package_generation});
   if(current.host_id!==p.host_id||current.supervisor_role!==toolPolicy.target_role||current.restriction_profile_digest!==p.restriction_profile_digest||current.restriction_evidence_digest!==native.qualification.receipt_digest)agentError('SUPERVISOR_RESTRICTION_UNQUALIFIED');
   return hostRequest(ctx,{action:'start',...sealed});
  });
  if(observed.launch_id!==id)agentError('SUPERVISOR_HOST_INVALID');
  const identity=observed.process_identity===null?null:hostIdentity(observed.process_identity);
  await agentTransaction(ctx,i,async tx=>{
   await tx.query("UPDATE hyperfide.supervisor_launches SET state=$4,process_identity=$5,observed_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,id,identity?'RUNNING':'SPAWNING',identity]);
   if(identity){const allocation=ctx.dependencies.require('5.1','scheduler.allocations.v1',allocationAuthority);await allocation.allocateReservations(tx as PrimaryTransaction,{organisation_id:org,run_id:run,reservation_ids:reservationIds});}
  });
  if(identity){const first=Buffer.from(JSON.stringify({type:'user',message:{role:'user',content:'Initialise the supervision session. Use only the permitted graph, spec and control tools.'}})+'\n');await hostRequest(ctx,{action:'input',launch_id:id,process_identity:identity,operation_id:id,frame_digest:hash(first),frame_b64:first.toString('base64')});}
  return {launch_id:id,session_id:v.session_id,process_identity:identity,native_session_id:null,native_identity_pending:true,host_state:observed.state,execution_started:identity!==null,capacity_retained:true,execution_replayed:false,context_restored:false,grants_authority:false};
 }),
 'supervisor.session.inspect':action(async(input,i)=>{
  const v=exactAgentObject(input,['launch_id']);agentString(v.launch_id,'uuid');
  const row=await agentTransaction(ctx,i,async tx=>{
   const found=await tx.query('SELECT * FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[i.principal.organisation_id,i.principal.run_id,v.launch_id]);
   if(!found.rows[0])agentError('SUPERVISOR_LAUNCH_NOT_FOUND');return found.rows[0]!;
  });
  const observed=await hostRequest(ctx,{action:'inspect',launch_id:v.launch_id,after_sequence:String(row.output_sequence),limit:64});
  if(observed.launch_id!==v.launch_id||!Array.isArray(observed.frames)||observed.frames.length>64||typeof observed.output_truncated!=='boolean')agentError('SUPERVISOR_HOST_INVALID');
  const identity=observed.process_identity===null?null:hostIdentity(observed.process_identity);
  if(row.process_identity&&agentDigest(row.process_identity)!==agentDigest(identity))agentError('SUPERVISOR_HOST_IDENTITY_MISMATCH');
  let sequence=BigInt(String(row.output_sequence)),pending=Buffer.from(String(row.pending_stdout),'base64'),nativeId=row.native_session_id as string|null;
  if(observed.output_truncated)agentError('SUPERVISOR_OUTPUT_INCOMPLETE');
  for(const item of observed.frames){
   const f=exactAgentObject(item,['sequence','stream','frame_digest','frame_b64']);const next=BigInt(agentString(f.sequence,'decimal'));
   if(next!==sequence+1n||!['stdout','stderr'].includes(String(f.stream))||typeof f.frame_b64!=='string'||f.frame_b64.length>5464)agentError('SUPERVISOR_HOST_INVALID');
   const bytes=Buffer.from(f.frame_b64,'base64');if(bytes.toString('base64')!==f.frame_b64||bytes.length>4096||hash(bytes)!==f.frame_digest)agentError('SUPERVISOR_HOST_INVALID');
   sequence=next;
   if(f.stream==='stdout'){
    pending=Buffer.concat([pending,bytes]);if(pending.length>65536)agentError('SUPERVISOR_OUTPUT_INCOMPLETE');
    while(pending.includes(10)){
     const split=pending.indexOf(10),line=new TextDecoder('utf-8',{fatal:true}).decode(pending.subarray(0,split));pending=pending.subarray(split+1);let e:unknown;
     try{e=JSON.parse(line);}catch{continue;}
     if(object(e)&&e.type==='system'&&e.subtype==='init'){
      const id=agentString(e.session_id,'uuid');if(nativeId&&nativeId!==id)agentError('SUPERVISOR_NATIVE_ID_MISMATCH');nativeId=id;
     }
    }
   }
  }
  await agentTransaction(ctx,i,async tx=>{
   const current=(await tx.query('SELECT output_sequence,pending_stdout FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[i.principal.organisation_id,i.principal.run_id,v.launch_id])).rows[0];
   if(!current||String(current.output_sequence)!==String(row.output_sequence)||current.pending_stdout!==row.pending_stdout)agentError('SUPERVISOR_OBSERVATION_STALE');
   if(nativeId){
    if(!identity)agentError('SUPERVISOR_HOST_IDENTITY_MISMATCH');
    const actual=(await tx.query('SELECT native_session_id,state FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[i.principal.organisation_id,i.principal.run_id,row.session_id])).rows[0];
    if(!actual||actual.native_session_id!==null&&actual.native_session_id!==nativeId)agentError('SUPERVISOR_NATIVE_ID_MISMATCH');
    if(actual.native_session_id===null){const bound=await tx.query("UPDATE hyperfide.agent_sessions SET native_session_id=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='REGISTERED' AND native_session_id IS NULL RETURNING id",[i.principal.organisation_id,i.principal.run_id,row.session_id,nativeId]);if(bound.rows.length!==1)agentError('SUPERVISOR_NATIVE_BINDING_STALE');}
   }
   const ended=['EXITED','STOPPED','FAILED'].includes(String(observed.state));
   await tx.query("UPDATE hyperfide.supervisor_launches SET output_sequence=$4,pending_stdout=$5,native_session_id=COALESCE(native_session_id,$6),process_identity=COALESCE(process_identity,$7),state=CASE WHEN $8 THEN 'EXITED' ELSE state END,exit_code=$9,observed_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[i.principal.organisation_id,i.principal.run_id,v.launch_id,sequence.toString(),pending.toString('base64'),nativeId,identity,ended,observed.exit_code??null]);
  });
  return {launch_id:v.launch_id,session_id:row.session_id,native_session_id:nativeId,process_identity:identity,host_state:observed.state,last_observed_sequence:sequence.toString(),capacity_retained:true,release_requires_registered_quiescence:true,context_restored:false,grants_authority:false};
 }),
 'supervisor.session.input':action(async(input,i)=>{
  const v=exactAgentObject(input,['launch_id','operation_id','text']);agentString(v.launch_id,'uuid');agentString(v.operation_id,'uuid');
  if(typeof v.text!=='string'||!v.text.length||Buffer.byteLength(v.text)>32768||v.text.includes('\0'))agentError('AGENT_INPUT_INVALID');
  return agentTransaction(ctx,i,async tx=>{
   const row=(await tx.query('SELECT * FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR UPDATE',[i.principal.organisation_id,i.principal.run_id,v.launch_id])).rows[0];
   if(!row||row.state!=='RUNNING'||!row.native_session_id||!row.process_identity)agentError('SUPERVISOR_NATIVE_ID_PENDING');
   const p=(await inventory).find(p=>p.profile_id===row.profile_id);if(!p)agentError('SUPERVISOR_MAIN_BUDGET_UNCONFIGURED');
   const native=ctx.dependencies.require('14.3','identity.native-auth',isNativeAuthAuthority).resolve(p.profile_id);
   if(native.profile_digest!==row.profile_digest||native.connector!=='claude'||native.qualification.state!=='QUALIFIED'||!native.qualification.live_qualified||!native.qualification.receipt_digest)agentError('SUPERVISOR_NATIVE_UNQUALIFIED');
   await credentialCurrent(ctx,tx as PrimaryTransaction,i,native);
   const old=exactAgentObject((row.placement as MapValue).launcher_input,['session_id','leader_generation','package_id','package_generation']);
   const placement=ctx.dependencies.require('1.1','policy.placement.v1',placementAuthority);
   const auth=await placement.authorizeSupervisor(tx as PrimaryTransaction,i,{session_id:row.session_id,leader_generation:old.leader_generation,package_id:old.package_id??null,package_generation:old.package_generation??null});
   if(auth.supervisor_session_id!==row.session_id||auth.host_id!==row.host_id||auth.restriction_profile_digest!==p.restriction_profile_digest||auth.restriction_evidence_digest!==native.qualification.receipt_digest)agentError('SUPERVISOR_RESTRICTION_UNQUALIFIED');
   await runtimeFiles(p,{session_id:String(row.session_id),run_id:i.principal.run_id});
   const result=await nativeAdapter(ctx,p,native as unknown as MapValue,'connector.encode',{connector:'claude',operation:'input',native_session_id:row.native_session_id,request_id:v.operation_id,text:v.text});
   if(!object(result.frame)||result.replay_safe!==false)agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');
   const frame=Buffer.from(JSON.stringify(result.frame)+'\n');if(frame.length>65536)agentError('AGENT_INPUT_INVALID');
   const response=await hostRequest(ctx,{action:'input',launch_id:v.launch_id,operation_id:v.operation_id,process_identity:hostIdentity(row.process_identity),frame_digest:hash(frame),frame_b64:frame.toString('base64')});
   return {launch_id:v.launch_id,operation_id:v.operation_id,delivery:response.delivery,replayed:response.replayed===true,native_consumption_observed:false,capacity_retained:true,grants_authority:false};
  });
 }),
 'supervisor.session.stop':action(async(input,i)=>{
  const v=exactAgentObject(input,['launch_id','operation_id']);agentString(v.launch_id,'uuid');agentString(v.operation_id,'uuid');
  const row=await agentTransaction(ctx,i,async tx=>{
   const found=await tx.query('SELECT process_identity FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[i.principal.organisation_id,i.principal.run_id,v.launch_id]);
   if(!found.rows[0]?.process_identity)agentError('SUPERVISOR_LAUNCH_NOT_FOUND');return found.rows[0];
  });
  const result=await hostRequest(ctx,{action:'stop',launch_id:v.launch_id,operation_id:v.operation_id,process_identity:hostIdentity(row.process_identity)});
  return {launch_id:v.launch_id,host_observation:result,capacity_retained:true,release_requires_registered_quiescence:true,grants_authority:false};
 })
 }};
}
