#!/usr/bin/env bash
# orchestrator: cg spec run — mode/index refusals, --dry-run claims nothing,
# a custom driver completes disjoint wave-1 tasks in parallel slots, and a
# failing driver releases its lease, records an outcome memory, and stops
# the run past --max-fail
#   drivers — structured-output flags, model, and role capabilities in the
#             argv; Claude stream-json and Codex --json read back into
#             agent.* events; steering delivered by prompt and by the
#             post-edit hook
# Run only that section: 18_orchestrate.sh drivers
. "$(dirname "$0")/../lib.sh"

pyev() { python3 -c "import json,sys; ev=[json.loads(l) for l in sys.stdin if l.strip()]; $1"; }

drivers_section() {
    rm -rf "$TMP/drv"
    mkdir -p "$TMP/drv"
    cd "$TMP/drv"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    "$CG" spec new drv >/dev/null
    "$CG" spec docs off >/dev/null
    "$CG" spec mode parallel >/dev/null
    for t in 2.1 2.2 2.3; do
        "$CG" spec add $t --title "Task $t" --wave 1 --touches "out-$t.txt" \
              --verify "test -f out-$t.txt" >/dev/null
    done
    "$CG" init >/dev/null

    # ---- argv: structured flags by default, [agents] model, opt-out
    cat >> spec/workflow.kvx <<EOF

[agents]
driver = "custom"
cmd    = "CG=$CG $FIXTURES/fleet/fake-driver.sh \${PROMPT_FILE} \${TASK} \${ROOT} \${AGENT} \${MODEL}"
model  = "m-test"
max    = 1
ttl    = 120
EOF
    out="$("$CG" spec run --dry-run --driver claude)"
    has "$out" "claude -p --permission-mode acceptEdits --output-format stream-json --verbose --model m-test"
    out="$("$CG" spec run --dry-run --driver codex)"
    has "$out" "--skip-git-repo-check -C"
    has "$out" " --json -m m-test"
    printf '%s' "$out" | grep -Eq 'm-test -$' || fail "codex argv must still end with -"
    out="$("$CG" spec run --dry-run)"
    has "$out" "fake-driver.sh"
    has "$out" "m-test"                             # ${MODEL} in the template
    python3 - <<'EOF'
p = "spec/workflow.kvx"
s = open(p).read().replace('model  = "m-test"', 'model  = "m-test"\nstructured = false')
open(p, "w").write(s)
EOF
    out="$("$CG" spec run --dry-run --driver claude)"
    hasnt "$out" "stream-json"
    out="$("$CG" spec run --dry-run --driver codex)"
    hasnt "$out" " --json"
    python3 - <<'EOF'
p = "spec/workflow.kvx"
s = open(p).read().replace('\nstructured = false', '')
open(p, "w").write(s)
EOF

    # ---- a queued steer rides at the end of the next prompt, once
    "$CG" fleet steer run-1 "prefer small commits" >/dev/null
    out="$("$CG" fleet steer run-1 "and name the task" --json)"
    echo "$out" | python3 -c 'import json,sys; d=json.load(sys.stdin); assert d["queued"] and d["agent"]=="run-1" and d["seq"]>0, d' \
        || fail "steer json"
    expect_rc 1 "$CG" fleet steer run-1

    # ---- Claude stream-json, read back as agent.* events
    h="$("$CG" events --head)"
    out="$("$CG" spec run -n 1 2>&1)"
    has "$out" "[run] task 2.1 exit 0 → status done"
    has "$out" "[run] task 2.3 exit 0 → status done"
    # run-1's first prompt (the scaffolded 1.1 runs first) carries both
    # messages; no later prompt repeats them
    steered="$(grep -l "## Messages from your operator" .codegraph/agents/drv-*.prompt)"
    [ "$(printf '%s\n' "$steered" | grep -c .)" -eq 1 ] || fail "steered prompts: $steered"
    has "$steered" "drv-1.1.prompt"
    p="$(cat "$steered")"
    has "$p" "- prefer small commits"
    has "$p" "- and name the task"
    out="$("$CG" events --since "$h" --kind agent. --json -n 500)"
    echo "$out" | pyev '
t1 = [e for e in ev if e["subject"] == "drv/2.1"]
by = {}
for e in t1: by.setdefault(e["kind"], []).append(e)
s = by["agent.session"][0]
assert s["node"] == "run-1" and s["payload"]["session"] == "sess-run-1", s
assert s["payload"]["model"] == "m-test" and s["payload"]["role"] == "flat", s
texts = [e["payload"]["text"] for e in by["agent.text"]]
assert texts == ["Starting 2.1."], texts
tools = [(e["payload"]["tool"], e["payload"]["detail"]) for e in by["agent.tool"]]
assert tools == [("Bash", "touch out-2.1.txt"), ("Edit", "out-2.1.txt")], tools
u = by["agent.usage"][-1]["payload"]
assert u["tokens_in"] == 1850 and u["tokens_out"] == 50, u
r = by["agent.result"][0]["payload"]
assert r["subtype"] == "success" and r["is_error"] is False, r
assert abs(r["cost_usd"] - 0.0123) < 1e-9 and r["turns"] == 3 and r["duration_ms"] == 55, r
assert r["text"] == "Done: 2.1 qualified." and r["tokens_in"] == 1850, r
# nothing from the stderr noise line, and every task was read
assert {e["subject"] for e in ev} >= {"drv/2.1", "drv/2.2", "drv/2.3"}, ev
' || fail "claude stream events"
    out="$("$CG" events --since "$h" --kind "agent.steer*" --json -n 50)"
    echo "$out" | pyev '
d = [e for e in ev if e["kind"] == "agent.steer.delivered"]
assert len(d) == 1 and d[0]["payload"]["via"] == "prompt" and d[0]["payload"]["messages"] == 2, ev
' || fail "steer delivered by prompt"

    # ---- Codex exec --json, and a failed attempt read as an error result
    for t in 3.1 3.2; do
        "$CG" spec add $t --title "Task $t" --wave 2 --touches "out-$t.txt" \
              --verify "test -f out-$t.txt" >/dev/null
    done
    h="$("$CG" events --head)"
    FAKE_DIALECT=codex FAKE_FAIL=3.2 "$CG" spec run -n 1 --max-fail 0 >/dev/null 2>&1 || true
    out="$("$CG" events --since "$h" --kind agent. --json -n 500)"
    echo "$out" | pyev '
a = [e for e in ev if e["subject"] == "drv/3.1"]
k = {}
for e in a: k.setdefault(e["kind"], []).append(e["payload"])
assert k["agent.session"][0]["session"].startswith("th-"), k
assert k["agent.tool"][0]["tool"] == "command_execution", k
assert k["agent.tool"][0]["detail"] == "touch out-3.1.txt", k
assert len(k["agent.tool"]) == 1, k                     # started once, not twice
assert k["agent.text"][0]["text"] == "Wrote out-3.1.txt for 3.1.", k
u = k["agent.usage"][-1]
assert u["tokens_in"] == 1500 and u["tokens_out"] == 45 and u["turns"] == 1, u
f = [e["payload"] for e in ev if e["subject"] == "drv/3.2" and e["kind"] == "agent.result"]
assert f and f[0]["is_error"] is True and f[0]["subtype"] == "error" and "scripted failure" in f[0]["text"], f
' || fail "codex json events"

    # ---- live delivery to a Claude Code session: the post-edit hook
    "$CG" fleet steer w-live "stop touching out-2.1.txt" >/dev/null
    payload='{"tool_name":"Edit","tool_input":{"file_path":"out-2.1.txt"}}'
    out="$(echo "$payload" | CG_AGENT=w-live "$CG" hook post-edit)"
    echo "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
h = d["hookSpecificOutput"]
assert h["hookEventName"] == "PostToolUse", d
assert "Messages from your operator" in h["additionalContext"], d
assert "- stop touching out-2.1.txt" in h["additionalContext"], d
' || fail "hook steer json: $out"
    out="$(echo "$payload" | CG_AGENT=w-live "$CG" hook post-edit)"
    hasnt "$out" "hookSpecificOutput"               # delivered once
    out="$(echo "$payload" | CG_AGENT=someone-else "$CG" hook post-edit)"
    hasnt "$out" "hookSpecificOutput"
    out="$("$CG" events --kind agent.steer.delivered --json -n 5)"
    echo "$out" | pyev '
assert any(e["subject"] == "w-live" and e["payload"]["via"] == "hook" for e in ev), ev
' || fail "steer delivered by hook"
    cd "$TMP"
}

if [ "${1:-}" = drivers ]; then
    drivers_section
    echo "18_orchestrate drivers OK"
    exit 0
fi

mkdir -p "$TMP/proj/src" "$TMP/proj/lib" "$TMP/proj/docs"
cd "$TMP/proj"
echo 'export function alpha(){}' > src/a.ts

"$CG" spec new orch >/dev/null
# This suite isolates numbered-task scheduling; @docs connector closure is
# exercised end to end by 24_docs.sh.
"$CG" spec docs off >/dev/null
"$CG" spec start 1.1 >/dev/null
"$CG" spec done 1.1 >/dev/null

# ---- refusal outside parallel/prod mode, with a one-line hint
rc=0; out="$("$CG" spec run 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 in standard mode, got $rc"
has "$out" "cg spec mode parallel"

"$CG" spec mode parallel >/dev/null

# ---- refusal without a Codify index
rc=0; out="$("$CG" spec run 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 without .codegraph, got $rc"
has "$out" "cg init"

# ---- three leaf tasks: 2.1/2.2 touches-disjoint in wave 1, 3.1 behind 2.1
"$CG" spec add 2.1 --title "Alpha file" --wave 1 \
      --touches 'src/out-a.txt' --verify 'test -f src/out-a.txt' >/dev/null
"$CG" spec add 2.2 --title "Beta file" --wave 1 \
      --touches 'lib/out-b.txt' --verify 'test -f lib/out-b.txt' >/dev/null
"$CG" spec add 3.1 --title "Gamma file" --wave 2 --requires 2.1 \
      --touches 'docs/out-c.txt' --verify 'test -f docs/out-c.txt' >/dev/null

"$CG" init >/dev/null
"$CG" commit -m base >/dev/null

# a driver that does the real work through the cg CLI, then qualifies it
cat > "$TMP/driver.sh" <<EOF
#!/bin/sh
PF="\$1"; TASK="\$2"; ROOT="\$3"; AGENT="\$4"
[ -s "\$PF" ] || exit 9
[ -n "\$AGENT" ] || exit 9
[ -n "\${CG_ATTEMPT:-}" ] || exit 9
[ "\${CG_FENCE:-0}" -gt 0 ] || exit 9
cd "\$ROOT" || exit 9
case "\$TASK" in
  2.1) : > src/out-a.txt ;;
  2.2) : > lib/out-b.txt ;;
  3.1) : > docs/out-c.txt ;;
  3.9) exit 0 ;;
  4.1) exit 1 ;;
esac
exec "$CG" spec done "\$TASK"
EOF
chmod +x "$TMP/driver.sh"

cat >> spec/workflow.kvx <<EOF

[agents]
driver = "custom"
cmd    = "$TMP/driver.sh \${PROMPT_FILE} \${TASK} \${ROOT} \${AGENT}"
codex_args  = "--codex-extra"
claude_args = "--claude-extra"
max    = 2
ttl    = 120
EOF

# ---- dry run: the ordered plan with exact argv, claiming nothing
out="$("$CG" spec run --dry-run)"
has "$out" "dry run: nothing claimed"
has "$out" "wave 1:"
has "$out" "2.1"
has "$out" "2.2"
has "$out" "wave 2:"
has "$out" "3.1"
has "$out" "/bin/sh -c"
has "$out" "driver.sh"
has "$out" ".codegraph/agents/orch-2.1.prompt"
st="$("$CG" spec status --json)"
has "$st" '"claims":[]'
hasnt "$st" '"status":"in_progress"'

# ---- dry run under the stock drivers: exact template argv, extra args
#      from [agents], and codex's trailing stdin marker
out="$("$CG" spec run --dry-run --driver codex)"
has "$out" "codex exec --sandbox workspace-write --skip-git-repo-check -C"
has "$out" "--codex-extra"
printf '%s' "$out" | grep -Eq 'codex-extra -$' \
    || fail "codex argv must end with the stdin marker -"
out="$("$CG" spec run --dry-run --driver claude)"
has "$out" "claude -p --permission-mode acceptEdits"
has "$out" "--claude-extra"

# ---- run: two disjoint wave-1 tasks in parallel slots, then the unlocked
#      wave-2 task; everything ends done with no lease left behind
out="$("$CG" spec run -n 2)"
has "$out" "[run] task 2.1 → custom (agent run-1, log .codegraph/agents/orch-2.1.log)"
has "$out" "[run] task 2.2 → custom (agent run-2"
has "$out" "[run] task 2.1 exit 0 → status done"
has "$out" "[run] task 2.2 exit 0 → status done"
has "$out" "[run] task 3.1 → custom"
has "$out" "[run] task 3.1 exit 0 → status done"
has "$out" "frontier empty"
[ -f src/out-a.txt ]  || fail "task 2.1 never produced its file"
[ -f lib/out-b.txt ]  || fail "task 2.2 never produced its file"
[ -f docs/out-c.txt ] || fail "task 3.1 never produced its file"
[ -s .codegraph/agents/orch-2.1.prompt ] || fail "missing prompt file"
has "$(cat .codegraph/agents/orch-2.1.prompt)" "resume: orch/2.1"
[ -f .codegraph/agents/orch-2.2.log ] || fail "missing agent log"
st="$("$CG" spec status --json)"
has "$st" '"claims":[]'
has "$st" '"tasks":4,"done":4,"implemented":0,"in_progress":0,"pending":0'

# ---- failing driver: lease released, outcome memory recorded, retried,
#      then the run stops past --max-fail with rc 1
"$CG" spec add 4.1 --title "Doomed" --wave 3 \
      --touches 'src/never.txt' >/dev/null
rc=0; out="$("$CG" spec run -n 1 --max-fail 1 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 past --max-fail, got $rc"
has "$out" "[run] task 4.1 exit 1 → status INCOMPLETE"
cnt="$(printf '%s' "$out" | grep -c 'status INCOMPLETE')"
[ "$cnt" -ge 2 ] || fail "expected the released task to be retried, got $cnt attempt(s)"
has "$out" "exceed --max-fail 1"
st="$("$CG" spec status --json)"
has "$st" '"claims":[]'
has "$st" '"tasks":5,"done":4,"implemented":0,"in_progress":0,"pending":1'
mem="$("$CG" recall completing --task orch/4.1)"
has "$mem" "agent exited rc=1 without completing"

# ---- advisory exit code: a driver that exits 0 without `cg spec done`
#      is a failure — INCOMPLETE, outcome memory, counted against max-fail
"$CG" spec add 3.9 --title "Quitter" --wave 2 \
      --touches 'src/quit.txt' >/dev/null
rc=0; out="$("$CG" spec run -n 1 --max-fail 0 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 for the exit-0 quitter, got $rc"
has "$out" "[run] task 3.9 exit 0 → status INCOMPLETE"
has "$out" "1 failure(s) exceed --max-fail 0"
hasnt "$out" "task 4.1"
st="$("$CG" spec status --json)"
has "$st" '"claims":[]'
has "$st" '"tasks":6,"done":4,"implemented":0,"in_progress":0,"pending":2'
mem="$("$CG" recall completing --task orch/3.9)"
has "$mem" "agent exited rc=0 without completing"

# ---- SIGINT mid-run (non-terminal delivery, so only cg gets the signal):
#      rc 130, lease released, task back to pending, and the driver's whole
#      process tree — background grandchild included — is dead
"$CG" spec add 2.9 --title "Hang" --wave 1 \
      --touches 'src/hang.txt' >/dev/null
cat > "$TMP/driver.sh" <<EOF
#!/bin/sh
echo \$\$ > "$TMP/driver.pid"
sleep 30 &
echo \$! > "$TMP/sleep.pid"
sleep 30
EOF
chmod +x "$TMP/driver.sh"
"$CG" spec run -n 1 > "$TMP/run.log" 2>&1 &
cgpid=$!
for i in $(seq 1 100); do
  [ -f "$TMP/driver.pid" ] && [ -f "$TMP/sleep.pid" ] && break
  sleep 0.1
done
[ -f "$TMP/driver.pid" ] || fail "driver never started"
[ -f "$TMP/sleep.pid" ]  || fail "grandchild never started"
dpid="$(cat "$TMP/driver.pid")"
spid="$(cat "$TMP/sleep.pid")"
kill -INT "$cgpid"
rc=0; wait "$cgpid" || rc=$?
[ "$rc" -eq 130 ] || fail "expected rc 130 after SIGINT, got $rc"
has "$(cat "$TMP/run.log")" "interrupted — children terminated, leases released"
for i in $(seq 1 100); do
  kill -0 "$dpid" 2>/dev/null || kill -0 "$spid" 2>/dev/null || break
  sleep 0.1
done
if kill -0 "$dpid" 2>/dev/null; then fail "driver survived the interrupt"; fi
if kill -0 "$spid" 2>/dev/null; then fail "sleep grandchild survived the interrupt"; fi
st="$("$CG" spec status --json)"
has "$st" '"claims":[]'
hasnt "$st" '"status":"in_progress"'
has "$st" '"tasks":7,"done":4,"implemented":0,"in_progress":0,"pending":3'

# ---- --fleet in a repository without a [hierarchy]: refused, nothing
#      spawned, and the single-level run above is unchanged by it
rc=0; out="$("$CG" spec run --fleet 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 for --fleet without a hierarchy, got $rc"
has "$out" "--fleet needs a [hierarchy] in spec/workflow.kvx"
has "$out" "nothing was spawned"
rc=0; out="$("$CG" spec run --fleet --status 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 for --fleet --status, got $rc"
rc=0; out="$("$CG" fleet tree 2>&1)" || rc=$?
[ "$rc" -eq 1 ] || fail "expected rc 1 for fleet tree without a hierarchy, got $rc"
has "$out" "this repository runs flat"
st="$("$CG" spec status --json)"
has "$st" '"claims":[]'
has "$st" '"tasks":7,"done":4,"implemented":0,"in_progress":0,"pending":3'

drivers_section

echo "18_orchestrate OK"
