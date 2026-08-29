#!/usr/bin/env bash
# indexing accuracy: scope-aware attribution, content-hash skip, schema upgrade
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

# (a) a top-level ref after a function body is not attributed to that function:
# jobs.ts calls registerHandler at module level, below scheduleJob's scope
out="$("$CG" impact registerHandler -d 2)"
hasnt "$out" "scheduleJob"

# (b) impact no longer lists a false same-named caller: audit.ts calls
# trackChange at module level after record(), which also exists in metrics.ts
out="$("$CG" impact trackChange -d 2)"
hasnt "$out" "record"

# real callers inside a scope still resolve
out="$("$CG" impact load_tasks -d 2)"
has "$out" "save_tasks"

# (c) touch with identical content: metadata refreshed, children kept —
# "indexed 0" proves the purge+reinsert (and rowid churn) was skipped
sleep 1
touch src/util.ts
out="$("$CG" sync)"
has "$out" "indexed 0 files"
out="$("$CG" search formatName)"
has "$out" "src/util.ts"

# (d) schema upgrade: a version mismatch rebuilds the derived graph on the
# next sync while memories survive untouched
"$CG" remember "schema upgrade survivor" >/dev/null
python3 - <<'PY'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
db.execute("UPDATE meta SET value='0' WHERE key='schema_version'")
db.commit()
db.close()
PY
out="$("$CG" sync)"
hasnt "$out" "indexed 0 files"
out="$("$CG" search formatName)"
has "$out" "src/util.ts"
out="$("$CG" recall survivor)"
has "$out" "schema upgrade survivor"

# (e) C definition-site precision: struct/enum uses are not definitions,
# prototypes collapse with definitions, system includes are recorded
out="$("$CG" symbol Config)"
has "$out" "Config"
out="$("$CG" symbol Opaque)"
has "$out" "Opaque"
out="$("$CG" symbol Node)"
has "$out" "Node"
out="$("$CG" symbol Level)"
has "$out" "Level"
# struct stat st; must NOT create a definition of stat — only a reference.
# The symbols table should have no row named 'stat' from helpers.c.
stat_defs="$(sqlite3 .codegraph/graph.db \
  "SELECT COUNT(*) FROM symbols WHERE name='stat' AND file_id IN \
   (SELECT id FROM files WHERE path='src/helpers.c')")"
[ "$stat_defs" -eq 0 ] || fail "struct stat st created a spurious definition"
# prototype + definition = one symbol
out="$("$CG" search helpers_init)"
has "$out" "src/helpers.c"
# system includes recorded
out="$(sqlite3 .codegraph/graph.db \
  "SELECT module FROM imports WHERE system=1 AND file_id IN \
   (SELECT id FROM files WHERE path='src/helpers.c') LIMIT 1")"
has "$out" "stdio.h"

# (f) multi-def caller disambiguation: 'record' is defined in src/audit.ts,
# src/metrics.ts and src/replay/local.ts; impact resolves to the path-ASC
# first def (audit.ts) and keeps only callers whose imports name it —
# including the extension-bearing '../audit.js' import, which must beat the
# same-directory decoy def in src/replay/local.ts
out="$("$CG" impact record -d 1)"
has "$out" "src/audit.ts"
has "$out" "writeReport"
has "$out" "replayAudit"
hasnt "$out" "bumpGauge"

# (g) empty v1 DB: a version mismatch with zero files rows must still rebuild
# the derived tables — otherwise the old refs shape survives the version
# stamp and the first sync dies on the missing qual column
mkdir -p "$TMP/empty/docs"
cd "$TMP/empty"
echo "prose only" > docs/notes.md
"$CG" init >/dev/null 2>&1
python3 - <<'PY'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
db.executescript("""
DROP TABLE refs;
CREATE TABLE refs(id INTEGER PRIMARY KEY, file_id INTEGER NOT NULL,
  name TEXT NOT NULL, line INTEGER, sym_id INTEGER);
DELETE FROM files;
UPDATE meta SET value='0' WHERE key='schema_version';
""")
db.commit()
db.close()
PY
mkdir -p src
echo "export function fresher(): number { return 7; }" > src/fresh.ts
out="$("$CG" sync)"
has "$out" "indexed"
out="$("$CG" search fresher)"
has "$out" "src/fresh.ts"

echo ok
