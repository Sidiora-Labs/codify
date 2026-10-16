#!/usr/bin/env python3
"""Real Unix/process custody fixtures. No native frontier permission/auth qualification."""
import base64,concurrent.futures,ctypes,datetime,fcntl,hashlib,json,os,pathlib,select,shutil,signal,socket,stat,subprocess,sys,tempfile,time,uuid
ROOT=pathlib.Path(__file__).resolve().parents[4]
HOST=ROOT/'runtime/supervisory_host.py'
FAIL=[]
def uid():return str(uuid.uuid4())
def sha(b):return 'sha256:'+hashlib.sha256(b).hexdigest()
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:FAIL.append(name);actual=type(error).__name__+': '+str(error)
 print(json.dumps({'type':'assertion','id':'supervisory.host.'+name,'expected':'observed','actual':actual}),flush=True)
def expect(ok,message='Unexpected real host outcome'):
 if not ok:raise AssertionError(message)
def until(fn,timeout=5):
 deadline=time.monotonic()+timeout
 while time.monotonic()<deadline:
  value=fn()
  if value:return value
  time.sleep(.02)
 raise AssertionError('Real process/socket observation timed out')
def proc(pid):
 try:
  text=pathlib.Path('/proc',str(pid),'stat').read_text();tail=text[text.rfind(')')+2:].split()
  return {'pid':pid,'pgid':int(tail[2]),'start_time':tail[19],'kernel_boot_id':pathlib.Path('/proc/sys/kernel/random/boot_id').read_text().strip(),'ppid':int(tail[1]),'sid':int(tail[3]),'state':tail[0]}
 except FileNotFoundError:return None
AGENT='''import json,os,signal,sys,time
mode=sys.argv[1]
status=open('/proc/self/status').read()
print(json.dumps({'ready':True,'pid':os.getpid(),'uid':os.getuid(),'gid':os.getgid(),'groups':os.getgroups(),'nnp':'NoNewPrivs:\\t1' in status,'env':dict(os.environ),'argv':sys.argv}),flush=True)
print('ERR:ready',file=sys.stderr,flush=True)
if mode=='echo':
 for line in sys.stdin.buffer:
  sys.stdout.buffer.write(b'ECHO:'+line);sys.stdout.buffer.flush()
elif mode=='fork':
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 child=os.fork()
 if child==0:
  while not os.path.exists(os.environ['HOME']+'/escape'):time.sleep(.01)
  os.setsid();print(json.dumps({'descendant':os.getpid()}),flush=True)
 while True:time.sleep(.1)
elif mode=='spam':
 os.write(1,b'A'*200000);os.write(2,b'B'*100000)
 while True:time.sleep(.1)
else:
 signal.signal(signal.SIGTERM,signal.SIG_IGN)
 while True:time.sleep(.1)
'''
class Fixture:
 def __init__(self):
  expect(os.geteuid()==0,'Actual root fixture identity required');expect(ctypes.CDLL(None).prctl(36,1,0,0,0)==0,'Actual test subreaper required')
  self.folder=tempfile.TemporaryDirectory(prefix='hfsh-',dir='/tmp');self.path=pathlib.Path(self.folder.name);self.path.chmod(0o755);self.child=None;self.leaders=[];self.outs=[]
  self.private=self.path/'private';self.private.mkdir(mode=0o700)
  for name in ('state','plans','sock'):(self.private/name).mkdir(mode=0o700)
  self.control_uid=63001;self.control_gid=63001;self.socket_parent=self.path/'socket';self.socket_parent.mkdir(mode=0o750);self.socket_parent.chmod(0o750);os.chown(self.socket_parent,0,self.control_gid);self.socket=self.socket_parent/'s';self.state=self.private/'state';self.plans=self.private/'plans';self.work=self.path/'work';self.work.mkdir(mode=0o755);self.work.chmod(0o755)
  self.agent=self.path/'agent.py';self.agent.write_text(AGENT);self.agent.chmod(0o644);self.python=str(pathlib.Path('/usr/bin/python3').resolve());expect(pathlib.Path(self.python).is_file(),'Actual distro Python executable required')
  self.ids=[62000+i for i in range(5)]
  for target in self.ids:
   expect(not self.uid_pids(target),'Fixture UID already has a process')
  self.profiles={}
  for mode,target in zip(('echo','block','fork','spam','drift'),self.ids):
   home=self.path/('home-'+mode);temp=self.path/('tmp-'+mode)
   for p in (home,temp):p.mkdir(mode=0o700);os.chown(p,target,target)
   binary=self.python
   if mode=='drift':binary=str(self.path/'pinned-python');shutil.copyfile(self.python,binary);os.chmod(binary,0o755)
   self.profiles[mode]={'purpose':'MAIN_SUPERVISOR','profile_digest':sha(('fixture-profile-'+mode).encode()),'restriction_profile_digest':sha(b'FIXTURE_NOT_FRONTIER_QUALIFICATION'),'binary_digest':sha(pathlib.Path(binary).read_bytes()),'argv':[binary,'-I','-u',str(self.agent),mode],'cwd':str(self.work),'uid':target,'gid':target,'home':str(home),'temp':str(temp),'env':{'PATH':'/usr/bin:/bin','HOME':str(home),'XDG_CONFIG_HOME':str(home)+'/.config','TMPDIR':str(temp),'LANG':'C.UTF-8'}}
  self.profiles['echo']['argv'].append('')
  for profile in self.profiles.values():profile['resource_vector']={'cpu_millis':'1000','memory_bytes':'1073741824','agent_slots':'1'};profile['max_runtime_seconds']=60
  policy=self.private/'policy.json';self.write(policy,{'schema_version':1,'profiles':list(self.profiles.values())})
  self.config=self.private/'config.json';self.body={'schema_version':1,'socket_path':str(self.socket),'state_root':str(self.state),'plan_root':str(self.plans),'allowed_uids':self.ids,'max_children':4,'policy_file':str(policy),'policy_sha256':hashlib.sha256(policy.read_bytes()).hexdigest(),'termination_grace_seconds':.15,'max_output_bytes':8192,'control_uid':self.control_uid,'control_gid':self.control_gid};self.write(self.config,self.body)
  self.start_host()
 def as_control(self,value):
  encoded=base64.b64encode(json.dumps(value,separators=(',',':')).encode()+b'\n').decode();script="import socket,base64; s=socket.socket(socket.AF_UNIX);s.settimeout(8);s.connect("+repr(str(self.socket))+");s.sendall(base64.b64decode("+repr(encoded)+"));o=b''\nwhile not o.endswith(b'\\n'):\n b=s.recv(65536)\n if not b:break\n o+=b\nprint(o.decode())"
  out=subprocess.run([self.python,'-I','-c',script],user=self.control_uid,group=self.control_gid,extra_groups=(),env={'PATH':'/usr/bin:/bin','LANG':'C.UTF-8'},capture_output=True,text=True,timeout=10);expect(out.returncode==0,'Actual authorised control process failed: '+out.stderr[:300]);return json.loads(out.stdout)
 def write(self,path,body):path.write_bytes(json.dumps(body,separators=(',',':')).encode()+b'\n');path.chmod(0o600)
 def uid_pids(self,target):
  found=[]
  for name in os.listdir('/proc'):
   if name.isdecimal():
    try:
     lines=pathlib.Path('/proc',name,'status').read_text().splitlines();value=int(next(x for x in lines if x.startswith('Uid:')).split()[1])
     if value==target:found.append(int(name))
    except FileNotFoundError:pass
  return found
 def argv(self,config=None):
  p=config or self.config;return [sys.executable,'-I','-B',str(HOST),'--config',str(p),'--config-sha256',hashlib.sha256(p.read_bytes()).hexdigest()]
 def start_host(self,nofile=None):
  env=dict(os.environ,HOST_SECRET_CANARY='fixture-host-only-canary');self.child=subprocess.Popen(self.argv(),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env,preexec_fn=(lambda:__import__('resource').setrlimit(__import__('resource').RLIMIT_NOFILE,(nofile,nofile))) if nofile is not None else None)
  deadline=time.monotonic()+8;messages=[]
  while time.monotonic()<deadline:
   ready,_,_=select.select([self.child.stderr],[],[],.05)
   if ready:
    line=self.child.stderr.readline();messages.append(line)
    if '"event": "ready"' in line:return
   if self.child.poll() is not None:break
  raise AssertionError('Actual host startup failed: '+''.join(messages)[:800])
 def request(self,value,raw=None):
  data=raw if raw is not None else json.dumps(value,separators=(',',':')).encode()+b'\n'
  with socket.socket(socket.AF_UNIX,socket.SOCK_STREAM) as sock:
   sock.settimeout(8);sock.connect(str(self.socket));sock.sendall(data);out=bytearray()
   while not out.endswith(b'\n'):
    b=sock.recv(65536)
    if not b:return {'transport_unknown':True}
    out.extend(b);expect(len(out)<=1048576,'Actual host exceeded reply bound')
   return json.loads(out)
 def ok(self,value):
  r=self.request(value);expect(r.get('ok') is True,str(r));return r['result']
 def no(self,value,code=None,raw=None):
  r=self.request(value,raw);expect(r.get('ok') is False and (code is None or r['error']['code']==code),'Unsafe host request accepted or wrong refusal: '+str(r))
 def plan(self,mode='echo',**changes):
  p=dict({k:v for k,v in self.profiles[mode].items() if k not in ('resource_vector','max_runtime_seconds')},schema_version=1,launch_id=uid(),session_id=uid(),organisation_id=uid(),run_id=uid(),leader_generation='1',package_id=None,package_generation=None,capacity_reservation_ids=[uid()],expires_at=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=60)).isoformat(timespec='milliseconds').replace('+00:00','Z'),max_runtime_seconds=30);p.update(changes);path=self.plans/(p['launch_id']+'.json');self.write(path,p);return p,{'action':'start','plan_path':str(path),'plan_digest':hashlib.sha256(path.read_bytes()).hexdigest()}
 def launch(self,mode='echo',**changes):
  p,q=self.plan(mode,**changes);r=self.ok(q);self.leaders.append(r['process_identity']);return p,q,r
 def inspect(self,p,**kw):return self.ok(dict(action='inspect',launch_id=p['launch_id'],**kw))
 def frame(self,p,identity,data,operation=None):return {'action':'input','launch_id':p['launch_id'],'process_identity':identity,'operation_id':operation or uid(),'frame_digest':sha(data),'frame_b64':base64.b64encode(data).decode()}
 def stop(self,p,r,operation=None):return self.ok({'action':'stop','launch_id':p['launch_id'],'process_identity':r['process_identity'],'operation_id':operation or uid()})
 def stream(self,p,name='stdout'):return b''.join(base64.b64decode(x['frame_b64']) for x in self.inspect(p)['frames'] if x['stream']==name)
 def ready(self,p):return until(lambda:self.stream(p).startswith(b'{') and b'\n' in self.stream(p) and json.loads(self.stream(p).split(b'\n')[0]))
 def shrink_pipe(self):
  # A real kernel pipe is reduced to one page; no host outcomes are substituted.
  candidates=[]
  for path in pathlib.Path('/proc',str(self.child.pid),'fd').iterdir():
   try:
    if not os.readlink(path).startswith('pipe:'):continue
    text=pathlib.Path('/proc',str(self.child.pid),'fdinfo',path.name).read_text();flags=int(next(x for x in text.splitlines() if x.startswith('flags:')).split()[1],8)
    if flags&os.O_ACCMODE==os.O_WRONLY and flags&os.O_NONBLOCK:candidates.append(path)
   except FileNotFoundError:pass
  expect(len(candidates)==1,'Expected one real native stdin writer')
  fd=os.open(candidates[0],os.O_WRONLY|os.O_NONBLOCK)
  try:expect(fcntl.fcntl(fd,fcntl.F_SETPIPE_SZ,4096)==4096,'Actual pipe resize failed')
  finally:os.close(fd)
 def reap(self):
  while True:
   try:pid,status=os.waitpid(-1,os.WNOHANG)
   except ChildProcessError:return
   if pid==0:return
   if self.child is not None and pid==self.child.pid:self.child.returncode=os.waitstatus_to_exitcode(status)
 def close(self):
  if self.child is not None and self.child.poll() is None:
   self.child.terminate()
   try:self.child.wait(timeout=4)
   except subprocess.TimeoutExpired:self.child.kill();self.child.wait(timeout=3)
  self.reap()
  for _ in range(100):
   owned=[]
   for target in self.ids:
    for pid in self.uid_pids(target):
     p=proc(pid)
     if p and p['ppid']==os.getpid():owned.append(p)
   if not owned:break
   for p in owned:
    if proc(p['pid'])==p:
     try:
      fd=os.pidfd_open(p['pid']);signal.pidfd_send_signal(fd,signal.SIGKILL);os.close(fd)
     except ProcessLookupError:pass
   self.reap();time.sleep(.02)
  complete=all(not self.uid_pids(target) for target in self.ids)
  if self.folder is not None:self.folder.cleanup()
  return complete and (self.path is None or not self.path.exists())
f=Fixture.__new__(Fixture);f.child=None;f.ids=[];f.folder=None;f.path=None
try:
 f.__init__()
 def probe():
  r=subprocess.run([sys.executable,'-I',str(HOST),'--probe'],capture_output=True,text=True);expect(r.returncode==0 and all(json.loads(r.stdout).values()),'Actual kernel prerequisites failed')
 check('kernel.actual-required-capabilities',probe)
 check('kernel.refuse-nonisolated-python',lambda:expect(subprocess.run([sys.executable,str(HOST),'--probe'],capture_output=True).returncode!=0))
 check('socket.private-owner-mode',lambda:expect(stat.S_IMODE(f.socket.stat().st_mode)==0o660 and f.socket.stat().st_gid==f.control_gid and f.socket.stat().st_uid==0))
 def bad_config():
  p=f.private/'bad-config.json';f.write(p,dict(f.body,policy_sha256='0'*64));r=subprocess.run(f.argv(p),capture_output=True,text=True);expect(r.returncode!=0 and json.loads(r.stderr)['error']['code']=='POLICY_DRIFT')
 check('startup.policy-byte-pin',bad_config)
 p,q,r=f.launch();native=f.ready(p)
 check('start.actual-kernel-identity',lambda:expect(all(proc(r['process_identity']['pid'])[k]==v for k,v in r['process_identity'].items())))
 check('start.fixed-empty-argv-preserved',lambda:expect(native['argv'][-1]==''))
 check('start.actual-private-native-uid',lambda:expect(native['uid']==p['uid'] and native['gid']==p['gid'] and native['groups']==[] and native['nnp'] is True))
 check('start.no-inherited-host-environment',lambda:expect('HOST_SECRET_CANARY' not in native['env'] and native['env']['HOME']==p['home']))
 check('start.exact-plan-replay',lambda:expect(f.ok(q)['replayed'] is True and f.ok(q)['process_identity']==r['process_identity']))
 def plan_conflict():
  changed=dict(p,session_id=uid());path=f.plans/(uid()+'.json');f.write(path,changed);f.no({'action':'start','plan_path':str(path),'plan_digest':hashlib.sha256(path.read_bytes()).hexdigest()},'LAUNCH_CONFLICT')
 check('start.conflicting-launch-refused',plan_conflict)
 def immutable_scope():
  original=f.inspect(p);keys=('organisation_id','run_id','session_id','leader_generation','package_id','package_generation','profile_digest','restriction_profile_digest','capacity_reservation_ids','expires_at','max_runtime_seconds');expect(all(original[k]==p[k] for k in keys));expect(original['plan_digest']==q['plan_digest'] and original['policy_digest']=='sha256:'+f.body['policy_sha256'] and original['execution_profile_digest']==sha(json.dumps(f.profiles['echo'],sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()));foreign=dict(p,organisation_id=uid(),run_id=uid(),session_id=uid());path=f.plans/(uid()+'.json');f.write(path,foreign);f.no({'action':'start','plan_path':str(path),'plan_digest':hashlib.sha256(path.read_bytes()).hexdigest()},'LAUNCH_CONFLICT');current=f.inspect(p);expect(all(current[k]==original[k] for k in (*keys,'plan_digest','policy_digest','execution_profile_digest')) and current['organisation_id']!=foreign['organisation_id'] and current['process_identity']==r['process_identity'])
 check('inspect.cross-scope-collision-preserves-original-plan-provenance',immutable_scope)
 first=f.frame(p,r['process_identity'],b'one\n');a=f.ok(first)
 check('input.pipe-ack-is-unacknowledged-native',lambda:expect(a['delivery']=='UNACKNOWLEDGED_NATIVE' and a['bytes_written']==4 and a['retry_safe'] is False))
 until(lambda:b'ECHO:one\n' in f.stream(p));repeat=f.ok(first)
 check('input.durable-idempotent-receipt',lambda:expect(repeat['replayed'] is True and repeat['delivery']==a['delivery']))
 time.sleep(.1)
 check('input.replay-never-writes-twice',lambda:expect(f.stream(p).count(b'ECHO:one\n')==1))
 different=dict(first,frame_b64=base64.b64encode(b'changed\n').decode(),frame_digest=sha(b'changed\n'))
 check('input.conflicting-operation-refused',lambda:f.no(different,'IDEMPOTENCY_CONFLICT'))
 second=f.ok(f.frame(p,r['process_identity'],'two-λ\n'.encode()));until(lambda:'ECHO:two-λ\n'.encode() in f.stream(p))
 check('input.stdin-survives-client-disconnect',lambda:expect(second['delivery']=='UNACKNOWLEDGED_NATIVE' and proc(r['process_identity']['pid']) is not None))
 check('input.digest-refused',lambda:f.no(dict(first,operation_id=uid(),frame_digest='sha256:'+'0'*64),'INVALID_FRAME'))
 def frames_valid():
  frames=f.inspect(p)['frames'];expect([int(x['sequence']) for x in frames]==list(range(1,len(frames)+1)));expect(all(sha(base64.b64decode(x['frame_b64']))==x['frame_digest'] for x in frames));expect(any(x['stream']=='stderr' for x in frames))
 check('inspect.actual-output-sequence-and-byte-digests',frames_valid)
 one=f.inspect(p,limit=1);later=f.inspect(p,after_sequence=one['frames'][0]['sequence'],limit=1)
 check('inspect.bounded-pagination',lambda:expect(len(one['frames'])==1 and later['frames'][0]['sequence']=='2'))
 check('inspect.invalid-limit-refused',lambda:f.no({'action':'inspect','launch_id':p['launch_id'],'limit':65}))
 check('inspect.numeric-cursor-refused',lambda:f.no({'action':'inspect','launch_id':p['launch_id'],'after_sequence':0}))
 check('socket.arbitrary-exec-refused',lambda:f.no({'action':'exec','argv':['/bin/sh','-c','false']},'ACTION_DENIED'))
 check('socket.duplicate-json-keys-refused',lambda:f.no(None,'INVALID_JSON',b'{"action":"inspect","action":"start"}\n'))
 check('socket.oversize-refused',lambda:f.no(None,'REQUEST_BOUND',b'{"x":"'+b'x'*131072+b'"}\n'))
 for key,value in [('start_time',str(int(r['process_identity']['start_time'])+1)),('kernel_boot_id',uid())]:
  check('identity.forged-'+key+'-refused',lambda key=key,value=value:f.no({'action':'stop','launch_id':p['launch_id'],'process_identity':dict(r['process_identity'],**{key:value}),'operation_id':uid()},'PROCESS_IDENTITY_MISMATCH'))
 foreign=subprocess.Popen(['/usr/bin/sleep','10'])
 try:
  other=proc(foreign.pid);other={k:other[k] for k in ('pid','pgid','start_time','kernel_boot_id')}
  check('identity.actual-unrelated-process-protected',lambda:(f.no({'action':'stop','launch_id':p['launch_id'],'process_identity':other,'operation_id':uid()},'PROCESS_IDENTITY_MISMATCH'),expect(foreign.poll() is None)))
 finally:foreign.terminate();foreign.wait(timeout=2)
 def peer_denied():
  f.socket.parent.chmod(0o755);f.socket.chmod(0o666)
  script="import json,socket; s=socket.socket(socket.AF_UNIX); s.connect("+repr(str(f.socket))+"); print(s.recv(4096).decode())"
  try:
   out=subprocess.run([f.python,'-I','-c',script],user=63000,group=63000,extra_groups=(),capture_output=True,text=True);expect(out.returncode==0 and json.loads(out.stdout)['error']['code']=='PEER_DENIED','Actual different-UID peer was not refused')
  finally:f.socket.chmod(0o660);f.socket.parent.chmod(0o750)
 check('socket.actual-peer-credentials-refused',peer_denied)
 for label,change in [('unlisted-argv',{'argv':p['argv']+['--invented']}),('worker-purpose',{'purpose':'WORKER'}),('expired',{'expires_at':'2020-01-01T00:00:00.000Z'}),('runtime-bound',{'max_runtime_seconds':29}),('attempt-authority',{'attempt_id':uid()})]:
  def deny_plan(change=change):
   candidate,start=f.plan(**change);f.no(start)
  check('plan.'+label+'-refused',deny_plan)
 def forged_file(mode):
  candidate,start=f.plan();path=pathlib.Path(start['plan_path'])
  if mode=='permissions':path.chmod(0o644)
  elif mode=='symlink':link=f.plans/(uid()+'.json');link.symlink_to(path);start['plan_path']=str(link)
  elif mode=='hardlink':link=f.plans/(uid()+'.json');os.link(path,link)
  try:f.no(start)
  finally:
   if mode=='permissions':path.chmod(0o600)
   elif mode=='hardlink':link.unlink()
 for mode in ('permissions','symlink','hardlink'):check('plan.'+mode+'-refused',lambda mode=mode:forged_file(mode))
 check('plan.outside-root-refused',lambda:f.no({'action':'start','plan_path':str(f.config),'plan_digest':'0'*64},'UNSAFE_PATH'))
 operation=uid();stop=f.stop(p,r,operation);until(lambda:proc(r['process_identity']['pid']) is None)
 check('stop.actual-kernel-cleanup',lambda:expect(stop['cleanup_complete'] is True and stop['status']=='STOPPED'))
 check('stop.durable-replay',lambda:expect(f.stop(p,r,operation)['replayed'] is True))
 check('start.completed-intent-never-reexecutes',lambda:expect(f.ok(q)['replayed'] is True and proc(r['process_identity']['pid']) is None))
 def historical_stop():
  current,_,started=f.launch();f.ready(current);old=f.stop(p,r);expect(old['cleanup_complete'] is True and old['historical'] is True);expect(proc(started['process_identity']['pid']) is not None,'Historical stop killed new same-UID launch');sent=f.ok(f.frame(current,started['process_identity'],b'historical-safe\n'));expect(sent['delivery']=='UNACKNOWLEDGED_NATIVE');until(lambda:b'ECHO:historical-safe\n' in f.stream(current));old_members=json.loads((f.state/p['launch_id']/'state.json').read_text())['members'];expect(started['process_identity']['pid'] not in [m['pid'] for m in old_members]);f.stop(current,started)
 check('stop.historical-cleanup-cannot-adopt-reused-uid',historical_stop)
 def broker_positive():
  profile=f.profiles['echo'];selector={'action':'profile.inspect','profile_digest':profile['profile_digest'],'restriction_profile_digest':profile['restriction_profile_digest']};pre=f.as_control(selector);expect(pre.get('ok') is True,str(pre));info=pre['result'];expect(info['resource_vector']==profile['resource_vector']);expect(info['execution_profile_digest']==sha(json.dumps(profile,sort_keys=True,separators=(',',':'),ensure_ascii=False).encode()))
  candidate,_=f.plan();(f.plans/(candidate['launch_id']+'.json')).unlink();metadata={k:candidate[k] for k in ('launch_id','session_id','organisation_id','run_id','leader_generation','package_id','package_generation','profile_digest','restriction_profile_digest','capacity_reservation_ids','expires_at','max_runtime_seconds')};q=dict(metadata,action='start_profile',expected_policy_digest=info['policy_digest'],expected_execution_profile_digest=info['execution_profile_digest']);started=f.as_control(q);expect(started.get('ok') is True,str(started));observed=started['result'];f.leaders.append(observed['process_identity']);f.ready(candidate)
  sealed=f.plans/(candidate['launch_id']+'.json');expect(observed['sealed_plan'] is True and observed['plan_digest']==hashlib.sha256(sealed.read_bytes()).hexdigest() and sealed.stat().st_uid==0 and stat.S_IMODE(sealed.stat().st_mode)==0o600)
  expect(f.as_control(q)['result']['replayed'] is True,'Broker repeated start reexecuted intent')
  for changed in [dict(q,argv=['/bin/sh']),dict(q,uid=0),dict(q,expected_execution_profile_digest='sha256:'+'0'*64),dict(q,max_runtime_seconds=61)]:expect(f.as_control(changed).get('ok') is False,'Control could override root execution policy')
  request=f.frame(candidate,observed['process_identity'],b'broker\n');sent=f.as_control(request);expect(sent.get('ok') is True and sent['result']['delivery']=='UNACKNOWLEDGED_NATIVE');until(lambda:b'ECHO:broker\n' in f.stream(candidate))
  expect(f.as_control({'action':'start','plan_path':str(sealed),'plan_digest':observed['plan_digest']}).get('error',{}).get('code')=='PEER_ACTION_DENIED','Nonroot control accessed raw-plan path API')
  secret_read=subprocess.run([f.python,'-I','-c','open('+repr(str(sealed))+').read()'],user=f.control_uid,group=f.control_gid,extra_groups=(),capture_output=True);expect(secret_read.returncode!=0,'Control could read private root plan store')
  stopped=f.as_control({'action':'stop','launch_id':candidate['launch_id'],'process_identity':observed['process_identity'],'operation_id':uid()});expect(stopped.get('ok') is True and stopped['result']['cleanup_complete'] is True)
 check('broker.actual-authorised-nonroot-fixed-profile-lifecycle',broker_positive)
 def broker_request():
  profile=f.profiles['echo'];info=f.as_control({'action':'profile.inspect','profile_digest':profile['profile_digest'],'restriction_profile_digest':profile['restriction_profile_digest']})['result'];candidate,_=f.plan();(f.plans/(candidate['launch_id']+'.json')).unlink();metadata={k:candidate[k] for k in ('launch_id','session_id','organisation_id','run_id','leader_generation','package_id','package_generation','profile_digest','restriction_profile_digest','capacity_reservation_ids','expires_at','max_runtime_seconds')};return dict(metadata,action='start_profile',expected_policy_digest=info['policy_digest'],expected_execution_profile_digest=info['execution_profile_digest'])
 for label,change in [('policy-drift',{'expected_policy_digest':'sha256:'+'0'*64}),('execution-drift',{'expected_execution_profile_digest':'sha256:'+'0'*64}),('argv',{'argv':['/bin/sh']}),('uid',{'uid':0}),('resource-vector',{'resource_vector':{'cpu_millis':'99999'}}),('runtime',{'max_runtime_seconds':61}),('expiry-window',{'expires_at':(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(seconds=120)).isoformat(timespec='milliseconds').replace('+00:00','Z')})]:
  check('broker.'+label+'-refused',lambda change=change:expect(f.as_control(dict(broker_request(),**change)).get('ok') is False))
 check('broker.unregistered-profile-refused',lambda:expect(f.as_control({'action':'profile.inspect','profile_digest':'sha256:'+'0'*64,'restriction_profile_digest':f.profiles['echo']['restriction_profile_digest']}).get('ok') is False))
 def concurrent_starts():
  x,a=f.plan();y,b=f.plan()
  with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:responses=list(pool.map(f.request,[a,b]))
  good=[v for v in responses if v.get('ok')];bad=[v for v in responses if not v.get('ok')];expect(len(good)==1 and len(bad)==1 and bad[0]['error']['code']=='UID_BUSY','Same-UID starts were not exclusive')
  winner=x if responses[0].get('ok') else y;f.leaders.append(good[0]['result']['process_identity']);f.stop(winner,good[0]['result'])
 check('start.actual-concurrent-uid-exclusion',concurrent_starts)
 fork,_,child=f.launch('fork');f.ready(fork);until(lambda:len(json.loads((f.state/fork['launch_id']/'state.json').read_text())['members'])>=2)
 members=json.loads((f.state/fork['launch_id']/'state.json').read_text())['members'];descendant=next(m for m in members if m['pid']!=child['process_identity']['pid']);expect(descendant['pgid']==child['process_identity']['pgid'],'Child escaped before initial custody observation');pathlib.Path(fork['home'],'escape').touch();escaped=until(lambda:(v:=proc(descendant['pid'])) and v['sid']==descendant['pid'] and v);check('stop.actual-tracked-descendant-changes-session',lambda:expect(escaped['pgid']!=descendant['pgid'] and escaped['start_time']==descendant['start_time']));before=time.monotonic();fork_stop=f.stop(fork,child)
 check('stop.actual-escaped-descendants-reaped',lambda:expect(fork_stop['cleanup_complete'] is True and all(proc(m['pid']) is None for m in members) and time.monotonic()-before<3))
 spam,_,spammer=f.launch('spam');until(lambda:f.inspect(spam)['output_truncated']);output=f.inspect(spam)
 check('inspect.bounded-real-output-spool',lambda:expect(output['output_truncated'] is True and (f.state/spam['launch_id']/'output.jsonl').stat().st_size<=16384 and sum(len(base64.b64decode(v['frame_b64'])) for v in output['frames'])<=8192))
 f.stop(spam,spammer)
 block,_,blocked=f.launch('block');f.ready(block);f.shrink_pipe();partial=f.ok(f.frame(block,blocked['process_identity'],b'x'*65536))
 check('input.actual-kernel-partial-write',lambda:expect(partial['delivery']=='PARTIAL_UNKNOWN' and 0<partial['bytes_written']<partial['frame_length'] and partial['retry_safe'] is False))
 check('input.partial-closes-unsafe-stdin',lambda:f.no(f.frame(block,blocked['process_identity'],b'new'),'STDIN_UNAVAILABLE'))
 f.stop(block,blocked)
 crash,crash_start,crashed=f.launch('block');f.ready(crash);f.shrink_pipe();uncertain=f.frame(crash,crashed['process_identity'],b'z'*65536)
 with concurrent.futures.ThreadPoolExecutor(max_workers=1) as pool:
  future=pool.submit(f.request,uncertain);journal=f.state/crash['launch_id']/'operations'/(uncertain['operation_id']+'.json');until(lambda:journal.exists() and json.loads(journal.read_text())['state']=='INTENT');f.child.kill();f.child.wait(timeout=3);unknown=future.result(timeout=3)
 until(lambda:(f.reap() or not f.uid_pids(crash['uid'])));f.start_host();recovered=f.ok(uncertain)
 check('input.real-host-death-yields-unknown',lambda:expect(unknown.get('ok') is not True and recovered['delivery']=='UNKNOWN' and recovered['retry_safe'] is False))
 check('input.unknown-is-never-replayed',lambda:expect(f.ok(uncertain)['delivery']=='UNKNOWN' and f.ok(crash_start)['replayed'] is True and f.ok(crash_start)['process_identity']==crashed['process_identity'] and proc(crashed['process_identity']['pid']) is None))
 def actual_pid_reuse():
  # A private kernel PID namespace lets clone3 genuinely recycle the old PID.
  script=r"""import ast,ctypes,json,os,pathlib,signal,sys,time
path=pathlib.Path(sys.argv[1]);tree=ast.parse(path.read_text());prefix=[]
for node in tree.body:
 if isinstance(node,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='f' for t in node.targets):break
 prefix.append(node)
ns={'__file__':str(path),'__name__':'pidreuse_fixture'};exec(compile(ast.Module(body=prefix,type_ignores=[]),str(path),'exec'),ns)
Fixture=ns['Fixture'];expect=ns['expect'];until=ns['until'];proc=ns['proc'];fixture=Fixture();foreign=None
try:
 expect(os.getpid()==1,'PID isolation was not observed');plan,start,original=fixture.launch();fixture.ready(plan);old=original['process_identity'];fixture.child.kill();fixture.child.wait(timeout=3);until(lambda:(fixture.reap() or proc(old['pid']) is None));time.sleep(.05)
 readfd,writefd=os.pipe();wanted=ctypes.c_int(old['pid']);args=(ctypes.c_ulonglong*11)();args[4]=signal.SIGCHLD;args[8]=ctypes.addressof(wanted);args[9]=1;lib=ctypes.CDLL(None,use_errno=True);foreign=lib.syscall(435,ctypes.byref(args),ctypes.sizeof(args))
 if foreign==0:
  try:
   os.close(readfd);os.setsid();os.setgroups([]);os.setgid(plan['gid']);os.setuid(plan['uid']);os.write(writefd,b'R');os.close(writefd)
   while True:signal.pause()
  finally:os._exit(0)
 os.close(writefd);expect(foreign==old['pid'],'clone3 did not reuse the actual old PID');expect(os.read(readfd,1)==b'R');os.close(readfd);replacement=proc(foreign);expect(replacement['start_time']!=old['start_time'] and replacement['pgid']==old['pgid'] and replacement['kernel_boot_id']==old['kernel_boot_id'],'Distinct recycled kernel birth was not measured')
 fixture.start_host();replayed=fixture.ok(start);expect(replayed['replayed'] is True and replayed['process_identity']==old,'Recovery reexecuted the old intent');stopped=fixture.stop(plan,original);expect(stopped['cleanup_complete'] is False and stopped['status']=='UNKNOWN','Unrelated same-PID process was claimed as old custody');now=proc(foreign);expect(now is not None and now['start_time']==replacement['start_time'] and now['state']!='Z','Recovery killed the recycled unrelated process');candidate,request=fixture.plan();fixture.no(request,'UID_BUSY')
 fd=os.pidfd_open(foreign)
 try:
  now=proc(foreign);expect(now is not None and now['start_time']==replacement['start_time']);signal.pidfd_send_signal(fd,signal.SIGKILL)
 finally:os.close(fd)
 os.waitpid(foreign,0);foreign=None;until(lambda:fixture.inspect(plan)['cleanup_complete']);expect(fixture.ok(start)['replayed'] is True and not fixture.uid_pids(plan['uid']));print(json.dumps({'actual_pid_reused':old['pid'],'old_start_time':old['start_time'],'replacement_start_time':replacement['start_time'],'unrelated_preserved':True,'old_intent_reexecuted':False}),flush=True)
finally:
 expect(fixture.close(),'Private PID namespace fixture cleanup failed')
"""
  command=['/usr/bin/unshare','--user','--map-users=0,0,65536','--map-groups=0,0,65536','--setgroups=allow','--pid','--fork','--kill-child=KILL','--mount-proc',sys.executable,'-I','-B','-c',script,str(pathlib.Path(__file__).resolve())];result=subprocess.run(command,capture_output=True,text=True,timeout=25);expect(result.returncode==0,'Actual PID reuse fixture failed: '+result.stderr[:1000]);proof=json.loads(result.stdout);expect(proof['unrelated_preserved'] is True and proof['old_intent_reexecuted'] is False and proof['old_start_time']!=proof['replacement_start_time'])
 check('identity.actual-private-namespace-pid-reuse',actual_pid_reuse)
 def original_policy_provenance():
  original=f.inspect(p);f.child.terminate();f.child.wait(timeout=4);path=pathlib.Path(f.body['policy_file']);policy=json.loads(path.read_text());policy['profiles'][0]['resource_vector']['cpu_millis']='1100';f.write(path,policy);f.body['policy_sha256']=hashlib.sha256(path.read_bytes()).hexdigest();f.write(f.config,f.body);f.start_host();current=f.inspect(p);expect(current['policy_digest']==original['policy_digest'] and current['execution_profile_digest']==original['execution_profile_digest']);pre=f.ok({'action':'profile.inspect','profile_digest':p['profile_digest'],'restriction_profile_digest':p['restriction_profile_digest']});expect(pre['policy_digest']!=original['policy_digest'] and pre['execution_profile_digest']!=original['execution_profile_digest']);expect(f.ok(q)['policy_digest']==original['policy_digest'])
 check('recovery.original-policy-provenance-never-relabeled',original_policy_provenance)
 def large_historical_journal():
  # Serialization-bound fixture only: duplicate a measured historical member.
  # This never claims 4096 real processes or grants live process ownership.
  f.child.terminate();f.child.wait(timeout=4);record_path=f.state/p['launch_id']/'state.json';record=json.loads(record_path.read_text());expect(record['cleanup_complete'] is True);record['members']=[dict(record['members'][0]) for _ in range(4096)];f.write(record_path,record);expect(record_path.stat().st_size>131072);f.start_host();expect(f.ok(q)['replayed'] is True and f.ok(q)['cleanup_complete'] is True and not f.uid_pids(p['uid']));f.stop(p,r);expect(not f.uid_pids(p['uid']))
 check('recovery.bounded-large-historical-journal-shape-no-reexec',large_historical_journal)
 def drift():
  copied=pathlib.Path(f.profiles['drift']['argv'][0]);data=copied.read_bytes();copied.write_bytes(data[:-1]+bytes([data[-1]^1]));candidate,start=f.plan('drift');f.no(start,'BINARY_DRIFT')
 check('start.actual-binary-drift-refused',drift)
 # Actual per-process RLIMIT_NOFILE exhausts pipe2; no mocked descriptor failures.
 f.child.terminate();f.child.wait(timeout=4);f.start_host(nofile=18)
 before_fds=len(list(pathlib.Path('/proc',str(f.child.pid),'fd').iterdir()));failed_plan=None;failed_request=None
 for attempt in range(3):
  failed_plan,failed_request=f.plan();f.no(failed_request,'PIPE_ALLOCATION_FAILED')
 until(lambda:len(list(pathlib.Path('/proc',str(f.child.pid),'fd').iterdir()))==before_fds)
 check('start.real-emfile-pipe-failure-no-fd-leak',lambda:expect(len(list(pathlib.Path('/proc',str(f.child.pid),'fd').iterdir()))==before_fds and not f.uid_pids(failed_plan['uid'])))
 failed_record=json.loads((f.state/failed_plan['launch_id']/'state.json').read_text())
 check('start.failed-fork-intent-never-reexecutes',lambda:expect(failed_record['state']=='FAILED' and failed_record['process_identity'] is None and f.ok(failed_request)['replayed'] is True))
 f.child.terminate();f.child.wait(timeout=4);f.start_host()
 final,_,last=f.launch();f.ready(final);f.child.terminate();f.child.wait(timeout=4);f.reap()
 check('shutdown.actual-children-reaped-and-socket-removed',lambda:expect(proc(last['process_identity']['pid']) is None and not f.socket.exists() and json.loads((f.state/final['launch_id']/'state.json').read_text())['cleanup_complete'] is True))
finally:
 complete=f.close();print(json.dumps({'type':'cleanup','complete':complete,'resources':[]}),flush=True);expect(complete,'Real kernel process/private-file fixture cleanup incomplete')
raise SystemExit(bool(FAIL))
