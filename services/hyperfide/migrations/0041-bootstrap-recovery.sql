-- Trusted offline replacement of a lost or compromised bootstrap operator.
-- One append-only chain per run, rooted at the immutable initial issuance; migrations run only in the isolated trusted job.
CREATE TABLE hyperfide.identity_bootstrap_recoveries (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 recovery_id uuid NOT NULL,
 previous_credential_id uuid NOT NULL,
 credential_id uuid NOT NULL CHECK(credential_id<>previous_credential_id),
 accepted_revision_digest hyperfide.digest NOT NULL,
 authority_epoch uuid NOT NULL,
 reason text NOT NULL CHECK(reason IN ('LOST','COMPROMISED','EXPIRED')),
 request_digest hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,generation),
 UNIQUE(recovery_id),
 UNIQUE(credential_id),
 UNIQUE(organisation_id,run_id,previous_credential_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.identity_bootstrap_issuances(organisation_id,run_id),
 FOREIGN KEY(organisation_id,run_id,previous_credential_id)
  REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id),
 FOREIGN KEY(organisation_id,run_id,credential_id)
  REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE
 ON hyperfide.identity_bootstrap_recoveries FOR EACH ROW
 EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE FUNCTION hyperfide.protect_bootstrap_recovery() RETURNS trigger
 LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$ BEGIN
 RAISE EXCEPTION 'Bootstrap recovery history is append-only' USING ERRCODE='23514';
 END $$;
CREATE TRIGGER immutable_recovery BEFORE UPDATE OR DELETE
 ON hyperfide.identity_bootstrap_recoveries FOR EACH ROW
 EXECUTE FUNCTION hyperfide.protect_bootstrap_recovery();
