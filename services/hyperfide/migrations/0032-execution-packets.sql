-- Prospective packets describe an admission request; they do not grant compute.
CREATE TABLE hyperfide.hierarchy_execution_packets (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 digest hyperfide.digest NOT NULL,mandatory_digest hyperfide.digest NOT NULL,
 task_id uuid NOT NULL,attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL CHECK(attempt_generation>=1),
 spec_revision_id uuid NOT NULL,spec_generation bigint NOT NULL CHECK(spec_generation>=1),
 package_id uuid NOT NULL,package_generation bigint NOT NULL CHECK(package_generation>=1),
 authority_epoch uuid NOT NULL,leader_generation bigint NOT NULL CHECK(leader_generation>=1),
 policy_digest hyperfide.digest NOT NULL,registry_digest hyperfide.digest NOT NULL,
 packet jsonb NOT NULL CHECK(jsonb_typeof(packet)='object' AND octet_length(packet::text)<=1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,digest),
 UNIQUE(organisation_id,run_id,attempt_id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_execution_packets FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','digest','mandatory_digest','task_id','attempt_id','attempt_generation','spec_revision_id','spec_generation','package_id','package_generation','authority_epoch','leader_generation','policy_digest','registry_digest','packet','created_at');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_execution_packets FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- Prospective continuation packets retain their actual bytes before a new claim.
CREATE TABLE hyperfide.hierarchy_execution_packet_artifacts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,packet_id uuid NOT NULL,
 artifact_role text NOT NULL CHECK(artifact_role IN ('CAPSULE','DEPENDENCY','SUMMARY','FINDINGS')),
 artifact_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,run_id,packet_id,artifact_role),
 FOREIGN KEY(organisation_id,run_id,packet_id) REFERENCES hyperfide.hierarchy_execution_packets(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_execution_packet_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','packet_id','artifact_role','artifact_id');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_execution_packet_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
