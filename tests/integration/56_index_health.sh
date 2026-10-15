#!/usr/bin/env bash
# Extraction coverage, upgrade invalidation, and preservation of prior facts.
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj/src" "$TMP/proj/src/generated"
cd "$TMP/proj"
git init -q -b main . 2>/dev/null || git init -q .
git config user.email t@t
git config user.name t
printf 'function kept() {}\n' > src/kept.ts
printf '%s\n' '// @generated' 'function autoFact() {}' > src/generated/auto.ts
python3 - <<'PY'
with open('src/long.ts', 'w') as f:
    f.write('function before() {}\n')
    f.write('x' * 4100 + '\n')
    f.write('function after() {}\n')
PY
printf '\000binary' > src/binary.ts
truncate -s 8388609 src/huge.ts
git add src
git commit -qm baseline
"$CG" init >/dev/null
DB=.codegraph/graph.db
q() { sqlite3 "$DB" "$1"; }

row="$(q "SELECT status,reason,parser,diagnostic_line,extraction_version IS NULL FROM extraction_health WHERE path='src/long.ts'")"
[ "$row" = 'partial|long_line|heuristic|2|1' ] || fail "long-line coverage: $row"
row="$(q "SELECT status,generated,extraction_version FROM extraction_health WHERE path='src/generated/auto.ts'")"
[ "$row" = 'complete|1|1' ] || fail "generated coverage: $row"
row="$(q "SELECT status,reason FROM extraction_health WHERE path='src/binary.ts'")"
[ "$row" = 'skipped|binary_file' ] || fail "binary coverage: $row"
row="$(q "SELECT status,reason FROM extraction_health WHERE path='src/huge.ts'")"
[ "$row" = 'skipped|size_limit' ] || fail "size coverage: $row"
rm src/huge.ts
"$CG" sync >/dev/null
[ "$(q "SELECT count(*) FROM extraction_health WHERE path='src/huge.ts'")" -eq 0 ] || fail 'deleted skipped file retained health'
hash="$(q "SELECT last_success_hash FROM extraction_health WHERE path='src/kept.ts'")"
[ "${#hash}" -eq 64 ] || fail "missing successful hash"

# An extractor-only version change must reparse unchanged source bytes.
rm src/long.ts
"$CG" sync >/dev/null
q "UPDATE extraction_health SET extraction_version=0 WHERE path='src/kept.ts'"
out="$("$CG" sync --json 2>/dev/null)"
row="$(q "SELECT status,extraction_version,last_success_hash FROM extraction_health WHERE path='src/kept.ts'")"
[ "$row" = "complete|1|$hash" ] || fail "version refresh: $row"
has "$out" '"indexed":'
has "$out" '"walk":"full"'

# A transient read failure leaves old source facts and successful hash intact.
# Running as an unprivileged user makes a mode-000 file genuinely unreadable
# even when the test runner itself has root privileges.
if [ "$(id -u)" -eq 0 ] && command -v runuser >/dev/null 2>&1; then
    chmod a+rx "$TMP"
    chmod -R a+rwX "$TMP/proj"
    touch -d '2030-01-01 UTC' src/kept.ts
    chmod 000 src/kept.ts
    runuser -u nobody -- "$CG" sync >/dev/null 2>&1 || fail 'sync after read failure'
    row="$(q "SELECT status,reason,last_success_hash,extraction_version IS NULL FROM extraction_health WHERE path='src/kept.ts'")"
    [ "$row" = "failed|read_error|$hash|1" ] || fail "failed-read health: $row"
    [ "$(q "SELECT count(*) FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='src/kept.ts' AND s.name='kept'")" -eq 1 ] || fail 'facts lost after read failure'
    chmod 644 src/kept.ts
    "$CG" sync >/dev/null
    [ "$(q "SELECT status FROM extraction_health WHERE path='src/kept.ts'")" = complete ] || fail 'failed-read retry'
fi

# A readable file that turns non-source removes obsolete graph facts while
# retaining the hash of its last successful structural extraction.
printf '\000binary' > src/kept.ts
"$CG" sync >/dev/null
[ "$(q "SELECT status,reason,last_success_hash FROM extraction_health WHERE path='src/kept.ts'")" = "skipped|binary_file|$hash" ] || fail 'binary transition health'
[ "$(q "SELECT count(*) FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='src/kept.ts'")" -eq 0 ] || fail 'obsolete facts after binary transition'

echo 'index health: ok'
