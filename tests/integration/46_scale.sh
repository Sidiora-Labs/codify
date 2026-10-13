#!/usr/bin/env bash
# The index at scale (codify-v15 req 3). Always: a generated 2000-file
# project indexes; the parallel walk lists exactly the files a one-thread
# walk lists; a unique literal is a candidate in under 5% of the files; a
# one-file edit rewrites only that file's rows; --json carries the phase
# times, the peak RSS and the walk taken; [index] walk = git finds added,
# modified, deleted, renamed, committed and reverted files without walking;
# cg info names the body index mode. CG_SCALE=1 adds the default profile
# (20000 files, about 2M lines) and prints its throughput, sizes and
# latencies, asserting peak RSS < 2 GB and the database < 6x the source.
. "$(dirname "$0")/../lib.sh"

GEN="$(cd "$(dirname "$0")/../scale" && pwd)/gen.py"
command -v sqlite3 >/dev/null || { echo "46_scale: SKIP (no sqlite3 CLI)"; exit 0; }

json_get() {   # json_get '<json>' 'python expression over d'
    python3 -c 'import json,sys; d=json.loads(sys.argv[1]); print(eval(sys.argv[2]))' "$1" "$2"
}
q() { sqlite3 .codegraph/graph.db "$1"; }
commit() { git add -A && git -c user.email=t@t -c user.name=t commit -qm "$1"; }
tree_files() {   # the files a walk must see, sorted like the graph
    find . \( -path ./.git -o -path ./.codegraph \) -prune -o -type f -print |
        sed 's|^\./||' | LC_ALL=C sort
}

# ---- 1. the small profile: init, and the walk's list at 1 and N threads
python3 "$GEN" "$TMP/s" --files 2000 --lines 200000 >"$TMP/gen.out"
has "$(cat "$TMP/gen.out")" "2000 files"
cd "$TMP/s"
git init -q . && commit init
CG_WALK_THREADS=1 "$CG" init >"$TMP/out" 2>&1 || fail "init: $(cat "$TMP/out")"
has "$(cat "$TMP/out")" "initialized"
q "SELECT path FROM files ORDER BY path" | LC_ALL=C sort >"$TMP/one"
tree_files >"$TMP/tree"
cmp -s "$TMP/one" "$TMP/tree" || fail "one-thread walk differs from the tree:
$(diff "$TMP/one" "$TMP/tree" | head -5)"
rm -rf .codegraph
CG_WALK_THREADS=8 "$CG" init >/dev/null 2>&1 || fail "init with 8 walk threads"
q "SELECT path FROM files ORDER BY path" | LC_ALL=C sort >"$TMP/many"
cmp -s "$TMP/one" "$TMP/many" || fail "the parallel walk lists other files:
$(diff "$TMP/one" "$TMP/many" | head -5)"
nfiles="$(wc -l <"$TMP/tree" | tr -d ' ')"
# the ignore rules hold in the parallel walk
mkdir -p vendor/x && echo 'int ignored_fn(void){return 0;}' > vendor/x/skip.c
printf 'vendor/\n' > .cgignore
d="$(CG_WALK_THREADS=8 "$CG" sync --json)"
[ "$(q "SELECT count(*) FROM files WHERE path LIKE 'vendor/%'")" = 0 ] \
    || fail "an ignored directory was indexed"
rm -rf vendor .cgignore
"$CG" sync >/dev/null

# ---- 2. the body index narrows a literal to its file
mode="$(json_get "$("$CG" info --json)" 'd["fts_mode"]')"
case "$mode" in contentless|content) : ;; *) fail "fts_mode: $mode" ;; esac
sqlv="$(json_get "$("$CG" info --json)" 'd["sqlite"]')"
if python3 -c 'import sys; a=[int(x) for x in sys.argv[1].split(".")]; sys.exit(0 if a>=[3,43,0] else 1)' "$sqlv"; then
    [ "$mode" = contentless ] || fail "SQLite $sqlv supports contentless_delete: $mode"
    has "$("$CG" info)" "body index: contentless"
fi
cands="$(q "SELECT count(*) FROM body_fts WHERE body_fts MATCH '\"scale_marker_123\"'")"
[ "$cands" -ge 1 ] || fail "the marker is in no candidate"
[ $((cands * 100)) -lt $((nfiles * 5)) ] || fail "$cands of $nfiles files are candidates"
if "$CG" help 2>&1 | grep -q '^  grep '; then
    out="$("$CG" grep scale_marker_123 2>&1)" || fail "cg grep: $out"
    has "$out" "scale_marker_123"
else
    echo "46_scale: cg grep not in this build — candidate check ran on body_fts only"
fi
# search still finds body text, its excerpt read from disk when contentless
out="$("$CG" context scale_marker_123 --json 2>/dev/null || true)"
has "$out" "scale_marker_123"

# ---- 3. a one-file edit rewrites that file's rows and no other
target="$(q "SELECT path FROM files WHERE path LIKE '%.go' ORDER BY path LIMIT 1")"
snap() {
    q "SELECT f.id, f.path, f.hash FROM files f WHERE f.path<>'$target' ORDER BY f.id"
    q "SELECT s.id, s.file_id, s.name, s.line FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path<>'$target' ORDER BY s.id"
    q "SELECT c.id, c.file_id, c.line FROM comments c JOIN files f ON f.id=c.file_id WHERE f.path<>'$target' ORDER BY c.id"
}
snap >"$TMP/before"
tsyms="$(q "SELECT group_concat(id) FROM symbols s WHERE file_id=(SELECT id FROM files WHERE path='$target')")"
printf '\nfunc ScaleEditedOnce() int { return 1 }\n' >> "$target"
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["indexed"]')" = 1 ] || fail "one edit, one file indexed: $d"
snap >"$TMP/after"
cmp -s "$TMP/before" "$TMP/after" || fail "rows outside $target changed:
$(diff "$TMP/before" "$TMP/after" | head -5)"
[ "$(q "SELECT count(*) FROM symbols WHERE name='ScaleEditedOnce'")" = 1 ] \
    || fail "the edit's symbol is missing"
[ -n "$tsyms" ] || fail "target had no symbols"

# ---- 4. --json: phases, peak RSS, the walk
d="$("$CG" index --full --json)"
for k in walk parse write resolve soft; do
    [ "$(json_get "$d" "d['phase_ms']['$k'] >= 0")" = True ] || fail "phase $k: $d"
done
[ "$(json_get "$d" 'd["peak_rss_kb"] > 0')" = True ] || fail "peak_rss_kb: $d"
[ "$(json_get "$d" 'd["walk"]')" = full ] || fail "index --full walks: $d"
[ "$(json_get "$d" 'd["indexed"]')" = "$nfiles" ] || fail "--full reparses all: $d"
# the summary line is the one it always was
out="$("$CG" index)"
[ "$(printf '%s\n' "$out" | wc -l)" -eq 1 ] || fail "index printed more than its summary"
has "$out" "indexed 0 files ($nfiles unchanged"
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["walk"]')" = full ] || fail "auto under the threshold walks: $d"

# ---- 5. [index] walk = git: candidates from status and the commits since
printf '[index]\nwalk = git\n' > codify.kvx
commit "config"
d="$("$CG" sync --json)"         # records the head this graph matches
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["walk"]')" = git ] || fail "walk = git asks git: $d"
[ "$(json_get "$d" 'd["indexed"]')" = 0 ] || fail "nothing changed: $d"
[ "$(json_get "$d" 'd["seen"]')" = "$(q "SELECT count(*) FROM files")" ] \
    || fail "a git pass counts the tree: $d"
in_graph() { [ "$(q "SELECT count(*) FROM files WHERE path='$1'")" = 1 ]; }
gofile() { q "SELECT path FROM files WHERE path LIKE '%.go' ORDER BY path LIMIT 1 OFFSET $1"; }
mod="$(gofile 1)"; del="$(gofile 2)"; ren="$(gofile 3)"
printf '\nfunc ScaleGitModified() int { return 2 }\n' >> "$mod"
rm "$del"
git mv "$ren" "${ren%.go}_moved.go"
printf 'package added\n\nfunc ScaleGitAdded() int { return 3 }\n' > g00/added_new.go
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["walk"]')" = git ] || fail "git pass: $d"
[ "$(q "SELECT count(*) FROM symbols WHERE name='ScaleGitModified'")" = 1 ] || fail "modified file missed"
[ "$(q "SELECT count(*) FROM symbols WHERE name='ScaleGitAdded'")" = 1 ] || fail "untracked file missed"
in_graph "$del" && fail "deleted file still indexed"
in_graph "$ren" && fail "renamed-from path still indexed"
in_graph "${ren%.go}_moved.go" || fail "renamed-to path missing"
# the same dirty files at the next pass: candidates again, rewritten never
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["walk"]')" = git ] || fail "second git pass: $d"
[ "$(json_get "$d" 'd["indexed"]')" = 0 ] || fail "unchanged dirty files rewritten: $d"
# committed between passes: the diff since the recorded head names it
commit "edits"
cmt="$(gofile 5)"
printf '\nfunc ScaleGitCommitted() int { return 4 }\n' >> "$cmt"
commit "one more"
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["walk"]')" = git ] || fail "git pass after commit: $d"
[ "$(q "SELECT count(*) FROM symbols WHERE name='ScaleGitCommitted'")" = 1 ] || fail "committed edit missed"
# dirty at one pass, reverted before the next: in neither of git's lists
rev="$(gofile 6)"
printf '\nfunc ScaleGitReverted() int { return 5 }\n' >> "$rev"
"$CG" sync >/dev/null
[ "$(q "SELECT count(*) FROM symbols WHERE name='ScaleGitReverted'")" = 1 ] || fail "dirty edit missed"
git checkout -q -- "$rev"
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["walk"]')" = git ] || fail "git pass after revert: $d"
[ "$(q "SELECT count(*) FROM symbols WHERE name='ScaleGitReverted'")" = 0 ] || fail "reverted edit kept"
# an ignore file changed: git cannot say what it hides, so the tree is walked
mkdir -p g00/hidden && printf 'int hidden_fn(void){return 0;}\n' > g00/hidden/h.c
"$CG" sync >/dev/null
in_graph g00/hidden/h.c || fail "untracked file in a new directory missed"
printf 'hidden/\n' > g00/.gitignore
d="$("$CG" sync --json)"
[ "$(json_get "$d" 'd["walk"]')" = full ] || fail "an ignore-file change walks: $d"
in_graph g00/hidden/h.c && fail "newly ignored file kept"
# --full always walks
d="$("$CG" index --full --json)"
[ "$(json_get "$d" 'd["walk"]')" = full ] || fail "--full walks under walk = git: $d"
# every twentieth pass walks the whole tree
walks=0
for i in $(seq 1 20); do
    d="$("$CG" sync --json)"
    [ "$(json_get "$d" 'd["walk"]')" = full ] && walks=$((walks + 1))
done
[ "$walks" -ge 1 ] || fail "no full walk in 20 git-mode passes"
# the graph still matches the tree after all of it
q "SELECT path FROM files ORDER BY path" | LC_ALL=C sort >"$TMP/g"
tree_files | grep -v '^g00/hidden/' | grep -v '^codify.kvx$' >"$TMP/t" || true
q "SELECT path FROM files WHERE path='codify.kvx'" >/dev/null
grep -v '^codify.kvx$' "$TMP/g" >"$TMP/g2" || true
cmp -s "$TMP/g2" "$TMP/t" || fail "graph and tree differ after git passes:
$(diff "$TMP/g2" "$TMP/t" | head -5)"

# ---- 6. a v17 graph (no files.base, body_fts with content) upgrades
q "DROP INDEX idx_file_base; ALTER TABLE files DROP COLUMN base;
   UPDATE meta SET value='17' WHERE key='schema_version';
   DELETE FROM meta WHERE key='fts_mode'"
err="$("$CG" sync --json 2>&1 >"$TMP/out")" || fail "v17 upgrade: $err"
has "$err" "schema upgraded to v18"
[ "$(q "SELECT count(*) FROM files WHERE base IS NULL")" = 0 ] || fail "base not filled"
[ "$(q "SELECT value FROM meta WHERE key='fts_mode'")" = "$mode" ] || fail "fts_mode not recorded"

# ---- 7. CG_SCALE=1: the default profile, measured
if [ "${CG_SCALE:-0}" = 1 ]; then
    python3 "$GEN" "$TMP/big" >"$TMP/gen.out"
    read -r files _ lines _ bytes _ <"$TMP/gen.out"
    cd "$TMP/big"
    git init -q . && commit init
    t0="$(date +%s%N)"
    "$CG" init >/dev/null 2>&1 || fail "scale init"
    t1="$(date +%s%N)"
    ms=$(( (t1 - t0) / 1000000 ))
    d="$("$CG" index --full --json)"
    rss="$(json_get "$d" 'd["peak_rss_kb"]')"
    db="$(stat -c %s .codegraph/graph.db)"
    g0="$(date +%s%N)"
    if "$CG" help 2>&1 | grep -q '^  grep '; then
        "$CG" grep scale_marker_12345 >/dev/null; gw=grep
    else
        "$CG" search scale_marker_12345 >/dev/null; gw=search
    fi
    g1="$(date +%s%N)"
    echo "46_scale: $files files, $lines lines, $bytes bytes"
    echo "46_scale: init ${ms}ms — $((files * 1000 / (ms + 1))) files/s, $((lines * 1000 / (ms + 1))) lines/s"
    echo "46_scale: db $db bytes — $(python3 -c "print(round($db/$bytes,2))") bytes per source byte"
    echo "46_scale: $gw latency $(( (g1 - g0) / 1000000 ))ms; peak RSS ${rss} KB (full reindex)"
    echo "46_scale: phases $(json_get "$d" 'd["phase_ms"]')"
    [ "$rss" -lt $((2 * 1024 * 1024)) ] || fail "peak RSS ${rss} KB >= 2 GB"
    [ "$db" -lt $((bytes * 6)) ] || fail "database $db >= 6x source $bytes"
fi

echo "46_scale ok"
