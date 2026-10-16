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
 basis text NOT NULL CHECK(basis IN ('PROVIDER_API','VERIFIED_OPERATOR_ATTESTATION','OPERATOR_DECLARED_CAPACITY')),
 evidence_reference text NOT NULL CHECK(length(evidence_reference) BETWEEN 1 AND 2048),
 declaration_id uuid,
 CHECK((basis='OPERATOR_DECLARED_CAPACITY')=(declaration_id IS NOT NULL)),
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
 preparation_purpose text CHECK(preparation_purpose IN ('PREPARATION','EXECUTION')),
 profile_id uuid,
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
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id) REFERENCES hyperfide.sandboxes(organisation_id,id),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 CHECK((kind='CREATE') OR native_sandbox_id IS NOT NULL),
 CHECK((kind='CREATE')=(preparation_purpose IS NOT NULL)),
 CHECK((kind='CREATE')=(profile_id IS NOT NULL))
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
 failure_applied_at timestamptz,
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
 source_run_id uuid NOT NULL,
 source_sandbox_id uuid NOT NULL,
 source_boot_generation bigint NOT NULL CHECK(source_boot_generation>=1),
 manifest_artifact_digest hyperfide.digest NOT NULL,
 execution_receipt_digest hyperfide.digest NOT NULL,
 verification_receipt_digest hyperfide.digest NOT NULL,
 execution_receipt_artifact_digest hyperfide.digest NOT NULL,
 verification_receipt_artifact_digest hyperfide.digest NOT NULL,
 verification_scope text NOT NULL CHECK(verification_scope='POOL'),
 state text NOT NULL CHECK(state IN ('QUALIFIED','STALE','REVOKED')),
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>created_at),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,pool_id,profile_id,preparation_digest,provider_prepared_digest,configuration_digest),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,source_run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,source_run_id,manifest_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,source_run_id,execution_receipt_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,source_run_id,verification_receipt_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
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
 process_claimed boolean NOT NULL DEFAULT false,
 native_process_ref text,
 process_record jsonb CHECK(process_record IS NULL OR (jsonb_typeof(process_record)='object' AND octet_length(process_record::text)<=65536)),
 state text NOT NULL CHECK(state IN ('SUBMITTING','OBSERVED','UNKNOWN')),
 outcome jsonb,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation)
);


-- Live runtime evidence is separate from reusable prepared-base evidence.
-- The actual native verifier/receipt publisher supplies facts; provider state
-- alone cannot create a READY observation.
CREATE TABLE hyperfide.runtime_environment_observations (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 boot_generation bigint NOT NULL CHECK(boot_generation>=1),
 boot_id uuid NOT NULL,
 slot_id uuid NOT NULL,
 profile_id uuid NOT NULL,
 profile_digest hyperfide.digest NOT NULL,
 boot_preparation_digest hyperfide.digest NOT NULL,
 preparation_digest hyperfide.digest NOT NULL,
 readiness_digest hyperfide.digest NOT NULL,
 source_digest hyperfide.digest NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 source_manifest_artifact_digest hyperfide.digest NOT NULL,
 source_state_digest hyperfide.digest NOT NULL,
 readiness_input jsonb NOT NULL CHECK(jsonb_typeof(readiness_input)='object' AND octet_length(readiness_input::text)<=1048576),
 readiness_input_digest hyperfide.digest NOT NULL,
 source_repository_id uuid NOT NULL,
 source_repository_key text NOT NULL CHECK(length(source_repository_key) BETWEEN 1 AND 256 AND source_repository_key !~ '[[:cntrl:]]'),
 source_object_id hyperfide.git_oid NOT NULL,
 source_tree_id hyperfide.git_oid NOT NULL,
 source_bindings jsonb NOT NULL CHECK(jsonb_typeof(source_bindings)='array' AND jsonb_array_length(source_bindings)>0 AND octet_length(source_bindings::text)<=1048576),
 workspace_digest hyperfide.digest,
 native_operation_id uuid NOT NULL,
 input_digest hyperfide.digest NOT NULL,
 command_digest hyperfide.digest NOT NULL,
 stdout_artifact_digest hyperfide.digest NOT NULL,
 execution_receipt_digest hyperfide.digest NOT NULL,
 verification_receipt_digest hyperfide.digest NOT NULL,
 execution_receipt_artifact_digest hyperfide.digest NOT NULL,
 verification_receipt_artifact_digest hyperfide.digest NOT NULL,
 manifest_artifact_digest hyperfide.digest NOT NULL,
 state text NOT NULL CHECK(state IN ('READY','NOT_READY','STALE','REVOKED')),
 failure_code text,
 observed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(expires_at>observed_at),
 CHECK(state<>'READY' OR failure_code IS NULL),
 CHECK(source_digest=source_manifest_digest),
 CHECK(source_manifest_digest=source_manifest_artifact_digest),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 FOREIGN KEY(organisation_id,boot_id) REFERENCES hyperfide.sandbox_boots(organisation_id,boot_id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,source_repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,source_repository_id,source_tree_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,run_id,execution_receipt_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,verification_receipt_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,stdout_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,source_manifest_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,manifest_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest)
);
CREATE INDEX runtime_environment_latest ON hyperfide.runtime_environment_observations(organisation_id,run_id,sandbox_id,boot_generation,slot_id,observed_at DESC,created_at DESC);
CREATE FUNCTION hyperfide.runtime_environment_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF (to_jsonb(NEW)-'state') IS DISTINCT FROM (to_jsonb(OLD)-'state') OR
    (NEW.state<>OLD.state AND NOT(OLD.state='READY' AND NEW.state IN ('STALE','REVOKED'))) THEN
  RAISE EXCEPTION 'Runtime observation identity/evidence is immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER runtime_environment_immutable BEFORE UPDATE ON hyperfide.runtime_environment_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.runtime_environment_immutable();


CREATE FUNCTION hyperfide.provider_process_claim_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF OLD.native_process_ref IS NOT NULL AND NEW.native_process_ref IS DISTINCT FROM OLD.native_process_ref OR
    OLD.process_claimed AND NOT NEW.process_claimed OR
    OLD.process_record IS NOT NULL AND
    (NEW.process_record IS NULL OR
     (NEW.process_record-'state') IS DISTINCT FROM (OLD.process_record-'state')) THEN
  RAISE EXCEPTION 'Provider process claim and identity cannot be reset';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_process_claim_immutable BEFORE UPDATE ON hyperfide.provider_remote_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.provider_process_claim_immutable();


CREATE TABLE hyperfide.provider_process_candidates (
 organisation_id uuid NOT NULL,
 remote_operation_id uuid NOT NULL,
 native_process_ref text NOT NULL CHECK(length(native_process_ref) BETWEEN 1 AND 2048),
 evidence_digest hyperfide.digest NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,remote_operation_id,native_process_ref),
 FOREIGN KEY(organisation_id,remote_operation_id) REFERENCES hyperfide.provider_remote_operations(organisation_id,id)
);


-- All remote work admission marks the physical boot irreversibly before SDK I/O.
ALTER TABLE hyperfide.sandboxes ADD COLUMN work_admitted boolean NOT NULL DEFAULT false;
CREATE FUNCTION hyperfide.provider_work_admission_immutable() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF OLD.work_admitted AND NOT NEW.work_admitted THEN RAISE EXCEPTION 'Physical work admission cannot be reset'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER provider_work_admission_immutable BEFORE UPDATE ON hyperfide.sandboxes FOR EACH ROW EXECUTE FUNCTION hyperfide.provider_work_admission_immutable();

-- Effective result environments are immutable children of an accepted pool policy.
-- Only the trusted measured preparation producer may publish these rows.
CREATE TABLE hyperfide.provider_profile_lineage (
 organisation_id uuid NOT NULL,
 id uuid NOT NULL,
 pool_id uuid NOT NULL,
 configuration_digest hyperfide.digest NOT NULL,
 parent_profile_id uuid NOT NULL,
 parent_preparation_digest hyperfide.digest NOT NULL,
 derived_profile_id uuid NOT NULL,
 derived_preparation_digest hyperfide.digest NOT NULL,
 source_run_id uuid NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 source_manifest_artifact_digest hyperfide.digest NOT NULL,
 execution_receipt_artifact_digest hyperfide.digest NOT NULL,
 verification_receipt_artifact_digest hyperfide.digest NOT NULL,
 accepted_policy_digest hyperfide.digest NOT NULL,
 lineage_digest hyperfide.digest NOT NULL,
 allowed_delta jsonb NOT NULL CHECK(allowed_delta='["source","dependency_pins","build_config_pins"]'::jsonb),
 state text NOT NULL CHECK(state IN ('QUALIFIED','STALE','REVOKED')),
 observed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,pool_id,configuration_digest,derived_profile_id,derived_preparation_digest),
 CHECK(parent_profile_id<>derived_profile_id AND parent_preparation_digest<>derived_preparation_digest),
 CHECK(expires_at>observed_at),
 CHECK(source_manifest_digest=source_manifest_artifact_digest),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 FOREIGN KEY(organisation_id,parent_profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,derived_profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,source_run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,source_run_id,source_manifest_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,source_run_id,execution_receipt_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,source_run_id,verification_receipt_artifact_digest) REFERENCES hyperfide.artifacts(organisation_id,run_id,digest)
);
CREATE TRIGGER provider_profile_lineage_immutable BEFORE UPDATE ON hyperfide.provider_profile_lineage FOR EACH ROW EXECUTE FUNCTION hyperfide.provider_prepared_immutable();

CREATE TRIGGER provider_intent_identity_immutable BEFORE UPDATE ON hyperfide.provisioning_intents FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','pool_id','sandbox_id','configuration_digest','kind','preparation_purpose','profile_id','request_key','request_digest','payload_digest','operation','boot_generation');

-- All provider authority writes retain the same supported transaction boundary.
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['provider_pool_configurations','provider_quota_observations','provisioning_intents','provisioning_intent_reservations','provider_observations','provider_orphans','provider_pool_health','provider_relocation_plans','provider_connectivity_probes','provider_prepared_bases','provider_remote_operations','runtime_environment_observations','provider_process_candidates','provider_profile_lineage'] LOOP
  EXECUTE format('CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',table_name);
 END LOOP;
END $$;

CREATE TABLE hyperfide.provider_remote_observations (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 remote_operation_id uuid NOT NULL,
 id uuid NOT NULL,
 observation jsonb NOT NULL CHECK(jsonb_typeof(observation)='object' AND octet_length(observation::text)<=1048576),
 evidence_digest hyperfide.digest NOT NULL,
 observed_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,remote_operation_id,evidence_digest),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,remote_operation_id) REFERENCES hyperfide.provider_remote_operations(organisation_id,id)
);
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.provider_remote_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER provider_remote_observation_immutable BEFORE UPDATE OR DELETE ON hyperfide.provider_remote_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','remote_operation_id','id','observation','evidence_digest','observed_at','created_at');

CREATE TABLE hyperfide.provider_capacity_attestations (
 organisation_id uuid NOT NULL,
 id uuid NOT NULL,
 pool_id uuid NOT NULL,
 configuration_digest hyperfide.digest NOT NULL,
 provenance_run_id uuid NOT NULL,
 provenance_artifact_id uuid NOT NULL,
 provenance_digest hyperfide.digest NOT NULL,
 declaration_digest hyperfide.digest NOT NULL,
 declaration jsonb NOT NULL CHECK(jsonb_typeof(declaration)='object' AND octet_length(declaration::text)<=16384),
 declared_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 CHECK(expires_at>declared_at),
 FOREIGN KEY(organisation_id,pool_id,configuration_digest) REFERENCES hyperfide.provider_pool_configurations(organisation_id,pool_id,configuration_digest),
 FOREIGN KEY(organisation_id,provenance_run_id,provenance_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
ALTER TABLE hyperfide.provider_quota_observations ADD CONSTRAINT capacity_declaration_provenance FOREIGN KEY(organisation_id,declaration_id) REFERENCES hyperfide.provider_capacity_attestations(organisation_id,id);
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.provider_capacity_attestations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER provider_capacity_declaration_immutable BEFORE UPDATE OR DELETE ON hyperfide.provider_capacity_attestations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','pool_id','configuration_digest','provenance_run_id','provenance_artifact_id','provenance_digest','declaration_digest','declaration','declared_at','expires_at','created_at');

ALTER TABLE hyperfide.provider_remote_operations ADD CONSTRAINT provider_remote_operation_run_identity UNIQUE(organisation_id,run_id,id);
ALTER TABLE hyperfide.provider_remote_observations ADD CONSTRAINT provider_remote_observation_run FOREIGN KEY(organisation_id,run_id,remote_operation_id) REFERENCES hyperfide.provider_remote_operations(organisation_id,run_id,id);
CREATE TABLE hyperfide.provider_process_archives (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,remote_operation_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,boot_generation bigint NOT NULL,
 process_ref text NOT NULL,native_process_ref text NOT NULL,payload_digest hyperfide.digest NOT NULL,
 index_artifact_id uuid NOT NULL,index_digest hyperfide.digest NOT NULL,index_receipt_id text NOT NULL,index_size_bytes bigint NOT NULL CHECK(index_size_bytes>=0),
 evidence_digest hyperfide.digest NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),UNIQUE(organisation_id,remote_operation_id),
 FOREIGN KEY(organisation_id,run_id,remote_operation_id) REFERENCES hyperfide.provider_remote_operations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,index_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.provider_process_archive_links (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,archive_id uuid NOT NULL,artifact_id uuid NOT NULL,artifact_digest hyperfide.digest NOT NULL,
 receipt_id text NOT NULL,size_bytes bigint NOT NULL CHECK(size_bytes>=0),role text NOT NULL CHECK(role IN ('TOP_INDEX','SEGMENT')),ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 8192),
 PRIMARY KEY(organisation_id,run_id,archive_id,role,ordinal),
 FOREIGN KEY(organisation_id,run_id,archive_id) REFERENCES hyperfide.provider_process_archives(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.provider_archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Provider output archive custody is immutable' USING ERRCODE='23514'; END $$;
DO $$ DECLARE table_name text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['provider_process_archives','provider_process_archive_links'] LOOP
  EXECUTE format('CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',table_name);
  EXECUTE format('CREATE TRIGGER archive_identity_immutable BEFORE UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.provider_archive_immutable()',table_name);
 END LOOP;
END $$;

ALTER TABLE hyperfide.provisioning_intent_reservations ADD CONSTRAINT provider_physical_reservation_once UNIQUE(organisation_id,run_id,reservation_id);
CREATE TRIGGER provider_observation_identity_immutable BEFORE UPDATE OR DELETE ON hyperfide.provider_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','intent_id','operation_id','payload_digest','observation','observed_at','evidence_digest');
