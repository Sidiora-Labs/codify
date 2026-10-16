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
 packet_digest hyperfide.digest NOT NULL,reservation_request_id uuid NOT NULL,registered_by_credential_id uuid NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,child_session_id),UNIQUE(organisation_id,run_id,reservation_request_id),
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
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','child_session_id','parent_session_id','manager_session_id','package_id','package_generation','task_id','attempt_id','attempt_generation','authority_epoch','sandbox_id','slot_id','sandbox_boot_generation','packet_digest','reservation_request_id','registered_by_credential_id','created_at');
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
