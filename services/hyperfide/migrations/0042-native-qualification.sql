-- Per-connector native CLI authentication-mode qualification records; applied only by the trusted release migration runner.
-- No credential bytes, tokens, account identifiers, auth-status output or host auth paths are stored here.
CREATE TABLE hyperfide.native_auth_qualifications (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 connector text NOT NULL CHECK(connector IN ('claude','codex')),
 auth_mode text NOT NULL CHECK(auth_mode IN ('account_session','api_credential')),
 profile_id hyperfide.name NOT NULL, profile_digest hyperfide.digest NOT NULL,
 cli_version hyperfide.name NOT NULL, cli_digest hyperfide.digest NOT NULL,
 operator_config_revision hyperfide.name NOT NULL, operator_config_digest hyperfide.digest NOT NULL,
 operator_selected_mode text NOT NULL CHECK(operator_selected_mode IN ('UNRESOLVED','account_session','api_credential')),
 guidance_reference hyperfide.name NOT NULL,
 concurrent_refresh_guidance text NOT NULL CHECK(concurrent_refresh_guidance IN ('UNSUPPORTED','SERIALISED_ONLY','ASSUMED_SAFE')),
 renewal_assumption_hours integer NOT NULL CHECK(renewal_assumption_hours BETWEEN 1 AND 8760),
 probe_outcome text NOT NULL CHECK(probe_outcome IN ('AUTHENTICATED','AUTH_BLOCKED','NOT_RUN')),
 refresh_race text NOT NULL CHECK(refresh_race IN ('SERIALISED','UNSAFE')),
 state text NOT NULL CHECK(state IN ('BLOCKED','PROBED_UNQUALIFIED')),
 blocked_reasons text[] NOT NULL CHECK(cardinality(blocked_reasons)<=16 AND array_position(blocked_reasons,NULL) IS NULL),
 live_qualified boolean NOT NULL DEFAULT false CHECK(NOT live_qualified),
 portability_qualified boolean NOT NULL DEFAULT false CHECK(NOT portability_qualified),
 endurance_72h text NOT NULL DEFAULT 'NOT_CLAIMED' CHECK(endurance_72h='NOT_CLAIMED'),
 record_digest hyperfide.digest NOT NULL,
 recorded_by uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 CHECK((state='BLOCKED')=(cardinality(blocked_reasons)>0)),
 CHECK(state='BLOCKED' OR (probe_outcome='AUTHENTICATED' AND refresh_race='SERIALISED')),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE INDEX native_auth_qualifications_latest ON hyperfide.native_auth_qualifications(organisation_id,run_id,connector,auth_mode,created_at DESC,id DESC);
-- Refresh state lineage holds only a digest of the refreshed state; writes are compare-and-set on generation.
CREATE TABLE hyperfide.native_auth_refresh_lineage (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, lineage_id hyperfide.name NOT NULL,
 generation bigint NOT NULL CHECK(generation>0), state_digest hyperfide.digest NOT NULL,
 writer_operation_id uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,lineage_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.native_auth_qualifications FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.native_auth_refresh_lineage FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE FUNCTION hyperfide.native_auth_qualification_append_only() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN RAISE EXCEPTION 'Native authentication qualification records are append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER native_auth_qualification_immutable BEFORE UPDATE OR DELETE ON hyperfide.native_auth_qualifications FOR EACH ROW EXECUTE FUNCTION hyperfide.native_auth_qualification_append_only();
CREATE FUNCTION hyperfide.native_auth_refresh_monotonic() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Native refresh lineage cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.generation<>OLD.generation+1 THEN RAISE EXCEPTION 'Native refresh lineage must advance by exactly one generation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER native_auth_refresh_monotonic BEFORE UPDATE OR DELETE ON hyperfide.native_auth_refresh_lineage FOR EACH ROW EXECUTE FUNCTION hyperfide.native_auth_refresh_monotonic();
