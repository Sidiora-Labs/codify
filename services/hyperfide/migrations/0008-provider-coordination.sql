-- Provider coordination metadata. Account inventory belongs in private deployment
-- configuration and PostgreSQL; this migration contains no live account values.
CREATE TABLE hyperfide.provider_pool_configurations (
 organisation_id uuid NOT NULL,
 pool_id uuid NOT NULL,
 configuration_digest hyperfide.digest NOT NULL,
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=1048576),
 active boolean NOT NULL DEFAULT true,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,pool_id,configuration_digest),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id)
);
CREATE UNIQUE INDEX provider_pool_one_active_config ON hyperfide.provider_pool_configurations(organisation_id,pool_id) WHERE active;

CREATE TABLE hyperfide.provider_quota_observations (
 organisation_id uuid NOT NULL,
 id uuid NOT NULL,
 pool_id uuid NOT NULL,
 configuration_digest hyperfide.digest NOT NULL,
 provider text NOT NULL CHECK(provider IN ('railway','blaxel')),
 account_key text NOT NULL CHECK(length(account_key) BETWEEN 1 AND 2048),
 scope_kind text NOT NULL CHECK(scope_kind IN ('ACCOUNT','ENVIRONMENT','POOL')),
 scope_key text NOT NULL CHECK(length(scope_key) BETWEEN 1 AND 2048),
 dimension text NOT NULL CHECK(dimension IN ('SANDBOX','PROVISIONING','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES','AGENT','BUILD','TEST','INDEX')),
 quota_limit bigint NOT NULL CHECK(quota_limit>=0),
 observed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 evidence_digest hyperfide.digest NOT NULL,
 basis text NOT NULL CHECK(basis IN ('PROVIDER_API','VERIFIED_OPERATOR_ATTESTATION')),
 evidence_reference text NOT NULL CHECK(length(evidence_reference) BETWEEN 1 AND 2048),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>observed_at),
 PRIMARY KEY(organisation_id,id),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest)
);
CREATE INDEX provider_quota_current ON hyperfide.provider_quota_observations(organisation_id,provider,account_key,scope_kind,scope_key,dimension,observed_at DESC);

CREATE TABLE hyperfide.provisioning_intents (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 pool_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 configuration_digest hyperfide.digest NOT NULL,
 kind text NOT NULL CHECK(kind IN ('CREATE','DESTROY')),
 request_key text NOT NULL CHECK(length(request_key) BETWEEN 1 AND 256),
 request_digest hyperfide.digest NOT NULL,
 payload_digest hyperfide.digest NOT NULL,
 operation jsonb NOT NULL CHECK(jsonb_typeof(operation)='object' AND octet_length(operation::text)<=1048576),
 state text NOT NULL DEFAULT 'RECORDED' CHECK(state IN ('RECORDED','SUBMITTING','ID_KNOWN','ACKNOWLEDGED','UNKNOWN','RECONCILING','QUARANTINED','TERMINAL','REJECTED')),
 native_sandbox_id text,
 boot_generation bigint NOT NULL CHECK(boot_generation>=1),
 provider_request_id text,
 last_outcome jsonb CHECK(last_outcome IS NULL OR jsonb_typeof(last_outcome)='object'),
 failure_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,request_key),
 UNIQUE(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id) REFERENCES hyperfide.sandboxes(organisation_id,id),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 CHECK((kind='CREATE') OR native_sandbox_id IS NOT NULL)
);
CREATE UNIQUE INDEX provider_one_active_destroy ON hyperfide.provisioning_intents(organisation_id,sandbox_id) WHERE kind='DESTROY' AND state NOT IN ('TERMINAL','REJECTED');
CREATE INDEX provider_intent_reconcile ON hyperfide.provisioning_intents(organisation_id,pool_id,state,updated_at);
CREATE UNIQUE INDEX provider_one_active_create ON hyperfide.provisioning_intents(organisation_id,sandbox_id) WHERE kind='CREATE' AND state NOT IN ('TERMINAL','REJECTED');

CREATE TABLE hyperfide.provisioning_intent_reservations (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 intent_id uuid NOT NULL,
 reservation_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,run_id,intent_id,reservation_id),
 UNIQUE(organisation_id,run_id,reservation_id),
 FOREIGN KEY(organisation_id,run_id,intent_id) REFERENCES hyperfide.provisioning_intents(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.provider_observations (
 organisation_id uuid NOT NULL,
 id uuid NOT NULL,
 intent_id uuid NOT NULL,
 operation_id text NOT NULL,
 payload_digest hyperfide.digest NOT NULL,
 observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object' AND octet_length(observation::text)<=1048576),
 observed_at timestamptz NOT NULL,
 evidence_digest hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 FOREIGN KEY(organisation_id,intent_id) REFERENCES hyperfide.provisioning_intents(organisation_id,id)
);

CREATE UNIQUE INDEX provider_observation_dedup ON hyperfide.provider_observations(organisation_id,intent_id,operation_id,evidence_digest);

CREATE TABLE hyperfide.provider_orphans (
 organisation_id uuid NOT NULL,
 pool_id uuid NOT NULL,
 native_sandbox_id text NOT NULL,
 suspected_intent_id uuid,
 state text NOT NULL DEFAULT 'QUARANTINED' CHECK(state IN ('QUARANTINED','OWNERSHIP_VERIFIED','RETAINED','DELETED')),
 ownership_evidence_digest hyperfide.digest,
 first_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 last_observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,pool_id,native_sandbox_id),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id),
 FOREIGN KEY(organisation_id,suspected_intent_id) REFERENCES hyperfide.provisioning_intents(organisation_id,id),
 CHECK(state NOT IN ('OWNERSHIP_VERIFIED','DELETED') OR ownership_evidence_digest IS NOT NULL)
);

CREATE TABLE hyperfide.provider_pool_health (
 organisation_id uuid NOT NULL,
 pool_id uuid NOT NULL,
 failure_count integer NOT NULL DEFAULT 0 CHECK(failure_count>=0),
 state text NOT NULL DEFAULT 'CLOSED' CHECK(state IN ('CLOSED','OPEN','HALF_OPEN')),
 retry_after timestamptz,
 last_outcome_digest hyperfide.digest,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,pool_id),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id)
);

CREATE TABLE hyperfide.provider_relocation_plans (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 task_id uuid NOT NULL,
 old_attempt_id uuid NOT NULL,
 old_attempt_generation bigint NOT NULL CHECK(old_attempt_generation>=1),
 old_authority_epoch uuid NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 preparation_digest hyperfide.digest NOT NULL,
 target_pool_id uuid NOT NULL,
 target_configuration_digest hyperfide.digest NOT NULL,
 reason_observation_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'PENDING_ADMISSION' CHECK(state IN ('PENDING_ADMISSION','ENROLLED','ADMITTED','CANCELLED')),
 fresh_enrollment_required boolean NOT NULL DEFAULT true CHECK(fresh_enrollment_required),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,old_attempt_id,old_attempt_generation),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,old_attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,target_pool_id,target_configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 FOREIGN KEY(organisation_id,reason_observation_id) REFERENCES hyperfide.provider_observations(organisation_id,id)
);


CREATE TABLE hyperfide.provider_connectivity_probes (
 organisation_id uuid NOT NULL,
 id uuid NOT NULL,
 pool_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 boot_generation bigint NOT NULL CHECK(boot_generation>=1),
 configuration_digest hyperfide.digest NOT NULL,
 endpoints_digest hyperfide.digest NOT NULL,
 credential_lineage text NOT NULL,
 enrollment_evidence_digest hyperfide.digest NOT NULL,
 evidence_digest hyperfide.digest NOT NULL,
 evidence_scope text NOT NULL CHECK(evidence_scope IN ('LIVE_POOL','COMPONENT_FIXTURE')),
 status text NOT NULL CHECK(status IN ('PASS','FAIL','UNKNOWN')),
 observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object'),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest)
);
CREATE INDEX provider_connectivity_current ON hyperfide.provider_connectivity_probes(organisation_id,pool_id,configuration_digest,expires_at);
ALTER TABLE hyperfide.provider_relocation_plans
 ADD COLUMN source_manifest jsonb NOT NULL CHECK(jsonb_typeof(source_manifest)='object'),
 ADD COLUMN checkpoint_id uuid NOT NULL,
 ADD COLUMN enrolled_sandbox_id uuid,
 ADD COLUMN enrolled_boot_generation bigint CHECK(enrolled_boot_generation>=1),
 ADD COLUMN enrollment_evidence_digest hyperfide.digest,
 ADD FOREIGN KEY(organisation_id,run_id,checkpoint_id) REFERENCES hyperfide.checkpoints(organisation_id,run_id,id),
 ADD FOREIGN KEY(organisation_id,enrolled_sandbox_id,enrolled_boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 ADD CHECK(state NOT IN ('ENROLLED','ADMITTED') OR (enrolled_sandbox_id IS NOT NULL AND enrolled_boot_generation IS NOT NULL AND enrollment_evidence_digest IS NOT NULL));


-- Prepared bases are reusable only within the exact trusted pool/profile scope.
-- The verifier owns proof production; this registry never treats provider RUNNING
-- or an operator seed as qualification of the desired target preparation.
CREATE TABLE hyperfide.provider_prepared_bases (
 organisation_id uuid NOT NULL,
 id uuid NOT NULL,
 pool_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 preparation_digest hyperfide.digest NOT NULL,
 provider text NOT NULL CHECK(provider IN ('railway','blaxel')),
 configuration_digest hyperfide.digest NOT NULL,
 provider_prepared_digest hyperfide.digest NOT NULL,
 provider_reference jsonb NOT NULL CHECK(jsonb_typeof(provider_reference)='object' AND octet_length(provider_reference::text)<=16384),
 source_sandbox_id uuid NOT NULL,
 source_boot_generation bigint NOT NULL CHECK(source_boot_generation>=1),
 manifest_artifact_digest hyperfide.digest NOT NULL,
 execution_receipt_digest hyperfide.digest NOT NULL,
 verification_receipt_digest hyperfide.digest NOT NULL,
 verification_scope text NOT NULL CHECK(verification_scope='POOL'),
 state text NOT NULL CHECK(state IN ('QUALIFIED','STALE','REVOKED')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>created_at),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,pool_id,profile_id,preparation_digest,provider_prepared_digest,configuration_digest),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,source_sandbox_id,source_boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation)
);
CREATE INDEX provider_prepared_current ON hyperfide.provider_prepared_bases(organisation_id,pool_id,profile_id,preparation_digest,state,expires_at);
CREATE FUNCTION hyperfide.provider_prepared_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR
    (OLD.state='REVOKED' AND NEW.state<>'REVOKED') OR
    (OLD.state='STALE' AND NEW.state='QUALIFIED') THEN
  RAISE EXCEPTION 'Prepared base identity/proof is immutable; publish a new verified identity';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_prepared_immutable BEFORE UPDATE ON hyperfide.provider_prepared_bases FOR EACH ROW EXECUTE FUNCTION hyperfide.provider_prepared_immutable();

CREATE TABLE hyperfide.provider_remote_operations (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 session_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 boot_generation bigint NOT NULL CHECK(boot_generation>=1),
 request_digest hyperfide.digest NOT NULL,
 runner_binding_evidence_digest hyperfide.digest NOT NULL,
 operation jsonb NOT NULL CHECK(jsonb_typeof(operation)='object' AND octet_length(operation::text)<=1048576),
 state text NOT NULL CHECK(state IN ('SUBMITTING','OBSERVED','UNKNOWN')),
 outcome jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation)
);
