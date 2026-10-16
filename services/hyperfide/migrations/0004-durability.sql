-- Dedicated migration identity applies this file; runtime identities do not run DDL.
CREATE TABLE hyperfide.authority_epochs (
 deployment_id uuid NOT NULL,
 epoch uuid NOT NULL,
 previous_epoch uuid,
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
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('deployment_id','epoch','previous_epoch','fence_id','proof_digest','activated_at');
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
