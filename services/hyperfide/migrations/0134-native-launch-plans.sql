-- Trusted native launch plans: one immutable connector/model plan per committed scheduler dispatch.
-- A plan is admission evidence only; the 12.2 START instruction remains the sole launch path.
CREATE TABLE hyperfide.native_launch_plans (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, command_id uuid NOT NULL,
 launch_id uuid NOT NULL, agent_session_id uuid NOT NULL, slot_id uuid NOT NULL,
 attempt_id uuid NOT NULL, attempt_generation bigint NOT NULL CHECK(attempt_generation>=1),
 connector text NOT NULL CHECK(connector IN ('codex','claude')),
 connector_plan_digest hyperfide.digest NOT NULL,
 admission_reservation_id uuid NOT NULL,
 reservation_attempt integer NOT NULL CHECK(reservation_attempt BETWEEN 1 AND 32),
 admission_policy_digest hyperfide.digest NOT NULL,
 run_policy_digest hyperfide.digest NOT NULL,
 qualification_receipt_digest hyperfide.digest NOT NULL,
 packet_digest hyperfide.digest NOT NULL, payload_digest hyperfide.digest NOT NULL,
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='object' AND octet_length(plan::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,command_id),
 UNIQUE(organisation_id,run_id,launch_id),
 -- At most one launch per admitted reservation attempt: bounded retry, never a respawn loop.
 UNIQUE(organisation_id,run_id,admission_reservation_id,reservation_attempt),
 FOREIGN KEY(organisation_id,run_id,command_id) REFERENCES hyperfide.scheduler_dispatches(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,agent_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,admission_reservation_id) REFERENCES hyperfide.agent_admission_reservations(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.native_launch_plans
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','command_id','launch_id','agent_session_id','slot_id','attempt_id','attempt_generation','connector','connector_plan_digest','admission_reservation_id','reservation_attempt','admission_policy_digest','run_policy_digest','qualification_receipt_digest','packet_digest','payload_digest','plan','created_at');

-- Durable escalation records for the leader/operator. Retrying an escalated reservation requires a
-- recorded condition change; unknown process outcomes are reconciled, never retried.
CREATE TABLE hyperfide.agent_admission_escalations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 reservation_id uuid NOT NULL, session_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence BETWEEN 1 AND 64),
 reason text NOT NULL CHECK(reason IN ('RATE_LIMIT','QUOTA_LIMIT','AUTH_EXPIRED','APPROVAL_REQUIRED','UNKNOWN_OUTCOME','DELEGATION_UNSUPPORTED')),
 attempt_count integer NOT NULL CHECK(attempt_count>0),
 condition_digest hyperfide.digest,
 diagnostic_refs jsonb NOT NULL CHECK(jsonb_typeof(diagnostic_refs)='array'),
 raised_by_operation_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','RESOLVED','CLOSED')),
 resolution jsonb CHECK(resolution IS NULL OR jsonb_typeof(resolution)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_at timestamptz,
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,reservation_id,sequence),
 CHECK((state='OPEN')=(resolved_at IS NULL)),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.agent_admission_reservations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE UNIQUE INDEX agent_admission_open_escalation ON hyperfide.agent_admission_escalations(organisation_id,run_id,reservation_id) WHERE state='OPEN';
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.agent_admission_escalations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','reservation_id','session_id','sequence','reason','attempt_count','condition_digest','diagnostic_refs','raised_by_operation_id','created_at');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.native_launch_plans FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.agent_admission_escalations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
