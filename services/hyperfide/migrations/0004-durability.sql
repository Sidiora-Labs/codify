-- Dedicated migration identity applies this file; runtime identities do not run DDL.
CREATE TABLE hyperfide.authority_epochs (
 deployment_id uuid NOT NULL,
 epoch uuid NOT NULL,
 previous_epoch uuid,
 database_predecessor_epoch uuid,
 activation_kind text NOT NULL CHECK(activation_kind IN ('BOOTSTRAP','ROTATE','RESTORE')),
 state text NOT NULL CHECK(state IN ('ACTIVE','REVOKED')),
 fence_id text NOT NULL CHECK(length(fence_id)>0),
 proof_digest text NOT NULL CHECK(proof_digest ~ '^sha256:[0-9a-f]{64}$'),
 activated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(deployment_id,epoch)
);
CREATE UNIQUE INDEX authority_one_active_epoch ON hyperfide.authority_epochs(deployment_id) WHERE state='ACTIVE';
CREATE TABLE hyperfide.authority_activations (
 operation_id uuid PRIMARY KEY,
 deployment_id uuid NOT NULL,
 epoch uuid NOT NULL,
 request_digest text NOT NULL CHECK(request_digest ~ '^sha256:[0-9a-f]{64}$'),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(deployment_id,epoch) REFERENCES hyperfide.authority_epochs(deployment_id,epoch)
);
CREATE TRIGGER authority_epochs_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.authority_epochs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER authority_activations_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.authority_activations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.authority_epochs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('deployment_id','epoch','previous_epoch','database_predecessor_epoch','activation_kind','fence_id','proof_digest','activated_at');
CREATE TRIGGER immutable_activation BEFORE UPDATE OR DELETE ON hyperfide.authority_activations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('operation_id','deployment_id','epoch','request_digest','accepted_at');
REVOKE CREATE ON SCHEMA hyperfide FROM PUBLIC;
REVOKE ALL ON hyperfide.schema_migrations FROM PUBLIC;

CREATE FUNCTION hyperfide.prevent_epoch_reactivation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF OLD.state='REVOKED' AND NEW.state<>'REVOKED' THEN
  RAISE EXCEPTION 'revoked authority cannot be reactivated' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER no_epoch_reactivation BEFORE UPDATE ON hyperfide.authority_epochs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.prevent_epoch_reactivation();

-- Match the published bounded environment profile contract without altering migration0001.
ALTER TABLE hyperfide.environment_profiles DROP CONSTRAINT environment_profiles_manifest_check;
ALTER TABLE hyperfide.environment_profiles ADD CONSTRAINT environment_profiles_manifest_check CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=67108864);

-- Every semantic writer updates this existing row before mutation. SERIALIZABLE
-- readers lock it FOR SHARE so stale waiting snapshots abort and retry.
ALTER TABLE hyperfide.runs ADD COLUMN semantic_generation bigint NOT NULL DEFAULT 1 CHECK(semantic_generation>0);

-- Keep synchronization bookkeeping separate from business run/control revisions.
CREATE FUNCTION hyperfide.run_monotonic_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF NEW.spec_generation<OLD.spec_generation OR NEW.semantic_generation<OLD.semantic_generation THEN
  RAISE EXCEPTION 'run generations cannot decrease' USING ERRCODE='23514';
 END IF;
 IF NEW.semantic_generation IS DISTINCT FROM OLD.semantic_generation AND NEW.semantic_generation<>OLD.semantic_generation+1 THEN
  RAISE EXCEPTION 'semantic generation advances one step' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(NEW)-'semantic_generation') IS DISTINCT FROM (to_jsonb(OLD)-'semantic_generation') AND NEW.state_version<=OLD.state_version THEN
  RAISE EXCEPTION 'business state_version must advance' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DROP TRIGGER monotonic_version ON hyperfide.runs;
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.runs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.run_monotonic_fields();
