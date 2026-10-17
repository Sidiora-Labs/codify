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
if __name__=="__main__":sys.exit(isolated_positive() if "--isolated-positive" in sys.argv else main())
