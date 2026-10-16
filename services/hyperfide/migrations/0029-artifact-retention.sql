-- Holds and GC intents live in PostgreSQL before any destructive backend request.
CREATE TABLE hyperfide.artifact_holds (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 artifact_id uuid NOT NULL, reference_kind text NOT NULL
 CHECK(reference_kind IN ('EVIDENCE','FINDING','PUBLICATION','RECOVERY','ADOPTION','LEGAL')),
 reference_id uuid NOT NULL, reason hyperfide.long_name NOT NULL,
 authority_actor hyperfide.long_name NOT NULL, policy_digest hyperfide.digest NOT NULL,
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','RELEASED')),
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_at timestamptz, state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>0),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,artifact_id,reference_kind,reference_id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 CHECK((status='ACTIVE' AND released_at IS NULL) OR (status='RELEASED' AND released_at IS NOT NULL))
);
CREATE TABLE hyperfide.artifact_gc_operations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, operation_id uuid NOT NULL,
 artifact_id uuid NOT NULL, payload_digest hyperfide.digest NOT NULL, policy_digest hyperfide.digest NOT NULL,
 authority_actor hyperfide.long_name NOT NULL, reason hyperfide.long_name NOT NULL,
 expected_state_version bigint NOT NULL CHECK(expected_state_version>0),
 storage_backend text NOT NULL CHECK(length(storage_backend) BETWEEN 1 AND 64),
 storage_key hyperfide.long_name NOT NULL, digest hyperfide.digest NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>=0),
 state text NOT NULL DEFAULT 'INTENT' CHECK(state IN ('INTENT','REQUESTED','UNKNOWN','ABSENT','RETAINED','FAILED')),
 last_error_code text CHECK(last_error_code IS NULL OR last_error_code ~ '^[A-Z][A-Z0-9_]{0,127}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>0),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE UNIQUE INDEX one_current_artifact_gc ON hyperfide.artifact_gc_operations(organisation_id,run_id,artifact_id)
 WHERE state IN ('INTENT','REQUESTED','UNKNOWN');
CREATE TRIGGER immutable_hold_binding BEFORE UPDATE OR DELETE ON hyperfide.artifact_holds
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','artifact_id',
 'reference_kind','reference_id','reason','authority_actor','policy_digest','created_at');
CREATE TRIGGER immutable_gc_binding BEFORE UPDATE OR DELETE ON hyperfide.artifact_gc_operations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','operation_id','artifact_id',
 'payload_digest','policy_digest','authority_actor','reason','expected_state_version','storage_backend','storage_key','digest','size_bytes','created_at');

CREATE TABLE hyperfide.artifact_retention_events (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,operation_id uuid NOT NULL,
 artifact_id uuid NOT NULL,payload_digest hyperfide.digest NOT NULL,policy_digest hyperfide.digest NOT NULL,
 authority_actor hyperfide.long_name NOT NULL,reason hyperfide.long_name NOT NULL,
 before_policy jsonb NOT NULL CHECK(jsonb_typeof(before_policy)='object'),
 after_policy jsonb NOT NULL CHECK(jsonb_typeof(after_policy)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_retention_event BEFORE UPDATE OR DELETE ON hyperfide.artifact_retention_events
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','operation_id',
 'artifact_id','payload_digest','policy_digest','authority_actor','reason','before_policy','after_policy','created_at');

-- Every new reference shares the artifact row lock with quarantine admission.
CREATE FUNCTION hyperfide.artifact_reference_available() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE artifact_uuid uuid; current_status text;
BEGIN
 IF TG_TABLE_NAME='artifact_holds' AND to_jsonb(NEW)->>'status'='RELEASED' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='evidence' AND to_jsonb(NEW)->>'admission_state' IN ('REJECTED','STALE') THEN RETURN NEW; END IF;
 artifact_uuid:=(to_jsonb(NEW)->>TG_ARGV[0])::uuid;
 IF artifact_uuid IS NULL THEN RETURN NEW; END IF;
 SELECT status INTO current_status FROM hyperfide.artifacts
 WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=artifact_uuid FOR SHARE;
 IF NOT FOUND OR current_status IN ('QUARANTINED','DELETED')
 OR (TG_ARGV[1]='COMPLETE' AND current_status<>'COMPLETE') THEN
 RAISE EXCEPTION 'artifact reference is not available' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hold_artifact_available BEFORE INSERT OR UPDATE OF status ON hyperfide.artifact_holds
 FOR EACH ROW EXECUTE FUNCTION hyperfide.artifact_reference_available('artifact_id','PENDING');
CREATE TRIGGER checkpoint_artifact_available BEFORE INSERT ON hyperfide.checkpoints
 FOR EACH ROW EXECUTE FUNCTION hyperfide.artifact_reference_available('artifact_id','COMPLETE');
CREATE TRIGGER adoption_artifact_available BEFORE INSERT ON hyperfide.artifact_adoptions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.artifact_reference_available('source_artifact_id','COMPLETE');
CREATE TRIGGER evidence_artifact_available BEFORE INSERT OR UPDATE OF admission_state,artifact_id ON hyperfide.evidence
 FOR EACH ROW EXECUTE FUNCTION hyperfide.artifact_reference_available('artifact_id','PENDING');
CREATE TRIGGER attached_artifact_available BEFORE INSERT ON hyperfide.evidence_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.artifact_reference_available('artifact_id','COMPLETE');
CREATE TRIGGER parse_artifact_available BEFORE INSERT OR UPDATE OF facts_artifact_id ON hyperfide.parse_blobs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.artifact_reference_available('facts_artifact_id','COMPLETE');

CREATE FUNCTION hyperfide.custody_artifacts_available() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
 IF NEW.authority<>'ACTIVE' THEN RETURN NEW; END IF;
 FOR item IN SELECT status FROM hyperfide.artifacts
 WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id
 AND digest IN (NEW.source_manifest_digest,NEW.evidence_manifest_digest)
 ORDER BY id FOR SHARE LOOP
 IF item.status<>'COMPLETE' THEN RAISE EXCEPTION 'custody artifact is not complete' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER custody_artifacts_available BEFORE INSERT OR UPDATE OF authority ON hyperfide.submission_custodies
 FOR EACH ROW EXECUTE FUNCTION hyperfide.custody_artifacts_available();

CREATE TRIGGER authority_isolation_artifact_holds BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.artifact_holds FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER authority_isolation_artifact_gc_operations BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.artifact_gc_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER authority_isolation_artifact_retention_events BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.artifact_retention_events FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

ALTER TABLE hyperfide.artifact_holds
 ADD COLUMN release_operation_id uuid,
 ADD COLUMN release_payload_digest hyperfide.digest,
 ADD COLUMN release_actor hyperfide.long_name,
 ADD COLUMN release_reason hyperfide.long_name,
 ADD COLUMN release_policy_digest hyperfide.digest,
 ADD CONSTRAINT hold_release_audit_complete CHECK(
 (status='ACTIVE' AND release_operation_id IS NULL AND release_payload_digest IS NULL
 AND release_actor IS NULL AND release_reason IS NULL AND release_policy_digest IS NULL)
 OR (status='RELEASED' AND release_operation_id IS NOT NULL AND release_payload_digest IS NOT NULL
 AND release_actor IS NOT NULL AND release_reason IS NOT NULL AND release_policy_digest IS NOT NULL)),
 ADD CONSTRAINT hold_release_operation UNIQUE(organisation_id,run_id,release_operation_id);
CREATE FUNCTION hyperfide.artifact_hold_release_once() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status='RELEASED' AND NEW IS DISTINCT FROM OLD THEN
 RAISE EXCEPTION 'released hold audit is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_released_hold BEFORE UPDATE ON hyperfide.artifact_holds
 FOR EACH ROW EXECUTE FUNCTION hyperfide.artifact_hold_release_once();

-- Indirect finding/publication references must acquire the artifact lock too:
-- their evidence may already be STALE and therefore outside ordinary admission.
CREATE FUNCTION hyperfide.retain_indirect_evidence_artifacts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_evidence uuid; target_finding uuid; target_candidate uuid; item record;
BEGIN
 IF TG_TABLE_NAME='finding_observations' THEN target_evidence:=NEW.evidence_id;
 ELSIF TG_TABLE_NAME='findings' THEN
  IF NEW.state NOT IN ('OPEN','ACKNOWLEDGED') THEN RETURN NEW; END IF;
  target_finding:=NEW.id;
 ELSIF TG_TABLE_NAME='publication_intents' THEN
  IF NEW.state NOT IN ('PENDING','EXECUTING') THEN RETURN NEW; END IF;
  target_candidate:=NEW.candidate_id;
 ELSIF TG_TABLE_NAME='candidate_evidence' THEN target_evidence:=NEW.evidence_id;
 ELSE RAISE EXCEPTION 'unsupported indirect evidence reference' USING ERRCODE='23514';
 END IF;
 FOR item IN
  SELECT a.status FROM hyperfide.artifacts a
  WHERE a.organisation_id=NEW.organisation_id AND a.run_id=NEW.run_id
  AND a.id IN (
   SELECT e.artifact_id FROM hyperfide.evidence e
   WHERE e.organisation_id=NEW.organisation_id AND e.run_id=NEW.run_id
   AND (e.id=target_evidence OR e.id IN (
    SELECT o.evidence_id FROM hyperfide.finding_observations o
    WHERE o.organisation_id=NEW.organisation_id AND o.run_id=NEW.run_id AND o.finding_id=target_finding
    UNION ALL SELECT c.evidence_id FROM hyperfide.candidate_evidence c
    WHERE c.organisation_id=NEW.organisation_id AND c.run_id=NEW.run_id AND c.candidate_id=target_candidate))
   UNION ALL
   SELECT ea.artifact_id FROM hyperfide.evidence_artifacts ea
   WHERE ea.organisation_id=NEW.organisation_id AND ea.run_id=NEW.run_id
   AND (ea.evidence_id=target_evidence OR ea.evidence_id IN (
    SELECT o.evidence_id FROM hyperfide.finding_observations o
    WHERE o.organisation_id=NEW.organisation_id AND o.run_id=NEW.run_id AND o.finding_id=target_finding
    UNION ALL SELECT c.evidence_id FROM hyperfide.candidate_evidence c
    WHERE c.organisation_id=NEW.organisation_id AND c.run_id=NEW.run_id AND c.candidate_id=target_candidate)))
  ORDER BY a.id FOR SHARE OF a
 LOOP
  IF item.status<>'COMPLETE' THEN RAISE EXCEPTION 'indirect evidence artifact is unavailable' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER finding_observation_artifacts_available BEFORE INSERT ON hyperfide.finding_observations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.retain_indirect_evidence_artifacts();
CREATE TRIGGER finding_reopen_artifacts_available BEFORE UPDATE OF state ON hyperfide.findings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.retain_indirect_evidence_artifacts();
CREATE TRIGGER publication_evidence_artifacts_available BEFORE INSERT OR UPDATE OF state ON hyperfide.publication_intents
 FOR EACH ROW EXECUTE FUNCTION hyperfide.retain_indirect_evidence_artifacts();
CREATE TRIGGER candidate_evidence_artifacts_available BEFORE INSERT ON hyperfide.candidate_evidence
 FOR EACH ROW EXECUTE FUNCTION hyperfide.retain_indirect_evidence_artifacts();
