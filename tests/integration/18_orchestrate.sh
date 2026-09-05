#!/usr/bin/env bash
# orchestrator: cg spec run — mode/index refusals, --dry-run claims nothing,
# a custom driver completes disjoint wave-1 tasks in parallel slots, and a
# failing driver releases its lease, records an outcome memory, and stops
# the run past --max-fail
. "$(dirname "$0")/../lib.sh"

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

echo "18_orchestrate OK"
