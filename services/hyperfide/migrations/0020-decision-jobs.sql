-- Decision work is advisory. Ownership and task qualification remain outside these tables.
CREATE TABLE hyperfide.decision_jobs(
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 idempotency_key uuid NOT NULL,submission_hash hyperfide.digest NOT NULL,request_hash hyperfide.digest NOT NULL,purpose hyperfide.name NOT NULL,
 packet_hash hyperfide.digest NOT NULL,packet jsonb NOT NULL,request jsonb NOT NULL,
 rubric_version text NOT NULL,route_ids jsonb NOT NULL,policy_revision text NOT NULL,consumer_id uuid NOT NULL,event_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'QUEUED' CHECK(state IN('QUEUED','RUNNING','COMPLETED','CANCELLED','EXPIRED')),
 mode text NOT NULL CHECK(mode IN('online','background')),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deadline_at timestamptz NOT NULL,lease_id uuid,lease_expires_at timestamptz,
 reserved_microusd bigint NOT NULL DEFAULT 0 CHECK(reserved_microusd>=0),state_version bigint NOT NULL DEFAULT 1,
 PRIMARY KEY(organisation_id,run_id,id),UNIQUE(organisation_id,run_id,idempotency_key),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,event_id) REFERENCES hyperfide.outbox_events(organisation_id,run_id,id),
 CHECK(jsonb_typeof(packet)='object' AND octet_length(packet::text)<=524288),
 CHECK(jsonb_typeof(request)='object' AND octet_length(request::text)<=524288),
 CHECK(jsonb_typeof(route_ids)='array' AND jsonb_array_length(route_ids) BETWEEN 1 AND 2),
 CHECK(deadline_at>created_at),
 CHECK((state='RUNNING')=(lease_id IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX decision_jobs_pending ON hyperfide.decision_jobs(organisation_id,state,deadline_at);
CREATE TRIGGER decision_job_identity BEFORE UPDATE OR DELETE ON hyperfide.decision_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','idempotency_key','submission_hash','request_hash','purpose','packet_hash','packet','request','rubric_version','route_ids','policy_revision','consumer_id','event_id','mode','created_at','deadline_at');
CREATE TRIGGER decision_job_versions BEFORE UPDATE ON hyperfide.decision_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('reserved_microusd');
CREATE TABLE hyperfide.decision_attempts(
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,decision_id uuid NOT NULL,attempt_no integer NOT NULL CHECK(attempt_no BETWEEN 1 AND 2),
 route text NOT NULL,requested_model text NOT NULL,request_body jsonb NOT NULL CHECK(octet_length(request_body::text)<=524288),request_headers jsonb NOT NULL CHECK(octet_length(request_headers::text)<=16384),configuration jsonb NOT NULL CHECK(octet_length(configuration::text)<=65536),lease_id uuid NOT NULL,started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,outcome text,metadata jsonb,
 PRIMARY KEY(organisation_id,run_id,decision_id,attempt_no),
 FOREIGN KEY(organisation_id,run_id,decision_id) REFERENCES hyperfide.decision_jobs(organisation_id,run_id,id),
 CHECK((finished_at IS NULL)=(outcome IS NULL)),CHECK(metadata IS NULL OR octet_length(metadata::text)<=196608)
);
CREATE TRIGGER decision_attempt_identity BEFORE UPDATE OR DELETE ON hyperfide.decision_attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','decision_id','attempt_no','route','requested_model','request_body','request_headers','configuration','lease_id','started_at');
CREATE FUNCTION hyperfide.decision_attempt_finished() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.finished_at IS NOT NULL AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'finished decision attempt is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER decision_attempt_once BEFORE UPDATE ON hyperfide.decision_attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.decision_attempt_finished();
CREATE TABLE hyperfide.decision_results(
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,decision_id uuid NOT NULL,packet_hash hyperfide.digest NOT NULL,
 status text NOT NULL CHECK(status IN('accepted_advice','abstained','invalid_response','unsupported','expired','cancelled','unavailable','budget_exhausted')),
 payload jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,decision_id),
 FOREIGN KEY(organisation_id,run_id,decision_id) REFERENCES hyperfide.decision_jobs(organisation_id,run_id,id),
 CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=196608)
);
CREATE TRIGGER decision_result_immutable BEFORE UPDATE OR DELETE ON hyperfide.decision_results FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','decision_id','packet_hash','status','payload','created_at');
CREATE TABLE hyperfide.decision_route_windows(
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,route text NOT NULL,minute bigint NOT NULL,sends integer NOT NULL DEFAULT 0,
 failures integer NOT NULL DEFAULT 0,open_until timestamptz,PRIMARY KEY(organisation_id,run_id,route),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);

-- Account quota groups are trusted names, shared by every run and service instance using that account.
CREATE TABLE hyperfide.decision_quota_windows(
 quota_group text PRIMARY KEY CHECK(quota_group ~ '^[A-Za-z][A-Za-z0-9._/-]{0,127}$'),
 minute bigint NOT NULL,sends integer NOT NULL DEFAULT 0 CHECK(sends>=0),
 rate_limit integer NOT NULL CHECK(rate_limit>0)
);

CREATE TRIGGER decision_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER decision_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER decision_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_results FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER decision_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_route_windows FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER decision_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_quota_windows FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
