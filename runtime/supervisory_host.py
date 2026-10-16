#!/usr/bin/env python3
"""Private MAIN process custody; no placement, admission or model authority.

Trusted policy and sealed plan select executable bytes. Journal precedes fork/input.
Pipe delivery never proves native consumption. Interrupted intents never reexecute.
"""
from __future__ import annotations
import argparse,asyncio,base64,ctypes,datetime as dt,fcntl,hashlib,json,os,re,signal,socket,stat,sys,time,uuid
from pathlib import Path
REQUEST_LIMIT=131072
STATE_LIMIT=2097152
REPLY_LIMIT=1048576
INPUT_LIMIT=65536
CHUNK=4096
UUID=re.compile(r'^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$')
SHA=re.compile(r'^sha256:[0-9a-f]{64}$')
BARE=re.compile(r'^[0-9a-f]{64}$')
DECIMAL=re.compile(r'^(0|[1-9][0-9]*)$')
EXEC_KEYS=('purpose','profile_digest','restriction_profile_digest','binary_digest','argv','cwd','uid','gid','home','temp','env')
POLICY_KEYS=(*EXEC_KEYS,'resource_vector','max_runtime_seconds')
BROKER_KEYS=('action','launch_id','session_id','organisation_id','run_id','leader_generation','package_id','package_generation','profile_digest','restriction_profile_digest','capacity_reservation_ids','expires_at','max_runtime_seconds','expected_policy_digest','expected_execution_profile_digest')
PLAN_KEYS=('schema_version',*EXEC_KEYS,'launch_id','session_id','run_id','organisation_id','leader_generation','package_id','package_generation','capacity_reservation_ids','expires_at','max_runtime_seconds')
IDENTITY_KEYS=('pid','pgid','start_time','kernel_boot_id')
BINDING_KEYS=('organisation_id','run_id','session_id','leader_generation','package_id','package_generation','profile_digest','restriction_profile_digest','capacity_reservation_ids','expires_at','max_runtime_seconds')
LIBC=None
BOOT=None
class Refusal(Exception):
 def __init__(self,code,message):self.code,self.message=code,message;super().__init__(message)
def need(ok,code='INVALID_REQUEST',message='Request is invalid'):
 if not ok:raise Refusal(code,message)
def exact(v,keys):need(type(v) is dict and set(v)==set(keys));return v
def integer(v,lo,hi):need(type(v) is int and lo<=v<=hi);return v
def uid(v):need(type(v) is str and UUID.fullmatch(v));return v
def decimal(v,positive=False):
 need(type(v) is str and len(v)<=19 and DECIMAL.fullmatch(v) and int(v)<=9223372036854775807 and (not positive or int(v)>0));return v
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()
def digest(b):return 'sha256:'+hashlib.sha256(b).hexdigest()
def pairs(items):
 result={}
 for k,v in items:need(k not in result,'INVALID_JSON','Duplicate JSON keys are refused');result[k]=v
 return result
def parse(data):
 try:return json.loads(data.decode(),object_pairs_hook=pairs,parse_constant=lambda _:(_ for _ in ()).throw(ValueError()))
 except Refusal:raise
 except (ValueError,UnicodeError,RecursionError):raise Refusal('INVALID_JSON','Strict bounded JSON is required') from None
def components(v):
 need(type(v) is str and v.startswith('/') and '\0' not in v,'UNSAFE_PATH','Absolute paths are required');p=Path(v)
 need(str(p)==v and '..' not in p.parts and '.' not in p.parts,'UNSAFE_PATH','Canonical paths are required');return p
def protected(path,private_leaf=False):
 p=components(str(path));current=Path('/')
 for i,item in enumerate(p.parts[1:]):
  current/=item;s=os.lstat(current);need(not stat.S_ISLNK(s.st_mode),'UNSAFE_PATH','Symlinks are refused')
  leaf=i==len(p.parts)-2
  if stat.S_ISDIR(s.st_mode) and not (leaf and private_leaf):
   sticky_tmp=current==Path('/tmp') and s.st_uid==0 and bool(s.st_mode&stat.S_ISVTX)
   need(sticky_tmp or s.st_uid==0 and s.st_mode&0o022==0,'UNSAFE_PATH','Path ancestors must be protected from native writes')
 return p
def root_directory(v):
 p=protected(v);s=p.stat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o700,'PRIVATE_PATH','Private roots require root-owned mode 0700');return p
def private_bytes(v,limit,root=None):
 p=protected(v)
 if root is not None:need(p.parent==root,'UNSAFE_PATH','Plan must be directly in its trusted root')
 fd=os.open(p,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1 and s.st_size<=limit,'PRIVATE_FILE','Bounded root-owned mode 0600 file required')
  b=bytearray()
  while len(b)<=limit:
   chunk=os.read(fd,min(65536,limit+1-len(b)))
   if not chunk:break
   b.extend(chunk)
  t=os.fstat(fd);need(len(b)<=limit and (s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(t.st_dev,t.st_ino,t.st_size,t.st_mtime_ns,t.st_ctime_ns),'FILE_DRIFT','File changed during read');return bytes(b)
 finally:os.close(fd)
def atomic(path,value):
 data=canonical(value)+b'\n';tmp=path.parent/('.'+path.name+'.'+str(uuid.uuid4()));fd=os.open(tmp,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
 try:
  view=memoryview(data)
  while view:
   n=os.write(fd,view);need(n>0,'JOURNAL_FAILURE','Journal made no progress');view=view[n:]
  os.fsync(fd)
 finally:os.close(fd)
 os.replace(tmp,path);fd=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:os.fsync(fd)
 finally:os.close(fd)
def process(pid):
 directory=None
 try:
  directory=os.open('/proc/'+str(pid),os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW|os.O_CLOEXEC)
  def read(name):
   fd=os.open(name,os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC,dir_fd=directory)
   try:return os.read(fd,65536).decode()
   finally:os.close(fd)
  text=read('stat');tail=text[text.rfind(')')+2:].split();status=read('status');again=read('stat');other=again[again.rfind(')')+2:].split()
  if tail[19]!=other[19]:return None
  real_uid=int(next(line for line in status.splitlines() if line.startswith('Uid:')).split()[1])
  return {'pid':pid,'pgid':int(other[2]),'start_time':other[19],'kernel_boot_id':BOOT,'ppid':int(other[1]),'sid':int(other[3]),'uid':real_uid,'status':other[0]}
 except (FileNotFoundError,ProcessLookupError):return None
 except (PermissionError,ValueError,IndexError,StopIteration):raise Refusal('KERNEL_OBSERVATION_FAILED','Process identity could not be measured') from None
 finally:
  if directory is not None:os.close(directory)
def identity(p):return {k:p[k] for k in IDENTITY_KEYS}
def same(expected,p):return p is not None and identity(p)==expected
def born_same(expected,p):return p is not None and all(expected[k]==p[k] for k in ('pid','start_time','kernel_boot_id'))
def uid_processes(target):
 result=[]
 for name in os.listdir('/proc'):
  if name.isdecimal():
   p=process(int(name))
   if p is not None and p['uid']==target:result.append(p)
 return result
def kernel_probe():
 global LIBC,BOOT
 need(sys.platform=='linux' and os.geteuid()==0,'KERNEL_UNSUPPORTED','Linux root service identity is required')
 need(sys.flags.isolated==1 and hasattr(os,'fork') and hasattr(os,'pidfd_open') and hasattr(signal,'pidfd_send_signal') and os.execve in os.supports_fd and hasattr(socket,'SO_PEERCRED'),'KERNEL_UNSUPPORTED','Isolated Python, fork, pidfd and peer credentials are mandatory')
 LIBC=ctypes.CDLL(None,use_errno=True);LIBC.prctl.argtypes=[ctypes.c_int,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong,ctypes.c_ulong];LIBC.prctl.restype=ctypes.c_int
 need(LIBC.prctl(36,1,0,0,0)==0,'KERNEL_UNSUPPORTED','Subreaper could not be enabled');value=ctypes.c_int()
 need(LIBC.prctl(37,ctypes.addressof(value),0,0,0)==0 and value.value==1,'KERNEL_UNSUPPORTED','Subreaper was not observed')
 BOOT=Path('/proc/sys/kernel/random/boot_id').read_text().strip();uid(BOOT);need(process(os.getpid()) is not None,'KERNEL_UNSUPPORTED','Actual procfs identity required');fd=os.pidfd_open(os.getpid());os.close(fd)
 return {'linux':True,'isolated_python':True,'subreaper':True,'procfs':True,'pidfd':True,'peer_credentials':True}
def secure_execution(v,allowed):
 need(v['purpose']=='MAIN_SUPERVISOR')
 for key in ('profile_digest','restriction_profile_digest','binary_digest'):need(type(v[key]) is str and SHA.fullmatch(v[key]))
 need(type(v['argv']) is list and 1<=len(v['argv'])<=64 and type(v['argv'][0]) is str and len(v['argv'][0])>0 and all(type(x) is str and len(x)<=4096 and '\0' not in x for x in v['argv']) and len(canonical(v['argv']))<=32768)
 integer(v['uid'],1000,2147483646);integer(v['gid'],1000,2147483646);need(v['uid'] in allowed)
 for key in ('home','temp'):
  p=protected(v[key],True);s=p.stat();need(stat.S_ISDIR(s.st_mode) and s.st_uid==v['uid'] and s.st_gid==v['gid'] and stat.S_IMODE(s.st_mode)==0o700,'PROFILE_INVALID','Private home/temp ownership is required')
 need(v['home']!=v['temp'],'PROFILE_INVALID','Home and temp must be separate')
 cwd=protected(v['cwd']).stat();need(stat.S_ISDIR(cwd.st_mode) and cwd.st_uid==0 and cwd.st_mode&0o022==0,'PROFILE_INVALID','Supervisory cwd must be protected')
 need(v['env']=={'PATH':'/usr/bin:/bin','HOME':v['home'],'XDG_CONFIG_HOME':v['home']+'/.config','TMPDIR':v['temp'],'LANG':'C.UTF-8'},'PROFILE_INVALID','Only fixed private-reference environment is permitted')
 s=protected(v['argv'][0]).stat();need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_mode&0o022==0 and s.st_mode&0o6000==0 and s.st_mode&0o111!=0,'PROFILE_INVALID','Protected absolute executable required')
def binary_fd(plan):
 fd=os.open(plan['argv'][0],os.O_RDONLY|os.O_NOFOLLOW|os.O_CLOEXEC)
 try:
  s=os.fstat(fd);need(stat.S_ISREG(s.st_mode) and s.st_uid==0 and s.st_mode&0o022==0 and s.st_mode&0o6000==0,'BINARY_DRIFT','Executable ownership changed');h=hashlib.sha256()
  while True:
   block=os.read(fd,65536)
   if not block:break
   h.update(block)
  t=os.fstat(fd);need((s.st_dev,s.st_ino,s.st_size,s.st_mtime_ns,s.st_ctime_ns)==(t.st_dev,t.st_ino,t.st_size,t.st_mtime_ns,t.st_ctime_ns) and 'sha256:'+h.hexdigest()==plan['binary_digest'],'BINARY_DRIFT','Executable bytes differ from policy');os.lseek(fd,0,os.SEEK_SET);return fd
 except BaseException:os.close(fd);raise
def expiry(v):
 need(type(v) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z',v),'PLAN_INVALID','Canonical UTC expiry required')
 try:t=dt.datetime.fromisoformat(v[:-1]+'+00:00')
 except ValueError:raise Refusal('PLAN_INVALID','Invalid calendar expiry') from None
 need(t.isoformat(timespec='milliseconds').replace('+00:00','Z')==v,'PLAN_INVALID','Noncanonical expiry');return t.timestamp()
class Entry:
 def __init__(self,path,record):
  self.path,self.record=path,record;self.stdin=None;self.pidfd=None;self.frames=[];self.output_fds=set();self.output_streams={};self.lock=asyncio.Lock();self.output_bytes=0;self.recovery_pending=False
 def save(self):atomic(self.path/'state.json',self.record)
 def op(self,key):return self.path/'operations'/(uid(key)+'.json')
 def receipt(self,key,request):
  path=self.op(key)
  if not path.exists():return None
  v=parse(private_bytes(path,REQUEST_LIMIT));need(v['request_digest']==request,'IDEMPOTENCY_CONFLICT','Operation identity binds another immutable request')
  if v['state']=='INTENT':
   result={'delivery':'UNKNOWN','retry_safe':False,'bytes_written':None} if v['kind']=='input' else {'status':'UNKNOWN','cleanup_complete':False};v['state']='COMPLETED';v['result']=result;atomic(path,v)
  return v['result']
 def begin(self,key,kind,request):
  need(sum(1 for _ in (self.path/'operations').iterdir())<65536,'OPERATION_BOUND','Operation journal bound reached');atomic(self.op(key),{'kind':kind,'request_digest':request,'state':'INTENT'})
 def finish(self,key,kind,request,result):atomic(self.op(key),{'kind':kind,'request_digest':request,'state':'COMPLETED','result':result});return result
class Host:
 def __init__(self,c,config_digest):
  exact(c,['schema_version','socket_path','state_root','plan_root','allowed_uids','max_children','policy_file','policy_sha256','termination_grace_seconds','max_output_bytes','control_uid','control_gid']);integer(c['schema_version'],1,1)
  need(type(c['allowed_uids']) is list and 1<=len(c['allowed_uids'])<=256 and len(set(c['allowed_uids']))==len(c['allowed_uids']))
  for value in c['allowed_uids']:integer(value,1000,2147483646)
  integer(c['control_uid'],1000,2147483646);integer(c['control_gid'],1000,2147483646);need(c['control_uid'] not in c['allowed_uids'],'CONTROL_IDENTITY','Control service must never share a native child UID');integer(c['max_children'],1,256);integer(c['max_output_bytes'],4096,67108864);need(type(c['termination_grace_seconds']) in (int,float) and .05<=c['termination_grace_seconds']<=30)
  self.config=c;self.config_digest=config_digest;self.state=root_directory(c['state_root']);self.plans=root_directory(c['plan_root']);self.socket=components(c['socket_path']);protected(str(self.socket.parent));sp=self.socket.parent.stat();need(sp.st_uid==0 and sp.st_gid==c['control_gid'] and stat.S_IMODE(sp.st_mode)==0o750,'SOCKET_PATH','Socket parent requires root/control-group ownership and mode0750');need(len(os.fsencode(self.socket))<=100,'SOCKET_PATH','Socket path is too long')
  need(type(c['policy_sha256']) is str and BARE.fullmatch(c['policy_sha256']),'POLICY_INVALID','Exact policy digest is required');data=private_bytes(c['policy_file'],4194304);need(hashlib.sha256(data).hexdigest()==c['policy_sha256'],'POLICY_DRIFT','Policy bytes changed')
  policy=exact(parse(data),['schema_version','profiles']);integer(policy['schema_version'],1,1);need(type(policy['profiles']) is list and 1<=len(policy['profiles'])<=256);self.profiles=[];self.catalog={};self.profile_bounds={}
  for p in policy['profiles']:
   exact(p,POLICY_KEYS);secure_execution(p,c['allowed_uids']);integer(p['max_runtime_seconds'],30,86400);vector=exact(p['resource_vector'],['cpu_millis','memory_bytes','agent_slots']);decimal(vector['cpu_millis'],True);decimal(vector['memory_bytes'],True);need(vector['agent_slots']=='1');key=(p['profile_digest'],p['restriction_profile_digest']);need(key not in self.catalog,'POLICY_INVALID','Profile/restriction selection must be unique');self.catalog[key]=p;execution=canonical({k:p[k] for k in EXEC_KEYS});self.profiles.append(execution);self.profile_bounds[execution]=p['max_runtime_seconds']
  self.lockfd=os.open(self.state/'host.lock',os.O_RDWR|os.O_CREAT|os.O_NOFOLLOW|os.O_CLOEXEC,0o600);s=os.fstat(self.lockfd);need(s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o600 and s.st_nlink==1,'PRIVATE_FILE','Unsafe host lock')
  try:fcntl.flock(self.lockfd,fcntl.LOCK_EX|fcntl.LOCK_NB)
  except BlockingIOError:raise Refusal('HOST_ALREADY_RUNNING','Another host owns this state root') from None
  self.entries={};self.server=None;self.closing=False;self.closed=asyncio.Event();self.clients=0;self.load()
 def load(self):
  for directory in self.state.iterdir():
   if directory.name=='host.lock':continue
   uid(directory.name);root_directory(str(directory));r=parse(private_bytes(directory/'state.json',STATE_LIMIT));need(r['launch_id']==directory.name,'JOURNAL_INVALID','Journal launch identity differs')
   entry=Entry(directory,r);entry.spool_bytes=0;log=directory/'output.jsonl'
   if log.exists():
    data=private_bytes(log,self.config['max_output_bytes']*2+65536);entry.spool_bytes=len(data)
    for line in data.splitlines(keepends=True):
     if not line.endswith(b'\n'):r['output_truncated']=True;break
     frame=exact(parse(line),['sequence','stream','frame_digest','frame_b64']);need(frame['sequence']==str(len(entry.frames)+1) and frame['stream'] in ('stdout','stderr'),'JOURNAL_INVALID','Output order is invalid')
     decoded=base64.b64decode(frame['frame_b64'],validate=True);need(len(decoded)<=CHUNK and digest(decoded)==frame['frame_digest'],'JOURNAL_INVALID','Output digest is invalid');entry.frames.append(frame);entry.output_bytes+=len(decoded)
   r['last_sequence']=str(len(entry.frames));r['output_bytes']=entry.output_bytes
   if not r.get('output_complete',False):r['output_truncated']=True
   if not r['cleanup_complete']:
    r['state']='RECOVERY_REQUIRED';r['stdin_state']='UNAVAILABLE_AFTER_HOST_RESTART';entry.recovery_pending=True
   entry.save();self.entries[r['launch_id']]=entry
 def view(self,e,after='0',limit=64):
  r=e.record;frames=[f for f in e.frames if int(f['sequence'])>int(after)][:limit]
  return {**{k:r['plan'][k] for k in BINDING_KEYS},'plan_digest':r['plan_digest'],'policy_digest':r.get('policy_digest'),'execution_profile_digest':r.get('execution_profile_digest'),'launch_id':r['launch_id'],'state':r['state'],'process_identity':r['process_identity'],'frames':frames,'last_sequence':r['last_sequence'],'output_truncated':r['output_truncated'],'exit_code':r['exit_code'],'signal':r['signal'],'cleanup_complete':r['cleanup_complete'],'stdin_state':r['stdin_state']}
 def observe(self,e):
  r=e.record
  if r['cleanup_complete']:return []
  leader=r['process_identity'];rows=uid_processes(r['plan']['uid'])
  if leader is None or leader['kernel_boot_id']!=BOOT:return rows
  known={str(m['pid'])+':'+m['start_time'] for m in r['members']};live=[p for m in r['members'] if born_same(m,p:=process(m['pid']))];pids={p['pid'] for p in live};session_anchored=any(p['sid']==leader['pid'] for p in live);changed=False
  for _ in range(len(rows)+1):
   added=False
   for p in rows:
    key=str(p['pid'])+':'+p['start_time']
    if key in known:continue
    if int(p['start_time'])>=int(leader['start_time']) and (session_anchored and p['sid']==leader['pid'] or p['ppid'] in pids or p['ppid']==os.getpid()):
     need(len(r['members'])<4096,'DESCENDANT_BOUND','Tracked descendant bound reached');r['members'].append(p);known.add(key);pids.add(p['pid']);added=changed=True
   if not added:break
  if changed:e.save()
  return rows
 def capture(self,e,fd,stream):
  try:
   for _ in range(16):
    try:data=os.read(fd,CHUNK)
    except BlockingIOError:return
    if not data:
     asyncio.get_running_loop().remove_reader(fd);e.output_fds.discard(fd);e.output_streams.pop(fd,None);os.close(fd)
     if not e.output_fds:e.record['output_complete']=True;e.save()
     return
    available=self.config['max_output_bytes']-e.output_bytes
    if available<=0:
     if not e.record['output_truncated']:e.record['output_truncated']=True;e.save()
     continue
    if len(data)>available:e.record['output_truncated']=True;data=data[:available]
    frame={'sequence':str(len(e.frames)+1),'stream':stream,'frame_digest':digest(data),'frame_b64':base64.b64encode(data).decode()};encoded=canonical(frame)+b'\n'
    if e.spool_bytes+len(encoded)>self.config['max_output_bytes']*2:
     e.record['output_truncated']=True;e.save();continue
    log=os.open(e.path/'output.jsonl',os.O_WRONLY|os.O_CREAT|os.O_APPEND|os.O_NOFOLLOW|os.O_CLOEXEC,0o600)
    try:
     offset=0
     while offset<len(encoded):
      n=os.write(log,encoded[offset:]);need(n>0,'JOURNAL_FAILURE','Output journal made no progress');offset+=n
     os.fsync(log)
    finally:os.close(log)
    e.spool_bytes+=len(encoded);e.frames.append(frame);e.output_bytes+=len(data);e.record['last_sequence']=frame['sequence'];e.record['output_bytes']=e.output_bytes;e.save()
  except BaseException:
   e.record['output_truncated']=True;e.record['state']='UNKNOWN';e.save();asyncio.get_running_loop().remove_reader(fd);e.output_fds.discard(fd);e.output_streams.pop(fd,None)
   try:os.close(fd)
   except OSError:pass
 async def read_handshake(self,fd):
  os.set_blocking(fd,False);deadline=time.monotonic()+3;data=b''
  try:
   while time.monotonic()<deadline:
    try:block=os.read(fd,1024)
    except BlockingIOError:await asyncio.sleep(.005);continue
    if not block:return data
    data+=block
    if b'\n' in data:return data
   raise Refusal('START_UNCERTAIN','Native setup exceeded its bound')
  finally:os.close(fd)
 def child(self,p,exe,stdin,out,err,gate,ready,exec_error,parent):
  try:
   for sig in (signal.SIGTERM,signal.SIGINT,signal.SIGPIPE,signal.SIGHUP):signal.signal(sig,signal.SIG_DFL)
   os.setsid();os.dup2(stdin,0);os.dup2(out,1);os.dup2(err,2);retain={0,1,2,gate,ready,exec_error,exe}
   for value in os.listdir('/proc/self/fd'):
    n=int(value)
    if n not in retain:
     try:os.close(n)
     except OSError:pass
   os.setgroups([]);os.setresgid(p['gid'],p['gid'],p['gid']);os.setresuid(p['uid'],p['uid'],p['uid'])
   if LIBC.prctl(38,1,0,0,0)!=0 or LIBC.prctl(1,signal.SIGKILL,0,0,0)!=0:os._exit(126)
   if os.getppid()!=parent:os._exit(125)
   os.chdir(p['cwd']);os.umask(0o077);os.write(ready,b'READY\n');os.close(ready)
   if os.read(gate,1)!=b'G':os._exit(125)
   os.close(gate);os.execve(exe,p['argv'],p['env'])
  except BaseException:
   try:os.write(exec_error,b'EXEC_FAILED\n')
   except OSError:pass
   os._exit(127)
 async def start(self,q):
  exact(q,['action','plan_path','plan_digest']);need(type(q['plan_digest']) is str and BARE.fullmatch(q['plan_digest']));data=private_bytes(q['plan_path'],REQUEST_LIMIT,self.plans);need(hashlib.sha256(data).hexdigest()==q['plan_digest'],'PLAN_DIGEST_MISMATCH','Sealed plan bytes differ');p=exact(parse(data),PLAN_KEYS);integer(p['schema_version'],1,1)
  for key in ('launch_id','session_id','organisation_id','run_id'):uid(p[key])
  launch=p['launch_id'];prior=self.entries.get(launch)
  if prior:need(prior.record['plan_digest']==q['plan_digest'],'LAUNCH_CONFLICT','Launch binds another sealed plan');return {**self.view(prior),'replayed':True}
  secure_execution(p,self.config['allowed_uids']);need(canonical({k:p[k] for k in EXEC_KEYS}) in self.profiles,'POLICY_DENIED','Execution tuple is not trusted')
  decimal(p['leader_generation'],True);need((p['package_id'] is None)==(p['package_generation'] is None))
  if p['package_id'] is not None:uid(p['package_id']);decimal(p['package_generation'],True)
  need(type(p['capacity_reservation_ids']) is list and 1<=len(p['capacity_reservation_ids'])<=32 and len(set(p['capacity_reservation_ids']))==len(p['capacity_reservation_ids']))
  for item in p['capacity_reservation_ids']:uid(item)
  need(expiry(p['expires_at'])>time.time(),'PLAN_EXPIRED','Start deadline expired');integer(p['max_runtime_seconds'],30,86400);need(p['max_runtime_seconds']<=self.profile_bounds[canonical({k:p[k] for k in EXEC_KEYS})],'PROFILE_RUNTIME_BOUND','Runtime exceeds root profile');need(not self.closing,'HOST_STOPPING','Host is stopping');need(not any(e.record['plan']['uid']==p['uid'] and not e.record['cleanup_complete'] for e in self.entries.values()),'UID_BUSY','A pending launch already reserves this native identity');need(not uid_processes(p['uid']),'UID_BUSY','Native identity already owns a process; no takeover is inferred');need(sum(not e.record['cleanup_complete'] for e in self.entries.values())<self.config['max_children'],'HOST_CAPACITY','Host process bound reached')
  exe=binary_fd(p)
  try:directory=self.state/launch;os.mkdir(directory,0o700);os.mkdir(directory/'operations',0o700)
  except BaseException:os.close(exe);raise
  r={'launch_id':launch,'plan_digest':q['plan_digest'],'policy_digest':'sha256:'+self.config['policy_sha256'],'execution_profile_digest':digest(canonical(self.catalog[(p['profile_digest'],p['restriction_profile_digest'])])),'plan':p,'state':'START_INTENT','process_identity':None,'members':[],'kernel_boot_id':BOOT,'started_at':time.time(),'started_monotonic':time.monotonic(),'last_sequence':'0','output_bytes':0,'output_truncated':False,'output_complete':False,'exit_code':None,'signal':None,'cleanup_complete':False,'stdin_state':'NOT_STARTED'}
  e=Entry(directory,r);e.spool_bytes=0
  try:e.save()
  except BaseException:os.close(exe);raise
  self.entries[launch]=e;pipes=[]
  try:
   for _ in range(6):pipes.append(os.pipe2(os.O_CLOEXEC))
  except OSError:
   for pair in pipes:
    for fd in pair:os.close(fd)
   os.close(exe);r['state']='FAILED';r['cleanup_complete']=True;e.save();raise Refusal('PIPE_ALLOCATION_FAILED','No native process was created') from None
  (ir,iw),(outr,outw),(errr,errw),(gr,gw),(rr,rw),(xr,xw)=pipes
  await e.lock.acquire()
  try:pid=os.fork()
  except OSError:
   for pair in pipes:
    for fd in pair:os.close(fd)
   os.close(exe);e.lock.release();r['state']='FAILED';r['cleanup_complete']=True;e.save();raise Refusal('FORK_FAILED','No native process was created') from None
  if pid==0:self.child(p,exe,ir,outw,errw,gr,rw,xw,os.getppid());os._exit(127)
  for fd in (ir,outw,errw,gr,rw,xw,exe):os.close(fd)
  try:
   need(await self.read_handshake(rr)==b'READY\n','START_FAILED','Native identity setup failed');actual=process(pid);need(actual is not None and actual['uid']==p['uid'] and actual['pgid']==pid and actual['sid']==pid,'KERNEL_IDENTITY','Native process isolation was not measured')
   e.pidfd=os.pidfd_open(pid);r['process_identity']=identity(actual);r['members']=[actual];r['state']='STARTING';e.stdin=iw;os.set_blocking(iw,False);r['stdin_state']='OPEN';e.save()
   # Child cannot execute until its exact kernel identity is durably recorded.
   need(not self.closing,'HOST_STOPPING','Host stopped before native exec');os.write(gw,b'G');os.close(gw);gw=None;errorfd=xr;xr=None;failure=await self.read_handshake(errorfd);need(not failure,'EXEC_FAILED','Pinned native executable failed')
   observed=process(pid);r['state']='RUNNING' if same(r['process_identity'],observed) and observed['status']!='Z' else 'EXITED';e.save()
   for fd,stream in ((outr,'stdout'),(errr,'stderr')):os.set_blocking(fd,False);e.output_fds.add(fd);e.output_streams[fd]=stream;asyncio.get_running_loop().add_reader(fd,self.capture,e,fd,stream)
   return {**self.view(e),'replayed':False}
  except BaseException:
   r['state']='RECOVERY_REQUIRED'
   if e.stdin is not None:
    try:os.close(e.stdin)
    except OSError:pass
    e.stdin=None
   elif r['process_identity'] is None:
    try:os.close(iw)
    except OSError:pass
   for fd in (gw,xr,outr,errr):
    if fd is not None:
     try:os.close(fd)
     except OSError:pass
   e.save();raise
  finally:e.lock.release()
 def get(self,launch):
  e=self.entries.get(uid(launch));need(e is not None,'LAUNCH_NOT_FOUND','Launch is not in this host journal');return e
 def require_identity(self,e,v):
  exact(v,IDENTITY_KEYS);integer(v['pid'],1,2147483646);integer(v['pgid'],1,2147483646);decimal(v['start_time'],True);uid(v['kernel_boot_id']);need(v==e.record['process_identity'],'PROCESS_IDENTITY_MISMATCH','Request does not bind the recorded kernel identity')
 async def input(self,q):
  exact(q,['action','launch_id','process_identity','operation_id','frame_digest','frame_b64']);e=self.get(q['launch_id']);self.require_identity(e,q['process_identity']);key=uid(q['operation_id']);need(type(q['frame_digest']) is str and SHA.fullmatch(q['frame_digest']) and type(q['frame_b64']) is str)
  try:frame=base64.b64decode(q['frame_b64'],validate=True)
  except (ValueError,TypeError):raise Refusal('INVALID_FRAME','Canonical base64 is required') from None
  need(0<len(frame)<=INPUT_LIMIT and base64.b64encode(frame).decode()==q['frame_b64'] and digest(frame)==q['frame_digest'],'INVALID_FRAME','Input frame size or digest is invalid');request=digest(canonical(q))
  async with e.lock:
   previous=e.receipt(key,request)
   if previous is not None:return {**previous,'replayed':True}
   need(not self.closing and e.record['state']=='RUNNING' and e.stdin is not None and same(q['process_identity'],process(q['process_identity']['pid'])),'STDIN_UNAVAILABLE','Original live native stdin is unavailable')
   e.begin(key,'input',request);written=0;deadline=time.monotonic()+.25
   while written<len(frame) and time.monotonic()<deadline:
    try:written+=os.write(e.stdin,frame[written:])
    except BlockingIOError:await asyncio.sleep(.01)
    except BrokenPipeError:break
   delivery='UNACKNOWLEDGED_NATIVE' if written==len(frame) else 'PARTIAL_UNKNOWN' if written else 'NOT_WRITTEN'
   if 0<written<len(frame):os.close(e.stdin);e.stdin=None;e.record['stdin_state']='CLOSED_AFTER_PARTIAL_WRITE';e.save()
   return e.finish(key,'input',request,{'delivery':delivery,'bytes_written':written,'frame_length':len(frame),'retry_safe':written==0,'replayed':False})
 def reap(self):
  while True:
   try:pid,status=os.waitpid(-1,os.WNOHANG)
   except ChildProcessError:return
   if pid==0:return
   for e in self.entries.values():
    p=e.record['process_identity']
    if p is not None and p['pid']==pid and not e.record['cleanup_complete']:
     e.record['exit_code']=os.WEXITSTATUS(status) if os.WIFEXITED(status) else None;e.record['signal']=os.WTERMSIG(status) if os.WIFSIGNALED(status) else None
     if e.pidfd is not None:os.close(e.pidfd);e.pidfd=None
     if e.stdin is not None:os.close(e.stdin);e.stdin=None;e.record['stdin_state']='CLOSED'
     e.record['state']='EXITED';e.save()
 async def terminate(self,e,natural=False):
  r=e.record
  # Completed custody is historical; a reused UID never grants renewed ownership.
  if r['cleanup_complete']:return {'status':r['state'],'cleanup_complete':True,'historical':True,'process_identity':r['process_identity']}
  if e.stdin is not None:
   try:os.close(e.stdin)
   except OSError:pass
   e.stdin=None;r['stdin_state']='CLOSED'
  r['state']='RECOVERY_REQUIRED';e.save();deadline=time.monotonic()+self.config['termination_grace_seconds'];sent=set()
  while True:
   self.reap();rows=self.observe(e);live=[]
   for member in r['members']:
    actual=process(member['pid'])
    if born_same(member,actual):live.append(actual)
   for actual in live:
    token=(actual['pid'],actual['start_time']);sig=signal.SIGTERM if time.monotonic()<deadline else signal.SIGKILL
    if (token,sig) in sent:continue
    try:
     pfd=os.pidfd_open(actual['pid'])
     try:
      if born_same(actual,process(actual['pid'])):signal.pidfd_send_signal(pfd,sig)
     finally:os.close(pfd)
    except ProcessLookupError:pass
    sent.add((token,sig))
   if not rows:r['cleanup_complete']=True;r['state']='EXITED' if natural else 'STOPPED';e.save();return {'status':r['state'],'cleanup_complete':True,'process_identity':r['process_identity']}
   if time.monotonic()>deadline+2:r['cleanup_complete']=False;r['state']='UNKNOWN';e.save();return {'status':'UNKNOWN','cleanup_complete':False,'process_identity':r['process_identity']}
   await asyncio.sleep(.02)
 async def stop(self,q):
  exact(q,['action','launch_id','process_identity','operation_id']);e=self.get(q['launch_id']);self.require_identity(e,q['process_identity']);key=uid(q['operation_id']);request=digest(canonical(q))
  async with e.lock:
   old=e.receipt(key,request)
   if old is not None:return {**old,'replayed':True}
   e.begin(key,'stop',request);result=await self.terminate(e);return e.finish(key,'stop',request,{**result,'replayed':False})
 def root_profile(self,q):
  for key in ('profile_digest','restriction_profile_digest'):need(type(q.get(key)) is str and SHA.fullmatch(q[key]))
  p=self.catalog.get((q['profile_digest'],q['restriction_profile_digest']));need(p is not None,'POLICY_DENIED','Root execution profile is not registered');return p
 def profile_inspect(self,q):
  exact(q,['action','profile_digest','restriction_profile_digest']);p=self.root_profile(q)
  return {'policy_digest':'sha256:'+self.config['policy_sha256'],'execution_profile_digest':digest(canonical(p)),'resource_vector':p['resource_vector'],'max_runtime_seconds':p['max_runtime_seconds']}
 async def start_profile(self,q):
  exact(q,BROKER_KEYS);p=self.root_profile(q)
  need(q['expected_policy_digest']=='sha256:'+self.config['policy_sha256'] and q['expected_execution_profile_digest']==digest(canonical(p)),'POLICY_DRIFT','Preflight policy/execution profile changed')
  for key in ('launch_id','session_id','organisation_id','run_id'):uid(q[key])
  decimal(q['leader_generation'],True);need((q['package_id'] is None)==(q['package_generation'] is None))
  if q['package_id'] is not None:uid(q['package_id']);decimal(q['package_generation'],True)
  reservations=q['capacity_reservation_ids'];need(type(reservations) is list and 1<=len(reservations)<=32 and len(set(reservations))==len(reservations))
  for value in reservations:uid(value)
  integer(q['max_runtime_seconds'],30,p['max_runtime_seconds']);deadline=expiry(q['expires_at'])
  plan={k:p[k] for k in EXEC_KEYS};plan.update({k:q[k] for k in ('launch_id','session_id','organisation_id','run_id','leader_generation','package_id','package_generation','capacity_reservation_ids','expires_at','max_runtime_seconds')});plan['schema_version']=1
  encoded=canonical(plan)+b'\n';path=self.plans/(plan['launch_id']+'.json');plan_digest=hashlib.sha256(encoded).hexdigest()
  if path.exists():need(private_bytes(path,REQUEST_LIMIT,self.plans)==encoded,'LAUNCH_CONFLICT','Existing sealed plan has different immutable metadata')
  else:
   need(time.time()<deadline<=time.time()+60,'PLAN_EXPIRED','New broker start must have a bounded future deadline');need(not self.closing,'HOST_STOPPING','Host is stopping');need(not any(e.record['plan']['uid']==p['uid'] and not e.record['cleanup_complete'] for e in self.entries.values()) and not uid_processes(p['uid']),'UID_BUSY','Root profile identity is already occupied');atomic(path,plan)
  result=await self.start({'action':'start','plan_path':str(path),'plan_digest':plan_digest});return {**result,'plan_digest':plan_digest,'sealed_plan':True}
 async def dispatch(self,q,peer_uid=0):
  need(type(q) is dict and type(q.get('action')) is str)
  if peer_uid!=0:need(q['action']!='start','PEER_ACTION_DENIED','Only root may reference sealed-plan paths')
  if q['action']=='profile.inspect':return self.profile_inspect(q)
  if q['action']=='start_profile':return await self.start_profile(q)
  if q['action']=='start':return await self.start(q)
  if q['action']=='input':return await self.input(q)
  if q['action']=='stop':return await self.stop(q)
  if q['action']=='inspect':
   need(set(q).issubset({'action','launch_id','after_sequence','limit'}) and {'action','launch_id'}.issubset(q));e=self.get(q['launch_id']);after=decimal(q.get('after_sequence','0'));limit=integer(q.get('limit',64),1,64);return self.view(e,after,limit)
  raise Refusal('ACTION_DENIED','Only fixed supervisory host actions are registered')
 async def client(self,reader,writer):
  self.clients+=1
  try:
   need(self.clients<=32,'CLIENT_BOUND','Control connection bound reached');peer=writer.get_extra_info('socket').getsockopt(socket.SOL_SOCKET,socket.SO_PEERCRED,12)
   import struct
   _,peer_uid,_=struct.unpack('3i',peer);need(peer_uid in (0,self.config['control_uid']),'PEER_DENIED','Control peer is not the configured service identity')
   data=await asyncio.wait_for(reader.readline(),5);need(data.endswith(b'\n') and len(data)<=REQUEST_LIMIT,'REQUEST_BOUND','A bounded JSONL request is required');result=await self.dispatch(parse(data),peer_uid);response={'ok':True,'result':result}
  except Refusal as error:response={'ok':False,'error':{'code':error.code,'message':error.message}}
  except (ValueError,asyncio.LimitOverrunError,asyncio.TimeoutError):response={'ok':False,'error':{'code':'REQUEST_BOUND','message':'Malformed, oversized or incomplete request'}}
  except Exception:response={'ok':False,'error':{'code':'HOST_ERROR','message':'Operation failed; inspect its durable record before retry'}}
  try:
   encoded=canonical(response)+b'\n'
   if len(encoded)>REPLY_LIMIT:encoded=canonical({'ok':False,'error':{'code':'REPLY_BOUND','message':'Reply exceeds transport bound'}})+b'\n'
   writer.write(encoded);await asyncio.wait_for(writer.drain(),2)
  except (BrokenPipeError,ConnectionResetError,asyncio.TimeoutError):pass
  finally:
   self.clients-=1;writer.close()
   try:await writer.wait_closed()
   except OSError:pass
 async def monitor(self):
  while not self.closing:
   try:
    self.reap()
    for e in list(self.entries.values()):
     r=e.record
     if r['cleanup_complete']:continue
     rows=self.observe(e)
     if not rows and r['state'] not in ('START_INTENT','STARTING'):
      r['cleanup_complete']=True;r['state']='EXITED' if r['state']=='RUNNING' else r['state'];e.save()
     elif not e.lock.locked() and (e.recovery_pending or r['state']=='EXITED' or r['state']=='RUNNING' and time.monotonic()-r['started_monotonic']>=r['plan']['max_runtime_seconds']):
      e.recovery_pending=False
      async with e.lock:await self.terminate(e,natural=r['state']=='EXITED')
   except Exception:
    # Failed measurements never become successful cleanup observations.
    for e in self.entries.values():
     if not e.record['cleanup_complete']:e.record['state']='UNKNOWN';e.save()
   await asyncio.sleep(.05)
 async def shutdown(self):
  if self.closing:return
  self.closing=True
  if self.server:self.server.close();await self.server.wait_closed()
  async def clean(e):
   async with e.lock:
    if not e.record['cleanup_complete']:await self.terminate(e)
  await asyncio.gather(*(clean(e) for e in self.entries.values()),return_exceptions=True);self.closed.set()
 async def run(self):
  if self.socket.exists():
   s=self.socket.lstat();need(stat.S_ISSOCK(s.st_mode) and s.st_uid==0 and stat.S_IMODE(s.st_mode)==0o660 and s.st_gid==self.config['control_gid'],'SOCKET_PATH','Existing socket is not this private service');self.socket.unlink()
  self.server=await asyncio.start_unix_server(self.client,path=str(self.socket),limit=REQUEST_LIMIT+1);os.chown(self.socket,0,self.config['control_gid']);os.chmod(self.socket,0o660);s=self.socket.lstat();owned=(s.st_dev,s.st_ino);loop=asyncio.get_running_loop()
  for sig in (signal.SIGTERM,signal.SIGINT):loop.add_signal_handler(sig,lambda:asyncio.create_task(self.shutdown()))
  task=asyncio.create_task(self.monitor());print(json.dumps({'event':'ready','config_sha256':self.config_digest,'policy_sha256':self.config['policy_sha256']}),file=sys.stderr,flush=True)
  try:await self.closed.wait()
  finally:
   task.cancel()
   for e in self.entries.values():
    for _ in range(4):
     for fd in list(e.output_fds):self.capture(e,fd,e.output_streams[fd])
     if not e.output_fds:break
     await asyncio.sleep(0)
    if e.output_fds:e.record['output_truncated']=True;e.save()
    for fd in list(e.output_fds):
     loop.remove_reader(fd)
     try:os.close(fd)
     except OSError:pass
    if e.pidfd is not None:os.close(e.pidfd)
   if self.socket.exists():
    s=self.socket.lstat()
    if (s.st_dev,s.st_ino)==owned:self.socket.unlink()
   os.close(self.lockfd)
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--config');parser.add_argument('--config-sha256');parser.add_argument('--probe',action='store_true');args=parser.parse_args()
 try:
  observed=kernel_probe()
  if args.probe:print(json.dumps(observed));return 0
  need(args.config is not None,'CONFIG_REQUIRED','Private startup configuration required');data=private_bytes(args.config,REQUEST_LIMIT);actual=hashlib.sha256(data).hexdigest()
  if args.config_sha256 is not None:need(BARE.fullmatch(args.config_sha256) and actual==args.config_sha256,'CONFIG_DRIFT','Pinned config bytes changed')
  host=Host(parse(data),actual);asyncio.run(host.run());return 0
 except Refusal as error:print(json.dumps({'error':{'code':error.code,'message':error.message}}),file=sys.stderr);return 1
 except Exception:print(json.dumps({'error':{'code':'HOST_STARTUP_FAILED','message':'Trusted host startup failed'}}),file=sys.stderr);return 1
if __name__=='__main__':raise SystemExit(main())
