#!/usr/bin/env bash
# The fleet, end to end, under failure: two features (beta requires alpha),
# a task that fails its first attempt, a worker that stalls, a merge
# conflict the manager resolves, an interface change a live branch is told
# about, pull requests through a fake gh — run once straight through, and
# once with the supervisor killed mid-run and resumed. Both must end in the
# same state.
. "$(dirname "$0")/../lib.sh"

DRIVER="$FIXTURES/fleet/e2e-driver.sh"
GH="$FIXTURES/fleet/fake-gh.sh"
export CG

setup_repo() {
    rm -rf "$TMP/proj" "$TMP/e2e" "$TMP/gh" "$TMP/remote.git"
    mkdir -p "$TMP/proj/src" "$TMP/proj/docs" "$TMP/e2e" "$TMP/gh"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    printf 'export function alpha(): number {\n  return 1;\n}\n' > src/a.ts
    echo 'export function beta(): number { return 0; }' > src/b.ts
    echo '# doc' > docs/d.md
    for f in alpha beta; do
        "$CG" spec new $f >/dev/null
        "$CG" spec docs off -f $f >/dev/null
        "$CG" spec start 1.1 -f $f >/dev/null; "$CG" spec done 1.1 -f $f >/dev/null
    done
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Failing once" --wave 1 --reqs 1.1 --symbols beta --touches 'src/b.ts' -f alpha >/dev/null
    "$CG" spec add 2.2 --title "Stalls once, changes alpha" --wave 1 --reqs 1.1 --symbols alpha --touches 'src/a.ts' -f alpha >/dev/null
    "$CG" spec add 3.2 --title "Docs, conflicting" --wave 2 --reqs 1.1 --touches 'docs/*.md,src/d.ts' -f alpha >/dev/null
    "$CG" spec add 2.1 --title "Beta work" --wave 1 --reqs 1.1 --symbols b1 --touches 'src/b1.ts' -f beta >/dev/null
    python3 - <<'EOF'
p = "spec/beta/spec.kvx"
s = open(p).read().replace("[meta]\n", '[meta]\nrequires = ["alpha"]\n', 1)
open(p, "w").write(s)
EOF
    "$CG" init >/dev/null
    printf '.codegraph/\n*.lock\n' > .gitignore
    cat >> spec/workflow.kvx <<EOF

[hierarchy]
test_gate = "true"
pr        = "auto"

[role.worker]
branch  = "task/{feature}/{task}"
agent   = "w-{feature}-{task}"
stall   = "2s"
retries = 2
wall    = "10m"

[agents]
driver = "custom"
cmd    = "E2E_DIR=$TMP/e2e CG=$CG sh $DRIVER \${PROMPT_FILE} \${TASK} \${ROOT} \${AGENT}"
max    = 3
ttl    = 600
EOF
    git add -A >/dev/null; git commit -qm base >/dev/null
    git init -q --bare "$TMP/remote.git" && git remote add origin "$TMP/remote.git"
    git push -q origin main 2>/dev/null
    export GH_FAKE_DIR="$TMP/gh" CG_GH="$GH"
}

run_state() { "$CG" fleet runs --json | python3 -c "import json,sys; r=[x for x in json.load(sys.stdin)['runs'] if x['feature']=='$1']; print(r[0]['state'] if r else '')"; }
wait_for() { local t="$1"; shift; local end=$(( $(date +%s) + t )); while ! eval "$@"; do [ "$(date +%s)" -lt "$end" ] || return 1; sleep 0.3; done; }

# what a finished run must look like, as one comparable text
end_state() {
    {
        echo "alpha: $("$CG" spec status -f alpha --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["done"], "/", d["tasks"])')"
        echo "beta: $("$CG" spec status -f beta --json | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["done"], "/", d["tasks"])')"
        echo "runs: $("$CG" fleet runs --json | python3 -c 'import json,sys; print(sorted((r["feature"], r["state"]) for r in json.load(sys.stdin)["runs"]))')"
        echo "main has: $(for b in feature/alpha feature/beta; do git merge-base --is-ancestor $b main && echo -n "$b "; done)"
        echo "src/a.ts: $(cat src/a.ts | tr '\n' ' ')"
        echo "src/d.ts: $(cat src/d.ts | tr '\n' ' ')"
        echo "docs/d.md: $(cat docs/d.md)"
        echo "prs: $(grep -c '^pr create' "$GH_FAKE_DIR/calls.txt")"
        echo "attempts: $(ls "$TMP/e2e"/att-* | xargs -n1 basename | sort | tr '\n' ' ')"
    } 2>/dev/null
}

check_events() {
    "$CG" events --json -n 3000 --since 0 | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
def of(kind, pred=lambda e: True): return [e for e in ev if e["kind"] == kind and pred(e)]
# 2.1 failed once and was retried; 2.2 stalled once and was retried
spawns = lambda t: of("orch.spawn", lambda e: e["subject"] == t)
assert len(spawns("alpha/2.1")) == 2, spawns("alpha/2.1")
assert len(spawns("alpha/2.2")) == 2, spawns("alpha/2.2")
assert len(spawns("alpha/3.2")) == 1 and len(spawns("beta/2.1")) == 1
err = of("agent.result", lambda e: e["subject"] == "alpha/2.1" and e["payload"]["is_error"])
assert len(err) == 1 and "cannot find name" in err[0]["payload"]["text"], err
st = of("supervisor.stall", lambda e: e["subject"] == "alpha/2.2")
assert [e["payload"]["action"] for e in st] == ["nudge", "stop"], st
assert not of("supervisor.escalate") and not of("supervisor.blocked"), "rescued retries must not escalate"
# the retry prompt carried what failed
# the conflict, then the resolution
m = [e["payload"]["outcome"] for e in of("fleet.merge", lambda e: e["subject"] == "alpha/3.2")]
assert m[0] == "conflict" and "docs/d.md" in of("fleet.merge", lambda e: e["subject"] == "alpha/3.2")[0]["payload"]["conflicts"], m
# the interface change reached the live branch
d = of("drift.interface")
assert d and d[0]["payload"]["symbol"] == "alpha" and d[0]["payload"]["change"] == "signature", d
agents = {a["agent"] for a in d[0]["payload"]["agents"]}
assert "w-alpha-3.2" in agents, agents
steer = of("agent.steer", lambda e: "Interface drift" in (e["payload"].get("message") or ""))
assert {e["subject"] for e in steer} >= {"w-alpha-3.2", "fm-alpha"}, steer
# both features landed behind the gates and opened pull requests
lands = {e["payload"]["feature"]: e["payload"]["outcome"] for e in of("fleet.land")}
assert lands == {"alpha": "landed", "beta": "landed"}, lands
prs = {e["payload"]["feature"] for e in of("fleet.pr", lambda e: e["payload"]["outcome"] == "opened")}
assert prs == {"alpha", "beta"}, prs
# beta started only once alpha had landed
land_a = min(e["seq"] for e in of("fleet.land", lambda e: e["payload"]["feature"] == "alpha"))
start_b = min(e["seq"] for e in of("orch.spawn", lambda e: (e["payload"].get("feature")) == "beta"))
assert start_b > land_a
runs = {e["payload"]["feature"]: e["payload"]["state"] for e in of("fleet.run") if e["payload"]["state"] == "complete"}
assert runs == {"alpha": "complete", "beta": "complete"}, runs
print("events ok:", len(ev), "events")
' || fail "event record"
    has "$(cat "$TMP/e2e/prompt-alpha-2.1-2")" "## Previous attempts"
    has "$(cat "$TMP/e2e/prompt-alpha-2.1-2")" "cannot find name beta"
    has "$(cat "$TMP/e2e/prompt-alpha-2.2-2")" "stopped by the supervisor: stalled"
    has "$(cat "$TMP/e2e/log")" "resolved 3.2"
    [ "$(grep -c '^pr create' "$GH_FAKE_DIR/calls.txt")" = 2 ] || fail "two pull requests expected"
}

# ---- run A: straight through
setup_repo
out="$(timeout 240 "$CG" fleet up --foreground --all -n 3 --max-fail 5 2>&1)" || fail "run A: $out"
has "$out" "[fleet] alpha complete"
has "$out" "[fleet] beta complete"
has "$out" "no progress for"
has "$out" "nudged"
check_events
A="$(end_state)"
echo "$A"
has "$A" "alpha: 4 / 4"
has "$A" "beta: 2 / 2"
has "$A" "main has: feature/alpha feature/beta"
has "$A" "alpha(n: number)"
has "$A" "alpha(4)"
has "$A" "docs/d.md: # doc, by the worker"
has "$A" "prs: 2"

# ---- run B: the supervisor dies mid-run and is resumed
setup_repo
"$CG" fleet up --all -n 3 --max-fail 5 >/dev/null
wait_for 60 '[ -f "$TMP/e2e/att-alpha-2.2-1" ]' || fail "run B never started"
sleep 1
sup="$("$CG" fleet runs --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["runs"][0]["pid"])')"
kill -9 "$sup"
wait_for 5 '! kill -0 "$sup" 2>/dev/null' || fail "supervisor survived kill -9"
has "$("$CG" fleet runs)" "GONE"
out="$("$CG" fleet up --resume)"
has "$out" "fleet resumed: run"
wait_for 240 '[ "$(run_state alpha)" = complete ]' || fail "resumed alpha did not complete: $(run_state alpha) — $(cat "$TMP/e2e/log")"
# the resumed supervisor owned one run; beta, whose prerequisite is now met,
# runs under a fresh one
timeout 240 "$CG" fleet up --foreground --all -n 3 --max-fail 5 >/dev/null 2>&1 || fail "run B beta"
wait_for 10 '[ "$(run_state beta)" = complete ]' || fail "beta did not complete"
check_events
B="$(end_state)"
[ "$(echo "$A" | grep -v '^runs:')" = "$(echo "$B" | grep -v '^runs:')" ] || fail "end states differ:
--- A
$A
--- B
$B"
has "$B" "runs: [('alpha', 'complete'), ('beta', 'complete')]"
# the killed supervisor's agents were adopted, not respawned: still exactly
# two attempts at 2.1 and 2.2
[ "$(ls "$TMP/e2e"/att-alpha-2.2-* | wc -l)" = 2 ] || fail "2.2 attempts after resume: $(ls "$TMP/e2e"/att-alpha-2.2-*)"

echo "fleet e2e OK"
