#!/usr/bin/env python3
"""Task15.1: actual linked native capture and supervisor-owned durable artifact roundtrip.

Native-only development mode is explicitly incomplete; the registered qualifier
always runs the actual15.2 publication/read pipeline after prerequisite integration.
"""
from __future__ import annotations
import base64
import hashlib
import fcntl
import threading
import importlib.util
import json
import os
from pathlib import Path
import shutil
import stat
import struct
import subprocess
import sys
import tempfile
import uuid

ROOT=Path(__file__).resolve().parents[4]
IDS=[]
FAILED=[]
DIGEST=lambda b:"sha256:"+hashlib.sha256(b).hexdigest()
def expect(value,message="observed assertion failed"):
    if not value: raise AssertionError(message)
def check(identity,callback):
    IDS.append(identity)
    try:
        callback()
        actual="observed"
    except Exception as error:
        FAILED.append(identity)
        actual=type(error).__name__+": "+str(error)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)
def git(repo,*args):
    p=subprocess.run(["git","-C",str(repo),*args],capture_output=True,check=True)
    return p.stdout
def invoke(action,request,env=None,raw=None):
    p=subprocess.run([str(ROOT/"build/hyperfide-native"),"--component","15.1","--action",action],
                     input=raw if raw is not None else json.dumps(request),text=True,capture_output=True,
                     env=env,timeout=30)
    expect(p.returncode==0,"native dispatcher failed: "+p.stdout+p.stderr)
    result=json.loads(p.stdout)
    expect(result["ok"] is True,"native dispatcher did not invoke component")
    return result["result"]
class Fixture:
    def __init__(self,base):
        self.base=base
        self.allowed=base/"allowed";self.allowed.mkdir()
        self.spool=base/"spool";self.spool.mkdir(mode=0o700)
        self.repo=self.allowed/"repo";self.repo.mkdir(mode=0o750)
        git(self.repo,"init","-b","attempt")
        git(self.repo,"config","user.email","checkpoint-fixture@example.invalid")
        git(self.repo,"config","user.name","Checkpoint fixture")
        git(self.repo,"config","credential.helper","!printf GIT-CONFIG-CANARY-NOT-FOR-CHECKPOINT")
        (self.repo/"tracked.bin").write_bytes(bytes(range(256)))
        (self.repo/"deleted.txt").write_bytes(b"delete me\n")
        (self.repo/"staged-delete.txt").write_bytes(b"staged deletion\n")
        (self.repo/"mode.sh").write_bytes(b"#!/bin/sh\n")
        (self.repo/".gitignore").write_text("ignored/\n.env\n")
        git(self.repo,"add",".");git(self.repo,"commit","-m","base")
        self.head=git(self.repo,"rev-parse","HEAD").decode().strip()
        (self.repo/"tracked.bin").write_bytes(b"staged\x00"+bytes(range(256)))
        git(self.repo,"add","tracked.bin")
        self.staged=git(self.repo,"show",":tracked.bin")
        (self.repo/"tracked.bin").write_bytes(b"unstaged\x00"+bytes(range(255,-1,-1)))
        (self.repo/"deleted.txt").unlink()
        git(self.repo,"rm","staged-delete.txt")
        (self.repo/"mode.sh").chmod(0o751)
        (self.repo/"untracked.bin").write_bytes(os.urandom(500000))
        (self.repo/"untracked.bin").chmod(0o640)
        (self.repo/"empty").mkdir(mode=0o710)
        (self.repo/"nested").mkdir(mode=0o750)
        (self.repo/"nested"/"file").write_bytes(b"nested\x00data")
        (self.repo/"nested"/"file").chmod(0o600)
        (self.repo/"link").symlink_to("tracked.bin")
        (self.repo/"ignored").mkdir()
        (self.repo/"ignored"/"credential").write_text("IGNORED-SECRET-CANARY")
        (self.repo/".env").write_text("ENV-SECRET-CANARY")
        self.request={k:str(uuid.uuid4()) for k in ("organisation_id","run_id","repository_id","task_id","attempt_id","workspace_id")}
        self.request.update(candidate_path="repo",base_commit=self.head,branch_ref="refs/heads/attempt",
            preparation_digest="sha256:"+"1"*64,dependency_digest="sha256:"+"2"*64,
            summary_digest="sha256:"+"3"*64,findings_digest="sha256:"+"4"*64,
            instruction_cursor="27",native_support="RECORDED",native_session_ref=str(uuid.uuid4()))
        self.env=dict(os.environ,HF_CHECKPOINT_ALLOWED_ROOT=str(self.allowed),HF_CHECKPOINT_SPOOL_ROOT=str(self.spool))
        # Native must work with no service credentials or authority role.
        for key in list(self.env):
            if "DATABASE" in key or key.startswith(("PG","HF_ARTIFACT","HYPERFIDE_PG")):
                self.env.pop(key,None)
        self.capture=invoke("checkpoint.capture",self.request,self.env)
        expect(self.capture.get("capture_state")=="LOCAL_COMPLETE","fixture capture refused: "+str(self.capture))
        self.digest=self.capture["checkpoint_digest"]
        self.object=self.spool/(self.digest[7:]+".hfc")
        self.bytes=self.object.read_bytes()
        self.inspect=invoke("checkpoint.inspect",{"checkpoint_digest":self.digest},self.env)
        self.restore_request={"checkpoint_digest":self.digest,"candidate_path":"restored",
            "repository_id":self.request["repository_id"],"preparation_digest":self.request["preparation_digest"]}
    def refuse(self,action,request,code=None,env=None,raw=None):
        value=invoke(action,request,self.env if env is None else env,raw=raw)
        expect(value.get("capture_state")=="REFUSED",str(value))
        expect(value.get("authority")=="NONE",str(value))
        if code: expect(value["code"]==code,str(value))
        return value
    def capture_refused(self,mutate,code=None):
        mutate()
        before={p.name for p in self.spool.iterdir()}
        self.refuse("checkpoint.capture",self.request,code)
        expect({p.name for p in self.spool.iterdir()}==before,"failed capture published partial data")
    def restore(self,request=None):
        value=invoke("checkpoint.restore",request or self.restore_request,self.env)
        expect(value.get("capture_state")=="LOCAL_RESTORED",str(value))
        return value
    def chunks(self):
        out=[]
        for offset in range(0,len(self.bytes),196608):
            size=min(196608,len(self.bytes)-offset)
            value=invoke("checkpoint.export",{"checkpoint_digest":self.digest,"offset":str(offset),"length":str(size)},self.env)
            expect(value["offset"]==str(offset) and value["size_bytes"]==str(len(self.bytes)))
            out.append(base64.b64decode(value["data_base64"],validate=True))
        return out
    def capsule_variant(self,mutator):
        b=bytearray(self.bytes);mutator(b);digest=DIGEST(b);(self.spool/(digest[7:]+".hfc")).write_bytes(b)
        req=dict(self.restore_request,checkpoint_digest=digest)
        return req
def native_suite(f):
    check("checkpoint.capture.actual-native-dispatch",lambda:expect(f.capture["capture_state"]=="LOCAL_COMPLETE"))
    check("checkpoint.capture.no-authority",lambda:expect(f.capture["authority"]=="NONE" and f.capture["durability"]=="UNCONFIRMED"))
    check("checkpoint.identity.actual-capsule-digest",lambda:expect(DIGEST(f.bytes)==f.digest))
    check("checkpoint.identity.manifest-bound",lambda:expect(f.inspect["manifest_digest"]==f.capture["manifest_digest"]))
    check("checkpoint.identity.repository",lambda:expect(f.inspect["manifest"]["repository_id"]==f.request["repository_id"]))
    check("checkpoint.identity.source-head-base",lambda:expect(f.inspect["manifest"]["head_commit"]==f.head and f.inspect["manifest"]["base_commit"]==f.head))
    check("checkpoint.identity.environment-inputs",lambda:expect(all(f.inspect["manifest"][k]==f.request[k] for k in ("preparation_digest","dependency_digest"))))
    check("checkpoint.identity.recovery-packet",lambda:expect(all(f.inspect["manifest"][k]==f.request[k] for k in ("summary_digest","findings_digest","instruction_cursor","native_session_ref","native_support"))))
    check("checkpoint.privacy.git-config",lambda:expect(b"GIT-CONFIG-CANARY" not in f.bytes))
    check("checkpoint.privacy.ignored-credentials",lambda:expect(b"IGNORED-SECRET-CANARY" not in f.bytes and b"ENV-SECRET-CANARY" not in f.bytes))
    check("checkpoint.privacy.runtime-location",lambda:expect(str(f.base).encode() not in f.bytes))
    check("checkpoint.scope.ignored-explicit",lambda:expect(f.inspect["manifest"]["ignored_disposition"]=="EXCLUDED_NOT_RECOVERED"))
    check("checkpoint.consistency.claim-bounded",lambda:expect(f.inspect["manifest"]["consistency"]=="STABLE_SCAN_REQUIRES_SUPERVISOR_QUIESCENCE"))
    check("checkpoint.export.actual-byte-roundtrip",lambda:expect(b"".join(f.chunks())==f.bytes))
    check("checkpoint.export.offset-refused",lambda:f.refuse("checkpoint.export",{"checkpoint_digest":f.digest,"offset":"01","length":"10"},"INVALID_RANGE"))
    check("checkpoint.export.bounds-refused",lambda:f.refuse("checkpoint.export",{"checkpoint_digest":f.digest,"offset":"0","length":"196609"},"INVALID_RANGE"))
    check("checkpoint.export.end-refused",lambda:f.refuse("checkpoint.export",{"checkpoint_digest":f.digest,"offset":str(len(f.bytes)),"length":"1"},"INVALID_RANGE"))
    check("checkpoint.restore.actual-process",f.restore)
    restored=f.allowed/"restored"
    check("checkpoint.restore.binary-worktree",lambda:expect((restored/"tracked.bin").read_bytes()==(f.repo/"tracked.bin").read_bytes()))
    check("checkpoint.restore.binary-staging",lambda:expect(git(restored,"show",":tracked.bin")==f.staged))
    check("checkpoint.restore.untracked-bytes",lambda:expect((restored/"untracked.bin").read_bytes()==(f.repo/"untracked.bin").read_bytes()))
    check("checkpoint.restore.file-modes",lambda:expect(stat.S_IMODE((restored/"mode.sh").stat().st_mode)==0o751 and stat.S_IMODE((restored/"untracked.bin").stat().st_mode)==0o640))
    check("checkpoint.restore.directory-modes",lambda:expect(stat.S_IMODE((restored/"empty").stat().st_mode)==0o710 and stat.S_IMODE(restored.stat().st_mode)==0o750))
    check("checkpoint.restore.empty-directory",lambda:expect((restored/"empty").is_dir() and not list((restored/"empty").iterdir())))
    check("checkpoint.restore.nested-paths",lambda:expect((restored/"nested/file").read_bytes()==b"nested\x00data"))
    check("checkpoint.restore.safe-symlink",lambda:expect((restored/"link").is_symlink() and os.readlink(restored/"link")=="tracked.bin"))
    check("checkpoint.restore.unstaged-deletion",lambda:expect(not (restored/"deleted.txt").exists() and b"deleted.txt" in git(restored,"ls-files","-z")))
    check("checkpoint.restore.staged-deletion",lambda:expect(not (restored/"staged-delete.txt").exists() and b"staged-delete.txt" not in git(restored,"ls-files","-z")))
    check("checkpoint.restore.git-status-equivalence",lambda:expect(git(restored,"status","--porcelain","-z")==git(f.repo,"status","--porcelain","-z")))
    check("checkpoint.restore.no-session-revival",lambda:expect(invoke("checkpoint.inspect",{"checkpoint_digest":f.digest},f.env)["manifest"]["authority"]=="NONE"))
    check("checkpoint.restore.existing-destination",lambda:f.refuse("checkpoint.restore",f.restore_request,"RESTORE_DESTINATION_EXISTS"))
    check("checkpoint.restore.wrong-repository",lambda:f.refuse("checkpoint.restore",dict(f.restore_request,candidate_path="wrong-repository",repository_id=str(uuid.uuid4())),"RECOVERY_IDENTITY_MISMATCH"))
    check("checkpoint.restore.wrong-environment",lambda:f.refuse("checkpoint.restore",dict(f.restore_request,candidate_path="wrong-preparation",preparation_digest="sha256:"+"9"*64),"RECOVERY_IDENTITY_MISMATCH"))
    check("checkpoint.path.parent-escape",lambda:f.refuse("checkpoint.capture",dict(f.request,candidate_path="../repo"),"UNSAFE_CANDIDATE"))
    check("checkpoint.path.absolute",lambda:f.refuse("checkpoint.capture",dict(f.request,candidate_path=str(f.repo)),"UNSAFE_CANDIDATE"))
    check("checkpoint.path.request-root-override",lambda:f.refuse("checkpoint.capture",dict(f.request,root=str(f.allowed)),"UNKNOWN_FIELD"))
    check("checkpoint.request.duplicate-fields",lambda:f.refuse("checkpoint.capture",{},"DUPLICATE_FIELD",raw='{"candidate_path":"repo","candidate_path":"repo"}'))
    check("checkpoint.identity.invalid-uuid",lambda:f.refuse("checkpoint.capture",dict(f.request,repository_id="example/repository"),"INVALID_IDENTITY"))
    check("checkpoint.identity.branch-mismatch",lambda:f.refuse("checkpoint.capture",dict(f.request,branch_ref="refs/heads/another"),"BRANCH_MISMATCH"))
    check("checkpoint.privacy.session-token-refused",lambda:f.refuse("checkpoint.capture",dict(f.request,native_session_ref="SESSION-SECRET-CANARY"),"INVALID_RECOVERY_REFERENCE"))
    check("checkpoint.authority.receipt-refused",lambda:f.refuse("checkpoint.restore",dict(f.restore_request,receipt="forged"),"UNKNOWN_FIELD"))
    check("checkpoint.authority.missing-trusted-root",lambda:f.refuse("checkpoint.inspect",{"checkpoint_digest":f.digest},"TRUSTED_ROOT_REQUIRED",env={}))
    check("checkpoint.restore.escape-refused",lambda:f.refuse("checkpoint.restore",dict(f.restore_request,candidate_path="../escaped"),"RESTORE_FRESH_LEAF_REQUIRED"))
    check("checkpoint.capture.replay-content-identity",lambda:expect(invoke("checkpoint.capture",f.request,f.env)["checkpoint_digest"]==f.digest))
    def checksum():
        f.object.write_bytes(f.bytes[:-1]+bytes([f.bytes[-1]^1]))
        try:f.refuse("checkpoint.inspect",{"checkpoint_digest":f.digest},"CHECKSUM_MISMATCH")
        finally:f.object.write_bytes(f.bytes)
    check("checkpoint.integrity.corrupted-object",checksum)
    def truncated():
        f.object.write_bytes(f.bytes[:100])
        try:f.refuse("checkpoint.restore",dict(f.restore_request,candidate_path="truncated"),"CHECKSUM_MISMATCH")
        finally:f.object.write_bytes(f.bytes)
    check("checkpoint.integrity.truncated-object",truncated)
    def missing():
        f.object.unlink()
        try:f.refuse("checkpoint.inspect",{"checkpoint_digest":f.digest},"OBJECT_MISSING")
        finally:f.object.write_bytes(f.bytes)
    check("checkpoint.integrity.missing-object",missing)
    def malformed():
        req=f.capsule_variant(lambda b:b.__setitem__(slice(8,16),struct.pack(">Q",2**63)))
        req["candidate_path"]="malformed"
        f.refuse("checkpoint.restore",req,"INVALID_CAPSULE")
        expect(not (f.allowed/"malformed").exists())
    check("checkpoint.integrity.malformed-envelope",malformed)
    def traversal():
        def mutate(b):
            ms,bs,ps,ts=struct.unpack(">QQQQ",b[8:40]);off=40+ms+bs+ps
            while off<len(b):
                pn,sz,mode,kind=struct.unpack(">IQIB",b[off:off+17]);start=off+17
                if pn>=3:
                    b[start:start+3]=b"../";return
                off=start+pn+sz
            raise AssertionError("no fixture path")
        req=f.capsule_variant(mutate);req["candidate_path"]="tree-escape"
        f.refuse("checkpoint.restore",req,"UNSAFE_PATH")
        expect(not (f.allowed/"tree-escape").exists())
        expect(not any(p.name.startswith(".restore-") for p in f.allowed.iterdir()))
    check("checkpoint.integrity.tree-path-escape",traversal)
    def samebranch():
        clone=f.allowed/"same-branch"
        shutil.copytree(f.repo,clone,symlinks=True)
        other=dict(f.request,candidate_path="same-branch",repository_id=str(uuid.uuid4()))
        value=invoke("checkpoint.capture",other,f.env)
        expect(value["capture_state"]=="LOCAL_COMPLETE" and value["checkpoint_digest"]!=f.digest)
        view=invoke("checkpoint.inspect",{"checkpoint_digest":value["checkpoint_digest"]},f.env)
        expect(view["manifest"]["branch_ref"]==f.request["branch_ref"] and view["manifest"]["repository_id"]==other["repository_id"])
    check("checkpoint.identity.same-branch-distinct-repositories",samebranch)
    def mutation_case(name,mutator,code):
        newbase=f.base/name;newbase.mkdir();other=Fixture(newbase)
        other.capture_refused(lambda:mutator(other),code)
    check("checkpoint.source.fifo-refused",lambda:mutation_case("fifo",lambda x:os.mkfifo(x.repo/"fifo"),"UNSUPPORTED_ENTRY"))
    check("checkpoint.source.hardlink-refused",lambda:mutation_case("hardlink",lambda x:os.link(x.repo/"tracked.bin",x.repo/"hardlink"),"UNSUPPORTED_ENTRY"))
    check("checkpoint.source.symlink-escape-refused",lambda:mutation_case("symlink",lambda x:(x.repo/"escape").symlink_to("../outside"),"UNSAFE_SYMLINK"))
    check("checkpoint.source.secret-path-refused",lambda:mutation_case("secret",lambda x:(x.repo/".netrc").write_text("secret"),"SENSITIVE_PATH"))
    def tracked_secret(x):
        (x.repo/".env").unlink();(x.repo/".env").write_text("TOKEN=private");git(x.repo,"add","-f",".env")
    check("checkpoint.source.tracked-secret-refused",lambda:mutation_case("trackedsecret",tracked_secret,"SENSITIVE_PATH"))
    def submodule(x):
        git(x.repo,"update-index","--add","--cacheinfo","160000,"+x.head+",submodule")
    check("checkpoint.source.submodule-refused",lambda:mutation_case("submodule",submodule,"SUBMODULE_UNSUPPORTED"))
    def large(x):
        with (x.repo/"large").open("wb") as stream:stream.truncate(16*1024*1024+1)
    check("checkpoint.source.file-bound",lambda:mutation_case("large",large,"FILE_LIMIT"))
    def lfs(x):
        (x.repo/"lfs-pointer").write_bytes(b"version https://git-lfs.github.com/spec/v1\\noid sha256:"+b"0"*64+b"\\nsize 99\\n")
    check("checkpoint.source.lfs-refused",lambda:mutation_case("lfs",lfs,"LFS_UNSUPPORTED"))
    def capture_busy():
        lock=f.repo/".git/hyperfide-checkpoint.lock"
        with lock.open("r+") as stream:
            fcntl.flock(stream,fcntl.LOCK_EX|fcntl.LOCK_NB)
            f.refuse("checkpoint.capture",f.request,"CAPTURE_BUSY")
    check("checkpoint.source.concurrent-capture-lock",capture_busy)
    def nested_spool():
        inner=f.repo/"nested-spool";inner.mkdir(mode=0o700)
        try:f.refuse("checkpoint.capture",f.request,"SPOOL_INSIDE_CANDIDATE",
                     env=dict(f.env,HF_CHECKPOINT_SPOOL_ROOT=str(inner)))
        finally:inner.rmdir()
    check("checkpoint.source.spool-recursion-refused",nested_spool)
    def live_writer():
        base=f.base/"live-writer";base.mkdir();other=Fixture(base)
        stop=threading.Event();started=threading.Event()
        def write():
            fd=os.open(other.repo/"tracked.bin",os.O_WRONLY)
            try:
                sequence=0
                while not stop.is_set():
                    sequence+=1
                    os.pwrite(fd,sequence.to_bytes(8,"big")*2048,0)
                    started.set()
            finally:os.close(fd)
        thread=threading.Thread(target=write);thread.start()
        try:
            expect(started.wait(5),"real writer failed to start")
            other.capture_refused(lambda:None,"UNSTABLE_SOURCE")
        finally:
            stop.set();thread.join(timeout=5)
            expect(not thread.is_alive(),"owned source writer leaked")
    check("checkpoint.source.live-writer-instability",live_writer)

def durable_suite(f):
    """Trusted supervisor fixture owns service/DB; native environment remains scrubbed."""
    module_path=ROOT/"tests/hyperfide/cases/tasks/15_2.py"
    expect(module_path.is_file(),"qualified task15.2 fixture missing; prerequisite must be integrated")
    spec=importlib.util.spec_from_file_location("hyperfide_objects_15_1",module_path)
    objects=importlib.util.module_from_spec(spec);spec.loader.exec_module(objects)
    objects.DATABASE="hf_task_15_1_checkpoint"
    objects.RESOURCE="task15-1-checkpoint"
    original_environment=objects.environment
    original_sql=objects.sql
    objects.environment=lambda database=objects.DATABASE:original_environment(database)
    objects.sql=lambda statement,*,database=objects.DATABASE,allow_error=False:original_sql(statement,database=database,allow_error=allow_error)
    expect(objects.cleanup()==0,"dedicated checkpoint fixture cleanup failed")
    objects.sql('CREATE DATABASE "'+objects.DATABASE+'";',database="postgres")
    fixture=objects.ObjectFixture()
    try:
        with tempfile.TemporaryDirectory(prefix="checkpoint-supervisor-",dir="/tmp/hyperfide") as temp:
            service=objects.Service(Path(temp),fixture)
            try:
                service.ok("authority.schema.bootstrap",{},component="4.1")
                objects.seed()
                chunks=f.chunks()
                rows=[]
                offset=0
                for sequence,data in enumerate(chunks):
                    response=service.put(data)
                    expect(response["outcome"]=="SUCCEEDED" and response["availability"]=="VERIFIED")
                    artifact=response["artifact"]
                    rows.append({"sequence":sequence,"artifact_id":artifact["artifact_id"],"digest":DIGEST(data),
                                 "size_bytes":str(len(data)),"offset_bytes":str(offset)})
                    offset+=len(data)
                request={"organisation_id":objects.ORG,"run_id":objects.RUN,"expected_chunks":len(rows),
                         "total_size_bytes":str(offset),"content_digest":f.digest,"chunks":rows,
                         "complete":True,"truncated":False,"missing_ranges":[],
                         "retention_class":"RUN","retention_until":None,"retention_hold":False}
                result=service.ok("artifact.manifest.commit",request)
                expect(result["outcome"]=="SUCCEEDED" and result["availability"]=="VERIFIED" and result["receipt"] is not None)
                expect(result["content_digest"]==f.digest and result["chunk_count"]==len(rows))
                f.object.unlink()
                read=service.ok("artifact.manifest.read",service.by_id(result))
                reconstructed=[]
                for row in read["manifest"]["chunks"]:
                    part=service.ok("artifact.object.read",{"organisation_id":objects.ORG,"run_id":objects.RUN,"artifact_id":row["artifact_id"]})
                    data=base64.b64decode(part["data_base64"],validate=True)
                    expect(DIGEST(data)==row["digest"])
                    reconstructed.append(data)
                data=b"".join(reconstructed)
                expect(DIGEST(data)==f.digest and data==f.bytes)
                f.object.write_bytes(data)
                restored=f.restore(dict(f.restore_request,candidate_path="durable-restored"))
                expect(restored["native_context"]=="NOT_RESTORED" and restored["authority"]=="NONE")
                expect((f.allowed/"durable-restored/tracked.bin").read_bytes()==(f.repo/"tracked.bin").read_bytes())
            finally:pass  # Service requests each own and wait for their actual child process.
    finally:
        fixture.stop();expect(objects.cleanup()==0,"checkpoint database cleanup failed")
def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-task15-1-",dir="/tmp/hyperfide") as tmp:
        f=Fixture(Path(tmp))
        native_suite(f)
        if "--native-only" not in sys.argv:
            check("checkpoint.durable.actual-supervisor-object-roundtrip",lambda:durable_suite(f))
    print(json.dumps({"type":"summary","task":"15.1","assertions":len(IDS),"failed":FAILED,
                      "scope":"native-development-only" if "--native-only" in sys.argv else "task-component",
                      "full_cases":"UNQUALIFIED"}),flush=True)
    return 1 if FAILED else 0
if __name__=="__main__":raise SystemExit(main())
