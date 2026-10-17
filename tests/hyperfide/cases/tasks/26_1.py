#!/usr/bin/env python3
"""Task26.1: compiled Hyperfide identity and compatibility inventory."""
from pathlib import Path
import json,subprocess,sys
ROOT=Path(__file__).resolve().parents[4]
FAILED=[]
IDS=[]
def check(identity, fn):
 IDS.append(identity)
 try:
  assert fn()
  actual="observed"
 except Exception as e:
  FAILED.append(identity);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def invoke(action,payload=None):
 p=subprocess.run([str(ROOT/"build/hyperfide-native"),"--component","26.1","--action",action],
 input=json.dumps({} if payload is None else payload),text=True,capture_output=True,timeout=10)
 return p,json.loads(p.stdout)
def result(action):
 p,r=invoke(action);assert p.returncode==0 and r["ok"] is True
 return r["result"]
def main():
 identity=result("branding.identity.describe");inventory=result("branding.compatibility.inventory")
 editor=json.loads((ROOT/"editors/vscode/package.json").read_text())
 check("branding.native.product",lambda:identity["product"]=="Hyperfide")
 check("branding.native.development-version",lambda:identity["version"]=="2.0.0-dev" and identity["release_status"]=="development")
 check("branding.native.canonical-command",lambda:identity["canonical_command"]=="hyperfide")
 check("branding.native.legacy-command",lambda:identity["compatibility_commands"]==["cg"])
 check("branding.native.protocol-distinct",lambda:identity["native_protocol_version"]==1)
 check("branding.inventory.history",lambda:inventory["historical_product"]=="Codify" and {"feature IDs","task IDs","commit tags","Git object IDs","provider native IDs"}<=set(inventory["preserved"]))
 check("branding.inventory.namespace",lambda:inventory["namespace_ownership"]=="not_assumed")
 check("branding.inventory.compatibility-window",lambda:inventory["compatibility_removal"]=="explicit_future_release")
 check("branding.inventory.config-aliases",lambda:inventory["legacy_config"]=="codify.kvx" and inventory["canonical_config"]=="hyperfide.kvx")
 check("branding.inventory.resource-aliases",lambda:inventory["legacy_resource_scheme"]=="codify://" and inventory["canonical_resource_scheme"]=="hyperfide://")
 check("branding.native.reject-unknown-action",lambda:invoke("branding.unsupported")[0].returncode!=0)
 check("branding.native.reject-unknown-input",lambda:invoke("branding.identity.describe",{"product":"forged"})[0].returncode!=0)
 check("branding.native.reject-array-input",lambda:invoke("branding.identity.describe",[])[0].returncode!=0)
 check("branding.editor.display",lambda:editor["displayName"]=="Hyperfide Workflow" and "hyperfide" in editor["keywords"])
 check("branding.editor.preserve-package",lambda:editor["name"]=="codify-workflow" and editor["publisher"]=="SidioraLabs")
 check("branding.editor.preserve-command-identities",lambda:all(x["command"].startswith("codify.") for x in editor["contributes"]["commands"]))
 check("branding.editor.display-command-titles",lambda:all(x["title"].startswith("Hyperfide:") for x in editor["contributes"]["commands"]))
 check("branding.installer.display",lambda:(lambda p:p.returncode==0 and p.stdout.startswith("Hyperfide installer:") and "hyperfide (canonical)" in p.stdout)(subprocess.run(["bash",str(ROOT/"scripts/install.sh"),"--help"],text=True,capture_output=True,timeout=10,stdin=subprocess.DEVNULL)))
 print(json.dumps({"type":"cleanup","complete":True,"resources":[]}),flush=True)
 return bool(FAILED)
if __name__=="__main__":
 if "--cleanup" in sys.argv:
  print(json.dumps({"type":"cleanup","complete":True,"resources":[]}));sys.exit(0)
 sys.exit(main())
