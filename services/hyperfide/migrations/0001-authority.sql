-- Hyperfide authority schema v1. The bootstrap caller owns the transaction and migration lock.
-- Git owns source bytes; artifact backends own object bytes. This schema owns admitted identities.
CREATE SCHEMA hyperfide;
CREATE DOMAIN hyperfide.name AS text CHECK (length(VALUE) BETWEEN 1 AND 255);
CREATE DOMAIN hyperfide.long_name AS text CHECK (length(VALUE) BETWEEN 1 AND 2048);
CREATE DOMAIN hyperfide.digest AS text CHECK (VALUE ~ '^sha256:[0-9a-f]{64}$');
CREATE DOMAIN hyperfide.git_oid AS text CHECK (VALUE ~ '^([0-9a-f]{40}|[0-9a-f]{64})$');
CREATE DOMAIN hyperfide.git_ref AS text CHECK (length(VALUE) BETWEEN 6 AND 1024 AND VALUE LIKE 'refs/%' AND VALUE !~ '[[:space:][:cntrl:]]' AND position('..' in VALUE)=0);
CREATE FUNCTION hyperfide.immutable_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE field text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable history cannot be deleted' USING ERRCODE='23514'; END IF;
  FOREACH field IN ARRAY COALESCE(TG_ARGV,ARRAY[]::text[]) LOOP
    IF (to_jsonb(NEW)->field) IS DISTINCT FROM (to_jsonb(OLD)->field) THEN
      RAISE EXCEPTION 'immutable %.% field %', TG_TABLE_SCHEMA,TG_TABLE_NAME,field USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE FUNCTION hyperfide.monotonic_fields() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE field text;
BEGIN
  IF NEW IS DISTINCT FROM OLD AND NEW.state_version <= OLD.state_version THEN
    RAISE EXCEPTION 'state_version must advance' USING ERRCODE='23514';
  END IF;
  FOREACH field IN ARRAY COALESCE(TG_ARGV,ARRAY[]::text[]) LOOP
    IF (to_jsonb(NEW)->>field)::bigint < (to_jsonb(OLD)->>field)::bigint THEN
      RAISE EXCEPTION '% cannot decrease',field USING ERRCODE='23514';
    END IF;
  END LOOP;
  RETURN NEW;
END $$;
CREATE TABLE hyperfide.schema_migrations (
 version integer PRIMARY KEY CHECK(version>0),
  name hyperfide.name NOT NULL,

 checksum hyperfide.digest NOT NULL,
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE hyperfide.organisations (
id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 name hyperfide.name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1)
);

CREATE TABLE hyperfide.projects (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 name hyperfide.name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,name)
);

CREATE TABLE hyperfide.repositories (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL,
 name hyperfide.name NOT NULL,
 url hyperfide.long_name NOT NULL,
 object_format text NOT NULL DEFAULT 'sha1' CHECK(object_format IN ('sha1','sha256')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,project_id,id),
 UNIQUE(organisation_id,project_id,name),
 FOREIGN KEY(organisation_id,project_id) REFERENCES hyperfide.projects(organisation_id,id)
);

CREATE TABLE hyperfide.source_objects (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 repository_id uuid NOT NULL,
 object_id hyperfide.git_oid NOT NULL,
 object_type text NOT NULL DEFAULT 'commit' CHECK(object_type IN ('commit','tree','blob','tag')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,repository_id) REFERENCES hyperfide.repositories(organisation_id,id)
);

CREATE TABLE hyperfide.spec_revisions (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL,
 source_digest hyperfide.digest NOT NULL,
 source_content text NOT NULL CHECK(octet_length(source_content)<=33554432),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object' AND octet_length(document::text)<=67108864),
 schema_version integer NOT NULL CHECK(schema_version>0),
 repository_id uuid,
 git_object_id hyperfide.git_oid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,project_id,id),
 UNIQUE(organisation_id,project_id,source_digest),
 CHECK((repository_id IS NULL)=(git_object_id IS NULL)),
 CHECK(source_digest='sha256:'||encode(sha256(convert_to(source_content,'UTF8')),'hex')),
 FOREIGN KEY(organisation_id,project_id) REFERENCES hyperfide.projects(organisation_id,id),
 FOREIGN KEY(organisation_id,project_id,repository_id) REFERENCES hyperfide.repositories(organisation_id,project_id,id),
 FOREIGN KEY(organisation_id,repository_id,git_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE TABLE hyperfide.runs (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL,
 spec_revision_id uuid NOT NULL,
 policy_digest hyperfide.digest NOT NULL,
 authority_epoch uuid NOT NULL,
 state text NOT NULL DEFAULT 'PLANNED' CHECK(state IN ('PLANNED','PENDING_VALIDATION','READY','RUNNING','PAUSING','PAUSED','STOPPING','STOPPED','SUCCEEDED','FAILED','CANCELLED')),
 spec_generation bigint NOT NULL DEFAULT 1 CHECK(spec_generation>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,id,project_id),
 FOREIGN KEY(organisation_id,project_id) REFERENCES hyperfide.projects(organisation_id,id),
 FOREIGN KEY(organisation_id,project_id,spec_revision_id) REFERENCES hyperfide.spec_revisions(organisation_id,project_id,id)
);

CREATE TABLE hyperfide.run_spec_revisions (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 spec_generation bigint NOT NULL CHECK(spec_generation>=1),
 spec_revision_id uuid NOT NULL,
 accepted boolean NOT NULL DEFAULT true CHECK(accepted),
 accepted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,spec_generation),
 UNIQUE(organisation_id,run_id,spec_generation,spec_revision_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,spec_revision_id) REFERENCES hyperfide.spec_revisions(organisation_id,id)
);

ALTER TABLE hyperfide.runs ADD CONSTRAINT runs_accepted_spec_fk FOREIGN KEY(organisation_id,id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) DEFERRABLE INITIALLY DEFERRED;
CREATE FUNCTION hyperfide.initial_run_revision() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$ BEGIN INSERT INTO hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id) VALUES(NEW.organisation_id,NEW.id,NEW.spec_generation,NEW.spec_revision_id); RETURN NEW; END $$;
CREATE TRIGGER initial_revision AFTER INSERT ON hyperfide.runs FOR EACH ROW EXECUTE FUNCTION hyperfide.initial_run_revision();
CREATE FUNCTION hyperfide.check_run_revision_project() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$ BEGIN IF NOT EXISTS(SELECT 1 FROM hyperfide.runs r JOIN hyperfide.spec_revisions s ON s.organisation_id=r.organisation_id AND s.project_id=r.project_id WHERE r.organisation_id=NEW.organisation_id AND r.id=NEW.run_id AND s.id=NEW.spec_revision_id) THEN RAISE EXCEPTION 'accepted spec must belong to run project' USING ERRCODE='23503'; END IF; RETURN NEW; END $$;
CREATE TRIGGER revision_project BEFORE INSERT ON hyperfide.run_spec_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.check_run_revision_project();

CREATE TABLE hyperfide.run_repositories (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 integration_ref hyperfide.git_ref NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE TABLE hyperfide.feature_packages (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 package_key hyperfide.name NOT NULL,
 wave integer NOT NULL CHECK(wave>=1),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 manager_session_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,package_key,revision)
);

CREATE TABLE hyperfide.tasks (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 task_key hyperfide.name NOT NULL,
 feature_package_id uuid NOT NULL,
 spec_revision_id uuid NOT NULL,
 spec_generation bigint NOT NULL DEFAULT 1 CHECK(spec_generation>=1),
 criteria_digest hyperfide.digest NOT NULL,
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=4194304),
 wave integer NOT NULL CHECK(wave>=1),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY','RESERVED','PREPARING','RUNNING','SUBMITTED','QUALIFYING','QUALIFIED','INTEGRATING','INTEGRATED','FAILED','CANCELLED','BLOCKED','STALE')),
 generation bigint NOT NULL DEFAULT 0 CHECK(generation>=0),
 current_attempt_id uuid,
 current_custody_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,task_key),
 FOREIGN KEY(organisation_id,run_id,feature_package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,spec_generation,spec_revision_id) REFERENCES hyperfide.run_spec_revisions(organisation_id,run_id,spec_generation,spec_revision_id)
);

CREATE TABLE hyperfide.task_dependencies (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 task_id uuid NOT NULL,
 predecessor_run_id uuid NOT NULL,
 predecessor_task_id uuid NOT NULL,
 milestone text NOT NULL CHECK(milestone IN ('QUALIFIED','INTEGRATED','RELEASED')),
 revision bigint NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,task_id,predecessor_run_id,predecessor_task_id,milestone,revision),
 CHECK(run_id<>predecessor_run_id OR task_id<>predecessor_task_id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,predecessor_run_id,predecessor_task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.environment_profiles (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 content_digest hyperfide.digest NOT NULL,
 provider hyperfide.name NOT NULL,
 runtime_platform hyperfide.name NOT NULL,
 manifest jsonb NOT NULL CHECK(jsonb_typeof(manifest)='object' AND octet_length(manifest::text)<=4194304),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,content_digest)
);

CREATE TABLE hyperfide.provider_pools (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 provider hyperfide.name NOT NULL,
 account_key hyperfide.name NOT NULL,
 environment_key hyperfide.name NOT NULL,
 region hyperfide.name NOT NULL,
 profile_id uuid,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','DRAINING','DISABLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,provider,account_key,environment_key,region,id),
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id)
);

CREATE TABLE hyperfide.capacity_accounts (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 pool_id uuid NOT NULL,
 dimension text NOT NULL CHECK(dimension IN ('SANDBOX','CPU_MILLIS','MEMORY_BYTES','DISK_BYTES','AGENT','BUILD','TEST','INDEX')),
 configured_limit bigint NOT NULL CHECK(configured_limit>=0),
 reserved bigint NOT NULL DEFAULT 0 CHECK(reserved>=0),
 allocated bigint NOT NULL DEFAULT 0 CHECK(allocated>=0),
 provenance_digest hyperfide.digest NOT NULL,
 qualification_state text NOT NULL DEFAULT 'UNQUALIFIED' CHECK(qualification_state IN ('UNQUALIFIED','QUALIFIED','STALE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,pool_id,dimension),
 CHECK(reserved+allocated<=configured_limit),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id)
);

CREATE TABLE hyperfide.reservations (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL,
 capacity_account_id uuid NOT NULL,
 quantity bigint NOT NULL CHECK(quantity>=0),
 attempt_id uuid,
 expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'PROVISIONING' CHECK(state IN ('PROVISIONING','ALLOCATED','RELEASE_PENDING','RELEASED')),
 released_at timestamptz,
 release_reason hyperfide.name,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,request_id,capacity_account_id),
 CHECK((state='RELEASED')=(released_at IS NOT NULL)),
 FOREIGN KEY(organisation_id,capacity_account_id) REFERENCES hyperfide.capacity_accounts(organisation_id,id)
);

CREATE TABLE hyperfide.sandboxes (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 pool_id uuid NOT NULL,
 native_sandbox_id hyperfide.name,
 desired_state text NOT NULL DEFAULT 'RUNNING' CHECK(desired_state IN ('RUNNING','STOPPED','DESTROYED')),
 observed_state text NOT NULL DEFAULT 'UNKNOWN' CHECK(observed_state IN ('UNKNOWN','CREATING','RUNNING','SUSPENDED','STOPPED','DESTROYING','DESTROYED','FAILED')),
 boot_generation bigint NOT NULL DEFAULT 1 CHECK(boot_generation>=1),
 preparation_digest hyperfide.digest,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,pool_id,native_sandbox_id),
 FOREIGN KEY(organisation_id,pool_id) REFERENCES hyperfide.provider_pools(organisation_id,id)
);

CREATE TABLE hyperfide.sandbox_boots (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 sandbox_id uuid NOT NULL,
 boot_generation bigint NOT NULL CHECK(boot_generation>=1),
 boot_id uuid NOT NULL DEFAULT gen_random_uuid(),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,sandbox_id,boot_generation),
 UNIQUE(organisation_id,boot_id),
 FOREIGN KEY(organisation_id,sandbox_id) REFERENCES hyperfide.sandboxes(organisation_id,id)
);

CREATE FUNCTION hyperfide.record_sandbox_boot() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$ BEGIN IF TG_OP='INSERT' OR NEW.boot_generation<>OLD.boot_generation THEN INSERT INTO hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation) VALUES(NEW.organisation_id,NEW.id,NEW.boot_generation); END IF; RETURN NEW; END $$;
CREATE TRIGGER sandbox_boot AFTER INSERT OR UPDATE OF boot_generation ON hyperfide.sandboxes FOR EACH ROW EXECUTE FUNCTION hyperfide.record_sandbox_boot();
CREATE TABLE hyperfide.worker_slots (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 sandbox_id uuid NOT NULL,
 slot_key hyperfide.name NOT NULL,
 boot_generation bigint NOT NULL CHECK(boot_generation>=1),
 capacity_kind text NOT NULL CHECK(capacity_kind IN ('AGENT','BUILD','TEST','INDEX','REVIEW','INTEGRATION')),
 state text NOT NULL DEFAULT 'READY' CHECK(state IN ('READY','ALLOCATED','DRAINING','RETIRED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,id),
 UNIQUE(organisation_id,sandbox_id,slot_key,boot_generation),
 UNIQUE(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation)
);

CREATE TABLE hyperfide.attempts (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>=1),
 authority_epoch uuid NOT NULL,
 input_packet_digest hyperfide.digest NOT NULL,
 kind text NOT NULL DEFAULT 'IMPLEMENTATION' CHECK(kind IN ('IMPLEMENTATION','REVIEW','VERIFICATION','INTEGRATION','INDEX')),
 execution_state text NOT NULL DEFAULT 'PLANNED' CHECK(execution_state IN ('PLANNED','RESERVED','PREPARING','START_REQUESTED','RUNNING','SUBMITTED','SUCCEEDED','FAILED','CANCELLED')),
 compute_authority text NOT NULL DEFAULT 'RELEASED' CHECK(compute_authority IN ('CURRENT','RELEASED','REVOKED','EXPIRED')),
 sandbox_id uuid,
 slot_id uuid,
 sandbox_boot_generation bigint,
 lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,task_id,generation),
 UNIQUE(organisation_id,run_id,id,generation),
 UNIQUE(organisation_id,run_id,task_id,id,generation),
 UNIQUE(organisation_id,run_id,id,generation,authority_epoch,sandbox_boot_generation),
 CHECK((sandbox_id IS NULL)=(slot_id IS NULL) AND (slot_id IS NULL)=(sandbox_boot_generation IS NULL)),
 CHECK(sandbox_boot_generation IS NULL OR sandbox_boot_generation>=1),
 CHECK(compute_authority<>'CURRENT' OR (kind='IMPLEMENTATION' AND slot_id IS NOT NULL AND lease_expires_at IS NOT NULL)),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation)
);

CREATE UNIQUE INDEX attempts_one_current_compute ON hyperfide.attempts(organisation_id,run_id,task_id) WHERE compute_authority='CURRENT';
ALTER TABLE hyperfide.reservations ADD CONSTRAINT reservations_attempt_fk FOREIGN KEY(organisation_id,run_id,attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id);
ALTER TABLE hyperfide.tasks ADD CONSTRAINT tasks_current_attempt_fk FOREIGN KEY(organisation_id,run_id,id,current_attempt_id,generation) REFERENCES hyperfide.attempts(organisation_id,run_id,task_id,id,generation) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE hyperfide.compute_leases (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL CHECK(attempt_generation>=1),
 authority_epoch uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>=1),
 expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','RELEASED','REVOKED','EXPIRED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation,authority_epoch,sandbox_boot_generation)
);

CREATE UNIQUE INDEX compute_leases_one_active ON hyperfide.compute_leases(organisation_id,run_id,attempt_id) WHERE state='ACTIVE';
CREATE TABLE hyperfide.slot_allocations (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 slot_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL,
 attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL,
 reservation_id uuid,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','RELEASE_PENDING','RELEASED')),
 released_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id),
 CHECK((state='RELEASED')=(released_at IS NOT NULL))
);

CREATE UNIQUE INDEX slot_allocations_one_current ON hyperfide.slot_allocations(organisation_id,slot_id) WHERE state IN ('ACTIVE','RELEASE_PENDING');
CREATE TABLE hyperfide.agent_sessions (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 role text NOT NULL CHECK(role IN ('LEADER','FEATURE_MANAGER','WORKER','COMMIT_WATCHER','ISSUE_WATCHER','VERIFIER','INTEGRATOR','INDEXER')),
 parent_session_id uuid,
 connector hyperfide.name NOT NULL,
 account_key hyperfide.name NOT NULL,
 native_session_id hyperfide.name NOT NULL,
 slot_id uuid,
 sandbox_id uuid,
 sandbox_boot_generation bigint,
 attempt_id uuid,
 state text NOT NULL DEFAULT 'REGISTERED' CHECK(state IN ('REGISTERED','RUNNING','DISCONNECTED','STOPPED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 CHECK((slot_id IS NULL)=(sandbox_id IS NULL) AND (slot_id IS NULL)=(sandbox_boot_generation IS NULL)),
 FOREIGN KEY(organisation_id,run_id,parent_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 UNIQUE(organisation_id,connector,account_key,native_session_id,sandbox_id,sandbox_boot_generation)
);

ALTER TABLE hyperfide.feature_packages ADD CONSTRAINT feature_packages_manager_fk FOREIGN KEY(organisation_id,run_id,manager_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id);
CREATE TABLE hyperfide.preparation_references (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 profile_id uuid NOT NULL,
 preparation_digest hyperfide.digest NOT NULL,
 sandbox_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL,
 manifest_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','READY','FAILED','STALE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,sandbox_id,sandbox_boot_generation,preparation_digest),
 FOREIGN KEY(organisation_id,profile_id) REFERENCES hyperfide.environment_profiles(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,sandbox_boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation)
);

CREATE TABLE hyperfide.workspaces (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 repository_id uuid NOT NULL,
 attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL,
 sandbox_id uuid NOT NULL,
 slot_id uuid NOT NULL,
 sandbox_boot_generation bigint NOT NULL,
 base_commit hyperfide.git_oid NOT NULL,
 branch_ref hyperfide.git_ref NOT NULL,
 workspace_path hyperfide.long_name NOT NULL,
 writable boolean NOT NULL DEFAULT true,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('ACTIVE','SEALED','RELEASED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,base_commit) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation)
);

CREATE UNIQUE INDEX workspaces_one_writer ON hyperfide.workspaces(organisation_id,sandbox_id,workspace_path) WHERE writable AND state='ACTIVE';
CREATE TABLE hyperfide.branch_observations (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 repository_id uuid NOT NULL,
 workspace_id uuid,
 branch_ref hyperfide.git_ref NOT NULL,
 observed_head hyperfide.git_oid NOT NULL,
 observation_version bigint NOT NULL CHECK(observation_version>=1),
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,repository_id,branch_ref,observation_version),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,observed_head) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,run_id,workspace_id) REFERENCES hyperfide.workspaces(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.branch_authorities (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 repository_id uuid NOT NULL,
 branch_ref hyperfide.git_ref NOT NULL,
 branch_generation bigint NOT NULL CHECK(branch_generation>=1),
 authority_epoch uuid NOT NULL,
 expected_old_head hyperfide.git_oid,
 authority text NOT NULL DEFAULT 'ACTIVE' CHECK(authority IN ('ACTIVE','REVOKED','RELEASED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,id,repository_id,branch_generation),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,expected_old_head) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE UNIQUE INDEX branch_authorities_one_active ON hyperfide.branch_authorities(organisation_id,repository_id,branch_ref) WHERE authority='ACTIVE';
CREATE TABLE hyperfide.artifacts (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 digest hyperfide.digest NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>=0),
 storage_backend text NOT NULL CHECK(length(storage_backend) BETWEEN 1 AND 64),
 storage_key hyperfide.long_name NOT NULL,
 status text NOT NULL DEFAULT 'PENDING' CHECK(status IN ('PENDING','COMPLETE','QUARANTINED','DELETED')),
 retention_class text NOT NULL DEFAULT 'RUN' CHECK(retention_class IN ('EPHEMERAL','RUN','RELEASE','LEGAL_HOLD')),
 retention_until timestamptz,
 retention_hold boolean NOT NULL DEFAULT false,
 completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,digest),
 UNIQUE(organisation_id,run_id,storage_backend,storage_key)
);

CREATE TABLE hyperfide.checkpoints (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL,
 agent_session_id uuid,
 artifact_id uuid NOT NULL,
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 input_packet_digest hyperfide.digest NOT NULL,
 support_level text NOT NULL CHECK(support_level IN ('NATIVE_RESUME','SOURCE_ONLY','UNSUPPORTED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation),
 FOREIGN KEY(organisation_id,run_id,agent_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE TABLE hyperfide.evidence (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 attempt_id uuid NOT NULL,
 attempt_generation bigint NOT NULL CHECK(attempt_generation>=1),
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 criteria_digest hyperfide.digest NOT NULL,
 manifest_digest hyperfide.digest NOT NULL,
 artifact_id uuid NOT NULL,
 admission_state text NOT NULL DEFAULT 'PENDING' CHECK(admission_state IN ('PENDING','ADMITTED','REJECTED','STALE')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.evidence_artifacts (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 artifact_id uuid NOT NULL,
 role hyperfide.name NOT NULL DEFAULT 'supporting',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,evidence_id,artifact_id,role),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.submission_custodies (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL,
 source_attempt_id uuid NOT NULL,
 source_generation bigint NOT NULL CHECK(source_generation>=1),
 custody_generation bigint NOT NULL CHECK(custody_generation>=1),
 authority_epoch uuid NOT NULL,
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 evidence_manifest_digest hyperfide.digest NOT NULL,
 criteria_digest hyperfide.digest NOT NULL,
 authority text NOT NULL DEFAULT 'ACTIVE' CHECK(authority IN ('ACTIVE','REVOKED','SUPERSEDED','RELEASED')),
 qualification_outcome text NOT NULL DEFAULT 'PENDING' CHECK(qualification_outcome IN ('PENDING','PASS','FAIL')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,task_id,custody_generation),
 UNIQUE(organisation_id,run_id,id,custody_generation),
 UNIQUE(organisation_id,run_id,task_id,id,custody_generation),
 UNIQUE(organisation_id,run_id,id,custody_generation,task_id,repository_id,source_object_id),
 UNIQUE(organisation_id,run_id,id,custody_generation,task_id,repository_id),
 UNIQUE(organisation_id,run_id,id,source_attempt_id,source_generation,repository_id,source_object_id,criteria_digest),
 FOREIGN KEY(organisation_id,run_id,task_id,source_attempt_id,source_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,task_id,id,generation),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE UNIQUE INDEX custody_one_active ON hyperfide.submission_custodies(organisation_id,run_id,task_id) WHERE authority='ACTIVE';
ALTER TABLE hyperfide.submission_custodies ADD UNIQUE(organisation_id,run_id,task_id,id);
ALTER TABLE hyperfide.tasks ADD CONSTRAINT tasks_current_custody_fk FOREIGN KEY(organisation_id,run_id,id,current_custody_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,task_id,id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE hyperfide.submission_evidence (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 custody_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 source_attempt_id uuid NOT NULL,
 source_generation bigint NOT NULL,
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 criteria_digest hyperfide.digest NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,custody_id,evidence_id),
 FOREIGN KEY(organisation_id,run_id,custody_id,source_attempt_id,source_generation,repository_id,source_object_id,criteria_digest) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id,source_attempt_id,source_generation,repository_id,source_object_id,criteria_digest),
 FOREIGN KEY(organisation_id,run_id,evidence_id,source_attempt_id,source_generation,repository_id,source_object_id,criteria_digest) REFERENCES hyperfide.evidence(organisation_id,run_id,id,attempt_id,attempt_generation,repository_id,source_object_id,criteria_digest)
);

CREATE TABLE hyperfide.qualification_jobs (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 custody_id uuid NOT NULL,
 custody_generation bigint NOT NULL CHECK(custody_generation>=1),
 rubric_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
 lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0),
 lease_owner uuid,
 lease_expires_at timestamptz,
 outcome text NOT NULL DEFAULT 'PENDING' CHECK(outcome IN ('PENDING','PASS','FAIL')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 CHECK((lease_owner IS NULL)=(lease_expires_at IS NULL)),
 CHECK(state<>'RUNNING' OR (lease_generation>=1 AND lease_owner IS NOT NULL)),
 FOREIGN KEY(organisation_id,run_id,custody_id,custody_generation) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id,custody_generation)
);

CREATE TABLE hyperfide.requalification_operations (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 custody_id uuid NOT NULL,
 custody_generation bigint NOT NULL,
 qualification_job_id uuid NOT NULL,
 request_id uuid NOT NULL,
 input_manifest_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','SUCCEEDED','FAILED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,custody_id,custody_generation) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id,custody_generation),
 FOREIGN KEY(organisation_id,run_id,qualification_job_id) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.integration_candidates (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 task_id uuid NOT NULL,
 custody_id uuid NOT NULL,
 custody_generation bigint NOT NULL,
 repository_id uuid NOT NULL,
 branch_authority_id uuid NOT NULL,
 branch_generation bigint NOT NULL,
 expected_old_head hyperfide.git_oid,
 candidate_head hyperfide.git_oid NOT NULL,
 input_manifest_digest hyperfide.digest NOT NULL,
 request_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','VERIFYING','READY','PUBLISHED','FAILED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 UNIQUE(organisation_id,run_id,id,branch_authority_id,branch_generation,repository_id,candidate_head),
 FOREIGN KEY(organisation_id,run_id,custody_id,custody_generation,task_id,repository_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id,custody_generation,task_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,candidate_head) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,run_id,branch_authority_id,repository_id,branch_generation) REFERENCES hyperfide.branch_authorities(organisation_id,run_id,id,repository_id,branch_generation),
 FOREIGN KEY(organisation_id,repository_id,expected_old_head) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE TABLE hyperfide.candidate_evidence (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,candidate_id,evidence_id),
 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.publication_intents (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 candidate_id uuid NOT NULL,
 intent_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','EXECUTING','PUBLISHED','FAILED','CANCELLED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,candidate_id),
 UNIQUE(organisation_id,run_id,id,candidate_id),
 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.publication_operations (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 publication_intent_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 branch_authority_id uuid NOT NULL,
 branch_generation bigint NOT NULL CHECK(branch_generation>=1),
 authority_epoch uuid NOT NULL,
 repository_id uuid NOT NULL,
 expected_old_head hyperfide.git_oid,
 candidate_head hyperfide.git_oid NOT NULL,
 request_id uuid NOT NULL,
 operation_generation bigint NOT NULL DEFAULT 1 CHECK(operation_generation>=1),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','OUTCOME_UNKNOWN','PUBLISHED','FAILED','CANCELLED')),
 observed_head hyperfide.git_oid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id,publication_intent_id,candidate_id) REFERENCES hyperfide.publication_intents(organisation_id,run_id,id,candidate_id),
 FOREIGN KEY(organisation_id,run_id,candidate_id,branch_authority_id,branch_generation,repository_id,candidate_head) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id,branch_authority_id,branch_generation,repository_id,candidate_head),
 FOREIGN KEY(organisation_id,repository_id,observed_head) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE TABLE hyperfide.contracts (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 contract_key hyperfide.name NOT NULL,
 revision bigint NOT NULL CHECK(revision>=1),
 criteria_digest hyperfide.digest NOT NULL,
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object' AND octet_length(definition::text)<=4194304),
 owner_package_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,contract_key,revision),
 FOREIGN KEY(organisation_id,run_id,owner_package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.findings (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 dedup_digest hyperfide.digest NOT NULL,
 owner_package_id uuid NOT NULL,
 contract_id uuid,
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 severity text NOT NULL CHECK(severity IN ('INFO','WARNING','ERROR','CRITICAL')),
 summary hyperfide.long_name NOT NULL,
 state text NOT NULL DEFAULT 'OPEN' CHECK(state IN ('OPEN','ACKNOWLEDGED','RESOLVED','DISMISSED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,dedup_digest),
 FOREIGN KEY(organisation_id,run_id,owner_package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,contract_id) REFERENCES hyperfide.contracts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE TABLE hyperfide.finding_observations (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 finding_id uuid NOT NULL,
 evidence_id uuid NOT NULL,
 observer_session_id uuid NOT NULL,
 observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,finding_id) REFERENCES hyperfide.findings(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,observer_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.review_coverage (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 reviewer_session_id uuid NOT NULL,
 rubric_digest hyperfide.digest NOT NULL,
 input_manifest_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','COMPLETE','FAILED')),
 evidence_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,reviewer_session_id,rubric_digest,input_manifest_digest),
 CHECK(state<>'COMPLETE' OR evidence_id IS NOT NULL),
 FOREIGN KEY(organisation_id,run_id,reviewer_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.review_coverage_inputs (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 review_coverage_id uuid NOT NULL,
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,review_coverage_id,repository_id,source_object_id),
 FOREIGN KEY(organisation_id,run_id,review_coverage_id) REFERENCES hyperfide.review_coverage(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);

CREATE TABLE hyperfide.graph_builds (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 input_digest hyperfide.digest NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 parser_digest hyperfide.digest NOT NULL,
 schema_digest hyperfide.digest NOT NULL,
 config_digest hyperfide.digest NOT NULL,
 parent_build_id uuid,
 state text NOT NULL DEFAULT 'STAGING' CHECK(state IN ('STAGING','RESOLVING','VALIDATING','READY','PUBLISHED','FAILED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,input_digest),
 FOREIGN KEY(organisation_id,run_id,parent_build_id) REFERENCES hyperfide.graph_builds(organisation_id,run_id,id),
 CHECK(parent_build_id IS NULL OR parent_build_id<>id)
);

CREATE TABLE hyperfide.graph_manifests (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 build_id uuid NOT NULL,
 manifest_digest hyperfide.digest NOT NULL,
 source_manifest_digest hyperfide.digest NOT NULL,
 file_count bigint NOT NULL CHECK(file_count>=0),
 symbol_count bigint NOT NULL CHECK(symbol_count>=0),
 reference_count bigint NOT NULL CHECK(reference_count>=0),
 edge_count bigint NOT NULL CHECK(edge_count>=0),
 published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,build_id),
 UNIQUE(organisation_id,run_id,manifest_digest),
 FOREIGN KEY(organisation_id,run_id,build_id) REFERENCES hyperfide.graph_builds(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.graph_channels (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 name hyperfide.name NOT NULL,
 manifest_id uuid NOT NULL,
 publication_generation bigint NOT NULL DEFAULT 1 CHECK(publication_generation>=1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,name),
 FOREIGN KEY(organisation_id,run_id,manifest_id) REFERENCES hyperfide.graph_manifests(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.parse_blobs (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 id uuid NOT NULL DEFAULT gen_random_uuid(),
 content_digest hyperfide.digest NOT NULL,
 parser_digest hyperfide.digest NOT NULL,
 language hyperfide.name NOT NULL,
 parser_version hyperfide.name NOT NULL,
 facts_artifact_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,content_digest,parser_digest,language,parser_version),
 FOREIGN KEY(organisation_id,run_id,facts_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.graph_files (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 graph_id uuid NOT NULL,
 repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL,
 path hyperfide.long_name NOT NULL,
 content_digest hyperfide.digest NOT NULL,
 parse_blob_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,graph_id,id),
 UNIQUE(organisation_id,run_id,graph_id,repository_id,path),
 FOREIGN KEY(organisation_id,run_id,graph_id) REFERENCES hyperfide.graph_builds(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,run_id,parse_blob_id) REFERENCES hyperfide.parse_blobs(organisation_id,run_id,id)
);

CREATE TABLE hyperfide.graph_symbols (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 graph_id uuid NOT NULL,
 file_id uuid NOT NULL,
 symbol_key hyperfide.name NOT NULL,
 name hyperfide.name NOT NULL,
 kind hyperfide.name NOT NULL,
 start_byte bigint NOT NULL CHECK(start_byte>=0),
 end_byte bigint NOT NULL CHECK(end_byte>=start_byte),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,graph_id,id),
 UNIQUE(organisation_id,run_id,graph_id,file_id,symbol_key),
 FOREIGN KEY(organisation_id,run_id,graph_id,file_id) REFERENCES hyperfide.graph_files(organisation_id,run_id,graph_id,id)
);

CREATE TABLE hyperfide.graph_references (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 graph_id uuid NOT NULL,
 file_id uuid NOT NULL,
 reference_key hyperfide.name NOT NULL,
 name hyperfide.name NOT NULL,
 resolution_state text NOT NULL CHECK(resolution_state IN ('RESOLVED','UNRESOLVED','AMBIGUOUS','BUDGET_EXHAUSTED','UNSUPPORTED')),
 target_symbol_id uuid,
 start_byte bigint NOT NULL CHECK(start_byte>=0),
 end_byte bigint NOT NULL CHECK(end_byte>=start_byte),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,graph_id,file_id,reference_key),
 CHECK((resolution_state='RESOLVED')=(target_symbol_id IS NOT NULL)),
 FOREIGN KEY(organisation_id,run_id,graph_id,file_id) REFERENCES hyperfide.graph_files(organisation_id,run_id,graph_id,id),
 FOREIGN KEY(organisation_id,run_id,graph_id,target_symbol_id) REFERENCES hyperfide.graph_symbols(organisation_id,run_id,graph_id,id)
);

CREATE TABLE hyperfide.graph_edges (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 graph_id uuid NOT NULL,
 source_symbol_id uuid NOT NULL,
 target_symbol_id uuid NOT NULL,
 kind hyperfide.name NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,graph_id,source_symbol_id,target_symbol_id,kind),
 FOREIGN KEY(organisation_id,run_id,graph_id,source_symbol_id) REFERENCES hyperfide.graph_symbols(organisation_id,run_id,graph_id,id),
 FOREIGN KEY(organisation_id,run_id,graph_id,target_symbol_id) REFERENCES hyperfide.graph_symbols(organisation_id,run_id,graph_id,id)
);

CREATE TABLE hyperfide.command_inbox (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 principal_scope hyperfide.name NOT NULL,
 operation hyperfide.name NOT NULL,
 idempotency_key hyperfide.name NOT NULL,
 request_digest hyperfide.digest NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','COMPLETED','FAILED')),
 result jsonb CHECK(result IS NULL OR octet_length(result::text)<=1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,principal_scope,operation,idempotency_key),
 CHECK(state='PENDING' OR result IS NOT NULL)
);

CREATE TABLE hyperfide.event_consumers (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 consumer_key hyperfide.name NOT NULL,
 critical boolean NOT NULL DEFAULT true,
 state text NOT NULL DEFAULT 'ACTIVE' CHECK(state IN ('BUFFERING','ACTIVE','STOPPED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,consumer_key)
);

CREATE TABLE hyperfide.outbox_events (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
  run_id uuid NOT NULL,
  id uuid NOT NULL DEFAULT gen_random_uuid(),
 aggregate_type hyperfide.name NOT NULL,
 aggregate_id uuid NOT NULL,
 aggregate_version bigint NOT NULL CHECK(aggregate_version>=1),
 event_type hyperfide.name NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
  FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 UNIQUE(organisation_id,run_id,aggregate_type,aggregate_id,aggregate_version,event_type)
);

CREATE TABLE hyperfide.event_deliveries (
organisation_id uuid NOT NULL REFERENCES hyperfide.organisations(id),
 run_id uuid NOT NULL,
 event_id uuid NOT NULL,
 consumer_id uuid NOT NULL,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','DELIVERING','ACKNOWLEDGED','DEAD_LETTER')),
 attempt_count bigint NOT NULL DEFAULT 0 CHECK(attempt_count>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 acknowledged_at timestamptz,
 remediation_owner hyperfide.name,
 last_error hyperfide.long_name,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,event_id,consumer_id),
 CHECK((state='ACKNOWLEDGED')=(acknowledged_at IS NOT NULL)),
 CHECK(state<>'DEAD_LETTER' OR remediation_owner IS NOT NULL),
 FOREIGN KEY(organisation_id,run_id,event_id) REFERENCES hyperfide.outbox_events(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,consumer_id) REFERENCES hyperfide.event_consumers(organisation_id,run_id,id)
);

CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.organisations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.organisations FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.projects FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.projects FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.repositories FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','project_id','object_format');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.repositories FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.source_objects FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','repository_id','object_id','object_type');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.spec_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','project_id','source_digest','source_content','document','schema_version','repository_id','git_object_id');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.runs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','project_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.runs FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('spec_generation');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.run_spec_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','spec_generation','spec_revision_id','accepted','accepted_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.run_repositories FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','repository_id','source_object_id','integration_ref');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.feature_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','package_key','wave','revision');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.feature_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.tasks FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','task_key','feature_package_id','spec_revision_id','spec_generation','criteria_digest','definition','wave');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.tasks FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('generation');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.task_dependencies FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','task_id','predecessor_run_id','predecessor_task_id','milestone','revision');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.environment_profiles FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','content_digest','provider','runtime_platform','manifest');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.provider_pools FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','provider','account_key','environment_key','region','profile_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.provider_pools FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.capacity_accounts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','pool_id','dimension');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.capacity_accounts FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.reservations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','request_id','capacity_account_id','quantity','attempt_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.reservations FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.sandboxes FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','pool_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.sandboxes FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('boot_generation');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.sandbox_boots FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','sandbox_id','boot_generation','boot_id');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.worker_slots FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','id','sandbox_id','slot_key','boot_generation','capacity_kind');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.worker_slots FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','task_id','generation','authority_epoch','input_packet_digest','kind','sandbox_id','slot_id','sandbox_boot_generation');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.compute_leases FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','attempt_id','attempt_generation','authority_epoch','sandbox_boot_generation');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.compute_leases FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.slot_allocations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','slot_id','sandbox_id','sandbox_boot_generation','attempt_id','attempt_generation','reservation_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.slot_allocations FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.agent_sessions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','role','parent_session_id','connector','account_key','native_session_id','slot_id','sandbox_id','sandbox_boot_generation','attempt_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.agent_sessions FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.preparation_references FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','profile_id','preparation_digest','sandbox_id','sandbox_boot_generation','manifest_digest');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.preparation_references FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.workspaces FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','repository_id','attempt_id','attempt_generation','sandbox_id','slot_id','sandbox_boot_generation','base_commit','branch_ref','workspace_path','writable');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.workspaces FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.branch_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','repository_id','workspace_id','branch_ref','observed_head','observation_version','observed_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.branch_authorities FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','repository_id','branch_ref','branch_generation','authority_epoch','expected_old_head');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.branch_authorities FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','digest','size_bytes','storage_backend','storage_key');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.checkpoints FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','attempt_id','attempt_generation','agent_session_id','artifact_id','repository_id','source_object_id','input_packet_digest','support_level');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','attempt_id','attempt_generation','repository_id','source_object_id','criteria_digest','manifest_digest','artifact_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.evidence_artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','evidence_id','artifact_id','role');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.submission_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','task_id','source_attempt_id','source_generation','custody_generation','authority_epoch','repository_id','source_object_id','source_manifest_digest','evidence_manifest_digest','criteria_digest');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.submission_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.submission_evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','custody_id','evidence_id','source_attempt_id','source_generation','repository_id','source_object_id','criteria_digest');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.qualification_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','custody_id','custody_generation','rubric_digest');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.qualification_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('lease_generation');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.requalification_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','custody_id','custody_generation','qualification_job_id','request_id','input_manifest_digest');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.requalification_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.integration_candidates FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','task_id','custody_id','custody_generation','repository_id','branch_authority_id','branch_generation','expected_old_head','candidate_head','input_manifest_digest','request_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.integration_candidates FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.candidate_evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','candidate_id','evidence_id');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.publication_intents FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','candidate_id','intent_digest');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.publication_intents FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.publication_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','publication_intent_id','candidate_id','branch_authority_id','branch_generation','authority_epoch','repository_id','expected_old_head','candidate_head','request_id','operation_generation');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.publication_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.contracts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','contract_key','revision','criteria_digest','definition','owner_package_id');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.findings FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','dedup_digest','contract_id','repository_id','source_object_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.findings FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.finding_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','finding_id','evidence_id','observer_session_id','observed_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.review_coverage FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','reviewer_session_id','rubric_digest','input_manifest_digest');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.review_coverage FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.review_coverage_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','review_coverage_id','repository_id','source_object_id');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.graph_builds FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','input_digest','source_manifest_digest','parser_digest','schema_digest','config_digest','parent_build_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.graph_builds FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.graph_manifests FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','build_id','manifest_digest','source_manifest_digest','file_count','symbol_count','reference_count','edge_count','published_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.graph_channels FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','name');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.graph_channels FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('publication_generation');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.parse_blobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','content_digest','parser_digest','language','parser_version','facts_artifact_id');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.graph_files FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','graph_id','repository_id','source_object_id','path','content_digest','parse_blob_id');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.graph_symbols FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','graph_id','file_id','symbol_key','name','kind','start_byte','end_byte');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.graph_references FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','graph_id','file_id','reference_key','name','resolution_state','target_symbol_id','start_byte','end_byte');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.graph_edges FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','graph_id','source_symbol_id','target_symbol_id','kind');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.command_inbox FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','principal_scope','operation','idempotency_key','request_digest');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.command_inbox FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.event_consumers FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','consumer_key','critical');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.event_consumers FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields();
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.outbox_events FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','aggregate_type','aggregate_id','aggregate_version','event_type','payload');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.event_deliveries FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','event_id','consumer_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.event_deliveries FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('attempt_count');
-- Additional composite keys make cross-entity bindings explicit without tying history to current epochs.
ALTER TABLE hyperfide.tasks ADD UNIQUE(organisation_id,run_id,id,criteria_digest);
ALTER TABLE hyperfide.submission_custodies ADD CONSTRAINT custody_criteria_fk FOREIGN KEY(organisation_id,run_id,task_id,criteria_digest) REFERENCES hyperfide.tasks(organisation_id,run_id,id,criteria_digest);
ALTER TABLE hyperfide.attempts ADD UNIQUE(organisation_id,run_id,id,generation,sandbox_id,slot_id,sandbox_boot_generation);
ALTER TABLE hyperfide.slot_allocations ADD CONSTRAINT allocation_attempt_slot_fk FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation,sandbox_id,slot_id,sandbox_boot_generation);
ALTER TABLE hyperfide.workspaces ADD CONSTRAINT workspace_attempt_slot_fk FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation,sandbox_id,slot_id,sandbox_boot_generation);
ALTER TABLE hyperfide.qualification_jobs ADD UNIQUE(organisation_id,run_id,id,custody_id,custody_generation);
ALTER TABLE hyperfide.requalification_operations ADD CONSTRAINT requalification_job_custody_fk FOREIGN KEY(organisation_id,run_id,qualification_job_id,custody_id,custody_generation) REFERENCES hyperfide.qualification_jobs(organisation_id,run_id,id,custody_id,custody_generation);
CREATE TABLE hyperfide.candidate_custodies (
 organisation_id uuid NOT NULL,
 run_id uuid NOT NULL,
 candidate_id uuid NOT NULL,
 custody_id uuid NOT NULL,
 custody_generation bigint NOT NULL,
 task_id uuid NOT NULL,
 repository_id uuid NOT NULL,

 PRIMARY KEY(organisation_id,run_id,candidate_id,custody_id),

 FOREIGN KEY(organisation_id,run_id,candidate_id) REFERENCES hyperfide.integration_candidates(organisation_id,run_id,id),

 FOREIGN KEY(organisation_id,run_id,custody_id,custody_generation,task_id,repository_id) REFERENCES hyperfide.submission_custodies(organisation_id,run_id,id,custody_generation,task_id,repository_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.candidate_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','candidate_id','custody_id','custody_generation','task_id','repository_id');
CREATE FUNCTION hyperfide.check_source_object() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE fmt text;
BEGIN SELECT object_format INTO fmt FROM hyperfide.repositories WHERE organisation_id=NEW.organisation_id AND id=NEW.repository_id; IF NOT FOUND THEN RAISE EXCEPTION 'source repository outside organisation scope' USING ERRCODE='23503'; END IF;
 IF (fmt='sha1' AND length(NEW.object_id)<>40) OR (fmt='sha256' AND length(NEW.object_id)<>64) THEN RAISE EXCEPTION 'Git object format mismatch' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER source_format BEFORE INSERT ON hyperfide.source_objects FOR EACH ROW EXECUTE FUNCTION hyperfide.check_source_object();
CREATE FUNCTION hyperfide.check_commit_references() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE field text; oid text;
BEGIN FOREACH field IN ARRAY COALESCE(TG_ARGV,ARRAY[]::text[]) LOOP oid=to_jsonb(NEW)->>field;
 IF oid IS NOT NULL AND NOT EXISTS(SELECT 1 FROM hyperfide.source_objects WHERE organisation_id=NEW.organisation_id AND repository_id=NEW.repository_id AND object_id=oid AND object_type='commit') THEN RAISE EXCEPTION 'source reference must name registered commit' USING ERRCODE='23503'; END IF;
 END LOOP; RETURN NEW; END $$;
CREATE FUNCTION hyperfide.check_run_repository_project() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM hyperfide.runs r JOIN hyperfide.repositories p ON p.organisation_id=r.organisation_id AND p.project_id=r.project_id WHERE r.organisation_id=NEW.organisation_id AND r.id=NEW.run_id AND p.id=NEW.repository_id) THEN RAISE EXCEPTION 'run repository must belong to run project' USING ERRCODE='23503'; END IF; RETURN NEW; END $$;
CREATE TRIGGER run_repository_project BEFORE INSERT ON hyperfide.run_repositories FOR EACH ROW EXECUTE FUNCTION hyperfide.check_run_repository_project();
-- A single task lock serialises competing compute/custody admissions across the two tables.
CREATE FUNCTION hyperfide.check_compute_custody_exclusion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 PERFORM 1 FROM hyperfide.tasks WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.task_id FOR UPDATE;
 IF TG_TABLE_NAME='attempts' THEN
   IF NEW.compute_authority='CURRENT' AND EXISTS(SELECT 1 FROM hyperfide.submission_custodies WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND task_id=NEW.task_id AND authority='ACTIVE') THEN RAISE EXCEPTION 'active submission custody excludes compute ownership' USING ERRCODE='23514'; END IF;
 ELSE
   IF NEW.authority='ACTIVE' AND EXISTS(SELECT 1 FROM hyperfide.attempts WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND task_id=NEW.task_id AND compute_authority='CURRENT') THEN RAISE EXCEPTION 'release compute ownership before admitting custody' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER compute_custody_exclusion BEFORE INSERT OR UPDATE ON hyperfide.attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.check_compute_custody_exclusion();
CREATE TRIGGER custody_compute_exclusion BEFORE INSERT OR UPDATE ON hyperfide.submission_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.check_compute_custody_exclusion();
CREATE FUNCTION hyperfide.require_complete_artifact(org uuid, run uuid, artifact uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE actual text;
BEGIN SELECT status INTO actual FROM hyperfide.artifacts WHERE organisation_id=org AND run_id=run AND id=artifact FOR SHARE;
 IF actual IS DISTINCT FROM 'COMPLETE' THEN RAISE EXCEPTION 'artifact is not COMPLETE in this run' USING ERRCODE='23514'; END IF; END $$;
CREATE FUNCTION hyperfide.check_evidence_artifacts() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE linked record; admitted text;
BEGIN
 IF TG_TABLE_NAME='evidence' THEN
   IF NEW.admission_state='ADMITTED' THEN
     PERFORM hyperfide.require_complete_artifact(NEW.organisation_id,NEW.run_id,NEW.artifact_id);
     FOR linked IN SELECT artifact_id FROM hyperfide.evidence_artifacts WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND evidence_id=NEW.id LOOP
       PERFORM hyperfide.require_complete_artifact(NEW.organisation_id,NEW.run_id,linked.artifact_id);
     END LOOP;
   END IF;
 ELSE
   SELECT admission_state INTO admitted FROM hyperfide.evidence WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.evidence_id FOR SHARE;
   IF admitted='ADMITTED' THEN PERFORM hyperfide.require_complete_artifact(NEW.organisation_id,NEW.run_id,NEW.artifact_id); END IF;
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER evidence_artifact_admission BEFORE INSERT OR UPDATE ON hyperfide.evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.check_evidence_artifacts();
CREATE TRIGGER supporting_artifact_admission BEFORE INSERT ON hyperfide.evidence_artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.check_evidence_artifacts();

-- Manifest dependencies adopt physical chunks into a named run; content deduplication alone grants no evidence authority.
CREATE TABLE hyperfide.artifact_dependencies (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,parent_artifact_id uuid NOT NULL,child_artifact_id uuid NOT NULL,
 sequence integer NOT NULL CHECK(sequence>=0),offset_bytes bigint NOT NULL CHECK(offset_bytes>=0),size_bytes bigint NOT NULL CHECK(size_bytes>=0),
 PRIMARY KEY(organisation_id,run_id,parent_artifact_id,sequence),
 UNIQUE(organisation_id,run_id,parent_artifact_id,child_artifact_id,sequence),
 CHECK(parent_artifact_id<>child_artifact_id),
 FOREIGN KEY(organisation_id,run_id,parent_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,child_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.artifact_dependencies FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','parent_artifact_id','child_artifact_id','sequence','offset_bytes','size_bytes');
CREATE FUNCTION hyperfide.check_artifact_dependency() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE parent_status text; child_size bigint; child_status text;
BEGIN
 SELECT status INTO parent_status FROM hyperfide.artifacts WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.parent_artifact_id FOR UPDATE;
 IF parent_status IS DISTINCT FROM 'PENDING' THEN RAISE EXCEPTION 'dependencies require PENDING parent' USING ERRCODE='23514'; END IF;
 SELECT status,size_bytes INTO child_status,child_size FROM hyperfide.artifacts WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.child_artifact_id FOR SHARE;
 IF child_status IS DISTINCT FROM 'COMPLETE' OR child_size<>NEW.size_bytes THEN RAISE EXCEPTION 'dependency requires exact COMPLETE chunk size' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM hyperfide.artifact_dependencies WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND parent_artifact_id=NEW.parent_artifact_id)>=4096 THEN RAISE EXCEPTION 'manifest dependency bound exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER dependency_binding BEFORE INSERT ON hyperfide.artifact_dependencies FOR EACH ROW EXECUTE FUNCTION hyperfide.check_artifact_dependency();

CREATE FUNCTION hyperfide.protect_artifact_availability() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF TG_OP='DELETE' OR (OLD.status='COMPLETE' AND NEW.status<>'COMPLETE') THEN
   IF EXISTS(SELECT 1 FROM hyperfide.evidence e WHERE e.organisation_id=OLD.organisation_id AND e.run_id=OLD.run_id AND e.admission_state='ADMITTED' AND (e.artifact_id=OLD.id OR EXISTS(SELECT 1 FROM hyperfide.evidence_artifacts a WHERE a.organisation_id=e.organisation_id AND a.run_id=e.run_id AND a.evidence_id=e.id AND a.artifact_id=OLD.id))) THEN RAISE EXCEPTION 'admitted evidence retains artifact availability' USING ERRCODE='23514'; END IF;
 END IF;
  IF TG_OP='DELETE' OR (OLD.status='COMPLETE' AND NEW.status<>'COMPLETE') THEN
   IF EXISTS(SELECT 1 FROM hyperfide.artifact_dependencies d JOIN hyperfide.artifacts p ON p.organisation_id=d.organisation_id AND p.run_id=d.run_id AND p.id=d.parent_artifact_id WHERE d.organisation_id=OLD.organisation_id AND d.run_id=OLD.run_id AND d.child_artifact_id=OLD.id AND p.status='COMPLETE') THEN RAISE EXCEPTION 'COMPLETE parent retains chunk availability' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 IF NEW.status='COMPLETE' THEN
   PERFORM 1 FROM hyperfide.artifacts c JOIN hyperfide.artifact_dependencies d ON c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND c.id=d.child_artifact_id WHERE d.organisation_id=NEW.organisation_id AND d.run_id=NEW.run_id AND d.parent_artifact_id=NEW.id ORDER BY c.id FOR SHARE OF c;
   IF EXISTS(SELECT 1 FROM hyperfide.artifact_dependencies d JOIN hyperfide.artifacts c ON c.organisation_id=d.organisation_id AND c.run_id=d.run_id AND c.id=d.child_artifact_id WHERE d.organisation_id=NEW.organisation_id AND d.run_id=NEW.run_id AND d.parent_artifact_id=NEW.id AND c.status<>'COMPLETE') THEN RAISE EXCEPTION 'manifest chunks are not COMPLETE' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.status='COMPLETE' AND NEW.completed_at IS NULL THEN NEW.completed_at=clock_timestamp(); END IF;
 IF OLD.completed_at IS NOT NULL AND NEW.completed_at IS DISTINCT FROM OLD.completed_at THEN RAISE EXCEPTION 'completion time immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION hyperfide.initial_artifact_completion() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$ BEGIN IF NEW.status='COMPLETE' THEN NEW.completed_at=clock_timestamp(); ELSIF NEW.completed_at IS NOT NULL THEN RAISE EXCEPTION 'incomplete artifact cannot claim completion' USING ERRCODE='23514'; END IF; RETURN NEW; END $$;
CREATE TRIGGER initial_completion BEFORE INSERT ON hyperfide.artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.initial_artifact_completion();
CREATE TRIGGER protect_availability BEFORE UPDATE OR DELETE ON hyperfide.artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_artifact_availability();
CREATE FUNCTION hyperfide.check_evidence_criteria() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN IF NOT EXISTS(SELECT 1 FROM hyperfide.attempts a JOIN hyperfide.tasks t ON t.organisation_id=a.organisation_id AND t.run_id=a.run_id AND t.id=a.task_id WHERE a.organisation_id=NEW.organisation_id AND a.run_id=NEW.run_id AND a.id=NEW.attempt_id AND a.generation=NEW.attempt_generation AND t.criteria_digest=NEW.criteria_digest) THEN RAISE EXCEPTION 'evidence criteria must match source task' USING ERRCODE='23503'; END IF; RETURN NEW; END $$;
CREATE TRIGGER evidence_criteria BEFORE INSERT ON hyperfide.evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.check_evidence_criteria();
CREATE FUNCTION hyperfide.check_publication_bindings() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE expected hyperfide.git_oid; epoch uuid;
BEGIN
 IF TG_TABLE_NAME='integration_candidates' THEN
   SELECT expected_old_head,authority_epoch INTO expected,epoch FROM hyperfide.branch_authorities WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.branch_authority_id AND branch_generation=NEW.branch_generation;
   IF NOT FOUND OR expected IS DISTINCT FROM NEW.expected_old_head THEN RAISE EXCEPTION 'candidate expected head differs from branch authority' USING ERRCODE='23503'; END IF;
 ELSE
   SELECT c.expected_old_head,b.authority_epoch INTO expected,epoch FROM hyperfide.integration_candidates c JOIN hyperfide.branch_authorities b ON b.organisation_id=c.organisation_id AND b.run_id=c.run_id AND b.id=c.branch_authority_id AND b.branch_generation=c.branch_generation WHERE c.organisation_id=NEW.organisation_id AND c.run_id=NEW.run_id AND c.id=NEW.candidate_id;
   IF NOT FOUND OR expected IS DISTINCT FROM NEW.expected_old_head OR epoch IS DISTINCT FROM NEW.authority_epoch THEN RAISE EXCEPTION 'publication intent/head/epoch binding mismatch' USING ERRCODE='23503'; END IF;
 END IF; RETURN NEW; END $$;
CREATE TRIGGER candidate_publication_binding BEFORE INSERT ON hyperfide.integration_candidates FOR EACH ROW EXECUTE FUNCTION hyperfide.check_publication_bindings();
CREATE TRIGGER operation_publication_binding BEFORE INSERT ON hyperfide.publication_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.check_publication_bindings();
CREATE FUNCTION hyperfide.protect_published_graph() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE graph uuid;
BEGIN graph=COALESCE((to_jsonb(NEW)->>'graph_id')::uuid,(to_jsonb(OLD)->>'graph_id')::uuid);
 PERFORM 1 FROM hyperfide.graph_builds WHERE organisation_id=COALESCE(NEW.organisation_id,OLD.organisation_id) AND run_id=COALESCE(NEW.run_id,OLD.run_id) AND id=graph FOR SHARE;
 IF EXISTS(SELECT 1 FROM hyperfide.graph_manifests WHERE organisation_id=COALESCE(NEW.organisation_id,OLD.organisation_id) AND run_id=COALESCE(NEW.run_id,OLD.run_id) AND build_id=graph) THEN RAISE EXCEPTION 'published graph facts immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $$;
CREATE FUNCTION hyperfide.check_graph_publication() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE build hyperfide.graph_builds;
BEGIN SELECT * INTO build FROM hyperfide.graph_builds WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.build_id FOR UPDATE;
 IF build.state NOT IN ('READY','PUBLISHED') OR build.source_manifest_digest<>NEW.source_manifest_digest THEN RAISE EXCEPTION 'graph not ready or source manifest mismatched' USING ERRCODE='23514'; END IF;
 IF (SELECT count(*) FROM hyperfide.graph_files WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND graph_id=NEW.build_id)<>NEW.file_count OR
 (SELECT count(*) FROM hyperfide.graph_symbols WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND graph_id=NEW.build_id)<>NEW.symbol_count OR
 (SELECT count(*) FROM hyperfide.graph_references WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND graph_id=NEW.build_id)<>NEW.reference_count OR
 (SELECT count(*) FROM hyperfide.graph_edges WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND graph_id=NEW.build_id)<>NEW.edge_count THEN RAISE EXCEPTION 'graph manifest counts mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW; END $$;
CREATE TRIGGER graph_publication BEFORE INSERT ON hyperfide.graph_manifests FOR EACH ROW EXECUTE FUNCTION hyperfide.check_graph_publication();

CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.spec_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('git_object_id');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.run_repositories FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.workspaces FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('base_commit');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.branch_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('observed_head');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.branch_authorities FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('expected_old_head');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.checkpoints FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.submission_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.integration_candidates FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('candidate_head','expected_old_head');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.publication_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('candidate_head','expected_old_head','observed_head');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.findings FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.review_coverage_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');
CREATE TRIGGER commit_references BEFORE INSERT OR UPDATE ON hyperfide.graph_files FOR EACH ROW EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');
CREATE TRIGGER published_graph_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_files FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_published_graph();
CREATE TRIGGER published_graph_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_symbols FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_published_graph();
CREATE TRIGGER published_graph_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_references FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_published_graph();
CREATE TRIGGER published_graph_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_edges FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_published_graph();
-- Discovery and retry paths use bounded indexed scans; authority mutations still revalidate on primary.
CREATE INDEX tasks_eligibility ON hyperfide.tasks(organisation_id,run_id,state,wave,task_key);
CREATE INDEX attempt_expiry ON hyperfide.attempts(organisation_id,run_id,lease_expires_at) WHERE compute_authority='CURRENT';
CREATE INDEX reservation_reconcile ON hyperfide.reservations(organisation_id,run_id,state,expires_at);
CREATE INDEX qualification_pending ON hyperfide.qualification_jobs(organisation_id,run_id,state,created_at);
CREATE INDEX delivery_pending ON hyperfide.event_deliveries(organisation_id,run_id,state,next_attempt_at) WHERE state<>'ACKNOWLEDGED';
CREATE INDEX graph_symbols_name ON hyperfide.graph_symbols(organisation_id,run_id,graph_id,name);
CREATE INDEX graph_refs_target ON hyperfide.graph_references(organisation_id,run_id,graph_id,target_symbol_id);
CREATE INDEX findings_owner ON hyperfide.findings(organisation_id,run_id,owner_package_id,state);
CREATE INDEX custody_source ON hyperfide.submission_custodies(organisation_id,run_id,source_attempt_id,source_generation);
-- Cross-table admission predicates require fresh statement snapshots or serializable conflict detection.
-- REPEATABLE READ is supported for observation snapshots, never for authoritative writes.
CREATE FUNCTION hyperfide.require_authority_isolation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF current_setting('transaction_isolation') NOT IN ('read committed','serializable') THEN
   RAISE EXCEPTION 'authority writes require READ COMMITTED or SERIALIZABLE' USING ERRCODE='25001';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.schema_migrations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.organisations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.projects FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.repositories FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.source_objects FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.spec_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.run_spec_revisions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.run_repositories FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.feature_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.tasks FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.task_dependencies FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.environment_profiles FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.provider_pools FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.capacity_accounts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.reservations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.sandboxes FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.sandbox_boots FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.worker_slots FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.attempts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.compute_leases FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.slot_allocations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.agent_sessions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.preparation_references FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.workspaces FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.branch_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.branch_authorities FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.checkpoints FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.evidence_artifacts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.submission_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.submission_evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.qualification_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.requalification_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.integration_candidates FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.candidate_evidence FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.publication_intents FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.publication_operations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.contracts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.findings FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.finding_observations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.review_coverage FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.review_coverage_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_builds FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_manifests FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_channels FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.parse_blobs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_files FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_symbols FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_references FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_edges FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.command_inbox FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.event_consumers FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.outbox_events FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.event_deliveries FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.candidate_custodies FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.artifact_dependencies FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- A provider resource identity spans logical pools within the same provider account.
ALTER TABLE hyperfide.sandboxes ADD COLUMN provider hyperfide.name NOT NULL;
ALTER TABLE hyperfide.sandboxes ADD COLUMN account_key hyperfide.name NOT NULL;
ALTER TABLE hyperfide.sandboxes ADD CONSTRAINT sandbox_native_account_identity UNIQUE(organisation_id,provider,account_key,native_sandbox_id);
CREATE FUNCTION hyperfide.bind_sandbox_provider() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE p hyperfide.provider_pools;
BEGIN SELECT * INTO p FROM hyperfide.provider_pools WHERE organisation_id=NEW.organisation_id AND id=NEW.pool_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'sandbox pool outside organisation scope' USING ERRCODE='23503'; END IF;
 IF TG_OP='UPDATE' AND (NEW.provider IS DISTINCT FROM OLD.provider OR NEW.account_key IS DISTINCT FROM OLD.account_key) THEN RAISE EXCEPTION 'provider resource namespace immutable' USING ERRCODE='23514'; END IF;
 IF (NEW.provider IS NOT NULL AND NEW.provider<>p.provider) OR (NEW.account_key IS NOT NULL AND NEW.account_key<>p.account_key) THEN RAISE EXCEPTION 'sandbox provider namespace mismatched' USING ERRCODE='23503'; END IF;
 NEW.provider=p.provider;NEW.account_key=p.account_key;RETURN NEW;
END $$;
CREATE TRIGGER aab_provider_identity BEFORE INSERT OR UPDATE ON hyperfide.sandboxes FOR EACH ROW EXECUTE FUNCTION hyperfide.bind_sandbox_provider();
