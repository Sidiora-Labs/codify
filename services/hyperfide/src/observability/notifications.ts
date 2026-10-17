import {randomUUID} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import {authority,object,text,uuid,digest,integer,hash,fail,lockRun,requireArtifact,numbers} from './views.js';
import type {Session,Principal} from './views.js';
interface Outbox {
 bindSessionConsumer(tx:Session,input:{organisation_id:string;run_id:string;session_id:string;consumer_id:string;namespace:'fleet_notification'},invocation:unknown):Promise<{session_id:string;consumer_id:string;replayed:boolean;registered_actor_id:string}>;
 enqueue(tx:Session,event:{organisation_id:string;run_id:string;id:string;aggregate_id:string;aggregate_type:string;aggregate_version:string;event_type:string;payload:Record<string,unknown>},options:{consumer_ids:string[]}):Promise<unknown>;
}
function isOutbox(value:unknown):value is Outbox{return !!value&&typeof value==='object'&&typeof (value as Outbox).enqueue==='function'&&typeof (value as Outbox).bindSessionConsumer==='function';}
interface InboxBootstrap {bootstrapConsumer(tx:Session,input:{organisation_id:string;run_id:string;bootstrap_id:string;consumer_id:string;aggregate_types:string[];limit:number},builder:(tx:Session)=>Promise<unknown>):Promise<unknown>}
function isInbox(value:unknown):value is InboxBootstrap{return !!value&&typeof value==='object'&&typeof (value as InboxBootstrap).bootstrapConsumer==='function';}
function recipientAccess(p:Principal,target:string):void{
 if(!['OPERATOR','COORDINATOR'].includes(p.role)&&!(p.actor_id===target&&['LEADER','FEATURE_MANAGER'].includes(p.role)))fail('NOTIFICATION_RECIPIENT_FORBIDDEN','Private notices require the identified recipient or authorised operator');
}

export async function bootstrapRecipient(tx:Session,p:Principal,input:unknown,inbox:InboxBootstrap):Promise<unknown>{
 const v=object(input,['target_session_id','target_consumer_id','bootstrap_id']),target=uuid(v.target_session_id),consumer=uuid(v.target_consumer_id),id=uuid(v.bootstrap_id);
 recipientAccess(p,target);
 const q=await tx.query("SELECT b.consumer_id,s.sandbox_boot_generation FROM hyperfide.event_session_bindings b JOIN hyperfide.agent_sessions s ON s.organisation_id=b.organisation_id AND s.run_id=b.run_id AND s.id=b.session_id JOIN hyperfide.event_consumers c ON c.organisation_id=b.organisation_id AND c.run_id=b.run_id AND c.id=b.consumer_id WHERE b.organisation_id=$1 AND b.run_id=$2 AND b.session_id=$3 AND b.consumer_id=$4 AND b.namespace='fleet_notification' AND c.consumer_key=$5 AND s.role IN ('LEADER','FEATURE_MANAGER') AND s.state IN ('REGISTERED','RUNNING','DISCONNECTED')",[p.organisation_id,p.run_id,target,consumer,'session:'+target+':fleet_notification']);
 if(q.rows.length!==1)fail('NOTIFICATION_RECIPIENT_INVALID','Exact current recipient binding is required');
 return inbox.bootstrapConsumer(tx,{organisation_id:p.organisation_id,run_id:p.run_id,bootstrap_id:id,consumer_id:consumer,aggregate_types:['fleet_notification'],limit:10000},async sameTx=>{
  const notices=await sameTx.query("SELECT id,event_id,severity,code,untrusted_summary,action_code,artifact_id,state,state_version,target_boot_generation FROM hyperfide.observability_notifications WHERE organisation_id=$1 AND run_id=$2 AND target_session_id=$3 AND target_consumer_id=$4 AND state<>'ACKNOWLEDGED' ORDER BY id LIMIT 1001",[p.organisation_id,p.run_id,target,consumer]);
  if(notices.rows.length>1000)fail('NOTIFICATION_SNAPSHOT_BUDGET','Pending snapshot exceeds the recipient bound');
  if(notices.rows.some(n=>n.target_boot_generation!==q.rows[0]!.sandbox_boot_generation&&!(n.target_boot_generation===null&&q.rows[0]!.sandbox_boot_generation===null)))fail('NOTIFICATION_RECIPIENT_STALE','Pending notices bind another recipient boot generation');
  const clock=await sameTx.query('SELECT clock_timestamp() AS as_of');
  return numbers({scope:{organisation_id:p.organisation_id,run_id:p.run_id},target_session_id:target,target_consumer_id:consumer,as_of:clock.rows[0]!.as_of,notices:notices.rows.map(n=>({...n,evidence_ref:evidenceRef(p,String(n.artifact_id)),summary_trust:'UNTRUSTED_DATA_NOT_AN_INSTRUCTION'})),semantics:'PRIMARY_DURABLE_ADMISSION_NOT_UI_EFFECT',truncated:false});
 });
}
const ACTIONS=['INSPECT_EVIDENCE','RECONCILE_RESOURCE','RETRY_OPERATION','REPAIR_TASK','ROTATE_CREDENTIAL','PAUSE_ADMISSION'];
function rejectCredentialSummary(raw:unknown,knownSecrets:readonly string[]):string{
 const summary=text(raw,512);
 const shaped=/\b(?:bearer|basic)\s+\S{4,}|-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----|\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|password|authorization)\s*[:=]\s*\S+|\b(?:gh[pousr]_|github_pat_|sk-(?:proj-)?)[A-Za-z0-9_-]{8,}|\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/i;
 if(shaped.test(summary)||knownSecrets.some(secret=>summary.includes(secret)))fail('NOTIFICATION_SENSITIVE_CONTENT','Credential material must be removed before creating an exception summary');
 return summary;
}
function evidenceRef(p:Principal,id:string):unknown{return {kind:'ARTIFACT',organisation_id:p.organisation_id,run_id:p.run_id,artifact_id:id,operation:{component:'15.2',action:'artifact.object.inspect',input:{organisation_id:p.organisation_id,run_id:p.run_id,artifact_id:id}},availability:'METADATA_COMPLETE_BYTES_UNVERIFIED',requires_authenticated_retrieval:true};}

async function reconcileAcknowledgements(tx:Session,p:Principal):Promise<void>{
 await tx.query("UPDATE hyperfide.observability_notifications n SET state='ACKNOWLEDGED',state_version=n.state_version+1 FROM hyperfide.event_deliveries d WHERE n.organisation_id=$1 AND n.run_id=$2 AND n.state='ENQUEUED' AND d.organisation_id=n.organisation_id AND d.run_id=n.run_id AND d.event_id=n.event_id AND d.consumer_id=n.target_consumer_id AND d.state='ACKNOWLEDGED'",[p.organisation_id,p.run_id]);
}
export async function bindRecipient(tx:Session,p:Principal,input:unknown,outbox:Outbox,invocation:unknown):Promise<unknown>{
 const v=object(input,['target_session_id','target_consumer_id']),session=uuid(v.target_session_id),consumer=uuid(v.target_consumer_id);
 recipientAccess(p,session);
 const bound=await outbox.bindSessionConsumer(tx,{organisation_id:p.organisation_id,run_id:p.run_id,session_id:session,consumer_id:consumer,namespace:'fleet_notification'},invocation);
 return {registered:true,replayed:bound.replayed,session_id:bound.session_id,consumer_id:bound.consumer_id,registrar_actor_id:bound.registered_actor_id};
}

export async function enqueueNotice(tx:Session,p:Principal,input:unknown,knownSecrets:readonly string[]=[]):Promise<unknown>{
 if(!['OPERATOR','COORDINATOR','RUNNER','PROVISIONER','DISPATCH','LEADER','FEATURE_MANAGER'].includes(p.role))fail('NOTIFICATION_PRODUCER_FORBIDDEN','A trusted supervisory producer must emit fleet exceptions');
 const v=object(input,['id','target_session_id','target_consumer_id','dedup_key','severity','code','untrusted_summary','action_code','artifact_id']);
 const id=uuid(v.id),target=uuid(v.target_session_id),consumer=uuid(v.target_consumer_id),key=digest(v.dedup_key),severity=text(v.severity),code=text(v.code,64),summary=rejectCredentialSummary(v.untrusted_summary,knownSecrets),action=text(v.action_code),artifact=uuid(v.artifact_id);
 if(!['INFO','WARNING','ERROR','CRITICAL'].includes(severity)||!/^[A-Z][A-Z0-9_]{0,63}$/.test(code)||!ACTIONS.includes(action))fail('OBSERVABILITY_INPUT_INVALID','Typed notification severity, code or action is invalid');
 await lockRun(tx,p,'notifications');await reconcileAcknowledgements(tx,p);
 const session=await tx.query("SELECT id,role,state,sandbox_boot_generation FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND role IN ('LEADER','FEATURE_MANAGER') AND state IN ('REGISTERED','RUNNING','DISCONNECTED') FOR SHARE",[p.organisation_id,p.run_id,target]);
 if(session.rows.length!==1)fail('NOTIFICATION_RECIPIENT_INVALID','An identified current leader or feature manager session is required');
 const registered=await tx.query("SELECT id FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND consumer_key=$4 AND state IN ('ACTIVE','BUFFERING') FOR SHARE",[p.organisation_id,p.run_id,consumer,'session:'+target+':fleet_notification']);
 const binding=await tx.query('SELECT consumer_id FROM hyperfide.event_session_bindings WHERE organisation_id=$1 AND run_id=$2 AND consumer_id=$3 AND session_id=$4 AND namespace=\'fleet_notification\'',[p.organisation_id,p.run_id,consumer,target]);
 if(registered.rows.length!==1||binding.rows.length!==1)fail('NOTIFICATION_RECIPIENT_INVALID','Durable consumer must be registered for the exact target session');
 await requireArtifact(tx,p,artifact);
 const payload={target_session_id:target,target_consumer_id:consumer,target_boot_generation:session.rows[0]!.sandbox_boot_generation??null,severity,code,untrusted_summary:summary,action_code:action,artifact_id:artifact},identity=hash(payload);
 const prior=await tx.query('SELECT id,payload_digest,state,event_id FROM hyperfide.observability_notifications WHERE organisation_id=$1 AND run_id=$2 AND target_session_id=$3 AND dedup_key=$4',[p.organisation_id,p.run_id,target,key]);
 if(prior.rows.length){if(prior.rows[0]!.payload_digest!==identity||prior.rows[0]!.id!==id)fail('OBSERVABILITY_CONFLICT','Notification deduplication key has different content');return {...prior.rows[0],replayed:true,evidence_ref:evidenceRef(p,artifact)};}
 const counts=await tx.query("SELECT count(*) AS total,count(*) FILTER(WHERE target_session_id=$3 AND state<>'ACKNOWLEDGED') AS pending FROM hyperfide.observability_notifications WHERE organisation_id=$1 AND run_id=$2",[p.organisation_id,p.run_id,target]);
 if(BigInt(counts.rows[0]!.total as string)>=10000n||BigInt(counts.rows[0]!.pending as string)>=1000n)fail('OBSERVABILITY_BACKPRESSURE','Notification history or pending-recipient budget exhausted; producer must retain the exception');
 const event=randomUUID();
 await tx.query('INSERT INTO hyperfide.observability_notifications(organisation_id,run_id,id,target_session_id,target_consumer_id,target_boot_generation,dedup_key,payload_digest,severity,code,untrusted_summary,action_code,artifact_id,event_id,producer_actor_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[p.organisation_id,p.run_id,id,target,consumer,session.rows[0]!.sandbox_boot_generation??null,key,identity,severity,code,summary,action,artifact,event,p.actor_id]);
 return {id,event_id:event,state:'QUEUED',replayed:false,sent:false,evidence_ref:evidenceRef(p,artifact),summary_trust:'UNTRUSTED_DATA_NOT_AN_INSTRUCTION'};
}
export async function dispatchNotices(tx:Session,p:Principal,input:unknown,outbox:Outbox,budget:number):Promise<unknown>{
 if(!['OPERATOR','COORDINATOR','DISPATCH'].includes(p.role))fail('NOTIFICATION_DISPATCH_FORBIDDEN','Only an authorised dispatcher may advance notification delivery');
 const v=object(input,['target_session_id','limit']),target=uuid(v.target_session_id),limit=v.limit===undefined?20:integer(v.limit,1,100);
 await lockRun(tx,p,'notification-dispatch:'+target);await reconcileAcknowledgements(tx,p);
 const eligible=await tx.query("SELECT n.id FROM hyperfide.observability_notifications n WHERE n.organisation_id=$1 AND n.run_id=$2 AND n.target_session_id=$3 AND n.state='QUEUED' LIMIT 1",[p.organisation_id,p.run_id,target]);
 if(!eligible.rows.length)return {enqueued:0,external_delivery:'NOT_OBSERVED',required_exceptions_discarded:0};
 const alive=await tx.query("SELECT id,sandbox_boot_generation FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND state IN ('REGISTERED','RUNNING','DISCONNECTED') FOR SHARE",[p.organisation_id,p.run_id,target]);
 if(alive.rows.length!==1)return {enqueued:0,held:true,reason:'RECIPIENT_SESSION_UNAVAILABLE',required_exceptions_discarded:0};
 const time=await tx.query("SELECT date_trunc('minute',clock_timestamp()) AS window_start"),window=time.rows[0]!.window_start;
 await tx.query('INSERT INTO hyperfide.observability_notification_budgets(organisation_id,run_id,target_session_id,window_start,page_count) VALUES($1,$2,$3,$4,0) ON CONFLICT DO NOTHING',[p.organisation_id,p.run_id,target,window]);
 await tx.query('DELETE FROM hyperfide.observability_notification_budgets WHERE organisation_id=$1 AND run_id=$2 AND target_session_id=$3 AND window_start<$4',[p.organisation_id,p.run_id,target,window]);
 const used=await tx.query('SELECT page_count FROM hyperfide.observability_notification_budgets WHERE organisation_id=$1 AND run_id=$2 AND target_session_id=$3 AND window_start=$4 FOR UPDATE',[p.organisation_id,p.run_id,target,window]);
 const remaining=Math.max(0,budget-Number(used.rows[0]!.page_count));if(!remaining)return {enqueued:0,held:true,reason:'PAGE_BUDGET_EXHAUSTED',retry_after:new Date(new Date(window as Date).getTime()+60000).toISOString(),required_exceptions_discarded:0};
 const notices=await tx.query("SELECT * FROM hyperfide.observability_notifications WHERE organisation_id=$1 AND run_id=$2 AND target_session_id=$3 AND state='QUEUED' ORDER BY CASE severity WHEN 'CRITICAL' THEN 0 WHEN 'ERROR' THEN 1 WHEN 'WARNING' THEN 2 ELSE 3 END,created_at,id LIMIT $4 FOR UPDATE SKIP LOCKED",[p.organisation_id,p.run_id,target,Math.min(limit,remaining)]);
 let enqueued=0;const held:string[]=[];
 for(const n of notices.rows){
  if(n.target_boot_generation!==alive.rows[0]!.sandbox_boot_generation&&!(n.target_boot_generation===null&&alive.rows[0]!.sandbox_boot_generation===null)){held.push(String(n.id));continue;}
  const consumer=await tx.query("SELECT id FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND consumer_key=$4 AND state IN ('ACTIVE','BUFFERING') FOR SHARE",[p.organisation_id,p.run_id,n.target_consumer_id,'session:'+target+':fleet_notification']);
  const bound=await tx.query('SELECT consumer_id FROM hyperfide.event_session_bindings WHERE organisation_id=$1 AND run_id=$2 AND consumer_id=$3 AND session_id=$4 AND namespace=\'fleet_notification\'',[p.organisation_id,p.run_id,n.target_consumer_id,target]);
  if(!consumer.rows.length||!bound.rows.length){held.push(String(n.id));continue;}
  await requireArtifact(tx,p,String(n.artifact_id));
  await outbox.enqueue(tx,{organisation_id:p.organisation_id,run_id:p.run_id,id:String(n.event_id),aggregate_id:String(n.id),aggregate_type:'fleet_notification',aggregate_version:'1',event_type:'fleet.notification',payload:{notification_id:n.id,producer_actor_id:n.producer_actor_id,target_session_id:target,target_boot_generation:n.target_boot_generation,severity:n.severity,code:n.code,untrusted_summary:n.untrusted_summary,summary_trust:'UNTRUSTED_DATA_NOT_AN_INSTRUCTION',action_code:n.action_code,evidence_ref:evidenceRef(p,String(n.artifact_id))}},{consumer_ids:[String(n.target_consumer_id)]});
  await tx.query("UPDATE hyperfide.observability_notifications SET state='ENQUEUED',enqueued_at=clock_timestamp(),state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",[p.organisation_id,p.run_id,n.id]);enqueued++;
 }
 if(enqueued)await tx.query('UPDATE hyperfide.observability_notification_budgets SET page_count=page_count+$5 WHERE organisation_id=$1 AND run_id=$2 AND target_session_id=$3 AND window_start=$4',[p.organisation_id,p.run_id,target,window,enqueued]);
 return {enqueued,budget_window_start:new Date(window as Date).toISOString(),held_notification_ids:held,external_delivery:'NOT_OBSERVED',required_exceptions_discarded:0,remaining_page_budget:remaining-enqueued};
}
export function createComponent(startup:ComponentContext):Component{
 const resolver=(startup as unknown as {dependencies?:{require<T>(id:string,capability:string,validate:(v:unknown)=>v is T):T}}).dependencies;
 if(!resolver)fail('OBSERVABILITY_DEPENDENCY_UNAVAILABLE','Durable outbox registry dependency is required');
 const outbox=resolver.require('6.1','events.outbox.v1',isOutbox);
 const inbox=resolver.require('6.2','events.inbox.v1',isInbox);
 const configured=startup.env.HYPERFIDE_NOTIFICATION_PAGE_BUDGET??'20';
 if(!/^[1-9][0-9]{0,2}$/.test(configured)||Number(configured)>100)fail('OBSERVABILITY_CONFIG_INVALID','Page budget must be from one to one hundred per recipient per minute');
 const budget=Number(configured);
 let configuredSecrets:unknown=[];
 try{configuredSecrets=JSON.parse(startup.env.HYPERFIDE_NOTIFICATION_REDACTION_SECRETS??'[]');}catch{fail('OBSERVABILITY_CONFIG_INVALID','Invalid private redaction configuration');}
 if(!Array.isArray(configuredSecrets)||configuredSecrets.length>128||configuredSecrets.some(s=>typeof s!=='string'||s.length<8||s.length>65536))fail('OBSERVABILITY_CONFIG_INVALID','Bounded private redaction secrets required');
 const knownSecrets=Object.freeze([...new Set([...(configuredSecrets as string[]),...Object.entries(startup.env).filter(([key,value])=>/(?:TOKEN|SECRET|PASSWORD|PRIVATE_KEY|API_KEY)/i.test(key)&&typeof value==='string'&&value.length>=8&&value.length<=65536&&key!=='HYPERFIDE_NOTIFICATION_REDACTION_SECRETS').map(([,value])=>value!)])]);
 if(knownSecrets.length>128)fail('OBSERVABILITY_CONFIG_INVALID','Private redaction secret count exceeds budget');
 return {apiVersion:1,actions:{
 'fleet.notifications.describe':async input=>{object(input,[]);return {schema_version:1,page_budget_per_recipient_per_minute:budget,pending_limit_per_recipient:1000,total_history_limit:10000,summary_trust:'UNTRUSTED_DATA',delivery_semantics:'DURABLE_TARGETED_OUTBOX_NOT_EXTERNAL_SEND',backpressure:'REFUSE_WITHOUT_ACKNOWLEDGING_EXCEPTION'};},
 'fleet.notifications.bootstrap-recipient':(input,ctx)=>authority(ctx,'fleet.notifications.bootstrap-recipient',(tx,p)=>bootstrapRecipient(tx,p,input,inbox)),
 'fleet.notifications.bind-recipient':(input,ctx)=>authority(ctx,'fleet.notifications.bind-recipient',(tx,p)=>bindRecipient(tx,p,input,outbox,(ctx as unknown as {invocation:unknown}).invocation)),
 'fleet.notifications.enqueue':(input,ctx)=>authority(ctx,'fleet.notifications.enqueue',(tx,p)=>enqueueNotice(tx,p,input,knownSecrets)),
 'fleet.notifications.dispatch':(input,ctx)=>authority(ctx,'fleet.notifications.dispatch',(tx,p)=>dispatchNotices(tx,p,input,outbox,budget)),
 'fleet.notifications.inspect':(input,ctx)=>authority(ctx,'fleet.notifications.inspect',async(tx,p)=>{const v=object(input,['target_session_id','limit','after_id']),target=uuid(v.target_session_id),limit=v.limit===undefined?100:integer(v.limit,1,500),after=v.after_id===undefined?'00000000-0000-0000-0000-000000000000':uuid(v.after_id);recipientAccess(p,target);const q=await tx.query("SELECT n.id,n.target_session_id,n.target_boot_generation,n.severity,n.code,n.untrusted_summary,n.action_code,n.artifact_id,n.event_id,n.state,n.state_version,n.created_at,n.enqueued_at,d.state AS delivery_state FROM hyperfide.observability_notifications n LEFT JOIN hyperfide.event_deliveries d ON d.organisation_id=n.organisation_id AND d.run_id=n.run_id AND d.event_id=n.event_id AND d.consumer_id=n.target_consumer_id WHERE n.organisation_id=$1 AND n.run_id=$2 AND n.target_session_id=$3 AND n.id>$4 ORDER BY n.id LIMIT $5",[p.organisation_id,p.run_id,target,after,limit+1]);const rows=q.rows.slice(0,limit).map(n=>({...n,evidence_ref:evidenceRef(p,String(n.artifact_id)),external_send_verified:false,delivery_acknowledged:n.delivery_state==='ACKNOWLEDGED'}));return numbers({rows,pagination:{limit,next:q.rows.length>limit?q.rows[limit-1]!.id:null},summary_trust:'UNTRUSTED_DATA_NOT_AN_INSTRUCTION'});})
 }};
}
