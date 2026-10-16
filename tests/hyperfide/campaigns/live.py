#!/usr/bin/env python3
"""Real-provider/frontier campaign driver. No synthetic occupancy or auth fallback.

The pinned command bridges bind to actual signed product APIs. A bridge is not a
new unauthenticated product endpoint; missing auth/bridges explicitly block runs.
"""
from __future__ import annotations
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sys
import time
import uuid
import deterministic as common

STAGES = [(1, 2), (10, 20), (25, 50), (50, 100), (100, 200)]
CONNECTORS = {"codex", "claude_code"}
PROVIDERS = {"railway", "blaxel"}
WORKLOADS = {"graph", "build", "test", "review", "integration"}


def validate_live(manifest):
    common.require(manifest.get("kind") == "live", "live manifest required")
    profile = manifest["profile"]
    common.require(profile.get("duration_hours") in (48, 72) and type(profile.get("duration_hours")) is int, "approved48 or72 wall-clock-hour duration required")
    common.integer(profile.get("sustained_window_seconds"), "sustained concurrency window")
    common.integer(profile.get("poll_seconds"), "observer polling interval")
    common.require(1 <= profile["poll_seconds"] <= 60 and profile["sustained_window_seconds"] >= 2 * profile["poll_seconds"], "declared measurement interval must include multiple observations")
    common.integer(profile.get("ramp_timeout_seconds"), "ramp timeout")
    common.require(profile["ramp_timeout_seconds"] >= profile["poll_seconds"], "ramp timeout shorter than observation interval")
    common.require(manifest.get("stages") == [{"sandboxes": n, "sessions": s} for n, s in STAGES], "approved staged combined-fleet ramp required")
    auth = manifest.get("auth_references")
    common.require(isinstance(auth, dict) and set(auth) == CONNECTORS and all(isinstance(value, str) and value.startswith("secret-ref:") and len(value) > 11 for value in auth.values()), "approved connector secret references required; no credential bytes")
    common.require(isinstance(manifest.get("main_host_id"), str) and manifest["main_host_id"], "supervisory host audit identity required")
    common.require(set(manifest["adapters"]) == {"control", "observer", "cleanup"}, "separate pinned control, independent observer and cleanup bridges required")
    common.require(manifest["adapters"]["control"] != manifest["adapters"]["observer"], "independent observer cannot equal controller command")
    slo = manifest.get("slo")
    common.require(isinstance(slo, dict) and set(slo) == {"maximum_errors", "maximum_queue_latency_ms", "maximum_observation_gap_seconds"}, "freeze exact campaign SLOs before execution")
    for name, value in slo.items():
        common.integer(value, name, 0)
    common.require(slo["maximum_observation_gap_seconds"] >= profile["poll_seconds"], "SLO observation gap contradicts poll interval")
    if profile["duration_hours"] == 72:
        common.require(isinstance(manifest["inputs"].get("prior48"), list) and len(manifest["inputs"]["prior48"]) == 1, "72-hour run requires pinned prior48-hour independent receipt")
    return profile


def inspect_snapshot(snapshot, manifest, previous=None):
    common.require(isinstance(snapshot, dict) and snapshot.get("basis") == "REAL_PROVIDER_AND_NATIVE_OBSERVATION", "actual provider/native observations required")
    common.require(snapshot.get("source_revision") == manifest["source_revision"], "live source revision drift")
    common.require(snapshot.get("source_manifest_digest") == manifest.get("source_manifest_digest") and isinstance(manifest.get("source_manifest_digest"), str), "actual multi-repository source set drift")
    at = common.timestamp(snapshot.get("observed_at"))
    elapsed = common.integer(snapshot.get("monotonic_ns"), "independent observer monotonic time", 0)
    if previous:
        common.require(elapsed > previous["monotonic_ns"] and at >= common.timestamp(previous["observed_at"]), "replayed/regressed observer snapshot")
        common.require((elapsed - previous["monotonic_ns"]) <= manifest["slo"]["maximum_observation_gap_seconds"] * 1000000000, "observer gap exceeds frozen SLO")
    common.require(snapshot.get("inventory_complete") is True, "partial provider inventory cannot establish cleanup or counts")
    sandboxes = snapshot.get("sandboxes")
    sessions = snapshot.get("sessions")
    common.require(isinstance(sandboxes, list) and isinstance(sessions, list), "actual sandbox and native-session inventory required")
    resources = {}
    providers = set()
    for sandbox in sandboxes:
        identity = sandbox.get("id")
        common.require(isinstance(identity, str) and identity and identity not in resources, "duplicate/missing sandbox identity")
        common.require(sandbox.get("provider") in PROVIDERS, "unqualified provider identity")
        common.require(sandbox.get("state") in {"RUNNING", "PREPARING", "STOPPING", "STOPPED", "DESTROYED", "UNKNOWN"}, "unknown sandbox state")
        resources[identity] = sandbox
        if sandbox["state"] == "RUNNING":
            providers.add(sandbox["provider"])
    active, ids, native, connectors, lifetimes = 0, set(), set(), set(), set()
    for session in sessions:
        identity, native_id = session.get("id"), session.get("native_id")
        common.require(isinstance(identity, str) and identity and identity not in ids, "duplicate/missing logical session")
        ids.add(identity)
        common.require(isinstance(native_id, str) and native_id and (session.get("connector"), native_id) not in native, "duplicate/missing native session")
        native.add((session.get("connector"), native_id))
        common.require(session.get("connector") in CONNECTORS and isinstance(session.get("resolved_model"), str) and session["resolved_model"], "actual connector/model identity required")
        common.require(session.get("frontier_profile_qualified") is True and session.get("auth_reference") == manifest["auth_references"][session["connector"]], "unapproved frontier/auth profile")
        common.require(session.get("sandbox_id") in resources, "native session lacks actual sandbox lineage")
        common.require(session.get("state") in {"MODEL_RUNNING", "TOOL_RUNNING", "WAITING", "IDLE", "EXITED", "FAILED"}, "explicit native activity state required")
        lifetime = session.get("lifetime_id")
        common.require(isinstance(lifetime, str) and lifetime, "distinct lifetime identity required; resume is not a new lifetime")
        lifetimes.add(lifetime)
        if session["state"] in {"MODEL_RUNNING", "TOOL_RUNNING"}:
            common.require(resources[session["sandbox_id"]]["state"] == "RUNNING", "active native session on non-running sandbox")
            common.require(session.get("placement") == "REMOTE" and isinstance(session.get("attempt_id"), str) and session["attempt_id"], "active frontier task must be remotely attributed")
            active += 1
            connectors.add(session["connector"])
    audit = snapshot.get("main_host_audit")
    common.require(isinstance(audit, dict) and audit.get("host_id") == manifest["main_host_id"] and audit.get("complete") is True and audit.get("forbidden_processes") == [], "main host exclusion audit failed/incomplete")
    jobs = snapshot.get("jobs")
    common.require(isinstance(jobs, list), "actual job placement evidence required")
    useful = set()
    for job in jobs:
        common.require(job.get("host_id") != manifest["main_host_id"] and job.get("placement") == "REMOTE", "build/test/index/review/integration execution on supervisory main")
        common.require(isinstance(job.get("id"), str) and job["id"] and isinstance(job.get("evidence_digest"), str) and len(job["evidence_digest"]) == 64, "job evidence/identity missing")
        if job.get("qualified_work_observed") is True:
            useful.add(job.get("kind"))
    metrics = snapshot.get("metrics")
    common.require(isinstance(metrics, dict), "actual campaign metrics required")
    for key in ("errors", "queue_latency_ms"):
        common.integer(metrics.get(key), key, 0)
    common.require(metrics["errors"] <= manifest["slo"]["maximum_errors"] and metrics["queue_latency_ms"] <= manifest["slo"]["maximum_queue_latency_ms"], "frozen live SLO exceeded")
    return {"running_sandboxes": sum(row["state"] == "RUNNING" for row in sandboxes), "active_frontier_sessions": active, "providers": providers, "connectors": connectors, "lifetimes": lifetimes, "useful_workloads": useful, "monotonic_ns": elapsed, "observed_at": snapshot["observed_at"]}


def cleanup_result(result, retained, expected_ids=None):
    common.require(result.get("inventory_complete") is True and result.get("unknown_operations") == [], "cleanup incomplete/UNKNOWN debt remains")
    resources = result.get("resources")
    common.require(isinstance(resources, list), "actual cleanup inventory required")
    seen = set()
    for resource in resources:
        identity = resource.get("id")
        common.require(isinstance(identity, str) and identity and identity not in seen, "duplicate/missing cleanup resource")
        seen.add(identity)
        if identity in retained:
            common.require(resource.get("state") == "RETAINED" and resource.get("owner") == retained[identity].get("owner") and resource.get("expires_at") == retained[identity].get("expires_at"), "retained resource owner/expiry differs from approved retention")
            common.require(common.timestamp(resource["expires_at"]) > dt.datetime.now(dt.timezone.utc), "retained resource expiry already elapsed")
        else:
            common.require(resource.get("state") in {"DESTROYED", "ABSENT"} and resource.get("confirmed") is True, "DESTROYING/STOPPED/UNKNOWN is not confirmed cleanup")
    common.require(set(retained) <= seen, "approved retained inventory omitted")
    common.require(set(expected_ids or []) <= seen, "previously observed resource omitted from cleanup evidence")
    return True


def run(path, evidence):
    manifest, root = common.load_manifest(path, "live")
    profile = validate_live(manifest)
    if profile["duration_hours"] == 72:
        _, prior_data = common.pinned_file(manifest["inputs"]["prior48"][0], root)
        prior = common.decode(prior_data)
        common.require(prior.get("evidence_scope") == "LIVE_CAMPAIGN" and prior.get("status") == "PASS" and prior.get("duration_hours") == 48 and prior.get("independent_qualification_receipt"), "prior48-hour independently qualified campaign absent")
    directory = Path(evidence) / (manifest["campaign_id"] + "-" + str(uuid.uuid4()))
    directory.mkdir(parents=True, mode=0o700)
    common.sealed_write(directory / "manifest.json", manifest)
    adapters = {name: common.CommandAdapter(spec, root, directory / name) for name, spec in manifest["adapters"].items()}
    run_id = str(uuid.uuid4())
    result, failure = None, None
    snapshots, lifetimes, useful, resource_ids = [], set(), set(), set()
    started = time.monotonic_ns()
    try:
        # Qualify providers separately before mixed placement, without granting a
        # preview/capability declaration the status of a live canary receipt.
        for provider in sorted(PROVIDERS):
            canary, _ = adapters["control"].call({"operation": "provider_canary", "campaign_id": run_id, "provider": provider, "source_revision": manifest["source_revision"], "source_manifest_digest": manifest["source_manifest_digest"], "auth_references": manifest["auth_references"]})
            common.require(canary.get("provider") == provider and canary.get("live_canary_qualified") is True and isinstance(canary.get("independent_receipt_digest"), str) and len(canary["independent_receipt_digest"]) == 64, "provider canary not independently qualified")
        previous = None
        for sandbox_count, session_count in STAGES:
            adapters["control"].call({"operation": "start_stage", "campaign_id": run_id, "sandboxes": sandbox_count, "sessions": session_count, "source_revision": manifest["source_revision"], "source_manifest_digest": manifest["source_manifest_digest"]})
            stage_start, sustained_start = time.monotonic(), None
            # The final stage runs the approved wall-clock endurance interval.
            duration = profile["duration_hours"] * 3600 if sandbox_count == 100 else profile["sustained_window_seconds"]
            while True:
                observation, receipt = adapters["observer"].call({"operation": "observe", "campaign_id": run_id, "source_revision": manifest["source_revision"], "source_manifest_digest": manifest["source_manifest_digest"]})
                snapshot = observation.get("snapshot")
                if isinstance(snapshot, dict) and isinstance(snapshot.get("sandboxes"), list):
                    resource_ids.update(row.get("id") for row in snapshot["sandboxes"])
                state = inspect_snapshot(snapshot, manifest, previous)
                previous = snapshot
                snapshots.append({"operation_id": receipt["operation_id"], "snapshot_sha256": common.digest(common.canonical(snapshot)), "observed_at": state["observed_at"], "active": state["active_frontier_sessions"], "running": state["running_sandboxes"]})
                lifetimes |= state["lifetimes"]
                useful |= state["useful_workloads"]
                meets = state["running_sandboxes"] >= sandbox_count and state["active_frontier_sessions"] >= session_count and state["connectors"] == CONNECTORS
                if sandbox_count == 100:
                    meets = meets and state["providers"] == PROVIDERS
                common.require(state["running_sandboxes"] <= manifest["profile"]["sandboxes"] and state["active_frontier_sessions"] <= manifest["profile"]["slots"], "actual resource/session allocation exceeds approved profile")
                if meets:
                    sustained_start = sustained_start or time.monotonic()
                    if time.monotonic() - sustained_start >= duration:
                        break
                else:
                    # Deficits are visible failures after ramp; they cannot be
                    # hidden inside averaged concurrency or a reset soak timer.
                    common.require(sustained_start is None, "sustained frontier concurrency dropped below declared target")
                    common.require(time.monotonic() - stage_start <= profile["ramp_timeout_seconds"], "stage ramp failed to reach actual concurrency")
                time.sleep(profile["poll_seconds"])
        common.require(WORKLOADS <= useful, "live useful graph/build/test/review/integration workload evidence missing")
        common.require(profile["duration_hours"] != 72 or len(lifetimes) >= 1500, "72-hour campaign did not observe1500 distinct session lifetimes")
        result = {"schema_version": 1, "status": "PASS", "evidence_scope": "LIVE_CAMPAIGN", "duration_hours": profile["duration_hours"], "observed_lifetimes": len(lifetimes), "actual_wall_clock_ns": time.monotonic_ns() - started, "snapshots": snapshots, "useful_workloads": sorted(useful)}
    except BaseException as exc:
        failure = exc
    finally:
        # Cleanup is scoped to this campaign. It cannot delete unrelated workers.
        try:
            adapters["cleanup"].call({"operation": "cleanup", "campaign_id": run_id})
            cleanup, _ = adapters["observer"].call({"operation": "observe_cleanup", "campaign_id": run_id})
            retained = manifest.get("retained_resources", {})
            common.require(isinstance(retained, dict), "explicit retained resource inventory required")
            cleanup_result(cleanup, retained, resource_ids)
        except BaseException as exc:
            result = None
            failure = common.CampaignError("cleanup debt: " + str(exc) + ("; original: " + str(failure) if failure else ""))
    if failure:
        common.sealed_write(directory / "failure.json", {"status": "BLOCKED" if isinstance(failure, common.Blocked) else "FAIL", "error": str(failure), "snapshots": snapshots, "live_frontier_qualified": False})
        raise failure
    return common.sealed_write(directory / "result.json", result)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--evidence", required=True)
    parser.add_argument("--execute", action="store_true", help="explicitly execute the approved expensive live campaign")
    args = parser.parse_args()
    try:
        if not args.execute:
            raise common.Blocked("live execution requires --execute and an approved pinned manifest")
        print(json.dumps(run(args.manifest, args.evidence)))
        return 0
    except (common.CampaignError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({"status": "BLOCKED" if isinstance(exc, common.Blocked) else "FAIL", "error": str(exc), "live_frontier_qualified": False}), file=sys.stderr)
        return 2 if isinstance(exc, common.Blocked) else 1

if __name__ == "__main__":
    raise SystemExit(main())
