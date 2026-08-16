#!/usr/bin/env bash
# agent memory: remember/recall/forget + spec workflow integration
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/specrepo" "$TMP/repo"
cd "$TMP/repo"

# memory lives in graph.db — no project, no memory
expect_rc 1 "$CG" recall
"$CG" init >/dev/null

# ---- remember / recall / forget round trip ----
out="$("$CG" remember "Chose trigram FTS for symbol search" --type decision)"
has "$out" "remembered #1 [decision]"
out="$("$CG" remember "Never store secrets in memory" --type constraint)"
has "$out" "#2"

out="$("$CG" recall trigram)"
has "$out" "#1"
has "$out" "[decision]"
has "$out" "Chose trigram FTS"
hasnt "$out" "secrets"

out="$("$CG" recall)"              # no query -> recency, newest first
has "$out" "#2"
has "$out" "#1"

out="$("$CG" recall --type constraint)"
has "$out" "secrets"
hasnt "$out" "trigram"

"$CG" recall trigram --json | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['count'] == 1, d
m = d['memories'][0]
assert m['id'] == 1 and m['type'] == 'decision', m
assert 'trigram' in m['body'], m
assert m['task'] is None and m['source'] == 'manual', m
assert m['created'] > 0, m
"

out="$("$CG" forget 2)"
has "$out" "forgot #2"
expect_rc 1 "$CG" forget 99
out="$("$CG" recall)"
hasnt "$out" "secrets"

# ---- a memory written mid-task attributes itself to the task ----
"$CG" spec start 1.2 >/dev/null
out="$("$CG" remember "Renderer must stay byte-stable")"
has "$out" "(task demo/1.2)"
out="$("$CG" recall --task demo/1.2)"
has "$out" "byte-stable"

# ---- spec done auto-records an outcome memory ----
touch verify.marker
"$CG" spec done 1.2 >/dev/null
out="$("$CG" recall --task demo/1.2 --type outcome)"
has "$out" "done: Render the mirror"
has "$out" "auto"

# ---- title-matched memories surface on `spec next` ----
"$CG" remember "Check mode must exit 2 on stale output" --type constraint >/dev/null
out="$("$CG" spec next)"
has "$out" "task 2.1"
has "$out" "memories:"
has "$out" "exit 2 on stale"
"$CG" spec next --json | python3 -c "
import json, sys
d = json.load(sys.stdin)
assert d['next']['id'] == '2.1', d
assert any('exit 2 on stale' in m['body'] for m in d['memories']), d
"

# ---- a refused done records an honest blocked outcome ----
"$CG" spec start 2.1 >/dev/null
rc=0; "$CG" spec done 2.1 >/dev/null 2>&1 || rc=$?
[ "$rc" -eq 1 ] || fail "done 2.1 should refuse (rc=$rc)"
out="$("$CG" recall --task demo/2.1 --type outcome)"
has "$out" "blocked: Check mode"
has "$out" "graph check"

# task-linked memories surface on `spec start`
out="$("$CG" spec start 2.1)"
has "$out" "memories:"
has "$out" "blocked: Check mode"

# ---- complete the task; done outcome + trace memories ----
mkdir -p src
cat > src/check.ts <<'EOF'
export function checkMode(stale: number): number {
  return stale > 0 ? 2 : 0;
}
EOF
"$CG" commit -m "implement check" >/dev/null
"$CG" spec done 2.1 >/dev/null
out="$("$CG" recall --task demo/2.1 --type outcome)"
has "$out" "done: Check mode"

out="$("$CG" spec trace 2.1)"
has "$out" "memories:"
has "$out" "done: Check mode"
"$CG" spec trace 2.1 --json | python3 -c "
import json, sys
t = json.load(sys.stdin)['task']
mems = t['memories']
assert any(m['type'] == 'outcome' and 'done: Check mode' in m['body']
           for m in mems), mems
assert any('blocked: Check mode' in m['body'] for m in mems), mems
assert all(m['task'] == 'demo/2.1' for m in mems), mems
"

echo ok
