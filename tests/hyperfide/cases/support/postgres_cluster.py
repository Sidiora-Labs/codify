"""Owned PostgreSQL18 physical replication fixture; never touches the shared database."""
from pathlib import Path
import os,pwd,shutil,subprocess,tempfile,time,socket,json,urllib.parse
class PostgresCluster:
 def __init__(self,root=None):
  self.root=Path(root) if root else Path(tempfile.mkdtemp(prefix='hf-pg-',dir='/tmp/hyperfide'))
  self.owner=pwd.getpwnam('postgres');self.bin=Path('/usr/lib/postgresql/18/bin')
  self.processes={};self.port=55441;self.primary=self.root/'primary';self.standby=self.root/'standby';self.logs=[]
  self.socket=self.root/'primary-socket';self.replica_socket=self.root/'standby-socket'
  for d in [self.root,self.socket,self.replica_socket]:d.mkdir(exist_ok=True);os.chown(d,self.owner.pw_uid,self.owner.pw_gid)
  self.run('initdb','-D',str(self.primary),'-U','hf_operator','--auth=trust','--no-locale','--encoding=UTF8')
  self.configure(self.primary,self.socket)
  self.start(self.primary)
 def run(self,*args,timeout=45):
  argv=['runuser','-u','postgres','--',str(self.bin/args[0]),*map(str,args[1:])]
  p=subprocess.run(argv,text=True,capture_output=True,timeout=timeout)
  self.logs.append({'argv':argv,'returncode':p.returncode,'stdout':p.stdout[-3000:],'stderr':p.stderr[-3000:]})
  if p.returncode:raise RuntimeError('Owned PG fixture command failed: '+str(args[0])+': '+p.stderr[-1000:])
  return p.stdout
 def configure(self,directory,socketdir):
  with (directory/'postgresql.conf').open('a') as f:f.write("\nlisten_addresses=''\nport="+str(self.port)+"\nunix_socket_directories='"+str(socketdir)+"'\nwal_level=replica\nmax_wal_senders=8\nhot_standby=on\nfsync=on\nfull_page_writes=on\n")
 def start(self,directory):
  log=(self.root/(directory.name+'.log')).open('ab')
  process=subprocess.Popen(['runuser','-u','postgres','--',str(self.bin/'postgres'),'-D',str(directory)],stdout=log,stderr=log)
  log.close();self.processes[str(directory)]=process
  target=self.replica_socket if directory==self.standby else self.socket
  if directory.name=='restored':target=self.root/'restored-socket'
  for _ in range(400):
   if process.poll() is not None:raise RuntimeError('Owned foreground PostgreSQL failed to start')
   ready=subprocess.run([str(self.bin/'pg_isready'),'-q','-h',str(target),'-p',str(self.port)],capture_output=True)
   if ready.returncode==0:return
   time.sleep(.025)
  raise RuntimeError('Owned PostgreSQL readiness deadline expired')
 def stop(self,directory):
  self.run('pg_ctl','-D',str(directory),'-m','immediate','-w','stop')
  if str(directory) in self.processes:self.processes[str(directory)].wait(timeout=10)
 def sql(self,text,replica=False,user='hf_operator',database='postgres'):
  return self.run('psql','-X','-qAt','-v','ON_ERROR_STOP=1','-h',str(self.replica_socket if replica else self.socket),'-p',self.port,'-U',user,'-d',database,'-c',text).strip()
 def url(self,replica=False,user='hf_operator'):
  return 'postgresql://'+user+'@localhost:'+str(self.port)+'/postgres?host='+urllib.parse.quote(str(self.replica_socket if replica else self.socket),safe='')
 def replicate(self):
  self.run('pg_basebackup','-h',str(self.socket),'-p',self.port,'-U','hf_operator','-D',str(self.standby),'-X','stream','--checkpoint=fast')
  (self.standby/'standby.signal').touch()
  self.configure(self.standby,self.replica_socket)
  with (self.standby/'postgresql.auto.conf').open('a') as f:f.write("\nprimary_conninfo='host="+str(self.socket)+" port="+str(self.port)+" user=hf_operator application_name=hf44_standby'\n")
  self.start(self.standby)
  for _ in range(200):
   if self.sql("SELECT count(*) FROM pg_stat_replication WHERE application_name='hf44_standby' AND state='streaming'")=='1':return
   time.sleep(.025)
  raise RuntimeError('Actual standby did not enter streaming')
 def synchronous(self,enabled=True):
  self.sql("ALTER SYSTEM SET synchronous_standby_names="+("'FIRST 1 (hf44_standby)'" if enabled else "''"))
  self.sql('SELECT pg_reload_conf()')
  if enabled:
   for _ in range(200):
    if self.sql("SELECT count(*) FROM pg_stat_replication WHERE sync_state='sync' AND state='streaming'")=='1':return
    time.sleep(.025)
   raise RuntimeError('Actual standby did not become synchronous')
 def promote(self):self.run('pg_ctl','-D',str(self.standby),'-w','promote')
 def backup(self,name='backup'):
  target=self.root/name;self.run('pg_basebackup','-h',str(self.socket),'-p',self.port,'-U','hf_operator','-D',str(target),'-X','stream','--checkpoint=fast');return target
 def stopped(self,directory,socketdir):
  p=subprocess.run(['runuser','-u','postgres','--',str(self.bin/'pg_ctl'),'-D',str(directory),'status'],capture_output=True)
  connection=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);connection.settimeout(.2)
  try:connection.connect(str(socketdir/('.s.PGSQL.'+str(self.port))));return False
  except (FileNotFoundError,ConnectionRefusedError):return p.returncode==3
  finally:connection.close()
 def close(self):
  for d in list(self.root.iterdir()):
   if d.is_dir() and (d/'postmaster.pid').exists():
    try:self.stop(d)
    except Exception:pass
  for process in self.processes.values():
   try:process.wait(timeout=10)
   except subprocess.TimeoutExpired:pass
  absent=all(process.poll() is not None for process in self.processes.values()) and all(not (d/'postmaster.pid').exists() for d in self.root.iterdir() if d.is_dir())
  if absent:shutil.rmtree(self.root)
  return absent and not self.root.exists()
