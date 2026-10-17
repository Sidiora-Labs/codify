import type {Component,ComponentContext} from '../components/registry.js';
import type {PrimaryTransaction} from '../storage/transactions.js';
import {object} from '../policy/programme.js';
import {gatewayOf,identityTransaction,invocationOf,isIdentityAuthority} from '../identity/enrollment.js';
import type {InvocationContext} from '../transport/protocol.js';
import {DIGEST,decimal,exact,fail,hash,uuid} from '../transport/protocol.js';
import {isArtifactStoreCapability} from '../artifacts/objects.js';
import type {ArtifactStoreCapability} from '../artifacts/objects.js';
import {assertRunnerPublicationAllowed,authorizeRunnerControl,inspectRunnerControl,inspectRunnerWorkspace,issueRunnerControl,leaseRunnerWorkspace,registerRunnerWorkspace,releaseRunnerWorkspace,reportRunnerControl} from './workspaces.js';
import {readPreparationReceipt,recordPreparationReceipt} from './preparation_receipts.js';

/* Durable capture of required runner outputs into the 15.2 artifact store.
 * A required output is durable only when every fixed-size chunk is a COMPLETE
 * verified object and the ordered manifest commits the exact content digest. */
export const CAPTURE_CHUNK_BYTES=196608;
const MAX_CAPTURE=16777216;
const RETENTION={retention_class:'RUN',retention_until:null,retention_hold:false} as const;
export interface RunnerCaptureCapability {
 putChunk(i:InvocationContext,input:unknown):Promise<Record<string,unknown>>;
 assertPublicationAllowed:typeof assertRunnerPublicationAllowed;
}
export function isRunnerCaptureCapability(v:unknown):v is RunnerCaptureCapability{return object(v)&&typeof v.putChunk==='function'&&typeof v.assertPublicationAllowed==='function';}

async function stored(store:ArtifactStoreCapability,i:InvocationContext,part:Buffer):Promise<{artifact_id:string;digest:string}>{
 const scope={organisation_id:i.principal.organisation_id,run_id:i.principal.run_id},value=hash(part);
 const r=await store.invoke('artifact.object.put',{...scope,digest:value,size_bytes:String(part.length),data_base64:part.toString('base64'),...RETENTION},i) as Record<string,any>;
 if(!object(r)||r.outcome!=='SUCCEEDED'||r.availability!=='VERIFIED'||!object(r.artifact)||!uuid(r.artifact.artifact_id)||r.artifact.status!=='COMPLETE'||r.artifact.digest!==value||r.artifact.size_bytes!==String(part.length)||r.artifact.organisation_id!==scope.organisation_id||r.artifact.run_id!==scope.run_id)fail('CAPTURE_ARTIFACT_UNAVAILABLE','Actual durable verified chunk object required');
 return {artifact_id:r.artifact.artifact_id,digest:value};
}

export function createComponent(ctx:ComponentContext):Component{
 const store=ctx.dependencies.require('15.2','artifact.store.v1',isArtifactStoreCapability);
 ctx.dependencies.require('14.1','identity.authority',isIdentityAuthority);
 const g=gatewayOf(ctx);
 const transact=<T>(i:InvocationContext,op:(tx:PrimaryTransaction)=>Promise<T>):Promise<T>=>g.withPrimaryTransaction({timeoutMs:5000,maxRetries:2,signal:i.signal,guard:tx=>i.guard(tx)},tx=>op(tx as PrimaryTransaction));
 const putChunk=async(i:InvocationContext,v:unknown):Promise<Record<string,unknown>>=>{
  if(i.principal.role!=='RUNNER')fail('ROLE_DENIED','Only the bound runner captures its required outputs');
  exact(v,['command_id','name','sequence','offset_bytes','total_digest','total_size_bytes','data_base64']);
  if(!uuid(v.command_id)||typeof v.name!=='string'||!Number.isSafeInteger(v.sequence)||Number(v.sequence)<0||Number(v.sequence)>=4096||!decimal(v.offset_bytes)||typeof v.total_digest!=='string'||!DIGEST.test(v.total_digest)||!decimal(v.total_size_bytes)||BigInt(v.total_size_bytes)>BigInt(MAX_CAPTURE)||typeof v.data_base64!=='string'||v.data_base64.length>Math.ceil(CAPTURE_CHUNK_BYTES/3)*4)fail('INVALID_CAPTURE','Bounded ordered capture chunk required');
  const bytes=Buffer.from(v.data_base64,'base64'),total=BigInt(v.total_size_bytes),offset=BigInt(v.offset_bytes),sequence=Number(v.sequence);
  const expected=total===0n?0n:BigInt(Math.min(CAPTURE_CHUNK_BYTES,Number(total-offset)));
  if(bytes.toString('base64')!==v.data_base64||offset!==BigInt(sequence)*BigInt(CAPTURE_CHUNK_BYTES)||offset>total||(total>0n&&offset===total)||BigInt(bytes.length)!==expected)fail('INVALID_CAPTURE','Chunks are fixed-size, contiguous and canonical');
  const p=i.principal,scope={organisation_id:p.organisation_id,run_id:p.run_id};
  const command=await transact(i,async tx=>{
   const row=(await tx.query('SELECT command_id,sandbox_id,boot_id,boot_generation::text,required_outputs FROM hyperfide.runner_control_commands WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 FOR SHARE',[scope.organisation_id,scope.run_id,v.command_id])).rows[0];
   if(!row)fail('CONTROL_COMMAND_UNKNOWN','Capture requires an issued control command');
   if(row.sandbox_id!==p.sandbox_id||row.boot_id!==p.boot_id||row.boot_generation!==p.boot_generation)fail('CONTROL_SCOPE_DENIED','Command targets another sandbox boot');
   if(!(row.required_outputs as string[]).includes(v.name as string))fail('CAPTURE_NOT_REQUIRED','Only required outputs of the command are captured');
   await tx.query('INSERT INTO hyperfide.runner_output_captures(organisation_id,run_id,command_id,name,total_digest,total_size_bytes) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING',[scope.organisation_id,scope.run_id,v.command_id,v.name,v.total_digest,v.total_size_bytes]);
   const capture=(await tx.query('SELECT total_digest,total_size_bytes::text FROM hyperfide.runner_output_captures WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 AND name=$4',[scope.organisation_id,scope.run_id,v.command_id,v.name])).rows[0]!;
   if(capture.total_digest!==v.total_digest||capture.total_size_bytes!==v.total_size_bytes)fail('CAPTURE_CONFLICT','Output identity was already captured with different content');
   return row;
  });
  void command;
  const chunk=await stored(store,i,bytes);
  return transact(i,async tx=>{
   await tx.query('INSERT INTO hyperfide.runner_output_capture_chunks(organisation_id,run_id,command_id,name,sequence,offset_bytes,size_bytes,artifact_id,digest) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING',[scope.organisation_id,scope.run_id,v.command_id,v.name,sequence,v.offset_bytes,bytes.length,chunk.artifact_id,chunk.digest]);
   const same=(await tx.query('SELECT digest FROM hyperfide.runner_output_capture_chunks WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 AND name=$4 AND sequence=$5',[scope.organisation_id,scope.run_id,v.command_id,v.name,sequence])).rows[0];
   if(same?.digest!==chunk.digest)fail('CAPTURE_CONFLICT','Chunk sequence was already captured with different bytes');
   const rows=(await tx.query('SELECT sequence,offset_bytes::text,size_bytes::text,artifact_id,digest FROM hyperfide.runner_output_capture_chunks WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 AND name=$4 ORDER BY sequence',[scope.organisation_id,scope.run_id,v.command_id,v.name])).rows;
   const received=rows.reduce((n,r)=>n+BigInt(r.size_bytes),0n),expectedChunks=total===0n?1:Number((total+BigInt(CAPTURE_CHUNK_BYTES)-1n)/BigInt(CAPTURE_CHUNK_BYTES));
   const current=(await tx.query('SELECT state,manifest_artifact_id,manifest_digest,receipt_digest FROM hyperfide.runner_output_captures WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 AND name=$4 FOR UPDATE',[scope.organisation_id,scope.run_id,v.command_id,v.name])).rows[0]!;
   if(current.state==='COMPLETE'||received!==total||rows.length!==expectedChunks||rows.some((r,k)=>r.sequence!==k))return {command_id:v.command_id,name:v.name,state:current.state,received_bytes:String(received),total_size_bytes:v.total_size_bytes,manifest_artifact_id:current.manifest_artifact_id??null,receipt_digest:current.receipt_digest??null};
   return null;
  }).then(async early=>{
   if(early)return early;
   // Ordered manifest commit is performed by 15.2, which validates every child and the content digest.
   const rows=await transact(i,async tx=>(await tx.query('SELECT sequence,offset_bytes::text,size_bytes::text,artifact_id,digest FROM hyperfide.runner_output_capture_chunks WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 AND name=$4 ORDER BY sequence',[scope.organisation_id,scope.run_id,v.command_id,v.name])).rows);
   const manifest:Record<string,any>=await store.invoke('artifact.manifest.commit',{...scope,expected_chunks:rows.length,total_size_bytes:v.total_size_bytes,content_digest:v.total_digest,complete:true,truncated:false,missing_ranges:[],chunks:rows.map(r=>({sequence:r.sequence,artifact_id:r.artifact_id,digest:r.digest,size_bytes:r.size_bytes,offset_bytes:r.offset_bytes})),...RETENTION},i) as Record<string,any>;
   if(!manifest||typeof manifest!=='object'||manifest.outcome!=='SUCCEEDED'||manifest.availability!=='VERIFIED'||!object(manifest.artifact)||!uuid(manifest.artifact.artifact_id)||typeof manifest.artifact.digest!=='string'||!DIGEST.test(manifest.artifact.digest)||manifest.content_digest!==v.total_digest||!object(manifest.receipt)||typeof manifest.receipt.receipt_id!=='string'||!DIGEST.test(manifest.receipt.receipt_id))fail('CAPTURE_ARTIFACT_UNAVAILABLE','Actual durable ordered manifest receipt required');
   return transact(i,async tx=>{
    const done=(await tx.query("UPDATE hyperfide.runner_output_captures SET state='COMPLETE',manifest_artifact_id=$5,manifest_digest=$6,receipt_digest=$7,completed_at=clock_timestamp() WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 AND name=$4 AND state='PARTIAL' RETURNING manifest_artifact_id,receipt_digest",[scope.organisation_id,scope.run_id,v.command_id,v.name,manifest.artifact.artifact_id,manifest.artifact.digest,manifest.receipt.receipt_id])).rows[0]??(await tx.query('SELECT manifest_artifact_id,receipt_digest FROM hyperfide.runner_output_captures WHERE organisation_id=$1 AND run_id=$2 AND command_id=$3 AND name=$4',[scope.organisation_id,scope.run_id,v.command_id,v.name])).rows[0]!;
    return {command_id:v.command_id,name:v.name,state:'COMPLETE',received_bytes:v.total_size_bytes,total_size_bytes:v.total_size_bytes,manifest_artifact_id:done.manifest_artifact_id,receipt_digest:done.receipt_digest};
   });
  });
 };
 const capability:RunnerCaptureCapability=Object.freeze({putChunk,assertPublicationAllowed:assertRunnerPublicationAllowed});
 const act=(op:(tx:PrimaryTransaction,i:InvocationContext,v:unknown)=>Promise<unknown>)=>(v:unknown,context:ComponentContext)=>identityTransaction(context,(tx,i)=>op(tx as unknown as PrimaryTransaction,i,v));
 return {apiVersion:1,capabilities:{'runner.capture.v1':capability},actions:{
  'runner.control.issue':act(issueRunnerControl),
  'runner.control.authorize':act(authorizeRunnerControl),
  'runner.control.report':act(reportRunnerControl),
  'runner.control.inspect':act(inspectRunnerControl),
  'runner.capture.put':(v:unknown,context:ComponentContext)=>putChunk(invocationOf(context),v),
  'runner.workspace.register':act(registerRunnerWorkspace),
  'runner.workspace.lease':act(leaseRunnerWorkspace),
  'runner.workspace.release':act(releaseRunnerWorkspace),
  'runner.workspace.inspect':act(inspectRunnerWorkspace),
  'runner.publication.check':act(async(tx,i,v)=>{exact(v,['attempt_id','attempt_generation']);if(!uuid(v.attempt_id)||!decimal(v.attempt_generation,true))fail('INVALID_REQUEST','Exact attempt generation required');try{return {allowed:true,...await assertRunnerPublicationAllowed(tx,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,attempt_id:v.attempt_id,attempt_generation:v.attempt_generation})};}catch(error){if(object(error)&&error.code==='RUNNER_PUBLICATION_FENCED')return {allowed:false,reason:'RUNNER_PUBLICATION_FENCED'};throw error;}}),
  'runner.preparation.receipt.record':act(recordPreparationReceipt),
  'runner.preparation.receipt.inspect':act(async(tx,i,v)=>{exact(v,['operation_id']);if(!uuid(v.operation_id))fail('INVALID_REQUEST','Operation identity required');const row=await readPreparationReceipt(tx,{organisation_id:i.principal.organisation_id,run_id:i.principal.run_id,operation_id:v.operation_id});if(!row)fail('PREPARATION_RECEIPT_UNKNOWN','No verified native receipt is recorded');return row;})
 }};
}
