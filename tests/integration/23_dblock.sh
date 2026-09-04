#!/usr/bin/env bash
# Database lock behaviour: an agent's status update must survive another cg
# process (the editor's cg lsp, cg watch, a parallel agent) holding the write
# lock — wait it out when the hold is short, and fail with an actionable,
# retryable message (exit 75, nothing changed) when it is not. The LSP itself
# must keep answering from the last index instead of dying or blocking.
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null
"$CG" spec new lock >/dev/null
"$CG" spec add 1.2 --title "Second" --wave 1 >/dev/null 2>&1 || true
"$CG" sync >/dev/null

DB="$TMP/proj/.codegraph/graph.db"

# hold_lock <seconds> — take the WAL write lock from another process, the way a
# long index transaction in cg lsp would, and release it after <seconds>.
hold_lock() {
    python3 - "$DB" "$1" <<'PY' &
import sqlite3, sys, time
c = sqlite3.connect(sys.argv[1], isolation_level=None, timeout=30)
c.execute("BEGIN IMMEDIATE")
c.execute("UPDATE meta SET value=value WHERE key='schema_version'")
print("held", flush=True)
time.sleep(float(sys.argv[2]))
c.execute("COMMIT")
PY
    sleep 0.5
}

# 1. A short hold is waited out: the claim (a lease write) lands, and the
#    status update it carries surfaces no lock error to the agent.
hold_lock 2
out="$("$CG" spec claim 1.1 --agent alpha 2>&1)"
wait
hasnt "$out" "locked"
hasnt "$out" "busy"
has "$("$CG" spec status --json)" '"claims":[{"id":"1.1","agent":"alpha"'
"$CG" spec start 1.1 >/dev/null
out="$("$CG" spec done 1.1 2>&1)"
hasnt "$out" "locked"
hasnt "$out" "busy"
st="$("$CG" spec status --json)"
has "$st" '"done":1'
hasnt "$st" '"agent":"alpha"'

# 2. A hold longer than the configured wait fails cleanly: exit 75, a message
#    that says what to do, and no partial change (no lease, status untouched).
hold_lock 4
rc=0
out="$(CG_BUSY_TIMEOUT_MS=200 "$CG" spec claim 1.2 --agent beta 2>&1)" || rc=$?
[ "$rc" -eq 75 ] || fail "expected exit 75 under a held lock, got $rc: $out"
has "$out" "database is busy"
has "$out" "safe to retry"
has "$out" "CG_BUSY_TIMEOUT_MS"
wait
hasnt "$("$CG" spec status --json)" '"agent":"beta"'
# ...and the same command simply works once the lock is gone
out="$("$CG" spec claim 1.2 --agent beta 2>&1)"
hasnt "$out" "busy"
has "$("$CG" spec status --json)" '"agent":"beta"'

# 3. cg sync under a held lock reports busy with the same exit code and leaves
#    the graph intact for readers.
hold_lock 4
rc=0
out="$(CG_BUSY_TIMEOUT_MS=200 "$CG" sync 2>&1)" || rc=$?
[ "$rc" -eq 75 ] || fail "expected exit 75 from sync under lock, got $rc: $out"
has "$out" "safe to retry"
has "$("$CG" symbol formatName 2>&1)" "formatName"
wait

# 4. The LSP keeps serving while another process holds the lock: it answers
#    hover from the last index, logs one deferral line, and exits cleanly.
hold_lock 6
python3 - "$CG" "$TMP/proj" <<'PY'
import json, subprocess, sys
cg, root = sys.argv[1], sys.argv[2]
def frame(o):
    b = json.dumps(o).encode()
    return b"Content-Length: %d\r\n\r\n" % len(b) + b
uri = "file://%s/src/util.ts" % root
src = open("%s/src/util.ts" % root).read().splitlines()
line = next(i for i, l in enumerate(src) if "formatName" in l)
char = src[line].index("formatName") + 2
msgs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"capabilities": {}}},
    {"jsonrpc": "2.0", "method": "initialized", "params": {}},
    {"jsonrpc": "2.0", "method": "textDocument/didOpen",
     "params": {"textDocument": {"uri": uri, "languageId": "typescript",
                                 "version": 1, "text": ""}}},
    {"jsonrpc": "2.0", "id": 2, "method": "textDocument/hover",
     "params": {"textDocument": {"uri": uri},
                "position": {"line": line, "character": char}}},
    {"jsonrpc": "2.0", "id": 3, "method": "shutdown"},
    {"jsonrpc": "2.0", "method": "exit"},
]
p = subprocess.run([cg, "lsp"], input=b"".join(frame(m) for m in msgs),
                   capture_output=True, timeout=60, cwd=root)
err = p.stderr.decode()
assert p.returncode == 0, (p.returncode, err[:500])
assert "index deferred" in err, err[:500]
assert err.count("index deferred") == 1, err[:500]
assert b"formatName" in p.stdout, p.stdout[:500]
print("lsp survives held lock")
PY
wait

echo "23_dblock ok"
