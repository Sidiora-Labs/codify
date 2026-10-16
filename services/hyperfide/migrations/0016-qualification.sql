-- Domain16 preserves immutable worker inputs, independently generated receipts and applicability.
CREATE TABLE hyperfide.assurance_submissions (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, custody_id uuid NOT NULL,
 request_id uuid NOT NULL, request_digest hyperfide.digest NOT NULL,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 source_artifact_id uuid NOT NULL, evidence_artifact_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,custody_id), UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,source_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,evidence_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_dispositions (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, custody_id uuid NOT NULL,
 custody_generation bigint NOT NULL CHECK(custody_generation>=1), actor_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 2048),
 disposition text NOT NULL CHECK(disposition='REVOKED'),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,custody_id,custody_generation),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_job_assignments (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, job_id uuid NOT NULL,
 assignment_generation bigint NOT NULL CHECK(assignment_generation>=1),
 verifier_id uuid NOT NULL, sandbox_id uuid NOT NULL, slot_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>=1),
 reservation_id uuid NOT NULL, environment_digest hyperfide.digest NOT NULL,
 allocation_id uuid NOT NULL, allocation_generation bigint NOT NULL CHECK(allocation_generation>=1),
 assigned_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,job_id,assignment_generation),
 UNIQUE(organisation_id,run_id,reservation_id),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,verifier_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_check_intents (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, job_id uuid NOT NULL,
 lease_generation bigint NOT NULL CHECK(lease_generation>=1), check_id hyperfide.name NOT NULL,
 operation_id uuid NOT NULL, session_id uuid NOT NULL, plan_digest hyperfide.digest NOT NULL,
 plan jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,job_id,lease_generation,check_id),
 UNIQUE(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_job_receipts (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, job_id uuid NOT NULL,
 lease_generation bigint NOT NULL CHECK(lease_generation>=1),
 verifier_id uuid NOT NULL, environment_digest hyperfide.digest NOT NULL,
 receipt_digest hyperfide.digest NOT NULL, evidence_id uuid NOT NULL, receipt_artifact_id uuid NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,job_id,lease_generation),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,receipt_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_judgements (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, custody_id uuid NOT NULL,
 clause_id hyperfide.name NOT NULL, reviewer_id uuid NOT NULL, rubric_digest hyperfide.digest NOT NULL,
 input_manifest_digest hyperfide.digest NOT NULL, requalification_id uuid,
 support jsonb NOT NULL CHECK(jsonb_typeof(support)='array' AND jsonb_array_length(support)>0),
 limitations text NOT NULL CHECK(length(limitations) BETWEEN 1 AND 8192),
 disposition text NOT NULL CHECK(disposition IN ('PASS','FAIL')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,custody_id,clause_id,reviewer_id,input_manifest_digest),
 FOREIGN KEY(organisation_id,run_id,requalification_id) REFERENCES hyperfide.requalification_operations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_applicability (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, custody_id uuid NOT NULL,
 applicability text NOT NULL DEFAULT 'MISSING' CHECK(applicability IN ('MISSING','CURRENT','STALE')),
 input_manifest jsonb NOT NULL CHECK(jsonb_typeof(input_manifest)='object'),
 current_receipt_digest hyperfide.digest, reasons jsonb NOT NULL DEFAULT '[]',
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,custody_id),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_invalidations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, request_id uuid NOT NULL,
 custody_id uuid NOT NULL, request_digest hyperfide.digest NOT NULL,
 before_inputs jsonb NOT NULL, after_inputs jsonb NOT NULL, affected_checks jsonb NOT NULL,
 requalification_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,requalification_id) REFERENCES hyperfide.requalification_operations(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_requalification_inputs (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, operation_id uuid NOT NULL,
 publication_operation_id uuid, manifest jsonb NOT NULL, policy jsonb NOT NULL,
 registry_digest hyperfide.digest NOT NULL, input_manifest jsonb NOT NULL,
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.requalification_operations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,publication_operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_requalification_acceptances (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, operation_id uuid NOT NULL,
 receipt_digest hyperfide.digest NOT NULL, accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.requalification_operations(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_history (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL, provenance hyperfide.long_name NOT NULL, legacy_claim jsonb NOT NULL,
 imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.assurance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'assurance history is immutable' USING ERRCODE='23514'; END $$;
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['assurance_submissions','assurance_dispositions','assurance_job_assignments','assurance_check_intents','assurance_job_receipts','assurance_judgements',
 'assurance_invalidations','assurance_history','assurance_requalification_inputs','assurance_requalification_acceptances'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.assurance_immutable()', t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['assurance_submissions','assurance_dispositions','assurance_job_assignments','assurance_check_intents','assurance_job_receipts','assurance_judgements',
 'assurance_applicability','assurance_invalidations','assurance_history','assurance_requalification_inputs','assurance_requalification_acceptances'] LOOP
  EXECUTE format('CREATE TRIGGER supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',t);
 END LOOP;
END $$;
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.assurance_applicability FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();

CREATE INDEX assurance_receipts_digest ON hyperfide.assurance_job_receipts(organisation_id,run_id,receipt_digest);
CREATE INDEX assurance_jobs_current_custody ON hyperfide.qualification_jobs(organisation_id,run_id,custody_id,state,outcome);

-- Preparation intent is durable before any remote hydration or command. These
-- metadata rows never substitute for a native seal or grant runtime readiness.
CREATE TABLE hyperfide.assurance_preparation_intents (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, operation_id uuid NOT NULL,
 job_id uuid NOT NULL, job_lease_generation bigint NOT NULL CHECK(job_lease_generation>=0),
 custody_id uuid NOT NULL, custody_generation bigint NOT NULL CHECK(custody_generation>=1),
 request_digest hyperfide.digest NOT NULL, context_digest hyperfide.digest NOT NULL,
 session_id uuid NOT NULL, reservation_id uuid NOT NULL,
 allocation_id uuid NOT NULL, allocation_generation bigint NOT NULL CHECK(allocation_generation>=1),
 derived_profile_id uuid NOT NULL, plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.assurance_effective_result_inputs (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, job_id uuid NOT NULL,
 preparation_operation_id uuid NOT NULL, custody_id uuid NOT NULL,
 custody_generation bigint NOT NULL CHECK(custody_generation>=1), profile_id uuid NOT NULL,
 baseline_packet_digest hyperfide.digest NOT NULL, accepted_context_digest hyperfide.digest NOT NULL,
 input_manifest jsonb NOT NULL CHECK(jsonb_typeof(input_manifest)='object'),
 receipt_digest hyperfide.digest NOT NULL, receipt_artifact_id uuid NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,job_id), UNIQUE(organisation_id,run_id,receipt_digest),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,preparation_operation_id) REFERENCES hyperfide.assurance_preparation_intents(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,receipt_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON hyperfide.assurance_preparation_intents
 FOR EACH ROW EXECUTE FUNCTION hyperfide.assurance_immutable();
CREATE TRIGGER supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.assurance_preparation_intents
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON hyperfide.assurance_effective_result_inputs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.assurance_immutable();
CREATE TRIGGER supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.assurance_effective_result_inputs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
