#!/usr/bin/env python3
"""Real task4.2 service composition and PostgreSQL transaction evidence."""
import json,os,subprocess,sys,tempfile,time
from urllib.parse import parse_qsl,urlencode
import socket
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
BASE=Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/task42-standalone'))/'storage42'
BASE.mkdir(parents=True,exist_ok=True)
STATE=BASE/'resource.json'
IDS=['shared', 'committed', 'facade', 'primary', 'expired', 'brand', 'rollback', 'controls', 'quoted', 'retry', 'guard', 'retry_state', 'overload', 'queue_deadline', 'body_timeout', 'timeout_rollback', 'readonly', 'observer_brand', 'observer_expired', 'observer_write', 'migration_missing', 'copy', 'copy_state', 'copy_unsafe', 'pool_bound', 'external_state', 'shutdown', 'deadlock', 'guard_atomic', 'commit_ambiguous', 'commit_no_replay', 'commit_reconcile', 'commit_external', 'primary_readonly', 'proxy_cleanup', 'observer_escape', 'released_client']
DATABASE='hf42_'+str(os.getpid())
FAILED=[]

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
     if frontend and packet[:1]==b'Q' and packet[5:].rstrip(b'\0').strip().upper()==b'COMMIT':state['commit']=True
     if not frontend and state['commit'] and packet[:1]==b'C' and packet[5:]==b'COMMIT\0':
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

def envdb(db):
 env=os.environ.copy();u=urlsplit(env['DATABASE_URL']);env['DATABASE_URL']=urlunsplit((u.scheme,u.netloc,'/'+db,u.query,u.fragment));env['PGDATABASE']=db;return env
def sql(text,db=DATABASE):
 r=subprocess.run(['psql','-X','-qAt','-v','ON_ERROR_STOP=1','-d',db],input=text,text=True,capture_output=True,env=envdb(db),timeout=30)
 if r.returncode:raise RuntimeError('Fixture SQL failed: '+r.stderr[:300])
 return r.stdout.strip()
def cleanup(emit=True):
 try:
  db=json.loads(STATE.read_text())['database'] if STATE.exists() else None
  if db:
   if not db.startswith('hf42_') or not db[5:].isdigit():raise ValueError('Invalid owned database')
   sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+db+"' AND pid<>pg_backend_pid()", 'postgres')
   sql('DROP DATABASE IF EXISTS "'+db+'"','postgres')
  absent=not db or sql("SELECT count(*) FROM pg_database WHERE datname='"+db+"'",'postgres')=='0'
  state=json.loads(STATE.read_text()) if STATE.exists() else {}
  proxy_absent=True
  if state.get('proxy_path'):
   target=Path(state['proxy_path'])
   if not str(target).startswith('/tmp/hf42-proxy-'):raise ValueError('Invalid owned proxy path')
   observer=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);observer.settimeout(.2)
   try:observer.connect(str(target));proxy_absent=False
   except (FileNotFoundError,ConnectionRefusedError):target.unlink(missing_ok=True);proxy_absent=not target.exists()
   finally:observer.close()
  (BASE/'database-absence.json').write_text(json.dumps({'database_absent':absent,'proxy_absent':proxy_absent})+'\n')
  resources=[{'id':identity,'status':'deleted' if gone else 'unknown','observed_absent':gone,'evidence_artifact':'storage42/database-absence.json'} for identity,gone in [('hf-task-4.2-database',absent),('hf-task-4.2-wire-proxy',proxy_absent)]]
  if emit:print(json.dumps({'type':'cleanup','complete':absent and proxy_absent,'resources':resources}),flush=True)
  return absent and proxy_absent
 except Exception:
  if emit:print(json.dumps({'type':'cleanup','complete':False,'resources':[{'id':'hf-task-4.2-database','status':'unknown'}]}),flush=True)
  return False
def main():
 if '--cleanup' in sys.argv:return 0 if cleanup() else 1
 observations={}
 try:
  STATE.write_text(json.dumps({'database':DATABASE})+'\n')
  sql('CREATE DATABASE "'+DATABASE+'"','postgres')
  sql("CREATE TABLE hf42(k text PRIMARY KEY,v int NOT NULL);INSERT INTO hf42 VALUES('retry',0);CREATE TABLE hf42_copy(value int);CREATE SEQUENCE hf42_calls;INSERT INTO hf42 VALUES('locka',0),('lockb',0)")
  with tempfile.TemporaryDirectory(prefix='hf42-service-') as tmp:
   base=Path(tmp);modules=base/'modules';registry=base/'components';modules.mkdir();registry.mkdir()
   (modules/'package.json').write_text('{"type":"module"}')
   (modules/'a.js').write_text("\nexport async function createComponent(c){\n const resources=c.dependencies.require('4.2','storage.resources.v1',x=>!!x?.gateway);\n const identity={gateway:resources.gateway,resourceId:resources.describe().resourceId,pid:null};\n return {apiVersion:1,capabilities:{'fixture.identity':identity},actions:{\n 'fixture.first':async()=>{const result=await resources.gateway.withPrimaryTransaction({},tx=>tx.query(\"INSERT INTO hf42 VALUES('marker',1) RETURNING pg_backend_pid() AS pid\"));identity.pid=result.rows[0].pid;return {resourceId:identity.resourceId,pid:identity.pid};}\n }};\n}\n")
   fixture="\nimport {getPool} from 'SCHEMA_URL';\nimport {assertPrimaryTransaction} from 'TX_URL';\nexport function createComponent(c){\n const identity=c.dependencies.require('a','fixture.identity',x=>!!x?.gateway);\n const gateway=c.resources.gateway;\n const error=async(fn,code)=>{try{await fn();return false;}catch(e){return e.code===code;}};\n return {apiVersion:1,actions:{'fixture.exercise':async(input)=>{\n  if(input.mode==='ambiguous'){let calls=0,failure;try{await gateway.withPrimaryTransaction({maxRetries:3},async tx=>{calls++;await tx.query(\"SELECT nextval('hf42_calls')\");await tx.query(\"INSERT INTO hf42 VALUES('unknown',1)\");});}catch(e){failure=e;}const row=await gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT count(*)::int AS n FROM hf42 WHERE k='unknown'\"));return {commit_ambiguous:failure?.code==='COMMIT_AMBIGUOUS'&&failure?.outcome==='unknown',commit_no_replay:calls===1,commit_reconcile:row.rows[0].n===1};}\n\n  const out={};\n  out.shared=identity.gateway===gateway&&identity.resourceId===c.resources.describe().resourceId;\n  out.committed=(await gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT v FROM hf42 WHERE k='marker'\"))).rows[0]?.v===1;\n  const legacy=await getPool(c.env).query(\"SELECT v,pg_backend_pid() AS pid FROM hf42 WHERE k='marker'\");\n  out.facade=legacy.rows[0]?.v===1&&legacy.rows[0]?.pid===identity.pid;\n  let saved;\n  out.primary=await gateway.withPrimaryTransaction({},async tx=>{assertPrimaryTransaction(tx);saved=tx;return (await tx.query('SHOW transaction_isolation')).rows[0].transaction_isolation==='serializable';});\n  out.expired=await error(()=>saved.query('SELECT 1'),'TX_CLOSED');\n  out.brand=await error(async()=>assertPrimaryTransaction(saved),'TX_CLOSED');\n  await error(()=>gateway.withPrimaryTransaction({},async tx=>{await tx.query(\"INSERT INTO hf42 VALUES('rollback',1)\");throw Error('rollback');}),'DB_UNAVAILABLE');\n  out.rollback=(await gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT count(*)::int AS n FROM hf42 WHERE k='rollback'\"))).rows[0].n===0;\n  const controls=['COMMIT','COMMIT WORK','END','ROLLBACK','SELECT 1; COMMIT','/* comment */ START TRANSACTION',\"PREPARE TRANSACTION 'escape'\"];\n  out.controls=true;for(const sql of controls)out.controls=(await error(()=>gateway.withPrimaryTransaction({},tx=>tx.query(sql)),'INVALID_REQUEST'))&&out.controls;\n  out.quoted=(await gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT '; COMMIT' AS value\"))).rows[0].value==='; COMMIT';\n  let guard=0,calls=0;\n  await Promise.all([0,1].map(()=>gateway.withPrimaryTransaction({maxRetries:3,guard:async()=>{guard++;}},async tx=>{\n   calls++;const row=(await tx.query(\"SELECT v FROM hf42 WHERE k='retry'\")).rows[0];\n   await tx.query('SELECT pg_sleep(0.04)');await tx.query(\"UPDATE hf42 SET v=$1 WHERE k='retry'\",[row.v+1]);\n  })));\n  out.retry=calls>=3;out.guard=guard===calls;\n  out.retry_state=(await gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT v FROM hf42 WHERE k='retry'\"))).rows[0].v===2;\n\n  let errors=[],arrivals=0,unblock;\n  const barrier=new Promise(resolve=>{unblock=resolve;});\n  const tries=[0,0];\n  await Promise.all([0,1].map(which=>gateway.withPrimaryTransaction({timeoutMs:5000,maxRetries:3},async tx=>{\n   tries[which]++;const first=which===0?'locka':'lockb',second=which===0?'lockb':'locka';\n   await tx.query('UPDATE hf42 SET v=v+1 WHERE k=$1',[first]);\n   if(tries[which]===1){if(++arrivals===2)unblock();await barrier;}\n   try{await tx.query('UPDATE hf42 SET v=v+1 WHERE k=$1',[second]);}catch(e){errors.push(e.code);throw e;}\n  })));\n  out.deadlock=errors.includes('40P01')&&tries[0]+tries[1]>=3;\n  let ran=false;\n  out.guard_atomic=await error(()=>gateway.withPrimaryTransaction({guard:async tx=>{\n   await tx.query(\"INSERT INTO hf42 VALUES('guard',1)\");throw Error('guard-refusal');\n  }},async()=>{ran=true;}),'DB_UNAVAILABLE')&&!ran&&\n   (await gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT count(*)::int AS n FROM hf42 WHERE k='guard'\"))).rows[0].n===0;\n  const batch=await Promise.allSettled([0,1,2,3].map(()=>gateway.withPrimaryTransaction({},tx=>tx.query('SELECT pg_sleep(0.06)'))));\n  out.overload=batch.filter(x=>x.status==='fulfilled').length===3&&batch.some(x=>x.status==='rejected'&&x.reason.code==='DB_OVERLOADED');\n  const waiting=await Promise.allSettled([0,1,2].map((_,i)=>gateway.withPrimaryTransaction({timeoutMs:i===2?20:1000},tx=>tx.query('SELECT pg_sleep(0.09)'))));\n  out.queue_deadline=waiting[2].status==='rejected'&&waiting[2].reason.code==='TX_TIMEOUT';\n  out.body_timeout=await error(()=>gateway.withPrimaryTransaction({timeoutMs:30},async tx=>{\n   await tx.query(\"INSERT INTO hf42 VALUES('timeout',1)\");await tx.query('SELECT pg_sleep(1)');\n  }),'TX_TIMEOUT');\n  out.timeout_rollback=(await gateway.withPrimaryTransaction({},tx=>tx.query(\"SELECT count(*)::int AS n FROM hf42 WHERE k='timeout'\"))).rows[0].n===0;\n  let observer;\n  out.readonly=await c.resources.observe({},async session=>{observer=session;return (await session.query('SHOW transaction_read_only')).rows[0].transaction_read_only==='on';});\n  out.readonly=out.readonly.value&&out.readonly.route==='primary';\n  out.observer_brand=await error(async()=>assertPrimaryTransaction(observer),'TX_CLOSED');\n  out.observer_expired=await error(()=>observer.query('SELECT 1'),'TX_CLOSED');\n  out.observer_write=await error(()=>c.resources.observe({},s=>s.query(\"INSERT INTO hf42 VALUES('observe',1)\")),'25006');\n  out.observer_escape=await error(()=>c.resources.observe({},async session=>{await session.query('COMMIT');await session.query(\"INSERT INTO hf42 VALUES('observe-escape',1)\");}),'INVALID_REQUEST');\n  const released=await getPool(c.env).connect();released.release();\n  out.released_client=await error(()=>released.query(\"INSERT INTO hf42 VALUES('released',1)\"),'TX_CLOSED');\n  out.migration_missing=await error(()=>c.resources.withMigrationConnection({},s=>s.query('SELECT 1')),'DATABASE_CONFIG_INVALID');\n  const copied=await gateway.withPrimaryTransaction({},tx=>tx.copyFrom('COPY hf42_copy(value) FROM STDIN WITH (FORMAT text)',Buffer.from('1\\n2\\n')));\n  out.copy=copied.rowCount===2;\n  out.copy_state=(await gateway.withPrimaryTransaction({},tx=>tx.query('SELECT sum(value)::int AS n FROM hf42_copy'))).rows[0].n===3;\n  out.copy_unsafe=await error(()=>gateway.withPrimaryTransaction({},tx=>tx.copyFrom(\"COPY hf42_copy FROM PROGRAM 'false'\",Buffer.alloc(0))),'INVALID_REQUEST');\n  const metrics=c.resources.describe();\n  out.pool_bound=metrics.primary.totalCount<=2&&metrics.primary.active===0&&metrics.primary.queued===0;\n  return out;\n }}};\n}\n".replace('SCHEMA_URL',(ROOT/'services/hyperfide/dist/storage/schema.js').as_uri()).replace('TX_URL',(ROOT/'services/hyperfide/dist/storage/transactions.js').as_uri())
   (modules/'b.js').write_text(fixture)
   (modules/'runtime.js').write_text("export {createComponent} from '"+(ROOT/'services/hyperfide/dist/storage/runtime.js').as_uri()+"';\n")
   for id,module,actions,requires in [('4.2','runtime.js',['storage.runtime.describe'],[]),('a','a.js',['fixture.first'],['4.2']),('b','b.js',['fixture.exercise'],['4.2','a'])]:
    (registry/(id+'.json')).write_text(json.dumps({'schema_version':1,'id':id,'task':'4.2','roles':['control'],'module':module,'entry':'createComponent','api_version':1,'actions':actions,'requires':requires}))
   policy={'schema_version':1,'programme_id':'fixture42','repository':'fixture/repo','spec_revision':'fixture42','policy_revision':1,'status':'ACTIVE','approval':{'decision':'APPROVED','record_id':'approved-fixture','spec_revision':'fixture42','policy_revision':1},'allowed_roles':['control'],'allowed_actions':['programme.activate','storage.runtime.describe','fixture.first','fixture.exercise']}
   path=base/'policy.json';path.write_text(json.dumps(policy));env=envdb(DATABASE);env.update(HYPERFIDE_PG_POOL_MAX='2',HYPERFIDE_PG_MAX_QUEUED='1')
   env.pop('HYPERFIDE_MIGRATION_DATABASE_URL',None)
   requests=''.join(json.dumps({'id':id,'component':component,'action':action,'input':{}})+'\n' for id,component,action in [('first','a','fixture.first'),('exercise','b','fixture.exercise')])
   r=subprocess.run(['node','services/hyperfide/dist/control.js','--policy',str(path),'--spec-revision','fixture42','--components',str(registry),'--module-root',str(modules)],input=requests,text=True,capture_output=True,cwd=ROOT,env=env,timeout=60)
   (BASE/'service-stdout.jsonl').write_text(r.stdout);(BASE/'service-stderr.log').write_text(r.stderr)
   rows=[json.loads(x) for x in r.stdout.splitlines()]
   if len(rows)>1 and rows[1].get('ok'):observations.update(rows[1]['result'])
   observations['service_exit']=r.returncode
   observations['external_state']=sql("SELECT (SELECT count(*) FROM hf42 WHERE k='marker' AND v=1)||','||(SELECT count(*) FROM hf42 WHERE k IN ('rollback','timeout','observe','observe-escape','released'))||','||(SELECT sum(value) FROM hf42_copy)")=='1,0,3'
   for _ in range(100):
    if sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='hyperfide-authority'")=='0':break
    time.sleep(.02)
   observations['shutdown']=sql("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() AND application_name='hyperfide-authority'")=='0'
   sql('ALTER DATABASE "'+DATABASE+'" SET default_transaction_read_only=on','postgres')
   readonly=subprocess.run(['node','services/hyperfide/dist/control.js','--policy',str(path),'--spec-revision','fixture42','--components',str(registry),'--module-root',str(modules)],input=json.dumps({'id':'readonly','component':'a','action':'fixture.first','input':{}})+'\n',text=True,capture_output=True,cwd=ROOT,env=env,timeout=20)
   response=json.loads(readonly.stdout.strip())
   observations['primary_readonly']=readonly.returncode!=0 and response.get('error',{}).get('code')=='PRIMARY_REQUIRED'
   sql('ALTER DATABASE "'+DATABASE+'" RESET default_transaction_read_only','postgres')
   with tempfile.TemporaryDirectory(prefix='hf42-proxy-') as proxyroot:
    state=json.loads(STATE.read_text());state['proxy_path']=str(Path(proxyroot)/('.s.PGSQL.'+os.environ['PGPORT']));STATE.write_text(json.dumps(state)+'\n')
    proxy=CommitAckProxy(proxyroot)
    try:
     proxyenv=env.copy();parsed=urlsplit(env['DATABASE_URL']);query=dict(parse_qsl(parsed.query));query['host']=proxyroot;proxyenv['DATABASE_URL']=urlunsplit((parsed.scheme,parsed.netloc,parsed.path,urlencode(query),parsed.fragment))
     request=json.dumps({'id':'ambiguous','component':'b','action':'fixture.exercise','input':{'mode':'ambiguous'}})+'\n'
     result=subprocess.run(['node','services/hyperfide/dist/control.js','--policy',str(path),'--spec-revision','fixture42','--components',str(registry),'--module-root',str(modules)],input=request,text=True,capture_output=True,cwd=ROOT,env=proxyenv,timeout=30)
     (BASE/'proxy-service-stdout.jsonl').write_text(result.stdout);(BASE/'proxy-service-stderr.log').write_text(result.stderr)
     reply=json.loads(result.stdout.strip())
     if reply.get('ok'):observations.update(reply['result'])
     observations['commit_external']=proxy.dropped and sql("SELECT (SELECT count(*) FROM hf42 WHERE k='unknown')||','||(SELECT last_value FROM hf42_calls)")=='1,1'
    finally:proxy.close()
    observations['proxy_cleanup']=not Path(proxy.path).exists()

 except Exception as error:observations['error']=str(error)[:500]
 for name in IDS:
  actual=observations.get(name) is True
  if not actual:FAILED.append(name)
  print(json.dumps({'type':'assertion','id':'transactions.'+name,'expected':True,'actual':actual}),flush=True)
 (BASE/'observations.json').write_text(json.dumps(observations,sort_keys=True,indent=2)+'\n')
 ok=cleanup(emit=False)
 return 1 if FAILED or not ok else 0
if __name__=='__main__':raise SystemExit(main())
