#!/usr/bin/env bash
# cg lsp — definition, references, hover, symbols, code lens, diagnostics
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

python3 - "$CG" "$TMP/proj" <<'PY'
import json, subprocess, sys

cg, root = sys.argv[1], sys.argv[2]

def frame(o):
    b = json.dumps(o).encode()
    return b"Content-Length: %d\r\n\r\n" % len(b) + b

uri = "file://%s/src/util.ts" % root

# locate formatName so the test does not depend on fixture line numbers
src = open("%s/src/util.ts" % root).read().splitlines()
line = next(i for i, l in enumerate(src) if "formatName" in l)
char = src[line].index("formatName") + 2

msgs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"capabilities": {}}},
    {"jsonrpc": "2.0", "method": "initialized", "params": {}},
    {"jsonrpc": "2.0", "method": "textDocument/didOpen",
     "params": {"textDocument": {"uri": uri, "languageId": "typescript",
                                 "version": 1, "text": ""}}},
    {"jsonrpc": "2.0", "id": 2, "method": "textDocument/definition",
     "params": {"textDocument": {"uri": uri},
                "position": {"line": line, "character": char}}},
    {"jsonrpc": "2.0", "id": 3, "method": "textDocument/references",
     "params": {"textDocument": {"uri": uri},
                "position": {"line": line, "character": char}}},
    {"jsonrpc": "2.0", "id": 4, "method": "textDocument/hover",
     "params": {"textDocument": {"uri": uri},
                "position": {"line": line, "character": char}}},
    {"jsonrpc": "2.0", "id": 5, "method": "workspace/symbol",
     "params": {"query": "formatName"}},
    {"jsonrpc": "2.0", "id": 6, "method": "textDocument/documentSymbol",
     "params": {"textDocument": {"uri": uri}}},
    {"jsonrpc": "2.0", "id": 7, "method": "textDocument/codeLens",
     "params": {"textDocument": {"uri": uri}}},
    {"jsonrpc": "2.0", "id": 8, "method": "textDocument/somethingUnknown",
     "params": {}},
    {"jsonrpc": "2.0", "id": 9, "method": "shutdown"},
    {"jsonrpc": "2.0", "method": "exit"},
]
p = subprocess.run([cg, "lsp"], input=b"".join(frame(m) for m in msgs),
                   capture_output=True, timeout=120, cwd=root)
assert p.returncode == 0, (p.returncode, p.stderr.decode()[:500])

# Content-Length counts bytes, so frames must be split on bytes, not chars
out, i, got, notes = p.stdout, 0, {}, []
while True:
    j = out.find(b"Content-Length:", i)
    if j < 0:
        break
    k = out.find(b"\r\n\r\n", j)
    n = int(out[j + 15:k])
    m = json.loads(out[k + 4:k + 4 + n].decode())
    if "id" in m:
        got[m["id"]] = m
    else:
        notes.append(m)
    i = k + 4 + n

caps = got[1]["result"]["capabilities"]
for c in ("definitionProvider", "referencesProvider", "hoverProvider",
          "workspaceSymbolProvider", "documentSymbolProvider",
          "codeLensProvider"):
    assert caps.get(c), ("missing capability", c)

defs = got[2]["result"]
assert defs, "no definition returned"
assert defs[0]["uri"].endswith("src/util.ts"), defs
assert defs[0]["range"]["start"]["line"] == line, (defs, line)  # 0-based

refs = got[3]["result"]
assert refs, "no references returned"

hover = got[4]["result"]
assert hover and "formatName" in hover["contents"]["value"], hover
assert "reference" in hover["contents"]["value"], hover

syms = got[5]["result"]
assert any(s["name"] == "formatName" for s in syms), syms
assert got[6]["result"], "documentSymbol empty"

lenses = got[7]["result"]
assert lenses, "codeLens empty"
assert any("reference" in l["command"]["title"] for l in lenses), lenses

assert got[8]["result"] is None, "unknown method must answer, not hang"

diags = [n for n in notes if n["method"] == "textDocument/publishDiagnostics"]
assert diags, "didOpen published no diagnostics notification"
print("lsp protocol ok")
PY

# ---- diagnostics: an unparseable kvx file is reported
mkdir -p spec/broken
printf '[meta\nfeature = "broken"\n' > spec/broken/spec.kvx
python3 - "$CG" "$TMP/proj" <<'PY'
import json, subprocess, sys
cg, root = sys.argv[1], sys.argv[2]
def frame(o):
    b = json.dumps(o).encode()
    return b"Content-Length: %d\r\n\r\n" % len(b) + b
uri = "file://%s/spec/broken/spec.kvx" % root
msgs = [
    {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}},
    {"jsonrpc":"2.0","method":"textDocument/didOpen",
     "params":{"textDocument":{"uri":uri,"languageId":"kvx","version":1,"text":""}}},
    {"jsonrpc":"2.0","id":9,"method":"shutdown"},
    {"jsonrpc":"2.0","method":"exit"},
]
p = subprocess.run([cg,"lsp"], input=b"".join(frame(m) for m in msgs),
                   capture_output=True, timeout=120, cwd=root)
out, i, notes = p.stdout, 0, []
while True:
    j = out.find(b"Content-Length:", i)
    if j < 0: break
    k = out.find(b"\r\n\r\n", j)
    n = int(out[j+15:k])
    m = json.loads(out[k+4:k+4+n].decode())
    if "id" not in m: notes.append(m)
    i = k+4+n
diags = [d for n in notes if n["method"].endswith("publishDiagnostics")
         for d in n["params"]["diagnostics"]]
assert any(d["code"] == "kvx-parse" for d in diags), diags
print("lsp kvx diagnostics ok")
PY

echo "13_lsp ok"

# ---- diagnostics: an edit outside the active task's declared scope
cd "$TMP/proj"
rm -rf spec/broken          # the deliberately unparseable fixture above
"$CG" spec new scoped >/dev/null
"$CG" spec add 2.1 --title "Only util" --wave 0 --touches 'src/util.ts' \
      --reqs 1.1 >/dev/null
"$CG" spec start 1.1 >/dev/null && "$CG" spec done 1.1 >/dev/null
"$CG" spec start 2.1 >/dev/null

python3 - "$CG" "$TMP/proj" <<'PY'
import json, subprocess, sys
cg, root = sys.argv[1], sys.argv[2]
def frame(o):
    b = json.dumps(o).encode()
    return b"Content-Length: %d\r\n\r\n" % len(b) + b

def diagnostics_for(rel):
    uri = "file://%s/%s" % (root, rel)
    msgs = [
        {"jsonrpc":"2.0","id":1,"method":"initialize","params":{"capabilities":{}}},
        {"jsonrpc":"2.0","method":"textDocument/didOpen",
         "params":{"textDocument":{"uri":uri,"languageId":"typescript",
                                   "version":1,"text":""}}},
        {"jsonrpc":"2.0","id":9,"method":"shutdown"},
        {"jsonrpc":"2.0","method":"exit"},
    ]
    p = subprocess.run([cg,"lsp"], input=b"".join(frame(m) for m in msgs),
                       capture_output=True, timeout=120, cwd=root)
    out, i, found = p.stdout, 0, []
    while True:
        j = out.find(b"Content-Length:", i)
        if j < 0: break
        k = out.find(b"\r\n\r\n", j)
        n = int(out[j+15:k])
        m = json.loads(out[k+4:k+4+n].decode())
        if "id" not in m and m["method"].endswith("publishDiagnostics"):
            found += m["params"]["diagnostics"]
        i = k+4+n
    return found

inside = diagnostics_for("src/util.ts")
assert not any(d["code"] == "scope-drift" for d in inside), inside

outside = diagnostics_for("src/server.ts")
drift = [d for d in outside if d["code"] == "scope-drift"]
assert drift, ("no scope diagnostic for an out-of-scope file", outside)
assert "2.1" in drift[0]["message"], drift
assert drift[0]["severity"] == 2, ("scope drift must warn, not error", drift)
print("lsp scope diagnostics ok")
PY

echo "13_lsp scope ok"
