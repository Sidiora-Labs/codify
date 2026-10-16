#!/usr/bin/env python3
"""Actual SQLite WAL/PostgreSQL history importer over signed TLS authority. Synthetic data only."""
import os,json,sqlite3,tempfile,subprocess,sys,hashlib,uuid,shutil
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
DB="hf_domain25_history"
FIXTURE=None
IDS=[]; FAILED=[]
def expect(v,m):
 if not v:raise AssertionError(m)
def check(name,fn):
 IDS.append(name)
 try:fn();actual="observed"
 except Exception as e:FAILED.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def env():
 e=os.environ.copy();p=urlsplit(e["DATABASE_URL"]);e["DATABASE_URL"]=urlunsplit((p.scheme,p.netloc,"/"+DB,p.query,p.fragment));e["PGDATABASE"]=DB;return e
def sql(s,database=DB):
 expect(FIXTURE is not None,"fixture unavailable")
 result=FIXTURE.sql(s)
 return "\n".join(str(next(iter(row.values()))) for row in result)
def artifacts():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-tests"))/"migration";p.mkdir(parents=True,exist_ok=True);return p
def cleanup():
 filename=artifacts()/"cleanup.json"
 value=json.loads(filename.read_text()) if filename.exists() else {"observed_absent":False}
 absent=value.get("observed_absent") is True
 print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-task25.1-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"migration/cleanup.json"}]}));return 0 if absent else 1
def history_commit_proxy(directory):
 import importlib.util
 spec=importlib.util.spec_from_file_location("shared_transaction_fixture",ROOT/"tests/hyperfide/cases/tasks/4_2.py")
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 class HistoryCommitProxy(module.CommitAckProxy):
  # The shared fixture drops a real backend COMMIT acknowledgement. This bounded
  # specialization arms only for a transaction that wrote a history batch.
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
       if length<8 or length>16777216:raise OSError('startup bound')
       if len(buffer)<length:break
       packet,buffer=buffer[:length],buffer[length:];target.sendall(packet);startup=False;continue
      if len(buffer)<5:break
      length=int.from_bytes(buffer[1:5],'big')+1
      if length<5 or length>16777216:raise OSError('packet bound')
      if len(buffer)<length:break
      packet,buffer=buffer[:length],buffer[length:]
      if frontend and packet[:1] in (b'Q',b'P'):
       sql=packet[5:]
       if packet[:1]==b'Q' and sql.rstrip(b'\0').strip().upper().startswith(b'BEGIN'):state.update(commit=False,target=False)
       if b'INSERT INTO hyperfide_history.batches' in sql:state['target']=True
       if b'INSERT INTO hyperfide_history.rows' in sql:
        with self.lock:self.row_write_messages+=1
       if packet[:1]==b'Q' and sql.rstrip(b'\0').strip().upper()==b'COMMIT':state['commit']=True
      if not frontend and state.get('commit') and state.get('target') and packet[:1]==b'C' and packet[5:]==b'COMMIT\0':
       with self.lock:
        if self.drop:self.drop=False;self.dropped=True;return
      target.sendall(packet)
      if not frontend and packet[:1]==b'Z' and packet[5:]==b'I':state.update(commit=False,target=False)
   except OSError:pass
   finally:
    for connection in [source,target]:
     try:connection.shutdown(self.socket.SHUT_RDWR)
     except OSError:pass
     connection.close()
 proxy=HistoryCommitProxy(str(directory));proxy.drop=False;proxy.row_write_messages=0
 return proxy

def main():
 global FIXTURE
 sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
 from identity_fixture import IdentityFixture,sha,uid
 with tempfile.TemporaryDirectory(prefix="hf-history-") as temp:
  base=Path(temp);source=base/"source";source.mkdir();archive=base/"archive";archive.mkdir(mode=0o700)
  c=sqlite3.connect(source/"graph.db")
  c.executescript("""PRAGMA journal_mode=WAL; PRAGMA wal_autocheckpoint=0;
CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);
INSERT INTO meta VALUES('schema_version','18');
CREATE TABLE memories(id INTEGER PRIMARY KEY,body TEXT,raw BLOB,n INTEGER,declared TEXT);
CREATE TABLE memory_superseded(id INTEGER PRIMARY KEY,by_id INTEGER,at INTEGER);
CREATE TABLE attempts(attempt_id TEXT PRIMARY KEY,task TEXT,fence INTEGER,state TEXT);
CREATE TABLE branches(id INTEGER PRIMARY KEY,name TEXT);
CREATE TABLE files(id INTEGER PRIMARY KEY,branch_id INTEGER,path TEXT);
CREATE TABLE events(seq INTEGER PRIMARY KEY,kind TEXT);
CREATE TABLE custom_shape(a TEXT,b TEXT,PRIMARY KEY(a,b)) WITHOUT ROWID;
CREATE TABLE typed_history(id INTEGER PRIMARY KEY,body BLOB);
CREATE TABLE typed_keys(k PRIMARY KEY,body TEXT);
INSERT INTO typed_keys VALUES(1,'integer'),('1','text'),(x'31','blob'),(NULL,'null-a'),(NULL,'null-b');
CREATE TABLE shadowed_rowid(ROWID TEXT,body TEXT);
INSERT INTO shadowed_rowid VALUES('same','one'),('same','two');
CREATE TABLE declared_parent(id INTEGER PRIMARY KEY);
CREATE TABLE declared_child(id INTEGER PRIMARY KEY,parent_id INTEGER REFERENCES declared_parent(id));
INSERT INTO declared_child VALUES(1,999);
INSERT INTO typed_history VALUES(1,x'0063616e617279ff');
CREATE VIRTUAL TABLE symbol_fts USING fts5(name,tokenize='trigram');
CREATE TRIGGER local_only AFTER INSERT ON memories BEGIN INSERT INTO events(kind) VALUES('local'); END;
INSERT INTO attempts VALUES('old-attempt','feature/1',9223372036854775807,'running');
INSERT INTO branches VALUES(1,'main');
INSERT INTO files VALUES(1,1,'a.c');
INSERT INTO memory_superseded VALUES(1,2,0);
INSERT INTO custom_shape VALUES('é','é');
INSERT INTO symbol_fts VALUES('name_test');
""")
  c.execute("INSERT INTO memories VALUES(?,?,?,?,?)",(1,"nul\x00text",b"\x00\xff",9007199254740993,"forced_done"));c.commit()
  before_schema=c.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()
  c.execute("INSERT INTO memories VALUES(?,?,?,?,?)",(2,"uncommitted",b"",0,"done"))
  profiles=[{"id":"fixture","source_id":"10000000-0000-0000-0000-000000000001","repository_id":"20000000-0000-0000-0000-000000000001","organisation_id":"30000000-0000-0000-0000-000000000001","root":str(source),"database":"graph.db","external":[{"label":"missing-docs","path":"missing.json","kind":"documentation"},{"label":"session","path":"credentials","kind":"native_session","sensitive":True}]}]
  pf=base/"sources.json";pf.write_text(json.dumps(profiles))
  import importlib.util
  spec=importlib.util.spec_from_file_location("artifact_fixture",ROOT/"tests/hyperfide/cases/tasks/15_2.py")
  artifact_module=importlib.util.module_from_spec(spec);spec.loader.exec_module(artifact_module)
  backend=artifact_module.ObjectFixture()
  proxy_directory=base/"pg-proxy";proxy_directory.mkdir(mode=0o700);proxy=history_commit_proxy(proxy_directory)
  def setup(fixture):
   fixture.apply_migration('0025-sqlite-history')
   i=fixture.ids;repository=profiles[0]['repository_id'];profiles[0]['organisation_id']=i['organisation'];pf.write_text(json.dumps(profiles))
   from urllib.parse import parse_qsl,urlencode
   parsed=urlsplit(fixture.url);query=dict(parse_qsl(parsed.query));query['host']=str(proxy_directory)
   fixture.env['DATABASE_URL']=urlunsplit((parsed.scheme,parsed.netloc,parsed.path,urlencode(query),parsed.fragment))
   fixture.env.update(HF_ARTIFACT_S3_ENDPOINT=backend.endpoint,HF_ARTIFACT_ALLOW_LOOPBACK_HTTP='1',HF_ARTIFACT_S3_REGION=artifact_module.REGION,HF_ARTIFACT_S3_BUCKET=artifact_module.BUCKET,HF_ARTIFACT_S3_ACCESS_KEY_ID=artifact_module.KEY,HF_ARTIFACT_S3_SECRET_ACCESS_KEY=artifact_module.SECRET,HF_ARTIFACT_S3_SESSION_TOKEN=artifact_module.TOKEN,HF_ARTIFACT_ORGANISATION_ID=i['organisation'],HF_ARTIFACT_ALLOWED_RUN_IDS=json.dumps([i['run']]))
   fixture.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'legacy','fixture:legacy')",[i['organisation'],repository,i['project']])
   fixture.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[i['organisation'],repository,'1'*40])
   fixture.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[i['organisation'],i['run'],repository,'1'*40])
  FIXTURE=IdentityFixture(extra_components=['15.2','25.1'],extra_env={'HF_MIGRATION_SOURCES_FILE':str(pf),'HF_MIGRATION_ARCHIVE_ROOT':str(archive)},extra_setup=setup)
  # The owner14 fixture runs the real4.4 migration engine and a least-privilege
  # runtime role. History lives in its own non-authoritative schema.
  FIXTURE.sql('GRANT USAGE ON SCHEMA hyperfide_history TO "'+FIXTURE.runtime_role+'"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA hyperfide_history TO "'+FIXTURE.runtime_role+'"')
  FIXTURE.stop()
  from urllib.parse import parse_qsl,urlencode
  parsed=urlsplit(FIXTURE.runtime_url);query=dict(parse_qsl(parsed.query));query['host']=str(proxy_directory)
  proxy_url=urlunsplit((parsed.scheme,parsed.netloc,parsed.path,urlencode(query),parsed.fragment))
  FIXTURE.env['DATABASE_URL']=proxy_url
  for role in ('CONTROL','PROVISIONER','DISPATCH'):FIXTURE.env['HYPERFIDE_'+role+'_PRIMARY_DATABASE_URL']=proxy_url
  FIXTURE.start()
  import atexit
  atexit.register(FIXTURE.close)
  def request(action,value):
   status,result=FIXTURE.invoke('migration.sqlite.'+action,value,component='25.1')
   return result
  def ok(action,v):
   r=request(action,v);expect(r.get("ok") is True,"service rejected "+action+": "+r.get("error",{}).get("code","unknown"));return r["result"]
  def reject(action,v,code):
   r=request(action,v);expect(r.get("ok") is False and r.get("error",{}).get("code")==code,"expected "+code)
  check("migration.describe",lambda:expect(ok("describe",{})["authority"]=="NONE","authority granted"))
  def unauthenticated():
   import http.client,ssl
   connection=http.client.HTTPSConnection('localhost',FIXTURE.port,context=ssl.create_default_context(cafile=str(FIXTURE.ca)))
   try:
    connection.request('POST','/v1/invoke',json.dumps(FIXTURE.operation('25.1','migration.sqlite.describe',{})),{'Content-Type':'application/json'})
    response=connection.getresponse();data=json.loads(response.read())
    expect(response.status in (401,403) and data.get('ok') is False,'unsigned migration call accepted')
   finally:connection.close()
  check("migration.auth.unsigned-refused",unauthenticated)
  def wrong_scope():
   original=profiles[0]['organisation_id'];profiles[0]['organisation_id']='30000000-0000-0000-0000-000000000099';pf.write_text(json.dumps(profiles))
   try:reject('snapshot',{'source':'fixture'},'MIGRATION_SCOPE')
   finally:profiles[0]['organisation_id']=original;pf.write_text(json.dumps(profiles))
  check("migration.auth.cross-organisation-refused",wrong_scope)

  snap=ok("snapshot",{"source":"fixture"});iid=snap["import_id"];dg=snap["snapshot_digest"]
  frozen=sqlite3.connect(archive/(dg[7:]+".db"))
  check("migration.snapshot.wal",lambda:expect(frozen.execute("SELECT count(*) FROM memories").fetchone()[0]==1,"WAL commit missing or open transaction included"))
  check("migration.snapshot.integrity",lambda:expect(frozen.execute("PRAGMA integrity_check").fetchone()[0]=="ok","invalid SQLite archive"))
  check("migration.snapshot.digest",lambda:expect(hashlib.sha256((archive/(dg[7:]+".db")).read_bytes()).hexdigest()==dg[7:],"archive digest differs"))
  def unapproved_archive():
   before=len(backend.events)
   reject('archive',{'source':'fixture','import_id':iid},'SECRET_REVIEW_REQUIRED')
   expect(len(backend.events)==before,'unapproved raw snapshot reached object backend')
  check("migration.archive.secret-review-required",unapproved_archive)
  profiles[0]['archive_approved_digests']=[dg];pf.write_text(json.dumps(profiles))
  preserved={}
  def preserve():
   r=ok('archive',{'source':'fixture','import_id':iid});preserved.update(r)
   expect(r['outcome']=='SUCCEEDED' and r['archive_durability']=='ARTIFACT_RECEIPT' and r['qualification']=='UNQUALIFIED','archive receipt claimed false qualification')
   row=FIXTURE.sql('SELECT status,digest FROM hyperfide.artifacts WHERE organisation_id=$1 AND run_id=$2 AND id=$3',[FIXTURE.ids['organisation'],FIXTURE.ids['run'],r['archive']['manifest_artifact_id']])
   expect(row and row[0]['status']=='COMPLETE' and row[0]['digest']==r['archive']['manifest_digest'],'archive manifest not actually complete in primary')
  check("migration.archive.real-artifact-custody",preserve)
  def independent_bytes():
   prefix='/'+artifact_module.BUCKET+'/hyperfide/v1/'+FIXTURE.ids['organisation']+'/'+FIXTURE.ids['run']
   manifest_raw=backend.objects[prefix+'/manifests/sha256/'+preserved['archive']['manifest_digest'][7:]]
   manifest=json.loads(manifest_raw);offset=0;content=[]
   for n,chunk in enumerate(manifest['chunks']):
    raw=backend.objects[prefix+'/sha256/'+chunk['digest'][7:]]
    expect(chunk['sequence']==n and int(chunk['offset_bytes'])==offset and len(raw)==int(chunk['size_bytes']) and 'sha256:'+hashlib.sha256(raw).hexdigest()==chunk['digest'],'actual backend chunks differ')
    content.append(raw);offset+=len(raw)
   raw=b''.join(content)
   expect('sha256:'+hashlib.sha256(raw).hexdigest()==dg and raw==(archive/(dg[7:]+'.db')).read_bytes(),'independent backend bytes do not equal immutable SQLite snapshot')
   expect(not backend.bad_signatures,'archive HTTP did not carry independently verified SigV4')
  check("migration.archive.independent-backend-bytes",independent_bytes)
  def restarted_archive():
   count=sql('SELECT count(*) FROM hyperfide.artifacts;');events=len(backend.events);FIXTURE.stop();FIXTURE.start()
   r=ok('archive',{'source':'fixture','import_id':iid})
   expect(r['archive']['manifest_artifact_id']==preserved['archive']['manifest_artifact_id'] and sql('SELECT count(*) FROM hyperfide.artifacts;')==count,'restart duplicated immutable artifacts')
   expect(any(e['method']=='GET' for e in backend.events[events:]),'restart trusted cached bytes without backend read')
   independent_bytes()
  check("migration.archive.restart-real-readback",restarted_archive)

  check("migration.snapshot.source-unchanged",lambda:expect(c.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()==before_schema and c.in_transaction,"snapshot changed source schema or transaction"))
  check("migration.inventory.shape",lambda:expect("base" not in [x["name"] for t in snap["inventory"]["tables"] if t["name"]=="files" for x in t["columns"]],"inventory invented additive column"))
  check("migration.inventory.virtual",lambda:expect(any(t["name"]=="symbol_fts" and t["disposition"]=="ARCHIVE_ONLY" for t in snap["inventory"]["tables"]),"FTS semantics silently promoted"))
  check("migration.inventory.trigger",lambda:expect(any(t["name"]=="local_only" and t["type"]=="trigger" for t in snap["inventory"]["objects"]),"source trigger omitted"))
  check("migration.external.unavailable",lambda:expect(any(x["label"]=="missing-docs" and x["availability"]=="UNAVAILABLE" for x in snap["external_inventory"]),"missing evidence became available"))
  check("migration.external.session-excluded",lambda:expect(any(x["label"]=="session" and x["availability"]=="EXCLUDED_SENSITIVE" and "digest" not in x for x in snap["external_inventory"]),"sensitive session hashed/copied"))
  for table in ["memories","attempts","custom_shape","events","branches","files","memory_superseded"]:
   v={"source":"fixture","import_id":iid,"table":table,"offset":"0","limit":50}
   check("migration.import."+table,lambda v=v:expect(ok("import",v)["outcome"]=="SUCCEEDED","batch did not commit"))
  unknown={}
  def commit_loss():
   before=proxy.row_write_messages;proxy.drop=True
   value={"source":"fixture","import_id":iid,"table":"typed_history","offset":"0","limit":1}
   result=ok("import",value);unknown.update(value=value,row_writes_before=before)
   expect(result["outcome"]=="UNKNOWN" and result["automatic_replay"] is False and proxy.dropped,"lost actual PG COMMIT acknowledgement was asserted successful")
   expect(proxy.row_write_messages-before==1,"gateway automatically replayed uncertain batch callback")
   expect(sql("SELECT count(*) FROM hyperfide_history.rows WHERE table_name='typed_history';")=="1" and sql("SELECT count(*) FROM hyperfide_history.batches WHERE table_name='typed_history';")=="1","independent primary did not retain exactly one committed batch")
  check("migration.commit.actual-ack-loss-unknown",commit_loss)
  def reconcile_commit():
   result=ok("import",unknown["value"])
   expect(result["outcome"]=="SUCCEEDED" and result["replayed"] is True,"unknown batch did not reconcile durable identity")
   expect(proxy.row_write_messages-unknown["row_writes_before"]==1 and sql("SELECT count(*) FROM hyperfide_history.rows WHERE table_name='typed_history';")=="1","reconciliation duplicated side effects")
  check("migration.commit.durable-identity-reconciliation",reconcile_commit)
  check("migration.relationships.declared-fk-inventory",lambda:expect(any(t["name"]=="declared_child" and t["foreign_keys"][0]["table"]=="declared_parent" for t in snap["inventory"]["tables"]),"declared relationships omitted"))
  check("migration.relationships.dangling-fk-diagnostic",lambda:expect(snap["inventory"]["declared_foreign_key_check"]["violation_counts"].get("declared_child:0")==1 and snap["inventory"]["declared_foreign_key_check"]["semantic_relationship_coverage"]=="UNQUALIFIED","dangling relationship promoted or omitted"))
  def typed_keys():
   ok("import",{"source":"fixture","import_id":iid,"table":"typed_keys","offset":"0","limit":50})
   expect(sql("SELECT count(*)::text||','||count(DISTINCT mapped_id)::text FROM hyperfide_history.rows WHERE table_name='typed_keys';")=="5,5","typed or nullable legacy keys collapsed")
  check("migration.keys.typed-and-null-primary-identity",typed_keys)
  def rowid_shadow():
   ok("import",{"source":"fixture","import_id":iid,"table":"shadowed_rowid","offset":"0","limit":50})
   expect(sql("SELECT count(*)::text||','||count(DISTINCT mapped_id)::text FROM hyperfide_history.rows WHERE table_name='shadowed_rowid';")=="2,2","case-insensitive SQLite rowid shadowing collapsed history")
  check("migration.keys.case-insensitive-rowid-alias",rowid_shadow)
  check("migration.import.exact-integer",lambda:expect("9007199254740993" in sql("SELECT payload::text FROM hyperfide_history.rows WHERE table_name='memories';"),"large integer rounded"))
  check("migration.import.exact-blob",lambda:expect("AP8=" in sql("SELECT payload::text FROM hyperfide_history.rows WHERE table_name='memories';"),"blob changed"))
  check("migration.import.unqualified",lambda:expect(sql("SELECT count(*) FROM hyperfide_history.imports WHERE authority<>'NONE' OR qualification<>'UNQUALIFIED';")=="0","historical import qualified"))
  check("migration.import.reconciliation",lambda:expect(sql("SELECT disposition FROM hyperfide_history.rows WHERE table_name='attempts';")=="REQUIRES_RECONCILIATION","old attempt gained live ownership"))
  check("migration.import.no-authority-tables",lambda:expect(sql("SELECT count(*) FROM hyperfide.attempts;")=="0","import created live authority"))
  v={"source":"fixture","import_id":iid,"table":"memories","offset":"0","limit":50}
  check("migration.replay.restart",lambda:expect(ok("import",v)["replayed"] is True and sql("SELECT count(*) FROM hyperfide_history.rows WHERE table_name='memories';")=="1","service restart duplicated history"))
  check("migration.replay.conflict",lambda:reject("import",dict(v,limit=1),"MIGRATION_CONFLICT"))
  check("migration.scope.unknown",lambda:reject("inventory",{"source":"unknown","import_id":iid},"MIGRATION_SCOPE"))
  check("migration.path.request-root",lambda:reject("snapshot",{"source":"fixture","root":"/"},"MIGRATION_INPUT"))
  check("migration.import.virtual-refused",lambda:reject("import",dict(v,table="symbol_fts"),"MIGRATION_UNSUPPORTED"))
  check("migration.import.out-of-order",lambda:reject("import",dict(v,table="meta",offset="1"),"MIGRATION_CONFLICT"))
  c.rollback();c.execute("ALTER TABLE files ADD COLUMN base TEXT");c.execute("ALTER TABLE files ADD COLUMN mtime_ns INTEGER")
  c.execute("CREATE TABLE oversize_rows(id INTEGER PRIMARY KEY,payload BLOB)");c.execute("INSERT INTO oversize_rows VALUES(1,zeroblob(5242880))")
  c.execute("CREATE TABLE aggregate_rows(id INTEGER PRIMARY KEY,payload BLOB)")
  c.executemany("INSERT INTO aggregate_rows VALUES(?,zeroblob(524288))",[(n,) for n in range(16)]);c.commit()
  changed=ok("snapshot",{"source":"fixture"})
  check("migration.inventory.same-version-addition",lambda:expect(any(x["name"]=="mtime_ns" for t in changed["inventory"]["tables"] if t["name"]=="files" for x in t["columns"]),"same-v18 column missing"))
  check("migration.import.large-cell-preflight",lambda:reject("import",{"source":"fixture","import_id":changed["import_id"],"table":"oversize_rows","offset":"0","limit":1},"MIGRATION_CELL_SIZE_BOUND"))
  check("migration.import.aggregate-batch-budget",lambda:reject("import",{"source":"fixture","import_id":changed["import_id"],"table":"aggregate_rows","offset":"0","limit":16},"MIGRATION_BATCH_SIZE_BOUND"))
  check("migration.import.oversize-no-partial-rows",lambda:expect(sql("SELECT count(*) FROM hyperfide_history.rows WHERE table_name IN ('oversize_rows','aggregate_rows');")=="0","bounded refusal committed partial history"))
  from sqlite_schema_fixture import source_variant
  variant,additions,widen,variant_provenance=source_variant(ROOT,source/"schema-variants.db")
  profiles.append(dict(profiles[0],id="source-ddl",source_id="10000000-0000-0000-0000-000000000002",database="schema-variants.db",external=[],archive_approved_digests=[]));pf.write_text(json.dumps(profiles))
  old_source_ddl=variant.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()
  old=ok("snapshot",{"source":"source-ddl"})
  def table_columns(snapshot,table):
   return {col["name"] for t in snapshot["inventory"]["tables"] if t["name"]==table for col in t["columns"]}
  for table,columns in additions.items():
   check("migration.source-v18.before."+table,lambda table=table,columns=columns:expect(not set(columns)&table_columns(old,table),"source-derived pre-addition shape was silently upgraded"))
  check("migration.source-v18.before.journal",lambda:expect(not any(t["name"]=="journal_applied" for t in old["inventory"]["tables"]),"optional journal table invented"))
  check("migration.source-v18.source-unchanged",lambda:expect(variant.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()==old_source_ddl,"snapshot mutated source-derived schema"))
  widen()
  new=ok("snapshot",{"source":"source-ddl"})
  for table,columns in additions.items():
   check("migration.source-v18.after."+table,lambda table=table,columns=columns:expect(set(columns)<=table_columns(new,table),"source-derived v18 additive columns omitted"))
  check("migration.source-v18.after.journal",lambda:expect(any(t["name"]=="journal_applied" for t in new["inventory"]["tables"]),"actual optional journal DDL omitted"))
  check("migration.source-v18.virtual-shadow-ddl",lambda:expect(any(t["type"]=="virtual" for t in new["inventory"]["tables"]) and any(t["type"]=="shadow" for t in new["inventory"]["tables"]) and all(o.get("sql") for o in new["inventory"]["objects"] if o["type"]=="table" and not o["name"].startswith("sqlite_")),"actual C schema virtual/shadow/source DDL not preserved"))
  (artifacts()/"source-variants.json").write_text(json.dumps(variant_provenance,sort_keys=True))
  variant.close()
  c.execute("UPDATE meta SET value='19' WHERE key='schema_version'");c.commit()
  check("migration.version.future-refused",lambda:reject("snapshot",{"source":"fixture"},"MIGRATION_VERSION"))
  def wrong_schema():
   FIXTURE.sql("UPDATE hyperfide.schema_migrations SET checksum=$1 WHERE version=25",['sha256:'+'0'*64])
   try:reject('describe',{},'MIGRATION_SCHEMA_REQUIRED')
   finally:FIXTURE.sql("UPDATE hyperfide.schema_migrations SET checksum=$1 WHERE version=25",[sha((ROOT/'services/hyperfide/migrations/0025-sqlite-history.sql').read_bytes())])
  check("migration.schema.checksum-refused",wrong_schema)
  c.close();frozen.close();database=FIXTURE.database;FIXTURE.close();backend_absent=backend.stop();proxy.close();proxy_absent=not Path(proxy.path).exists()
  import socket
  database_absent=not FIXTURE.sql('SELECT datname FROM pg_database WHERE datname=$1',[database],admin=True)
  role_absent=not FIXTURE.sql('SELECT rolname FROM pg_roles WHERE rolname=$1',[FIXTURE.runtime_role],admin=True)
  with socket.socket() as sock:sock.settimeout(1);https_absent=sock.connect_ex(("127.0.0.1",FIXTURE.port))!=0
  absent=database_absent and role_absent and https_absent and backend_absent and proxy_absent and not FIXTURE.path.exists()
  (artifacts()/"cleanup.json").write_text(json.dumps({"observed_absent":absent,"database":database,"observer":"actual PostgreSQL catalogue and closed listeners/private roots after fixture close","database_observed_absent":database_absent,"role_observed_absent":role_absent,"https_observed_absent":https_absent,"object_backend_observed_absent":backend_absent,"commit_proxy_observed_absent":proxy_absent}))
  check("migration.cleanup.actual-absence",lambda:expect(absent,"synthetic database still exists"))
 (artifacts()/"observations.json").write_text(json.dumps({"scope":"task-component","assertion_ids":IDS,"failed_ids":FAILED,"private_records_used":False,"full_cases_qualified":False},sort_keys=True))
 return 1 if FAILED else 0
if __name__=="__main__":
 sys.exit(cleanup() if "--cleanup" in sys.argv else main())
