-- Offline first-operator issuance; migrations run only in the isolated trusted job.
CREATE TABLE hyperfide.identity_bootstrap_issuances (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 credential_id uuid NOT NULL,
 accepted_revision_digest hyperfide.digest NOT NULL,
 authority_epoch uuid NOT NULL,
 request_digest hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id),
 UNIQUE(credential_id),
 FOREIGN KEY(organisation_id,run_id,credential_id)
  REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE
 ON hyperfide.identity_bootstrap_issuances FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE FUNCTION hyperfide.protect_bootstrap_issuance() RETURNS trigger
 LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Offline bootstrap issuance history is immutable' USING ERRCODE='23514';
 END $$;
CREATE TRIGGER immutable_issuance BEFORE UPDATE OR DELETE
 ON hyperfide.identity_bootstrap_issuances FOR EACH ROW
 EXECUTE FUNCTION hyperfide.protect_bootstrap_issuance();
