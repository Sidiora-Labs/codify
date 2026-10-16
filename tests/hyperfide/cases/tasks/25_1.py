#!/usr/bin/env python3
"""Real SQLite WAL / PostgreSQL historical-import component checks. No private data."""
import os,json,sqlite3,tempfile,subprocess,sys,hashlib,uuid,shutil
from pathlib import Path
from urllib.parse import urlsplit,urlunsplit
ROOT=Path(__file__).resolve().parents[4]
DB="hf_domain25_history"
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
 p=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",database],input=s,text=True,capture_output=True,env=env(),timeout=30)
 expect(p.returncode==0,"isolated PostgreSQL fixture query failed");return p.stdout.strip()
def artifacts():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-tests"))/"migration";p.mkdir(parents=True,exist_ok=True);return p
def cleanup():
 sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+DB+"' AND pid<>pg_backend_pid();","postgres")
 sql('DROP DATABASE IF EXISTS "'+DB+'";',"postgres")
 absent=not sql("SELECT datname FROM pg_database WHERE datname='"+DB+"';","postgres")
 (artifacts()/"cleanup.json").write_text(json.dumps({"observed_absent":absent}))
 print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-task25.1-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"migration/cleanup.json"}]}));return 0 if absent else 1
def main():
 sql('CREATE DATABASE "'+DB+'";',"postgres")
 sql((ROOT/"services/hyperfide/migrations/0025-sqlite-history.sql").read_text())
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
  components=base/"components";components.mkdir();shutil.copyfile(ROOT/"services/hyperfide/components/25.1.json",components/"25.1.json")
  policy={"schema_version":1,"programme_id":"fixture","repository":"fixture","spec_revision":"history-v1","policy_revision":1,"status":"ACTIVE","approval":{"decision":"APPROVED","record_id":"operator","spec_revision":"history-v1","policy_revision":1},"allowed_roles":["control"],"allowed_actions":["programme.activate"]+json.loads((components/"25.1.json").read_text())["actions"]}
  pp=base/"policy.json";pp.write_text(json.dumps(policy));e=env();e.update(HF_MIGRATION_SOURCES_FILE=str(pf),HF_MIGRATION_ARCHIVE_ROOT=str(archive))
  def request(action,value):
   p=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(pp),"--spec-revision","history-v1","--components",str(components),"--module-root",str(ROOT/"services/hyperfide/dist")],input=json.dumps({"id":"history","component":"25.1","action":"migration.sqlite."+action,"input":value})+"\n",text=True,capture_output=True,env=e,timeout=45)
   lines=p.stdout.splitlines();expect(len(lines)==1,"service did not emit one JSONL response");return json.loads(lines[0])
  def ok(action,v):
   r=request(action,v);expect(r.get("ok") is True,"service rejected "+action+": "+r.get("error",{}).get("code","unknown"));return r["result"]
  def reject(action,v,code):
   r=request(action,v);expect(r.get("ok") is False and r.get("error",{}).get("code")==code,"expected "+code)
  check("migration.describe",lambda:expect(ok("describe",{})["authority"]=="NONE","authority granted"))
  snap=ok("snapshot",{"source":"fixture"});iid=snap["import_id"];dg=snap["snapshot_digest"]
  frozen=sqlite3.connect(archive/(dg[7:]+".db"))
  check("migration.snapshot.wal",lambda:expect(frozen.execute("SELECT count(*) FROM memories").fetchone()[0]==1,"WAL commit missing or open transaction included"))
  check("migration.snapshot.integrity",lambda:expect(frozen.execute("PRAGMA integrity_check").fetchone()[0]=="ok","invalid SQLite archive"))
  check("migration.snapshot.digest",lambda:expect(hashlib.sha256((archive/(dg[7:]+".db")).read_bytes()).hexdigest()==dg[7:],"archive digest differs"))
  check("migration.snapshot.source-unchanged",lambda:expect(c.execute("SELECT name,sql FROM sqlite_master ORDER BY name").fetchall()==before_schema and c.in_transaction,"snapshot changed source schema or transaction"))
  check("migration.inventory.shape",lambda:expect("base" not in [x["name"] for t in snap["inventory"]["tables"] if t["name"]=="files" for x in t["columns"]],"inventory invented additive column"))
  check("migration.inventory.virtual",lambda:expect(any(t["name"]=="symbol_fts" and t["disposition"]=="ARCHIVE_ONLY" for t in snap["inventory"]["tables"]),"FTS semantics silently promoted"))
  check("migration.inventory.trigger",lambda:expect(any(t["name"]=="local_only" and t["type"]=="trigger" for t in snap["inventory"]["objects"]),"source trigger omitted"))
  check("migration.external.unavailable",lambda:expect(any(x["label"]=="missing-docs" and x["availability"]=="UNAVAILABLE" for x in snap["external_inventory"]),"missing evidence became available"))
  check("migration.external.session-excluded",lambda:expect(any(x["label"]=="session" and x["availability"]=="EXCLUDED_SENSITIVE" and "digest" not in x for x in snap["external_inventory"]),"sensitive session hashed/copied"))
  for table in ["memories","attempts","custom_shape","events","branches","files","memory_superseded"]:
   v={"source":"fixture","import_id":iid,"table":table,"offset":"0","limit":50}
   check("migration.import."+table,lambda v=v:expect(ok("import",v)["outcome"]=="SUCCEEDED","batch did not commit"))
  check("migration.import.exact-integer",lambda:expect("9007199254740993" in sql("SELECT payload::text FROM hyperfide_history.rows WHERE table_name='memories';"),"large integer rounded"))
  check("migration.import.exact-blob",lambda:expect("AP8=" in sql("SELECT payload::text FROM hyperfide_history.rows WHERE table_name='memories';"),"blob changed"))
  check("migration.import.unqualified",lambda:expect(sql("SELECT count(*) FROM hyperfide_history.imports WHERE authority<>'NONE' OR qualification<>'UNQUALIFIED';")=="0","historical import qualified"))
  check("migration.import.reconciliation",lambda:expect(sql("SELECT disposition FROM hyperfide_history.rows WHERE table_name='attempts';")=="REQUIRES_RECONCILIATION","old attempt gained live ownership"))
  check("migration.import.no-authority-tables",lambda:expect(sql("SELECT count(*) FROM information_schema.tables WHERE table_schema='hyperfide';")=="0","import created live authority"))
  v={"source":"fixture","import_id":iid,"table":"memories","offset":"0","limit":50}
  check("migration.replay.restart",lambda:expect(ok("import",v)["replayed"] is True and sql("SELECT count(*) FROM hyperfide_history.rows WHERE table_name='memories';")=="1","service restart duplicated history"))
  check("migration.replay.conflict",lambda:reject("import",dict(v,limit=1),"MIGRATION_CONFLICT"))
  check("migration.scope.unknown",lambda:reject("inventory",{"source":"unknown","import_id":iid},"MIGRATION_SCOPE"))
  check("migration.path.request-root",lambda:reject("snapshot",{"source":"fixture","root":"/"},"MIGRATION_INPUT"))
  check("migration.import.virtual-refused",lambda:reject("import",dict(v,table="symbol_fts"),"MIGRATION_UNSUPPORTED"))
  check("migration.import.out-of-order",lambda:reject("import",dict(v,table="meta",offset="1"),"MIGRATION_CONFLICT"))
  c.rollback();c.execute("ALTER TABLE files ADD COLUMN base TEXT");c.execute("ALTER TABLE files ADD COLUMN mtime_ns INTEGER");c.commit()
  changed=ok("snapshot",{"source":"fixture"})
  check("migration.inventory.same-version-addition",lambda:expect(any(x["name"]=="mtime_ns" for t in changed["inventory"]["tables"] if t["name"]=="files" for x in t["columns"]),"same-v18 column missing"))
  c.execute("UPDATE meta SET value='19' WHERE key='schema_version'");c.commit()
  check("migration.version.future-refused",lambda:reject("snapshot",{"source":"fixture"},"MIGRATION_VERSION"))
  c.close();frozen.close()
 (artifacts()/"observations.json").write_text(json.dumps({"scope":"task-component","assertion_ids":IDS,"failed_ids":FAILED,"private_records_used":False,"full_cases_qualified":False},sort_keys=True))
 return 1 if FAILED else 0
if __name__=="__main__":
 sys.exit(cleanup() if "--cleanup" in sys.argv else main())
