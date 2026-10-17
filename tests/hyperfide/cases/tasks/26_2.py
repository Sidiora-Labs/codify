#!/usr/bin/env python3
"""Construct a real nonpublished release and install its exact bytes into disposable prefixes."""
from pathlib import Path
import hashlib,json,os,shutil,subprocess,tempfile,sys,signal
ROOT=Path(__file__).resolve().parents[4];FAIL=[]
NODE=Path(subprocess.check_output(["node","-p","process.execPath"],cwd=ROOT,text=True).strip())
def expect(value):
 if not value:raise AssertionError("contract mismatch")
def check(name,fn):
 try:fn();actual="observed"
 except Exception as e:FAIL.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":"entrypoint."+name,"expected":"observed","actual":actual}),flush=True)
def run(*args,**kw):
 timeout=kw.pop("timeout",180);data=kw.pop("input",None)
 child=subprocess.Popen(args,text=True,stdin=subprocess.PIPE if data is not None else None,stdout=subprocess.PIPE,stderr=subprocess.PIPE,start_new_session=True,**kw)
 try:out,err=child.communicate(data,timeout=timeout)
 except subprocess.TimeoutExpired:
  try:os.killpg(child.pid,signal.SIGKILL)
  except ProcessLookupError:pass
  child.communicate();raise
 return subprocess.CompletedProcess(args,child.returncode,out,err)
def main():
 with tempfile.TemporaryDirectory(prefix="hf-release-probe-") as d:
  base=Path(d);release=base/"release";home=base/"home";home.mkdir()
  signing=base/"release-signing.pem";trusted=base/"release-signing.pub"
  expect(run("/usr/bin/openssl","genpkey","-algorithm","Ed25519","-out",str(signing)).returncode==0);signing.chmod(0o600)
  expect(run("/usr/bin/openssl","pkey","-in",str(signing),"-pubout","-out",str(trusted)).returncode==0);trusted.chmod(0o644)
  e=dict(os.environ,PATH=str(NODE.parent)+":"+os.environ["PATH"],HOME=str(home),HYPERFIDE_BUILD_PLACEMENT="remote",HYPERFIDE_RELEASE_SIGNING_KEY_FILE=str(signing))
  constructed=run("bash",str(ROOT/"scripts/release.sh"),"--output",str(release),"--skip-tests",cwd=ROOT,env=e,timeout=600)
  if constructed.returncode:
   sys.stderr.write(constructed.stdout[-2000:]+constructed.stderr[-2000:]);raise RuntimeError("actual nonpublishing construction failed")
  index=json.loads((release/"release.json").read_text());manifest=json.loads((release/"manifest.json").read_text())
  check("actual-nonpublishing-construction",lambda:expect(json.loads(constructed.stdout.splitlines()[-1])["published"] is False))
  files={x["path"]:x for x in manifest["files"]}
  check("same-linked-command-digests",lambda:expect(files["bin/cg"]["digest"]==files["bin/hyperfide"]["digest"]))
  check("actual-native-and-service-runtime-inventory",lambda:expect({"bin/hyperfide-native","runtime/node","runtime/python/bin/python3.bin","services/dist/control.js","services/dist/provisioner.js","services/dist/dispatch.js","services/package-lock.json"}<=files.keys() and any(x.startswith("services/node_modules/") for x in files) and any(x.startswith("lib/hyperfide/libcurl") for x in files)))
  check("actual-source-commit-pin",lambda:expect(manifest["source_commit"]==run("git","rev-parse","HEAD",cwd=ROOT).stdout.strip()))
  directory=base/"prefix/bin"
  install_env=dict(e,HYPERFIDE_BASE_URL=release.as_uri(),HYPERFIDE_MANIFEST_SHA256=index["manifest_digest"],HYPERFIDE_INSTALL_DIR=str(directory),HYPERFIDE_TRUSTED_RELEASE_KEY_FILE=str(trusted))
  def install(env=None):
   v=dict(install_env);v.update(env or {});return run("bash",str(ROOT/"scripts/install.sh"),env=v)
  first=install()
  check("actual-install-custom-prefix",lambda:expect(first.returncode==0 and json.loads(first.stdout)["commands"]==["hyperfide","cg"]))
  check("actual-ed25519-manifest-proof",lambda:expect(first.returncode==0 and json.loads(first.stdout)["authentication"]=={"mode":"ED25519","key_fingerprint":index["signature"]["key_fingerprint"]}))
  sig=release/"manifest.sig";saved_signature=sig.read_bytes();sig.write_bytes(bytes([saved_signature[0]^1])+saved_signature[1:])
  denied=install({"HYPERFIDE_INSTALL_DIR":str(base/"bad-signature/bin")})
  check("tampered-signature-denied-before-install",lambda:expect(denied.returncode!=0 and not(base/"bad-signature/bin").exists()))
  sig.write_bytes(saved_signature)
  wrong=base/"wrong-signing.pem";wrong_pub=base/"wrong-signing.pub"
  expect(run("/usr/bin/openssl","genpkey","-algorithm","Ed25519","-out",str(wrong)).returncode==0);wrong.chmod(0o600)
  expect(run("/usr/bin/openssl","pkey","-in",str(wrong),"-pubout","-out",str(wrong_pub)).returncode==0);wrong_pub.chmod(0o644)
  denied=install({"HYPERFIDE_INSTALL_DIR":str(base/"wrong-signer/bin"),"HYPERFIDE_TRUSTED_RELEASE_KEY_FILE":str(wrong_pub)})
  check("different-trusted-signer-denied",lambda:expect(denied.returncode!=0 and not(base/"wrong-signer/bin").exists()))
  denied=install({"HYPERFIDE_INSTALL_DIR":str(base/"no-trust/bin"),"HYPERFIDE_TRUSTED_RELEASE_KEY_FILE":"","HYPERFIDE_MANIFEST_SHA256":""})
  check("missing-trust-anchor-denied",lambda:expect(denied.returncode!=0 and not(base/"no-trust/bin").exists()))
  foreign=base/"foreign-key-parent";foreign.mkdir();foreign_key=foreign/"trusted.pub";shutil.copyfile(trusted,foreign_key);foreign_key.chmod(0o644);os.chown(foreign,63002,63002);foreign.chmod(0o755)
  denied=install({"HYPERFIDE_INSTALL_DIR":str(base/"foreign-trust/bin"),"HYPERFIDE_TRUSTED_RELEASE_KEY_FILE":str(foreign_key)})
  check("foreign-owned-trust-key-ancestor-denied",lambda:expect(denied.returncode!=0 and not(base/"foreign-trust/bin").exists()))
  alias=base/"key-parent-alias";alias.symlink_to(base,target_is_directory=True)
  denied=install({"HYPERFIDE_INSTALL_DIR":str(base/"symlink-trust/bin"),"HYPERFIDE_TRUSTED_RELEASE_KEY_FILE":str(alias/trusted.name)})
  check("symlink-trust-key-ancestor-denied",lambda:expect(denied.returncode!=0 and not(base/"symlink-trust/bin").exists()))
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
  check("bundled-python-leaves-immutable-runtime",lambda:expect(not any((current/"runtime/python").rglob("__pycache__"))))
  helper=run(str(current/"bin/hyperfide-native"),"--component","26.1","--action","branding.identity.describe",input="{}",env=e)
  check("bundled-native-helper-actually-executes",lambda:expect(helper.returncode==0 and json.loads(helper.stdout)["result"]["product"]=="Hyperfide"))
  linked=run("ldd",str(current/"bin/hyperfide"),env=e)
  loaded={line.split("=>",1)[0].strip():Path(line.split("=>",1)[1].strip().split()[0]).resolve() for line in linked.stdout.splitlines() if "=> /" in line}
  check("native-actually-loads-bundled-curl-and-crypto",lambda:expect(linked.returncode==0 and loaded.get("libcurl.so.4")==current/"lib/hyperfide/libcurl.so.4" and loaded.get("libcrypto.so.3")==current/"lib/hyperfide/libcrypto.so.3"))
  check("native-transitive-dependencies-use-bundled-bytes",lambda:expect(all(path==current/"lib/hyperfide"/name for name,path in loaded.items())))
  check("signed-proof-inspector-and-fixed-host-git-inventory",lambda:expect({"services/proof/inspect-proof.py","services/proof/check-evidence.py","services/proof/proof_relocation.py","services/proof/registry.json","services/proof/manifest.schema.json","runtime/git"}<=files.keys() and files['runtime/git']['digest']=='sha256:'+hashlib.sha256(Path('/usr/bin/git').read_bytes()).hexdigest()))
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
