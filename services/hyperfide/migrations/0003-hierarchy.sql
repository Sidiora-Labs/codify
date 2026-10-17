-- Hierarchy ownership is independent of worker compute leases and platform restore identity.
CREATE TABLE hyperfide.hierarchy_leaders (
 organisation_id uuid NOT NULL, run_id uuid NOT NULL,
 authority_epoch uuid NOT NULL, leader_session_id uuid NOT NULL,
 generation bigint NOT NULL CHECK(generation>=1),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,leader_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.hierarchy_packages (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,package_id uuid NOT NULL,
 feature_key hyperfide.name NOT NULL,
 allocation_policy text NOT NULL CHECK(allocation_policy IN ('FEATURE_STABLE','WAVE')),
 state text NOT NULL DEFAULT 'PLANNED' CHECK(state IN ('PLANNED','ASSIGNED','ACTIVE','CLOSING','CLOSED','BLOCKED','HANDOFF_PENDING','CANCELLED')),
 owner_generation bigint NOT NULL DEFAULT 1 CHECK(owner_generation>=1),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,package_id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.hierarchy_domain_owners (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,feature_key hyperfide.name NOT NULL,
 manager_session_id uuid NOT NULL,generation bigint NOT NULL DEFAULT 1 CHECK(generation>=1),
 state_version bigint NOT NULL DEFAULT 1 CHECK(state_version>=1),
 PRIMARY KEY(organisation_id,run_id,feature_key),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,manager_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.hierarchy_handoffs (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 authority_epoch uuid NOT NULL,leader_generation bigint NOT NULL CHECK(leader_generation>=1),
 predecessor_id uuid NOT NULL,successor_id uuid NOT NULL,
 package_snapshot jsonb NOT NULL CHECK(jsonb_typeof(package_snapshot)='array' AND jsonb_array_length(package_snapshot) BETWEEN 1 AND 256),
 task_ids jsonb NOT NULL CHECK(jsonb_typeof(task_ids)='array'),
 finding_ids jsonb NOT NULL CHECK(jsonb_typeof(finding_ids)='array'),
 context jsonb NOT NULL CHECK(jsonb_typeof(context)='object' AND octet_length(context::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,id,successor_id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,predecessor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,successor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 CHECK(predecessor_id<>successor_id)
);
CREATE TABLE hyperfide.hierarchy_handoff_acknowledgements (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,handoff_id uuid NOT NULL,
 successor_id uuid NOT NULL,acknowledged_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,handoff_id),
 FOREIGN KEY(organisation_id,run_id,handoff_id,successor_id) REFERENCES hyperfide.hierarchy_handoffs(organisation_id,run_id,id,successor_id),
 FOREIGN KEY(organisation_id,run_id,successor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.hierarchy_session_packages (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,session_id uuid NOT NULL,package_id uuid NOT NULL,
 registered_by uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,session_id,package_id),
 FOREIGN KEY(organisation_id,run_id,session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,registered_by) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.feature_packages(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.hierarchy_ownership_events (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 kind hyperfide.name NOT NULL,actor_session_id uuid NOT NULL,
 leader_generation bigint NOT NULL CHECK(leader_generation>=1),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object' AND octet_length(payload::text)<=1048576),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sequence bigint GENERATED ALWAYS AS IDENTITY,
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id) REFERENCES hyperfide.runs(organisation_id,id),
 FOREIGN KEY(organisation_id,run_id,actor_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id)
);
-- Every package lifecycle change (configure, assign, handoff, withdraw, explicit transition) is appended here.
CREATE TABLE hyperfide.hierarchy_package_transitions (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 sequence bigint GENERATED ALWAYS AS IDENTITY,
 package_id uuid NOT NULL,
 from_state text CHECK(from_state IN ('PLANNED','ASSIGNED','ACTIVE','CLOSING','CLOSED','BLOCKED','HANDOFF_PENDING','CANCELLED')),
 to_state text NOT NULL CHECK(to_state IN ('PLANNED','ASSIGNED','ACTIVE','CLOSING','CLOSED','BLOCKED','HANDOFF_PENDING','CANCELLED')),
 owner_generation bigint NOT NULL CHECK(owner_generation>=1),
 leader_generation bigint NOT NULL CHECK(leader_generation>=1),
 actor_session_id uuid NOT NULL,
 cause hyperfide.name NOT NULL,
 handoff_id uuid,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4096),
 evidence jsonb NOT NULL CHECK(jsonb_typeof(evidence)='object' AND octet_length(evidence::text)<=65536),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,package_id) REFERENCES hyperfide.hierarchy_packages(organisation_id,run_id,package_id),
 FOREIGN KEY(organisation_id,run_id,actor_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,handoff_id) REFERENCES hyperfide.hierarchy_handoffs(organisation_id,run_id,id),
 CHECK(from_state IS DISTINCT FROM to_state)
);
-- A pending handoff ends exactly once: acknowledged, withdrawn, or superseded by a newer proposal.
CREATE TABLE hyperfide.hierarchy_handoff_resolutions (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,handoff_id uuid NOT NULL,
 resolution text NOT NULL CHECK(resolution IN ('WITHDRAWN','SUPERSEDED')),
 superseded_by uuid,
 actor_session_id uuid NOT NULL,leader_generation bigint NOT NULL CHECK(leader_generation>=1),
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4096),
 resolved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,handoff_id),
 FOREIGN KEY(organisation_id,run_id,handoff_id) REFERENCES hyperfide.hierarchy_handoffs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,superseded_by) REFERENCES hyperfide.hierarchy_handoffs(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,actor_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 CHECK((resolution='SUPERSEDED')=(superseded_by IS NOT NULL)),
 CHECK(superseded_by IS DISTINCT FROM handoff_id)
);
-- Stable-domain transfer when the owner holds no live package (nothing to hand off package-by-package).
CREATE TABLE hyperfide.hierarchy_domain_transfers (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,
 feature_key hyperfide.name NOT NULL,
 predecessor_id uuid NOT NULL,successor_id uuid NOT NULL,
 domain_generation bigint NOT NULL CHECK(domain_generation>=2),
 leader_generation bigint NOT NULL CHECK(leader_generation>=1),
 actor_session_id uuid NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 4096),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 UNIQUE(organisation_id,run_id,feature_key,domain_generation),
 FOREIGN KEY(organisation_id,run_id,feature_key) REFERENCES hyperfide.hierarchy_domain_owners(organisation_id,run_id,feature_key),
 FOREIGN KEY(organisation_id,run_id,predecessor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,successor_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,actor_session_id) REFERENCES hyperfide.agent_sessions(organisation_id,run_id,id),
 CHECK(predecessor_id<>successor_id)
);
CREATE INDEX hierarchy_package_transitions_idx ON hyperfide.hierarchy_package_transitions(organisation_id,run_id,package_id,sequence);
CREATE INDEX hierarchy_packages_feature_idx ON hyperfide.hierarchy_packages(organisation_id,run_id,feature_key);
CREATE INDEX hierarchy_session_package_idx ON hyperfide.hierarchy_session_packages(organisation_id,run_id,package_id);
CREATE FUNCTION hyperfide.check_hierarchy_leader() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM hyperfide.agent_sessions WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND id=NEW.leader_session_id AND role='LEADER')
 THEN RAISE EXCEPTION 'leader role binding mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
-- Lifecycle graph: PLANNED -> ASSIGNED -> ACTIVE -> CLOSING -> CLOSED with BLOCKED, HANDOFF_PENDING and CANCELLED branches.
CREATE FUNCTION hyperfide.check_hierarchy_package_state() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF NEW.state IS DISTINCT FROM OLD.state AND NOT (
  (OLD.state='PLANNED' AND NEW.state IN ('ASSIGNED','CANCELLED')) OR
  (OLD.state='ASSIGNED' AND NEW.state IN ('ACTIVE','BLOCKED','CANCELLED','HANDOFF_PENDING')) OR
  (OLD.state='ACTIVE' AND NEW.state IN ('BLOCKED','CLOSING','CANCELLED','HANDOFF_PENDING')) OR
  (OLD.state='BLOCKED' AND NEW.state IN ('ACTIVE','CANCELLED','HANDOFF_PENDING')) OR
  (OLD.state='CLOSING' AND NEW.state IN ('ACTIVE','CLOSED','CANCELLED','HANDOFF_PENDING')) OR
  (OLD.state='HANDOFF_PENDING' AND NEW.state IN ('ASSIGNED','ACTIVE','BLOCKED','CLOSING')))
 THEN RAISE EXCEPTION 'illegal hierarchy package lifecycle transition % -> %',OLD.state,NEW.state USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE FUNCTION hyperfide.check_hierarchy_handoff_outcome() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,hyperfide AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM hyperfide.hierarchy_handoff_acknowledgements WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND handoff_id=NEW.handoff_id)
  OR EXISTS(SELECT 1 FROM hyperfide.hierarchy_handoff_resolutions WHERE organisation_id=NEW.organisation_id AND run_id=NEW.run_id AND handoff_id=NEW.handoff_id)
 THEN RAISE EXCEPTION 'hierarchy handoff already resolved' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hierarchy_package_lifecycle BEFORE UPDATE ON hyperfide.hierarchy_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.check_hierarchy_package_state();
CREATE TRIGGER hierarchy_handoff_outcome BEFORE INSERT ON hyperfide.hierarchy_handoff_acknowledgements FOR EACH ROW EXECUTE FUNCTION hyperfide.check_hierarchy_handoff_outcome();
CREATE TRIGGER hierarchy_handoff_outcome BEFORE INSERT ON hyperfide.hierarchy_handoff_resolutions FOR EACH ROW EXECUTE FUNCTION hyperfide.check_hierarchy_handoff_outcome();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_package_transitions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','sequence','package_id','from_state','to_state','owner_generation','leader_generation','actor_session_id','cause','handoff_id','reason','evidence','created_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_handoff_resolutions FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','handoff_id','resolution','superseded_by','actor_session_id','leader_generation','reason','resolved_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_domain_transfers FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','feature_key','predecessor_id','successor_id','domain_generation','leader_generation','actor_session_id','reason','created_at');
CREATE TRIGGER hierarchy_leader_role BEFORE INSERT OR UPDATE ON hyperfide.hierarchy_leaders FOR EACH ROW EXECUTE FUNCTION hyperfide.check_hierarchy_leader();
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_handoffs FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','authority_epoch','leader_generation','predecessor_id','successor_id','package_snapshot','task_ids','finding_ids','context','created_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_handoff_acknowledgements FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','handoff_id','successor_id','acknowledged_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_session_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','session_id','package_id','registered_by','created_at');
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.hierarchy_ownership_events FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','kind','actor_session_id','leader_generation','payload','created_at','sequence');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.hierarchy_leaders FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.hierarchy_leaders FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('generation');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.hierarchy_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','package_id','feature_key','allocation_policy');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.hierarchy_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('owner_generation');
CREATE TRIGGER immutable_binding BEFORE UPDATE ON hyperfide.hierarchy_domain_owners FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','feature_key');
CREATE TRIGGER monotonic_version BEFORE UPDATE ON hyperfide.hierarchy_domain_owners FOR EACH ROW EXECUTE FUNCTION hyperfide.monotonic_fields('generation');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_leaders FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_domain_owners FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_handoffs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_handoff_acknowledgements FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_session_packages FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_ownership_events FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_package_transitions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_handoff_resolutions FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.hierarchy_domain_transfers FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
