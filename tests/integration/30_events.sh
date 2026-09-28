#!/usr/bin/env bash
# events: the append-only event log every state change lands in.
#   log       — claims, attempts, task status (with the value it replaced),
#               agents, and memories arrive in order with monotonic seq;
#               --kind (exact and prefix), --since, -n, --head, NDJSON
#   atomic    — a trigger's event rolls back with the change it describes
#   follow    — --follow streams events written after it started
#   retention — the prune keeps the newest N and records a floor that a
#               lagging cursor is warned about
#   fleet     — fleet begin, merge-up, land with gates, and pr emit
# Run one section: 30_events.sh follow
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }
# NDJSON on stdin -> python list `ev`
pyev() { python3 -c "import json,sys; ev=[json.loads(l) for l in sys.stdin if l.strip()]; $1"; }

setup_repo() {
    rm -rf "$TMP/proj"
    mkdir -p "$TMP/proj/src" "$TMP/proj/lib" "$TMP/proj/docs"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function alpha(){}' > src/a.ts
    echo 'export function beta(){}'  > lib/b.ts
    echo '# doc' > docs/d.md
    "$CG" spec new fleet >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha work" --wave 1 --touches 'src/*.ts' \
          --reqs 1.1 >/dev/null
    "$CG" spec add 2.2 --title "Beta work" --wave 1 --touches 'lib/*.ts' \
          --reqs 1.1 >/dev/null
    "$CG" init >/dev/null
    printf '.codegraph/\n*.lock\n' > .gitignore
    git add -A >/dev/null; git commit -qm base >/dev/null
}

if want log; then
    setup_repo
    head0="$("$CG" events --head)"
    CG_AGENT=w1 "$CG" spec claim 2.1 >/dev/null
    CG_AGENT=w1 "$CG" spec start 2.1 >/dev/null
    echo 'export function alpha(){ return 1 }' > src/a.ts
    CG_AGENT=w1 "$CG" spec done 2.1 >/dev/null
    "$CG" remember "alpha returns one" --task fleet/2.1 >/dev/null

    out="$("$CG" events --since "$head0" --json -n 200)"
    echo "$out" | pyev '
kinds = [e["kind"] for e in ev]
seqs = [e["seq"] for e in ev]
assert seqs == sorted(seqs) and len(set(seqs)) == len(seqs), seqs
for k in ("claim", "attempt.start", "task.status", "attempt.end", "release", "memory.add"):
    assert k in kinds, (k, kinds)
st = [e for e in ev if e["kind"] == "task.status" and e["subject"] == "fleet/2.1"]
trans = [(e["payload"]["from"], e["payload"]["status"]) for e in st]
assert ("pending", "in_progress") in trans and ("in_progress", "done") in trans, trans
assert all(e["payload"]["feature"] == "fleet" and e["payload"]["task"] == "2.1" for e in st), st
# claim precedes start precedes done
i_claim = kinds.index("claim"); i_done = seqs[[i for i,e in enumerate(ev) if e["kind"]=="task.status" and e["payload"]["status"]=="done"][0]]
assert seqs[i_claim] < i_done
a = [e for e in ev if e["kind"] == "attempt.start"][0]
assert a["node"] == "w1" and a["subject"] == "fleet/2.1" and a["payload"]["fence"] > 0, a
end = [e for e in ev if e["kind"] == "attempt.end"][0]
assert end["payload"]["state"] == "completed" and end["payload"]["from"] == "running", end
m = [e for e in ev if e["kind"] == "memory.add"][0]
assert m["subject"] == "fleet/2.1" and m["payload"]["type"], m
for e in ev:
    assert isinstance(e["at"], int) and e["at"] > 1_600_000_000_000, e
' || fail "event log contents"

    # text form names the transition and its actor
    out="$("$CG" events -n 200)"
    has "$out" "task.status"
    has "$out" "fleet/2.1"
    has "$out" '"from":"in_progress"'
    has "$out" "by w1"

    # --kind: exact, prefix with '.', prefix with '*', and a comma list
    out="$("$CG" events --kind claim --json)"
    echo "$out" | pyev 'assert ev and all(e["kind"] == "claim" for e in ev), ev' \
        || fail "--kind exact"
    out="$("$CG" events --kind attempt. --json)"
    echo "$out" | pyev '
ks = {e["kind"] for e in ev}
assert ks == {"attempt.start", "attempt.end"}, ks' || fail "--kind prefix ."
    out="$("$CG" events --kind 'attempt*' --json)"
    echo "$out" | pyev 'assert {e["kind"] for e in ev} == {"attempt.start", "attempt.end"}' \
        || fail "--kind prefix *"
    out="$("$CG" events --kind claim,release --json)"
    echo "$out" | pyev 'assert {e["kind"] for e in ev} == {"claim", "release"}, ev' \
        || fail "--kind list"
    # a kind filter with -n is the latest N matches, not the first
    out="$("$CG" events --kind task.status -n 1 --json)"
    echo "$out" | pyev '
assert len(ev) == 1 and ev[0]["payload"]["status"] == "done", ev' || fail "--kind -n latest"

    # --since is a cursor: nothing at or before it comes back
    h="$("$CG" events --head)"
    [ "$h" -gt "$head0" ] || fail "head did not advance"
    out="$("$CG" events --since "$h" --json)"
    [ -z "$out" ] || fail "events after head: $out"
    out="$("$CG" events --since $((h - 1)) --json)"
    echo "$out" | pyev "assert [e['seq'] for e in ev] == [$h], ev" || fail "--since cursor"
    out="$("$CG" events --head --json)"
    echo "$out" | pyjson "assert d['head'] == $h and d['pruned_through'] == 0, d" \
        || fail "--head json"

    # usage
    expect_rc 1 "$CG" events --bogus
fi

if want atomic; then
    setup_repo
    h="$("$CG" events --head)"
    python3 - <<'EOF'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db", isolation_level=None)
db.execute("BEGIN IMMEDIATE")
db.execute("INSERT INTO leases(task,agent,claimed,expires,touches) "
           "VALUES('fleet/2.2','ghost',0,9999999999,'')")
db.execute("ROLLBACK")
EOF
    [ "$("$CG" events --head)" = "$h" ] || fail "rolled-back claim left an event"
    out="$("$CG" events --kind claim --json)"
    hasnt "$out" "ghost"
    # the triggers are installed on the durable tables
    trig="$(python3 -c "
import sqlite3
db = sqlite3.connect('.codegraph/graph.db')
print(' '.join(sorted(r[0] for r in db.execute(\"SELECT name FROM sqlite_master WHERE type='trigger'\"))))")"
    for t in ev1_attempt_start ev1_attempt_state ev1_attempt_branch ev1_claim \
             ev1_release ev1_agent_join ev1_agent_update ev1_memory ev1_activity; do
        has "$trig" "$t"
    done
fi

if want follow; then
    setup_repo
    h="$("$CG" events --head)"
    "$CG" events --follow --for 4 --since "$h" --json > "$TMP/follow.out" &
    fpid=$!
    sleep 0.6
    CG_AGENT=w9 "$CG" spec claim 2.2 >/dev/null
    t0=$(python3 -c 'import time; print(time.time())')
    # the claim must reach the follower well before --for runs out
    for _ in $(seq 1 40); do
        grep -q '"kind":"claim"' "$TMP/follow.out" 2>/dev/null && break
        sleep 0.05
    done
    grep -q '"kind":"claim"' "$TMP/follow.out" || fail "follower missed the claim"
    python3 -c "
import time; d = time.time() - $t0
assert d < 1.5, d" || fail "follower too slow"
    wait "$fpid"
    pyev '
assert all(e["seq"] > '"$h"' for e in ev), ev
assert any(e["kind"] == "claim" and e["node"] == "w9" for e in ev), ev
' < "$TMP/follow.out" || fail "follow contents"
    # text follow works too and ends on --for
    out="$("$CG" events --follow --for 0.3 -n 5)"
    has "$out" "claim"
fi

if want retention; then
    setup_repo
    python3 - <<'EOF'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db", isolation_level=None)
db.execute("BEGIN")
for i in range(700):
    db.execute("INSERT INTO events(at,kind,subject,payload) "
               "VALUES(1700000000000,'test.fill',?,NULL)", (str(i),))
db.execute("COMMIT")
EOF
    # the next explicit emit (a task status write) prunes past the keep count
    CG_EVENTS_KEEP=16 "$CG" spec start 2.1 >/dev/null
    out="$("$CG" events --head --json)"
    echo "$out" | pyjson '
assert d["pruned_through"] > 0 and d["head"] - d["pruned_through"] == 16, d' \
        || fail "prune floor"
    left="$(python3 -c "
import sqlite3; print(sqlite3.connect('.codegraph/graph.db').execute('SELECT COUNT(*) FROM events').fetchone()[0])")"
    [ "$left" -eq 16 ] || fail "expected 16 rows left, got $left"
    err="$("$CG" events --since 1 2>&1 >/dev/null)"
    has "$err" "were pruned"
    # a new event after the prune still gets a fresh, larger seq
    h="$("$CG" events --head)"
    CG_AGENT=w1 "$CG" spec claim 2.2 >/dev/null
    [ "$("$CG" events --head)" -gt "$h" ] || fail "seq reused after prune"
fi

if want fleet; then
    setup_repo
    proj="$(pwd -P)"
    wt="$proj/.codegraph/worktrees"
    cat >> spec/workflow.kvx <<'EOF'

[hierarchy]
test_gate = "sh gate.sh"
lint_gate = "sh lint.sh"
EOF
    printf 'test -f gate.ok\n' > gate.sh
    printf 'true\n' > lint.sh
    git add -A >/dev/null; git commit -qm "hierarchy and gates" >/dev/null
    h="$("$CG" events --head)"

    "$CG" fleet begin 2.1 >/dev/null
    cd "$wt/wave-fleet-1"
    CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet "$CG" spec start 2.1 >/dev/null
    echo 'export function alpha(){ return 2 }' > src/a.ts
    CG_AGENT=w-fleet-1 "$CG" spec done 2.1 >/dev/null
    git add -A >/dev/null; git commit -qm "alpha [spec:fleet/2.1]" >/dev/null
    cd "$proj"
    "$CG" fleet merge-up 2.1 >/dev/null
    "$CG" fleet merge-up 2.1 >/dev/null          # nothing to merge
    expect_rc 1 "$CG" fleet land fleet           # test gate red
    touch gate.ok
    CG_GH=/nonexistent/gh "$CG" fleet land fleet >/dev/null

    out="$("$CG" events --since "$h" --kind fleet. --json -n 100)"
    echo "$out" | pyev '
by = {}
for e in ev: by.setdefault(e["kind"], []).append(e)
b = by["fleet.begin"][0]
assert b["subject"] == "fleet/2.1", b
p = b["payload"]
assert p["agent"] == "w-fleet-1" and p["parent"] == "fm-fleet", p
assert p["branch"] == "wave/fleet/1" and p["base"] == "feature/fleet" and p["wave"] == 1, p
assert p["fence"] > 0 and p["worktree"].endswith("/wave-fleet-1"), p
outs = [m["payload"]["outcome"] for m in by["fleet.merge"]]
assert outs == ["merged", "nothing"], outs
m = by["fleet.merge"][0]["payload"]
assert m["commits"] >= 1 and m["branch"] == "wave/fleet/1" and m["base"] == "feature/fleet", m
assert len(m["head"]) == 40 and m["conflicts"] == [], m
gates = [(g["payload"]["gate"], g["payload"]["ok"]) for g in by["fleet.gate"]]
assert gates == [("test", False), ("test", True), ("lint", True)], gates
assert by["fleet.gate"][0]["payload"]["exit"] != 0 and by["fleet.gate"][0]["payload"]["log"], by["fleet.gate"][0]
lands = [(l["payload"]["outcome"], l["payload"]["failed_gate"]) for l in by["fleet.land"]]
assert lands == [("refused", "test"), ("landed", None)], lands
' || fail "fleet events"
    # the worktree agent's task.status comes from its own branch
    out="$("$CG" events --since "$h" --kind task.status --json -n 100)"
    echo "$out" | pyev '
d = [e for e in ev if e["payload"]["status"] == "done" and e["subject"] == "fleet/2.1"]
assert d and d[-1]["branch"] == "wave/fleet/1", ev' || fail "worktree status branch"
fi

echo "events OK"
