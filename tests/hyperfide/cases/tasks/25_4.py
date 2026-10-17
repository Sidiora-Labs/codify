#!/usr/bin/env python3
"""Prebuilt release bytes and upgrade compatibility through the real service."""
import os,json,subprocess,tempfile,shutil,hashlib,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];IDS=[];FAILED=[]
def expect(v,m):
 if not v:raise AssertionError(m)
def check(name,fn):
 IDS.append(name)
 try:fn();actual="observed"
 except Exception as e:FAILED.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def artifacts():
 p=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-release-tests"))/"release";p.mkdir(parents=True,exist_ok=True);return p
def cleanup():
 file=artifacts()/"cleanup.json";v=json.loads(file.read_text()) if file.is_file() else {"observed_absent":False}
 absent=v.get("observed_absent") is True
 print(json.dumps({"type":"cleanup","complete":absent,"resources":[{"id":"hf-task25.4-fixtures","status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":"release/cleanup.json"}]}));return 0 if absent else 1
def main():
 with tempfile.TemporaryDirectory(prefix="hf-release-") as tmp:
  base=Path(tmp);payload=base/"payload";payload.mkdir()
  native=next((p for p in [ROOT/"build/hyperfide-native",ROOT/"hyperfide-native"] if p.is_file()),None);expect(native is not None,"actual built native helper absent")
  copies={"bin/hyperfide-native":native,"bin/hyperfide":ROOT/"cg","bin/cg":ROOT/"cg","runtime/node":Path(subprocess.check_output(["node","-p","process.execPath"],text=True).strip()).resolve(),"runtime/python/bin/python3":Path(sys.executable).resolve(),"runtime/python/bin/python3.bin":Path(sys.executable).resolve(),"runtime/python/lib/python3.14/ctypes/__init__.py":Path(__import__("ctypes").__file__).resolve(),
   "services/package.json":ROOT/"services/hyperfide/package.json","services/package-lock.json":ROOT/"services/hyperfide/package-lock.json",
   "services/node_modules/pg/package.json":ROOT/"services/hyperfide/node_modules/pg/package.json"}
  for role in ["control","provisioner","dispatch"]:copies["services/dist/"+role+".js"]=ROOT/("services/hyperfide/dist/"+role+".js")
  libraries=subprocess.run(["ldd",str(ROOT/"cg")],capture_output=True,text=True,check=True).stdout
  library=next(Path(line.split("=>",1)[1].strip().split()[0]).resolve() for line in libraries.splitlines() if "libsqlite3" in line)
  copies["lib/hyperfide/"+library.name]=library
  for dest,source in copies.items():
   p=payload/dest;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,p);p.chmod(0o755 if dest.startswith(("bin/","runtime/node","runtime/python/bin/")) else 0o644)
  shutil.copytree(ROOT/"services/hyperfide/dist",payload/"services/dist",dirs_exist_ok=True,symlinks=False)
  # Bounded dependency subset: the production closure of pg, the only package the exercised
  # control/migration paths load. A real release ships the full npm ci --omit=dev closure.
  services=ROOT/"services/hyperfide"
  for item in json.loads(subprocess.check_output(["npm","query","#pg, #pg *"],cwd=services,text=True)):
   shutil.copytree(services/item["location"],payload/"services"/item["location"],dirs_exist_ok=True,symlinks=False,ignore=lambda d,names,top=services/item["location"]:["node_modules"] if Path(d)==top else [])
  shutil.copytree(ROOT/"services/hyperfide/migrations",payload/"services/migrations",dirs_exist_ok=True,symlinks=False)
  shutil.copytree(ROOT/"services/hyperfide/components",payload/"services/components",dirs_exist_ok=True,symlinks=False)
  migration=payload/"deploy/hyperfide/migrate.mjs";migration.parent.mkdir(parents=True);shutil.copytree(ROOT/"deploy/hyperfide",payload/"deploy/hyperfide",dirs_exist_ok=True,symlinks=False)
  for item in payload.rglob("*"):
   if item.is_file():item.chmod(0o755 if item.relative_to(payload).as_posix().startswith(("bin/","runtime/node","runtime/python/bin/")) else 0o644)
  files=[{"path":p.relative_to(payload).as_posix(),"digest":"sha256:"+hashlib.sha256(p.read_bytes()).hexdigest(),"size_bytes":str(p.stat().st_size),"mode":format(p.stat().st_mode&0o777,"04o")} for p in sorted(payload.rglob("*")) if p.is_file()]
  manifest={"schema_version":1,"release_version":"2.0.0-dev","source_commit":subprocess.check_output(["git","rev-parse","HEAD"],cwd=ROOT,text=True).strip(),"source_date_epoch":"1","protocol_version":1,"schema_min":1,"schema_max":1,"runtime":{"node":"24.22.0","npm":"11.19.1","python":"3.14.8","platform":"linux","architecture":"x64"},"files":files}
  mf=payload/"manifest.json";mf.write_text(json.dumps(manifest))
  sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
  from identity_fixture import IdentityFixture
  fixture=IdentityFixture(extra_components=['25.4'],extra_env={'HYPERFIDE_RELEASE_ROOT':str(payload)})
  import atexit
  atexit.register(fixture.close)
  def request(action,value):
   status,result=fixture.invoke('release.'+action,value,component='25.4',timeout_seconds=90)
   return result
  def ok(action,value):
   r=request(action,value);expect(r.get("ok"),"positive service operation refused: "+r.get("error",{}).get("code",""));return r["result"]
  def rejected(action,value):
   r=request(action,value);expect(r.get("ok") is False and r["error"]["code"]=="RELEASE_INVALID","unsafe release accepted: "+json.dumps(r)[:300])
  check("release.bytes.inspect",lambda:expect(ok("inspect",{"manifest":"manifest.json"})["verified"] is True,"actual prebuilt pins did not verify"))
  def large_inventory():
   # A real release pins every production dependency file, far beyond 1 MiB of manifest.
   mf.write_text(json.dumps(manifest)+" "*(2*1024*1024))
   try:expect(ok("inspect",{"manifest":"manifest.json"})["verified"] is True,"multi-megabyte release inventory refused")
   finally:mf.write_text(json.dumps(manifest))
  check("release.bytes.large-inventory-manifest",large_inventory)
  check("release.authorization.separate",lambda:expect(ok("inspect",{"manifest":"manifest.json"})["deployment_authorized"] is False,"hash verification authorized deployment"))
  compatible={"service_protocol":1,"client_protocol":1,"runner_protocol":1,"schema_version":1,"schema_min":1,"schema_max":2,"phase":"EXPAND","old_clients":2}
  check("release.compatible.expand",lambda:expect(ok("compatibility",compatible)["compatible"],"compatible schema expansion refused"))
  for key in ["client_protocol","runner_protocol","schema_version"]:
   check("release.incompatible."+key,lambda key=key:expect(ok("compatibility",dict(compatible,**{key:3}))["compatible"] is False,"unsupported version accepted"))
  check("release.incompatible.contract-old-client",lambda:expect(ok("compatibility",dict(compatible,phase="CONTRACT"))["compatible"] is False,"old clients survived schema contraction"))
  check("release.plan.order",lambda:expect(ok("plan",{"compatibility":compatible,"release_digest":"sha256:"+"a"*64})["steps"][-1]=="CONTRACT_SCHEMA","upgrade contracts before drain/services"))
  check("release.plan.no-local-build",lambda:expect(ok("plan",{"compatibility":compatible,"release_digest":"sha256:"+"a"*64})["build_on_supervision_host"] is False,"main host build admitted"))
  check("release.path.escape",lambda:rejected("inspect",{"manifest":"../policy.json"}))
  p=payload/"bin/cg";original=p.read_bytes();p.write_bytes(original+b"tampered")
  check("release.bytes.tamper",lambda:rejected("inspect",{"manifest":"manifest.json"}));p.write_bytes(original);p.chmod(0o755)
  extra=payload/"unlisted.js";extra.write_text("unverified executable")
  check("release.bytes.unpinned",lambda:rejected("inspect",{"manifest":"manifest.json"}));extra.unlink()
  mf.write_text(json.dumps(dict(manifest,runtime=dict(manifest["runtime"],node="99.0.0"))))
  check("release.runtime.unqualified",lambda:rejected("inspect",{"manifest":"manifest.json"}));mf.write_text(json.dumps(manifest))
  outside=base/"outside";outside.write_text("outside");(payload/"extra-link").symlink_to(outside)
  check("release.path.symlink",lambda:rejected("inspect",{"manifest":"manifest.json"}))
  for required_python in ["runtime/python/bin/python3.bin","runtime/python/lib/python3.14/ctypes/__init__.py"]:
   (payload/"extra-link").unlink(missing_ok=True)
   actual=payload/required_python;original=actual.read_bytes();actual.unlink()
   changed=dict(manifest,files=[f for f in manifest["files"] if f["path"]!=required_python]);mf.write_text(json.dumps(changed))
   check("release.python.required."+("interpreter" if required_python.endswith(".bin") else "ctypes"),lambda:rejected("inspect",{"manifest":"manifest.json"}))
   actual.write_bytes(original);actual.chmod(0o755 if required_python.endswith(".bin") else 0o644);mf.write_text(json.dumps(manifest))
  def units_reported():
   units={u["unit"]:u for u in ok("inspect",{"manifest":"manifest.json"})["service_units"]}
   expect(all(units[u]["status"]=="INSTALLABLE" for u in ["control.service","provisioner.service","dispatch.service"]),"prebuilt control-service units not installable")
   expect(all(units[u]["status"]=="UNQUALIFIED" and units[u]["owner_task"]=="26.4" for u in ["issue-watcher.service","supervisory-host.service"]),"unimplemented 26.4 units reported installable")
  check("release.units.unqualified-reported",units_reported)
  def installable_unqualified():
   unit=payload/"deploy/hyperfide/issue-watcher.service";original=unit.read_bytes();unit.write_bytes(original+b"[Install]\nWantedBy=multi-user.target\n")
   changed=dict(manifest,files=[dict(f,digest="sha256:"+hashlib.sha256(unit.read_bytes()).hexdigest(),size_bytes=str(unit.stat().st_size)) if f["path"]=="deploy/hyperfide/issue-watcher.service" else f for f in manifest["files"]])
   mf.write_text(json.dumps(changed))
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:unit.write_bytes(original);unit.chmod(0o644);mf.write_text(json.dumps(manifest))
  check("release.units.installable-unqualified-refused",installable_unqualified)
  import uuid
  database="hf_release_migration_"+uuid.uuid4().hex
  fixture.sql('CREATE DATABASE "'+database+'"',admin=True)
  from urllib.parse import urlsplit,urlunsplit
  parsed=urlsplit(fixture.base_url);url=urlunsplit((parsed.scheme,parsed.netloc,"/"+database,parsed.query,parsed.fragment))
  policy=base/"migration-policy.json"
  approved={"schema_version":1,"programme_id":"owned-release-migration-fixture","repository":"fixture","spec_revision":"release-migration-v1","policy_revision":1,"status":"ACTIVE","approval":{"decision":"APPROVED","record_id":"owned-fixture","spec_revision":"release-migration-v1","policy_revision":1},"allowed_roles":["control"],"allowed_actions":["programme.activate","storage.migrations.apply","storage.migrations.inspect","storage.durability.inspect"]}
  policy.write_text(json.dumps(approved));policy.chmod(0o600)
  env=fixture.env.copy();env["DATABASE_URL"]=url;env["HYPERFIDE_MIGRATION_DATABASE_URL"]=url
  operation=str(uuid.uuid4());arguments=[str(payload/"runtime/node"),str(migration),"--release-root",str(payload),"--policy-file",str(policy),"--spec-revision","release-migration-v1","--operation-id",operation]
  def run_job(apply=True,environment=None):
   p=subprocess.run(arguments+(["--apply"] if apply else ["--inspect"]),capture_output=True,text=True,env=environment or env,timeout=70)
   expect(len(p.stdout.splitlines())==1,"migration wrapper emitted unbounded or missing output")
   return p,json.loads(p.stdout)
  try:
   def absent_credential():
    e=env.copy();e.pop("HYPERFIDE_MIGRATION_DATABASE_URL",None)
    process,result=run_job(environment=e)
    expect(process.returncode==1 and result["error"]["code"]=="MIGRATION_JOB_CREDENTIAL_REQUIRED","operator migration credential inherited implicitly")
   check("release.migrations.explicit-operator-credential",absent_credential)
   def actual_apply():
    process,result=run_job()
    expect(process.returncode==0 and result["outcome"]=="SUCCEEDED" and result["authority_activated"] is False,"actual shipped4.4 migrator failed: "+str(result))
    # Query the independently named database directly, never trust wrapper flags.
    saved=fixture.url;fixture.url=url
    try:rows=fixture.sql("SELECT version,name,checksum FROM hyperfide.schema_migrations ORDER BY version")
    finally:fixture.url=saved
    expected=[{"version":int(p.name.split("-")[0]),"name":p.stem,"checksum":"sha256:"+hashlib.sha256(p.read_bytes()).hexdigest()} for p in sorted((payload/"services/migrations").glob("*.sql"))]
    expect(rows==expected,"actual PostgreSQL migration ledger differs from shipped exact-byte SQL")
   check("release.migrations.actual-shipped-runner",actual_apply)
   check("release.migrations.actual-ledger-replay",actual_apply)
   def actual_inspect():
    process,result=run_job(False)
    expect(process.returncode==0 and result["outcome"]=="SUCCEEDED" and result["receipt"]["ready"] is True,"actual4.4 inspection did not confirm complete migration set")
   check("release.migrations.actual-inspection",actual_inspect)
  finally:
   fixture.sql('DROP DATABASE IF EXISTS "'+database+'" WITH (FORCE)',admin=True)
   absent=not fixture.sql("SELECT datname FROM pg_database WHERE datname=$1",[database],admin=True)
   check("release.migrations.actual-database-cleanup",lambda:expect(absent,"owned migration database retained"))
  auth=base/"auth";auth.mkdir(mode=0o755)
  public=auth/"trusted-release-public.pem";signature=auth/"manifest.sig"
  subprocess.run(["openssl","pkey","-in",str(fixture.keys["operator"]["path"]),"-pubout","-out",str(public)],check=True,capture_output=True)
  public.chmod(0o644)
  signed=subprocess.check_output(["openssl","pkeyutl","-sign","-rawin","-inkey",str(fixture.keys["operator"]["path"]),"-in",str(mf)])
  signature.write_bytes(signed);signature.chmod(0o644)
  fixture.stop();fixture.env.update(HYPERFIDE_TRUSTED_RELEASE_KEY_FILE=str(public),HYPERFIDE_RELEASE_SIGNATURE_FILE=str(signature));fixture.start()
  def authenticated():
   value=ok("inspect",{"manifest":"manifest.json"})
   der=subprocess.check_output(["openssl","pkey","-pubin","-in",str(public),"-outform","DER"])
   expect(value["signature_status"]=="VERIFIED" and value["authentication"]["mode"]=="ED25519" and value["authentication"]["key_fingerprint"]=="sha256:"+hashlib.sha256(der).hexdigest(),"real Ed25519 source authentication did not match trusted public SPKI")
   expect(value["deployment_authorized"] is False,"signature alone activated deployment")
  check("release.signature.actual-ed25519-manifest",authenticated)
  def changed_signature():
   signature.write_bytes(bytes([signed[0]^1])+signed[1:])
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:signature.write_bytes(signed)
  check("release.signature.changed-raw-signature-refused",changed_signature)
  def changed_key():
   original=public.read_bytes()
   replacement=subprocess.check_output(["openssl","pkey","-in",str(fixture.keys["other"]["path"]),"-pubout"])
   public.write_bytes(replacement)
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:public.write_bytes(original)
  check("release.signature.wrong-trust-key-refused",changed_key)
  def writable_key():
   public.chmod(0o666)
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:public.chmod(0o644)
  check("release.signature.writable-anchor-refused",writable_key)
  def writable_ancestor():
   auth.chmod(0o777)
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:auth.chmod(0o755)
  check("release.signature.writable-ancestor-refused",writable_ancestor)
  def linked_key():
   alias=base/"key-alias";os.link(public,alias)
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:alias.unlink()
  check("release.signature.hardlinked-anchor-refused",linked_key)
  def symlink_ancestor():
   moved=base/"protected-auth";auth.rename(moved);auth.symlink_to(moved,target_is_directory=True)
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:auth.unlink();moved.rename(auth)
  check("release.signature.symlink-ancestor-refused",symlink_ancestor)
  def fifo_anchor():
   import time
   original=public.read_bytes();public.unlink();os.mkfifo(public,0o644)
   started=time.monotonic()
   try:
    rejected("inspect",{"manifest":"manifest.json"})
    expect(time.monotonic()-started<3,"protected FIFO authentication input blocked inspection")
   finally:public.unlink();public.write_bytes(original);public.chmod(0o644)
  check("release.signature.fifo-anchor-nonblocking-refusal",fifo_anchor)
  def missing_signature():
   signature.unlink()
   try:rejected("inspect",{"manifest":"manifest.json"})
   finally:signature.write_bytes(signed);signature.chmod(0o644)
  check("release.signature.missing-detached-refused",missing_signature)

  base.chmod(0o755)
  service_root=base/"service-root"
  # The installer and its verifier run from the root-owned prebuilt release, never from a source checkout.
  installer=[str(Path(subprocess.check_output(["node","-p","process.execPath"],text=True).strip()).resolve()),str(payload/"deploy/hyperfide/install-service.mjs"),"--release-root",str(payload),"--destination-root",str(service_root),"--trusted-key",str(public),"--signature-file",str(signature),"--manifest-digest","sha256:"+hashlib.sha256(mf.read_bytes()).hexdigest(),"--service-uid","33025","--service-gid","33025"]
  def run_install(arguments=None):
   p=subprocess.run(arguments or installer,capture_output=True,text=True,timeout=300)
   expect(len(p.stdout.splitlines())==1,"operator promotion did not emit one bounded receipt")
   return p,json.loads(p.stdout)
  def stage_service():
   p,r=run_install();expect(p.returncode==0 and r["outcome"]=="SUCCEEDED" and not r["promoted"] and not r["services_started"] and not r["authority_activated"],"signed service staging failed: "+str(r))
   expect(r["installable_units"]==["control.service","dispatch.service","provisioner.service"] and r["unqualified_units"]==["issue-watcher.service","supervisory-host.service"],"installer receipt misreports installable service units")
   expect(not (service_root/"current").exists(),"staging changed active service pointer")
   target=Path(r["release_directory"]);expect(target.is_dir() and target.stat().st_uid==0 and target.stat().st_mode&0o777==0o755,"service tree is not root-owned and publicly traversable")
  check("release.service.actual-signed-stage",stage_service)
  def promote_service():
   p,r=run_install(installer+["--promote"]);expect(p.returncode==0 and r["promoted"] and r["replayed"] and not r["services_started"] and r["authentication"]["mode"]=="ED25519","explicit signed promotion failed: "+str(r))
   target=Path(r["release_directory"]);expect((service_root/"current").resolve()==target,"atomic service current pointer differs from pinned release")
   def drop():
    os.setgroups([]);os.setresgid(33025,33025,33025);os.setresuid(33025,33025,33025)
   command=subprocess.run([str(target/"bin/hyperfide"),"version"],cwd=target,preexec_fn=drop,capture_output=True,text=True,timeout=15)
   expect(command.returncode==0,"actual nonroot service identity cannot execute immutable installed native binary")
   deny=subprocess.run([str(target/"runtime/node"),"-e","try{require('node:fs').openSync(process.argv[1],'w');process.exit(1)}catch(e){process.exit(e.code==='EACCES'?0:2)}",str(target/"bin/hyperfide")],cwd=target,preexec_fn=drop,capture_output=True,text=True,timeout=15)
   expect(deny.returncode==0,"nonroot denied-write probe failed: "+str((deny.returncode,deny.stdout,deny.stderr)))
  check("release.service.actual-nonroot-promotion",promote_service)
  def bad_signature_stage():
   previous=os.readlink(service_root/"current");signature.write_bytes(bytes([signed[0]^1])+signed[1:])
   try:
    p,r=run_install(installer+["--promote"]);expect(p.returncode==78 and r["outcome"]=="REFUSED","invalid detached signature was promoted")
    expect(os.readlink(service_root/"current")==previous,"refused signature changed service pointer")
   finally:signature.write_bytes(signed)
  check("release.service.invalid-signature-preserves-current",bad_signature_stage)
  def wrong_manifest_stage():
   args=installer.copy();args[args.index("--manifest-digest")+1]="sha256:"+"0"*64
   p,r=run_install(args);expect(p.returncode==78 and r["error"]["code"]=="INSTALL_AUTHENTICATED_PIN_REQUIRED","signature bypassed explicit operator manifest pin")
  check("release.service.explicit-pinned-identity",wrong_manifest_stage)

  def noncanonical_destination():
   args=installer.copy();escaped=base/"unexpected-service-root";args[args.index("--destination-root")+1]=str(service_root)+"/../unexpected-service-root"
   p,r=run_install(args)
   expect(p.returncode==78 and r["error"]["code"]=="INSTALL_UNPROTECTED_PATH" and not escaped.exists(),"noncanonical destination mutated filesystem before refusal")
  check("release.service.noncanonical-destination-before-writes",noncanonical_destination)
  def changed_source_during_copy():
   import threading,time
   destination=base/"changed-source-service-root";args=installer.copy();args[args.index("--destination-root")+1]=str(destination)
   native_file=payload/"runtime/node";original=native_file.read_bytes();seen=threading.Event();stop=threading.Event()
   def mutate():
    until=time.monotonic()+25
    while not stop.is_set() and time.monotonic()<until:
     release_dir=destination/"releases"
     if release_dir.exists() and any(p.name.startswith(".staging-") for p in release_dir.iterdir()):
      with native_file.open("ab") as f:f.write(b"changed after authenticated inventory"*2048);f.flush();os.fsync(f.fileno())
      seen.set();return
     time.sleep(0.001)
   thread=threading.Thread(target=mutate);thread.start()
   try:
    p,r=run_install(args)
    expect(seen.is_set(),"actual mutation did not occur after authenticated staging began")
    expect(p.returncode==78 and r["outcome"]=="REFUSED" and not (destination/"current").exists(),"source growth escaped exact authenticated copy bounds")
    expect(not any((destination/"releases").glob(".staging-*")),"failed bounded copy retained partial stage")
   finally:stop.set();thread.join(timeout=5);native_file.write_bytes(original);native_file.chmod(0o755);shutil.rmtree(destination,ignore_errors=True)
  check("release.service.actual-post-verification-source-growth",changed_source_during_copy)
  def child_owned_destination():
   os.chown(service_root,33025,33025)
   try:
    p,r=run_install();expect(p.returncode==78 and r["outcome"]=="REFUSED","child-writable service root accepted")
   finally:os.chown(service_root,0,0)
  check("release.service.child-owned-destination-refused",child_owned_destination)
  shutil.rmtree(service_root)
  check("release.service.actual-release-tree-cleanup",lambda:expect(not service_root.exists(),"owned promoted service tree remained"))
  import socket
  database=fixture.database;runtime_role=fixture.runtime_role;port=fixture.port;private_root=fixture.path
  fixture.close()
  database_absent=not fixture.sql("SELECT datname FROM pg_database WHERE datname=$1",[database],admin=True)
  role_absent=not fixture.sql("SELECT rolname FROM pg_roles WHERE rolname=$1",[runtime_role],admin=True)
  with socket.socket() as sock:sock.settimeout(1);listener_absent=sock.connect_ex(("127.0.0.1",port))!=0
  cleanup_observed=database_absent and role_absent and listener_absent and not private_root.exists() and absent and not service_root.exists()
  check("release.cleanup.actual-absence",lambda:expect(cleanup_observed,"owned release fixture retained database/role/listener/private files"))
  (artifacts()/"cleanup.json").write_text(json.dumps({"observed_absent":cleanup_observed,"runtime_database_absent":database_absent,"runtime_role_absent":role_absent,"https_absent":listener_absent,"private_root_absent":not private_root.exists(),"migration_database_absent":absent,"service_tree_absent":not service_root.exists()}))
 check("release.cleanup.source-tree-absence",lambda:expect(not base.exists(),"owned source release fixture directory remained"))
 cleanup_file=artifacts()/"cleanup.json";cleanup_record=json.loads(cleanup_file.read_text());cleanup_record["source_fixture_absent"]=not base.exists();cleanup_record["observed_absent"]=cleanup_record["observed_absent"] and not base.exists();cleanup_file.write_text(json.dumps(cleanup_record))
 out=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-release-tests"))/"release";out.mkdir(parents=True,exist_ok=True)
 (out/"observations.json").write_text(json.dumps({"scope":"task-component","assertion_ids":IDS,"failed_ids":FAILED,"fixture":"real binaries/compiled modules with bounded dependency subset; not a deployable release","deployment_authorized":False}))
 return 1 if FAILED else 0
if __name__=="__main__":sys.exit(cleanup() if "--cleanup" in sys.argv else main())
