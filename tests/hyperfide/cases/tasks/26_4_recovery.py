#!/usr/bin/env python3
"""Actual bootstrap-operator recovery (0041) through `bootstrap --recover` on isolated PostgreSQL."""
from pathlib import Path
import datetime,hashlib,json,subprocess,sys,tempfile
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,uid
FAIL=[]
def expect(value,message='Actual bootstrap recovery contract differs'):
 if not value:raise AssertionError(message)
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:FAIL.append(name);actual=type(error).__name__+': '+str(error)[:400]
 print(json.dumps({'type':'assertion','id':'recovery.'+name,'expected':'observed','actual':actual}),flush=True)
def main():
 f=IdentityFixture()
 try:
  with tempfile.TemporaryDirectory(prefix='hf-recovery26-') as directory:
   root=Path(directory);source=root/'intent.kvx'
   source.write_text('[meta]\nslug="recovery-fixture"\n[req.1]\nac_1="Real recovery"\n[acceptance.1]\nreq="1.1"\n[task.1]\nwave=1\nreqs=["1.1"]\nacceptance_ids=["1"]\nstatus="pending"\n')
   ids={name:uid() for name in ('org','project','repo','run','credential','actor')}
   oid=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
   actions=['identity.describe']
   expiry=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=30)).isoformat(timespec='milliseconds').replace('+00:00','Z')
   body={'schema_version':1,'scope':{'organisation_id':ids['org'],'project_id':ids['project'],'run_id':ids['run'],'authority_epoch':f.ids['epoch'],'allowed_actions':actions},
    'metadata':{'organisation':{'id':ids['org'],'name':'recovery26'},'project':{'id':ids['project'],'name':'recovery26'},'repositories':[{'id':ids['repo'],'name':'recovery26','url':'https://example.invalid/recovery26.git','object_format':'sha1','checkout_root':str(ROOT),'source_objects':[{'object_id':oid,'object_type':'commit'}]}]},
    'accepted_intent':{'run_id':ids['run'],'source':{'relative_path':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'size_bytes':str(source.stat().st_size)},'repositories':[{'repository_id':ids['repo'],'source_object_id':oid,'integration_ref':'refs/heads/recovery26'}],'allowed_actions':actions,'closure_policy':{'required_evidence':['fixture.compile'],'required_review_roles':['VERIFIER'],'publication':'AFTER_QUALIFICATION'},'provenance':None},
    'credential':{'credential_id':ids['credential'],'actor_id':ids['actor'],'public_key_b64':f.keys['operator']['public_key_b64'],'allowed_actions':actions,'expires_at':expiry}}
   env=dict(f.env,HYPERFIDE_MODE='distributed',HYPERFIDE_BOOTSTRAP_SOURCE_ROOT=str(root),HYPERFIDE_BOOTSTRAP_MAX_TTL_MS='3600000')
   def invoke(value,recover=True,extra=None):
    path=root/('input-'+uid()+'.json');path.write_text(json.dumps(value));path.chmod(0o600)
    e=dict(env);e.update(extra or {})
    p=subprocess.run(['node',str(ROOT/'services/hyperfide/dist/bootstrap.js'),*(['--recover'] if recover else []),'--input',str(path)],cwd=ROOT,env=e,text=True,capture_output=True,timeout=45)
    lines=(p.stdout if p.returncode==0 else p.stderr).splitlines()
    return p.returncode,(json.loads(lines[-1]) if lines else {})
   code,initial=invoke(body,recover=False)
   expect(code==0,'Actual initial bootstrap failed: '+json.dumps(initial))
   def recovery(**changes):
    value={'recovery_id':uid(),'previous_credential_id':ids['credential'],'reason':'LOST','credential_id':uid(),'actor_id':ids['actor'],'public_key_b64':f.keys['other']['public_key_b64'],'allowed_actions':actions,'expires_at':expiry};value.update(changes)
    return {'schema_version':1,'scope':{'organisation_id':ids['org'],'run_id':ids['run'],'authority_epoch':f.ids['epoch']},'recovery':value}
   count=lambda:f.sql('SELECT count(*)::text AS n FROM hyperfide.identity_bootstrap_recoveries WHERE organisation_id=$1 AND run_id=$2',[ids['org'],ids['run']])[0]['n']
   migration=f.sql('SELECT name,checksum FROM hyperfide.schema_migrations WHERE version=41')
   check('exact-migration-applied',lambda:expect(migration==[{'name':'0041-bootstrap-recovery','checksum':'sha256:'+hashlib.sha256((ROOT/'services/hyperfide/migrations/0041-bootstrap-recovery.sql').read_bytes()).hexdigest()}]))
   code,denied=invoke(recovery(allowed_actions=actions+['finding.github.due']))
   check('widened-grant-refused-without-writes',lambda:expect(code==78 and denied['error']['code']=='AUTH_SCOPE_DENIED' and count()=='0'))
   code,offline=invoke(recovery(),extra={'HYPERFIDE_MODE':'offline'})
   check('offline-mode-cannot-recover',lambda:expect(code==78 and offline['error']['code']=='PRIMARY_REQUIRED' and count()=='0'))
   code,adopted=invoke(recovery(credential_id=f.ids['operator']))
   check('existing-credential-adoption-refused',lambda:expect(code==78 and adopted['error']['code']=='BOOTSTRAP_RECOVERY_CONFLICT' and count()=='0'))
   first=recovery();code,result=invoke(first);answer=result.get('result',{}).get('recovery',{})
   check('lost-operator-replaced',lambda:expect(code==0 and answer['generation']=='1' and answer['previous_state']=='ACTIVE' and answer['role']=='OPERATOR' and answer['accepted_revision_digest']==initial['result']['accepted_intent']['revision_digest'] and answer['replayed'] is False and result['result']['private_key_created'] is False,json.dumps(result)[:400]))
   states=lambda credential:f.sql('SELECT state,credential_version::text AS version FROM hyperfide.identity_principals WHERE credential_id=$1',[credential])
   check('replaced-operator-revoked-in-same-transaction',lambda:expect(states(ids['credential'])==[{'state':'REVOKED','version':'2'}] and states(first['recovery']['credential_id'])==[{'state':'ACTIVE','version':'1'}]))
   code,replay=invoke(first)
   check('exact-replay-idempotent',lambda:expect(code==0 and replay['result']['recovery']['replayed'] is True and replay['result']['recovery']['credential_id']==first['recovery']['credential_id'] and count()=='1'))
   code,reused=invoke(dict(first,recovery=dict(first['recovery'],reason='COMPROMISED')))
   check('recovery-identity-reuse-refused',lambda:expect(code==78 and reused['error']['code']=='BOOTSTRAP_RECOVERY_CONFLICT' and count()=='1'))
   code,stale=invoke(recovery())
   check('stale-operator-cannot-be-replaced-again',lambda:expect(code==78 and stale['error']['code']=='BOOTSTRAP_RECOVERY_CONFLICT' and count()=='1'))
   second=recovery(previous_credential_id=first['recovery']['credential_id'],reason='COMPROMISED',public_key_b64=f.keys['runner']['public_key_b64']);code,chained=invoke(second)
   check('chain-advances-from-current-head',lambda:expect(code==0 and chained['result']['recovery']['generation']=='2' and count()=='2' and states(first['recovery']['credential_id'])==[{'state':'REVOKED','version':'2'}]))
   code,reissued=invoke(body,recover=False)
   check('initial-bootstrap-replay-cannot-reactivate',lambda:expect(code==78 and reissued['error']['code']=='IDENTITY_BOOTSTRAP_CONFLICT' and states(ids['credential'])==[{'state':'REVOKED','version':'2'}]))
   code,unbootstrapped=invoke({'schema_version':1,'scope':{'organisation_id':f.ids['organisation'],'run_id':f.ids['run'],'authority_epoch':f.ids['epoch']},'recovery':recovery(previous_credential_id=f.ids['operator'])['recovery']})
   check('run-without-initial-issuance-refused',lambda:expect(code==78 and unbootstrapped['error']['code']=='BOOTSTRAP_RECOVERY_UNAVAILABLE'))
   def mutate():
    try:f.sql("UPDATE hyperfide.identity_bootstrap_recoveries SET reason='EXPIRED' WHERE recovery_id=$1",[first['recovery']['recovery_id']])
    except Exception as error:return str(error)
    return ''
   check('recovery-history-append-only',lambda:expect('append-only' in mutate() and f.sql('SELECT reason FROM hyperfide.identity_bootstrap_recoveries WHERE recovery_id=$1',[first['recovery']['recovery_id']])==[{'reason':'LOST'}]))
 finally:
  f.close()
  print(json.dumps({'type':'cleanup','complete':not f.database_created,'resources':[]}),flush=True)
 return 1 if FAIL else 0
if __name__=='__main__':raise SystemExit(main())
