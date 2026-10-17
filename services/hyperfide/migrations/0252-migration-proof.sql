-- Cutover proof records. The 0025 history tables stay where they are; these
-- tables only add evidence. None of them can grant PostgreSQL authority.
ALTER TABLE hyperfide_history.cutovers ADD COLUMN IF NOT EXISTS organisation_id uuid;
CREATE INDEX IF NOT EXISTS history_cutover_organisation ON hyperfide_history.cutovers(organisation_id,scope_id);
CREATE TABLE IF NOT EXISTS hyperfide_history.cutover_parity_receipts(
 scope_id uuid NOT NULL REFERENCES hyperfide_history.cutovers(scope_id),
 generation bigint NOT NULL CHECK(generation>0),
 import_id uuid NOT NULL REFERENCES hyperfide_history.imports(id),
 snapshot_digest text NOT NULL CHECK(snapshot_digest ~ '^sha256:[0-9a-f]{64}$'),
 legacy_isolation_digest text NOT NULL CHECK(legacy_isolation_digest ~ '^sha256:[0-9a-f]{64}$'),
 counts jsonb NOT NULL, samples jsonb NOT NULL, source jsonb NOT NULL,
 git jsonb NOT NULL, artifacts jsonb NOT NULL,
 shadow_digest text NOT NULL CHECK(shadow_digest ~ '^sha256:[0-9a-f]{64}$'),
 receipt_digest text NOT NULL CHECK(receipt_digest ~ '^sha256:[0-9a-f]{64}$'),
 outcome text NOT NULL CHECK(outcome='MATCHED'),
 authority text NOT NULL DEFAULT 'NONE' CHECK(authority='NONE'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scope_id,generation));
CREATE TABLE IF NOT EXISTS hyperfide_history.cutover_rehearsals(
 scope_id uuid NOT NULL REFERENCES hyperfide_history.cutovers(scope_id),
 operation_id text NOT NULL,
 generation bigint NOT NULL CHECK(generation>0),
 path text NOT NULL CHECK(path IN ('ROLLBACK_BEFORE_WRITES','ROLLBACK_REFUSED_AFTER_WRITES','RECOVERY_AFTER_EFFECTS')),
 baseline jsonb NOT NULL, observed jsonb NOT NULL,
 authoritative_writes bigint NOT NULL CHECK(authoritative_writes>=0),
 external_effects bigint NOT NULL CHECK(external_effects>=0),
 sqlite_authority_reopened boolean NOT NULL DEFAULT false CHECK(sqlite_authority_reopened=false),
 procedure jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(scope_id,operation_id),
 CHECK(path<>'ROLLBACK_BEFORE_WRITES' OR (authoritative_writes=0 AND external_effects=0)),
 CHECK(path='ROLLBACK_BEFORE_WRITES' OR authoritative_writes+external_effects>0));
