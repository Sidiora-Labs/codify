import fs from 'node:fs/promises';
import path from 'node:path';
import {spawn,execFile} from 'node:child_process';
import type {ChildProcessWithoutNullStreams} from 'node:child_process';
import {createHash} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertInvocation} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {object} from '../policy/programme.js';
import {isNativeAuthAuthority} from '../identity/native_auth.js';
import {exactAgentObject,agentString,agentError,agentDigest,agentTransaction} from './sessions.js';

type MapValue=Record<string,unknown>;
type Dimension={dimension:'CPU_MILLIS'|'MEMORY_BYTES'|'AGENT';capacity_account_id:string;quantity:string};
type Profile={profile_id:string;host_id:string;pool_id:string;restriction_profile_digest:string;cwd:string;home:string;temp:string;uid:number;mcp_config_path:string;mcp_config_digest:string;bridge_binary_digest:string;mcp_policy_digest:string;expires_after_seconds:number;dimensions:Dimension[]};
interface PlacementAuthority {authorizeSupervisor(tx:PrimaryTransaction,i:InvocationContext,v:MapValue):Promise<MapValue>}
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
 const p=exactAgentObject(value,['profile_id','host_id','pool_id','restriction_profile_digest','cwd','home','temp','uid','mcp_config_path','mcp_config_digest','bridge_binary_digest','mcp_policy_digest','expires_after_seconds','dimensions']);
 agentString(p.profile_id);agentString(p.host_id);agentString(p.pool_id,'uuid');agentString(p.restriction_profile_digest,'digest');agentString(p.mcp_config_digest,'digest');agentString(p.bridge_binary_digest,'digest');agentString(p.mcp_policy_digest,'digest');
 for(const key of ['cwd','home','temp','mcp_config_path'])if(typeof p[key]!=='string'||!path.isAbsolute(p[key] as string))agentError('SUPERVISOR_CONFIG_INVALID');
 if(new Set([p.cwd,p.home,p.temp]).size!==3||seen.has(String(p.profile_id))||homes.has(String(p.home))||!Number.isSafeInteger(p.uid)||Number(p.uid)<1000||!Number.isSafeInteger(p.expires_after_seconds)||Number(p.expires_after_seconds)<30||Number(p.expires_after_seconds)>86400||!Array.isArray(p.dimensions)||p.dimensions.length!==3)agentError('SUPERVISOR_CONFIG_INVALID');
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
async function nativePlan(ctx:ComponentContext,p:Profile,native:MapValue):Promise<string[]>{
 const binary=ctx.env.HF_SUPERVISOR_NATIVE_RUNNER,expected=ctx.env.HF_SUPERVISOR_NATIVE_RUNNER_DIGEST,root=ctx.env.HF_SUPERVISOR_PRIVATE_SPOOL;
 if(!binary||!path.isAbsolute(binary)||!expected||!root||!path.isAbsolute(root))agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');
 const st=await fs.lstat(binary),spool=await fs.lstat(root);
 if(!st.isFile()||st.isSymbolicLink()||(st.mode&0o022)!==0||st.size>134217728||hash(await fs.readFile(binary))!==expected||!spool.isDirectory()||spool.isSymbolicLink()||(spool.mode&0o077)!==0||await fs.realpath(root)!==path.resolve(root))agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');
 const directory=await fs.mkdtemp(path.join(root,'plan-')),snapshot=path.join(directory,'snapshot.json');
 try{
  await fs.writeFile(snapshot,JSON.stringify(native),{mode:0o600,flag:'wx'});
  const payload={connector:native.connector,expected_version:(native.binary as MapValue).version,alias:native.configured_model_alias,auth_profile:native.profile_id,workspace:p.cwd,home:p.home,temp:p.temp,permission_mode:'supervision'};
  const output=await new Promise<string>((resolve,reject)=>{
   const child=execFile(binary,['--component','13.1','--action','connector.launch'],{timeout:20000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',HF_NATIVE_AUTH_SNAPSHOT_FILE:snapshot,HF_SUPERVISOR_MCP_CONFIG_FILE:p.mcp_config_path}},(error,stdout)=>error?reject(new Error('Pinned native supervisor adapter failed')):resolve(stdout));
   child.stdin?.end(JSON.stringify(payload));
  });
  const result=JSON.parse(output);if(result.ok!==true||!object(result.result)||result.result.permission_mode!=='supervision'||result.result.dispatch_eligible!==false||!Array.isArray(result.result.argv)||result.result.argv.some((v:unknown)=>typeof v!=='string')||result.result.argv[0]!==((native.binary as MapValue).path)||result.result.profile_digest!==native.profile_digest)agentError('SUPERVISOR_NATIVE_ADAPTER_UNAVAILABLE');
  return result.result.argv as string[];
 }finally{await fs.rm(directory,{recursive:true,force:true});}
}
async function processIdentity(pid:number):Promise<{pid:number;start_time:string;kernel_boot_id:string}|null>{
 try{const [stat,boot]=await Promise.all([fs.readFile('/proc/'+pid+'/stat','utf8'),fs.readFile('/proc/sys/kernel/random/boot_id','utf8')]);const rest=stat.slice(stat.lastIndexOf(')')+2).split(' ');return {pid,start_time:rest[19]!,kernel_boot_id:boot.trim()};}catch{return null;}
}
export function createComponent(ctx:ComponentContext):Component{
 const inventory=profiles(ctx);void inventory.catch(()=>{});
 const live=new Map<string,ChildProcessWithoutNullStreams>();
 const action=(fn:(v:MapValue,i:InvocationContext)=>Promise<unknown>)=>async(v:unknown,c:ComponentContext)=>{assertInvocation(c.invocation);if(!object(v))agentError('AGENT_INPUT_INVALID');if(!['OPERATOR','COORDINATOR','LEADER'].includes(c.invocation.principal.role))agentError('SUPERVISOR_SCOPE_DENIED');return fn(v,c.invocation);};
 const record=async(org:string,run:string,id:string,change:{native_id?:string;exited?:boolean;exit_code?:number|null})=>{
  // This records a server-observed child event only; it renews no credential, lease or reservation.
  await ctx.resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2},async tx=>{
   if(change.native_id){await tx.query('UPDATE hyperfide.agent_sessions SET native_session_id=$4,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=(SELECT session_id FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 AND id=$3) AND state=\'REGISTERED\' AND native_session_id IS NULL',[org,run,id,change.native_id]);}
   await tx.query('UPDATE hyperfide.supervisor_launches SET native_session_id=COALESCE(native_session_id,$4),state=CASE WHEN $5 THEN \'EXITED\' ELSE state END,exit_code=CASE WHEN $5 THEN $6 ELSE exit_code END,observed_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[org,run,id,change.native_id??null,change.exited??false,change.exit_code??null]);
  });
 };
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
   const row=(await tx.query("INSERT INTO hyperfide.supervisor_launches(organisation_id,run_id,id,session_id,profile_id,profile_digest,request_digest,host_id,placement,reservations,state) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'STARTING') RETURNING *",[org,run,id,v.session_id,p.profile_id,native.profile_digest,requested,p.host_id,auth,JSON.stringify(reservations)])).rows[0]!;
   return {row,replayed:false};
  });
  if(committed.replayed)return {launch:committed.row,replayed:true,execution_replayed:false,grants_authority:false};
  // Persist intent before the irreversible exec. A controller crash leaves visible UNKNOWN debt.
  await agentTransaction(ctx,i,async tx=>{const changed=await tx.query("UPDATE hyperfide.supervisor_launches SET state='SPAWNING' WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state='STARTING' RETURNING id",[org,run,id]);if(changed.rows.length!==1)agentError('SUPERVISOR_LAUNCH_UNCERTAIN');});
  await runtimeFiles(p);
  const binary=await fs.readFile(native.binary.path);if(hash(binary)!==native.binary.digest)agentError('SUPERVISOR_BINARY_DRIFT');
  const argv=await nativePlan(ctx,p,native as unknown as MapValue);
  const child=spawn(argv[0]!,argv.slice(1),{shell:false,cwd:p.cwd,uid:p.uid,gid:p.uid,detached:true,stdio:['pipe','pipe','pipe'],env:{PATH:'/usr/bin:/bin',HOME:p.home,XDG_CONFIG_HOME:path.join(p.home,'.config'),TMPDIR:p.temp,LANG:'C.UTF-8'}});
  child.stdin.on('error',()=>{});
  live.set(id,child);let size=0,pending='',nativeId:string|null=null;
  const kill=()=>{if(child.pid)try{process.kill(-child.pid,'SIGTERM');}catch{};};
  const timer=setTimeout(kill,p.expires_after_seconds*1000);timer.unref();
  child.stderr.on('data',(b:Buffer)=>{size+=b.length;if(size>1048576)kill();});
  child.stdout.on('data',(b:Buffer)=>{
   size+=b.length;if(size>1048576){kill();return;}pending+=b.toString('utf8');
   while(pending.includes('\n')){const split=pending.indexOf('\n'),line=pending.slice(0,split);pending=pending.slice(split+1);
    try{const event=JSON.parse(line);if(event.type==='system'&&event.subtype==='init'&&typeof event.session_id==='string'&&/^[0-9a-f-]{36}$/.test(event.session_id)){if(nativeId&&nativeId!==event.session_id){kill();return;}nativeId=event.session_id;void record(org,run,id,{native_id:event.session_id as string}).catch(kill);}}catch{}
   }
  });
  child.once('error',()=>{live.delete(id);clearTimeout(timer);void record(org,run,id,{exited:true,exit_code:null}).catch(()=>{});});
  child.once('exit',code=>{live.delete(id);clearTimeout(timer);void record(org,run,id,{exited:true,exit_code:code}).catch(()=>{});});
  if(child.pid){const observed=await processIdentity(child.pid);if(observed)await agentTransaction(ctx,i,async tx=>{
   await tx.query("UPDATE hyperfide.supervisor_launches SET state=CASE WHEN state='SPAWNING' THEN 'RUNNING' ELSE state END,process_identity=COALESCE(process_identity,$4) WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[org,run,id,observed]);
   const reservations=await tx.query("SELECT id FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2 AND request_id=$3 ORDER BY id",[org,run,id]);
   const allocation=ctx.dependencies.require('5.1','scheduler.allocations.v1',allocationAuthority);
   await allocation.allocateReservations(tx as PrimaryTransaction,{organisation_id:org,run_id:run,reservation_ids:reservations.rows.map(r=>String(r.id))});
  });}
  child.stdin.write(JSON.stringify({type:'user',message:{role:'user',content:'Initialise the supervision session. Use only the permitted graph, spec and control tools.'}})+'\n');
  return {launch_id:id,session_id:v.session_id,process_id:child.pid??null,native_session_id:null,native_identity_pending:true,execution_started:child.pid!==undefined,capacity_retained:true,execution_replayed:false,context_restored:false,grants_authority:false};
 }),
 'supervisor.session.inspect':action(async(input,i)=>{
  const v=exactAgentObject(input,['launch_id']);agentString(v.launch_id,'uuid');
  return agentTransaction(ctx,i,async tx=>{
   const found=await tx.query('SELECT * FROM hyperfide.supervisor_launches WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[i.principal.organisation_id,i.principal.run_id,v.launch_id]);
   if(!found.rows[0])agentError('SUPERVISOR_LAUNCH_NOT_FOUND');
   const row=found.rows[0],identity=row.process_identity as {pid:number;start_time:string;kernel_boot_id:string}|null,actual=identity?await processIdentity(identity.pid):null;
   return {launch:row,process_observation:identity?actual&&actual.start_time===identity.start_time&&actual.kernel_boot_id===identity.kernel_boot_id?'MATCHING_PROCESS':'ORIGINAL_PROCESS_ABSENT':'UNKNOWN',capacity_retained:true,release_requires_registered_quiescence:true,context_restored:false,grants_authority:false};
  });
 })
 },close:async()=>{for(const child of live.values())if(child.pid)try{process.kill(-child.pid,'SIGTERM');}catch{};}};
}
