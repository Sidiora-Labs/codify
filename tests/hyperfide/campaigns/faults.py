#!/usr/bin/env python3
"""Composite fault campaign, with independent post-fault invariant reconstruction.

Destructive drills require approved pinned bridges and a deployment-specific
manifest. Component tests cannot authorise or qualify a live recovery campaign.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import sys
import subprocess
import time
import uuid
import deterministic as common
from live import cleanup_result

FAULTS = {"controller_loss", "database_failover", "sandbox_loss", "stale_worker", "unknown_create", "credential_expiry", "artifact_incomplete", "git_ack_lost", "stale_publisher", "restore_epoch"}


def validate_faults(manifest):
    common.require(manifest.get("kind") == "faults", "fault manifest required")
    faults = manifest.get("faults")
    common.require(isinstance(faults, list) and faults, "explicit fault schedule required")
    seen, intervals = set(), []
    for fault in faults:
        common.require(isinstance(fault, dict) and set(fault) == {"id", "kind", "at_ms", "duration_ms"}, "exact fault schedule fields required")
        common.require(isinstance(fault["id"], str) and fault["id"] and fault["id"] not in seen, "unique fault identity required")
        seen.add(fault["id"])
        common.require(fault["kind"] in FAULTS, "unrecognised fault kind")
        common.integer(fault["at_ms"], "fault time", 0)
        common.integer(fault["duration_ms"], "fault duration")
        intervals.append((fault["at_ms"], fault["at_ms"] + fault["duration_ms"]))
    common.require({fault["kind"] for fault in faults} == FAULTS, "declared composite fault coverage incomplete")
    common.require(any(max(a, c) < min(b, d) for i, (a, b) in enumerate(intervals) for c, d in intervals[i + 1:]), "composite schedule has no overlapping faults")
    common.require(set(manifest["adapters"]) == {"control", "observer", "cleanup"}, "actual control/independent observer/cleanup adapters required")
    common.require(manifest["adapters"]["control"] != manifest["adapters"]["observer"], "independent reconstruction cannot use the mutating controller")
    slo = manifest.get("slo")
    common.require(isinstance(slo, dict) and set(slo) == {"rpo_ms", "rto_ms"}, "freeze recovery objectives before drilling")
    common.integer(slo["rpo_ms"], "RPO", 0)
    common.integer(slo["rto_ms"], "RTO", 0)
    return faults


def inspect_reconstruction(observation, manifest, root, evidence=None):
    common.require(isinstance(observation, dict) and observation.get("basis") == "INDEPENDENT_DURABLE_RECONSTRUCTION", "independent durable evidence required")
    common.require(observation.get("source_revision") == manifest["source_revision"], "fault source revision drift")
    common.require(observation.get("source_manifest_digest") == manifest.get("source_manifest_digest") and isinstance(manifest.get("source_manifest_digest"), str), "actual multi-repository source set drift")
    state = common.reconstruct(observation.get("events"), manifest["profile"])
    common.require(state == observation.get("final_state"), "durable observations disagree with reference reconstruction")
    common.require(observation.get("protected_refs") == state["publications"], "actual Git refs differ from authorised qualified publication history")
    common.require(observation.get("resource_inventory_complete") is True and sorted(observation.get("resource_ids", [])) == state["resources"], "actual provider inventory differs from reconstructed resource ledger")
    common.require(observation.get("unknown_operations") == [], "unreconciled operations remain")
    common.require(observation.get("unacknowledged_effects") == [] and observation.get("hidden_backlog") == [], "hidden backlog/unacknowledged durable effects remain")
    debts = observation.get("resource_debts")
    common.require(isinstance(debts, list) and not debts, "resource debts cannot be reported as clean cleanup")
    anchors = manifest["inputs"].get("accepted_receipts")
    common.require(isinstance(anchors, list) and anchors, "externally approved receipt anchors absent")
    trusted = {pin["sha256"] for pin in anchors}
    receipts = observation.get("receipts")
    common.require(isinstance(receipts, list) and receipts, "retrievable independent evidence receipts required")
    seen = set()
    for receipt in receipts:
        common.require(isinstance(receipt, dict) and set(receipt) == {"pin", "trusted_anchor_sha256", "verified_by"}, "pinned independently verified receipt required")
        receipt_path, content = common.pinned_file(receipt["pin"], root)
        common.require(receipt["pin"]["sha256"] not in seen, "duplicate qualification receipt")
        seen.add(receipt["pin"]["sha256"])
        common.require(receipt["trusted_anchor_sha256"] in trusted and receipt["trusted_anchor_sha256"] == common.digest(content), "receipt differs from external trusted anchor")
        common.require(receipt["verified_by"] == "independent-checker", "worker cannot self-qualify recovery evidence")
        common.require(receipt_path.parent.name == "receipts", "canonical campaign receipt path required")
        checker = Path(__file__).resolve().parents[1] / "check-evidence.py"
        command = [sys.executable, str(checker), "--campaign", str(receipt_path.parent.parent), "--receipt", receipt_path.stem]
        checked = subprocess.run(command, capture_output=True, timeout=60)
        if evidence is not None:
            common.sealed_write(Path(evidence) / (receipt["pin"]["sha256"] + ".json"),
                {"argv": command, "checker_sha256": common.digest(checker.read_bytes()),
                 "exit_code": checked.returncode, "stdout_sha256": common.digest(checked.stdout),
                 "stderr_sha256": common.digest(checked.stderr)})
        common.require(checked.returncode == 0, "canonical independent checker rejected anchored receipt")

    reports = observation.get("fault_reports")
    common.require(isinstance(reports, list), "actual fault/recovery receipts required")
    expected = {fault["id"]: fault for fault in manifest["faults"]}
    found = set()
    for report in reports:
        identity = report.get("fault_id")
        common.require(identity in expected and identity not in found, "unexpected/duplicate fault report")
        found.add(identity)
        common.require(report.get("kind") == expected[identity]["kind"] and report.get("injection_observed") is True and report.get("recovery_observed") is True, "fault schedule not actually exercised/recovered")
        common.require(report.get("basis") == "INDEPENDENT_OBSERVATION", "fault controller declaration is insufficient")
        common.integer(report.get("rpo_ms"), "observed RPO", 0)
        common.integer(report.get("rto_ms"), "observed RTO", 0)
        common.require(report["rpo_ms"] <= manifest["slo"]["rpo_ms"] and report["rto_ms"] <= manifest["slo"]["rto_ms"], "frozen recovery objective exceeded")
    common.require(found == set(expected), "missing fault observations")
    common.require(observation.get("conflicting_accepted_owners") == 0 and type(observation.get("conflicting_accepted_owners")) is int, "conflicting accepted owners")
    common.require(observation.get("unqualified_publications") == 0 and type(observation.get("unqualified_publications")) is int, "unqualified protected publication")
    return state


def run(path, evidence):
    manifest, root = common.load_manifest(path, "faults")
    validate_faults(manifest)
    directory = Path(evidence) / (manifest["campaign_id"] + "-" + str(uuid.uuid4()))
    directory.mkdir(parents=True, mode=0o700)
    common.sealed_write(directory / "manifest.json", manifest)
    adapters = {name: common.CommandAdapter(spec, root, directory / name) for name, spec in manifest["adapters"].items()}
    run_id = str(uuid.uuid4())
    state, failure = None, None
    started = time.monotonic_ns()
    try:
        # The bridge binds these campaign operations to real recovery.stop.*,
        # recovery.drill.* and signed service calls from their actual owners.
        # Fault IDs are durable idempotency keys, not permission to blind-retry.
        adapters["control"].call({"operation": "execute_composite_schedule", "campaign_id": run_id, "source_revision": manifest["source_revision"], "source_manifest_digest": manifest["source_manifest_digest"], "profile": manifest["profile"], "faults": manifest["faults"], "inputs": manifest["inputs"], "slo": manifest["slo"]})
        observed, _ = adapters["observer"].call({"operation": "reconstruct", "campaign_id": run_id, "source_revision": manifest["source_revision"], "source_manifest_digest": manifest["source_manifest_digest"]})
        state = inspect_reconstruction(observed.get("observation"), manifest, root, directory / "receipt-checks")
        common.require(state["peak_slots"] >= manifest["profile"]["slots"], "declared simultaneous mixed load not observed during faults")
        common.require(set(state["faults"]) >= FAULTS, "fault injection missing from independent durable event trace")
    except BaseException as exc:
        failure = exc
    finally:
        try:
            adapters["cleanup"].call({"operation": "cleanup", "campaign_id": run_id})
            cleanup, _ = adapters["observer"].call({"operation": "observe_cleanup", "campaign_id": run_id})
            cleanup_result(cleanup, manifest.get("retained_resources", {}))
        except BaseException as exc:
            failure = common.CampaignError("cleanup debt: " + str(exc) + ("; original: " + str(failure) if failure else ""))
    if failure:
        common.sealed_write(directory / "failure.json", {"status": "BLOCKED" if isinstance(failure, common.Blocked) else "FAIL", "error": str(failure), "full_case_qualified": False})
        raise failure
    return common.sealed_write(directory / "result.json", {"schema_version": 1, "status": "PASS", "evidence_scope": "COMPOSITE_FAULT_CAMPAIGN", "state": state, "wall_clock_ns": time.monotonic_ns() - started, "independent_reconstruction": True})


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--execute", action="store_true")
    args = parser.parse_args()
    try:
        if not args.execute:
            raise common.Blocked("destructive fault campaign requires --execute and approved pinned inputs")
        print(json.dumps(run(args.manifest, args.evidence)))
        return 0
    except (common.CampaignError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "BLOCKED" if isinstance(exc, common.Blocked) else "FAIL", "error": str(exc), "full_case_qualified": False}), file=sys.stderr)
        return 2 if isinstance(exc, common.Blocked) else 1

if __name__ == "__main__":
    raise SystemExit(main())
