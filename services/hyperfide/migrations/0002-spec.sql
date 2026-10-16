-- Domain2 foundation, applied explicitly by the versioned migration engine.
-- Raw source identity and accepted run intent are different immutable identities.
ALTER TABLE hyperfide.spec_revisions ADD COLUMN revision_digest hyperfide.digest;
DO $$
DECLARE item record;
BEGIN
 FOR item IN SELECT c.conname FROM pg_constraint c
  WHERE c.conrelid='hyperfide.spec_revisions'::regclass AND c.contype='u'
  AND pg_get_constraintdef(c.oid) LIKE '%source_digest%'
 LOOP EXECUTE format('ALTER TABLE hyperfide.spec_revisions DROP CONSTRAINT %I',item.conname); END LOOP;
END $$;
CREATE UNIQUE INDEX spec_revision_envelope ON hyperfide.spec_revisions(organisation_id,project_id,revision_digest) WHERE revision_digest IS NOT NULL;
ALTER TABLE hyperfide.spec_revisions ADD CONSTRAINT revision_document_identity
 CHECK(revision_digest IS NULL OR (document ? 'revision_digest' AND (document->>'revision_digest') IS NOT DISTINCT FROM revision_digest));
DROP TRIGGER immutable_binding ON hyperfide.spec_revisions;
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.spec_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
'organisation_id','id','project_id','source_digest','source_content','document','schema_version','repository_id','git_object_id','revision_digest');

CREATE TABLE hyperfide.task_revisions (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 task_id uuid NOT NULL,
 spec_generation bigint NOT NULL CHECK(spec_generation>=1),
 spec_revision_id uuid NOT NULL,
 criteria_digest hyperfide.digest NOT NULL,
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=4194304),
 wave integer NOT NULL CHECK(wave>=1),
 recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,task_id,spec_generation),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id) DEFERRABLE INITIALLY DEFERRED,
 FOREIGN KEY(organisation_id,run_id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id)
);
INSERT INTO hyperfide.task_revisions(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,definition,wave)
 SELECT organisation_id,run_id,id,spec_generation,spec_revision_id,criteria_digest,definition,wave FROM hyperfide.tasks;
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.task_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
'organisation_id','run_id','task_id','spec_generation','spec_revision_id','criteria_digest','definition','wave','recorded_at');

CREATE FUNCTION hyperfide.archive_task_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF TG_OP='UPDATE' AND
  (NEW.spec_generation,NEW.spec_revision_id,NEW.criteria_digest,NEW.definition,NEW.wave)
  IS NOT DISTINCT FROM (OLD.spec_generation,OLD.spec_revision_id,OLD.criteria_digest,OLD.definition,OLD.wave) THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.spec_generation<=OLD.spec_generation THEN
  RAISE EXCEPTION 'changed task intent requires a new accepted generation' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM hyperfide.runs WHERE organisation_id=NEW.organisation_id AND id=NEW.run_id
  AND spec_generation=NEW.spec_generation AND spec_revision_id=NEW.spec_revision_id AND (TG_OP='INSERT' OR state='PENDING_VALIDATION')) THEN
  RAISE EXCEPTION 'task intent requires current unvalidated accepted run generation' USING ERRCODE='23514';
 END IF;
 INSERT INTO hyperfide.task_revisions(organisation_id,run_id,task_id,spec_generation,spec_revision_id,criteria_digest,definition,wave)
 VALUES(NEW.organisation_id,NEW.run_id,NEW.id,NEW.spec_generation,NEW.spec_revision_id,NEW.criteria_digest,NEW.definition,NEW.wave);
 RETURN NEW;
END $$;
DROP TRIGGER immutable_binding ON hyperfide.tasks;
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.tasks FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
'organisation_id','run_id','id','task_key','feature_package_id');
CREATE TRIGGER accepted_intent_archive BEFORE INSERT OR UPDATE ON hyperfide.tasks FOR EACH ROW EXECUTE FUNCTION hyperfide.archive_task_revision();

CREATE TABLE hyperfide.spec_amendments (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 base_spec_generation bigint NOT NULL CHECK(base_spec_generation>=1),
 base_spec_revision_id uuid NOT NULL,
 base_state_version bigint NOT NULL CHECK(base_state_version>=1),
 proposal_digest hyperfide.digest NOT NULL,
 proposer_session_id uuid,
 proposal jsonb NOT NULL CHECK(jsonb_typeof(proposal)='object' AND octet_length(proposal::text)<=67108864),
 impact jsonb NOT NULL CHECK(jsonb_typeof(impact)='object' AND octet_length(impact::text)<=4194304),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,proposal_digest),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,base_spec_generation,base_spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id),
 FOREIGN KEY(organisation_id,run_id,proposer_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.spec_amendments FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
'organisation_id','run_id','id','base_spec_generation','base_spec_revision_id','base_state_version','proposal_digest','proposer_session_id','proposal','impact','created_at');
CREATE TABLE hyperfide.spec_amendment_decisions (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 amendment_id uuid NOT NULL,
 decision text NOT NULL CHECK(decision IN ('ACCEPTED','REJECTED')),
 decision_digest hyperfide.digest NOT NULL,
 decision_record jsonb NOT NULL CHECK(jsonb_typeof(decision_record)='object' AND octet_length(decision_record::text)<=4194304),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,amendment_id),
 FOREIGN KEY(organisation_id,run_id,amendment_id) REFERENCES hyperfide.spec_amendments(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.spec_amendment_decisions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
'organisation_id','run_id','amendment_id','decision','decision_digest','decision_record','created_at');

CREATE TABLE hyperfide.proof_registries (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 task_id uuid NOT NULL,
 spec_generation bigint NOT NULL CHECK(spec_generation>=1),
 spec_revision_id uuid NOT NULL,
 criteria_digest hyperfide.digest NOT NULL,
 registry_digest hyperfide.digest NOT NULL,
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object' AND octet_length(policy::text)<=4194304),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,task_id,spec_generation),
 FOREIGN KEY(organisation_id,run_id,task_id,spec_generation) REFERENCES hyperfide.task_revisions(organisation_id,run_id,task_id,spec_generation),
 FOREIGN KEY(organisation_id,run_id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id),
 CHECK(policy ? 'criteria_digest' AND (policy->>'criteria_digest') IS NOT DISTINCT FROM criteria_digest),
 CHECK(policy ? 'spec_revision_id' AND (policy->>'spec_revision_id') IS NOT DISTINCT FROM spec_revision_id::text),
 CHECK(policy ? 'spec_generation' AND (policy->>'spec_generation') IS NOT DISTINCT FROM spec_generation::text)
);
CREATE FUNCTION hyperfide.check_proof_criteria() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hyperfide.task_revisions t WHERE t.organisation_id=NEW.organisation_id AND t.run_id=NEW.run_id
 AND t.task_id=NEW.task_id AND t.spec_generation=NEW.spec_generation AND t.spec_revision_id=NEW.spec_revision_id AND t.criteria_digest=NEW.criteria_digest) THEN
 RAISE EXCEPTION 'proof registry must match immutable task criteria' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER proof_criteria_binding BEFORE INSERT ON hyperfide.proof_registries FOR EACH ROW EXECUTE FUNCTION hyperfide.check_proof_criteria();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.proof_registries FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
'organisation_id','run_id','task_id','spec_generation','spec_revision_id','criteria_digest','registry_digest','policy','created_at');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.task_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.spec_amendments FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.spec_amendment_decisions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.proof_registries FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
