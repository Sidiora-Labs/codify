#!/usr/bin/env python3
"""Task 12.2 component probe: durable local start ledger and supervisor-owned
agent IPC across reconnects, driven through the linked native binary.

The coordinator-side 12.2 dispatch route (services/hyperfide/src/runner/dispatch.ts)
is exercised through the real HTTPS control service on a disposable PostgreSQL
database: without a trusted 13.4 plan reader it stays NOT_READY, never issues a
START and never claims launch authority.

Two separate processes talk over real HTTPS: this file re-executed with
``--coordinator`` is a local TLS coordinator implementing the 6.3 runner
command route (``instructions.runner.poll``/``handoff``/``ack``), 1.1 runner
placement and the assumed 12.2 structured-event ingest, and it verifies the
12.1 Ed25519 request proof on every call. The supervisor is
``build/hyperfide-native --component 12.2 --action launch.serve``. Transport is
interrupted around the spawn/ack windows and both processes are killed and
restarted. The agent is the pinned root-owned GNU sed in pass-through mode, so every stdin
frame it receives is visible exactly once in the durable stdout spool.

This bounded component probe grants no frontier dispatch, connector or task
qualification; real connector plans await task 13.1 qualification.
"""
import base64, ctypes, fcntl, hashlib, json, os, pathlib, signal, socket, sqlite3, ssl, subprocess, sys, tempfile, threading, time, traceback, uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = pathlib.Path(__file__).resolve().parents[4]
NATIVE = ROOT / "build/hyperfide-native"
# GNU sed in unbuffered pass-through mode echoes each stdin frame exactly once.
# (Multicall binaries such as uutils refuse fexecve because argv0 resolves to "3".)
AGENT = os.path.realpath("/usr/bin/sed")
AGENT_ARGV = [AGENT, "-u", ""]
LEASE_MS = 120000
ASSERTIONS = [
    "runner.root-fixture",
    "transport.separate-https-coordinator",
    "transport.rejects-forged-request-proof",
    "launch.serve-poll-spawns-agent",
    "launch.durable-accept-before-spawn",
    "launch.lost-handoff-redelivered-single-start",
    "ack.lost-responses-replayed-idempotently",
    "steer.delivered-once",
    "steer.redelivery-not-rewritten",
    "steer.duplicate-frame-not-replayed",
    "supervisor.kill-leaves-broker-and-agent",
    "controller.outage-agent-stdin-open",
    "reconcile.live-broker-adopted",
    "reconcile.adoption-single-owner",
    "reconnect.backoff-bounded",
    "reconnect.steer-after-restart-delivered",
    "start.no-duplicate-logical-start",
    "reconcile.accepted-without-broker-not-spawned",
    "reconcile.unattributed-process-uncertain",
    "reconcile.dead-broker-lost",
    "reconcile.reused-pid-not-adopted",
    "reconcile.orphan-reported-without-stdin",
    "reconcile.no-blind-relaunch",
    "cancel.orphan-stopped-without-broker",
    "steer.before-start-not-written",
    "cancel.before-start-fences-launch",
    "cancel.stale-generation-not-applied",
    "cancel.current-generation-stops",
    "evidence.spool-digest-uploaded",
    "broker.retires-after-delivery",
    "spool.replayed-without-duplicates",
    "serve.summary-bounded",
    "dispatch.describe-not-ready",
    "dispatch.consume-plan-reader-not-ready",
    "dispatch.consume-rejects-invalid-claim",
    "dispatch.consume-rejects-unknown-field",
]
RESOURCE = "runner-dispatch-database"
# Dependency closure of services/hyperfide/components/12.2.json (fragment files by id).
DISPATCH_COMPONENTS = ["2.1", "2.4", "3.1", "3.2", "5.1", "5.2", "6.1", "6.2", "6.3", "7.2", "7.3", "12.2"]
RESULTS = {}


def uid():
    return str(uuid.uuid4())


def sha(data):
    return "sha256:" + hashlib.sha256(data).hexdigest()


def canonical(value):
    return json.dumps(value, separators=(",", ":"), sort_keys=True, ensure_ascii=False).encode()


def b64(data):
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def unb64(text):
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def check(name, ok, detail=None):
    RESULTS[name] = bool(ok)
    if not ok:
        print("assertion failed: %s %s" % (name, json.dumps(detail, default=str)[:2000] if detail is not None else ""), file=sys.stderr, flush=True)


def wait_for(predicate, seconds, step=0.1):
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = predicate()
        if value:
            return value
        time.sleep(step)
    return predicate()


# --------------------------------------------------------------------------
# Coordinator process (separate HTTPS server)
# --------------------------------------------------------------------------
class Coordinator:
    def __init__(self, directory):
        self.dir = pathlib.Path(directory)
        self.cfg = json.loads((self.dir / "coordinator.json").read_text())
        self.state_path = self.dir / "state.json"
        self.lock = threading.Lock()
        if self.state_path.exists():
            self.state = json.loads(self.state_path.read_text())
        else:
            self.state = {"instructions": [], "acks": {}, "ack_posts": 0, "ack_conflicts": 0, "ack_rejects": [],
                          "events": {}, "event_posts": 0, "event_conflicts": 0, "event_rejects": [], "sequences": {},
                          "handoffs": {}, "polls": 0, "placements": 0, "nonces": [], "proof_rejects": 0,
                          "drops": [], "dropped": 0, "observations": []}
        self.nonces = set(self.state["nonces"])

    def save(self):
        self.state["nonces"] = sorted(self.nonces)[-5000:]
        temporary = self.state_path.with_suffix(".tmp")
        temporary.write_text(json.dumps(self.state))
        os.replace(temporary, self.state_path)

    def verify(self, headers, body):
        c = self.cfg
        try:
            seconds, nonce = headers.get("HF-Request-Time", ""), headers.get("HF-Request-Nonce", "")
            signature, credential = headers.get("HF-Request-Signature", ""), headers.get("HF-Credential-Id", "")
            if credential != c["credential_id"] or abs(int(seconds) - time.time()) > 300 or nonce in self.nonces:
                return None
            uuid.UUID(nonce)
            message = "HYPERFIDE-REQUEST-V1\nPOST\n/v1/invoke\n%s\n%s\n%s\n%s\nsha256:%s\n" % (
                c["origin"], credential, seconds, nonce, hashlib.sha256(body).hexdigest())
            raw = unb64(signature)
            if len(raw) != 64:
                return None
            with tempfile.TemporaryDirectory(dir=self.dir) as work:
                (pathlib.Path(work) / "m").write_bytes(message.encode())
                (pathlib.Path(work) / "s").write_bytes(raw)
                verified = subprocess.run(["openssl", "pkeyutl", "-verify", "-pubin", "-inkey", c["runner_public_key"], "-rawin",
                                           "-in", work + "/m", "-sigfile", work + "/s"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode == 0
            if not verified:
                return None
            envelope = json.loads(body)
            payload_bytes = unb64(envelope["payload_b64"])
            if envelope.get("protocol_version") != 1 or sha(payload_bytes) != envelope["payload_digest"]:
                return None
            payload = json.loads(payload_bytes)
            if payload.get("run_id") != c["run_id"]:
                return None
            self.nonces.add(nonce)
            return payload
        except Exception:
            return None

    def packet(self, ins, now):
        body = canonical(ins["body"])
        return {"accepted": True, "command_id": ins["id"], "operation_id": ins["id"], "organisation_id": self.cfg["organisation_id"],
                "run_id": self.cfg["run_id"], "attempt_id": ins["attempt_id"], "attempt_generation": ins["attempt_generation"],
                "authority_epoch": self.cfg["authority_epoch"], "sandbox_id": self.cfg["sandbox_id"], "boot_id": self.cfg["boot_id"],
                "sandbox_boot_generation": self.cfg["boot_generation"], "sequence": ins["sequence"], "kind": ins["kind"],
                "payload_base64url": b64(body), "payload_digest": sha(body), "observed_at": now, "lease_expires_at": now + LEASE_MS / 1000,
                "remaining_lease_ms": LEASE_MS, "state": "READY_FOR_NATIVE_ACCEPTANCE", "execution": "PENDING_NATIVE_CONNECTOR"}

    def find(self, command):
        return next((i for i in self.state["instructions"] if i["id"] == command), None)

    def native_observed(self, command):
        return any(key.startswith(command + ":") for key in self.state["acks"])

    def handle(self, payload):
        component, action, value = payload.get("component"), payload.get("action"), payload.get("input")
        c, now = self.cfg, time.time()
        if (component, action) == ("1.1", "placement.runner.authorize"):
            self.state["placements"] += 1
            if value != {"runner_action": "runner.agent.launch"}:
                return 403, {"ok": False, "error": {"code": "PLACEMENT_DENIED"}}
            return 200, {"ok": True, "result": {"authorized": True, "runner_action": "runner.agent.launch", "job_class": "implementation",
                                                "tool": "native.spawn", "location": "REMOTE_EXECUTION", "boot_generation": c["boot_generation"]}}
        if (component, action) == ("6.3", "instructions.handoff"):
            if set(value) != {"organisation_id", "run_id", "event_id", "consumer_id"} or value["consumer_id"] != c["consumer_id"]:
                return 403, {"ok": False, "error": {"code": "AUTH_SCOPE_DENIED"}}
            ins = self.find(value["event_id"])
            if not ins:
                return 404, {"ok": False, "error": {"code": "INSTRUCTION_SPOOL_REQUIRED"}}
            self.state["handoffs"][ins["id"]] = self.state["handoffs"].get(ins["id"], 0) + 1
            return 200, {"ok": True, "result": self.packet(ins, now)}
        if (component, action) == ("6.3", "instructions.runner.poll"):
            if set(value) != {"organisation_id", "run_id", "limit", "lease_ms"} or not 1 <= value["limit"] <= 16 or not 1000 <= value["lease_ms"] <= 30000:
                return 400, {"ok": False, "error": {"code": "EVENT_INPUT_INVALID"}}
            self.state["polls"] += 1
            commands, observations = [], []
            for ins in sorted(self.state["instructions"], key=lambda i: int(i["sequence"])):
                if ins["held"] or ins["delivery"] == "ACKNOWLEDGED" or now < ins["next_attempt_at"]:
                    continue
                if self.native_observed(ins["id"]) and not ins.get("force_redeliver"):
                    ins["delivery"] = "ACKNOWLEDGED"
                    observations.append({"event_id": ins["id"], "status": "NATIVE_LEDGER_OBSERVED", "delivery_acknowledged": True})
                    continue
                if ins["kind"] != "CANCEL" and ins.get("suppress", True) and any(o["kind"] == "CANCEL" and o["attempt_id"] == ins["attempt_id"] for o in self.state["instructions"]):
                    ins["delivery"] = "ACKNOWLEDGED"
                    observations.append({"event_id": ins["id"], "status": "SERVER_SUPPRESSED", "delivery_acknowledged": True})
                    continue
                ins["force_redeliver"] = False
                ins["attempt_count"] += 1
                ins["next_attempt_at"] = now + value["lease_ms"] / 1000
                self.state["handoffs"][ins["id"]] = self.state["handoffs"].get(ins["id"], 0) + 1
                commands.append({"organisation_id": c["organisation_id"], "run_id": c["run_id"], "event_id": ins["id"], "consumer_id": c["consumer_id"],
                                 "attempt_count": str(ins["attempt_count"]), "inbox_id": uid(), "packet": self.packet(ins, now)})
                if len(commands) >= value["limit"]:
                    break
            self.state["observations"] += observations
            return 200, {"ok": True, "result": {"schema_version": 1, "organisation_id": c["organisation_id"], "run_id": c["run_id"], "consumer_id": c["consumer_id"],
                                                "sandbox_id": c["sandbox_id"], "boot_id": c["boot_id"], "boot_generation": c["boot_generation"],
                                                "commands": commands, "observations": observations, "execution_authority": False, "task_qualified": False}}
        if (component, action) == ("6.3", "instructions.ack"):
            self.state["ack_posts"] += 1
            keys = {"organisation_id", "run_id", "command_id", "operation_id", "attempt_id", "attempt_generation", "authority_epoch", "sandbox_id", "boot_id",
                    "sandbox_boot_generation", "sequence", "payload_digest", "ledger_receipt_id", "ledger_version", "state", "observed_process"}
            ins = self.find(value.get("command_id")) if isinstance(value, dict) else None
            reason = None
            if not ins or set(value) != keys:
                reason = "INSTRUCTION_ACK_INVALID"
            elif value["state"] not in ("ACCEPTED", "EXECUTING", "TERMINAL", "UNCERTAIN") or value["operation_id"] != ins["id"] or \
                    (value["state"] == "EXECUTING" and value["observed_process"] is None) or \
                    (value["state"] == "ACCEPTED" and value["observed_process"] is not None):
                reason = "INSTRUCTION_ACK_INVALID"
            elif (value["attempt_id"], value["attempt_generation"], value["authority_epoch"], value["sandbox_id"], value["boot_id"], value["sandbox_boot_generation"], value["sequence"], value["payload_digest"]) != \
                    (ins["attempt_id"], ins["attempt_generation"], c["authority_epoch"], c["sandbox_id"], c["boot_id"], c["boot_generation"], ins["sequence"], sha(canonical(ins["body"]))):
                reason = "INSTRUCTION_ACK_INVALID"
            if reason:
                self.state["ack_rejects"].append(reason)
                return 400, {"ok": False, "error": {"code": reason}}
            key = ins["id"] + ":" + value["ledger_version"]
            prior = self.state["acks"].get(key)
            if prior is not None:
                if prior != value:
                    self.state["ack_conflicts"] += 1
                    return 409, {"ok": False, "error": {"code": "INSTRUCTION_ACK_CONFLICT"}}
                return 200, {"ok": True, "result": {"recorded": True, "replayed": True, "command_id": ins["id"], "ledger_version": value["ledger_version"], "authority": "NONE"}}
            earlier = [v for k, v in self.state["acks"].items() if k.startswith(ins["id"] + ":")]
            pinned = next((v["observed_process"] for v in earlier if v["observed_process"] is not None), None)
            if pinned is not None and value["observed_process"] is not None and pinned != value["observed_process"]:
                self.state["ack_conflicts"] += 1
                return 409, {"ok": False, "error": {"code": "INSTRUCTION_ACK_CONFLICT"}}
            latest = max(earlier, key=lambda v: int(v["ledger_version"]), default=None)
            if latest and int(value["ledger_version"]) > int(latest["ledger_version"]) and (latest["state"] == "TERMINAL" and value["state"] != "TERMINAL" or value["state"] == "ACCEPTED"):
                self.state["ack_conflicts"] += 1
                return 409, {"ok": False, "error": {"code": "INSTRUCTION_ACK_REGRESSION"}}
            self.state["acks"][key] = value
            return 200, {"ok": True, "result": {"recorded": True, "replayed": False, "command_id": ins["id"], "ledger_version": value["ledger_version"], "authority": "NONE"}}
        if (component, action) == ("12.2", "runner.launch.event.record"):
            self.state["event_posts"] += 1
            keys = {"schema_version", "event_id", "organisation_id", "run_id", "sandbox_id", "boot_id", "sandbox_boot_generation", "launch_id", "command_id",
                    "sequence", "kind", "observed_at_seconds", "data"}
            if not isinstance(value, dict) or set(value) != keys or value["schema_version"] != 1 or \
                    (value["organisation_id"], value["run_id"], value["sandbox_id"], value["boot_id"], value["sandbox_boot_generation"]) != \
                    (c["organisation_id"], c["run_id"], c["sandbox_id"], c["boot_id"], c["boot_generation"]) or not isinstance(value["data"], dict):
                self.state["event_rejects"].append("EVENT_INVALID")
                return 400, {"ok": False, "error": {"code": "RUNNER_EVENT_INVALID"}}
            prior = self.state["events"].get(value["event_id"])
            slot = value["launch_id"] + ":" + value["sequence"]
            if prior is not None:
                if prior != value:
                    self.state["event_conflicts"] += 1
                    return 409, {"ok": False, "error": {"code": "RUNNER_EVENT_CONFLICT"}}
                return 200, {"ok": True, "result": {"recorded": True, "replayed": True, "event_id": value["event_id"]}}
            if self.state["sequences"].get(slot, value["event_id"]) != value["event_id"]:
                self.state["event_conflicts"] += 1
                return 409, {"ok": False, "error": {"code": "RUNNER_EVENT_SEQUENCE_CONFLICT"}}
            self.state["sequences"][slot] = value["event_id"]
            self.state["events"][value["event_id"]] = value
            return 200, {"ok": True, "result": {"recorded": True, "replayed": False, "event_id": value["event_id"]}}
        return 404, {"ok": False, "error": {"code": "UNKNOWN_ACTION"}}

    def control(self, request):
        op = request["op"]
        if op == "enqueue":
            ins = dict(request["instruction"])
            ins.update({"delivery": "PENDING", "attempt_count": 0, "next_attempt_at": 0, "force_redeliver": False})
            ins.setdefault("held", False)
            self.state["instructions"].append(ins)
        elif op == "release":
            self.find(request["id"])["held"] = False
        elif op == "redeliver":
            ins = self.find(request["id"])
            ins.update({"delivery": "PENDING", "next_attempt_at": 0, "force_redeliver": True, "held": False})
        elif op == "drop":
            self.state["drops"].append({"action": request["action"], "count": request["count"], "with_commands": request.get("with_commands", False)})
        return {"ok": True, "state": self.state}

    def serve(self):
        coordinator = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def log_message(self, *args):
                pass

            def reply(self, status, value):
                data = json.dumps(value).encode()
                self.send_response(status)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)

            def do_POST(self):
                length = int(self.headers.get("Content-Length", "0"))
                body = self.rfile.read(length) if 0 <= length <= 1048576 else b""
                with coordinator.lock:
                    if self.path == "/control" and self.client_address[0] == "127.0.0.1" and self.headers.get("X-Fixture-Token") == coordinator.cfg["control_token"]:
                        result = coordinator.control(json.loads(body))
                        coordinator.save()
                        return self.reply(200, result)
                    if self.path != "/v1/invoke":
                        return self.reply(404, {"ok": False})
                    payload = coordinator.verify(self.headers, body)
                    if payload is None:
                        coordinator.state["proof_rejects"] += 1
                        coordinator.save()
                        return self.reply(401, {"ok": False, "error": {"code": "AUTHENTICATION_FAILED"}})
                    status, value = coordinator.handle(payload)
                    drop = next((d for d in coordinator.state["drops"] if d["count"] > 0 and d["action"] == payload.get("action") and
                                 (not d["with_commands"] or value.get("result", {}).get("commands"))), None)
                    if drop:
                        drop["count"] -= 1
                        coordinator.state["dropped"] += 1
                    coordinator.save()
                if drop:
                    # Lost response: state committed, acknowledgement never reaches the runner.
                    self.close_connection = True
                    try:
                        self.connection.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass
                    return
                self.reply(status, value)

        server = ThreadingHTTPServer(("127.0.0.1", self.cfg["port"]), Handler)
        server.daemon_threads = True
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.load_cert_chain(self.cfg["cert"], self.cfg["key"])
        server.socket = context.wrap_socket(server.socket, server_side=True)
        print("READY", flush=True)
        server.serve_forever()


# --------------------------------------------------------------------------
# Probe
# --------------------------------------------------------------------------
class Probe:
    def __init__(self):
        self.tmp = pathlib.Path(tempfile.mkdtemp(prefix="hf122-", dir="/tmp"))
        os.chmod(self.tmp, 0o711)
        self.coordinator = None
        self.serve = None
        self.helpers = []
        self.ids = {k: uid() for k in ("organisation", "run", "sandbox", "boot", "epoch", "consumer", "credential")}
        self.generation = "1"
        self.state = self.tmp / "state"
        self.state.mkdir(mode=0o700)
        self.slots = self.tmp / "slots"
        self.slots.mkdir(mode=0o711)
        self.sequence = 0
        self.slot = {}

    def openssl(self, *args):
        subprocess.run(["openssl", *args], check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)

    def setup(self):
        t = self.tmp
        self.openssl("req", "-x509", "-newkey", "rsa:2048", "-sha256", "-nodes", "-keyout", str(t / "tls.key"), "-out", str(t / "ca.pem"),
                     "-subj", "/CN=localhost", "-addext", "subjectAltName=DNS:localhost,IP:127.0.0.1", "-days", "1")
        os.chmod(t / "tls.key", 0o600)
        os.chmod(t / "ca.pem", 0o644)
        self.openssl("genpkey", "-algorithm", "Ed25519", "-out", str(t / "runner.key"))
        os.chmod(t / "runner.key", 0o600)
        self.openssl("pkey", "-in", str(t / "runner.key"), "-pubout", "-out", str(t / "runner.pub"))
        self.openssl("genpkey", "-algorithm", "Ed25519", "-out", str(t / "forged.key"))
        os.chmod(t / "forged.key", 0o600)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.origin = "https://localhost:%d" % self.port
        self.control_token = uid()
        (t / "coordinator").mkdir(mode=0o700)
        (t / "coordinator/coordinator.json").write_text(json.dumps({
            "port": self.port, "cert": str(t / "ca.pem"), "key": str(t / "tls.key"), "runner_public_key": str(t / "runner.pub"),
            "origin": self.origin, "credential_id": self.ids["credential"], "organisation_id": self.ids["organisation"], "run_id": self.ids["run"],
            "sandbox_id": self.ids["sandbox"], "boot_id": self.ids["boot"], "boot_generation": self.generation, "consumer_id": self.ids["consumer"],
            "authority_epoch": self.ids["epoch"], "control_token": self.control_token}))
        for name, key in (("transport.json", "runner.key"), ("forged-transport.json", "forged.key")):
            path = t / name
            path.write_text(json.dumps({"origin": self.origin, "ca_file": str(t / "ca.pem"), "key_path": str(t / key),
                                        "credential_id": self.ids["credential"], "timeout_ms": 2000}))
            os.chmod(path, 0o600)
        db = sqlite3.connect(self.slots / ".supervisor-slots.db")
        db.execute("CREATE TABLE slots(id TEXT PRIMARY KEY,uid INTEGER UNIQUE NOT NULL,gid INTEGER NOT NULL,boot_id TEXT NOT NULL,preparation TEXT NOT NULL,port INTEGER UNIQUE NOT NULL,state TEXT NOT NULL)")
        agent_digest = sha(pathlib.Path(AGENT).read_bytes())
        base = 62240
        for index, name in enumerate(("S1", "S2", "S3", "S4", "S5", "S6")):
            sid, suid = uid(), base + index
            if self.uid_processes(suid):
                raise RuntimeError("slot uid %d is not quiescent" % suid)
            db.execute("INSERT INTO slots VALUES(?,?,?,?,?,?,'READY')", (sid, suid, suid, self.ids["boot"], sha(b"prep"), 41000 + index))
            root = self.slots / sid
            root.mkdir(mode=0o700)
            os.chown(root, suid, suid)
            for sub in ("worktree", "build", "home", "tmp", "sessions", "logs"):
                (root / sub).mkdir(mode=0o700)
                os.chown(root / sub, suid, suid)
            plan = {"dispatch_eligible": True, "requires_supervisor": True, "binary_digest": agent_digest, "argv": AGENT_ARGV,
                    "cwd": str(root / "worktree"), "home": str(root / "home"), "temp": str(root / "tmp")}
            plan_path = t / ("plan-%s.json" % name)
            plan_path.write_bytes(canonical(plan))
            os.chmod(plan_path, 0o600)
            config = t / ("runner-%s.json" % name)
            config.write_text(json.dumps({"transport_config": str(t / "transport.json"), "state_dir": str(self.state), "slot_root": str(self.slots),
                                          "connector_plan_path": str(plan_path), "organisation_id": self.ids["organisation"], "run_id": self.ids["run"],
                                          "sandbox_id": self.ids["sandbox"], "boot_id": self.ids["boot"], "boot_generation": self.generation,
                                          "consumer_id": self.ids["consumer"]}))
            os.chmod(config, 0o600)
            self.slot[name] = {"id": sid, "uid": suid, "config": str(config), "plan_digest": sha(plan_path.read_bytes())}
        db.commit()
        db.close()
        os.chmod(self.slots / ".supervisor-slots.db", 0o600)
        forged = t / "runner-forged.json"
        forged.write_text(pathlib.Path(self.slot["S1"]["config"]).read_text().replace(str(t / "transport.json"), str(t / "forged-transport.json")))
        os.chmod(forged, 0o600)
        self.forged_config = str(forged)

    # --- processes -------------------------------------------------------
    def start_coordinator(self):
        self.coordinator = subprocess.Popen([sys.executable, "-I", str(pathlib.Path(__file__).resolve()), "--coordinator", str(self.tmp / "coordinator")],
                                            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, stdin=subprocess.DEVNULL, text=True)
        if self.coordinator.stdout.readline().strip() != "READY":
            raise RuntimeError("coordinator did not start")

    def stop_coordinator(self):
        if self.coordinator:
            self.coordinator.kill()
            self.coordinator.wait()
            self.coordinator.stdout.close()
            self.coordinator = None

    def control(self, value):
        context = ssl.create_default_context(cafile=str(self.tmp / "ca.pem"))
        import http.client
        connection = http.client.HTTPSConnection("localhost", self.port, context=context, timeout=10)
        connection.request("POST", "/control", body=json.dumps(value), headers={"X-Fixture-Token": self.control_token, "Content-Type": "application/json"})
        response = json.loads(connection.getresponse().read())
        connection.close()
        return response["state"]

    def cstate(self):
        if self.coordinator:
            return self.control({"op": "state"})
        return json.loads((self.tmp / "coordinator/state.json").read_text())

    def native(self, action, request, timeout=30):
        result = subprocess.run([str(NATIVE), "--component", "12.2", "--action", action], input=json.dumps(request), text=True,
                                stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, cwd=ROOT)
        try:
            output = json.loads(result.stdout) if result.stdout.strip() else None
        except ValueError:
            output = None
        return result.returncode, output, result.stderr

    def start_serve(self, slot="S1", seconds=150):
        self.serve = subprocess.Popen([str(NATIVE), "--component", "12.2", "--action", "launch.serve"], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                      stderr=subprocess.PIPE, text=True, cwd=ROOT)
        self.serve.stdin.write(json.dumps({"config_path": self.slot[slot]["config"], "run_seconds": seconds, "poll_interval_ms": 100}))
        self.serve.stdin.close()

    def stop_serve(self, sig):
        process, self.serve = self.serve, None
        process.send_signal(sig)
        out, err = process.communicate(timeout=30)
        return process.returncode, out, err

    def helper(self, suid):
        process = subprocess.Popen(["/usr/bin/sleep", "300"], user=suid, group=suid, extra_groups=[], stdin=subprocess.DEVNULL,
                                   stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, cwd="/")
        self.helpers.append(process)
        wait_for(lambda: self.proc_uid(process.pid) == suid, 5)
        return process

    # --- observation -----------------------------------------------------
    @staticmethod
    def proc_stat(pid):
        try:
            text = pathlib.Path("/proc/%d/stat" % pid).read_text()
        except OSError:
            return None
        fields = text[text.rindex(")") + 2:].split()
        return {"state": fields[0], "start_time": int(fields[19])}

    @staticmethod
    def proc_uid(pid):
        try:
            for line in pathlib.Path("/proc/%d/status" % pid).read_text().splitlines():
                if line.startswith("Uid:"):
                    return int(line.split()[1])
        except OSError:
            return None

    def alive(self, pid, start=None):
        stat = self.proc_stat(pid) if pid else None
        return bool(stat) and stat["state"] not in ("Z", "X") and (start is None or str(stat["start_time"]) == str(start))

    def uid_processes(self, suid):
        found = []
        for entry in os.listdir("/proc"):
            if entry.isdigit() and self.proc_uid(int(entry)) == suid and self.alive(int(entry)):
                found.append(int(entry))
        return found

    def ledger(self, sql, args=()):
        if not (self.state / "launches.db").exists():
            return []
        db = sqlite3.connect(str(self.state / "launches.db"), timeout=10)
        db.row_factory = sqlite3.Row
        try:
            return [dict(r) for r in db.execute(sql, args).fetchall()]
        finally:
            db.close()

    def launch(self, launch_id):
        rows = self.ledger("SELECT * FROM launches WHERE id=?", (launch_id,))
        return rows[0] if rows else None

    def events(self, launch_id, kind=None):
        rows = self.ledger("SELECT payload FROM native_event_outbox WHERE launch=? ORDER BY sequence", (launch_id,))
        values = [json.loads(r["payload"]) for r in rows]
        return [v for v in values if kind is None or v["kind"] == kind]

    def stdout(self, launch_id):
        try:
            return (self.state / (launch_id + ".stdout")).read_bytes()
        except OSError:
            return b""

    def lock_held(self, launch_id):
        try:
            fd = os.open(str(self.state / (launch_id + ".lock")), os.O_RDWR)
        except OSError:
            return False
        try:
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            fcntl.flock(fd, fcntl.LOCK_UN)
            return False
        except BlockingIOError:
            return True
        finally:
            os.close(fd)

    # --- instructions ----------------------------------------------------
    def instruction(self, kind, launch_id, body, attempt, generation="2", held=False, suppress=True):
        self.sequence += 1
        value = {"id": uid(), "kind": kind, "attempt_id": attempt, "attempt_generation": generation, "sequence": str(self.sequence),
                 "body": dict(body, launch_id=launch_id), "held": held, "suppress": suppress}
        self.control({"op": "enqueue", "instruction": value})
        return value

    def start_body(self, slot, session=None):
        return {"slot_id": self.slot[slot]["id"], "agent_session_id": session or uid(), "connector_plan_digest": self.slot[slot]["plan_digest"]}

    def steer_body(self, text):
        return {"request_id": uid(), "frame_b64": b64(text)}

    def simulate_accepted(self, ins, slot, state="ACCEPTED", agent=None):
        """Persist exactly what launch_start commits before fork (row, ACK v1,
        accepted event), modelling a supervisor crash in that window."""
        body = canonical(ins["body"])
        ack = {"organisation_id": self.ids["organisation"], "run_id": self.ids["run"], "command_id": ins["id"], "operation_id": ins["id"],
               "attempt_id": ins["attempt_id"], "attempt_generation": ins["attempt_generation"], "authority_epoch": self.ids["epoch"],
               "sandbox_id": self.ids["sandbox"], "boot_id": self.ids["boot"], "sandbox_boot_generation": self.generation, "sequence": ins["sequence"],
               "payload_digest": sha(body), "ledger_receipt_id": ins["id"], "ledger_version": "1", "state": "ACCEPTED", "observed_process": None}
        identity = {"attempt_id": ins["attempt_id"], "attempt_generation": ins["attempt_generation"], "agent_session_id": ins["body"]["agent_session_id"]}
        boot = pathlib.Path("/proc/sys/kernel/random/boot_id").read_text().strip()
        db = sqlite3.connect(str(self.state / "launches.db"), timeout=10, isolation_level=None)
        db.execute("BEGIN IMMEDIATE")
        suid = self.slot[slot]["uid"]
        db.execute("INSERT INTO launches(id,command,digest,body,state,uid,gid,slot,identity,agent_pid,agent_start,os_boot,updated) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,unixepoch())",
                   (ins["body"]["launch_id"], ins["id"], sha(body), body.decode(), state, suid, suid, self.slot[slot]["id"], json.dumps(identity),
                    agent[0] if agent else None, str(agent[1]) if agent else None, boot if agent else None))
        db.execute("INSERT INTO native_ack_outbox(command,version,payload) VALUES(?,1,?)", (ins["id"], json.dumps(ack, separators=(",", ":"))))
        db.execute("COMMIT")
        db.close()

    def cleanup(self):
        complete = True
        if self.serve:
            try:
                self.stop_serve(signal.SIGKILL)
            except Exception:
                complete = False
        try:
            rows = self.ledger("SELECT broker_pid,uid FROM launches")
        except Exception:
            rows = []
        for row in rows:
            if row["broker_pid"]:
                try:
                    os.kill(row["broker_pid"], signal.SIGKILL)
                except OSError:
                    pass
        for process in self.helpers:
            if process.poll() is None:
                process.kill()
            process.wait()
        for name in self.slot:
            for pid in self.uid_processes(self.slot[name]["uid"]):
                try:
                    os.kill(pid, signal.SIGKILL)
                except OSError:
                    pass
        self.stop_coordinator()
        deadline = time.monotonic() + 10
        while time.monotonic() < deadline:
            try:
                pid, _ = os.waitpid(-1, os.WNOHANG)
                if pid == 0:
                    time.sleep(0.05)
            except ChildProcessError:
                break
        for name in self.slot:
            if self.uid_processes(self.slot[name]["uid"]):
                complete = False
        subprocess.run(["rm", "-rf", str(self.tmp)], check=False)
        for name in self.slot:
            try:
                os.unlink("/run/hyperfide/slot-%d.lock" % self.slot[name]["uid"])
            except OSError:
                pass
        return complete


def scenario(p):
    p.setup()
    p.start_coordinator()
    ids = p.ids
    check("transport.separate-https-coordinator", p.coordinator.pid != os.getpid() and p.cstate()["polls"] == 0)

    # A request signed by a key the coordinator never enrolled is refused before any dispatch.
    attempt1 = uid()
    session1 = uid()
    L1 = uid()
    start1 = p.instruction("START", L1, p.start_body("S1", session1), attempt1, held=True)
    code, out, _ = p.native("launch.start", {"config_path": p.forged_config, "event_id": start1["id"]})
    check("transport.rejects-forged-request-proof", code != 0 and p.cstate()["proof_rejects"] >= 1 and p.launch(L1) is None and not p.uid_processes(p.slot["S1"]["uid"]))

    # Lose the poll response that first hands off START (pre-spawn window), then
    # lose the first two ACK responses (post-spawn window).
    p.control({"op": "drop", "action": "instructions.runner.poll", "count": 1, "with_commands": True})
    p.control({"op": "drop", "action": "instructions.ack", "count": 2})
    p.control({"op": "release", "id": start1["id"]})
    p.start_serve("S1")
    def executing():
        row = p.launch(L1)
        if not row or row["state"] != "RUNNING" or not p.alive(row["agent_pid"]):
            return None
        try:
            return row if os.readlink("/proc/%d/exe" % row["agent_pid"]) == AGENT else None
        except OSError:
            return None
    # The row is RUNNING (identity persisted) just before the gate releases exec.
    running = wait_for(executing, 25)
    agent_pid = running["agent_pid"] if running else None
    agent_start = running["agent_start"] if running else None
    broker_pid = running["broker_pid"] if running else None
    exe = os.readlink("/proc/%d/exe" % agent_pid) if agent_pid and p.alive(agent_pid) else None
    check("launch.serve-poll-spawns-agent", running and exe == AGENT and p.proc_uid(agent_pid) == p.slot["S1"]["uid"] and p.lock_held(L1), running)
    acked = wait_for(lambda: (lambda s: (start1["id"] + ":1") in s["acks"] and (start1["id"] + ":2") in s["acks"] and s)(p.cstate()), 20)
    state = p.cstate()
    v1, v2 = state["acks"].get(start1["id"] + ":1"), state["acks"].get(start1["id"] + ":2")
    kinds = [e["kind"] for e in p.events(L1)]
    check("launch.durable-accept-before-spawn", bool(acked) and v1["state"] == "ACCEPTED" and v1["observed_process"] is None and v2["state"] == "EXECUTING" and
          v2["observed_process"]["pid"] == agent_pid and kinds[:2] == ["launch.accepted", "launch.running"], {"v1": v1, "v2": v2, "kinds": kinds})
    check("launch.lost-handoff-redelivered-single-start", state["handoffs"].get(start1["id"], 0) >= 2 and state["dropped"] >= 1 and
          len(p.ledger("SELECT id FROM launches WHERE command=?", (start1["id"],))) == 1 and len(p.uid_processes(p.slot["S1"]["uid"])) == 1, state["handoffs"])
    check("ack.lost-responses-replayed-idempotently", state["dropped"] >= 3 and state["ack_posts"] > len(state["acks"]) and state["ack_conflicts"] == 0 and not state["ack_rejects"],
          {k: state[k] for k in ("dropped", "ack_posts", "ack_conflicts", "ack_rejects")})

    # Steering: exactly one stdin write per frame UUID, across redelivery and direct replay.
    steer1 = p.instruction("STEER", L1, p.steer_body(b"hello\n"), attempt1)
    check("steer.delivered-once", wait_for(lambda: p.stdout(L1) == b"hello\n", 15), p.stdout(L1))
    wait_for(lambda: (steer1["id"] + ":2") in p.cstate()["acks"], 10)
    p.control({"op": "redeliver", "id": steer1["id"]})
    wait_for(lambda: p.cstate()["handoffs"].get(steer1["id"], 0) >= 2, 10)
    time.sleep(0.6)
    check("steer.redelivery-not-rewritten", p.cstate()["handoffs"].get(steer1["id"], 0) >= 2 and p.stdout(L1) == b"hello\n", p.stdout(L1))
    code, out, _ = p.native("launch.instruction", {"config_path": p.slot["S1"]["config"], "event_id": steer1["id"]})
    check("steer.duplicate-frame-not-replayed", code == 0 and out["result"]["delivery"] == "DUPLICATE_NOT_REPLAYED" and p.stdout(L1) == b"hello\n", out)

    # Supervisor crash while the controller transport is also lost.
    p.stop_serve(signal.SIGKILL)
    time.sleep(0.3)
    check("supervisor.kill-leaves-broker-and-agent", p.alive(broker_pid) and p.alive(agent_pid, agent_start) and p.lock_held(L1))
    steer2 = p.instruction("STEER", L1, p.steer_body(b"world\n"), attempt1)
    p.stop_coordinator()
    p.start_serve("S1")
    time.sleep(2.5)
    stdin = os.stat("/proc/%d/fd/0" % agent_pid) if p.alive(agent_pid) else None
    writers = [fd for fd in os.listdir("/proc/%d/fd" % broker_pid) if stdin and os.stat("/proc/%d/fd/%s" % (broker_pid, fd)).st_ino == stdin.st_ino] if p.alive(broker_pid) else []
    check("controller.outage-agent-stdin-open", p.alive(agent_pid, agent_start) and stdin is not None and bool(writers) and p.launch(L1)["state"] == "RUNNING")
    reconciled = p.events(L1, "launch.reconciled")
    data = reconciled[-1]["data"] if reconciled else {}
    check("reconcile.live-broker-adopted", data.get("outcome") == "ADOPTED" and data.get("ipc_observed") is True and data.get("stdin_owned") is True and
          data.get("broker_identity_current") is True and p.launch(L1)["agent_pid"] == agent_pid, data)
    check("reconcile.adoption-single-owner", p.lock_held(L1) and len(p.uid_processes(p.slot["S1"]["uid"])) == 1 and
          len(p.ledger("SELECT id FROM launches WHERE uid=?", (p.slot["S1"]["uid"],))) == 1)
    p.start_coordinator()
    delivered = wait_for(lambda: p.stdout(L1) == b"hello\nworld\n", 20)
    check("reconnect.steer-after-restart-delivered", delivered and p.alive(agent_pid, agent_start), p.stdout(L1))
    state = p.cstate()
    check("start.no-duplicate-logical-start", len(p.ledger("SELECT id FROM launches WHERE command=?", (start1["id"],))) == 1 and
          sorted(k for k in state["acks"] if k.startswith(start1["id"] + ":")) == [start1["id"] + ":1", start1["id"] + ":2"] and
          p.uid_processes(p.slot["S1"]["uid"]) == [agent_pid] and state["placements"] == 1, state["placements"])

    # Crash windows recovered by reconciliation (all share one durable ledger).
    attempt2, L2 = uid(), uid()
    start2 = p.instruction("START", L2, p.start_body("S2"), attempt2, held=True)
    p.simulate_accepted(start2, "S2")
    attempt3, L3 = uid(), uid()
    start3 = p.instruction("START", L3, p.start_body("S3"), attempt3, held=True)
    p.simulate_accepted(start3, "S3")
    stray = p.helper(p.slot["S3"]["uid"])
    attempt4, L4 = uid(), uid()
    start4 = p.instruction("START", L4, p.start_body("S4"), attempt4, held=True)
    code, out, err = p.native("launch.start", {"config_path": p.slot["S4"]["config"], "event_id": start4["id"]})
    row4 = wait_for(lambda: (p.launch(L4) or {}).get("state") == "RUNNING" and p.launch(L4), 10)
    if row4:
        os.kill(row4["broker_pid"], signal.SIGKILL)
    wait_for(lambda: row4 and not p.uid_processes(p.slot["S4"]["uid"]) and not p.lock_held(L4), 10)
    attempt5, L5 = uid(), uid()
    start5 = p.instruction("START", L5, p.start_body("S5"), attempt5, held=True)
    impostor = p.helper(p.slot["S5"]["uid"])
    p.simulate_accepted(start5, "S5", "RUNNING", (impostor.pid, p.proc_stat(impostor.pid)["start_time"] + 7))
    attempt6, L6 = uid(), uid()
    start6 = p.instruction("START", L6, p.start_body("S6"), attempt6, held=True)
    orphan = p.helper(p.slot["S6"]["uid"])
    p.simulate_accepted(start6, "S6", "RUNNING", (orphan.pid, p.proc_stat(orphan.pid)["start_time"]))
    code, out, err = p.native("launch.reconcile", {"config_path": p.slot["S1"]["config"]})
    outcomes = {r["launch_id"]: r for r in (out or {}).get("result", {}).get("launches", [])}
    check("reconcile.accepted-without-broker-not-spawned", outcomes.get(L2, {}).get("outcome") == "NOT_SPAWNED" and p.launch(L2)["state"] == "NOT_SPAWNED" and
          outcomes[L2]["relaunch_permitted"] is False, outcomes.get(L2))
    check("reconcile.unattributed-process-uncertain", outcomes.get(L3, {}).get("outcome") == "UNCERTAIN" and outcomes[L3]["slot_uid_processes"] == 1 and p.alive(stray.pid), outcomes.get(L3))
    check("reconcile.dead-broker-lost", bool(row4) and outcomes.get(L4, {}).get("outcome") == "LOST" and outcomes[L4]["broker_lock_held"] is False and
          outcomes[L4]["agent_identity_current"] is False and p.launch(L4)["state"] == "LOST", outcomes.get(L4))
    check("reconcile.reused-pid-not-adopted", outcomes.get(L5, {}).get("outcome") == "UNCERTAIN" and outcomes[L5]["agent_identity_current"] is False, outcomes.get(L5))
    check("reconcile.orphan-reported-without-stdin", outcomes.get(L6, {}).get("outcome") == "ORPHANED_NO_STDIN" and outcomes[L6]["stdin_owned"] is False and
          p.alive(orphan.pid) and p.launch(L6)["state"] == "ORPHANED", outcomes.get(L6))
    # The coordinator re-hands both STARTs (lost delivery state); the supervisor must replay, not spawn.
    for ins in (start2, start4):
        p.control({"op": "redeliver", "id": ins["id"]})
    replays = wait_for(lambda: len(p.ledger("SELECT 1 FROM instructions WHERE event IN (?,?) AND state='DONE'", (start2["id"], start4["id"]))) == 2, 15)
    time.sleep(0.5)
    check("reconcile.no-blind-relaunch", bool(replays) and not p.uid_processes(p.slot["S2"]["uid"]) and not p.uid_processes(p.slot["S4"]["uid"]) and
          p.launch(L2)["state"] == "NOT_SPAWNED" and p.launch(L4)["state"] == "LOST" and
          len(p.ledger("SELECT id FROM launches WHERE id IN (?,?)", (L2, L4))) == 2 and p.cstate()["acks"].get(start2["id"] + ":2", {}).get("state") == "UNCERTAIN")
    cancel3 = p.instruction("CANCEL", L3, {}, attempt3)
    cancel6 = p.instruction("CANCEL", L6, {}, attempt6)
    stopped = wait_for(lambda: p.launch(L3)["state"] == "STOPPED" and p.launch(L6)["state"] == "STOPPED" and
                       p.events(L3, "instruction.cancel") and p.events(L6, "instruction.cancel"), 15)
    deliveries = [e["data"]["delivery"] for e in p.events(L3, "instruction.cancel") + p.events(L6, "instruction.cancel")]
    check("cancel.orphan-stopped-without-broker", stopped and deliveries == ["STOPPED_WITHOUT_BROKER"] * 2 and not p.uid_processes(p.slot["S3"]["uid"]) and
          not p.uid_processes(p.slot["S6"]["uid"]), deliveries)
    impostor.kill()

    # V-006: steering/cancel before launch acknowledgement; stale generation cancel.
    attempt7, L7, L8 = uid(), uid(), uid()
    steer8 = p.instruction("STEER", L8, p.steer_body(b"early\n"), uid())
    wait_for(lambda: p.events(L8, "instruction.steer"), 10)
    steered = p.events(L8, "instruction.steer")
    check("steer.before-start-not-written", steered and steered[0]["data"]["delivery"] == "NO_ACTIVE_SESSION" and not (p.state / (L8 + ".stdout")).exists())
    cancel7 = p.instruction("CANCEL", L7, {}, attempt7)
    start7 = p.instruction("START", L7, p.start_body("S2"), attempt7, suppress=False)
    refused = wait_for(lambda: p.events(L7, "instruction.start.refused"), 15)
    cancelled = p.events(L7, "instruction.cancel")
    check("cancel.before-start-fences-launch", refused and refused[0]["data"]["refusal"] == "CANCELLED_BEFORE_START" and cancelled and
          cancelled[0]["data"]["delivery"] == "FENCED_BEFORE_START" and p.launch(L7) is None and not p.uid_processes(p.slot["S2"]["uid"]))
    stale = p.instruction("CANCEL", L1, {}, attempt1, generation="1")
    wait_for(lambda: [e for e in p.events(L1, "instruction.cancel")], 15)
    time.sleep(0.3)
    check("cancel.stale-generation-not-applied", p.launch(L1)["state"] == "RUNNING" and p.alive(agent_pid, agent_start) and
          p.events(L1, "instruction.cancel")[0]["data"]["delivery"] != "STOPPED")

    # Current-generation cancel stops the agent; terminal evidence binds the spool.
    cancel1 = p.instruction("CANCEL", L1, {}, attempt1)
    wait_for(lambda: p.launch(L1)["state"] == "STOPPED", 15)
    check("cancel.current-generation-stops", p.launch(L1)["state"] == "STOPPED" and not p.alive(agent_pid) and not p.uid_processes(p.slot["S1"]["uid"]))
    terminal = wait_for(lambda: [e for e in p.cstate()["events"].values() if e["launch_id"] == L1 and e["kind"] == "launch.terminal"], 15)
    spool = terminal[0]["data"]["stdout"] if terminal else {}
    check("evidence.spool-digest-uploaded", spool.get("digest") == sha(b"hello\nworld\n") and spool.get("spooled_bytes") == "12" and
          terminal[0]["data"]["stopped_by_command"] == cancel1["id"] and p.cstate()["acks"].get(start1["id"] + ":3", {}).get("state") == "TERMINAL", terminal)
    check("broker.retires-after-delivery", wait_for(lambda: not p.alive(broker_pid) and not p.lock_held(L1), 15))

    # Every durable ACK/event row reached the coordinator exactly once logically.
    def drained():
        return not p.ledger("SELECT 1 FROM native_ack_outbox WHERE delivered=0") and not p.ledger("SELECT 1 FROM native_event_outbox WHERE delivered=0")
    wait_for(drained, 20)
    state = p.cstate()
    local_events = {r["id"] for r in p.ledger("SELECT id FROM native_event_outbox")}
    local_acks = {"%s:%s" % (r["command"], r["version"]) for r in p.ledger("SELECT command,version FROM native_ack_outbox")}
    check("spool.replayed-without-duplicates", drained() and local_events == set(state["events"]) and local_acks == set(state["acks"]) and
          state["event_posts"] >= len(local_events) and state["event_conflicts"] == 0 and state["ack_conflicts"] == 0 and not state["event_rejects"] and not state["ack_rejects"],
          {"missing_events": len(local_events ^ set(state["events"])), "missing_acks": sorted(local_acks ^ set(state["acks"])), "rejects": state["ack_rejects"] + state["event_rejects"]})
    code, out, err = p.stop_serve(signal.SIGTERM)
    summary = json.loads(out)["result"] if code == 0 and out.strip() else {}
    check("reconnect.backoff-bounded", summary.get("poll_failures", 0) >= 3 and 250 <= summary.get("max_backoff_ms", 0) <= 8000, summary)
    check("serve.summary-bounded", summary.get("stopped_by_signal") is True and summary.get("starts") == 0 and summary.get("start_replays", 0) >= 2 and
          summary.get("identity_conflicts") == 0 and summary.get("invalid_packets") == 0 and summary.get("reconciled", {}).get("adopted") == 1, summary)


def cleanup_state():
    receipt = os.environ.get("HYPERFIDE_RECEIPT_ID")
    if receipt is None:
        return None
    if str(uuid.UUID(receipt)) != receipt:
        raise ValueError("noncanonical cleanup receipt")
    return pathlib.Path(tempfile.gettempdir()) / ("hyperfide-" + RESOURCE + "-" + receipt + ".json")


def cleanup_only():
    """Independent cleanup verifier: the recorded disposable database is absent."""
    target = cleanup_state()
    if target is None or not target.exists():
        return 1
    database = json.loads(target.read_text())["database"]
    if not (database.startswith("hf_identity_") and len(database) == 44):
        return 1
    sys.path.insert(0, str(ROOT / "tests/hyperfide/support"))
    from identity_fixture import SQL_JS
    result = subprocess.run(["node", "--input-type=commonjs", "-e", SQL_JS], input=json.dumps({"sql": "SELECT datname FROM pg_database WHERE datname=$1", "values": [database]}),
                            text=True, cwd=ROOT, env=os.environ.copy(), stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=15)
    absent = result.returncode == 0 and json.loads(result.stdout) == []
    if absent:
        target.unlink()
    return 0 if absent else 1


def dispatch_probe():
    """runner.dispatch.* through the actual signed HTTPS control service."""
    sys.path.insert(0, str(ROOT / "tests/hyperfide/support"))
    from identity_fixture import IdentityFixture
    fixture = IdentityFixture(extra_components=DISPATCH_COMPONENTS, extra_env={"HF_SCHEDULER_NATIVE_CONSUMER_ID": uid()})
    try:
        status, row = fixture.invoke("runner.dispatch.describe", {}, component="12.2")
        check("dispatch.describe-not-ready", status == 200 and row.get("ok") is True and row["result"] == {"route_ready": False, "status": "NOT_READY", "launch_authority": False,
                                                                                                           "reason": "QUALIFIED_PLAN_READER_UNREGISTERED"}, row)
        status, row = fixture.invoke("runner.dispatch.consume", {"event_id": uid(), "attempt_count": "1"}, component="12.2")
        check("dispatch.consume-plan-reader-not-ready", row.get("ok") is False and row.get("error", {}).get("code") == "RUNNER_PLAN_NOT_READY", row)
        status, row = fixture.invoke("runner.dispatch.consume", {"event_id": "not-a-uuid", "attempt_count": "1"}, component="12.2")
        check("dispatch.consume-rejects-invalid-claim", row.get("ok") is False and row.get("error", {}).get("code") == "RUNNER_DISPATCH_INPUT_INVALID", row)
        status, row = fixture.invoke("runner.dispatch.consume", {"event_id": uid(), "attempt_count": "1", "plan": {"launch_id": uid()}}, component="12.2")
        check("dispatch.consume-rejects-unknown-field", row.get("ok") is False and row.get("error", {}).get("code") != "RUNNER_PLAN_NOT_READY", row)
    finally:
        fixture.close()
    absent = fixture.sql("SELECT datname FROM pg_database WHERE datname=$1", [fixture.database], admin=True) == []
    return absent, {"database": fixture.database, "observed_absent": absent, "observer": "independent pg_database query after DROP"}


def main():
    if len(sys.argv) == 3 and sys.argv[1] == "--coordinator":
        Coordinator(sys.argv[2]).serve()
        return 0
    if len(sys.argv) == 2 and sys.argv[1] == "--cleanup":
        return cleanup_only()
    signal.signal(signal.SIGPIPE, signal.SIG_DFL)
    ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0)
    root = os.geteuid() == 0
    check("runner.root-fixture", root)
    probe = Probe() if root else None
    try:
        if probe:
            scenario(probe)
    except Exception:
        traceback.print_exc(file=sys.stderr)
    complete = probe.cleanup() if probe else True
    absent, proof = False, {"observed_absent": False}
    try:
        absent, proof = dispatch_probe()
        target = cleanup_state()
        if target:
            with target.open("x") as state:
                state.write(json.dumps(proof))
            target.chmod(0o600)
    except Exception:
        traceback.print_exc(file=sys.stderr)
    receipt = os.environ.get("HYPERFIDE_RECEIPT_ID")
    for name in ASSERTIONS:
        print(json.dumps({"type": "assertion", "id": name, "expected": True, "actual": RESULTS.get(name, False)}), flush=True)
    resource = {"id": RESOURCE, "status": "deleted" if absent else "unknown", "observed_absent": absent,
                "evidence_artifact": "artifacts/" + receipt + "/stdout.log" if receipt else "raw-stdout", "observation": proof}
    complete = complete and absent
    print(json.dumps({"type": "cleanup", "resources": [resource], "complete": complete}), flush=True)
    return 0 if complete and all(RESULTS.get(name) for name in ASSERTIONS) else 1


if __name__ == "__main__":
    raise SystemExit(main())
