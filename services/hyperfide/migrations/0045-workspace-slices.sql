-- Packet-scoped workspace slices (task 11.5); applied only by the migration engine.
-- Every row is immutable history: a widening is a new manifest naming its parent, a release is a new event.
CREATE TABLE hyperfide.workspace_slice_manifests (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,digest hyperfide.digest NOT NULL,derivation_key hyperfide.digest NOT NULL,
 packet_digest hyperfide.digest NOT NULL,repository_id uuid NOT NULL,commit hyperfide.git_oid NOT NULL,
 graph_manifest_id uuid,graph_manifest_digest hyperfide.digest,
 mode text NOT NULL CHECK(mode IN ('SLICE','FULL_TREE')),fallback_reason text CHECK(fallback_reason IS NULL OR fallback_reason ~ '^[A-Z][A-Z0-9_]{2,63}$'),
 parent_slice_digest hyperfide.digest,manifest jsonb NOT NULL,manifest_text text NOT NULL CHECK(octet_length(manifest_text)<=4194304),
 created_by_credential_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,digest),UNIQUE(organisation_id,run_id,derivation_key),
 CHECK((mode='FULL_TREE')=(fallback_reason IS NOT NULL)),
 CHECK((graph_manifest_id IS NULL)=(graph_manifest_digest IS NULL)),
 CHECK(mode='FULL_TREE' OR graph_manifest_id IS NOT NULL),
 CHECK(parent_slice_digest IS NULL OR parent_slice_digest<>digest),
 FOREIGN KEY(organisation_id,run_id,packet_digest) REFERENCES hyperfide.hierarchy_execution_packets(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,repository_id) REFERENCES hyperfide.run_repositories(organisation_id,run_id,repository_id),
 FOREIGN KEY(organisation_id,run_id,parent_slice_digest) REFERENCES hyperfide.workspace_slice_manifests(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,created_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.workspace_slice_manifests
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','digest','derivation_key','packet_digest','repository_id','commit','graph_manifest_id','graph_manifest_digest','mode','fallback_reason','parent_slice_digest','manifest','manifest_text','created_by_credential_id','created_at');

-- One row per materialisation attempt or release; READY rows are the only slot-ready source claims.
CREATE TABLE hyperfide.workspace_slice_materialisations (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,slice_digest hyperfide.digest NOT NULL,
 sandbox_id uuid NOT NULL,slot_id uuid NOT NULL,sandbox_boot_generation bigint NOT NULL CHECK(sandbox_boot_generation>0),
 outcome text NOT NULL CHECK(outcome IN ('READY','FAILED','REFUSED','RELEASED')),reason text CHECK(reason IS NULL OR reason ~ '^[A-Z][A-Z0-9_]{2,63}$'),
 released_materialisation_id uuid,verified_head hyperfide.git_oid,evidence jsonb NOT NULL,evidence_digest hyperfide.digest NOT NULL,
 created_by_credential_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 CHECK((outcome='READY')=(verified_head IS NOT NULL)),
 CHECK((outcome IN ('READY','RELEASED'))=(reason IS NULL)),
 CHECK((outcome='RELEASED')=(released_materialisation_id IS NOT NULL)),
 FOREIGN KEY(organisation_id,run_id,slice_digest) REFERENCES hyperfide.workspace_slice_manifests(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,sandbox_id,slot_id,sandbox_boot_generation) REFERENCES hyperfide.worker_slots(organisation_id,sandbox_id,id,boot_generation),
 FOREIGN KEY(organisation_id,run_id,released_materialisation_id) REFERENCES hyperfide.workspace_slice_materialisations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,created_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE UNIQUE INDEX workspace_slice_single_release ON hyperfide.workspace_slice_materialisations(organisation_id,run_id,released_materialisation_id) WHERE released_materialisation_id IS NOT NULL;
CREATE INDEX workspace_slice_materialisations_slot ON hyperfide.workspace_slice_materialisations(organisation_id,sandbox_id,slot_id,sandbox_boot_generation);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.workspace_slice_materialisations
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','slice_digest','sandbox_id','slot_id','sandbox_boot_generation','outcome','reason','released_materialisation_id','verified_head','evidence','evidence_digest','created_by_credential_id','created_at');

CREATE TABLE hyperfide.workspace_slice_receipts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,operation_id uuid NOT NULL,request_digest hyperfide.digest NOT NULL,
 slice_digest hyperfide.digest NOT NULL,materialisation_id uuid NOT NULL,commit hyperfide.git_oid NOT NULL,graph_manifest_digest hyperfide.digest,
 qualification_scope text NOT NULL CHECK(qualification_scope IN ('SLICE','FULL_TREE')),full_tree_equivalent boolean NOT NULL,
 qualification_outcome text NOT NULL CHECK(qualification_outcome IN ('PASS','FAIL','REFUSED')),
 receipt jsonb NOT NULL,receipt_digest hyperfide.digest NOT NULL,created_by_credential_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),UNIQUE(organisation_id,run_id,operation_id),
 -- Slice qualification can never be stored as full-tree-equivalent qualification.
 CHECK((qualification_scope='SLICE')=(NOT full_tree_equivalent)),
 FOREIGN KEY(organisation_id,run_id,slice_digest) REFERENCES hyperfide.workspace_slice_manifests(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,materialisation_id) REFERENCES hyperfide.workspace_slice_materialisations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,created_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.workspace_slice_receipts
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','operation_id','request_digest','slice_digest','materialisation_id','commit','graph_manifest_digest','qualification_scope','full_tree_equivalent','qualification_outcome','receipt','receipt_digest','created_by_credential_id','created_at');

-- Out-of-slice access is never ignored: each detection is REFUSED or WIDENED into a new manifest.
CREATE TABLE hyperfide.workspace_slice_access_events (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,id uuid NOT NULL,slice_digest hyperfide.digest NOT NULL,
 materialisation_id uuid,receipt_id uuid,path text CHECK(path IS NULL OR (octet_length(path) BETWEEN 1 AND 4096 AND path !~ '[[:cntrl:]]')),
 access text NOT NULL CHECK(access IN ('READ','WRITE')),
 source text NOT NULL CHECK(source IN ('LAZY_FETCH','WORKTREE_STATUS','SKIP_WORKTREE','ACCESS_MONITOR','ACCESS_MONITOR_UNAVAILABLE','DECLARED_REQUIREMENT','EXPLICIT_WIDENING')),
 decision text NOT NULL CHECK(decision IN ('REFUSED','WIDENED')),reason text NOT NULL CHECK(reason ~ '^[A-Z][A-Z0-9_]{2,63}$'),
 widened_slice_digest hyperfide.digest,created_by_credential_id uuid NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(organisation_id,run_id,id),
 CHECK((decision='WIDENED')=(widened_slice_digest IS NOT NULL)),
 CHECK(path IS NOT NULL OR source='ACCESS_MONITOR_UNAVAILABLE'),
 FOREIGN KEY(organisation_id,run_id,slice_digest) REFERENCES hyperfide.workspace_slice_manifests(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,widened_slice_digest) REFERENCES hyperfide.workspace_slice_manifests(organisation_id,run_id,digest),
 FOREIGN KEY(organisation_id,run_id,materialisation_id) REFERENCES hyperfide.workspace_slice_materialisations(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,receipt_id) REFERENCES hyperfide.workspace_slice_receipts(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,created_by_credential_id) REFERENCES hyperfide.identity_principals(organisation_id,run_id,credential_id)
);
CREATE INDEX workspace_slice_access_events_slice ON hyperfide.workspace_slice_access_events(organisation_id,run_id,slice_digest);
CREATE TRIGGER immutable_binding BEFORE UPDATE OR DELETE ON hyperfide.workspace_slice_access_events
 FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','id','slice_digest','materialisation_id','receipt_id','path','access','source','decision','reason','widened_slice_digest','created_by_credential_id','created_at');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.workspace_slice_manifests FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.workspace_slice_materialisations FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.workspace_slice_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.workspace_slice_access_events FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
