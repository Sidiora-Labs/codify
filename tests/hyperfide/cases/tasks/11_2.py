#!/usr/bin/env python3
"""11.2: exact native Git bootstrap and bounded dependency execution."""
import copy,hashlib,json,os,signal,subprocess,sys,tempfile,time
from pathlib import Path
ROOT=Path(__file__).resolve().parents[4]
FAILED=[]
def expect(value,message):
    if not value:raise AssertionError(message)
def check(identity,callback):
    try:callback();actual="observed"
    except Exception as error:actual=type(error).__name__+": "+str(error);FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":"bootstrap."+identity,"expected":"observed","actual":actual}),flush=True)
def git(root,*args):
    result=subprocess.run(["git","-C",str(root),"-c","maintenance.auto=false","-c","gc.auto=0",*args],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True)
    return result.stdout.strip()
class Fixture:
    def __init__(self,base):
        self.base=base;self.sources=base/"sources";self.workspaces=base/"workspaces"
        self.sources.mkdir();self.workspaces.mkdir();self.cache=base/"cache";self.cache.mkdir()
        self.repositories=[]
        for name in ["alpha","beta"]:
            p=self.sources/name;p.mkdir();git(p,"init","-q");git(p,"config","user.name","Fixture");git(p,"config","user.email","fixture@example.invalid")
            (p/"lock.json").write_text('{"locked":"1.0.0"}\n');git(p,"add","lock.json");git(p,"commit","-qm","fixture")
            self.repositories.append({"id":name,"url":str(p),"commit":git(p,"rev-parse","HEAD"),"submodules":[],"lfs":False})
        self.request={"schema_version":1,"workspace":"slot-fixture","profile_digest":"sha256:"+"a"*64,
          "preparation_digest":"sha256:"+"b"*64,"boot_id":"boot-fixture","repositories":self.repositories,
          "toolchain_digest":"sha256:"+"c"*64,"configuration_digest":"sha256:"+"d"*64,
          "lock_inputs":[{"repository":r["id"],"path":"lock.json","digest":"sha256:"+hashlib.sha256((self.sources/r["id"]/"lock.json").read_bytes()).hexdigest()} for r in self.repositories],
          "commands":[],"cache_paths":[],"cache_scope":"fixture-scope"}
        self.env=os.environ.copy();self.env.update(HF_EXECUTION_HOST_CLASS="remote",
          HF_BOOTSTRAP_SOURCE_ROOT=str(self.sources),HF_PREPARATION_WORKSPACE_ROOT=str(self.workspaces),HF_PREPARATION_CACHE_ROOT=str(self.cache))
    def invoke(self,request=None,raw=None):
        result=subprocess.run([str(ROOT/"build/hyperfide-native"),"--component","11.2","--action","bootstrap.materialize"],
          input=raw or json.dumps(request or self.request),text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
          cwd=ROOT,env=self.env,timeout=30)
        rows=[json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        expect(len(rows)==1,"missing single native response")
        return rows[0],result
    def materialize(self):
        row,result=self.invoke();expect(result.returncode==0 and row.get("ok") and row["result"]["state"]=="MATERIALIZED","valid bootstrap refused: "+json.dumps(row))
        return row["result"]
    def refused(self):
        row,result=self.invoke()
        expect(not row.get("ok") or row.get("result",{}).get("state")=="FAILED","unsafe bootstrap accepted")
        name=self.request["workspace"]
        target=name if Path(name).name==name and name not in {".",".."} else "slot-fixture"
        expect(not (self.workspaces/target).exists(),"failed preparation published final workspace")
def main():
    with tempfile.TemporaryDirectory(prefix="hf-bootstrap-") as directory:
        base=Path(directory)
        def case(identity,callback):
            def run():
                with tempfile.TemporaryDirectory(dir=base) as path:callback(Fixture(Path(path)))
            check(identity,run)
        def exact(f):
            receipt=f.materialize()
            expect(receipt["authority_granted"] is False,"materialisation granted authority")
            expect(receipt["boot_id"]=="boot-fixture" and receipt["preparation_digest"]==f.request["preparation_digest"],"boot/profile binding lost")
            for repo in f.repositories:
                path=f.workspaces/"slot-fixture"/repo["id"]
                expect(git(path,"rev-parse","HEAD")==repo["commit"],"source differs from pinned commit")
        case("source.exact-multi-repository",exact)
        def partial_download(f):
            # alpha transfers completely; beta's pack is cut mid-object, as an interrupted transfer leaves it
            beta=f.sources/"beta";(beta/"payload.bin").write_bytes(os.urandom(1<<20));git(beta,"add","payload.bin");git(beta,"commit","-qm","payload")
            f.repositories[1]["commit"]=git(beta,"rev-parse","HEAD");git(beta,"gc","-q","--prune=now")
            packs=list((beta/".git/objects/pack").glob("*.pack"));expect(len(packs)==1 and not [p for p in (beta/".git/objects").glob("??/*")],"fixture objects not packed")
            packs[0].chmod(0o644)
            with open(packs[0],"r+b") as pack:pack.truncate(pack.seek(0,2)//2)
            f.request["cache_paths"]=[{"repository":"alpha","path":"dependency.bin"}]
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c","printf cached > dependency.bin"],"timeout_seconds":5}]
            row,result=f.invoke()
            expect(result.returncode==0 and row.get("ok") and row["result"]["state"]=="FAILED" and row["result"]["reason"]=="SOURCE_FETCH_FAILED","partial download not refused: "+json.dumps(row))
            expect(row["result"]["authority_granted"] is False and "cache_key" not in row["result"],"partial download published a receipt")
            expect([p.name for p in f.workspaces.iterdir()]==[row["result"]["quarantine_workspace"]],"partial download left more than the quarantine workspace")
            expect(not (f.workspaces/"slot-fixture").exists(),"partial download published final workspace")
            expect(not [p for p in f.cache.rglob("*")],"partial download published a cache entry")
        case("source.partial-download",partial_download)

        def submodule(f,nested=False):
            child=f.sources/"child";child.mkdir();git(child,"init","-q");git(child,"config","user.name","Fixture");git(child,"config","user.email","fixture@example.invalid")
            (child/"child.txt").write_text("actual submodule\n");git(child,"add",".");git(child,"commit","-qm","child")
            child_commit=git(child,"rev-parse","HEAD")
            alpha=f.sources/"alpha";git(alpha,"-c","protocol.file.allow=always","submodule","add","-q",str(child),"modules/child")
            git(alpha,"commit","-qam","pin child");f.repositories[0]["commit"]=git(alpha,"rev-parse","HEAD")
            f.repositories[0]["submodules"]=[{"path":"modules/child","commit":child_commit}]
            return child,child_commit
        def module_exact(f):
            _,commit=submodule(f);f.materialize()
            expect(git(f.workspaces/"slot-fixture/alpha/modules/child","rev-parse","HEAD")==commit,"submodule pin not materialized")
        case("submodule.actual-pinned-materialization",module_exact)
        def module_wrong(f):
            submodule(f);f.repositories[0]["submodules"][0]["commit"]="1"*40;f.refused()
        case("submodule.mismatched-pin",module_wrong)
        def module_missing(f):
            submodule(f);f.repositories[0]["submodules"]=[];f.refused()
        case("submodule.undeclared-module",module_missing)
        def module_outside(f):
            submodule(f);git(f.sources/"alpha","config","--file",".gitmodules","submodule.modules/child.url","/etc")
            git(f.sources/"alpha","commit","-qam","unsafe url");f.repositories[0]["commit"]=git(f.sources/"alpha","rev-parse","HEAD");f.refused()
        case("submodule.unapproved-source",module_outside)
        def module_nested(f):
            child,_=submodule(f);leaf=f.sources/"leaf";leaf.mkdir();git(leaf,"init","-q");git(leaf,"config","user.name","Fixture");git(leaf,"config","user.email","fixture@example.invalid")
            (leaf/"leaf.txt").write_text("nested\n");git(leaf,"add",".");git(leaf,"commit","-qm","leaf");leaf_commit=git(leaf,"rev-parse","HEAD")
            git(child,"-c","protocol.file.allow=always","submodule","add","-q",str(leaf),"nested/leaf");git(child,"commit","-qam","pin leaf");child_commit=git(child,"rev-parse","HEAD")
            alpha=f.sources/"alpha";git(alpha/"modules/child","fetch","origin");git(alpha/"modules/child","checkout","-q",child_commit);git(alpha,"add","modules/child");git(alpha,"commit","-qm","refresh child")
            f.repositories[0]["commit"]=git(alpha,"rev-parse","HEAD");f.repositories[0]["submodules"]=[{"path":"modules/child","commit":child_commit},{"path":"modules/child/nested/leaf","commit":leaf_commit}]
            f.materialize();expect(git(f.workspaces/"slot-fixture/alpha/modules/child/nested/leaf","rev-parse","HEAD")==leaf_commit,"nested submodule pin omitted")
        case("submodule.nested-pinned-graph",module_nested)

        def lfs(f,corrupt=False):
            alpha=f.sources/"alpha";git(alpha,"lfs","install","--local")
            git(alpha,"lfs","track","*.bin");payload=b"actual-lfs-object\n"*65536;(alpha/"asset.bin").write_bytes(payload)
            git(alpha,"add",".gitattributes","asset.bin");git(alpha,"commit","-qm","pinned LFS object");f.repositories[0]["commit"]=git(alpha,"rev-parse","HEAD");f.repositories[0]["lfs"]=True
            if corrupt:
                for obj in (alpha/".git/lfs/objects").rglob("*"):
                    if obj.is_file():obj.write_bytes(b"corrupt")
                f.refused()
            else:
                f.materialize();expect((f.workspaces/"slot-fixture/alpha/asset.bin").read_bytes()==payload,"LFS pointer was not hydrated into exact object bytes")
        case("lfs.actual-object-materialization",lfs)
        case("lfs.corrupt-object-denied",lambda f:lfs(f,True))


        def install(f):
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c","printf installed > dependency.bin"],"timeout_seconds":5}]
            f.materialize();expect((f.workspaces/"slot-fixture/alpha/dependency.bin").read_bytes()==b"installed","dependency command did not execute")
        case("dependency.actual-command",install)
        def large_artifact(f):
            f.request["commands"]=[{"repository":"alpha","argv":["/usr/bin/truncate","-s","33554432","large-artifact.bin"],"timeout_seconds":5}]
            f.materialize();expect((f.workspaces/"slot-fixture/alpha/large-artifact.bin").stat().st_size==33554432,"diagnostic bound prevented legitimate artifact file")
        case("dependency.large-artifact-file",large_artifact)
        def large_diagnostic(f):
            f.request["commands"]=[{"repository":"alpha","argv":["/usr/bin/head","-c","20000000","/dev/zero"],"timeout_seconds":5}]
            f.refused();expect(all(p.stat().st_size<=16777216 for p in f.workspaces.glob(".preparing-*/log-*")),"unbounded diagnostic capture")
        case("dependency.bounded-diagnostic-pipe",large_diagnostic)
        def arguments(f):
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c","test \"$1\" = ''\nprintf multiline > argument.bin","argv0",""],"timeout_seconds":5}]
            f.materialize();expect((f.workspaces/"slot-fixture/alpha/argument.bin").read_bytes()==b"multiline","empty/multiline arguments were not preserved")
        case("dependency.empty-and-multiline-arguments",arguments)
        def failing(f):
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c","printf failure >&2; exit 23"],"timeout_seconds":5}]
            f.refused();expect(list(f.workspaces.glob(".preparing-*/log-*")),"failed command diagnostics absent")
        case("dependency.nonzero-quarantine",failing)
        def mutation(f):
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c","printf mutated > lock.json"],"timeout_seconds":5}];f.refused()
        case("source.dependency-hook-mutation",mutation)
        def index_bypass(f):
            source=f.sources/"alpha";(source/"unlocked.txt").write_text("original\n");git(source,"add","unlocked.txt");git(source,"commit","-qm","extra source");f.repositories[0]["commit"]=git(source,"rev-parse","HEAD")
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c","git update-index --assume-unchanged unlocked.txt; printf tampered > unlocked.txt"],"timeout_seconds":5}]
            f.refused()
        case("source.index-flag-mutation",index_bypass)
        def timeout(f):
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c","sleep 10 & wait"],"timeout_seconds":1}]
            start=time.monotonic();f.refused();expect(time.monotonic()-start<5,"command deadline not enforced")
        case("dependency.timeout",timeout)
        for identity,mutation in {
          "input.workspace-traversal":lambda f:f.request.update(workspace="../outside"),
          "input.workspace-absolute":lambda f:f.request.update(workspace="/tmp/outside"),
          "input.unknown-field":lambda f:f.request.update(approved=True),
          "input.boolean-schema":lambda f:f.request.update(schema_version=True),
          "input.duplicate-repository":lambda f:f.repositories.append(copy.deepcopy(f.repositories[0])),
          "input.invalid-commit":lambda f:f.repositories[0].update(commit="main"),
          "input.missing-commit":lambda f:f.repositories[0].update(commit="0"*40),
          "input.stale-lock":lambda f:f.request["lock_inputs"][0].update(digest="sha256:"+"0"*64),
          "input.host-supervisory":lambda f:f.env.update(HF_EXECUTION_HOST_CLASS="main"),
          "input.missing-root":lambda f:f.env.pop("HF_PREPARATION_WORKSPACE_ROOT"),
          "input.outside-source":lambda f:f.repositories[0].update(url="/etc"),
        }.items():
            case(identity,lambda f,m=mutation:(m(f),f.refused()))
        def configure_cache(f):
            f.request["cache_paths"]=[{"repository":"alpha","path":"dependency.bin"}]
            f.request["commands"]=[{"repository":"alpha","argv":["/bin/sh","-c",
              "test -f dependency.bin || printf cached > dependency.bin; printf verified > verification.txt"],"timeout_seconds":5}]
        def cached(f):
            configure_cache(f);first=f.materialize();expect(first["cache_restored"] is False,"cold cache claimed hit")
            f.request["workspace"]="slot-next";second=f.materialize()
            expect(second["cache_restored"] is True and second["cache_key"]==first["cache_key"],"exact cache failed reuse")
            expect((f.workspaces/"slot-next/alpha/dependency.bin").read_bytes()==b"cached","cache bytes not restored")
            expect((f.workspaces/"slot-next/alpha/verification.txt").read_bytes()==b"verified","cache bypassed real dependency verification")
        case("cache.actual-restore-and-command",cached)
        def invalidate(f):
            configure_cache(f);first=f.materialize();f.request["workspace"]="slot-next"
            f.request["configuration_digest"]="sha256:"+"e"*64;second=f.materialize()
            expect(second["cache_key"]!=first["cache_key"] and second["cache_restored"] is False,"changed configuration reused cache")
        case("cache.configuration-invalidation",invalidate)
        def corrupt(f):
            configure_cache(f);first=f.materialize()
            (f.cache/"fixture-scope"/first["cache_key"][7:]/"alpha/dependency.bin").write_bytes(b"tampered")
            f.request["workspace"]="slot-next";f.refused()
        case("cache.payload-corruption",corrupt)
        def tracked(f):
            f.request["cache_paths"]=[{"repository":"alpha","path":"lock.json"}];f.refused()
        case("cache.tracked-source-denied",tracked)
        def missing_cache(f):
            f.request["cache_paths"]=[{"repository":"alpha","path":"missing"}];f.refused()
        case("cache.missing-payload",missing_cache)
        def cache_secret(f):
            f.request["cache_paths"]=[{"repository":"alpha","path":".npmrc"}];f.refused()
        case("cache.credential-path-denied",cache_secret)
        def duplicate(f):
            raw=json.dumps(f.request)[:-1]+',"schema_\\u0076ersion":1}'
            row,result=f.invoke(raw=raw);expect(result.returncode!=0 and not row.get("ok"),"escaped duplicate key accepted")
        case("input.escaped-duplicate",duplicate)
        def existing(f):
            (f.workspaces/"slot-fixture").mkdir();marker=f.workspaces/"slot-fixture/preserve";marker.write_text("existing")
            row,_=f.invoke();expect(not row.get("ok") and marker.read_text()=="existing","existing workspace overwritten")
        case("workspace.no-overwrite",existing)
        def symlink(f):
            alternate=f.base/"alternate";alternate.mkdir();f.workspaces.rmdir();f.workspaces.symlink_to(alternate,target_is_directory=True);f.refused()
        case("workspace.symlink-root",symlink)
    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return int(bool(FAILED))
if __name__=="__main__":sys.exit(main())
