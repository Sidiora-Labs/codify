#!/usr/bin/env bash
# Agent control-plane invariants. Modes let spec tasks qualify their own slice
# while the no-argument run remains a complete integration test.
. "$(dirname "$0")/../lib.sh"

mode="${1:-all}"
case "$mode" in
  all|state) ;;
  *) fail "unknown 22_control mode: $mode" ;;
esac

mkdir -p "$TMP/proj/src" "$TMP/proj/lib"
cd "$TMP/proj"
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
