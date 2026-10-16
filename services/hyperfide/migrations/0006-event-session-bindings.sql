-- Session channels are durable recipient identities, not leadership or compute authority.
CREATE TABLE hyperfide.event_session_bindings (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL, consumer_id uuid NOT NULL,
 session_id uuid NOT NULL, namespace hyperfide.name NOT NULL CHECK(namespace IN ('human_intent','fleet_notification')),
 registered_actor_id uuid NOT NULL, registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,consumer_id),
 UNIQUE(organisation_id,run_id,session_id,namespace),
 FOREIGN KEY(organisation_id,run_id,consumer_id) REFERENCES hyperfide.event_consumers(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.validate_event_session_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE consumer_record record;session_record record;
BEGIN
 SELECT consumer_key,state INTO consumer_record FROM hyperfide.event_consumers
 WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.consumer_id;
 SELECT role,state INTO session_record FROM hyperfide.agent_sessions
 WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.session_id;
 IF consumer_record.consumer_key IS DISTINCT FROM ('session:'||NEW.session_id::text||':'||NEW.namespace::text)
    OR consumer_record.state NOT IN ('ACTIVE','BUFFERING') OR session_record.role NOT IN ('LEADER','FEATURE_MANAGER')
    OR session_record.state NOT IN ('REGISTERED','RUNNING','DISCONNECTED') THEN
  RAISE EXCEPTION 'recipient binding must match its registered session channel' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.event_session_bindings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER binding_identity BEFORE INSERT ON hyperfide.event_session_bindings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.validate_event_session_binding();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.event_session_bindings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','consumer_id','session_id','namespace','registered_actor_id','registered_at');

-- Every native launch has one committed logical identity, including trusted library producers.
CREATE UNIQUE INDEX instruction_one_start_per_attempt ON hyperfide.outbox_events(organisation_id,run_id,aggregate_id)
 WHERE aggregate_type='attempt.instructions' AND event_type='instruction.start';
CREATE UNIQUE INDEX instruction_one_launch_per_run ON hyperfide.outbox_events(organisation_id,run_id,(payload->'body'->>'launch_id'))
 WHERE aggregate_type='attempt.instructions' AND event_type='instruction.start';
