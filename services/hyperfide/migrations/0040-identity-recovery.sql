-- Trusted offline accepted-intent recovery receipts. No HTTP or runtime schema repair.
CREATE TABLE hyperfide.identity_run_rebindings (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, recovery_operation_id uuid NOT NULL,
 deployment_id uuid NOT NULL, activation_operation_id uuid NOT NULL,
 source_epoch uuid NOT NULL, target_epoch uuid NOT NULL CHECK(source_epoch<>target_epoch),
 spec_generation bigint NOT NULL CHECK(spec_generation>0), spec_revision_id uuid NOT NULL,
 accepted_revision_digest hyperfide.digest NOT NULL, input_digest hyperfide.digest NOT NULL,
 intent_digest hyperfide.digest NOT NULL, receipt_digest hyperfide.digest NOT NULL,
 evidence_scope text NOT NULL CHECK(evidence_scope IN ('LIVE_PROVIDER','ISOLATED_POSTGRESQL_FIXTURE')),
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,recovery_operation_id),
 UNIQUE(deployment_id,recovery_operation_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TRIGGER identity_recovery_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.identity_run_rebindings FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE FUNCTION hyperfide.identity_rebind_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN RAISE EXCEPTION 'Identity recovery receipts are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER identity_recovery_immutable BEFORE UPDATE OR DELETE ON hyperfide.identity_run_rebindings FOR EACH ROW EXECUTE FUNCTION hyperfide.identity_rebind_append_only();
