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
import re
from urllib.parse import urlsplit,urlunsplit
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
    p=subprocess.run(["git","-c","maintenance.auto=false","-c","gc.auto=0","-C",str(repo),*args],capture_output=True,check=True)
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
    def __init__(self,base,scope=None):
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
        if scope:self.request.update(scope)
        self.request.update(candidate_path="repo",base_commit=self.head,branch_ref="refs/heads/attempt",
            preparation_digest="sha256:"+"1"*64,dependency_digest="sha256:"+"2"*64,
            summary_digest="sha256:"+"3"*64,findings_digest="sha256:"+"4"*64,
            instruction_cursor="27",native_support="RECORDED",native_session_ref=str(uuid.uuid4()))
        # A supervisor supplies filesystem references only. No ambient account,
        # database, provider or authenticated service configuration enters native.
        self.env={"PATH":"/usr/bin:/bin","LANG":"C",
                  "HF_CHECKPOINT_ALLOWED_ROOT":str(self.allowed),
                  "HF_CHECKPOINT_SPOOL_ROOT":str(self.spool)}
        for key in ("ASAN_OPTIONS","UBSAN_OPTIONS"):
            if key in os.environ:self.env[key]=os.environ[key]
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

DATABASE="hf_task_15_1_checkpoint"
RESOURCE="hf-task-15.1-database"
def evidence_dir():
    target=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR","/tmp/hyperfide/task-15.1-standalone"))/"checkpoint"
    target.mkdir(parents=True,exist_ok=True)
    return target
def sql(statement,database="postgres"):
    parsed=urlsplit(os.environ["DATABASE_URL"])
    url=urlunsplit((parsed.scheme,parsed.netloc,"/"+database,parsed.query,""))
    env=dict(os.environ,PGDATABASE=database)
    result=subprocess.run(["psql","-X","-q","-A","-t","-v","ON_ERROR_STOP=1","-d",url],
                          input=statement,text=True,capture_output=True,env=env,timeout=30)
    expect(result.returncode==0,"owned checkpoint database operation failed")
    return result.stdout.strip()
def cleanup(emit=True):
    try:
        sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='"+DATABASE+"' AND pid<>pg_backend_pid();")
        sql('DROP DATABASE IF EXISTS "'+DATABASE+'";')
        absent=sql("SELECT datname FROM pg_database WHERE datname='"+DATABASE+"';")==""
        (evidence_dir()/"database-absence.json").write_text(json.dumps({
            "database":DATABASE,"observed_absent":absent,
            "observer":"primary pg_database after explicit owned database cleanup"})+"\n")
        if emit:
            print(json.dumps({"type":"cleanup","complete":absent,"resources":[
                {"id":RESOURCE,"status":"deleted" if absent else "unknown","observed_absent":absent,
                 "evidence_artifact":"checkpoint/database-absence.json"}]}),flush=True)
        return 0 if absent else 1
    except Exception:
        if emit:
            print(json.dumps({"type":"cleanup","complete":False,"resources":[
                {"id":RESOURCE,"status":"unknown"}]}),flush=True)
        return 1
class AuthenticatedArtifactAdapter:
    """Actual15.2 Service/ObjectFixture over the actual14 identity fixture.

    The identity fixture seeds principal rows before extra_setup; the 15.2 setup
    then widens/extends config principals, which actual14 bootstrap refuses to
    overwrite. Re-issue the test-only principal rows from the final config so
    the real HTTPS service starts with matching identities (no service bypass)."""
    def __init__(self,objects,base,database,resource_id):
        spec=importlib.util.spec_from_file_location("hyperfide_identity_15_1",ROOT/"tests/hyperfide/support/identity_fixture.py")
        identity=importlib.util.module_from_spec(spec);spec.loader.exec_module(identity)
        self.objects=objects.ObjectFixture()
        service=object.__new__(objects.Service)
        service.fixture=self.objects;service.closed=False;service.identity_module=identity
        service.second_credential=None;service.scope=None
        def setup(i):
            objects.ORG,objects.RUN=i.ids["organisation"],i.ids["run"]
            objects.RUN2=identity.uid();objects.SCOPE={"organisation_id":objects.ORG,"run_id":objects.RUN}
            objects.DATABASE=i.database;objects.RESOURCE=resource_id
            service.scope=dict(objects.SCOPE)
            (objects.output_dir()/"database-target.json").write_text(json.dumps({"database":i.database,"resource_id":resource_id})+"\n")
            i.sql("INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state) VALUES($1,$2,$3,$4,$5,$6,'RUNNING')",
                  [objects.ORG,objects.RUN2,i.ids["project"],i.ids["spec"],objects.digest(b"artifact-fixture-policy"),i.ids["epoch"]])
            i.env.update({"HF_ARTIFACT_S3_ENDPOINT":self.objects.endpoint,"HF_ARTIFACT_ALLOW_LOOPBACK_HTTP":"1",
                          "HF_ARTIFACT_S3_REGION":objects.REGION,"HF_ARTIFACT_S3_BUCKET":objects.BUCKET,
                          "HF_ARTIFACT_S3_ACCESS_KEY_ID":objects.KEY,"HF_ARTIFACT_S3_SECRET_ACCESS_KEY":objects.SECRET,
                          "HF_ARTIFACT_S3_SESSION_TOKEN":objects.TOKEN,"HF_ARTIFACT_ORGANISATION_ID":objects.ORG,
                          "HF_ARTIFACT_ALLOWED_RUN_IDS":json.dumps([objects.RUN,objects.RUN2])})
            config=json.loads(i.identity_config.read_text())
            for principal in config["principals"]:
                principal["allowed_actions"].append("system.describe")
                i.sql("DELETE FROM hyperfide.identity_principals WHERE credential_id=$1",[principal["credential_id"]])
                i.seed_fixture_principal(principal)
            service.second_credential=identity.uid()
            second=dict(config["principals"][0],credential_id=service.second_credential,actor_id=identity.uid(),run_id=objects.RUN2)
            i.seed_fixture_principal(second)
            config["principals"].append(second)
            i.identity_config.write_text(json.dumps(config))
            policy=json.loads(i.policy.read_text());policy["allowed_actions"].append("system.describe")
            i.policy.write_text(json.dumps(policy))
        try:
            service.auth=identity.IdentityFixture(extra_components=("15.2",),extra_setup=setup,database=database)
        except BaseException:
            self.objects.stop();raise
        service.env=service.auth.env;service.policy=service.auth.policy;service.components=service.auth.components
        self.service=service;self.scope=dict(service.scope);self.database=service.auth.database
    def close(self):
        try:self.service.close()
        finally:self.objects.stop()
def durable_suite(f):
    """Real authenticated HTTPS service; native receives filesystem inputs only."""
    module_path=ROOT/"tests/hyperfide/cases/tasks/15_2.py"
    expect(module_path.is_file(),"actual task15.2 fixture missing; adopt its published source")
    spec=importlib.util.spec_from_file_location("hyperfide_objects_15_1",module_path)
    objects=importlib.util.module_from_spec(spec);spec.loader.exec_module(objects)
    expect(callable(getattr(objects,"createAuthenticatedFixture",None)) and isinstance(getattr(objects,"Service",None),type),
           "actual14 authenticated artifact fixture is not available")
    factory=lambda base,database,resource:AuthenticatedArtifactAdapter(objects,base,database,resource)
    base=f.base/"durable";base.mkdir()
    supervisor_base=f.base/"supervisor";supervisor_base.mkdir()
    setup=None
    observations={"scope":"task-component","source":"actual native and authenticated14 HTTPS processes",
                  "native_authority":"NONE","publication_authority":"supervisor verified artifact service",
                  "objects":[],"restored":False,"live_provider_qualification":"NOT_EVALUATED"}
    try:
        setup=factory(supervisor_base,DATABASE,RESOURCE)
        expect(setup.database==DATABASE,"authenticated fixture did not create the declared owned database")
        service=setup.service
        # Bind source provenance to the authenticated service's real identity.
        identity=service.ok("identity.describe",{},component="14.1")["principal"]
        scope={"organisation_id":identity["organisation_id"],"run_id":identity["run_id"]}
        expect(setup.scope==scope,"artifact fixture scope differs from actual authenticated principal")
        capsule=Fixture(base,scope)
        observations["checkpoint_digest"]=capsule.digest
        observations["authenticated_scope"]=scope
        observations["authenticated_role"]=identity["role"]
        chunks=capsule.chunks()
        rows=[];offset=0
        for sequence,data in enumerate(chunks):
            response=service.put(data,**scope)
            expect(response["outcome"]=="SUCCEEDED" and response["availability"]=="VERIFIED",
                   "actual object service did not verify chunk durability")
            artifact=response["artifact"]
            expect(artifact["organisation_id"]==capsule.request["organisation_id"] and
                   artifact["run_id"]==capsule.request["run_id"],"artifact scope differs from source envelope")
            expect(response.get("receipt") is not None,"verified chunk lacks actual receipt")
            rows.append({"sequence":sequence,"artifact_id":artifact["artifact_id"],"digest":DIGEST(data),
                         "size_bytes":str(len(data)),"offset_bytes":str(offset)})
            observations["objects"].append({"artifact_id":artifact["artifact_id"],"digest":artifact["digest"],
                                            "receipt_id":response["receipt"]["receipt_id"]})
            offset+=len(data)
        request={**scope,"expected_chunks":len(rows),
                 "total_size_bytes":str(offset),"content_digest":capsule.digest,"chunks":rows,
                 "complete":True,"truncated":False,"missing_ranges":[],
                 "retention_class":"RUN","retention_until":None,"retention_hold":False}
        result=service.ok("artifact.manifest.commit",request)
        expect(result["outcome"]=="SUCCEEDED" and result["availability"]=="VERIFIED" and
               result["receipt"] is not None,"actual manifest publication is not verified")
        expect(result["content_digest"]==capsule.digest and result["chunk_count"]==len(rows),
               "durable manifest is not bound to the exact capsule")
        observations["manifest_receipt"]=result["receipt"]["receipt_id"]
        observations["manifest_digest"]=result["manifest_digest"]
        # Simulate loss of all local capsule storage before recovering from the
        # actual service. Native itself never accepts a publication receipt.
        shutil.rmtree(capsule.spool)
        capsule.spool.mkdir(mode=0o700)
        read=service.ok("artifact.manifest.read",{**scope,"artifact_id":result["artifact"]["artifact_id"]})
        reconstructed=[]
        for row in read["manifest"]["chunks"]:
            part=service.ok("artifact.object.read",{**scope,
                                                   "artifact_id":row["artifact_id"]})
            expect(part["availability"]=="VERIFIED","child object not physically verified")
            data=base64.b64decode(part["data_base64"],validate=True)
            expect(DIGEST(data)==row["digest"],"retrieved chunk hash differs")
            reconstructed.append(data)
        data=b"".join(reconstructed)
        expect(DIGEST(data)==capsule.digest and data==capsule.bytes,"retrieved capsule differs")
        capsule.object.write_bytes(data)
        restored=capsule.restore(dict(capsule.restore_request,candidate_path="durable-restored"))
        expect(restored["native_context"]=="NOT_RESTORED" and restored["authority"]=="NONE",
               "restoration invented native context or authority")
        target=capsule.allowed/"durable-restored"
        expect((target/"tracked.bin").read_bytes()==(capsule.repo/"tracked.bin").read_bytes(),
               "durably restored worktree differs")
        expect(git(target,"show",":tracked.bin")==capsule.staged,"durably restored staging differs")
        expect(git(target,"status","--porcelain","-z")==git(capsule.repo,"status","--porcelain","-z"),
               "durably restored Git status differs")
        observations["restored"]=True
        observations["native_context"]=restored["native_context"]
    finally:
        try:
            if setup is not None:setup.close()
        finally:
            (evidence_dir()/"roundtrip-observations.json").write_text(json.dumps(observations,sort_keys=True)+"\n")
            expect(cleanup(emit=False)==0,"owned checkpoint database cleanup failed")
def pin_manifest():
    """Pin only real integrated inputs; missing authentication/source fails."""
    for relative in ("tests/hyperfide/support/identity_fixture.py","tests/hyperfide/cases/tasks/15_2.py",
                     "services/hyperfide/src/identity/enrollment.ts",
                     "services/hyperfide/src/artifacts/objects.ts",
                     "services/hyperfide/dist/control.js","build/hyperfide-native"):
        expect((ROOT/relative).is_file(),"cannot pin missing integrated prerequisite: "+relative)
    registration=json.loads((ROOT/"tests/hyperfide/registrations/15.1.json").read_text())
    paths={ROOT/path for path in registration["source_files"]}
    for name in registration["source_roots"]:
        paths.update(p for p in (ROOT/name).rglob("*") if p.is_file())
    paths.add(ROOT/"tests/hyperfide/registrations/15.1.json")
    paths.add(ROOT/"tests/hyperfide/registry.json")
    inputs=[]
    for path in sorted(paths,key=lambda p:str(p.relative_to(ROOT))):
        expect(path.is_file() and not path.is_symlink(),"missing or unsafe pinned input")
        data=path.read_bytes()
        inputs.append({"path":str(path.relative_to(ROOT)),"sha256":hashlib.sha256(data).hexdigest(),"size":len(data)})
    manifest={"schema_version":1,"campaign_id":"hyperfide-task-15.1-native-checkpoint-v4",
              "registered_variant":"task:15.1","scope":"task-component","case_ids":registration["cases"],
              "expected_assertion_ids":registration["assertion_ids"],
              "approval":{"approved":True,"allowed_actions":registration["actions"]},
              "inputs":inputs,"resources":registration["resources"],"seed":1,
              "policy":{"component_only":True,"execution":"remote-only","cloud_provisioning":False,
                        "frontier_calls":False,"full_case_status":"INCOMPLETE",
                        "durable_transport":"actual14-signed-HTTPS-to-artifact-service",
                        "native_authority":"NONE","native_context_restore":"NOT_RESTORED"}}
    (ROOT/"tests/hyperfide/manifests/tasks/15.1.json").write_text(json.dumps(manifest,indent=2,sort_keys=True)+"\n")
    print(json.dumps({"manifest_inputs":len(inputs),"assertions":len(registration["assertion_ids"])}))
def main():
    if "--cleanup" in sys.argv:return cleanup()
    if "--pin-manifest" in sys.argv:
        pin_manifest();return 0
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
