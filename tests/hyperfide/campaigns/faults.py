#!/usr/bin/env python3
"""Composite fault campaigns with observed timing and full independent receipts.

Driver components do not qualify a full recovery case. Real campaigns require
approved exact inputs, signed product bridges and externally anchored full proof.
"""
from __future__ import annotations
import argparse
import json
from pathlib import Path
import subprocess
import sys
import time
import uuid
import deterministic as common
from live import cleanup_result

FAULTS = {"controller_loss", "database_failover", "sandbox_loss", "stale_worker", "unknown_create", "credential_expiry", "artifact_incomplete", "git_ack_lost", "stale_publisher", "restore_epoch"}
RECOVERY_CASES = {"V-002", "V-003", "V-004", "V-005", "V-009", "V-010", "V-012", "V-015", "V-016", "V-017", "V-033", "V-037", "V-040", "V-049", "V-053", "V-054"}

def required_pairs(manifest):
    pairs = manifest['profile'].get('required_composite_pairs')
    common.require(isinstance(pairs, list) and pairs, 'approved composite fault pairs required')
    result = set()
    for pair in pairs:
        common.require(isinstance(pair, list) and len(pair) == 2 and all(kind in FAULTS for kind in pair) and pair[0] != pair[1], 'invalid required composite pair')
        key = tuple(sorted(pair))
        common.require(key not in result, 'duplicate required composite pair')
        result.add(key)
    common.require({kind for pair in result for kind in pair} == FAULTS, 'all declared fault classes must participate in approved composites')
    return result

def overlapping_pairs(intervals):
    pairs = set()
    for index, (kind, start, end) in enumerate(intervals):
        for other, other_start, other_end in intervals[index + 1:]:
            if kind != other and max(start, other_start) < min(end, other_end):
                pairs.add(tuple(sorted((kind, other))))
    return pairs

def validate_faults(manifest):
    common.require(manifest.get('kind') == 'faults', 'fault manifest required')
    faults = manifest.get('faults')
    common.require(isinstance(faults, list) and faults, 'explicit fault schedule required')
    seen, intervals = set(), []
    for fault in faults:
        common.require(isinstance(fault, dict) and set(fault) == {'id', 'kind', 'at_ms', 'duration_ms'}, 'exact fault schedule fields required')
        common.require(isinstance(fault['id'], str) and fault['id'] and fault['id'] not in seen, 'unique fault identity required')
        seen.add(fault['id'])
        common.require(fault['kind'] in FAULTS, 'unrecognised fault kind')
        common.integer(fault['at_ms'], 'fault time', 0)
        common.integer(fault['duration_ms'], 'fault duration')
        intervals.append((fault['kind'], fault['at_ms'], fault['at_ms'] + fault['duration_ms']))
    common.require({fault['kind'] for fault in faults} == FAULTS, 'declared composite fault coverage incomplete')
    common.require(required_pairs(manifest) <= overlapping_pairs(intervals), 'declared schedule does not overlap every required composite pair')
    common.require(set(manifest['adapters']) == {'control', 'observer', 'cleanup'}, 'actual control/independent observer/cleanup adapters required')
    common.require(manifest['adapters']['control'] != manifest['adapters']['observer'], 'independent reconstruction cannot use mutating controller')
    slo = manifest.get('slo')
    common.require(isinstance(slo, dict) and set(slo) == {'rpo_ms', 'rto_ms', 'schedule_tolerance_ms'}, 'freeze recovery objectives and schedule tolerance before drilling')
    for key in slo:
        common.integer(slo[key], key, 0)
    common.require(all(slo['schedule_tolerance_ms'] * 2 < fault['duration_ms'] for fault in faults), 'schedule tolerance cannot erase fault duration')
    return faults

def inspect_state(observation, manifest):
    common.require(isinstance(observation, dict) and observation.get('basis') == 'INDEPENDENT_DURABLE_RECONSTRUCTION', 'independent durable evidence required')
    common.require(observation.get('source_revision') == manifest['source_revision'], 'fault source revision drift')
    common.require(observation.get('source_manifest_digest') == manifest.get('source_manifest_digest') and isinstance(manifest.get('source_manifest_digest'), str), 'actual multi-repository source set drift')
    state = common.reconstruct(observation.get('events'), manifest['profile'])
    common.require(state == observation.get('final_state'), 'durable observations disagree with reference reconstruction')
    common.require(observation.get('protected_refs') == state['publications'], 'actual Git refs differ from qualified publication history')
    common.require(observation.get('resource_inventory_complete') is True and sorted(observation.get('resource_ids', [])) == state['resources'], 'actual provider inventory differs from resource ledger')
    common.require(observation.get('unknown_operations') == [], 'unreconciled operations remain')
    common.require(observation.get('unacknowledged_effects') == [] and observation.get('hidden_backlog') == [], 'hidden backlog/unacknowledged effects remain')
    common.require(observation.get('resource_debts') == [], 'resource debts cannot be reported as clean cleanup')
    common.require(type(observation.get('conflicting_accepted_owners')) is int and observation['conflicting_accepted_owners'] == 0, 'conflicting accepted owners')
    common.require(type(observation.get('unqualified_publications')) is int and observation['unqualified_publications'] == 0, 'unqualified protected publication')
    return state

def inspect_fault_reports(observation, manifest):
    reports = observation.get('fault_reports')
    common.require(isinstance(reports, list), 'actual fault/recovery receipts required')
    origin = common.integer(observation.get('campaign_start_monotonic_ns'), 'independent campaign monotonic origin', 0)
    expected = {fault['id']: fault for fault in manifest['faults']}
    tolerance = manifest['slo']['schedule_tolerance_ms'] * 1000000
    found, intervals = set(), []
    for report in reports:
        identity = report.get('fault_id')
        common.require(identity in expected and identity not in found, 'unexpected/duplicate fault report')
        found.add(identity)
        fault = expected[identity]
        common.require(report.get('kind') == fault['kind'] and report.get('injection_observed') is True and report.get('recovery_observed') is True, 'fault schedule not actually exercised/recovered')
        common.require(report.get('basis') == 'INDEPENDENT_OBSERVATION', 'fault controller declaration is insufficient')
        injected = common.integer(report.get('injected_monotonic_ns'), 'observed fault injection', 0)
        cleared = common.integer(report.get('cleared_monotonic_ns'), 'observed fault clearance', 0)
        recovered = common.integer(report.get('recovered_monotonic_ns'), 'observed recovery', 0)
        common.require(origin <= injected < cleared <= recovered, 'invalid observed fault timing order')
        wanted = origin + fault['at_ms'] * 1000000
        common.require(abs(injected - wanted) <= tolerance, 'actual injection differs from frozen schedule')
        common.require(abs(cleared - (wanted + fault['duration_ms'] * 1000000)) <= tolerance, 'actual fault duration differs from frozen schedule')
        derived_rto = (recovered - injected + 999999) // 1000000
        common.integer(report.get('rpo_ms'), 'observed RPO', 0)
        common.integer(report.get('rto_ms'), 'observed RTO', 0)
        common.require(report['rto_ms'] == derived_rto, 'reported RTO differs from independent monotonic observations')
        common.require(report['rpo_ms'] <= manifest['slo']['rpo_ms'] and derived_rto <= manifest['slo']['rto_ms'], 'frozen recovery objective exceeded')
        intervals.append((fault['kind'], injected, cleared))
    common.require(found == set(expected), 'missing fault observations')
    common.require(required_pairs(manifest) <= overlapping_pairs(intervals), 'actual fault intervals do not overlap required composite pairs')
    return True

def verify_recovery_receipts(observation, manifest, root, evidence=None):
    anchors = manifest['inputs'].get('accepted_receipts')
    common.require(isinstance(anchors, list) and anchors, 'externally approved full receipt anchors absent')
    trusted = {pin['sha256'] for pin in anchors}
    receipts = observation.get('receipts')
    common.require(isinstance(receipts, list) and receipts, 'retrievable full recovery receipts required')
    seen, coverage = set(), set()
    for record in receipts:
        common.require(isinstance(record, dict) and {'pin', 'trusted_anchor_sha256'} <= set(record), 'pinned externally anchored receipt required')
        path, content = common.pinned_file(record['pin'], root)
        sha = record['pin']['sha256']
        common.require(sha not in seen, 'duplicate recovery receipt')
        seen.add(sha)
        common.require(record['trusted_anchor_sha256'] in trusted and record['trusted_anchor_sha256'] == common.digest(content), 'receipt differs from approved external anchor')
        receipt = common.verify_full_receipt(record['pin'], manifest, root, evidence)
        cases = receipt['case_ids']
        coverage.update(set(cases) & RECOVERY_CASES)
    common.require(coverage == RECOVERY_CASES, 'full recovery receipt case coverage incomplete')
    return True

def inspect_reconstruction(observation, manifest, root, evidence=None):
    state = inspect_state(observation, manifest)
    inspect_fault_reports(observation, manifest)
    verify_recovery_receipts(observation, manifest, root, evidence)
    return state

def run(path, evidence):
    manifest, root = common.load_manifest(path, 'faults')
    validate_faults(manifest)
    trust = common.observer_trust(manifest, root)
    common.require({'DURABLE_READER', 'PROVIDER_READER'} <= set(trust['roles']), 'fault observer requires approved independent durable/provider roles')
    directory = Path(evidence) / (manifest['campaign_id'] + '-' + str(uuid.uuid4()))
    directory.mkdir(parents=True, mode=0o700)
    common.sealed_write(directory / 'manifest.json', manifest)
    adapters = {name: common.CommandAdapter(spec, root, directory / name) for name, spec in manifest['adapters'].items()}
    run_id = str(uuid.uuid4())
    state, failure, resource_ids = None, None, set()
    started = time.monotonic_ns()
    try:
        adapters['control'].call({'operation': 'execute_composite_schedule', 'campaign_id': run_id, 'source_revision': manifest['source_revision'], 'source_manifest_digest': manifest['source_manifest_digest'], 'profile': manifest['profile'], 'faults': manifest['faults'], 'inputs': manifest['inputs'], 'slo': manifest['slo']})
        request = {'operation': 'reconstruct', 'campaign_id': run_id, 'source_revision': manifest['source_revision'], 'source_manifest_digest': manifest['source_manifest_digest']}
        observed, _ = adapters['observer'].call(request)
        observation = observed.get('observation')
        common.verify_observation(observation, manifest, root, request, {'DURABLE_READER', 'PROVIDER_READER'})
        if isinstance(observation, dict) and isinstance(observation.get('events'), list):
            resource_ids = {event['resource_id'] for event in observation['events'] if event.get('kind') == 'provider_observe' and isinstance(event.get('resource_id'), str)}
        state = inspect_reconstruction(observation, manifest, root, directory / 'receipt-checks')
        common.require(state['peak_slots'] >= manifest['profile']['slots'], 'declared simultaneous mixed load not observed during faults')
        common.require(set(state['faults']) >= FAULTS, 'fault injection missing from independent durable event trace')
    except BaseException as exc:
        failure = exc
    finally:
        try:
            adapters['cleanup'].call({'operation': 'cleanup', 'campaign_id': run_id})
            request = {'operation': 'observe_cleanup', 'campaign_id': run_id, 'source_revision': manifest['source_revision'], 'source_manifest_digest': manifest['source_manifest_digest']}
            cleanup, _ = adapters['observer'].call(request)
            common.verify_observation(cleanup, manifest, root, request, {'DURABLE_READER', 'PROVIDER_READER'})
            cleanup_result(cleanup, manifest.get('retained_resources', {}), resource_ids)
        except BaseException as exc:
            failure = common.CampaignError('cleanup debt: ' + str(exc) + ('; original: ' + str(failure) if failure else ''))
    if failure:
        common.sealed_write(directory / 'failure.json', {'status': 'BLOCKED' if isinstance(failure, common.Blocked) else 'FAIL', 'error': str(failure), 'full_case_qualified': False})
        raise failure
    return common.sealed_write(directory / 'result.json', {'schema_version': 1, 'status': 'PASS', 'evidence_scope': 'COMPOSITE_FAULT_CAMPAIGN', 'state': state, 'wall_clock_ns': time.monotonic_ns() - started, 'independent_reconstruction': True})

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--manifest', required=True)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    try:
        if not args.execute:
            raise common.Blocked('Destructive fault campaign requires --execute and approved pinned inputs')
        print(json.dumps(run(args.manifest, args.evidence)))
        return 0
    except (common.CampaignError, OSError, KeyError, TypeError) as exc:
        print(json.dumps({'status': 'BLOCKED' if isinstance(exc, common.Blocked) else 'FAIL', 'error': str(exc), 'full_case_qualified': False}), file=sys.stderr)
        return 2 if isinstance(exc, common.Blocked) else 1

if __name__ == '__main__':
    raise SystemExit(main())
