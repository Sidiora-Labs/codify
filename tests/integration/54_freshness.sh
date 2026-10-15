#!/usr/bin/env bash
# Subsecond metadata, explicit dirty paths and legacy timestamp migration.
. "$(dirname "$0")/../lib.sh"
command -v sqlite3 >/dev/null || { echo "54_freshness: SKIP (no sqlite3 CLI)"; exit 0; }

mkdir -p "$TMP/proj"
cd "$TMP/proj"
git init -q .
printf '.codegraph/\n' > .gitignore
printf 'int alpha(void) { return 1; }\n' > source.c
python3 - <<'PY'
import os
os.utime('source.c', ns=(1_700_000_000_100_000_000,)*2)
PY
"$CG" init >/dev/null
q() { sqlite3 .codegraph/graph.db "$1"; }
symbol() { q "SELECT name FROM symbols WHERE file_id=(SELECT id FROM files WHERE path='source.c') AND kind='function'"; }
[ "$(symbol)" = alpha ] || fail "initial symbol missing"

# Same byte count and same whole second, but a different fractional timestamp.
printf 'int bravo(void) { return 1; }\n' > source.c
python3 - <<'PY'
import os
os.utime('source.c', ns=(1_700_000_000_800_000_000,)*2)
PY
out="$("$CG" sync --json)"
[ "$(symbol)" = bravo ] || fail "same-second edit was skipped: $out"
[ "$(q "SELECT mtime_ns FROM files WHERE path='source.c'")" = 1700000000800000000 ] \
    || fail "fractional timestamp was not stored"

# Preserving the entire stat prefilter is allowed when the caller names the
# dirty path; its bytes must still be checked. An unchanged named path should
# retain the same symbol identity and report no reparse.
before="$(q "SELECT id FROM symbols WHERE name='bravo'")"
out="$("$CG" sync --json source.c)"
[ "$(q "SELECT id FROM symbols WHERE name='bravo'")" = "$before" ] \
    || fail "unchanged dirty path rewrote its symbols: $out"
printf 'int delta(void) { return 1; }\n' > source.c
python3 - <<'PY'
import os
os.utime('source.c', ns=(1_700_000_000_800_000_000,)*2)
PY
out="$("$CG" sync --json source.c)"
[ "$(symbol)" = delta ] || fail "named preserved-metadata edit was skipped: $out"

# A queued editor note must carry the same guarantee through a full walk.
printf 'int theta(void) { return 1; }\n' > source.c
python3 - <<'PY'
import os
os.utime('source.c', ns=(1_700_000_000_800_000_000,)*2)
PY
printf 'source.c\n' > .codegraph/index.dirty
out="$("$CG" sync --json)"
[ "$(symbol)" = theta ] || fail "queued dirty path was skipped: $out"

# NULL in an upgraded row forces content verification even when the legacy
# whole-second timestamp and file size would have matched.
sqlite3 .codegraph/graph.db "UPDATE files SET mtime_ns=NULL WHERE path='source.c'"
printf 'int gamma(void) { return 1; }\n' > source.c
python3 - <<'PY'
import os
os.utime('source.c', ns=(1_700_000_000_800_000_000,)*2)
PY
out="$("$CG" sync --json)"
[ "$(symbol)" = gamma ] || fail "legacy row was not verified: $out"
[ "$(q "SELECT mtime_ns IS NOT NULL FROM files WHERE path='source.c'")" = 1 ] \
    || fail "legacy timestamp was not migrated"
out="$("$CG" sync --json)"
case "$out" in *'"indexed":0'*) : ;; *) fail "no-op walk rewrote unchanged content: $out" ;; esac

# Simulate opening an older database whose files table lacks the new column.
sqlite3 .codegraph/graph.db "ALTER TABLE files DROP COLUMN mtime_ns"
printf 'int omega(void) { return 1; }\n' > source.c
python3 - <<'PY'
import os
os.utime('source.c', ns=(1_700_000_000_800_000_000,)*2)
PY
out="$("$CG" sync --json --max-age 100000)"
[ "$(symbol)" = omega ] || fail "older database was not verified: $out"
[ "$(q "SELECT mtime_ns FROM files WHERE path='source.c'")" = 1700000000800000000 ] \
    || fail "older database was not migrated"
echo "54_freshness: ok"
