-- Pin dependency meaning to accepted predecessor intent. Legacy v0 rows are never authority.
ALTER TABLE hyperfide.task_dependencies
 ADD COLUMN binding_schema_version integer NOT NULL DEFAULT 0 CHECK(binding_schema_version IN (0,1)),
 ADD COLUMN predecessor_spec_generation bigint CHECK(predecessor_spec_generation>=1),
 ADD COLUMN predecessor_spec_revision_id uuid,
 ADD COLUMN predecessor_repository_id uuid,
 ADD COLUMN integration_ref hyperfide.git_ref,
 ADD CONSTRAINT exact_dependency_binding CHECK(binding_schema_version=0 OR
  (predecessor_spec_generation IS NOT NULL AND predecessor_spec_revision_id IS NOT NULL AND
   (milestone<>'INTEGRATED' OR (predecessor_repository_id IS NOT NULL AND integration_ref IS NOT NULL)))),
 ADD CONSTRAINT dependency_accepted_revision FOREIGN KEY
  (organisation_id,predecessor_run_id,predecessor_spec_generation,predecessor_spec_revision_id)
  REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id),
 ADD CONSTRAINT dependency_repository FOREIGN KEY
  (organisation_id,predecessor_run_id,predecessor_repository_id)
  REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id);
DROP TRIGGER immutable_binding ON hyperfide.task_dependencies;
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.task_dependencies
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields(
 'organisation_id','run_id','task_id','predecessor_run_id','predecessor_task_id','milestone','revision',
 'binding_schema_version','predecessor_spec_generation','predecessor_spec_revision_id',
 'predecessor_repository_id','integration_ref');
CREATE INDEX dependency_exact_predecessor ON hyperfide.task_dependencies
 (organisation_id,predecessor_run_id,predecessor_task_id,predecessor_spec_generation)
 WHERE binding_schema_version=1;
