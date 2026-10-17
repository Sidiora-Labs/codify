import fs from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
import path from 'node:path';
import type {ComponentContext} from '../components/registry.js';
import {object} from '../policy/programme.js';
import {assertInvocation,decimal,exact,fail,frozen,hash,NAME,strictJSON} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import type {IdentityGateway,IdentityTransaction} from './enrollment.js';
import {recorded} from './enrollment.js';
import type {AuthProfileSnapshot} from './native_auth.js';
type Connector=AuthProfileSnapshot['connector'];type Mode=AuthProfileSnapshot['auth_mode'];
const CONNECTORS:readonly Connector[]=['claude','codex'],MODES:readonly Mode[]=['account_session','api_credential'];
interface ModeEntry {profile_id:string;host_auth_import:string|null;portable_session_claimed:boolean}
interface ConnectorEntry {connector:Connector;selected_mode:Mode|'UNRESOLVED';modes:Record<Mode,ModeEntry|null>;account_guidance:{reference:string;concurrent_refresh:'UNSUPPORTED'|'SERIALISED_ONLY'|'ASSUMED_SAFE';renewal_assumption_hours:number}}
export interface OperatorModeConfig {config_revision:string;config_digest:string;connectors:Map<Connector,ConnectorEntry>}
export interface QualificationRecord {
 schema_version:1;id:string;connector:Connector;auth_mode:Mode;profile_id:string;profile_digest:string;cli:{version:string;digest:string};
 operator_config:{revision:string;digest:string;selected_mode:Mode|'UNRESOLVED'};account_guidance:{reference:string;concurrent_refresh:string;renewal_assumption_hours:number};
 probe_outcome:'AUTHENTICATED'|'AUTH_BLOCKED'|'NOT_RUN';refresh_race:'SERIALISED'|'UNSAFE';state:'BLOCKED'|'PROBED_UNQUALIFIED';blocked_reasons:string[];
 live_qualified:false;portability_qualified:false;endurance_72h:'NOT_CLAIMED';record_digest:string;recorded_by:string;created_at:string;
}
export interface QualificationStore {
 qualify(i:InvocationContext,snapshot:AuthProfileSnapshot,probe:()=>Promise<{native_authentication:string}>):Promise<QualificationRecord>;
 inspect(i:InvocationContext,connector:unknown):Promise<unknown>;
 commitRefresh(i:InvocationContext,v:unknown):Promise<unknown>;
}
const MIGRATION='0042-native-qualification';
// Readiness only verifies the trusted release migration; DDL is never run at startup.
export async function qualificationReady(g:IdentityGateway):Promise<void>{
 const bytes=await fs.readFile(new URL('../../migrations/'+MIGRATION+'.sql',import.meta.url));
 await g.withPrimaryTransaction({timeoutMs:5000},async tx=>{const r=(await tx.query('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=42')).rows[0];if(!r||r.name!==MIGRATION||r.checksum!==hash(bytes))fail('NATIVE_QUALIFICATION_SCHEMA_REQUIRED','Apply exact trusted native qualification migration before loading');});
}
function shape(v:unknown,names:readonly string[]):asserts v is Record<string,unknown>{if(!object(v)||Object.keys(v).length!==names.length||names.some(n=>!Object.hasOwn(v,n)))fail('NATIVE_AUTH_MODE_CONFIG','Operator mode configuration fields differ from the non-secret contract');}
function label(v:unknown):v is string{return typeof v==='string'&&NAME.test(v);}
// Operator auth-mode choice is non-secret configuration; it is read per qualification so the recorded digest is current.
async function modeConfig(ctx:ComponentContext,profiles:ReadonlyMap<string,AuthProfileSnapshot>):Promise<OperatorModeConfig>{
 const file=ctx.env.HF_NATIVE_AUTH_MODE_FILE;if(!file||!path.isAbsolute(file))fail('NATIVE_AUTH_MODE_UNRESOLVED','Operator authentication-mode configuration required');
 const st=await fs.lstat(file).catch(()=>fail('NATIVE_AUTH_MODE_UNRESOLVED','Operator authentication-mode configuration is absent'));
 if(!st.isFile()||st.isSymbolicLink()||st.uid!==process.getuid?.()||(st.mode&0o022)!==0||st.size>65536)fail('NATIVE_AUTH_MODE_CONFIG','Bounded operator-owned regular mode configuration required');
 const bytes=await fs.readFile(file),raw=strictJSON(bytes);shape(raw,['schema_version','config_revision','connectors']);
 if(raw.schema_version!==1||!label(raw.config_revision)||!Array.isArray(raw.connectors)||!raw.connectors.length||raw.connectors.length>CONNECTORS.length)fail('NATIVE_AUTH_MODE_CONFIG','Invalid operator mode configuration');
 const connectors=new Map<Connector,ConnectorEntry>();
 for(const c of raw.connectors){
  shape(c,['connector','selected_mode','modes','account_guidance']);
  if(!CONNECTORS.includes(c.connector as Connector)||connectors.has(c.connector as Connector)||!['UNRESOLVED',...MODES].includes(c.selected_mode as string))fail('NATIVE_AUTH_MODE_CONFIG','Invalid connector mode selection');
  shape(c.modes,[...MODES]);shape(c.account_guidance,['reference','concurrent_refresh','renewal_assumption_hours']);
  const g=c.account_guidance;if(!label(g.reference)||!['UNSUPPORTED','SERIALISED_ONLY','ASSUMED_SAFE'].includes(g.concurrent_refresh as string)||!Number.isInteger(g.renewal_assumption_hours)||Number(g.renewal_assumption_hours)<1||Number(g.renewal_assumption_hours)>8760)fail('NATIVE_AUTH_MODE_CONFIG','Approved account guidance reference required');
  const modes={} as Record<Mode,ModeEntry|null>;
  for(const mode of MODES){
   const m=c.modes[mode];if(m===null){modes[mode]=null;continue;}
   shape(m,['profile_id','host_auth_import','portable_session_claimed']);
   const p=typeof m.profile_id==='string'?profiles.get(m.profile_id):undefined;
   if(!p||p.connector!==c.connector||p.auth_mode!==mode||m.host_auth_import!==null&&(typeof m.host_auth_import!=='string'||!path.isAbsolute(m.host_auth_import))||typeof m.portable_session_claimed!=='boolean')fail('NATIVE_AUTH_MODE_CONFIG','Mode must name a configured profile of the same connector and mode');
   modes[mode]={profile_id:m.profile_id as string,host_auth_import:m.host_auth_import as string|null,portable_session_claimed:m.portable_session_claimed};
  }
  if(c.selected_mode!=='UNRESOLVED'&&!modes[c.selected_mode as Mode])fail('NATIVE_AUTH_MODE_CONFIG','Selected mode lacks a configured profile');
  connectors.set(c.connector as Connector,{connector:c.connector as Connector,selected_mode:c.selected_mode as Mode|'UNRESOLVED',modes,account_guidance:{reference:g.reference as string,concurrent_refresh:g.concurrent_refresh as ConnectorEntry['account_guidance']['concurrent_refresh'],renewal_assumption_hours:Number(g.renewal_assumption_hours)}});
 }
 return {config_revision:raw.config_revision,config_digest:hash(bytes),connectors};
}
function record(r:Record<string,any>):QualificationRecord{
 return frozen({schema_version:1,id:r.id,connector:r.connector,auth_mode:r.auth_mode,profile_id:r.profile_id,profile_digest:r.profile_digest,cli:{version:r.cli_version,digest:r.cli_digest},
  operator_config:{revision:r.operator_config_revision,digest:r.operator_config_digest,selected_mode:r.operator_selected_mode},account_guidance:{reference:r.guidance_reference,concurrent_refresh:r.concurrent_refresh_guidance,renewal_assumption_hours:Number(r.renewal_assumption_hours)},
  probe_outcome:r.probe_outcome,refresh_race:r.refresh_race,state:r.state,blocked_reasons:[...r.blocked_reasons],live_qualified:false,portability_qualified:false,endurance_72h:'NOT_CLAIMED',record_digest:r.record_digest,recorded_by:r.recorded_by,created_at:new Date(r.created_at).toISOString()});
}
export function createQualificationStore(ctx:ComponentContext,g:IdentityGateway,profiles:ReadonlyMap<string,AuthProfileSnapshot>):QualificationStore{
 const transact=<T>(i:InvocationContext,fn:(tx:IdentityTransaction)=>Promise<T>)=>{assertInvocation(i);return g.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:i.signal,guard:i.guard},async tx=>{const result=await fn(tx);await i.guard(tx);return result;});};
 const operator=(i:InvocationContext,roles:string[]):void=>{if(!roles.includes(i.principal.role))fail('ROLE_DENIED','Principal role is not permitted');};
 const cas=async(tx:IdentityTransaction,i:InvocationContext,lineage:string,expected:string,digest:string):Promise<string|null>=>{
  const p=i.principal,writer=randomUUID();
  if(expected==='0')return (await tx.query('INSERT INTO hyperfide.native_auth_refresh_lineage(organisation_id,run_id,lineage_id,generation,state_digest,writer_operation_id) VALUES($1,$2,$3,1,$4,$5) ON CONFLICT DO NOTHING RETURNING generation',[p.organisation_id,p.run_id,lineage,digest,writer])).rows[0]?.generation?.toString()??null;
  return (await tx.query('UPDATE hyperfide.native_auth_refresh_lineage SET generation=generation+1,state_digest=$5,writer_operation_id=$6,updated_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND lineage_id=$3 AND generation=$4 RETURNING generation',[p.organisation_id,p.run_id,lineage,expected,digest,writer])).rows[0]?.generation?.toString()??null;
 };
 // Controlled refresh race: two refreshers that both observed the same lineage generation commit concurrently.
 // Concurrency is never assumed safe; the mode is usable only if exactly one write lands and the stale one is refused.
 const refreshRace=async(i:InvocationContext,id:string):Promise<'SERIALISED'|'UNSAFE'>=>{
  const lineage='qualification-race:'+id;
  if(await transact(i,tx=>cas(tx,i,lineage,'0',hash('initial:'+id)))!=='1')return 'UNSAFE';
  const outcomes=await Promise.allSettled([1,2].map(n=>transact(i,tx=>cas(tx,i,lineage,'1',hash('refresh:'+n+':'+id)))));
  const winners=outcomes.filter(o=>o.status==='fulfilled'&&o.value==='2').length;
  const current=await transact(i,async tx=>String((await tx.query('SELECT generation FROM hyperfide.native_auth_refresh_lineage WHERE organisation_id=$1 AND run_id=$2 AND lineage_id=$3',[i.principal.organisation_id,i.principal.run_id,lineage])).rows[0]?.generation));
  return winners===1&&current==='2'?'SERIALISED':'UNSAFE';
 };
 const qualify:QualificationStore['qualify']=async(i,s,probe)=>{
  assertInvocation(i);operator(i,['OPERATOR']);
  const config=await modeConfig(ctx,profiles),entry=config.connectors.get(s.connector),mode=entry?.modes[s.auth_mode];
  if(!entry||!mode||mode.profile_id!==s.profile_id)fail('NATIVE_AUTH_MODE_UNCONFIGURED','Operator configuration does not offer this connector authentication mode');
  const reasons:string[]=[];
  if(mode.host_auth_import!==null)reasons.push('HOST_AUTH_DIRECTORY_COPY_UNSUPPORTED');
  if(mode.portable_session_claimed||s.capabilities.portable_session)reasons.push('CREDENTIAL_PORTABILITY_UNSUPPORTED');
  if(entry.account_guidance.concurrent_refresh==='ASSUMED_SAFE'||s.capabilities.concurrent_account)reasons.push('CONCURRENT_REFRESH_NOT_ASSUMED_SAFE');
  if(entry.account_guidance.renewal_assumption_hours<72)reasons.push('RENEWAL_GUIDANCE_BELOW_72H');
  // A mode blocked by configuration is never executed; the pinned CLI is probed only for otherwise admissible modes.
  const probe_outcome=reasons.length?'NOT_RUN':(await probe()).native_authentication==='AUTHENTICATED'?'AUTHENTICATED':'AUTH_BLOCKED';
  if(probe_outcome==='AUTH_BLOCKED')reasons.push('AUTH_BLOCKED');
  const id=randomUUID(),refresh_race=await refreshRace(i,id);
  if(refresh_race!=='SERIALISED')reasons.push('REFRESH_RACE_UNSAFE');
  const fields={id,connector:s.connector,auth_mode:s.auth_mode,profile_id:s.profile_id,profile_digest:s.profile_digest,cli_version:s.binary.version,cli_digest:s.binary.digest,
   operator_config_revision:config.config_revision,operator_config_digest:config.config_digest,operator_selected_mode:entry.selected_mode,guidance_reference:entry.account_guidance.reference,
   concurrent_refresh_guidance:entry.account_guidance.concurrent_refresh,renewal_assumption_hours:entry.account_guidance.renewal_assumption_hours,probe_outcome,refresh_race,
   state:reasons.length?'BLOCKED':'PROBED_UNQUALIFIED',blocked_reasons:reasons,live_qualified:false,portability_qualified:false,endurance_72h:'NOT_CLAIMED'};
  const digest=hash(JSON.stringify(fields));
  return transact(i,tx=>recorded(tx,i.principal.credential_id,'native.auth.qualify',i.operation,async()=>record((await tx.query(
   'INSERT INTO hyperfide.native_auth_qualifications(organisation_id,run_id,id,connector,auth_mode,profile_id,profile_digest,cli_version,cli_digest,operator_config_revision,operator_config_digest,operator_selected_mode,guidance_reference,concurrent_refresh_guidance,renewal_assumption_hours,probe_outcome,refresh_race,state,blocked_reasons,record_digest,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *',
   [i.principal.organisation_id,i.principal.run_id,id,fields.connector,fields.auth_mode,fields.profile_id,fields.profile_digest,fields.cli_version,fields.cli_digest,fields.operator_config_revision,fields.operator_config_digest,fields.operator_selected_mode,fields.guidance_reference,fields.concurrent_refresh_guidance,fields.renewal_assumption_hours,probe_outcome,refresh_race,fields.state,reasons,digest,i.principal.actor_id])).rows[0]!)));
 };
 const inspect:QualificationStore['inspect']=async(i,connector)=>{
  assertInvocation(i);operator(i,['OPERATOR','COORDINATOR']);if(!CONNECTORS.includes(connector as Connector))fail('INVALID_REQUEST','Known connector required');
  const config=await modeConfig(ctx,profiles),entry=config.connectors.get(connector as Connector);
  return transact(i,async tx=>{
   const modes:Record<string,{configured:boolean;profile_id:string|null;latest:QualificationRecord|null}>={};
   for(const mode of MODES){const row=(await tx.query('SELECT * FROM hyperfide.native_auth_qualifications WHERE organisation_id=$1 AND run_id=$2 AND connector=$3 AND auth_mode=$4 ORDER BY created_at DESC,id DESC LIMIT 1',[i.principal.organisation_id,i.principal.run_id,connector,mode])).rows[0];
    modes[mode]={configured:!!entry?.modes[mode],profile_id:entry?.modes[mode]?.profile_id??null,latest:row?record(row):null};}
   const selected=entry?.selected_mode??'UNRESOLVED',latest=selected==='UNRESOLVED'?null:modes[selected]!.latest;
   return {schema_version:1,connector,operator_config:{revision:config.config_revision,digest:config.config_digest},selected_mode:selected,modes,
    selected_mode_blocked:latest===null||latest.state==='BLOCKED',live_qualified:false,endurance_72h:'NOT_CLAIMED'};
  });
 };
 const commitRefresh:QualificationStore['commitRefresh']=async(i,v)=>{
  assertInvocation(i);operator(i,['OPERATOR','COORDINATOR']);exact(v,['connector','auth_mode','expected_generation','state_digest']);
  if(!CONNECTORS.includes(v.connector as Connector)||!MODES.includes(v.auth_mode as Mode)||!decimal(v.expected_generation)||typeof v.state_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(v.state_digest))fail('INVALID_REQUEST','Connector mode, expected generation and refreshed-state digest required');
  const config=await modeConfig(ctx,profiles);if(!config.connectors.get(v.connector as Connector)?.modes[v.auth_mode as Mode])fail('NATIVE_AUTH_MODE_UNCONFIGURED','Operator configuration does not offer this connector authentication mode');
  return transact(i,tx=>recorded(tx,i.principal.credential_id,'native.auth.refresh.commit',i.operation,async()=>{
   const generation=await cas(tx,i,'runtime:'+v.connector+':'+v.auth_mode,v.expected_generation as string,v.state_digest as string);
   if(generation===null)fail('STALE_REFRESH_STATE','Refresh state is stale; current credential lineage is not overwritten');
   return {committed:true,connector:v.connector,auth_mode:v.auth_mode,generation};
  }));
 };
 return Object.freeze({qualify,inspect,commitRefresh});
}
