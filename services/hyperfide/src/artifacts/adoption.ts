import {createHash} from 'node:crypto';
import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {readSemanticDisposition,writeSemanticDisposition} from '../storage/dispositions.js';
import {assertInvocation,strictJSON} from '../transport/protocol.js';
import type {InvocationContext} from '../transport/protocol.js';
import {loadExecutionPacket,deriveQualificationInputs,isPacketAuthority} from '../hierarchy/packets.js';
import type {ContinuationBinding} from '../hierarchy/packets.js';
import {leadership,requireAuthority} from '../hierarchy/packages.js';
import {assertCompleteArtifactReferences} from './objects.js';
import {readCheckpointContinuation} from './continuation.js';
import {environmentRecipe,sessionPrecheck,sessionRecipe,sourceRecipe,sourceUnchanged} from './checkpoint-recipes.js';
import type {CheckpointLineage,NativeResumeRequest} from './checkpoint-recipes.js';
import {FoundationError} from '../policy/programme.js';
import {assertCurrentCompute,parseComputeToken} from '../scheduler/leases.js';
import type {ComputeToken} from '../scheduler/leases.js';

type Invocation=InvocationContext;
type Context=ComponentContext;
type Artifacts={invoke:(action:string,input:unknown,context:ComponentContext)=>Promise<unknown>};
type Sessions={resumeCheck:(input:unknown,context:InvocationContext)=>Promise<unknown>};
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const DIGEST=/^sha256:[0-9a-f]{64}$/;
function fail(code:string,message:string):never{throw new FoundationError(code,message);}
function record(value:unknown):Record<string,unknown>{if(!value||typeof value!=='object'||Array.isArray(value))fail('ADOPTION_INPUT_INVALID','Expected an object');return value as Record<string,unknown>;}
function exact(value:unknown,required:string[],optional:string[]=[]):Record<string,unknown>{const row=record(value);if(required.some(key=>!Object.hasOwn(row,key))||Object.keys(row).some(key=>![...required,...optional].includes(key)))fail('ADOPTION_INPUT_INVALID','Adoption fields differ');return row;}
function uuid(value:unknown):string{if(typeof value!=='string'||!UUID.test(value))fail('ADOPTION_INPUT_INVALID','Expected UUID');return value;}
function digest(value:unknown):string{if(typeof value!=='string'||!DIGEST.test(value))fail('ADOPTION_INPUT_INVALID','Expected SHA-256 digest');return value;}
function byteCount(value:unknown):string{if(typeof value!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(value)||BigInt(value)>1073741824n)fail('CHECKPOINT_CONTEXT_MISMATCH','Bounded context byte count required');return value;}
function canonical(value:unknown):string{
 if(value===null||typeof value!=='object')return JSON.stringify(value);
 if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
 return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';
}
function capability(value:unknown):value is Artifacts{return !!value&&typeof value==='object'&&'invoke' in value&&typeof value.invoke==='function';}
function sessionCapability(value:unknown):value is Sessions{return !!value&&typeof value==='object'&&'resumeCheck' in value&&typeof value.resumeCheck==='function';}
type Request={token:ComputeToken;source_checkpoint_id:string;source_expected_artifact_digest:string;target_expected_input_packet_digest:string;target_expected_preparation_digest:string;mode:'SOURCE_ONLY'|'NATIVE_RESUME';native_resume:Record<string,unknown>|null};
function parse(input:unknown):Request{
 const row=exact(input,['token','source_checkpoint_id','source_expected_artifact_digest','target_expected_input_packet_digest','target_expected_preparation_digest','mode','native_resume']);
 if(row.mode!=='SOURCE_ONLY'&&row.mode!=='NATIVE_RESUME')fail('ADOPTION_INPUT_INVALID','Unsupported adoption mode');
 const token=parseComputeToken(structuredClone(row.token));
 let native:Record<string,unknown>|null=null;
 if(row.mode==='NATIVE_RESUME'){
 native=exact(structuredClone(row.native_resume),['session_id','native_session_id','configuration_digest','source_manifest_digest']);
 uuid(native.session_id);digest(native.configuration_digest);digest(native.source_manifest_digest);
 if(typeof native.native_session_id!=='string'||native.native_session_id.length<1||native.native_session_id.length>256||/[\x00-\x1f]/.test(native.native_session_id))fail('ADOPTION_INPUT_INVALID','Invalid exact native session identity');
 }else if(row.native_resume!==null)fail('ADOPTION_INPUT_INVALID','Source-only adoption has no native session resume');
 return {token,source_checkpoint_id:uuid(row.source_checkpoint_id),source_expected_artifact_digest:digest(row.source_expected_artifact_digest),target_expected_input_packet_digest:digest(row.target_expected_input_packet_digest),target_expected_preparation_digest:digest(row.target_expected_preparation_digest),mode:row.mode,native_resume:native};
}
type Checkpoint=CheckpointLineage;
const checkpointSQL="SELECT c.id,c.artifact_id,c.attempt_id,c.attempt_generation::text,c.repository_id,c.source_object_id,c.input_packet_digest,c.support_level,c.agent_session_id,c.registration_operation_id,c.preparation_digest,c.artifact_content_digest,c.source_metadata_digest,a.digest,a.status,s.compute_authority AS source_compute_authority,s.input_packet_digest AS source_packet_digest,s.task_id AS source_task_id,(s.lease_expires_at IS NULL OR s.lease_expires_at<=clock_timestamp()) AS source_expired FROM hyperfide.checkpoints c JOIN hyperfide.artifacts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.artifact_id JOIN hyperfide.attempts s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.attempt_id AND s.generation=c.attempt_generation WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3";
export class ArtifactAdoption{
 constructor(private readonly context:Context){}
 private async targetActor(tx:PrimaryTransaction,token:ComputeToken,actor:Invocation):Promise<void>{
 const t=token as unknown as Record<string,unknown>,p=actor.principal;
 if(['OPERATOR','COORDINATOR','PROVISIONER'].includes(p.role))return;
 if(p.role==='WORKER'){
 if(p.attempt_id!==t.attempt_id||p.attempt_generation!==t.attempt_generation||p.sandbox_id!==t.sandbox_id||p.boot_generation!==t.sandbox_boot_generation)fail('ADOPTION_ACTOR_SCOPE_DENIED','Worker checkpoint authority belongs to its exact current attempt');
 return;
 }
 if(p.role==='RUNNER'){
 if(p.sandbox_id!==t.sandbox_id||p.boot_generation!==t.sandbox_boot_generation)fail('ADOPTION_ACTOR_SCOPE_DENIED','Runner checkpoint authority belongs to its exact boot');
 return;
 }
 if(p.role!=='LEADER'&&p.role!=='FEATURE_MANAGER')fail('ADOPTION_ROLE_DENIED','Checkpoint mutation requires execution or management authority');
 const scope={organisation_id:p.organisation_id,run_id:p.run_id},leader=await leadership(tx,scope);
 const task=(await tx.query('SELECT t.feature_package_id,h.owner_generation::text FROM hyperfide.tasks t JOIN hyperfide.hierarchy_packages h ON h.organisation_id=t.organisation_id AND h.run_id=t.run_id AND h.package_id=t.feature_package_id WHERE t.organisation_id=$1 AND t.run_id=$2 AND t.id=$3 FOR SHARE OF t,h',[p.organisation_id,p.run_id,t.task_id])).rows[0];
 if(!task)fail('ADOPTION_ACTOR_SCOPE_DENIED','Current target package is unavailable');
 await requireAuthority(tx,{...scope,authority_epoch:String(t.authority_epoch),session_id:p.actor_id,leader_generation:leader.leader_generation,package_id:task.feature_package_id,package_generation:task.owner_generation,roles:['LEADER','FEATURE_MANAGER']});
 }

 private authority(request:Request):Invocation{
 const actor=this.context.invocation;
 assertInvocation(actor);
 const token=request.token as unknown as Record<string,unknown>;
 if(actor.principal.organisation_id!==token.organisation_id||actor.principal.run_id!==token.run_id)fail('ADOPTION_SCOPE_DENIED','Adoption target differs from verified caller scope');
 return actor;
 }
 private async transaction<T>(actor:Invocation,body:(tx:PrimaryTransaction)=>Promise<T>,identityOnly=false):Promise<T>{
 const guard=identityOnly?actor.identityGuard:actor.guard;
 return this.context.resources.gateway.withPrimaryTransaction({timeoutMs:10000,maxRetries:2,signal:actor.signal,guard:async tx=>{await (identityOnly?readSemanticDisposition:writeSemanticDisposition)(tx,actor.principal);await guard(tx);}},async tx=>{const value=await body(tx);await guard(tx);return value;});
 }
 private async checkpoint(tx:PrimaryTransaction,request:Request):Promise<Checkpoint>{
 const token=request.token as unknown as Record<string,unknown>;
 const result=await tx.query<Checkpoint>(checkpointSQL,[token.organisation_id,token.run_id,request.source_checkpoint_id]);
 const row=result.rows[0];if(!row)fail('ADOPTION_CHECKPOINT_MISSING','Source checkpoint is unavailable');
 sourceRecipe(row,{task_id:String(token.task_id),attempt_id:String(token.attempt_id),attempt_generation:String(token.attempt_generation)},request.source_expected_artifact_digest);
 return row;
 }
 private async prior(tx:PrimaryTransaction,actor:Invocation,payload:string):Promise<Record<string,unknown>|undefined>{
 const result=await tx.query('SELECT * FROM hyperfide.artifact_adoptions WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3',[actor.principal.organisation_id,actor.principal.run_id,actor.operation.operation_id]);
 const row=result.rows[0];if(row&&(row.payload_digest!==payload||record(row.provenance).authority_actor_id!==actor.principal.actor_id))fail('ADOPTION_REPLAY_CONFLICT','Operation identity is bound to another payload');
 return row;
 }
 async adopt(input:unknown,commit:boolean):Promise<unknown>{
 const request=parse(input),actor=this.authority(request),token=request.token as unknown as Record<string,unknown>,payload='sha256:'+createHash('sha256').update(canonical(request)).digest('hex');
 const replay=await this.transaction(actor,tx=>this.prior(tx,actor,payload),true);
 if(replay)return {adoption:replay,replayed:true,compute_authority_changed:false,context_restored:false,grants_authority:false};
 const initial=await this.transaction(actor,async tx=>{
 const prior=await this.prior(tx,actor,payload);if(prior)return {prior,checkpoint:null};
 await this.targetActor(tx,request.token,actor);
 await assertCurrentCompute(tx,request.token,{operation:'CHECKPOINT'});
 return {prior:undefined,checkpoint:await this.checkpoint(tx,request)};
 });
 if(initial.prior)return {adoption:initial.prior,replayed:true,compute_authority_changed:false,context_restored:false,grants_authority:false};
 const source=initial.checkpoint!;
 sessionPrecheck(source,request.mode,request.native_resume as NativeResumeRequest|null,request.target_expected_input_packet_digest);
 const artifacts=this.context.dependencies.require('15.2','artifact.store.v1',capability);
 const verified=record(await artifacts.invoke('artifact.object.inspect',{organisation_id:token.organisation_id,run_id:token.run_id,artifact_id:source.artifact_id},this.context));
 if(verified.outcome!=='SUCCEEDED'||verified.availability!=='VERIFIED'||verified.receipt===null)fail('ADOPTION_ARTIFACT_UNAVAILABLE','Source bytes are not verified available');
 let resume:Record<string,unknown>|null=null;
 if(request.mode==='NATIVE_RESUME'){
 const sessions=this.context.dependencies.require('13.2','agent.sessions.v1',sessionCapability);
 resume=record(await sessions.resumeCheck({scope:{organisation_id:token.organisation_id,run_id:token.run_id,session_id:request.native_resume!.session_id},checkpoint_id:source.id,native_session_id:request.native_resume!.native_session_id,configuration_digest:request.native_resume!.configuration_digest,source_manifest_digest:request.native_resume!.source_manifest_digest},actor));
 }
 const session=sessionRecipe(source,request.mode,resume);
 return this.transaction(actor,async tx=>{
 const existing=await this.prior(tx,actor,payload);if(existing)return {adoption:existing,replayed:true,compute_authority_changed:false,context_restored:false,grants_authority:false};
 await this.targetActor(tx,request.token,actor);
 const target=record(await assertCurrentCompute(tx,request.token,{operation:'CHECKPOINT'}));
 const environment=environmentRecipe(source,request.mode,{input_packet_digest:String(target.input_packet_digest),preparation_digest:String(target.preparation_digest)},{input_packet_digest:request.target_expected_input_packet_digest,preparation_digest:request.target_expected_preparation_digest});
 const packet=await loadExecutionPacket(tx,{organisation_id:String(token.organisation_id),run_id:String(token.run_id),digest:String(target.input_packet_digest)});
 const continuation=record(record(record(packet.packet).mandatory).intent).continuation;
 const expectedContinuation=await readCheckpointContinuation(tx,{organisation_id:String(token.organisation_id),run_id:String(token.run_id),checkpoint_id:source.id},actor);
 if(!continuation||canonical(continuation)!==canonical(expectedContinuation))fail('ADOPTION_CONTINUATION_REQUIRED','Target packet must pin the exact immutable checkpoint and context before claim');
 const current=await this.checkpoint(tx,request);
 const sourceOutcome=sourceRecipe(current,{task_id:String(token.task_id),attempt_id:String(token.attempt_id),attempt_generation:String(token.attempt_generation)},request.source_expected_artifact_digest);
 sourceUnchanged(source,current);
 if((await tx.query('SELECT id FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND status=\'COMPLETE\' FOR SHARE',[token.organisation_id,token.run_id,current.artifact_id])).rowCount!==1)fail('ADOPTION_ARTIFACT_UNAVAILABLE','Checkpoint artifact ceased to be complete');
 const compatibility={recipes:[sourceOutcome,session,environment],source_packet_digest:source.input_packet_digest,target_packet_digest:target.input_packet_digest,source_preparation_digest:source.preparation_digest,target_preparation_digest:target.preparation_digest,source_context_preserved:false,native_resume_eligible:request.mode==='NATIVE_RESUME',native_session_reused:session.verdict==='COMPATIBLE',requires_rebuild:environment.verdict==='REBUILD_REQUIRED',resume_check:resume};
 const provenance={authority_actor_id:actor.principal.actor_id,source_checkpoint_id:source.id,source_attempt_id:source.attempt_id,source_generation:source.attempt_generation,source_artifact_id:source.artifact_id,source_artifact_digest:source.digest,source_content_digest:source.artifact_content_digest,source_metadata_digest:source.source_metadata_digest,source_preparation_digest:source.preparation_digest,source_repository_id:source.repository_id,source_object_id:source.source_object_id,source_agent_session_id:source.agent_session_id,source_support_level:source.support_level,source_compute_authority:source.source_compute_authority,source_authority_restored:false,trust:'UNTRUSTED_HISTORY'};
 if(!commit)return {valid:true,compatibility,provenance,compute_authority_changed:false,context_restored:false,grants_authority:false};
 const result=await tx.query("INSERT INTO hyperfide.artifact_adoptions(organisation_id,run_id,operation_id,payload_digest,source_checkpoint_id,source_artifact_id,source_attempt_id,source_generation,target_attempt_id,target_generation,repository_id,source_object_id,input_packet_digest,preparation_digest,mode,compatibility,provenance) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING *",[token.organisation_id,token.run_id,actor.operation.operation_id,payload,source.id,source.artifact_id,source.attempt_id,source.attempt_generation,token.attempt_id,token.attempt_generation,source.repository_id,source.source_object_id,target.input_packet_digest,target.preparation_digest,request.mode,JSON.stringify(compatibility),JSON.stringify(provenance)]);
 return {adoption:result.rows[0],replayed:false,compute_authority_changed:false,context_restored:false,grants_authority:false};
 });
 }
 async registerCheckpoint(input:unknown,stale:boolean):Promise<unknown>{
 const value=exact(input,['token','workspace_id','artifact_id','expected_capsule_digest','expected_source_metadata_digest','context_artifacts']);
 const contextInput=exact(structuredClone(value.context_artifacts),['dependency_artifact_id','summary_artifact_id','findings_artifact_id']);
 const contextIds={dependency:uuid(contextInput.dependency_artifact_id),summary:uuid(contextInput.summary_artifact_id),findings:uuid(contextInput.findings_artifact_id)};
 const token=parseComputeToken(structuredClone(value.token));
 const actor=this.context.invocation;assertInvocation(actor);
 const t=token as unknown as Record<string,unknown>,scope={organisation_id:uuid(t.organisation_id),run_id:uuid(t.run_id)};
 if(scope.organisation_id!==actor.principal.organisation_id||scope.run_id!==actor.principal.run_id)fail('ADOPTION_SCOPE_DENIED','Checkpoint differs from verified caller scope');
 const workspaceId=uuid(value.workspace_id),artifactId=uuid(value.artifact_id),capsuleDigest=digest(value.expected_capsule_digest),metadataDigest=digest(value.expected_source_metadata_digest);
 const payload='sha256:'+createHash('sha256').update(canonical({kind:stale?'STALE_IMPORT':'LIVE',...value})).digest('hex');
 const prior=async(tx:PrimaryTransaction)=>{
 const row=(await tx.query('SELECT * FROM hyperfide.checkpoints WHERE organisation_id=$1 AND run_id=$2 AND registration_operation_id=$3',[scope.organisation_id,scope.run_id,actor.operation.operation_id])).rows[0];
 if(row&&(row.registration_payload_digest!==payload||row.registration_actor_id!==actor.principal.actor_id))fail('CHECKPOINT_REPLAY_CONFLICT','Checkpoint operation is bound to another actor or payload');
 return row;
 };
 const replay=await this.transaction(actor,prior,true);
 if(replay)return {checkpoint:replay,replayed:true,durability:'VERIFIED',grants_authority:false,context_restored:false};
 await this.transaction(actor,async tx=>{await this.targetActor(tx,token,actor);await assertCurrentCompute(tx,token,{operation:'CHECKPOINT'});});
 const artifacts=this.context.dependencies.require('15.2','artifact.store.v1',capability);
 const verified=record(await artifacts.invoke('artifact.manifest.read',{...scope,artifact_id:artifactId},this.context));
 if(verified.outcome!=='SUCCEEDED'||verified.availability!=='VERIFIED'||verified.receipt===null)fail('CHECKPOINT_ARTIFACT_UNAVAILABLE','Checkpoint manifest bytes are not verified');
 const manifest=record(verified.manifest),artifact=record(verified.artifact);
 if(artifact.status!=='COMPLETE'||manifest.content_digest!==capsuleDigest||!Array.isArray(manifest.chunks))fail('CHECKPOINT_ARTIFACT_INVALID','Checkpoint capsule identity differs');
 const totalText=manifest.total_size_bytes;
 if(typeof totalText!=='string'||!/^[1-9][0-9]{0,9}$/.test(totalText)||BigInt(totalText)>134217728n)fail('CHECKPOINT_CAPSULE_INVALID','Checkpoint capsule exceeds native bounds');
 const total=Number(totalText);let prefix=Buffer.alloc(0),needed=40;let metadataLength=0;
 for(const item of manifest.chunks){
 const chunk=record(item);
 const read=record(await artifacts.invoke('artifact.object.read',{...scope,artifact_id:uuid(chunk.artifact_id)},this.context));
 if(read.outcome!=='SUCCEEDED'||read.availability!=='VERIFIED'||typeof read.data_base64!=='string')fail('CHECKPOINT_ARTIFACT_UNAVAILABLE','Checkpoint metadata chunk is unavailable');
 const bytes=Buffer.from(read.data_base64,'base64');
 prefix=Buffer.concat([prefix,bytes.subarray(0,Math.min(bytes.length,65576-prefix.length))]);
 if(prefix.length>=40&&needed===40){
 if(prefix.subarray(0,8).toString('ascii')!=='HFCP0001')fail('CHECKPOINT_CAPSULE_INVALID','Checkpoint capsule header differs');
 const lengths=[8,16,24,32].map(offset=>prefix.readBigUInt64BE(offset));
 if(lengths[0]!>65536n||lengths[3]!>67108864n||40n+lengths.reduce((a,b)=>a+b,0n)!==BigInt(total))fail('CHECKPOINT_CAPSULE_INVALID','Checkpoint section bounds differ');
 metadataLength=Number(lengths[0]);if(metadataLength<2)fail('CHECKPOINT_CAPSULE_INVALID','Checkpoint metadata is empty');
 needed=40+metadataLength;
 }
 if(prefix.length>=needed&&needed>40)break;
 }
 if(prefix.length<needed||needed===40)fail('CHECKPOINT_CAPSULE_INVALID','Checkpoint metadata is incomplete');
 const metadataBytes=prefix.subarray(40,40+metadataLength);
 if('sha256:'+createHash('sha256').update(metadataBytes).digest('hex')!==metadataDigest||metadataBytes.some(byte=>byte<0x20||byte>0x7e))fail('CHECKPOINT_METADATA_INVALID','Exact native metadata digest or encoding differs');
 const keys=['schema_version','capture_scope','consistency','organisation_id','run_id','repository_id','task_id','attempt_id','workspace_id','base_commit','head_commit','branch_ref','preparation_digest','dependency_digest','summary_digest','findings_digest','instruction_cursor','native_support','native_session_ref','workspace_mode','index_scope','ignored_disposition','authority'];
 const metadata=exact(strictJSON(metadataBytes,65536),keys);
 if(Object.values(metadata).some(item=>typeof item!=='string')||metadata.schema_version!=='1'||metadata.capture_scope!=='GIT_AND_NONIGNORED_WORKTREE'||metadata.consistency!=='STABLE_SCAN_REQUIRES_SUPERVISOR_QUIESCENCE'||metadata.index_scope!=='STAGED_TREE_NOT_LOCAL_INDEX_FLAGS'||metadata.ignored_disposition!=='EXCLUDED_NOT_RECOVERED'||metadata.authority!=='NONE')fail('CHECKPOINT_METADATA_INVALID','Native metadata contract differs');
 for(const key of ['organisation_id','run_id','repository_id','task_id','attempt_id','workspace_id'])uuid(metadata[key]);
 for(const key of ['preparation_digest','dependency_digest','summary_digest','findings_digest'])digest(metadata[key]);
 for(const key of ['base_commit','head_commit'])if(!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/.test(String(metadata[key])))fail('CHECKPOINT_METADATA_INVALID','Native Git object identity differs');
 if(!/^refs\/heads\/[^\x00-\x20~^:?*\\[]+$/.test(String(metadata.branch_ref))||String(metadata.branch_ref).includes('..')||String(metadata.branch_ref).endsWith('/')||!/^(0|[1-9][0-9]{0,18})$/.test(String(metadata.instruction_cursor))||!/^[0-9]{1,4}$/.test(String(metadata.workspace_mode)))fail('CHECKPOINT_METADATA_INVALID','Native branch or cursor differs');
 if(!['RECORDED','UNSUPPORTED'].includes(String(metadata.native_support))||(metadata.native_session_ref!==''&&!UUID.test(String(metadata.native_session_ref))))fail('CHECKPOINT_METADATA_INVALID','Native session metadata differs');
 if(metadata.organisation_id!==scope.organisation_id||metadata.run_id!==scope.run_id||metadata.task_id!==t.task_id||metadata.workspace_id!==workspaceId)fail('CHECKPOINT_SCOPE_DENIED','Native checkpoint scope differs');
 const contextFacts=await Promise.all((['dependency','summary','findings'] as const).map(async role=>{
 const id=contextIds[role],observation=record(await artifacts.invoke('artifact.object.inspect',{...scope,artifact_id:id},this.context));
 const object=record(observation.artifact??{}),receipt=record(observation.receipt??{});
 if(observation.outcome!=='SUCCEEDED'||observation.availability!=='VERIFIED'||object.status!=='COMPLETE'||object.artifact_id!==id||object.organisation_id!==scope.organisation_id||object.run_id!==scope.run_id)fail('CHECKPOINT_CONTEXT_UNAVAILABLE','Context artifact bytes are unavailable');
 const manifest=observation.manifest===undefined?null:record(observation.manifest);
 const contentDigest=digest(manifest?manifest.content_digest:object.digest),contentSize=byteCount(manifest?manifest.total_size_bytes:object.size_bytes);
 if(contentDigest!==metadata[role+'_digest'])fail('CHECKPOINT_CONTEXT_MISMATCH','Context bytes differ from native checkpoint metadata');
 return {role,artifact_id:id,artifact_digest:digest(object.digest),artifact_size_bytes:byteCount(object.size_bytes),receipt_id:digest(receipt.receipt_id),storage_kind:manifest?'manifest':'object',content_digest:contentDigest,content_size_bytes:contentSize};
 }));

 return this.transaction(actor,async tx=>{
 const previous=await prior(tx);if(previous)return {checkpoint:previous,replayed:true,durability:'VERIFIED',grants_authority:false,context_restored:false};
 await this.targetActor(tx,token,actor);
 const current=record(await assertCurrentCompute(tx,token,{operation:'CHECKPOINT'}));
 const workspace=(await tx.query('SELECT * FROM hyperfide.workspaces WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,workspaceId])).rows[0];
 if(!workspace||workspace.repository_id!==metadata.repository_id||workspace.attempt_id!==metadata.attempt_id||workspace.base_commit!==metadata.base_commit||workspace.branch_ref!==metadata.branch_ref)fail('CHECKPOINT_WORKSPACE_INVALID','Actual source workspace differs');
 const source=(await tx.query('SELECT *,generation::text,clock_timestamp() AS primary_now FROM hyperfide.attempts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,workspace.attempt_id])).rows[0];
 if(!source||source.task_id!==t.task_id||String(source.generation)!==String(workspace.attempt_generation))fail('CHECKPOINT_WORKSPACE_INVALID','Actual source attempt lineage differs');
 if(!stale){
 if(source.id!==t.attempt_id||String(source.generation)!==String(t.attempt_generation)||workspace.state!=='ACTIVE'||workspace.writable!==true||workspace.sandbox_id!==t.sandbox_id||workspace.slot_id!==t.slot_id||String(workspace.sandbox_boot_generation)!==String(t.sandbox_boot_generation)||current.input_packet_digest!==source.input_packet_digest||current.preparation_digest!==metadata.preparation_digest)fail('CHECKPOINT_AUTHORITY_INVALID','Live checkpoint workspace or execution provenance differs');
 }else{
 if(source.id===t.attempt_id||source.compute_authority==='CURRENT'&&source.lease_expires_at&&new Date(source.lease_expires_at)>new Date(source.primary_now))fail('CHECKPOINT_SOURCE_ACTIVE','Stale import requires a distinct inactive producer');
 }
 const execution=await loadExecutionPacket(tx,{organisation_id:scope.organisation_id,run_id:scope.run_id,digest:String(source.input_packet_digest)});
 if(deriveQualificationInputs(execution.packet).dependency_digest!==metadata.dependency_digest)fail('CHECKPOINT_PROVENANCE_INVALID','Native dependency identity differs from the immutable execution packet');
 await assertCompleteArtifactReferences(tx,scope,contextFacts.map(fact=>({artifact_id:fact.artifact_id,receipt_id:fact.receipt_id,digest:fact.artifact_digest,size_bytes:fact.artifact_size_bytes})));
 if(record(record(record(execution.packet).mandatory).runtime).preparation_digest!==metadata.preparation_digest)fail('CHECKPOINT_PROVENANCE_INVALID','Historical source preparation differs from immutable input packet');
 const object=(await tx.query('SELECT object_id FROM hyperfide.source_objects WHERE organisation_id=$1 AND repository_id=$2 AND object_id=$3 AND object_type=\'commit\' FOR SHARE',[scope.organisation_id,metadata.repository_id,metadata.head_commit])).rows[0];
 if(!object)fail('CHECKPOINT_SOURCE_UNREGISTERED','Checkpoint Git object is not registered for this repository');
 let sessionId:string|null=null;
 if(metadata.native_session_ref!==''){
 sessionId=uuid(metadata.native_session_ref);
 const session=(await tx.query('SELECT id FROM hyperfide.agent_sessions WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND attempt_id=$4 AND sandbox_id=$5 AND slot_id=$6 AND sandbox_boot_generation=$7 FOR SHARE',[scope.organisation_id,scope.run_id,sessionId,source.id,workspace.sandbox_id,workspace.slot_id,workspace.sandbox_boot_generation])).rows[0];
 if(!session)fail('CHECKPOINT_SESSION_INVALID','Native source session does not match its actual producer workspace');
 }
 const complete=(await tx.query("SELECT id FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3 AND digest=$4 AND status='COMPLETE' FOR SHARE",[scope.organisation_id,scope.run_id,artifactId,artifact.digest])).rows[0];
 if(!complete)fail('CHECKPOINT_ARTIFACT_UNAVAILABLE','Verified manifest ceased to be complete');
 const row=(await tx.query("INSERT INTO hyperfide.checkpoints(organisation_id,run_id,attempt_id,attempt_generation,agent_session_id,artifact_id,repository_id,source_object_id,input_packet_digest,support_level,artifact_content_digest,source_metadata_digest,preparation_digest,dependency_digest,source_manifest,registration_operation_id,registration_payload_digest,registration_actor_id,registration_kind,source_workspace_id,artifact_content_size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING *",[scope.organisation_id,scope.run_id,source.id,source.generation,sessionId,artifactId,metadata.repository_id,metadata.head_commit,source.input_packet_digest,sessionId&&metadata.native_support==='RECORDED'?'NATIVE_RESUME':'SOURCE_ONLY',capsuleDigest,metadataDigest,metadata.preparation_digest,metadata.dependency_digest,JSON.stringify(metadata),actor.operation.operation_id,payload,actor.principal.actor_id,stale?'STALE_IMPORT':'LIVE',workspaceId,total])).rows[0];
 if(!row)fail('CHECKPOINT_REGISTRATION_FAILED','Checkpoint registration did not persist');
 for(const fact of contextFacts)await tx.query('INSERT INTO hyperfide.checkpoint_context_artifacts(organisation_id,run_id,checkpoint_id,role,artifact_id,artifact_digest,artifact_size_bytes,receipt_id,storage_kind,content_digest,content_size_bytes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',[scope.organisation_id,scope.run_id,row.id,fact.role,fact.artifact_id,fact.artifact_digest,fact.artifact_size_bytes,fact.receipt_id,fact.storage_kind,fact.content_digest,fact.content_size_bytes]);
 return {checkpoint:row,replayed:false,durability:'VERIFIED',source_git_semantics:'NOT_QUALIFIED',compute_authority_changed:false,context_restored:false,grants_authority:false};
 });
 }

 async inspectCheckpoint(input:unknown):Promise<unknown>{
 const value=exact(input,['organisation_id','run_id','checkpoint_id']),actor=this.context.invocation;assertInvocation(actor);
 const scope={organisation_id:uuid(value.organisation_id),run_id:uuid(value.run_id)};
 if(scope.organisation_id!==actor.principal.organisation_id||scope.run_id!==actor.principal.run_id)fail('CHECKPOINT_SCOPE_DENIED','Checkpoint differs from verified caller scope');
 const row=await this.transaction(actor,async tx=>{
 const result=(await tx.query('SELECT c.*,a.digest AS artifact_digest,a.status AS artifact_status FROM hyperfide.checkpoints c JOIN hyperfide.artifacts a ON a.organisation_id=c.organisation_id AND a.run_id=c.run_id AND a.id=c.artifact_id WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3',[scope.organisation_id,scope.run_id,uuid(value.checkpoint_id)])).rows[0];
 if(!result||!result.registration_operation_id)fail('CHECKPOINT_NOT_REGISTERED','Checkpoint lacks verified registration');
 if(result.artifact_status!=='COMPLETE')fail('CHECKPOINT_ARTIFACT_UNAVAILABLE','Checkpoint manifest is not complete');
 return result;
 },true);
 const artifacts=this.context.dependencies.require('15.2','artifact.store.v1',capability);
 const result=record(await artifacts.invoke('artifact.manifest.read',{...scope,artifact_id:row.artifact_id},this.context));
 const manifest=record(result.manifest??{}),artifact=record(result.artifact??{});
 if(result.outcome!=='SUCCEEDED'||result.availability!=='VERIFIED'||result.receipt===null||artifact.digest!==row.artifact_digest||manifest.content_digest!==row.artifact_content_digest)fail('CHECKPOINT_ARTIFACT_UNAVAILABLE','Registered checkpoint bytes are not verified');
 await this.transaction(actor,async()=>undefined,true);
 return {checkpoint:row,artifact:result.artifact,receipt:result.receipt,manifest,availability:'VERIFIED',durability:'VERIFIED',source_git_semantics:'NOT_QUALIFIED',context_restored:false,grants_authority:false};
 }

}
export interface ArtifactAdoptionCapability{
 adopt(input:unknown,context:ComponentContext|InvocationContext):Promise<unknown>;
 validate(input:unknown,context:ComponentContext|InvocationContext):Promise<unknown>;
 registerCheckpoint(input:unknown,context:ComponentContext|InvocationContext):Promise<unknown>;
 importCheckpoint(input:unknown,context:ComponentContext|InvocationContext):Promise<unknown>;
 inspectCheckpoint(input:unknown,context:ComponentContext|InvocationContext):Promise<unknown>;
}
export function isArtifactAdoptionCapability(value:unknown):value is ArtifactAdoptionCapability{
 if(!value||typeof value!=='object')return false;const row=value as Record<string,unknown>;
 return ['adopt','validate','registerCheckpoint','importCheckpoint','inspectCheckpoint'].every(name=>typeof row[name]==='function');
}
export function createComponent(context:ComponentContext):Component{
 // The packet producer refuses continuation pins until the checkpoint service
 // installs its historical reader; without it no replacement can adopt.
 context.dependencies.require('3.2','hierarchy.packets.v1',isPacketAuthority).installContinuationReader(async(tx,scope,invocation)=>await readCheckpointContinuation(tx,scope,invocation) as unknown as ContinuationBinding);
 const bind=(request:ComponentContext|InvocationContext):ArtifactAdoption=>{
 const actor='principal' in request?request:request.invocation;assertInvocation(actor);
 return new ArtifactAdoption({...context,invocation:actor});
 };
 const capability:ArtifactAdoptionCapability=Object.freeze({
 adopt:(input:unknown,request:ComponentContext|InvocationContext)=>bind(request).adopt(input,true),
 validate:(input:unknown,request:ComponentContext|InvocationContext)=>bind(request).adopt(input,false),
 registerCheckpoint:(input:unknown,request:ComponentContext|InvocationContext)=>bind(request).registerCheckpoint(input,false),
 importCheckpoint:(input:unknown,request:ComponentContext|InvocationContext)=>bind(request).registerCheckpoint(input,true),
 inspectCheckpoint:(input:unknown,request:ComponentContext|InvocationContext)=>bind(request).inspectCheckpoint(input)
 });
 return {apiVersion:1,capabilities:{'artifact.adoption.v1':capability},actions:{
 'artifact.adoption.validate':(input:unknown,request:ComponentContext|InvocationContext)=>capability.validate(input,request),
 'artifact.adoption.adopt':(input:unknown,request:ComponentContext|InvocationContext)=>capability.adopt(input,request),
 'artifact.checkpoint.register':(input:unknown,request:ComponentContext|InvocationContext)=>capability.registerCheckpoint(input,request),
 'artifact.checkpoint.import':(input:unknown,request:ComponentContext|InvocationContext)=>capability.importCheckpoint(input,request),
 'artifact.checkpoint.inspect':(input:unknown,request:ComponentContext|InvocationContext)=>capability.inspectCheckpoint(input,request)
 }};
}
