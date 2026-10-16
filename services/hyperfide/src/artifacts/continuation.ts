import type {PrimaryTransaction} from '../storage/transactions.js';
import {assertPrimaryTransaction} from '../storage/transactions.js';
import {readSemanticDisposition} from '../storage/dispositions.js';
import type {InvocationContext} from '../transport/protocol.js';
import {assertInvocation} from '../transport/protocol.js';
import {FoundationError} from '../policy/programme.js';
export interface CheckpointArtifactBinding{
 readonly artifact_id:string;readonly artifact_digest:string;readonly artifact_size_bytes:string;
 readonly storage_kind:'object'|'manifest';readonly content_digest:string;readonly content_size_bytes:string;
}
export interface CheckpointContinuation{
 readonly schema_version:1;readonly checkpoint_id:string;readonly artifact:CheckpointArtifactBinding;
 readonly source:{readonly attempt_id:string;readonly attempt_generation:string;readonly task_id:string;readonly workspace_id:string;
 readonly repository_id:string;readonly source_object_id:string;readonly input_packet_digest:string;readonly preparation_digest:string;
 readonly source_metadata_digest:string;readonly dependency_digest:string;readonly agent_session_id:string|null;readonly support_level:'NATIVE_RESUME'|'SOURCE_ONLY'|'UNSUPPORTED'};
 readonly context_artifacts:{readonly dependency:CheckpointArtifactBinding;readonly summary:CheckpointArtifactBinding;readonly findings:CheckpointArtifactBinding};
 readonly instruction_cursor:string;readonly authority:'NONE';readonly context_restored:false;
}
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function fail():never{throw new FoundationError('CHECKPOINT_CONTINUATION_UNAVAILABLE','Registered immutable checkpoint context is unavailable');}
/** Called only inside the packet producer's guarded primary transaction.
 * COMPLETE pins registered byte identities; this performs no external health
 * check and does not grant restore, process or target-attempt authority. */
export async function readCheckpointContinuation(tx:PrimaryTransaction,input:{organisation_id:string;run_id:string;checkpoint_id:string},invocation:InvocationContext):Promise<CheckpointContinuation>{
 assertPrimaryTransaction(tx);assertInvocation(invocation);
 const scope={organisation_id:input.organisation_id,run_id:input.run_id,checkpoint_id:input.checkpoint_id};
 if(Object.values(scope).some(value=>typeof value!=='string'||!uuid.test(value))||scope.organisation_id!==invocation.principal.organisation_id||scope.run_id!==invocation.principal.run_id)fail();
 await readSemanticDisposition(tx,invocation.principal);await invocation.identityGuard(tx);
 const checkpoint=(await tx.query("SELECT c.*,c.attempt_generation::text,c.artifact_content_size_bytes::text,s.task_id FROM hyperfide.checkpoints c JOIN hyperfide.attempts s ON s.organisation_id=c.organisation_id AND s.run_id=c.run_id AND s.id=c.attempt_id AND s.generation=c.attempt_generation WHERE c.organisation_id=$1 AND c.run_id=$2 AND c.id=$3 FOR SHARE OF c,s",[scope.organisation_id,scope.run_id,scope.checkpoint_id])).rows[0];
 if(!checkpoint?.registration_operation_id||checkpoint.artifact_content_size_bytes===null||!checkpoint.source_workspace_id)fail();
 const contexts=(await tx.query("SELECT *,artifact_size_bytes::text,content_size_bytes::text FROM hyperfide.checkpoint_context_artifacts WHERE organisation_id=$1 AND run_id=$2 AND checkpoint_id=$3 ORDER BY role FOR SHARE",[scope.organisation_id,scope.run_id,scope.checkpoint_id])).rows;
 if(contexts.length!==3||new Set(contexts.map(row=>row.role)).size!==3)fail();
 const ids=[checkpoint.artifact_id,...contexts.map(row=>row.artifact_id)];
 const artifacts=(await tx.query('SELECT id,digest,size_bytes::text,status FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=ANY($3::uuid[]) ORDER BY id FOR SHARE',[scope.organisation_id,scope.run_id,ids])).rows;
 const byId=new Map(artifacts.map(row=>[row.id,row]));
 const parent=byId.get(checkpoint.artifact_id);if(parent?.status!=='COMPLETE')fail();
 const context:Record<string,CheckpointArtifactBinding>={};
 for(const row of contexts){
 const actual=byId.get(row.artifact_id);if(actual?.status!=='COMPLETE'||actual.digest!==row.artifact_digest||actual.size_bytes!==row.artifact_size_bytes||!['dependency','summary','findings'].includes(row.role))fail();
 const expected=row.role==='dependency'?checkpoint.dependency_digest:checkpoint.source_manifest?.[row.role+'_digest'];
 if(row.content_digest!==expected)fail();
 context[row.role]=Object.freeze({artifact_id:row.artifact_id,artifact_digest:row.artifact_digest,artifact_size_bytes:row.artifact_size_bytes,storage_kind:row.storage_kind,content_digest:row.content_digest,content_size_bytes:row.content_size_bytes});
 }
 const cursor=checkpoint.source_manifest?.instruction_cursor;if(typeof cursor!=='string'||!/^(0|[1-9][0-9]{0,18})$/.test(cursor))fail();
 await readSemanticDisposition(tx,invocation.principal);await invocation.identityGuard(tx);
 return Object.freeze({schema_version:1,checkpoint_id:checkpoint.id,
 artifact:Object.freeze({artifact_id:parent.id,artifact_digest:parent.digest,artifact_size_bytes:parent.size_bytes,storage_kind:'manifest' as const,content_digest:checkpoint.artifact_content_digest,content_size_bytes:checkpoint.artifact_content_size_bytes}),
 source:Object.freeze({attempt_id:checkpoint.attempt_id,attempt_generation:checkpoint.attempt_generation,task_id:checkpoint.task_id,workspace_id:checkpoint.source_workspace_id,repository_id:checkpoint.repository_id,source_object_id:checkpoint.source_object_id,input_packet_digest:checkpoint.input_packet_digest,preparation_digest:checkpoint.preparation_digest,source_metadata_digest:checkpoint.source_metadata_digest,dependency_digest:checkpoint.dependency_digest,agent_session_id:checkpoint.agent_session_id,support_level:checkpoint.support_level}),
 context_artifacts:Object.freeze({dependency:context.dependency!,summary:context.summary!,findings:context.findings!}),instruction_cursor:cursor,authority:'NONE',context_restored:false});
}
