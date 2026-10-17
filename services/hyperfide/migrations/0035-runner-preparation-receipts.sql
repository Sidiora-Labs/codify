-- Runner control (task 12.4): distinct pause/drain/cancel/stop/resume commands,
-- publication fences, durable required-output captures, slot workspace reuse
-- gating and native preparation-stage receipts. Applied only by the migration engine.
CREATE TABLE hyperfide.runner_control_commands (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,command_id uuid NOT NULL,
 action text NOT NULL CHECK(action IN('runner.pause','runner.drain','runner.cancel','runner.stop','runner.resume')),
 launch_id uuid NOT NULL,slot_id uuid NOT NULL,sandbox_id uuid NOT NULL,boot_id uuid NOT NULL,
 boot_generation bigint NOT NULL CHECK(boot_generation>0),
 attempt_id uuid NOT NULL,attempt_generation bigint NOT NULL CHECK(attempt_generation>0),
 authority_epoch uuid NOT NULL,fence_sequence bigint NOT NULL CHECK(fence_sequence>0),
 policy jsonb NOT NULL CHECK(jsonb_typeof(policy)='object'),
 required_outputs jsonb NOT NULL CHECK(jsonb_typeof(required_outputs)='array'),
 request_digest hyperfide.digest NOT NULL,issued_by_credential_id uuid NOT NULL,
 issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 state text NOT NULL DEFAULT 'ISSUED' CHECK(state IN('ISSUED','DELIVERED','REPORTED','SUPERSEDED')),
 delivery_count bigint NOT NULL DEFAULT 0 CHECK(delivery_count>=0),delivered_at timestamptz,
 outcome text CHECK(outcome IS NULL OR outcome IN('PAUSED','DRAINING','DRAINED','CANCELLED','STOPPED','RESUMED','UNRESOLVED')),
 termination text CHECK(termination IS NULL OR termination IN('CONFIRMED','UNRESOLVED','FROZEN','NOT_REQUIRED')),
 cleanup_complete boolean,report jsonb,report_digest hyperfide.digest,reported_at timestamptz,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,command_id),
 UNIQUE(organisation_id,run_id,launch_id,fence_sequence),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 CHECK((report IS NULL)=(report_digest IS NULL)),CHECK(state<>'REPORTED' OR outcome IS NOT NULL)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.runner_control_commands
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','command_id','action','launch_id','slot_id','sandbox_id','boot_id','boot_generation','attempt_id','attempt_generation','authority_epoch','fence_sequence','policy','required_outputs','request_digest','issued_by_credential_id','issued_at');

-- A fence only moves forward. Every attempt generation at or below it is denied
-- publication; leases/credentials are revoked in the transaction that raises it.
CREATE TABLE hyperfide.runner_publication_fences (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,attempt_id uuid NOT NULL,
 fenced_generation bigint NOT NULL CHECK(fenced_generation>0),
 launch_id uuid NOT NULL,command_id uuid NOT NULL,
 leases_revoked bigint NOT NULL DEFAULT 0 CHECK(leases_revoked>=0),
 credentials_revoked bigint NOT NULL DEFAULT 0 CHECK(credentials_revoked>=0),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,attempt_id),
 FOREIGN KEY(organisation_id,run_id,command_id) REFERENCES hyperfide.runner_control_commands(organisation_id,run_id,command_id)
);
CREATE FUNCTION hyperfide.runner_fence_monotonic() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.fenced_generation<OLD.fenced_generation THEN
  RAISE EXCEPTION 'runner publication fences never move backwards' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER monotonic_fence BEFORE UPDATE OR DELETE ON hyperfide.runner_publication_fences
 FOR EACH ROW EXECUTE FUNCTION hyperfide.runner_fence_monotonic();

CREATE TABLE hyperfide.runner_output_captures (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,command_id uuid NOT NULL,
 name text NOT NULL CHECK(name ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$'),
 total_digest hyperfide.digest NOT NULL,total_size_bytes bigint NOT NULL CHECK(total_size_bytes>=0 AND total_size_bytes<=16777216),
 state text NOT NULL DEFAULT 'PARTIAL' CHECK(state IN('PARTIAL','COMPLETE')),
 manifest_artifact_id uuid,manifest_digest hyperfide.digest,receipt_digest hyperfide.digest,completed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,command_id,name),
 FOREIGN KEY(organisation_id,run_id,command_id) REFERENCES hyperfide.runner_control_commands(organisation_id,run_id,command_id),
 FOREIGN KEY(organisation_id,run_id,manifest_artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 CHECK((state='COMPLETE')=(manifest_artifact_id IS NOT NULL AND manifest_digest IS NOT NULL AND receipt_digest IS NOT NULL AND completed_at IS NOT NULL))
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.runner_output_captures
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','command_id','name','total_digest','total_size_bytes','created_at');
CREATE TABLE hyperfide.runner_output_capture_chunks (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,command_id uuid NOT NULL,name text NOT NULL,
 sequence integer NOT NULL CHECK(sequence>=0 AND sequence<4096),offset_bytes bigint NOT NULL CHECK(offset_bytes>=0),
 size_bytes bigint NOT NULL CHECK(size_bytes>=0 AND size_bytes<=196608),
 artifact_id uuid NOT NULL,digest hyperfide.digest NOT NULL,
 PRIMARY KEY(organisation_id,run_id,command_id,name,sequence),
 FOREIGN KEY(organisation_id,run_id,command_id,name) REFERENCES hyperfide.runner_output_captures(organisation_id,run_id,command_id,name),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.runner_output_capture_chunks
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','command_id','name','sequence','offset_bytes','size_bytes','artifact_id','digest');

-- CLEANING->FREE requires observed process and credential residue absence plus
-- complete durable captures for every required output of the terminating command.
CREATE TABLE hyperfide.runner_workspaces (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,sandbox_id uuid NOT NULL,
 boot_generation bigint NOT NULL CHECK(boot_generation>0),slot_id uuid NOT NULL,
 slot_generation bigint NOT NULL CHECK(slot_generation>0),
 state text NOT NULL DEFAULT 'FREE' CHECK(state IN('FREE','LEASED','CLEANING')),
 launch_id uuid,command_id uuid,
 process_residue text NOT NULL DEFAULT 'UNCHECKED' CHECK(process_residue IN('UNCHECKED','ABSENT','PRESENT')),
 credential_residue text NOT NULL DEFAULT 'UNCHECKED' CHECK(credential_residue IN('UNCHECKED','ABSENT','PRESENT')),
 outputs_durable boolean NOT NULL DEFAULT false,residue_evidence_digest hyperfide.digest,
 registered_by_credential_id uuid NOT NULL,
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,sandbox_id,boot_generation,slot_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 CHECK(state<>'FREE' OR (launch_id IS NULL AND command_id IS NULL)),
 CHECK(state<>'LEASED' OR launch_id IS NOT NULL)
);

CREATE TABLE hyperfide.runner_preparation_receipts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,operation_id uuid NOT NULL,
 receipt jsonb NOT NULL CHECK(jsonb_typeof(receipt)='object'),receipt_digest hyperfide.digest NOT NULL,
 plan_digest hyperfide.digest NOT NULL,context_digest hyperfide.digest NOT NULL,
 node_digest hyperfide.digest NOT NULL,recipe_digest hyperfide.digest NOT NULL,
 stage_root text NOT NULL,workspace_path text NOT NULL,
 recorded_by_credential_id uuid NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,operation_id) REFERENCES hyperfide.runner_remote_jobs(organisation_id,run_id,operation_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.runner_preparation_receipts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','operation_id','receipt','receipt_digest','plan_digest','context_digest','node_digest','recipe_digest','stage_root','workspace_path','recorded_by_credential_id','recorded_at');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_control_commands
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_publication_fences
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_output_captures
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_output_capture_chunks
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_workspaces
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.runner_preparation_receipts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
