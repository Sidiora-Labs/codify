#!/usr/bin/env python3
"""Real migrations, synchronous physical replication, loss and restored identity fences."""
import sys,os,json,tempfile,subprocess,uuid,time,shutil,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/cases/support'))
from postgres_cluster import PostgresCluster
BASE=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task44-standalone'))/'storage44'
BASE.mkdir(parents=True,exist_ok=True);STATE=BASE/'resource.json'
IDS=['artifact_reference_ack', 'artifact_reference_promotion', 'artifact_reference_restore']+['semantic_business_version', 'semantic_business_guard', 'semantic_monotonic', 'semantic_single_step', 'semantic_spec_monotonic']+['semantic_concurrent_writes', 'semantic_concurrent_write_read', 'semantic_concurrent_read_write']+['semantic_retry', 'semantic_fresh', 'semantic_wait', 'semantic_idempotent', 'semantic_generation', 'semantic_upgrade', 'semantic_missing']+['journal_replay_proof', 'journal_unknown_fork', 'journal_unchanged_head']+['journal_missing_database_head', 'restore_writer_binding', 'restore_receipt_digest', 'restore_external_immutable', 'restore_database_immutable']+['journal_concurrent', 'journal_missing_head', 'journal_unknown_ack', 'journal_unknown_pending', 'journal_unknown_committed', 'journal_unknown_reconcile', 'journal_unknown_no_replay']+['external_current', 'journal_persisted_uuid', 'journal_pending', 'journal_absence_refuses', 'journal_other_operation', 'journal_unconfirmed', 'restore_old_startup_refused', 'restore_external_mismatch', 'restore_ordinary_refused', 'restore_wrong_lineage', 'restore_external_head', 'restore_lineages', 'restore_replay']+['physical_primary','fresh','ready','replay','drift','lower','duplicate','atomic','guard_omission','guard_atomic','transaction_escape','symlink','concurrent','operator_refused','legacy_ready','bootstrap_epoch','activation_replay','fence_required','invalid_fence','runtime_ready','runtime_no_ddl','runtime_no_metadata','runtime_migration_refused','missing_readiness','epoch_guard','stale_guard','large_manifest','oversize_manifest','physical_standby','sync_durable','no_standby_no_ack','unknown_reconcile','old_primary_isolated','promotion_survives','fresh_recovery_epoch','old_identity_refused','old_activation_refused','restore_complete','restore_fresh_epoch','cleanup','sync_policy_required','sync_policy_missing','sync_policy_ready','sync_policy_precommit']
ORG='10000000-0000-4000-8000-000000000001';RUN='10000000-0000-4000-8000-000000000002';PROJECT='10000000-0000-4000-8000-000000000003';SPEC='10000000-0000-4000-8000-000000000004'
FIXTURE='import fs from \'node:fs/promises\';\nimport path from \'node:path\';\nimport {createHash,randomUUID} from \'node:crypto\';\nimport {execFileSync} from \'node:child_process\';\nimport net from \'node:net\';\nimport {MigrationCoordinator,AuthorityStore,assertRuntimePrivileges,assertMigrationSource,lookupAuthorityActivation,assertExternalAuthorityCurrent} from \'DURABILITY_URL\';\nimport {readSemanticDisposition,writeSemanticDisposition} from \'DISPOSITIONS_URL\';\nimport {FileExternalAuthorityJournal} from \'JOURNAL_URL\';\nimport {bootstrapAuthoritySchema,getPool} from \'SCHEMA_URL\';\nconst digest=x=>\'sha256:\'+createHash(\'sha256\').update(x).digest(\'hex\');\nexport function createComponent(c){\n const resources=c.resources;const journal=new FileExternalAuthorityJournal(c.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR,i=>lookupAuthorityActivation(resources,i));const authority=new AuthorityStore(resources,c.env.HYPERFIDE_DEPLOYMENT_ID,journal);\n const params=JSON.parse(c.env.HF44_PARAMETERS);\n const fencer={isolate:async input=>{\n  let isolated;\n  if(input.source_epoch===null){try{await fs.access(path.join(params.root,\'no-predecessor\'));throw Error(\'Unexpected predecessor\');}catch(e){if(e.code!==\'ENOENT\')throw e;}isolated=\'owned-new-cluster-with-no-predecessor\';}\n  else{\n   let status;try{execFileSync(\'runuser\',[\'-u\',\'postgres\',\'--\',\'/usr/lib/postgresql/18/bin/pg_ctl\',\'-D\',params.oldPrimary,\'status\'],{stdio:\'pipe\'});status=0;}catch(e){status=e.status;}\n   if(status===0)execFileSync(\'runuser\',[\'-u\',\'postgres\',\'--\',\'/usr/lib/postgresql/18/bin/pg_ctl\',\'-D\',params.oldPrimary,\'-m\',\'immediate\',\'-w\',\'stop\'],{stdio:\'pipe\',timeout:15000});\n   try{execFileSync(\'runuser\',[\'-u\',\'postgres\',\'--\',\'/usr/lib/postgresql/18/bin/pg_ctl\',\'-D\',params.oldPrimary,\'status\'],{stdio:\'pipe\'});throw Error(\'Old primary remains running\');}catch(e){if(e.status!==3)throw e;}\n   await new Promise((resolve,reject)=>{const socket=net.connect(params.oldSocket);socket.once(\'connect\',()=>{socket.destroy();reject(Error(\'Old writer socket remains reachable\'));});socket.once(\'error\',e=>{socket.destroy();[\'ENOENT\',\'ECONNREFUSED\'].includes(e.code)?resolve():reject(e);});});\n   isolated=params.oldPrimary;\n  }\n  const now=Date.now();const receipt={deployment_id:input.deployment_id,operation_id:input.operation_id,fence_id:randomUUID(),source_epoch:input.source_epoch,isolated_writer:isolated,observed_at:new Date(now).toISOString(),expires_at:new Date(now+25000).toISOString(),evidence_digest:digest(isolated)};await fs.writeFile(path.join(c.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR,input.operation_id+\'.fence.json\'),JSON.stringify(receipt),{mode:0o600});return receipt;\n }};\n const err=async(fn,code)=>{try{await fn();return false;}catch(e){return e.code===code;}};\n return {apiVersion:1,actions:{\'fixture44.execute\':async input=>{\n  const out={};\n  if(input.mode===\'migration\'){\n   const migrations=new MigrationCoordinator(resources);\n   const before=await migrations.inspect();out.initial_missing=!before.ready;\n   const receipt=await migrations.apply({timeoutMs:30000});out.fresh=JSON.stringify(receipt.applied)===JSON.stringify(before.pending);\n   out.ready=(await migrations.inspect()).ready;out.replay=(await migrations.apply()).applied.length===0;\n   const scratch=await fs.mkdtemp(path.join(params.root,\'migration-sources-\'));\n   const original=path.resolve(c.env.HF44_MIGRATIONS);\n   const copy=async()=>{for(const file of await fs.readdir(scratch))await fs.unlink(path.join(scratch,file));for(const file of await fs.readdir(original))if(file.endsWith(\'.sql\'))await fs.copyFile(path.join(original,file),path.join(scratch,file));};\n   const custom=new MigrationCoordinator(resources,scratch);\n   await copy();await fs.appendFile(path.join(scratch,\'0001-authority.sql\'),\'\\n-- drift\\n\');out.drift=await err(()=>custom.apply(),\'MIGRATION_DRIFT\');\n   await copy();await fs.writeFile(path.join(scratch,\'0009-late.sql\'),\'SELECT 1;\');out.lower=await err(()=>custom.apply(),\'MIGRATION_ORDER_INVALID\');\n   await copy();await fs.writeFile(path.join(scratch,\'0004-duplicate.sql\'),\'SELECT 1;\');out.duplicate=await err(()=>custom.apply(),\'MIGRATION_INVALID\');\n   await copy();await fs.writeFile(path.join(scratch,\'9999-failure.sql\'),\'CREATE TABLE hyperfide.failed_migration(x int);SELECT 1/0;\');\n   try{await custom.apply();out.atomic=false;}catch{out.atomic=(await resources.observe({preferReplica:false},s=>s.query("SELECT to_regclass(\'hyperfide.failed_migration\') IS NULL AS absent"))).value.rows[0].absent;}\n   await copy();await fs.writeFile(path.join(scratch,\'9999-unguarded.sql\'),\'CREATE TABLE hyperfide.unguarded_migration(x int);\');out.guard_omission=await err(()=>custom.apply(),\'MIGRATION_GUARD_MISSING\');\n   out.guard_atomic=(await resources.observe({},s=>s.query("SELECT to_regclass(\'hyperfide.unguarded_migration\') IS NULL AS absent"))).value.rows[0].absent;\n   await copy();await fs.writeFile(path.join(scratch,\'9999-escape.sql\'),\'CREATE TABLE hyperfide.escaped_migration(x int);COMMIT;\');out.transaction_escape=await err(()=>custom.apply(),\'MIGRATION_INVALID\');\n   await copy();await fs.symlink(path.join(original,\'0001-authority.sql\'),path.join(scratch,\'9999-symlink.sql\'));out.symlink=await err(()=>custom.apply(),\'MIGRATION_INVALID\');\n   await fs.rm(scratch,{recursive:true,force:true});\n   out.concurrent=(await Promise.all([migrations.apply(),migrations.apply()])).every(x=>x.applied.length===0);\n   out.operator_refused=await err(()=>assertRuntimePrivileges(resources),\'RUNTIME_DDL_PRIVILEGE\');\n   out.legacy_ready=(await bootstrapAuthoritySchema(getPool(c.env))).applied===false;\n   const activation=await authority.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer);\n   out.epoch=activation.epoch;out.bootstrap_epoch=activation.replayed===false;\n   out.activation_replay=(await authority.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer)).epoch===activation.epoch;\n   out.fence_required=await err(()=>authority.activate({operation_id:randomUUID(),expected_previous_epoch:activation.epoch},null),\'EXTERNAL_FENCE_REQUIRED\');\n   out.invalid_fence=await err(()=>authority.activate({operation_id:randomUUID(),expected_previous_epoch:activation.epoch},{isolate:async i=>({...await fencer.isolate({...i,source_epoch:null}),source_epoch:i.source_epoch,operation_id:randomUUID()})}),\'EXTERNAL_FENCE_INVALID\');\n   return out;\n  }\n  if(input.mode===\'guard\'){\n   await resources.gateway.withPrimaryTransaction({guard:tx=>authority.assertCurrent(tx,input.scope)},async tx=>{await tx.query("INSERT INTO hyperfide.organisations(id,name) VALUES($1,\'guarded\')",[input.id]);});\n   return {guarded:true};\n  }\n  if(input.mode===\'stale\')return {stale:await err(()=>resources.gateway.withPrimaryTransaction({guard:tx=>authority.assertCurrent(tx,input.scope)},tx=>tx.query("INSERT INTO hyperfide.organisations(id,name) VALUES($1,\'stale\')",[input.id])),\'STALE_AUTHORITY\')};\n  if(input.mode===\'activate\')return authority.activate({operation_id:input.operation_id,expected_previous_epoch:input.epoch},fencer);\n  if(input.mode===\'restore\')return authority.activateRestored({operation_id:input.operation_id,expected_external_epoch:input.external_epoch,expected_database_epoch:input.database_epoch},fencer);\n  if(input.mode===\'external\')return assertExternalAuthorityCurrent(resources,journal,{deployment_id:c.env.HYPERFIDE_DEPLOYMENT_ID});\n  if(input.mode===\'journal_head\')return journal.current({deployment_id:c.env.HYPERFIDE_DEPLOYMENT_ID});\n  if(input.mode===\'pending\'){\n   const deployment=input.deployment_id,operation_id=input.operation_id;\n   const proof=await fencer.isolate({deployment_id:deployment,operation_id,source_epoch:null});\n   const prepared=await journal.prepareActivation({deployment_id:deployment,operation_id,expected_previous_epoch:null,fence_evidence_digest:digest(JSON.stringify(proof))});\n   const replay=await journal.prepareActivation({deployment_id:deployment,operation_id,expected_previous_epoch:null,fence_evidence_digest:digest(JSON.stringify(proof))});\n   const store=new AuthorityStore(resources,deployment,journal);\n   return {persisted_uuid:prepared.epoch===replay.epoch&&!prepared.replayed&&replay.replayed,\n    pending:await err(()=>journal.current({deployment_id:deployment}),\'EXTERNAL_AUTHORITY_PENDING\'),\n    absence_refuses:await err(()=>store.activate({operation_id,expected_previous_epoch:null},fencer),\'AUTHORITY_OPERATION_PENDING\'),\n    other_operation:await err(()=>journal.prepareActivation({deployment_id:deployment,operation_id:randomUUID(),expected_previous_epoch:null,fence_evidence_digest:digest(JSON.stringify(proof))}),\'EXTERNAL_AUTHORITY_PENDING\'),\n    unconfirmed:await err(()=>journal.publishCommitted({deployment_id:deployment,operation_id,expected_previous_epoch:null,epoch:prepared.epoch}),\'AUTHORITY_OPERATION_UNCONFIRMED\')};\n  }\n  if(input.mode===\'artifact_metadata\'){\n   const directory=path.join(params.root,\'artifact-fixture\');await fs.mkdir(directory,{mode:0o700});\n   const bytes=Buffer.from(\'actual-owned-artifact-reference-fixture-v1\\n\'),child=randomUUID(),parent=randomUUID();\n   const childFile=path.join(directory,child+\'.bin\'),manifestFile=path.join(directory,parent+\'.json\');\n   const manifest=JSON.stringify({schema_version:1,child,digest:digest(bytes),size:bytes.length});\n   for(const [file,content] of [[childFile,bytes],[manifestFile,manifest]]){\n    const handle=await fs.open(file,\'wx\',0o600);try{await handle.writeFile(content);await handle.sync();}finally{await handle.close();}\n   }\n   const dir=await fs.open(directory,\'r\');try{await dir.sync();}finally{await dir.close();}\n   const scope=input.scope;\n   await resources.gateway.withPrimaryTransaction({guard:async tx=>{await writeSemanticDisposition(tx,scope);await authority.assertCurrent(tx,input.scope);}},async tx=>{\n    await tx.query("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status,completed_at) VALUES($1,$2,$3,$4,$5,\'fixture-local-file\',$6,\'COMPLETE\',clock_timestamp())",[scope.organisation_id,scope.run_id,child,digest(bytes),bytes.length,childFile]);\n    await tx.query("INSERT INTO hyperfide.artifacts(organisation_id,run_id,id,digest,size_bytes,storage_backend,storage_key,status) VALUES($1,$2,$3,$4,$5,\'fixture-local-file\',$6,\'PENDING\')",[scope.organisation_id,scope.run_id,parent,digest(manifest),Buffer.byteLength(manifest),manifestFile]);\n    await tx.query(\'INSERT INTO hyperfide.artifact_dependencies(organisation_id,run_id,parent_artifact_id,child_artifact_id,sequence,offset_bytes,size_bytes) VALUES($1,$2,$3,$4,0,0,$5)\',[scope.organisation_id,scope.run_id,parent,child,bytes.length]);\n   });\n   return {organisation_id:scope.organisation_id,run_id:scope.run_id,parent_artifact_id:parent,child_artifact_id:child,child_digest:digest(bytes),parent_digest:digest(manifest),size_bytes:bytes.length,storage_backend:\'fixture-local-file\',child_status:\'COMPLETE\',parent_status:\'PENDING\',claim:\'scoped-database-reference-metadata-only;no-object-store-durability\'};\n  }\n  if(input.mode===\'semantic\'){\n   const scope=input.scope,fact=randomUUID();\n   const businessBefore=(await resources.observe({preferReplica:false},s=>s.query(\'SELECT state_version::text AS version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2\',[scope.organisation_id,scope.run_id]))).value.rows[0].version;\n   const before=(await resources.observe({preferReplica:false},s=>s.query(\'SELECT semantic_generation::text AS generation FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2\',[scope.organisation_id,scope.run_id]))).value.rows[0].generation;\n   let ready,sampled,readerPid,waitObserved=false,attempts=0,repeat=false,upgrade=false,firstVisible;\n   const writerReady=new Promise(r=>ready=r),readerSampled=new Promise(r=>sampled=r);\n   const writer=resources.gateway.withPrimaryTransaction({timeoutMs:5000,guard:tx=>writeSemanticDisposition(tx,scope)},async tx=>{\n    const one=await writeSemanticDisposition(tx,scope),two=await readSemanticDisposition(tx,scope);\n    repeat=one===two&&one===await writeSemanticDisposition(tx,scope);\n    await tx.query("INSERT INTO hyperfide.organisations(id,name) VALUES($1,\'semantic-race\')",[fact]);\n    ready();await readerSampled;\n    for(let n=0;n<100;n++){\n     const row=(await tx.query("SELECT wait_event_type FROM pg_stat_activity WHERE pid=$1",[readerPid])).rows[0];\n     if(row?.wait_event_type===\'Lock\'){waitObserved=true;break;}\n     await new Promise(r=>setTimeout(r,5));\n    }\n    return one;\n   });\n   const reader=resources.gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:3,guard:async tx=>{\n    attempts++;await writerReady;\n    const sample=(await tx.query(\'SELECT pg_backend_pid() AS pid,(SELECT count(*)::int FROM hyperfide.organisations WHERE id=$1) AS visible\',[fact])).rows[0];\n    if(attempts===1)firstVisible=sample.visible;\n    readerPid=sample.pid;sampled();\n    await readSemanticDisposition(tx,scope);\n   }},async tx=>{\n    const receipt=await readSemanticDisposition(tx,scope);\n    upgrade=await err(()=>writeSemanticDisposition(tx,scope),\'SEMANTIC_FENCE_ORDER\');\n    return {visible:(await tx.query(\'SELECT count(*)::int AS visible FROM hyperfide.organisations WHERE id=$1\',[fact])).rows[0].visible,receipt};\n   });\n   const [written,read]=await Promise.all([writer,reader]);\n   const after=(await resources.observe({preferReplica:false},s=>s.query(\'SELECT semantic_generation::text AS generation FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2\',[scope.organisation_id,scope.run_id]))).value.rows[0].generation;\n   const writeWrite=await resources.gateway.withPrimaryTransaction({},async tx=>{\n    const result=await Promise.all([writeSemanticDisposition(tx,scope),writeSemanticDisposition(tx,scope)]);\n    return result[0]===result[1]&&BigInt(result[0].generation)===BigInt(after)+1n;\n   });\n   const writeRead=await resources.gateway.withPrimaryTransaction({},async tx=>{\n    const result=await Promise.all([writeSemanticDisposition(tx,scope),readSemanticDisposition(tx,scope)]);\n    return result[0]===result[1]&&result[0].mode===\'WRITE\'&&BigInt(result[0].generation)===BigInt(after)+2n;\n   });\n   const readWrite=await resources.gateway.withPrimaryTransaction({},async tx=>{\n    const result=await Promise.allSettled([readSemanticDisposition(tx,scope),writeSemanticDisposition(tx,scope)]);\n    return result[0].status===\'fulfilled\'&&result[1].status===\'rejected\'&&result[1].reason.code===\'SEMANTIC_FENCE_ORDER\';\n   });\n   const final=(await resources.observe({preferReplica:false},s=>s.query(\'SELECT semantic_generation::text AS generation FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2\',[scope.organisation_id,scope.run_id]))).value.rows[0].generation;\n   const businessAfter=(await resources.observe({preferReplica:false},s=>s.query(\'SELECT state_version::text AS version FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2\',[scope.organisation_id,scope.run_id]))).value.rows[0].version;\n   return {observed:{guard_attempts:attempts,first_snapshot:firstVisible,final_snapshot:read.visible,lock_wait_observed:waitObserved,before_generation:before,after_generation:after,final_generation:final,business_version_before:businessBefore,business_version_after:businessAfter},business_version:businessBefore===businessAfter,concurrent_writes:writeWrite,concurrent_write_read:writeRead,concurrent_read_write:readWrite&&BigInt(final)===BigInt(after)+2n,retry:attempts===2,fresh:read.visible===1,wait:waitObserved,idempotent:repeat,\n    generation:BigInt(after)===BigInt(before)+1n&&written.generation===after&&read.receipt.generation===after,\n    upgrade,missing:await err(()=>resources.gateway.withPrimaryTransaction({},tx=>readSemanticDisposition(tx,{organisation_id:scope.organisation_id,run_id:randomUUID()})),\'SEMANTIC_RUN_MISSING\')};\n  }\n  if(input.mode===\'journal_metadata\'){\n   const deployment=c.env.HYPERFIDE_DEPLOYMENT_ID;\n   const substituted=new FileExternalAuthorityJournal(c.env.HYPERFIDE_AUTHORITY_JOURNAL_DIR,async i=>({...await lookupAuthorityActivation(resources,i),evidence_digest:digest(\'substituted-proof\')}));\n   const proof_refused=await err(()=>substituted.publishCommitted({deployment_id:deployment,operation_id:input.operation_id,expected_previous_epoch:null,epoch:input.epoch}),\'EXTERNAL_AUTHORITY_COMMIT_UNVERIFIED\');\n   const fork_refused=await err(()=>journal.prepareActivation({deployment_id:deployment,operation_id:randomUUID(),expected_previous_epoch:input.epoch,expected_database_epoch:randomUUID(),fence_evidence_digest:digest(\'unknown-fork\')}),\'EXTERNAL_AUTHORITY_STALE\');\n   const head=await journal.current({deployment_id:deployment});\n   return {proof_refused,fork_refused,head_unchanged:head.epoch===input.epoch};\n  }\n  if(input.mode===\'concurrent_authority\'){\n   const store=new AuthorityStore(resources,input.deployment_id,journal);\n   const attempts=await Promise.allSettled([store.activate({operation_id:randomUUID(),expected_previous_epoch:null},fencer),store.activate({operation_id:randomUUID(),expected_previous_epoch:null},fencer)]);\n   const accepted=attempts.filter(a=>a.status===\'fulfilled\');\n   const rejected=attempts.filter(a=>a.status===\'rejected\');\n   const head=await journal.current({deployment_id:input.deployment_id});\n   return {single:accepted.length===1&&rejected.length===1&&[\'EXTERNAL_AUTHORITY_BUSY\',\'EXTERNAL_AUTHORITY_PENDING\',\'EXTERNAL_AUTHORITY_STALE\',\'STALE_AUTHORITY\'].includes(rejected[0].reason.code),head:accepted[0]?.value.epoch===head.epoch,\n    rows:(await resources.observe({preferReplica:false},s=>s.query(\'SELECT count(*)::int AS count FROM hyperfide.authority_activations WHERE deployment_id=$1\',[input.deployment_id]))).value.rows[0].count,\n    outcomes:attempts.map(a=>a.status===\'fulfilled\'?{status:\'accepted\',epoch:a.value.epoch}:{status:\'refused\',code:a.reason.code})};\n  }\n  if(input.mode===\'missing_head\'){\n   return {database_refused:await err(()=>journal.prepareActivation({deployment_id:randomUUID(),operation_id:randomUUID(),expected_previous_epoch:null,expected_database_epoch:randomUUID(),fence_evidence_digest:digest(\'actual-negative\')}),\'EXTERNAL_AUTHORITY_UNAVAILABLE\'),refused:await err(()=>journal.prepareActivation({deployment_id:input.deployment_id,operation_id:randomUUID(),expected_previous_epoch:randomUUID(),fence_evidence_digest:digest(\'actual-negative\')}),\'EXTERNAL_AUTHORITY_UNAVAILABLE\')};\n  }\n  if(input.mode===\'unknown_activate\'){\n   const store=new AuthorityStore(resources,input.deployment_id,journal);\n   return store.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer,{timeoutMs:1000,maxRetries:0});\n  }\n  if(input.mode===\'reconcile_unknown\'){\n   const deployment=input.deployment_id;\n   const before=await err(()=>journal.current({deployment_id:deployment}),\'EXTERNAL_AUTHORITY_PENDING\');\n   const store=new AuthorityStore(resources,deployment,journal);\n   const replay=await store.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer);\n   const head=await journal.current({deployment_id:deployment});\n   return {before,replayed:replay.replayed,epoch:replay.epoch,head:head.epoch};\n  }\n  if(input.mode===\'precommit\'){return resources.gateway.withPrimaryTransaction({},async tx=>{for(const sql of ["ALTER SYSTEM SET synchronous_standby_names=\'\'","SELECT pg_reload_conf()"]){execFileSync(\'runuser\',[\'-u\',\'postgres\',\'--\',\'/usr/lib/postgresql/18/bin/psql\',\'-X\',\'-qAt\',\'-h\',path.join(params.root,\'primary-socket\'),\'-p\',\'55441\',\'-U\',\'hf_operator\',\'-d\',\'postgres\',\'-c\',sql],{stdio:\'pipe\'});}for(let i=0;i<100;i++){if((await tx.query("SELECT current_setting(\'synchronous_standby_names\') AS value")).rows[0].value===\'\')break;await new Promise(r=>setTimeout(r,10));}return {should_not_ack:true};});}\n  if(input.mode===\'durable\')return resources.gateway.withPrimaryTransaction({timeoutMs:input.timeoutMs??5000,maxRetries:0},async tx=>{await tx.query("INSERT INTO hyperfide.organisations(id,name) VALUES($1,\'durable\')",[input.id]);return {id:input.id};});\n  if(input.mode===\'inspect\')return {ready:(await new MigrationCoordinator(resources).inspect()).ready};\n  if(input.mode===\'replayed_old\')return {refused:await err(()=>authority.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer),\'STALE_AUTHORITY\')};\n  throw Error(\'Unknown trusted fixture action\');\n }}};\n}\n'
class CommitAckProxy:
 def __init__(self,directory):
  import socket,threading
  self.socket=socket;self.threading=threading;self.lock=threading.Lock();self.drop=True;self.dropped=False;self.stopped=False;self.connections=[]
  self.path=str(Path(directory)/('.s.PGSQL.'+os.environ['PGPORT']))
  self.target=str(Path(os.environ['PGHOST'])/('.s.PGSQL.'+os.environ['PGPORT']))
  self.listener=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);self.listener.bind(self.path);self.listener.listen();self.listener.settimeout(.1)
  self.thread=threading.Thread(target=self.accept,daemon=True);self.thread.start()
 def accept(self):
  while not self.stopped:
   try:client,_=self.listener.accept()
   except self.socket.timeout:continue
   except OSError:return
   server=self.socket.socket(self.socket.AF_UNIX,self.socket.SOCK_STREAM);server.connect(self.target)
   self.connections.extend([client,server]);state={'commit':False}
   for source,target,frontend in [(client,server,True),(server,client,False)]:
    self.threading.Thread(target=self.forward,args=(source,target,state,frontend),daemon=True).start()
 def forward(self,source,target,state,frontend):
  buffer=b'';startup=frontend
  try:
   while True:
    data=source.recv(65536)
    if not data:return
    buffer+=data
    while True:
     if startup:
      if len(buffer)<4:break
      length=int.from_bytes(buffer[:4],'big')
      if len(buffer)<length:break
      packet,buffer=buffer[:length],buffer[length:];target.sendall(packet);startup=False;continue
     if len(buffer)<5:break
     length=int.from_bytes(buffer[1:5],'big')+1
     if len(buffer)<length:break
     packet,buffer=buffer[:length],buffer[length:]
     if frontend and packet[:1]==b'P' and b'INSERT INTO hyperfide.authority_activations' in packet:state['activation']=True
     if frontend and packet[:1]==b'Q' and packet[5:].rstrip(b'\0').strip().upper()==b'COMMIT':state['commit']=True
     if not frontend and state['commit'] and state.get('activation') and packet[:1]==b'C' and packet[5:]==b'COMMIT\0':
      with self.lock:
       if self.drop:self.drop=False;self.dropped=True;return
     target.sendall(packet)
  except OSError:pass
  finally:
   for connection in [source,target]:
    try:connection.shutdown(self.socket.SHUT_RDWR)
    except OSError:pass
    connection.close()
 def close(self):
  self.stopped=True;self.listener.close()
  for connection in self.connections:
   try:connection.shutdown(self.socket.SHUT_RDWR)
   except OSError:pass
   connection.close()
  self.thread.join(timeout=1);Path(self.path).unlink(missing_ok=True)

def uid():return str(uuid.uuid4())
def cleanup(emit=True):
 state=json.loads(STATE.read_text()) if STATE.exists() else {}
 root=Path(state['root']) if state.get('root') else None
 if root and root.exists():
  if root.parent!=Path('/tmp/hyperfide') or not root.name.startswith('hf-pg-') or root.is_symlink():raise ValueError('Invalid owned PG resource')
  for directory in root.iterdir():
   if directory.is_dir() and (directory/'postmaster.pid').exists():
    subprocess.run(['runuser','-u','postgres','--','/usr/lib/postgresql/18/bin/pg_ctl','-D',str(directory),'-m','immediate','-w','stop'],capture_output=True,timeout=20)
  if all(not (directory/'postmaster.pid').exists() for directory in root.iterdir() if directory.is_dir()):shutil.rmtree(root)
 absent=root is None or not root.exists()
 (BASE/'absence.json').write_text(json.dumps({'cluster_root_absent':absent})+'\n')
 if emit:print(json.dumps({'type':'cleanup','complete':absent,'resources':[{'id':'hf-task-4.4-clusters','status':'deleted' if absent else 'unknown','observed_absent':absent,'evidence_artifact':'storage44/absence.json'}]}),flush=True)
 return absent
def main():
 if '--cleanup' in sys.argv:return 0 if cleanup() else 1
 observed={};c=None
 try:
  ownedroot=Path(tempfile.mkdtemp(prefix='hf-pg-',dir='/tmp/hyperfide'));STATE.write_text(json.dumps({'root':str(ownedroot)})+'\n');c=PostgresCluster(root=ownedroot)
  observed['physical_primary']=c.sql('SELECT version()').startswith('PostgreSQL 18')
  with tempfile.TemporaryDirectory(prefix='hf44-service-',dir='/tmp/hyperfide') as tmp:
   folder=Path(tmp);modules=folder/'modules';registry=folder/'components';modules.mkdir();registry.mkdir()
   (modules/'package.json').write_text('{"type":"module"}')
   for id,name,actions,requires in [('4.2','runtime',['storage.runtime.describe'],[]),('4.4','durability',['storage.migrations.inspect','storage.migrations.apply','storage.durability.inspect'],['4.2']),('fixture','fixture',['fixture44.execute'],['4.2','4.4'])]:
    if id!='fixture':(modules/(name+'.js')).write_text("export {createComponent} from '"+(ROOT/('services/hyperfide/dist/storage/'+name+'.js')).as_uri()+"';\n")
    (registry/(id+'.json')).write_text(json.dumps({'schema_version':1,'id':id,'task':'4.4','roles':['control'],'module':name+'.js','entry':'createComponent','api_version':1,'actions':actions,'requires':requires}))
   (modules/'fixture.js').write_text(FIXTURE.replace('DURABILITY_URL',(ROOT/'services/hyperfide/dist/storage/durability.js').as_uri()).replace('SCHEMA_URL',(ROOT/'services/hyperfide/dist/storage/schema.js').as_uri()).replace('JOURNAL_URL',(ROOT/'services/hyperfide/dist/storage/authority_journal.js').as_uri()).replace('DISPOSITIONS_URL',(ROOT/'services/hyperfide/dist/storage/dispositions.js').as_uri()))
   actions=['programme.activate','storage.runtime.describe','storage.migrations.inspect','storage.migrations.apply','storage.durability.inspect','fixture44.execute']
   policy={'schema_version':1,'programme_id':'fixture44','repository':'fixture/repo','spec_revision':'fixture44','policy_revision':1,'status':'ACTIVE','approval':{'decision':'APPROVED','record_id':'approved-fixture','spec_revision':'fixture44','policy_revision':1},'allowed_roles':['control'],'allowed_actions':actions}
   policyfile=folder/'policy.json';policyfile.write_text(json.dumps(policy))
   journal_dir=c.root/'external-authority';journal_dir.mkdir(mode=0o700)
   deployment=uid();baseenv=os.environ.copy();baseenv.update(DATABASE_URL=c.url(),HYPERFIDE_MIGRATION_DATABASE_URL=c.url(),HYPERFIDE_DEPLOYMENT_ID=deployment,HYPERFIDE_AUTHORITY_JOURNAL_DIR=str(journal_dir),HYPERFIDE_MIGRATION_JOB='1',HF44_MIGRATIONS=str(ROOT/'services/hyperfide/migrations'),HF44_PARAMETERS=json.dumps({'root':str(c.root),'oldPrimary':str(c.primary),'oldSocket':str(c.socket/('.s.PGSQL.'+str(c.port)))}))
   sequence=0
   def call(input,env=None,action='fixture44.execute',timeout=45):
    nonlocal sequence
    sequence+=1
    request={'id':sequence,'component':'fixture' if action=='fixture44.execute' else '4.4','action':action,'input':input}
    p=subprocess.run(['node','services/hyperfide/dist/control.js','--policy',str(policyfile),'--spec-revision','fixture44','--components',str(registry),'--module-root',str(modules)],input=json.dumps(request)+'\n',text=True,capture_output=True,cwd=ROOT,env=env or baseenv,timeout=timeout)
    (BASE/('service-'+str(sequence)+'.json')).write_text(json.dumps({'exit_code':p.returncode,'stdout':p.stdout,'stderr':p.stderr})+'\n')
    return json.loads(p.stdout.strip() or p.stderr.strip()) if (p.stdout.strip() or p.stderr.strip()) else {'ok':False,'error':{'code':'NO_REPLY'}}
   operation=uid();initial=call({'mode':'migration','operation_id':operation})
   if not initial.get('ok'):raise RuntimeError('Migration fixture failed: '+json.dumps(initial))
   observed.update(initial['result']);epoch=initial['result']['epoch']
   observed['external_current']=call({'mode':'external'}).get('result',{}).get('epoch')==epoch
   metadata=call({'mode':'journal_metadata','operation_id':operation,'epoch':epoch}).get('result',{})
   observed['journal_replay_proof']=metadata.get('proof_refused') is True
   observed['journal_unknown_fork']=metadata.get('fork_refused') is True
   observed['journal_unchanged_head']=metadata.get('head_unchanged') is True
   pending=call({'mode':'pending','deployment_id':uid(),'operation_id':uid()}).get('result',{})
   for key in ['persisted_uuid','pending','absence_refuses','other_operation','unconfirmed']:observed['journal_'+key]=pending.get(key) is True
   c.sql("INSERT INTO hyperfide.organisations(id,name) VALUES('"+ORG+"','fixture');INSERT INTO hyperfide.projects(organisation_id,id,name) VALUES('"+ORG+"','"+PROJECT+"','fixture');INSERT INTO hyperfide.spec_revisions(organisation_id,id,project_id,source_digest,source_content,document,schema_version) VALUES('"+ORG+"','"+SPEC+"','"+PROJECT+"','sha256:'||encode(sha256(convert_to('fixture','UTF8')),'hex'),'fixture','{}',1);INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch) VALUES('"+ORG+"','"+RUN+"','"+PROJECT+"','"+SPEC+"','sha256:"+('a'*64)+"','"+epoch+"')")
   c.sql("CREATE ROLE hf_runtime LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE;GRANT pg_read_all_stats,pg_read_all_settings TO hf_runtime;REVOKE CREATE ON DATABASE postgres FROM PUBLIC;GRANT USAGE ON SCHEMA hyperfide TO hf_runtime;GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA hyperfide TO hf_runtime;REVOKE INSERT,UPDATE,DELETE,TRUNCATE ON hyperfide.schema_migrations FROM hf_runtime")
   runtime=baseenv.copy();runtime['HYPERFIDE_REQUIRE_SYNC_REPLICA']='0';runtime.pop('HYPERFIDE_MIGRATION_JOB');runtime.pop('HYPERFIDE_MIGRATION_DATABASE_URL');runtime['DATABASE_URL']=c.url(user='hf_runtime')
   unconfigured=runtime.copy();unconfigured.pop('HYPERFIDE_REQUIRE_SYNC_REPLICA')
   observed['sync_policy_required']='Declare synchronous replica policy explicitly' in call({'mode':'inspect'},unconfigured).get('error',{}).get('message','')
   missing=runtime.copy();missing['HYPERFIDE_REQUIRE_SYNC_REPLICA']='1'
   observed['sync_policy_missing']='Required synchronous standby is not ready' in call({'mode':'inspect'},missing).get('error',{}).get('message','')
   observed['runtime_ready']=call({'mode':'inspect'},runtime).get('result',{}).get('ready') is True
   for name,statement in [('runtime_no_ddl','CREATE TABLE hyperfide.forbidden(x int)'),('runtime_no_metadata',"DELETE FROM hyperfide.schema_migrations")]:
    try:c.sql(statement,user='hf_runtime');observed[name]=False
    except RuntimeError:observed[name]=True
   observed['runtime_migration_refused']=call({},runtime,action='storage.migrations.apply').get('error',{}).get('code')=='MIGRATION_JOB_REQUIRED'
   scope={'organisation_id':ORG,'run_id':RUN,'authority_epoch':epoch}
   semantic=call({'mode':'semantic','scope':{'organisation_id':ORG,'run_id':RUN}}).get('result',{})
   (BASE/'semantic-race.json').write_text(json.dumps(semantic.get('observed',{}),indent=2)+'\n')
   for key in ['retry','fresh','wait','idempotent','generation','upgrade','missing','concurrent_writes','concurrent_write_read','concurrent_read_write','business_version']:observed['semantic_'+key]=semantic.get(key) is True
   for key,statement in [
    ('semantic_business_guard',"UPDATE hyperfide.runs SET state=CASE WHEN state='RUNNING' THEN 'READY' ELSE 'RUNNING' END WHERE organisation_id='"+ORG+"' AND id='"+RUN+"'"),
    ('semantic_monotonic',"UPDATE hyperfide.runs SET semantic_generation=semantic_generation-1,state_version=state_version+1 WHERE organisation_id='"+ORG+"' AND id='"+RUN+"'"),
    ('semantic_single_step',"UPDATE hyperfide.runs SET semantic_generation=semantic_generation+2 WHERE organisation_id='"+ORG+"' AND id='"+RUN+"'"),
    ('semantic_spec_monotonic',"UPDATE hyperfide.runs SET spec_generation=spec_generation-1,state_version=state_version+1 WHERE organisation_id='"+ORG+"' AND id='"+RUN+"'")]:
    try:c.sql(statement);observed[key]=False
    except RuntimeError:observed[key]=True
   observed['epoch_guard']=call({'mode':'guard','scope':scope,'id':uid()},runtime).get('ok') is True
   observed['stale_guard']=call({'mode':'stale','scope':{**scope,'authority_epoch':uid()},'id':uid()},runtime).get('result',{}).get('stale') is True
   c.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,content_digest,provider,runtime_platform,manifest) VALUES('"+ORG+"','sha256:"+('b'*64)+"','railway','linux',jsonb_build_object('body',repeat('x',4194305)))")
   observed['large_manifest']=c.sql('SELECT octet_length(manifest::text)>4194304 FROM hyperfide.environment_profiles')=='t'
   try:c.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,content_digest,provider,runtime_platform,manifest) VALUES('"+ORG+"','sha256:"+('c'*64)+"','railway','linux',jsonb_build_object('body',repeat('x',67108865)))");observed['oversize_manifest']=False
   except RuntimeError:observed['oversize_manifest']=True
   concurrency=call({'mode':'concurrent_authority','deployment_id':uid()}).get('result',{})
   observed['journal_concurrent']=concurrency.get('single') is True and concurrency.get('head') is True and concurrency.get('rows')==1
   observed['journal_concurrent_outcomes']=concurrency.get('outcomes')
   missing_head=call({'mode':'missing_head','deployment_id':uid()}).get('result',{})
   observed['journal_missing_head']=missing_head.get('refused') is True
   observed['journal_missing_database_head']=missing_head.get('database_refused') is True
   proxy_dir=c.root/'ack-proxy';proxy_dir.mkdir()
   previous_env={key:os.environ.get(key) for key in ['PGHOST','PGPORT']}
   os.environ.update(PGHOST=str(c.socket),PGPORT=str(c.port))
   proxy=CommitAckProxy(proxy_dir)
   for key,value in previous_env.items():
    if value is None:os.environ.pop(key,None)
    else:os.environ[key]=value
   try:
    unknown_deployment=uid();unknown_operation=uid()
    unknown_env=baseenv.copy()
    from urllib.parse import quote
    unknown_env['DATABASE_URL']='postgresql://hf_operator@localhost:'+str(c.port)+'/postgres?host='+quote(str(proxy_dir),safe='')
    unknown=call({'mode':'unknown_activate','deployment_id':unknown_deployment,'operation_id':unknown_operation},unknown_env)
    observed['journal_unknown_ack']=proxy.dropped and unknown.get('error',{}).get('code')=='COMMIT_AMBIGUOUS'
    persisted=json.loads((journal_dir/(unknown_deployment+'.authority.json')).read_text())
    observed['journal_unknown_pending']=persisted['state']=='PENDING' and persisted['pending']['operation_id']==unknown_operation
    persisted_epoch=persisted['pending']['epoch']
    observed['journal_unknown_committed']=c.sql("SELECT count(*) FROM hyperfide.authority_activations WHERE deployment_id='"+unknown_deployment+"' AND operation_id='"+unknown_operation+"' AND epoch='"+persisted_epoch+"'")=='1'
    reconciled=call({'mode':'reconcile_unknown','deployment_id':unknown_deployment,'operation_id':unknown_operation}).get('result',{})
    observed['journal_unknown_reconcile']=reconciled.get('before') is True and reconciled.get('replayed') is True and reconciled.get('epoch')==persisted_epoch and reconciled.get('head')==persisted_epoch
    observed['journal_unknown_no_replay']=c.sql("SELECT count(*) FROM hyperfide.authority_activations WHERE deployment_id='"+unknown_deployment+"'")=='1'
   finally:proxy.close()
   c.replicate();observed['physical_standby']=c.sql('SELECT pg_is_in_recovery()',replica=True)=='t';c.synchronous()
   strict=runtime.copy();strict['HYPERFIDE_REQUIRE_SYNC_REPLICA']='1'
   observed['sync_policy_ready']=call({'mode':'inspect'},strict).get('ok') is True
   strictjob=baseenv.copy();strictjob['HYPERFIDE_REQUIRE_SYNC_REPLICA']='1'
   observed['sync_policy_precommit']=call({'mode':'precommit'},strictjob).get('error',{}).get('code')=='DURABILITY_UNAVAILABLE'
   c.synchronous()
   durable=uid();observed['sync_durable']=call({'mode':'durable','id':durable},runtime).get('ok') is True and c.sql("SELECT count(*) FROM hyperfide.organisations WHERE id='"+durable+"'",replica=True)=='1'
   artifact=call({'mode':'artifact_metadata','scope':scope},runtime)
   if not artifact.get('ok'):raise RuntimeError('Actual artifact metadata transaction failed: '+json.dumps(artifact))
   artifact=artifact['result']
   artifact_query="SELECT json_build_object('organisation_id',d.organisation_id,'run_id',d.run_id,'parent_artifact_id',p.id,'child_artifact_id',a.id,'child_digest',a.digest,'parent_digest',p.digest,'size_bytes',d.size_bytes,'storage_backend',a.storage_backend,'child_status',a.status,'parent_status',p.status)::text FROM hyperfide.artifact_dependencies d JOIN hyperfide.artifacts p ON p.organisation_id=d.organisation_id AND p.run_id=d.run_id AND p.id=d.parent_artifact_id JOIN hyperfide.artifacts a ON a.organisation_id=d.organisation_id AND a.run_id=d.run_id AND a.id=d.child_artifact_id WHERE d.organisation_id='"+ORG+"' AND d.run_id='"+RUN+"' AND d.parent_artifact_id='"+artifact['parent_artifact_id']+"' AND d.child_artifact_id='"+artifact['child_artifact_id']+"' AND d.sequence=0 AND d.offset_bytes=0"
   def read_artifact(replica=False):return json.loads(c.sql(artifact_query,replica=replica))
   expected_artifact={k:v for k,v in artifact.items() if k!='claim'}
   artifact_observations={'acknowledged_metadata':expected_artifact,'claim':artifact['claim'],'primary':read_artifact(),'standby':read_artifact(replica=True)}
   observed['artifact_reference_ack']=artifact_observations['primary']==expected_artifact and artifact_observations['standby']==expected_artifact
   backup=c.backup()
   c.stop(c.standby);uncertain=uid()
   answer=call({'mode':'durable','id':uncertain,'timeoutMs':250},runtime)
   observed['no_standby_no_ack']=answer.get('ok') is False and answer.get('error',{}).get('code')=='COMMIT_AMBIGUOUS'
   c.synchronous(False)
   observed['unknown_reconcile']=c.sql("SELECT count(*) FROM hyperfide.organisations WHERE id='"+uncertain+"'")=='1'
   c.start(c.standby)
   for _ in range(200):
    if c.sql("SELECT count(*) FROM hyperfide.organisations WHERE id='"+uncertain+"'",replica=True)=='1':break
    time.sleep(.025)
   c.stop(c.primary);observed['old_primary_isolated']=c.stopped(c.primary,c.socket)
   c.promote();baseenv['DATABASE_URL']=c.url(replica=True);baseenv['HYPERFIDE_MIGRATION_DATABASE_URL']=c.url(replica=True)
   runtime['DATABASE_URL']=c.url(replica=True,user='hf_runtime')
   observed['promotion_survives']=c.sql("SELECT count(*) FROM hyperfide.organisations WHERE id='"+durable+"'",replica=True)=='1'
   artifact_observations['promoted']=read_artifact(replica=True)
   observed['artifact_reference_promotion']=artifact_observations['promoted']==expected_artifact
   # Standalone promoted server must not wait for the old configured standby.
   c.sql("ALTER SYSTEM SET synchronous_standby_names=''",replica=True);c.sql('SELECT pg_reload_conf()',replica=True)
   activated=call({'mode':'activate','operation_id':uid(),'epoch':epoch})
   if not activated.get('ok'):raise RuntimeError('Epoch activation failed: '+json.dumps(activated))
   next_epoch=activated['result']['epoch'];observed['fresh_recovery_epoch']=next_epoch!=epoch
   observed['old_identity_refused']=call({'mode':'stale','scope':scope,'id':uid()},runtime).get('result',{}).get('stale') is True
   observed['old_activation_refused']=call({'mode':'replayed_old','operation_id':operation}).get('result',{}).get('refused') is True
   # Restore an actual basebackup; its historical epoch must not become today's authority.
   c.stop(c.standby);restored=c.root/'restored';shutil.copytree(backup,restored);(restored/'standby.signal').unlink(missing_ok=True)
   restoredsocket=c.root/'restored-socket';restoredsocket.mkdir();os.chown(restoredsocket,c.owner.pw_uid,c.owner.pw_gid)
   for path in [restored,*restored.rglob('*')]:os.chown(path,c.owner.pw_uid,c.owner.pw_gid)
   c.configure(restored,restoredsocket)
   with (restored/'postgresql.auto.conf').open('a') as f:f.write("\nsynchronous_standby_names=''\n")
   c.start(restored);oldsocket=c.socket;c.socket=restoredsocket
   observed['restore_complete']=c.sql("SELECT count(*) FROM hyperfide.organisations WHERE id='"+durable+"'")=='1'
   artifact_observations['restored']=read_artifact()
   observed['artifact_reference_restore']=artifact_observations['restored']==expected_artifact
   (BASE/'artifact-reference.json').write_text(json.dumps(artifact_observations,indent=2)+'\n')
   baseenv['DATABASE_URL']=c.url();baseenv['HYPERFIDE_MIGRATION_DATABASE_URL']=c.url()
   params=json.loads(baseenv['HF44_PARAMETERS']);params['oldPrimary']=str(c.standby);params['oldSocket']=str(c.replica_socket/('.s.PGSQL.'+str(c.port)));baseenv['HF44_PARAMETERS']=json.dumps(params)
   runtime['DATABASE_URL']=c.url(user='hf_runtime')
   observed['restore_old_startup_refused']=call({'mode':'inspect'},runtime).get('ok') is False
   observed['restore_external_mismatch']=call({'mode':'external'}).get('error',{}).get('code')=='RESTORED_AUTHORITY_STALE'
   observed['restore_ordinary_refused']=call({'mode':'activate','operation_id':uid(),'epoch':epoch}).get('error',{}).get('code')=='EXTERNAL_AUTHORITY_STALE'
   observed['restore_wrong_lineage']=call({'mode':'restore','operation_id':uid(),'external_epoch':next_epoch,'database_epoch':uid()}).get('error',{}).get('code')=='STALE_AUTHORITY'
   restored_operation=uid()
   restored_activation=call({'mode':'restore','operation_id':restored_operation,'external_epoch':next_epoch,'database_epoch':epoch})
   observed['restore_fresh_epoch']=restored_activation.get('ok') is True and restored_activation['result']['epoch'] not in [epoch,next_epoch]
   runtime['DATABASE_URL']=c.url(user='hf_runtime')
   if restored_activation.get('ok'):
    final_epoch=restored_activation['result']['epoch']
    observed['restore_external_head']=call({'mode':'external'}).get('result',{}).get('epoch')==final_epoch
    observed['restore_lineages']=c.sql("SELECT previous_epoch::text||','||database_predecessor_epoch::text||','||activation_kind FROM hyperfide.authority_epochs WHERE state='ACTIVE' AND deployment_id='"+deployment+"'")==next_epoch+','+epoch+',RESTORE'
    receipt_bytes=(journal_dir/(restored_operation+'.fence.json')).read_bytes();receipt=json.loads(receipt_bytes)
    observed['restore_writer_binding']=receipt['source_epoch']==next_epoch and receipt['isolated_writer']==str(c.standby) and c.stopped(c.standby,c.replica_socket)
    observed['restore_receipt_digest']=c.sql("SELECT proof_digest FROM hyperfide.authority_epochs WHERE deployment_id='"+deployment+"' AND state='ACTIVE'")=='sha256:'+hashlib.sha256(receipt_bytes).hexdigest()
    for key,column in [('restore_external_immutable','previous_epoch'),('restore_database_immutable','database_predecessor_epoch')]:
     try:c.sql("UPDATE hyperfide.authority_epochs SET "+column+"='"+uid()+"' WHERE deployment_id='"+deployment+"' AND state='ACTIVE'");observed[key]=False
     except RuntimeError:observed[key]=True

    observed['restore_replay']=call({'mode':'restore','operation_id':restored_operation,'external_epoch':next_epoch,'database_epoch':epoch}).get('result',{}).get('epoch')==final_epoch
   c.sql("DELETE FROM hyperfide.schema_migrations WHERE version=4")
   observed['missing_readiness']=call({'mode':'inspect'},runtime).get('ok') is False
 except Exception as error:observed['error']=str(error)[:1500]
 finally:
  if c:
   (BASE/'cluster-commands.json').write_text(json.dumps(c.logs,indent=2)+'\n')
   observed['cleanup']=c.close()
 (BASE/'observations.json').write_text(json.dumps(observed,indent=2,sort_keys=True)+'\n')
 failed=False
 for name in IDS:
  actual=observed.get(name) is True
  if not actual:failed=True
  print(json.dumps({'type':'assertion','id':'durability.'+name,'expected':True,'actual':actual}),flush=True)
 return 1 if failed or not cleanup(emit=False) else 0
if __name__=='__main__':raise SystemExit(main())
