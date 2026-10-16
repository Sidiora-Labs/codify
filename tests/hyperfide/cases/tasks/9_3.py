#!/usr/bin/env python3
"""Task9.3 runs the pinned SDK over simulated provider frames backed by real OS processes."""
import base64,ctypes,hashlib,importlib,json,os,subprocess,sys,tempfile,time
from pathlib import Path
c=importlib.import_module("9_1")
IDS=[
 "railway.process.actual-sdk","railway.process.output-beyond-provider-retention","railway.process.hashed-spool",
 "railway.process.chunk-corruption","railway.process.partial-index","railway.process.restored-spool",
 "railway.process.duplicate-start-refused","railway.process.duplicate-start-no-spawn","railway.process.stale-boot-refused",
 "railway.process.stdin-transport","railway.process.stdin-output","railway.process.stdin-bound",
 "railway.process.confirmed-stop","railway.process.detach-is-not-exit","railway.process.detach-closes-input",
 "railway.process.detach-process-still-alive","railway.process.reattach-stop","railway.process.no-http-exec",
 "railway.process.unsupported-before-spawn","railway.process.cleanup-real-children","railway.process.unconfirmed-stop-bounded","railway.process.unconfirmed-is-alive",
 "railway.process.upload-unknown-no-retry","railway.process.upload-reconcile-bound","railway.process.binary-output-exact",
 "railway.process.segmented-archive","railway.process.archive-lost-reply-recovery","railway.process.archive-boot-bound",
 "railway.process.archive-byte-corruption","railway.process.session-index-restart","railway.process.session-index-corruption",
 "railway.process.reconciled-duplicate-receipt","railway.process.conflicting-duplicate-receipt",
 "railway.process.final-receipt-replay","railway.process.final-receipt-conflict","railway.process.trailing-unknown-receipt",
 "railway.process.ordered-capture-proof","railway.process.capture-proof-limit"
]
def wait_exit(service,session,timeout=30):
 deadline=time.monotonic()+timeout
 last=None
 while time.monotonic()<deadline:
  row=service.call("9.3","railway.process.inspect",{"resource":c.RESOURCE,"process_ref":session})
  if row.get("ok") is True:
   last=row["result"]["process"]
   if last["phase"]=="EXITED":return last
  time.sleep(.03)
 raise AssertionError(f"process did not exit: {last}")
def start(service,identity,argv,stdin=False):
 op=c.operation("execute",identity)
 op["parameters"].update(argv=argv,stdin=stdin)
 op["identity"]["payload_digest"]=c.digest({k:op[k] for k in
  ["kind","scope","resource","preparation_digest","deadline_at","parameters"]})
 value=c.result(service.call("9.3","railway.process.start",{"operation":op}))
 return op,value["process"]["process_ref"]
def stop(service,session,identity):
 op=c.operation("stop",identity,{"process_ref":session,"signal":"KILL"})
 return c.result(service.call("9.3","railway.process.stop",{"operation":op}))["process"]
def reap_fixture_descendants():
 deadline=time.monotonic()+5
 while time.monotonic()<deadline:
  try:pid,_=os.waitpid(-1,os.WNOHANG)
  except ChildProcessError:return
  if pid==0:time.sleep(.02)
 raise AssertionError("fixture descendants not reaped")

def main():
 if sys.argv[1:]==["--inventory"]:print(json.dumps(IDS[:3]+IDS[22:24]+IDS[25:]+IDS[24:25]+IDS[3:12]+IDS[20:22]+IDS[12:20]));return 0
 c.expect(ctypes.CDLL(None,use_errno=True).prctl(36,1,0,0,0)==0,"fixture subreaper unavailable")
 complete=False
 with tempfile.TemporaryDirectory(prefix="hyperfide-railway93-") as folder:
  fixture=c.Fixture(folder);ws=c.WebSocketFixture(folder,fixture);service=c.Service(folder,fixture)
  try:
   size=9*1024*1024+17
   program="import os; data=b'x'*65536; [os.write(1,data) for _ in range(144)]; os.write(1,b'x'*17)"
   op,session=start(service,"large-output",[sys.executable,"-c",program])
   exited=wait_exit(service,session)
   c.check(IDS[0],lambda:c.expect(exited["phase"]=="EXITED" and exited["exit_code"]==0 and
      exited["termination_confirmed"] is True,"actual child exit"))
   c.check(IDS[1],lambda:c.expect(exited["output"]["complete"] is True and exited["output"]["byte_count"]==str(size),
      "independent output exceeds8MiB"))
   proof=lambda:c.result(service.call("9.3","railway.process.spool.verify",{"operation_id":"large-output"}))
   uploader_js=r"""
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {RailwaySessionSpool,createRailwayArtifactChunkSink,RailwayArtifactUploadUnknown,verifyRailwayStreamArchive} from './services/hyperfide/dist/providers/railway/processes.js';
const root=process.argv[1],folder=process.argv[2],session=process.argv[3],size=Number(process.argv[4]);
const spool=new RailwaySessionSpool(root),resource={native_sandbox_id:'sandbox-1',sandbox_boot_generation:'7'};
const output=spool.readCapturedOutput(resource,session,16*1024*1024);
const captureHash=createHash('sha256'),captureOffsets={stdout:0,stderr:0};
let captureOrdered=output.capture.schema_version===1&&output.capture.scheme==='ORDERED_CHUNKS_SHA256'&&output.capture.chunks.length===1;
for(const chunk of output.capture.chunks){
 const bytes=output[chunk.stream].subarray(Number(chunk.offset_bytes),Number(chunk.offset_bytes)+Number(chunk.size_bytes));
 captureOrdered&&=chunk.offset_bytes===String(captureOffsets[chunk.stream])&&String(bytes.length)===chunk.size_bytes&&
  'sha256:'+createHash('sha256').update(bytes).digest('hex')===chunk.digest;
 captureOffsets[chunk.stream]+=bytes.length;captureHash.update(bytes);
}
captureOrdered&&='sha256:'+captureHash.digest('hex')===output.spool_digest&&captureOffsets.stdout===output.stdout.length&&captureOffsets.stderr===output.stderr.length;
let tooSmall=false;try{spool.readCapturedOutput(resource,session,1024);}catch{tooSmall=true;}
fs.mkdirSync(folder,{recursive:true});
let calls=0;
const idFor=digest=>{const h=digest.slice(7,39);return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);};
const stored=new Map();
const envelope=(digest,bytes)=>({outcome:'SUCCEEDED',availability:'VERIFIED',
 artifact:{artifact_id:idFor(digest),organisation_id:'org-1',run_id:'run-1',digest,size_bytes:String(bytes.length),status:'COMPLETE'},
 receipt:{receipt_id:'sha256:'+'2'.repeat(64),artifact_id:idFor(digest),organisation_id:'org-1',run_id:'run-1',digest,size_bytes:String(bytes.length)}});

const sink=createRailwayArtifactChunkSink(async(action,input)=>{
 if(action!=='artifact.object.put'||input.organisation_id!=='org-1'||input.run_id!=='run-1')throw new Error('wrong bound facade call');
 calls++;
 const bytes=Buffer.from(input.data_base64,'base64');
 if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==input.digest||String(bytes.length)!==input.size_bytes)
  throw new Error('actual bytes mismatch');
 fs.writeFileSync(path.join(folder,input.digest.slice(7)),bytes);
 stored.set(idFor(input.digest),{digest:input.digest,bytes});
 return envelope(input.digest,bytes);
},{organisation_id:'org-1',run_id:'run-1',retention_class:'RUN',retention_until:null,retention_hold:false});
let acceptedReceipt;
try{await spool.uploadPending('large-output',async chunk=>{
 acceptedReceipt=await sink(chunk);throw new RailwayArtifactUploadUnknown(acceptedReceipt.artifact_id);
});}catch{}
const pending=spool.uploadStatus('large-output'),before=calls;
try{await spool.uploadPending('large-output',sink);}catch{}
const persistedUpload=JSON.parse(fs.readFileSync(path.join(root,createHash('sha256').update('large-output').digest('hex'),'uploads.json')));
const unknownNoRetry=pending.pending_unknown===true&&calls===before&&
 persistedUpload.pending.candidate_artifact_id===acceptedReceipt.artifact_id;
let mismatch=false;
try{await spool.reconcilePendingUpload('large-output',async p=>({...acceptedReceipt,digest:'sha256:'+'0'.repeat(64)}));}
catch{mismatch=true;}
const reconciled=await spool.reconcilePendingUpload('large-output',async()=>acceptedReceipt);
await spool.uploadPending('large-output',sink);
const reconcileBound=mismatch&&reconciled&&!spool.uploadStatus('large-output').pending_unknown;
const status=spool.uploadStatus('large-output');

const receiptsPath=path.join(root,createHash('sha256').update('large-output').digest('hex'),'upload-receipts.ndjson');
const receipts=fs.readFileSync(receiptsPath,'utf8').trimEnd().split('\n'),firstReceipt=JSON.parse(receipts[0]);
delete firstReceipt.reconciled;
const replayedReceipt={...firstReceipt,reconciled:true};
const replayedBytes=[JSON.stringify(firstReceipt),JSON.stringify(replayedReceipt),...receipts.slice(1)].join('\n')+'\n';
fs.writeFileSync(receiptsPath,replayedBytes);
let manifestCalls=0,lostReply=true;
const invoke=async(action,input)=>{
 if(input.organisation_id!=='org-1'||input.run_id!=='run-1')throw new Error('archive scope');
 if(action==='artifact.manifest.commit'){
  const {organisation_id,run_id,expected_chunks,total_size_bytes,content_digest,complete,truncated,missing_ranges,chunks}=input;
  let actual=0;const content=createHash('sha256');
  for(const chunk of chunks){const row=stored.get(chunk.artifact_id);
   if(!row||row.digest!==chunk.digest||String(row.bytes.length)!==chunk.size_bytes||chunk.offset_bytes!==String(actual))
    throw new Error('archive child mismatch');
   actual+=row.bytes.length;content.update(row.bytes);}
  if(String(actual)!==total_size_bytes||'sha256:'+content.digest('hex')!==content_digest)throw new Error('archive actual content');
  const manifest={schema_version:1,kind:'chunk-manifest',organisation_id,run_id,expected_chunks,total_size_bytes,
   content_digest,complete,truncated,missing_ranges,chunks};
  const bytes=Buffer.from(JSON.stringify(manifest)),digest='sha256:'+createHash('sha256').update(bytes).digest('hex');
  stored.set(idFor(digest),{digest,bytes,manifest});manifestCalls++;
  if(lostReply){lostReply=false;throw new Error('actual fixture lost committed manifest reply');}
  return {...envelope(digest,bytes),manifest_digest:digest,content_digest,chunk_count:chunks.length};
 }
 if(action==='artifact.object.put'){
  const bytes=Buffer.from(input.data_base64,'base64');
  if('sha256:'+createHash('sha256').update(bytes).digest('hex')!==input.digest)throw new Error('index bytes');
  stored.set(idFor(input.digest),{digest:input.digest,bytes});return envelope(input.digest,bytes);
 }
 const row=action==='artifact.object.locate'?[...stored.values()].find(v=>v.digest===input.digest):stored.get(input.artifact_id);
 if(!row)throw new Error('missing actual fixture bytes');
 return {...envelope(row.digest,row.bytes),data_base64:row.bytes.toString('base64'),
  ...(row.manifest?{manifest:row.manifest,manifest_digest:row.digest,content_digest:row.manifest.content_digest,chunk_count:row.manifest.chunks.length}:{})};
};
const binding={organisation_id:'org-1',run_id:'run-1',sandbox_id:'logical-sandbox',boot_id:'boot-7',
 boot_generation:'7',logical_process_ref:'logical-process',retention_class:'RUN',retention_until:null,retention_hold:false};
let lostRejected=false;try{await spool.sealStreams('large-output',invoke,binding,64);}catch{lostRejected=true;}
const archive=await spool.sealStreams('large-output',invoke,binding,64);
const expected=Object.fromEntries(['organisation_id','run_id','sandbox_id','boot_id','boot_generation','resource',
 'logical_process_ref','native_process_ref','operation_id','payload_digest','scope_digest'].map(k=>[k,archive.index[k]]));
const verified=await verifyRailwayStreamArchive(invoke,archive.reference,expected);
const receiptReplay=verified.complete;
const conflicting={...replayedReceipt,receipt:{...replayedReceipt.receipt,receipt_id:'sha256:'+'0'.repeat(64)}};
fs.writeFileSync(receiptsPath,[JSON.stringify(firstReceipt),JSON.stringify(conflicting),...receipts.slice(1)].join('\n')+'\n');
let conflictingReceipt=false;
try{await spool.sealStreams('large-output',invoke,binding,64);}catch{conflictingReceipt=true;}
fs.writeFileSync(receiptsPath,replayedBytes);
const finalReceipt=JSON.parse(receipts.at(-1));
fs.appendFileSync(receiptsPath,JSON.stringify({...finalReceipt,reconciled:true})+'\n');
const finalReplay=(await spool.sealStreams('large-output',invoke,binding,64)).complete;
fs.writeFileSync(receiptsPath,replayedBytes+JSON.stringify({...finalReceipt,receipt:{...finalReceipt.receipt,receipt_id:'sha256:'+'0'.repeat(64)}})+'\n');
let finalConflict=false;try{await spool.sealStreams('large-output',invoke,binding,64);}catch{finalConflict=true;}
fs.writeFileSync(receiptsPath,replayedBytes+JSON.stringify({...finalReceipt,sequence:finalReceipt.sequence+1})+'\n');
let unknownTail=false;try{await spool.sealStreams('large-output',invoke,binding,64);}catch{unknownTail=true;}
fs.writeFileSync(receiptsPath,replayedBytes);
const segmented=verified.complete&&archive.index.streams.stdout.segments.length>=3&&
 archive.index.streams.stdout.digest==='sha256:'+createHash('sha256').update(Buffer.alloc(size,120)).digest('hex')&&
 archive.index.streams.stderr.size_bytes==='0'&&archive.index.byte_count===String(size);
const uniqueManifests=new Set([...archive.index.streams.stdout.segments,...archive.index.streams.stderr.segments].map(s=>s.digest));
const archiveRecovery=lostRejected&&manifestCalls===uniqueManifests.size;
let wrongBoot=false;try{await verifyRailwayStreamArchive(invoke,archive.reference,{...expected,boot_id:'copied-boot'});}catch{wrongBoot=true;}
const child=[...stored.values()].find(v=>v.bytes.length===65536&&!v.manifest),originalChild=child.bytes;
child.bytes=Buffer.from(originalChild);child.bytes[0]^=1;
let archiveCorrupt=false;try{await verifyRailwayStreamArchive(invoke,archive.reference,expected);}catch{archiveCorrupt=true;}
child.bytes=originalChild;
const fresh=new RailwaySessionSpool(root);
const indexRestart=fresh.find(resource,session).operation_id==='large-output';
// Locate the actual secondary index by its explicit persisted session binding.
const indexFile=fs.readdirSync(path.join(root,'sessions')).map(n=>path.join(root,'sessions',n)).find(p=>JSON.parse(fs.readFileSync(p)).session_name===session);
const indexBytes=fs.readFileSync(indexFile),indexObject=JSON.parse(indexBytes);indexObject.resource.sandbox_boot_generation='8';
fs.writeFileSync(indexFile,JSON.stringify(indexObject));
let indexCorrupt=false;try{new RailwaySessionSpool(root).find(resource,session);}catch{indexCorrupt=true;}
fs.writeFileSync(indexFile,indexBytes);

// Synthetic adversarial spool journal: preserves the actual process binding,
// changes only fixture bytes, and must refuse an over-bound proof before return.
const operationFolder=path.join(root,createHash('sha256').update('large-output').digest('hex'));
const saved=new Map(['session.json','chunks.ndjson','stdout.spool','stderr.spool'].map(name=>{
 const filename=path.join(operationFolder,name);return [name,fs.existsSync(filename)?fs.readFileSync(filename):null];
}));
let captureLimit=false;
try{
 const record=JSON.parse(saved.get('session.json'));
 // Explicit byte-journal fixtures prove empty and cross-stream order; these
 // are local component inputs, not additional cloud/process observations.
 record.chunk_count=0;record.byte_count='0';record.stream_bytes={stdout:'0',stderr:'0'};
 fs.writeFileSync(path.join(operationFolder,'session.json'),JSON.stringify(record));
 for(const name of ['chunks.ndjson','stdout.spool','stderr.spool']){const filename=path.join(operationFolder,name);if(fs.existsSync(filename))fs.unlinkSync(filename);}
 const empty=spool.readCapturedOutput(resource,session,16*1024*1024);
 captureOrdered&&=empty.capture.chunks.length===0&&empty.spool_digest==='sha256:'+createHash('sha256').update(Buffer.alloc(0)).digest('hex');
 const mixed=[{stream:'stdout',offset:'0',byte:'A'},{stream:'stderr',offset:'0',byte:'B'},{stream:'stdout',offset:'1',byte:'C'}];
 record.chunk_count=3;record.byte_count='3';record.stream_bytes={stdout:'2',stderr:'1'};
 fs.writeFileSync(path.join(operationFolder,'session.json'),JSON.stringify(record));
 fs.writeFileSync(path.join(operationFolder,'stdout.spool'),'AC',{mode:0o600});
 fs.writeFileSync(path.join(operationFolder,'stderr.spool'),'B',{mode:0o600});
 fs.writeFileSync(path.join(operationFolder,'chunks.ndjson'),mixed.map((item,sequence)=>JSON.stringify({sequence,stream:item.stream,offset:item.offset,size:1,digest:'sha256:'+createHash('sha256').update(item.byte).digest('hex'),file:item.stream+'.spool'})).join('\n')+'\n',{mode:0o600});
 const interleaved=spool.readCapturedOutput(resource,session,16*1024*1024);
 captureOrdered&&=interleaved.capture.chunks.length===3&&interleaved.capture.chunks.map(chunk=>chunk.stream).join(',')==='stdout,stderr,stdout'&&
  interleaved.spool_digest==='sha256:'+createHash('sha256').update('ABC').digest('hex')&&
  interleaved.spool_digest!=='sha256:'+createHash('sha256').update(Buffer.concat([interleaved.stdout,interleaved.stderr])).digest('hex');
 const offsets={stdout:0,stderr:0},rows=[];
 for(let sequence=0;sequence<4097;sequence++){
  const stream=sequence%2?'stderr':'stdout';
  rows.push({sequence,stream,offset:String(offsets[stream]++),size:1,digest:'sha256:'+createHash('sha256').update('x').digest('hex'),file:stream+'.spool'});
 }
 record.chunk_count=rows.length;record.byte_count=String(rows.length);record.stream_bytes={stdout:String(offsets.stdout),stderr:String(offsets.stderr)};
 fs.writeFileSync(path.join(operationFolder,'session.json'),JSON.stringify(record));
 fs.writeFileSync(path.join(operationFolder,'chunks.ndjson'),rows.map(row=>JSON.stringify(row)).join('\n')+'\n');
 for(const stream of ['stdout','stderr'])fs.writeFileSync(path.join(operationFolder,stream+'.spool'),Buffer.alloc(offsets[stream],120),{mode:0o600});
 try{spool.readCapturedOutput(resource,session,16*1024*1024);}catch(error){captureLimit=String(error).includes('RAILWAY_CAPTURE_PROOF_LIMIT');}
}finally{for(const [name,bytes]of saved){const filename=path.join(operationFolder,name);if(bytes===null)fs.unlinkSync(filename);else fs.writeFileSync(filename,bytes);}}
captureLimit&&=spool.find(resource,session).phase==='EXITED'&&spool.readCapturedOutput(resource,session,16*1024*1024).complete;

process.stdout.write(JSON.stringify({captureOrdered,captureLimit,finalReplay,finalConflict,unknownTail,readMatches:output.stdout.byteLength===size&&output.stderr.byteLength===0&&output.exit_code===0,
 tooSmall,calls,status,unknownNoRetry,reconcileBound,segmented,archiveRecovery,wrongBoot,archiveCorrupt,indexRestart,indexCorrupt,receiptReplay,conflictingReceipt}));
"""
   upload=subprocess.run(["node","--input-type=module","-e",uploader_js,str(Path(folder)/"spool"),
      str(Path(folder)/"artifact-fixture"),session,str(size)],cwd=c.ROOT,capture_output=True,text=True,timeout=40)
   c.expect(upload.returncode==0,upload.stderr)
   uploaded=json.loads(upload.stdout)
   c.check(IDS[2],lambda:c.expect(proof()["digest"]==c.sha(b"x"*size) and proof()["chunks"]>128 and
      proof()["durable_upload_qualified"] is False and uploaded["readMatches"] and uploaded["tooSmall"] and
      uploaded["status"]["all_chunks_uploaded"] is True and uploaded["status"]["manifest_required"] is True and
      uploaded["status"]["durable_upload_qualified"] is False and uploaded["calls"]==proof()["chunks"],
      "actual byte reader, artifact facade uploads and manifest distinction"))
   c.check(IDS[22],lambda:c.expect(uploaded["unknownNoRetry"],"unknown accepted object put was blindly retried"))
   c.check(IDS[23],lambda:c.expect(uploaded["reconcileBound"],"upload reconciliation receipt binding"))
   for index,key in [(25,"segmented"),(26,"archiveRecovery"),(27,"wrongBoot"),(28,"archiveCorrupt"),(29,"indexRestart"),(30,"indexCorrupt"),(31,"receiptReplay"),(32,"conflictingReceipt"),(33,"finalReplay"),(34,"finalConflict"),(35,"unknownTail"),(36,"captureOrdered"),(37,"captureLimit")]:
    c.check(IDS[index],lambda key=key:c.expect(uploaded[key],"archive/session regression: "+key))

   binary_bytes=bytes([255,0,254,195,169])
   binary_op,binary_session=start(service,"binary-output",[sys.executable,"-c","import os;os.write(1,bytes([255,0,254,195,169]))"])
   binary_exit=wait_exit(service,binary_session)
   binary_file=Path(folder)/"spool"/hashlib.sha256(b"binary-output").hexdigest()/"stdout.spool"
   c.check(IDS[24],lambda:c.expect(binary_file.read_bytes()==binary_bytes and
      binary_exit["output"]["sha256"]==c.sha(binary_bytes) and binary_exit["output"]["byte_count"]=="5",
      "SDK UTF8 decoder changed binary stdout"))

   directory=Path(folder)/"spool"/hashlib.sha256(b"large-output").hexdigest()
   output=directory/"stdout.spool";original=output.read_bytes()
   with output.open("r+b") as stream:stream.seek(1);stream.write(b"y")
   c.check(IDS[3],lambda:c.reject(service.call("9.3","railway.process.spool.verify",{"operation_id":"large-output"})))
   output.write_bytes(original)
   index=directory/"chunks.ndjson";index_bytes=index.read_bytes();index.write_bytes(index_bytes+b"{")
   c.check(IDS[4],lambda:c.reject(service.call("9.3","railway.process.spool.verify",{"operation_id":"large-output"})))
   index.write_bytes(index_bytes)
   c.check(IDS[5],lambda:c.expect(proof()["complete"] is True,"restored exact spool"))
   count=len(ws.snapshot()["sessions"])
   c.check(IDS[6],lambda:c.reject(service.call("9.3","railway.process.start",{"operation":op})))
   c.check(IDS[7],lambda:c.expect(len(ws.snapshot()["sessions"])==count,"duplicate process spawned"))
   c.check(IDS[8],lambda:c.reject(service.call("9.3","railway.process.inspect",
      {"resource":c.RESOURCE|{"sandbox_boot_generation":"8"},"process_ref":session})))
   cat_op,cat=start(service,"stdin-cat",["cat"],stdin=True)
   queued=c.result(service.call("9.3","railway.process.stdin",{"resource":c.RESOURCE,"process_ref":cat,
      "bytes_base64":base64.b64encode(b"hello\n").decode()}))
   c.check(IDS[9],lambda:c.expect(queued["queued_to_transport"] is True and queued["consumed_by_process"] is False,
      "transport acknowledgement must not claim consumption"))
   deadline=time.monotonic()+5
   cat_file=Path(folder)/"spool"/hashlib.sha256(b"stdin-cat").hexdigest()/"stdout.spool"
   while (not cat_file.exists() or cat_file.stat().st_size<6) and time.monotonic()<deadline:time.sleep(.02)
   c.check(IDS[10],lambda:c.expect(cat_file.read_bytes()==b"hello\n","actual stdin echo"))
   c.check(IDS[11],lambda:c.reject(service.call("9.3","railway.process.stdin",{"resource":c.RESOURCE,"process_ref":cat,
      "bytes_base64":base64.b64encode(b"a"*16385).decode()})))
   ws.mode.write_text('{"unsupported":false,"ignore_signals":true}')
   fixture.config["request_timeout_ms"]=250;fixture.write_config()
   before=time.monotonic()
   uncertain_stop=c.operation("stop","unconfirmed-stop",{"process_ref":cat,"signal":"KILL"})
   c.check(IDS[20],lambda:(c.reject(service.call("9.3","railway.process.stop",{"operation":uncertain_stop})),
      c.expect(time.monotonic()-before<3,"unconfirmed termination was unbounded")))
   c.check(IDS[21],lambda:c.expect(ws.snapshot()["sessions"][cat]["running"] is True,
      "unconfirmed termination became exit"))
   ws.mode.write_text('{"unsupported":false,"ignore_signals":false}')
   fixture.config["request_timeout_ms"]=10000;fixture.write_config()
   stopped=stop(service,cat,"stop-cat")
   c.check(IDS[12],lambda:c.expect(stopped["phase"]=="EXITED" and stopped["termination_confirmed"] is True and
      stopped["exit_code"]==-1,"confirmed OS kill"))
   sleep_op,sleeper=start(service,"detach-sleeper",[sys.executable,"-c","import time; time.sleep(90)"])
   detached=c.result(service.call("9.3","railway.process.detach",{"resource":c.RESOURCE,"process_ref":sleeper}))
   c.check(IDS[13],lambda:c.expect(detached["detached"] is True and detached["termination_confirmed"] is False,
      "detach is not termination"))
   c.check(IDS[14],lambda:c.reject(service.call("9.3","railway.process.stdin",{"resource":c.RESOURCE,
      "process_ref":sleeper,"bytes_base64":base64.b64encode(b"x").decode()})))
   def alive():
    entry=ws.snapshot()["sessions"][sleeper]
    c.expect(entry["running"] is True,entry);os.kill(entry["pid"],0)
   c.check(IDS[15],alive)
   stopped=stop(service,sleeper,"stop-after-detach")
   c.check(IDS[16],lambda:c.expect(stopped["termination_confirmed"] is True and stopped["output"]["complete"] is False,
      "reattachment cannot make replay complete evidence"))
   c.check(IDS[17],lambda:c.expect(not any("sandboxExec(" in row["query"] for row in fixture.requests),"HTTP exec used"))
   ws.mode.write_text('{"unsupported":true}')
   prior=len(ws.snapshot()["sessions"])
   unsupported=c.operation("execute","unsupported-host")
   unsupported["parameters"]["stdin"]=True
   unsupported["identity"]["payload_digest"]=c.digest({k:unsupported[k] for k in
      ["kind","scope","resource","preparation_digest","deadline_at","parameters"]})
   c.check(IDS[18],lambda:(c.reject(service.call("9.3","railway.process.start",{"operation":unsupported})),
      c.expect(len(ws.snapshot()["sessions"])==prior,"unsupported host launched process")))
   service.close();ws.close();fixture.close()
   c.check(IDS[19],lambda:(c.expect(all(not row["running"] for row in ws.snapshot()["sessions"].values()),
      "remaining live child"),reap_fixture_descendants()))
   complete=True
  finally:
   if service.process.poll() is None:service.process.kill();service.process.wait()
   if not complete:
    events=Path(str(ws.state)+'.events')
    if events.exists():Path('/tmp/hyperfide/logs/domain09-process-debug.events').write_bytes(events.read_bytes())
    Path('/tmp/hyperfide/logs/domain09-process-debug-state.json').write_text(json.dumps(ws.snapshot()))
    if ws.process.poll() is None:ws.close()
    fixture.close()
   print(json.dumps({"type":"cleanup","resources":[],"complete":complete}),flush=True)
 return 1 if c.FAILED or not complete else 0
if __name__=="__main__":sys.exit(main())
