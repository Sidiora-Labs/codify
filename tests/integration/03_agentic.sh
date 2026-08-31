#!/usr/bin/env bash
# changelog, agentmd, mcp-install (sandboxed HOME)
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null
"$CG" commit -m "baseline" >/dev/null

cat >> src/util.ts <<'EOF'

export function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, "-");
}
EOF
"$CG" sync >/dev/null
"$CG" commit -m "add slugify" >/dev/null

# changelog: per-file line deltas + symbol-level bullets
out="$("$CG" changelog)"
has "$out" "add slugify"
has "$out" "1 file changed"
has "$out" "src/util.ts"
has "$out" "slugify"

"$CG" changelog -o CHANGELOG.md >/dev/null
[ -s CHANGELOG.md ] || fail "changelog -o wrote nothing"

# agentmd owns graph context without colliding with workflow instruction files
"$CG" agentmd --write >/dev/null
[ -s .codify/agent-context.md ] || fail "agent context not written"
[ ! -e AGENTS.md ] || fail "agentmd unexpectedly owns AGENTS.md"
[ ! -e CLAUDE.md ] || fail "agentmd unexpectedly owns CLAUDE.md"
out="$(cat .codify/agent-context.md)"
has "$out" "typescript"
has "$out" "/users"          # route table
has "$out" "cg context"      # agent cheat sheet
has "$out" 'owned by `cg agentmd`'

# mcp-install: project + user configs, sandboxed HOME
export HOME="$TMP/home"
mkdir -p "$HOME"
"$CG" mcp-install >/dev/null
[ -f .mcp.json ] || fail ".mcp.json not created"
python3 -c "
import json
d = json.load(open('.mcp.json'))
assert 'codify' in d['mcpServers'], d
assert d['mcpServers']['codify']['args'] == ['mcp'], d
"
python3 -m json.tool .vscode/mcp.json >/dev/null || fail "vscode config invalid"
python3 -m json.tool "$HOME/.codeium/windsurf/mcp_config.json" >/dev/null \
    || fail "windsurf config invalid"
grep -q "mcp_servers.codify" "$HOME/.codex/config.toml" \
    || fail "codex config missing"

# merging into an existing config keeps the other server
rm .mcp.json
cat > .mcp.json <<'EOF'
{
  "mcpServers": {
    "other": { "command": "other-server", "args": [] }
  }
}
EOF
"$CG" mcp-install >/dev/null
python3 -c "
import json
d = json.load(open('.mcp.json'))
assert 'other' in d['mcpServers'], d
assert 'codify' in d['mcpServers'], d
"

# second run is idempotent
out="$("$CG" mcp-install)"
has "$out" "already configured"

echo ok
