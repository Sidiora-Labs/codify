#!/usr/bin/env python3
"""Execute bootstrap harness checks against real, disposable subprocess fixtures."""
from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest

HERE = Path(__file__).resolve().parent
RUNNER = HERE / "qualify.py"
CHECKER = HERE / "check-evidence.py"

ASSERTIONS = [
    "harness.selector.missing", "harness.selector.unknown", "harness.selector.empty",
    "harness.selector.duplicate", "harness.selector.empty-suite", "harness.runner.missing",
    "harness.child.missing", "harness.checker.missing", "harness.fixture.missing",
    "harness.fixture.digest", "harness.credential.missing", "harness.child.failure",
    "harness.child.timeout-descendants", "harness.assertion.zero", "harness.assertion.duplicate",
    "harness.assertion.unexecuted", "harness.assertion.failure", "harness.assertion.malformed",
    "harness.cleanup.missing", "harness.cleanup.failure", "harness.artifact.missing",
    "harness.artifact.tampered", "harness.receipt.tampered", "harness.receipt.scope-forgery",
    "harness.receipt.inventory-forgery", "harness.campaign.snapshot-tampered",
    "harness.campaign.append-only", "harness.campaign.changed-input",
    "harness.selector.task", "harness.selector.suite", "harness.campaign.failed-then-pass",
    "harness.checker.canonical", "harness.child.normal-exit-descendants",
    "harness.source.declared-import", "harness.source.undeclared-import-in-root",
    "harness.cleanup.retention-approved", "harness.cleanup.retention-unapproved",
    "harness.cleanup.retention-owner-missing", "harness.cleanup.retention-expiry-missing",
    "harness.schema.registry-version-bool", "harness.schema.registration-version-bool",
    "harness.schema.manifest-version-bool", "harness.schema.input-size-bool",
    "harness.schema.manifest-unknown-field", "harness.schema.approval-unknown-field",
    "harness.source.output-equals-workspace", "harness.source.output-contains-probe",
    "harness.child.detached-pipe-timeout",
    "harness.source.git-bytecode-parity",
]

PROBE = r"""import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

mode = sys.argv[1]
def emit(value):
    print(json.dumps(value), flush=True)
if mode in ("timeout", "timeout-detached-pipe"):
    child = subprocess.Popen([sys.executable, "-c", "import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(120)"], start_new_session=(mode == "timeout-detached-pipe"))
    Path("descendant.pid").write_text(str(child.pid), encoding="utf-8")
    time.sleep(120)
if mode == "normal-exit-descendant":
    child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(120)"], stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    Path("descendant.pid").write_text(str(child.pid), encoding="utf-8")
if mode == "first-fails":
    marker = Path("fault-attempted")
    if not marker.exists():
        marker.write_text("injected first-attempt failure", encoding="utf-8")
        sys.exit(19)
if mode == "malformed":
    print('{"type":"assertion",broken', flush=True)
if mode != "zero":
    emit({"type":"assertion", "id":"bootstrap.alpha", "expected":True, "actual": mode != "failed-assertion"})
    if mode == "duplicate":
        emit({"type":"assertion", "id":"bootstrap.alpha", "expected":True, "actual":True})
    if mode != "partial":
        emit({"type":"assertion", "id":"bootstrap.beta", "expected":7, "actual":7})
if mode != "no-cleanup":
    emit({"type":"cleanup", "resources":[], "complete":True})
if mode == "failure":
    sys.exit(17)
"""


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def write_json(path: Path, value: object) -> None:
    path.write_text(json.dumps(value, sort_keys=True, indent=2) + "\n", encoding="utf-8")


def seal_receipt(receipt: dict) -> None:
    receipt.pop("seal", None)
    receipt["seal"] = digest(json.dumps(receipt, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())


class Fixture:
    def __init__(self, mode: str = "success") -> None:
        self.temporary = tempfile.TemporaryDirectory(prefix="hyperfide-harness-selftest-")
        self.root = Path(self.temporary.name)
        (self.root / "registrations").mkdir()
        (self.root / "probe.py").write_text(PROBE, encoding="utf-8")
        self.registry = {
            "schema_version": 1,
            "cases": {"V-056": {"title": "Controlled bootstrap component", "full_assertion_ids": []}},
            "suites": {"contract": ["V-056"]},
            "registration_glob": "registrations/*.json",
        }
        self.registration = {
            "schema_version": 1, "variant": "task:27.1", "task": "27.1",
            "scope": "task-component", "cases": ["V-056"],
            "assertion_ids": ["bootstrap.alpha", "bootstrap.beta"],
            "argv": [sys.executable, "probe.py", mode], "timeout_seconds": 3,
            "required_env": [], "fixtures": [], "resources": [],
            "source_files": ["probe.py"], "source_roots": ["."],
        }
        self.manifest = {
            "schema_version": 1, "campaign_id": "bootstrap-selftest", "registered_variant": "task:27.1",
            "scope": "task-component", "case_ids": ["V-056"],
            "expected_assertion_ids": ["bootstrap.alpha", "bootstrap.beta"],
            "approval": {"approved": True, "allowed_actions": []},
            "inputs": [], "resources": [], "seed": 1, "policy": {},
        }
        self.pin("probe.py")
        self.output = self.root / "campaign"
        self.save()

    def pin(self, relative: str) -> None:
        path = self.root / relative
        raw = path.read_bytes()
        entry = {"path": relative, "sha256": digest(raw), "size": len(raw)}
        self.manifest["inputs"] = [value for value in self.manifest["inputs"] if value["path"] != relative] + [entry]

    def save(self) -> None:
        write_json(self.root / "registry.json", self.registry)
        write_json(self.root / "registrations" / "27.1.json", self.registration)
        write_json(self.root / "manifest.json", self.manifest)

    def run(self, *selector: str, extra: tuple[str, ...] = (), runner: Path | None = None) -> subprocess.CompletedProcess:
        argv = [sys.executable, str(runner or RUNNER), "--root", str(self.root), "--registry", str(self.root / "registry.json"),
                "--manifest", str(self.root / "manifest.json"), "--output-dir", str(self.output)]
        environment = os.environ.copy()
        environment.pop("HYPERFIDE_SELFTEST_REQUIRED_CREDENTIAL", None)
        environment.pop("PYTHONDONTWRITEBYTECODE", None)
        return subprocess.run(argv + list(selector) + list(extra), capture_output=True, text=True,
                              env=environment, timeout=35)

    def successful(self, *selector: str) -> tuple[Path, dict]:
        result = self.run(*(selector or ("--case", "V-056")))
        if result.returncode != 0:
            raise AssertionError(f"controlled success rejected: {result.stdout[-3000:]} {result.stderr[-3000:]}")
        records = []
        for line in result.stdout.splitlines():
            try:
                record = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(record, dict) and "campaign_dir" in record:
                records.append(record)
        if not records or records[-1].get("status") != "PASS":
            raise AssertionError(f"missing complete PASS result: {result.stdout[-3000:]}")
        summary = records[-1]
        if summary.get("scope") != "task-component" or summary.get("full_case_status") == "PASS":
            raise AssertionError("component success promoted to full-case qualification")
        campaign = Path(summary["campaign_dir"])
        receipt = campaign / "receipts" / (summary["receipt_id"] + ".json")
        if not receipt.is_file():
            raise AssertionError("runner omitted named receipt")
        raw = json.loads(receipt.read_text(encoding="utf-8"))
        if raw.get("qualification_status") != "CANDIDATE":
            raise AssertionError("probe receipt was not explicitly separated from independent qualification")
        checked = self.check(campaign, summary["receipt_id"])
        if checked.returncode:
            raise AssertionError(f"independent checker rejected controlled success: {checked.stdout} {checked.stderr}")
        return campaign, summary

    def check(self, campaign: Path, receipt_id: str | None = None) -> subprocess.CompletedProcess:
        argv = [sys.executable, str(CHECKER), "--campaign", str(campaign)]
        if receipt_id:
            argv += ["--receipt", receipt_id]
        return subprocess.run(argv, capture_output=True, text=True, timeout=20)

    def close(self) -> None:
        self.temporary.cleanup()


class HarnessTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        if not RUNNER.is_file() or not CHECKER.is_file():
            raise AssertionError("bootstrap runner and independent checker must both exist")

    def setUp(self) -> None:
        self.fixtures: list[Fixture] = []

    def tearDown(self) -> None:
        for fixture in self.fixtures:
            fixture.close()

    def fixture(self, mode: str = "success") -> Fixture:
        fixture = Fixture(mode)
        self.fixtures.append(fixture)
        return fixture

    def rejected(self, result: subprocess.CompletedProcess) -> None:
        self.assertNotEqual(result.returncode, 0, f"false success: {result.stdout}\n{result.stderr}")
        for line in result.stdout.splitlines():
            try:
                value = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(value, dict) and "campaign_dir" in value:
                self.assertNotEqual(value.get("status"), "PASS", "failed execution advertised PASS")

    def test_01_missing_selector(self):
        self.rejected(self.fixture().run())

    def test_02_unknown_selector(self):
        self.rejected(self.fixture().run("--case", "V-999"))

    def test_03_empty_selector(self):
        self.rejected(self.fixture().run("--case", ""))

    def test_04_duplicate_selector(self):
        self.rejected(self.fixture().run("--case", "V-056", "--case", "V-056"))

    def test_05_empty_suite(self):
        fixture = self.fixture()
        fixture.registry["suites"]["empty"] = []
        fixture.save()
        self.rejected(fixture.run("--suite", "empty"))

    def test_06_missing_runner(self):
        fixture = self.fixture()
        result = subprocess.run([sys.executable, str(fixture.root / "missing-qualify.py"), "--case", "V-056"],
                                capture_output=True, text=True, timeout=10)
        self.rejected(result)

    def test_07_missing_child(self):
        fixture = self.fixture()
        fixture.registration["argv"][1] = "missing-probe.py"
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_08_missing_checker(self):
        fixture = self.fixture()
        isolated = fixture.root / "isolated-runner"
        isolated.mkdir()
        copied_runner = isolated / "qualify.py"
        copied_runner.write_bytes(RUNNER.read_bytes())
        result = fixture.run("--case", "V-056", runner=copied_runner)
        self.rejected(result)
        self.assertIn("checker", (result.stdout + result.stderr).lower(), "failure did not identify the absent canonical checker")

    def test_09_missing_fixture(self):
        fixture = self.fixture()
        fixture.registration["fixtures"] = ["required.txt"]
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_10_fixture_digest(self):
        fixture = self.fixture()
        path = fixture.root / "required.txt"
        path.write_text("approved input", encoding="utf-8")
        fixture.registration["fixtures"] = ["required.txt"]
        fixture.pin("required.txt")
        fixture.save()
        path.write_text("different unapproved input", encoding="utf-8")
        self.rejected(fixture.run("--case", "V-056"))

    def test_11_missing_credential(self):
        fixture = self.fixture()
        fixture.registration["required_env"] = ["HYPERFIDE_SELFTEST_REQUIRED_CREDENTIAL"]
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_12_failed_child(self):
        self.rejected(self.fixture("failure").run("--case", "V-056"))

    def test_13_timeout_descendants(self):
        fixture = self.fixture("timeout")
        fixture.registration["timeout_seconds"] = 1
        fixture.save()
        try:
            self.rejected(fixture.run("--case", "V-056"))
            pidfile = fixture.root / "descendant.pid"
            self.assertTrue(pidfile.is_file(), "timeout fixture never spawned its descendant")
            child_pid = int(pidfile.read_text(encoding="utf-8"))
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                stat = Path(f"/proc/{child_pid}/stat")
                if not stat.exists() or stat.read_text(encoding="utf-8").split()[2] == "Z":
                    break
                time.sleep(0.05)
            else:
                self.fail("timed-out SIGTERM-resistant descendant remains alive")
        finally:
            pidfile = fixture.root / "descendant.pid"
            if pidfile.is_file():
                try:
                    os.kill(int(pidfile.read_text(encoding="utf-8")), signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def test_14_zero_assertions(self):
        self.rejected(self.fixture("zero").run("--case", "V-056"))

    def test_15_duplicate_assertions(self):
        self.rejected(self.fixture("duplicate").run("--case", "V-056"))

    def test_16_unexecuted_assertions(self):
        self.rejected(self.fixture("partial").run("--case", "V-056"))

    def test_17_failed_assertion(self):
        self.rejected(self.fixture("failed-assertion").run("--case", "V-056"))

    def test_18_malformed_assertion(self):
        self.rejected(self.fixture("malformed").run("--case", "V-056"))

    def test_19_missing_cleanup(self):
        self.rejected(self.fixture("no-cleanup").run("--case", "V-056"))

    def test_20_failed_cleanup(self):
        fixture = self.fixture("no-cleanup")
        (fixture.root / "cleanup.py").write_text('import json,sys\nprint(json.dumps({"type":"cleanup","resources":[],"complete":False}))\nsys.exit(23)\n', encoding="utf-8")
        fixture.registration["cleanup_argv"] = [sys.executable, "cleanup.py"]
        fixture.registration["source_files"].append("cleanup.py")
        fixture.pin("cleanup.py")
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_21_missing_artifact(self):
        fixture = self.fixture()
        campaign, summary = fixture.successful()
        artifact = campaign / "artifacts" / summary["receipt_id"] / "stderr.log"
        self.assertTrue(artifact.is_file())
        artifact.unlink()
        self.rejected(fixture.check(campaign))

    def test_22_tampered_artifact(self):
        fixture = self.fixture()
        campaign, summary = fixture.successful()
        artifact = campaign / "artifacts" / summary["receipt_id"] / "stdout.log"
        artifact.write_bytes(artifact.read_bytes() + b"tampered\n")
        self.rejected(fixture.check(campaign))

    def test_23_tampered_receipt(self):
        fixture = self.fixture()
        campaign, summary = fixture.successful()
        path = campaign / "receipts" / (summary["receipt_id"] + ".json")
        value = json.loads(path.read_text(encoding="utf-8"))
        value["outcome"] = "FAIL"
        write_json(path, value)
        self.rejected(fixture.check(campaign))

    def test_24_scope_forgery(self):
        fixture = self.fixture()
        campaign, summary = fixture.successful()
        path = campaign / "receipts" / (summary["receipt_id"] + ".json")
        value = json.loads(path.read_text(encoding="utf-8"))
        value["scope"] = "full-case"
        seal_receipt(value)
        write_json(path, value)
        self.rejected(fixture.check(campaign))

    def test_25_inventory_forgery(self):
        fixture = self.fixture()
        campaign, summary = fixture.successful()
        path = campaign / "receipts" / (summary["receipt_id"] + ".json")
        value = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(len(value["assertions"]), 2)
        value["assertions"].pop()
        seal_receipt(value)
        write_json(path, value)
        self.rejected(fixture.check(campaign))

    def test_26_snapshot_tampered(self):
        fixture = self.fixture()
        campaign, _ = fixture.successful()
        path = campaign / "registry.json"
        value = json.loads(path.read_text(encoding="utf-8"))
        value["cases"]["V-056"]["title"] = "changed after qualification"
        write_json(path, value)
        self.rejected(fixture.check(campaign))

    def test_27_append_only(self):
        fixture = self.fixture()
        campaign, first = fixture.successful()
        original = {str(path.relative_to(campaign)): path.read_bytes() for group in ("receipts", "checks")
                    for path in (campaign / group).glob("*.json")}
        self.assertTrue(any(name.startswith("checks/") for name in original), "independent check receipt missing")
        _, second = fixture.successful()
        self.assertNotEqual(first["receipt_id"], second["receipt_id"])
        self.assertEqual(len(list((campaign / "receipts").glob("*.json"))), 2)
        for name, raw in original.items():
            self.assertEqual((campaign / name).read_bytes(), raw, "old evidence overwritten by rerun")
        self.assertEqual(fixture.check(campaign).returncode, 0)

    def test_28_changed_input(self):
        fixture = self.fixture()
        campaign, _ = fixture.successful()
        original = {path.name: path.read_bytes() for path in (campaign / "receipts").glob("*.json")}
        fixture.manifest["policy"] = {"changed": True}
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))
        for name, raw in original.items():
            self.assertEqual((campaign / "receipts" / name).read_bytes(), raw)

    def test_29_task_selector(self):
        self.fixture().successful("--task", "27.1")

    def test_30_suite_selector(self):
        self.fixture().successful("--suite", "contract")

    def test_31_failed_then_pass(self):
        fixture = self.fixture("first-fails")
        self.rejected(fixture.run("--case", "V-056"))
        original = {path.name: path.read_bytes() for path in (fixture.output / "receipts").glob("*.json")}
        self.assertEqual(len(original), 1, "failed attempt receipt not retained")
        campaign, _ = fixture.successful()
        self.assertEqual(len(list((campaign / "receipts").glob("*.json"))), 2)
        for name, raw in original.items():
            self.assertEqual((campaign / "receipts" / name).read_bytes(), raw)
        self.assertEqual(fixture.check(campaign).returncode, 0)


    def test_32_canonical_checker(self):
        fixture = self.fixture()
        fake = fixture.root / "fake-checker.py"
        fake.write_text("import sys; sys.exit(0)\n", encoding="utf-8")
        fixture.registration["assertion_ids"].reverse()
        fixture.manifest["expected_assertion_ids"].reverse()
        fixture.save()
        self.rejected(fixture.run("--case", "V-056", extra=("--checker", str(fake))))

    def test_33_normal_exit_descendants(self):
        fixture = self.fixture("normal-exit-descendant")
        try:
            self.rejected(fixture.run("--case", "V-056"))
            pidfile = fixture.root / "descendant.pid"
            self.assertTrue(pidfile.is_file(), "normal-exit fixture never spawned its descendant")
            child_pid = int(pidfile.read_text(encoding="utf-8"))
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                stat = Path(f"/proc/{child_pid}/stat")
                if not stat.exists() or stat.read_text(encoding="utf-8").split()[2] == "Z":
                    break
                time.sleep(0.05)
            else:
                self.fail("successful probe left an executing descendant after runner returned")
        finally:
            pidfile = fixture.root / "descendant.pid"
            if pidfile.is_file():
                try:
                    os.kill(int(pidfile.read_text(encoding="utf-8")), signal.SIGKILL)
                except ProcessLookupError:
                    pass

    def imported_helper(self, declared: bool):
        fixture = self.fixture()
        probe = fixture.root / "probe.py"
        probe.write_text("from helper import VALUE\n" + PROBE.replace('mode != "failed-assertion"', 'VALUE and mode != "failed-assertion"'), encoding="utf-8")
        helper = fixture.root / "helper.py"
        helper.write_text("VALUE = True\n", encoding="utf-8")
        fixture.pin("probe.py")
        if declared:
            fixture.registration["source_files"].append("helper.py")
            fixture.pin("helper.py")
        fixture.save()
        campaign, _ = fixture.successful()
        helper.write_text("VALUE = False\n", encoding="utf-8")
        self.rejected(fixture.check(campaign))

    def test_34_declared_import(self):
        self.imported_helper(declared=True)

    def test_35_undeclared_import_in_root(self):
        self.imported_helper(declared=False)


    def retained_fixture(self, approved: bool = True, omit: str | None = None):
        fixture = self.fixture("no-cleanup")
        resource = fixture.root / "retained-local-resource.bin"
        resource.write_bytes(b"actual disposable local fixture resource")
        resource_record = {"id": "local-fixture-1", "status": "retained", "owner": "selftest", "expiry": "2099-01-01T00:00:00Z"}
        if omit:
            resource_record.pop(omit)
        event = {"type": "cleanup", "complete": True, "resources": [resource_record]}
        cleanup = fixture.root / "cleanup.py"
        cleanup.write_text("from pathlib import Path\nassert Path('retained-local-resource.bin').is_file()\nprint(" + repr(json.dumps(event)) + ")\n", encoding="utf-8")
        fixture.registration["resources"] = [{"id": "local-fixture-1"}]
        fixture.manifest["resources"] = [{"id": "local-fixture-1"}]
        fixture.manifest["approval"]["allow_retained_resources"] = approved
        fixture.registration["cleanup_argv"] = [sys.executable, "cleanup.py"]
        fixture.registration["source_files"].append("cleanup.py")
        fixture.registration["fixtures"].append("retained-local-resource.bin")
        fixture.pin("cleanup.py")
        fixture.pin("retained-local-resource.bin")
        fixture.save()
        return fixture, resource

    def test_36_retention_approved(self):
        fixture, resource = self.retained_fixture()
        fixture.successful()
        self.assertTrue(resource.is_file(), "retained local resource was unexpectedly deleted")
        self.assertEqual(resource.read_bytes(), b"actual disposable local fixture resource")
        resource.unlink()
        self.assertFalse(resource.exists(), "self-test resource cleanup failed")

    def test_37_retention_unapproved(self):
        fixture, _ = self.retained_fixture(approved=False)
        self.rejected(fixture.run("--case", "V-056"))

    def test_38_retention_owner_missing(self):
        fixture, _ = self.retained_fixture(omit="owner")
        self.rejected(fixture.run("--case", "V-056"))

    def test_39_retention_expiry_missing(self):
        fixture, _ = self.retained_fixture(omit="expiry")
        self.rejected(fixture.run("--case", "V-056"))


    def test_40_registry_boolean_version(self):
        fixture = self.fixture()
        fixture.registry["schema_version"] = True
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_41_registration_boolean_version(self):
        fixture = self.fixture()
        fixture.registration["schema_version"] = True
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_42_manifest_boolean_version(self):
        fixture = self.fixture()
        fixture.manifest["schema_version"] = True
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_43_input_boolean_size(self):
        fixture = self.fixture()
        path = fixture.root / "one-byte.txt"
        path.write_bytes(b"x")
        fixture.registration["fixtures"].append("one-byte.txt")
        fixture.pin("one-byte.txt")
        next(item for item in fixture.manifest["inputs"] if item["path"] == "one-byte.txt")["size"] = True
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_44_manifest_unknown_field(self):
        fixture = self.fixture()
        fixture.manifest["silently_ignored_authority"] = True
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))

    def test_45_approval_unknown_field(self):
        fixture = self.fixture()
        fixture.manifest["approval"]["silently_ignored_authority"] = True
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))


    def test_46_output_equals_workspace(self):
        fixture = self.fixture()
        fixture.output = fixture.root
        self.rejected(fixture.run("--case", "V-056"))

    def test_47_output_contains_source(self):
        fixture = self.fixture()
        source_dir = fixture.root / "source"
        source_dir.mkdir()
        (fixture.root / "probe.py").rename(source_dir / "probe.py")
        fixture.registration["argv"][1] = "source/probe.py"
        fixture.registration["source_files"] = ["source/probe.py"]
        fixture.manifest["inputs"] = []
        fixture.pin("source/probe.py")
        fixture.output = source_dir
        fixture.save()
        self.rejected(fixture.run("--case", "V-056"))


    def test_48_detached_pipe_timeout(self):
        fixture = self.fixture("timeout-detached-pipe")
        fixture.registration["timeout_seconds"] = 1
        fixture.save()
        try:
            self.rejected(fixture.run("--case", "V-056"))
            pidfile = fixture.root / "descendant.pid"
            self.assertTrue(pidfile.is_file(), "detached pipe fixture never spawned its descendant")
            child_pid = int(pidfile.read_text(encoding="utf-8"))
            deadline = time.monotonic() + 3
            while time.monotonic() < deadline:
                stat = Path(f"/proc/{child_pid}/stat")
                if not stat.exists() or stat.read_text(encoding="utf-8").split()[2] == "Z":
                    break
                time.sleep(0.05)
            else:
                self.fail("detached-session descendant retaining stdout remained alive after timeout")
        finally:
            pidfile = fixture.root / "descendant.pid"
            if pidfile.is_file():
                try:
                    os.kill(int(pidfile.read_text(encoding="utf-8")), signal.SIGKILL)
                except ProcessLookupError:
                    pass


    def test_49_git_bytecode_parity(self):
        fixture = self.fixture()
        probe = fixture.root / "probe.py"
        probe.write_text("from helper import VALUE\n" + PROBE.replace('mode != "failed-assertion"', 'VALUE and mode != "failed-assertion"'), encoding="utf-8")
        helper = fixture.root / "helper.py"
        helper.write_text("VALUE = True\n", encoding="utf-8")
        fixture.registration["source_files"].append("helper.py")
        fixture.pin("probe.py")
        fixture.pin("helper.py")
        fixture.save()
        for arguments in (["init", "-q"], ["add", "--all"], ["-c", "user.name=Harness fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "controlled source fixture"]):
            completed = subprocess.run(["git", "-c", "maintenance.auto=false", "-c", "gc.auto=0", "-c", "gc.autoDetach=false", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false"] + arguments, cwd=fixture.root, capture_output=True, text=True, timeout=15)
            self.assertEqual(completed.returncode, 0, completed.stderr)
        campaign, _ = fixture.successful()
        self.assertTrue(list((fixture.root / "__pycache__").glob("helper.*.pyc")), "fixture did not exercise generated Git-untracked bytecode")
        helper.write_text("VALUE = False\n", encoding="utf-8")
        self.rejected(fixture.check(campaign))


class InventoryResult(unittest.TextTestResult):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.outcomes: dict[str, bool] = {}

    def addSuccess(self, test):
        super().addSuccess(test)
        self.outcomes[test._testMethodName] = True

    def addFailure(self, test, error):
        super().addFailure(test, error)
        self.outcomes[test._testMethodName] = False

    def addError(self, test, error):
        super().addError(test, error)
        self.outcomes[getattr(test, "_testMethodName", str(test))] = False


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--json", action="store_true", help="emit exact assertion JSONL for the registered task probe")
    args = parser.parse_args()
    suite = unittest.defaultTestLoader.loadTestsFromTestCase(HarnessTests)
    names = [test._testMethodName for test in suite]
    if len(names) != len(ASSERTIONS):
        print("self-test inventory is incomplete", file=sys.stderr)
        return 1
    result = unittest.TextTestRunner(stream=sys.stderr, verbosity=2, resultclass=InventoryResult).run(suite)
    complete = result.testsRun == len(ASSERTIONS) and len(result.outcomes) == len(ASSERTIONS)
    if args.json:
        for name, assertion_id in zip(names, ASSERTIONS):
            print(json.dumps({"type": "assertion", "id": assertion_id,
                              "expected": True, "actual": result.outcomes.get(name, False)}), flush=True)
        print(json.dumps({"type": "cleanup", "resources": [], "complete": complete}), flush=True)
    return 0 if result.wasSuccessful() and complete else 1


if __name__ == "__main__":
    raise SystemExit(main())
