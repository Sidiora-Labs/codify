#!/usr/bin/env bash
# cg grep: trigram candidates, literal and regex scans from disk, hits placed
# in their enclosing symbols, ranking, the -n/--budget tail, --json, grep_code
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

j() {   # j '<json>' '<python expression over d>'
    python3 -c "import json,sys; d=json.loads(sys.argv[1]); print($2)" "$1"
}
nfiles="$(j "$("$CG" info --json)" "d['project_files']")"

# a literal, found with its enclosing symbol; a top-level hit is file scope
out="$("$CG" grep formatName)"
has "$out" "src/server.ts:7: "
has "$out" "in function getUsers"
has "$out" "in method find"
has "$out" "in (file scope)"
has "$out" "src/util.ts:1: export function formatName"
# ranked by hit count: server.ts (4) before util.ts (1)
first="$(printf '%s\n' "$out" | head -1)"
has "$first" "src/server.ts"
has "$out" "5 hits in 2 files"

# the literal is case-sensitive by default; -i is not
out="$("$CG" grep FORMATNAME)"
has "$out" "0 hits"
out="$("$CG" grep -i FORMATNAME)"
has "$out" "5 hits in 2 files"

# -E: a POSIX extended regex, its longest literal run still narrows
out="$("$CG" grep -E 'format[A-Z]ame\(' --json)"
[ "$(j "$out" "d['regex']")" = True ] || fail "regex flag: $out"
[ "$(j "$out" "d['total']")" = 4 ] || fail "regex hits: $out"
[ "$(j "$out" "d['candidates'] < $nfiles")" = True ] || fail "regex candidates: $out"
out="$("$CG" grep -E 'def (load|save)_tasks')"
has "$out" "lib/tasks.py:6: def load_tasks(path):"
has "$out" "lib/tasks.py:11: def save_tasks(path, tasks):"
expect_rc 1 "$CG" grep -E 'unclosed('

# --path narrows to the glob; --lang and --no-tests filter
out="$("$CG" grep formatName --path 'src/util*')"
has "$out" "src/util.ts"
hasnt "$out" "src/server.ts"
out="$("$CG" grep load_tasks --lang python --files)"
has "$out" "lib/tasks.py"
out="$("$CG" grep load_tasks --lang go --count)"
has "$out" "0 hits"

# --symbol: only hits inside that symbol's span; --kind: inside that kind
out="$("$CG" grep formatName --symbol createUser)"
has "$out" "src/server.ts:11:"
hasnt "$out" "src/server.ts:7:"
has "$out" "1 hit in 1 file"
out="$("$CG" grep formatName --kind method)"
has "$out" "src/server.ts:17:"
hasnt "$out" "src/server.ts:11:"

# --files lists files with counts; --count prints the total
out="$("$CG" grep formatName --files)"
has "$out" "src/server.ts  4 hits"
has "$out" "src/util.ts  1 hit"
hasnt "$out" "src/server.ts:7:"
out="$("$CG" grep formatName --count)"
has "$out" "5 hits in 2 files"

# a small -n ends with the explicit tail
out="$("$CG" grep formatName -n 2)"
has "$out" "… 3 more hits in 2 files — narrow with --path or raise -n"
# so does a small budget
out="$("$CG" grep formatName --budget 60 --json)"
[ "$(j "$out" "d['omitted'] > 0")" = True ] || fail "budget tail: $out"

# -C adds context lines
out="$("$CG" grep 'res.json' -C 1)"
has "$out" "src/server.ts-6- export function getUsers"
has "$out" "src/server.ts:7: "

# --json carries every field of the contract
out="$("$CG" grep formatName --json)"
python3 - "$out" "$nfiles" <<'EOF'
import json, sys
d = json.loads(sys.argv[1]); n = int(sys.argv[2])
for k in ("query", "regex", "case_sensitive", "candidates", "scanned",
          "hits", "omitted", "ms"):
    assert k in d, (k, d)
assert d["query"] == "formatName" and d["regex"] is False
assert d["case_sensitive"] is True
assert 0 < d["candidates"] < n, d          # the index narrowed the literal
assert d["scanned"] == d["candidates"], d
h = [x for x in d["hits"] if x["line"] == 7][0]
assert h["path"] == "src/server.ts" and h["symbol"] == "getUsers", h
assert h["kind"] == "function" and "formatName" in h["text"], h
assert "branch" not in h, h                 # one branch in scope
top = [x for x in d["hits"] if x["line"] == 2][0]
assert top["symbol"] is None, top           # file scope
assert d["omitted"] == 0, d
EOF

# a two-character pattern has no trigram: every indexed file is scanned
out="$("$CG" grep ab --json)"
[ "$(j "$out" "d['candidates']")" = "$nfiles" ] || fail "2-char candidates: $out"
[ "$(j "$out" "d['full_scan']")" = True ] || fail "full_scan: $out"
out="$("$CG" grep ab)"
has "$out" "every indexed file was scanned"

# hits are read from disk: with auto-sync off, a line added since the last
# sync is found in a file the index already names
"$CG" config set sync.auto off >/dev/null
printf 'export const alias = formatName("x", "y");\n' >> src/util.ts
out="$("$CG" grep formatName --path src/util.ts)"
has "$out" "src/util.ts:8: export const alias = formatName"
"$CG" config set sync.auto on >/dev/null
# and with the freshness pass on, a token that did not exist at sync time
# (the pass reuses one younger than three seconds, as every read command's)
printf 'export function brandNewHelper() { return 1; }\n' >> src/util.ts
sleep 3.2
out="$("$CG" grep brandNewHelper)"
has "$out" "in function brandNewHelper"
has "$out" "src/util.ts:9:"

# a file too large for the body index is skipped, and counted
python3 -c "
open('big.txt','w').write(('padding line without the word\n' * 80000) + 'formatName in a big file\n')"
"$CG" sync >/dev/null
out="$("$CG" grep formatName --json)"
[ "$(j "$out" "d['skipped']")" = 1 ] || fail "skipped count: $out"
hasnt "$out" "big.txt"
rm big.txt
"$CG" sync >/dev/null

# branches: a linked worktree's files (reused from their byte-identical
# twins, so their trigrams come through the reuse path) answer on their own
# branch, and --all-branches labels each hit with the branch it came from
(git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; })
printf '.codegraph/\n' >> .git/info/exclude
git -c user.email=t@t -c user.name=t add -A
git -c user.email=t@t -c user.name=t commit -qm base
"$CG" sync >/dev/null
git worktree add -q "$TMP/wt" -b side
cd "$TMP/wt"
printf 'export function sideOnlyThing() { return formatName("a", "b"); }\n' > src/side.ts
"$CG" sync >/dev/null
out="$("$CG" grep formatName --path src/util.ts)"
has "$out" "src/util.ts:1:"                  # reused rows still narrow
out="$("$CG" grep sideOnlyThing)"
has "$out" "src/side.ts:1:"
has "$out" "in function sideOnlyThing"
cd "$TMP/proj"
out="$("$CG" grep sideOnlyThing)"
has "$out" "0 hits"
out="$("$CG" grep sideOnlyThing --branch side)"
has "$out" "src/side.ts:1:"
out="$("$CG" grep formatName --all-branches --json)"
python3 - "$out" <<'EOF'
import json, sys
d = json.loads(sys.argv[1])
branches = {h.get("branch") for h in d["hits"]}
assert {"main", "side"} <= branches, branches
side = [h for h in d["hits"] if h["path"] == "src/side.ts"]
assert side and side[0]["branch"] == "side", d["hits"]
EOF

# grep_code over MCP: listed read-only, and answering; cg tool call too
printf '%s\n%s\n%s\n' \
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}' \
'{"jsonrpc":"2.0","id":2,"method":"tools/list"}' \
'{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"grep_code","arguments":{"pattern":"formatName","path":["src/server.ts"],"limit":2}}}' \
| "$CG" mcp > "$TMP/mcp.out"
python3 - "$TMP/mcp.out" <<'EOF'
import json, sys
msgs = {m["id"]: m for m in map(json.loads, open(sys.argv[1])) if "id" in m}
tools = {t["name"]: t for t in msgs[2]["result"]["tools"]}
g = tools["grep_code"]
assert g["annotations"]["readOnlyHint"] is True, g
props = g["inputSchema"]["properties"]
for k in ("pattern", "regex", "case_sensitive", "path", "lang", "symbol",
          "no_tests", "context", "limit", "budget"):
    assert k in props, k
assert "grep" in g["description"], g["description"]
text = msgs[3]["result"]["content"][0]["text"]
d = json.loads(text)
assert len(d["hits"]) == 2 and d["omitted"] == 2, d
assert all(h["path"] == "src/server.ts" for h in d["hits"]), d
EOF
out="$("$CG" tool call grep_code '{"pattern":"load_tasks","regex":false,"symbol":"save_tasks"}')"
python3 - "$out" <<'EOF'
import json, sys
d = json.loads(sys.argv[1])
assert d["total"] == 1 and d["hits"][0]["symbol"] == "save_tasks", d
EOF

echo "PASS 44_grep"
