CREATE TABLE hyperfide.review_repair_reproductions (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL,
 request_id uuid NOT NULL, request_digest hyperfide.digest NOT NULL,
 repair_id uuid NOT NULL, qualification_job_id uuid NOT NULL,
 effective_receipt_digest hyperfide.digest NOT NULL, qualification_receipt_digest hyperfide.digest NOT NULL,
 origin_registry_digest hyperfide.digest NOT NULL, check_definition_digest hyperfide.digest NOT NULL,
 template_id text NOT NULL, original_evidence_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,repair_id) REFERENCES hyperfide.finding_repairs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,qualification_job_id) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,original_evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id)
);
CREATE TRIGGER authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.review_repair_reproductions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON hyperfide.review_repair_reproductions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.review_history_guard();
