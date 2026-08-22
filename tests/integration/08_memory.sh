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

# ---- Prod mode records implementation without a qualification claim ----
cp -r "$FIXTURES/specrepo" "$TMP/prod-memory"
cd "$TMP/prod-memory"
"$CG" init >/dev/null
"$CG" spec mode prod >/dev/null
"$CG" spec start 1.2 >/dev/null
"$CG" spec implemented 1.2 >/dev/null
out="$("$CG" recall --task demo/1.2 --type outcome)"
has "$out" "implemented: Render the mirror - qualification pending"
has "$out" "auto"
hasnt "$out" "done: Render the mirror"
"$CG" recall --task demo/1.2 --type outcome --json | python3 -c '
import json, sys
d = json.load(sys.stdin)
assert d["count"] == 1, d
m = d["memories"][0]
assert m["body"] == "implemented: Render the mirror - qualification pending", m
assert m["task"] == "demo/1.2" and m["source"] == "auto", m
'
out="$("$CG" remember "Qualification remains human-owned")"
hasnt "$out" "task demo/1.2"

echo ok

# ---- superseding a decision keeps it readable but stops it leading
cd "$TMP/proj" 2>/dev/null || cd "$TMP"/*/ 2>/dev/null || true
"$CG" remember "sessions expire after 1 hour" --type decision >/dev/null
old_id="$("$CG" recall "sessions expire" --json | python3 -c "
import json,sys
print(json.load(sys.stdin)['memories'][0]['id'])")"
"$CG" remember "sessions expire after 24 hours" --type decision \
      --supersedes "$old_id" >/dev/null
out="$("$CG" recall "sessions expire" --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
bodies = [m['body'] for m in d['memories']]
assert '24 hours' in bodies[0], ('superseded memory still leads', bodies)
assert any('1 hour' in b for b in bodies), ('history was deleted', bodies)
"

# ---- recall --near finds memories anchored to a file
"$CG" remember "this file owns ignore rules" --type fact --files src/util.ts >/dev/null
out="$("$CG" recall --near src/util.ts)"
has "$out" "owns ignore rules"

# ---- compact removes exact repeats and reports honestly
"$CG" remember "duplicated note" --type fact >/dev/null
"$CG" remember "duplicated note" --type fact >/dev/null
out="$("$CG" memory compact --dry-run)"
has "$out" "1 duplicate"
out="$("$CG" memory compact --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['removed'] >= 1, d
"
out="$("$CG" memory compact)"
has "$out" "removed 0 duplicate"

echo "08_memory maturity ok"

# ---- repeated spec outcomes collapse instead of piling up identical rows
before="$("$CG" recall --json -n 200 | python3 -c "
import json,sys; print(len(json.load(sys.stdin)['memories']))")"
"$CG" spec start 1.2 >/dev/null 2>&1 || true
"$CG" spec done 1.2 >/dev/null 2>&1 || true
"$CG" spec start 1.2 --force >/dev/null 2>&1 || true
"$CG" spec done 1.2 >/dev/null 2>&1 || true
after="$("$CG" recall --json -n 200 | python3 -c "
import json,sys; print(len(json.load(sys.stdin)['memories']))")"
[ "$after" -le "$((before + 1))" ] \
    || fail "repeated spec outcomes piled up: $before -> $after"

echo "08_memory dedup ok"
