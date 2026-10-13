#!/usr/bin/env bash
# native agents (codify-v15 req 6): cg hook event --host claude records the
# host's own sessions and the subagents they spawn through the Agent tool in
# the agents registry, with their worktree (a real linked worktree here),
# branch registration, task attribution, agent.native.* events, the fleet
# status tree, fleet tree --json, the brief and state lines, the runtime
# event pass-through, the schema upgrade of an old agents table, and exit 0
# on a malformed payload.
. "$(dirname "$0")/../lib.sh"

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

mkdir -p "$TMP/proj/src" "$TMP/home"
export HOME="$TMP/home"
cd "$TMP/proj"
git init -q -b main . 2>/dev/null || git init -q .
git config user.email t@t; git config user.name t
echo 'export function alpha(){}' > src/a.ts
"$CG" spec new nat >/dev/null
"$CG" spec start 1.1 >/dev/null
"$CG" spec done 1.1 >/dev/null
"$CG" spec mode parallel >/dev/null
"$CG" spec add 2.1 --title "Alpha work" --wave 1 --touches 'src/*.ts' \
      --reqs 1.1 >/dev/null
"$CG" spec add 2.4 --title "Other work" --wave 1 --touches 'lib/*.ts' \
      --reqs 1.1 >/dev/null
"$CG" init >/dev/null
printf '.codegraph/\n*.lock\n.claude/\n' > .gitignore
git add -A >/dev/null; git commit -qm base >/dev/null
PROJ="$(pwd -P)"

# the worktree a native subagent works in, the way Claude Code makes them
WT="$PROJ/.claude/worktrees/agent-a1b2c3d4"
git worktree add -q -b worktree-agent-a1b2c3d4 "$WT" main >/dev/null 2>&1

SID="5e55105a-1111-2222-3333-444455556666"
S="claude:5e55105a"
A="claude:a1b2c3d4"
TP="$HOME/.claude/projects/x/$SID.jsonl"
hook() { "$CG" hook event --host claude "$@"; }

# ---- the schema: v18 agents columns on a fresh database
cols="$(sqlite3 .codegraph/graph.db "SELECT group_concat(name) FROM pragma_table_info('agents')")"
for c in kind host_kind agent_id agent_type description model depth state \
         started ended transcript cwd task task_source last_tool tool_calls; do
    has ",$cols," ",$c,"
done

# ---- SessionStart: the session agent, live, with its model
out="$(printf '{"hook_event_name":"SessionStart","session_id":"%s","transcript_path":"%s","cwd":"%s","source":"startup","model":"claude-opus-4-1"}' \
      "$SID" "$TP" "$PROJ" | hook --json)"
has "$out" "\"agent\":\"$S\""
row="$(sqlite3 .codegraph/graph.db "SELECT kind,host_kind,session,cwd,model,state,depth,branch,started>0 FROM agents WHERE agent='$S'")"
[ "$row" = "native|claude|$SID|$PROJ|claude-opus-4-1|live|0|main|1" ] || fail "session row: $row"

# ---- PreToolUse Agent: a pending spawn whose prompt names task 2.1
printf '{"hook_event_name":"PreToolUse","session_id":"%s","transcript_path":"%s","cwd":"%s","tool_name":"Agent","tool_use_id":"toolu_01","tool_input":{"description":"Alpha implementer","subagent_type":"general-purpose","model":"sonnet","isolation":"worktree","run_in_background":true,"prompt":"Implement task 2.1 of the active feature. Then report."}}' \
      "$SID" "$TP" "$PROJ" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT state,parent,agent_type,description,model,task,task_source FROM agents WHERE agent='claude:spawn:toolu_01'")"
[ "$row" = "pending|$S|general-purpose|Alpha implementer|sonnet|nat/2.1|prompt" ] || fail "pending spawn: $row"

# ---- SubagentStart: claims the pending spawn of its type in the session
printf '{"hook_event_name":"SubagentStart","session_id":"%s","transcript_path":"%s","cwd":"%s","agent_id":"a1b2c3d4","agent_type":"general-purpose"}' \
      "$SID" "$TP" "$WT" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT kind,parent,agent_id,agent_type,description,model,depth,state,task,task_source FROM agents WHERE agent='$A'")"
[ "$row" = "native|$S|a1b2c3d4|general-purpose|Alpha implementer|sonnet|1|live|nat/2.1|prompt" ] \
    || fail "subagent row: $row"
n="$(sqlite3 .codegraph/graph.db "SELECT count(*) FROM agents WHERE state='pending'")"
[ "$n" = 0 ] || fail "the claimed spawn is still pending"

# ---- PostToolUse inside the subagent, cwd in the linked worktree
printf '{"hook_event_name":"PostToolUse","session_id":"%s","transcript_path":"%s","cwd":"%s","agent_id":"a1b2c3d4","agent_type":"general-purpose","tool_name":"Edit","tool_use_id":"toolu_02","tool_input":{"file_path":"%s/src/a.ts"}}' \
      "$SID" "$TP" "$WT" "$WT" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT worktree,branch,last_tool,tool_calls FROM agents WHERE agent='$A'")"
[ "$row" = "$WT|worktree-agent-a1b2c3d4|Edit|1" ] || fail "subagent heartbeat: $row"
row="$(sqlite3 .codegraph/graph.db "SELECT worktree,base FROM branches WHERE name='worktree-agent-a1b2c3d4'")"
[ "$row" = "$WT|main" ] || fail "branch registration: $row"
out="$("$CG" branches)"
has "$out" "worktree-agent-a1b2c3d4"

# ---- the fleet views while it runs
out="$("$CG" fleet status)"
has "$out" "native sessions:"
has "$out" "  $S  live"
has "$out" "    $A [general-purpose]  live"
has "$out" "model sonnet  branch worktree-agent-a1b2c3d4 (worktree)  task nat/2.1 (prompt)"
has "$out" "last Edit"
hasnt "$out" "(no CG_ROLE)"
"$CG" fleet status --json | pyjson '
n = d["native"]; assert len(n) == 1, n
s = n[0]; assert s["agent"] == "'"$S"'" and s["host"] == "claude", s
assert s["state"] == "live" and s["model"] == "claude-opus-4-1", s
c = s["children"]; assert len(c) == 1, c
a = c[0]
assert a["agent"] == "'"$A"'" and a["agent_type"] == "general-purpose", a
assert a["worktree"] == "'"$WT"'" and a["branch"] == "worktree-agent-a1b2c3d4", a
assert a["task"] == "nat/2.1" and a["task_source"] == "prompt", a
assert a["description"] == "Alpha implementer" and a["last_tool"] == "Edit", a
' || fail "fleet status --json native"
# no [hierarchy]: the tree still answers with the native agents
"$CG" fleet tree --json | pyjson '
assert d["hierarchy"] is False, d
s = d["native"][0]
for k in ("agent","host","session","model","started","state","seen","cwd",
          "worktree","branch","task","task_source","description","agent_type",
          "children"):
    assert k in s, k
assert s["session"] == "'"$SID"'", s
assert s["children"][0]["agent"] == "'"$A"'", s
' || fail "fleet tree --json native"
out="$("$CG" brief)"
has "$out" "native agents: 1 live, 1 subagent, 1 worktree branch"
"$CG" brief --json | pyjson '
assert d["native"] == {"live": 1, "subagents": 1, "worktree_branches": 1}, d["native"]
' || fail "brief --json native"
out="$("$CG" state)"
has "$out" "native agents: 1 live, 1 subagent, 1 worktree branch"

# ---- SubagentStop and Stop
printf '{"hook_event_name":"SubagentStop","session_id":"%s","transcript_path":"%s","cwd":"%s","agent_id":"a1b2c3d4","agent_type":"general-purpose","agent_transcript_path":"%s/x/subagents/agent-a1b2c3d4.jsonl","last_assistant_message":"Task 2.1 is implemented and verified."}' \
      "$SID" "$TP" "$WT" "$HOME" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT state,ended>0,transcript FROM agents WHERE agent='$A'")"
[ "$row" = "stopped|1|$HOME/x/subagents/agent-a1b2c3d4.jsonl" ] || fail "subagent stop: $row"
printf '{"hook_event_name":"Stop","session_id":"%s","transcript_path":"%s","cwd":"%s"}' \
      "$SID" "$TP" "$PROJ" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT state,ended>0 FROM agents WHERE agent='$S'")"
[ "$row" = "stopped|1" ] || fail "session stop: $row"
out="$("$CG" brief)"
has "$out" "native agents: 0 live, 0 subagents, 1 worktree branch"

# ---- the events: node the agent, subject the task when known
out="$("$CG" events --kind agent.native.start,agent.native.spawn,agent.native.tool,agent.native.stop --json -n 50)"
echo "$out" | python3 -c '
import json, sys
rows = [json.loads(l) for l in sys.stdin if l.strip()]
if len(rows) == 1 and isinstance(rows[0], dict) and "events" in rows[0]:
    rows = rows[0]["events"]
kinds = [(r["kind"], r.get("node"), r.get("subject")) for r in rows]
S, A = "'"$S"'", "'"$A"'"
assert ("agent.native.start", S, None) in kinds, kinds
assert ("agent.native.spawn", S, "nat/2.1") in kinds, kinds
assert ("agent.native.start", A, "nat/2.1") in kinds, kinds
assert ("agent.native.tool", A, "nat/2.1") in kinds, kinds
assert ("agent.native.stop", A, "nat/2.1") in kinds, kinds
assert ("agent.native.stop", S, None) in kinds, kinds
for r in rows:
    p = r["payload"] if isinstance(r["payload"], dict) else json.loads(r["payload"])
    if r["kind"] == "agent.native.spawn":
        assert p["tool_use_id"] == "toolu_01" and p["isolation"] == "worktree", p
        assert p["run_in_background"] is True and p["prompt"].startswith("Implement task 2.1"), p
    if r["kind"] == "agent.native.start" and r["node"] == A:
        assert p["parent"] == S and p["tool_use_id"] == "toolu_01", p
        assert p["prompt"].startswith("Implement task 2.1"), p
    if r["kind"] == "agent.native.stop" and r["node"] == A:
        assert p["last_message"] == "Task 2.1 is implemented and verified.", p
' || fail "agent.native.* events"

# ---- the runtime normalization still sees every payload
out="$("$CG" event history -n 50 --json)"
echo "$out" | python3 -c '
import json, sys
d = json.load(sys.stdin)
ev = [e for e in d["events"] if e["source"] == "claude"]
kinds = {e["kind"] for e in ev}
assert len(ev) >= 6, ev
assert all(e["session"] == "'"$SID"'" for e in ev), ev
' || fail "runtime events from the hook"

# ---- meta.json names the spawn: matched by tool_use_id, not by type order
SID2="77777777-aaaa-bbbb-cccc-dddddddddddd"
TP2="$HOME/.claude/projects/y/$SID2.jsonl"
mkdir -p "$HOME/.claude/projects/y/$SID2/subagents"
for t in toolu_A toolu_B; do
    printf '{"hook_event_name":"PreToolUse","session_id":"%s","transcript_path":"%s","cwd":"%s","tool_name":"Task","tool_use_id":"%s","tool_input":{"description":"spawn %s","subagent_type":"Explore","prompt":"look around [spec:nat/2.4]"}}' \
        "$SID2" "$TP2" "$PROJ" "$t" "$t" | hook
done
printf '{"agentType":"Explore","toolUseId":"toolu_B","description":"spawn toolu_B","spawnDepth":1}' \
    > "$HOME/.claude/projects/y/$SID2/subagents/agent-bbbb.meta.json"
printf '{"hook_event_name":"SubagentStart","session_id":"%s","transcript_path":"%s","cwd":"%s","agent_id":"bbbb","agent_type":"Explore"}' \
    "$SID2" "$TP2" "$PROJ" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT description,task,task_source,parent FROM agents WHERE agent='claude:bbbb'")"
[ "$row" = "spawn toolu_B|nat/2.4|prompt|claude:77777777" ] || fail "tool_use_id match: $row"
n="$(sqlite3 .codegraph/graph.db "SELECT agent FROM agents WHERE state='pending'")"
[ "$n" = "claude:spawn:toolu_A" ] || fail "toolu_A should still be pending: $n"

# ---- CG_TASK wins; a subagent without a task of its own takes its parent's
SID3="33333333-0000-0000-0000-000000000000"
printf '{"hook_event_name":"SessionStart","session_id":"%s","cwd":"%s"}' "$SID3" "$PROJ" \
    | CG_TASK=nat/2.4 hook
row="$(sqlite3 .codegraph/graph.db "SELECT task,task_source FROM agents WHERE agent='claude:33333333'")"
[ "$row" = "nat/2.4|env" ] || fail "env attribution: $row"
printf '{"hook_event_name":"SubagentStart","session_id":"%s","cwd":"%s","agent_id":"cccc","agent_type":"Plan"}' "$SID3" "$PROJ" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT task,task_source FROM agents WHERE agent='claude:cccc'")"
[ "$row" = "nat/2.4|parent" ] || fail "parent attribution: $row"

# ---- a live attempt of the session names the task
SID4="44444444-0000-0000-0000-000000000000"
"$CG" spec claim 2.4 --agent w4 --session "$SID4" >/dev/null
printf '{"hook_event_name":"SessionStart","session_id":"%s","cwd":"%s"}' "$SID4" "$PROJ" | hook
row="$(sqlite3 .codegraph/graph.db "SELECT task_source FROM agents WHERE agent='claude:44444444'")"
[ "$row" = "attempt" ] || fail "attempt attribution: $row"

# ---- codex: the same family under its own names
printf '{"hook_event_name":"SessionStart","session_id":"c0dec0de-9999","cwd":"%s"}' "$PROJ" \
    | "$CG" hook event --host codex
n="$(sqlite3 .codegraph/graph.db "SELECT host_kind FROM agents WHERE agent='codex:c0dec0de'")"
[ "$n" = codex ] || fail "codex session: $n"

# ---- a malformed payload exits 0, is logged, and records nothing
before="$(sqlite3 .codegraph/graph.db "SELECT count(*) FROM agents")"
rc=0; printf '{"hook_event_name":"SessionStart","session_id":"trunc' | hook 2>/dev/null || rc=$?
[ "$rc" = 0 ] || fail "malformed payload exit $rc"
rc=0; printf 'not json at all' | hook 2>/dev/null || rc=$?
[ "$rc" = 0 ] || fail "garbage payload exit $rc"
rc=0; hook </dev/null || rc=$?
[ "$rc" = 0 ] || fail "empty payload exit $rc"
after="$(sqlite3 .codegraph/graph.db "SELECT count(*) FROM agents")"
[ "$before" = "$after" ] || fail "malformed payload wrote rows"
has "$(cat .codegraph/hooks.log)" "malformed payload"
# outside any project the hook is a silent success
rc=0; (cd "$TMP/home" && printf '{"hook_event_name":"Stop","session_id":"x"}' \
       | "$CG" hook event --host claude) || rc=$?
[ "$rc" = 0 ] || fail "hook outside a project exit $rc"

# ---- a session stopped more than a day ago is hidden unless --all
sqlite3 .codegraph/graph.db "UPDATE agents SET ended=strftime('%s','now')-200000, seen=strftime('%s','now')-200000 WHERE agent='$S' OR parent='$S'"
out="$("$CG" fleet status)"
hasnt "$out" "$S"
out="$("$CG" fleet status --all)"
has "$out" "$S"
has "$out" "$A"
"$CG" fleet tree --json | pyjson '
assert all(s["agent"] != "'"$S"'" for s in d["native"]), d["native"]
' || fail "tree hides the old session"

# ---- staleness: live, but no hook for more than 120 s
sqlite3 .codegraph/graph.db "UPDATE agents SET seen=strftime('%s','now')-300 WHERE agent='claude:77777777'"
out="$("$CG" fleet status)"
has "$out" "  claude:77777777  stale"

# ---- the upgrade keeps an old agents table's rows and adds the columns
mkdir -p "$TMP/old" && cd "$TMP/old"
git init -q -b main . 2>/dev/null || git init -q .
echo 'x' > a.txt
"$CG" init >/dev/null
db=.codegraph/graph.db
sqlite3 "$db" "DROP TABLE agents; CREATE TABLE agents(agent TEXT PRIMARY KEY, role TEXT, parent TEXT, feature TEXT, wave INTEGER, host TEXT, session TEXT, branch TEXT, worktree TEXT, base TEXT, seen INTEGER NOT NULL); INSERT INTO agents(agent,role,seen) VALUES('gideon','main',1); UPDATE meta SET value='17' WHERE key='schema_version'"
"$CG" fleet status >/dev/null 2>&1
row="$(sqlite3 "$db" "SELECT agent,role FROM agents")"
[ "$row" = "gideon|main" ] || fail "upgrade lost the agents rows: $row"
cols="$(sqlite3 "$db" "SELECT group_concat(name) FROM pragma_table_info('agents')")"
has "$cols" "task_source"
has "$cols" "tool_calls"
[ "$(sqlite3 "$db" "SELECT value FROM meta WHERE key='schema_version'")" = 18 ] || fail "schema version"

echo "ok 49_native"
