#!/usr/bin/env python3
"""Concrete legacy admission and kernel writer/mount refusals. Synthetic files only.
Read-only proof is limited to an owned private namespace; production isolation is not claimed."""
import os,json,sys,subprocess,tempfile,sqlite3,uuid,hashlib,shutil
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];IDS=[];FAILED=[]
def check(name,fn):
 IDS.append(name)
 try:fn();actual="observed"
 except Exception as e:FAILED.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def expect(v,message):
 if not v:raise AssertionError(message)
NODE="""import fs from 'node:fs';import {LegacyWriterAdmission} from './services/hyperfide/dist/migration/legacy.js';
const value=JSON.parse(fs.readFileSync(0,'utf8'));try{const result=await new LegacyWriterAdmission(process.env)[value.action](value.input);process.stdout.write(JSON.stringify({ok:true,result}));}catch(e){process.stdout.write(JSON.stringify({ok:false,error:{code:e.code??'ERROR'}}));}"""
def main():
 with tempfile.TemporaryDirectory(prefix="hyperfide-legacy-",dir="/dev/shm") as directory:
  base=Path(directory);data=base/".codegraph";data.mkdir();database=data/"graph.db"
  conn=sqlite3.connect(database);conn.execute("CREATE TABLE fixture(value TEXT)");conn.commit();conn.close()
  config={"schema_version":1,"deployment_id":str(uuid.uuid4()),"source_epoch":str(uuid.uuid4()),"workspace_root":str(base),"data_roots":[".codegraph"],"legacy_writer_id":"owned-synthetic-sqlite","expected_pid_namespace":os.readlink("/proc/self/ns/pid"),"expected_mount_namespace":os.readlink("/proc/self/ns/mnt")}
  filename=base/"legacy.json";filename.write_text(json.dumps(config));filename.chmod(0o600)
  environment=os.environ.copy();environment["HF_LEGACY_WRITER_CONFIG_FILE"]=str(filename)
  value={"deployment_id":config["deployment_id"],"operation_id":str(uuid.uuid4()),"source_epoch":config["source_epoch"]}
  def call(action,input=None,env=None):
   p=subprocess.run(["node","--input-type=module","-e",NODE],input=json.dumps({"action":action,"input":input or value}),text=True,capture_output=True,cwd=ROOT,env=env or environment,timeout=45)
   expect(p.returncode==0,"actual legacy module process failed");return json.loads(p.stdout)
  def rejected(action,code,input=None,env=None):
   r=call(action,input,env);expect(not r["ok"] and r["error"]["code"]==code,"expected "+code+", observed "+str(r))
  missing=environment.copy();missing.pop("HF_LEGACY_WRITER_CONFIG_FILE",None)
  check("cutover.legacy.missing-trusted-topology",lambda:rejected("disableAdmission","LEGACY_CONFIG_REQUIRED",env=missing))
  check("cutover.legacy.source-epoch-binding",lambda:rejected("disableAdmission","LEGACY_CONFIG_INVALID",input=dict(value,source_epoch=str(uuid.uuid4()))))
  def private():
   filename.chmod(0o644)
   try:rejected("disableAdmission","LEGACY_CONFIG_INVALID")
   finally:filename.chmod(0o600)
  check("cutover.legacy.private-topology",private)
  def bootstrap_admission():
   root=base/"initial";root.mkdir();(root/".codegraph").mkdir();shutil.copyfile(database,root/".codegraph/graph.db")
   trusted=dict(config,source_epoch=None,workspace_root=str(root));filename.write_text(json.dumps(trusted))
   initial=dict(value,source_epoch=None)
   try:
    result=call("disableAdmission",initial)
    expect(result["ok"] and result["result"]["source_epoch"] is None and result["result"]["status"]=="ADMISSION_DISABLED","first activation invented predecessor authority")
    marker=json.loads((root/".hyperfide/authority.json").read_text())
    expect(marker["authority_epoch"]==initial["operation_id"],"null predecessor quarantine marker is not bound to operation")
    p=subprocess.run([str(ROOT/"cg"),"init"],cwd=root,env=environment,capture_output=True,text=True,timeout=20)
    expect(p.returncode==78 and json.loads(p.stderr)["local_fallback"] is False,"initial quarantine allowed SQLite admission")
    rejected("observeIsolation","LEGACY_ADMISSION_INVALID",dict(initial,operation_id=str(uuid.uuid4())))
   finally:filename.write_text(json.dumps(config))
  check("cutover.legacy.null-predecessor-admission",bootstrap_admission)

  def namespace():
   old=config["expected_pid_namespace"];config["expected_pid_namespace"]="pid:[1]";filename.write_text(json.dumps(config))
   try:rejected("disableAdmission","LEGACY_NAMESPACE_MISMATCH")
   finally:config["expected_pid_namespace"]=old;filename.write_text(json.dumps(config))
  check("cutover.legacy.namespace-binding",namespace)
  def disable():
   r=call("disableAdmission");expect(r["ok"] and r["result"]["status"]=="ADMISSION_DISABLED","admission not disabled")
   marker=base/".hyperfide/authority.json";observed=json.loads(marker.read_text())
   expect(observed=={"schema_version":1,"mode":"distributed","authority_epoch":config["source_epoch"]} and marker.stat().st_mode&0o777==0o600,"actual descriptor differs")
   expect("ISOLATED" not in json.dumps(r),"admission alone claimed physical isolation")
  check("cutover.legacy.actual-admission-descriptor",disable)
  check("cutover.legacy.idempotent-admission",disable)
  def native_boundary():
   before=hashlib.sha256(database.read_bytes()).hexdigest()
   p=subprocess.run([str(ROOT/"cg"),"init"],cwd=base,env=environment,capture_output=True,text=True,timeout=20)
   expect(p.returncode==78 and json.loads(p.stderr)["local_fallback"] is False,"native client bypassed disabled legacy admission")
   expect(hashlib.sha256(database.read_bytes()).hexdigest()==before,"refused native command changed SQLite")
  check("cutover.legacy.native-admission-enforced",native_boundary)
  check("cutover.legacy.writable-mount-refused",lambda:rejected("observeIsolation","LEGACY_STORAGE_WRITABLE"))
  def holder(script):
   process=subprocess.Popen([sys.executable,"-u","-c",script,str(database),str(data)],stdin=subprocess.PIPE,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
   try:
    expect(process.stdout.readline().strip()=="ready","owned legacy holder failed")
    rejected("observeIsolation","LEGACY_WRITER_ACTIVE")
   finally:
    if process.stdin:process.stdin.close()
    process.wait(timeout=10)
    expect(process.returncode==0,"owned holder did not exit")
  check("cutover.legacy.active-sqlite-writer-refused",lambda:holder("import sqlite3,sys;c=sqlite3.connect(sys.argv[1]);c.execute('BEGIN IMMEDIATE');c.execute(\"INSERT INTO fixture VALUES('uncommitted')\");print('ready',flush=True);sys.stdin.read();c.rollback();c.close()"))
  check("cutover.legacy.shared-writable-mapping-refused",lambda:holder("import mmap,os,sys;fd=os.open(sys.argv[1],os.O_RDWR);m=mmap.mmap(fd,0,access=mmap.ACCESS_WRITE,trackfd=False);os.close(fd);print('ready',flush=True);sys.stdin.read();m.close()"))
  check("cutover.legacy.directory-reconnect-handle-refused",lambda:holder("import os,sys;fd=os.open(sys.argv[2],os.O_RDONLY|os.O_DIRECTORY);print('ready',flush=True);sys.stdin.read();os.close(fd)"))
  def tamper():
   marker=base/".hyperfide/authority.json";original=marker.read_text();marker.write_text('{"schema_version":1,"mode":"local"}')
   try:rejected("observeIsolation","LEGACY_ADMISSION_INVALID")
   finally:marker.write_text(original)
  check("cutover.legacy.changed-admission-refused",tamper)
  def symlink():
   actual=base/".real";data.rename(actual);data.symlink_to(actual,target_is_directory=True)
   try:rejected("disableAdmission","LEGACY_CONFIG_INVALID")
   finally:data.unlink();actual.rename(data)
  check("cutover.legacy.symlink-scope-refused",symlink)
 isolated={}
 def private_namespace():
  command=['unshare','--user','--map-root-user','--mount','--pid','--fork','--mount-proc','--propagation','private',sys.executable,str(Path(__file__).resolve()),'--isolated-positive']
  p=subprocess.run(command,text=True,capture_output=True,cwd=ROOT,timeout=120)
  expect(p.returncode==0,'actual private mount/PID isolation probe failed: '+p.stderr[:300])
  isolated.update(json.loads(p.stdout))
  expect(isolated['proof']['status']=='ISOLATED' and isolated['proof']['visibility']['scope']=='CONFIGURED_PID_NAMESPACE','actual isolated receipt missing')
 check("cutover.legacy.real-readonly-namespace-proof",private_namespace)
 def initial_namespace():
  command=['unshare','--user','--map-root-user','--mount','--pid','--fork','--mount-proc','--propagation','private',sys.executable,str(Path(__file__).resolve()),'--isolated-positive','--initial']
  p=subprocess.run(command,text=True,capture_output=True,cwd=ROOT,timeout=120)
  expect(p.returncode==0,'actual null-predecessor readonly proof failed: '+p.stderr[:300])
  value=json.loads(p.stdout);expect(value["proof"]["source_epoch"] is None and value["proof"]["status"]=="ISOLATED" and value["kernel_write_errno"]==30,"null predecessor manufactured old epoch or skipped kernel isolation")
 check("cutover.legacy.null-predecessor-real-readonly-proof",initial_namespace)

 check("cutover.legacy.outside-writable-hardlink-refused",lambda:expect(isolated.get("outside_hardlink_refused") is True,"outside hardlink escaped readonly isolation"))
 check("cutover.legacy.preexisting-detached-writer-refused",lambda:expect(isolated.get('preexisting_writer_refused') is True,'preexisting writer bypassed readonly bind'))
 check("cutover.legacy.stale-sqlite-reconnect-blocked",lambda:expect(isolated.get('stale_sqlite_reconnect_blocked') is True and isolated.get('kernel_write_errno')==30,'stale writer reconnected to readonly database'))
 service_probe()
 out=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-cutover-tests"))/"cutover";out.mkdir(parents=True,exist_ok=True)
 (out/"observations.json").write_text(json.dumps({"scope":"task-component","assertion_ids":IDS,"failed_ids":FAILED,"production_isolation_proven":False,"full_cases_qualified":False,"visibility":"configured namespace only","actual_readonly_mount_positive":"CONFIGURED_PRIVATE_NAMESPACE","production_host_qualified":False,"isolation_observation":isolated}))
 return 1 if FAILED else 0


def isolated_positive():
 import errno
 with tempfile.TemporaryDirectory(prefix="hyperfide-fence-positive-",dir="/dev/shm") as directory:
  base=Path(directory);data=base/".codegraph";data.mkdir();database=data/"graph.db"
  c=sqlite3.connect(database);c.execute("CREATE TABLE fixture(value TEXT)");c.commit();c.close()
  config={"schema_version":1,"deployment_id":str(uuid.uuid4()),"source_epoch":None if "--initial" in sys.argv else str(uuid.uuid4()),"workspace_root":str(base),"data_roots":[".codegraph"],"legacy_writer_id":"owned-private-namespace-sqlite","expected_pid_namespace":os.readlink("/proc/self/ns/pid"),"expected_mount_namespace":os.readlink("/proc/self/ns/mnt")}
  filename=base/"legacy.json";filename.write_text(json.dumps(config));filename.chmod(0o600)
  environment=os.environ.copy();environment["HF_LEGACY_WRITER_CONFIG_FILE"]=str(filename)
  value={"deployment_id":config["deployment_id"],"operation_id":str(uuid.uuid4()),"source_epoch":config["source_epoch"]}
  def call(action):
   p=subprocess.run(["node","--input-type=module","-e",NODE],input=json.dumps({"action":action,"input":value}),text=True,capture_output=True,cwd=ROOT,env=environment,timeout=45)
   expect(p.returncode==0,"actual isolated module process failed");return json.loads(p.stdout)
  expect(call("disableAdmission")["ok"],"private namespace admission failed")
  outside=base/"outside-hardlink.db";os.link(database,outside)
  old_fd=os.open(database,os.O_RDWR);mounted=False
  try:
   subprocess.run(["mount","--bind",str(data),str(data)],check=True,capture_output=True);mounted=True
   subprocess.run(["mount","-o","remount,bind,ro",str(data)],check=True,capture_output=True)
   outside_fd=os.open(outside,os.O_WRONLY);original=database.read_bytes()[:1];os.pwrite(outside_fd,original,0);os.close(outside_fd)
   linked=call("observeIsolation");expect(not linked["ok"] and linked["error"]["code"]=="LEGACY_LINK_ALIAS","outside writable hardlink passed readonly isolation")
   outside.unlink()
   old=call("observeIsolation");expect(not old["ok"] and old["error"]["code"]=="LEGACY_WRITER_ACTIVE","preexisting writable descriptor passed isolation")
   os.close(old_fd);old_fd=None
   kernel_errno=None
   try:
    fd=os.open(database,os.O_WRONLY);os.close(fd)
   except OSError as error:kernel_errno=error.errno
   expect(kernel_errno==errno.EROFS,"kernel did not prohibit stale writable reconnect")
   stale=False
   try:
    c=sqlite3.connect(database)
    try:c.execute("INSERT INTO fixture VALUES('forbidden')");c.commit()
    finally:c.close()
   except sqlite3.OperationalError as error:stale=error.sqlite_errorcode==sqlite3.SQLITE_READONLY
   expect(stale,"actual SQLite stale reconnect wrote after readonly fence")
   result=call("observeIsolation");expect(result["ok"],"actual readonly mount proof refused: "+str(result))
   proof=result["result"]
   expect(all(proof[k]==v for k,v in value.items()) and proof["writable_fds"]==0 and proof["writable_shared_mappings"]==0 and proof["read_only_aliases"]>=1,"isolation receipt is not bound to actual scope")
   print(json.dumps({"proof":proof,"preexisting_writer_refused":True,"outside_hardlink_refused":True,"kernel_write_errno":kernel_errno,"stale_sqlite_reconnect_blocked":stale}))
  finally:
   if old_fd is not None:os.close(old_fd)
   if mounted:subprocess.run(["umount",str(data)],check=True,capture_output=True)
 return 0
# --- Task 25.2 cutover service probe -------------------------------------------------
# The real HTTPS service runs inside an owned private user/mount/PID namespace so the
# 25.1 kernel isolation observation can be positive against an actual read-only bind.
# Activation path: NO coordinator-approved synthetic 4.4 fence exists, so activation is
# exercised only as an observed refusal. Synthetic data only.
SERVICE_IDS=["cutover.service.describe","cutover.service.schema-checksum-gate","cutover.service.prepare-requires-run-quiescence",
 "cutover.service.prepare-requires-readonly-legacy-storage","cutover.service.prepare-quiesced","cutover.service.prepare-replay",
 "cutover.service.prepare-replay-conflict","cutover.service.stale-generation-refused","cutover.service.validate-requires-run-quiescence","cutover.service.validate-requires-artifact-receipt",
 "cutover.service.validate-refuses-pre-quiesce-import","cutover.service.validate-refuses-tampered-history","cutover.service.shadow-read-only",
 "cutover.service.validate-parity-receipt","cutover.service.activate-refused-without-approved-fence","cutover.service.single-authority",
 "cutover.service.rollback-before-writes","cutover.service.re-prepare-after-rollback","cutover.service.rollback-refused-after-writes",
 "cutover.service.recovery-refuses-sqlite-archive-authority","cutover.service.recovery-forward-after-effects",
 "cutover.service.sqlite-archive-never-authority","cutover.service.rollback-paths-recorded","cutover.service.cleanup.actual-absence"]
def campaign_dir():
 out=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-cutover-tests"))/"cutover";out.mkdir(parents=True,exist_ok=True);return out
def service_probe():
 """Runs the namespaced service child and relays its assertion events."""
 command=['unshare','--user','--map-root-user','--mount','--pid','--fork','--mount-proc','--propagation','private',sys.executable,str(Path(__file__).resolve()),'--cutover-service']
 seen=set()
 try:
  p=subprocess.Popen(command,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,cwd=ROOT)
  for line in p.stdout:
   try:event=json.loads(line)
   except ValueError:continue
   if event.get("type")=="assertion" and event.get("id") in SERVICE_IDS and event["id"] not in seen:
    seen.add(event["id"]);IDS.append(event["id"])
    if event.get("actual")!="observed":FAILED.append(event["id"])
    print(json.dumps(event),flush=True)
  err=p.stderr.read();p.wait(timeout=60)
  if p.returncode!=0:sys.stderr.write(err[-4000:])
 except Exception as e:sys.stderr.write("cutover service probe failed: "+type(e).__name__+": "+str(e)+"\n")
 for name in SERVICE_IDS:
  if name not in seen:
   IDS.append(name);FAILED.append(name)
   print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":"AssertionError: namespaced service probe did not observe this assertion"}),flush=True)
def service_child():
 import importlib.util,errno,socket
 sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
 from identity_fixture import IdentityFixture,sha
 RESULTS={}
 def check(name,fn):
  try:fn();actual="observed"
  except Exception as e:actual=type(e).__name__+": "+str(e)[:800]
  RESULTS[name]=actual
  print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
 spec=importlib.util.spec_from_file_location("artifact_fixture",ROOT/"tests/hyperfide/cases/tasks/15_2.py")
 artifact=importlib.util.module_from_spec(spec);spec.loader.exec_module(artifact)
 out=campaign_dir();observations={};cleanup={"observed_absent":False}
 (out/"cleanup.json").write_text(json.dumps(cleanup))
 with tempfile.TemporaryDirectory(prefix="hyperfide-cutover-",dir="/dev/shm") as directory:
  base=Path(directory);workspace=base/"workspace";workspace.mkdir();data=workspace/".codegraph";data.mkdir();database=data/"graph.db"
  archive=base/"archive";archive.mkdir(mode=0o700)
  c=sqlite3.connect(database)
  c.executescript("""PRAGMA journal_mode=DELETE;
CREATE TABLE meta(key TEXT PRIMARY KEY,value TEXT);INSERT INTO meta VALUES('schema_version','18');
CREATE TABLE memories(id INTEGER PRIMARY KEY,body TEXT,raw BLOB);
CREATE TABLE attempts(attempt_id TEXT PRIMARY KEY,task TEXT,state TEXT);
CREATE TABLE files(id INTEGER PRIMARY KEY,path TEXT);
CREATE TABLE git_commits(sha TEXT PRIMARY KEY,parent TEXT);
INSERT INTO memories VALUES(1,'first',x'00ff'),(2,'second',NULL),(3,'third',x'');
INSERT INTO attempts VALUES('legacy-attempt','1.1','running');
INSERT INTO files VALUES(1,'a.c'),(2,'b.c');
INSERT INTO git_commits VALUES('aaaa',NULL),('bbbb','aaaa');""");c.commit();c.close()
  source_id="10000000-0000-4000-8000-000000000252";repository=str(uuid.uuid4())
  profiles=[{"id":"cutover","source_id":source_id,"repository_id":repository,"organisation_id":"00000000-0000-4000-8000-000000000000","root":str(data),"database":"graph.db","external":[{"label":"docs","path":"missing.md","kind":"documentation"}]}]
  pf=base/"sources.json";pf.write_text(json.dumps(profiles))
  topology=base/"legacy.json";legacy_epoch=str(uuid.uuid4())
  backend=artifact.ObjectFixture()
  def setup(fixture):
   i=fixture.ids;profiles[0]["organisation_id"]=i["organisation"];pf.write_text(json.dumps(profiles))
   topology.write_text(json.dumps({"schema_version":1,"deployment_id":i["deployment"],"source_epoch":legacy_epoch,"workspace_root":str(workspace),"data_roots":[".codegraph"],"legacy_writer_id":"owned-cutover-sqlite","expected_pid_namespace":os.readlink("/proc/self/ns/pid"),"expected_mount_namespace":os.readlink("/proc/self/ns/mnt")}));topology.chmod(0o600)
   fixture.env.update(HF_LEGACY_WRITER_CONFIG_FILE=str(topology),HF_ARTIFACT_S3_ENDPOINT=backend.endpoint,HF_ARTIFACT_ALLOW_LOOPBACK_HTTP='1',HF_ARTIFACT_S3_REGION=artifact.REGION,HF_ARTIFACT_S3_BUCKET=artifact.BUCKET,HF_ARTIFACT_S3_ACCESS_KEY_ID=artifact.KEY,HF_ARTIFACT_S3_SECRET_ACCESS_KEY=artifact.SECRET,HF_ARTIFACT_S3_SESSION_TOKEN=artifact.TOKEN,HF_ARTIFACT_ORGANISATION_ID=i['organisation'],HF_ARTIFACT_ALLOWED_RUN_IDS=json.dumps([i['run']]))
   fixture.sql("INSERT INTO hyperfide.repositories(organisation_id,id,project_id,name,url) VALUES($1,$2,$3,'legacy','fixture:legacy')",[i['organisation'],repository,i['project']])
   fixture.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)",[i['organisation'],repository,'2'*40])
   fixture.sql("INSERT INTO hyperfide.run_repositories(organisation_id,run_id,repository_id,source_object_id,integration_ref) VALUES($1,$2,$3,$4,'refs/heads/main')",[i['organisation'],i['run'],repository,'2'*40])
  fragments={}
  for file in (ROOT/"services/hyperfide/components").glob("*.json"):
   value=json.loads(file.read_text())
   if "id" in value:fragments[value["id"]]=(file.stem,value)
  closure=[];visited=set()
  def visit(name):
   if name in visited:return
   visited.add(name);stem,value=fragments[name]
   for r in value["requires"]:visit(r)
   closure.append(stem)
  for name in ("15.2","3.1","24.3","25.1","25.2"):visit(name)
  F=IdentityFixture(extra_components=closure,extra_env={"HF_MIGRATION_SOURCES_FILE":str(pf),"HF_MIGRATION_ARCHIVE_ROOT":str(archive)},extra_setup=setup)
  database_name=F.database;mounted=False
  try:
   F.sql('GRANT USAGE ON SCHEMA hyperfide_history TO "'+F.runtime_role+'"; GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA hyperfide_history TO "'+F.runtime_role+'"')
   run=F.ids["run"]
   def call(action,payload,opid=None,component="25.2"):
    op=F.operation(component,action,payload)
    if opid:op["idempotency_key"]=opid
    return F.request(op,timeout_seconds=60)[1]
   def ok(action,payload,opid=None,component="25.2"):
    r=call(action,payload,opid,component);expect(r.get("ok") is True,action+" rejected: "+json.dumps(r.get("error"))[:600]);observations.setdefault(action,[]).append(r["result"]);return r["result"]
   def rejected(action,payload,code,opid=None,component="25.2"):
    r=call(action,payload,opid,component);expect(r.get("ok") is False and r.get("error",{}).get("code")==code,"expected "+code+", observed "+json.dumps(r)[:600]);return r["error"]
   def mutation(action,generation,**extra):
    opid=str(uuid.uuid4());return dict({"scope_id":run,"operation_id":opid,"expected_generation":generation},**extra),opid
   def m(name):return ok("migration.sqlite."+name[0],name[1],component="25.1")
   def inspect():return ok("cutover.inspect",{"scope_id":run})
   marker=workspace/".hyperfide/authority.json"
   def describe():
    d=ok("cutover.describe",{});expect(d["activation_available"] is False and d["authority_granted"] is False and d["sqlite_archive_authority"]=="NEVER","describe granted authority")
   check("cutover.service.describe",describe)
   def schema_gate():
    F.sql("UPDATE hyperfide.schema_migrations SET checksum=$1 WHERE version=252",['sha256:'+'0'*64])
    try:rejected("cutover.inspect",{"scope_id":run},"CUTOVER_SCHEMA_REQUIRED")
    finally:F.sql("UPDATE hyperfide.schema_migrations SET checksum=$1 WHERE version=252",[sha((ROOT/'services/hyperfide/migrations/0252-migration-proof.sql').read_bytes())])
    inspect()
   check("cutover.service.schema-checksum-gate",schema_gate)
   def running():
    payload,opid=mutation("cutover.prepare","1",legacy_source_epoch=legacy_epoch)
    rejected("cutover.prepare",payload,"RECOVERY_NOT_QUIESCED",opid)
    expect(not marker.exists() and inspect()["state"] is None,"unquiesced run disabled legacy admission or recorded an intent")
   check("cutover.service.prepare-requires-run-quiescence",running)
   # A snapshot taken before quiescence; the legacy writer then commits one more row.
   stale=m(("snapshot",{"source":"cutover"}))
   c=sqlite3.connect(database);c.execute("INSERT INTO memories VALUES(4,'late legacy write',NULL)");c.commit();c.close()
   def run_state(state):F.sql("UPDATE hyperfide.runs SET state=$2,state_version=state_version+1 WHERE id=$1",[run,state])
   run_state("PAUSED")
   def writable():
    payload,opid=mutation("cutover.prepare","1",legacy_source_epoch=legacy_epoch)
    rejected("cutover.prepare",payload,"LEGACY_STORAGE_WRITABLE",opid)
    expect(inspect()["state"] is None,"writable legacy storage produced a quiesced intent")
   check("cutover.service.prepare-requires-readonly-legacy-storage",writable)
   subprocess.run(["mount","--bind",str(data),str(data)],check=True,capture_output=True);mounted=True
   subprocess.run(["mount","-o","remount,bind,ro",str(data)],check=True,capture_output=True)
   prepared={}
   def prepare():
    payload,opid=mutation("cutover.prepare","1",legacy_source_epoch=legacy_epoch)
    r=ok("cutover.prepare",payload,opid);prepared.update(payload=payload,opid=opid,result=r)
    state=inspect()["state"]
    expect(r["state"]=="QUIESCED" and r["generation"]=="2" and r["legacy_writer_fenced"] is True and r["authority_granted"] is False,"prepare did not quiesce")
    expect(state["state"]=="QUIESCED" and state["evidence"]["legacy_writer_isolation"]["status"]=="ISOLATED" and state["evidence"]["legacy_admission"]["status"]=="ADMISSION_DISABLED" and state["evidence"]["run_quiescence"]=="OBSERVED","quiesced evidence missing")
    expect(json.loads(marker.read_text())=={"schema_version":1,"mode":"distributed","authority_epoch":legacy_epoch},"legacy admission descriptor not written")
   check("cutover.service.prepare-quiesced",prepare)
   def replay():
    r=ok("cutover.prepare",prepared["payload"],prepared["opid"]);expect(r.get("replayed") is True and r["generation"]=="2","prepare replay was not idempotent")
   check("cutover.service.prepare-replay",replay)
   def conflict():
    r=call("cutover.prepare",dict(prepared["payload"],expected_generation="2"),prepared["opid"])
    expect(r.get("ok") is False and r["error"]["code"] in ("CUTOVER_CONFLICT","IDEMPOTENCY_CONFLICT"),"changed replay accepted: "+json.dumps(r)[:300])
   check("cutover.service.prepare-replay-conflict",conflict)
   def stale_generation():
    payload,opid=mutation("cutover.validate","1",source_import_id=stale["import_id"],legacy_source_epoch=legacy_epoch)
    rejected("cutover.validate",payload,"CUTOVER_STALE",opid)
   check("cutover.service.stale-generation-refused",stale_generation)
   # The transport admits 25.1 history actions only on a running run. Legacy writers stay
   # isolated; validate re-asserts 24.3 quiescence and an unchanged authority fingerprint.
   run_state("RUNNING")
   snap=m(("snapshot",{"source":"cutover"}));iid=snap["import_id"]
   inventory=snap["inventory"]["tables"]
   for t in inventory:
    if t["disposition"]!="ARCHIVE_ONLY":m(("import",{"source":"cutover","import_id":iid,"table":t["name"],"offset":"0","limit":500}))
   def unquiesced_validate():
    payload,opid=mutation("cutover.validate","2",source_import_id=iid,legacy_source_epoch=legacy_epoch)
    rejected("cutover.validate",payload,"RECOVERY_NOT_QUIESCED",opid)
   check("cutover.service.validate-requires-run-quiescence",unquiesced_validate)
   run_state("PAUSED")
   def no_archive():
    payload,opid=mutation("cutover.validate","2",source_import_id=iid,legacy_source_epoch=legacy_epoch)
    e=rejected("cutover.validate",payload,"CUTOVER_PARITY_MISMATCH",opid);expect("ARTIFACT_ARCHIVE" in e.get("message",""),"missing archive custody was not the mismatch: "+str(e))
   check("cutover.service.validate-requires-artifact-receipt",no_archive)
   profiles[0]["archive_approved_digests"]=[snap["snapshot_digest"],stale["snapshot_digest"]];pf.write_text(json.dumps(profiles))
   run_state("RUNNING")
   m(("archive",{"source":"cutover","import_id":iid}));m(("archive",{"source":"cutover","import_id":stale["import_id"]}))
   for t in stale["inventory"]["tables"]:
    if t["disposition"]!="ARCHIVE_ONLY":m(("import",{"source":"cutover","import_id":stale["import_id"],"table":t["name"],"offset":"0","limit":500}))
   run_state("PAUSED")
   def pre_quiesce():
    payload,opid=mutation("cutover.validate","2",source_import_id=stale["import_id"],legacy_source_epoch=legacy_epoch)
    e=rejected("cutover.validate",payload,"CUTOVER_PARITY_MISMATCH",opid);expect("SOURCE_COUNT:memories" in e.get("message",""),"stale pre-quiescence import not reconciled against the source: "+str(e))
   check("cutover.service.validate-refuses-pre-quiesce-import",pre_quiesce)
   def tampered():
    original=F.sql("SELECT mapped_id::text AS id,payload_digest FROM hyperfide_history.rows WHERE import_id=$1 AND table_name='memories'",[iid])
    F.sql("UPDATE hyperfide_history.rows SET payload_digest=$2 WHERE import_id=$1 AND table_name='memories'",[iid,'sha256:'+'1'*64])
    try:
     payload,opid=mutation("cutover.validate","2",source_import_id=iid,legacy_source_epoch=legacy_epoch)
     e=rejected("cutover.validate",payload,"CUTOVER_PARITY_MISMATCH",opid);expect("SAMPLE:memories" in e.get("message",""),"semantic sample did not detect changed history: "+str(e))
    finally:
     for row in original:F.sql("UPDATE hyperfide_history.rows SET payload_digest=$3 WHERE import_id=$1 AND mapped_id=$2",[iid,row["id"],row["payload_digest"]])
   check("cutover.service.validate-refuses-tampered-history",tampered)
   def shadow():
    before=F.sql("SELECT (SELECT count(*) FROM hyperfide_history.cutover_receipts)::text AS r,(SELECT count(*) FROM hyperfide_history.cutover_parity_receipts)::text AS p,(SELECT generation::text FROM hyperfide_history.cutovers WHERE scope_id=$1) AS g",[run])
    s=ok("cutover.inspect",{"scope_id":run,"source_import_id":iid})["shadow"]
    after=F.sql("SELECT (SELECT count(*) FROM hyperfide_history.cutover_receipts)::text AS r,(SELECT count(*) FROM hyperfide_history.cutover_parity_receipts)::text AS p,(SELECT generation::text FROM hyperfide_history.cutovers WHERE scope_id=$1) AS g",[run])
    expect(s["outcome"]=="MATCHED" and s["writable"] is False and s["mode"]=="READ_ONLY_SHADOW" and s["authority_granted"] is False,"shadow comparison was writable or mismatched: "+json.dumps(s.get("mismatches")))
    expect(before==after,"shadow comparison wrote durable state")
    expect(all(x["history"] and x["live"] for x in s["samples"]) and len(s["samples"])>=5 and s["artifacts"]["archive"]=="VERIFIED" and s["git"]["observed"] is True,"semantic samples, artifact or Git reconciliation incomplete")
    expect(s["artifacts"]["explicit_exclusions"]!=[] ,"unavailable declared inputs were not explicitly recorded")
   check("cutover.service.shadow-read-only",shadow)
   def validate():
    payload,opid=mutation("cutover.validate","2",source_import_id=iid,legacy_source_epoch=legacy_epoch)
    r=ok("cutover.validate",payload,opid)
    expect(r["state"]=="VALIDATED" and r["generation"]=="3" and r["authority_granted"] is False,"validate did not record parity")
    row=F.sql("SELECT outcome,import_id::text AS import_id,jsonb_array_length(counts) AS counts,jsonb_array_length(samples) AS samples,receipt_digest FROM hyperfide_history.cutover_parity_receipts WHERE scope_id=$1 AND generation=3",[run])
    expect(len(row)==1 and row[0]["outcome"]=="MATCHED" and row[0]["import_id"]==iid and row[0]["counts"]==5 and row[0]["samples"]>=5 and row[0]["receipt_digest"]==r["parity_receipt_digest"],"parity receipt missing: "+json.dumps(row))
   check("cutover.service.validate-parity-receipt",validate)
   def activate():
    epochs=F.sql("SELECT epoch::text AS epoch FROM hyperfide.authority_epochs WHERE state='ACTIVE'")
    payload,opid=mutation("cutover.activate","3",source_import_id=iid,legacy_source_epoch=legacy_epoch)
    rejected("cutover.activate",payload,"AUTH_RUN_CLOSED",opid)
    run_state("RUNNING")
    try:rejected("cutover.activate",payload,"CUTOVER_EXTERNAL_FENCER_UNAVAILABLE",opid)
    finally:run_state("PAUSED")
    expect(F.sql("SELECT epoch::text AS epoch FROM hyperfide.authority_epochs WHERE state='ACTIVE'")==epochs and epochs==[{"epoch":F.ids["epoch"]}],"refused activation changed the authority epoch")
    state=inspect()["state"];expect(state["state"]=="VALIDATED" and state["epoch"] is None and state["generation"]=="3","refused activation changed the intent")
   check("cutover.service.activate-refused-without-approved-fence",activate)
   def single():
    expect(json.loads(marker.read_text())["mode"]=="distributed","legacy admission reopened while validated")
    code=None
    try:fd=os.open(database,os.O_WRONLY);os.close(fd)
    except OSError as error:code=error.errno
    expect(code==errno.EROFS,"legacy storage remained writable during validated cutover")
    p=subprocess.run([str(ROOT/"cg"),"init"],cwd=workspace,env=dict(os.environ,HF_LEGACY_WRITER_CONFIG_FILE=str(topology)),capture_output=True,text=True,timeout=20)
    expect(p.returncode==78 and json.loads(p.stderr)["local_fallback"] is False,"native legacy client admitted a second writer")
    expect(inspect()["authority_granted"] is False,"PostgreSQL intent claimed authority before activation")
   check("cutover.service.single-authority",single)
   def rollback_before():
    payload,opid=mutation("cutover.recovery","3",procedure="ROLLBACK_BEFORE_WRITES",legacy_source_epoch=legacy_epoch)
    r=ok("cutover.recovery",payload,opid)
    expect(r["path"]=="ROLLBACK_BEFORE_WRITES" and r["state"]=="ROLLED_BACK" and r["authoritative_writes"]=="0" and r["external_effects"]=="0" and r["legacy_admission"]["status"]=="ADMISSION_RESTORED","rollback before writes did not restore legacy authority: "+json.dumps(r)[:400])
    expect(not marker.exists(),"legacy admission descriptor remained after safe rollback")
   check("cutover.service.rollback-before-writes",rollback_before)
   def reprepare():
    payload,opid=mutation("cutover.prepare","4",legacy_source_epoch=legacy_epoch)
    r=ok("cutover.prepare",payload,opid);expect(r["state"]=="QUIESCED" and r["previous_state"]=="ROLLED_BACK" and r["generation"]=="5" and marker.exists(),"rolled-back intent could not be re-quiesced")
   check("cutover.service.re-prepare-after-rollback",reprepare)
   # Synthetic post-cutover PostgreSQL write and external provider effect.
   F.sql("INSERT INTO hyperfide.agent_sessions(organisation_id,run_id,id,role,connector,account_key,native_session_id) VALUES($1,$2,$3,'LEADER','fixture','fixture',$4)",[F.ids["organisation"],run,str(uuid.uuid4()),str(uuid.uuid4())])
   F.sql("INSERT INTO hyperfide.sandboxes(organisation_id,id,pool_id,native_sandbox_id,observed_state,preparation_digest) VALUES($1,$2,$3,'post-cutover-resource','RUNNING',$4)",[F.ids["organisation"],str(uuid.uuid4()),F.ids["pool"],F.preparation])
   def rollback_after():
    payload,opid=mutation("cutover.recovery","5",procedure="ROLLBACK_BEFORE_WRITES",legacy_source_epoch=legacy_epoch)
    r=ok("cutover.recovery",payload,opid)
    expect(r["outcome"]=="REFUSED" and r["refusal"]=="CUTOVER_ROLLBACK_AFTER_WRITES" and r["state"]=="RECOVERY_REQUIRED" and int(r["authoritative_writes"])>=1 and int(r["external_effects"])>=1 and "legacy_admission" not in r,"rollback after writes was not refused: "+json.dumps(r)[:400])
    expect(json.loads(marker.read_text())["mode"]=="distributed","legacy admission restored after PostgreSQL writes")
    row=F.sql("SELECT authoritative_writes::text AS w,external_effects::text AS e,state FROM hyperfide_history.cutovers WHERE scope_id=$1",[run])[0]
    expect(row["state"]=="RECOVERY_REQUIRED" and row["w"]==r["authoritative_writes"] and row["e"]==r["external_effects"],"write/effect counters not durable")
   check("cutover.service.rollback-refused-after-writes",rollback_after)
   def no_sqlite():
    payload,opid=mutation("cutover.recovery","6",procedure="SQLITE_ARCHIVE",legacy_source_epoch=legacy_epoch)
    rejected("cutover.recovery",payload,"CUTOVER_SQLITE_AUTHORITY_FORBIDDEN",opid)
   check("cutover.service.recovery-refuses-sqlite-archive-authority",no_sqlite)
   def recover():
    payload,opid=mutation("cutover.recovery","6",procedure="POSTGRESQL_FORWARD_RECOVERY",legacy_source_epoch=legacy_epoch)
    r=ok("cutover.recovery",payload,opid);tables={x["table"] for x in r["procedure"]["reverse_export"]}
    expect(r["outcome"]=="RECOVERY_PLANNED" and r["sqlite_authority_reopened"] is False and r["procedure"]["sqlite_archive"]=="READ_ONLY_HISTORY" and r["state"]=="RECOVERY_REQUIRED" and r["generation"]=="7","forward recovery not planned: "+json.dumps(r)[:400])
    expect({"authority:agent_sessions","effect:sandboxes"}<=tables,"reverse export omitted post-cutover writes: "+str(tables))
   check("cutover.service.recovery-forward-after-effects",recover)
   def archive_never():
    expect(json.loads(marker.read_text())=={"schema_version":1,"mode":"distributed","authority_epoch":legacy_epoch},"recovery reopened legacy admission")
    p=subprocess.run([str(ROOT/"cg"),"init"],cwd=workspace,env=dict(os.environ,HF_LEGACY_WRITER_CONFIG_FILE=str(topology)),capture_output=True,text=True,timeout=20)
    expect(p.returncode==78 and json.loads(p.stderr)["local_fallback"] is False,"native client reopened SQLite after recovery")
    frozen=archive/(snap["snapshot_digest"][7:]+".db")
    expect(frozen.stat().st_mode&0o777==0o400 and hashlib.sha256(frozen.read_bytes()).hexdigest()==snap["snapshot_digest"][7:],"SQLite archive was modified")
    row=F.sql("SELECT count(*)::int AS n FROM hyperfide_history.imports WHERE authority<>'NONE'")[0]
    expect(row["n"]==0,"historical import gained authority")
   check("cutover.service.sqlite-archive-never-authority",archive_never)
   def recorded():
    rehearsals=inspect()["rehearsals"];paths=[x["path"] for x in rehearsals]
    expect(paths==["ROLLBACK_BEFORE_WRITES","ROLLBACK_REFUSED_AFTER_WRITES","RECOVERY_AFTER_EFFECTS"] and all(x["sqlite_authority_reopened"] is False for x in rehearsals),"rehearsal paths not durably separated: "+str(paths))
   check("cutover.service.rollback-paths-recorded",recorded)
  finally:
   if mounted:subprocess.run(["umount",str(data)],capture_output=True)
   try:F.close()
   finally:backend_absent=backend.stop()
  database_absent=not F.sql('SELECT datname FROM pg_database WHERE datname=$1',[database_name],admin=True)
  role_absent=not F.sql('SELECT rolname FROM pg_roles WHERE rolname=$1',[F.runtime_role],admin=True)
  with socket.socket() as sock:sock.settimeout(1);https_absent=sock.connect_ex(("127.0.0.1",F.port))!=0
  absent=database_absent and role_absent and https_absent and backend_absent and not F.path.exists()
  cleanup={"observed_absent":absent,"database":database_name,"database_observed_absent":database_absent,"role_observed_absent":role_absent,"https_observed_absent":https_absent,"object_backend_observed_absent":backend_absent,"observer":"PostgreSQL catalogue and closed listeners after fixture close"}
  (out/"cleanup.json").write_text(json.dumps(cleanup))
  check("cutover.service.cleanup.actual-absence",lambda:expect(absent,"owned cutover fixture resources remain"))
 (out/"service-observations.json").write_text(json.dumps({"scope":"task-component","activation_path":"REFUSED_NO_APPROVED_FENCE","results":RESULTS,"responses":observations},sort_keys=True,default=str))
 return 0 if all(v=="observed" for v in RESULTS.values()) else 1
def cleanup_probe():
 filename=campaign_dir()/"cleanup.json"
 value=json.loads(filename.read_text()) if filename.exists() else {"observed_absent":False}
 absent=value.get("observed_absent") is True
 print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-task25.2-database","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"cutover/cleanup.json"}]}),flush=True)
 return 0 if absent else 1
if __name__=="__main__":sys.exit(isolated_positive() if "--isolated-positive" in sys.argv else service_child() if "--cutover-service" in sys.argv else cleanup_probe() if "--cleanup" in sys.argv else main())
