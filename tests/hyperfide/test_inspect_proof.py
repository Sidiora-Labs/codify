"""Real canonical component evidence tests; none constitutes full parity proof."""
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest
import uuid
from selftest_harness import Fixture, HERE

INSPECTOR = HERE / "inspect-proof.py"

def sha(raw):
    return "sha256:" + hashlib.sha256(raw).hexdigest()

def policy():
    value = {key: str(uuid.uuid4()) for key in "organisation_id run_id repository_id import_id source_id archive_manifest_artifact_id".split()}
    value.update({key: sha(key.encode()) for key in "snapshot_digest archive_manifest_digest archive_content_digest corpus_manifest_digest parser_digest configuration_digest query_rubric_digest graph_snapshot_digest prebuilt_manifest_digest".split()})
    return dict(value, schema_version=1, archive_size_bytes="42", implementation_revision="a" * 40)

class ProofInspectionTests(unittest.TestCase):
    def setUp(self):
        self.fixture = Fixture()
        self.fixture.manifest["policy"] = {"cutover_parity": policy()}
        self.fixture.save()
        for argv in (["init", "-q"], ["add", "--all"], ["-c", "user.name=Proof fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "real disposable proof source"]):
            subprocess.run(["git", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false"] + argv, cwd=self.fixture.root, check=True, capture_output=True, timeout=15)
        self.campaign, summary = self.fixture.successful()
        self.receipt_path = self.campaign / "receipts" / (summary["receipt_id"] + ".json")
        self.receipt = json.loads(self.receipt_path.read_bytes())
        self.request = {"schema_version": 1, "request_id": str(uuid.uuid4()), "campaign": "campaign", "receipt_id": summary["receipt_id"], "receipt_digest": sha(self.receipt_path.read_bytes()), "requirements": {"source_revision": self.receipt["source"]["commit"], "case_ids": ["V-056"], "policy": self.fixture.manifest["policy"]}}
        self.staging = None

    def tearDown(self):
        self.fixture.close()
        if self.staging:
            self.staging.cleanup()

    def run_inspector(self, request=None, full=False, root=None, raw=None):
        return subprocess.run([sys.executable, str(INSPECTOR), "--evidence-root", str(root or self.fixture.root)] + (["--require-full"] if full else []), input=raw if raw is not None else json.dumps(request or self.request), text=True, capture_output=True, timeout=25)

    def reject(self, result):
        self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["status"], "REJECTED")
        self.assertIs(value["grants_authority"], False)

    def test_component_inspection_is_not_authority(self):
        result = self.run_inspector()
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        value = json.loads(result.stdout)
        self.assertEqual(value["status"], "CHECKED_COMPONENT")
        self.assertEqual(value["full_case_status"], "INCOMPLETE")
        self.assertIs(value["grants_authority"], False)
        self.assertEqual(value["receipt_digest"], self.request["receipt_digest"])

    def test_component_cannot_satisfy_full(self):
        self.reject(self.run_inspector(full=True))

    def test_exact_anchor_and_source(self):
        for key in ("receipt_digest", "source_revision"):
            request = copy.deepcopy(self.request)
            if key == "receipt_digest":
                request[key] = "sha256:" + "0" * 64
            else:
                request["requirements"][key] = "0" * 40
            self.reject(self.run_inspector(request))

    def test_case_and_closed_policy_binding(self):
        for mutation in ("case", "pin", "extra", "boolean"):
            request = copy.deepcopy(self.request)
            if mutation == "case":
                request["requirements"]["case_ids"] = ["V-020", "V-025"]
            elif mutation == "pin":
                request["requirements"]["policy"]["cutover_parity"]["parser_digest"] = "sha256:" + "0" * 64
            elif mutation == "extra":
                request["requirements"]["policy"]["cutover_parity"]["trusted"] = True
            else:
                request["requirements"]["policy"]["cutover_parity"]["schema_version"] = True
            self.reject(self.run_inspector(request))

    def test_path_escape_and_symlink(self):
        for path in ("../campaign", str(self.campaign)):
            request = copy.deepcopy(self.request)
            request["campaign"] = path
            self.reject(self.run_inspector(request))
        (self.fixture.root / "alias").symlink_to(self.campaign, target_is_directory=True)
        request = copy.deepcopy(self.request)
        request["campaign"] = "alias"
        self.reject(self.run_inspector(request))

    def test_duplicate_and_unknown_request_keys(self):
        self.reject(self.run_inspector(raw='{"schema_version":1,"schema_version":1}'))
        request = dict(self.request, checker_argv=["true"])
        self.reject(self.run_inspector(request))

    def test_real_canonical_artifact_tamper(self):
        path = self.campaign / "artifacts" / self.request["receipt_id"] / "stdout.log"
        path.write_bytes(path.read_bytes() + b"changed after receipt\n")
        self.reject(self.run_inspector())

    def portable(self):
        self.staging = tempfile.TemporaryDirectory(prefix="hyperfide-proof-staging-")
        root = Path(self.staging.name)
        subprocess.run(["git", "clone", "--no-hardlinks", "--quiet", str(self.fixture.root), str(root / "source")], check=True, capture_output=True, timeout=20)
        shutil.copytree(self.campaign, root / "campaign")
        (root / "tools").mkdir()
        mapping = {"schema_version": 1, "workspace": {"original": str(self.fixture.root), "staged": "source"}, "campaign_original": str(self.campaign), "files": [], "executables": [], "checker_original": str(HERE / "check-evidence.py"), "runner_original": str(HERE / "qualify.py")}
        originals = set(record["original_path"] for record in self.receipt["source"]["files"])
        commands = [self.receipt["command"]]
        if self.receipt["cleanup"].get("command"):
            commands.append(self.receipt["cleanup"]["command"])
        for command in commands:
            originals.add(command["executable"]["path"])
            mapping["executables"].append({"original": command["executable"]["path"], "argv0": command["argv"][0]})
        for index, original in enumerate(sorted(originals)):
            path = Path(original)
            if path.is_relative_to(self.fixture.root):
                staged = Path("source") / path.relative_to(self.fixture.root)
            else:
                staged = Path("tools") / (str(index) + "-" + path.name)
                shutil.copyfile(path, root / staged)
            mapping["files"].append({"original": original, "staged": staged.as_posix()})
        (root / "trusted-relocation.json").write_text(json.dumps(mapping))
        # Actual original source is removed. Retained sealed campaign bytes stay intact.
        shutil.rmtree(self.fixture.root)
        return root, mapping

    def test_portable_real_source_and_executable_checks(self):
        root, mapping = self.portable()
        before = (root / "campaign" / "receipts" / (self.request["receipt_id"] + ".json")).read_bytes()
        result = self.run_inspector(root=root)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        self.assertEqual(json.loads(result.stdout)["status"], "CHECKED_COMPONENT")
        self.assertEqual(before, (root / "campaign" / "receipts" / (self.request["receipt_id"] + ".json")).read_bytes())
        self.reject(self.run_inspector(root=root, full=True))

    def test_portable_rejects_missing_map_and_changed_tool(self):
        root, mapping = self.portable()
        executable = next(item for item in mapping["files"] if item["original"] == mapping["executables"][0]["original"])
        tool = root / executable["staged"]
        original_tool = tool.read_bytes()
        tool.write_bytes(original_tool + b"tampered")
        self.reject(self.run_inspector(root=root))
        tool.write_bytes(original_tool)
        mapping["files"] = [item for item in mapping["files"] if item["original"] != str(Path(mapping["workspace"]["original"]) / "probe.py")]
        (root / "trusted-relocation.json").write_text(json.dumps(mapping))
        self.reject(self.run_inspector(root=root))

    def test_portable_rejects_wrong_commit_and_escape(self):
        root, mapping = self.portable()
        subprocess.run(["git", "-c", "user.name=Proof fixture", "-c", "user.email=fixture@example.invalid", "-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "commit", "--allow-empty", "-qm", "different source revision"], cwd=root / "source", check=True, capture_output=True, timeout=15)
        self.reject(self.run_inspector(root=root))
        mapping["files"][0]["staged"] = "../escape"
        (root / "trusted-relocation.json").write_text(json.dumps(mapping))
        self.reject(self.run_inspector(root=root))

    def test_postcheck_bytes_are_rechecked(self):
        spec = importlib.util.spec_from_file_location("proof_inspection", INSPECTOR)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        pins = [(self.receipt_path, self.receipt_path.read_bytes())]
        module.recheck(pins)
        self.receipt_path.write_bytes(pins[0][1] + b" ")
        with self.assertRaises(module.Rejected):
            module.recheck(pins)

if __name__ == "__main__":
    unittest.main()
