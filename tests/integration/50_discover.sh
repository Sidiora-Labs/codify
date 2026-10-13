#!/usr/bin/env bash
# cg fleet discover (codify-v15 req 7): native sessions and subagents found
# from the transcripts Claude Code and Codex write, under a temporary HOME
# holding fixture transcripts (tests/fixtures/native): a session with two
# subagents, one with a worktree meta.json, and a Codex rollout. Asserts the
# rows, the parent links, the branch registration, the claim of a pending
# spawn, idempotence, that a hook-written field is never overwritten, the
# stale mark, --json, --since, and the automatic run in fleet status/tree
# under [fleet] discover and --no-discover.
. "$(dirname "$0")/../lib.sh"

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

mkdir -p "$TMP/proj/src" "$TMP/home"
export HOME="$TMP/home"
unset CG_TASK CG_RECAP_CLAUDE_DIR CG_RECAP_CODEX_DIR
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
"$CG" spec add 2.4 --title "Survey work" --wave 1 --touches 'lib/*.ts' \
      --reqs 1.1 >/dev/null
"$CG" init >/dev/null
printf '.codegraph/\n*.lock\n.claude/\n' > .gitignore
git add -A >/dev/null; git commit -qm base >/dev/null
PROJ="$(pwd -P)"
WT="$PROJ/.claude/worktrees/agent-aaa11111"
git worktree add -q -b worktree-agent-aaa11111 "$WT" main >/dev/null 2>&1

SID="d15c0e11-1111-2222-3333-444455556666"
S="claude:d15c0e11"
A="claude:aaa11111"
B="claude:bbb22222"
X="codex:0199c0de"
DB=.codegraph/graph.db
q() { sqlite3 "$DB" "$1"; }

# ---- before any transcript: nothing found, nothing changed
d="$("$CG" fleet discover --json)"
[ "$(echo "$d" | pyjson 'print(len(d["found"]), len(d["changed"]), d["since"])')" = "0 0 86400" ] \
    || fail "empty discovery: $d"

# ---- the hooks that did fire: a pending spawn (PreToolUse Agent, its prompt
#      naming task 2.1) and one subagent's SubagentStart with its own model
hook() { "$CG" hook event --host claude; }
printf '{"hook_event_name":"PreToolUse","session_id":"%s","cwd":"%s","tool_name":"Agent","tool_use_id":"toolu_A","tool_input":{"description":"Alpha implementer","subagent_type":"general-purpose","model":"sonnet","prompt":"Implement task 2.1. Then report."}}' \
       "$SID" "$PROJ" | hook
printf '{"hook_event_name":"SubagentStart","session_id":"%s","cwd":"%s","agent_id":"bbb22222","agent_type":"Explore","model":"hook-model"}' \
       "$SID" "$PROJ" | hook
[ "$(q "SELECT state FROM agents WHERE agent='claude:spawn:toolu_A'")" = pending ] \
    || fail "the pending spawn was not recorded"
[ "$(q "SELECT model,ifnull(description,'-') FROM agents WHERE agent='$B'")" = "hook-model|-" ] \
    || fail "hook row for bbb"

# ---- the transcripts, laid out the way the hosts write them
ENC="$(printf '%s' "$PROJ" | sed 's/[^A-Za-z0-9]/-/g')"
CDIR="$HOME/.claude/projects/$ENC"
mkdir -p "$CDIR" "$HOME/.codex"
cp "$FIXTURES/native/claude/SESSION.jsonl" "$CDIR/$SID.jsonl"
cp -r "$FIXTURES/native/claude/SESSION" "$CDIR/$SID"
cp -r "$FIXTURES/native/codex" "$HOME/.codex/sessions"
find "$CDIR" "$HOME/.codex" -type f | while read -r f; do
    sed -i -e "s|@SID@|$SID|g" -e "s|@PROJ@|$PROJ|g" -e "s|@WT@|$WT|g" "$f"
    touch "$f"
done

# ---- discovery: four agents found, the other project's rollout ignored
d="$("$CG" fleet discover --json)"
echo "$d" | pyjson '
found = sorted(f["agent"] for f in d["found"])
assert found == ["claude:aaa11111", "claude:bbb22222", "claude:d15c0e11", "codex:0199c0de"], found
kinds = {f["agent"]: (f["host"], f["kind"]) for f in d["found"]}
assert kinds["claude:d15c0e11"] == ("claude", "session"), kinds
assert kinds["claude:aaa11111"] == ("claude", "subagent"), kinds
assert kinds["codex:0199c0de"] == ("codex", "session"), kinds
assert all(not f["stale"] and f["mtime"] > 0 and f["transcript"] for f in d["found"]), d["found"]
ch = {c["agent"]: c for c in d["changed"]}
assert ch["claude:aaa11111"]["created"] is True, ch
assert ch["claude:aaa11111"]["claimed"] == "claude:spawn:toolu_A", ch
assert ch["codex:0199c0de"]["created"] is True, ch
assert ch["claude:d15c0e11"]["created"] is False, ch          # the hook made it
assert {"model", "transcript"} <= set(ch["claude:d15c0e11"]["fields"]), ch
assert ch["claude:bbb22222"]["created"] is False, ch
assert "description" in ch["claude:bbb22222"]["fields"], ch
assert "model" not in ch["claude:bbb22222"]["fields"], ch
' || fail "discover --json: $d"

# the session: completed from its transcript
row="$(q "SELECT kind,host_kind,session,cwd,model,branch,transcript FROM agents WHERE agent='$S'")"
[ "$row" = "native|claude|$SID|$PROJ|claude-opus-4-1|main|$CDIR/$SID.jsonl" ] || fail "session row: $row"

# the worktree subagent: claimed the pending spawn, parent the session,
# worktree and branch from its meta.json, registered with base main
row="$(q "SELECT kind,parent,agent_id,agent_type,description,model,depth,state,worktree,branch,task,task_source FROM agents WHERE agent='$A'")"
[ "$row" = "native|$S|aaa11111|general-purpose|Alpha implementer|sonnet|1|live|$WT|worktree-agent-aaa11111|nat/2.1|prompt" ] \
    || fail "worktree subagent row: $row"
[ "$(q "SELECT count(*) FROM agents WHERE agent LIKE 'claude:spawn:%'")" = 0 ] \
    || fail "the claimed spawn is still there"
row="$(q "SELECT worktree,base FROM branches WHERE name='worktree-agent-aaa11111'")"
[ "$row" = "$WT|main" ] || fail "branch registration: $row"
has "$("$CG" branches)" "worktree-agent-aaa11111"
[ "$(q "SELECT transcript FROM agents WHERE agent='$A'")" = "$CDIR/$SID/subagents/agent-aaa11111.jsonl" ] \
    || fail "subagent transcript"

# the hook-made subagent: completed, its hook-written model kept, the task
# read from its first prompt
row="$(q "SELECT parent,agent_type,description,model,cwd,task,task_source FROM agents WHERE agent='$B'")"
[ "$row" = "$S|Explore|Survey the tree|hook-model|$PROJ|nat/2.4|prompt" ] \
    || fail "hook-written field overwritten or row incomplete: $row"
disc="$(q "SELECT discovered FROM agents WHERE agent='$B'")"
has ",$disc," ",description,"
hasnt ",$disc," ",model,"
hasnt ",$disc," ",row,"
has ",$(q "SELECT discovered FROM agents WHERE agent='$A'")," ",row,"

# the Codex rollout
row="$(q "SELECT host_kind,session,cwd,model,branch,depth FROM agents WHERE agent='$X'")"
[ "$row" = "codex|0199c0de-7777-7000-8000-000000000001|$PROJ|gpt-5-codex|main|0" ] \
    || fail "codex row: $row"
[ "$(q "SELECT count(*) FROM agents WHERE agent LIKE 'codex:%'")" = 1 ] \
    || fail "a rollout of another project was recorded"

# discovered rows announce themselves like hook rows do
n="$(q "SELECT count(*) FROM events WHERE kind='agent.native.start' AND json_extract(payload,'\$.source')='discover'")"
[ "$n" = 2 ] || fail "agent.native.start for discovered rows: $n"

# ---- idempotence: a second run changes nothing
before="$(q "SELECT group_concat(agent||state||ifnull(model,'')||ifnull(task,''),';') FROM (SELECT * FROM agents ORDER BY agent)")"
d="$("$CG" fleet discover --json)"
[ "$(echo "$d" | pyjson 'print(len(d["found"]), len(d["changed"]))')" = "4 0" ] \
    || fail "second discovery changed something: $d"
after="$(q "SELECT group_concat(agent||state||ifnull(model,'')||ifnull(task,''),';') FROM (SELECT * FROM agents ORDER BY agent)")"
[ "$before" = "$after" ] || fail "rows moved on a second run"
out="$("$CG" fleet discover)"
has "$out" "discovered 4 agents from transcripts (3 claude, 1 codex), 0 changed"

# ---- the stale mark: a transcript untouched for 15 minutes
old="$(date -d '-20 minutes' +%Y%m%d%H%M.%S)"
touch -t "$old" "$CDIR/$SID/subagents/agent-aaa11111.jsonl" \
                "$CDIR/$SID/subagents/agent-aaa11111.meta.json"
q "UPDATE agents SET seen=strftime('%s','now')-1200 WHERE agent='$A'"
d="$("$CG" fleet discover --json)"
echo "$d" | pyjson '
ch = {c["agent"]: c for c in d["changed"]}
assert ch["claude:aaa11111"]["state"] == "stale", ch
f = [x for x in d["found"] if x["agent"] == "claude:aaa11111"][0]
assert f["stale"] is True, f
assert "claude:bbb22222" not in ch, ch                 # its hook is recent
' || fail "stale mark: $d"
[ "$(q "SELECT state FROM agents WHERE agent='$A'")" = stale ] || fail "state not stale"
has "$("$CG" fleet status --no-discover)" "claude:aaa11111 [general-purpose]  stale"
# the transcript moves again: live
touch "$CDIR/$SID/subagents/agent-aaa11111.jsonl"
d="$("$CG" fleet discover --json)"
[ "$(echo "$d" | pyjson 'print([c.get("state") for c in d["changed"] if c["agent"]=="claude:aaa11111"])')" = "['live']" ] \
    || fail "stale agent not revived: $d"
# a hook's row goes stale only when its last hook is old too
q "UPDATE agents SET seen=strftime('%s','now')-1200 WHERE agent='$B'"
touch -t "$old" "$CDIR/$SID/subagents/agent-bbb22222.jsonl" \
                "$CDIR/$SID/subagents/agent-bbb22222.meta.json"
out="$("$CG" fleet discover)"
has "$out" "~ $B  now stale"
[ "$(q "SELECT state FROM agents WHERE agent='$B'")" = stale ] || fail "hook row not marked stale"
printf '{"hook_event_name":"PostToolUse","session_id":"%s","cwd":"%s","agent_id":"bbb22222","agent_type":"Explore","tool_name":"Read","tool_use_id":"toolu_C"}' \
       "$SID" "$PROJ" | hook
[ "$(q "SELECT state FROM agents WHERE agent='$B'")" = live ] || fail "a hook did not revive the row"

# ---- --since: an old session is outside the default window, inside a wider one
OLD="0ld5e551-0000-0000-0000-000000000000"
sed "s|$SID|$OLD|g" "$CDIR/$SID.jsonl" > "$CDIR/$OLD.jsonl"
touch -t "$(date -d '-3 days' +%Y%m%d%H%M.%S)" "$CDIR/$OLD.jsonl"
"$CG" fleet discover >/dev/null
[ "$(q "SELECT count(*) FROM agents WHERE agent='claude:0ld5e551'")" = 0 ] \
    || fail "a 3-day-old session found within 24h"
d="$("$CG" fleet discover --since 4d --json)"
[ "$(echo "$d" | pyjson 'print(d["since"], [c["state"] for c in d["changed"] if c["agent"]=="claude:0ld5e551"])')" = "345600 ['stale']" ] \
    || fail "--since 4d: $d"
expect_rc 1 "$CG" fleet discover --since soon

# ---- the automatic run: fleet status and tree discover first, unless
#      --no-discover or [fleet] discover = false
mkdir -p "$CDIR/$SID/subagents"
sed -e 's/bbb22222/ccc33333/g' "$CDIR/$SID/subagents/agent-bbb22222.jsonl" \
    > "$CDIR/$SID/subagents/agent-ccc33333.jsonl"
"$CG" fleet status --no-discover >/dev/null
[ "$(q "SELECT count(*) FROM agents WHERE agent='claude:ccc33333'")" = 0 ] \
    || fail "--no-discover still discovered"
"$CG" config set fleet.discover false >/dev/null
"$CG" fleet status >/dev/null
"$CG" fleet tree --json >/dev/null
[ "$(q "SELECT count(*) FROM agents WHERE agent='claude:ccc33333'")" = 0 ] \
    || fail "[fleet] discover = false still discovered"
"$CG" config set fleet.discover true >/dev/null
t="$("$CG" fleet tree --json)"
[ "$(q "SELECT parent FROM agents WHERE agent='claude:ccc33333'")" = "$S" ] \
    || fail "fleet tree did not discover the new subagent"
echo "$t" | pyjson '
nat = {n["agent"]: n for n in d["native"]}
s = nat["claude:d15c0e11"]
kids = sorted(c["agent"] for c in s["children"])
assert kids == ["claude:aaa11111", "claude:bbb22222", "claude:ccc33333"], kids
assert "codex:0199c0de" in nat, nat.keys()
a = [c for c in s["children"] if c["agent"] == "claude:aaa11111"][0]
assert a["worktree"].endswith("agent-aaa11111") and a["branch"] == "worktree-agent-aaa11111", a
' || fail "fleet tree --json native: $t"
out="$("$CG" fleet status)"
has "$out" "native sessions:"
has "$out" "codex:0199c0de"
has "$out" "claude:ccc33333"

# ---- recap's lookup is the same helper: CG_RECAP_CLAUDE_DIR moves discovery too
mkdir -p "$TMP/elsewhere"
cp "$CDIR/$SID.jsonl" "$TMP/elsewhere/feedf00d-0000-0000-0000-000000000000.jsonl"
CG_RECAP_CLAUDE_DIR="$TMP/elsewhere" "$CG" fleet discover >/dev/null
[ "$(q "SELECT count(*) FROM agents WHERE agent='claude:feedf00d'")" = 1 ] \
    || fail "discovery does not share recap's transcript lookup"

echo "PASS 50_discover"
