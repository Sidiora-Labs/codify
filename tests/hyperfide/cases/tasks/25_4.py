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
def main():
 with tempfile.TemporaryDirectory(prefix="hf-release-") as tmp:
  base=Path(tmp);payload=base/"payload";payload.mkdir()
  copies={"bin/hyperfide":ROOT/"cg","bin/cg":ROOT/"cg","runtime/node":Path(shutil.which("node")).resolve(),"runtime/python/bin/python3":Path(sys.executable).resolve(),"runtime/python/bin/python3.bin":Path(sys.executable).resolve(),"runtime/python/lib/python3.14/ctypes/__init__.py":Path(__import__("ctypes").__file__).resolve(),
   "services/package.json":ROOT/"services/hyperfide/package.json","services/package-lock.json":ROOT/"services/hyperfide/package-lock.json",
   "services/node_modules/pg/package.json":ROOT/"services/hyperfide/node_modules/pg/package.json"}
  for role in ["control","provisioner","dispatch"]:copies["services/dist/"+role+".js"]=ROOT/("services/hyperfide/dist/"+role+".js")
  libraries=subprocess.run(["ldd",str(ROOT/"cg")],capture_output=True,text=True,check=True).stdout
  library=next(Path(line.split("=>",1)[1].strip().split()[0]).resolve() for line in libraries.splitlines() if "libsqlite3" in line)
  copies["lib/hyperfide/"+library.name]=library
  for dest,source in copies.items():
   p=payload/dest;p.parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,p);p.chmod(0o755 if dest.startswith(("bin/","runtime/node","runtime/python/bin/")) else 0o644)
  files=[{"path":p.relative_to(payload).as_posix(),"digest":"sha256:"+hashlib.sha256(p.read_bytes()).hexdigest(),"size_bytes":str(p.stat().st_size),"mode":format(p.stat().st_mode&0o777,"04o")} for p in sorted(payload.rglob("*")) if p.is_file()]
  manifest={"schema_version":1,"release_version":"2.0.0-dev","source_commit":"a"*40,"source_date_epoch":"1","protocol_version":1,"schema_min":1,"schema_max":1,"runtime":{"node":"24.22.0","npm":"11.19.1","python":"3.14.8","platform":"linux","architecture":"x64"},"files":files}
  mf=payload/"manifest.json";mf.write_text(json.dumps(manifest))
  sys.path.insert(0,str(ROOT/'tests/hyperfide/support'))
  from identity_fixture import IdentityFixture
  fixture=IdentityFixture(extra_components=['25.4'],extra_env={'HYPERFIDE_RELEASE_ROOT':str(payload)})
  import atexit
  atexit.register(fixture.close)
  def request(action,value):
   status,result=fixture.invoke('release.'+action,value,component='25.4')
   return result
  def ok(action,value):
   r=request(action,value);expect(r.get("ok"),"positive service operation refused: "+r.get("error",{}).get("code",""));return r["result"]
  def rejected(action,value):
   r=request(action,value);expect(r.get("ok") is False and r["error"]["code"]=="RELEASE_INVALID","unsafe release accepted")
  check("release.bytes.inspect",lambda:expect(ok("inspect",{"manifest":"manifest.json"})["verified"] is True,"actual prebuilt pins did not verify"))
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
  fixture.close()
 out=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/domain25-release-tests"))/"release";out.mkdir(parents=True,exist_ok=True)
 (out/"observations.json").write_text(json.dumps({"scope":"task-component","assertion_ids":IDS,"failed_ids":FAILED,"fixture":"real binaries/compiled modules with bounded dependency subset; not a deployable release","deployment_authorized":False}))
 return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
