#!/usr/bin/env bash
# spec new / add / lint / wave / claim, and the cg check gate
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj/src" "$TMP/proj/docs"
cd "$TMP/proj"
echo 'export function refundCharge(){}' > src/pay.ts
echo '# notes' > docs/notes.md

# ---- new scaffolds both the feature and workflow.kvx when absent
out="$("$CG" spec new payments)"
has "$out" "created"
has "$out" "active feature: payments"
[ -f spec/workflow.kvx ]      || fail "workflow.kvx not scaffolded"
[ -f spec/payments/spec.kvx ] || fail "spec.kvx not scaffolded"
[ -f spec/payments/tasks.md ] || fail "markdown mirror not rendered"

expect_rc 1 "$CG" spec new payments      # refuses to overwrite
expect_rc 1 "$CG" spec new "../escape"   # validates the name

# ---- add inserts a task and preserves every original line
cp spec/payments/spec.kvx "$TMP/before.kvx"
out="$("$CG" spec add 1.2 --title 'Refund flow' --wave 1 --requires 1.1 \
        --symbols refundCharge --touches 'src/*.ts' --verify 'true' \
        --do 'Design the API;Write the handler' --reqs 1.1)"
has "$out" "added task 1.2"
python3 - "$TMP/before.kvx" spec/payments/spec.kvx <<'PY'
import sys
before = open(sys.argv[1]).read().splitlines()
after  = open(sys.argv[2]).read().splitlines()
i = 0
for line in before:
    while i < len(after) and after[i] != line:
        i += 1
    assert i < len(after), "original line lost: %r" % line
    i += 1
print("byte-preservation ok")
PY
out="$(cat spec/payments/spec.kvx)"
has "$out" 'requires = ["1.1"]'
has "$out" 'do_2 = "Write the handler"'

expect_rc 1 "$CG" spec add 1.2 --title "Dup"   # duplicate id
expect_rc 1 "$CG" spec add 9.9                 # no title
expect_rc 1 "$CG" spec add abc --title "X"     # non-numeric id

# ---- lint is clean on a well-formed spec
out="$("$CG" spec lint)"
has "$out" "clean"

# ---- lint catches a requires pointing at nothing
"$CG" spec add 1.3 --title "Broken" --wave 1 --requires 9.9 --reqs 1.1 >/dev/null
out="$("$CG" spec lint 2>&1 || true)"
has "$out" "requires unknown task 9.9"
expect_rc 2 "$CG" spec lint

# ---- lint catches a requires cycle
python3 - spec/payments/spec.kvx <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace('requires = ["9.9"]', 'requires = ["1.4"]')
s += '\n[task.1.4]\ntitle = "Cycle"\nstatus = "pending"\nwave = 1\n' \
     'requires = ["1.3"]\nreqs = ["1.1"]\n'
open(p, "w").write(s)
PY
out="$("$CG" spec lint 2>&1 || true)"
has "$out" "requires cycle"

python3 - spec/payments/spec.kvx <<'PY'
import sys
p = sys.argv[1]
s = open(p).read().replace('requires = ["1.4"]', 'requires = ["1.1"]')
s = s.replace('requires = ["1.3"]', 'requires = ["1.1"]')
open(p, "w").write(s)
PY
"$CG" spec lint >/dev/null

# ---- lint flags a touches glob that can never match
out="$("$CG" spec add 1.5 --title "Dead glob" --wave 1 --touches 'nope/absent.ts' --reqs 1.1)"
out="$("$CG" spec lint 2>&1 || true)"
has "$out" "does not exist"

# ---- wave lists every eligible task, not just the first
out="$("$CG" spec wave)"
has "$out" "1.1"
out="$("$CG" spec wave --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['tasks'], d
assert d['mode'] == 'standard', d
"

# ---- parallel mode allows several in flight, refuses overlapping touches
"$CG" spec mode parallel >/dev/null
"$CG" spec add 2.1 --title "Disjoint work" --wave 0 --touches 'docs/*.md' --reqs 1.1 >/dev/null
"$CG" spec add 2.2 --title "Overlapping work" --wave 0 --touches 'src/*.ts' --reqs 1.1 >/dev/null

"$CG" spec start 1.1 >/dev/null && "$CG" spec done 1.1 >/dev/null
"$CG" spec start 1.2 >/dev/null                  # claims src/*.ts
out="$("$CG" spec start 2.1)"                    # docs/*.md is disjoint
has "$out" "started 2.1"
out="$("$CG" spec start 2.2 2>&1 || true)"       # collides with 1.2
has "$out" "also claims"
expect_rc 1 "$CG" spec start 2.2

# standard mode still enforces one-at-a-time
"$CG" spec mode standard >/dev/null
out="$("$CG" spec start 2.2 2>&1 || true)"
has "$out" "already in_progress"

# ---- leases record an owner and refuse a second claimant
"$CG" init >/dev/null
out="$("$CG" spec claim 2.2 --agent alice --ttl 5)"
has "$out" "claimed 2.2 for alice"
out="$("$CG" spec claim 2.2 --agent bob 2>&1 || true)"
has "$out" "already claimed by alice"
out="$("$CG" spec release 2.2 --agent alice)"
has "$out" "released 2.2"
out="$("$CG" spec claim 2.2 --agent bob)"
has "$out" "claimed 2.2 for bob"

# ---- cg check gates render staleness in one exit code
out="$("$CG" check)"
has "$out" "spec render is current"
# edit the source of truth without re-rendering: the mirror is now behind
printf '\n[task.3.1]\ntitle = "Unrendered"\nstatus = "pending"\nwave = 9\n' \
    >> spec/payments/spec.kvx
out="$("$CG" check 2>&1 || true)"
has "$out" "spec render is stale"
expect_rc 1 "$CG" check
"$CG" spec render >/dev/null
expect_rc 0 "$CG" check

out="$("$CG" check --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['failures'] == 0, d
assert 'report' in d, d
"

echo "12_authoring ok"

# ---- claims are visible on the board, not buried in a table
out="$("$CG" spec status)"
has "$out" "claims:"
has "$out" "claimed by bob"
out="$("$CG" spec status --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert any(c['agent'] == 'bob' for c in d['claims']), d
"
"$CG" spec release 2.2 --agent bob >/dev/null
out="$("$CG" spec status)"
hasnt "$out" "claimed by bob"

echo "12_authoring claims ok"

# ---- check reports lease problems, which is what stalls a parallel wave
"$CG" spec claim 2.1 --agent carol --ttl 1 >/dev/null
out="$("$CG" check)"
has "$out" "task claims are consistent"

# two live claims over the same declared paths is a hard failure
"$CG" spec add 4.1 --title "Same files A" --wave 0 --touches 'src/*.ts' --reqs 1.1 >/dev/null
"$CG" spec add 4.2 --title "Same files B" --wave 0 --touches 'src/*.ts' --reqs 1.1 >/dev/null
"$CG" spec claim 4.1 --agent dave >/dev/null
"$CG" spec claim 4.2 --agent erin >/dev/null
out="$("$CG" check 2>&1 || true)"
has "$out" "overlapping live claims"
expect_rc 1 "$CG" check
"$CG" spec release 4.1 --agent dave >/dev/null
"$CG" spec release 4.2 --agent erin >/dev/null
expect_rc 0 "$CG" check

echo "12_authoring leasecheck ok"
