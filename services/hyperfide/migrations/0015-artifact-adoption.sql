-- Checkpoint registration distinguishes native capsule bytes, metadata, and chunk-manifest identity.
ALTER TABLE hyperfide.checkpoints
 ADD COLUMN artifact_content_digest hyperfide.digest,
 ADD COLUMN source_metadata_digest hyperfide.digest,
 ADD COLUMN preparation_digest hyperfide.digest,
 ADD COLUMN dependency_digest hyperfide.digest,
 ADD COLUMN source_manifest jsonb,
 ADD COLUMN registration_operation_id uuid,
 ADD COLUMN registration_payload_digest hyperfide.digest,
 ADD COLUMN registration_actor_id uuid,
 ADD COLUMN registration_kind text CHECK(registration_kind IN ('LIVE','STALE_IMPORT')),
 ADD COLUMN source_workspace_id uuid,
 ADD CONSTRAINT checkpoint_registration_complete CHECK(
 (registration_operation_id IS NULL AND artifact_content_digest IS NULL AND source_metadata_digest IS NULL
 AND preparation_digest IS NULL AND dependency_digest IS NULL AND source_manifest IS NULL
 AND registration_payload_digest IS NULL AND registration_actor_id IS NULL AND registration_kind IS NULL AND source_workspace_id IS NULL)
 OR (registration_operation_id IS NOT NULL AND artifact_content_digest IS NOT NULL AND source_metadata_digest IS NOT NULL
 AND preparation_digest IS NOT NULL AND dependency_digest IS NOT NULL AND source_manifest IS NOT NULL
 AND jsonb_typeof(source_manifest)='object' AND octet_length(source_manifest::text)<=65536
 AND registration_payload_digest IS NOT NULL AND registration_actor_id IS NOT NULL AND registration_kind IS NOT NULL AND source_workspace_id IS NOT NULL)),
 ADD CONSTRAINT checkpoint_registration_operation UNIQUE(organisation_id,run_id,registration_operation_id),
 ADD CONSTRAINT checkpoint_source_workspace FOREIGN KEY(organisation_id,run_id,source_workspace_id)
 REFERENCES hyperfide.workspaces(organisation_id,run_id,id);
CREATE TRIGGER immutable_checkpoint_registration BEFORE UPDATE OR DELETE ON hyperfide.checkpoints
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('artifact_content_digest','source_metadata_digest',
 'preparation_digest','dependency_digest','source_manifest','registration_operation_id','registration_payload_digest',
 'registration_actor_id','registration_kind','source_workspace_id');

-- Adoption records preserve historical provenance; they never renew source authority.
CREATE UNIQUE INDEX checkpoint_adoption_binding ON hyperfide.checkpoints
 (organisation_id,run_id,id,artifact_id,attempt_id,attempt_generation);
CREATE TABLE hyperfide.artifact_adoptions (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL, payload_digest hyperfide.digest NOT NULL,
 source_checkpoint_id uuid NOT NULL, source_artifact_id uuid NOT NULL,
 source_attempt_id uuid NOT NULL, source_generation bigint NOT NULL CHECK(source_generation>0),
 target_attempt_id uuid NOT NULL, target_generation bigint NOT NULL CHECK(target_generation>0),
 repository_id uuid NOT NULL, source_object_id hyperfide.git_oid NOT NULL,
 input_packet_digest hyperfide.digest NOT NULL, preparation_digest hyperfide.digest NOT NULL,
 mode text NOT NULL CHECK(mode IN ('SOURCE_ONLY','NATIVE_RESUME')),
 compatibility jsonb NOT NULL CHECK(jsonb_typeof(compatibility)='object' AND octet_length(compatibility::text)<=65536),
 provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object' AND octet_length(provenance::text)<=262144),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,source_checkpoint_id,source_artifact_id,source_attempt_id,source_generation)
 REFERENCES hyperfide.checkpoints(organisation_id,run_id,id,artifact_id,attempt_id,attempt_generation),
 FOREIGN KEY(organisation_id,run_id,target_attempt_id,target_generation)
 REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation),
 FOREIGN KEY(organisation_id,run_id,repository_id)
 REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id)
 REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 CHECK(source_attempt_id<>target_attempt_id OR source_generation<>target_generation)
);
CREATE TRIGGER immutable_adoption BEFORE UPDATE OR DELETE ON hyperfide.artifact_adoptions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
 'organisation_id','run_id','id','operation_id','payload_digest','source_checkpoint_id','source_artifact_id',
 'source_attempt_id','source_generation','target_attempt_id','target_generation','repository_id',
 'source_object_id','input_packet_digest','preparation_digest','mode','compatibility','provenance','created_at');

CREATE TRIGGER authority_isolation_artifact_adoptions BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.artifact_adoptions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- These identities are recoverable context bytes, not optional model prose.
ALTER TABLE hyperfide.checkpoints ADD COLUMN artifact_content_size_bytes bigint
 CHECK(artifact_content_size_bytes BETWEEN 40 AND 134217728);
ALTER TABLE hyperfide.checkpoints ADD CONSTRAINT checkpoint_content_size_bound
 CHECK((registration_operation_id IS NULL)=(artifact_content_size_bytes IS NULL));
CREATE TRIGGER immutable_checkpoint_content_size BEFORE UPDATE OR DELETE ON hyperfide.checkpoints
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('artifact_content_size_bytes');
CREATE TABLE hyperfide.checkpoint_context_artifacts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,checkpoint_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('dependency','summary','findings')),
 artifact_id uuid NOT NULL,artifact_digest hyperfide.digest NOT NULL,
 artifact_size_bytes bigint NOT NULL CHECK(artifact_size_bytes>=0),
 receipt_id hyperfide.digest NOT NULL,
 storage_kind text NOT NULL CHECK(storage_kind IN ('object','manifest')),
 content_digest hyperfide.digest NOT NULL,content_size_bytes bigint NOT NULL CHECK(content_size_bytes>=0 AND content_size_bytes<=1073741824),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,checkpoint_id,role),
 FOREIGN KEY(organisation_id,run_id,checkpoint_id) REFERENCES hyperfide.checkpoints(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 CHECK(storage_kind<>'object' OR (content_digest=artifact_digest AND content_size_bytes=artifact_size_bytes))
);
CREATE TRIGGER immutable_checkpoint_context BEFORE UPDATE OR DELETE ON hyperfide.checkpoint_context_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','checkpoint_id','role','artifact_id','artifact_digest','artifact_size_bytes','receipt_id','storage_kind','content_digest','content_size_bytes','created_at');
CREATE TRIGGER authority_isolation_checkpoint_context BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.checkpoint_context_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE FUNCTION hyperfide.checkpoint_context_available() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
 SELECT * INTO item FROM hyperfide.artifacts
 WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.artifact_id FOR SHARE;
 IF NOT FOUND OR item.status<>'COMPLETE' OR item.digest<>NEW.artifact_digest OR item.size_bytes<>NEW.artifact_size_bytes THEN
 RAISE EXCEPTION 'checkpoint context artifact differs or is unavailable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER checkpoint_context_available BEFORE INSERT ON hyperfide.checkpoint_context_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.checkpoint_context_available();
CREATE FUNCTION hyperfide.checkpoint_context_complete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.registration_operation_id IS NOT NULL AND
 (SELECT count(*) FROM hyperfide.checkpoint_context_artifacts WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND checkpoint_id=NEW.id)<>3 THEN
 RAISE EXCEPTION 'registered checkpoint requires all immutable context artifacts' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER checkpoint_context_complete AFTER INSERT ON hyperfide.checkpoints
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION hyperfide.checkpoint_context_complete();
