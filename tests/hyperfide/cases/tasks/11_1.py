#!/usr/bin/env python3
"""Task 11.1: real preparation service and filesystem contract qualification."""
from __future__ import annotations
import copy
import ctypes
import hashlib
import json
import os
from pathlib import Path
import shutil
import select
import threading
import signal
import time
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
FAILED = []
IDS = []
SECRET = "HF-SECRET-CANARY-11.1-UNPUBLISHED"
IDENTITY = "HF-IDENTITY-CANARY-11.1-UNPUBLISHED"
LEASE = "HF-LEASE-CANARY-11.1-UNPUBLISHED"
SCAN = {"secret_canaries":[SECRET],"identity_canaries":[IDENTITY],"lease_canaries":[LEASE]}
POLICY = {
    "schema_version":1,"programme_id":"fixture-run","repository":"fixture/repository",
    "spec_revision":"fixture-revision","policy_revision":1,"status":"ACTIVE",
    "approval":{"decision":"APPROVED","record_id":"fixture-operator-approval",
                "spec_revision":"fixture-revision","policy_revision":1},
    "allowed_roles":["control","provisioner","dispatch"],
    "allowed_actions":["programme.activate","programme.provision","programme.dispatch",
                       "programme.authorize","preparation.manifest.create","preparation.manifest.verify"],
}

def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()

def expect(condition, detail):
    if not condition:
        raise AssertionError(detail)

def check(identity, callback):
    IDS.append(identity)
    try:
        callback()
        actual = "observed"
    except Exception as error:
        actual = type(error).__name__ + ": " + str(error)
        FAILED.append(identity)
    print(json.dumps({"type":"assertion","id":identity,"expected":"observed","actual":actual}),flush=True)

class Fixture:
    def __init__(self, base):
        self.base=base
        self.allowed=base/"allowed"
        self.candidate=self.allowed/"candidate"
        self.candidate.mkdir(parents=True)
        self.candidate.chmod(0o755)
        for name,data in {
            "recipe.sh":b"#!/bin/sh\nprintf prepared\\n\n",
            "package-lock.json":b'{"lockfileVersion":3}\n',
            "evidence.json":b'{"build":"passed","toolchain":"pinned"}\n',
            ".hidden":b"hidden input\n",
            "binary.dat":bytes(range(256)),
        }.items():
            p=self.candidate/name
            p.write_bytes(data)
            p.chmod(0o644)
        (self.candidate/"empty").mkdir(mode=0o755)
        self.policy_file=base/"policy.json"
        self.policy_file.write_text(json.dumps(POLICY))
        self.components=base/"components"
        self.components.mkdir()
        shutil.copyfile(ROOT/"services/hyperfide/components/11.1.json",self.components/"11.1.json")
        self.profile=self.make_profile()

    def pin(self,path):
        return {"path":path,"digest":digest((self.candidate/path).read_bytes())}

    def make_profile(self):
        return {
            "schema_version":1,"profile_id":"fixture-profile","profile_version":"1.0.0",
            "os":{"distribution":"ubuntu","version":"26.04","architecture":"x86_64"},
            "image":{"provider":"railway","reference":"fixture-image-v1","digest":None},
            "resources":{"cpu_millis":2000,"memory_bytes":"4294967296",
                         "disk_bytes":"32212254720","persistent_volume_bytes":"0"},
            "toolchains":[{"name":"node","version":"24.22.0"}],
            "package_managers":[{"name":"npm","version":"11.19.1",
                                 "locks":[self.pin("package-lock.json")]}],
            "native_agents":[{"name":"codex","version":"1.0.0"}],
            "connectors":[{"name":"codex-stdio","version":"1.0.0"}],
            "supervisor":{"name":"hyperfide-supervisor","version":"2.0.0"},
            "hyperfide":{"version":"2.0.0"},
            "system_packages":[{"name":"gcc","version":"15.2.0"}],
            "repositories":[{"id":"fixture","url":"https://example.invalid/repository.git",
                             "commit":"a"*40,"submodules":[],"lfs":False}],
            "recipe":self.pin("recipe.sh"),"generated_inputs":[],"build_config":[],
            "caches":[{"name":"npm","trust_scope":"fixture","input_digest":digest(b"fixture-cache")}],
            "required_capabilities":["execute","transfer"],
            "network":{"routes":["coordinator.example:443"],"registries":["registry.npmjs.org"]},
            "credential_references":["secret/model-fixture"],
            "policy":{"max_process_lifetime_seconds":259200,"expires_at":"2099-01-01T00:00:00.000Z",
                      "rebuild_on":["source","locks","toolchains"]},
            "preparation_evidence":[self.pin("evidence.json")],
        }

    def invoke(self, action="create", payload=None, *, role="provisioner", trusted=True, extra_env=None):
        payload=payload if payload is not None else {
            "candidate_path":"candidate","profile":self.profile,"scan_policy":SCAN}
        env=os.environ.copy()
        if trusted:
            env["HF_PREPARATION_ALLOWED_ROOT"]=str(self.allowed)
        else:
            env.pop("HF_PREPARATION_ALLOWED_ROOT",None)
        env.pop("HF_SERVICE_MAX_REQUEST_BYTES",None)
        env.pop("HF_SERVICE_MAX_RESPONSE_BYTES",None)
        if extra_env:
            env.update(extra_env)
        argv=["node",str(ROOT/f"services/hyperfide/dist/{role}.js"),
              "--policy",str(self.policy_file),"--spec-revision","fixture-revision",
              "--components",str(self.components),
              "--module-root",str(ROOT/"services/hyperfide/dist")]
        request={"id":"preparation-check","component":"11.1",
                 "action":"preparation.manifest."+action,"input":payload}
        result=subprocess.run(argv,cwd=ROOT,input=json.dumps(request)+"\n",
                              text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,
                              env=env,timeout=20)
        rows=[json.loads(line) for line in (result.stdout+"\n"+result.stderr).splitlines() if line.strip()]
        expect(len(rows)==1,f"missing bounded service response (exit {result.returncode})")
        return rows[0],result

    def create(self):
        row,result=self.invoke()
        expect(result.returncode==0 and row.get("ok") is True,
               "valid candidate refused: "+json.dumps(row))
        return row["result"]

    def verify(self,manifest):
        return self.invoke("verify",{"candidate_path":"candidate","manifest":manifest,"scan_policy":SCAN})

    def reject(self,payload=None,*,action="create",trusted=True,role="provisioner"):
        row,result=self.invoke(action,payload,trusted=trusted,role=role)
        expect(row.get("ok") is False,"unsafe input accepted")
        combined=result.stdout+result.stderr
        expect(len(combined)<65536,"unbounded refusal output")
        expect(all(value not in combined for values in SCAN.values() for value in values),
               "canary leaked through service refusal")
        return row

def using(base,callback):
    with tempfile.TemporaryDirectory(prefix="fixture-",dir=base) as folder:
        callback(Fixture(Path(folder)))

def main():
    with tempfile.TemporaryDirectory(prefix="hyperfide-preparation-") as folder:
        base=Path(folder)
        def case(identity,callback):
            check("preparation."+identity,lambda:using(base,callback))

        def inventory(f):
            manifest=f.create()
            expect(set(manifest)=={"schema_version","profile","files","directories","scan","digest"},
                   "manifest shape differs from contract")
            actual={p.relative_to(f.candidate).as_posix():p for p in f.candidate.rglob("*") if p.is_file()}
            rows=manifest["files"]
            expect([row["path"] for row in rows]==sorted(actual),"inventory omitted hidden/binary files")
            for row in rows:
                p=actual[row["path"]]
                expect(set(row)=={"path","mode","size","digest"},"file entry shape")
                expect(row["digest"]==digest(p.read_bytes()) and row["size"]==str(p.stat().st_size)
                       and row["mode"]==p.stat().st_mode&0o777,"file evidence does not match actual bytes")
            expect(manifest["directories"]==[{"path":".","mode":0o755},{"path":"empty","mode":0o755}],
                   "empty/root directory inventory missing")
            body={k:v for k,v in manifest.items() if k!="digest"}
            expect(manifest["digest"]==digest(canonical(body)),"identity is not canonical actual content")
            text=json.dumps(manifest)
            expect(str(f.allowed) not in text and "scan_policy" not in manifest,"manifest leaked local path")
            expect(all(value not in text for values in SCAN.values() for value in values),"manifest leaked canary")
        case("inventory.actual-bytes",inventory)

        def roundtrip(f):
            first=f.create();second=f.create()
            expect(first==second,"repeat publication changed identity")
            row,result=f.verify(first)
            expect(result.returncode==0 and row.get("ok") is True,"exact candidate did not verify")
            expect(row["result"]=={"valid":True,"digest":first["digest"],"file_count":len(first["files"])},
                   "verification result differs")
        case("manifest.roundtrip",roundtrip)

        def portable(f):
            first=f.create()
            other=f.allowed/"relocated"
            shutil.copytree(f.candidate,other)
            row,result=f.invoke(payload={"candidate_path":"relocated","profile":f.profile,"scan_policy":SCAN})
            expect(row.get("ok") is True and row["result"]==first,"absolute location contaminated identity")
        case("manifest.portable",portable)

        def scan_declaration(f):
            m=f.create()
            expect(m["scan"]=={"policy_version":1,"canary_counts":{"secret":1,"identity":1,"lease":1},
                   "checks":["sensitive_paths","private_key_markers","authority_json","designated_canaries"]},
                   "scan coverage not declared")
            changed=copy.deepcopy(SCAN);changed["secret_canaries"]=["DIFFERENT-CANARY-11.1"]
            row,_=f.invoke("verify",{"candidate_path":"candidate","manifest":m,"scan_policy":changed})
            expect(row.get("ok") is True,"equal-count policy wrongly claims canary identity binding")
            changed["secret_canaries"]=[]
            f.reject({"candidate_path":"candidate","manifest":m,"scan_policy":changed},action="verify")
        case("scan.coverage-counts",scan_declaration)

        def drift(f,mutation):
            old=f.create()
            mutation(f)
            row,_=f.verify(old)
            expect(row.get("ok") is False,"changed candidate retained valid old evidence")
        drift_cases={
            "file-content":lambda f:(f.candidate/".hidden").write_bytes(b"changed"),
            "file-added":lambda f:(f.candidate/"new").write_bytes(b"new"),
            "file-deleted":lambda f:(f.candidate/".hidden").unlink(),
            "file-mode":lambda f:(f.candidate/".hidden").chmod(0o600),
            "root-mode":lambda f:f.candidate.chmod(0o700),
            "directory-mode":lambda f:(f.candidate/"empty").chmod(0o700),
            "empty-directory":lambda f:(f.candidate/"new-empty").mkdir(),
            "toolchain":lambda f:f.profile["toolchains"][0].update(version="24.22.1"),
            "recipe":lambda f:(f.candidate/"recipe.sh").write_bytes(b"#!/bin/sh\nexit 0\n"),
            "lock":lambda f:(f.candidate/"package-lock.json").write_bytes(b"{}\n"),
        }
        for name,mutation in drift_cases.items():
            # Profile mutations must be verified with the changed manifest claim, not an unrelated caller field.
            if name=="toolchain":
                def profile_drift(f):
                    old=f.create();f.profile["toolchains"][0]["version"]="24.22.1"
                    new=f.create()
                    expect(new["digest"]!=old["digest"],"profile version omitted from identity")
                case("drift."+name,profile_drift)
            else:
                case("drift."+name,lambda f,m=mutation:drift(f,m))

        def manifest_tamper(f,mutation):
            m=f.create();mutation(m)
            f.reject({"candidate_path":"candidate","manifest":m,"scan_policy":SCAN},action="verify")
        tamper_cases={
            "digest":lambda m:m.update(digest="sha256:"+"0"*64),
            "file-digest":lambda m:m["files"][0].update(digest="sha256:"+"0"*64),
            "file-size":lambda m:m["files"][0].update(size="01"),
            "file-order":lambda m:m["files"].reverse(),
            "file-duplicate":lambda m:m["files"].append(copy.deepcopy(m["files"][0])),
            "directory-omitted":lambda m:m["directories"].pop(),
            "scan-omitted":lambda m:m.pop("scan"),
            "unknown-field":lambda m:m.update(untrusted=True),
            "profile-runtime-identity":lambda m:m["profile"].update(agent_session_id="forged"),
        }
        for name,mutation in tamper_cases.items():
            case("tamper."+name,lambda f,m=mutation:manifest_tamper(f,m))

        for path_index,path in enumerate(["","/tmp","../candidate","candidate/..","./candidate","candidate//empty",
                     "candidate\\empty","candidate/\x00bad"]):
            def unsafe_path(f,p=path):
                f.reject({"candidate_path":p,"profile":f.profile,"scan_policy":SCAN})
            case("path.invalid-"+str(path_index),unsafe_path)
        case("authority.missing-root",lambda f:f.reject(trusted=False))
        case("authority.request-root",lambda f:f.reject({
            "candidate_path":"candidate","profile":f.profile,"scan_policy":SCAN,
            "allowed_root":str(f.allowed)}))
        case("authority.role-denied",lambda f:f.reject(role="control"))

        def root_symlink(f):
            f.candidate.rename(f.allowed/"real")
            f.candidate.symlink_to(f.allowed/"real",target_is_directory=True)
            f.reject()
        case("filesystem.root-symlink",root_symlink)
        def nested_symlink(f):
            (f.candidate/"linked").symlink_to(f.candidate/".hidden")
            f.reject()
        case("filesystem.file-symlink",nested_symlink)
        def ancestor_symlink(f):
            (f.allowed/"alias").symlink_to(f.candidate,target_is_directory=True)
            f.reject({"candidate_path":"alias/empty","profile":f.profile,"scan_policy":SCAN})
        case("filesystem.ancestor-symlink",ancestor_symlink)
        def hardlink(f):
            os.link(f.candidate/".hidden",f.candidate/"hardlinked")
            f.reject()
        case("filesystem.hardlink",hardlink)
        def fifo(f):
            os.mkfifo(f.candidate/"pipe")
            f.reject()
        case("filesystem.fifo",fifo)
        def special_mode(f):
            (f.candidate/".hidden").chmod(0o4644)
            f.reject()
        case("filesystem.special-mode",special_mode)
        def inside_manifest(f):
            old=f.create()
            (f.candidate/"manifest.json").write_text(json.dumps(old))
            row,_=f.verify(old)
            expect(row.get("ok") is False,"stored manifest was silently excluded")
        case("filesystem.manifest-not-excluded",inside_manifest)

        for group,value in [("secret",SECRET),("identity",IDENTITY),("lease",LEASE)]:
            def contaminated(f,v=value):
                (f.candidate/"binary-contamination").write_bytes(b"\x00\xff"+v.encode()+b"\x00")
                f.reject()
            case("contamination."+group,contaminated)
        def filename_canary(f):
            (f.candidate/SECRET).write_bytes(b"ordinary data")
            f.reject()
        case("contamination.filename-canary",filename_canary)
        def dirname_canary(f):
            (f.candidate/IDENTITY).mkdir()
            f.reject()
        case("contamination.dirname-canary",dirname_canary)
        for name in [".env",".npmrc",".netrc",".ssh/id_rsa",".aws/credentials",
                     ".codex/auth.json",".claude/.credentials.json"]:
            def authpath(f,n=name):
                p=f.candidate/n;p.parent.mkdir(parents=True,exist_ok=True);p.write_bytes(b"unrecognised-auth-material")
                f.reject()
            case("contamination.path-"+name.replace("/","-"),authpath)
        for key in ["lease_token","lease_id","agent_session_id","ownership_generation","enrollment_token"]:
            def authority(f,k=key):
                (f.candidate/"runtime.json").write_text(json.dumps({"nested":{k:"active-fixture"}}))
                f.reject()
            case("contamination.authority-"+key,authority)
        def private_key(f):
            (f.candidate/"unknown.txt").write_text("-----BEGIN OPENSSH PRIVATE KEY-----\n"+"A"*64+"\n-----END OPENSSH PRIVATE KEY-----\n")
            f.reject()
        case("contamination.private-key",private_key)
        def env_example(f):
            (f.candidate/".env.example").write_text("EXAMPLE=placeholder\n")
            f.create()
        case("contamination.example-allowed",env_example)
        def empty_scan(f):
            row,_=f.invoke(payload={"candidate_path":"candidate","profile":f.profile,
                       "scan_policy":{key:[] for key in SCAN}})
            expect(row.get("ok") is True,"explicit empty canary policy rejected")
        case("scan.explicit-empty",empty_scan)

        profile_invalid={
            "schema-bool":lambda p:p.update(schema_version=True),
            "unknown":lambda p:p.update(lease_id="live"),
            "nested-unknown":lambda p:p["resources"].update(region="unknown"),
            "cpu-bool":lambda p:p["resources"].update(cpu_millis=True),
            "cpu-zero":lambda p:p["resources"].update(cpu_millis=0),
            "memory-noncanonical":lambda p:p["resources"].update(memory_bytes="01"),
            "memory-zero":lambda p:p["resources"].update(memory_bytes="0"),
            "version-range":lambda p:p["toolchains"][0].update(version="^24.0.0"),
            "version-latest":lambda p:p["native_agents"][0].update(version="latest"),
            "duplicate-toolchain":lambda p:p["toolchains"].append(copy.deepcopy(p["toolchains"][0])),
            "empty-agents":lambda p:p.update(native_agents=[]),
            "empty-locks":lambda p:p["package_managers"][0].update(locks=[]),
            "missing-pin":lambda p:p["recipe"].update(path="missing"),
            "wrong-pin":lambda p:p["recipe"].update(digest="sha256:"+"0"*64),
            "commit-invalid":lambda p:p["repositories"][0].update(commit="branch-main"),
            "url-credentials":lambda p:p["repositories"][0].update(url="https://user:pass@example.invalid/r.git"),
            "url-query":lambda p:p["repositories"][0].update(url="https://example.invalid/r.git?token=fixture"),
            "expiry-past":lambda p:p["policy"].update(expires_at="2000-01-01T00:00:00.000Z"),
            "expiry-noncanonical":lambda p:p["policy"].update(expires_at="2099-01-01"),
            "duplicate-capability":lambda p:p["required_capabilities"].append("execute"),
        }
        for name,mutation in profile_invalid.items():
            def bad_profile(f,m=mutation):
                m(f.profile);f.reject()
            case("profile.invalid-"+name,bad_profile)
        def bad_scan(f):
            policy=copy.deepcopy(SCAN);policy["secret_canaries"]=["short"]
            f.reject({"candidate_path":"candidate","profile":f.profile,"scan_policy":policy})
        case("scan.short-canary",bad_scan)
        def big_file(f):
            with (f.candidate/"over-limit").open("wb") as stream:
                stream.truncate(2*1024*1024*1024+1)
            f.reject()
        case("filesystem.file-bound",big_file)
        def real_binary(f):
            executable=subprocess.run(["node","-p","process.execPath"],text=True,
                                      stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.strip()
            binary=Path(executable)
            expect(binary.stat().st_size>16*1024*1024,"installed Node does not exercise streaming size")
            target=f.candidate/"node-runtime"
            shutil.copyfile(binary,target)
            m=f.create()
            entry=next(row for row in m["files"] if row["path"]=="node-runtime")
            with target.open("rb") as stream:
                actual="sha256:"+hashlib.file_digest(stream,"sha256").hexdigest()
            expect(entry["digest"]==actual and entry["size"]==str(target.stat().st_size),
                   "large real runtime hash differs from actual binary")
        case("filesystem.streaming-real-binary",real_binary)
        def chunk_canary(f):
            (f.candidate/"chunked.dat").write_bytes(b"X"*(65536-7)+SECRET.encode()+b"Y"*65536)
            f.reject()
        case("contamination.streaming-boundary",chunk_canary)
        def late_mutation(f):
            executable=subprocess.run(["node","-p","process.execPath"],text=True,
                                      stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.strip()
            target=f.candidate/"node-runtime"
            shutil.copyfile(executable,target)
            libc=ctypes.CDLL(None,use_errno=True)
            fd=libc.inotify_init1(os.O_NONBLOCK|os.O_CLOEXEC)
            expect(fd>=0,"inotify initialization failed")
            stop=threading.Event();observed=[];errors=[]
            try:
                watch=libc.inotify_add_watch(fd,os.fsencode(target),0x20)
                expect(watch>=0,"inotify watch failed")
                def rewrite():
                    try:
                        while not stop.is_set():
                            if select.select([fd],[],[],0.1)[0]:
                                os.read(fd,65536)
                                (f.candidate/".hidden").write_bytes(b"mutation during later runtime read")
                                observed.append(True)
                                return
                    except Exception as error:
                        errors.append(str(error))
                worker=threading.Thread(target=rewrite,daemon=True);worker.start()
                try:
                    row,_=f.invoke()
                finally:
                    stop.set();worker.join(timeout=3)
                expect(observed and not errors and not worker.is_alive(),"late-file writer did not execute safely")
                expect(row.get("ok") is False,"already-scanned file mutation escaped final closure")
            finally:
                stop.set();os.close(fd)
        case("filesystem.late-file-mutation",late_mutation)
        def schema_password(f):
            (f.candidate/"schema.json").write_text(json.dumps({
                "$schema":"https://json-schema.org/draft/2020-12/schema",
                "type":"object","properties":{"password":{"type":"string","minLength":12}},
                "required":["password"]}))
            f.create()
        case("contamination.schema-property-allowed",schema_password)
        def duplicate_credentials(f):
            (f.candidate/"runtime.json").write_text('{"password":"live-nondesignated-fixture","password":null}')
            f.reject()
        case("contamination.duplicate-credential",duplicate_credentials)
        def escaped_credentials(f):
            (f.candidate/"runtime.json").write_bytes(b'{"pass\\u0077ord":"live-nondesignated-fixture"}')
            f.reject()
        case("contamination.escaped-credential-key",escaped_credentials)
        def authority_other_extension(f):
            (f.candidate/"runtime.txt").write_text('{"lease_id":"active-nondesignated-fixture"}')
            f.reject()
        case("contamination.json-without-extension",authority_other_extension)
        def oci_image(f):
            pinned="sha256:"+"a"*64
            f.profile["image"]={"provider":"blaxel","reference":"registry.example.invalid/team/image@"+pinned,
                                "digest":pinned}
            f.create()
        case("profile.oci-reference",oci_image)
        def oci_mismatch(f):
            f.profile["image"]={"provider":"blaxel","reference":"registry.example.invalid/team/image@sha256:"+"a"*64,
                                "digest":"sha256:"+"b"*64}
            f.reject()
        case("profile.oci-digest-mismatch",oci_mismatch)
        def large_inventory(f):
            for index in range(10005):
                (f.candidate/("file-"+str(index).zfill(5)+"-"+"n"*64)).write_bytes(b"fixture")
            default,_=f.invoke()
            expect(default.get("ok") is False,"default1MiB response limit silently increased")
            options={"HF_SERVICE_MAX_REQUEST_BYTES":"67108864","HF_SERVICE_MAX_RESPONSE_BYTES":"67108864"}
            created,_=f.invoke(extra_env=options)
            expect(created.get("ok") is True,"trusted protocol configuration rejected real large inventory")
            manifest=created["result"]
            expect(len(manifest["files"])>=10005 and len(json.dumps(manifest).encode())>1048576,
                   "fixture did not exercise required real manifest scale")
            verified,_=f.invoke("verify",{"candidate_path":"candidate","manifest":manifest,"scan_policy":SCAN},
                                extra_env=options)
            expect(verified.get("ok") is True and verified["result"]["digest"]==manifest["digest"],
                   "configured >1MiB actual create/verify roundtrip failed")
        case("transport.large-inventory-roundtrip",large_inventory)
        def default_input_limit(f):
            payload={"candidate_path":"candidate","profile":f.profile,"scan_policy":SCAN,
                     "padding":"X"*(1048576+1)}
            row,_=f.invoke(payload=payload)
            expect(row.get("ok") is False and row.get("error",{}).get("code")=="INVALID_REQUEST",
                   "default1MiB request boundary no longer enforced")
        case("transport.default-request-bound",default_input_limit)
        for option in ["HF_SERVICE_MAX_REQUEST_BYTES","HF_SERVICE_MAX_RESPONSE_BYTES"]:
            for setting in ["","0","1","255","-1","01","1.5","1e6","67108865"]:
                def invalid_limit(f,key=option,value=setting):
                    row,_=f.invoke(extra_env={key:value})
                    expect(row.get("ok") is False and row.get("error",{}).get("code")=="PROTOCOL_CONFIG",
                           "invalid startup protocol configuration accepted or not diagnosed")
                case("transport.invalid-"+option.lower()+"-"+(setting or "empty"),invalid_limit)
        def request_limit_override(f):
            payload={"candidate_path":"candidate","profile":f.profile,"scan_policy":SCAN,
                     "HF_SERVICE_MAX_RESPONSE_BYTES":"67108864"}
            f.reject(payload)
        case("transport.request-cannot-configure",request_limit_override)
        def outside_sibling_mutation(f):
            executable=subprocess.run(["node","-p","process.execPath"],text=True,
                                      stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.strip()
            target=f.candidate/"node-runtime";shutil.copyfile(executable,target)
            libc=ctypes.CDLL(None,use_errno=True);fd=libc.inotify_init1(os.O_NONBLOCK|os.O_CLOEXEC)
            expect(fd>=0,"inotify initialization failed")
            stop=threading.Event();observed=[]
            try:
                expect(libc.inotify_add_watch(fd,os.fsencode(target),0x20)>=0,"inotify watch failed")
                def mutate():
                    while not stop.is_set():
                        if select.select([fd],[],[],0.1)[0]:
                            os.read(fd,65536)
                            (f.allowed/"outside-candidate").write_bytes(b"unrelated sibling")
                            observed.append(True);return
                worker=threading.Thread(target=mutate,daemon=True);worker.start()
                try:manifest=f.create()
                finally:stop.set();worker.join(timeout=3)
                expect(observed and not worker.is_alive(),"sibling mutation fixture did not run")
                expect("outside-candidate" not in [x["path"] for x in manifest["files"]],
                       "unrelated sibling contaminated candidate")
            finally:stop.set();os.close(fd)
        case("filesystem.outside-sibling-mutation",outside_sibling_mutation)
        def scan_cancellation(f):
            executable=subprocess.run(["node","-p","process.execPath"],text=True,
                                      stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True).stdout.strip()
            target=f.candidate/"node-runtime";shutil.copyfile(executable,target)
            libc=ctypes.CDLL(None,use_errno=True);fd=libc.inotify_init1(os.O_NONBLOCK|os.O_CLOEXEC)
            expect(fd>=0,"inotify initialization failed")
            stop=threading.Event();observed=[];child=None
            try:
                expect(libc.inotify_add_watch(fd,os.fsencode(target),0x20)>=0,"inotify watch failed")
                env=os.environ.copy();env["HF_PREPARATION_ALLOWED_ROOT"]=str(f.allowed)
                env.pop("HF_SERVICE_MAX_REQUEST_BYTES",None);env.pop("HF_SERVICE_MAX_RESPONSE_BYTES",None)
                argv=["node",str(ROOT/"services/hyperfide/dist/provisioner.js"),
                      "--policy",str(f.policy_file),"--spec-revision","fixture-revision",
                      "--components",str(f.components),"--module-root",str(ROOT/"services/hyperfide/dist")]
                child=subprocess.Popen(argv,cwd=ROOT,stdin=subprocess.PIPE,stdout=subprocess.PIPE,
                                       stderr=subprocess.PIPE,text=True,env=env)
                def interrupt():
                    while not stop.is_set():
                        if select.select([fd],[],[],0.1)[0]:
                            os.read(fd,65536);observed.append(time.monotonic())
                            child.send_signal(signal.SIGTERM);return
                worker=threading.Thread(target=interrupt,daemon=True);worker.start()
                request={"id":"cancel-scan","component":"11.1","action":"preparation.manifest.create",
                         "input":{"candidate_path":"candidate","profile":f.profile,"scan_policy":SCAN}}
                try:out,err=child.communicate(json.dumps(request)+"\n",timeout=8)
                finally:stop.set();worker.join(timeout=3)
                expect(observed and not worker.is_alive(),"cancellation fixture did not interrupt active read")
                expect(time.monotonic()-observed[0]<5 and child.returncode!=0,"scan did not cancel promptly")
                rows=[json.loads(line) for line in (out+"\n"+err).splitlines() if line.strip()]
                expect(not any(row.get("ok") is True for row in rows),"cancelled scan published successful manifest")
            finally:
                stop.set();os.close(fd)
                if child is not None and child.poll() is None:
                    child.kill();child.communicate(timeout=3)
        case("filesystem.scan-cancellation",scan_cancellation)
        def marker_only(f):
            (f.candidate/"compiled-marker.dat").write_bytes(b"literal -----BEGIN RSA PRIVATE KEY----- token")
            f.create()
        case("contamination.pem-marker-only-allowed",marker_only)
        def adjacent_markers(f):
            (f.candidate/"compiled-marker.dat").write_bytes(
                b"-----BEGIN RSA PRIVATE KEY----------END RSA PRIVATE KEY-----")
            f.create()
        case("contamination.pem-adjacent-markers-allowed",adjacent_markers)
        def actual_mise(f):
            binary=Path("/root/.local/bin/mise").resolve(strict=True)
            expect(binary.stat().st_size>16*1024*1024,"mise fixture must exercise actual installed binary")
            target=f.candidate/"mise-runtime";shutil.copyfile(binary,target)
            manifest=f.create()
            entry=next(row for row in manifest["files"] if row["path"]=="mise-runtime")
            with target.open("rb") as stream:
                actual="sha256:"+hashlib.file_digest(stream,"sha256").hexdigest()
            expect(entry["digest"]==actual and entry["size"]==str(target.stat().st_size),
                   "installed mise binary identity mismatch")
        case("filesystem.actual-mise-binary",actual_mise)
        def unwrapped_pem(f):
            (f.candidate/"payload.dat").write_bytes(
                b"x"*65000+b"-----BEGIN RSA PRIVATE KEY-----\n"+b"A"*2048+
                b"\n-----END RSA PRIVATE KEY-----\n")
            f.reject()
        case("contamination.pem-unwrapped-crosschunk",unwrapped_pem)
        def empty_candidate(f):
            shutil.rmtree(f.candidate);f.candidate.mkdir()
            f.reject()
        case("filesystem.empty-candidate",empty_candidate)

    print(json.dumps({"type":"cleanup","resources":[],"complete":True}),flush=True)
    return 1 if FAILED else 0

if __name__=="__main__":
    sys.exit(main())
