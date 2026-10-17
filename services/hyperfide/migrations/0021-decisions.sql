-- Task 21.4: advisory data cannot stand in for operational authority.
CREATE TABLE hyperfide.decision_packets (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 purpose text NOT NULL CHECK(purpose IN ('spec_critique','recovery','ranking','legacy.guard','legacy.readiness','legacy.triage','legacy.memory','legacy.recap')),
 packet_hash hyperfide.digest NOT NULL, revision jsonb NOT NULL,
 content jsonb NOT NULL CHECK(jsonb_typeof(content)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL,
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 CHECK(expires_at>created_at), CHECK(octet_length(content::text)<=1048576)
);
CREATE TABLE hyperfide.decision_audits (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 packet_id uuid NOT NULL, packet_hash hyperfide.digest NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 payload_hash hyperfide.digest NOT NULL, status text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,packet_id) REFERENCES hyperfide.decision_packets(organisation_id,run_id,id),
 CHECK(status IN ('accepted_advice','abstained','invalid_response','unsupported','expired','cancelled','unavailable','budget_exhausted')),
 CHECK(octet_length(payload::text)<=1048576)
);
CREATE TABLE hyperfide.decision_proposals (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 audit_id uuid NOT NULL, payload jsonb NOT NULL, payload_hash hyperfide.digest NOT NULL,
 state text NOT NULL CHECK(state IN ('PROPOSED_UNVALIDATED','STRUCTURALLY_VALID','REJECTED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,audit_id) REFERENCES hyperfide.decision_audits(organisation_id,run_id,id),
 CHECK(jsonb_typeof(payload)='object'), CHECK(octet_length(payload::text)<=1048576)
);
CREATE TABLE hyperfide.decision_outcomes (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL, audit_id uuid NOT NULL,
 payload jsonb NOT NULL, payload_hash hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,audit_id) REFERENCES hyperfide.decision_audits(organisation_id,run_id,id),
 CHECK(jsonb_typeof(payload)='object'), CHECK(octet_length(payload::text)<=262144)
);
CREATE FUNCTION hyperfide.immutable_decision_record() RETURNS trigger LANGUAGE plpgsql
 SET search_path=pg_catalog,hyperfide AS $$ BEGIN
 RAISE EXCEPTION 'decision history is append only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_decision_packet BEFORE UPDATE OR DELETE ON hyperfide.decision_packets FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_decision_record();
CREATE TRIGGER immutable_decision_audit BEFORE UPDATE OR DELETE ON hyperfide.decision_audits FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_decision_record();
CREATE TRIGGER immutable_decision_proposal BEFORE UPDATE OR DELETE ON hyperfide.decision_proposals FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_decision_record();
CREATE TRIGGER immutable_decision_outcome BEFORE UPDATE OR DELETE ON hyperfide.decision_outcomes FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_decision_record();
REVOKE ALL ON hyperfide.decision_packets,hyperfide.decision_audits,hyperfide.decision_proposals,hyperfide.decision_outcomes FROM PUBLIC;

-- Audit traversal stays bounded without scanning unrelated run outcomes.
CREATE INDEX decision_outcomes_audit_cursor ON hyperfide.decision_outcomes(organisation_id,run_id,audit_id,created_at,id);

CREATE TRIGGER aaa_decision_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_packets
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_decision_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_audits
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_decision_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_proposals
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_decision_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.decision_outcomes
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
