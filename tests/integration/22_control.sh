#!/usr/bin/env bash
# Agent control-plane invariants. Modes let spec tasks qualify their own slice
# while the no-argument run remains a complete integration test.
. "$(dirname "$0")/../lib.sh"

mode="${1:-all}"
case "$mode" in
  all|state|liveness|integrate|events|progress|work|protocol) ;;
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

run_integrate() {
mkdir -p "$TMP/integrate/src" "$TMP/home"
cd "$TMP/integrate"
export HOME="$TMP/home"
echo 'int main(void){return 0;}' > src/main.c
"$CG" init >/dev/null

detect="$("$CG" integrate detect --json)"
python3 -c "
import json
d=json.loads(r'''$detect''')
labels=[h['label'] for h in d['hosts']]
assert labels == ['Codex','Claude Code','Copilot and VS Code','Cursor',
 'Gemini CLI','OpenCode','Zed','Windsurf','Cline','Continue'], labels
assert all(set(['mcp','instructions','skills','hooks','sessions','cloud'])
           <= set(h['capabilities']) for h in d['hosts']), d
"

# Plan names every host and portable asset but never creates a target.
cat > .mcp.json <<'EOF'
{
  "mcpServers": {
    "other": { "command": "other", "args": [] }
  }
}
EOF
cp .mcp.json "$TMP/original-mcp.json"
plan="$("$CG" integrate plan --json)"
python3 -c "
import json
d=json.loads(r'''$plan''')
assert len(d['hosts']) == 10, d
assert len(d['assets']) == 8, d
assert next(h for h in d['hosts'] if h['id']=='claude-code')['action']=='merge'
assert all(a['path'].startswith(r'$TMP/integrate/') for a in d['assets'])
"
[ ! -e .cursor/mcp.json ] || fail "integrate plan wrote a config"

"$CG" integrate apply >/dev/null
[ -f .mcp.json.codify.bak ] || fail "existing MCP config was not backed up"
cmp "$TMP/original-mcp.json" .mcp.json.codify.bak \
    || fail "MCP backup does not contain the original"
python3 -c "
import json
d=json.load(open('.mcp.json'))
assert 'other' in d['mcpServers'] and 'codify' in d['mcpServers'], d
"
[ -x .codify/hooks/event.sh ] || fail "portable event shim missing"
for host in codex claude copilot cursor gemini; do
  [ -x ".codify/hooks/$host.sh" ] || fail "$host hook shim missing"
done
[ -s .agents/skills/codify-workflow/SKILL.md ] \
    || fail "portable Agent Skill missing"
[ -s .codify/agent-context.md ] || fail "graph agent context missing"
has "$(cat .codify/agent-context.md)" "codify-owned: graph-agent-context"
has "$(cat .agents/skills/codify-workflow/SKILL.md)" "cg spec trace"
out="$("$CG" integrate apply)"
has "$out" "already configured"
out="$("$CG" integrate doctor --json)"
has "$out" '"ok":true'

# Doctor distinguishes malformed/incomplete/stale/protocol/ownership and a
# missing executable, with paths and actionable labels in one pass.
printf '%s\n' '{broken' > .cursor/mcp.json
python3 - <<'PY'
import json, os
p='.gemini/settings.json'; d=json.load(open(p)); d['protocolVersion']='1900-01-01'; json.dump(d,open(p,'w'))
p=os.path.join(os.environ['HOME'],'.continue/config.json'); d=json.load(open(p)); d['mcpServers']['codegraph']={'command':'old'}; json.dump(d,open(p,'w'))
PY
rm .zed/settings.json
printf '%s\n' '# user owned skill' > .agents/skills/codify-workflow/SKILL.md
rc=0
out="$(CG_BINARY=/definitely/missing/cg "$CG" integrate doctor --json)" \
    || rc=$?
[ "$rc" -eq 1 ] || fail "doctor accepted broken integrations"
python3 -c "
import json
d=json.loads(r'''$out'''); s=' '.join(d['findings'])
for needle in ['missing or not executable','malformed','not configured',
               'stale server name codegraph','unsupported protocol',
               'conflicting generated-file ownership']:
    assert needle in s, (needle,s)
"

mcp="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | "$CG" mcp)"
has "$mcp" '"name":"integrate"'

echo "22_control integrate ok"
}

run_events() {
mkdir -p "$TMP/events/src" "$TMP/events-home"
cd "$TMP/events"
export HOME="$TMP/events-home"
export CG_SESSION="session-1"
export CG_ATTEMPT="attempt-1"
export CG_TASK="demo/1.1"
printf '%s\n' 'int alpha(void){return 1;}' > src/a.c
"$CG" init >/dev/null

# Native host names normalize into one durable envelope. The initial event is
# activity but cannot claim implementation progress without prior evidence.
first="$(printf '%s\n' \
  '{"hook_event_name":"PostToolUse","session_id":"session-1","tool_name":"Edit","output":"line 1"}' \
  | "$CG" event ingest --source claude --json)"
python3 -c "
import json
d=json.loads(r'''$first''')
assert d['source']=='claude' and d['kind']=='command', d
assert d['session']=='session-1' and d['attempt_id']=='attempt-1', d
assert d['task']=='demo/1.1' and d['activity'] is True, d
assert d['evidence_delta']==0 and d['implementation_progress'] is False, d
assert d['duplicate'] is False, d
"
first_id="$(printf '%s' "$first" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["id"])')"
first_fingerprint="$(printf '%s' "$first" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["fingerprint"])')"
first_revision="$(printf '%s' "$first" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["workspace_revision"])')"

# Top-level key order and insignificant whitespace do not create a new event.
duplicate="$(printf '%s\n' \
  '{ "output": "line 1", "tool_name": "Edit", "session_id": "session-1", "hook_event_name": "PostToolUse" }' \
  | "$CG" event ingest --source claude --json)"
python3 -c "
import json
d=json.loads(r'''$duplicate''')
assert d['duplicate'] is True, d
assert d['id']==int('$first_id'), d
assert d['fingerprint']=='$first_fingerprint', d
"

# A changed workspace revision is evidence. A non-heartbeat event can carry
# that evidence as implementation progress.
printf '%s\n' 'int alpha(void){return 2;}' > src/a.c
changed="$(printf '%s\n' \
  '{"event":"write","session":"session-1","output":"line 2"}' \
  | "$CG" event ingest --source cursor --json)"
python3 -c "
import json
d=json.loads(r'''$changed''')
assert d['kind']=='write' and d['source']=='cursor', d
assert d['workspace_revision']!='$first_revision', d
assert d['evidence_delta']==1 and d['output_changed'] is True, d
assert d['implementation_progress'] is True, d
"

# Heartbeats and changing output prove liveness, not implementation. They
# remain useful recovery evidence without inflating completion claims.
heartbeat="$(printf '%s\n' \
  '{"type":"heartbeat","sessionId":"session-1","output":"still compiling"}' \
  | "$CG" event ingest --source codex --json)"
python3 -c "
import json
d=json.loads(r'''$heartbeat''')
assert d['kind']=='heartbeat' and d['activity'] is True, d
assert d['output_changed'] is True and d['evidence_delta']==0, d
assert d['implementation_progress'] is False, d
"

history="$("$CG" event history --json)"
python3 -c "
import json
d=json.loads(r'''$history''')
assert d['count']==3, d
assert d['events'][0]['kind']=='heartbeat', d
assert all(e['session']=='session-1' for e in d['events']), d
assert all(e['attempt_id']=='attempt-1' for e in d['events']), d
assert all(e['task']=='demo/1.1' for e in d['events']), d
"
progress="$("$CG" event progress --json)"
python3 -c "
import json
d=json.loads(r'''$progress''')
assert d['activity'] is True and d['kind']=='heartbeat', d
assert d['implementation_progress'] is False, d
"

# Invalid/truncated input never reaches durable history.
expect_rc 1 sh -c "printf '%s\\n' '{broken' | '$CG' event ingest"
[ "$("$CG" event history --json | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["count"])')" -eq 3 ] \
  || fail "invalid lifecycle JSON was persisted"

mcp="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | "$CG" mcp)"
has "$mcp" '"name":"event_ingest"'
has "$mcp" '"name":"event_history"'
has "$mcp" '"name":"progress_status"'

# Portable hook shims are executable adapters into the same event stream.
"$CG" integrate apply >/dev/null
PATH="$(dirname "$CG"):$PATH" \
  printf '%s\n' '{"event":"command","session":"shim-session"}' \
  | PATH="$(dirname "$CG"):$PATH" .codify/hooks/claude.sh >/dev/null
shim_history="$("$CG" event history --json)"
python3 -c "
import json
d=json.loads(r'''$shim_history''')
assert any(e['source']=='claude' and e['session']=='shim-session'
           for e in d['events']), d
"

echo "22_control events ok"
}

run_progress() {
mkdir -p "$TMP/progress/src"
cd "$TMP/progress"
printf '%s\n' 'int alpha(void){return 1;}' > src/a.c
"$CG" init >/dev/null
export CG_TASK="progress/1.1"
export CG_SESSION="failure-session"
export CG_ATTEMPT="failure-attempt"
export CG_PROGRESS_WARN_EVENTS=2
export CG_PROGRESS_REPLAN_EVENTS=3
export CG_PROGRESS_EXPERIMENT_EVENTS=4
export CG_PROGRESS_HANDOFF_EVENTS=5
export CG_PROGRESS_STOP_EVENTS=6

# Repeated failures escalate through a finite ladder. Every event differs but
# none changes an artifact or covers a criterion.
for n in 1 2 3 4 5 6; do
  if [ "$n" -le 2 ]; then
    payload="{\"event\":\"command\",\"status\":\"failed\",\"output\":\"failure $n\"}"
  else
    payload="{\"event\":\"command\",\"output\":\"observation $n\"}"
  fi
  printf '%s\n' "$payload" | "$CG" event ingest --source test >/dev/null
  out="$("$CG" event progress --json)"
  case "$n" in
    2) expected=warn ;;
    3) expected=re_plan ;;
    4) expected=bounded_experiment ;;
    5) expected=handoff ;;
    6) expected=stop ;;
    *) expected= ;;
  esac
  if [ -n "$expected" ]; then
    python3 -c "
import json
d=json.loads(r'''$out''')
assert d['classification']=='repeated_failure', d
assert d['recovery']['action']=='$expected', d
assert len(d['recovery']['ladder'])==len(set(d['recovery']['ladder']))==6, d
assert d['recovery']['ladder'][-1]=='stop', d
"
  fi
done
python3 -c "
import json
d=json.loads(r'''$out''')
assert d['recovery']['next'] is None and d['recovery']['advisory'] is True, d
"
enforced="$(CG_PROGRESS_ENFORCE=1 "$CG" event progress --json)"
python3 -c "
import json
d=json.loads(r'''$enforced''')
assert d['recovery']['action']=='stop', d
assert d['recovery']['advisory'] is False, d
"

# Explicit input waits are live but not stalled and cannot be mistaken for
# another blind continuation.
printf '%s\n' '{"event":"waiting_input","requires_user_input":true}' \
  | "$CG" event ingest --source test >/dev/null
waiting="$("$CG" event progress --json)"
python3 -c "
import json
d=json.loads(r'''$waiting''')
assert d['classification']=='waiting_input' and d['waiting'] is True, d
assert d['stalled'] is False and d['recovery']['action']=='waiting_input', d
"

# A-B-A-B workspace revisions are churn, even though each individual patch
# changed bytes. Detect the oscillation instead of rewarding it as progress.
export CG_SESSION="oscillation-session"
export CG_ATTEMPT="oscillation-attempt"
for value in 1 2 1 2; do
  printf 'int alpha(void){return %s;}\n' "$value" > src/a.c
  printf '{"event":"write","output":"value %s"}\n' "$value" \
    | "$CG" event ingest --source test >/dev/null
done
oscillation="$("$CG" event progress --json)"
python3 -c "
import json
d=json.loads(r'''$oscillation''')
assert d['classification']=='patch_oscillation', d
assert d['patch_oscillation'] is True and d['recovery']['action']=='warn', d
"

# Pure observation loops receive their own reason, separate from failures.
export CG_SESSION="observation-session"
export CG_ATTEMPT="observation-attempt"
printf '%s\n' '{"event":"command","output":"look one"}' \
  | "$CG" event ingest --source test >/dev/null
printf '%s\n' '{"event":"command","output":"look two"}' \
  | "$CG" event ingest --source test >/dev/null
observation="$("$CG" event progress --json)"
python3 -c "
import json
d=json.loads(r'''$observation''')
assert d['classification']=='repeated_observation', d
assert d['no_evidence_events']==2 and d['recovery']['action']=='warn', d
"

echo "22_control progress ok"
}

run_work() {
mkdir -p "$TMP/work/src"
cd "$TMP/work"
printf '%s\n' 'int alpha(void){return 1;}' > src/a.c
git init -q
"$CG" spec new work >/dev/null
sed -i '/^ac_1/a ac_2 = "WHEN work changes THEN deltas stay compact."' \
  spec/work/spec.kvx
sed -i '/^\[task\.1\.1\]/a symbols = ["alpha"]' spec/work/spec.kvx
sed -i 's/reqs       = \["1.1"\]/reqs       = ["1.1", "1.2"]/' \
  spec/work/spec.kvx
"$CG" spec render >/dev/null
"$CG" init >/dev/null
"$CG" spec start 1.1 >/dev/null
claim="$("$CG" spec claim 1.1 --agent worker --session work-session --json)"
export CG_AGENT=worker
export CG_SESSION=work-session
export CG_ATTEMPT="$(printf '%s' "$claim" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["attempt_id"])')"
export CG_TASK=work/1.1
"$CG" remember 'preserve the public alpha contract' --type constraint \
  --task work/1.1 >/dev/null
printf '%s\n' '{"event":"command","output":"initial evidence"}' \
  | "$CG" event ingest --source test >/dev/null

opened="$("$CG" work open --task 1.1 --json)"
python3 -c "
import json
d=json.loads(r'''$opened''')
assert len(d['revision'])==64 and d['task_id']=='work/1.1', d
assert d['objective'] and len(d['criteria'])==2, d
assert isinstance(d['allowed_scope'],list), d
assert set(['git','codify_snapshot','spec_declaration','live_runtime','stale_state']) <= set(d['state']), d
assert any('alpha contract' in m['body'] for m in d['memories']), d
assert d['context']['query']=='alpha', d
assert 'verify_command' in d['tests'] and 'impact' in d['tests'], d
assert d['last_event']['session']=='work-session', d
assert 'classification' in d['progress'], d
"
revision="$(printf '%s' "$opened" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["revision"])')"

printf '%s\n' 'int alpha(void){return 2;}' > src/a.c
printf '%s\n' '{"event":"write","criterion":"1.1","output":"alpha changed"}' \
  | "$CG" event ingest --source test >/dev/null
updated="$("$CG" work update "$revision" --json)"
python3 -c "
import json
d=json.loads(r'''$updated''')
assert d['revision']!='$revision' and d['since']=='$revision', d
assert d['unchanged'] is False, d
assert any(p['path']=='src/a.c' and p['change']=='modified'
           for p in d['deltas']['workspace']), d
assert len(d['deltas']['evidence'])==1, d
assert 'objective' not in d and 'criteria' not in d and 'context' not in d, d
"
next_revision="$(printf '%s' "$updated" | python3 -c \
  'import json,sys; print(json.load(sys.stdin)["revision"])')"
unchanged="$("$CG" work update "$next_revision" --json)"
python3 -c "
import json
d=json.loads(r'''$unchanged''')
assert d['revision']=='$next_revision' and d['unchanged'] is True, d
assert d['deltas']=={'state':None,'evidence':[],'workspace':[]}, d
"
expect_rc 1 "$CG" work update definitely-not-a-revision

closed="$("$CG" work close --task 1.1 \
  --evidence '1.1=integration evidence recorded' --json)"
python3 -c "
import json
d=json.loads(r'''$closed''')
assert len(d['criteria'])==2, d
assert d['verified']==1 and d['unverified']==1, d
assert d['criteria'][0]['result']=='verified', d
assert d['criteria'][1]['result']=='unverified' and d['criteria'][1]['evidence'] is None, d
"
reclosed="$("$CG" work close --task 1.1 --json)"
has "$reclosed" 'integration evidence recorded'

mcp="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}' \
  | "$CG" mcp)"
has "$mcp" '"name":"work_open"'
has "$mcp" '"name":"work_update"'
has "$mcp" '"name":"work_close"'

echo "22_control work ok"
}

run_protocol() {
mkdir -p "$TMP/protocol/src"
cd "$TMP/protocol"
printf '%s\n' 'int main(void){return 0;}' > src/main.c
"$CG" spec new protocol >/dev/null
"$CG" init >/dev/null

req() { printf '%s\n' "$1" | "$CG" mcp 2>/dev/null; }
version="$("$CG" --version)"
current="$(req '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-11-25"}}')"
python3 -c "
import json
d=json.loads(r'''$current''')['result']
assert d['protocolVersion']=='2025-11-25', d
assert d['serverInfo']['version']==r'''$version''', d
assert d['capabilities']['tools']['listChanged'] is False, d
assert d['capabilities']['resources']['listChanged'] is False, d
assert d['capabilities']['resources']['subscribe'] is False, d
assert d['capabilities']['prompts']['listChanged'] is False, d
assert len(d['instructions'])<=512, len(d['instructions'])
for name in ['work_open','work_update','state','progress_status','work_close']:
    assert name in d['instructions'], (name,d['instructions'])
"
fallback="$(req '{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":"2099-01-01"}}')"
has "$fallback" '"protocolVersion":"2025-11-25"'
legacy="$(req '{"jsonrpc":"2.0","id":3,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}')"
has "$legacy" '"protocolVersion":"2024-11-05"'

listed="$(req '{"jsonrpc":"2.0","id":4,"method":"tools/list","params":{}}')"
python3 -c "
import json
tools=json.loads(r'''$listed''')['result']['tools']; by={t['name']:t for t in tools}
reads=['state','event_history','progress_status']
writes=['spec_reconcile','event_ingest','work_open','work_update','work_close']
for name in reads+writes: assert name in by, name
for name in reads: assert by[name]['annotations']['readOnlyHint'] is True, name
for name in writes: assert by[name]['annotations']['readOnlyHint'] is False, name
assert by['spec_reconcile']['inputSchema']['properties']['repair']['type']=='boolean'
assert by['work_update']['inputSchema']['required']==['revision']
"

# Reconcile is diagnostic until its repair flag is explicit over MCP.
"$CG" spec mode parallel >/dev/null
"$CG" spec start 1.1 >/dev/null
diagnose="$(req '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"spec_reconcile","arguments":{}}}')"
python3 -c "
import json
r=json.loads(r'''$diagnose''')['result']; d=json.loads(r['content'][0]['text'])
assert r['isError'] is False and d['stale']==['1.1'] and d['repaired']==0, (r,d)
"
has "$("$CG" spec status --json)" '"in_progress":1'
repair="$(req '{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"spec_reconcile","arguments":{"repair":true}}}')"
python3 -c "
import json
r=json.loads(r'''$repair''')['result']; d=json.loads(r['content'][0]['text'])
assert r['isError'] is False and d['repaired']==1, (r,d)
"
has "$("$CG" spec status --json)" '"in_progress":0'

echo "22_control protocol ok"
}

case "$mode" in
  state) run_state ;;
  liveness) run_liveness ;;
  integrate) run_integrate ;;
  events) run_events ;;
  progress) run_progress ;;
  work) run_work ;;
  protocol) run_protocol ;;
  all) run_state; run_liveness; run_integrate; run_events; run_progress; run_work; run_protocol ;;
esac
