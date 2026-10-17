-- Native context lineage supplements admitted agent_sessions; it never grants task authority.
CREATE TABLE hyperfide.native_session_bindings (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 session_id uuid NOT NULL,
 connector_version text NOT NULL CHECK(length(connector_version) BETWEEN 1 AND 64),
 auth_profile text NOT NULL CHECK(auth_profile ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$'),
 configuration_digest hyperfide.digest NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 process_id integer NOT NULL CHECK(process_id>0),
 process_start_time text NOT NULL CHECK(process_start_time ~ '^[1-9][0-9]{0,19}$'),
 boot_id uuid NOT NULL,
 process_exited boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,session_id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.native_session_bindings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','session_id','connector_version','auth_profile','configuration_digest','source_manifest_digest','process_id','process_start_time','boot_id','created_at');
CREATE TABLE hyperfide.native_session_checkpoints (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, session_id uuid NOT NULL,
 checkpoint_id uuid NOT NULL,
 checkpoint_digest hyperfide.digest NOT NULL,
 manifest_digest hyperfide.digest NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 configuration_digest hyperfide.digest NOT NULL,
 native_session_id text NOT NULL CHECK(length(native_session_id) BETWEEN 1 AND 255),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,session_id,checkpoint_id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.native_session_bindings(organisation_id,run_id,session_id),
 FOREIGN KEY(organisation_id,run_id,checkpoint_id) REFERENCES hyperfide.checkpoints(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.native_session_checkpoints
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','session_id','checkpoint_id','checkpoint_digest','manifest_digest','source_manifest_digest','configuration_digest','native_session_id','created_at');
CREATE TABLE hyperfide.native_session_events (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, session_id uuid NOT NULL,
 operation_id uuid NOT NULL, payload_digest hyperfide.digest NOT NULL,
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.native_session_bindings(organisation_id,run_id,session_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.native_session_events
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','session_id','operation_id','payload_digest','result','created_at');
-- Quota records are separate from provider allocation and accepted task ownership.
CREATE TABLE hyperfide.agent_admission_accounts (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, quota_key text NOT NULL,
 policy_digest hyperfide.digest NOT NULL,
 max_concurrent integer NOT NULL CHECK(max_concurrent BETWEEN 1 AND 10000),
 active integer NOT NULL DEFAULT 0 CHECK(active>=0 AND active<=max_concurrent),
 PRIMARY KEY(organisation_id,run_id,quota_key),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.agent_admission_reservations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 quota_key text NOT NULL, session_id uuid NOT NULL,
 payload_digest hyperfide.digest NOT NULL, policy_digest hyperfide.digest NOT NULL,
 state text NOT NULL CHECK(state IN('RESERVED','RETRY_WAIT','RELEASED','ESCALATED')),
 attempt_count integer NOT NULL DEFAULT 1 CHECK(attempt_count>0),
 retry_after timestamptz,
 reason text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,quota_key) REFERENCES hyperfide.agent_admission_accounts(organisation_id,run_id,quota_key),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE UNIQUE INDEX agent_admission_active_session ON hyperfide.agent_admission_reservations(organisation_id,run_id,session_id) WHERE state IN('RESERVED','RETRY_WAIT','ESCALATED');

-- A committed launch intent is never replayed after the exec boundary.
CREATE TABLE hyperfide.supervisor_launches (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,session_id uuid NOT NULL,
 profile_id text NOT NULL,profile_digest hyperfide.digest NOT NULL,request_digest hyperfide.digest NOT NULL,
 host_id text NOT NULL,placement jsonb NOT NULL,reservations jsonb NOT NULL,
 state text NOT NULL CHECK(state IN ('STARTING','SPAWNING','RUNNING','EXITED')),
 process_identity jsonb,native_session_id text,exit_code integer,observed_at timestamptz,
 output_sequence bigint NOT NULL DEFAULT 0 CHECK(output_sequence>=0),pending_stdout text NOT NULL DEFAULT '' CHECK(octet_length(pending_stdout)<=87384),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE UNIQUE INDEX supervisor_launch_once ON hyperfide.supervisor_launches(organisation_id,run_id,session_id) WHERE state IN ('STARTING','SPAWNING','RUNNING');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.supervisor_launches FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','session_id','profile_id','profile_digest','request_digest','host_id','placement','reservations');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.supervisor_launches FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.native_session_bindings FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.native_session_checkpoints FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.native_session_events FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.agent_admission_accounts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.agent_admission_reservations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- Resumed work is a new admitted session linked to exactly one named predecessor checkpoint and persisted resume decision.
CREATE TABLE hyperfide.native_session_resumptions (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, session_id uuid NOT NULL,
 predecessor_session_id uuid NOT NULL, checkpoint_id uuid NOT NULL, resume_operation_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN('ELIGIBLE_NATIVE_CONTEXT','FRESH_HANDOFF_REQUIRED')),
 native_qualification_digest hyperfide.digest,
 resumed_native_session_id text NOT NULL CHECK(length(resumed_native_session_id) BETWEEN 1 AND 255),
 native_session_id text NOT NULL CHECK(length(native_session_id) BETWEEN 1 AND 255),
 source_manifest_digest hyperfide.digest NOT NULL, configuration_digest hyperfide.digest NOT NULL,
 process_id integer NOT NULL CHECK(process_id>0),
 process_start_time text NOT NULL CHECK(process_start_time ~ '^[1-9][0-9]{0,19}$'),
 boot_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,session_id),
 UNIQUE(organisation_id,run_id,predecessor_session_id),
 UNIQUE(organisation_id,run_id,resume_operation_id),
 CHECK(session_id<>predecessor_session_id),
 CHECK((decision='ELIGIBLE_NATIVE_CONTEXT')=(native_qualification_digest IS NOT NULL)),
 CHECK((decision='ELIGIBLE_NATIVE_CONTEXT')=(native_session_id=resumed_native_session_id)),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.native_session_bindings(organisation_id,run_id,session_id),
 FOREIGN KEY(organisation_id,run_id,predecessor_session_id,checkpoint_id) REFERENCES hyperfide.native_session_checkpoints(organisation_id,run_id,session_id,checkpoint_id),
 FOREIGN KEY(organisation_id,run_id,resume_operation_id) REFERENCES hyperfide.native_session_events(organisation_id,run_id,operation_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.native_session_resumptions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','session_id','predecessor_session_id','checkpoint_id','resume_operation_id','decision','native_qualification_digest','resumed_native_session_id','native_session_id','source_manifest_digest','configuration_digest','process_id','process_start_time','boot_id','created_at');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.native_session_resumptions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
