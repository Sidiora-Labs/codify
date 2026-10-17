-- Domain23 durable observability. Applied by the trusted migration runner; no transaction wrapper.
CREATE TABLE hyperfide.observability_observations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,entity_type text NOT NULL CHECK(entity_type IN ('ATTEMPT','SESSION','SANDBOX')),
 entity_id uuid NOT NULL,observer_actor_id uuid NOT NULL,entity_generation bigint NOT NULL CHECK(entity_generation>=1),
 producer_sequence bigint NOT NULL CHECK(producer_sequence>=1),observed_state text NOT NULL CHECK(observed_state IN ('RUNNING','STOPPED','QUIESCENT','FAILED','UNREACHABLE','UNKNOWN')),
 observed_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),source_digest hyperfide.digest NOT NULL,
 source_artifact_id uuid,activity_bytes bigint NOT NULL DEFAULT 0 CHECK(activity_bytes>=0),state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,entity_type,entity_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,source_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.observability_resource_profiles (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,profile_key hyperfide.name NOT NULL,revision bigint NOT NULL CHECK(revision>=1),
 profile_digest hyperfide.digest NOT NULL,declared_agents_per_sandbox integer NOT NULL CHECK(declared_agents_per_sandbox BETWEEN 0 AND 1000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,profile_key,revision),UNIQUE(organisation_id,run_id,profile_digest),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.observability_resource_limits (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,profile_id uuid NOT NULL,
 dimension text NOT NULL CHECK(dimension IN ('SANDBOX','AGENT_SESSION','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES','BUILD','LINK','TEST','EXCLUSIVE_SERVICE','INDEX','MODEL_REQUEST','MODEL_TOKEN','PROVIDER_API')),
 configured_limit numeric(30,6) NOT NULL CHECK(configured_limit>=0),declared_reservation numeric(30,6) NOT NULL CHECK(declared_reservation>=0 AND declared_reservation<=configured_limit),
 unit hyperfide.name NOT NULL,PRIMARY KEY(organisation_id,run_id,profile_id,dimension),
 FOREIGN KEY(organisation_id,run_id,profile_id) REFERENCES hyperfide.observability_resource_profiles(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.observability_resource_samples (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,profile_id uuid NOT NULL,subject_id uuid NOT NULL,dimension text NOT NULL,
 value numeric(30,6) NOT NULL CHECK(value>=0),observed_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 producer_sequence bigint NOT NULL CHECK(producer_sequence>=1),producer_actor_id uuid NOT NULL,
 origin text NOT NULL CHECK(origin IN ('HOST_COLLECTOR','PROVIDER_REPORT','REPLAY')),source_digest hyperfide.digest NOT NULL,source_artifact_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,run_id,profile_id,subject_id,dimension),
 FOREIGN KEY(organisation_id,run_id,profile_id,dimension) REFERENCES hyperfide.observability_resource_limits(organisation_id,run_id,profile_id,dimension),
 FOREIGN KEY(organisation_id,run_id,source_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.observability_metric_series (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,name hyperfide.name NOT NULL,phase hyperfide.name NOT NULL,
 profile_key hyperfide.name NOT NULL,variant text NOT NULL CHECK(variant IN ('BASELINE','CURRENT')),unit text NOT NULL CHECK(unit IN ('milliseconds','bytes','count','microcurrency')),
 currency text CHECK(currency IS NULL OR currency ~ '^[A-Z]{3}$'),provenance_digest hyperfide.digest NOT NULL,
 bucket_bounds jsonb NOT NULL CHECK(jsonb_typeof(bucket_bounds)='array' AND jsonb_array_length(bucket_bounds) BETWEEN 1 AND 32),
 PRIMARY KEY(organisation_id,run_id,id),UNIQUE(organisation_id,run_id,name,phase,profile_key,variant,provenance_digest),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.observability_metric_buckets (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,series_id uuid NOT NULL,bucket_start timestamptz NOT NULL,
 sample_count bigint NOT NULL CHECK(sample_count>=1),value_sum numeric(30,6) NOT NULL CHECK(value_sum>=0),
 value_min numeric(30,6) NOT NULL CHECK(value_min>=0),value_max numeric(30,6) NOT NULL CHECK(value_max>=value_min),
 histogram jsonb NOT NULL CHECK(jsonb_typeof(histogram)='array' AND jsonb_array_length(histogram) BETWEEN 2 AND 33),
 first_observed_at timestamptz NOT NULL,last_observed_at timestamptz NOT NULL CHECK(last_observed_at>=first_observed_at),
 PRIMARY KEY(organisation_id,run_id,series_id,bucket_start),FOREIGN KEY(organisation_id,run_id,series_id) REFERENCES hyperfide.observability_metric_series(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.observability_metric_receipts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,series_id uuid NOT NULL,payload_digest hyperfide.digest NOT NULL,
 source_artifact_id uuid NOT NULL,bucket_start timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),FOREIGN KEY(organisation_id,run_id,series_id) REFERENCES hyperfide.observability_metric_series(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,source_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.observability_notifications (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,target_session_id uuid NOT NULL,target_consumer_id uuid NOT NULL,
 dedup_key hyperfide.digest NOT NULL,payload_digest hyperfide.digest NOT NULL,severity text NOT NULL CHECK(severity IN ('INFO','WARNING','ERROR','CRITICAL')),
 code hyperfide.name NOT NULL,untrusted_summary text NOT NULL CHECK(length(untrusted_summary) BETWEEN 1 AND 512),
 action_code text NOT NULL CHECK(action_code IN ('INSPECT_EVIDENCE','RECONCILE_RESOURCE','RETRY_OPERATION','REPAIR_TASK','ROTATE_CREDENTIAL','PAUSE_ADMISSION')),
 artifact_id uuid NOT NULL,event_id uuid NOT NULL,state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN ('QUEUED','ENQUEUED','ACKNOWLEDGED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),enqueued_at timestamptz,state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),UNIQUE(organisation_id,run_id,target_session_id,dedup_key),
 UNIQUE(organisation_id,run_id,event_id),FOREIGN KEY(organisation_id,run_id,target_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,target_consumer_id) REFERENCES hyperfide.event_consumers(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.observability_notification_budgets (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,target_session_id uuid NOT NULL,window_start timestamptz NOT NULL,
 page_count integer NOT NULL CHECK(page_count BETWEEN 0 AND 100),PRIMARY KEY(organisation_id,run_id,target_session_id,window_start),
 FOREIGN KEY(organisation_id,run_id,target_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE INDEX observability_notifications_pending ON hyperfide.observability_notifications(organisation_id,run_id,target_session_id,created_at,id) WHERE state='QUEUED';
CREATE INDEX observability_metrics_window ON hyperfide.observability_metric_buckets(organisation_id,run_id,bucket_start);
CREATE INDEX observability_receipts_retention ON hyperfide.observability_metric_receipts(organisation_id,run_id,received_at);
-- Immutable identities and payload links retain historical applicability; counters/observations have explicit update protocols.
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.observability_resource_profiles FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','profile_key','revision','profile_digest','declared_agents_per_sandbox');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.observability_resource_limits FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','profile_id','dimension','configured_limit','declared_reservation','unit');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.observability_metric_series FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','name','phase','profile_key','variant','unit','currency','provenance_digest','bucket_bounds');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.observability_metric_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','series_id','payload_digest','source_artifact_id','bucket_start','received_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.observability_notifications FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','target_session_id','target_consumer_id','dedup_key','payload_digest','severity','code','untrusted_summary','action_code','artifact_id','event_id','created_at');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.observability_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('entity_generation');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.observability_notifications FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();

ALTER TABLE hyperfide.observability_observations ADD COLUMN observer_priority integer NOT NULL CHECK(observer_priority BETWEEN 1 AND 4);
ALTER TABLE hyperfide.observability_notifications ADD COLUMN target_boot_generation bigint CHECK(target_boot_generation IS NULL OR target_boot_generation>=1);
CREATE FUNCTION hyperfide.observability_add_histogram(a jsonb,b jsonb) RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog,hyperfide AS $$
DECLARE result jsonb:='[]'::jsonb;i integer;
BEGIN
 IF jsonb_typeof(a)<>'array' OR jsonb_typeof(b)<>'array' OR jsonb_array_length(a)<>jsonb_array_length(b) OR jsonb_array_length(a) NOT BETWEEN 2 AND 33 THEN RAISE EXCEPTION 'histogram shape mismatch' USING ERRCODE='23514'; END IF;
 FOR i IN 0..jsonb_array_length(a)-1 LOOP result=result||jsonb_build_array(((a->>i)::bigint+(b->>i)::bigint)::text); END LOOP;
 RETURN result;
END $$;
CREATE FUNCTION hyperfide.observability_artifact_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE artifact uuid;
BEGIN
 artifact=(to_jsonb(NEW)->>(CASE WHEN TG_TABLE_NAME='observability_notifications' THEN 'artifact_id' ELSE 'source_artifact_id' END))::uuid;
 IF artifact IS NOT NULL THEN PERFORM hyperfide.require_complete_artifact(NEW.organisation_id,NEW.run_id,artifact); END IF;RETURN NEW;
END $$;
CREATE FUNCTION hyperfide.protect_notification_evidence() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF TG_OP='DELETE' OR (OLD.status='COMPLETE' AND NEW.status<>'COMPLETE') THEN
  IF EXISTS(SELECT 1 FROM hyperfide.observability_notifications WHERE organisation_id=OLD.organisation_id AND run_id=OLD.run_id AND artifact_id=OLD.id AND state IN ('QUEUED','ENQUEUED')) THEN RAISE EXCEPTION 'pending notification retains complete evidence' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER protect_notification_evidence BEFORE UPDATE OR DELETE ON hyperfide.artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_notification_evidence();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_resource_profiles FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_resource_limits FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_resource_samples FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_metric_series FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_metric_buckets FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_metric_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_notifications FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.observability_notification_budgets FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER artifact_binding BEFORE INSERT OR UPDATE ON hyperfide.observability_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.observability_artifact_binding();

CREATE TRIGGER artifact_binding BEFORE INSERT OR UPDATE ON hyperfide.observability_resource_samples FOR EACH ROW EXECUTE FUNCTION hyperfide.observability_artifact_binding();

CREATE TRIGGER artifact_binding BEFORE INSERT OR UPDATE ON hyperfide.observability_metric_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.observability_artifact_binding();

CREATE TRIGGER artifact_binding BEFORE INSERT OR UPDATE ON hyperfide.observability_notifications FOR EACH ROW EXECUTE FUNCTION hyperfide.observability_artifact_binding();

ALTER TABLE hyperfide.observability_metric_series ADD COLUMN measurement_kind text NOT NULL CHECK(measurement_kind IN ('MEASUREMENT_REPORT','PROVIDER_INVOICE_REPORT','REPLAY'));
CREATE TRIGGER immutable_measurement_kind BEFORE UPDATE ON hyperfide.observability_metric_series FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('measurement_kind');

ALTER TABLE hyperfide.observability_resource_profiles ADD COLUMN publisher_actor_id uuid NOT NULL;
ALTER TABLE hyperfide.observability_resource_limits ADD COLUMN window_ms integer;
ALTER TABLE hyperfide.observability_resource_limits ADD CONSTRAINT resource_rate_window CHECK(
 (dimension IN ('MODEL_REQUEST','MODEL_TOKEN','PROVIDER_API') AND window_ms BETWEEN 1 AND 86400000) OR
 (dimension NOT IN ('MODEL_REQUEST','MODEL_TOKEN','PROVIDER_API') AND window_ms IS NULL));
ALTER TABLE hyperfide.observability_metric_receipts ADD COLUMN producer_actor_id uuid NOT NULL;
ALTER TABLE hyperfide.observability_notifications ADD COLUMN producer_actor_id uuid NOT NULL;
CREATE TRIGGER immutable_publisher BEFORE UPDATE ON hyperfide.observability_resource_profiles FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('publisher_actor_id');
CREATE TRIGGER immutable_rate_window BEFORE UPDATE ON hyperfide.observability_resource_limits FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('window_ms');
CREATE TRIGGER immutable_producer BEFORE UPDATE ON hyperfide.observability_metric_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('producer_actor_id');
CREATE TRIGGER immutable_producer BEFORE UPDATE ON hyperfide.observability_notifications FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('producer_actor_id');
