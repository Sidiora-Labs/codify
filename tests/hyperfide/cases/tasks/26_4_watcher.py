#!/usr/bin/env python3
"""Registered 26.4-watcher component and the actual signed issue-watcher client against a TLS control fixture."""
from pathlib import Path
import base64,json,os,socket,ssl,subprocess,sys,tempfile,threading,uuid
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
ROOT=Path(__file__).resolve().parents[4]
DIST=ROOT/'services/hyperfide/dist'
FAIL=[]
ACTIONS=['issue.watcher.describe','issue.watcher.plan','supervisory.host.validate']
WATCHER_ACTIONS=['identity.describe','finding.github.reconcile','finding.github.due','finding.github.dispatch','finding.github.process-delivery']
def uid():return str(uuid.uuid4())
def expect(value,message='Actual watcher contract differs'):
 if not value:raise AssertionError(message)
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:FAIL.append(name);actual=type(error).__name__+': '+str(error)[:400]
 print(json.dumps({'type':'assertion','id':'watcher.'+name,'expected':'observed','actual':actual}),flush=True)
VERIFY_JS="""import {verifyProof} from %s;const rows=JSON.parse(await new Promise(r=>{let d='';process.stdin.on('data',c=>d+=c);process.stdin.on('end',()=>r(d));}));
let ok=0;for(const x of rows){verifyProof(process.argv[1],{id:x.id,time:x.time,nonce:x.nonce,signature:Buffer.from(x.signature,'base64url')},x.origin,'/v1/invoke',Buffer.from(x.body,'base64'));ok++;}process.stdout.write(String(ok));"""
class Control:
 """Records exact signed requests; answers from a per-scenario table."""
 def __init__(self,base):
  self.cert=base/'ca.pem';self.key=base/'tls.pem'
  subprocess.run(['openssl','req','-x509','-newkey','ec','-pkeyopt','ec_paramgen_curve:P-256','-sha256','-nodes','-keyout',str(self.key),'-out',str(self.cert),'-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost','-days','1'],check=True,capture_output=True)
  self.requests=[];self.answer=lambda component,action,value:{'ok':True,'result':{}}
  control=self
  class Handler(BaseHTTPRequestHandler):
   def log_message(self,*args):pass
   def do_POST(self):
    body=self.rfile.read(int(self.headers['Content-Length']));envelope=json.loads(body);payload=json.loads(base64.urlsafe_b64decode(envelope['payload_b64']+'=='))
    control.requests.append({'path':self.path,'headers':{k.lower():v for k,v in self.headers.items()},'body':body,'payload':payload})
    reply=control.answer(payload['component'],payload['action'],payload['input'])
    data=json.dumps({'protocol_version':1,'operation_id':envelope['operation_id'],'id':envelope['operation_id'],**reply}).encode()
    self.send_response(200);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(data)));self.end_headers();self.wfile.write(data)
  self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
  context=ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER);context.minimum_version=ssl.TLSVersion.TLSv1_3;context.load_cert_chain(self.cert,self.key)
  self.server.socket=context.wrap_socket(self.server.socket,server_side=True)
  self.origin='https://localhost:'+str(self.server.server_address[1])
  self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
 def actions(self):return [r['payload']['action'] for r in self.requests]
 def close(self):self.server.shutdown();self.server.server_close();self.thread.join(5)
def main():
 with tempfile.TemporaryDirectory(prefix='hf-watcher-') as directory:
  base=Path(directory);os.chmod(base,0o700)
  components=base/'components';components.mkdir()
  (components/'26.4-watcher.json').write_bytes((ROOT/'services/hyperfide/components/26.4-watcher.json').read_bytes())
  policy=base/'policy.json';policy.write_text(json.dumps({'schema_version':1,'programme_id':'watcher-fixture','repository':'fixture/repo','spec_revision':'fixture-r1','policy_revision':1,'status':'ACTIVE','approval':{'decision':'APPROVED','record_id':'fixture','spec_revision':'fixture-r1','policy_revision':1},'allowed_roles':['control'],'allowed_actions':['programme.activate']+ACTIONS+WATCHER_ACTIONS}))
  env=dict(os.environ,HOME=str(base));[env.pop(k,None) for k in ('HYPERFIDE_MODE','CG_MODE','CODIFY_MODE')]
  def call(action,value):
   p=subprocess.run(['node',str(DIST/'control.js'),'--policy',str(policy),'--spec-revision','fixture-r1','--components',str(components),'--module-root',str(DIST)],input=json.dumps({'id':'probe','component':'26.4-watcher','action':action,'input':value})+'\n',text=True,capture_output=True,env=env,cwd=ROOT,timeout=60)
   lines=p.stdout.splitlines();expect(len(lines)==1,'one protocol response expected: '+p.stderr[-300:]);return p.returncode,json.loads(lines[0])
  def ok(action,value):
   code,r=call(action,value);expect(code==0 and r['ok'],json.dumps(r)[:300]);return r['result']
  def refused(action,value,code):
   rc,r=call(action,value);expect(rc!=0 and not r['ok'] and r['error']['code']==code,json.dumps(r)[:300])
  org,run,cred=uid(),uid(),uid();repos=[{'repository_id':uid(),'owner':'fixture','repository':'beta'},{'repository_id':uid(),'owner':'fixture','repository':'alpha'}]
  key=base/'watcher.pem';subprocess.run(['openssl','genpkey','-algorithm','Ed25519','-out',str(key)],check=True,capture_output=True);key.chmod(0o600)
  public=base64.urlsafe_b64encode(subprocess.check_output(['openssl','pkey','-in',str(key),'-pubout','-outform','DER'],stderr=subprocess.DEVNULL)[-32:]).decode().rstrip('=')
  control=Control(base)
  def config(**changes):
   value={'schema_version':1,'organisation_id':org,'run_id':run,'credential_id':cred,'key_file':str(key),'ca_file':str(control.cert),'control_origin':control.origin,'repositories':repos,'interval_seconds':600,'cadence_amendment':None,'due_limit':10,'request_timeout_ms':5000};value.update(changes);return value
  described=ok('issue.watcher.describe',{})
  check('component-registered-describe',lambda:expect(described['baseline_interval_seconds']==600 and described['required_actions']==WATCHER_ACTIONS and described['actions_approved'] is True and described['local_fallback'] is False and described['launcher']=='hyperfide issue-watcher --config FILE'))
  planned=ok('issue.watcher.plan',config())
  check('plan-baseline-cadence',lambda:expect(planned['cadence']=='BASELINE' and planned['interval_seconds']==600 and [r['repository_id'] for r in planned['repositories']]==sorted(r['repository_id'] for r in repos) and planned['local_state'] is False))
  check('rejects-cadence-change-without-amendment',lambda:refused('issue.watcher.plan',config(interval_seconds=300),'WATCHER_CADENCE_AMENDMENT_REQUIRED'))
  amended=ok('issue.watcher.plan',config(interval_seconds=300,cadence_amendment={'record_id':uid(),'interval_seconds':300}))
  check('amended-cadence-is-explicit',lambda:expect(amended['cadence']=='AMENDED' and amended['interval_seconds']==300))
  check('rejects-duplicate-repository',lambda:refused('issue.watcher.plan',config(repositories=[repos[0],dict(repos[0],repository_id=uid())]),'WATCHER_CONFIG_INVALID'))
  check('rejects-unknown-config-field',lambda:refused('issue.watcher.plan',dict(config(),database_url='postgres://x'),'INVALID_REQUEST'))
  host={'schema_version':1,'socket_path':'/run/hyperfide/host.sock','state_root':'/var/lib/hyperfide/host','plan_root':'/var/lib/hyperfide/plans','allowed_uids':[62001,62000],'max_children':4,'policy_file':'/etc/hyperfide/main-policy.json','policy_sha256':'0'*64,'termination_grace_seconds':1,'max_output_bytes':65536,'control_uid':63000,'control_gid':63000}
  validated=ok('supervisory.host.validate',host)
  check('supervisory-host-validate-supervisory-only',lambda:expect(validated['role']=='SUPERVISORY' and validated['placement_authority'] is False and validated['admission_authority'] is False and validated['model_credentials'] is False and validated['engineering_execution']=='REMOTE_ONLY'))
  check('supervisory-host-rejects-shared-control-uid',lambda:refused('supervisory.host.validate',dict(host,control_uid=62000),'SUPERVISORY_CONFIG_INVALID'))
  check('unregistered-action-refused',lambda:expect(not call('issue.watcher.run',{})[1]['ok']))
  def write_config(value,mode=0o600):
   path=base/('watcher-'+uid()+'.json');path.write_text(json.dumps(value));path.chmod(mode);return path
  def watch(path,extra=None):
   e=dict(env);e.update(extra or {})
   p=subprocess.run(['node',str(DIST/'issue-watcher.js'),'--config',str(path),'--once'],text=True,capture_output=True,env=e,cwd=ROOT,timeout=60)
   events=[json.loads(x) for x in p.stdout.splitlines() if x.startswith('{')];error=json.loads(p.stderr.splitlines()[-1]) if p.stderr.strip() else {}
   return p.returncode,events,error
  healthy=write_config(config())
  rc,_,error=watch(healthy,{'HYPERFIDE_MODE':'local'})
  check('local-mode-fails-clearly',lambda:expect(rc==78 and error['error']['code']=='DISTRIBUTED_AUTHORITY_REQUIRED' and error['local_fallback'] is False and not control.requests))
  rc,_,error=watch(write_config(config(),0o644))
  check('public-config-refused',lambda:expect(rc==78 and error['error']['code']=='WATCHER_CONFIG_INVALID' and not control.requests))
  operation,delivery=uid(),'delivery-'+uid()
  principal={'role':'COORDINATOR','credential_id':cred,'organisation_id':org,'run_id':run,'allowed_actions':WATCHER_ACTIONS}
  def healthy_answer(component,action,value):
   if action=='identity.describe':return {'ok':True,'result':{'protocol_version':1,'principal':principal}}
   if action=='finding.github.reconcile':return {'ok':True,'result':{'reconciled':True,'issues_observed':1,'next_interval_seconds':600} if value['repository']=='beta' else {'reconciled':False,'reason':'NOT_DUE','next_poll_at':'2026-10-17T10:00:00.000Z'}}
   if action=='finding.github.due':return {'ok':True,'result':{'operations':[{'operation_id':operation}],'reconciliation':[],'deliveries':[{'delivery_id':delivery,'repository_id':repos[1]['repository_id'],'owner_name':'fixture','repository_name':'alpha'}],'interval_seconds':600}}
   return {'ok':True,'result':{'processed':True}}
  control.answer=healthy_answer
  rc,events,error=watch(healthy)
  report=events[-1] if events else {}
  check('signed-pass-confirmed',lambda:expect(rc==0 and report.get('confirmed') is True and report['reconciled']==[repos[0]['repository_id']] and report['deferred']==[repos[1]['repository_id']] and events[0]['interval_seconds']==600,str(error)+str(events)[:400]))
  check('pass-calls-exact-actions',lambda:expect(control.actions()==['identity.describe','finding.github.reconcile','finding.github.reconcile','finding.github.due','finding.github.dispatch','finding.github.process-delivery'] and control.requests[4]['payload']['input']=={'operation_id':operation} and control.requests[5]['payload']['input']=={'delivery_id':delivery,'repository_id':repos[1]['repository_id'],'owner':'fixture','repository':'alpha'} and all(r['payload']['run_id']==run and r['path']=='/v1/invoke' for r in control.requests)))
  rows=[{'id':r['headers']['hf-credential-id'],'time':r['headers']['hf-request-time'],'nonce':r['headers']['hf-request-nonce'],'signature':r['headers']['hf-request-signature'],'origin':control.origin,'body':base64.b64encode(r['body']).decode()} for r in control.requests]
  verified=subprocess.run(['node','--input-type=module','-e',VERIFY_JS%json.dumps(str(DIST/'transport/protocol.js')),public],input=json.dumps(rows),text=True,capture_output=True,cwd=ROOT,timeout=30)
  check('every-request-signed-by-watcher-key',lambda:expect(verified.returncode==0 and verified.stdout==str(len(rows)) and len(rows)==6 and all(r['headers']['hf-credential-id']==cred for r in control.requests),verified.stderr[-300:]))
  control.requests.clear()
  control.answer=lambda component,action,value:healthy_answer(component,action,value) if action!='finding.github.reconcile' else {'ok':False,'error':{'code':'AUTH_DENIED','message':'denied'}}
  rc,events,_=watch(healthy)
  report=events[-1] if events else {}
  check('remote-refusal-never-reconciled',lambda:expect(rc==75 and report['confirmed'] is False and report['reconciled']==[] and [c['code'] for c in report['calls'] if c['action']=='finding.github.reconcile']==['AUTH_DENIED','AUTH_DENIED']))
  control.requests.clear()
  control.answer=lambda component,action,value:{'ok':True,'result':{'operations':[],'deliveries':[{'delivery_id':delivery,'repository_id':uid()}]}} if action=='finding.github.due' else healthy_answer(component,action,value)
  rc,events,_=watch(healthy)
  check('unwatched-repository-delivery-refused',lambda:expect(rc==75 and 'finding.github.process-delivery' not in control.actions() and any(c['code']=='UNWATCHED_REPOSITORY' for c in events[-1]['calls'])))
  control.requests.clear()
  control.answer=lambda component,action,value:{'ok':True,'result':{'protocol_version':1,'principal':dict(principal,role='OPERATOR')}} if action=='identity.describe' else healthy_answer(component,action,value)
  rc,events,_=watch(healthy)
  check('non-coordinator-principal-refused',lambda:expect(rc==75 and control.actions()==['identity.describe'] and events[-1]['calls'][-1]['code']=='WATCHER_IDENTITY_REQUIRED'))
  with socket.socket() as s:s.bind(('127.0.0.1',0));closed=s.getsockname()[1]
  before=sorted(p.name for p in base.iterdir())
  rc,events,_=watch(write_config(config(control_origin='https://localhost:'+str(closed))))
  check('control-unavailable-unconfirmed-no-local-state',lambda:expect(rc==75 and events[-1]['confirmed'] is False and events[-1]['calls'][0]['outcome']=='UNCONFIRMED' and events[-1]['calls'][0]['code']=='CONTROL_UNAVAILABLE' and len(sorted(p.name for p in base.iterdir()))==len(before)+1))
  control.close()
 print(json.dumps({'type':'cleanup','complete':True,'resources':[]}),flush=True)
 return 1 if FAIL else 0
if __name__=='__main__':sys.exit(main())
