#!/usr/bin/env python3
"""Packaged hyperfide/cg launchers for systemd units, the real MAIN supervisory host, and local/offline mode (V-027)."""
from pathlib import Path
import hashlib,json,os,shutil,signal,subprocess,sys,tempfile,time,uuid
ROOT=Path(__file__).resolve().parents[4]
DIST=ROOT/'services/hyperfide/dist'
FAIL=[]
def uid():return str(uuid.uuid4())
def expect(value,message='Actual launcher contract differs'):
 if not value:raise AssertionError(message)
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:FAIL.append(name);actual=type(error).__name__+': '+str(error)[:400]
 print(json.dumps({'type':'assertion','id':name,'expected':'observed','actual':actual}),flush=True)
def last_json(text):
 lines=[x for x in text.splitlines() if x.startswith('{')];return json.loads(lines[-1]) if lines else {}
def identifies_mode(text,mode):
 # Authority responses also carry task 25's ownership and cache metadata.
 result=json.loads(text)
 return result.get('ok') is True and result.get('mode')==mode and result.get('local_fallback') is False
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def tree(path):return {str(p.relative_to(path)):digest(p) for p in sorted(path.rglob('*')) if p.is_file()}
class Release:
 """A packaged release layout: runtime/node, services/{dist,package.json,runtime}; no PATH runtime lookup."""
 def __init__(self,base):
  self.root=base/'release';(self.root/'runtime').mkdir(parents=True);services=self.root/'services';services.mkdir()
  node=shutil.which('node');self.node=Path(subprocess.check_output([node,'-p','process.execPath'],text=True).strip())
  wrapper=self.root/'runtime/node';wrapper.write_text('#!/bin/sh\nexec '+json.dumps(str(self.node))+' "$@"\n');wrapper.chmod(0o755)
  shutil.copytree(DIST,services/'dist');shutil.copyfile(ROOT/'services/hyperfide/package.json',services/'package.json')
  (services/'node_modules').symlink_to(ROOT/'services/hyperfide/node_modules')
  (services/'runtime').mkdir();shutil.copyfile(ROOT/'runtime/supervisory_host.py',services/'runtime/supervisory_host.py');(services/'runtime/supervisory_host.py').chmod(0o644)
 def run(self,args,env,binary='hyperfide',timeout=60,cwd=None):
  e=dict(env,HYPERFIDE_RELEASE_ROOT=str(self.root))
  return subprocess.run([str(ROOT/binary),*args],cwd=cwd or self.root,env=e,text=True,capture_output=True,timeout=timeout)
class HostFixture:
 """Minimal real process-custody layout accepted by runtime/supervisory_host.py."""
 def __init__(self,base):
  self.path=base/'host';self.path.mkdir();self.path.chmod(0o755)
  private=self.path/'private';private.mkdir(mode=0o700)
  self.state=private/'state';self.plans=private/'plans'
  for p in (self.state,self.plans):p.mkdir(mode=0o700)
  self.control=63101;sock=self.path/'socket';sock.mkdir();sock.chmod(0o750);os.chown(sock,0,self.control);self.socket=sock/'s'
  work=self.path/'work';work.mkdir();work.chmod(0o755)
  home=self.path/'home';temp=self.path/'tmp';child=62101
  for p in (home,temp):p.mkdir(mode=0o700);os.chown(p,child,child)
  python=str(Path('/usr/bin/python3').resolve())
  profile={'purpose':'MAIN_SUPERVISOR','profile_digest':'sha256:'+hashlib.sha256(b'launcher-profile').hexdigest(),'restriction_profile_digest':'sha256:'+hashlib.sha256(b'FIXTURE_NOT_FRONTIER_QUALIFICATION').hexdigest(),'binary_digest':'sha256:'+digest(Path(python)),'argv':[python,'-I','-c','pass'],'cwd':str(work),'uid':child,'gid':child,'home':str(home),'temp':str(temp),'env':{'PATH':'/usr/bin:/bin','HOME':str(home),'XDG_CONFIG_HOME':str(home)+'/.config','TMPDIR':str(temp),'LANG':'C.UTF-8'},'resource_vector':{'cpu_millis':'1000','memory_bytes':'1073741824','agent_slots':'1'},'max_runtime_seconds':60}
  policy=private/'policy.json';policy.write_text(json.dumps({'schema_version':1,'profiles':[profile]}));policy.chmod(0o600)
  self.body={'schema_version':1,'socket_path':str(self.socket),'state_root':str(self.state),'plan_root':str(self.plans),'allowed_uids':[child],'max_children':2,'policy_file':str(policy),'policy_sha256':digest(policy),'termination_grace_seconds':.2,'max_output_bytes':8192,'control_uid':self.control,'control_gid':self.control}
  self.config=private/'config.json';self.write(self.config,self.body)
 def write(self,path,body,mode=0o600):path.write_text(json.dumps(body));path.chmod(mode);return path
def launchers(base,env):
 release=Release(base)
 described=subprocess.run([str(ROOT/'build/hyperfide-native'),'--component','26.4','--action','entrypoint.launchers.describe'],input='{}',text=True,capture_output=True,timeout=20)
 result=json.loads(described.stdout)['result'] if described.returncode==0 else {}
 check('launchers.native-component-describes-all-launchers',lambda:expect(result.get('launchers')==['bootstrap','issue-watcher','supervisory-host'] and result['path_fallback'] is False and result['canonical_command']=='hyperfide' and result['compatibility_command']=='cg'))
 units={}
 for name in ('issue-watcher','supervisory-host'):
  line=next(x for x in (ROOT/'deploy/hyperfide'/(name+'.service')).read_text().splitlines() if x.startswith('ExecStart='))
  units[name]=line[len('ExecStart='):].split()
 check('launchers.unit-execstart-served',lambda:expect(all(argv[0]=='/opt/hyperfide/current/bin/hyperfide' and argv[1]==name and argv[1] in result['launchers'] and argv[2]=='--config' and len(argv)==4 for name,argv in units.items())))
 cfg=base/'watcher.json';cfg.write_text('{}');cfg.chmod(0o600)
 local=dict(env,HYPERFIDE_MODE='local')
 canonical=release.run(['issue-watcher','--config',str(cfg)],local);alias=release.run(['issue-watcher','--config',str(cfg)],local,binary='cg')
 check('launchers.issue-watcher-execs-packaged-module',lambda:expect(canonical.returncode==78 and last_json(canonical.stderr)['error']['code']=='DISTRIBUTED_AUTHORITY_REQUIRED',canonical.stderr[-300:]))
 check('launchers.cg-alias-issue-watcher-parity',lambda:expect((alias.returncode,alias.stdout,alias.stderr)==(canonical.returncode,canonical.stdout,canonical.stderr)))
 distributed=release.run(['issue-watcher','--config',str(cfg)],dict(env,HYPERFIDE_MODE='distributed'))
 check('launchers.issue-watcher-config-validated',lambda:expect(distributed.returncode==78 and last_json(distributed.stderr)['error']['code']=='INVALID_REQUEST'))
 host=HostFixture(base)
 python=str(Path('/usr/bin/python3').resolve())
 host_env=dict(env,HYPERFIDE_SUPERVISOR_PYTHON=python)
 credentialed=release.run(['supervisory-host','--config',str(host.config)],dict(host_env,ANTHROPIC_API_KEY='fixture-not-a-key'))
 check('launchers.supervisory-host-refuses-model-credentials',lambda:expect(credentialed.returncode==78 and last_json(credentialed.stderr)['error']['code']=='SUPERVISORY_ONLY' and 'fixture-not-a-key' not in credentialed.stderr))
 database=release.run(['supervisory-host','--config',str(host.config)],dict(host_env,DATABASE_URL='postgres://fixture'))
 check('launchers.supervisory-host-refuses-authority-database',lambda:expect(database.returncode==78 and last_json(database.stderr)['error']['code']=='SUPERVISORY_ONLY'))
 no_python=release.run(['supervisory-host','--config',str(host.config)],env)
 check('launchers.supervisory-host-no-path-python-fallback',lambda:expect(no_python.returncode==78 and last_json(no_python.stderr)['error']['code']=='SUPERVISOR_RUNTIME_REQUIRED'))
 public=host.write(host.path/'private/public.json',host.body,0o644)
 shown=release.run(['supervisory-host','--config',str(public)],host_env)
 check('launchers.supervisory-host-public-config-refused',lambda:expect(shown.returncode==78 and last_json(shown.stderr)['error']['code']=='SUPERVISORY_CONFIG_INVALID'))
 placement=host.write(host.path/'private/placement.json',dict(host.body,placement_authority=True))
 widened=release.run(['supervisory-host','--config',str(placement)],host_env)
 check('launchers.supervisory-host-rejects-placement-authority',lambda:expect(widened.returncode==78 and last_json(widened.stderr)['error']['code']=='INVALID_REQUEST' and not host.socket.exists()))
 child=subprocess.Popen([str(ROOT/'hyperfide'),'supervisory-host','--config',str(host.config)],cwd=release.root,env=dict(host_env,HYPERFIDE_RELEASE_ROOT=str(release.root)),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
 ready=None;deadline=time.monotonic()+15
 try:
  while time.monotonic()<deadline and child.poll() is None:
   line=child.stderr.readline()
   if '"event": "ready"' in line:ready=json.loads(line);break
  check('launchers.supervisory-host-real-start-pinned-config',lambda:expect(ready is not None and ready['config_sha256']==digest(host.config) and host.socket.is_socket() and (host.socket.stat().st_mode&0o777)==0o660,'host did not become ready: '+str(child.poll())))
  child.send_signal(signal.SIGTERM);code=child.wait(timeout=15)
  check('launchers.supervisory-host-sigterm-clean-exit',lambda:expect(code==0 and not host.socket.exists(),'exit '+str(code)))
 finally:
  if child.poll() is None:child.kill();child.wait(5)
  child.stdout.close();child.stderr.close()
 broken=Release(base/'broken');(broken.root/'runtime/node').unlink()
 missing=broken.run(['issue-watcher','--config',str(cfg)],local)
 check('launchers.missing-packaged-runtime-no-path-fallback',lambda:expect(missing.returncode==78 and last_json(missing.stderr)['error']['code']=='PACKAGED_RUNTIME_UNAVAILABLE' and shutil.which('node',path=env['PATH']) is not None))
def offline(base,env):
 """V-027: no network namespace, no PostgreSQL endpoint, no model credentials."""
 repo=base/'offline-repo';repo.mkdir();home=base/'offline-home';home.mkdir()
 clean={'PATH':env['PATH'],'HOME':str(home),'LANG':'C.UTF-8'}
 subprocess.run(['git','init','-q',str(repo)],check=True,env=clean)
 (repo/'core.c').write_text('int core(void){return 1;}\nint main(void){return core();}\n')
 isolated=shutil.which('unshare') is not None and subprocess.run(['unshare','-n','true'],capture_output=True).returncode==0
 def native(*args,extra=None,binary='hyperfide'):
  e=dict(clean);e.update(extra or {})
  return subprocess.run((['unshare','-n'] if isolated else [])+[str(ROOT/binary),*args],cwd=repo,env=e,text=True,capture_output=True,timeout=60)
 check('offline.network-disabled-without-postgres-or-model-credentials',lambda:expect(isolated and not any(k in clean for k in ('DATABASE_URL','PGHOST','ANTHROPIC_API_KEY','OPENAI_API_KEY')) and native('authority','mode').returncode==0))
 init=native('init');mode=native('authority','mode')
 check('offline.local-mode-identified',lambda:expect(init.returncode==0 and identifies_mode(mode.stdout,'local')))
 remembered=native('remember','offline decision kept local');recalled=native('recall','--json');context=native('context','core','--json')
 check('offline.local-core-workflow-works',lambda:expect(remembered.returncode==0 and recalled.returncode==0 and json.loads(recalled.stdout)['memories'][0]['body']=='offline decision kept local' and context.returncode==0 and any(s['name']=='core' for s in json.loads(context.stdout)['symbols'])))
 def alias_parity():
  expect(native('recall','--json',binary='cg').stdout==recalled.stdout)
  canonical=last_json(native('authority','mode').stdout)
  alias=last_json(native('authority','mode',binary='cg').stdout)
  # Cache age advances between invocations; compare the remaining contract.
  canonical.get('cache',{}).pop('age_seconds',None)
  alias.get('cache',{}).pop('age_seconds',None)
  expect(alias==canonical)
 check('offline.cg-alias-local-parity',alias_parity)
 local_store=tree(repo/'.codegraph')
 marker=repo/'.hyperfide/authority.json';marker.parent.mkdir();marker.write_text(json.dumps({'schema_version':1,'mode':'distributed','authority_epoch':uid()}));marker.chmod(0o600)
 offline_mode=native('authority','mode',extra={'HYPERFIDE_MODE':'offline'})
 check('offline.distributed-client-identifies-offline',lambda:expect(offline_mode.returncode==0 and identifies_mode(offline_mode.stdout,'offline')))
 refused=native('remember','divergent offline write',extra={'HYPERFIDE_MODE':'offline'})
 check('offline.distributed-ownership-fails-clearly',lambda:expect(refused.returncode==78 and last_json(refused.stderr)=={'ok':False,'error':{'code':'OFFLINE_AUTHORITY_UNAVAILABLE','message':'Remote authority is unavailable while offline'},'local_fallback':False}))
 reconnected=native('authority','mode')
 request=base/'graph-status.json';request.write_text('{}')
 unreachable=native('graph','status','--run-id',uid(),'--operation-id',uid(),'--idempotency-key',uid(),'--correlation-id',uid(),'--input-file',str(request))
 check('offline.reconnected-unavailable-authority-fails-clearly',lambda:expect(json.loads(reconnected.stdout)['mode']=='distributed' and unreachable.returncode==78 and last_json(unreachable.stderr)['error']['code']=='TRANSPORT_CONFIG_REQUIRED' and last_json(unreachable.stderr)['local_fallback'] is False))
 divergent=native('remember','divergent write after reconnect')
 check('offline.local-store-cannot-overwrite-fleet-authority',lambda:expect(divergent.returncode==78 and last_json(divergent.stderr)['local_fallback'] is False and tree(repo/'.codegraph')==local_store))
 bootstrap=native('bootstrap','--input',str(base/'absent.json'),extra={'HYPERFIDE_MODE':'local','HYPERFIDE_RELEASE_ROOT':str(base/'release')})
 check('offline.local-mode-cannot-issue-authority',lambda:expect(bootstrap.returncode==78 and last_json(bootstrap.stderr)['error']['code']=='PRIMARY_REQUIRED'))
def main():
 env={'PATH':os.environ['PATH'],'LANG':'C.UTF-8','HOME':os.environ.get('HOME','/root')}
 with tempfile.TemporaryDirectory(prefix='hf-launchers-',dir='/tmp') as directory:
  base=Path(directory);base.chmod(0o755)
  launchers(base,env)
  offline(base,env)
 print(json.dumps({'type':'cleanup','complete':True,'resources':[]}),flush=True)
 return 1 if FAIL else 0
if __name__=='__main__':sys.exit(main())
