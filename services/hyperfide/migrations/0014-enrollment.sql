-- Identity authority; applied only by the trusted release migration runner.
CREATE TABLE hyperfide.identity_principals (
 credential_id uuid PRIMARY KEY,
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, actor_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('OPERATOR','LEADER','FEATURE_MANAGER','COORDINATOR','PROVISIONER','DISPATCH','RUNNER','WORKER','COMMIT_WATCHER','ISSUE_WATCHER','VERIFIER','INTEGRATOR','INDEXER','GITHUB_MIRROR')),
 public_key_b64 text NOT NULL CHECK(public_key_b64 ~ '^[A-Za-z0-9_-]{43}$'),
 deployment_epoch uuid NOT NULL, credential_version bigint NOT NULL DEFAULT 1 CHECK(credential_version>0),
 sandbox_id uuid, boot_generation bigint CHECK(boot_generation>0), boot_id uuid,
 attempt_id uuid, attempt_generation bigint CHECK(attempt_generation>0),
 allowed_actions text[] NOT NULL CHECK(cardinality(allowed_actions) BETWEEN 1 AND 256 AND array_position(allowed_actions,NULL) IS NULL),
 expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','REVOKED','QUARANTINED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organisation_id,run_id,credential_id),
 CHECK((sandbox_id IS NULL)=(boot_generation IS NULL) AND (sandbox_id IS NULL)=(boot_id IS NULL)),
 CHECK((attempt_id IS NULL)=(attempt_generation IS NULL)),
 CHECK(role<>'RUNNER' OR sandbox_id IS NOT NULL),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation)
);
CREATE UNIQUE INDEX identity_one_live_runner_boot ON hyperfide.identity_principals(organisation_id,sandbox_id,boot_generation) WHERE role='RUNNER' AND state='ACTIVE';
CREATE TABLE hyperfide.identity_provider_bindings (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, provisioning_intent_id uuid NOT NULL,
 sandbox_id uuid NOT NULL, pool_id uuid NOT NULL, boot_generation bigint NOT NULL CHECK(boot_generation>0),
 boot_id uuid NOT NULL, native_sandbox_id hyperfide.name NOT NULL,
 observation_digest hyperfide.digest NOT NULL, observed_by uuid NOT NULL,
 sandbox_version bigint NOT NULL CHECK(sandbox_version>0),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,provisioning_intent_id),
 UNIQUE(organisation_id,run_id,provisioning_intent_id,sandbox_id,boot_generation),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,observed_by) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TABLE hyperfide.identity_enrollment_grants (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, run_id uuid NOT NULL,
 provisioning_intent_id uuid NOT NULL, sandbox_id uuid NOT NULL, boot_generation bigint NOT NULL CHECK(boot_generation>0),
 boot_id uuid NOT NULL, verifier hyperfide.digest NOT NULL, deployment_epoch uuid NOT NULL,
 allowed_actions text[] NOT NULL CHECK(cardinality(allowed_actions) BETWEEN 1 AND 256 AND array_position(allowed_actions,NULL) IS NULL),
 expires_at timestamptz NOT NULL, credential_expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'ISSUED' CHECK(state IN ('ISSUED','CONSUMED','REVOKED','QUARANTINED')),
 credential_id uuid REFERENCES hyperfide.identity_principals(credential_id),
 consumed_operation_id uuid, consumed_payload_digest hyperfide.digest,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='CONSUMED')=(credential_id IS NOT NULL) OR state IN ('REVOKED','QUARANTINED')),
 FOREIGN KEY(organisation_id,run_id,provisioning_intent_id,sandbox_id,boot_generation)
  REFERENCES hyperfide.identity_provider_bindings(organisation_id,run_id,provisioning_intent_id,sandbox_id,boot_generation)
);
CREATE TABLE hyperfide.identity_request_nonces (
 credential_id uuid NOT NULL REFERENCES hyperfide.identity_principals(credential_id),
 nonce uuid NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(credential_id,nonce)
);
CREATE TABLE hyperfide.identity_enrollment_nonces (
 grant_id uuid NOT NULL REFERENCES hyperfide.identity_enrollment_grants(id),
 nonce uuid NOT NULL, received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(grant_id,nonce)
);
CREATE TABLE hyperfide.identity_operation_results (
 scope_id uuid NOT NULL, operation text NOT NULL CHECK(length(operation) BETWEEN 1 AND 128),
 idempotency_key uuid NOT NULL, operation_id uuid NOT NULL,
 payload_digest hyperfide.digest NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scope_id,operation,idempotency_key), UNIQUE(scope_id,operation_id)
);
-- Secret values remain in a separate supervisor-only secret store, never these metadata rows.
CREATE TABLE hyperfide.identity_credential_references (
 purposes text[] NOT NULL CHECK(cardinality(purposes) BETWEEN 1 AND 4 AND purposes <@ ARRAY['WORKER_BUILD','WORKER_RUNTIME','WORKER_PROCESS','PROVIDER_API']::text[]),
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, reference_id hyperfide.name NOT NULL,
 credential_version bigint NOT NULL CHECK(credential_version>0), secret_locator hyperfide.name NOT NULL,
 refresh_owner uuid NOT NULL, allowed_layers text[] NOT NULL CHECK(cardinality(allowed_layers)>0),
 allowed_roles text[] NOT NULL CHECK(cardinality(allowed_roles)>0),
 state text NOT NULL CHECK(state IN ('AVAILABLE','REVOKED','AUTH_BLOCKED')),
 expires_at timestamptz NOT NULL, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,reference_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TABLE hyperfide.identity_credential_attachments (
 id uuid PRIMARY KEY, organisation_id uuid NOT NULL, run_id uuid NOT NULL,
 reference_id hyperfide.name NOT NULL, credential_version bigint NOT NULL CHECK(credential_version>0),
 actor_id uuid NOT NULL, attempt_id uuid, target_uid integer NOT NULL CHECK(target_uid>=0),
 layer text NOT NULL CHECK(layer IN ('build','runtime','process')),
 locator hyperfide.name NOT NULL, expires_at timestamptz NOT NULL,
 state text NOT NULL CHECK(state IN ('AVAILABLE','REVOKED')),
 FOREIGN KEY(organisation_id,run_id,reference_id) REFERENCES hyperfide.identity_credential_references(organisation_id,run_id,reference_id)
);

CREATE TABLE hyperfide.identity_runner_status (
 credential_id uuid PRIMARY KEY REFERENCES hyperfide.identity_principals(credential_id),
 preparation_digest hyperfide.digest NOT NULL,
 inventory jsonb NOT NULL CHECK(jsonb_typeof(inventory)='array'),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>0),
 heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

-- Restoring a disk must never recycle an earlier RUNNER private-key lineage.
CREATE UNIQUE INDEX identity_runner_key_lineage ON hyperfide.identity_principals(organisation_id,public_key_b64) WHERE role='RUNNER';

-- Every durable identity mutation shares the primary Serializable authority boundary.
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_principals FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_provider_bindings FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_enrollment_grants FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_request_nonces FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_enrollment_nonces FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_operation_results FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_credential_references FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_credential_attachments FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER identity_authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_runner_status FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- Platform reviewers use separate job leases; only coding WORKER identities carry implementation attempts.
ALTER TABLE hyperfide.identity_principals ADD CONSTRAINT identity_worker_attempt CHECK ((role='WORKER')=(attempt_id IS NOT NULL));
