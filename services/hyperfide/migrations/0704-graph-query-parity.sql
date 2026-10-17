-- Domain 07 query parity: expression indexes for contract/route lookups and
-- per-bundle local fact identities used by grouped projection queries.
-- Applied by task 4.4's migration engine; service handlers never execute DDL.
-- Every statement is idempotent so an interrupted upgrade is resumed by re-applying
-- this file; dropping these indexes is the safe reversal (no data is rewritten).
-- No table is added, so no new authority isolation guard trigger is required.
CREATE INDEX IF NOT EXISTS graph_facts_local_id ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,bundle_digest,family,(payload->>'id'));
CREATE INDEX IF NOT EXISTS graph_facts_route_id ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,bundle_digest,(payload->>'route_id')) WHERE family='semantic_route_facts';
CREATE INDEX IF NOT EXISTS graph_facts_routes ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,(payload->>'method'),(payload->>'pattern')) WHERE family='routes';
CREATE INDEX IF NOT EXISTS graph_facts_route_mounts ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,bundle_digest,(payload->>'mount_route_id')) WHERE family='semantic_route_compositions';
CREATE INDEX IF NOT EXISTS graph_facts_route_children ON hyperfide.graph_fact_rows(organisation_id,run_id,graph_id,bundle_digest,(payload->>'child_route_id')) WHERE family='semantic_route_compositions';
