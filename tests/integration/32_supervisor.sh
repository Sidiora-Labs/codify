#!/usr/bin/env bash
# supervisor: durable fleet runs that survive their supervisor.
#   tree    — a wave's tasks at once on their own branches through the merge
#             lock, workers beside the manager, the main agent, and several
#             features under one supervisor honouring [meta] requires
#   supervise — stalls nudged then stopped, retries with what failed,
#             escalation to manager then main, blocked runs, budgets
#   durable — cg fleet up (foreground and detached), runs, pause/resume,
#             kill -9 of the supervisor then up --resume adopting the live
#             worker, down with and without a supervisor, approval gates
# Run one section: 32_supervisor.sh durable
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }
pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

# wait_for <seconds> <shell condition>
wait_for() {
    local t="$1"; shift
    local end=$(( $(date +%s) + t ))
    while ! eval "$@"; do
        [ "$(date +%s)" -lt "$end" ] || return 1
        sleep 0.2
    done
}

run_state() { "$CG" fleet runs --json | python3 -c 'import json,sys; r=json.load(sys.stdin)["runs"]; print(r[0]["state"] if r else "")'; }
run_field() { "$CG" fleet runs --json | python3 -c "import json,sys; r=json.load(sys.stdin)['runs']; print(r[0]['$1'] if r else '')"; }
spawns() { "$CG" events --kind orch.spawn --json -n 500 | python3 -c "import json,sys; print(sum(1 for l in sys.stdin if l.strip() and json.loads(l)['payload'].get('task') == '$1'))"; }

# A repository with a hierarchy and a driver that is the agent. A worker
# waits for $GO/go-<task> (when $GO/gated exists) before doing its task, so
# a test can hold it alive; the manager lands once every task is done.
setup_repo() {
    rm -rf "$TMP/proj" "$TMP/go"
    mkdir -p "$TMP/proj/src" "$TMP/proj/lib" "$TMP/proj/docs" "$TMP/go"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function alpha(){}' > src/a.ts
    echo 'export function beta(){}'  > lib/b.ts
    echo '# doc' > docs/d.md
    "$CG" spec new fleet >/dev/null
    "$CG" spec docs off >/dev/null
    "$CG" spec start 1.1 >/dev/null
    "$CG" spec done 1.1 >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha" --wave 1 --touches 'src/*.ts' --reqs 1.1 >/dev/null
    "$CG" spec add 3.1 --title "Docs" --wave 2 --touches 'docs/*.md' --reqs 1.1 >/dev/null
    "$CG" init >/dev/null
    printf '.codegraph/\n*.lock\n' > .gitignore
    cat >> spec/workflow.kvx <<EOF

[hierarchy]
test_gate = "true"
pr        = "manual"
${EXTRA_ROLE:-}

[agents]
driver = "custom"
cmd    = "sh $TMP/driver.sh \${PROMPT_FILE} \${TASK} \${ROOT} \${AGENT}"
max    = 1
ttl    = 600
EOF
    cat > "$TMP/driver.sh" <<EOF
#!/bin/sh
PF="\$1"; TASK="\$2"; ROOT="\$3"; AGENT="\$4"
cd "\$ROOT" || exit 9
if [ "\$CG_ROLE" = worker ]; then
    echo \$\$ > "$TMP/go/pid-\$TASK"
    n=1; while [ -f "$TMP/go/prompt-\$TASK-\$n" ]; do n=\$((n+1)); done
    cp "\$PF" "$TMP/go/prompt-\$TASK-\$n"
    if [ -f "$TMP/go/stall-\$TASK" ]; then sleep 120; exit 0; fi
    if [ -f "$TMP/go/spend-\$TASK" ]; then
        echo '{"type":"result","subtype":"success","is_error":false,"total_cost_usd":5.0,"num_turns":1}'
        sleep 120; exit 0
    fi
    if [ -f "$TMP/go/wall-\$TASK" ]; then
        i=0; while [ \$i -lt 600 ]; do
            echo "{\\"type\\":\\"assistant\\",\\"message\\":{\\"content\\":[{\\"type\\":\\"text\\",\\"text\\":\\"tick \$i\\"}]}}"
            i=\$((i+1)); sleep 0.2
        done; exit 0
    fi
    if [ -f "$TMP/go/failonce-\$TASK" ] && [ ! -f "$TMP/go/failed-\$TASK" ]; then
        : > "$TMP/go/failed-\$TASK"
        echo '{"type":"result","subtype":"error_during_execution","is_error":true,"result":"compile error in alpha","total_cost_usd":0.01}'
        exit 1
    fi
    if [ -f "$TMP/go/gated" ]; then
        while [ ! -f "$TMP/go/go-\$TASK" ]; do sleep 0.1; done
    fi
    "$CG" spec start "\$TASK" >/dev/null 2>&1
    case "\$TASK" in
      2.1) echo 'export function alpha(){ return 1 }' > src/a.ts ;;
      3.1) echo '# doc by the worker' > docs/d.md ;;
    esac
    "$CG" spec done "\$TASK" >/dev/null || exit 1
    git add -A >/dev/null
    git commit -qm "\$TASK [spec:\$CG_FEATURE/\$TASK]" >/dev/null || exit 1
    exec "$CG" fleet merge-up "\$TASK" >/dev/null
fi
left="\$("$CG" fleet tree -f "\$CG_FEATURE" --json | python3 -c 'import json,sys; m = json.load(sys.stdin)["managers"][0]; print(m["tasks"]["total"] - m["tasks"]["done"])')"
[ "\$left" -eq 0 ] || exit 0
exec "$CG" fleet land "\$CG_FEATURE" --no-pr >/dev/null 2>"$TMP/go/land.err"
EOF
    git add -A >/dev/null; git commit -qm base >/dev/null
}

if want durable; then
    # ---- foreground: the run is recorded and ends complete
    setup_repo
    out="$("$CG" fleet up --foreground -n 1 2>&1)"
    has "$out" "[fleet] run "
    has "$out" "[fleet] fleet complete"
    "$CG" fleet runs --json | pyjson '
r = d["runs"][0]
assert r["state"] == "complete" and r["reason"] == "merged", r
assert r["supervisor"] is False and r["live"] == 0 and r["nodes"] >= 3, r
assert r["feature"] == "fleet" and r["failures"] == 0, r
' || fail "foreground run record"
    out="$("$CG" events --kind fleet.run --json -n 20)"
    echo "$out" | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
st = [e["payload"]["state"] for e in ev]
assert st[0] == "running" and st[-1] == "complete", st
assert all(e["payload"]["run"] == ev[0]["payload"]["run"] for e in ev), ev
' || fail "fleet.run events"
    # children carry the run id
    out="$("$CG" events --kind orch.spawn --json -n 20)"
    has "$out" '"run":"'

    # ---- detached: back at once, one supervisor, pause and resume
    setup_repo
    : > "$TMP/go/gated"
    t0=$(date +%s)
    out="$("$CG" fleet up -n 1)"
    [ $(( $(date +%s) - t0 )) -lt 8 ] || fail "fleet up did not return promptly"
    has "$out" "fleet up: run "
    has "$out" "supervisor pid"
    run="$(run_field run)"
    [ "$(run_field supervisor)" = True ] || fail "supervisor not alive"
    expect_rc 1 "$CG" fleet up -n 1
    err="$("$CG" fleet up -n 1 2>&1 || true)"
    has "$err" "a supervisor is already running run $run"
    wait_for 20 '[ -f "$TMP/go/pid-2.1" ]' || fail "worker 2.1 never started"
    out="$("$CG" fleet pause)"
    has "$out" "fleet pause: run $run paused"
    [ "$(run_state)" = paused ] || fail "not paused"
    : > "$TMP/go/go-2.1"
    wait_for 20 '"$CG" events --kind orch.exit --json -n 50 | grep -q "\"task\":\"2.1\""' \
        || fail "worker 2.1 never finished"
    sleep 2
    # paused: the next task was not started, and no manager woke to take it
    [ "$(spawns 3.1)" = 0 ] || fail "a paused run started 3.1"
    [ ! -f "$TMP/go/pid-3.1" ] || fail "a paused run ran 3.1"
    out="$("$CG" fleet resume)"
    has "$out" "fleet resume: run $run running"
    : > "$TMP/go/go-3.1"
    wait_for 60 '[ "$(run_state)" = complete ]' || fail "resumed run did not complete: $(run_state)"
    [ "$(run_field supervisor)" = False ] || fail "supervisor outlived the run"
    log="$(run_field log)"
    has "$(cat "$log")" "[fleet] fleet complete"

    # ---- kill -9 the supervisor: the worker lives on, --resume adopts it
    setup_repo
    : > "$TMP/go/gated"
    "$CG" fleet up -n 1 >/dev/null
    run="$(run_field run)"
    wait_for 20 '[ -f "$TMP/go/pid-2.1" ]' || fail "worker 2.1 never started"
    sup="$(run_field pid)"
    wpid="$(cat "$TMP/go/pid-2.1")"
    kill -9 "$sup"
    wait_for 5 '! kill -0 "$sup" 2>/dev/null' || fail "supervisor survived kill -9"
    kill -0 "$wpid" 2>/dev/null || fail "the worker died with its supervisor"
    out="$("$CG" fleet runs)"
    has "$out" "GONE"
    [ "$(run_state)" = running ] || fail "a crashed run must stay open"
    out="$("$CG" fleet up --resume)"
    has "$out" "fleet resumed: run $run"
    wait_for 10 'grep -q "adopted worker" "$(run_field log)"' || fail "worker not adopted"
    : > "$TMP/go/go-2.1"; : > "$TMP/go/go-3.1"
    wait_for 60 '[ "$(run_state)" = complete ]' || fail "resumed run did not complete: $(run_state)"
    [ "$(spawns 2.1)" = 1 ] || fail "2.1 was spawned again after the crash"
    "$CG" fleet runs --json | pyjson "
r = d['runs'][0]
assert r['run'] == '$run' and r['state'] == 'complete' and r['failures'] == 0, r
" || fail "resumed run record"

    # ---- down: agents terminated, claims released, branches kept
    setup_repo
    : > "$TMP/go/gated"
    "$CG" fleet up -n 1 >/dev/null
    wait_for 20 '[ -f "$TMP/go/pid-2.1" ]' || fail "worker 2.1 never started"
    wpid="$(cat "$TMP/go/pid-2.1")"
    out="$("$CG" fleet down)"
    has "$out" "stopped — agents terminated, claims released, branches kept"
    wait_for 5 '! kill -0 "$wpid" 2>/dev/null' || fail "worker survived down"
    [ "$(run_state)" = stopped ] || fail "not stopped"
    has "$("$CG" spec status --json)" '"claims":[]'
    has "$(git branch --list 'wave/*')" "wave/fleet/1"

    # ---- down with the supervisor already gone cleans up by itself
    setup_repo
    : > "$TMP/go/gated"
    "$CG" fleet up -n 1 >/dev/null
    wait_for 20 '[ -f "$TMP/go/pid-2.1" ]' || fail "worker 2.1 never started"
    wpid="$(cat "$TMP/go/pid-2.1")"
    kill -9 "$(run_field pid)"
    sleep 0.3
    out="$("$CG" fleet down)"
    has "$out" "no supervisor was running; 1 agent(s) terminated"
    wait_for 5 '! kill -0 "$wpid" 2>/dev/null' || fail "orphaned worker survived down"
    has "$("$CG" spec status --json)" '"claims":[]'
    [ "$(run_state)" = stopped ] || fail "not stopped"
    expect_rc 1 "$CG" fleet down

    # ---- approval gate: the manager's land waits for a person
    EXTRA_ROLE='[role.feature]
approve = ["land"]' setup_repo
    "$CG" fleet up -n 1 >/dev/null
    wait_for 60 '"$CG" fleet approvals --json | grep -q "\"gate\":\"land\""' \
        || fail "no land approval requested: $(cat "$(run_field log)")"
    "$CG" fleet approvals --json | pyjson '
a = d["approvals"][0]
assert a["gate"] == "land" and a["subject"] == "fleet" and a["state"] == "pending", a
assert a["requested_by"] == "fm-fleet" and a["run"], a
' || fail "approval record"
    has "$(cat "$TMP/go/land.err")" "waits for approval #"
    sleep 3
    [ "$(run_state)" = running ] || fail "run moved on without approval"
    wakes="$("$CG" events --kind orch.spawn --json -n 50 | grep -c '"role":"feature"')"
    sleep 2
    [ "$("$CG" events --kind orch.spawn --json -n 50 | grep -c '"role":"feature"')" = "$wakes" ] \
        || fail "the manager was woken while waiting for approval"
    has "$(cat "$(run_field log)")" "waiting for approval #"
    id="$("$CG" fleet approvals --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["approvals"][0]["id"])')"
    out="$("$CG" fleet approve "$id" -m "looks good")"
    has "$out" "approved #$id — land of fleet"
    wait_for 60 '[ "$(run_state)" = complete ]' || fail "approved run did not complete: $(run_state)"
    "$CG" fleet approvals --all --json | pyjson '
a = [x for x in d["approvals"] if x["gate"] == "land"][0]
assert a["state"] == "used" and a["note"] == "looks good", a
' || fail "approval consumed"
    out="$("$CG" events --kind approval. --json -n 10)"
    has "$out" '"kind":"approval.request"'
    has "$out" '"kind":"approval.decided"'
    # a person landing by hand is its own approval
    expect_rc 1 "$CG" fleet approve 9999
fi

if want supervise; then
    evk() { "$CG" events --kind "$1" --json -n 500; }
    count() { evk "$1" | python3 -c "import json,sys; print(sum(1 for l in sys.stdin if l.strip() and $2))"; }

    # ---- a stalled worker is nudged, then stopped with a handoff, retried
    #      once, escalated to its manager, then to main, and the run ends
    #      blocked on it while the rest of the feature was done
    EXTRA_ROLE='[role.worker]
stall   = "1s"
retries = 1' setup_repo
    : > "$TMP/go/stall-2.1"
    rc=0; out="$(timeout 120 "$CG" fleet up --foreground -n 1 2>&1)" || rc=$?
    [ "$rc" -eq 1 ] || fail "a blocked run exits 1, got $rc: $out"
    has "$out" "no progress for"
    has "$out" "nudged"
    has "$out" "stalled — no progress for"
    has "$out" "2.1 out of retries — escalated to fm-fleet"
    has "$out" "2.1 blocked — escalated to main"
    has "$out" "fleet cannot finish — blocked: 2.1"
    [ "$(run_state)" = blocked ] || fail "run state $(run_state)"
    [ "$(run_field reason)" = "blocked: 2.1" ] || fail "reason $(run_field reason)"
    [ "$(spawns 2.1)" = 2 ] || fail "2.1 should run exactly twice (1 retry), ran $(spawns 2.1)"
    [ "$(count supervisor.stall 'json.loads(l)["payload"]["action"] == "nudge"')" = 2 ] || fail "one nudge per attempt"
    [ "$(count supervisor.stall 'json.loads(l)["payload"]["action"] == "stop"')" = 2 ] || fail "one stop per attempt"
    [ "$(count supervisor.escalate 'json.loads(l)["payload"]["agent"] == "fm-fleet"')" = 1 ] || fail "escalation to the manager"
    [ "$(count supervisor.blocked 'json.loads(l)["payload"]["to"] == "main"')" = 1 ] || fail "escalation to main"
    steer="$(evk agent.steer)"
    has "$steer" '"subject":"w-fleet-1"'                 # the nudge
    has "$steer" '"subject":"fm-fleet"'                  # the escalation
    has "$steer" '"subject":"gideon"'                    # main
    # the rest of the feature was not held up by the stuck task
    has "$(git show feature/fleet:spec/fleet/spec.kvx | sed -n '/task.3.1/,/^$/p')" 'status = "done"'
    # the stop left a handoff, and the retry's prompt says what happened
    has "$("$CG" resume --task 2.1)" "blocked: stalled — no progress for"
    p2="$(cat "$TMP/go/prompt-2.1-2")"
    has "$p2" "## Previous attempts"
    has "$p2" "This is attempt 2 at 2.1"
    has "$p2" "stopped by the supervisor: stalled"
    hasnt "$(cat "$TMP/go/prompt-2.1-1")" "## Previous attempts"
    has "$("$CG" recall blocked --task fleet/2.1)" "out of retries, escalated"

    # ---- a failed attempt is retried with what it said, and the run ends
    #      complete
    EXTRA_ROLE='[role.worker]
retries = 2' setup_repo
    : > "$TMP/go/failonce-2.1"
    out="$(timeout 120 "$CG" fleet up --foreground -n 1 2>&1)" || fail "retry run: $out"
    has "$out" "[fleet] fleet complete"
    [ "$(run_state)" = complete ] || fail "run state $(run_state)"
    [ "$(run_field failures)" = 1 ] || fail "failures $(run_field failures)"
    [ "$(spawns 2.1)" = 2 ] || fail "2.1 ran $(spawns 2.1) times"
    p2="$(cat "$TMP/go/prompt-2.1-2")"
    has "$p2" "## Previous attempts"
    has "$p2" "the agent finished with error_during_execution: compile error in alpha"
    [ "$(count supervisor.escalate 'True')" = 0 ] || fail "a rescued retry must not escalate"

    # ---- budgets: wall clock, then spend
    EXTRA_ROLE='[role.worker]
wall    = "2s"
stall   = "1h"
retries = 0' setup_repo
    : > "$TMP/go/wall-2.1"
    timeout 120 "$CG" fleet up --foreground -n 1 >/dev/null 2>&1 || true
    evk supervisor.budget | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
assert len(ev) == 1 and ev[0]["subject"] == "fleet/2.1", ev
assert ev[0]["payload"]["reason"] == "wall-clock budget of 2s spent", ev
' || fail "wall budget"
    [ "$(count supervisor.stall 'True')" = 0 ] || fail "a busy worker must not be called stalled"

    EXTRA_ROLE='[role.worker]
spend   = "$1"
retries = 0' setup_repo
    : > "$TMP/go/spend-2.1"
    timeout 120 "$CG" fleet up --foreground -n 1 >/dev/null 2>&1 || true
    evk supervisor.budget | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
assert len(ev) == 1, ev
assert ev[0]["payload"]["reason"] == "spend budget of $1.00 exceeded ($5.00)", ev
' || fail "spend budget"
fi

if want tree; then
    # A driver that logs "start|end <role> <what> <ns>" and waits a little
    # so overlap is observable; main records why it was woken.
    tree_driver() {
        cat > "$TMP/driver.sh" <<EOF
#!/bin/sh
PF="\$1"; TASK="\$2"; ROOT="\$3"; AGENT="\$4"
cd "\$ROOT" || exit 9
log() { echo "\$1 \$CG_ROLE \$2 \$(date +%s%N)" >> "$TMP/go/order"; }
if [ "\$CG_ROLE" = main ]; then
    n=1; while [ -f "$TMP/go/main-\$n" ]; do n=\$((n+1)); done
    sed -n 's/^You were woken because: //p' "\$PF" > "$TMP/go/main-\$n"
    exit 0
fi
if [ "\$CG_ROLE" = worker ]; then
    log start "\$CG_FEATURE/\$TASK"
    sleep 1.5
    "$CG" spec start "\$TASK" >/dev/null 2>&1
    echo "// \$TASK" >> "\$(cat "$TMP/go/file-\$CG_FEATURE-\$TASK")"
    "$CG" spec done "\$TASK" >/dev/null || exit 1
    git add -A >/dev/null
    git commit -qm "\$TASK [spec:\$CG_FEATURE/\$TASK]" >/dev/null || exit 1
    log end "\$CG_FEATURE/\$TASK"
    exec "$CG" fleet merge-up "\$TASK" >/dev/null
fi
log start "\$CG_FEATURE"
sleep 1
left="\$("$CG" fleet tree -f "\$CG_FEATURE" --json | python3 -c 'import json,sys; m = json.load(sys.stdin)["managers"][0]; print(m["tasks"]["total"] - m["tasks"]["done"])')"
log end "\$CG_FEATURE"
[ "\$left" -eq 0 ] || exit 0
exec "$CG" fleet land "\$CG_FEATURE" --no-pr >/dev/null
EOF
    }

    # ---- one feature: a wave's two tasks at once on their own branches,
    #      merged one at a time; workers beside the manager; the main agent
    rm -rf "$TMP/proj" "$TMP/go"
    mkdir -p "$TMP/proj/src" "$TMP/proj/lib" "$TMP/go"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function alpha(){}' > src/a.ts
    echo 'export function beta(){}'  > lib/b.ts
    "$CG" spec new fleet >/dev/null
    "$CG" spec docs off >/dev/null
    "$CG" spec start 1.1 >/dev/null; "$CG" spec done 1.1 >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha" --wave 1 --reqs 1.1 --symbols alpha --touches 'src/a.ts' >/dev/null
    "$CG" spec add 2.2 --title "Beta" --wave 1 --reqs 1.1 --symbols beta --touches 'lib/b.ts' >/dev/null
    echo src/a.ts > "$TMP/go/file-fleet-2.1"; echo lib/b.ts > "$TMP/go/file-fleet-2.2"
    "$CG" init >/dev/null
    printf '.codegraph/\n*.lock\n' > .gitignore
    cat >> spec/workflow.kvx <<EOF

[hierarchy]
test_gate  = "true"
pr         = "manual"
main_agent = true

[role.worker]
branch = "task/{feature}/{task}"
agent  = "w-{feature}-{task}"

[agents]
driver = "custom"
cmd    = "sh $TMP/driver.sh \${PROMPT_FILE} \${TASK} \${ROOT} \${AGENT}"
max    = 2
ttl    = 600
EOF
    tree_driver
    git add -A >/dev/null; git commit -qm base >/dev/null
    out="$(timeout 120 "$CG" fleet up --foreground -n 2 2>&1)" || fail "tree run: $out"
    has "$out" "[fleet] fleet complete"
    has "$out" "worker w-fleet-2.1 → 2.1 (wave 1) on task/fleet/2.1"
    has "$out" "worker w-fleet-2.2 → 2.2 (wave 1) on task/fleet/2.2"
    python3 - "$TMP/go/order" <<'EOF' || fail "overlap: $(cat "$TMP/go/order")"
import sys
ev = {}
for line in open(sys.argv[1]):
    kind, role, what, t = line.split()
    ev.setdefault((kind, role, what), int(t))
s21, e21 = ev[("start", "worker", "fleet/2.1")], ev[("end", "worker", "fleet/2.1")]
s22, e22 = ev[("start", "worker", "fleet/2.2")], ev[("end", "worker", "fleet/2.2")]
assert s22 < e21 and s21 < e22, "a wave's tasks must run at once on their own branches"
sm, em = ev[("start", "feature", "fleet")], ev[("end", "feature", "fleet")]
assert min(s21, s22) < em, "workers must not wait for the manager's first turn"
EOF
    branches="$(git branch --list 'task/*')"
    has "$branches" "task/fleet/2.1"
    has "$branches" "task/fleet/2.2"
    log="$(git log --oneline feature/fleet)"
    has "$log" "merge task/fleet/2.1 into feature/fleet [spec:fleet/2.1]"
    has "$log" "merge task/fleet/2.2 into feature/fleet [spec:fleet/2.2]"
    has "$(cat "$TMP/go/main-1")" "the run is starting"
    has "$(cat "$TMP/go/main-"*)" "feature fleet ended complete"
    "$CG" events --kind orch.spawn --json -n 100 | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
roles = {e["payload"]["role"] for e in ev}
assert {"main", "feature", "worker"} <= roles, roles
' || fail "three levels spawned"

    # ---- several features: beta requires alpha, so it starts once alpha
    #      is done; both complete under one supervisor
    rm -rf "$TMP/proj" "$TMP/go"
    mkdir -p "$TMP/proj/src" "$TMP/go"
    cd "$TMP/proj"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function a1(){}' > src/a.ts
    echo 'export function b1(){}' > src/b.ts
    for f in alpha beta; do
        "$CG" spec new $f >/dev/null
        "$CG" spec docs off -f $f >/dev/null
        "$CG" spec start 1.1 -f $f >/dev/null; "$CG" spec done 1.1 -f $f >/dev/null
    done
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "A work" --wave 1 --reqs 1.1 --touches 'src/a.ts' -f alpha >/dev/null
    "$CG" spec add 2.1 --title "B work" --wave 1 --reqs 1.1 --touches 'src/b.ts' -f beta >/dev/null
    echo src/a.ts > "$TMP/go/file-alpha-2.1"; echo src/b.ts > "$TMP/go/file-beta-2.1"
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
pr        = "manual"

[agents]
driver = "custom"
cmd    = "sh $TMP/driver.sh \${PROMPT_FILE} \${TASK} \${ROOT} \${AGENT}"
max    = 1
ttl    = 600
EOF
    tree_driver
    git add -A >/dev/null; git commit -qm base >/dev/null
    out="$(timeout 180 "$CG" fleet up --foreground --all -n 1 2>&1)" || fail "all run: $out"
    has "$out" "[fleet] alpha complete"
    has "$out" "[fleet] beta complete"
    "$CG" fleet runs --json | python3 -c '
import json, sys
r = {x["feature"]: x for x in json.load(sys.stdin)["runs"]}
assert r["alpha"]["state"] == "complete" and r["beta"]["state"] == "complete", r
assert r["alpha"]["run"] != r["beta"]["run"], r
' || fail "one run per feature"
    # beta's prerequisite is alpha done on main — that is, landed
    "$CG" events --json -n 500 | python3 -c '
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
landed_a = min(e["seq"] for e in ev if e["kind"] == "fleet.land" and e["payload"].get("feature") == "alpha" and e["payload"].get("outcome") == "landed")
start_b = min(e["seq"] for e in ev if e["kind"] == "orch.spawn" and e["payload"].get("feature") == "beta")
assert start_b > landed_a, (start_b, landed_a)
' || { "$CG" events --json -n 500 | python3 -c '
import json, sys
for l in sys.stdin:
    e = json.loads(l)
    if e["kind"].startswith(("orch.", "fleet.land", "task.status", "fleet.merge", "fleet.run")):
        print(e["seq"], e["kind"], e["subject"], (e["payload"] or {}).get("status") or (e["payload"] or {}).get("outcome") or (e["payload"] or {}).get("state") or "", e.get("branch"))
' >&2; fail "beta must wait for alpha"; }
    has "$(git log --oneline main)" "land feature/beta into main"
fi

echo "supervisor OK"
