#!/usr/bin/env bash
# shell advice (codify-v15 req 4): cg hook pre-bash reads a PreToolUse
# payload and, when the Bash command is a shell search over the tree, answers
# with the cg equivalent as additionalContext, never a permission decision,
# once per session per command, silent under the opt-outs, outside the tree,
# and for payloads that are not Bash or do not parse. The guidance strings
# (skill, agent context, MCP tools and prompts) and the hook registrations
# name grep_code, find_files, search_code, get_context, cg grep, cg files.
. "$(dirname "$0")/../lib.sh"

pyjson() { python3 -c "import json,sys; d=json.load(sys.stdin); $1"; }

mkdir -p "$TMP/proj/src/sub" "$TMP/home"
export HOME="$TMP/home"
cd "$TMP/proj"
git init -q . 2>/dev/null
echo 'int foo(void){return 1;}' > src/a.c
echo 'int bar(void){return foo();}' > src/sub/b.c
"$CG" init >/dev/null
PROJ="$(pwd -P)"

# payload <session> <command> [cwd] [tool]
payload() {
    python3 -c 'import json,sys
print(json.dumps({"session_id": sys.argv[1], "cwd": sys.argv[3],
  "hook_event_name": "PreToolUse", "tool_name": sys.argv[4],
  "tool_use_id": "t1", "tool_input": {"command": sys.argv[2]}}))' \
      "$1" "$2" "${3:-$PROJ}" "${4:-Bash}"
}
# pre <session> <command> [cwd]  -> the additionalContext, "" when silent;
# asserts exit 0, one JSON object, no permission decision
pre() {
    local out rc=0
    out="$(payload "$@" | "$CG" hook pre-bash)" || rc=$?
    [ "$rc" -eq 0 ] || fail "pre-bash exited $rc for: $2"
    [ -z "$out" ] && return 0
    printf '%s' "$out" | pyjson '
assert list(d) == ["hookSpecificOutput"], d
h = d["hookSpecificOutput"]
assert h["hookEventName"] == "PreToolUse", h
assert "permissionDecision" not in h and "decision" not in d, d
print(h["additionalContext"])' || fail "not one clean JSON object: $out"
    case "$out" in *ermissionDecision*) fail "permission decision: $out";; esac
}

# rg over the tree
out="$(pre s1 'rg foo')"
has "$out" "cg grep foo"
has "$out" "grep_code"
has "$out" "Why:"

# grep -rn with a directory: the path carried as --path
out="$(pre s1 'grep -rn foo src')"
has "$out" "cg grep foo --path src"

# -i and the path both carried
out="$(pre s1 'grep -rni Foo src/sub')"
has "$out" "cg grep -i Foo --path src/sub"

# find -name -> cg files
out="$(pre s1 "find . -name '*.c'")"
has "$out" "cg files '*.c'"
has "$out" "find_files"

# find with a directory
out="$(pre s1 "find src -name '*.c' -type f")"
has "$out" "cg files '*.c' --path src"

# a piped grep: filtering a file list is cg files
out="$(pre s1 "find . -name '*.c' | grep sub")"
has "$out" "cg files sub"

# a grep fed by xargs over find's files, and a grep after cat
out="$(pre s1 "find src -name '*.c' | xargs grep -n foo")"
has "$out" "cg grep foo --path 'src/**/*.c'"
out="$(pre s1 'cat src/a.c | grep -i foo')"
has "$out" "cg grep -i foo --path src/a.c"

# after && and ; with cd moving the directory, redirections ignored
out="$(pre s1 'cd src && grep -rn "foo(" . 2>/dev/null | head -5')"
has "$out" "cg grep 'foo(' --path src"
out="$(pre s1 'echo start; ack bar src/sub')"
has "$out" "cg grep bar --path src/sub"

# ls -R and fd
out="$(pre s1 'ls -R src')"
has "$out" "cg files --dirs src"
out="$(pre s1 'fd -e c . src')"
has "$out" "cg files"
has "$out" "--path src"

# a regex stays a regex
out="$(pre s1 'rg -i "fo+o" src')"
has "$out" "cg grep -E -i fo+o --path src"

# once per session: the identical command is silent the second time,
# another session hears it again
out="$(pre s1 'rg foo')"
[ -z "$out" ] || fail "second identical command was not silent: $out"
out="$(pre s2 'rg foo')"
has "$out" "cg grep foo"

# a path outside the tree is silent
out="$(pre s3 'grep -rn foo /etc')"
[ -z "$out" ] || fail "outside path advised: $out"
out="$(pre s3 'grep -rn foo ../..')"
[ -z "$out" ] || fail "outside relative path advised: $out"
out="$(pre s3 'rg foo' /tmp)"
[ -z "$out" ] || fail "cwd outside the tree advised: $out"

# a pipe filtering some other command's output is not a tree search
out="$(pre s3 'git log | grep fix')"
[ -z "$out" ] || fail "git log | grep advised: $out"
out="$(pre s3 'echo hi')"
[ -z "$out" ] || fail "echo advised: $out"

# CG_SHELL_ADVICE=0
out="$(payload s4 'rg foo' | CG_SHELL_ADVICE=0 "$CG" hook pre-bash)"
[ -z "$out" ] || fail "CG_SHELL_ADVICE=0 not silent: $out"

# a non-Bash payload, an unreadable payload, an empty pipe: silent, exit 0
out="$(payload s4 'rg foo' "$PROJ" Edit | "$CG" hook pre-bash)"
[ -z "$out" ] || fail "non-Bash payload advised: $out"
out="$(printf 'garbage{' | "$CG" hook pre-bash)"
[ -z "$out" ] || fail "unreadable payload advised: $out"
out="$("$CG" hook pre-bash </dev/null)"
[ -z "$out" ] || fail "empty payload advised: $out"

# [hooks] shell_advice = false
printf '[hooks]\nshell_advice = false\n' > codify.kvx
out="$(pre s5 'rg foo')"
[ -z "$out" ] || fail "[hooks] shell_advice = false not silent: $out"
out="$("$CG" config get hooks.shell_advice 2>&1 || true)"
has "$out" "false"
rm codify.kvx
out="$(pre s5 'rg foo')"
has "$out" "cg grep foo"
"$CG" config init >/dev/null
has "$(cat hyperfide.kvx 2>/dev/null || cat codify.kvx)" "shell_advice"   # hyperfide.kvx since 26.3
rm -f hyperfide.kvx codify.kvx

# outside any project: silent and exit 0
mkdir -p "$TMP/elsewhere"
out="$(cd "$TMP/elsewhere" && payload s6 'rg foo' "$TMP/elsewhere" | "$CG" hook pre-bash)"
[ -z "$out" ] || fail "outside a project advised: $out"

# cg hook install registers PreToolUse Bash -> cg hook pre-bash
"$CG" hook install >/dev/null
pyjson '
pre = d["hooks"]["PreToolUse"]
assert any(e["matcher"] == "Bash" and
           any(h["command"].endswith("hook pre-bash") for h in e["hooks"])
           for e in pre), pre
assert d["hooks"]["PostToolUse"], d' < .claude/settings.json \
    || fail "hook install did not register the Bash PreToolUse entry"

# the guidance: skill, agent context, MCP tool descriptions and prompts
skill="$(cat .agents/skills/codify/SKILL.md 2>/dev/null || find . -name SKILL.md -path '*codify*' -exec cat {} +)"
# the generated guidance spells the canonical `hyperfide grep` since the
# spec/hyperfide 26.x rename; the legacy `cg grep` is still accepted
for w in grep_code find_files search_code get_context; do
    has "$skill" "$w"
done
has_any "$skill" "cg grep" "hyperfide grep"
has_any "$skill" "cg files" "hyperfide files"
"$CG" agentmd >/dev/null
ctx="$(cat .codify/agent-context.md)"
for w in grep_code find_files search_code get_context; do
    has "$ctx" "$w"
done
has_any "$ctx" "cg grep" "hyperfide grep"
has_any "$ctx" "cg files" "hyperfide files"
mcp="$(printf '%s\n' \
  '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' \
  '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
  '{"jsonrpc":"2.0","id":3,"method":"prompts/get","params":{"name":"orient"}}' \
  '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"start-work"}}' \
  | "$CG" mcp 2>/dev/null)"
printf '%s\n' "$mcp" | python3 -c '
import json, sys
by = {}
for line in sys.stdin:
    line = line.strip()
    if line.startswith("{"):
        m = json.loads(line); by[m.get("id")] = m
tools = {t["name"]: t["description"] for t in by[2]["result"]["tools"]}
for n in ("search_code", "get_context", "grep_code", "find_files"):
    d = tools[n]
    assert "shell" in d, (n, d)
for pid in (3, 4):
    txt = json.dumps(by[pid])
    for w in ("grep_code", "find_files", "search_code", "get_context",
              ("cg grep", "hyperfide grep"), ("cg files", "hyperfide files")):
        alts = (w,) if isinstance(w, str) else w
        assert any(a in txt for a in alts), (pid, w)
' || fail "MCP tool descriptions or prompts lack the graph-first guidance"

echo "ok 47_advice"
