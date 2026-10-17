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


-- Native control streams bind one immutable standing consumer to an authenticated boot.
CREATE TABLE hyperfide.event_runner_bindings (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,consumer_id uuid NOT NULL,
 sandbox_id uuid NOT NULL,boot_id uuid NOT NULL,boot_generation bigint NOT NULL CHECK(boot_generation>0),
 registered_credential_id uuid NOT NULL,bootstrap_receipt_id uuid NOT NULL,
 registered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,consumer_id),
 UNIQUE(organisation_id,run_id,sandbox_id,boot_generation),
 UNIQUE(organisation_id,run_id,boot_id),
 FOREIGN KEY(organisation_id,run_id,consumer_id) REFERENCES hyperfide.event_consumers(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,sandbox_id,boot_generation) REFERENCES hyperfide.sandbox_boots(organisation_id,sandbox_id,boot_generation),
 FOREIGN KEY(organisation_id,boot_id) REFERENCES hyperfide.sandbox_boots(organisation_id,boot_id),
 FOREIGN KEY(organisation_id,run_id,bootstrap_receipt_id) REFERENCES hyperfide.command_inbox(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.validate_event_runner_binding() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
DECLARE consumer_record record;receipt_record record;actual_boot uuid;
BEGIN
 SELECT consumer_key,state INTO consumer_record FROM hyperfide.event_consumers
 WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.consumer_id;
 SELECT boot_id INTO actual_boot FROM hyperfide.sandbox_boots
 WHERE organisation_id=NEW.organisation_id AND sandbox_id=NEW.sandbox_id AND boot_generation=NEW.boot_generation;
 SELECT principal_scope,operation,state,result INTO receipt_record FROM hyperfide.command_inbox
 WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.bootstrap_receipt_id;
 IF actual_boot IS DISTINCT FROM NEW.boot_id
 OR consumer_record.consumer_key IS DISTINCT FROM ('runner:'||NEW.sandbox_id::text||':'||NEW.boot_id::text)
 OR consumer_record.state NOT IN ('BUFFERING','ACTIVE')
 OR receipt_record.principal_scope IS DISTINCT FROM NEW.consumer_id::text
 OR receipt_record.operation IS DISTINCT FROM 'instruction.consumer-genesis' OR receipt_record.state IS DISTINCT FROM 'COMPLETED'
 OR receipt_record.result->>'consumer_id' IS DISTINCT FROM NEW.consumer_id::text
 OR receipt_record.result->>'sandbox_id' IS DISTINCT FROM NEW.sandbox_id::text
 OR receipt_record.result->>'boot_id' IS DISTINCT FROM NEW.boot_id::text
 OR receipt_record.result->>'boot_generation' IS DISTINCT FROM NEW.boot_generation::text
 OR receipt_record.result->'empty_native_history' IS DISTINCT FROM 'true'::jsonb THEN
  RAISE EXCEPTION 'native recipient binding requires its exact boot and committed genesis receipt' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.event_runner_bindings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER binding_identity BEFORE INSERT ON hyperfide.event_runner_bindings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.validate_event_runner_binding();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.event_runner_bindings
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','consumer_id','sandbox_id','boot_id','boot_generation','registered_credential_id','bootstrap_receipt_id','registered_at');

-- Boot genesis proves absence within this exact targeted native stream.
CREATE INDEX instruction_boot_history ON hyperfide.outbox_events(organisation_id,run_id,(payload->>'sandbox_id'),(payload->>'boot_id'))
 WHERE aggregate_type='attempt.instructions';
