#!/usr/bin/env bash
# The Claude Code plugin and the Codex hooks that cg integrate apply writes,
# under a temporary HOME (req 5.5). The claude CLI is a stub here, so the
# install path is exercised without touching a real Claude Code; the real
# one, when present, only validates the rendered tree.
. "$(dirname "$0")/../lib.sh"

REAL_CLAUDE="$(command -v claude || true)"
export HOME="$TMP/home"
mkdir -p "$HOME" "$TMP/proj/src" "$TMP/bin"
cd "$TMP/proj"
echo 'int main(void){return 0;}' > src/main.c
"$CG" init >/dev/null

ROOT="$HOME/.codify/plugins/claude-code"
P="$ROOT/plugins/codify"
CGPATH="$(readlink -f "$CG")"
VERSION="$("$CG" --version | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -1)"
[ -n "$VERSION" ] || fail "no version from cg --version"

# ---- --no-plugin writes nothing of the plugin or the Codex hooks
CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply --no-plugin \
    >/dev/null || true
[ ! -e "$HOME/.codify/plugins" ] || fail "--no-plugin rendered the plugin"
[ ! -e .codex/hooks.json ] || fail "--no-plugin wrote the Codex hooks"
out="$(CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply \
       --no-plugin --json)"
has "$out" '"plugin":{"result":"skipped"}'

# ---- without claude on PATH: the tree is rendered, the commands printed
out="$(CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply)"
has "$out" "claude is not on PATH"
has "$out" "claude plugin marketplace add"
has "$out" "claude plugin install codify@codify --scope user"
has "$out" "trust them once in Codex through /hooks"

for f in "$ROOT/.claude-plugin/marketplace.json" \
         "$P/.claude-plugin/plugin.json" "$P/hooks/hooks.json" \
         "$P/.mcp.json" "$P/skills/codify-workflow/SKILL.md" \
         "$P/commands/brief.md" "$P/commands/fleet.md" \
         "$P/commands/projection.md" .codex/hooks.json; do
    [ -s "$f" ] || fail "not rendered: $f"
    has "$(cat "$f")" "codify-owned:"
done
has "$(cat "$P/commands/brief.md")" "$CGPATH brief"
has "$(cat "$P/commands/fleet.md")" "$CGPATH fleet status"
has "$(cat "$P/commands/projection.md")" "$CGPATH projection status"
has "$(cat "$P/skills/codify-workflow/SKILL.md")" "name: codify-workflow"

# every JSON file parses; the manifests say what req 5.1 says; hooks.json
# names every event of req 5.2 with the cg path and a 20 s timeout
python3 - "$ROOT" "$CGPATH" "$VERSION" "$TMP/proj/.codex/hooks.json" <<'PY'
import json, sys
root, cg, version, codex = sys.argv[1:]
p = root + "/plugins/codify"
m = json.load(open(root + "/.claude-plugin/marketplace.json"))
assert m["name"] == "codify" and m["owner"]["name"] == "Codify", m
assert m["plugins"][0]["name"] == "codify", m
assert m["plugins"][0]["source"] == "./plugins/codify", m
pj = json.load(open(p + "/.claude-plugin/plugin.json"))
assert pj["name"] == "codify" and pj["version"] == version, (pj, version)
mcp = json.load(open(p + "/.mcp.json"))
s = mcp["mcpServers"]["codify"]
assert s["command"] == cg and s["args"] == ["mcp"], s

def groups(doc, event):
    return doc["hooks"][event]

def check(doc, want):
    for event, matcher, args in want:
        found = False
        for g in groups(doc, event):
            if g.get("matcher") != matcher:
                continue
            for h in g["hooks"]:
                assert h["type"] == "command", h
                assert h["timeout"] == 20, h
                assert h["command"].startswith(cg + " "), (h, cg)
                if h["command"][len(cg) + 1:].split(" #")[0] == args:
                    found = True
        assert found, (event, matcher, args)

h = json.load(open(p + "/hooks/hooks.json"))
ev = "hook event --host claude"
check(h, [(e, None, ev) for e in ["SessionStart", "SessionEnd", "Stop",
          "SubagentStart", "SubagentStop"]] + [
    ("PreToolUse", "Agent|Task", ev),
    ("PreToolUse", "Bash", "hook pre-bash"),
    ("PostToolUse", "Edit|Write|MultiEdit|NotebookEdit", "hook post-edit"),
    ("PostToolUse", "Agent|Task", ev)])
c = json.load(open(codex))
cv = "hook event --host codex"
check(c, [(e, None, cv) for e in ["SessionStart", "SessionEnd", "Stop",
          "SubagentStart", "SubagentStop", "PreToolUse", "PostToolUse"]] + [
    ("PostToolUse", "apply_patch|Edit|Write", "hook post-edit")])
PY

# ---- a second apply changes nothing
snap() { find "$ROOT" .codex -type f -exec sha256sum {} + | sort; }
before="$(snap)"
out="$(CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply --json)"
python3 -c "
import json,sys
d=json.loads(sys.argv[1])
assert d['plugin']['changed'] == 0, d['plugin']
assert all(f['result']=='unchanged' for f in d['plugin']['files']), d['plugin']
assert d['codex_hooks']['result']=='already configured', d['codex_hooks']
assert d['plugin']['install']['result']=='manual', d['plugin']['install']
" "$out"
[ "$before" = "$(snap)" ] || fail "second apply changed the plugin tree"

# ---- a cg version change regenerates: an owned file from another version
sed -i "s/\"version\": \"$VERSION\"/\"version\": \"0.0.1\"/" \
    "$P/.claude-plugin/plugin.json"
CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply >/dev/null
has "$(cat "$P/.claude-plugin/plugin.json")" "\"version\": \"$VERSION\""

# ---- a foreign file is reported as a conflict and kept
printf '%s\n' '# my own command' > "$P/commands/fleet.md"
rc=0
out="$(CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply)" || rc=$?
[ "$rc" -eq 1 ] || fail "apply over a foreign plugin file exited $rc"
has "$out" "conflict: $P/commands/fleet.md is not codify-owned"
[ "$(cat "$P/commands/fleet.md")" = "# my own command" ] \
    || fail "foreign plugin file was overwritten"
out="$(CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply --json || true)"
python3 -c "
import json,sys
d=json.loads(sys.argv[1])
r={f['path'].rsplit('/',1)[1]:f['result'] for f in d['plugin']['files']}
assert r['fleet.md']=='conflict' and d['plugin']['conflicts']==1, d['plugin']
" "$out"
rm "$P/commands/fleet.md"
CG_CLAUDE=/definitely/missing/claude "$CG" integrate apply >/dev/null

# ---- detect and doctor: not installed, then installed through the CLI
installed() {   # installed <cmd> <want> — the plugin state in detect/doctor
    python3 -c "
import json,sys
d=json.loads(sys.argv[1]); p=d['plugin']
assert p['installed'] is (sys.argv[2]=='true'), p
assert p['rendered'] and p['rendered_version']==sys.argv[3], p
if p['installed']: assert p['version']==sys.argv[3] and p['current'], p
assert 'trusted once through /hooks' in d['codex_hooks']['trust'], d
" "$1" "$2" "$VERSION"
}
installed "$("$CG" integrate detect --json)" false
installed "$("$CG" integrate doctor --json || true)" false
out="$("$CG" integrate doctor || true)"
has "$out" "trusted once through /hooks"

# The stub records its argv and writes the two registration files the way
# claude 2.1 does (known_marketplaces.json, installed_plugins.json v2).
cat > "$TMP/bin/claude" <<EOF
#!/bin/sh
echo "\$*" >> "$TMP/claude.log"
mkdir -p "\$HOME/.claude/plugins"
case "\$*" in
  "plugin marketplace add "*)
    printf '{"codify":{"source":{"source":"directory","path":"%s"},"installLocation":"%s"}}\n' "\$4" "\$4" \
      > "\$HOME/.claude/plugins/known_marketplaces.json" ;;
  "plugin install codify@codify --scope user")
    printf '{"version":2,"plugins":{"codify@codify":[{"scope":"user","installPath":"x","version":"$VERSION"}]}}\n' \
      > "\$HOME/.claude/plugins/installed_plugins.json" ;;
esac
echo "ok"
EOF
chmod +x "$TMP/bin/claude"
out="$(CG_CLAUDE="$TMP/bin/claude" "$CG" integrate apply)"
has "$out" "installed"
has "$(cat "$TMP/claude.log")" "plugin marketplace add $ROOT"
has "$(cat "$TMP/claude.log")" "plugin install codify@codify --scope user"
installed "$("$CG" integrate detect --json)" true
installed "$("$CG" integrate doctor --json)" true
has "$("$CG" integrate doctor --json)" '"ok":true'
has "$("$CG" integrate detect)" "codify@codify $VERSION"

# installed and current: apply runs claude no more
: > "$TMP/claude.log"
out="$(CG_CLAUDE="$TMP/bin/claude" "$CG" integrate apply --json)"
has "$out" '"result":"already installed"'
[ ! -s "$TMP/claude.log" ] || fail "apply re-ran claude for a current plugin"

# an installed plugin older than cg is a doctor finding
sed -i "s/\"version\":\"$VERSION\"/\"version\":\"0.0.1\"/" \
    "$HOME/.claude/plugins/installed_plugins.json"
rc=0
out="$("$CG" integrate doctor --json)" || rc=$?
[ "$rc" -eq 1 ] || fail "doctor accepted a stale plugin"
has "$out" "codify@codify is 0.0.1 but cg is $VERSION"

# ---- cg hook install leaves settings.json to the installed plugin
sed -i "s/\"version\":\"0.0.1\"/\"version\":\"$VERSION\"/" \
    "$HOME/.claude/plugins/installed_plugins.json"
out="$("$CG" hook install)"
has "$out" "no hook fires twice"
[ ! -e .claude/settings.json ] || fail "hook install wrote settings.json"
rm "$HOME/.claude/plugins/installed_plugins.json"
out="$("$CG" hook install)"
[ -f .claude/settings.json ] || fail "hook install without the plugin wrote nothing"

# ---- hooks never fail the host: unknown subcommand, and outside a project
rc=0
echo '{"hook_event_name":"Stop"}' | "$CG" hook no-such-hook 2>/dev/null || rc=$?
[ "$rc" -eq 0 ] || fail "unknown hook subcommand exited $rc"
mkdir -p "$TMP/outside"
rc=0
(cd "$TMP/outside" && echo '{}' | "$CG" hook event --host claude) || rc=$?
[ "$rc" -eq 0 ] || fail "hook outside a project exited $rc"

# ---- the real claude, when there is one, accepts the tree
if [ -n "$REAL_CLAUDE" ]; then
    "$REAL_CLAUDE" plugin validate "$ROOT" >/dev/null 2>&1 \
        || fail "claude plugin validate rejected the marketplace"
    "$REAL_CLAUDE" plugin validate "$P" >/dev/null 2>&1 \
        || fail "claude plugin validate rejected the plugin"
    echo "48_plugin: claude plugin validate passed"
else
    echo "48_plugin: claude not on PATH - validate skipped"
fi

echo "48_plugin ok"
