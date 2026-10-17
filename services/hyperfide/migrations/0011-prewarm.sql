-- Eligible-work-driven remote preparation jobs. Rows reference only 0001..0008
-- tables. A job never grants readiness; only the seal step may publish a
-- provider_prepared_bases row, and only from complete retained evidence.
CREATE TABLE hyperfide.preparation_jobs (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 256),
 request_digest hyperfide.digest NOT NULL,
 pool_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 job_class text NOT NULL CHECK(job_class IN ('PREPARATION','INDEX')),
 placement_class text NOT NULL CHECK(placement_class IN ('dependency_preparation','indexing')),
 warm_spare boolean NOT NULL,
 scheduled_by uuid NOT NULL,
 scheduled_role text NOT NULL CHECK(scheduled_role IN ('LEADER','FEATURE_MANAGER')),
 eligible_count integer NOT NULL CHECK(eligible_count>=1),
 configuration_digest hyperfide.digest NOT NULL,
 preparation_digest hyperfide.digest NOT NULL,
 recipe_digest hyperfide.digest NOT NULL,
 plan_digest hyperfide.digest NOT NULL,
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object' AND octet_length(plan::text)<=524288),
 reservation_ids uuid[] NOT NULL CHECK(cardinality(reservation_ids) BETWEEN 1 AND 32),
 physical_reservation_ids uuid[] NOT NULL CHECK(cardinality(physical_reservation_ids) BETWEEN 1 AND 32),
 intent_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','RUNNING','AWAITING_REMOTE','RETRY_WAIT','SEALED','FAILED','OBSOLETE')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 16),
 backoff_base_ms integer NOT NULL CHECK(backoff_base_ms BETWEEN 1 AND 3600000),
 backoff_max_ms integer NOT NULL CHECK(backoff_max_ms BETWEEN 1 AND 86400000),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 prepared_base_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,id),
 UNIQUE(organisation_id,run_id,request_key),
 UNIQUE(organisation_id,intent_id),
 CHECK(attempts<=max_attempts),
 CHECK(backoff_base_ms<=backoff_max_ms),
 CHECK((state='SEALED')=(prepared_base_id IS NOT NULL)),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id),
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 FOREIGN KEY(organisation_id,run_id,intent_id) REFERENCES hyperfide.provisioning_intents(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,prepared_base_id) REFERENCES hyperfide.provider_prepared_bases(organisation_id,id)
);
CREATE INDEX preparation_jobs_active ON hyperfide.preparation_jobs(organisation_id,run_id,pool_id,profile_id,job_class,state);

-- One row per remote attempt. Diagnostics are retained in full and bound to a
-- COMPLETE artifacts row by digest; a finished attempt is immutable.
CREATE TABLE hyperfide.preparation_job_attempts (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 job_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt>=1),
 outcome text NOT NULL DEFAULT 'RUNNING' CHECK(outcome IN ('RUNNING','SUCCEEDED','RETRYABLE_FAILURE','FAILED','OBSOLETE')),
 failure_class text CHECK(failure_class IN ('PROVIDER_UNAVAILABLE','PROVIDER_FAILED','PACKAGE_FAILURE','PARTIAL_DOWNLOAD','READINESS_FAILED','OBSOLETE_MANIFEST')),
 diagnostics jsonb CHECK(diagnostics IS NULL OR (jsonb_typeof(diagnostics)='object' AND octet_length(diagnostics::text)<=262144)),
 diagnostics_artifact_digest hyperfide.digest,
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 PRIMARY KEY(organisation_id,run_id,job_id,attempt),
 CHECK((outcome='RUNNING')=(finished_at IS NULL)),
 CHECK((outcome IN ('RUNNING','SUCCEEDED'))=(failure_class IS NULL)),
 CHECK(outcome='RUNNING' OR (diagnostics IS NOT NULL AND diagnostics_artifact_digest IS NOT NULL)),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.preparation_jobs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,diagnostics_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest)
);
CREATE FUNCTION hyperfide.preparation_attempt_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.outcome<>'RUNNING' THEN
  RAISE EXCEPTION 'Finished preparation attempts and their diagnostics are immutable';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['outcome','failure_class','diagnostics','diagnostics_artifact_digest','finished_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['outcome','failure_class','diagnostics','diagnostics_artifact_digest','finished_at']) THEN
  RAISE EXCEPTION 'Preparation attempt identity is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preparation_attempt_immutable BEFORE UPDATE OR DELETE ON hyperfide.preparation_job_attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.preparation_attempt_immutable();
CREATE FUNCTION hyperfide.preparation_job_terminal() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Preparation jobs are retained'; END IF;
 IF OLD.state IN ('SEALED','FAILED','OBSOLETE') THEN
  RAISE EXCEPTION 'Terminal preparation jobs are immutable';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','attempts','next_attempt_at','prepared_base_id','updated_at','state_version']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','attempts','next_attempt_at','prepared_base_id','updated_at','state_version']) THEN
  RAISE EXCEPTION 'Preparation job plan, identity and reservations are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER preparation_job_terminal BEFORE UPDATE OR DELETE ON hyperfide.preparation_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.preparation_job_terminal();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.preparation_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.preparation_job_attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
