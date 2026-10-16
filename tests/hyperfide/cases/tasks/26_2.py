#!/usr/bin/env python3
"""Construct a real nonpublished release and install its exact bytes into disposable prefixes."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tempfile,sys
ROOT=Path(__file__).resolve().parents[4];FAIL=[]
NODE=Path(subprocess.check_output(["node","-p","process.execPath"],cwd=ROOT,text=True).strip())
def expect(value):
 if not value:raise AssertionError("contract mismatch")
def check(name,fn):
 try:fn();actual="observed"
 except Exception as e:FAIL.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":"entrypoint."+name,"expected":"observed","actual":actual}),flush=True)
def run(*args,**kw):return subprocess.run(args,text=True,capture_output=True,timeout=180,**kw)
def main():
 with tempfile.TemporaryDirectory(prefix="hf-release-probe-") as d:
  base=Path(d);release=base/"release";home=base/"home";home.mkdir()
  e=dict(os.environ,PATH=str(NODE.parent)+":"+os.environ["PATH"],HOME=str(home),HYPERFIDE_BUILD_PLACEMENT="remote")
  constructed=run("bash",str(ROOT/"scripts/release.sh"),"--output",str(release),"--skip-tests",cwd=ROOT,env=e)
  if constructed.returncode:
   sys.stderr.write(constructed.stdout[-2000:]+constructed.stderr[-2000:]);raise RuntimeError("actual nonpublishing construction failed")
  index=json.loads((release/"release.json").read_text());manifest=json.loads((release/"manifest.json").read_text())
  check("actual-nonpublishing-construction",lambda:expect(json.loads(constructed.stdout.splitlines()[-1])["published"] is False))
  files={x["path"]:x for x in manifest["files"]}
  check("same-linked-command-digests",lambda:expect(files["bin/cg"]["digest"]==files["bin/hyperfide"]["digest"]))
  check("actual-native-and-service-runtime-inventory",lambda:expect({"bin/hyperfide-native","runtime/node","runtime/python/bin/python3.bin","services/dist/control.js","services/dist/provisioner.js","services/dist/dispatch.js","services/package-lock.json"}<=files.keys() and any(x.startswith("services/node_modules/") for x in files) and any(x.startswith("lib/hyperfide/libcurl") for x in files)))
  check("actual-source-commit-pin",lambda:expect(manifest["source_commit"]==run("git","rev-parse","HEAD",cwd=ROOT).stdout.strip()))
  directory=base/"prefix/bin"
  install_env=dict(e,HYPERFIDE_BASE_URL=release.as_uri(),HYPERFIDE_MANIFEST_SHA256=index["manifest_digest"],HYPERFIDE_INSTALL_DIR=str(directory))
  def install(env=None):
   v=dict(install_env);v.update(env or {});return run("bash",str(ROOT/"scripts/install.sh"),env=v)
  first=install()
  check("actual-install-custom-prefix",lambda:expect(first.returncode==0 and json.loads(first.stdout)["commands"]==["hyperfide","cg"]))
  def command(name,*args):return run(str(directory/name),*args,cwd=base,env=e)
  check("installed-canonical-version",lambda:expect(command("hyperfide","--version").stdout.strip()=="2.0.0-dev"))
  check("installed-legacy-version-parity",lambda:expect(command("cg","--version").stdout==command("hyperfide","--version").stdout))
  check("installed-help-argument-parity",lambda:expect(command("cg","help","config","--json").stdout==command("hyperfide","help","config","--json").stdout))
  a=command("cg","nonexistent-command","--json");b=command("hyperfide","nonexistent-command","--json")
  check("installed-error-exit-json-parity",lambda:expect(a.returncode==b.returncode!=0 and a.stdout==b.stdout and a.stderr==b.stderr))
  check("idempotent-install",lambda:expect(install().returncode==0))
  state=directory.parent/"lib/hyperfide";current=(state/"current").resolve()
  node=run(str(current/"runtime/node"),"--version",env=dict(e,LD_LIBRARY_PATH=str(current/"lib/hyperfide")))
  check("bundled-runtime-actually-executes",lambda:expect(node.returncode==0 and node.stdout.strip()=="v24.22.0"))
  python=current/"runtime/python/bin/python3"
  probe="import ctypes,os,sys; v=ctypes.c_int(); c=ctypes.CDLL(None); assert sys.version_info[:3]==(3,14,8); assert os.path.realpath(sys.base_prefix)==os.path.realpath(sys.argv[1]); assert c.prctl(36,1,0,0,0)==0; assert c.prctl(37,ctypes.byref(v),0,0,0)==0 and v.value==1; assert os.access('/proc/self/task/'+str(os.getpid())+'/children',os.R_OK); p=os.fork(); os._exit(0) if p==0 else None; assert os.waitpid(p,0)[0]==p"
  observed=run(str(python),"-I","-c",probe,str(current/"runtime/python"),env=dict(e,PYTHONHOME=str(current/"runtime/python"),LD_LIBRARY_PATH=str(current/"lib/hyperfide")))
  check("bundled-python-actual-subreaper-procfs-waitpid",lambda:expect(observed.returncode==0))
  unknown=base/"unknown/bin";unknown.mkdir(parents=True);(unknown/"hyperfide").write_bytes(b"USER-OWNED-COMMAND")
  check("refuses-unowned-executable",lambda:expect(install({"HYPERFIDE_INSTALL_DIR":str(unknown)}).returncode!=0 and(unknown/"hyperfide").read_bytes()==b"USER-OWNED-COMMAND"))
  legacy=base/"legacy/bin";legacy.mkdir(parents=True);shutil.copy2(ROOT/"cg",legacy/"cg");legacy_hash=hashlib.sha256((legacy/"cg").read_bytes()).hexdigest()
  migrated=install({"HYPERFIDE_INSTALL_DIR":str(legacy),"HYPERFIDE_LEGACY_CG_SHA256":legacy_hash})
  legacy_backup=legacy.parent/"lib/hyperfide/backups"/legacy_hash/"cg"
  check("explicit-legacy-adoption-byte-backup",lambda:expect(migrated.returncode==0 and legacy_backup.read_bytes()==(ROOT/"cg").read_bytes()))
  removed_legacy=run("bash",str(ROOT/"scripts/uninstall.sh"),env=dict(install_env,HYPERFIDE_INSTALL_DIR=str(legacy)))
  check("legacy-backup-survives-owned-uninstall",lambda:expect(removed_legacy.returncode==0 and legacy_backup.exists()))
  conflict=install({"CODIFY_INSTALL_DIR":"PRIVATE-CONFLICT-PREFIX"})
  check("refuses-conflicting-prefix-alias",lambda:expect(conflict.returncode!=0 and "PRIVATE-CONFLICT-PREFIX" not in conflict.stdout+conflict.stderr))
  check("refuses-wrong-manifest-pin",lambda:expect(install({"HYPERFIDE_MANIFEST_SHA256":"sha256:"+"0"*64}).returncode!=0))
  hostile=base/"hostile/bin";hostile.mkdir(parents=True);(hostile.parent/"lib").symlink_to(base/"unowned-state",target_is_directory=True)
  check("refuses-state-directory-symlink",lambda:expect(install({"HYPERFIDE_INSTALL_DIR":str(hostile)}).returncode!=0 and not(base/"unowned-state").exists()))
  shimdir=base/"shim";shimdir.mkdir();shutil.copy2(ROOT/"scripts/hyperfide-entrypoint.sh",shimdir/"cg");(shimdir/"cg").chmod(0o755);shutil.copy2(ROOT/"hyperfide",shimdir/"hyperfide")
  check("compat-shim-actual-sibling-only",lambda:expect(run(str(shimdir/"cg"),"--version",env=e).stdout.strip()=="2.0.0-dev"))
  (shimdir/"hyperfide").unlink()
  check("compat-shim-refuses-path-fallback",lambda:expect(run(str(shimdir/"cg"),"--version",env=dict(e,PATH=str(ROOT)+":"+e["PATH"])).returncode!=0))
  os.link(shimdir/"cg",shimdir/"hyperfide")
  check("compat-shim-rejects-self-recursion",lambda:expect(run(str(shimdir/"cg"),"--version",env=e).returncode!=0))
  sentinel=home/".codex";sentinel.mkdir();(sentinel/"native-state").write_bytes(b"NATIVE-AUTH-PRESERVED")
  # An owner edit makes uninstall refuse the whole removal before touching the peer command.
  saved=os.readlink(directory/"cg");(directory/"cg").unlink();(directory/"cg").write_bytes(b"USER-REPLACEMENT")
  denied=run("bash",str(ROOT/"scripts/uninstall.sh"),env=install_env)
  check("uninstall-refuses-owner-edited-command",lambda:expect(denied.returncode!=0 and(directory/"hyperfide").is_symlink() and(directory/"cg").read_bytes()==b"USER-REPLACEMENT"))
  (directory/"cg").unlink();(directory/"cg").symlink_to(saved)
  removed=run("bash",str(ROOT/"scripts/uninstall.sh"),env=install_env)
  check("actual-owned-uninstall-both-names",lambda:expect(removed.returncode==0 and not(directory/"hyperfide").exists() and not(directory/"cg").exists() and not current.exists()))
  check("uninstall-native-auth-preserved",lambda:expect((sentinel/"native-state").read_bytes()==b"NATIVE-AUTH-PRESERVED"))
 print(json.dumps({"type":"cleanup","complete":True,"resources":[]}))
 return 1 if FAIL else 0
if __name__=="__main__":sys.exit(main())
