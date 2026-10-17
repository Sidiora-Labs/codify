#!/usr/bin/env python3
"""Task 15.2: actual service, PostgreSQL metadata and independently signed S3 HTTP.
This component receipt does not qualify live object-store durability, provider
retention, failover, garbage collection, or the full V-012 recovery campaign.
"""
from __future__ import annotations
import base64
import copy
import hashlib
import hmac
import inspect
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import sys
import tempfile
import threading
import time
from urllib.parse import urlsplit, urlunsplit

ROOT = Path(__file__).resolve().parents[4]
DATABASE = "hf_task_15_2_qualification"
RESOURCE = "hf-task-15.2-database"
ORG = "15000000-0000-4000-8000-000000000001"
RUN = "15000000-0000-4000-8000-000000000005"
RUN2 = "15000000-0000-4000-8000-000000000015"
SCOPE = {"organisation_id": ORG, "run_id": RUN}
KEY = "fixture-only-access-id"
SECRET = "fixture-only-s3-secret-never-a-live-credential"
TOKEN = "fixture-only-session-token"
REGION = "fixture-region-1"
BUCKET = "hyperfide-artifacts-fixture"
MAX_BYTES = 256 * 1024
ACTIONS = ["artifact.object.put", "artifact.object.read", "artifact.object.inspect",
           "artifact.object.reconcile", "artifact.manifest.commit", "artifact.manifest.read",
           "artifact.pending.list", "artifact.object.locate"]
IDS = [
 "artifacts.service.registered", "artifacts.object.roundtrip", "artifacts.object.empty",
 "artifacts.object.receipt-replay", "artifacts.object.conditional-existing",
 "artifacts.object.pending-before-http", "artifacts.object.crash-upload-registration",
 "artifacts.object.pending-absent-recovery", "artifacts.object.ambiguous-upload-reconcile",
 "artifacts.object.forbidden-not-absent", "artifacts.object.missing-complete",
 "artifacts.object.corrupt-complete", "artifacts.object.truncated", "artifacts.object.overlarge",
 "artifacts.object.corrupt-precondition", "artifacts.object.redirect-no-forwarding",
 "artifacts.object.binding-conflict", "artifacts.scope.before-effects", "artifacts.scope.cross-run-read", "artifacts.scope.nested-run-spoof",
 "artifacts.input.digest", "artifacts.input.size", "artifacts.input.base64",
 "artifacts.input.unknown", "artifacts.input.oversize", "artifacts.input.retention",
 "artifacts.config.endpoint", "artifacts.manifest.ordered-complete", "artifacts.manifest.read",
 "artifacts.manifest.replay", "artifacts.manifest.empty", "artifacts.manifest.gap",
 "artifacts.manifest.reordered", "artifacts.manifest.offset", "artifacts.manifest.truncated",
 "artifacts.manifest.missing-range", "artifacts.manifest.count", "artifacts.manifest.total",
 "artifacts.manifest.content-hash", "artifacts.manifest.chunk-hash",
 "artifacts.manifest.pending-child", "artifacts.manifest.foreign-child",
 "artifacts.manifest.corrupt-child", "artifacts.manifest.missing-child",
 "artifacts.retention.metadata", "artifacts.retention.children", "artifacts.object.opaque-payload",

 "artifacts.manifest.promotion-bypass", "artifacts.http.independent-sigv4", "artifacts.secrets.sanitized",
 "artifacts.object.locate-id-loss", "artifacts.object.locate-absent", "artifacts.object.locate-pending",
 "artifacts.auth.stdio-required", "artifacts.auth.forged-context", "artifacts.auth.revoked-mid-upload",
]
FAILED = []
OBSERVATIONS = []
CHECKED = []
POLICY = {"schema_version": 1, "programme_id": "task-15.2-component-fixture",
 "repository": "fixture/repository", "spec_revision": "task-15.2-reviewed-spec",
 "policy_revision": 1, "status": "ACTIVE",
 "approval": {"decision": "APPROVED", "record_id": "programme-owner-authorized-implementation",
              "spec_revision": "task-15.2-reviewed-spec", "policy_revision": 1},
 "allowed_roles": ["control"],
 "allowed_actions": ["programme.activate", "authority.schema.bootstrap"] + ACTIONS}

def expect(condition, detail):
    if not condition:
        raise AssertionError(detail)

def check(identity, callback):
    CHECKED.append(identity)
    try:
        callback()
        actual = "observed"
    except Exception as error:
        # Callbacks expose only synthetic payloads, controlled codes and counts.
        actual = type(error).__name__ + ": " + str(error)
        FAILED.append(identity)
    print(json.dumps({"type": "assertion", "id": identity,
                      "expected": "observed", "actual": actual}), flush=True)

def digest(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()

def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()

def environment(database=None):
    database = DATABASE if database is None else database
    env = os.environ.copy()
    parsed = urlsplit(env["DATABASE_URL"])
    env["DATABASE_URL"] = urlunsplit((parsed.scheme, parsed.netloc, "/" + database, parsed.query, ""))
    env["PGDATABASE"] = database
    return env

def sql(statement, *, database=None, allow_error=False):
    database = DATABASE if database is None else database
    env = environment(database)
    result = subprocess.run(["psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1",
                             "-d", env["DATABASE_URL"]], cwd=ROOT, env=env,
                            input=statement, text=True, capture_output=True, timeout=20)
    expect(allow_error or result.returncode == 0, "synthetic PostgreSQL operation failed")
    return result

def rows(statement):
    text = sql(statement).stdout.strip()
    return json.loads(text) if text else []

def artifacts():
    return rows("SELECT coalesce(json_agg(t),'[]') FROM (SELECT id::text,digest,status,size_bytes::text,"
                "storage_key,storage_backend,retention_class,retention_until,retention_hold,"
                "completed_at,state_version::text,run_id::text FROM hyperfide.artifacts ORDER BY id) t;")

def find(data, run=None):
    run = RUN if run is None else run
    matching = [r for r in artifacts() if r["digest"] == digest(data) and r["run_id"] == run]
    expect(len(matching) == 1, "expected one scoped PostgreSQL artifact row")
    return matching[0]

def output_dir():
    target = Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR", "/tmp/hyperfide/task-15.2-standalone")) / "objects"
    target.mkdir(parents=True, exist_ok=True)
    return target

def cleanup():
    global DATABASE
    try:
        target = output_dir() / "database-target.json"
        if target.exists():
            record = json.loads(target.read_text())
            expect(record.get("resource_id") == RESOURCE and re.fullmatch(r"hf_[a-z0-9_]{1,60}", record.get("database", "")), "invalid owned fixture resource record")
            DATABASE = record["database"]
        sql("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='" + DATABASE +
            "' AND pid<>pg_backend_pid();", database="postgres")
        sql('DROP DATABASE IF EXISTS "' + DATABASE + '";', database="postgres")
        absent = sql("SELECT datname FROM pg_database WHERE datname='" + DATABASE + "';",
                     database="postgres").stdout.strip() == ""
        (output_dir() / "database-absence.json").write_text(json.dumps({
            "database": DATABASE, "observed_absent": absent,
            "observer": "pg_database after owned DROP DATABASE"}) + "\n")
        print(json.dumps({"type": "cleanup", "complete": absent, "resources": [
            {"id": RESOURCE, "status": "deleted" if absent else "unknown",
             "observed_absent": absent, "evidence_artifact": "objects/database-absence.json"}]}), flush=True)
        return 0 if absent else 1
    except Exception:
        print(json.dumps({"type": "cleanup", "complete": False,
                          "resources": [{"id": RESOURCE, "status": "unknown"}]}), flush=True)
        return 1

class ObjectFixture:
    """Independent SigV4 verifier and conditional byte store with controlled faults."""
    def __init__(self):
        self.objects = {}
        self.modes = {}
        self.events = []
        self.bad_signatures = []
        self.blocked = threading.Event()
        self.release = threading.Event()
        self.lock = threading.RLock()
        self.redirect_hits = []
        fixture = self
        class Sink(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_GET(self):
                fixture.redirect_hits.append(True)
                self.send_response(200); self.end_headers(); self.wfile.write(b"redirect sink")
            do_PUT = do_GET
        self.sink = ThreadingHTTPServer(("127.0.0.1", 0), Sink)
        self.sink.daemon_threads = True
        self.sink_thread = threading.Thread(target=self.sink.serve_forever, daemon=True)
        self.sink_thread.start()
        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"
            def log_message(self, *args): pass
            def reply(self, status, data=b"", *, length=None, headers=None):
                self.send_response(status)
                self.send_header("Content-Length", str(len(data) if length is None else length))
                self.send_header("Connection", "close")
                for key, value in (headers or {}).items(): self.send_header(key, value)
                self.end_headers()
                if data:
                    try: self.wfile.write(data)
                    except (BrokenPipeError, ConnectionResetError): pass
                self.close_connection = True
            def do_GET(self): self.perform()
            def do_PUT(self): self.perform()
            def perform(self):
                length = int(self.headers.get("content-length", "0"))
                body = self.rfile.read(length)
                valid = fixture.signature(self.command, self.path, self.headers, body)
                if not valid:
                    fixture.bad_signatures.append({"method": self.command, "path": self.path})
                    self.reply(403); return
                with fixture.lock:
                    mode = fixture.modes.get(self.path, "")
                    existing = fixture.objects.get(self.path)
                    fixture.events.append({"method": self.command, "path": self.path,
                                           "bytes": len(body), "signature_verified": True,
                                           "conditional": self.headers.get("if-none-match") == "*",
                                           "mode": mode})
                if self.command == "PUT":
                    if self.headers.get("if-none-match") != "*":
                        self.reply(400); return
                    if mode == "reject":
                        self.reply(503, b"synthetic unavailable"); return
                    if mode == "forbidden":
                        self.reply(403, b"synthetic forbidden"); return
                    if mode == "redirect":
                        self.reply(307, headers={"Location": fixture.sink_url + self.path}); return
                    if existing is not None:
                        self.reply(412); return
                    with fixture.lock: fixture.objects[self.path] = body
                    if mode == "crash":
                        fixture.blocked.set()
                        fixture.release.wait(15)
                        self.close_connection = True
                        return
                    if mode == "lost":
                        self.close_connection = True
                        self.connection.shutdown(socket.SHUT_RDWR)
                        return
                    self.reply(200, headers={"ETag": '"untrusted-not-a-checksum"'}); return
                if mode == "forbidden":
                    self.reply(403, b"synthetic forbidden"); return
                if mode == "redirect":
                    self.reply(307, headers={"Location": fixture.sink_url + self.path}); return
                if existing is None:
                    self.reply(404); return
                if mode == "corrupt": existing = b"!" * max(1, len(existing))
                if mode == "overlarge": existing = b"x" * (MAX_BYTES + 1)
                if mode == "truncated":
                    self.reply(200, existing[:max(0, len(existing) - 1)], length=len(existing))
                else:
                    self.reply(200, existing, headers={"ETag": '"untrusted-not-a-checksum"'})
        self.http = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.http.daemon_threads = True
        self.thread = threading.Thread(target=self.http.serve_forever, daemon=True)
        self.thread.start()
        self.port = self.http.server_port
        self.endpoint = "http://127.0.0.1:" + str(self.port)
        self.sink_url = "http://127.0.0.1:" + str(self.sink.server_port)

    @staticmethod
    def signature(method, path, headers, body):
        try:
            auth = re.fullmatch(r"AWS4-HMAC-SHA256 Credential=([^/]+)/([0-9]{8})/([^/]+)/s3/aws4_request, SignedHeaders=([a-z0-9;-]+), Signature=([0-9a-f]{64})",
                                headers.get("Authorization", ""))
            if not auth: return False
            key, date, region, signed, signature = auth.groups()
            if key != KEY or region != REGION: return False
            names = signed.split(";")
            if names != sorted(set(names)): return False
            required = {"host", "x-amz-content-sha256", "x-amz-date", "x-amz-security-token"}
            if method == "PUT": required.add("if-none-match")
            if not required.issubset(names) or headers.get("x-amz-security-token") != TOKEN: return False
            timestamp = headers["x-amz-date"]
            if not re.fullmatch(r"[0-9]{8}T[0-9]{6}Z", timestamp) or timestamp[:8] != date: return False
            body_hash = hashlib.sha256(body).hexdigest()
            if headers["x-amz-content-sha256"] != body_hash: return False
            parsed = urlsplit(path)
            canon_headers = "".join(n + ":" + " ".join(headers[n].strip().split()) + "\n" for n in names)
            request = "\n".join([method, parsed.path, parsed.query, canon_headers, signed, body_hash])
            scope = date + "/" + region + "/s3/aws4_request"
            message = "\n".join(["AWS4-HMAC-SHA256", timestamp, scope, hashlib.sha256(request.encode()).hexdigest()])
            derive = lambda k, v: hmac.new(k, v.encode(), hashlib.sha256).digest()
            signing = derive(derive(derive(derive(("AWS4" + SECRET).encode(), date), region), "s3"), "aws4_request")
            actual = hmac.new(signing, message.encode(), hashlib.sha256).hexdigest()
            return hmac.compare_digest(signature, actual)
        except (KeyError, TypeError, ValueError):
            return False

    def key(self, data, run=None):
        run = RUN if run is None else run
        return "/" + BUCKET + "/hyperfide/v1/" + ORG + "/" + run + "/sha256/" + digest(data)[7:]

    def set_mode(self, data, mode, run=None):
        run = RUN if run is None else run
        self.modes[self.key(data, run)] = mode

    def stop(self):
        self.release.set()
        self.http.shutdown(); self.http.server_close(); self.thread.join(3)
        self.sink.shutdown(); self.sink.server_close(); self.sink_thread.join(3)
        with socket.socket() as probe:
            absent = probe.connect_ex(("127.0.0.1", self.port)) != 0
        expect(absent and not self.thread.is_alive(), "owned HTTP fixture still listening")
        return absent

class Service:
    """Stable facade over the actual identity HTTPS fixture, never a synthetic principal."""
    def __init__(self, base, fixture, database=None, resource_id=None):
        import importlib.util
        self.fixture = fixture
        self.closed = False
        module_path = ROOT / "tests/hyperfide/support/identity_fixture.py"
        spec = importlib.util.spec_from_file_location("hyperfide_actual_identity_fixture", module_path)
        identity = importlib.util.module_from_spec(spec); spec.loader.exec_module(identity)
        self.identity_module = identity
        self.second_credential = None
        self.scope = None
        def setup(f):
            global ORG, RUN, RUN2, SCOPE, DATABASE, RESOURCE
            ORG, RUN = f.ids["organisation"], f.ids["run"]
            RUN2 = identity.uid(); SCOPE = {"organisation_id": ORG, "run_id": RUN}
            DATABASE = f.database
            if resource_id is not None: RESOURCE = resource_id
            self.scope = dict(SCOPE)
            (output_dir() / "database-target.json").write_text(json.dumps({"database": f.database, "resource_id": RESOURCE}) + "\n")
            f.sql("INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch,state) VALUES($1,$2,$3,$4,$5,$6,'RUNNING')",
                  [ORG, RUN2, f.ids["project"], f.ids["spec"], digest(b"artifact-fixture-policy"), f.ids["epoch"]])
            f.env.update({
                "HF_ARTIFACT_S3_ENDPOINT": fixture.endpoint,
                "HF_ARTIFACT_ALLOW_LOOPBACK_HTTP": "1",
                "HF_ARTIFACT_S3_REGION": REGION, "HF_ARTIFACT_S3_BUCKET": BUCKET,
                "HF_ARTIFACT_S3_ACCESS_KEY_ID": KEY, "HF_ARTIFACT_S3_SECRET_ACCESS_KEY": SECRET,
                "HF_ARTIFACT_S3_SESSION_TOKEN": TOKEN, "HF_ARTIFACT_ORGANISATION_ID": ORG,
                "HF_ARTIFACT_ALLOWED_RUN_IDS": json.dumps([RUN, RUN2]),
            })
            # Startup bootstrap only verifies DB-issued principals, so every configured principal is seeded first.
            config = json.loads(f.identity_config.read_text())
            self.second_credential = identity.uid()
            second = dict(config["principals"][0], credential_id=self.second_credential,
                          actor_id=identity.uid(), run_id=RUN2)
            f.seed_fixture_principal(second)
            config["principals"].append(second)
            f.identity_config.write_text(json.dumps(config))
        parameters = inspect.signature(identity.IdentityFixture).parameters
        options = {"database": database or DATABASE} if "database" in parameters else {}
        options["extra_actions"] = ("system.describe",)
        self.auth = identity.IdentityFixture(extra_components=("15.2",), extra_setup=setup, **options)
        self.env = self.auth.env
        self.policy = self.auth.policy
        self.components = self.auth.components
        self.argv = ["node", str(ROOT / "services/hyperfide/dist/control.js"),
                     "--policy", str(self.policy), "--spec-revision", "fixture-identity-v1",
                     "--components", str(self.components), "--module-root",
                     str(ROOT / "services/hyperfide/dist"), "--mode", "stdio"]

    def request(self, action, value, *, component="15.2", env=None, principal_run=None, **obsolete):
        # The default signed principal remains run A even if nested input claims run B.
        run = principal_run or RUN
        body = self.auth.operation(component, action, value, run=run)
        credential = self.second_credential if run == RUN2 else self.auth.ids["operator"]
        original = None
        if env is not None:
            self.auth.stop(); original = self.auth.env; self.auth.env = env; self.auth.start()
        try:
            status, response = self.auth.request(body, credential=credential)
            encoded = json.dumps(response)
            for sensitive in (SECRET, TOKEN, KEY, self.env["DATABASE_URL"]):
                expect(sensitive not in encoded, "service exposed trusted configuration")
            OBSERVATIONS.append({"action": action, "ok": response.get("ok"),
                                 "http_status": status,
                                 "error_code": response.get("error", {}).get("code")})
            return status, response
        finally:
            if original is not None:
                self.auth.stop(); self.auth.env = original; self.auth.start()

    def ok(self, action, value, **options):
        status, response = self.request(action, value, **options)
        expect(status == 200 and response.get("ok") is True,
               "authenticated service refused positive operation: " + str(response.get("error", {}).get("code")))
        return response["result"]

    def reject(self, action, value, code, **options):
        _, response = self.request(action, value, **options)
        expect(response.get("ok") is False
               and response.get("error", {}).get("code") in ({code} if isinstance(code, str) else set(code)),
               "authenticated rejection differs: " + str(response.get("error", {}).get("code")))

    def put(self, data, **changes):
        return self.ok("artifact.object.put", upload(data, **changes),
                       principal_run=changes.get("run_id", RUN))

    def by_id(self, result):
        return dict(self.scope, artifact_id=result["artifact"]["artifact_id"])

    def crash_upload(self, action, value, blob, path):
        fixture = self.fixture
        fixture.blocked.clear(); fixture.release.clear(); fixture.modes[path] = "crash"
        results = []
        def invoke():
            try: results.append(self.request(action, value))
            except Exception as error: results.append(type(error).__name__)
        thread = threading.Thread(target=invoke)
        thread.start()
        try:
            expect(fixture.blocked.wait(10), "authenticated service did not reach real upload crash boundary")
            row = find(blob)
            expect(row["status"] == "PENDING" and row["completed_at"] is None,
                   "artifact became COMPLETE before backend acknowledgement/readback")
            expect(fixture.objects[path] == blob, "actual upload bytes missing at crash boundary")
            self.auth.child.kill(); self.auth.child.communicate(timeout=5)
            expect(self.auth.child.poll() is not None, "killed service process still running")
            self.auth.child = None
        finally:
            fixture.release.set(); fixture.modes[path] = ""
            thread.join(12)
            expect(not thread.is_alive(), "authenticated request thread survived owned service crash")
            if self.auth.child is None:self.auth.start()
        return row

    def close(self):
        if self.closed:return
        self.auth.close(); self.closed = True
        rows = self.auth.sql("SELECT datname FROM pg_database WHERE datname=$1", [self.auth.database], admin=True)
        expect(not rows, "owned authenticated fixture database still exists")
        with socket.socket() as probe:
            expect(probe.connect_ex(("127.0.0.1", self.auth.port)) != 0, "owned HTTPS listener still reachable")


class AuthenticatedArtifactFixture:
    def __init__(self, base, database, resource_id):
        self.objects = ObjectFixture()
        try:self.service = Service(base, self.objects, database=database, resource_id=resource_id)
        except BaseException:self.objects.stop();raise
        self.scope = dict(self.service.scope)
        self.database = self.service.auth.database
    def close(self):
        try:self.service.close()
        finally:self.objects.stop()
        return {"database_observed_absent": True, "https_observed_absent": True,
                "object_fixture_observed_absent": True}

def createAuthenticatedFixture(base, database, resource_id):
    return AuthenticatedArtifactFixture(base, database, resource_id)


def upload(data, **changes):
    value = dict(SCOPE, digest=digest(data), size_bytes=str(len(data)),
                 data_base64=base64.b64encode(data).decode(), retention_class="RUN",
                 retention_until=None, retention_hold=False)
    value.update(changes)
    return value

def verified(result, data=None):
    expect(result["outcome"] == "SUCCEEDED" and result["availability"] == "VERIFIED"
           and result["artifact"]["status"] == "COMPLETE" and result["receipt"] is not None,
           "result claimed success without COMPLETE verified receipt")
    expect(result["authority"] == "NONE" and result["live_qualification"] == "NOT_EVALUATED",
           "component operation fabricated live qualification")
    if data is not None:
        expect(result["artifact"]["digest"] == digest(data)
               and result["artifact"]["size_bytes"] == str(len(data)), "actual byte identity differs")
    receipt = result["receipt"]
    expect(receipt["artifact_id"] == result["artifact"]["artifact_id"]
           and receipt["digest"] == result["artifact"]["digest"]
           and receipt["size_bytes"] == result["artifact"]["size_bytes"]
           and re.fullmatch("sha256:[0-9a-f]{64}", receipt["receipt_id"])
           and receipt["completed_at"], "receipt does not bind artifact content and completion")

def unavailable(service, action, value, *, availability=None, codes=()):
    status, response = service.request(action, value)
    if response.get("ok") is False:
        expect(response["error"]["code"] in codes, "unexpected failure code " + str(response["error"]["code"]))
        return
    result = response["result"]
    expect(result["availability"] != "VERIFIED" and result["receipt"] is None,
           "unavailable or corrupt bytes accepted as complete evidence")
    if availability: expect(result["availability"] == availability, "availability classification differs")
    expect(result["outcome"] == "UNKNOWN", "uncertain external outcome lost explicit UNKNOWN")

def seed():
    sql(f"""
INSERT INTO hyperfide.organisations(id,name) VALUES('{ORG}','task15.2-fixture');
INSERT INTO hyperfide.projects(organisation_id,id,name)
 VALUES('{ORG}','15000000-0000-4000-8000-000000000002','task15.2-fixture');
INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version)
 VALUES('{ORG}','15000000-0000-4000-8000-000000000002','15000000-0000-4000-8000-000000000004',
 'sha256:'||encode(sha256(convert_to('fixture','UTF8')),'hex'),'fixture','{{}}',1);
INSERT INTO hyperfide.runs(organisation_id,id,project_id,spec_revision_id,policy_digest,authority_epoch)
 SELECT '{ORG}', id::uuid,'15000000-0000-4000-8000-000000000002','15000000-0000-4000-8000-000000000004',
 'sha256:'||repeat('c',64),'15000000-0000-4000-8000-000000000099'
 FROM unnest(ARRAY['{RUN}','{RUN2}']) id;
""")

def main():
    fixture = ObjectFixture()
    service = None
    closed = False
    try:
        with tempfile.TemporaryDirectory(prefix="hyperfide-15-2-") as directory:
            service = Service(Path(directory), fixture)
            def linked():
                result = service.ok("system.describe", {}, component="system")
                entries = [c for c in result["components"] if c["id"] == "15.2"]
                expect(len(entries) == 1 and set(entries[0]["actions"]) == set(ACTIONS),
                       "actual established service has not linked task15.2 actions")
            check("artifacts.service.registered", linked)
            initial = b"complete immutable fixture log\n"
            first = {}
            def roundtrip():
                result = service.put(initial); verified(result, initial); first.update(result)
                row = find(initial)
                expect(row["status"] == "COMPLETE" and row["completed_at"]
                       and row["storage_key"] == fixture.key(initial).split("/" + BUCKET + "/", 1)[1],
                       "PostgreSQL registration differs from durable object binding")
                actual = service.ok("artifact.object.read", service.by_id(result)); verified(actual, initial)
                expect(base64.b64decode(actual["data_base64"]) == initial
                       and fixture.objects[fixture.key(initial)] == initial, "stored/read bytes differ")
            check("artifacts.object.roundtrip", roundtrip)
            check("artifacts.object.empty", lambda: verified(service.put(b""), b""))
            def replay():
                result = service.put(initial); verified(result, initial)
                expect(result["receipt"] == first["receipt"]
                       and result["artifact"] == first["artifact"], "replay replaced immutable identity")
                expect(len([r for r in artifacts() if r["digest"] == digest(initial)]) == 1,
                       "replay duplicated PostgreSQL registration")
            check("artifacts.object.receipt-replay", replay)
            def preexisting():
                data = b"provider already contains matching object"
                fixture.objects[fixture.key(data)] = data
                verified(service.put(data), data)
                expect(any(e["method"] == "PUT" and e["path"] == fixture.key(data)
                           and e["conditional"] for e in fixture.events), "conditional write was omitted")
            check("artifacts.object.conditional-existing", preexisting)
            crash_data = b"kill service after real upload before registration"
            def crash():
                service.crash_upload("artifact.object.put", upload(crash_data), crash_data,
                                     fixture.key(crash_data))
            check("artifacts.object.pending-before-http", crash)
            def reconcile_crash():
                row = find(crash_data)
                result = service.ok("artifact.object.reconcile", dict(SCOPE, artifact_id=row["id"]))
                verified(result, crash_data)
                expect(find(crash_data)["id"] == row["id"], "reconciliation replaced prior intent identity")
            check("artifacts.object.crash-upload-registration", reconcile_crash)
            pending_data = b"pending intent with no uploaded bytes"
            pending = {}
            def pending_absent():
                fixture.set_mode(pending_data, "reject")
                result = service.put(pending_data)
                expect(result["outcome"] == "UNKNOWN" and result["availability"] in {"ABSENT", "UNKNOWN"}
                       and result["artifact"]["status"] == "PENDING" and result["receipt"] is None,
                       "failed upload became completed evidence")
                pending.update(result)
                expect(find(pending_data)["status"] == "PENDING", "upload intent was not durable")
                listed = service.ok("artifact.pending.list", SCOPE)
                expect(pending["artifact"]["artifact_id"] in json.dumps(listed), "pending intent not inventoried")
                fixture.set_mode(pending_data, "")
                verified(service.put(pending_data), pending_data)
            check("artifacts.object.pending-absent-recovery", pending_absent)
            def ambiguous():
                data = b"object written but HTTP acknowledgement lost"
                fixture.set_mode(data, "lost")
                result = service.put(data); verified(result, data)
                expect(len([e for e in fixture.events if e["path"] == fixture.key(data)
                            and e["method"] == "PUT"]) == 1, "ambiguous write was blindly retried")
            check("artifacts.object.ambiguous-upload-reconcile", ambiguous)
            def object_fault(name, mode, *, absence=None, remove=False):
                data = ("isolated-" + name).encode()
                result = service.put(data); verified(result, data)
                if remove: fixture.objects.pop(fixture.key(data))
                else: fixture.set_mode(data, mode)
                unavailable(service, "artifact.object.inspect", service.by_id(result),
                            availability=absence, codes=("ARTIFACT_INTEGRITY", "ARTIFACT_BACKEND_REJECTED",
                                                         "ARTIFACT_NOT_FOUND"))
                if remove: fixture.objects[fixture.key(data)] = data
                fixture.set_mode(data, "")
            check("artifacts.object.forbidden-not-absent",
                  lambda: object_fault("forbidden", "forbidden", absence="UNKNOWN"))
            check("artifacts.object.missing-complete",
                  lambda: object_fault("missing", "", absence="ABSENT", remove=True))
            check("artifacts.object.corrupt-complete", lambda: object_fault("corrupt", "corrupt"))
            check("artifacts.object.truncated", lambda: object_fault("truncated", "truncated"))
            check("artifacts.object.overlarge", lambda: object_fault("overlarge", "overlarge"))
            def corrupt_precondition():
                data = b"existing object must match content after 412"
                fixture.objects[fixture.key(data)] = b"corrupt existing object"
                service.reject("artifact.object.put", upload(data), "ARTIFACT_INTEGRITY")
                expect(find(data)["status"] != "COMPLETE", "corrupt preexisting object registered COMPLETE")
            check("artifacts.object.corrupt-precondition", corrupt_precondition)
            def redirect():
                data = b"redirect must not forward trusted S3 credentials"
                fixture.set_mode(data, "redirect")
                unavailable(service, "artifact.object.put", upload(data),
                            codes=("ARTIFACT_BACKEND_REJECTED",))
                expect(not fixture.redirect_hits, "HTTP redirect followed with credential-bearing request")
            check("artifacts.object.redirect-no-forwarding", redirect)
            def binding_conflict():
                before = len(fixture.events)
                service.reject("artifact.object.put", upload(initial, retention_class="RELEASE"),
                               "ARTIFACT_BINDING_CONFLICT")
                expect(len(fixture.events) == before, "conflicting binding performed remote mutation")
            check("artifacts.object.binding-conflict", binding_conflict)
            def scope():
                before_http, before_pg = len(fixture.events), artifacts()
                service.reject("artifact.object.put", upload(b"scope-denied", run_id="15000000-0000-4000-8000-000000000999"),
                               "ARTIFACT_SCOPE_DENIED")
                expect(before_http == len(fixture.events) and before_pg == artifacts(),
                       "scope rejection occurred after side effects")
            check("artifacts.scope.before-effects", scope)
            check("artifacts.scope.cross-run-read", lambda: service.reject("artifact.object.read",
                  dict(SCOPE, run_id=RUN2, artifact_id=first["artifact"]["artifact_id"]), "ARTIFACT_NOT_FOUND", principal_run=RUN2))
            check("artifacts.scope.nested-run-spoof", lambda: service.reject("artifact.object.put", upload(b"wrong-local-policy-run", run_id=RUN2), "ARTIFACT_SCOPE_DENIED"))
            def invalid(field, value):
                data = upload(b"invalid-input-" + field.encode())
                data[field] = value
                before_http, before_pg = len(fixture.events), artifacts()
                service.reject("artifact.object.put", data, ("ARTIFACT_INTEGRITY", "ARTIFACT_INPUT_INVALID") if field in {"digest", "size_bytes"} else "ARTIFACT_INPUT_INVALID")
                expect(before_http == len(fixture.events) and before_pg == artifacts(),
                       "invalid request produced remote/database effects")
            check("artifacts.input.digest", lambda: invalid("digest", "sha256:" + "0" * 64))
            check("artifacts.input.size", lambda: invalid("size_bytes", "999"))
            check("artifacts.input.base64", lambda: invalid("data_base64", "!!!!"))
            check("artifacts.input.unknown", lambda: invalid("endpoint", "http://attacker.invalid"))
            check("artifacts.input.oversize", lambda: service.reject("artifact.object.put",
                  upload(b"x" * (MAX_BYTES + 1)), "ARTIFACT_INPUT_INVALID"))
            check("artifacts.input.retention", lambda: invalid("retention_class", "FOREVER"))
            def config():
                env = dict(service.env, HF_ARTIFACT_S3_ENDPOINT="http://example.invalid/unsafe")
                before = len(fixture.events)
                service.reject("artifact.object.put", upload(b"invalid-config"), "ARTIFACT_CONFIG_INVALID", env=env)
                expect(before == len(fixture.events), "untrusted HTTP configuration reached network")
            check("artifacts.config.endpoint", config)
            chunks = [b"ordered stream chunk zero\n", b"ordered stream chunk one\n"]
            children = [service.put(data) for data in chunks]
            manifest = dict(SCOPE, expected_chunks=2, total_size_bytes=str(sum(map(len, chunks))),
                            content_digest=digest(b"".join(chunks)), complete=True, truncated=False,
                            missing_ranges=[], retention_class="RUN", retention_until=None, retention_hold=False,
                            chunks=[{"sequence": n, "artifact_id": children[n]["artifact"]["artifact_id"],
                                     "digest": digest(data), "size_bytes": str(len(data)),
                                     "offset_bytes": str(sum(map(len, chunks[:n])))}
                                    for n, data in enumerate(chunks)])
            parent = {}
            def complete():
                result = service.ok("artifact.manifest.commit", manifest); verified(result); parent.update(result)
                expect(result["content_digest"] == manifest["content_digest"] and result["chunk_count"] == 2
                       and result["manifest_digest"] == result["artifact"]["digest"],
                       "manifest identity conflated with concatenated stream digest")
                data = fixture.objects["/" + BUCKET + "/" + result["artifact"]["storage_key"]]
                expect(digest(data) == result["manifest_digest"], "canonical manifest stored bytes mismatch")
                stored = json.loads(data)
                expect(stored["chunks"] == manifest["chunks"], "stored manifest lost ordered references")
                edges = rows("SELECT coalesce(json_agg(t ORDER BY sequence),'[]') FROM "
                             "(SELECT sequence,child_artifact_id::text,offset_bytes::text,size_bytes::text "
                             "FROM hyperfide.artifact_dependencies WHERE parent_artifact_id='" +
                             result["artifact"]["artifact_id"] + "') t;")
                expect(len(edges) == 2 and [e["child_artifact_id"] for e in edges]
                       == [c["artifact_id"] for c in manifest["chunks"]], "database lost manifest dependencies")
            check("artifacts.manifest.ordered-complete", complete)
            def read_manifest():
                result = service.ok("artifact.manifest.read", service.by_id(parent))
                verified(result)
                expect(result["content_digest"] == manifest["content_digest"]
                       and result["manifest"]["chunks"] == manifest["chunks"],
                       "manifest.read did not return verified canonical ordered references")
            check("artifacts.manifest.read", read_manifest)
            def replay_manifest():
                result = service.ok("artifact.manifest.commit", manifest)
                expect(result["receipt"] == parent["receipt"] and result["artifact"] == parent["artifact"],
                       "manifest replay changed receipt or row")
            check("artifacts.manifest.replay", replay_manifest)
            def empty_manifest():
                value = dict(manifest, expected_chunks=0, total_size_bytes="0",
                             content_digest=digest(b""), chunks=[])
                verified(service.ok("artifact.manifest.commit", value))
            check("artifacts.manifest.empty", empty_manifest)
            def bad_manifest(mutator, codes="ARTIFACT_MANIFEST_INVALID"):
                value = copy.deepcopy(manifest); mutator(value)
                before = len(artifacts())
                service.reject("artifact.manifest.commit", value, codes)
                expect(len(artifacts()) == before, "invalid/incomplete manifest created parent metadata")
            check("artifacts.manifest.gap", lambda: bad_manifest(lambda v: v["chunks"][1].update(sequence=2)))
            check("artifacts.manifest.reordered", lambda: bad_manifest(lambda v: v["chunks"].reverse()))
            check("artifacts.manifest.offset", lambda: bad_manifest(lambda v: v["chunks"][1].update(offset_bytes="0")))
            check("artifacts.manifest.truncated", lambda: bad_manifest(lambda v: v.update(truncated=True)))
            check("artifacts.manifest.missing-range", lambda: bad_manifest(lambda v: v.update(missing_ranges=[[1, 2]])))
            check("artifacts.manifest.count", lambda: bad_manifest(lambda v: v.update(expected_chunks=3)))
            check("artifacts.manifest.total", lambda: bad_manifest(lambda v: v.update(total_size_bytes="1")))
            check("artifacts.manifest.content-hash", lambda: bad_manifest(lambda v: v.update(content_digest=digest(b"wrong")),
                                                                       ("ARTIFACT_MANIFEST_INVALID", "ARTIFACT_INTEGRITY")))
            check("artifacts.manifest.chunk-hash", lambda: bad_manifest(lambda v: v["chunks"][0].update(digest=digest(b"wrong")),
                                                                     ("ARTIFACT_MANIFEST_INVALID", "ARTIFACT_BINDING_CONFLICT", "ARTIFACT_INTEGRITY")))
            not_uploaded = b"never uploaded child payload"
            fixture.set_mode(not_uploaded, "reject")
            pending_child = service.put(not_uploaded)
            check("artifacts.manifest.pending-child", lambda: bad_manifest(
                lambda v: v["chunks"][0].update(artifact_id=pending_child["artifact"]["artifact_id"]),
                ("ARTIFACT_MANIFEST_INVALID", "ARTIFACT_NOT_COMPLETE", "ARTIFACT_BINDING_CONFLICT")))
            foreign = service.put(chunks[0], run_id=RUN2)
            check("artifacts.manifest.foreign-child", lambda: bad_manifest(
                lambda v: v["chunks"][0].update(artifact_id=foreign["artifact"]["artifact_id"]),
                ("ARTIFACT_MANIFEST_INVALID", "ARTIFACT_NOT_FOUND")))
            def child_fault(mode):
                fixture.set_mode(chunks[0], mode)
                try:
                    unavailable(service, "artifact.manifest.read", service.by_id(parent),
                                codes=("ARTIFACT_INTEGRITY", "ARTIFACT_BACKEND_REJECTED"))
                finally: fixture.set_mode(chunks[0], "")
            check("artifacts.manifest.corrupt-child", lambda: child_fault("corrupt"))
            def missing_child():
                value = fixture.objects.pop(fixture.key(chunks[1]))
                try:
                    unavailable(service, "artifact.manifest.commit", manifest,
                                codes=("ARTIFACT_NOT_FOUND", "ARTIFACT_MANIFEST_INVALID", "ARTIFACT_INTEGRITY", "ARTIFACT_NOT_COMPLETE"))
                finally: fixture.objects[fixture.key(chunks[1])] = value
            check("artifacts.manifest.missing-child", missing_child)
            def retention():
                data = b"explicit release retention metadata"
                result = service.put(data, retention_class="LEGAL_HOLD", retention_hold=True,
                                     retention_until="2099-01-01T00:00:00.000Z")
                verified(result, data)
                row = find(data)
                expect(row["retention_class"] == "LEGAL_HOLD" and row["retention_hold"] is True
                       and row["retention_until"].startswith("2099-01-01"), "retention metadata not persisted")
                expect(result["artifact"]["retention_class"] == "LEGAL_HOLD"
                       and result["artifact"]["retention_hold"] is True, "retention metadata missing on receipt envelope")
            check("artifacts.retention.metadata", retention)
            def retained_children():
                child = children[0]["artifact"]["artifact_id"]
                result = sql("UPDATE hyperfide.artifacts SET status='DELETED',state_version=state_version+1 "
                             "WHERE id='" + child + "';", allow_error=True)
                expect(result.returncode != 0 and find(chunks[0])["status"] == "COMPLETE",
                       "referenced chunk became unavailable while COMPLETE parent retained it")
            check("artifacts.retention.children", retained_children)
            opaque = b'{"credential_reference":"opaque-secret-manager-label","secret_key":"documentation-not-a-live-secret"}'
            check("artifacts.object.opaque-payload", lambda: verified(service.put(opaque), opaque))
            def promotion_bypass():
                payload = b"manifest promotion must retain child closure"
                child_result = service.put(payload)
                chunk = {"sequence": 0, "artifact_id": child_result["artifact"]["artifact_id"],
                         "digest": digest(payload), "size_bytes": str(len(payload)), "offset_bytes": "0"}
                candidate = dict(manifest, expected_chunks=1, total_size_bytes=str(len(payload)),
                                 content_digest=digest(payload), chunks=[chunk])
                serialized = {"schema_version": 1, "kind": "chunk-manifest", **SCOPE,
                              "expected_chunks": 1, "total_size_bytes": str(len(payload)),
                              "content_digest": digest(payload), "complete": True,
                              "truncated": False, "missing_ranges": [], "chunks": [chunk]}
                blob = json.dumps(serialized, separators=(",", ":"), ensure_ascii=False).encode()
                path = "/" + BUCKET + "/hyperfide/v1/" + ORG + "/" + RUN + "/manifests/sha256/" + digest(blob)[7:]
                row = service.crash_upload("artifact.manifest.commit", candidate, blob, path)
                service.reject("artifact.object.put", upload(blob), "ARTIFACT_BINDING_CONFLICT")
                service.reject("artifact.object.reconcile", dict(SCOPE, artifact_id=row["id"]),
                               "ARTIFACT_NOT_COMPLETE")
                expect(find(blob)["status"] == "PENDING", "raw API bypassed manifest closure")
                recovered = service.ok("artifact.manifest.commit", candidate)
                verified(recovered)
                expect(recovered["artifact"]["artifact_id"] == row["id"],
                       "proper recovery replaced immutable manifest identity")
            check("artifacts.manifest.promotion-bypass", promotion_bypass)
            def signatures():
                expect(not fixture.bad_signatures and len(fixture.events) > 10,
                       "independent S3 verifier rejected product requests")
                expect(all(e["signature_verified"] and (e["method"] != "PUT" or e["conditional"])
                           for e in fixture.events), "unsigned/unconditional request reached object fixture")
                expect(any(e["method"] == "GET" for e in fixture.events)
                       and any(e["method"] == "PUT" for e in fixture.events), "missing real object I/O")
            check("artifacts.http.independent-sigv4", signatures)
            def sanitized():
                encoded = json.dumps(OBSERVATIONS)
                expect(all(value not in encoded for value in [SECRET, TOKEN, KEY, service.env["DATABASE_URL"]]),
                       "observations leaked trusted configuration")
                expect(artifacts(), "no actual database observations")
            check("artifacts.secrets.sanitized", sanitized)


            def locate_after_id_loss():
                blob = b"locate complete object after caller lost its id"
                original = service.put(blob)
                found = service.ok("artifact.object.locate", dict(SCOPE, digest=digest(blob), expected_size_bytes=str(len(blob))))
                verified(found, blob)
                expect(found["artifact"]["artifact_id"] == original["artifact"]["artifact_id"]
                       and found["receipt"] == original["receipt"], "scoped lookup changed durable object identity")
            check("artifacts.object.locate-id-loss", locate_after_id_loss)

            def locate_absent_metadata():
                before = len(fixture.events)
                found = service.ok("artifact.object.locate", dict(SCOPE, digest=digest(b"never registered lookup"), expected_size_bytes="23"))
                expect(found["outcome"] == "NOT_FOUND" and found["metadata_state"] == "ABSENT"
                       and found["availability"] == "NOT_EVALUATED" and found["receipt"] is None
                       and found["retry_authority"] == "NONE" and len(fixture.events) == before,
                       "missing metadata was confused with confirmed physical absence or retry authority")
            check("artifacts.object.locate-absent", locate_absent_metadata)

            def locate_pending():
                blob = b"read-only locate retains incomplete upload"
                fixture.set_mode(blob, "reject")
                pending = service.put(blob)
                expect(pending["artifact"]["status"] == "PENDING", "fixture did not preserve upload intent")
                before = len(fixture.events)
                found = service.ok("artifact.object.locate", dict(SCOPE, digest=digest(blob), expected_size_bytes=str(len(blob))))
                expect(found["outcome"] == "UNKNOWN" and found["artifact"]["status"] == "PENDING"
                       and found["receipt"] is None and found["requires_reconciliation"] is True
                       and found["artifact"]["artifact_id"] == pending["artifact"]["artifact_id"]
                       and len(fixture.events) == before, "lookup promoted or retried an incomplete upload")
                fixture.set_mode(blob, "")
            check("artifacts.object.locate-pending", locate_pending)

            def raw_stdio_denied():
                frame = {"id": "artifact-stdio-auth-probe", "component": "15.2",
                         "action": "artifact.pending.list", "input": dict(SCOPE)}
                child = subprocess.run(service.argv, input=json.dumps(frame) + "\n", text=True,
                                       cwd=ROOT, env=service.env, capture_output=True, timeout=15)
                rows = [json.loads(line) for line in child.stdout.splitlines() if line.startswith("{")]
                response = next((row for row in rows if row.get("id") == frame["id"]), None)
                expect(child.returncode == 1 and response is not None and response.get("ok") is False
                       and response.get("error", {}).get("code") == "AUTH_REQUIRED",
                       "unauthenticated stdio result differs: " + json.dumps({"exit": child.returncode, "responses": rows, "stderr": child.stderr[:400]}))
            check("artifacts.auth.stdio-required", raw_stdio_denied)

            def forged_context_denied():
                script = """import {createArtifactStore} from './services/hyperfide/dist/artifacts/objects.js';
const context={env:{},signal:new AbortController().signal,invocation:{principal:{organisation_id:'fixture'},guard:async()=>{},signal:new AbortController().signal}};
try{await createArtifactStore(context).invoke('artifact.pending.list',{});process.exitCode=2;}catch(e){console.log(e.code);if(e.code!=='AUTH_REQUIRED')process.exitCode=3;}"""
                child = subprocess.run(["node", "--input-type=module", "-e", script],
                                       cwd=ROOT, env=service.env, text=True,
                                       capture_output=True, timeout=15)
                expect(child.returncode == 0 and child.stdout.strip() == "AUTH_REQUIRED",
                       "structurally forged internal invocation acquired authority")
            check("artifacts.auth.forged-context", forged_context_denied)

            def revoke_during_upload():
                blob = b"artifact-auth-revocation-mid-upload"
                path = fixture.key(blob)
                fixture.blocked.clear(); fixture.release.clear(); fixture.modes[path] = "crash"
                responses = []
                thread = threading.Thread(target=lambda: responses.append(service.request(
                    "artifact.object.put", upload(blob))))
                thread.start()
                try:
                    expect(fixture.blocked.wait(10), "real PUT did not reach revocation boundary")
                    row = find(blob)
                    expect(row["status"] == "PENDING" and fixture.objects[path] == blob,
                           "upload intent/physical bytes not observed before revocation")
                    service.auth.sql("UPDATE hyperfide.identity_principals SET state='REVOKED',credential_version=credential_version+1 WHERE credential_id=$1",
                                     [service.auth.ids["operator"]])
                finally:
                    fixture.release.set(); fixture.modes[path] = ""
                    thread.join(15)
                expect(not thread.is_alive() and len(responses) == 1, "revoked upload did not settle")
                status, response = responses[0]
                expect(response.get("ok") is False and response.get("error", {}).get("code") == "AUTH_REVOKED",
                       "mid-upload revocation differs: " + str(status) + ":" + str(response.get("error", {}).get("code")))
                row = find(blob)
                expect(row["status"] == "PENDING" and row["completed_at"] is None,
                       "revoked caller completed artifact metadata")
            check("artifacts.auth.revoked-mid-upload", revoke_during_upload)

            expect(CHECKED == IDS, "registered assertion execution inventory differs")
    finally:
        closed = fixture.stop()
        (output_dir() / "observations.json").write_text(json.dumps({
            "scope": "task-component", "live_storage_durability": "NOT_EVALUATED",
            "assertion_ids": CHECKED, "failed_ids": FAILED, "service_operations": OBSERVATIONS,
            "http_operations": fixture.events, "independently_rejected_signatures": fixture.bad_signatures,
            "redirect_target_requests": len(fixture.redirect_hits), "http_fixture_observed_absent": closed,
            "postgresql_version": sql("SHOW server_version;", database=urlsplit(os.environ["DATABASE_URL"]).path.lstrip("/")).stdout.strip(),
            "package_lock_sha256": hashlib.sha256((ROOT / "services/hyperfide/package-lock.json").read_bytes()).hexdigest()
        }, sort_keys=True) + "\n")
        if service is not None:service.close()
    return 1 if FAILED else 0

if __name__ == "__main__":
    raise SystemExit(cleanup() if "--cleanup" in sys.argv else main())
