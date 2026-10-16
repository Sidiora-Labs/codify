-- Historical imports never enter the live authority tables.
CREATE SCHEMA IF NOT EXISTS hyperfide_history;
CREATE TABLE IF NOT EXISTS hyperfide_history.imports(
 id uuid PRIMARY KEY, source_id uuid NOT NULL, repository_id uuid NOT NULL,
 organisation_id uuid NOT NULL, snapshot_digest text NOT NULL CHECK(snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
 archive_path text NOT NULL, inventory jsonb NOT NULL, external_inventory jsonb NOT NULL,
 authority text NOT NULL DEFAULT 'NONE' CHECK(authority='NONE'),
 qualification text NOT NULL DEFAULT 'UNQUALIFIED' CHECK(qualification='UNQUALIFIED'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(organisation_id,repository_id,source_id,snapshot_digest));
CREATE TABLE IF NOT EXISTS hyperfide_history.rows(
 import_id uuid NOT NULL REFERENCES hyperfide_history.imports(id),
 mapped_id uuid NOT NULL, table_name text NOT NULL, legacy_key jsonb NOT NULL,
 payload jsonb NOT NULL, payload_digest text NOT NULL, disposition text NOT NULL
 CHECK(disposition IN ('HISTORY','REQUIRES_RECONCILIATION','UNSUPPORTED_SEMANTICS')),
 PRIMARY KEY(import_id,mapped_id));
CREATE INDEX IF NOT EXISTS history_rows_table ON hyperfide_history.rows(import_id,table_name);
CREATE TABLE IF NOT EXISTS hyperfide_history.batches(
 import_id uuid NOT NULL REFERENCES hyperfide_history.imports(id),
 table_name text NOT NULL, start_offset bigint NOT NULL CHECK(start_offset>=0),
 request_digest text NOT NULL, result jsonb NOT NULL, PRIMARY KEY(import_id,table_name,start_offset));
CREATE TABLE IF NOT EXISTS hyperfide_history.cutovers(
 scope_id uuid PRIMARY KEY, state text NOT NULL CHECK(state IN ('LOCAL','QUIESCED','VALIDATED','ACTIVE','RECOVERY_REQUIRED','ROLLED_BACK')),
 generation bigint NOT NULL CHECK(generation>0), epoch uuid, source_import_id uuid REFERENCES hyperfide_history.imports(id),
 checkpoint_digest text, external_effects bigint NOT NULL DEFAULT 0 CHECK(external_effects>=0),
 authoritative_writes bigint NOT NULL DEFAULT 0 CHECK(authoritative_writes>=0),
 evidence jsonb NOT NULL DEFAULT '{}', updated_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE UNIQUE INDEX IF NOT EXISTS history_cutover_epoch ON hyperfide_history.cutovers(epoch) WHERE epoch IS NOT NULL;
CREATE TABLE IF NOT EXISTS hyperfide_history.cutover_receipts(
 scope_id uuid NOT NULL REFERENCES hyperfide_history.cutovers(scope_id),
 operation_id text NOT NULL, request_digest text NOT NULL, result jsonb NOT NULL,
 PRIMARY KEY(scope_id,operation_id));
