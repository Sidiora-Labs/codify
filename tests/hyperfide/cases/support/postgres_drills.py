#!/usr/bin/env python3
"""Explicit isolated PostgreSQL18 recovery producer; never targets the service database."""
import os,sys,json,time,uuid,hashlib,shutil,signal,subprocess,urllib.parse
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/cases/support'))
from postgres_cluster import PostgresCluster
NODE=os.environ.get('HYPERFIDE_PROBE_NODE','/usr/bin/node')
LIMITS='ISOLATED_POSTGRESQL_FIXTURE: same VM and Unix sockets; PostgreSQL metadata/record byte survival only. No cloud HA, independent failure domain, object payload or full-host journal-loss qualification. RPO is acknowledged record identity loss, not an inferred temporal guarantee.'
JS=r"""
import fs from 'node:fs/promises';
import path from 'node:path';
import net from 'node:net';
import {createHash,randomUUID} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
const args=JSON.parse(await new Promise(resolve=>{let s='';process.stdin.on('data',b=>s+=b);process.stdin.on('end',()=>resolve(s));}));
const mod=p=>pathToFileURL(path.join(args.repo,'services/hyperfide/dist/storage',p)).href;
const {createResourceContainer}=await import(mod('runtime.js'));
const {MigrationCoordinator,AuthorityStore,lookupAuthorityActivation,assertExternalAuthorityCurrent}=await import(mod('durability.js'));
const {FileExternalAuthorityJournal}=await import(mod('authority_journal.js'));
const env={HYPERFIDE_CONTROL_PRIMARY_DATABASE_URL:args.url,HYPERFIDE_MIGRATION_DATABASE_URL:args.url,HYPERFIDE_DEPLOYMENT_ID:args.deployment,HYPERFIDE_AUTHORITY_JOURNAL_DIR:args.journal,HYPERFIDE_REQUIRE_SYNC_REPLICA:args.synchronous?'1':'0',HYPERFIDE_MIGRATION_JOB:'1',HYPERFIDE_PG_STATEMENT_TIMEOUT_MS:'10000',HYPERFIDE_PG_CONNECT_TIMEOUT_MS:'3000'};
const resources=createResourceContainer({role:'control',env,signal:new AbortController().signal});
const digest=x=>'sha256:'+createHash('sha256').update(x).digest('hex');
const ns=()=>process.hrtime.bigint().toString();
async function journalDocument(){
 for(const entry of await fs.readdir(args.journal,{withFileTypes:true})){
  if(!entry.isFile())continue;
  const raw=await fs.readFile(path.join(args.journal,entry.name),'utf8');
  try{const value=JSON.parse(raw);if(value.deployment_id===args.deployment)return {document:value,raw,filename:entry.name};}catch{}
 }
 return null;
}
let pendingObserved=null,commitObserved=null,publishedObserved=null,admissionClock=null,pending=null,before=null,after=null,receiptRaw=null;
const {default:pg}=await import(pathToFileURL(path.join(args.repo,'services/hyperfide/node_modules/pg/lib/index.js')).href);
const originalQuery=pg.Client.prototype.query;
pg.Client.prototype.query=function(...parameters){
 const result=originalQuery.apply(this,parameters);
 if(parameters[0]==='SELECT clock_timestamp()::text AS now'&&result&&typeof result.then==='function')
  result.then(value=>{admissionClock=value.rows[0].now;},()=>{});
 return result;
};
const gateway=new Proxy(resources.gateway,{get(target,key){
 if(key==='withPrimaryTransaction')return async(options,body)=>{
  const originalGuard=options.guard;
  const value=await target.withPrimaryTransaction({...options,guard:async tx=>{
   if(originalGuard)await originalGuard(tx);
  }},body);
  if(pendingObserved&&!publishedObserved)commitObserved=ns();
  return value;
 };
 const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
}});
const observedResources=new Proxy(resources,{get(target,key){if(key==='gateway')return gateway;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
const journal=new FileExternalAuthorityJournal(args.journal,i=>lookupAuthorityActivation(observedResources,i));
const actualPrepare=journal.prepareActivation.bind(journal),actualPublish=journal.publishCommitted.bind(journal);
journal.prepareActivation=async input=>{const value=await actualPrepare(input);pendingObserved=ns();pending=await journalDocument();return value;};
journal.publishCommitted=async input=>{const value=await actualPublish(input);publishedObserved=ns();after=await journalDocument();return value;};
const store=new AuthorityStore(observedResources,args.deployment,journal);
const fencer={isolate:async input=>{
 let isolated,physical;
 if(input.source_epoch===null){
  const observed=(await resources.observe({preferReplica:false},s=>s.query('SELECT s.system_identifier::text AS system_identifier,(SELECT count(*)::int FROM hyperfide.authority_epochs) AS epochs FROM pg_control_system() s'))).value.rows[0];
  if(observed.epochs!==0)throw Error('Fresh fixture bootstrap cannot inherit authority');
  isolated='owned-new-fixture:'+observed.system_identifier;physical={kind:'FRESH_OWNED_DATABASE',system_identifier:observed.system_identifier,authority_rows:observed.epochs};
 }else{
  let status;try{execFileSync('runuser',['-u','postgres','--','/usr/lib/postgresql/18/bin/pg_ctl','-D',args.old_writer,'status'],{stdio:'pipe'});status=0;}catch(e){status=e.status;}
  if(status!==3)throw Error('External predecessor writer must be stopped before activation');
  let refusal;
  await new Promise((resolve,reject)=>{const socket=net.connect(args.old_socket);socket.once('connect',()=>{socket.destroy();reject(Error('External predecessor socket remains reachable'));});socket.once('error',error=>{socket.destroy();if(['ENOENT','ECONNREFUSED'].includes(error.code)){refusal=error.code;resolve();}else reject(error);});});
  isolated=args.old_writer;physical={kind:'STOPPED_OWNED_POSTGRESQL',writer:args.old_writer,status_exit:status,socket:args.old_socket,socket_refusal:refusal,source_epoch:input.source_epoch};
 }
 const now=Date.now(),receipt={deployment_id:input.deployment_id,operation_id:input.operation_id,fence_id:randomUUID(),source_epoch:input.source_epoch,isolated_writer:isolated,observed_at:new Date(now).toISOString(),expires_at:new Date(now+25000).toISOString(),evidence_digest:digest(JSON.stringify(physical))};
 receiptRaw=JSON.stringify(receipt);
 await fs.writeFile(args.evidence_file+'.fence-physical.json',JSON.stringify(physical)+'\n',{mode:0o600,flag:'wx'});
 return receipt;
}};
try{
 let result;
 if(args.mode==='migrate')result=await new MigrationCoordinator(resources,args.migrations).apply({timeoutMs:30000});
 else if(args.mode==='rows')result=(await resources.observe({preferReplica:false},s=>s.query('SELECT organisation_id,run_id,id,payload,encode(payload_sha256,\'hex\') AS payload_sha256,acknowledged_at::text FROM hyperfide.drill_records ORDER BY id'))).value.rows;
 else if(args.mode==='write'){
  result=await resources.gateway.withPrimaryTransaction({timeoutMs:15000},async tx=>{
   const payload='owned-record:'+args.operation+':'+args.record;
   const hash=createHash('sha256').update(payload).digest();
   const row=(await tx.query('INSERT INTO hyperfide.drill_records(organisation_id,run_id,id,payload,payload_sha256) VALUES($1,$2,$3,$4,$5) RETURNING organisation_id,run_id,id,payload,encode(payload_sha256,\'hex\') AS payload_sha256,acknowledged_at::text',[args.organisation,args.run,args.record,payload,hash])).rows[0];
   return row;
  });
 }else{
  before=await journalDocument();
  result=args.mode==='restore'
   ?await store.activateRestored({operation_id:args.operation,expected_external_epoch:args.external_epoch,expected_database_epoch:args.database_epoch},fencer)
   :await store.activate({operation_id:args.operation,expected_previous_epoch:args.external_epoch??null},fencer);
  const attestation=await assertExternalAuthorityCurrent(resources,journal,{deployment_id:args.deployment});
  const records=(await resources.observe({preferReplica:false},async s=>{
   const activation=(await s.query('SELECT * FROM hyperfide.authority_activations WHERE deployment_id=$1 AND operation_id=$2',[args.deployment,args.operation])).rows[0];
   const authority_epoch=(await s.query('SELECT * FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND epoch=$2',[args.deployment,result.epoch])).rows[0];
   const previous=args.mode==='restore'?args.database_epoch:args.external_epoch;
   const predecessor=previous?(await s.query('SELECT * FROM hyperfide.authority_epochs WHERE deployment_id=$1 AND epoch=$2',[args.deployment,previous])).rows[0]??null:null;
   return {activation,authority_epoch,database_predecessor_authority_epoch:predecessor};
  })).value;
  const event={sequence:args.sequence,virtual_ms:args.virtual_ms,kind:'epoch',operation_id:args.operation,epoch:args.external_epoch??null,new_epoch:result.epoch,accepted:true,activation_contract:'04-journal-v1',activation_mode:args.mode==='restore'?'RESTORE':'ROTATE',database_previous_epoch:args.mode==='restore'?args.database_epoch:args.external_epoch??null,activation_proof:{...records,fencer_receipt_json:receiptRaw,journal_before:before?.document??null,journal_pending:pending?.document??null,journal_after:after?.document??null,journal_raw:{before:before?.raw??null,pending:pending?.raw??null,after:after?.raw??null},external_attestation:attestation,primary_admission_now:admissionClock,timing:{pending_observed_ns:pendingObserved,commit_observed_ns:commitObserved,published_observed_ns:publishedObserved}}};
  await fs.writeFile(args.evidence_file,JSON.stringify(event,null,2)+'\n',{mode:0o600,flag:'wx'});
 }
 process.stdout.write(JSON.stringify(result));
}finally{await resources.close();}
"""
def main():
 request=json.load(sys.stdin)
 evidence=Path(request['evidence_directory'])
 if not evidence.is_absolute() or evidence.resolve()!=evidence:raise ValueError('Canonical evidence directory required')
 for key in ['organisation_id','run_id','operation_id','source_epoch']:uuid.UUID(request[key])
 if request['scenario'] not in ['DATABASE','RESTORE']:raise ValueError('Unsupported isolated probe')
 started=time.time();begin_ns=time.monotonic_ns();cluster=None;status='UNKNOWN';error=None;events=[];acked=[];recovered=[];epoch=None;fixture_source=None;cleanup={'complete':False,'root_absent':False,'processes_absent':False}
 def interrupt(*unused):raise InterruptedError('Owned fixture cancelled; cleanup required')
 signal.signal(signal.SIGTERM,interrupt)
 def save(name,value):
  p=evidence/name
  with p.open('x') as f:json.dump(value,f,indent=2);f.write('\n');f.flush();os.fsync(f.fileno())
  os.chmod(p,0o600)
 def invoke(mode,url,**kw):
  nonlocal events
  args={'mode':mode,'repo':str(ROOT),'url':url,'deployment':deployment,'journal':str(journal),'migrations':str(migrations),'organisation':request['organisation_id'],'run':request['run_id'],'operation':str(uuid.uuid4()),'evidence_file':str(evidence/('authority-'+str(len(events))+'.json')),'sequence':len(events)+1,'virtual_ms':int((time.monotonic_ns()-begin_ns)/1000000),**kw}
  p=subprocess.run([NODE,str(helper)],input=json.dumps(args),text=True,capture_output=True,timeout=45)
  invocations.append({'mode':mode,'returncode':p.returncode,'stdout':p.stdout[-16384:],'stderr':p.stderr[-8192:],'observed_at':time.time()})
  if p.returncode:raise RuntimeError('Owned authority step failed: '+mode+': '+p.stderr[-1000:])
  if mode in ['activate','restore']:events.append(json.loads(Path(args['evidence_file']).read_text()))
  return json.loads(p.stdout)
 invocations=[]
 try:
  cluster=PostgresCluster.__new__(PostgresCluster);cluster.__init__()
  journal=cluster.root/'external-journal';journal.mkdir(mode=0o700)
  deployment=str(uuid.uuid4())
  helper=evidence/'authority-helper.mjs';helper.write_text(JS);helper.chmod(0o600)
  migrations=cluster.root/'trusted-migrations';migrations.mkdir(mode=0o700)
  for name in ['0001-authority.sql','0004-durability.sql']:shutil.copyfile(ROOT/'services/hyperfide/migrations'/name,migrations/name)
  (migrations/'9000-drill.sql').write_text("""CREATE TABLE hyperfide.drill_records(organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid PRIMARY KEY,payload text NOT NULL,payload_sha256 bytea NOT NULL CHECK(octet_length(payload_sha256)=32),acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.drill_records FOR EACH STATEMENT EXECUTE FUNCTION hyperfide.require_authority_isolation();
""")
  invoke('migrate',cluster.url())
  initial=invoke('activate',cluster.url(),external_epoch=None)
  fixture_source=initial['epoch']
  cluster.replicate();cluster.synchronous(True)
  record=invoke('write',cluster.url(),synchronous=True,record=str(uuid.uuid4()),operation=request['operation_id'])
  acked=[record['id']]
  primary=invoke('rows',cluster.url());standby=invoke('rows',cluster.url(True))
  replay_deadline=time.monotonic()+10
  while standby!=primary and time.monotonic()<replay_deadline:
   time.sleep(.025);standby=invoke('rows',cluster.url(True))
  if primary!=standby or primary!=[record]:raise RuntimeError('Acknowledged bytes did not reach real synchronous standby')
  backup=cluster.backup('drill-backup')
  backup_manifest=json.loads((backup/'backup_manifest').read_text())
  save('backup-manifest.json',backup_manifest)
  disruption_ns=time.monotonic_ns()
  cluster.stop(cluster.primary)
  old_absent=cluster.stopped(cluster.primary,cluster.socket)
  if not old_absent:raise RuntimeError('Old primary physical isolation was not observed')
  cluster.promote()
  promoted=invoke('rows',cluster.url(True))
  rotation=invoke('activate',cluster.url(True),external_epoch=fixture_source,old_writer=str(cluster.primary),old_socket=str(cluster.socket/('.s.PGSQL.'+str(cluster.port))))
  epoch=rotation['epoch']
  recovered=promoted
  if request['scenario']=='RESTORE':
   cluster.stop(cluster.standby)
   if not cluster.stopped(cluster.standby,cluster.replica_socket):raise RuntimeError('Promoted predecessor remains reachable before restore')
   restored=cluster.root/'restored';shutil.copytree(backup,restored)
   (restored/'standby.signal').unlink(missing_ok=True)
   socket=cluster.root/'restored-socket';socket.mkdir();os.chown(socket,cluster.owner.pw_uid,cluster.owner.pw_gid)
   for p in [restored,*restored.rglob('*')]:
    if not p.is_symlink():os.chown(p,cluster.owner.pw_uid,cluster.owner.pw_gid)
   cluster.configure(restored,socket)
   with (restored/'postgresql.auto.conf').open('a') as f:f.write("\nsynchronous_standby_names=''\n")
   cluster.start(restored)
   restored_url='postgresql://hf_operator@localhost:'+str(cluster.port)+'/postgres?host='+urllib.parse.quote(str(socket),safe='')
   # The independently persisted journal is still head2; restored PostgreSQL has epoch1.
   restored_before=invoke('rows',restored_url)
   final=invoke('restore',restored_url,external_epoch=epoch,database_epoch=fixture_source,old_writer=str(cluster.standby),old_socket=str(cluster.replica_socket/('.s.PGSQL.'+str(cluster.port))))
   epoch=final['epoch'];recovered=invoke('rows',restored_url)
   if restored_before!=primary or recovered!=primary:raise RuntimeError('Restored scoped acknowledged record bytes differ')
  if recovered!=primary:raise RuntimeError('Recovery did not preserve exact acknowledged record bytes')
  recovered_ids=[r['id'] for r in recovered]
  if any(value not in recovered_ids for value in acked):raise RuntimeError('Acknowledged identity lost')
  save('records.json',{'scope':{'organisation_id':request['organisation_id'],'run_id':request['run_id']},'acknowledged':primary,'standby':standby,'recovered':recovered})
  save('authority-events.json',{'schema_version':1,'scope':'ISOLATED_POSTGRESQL_FIXTURE','deployment_id':deployment,'fixture_source_epoch':fixture_source,'fixture_recovery_epoch':epoch,'events':events})
  save('timing.json',{'started_unix_ms':int(started*1000),'disruption_monotonic_ns':str(disruption_ns),'recovered_monotonic_ns':str(time.monotonic_ns()),'elapsed_ms':int((time.monotonic_ns()-disruption_ns)/1000000),'rpo':'ACKNOWLEDGED_IDENTITY_LOSS_COUNT_ONLY','acknowledged_loss_count':0})
  status='RECOVERED'
 except BaseException as exc:
  error={'type':type(exc).__name__,'message':str(exc)[:2048]};status='UNKNOWN' if isinstance(exc,(InterruptedError,subprocess.TimeoutExpired)) else 'FAILED'
 finally:
  signal.signal(signal.SIGTERM,signal.SIG_IGN)
  if cluster:
   logs=list(cluster.logs);root=str(cluster.root)
   complete=cluster.close()
   processes_absent=all(p.poll() is not None for p in cluster.processes.values())
   cleanup={'complete':complete and processes_absent,'root_absent':not Path(root).exists(),'processes_absent':processes_absent}
   save('postgres-commands.json',logs)
  save('cleanup.json',cleanup);save('invocations.json',invocations)
  if error:save('failure.json',error)
  artifacts=[]
  for p in sorted(evidence.iterdir()):
   if p.is_file() and p.name not in ['result.json','evidence.json']:
    data=p.read_bytes();artifacts.append({'path':p.name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)})
  proof={'schema_version':1,'scope':'ISOLATED_POSTGRESQL_FIXTURE','scenario':request['scenario'],'operation_id':request['operation_id'],'fixture_source_epoch':fixture_source,'fixture_recovery_epoch':epoch,'artifacts':artifacts,'cleanup':cleanup,'limits':LIMITS}
  save('evidence.json',proof);manifest=evidence/'evidence.json';data=manifest.read_bytes()
  result={'status':status,'source_epoch':request['source_epoch'],'recovery_epoch':epoch,'fixture_source_epoch':fixture_source,'scope':'ISOLATED_POSTGRESQL_FIXTURE','acknowledged_ids':acked,'recovered_ids':[r['id'] for r in recovered],'evidence_digest':'sha256:'+hashlib.sha256(data).hexdigest(),'limits':LIMITS,'artifacts':artifacts+[{'path':manifest.name,'sha256':hashlib.sha256(data).hexdigest(),'size':len(data)}],'started_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime(started)),'completed_at':time.strftime('%Y-%m-%dT%H:%M:%SZ',time.gmtime()),'cleanup':cleanup}
  save('result.json',result)
 return 0 if cleanup['complete'] else 2
if __name__=='__main__':sys.exit(main())
