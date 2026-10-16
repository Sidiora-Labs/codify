-- Lower runner primitives: no dependency on future AGENT native-session bindings
-- or recovery-policy tables. Authenticated14 observations are checked at runtime.
ALTER TABLE hyperfide.agent_sessions ALTER COLUMN native_session_id DROP NOT NULL;
DROP TRIGGER immutable_binding ON hyperfide.agent_sessions;
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.agent_sessions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','role','parent_session_id','connector','account_key','slot_id','sandbox_id','sandbox_boot_generation','attempt_id');
ALTER TABLE hyperfide.agent_sessions ADD CONSTRAINT agent_session_unattached_registered
 CHECK(native_session_id IS NOT NULL OR state='REGISTERED');
CREATE TABLE hyperfide.runner_registry (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,session_id uuid NOT NULL,
 credential_id uuid NOT NULL,sandbox_id uuid NOT NULL,boot_generation bigint NOT NULL CHECK(boot_generation>0),boot_id uuid NOT NULL,
 slot_id uuid NOT NULL,repository_id uuid,launch_id uuid,
 state_dir text NOT NULL CHECK(state_dir ~ '^/[^[:cntrl:]]+$'),runner_binary text NOT NULL CHECK(runner_binary ~ '^/[^[:cntrl:]]+$'),
 workspace_path text NOT NULL CHECK(workspace_path ~ '^/[^[:cntrl:]]+$'),runner_binary_digest hyperfide.digest NOT NULL,
 preparation_digest hyperfide.digest NOT NULL,readiness_digest hyperfide.digest NOT NULL,
 source_digest hyperfide.digest NOT NULL,source_object_id text NOT NULL,source_tree_id text NOT NULL,
 slot_generation bigint NOT NULL CHECK(slot_generation>0),uid integer NOT NULL CHECK(uid>0),gid integer NOT NULL CHECK(gid>0),
 observation_digest hyperfide.digest NOT NULL,registration_version bigint NOT NULL DEFAULT 1 CHECK(registration_version>0),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),state text NOT NULL DEFAULT'CURRENT' CHECK(state IN('CURRENT','REVOKED')),
 PRIMARY KEY(organisation_id,run_id,session_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,repository_id) REFERENCES hyperfide.repositories(organisation_id,id),
 UNIQUE(organisation_id,run_id,sandbox_id,slot_id,boot_generation)
);
CREATE TABLE hyperfide.runner_remote_jobs (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,operation_id uuid NOT NULL,session_id uuid NOT NULL,
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object'),plan_digest hyperfide.digest NOT NULL,
 principal jsonb NOT NULL CHECK(jsonb_typeof(principal)='object'),admission_digest hyperfide.digest NOT NULL,
 authority_epoch uuid NOT NULL,reservation_id uuid NOT NULL,expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT'ADMITTED' CHECK(state IN('ADMITTED','CLAIMED','COMPLETED','UNKNOWN')),
 claim_id uuid,executor_credential_id uuid,result jsonb,result_digest hyperfide.digest,result_signature text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),claimed_at timestamptz,completed_at timestamptz,
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.runner_registry(organisation_id,run_id,session_id),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id),
 CHECK(state<>'ADMITTED' OR claim_id IS NULL),CHECK(state NOT IN('CLAIMED','COMPLETED') OR claim_id IS NOT NULL),CHECK((result IS NULL)=(result_digest IS NULL)),
 CHECK(state<>'COMPLETED' OR (result IS NOT NULL AND result_signature IS NOT NULL))
);
CREATE INDEX runner_remote_jobs_dispatch ON hyperfide.runner_remote_jobs(state,created_at) WHERE state='ADMITTED';
CREATE TABLE hyperfide.runner_command_receipts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,session_id uuid NOT NULL,command_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),operation_id uuid NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),receipt_digest hyperfide.digest NOT NULL,
 observed_at timestamptz NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,session_id,command_id,generation),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.runner_registry(organisation_id,run_id,session_id)
);

-- Logical seats may be REGISTERED before an actual CLI reveals its native ID.
-- Binding is once-only; moving a process/role/boot requires a fresh logical seat.
CREATE FUNCTION hyperfide.guard_agent_native_identity() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF ROW(NEW.organisation_id,NEW.run_id,NEW.id,NEW.role,NEW.parent_session_id,NEW.connector,NEW.account_key,NEW.slot_id,NEW.sandbox_id,NEW.sandbox_boot_generation,NEW.attempt_id)
 IS DISTINCT FROM
 ROW(OLD.organisation_id,OLD.run_id,OLD.id,OLD.role,OLD.parent_session_id,OLD.connector,OLD.account_key,OLD.slot_id,OLD.sandbox_id,OLD.sandbox_boot_generation,OLD.attempt_id)
 THEN RAISE EXCEPTION 'agent identity binding is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.native_session_id IS DISTINCT FROM OLD.native_session_id
 AND (OLD.native_session_id IS NOT NULL OR OLD.state<>'REGISTERED' OR NEW.native_session_id IS NULL)
 THEN RAISE EXCEPTION 'native identity may bind once from a registered unattached seat' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER agent_native_identity BEFORE UPDATE ON hyperfide.agent_sessions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.guard_agent_native_identity();


-- Explicit scoped links retain result objects through actual artifact GC.
CREATE TABLE hyperfide.runner_result_artifacts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,operation_id uuid NOT NULL,
 role text NOT NULL CHECK(length(role)>0 AND length(role)<=128),
 artifact_id uuid NOT NULL,artifact_digest hyperfide.digest NOT NULL,
 content_digest hyperfide.digest NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>=0),
 PRIMARY KEY(organisation_id,run_id,operation_id,role),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.runner_remote_jobs(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.runner_require_complete_artifact() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE actual hyperfide.artifacts;
BEGIN
 SELECT * INTO actual FROM hyperfide.artifacts WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.artifact_id FOR SHARE;
 IF NOT FOUND OR actual.status<>'COMPLETE' OR actual.digest<>NEW.artifact_digest
 THEN RAISE EXCEPTION 'runner result requires exact COMPLETE artifact' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER complete_artifact BEFORE INSERT ON hyperfide.runner_result_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.runner_require_complete_artifact();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.runner_result_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','operation_id','role','artifact_id','artifact_digest','content_digest','size_bytes');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_registry
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_remote_jobs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_command_receipts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_result_artifacts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
