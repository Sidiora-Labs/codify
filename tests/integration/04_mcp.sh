#!/usr/bin/env bash
# MCP stdio server: JSON-RPC handshake, tool list, tool calls
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cp -r "$FIXTURES/specrepo/spec" "$TMP/proj/spec"
cd "$TMP/proj"
"$CG" init >/dev/null
python3 - <<'EOF'
p = "spec/demo/spec.kvx"
s = open(p).read().replace('verify_cmd = "test -f verify.marker"',
                            'verify_cmd = "touch mcp-qualification.ran"')
open(p, "w").write(s)
EOF

printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"search_code","arguments":{"query":"formatName"}}}' \
'{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"spec_status","arguments":{}}}' \
'{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope","arguments":{}}}' \
'{"jsonrpc":"2.0","id":6,"method":"ping"}' \
'{"jsonrpc":"2.0","id":7,"method":"tools/call","params":{"name":"remember","arguments":{"text":"MCP roundtrip memory","type":"decision"}}}' \
'{"jsonrpc":"2.0","id":8,"method":"tools/call","params":{"name":"recall","arguments":{"query":"roundtrip"}}}' \
'{"jsonrpc":"2.0","id":9,"method":"tools/call","params":{"name":"spec_implemented","arguments":{"id":"1.2"}}}' \
'{"jsonrpc":"2.0","id":10,"method":"tools/call","params":{"name":"spec_mode","arguments":{"mode":"prod"}}}' \
'{"jsonrpc":"2.0","id":11,"method":"tools/call","params":{"name":"spec_start","arguments":{"id":"1.2"}}}' \
'{"jsonrpc":"2.0","id":12,"method":"tools/call","params":{"name":"spec_implemented","arguments":{"id":"1.2"}}}' \
'{"jsonrpc":"2.0","id":13,"method":"tools/call","params":{"name":"spec_implemented","arguments":{"id":"1.2","force":true}}}' \
'{"jsonrpc":"2.0","id":14,"method":"tools/call","params":{"name":"spec_status","arguments":{}}}' \
| "$CG" mcp > "$TMP/mcp.out"

[ ! -e mcp-qualification.ran ] \
    || fail "MCP spec_implemented executed verify_cmd"

python3 - "$TMP/mcp.out" <<'EOF'
import json, sys

lines = [json.loads(l) for l in open(sys.argv[1]) if l.strip()]
by_id = {l["id"]: l for l in lines}

init = by_id[1]["result"]
assert init["serverInfo"]["name"] == "codify", init
assert init["protocolVersion"] == "2025-06-18", init

tools = [t["name"] for t in by_id[2]["result"]["tools"]]
assert len(tools) == 19, tools
for t in ("search_code", "get_context", "impact_analysis", "vcs_commit",
          "spec_status", "spec_next", "spec_start", "spec_done",
          "spec_mode", "spec_implemented", "spec_render", "spec_trace",
          "remember", "recall"):
    assert t in tools, f"missing tool {t}"
for t in by_id[2]["result"]["tools"]:
    assert t["description"], f"tool {t['name']} has no description"
    assert "inputSchema" in t, f"tool {t['name']} has no schema"

tool_defs = {t["name"]: t for t in by_id[2]["result"]["tools"]}
assert tool_defs["spec_mode"]["inputSchema"]["properties"]["mode"]["enum"] == ["prod", "standard"]
impl_schema = tool_defs["spec_implemented"]["inputSchema"]
assert impl_schema["required"] == ["id"], impl_schema
assert "force" not in impl_schema["properties"], impl_schema

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

rem = by_id[7]["result"]
assert rem["isError"] is False, rem
saved = json.loads(rem["content"][0]["text"])
assert saved["id"] >= 1 and saved["type"] == "decision", saved

rec = by_id[8]["result"]
assert rec["isError"] is False, rec
found = json.loads(rec["content"][0]["text"])
assert found["count"] == 1, found
assert "MCP roundtrip" in found["memories"][0]["body"], found

before_mode = by_id[9]["result"]
assert before_mode["isError"] is True, before_mode
assert "requires Prod mode" in before_mode["content"][0]["text"], before_mode

mode = by_id[10]["result"]
assert mode["isError"] is False, mode
assert "mode: prod" in mode["content"][0]["text"], mode

started = by_id[11]["result"]
assert started["isError"] is False, started

implemented = by_id[12]["result"]
assert implemented["isError"] is False, implemented
assert "implemented 1.2" in implemented["content"][0]["text"], implemented

forced = by_id[13]["result"]
assert forced["isError"] is True, forced
assert "does not support force" in forced["content"][0]["text"], forced

status = by_id[14]["result"]
assert status["isError"] is False, status
prod = json.loads(status["content"][0]["text"])
assert prod["mode"] == "prod" and prod["implemented"] == 1, prod
EOF

echo ok
