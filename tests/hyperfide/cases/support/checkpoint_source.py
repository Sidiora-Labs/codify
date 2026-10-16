#!/usr/bin/env python3
"""Byte-level lower11 checkpoint validation against the actual native15 materializer.
This probe grants no preparation/readiness or authenticated service qualification.
"""
from __future__ import annotations
import argparse,base64,copy,hashlib,importlib.util,json,os,shutil,stat,struct,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
FAILURES=[];OBS=[];IDS=[]
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module);return module
def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()
def digest(data):return "sha256:"+hashlib.sha256(data).hexdigest()
def expect(value,detail):
 if not value:raise AssertionError(detail)
def check(identity,fn):
 IDS.append(identity)
 try:fn();actual="observed"
 except Exception as error:FAILURES.append(identity);actual=type(error).__name__+": "+str(error)
 print(json.dumps(dict(type="assertion",id=identity,expected="observed",actual=actual)),flush=True)
NODE=r"""import fs from 'node:fs';import {validateRestoredCheckpoint} from './services/hyperfide/dist/preparation/checkpoint.js';
const v=JSON.parse(fs.readFileSync(0,'utf8'));v.capsule=Buffer.from(v.capsule_base64,'base64');delete v.capsule_base64;
const abort=v.abort;delete v.abort;if(abort){const c=new AbortController();c.abort();v.signal=c.signal;}
try{const result=await validateRestoredCheckpoint(v);process.stdout.write(JSON.stringify({ok:true,result}));}
catch(error){process.stdout.write(JSON.stringify({ok:false,code:error.message}));}"""
class Fixture:
 def __init__(self,base,native_root):
  self.base=base;self.counter=0;self.native=load("checkpoint_source_native",native_root/"tests/hyperfide/cases/tasks/15_1.py")
  seed=base/"source";seed.mkdir();self.f=self.native.Fixture(seed)
  preparation=load("checkpoint_source_parent",ROOT/"tests/hyperfide/cases/tasks/11_1.py")
  parent=preparation.Fixture(base/"parent");self.profile=copy.deepcopy(parent.profile)
  self.profile["repositories"][0]["id"]="fixture";self.profile["repositories"][0]["commit"]=self.f.head
  for name in ("recipe.sh","package-lock.json","evidence.json"):
   shutil.copyfile(parent.candidate/name,self.f.repo/name)
  (self.f.repo/"config.json").write_bytes(b'{"mode":"baseline"}\n')
  (self.f.repo/"generated.txt").write_bytes(b"baseline generated\n")
  (self.f.repo/"unicode-\u00e9.txt").write_bytes(b"utf8 filename\n")
  for group in [self.profile["package_managers"][0]["locks"],self.profile["preparation_evidence"],[self.profile["recipe"]]]:
   for pin in group:pin["path"]="fixture/"+pin["path"]
  self.profile["build_config"]=[{"path":"fixture/config.json","digest":digest(b'{"mode":"baseline"}\n')}]
  self.profile["generated_inputs"]=[{"path":"fixture/generated.txt","digest":digest(b"baseline generated\n")}]
  self.native.git(self.f.repo,"add","package-lock.json")
  (self.f.repo/"package-lock.json").write_bytes(b'{"lockfileVersion":3,"dirty":true}\n')
  (self.f.repo/"config.json").write_bytes(b'{"mode":"dirty"}\n')
  # Explicit removed and outside-repository role inputs remain visible, never baseline substitutes.
  self.profile["generated_inputs"].append({"path":"fixture/removed-generated.txt","digest":digest(b"absent")})
  self.profile["preparation_evidence"].append({"path":"other/evidence.json","digest":digest(b"outside")})
  self.f.capture=self.native.invoke("checkpoint.capture",self.f.request,self.f.env)
  expect(self.f.capture.get("capture_state")=="LOCAL_COMPLETE","Actual recapture refused")
  self.f.digest=self.f.capture["checkpoint_digest"];self.f.object=self.f.spool/(self.f.digest[7:]+".hfc")
  self.bytes=self.f.object.read_bytes();self.f.bytes=self.bytes
  self.f.inspect=self.native.invoke("checkpoint.inspect",{"checkpoint_digest":self.f.digest},self.f.env)
  self.expected=dict(checkpoint_digest=self.f.digest,source_metadata_digest=self.f.capture["manifest_digest"],
   source_repository_id=self.f.request["repository_id"],source_workspace_id=self.f.request["workspace_id"],
   source_object_id=self.f.head,source_preparation_digest=self.f.request["preparation_digest"])
  # Build the approved parent inventory from real bytes through the actual11 scanner.
  prepared=parent.candidate/"fixture";prepared.mkdir()
  for child in list(parent.candidate.iterdir()):
   if child!=prepared:shutil.move(str(child),prepared/child.name)
  (prepared/"config.json").write_bytes(b'{"mode":"baseline"}\n')
  (prepared/"generated.txt").write_bytes(b"baseline generated\n")
  (prepared/"removed-generated.txt").write_bytes(b"absent")
  (parent.candidate/"other").mkdir();(parent.candidate/"other"/"evidence.json").write_bytes(b"outside")
  scan="import fs from 'node:fs';import {createManifest} from './services/hyperfide/dist/preparation/manifests.js';const v=JSON.parse(fs.readFileSync(0,'utf8'));const m=await createManifest({candidate_path:'candidate',profile:v.profile,scan_policy:{secret_canaries:[],identity_canaries:[],lease_canaries:[]}},{env:{HF_PREPARATION_ALLOWED_ROOT:v.allowed},signal:new AbortController().signal});process.stdout.write(JSON.stringify(m));"
  made=subprocess.run(["node","--input-type=module","-e",scan],cwd=ROOT,input=json.dumps({"profile":self.profile,"allowed":str(parent.allowed)}),text=True,capture_output=True,timeout=30)
  expect(made.returncode==0,"Actual parent scanner failed: "+made.stderr[-1000:]);self.manifest=json.loads(made.stdout);self.expected["parent_preparation_digest"]=self.manifest["digest"]
  self.scratch=base/"validation-scratch";self.scratch.mkdir(mode=0o700)
 def restore(self):
  self.counter+=1;name="validated-"+str(self.counter)
  value=self.f.restore(dict(checkpoint_digest=self.f.digest,candidate_path=name,repository_id=self.f.request["repository_id"],preparation_digest=self.f.request["preparation_digest"]))
  return self.f.allowed/name,value
 def call(self,workspace,_native_result,**changes):
  request=dict(capsule_base64=base64.b64encode(self.bytes).decode(),expected=self.expected,native_result=_native_result,
   workspace_path=str(workspace),scratch_root=str(self.scratch),parent_manifest=self.manifest,repository_key="fixture")
  request.update(changes)
  p=subprocess.run(["node","--input-type=module","-e",NODE],cwd=ROOT,input=json.dumps(request),text=True,capture_output=True,timeout=40)
  expect(p.returncode==0,"Actual helper process failed: "+p.stderr[-1000:]);value=json.loads(p.stdout)
  OBS.append({"ok":value["ok"],"code":value.get("code"),"source_state_digest":value.get("result",{}).get("source_state_digest")})
  return value
 def valid(self):
  workspace,native_result=self.restore();value=self.call(workspace,native_result);expect(value["ok"],"Valid native restore rejected: "+str(value));return workspace,native_result,value["result"]
 def rejects(self,mutation,code=None):
  workspace,native_result=self.restore();mutation(workspace);value=self.call(workspace,native_result);expect(not value["ok"],"Changed restored bytes were accepted")
  if code:expect(value["code"]==code,"Expected "+code+" got "+str(value))
 def direct_negative(self,**changes):
  workspace,native_result=self.restore();value=self.call(workspace,native_result,**changes);expect(not value["ok"],"Invalid custody input accepted");return value
def run(native_root,out):
 out.mkdir(parents=True,exist_ok=True)
 with tempfile.TemporaryDirectory(prefix="hf-checkpoint-validator-",dir="/tmp/hyperfide") as folder:
  base=Path(folder);f=Fixture(base,native_root);state={}
  def valid():
   workspace,native_result,result=f.valid();state.update(workspace=workspace,native_result=native_result,result=result)
   expect(result["status"]=="RESTORED_SOURCE_ONLY" and result["authority"]=="NONE" and result["readiness_granted"] is False,"Byte proof granted authority")
   expect(result["installed_toolchain_verified"] is False and result["quiescence_verified"] is False and result["native_context_restored"] is False,"Unobserved runtime proof invented")
  check("checkpoint-source.real-native-restored-bytes",valid)
  def overlays():
   r=state["result"]
   expect(r["head_tree_id"]!=r["index_tree_id"],"Staged tree relabelled as HEAD")
   expect("tracked.bin" in r["staged_paths"] and "tracked.bin" in r["unstaged_paths"] and "untracked.bin" in r["untracked_paths"],"Staged/unstaged/untracked inventory reduced")
   expect("unicode-\u00e9.txt" in r["untracked_paths"],"UTF8 filename lost")
   expect(r["overlay_digest"]!=r["checkpoint_digest"] and r["source_state_digest"]!=r["source_metadata_digest"],"Distinct identity roles collapsed")
  check("checkpoint-source.distinct-overlay-index-head-and-capsule",overlays)
  def measured():
   r=state["result"];lock=r["role_inputs"]["locks"][0]["files"][0]
   expect(lock["state"]=="CHANGED" and lock["digest"]==digest((f.f.repo/"package-lock.json").read_bytes()),"Actual dirty lock bytes replaced by baseline")
   expect(r["role_inputs"]["build_config"][0]["state"]=="CHANGED","Dirty config change hidden")
   expect(r["role_inputs"]["generated_inputs"][1]["state"]=="REMOVED" and r["role_inputs"]["generated_inputs"][1]["digest"] is None,"Removed input relabelled")
   expect(r["role_inputs"]["preparation_evidence"][1]["state"]=="OUTSIDE_RESTORED_REPOSITORY","Outside input fabricated")
   expect(not any(key in r for key in ("dependency_digest","toolchain_digest","configuration_digest")),"Unqualified semantic aggregate invented")
  check("checkpoint-source.actual-role-preimages-with-missing-states",measured)
  check("checkpoint-source.reject-worktree-content-change",lambda:f.rejects(lambda w:(w/"tracked.bin").write_bytes(b"tampered"),"CHECKPOINT_WORKTREE_MISMATCH"))
  check("checkpoint-source.reject-untracked-content-change",lambda:f.rejects(lambda w:(w/"untracked.bin").write_bytes(b"tampered"),"CHECKPOINT_WORKTREE_MISMATCH"))
  check("checkpoint-source.reject-staged-index-change",lambda:f.rejects(lambda w:f.native.git(w,"add","tracked.bin"),"CHECKPOINT_INDEX_MISMATCH"))
  check("checkpoint-source.reject-permission-change",lambda:f.rejects(lambda w:(w/"mode.sh").chmod(0o644),"CHECKPOINT_WORKTREE_MISMATCH"))
  def symlink(w):(w/"link").unlink();(w/"link").symlink_to("untracked.bin")
  check("checkpoint-source.reject-symlink-target-change",lambda:f.rejects(symlink,"CHECKPOINT_WORKTREE_MISMATCH"))
  check("checkpoint-source.reject-directory-mode-change",lambda:f.rejects(lambda w:(w/"empty").chmod(0o755),"CHECKPOINT_WORKTREE_MISMATCH"))
  check("checkpoint-source.reject-missing-file",lambda:f.rejects(lambda w:(w/"tracked.bin").unlink(),"CHECKPOINT_WORKTREE_MISMATCH"))
  check("checkpoint-source.reject-extra-ignored-file",lambda:f.rejects(lambda w:(w/".env").write_bytes(b"extra"),"CHECKPOINT_WORKTREE_MISMATCH"))
  def hardlink(w):os.link(w/"tracked.bin",w/"extra-link")
  check("checkpoint-source.reject-hardlink-alias",lambda:f.rejects(hardlink,"CHECKPOINT_ENTRY_UNSUPPORTED"))
  check("checkpoint-source.reject-capsule-byte-change",lambda:f.direct_negative(capsule_base64=base64.b64encode(f.bytes[:-1]+bytes([f.bytes[-1]^1])).decode()))
  check("checkpoint-source.reject-metadata-custody-change",lambda:f.direct_negative(expected=dict(f.expected,source_metadata_digest=digest(b"wrong"))))
  check("checkpoint-source.reject-source-workspace-mismatch",lambda:f.direct_negative(expected=dict(f.expected,source_workspace_id="11111111-1111-4111-8111-111111111111")))
  check("checkpoint-source.reject-source-commit-mismatch",lambda:f.direct_negative(expected=dict(f.expected,source_object_id="b"*40)))
  def invalid_header():
   data=bytearray(f.bytes);data[8:16]=(2**64-1).to_bytes(8,"big");f.direct_negative(capsule_base64=base64.b64encode(data).decode(),expected=dict(f.expected,checkpoint_digest=digest(data)))
  check("checkpoint-source.reject-header-size-overflow",invalid_header)
  check("checkpoint-source.reject-native-context-claim",lambda:f.direct_negative(native_result=dict(state["native_result"],native_context="RESTORED")))
  check("checkpoint-source.reject-preaborted-validation",lambda:f.direct_negative(abort=True))
  def unchanged():
   w=state["workspace"];before=(w/".git"/"index").read_bytes();value=f.call(w,state["native_result"])
   expect(value["ok"] and (w/".git"/"index").read_bytes()==before,"Validator mutated restored index")
   expect(not list(f.scratch.iterdir()),"Temporary index/object measurement leaked")
  check("checkpoint-source.no-index-write-or-scratch-leak",unchanged)
  def no_monitor():
   w,native_result=f.restore();marker=base/"fsmonitor-executed";hook=base/"fsmonitor-hook"
   hook.write_text("#!/bin/sh\nprintf invoked > '"+str(marker)+"'\n");hook.chmod(0o700)
   f.native.git(w,"config","core.fsmonitor",str(hook))
   value=f.call(w,native_result)
   expect(value["ok"] and not marker.exists(),"Git config executed an external monitor during byte validation")
  check("checkpoint-source.no-git-fsmonitor-execution",no_monitor)
  check("checkpoint-source.reject-unbound-target-parent",lambda:f.direct_negative(expected=dict(f.expected,parent_preparation_digest=digest(b"another-approved-parent"))))
  check("checkpoint-source.reject-local-fsck-exemption",lambda:f.rejects(lambda w:f.native.git(w,"config","fsck.skipList","/dev/null"),"CHECKPOINT_GIT_CONFIG_UNSUPPORTED"))
  def include(w):
   config=base/"external-config";config.write_text("[fsck]\n skipList = /dev/null\n");f.native.git(w,"config","include.path",str(config))
  check("checkpoint-source.reject-local-config-include",lambda:f.rejects(include,"CHECKPOINT_GIT_CONFIG_UNSUPPORTED"))
  check("checkpoint-source.reject-local-promisor",lambda:f.rejects(lambda w:f.native.git(w,"config","remote.fixture.promisor","true"),"CHECKPOINT_GIT_CONFIG_UNSUPPORTED"))
  check("checkpoint-source.reject-external-object-alternates",lambda:f.rejects(lambda w:(w/".git"/"objects"/"info"/"alternates").write_text(str(base)+"\n"),"CHECKPOINT_GIT_METADATA_UNSUPPORTED"))
  (out/"observations.json").write_bytes(canonical(dict(scope="LOWER_BYTE_HELPER_ONLY",assertion_count=len(IDS),failures=FAILURES,observations=OBS,source_status="RESTORED_SOURCE_ONLY",authority="NONE",native_source_commit="c46892cb84657f250cc7b165e5724d2275400099",parent_manifest=f.manifest,baseline=state.get("result")))+b"\n")
 base_absent=not base.exists();(out/"cleanup.json").write_bytes(canonical({"owned_root_absent":base_absent})+b"\n")
 expect(base_absent,"Owned fixture root remains")
 return 1 if FAILURES else 0
if __name__=="__main__":
 parser=argparse.ArgumentParser();parser.add_argument("--native-root",type=Path,default=ROOT);parser.add_argument("--output-dir",type=Path,default=Path("/tmp/hyperfide/checkpoint-source-probe"));args=parser.parse_args();raise SystemExit(run(args.native_root,args.output_dir))
