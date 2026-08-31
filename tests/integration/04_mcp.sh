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

printf '%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n%s\n' \
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
'{"jsonrpc":"2.0","id":15,"method":"tools/call","params":{"name":"spec_ready","arguments":{}}}' \
'{"jsonrpc":"2.0","id":16,"method":"tools/call","params":{"name":"get_context","arguments":{"query":"formatName","budget":200,"limit":2}}}' \
'{"jsonrpc":"2.0","id":17,"method":"tools/call","params":{"name":"resume","arguments":{}}}' \
'{"jsonrpc":"2.0","id":18,"method":"tools/call","params":{"name":"survey","arguments":{"scope":"src","budget":2000}}}' \
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
assert len(tools) >= 19, tools
for t in ("search_code", "get_context", "impact_analysis", "survey",
          "vcs_commit",
          "spec_status", "spec_next", "spec_start", "spec_done",
          "spec_mode", "spec_implemented", "spec_render", "spec_trace",
          "spec_reconcile", "state", "event_ingest", "event_history",
          "progress_status", "work_open", "work_update", "work_close",
          "remember", "recall", "spec_ready", "spec_claim_next",
          "spec_release", "handoff", "resume"):
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
assert '"mode":"prod"' in mode["content"][0]["text"], mode

started = by_id[11]["result"]
assert started["isError"] is False, started

implemented = by_id[12]["result"]
assert implemented["isError"] is False, implemented
assert '"implemented":"1.2"' in implemented["content"][0]["text"], implemented

forced = by_id[13]["result"]
assert forced["isError"] is True, forced
assert "does not support force" in forced["content"][0]["text"], forced

status = by_id[14]["result"]
assert status["isError"] is False, status
prod = json.loads(status["content"][0]["text"])
assert prod["mode"] == "prod" and prod["implemented"] == 1, prod

ready = by_id[15]["result"]
assert ready["isError"] is False, ready
rd = json.loads(ready["content"][0]["text"])
assert rd["mode"] == "prod", rd
assert isinstance(rd["tasks"], list), rd

ctx = by_id[16]["result"]                     # budget/limit args plumbed through
assert ctx["isError"] is False, ctx
cx = json.loads(ctx["content"][0]["text"])
assert cx["query"] == "formatName", cx
assert any("formatName" in s.get("name", "")
           for s in cx.get("symbols", [])), cx

res = by_id[17]["result"]                     # no task in progress -> the
assert res["isError"] is True, res            # explanation reaches the body
assert "no task in progress" in res["content"][0]["text"], res

svy = by_id[18]["result"]                     # survey: the tier below bodies
assert svy["isError"] is False, svy
sv = json.loads(svy["content"][0]["text"])
assert sv["scope"] == "src", sv
assert isinstance(sv["files"], list) and sv["files"], sv
assert "omitted" in sv, sv
assert not any("return" in json.dumps(f.get("docs", [])) for f in sv["files"]), sv
EOF

echo ok

# ---- protocol negotiation, annotations, resources, prompts
req() { printf '%s\n' "$1" | "$CG" mcp 2>/dev/null; }

out="$(req '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"1999-01-01"}}')"
python3 -c "
import json
d = json.loads(r'''$out''')['result']
assert d['protocolVersion'] != '1999-01-01', ('echoed an unsupported version', d)
assert d['protocolVersion'] == '2025-11-25', d
for cap in ('tools', 'resources', 'prompts'):
    assert cap in d['capabilities'], (cap, d['capabilities'])
assert d['capabilities']['tools']['listChanged'] is False, d
assert d['capabilities']['resources']['listChanged'] is False, d
assert len(d['instructions']) <= 512, len(d['instructions'])
for word in ('work_open','work_update','state','progress_status','work_close'):
    assert word in d['instructions'], (word,d['instructions'])
"
# a version we do speak is honoured
out="$(req '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05"}}')"
python3 -c "
import json
assert json.loads(r'''$out''')['result']['protocolVersion'] == '2024-11-05'
"

out="$(req '{"jsonrpc":"2.0","id":2,"method":"tools/list"}')"
python3 -c "
import json
tools = json.loads(r'''$out''')['result']['tools']
by = {t['name']: t for t in tools}
assert len(tools) >= 30, len(tools)
for t in tools:
    assert 'annotations' in t, ('no annotations on', t['name'])
    assert 'title' in t, ('no title on', t['name'])
assert by['search_code']['annotations']['readOnlyHint'] is True
assert by['vcs_commit']['annotations']['readOnlyHint'] is False
for name in ('brief', 'review', 'why', 'get_source', 'test_impact',
             'check', 'guard', 'spec_wave', 'spec_new', 'spec_add',
             'spec_lint', 'spec_claim', 'git_sync', 'spec_ready',
             'spec_claim_next', 'spec_release', 'spec_reconcile', 'handoff',
             'resume', 'state', 'event_ingest', 'event_history',
             'progress_status', 'work_open', 'work_update', 'work_close'):
    assert name in by, ('missing tool', name)
assert by['state']['annotations']['readOnlyHint'] is True
assert by['event_history']['annotations']['readOnlyHint'] is True
assert by['progress_status']['annotations']['readOnlyHint'] is True
for name in ('spec_reconcile','event_ingest','work_open','work_update','work_close'):
    assert by[name]['annotations']['readOnlyHint'] is False, name
assert by['spec_reconcile']['inputSchema']['properties']['repair']['type']=='boolean'
assert by['event_ingest']['inputSchema']['required']==['payload']
assert by['work_update']['inputSchema']['required']==['revision']
"

out="$(req '{"jsonrpc":"2.0","id":3,"method":"prompts/list"}')"
python3 -c "
import json
p = json.loads(r'''$out''')['result']['prompts']
names = [x['name'] for x in p]
assert 'start-work' in names and 'review-change' in names, names
"
out="$(req '{"jsonrpc":"2.0","id":4,"method":"prompts/get","params":{"name":"close-task"}}')"
python3 -c "
import json
r = json.loads(r'''$out''')['result']
assert r['messages'][0]['content']['text'].strip(), r
"
out="$(req '{"jsonrpc":"2.0","id":5,"method":"prompts/get","params":{"name":"nope"}}')"
python3 -c "
import json
assert 'error' in json.loads(r'''$out'''), 'unknown prompt should error'
"

out="$(req '{"jsonrpc":"2.0","id":6,"method":"resources/list"}')"
python3 -c "
import json
res = json.loads(r'''$out''')['result']['resources']
assert any(x['uri'].startswith('codify://spec/') for x in res), res
"

echo "04_mcp modern ok"
