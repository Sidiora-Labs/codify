-- Extend the initial lifecycle without changing its historical migration bytes.
ALTER TABLE hyperfide.runs DROP CONSTRAINT runs_state_check;
ALTER TABLE hyperfide.runs ADD CONSTRAINT runs_state_check CHECK(state IN ('PLANNED','PENDING_VALIDATION','READY','RUNNING','PAUSING','PAUSED','DRAINING','DRAINED','CANCELLING','STOPPING','STOPPED','SUCCEEDED','FAILED','CANCELLED'));
-- Recovery state is separate from compute leases, submission custody, and external outcomes.
CREATE TABLE hyperfide.recovery_controls (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL,
 scope_kind text NOT NULL CHECK(scope_kind IN ('RUN','PACKAGE','ATTEMPT','SANDBOX')),
 scope_id uuid NOT NULL, mode text NOT NULL CHECK(mode IN ('PAUSE','DRAIN','CANCEL','STOP')),
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
 status text NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','COMPLETE')),
 authority_epoch uuid NOT NULL, reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 1024),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deadline_at timestamptz, fallback_mode text CHECK(fallback_mode IN ('PAUSE','STOP')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,scope_kind,scope_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 CHECK(scope_kind<>'RUN' OR scope_id=run_id),
 CHECK(mode<>'DRAIN' OR (deadline_at>accepted_at AND fallback_mode IS NOT NULL))
);
CREATE TABLE hyperfide.recovery_operations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, operation_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('CONTROL_RECOVER','WORKER_LOSS','STOP','STOP_RECONCILE','RESUME','DRILL')),
 input_digest hyperfide.digest NOT NULL, authority_epoch uuid NOT NULL,
 state text NOT NULL CHECK(state IN ('PENDING','APPLIED','OUTCOME_UNKNOWN','RECONCILED','REFUSED')),
 result jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(result)='object' AND octet_length(result::text)<=1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.recovery_resource_debts (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL, resource_kind text NOT NULL CHECK(resource_kind IN ('SUPERVISOR','SANDBOX','GIT','ARTIFACT','AUTHORITY','QUALIFICATION','CHECKPOINT')),
 resource_id uuid NOT NULL, sandbox_boot_generation bigint CHECK(sandbox_boot_generation>0),
 command_id uuid NOT NULL DEFAULT gen_random_uuid(),
 command_generation bigint NOT NULL DEFAULT 1 CHECK(command_generation>0),
 status text NOT NULL DEFAULT 'OPEN' CHECK(status IN ('OPEN','RECONCILING','RESOLVED')),
 desired_state text NOT NULL CHECK(length(desired_state) BETWEEN 1 AND 64),
 observed_state text NOT NULL DEFAULT 'UNKNOWN' CHECK(length(observed_state) BETWEEN 1 AND 64),
 evidence_digest hyperfide.digest,
 observed_at timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 resolved_at timestamptz, detail text NOT NULL CHECK(length(detail)<=1024),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,operation_id,resource_kind,resource_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.recovery_operations(organisation_id,run_id,operation_id),
 CHECK((status='RESOLVED')=(resolved_at IS NOT NULL)),
 CHECK(status<>'RESOLVED' OR (observed_at IS NOT NULL AND evidence_digest IS NOT NULL))
);
CREATE INDEX recovery_debts_open ON hyperfide.recovery_resource_debts(organisation_id,run_id,status) WHERE status<>'RESOLVED';
CREATE TABLE hyperfide.recovery_drill_runs (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, operation_id uuid NOT NULL,
 scenario text NOT NULL CHECK(scenario IN ('DATABASE','OBJECT','GIT','PROVIDER','AUTH','FULL_DISK','RESTORE')),
 source_epoch uuid NOT NULL, recovery_epoch uuid,
 proposed_rpo_ms bigint NOT NULL CHECK(proposed_rpo_ms>=0),
 proposed_rto_ms bigint NOT NULL CHECK(proposed_rto_ms>=0),
 state text NOT NULL DEFAULT 'PROPOSED' CHECK(state IN ('PROPOSED','RUNNING','MEASURED','FAILED','UNKNOWN')),
 started_at timestamptz, completed_at timestamptz,
 measured_rto_ms bigint CHECK(measured_rto_ms>=0),
 acknowledged_count bigint CHECK(acknowledged_count>=0),
 recovered_count bigint CHECK(recovered_count>=0),
 acknowledged_loss_count bigint CHECK(acknowledged_loss_count>=0),
 evidence_digest hyperfide.digest, limits text NOT NULL CHECK(length(limits)<=2048),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.recovery_operations(organisation_id,run_id,operation_id),
 CHECK(state<>'MEASURED' OR (started_at IS NOT NULL AND completed_at>=started_at AND measured_rto_ms IS NOT NULL AND evidence_digest IS NOT NULL AND acknowledged_count IS NOT NULL AND recovered_count IS NOT NULL AND acknowledged_loss_count IS NOT NULL)),
 CHECK(scenario<>'RESTORE' OR state<>'MEASURED' OR (recovery_epoch IS NOT NULL AND recovery_epoch<>source_epoch))
);
