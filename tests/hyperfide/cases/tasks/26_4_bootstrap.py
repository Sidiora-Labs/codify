#!/usr/bin/env python3
"""Actual accepted-intent import and first-operator issuance on isolated PostgreSQL."""
from pathlib import Path
import datetime,hashlib,json,os,subprocess,sys,tempfile,uuid,concurrent.futures
ROOT=Path(__file__).resolve().parents[4]
sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
from identity_fixture import IdentityFixture,uid,sha
FAIL=[]
def expect(value,message="Actual bootstrap contract differs"):
 if not value:raise AssertionError(message)
def check(name,fn):
 try:fn();actual='observed'
 except Exception as error:FAIL.append(name);actual=type(error).__name__+': '+str(error)
 print(json.dumps({'type':'assertion','id':'bootstrap.'+name,'expected':'observed','actual':actual}),flush=True)
def main():
 f=IdentityFixture()
 try:
  with tempfile.TemporaryDirectory(prefix='hf-bootstrap26-') as directory:
   root=Path(directory);source=root/'intent.kvx'
   source.write_text('[meta]\nslug="offline-bootstrap-fixture"\n[req.1]\nac_1="Real bootstrap"\n[acceptance.1]\nreq="1.1"\n[task.1]\nwave=1\nreqs=["1.1"]\nacceptance_ids=["1"]\nstatus="done"\n')
   ids={name:uid() for name in ('org','project','repo','run','credential','actor')}
   oid=subprocess.check_output(['git','rev-parse','HEAD'],cwd=ROOT,text=True).strip()
   actions=['identity.describe']
   scope={'organisation_id':ids['org'],'project_id':ids['project'],'run_id':ids['run'],'authority_epoch':f.ids['epoch'],'allowed_actions':actions}
   metadata={'organisation':{'id':ids['org'],'name':'bootstrap26'},'project':{'id':ids['project'],'name':'bootstrap26'},'repositories':[{'id':ids['repo'],'name':'bootstrap26','url':'https://example.invalid/bootstrap26.git','object_format':'sha1','checkout_root':str(ROOT),'source_objects':[{'object_id':oid,'object_type':'commit'}]}]}
   accepted={'run_id':ids['run'],'source':{'relative_path':source.name,'sha256':hashlib.sha256(source.read_bytes()).hexdigest(),'size_bytes':str(source.stat().st_size)},'repositories':[{'repository_id':ids['repo'],'source_object_id':oid,'integration_ref':'refs/heads/bootstrap26'}],'allowed_actions':actions,'closure_policy':{'required_evidence':['fixture.compile'],'required_review_roles':['VERIFIER'],'publication':'AFTER_QUALIFICATION'},'provenance':None}
   expiry=(datetime.datetime.now(datetime.timezone.utc)+datetime.timedelta(minutes=30)).isoformat(timespec='milliseconds').replace('+00:00','Z')
   body={'schema_version':1,'scope':scope,'metadata':metadata,'accepted_intent':accepted,'credential':{'credential_id':ids['credential'],'actor_id':ids['actor'],'public_key_b64':f.keys['operator']['public_key_b64'],'allowed_actions':actions,'expires_at':expiry}}
   input_file=root/'bootstrap.json';input_file.write_text(json.dumps(body));input_file.chmod(0o600)
   env=dict(f.env,HYPERFIDE_MODE='distributed',HYPERFIDE_BOOTSTRAP_SOURCE_ROOT=str(root),HYPERFIDE_BOOTSTRAP_MAX_TTL_MS='3600000')
   def invoke(extra=None):
    e=dict(env);e.update(extra or {})
    p=subprocess.run(['node',str(ROOT/'services/hyperfide/dist/bootstrap.js'),'--input',str(input_file)],cwd=ROOT,env=e,text=True,capture_output=True,timeout=45)
    lines=(p.stdout if p.returncode==0 else p.stderr).splitlines()
    result=json.loads(lines[-1]) if lines else {}
    return p,result
   body['credential']['allowed_actions']=actions+['finding.github.due'];input_file.write_text(json.dumps(body))
   denied,rejection=invoke()
   check('initial-grant-cannot-exceed-accepted-capabilities',lambda:expect(denied.returncode==78 and rejection.get('error',{}).get('code')=='AUTH_SCOPE_DENIED'))
   check('denied-grant-creates-no-principal-or-issuance',lambda:expect(f.sql('SELECT count(*)::text AS n FROM hyperfide.identity_principals WHERE organisation_id=$1 AND run_id=$2',[ids['org'],ids['run']])==[{'n':'0'}] and f.sql('SELECT count(*)::text AS n FROM hyperfide.identity_bootstrap_issuances WHERE organisation_id=$1 AND run_id=$2',[ids['org'],ids['run']])==[{'n':'0'}]))
   body['credential']['allowed_actions']=actions;input_file.write_text(json.dumps(body))
   with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:attempts=list(pool.map(lambda _:invoke(),range(2)))
   check('concurrent-first-issuance-exactly-once',lambda:expect(all(p.returncode==0 for p,_ in attempts) and sorted(r['result']['credential']['replayed'] for _,r in attempts)==[False,True]))
   p,result=attempts[0]
   expect(p.returncode==0,'Actual accepted-intent bootstrap failed: '+p.stderr[:1000])
   answer=result['result']
   check('real-import-accepted-pending-validation',lambda:expect(answer['accepted_intent']['state']=='PENDING_VALIDATION' and answer['accepted_intent']['validation_status']=='PENDING'))
   check('actual-first-operator-bound-to-accepted-revision',lambda:expect(answer['credential']['role']=='OPERATOR' and answer['credential']['accepted_revision_digest']==answer['accepted_intent']['revision_digest'] and answer['credential']['credential_id']==ids['credential']))
   check('no-private-key-or-service-activation-claim',lambda:expect(answer['private_key_created'] is False and answer['services_activated'] is False))
   check('history-done-does-not-create-runtime-completion',lambda:expect(f.sql('SELECT state FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2',[ids['org'],ids['run']])==[{'state':'PENDING'}]))
   p,replay=invoke()
   check('exact-durable-bootstrap-replay',lambda:expect(p.returncode==0 and replay['result']['credential']['replayed'] is True))
   check('one-durable-initial-issuance',lambda:expect(f.sql('SELECT count(*)::text AS n FROM hyperfide.identity_bootstrap_issuances WHERE organisation_id=$1 AND run_id=$2',[ids['org'],ids['run']])==[{'n':'1'}]))
   body['credential']['credential_id']=uid();input_file.write_text(json.dumps(body))
   p,rejected=invoke()
   check('different-first-operator-refused',lambda:expect(p.returncode==78 and rejected.get('error',{}).get('code')=='IDENTITY_BOOTSTRAP_CONFLICT'))
   body['credential']['credential_id']=ids['credential'];input_file.write_text(json.dumps(body))
   p,rejected=invoke({'HYPERFIDE_MODE':'offline'})
   check('offline-observation-cannot-issue',lambda:expect(p.returncode==78 and rejected.get('error',{}).get('code')=='PRIMARY_REQUIRED'))
   input_file.chmod(0o644);p,rejected=invoke();input_file.chmod(0o600)
   check('public-input-file-refused',lambda:expect(p.returncode==78 and rejected.get('error',{}).get('code')=='BOOTSTRAP_INPUT_INVALID'))
   missing=root/'missing-journal';missing.mkdir(mode=0o700)
   p,rejected=invoke({'HYPERFIDE_AUTHORITY_JOURNAL_DIR':str(missing)})
   check('database-alone-cannot-issue-after-journal-loss',lambda:expect(p.returncode==78 and rejected.get('ok') is False))
   f.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",[ids['credential']])
   p,rejected=invoke()
   check('revoked-initial-operator-never-reactivated',lambda:expect(p.returncode==78 and rejected.get('error',{}).get('code')=='IDENTITY_BOOTSTRAP_CONFLICT'))
   check('actual-revoked-row-preserved',lambda:expect(f.sql('SELECT state,credential_version::text AS version FROM hyperfide.identity_principals WHERE credential_id=$1',[ids['credential']])==[{'state':'REVOKED','version':'2'}]))
 finally:
  database=f.database;f.close()
  print(json.dumps({'type':'cleanup','complete':not f.database_created,'resources':[]}),flush=True)
 return 1 if FAIL else 0
if __name__=='__main__':raise SystemExit(main())
