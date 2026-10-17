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

-- A lost worker creates durable recovery work even while execution adapters are unavailable.
CREATE TABLE hyperfide.recovery_replacement_requests (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 task_id uuid NOT NULL,source_attempt_id uuid NOT NULL,source_attempt_generation bigint NOT NULL CHECK(source_attempt_generation>0),
 source_boot_generation bigint NOT NULL CHECK(source_boot_generation>0),authority_epoch uuid NOT NULL,
 state text NOT NULL DEFAULT 'WAITING_INVENTORY' CHECK(state IN ('WAITING_INVENTORY','HELD','RESTORING','READY','OUTCOME_UNKNOWN','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>0),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,id) REFERENCES hyperfide.recovery_operations(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,source_attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id)
);
CREATE INDEX recovery_replacement_pending ON hyperfide.recovery_replacement_requests(organisation_id,run_id,state) WHERE state NOT IN ('READY','CANCELLED');
CREATE FUNCTION hyperfide.guard_recovery_replacement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Recovery requests retain immutable loss provenance'; END IF;
 IF (NEW.organisation_id,NEW.run_id,NEW.id,NEW.task_id,NEW.source_attempt_id,NEW.source_attempt_generation,NEW.source_boot_generation,NEW.authority_epoch,NEW.created_at)
 IS DISTINCT FROM (OLD.organisation_id,OLD.run_id,OLD.id,OLD.task_id,OLD.source_attempt_id,OLD.source_attempt_generation,OLD.source_boot_generation,OLD.authority_epoch,OLD.created_at)
 THEN RAISE EXCEPTION 'Recovery loss provenance is immutable'; END IF;
 IF NEW.state_version<>OLD.state_version+1 THEN RAISE EXCEPTION 'Recovery request version must advance exactly once'; END IF;
 IF OLD.state IN ('READY','CANCELLED') AND NEW.state<>OLD.state THEN RAISE EXCEPTION 'Terminal recovery request cannot reopen'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER recovery_replacement_guard BEFORE UPDATE OR DELETE ON hyperfide.recovery_replacement_requests FOR EACH ROW EXECUTE FUNCTION hyperfide.guard_recovery_replacement();
-- Restoration binds one compatible checkpoint to one new attempt identity; outputs are append-only provenance.
ALTER TABLE hyperfide.recovery_replacement_requests
 ADD COLUMN checkpoint_id uuid,
 ADD COLUMN replacement_attempt_id uuid,
 ADD COLUMN replacement_attempt_generation bigint CHECK(replacement_attempt_generation>1),
 ADD COLUMN hold_reason text CHECK(length(hold_reason) BETWEEN 1 AND 1024),
 ADD COLUMN restoration_digest hyperfide.digest,
 ADD COLUMN restoration jsonb CHECK(jsonb_typeof(restoration)='object' AND octet_length(restoration::text)<=262144),
 ADD COLUMN enrollment jsonb CHECK(jsonb_typeof(enrollment)='object' AND octet_length(enrollment::text)<=16384),
 ADD COLUMN outputs jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(outputs)='array' AND jsonb_array_length(outputs)<=256 AND octet_length(outputs::text)<=262144),
 ADD CONSTRAINT recovery_replacement_ready_bound CHECK(state NOT IN ('RESTORING','READY') OR (checkpoint_id IS NOT NULL AND replacement_attempt_id IS NOT NULL AND replacement_attempt_generation>source_attempt_generation)),
 ADD CONSTRAINT recovery_replacement_held_reason CHECK(state<>'HELD' OR hold_reason IS NOT NULL),
 ADD CONSTRAINT recovery_replacement_enrolled_ready CHECK(enrollment IS NULL OR state='READY'),
 ADD CONSTRAINT recovery_replacement_attempt FOREIGN KEY(organisation_id,run_id,replacement_attempt_id,replacement_attempt_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation),
 ADD CONSTRAINT recovery_replacement_checkpoint FOREIGN KEY(organisation_id,run_id,checkpoint_id) REFERENCES hyperfide.checkpoints(organisation_id,run_id,id);
CREATE UNIQUE INDEX recovery_replacement_one_owner ON hyperfide.recovery_replacement_requests(organisation_id,run_id,replacement_attempt_id) WHERE replacement_attempt_id IS NOT NULL;
CREATE FUNCTION hyperfide.guard_recovery_replacement_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.replacement_attempt_id IS NOT NULL AND (NEW.replacement_attempt_id,NEW.replacement_attempt_generation,NEW.checkpoint_id,NEW.restoration_digest,NEW.restoration)
 IS DISTINCT FROM (OLD.replacement_attempt_id,OLD.replacement_attempt_generation,OLD.checkpoint_id,OLD.restoration_digest,OLD.restoration)
 THEN RAISE EXCEPTION 'Recovery replacement binding is immutable'; END IF;
 IF OLD.enrollment IS NOT NULL AND NEW.enrollment IS DISTINCT FROM OLD.enrollment THEN RAISE EXCEPTION 'Recovery enrollment is immutable'; END IF;
 IF jsonb_array_length(NEW.outputs)<jsonb_array_length(OLD.outputs) THEN RAISE EXCEPTION 'Recovery output provenance is append-only'; END IF;
 FOR i IN 0..jsonb_array_length(OLD.outputs)-1 LOOP
  IF NEW.outputs->i IS DISTINCT FROM OLD.outputs->i THEN RAISE EXCEPTION 'Recovery output provenance is append-only'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
CREATE TRIGGER recovery_replacement_binding BEFORE UPDATE ON hyperfide.recovery_replacement_requests FOR EACH ROW EXECUTE FUNCTION hyperfide.guard_recovery_replacement_binding();

-- Accepted-run rebind is separate from global activation and grants no dispatch.
CREATE TABLE hyperfide.recovery_accepted_run_intents (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,recovery_operation_id uuid NOT NULL,
 activation_operation_id uuid NOT NULL,deployment_id uuid NOT NULL,source_epoch uuid NOT NULL,target_epoch uuid NOT NULL,
 spec_generation bigint NOT NULL CHECK(spec_generation>0),spec_revision_id uuid NOT NULL,
 revision_digest hyperfide.digest NOT NULL,fence_proof_digest hyperfide.digest NOT NULL,
 external_journal_sequence bigint NOT NULL CHECK(external_journal_sequence>0),
 intent_digest hyperfide.digest NOT NULL,intent jsonb NOT NULL CHECK(jsonb_typeof(intent)='object' AND octet_length(intent::text)<=16384),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,recovery_operation_id),
 UNIQUE(organisation_id,run_id,target_epoch),
 FOREIGN KEY(organisation_id,run_id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id),
 CHECK(source_epoch<>target_epoch)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.recovery_accepted_run_intents FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','recovery_operation_id','activation_operation_id','deployment_id','source_epoch','target_epoch','spec_generation','spec_revision_id','revision_digest','fence_proof_digest','external_journal_sequence','intent_digest','intent','created_at');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.recovery_controls FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.recovery_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.recovery_resource_debts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.recovery_drill_runs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.recovery_replacement_requests FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.recovery_accepted_run_intents FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- Revocation retains physical custody; these references never assert cleanup.
CREATE TABLE hyperfide.recovery_accepted_run_debts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,recovery_operation_id uuid NOT NULL,
 reference text NOT NULL CHECK(length(reference) BETWEEN 1 AND 512),source_epoch uuid NOT NULL,target_epoch uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,recovery_operation_id,reference),
 FOREIGN KEY(organisation_id,run_id,recovery_operation_id) REFERENCES hyperfide.recovery_accepted_run_intents(organisation_id,run_id,recovery_operation_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.recovery_accepted_run_debts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','recovery_operation_id','reference','source_epoch','target_epoch','created_at');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.recovery_accepted_run_debts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- Task24.4 (additive): measured drill reconciliation evidence gates any resumption of drill-scoped authority.
ALTER TABLE hyperfide.recovery_drill_runs ADD COLUMN reconciliation jsonb CHECK(reconciliation IS NULL OR (jsonb_typeof(reconciliation)='object' AND octet_length(reconciliation::text)<=8192));
ALTER TABLE hyperfide.recovery_drill_runs ADD COLUMN resume_state text NOT NULL DEFAULT 'BLOCKED' CHECK(resume_state IN ('BLOCKED','RECONCILED'));
ALTER TABLE hyperfide.recovery_drill_runs ADD CONSTRAINT recovery_drill_resume_requires_measurement CHECK(resume_state<>'RECONCILED' OR (state='MEASURED' AND reconciliation IS NOT NULL));
