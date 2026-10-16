import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { Sandbox, type ExecHandle, type ExecResult } from 'railway';
import type { Component, ComponentContext } from '../../components/registry.js';
import { validateProviderOperation, type ProviderOperation, type ResourceRef, type ProcessResult } from '../contract.js';
import { absolute, configuredClient, digest, hash, instant, integer, object, text, type RailwayClient } from './preparation.js';
import type { CredentialResolver } from './profile.js';

interface Chunk { sequence:number;stream:'stdout'|'stderr';offset:string;size:number;digest:string;file:string }
export interface RailwaySessionRecord {
  schema_version:1;operation_id:string;payload_digest:string;scope_digest:string;resource:ResourceRef;
  session_name:string|null;phase:'STARTING'|'RUNNING'|'EXITED'|'UNKNOWN';exit_code:number|null;
  timed_out:boolean;termination_confirmed:boolean;stdin_open:boolean;detached:boolean;
  observation_gap:boolean;output_complete:boolean;chunk_count:number;byte_count:string;
  stream_bytes:{stdout:string;stderr:string};updated_at:string;
}
/** Local durable spool is transport evidence, never global task ownership.
 * Artifacts15.2 must upload/ack these verified chunks before sandbox disposal. */
export interface RailwayChunkReceipt {artifact_id:string;receipt_id:string;digest:string;size_bytes:string}
export interface RailwayOutputChunk {
  operation_id:string;scope_digest:string;resource:ResourceRef;sequence:number;stream:'stdout'|'stderr';
  offset:string;digest:string;bytes:Uint8Array;
}
export type RailwayChunkSink=(chunk:RailwayOutputChunk)=>Promise<RailwayChunkReceipt>;
interface UploadState {schema_version:1;acknowledged:number;index_offset:number;
  pending:null|{sequence:number;digest:string;size_bytes:string}}
export class RailwaySessionSpool {
  readonly directory:string;
  private readonly handles=new Map<string,ExecHandle>();
  private readonly uploadPumps=new Map<string,Promise<void>>();
  constructor(directory:string,private readonly maxBytes=64*1024*1024*1024,private readonly chunkSink?:RailwayChunkSink) {
    this.directory=absolute(directory);integer(maxBytes,1);
    fs.mkdirSync(this.directory,{recursive:true,mode:0o700});
    const info=fs.lstatSync(this.directory);
    if(!info.isDirectory()||info.isSymbolicLink()||(info.mode&0o077)!==0) throw new Error('Railway spool permissions');
  }
  private key(operationId:string):string {return createHash('sha256').update(text(operationId)).digest('hex');}
  private folder(operationId:string):string {return path.join(this.directory,this.key(operationId));}
  private save(record:RailwaySessionRecord):void {
    const folder=this.folder(record.operation_id);fs.mkdirSync(folder,{recursive:true,mode:0o700});
    const target=path.join(folder,'session.json'),temp=target+'.pending';
    const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,JSON.stringify(record)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temp,target);
    const dir=fs.openSync(folder,fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try{fs.fsyncSync(dir);}finally{fs.closeSync(dir);}
  }
  read(operationId:string):RailwaySessionRecord {
    const fd=fs.openSync(path.join(this.folder(operationId),'session.json'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try {
      const info=fs.fstatSync(fd);if(!info.isFile()||info.size>32*1024*1024) throw new Error('Railway session ledger bound');
      const record=JSON.parse(fs.readFileSync(fd,'utf8')) as RailwaySessionRecord;
      if(record.schema_version!==1||record.operation_id!==operationId) throw new Error('Railway session ledger identity');
      return record;
    } finally {fs.closeSync(fd);}
  }
  private append(record:RailwaySessionRecord,stream:'stdout'|'stderr',value:string|Uint8Array):void {
    const bytes=typeof value==='string'?Buffer.from(value,'utf8'):Buffer.from(value);
    for(let start=0;start<bytes.length;start+=65536){
      const content=bytes.subarray(start,Math.min(start+65536,bytes.length));
      if(BigInt(record.byte_count)+BigInt(content.length)>BigInt(this.maxBytes))throw new Error('Railway spool capacity exceeded');
      const folder=this.folder(record.operation_id),filename=stream+'.spool';
      const fd=fs.openSync(path.join(folder,filename),
        fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeSync(fd,content);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
      const chunk:Chunk={sequence:record.chunk_count,stream,offset:record.stream_bytes[stream],
        size:content.length,digest:'sha256:'+createHash('sha256').update(content).digest('hex'),file:filename};
      const index=fs.openSync(path.join(folder,'chunks.ndjson'),
        fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeSync(index,JSON.stringify(chunk)+'\n');fs.fsyncSync(index);}finally{fs.closeSync(index);}
      record.chunk_count++;record.byte_count=(BigInt(record.byte_count)+BigInt(content.length)).toString();
      record.stream_bytes[stream]=(BigInt(record.stream_bytes[stream])+BigInt(content.length)).toString();
      record.updated_at=new Date().toISOString();this.save(record);this.kickUploads(record.operation_id);
    }
  }
  private *index(operationId:string):Generator<Chunk> {
    const filename=path.join(this.folder(operationId),'chunks.ndjson');
    if(!fs.existsSync(filename))return;
    const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW),buffer=Buffer.alloc(65536);
    let carry='',position=0;
    try{
      while(true){
        const count=fs.readSync(fd,buffer,0,buffer.length,position);if(!count)break;position+=count;
        carry+=buffer.subarray(0,count).toString('utf8');
        let end:number;
        while((end=carry.indexOf('\n'))!==-1){
          const line=carry.slice(0,end);carry=carry.slice(end+1);
          if(line.length>4096)throw new Error('Railway spool index bound');
          yield JSON.parse(line) as Chunk;
        }
        if(carry.length>4096)throw new Error('Railway spool index bound');
      }
      if(carry)throw new Error('Railway spool partial index');
    }finally{fs.closeSync(fd);}
  }
  verify(operationId:string):{complete:boolean;byte_count:string;digest:string;chunks:number} {
    const record=this.read(operationId),combined=createHash('sha256');
    const offsets={stdout:0n,stderr:0n};let total=0n,count=0;
    const folder=this.folder(operationId),expected=new Set(['session.json','uploads.json','upload-receipts.ndjson']);
    for(const chunk of this.index(operationId)){
      expected.add('chunks.ndjson');
      if(chunk.sequence!==count++||!['stdout','stderr'].includes(chunk.stream)||
        chunk.offset!==offsets[chunk.stream].toString()||chunk.file!==chunk.stream+'.spool'||
        !Number.isInteger(chunk.size)||chunk.size<1||chunk.size>65536)throw new Error('Railway spool gap/order');
      expected.add(chunk.file);
      const fd=fs.openSync(path.join(folder,chunk.file),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const content=Buffer.alloc(chunk.size);
      try{const info=fs.fstatSync(fd);if(!info.isFile()||offsets[chunk.stream]>BigInt(Number.MAX_SAFE_INTEGER))
          throw new Error('Railway spool stream');
        const read=fs.readSync(fd,content,0,content.length,Number(offsets[chunk.stream]));
        if(read!==content.length)throw new Error('Railway spool short chunk');
      }finally{fs.closeSync(fd);}
      if('sha256:'+createHash('sha256').update(content).digest('hex')!==chunk.digest)throw new Error('Railway spool corruption');
      combined.update(content);offsets[chunk.stream]+=BigInt(content.length);total+=BigInt(content.length);
    }
    for(const stream of ['stdout','stderr'] as const){
      const file=path.join(folder,stream+'.spool');
      if((fs.existsSync(file)?fs.statSync(file).size:0)!==Number(offsets[stream])||
        record.stream_bytes[stream]!==offsets[stream].toString())throw new Error('Railway spool orphan bytes');
    }
    if(count!==record.chunk_count||total.toString()!==record.byte_count||
      fs.readdirSync(folder).some(name=>!expected.has(name)))throw new Error('Railway spool uncommitted data');
    return {complete:record.output_complete&&!record.observation_gap,byte_count:total.toString(),
      digest:'sha256:'+combined.digest('hex'),chunks:count};
  }
  private uploadState(operationId:string):UploadState {
    const filename=path.join(this.folder(operationId),'uploads.json');
    if(!fs.existsSync(filename))return {schema_version:1,acknowledged:0,index_offset:0,pending:null};
    const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    try{if(fs.fstatSync(fd).size>8192)throw new Error('Railway upload ledger bound');
      const state=JSON.parse(fs.readFileSync(fd,'utf8')) as UploadState;
      if(state.schema_version!==1||!Number.isSafeInteger(state.acknowledged)||state.acknowledged<0||
        !Number.isSafeInteger(state.index_offset)||state.index_offset<0)throw new Error('Railway upload ledger');
      return state;
    }finally{fs.closeSync(fd);}
  }
  private saveUploadState(operationId:string,state:UploadState):void {
    const target=path.join(this.folder(operationId),'uploads.json'),temp=target+'.pending';
    const fd=fs.openSync(temp,fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_TRUNC|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeFileSync(fd,JSON.stringify(state)+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    fs.renameSync(temp,target);
    const folder=fs.openSync(this.folder(operationId),fs.constants.O_RDONLY|fs.constants.O_DIRECTORY);
    try{fs.fsyncSync(folder);}finally{fs.closeSync(folder);}
  }
  private receipt(receipt:RailwayChunkReceipt,digestValue:string,size:string):void {
    const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    if(!uuid.test(receipt.artifact_id)||!uuid.test(receipt.receipt_id)||receipt.digest!==digestValue||receipt.size_bytes!==size)
      throw new Error('Railway artifact receipt mismatch');
  }
  private kickUploads(operationId:string):void {
    if(this.chunkSink)this.uploadPending(operationId,this.chunkSink).catch(()=>{/* Pending intent retains explicit upload uncertainty. */});
  }
  async uploadPending(operationId:string,sink:RailwayChunkSink):Promise<void> {
    const existing=this.uploadPumps.get(operationId);if(existing)return existing;
    const pump=Promise.resolve().then(()=>this.performUploads(operationId,sink))
      .finally(()=>{this.uploadPumps.delete(operationId);});
    this.uploadPumps.set(operationId,pump);return pump;
  }
  private async performUploads(operationId:string,sink:RailwayChunkSink):Promise<void> {
    const state=this.uploadState(operationId);
    // Any crash/timeout after the persisted send intent needs actual store reconciliation.
    if(state.pending)throw new Error('Railway artifact upload requires reconciliation');
    while(true){
      const record=this.read(operationId);
      if(state.acknowledged>=record.chunk_count)return;
      const index=fs.openSync(path.join(this.folder(operationId),'chunks.ndjson'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      const buffer=Buffer.alloc(4096);let count:number;
      try{count=fs.readSync(index,buffer,0,buffer.length,state.index_offset);}finally{fs.closeSync(index);}
      const end=buffer.subarray(0,count).indexOf(10);
      if(end<1)throw new Error('Railway upload index gap');
      const chunk=JSON.parse(buffer.subarray(0,end).toString('utf8')) as Chunk;
      if(chunk.sequence!==state.acknowledged||!['stdout','stderr'].includes(chunk.stream)||
        chunk.file!==chunk.stream+'.spool'||!Number.isSafeInteger(chunk.size)||chunk.size<1||chunk.size>65536||
        typeof chunk.offset!=='string'||!/^(0|[1-9][0-9]*)$/.test(chunk.offset)||
        BigInt(chunk.offset)>BigInt(Number.MAX_SAFE_INTEGER))
        throw new Error('Railway upload chunk identity');
      const data=Buffer.alloc(chunk.size),file=fs.openSync(path.join(this.folder(operationId),chunk.file),
        fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      try{if(fs.readSync(file,data,0,data.length,Number(BigInt(chunk.offset)))!==data.length)throw new Error('Railway upload short read');}
      finally{fs.closeSync(file);}
      if('sha256:'+createHash('sha256').update(data).digest('hex')!==chunk.digest)throw new Error('Railway upload chunk corruption');
      state.pending={sequence:chunk.sequence,digest:chunk.digest,size_bytes:String(chunk.size)};
      this.saveUploadState(operationId,state); // Intent precedes object.put.
      const receipt=await sink({operation_id:operationId,scope_digest:record.scope_digest,resource:record.resource,
        sequence:chunk.sequence,stream:chunk.stream,offset:chunk.offset,digest:chunk.digest,bytes:data});
      this.receipt(receipt,chunk.digest,String(chunk.size));
      const receipts=fs.openSync(path.join(this.folder(operationId),'upload-receipts.ndjson'),
        fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
      try{fs.writeSync(receipts,JSON.stringify({...chunk,receipt})+'\n');fs.fsyncSync(receipts);}finally{fs.closeSync(receipts);}
      state.acknowledged++;state.index_offset+=end+1;state.pending=null;this.saveUploadState(operationId,state);
    }
  }
  uploadStatus(operationId:string):{uploaded_chunks:number;total_chunks:number;pending_unknown:boolean;
    all_chunks_uploaded:boolean;manifest_required:true;durable_upload_qualified:false} {
    const state=this.uploadState(operationId),record=this.read(operationId);
    return {uploaded_chunks:state.acknowledged,total_chunks:record.chunk_count,pending_unknown:state.pending!==null,
      all_chunks_uploaded:state.pending===null&&state.acknowledged===record.chunk_count,
      manifest_required:true,durable_upload_qualified:false};
  }
  async reconcilePendingUpload(operationId:string,reconcile:(pending:NonNullable<UploadState['pending']>)=>
    Promise<RailwayChunkReceipt|null>):Promise<boolean> {
    if(this.uploadPumps.has(operationId))throw new Error('Railway upload still active');
    const state=this.uploadState(operationId);if(!state.pending)return true;
    const receipt=await reconcile(state.pending);if(!receipt)return false;
    this.receipt(receipt,state.pending.digest,state.pending.size_bytes);
    // Do not dispatch again. The same index row is acknowledged from actual storage evidence.
    const index=fs.openSync(path.join(this.folder(operationId),'chunks.ndjson'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    const bytes=Buffer.alloc(4096);let length:number;
    try{length=fs.readSync(index,bytes,0,bytes.length,state.index_offset);}finally{fs.closeSync(index);}
    const end=bytes.subarray(0,length).indexOf(10);
    if(end<1)throw new Error('Railway reconciled index gap');
    const chunk=JSON.parse(bytes.subarray(0,end).toString('utf8')) as Chunk;
    if(chunk.sequence!==state.pending.sequence||chunk.digest!==state.pending.digest||String(chunk.size)!==state.pending.size_bytes)
      throw new Error('Railway reconciliation binding mismatch');
    const fd=fs.openSync(path.join(this.folder(operationId),'upload-receipts.ndjson'),
      fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_APPEND|fs.constants.O_NOFOLLOW,0o600);
    try{fs.writeSync(fd,JSON.stringify({...chunk,receipt,reconciled:true})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}
    state.acknowledged++;state.index_offset+=end+1;state.pending=null;this.saveUploadState(operationId,state);
    this.kickUploads(operationId);return true;
  }
  private result(record:RailwaySessionRecord):ProcessResult {
    const proof=record.phase==='EXITED'?this.verify(record.operation_id):
      {complete:false,byte_count:record.byte_count,digest:'',chunks:record.chunk_count};
    return {process_ref:record.session_name??record.operation_id,phase:record.phase==='EXITED'?'EXITED':'STARTED',
      exit_code:record.phase==='EXITED'?record.exit_code:null,
      timed_out:record.phase==='EXITED'?record.timed_out:false,
      termination_confirmed:record.phase==='EXITED'&&record.termination_confirmed,
      output:{complete:proof.complete,truncated:false,byte_count:proof.byte_count,sha256:proof.complete?proof.digest:null}};
  }
  async start(client:RailwayClient,operation:ProviderOperation<'execute'>,resolve:CredentialResolver,
    signal:AbortSignal):Promise<{record:RailwaySessionRecord;result:ProcessResult}> {
    validateProviderOperation(operation);client.assertScope(operation.scope);
    if(!operation.resource||!operation.parameters.durable) throw new Error('Railway durable supervisor required');
    const folder=this.folder(operation.identity.operation_id);
    // O_EXCL-equivalent directory claim precedes even the SDK call. Unknown starts cannot be replayed.
    try{fs.mkdirSync(folder,{mode:0o700});}catch{
      const previous=this.read(operation.identity.operation_id);
      if(previous.payload_digest!==operation.identity.payload_digest) throw new Error('Railway start identity conflict');
      throw new Error('Railway start already exists; inspect/reconcile before retry');
    }
    const record:RailwaySessionRecord={schema_version:1,operation_id:operation.identity.operation_id,
      payload_digest:operation.identity.payload_digest,scope_digest:hash(operation.scope),resource:operation.resource,
      session_name:null,phase:'STARTING',exit_code:null,timed_out:false,termination_confirmed:false,
      stdin_open:operation.parameters.stdin,detached:false,observation_gap:false,output_complete:false,
      chunk_count:0,byte_count:'0',stream_bytes:{stdout:'0',stderr:'0'},
      updated_at:new Date().toISOString()};
    this.save(record);
    const env=await resolve(operation.parameters.env_refs,signal);
    if(Object.keys(env).length!==Object.keys(operation.parameters.env_refs).length||
      Object.keys(env).some(key=>!Object.hasOwn(operation.parameters.env_refs,key))) throw new Error('Railway credential inventory');
    for(const value of Object.values(env)) if(typeof value!=='string'||!value||value.includes('\0')) throw new Error('Railway process credential');
    if(signal.aborted||Date.now()>=Date.parse(operation.deadline_at))throw new Error('Railway setup cancelled before dispatch');
    const sandbox=await Sandbox.connect(operation.resource.native_sandbox_id,client.sdkOptions((stream,bytes)=>{
      try{this.append(record,stream,bytes);}catch{
        record.observation_gap=true;record.output_complete=false;
        try{this.save(record);}catch{/* Persistence failure is not complete output evidence. */}
      }
    }));
    if(signal.aborted||Date.now()>=Date.parse(operation.deadline_at))throw new Error('Railway setup deadline before exec');
    const command=operation.parameters.argv.map(value=>"'"+value.replaceAll("'","'\\''")+"'").join(' ');
    const handle=sandbox.exec(command,{cwd:operation.parameters.cwd,env,stdin:operation.parameters.stdin,
      ephemeral:false,captureOutput:false,
      ...(operation.parameters.process_timeout_ms===null?{}:{timeoutSec:Math.ceil(operation.parameters.process_timeout_ms/1000)}),
      // Raw binary frames are captured by the trusted WebSocket constructor above.
});
    this.handles.set(operation.identity.operation_id,handle);
    // Observe both promises before awaiting either; rejections never become unhandled.
    const session=handle.sessionName.then(name=>{record.session_name=name;record.phase='RUNNING';this.save(record);return name;});
    const completion=handle.result().then(result=>{
      record.phase=result.exitCode===null?'UNKNOWN':'EXITED';record.exit_code=result.exitCode;
      record.timed_out=result.timedOut;record.termination_confirmed=result.exitCode!==null;
      record.stdin_open=false;record.output_complete=result.exitCode!==null&&!result.truncated&&!record.detached&&!record.observation_gap;
      record.updated_at=new Date().toISOString();this.save(record);return result;
    },()=>{
      record.phase='UNKNOWN';record.observation_gap=true;record.output_complete=false;record.stdin_open=false;
      record.updated_at=new Date().toISOString();this.save(record);return null;
    }).finally(()=>{if(this.handles.get(operation.identity.operation_id)===handle)this.handles.delete(operation.identity.operation_id);});
    completion.catch(()=>{});session.catch(()=>{});
    let timer:ReturnType<typeof setTimeout>|undefined;
    try{
      await Promise.race([session,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('Railway API wait elapsed; start unknown')),
        operation.parameters.wait_timeout_ms);})]);
      return {record:this.read(record.operation_id),result:this.result(this.read(record.operation_id))};
    }finally{if(timer)clearTimeout(timer);}
  }
  find(resource:ResourceRef,sessionName:string):RailwaySessionRecord {
    for(const name of fs.readdirSync(this.directory)){
      if(!/^[a-f0-9]{64}$/.test(name))continue;
      const filename=path.join(this.directory,name,'session.json');
      if(!fs.existsSync(filename))continue;
      const fd=fs.openSync(filename,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      let record:RailwaySessionRecord;
      try{record=JSON.parse(fs.readFileSync(fd,'utf8')) as RailwaySessionRecord;}finally{fs.closeSync(fd);}
      if(record.session_name===sessionName&&record.resource.native_sandbox_id===resource.native_sandbox_id){
        if(record.resource.sandbox_boot_generation!==resource.sandbox_boot_generation)throw new Error('Railway stale boot generation');
        return this.read(record.operation_id);
      }
    }
    throw new Error('Railway session is not bound to this resource');
  }
  inspect(resource:ResourceRef,sessionName:string):ProcessResult {
    const record=this.find(resource,sessionName);
    if(record.phase==='UNKNOWN'||record.phase==='STARTING'||
      (record.phase==='RUNNING'&&!this.handles.has(record.operation_id)))throw new Error('Railway process outcome unknown');
    return this.result(record);
  }
  async stdin(resource:ResourceRef,sessionName:string,bytes:Uint8Array):Promise<void> {
    const record=this.find(resource,sessionName),handle=this.handles.get(record.operation_id);
    if(!handle||!record.stdin_open||record.detached)throw new Error('Railway stdin unsupported after detach/restart');
    if(bytes.length>16384)throw new Error('Railway stdin write bound');
    await handle.stdin.write(bytes); // SDK provides bounded backpressure, never implicit replay.
  }
  async detach(resource:ResourceRef,sessionName:string):Promise<void> {
    const record=this.find(resource,sessionName),handle=this.handles.get(record.operation_id);
    if(!handle)throw new Error('Railway attachment unavailable');
    await handle.detach();const current=this.read(record.operation_id);
    current.detached=true;current.stdin_open=false;current.observation_gap=true;
    current.phase='UNKNOWN';current.output_complete=false;this.save(current);
  }
  readCapturedOutput(resource:ResourceRef,sessionName:string,maxBytes:number):{
    stdout:Uint8Array;stderr:Uint8Array;exit_code:number;complete:true;spool_digest:string;
  } {
    integer(maxBytes,1,16*1024*1024);
    const record=this.find(resource,sessionName),proof=this.verify(record.operation_id);
    if(!proof.complete||record.phase!=='EXITED'||record.exit_code===null||BigInt(proof.byte_count)>BigInt(maxBytes))
      throw new Error('Railway bounded complete output unavailable');
    const streams:{stdout:Buffer;stderr:Buffer}={stdout:Buffer.alloc(0),stderr:Buffer.alloc(0)};
    for(const name of ['stdout','stderr'] as const){
      if(record.stream_bytes[name]==='0')continue;
      const fd=fs.openSync(path.join(this.folder(record.operation_id),name+'.spool'),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
      try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size!==Number(record.stream_bytes[name])||stat.size>maxBytes)
          throw new Error('Railway output changed');streams[name]=fs.readFileSync(fd);}finally{fs.closeSync(fd);}
    }
    // Recheck the returned bytes, not only an earlier filesystem observation.
    const returned=createHash('sha256');let count=0;
    for(const chunk of this.index(record.operation_id)){
      const start=Number(BigInt(chunk.offset)),content=streams[chunk.stream].subarray(start,start+chunk.size);
      if(content.length!==chunk.size||'sha256:'+createHash('sha256').update(content).digest('hex')!==chunk.digest)
        throw new Error('Railway returned output changed');
      returned.update(content);count++;
    }
    if(count!==record.chunk_count||'sha256:'+returned.digest('hex')!==proof.digest)throw new Error('Railway returned output index changed');
    return {...streams,exit_code:record.exit_code,complete:true,spool_digest:proof.digest};
  }
  async detachAll():Promise<void> {
    for(const [operationId,handle] of this.handles){
      const before=this.read(operationId);
      if(before.phase==='EXITED'&&before.termination_confirmed){this.handles.delete(operationId);continue;}
      try{await handle.detach();}catch{/* Failure remains UNKNOWN; never report termination. */}
      try{const record=this.read(operationId);if(record.phase==='EXITED'&&record.termination_confirmed)continue;
        record.detached=true;record.stdin_open=false;
        record.observation_gap=true;record.output_complete=false;record.phase='UNKNOWN';this.save(record);}catch{/* Controller cannot repair unavailable storage. */}
    }
  }
  async stop(client:RailwayClient,resource:ResourceRef,sessionName:string,signal:'TERM'|'KILL'):Promise<ProcessResult> {
    const record=this.find(resource,sessionName);
    if(record.phase==='EXITED'&&record.termination_confirmed)return this.result(record);
    let handle=record.detached?undefined:this.handles.get(record.operation_id);
    if(!handle) {
      const sandbox=await Sandbox.connect(resource.native_sandbox_id,client.sdkOptions());
      // Reattachment cannot reapply cwd/env/stdin and its replay is never complete evidence.
      handle=sandbox.exec({sessionName},{captureOutput:false});
      this.handles.set(record.operation_id,handle);
      record.observation_gap=true;this.save(record);
    }
    const session=handle.sessionName.catch(()=>null);
    const result=handle.result().catch(()=>null);
    await session;
    if(!await handle.kill(signal))throw new Error('Railway termination signal unconfirmed');
    let timer:ReturnType<typeof setTimeout>|undefined;
    const outcome=await Promise.race([result,new Promise<null>(resolve=>{
      timer=setTimeout(()=>resolve(null),client.config.request_timeout_ms);
    })]).finally(()=>{if(timer)clearTimeout(timer);});
    if(!outcome||outcome.exitCode===null)throw new Error('Railway termination unconfirmed');
    const current=this.read(record.operation_id);
    current.phase='EXITED';current.exit_code=outcome.exitCode;current.timed_out=outcome.timedOut;
    current.termination_confirmed=true;current.stdin_open=false;
    current.output_complete=current.output_complete&&!current.observation_gap;this.save(current);
    if(this.handles.get(record.operation_id)===handle)this.handles.delete(record.operation_id);
    return this.result(current);
  }
}
/** Bind invoke to artifact.store.v1 with its actual authenticated request context.
 * Never accept an invocation guard, principal, or retention policy from a model request. */
export function createRailwayArtifactChunkSink(invoke:(action:string,input:unknown)=>Promise<unknown>,binding:{
  organisation_id:string;run_id:string;retention_class:'EPHEMERAL'|'RUN'|'RELEASE'|'LEGAL_HOLD';
  retention_until:string|null;retention_hold:boolean;
}):RailwayChunkSink {
  const bound=Object.freeze({...binding});
  text(bound.organisation_id);text(bound.run_id);
  return async chunk=>{
    const result=object(await invoke('object.put',{...bound,digest:chunk.digest,
      size_bytes:String(chunk.bytes.byteLength),data_base64:Buffer.from(chunk.bytes).toString('base64')}));
    const artifact=object(result.artifact),receipt=object(result.receipt);
    if(result.outcome!=='SUCCEEDED'||result.availability!=='VERIFIED'||artifact.status!=='COMPLETE'||
      artifact.artifact_id!==receipt.artifact_id||artifact.digest!==chunk.digest||receipt.digest!==chunk.digest||
      artifact.size_bytes!==String(chunk.bytes.byteLength)||receipt.size_bytes!==String(chunk.bytes.byteLength))
      throw new Error('Railway artifact upload is unconfirmed');
    return {artifact_id:text(receipt.artifact_id),receipt_id:text(receipt.receipt_id),digest:chunk.digest,
      size_bytes:String(chunk.bytes.byteLength)};
  };
}
export function createComponent(_context:ComponentContext):Component {
  let spool:RailwaySessionSpool|undefined;
  const getSpool=(context:ComponentContext):RailwaySessionSpool=>{
    // Public diagnostics cannot turn model-supplied resource IDs into provider authority.
    // Production execution receives actual durable intent/session binding through8.3.
    if(configuredClient(context).config.mode!=='component-fixture')
      throw new Error('Railway live process operations require trusted bound provider execution');
    const root=context.env.HF_RAILWAY_PROCESS_ROOT;if(!root)throw new Error('Railway process root missing');
    return spool??=new RailwaySessionSpool(root);
  };
  const resolve=(context:ComponentContext):CredentialResolver=>async(refs,signal)=>{
    signal.throwIfAborted();if(Object.keys(refs).length===0)return {};
    const filename=context.env.HF_RAILWAY_CREDENTIAL_BINDINGS;
    if(!filename)throw new Error('Railway worker credential bindings unavailable');
    const fd=fs.openSync(absolute(filename),fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW);
    let bindings:Record<string,unknown>;
    try{const stat=fs.fstatSync(fd);if(!stat.isFile()||stat.size>65536||(stat.mode&0o077)!==0)
        throw new Error('Railway credential binding permissions');
      bindings=object(JSON.parse(fs.readFileSync(fd,'utf8')));}finally{fs.closeSync(fd);}
    const output:Record<string,string>={};
    for(const [name,reference] of Object.entries(refs)){
      const environment=text(bindings[reference],128);
      if(!/^HF_WORKER_[A-Z0-9_]+$/.test(environment)||!context.env[environment])
        throw new Error('Railway worker credential reference unavailable');
      output[name]=context.env[environment]!;
    }
    return output;
  };
  const resource=(raw:unknown):ResourceRef=>{
    const v=object(raw,['native_sandbox_id','sandbox_boot_generation']);text(v.native_sandbox_id);
    if(typeof v.sandbox_boot_generation!=='string'||! /^[1-9][0-9]{0,18}$/.test(v.sandbox_boot_generation)||
      BigInt(v.sandbox_boot_generation)>9223372036854775807n)throw new Error('Railway boot generation');
    return v as unknown as ResourceRef;
  };
  return {apiVersion:1,close:()=>spool?.detachAll(),actions:{
    'railway.process.describe':input=>{object(input,[]);return {transport:'DURABLE_WEBSOCKET',
      provider_replay:'DIAGNOSTIC_BOUNDED',independent_spool:'REQUIRED',detach_is_termination:false,
      reattach_restores_stdin:false,http_exec_long_running:false,authority:'NONE'};},
    'railway.process.start':async(input,context)=>{
      const v=object(input,['operation']),op=validateProviderOperation(v.operation);
      if(op.kind!=='execute'||Date.now()>=Date.parse(op.deadline_at))throw new Error('Railway process operation deadline/kind');
      const result=await getSpool(context).start(configuredClient(context),op,resolve(context),context.signal);
      return {process:result.result,operation_id:result.record.operation_id,authority:'NONE',live_qualification:'NOT_EVALUATED'};
    },
    'railway.process.inspect':(input,context)=>{
      const v=object(input,['resource','process_ref']);
      return {process:getSpool(context).inspect(resource(v.resource),text(v.process_ref)),authority:'NONE'};
    },
    'railway.process.stdin':async(input,context)=>{
      const v=object(input,['resource','process_ref','bytes_base64']),encoded=text(v.bytes_base64,22000);
      const bytes=Buffer.from(encoded,'base64');
      if(bytes.toString('base64')!==encoded)throw new Error('Railway stdin encoding');
      await getSpool(context).stdin(resource(v.resource),text(v.process_ref),bytes);
      return {queued_to_transport:true,consumed_by_process:false,authority:'NONE'};
    },
    'railway.process.detach':async(input,context)=>{
      const v=object(input,['resource','process_ref']);
      await getSpool(context).detach(resource(v.resource),text(v.process_ref));
      return {detached:true,termination_confirmed:false,stdin_open:false,authority:'NONE'};
    },
    'railway.process.stop':async(input,context)=>{
      const v=object(input,['operation']),op=validateProviderOperation(v.operation);
      if(op.kind!=='stop'||Date.now()>=Date.parse(op.deadline_at))throw new Error('Railway stop operation deadline/kind');
      return {process:await getSpool(context).stop(configuredClient(context),op.resource!,op.parameters.process_ref,
        op.parameters.signal),authority:'NONE'};
    },
    'railway.process.spool.verify':(input,context)=>{
      const v=object(input,['operation_id']);
      return {...getSpool(context).verify(text(v.operation_id)),authority:'NONE',durable_upload_qualified:false};
    }
  }};
}
