#!/usr/bin/env bash
# Progress for init, index, and sync (req 1): CG_PROGRESS=plain names the
# phases with their counts; a piped run without it prints exactly what it
# printed before progress existed; --json is untouched; implicit and quiet
# syncs never show it; gate and lock waits say what they wait for.
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
unset CG_PROGRESS
nfiles="$(find . -type f | wc -l | tr -d ' ')"
ESC="$(printf '\033')"

# --- 1. cg init under CG_PROGRESS=plain: every step, the walk's count, the
#        parse and write counts, resolve, finishing; stdout is today's.
CG_PROGRESS=plain "$CG" init >"$TMP/out" 2>"$TMP/err"
err="$(cat "$TMP/err")"; out="$(cat "$TMP/out")"
has "$err" "cg: creating the graph directory"
has "$err" "cg: walking the tree"
has "$err" "cg: walking the tree $nfiles files"
has "$err" "cg: parsing files 0/$nfiles"
has "$err" "cg: writing the graph $nfiles/$nfiles"
has "$err" "cg: resolving references"
has "$err" "cg: finishing"
has "$err" "worker"
hasnt "$err" "$ESC"
has "$out" "indexed $nfiles files"
has "$out" "initialized $PWD/.codegraph"
# steps come in order, each named once per pass
order="$(grep -o 'creating the graph directory\|walking the tree\|parsing files\|writing the graph\|resolving references\|finishing' "$TMP/err" | uniq | tr '\n' '|')"
[ "$order" = "creating the graph directory|walking the tree|parsing files|writing the graph|resolving references|finishing|" ] \
    || fail "phases out of order: $order"
[ "$(grep -c 'resolving references' "$TMP/err")" -eq 1 ] || fail "resolve printed twice"

# --- 2. piped, no CG_PROGRESS: stderr stays empty and stdout is the one
#        summary line it always was — no escape codes anywhere.
echo "// touched" >> src/util.ts 2>/dev/null || echo "# touched" >> lib/tasks.py
"$CG" index >"$TMP/out" 2>"$TMP/err"
[ ! -s "$TMP/err" ] || fail "default non-tty index wrote to stderr: $(cat "$TMP/err")"
[ "$(wc -l < "$TMP/out")" -eq 1 ] || fail "index printed more than its summary"
grep -Eq '^indexed [0-9]+ files? \([0-9]+ unchanged, [0-9]+ removed, [0-9]+ skipped(, [0-9]+ reused)?\) in [0-9]+ms — [0-9]+ symbols, [0-9]+ refs, [0-9]+ routes, [0-9]+ comments, [0-9]+ soft \[[0-9]+ workers(, drained)?\]$' "$TMP/out" \
    || fail "index summary changed: $(cat "$TMP/out")"
"$CG" sync >"$TMP/out" 2>"$TMP/err"
[ ! -s "$TMP/err" ] || fail "default non-tty sync wrote to stderr"
grep -Eq '^indexed 0 files \(' "$TMP/out" || fail "sync summary changed: $(cat "$TMP/out")"
cp -r "$FIXTURES/sample" "$TMP/fresh"
( cd "$TMP/fresh" && "$CG" init >"$TMP/out" 2>"$TMP/err" )
[ ! -s "$TMP/err" ] || fail "default non-tty init wrote to stderr"
[ "$(wc -l < "$TMP/out")" -eq 2 ] || fail "init printed more than today: $(cat "$TMP/out")"
grep -q "^initialized $TMP/fresh/.codegraph \[" "$TMP/out" || fail "init line changed"

# CG_PROGRESS=0 silences it even where plain would print
CG_PROGRESS=0 "$CG" index --full >/dev/null 2>"$TMP/err"
[ ! -s "$TMP/err" ] || fail "CG_PROGRESS=0 still printed progress"

# --- 3. --json is unchanged: one JSON object on stdout, nothing on stderr,
#        even when plain progress is asked for.
echo "# again" >> lib/tasks.py
CG_PROGRESS=plain "$CG" sync --json >"$TMP/out" 2>"$TMP/err"
[ ! -s "$TMP/err" ] || fail "sync --json printed progress: $(cat "$TMP/err")"
[ "$(wc -l < "$TMP/out")" -eq 1 ] || fail "sync --json printed more than one line"
grep -Eq '^\{"indexed":1,"removed":0,"seen":[0-9]+,"skipped":0,"reused":0,"ms":[0-9]+,"workers":[0-9]+,"passes":1,"fresh":false,"coalesced":false,"busy":false,"scoped":(true|false),"targeted":false\}$' "$TMP/out" \
    || fail "sync --json changed: $(cat "$TMP/out")"

# --- 4. implicit and quiet syncs never show progress
export CG_PROGRESS=plain
echo "# implicit" >> lib/tasks.py
for args in "sync --auto" "sync --background" "sync --auto --background"; do
    # shellcheck disable=SC2086
    "$CG" $args >/dev/null 2>"$TMP/err" || true
    hasnt "$(cat "$TMP/err")" "cg: walking"
    hasnt "$(cat "$TMP/err")" "cg: parsing"
    echo "# again $args" >> lib/tasks.py
done
# the freshness pass before read commands
for c in brief "review" "agentmd"; do
    "$CG" $c >/dev/null 2>"$TMP/err" || true
    hasnt "$(cat "$TMP/err")" "cg: walking"
    echo "# again $c" >> lib/tasks.py
done
# the post-edit hook
payload='{"session_id":"s1","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"'"$PWD"'/lib/tasks.py","old_string":"","new_string":"x"}}'
printf '%s' "$payload" | "$CG" hook post-edit >/dev/null 2>"$TMP/err" || true
hasnt "$(cat "$TMP/err")" "cg: walking"
# MCP's refresh: a tools call that syncs first
printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
    '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_code","arguments":{"query":"tasks"}}}' \
    | "$CG" mcp >/dev/null 2>"$TMP/err" || true
hasnt "$(cat "$TMP/err")" "cg: walking"
unset CG_PROGRESS

# --- 5. waits are named: another process's index gate, then the write lock
if command -v python3 >/dev/null 2>&1; then
    python3 - "$PWD/.codegraph/index.lock" 1.5 <<'PY' &
import fcntl, sys, time
f = open(sys.argv[1], "a+")
fcntl.flock(f, fcntl.LOCK_EX)
time.sleep(float(sys.argv[2]))
fcntl.flock(f, fcntl.LOCK_UN)
PY
    sleep 0.4
    echo "# gate" >> lib/tasks.py
    rc=0
    CG_PROGRESS=plain "$CG" sync --wait 8000 >"$TMP/out" 2>"$TMP/err" || rc=$?
    wait
    [ "$rc" -eq 0 ] || fail "sync behind the gate failed ($rc)"
    has "$(cat "$TMP/err")" "for another cg process's index pass"
    has "$(cat "$TMP/out")" "indexed 1 file"

    python3 - "$PWD/.codegraph/graph.db" 2.5 <<'PY' &
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=30)
c.execute("BEGIN IMMEDIATE")
c.execute("UPDATE meta SET value=value WHERE key='schema_version'")
time.sleep(float(sys.argv[2]))
c.execute("COMMIT")
PY
    sleep 0.5
    echo "# lock" >> lib/tasks.py
    rc=0
    CG_PROGRESS=plain "$CG" index >"$TMP/out" 2>"$TMP/err" || rc=$?
    wait
    [ "$rc" -eq 0 ] || fail "index behind the write lock failed ($rc): $(cat "$TMP/err")"
    has "$(cat "$TMP/err")" "for the database write lock"
    has "$(cat "$TMP/out")" "indexed 1 file"

    # a hold past the wait still fails exactly as before: exit 75 and the
    # busy message, the progress line gone before it
    python3 - "$PWD/.codegraph/graph.db" 3 <<'PY' &
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=30)
c.execute("BEGIN IMMEDIATE")
c.execute("UPDATE meta SET value=value WHERE key='schema_version'")
time.sleep(float(sys.argv[2]))
c.execute("COMMIT")
PY
    sleep 0.5
    echo "# busy" >> lib/tasks.py
    rc=0
    CG_PROGRESS=plain CG_BUSY_TIMEOUT_MS=600 "$CG" index >"$TMP/out" 2>"$TMP/err" || rc=$?
    wait
    [ "$rc" -eq 75 ] || fail "expected exit 75 under a held lock, got $rc"
    has "$(cat "$TMP/err")" "index stalled"
    has "$(cat "$TMP/err")" "database is busy"
fi

# --- 6. on a terminal: drawn in place, erased before the summary, which
#        is left whole on its own line (a held lock makes the pass outlast
#        the 250 ms first-draw delay)
if command -v script >/dev/null 2>&1 && command -v python3 >/dev/null 2>&1 &&
   script -qc true /dev/null >/dev/null 2>&1; then
    python3 - "$PWD/.codegraph/graph.db" 1.2 <<'PY' &
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=30)
c.execute("BEGIN IMMEDIATE")
c.execute("UPDATE meta SET value=value WHERE key='schema_version'")
time.sleep(float(sys.argv[2]))
c.execute("COMMIT")
PY
    sleep 0.4
    echo "# tty" >> lib/tasks.py
    script -qc "\"$CG\" index" /dev/null >"$TMP/tty" 2>&1 || true
    wait
    tty="$(cat "$TMP/tty")"
    has "$tty" "${ESC}[K"
    has "$tty" "waiting"
    has "$tty" "$(printf '\r')${ESC}[Kindexed 1 file"
    # CG_PROGRESS=0 on a terminal: no escape codes at all
    echo "# tty0" >> lib/tasks.py
    CG_PROGRESS=0 script -qc "\"$CG\" index --full" /dev/null >"$TMP/tty" 2>&1 || true
    hasnt "$(cat "$TMP/tty")" "$ESC"
fi

echo "ok 41_progress"
