-- Child-session identity and charged capacity history; applied only by the migration engine.
CREATE TABLE hyperfide.hierarchy_supervisor_registrations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,session_id uuid NOT NULL,
 registered_by_credential_id uuid NOT NULL,registered_by_actor_id uuid NOT NULL,
 leader_generation bigint NOT NULL CHECK(leader_generation>=0),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,session_id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,registered_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_supervisor_registrations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','session_id','registered_by_credential_id','registered_by_actor_id','leader_generation','created_at');
CREATE TABLE hyperfide.hierarchy_child_registrations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,child_session_id uuid NOT NULL,parent_session_id uuid NOT NULL,
 manager_session_id uuid NOT NULL,package_id uuid NOT NULL,package_generation bigint NOT NULL CHECK(package_generation>0),
 task_id uuid NOT NULL,attempt_id uuid NOT NULL,attempt_generation bigint NOT NULL CHECK(attempt_generation>0),
 authority_epoch uuid NOT NULL,sandbox_id uuid NOT NULL,slot_id uuid NOT NULL,sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>0),
 packet_digest hyperfide.digest NOT NULL,reservation_request_id uuid NOT NULL,sandbox_charge_id uuid NOT NULL,registered_by_credential_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,child_session_id),UNIQUE(organisation_id,run_id,reservation_request_id),
 FOREIGN KEY(organisation_id,run_id,sandbox_charge_id) REFERENCES hyperfide.sandbox_execution_charges(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,child_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,parent_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,manager_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation)
  REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation,authority_epoch,sandbox_boot_generation),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,packet_digest) REFERENCES hyperfide.hierarchy_execution_packets(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,registered_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_child_registrations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','child_session_id','parent_session_id','manager_session_id','package_id','package_generation','task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id','sandbox_boot_generation','packet_digest','reservation_request_id','sandbox_charge_id','registered_by_credential_id','created_at');
CREATE TABLE hyperfide.hierarchy_child_reservations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,child_session_id uuid NOT NULL,reservation_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,run_id,child_session_id,reservation_id),UNIQUE(organisation_id,run_id,reservation_id),
 FOREIGN KEY(organisation_id,run_id,child_session_id) REFERENCES hyperfide.hierarchy_child_registrations(organisation_id,run_id,child_session_id),
 FOREIGN KEY(organisation_id,run_id,reservation_id) REFERENCES hyperfide.reservations(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.check_child_reservation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hyperfide.hierarchy_child_registrations c JOIN hyperfide.reservations r ON r.organisation_id=c.organisation_id AND r.run_id=c.run_id
  AND r.request_id=c.reservation_request_id AND r.attempt_id=c.attempt_id AND r.quantity>0
  WHERE c.organisation_id=NEW.organisation_id AND c.run_id=NEW.run_id AND c.child_session_id=NEW.child_session_id AND r.id=NEW.reservation_id) THEN
 RAISE EXCEPTION 'child capacity must be freshly charged to its exact attempt/request' USING ERRCODE='23514';END IF;RETURN NEW;
END $$;
CREATE TRIGGER child_capacity_binding BEFORE INSERT ON hyperfide.hierarchy_child_reservations FOR EACH ROW EXECUTE FUNCTION hyperfide.check_child_reservation();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_child_reservations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','child_session_id','reservation_id');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_supervisor_registrations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_child_registrations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_child_reservations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();


CREATE TABLE hyperfide.hierarchy_leadership_selections (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,leader_session_id uuid NOT NULL,
 leader_generation bigint NOT NULL CHECK(leader_generation>0),authority_epoch uuid NOT NULL,
 predecessor_session_id uuid,predecessor_generation bigint,predecessor_authority_epoch uuid,
 selected_by_credential_id uuid NOT NULL,selected_by_actor_id uuid NOT NULL,reason text NOT NULL CHECK(octet_length(reason)<=4096),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,leader_generation),
 CHECK((predecessor_session_id IS NULL)=(predecessor_generation IS NULL) AND (predecessor_session_id IS NULL)=(predecessor_authority_epoch IS NULL)),
 FOREIGN KEY(organisation_id,run_id,leader_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,predecessor_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,selected_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_leadership_selections
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','leader_session_id','leader_generation','authority_epoch','predecessor_session_id','predecessor_generation','predecessor_authority_epoch','selected_by_credential_id','selected_by_actor_id','reason','created_at');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_leadership_selections
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

CREATE FUNCTION hyperfide.require_child_sandbox_charge() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hyperfide.sandbox_execution_charges c WHERE c.organisation_id=NEW.organisation_id AND c.run_id=NEW.run_id AND c.id=NEW.sandbox_charge_id AND c.request_id=NEW.reservation_request_id AND c.sandbox_id=NEW.sandbox_id AND c.slot_id=NEW.slot_id AND c.sandbox_boot_generation=NEW.sandbox_boot_generation AND c.attempt_id=NEW.attempt_id AND c.job_kind='CHILD' AND c.state='HELD') THEN
  RAISE EXCEPTION 'child requires its exact held sandbox charge' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER charged_sandbox BEFORE INSERT ON hyperfide.hierarchy_child_registrations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_child_sandbox_charge();

CREATE TABLE hyperfide.hierarchy_worker_registrations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,session_id uuid NOT NULL,
 task_id uuid NOT NULL,attempt_id uuid NOT NULL,attempt_generation bigint NOT NULL CHECK(attempt_generation>0),
 authority_epoch uuid NOT NULL,sandbox_id uuid NOT NULL,slot_id uuid NOT NULL,sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>0),
 packet_digest hyperfide.digest NOT NULL,parent_session_id uuid NOT NULL,package_id uuid NOT NULL,
 native_profile_id text NOT NULL CHECK(octet_length(native_profile_id) BETWEEN 1 AND 128),
 native_profile_digest hyperfide.digest NOT NULL,connector text NOT NULL CHECK(connector IN ('codex','claude')),
 account_key text NOT NULL CHECK(octet_length(account_key) BETWEEN 1 AND 128),
 registration_receipt_digest hyperfide.digest NOT NULL,registered_by_credential_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,session_id),UNIQUE(organisation_id,run_id,attempt_id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,parent_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,task_id) REFERENCES hyperfide.tasks(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,attempt_id,attempt_generation,authority_epoch,sandbox_boot_generation)
 REFERENCES hyperfide.attempts(organisation_id,run_id,id,generation,authority_epoch,sandbox_boot_generation),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,packet_digest) REFERENCES hyperfide.hierarchy_execution_packets(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,registered_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_worker_registrations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','session_id','task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id','sandbox_boot_generation','packet_digest','parent_session_id','package_id','native_profile_id','native_profile_digest','connector','account_key','registration_receipt_digest','registered_by_credential_id','created_at');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_worker_registrations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();

-- Observed descendant usage, logical release and manager-adoption history; append-only.
CREATE TABLE hyperfide.hierarchy_child_usage (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,child_session_id uuid NOT NULL,sample_id uuid NOT NULL,
 cpu_millis bigint NOT NULL CHECK(cpu_millis>=0),memory_bytes bigint NOT NULL CHECK(memory_bytes>=0),disk_bytes bigint NOT NULL CHECK(disk_bytes>=0),
 model_input_tokens bigint NOT NULL CHECK(model_input_tokens>=0),model_output_tokens bigint NOT NULL CHECK(model_output_tokens>=0),
 within_reservation boolean NOT NULL,observed_by_credential_id uuid NOT NULL,observed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,child_session_id,sample_id),
 FOREIGN KEY(organisation_id,run_id,child_session_id) REFERENCES hyperfide.hierarchy_child_registrations(organisation_id,run_id,child_session_id),
 FOREIGN KEY(organisation_id,run_id,observed_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_child_usage
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','child_session_id','sample_id','cpu_millis','memory_bytes','disk_bytes','model_input_tokens','model_output_tokens','within_reservation','observed_by_credential_id','observed_at');
CREATE TABLE hyperfide.hierarchy_child_releases (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,child_session_id uuid NOT NULL,
 observed_state text NOT NULL CHECK(observed_state IN ('UNBOUND','STOPPED','FAILED')),reason text NOT NULL CHECK(octet_length(reason) BETWEEN 1 AND 4096),
 released_by_credential_id uuid NOT NULL,released_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,child_session_id),
 FOREIGN KEY(organisation_id,run_id,child_session_id) REFERENCES hyperfide.hierarchy_child_registrations(organisation_id,run_id,child_session_id),
 FOREIGN KEY(organisation_id,run_id,released_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_child_releases
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','child_session_id','observed_state','reason','released_by_credential_id','released_at');
CREATE TABLE hyperfide.hierarchy_adoptions (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,handoff_id uuid NOT NULL,predecessor_id uuid NOT NULL,successor_id uuid NOT NULL,
 package_ids jsonb NOT NULL CHECK(jsonb_typeof(package_ids)='array'),descendants jsonb NOT NULL CHECK(jsonb_typeof(descendants)='array'),
 descendants_digest hyperfide.digest NOT NULL,proposed_by_credential_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,handoff_id),
 FOREIGN KEY(organisation_id,run_id,handoff_id,successor_id) REFERENCES hyperfide.hierarchy_handoffs(organisation_id,run_id,id,successor_id),
 FOREIGN KEY(organisation_id,run_id,predecessor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,successor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,proposed_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_adoptions
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','handoff_id','predecessor_id','successor_id','package_ids','descendants','descendants_digest','proposed_by_credential_id','created_at');
CREATE TABLE hyperfide.hierarchy_adoption_acknowledgements (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,handoff_id uuid NOT NULL,successor_id uuid NOT NULL,
 adopted jsonb NOT NULL CHECK(jsonb_typeof(adopted)='array'),not_adopted jsonb NOT NULL CHECK(jsonb_typeof(not_adopted)='array'),
 before_digest hyperfide.digest NOT NULL,after_digest hyperfide.digest NOT NULL,workers_restarted boolean NOT NULL,
 acknowledged_by_credential_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,handoff_id),
 FOREIGN KEY(organisation_id,run_id,handoff_id) REFERENCES hyperfide.hierarchy_adoptions(organisation_id,run_id,handoff_id),
 FOREIGN KEY(organisation_id,run_id,handoff_id) REFERENCES hyperfide.hierarchy_handoff_acknowledgements(organisation_id,run_id,handoff_id),
 FOREIGN KEY(organisation_id,run_id,handoff_id,successor_id) REFERENCES hyperfide.hierarchy_handoffs(organisation_id,run_id,id,successor_id),
 FOREIGN KEY(organisation_id,run_id,acknowledged_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_adoption_acknowledgements
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','handoff_id','successor_id','adopted','not_adopted','before_digest','after_digest','workers_restarted','acknowledged_by_credential_id','created_at');
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_child_usage FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_child_releases FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_adoptions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_adoption_acknowledgements FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
