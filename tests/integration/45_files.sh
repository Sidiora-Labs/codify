#!/usr/bin/env bash
# files: cg files answers globs, path words and directories from the files
# table and file_fts; --dirs maps the tree; --path/--lang/--no-tests narrow
# search, context and survey; a large directory's context outline leads
# with its subdirectories; find_files and the filters over MCP.
# Fixture: fixtures/explore plus files written here.
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/explore/proj" "$TMP/proj"
cd "$TMP/proj"
mkdir -p src/net lib pkg/core/deep
printf 'int sync_gate_open(void) { return 1; }\n' > src/syncgate.c
printf 'def sync_gate():\n    return 1\n' > lib/sync_gate.py
printf 'int net_send(int x) { return x; }\nint net_recv(int x) { return x; }\n' \
    > src/net/send.c
# a directory too large for a small context budget, with subdirectories
for i in $(seq 1 30); do
    printf '/* core part %d */\nint core_part_%d(void) { return %d; }\n' \
        "$i" "$i" "$i" > "pkg/core/part_$i.c"
done
for i in 1 2 3; do
    printf 'int deep_%d(void) { return 0; }\n' "$i" > "pkg/core/deep/d$i.c"
done
"$CG" init >/dev/null 2>&1

# at <out> <needle>: 1-based line of the first match, 0 when absent
at() { printf '%s\n' "$1" | grep -nF -m1 -- "$2" | cut -d: -f1 || echo 0; }

# ---------------- 2.1: globs, path words, a directory ----------------
# the index exists and holds the path's words
python3 - <<'PY' || fail "file_fts must carry name_words of the path"
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
w = dict(db.execute("SELECT f.path, x.words FROM file_fts x JOIN files f "
                    "ON f.id=x.rowid").fetchall())
assert w["lib/sync_gate.py"] == "lib sync gate py", w["lib/sync_gate.py"]
assert w["src/syncgate.c"] == "src syncgate c", w["src/syncgate.c"]
PY
out="$("$CG" files 'src/**/*.c')"
has "$out" "src/store.c"
has "$out" "src/net/send.c"
has "$out" "src/syncgate.c"
hasnt "$out" "src/store.h"
hasnt "$out" "pkg/core"
# each row: path, language, lines, symbol count
printf '%s\n' "$out" | grep -E '^src/net/send\.c +c +2 lines +2 sym$' >/dev/null \
    || fail "row shape: $out"
# a slashless glob matches basenames at any depth
out="$("$CG" files '*.py')"
has "$out" "lib/sync_gate.py"
has "$out" "tools/backup.py"
hasnt "$out" ".c "
# words: both spellings, the whole-word match first
out="$("$CG" files sync gate)"
has "$out" "lib/sync_gate.py"
has "$out" "src/syncgate.c"
[ "$(at "$out" lib/sync_gate.py)" -lt "$(at "$out" src/syncgate.c)" ] \
    || fail "whole path words rank first: $out"
hasnt "$out" "store"
# a bare directory: its subdirectories with counts, then its own files
out="$("$CG" files src)"
has "$out" "src/net/"
has "$out" "src/store.c"
[ "$(at "$out" src/net/)" -lt "$(at "$out" src/store.c)" ] \
    || fail "subdirectories before files: $out"
hasnt "$out" "src/net/send.c"

# ---------------- 2.1: -n, the omitted tail, --lang, --json ----------------
out="$("$CG" files part -n 5)"
[ "$(printf '%s\n' "$out" | grep -c '^pkg/core/part_')" = 5 ] \
    || fail "-n 5 prints five rows: $out"
has "$out" "(+25 more files omitted"
out="$("$CG" files --lang python sync)"
has "$out" "lib/sync_gate.py"
hasnt "$out" "src/syncgate.c"
out="$("$CG" files --lang py '*')"
has "$out" "tools/backup.py"
hasnt "$out" "src/"
out="$("$CG" files 'pkg/**' --json -n 3)"
python3 - "$out" <<'PY' || fail "files --json"
import json, sys
d = json.loads(sys.argv[1])
assert d["mode"] == "glob", d
assert len(d["files"]) == 3 and d["total"] == 33 and d["omitted"] == 30, d
r = d["files"][0]
assert set(r) == {"path", "lang", "lines", "symbols"}, r
assert r["lang"] == "c" and r["symbols"] == 1 and r["lines"] == 1, r
PY

# ---------------- 2.2: --dirs ----------------
out="$("$CG" files --dirs)"
has "$out" "pkg/"
has "$out" "  core/"
hasnt "$out" "deep/"                                   # depth 2 by default
[ "$(at "$out" '  pkg/')" -lt "$(at "$out" '  src/')" ] \
    || fail "largest first: $out"
printf '%s\n' "$out" | grep -E '^  pkg/ +33 files +63 lines +c$' >/dev/null \
    || fail "dir row: counts and dominant language: $out"
out="$("$CG" files --dirs pkg --depth 3 --json)"
python3 - "$out" <<'PY' || fail "files --dirs --json"
import json, sys
d = json.loads(sys.argv[1])
assert d["mode"] == "dirs" and d["prefix"] == "pkg/" and d["depth"] == 3, d
by = {x["path"]: x for x in d["dirs"]}
assert by["pkg/core"]["files"] == 33 and by["pkg/core"]["lang"] == "c", by
assert by["pkg/core/deep"]["files"] == 3 and by["pkg/core/deep"]["depth"] == 2, by
PY
out="$("$CG" files --dirs --lang python)"
has "$out" "lib/"
hasnt "$out" "pkg/"

# ---------------- 2.3: the filters on search, context, survey ----------------
out="$("$CG" search store)"
has "$out" "tests/test_store.c"
out="$("$CG" search store --no-tests)"
has "$out" "src/store.c"
hasnt "$out" "tests/test_store.c"
out="$("$CG" search memory --path 'web/*' --json)"
python3 - "$out" <<'PY' || fail "search --path keeps only web/"
import json, sys
d = json.loads(sys.argv[1])
paths = [s["path"] for s in d["symbols"]] + [f["path"] for f in d["files"]]
assert paths and all(p.startswith("web/") for p in paths), paths
PY
out="$("$CG" search memory --lang typescript)"
has "$out" "web/memories.ts"
hasnt "$out" "src/store.c"
out="$("$CG" search memory --path src --path tools)"
hasnt "$out" "web/"
out="$("$CG" context "memory export" --path web --json)"
python3 - "$out" <<'PY' || fail "context --path keeps only web/"
import json, sys
d = json.loads(sys.argv[1])
syms = [s for s in d.get("symbols", [])]
assert syms, d
for s in syms:
    assert s["path"].startswith("web/"), s
PY
out="$("$CG" context "memory export" --no-tests)"
hasnt "$out" "tests/test_store.c"
out="$("$CG" survey src --path src/net)"
has "$out" "src/net/send.c"
hasnt "$out" "src/store.c"
out="$("$CG" survey src --lang c --no-tests --json)"
python3 - "$out" <<'PY' || fail "survey --lang"
import json, sys
d = json.loads(sys.argv[1])
assert d["files"] and all(f["path"].endswith((".c", ".h")) for f in d["files"]), d
PY
expect_rc 1 "$CG" search store --path

# ---------------- 2.4: the directory outline in context ----------------
# fits: the flat list as before
out="$("$CG" context src/net)"
has "$out" "directory src/net/"
has "$out" "src/net/send.c"
# overflows: subdirectories with counts first, then the files that fit
out="$("$CG" context pkg --budget 300)"
has "$out" "subdirectories:"
has "$out" "pkg/core/"
has "$out" "33 files"
has "$out" "more)"
out="$("$CG" context pkg/core --budget 300 --json)"
python3 - "$out" <<'PY' || fail "dir outline map json"
import json, sys
raw = sys.argv[1]
d = json.loads(raw)
assert d["kind"] == "dir", d
assert d["subdirs"][0]["path"] == "pkg/core/deep/" and d["subdirs"][0]["files"] == 3, d
own = [f for f in d["files"] if "path" in f]
assert own and all("/deep/" not in f["path"] for f in own), own
assert d["omitted"] > 0 and d["tokens_used"] <= d["budget"], d
assert len(raw) <= 300 * 4
PY

# ---------------- 2.5: find_files and the filters over MCP ----------------
req() { printf '%s\n' "$1" | "$CG" mcp 2>/dev/null; }
out="$(req '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
python3 - "$out" <<'PY' || fail "find_files in tools/list"
import json, sys
by = {t["name"]: t for t in json.loads(sys.argv[1])["result"]["tools"]}
ff = by["find_files"]
assert ff["annotations"]["readOnlyHint"] is True, ff
for k in ("pattern", "dirs", "depth", "lang", "limit"):
    assert k in ff["inputSchema"]["properties"], k
for t in ("search_code", "get_context"):
    for k in ("path", "lang", "no_tests"):
        assert k in by[t]["inputSchema"]["properties"], (t, k)
PY
out="$(req '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"find_files","arguments":{"pattern":"sync gate"}}}')"
python3 - "$out" <<'PY' || fail "find_files call"
import json, sys
r = json.loads(sys.argv[1])["result"]
d = json.loads(r["content"][0]["text"])
paths = [f["path"] for f in d["files"]]
assert paths == ["lib/sync_gate.py", "src/syncgate.c"], paths
PY
out="$(req '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"find_files","arguments":{"dirs":true,"depth":1}}}')"
python3 - "$out" <<'PY' || fail "find_files dirs"
import json, sys
d = json.loads(json.loads(sys.argv[1])["result"]["content"][0]["text"])
assert d["mode"] == "dirs" and d["dirs"][0]["path"] == "pkg", d
assert all(x["depth"] == 1 for x in d["dirs"]), d
PY
out="$(req '{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"search_code","arguments":{"query":"store","no_tests":true,"path":["src","tests"]}}}')"
python3 - "$out" <<'PY' || fail "search_code filters"
import json, sys
d = json.loads(json.loads(sys.argv[1])["result"]["content"][0]["text"])
paths = [s["path"] for s in d["symbols"]] + [f["path"] for f in d["files"]]
assert paths and all(p.startswith("src/") for p in paths), paths
PY
out="$(req '{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"get_context","arguments":{"query":"memory export","lang":"ts"}}}')"
python3 - "$out" <<'PY' || fail "get_context lang"
import json, sys
d = json.loads(json.loads(sys.argv[1])["result"]["content"][0]["text"])
assert d["symbols"] and all(s["path"].endswith(".ts") for s in d["symbols"]), d
PY

echo "45_files ok"
