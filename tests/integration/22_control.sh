#!/usr/bin/env bash
# Agent control-plane invariants. Modes let spec tasks qualify their own slice
# while the no-argument run remains a complete integration test.
. "$(dirname "$0")/../lib.sh"

mode="${1:-all}"
case "$mode" in
  all|state|liveness) ;;
  *) fail "unknown 22_control mode: $mode" ;;
esac

run_state() {
mkdir -p "$TMP/state/src" "$TMP/state/lib"
cd "$TMP/state"
echo 'export function alpha(){}' > src/a.ts
echo 'export function beta(){}' > lib/b.ts

"$CG" spec new control >/dev/null
"$CG" spec start 1.1 >/dev/null
"$CG" spec done 1.1 >/dev/null
"$CG" spec mode parallel >/dev/null
"$CG" spec add 2.1 --title "Alpha" --wave 1 --touches 'src/*.ts' \
      --reqs 1.1 >/dev/null
"$CG" spec add 2.2 --title "Beta" --wave 1 --touches 'lib/*.ts' \
      --reqs 1.1 >/dev/null
"$CG" init >/dev/null

# A declaration without a live owned attempt is diagnostic state, not the
# calling agent's current task. Reconciliation is read-only until --repair.
"$CG" spec start 2.1 >/dev/null
out="$(CG_AGENT=fresh "$CG" spec status --json)"
python3 -c "
import json
d=json.loads(r'''$out''')
assert 'current' not in d, d
assert [x['id'] for x in d['stale']] == ['2.1'], d
assert d['claims'] == [], d
"
out="$("$CG" spec reconcile --json)"
has "$out" '"stale":["2.1"]'
has "$out" '"repaired":0'
out="$("$CG" spec status --json)"
has "$out" '"in_progress":1'
out="$("$CG" spec reconcile --repair --json)"
has "$out" '"repaired":1'
out="$("$CG" spec status --json)"
has "$out" '"in_progress":0'

# Claims create a portable live attempt identity. Only its owner sees current.
claim="$("$CG" spec claim-next --agent a1 --host host-a \
         --session session-a --json)"
attempt="$(printf '%s' "$claim" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["lease"]["attempt_id"])')"
fence="$(printf '%s' "$claim" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["lease"]["fence"])')"
[ -n "$attempt" ] || fail "claim returned no attempt id"
[ "$fence" -gt 0 ] || fail "claim returned no positive fence"
out="$(CG_AGENT=a1 "$CG" spec status --json)"
has "$out" '"current":{"id":"2.1"'
has "$out" '"host":"host-a"'
has "$out" '"session":"session-a"'
out="$(CG_AGENT=fresh "$CG" spec status --json)"
hasnt "$out" '"current":'

out="$("$CG" spec heartbeat 2.1 --agent a1 --attempt "$attempt" \
        --fence "$fence" --ttl 45 --json)"
has "$out" '"heartbeat":'
has "$out" '"expires_in_min":45'

# Releasing and reclaiming advances the fence. The replaced worker cannot
# renew its old generation even when it still knows the task and owner name.
"$CG" spec release 2.1 --agent a1 >/dev/null
claim2="$("$CG" spec claim 2.1 --agent a2 --json)"
attempt2="$(printf '%s' "$claim2" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["attempt_id"])')"
fence2="$(printf '%s' "$claim2" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["fence"])')"
[ "$fence2" -gt "$fence" ] || fail "attempt fence did not advance"
[ "$attempt2" != "$attempt" ] || fail "attempt id was reused"
expect_rc 1 "$CG" spec heartbeat 2.1 --agent a1 --attempt "$attempt" \
          --fence "$fence"
"$CG" spec heartbeat 2.1 --agent a2 --attempt "$attempt2" \
      --fence "$fence2" >/dev/null

echo "22_control state ok"
}

run_liveness() {
mkdir -p "$TMP/live/src"
cd "$TMP/live"
echo 'export function alpha(){}' > src/a.ts
git init -q

"$CG" spec new live >/dev/null
"$CG" spec start 1.1 >/dev/null
"$CG" spec done 1.1 >/dev/null
"$CG" spec mode parallel >/dev/null
"$CG" spec add 2.1 --title "Owned mutation" --wave 1 \
      --touches 'src/a.ts' --reqs 1.1 >/dev/null
"$CG" init >/dev/null

first="$("$CG" spec claim-next --agent old --json)"
old_attempt="$(printf '%s' "$first" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["lease"]["attempt_id"])')"
old_fence="$(printf '%s' "$first" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["lease"]["fence"])')"
"$CG" spec release 2.1 --agent old --attempt "$old_attempt" \
      --fence "$old_fence" >/dev/null
second="$("$CG" spec claim 2.1 --agent new --json)"
new_attempt="$(printf '%s' "$second" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["attempt_id"])')"
new_fence="$(printf '%s' "$second" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["fence"])')"

rc=0
out="$(CG_AGENT=old CG_TASK=live/2.1 CG_ATTEMPT="$old_attempt" \
       CG_FENCE="$old_fence" \
       "$CG" spec done 2.1 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "stale owner completed a reassigned task"
has "$out" "lifecycle mutation rejected"
out="$(CG_AGENT=new "$CG" spec status --json)"
has "$out" '"current":{"id":"2.1"'
CG_AGENT=new CG_TASK=live/2.1 CG_ATTEMPT="$new_attempt" CG_FENCE="$new_fence" \
    "$CG" spec done 2.1 >/dev/null

# The combined state view labels every authority rather than collapsing a
# clean snapshot into a clean Git tree or a declaration into live ownership.
out="$(CG_AGENT=new "$CG" state --json)"
python3 -c "
import json
d=json.loads(r'''$out''')
assert set(['git','codify_snapshot','spec_declaration','live_runtime',
            'stale_state']) <= set(d), d
assert d['git']['available'] is True, d
assert d['live_runtime']['agent'] == 'new', d
assert d['live_runtime']['owned_attempt'] is None, d
"
text_state="$(CG_AGENT=new "$CG" state)"
has "$text_state" "Git state:"
has "$text_state" "Codify snapshot state:"
has "$text_state" "Spec declaration state:"
has "$text_state" "Live runtime ownership:"
has "$text_state" "Stale state:"
mcp="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | "$CG" mcp)"
has "$mcp" '"name":"state"'

# A long child receives its attempt identity and is renewed by the parent
# before the configured heartbeat cadence elapses.
"$CG" spec add 3.1 --title "Heartbeat" --wave 2 --requires 2.1 \
      --touches 'src/pulse.ts' --reqs 1.1 >/dev/null
cat > "$TMP/pulse-driver.sh" <<EOF
#!/bin/sh
[ -n "\${CG_ATTEMPT:-}" ] || exit 9
[ "\${CG_FENCE:-0}" -gt 0 ] || exit 9
echo \$\$ > "$TMP/pulse.pid"
sleep 4
: > src/pulse.ts
exec "$CG" spec done "\$1"
EOF
chmod +x "$TMP/pulse-driver.sh"
cat >> spec/workflow.kvx <<EOF

[agents]
driver = "custom"
cmd    = "$TMP/pulse-driver.sh \${TASK}"
max    = 1
ttl    = 1
EOF

"$CG" spec run -n 1 --agent-prefix pulse > "$TMP/pulse.log" 2>&1 &
runpid=$!
for _ in $(seq 1 100); do
  [ -f "$TMP/pulse.pid" ] && break
  sleep 0.05
done
[ -f "$TMP/pulse.pid" ] || fail "heartbeat driver never started"
before="$(CG_AGENT=pulse-1 "$CG" state --json)"
before_hb="$(printf '%s' "$before" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["live_runtime"]["owned_attempt"]["heartbeat"])')"
sleep 2
after="$(CG_AGENT=pulse-1 "$CG" state --json)"
after_hb="$(printf '%s' "$after" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["live_runtime"]["owned_attempt"]["heartbeat"])')"
[ "$after_hb" -gt "$before_hb" ] || fail "orchestrator did not renew heartbeat"
run_rc=0
wait "$runpid" || run_rc=$?
pulse_out="$(cat "$TMP/pulse.log")"
[ "$run_rc" -eq 0 ] || fail "heartbeat run exited $run_rc: $pulse_out"
has "$pulse_out" "task 3.1 exit 0 → status done"

echo "22_control liveness ok"
}

case "$mode" in
  state) run_state ;;
  liveness) run_liveness ;;
  all) run_state; run_liveness ;;
esac
