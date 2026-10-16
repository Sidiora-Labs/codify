#!/usr/bin/env python3
"""Real migrations, synchronous physical replication, loss and restored identity fences."""
import sys,os,json,tempfile,subprocess,uuid,time,shutil,hashlib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/cases/support'))
from postgres_cluster import PostgresCluster
BASE=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task44-standalone'))/'storage44'
BASE.mkdir(parents=True,exist_ok=True);STATE=BASE/'resource.json'
IDS=['physical_primary','fresh','ready','replay','drift','lower','duplicate','atomic','guard_omission','guard_atomic','transaction_escape','symlink','concurrent','operator_refused','legacy_ready','bootstrap_epoch','activation_replay','fence_required','invalid_fence','runtime_ready','runtime_no_ddl','runtime_no_metadata','runtime_migration_refused','missing_readiness','epoch_guard','stale_guard','large_manifest','oversize_manifest','physical_standby','sync_durable','no_standby_no_ack','unknown_reconcile','old_primary_isolated','promotion_survives','fresh_recovery_epoch','old_identity_refused','old_activation_refused','restore_complete','restore_fresh_epoch','cleanup','sync_policy_required','sync_policy_missing','sync_policy_ready','sync_policy_precommit']
ORG='10000000-0000-4000-8000-000000000001';RUN='10000000-0000-4000-8000-000000000002';PROJECT='10000000-0000-4000-8000-000000000003';SPEC='10000000-0000-4000-8000-000000000004'
FIXTURE="import fs from 'node:fs/promises';\nimport path from 'node:path';\nimport {createHash,randomUUID} from 'node:crypto';\nimport {execFileSync} from 'node:child_process';\nimport net from 'node:net';\nimport {MigrationCoordinator,AuthorityStore,assertRuntimePrivileges,assertMigrationSource} from 'DURABILITY_URL';\nimport {bootstrapAuthoritySchema,getPool} from 'SCHEMA_URL';\nconst digest=x=>'sha256:'+createHash('sha256').update(x).digest('hex');\nexport function createComponent(c){\n const resources=c.resources;const authority=new AuthorityStore(resources,c.env.HYPERFIDE_DEPLOYMENT_ID);\n const params=JSON.parse(c.env.HF44_PARAMETERS);\n const fencer={isolate:async input=>{\n  let isolated;\n  if(input.source_epoch===null){try{await fs.access(path.join(params.root,'no-predecessor'));throw Error('Unexpected predecessor');}catch(e){if(e.code!=='ENOENT')throw e;}isolated='owned-new-cluster-with-no-predecessor';}\n  else{\n   let status;try{execFileSync('runuser',['-u','postgres','--','/usr/lib/postgresql/18/bin/pg_ctl','-D',params.oldPrimary,'status'],{stdio:'pipe'});status=0;}catch(e){status=e.status;}\n   if(status===0)execFileSync('runuser',['-u','postgres','--','/usr/lib/postgresql/18/bin/pg_ctl','-D',params.oldPrimary,'-m','immediate','-w','stop'],{stdio:'pipe',timeout:15000});\n   try{execFileSync('runuser',['-u','postgres','--','/usr/lib/postgresql/18/bin/pg_ctl','-D',params.oldPrimary,'status'],{stdio:'pipe'});throw Error('Old primary remains running');}catch(e){if(e.status!==3)throw e;}\n   await new Promise((resolve,reject)=>{const socket=net.connect(params.oldSocket);socket.once('connect',()=>{socket.destroy();reject(Error('Old writer socket remains reachable'));});socket.once('error',e=>{socket.destroy();['ENOENT','ECONNREFUSED'].includes(e.code)?resolve():reject(e);});});\n   isolated=params.oldPrimary;\n  }\n  const now=Date.now();return {deployment_id:input.deployment_id,operation_id:input.operation_id,fence_id:randomUUID(),source_epoch:input.source_epoch,isolated_writer:isolated,observed_at:new Date(now).toISOString(),expires_at:new Date(now+25000).toISOString(),evidence_digest:digest(isolated)};\n }};\n const err=async(fn,code)=>{try{await fn();return false;}catch(e){return e.code===code;}};\n return {apiVersion:1,actions:{'fixture44.execute':async input=>{\n  const out={};\n  if(input.mode==='migration'){\n   const migrations=new MigrationCoordinator(resources);\n   const before=await migrations.inspect();out.initial_missing=!before.ready;\n   const receipt=await migrations.apply({timeoutMs:30000});out.fresh=receipt.applied.join(',')==='1,4';\n   out.ready=(await migrations.inspect()).ready;out.replay=(await migrations.apply()).applied.length===0;\n   const scratch=await fs.mkdtemp(path.join(params.root,'migration-sources-'));\n   const original=path.resolve(c.env.HF44_MIGRATIONS);\n   const copy=async()=>{for(const file of await fs.readdir(scratch))await fs.unlink(path.join(scratch,file));for(const file of await fs.readdir(original))if(file.endsWith('.sql'))await fs.copyFile(path.join(original,file),path.join(scratch,file));};\n   const custom=new MigrationCoordinator(resources,scratch);\n   await copy();await fs.appendFile(path.join(scratch,'0001-authority.sql'),'\\n-- drift\\n');out.drift=await err(()=>custom.apply(),'MIGRATION_DRIFT');\n   await copy();await fs.writeFile(path.join(scratch,'0002-late.sql'),'SELECT 1;');out.lower=await err(()=>custom.apply(),'MIGRATION_ORDER_INVALID');\n   await copy();await fs.writeFile(path.join(scratch,'0004-duplicate.sql'),'SELECT 1;');out.duplicate=await err(()=>custom.apply(),'MIGRATION_INVALID');\n   await copy();await fs.writeFile(path.join(scratch,'0006-failure.sql'),'CREATE TABLE hyperfide.failed_migration(x int);SELECT 1/0;');\n   try{await custom.apply();out.atomic=false;}catch{out.atomic=(await resources.observe({preferReplica:false},s=>s.query(\"SELECT to_regclass('hyperfide.failed_migration') IS NULL AS absent\"))).value.rows[0].absent;}\n   await copy();await fs.writeFile(path.join(scratch,'0006-unguarded.sql'),'CREATE TABLE hyperfide.unguarded_migration(x int);');out.guard_omission=await err(()=>custom.apply(),'MIGRATION_GUARD_MISSING');\n   out.guard_atomic=(await resources.observe({},s=>s.query(\"SELECT to_regclass('hyperfide.unguarded_migration') IS NULL AS absent\"))).value.rows[0].absent;\n   await copy();await fs.writeFile(path.join(scratch,'0006-escape.sql'),'CREATE TABLE hyperfide.escaped_migration(x int);COMMIT;');out.transaction_escape=await err(()=>custom.apply(),'MIGRATION_INVALID');\n   await copy();await fs.symlink(path.join(original,'0001-authority.sql'),path.join(scratch,'0006-symlink.sql'));out.symlink=await err(()=>custom.apply(),'MIGRATION_INVALID');\n   await fs.rm(scratch,{recursive:true,force:true});\n   out.concurrent=(await Promise.all([migrations.apply(),migrations.apply()])).every(x=>x.applied.length===0);\n   out.operator_refused=await err(()=>assertRuntimePrivileges(resources),'RUNTIME_DDL_PRIVILEGE');\n   out.legacy_ready=(await bootstrapAuthoritySchema(getPool(c.env))).applied===false;\n   const activation=await authority.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer);\n   out.epoch=activation.epoch;out.bootstrap_epoch=activation.replayed===false;\n   out.activation_replay=(await authority.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer)).epoch===activation.epoch;\n   out.fence_required=await err(()=>authority.activate({operation_id:randomUUID(),expected_previous_epoch:activation.epoch},null),'EXTERNAL_FENCE_REQUIRED');\n   out.invalid_fence=await err(()=>authority.activate({operation_id:randomUUID(),expected_previous_epoch:activation.epoch},{isolate:async i=>({...await fencer.isolate({...i,source_epoch:null}),source_epoch:i.source_epoch,operation_id:randomUUID()})}),'EXTERNAL_FENCE_INVALID');\n   return out;\n  }\n  if(input.mode==='guard'){\n   await resources.gateway.withPrimaryTransaction({guard:tx=>authority.assertCurrent(tx,input.scope)},async tx=>{await tx.query(\"INSERT INTO hyperfide.organisations(id,name) VALUES($1,'guarded')\",[input.id]);});\n   return {guarded:true};\n  }\n  if(input.mode==='stale')return {stale:await err(()=>resources.gateway.withPrimaryTransaction({guard:tx=>authority.assertCurrent(tx,input.scope)},tx=>tx.query(\"INSERT INTO hyperfide.organisations(id,name) VALUES($1,'stale')\",[input.id])),'STALE_AUTHORITY')};\n  if(input.mode==='activate')return authority.activate({operation_id:input.operation_id,expected_previous_epoch:input.epoch},fencer);\n  if(input.mode==='precommit'){return resources.gateway.withPrimaryTransaction({},async tx=>{for(const sql of [\"ALTER SYSTEM SET synchronous_standby_names=''\",\"SELECT pg_reload_conf()\"]){execFileSync('runuser',['-u','postgres','--','/usr/lib/postgresql/18/bin/psql','-X','-qAt','-h',path.join(params.root,'primary-socket'),'-p','55441','-U','hf_operator','-d','postgres','-c',sql],{stdio:'pipe'});}for(let i=0;i<100;i++){if((await tx.query(\"SELECT current_setting('synchronous_standby_names') AS value\")).rows[0].value==='')break;await new Promise(r=>setTimeout(r,10));}return {should_not_ack:true};});}\n  if(input.mode==='durable')return resources.gateway.withPrimaryTransaction({timeoutMs:input.timeoutMs??5000,maxRetries:0},async tx=>{await tx.query(\"INSERT INTO hyperfide.organisations(id,name) VALUES($1,'durable')\",[input.id]);return {id:input.id};});\n  if(input.mode==='inspect')return {ready:(await new MigrationCoordinator(resources).inspect()).ready};\n  if(input.mode==='replayed_old')return {refused:await err(()=>authority.activate({operation_id:input.operation_id,expected_previous_epoch:null},fencer),'STALE_AUTHORITY')};\n  throw Error('Unknown trusted fixture action');\n }}};\n}\n"
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
   (modules/'fixture.js').write_text(FIXTURE.replace('DURABILITY_URL',(ROOT/'services/hyperfide/dist/storage/durability.js').as_uri()).replace('SCHEMA_URL',(ROOT/'services/hyperfide/dist/storage/schema.js').as_uri()))
   actions=['programme.activate','storage.runtime.describe','storage.migrations.inspect','storage.migrations.apply','storage.durability.inspect','fixture44.execute']
   policy={'schema_version':1,'programme_id':'fixture44','repository':'fixture/repo','spec_revision':'fixture44','policy_revision':1,'status':'ACTIVE','approval':{'decision':'APPROVED','record_id':'approved-fixture','spec_revision':'fixture44','policy_revision':1},'allowed_roles':['control'],'allowed_actions':actions}
   policyfile=folder/'policy.json';policyfile.write_text(json.dumps(policy))
   deployment=uid();baseenv=os.environ.copy();baseenv.update(DATABASE_URL=c.url(),HYPERFIDE_MIGRATION_DATABASE_URL=c.url(),HYPERFIDE_DEPLOYMENT_ID=deployment,HYPERFIDE_MIGRATION_JOB='1',HF44_MIGRATIONS=str(ROOT/'services/hyperfide/migrations'),HF44_PARAMETERS=json.dumps({'root':str(c.root),'oldPrimary':str(c.primary),'oldSocket':str(c.socket/('.s.PGSQL.'+str(c.port)))}))
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
   observed['epoch_guard']=call({'mode':'guard','scope':scope,'id':uid()},runtime).get('ok') is True
   observed['stale_guard']=call({'mode':'stale','scope':{**scope,'authority_epoch':uid()},'id':uid()},runtime).get('result',{}).get('stale') is True
   c.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,content_digest,provider,runtime_platform,manifest) VALUES('"+ORG+"','sha256:"+('b'*64)+"','railway','linux',jsonb_build_object('body',repeat('x',4194305)))")
   observed['large_manifest']=c.sql('SELECT octet_length(manifest::text)>4194304 FROM hyperfide.environment_profiles')=='t'
   try:c.sql("INSERT INTO hyperfide.environment_profiles(organisation_id,content_digest,provider,runtime_platform,manifest) VALUES('"+ORG+"','sha256:"+('c'*64)+"','railway','linux',jsonb_build_object('body',repeat('x',67108865)))");observed['oversize_manifest']=False
   except RuntimeError:observed['oversize_manifest']=True
   c.replicate();observed['physical_standby']=c.sql('SELECT pg_is_in_recovery()',replica=True)=='t';c.synchronous()
   strict=runtime.copy();strict['HYPERFIDE_REQUIRE_SYNC_REPLICA']='1'
   observed['sync_policy_ready']=call({'mode':'inspect'},strict).get('ok') is True
   strictjob=baseenv.copy();strictjob['HYPERFIDE_REQUIRE_SYNC_REPLICA']='1'
   observed['sync_policy_precommit']=call({'mode':'precommit'},strictjob).get('error',{}).get('code')=='DURABILITY_UNAVAILABLE'
   c.synchronous()
   durable=uid();observed['sync_durable']=call({'mode':'durable','id':durable},runtime).get('ok') is True and c.sql("SELECT count(*) FROM hyperfide.organisations WHERE id='"+durable+"'",replica=True)=='1'
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
   baseenv['DATABASE_URL']=c.url();baseenv['HYPERFIDE_MIGRATION_DATABASE_URL']=c.url()
   params=json.loads(baseenv['HF44_PARAMETERS']);params['oldPrimary']=str(c.standby);params['oldSocket']=str(c.replica_socket/('.s.PGSQL.'+str(c.port)));baseenv['HF44_PARAMETERS']=json.dumps(params)
   restored_activation=call({'mode':'activate','operation_id':uid(),'epoch':epoch})
   observed['restore_fresh_epoch']=restored_activation.get('ok') is True and restored_activation['result']['epoch'] not in [epoch,next_epoch]
   runtime['DATABASE_URL']=c.url(user='hf_runtime')
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
