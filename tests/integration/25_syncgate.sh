#!/usr/bin/env bash
# The sync gate: one indexer per project, one core budget per machine.
# Sections (first argument): gate | incremental | callers | all (default).
#   gate         — coalescing, dirty notes, freshness window, targeted sync,
#                  worker caps and machine slots
#   incremental  — post-scan resolution scoped to the change: callers of a
#                  rewritten file re-point, a rename unresolves, a new file
#                  satisfies an old import and an old prose mention
#   callers      — the cheap callers: cg hook post-edit, hook templates,
#                  spec/MCP freshness windows, watch and lsp under the gate
. "$(dirname "$0")/../lib.sh"

section="${1:-all}"
want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

json_field() {   # json_field '<json>' key  → value (no quotes)
    python3 -c 'import json,sys; v=json.loads(sys.argv[1])[sys.argv[2]]; print(str(v).lower() if isinstance(v,bool) else v)' "$1" "$2"
}

# hold_gate <seconds> — take the project's index gate from another process
hold_gate() {
    python3 - "$PWD/.codegraph/index.lock" "$1" <<'PY' &
import fcntl, sys, time
f = open(sys.argv[1], "a+")
fcntl.flock(f, fcntl.LOCK_EX)
print("held", flush=True)
time.sleep(float(sys.argv[2]))
fcntl.flock(f, fcntl.LOCK_UN)
PY
    sleep 0.4
}

fresh_project() {
    rm -rf "$TMP/proj"
    cp -r "$FIXTURES/sample" "$TMP/proj"
    cd "$TMP/proj"
    "$CG" init >/dev/null
}

# ---------------------------------------------------------------- gate
if want gate; then
    fresh_project

    # (a) freshness: right after init the graph is fresh inside a window,
    #     and never fresh without one
    out="$("$CG" sync --max-age 60000 --json)"
    [ "$(json_field "$out" fresh)" = true ] || fail "expected fresh inside the window: $out"
    out="$("$CG" sync --json)"
    [ "$(json_field "$out" fresh)" = false ] || fail "a zero window must walk: $out"
    out="$("$CG" sync --max-age 60000)"
    has "$out" "graph is fresh"

    # (b) coalescing: while another process holds the gate, a background
    #     sync leaves a note and returns at once instead of walking
    cat > src/queued.ts <<'EOF'
export function queuedSentinel(): string { return "queued"; }
EOF
    hold_gate 3
    t0=$(date +%s%N)
    out="$("$CG" sync --background --json src/queued.ts)"
    t1=$(date +%s%N)
    [ "$(json_field "$out" coalesced)" = true ] || fail "expected coalesced under a held gate: $out"
    [ $(( (t1 - t0) / 1000000 )) -lt 1500 ] || fail "a coalesced sync must not wait for the holder"
    [ -f .codegraph/index.dirty ] || fail "coalesced sync left no dirty note"
    has "$(cat .codegraph/index.dirty)" "src/queued.ts"
    hasnt "$("$CG" search queuedSentinel 2>&1)" "src/queued.ts"
    # the note also defeats the freshness window
    out="$("$CG" sync --background --max-age 60000 --json)"
    [ "$(json_field "$out" fresh)" = false ] || fail "a dirty note must not look fresh: $out"
    out="$("$CG" sync --background 2>&1)"
    has "$out" "queued"
    wait
    # (c) the next pass drains the note: the queued file lands, note gone
    out="$("$CG" sync --json)"
    [ "$(json_field "$out" indexed)" -ge 1 ] || fail "drain did not index the queued file: $out"
    [ ! -f .codegraph/index.dirty ] || fail "dirty note survived the drain"
    has "$("$CG" search queuedSentinel)" "src/queued.ts"

    # (d) a foreground sync waits for the holder (bounded) and then walks
    cat > src/waited.ts <<'EOF'
export function waitedSentinel(): string { return "waited"; }
EOF
    hold_gate 1
    out="$("$CG" sync --wait 5000 --json)"
    wait
    [ "$(json_field "$out" coalesced)" = false ] || fail "foreground sync should have waited: $out"
    has "$("$CG" search waitedSentinel)" "src/waited.ts"

    # (e) targeted sync: only the named path is stat'd; the rest of the
    #     tree is neither walked nor claimed fresh
    cat > src/targeted.ts <<'EOF'
export function targetedSentinel(): string { return "targeted"; }
EOF
    cat > src/untargeted.ts <<'EOF'
export function untargetedSentinel(): string { return "untargeted"; }
EOF
    out="$("$CG" sync --json src/targeted.ts)"
    [ "$(json_field "$out" targeted)" = true ] || fail "expected targeted: $out"
    [ "$(json_field "$out" seen)" = 1 ] || fail "targeted sync walked more than its path: $out"
    has "$("$CG" search targetedSentinel)" "src/targeted.ts"
    hasnt "$("$CG" search untargetedSentinel 2>&1)" "src/untargeted.ts"
    out="$("$CG" sync --json src/untargeted.ts src/nonexistent.ts)"
    has "$("$CG" search untargetedSentinel)" "src/untargeted.ts"
    # a directory target recurses; a removed file under it is dropped
    rm src/untargeted.ts
    out="$("$CG" sync --json src)"
    [ "$(json_field "$out" removed)" = 1 ] || fail "targeted dir sync missed the removal: $out"
    hasnt "$("$CG" search untargetedSentinel 2>&1)" "src/untargeted.ts"
    # paths outside the project are ignored, not indexed
    out="$("$CG" sync --json /etc/hostname)"
    [ "$(json_field "$out" seen)" = 0 ] || fail "path outside the root was walked: $out"

    # (f) worker caps: CG_INDEX_WORKERS bounds the pool; a background pass
    #     takes at most a quarter of the cores; no free machine slot → 2
    out="$(CG_INDEX_WORKERS=1 "$CG" index --full)"
    has "$out" "[1 workers"
    mkdir -p "$TMP/slots"
    python3 - "$TMP/slots/slot.0" 4 <<'PY' &
import fcntl, sys, time
f = open(sys.argv[1], "a+")
fcntl.flock(f, fcntl.LOCK_EX)
time.sleep(float(sys.argv[2]))
PY
    sleep 0.4
    out="$(CG_SLOT_DIR="$TMP/slots" CG_INDEX_SLOTS=1 "$CG" index --full)"
    has "$out" "[2 workers"
    wait
    out="$(CG_SLOT_DIR="$TMP/slots" CG_INDEX_SLOTS=1 CG_INDEX_WORKERS=3 "$CG" index --full)"
    has "$out" "[3 workers"
    out="$(CG_INDEX_WORKERS=8 "$CG" sync --background --json --wait 5000 src)"
    w="$(json_field "$out" workers)"
    [ "$w" -le 8 ] || fail "background pass exceeded the cap: $out"

    # (g) cg info reports the gate's bookkeeping
    has "$("$CG" info --json)" '"last_index_ms"'
fi

# ---------------------------------------------------------- incremental
if want incremental; then
    fresh_project
    cat > src/alpha.ts <<'EOF'
export function alphaOne(): number { return 1; }
EOF
    cat > src/beta.ts <<'EOF'
import { alphaOne } from './alpha';
import { gammaHelper } from './gamma';

/** Combines alphaOne with gammaHelper for the report. */
export function betaCaller(): number { return alphaOne() + 1; }
EOF
    out="$("$CG" sync --json)"
    has "$("$CG" impact alphaOne -d 1)" "betaCaller"

    db_query() { python3 - "$1" <<'PY'
import sqlite3, sys
db = sqlite3.connect(".codegraph/graph.db")
for row in db.execute(sys.argv[1]):
    print("|".join("" if v is None else str(v) for v in row))
PY
    }

    # (a) rewriting the callee's file gives its symbols new rowids; the
    #     caller in the untouched file must re-point — and the pass that did
    #     it was scoped, not a rebuild
    sleep 1
    cat > src/alpha.ts <<'EOF'
export function alphaZero(): number { return 0; }
export function alphaOne(): number { return alphaZero() + 1; }
EOF
    out="$("$CG" sync --json)"
    [ "$(json_field "$out" scoped)" = true ] || fail "expected a scoped resolution: $out"
    [ "$(json_field "$out" indexed)" = 1 ] || fail "expected one file reindexed: $out"
    has "$("$CG" impact alphaOne -d 1)" "betaCaller"
    has "$(db_query "SELECT r.name, r.verdict FROM refs r JOIN files f ON f.id=r.file_id WHERE f.path='src/beta.ts' AND r.name='alphaOne'")" "alphaOne|internal"
    dangling="$(db_query "SELECT count(*) FROM refs WHERE target_id IS NOT NULL AND target_id NOT IN (SELECT id FROM symbols)")"
    [ "$dangling" = 0 ] || fail "dangling ref targets after a scoped pass: $dangling"

    # (b) renaming the callee in its own file unresolves the caller's ref
    #     without touching the caller's file
    sleep 1
    cat > src/alpha.ts <<'EOF'
export function alphaZero(): number { return 0; }
export function alphaTwo(): number { return alphaZero() + 2; }
EOF
    out="$("$CG" sync --json)"
    [ "$(json_field "$out" scoped)" = true ] || fail "expected a scoped resolution: $out"
    has "$(db_query "SELECT r.name, r.verdict FROM refs r JOIN files f ON f.id=r.file_id WHERE f.path='src/beta.ts' AND r.name='alphaOne'")" "alphaOne|unknown"
    hasnt "$("$CG" symbol alphaOne 2>&1)" "src/alpha.ts"
    has "$("$CG" symbol alphaTwo)" "src/alpha.ts"

    # (c) a new file satisfies an old unresolved import and an old prose
    #     mention in a file that did not change
    has "$(db_query "SELECT module, coalesce(origin,'') FROM imports WHERE module='./gamma'")" "./gamma|unknown"
    cat > src/gamma.ts <<'EOF'
export function gammaHelper(): number { return 3; }
EOF
    out="$("$CG" sync --json)"
    [ "$(json_field "$out" scoped)" = true ] || fail "expected a scoped resolution: $out"
    has "$(db_query "SELECT module, coalesce(origin,'') FROM imports WHERE module='./gamma'")" "./gamma|repo"
    has "$("$CG" impact gammaHelper -d 1)" "betaCaller (soft)"

    # (d) removing the file drops the soft edge and the import target again
    rm src/gamma.ts
    out="$("$CG" sync --json)"
    [ "$(json_field "$out" removed)" = 1 ] || fail "expected one removal: $out"
    [ "$(db_query "SELECT count(*) FROM refs WHERE kind='soft' AND name='gammaHelper'")" = 0 ] || fail "soft edge outlived its target"
    has "$(db_query "SELECT module, coalesce(origin,'') FROM imports WHERE module='./gamma'")" "./gamma|unknown"

    # (e) resolution counters stay truthful after scoped passes: the meta
    #     totals equal what the table holds
    meta_int="$(db_query "SELECT value FROM meta WHERE key='resolve_internal'")"
    tbl_int="$(db_query "SELECT count(*) FROM refs WHERE kind='call' AND verdict='internal'")"
    [ "$meta_int" = "$tbl_int" ] || fail "resolve_internal meta $meta_int != table $tbl_int"

    # (f) --full still rebuilds globally and agrees with the scoped result
    before="$(db_query "SELECT count(*) FROM refs WHERE kind='soft'")"
    out="$("$CG" index --full 2>&1)"
    hasnt "$out" "drained"
    after="$(db_query "SELECT count(*) FROM refs WHERE kind='soft'")"
    [ "$before" = "$after" ] || fail "scoped soft edges $before != full rebuild $after"
    has "$("$CG" impact alphaZero -d 1)" "alphaTwo"
fi

# -------------------------------------------------------------- callers
if want callers; then
    fresh_project
    git init -q . 2>/dev/null || true

    # (a) cg hook post-edit: one process reads the Claude Code hook payload,
    #     syncs the edited path, and guards it
    cat > src/hooked.ts <<'EOF'
export function hookedSentinel(): string { return "hooked"; }
EOF
    payload='{"session_id":"s1","hook_event_name":"PostToolUse","tool_name":"Edit","tool_input":{"file_path":"'"$PWD"'/src/hooked.ts","old_string":"","new_string":"x"}}'
    out="$(printf '%s' "$payload" | "$CG" hook post-edit 2>&1)"
    has "$("$CG" search hookedSentinel)" "src/hooked.ts"
    # a payload without a path degrades to a background sync, never an error
    out="$(printf '{"tool_name":"Bash"}' | "$CG" hook post-edit 2>&1)" || fail "post-edit failed on a pathless payload: $out"
    # the installed Claude template uses it once, not sync+guard twice
    "$CG" hook install >/dev/null 2>&1 || true
    has "$(cat .claude/settings.json)" "hook post-edit"
    hasnt "$(cat .claude/settings.json)" '"cg sync"'
    n="$(grep -o 'hook post-edit' .claude/settings.json | wc -l)"
    [ "$n" -ge 1 ] || fail "hook template missing post-edit"

    # (b) a git post-commit hook syncs in the background
    has "$(cat .git/hooks/post-commit)" "sync --background"

    # (c) spec commands reuse a fresh graph instead of walking every time
    "$CG" spec new gatespec >/dev/null
    out="$("$CG" spec status --json)"
    has "$out" '"feature":"gatespec"'

    # (d) a polled report never touches the gate: trace --no-sync answers
    #     from the last index while a plain trace joins the pass in flight
    hold_gate 4
    sleep 0.5
    err="$("$CG" spec trace --no-sync 2>&1 >/dev/null)"
    hasnt "$err" "indexing"
    err="$(CG_BUSY_TIMEOUT_MS=300 "$CG" spec trace 2>&1 >/dev/null)"
    has "$err" "another cg process is indexing"
    wait
fi

echo "ok: 25_syncgate ($section)"
