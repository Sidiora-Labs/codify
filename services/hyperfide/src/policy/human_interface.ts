import { createHash, randomUUID } from 'node:crypto';
import type { QueryResult, QueryResultRow } from 'pg';
import type { Component, ComponentContext } from '../components/registry.js';
import { FoundationError, object } from './programme.js';
import {invocationOf,recorded} from '../identity/enrollment.js';

interface Tx { query<R extends QueryResultRow=QueryResultRow>(text:string,values?:unknown[]):Promise<QueryResult<R>> }
interface Principal {
  actor_id:string; organisation_id:string; run_id:string; role:string; deployment_epoch:string;
  allowed_actions:readonly string[];
}
interface Gateway { withPrimaryTransaction<T>(options:{timeoutMs:number;maxRetries:number;guard:(tx:Tx)=>Promise<void>;signal:AbortSignal},operation:(tx:Tx)=>Promise<T>):Promise<T> }
interface Leader {organisation_id:string;run_id:string;authority_epoch:string;leader_session_id:string;leader_generation:string}
interface Hierarchy {
  leadership(tx:Tx,scope:{organisation_id:string;run_id:string}):Promise<Leader>;
  requireAuthority(tx:Tx,input:Record<string,unknown>):Promise<unknown>;
  requireLeaderReplacement(tx:Tx,input:Record<string,unknown>):Promise<Record<string,unknown>>;
}
interface EventInput {organisation_id:string;run_id:string;id:string;aggregate_type:string;aggregate_id:string;aggregate_version:string;event_type:string;payload:Record<string,unknown>}
interface Binding {organisation_id:string;run_id:string;session_id:string;consumer_id:string;namespace:string;consumer_state:string;session_role:string;session_state:string}
interface Outbox {
 enqueue(tx:Tx,event:EventInput,options:{consumer_ids:string[]}):Promise<{event:unknown;replayed:boolean;obligations:number}>;
 resolveSessionConsumer(tx:Tx,input:Record<string,unknown>):Promise<Binding|null>;
 lookupConsumerBinding(tx:Tx,input:Record<string,unknown>):Promise<Binding|null>;
}
interface Inbox {
 receive(tx:Tx,input:Record<string,unknown>,apply:(tx:Tx,event:EventInput)=>Promise<unknown>):Promise<{status:string;event_id:string;inbox_id:string;result:unknown}>;
 bootstrapConsumer(tx:Tx,input:Record<string,unknown>,build:(tx:Tx)=>Promise<unknown>):Promise<unknown>;
 supersedeDelivery(tx:Tx,input:Record<string,unknown>,proof:(tx:Tx,events:{original:EventInput;replacement:EventInput})=>Promise<Record<string,unknown>>):Promise<Record<string,unknown>>;
}

type RuntimeContext = ComponentContext & {
  invocation?:{principal:Principal;guard(tx:Tx):Promise<void>};
}
const routineOperations=['schedule','provision','repair','retry','review','qualification'] as const;
type RoutineOperation=typeof routineOperations[number];
// Approved run policy names the agent-owned executor path for each routine operation. Admission requires that
// executor action to be approved in the programme policy, so no per-task human approval or worker prompt exists.
const routineExecutors:Readonly<Record<RoutineOperation,{component:string;action:string}>>=Object.freeze({
  schedule:{component:'5.1',action:'scheduler.claim'},
  provision:{component:'1.4',action:'programme.provision'},
  repair:{component:'finding-remediation',action:'finding.repair.request'},
  retry:{component:'1.4',action:'programme.dispatch'},
  review:{component:'17.3',action:'review.obligation.claim'},
  qualification:{component:'16.2',action:'qualification.job.claim'}});
const autonomousRoles=['LEADER','FEATURE_MANAGER','COORDINATOR','PROVISIONER','DISPATCH'];
const routineConsumerRoles=['COORDINATOR','PROVISIONER','DISPATCH','LEADER'];
// Leader intent deliberately uses the 6.1 outbox and 6.2 inbox rather than the 6.3 instruction protocol: 6.3 instructions
// are bound to an implementation attempt, sandbox boot generation and runner consumer, while the primary leader is an
// agent session. Generation binding is preserved here by leader_generation/authority_epoch in each immutable payload,
// the private session-bound human_intent consumer, and explicit supersession (human.adopt) on leader replacement.
// Routine executors hand worker work to runners through 6.3 themselves; this interface never prompts a worker.
function refuse(message:string):never{throw new FoundationError('HUMAN_INTERFACE_DENIED',message);}
function exact(input:unknown,keys:string[]):Record<string,unknown>{
  if(!object(input)||Object.keys(input).length!==keys.length||keys.some(key=>!Object.hasOwn(input,key)))refuse('Human interface fields are invalid');
  return input;
}
function uuid(value:unknown):string{if(typeof value!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value))refuse('Scoped identity is invalid');return value;}
function generation(value:unknown):string{if(typeof value!=='string'||!/^[1-9][0-9]{0,18}$/.test(value)||BigInt(value)>9223372036854775807n)refuse('Ownership generation is invalid');return value;}
function canonical(value:unknown):string{
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  if(object(value))return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}';
  if(value===null||typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))return JSON.stringify(value);
  return refuse('Intent is not canonical JSON');
}
function capability<T>(context:RuntimeContext,id:string,name:string,methods:string[]):T{
  if(!context.dependencies)refuse('Authoritative runtime dependencies are unavailable');
  return context.dependencies.require(id,name,(value):value is T=>object(value)&&methods.every(method=>typeof value[method]==='function'));
}
function principal(context:RuntimeContext,action:string):Principal{
  const value=invocationOf(context).principal;
  if(!value||!Array.isArray(value.allowed_actions)||!value.allowed_actions.includes(action))refuse('An authenticated scoped caller is required');
  uuid(value.actor_id);uuid(value.organisation_id);uuid(value.run_id);uuid(value.deployment_epoch);
  if(value.run_id!==context.policy.programme_id)refuse('Caller belongs to another approved programme');
  return value;
}
export interface IntentInput {request_id:string;idempotency_key:string;expected_leader_generation:string;kind:'INTENT'|'CRITERIA'|'PROGRAMME_CHANGE'|'UNRESOLVED_INTENT'|'ROUTINE';package_id:string|null;package_generation:string|null;payload:Record<string,unknown>}
export function validateIntent(input:unknown):IntentInput{
  const value=exact(input,['request_id','idempotency_key','expected_leader_generation','kind','package_id','package_generation','payload']);
  if(typeof value.idempotency_key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.idempotency_key)||
      !['INTENT','CRITERIA','PROGRAMME_CHANGE','UNRESOLVED_INTENT','ROUTINE'].includes(value.kind as string)||!object(value.payload)||
      Buffer.byteLength(canonical(value.payload))>131072)refuse('Intent request is invalid');
  if((value.package_id===null)!==(value.package_generation===null))refuse('Package ownership binding is incomplete');
  return {request_id:uuid(value.request_id),idempotency_key:value.idempotency_key,expected_leader_generation:generation(value.expected_leader_generation),
    kind:value.kind as IntentInput['kind'],package_id:value.package_id===null?null:uuid(value.package_id),
    package_generation:value.package_generation===null?null:generation(value.package_generation),payload:value.payload};
}
async function leaderConsumer(tx:Tx,outbox:Outbox,actor:Principal,session:string):Promise<Binding> {
 const binding=await outbox.resolveSessionConsumer(tx,{organisation_id:actor.organisation_id,run_id:actor.run_id,session_id:session,namespace:'human_intent'});
 if(!binding||binding.session_role!=='LEADER'||!['ACTIVE','BUFFERING'].includes(binding.consumer_state))refuse('Current leader has no registered private human-intent consumer');
 return binding;
}
function routineConsumerKey(operation:string):string{return 'autonomous:routine.'+operation;}
// Routine recipients are durable run-scoped consumers registered through 6.1, never caller- or environment-supplied.
async function autonomousConsumer(tx:Tx,actor:Principal,operation:string):Promise<string> {
 const found=await tx.query<{id:string}>("SELECT id FROM hyperfide.event_consumers WHERE organisation_id=$1 AND run_id=$2 AND consumer_key=$3 AND state IN ('ACTIVE','BUFFERING')",
   [actor.organisation_id,actor.run_id,routineConsumerKey(operation)]);
 if(found.rowCount!==1)refuse('Approved autonomous executor has no registered durable consumer');
 return uuid(found.rows[0]!.id);
}
function policyApproval(context:RuntimeContext,operation:RoutineOperation):Record<string,unknown> {
 const executor=routineExecutors[operation],policy=context.policy;
 if(!policy.allowed_actions.includes('routine.'+operation)||!policy.allowed_actions.includes(executor.action))
   refuse('Routine operation is outside the approved autonomous policy');
 return {source:'APPROVED_RUN_POLICY',policy_revision:policy.policy_revision,approval_record_id:policy.approval.record_id,
   spec_revision:policy.spec_revision,executor_component:executor.component,executor_action:executor.action};
}
async function route(context:RuntimeContext,action:string,input:IntentInput,autonomousOperation:string|null):Promise<Record<string,unknown>>{
  const actor=principal(context,action);
  const gateway=capability<Gateway>(context,'4.2','storage.transactions.v1',['withPrimaryTransaction']);
  const invocation=invocationOf(context);
  if(!invocation||typeof invocation.guard!=='function')refuse('Authenticated transaction guard is unavailable');
  const hierarchy=capability<Hierarchy>(context,'3.1','hierarchy.authority.v1',['leadership','requireAuthority']);
  const outbox=capability<Outbox>(context,'6.1','events.outbox.v1',['enqueue','resolveSessionConsumer','lookupConsumerBinding']);
  return gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:context.signal,guard:tx=>invocation.guard(tx)},async tx=>recorded(tx,actor.actor_id,'envelope.'+action,invocation.operation,async()=>{
    const run=await tx.query<{state:string;authority_epoch:string}>(
      'SELECT state,authority_epoch::text FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2 FOR SHARE',[actor.organisation_id,actor.run_id]);
    if(run.rowCount!==1||run.rows[0]!.authority_epoch!==actor.deployment_epoch)refuse('Run authority changed');
    if(autonomousOperation!==null&&run.rows[0]!.state!=='RUNNING')refuse('Routine work is not admitted while the run is quiescent');
    const leader=await hierarchy.leadership(tx,{organisation_id:actor.organisation_id,run_id:actor.run_id});
    if(leader.authority_epoch!==actor.deployment_epoch||leader.leader_generation!==input.expected_leader_generation)
      refuse('Leader ownership changed; reconcile the current leader');
    if(action==='human.submit'&&input.kind==='ROUTINE')refuse('Routine work must use the autonomous interface');
    if(action==='human.submit'&&actor.role!=='OPERATOR'&&(actor.role!=='LEADER'||actor.actor_id!==leader.leader_session_id))
      refuse('Programme interaction must pass through the registered primary leader');
    if(autonomousOperation!==null&&(!autonomousRoles.includes(actor.role)||!actor.allowed_actions.includes('routine.'+autonomousOperation)))
      refuse('Routine operation is outside the approved autonomous policy');
    const approval=autonomousOperation===null?null:policyApproval(context,autonomousOperation as RoutineOperation);
    if(action==='human.escalate'&&input.kind!=='UNRESOLVED_INTENT')refuse('Agent escalation cannot silently change programme intent');
    if(!['OPERATOR','COORDINATOR','PROVISIONER','DISPATCH'].includes(actor.role))await hierarchy.requireAuthority(tx,{organisation_id:actor.organisation_id,run_id:actor.run_id,authority_epoch:actor.deployment_epoch,
      session_id:actor.actor_id,leader_generation:leader.leader_generation,
      roles:action==='human.submit'?['LEADER']:['LEADER','FEATURE_MANAGER','WORKER','COMMIT_WATCHER','ISSUE_WATCHER','VERIFIER','INTEGRATOR','INDEXER'],
      ...(input.package_id===null?{}:{package_id:input.package_id,package_generation:input.package_generation})});
    const consumerIds=[autonomousOperation===null?(await leaderConsumer(tx,outbox,actor,leader.leader_session_id)).consumer_id:await autonomousConsumer(tx,actor,autonomousOperation)];
    const payload={schema_version:1,request_id:input.request_id,kind:input.kind,payload:input.payload,
      source_actor_id:actor.actor_id,source_role:actor.role,target:autonomousOperation===null?'PRIMARY_LEADER':'AUTONOMOUS_CONTROL',
      target_session_id:autonomousOperation===null?leader.leader_session_id:null,target_consumer_id:autonomousOperation===null?consumerIds[0]:null,observed_leader_session_id:leader.leader_session_id,
      leader_generation:leader.leader_generation,authority_epoch:actor.deployment_epoch,package_id:input.package_id,
      package_generation:input.package_generation,autonomous_operation:autonomousOperation,approval,
      // Intent is resolved by the primary leader; routine work is admitted only by the approved run policy.
      requires_human_prompt:autonomousOperation===null?false:approval?.source!=='APPROVED_RUN_POLICY'};
    const requestDigest='sha256:'+createHash('sha256').update(canonical({action,input,actor_id:actor.actor_id})).digest('hex');
    const scope='actor:'+actor.actor_id;
    await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[canonical({organisation_id:actor.organisation_id,run_id:actor.run_id,scope,action,idempotency_key:input.idempotency_key})]);
    const prior=await tx.query<{request_digest:string;result:Record<string,unknown>|null;state:string}>(
      'SELECT request_digest,result,state FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation=$4 AND idempotency_key=$5 FOR UPDATE',
      [actor.organisation_id,actor.run_id,scope,action,input.idempotency_key]);
    if(prior.rowCount){
      if(prior.rows[0]!.request_digest!==requestDigest)refuse('Idempotency key is already bound to different intent');
      if(prior.rows[0]!.state!=='COMPLETED'||!prior.rows[0]!.result)refuse('Prior intent outcome requires reconciliation');
      return {...prior.rows[0]!.result,replayed:true};
    }
    const command=randomUUID(),eventId=randomUUID();
    await tx.query('INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [actor.organisation_id,actor.run_id,command,scope,action,input.idempotency_key,requestDigest]);
    const queued=await outbox.enqueue(tx,{organisation_id:actor.organisation_id,run_id:actor.run_id,id:eventId,
      aggregate_type:autonomousOperation===null?'human_command':'autonomous_command',aggregate_id:command,aggregate_version:'1',
      event_type:autonomousOperation===null?'leader.intent.requested':'routine.operation.requested',payload},{consumer_ids:consumerIds});
    if(autonomousOperation===null)await tx.query(`INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result)
      VALUES($1,$2,$3,'human_intent','human.intent.state',$4,$5,'COMPLETED',$6::jsonb)`,
      [actor.organisation_id,actor.run_id,randomUUID(),eventId,requestDigest,canonical({state:'PENDING',root_event_id:eventId,current_event_id:eventId,target_session_id:leader.leader_session_id,target_consumer_id:consumerIds[0],leader_generation:leader.leader_generation,authority_epoch:actor.deployment_epoch})]);
    const result={status:'ENQUEUED',command_id:command,event_id:eventId,leader_session_id:leader.leader_session_id,
      leader_generation:leader.leader_generation,delivery_obligations:queued.obligations,requires_human_prompt:payload.requires_human_prompt,
      approval,intent_authorized:false,replayed:false};
    await tx.query("UPDATE hyperfide.command_inbox SET state='COMPLETED',result=$4::jsonb,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND id=$3",
      [actor.organisation_id,actor.run_id,command,JSON.stringify(result)]);
    return result;
  }));
}

// Intent processing is a separate durable projection. Transport receipts never close it;
// completion records an authenticated leader report, without independent evidence qualification.
interface IntentState {state:'PENDING'|'LEADER_REPORTED_COMPLETE';root_event_id:string;current_event_id:string;target_session_id:string;target_consumer_id:string;leader_generation:string;authority_epoch:string;[key:string]:unknown}
function digest(value:unknown):string{return 'sha256:'+createHash('sha256').update(canonical(value)).digest('hex');}
function scope(actor:Principal):{organisation_id:string;run_id:string}{return {organisation_id:actor.organisation_id,run_id:actor.run_id};}
async function intentState(tx:Tx,actor:Principal,root:string,lock:boolean):Promise<IntentState>{
 const result=await tx.query<{result:IntentState}>(`SELECT result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope='human_intent' AND operation='human.intent.state' AND idempotency_key=$3 AND state='COMPLETED'${lock?' FOR UPDATE':''}`,[actor.organisation_id,actor.run_id,root]);
 if(result.rowCount!==1||!object(result.rows[0]!.result))refuse('No attributable logical human-intent state exists');
 return result.rows[0]!.result;
}
async function sourceEvent(tx:Tx,actor:Principal,id:string):Promise<EventInput>{
 const result=await tx.query<EventInput & QueryResultRow>('SELECT organisation_id,run_id,id,aggregate_type,aggregate_id,aggregate_version::text,event_type,payload FROM hyperfide.outbox_events WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[actor.organisation_id,actor.run_id,id]);
 const event=result.rows[0];
 if(!event||!((event.aggregate_type==='human_command'&&event.event_type==='leader.intent.requested')||(event.aggregate_type==='human_intent_transfer'&&event.event_type==='leader.intent.adopted'))||event.aggregate_version!=='1'||!object(event.payload)||event.payload.target!=='PRIMARY_LEADER')refuse('No scoped attributable human-intent source exists');
 uuid(event.payload.target_session_id);uuid(event.payload.target_consumer_id);generation(event.payload.leader_generation);uuid(event.payload.authority_epoch);
 return event;
}
async function currentLeader(tx:Tx,hierarchy:Hierarchy,actor:Principal,expected:string):Promise<Leader>{
 if(actor.role!=='LEADER')refuse('Only the actual current primary leader can process human intents');
 const leader=await hierarchy.leadership(tx,scope(actor));
 if(leader.leader_session_id!==actor.actor_id||leader.leader_generation!==expected||leader.authority_epoch!==actor.deployment_epoch)refuse('Current primary leader authority changed');
 await hierarchy.requireAuthority(tx,{...scope(actor),session_id:actor.actor_id,authority_epoch:actor.deployment_epoch,leader_generation:expected,roles:['LEADER']});
 return leader;
}
async function sourceProof(tx:Tx,hierarchy:Hierarchy,outbox:Outbox,actor:Principal,leader:Leader,event:EventInput):Promise<Record<string,unknown>>{
 const p=event.payload,binding=await outbox.lookupConsumerBinding(tx,{...scope(actor),consumer_id:p.target_consumer_id});
 if(!binding||binding.namespace!=='human_intent'||binding.session_id!==p.target_session_id||binding.session_role!=='LEADER')refuse('Original intent recipient has no immutable session binding');
 if(p.target_session_id===leader.leader_session_id&&p.leader_generation===leader.leader_generation&&p.authority_epoch===leader.authority_epoch)
   return {authority:'CURRENT_PRIMARY_LEADER',leader_session_id:leader.leader_session_id,leader_generation:leader.leader_generation,authority_epoch:leader.authority_epoch};
 return hierarchy.requireLeaderReplacement(tx,{...scope(actor),actor_session_id:actor.actor_id,current_leader_generation:leader.leader_generation,
   predecessor_session_id:p.target_session_id,predecessor_generation:p.leader_generation,predecessor_authority_epoch:p.authority_epoch});
}
async function processing(context:RuntimeContext,action:string,input:unknown):Promise<unknown>{
 const actor=principal(context,action),invocation=invocationOf(context);
 const gateway=capability<Gateway>(context,'4.2','storage.transactions.v1',['withPrimaryTransaction']);
 const hierarchy=capability<Hierarchy>(context,'3.1','hierarchy.authority.v1',['leadership','requireAuthority','requireLeaderReplacement']);
 const outbox=capability<Outbox>(context,'6.1','events.outbox.v1',['enqueue','resolveSessionConsumer','lookupConsumerBinding']);
 const inbox=capability<Inbox>(context,'6.2','events.inbox.v1',['bootstrapConsumer','supersedeDelivery']);
 const bootstrap=action==='human.bootstrap',complete=action==='human.intent.complete';
 const v=exact(input,bootstrap?['bootstrap_id','expected_leader_generation','limit']:complete?['event_id','expected_leader_generation','evidence_digest']:['event_id','expected_leader_generation']);
 const expected=generation(v.expected_leader_generation);
 if(bootstrap&&(!Number.isSafeInteger(v.limit)||Number(v.limit)<1||Number(v.limit)>128))refuse('Human snapshot bound is invalid');
 if(complete&&(typeof v.evidence_digest!=='string'||!/^sha256:[0-9a-f]{64}$/.test(v.evidence_digest)))refuse('Completion report requires an attributable evidence digest');
 return gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:context.signal,guard:tx=>invocation.guard(tx)},async tx=>recorded(tx,actor.actor_id,'envelope.'+action,invocation.operation,async()=>{
  const leader=await currentLeader(tx,hierarchy,actor,expected),binding=await leaderConsumer(tx,outbox,actor,leader.leader_session_id);
  if(bootstrap)return inbox.bootstrapConsumer(tx,{...scope(actor),bootstrap_id:uuid(v.bootstrap_id),consumer_id:binding.consumer_id,aggregate_types:['human_command','human_intent_transfer'],limit:v.limit},async tx=>{
   const pending=await tx.query<{result:IntentState}>(`SELECT result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope='human_intent' AND operation='human.intent.state' AND state='COMPLETED' AND result->>'state'='PENDING' ORDER BY idempotency_key LIMIT $3`,[actor.organisation_id,actor.run_id,Number(v.limit)+1]);
   if(pending.rows.length>Number(v.limit))refuse('Pending human-intent snapshot exceeds its declared bound');
   const descriptors=[];
   for(const item of pending.rows){const e=await sourceEvent(tx,actor,item.result.current_event_id);const proof=await sourceProof(tx,hierarchy,outbox,actor,leader,e);descriptors.push({root_event_id:item.result.root_event_id,event_id:e.id,event_digest:digest(e),target_session_id:e.payload.target_session_id,leader_generation:e.payload.leader_generation,authority_epoch:e.payload.authority_epoch,proof_digest:digest(proof)});}
   return {schema_version:1,namespace:'human_intent',leader_session_id:leader.leader_session_id,leader_generation:leader.leader_generation,pending:descriptors,task_completed:false,intent_authorized:false,retention:'SOURCE_EVENTS_RETAINED'};
  });
  const event=await sourceEvent(tx,actor,uuid(v.event_id)),root=event.aggregate_type==='human_command'?event.id:uuid(event.payload.original_event_id);
  const adoptionKey=event.id+':'+expected+':'+actor.deployment_epoch;
  if(action==='human.adopt'){
   const previous=await tx.query<{result:Record<string,unknown>}>(`SELECT result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation='human.intent.adopt' AND idempotency_key=$4 AND state='COMPLETED'`,[actor.organisation_id,actor.run_id,actor.actor_id,adoptionKey]);
   if(previous.rowCount)return {...previous.rows[0]!.result,replayed:true};
  }
  const state=await intentState(tx,actor,root,action!=='human.intent.read');
  if(state.current_event_id!==event.id)refuse('Intent source has already advanced through an explicit transfer');
  const proof=await sourceProof(tx,hierarchy,outbox,actor,leader,event);
  if(action==='human.intent.read')return {event,state:state.state,authority:'CURRENT_PRIMARY_LEADER',task_completed:false,intent_authorized:false};
  if(state.state!=='PENDING'){
   if(complete&&state.completion_event_id===event.id&&state.completion_evidence_digest===v.evidence_digest)return {state:'LEADER_REPORTED_COMPLETE',replayed:true,historical:true,reported_by:state.completion_actor_id,qualified:false,evidence_verified:false,programme_completed:false};
   refuse('Logical human intent is no longer pending');
  }
  if(complete){
   if(event.payload.target_session_id!==leader.leader_session_id||event.payload.leader_generation!==leader.leader_generation||event.payload.authority_epoch!==leader.authority_epoch)refuse('Only the current explicit intent target may report completion; adopt first');
   const result={...state,state:'LEADER_REPORTED_COMPLETE',completion_event_id:event.id,completion_evidence_digest:v.evidence_digest,completion_actor_id:actor.actor_id,completion_authority_epoch:actor.deployment_epoch};
   await tx.query(`UPDATE hyperfide.command_inbox SET result=$4::jsonb,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND principal_scope='human_intent' AND operation='human.intent.state' AND idempotency_key=$3`,[actor.organisation_id,actor.run_id,root,canonical(result)]);
   return {state:'LEADER_REPORTED_COMPLETE',replayed:false,qualified:false,evidence_verified:false,programme_completed:false,evidence_digest:v.evidence_digest};
  }
  if(proof.authority!=='LEADER_REPLACEMENT_PROOF')refuse('Adoption requires a proven newer primary leader generation');
  const transfer=randomUUID(),replacementId=randomUUID(),payload={schema_version:1,target:'PRIMARY_LEADER',target_session_id:leader.leader_session_id,target_consumer_id:binding.consumer_id,
   leader_generation:leader.leader_generation,authority_epoch:leader.authority_epoch,supersedes_event_id:event.id,original_event_id:root,
   original_intent:event.aggregate_type==='human_command'?event.payload:event.payload.original_intent,
   replacement_proof:proof,requires_human_prompt:false,intent_authorized:false};
  const queued=await outbox.enqueue(tx,{...scope(actor),id:replacementId,aggregate_type:'human_intent_transfer',aggregate_id:transfer,aggregate_version:'1',event_type:'leader.intent.adopted',payload},{consumer_ids:[binding.consumer_id]});
  const receipt=await inbox.supersedeDelivery(tx,{...scope(actor),transfer_id:transfer,original_event_id:event.id,original_consumer_id:uuid(event.payload.target_consumer_id),replacement_event_id:replacementId,replacement_consumer_id:binding.consumer_id},async(tx,events)=>{
   const locked=await intentState(tx,actor,root,true);
   if(locked.state!=='PENDING'||locked.current_event_id!==events.original.id||events.replacement.id!==replacementId)refuse('Intent is no longer a pending attributable source');
   const refreshed=await currentLeader(tx,hierarchy,actor,expected),currentBinding=await leaderConsumer(tx,outbox,actor,refreshed.leader_session_id);
   if(currentBinding.consumer_id!==binding.consumer_id)refuse('Replacement recipient changed');
   return {replacement_proof:await sourceProof(tx,hierarchy,outbox,actor,refreshed,events.original),recipient_binding:currentBinding,logical_intent_state:'PENDING',root_event_id:root};
  });
  await tx.query(`UPDATE hyperfide.command_inbox SET result=$4::jsonb,state_version=state_version+1 WHERE organisation_id=$1 AND run_id=$2 AND principal_scope='human_intent' AND operation='human.intent.state' AND idempotency_key=$3`,[actor.organisation_id,actor.run_id,root,canonical({...state,current_event_id:replacementId,target_session_id:leader.leader_session_id,target_consumer_id:binding.consumer_id,leader_generation:leader.leader_generation,authority_epoch:leader.authority_epoch})]);
  const result={status:'ADOPTED',event_id:replacementId,root_event_id:root,source_event_id:event.id,transfer_id:transfer,delivery_obligations:queued.obligations,receipt,task_completed:false,intent_authorized:false,replayed:false};
  await tx.query(`INSERT INTO hyperfide.command_inbox(organisation_id,run_id,id,principal_scope,operation,idempotency_key,request_digest,state,result) VALUES($1,$2,$3,$4,'human.intent.adopt',$5,$6,'COMPLETED',$7::jsonb)`,[actor.organisation_id,actor.run_id,randomUUID(),actor.actor_id,adoptionKey,digest({source_event_id:event.id,leader_generation:expected,actor_id:actor.actor_id}),canonical(result)]);
  return result;
 }));
}
// The autonomous control consumer admits a routed routine request exactly once through the 6.2 inbox. Programme intent
// can never be consumed here: it is only ever delivered to the leader's session-bound human_intent consumer.
async function routineReceive(context:RuntimeContext,input:unknown):Promise<unknown>{
 const actor=principal(context,'human.routine.receive'),invocation=invocationOf(context);
 if(!routineConsumerRoles.includes(actor.role))refuse('Only autonomous control services consume routine work');
 const v=exact(input,['event_id','operation']);
 if(typeof v.operation!=='string'||!routineOperations.includes(v.operation as RoutineOperation))refuse('Routine operation is unknown');
 const operation=v.operation as RoutineOperation,eventId=uuid(v.event_id);
 const gateway=capability<Gateway>(context,'4.2','storage.transactions.v1',['withPrimaryTransaction']);
 const inbox=capability<Inbox>(context,'6.2','events.inbox.v1',['receive']);
 return gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:context.signal,guard:tx=>invocation.guard(tx)},async tx=>{
  const consumer=await autonomousConsumer(tx,actor,operation);
  const received=await inbox.receive(tx,{...scope(actor),event_id:eventId,consumer_id:consumer},async(_tx,event)=>{
   const p=event.payload;
   if(event.aggregate_type!=='autonomous_command'||event.event_type!=='routine.operation.requested'||p.target!=='AUTONOMOUS_CONTROL'||
       p.autonomous_operation!==operation||p.target_session_id!==null||p.kind!=='ROUTINE')refuse('Only approved routine work reaches autonomous control');
   const approval=policyApproval(context,operation);
   if(!object(p.approval)||canonical(p.approval)!==canonical(approval))refuse('Approved run policy changed since admission; re-route through the primary leader');
   return {admitted:true,operation,executor_component:approval.executor_component,executor_action:approval.executor_action,
     approval_source:approval.source,policy_revision:approval.policy_revision,request_id:p.request_id,package_id:p.package_id,
     consumed_by_actor_id:actor.actor_id,consumed_by_role:actor.role,human_prompts:0,requires_human_prompt:false};
  });
  return {status:received.status,event_id:received.event_id,inbox_id:received.inbox_id,admission:received.result};
 });
}
export function createComponent(_context:ComponentContext):Component{
  return {apiVersion:1,actions:{
    'human.adopt':(input,context)=>processing(context as RuntimeContext,'human.adopt',input),
    'human.bootstrap':(input,context)=>processing(context as RuntimeContext,'human.bootstrap',input),
    'human.intent.read':(input,context)=>processing(context as RuntimeContext,'human.intent.read',input),
    'human.intent.complete':(input,context)=>processing(context as RuntimeContext,'human.intent.complete',input),
    'human.routine.receive':(input,context)=>routineReceive(context as RuntimeContext,input),
    'human.describe':async(input,context)=>{
      exact(input,[]);
      const runtime=context as RuntimeContext,actor=principal(runtime,'human.describe'),invocation=invocationOf(runtime);
      const gateway=capability<Gateway>(runtime,'4.2','storage.transactions.v1',['withPrimaryTransaction']);
      const hierarchy=capability<Hierarchy>(runtime,'3.1','hierarchy.authority.v1',['leadership','requireAuthority']);
      return gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:context.signal,guard:tx=>invocation.guard(tx)},async tx=>{
        const leader=await hierarchy.leadership(tx,{organisation_id:actor.organisation_id,run_id:actor.run_id});
        if(leader.authority_epoch!==actor.deployment_epoch)refuse('Primary leader belongs to an obsolete authority epoch');
        return {...leader,authority:'NONE',intent_authorized:false,execution_started:false};
      });
    },
    'human.status':async(input,context)=>{
      const value=exact(input,['operation','idempotency_key']);
      if(!['human.submit','human.escalate','human.autonomous'].includes(value.operation as string)||
          typeof value.idempotency_key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.idempotency_key))
        refuse('Historical intent lookup is invalid');
      const runtime=context as RuntimeContext,actor=principal(runtime,'human.status'),invocation=invocationOf(runtime);
      if(!invocation||typeof invocation.guard!=='function')refuse('Authenticated transaction guard is unavailable');
      const gateway=capability<Gateway>(runtime,'4.2','storage.transactions.v1',['withPrimaryTransaction']);
      return gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:context.signal,guard:tx=>invocation.guard(tx)},async tx=>{
        const found=await tx.query<{state:string;result:Record<string,unknown>|null}>(
          'SELECT state,result FROM hyperfide.command_inbox WHERE organisation_id=$1 AND run_id=$2 AND principal_scope=$3 AND operation=$4 AND idempotency_key=$5',
          [actor.organisation_id,actor.run_id,'actor:'+actor.actor_id,value.operation,value.idempotency_key]);
        return {status:found.rowCount?found.rows[0]!.state:'NOT_FOUND',result:found.rowCount?found.rows[0]!.result:null,
          historical:true,authority:'NONE',execution_started:false};
      });
    },
    'human.submit':(input,context)=>route(context as RuntimeContext,'human.submit',validateIntent(input),null),
    'human.escalate':(input,context)=>route(context as RuntimeContext,'human.escalate',validateIntent(input),null),
    'human.autonomous':(input,context)=>{
      const value=exact(input,['operation','intent']);
      if(typeof value.operation!=='string'||!routineOperations.includes(value.operation as RoutineOperation))
        refuse('This operation requires leader intent resolution');
      const intent=validateIntent(value.intent);
      if(intent.kind!=='ROUTINE')refuse('Routine operations cannot amend programme criteria');
      return route(context as RuntimeContext,'human.autonomous',intent,value.operation);
    }
  }};
}
