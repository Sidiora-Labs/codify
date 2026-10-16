-- Domain 07 queryable source facts and resumable immutable bundle transport.
-- PostgreSQL standard pg_trgm extension supplies bounded GIN index maintenance.
-- https://www.postgresql.org/docs/18/pgtrgm.html
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA public;
-- Applied by task 4.4's migration engine; service handlers never execute DDL.
CREATE TABLE hyperfide.graph_bundle_inputs (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,graph_id uuid NOT NULL,
 bundle_digest hyperfide.digest NOT NULL,identity jsonb NOT NULL,manifest jsonb NOT NULL,
 manifest_text text NOT NULL,artifact_id uuid NOT NULL,
 PRIMARY KEY(organisation_id,run_id,graph_id,bundle_digest),
 FOREIGN KEY(organisation_id,run_id,graph_id) REFERENCES hyperfide.graph_builds(organisation_id,run_id,id),
 FOREIGN KEY(organisation_id,run_id,artifact_id) REFERENCES hyperfide.artifacts(organisation_id,run_id,id),
 CHECK(jsonb_typeof(identity)='object' AND jsonb_typeof(manifest)='object'),
 CHECK(manifest_text::jsonb=manifest)
);
CREATE TABLE hyperfide.graph_ingestion_chunks (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,graph_id uuid NOT NULL,
 bundle_digest hyperfide.digest NOT NULL,chunk_index integer NOT NULL CHECK(chunk_index>=0),
 chunk_digest hyperfide.digest NOT NULL,row_count integer NOT NULL CHECK(row_count>=0),
 byte_count integer NOT NULL CHECK(byte_count>=0 AND byte_count<=262144),
 PRIMARY KEY(organisation_id,run_id,graph_id,bundle_digest,chunk_index),
 FOREIGN KEY(organisation_id,run_id,graph_id,bundle_digest)
 REFERENCES hyperfide.graph_bundle_inputs(organisation_id,run_id,graph_id,bundle_digest)
);
CREATE TABLE hyperfide.graph_fact_rows (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,graph_id uuid NOT NULL,
 bundle_digest hyperfide.digest NOT NULL,family text NOT NULL,fact_key text NOT NULL,
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(organisation_id,run_id,graph_id,bundle_digest,family,fact_key),
 FOREIGN KEY(organisation_id,run_id,graph_id,bundle_digest)
 REFERENCES hyperfide.graph_bundle_inputs(organisation_id,run_id,graph_id,bundle_digest),
 CHECK(family IN ('files','symbols','refs','imports','routes','comments','semantic_symbols',
 'semantic_references','semantic_bindings','semantic_type_facts','semantic_edges','semantic_dependencies',
 'semantic_route_facts','semantic_route_compositions','semantic_identifier_postings','extraction_health','source_bodies'))
);
CREATE INDEX graph_facts_family ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,family,bundle_digest,fact_key);
CREATE INDEX graph_facts_payload ON hyperfide.graph_fact_rows USING gin(payload jsonb_path_ops);
CREATE INDEX graph_facts_file ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,bundle_digest,family,(payload->>'file_id'));
CREATE INDEX graph_facts_name ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,family,(payload->>'name'));
CREATE TABLE hyperfide.graph_resolution_progress (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,graph_id uuid NOT NULL,
 phase text NOT NULL DEFAULT 'files' CHECK(phase IN ('files','symbols','refs','semantic_edges','source_bodies','COMPLETE')),
 cursor_bundle text NOT NULL DEFAULT '',cursor_key text NOT NULL DEFAULT '',
 rows_processed bigint NOT NULL DEFAULT 0 CHECK(rows_processed>=0),
 PRIMARY KEY(organisation_id,run_id,graph_id),
 FOREIGN KEY(organisation_id,run_id,graph_id) REFERENCES hyperfide.graph_builds(organisation_id,run_id,id)
);
CREATE TABLE hyperfide.graph_source_bodies (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,graph_id uuid NOT NULL,
 bundle_digest hyperfide.digest NOT NULL,path text NOT NULL,content_digest hyperfide.digest NOT NULL,
 body text NOT NULL,
 search_vector tsvector GENERATED ALWAYS AS (to_tsvector('simple'::regconfig,body)) STORED,
 PRIMARY KEY(organisation_id,run_id,graph_id,bundle_digest,path),
 FOREIGN KEY(organisation_id,run_id,graph_id,bundle_digest)
 REFERENCES hyperfide.graph_bundle_inputs(organisation_id,run_id,graph_id,bundle_digest),
 CHECK(octet_length(body)<=2097152)
);
CREATE INDEX graph_bodies_fts ON hyperfide.graph_source_bodies USING gin(search_vector);
CREATE INDEX graph_bodies_trigram ON hyperfide.graph_source_bodies USING gin(body public.gin_trgm_ops);
CREATE INDEX graph_facts_trigram ON hyperfide.graph_fact_rows USING gin((COALESCE(payload->>'name',payload->>'body','')) public.gin_trgm_ops) WHERE family IN ('symbols','comments');
CREATE INDEX graph_comments_fts ON hyperfide.graph_fact_rows USING gin(to_tsvector('simple'::regconfig,COALESCE(payload->>'body',''))) WHERE family='comments';
CREATE INDEX graph_symbols_fts ON hyperfide.graph_fact_rows USING gin(to_tsvector('simple'::regconfig,COALESCE(payload->>'name','')||' '||COALESCE(payload->>'sig',''))) WHERE family='symbols';
CREATE TABLE hyperfide.graph_publication_receipts (
 organisation_id uuid NOT NULL,run_id uuid NOT NULL,operation_id uuid NOT NULL,
 graph_id uuid NOT NULL,channel text NOT NULL,expected_generation bigint NOT NULL,
 manifest_id uuid NOT NULL,manifest_digest hyperfide.digest NOT NULL,
 publication_generation bigint NOT NULL,receipt jsonb NOT NULL,
 PRIMARY KEY(organisation_id,run_id,operation_id),
 FOREIGN KEY(organisation_id,run_id,manifest_id) REFERENCES hyperfide.graph_manifests(organisation_id,run_id,id)
);
CREATE FUNCTION hyperfide.protect_graph_extension() RETURNS trigger LANGUAGE plpgsql
SET search_path=pg_catalog,hyperfide AS $$
DECLARE g uuid; org uuid; run uuid;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.organisation_id,NEW.run_id,NEW.graph_id) IS DISTINCT FROM ROW(OLD.organisation_id,OLD.run_id,OLD.graph_id) THEN
  RAISE EXCEPTION 'graph extension scope immutable' USING ERRCODE='23514';
 END IF;
 g=COALESCE(NEW.graph_id,OLD.graph_id);org=COALESCE(NEW.organisation_id,OLD.organisation_id);run=COALESCE(NEW.run_id,OLD.run_id);
 PERFORM 1 FROM hyperfide.graph_builds WHERE organisation_id=org AND run_id=run AND id=g FOR SHARE;
 IF EXISTS(SELECT 1 FROM hyperfide.graph_manifests WHERE organisation_id=org AND run_id=run AND build_id=g) THEN
  RAISE EXCEPTION 'published graph extension immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;RETURN NEW;
END $$;
CREATE TRIGGER graph_extension_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_bundle_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_graph_extension();
CREATE TRIGGER graph_extension_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_ingestion_chunks FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_graph_extension();
CREATE TRIGGER graph_extension_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_fact_rows FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_graph_extension();
CREATE TRIGGER graph_extension_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_resolution_progress FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_graph_extension();
CREATE TRIGGER graph_extension_guard BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_source_bodies FOR EACH ROW EXECUTE FUNCTION hyperfide.protect_graph_extension();
CREATE TRIGGER graph_receipt_immutable BEFORE UPDATE OR DELETE ON hyperfide.graph_publication_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.immutable_fields('organisation_id','run_id','operation_id','graph_id','channel','expected_generation','manifest_id','manifest_digest','publication_generation','receipt');

CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_bundle_inputs FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_ingestion_chunks FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_fact_rows FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_resolution_progress FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_source_bodies FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
CREATE TRIGGER aaa_supported_isolation BEFORE INSERT OR UPDATE OR DELETE ON hyperfide.graph_publication_receipts FOR EACH ROW EXECUTE FUNCTION hyperfide.require_authority_isolation();
