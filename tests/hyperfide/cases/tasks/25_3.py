#!/usr/bin/env python3
"""Observe authority routing through the actual public binary; no live authority."""
import json,os,subprocess,tempfile,sys
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4];FAILED=[];IDS=[]
def expect(v,m):
 if not v:raise AssertionError(m)
def check(name,fn):
 IDS.append(name)
 try:fn();actual="observed"
 except Exception as e:FAILED.append(name);actual=type(e).__name__+": "+str(e)
 print(json.dumps({"type":"assertion","id":name,"expected":"observed","actual":actual}),flush=True)
def main():
 with tempfile.TemporaryDirectory(prefix="hf-client-") as tmp:
  base=Path(tmp);distributed=base/"distributed";distributed.mkdir();plain=base/"local";plain.mkdir();(distributed/".hyperfide").mkdir()
  marker=distributed/".hyperfide/authority.json"
  descriptor={"schema_version":1,"mode":"distributed","authority_epoch":"10000000-0000-0000-0000-000000000001"}
  marker.write_text(json.dumps(descriptor));marker.chmod(0o600)
  def run(args,root=plain,mode=None,config=None):
   e=os.environ.copy()
   for key in ["HYPERFIDE_MODE","HYPERFIDE_AUTHORITY_DESCRIPTOR","DATABASE_URL","ANTHROPIC_API_KEY","OPENAI_API_KEY"]:e.pop(key,None)
   if mode is not None:e["HYPERFIDE_MODE"]=mode
   if config is not None:e["HYPERFIDE_AUTHORITY_DESCRIPTOR"]=str(config)
   return subprocess.run([str(ROOT/"cg")]+args,cwd=root,env=e,capture_output=True,text=True,timeout=20)
  def blocked(args,code,root=distributed,mode=None,config=None):
   p=run(args,root,mode,config);expect(p.returncode==78,"operation reached legacy dispatch: "+str(args))
   r=json.loads(p.stderr.strip());expect(r["error"]["code"]==code and r["local_fallback"] is False,"wrong authority refusal")
   expect(not (root/".codegraph").exists(),"legacy state created before authority check")
  check("client.local.version",lambda:expect(run(["version"]).returncode==0,"local version requires remote credentials"))
  check("client.local.help",lambda:expect(run(["help"]).returncode==0,"local help requires remote credentials"))
  check("client.offline.local-version",lambda:expect(run(["version"],mode="offline").returncode==0,"offline local version unavailable"))
  check("client.offline.local-spec",lambda:expect(run(["spec","status"],mode="offline").returncode!=78,"explicit offline local scope blocked"))
  for command in [["init"],["spec","claim","1"],["spec","done","1","--force"],["spec","run"],["mcp"],["hook","post-edit"],["work","update"],["docs","close"],["projection"],["serve"],["fleet","up"]]:
   check("client.distributed."+command[0]+("-"+command[1] if len(command)>1 else ""),lambda command=command:blocked(command,"DISTRIBUTED_TRANSPORT_REQUIRED"))
  check("client.offline.remote-denied",lambda:blocked(["spec","claim","1"],"OFFLINE_AUTHORITY_UNAVAILABLE",mode="offline"))
  check("client.downgrade-denied",lambda:blocked(["spec","claim","1"],"AUTHORITY_MODE_INVALID",mode="local"))
  check("client.bad-mode",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID",root=plain,mode="unknown"))
  check("client.distributed-without-descriptor",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID",root=plain,mode="distributed"))
  check("client.explicit-root-denied",lambda:blocked(["spec","status","--root",str(distributed)],"DISTRIBUTED_TRANSPORT_REQUIRED",root=plain))
  check("client.explicit-descriptor",lambda:blocked(["init"],"DISTRIBUTED_TRANSPORT_REQUIRED",root=plain,config=marker))
  marker.chmod(0o644)
  check("client.public-descriptor-denied",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID"))
  marker.chmod(0o600);marker.write_text('{"schema_version":1,"mode":"distributed","mode":"local","authority_epoch":"10000000-0000-0000-0000-000000000001"}')
  check("client.duplicate-descriptor-denied",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID"))
  marker.unlink();marker.symlink_to(base/"private-marker");(base/"private-marker").write_text(json.dumps(descriptor));(base/"private-marker").chmod(0o600)
  check("client.symlink-descriptor-denied",lambda:blocked(["init"],"AUTHORITY_MODE_INVALID"))
 return 1 if FAILED else 0
if __name__=="__main__":sys.exit(main())
