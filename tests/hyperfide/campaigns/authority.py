#!/usr/bin/env python3
"""Independent inspection of the actual04 journal and two-lineage activation.

These checks establish metadata consistency only. Physical writer isolation,
trusted producer identity and full recovery qualification are separate gates.
Fixture deployments/epochs must never be substituted for a caller's live run.
"""
from __future__ import annotations
import datetime as dt
import hashlib
import json
import re

SUPPLIER = {
    "revision": "e788ccd4abc4bd4b67eaf8c348cfd41dba6b241f",
    "durability_sha256": "dd4ef3a972cb74c6755e8c901667ee269da8cc2710285d43d6157f9b80430898",
    "journal_sha256": "d23b129d4bf8ec06487f7213b773bac7e087e69231ded721a93b7617ffb3ffc9",
    "migration_sha256": "78ae25a9a07f14e67ab05f3ddc5f99a60b85e07673fa67c0bddc4b495e902908",
}

class AuthorityError(ValueError):
    pass

def require(value, message):
    if not value:
        raise AuthorityError(message)

def closed(value, keys, label):
    require(type(value) is dict and set(value) == set(keys), label + " fields differ from actual v1 contract")

def canonical(value):
    # Actual04 journal canonical(): UTF-8 JSON, sorted object keys, no newline.
    try:
        return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode()
    except (TypeError, ValueError, UnicodeError) as error:
        raise AuthorityError("noncanonical journal JSON") from error

def sha(value):
    return "sha256:" + hashlib.sha256(canonical(value)).hexdigest()

def digest(value):
    require(type(value) is str and re.fullmatch(r"sha256:[0-9a-f]{64}", value), "exact SHA-256 identity required")
    return value

def identity(value, nullable=False):
    require(nullable and value is None or type(value) is str and re.fullmatch(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}", value), "canonical actual04 UUID required")
    return value

def decimal(value):
    require(type(value) is str and re.fullmatch(r"0|[1-9][0-9]{0,18}", value) and int(value) <= 9223372036854775807, "bounded canonical decimal string required")
    return int(value)

def timestamp(value):
    # PostgreSQL clock_timestamp()::text uses a space and +00, unlike JS ISO.
    require(type(value) is str and re.fullmatch(r"[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\.[0-9]{1,6})?(?:Z|\+00(?::00)?)", value), "exact UTC primary/producer timestamp required")
    try:
        result = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as error:
        raise AuthorityError("invalid UTC timestamp") from error
    require(result.utcoffset() == dt.timedelta(0), "timestamp is not UTC")
    return result

def milliseconds(value):
    instant = timestamp(value) - dt.datetime(1970, 1, 1, tzinfo=dt.timezone.utc)
    # Match Date.parse: PostgreSQL sub-millisecond fractions are truncated.
    return instant.days * 86400000 + instant.seconds * 1000 + instant.microseconds // 1000

def fresh(observed, expires, checked_at):
    start, end, now = (milliseconds(value) for value in (observed, expires, checked_at))
    return 0 < end - start <= 30000 and start <= now + 1000 and end > now

def strict_json(source):
    def pairs(items):
        result = {}
        for key, value in items:
            require(key not in result, "duplicate original JSON key")
            result[key] = value
        return result
    def constant(_value):
        raise AuthorityError("nonfinite original JSON value")
    try:
        return json.loads(source, object_pairs_hook=pairs, parse_constant=constant)
    except (ValueError, UnicodeError) as error:
        raise AuthorityError("invalid original fencer JSON") from error

def inspect_journal(document, deployment_id):
    """Reconstruct every immutable journal link from the actual public v1 schema."""
    identity(deployment_id)
    closed(document, "schema_version deployment_id state epoch sequence pending history head_digest document_digest".split(), "journal")
    require(type(document["schema_version"]) is int and document["schema_version"] == 1 and document["deployment_id"] == deployment_id, "journal deployment/schema mismatch")
    require(len(canonical(document)) <= 4 * 1024 * 1024, "journal exceeds actual04 byte limit")
    require(document["state"] in {"ACTIVE", "PENDING"}, "unknown journal state")
    identity(document["epoch"], nullable=True)
    history = document["history"]
    require(type(history) is list and len(history) <= 4096, "bounded actual04 history required")
    require(decimal(document["sequence"]) == len(history), "journal sequence differs from complete history")
    digest(document["document_digest"])
    body = {key: value for key, value in document.items() if key != "document_digest"}
    require(document["document_digest"] == sha(body), "journal document digest mismatch")
    previous_head = sha({"deployment_id": deployment_id, "initial": True})
    previous_epoch = None
    operations, epochs = set(), set()
    for index, record in enumerate(history):
        closed(record, "operation_id previous_epoch database_predecessor_epoch epoch sequence fence_evidence_digest commit_evidence_digest previous_head_digest head_digest".split(), "activation history record")
        operation = identity(record["operation_id"])
        epoch = identity(record["epoch"])
        identity(record["previous_epoch"], nullable=True)
        database_previous = identity(record["database_predecessor_epoch"], nullable=True)
        require(operation not in operations and epoch not in epochs, "journal reuses operation or authority epoch")
        require(record["previous_epoch"] == previous_epoch, "journal external predecessor is discontinuous")
        require(database_previous is None or database_previous in epochs, "restored database lineage was never externally accepted")
        require(record["sequence"] == str(index + 1), "journal history sequence has a gap")
        require(record["previous_head_digest"] == previous_head, "journal previous-head digest mismatch")
        require(digest(record["fence_evidence_digest"]) == digest(record["commit_evidence_digest"]), "actual04 committed fence evidence differs")
        unsigned = {key: value for key, value in record.items() if key != "head_digest"}
        require(digest(record["head_digest"]) == sha(unsigned), "journal history record digest mismatch")
        operations.add(operation)
        epochs.add(epoch)
        previous_epoch, previous_head = epoch, record["head_digest"]
    require(document["epoch"] == previous_epoch and document["head_digest"] == previous_head, "journal accepted head differs from immutable history")
    if document["state"] == "ACTIVE":
        require(bool(history) and document["pending"] is None, "ACTIVE journal lacks accepted history or retains PENDING custody")
    else:
        pending = document["pending"]
        closed(pending, "operation_id expected_previous_epoch expected_database_epoch epoch fence_evidence_digest candidate_digests".split(), "pending custody")
        identity(pending["operation_id"])
        identity(pending["epoch"])
        identity(pending["expected_previous_epoch"], nullable=True)
        identity(pending["expected_database_epoch"], nullable=True)
        require(pending["operation_id"] not in operations and pending["epoch"] not in epochs, "pending custody reuses accepted identity")
        require(pending["expected_previous_epoch"] == document["epoch"], "PENDING does not extend independent external head")
        require(pending["expected_database_epoch"] is None or pending["expected_database_epoch"] in epochs, "PENDING database predecessor was never externally accepted")
        candidates = pending["candidate_digests"]
        require(type(candidates) is list and 1 <= len(candidates) <= 16 and all(type(item) is str for item in candidates) and len(set(candidates)) == len(candidates), "bounded unique actual fence candidates required")
        for item in candidates:
            digest(item)
        require(digest(pending["fence_evidence_digest"]) in candidates, "current pending proof is not durably retained")
    return {"state": document["state"], "epoch": document["epoch"], "sequence": document["sequence"], "head_digest": document["head_digest"], "accepted_epochs": epochs, "accepted_operations": operations}

def inspect_transition(proof, expected):
    """Inspect observed04 rows/journal records; do not grant live/cutover authority.

    The caller supplies trusted expected fixture OR fleet identities. It must
    authenticate the producer and retain the raw observations independently.
    """
    closed(expected, "deployment_id operation_id external_previous_epoch database_previous_epoch new_epoch mode".split(), "expected activation")
    deployment = identity(expected["deployment_id"])
    operation = identity(expected["operation_id"])
    external = identity(expected["external_previous_epoch"], nullable=True)
    database = identity(expected["database_previous_epoch"], nullable=True)
    epoch = identity(expected["new_epoch"])
    mode = expected["mode"]
    require(mode in {"BOOTSTRAP", "ROTATE", "RESTORE"}, "actual activation kind required")
    require(mode != "BOOTSTRAP" or external is None and database is None, "bootstrap cannot replace existing authority")
    require(mode != "ROTATE" or external is not None and external == database, "ordinary rotation requires one exact shared predecessor")
    require(mode != "RESTORE" or external is not None, "restore requires independently accepted external authority")
    require(epoch not in (external, database), "activation epoch must be fresh across both lineages")
    closed(proof, "activation authority_epoch database_predecessor_authority_epoch fencer_receipt_json journal_before journal_pending journal_after journal_raw external_attestation primary_admission_now timing".split(), "observed activation proof")
    before, pending, after = proof["journal_before"], proof["journal_pending"], proof["journal_after"]
    raw_journal = proof["journal_raw"]
    closed(raw_journal, ("before", "pending", "after"), "original journal bytes")
    for name, document in (("before", before), ("pending", pending), ("after", after)):
        original = raw_journal[name]
        if document is None:
            require(name == "before" and original is None, "missing journal must retain actual absence, not invented bytes")
        else:
            require(type(original) is str and 0 < len(original.encode()) <= 4 * 1024 * 1024, "bounded original journal bytes required")
            require(strict_json(original) == document and original.encode() == canonical(document), "original journal bytes differ from captured canonical document")
    if before is None:
        require(mode == "BOOTSTRAP", "missing external journal cannot reconstruct authority from restored database")
        before_history, before_sequence, before_head = [], "0", sha({"deployment_id": deployment, "initial": True})
    else:
        view = inspect_journal(before, deployment)
        require(view["state"] == "ACTIVE" and view["epoch"] == external, "activation did not start from exact independently accepted external head")
        before_history, before_sequence, before_head = before["history"], before["sequence"], before["head_digest"]
        require(database is None or database in view["accepted_epochs"], "database predecessor is absent from independent external lineage")
    pending_view = inspect_journal(pending, deployment)
    require(pending_view["state"] == "PENDING" and pending["epoch"] == external and pending["sequence"] == before_sequence and pending["head_digest"] == before_head and pending["history"] == before_history, "durable PENDING changed prior accepted history")
    custody = pending["pending"]
    require(custody["operation_id"] == operation and custody["expected_previous_epoch"] == external and custody["expected_database_epoch"] == database and custody["epoch"] == epoch, "PENDING does not bind both exact predecessors and one candidate epoch")
    raw = proof["fencer_receipt_json"]
    require(type(raw) is str and 0 < len(raw.encode()) <= 32768, "bounded exact JSON.stringify fencer bytes required")
    fence = strict_json(raw)
    require(type(fence) is dict and fence.get("deployment_id") == deployment and fence.get("operation_id") == operation and fence.get("source_epoch") == external, "physical fence metadata scope/operation mismatch")
    for key in ("fence_id", "isolated_writer"):
        require(type(fence.get(key)) is str and bool(fence[key]), "physical fence must identify actual isolation/writer")
    digest(fence.get("evidence_digest"))
    proof_digest = "sha256:" + hashlib.sha256(raw.encode()).hexdigest()
    require(proof_digest in custody["candidate_digests"], "accepted proof was never durably prepared")
    require(fresh(fence.get("observed_at"), fence.get("expires_at"), proof["primary_admission_now"]), "fence freshness differs from actual04 primary admission contract")
    activation, authority = proof["activation"], proof["authority_epoch"]
    require(type(activation) is dict and type(authority) is dict, "actual primary activation and authority rows required")
    require(all(activation.get(key) == value for key, value in {"deployment_id": deployment, "operation_id": operation, "epoch": epoch}.items()), "positive primary activation receipt identity mismatch")
    # Actual04 hashes ordered JSON.stringify, not sorted journal canonical JSON.
    request = {"deployment_id": deployment, "operation_id": operation}
    if mode == "RESTORE":
        request.update(expected_external_epoch=external, expected_database_epoch=database, mode="RESTORE")
    else:
        request["expected_previous_epoch"] = external
    request_digest = "sha256:" + hashlib.sha256(json.dumps(request, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode()).hexdigest()
    require(activation.get("request_digest") == request_digest, "operation receipt does not bind actual ordered two-lineage request")
    timestamp(activation.get("accepted_at"))
    require(all(authority.get(key) == value for key, value in {"deployment_id": deployment, "epoch": epoch, "previous_epoch": external, "database_predecessor_epoch": database, "activation_kind": mode, "state": "ACTIVE", "fence_id": fence["fence_id"], "proof_digest": proof_digest}.items()), "active primary row differs from exact activation binding")
    timestamp(authority.get("activated_at"))
    predecessor = proof["database_predecessor_authority_epoch"]
    if database is None:
        require(predecessor is None, "absent database authority must not fabricate a predecessor row")
    else:
        require(type(predecessor) is dict and predecessor.get("deployment_id") == deployment and predecessor.get("epoch") == database and predecessor.get("state") == "REVOKED", "actual restored database predecessor was not superseded")
    after_view = inspect_journal(after, deployment)
    require(after_view["state"] == "ACTIVE" and after_view["epoch"] == epoch and decimal(after["sequence"]) == decimal(before_sequence) + 1 and len(after["history"]) == len(before_history) + 1 and after["history"][:-1] == before_history, "external publication is not one append-only positive activation")
    record = after["history"][-1]
    require(all(record[key] == value for key, value in {"operation_id": operation, "previous_epoch": external, "database_predecessor_epoch": database, "epoch": epoch, "fence_evidence_digest": proof_digest, "commit_evidence_digest": proof_digest, "previous_head_digest": before_head}.items()), "external publication differs from prepared/committed operation")
    attestation = proof["external_attestation"]
    closed(attestation, "deployment_id epoch sequence evidence_digest observed_at expires_at checked_at".split(), "actual checked external attestation")
    require(all(attestation[key] == value for key, value in {"deployment_id": deployment, "epoch": epoch, "sequence": after["sequence"], "evidence_digest": proof_digest}.items()), "checked external attestation differs from current primary/journal head")
    require(fresh(attestation["observed_at"], attestation["expires_at"], attestation["checked_at"]), "external attestation is stale at actual primary check")
    timing = proof["timing"]
    closed(timing, "pending_observed_ns commit_observed_ns published_observed_ns".split(), "observed activation ordering")
    require(decimal(timing["pending_observed_ns"]) < decimal(timing["commit_observed_ns"]) < decimal(timing["published_observed_ns"]), "actual durable PENDING/positive COMMIT/published ordering not established")
    return {"checked": True, "scope": "CONTRACT_METADATA_ONLY", "mode": mode, "epoch": epoch, "external_previous_epoch": external, "database_previous_epoch": database, "journal_sequence": after["sequence"], "grants_authority": False, "physical_qualification": "NOT_GRANTED"}
