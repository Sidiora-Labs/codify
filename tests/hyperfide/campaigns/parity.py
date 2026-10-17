#!/usr/bin/env python3
"""Full-case legacy/candidate parity campaigns for V-020 (search) and V-025 (import).

Every registered assertion is evaluated from actual pinned bridge observations or
from harness-observed input/cleanup state. Without an approved parity manifest,
pinned corpora and both bridges the case is BLOCKED; nothing is simulated.
"""
from __future__ import annotations
import json
import os
from pathlib import Path
import subprocess
import sys
import uuid
import deterministic as common

ROOT = Path(__file__).resolve().parents[3]
REGISTRY = ROOT / "tests/hyperfide/registry.json"

# harness: computed by this driver from pins, bridge identities and cleanup reports.
# parity: legacy and candidate observations must be identical or an exactly approved difference.
# candidate: candidate-only behavioural invariant ({"holds": true, "evidence": [...]}).
CHECKS = {
    "V-020": {
        "source-revision": "harness", "configuration": "harness", "legacy-toolchain": "harness",
        "approved-corpus-complete": "harness", "symbol-semantics": "parity", "reference-semantics": "parity",
        "caller-semantics": "parity", "contract-findings": "parity", "word-body-fts": "parity",
        "comment-fts": "parity", "identifier-trigram": "parity", "body-trigram": "parity",
        "identifier-segmentation": "parity", "unicode-tokenisation": "parity", "case-and-punctuation": "parity",
        "phrase-and-boolean-syntax": "parity", "path-glob-language-filters": "parity", "rank-order": "parity",
        "explicit-rank-ties": "parity", "branch-isolation": "parity", "folded-branch-projection": "parity",
        "missing-source-diagnostics": "parity", "contentless-body-readback": "candidate", "stable-pagination": "parity",
        "output-and-time-budgets": "candidate", "approved-differences-only": "harness",
        "complete-source-provenance": "harness", "original-inputs-unchanged": "harness", "complete-cleanup": "harness",
        "coverage-and-freshness": "candidate", "exact-name-precedence": "parity",
        "negative-empty-escaped-parameterisation": "candidate", "structured-timeout-and-truncation": "candidate",
        "explain-plan-and-round-trips": "candidate",
    },
    "V-025": {
        "accepted-import-snapshot-binding": "harness", "actual-schema-capabilities": "candidate",
        "typed-row-preservation": "parity", "deterministic-identity-relationships": "parity",
        "actual-import-readback": "parity", "graph-schema-upgrade": "candidate", "search-semantics-preserved": "parity",
        "unicode-trigram-edge-matrix": "parity", "incomplete-snapshot-refusal": "candidate",
        "durable-boundary-interruptions": "candidate", "idempotent-resume": "candidate",
        "specified-recovery-strategy": "candidate", "source-provenance-preserved": "parity",
        "unsupported-legacy-diagnostics": "candidate", "original-archive-retained": "harness",
        "historical-state-not-live-authority": "candidate", "no-partial-graph-publication": "candidate",
        "approved-differences-only": "harness", "complete-cleanup": "harness", "wal-consistent-capture": "candidate",
        "complete-table-column-class-inventory": "parity", "forward-version-client-refusal": "candidate",
        "unresolved-reference-diagnostics": "parity",
    },
}
REQUIRED_INPUTS = {"V-020": ("corpus", "configuration", "legacy_toolchain"), "V-025": ("snapshot", "configuration", "legacy_toolchain")}
OPTIONAL_INPUTS = ("golden",)

def prefix(case):
    return "parity." + case.lower().replace("-", "") + "."

def assertion_ids(case):
    return [prefix(case) + name for name in CHECKS[case]]

def registered_ids(case, registry=REGISTRY):
    return common.decode(Path(registry).read_bytes())["cases"][case]["full_assertion_ids"]

def manifest_env(case):
    return "HYPERFIDE_PARITY_" + case.replace("-", "") + "_MANIFEST"

def load_manifest(path, case, approved_sha256):
    """The approved parity manifest is bound by digest in the immutable qualification manifest."""
    path = Path(path).resolve()
    common.require(path.is_file() and not path.is_symlink(), "approved parity manifest absent")
    data = path.read_bytes()
    if not isinstance(approved_sha256, str) or common.digest(data) != approved_sha256:
        raise common.Blocked("parity manifest is not the approved digest bound by the full-case manifest")
    manifest = common.decode(data)
    fields = {"schema_version", "case", "campaign_id", "source_revision", "legacy_revision", "approval", "inputs", "adapters", "approved_differences"}
    common.require(isinstance(manifest, dict) and set(manifest) == fields and manifest["schema_version"] == 1, "exact parity manifest fields required")
    common.require(manifest["case"] == case and manifest["approval"] == {"approved": True, "kind": "parity", "case": case}, "case-specific parity approval absent")
    common.require(isinstance(manifest["source_revision"], str) and len(manifest["source_revision"]) == 40 and all(c in "0123456789abcdef" for c in manifest["source_revision"]), "exact candidate revision required")
    common.require(isinstance(manifest["legacy_revision"], str) and manifest["legacy_revision"], "exact legacy revision required")
    inputs = manifest["inputs"]
    common.require(isinstance(inputs, dict) and set(REQUIRED_INPUTS[case]) <= set(inputs) and set(inputs) <= set(REQUIRED_INPUTS[case]) | set(OPTIONAL_INPUTS), "approved pinned corpus/snapshot, configuration and legacy toolchain required")
    for name, pins in inputs.items():
        common.require(isinstance(pins, list) and pins, "empty approved input: " + name)
        for pin in pins:
            common.pinned_file(pin, path.parent)
    if set(manifest["adapters"]) != {"legacy", "candidate"}:
        raise common.Blocked("actual legacy and candidate parity bridges required")
    differences = manifest["approved_differences"]
    common.require(isinstance(differences, list), "approved difference list required")
    keys = set()
    for row in differences:
        common.require(isinstance(row, dict) and set(row) == {"assertion_id", "legacy_sha256", "candidate_sha256", "reason", "approved_by"}, "exact approved difference binding required")
        common.require(row["assertion_id"] in assertion_ids(case) and CHECKS[case][row["assertion_id"][len(prefix(case)):]] == "parity", "approved difference must name a parity assertion")
        common.require(all(isinstance(row[key], str) and row[key] for key in ("reason", "approved_by")), "approved difference reason/approver required")
        common.require(row["assertion_id"] not in keys, "duplicate approved difference")
        keys.add(row["assertion_id"])
    return manifest, path.parent

def input_digests(manifest):
    return {name: [pin["sha256"] for pin in pins] for name, pins in sorted(manifest["inputs"].items()) if name != "golden"}

def outcome(passed, **detail):
    return {"status": "PASS" if passed else "FAIL", **detail}

def run_case(case, manifest_path, evidence, approved_sha256):
    manifest, root = load_manifest(manifest_path, case, approved_sha256)
    adapters = {name: common.CommandAdapter(spec, root, Path(evidence) / name) for name, spec in sorted(manifest["adapters"].items())}
    golden = {}
    for pin in manifest["inputs"].get("golden", []):
        _, data = common.pinned_file(pin, root)
        table = common.decode(data)
        common.require(isinstance(table, dict) and set(table) <= set(assertion_ids(case)), "golden outputs must name registered assertions")
        golden.update(table)
    expected_inputs = input_digests(manifest)
    corpus_digests = {sha for pins in expected_inputs.values() for sha in pins}
    calls, observed, results = [], {}, {}
    def call(side, check):
        request = {"schema_version": 1, "case": case, "check": check, "side": side, "inputs": manifest["inputs"], "campaign_id": manifest["campaign_id"]}
        if side == "candidate":
            # CommandAdapter independently verifies the candidate checkout HEAD.
            request["source_revision"] = manifest["source_revision"]
        else:
            request["legacy_revision"] = manifest["legacy_revision"]
        result, receipt = adapters[side].call(request)
        calls.append((side, check, result, receipt))
        return result
    for name, kind in CHECKS[case].items():
        identity = prefix(case) + name
        if kind == "parity":
            observed[identity] = {side: call(side, name) for side in ("legacy", "candidate")}
        elif kind == "candidate":
            observed[identity] = {"candidate": call("candidate", name)}
    used_differences, unapproved = set(), []
    approvals = {row["assertion_id"]: row for row in manifest["approved_differences"]}
    for identity, sides in observed.items():
        kind = CHECKS[case][identity[len(prefix(case)):]]
        candidate = sides["candidate"].get("observation")
        candidate_sha = common.digest(common.canonical(candidate))
        golden_ok = identity not in golden or golden[identity] == candidate_sha
        if kind == "parity":
            legacy_sha = common.digest(common.canonical(sides["legacy"].get("observation")))
            same = legacy_sha == candidate_sha
            approval = approvals.get(identity)
            approved = not same and approval is not None and (approval["legacy_sha256"], approval["candidate_sha256"]) == (legacy_sha, candidate_sha)
            if approved:
                used_differences.add(identity)
            elif not same:
                unapproved.append(identity)
            nonempty = sides["legacy"].get("observation") not in (None, {}, []) and candidate not in (None, {}, [])
            results[identity] = outcome((same or approved) and nonempty and golden_ok, legacy_sha256=legacy_sha, candidate_sha256=candidate_sha, approved_difference=approved, golden_checked=identity in golden)
        else:
            holds = isinstance(candidate, dict) and candidate.get("holds") is True and isinstance(candidate.get("evidence"), list) and bool(candidate["evidence"])
            results[identity] = outcome(holds and golden_ok, candidate_sha256=candidate_sha, golden_checked=identity in golden)
    def harness(name, passed, **detail):
        results[prefix(case) + name] = outcome(passed, **detail)
    by_side = {side: [result for row_side, _, result, _ in calls if row_side == side] for side in ("legacy", "candidate")}
    if case == "V-020":
        harness("source-revision", all(row.get("source_revision") == manifest["source_revision"] for row in by_side["candidate"]) and all(row.get("source_revision") == manifest["legacy_revision"] for row in by_side["legacy"]))
        harness("configuration", all(row.get("input_digests", {}).get("configuration") == expected_inputs["configuration"] for row in by_side["legacy"] + by_side["candidate"]))
        harness("legacy-toolchain", all(row.get("toolchain_sha256") in expected_inputs["legacy_toolchain"] for row in by_side["legacy"]) and bool(by_side["legacy"]))
        harness("approved-corpus-complete", all(row.get("input_digests") == expected_inputs for row in by_side["legacy"] + by_side["candidate"]))
        harness("complete-source-provenance", all(isinstance(row.get("provenance"), list) and row["provenance"] and set(row["provenance"]) <= corpus_digests for row in by_side["legacy"] + by_side["candidate"]))
    else:
        harness("accepted-import-snapshot-binding", all(row.get("source_revision") == manifest["source_revision"] and row.get("input_digests", {}).get("snapshot") == expected_inputs["snapshot"] for row in by_side["candidate"]))
    harness("approved-differences-only", not unapproved and used_differences == set(approvals), unapproved=sorted(unapproved), unused_approvals=sorted(set(approvals) - used_differences))
    unchanged = True
    for pins in manifest["inputs"].values():
        for pin in pins:
            try:
                common.pinned_file(pin, root)
            except common.CampaignError:
                unchanged = False
    harness("original-archive-retained" if case == "V-025" else "original-inputs-unchanged", unchanged)
    harness("complete-cleanup", all(row.get("cleanup") == {"complete": True, "remaining": []} for row in by_side["legacy"] + by_side["candidate"]) and all(receipt["owned_process_cleanup"]["complete"] for _, _, _, receipt in calls))
    common.require(set(results) == set(assertion_ids(case)), "parity driver did not evaluate the exact inventory")
    return results

def campaign_policy():
    directory = os.environ.get("HYPERFIDE_CAMPAIGN_DIR")
    if not directory or not (Path(directory) / "manifest.json").is_file():
        raise common.Blocked("immutable qualification manifest snapshot absent")
    policy = common.decode((Path(directory) / "manifest.json").read_bytes()).get("policy", {})
    return policy, Path(directory)

def main_case(case):
    ids = assertion_ids(case)
    status = 0
    try:
        common.require(ids == registered_ids(case), "parity driver inventory differs from registry")
        policy, directory = campaign_policy()
        path = os.environ.get(manifest_env(case))
        if not path:
            raise common.Blocked(manifest_env(case) + " absent: approved parity manifest required")
        evidence = directory / "parity" / (case + "-" + str(uuid.uuid4()))
        results = run_case(case, path, evidence, policy.get("approved_parity_manifest_sha256"))
        status = 0 if all(row["status"] == "PASS" for row in results.values()) else 1
    except common.Blocked as exc:
        results, status = {identity: {"status": "BLOCKED", "reason": str(exc)} for identity in ids}, 2
    except (common.CampaignError, OSError, KeyError, TypeError, subprocess.SubprocessError) as exc:
        results, status = {identity: {"status": "FAIL", "reason": type(exc).__name__ + ": " + str(exc)} for identity in ids}, 1
    for identity in ids:
        print(json.dumps({"type": "assertion", "id": identity, "expected": {"status": "PASS"}, "actual": results[identity]}, sort_keys=True))
    # Bridges own and report their resources; the driver itself creates none.
    print(json.dumps({"type": "cleanup", "resources": [], "complete": True}))
    return status

if __name__ == "__main__":
    raise SystemExit(main_case(sys.argv[1] if len(sys.argv) > 1 else ""))
