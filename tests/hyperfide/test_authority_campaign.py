#!/usr/bin/env python3
"""Synthetic metadata counterexamples only: no PG, producer or physical proof."""
from __future__ import annotations
import copy
import hashlib
import json
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parent / "campaigns"))
import authority as a
import deterministic as d

def uid(number):
    return f"{number:08x}-0000-4000-8000-000000000001"

DEPLOYMENT = uid(1)
A, B, C = uid(2), uid(3), uid(4)
STAMP = "2026-10-16T12:00:00.000Z"
END = "2026-10-16T12:00:10.000Z"

def raw_hash(raw):
    return "sha256:" + hashlib.sha256(raw.encode()).hexdigest()

def seal_document(document):
    value = copy.deepcopy(document)
    value.pop("document_digest", None)
    value["document_digest"] = a.sha(value)
    return value

def accepted(history, operation, epoch, database):
    previous = history[-1]["epoch"] if history else None
    head = history[-1]["head_digest"] if history else a.sha({"deployment_id": DEPLOYMENT, "initial": True})
    record = {"operation_id": operation, "previous_epoch": previous,
              "database_predecessor_epoch": database, "epoch": epoch,
              "sequence": str(len(history) + 1), "fence_evidence_digest": "sha256:" + "a" * 64,
              "commit_evidence_digest": "sha256:" + "a" * 64, "previous_head_digest": head}
    record["head_digest"] = a.sha(record)
    return history + [record]

def active(history):
    return seal_document({"schema_version": 1, "deployment_id": DEPLOYMENT, "state": "ACTIVE",
        "epoch": history[-1]["epoch"], "sequence": str(len(history)), "pending": None,
        "history": history, "head_digest": history[-1]["head_digest"]})

def fixture(mode="RESTORE"):
    # These deliberately synthetic records test rejection boundaries, not execution.
    history = []
    if mode != "BOOTSTRAP":
        history = accepted(history, uid(10), A, None)
    if mode == "RESTORE":
        history = accepted(history, uid(11), B, A)
    external = history[-1]["epoch"] if history else None
    database = A if mode == "RESTORE" else external
    operation, epoch = uid(12), C
    expected = {"deployment_id": DEPLOYMENT, "operation_id": operation,
        "external_previous_epoch": external, "database_previous_epoch": database,
        "new_epoch": epoch, "mode": mode}
    fence = {"deployment_id": DEPLOYMENT, "operation_id": operation, "source_epoch": external,
        "fence_id": "synthetic-counterexample-fence", "isolated_writer": "synthetic-old-writer",
        "evidence_digest": "sha256:" + "b" * 64, "observed_at": STAMP, "expires_at": END}
    raw = json.dumps(fence, separators=(",", ":"))
    digest = raw_hash(raw)
    head = history[-1]["head_digest"] if history else a.sha({"deployment_id": DEPLOYMENT, "initial": True})
    pending = seal_document({"schema_version": 1, "deployment_id": DEPLOYMENT, "state": "PENDING",
        "epoch": external, "sequence": str(len(history)), "history": history,
        "head_digest": head, "pending": {"operation_id": operation, "expected_previous_epoch": external,
        "expected_database_epoch": database, "epoch": epoch, "fence_evidence_digest": digest,
        "candidate_digests": [digest]}})
    final_history = accepted(history, operation, epoch, database)
    final_history[-1].update(fence_evidence_digest=digest, commit_evidence_digest=digest)
    final_history[-1].pop("head_digest")
    final_history[-1]["head_digest"] = a.sha(final_history[-1])
    request = {"deployment_id": DEPLOYMENT, "operation_id": operation}
    if mode == "RESTORE":
        request.update(expected_external_epoch=external, expected_database_epoch=database, mode="RESTORE")
    else:
        request["expected_previous_epoch"] = external
    proof = {"activation": {"deployment_id": DEPLOYMENT, "operation_id": operation, "epoch": epoch,
        "request_digest": raw_hash(json.dumps(request, separators=(",", ":"))), "accepted_at": STAMP},
        "authority_epoch": {"deployment_id": DEPLOYMENT, "epoch": epoch, "previous_epoch": external,
        "database_predecessor_epoch": database, "activation_kind": mode, "state": "ACTIVE",
        "fence_id": fence["fence_id"], "proof_digest": digest, "activated_at": STAMP},
        "database_predecessor_authority_epoch": None if database is None else
            {"deployment_id": DEPLOYMENT, "epoch": database, "state": "REVOKED"},
        "fencer_receipt_json": raw, "journal_before": active(history) if history else None,
        "journal_pending": pending, "journal_after": active(final_history),
        "primary_admission_now": "2026-10-16 12:00:00.000900+00",
        "external_attestation": {"deployment_id": DEPLOYMENT, "epoch": epoch,
            "sequence": str(len(final_history)), "evidence_digest": digest, "observed_at": STAMP,
            "expires_at": END, "checked_at": STAMP},
        "timing": {"pending_observed_ns": "100", "commit_observed_ns": "200", "published_observed_ns": "300"}}
    return proof, expected

class AuthorityMetadataTests(unittest.TestCase):
    def test_current_contract_modes_are_metadata_only(self):
        for mode in ("BOOTSTRAP", "ROTATE", "RESTORE"):
            with self.subTest(mode=mode):
                result = a.inspect_transition(*fixture(mode))
                self.assertEqual(result["mode"], mode)
                self.assertFalse(result["grants_authority"])
                self.assertEqual(result["physical_qualification"], "NOT_GRANTED")

    def test_restored_database_is_distinct_from_external_head(self):
        proof, expected = fixture()
        self.assertNotEqual(expected["external_previous_epoch"], expected["database_previous_epoch"])
        self.assertTrue(a.inspect_transition(proof, expected)["checked"])
        proof["authority_epoch"]["previous_epoch"] = A
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_restore_cannot_reconstruct_missing_external_journal(self):
        proof, expected = fixture()
        proof["journal_before"] = None
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_unseen_database_lineage_rejected_even_with_valid_document_seal(self):
        proof, expected = fixture()
        pending = proof["journal_pending"]
        pending["pending"]["expected_database_epoch"] = uid(99)
        proof["journal_pending"] = seal_document(pending)
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_pending_must_precede_positive_commit_and_publication(self):
        for key, value in (("pending_observed_ns", "200"), ("published_observed_ns", "199")):
            proof, expected = fixture()
            proof["timing"][key] = value
            with self.assertRaises(a.AuthorityError):
                a.inspect_transition(proof, expected)

    def test_missing_pending_cannot_be_replaced_by_active_head(self):
        proof, expected = fixture()
        proof["journal_pending"] = proof["journal_after"]
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_resealed_history_cannot_reuse_epoch_or_drop_lineage(self):
        proof, _ = fixture()
        journal = copy.deepcopy(proof["journal_after"])
        journal["history"][-1]["epoch"] = A
        record = journal["history"][-1]
        record.pop("head_digest")
        record["head_digest"] = a.sha(record)
        journal["epoch"], journal["head_digest"] = A, record["head_digest"]
        with self.assertRaises(a.AuthorityError):
            a.inspect_journal(seal_document(journal), DEPLOYMENT)

    def test_sorted_request_hash_cannot_replace_actual_ordered_json_stringify(self):
        proof, expected = fixture()
        request = {"deployment_id": DEPLOYMENT, "operation_id": expected["operation_id"],
            "expected_external_epoch": B, "expected_database_epoch": A, "mode": "RESTORE"}
        proof["activation"]["request_digest"] = a.sha(request)
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_database_predecessor_must_be_observed_revoked(self):
        proof, expected = fixture()
        proof["database_predecessor_authority_epoch"]["state"] = "ACTIVE"
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_boolean_isolation_and_wrong_operation_are_not_identity(self):
        for field, value in (("isolated_writer", True), ("operation_id", uid(98))):
            proof, expected = fixture()
            fence = json.loads(proof["fencer_receipt_json"])
            fence[field] = value
            proof["fencer_receipt_json"] = json.dumps(fence, separators=(",", ":"))
            with self.assertRaises(a.AuthorityError):
                a.inspect_transition(proof, expected)

    def test_fence_expiry_and_clock_skew_match_primary_milliseconds(self):
        self.assertTrue(a.fresh("2026-10-16T12:00:01.000Z", END, "2026-10-16 12:00:00.000999+00"))
        self.assertFalse(a.fresh("2026-10-16T12:00:01.001Z", END, "2026-10-16 12:00:00.000999+00"))
        self.assertFalse(a.fresh(STAMP, END, END))
        self.assertFalse(a.fresh(STAMP, "2026-10-16T12:00:30.001Z", STAMP))

    def test_exact_raw_proof_bytes_are_bound(self):
        proof, expected = fixture()
        proof["fencer_receipt_json"] += " "
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_retained_older_candidate_can_reconcile_positive_commit(self):
        proof, expected = fixture()
        pending = proof["journal_pending"]
        pending["pending"]["fence_evidence_digest"] = "sha256:" + "d" * 64
        pending["pending"]["candidate_digests"].append("sha256:" + "d" * 64)
        proof["journal_pending"] = seal_document(pending)
        self.assertTrue(a.inspect_transition(proof, expected)["checked"])

    def test_current_attestation_must_match_published_head(self):
        proof, expected = fixture()
        proof["external_attestation"]["epoch"] = A
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

    def test_duplicate_nonfinite_and_invalid_timestamp_refused(self):
        for raw in ('{"same":1,"same":2}', '{"x":NaN}', '{"x":Infinity}'):
            with self.assertRaises(a.AuthorityError):
                a.strict_json(raw)
        for value in ("2026-10-16T12:00:00+01:00", "2026-02-30T12:00:00Z", True):
            with self.assertRaises(a.AuthorityError):
                a.timestamp(value)

    def test_reference_consumes_current_restore_and_fences_old_owner(self):
        proof, expected = fixture()
        model = d.Reference(100, 200, B, DEPLOYMENT, "04-journal-v1")
        model.apply({"sequence": 1, "virtual_ms": 0, "kind": "claim", "operation_id": uid(90),
            "epoch": B, "accepted": True, "task_id": "old-task", "attempt_id": "old-attempt",
            "slot_id": "old-slot", "generation": 1})
        event = {"sequence": 2, "virtual_ms": 1, "kind": "epoch",
            "operation_id": expected["operation_id"], "epoch": B, "accepted": True,
            "new_epoch": C, "database_previous_epoch": A, "activation_kind": "RESTORE",
            "activation_contract": "04-journal-v1", "activation_proof": proof}
        model.apply(event)
        self.assertEqual(model.epoch, C)
        self.assertFalse(model.owners)
        model.apply({"sequence": 3, "virtual_ms": 2, "kind": "effect",
            "operation_id": uid(91), "epoch": B, "accepted": False, "effect_key": "old-writer"})
        self.assertFalse(model.effects)

    def test_current_reference_never_downgrades_missing_journal(self):
        proof, expected = fixture()
        event = {"sequence": 1, "virtual_ms": 0, "kind": "epoch",
            "operation_id": expected["operation_id"], "epoch": B, "accepted": True,
            "new_epoch": C, "database_previous_epoch": A, "activation_kind": "RESTORE",
            "activation_contract": "04-journal-v1", "activation_proof": proof}
        for field in ("activation_contract", "database_previous_epoch"):
            with self.subTest(field=field):
                bad = copy.deepcopy(event)
                bad.pop(field)
                model = d.Reference(100, 200, B, DEPLOYMENT, "04-journal-v1")
                with self.assertRaises(d.CampaignError):
                    model.apply(bad)

    def test_fixture_deployment_cannot_rotate_live_reference(self):
        proof, expected = fixture()
        model = d.Reference(100, 200, B, uid(93), "04-journal-v1")
        event = {"sequence": 1, "virtual_ms": 0, "kind": "epoch",
            "operation_id": expected["operation_id"], "epoch": B, "accepted": True,
            "new_epoch": C, "database_previous_epoch": A, "activation_kind": "RESTORE",
            "activation_contract": "04-journal-v1", "activation_proof": proof}
        with self.assertRaises(d.CampaignError):
            model.apply(event)

    def test_opaque_unsealed_or_unknown_contract_cannot_pass(self):
        proof, expected = fixture()
        proof["journal_after"]["document_digest"] = "sha256:" + "0" * 64
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)
        proof, expected = fixture()
        proof["execution_passed"] = True
        with self.assertRaises(a.AuthorityError):
            a.inspect_transition(proof, expected)

if __name__ == "__main__":
    unittest.main()
