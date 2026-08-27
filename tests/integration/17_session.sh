#!/usr/bin/env bash
# sessions, handoff, lease integrity: ready/claim-next, owner-checked leases,
# handoff -> resume round-trip, brief ranking, overlap + evidence gates, the
# flock that keeps racing claim-nexts disjoint, no-steal claim-next, forced
# release, claim refusals, and JSON output validity
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj/src" "$TMP/proj/lib" "$TMP/proj/docs" "$TMP/proj/w1"
cd "$TMP/proj"
echo 'export function alpha(){}' > src/a.ts
echo 'export function beta(){}'  > lib/b.ts
echo '# doc' > docs/d.md
echo '# later' > w1/w.md

"$CG" spec new sessions >/dev/null
"$CG" spec start 1.1 >/dev/null
"$CG" spec done 1.1 >/dev/null
"$CG" spec mode parallel >/dev/null

"$CG" spec add 2.1 --title "Alpha work" --wave 1 --touches 'src/*.ts' \
      --symbols alpha --do 'step one;step two' --reqs 1.1 >/dev/null
"$CG" spec add 2.2 --title "Beta work" --wave 1 --touches 'lib/*.ts' \
      --reqs 1.1 >/dev/null
"$CG" spec add 2.3 --title "Docs work" --wave 1 --touches 'docs/*.md' \
      --reqs 1.1 >/dev/null
"$CG" spec add 3.1 --title "Later wave" --wave 5 --touches 'w1/*.md' \
      --reqs 1.1 >/dev/null

"$CG" init >/dev/null
"$CG" commit -m base >/dev/null

# ---- ready lists every eligible task across waves, grouped
out="$("$CG" spec ready)"
has "$out" "eligible task(s), claimable in parallel"
has "$out" "wave 1:"
has "$out" "wave 5:"

out="$("$CG" spec ready --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['mode'] == 'parallel', d
ids = [t['id'] for t in d['tasks']]
assert ids == ['2.1', '2.2', '2.3', '3.1'], ids
assert all(t['conflicts_with_live'] is False for t in d['tasks']), d
assert all(t['feature'] == 'sessions' for t in d['tasks']), d
assert all(t['requires'] == [] for t in d['tasks']), d
"

# ---- sequential claim-nexts hand out disjoint tasks
out="$(CG_AGENT=a1 "$CG" spec claim-next --json)"
has "$out" '"id":"2.1"'
has "$out" '"agent":"a1"'
has "$out" '"expires_in_min":30'
out="$("$CG" spec claim-next --agent a2 --json)"
has "$out" '"id":"2.2"'
out="$("$CG" spec claim-next --agent a3 --json)"
has "$out" '"id":"2.3"'
out="$("$CG" spec claim-next --agent a4 --json)"
has "$out" '"id":"3.1"'

# empty frontier is exit 3, not an error
out="$("$CG" spec claim-next --agent a5 --json 2>&1 || true)"
has "$out" '"empty":true'
expect_rc 3 "$CG" spec claim-next --agent a5 --json

out="$("$CG" spec status --json)"
has "$out" '"mode":"parallel"'

echo "17_session claim-next ok"

# ---- leases are owner-checked: no silent steal, no foreign release
out="$("$CG" spec claim 2.1 --agent intruder 2>&1 || true)"
has "$out" "already claimed by a1"
out="$("$CG" spec release 2.1 --agent intruder 2>&1 || true)"
has "$out" "held by a1"
out="$("$CG" spec release 2.1 --agent a1)"
has "$out" "released 2.1"
"$CG" spec claim 2.1 --agent a1 >/dev/null

echo "17_session lease ok"

# ---- handoff stores structured state; a new handoff supersedes the old
echo 'export function alpha(){ return 1 }' > src/a.ts
out="$(CG_AGENT=a1 "$CG" handoff --task 2.1 --done 'step one' \
       --next 'step two;verify output' --blocked 'waiting on beta' \
       -m 'halfway through')"
has "$out" "handoff recorded for sessions/2.1"
out="$(CG_AGENT=a1 "$CG" handoff --task 2.1 --done 'step one' \
       --next 'step two;verify output' --blocked 'waiting on beta' \
       -m 'updated note' --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['task'] == 'sessions/2.1', d
assert d['superseded'] is not None, d
"

# ---- resume returns the packet, the latest handoff only, and live state
out="$("$CG" resume --task 2.1 --json)"
has "$out" '"id":"2.1"'
has "$out" '"done":"step one"'
has "$out" '"next":"step two;verify output"'
has "$out" '"blocked":"waiting on beta"'
has "$out" '"note":"updated note"'
has "$out" 'src/a.ts'
has "$out" '"agent":"a1"'
hasnt "$out" 'halfway through'

out="$("$CG" resume --task 2.1 --prompt)"
has "$out" "2.1"
has "$out" "step two"
has "$out" "cg handoff"

echo "17_session handoff ok"

# ---- done auto-releases the lease
echo 'more' >> docs/d.md
"$CG" spec done 2.3 >/dev/null
out="$("$CG" spec status --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
ids = [c['id'] for c in d['claims']]
assert '2.3' not in ids, ids
assert '2.1' in ids, ids
"

# ---- brief ranks task-scoped memories above newer unrelated ones
CG_AGENT=a1 "$CG" remember "alpha uses tail recursion" --type decision \
    >/dev/null
"$CG" remember "unrelated newer note zzz" --type fact >/dev/null
out="$(CG_AGENT=a1 "$CG" brief)"
has "$out" "alpha uses tail recursion"
task_line="$(printf '%s\n' "$out" | grep -nF 'alpha uses tail recursion' \
             | head -1 | cut -d: -f1)"
other_line="$(printf '%s\n' "$out" | grep -nF 'unrelated newer note zzz' \
              | head -1 | cut -d: -f1 || true)"
if [ -n "$other_line" ]; then
    [ "$task_line" -lt "$other_line" ] \
        || fail "task-scoped memory ranked below unrelated recency"
fi

# a long memory is capped at 400 bytes with an ellipsis
CG_AGENT=a1 "$CG" remember "$(python3 -c "print('L' * 600)")" --type fact \
    >/dev/null
out="$(CG_AGENT=a1 "$CG" brief)"
has "$out" "…"
hasnt "$out" "$(python3 -c "print('L' * 401)")"

echo "17_session brief ok"

# ---- the check gate catches partially-overlapping live glob claims
"$CG" spec done 2.1 >/dev/null
"$CG" spec mode standard >/dev/null
"$CG" spec add 5.1 --title "Glob A" --wave 1 --touches 'src/a*.ts' \
      --reqs 1.1 >/dev/null
"$CG" spec add 5.2 --title "Glob B" --wave 1 --touches 'src/*a.ts' \
      --reqs 1.1 >/dev/null
"$CG" spec claim 5.1 --agent dave >/dev/null
"$CG" spec claim 5.2 --agent erin >/dev/null
out="$("$CG" check 2>&1 || true)"
has "$out" "overlapping live claims"
expect_rc 1 "$CG" check
"$CG" spec release 5.1 --agent dave >/dev/null
"$CG" spec release 5.2 --agent erin >/dev/null
expect_rc 0 "$CG" check

# ---- evidence gate trips when a declared symbol disappears, and only then
echo 'export function omega(){}' > src/a.ts
out="$("$CG" check 2>&1 || true)"
has "$out" "task check(s) no longer hold"
expect_rc 1 "$CG" check
echo 'export function alpha(){ return 1 }' > src/a.ts
expect_rc 0 "$CG" check

echo "17_session gates ok"

# ---- racing claim-nexts serialise on the flock and never share a task
"$CG" spec mode parallel >/dev/null
mkdir -p racea raceb
echo r > racea/r.md
echo r > raceb/r.md
"$CG" spec add 6.1 --title "Race A" --wave 1 --touches 'racea/*.md' \
      --reqs 1.1 >/dev/null
"$CG" spec add 6.2 --title "Race B" --wave 1 --touches 'raceb/*.md' \
      --reqs 1.1 >/dev/null
"$CG" spec claim-next --agent r1 --json > "$TMP/r1.json" &
p1=$!
"$CG" spec claim-next --agent r2 --json > "$TMP/r2.json" &
p2=$!
wait "$p1"
wait "$p2"
python3 -c "
import json
a = json.load(open(r'$TMP/r1.json'))
b = json.load(open(r'$TMP/r2.json'))
assert 'task' in a and 'task' in b, (a, b)
assert a['task']['id'] != b['task']['id'], (a, b)
"
[ -f spec/sessions/spec.kvx.lock ] || fail "kvx flock side-file missing"

echo "17_session race ok"

# ---- claim-next never steals a live foreign lease
# after the race, {5.1, 6.1} are in progress; 6.2 is free and 5.2 is
# glob-blocked by 5.1's lease
mkdir -p w2
echo n > w2/n.md
"$CG" spec add 7.1 --title "Free lane" --wave 1 --touches 'w2/*.md' \
      --reqs 1.1 >/dev/null
"$CG" spec claim 6.2 --agent bob >/dev/null
out="$("$CG" spec claim-next --agent orch-1 --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['task']['id'] == '7.1', d
"
# 6.2 leased to bob, 5.2 glob-blocked: the frontier is empty, never a steal
expect_rc 3 "$CG" spec claim-next --agent orch-2
out="$("$CG" spec status --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
claims = {c['id']: c['agent'] for c in d['claims']}
assert claims.get('6.2') == 'bob', claims
assert claims.get('7.1') == 'orch-1', claims
"
[ -f spec/sessions/spec.kvx.claim.lock ] || fail "claim-next lock side-file missing"

echo "17_session no-steal ok"

# ---- release --force overrides a foreign lease; without it, refused
out="$("$CG" spec release 6.2 --agent mallory 2>&1 || true)"
has "$out" "held by bob"
out="$("$CG" spec release 6.2 --agent mallory --force)"
has "$out" "released 6.2"
out="$("$CG" spec status --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
ids = [c['id'] for c in d['claims']]
assert '6.2' not in ids, ids
"

# ---- claim refuses done work and requires-blocked work
out="$("$CG" spec claim 2.1 --agent bob 2>&1 || true)"
has "$out" "not claimable"
expect_rc 1 "$CG" spec claim 2.1 --agent bob
"$CG" spec add 8.1 --title "Gated" --wave 9 --touches 'w2/*.md' \
      --requires 7.1 --reqs 1.1 >/dev/null
out="$("$CG" spec claim 8.1 --agent bob 2>&1 || true)"
has "$out" "not claimable"
expect_rc 1 "$CG" spec claim 8.1 --agent bob

# ---- claim/release --json stays valid JSON with a hostile agent name
out="$(CG_AGENT='b"ob' "$CG" spec claim 6.2 --json)"
printf '%s' "$out" | python3 -c 'import json,sys
d = json.load(sys.stdin)
assert d["task"] == "sessions/6.2", d
assert d["agent"] == "b\"ob", d'
out="$(CG_AGENT='b"ob' "$CG" spec release 6.2 --json)"
printf '%s' "$out" | python3 -c 'import json,sys
d = json.load(sys.stdin)
assert d["released"] == "sessions/6.2", d'

echo "17_session claim-guard ok"

# ---- kvx writes rename-replace: lock-free readers never see a torn file
ino1="$(python3 -c "import os; print(os.stat('spec/sessions/spec.kvx').st_ino)")"
"$CG" spec add 9.0 --title "Atomic base" --wave 9 --touches 'w2/*.md' \
      --reqs 1.1 >/dev/null
ino2="$(python3 -c "import os; print(os.stat('spec/sessions/spec.kvx').st_ino)")"
[ "$ino1" != "$ino2" ] || fail "spec.kvx rewritten in place, not renamed"
( for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15 16 17 18 19 20; do
      "$CG" spec add "9.$i" --title "Atomic $i" --wave 9 \
            --touches 'w2/*.md' --reqs 1.1 >/dev/null
  done ) &
wpid=$!
torn=0
while kill -0 "$wpid" 2>/dev/null; do
    [ -s spec/sessions/spec.kvx ] || torn=1
done
wait "$wpid"
[ "$torn" -eq 0 ] || fail "spec.kvx observed empty during a write loop"
if ls spec/sessions/spec.kvx.tmp.* >/dev/null 2>&1; then
    fail "temp write litter left behind"
fi

echo "17_session atomic-write ok"
