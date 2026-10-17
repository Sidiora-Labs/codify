-- Domain 19: immutable integration inputs and recorded external publication.
-- Applied only by the migration identity; service handlers contain no DDL.
CREATE TABLE hyperfide.integration_requests (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,request_id uuid NOT NULL,
 request_digest hyperfide.digest NOT NULL,candidate_ids uuid[] NOT NULL CHECK(cardinality(candidate_ids)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.integration_candidate_manifests (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,candidate_id uuid NOT NULL,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=4194304),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,candidate_id),
 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.integration_jobs (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,candidate_id uuid NOT NULL,
 executor_id uuid NOT NULL,reservation_id uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','OUTCOME_UNKNOWN','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),finished_at timestamptz,
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id)
);
CREATE UNIQUE INDEX integration_job_active ON hyperfide.integration_jobs(organisation_id,run_id,candidate_id) WHERE state IN ('RUNNING','OUTCOME_UNKNOWN');
CREATE TABLE hyperfide.integration_gate_receipts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,candidate_id uuid NOT NULL,job_id uuid NOT NULL,
 gate_id hyperfide.name NOT NULL,attempt bigint GENERATED ALWAYS AS IDENTITY,
 input_manifest_digest hyperfide.digest NOT NULL,outcome text NOT NULL CHECK(outcome IN ('PASS','FAIL','STALE','UNKNOWN')),
 exit_code integer,assertion_count bigint NOT NULL CHECK(assertion_count>=0),
 stdout_digest hyperfide.digest NOT NULL,stderr_digest hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,attempt),
 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.integration_jobs(organisation_id,run_id,id),
 CHECK(outcome<>'PASS' OR exit_code=0)
);
CREATE TABLE hyperfide.publication_gateway_admissions (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,operation_id uuid NOT NULL,
 permit_digest hyperfide.digest NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.integration_closure_evaluations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 level text NOT NULL CHECK(level IN ('TASK','WAVE','PROGRAMME')),wave integer,
 input_manifest_digest hyperfide.digest NOT NULL,outcome text NOT NULL CHECK(outcome IN ('PASS','HELD')),
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.integration_release_barriers (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,request_id uuid NOT NULL,
 manifest_digest hyperfide.digest NOT NULL,manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object'),
 state text NOT NULL DEFAULT 'HELD' CHECK(state IN ('HELD','PARTIAL','RECONCILING','RELEASED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),state_version bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(organisation_id,run_id,id),UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.integration_release_outcomes (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,barrier_id uuid NOT NULL,
 repository_id uuid NOT NULL,candidate_id uuid NOT NULL,operation_id uuid,
 outcome text NOT NULL CHECK(outcome IN ('PENDING','PUBLISHED','FAILED','UNKNOWN')),
 observed_head hyperfide.git_oid,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,barrier_id,repository_id),
 FOREIGN KEY(organisation_id,run_id,barrier_id) REFERENCES hyperfide.integration_release_barriers(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id)
);
-- Uncertain external operations retain their admission. Expiry alone cannot
-- revoke contributor custody, advance branch generation, or change run inputs.
CREATE FUNCTION hyperfide.guard_inflight_integration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE inflight boolean;
BEGIN
 IF TG_TABLE_NAME='submission_custodies' THEN
  IF NEW.authority IS NOT DISTINCT FROM OLD.authority AND NEW.qualification_outcome IS NOT DISTINCT FROM OLD.qualification_outcome THEN RETURN NEW;END IF;
  SELECT EXISTS(SELECT 1 FROM hyperfide.candidate_custodies c JOIN hyperfide.publication_operations p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.candidate_id=c.candidate_id
   WHERE c.organisation_id=OLD.organisation_id AND c.run_id=OLD.run_id AND c.custody_id=OLD.id AND p.state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) INTO inflight;
 ELSIF TG_TABLE_NAME='branch_authorities' THEN
  IF NEW.authority IS NOT DISTINCT FROM OLD.authority AND NEW.branch_generation IS NOT DISTINCT FROM OLD.branch_generation AND NEW.expected_old_head IS NOT DISTINCT FROM OLD.expected_old_head THEN RETURN NEW;END IF;
  SELECT EXISTS(SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=OLD.organisation_id AND run_id=OLD.run_id AND branch_authority_id=OLD.id AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) INTO inflight;
 ELSE
  IF NEW.authority_epoch IS NOT DISTINCT FROM OLD.authority_epoch AND NEW.spec_revision_id IS NOT DISTINCT FROM OLD.spec_revision_id AND NEW.spec_generation IS NOT DISTINCT FROM OLD.spec_generation AND NEW.policy_digest IS NOT DISTINCT FROM OLD.policy_digest AND NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW;END IF;
  SELECT EXISTS(SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=OLD.organisation_id AND run_id=OLD.id AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) INTO inflight;
 END IF;
 IF inflight THEN RAISE EXCEPTION 'external publication must be reconciled before authority changes' USING ERRCODE='23514';END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER integration_publication_guard BEFORE UPDATE ON hyperfide.submission_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.guard_inflight_integration();
CREATE TRIGGER integration_publication_guard BEFORE UPDATE ON hyperfide.branch_authorities FOR EACH ROW EXECUTE FUNCTION hyperfide.guard_inflight_integration();
CREATE TRIGGER integration_publication_guard BEFORE UPDATE ON hyperfide.runs FOR EACH ROW EXECUTE FUNCTION hyperfide.guard_inflight_integration();
CREATE UNIQUE INDEX integration_publication_target_active ON hyperfide.publication_operations(organisation_id,repository_id,branch_authority_id) WHERE state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN');
CREATE TRIGGER immutable_integration_request BEFORE UPDATE OR DELETE ON hyperfide.integration_requests FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','request_id','request_digest','candidate_ids');
CREATE TRIGGER immutable_candidate_manifest BEFORE UPDATE OR DELETE ON hyperfide.integration_candidate_manifests FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','candidate_id','manifest');
CREATE TRIGGER immutable_gate_receipt BEFORE UPDATE OR DELETE ON hyperfide.integration_gate_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','candidate_id','job_id','gate_id','attempt','input_manifest_digest','outcome','exit_code','assertion_count','stdout_digest','stderr_digest');
CREATE TRIGGER immutable_gateway_admission BEFORE UPDATE OR DELETE ON hyperfide.publication_gateway_admissions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','operation_id','permit_digest');
CREATE TRIGGER immutable_closure_evaluation BEFORE UPDATE OR DELETE ON hyperfide.integration_closure_evaluations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','level','wave','input_manifest_digest','outcome','manifest');
CREATE TRIGGER immutable_release_manifest BEFORE UPDATE ON hyperfide.integration_release_barriers FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','request_id','manifest_digest','manifest');
CREATE TRIGGER monotonic_release_barrier BEFORE UPDATE ON hyperfide.integration_release_barriers FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();

CREATE TABLE hyperfide.publication_target_locks (
 organisation_id uuid NOT NULL,repository_id uuid NOT NULL,target_ref hyperfide.git_ref NOT NULL,
 run_id uuid NOT NULL,operation_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,repository_id,target_ref),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id)
);

ALTER TABLE hyperfide.integration_gate_receipts ADD COLUMN stdout text NOT NULL CHECK(octet_length(stdout)<=1048576);
ALTER TABLE hyperfide.integration_gate_receipts ADD COLUMN stderr text NOT NULL CHECK(octet_length(stderr)<=1048576);
CREATE TABLE hyperfide.integration_scope_receipts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 level text NOT NULL CHECK(level IN ('WAVE','PROGRAMME')),wave integer,
 input_manifest_digest hyperfide.digest NOT NULL,manifest jsonb NOT NULL,
 gate_id hyperfide.name NOT NULL,covered_ids text[] NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('PASS','FAIL','STALE','UNKNOWN')),
 exit_code integer,assertion_count bigint NOT NULL CHECK(assertion_count>=0),
 stdout text NOT NULL CHECK(octet_length(stdout)<=1048576),stderr text NOT NULL CHECK(octet_length(stderr)<=1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TRIGGER immutable_scope_receipt BEFORE UPDATE OR DELETE ON hyperfide.integration_scope_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','level','wave','input_manifest_digest','manifest','gate_id','covered_ids','outcome','exit_code','assertion_count','stdout','stderr','job_id');

CREATE TABLE hyperfide.integration_scope_jobs (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,executor_id uuid NOT NULL,reservation_id uuid NOT NULL,
 level text NOT NULL CHECK(level IN ('WAVE','PROGRAMME')),wave integer,
 input_manifest_digest hyperfide.digest NOT NULL,state text NOT NULL CHECK(state IN ('RUNNING','SUCCEEDED','FAILED','OUTCOME_UNKNOWN','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id)
);
ALTER TABLE hyperfide.integration_scope_receipts ADD COLUMN job_id uuid NOT NULL;
ALTER TABLE hyperfide.integration_scope_receipts ADD FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.integration_scope_jobs(organisation_id,run_id,id);

CREATE FUNCTION hyperfide.guard_publication_target_release() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=OLD.organisation_id AND run_id=OLD.run_id AND id=OLD.operation_id AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) THEN
 RAISE EXCEPTION 'publication target remains reserved while external outcome is uncertain' USING ERRCODE='23514';
 END IF;RETURN OLD;
END $$;
CREATE TRIGGER release_target_only_terminal BEFORE DELETE ON hyperfide.publication_target_locks FOR EACH ROW EXECUTE FUNCTION hyperfide.guard_publication_target_release();
CREATE TRIGGER immutable_publication_target BEFORE UPDATE ON hyperfide.publication_target_locks FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','repository_id','target_ref','run_id','operation_id');
CREATE TRIGGER immutable_candidate_job BEFORE UPDATE ON hyperfide.integration_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','candidate_id','executor_id','reservation_id');
CREATE TRIGGER immutable_scope_job BEFORE UPDATE ON hyperfide.integration_scope_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','executor_id','reservation_id','level','wave','input_manifest_digest');
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['integration_requests','integration_candidate_manifests','integration_jobs','integration_gate_receipts','publication_gateway_admissions','integration_closure_evaluations','integration_release_barriers','integration_release_outcomes','publication_target_locks','integration_scope_receipts','integration_scope_jobs'] LOOP
 EXECUTE format('CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',t);
 END LOOP;
END $$;

ALTER TABLE hyperfide.integration_scope_receipts ADD COLUMN proof jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(proof)='object' AND octet_length(proof::text)<=16777216);
CREATE TRIGGER immutable_scope_proof BEFORE UPDATE ON hyperfide.integration_scope_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('proof');

ALTER TABLE hyperfide.integration_gate_receipts ADD COLUMN proof jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(proof)='object' AND octet_length(proof::text)<=16777216);
CREATE TRIGGER immutable_candidate_gate_proof BEFORE UPDATE ON hyperfide.integration_gate_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('proof');

CREATE TABLE hyperfide.integration_admission_halts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,mode text NOT NULL CHECK(mode IN ('CANCEL','STOP')),
 control_generation bigint NOT NULL CHECK(control_generation>=1),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id),FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.integration_revocation_debt (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,operation_id uuid NOT NULL,custody_id uuid NOT NULL,
 mode text NOT NULL CHECK(mode IN ('CANCEL','STOP')),control_generation bigint NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RECONCILED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,operation_id,custody_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.integration_preparations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,request_id uuid NOT NULL,request_digest hyperfide.digest NOT NULL,
 state text NOT NULL CHECK(state IN ('PREPARING','PREPARED','OUTCOME_UNKNOWN','FAILED')),
 execution_manifest jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,request_id),FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
-- Emergency STOP may hold admission immediately while immutable external
-- intents remain frozen until their real Git outcomes are reconciled.
CREATE OR REPLACE FUNCTION hyperfide.guard_inflight_integration() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE inflight boolean;
BEGIN
 IF TG_TABLE_NAME='submission_custodies' THEN
  IF NEW.authority IS NOT DISTINCT FROM OLD.authority AND NEW.qualification_outcome IS NOT DISTINCT FROM OLD.qualification_outcome THEN RETURN NEW;END IF;
  SELECT EXISTS(SELECT 1 FROM hyperfide.candidate_custodies c JOIN hyperfide.publication_operations p ON p.organisation_id=c.organisation_id AND p.run_id=c.run_id AND p.candidate_id=c.candidate_id WHERE c.organisation_id=OLD.organisation_id AND c.run_id=OLD.run_id AND c.custody_id=OLD.id AND p.state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) INTO inflight;
 ELSIF TG_TABLE_NAME='branch_authorities' THEN
  IF NEW.authority IS NOT DISTINCT FROM OLD.authority AND NEW.branch_generation IS NOT DISTINCT FROM OLD.branch_generation AND NEW.expected_old_head IS NOT DISTINCT FROM OLD.expected_old_head THEN RETURN NEW;END IF;
  SELECT EXISTS(SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=OLD.organisation_id AND run_id=OLD.run_id AND branch_authority_id=OLD.id AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) INTO inflight;
 ELSE
  IF NEW.authority_epoch IS NOT DISTINCT FROM OLD.authority_epoch AND NEW.spec_revision_id IS NOT DISTINCT FROM OLD.spec_revision_id AND NEW.spec_generation IS NOT DISTINCT FROM OLD.spec_generation AND NEW.policy_digest IS NOT DISTINCT FROM OLD.policy_digest THEN RETURN NEW;END IF;
  SELECT EXISTS(SELECT 1 FROM hyperfide.publication_operations WHERE organisation_id=OLD.organisation_id AND run_id=OLD.id AND state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN')) INTO inflight;
 END IF;
 IF inflight THEN RAISE EXCEPTION 'external publication must be reconciled before frozen authority inputs change' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;

CREATE TABLE hyperfide.integration_candidate_review_inputs (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,candidate_id uuid NOT NULL,repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,input_manifest_digest hyperfide.digest NOT NULL,policy_digest hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,candidate_id,source_object_id),
 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);
CREATE TRIGGER immutable_candidate_review_input BEFORE UPDATE OR DELETE ON hyperfide.integration_candidate_review_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','candidate_id','repository_id','source_object_id','input_manifest_digest','policy_digest');
CREATE TRIGGER immutable_candidate_preparation BEFORE UPDATE ON hyperfide.integration_preparations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','request_id','request_digest','execution_manifest');

CREATE TABLE hyperfide.publication_hosted_receipts(organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,operation_id uuid NOT NULL,receipt_digest text NOT NULL,receipt jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,id),FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id));
CREATE TRIGGER publication_hosted_receipts_immutable BEFORE UPDATE OR DELETE ON hyperfide.publication_hosted_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','operation_id','receipt_digest','receipt');

CREATE TABLE hyperfide.integration_closure_policies(organisation_id uuid NOT NULL,run_id uuid NOT NULL,run_policy_digest text NOT NULL,closure_policy_digest text NOT NULL,policy jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,run_policy_digest),FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id));
CREATE TRIGGER immutable_closure_policy BEFORE UPDATE OR DELETE ON hyperfide.integration_closure_policies FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','run_policy_digest','closure_policy_digest','policy');

CREATE TRIGGER immutable_gate_output BEFORE UPDATE ON hyperfide.integration_gate_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('stdout','stderr');
DO $$
DECLARE t text;
BEGIN
 FOREACH t IN ARRAY ARRAY['integration_admission_halts','integration_revocation_debt','integration_preparations','integration_candidate_review_inputs','publication_hosted_receipts','integration_closure_policies'] LOOP
 EXECUTE format('CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',t);
 END LOOP;
END $$;

ALTER TABLE hyperfide.integration_candidate_review_inputs ADD COLUMN input_bindings jsonb NOT NULL CHECK(jsonb_typeof(input_bindings)='object');
ALTER TABLE hyperfide.integration_candidate_review_inputs ADD COLUMN bindings_digest hyperfide.digest NOT NULL;
CREATE TRIGGER immutable_candidate_context_bindings BEFORE UPDATE ON hyperfide.integration_candidate_review_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('input_bindings','bindings_digest');

ALTER TABLE hyperfide.integration_jobs ADD COLUMN source_manifest_digest hyperfide.digest,ADD COLUMN source_object_id hyperfide.git_oid,ADD COLUMN source_tree_id hyperfide.git_oid;
CREATE TRIGGER immutable_candidate_job_source BEFORE UPDATE ON hyperfide.integration_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('source_manifest_digest','source_object_id','source_tree_id');

ALTER TABLE hyperfide.integration_candidate_review_inputs DROP CONSTRAINT integration_candidate_review_inputs_pkey;
ALTER TABLE hyperfide.integration_candidate_review_inputs ADD COLUMN phase text NOT NULL DEFAULT 'ADMISSION' CHECK(phase IN('ADMISSION','CURRENT_PUBLISHED')),ADD COLUMN generation bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE hyperfide.integration_candidate_review_inputs ADD PRIMARY KEY(organisation_id,run_id,candidate_id,source_object_id,input_manifest_digest,phase);
CREATE TRIGGER immutable_candidate_review_generation BEFORE UPDATE ON hyperfide.integration_candidate_review_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('phase','generation');
ALTER TABLE hyperfide.integration_jobs ADD COLUMN review_bindings_digest hyperfide.digest,ADD COLUMN verification_input_digest hyperfide.digest;
CREATE TRIGGER immutable_candidate_job_context BEFORE UPDATE ON hyperfide.integration_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('review_bindings_digest','verification_input_digest');

CREATE TABLE hyperfide.publication_acceptance_receipts(organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,operation_id uuid NOT NULL,outcome text NOT NULL CHECK(outcome IN('ACCEPTED','HELD')),reasons text[] NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,id),FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id));
CREATE TRIGGER immutable_publication_acceptance BEFORE UPDATE OR DELETE ON hyperfide.publication_acceptance_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','operation_id','outcome','reasons');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.publication_acceptance_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

ALTER TABLE hyperfide.publication_acceptance_receipts ADD COLUMN manifest jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(manifest)='object');
CREATE TRIGGER immutable_publication_acceptance_proof BEFORE UPDATE ON hyperfide.publication_acceptance_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('manifest');

-- Exact remote plans survive control restarts; opaque permits are never stored.
ALTER TABLE hyperfide.integration_jobs ADD COLUMN execution_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE hyperfide.integration_scope_jobs ADD COLUMN execution_manifest jsonb NOT NULL DEFAULT '[]'::jsonb;
CREATE TRIGGER immutable_candidate_execution_manifest BEFORE UPDATE ON hyperfide.integration_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('execution_manifest');
CREATE TRIGGER immutable_scope_execution_manifest BEFORE UPDATE ON hyperfide.integration_scope_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('execution_manifest');
CREATE UNIQUE INDEX one_candidate_gate_receipt_per_job ON hyperfide.integration_gate_receipts(organisation_id,run_id,job_id,gate_id);
CREATE UNIQUE INDEX one_scope_gate_receipt_per_job ON hyperfide.integration_scope_receipts(organisation_id,run_id,job_id,gate_id);
CREATE UNIQUE INDEX one_active_scope_job ON hyperfide.integration_scope_jobs(organisation_id,run_id,level,COALESCE(wave,0)) WHERE state IN('RUNNING','OUTCOME_UNKNOWN');

-- 19.4: separate Git ref updates are never one atomic transaction. Pinned
-- outcomes stay as created; observations, recovery decisions and compensating
-- gateway publications are append-only audit history.
CREATE TABLE hyperfide.integration_release_observations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,barrier_id uuid NOT NULL,repository_id uuid NOT NULL,
 sequence bigint GENERATED ALWAYS AS IDENTITY,candidate_id uuid NOT NULL,operation_id uuid,
 outcome text NOT NULL CHECK(outcome IN ('PENDING','PUBLISHED','FAILED','UNKNOWN')),observed_head hyperfide.git_oid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,sequence),
 FOREIGN KEY(organisation_id,run_id,barrier_id,repository_id) REFERENCES hyperfide.integration_release_outcomes(organisation_id,run_id,barrier_id,repository_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id)
);
CREATE INDEX integration_release_observation_latest ON hyperfide.integration_release_observations(organisation_id,run_id,barrier_id,repository_id,sequence DESC);
CREATE TABLE hyperfide.integration_release_recoveries (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,barrier_id uuid NOT NULL,request_id uuid NOT NULL,request_digest hyperfide.digest NOT NULL,
 recovery_policy text NOT NULL CHECK(recovery_policy IN ('ADVANCE_COMPATIBLE_MANIFEST','EXPLICIT_COMPENSATING_REVISION')),
 observed_outcomes jsonb NOT NULL CHECK(jsonb_typeof(observed_outcomes)='array'),successor_barrier_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,barrier_id),UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,barrier_id) REFERENCES hyperfide.integration_release_barriers(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,successor_barrier_id) REFERENCES hyperfide.integration_release_barriers(organisation_id,run_id,id),
 CHECK((recovery_policy='ADVANCE_COMPATIBLE_MANIFEST')=(successor_barrier_id IS NOT NULL))
);
CREATE TABLE hyperfide.integration_release_compensations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,recovery_id uuid NOT NULL,repository_id uuid NOT NULL,
 compensated_head hyperfide.git_oid NOT NULL,operation_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,recovery_id,repository_id),UNIQUE(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,recovery_id) REFERENCES hyperfide.integration_release_recoveries(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.publication_operations(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_release_outcome BEFORE UPDATE OR DELETE ON hyperfide.integration_release_outcomes FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','barrier_id','repository_id','candidate_id','operation_id','outcome','observed_head');
CREATE TRIGGER immutable_release_observation BEFORE UPDATE OR DELETE ON hyperfide.integration_release_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','barrier_id','repository_id','sequence','candidate_id','operation_id','outcome','observed_head');
CREATE TRIGGER immutable_release_recovery BEFORE UPDATE OR DELETE ON hyperfide.integration_release_recoveries FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','barrier_id','request_id','request_digest','recovery_policy','observed_outcomes','successor_barrier_id');
CREATE TRIGGER immutable_release_compensation BEFORE UPDATE OR DELETE ON hyperfide.integration_release_compensations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','recovery_id','repository_id','compensated_head','operation_id');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.integration_release_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.integration_release_recoveries FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.integration_release_compensations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
