#!/usr/bin/env python3
"""Task 11.5: packet-scoped workspace slices through the real signed control and provisioner services.

One self-contained run: a seeded >20,000-file, 13-language Git fixture; a real published graph (7.2 ingest, 7.3
publication) of its graph commit; real 3.2 execution packets; slice derivation in the control service; partial-clone
sparse materialisation and slice qualification in a separate remote provisioner service. `--cleanup` independently
removes anything a crashed run left behind and reports observed absence.
"""
from __future__ import annotations
import base64, concurrent.futures, copy, ctypes, hashlib, importlib.util, json, os, shutil, socket, subprocess, sys, tempfile, threading, time, traceback
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
def _load(name, relative):
    spec = importlib.util.spec_from_file_location(name, ROOT / relative)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module
packets = _load("hf_packet_fixture", "tests/hyperfide/cases/tasks/3_2.py")
large = _load("hf_large_repo_fixture", "tests/hyperfide/cases/support/large_repo_fixture.py")
sys.path.insert(0, str(ROOT / "tests/hyperfide/support"))
from identity_fixture import IdentityFixture, uid, sha  # noqa: E402

TASK = "11.5"
ASSERTIONS = [
    "slice.fixture.scale-and-languages",
    "slice.graph.extraction-matches-live-7.1",
    "slice.graph.real-publication",
    "slice.component.registered-both-roles",
    "slice.placement.role-separation",
    "slice.derive.concurrent-distinct-slices",
    "slice.derive.exact-commit-and-graph",
    "slice.derive.file-level-closure",
    "slice.derive.build-roots-tests-fixtures-contracts",
    "slice.derive.unchanged-input-hit",
    "slice.derive.changed-input-miss",
    "slice.manifest.immutable",
    "slice.fallback.unresolved-closure-edge",
    "slice.fallback.unparsed-language",
    "slice.fallback.budget-truncated",
    "slice.fallback.graph-not-required",
    "slice.fallback.stale-graph-generation",
    "slice.fallback.reason-always-recorded",
    "slice.materialize.concurrent-slots",
    "slice.materialize.partial-clone-positive",
    "slice.materialize.byte-identical-to-full-tree",
    "slice.materialize.lfs-inside-slice",
    "slice.materialize.submodule-and-lfs-full-tree",
    "slice.materialize.undeclared-submodule-refused",
    "slice.materialize.ineffective-partial-clone-never-ready",
    "slice.materialize.slot-binding-and-occupancy",
    "slice.cost.against-full-tree-baseline",
    "slice.run.out-of-slice-read-refused",
    "slice.run.out-of-slice-write-refused",
    "slice.run.access-monitor-recorded",
    "slice.run.excluded-build-root-refused",
    "slice.widen.explicit-new-manifest",
    "slice.widen.conflicting-identity-refused",
    "slice.run.widened-slice-qualifies-inputs",
    "slice.run.receipt-carries-slice-identity",
    "slice.run.full-tree-detects-omitted-inputs",
    "slice.run.full-tree-fallback-receipt",
    "slice.run.operation-replay",
    "slice.sql.immutable-history",
    "slice.sql.repeatable-read-refused",
    "slice.canary.no-authority-material",
    "slice.cleanup.observed",
]
PRINTED = set(); FAILED = []; OBSERVATIONS = {}

def expect(value, message):
    if not value: raise AssertionError(message)
def check(identity, fn):
    if identity not in ASSERTIONS or identity in PRINTED: raise RuntimeError("unregistered or repeated assertion " + identity)
    try:
        fn(); actual = "observed"
    except Exception as error:
        FAILED.append(identity); actual = type(error).__name__ + ": " + str(error)[:1500]
    PRINTED.add(identity)
    print(json.dumps({"type": "assertion", "id": identity, "expected": "observed", "actual": actual}), flush=True)
def unexecuted(reason):
    for identity in ASSERTIONS:
        if identity not in PRINTED:
            FAILED.append(identity); PRINTED.add(identity)
            print(json.dumps({"type": "assertion", "id": identity, "expected": "observed", "actual": "not executed: " + reason[:1000]}), flush=True)
def canonical(value): return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False)
def identity(value): return sha(canonical(value).encode())

SLICE_SPEC_GENERATION = 3
SLICE_CRITERION = "Workspace materialisation SHALL support packet-scoped slices that fall back to the full tree with a recorded reason."
def accept_slice_spec(f, generation):
    """Accepted immutable 11.5 spec revision in the same parsed-kvx envelope as the 3.2 packet fixture's `accept_spec`."""
    i = f.ids; spec = uid(); rubric = packets.RUBRIC
    source = ("[meta]\nslug = \"slice-fixture-g%d\"\n[req.11]\nac_5 = %s\n[acceptance.V-057]\nreq = \"11.5\"\n[proof]\nrubric_digest = %s\n"
              "[proof.review.11.5]\nreviewers = %s\nrubric_digest = %s\n[task.slice]\nwave = 2\nreqs = [\"11.5\"]\nacceptance_ids = [\"V-057\"]\n"
              % (generation, json.dumps(SLICE_CRITERION), json.dumps(rubric), json.dumps([i["watcher"]]), json.dumps(rubric)))
    parsed = packets.parse_kvx(source)
    intent = {"schema_version": 1, "revision_digest": sha(("slice-envelope-%d" % generation).encode()), "source_digest": sha(source.encode()),
              "repositories": [{"repository_id": i["repository"], "source_object_id": f.source, "integration_ref": "refs/heads/main"}], "allowed_actions": f.actions,
              "closure_policy": {"required_evidence": [], "required_review_roles": [], "publication": "AFTER_QUALIFICATION"}, "provenance": None, "parsed": parsed, "runtime_wave_offset": 0}
    f.sql("INSERT INTO hyperfide.spec_revisions(organisation_id,project_id,id,source_digest,source_content,document,schema_version,revision_digest) VALUES($1,$2,$3,$4,$5,$6,1,$7)",
          [i["organisation"], i["project"], spec, sha(source.encode()), source, json.dumps(intent), intent["revision_digest"]])
    f.sql("INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES($1,$2,$3,$4)", [i["organisation"], i["run"], generation, spec])
    section = next(x for x in parsed["sections"] if x["name"] == "task.slice")
    return spec, section, identity({"reqs": ["11.5"], "accepted_text": SLICE_CRITERION})

def campaign():
    base = Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR") or (Path(tempfile.gettempdir()) / "hf-task-11.5-dev-campaign"))
    folder = base / "slices"; folder.mkdir(parents=True, exist_ok=True); return folder
LEDGER_PREFIXES = ("hf-slices-", "hyperfide-identity-")
def ledger(**entries):
    file = campaign() / "resources.json"
    current = json.loads(file.read_text()) if file.exists() else {"databases": [], "roles": [], "paths": [], "ports": []}
    for key, values in entries.items():
        for value in values:
            if value not in current[key]: current[key].append(value)
    tmp = file.with_suffix(".tmp"); tmp.write_text(json.dumps(current, sort_keys=True)); tmp.replace(file)

class Signer:
    """Persistent Ed25519 signer: the production request format, without one node process per request."""
    def __init__(self):
        script = "const crypto=require('crypto'),fs=require('fs'),rl=require('readline').createInterface({input:process.stdin});const k={};rl.on('line',l=>{const [p,m]=l.split(' ');k[p]??=fs.readFileSync(p);process.stdout.write(crypto.sign(null,Buffer.from(m,'base64'),k[p]).toString('base64url')+'\\n');});"
        self.child = subprocess.Popen(["node", "-e", script], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True); self.lock = threading.Lock()
    def bind(self, fixture):
        def sign(key, message):
            with self.lock:
                self.child.stdin.write(str(fixture.keys[key]["path"]) + " " + base64.b64encode(message).decode() + "\n"); self.child.stdin.flush()
                return self.child.stdout.readline().strip()
        fixture.sign = sign
    def close(self):
        self.child.stdin.close(); self.child.wait(timeout=10)

class Probe:
    def __init__(self):
        # Git transport helpers can orphan an exited shell when their service shuts down.
        # Own and reap those descendants here instead of leaking zombies to the qualification gate.
        if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
            raise RuntimeError("Slice fixture requires Linux child-subreaper support")
        self.root = Path(tempfile.mkdtemp(prefix="hf-slices-")); ledger(paths=[str(self.root)])
        self.signer = Signer(); self.f = None; self.p = None; self.state = {}
    # ------------------------------------------------------------------------------------------------ services
    def call(self, fixture, component, action, payload, key):
        status, response = fixture.invoke(action, payload, key=key, component=component, timeout_seconds=60)
        return response
    def ok(self, action, payload, key="operator", component="11.5", remote=False):
        response = self.call(self.p if remote else self.f, component, action, payload, key)
        expect(response.get("ok") is True, action + " refused: " + json.dumps(response.get("error"))[:800])
        return response["result"]
    def reject(self, action, payload, code, key="operator", component="11.5", remote=False):
        response = self.call(self.p if remote else self.f, component, action, payload, key)
        expect(response.get("ok") is False and response.get("error", {}).get("code") == code, "expected " + code + ", observed " + json.dumps(response)[:800])
        return response
    def scoped(self, **values):
        i = self.f.ids; return dict(organisation_id=i["organisation"], run_id=i["run"], authority_epoch=i["epoch"], **values)
    def sql(self, statement, values=None):
        return self.f.sql(statement, values or [])
    def refused_sql(self, statement, values=None, needle="immutable"):
        try:
            self.f.sql(statement, values or [])
        except AssertionError as error:
            expect(needle in str(error).lower(), "wrong SQL refusal: " + str(error)[:300]); return
        raise AssertionError("SQL statement was accepted: " + statement[:80])
    def start_provisioner(self, env):
        f = self.f; p = copy.copy(f); p.child = None; p.service_role = "provisioner"
        with socket.socket() as sock: sock.bind(("127.0.0.1", 0)); p.port = sock.getsockname()[1]
        p.origin = "https://localhost:" + str(p.port)
        p.components = f.path / "components-provisioner"; p.components.mkdir()
        for name in ("1.4", "4.2", "4.4", "14.1", "11.5"):
            shutil.copyfile(ROOT / "services/hyperfide/components" / (name + ".json"), p.components / (name + ".json"))
        config = json.loads(f.identity_config.read_text()); config["origin"] = p.origin
        p.identity_config = f.path / "identity-provisioner.json"; p.identity_config.write_text(json.dumps(config))
        p.env = dict(f.env, HF_IDENTITY_CONFIG_FILE=str(p.identity_config), **env)
        ledger(ports=[p.port]); IdentityFixture.start(p); self.signer.bind(p); self.p = p
    # ------------------------------------------------------------------------------------------------ fixtures
    def build(self):
        modules = int(os.environ.get("HF_SLICE_FIXTURE_MODULES", large.MODULES))
        started = time.monotonic()
        self.fx = large.build(self.root / "fixture", seed=int(os.environ.get("HYPERFIDE_RANDOM_SEED", "115")), modules=modules)
        OBSERVATIONS["fixture"] = {k: self.fx[k] for k in ("file_count", "language_count", "languages", "graph_commit", "pinned_commit", "control_commit", "control_files", "modules_per_language")}
        OBSERVATIONS["fixture"]["generation_seconds"] = round(time.monotonic() - started, 1)
        self.scratch = self.root / "graph-scratch"; self.scratch.mkdir()
        self.graph_config = self.root / "graph.json"; self.slots_root = self.root / "slots"; self.slots_root.mkdir()
        self.sources = self.root / "sources.json"; self.canary = "hf-slice-canary-" + uid()
        fx = self.fx; probe = self
        def setup(f):
            i = f.ids
            for commit in (fx["control_commit"], fx["pinned_commit"]):
                f.sql("INSERT INTO hyperfide.source_objects(organisation_id,repository_id,object_id) VALUES($1,$2,$3)", [i["organisation"], i["repository"], commit])
            probe.slots = {}
            for n in range(1, 10):
                slot = uid(); probe.slots[n] = slot
                f.sql("INSERT INTO hyperfide.worker_slots(organisation_id,id,sandbox_id,slot_key,boot_generation,capacity_kind,state) VALUES($1,$2,$3,$4,1,'AGENT','READY')", [i["organisation"], slot, i["sandbox"], "slice-slot-" + str(n)])
            # An accepted generation-3 spec (the packet fixture already accepts generation 2) whose parsed intent maps the
            # slice clause, so real packet creation loads exact 11.5/V-057 proof obligations through the 2.4 loader.
            probe.spec2, probe.slice_section, probe.slice_criteria = accept_slice_spec(f, SLICE_SPEC_GENERATION)
            probe.rubric = packets.RUBRIC
            packets.move_run(f, SLICE_SPEC_GENERATION, probe.spec2, "RUNNING")
            probe.graph_config.write_text(canonical({"schema_version": 1, "execution_role": "REMOTE", "scratch_root": str(probe.scratch), "cg_binary": str(ROOT / "cg"),
                                                     "cg_digest": sha((ROOT / "cg").read_bytes()), "repositories": {i["repository"]: fx["repository"]}}))
        self.f = packets.PacketFixture(extra_components=("7.1", "7.2", "7.3", "11.5"), extra_setup=setup, seed_historical_runtime=False,
                                       extra_env={"HYPERFIDE_GRAPH_CONFIG": str(self.graph_config)}, source_object_id=fx["graph_commit"])
        ledger(databases=[self.f.database], roles=[self.f.runtime_role], paths=[str(self.f.path)], ports=[self.f.port])
        self.signer.bind(self.f)
        self.write_sources(fx["repository"])
        self.start_provisioner({"HF_EXECUTION_HOST_CLASS": "remote", "HF_PREPARATION_WORKSPACE_ROOT": str(self.slots_root),
                                "HF_SLICE_SOURCE_CONFIG": str(self.sources), "HF_SLICE_TEST_CANARY": self.canary})
    def write_sources(self, repository):
        self.sources.write_text(json.dumps({"schema_version": 1, "repositories": {self.f.ids["repository"]: {
            "url": "file://" + repository, "submodules": {self.fx["gitlink"]: "file://" + self.fx["submodule"]}}}}))
    def graph(self, component, action, payload):
        return self.ok(action, payload, key="operator", component=component)
    def ingest(self, manifest, chunks, channel):
        i = self.f.ids
        build = self.graph("7.2", "graph.ingest.create", self.scoped(bundles=[manifest]))["build_id"]
        for n in range(len(manifest["chunks"])):
            self.graph("7.2", "graph.ingest.chunk", self.scoped(build_id=build, bundle_digest=manifest["bundle_digest"], chunk=chunks(n)))
        self.graph("7.2", "graph.ingest.seal", self.scoped(build_id=build))
        calls = 0
        while self.graph("7.2", "graph.ingest.resolve", self.scoped(build_id=build, limit=256))["state"] != "READY":
            calls += 1; expect(calls < 200000, "graph resolution did not converge")
        published = self.graph("7.3", "graph.publish.commit", self.scoped(build_id=build, channel=channel, expected_generation="0", operation_id=uid()))
        return dict(published, build_id=build, resolve_calls=calls)
    def publish_graphs(self):
        fx, i = self.fx, self.f.ids
        configuration = {"build_flags": [], "resolver_digest": sha(b"slice-resolver"), "generated_manifest_digest": sha(b"slice-generated")}
        def live(commit, tree, generation, config):
            return self.graph("7.1", "graph.extract.create", dict(organisation_id=i["organisation"], run_id=i["run"], repository_id=i["repository"],
                                                                   commit=commit, tree=tree, generation=generation, configuration=config))
        def port(commit, tree, generation, config):
            return large.extract_bundle(ROOT, repository=fx["repository"], commit=commit, tree=tree, organisation_id=i["organisation"], run_id=i["run"],
                                        repository_id=i["repository"], generation=generation, configuration=config, scratch=self.scratch, cg=ROOT / "cg")
        started = time.monotonic()
        live0 = live(fx["control_commit"], fx["control_tree"], "1", configuration)
        port0 = port(fx["control_commit"], fx["control_tree"], "1", configuration)
        self.state["fidelity"] = {"live": live0["bundle_digest"], "port": port0["manifest"]["bundle_digest"], "files": fx["control_files"]}
        reader = lambda bundle: (lambda n: self.graph("7.1", "graph.extract.read-chunk", {"bundle_digest": bundle, "index": n}))
        self.g0 = self.ingest(live0, reader(live0["bundle_digest"]), "slice-control")
        alternative = dict(configuration, resolver_digest=sha(b"slice-resolver-alternative"))
        live0b = live(fx["control_commit"], fx["control_tree"], "1", alternative)
        self.g0b = self.ingest(live0b, reader(live0b["bundle_digest"]), "slice-control-alternative")
        OBSERVATIONS["control_graphs_seconds"] = round(time.monotonic() - started, 1)
        started = time.monotonic()
        big = port(fx["graph_commit"], fx["graph_tree"], "1", configuration)
        extracted = time.monotonic()
        directory = Path(big["directory"])
        self.g1 = self.ingest(big["manifest"], lambda n: json.loads((directory / (str(n) + ".json")).read_text()), "slices")
        OBSERVATIONS["graph"] = {"extract_seconds": round(extracted - started, 1), "cg_index_ms": big["index_ms"], "facts": big["facts"], "chunks": len(big["manifest"]["chunks"]),
                                 "ingest_publish_seconds": round(time.monotonic() - extracted, 1), "resolve_calls": self.g1["resolve_calls"],
                                 "source_bodies": big["manifest"]["counts"]["source_bodies"], "files": big["manifest"]["counts"]["files"]}
        shutil.rmtree(directory)
    # ------------------------------------------------------------------------------------------------ packets
    def task_packet(self, key, touches, graph_manifest, slot):
        f, i = self.f, self.f.ids
        graph = {"required": True, "manifest_id": graph_manifest, "reason": None} if graph_manifest else {"required": False, "manifest_id": None, "reason": "Slice baseline deliberately runs without a graph"}
        definition = f.task_definition(section=self.slice_section, touches=touches, graph_inputs=graph)
        task = f.insert_task("alpha.slice-" + key, definition, criteria=self.slice_criteria, generation=SLICE_SPEC_GENERATION, spec=self.spec2)
        proof = f.proof_policy(self.slice_criteria, generation=SLICE_SPEC_GENERATION, spec=self.spec2)
        proof["clauses"] = [{"id": "11.5", "mode": "REVIEW", "acceptance_ids": ["V-057"], "reviewers": [i["watcher"]], "rubric_digest": self.rubric}]
        f.register_proof(task, proof)
        return f.ok("hierarchy.packet.create", f.packet_input(task_id=task, idempotency_key="slice-" + key, slot_id=slot), key="manager", component="3.2")
    def craft(self, base, *, commit, graph=None, submodules=None, slot=None):
        """Fault/variation injection: an immutable packet row whose pins differ from the run's current repository pin."""
        packet = copy.deepcopy(base["packet"]); m = packet["mandatory"]; i = self.f.ids
        m["identity"]["attempt_id"] = uid()
        for repository in m["inputs"]["repositories"]: repository["source_object_id"] = commit
        for repository in m["runtime"]["declared_profile"]["repositories"]:
            repository["commit"] = commit; repository["submodules"] = submodules or []
        if graph is not None: m["inputs"]["graph"] = graph
        if slot: m["runtime"]["slot_id"] = slot
        packet["mandatory_digest"] = identity(m); digest = identity(packet); ident = m["identity"]
        self.sql("INSERT INTO hyperfide.hierarchy_execution_packets(organisation_id,run_id,id,digest,mandatory_digest,task_id,attempt_id,attempt_generation,spec_revision_id,spec_generation,package_id,package_generation,authority_epoch,leader_generation,policy_digest,registry_digest,packet) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)",
                 [i["organisation"], i["run"], uid(), digest, packet["mandatory_digest"], ident["task_id"], ident["attempt_id"], ident["attempt_generation"], ident["spec_revision_id"],
                  ident["spec_generation"], ident["package_id"], ident["package_generation"], ident["authority_epoch"], ident["leader_generation"], m["policy_digest"], m["intent"]["registry_digest"], json.dumps(packet)])
        return {"digest": digest, "packet": packet}
    def graph_pin(self, published, commit):
        i = self.f.ids
        snap = self.graph("7.3", "graph.publish.snapshot", self.scoped(manifest_id=published["manifest_id"], expected_sources=[{"repository_id": i["repository"], "source_object_id": commit}]))
        keys = ["source_manifest_digest", "input_digest", "parser_digest", "schema_digest", "config_digest", "source_set", "file_coverage", "source_coverage", "semantic_projection_complete", "unprojected_semantic_edge_count", "unresolved_reference_count"]
        return dict({"required": True, "manifest_id": published["manifest_id"], "manifest_digest": snap["manifest_digest"]}, **{k: snap[k] for k in keys})
    def derive(self, packet, key="manager", **extra):
        return self.ok("preparation.slice.derive", self.scoped(packet_digest=packet["digest"], repository_id=self.f.ids["repository"], **extra), key=key)
    def materialize(self, manifest, slot=None):
        s = manifest["slot"]
        return self.ok("preparation.slice.materialize", self.scoped(slice_digest=manifest["digest"], sandbox_id=s["sandbox_id"], slot_id=slot or s["slot_id"],
                                                                    sandbox_boot_generation=s["sandbox_boot_generation"]), key="provisioner", remote=True)
    def run(self, materialisation, commands, outputs=(), required=(), operation=None):
        return self.ok("preparation.slice.run", self.scoped(operation_id=operation or uid(), materialisation_id=materialisation, commands=commands,
                                                            build_outputs=list(outputs), required_paths=list(required)), key="provisioner", remote=True)
    def workspace(self, manifest):
        s = manifest["slot"]; return self.slots_root / s["sandbox_id"] / s["slot_id"] / s["sandbox_boot_generation"] / "workspace"
    def full_checkout(self, commit, name):
        target = self.root / name
        subprocess.run(["git", "clone", "-q", "--no-checkout", "file://" + self.fx["repository"], str(target)], check=True, env=dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1"))
        subprocess.run(["git", "-c", "advice.detachedHead=false", "checkout", "-q", "--detach", commit], cwd=target, check=True, env=dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1", GIT_LFS_SKIP_SMUDGE="1"))
        for item in self.fx["lfs"]:   # the reference full tree holds real LFS content, as a smudged checkout would
            content = (Path(self.fx["repository"]) / ".git/lfs/objects" / item["oid"][7:9] / item["oid"][9:11] / item["oid"][7:]).read_bytes()
            (target / item["path"]).write_bytes(content)
        return target
    def close(self):
        errors = []
        for fixture in (self.p, self.f):
            if fixture is None: continue
            try: fixture.stop() if fixture is self.p else fixture.close()
            except Exception as error: errors.append(str(error))
        try: self.signer.close()
        except Exception as error: errors.append(str(error))
        reaped = []
        deadline = time.monotonic() + 5
        while True:
            try:
                pid, status = os.waitpid(-1, os.WNOHANG)
            except ChildProcessError:
                OBSERVATIONS["process_cleanup"] = {"complete": True, "reaped": reaped}
                break
            if pid:
                reaped.append({"pid": pid, "status": status})
            elif time.monotonic() >= deadline:
                OBSERVATIONS["process_cleanup"] = {"complete": False, "reaped": reaped}
                errors.append("Fixture descendants remained after service shutdown")
                break
            else:
                time.sleep(.02)
        shutil.rmtree(self.root, ignore_errors=True)
        if errors: raise AssertionError("; ".join(errors)[:1000])

def files_under(root):
    result = {}
    for path in Path(root).rglob("*"):
        rel = path.relative_to(root).as_posix()
        if rel == ".git" or rel.startswith(".git/") or "/.git/" in rel or rel.endswith("/.git"): continue
        if path.is_symlink() or path.is_file(): result[rel] = path
    return result
def tree_paths(repository, commit):
    out = subprocess.run(["git", "ls-tree", "-r", "-z", "--full-tree", commit], cwd=repository, stdout=subprocess.PIPE, check=True).stdout.decode()
    return {line.split("\t", 1)[1]: line.split(" ")[0] for line in out.split("\0") if line}
def included(manifest, path):
    return manifest["mode"] == "FULL_TREE" or any(entry == path or (entry.endswith("/") and path.startswith(entry)) for entry in manifest["included_paths"])

def main():
    probe = Probe(); state = probe.state; started = time.monotonic()
    try:
        probe.build(); f = probe.f; fx = probe.fx; i = f.ids
        check("slice.fixture.scale-and-languages", lambda: expect(fx["file_count"] > 20000 and fx["language_count"] >= 11 and len(set(fx["languages"])) == fx["language_count"],
                                                                  "fixture has %d files and %d languages" % (fx["file_count"], fx["language_count"])))
        probe.publish_graphs()
        check("slice.graph.extraction-matches-live-7.1", lambda: expect(state["fidelity"]["live"] == state["fidelity"]["port"],
                                                                        "large-graph extraction port differs from the live 7.1 service bundle"))
        def published():
            count = probe.sql("SELECT count(*)::int AS n FROM hyperfide.graph_files f JOIN hyperfide.graph_manifests m ON m.organisation_id=f.organisation_id AND m.run_id=f.run_id AND m.build_id=f.graph_id WHERE m.id=$1", [probe.g1["manifest_id"]])[0]["n"]
            OBSERVATIONS["graph"]["published_files"] = count
            expect(probe.g1["complete"] is True and count == OBSERVATIONS["graph"]["files"], "published graph differs from extracted coverage: %d" % count)
            expect(count > 20000, "published graph covers only %d files" % count)
        check("slice.graph.real-publication", published)
        def registered():
            control = probe.ok("preparation.slice.describe", {}); remote = probe.ok("preparation.slice.describe", {}, key="provisioner", remote=True)
            expect(control["role"] == "control" and remote["role"] == "provisioner" and control["qualification_scope"] == "SLICE_NEVER_FULL_TREE", "describe differs by role")
            fragments = [json.loads((x.components / "11.5.json").read_text())["id"] for x in (f, probe.p)]
            expect(fragments == ["11.5", "11.5"], "fragment not served from each service component directory")
        check("slice.component.registered-both-roles", registered)

        slots = probe.slots; g1 = probe.g1["manifest_id"]
        work = {}
        work["py3"] = probe.task_packet("py3", ["services/python/m03/src/u0.py"], g1, slots[1])
        work["go5"] = probe.task_packet("go5", ["services/go/m01/"], g1, slots[2])
        work["rs7"] = probe.task_packet("rs7", ["services/rust/m02/src/u4.rs"], g1, slots[3])
        work["py0"] = probe.task_packet("py0", ["services/python/m00/"], g1, slots[4])
        work["py0f"] = probe.task_packet("py0f", ["services/python/m00/src/u0.py"], g1, slots[8])
        work["py2"] = probe.task_packet("py2", ["services/python/m02/src/u0.py"], g1, slots[9])
        work["sh"] = probe.task_packet("sh", ["services/shell/m01/src/u0.sh"], g1, slots[9])
        work["full"] = probe.task_packet("full", ["services/python/m03/src/u0.py"], None, slots[5])
        def placement():
            probe.reject("preparation.slice.derive", probe.scoped(packet_digest=work["py3"]["digest"], repository_id=i["repository"]), "SLICE_PLACEMENT_DENIED", key="operator", remote=True)
            probe.reject("preparation.slice.materialize", probe.scoped(slice_digest=sha(b"x"), sandbox_id=i["sandbox"], slot_id=slots[1], sandbox_boot_generation="1"), "SLICE_PLACEMENT_DENIED", key="operator")
            probe.reject("preparation.slice.derive", probe.scoped(packet_digest=work["py3"]["digest"], repository_id=i["repository"]), "SLICE_ROLE_DENIED", key="watcher")
        check("slice.placement.role-separation", placement)
        roots = {"contract_roots": ["contracts/python/"], "registry_roots": ["registry/components.json"]}
        slices = {}
        def concurrent_derive():
            jobs = {"py3": dict(roots), "go5": {"contract_roots": ["contracts/go/"]}, "rs7": {}}
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                results = dict(zip(jobs, pool.map(lambda key: probe.derive(work[key], **jobs[key]), jobs)))
            for key, result in results.items(): slices[key] = result["manifest"]
            expect(all(s["mode"] == "SLICE" and s["fallback_reason"] is None for s in slices.values()), "concurrent derivation fell back: " + json.dumps({k: (v["mode"], v["fallback_reason"], v["diagnostics"][:3]) for k, v in slices.items()}))
            expect(len({s["digest"] for s in slices.values()}) == 3 and len({s["packet_digest"] for s in slices.values()}) == 3, "concurrent slices are not distinct")
        check("slice.derive.concurrent-distinct-slices", concurrent_derive)
        def exact():
            pins = probe.sql("SELECT digest,packet->'mandatory'->'inputs'->'graph'->>'manifest_digest' AS graph FROM hyperfide.hierarchy_execution_packets WHERE digest=ANY($1::text[])", [[w["digest"] for w in work.values()]])
            graphs = {row["digest"]: row["graph"] for row in pins}
            for s in slices.values():
                expect(s["commit"] == fx["graph_commit"] and s["graph_manifest_id"] == g1 and s["graph_manifest_digest"] == graphs[s["packet_digest"]], "slice not bound to exact commit/graph")
                expect(identity({k: v for k, v in s.items() if k != "digest"}) == s["digest"], "slice digest does not bind its canonical body")
                stored = probe.sql("SELECT commit,mode,manifest_text FROM hyperfide.workspace_slice_manifests WHERE digest=$1", [s["digest"]])[0]
                expect(stored["commit"] == fx["graph_commit"] and sha(stored["manifest_text"].encode()) == s["digest"], "stored row differs")
        check("slice.derive.exact-commit-and-graph", exact)
        def closure():
            s = slices["py3"]; files = [p for p in s["included_paths"] if not p.endswith("/")]
            chain = ["services/python/m03/src/u%d.py" % n for n in range(fx["units_per_module"])]
            expect(all(p in files for p in chain), "closure misses the module import chain")
            expect("services/python/m04/src/u0.py" not in files and not any(p.startswith("services/javascript/") for p in files), "closure includes unrelated files")
            expect(s["closure"]["complete"] is True and s["closure"]["unresolved"] == 0 and s["closure"]["files"] >= len(chain) and s["closure"]["edges"] >= len(chain) - 1, "closure statistics are incomplete")
            expect(len(files) < fx["file_count"] / 50, "slice is not materially smaller than the tree")
            expect("services/python/" in s["excluded_roots"] or any(r.startswith("services/python/m0") for r in s["excluded_roots"]), "excluded roots not recorded")
            OBSERVATIONS["slice_py3"] = {"included_paths": len(s["included_paths"]), "closure": s["closure"], "excluded_roots": len(s["excluded_roots"])}
        check("slice.derive.file-level-closure", closure)
        def roots_check():
            s = slices["py3"]
            for path in ("services/python/pyproject.toml", "Makefile", "WORKSPACE"): expect(path in s["build_roots"] and path in s["included_paths"], "build root missing: " + path)
            for path in ("services/python/m03/tests/test_u0.py", "services/python/m03/tests/fixtures/case.json", "contracts/python/contract.py", "registry/components.json", ".gitattributes", ".gitmodules"):
                expect(included(s, path), "slice misses " + path)
            expect("services/common.mk" not in s["included_paths"], "non-build-root include unexpectedly present")
        check("slice.derive.build-roots-tests-fixtures-contracts", roots_check)
        def hit():
            again = probe.derive(work["py3"], **roots)
            expect(again["digest"] == slices["py3"]["digest"] and again["replayed"] is True, "unchanged input was not a hit")
            expect(probe.sql("SELECT count(*)::int AS n FROM hyperfide.workspace_slice_manifests WHERE packet_digest=$1", [work["py3"]["digest"]])[0]["n"] == 1, "replay stored a second manifest")
        check("slice.derive.unchanged-input-hit", hit)
        def miss():
            base = probe.derive(work["py0f"])["manifest"]
            c0g0 = probe.derive(probe.craft(work["py0f"], commit=fx["control_commit"], graph=probe.graph_pin(probe.g0, fx["control_commit"])))["manifest"]
            c0g0b = probe.derive(probe.craft(work["py0f"], commit=fx["control_commit"], graph=probe.graph_pin(probe.g0b, fx["control_commit"])))["manifest"]
            scope = probe.derive(work["py0"])["manifest"]
            budget = probe.derive(work["py0f"], budget={"files": 100000, "edges": 3999999})["manifest"]
            digests = [base["digest"], c0g0["digest"], c0g0b["digest"], scope["digest"], budget["digest"]]
            OBSERVATIONS["v038_digests"] = {"commit_c1_graph_g1": base["digest"], "commit_c0_graph_g0": c0g0["digest"], "commit_c0_graph_g0b": c0g0b["digest"], "owned_scope": scope["digest"], "budget": budget["digest"]}
            expect(all(m["mode"] == "SLICE" for m in (base, c0g0, c0g0b, scope)), "variation fell back: " + json.dumps([(m["mode"], m["fallback_reason"]) for m in (base, c0g0, c0g0b, scope)]))
            expect(c0g0["commit"] == fx["control_commit"] and c0g0["graph_manifest_id"] != c0g0b["graph_manifest_id"], "variation did not change commit/graph")
            expect(len(set(digests)) == len(digests), "changed input reused a slice digest")
        check("slice.derive.changed-input-miss", miss)
        def immutable():
            digest = slices["py3"]["digest"]
            probe.refused_sql("UPDATE hyperfide.workspace_slice_manifests SET mode='FULL_TREE',fallback_reason='TAMPERED' WHERE digest=$1", [digest])
            probe.refused_sql("UPDATE hyperfide.workspace_slice_manifests SET manifest_text=manifest_text||' ' WHERE digest=$1", [digest])
            probe.refused_sql("DELETE FROM hyperfide.workspace_slice_manifests WHERE digest=$1", [digest])
            expect(probe.sql("SELECT manifest_text FROM hyperfide.workspace_slice_manifests WHERE digest=$1", [digest])[0]["manifest_text"] == canonical({k: v for k, v in slices["py3"].items() if k != "digest"}), "manifest changed")
        check("slice.manifest.immutable", immutable)
        fallbacks = {}
        def unresolved():
            m = probe.derive(work["py2"])["manifest"]; fallbacks["py2"] = m
            expect(m["mode"] == "FULL_TREE" and m["fallback_reason"] == "UNRESOLVED_REFERENCE_REACHABLE" and m["included_paths"] == [], "omitted closure edge was not a fallback: " + json.dumps([m["mode"], m["fallback_reason"]]))
            expect({"code": "UNRESOLVED_REFERENCE_REACHABLE", "path": fx["unresolved_path"]} in m["diagnostics"], "unresolved edge not attributed: " + json.dumps(m["diagnostics"][:4]))
        check("slice.fallback.unresolved-closure-edge", unresolved)
        def unparsed():
            m = probe.derive(work["sh"])["manifest"]; fallbacks["sh"] = m
            expect(m["mode"] == "FULL_TREE" and m["fallback_reason"] == "UNPARSED_LANGUAGE", "unparsed owned language did not fall back: " + str(m["fallback_reason"]))
        check("slice.fallback.unparsed-language", unparsed)
        def truncated():
            m = probe.derive(work["py3"], budget={"files": 3, "edges": 4000000}, **roots)["manifest"]; fallbacks["budget"] = m
            expect(m["mode"] == "FULL_TREE" and m["fallback_reason"] == "CLOSURE_BUDGET_TRUNCATED" and m["closure"]["truncated"] is True, "budget truncation was presented as a slice")
        check("slice.fallback.budget-truncated", truncated)
        def not_required():
            m = probe.derive(work["full"])["manifest"]; fallbacks["full"] = m
            expect(m["mode"] == "FULL_TREE" and m["fallback_reason"] == "GRAPH_NOT_REQUIRED" and m["graph_manifest_id"] is None, "graphless packet produced a slice")
        check("slice.fallback.graph-not-required", not_required)
        def stale():
            submodule = [{"path": fx["gitlink"], "commit": fx["submodule_commit"]}]
            work["stale"] = probe.craft(work["py0"], commit=fx["pinned_commit"], submodules=submodule, slot=slots[6])
            work["stale-undeclared"] = probe.craft(work["py0"], commit=fx["pinned_commit"], slot=slots[7])
            m = probe.derive(work["stale"])["manifest"]; fallbacks["stale"] = m
            n = probe.derive(work["stale-undeclared"])["manifest"]; fallbacks["stale-undeclared"] = n
            expect(m["mode"] == "FULL_TREE" and m["fallback_reason"] == "GRAPH_GENERATION_STALE" and m["commit"] == fx["pinned_commit"] and m["graph_manifest_id"] is None, "stale graph generation was used: " + json.dumps([m["mode"], m["fallback_reason"]]))
            expect(m["submodules"] == submodule and n["submodules"] == [], "declared submodules not carried")
        check("slice.fallback.stale-graph-generation", stale)
        def reasons():
            rows = probe.sql("SELECT mode,fallback_reason,manifest->>'fallback_reason' AS body FROM hyperfide.workspace_slice_manifests")
            expect(rows and all((r["mode"] == "FULL_TREE") == (r["fallback_reason"] is not None) and r["fallback_reason"] == r["body"] for r in rows), "FULL_TREE row without a recorded reason")
            probe.refused_sql("INSERT INTO hyperfide.workspace_slice_manifests(organisation_id,run_id,digest,derivation_key,packet_digest,repository_id,commit,graph_manifest_id,graph_manifest_digest,mode,fallback_reason,parent_slice_digest,manifest,manifest_text,created_by_credential_id) SELECT organisation_id,run_id,$2,$3,packet_digest,repository_id,commit,NULL,NULL,'FULL_TREE',NULL,NULL,manifest,manifest_text,created_by_credential_id FROM hyperfide.workspace_slice_manifests WHERE digest=$1",
                              [fallbacks["full"]["digest"], sha(b"no-reason"), sha(b"no-reason-key")], needle="check constraint")
        check("slice.fallback.reason-always-recorded", reasons)

        mats = {}
        def concurrent_mat():
            keys = ["py3", "go5", "rs7"]
            with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
                results = list(pool.map(lambda key: probe.materialize(slices[key]), keys))
            for key, result in zip(keys, results): mats[key] = result
            expect(all(r["outcome"] == "READY" and r["verified_head"] == fx["graph_commit"] for r in results), "concurrent materialisation not ready")
            expect(len({str(probe.workspace(slices[k])) for k in keys}) == 3 and all(probe.workspace(slices[k]).is_dir() for k in keys), "slot workspaces are not distinct")
        check("slice.materialize.concurrent-slots", concurrent_mat)
        def partial():
            e = mats["py3"]["evidence"]
            expect(e["partial_clone"]["requested"] is True and e["partial_clone"]["missing_objects"] > 0 and e["sparse"]["mode"] == "no-cone", "partial clone not proven")
            ws = probe.workspace(slices["py3"])
            out = subprocess.run(["git", "config", "--get", "remote.origin.promisor"], cwd=ws, stdout=subprocess.PIPE, text=True).stdout.strip()
            expect(out == "true", "workspace is not a promisor partial clone")
        check("slice.materialize.partial-clone-positive", partial)
        reference = probe.full_checkout(fx["graph_commit"], "reference-c1")
        def identical():
            tree = tree_paths(reference, fx["graph_commit"]); full = files_under(reference)
            for key in ("py3", "go5", "rs7"):
                manifest = slices[key]; ws = probe.workspace(manifest); actual = files_under(ws)
                expected = {p for p in tree if included(manifest, p) and tree[p] != "160000"}
                expect(set(actual) == expected, key + ": materialised set differs from included∩tree: +%s -%s" % (sorted(set(actual) - expected)[:3], sorted(expected - set(actual))[:3]))
                for p in expected:
                    a, b = actual[p], full[p]
                    expect(a.read_bytes() == b.read_bytes() and (os.stat(a).st_mode & 0o111) == (os.stat(b).st_mode & 0o111), key + ": bytes differ from full tree: " + p)
                OBSERVATIONS.setdefault("byte_identity", {})[key] = len(expected)
        check("slice.materialize.byte-identical-to-full-tree", identical)
        def lfs():
            slices["py0"] = probe.derive(work["py0"])["manifest"]
            expect(slices["py0"]["mode"] == "SLICE" and fx["lfs"][0]["path"] in slices["py0"]["lfs_paths"], "LFS path not recorded in slice: " + json.dumps([slices["py0"]["mode"], slices["py0"]["fallback_reason"], slices["py0"]["lfs_paths"]]))
            mats["py0"] = probe.materialize(slices["py0"])
            ws = probe.workspace(slices["py0"]); content = (ws / fx["lfs"][0]["path"]).read_bytes()
            expect(sha(content) == fx["lfs"][0]["content_sha256"] and len(content) == fx["lfs"][0]["size"] and not content.startswith(b"version https://git-lfs"), "LFS path materialised as pointer bytes")
            expect(mats["py0"]["evidence"]["lfs"] == [{"path": fx["lfs"][0]["path"], "oid": fx["lfs"][0]["oid"], "size": fx["lfs"][0]["size"]}], "LFS evidence missing")
            expect(not (ws / fx["lfs"][1]["path"]).exists(), "out-of-slice LFS object materialised")
        check("slice.materialize.lfs-inside-slice", lfs)
        def submodule_full():
            mats["stale"] = probe.materialize(fallbacks["stale"])
            ws = probe.workspace(fallbacks["stale"]); e = mats["stale"]["evidence"]
            expect(mats["stale"]["outcome"] == "READY" and mats["stale"]["mode"] == "FULL_TREE" and mats["stale"]["fallback_reason"] == "GRAPH_GENERATION_STALE", "stale fallback did not materialise as FULL_TREE")
            head = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ws / fx["gitlink"], stdout=subprocess.PIPE, text=True).stdout.strip()
            expect(head == fx["submodule_commit"] and e["submodules"][0]["verified_head"] == fx["submodule_commit"], "submodule not at pinned commit")
            sub = Path(fx["submodule"])
            for rel in ("README.md", "lib/vendored.go"): expect((ws / fx["gitlink"] / rel).read_bytes() == (sub / rel).read_bytes(), "submodule bytes differ: " + rel)
            for item in fx["lfs"]: expect(sha((ws / item["path"]).read_bytes()) == item["content_sha256"], "full-tree LFS content differs")
            pinned = tree_paths(fx["repository"], fx["pinned_commit"])
            expect(e["partial_clone"]["requested"] is False and e["verification"]["materialised_files"] == sum(1 for mode in pinned.values() if mode != "160000"), "full tree incomplete")
        check("slice.materialize.submodule-and-lfs-full-tree", submodule_full)
        def undeclared():
            probe.reject("preparation.slice.materialize", probe.scoped(slice_digest=fallbacks["stale-undeclared"]["digest"], sandbox_id=i["sandbox"], slot_id=slots[7], sandbox_boot_generation="1"),
                         "SLICE_SUBMODULE_UNDECLARED", key="provisioner", remote=True)
            rows = probe.sql("SELECT outcome,reason FROM hyperfide.workspace_slice_materialisations WHERE slice_digest=$1", [fallbacks["stale-undeclared"]["digest"]])
            expect(rows == [{"outcome": "REFUSED", "reason": "SLICE_SUBMODULE_UNDECLARED"}] and not probe.workspace(fallbacks["stale-undeclared"]).exists(), "undeclared gitlink left a workspace or no refusal")
        check("slice.materialize.undeclared-submodule-refused", undeclared)
        def ineffective():
            nofilter = probe.root / "nofilter.git"
            subprocess.run(["git", "clone", "-q", "--bare", "--no-local", fx["repository"], str(nofilter)], check=True, env=dict(os.environ, GIT_CONFIG_GLOBAL="/dev/null", GIT_CONFIG_NOSYSTEM="1"))
            subprocess.run(["git", "config", "uploadpack.allowFilter", "false"], cwd=nofilter, check=True)
            slices["py0f"] = probe.derive(work["py0f"])["manifest"]
            probe.sources.write_text(json.dumps({"schema_version": 1, "repositories": {i["repository"]: {"url": "file://" + str(nofilter), "submodules": {}}}}))
            try:
                probe.reject("preparation.slice.materialize", probe.scoped(slice_digest=slices["py0f"]["digest"], sandbox_id=i["sandbox"], slot_id=slots[8], sandbox_boot_generation="1"),
                             "PARTIAL_CLONE_INEFFECTIVE", key="provisioner", remote=True)
            finally:
                probe.write_sources(fx["repository"])
            rows = probe.sql("SELECT outcome,reason,verified_head,evidence FROM hyperfide.workspace_slice_materialisations WHERE slice_digest=$1", [slices["py0f"]["digest"]])
            expect(len(rows) == 1 and rows[0]["outcome"] == "FAILED" and rows[0]["verified_head"] is None and rows[0]["evidence"].get("metrics") is None, "silent full clone was not a failed, cost-free record")
            expect(not probe.workspace(slices["py0f"]).exists() and not any(p.name.startswith(".materialise-") for p in probe.workspace(slices["py0f"]).parent.iterdir()), "failed materialisation left a workspace")
            expect(probe.sql("SELECT count(*)::int AS n FROM hyperfide.workspace_slice_materialisations WHERE slot_id=$1 AND outcome='READY'", [slots[8]])[0]["n"] == 0, "failed materialisation produced a ready claim")
        check("slice.materialize.ineffective-partial-clone-never-ready", ineffective)
        def binding():
            probe.reject("preparation.slice.materialize", probe.scoped(slice_digest=slices["py3"]["digest"], sandbox_id=i["sandbox"], slot_id=slots[2], sandbox_boot_generation="1"), "SLICE_SLOT_MISMATCH", key="provisioner", remote=True)
            probe.reject("preparation.slice.materialize", probe.scoped(slice_digest=slices["py3"]["digest"], sandbox_id=i["sandbox"], slot_id=slots[1], sandbox_boot_generation="1"), "SLICE_SLOT_OCCUPIED", key="provisioner", remote=True)
        check("slice.materialize.slot-binding-and-occupancy", binding)
        def cost():
            mats["full"] = probe.materialize(fallbacks["full"])
            sl, ft = mats["py3"]["evidence"]["metrics"], mats["full"]["evidence"]["metrics"]
            OBSERVATIONS["cost"] = {"slice": sl, "full_tree": ft, "files_ratio": round(sl["files_written"] / ft["files_written"], 5), "pack_bytes_ratio": round(sl["pack_bytes"] / ft["pack_bytes"], 5)}
            expect(mats["full"]["evidence"]["metrics"]["cost_claim"] == "FULL_TREE_BASELINE" and sl["cost_claim"] == "PARTIAL_CLONE_SPARSE_SLICE", "cost claims not labelled")
            expect(sl["files_written"] < ft["files_written"] and sl["pack_bytes"] < ft["pack_bytes"] and sl["disk_bytes"] < ft["disk_bytes"], "slice is not cheaper than the full tree: " + json.dumps(OBSERVATIONS["cost"]))
            expect(int(sl["wall_ns"]) > 0 and int(ft["wall_ns"]) > 0, "wall time not recorded")
        check("slice.cost.against-full-tree-baseline", cost)

        git = shutil.which("git"); tree = tree_paths(reference, fx["graph_commit"])
        outside_read, outside_oid_path = "services/javascript/m01/src/u3.js", "services/javascript/m01/src/u4.js"
        oid = subprocess.run(["git", "rev-parse", fx["graph_commit"] + ":" + outside_oid_path], cwd=reference, stdout=subprocess.PIPE, text=True).stdout.strip()
        commands = [
            {"id": "in-slice-read", "argv": ["sh", "-c", "cat services/python/m03/src/u0.py >/dev/null"], "cwd": ".", "env": {}, "timeout_ms": 5000},
            {"id": "lazy-read", "argv": [git, "cat-file", "-p", "HEAD:" + outside_read], "cwd": ".", "env": {}, "timeout_ms": 5000},
            {"id": "sanitised-lazy-read", "argv": ["env", "-i", git, "cat-file", "-p", oid], "cwd": ".", "env": {}, "timeout_ms": 5000},
            {"id": "untracked-write", "argv": ["sh", "-c", "mkdir -p services/rust/m01/src && echo x > services/rust/m01/src/new.rs"], "cwd": ".", "env": {}, "timeout_ms": 5000},
            {"id": "excluded-tracked-write", "argv": ["sh", "-c", "mkdir -p services/javascript/m01/src && echo y > services/javascript/m01/src/u5.js"], "cwd": ".", "env": {}, "timeout_ms": 5000},
            {"id": "declared-output", "argv": ["sh", "-c", "mkdir -p build && echo z > build/out.txt"], "cwd": ".", "env": {"SLICE_CANARY": probe.canary}, "timeout_ms": 5000},
        ]
        receipts = {}
        def reads():
            receipts["r1"] = probe.run(mats["py3"]["materialisation_id"], commands, outputs=["build/"])
            findings = receipts["r1"]["access"]["findings"]
            reads = {x["path"] for x in findings if x["access"] == "READ" and x["source"] == "LAZY_FETCH"}
            expect({outside_read, outside_oid_path} <= reads, "out-of-slice reads not detected: " + json.dumps(findings))
            codes = {c["id"]: c["exit_code"] for c in receipts["r1"]["commands"]}
            expect(codes["lazy-read"] != 0 and codes["sanitised-lazy-read"] != 0 and codes["in-slice-read"] == 0, "excluded blob was fetched: " + json.dumps(codes))
            events = probe.sql("SELECT path,access,source,decision FROM hyperfide.workspace_slice_access_events WHERE receipt_id=$1", [receipts["r1"]["receipt_id"]])
            expect(all(e["decision"] == "REFUSED" for e in events) and {outside_read, outside_oid_path} <= {e["path"] for e in events if e["access"] == "READ"}, "read refusals not persisted")
            ws = probe.workspace(slices["py3"])
            expect(not (ws / outside_read).exists() and subprocess.run(["git", "cat-file", "-e", oid], cwd=ws, env=dict(os.environ, GIT_NO_LAZY_FETCH="1")).returncode != 0, "excluded blob became local")
        check("slice.run.out-of-slice-read-refused", reads)
        def writes():
            findings = receipts["r1"]["access"]["findings"]
            got = {(x["path"], x["source"]) for x in findings if x["access"] == "WRITE"}
            expect(("services/rust/m01/src/new.rs", "WORKTREE_STATUS") in got and ("services/javascript/m01/src/u5.js", "SKIP_WORKTREE") in got, "out-of-slice writes not detected: " + json.dumps(sorted(got)))
            expect(not any(p.startswith("build/") for p, _ in got), "declared build output treated as out-of-slice")
            expect(receipts["r1"]["qualification_outcome"] == "REFUSED", "out-of-slice access did not refuse qualification")
        check("slice.run.out-of-slice-write-refused", writes)
        def monitor():
            access = receipts["r1"]["access"]; available = shutil.which("strace") is not None
            OBSERVATIONS["access_monitor"] = access["monitor"]
            if available: expect(access["monitor"] == "STRACE", "available strace monitor unused")
            else:
                expect(access["monitor"] == "UNAVAILABLE" and access["access_clean"] is False, "run without a monitor was reported access-clean")
                rows = probe.sql("SELECT decision,reason FROM hyperfide.workspace_slice_access_events WHERE receipt_id=$1 AND source='ACCESS_MONITOR_UNAVAILABLE'", [receipts["r1"]["receipt_id"]])
                expect(rows == [{"decision": "REFUSED", "reason": "ACCESS_MONITOR_UNAVAILABLE"}], "monitor unavailability not recorded")
        check("slice.run.access-monitor-recorded", monitor)
        def build_root():
            receipts["r2"] = probe.run(mats["py3"]["materialisation_id"], [{"id": "make-include", "argv": ["sh", "-c", "cat services/common.mk"], "cwd": ".", "env": {}, "timeout_ms": 5000}], required=["services/common.mk"])
            expect(receipts["r2"]["executed"] is False and receipts["r2"]["qualification_outcome"] == "REFUSED", "excluded build root was executed")
            expect({"access": "READ", "path": "services/common.mk", "source": "DECLARED_REQUIREMENT", "reason": "BUILD_ROOT_EXCLUDED"} in receipts["r2"]["access"]["findings"], "excluded build root not detected")
        check("slice.run.excluded-build-root-refused", build_root)
        widened = {}
        def widen():
            parent = slices["py3"]; before = probe.sql("SELECT manifest_text FROM hyperfide.workspace_slice_manifests WHERE digest=$1", [parent["digest"]])[0]["manifest_text"]
            widened["build"] = probe.ok("preparation.slice.widen", probe.scoped(slice_digest=parent["digest"], paths=["services/common.mk"], access="READ", source="DECLARED_REQUIREMENT", reason="BUILD_ROOT_EXCLUDED"), key="manager")
            widened["write"] = probe.ok("preparation.slice.widen", probe.scoped(slice_digest=parent["digest"], paths=["services/rust/m01/src/new.rs"], access="WRITE", source="WORKTREE_STATUS", reason="OUT_OF_SLICE_WRITE"), key="manager")
            for result, path in ((widened["build"], "services/common.mk"), (widened["write"], "services/rust/m01/src/new.rs")):
                m = result["manifest"]
                expect(m["parent_slice_digest"] == parent["digest"] and m["widening"]["added_paths"] == [path] and path in m["included_paths"] and result["digest"] != parent["digest"], "widening is not a new child manifest")
                events = probe.sql("SELECT decision,widened_slice_digest,path FROM hyperfide.workspace_slice_access_events WHERE slice_digest=$1 AND decision='WIDENED' AND path=$2", [parent["digest"], path])
                expect(events == [{"decision": "WIDENED", "widened_slice_digest": result["digest"], "path": path}], "widening not recorded as an access event")
            expect(probe.sql("SELECT manifest_text FROM hyperfide.workspace_slice_manifests WHERE digest=$1", [parent["digest"]])[0]["manifest_text"] == before, "parent manifest changed")
            again = probe.ok("preparation.slice.widen", probe.scoped(slice_digest=parent["digest"], paths=["services/common.mk"], access="READ", source="DECLARED_REQUIREMENT", reason="BUILD_ROOT_EXCLUDED"), key="manager")
            expect(again["digest"] == widened["build"]["digest"] and again["replayed"] is True, "widening replay changed identity")
            probe.reject("preparation.slice.widen", probe.scoped(slice_digest=fallbacks["full"]["digest"], paths=["services/common.mk"], access="READ", source="DECLARED_REQUIREMENT", reason="BUILD_ROOT_EXCLUDED"), "SLICE_WIDEN_UNNECESSARY", key="manager")
        check("slice.widen.explicit-new-manifest", widen)
        def conflict():
            probe.reject("preparation.slice.widen", probe.scoped(slice_digest=slices["py3"]["digest"], paths=["services/common.mk"], access="READ", source="DECLARED_REQUIREMENT", reason="DIFFERENT_REASON"), "SLICE_IDENTITY_CONFLICT", key="manager")
        check("slice.widen.conflicting-identity-refused", conflict)
        def widened_run():
            released = probe.ok("preparation.slice.release", probe.scoped(materialisation_id=mats["py3"]["materialisation_id"]), key="provisioner", remote=True)
            expect(released["workspace_absent"] is True, "release left the workspace")
            child = widened["build"]["manifest"]
            mats["py3w"] = probe.materialize(child)
            expect((probe.workspace(child) / "services/common.mk").read_bytes() == (reference / "services/common.mk").read_bytes(), "widened path not materialised")
            command = [{"id": "make-include", "argv": ["sh", "-c", "cat services/common.mk >/dev/null"], "cwd": ".", "env": {}, "timeout_ms": 5000}]
            receipts["r3"] = probe.run(mats["py3w"]["materialisation_id"], command, required=["services/common.mk"], operation=state.setdefault("r3op", uid()))
            sources = {x["source"] for x in receipts["r3"]["access"]["findings"]}
            expect(receipts["r3"]["executed"] is True and receipts["r3"]["commands"][0]["exit_code"] == 0 and sources <= {"ACCESS_MONITOR_UNAVAILABLE"}, "widened slice still lacks its build root: " + json.dumps(receipts["r3"]["access"]))
            expect(receipts["r3"]["slice_digest"] == child["digest"], "receipt not bound to the widened slice")
        check("slice.run.widened-slice-qualifies-inputs", widened_run)
        def receipt_identity():
            r = receipts["r1"]
            expect(r["slice_digest"] == slices["py3"]["digest"] and r["commit"] == fx["graph_commit"] and r["graph_manifest_digest"] == slices["py3"]["graph_manifest_digest"], "receipt lacks slice identity")
            expect(r["qualification_scope"] == "SLICE" and r["full_tree_equivalent"] is False and r["claims"]["full_tree_qualification"] == "NOT_CLAIMED", "slice receipt claims full-tree qualification")
            row = probe.sql("SELECT qualification_scope,full_tree_equivalent,receipt_digest,receipt FROM hyperfide.workspace_slice_receipts WHERE id=$1", [r["receipt_id"]])[0]
            expect(row["qualification_scope"] == "SLICE" and row["full_tree_equivalent"] is False and row["receipt_digest"] == identity(row["receipt"]), "stored receipt differs")
            probe.refused_sql("INSERT INTO hyperfide.workspace_slice_receipts(organisation_id,run_id,id,operation_id,request_digest,slice_digest,materialisation_id,commit,graph_manifest_digest,qualification_scope,full_tree_equivalent,qualification_outcome,receipt,receipt_digest,created_by_credential_id) SELECT organisation_id,run_id,$2,$3,request_digest,slice_digest,materialisation_id,commit,graph_manifest_digest,'SLICE',true,'PASS',receipt,receipt_digest,created_by_credential_id FROM hyperfide.workspace_slice_receipts WHERE id=$1",
                              [r["receipt_id"], uid(), uid()], needle="check constraint")
        check("slice.run.receipt-carries-slice-identity", receipt_identity)
        def omitted():
            seen = probe.ok("preparation.slice.inspect", probe.scoped(slice_digest=slices["py3"]["digest"], full_tree_paths=[outside_read, "services/python/m03/src/u0.py", "services/common.mk"]), key="manager")
            expect(seen["omitted_inputs"] == sorted([outside_read, "services/common.mk"]) and seen["qualification"] == "SLICE_ONLY_NOT_FULL_TREE", "full-tree comparison did not report omitted inputs")
            expect(sorted(seen["widened_children"]) == sorted([widened["build"]["digest"], widened["write"]["digest"]]) and len(seen["receipts"]) >= 2, "inspect lacks history")
            script = "import fs from 'node:fs';import {assertNotFullTreeQualification} from './services/hyperfide/dist/preparation/slices.js';const r=JSON.parse(fs.readFileSync(0,'utf8'));try{process.stdout.write(JSON.stringify({ok:assertNotFullTreeQualification(r)}));}catch(e){process.stdout.write(JSON.stringify({error:e.code}));}"
            def assess(receipt):
                return json.loads(subprocess.run(["node", "--input-type=module", "-e", script], input=json.dumps(receipt), cwd=ROOT, stdout=subprocess.PIPE, text=True, check=True).stdout)
            good = assess(receipts["r1"]); bad = assess(dict(receipts["r1"], full_tree_equivalent=True, qualification_scope="FULL_TREE"))
            expect(good.get("ok", {}).get("slice_digest") == slices["py3"]["digest"] and bad.get("error") == "SLICE_PRESENTED_AS_FULL_TREE", "full-tree presentation not detected: " + json.dumps([good, bad]))
        check("slice.run.full-tree-detects-omitted-inputs", omitted)
        def full_tree_receipt():
            receipts["stale"] = probe.run(mats["stale"]["materialisation_id"], [{"id": "submodule-present", "argv": ["sh", "-c", "test -f " + fx["gitlink"] + "/lib/vendored.go && test -f services/javascript/m01/src/u3.js"], "cwd": ".", "env": {}, "timeout_ms": 5000}])
            r = receipts["stale"]
            expect(r["mode"] == "FULL_TREE" and r["qualification_scope"] == "FULL_TREE" and r["fallback_reason"] == "GRAPH_GENERATION_STALE" and r["slice_digest"] == fallbacks["stale"]["digest"], "full-tree receipt lacks its recorded reason")
            expect(r["qualification_outcome"] == "PASS" and r["access"]["findings"] == [], "full-tree fallback run failed: " + json.dumps(r["access"]))
        check("slice.run.full-tree-fallback-receipt", full_tree_receipt)
        def replay():
            command = [{"id": "make-include", "argv": ["sh", "-c", "cat services/common.mk >/dev/null"], "cwd": ".", "env": {}, "timeout_ms": 5000}]
            again = probe.run(mats["py3w"]["materialisation_id"], command, required=["services/common.mk"], operation=state["r3op"])
            expect(again["replayed"] is True and again["receipt_id"] == receipts["r3"]["receipt_id"], "operation replay re-executed")
            probe.reject("preparation.slice.run", probe.scoped(operation_id=state["r3op"], materialisation_id=mats["py3w"]["materialisation_id"], commands=command, build_outputs=["build/"], required_paths=[]),
                         "SLICE_OPERATION_CONFLICT", key="provisioner", remote=True)
        check("slice.run.operation-replay", replay)
        def history():
            for table in ("workspace_slice_materialisations", "workspace_slice_receipts", "workspace_slice_access_events"):
                expect(probe.sql("SELECT count(*)::int AS n FROM hyperfide." + table)[0]["n"] > 0, "no history rows to protect in " + table)
            probe.refused_sql("UPDATE hyperfide.workspace_slice_materialisations SET outcome='READY' WHERE outcome='FAILED'")
            probe.refused_sql("DELETE FROM hyperfide.workspace_slice_materialisations")
            probe.refused_sql("UPDATE hyperfide.workspace_slice_receipts SET qualification_outcome='PASS'")
            probe.refused_sql("UPDATE hyperfide.workspace_slice_access_events SET decision='WIDENED'")
            probe.refused_sql("DELETE FROM hyperfide.workspace_slice_access_events")
        check("slice.sql.immutable-history", history)
        def isolation():
            for table in ("workspace_slice_manifests", "workspace_slice_materialisations", "workspace_slice_receipts", "workspace_slice_access_events"):
                probe.refused_sql("BEGIN ISOLATION LEVEL REPEATABLE READ;INSERT INTO hyperfide." + table + " DEFAULT VALUES;ROLLBACK;", needle='"code":"25001"')
        check("slice.sql.repeatable-read-refused", isolation)
        def canaries():
            docs = [r["d"] for r in probe.sql("SELECT manifest::text AS d FROM hyperfide.workspace_slice_manifests UNION ALL SELECT receipt::text FROM hyperfide.workspace_slice_receipts UNION ALL SELECT evidence::text FROM hyperfide.workspace_slice_materialisations")]
            secrets = [probe.canary, i["lease"], i["grant"] if "grant" in i else f.grant, base64.urlsafe_b64encode(f.secret).decode().rstrip("="), str(probe.sources), str(probe.slots_root)]
            secrets += [k["public_key_b64"] for k in f.keys.values()] + [k["path"].read_text().split("\n")[1] for k in f.keys.values()]
            secrets += [i[name] for name in ("operator", "provisioner", "manager", "leader", "watcher")]
            for doc in docs:
                for secret in secrets: expect(secret not in doc, "slice history contains authority or credential material")
                lowered = doc.lower()
                for key in ('"lease_token"', '"private_key"', '"access_token"', '"api_key"', '"password"', "begin private key"): expect(key not in lowered, "authority field in slice history: " + key)
            OBSERVATIONS["canary_documents"] = len(docs)
        check("slice.canary.no-authority-material", canaries)
    except Exception as error:
        traceback.print_exc(file=sys.stderr)
        unexecuted(type(error).__name__ + ": " + str(error))
    finally:
        database = probe.f.database if probe.f else None; ports = [x.port for x in (probe.f, probe.p) if x]; root = probe.root
        OBSERVATIONS["probe_seconds"] = round(time.monotonic() - started, 1)
        try: probe.close()
        except Exception as error: print("close failed: " + str(error), file=sys.stderr)
        def absent():
            expect(OBSERVATIONS.get("process_cleanup", {}).get("complete") is True, "fixture descendants remain")
            if database: expect(probe.f.sql("SELECT count(*)::int AS n FROM pg_database WHERE datname=$1", [database], admin=True)[0]["n"] == 0, "fixture database remains")
            expect(not root.exists(), "fixture root remains")
            for port in ports:
                with socket.socket() as sock: expect(sock.connect_ex(("127.0.0.1", port)) != 0, "service listener remains")
        if "slice.cleanup.observed" not in PRINTED: check("slice.cleanup.observed", absent)
        unexecuted("probe aborted before this assertion")
        (campaign() / "observations.json").write_text(json.dumps({"scope": "task-component", "task": TASK, "observations": OBSERVATIONS, "failed": FAILED,
                                                                   "full_tree_qualification": "NOT_CLAIMED", "access_monitor": OBSERVATIONS.get("access_monitor")}, sort_keys=True, indent=1) + "\n")
    print(json.dumps({"type": "observations", "task": TASK, "observations": OBSERVATIONS}), flush=True)
    return 1 if FAILED else 0

def cleanup():
    """Independent, idempotent removal of everything a run (or a crashed run) recorded, with observed absence."""
    folder = campaign(); file = folder / "resources.json"
    recorded = json.loads(file.read_text()) if file.exists() else {"databases": [], "roles": [], "paths": [], "ports": []}
    def admin(statement, values=()):
        script = "const {createRequire}=require('module'),pg=createRequire(process.cwd()+'/services/hyperfide/package.json')('pg');(async()=>{const c=new pg.Client({connectionString:process.env.DATABASE_URL});await c.connect();try{const q=JSON.parse(require('fs').readFileSync(0,'utf8'));process.stdout.write(JSON.stringify((await c.query(q.sql,q.values)).rows));}finally{await c.end();}})().catch(e=>{process.stderr.write(String(e.message));process.exitCode=1;});"
        result = subprocess.run(["node", "-e", script], cwd=ROOT, input=json.dumps({"sql": statement, "values": list(values)}), text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
        if result.returncode: raise RuntimeError("cleanup query failed: " + result.stderr[:300])
        return json.loads(result.stdout)
    import re
    for database in recorded["databases"]:
        if re.fullmatch(r"hf_identity_[0-9a-f]{32}", database): admin('DROP DATABASE IF EXISTS "' + database + '" WITH (FORCE)')
    for role in recorded["roles"]:
        if re.fullmatch(r"hf_ir_[0-9a-f]{32}", role): admin('DROP ROLE IF EXISTS "' + role + '"')
    for path in recorded["paths"]:
        p = Path(path)
        if p.parent == Path(tempfile.gettempdir()) and p.name.startswith(LEDGER_PREFIXES): shutil.rmtree(p, ignore_errors=True)
    databases = admin("SELECT count(*)::int AS n FROM pg_database WHERE datname=ANY($1::text[])", [recorded["databases"]])[0]["n"] if recorded["databases"] else 0
    roles = admin("SELECT count(*)::int AS n FROM pg_roles WHERE rolname=ANY($1::text[])", [recorded["roles"]])[0]["n"] if recorded["roles"] else 0
    listeners = []
    for port in recorded["ports"]:
        with socket.socket() as sock: sock.settimeout(.2); listeners.append(sock.connect_ex(("127.0.0.1", port)) != 0)
    paths_absent = all(not Path(p).exists() for p in recorded["paths"])
    complete = databases == 0 and roles == 0 and paths_absent and all(listeners)
    evidence = {"complete": complete, "databases": recorded["databases"], "databases_absent": databases == 0, "roles_absent": roles == 0,
                "paths": recorded["paths"], "paths_absent": paths_absent, "ports": recorded["ports"], "listeners_absent": all(listeners)}
    (folder / "resource-absence.json").write_text(json.dumps(evidence, sort_keys=True) + "\n")
    status = "deleted" if complete else "unknown"
    print(json.dumps({"type": "cleanup", "complete": complete, "resources": [
        {"id": "hf-task-11.5-database", "status": status, "observed_absent": databases == 0 and roles == 0, "evidence_artifact": "slices/resource-absence.json"},
        {"id": "hf-task-11.5-repository-root", "status": status, "observed_absent": paths_absent and all(listeners), "evidence_artifact": "slices/resource-absence.json"}]}), flush=True)
    return 0 if complete else 1

if __name__ == "__main__":
    sys.exit(cleanup() if "--cleanup" in sys.argv else main())
