#!/usr/bin/env bash
# MCP stdio server: JSON-RPC handshake, tool list, tool calls
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cp -r "$FIXTURES/specrepo/spec" "$TMP/proj/spec"
cd "$TMP/proj"
"$CG" init >/dev/null

printf '%s\n%s\n%s\n%s\n%s\n%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_code","arguments":{"query":"formatName"}}}' \
'{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"spec_status","arguments":{}}}' \
'{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope","arguments":{}}}' \
'{"jsonrpc":"2.0","id":6,"method":"ping"}' \
| "$CG" mcp > "$TMP/mcp.out"

python3 - "$TMP/mcp.out" <<'EOF'
import json, sys

lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
by_id = {l["id"]: l for l in lines}

init = by_id[1]["result"]
assert init["serverInfo"]["name"] == "codify", init
assert init["protocolVersion"] == "2025-06-18", init

tools = [t["name"] for t in by_id[2]["result"]["tools"]]
assert len(tools) == 15, tools
for t in ("search_code", "get_context", "impact_analysis", "vcs_commit",
          "spec_status", "spec_next", "spec_start", "spec_done",
          "spec_render", "spec_trace"):
    assert t in tools, f"missing tool {t}"
for t in by_id[2]["result"]["tools"]:
    assert t["description"], f"tool {t['name']} has no description"
    assert "inputSchema" in t, f"tool {t['name']} has no schema"

search = by_id[3]["result"]
assert search["isError"] is False, search
payload = json.loads(search["content"][0]["text"])
assert any("formatName" in s.get("name", "")
           for s in payload.get("symbols", [])), payload

spec = by_id[4]["result"]
assert spec["isError"] is False, spec
st = json.loads(spec["content"][0]["text"])
assert st["feature"] == "demo", st
assert st["tasks"] == 3, st

assert "error" in by_id[5], by_id[5]          # unknown tool -> JSON-RPC error
assert by_id[6]["result"] == {}, by_id[6]     # ping
EOF

echo ok
