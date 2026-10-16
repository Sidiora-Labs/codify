-- Domain18 additive authority. Apply only through the migration runner (or an isolated trusted fixture).
CREATE TABLE hyperfide.finding_registry_records (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, finding_id uuid NOT NULL,
 phase text NOT NULL DEFAULT 'OPEN' CHECK (phase IN ('OPEN','TRIAGED','ASSIGNED','REPAIRING','READY_FOR_RECHECK','RESOLVED','REOPENED','DUPLICATE','NOT_REPRODUCED','ACCEPTED_EXCEPTION')),
 origin_task_id uuid NOT NULL, origin_attempt_id uuid NOT NULL,
 resolution_condition jsonb NOT NULL CHECK(jsonb_typeof(resolution_condition)='object' AND octet_length(resolution_condition::text)<=65536),
 resolution_digest hyperfide.digest NOT NULL,
 collaborator_package_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(collaborator_package_ids)='array'),
 first_observed_at timestamptz NOT NULL, last_observed_at timestamptz NOT NULL,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,finding_id),
 FOREIGN KEY(organisation_id,run_id,finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,origin_task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,origin_attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.finding_registry_reports (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, observation_id uuid NOT NULL,
 finding_id uuid NOT NULL, report_digest hyperfide.digest NOT NULL, review_receipt_id uuid NOT NULL,
 evidence_id uuid NOT NULL, observer_session_id uuid NOT NULL, report jsonb NOT NULL CHECK(jsonb_typeof(report)='object' AND octet_length(report::text)<=262144),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,observation_id),
 FOREIGN KEY(organisation_id,run_id,finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,observer_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.finding_duplicate_links (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, source_finding_id uuid NOT NULL, target_finding_id uuid NOT NULL,
 actor_id uuid NOT NULL, actor_role text NOT NULL, credential_id uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4096), evidence_ids jsonb NOT NULL CHECK(jsonb_typeof(evidence_ids)='array' AND jsonb_array_length(evidence_ids)>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,source_finding_id), CHECK(source_finding_id<>target_finding_id),
 FOREIGN KEY(organisation_id,run_id,source_finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,target_finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.finding_routes (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), finding_id uuid NOT NULL,
 request_id uuid NOT NULL, request_digest hyperfide.digest NOT NULL,
 generation bigint NOT NULL CHECK(generation>=1), owner_package_id uuid NOT NULL, owner_generation bigint,
 manager_session_id uuid, leader_queue boolean NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4096),
 collaborator_package_ids jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(collaborator_package_ids)='array'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,finding_id,generation), UNIQUE(organisation_id,run_id,request_id),
 CHECK(leader_queue OR (manager_session_id IS NOT NULL AND owner_generation IS NOT NULL)),
 FOREIGN KEY(organisation_id,run_id,finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,owner_package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,manager_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.finding_route_acknowledgements (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, route_id uuid NOT NULL, actor_id uuid NOT NULL,
 generation bigint NOT NULL, owner_generation bigint NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,route_id),
 FOREIGN KEY(organisation_id,run_id,route_id) REFERENCES hyperfide.finding_routes(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,actor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.finding_github_operations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), finding_id uuid NOT NULL,
 request_id uuid NOT NULL, payload_digest hyperfide.digest NOT NULL, operation_sequence bigint GENERATED ALWAYS AS IDENTITY,
 repository_id uuid NOT NULL, owner_name text NOT NULL CHECK(owner_name~'^[A-Za-z0-9_.-]{1,100}$'), repository_name text NOT NULL CHECK(repository_name~'^[A-Za-z0-9_.-]{1,100}$'),
 kind text NOT NULL CHECK(kind IN ('CREATE','UPDATE')), payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=524288),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','IN_FLIGHT','UNKNOWN','ACKNOWLEDGED','FAILED')),
 generation bigint NOT NULL DEFAULT 0, lease_owner uuid, lease_expires_at timestamptz,
 attempt_count bigint NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_error_code text, issue_number bigint CHECK(issue_number>0), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id)
);
CREATE UNIQUE INDEX finding_github_one_create ON hyperfide.finding_github_operations(organisation_id,run_id,finding_id) WHERE kind='CREATE';
CREATE TABLE hyperfide.finding_github_mappings (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, finding_id uuid NOT NULL, repository_id uuid NOT NULL,
 owner_name text NOT NULL, repository_name text NOT NULL, issue_number bigint NOT NULL CHECK(issue_number>0),
 external_updated_at timestamptz NOT NULL, external_state text NOT NULL CHECK(external_state IN ('open','closed')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,finding_id), UNIQUE(organisation_id,run_id,repository_id,issue_number),
 FOREIGN KEY(organisation_id,run_id,finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id)
);
CREATE TABLE hyperfide.finding_github_deliveries (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, delivery_id text NOT NULL CHECK(length(delivery_id) BETWEEN 1 AND 200),
 body_digest hyperfide.digest NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL CHECK(octet_length(payload::text)<=1048576),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','PROCESSED','FAILED')), error_code text,
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), processed_at timestamptz,
 PRIMARY KEY(organisation_id,run_id,delivery_id), FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.finding_github_checkpoints (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, repository_id uuid NOT NULL,
 owner_name text NOT NULL, repository_name text NOT NULL, updated_since timestamptz NOT NULL DEFAULT '1970-01-01T00:00:00Z',
 next_poll_at timestamptz NOT NULL DEFAULT clock_timestamp(), last_success_at timestamptz, last_error_code text,
 PRIMARY KEY(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id)
);
CREATE TABLE hyperfide.finding_external_intake (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, repository_id uuid NOT NULL, issue_number bigint NOT NULL CHECK(issue_number>0),
 external_updated_at timestamptz NOT NULL, payload jsonb NOT NULL CHECK(octet_length(payload::text)<=524288),
 state text NOT NULL DEFAULT 'NEEDS_TRIAGE' CHECK(state IN ('NEEDS_TRIAGE','LINKED','DISMISSED')), finding_id uuid,
 PRIMARY KEY(organisation_id,run_id,repository_id,issue_number),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id)
);
CREATE TABLE hyperfide.finding_repairs (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), finding_id uuid NOT NULL,
 request_id uuid NOT NULL, request_digest hyperfide.digest NOT NULL, repair_task_id uuid NOT NULL,
 resolution_digest hyperfide.digest NOT NULL, baseline_source_object_id hyperfide.git_oid NOT NULL, intended_source_object_id hyperfide.git_oid,
 state text NOT NULL DEFAULT 'REQUESTED' CHECK(state IN ('REQUESTED','RUNNING','READY_FOR_RECHECK','RESOLVED','FAILED','ESCALATED','CANCELLED')),
 max_attempts integer NOT NULL CHECK(max_attempts BETWEEN 1 AND 100), attempt_count integer NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 attempt_id uuid, attempt_generation bigint, custody_id uuid, custody_generation bigint, qualification_job_id uuid,
 resolution_evidence_ids jsonb, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repair_task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation)
);
CREATE UNIQUE INDEX finding_one_active_repair ON hyperfide.finding_repairs(organisation_id,run_id,finding_id) WHERE state IN ('REQUESTED','RUNNING','READY_FOR_RECHECK');
CREATE TABLE hyperfide.finding_repair_events (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, repair_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 actor_id uuid NOT NULL, actor_role text NOT NULL, credential_id uuid NOT NULL, event_type text NOT NULL, payload jsonb NOT NULL CHECK(octet_length(payload::text)<=524288),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repair_id) REFERENCES hyperfide.finding_repairs(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.reject_finding_history_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'finding history is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_finding_reports BEFORE UPDATE OR DELETE ON hyperfide.finding_registry_reports FOR EACH ROW EXECUTE FUNCTION hyperfide.reject_finding_history_mutation();
CREATE TRIGGER immutable_finding_duplicates BEFORE UPDATE OR DELETE ON hyperfide.finding_duplicate_links FOR EACH ROW EXECUTE FUNCTION hyperfide.reject_finding_history_mutation();
CREATE TRIGGER immutable_finding_routes BEFORE UPDATE OR DELETE ON hyperfide.finding_routes FOR EACH ROW EXECUTE FUNCTION hyperfide.reject_finding_history_mutation();
CREATE TRIGGER immutable_finding_route_acks BEFORE UPDATE OR DELETE ON hyperfide.finding_route_acknowledgements FOR EACH ROW EXECUTE FUNCTION hyperfide.reject_finding_history_mutation();
CREATE TRIGGER immutable_finding_repair_events BEFORE UPDATE OR DELETE ON hyperfide.finding_repair_events FOR EACH ROW EXECUTE FUNCTION hyperfide.reject_finding_history_mutation();
CREATE INDEX finding_pending_github ON hyperfide.finding_github_operations(organisation_id,run_id,state,next_attempt_at);
CREATE INDEX finding_reports_target ON hyperfide.finding_registry_reports(organisation_id,run_id,finding_id,recorded_at);
CREATE INDEX finding_route_latest ON hyperfide.finding_routes(organisation_id,run_id,finding_id,generation DESC);

CREATE TABLE hyperfide.finding_route_collaborators (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,route_id uuid NOT NULL,package_id uuid NOT NULL,
 manager_session_id uuid,owner_generation bigint,
 PRIMARY KEY(organisation_id,run_id,route_id,package_id),
 FOREIGN KEY(organisation_id,run_id,route_id) REFERENCES hyperfide.finding_routes(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.finding_collaborator_acknowledgements (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,route_id uuid NOT NULL,package_id uuid NOT NULL,actor_id uuid NOT NULL,owner_generation bigint NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,route_id,package_id),
 FOREIGN KEY(organisation_id,run_id,route_id,package_id) REFERENCES hyperfide.finding_route_collaborators(organisation_id,run_id,route_id,package_id)
);
CREATE TRIGGER immutable_finding_route_collaborators BEFORE UPDATE OR DELETE ON hyperfide.finding_route_collaborators FOR EACH ROW EXECUTE FUNCTION hyperfide.reject_finding_history_mutation();
CREATE TRIGGER immutable_finding_collaborator_acks BEFORE UPDATE OR DELETE ON hyperfide.finding_collaborator_acknowledgements FOR EACH ROW EXECUTE FUNCTION hyperfide.reject_finding_history_mutation();

ALTER TABLE hyperfide.finding_repairs ADD COLUMN resolution_proof jsonb;

ALTER TABLE hyperfide.finding_github_mappings ADD COLUMN external_payload_digest hyperfide.digest NOT NULL;

-- Authority changes require supported primary transaction isolation.
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['finding_registry_records','finding_registry_reports','finding_duplicate_links','finding_routes','finding_route_acknowledgements','finding_github_operations','finding_github_mappings','finding_github_deliveries','finding_github_checkpoints','finding_external_intake','finding_repairs','finding_repair_events','finding_route_collaborators','finding_collaborator_acknowledgements'] LOOP
  EXECUTE format('CREATE TRIGGER authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',tab);
 END LOOP;
END $$;
CREATE TRIGGER finding_resolution_identity BEFORE UPDATE OR DELETE ON hyperfide.finding_registry_records FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','finding_id','origin_task_id','origin_attempt_id','resolution_condition','resolution_digest','first_observed_at');
CREATE TRIGGER finding_repair_identity BEFORE UPDATE OR DELETE ON hyperfide.finding_repairs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','finding_id','request_id','request_digest','repair_task_id','resolution_digest','baseline_source_object_id','max_attempts');

CREATE TRIGGER finding_github_intent_identity BEFORE UPDATE OR DELETE ON hyperfide.finding_github_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','finding_id','request_id','payload_digest','operation_sequence','repository_id','owner_name','repository_name','kind','payload','created_at');
