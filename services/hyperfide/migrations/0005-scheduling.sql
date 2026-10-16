-- Scheduling state is metadata; external process liveness is never inferred from TTL.
ALTER TABLE hyperfide.capacity_accounts DROP CONSTRAINT capacity_accounts_dimension_check;
ALTER TABLE hyperfide.capacity_accounts ADD CONSTRAINT capacity_accounts_dimension_check
 CHECK(dimension IN ('SANDBOX','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES','AGENT','BUILD','TEST','INDEX',
 'REVIEW','INTEGRATION','PREPARATION','EXCLUSIVE_SERVICE','WARM_SPARE','PROVISION_RATE','API_RATE','MODEL_RATE'));
ALTER TABLE hyperfide.capacity_accounts ADD CONSTRAINT capacity_accounts_pool_identity
 UNIQUE(organisation_id,pool_id,id);

CREATE FUNCTION hyperfide.scheduler_immutable_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Scheduling history is immutable' USING ERRCODE='23514'; END $$;

CREATE TABLE hyperfide.scheduling_policies (
 organisation_id uuid NOT NULL,
 pool_id uuid NOT NULL,
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 aging_seconds integer NOT NULL DEFAULT 5 CHECK(aging_seconds BETWEEN 1 AND 3600),
 max_bypass_seconds integer NOT NULL DEFAULT 30 CHECK(max_bypass_seconds BETWEEN 1 AND 3600),
 rate_window_ms integer NOT NULL DEFAULT 1000 CHECK(rate_window_ms BETWEEN 100 AND 3600000),
 max_waiters integer NOT NULL DEFAULT 10000 CHECK(max_waiters BETWEEN 1 AND 1000000),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,pool_id),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id)
);
CREATE TABLE hyperfide.resource_waiters (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 request_id uuid NOT NULL,
 pool_id uuid NOT NULL,
 owner_session_id uuid NOT NULL,
 task_id uuid NOT NULL,
 spec_revision_id uuid NOT NULL,
 spec_generation bigint NOT NULL CHECK(spec_generation>=1),
 criteria_digest hyperfide.digest NOT NULL,
 resource_policy_digest hyperfide.digest NOT NULL,
 job_kind text NOT NULL CHECK(job_kind IN ('AGENT','BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION','EXCLUSIVE_SERVICE')),
 priority integer NOT NULL CHECK(priority BETWEEN -1000 AND 1000),
 state text NOT NULL DEFAULT 'WAITING' CHECK(state IN ('WAITING','ADMITTED','CANCELLED','EXPIRED')),
 wait_reason text NOT NULL DEFAULT 'CAPACITY' CHECK(wait_reason IN ('CAPACITY','MODEL','REVIEW','BUILD','PROVIDER_RATE','EXCLUSIVE_SERVICE')),
 enqueued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deadline_at timestamptz NOT NULL,
 admitted_at timestamptz,
 attempt_id uuid,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 UNIQUE(organisation_id,run_id,id,pool_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,owner_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id),
 CHECK((state='ADMITTED')=(admitted_at IS NOT NULL))
);
CREATE INDEX resource_waiters_pending ON hyperfide.resource_waiters(organisation_id,pool_id,state,enqueued_at);
CREATE TABLE hyperfide.resource_waiter_dimensions (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 waiter_id uuid NOT NULL,
 pool_id uuid NOT NULL,
 capacity_account_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),
 PRIMARY KEY(organisation_id,run_id,waiter_id,capacity_account_id),
 FOREIGN KEY(organisation_id,run_id,waiter_id,pool_id)
 REFERENCES hyperfide.resource_waiters(organisation_id,run_id,id,pool_id),
 FOREIGN KEY(organisation_id,pool_id,capacity_account_id)
 REFERENCES hyperfide.capacity_accounts(organisation_id,pool_id,id)
);
CREATE TABLE hyperfide.scheduler_dispatches (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 request_id uuid NOT NULL,
 task_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL CHECK(attempt_generation>=1),
 authority_epoch uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 slot_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>=1),
 payload_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'INTENT' CHECK(state IN ('INTENT','UNKNOWN','RUNNING','STOP_REQUESTED','STOPPED','ABSENT','COMPLETED','FAILED')),
 event_id uuid NOT NULL,
 spawn_receipt_id uuid,
 observation_receipt_id uuid,
 native_session_id hyperfide.name,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 observed_at timestamptz,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,task_id,attempt_id,attempt_generation)
 REFERENCES hyperfide.attempts(organisation_id,run_id,task_id,id,generation),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation)
 REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,event_id) REFERENCES hyperfide.outbox_events(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,spawn_receipt_id) REFERENCES hyperfide.command_inbox(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,observation_receipt_id) REFERENCES hyperfide.command_inbox(organisation_id,run_id,id)
);
CREATE UNIQUE INDEX scheduler_dispatches_unresolved
 ON hyperfide.scheduler_dispatches(organisation_id,run_id,attempt_id,attempt_generation)
 WHERE state IN ('INTENT','UNKNOWN','RUNNING','STOP_REQUESTED');
CREATE TABLE hyperfide.resource_cleanup_receipts (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL CHECK(attempt_generation>=1),
 sandbox_id uuid NOT NULL,
 slot_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>=1),
 observation_receipt_id uuid NOT NULL,
 observation_digest hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,attempt_id,attempt_generation),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation)
 REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation)
 REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,observation_receipt_id)
 REFERENCES hyperfide.command_inbox(organisation_id,run_id,id)
);

CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.scheduling_policies FOR EACH ROW
 EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','pool_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.scheduling_policies FOR EACH ROW
 EXECUTE FUNCTION hyperfide.monotonic_fields('revision');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.resource_waiters FOR EACH ROW
 EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','request_id','pool_id','owner_session_id','task_id','job_kind','priority','enqueued_at','deadline_at');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.resource_waiters FOR EACH ROW
 EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.resource_waiter_dimensions FOR EACH ROW
 EXECUTE FUNCTION hyperfide.scheduler_immutable_record();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.scheduler_dispatches FOR EACH ROW
 EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','request_id','task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id','sandbox_boot_generation','payload_digest','event_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.scheduler_dispatches FOR EACH ROW
 EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.resource_cleanup_receipts FOR EACH ROW
 EXECUTE FUNCTION hyperfide.scheduler_immutable_record();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.scheduling_policies FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.resource_waiters FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.resource_waiter_dimensions FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.scheduler_dispatches FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.resource_cleanup_receipts FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- A release-pending row must retain its original counter bucket.
-- Existing ambiguous allocations require reconciliation before this migration.
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM hyperfide.reservations WHERE state='RELEASE_PENDING') THEN
 RAISE EXCEPTION 'Reconcile release-pending reservations before adding accounting provenance' USING ERRCODE='55000';
 END IF;
END $$;
ALTER TABLE hyperfide.reservations ADD COLUMN accounting_bucket text NOT NULL DEFAULT 'RESERVED'
 CHECK(accounting_bucket IN ('RESERVED','ALLOCATED'));
UPDATE hyperfide.reservations SET accounting_bucket='ALLOCATED',state_version=state_version+1 WHERE state='ALLOCATED';
CREATE FUNCTION hyperfide.reservation_accounting_bucket() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state='ALLOCATED' THEN NEW.accounting_bucket='ALLOCATED';
  ELSE NEW.accounting_bucket='RESERVED'; END IF;
 ELSE
  IF NEW.state='ALLOCATED' AND OLD.state='PROVISIONING' THEN NEW.accounting_bucket='ALLOCATED';
  ELSE NEW.accounting_bucket=OLD.accounting_bucket; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER accounting_bucket BEFORE INSERT OR UPDATE ON hyperfide.reservations FOR EACH ROW
 EXECUTE FUNCTION hyperfide.reservation_accounting_bucket();

CREATE TABLE hyperfide.capacity_rate_windows (
 organisation_id uuid NOT NULL,
 capacity_account_id uuid NOT NULL,
 window_start timestamptz NOT NULL,
 consumed bigint NOT NULL CHECK(consumed>=0),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,capacity_account_id,window_start),
 FOREIGN KEY(organisation_id,capacity_account_id) REFERENCES hyperfide.capacity_accounts(organisation_id,id)
);
CREATE TABLE hyperfide.capacity_rate_receipts (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 request_id uuid NOT NULL,
 capacity_account_id uuid NOT NULL,
 window_start timestamptz NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,request_id,capacity_account_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,capacity_account_id,window_start)
 REFERENCES hyperfide.capacity_rate_windows(organisation_id,capacity_account_id,window_start)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.capacity_rate_windows FOR EACH ROW
 EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','capacity_account_id','window_start');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.capacity_rate_windows FOR EACH ROW
 EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.capacity_rate_receipts FOR EACH ROW
 EXECUTE FUNCTION hyperfide.scheduler_immutable_record();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.capacity_rate_windows FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.capacity_rate_receipts FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- Execution controls are authoritative scheduler gates, not observations of physical quiescence.
CREATE TABLE hyperfide.execution_controls (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 scope_kind text NOT NULL CHECK(scope_kind IN ('RUN','PACKAGE','ATTEMPT','SANDBOX')),
 scope_id uuid NOT NULL, package_id uuid, attempt_id uuid, sandbox_id uuid,
 mode text NOT NULL CHECK(mode IN ('ACTIVE','PAUSE','DRAIN','STOP')),
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>=1),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,scope_kind,scope_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id) REFERENCES hyperfide.sandboxes(organisation_id,id),
 CHECK((scope_kind='RUN' AND scope_id=run_id AND package_id IS NULL AND attempt_id IS NULL AND sandbox_id IS NULL)
 OR (scope_kind='PACKAGE' AND scope_id=package_id AND package_id IS NOT NULL AND attempt_id IS NULL AND sandbox_id IS NULL)
 OR (scope_kind='ATTEMPT' AND scope_id=attempt_id AND attempt_id IS NOT NULL AND package_id IS NULL AND sandbox_id IS NULL)
 OR (scope_kind='SANDBOX' AND scope_id=sandbox_id AND sandbox_id IS NOT NULL AND package_id IS NULL AND attempt_id IS NULL))
);
CREATE TABLE hyperfide.execution_control_history (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, operation_id uuid NOT NULL,
 control_id uuid NOT NULL, generation bigint NOT NULL CHECK(generation>=1),
 request_digest hyperfide.digest NOT NULL, mode text NOT NULL CHECK(mode IN ('ACTIVE','PAUSE','DRAIN','STOP')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4096),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id), UNIQUE(organisation_id,run_id,control_id,generation),
 FOREIGN KEY(organisation_id,run_id,control_id) REFERENCES hyperfide.execution_controls(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.execution_controls FOR EACH ROW
 EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','scope_kind','scope_id','package_id','attempt_id','sandbox_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.execution_controls FOR EACH ROW
 EXECUTE FUNCTION hyperfide.monotonic_fields('generation');
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON hyperfide.execution_control_history FOR EACH ROW
 EXECUTE FUNCTION hyperfide.scheduler_immutable_record();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.execution_controls FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.execution_control_history FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();

ALTER TABLE hyperfide.capacity_accounts ADD COLUMN resource_key text NOT NULL DEFAULT '';
ALTER TABLE hyperfide.capacity_accounts DROP CONSTRAINT capacity_accounts_organisation_id_pool_id_dimension_key;
ALTER TABLE hyperfide.capacity_accounts ADD CONSTRAINT named_resource_identity UNIQUE(organisation_id,pool_id,dimension,resource_key);
ALTER TABLE hyperfide.capacity_accounts ADD CONSTRAINT named_resource_scope CHECK((dimension='EXCLUSIVE_SERVICE' AND length(resource_key) BETWEEN 1 AND 128) OR (dimension<>'EXCLUSIVE_SERVICE' AND resource_key=''));

ALTER TABLE hyperfide.scheduler_dispatches ADD CONSTRAINT one_dispatch_per_attempt UNIQUE(organisation_id,run_id,attempt_id,attempt_generation);

ALTER TABLE hyperfide.capacity_accounts ADD COLUMN capacity_class text NOT NULL DEFAULT 'EXECUTION';
UPDATE hyperfide.capacity_accounts SET capacity_class=CASE
 WHEN dimension IN ('SANDBOX','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES') THEN 'PHYSICAL'
 WHEN dimension IN ('PROVISION_RATE','API_RATE','MODEL_RATE') THEN 'RATE'
 WHEN dimension='EXCLUSIVE_SERVICE' THEN 'EXCLUSIVE' ELSE 'EXECUTION' END,
 state_version=state_version+1;
ALTER TABLE hyperfide.capacity_accounts ADD CONSTRAINT capacity_class_kind CHECK(
 (dimension='SANDBOX' AND capacity_class='PHYSICAL')
 OR (dimension IN ('CPU_MILLIS','MEMORY_BYTES','DISK_BYTES') AND capacity_class IN ('PHYSICAL','EXECUTION'))
 OR (dimension IN ('PROVISION_RATE','API_RATE','MODEL_RATE') AND capacity_class='RATE')
 OR (dimension='EXCLUSIVE_SERVICE' AND capacity_class='EXCLUSIVE')
 OR (dimension IN ('AGENT','BUILD','TEST','INDEX','REVIEW','INTEGRATION','PREPARATION','WARM_SPARE') AND capacity_class='EXECUTION'));
ALTER TABLE hyperfide.capacity_accounts DROP CONSTRAINT named_resource_identity;
ALTER TABLE hyperfide.capacity_accounts ADD CONSTRAINT named_resource_identity UNIQUE(organisation_id,pool_id,capacity_class,dimension,resource_key);
CREATE TABLE hyperfide.resource_job_allocations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 request_id uuid NOT NULL,task_id uuid NOT NULL,reservation_id uuid NOT NULL,
 job_kind text NOT NULL CHECK(job_kind IN ('BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION')),
 slot_id uuid NOT NULL,sandbox_id uuid NOT NULL,sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>=1),
 assignee_session_id uuid NOT NULL,generation bigint NOT NULL DEFAULT 1 CHECK(generation>=1),
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','RELEASE_PENDING','RELEASED')),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,assignee_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE UNIQUE INDEX one_live_job_per_slot ON hyperfide.resource_job_allocations(organisation_id,slot_id)
 WHERE state IN ('ACTIVE','RELEASE_PENDING');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.resource_job_allocations FOR EACH ROW
 EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','request_id','task_id','reservation_id','job_kind','slot_id','sandbox_id','sandbox_boot_generation','assignee_session_id','generation','created_at');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.resource_job_allocations FOR EACH ROW
 EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.resource_job_allocations FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();

ALTER TABLE hyperfide.execution_controls ADD COLUMN deadline_at timestamptz;
ALTER TABLE hyperfide.execution_controls ADD COLUMN fallback_mode text CHECK(fallback_mode IN ('PAUSE','STOP'));
ALTER TABLE hyperfide.execution_controls ADD CONSTRAINT bounded_drain_policy
 CHECK((mode='DRAIN' AND deadline_at IS NOT NULL AND fallback_mode IS NOT NULL) OR (mode<>'DRAIN' AND deadline_at IS NULL AND fallback_mode IS NULL));
ALTER TABLE hyperfide.execution_control_history ADD COLUMN deadline_at timestamptz;
ALTER TABLE hyperfide.execution_control_history ADD COLUMN fallback_mode text CHECK(fallback_mode IN ('PAUSE','STOP'));
ALTER TABLE hyperfide.execution_control_history ADD CONSTRAINT bounded_drain_history
 CHECK((mode='DRAIN' AND deadline_at IS NOT NULL AND fallback_mode IS NOT NULL) OR (mode<>'DRAIN' AND deadline_at IS NULL AND fallback_mode IS NULL));

ALTER TABLE hyperfide.resource_waiters ADD CONSTRAINT job_request_identity UNIQUE(organisation_id,run_id,request_id,task_id,job_kind);
ALTER TABLE hyperfide.resource_job_allocations ADD CONSTRAINT job_waiter_binding FOREIGN KEY(organisation_id,run_id,request_id,task_id,job_kind) REFERENCES hyperfide.resource_waiters(organisation_id,run_id,request_id,task_id,job_kind);
ALTER TABLE hyperfide.reservations ADD CONSTRAINT reservation_request_identity UNIQUE(organisation_id,run_id,id,request_id);
ALTER TABLE hyperfide.resource_job_allocations ADD CONSTRAINT job_reservation_binding FOREIGN KEY(organisation_id,run_id,reservation_id,request_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id,request_id);
ALTER TABLE hyperfide.worker_slots DROP CONSTRAINT worker_slots_capacity_kind_check;
ALTER TABLE hyperfide.worker_slots ADD CONSTRAINT worker_slots_capacity_kind_check CHECK(capacity_kind IN ('AGENT','BUILD','TEST','INDEX','REVIEW','INTEGRATION','PREPARATION','EXCLUSIVE_SERVICE'));

-- Job reservations retain the accepted task and resource-policy identity independently
-- of an execution packet or native command digest.
CREATE FUNCTION hyperfide.scheduler_waiter_pins() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hyperfide.tasks t WHERE t.organisation_id=NEW.organisation_id AND t.run_id=NEW.run_id AND t.id=NEW.task_id AND t.spec_revision_id=NEW.spec_revision_id AND t.spec_generation=NEW.spec_generation AND t.criteria_digest=NEW.criteria_digest) THEN
 RAISE EXCEPTION 'Job pins do not match accepted task intent' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER accepted_resource_pins BEFORE INSERT ON hyperfide.resource_waiters FOR EACH ROW EXECUTE FUNCTION hyperfide.scheduler_waiter_pins();
CREATE TRIGGER immutable_resource_pins BEFORE UPDATE ON hyperfide.resource_waiters FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('task_id','spec_revision_id','spec_generation','criteria_digest','resource_policy_digest');

-- Pool quotas and usable execution capacity on one boot are independent budgets.
CREATE TABLE hyperfide.sandbox_execution_budgets(
 organisation_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>=1),
 qualification_id uuid NOT NULL,
 evidence_digest hyperfide.digest NOT NULL,
 qualification_source text NOT NULL CHECK(qualification_source IN ('PROVIDER_OBSERVATION','OPERATOR_FIXED')),
 hard_cpu_millis bigint NOT NULL CHECK(hard_cpu_millis>0),
 hard_memory_bytes bigint NOT NULL CHECK(hard_memory_bytes>0),
 hard_disk_bytes bigint NOT NULL CHECK(hard_disk_bytes>=0),
 headroom_cpu_millis bigint NOT NULL CHECK(headroom_cpu_millis>=0 AND headroom_cpu_millis<hard_cpu_millis),
 headroom_memory_bytes bigint NOT NULL CHECK(headroom_memory_bytes>=0 AND headroom_memory_bytes<hard_memory_bytes),
 headroom_disk_bytes bigint NOT NULL CHECK(headroom_disk_bytes>=0 AND headroom_disk_bytes<=hard_disk_bytes),
 held_cpu_millis bigint NOT NULL DEFAULT 0 CHECK(held_cpu_millis>=0 AND held_cpu_millis<=hard_cpu_millis-headroom_cpu_millis),
 held_memory_bytes bigint NOT NULL DEFAULT 0 CHECK(held_memory_bytes>=0 AND held_memory_bytes<=hard_memory_bytes-headroom_memory_bytes),
 held_disk_bytes bigint NOT NULL DEFAULT 0 CHECK(held_disk_bytes>=0 AND held_disk_bytes<=hard_disk_bytes-headroom_disk_bytes),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,sandbox_id,sandbox_boot_generation),
 UNIQUE(organisation_id,qualification_id),
 FOREIGN KEY(organisation_id,sandbox_id,sandbox_boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation)
);
CREATE TABLE hyperfide.sandbox_execution_charges(
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 request_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL,
 slot_id uuid NOT NULL,
 attempt_id uuid,
 job_kind text NOT NULL CHECK(job_kind IN ('AGENT','CHILD','BUILD','TEST','REVIEW','INDEX','INTEGRATION','PREPARATION')),
 cpu_millis bigint NOT NULL CHECK(cpu_millis>0),
 memory_bytes bigint NOT NULL CHECK(memory_bytes>0),
 disk_bytes bigint NOT NULL CHECK(disk_bytes>=0),
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>=1),
 state text NOT NULL DEFAULT 'HELD' CHECK(state IN ('HELD','RELEASE_PENDING','RELEASED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 released_at timestamptz,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,sandbox_boot_generation) REFERENCES hyperfide.sandbox_execution_budgets(organisation_id,sandbox_id,sandbox_boot_generation),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id),
 CHECK((state='RELEASED')=(released_at IS NOT NULL))
);
CREATE TRIGGER supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.sandbox_execution_budgets FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.sandbox_execution_charges FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER immutable_budget BEFORE UPDATE ON hyperfide.sandbox_execution_budgets FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','sandbox_id','sandbox_boot_generation','qualification_id','evidence_digest','qualification_source','hard_cpu_millis','hard_memory_bytes','hard_disk_bytes','headroom_cpu_millis','headroom_memory_bytes','headroom_disk_bytes','created_at');
CREATE TRIGGER immutable_charge BEFORE UPDATE ON hyperfide.sandbox_execution_charges FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','request_id','sandbox_id','sandbox_boot_generation','slot_id','attempt_id','job_kind','cpu_millis','memory_bytes','disk_bytes','generation','created_at');
