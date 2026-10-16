-- Domain 17 immutable review inputs, watcher obligations and remote reproductions.
-- Apply through the migration owner; request handlers never create tables.
CREATE TABLE hyperfide.review_policies (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, digest hyperfide.digest NOT NULL,
 revision bigint NOT NULL CHECK(revision>0), definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 active boolean NOT NULL DEFAULT true, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,digest), UNIQUE(organisation_id,run_id,revision),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id)
);
CREATE UNIQUE INDEX review_one_active_policy ON hyperfide.review_policies(organisation_id,run_id) WHERE active;
CREATE TABLE hyperfide.review_watchers (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, policy_digest hyperfide.digest NOT NULL,
 watcher_id text NOT NULL CHECK(watcher_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
 reviewer_session_id uuid NOT NULL, rubric_digest hyperfide.digest NOT NULL,
 review_class text NOT NULL CHECK(length(review_class) BETWEEN 1 AND 128),
 path_prefixes jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(path_prefixes)='array'),
 PRIMARY KEY(organisation_id,run_id,policy_digest,watcher_id),
 UNIQUE(organisation_id,run_id,policy_digest,reviewer_session_id),
 FOREIGN KEY(organisation_id,run_id,policy_digest) REFERENCES hyperfide.review_policies(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,reviewer_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.review_commits (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL, tree_object_id hyperfide.git_oid NOT NULL,
 parent_objects jsonb NOT NULL CHECK(jsonb_typeof(parent_objects)='array'),
 changed_paths jsonb NOT NULL CHECK(jsonb_typeof(changed_paths)='array'),
 attribution jsonb NOT NULL CHECK(jsonb_typeof(attribution)='object'),
 discovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,repository_id,source_object_id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id)
);
CREATE TABLE hyperfide.review_head_observations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, repository_id uuid NOT NULL,
 digest hyperfide.digest NOT NULL, refs jsonb NOT NULL CHECK(jsonb_typeof(refs)='object'),
 base_object_id hyperfide.git_oid NOT NULL, rewrites jsonb NOT NULL CHECK(jsonb_typeof(rewrites)='array'),
 complete boolean NOT NULL DEFAULT false, observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,repository_id,digest),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id)
);
CREATE TABLE hyperfide.review_obligations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 repository_id uuid NOT NULL, source_object_id hyperfide.git_oid NOT NULL,
 policy_digest hyperfide.digest NOT NULL, watcher_id text NOT NULL, generation bigint NOT NULL DEFAULT 1 CHECK(generation>0),
 input_manifest_digest hyperfide.digest, candidate_digest hyperfide.digest,
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','RUNNING','COMPLETE','STALE')),
 lease_session_id uuid, lease_sandbox_id uuid, lease_boot_generation bigint, lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0), lease_expires_at timestamptz,
 current_receipt_id uuid, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,repository_id,source_object_id,policy_digest,watcher_id),
 FOREIGN KEY(organisation_id,run_id,repository_id,source_object_id) REFERENCES hyperfide.review_commits(organisation_id,run_id,repository_id,source_object_id),
 FOREIGN KEY(organisation_id,run_id,policy_digest,watcher_id) REFERENCES hyperfide.review_watchers(organisation_id,run_id,policy_digest,watcher_id),
 FOREIGN KEY(organisation_id,run_id,lease_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,lease_sandbox_id,lease_boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 CHECK(state<>'RUNNING' OR (lease_session_id IS NOT NULL AND lease_sandbox_id IS NOT NULL AND lease_boot_generation IS NOT NULL AND lease_boot_generation>0 AND lease_generation>0 AND lease_expires_at IS NOT NULL)),
 CHECK(state<>'COMPLETE' OR (input_manifest_digest IS NOT NULL AND current_receipt_id IS NOT NULL))
);
CREATE TABLE hyperfide.review_obligation_inputs (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, obligation_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>0), input_manifest_digest hyperfide.digest NOT NULL,
 candidate_digest hyperfide.digest NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,obligation_id,generation),
 UNIQUE(organisation_id,run_id,obligation_id,generation,input_manifest_digest,candidate_digest),
 FOREIGN KEY(organisation_id,run_id,obligation_id) REFERENCES hyperfide.review_obligations(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.review_receipts (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL, request_digest hyperfide.digest NOT NULL, obligation_id uuid NOT NULL,
 lease_generation bigint NOT NULL CHECK(lease_generation>0), generation bigint NOT NULL CHECK(generation>0), reviewer_session_id uuid NOT NULL, rubric_digest hyperfide.digest NOT NULL,
 input_manifest_digest hyperfide.digest NOT NULL, candidate_digest hyperfide.digest NOT NULL,
 outcome text NOT NULL CHECK(outcome IN ('NO_FINDINGS','FINDINGS','INCONCLUSIVE')),
 limitations jsonb NOT NULL CHECK(jsonb_typeof(limitations)='array'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,request_id),
 UNIQUE(organisation_id,run_id,id,obligation_id,generation),
 FOREIGN KEY(organisation_id,run_id,obligation_id,generation,input_manifest_digest,candidate_digest)
 REFERENCES hyperfide.review_obligation_inputs(organisation_id,run_id,obligation_id,generation,input_manifest_digest,candidate_digest),
 FOREIGN KEY(organisation_id,run_id,reviewer_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
ALTER TABLE hyperfide.review_obligations ADD FOREIGN KEY(organisation_id,run_id,current_receipt_id,id,generation)
 REFERENCES hyperfide.review_receipts(organisation_id,run_id,id,obligation_id,generation);
CREATE TABLE hyperfide.review_receipt_evidence (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, receipt_id uuid NOT NULL, evidence_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,run_id,receipt_id,evidence_id),
 FOREIGN KEY(organisation_id,run_id,receipt_id) REFERENCES hyperfide.review_receipts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.review_observations (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 review_receipt_id uuid NOT NULL, evidence_id uuid NOT NULL, observer_session_id uuid NOT NULL,
 origin_task_id uuid NOT NULL, origin_attempt_id uuid NOT NULL, repository_id uuid NOT NULL,
 source_object_id hyperfide.git_oid NOT NULL, contract_id uuid,
 failure_fingerprint hyperfide.digest NOT NULL, summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 2048),
 severity text NOT NULL CHECK(severity IN ('INFO','WARNING','ERROR','CRITICAL')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,review_receipt_id) REFERENCES hyperfide.review_receipts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,evidence_id) REFERENCES hyperfide.evidence(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,observer_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,origin_task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,origin_attempt_id) REFERENCES hyperfide.attempts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,repository_id,source_object_id) REFERENCES hyperfide.source_objects(organisation_id,repository_id,object_id),
 FOREIGN KEY(organisation_id,run_id,contract_id) REFERENCES hyperfide.contracts(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.review_reproduction_jobs (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL, request_digest hyperfide.digest NOT NULL, candidate_digest hyperfide.digest NOT NULL,
 input_manifest_digest hyperfide.digest NOT NULL, snapshot jsonb NOT NULL CHECK(jsonb_typeof(snapshot)='object'),
 template_id text NOT NULL CHECK(template_id ~ '^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$'),
 qualification_scope text NOT NULL CHECK(qualification_scope IN ('COMPONENT','CONTRACT','SYSTEM')),
 execution_plane text NOT NULL DEFAULT 'REMOTE' CHECK(execution_plane='REMOTE'),
 state text NOT NULL DEFAULT 'PENDING' CHECK(state IN ('PENDING','LEASED','RUNNING','PASSED','FAILED','CANCELLED','OUTCOME_UNKNOWN')),
 last_error_code text CHECK(last_error_code IS NULL OR length(last_error_code) BETWEEN 1 AND 128),
 runner_session_id uuid, runner_boot_id uuid, runner_slot_generation bigint CHECK(runner_slot_generation>0), workspace_path text,
 reservation_id uuid, slot_id uuid, allocation_id uuid, allocation_generation bigint CHECK(allocation_generation>0), worker_session_id uuid, sandbox_id uuid, sandbox_boot_generation bigint,
 lease_generation bigint NOT NULL DEFAULT 0 CHECK(lease_generation>=0), lease_expires_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,request_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,worker_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,sandbox_boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 CHECK(state<>'RUNNING' OR (runner_session_id IS NOT NULL AND runner_boot_id IS NOT NULL AND runner_slot_generation IS NOT NULL AND workspace_path IS NOT NULL AND length(workspace_path) BETWEEN 1 AND 4096)),
 CHECK(state NOT IN ('LEASED','RUNNING') OR
 (reservation_id IS NOT NULL AND slot_id IS NOT NULL AND allocation_id IS NOT NULL AND allocation_generation IS NOT NULL AND allocation_generation>0 AND worker_session_id IS NOT NULL AND sandbox_id IS NOT NULL AND sandbox_boot_generation IS NOT NULL AND sandbox_boot_generation>0 AND lease_generation>0 AND lease_expires_at IS NOT NULL))
);
CREATE TABLE hyperfide.review_reproduction_receipts (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, id uuid NOT NULL DEFAULT gen_random_uuid(), job_id uuid NOT NULL,
 lease_generation bigint NOT NULL CHECK(lease_generation>0), input_manifest_digest hyperfide.digest NOT NULL,
 candidate_digest hyperfide.digest NOT NULL, result jsonb NOT NULL CHECK(jsonb_typeof(result)='object'),
 stdout_artifact_id uuid NOT NULL, stderr_artifact_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id), UNIQUE(organisation_id,run_id,job_id,lease_generation),
 FOREIGN KEY(organisation_id,run_id,job_id) REFERENCES hyperfide.review_reproduction_jobs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,stdout_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,stderr_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE INDEX review_obligations_pending ON hyperfide.review_obligations(organisation_id,run_id,policy_digest,state);
CREATE INDEX review_receipts_inputs ON hyperfide.review_receipts(organisation_id,run_id,input_manifest_digest,candidate_digest);
CREATE INDEX review_reproduction_pending ON hyperfide.review_reproduction_jobs(organisation_id,run_id,state,created_at);
DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['review_policies','review_watchers','review_commits','review_head_observations','review_obligations','review_obligation_inputs','review_receipts','review_receipt_evidence','review_observations','review_reproduction_jobs','review_reproduction_receipts'] LOOP
  EXECUTE format('CREATE TRIGGER authority_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation()',tab);
 END LOOP;
END $$;
CREATE FUNCTION hyperfide.review_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'review history is immutable' USING ERRCODE='23514';
END $$;
DO $$
DECLARE tab text;
BEGIN
 FOREACH tab IN ARRAY ARRAY['review_watchers','review_commits','review_obligation_inputs','review_receipts','review_receipt_evidence','review_observations','review_reproduction_receipts'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON hyperfide.%I FOR EACH ROW EXECUTE FUNCTION hyperfide.review_history_guard()',tab);
 END LOOP;
END $$;
CREATE TRIGGER policy_identity BEFORE UPDATE OR DELETE ON hyperfide.review_policies FOR EACH ROW
 EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','digest','revision','definition');
CREATE TRIGGER commit_references BEFORE INSERT ON hyperfide.review_commits FOR EACH ROW
 EXECUTE FUNCTION hyperfide.check_commit_references('source_object_id');

CREATE TRIGGER reproduction_identity BEFORE UPDATE OR DELETE ON hyperfide.review_reproduction_jobs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','request_id','request_digest','candidate_digest','input_manifest_digest','snapshot','template_id','qualification_scope','execution_plane');

CREATE UNIQUE INDEX review_one_active_job_per_watcher ON hyperfide.review_obligations(organisation_id,run_id,lease_session_id) WHERE state='RUNNING';

CREATE FUNCTION hyperfide.review_reproduction_runner_binding_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.runner_session_id IS NOT NULL AND
  (NEW.runner_session_id IS DISTINCT FROM OLD.runner_session_id OR NEW.runner_boot_id IS DISTINCT FROM OLD.runner_boot_id OR
   NEW.runner_slot_generation IS DISTINCT FROM OLD.runner_slot_generation OR NEW.workspace_path IS DISTINCT FROM OLD.workspace_path OR
   NEW.reservation_id IS DISTINCT FROM OLD.reservation_id OR NEW.allocation_id IS DISTINCT FROM OLD.allocation_id OR
   NEW.allocation_generation IS DISTINCT FROM OLD.allocation_generation OR NEW.slot_id IS DISTINCT FROM OLD.slot_id OR
   NEW.sandbox_id IS DISTINCT FROM OLD.sandbox_id OR NEW.sandbox_boot_generation IS DISTINCT FROM OLD.sandbox_boot_generation) THEN
  RAISE EXCEPTION 'dispatched reproduction physical and allocation bindings are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reproduction_runner_binding BEFORE UPDATE ON hyperfide.review_reproduction_jobs
 FOR EACH ROW EXECUTE FUNCTION hyperfide.review_reproduction_runner_binding_guard();
