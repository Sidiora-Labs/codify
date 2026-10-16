#!/usr/bin/env python3
"""Real JSONL component checks; partial-journal fixture is explicitly simulated."""
from pathlib import Path
import json,os,subprocess,tempfile,sys,copy
ROOT=Path(__file__).resolve().parents[4];FAILED=[];IDS=[]
ACTIONS=["migration.names."+x for x in ["plan","apply","rollback","aliases"]]
POLICY={"schema_version":1,"programme_id":"names-fixture","repository":"fixture/repo","spec_revision":"fixture-r1","policy_revision":1,"status":"ACTIVE","approval":{"decision":"APPROVED","record_id":"authorized-fixture","spec_revision":"fixture-r1","policy_revision":1},"allowed_roles":["control"],"allowed_actions":["programme.activate"]+ACTIONS}
def expect(v):
 if not v:raise AssertionError("contract mismatch")
def check(name,fn):
 IDS.append("names."+name)
 try:fn();actual="observed"
 except Exception as e:FAILED.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":"names."+name,"expected":"observed","actual":actual}),flush=True)
class Fixture:
 def __init__(self,p):
  self.base=p;self.w=p/"allowed/repo";self.w.mkdir(parents=True)
  self.policy=p/"policy.json";self.policy.write_text(json.dumps(POLICY));self.components=p/"components";self.components.mkdir()
  (self.components/"26.3.json").write_bytes((ROOT/"services/hyperfide/components/26.3.json").read_bytes())
  (self.w/"codify.kvx").write_text("# user customisation\n[sync]\nauto = false\n");(self.w/".codify").mkdir();(self.w/".codify/agent-context.md").write_text("User-owned context.\n")
  for n in [".codex",".claude",".codegraph"]:
   (self.w/n).mkdir();(self.w/n/"native-state").write_bytes(b"PRIVATE-NATIVE-STATE")
  self.id="12345678-1234-1234-1234-123456789abc"
 def call(self,a,v,env=None):
  e=dict(os.environ,HF_MIGRATION_ALLOWED_ROOT=str(self.w.parent));e.update(env or {})
  p=subprocess.run(["node",str(ROOT/"services/hyperfide/dist/control.js"),"--policy",str(self.policy),"--spec-revision","fixture-r1","--components",str(self.components),"--module-root",str(ROOT/"services/hyperfide/dist")],input=json.dumps({"id":"probe","component":"26.3","action":"migration.names."+a,"input":v})+"\n",text=True,capture_output=True,cwd=ROOT,env=e,timeout=15)
  expect(len(p.stdout.splitlines())==1);r=json.loads(p.stdout);expect(r["id"]=="probe");return p,r
 def ok(self,a,v,env=None):
  p,r=self.call(a,v,env);expect(p.returncode==0 and r["ok"]);return r["result"]
 def reject(self,a,v,code,env=None):
  p,r=self.call(a,v,env);expect(p.returncode!=0 and not r["ok"] and r["error"]["code"]==code);return p
 def plan(self):return self.ok("plan",{"workspace":"repo","migration_id":self.id})
 def apply(self,m):return self.ok("apply",{"workspace":"repo","manifest":m})
 def rollback(self,m):return self.ok("rollback",{"workspace":"repo","manifest":m})
def native(f,*args):
 return subprocess.run([str(ROOT/"cg"),"config",*args],cwd=f.w,text=True,capture_output=True,timeout=15)
def main():
 with tempfile.TemporaryDirectory(prefix="hf-names-") as d:
  f=Fixture(Path(d));m=f.plan();original=(f.w/"codify.kvx").read_bytes()
  def native_conflict(canonical,legacy):
   p=subprocess.run([str(ROOT/"hyperfide"),"config","get","sync.auto"],cwd=f.w,text=True,capture_output=True,env=dict(os.environ,**{canonical:"PRIVATE-CANARY-ONE",legacy:"PRIVATE-CANARY-TWO"}))
   expect(p.returncode==78 and "PRIVATE-CANARY" not in p.stdout+p.stderr)
  check("native.authority-alias-conflict-redacted",lambda:native_conflict("HYPERFIDE_AUTHORITY_URL","CG_AUTHORITY_URL"))
  check("native.credential-alias-conflict-redacted",lambda:native_conflict("HYPERFIDE_CREDENTIAL_FILE","CG_CREDENTIAL_FILE"))
  check("native.transport-alias-conflict-redacted",lambda:native_conflict("HYPERFIDE_TRANSPORT_CONFIG","CG_TRANSPORT_CONFIG"))
  check("native.mcp-policy-alias-conflict-redacted",lambda:native_conflict("HYPERFIDE_MCP_TOOL_POLICY_FILE","CG_MCP_TOOL_POLICY_FILE"))
  p=subprocess.run([str(ROOT/"hyperfide"),"config","get","sync.auto"],cwd=f.w,text=True,capture_output=True,env=dict(os.environ,HYPERFIDE_CREDENTIAL_FILE="PRIVATE-EQUAL",CG_CREDENTIAL_FILE="PRIVATE-EQUAL"))
  check("native.equal-credential-alias-compatible",lambda:expect(p.returncode==0 and p.stdout.strip()=="false" and "PRIVATE-EQUAL" not in p.stderr+p.stdout))
  check("native.legacy-config-fallback",lambda:expect(native(f,"get","sync.auto").stdout.strip()=="false"))
  check("plan.real-pins",lambda:expect(len(m["files"])==2 and m["files"][0]["from"]=="codify.kvx"))
  check("plan.retained-native-paths",lambda:expect(len(m["retained_paths"])==4 and all(x["policy"]=="PRESERVE_IN_PLACE" for x in m["retained_paths"])))
  check("plan.no-mutation",lambda:expect(not(f.w/"hyperfide.kvx").exists()))
  for name,w in [("traversal","../repo"),("absolute",str(f.w)),("backslash","repo\\outside")]:
   check("plan.reject-"+name,lambda w=w:f.reject("plan",{"workspace":w,"migration_id":f.id},"INVALID_PATH"))
  check("plan.reject-extra-fields",lambda:f.reject("plan",{"workspace":"repo","migration_id":f.id,"root":"forged"},"INVALID_REQUEST"))
  for name,mutate in [("digest",lambda x:x.update(digest="sha256:"+"0"*64)),("auth-path",lambda x:x["files"][0].update(to=".codex/auth.json")),("duplicate",lambda x:x["files"].append(x["files"][0]))]:
   bad=copy.deepcopy(m);mutate(bad)
   check("manifest.reject-"+name,lambda bad=bad:f.reject("apply",{"workspace":"repo","manifest":bad},"INVALID_MANIFEST"))
  secret="UNPUBLISHED-NAMES-CANARY"
  def conflict():
   p=f.reject("aliases",{},"ALIAS_CONFLICT",{"HYPERFIDE_CREDENTIAL_FILE":secret,"CG_CREDENTIAL_FILE":"other"})
   expect(secret not in p.stdout+p.stderr and "other" not in p.stdout+p.stderr)
  check("aliases.conflict-secret-redacted",conflict)
  def equal():
   p,r=f.call("aliases",{},{"HYPERFIDE_CREDENTIAL_FILE":secret,"CG_CREDENTIAL_FILE":secret})
   expect(p.returncode==0 and r["result"]["values_redacted"] and secret not in p.stdout+p.stderr)
  check("aliases.equal-secret-redacted",equal)
  check("apply.real-copy",lambda:expect(f.apply(m)["state"]=="APPLIED" and(f.w/"hyperfide.kvx").read_bytes()==original))
  check("native.completed-manifest-selection",lambda:expect(json.loads(native(f,"list","--json").stdout)["file"].endswith("/hyperfide.kvx")))
  import shutil
  journal=f.w/f".hyperfide/migrations/{f.id}/state.json";saved_journal=journal.read_bytes();journal.unlink()
  check("native.portable-manifest-without-private-journal",lambda:expect(json.loads(native(f,"list","--json").stdout)["file"].endswith("/hyperfide.kvx")))
  journal.write_bytes(saved_journal)
  check("native.canonical-context-default",lambda:expect(native(f,"get","paths.context").stdout.strip()==".hyperfide/context"))
  check("apply.legacy-preserved",lambda:expect((f.w/"codify.kvx").read_bytes()==original))
  check("apply.context-preserved",lambda:expect((f.w/".hyperfide/context/agent-context.md").read_bytes()==(f.w/".codify/agent-context.md").read_bytes()))
  backup=f.w/f".hyperfide/migrations/{f.id}/backups/0.bin"
  check("apply.private-backup",lambda:expect(backup.read_bytes()==original and backup.stat().st_mode&0o777==0o600))
  check("apply.durable-descriptor",lambda:expect(json.loads((f.w/".hyperfide/names.json").read_text())["manifest_digest"]==m["digest"]))
  check("apply.idempotent-replay",lambda:expect(f.apply(m)["state"]=="APPLIED"))
  check("apply.native-state-untouched",lambda:expect(all((f.w/n/"native-state").read_bytes()==b"PRIVATE-NATIVE-STATE" for n in [".codex",".claude",".codegraph"])))
  (f.w/"hyperfide.kvx").write_text("custom canonical content")
  check("rollback.reject-user-loss",lambda:f.reject("rollback",{"workspace":"repo","manifest":m},"NAME_CONFLICT"))
  (f.w/"hyperfide.kvx").write_bytes(original)
  check("rollback.real-copies",lambda:expect(f.rollback(m)["state"]=="ROLLED_BACK" and not(f.w/"hyperfide.kvx").exists() and not(f.w/".hyperfide/names.json").exists()))
  check("rollback.preserve-backup-source",lambda:expect(backup.exists() and(f.w/"codify.kvx").read_bytes()==original))
  check("rollback.reject-old-id",lambda:f.reject("apply",{"workspace":"repo","manifest":m},"MIGRATION_CONFLICT"))
 with tempfile.TemporaryDirectory(prefix="hf-names-partial-") as d:
  f=Fixture(Path(d));m=f.plan();p=f.w/f".hyperfide/migrations/{f.id}";(p/"backups").mkdir(parents=True)
  (p/"manifest.json").write_text(json.dumps(m));(p/"state.json").write_text(json.dumps({"state":"APPLYING","manifest_digest":m["digest"]}));(p/"backups/0.bin").write_bytes((f.w/"codify.kvx").read_bytes());(f.w/"hyperfide.kvx").write_bytes((f.w/"codify.kvx").read_bytes())
  check("recovery.partial-journal-fixture",lambda:expect(f.apply(m)["state"]=="APPLIED" and(f.w/".hyperfide/context/agent-context.md").exists()))
 with tempfile.TemporaryDirectory(prefix="hf-names-symlink-") as d:
  f=Fixture(Path(d));m=f.plan();(f.w/"codify.kvx").unlink();(f.w/"codify.kvx").symlink_to(f.w/".codex/native-state")
  check("filesystem.reject-symlink",lambda:f.reject("apply",{"workspace":"repo","manifest":m},"MIGRATION_FILESYSTEM_ERROR"))
 with tempfile.TemporaryDirectory(prefix="hf-names-both-") as d:
  f=Fixture(Path(d));(f.w/"hyperfide.kvx").write_text("canonical")
  check("native.both-configs-fail-closed",lambda:expect(native(f,"list","--json").returncode==2))
  check("plan.reject-both-configs",lambda:f.reject("plan",{"workspace":"repo","migration_id":f.id},"NAME_CONFLICT"))
 with tempfile.TemporaryDirectory(prefix="hf-names-drift-") as d:
  f=Fixture(Path(d));m=f.plan();(f.w/"codify.kvx").write_text("changed")
  check("apply.reject-drift",lambda:f.reject("apply",{"workspace":"repo","manifest":m},"MIGRATION_INPUT_CHANGED"))
 with tempfile.TemporaryDirectory(prefix="hf-names-lock-") as d:
  f=Fixture(Path(d));m=f.plan();p=f.w/".hyperfide/migrations";p.mkdir(parents=True)
  holder=subprocess.Popen(["/usr/bin/flock","-x",str(p/"names.lock"),"/bin/sh","-c","printf ready; cat >/dev/null"],stdin=subprocess.PIPE,stdout=subprocess.PIPE);expect(holder.stdout.read(5)==b"ready")
  try:check("apply.kernel-lock-exclusion",lambda:f.reject("apply",{"workspace":"repo","manifest":m},"MIGRATION_BUSY"))
  finally:holder.stdin.close();expect(holder.wait(timeout=5)==0)
  check("apply.kernel-lock-release",lambda:expect(f.apply(m)["state"]=="APPLIED"))
 expect(not Path(d).exists())
 print(json.dumps({"type":"cleanup","complete":True,"resources":[]}))
 return bool(FAILED)
if __name__=="__main__":
 if "--cleanup" in sys.argv:print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));sys.exit(0)
 sys.exit(main())
