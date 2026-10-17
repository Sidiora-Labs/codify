-- Documentation closure is independent of connector exit and programme self-report.
-- Applied only by the dedicated task4.4 migration operator.
CREATE TABLE hyperfide.documentation_packets (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL,
 spec_revision_id uuid NOT NULL,
 spec_generation bigint NOT NULL CHECK(spec_generation>=1),
 authority_epoch uuid NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 programme_manifest_digest hyperfide.digest NOT NULL,
 packet_digest hyperfide.digest NOT NULL,
 canonical_content text NOT NULL CHECK(octet_length(canonical_content)<=67108864),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 UNIQUE(organisation_id,run_id,id,packet_digest),
 FOREIGN KEY(organisation_id,run_id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id),
 CHECK(payload=canonical_content::jsonb),
 CHECK(packet_digest='sha256:'||encode(sha256(convert_to(canonical_content,'UTF8')),'hex'))
);
CREATE TABLE hyperfide.documentation_jobs (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL,
 packet_id uuid NOT NULL,
 packet_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','UNKNOWN')),
 generation bigint NOT NULL DEFAULT 1 CHECK(generation>=1),
 verifier_session_id uuid,
 lease_expires_at timestamptz,
 policy_digest hyperfide.digest NOT NULL,
 remote_operation_id uuid NOT NULL,
 prepared_permit_digest hyperfide.digest,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 UNIQUE(organisation_id,run_id,id,packet_id,generation),
 FOREIGN KEY(organisation_id,run_id,packet_id,packet_digest) REFERENCES hyperfide.documentation_packets(organisation_id,run_id,id,packet_digest),
 FOREIGN KEY(organisation_id,run_id,verifier_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 CHECK(state<>'RUNNING' OR (verifier_session_id IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE TABLE hyperfide.documentation_checks (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 packet_id uuid NOT NULL,
 job_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>=1),
 outcome text NOT NULL CHECK(outcome IN ('PASS','FAIL','UNKNOWN')),
 checker_receipt_digest hyperfide.digest NOT NULL,
 canonical_content text NOT NULL CHECK(octet_length(canonical_content)<=67108864),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,job_id,generation),
 UNIQUE(organisation_id,run_id,id,checker_receipt_digest),
 UNIQUE(organisation_id,run_id,id,packet_id),
 FOREIGN KEY(organisation_id,run_id,packet_id) REFERENCES hyperfide.documentation_packets(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,job_id,packet_id,generation) REFERENCES hyperfide.documentation_jobs(organisation_id,run_id,id,packet_id,generation),
 CHECK(payload=canonical_content::jsonb),
 CHECK(checker_receipt_digest='sha256:'||encode(sha256(convert_to(canonical_content,'UTF8')),'hex'))
);
CREATE TABLE hyperfide.documentation_baselines (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 packet_id uuid NOT NULL,
 check_id uuid NOT NULL,
 baseline_digest hyperfide.digest NOT NULL,
 snapshot_digest hyperfide.digest NOT NULL,
 canonical_content text NOT NULL CHECK(octet_length(canonical_content)<=67108864),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,id,baseline_digest,snapshot_digest),
 UNIQUE(organisation_id,run_id,packet_id,check_id),
 FOREIGN KEY(organisation_id,run_id,packet_id) REFERENCES hyperfide.documentation_packets(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,check_id,packet_id) REFERENCES hyperfide.documentation_checks(organisation_id,run_id,id,packet_id),
 CHECK(payload=canonical_content::jsonb),
 CHECK(baseline_digest='sha256:'||encode(sha256(convert_to(canonical_content,'UTF8')),'hex'))
);
CREATE TABLE hyperfide.documentation_closures (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 packet_id uuid NOT NULL,
 check_id uuid NOT NULL,
 baseline_id uuid NOT NULL,
 baseline_digest hyperfide.digest NOT NULL,
 snapshot_digest hyperfide.digest NOT NULL,
 checker_receipt_digest hyperfide.digest NOT NULL,
 closure_digest hyperfide.digest NOT NULL,
 canonical_content text NOT NULL CHECK(octet_length(canonical_content)<=1048576),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,packet_id,check_id,baseline_id),
 FOREIGN KEY(organisation_id,run_id,packet_id) REFERENCES hyperfide.documentation_packets(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,check_id,checker_receipt_digest) REFERENCES hyperfide.documentation_checks(organisation_id,run_id,id,checker_receipt_digest),
 FOREIGN KEY(organisation_id,run_id,baseline_id,baseline_digest,snapshot_digest) REFERENCES hyperfide.documentation_baselines(organisation_id,run_id,id,baseline_digest,snapshot_digest),
 CHECK(payload=canonical_content::jsonb),
 CHECK(closure_digest='sha256:'||encode(sha256(convert_to(canonical_content,'UTF8')),'hex'))
);
CREATE TABLE hyperfide.release_records (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 spec_revision_id uuid NOT NULL,
 spec_generation bigint NOT NULL CHECK(spec_generation>=1),
 authority_epoch uuid NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 programme_manifest_digest hyperfide.digest NOT NULL,
 contract_digest hyperfide.digest NOT NULL,
 inventory_digest hyperfide.digest NOT NULL,
 record_digest hyperfide.digest NOT NULL,
 artifact_id uuid NOT NULL,
 artifact_digest hyperfide.digest NOT NULL,
 canonical_content text NOT NULL CHECK(octet_length(canonical_content)<=1048576),
 payload jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,record_digest),
 FOREIGN KEY(organisation_id,run_id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 CHECK(payload=canonical_content::jsonb),
 CHECK(record_digest='sha256:'||encode(sha256(convert_to(canonical_content,'UTF8')),'hex'))
);
CREATE FUNCTION hyperfide.protect_documentation_record() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN RAISE EXCEPTION 'documentation evidence is immutable' USING ERRCODE='23514'; END $$;
DO $$
DECLARE relation text;
BEGIN
 FOREACH relation IN ARRAY ARRAY['documentation_packets','documentation_jobs','documentation_checks','documentation_baselines','documentation_closures','release_records'] LOOP
 EXECUTE format('CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',relation);
 IF relation<>'documentation_jobs' THEN
 EXECUTE format('CREATE TRIGGER immutable_documentation BEFORE UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_documentation_record()',relation);
 END IF;
 END LOOP;
END $$;
CREATE INDEX documentation_current ON hyperfide.documentation_packets(organisation_id,run_id,spec_revision_id,spec_generation,source_manifest_digest,programme_manifest_digest);
CREATE INDEX documentation_job_reconcile ON hyperfide.documentation_jobs(organisation_id,run_id,state,lease_expires_at);
