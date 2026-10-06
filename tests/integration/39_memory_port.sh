#!/usr/bin/env bash
# memory transport: cg memory export / import and the MCP tools over them.
#   export   — header + one object per memory, content ids, filters, -o,
#              byte-identical repeats
#   import   — round trip into an empty project, idempotence, supersession
#              in any line order, full-text index in step, provenance
#   refusals — dry run, malformed lines, unknown format, newer version
#   graphs   — --from DIR read-only, an older schema, self-import refused
#   rewrite  — unknown branch cleared vs --keep-branch, --retask, stdin
#   mcp      — memory_export and memory_import
. "$(dirname "$0")/../lib.sh"

# python over a graph: db(path) -> sqlite3 connection
pydb() { python3 -c "import sqlite3,sys,json; db=lambda p: sqlite3.connect(p); $1"; }

newproj() {
    cp -r "$FIXTURES/sample" "$TMP/$1"
    (cd "$TMP/$1" && "$CG" init >/dev/null)
}

# ---- a source project with a superseded decision and a classified note ----
newproj a
cd "$TMP/a"
"$CG" remember "Chose trigram FTS for symbol search" --type decision \
    --task demo/1.1 --symbols cmd_search --files src/graph.c >/dev/null
"$CG" remember "Never store secrets in memory" --type constraint \
    --task demo/1.2 >/dev/null
"$CG" remember "Old idea: LIKE scans" --type decision --task other/2.1 >/dev/null
"$CG" remember "New idea: FTS5 prefix" --type decision --task other/2.1 \
    --supersedes 3 >/dev/null
"$CG" remember "Untagged fact with \"quotes\", a tab	and a line
break" --type fact --task "" >/dev/null
# Jev's verdict and an old timestamp, set the way classify and time would
pydb "
c = db('$TMP/a/.codegraph/graph.db')
c.execute(\"UPDATE memories SET class='skill', confidence=0.85 WHERE id=1\")
c.execute('UPDATE memories SET created=created-40*86400 WHERE id=1')
c.execute('UPDATE memories SET created=created-20*86400 WHERE id=2')
c.commit()"

# ---- ac_1: header line, then one object per memory ----
"$CG" memory export > "$TMP/all.jsonl"
python3 - "$TMP/all.jsonl" <<'EOF' || fail "export format"
import json, sys, hashlib
lines = open(sys.argv[1]).read().splitlines()
h = json.loads(lines[0])
assert h["format"] == "codify-memories" and h["version"] == 1, h
assert h["project"] == "a" and h["cg_version"] and h["count"] == 5, h
rows = [json.loads(l) for l in lines[1:]]
assert len(rows) == 5, rows
keys = ["id", "created", "type", "task", "body", "symbols", "files", "source",
        "branch", "class", "confidence", "superseded_by", "superseded_at"]
for r in rows:
    assert list(r) == keys, list(r)
    want = hashlib.sha256("\x1f".join([r["type"], r["task"] or "", r["body"]])
                          .encode()).hexdigest()
    assert r["id"] == want, (r, want)
# ordered by created then id: the back-dated memories lead
assert rows[0]["body"].startswith("Chose trigram"), rows[0]
assert rows[1]["body"].startswith("Never store"), rows[1]
c = rows[0]
assert c["class"] == "skill" and c["confidence"] == 0.85, c
assert c["symbols"] == "cmd_search" and c["files"] == "src/graph.c", c
assert c["task"] == "demo/1.1" and c["source"] == "manual", c
old = [r for r in rows if r["body"].startswith("Old idea")][0]
new = [r for r in rows if r["body"].startswith("New idea")][0]
assert old["superseded_by"] == new["id"] and old["superseded_at"] > 0, old
assert new["superseded_by"] is None, new
f = [r for r in rows if r["type"] == "fact"][0]
assert f["task"] is None and '"quotes"' in f["body"] and "\n" in f["body"], f
EOF

# repeated exports are byte-identical
"$CG" memory export > "$TMP/all2.jsonl"
cmp -s "$TMP/all.jsonl" "$TMP/all2.jsonl" || fail "two exports differ"

# filters: task (exact and prefix), type, since, branch (any name)
count() { head -1 | python3 -c "import json,sys; print(json.load(sys.stdin)['count'])"; }
[ "$("$CG" memory export --task demo/1.1 | count)" = 1 ] || fail "--task exact"
[ "$("$CG" memory export --task demo | count)" = 2 ] || fail "--task prefix"
[ "$("$CG" memory export --task dem | count)" = 0 ] || fail "--task boundary"
[ "$("$CG" memory export --type decision | count)" = 3 ] || fail "--type"
[ "$("$CG" memory export --since 30 | count)" = 4 ] || fail "--since 30"
[ "$("$CG" memory export --since 7 | count)" = 3 ] || fail "--since 7"
[ "$("$CG" memory export --branch no-such-branch | count)" = 0 ] \
    || fail "--branch filter on an untracked name"
out="$("$CG" memory export -o "$TMP/demo.jsonl" --task demo)"
has "$out" "exported 2 memories to $TMP/demo.jsonl"
[ "$(head -1 "$TMP/demo.jsonl" | count)" = 2 ] || fail "-o file"
out="$("$CG" memory export -o "$TMP/demo2.jsonl" --task demo --json)"
has "$out" '"exported":2'

# ---- ac_2/ac_3: round trip into an empty project ----
newproj b
cd "$TMP/b"
out="$("$CG" memory import "$TMP/all.jsonl")"
has "$out" "5 imported, 0 skipped (already present), 0 invalid, 1 supersession relinked"
python3 - "$TMP/a" "$TMP/b" <<'EOF' || fail "round trip"
import json, subprocess, sys, os
def recall(d):
    out = subprocess.check_output([os.environ["CG"], "recall", "--json", "-n", "50"], cwd=d)
    return json.loads(out)["memories"]
fields = ["body", "type", "task", "symbols", "files", "class", "created"]
key = lambda m: tuple(str(m.get(f)) for f in fields)
a, b = recall(sys.argv[1]), recall(sys.argv[2])
assert sorted(map(key, a)) == sorted(map(key, b)), (a, b)
bb = {m["body"]: m for m in b}
assert bb["Chose trigram FTS for symbol search"]["confidence"] == 0.85, bb
for m in b:
    assert m["source"] == "import:a/manual", m
# the superseded memory still sorts last on the target
assert b[-1]["body"].startswith("Old idea"), [m["body"] for m in b]
EOF
pydb "
c = db('$TMP/b/.codegraph/graph.db')
rows = c.execute('''SELECT o.body, n.body FROM memory_superseded s
    JOIN memories o ON o.id=s.id JOIN memories n ON n.id=s.by_id''').fetchall()
assert rows == [('Old idea: LIKE scans', 'New idea: FTS5 prefix')], rows
" || fail "supersession restored"
# the full-text index is in step: recall by a word finds the import
out="$("$CG" recall trigram)"
has "$out" "Chose trigram FTS"
out="$("$CG" recall prefix)"
has "$out" "New idea"

# one summary event, not one per row
"$CG" events --kind "memory.*" --json -n 100 | python3 -c "
import json, sys
ev = [json.loads(l) for l in sys.stdin if l.strip()]
kinds = [e['kind'] for e in ev]
assert kinds.count('memory.import') == 1, kinds
assert 'memory.add' not in kinds, kinds
p = [e for e in ev if e['kind'] == 'memory.import'][0]['payload']
assert p['imported'] == 5 and p['project'] == 'a', p
" || fail "import event"

# ---- ac_3: a second import changes nothing ----
snap() {
    pydb "
c = db('$TMP/b/.codegraph/graph.db')
print(c.execute('SELECT * FROM memories ORDER BY id').fetchall())
print(c.execute('SELECT * FROM memory_superseded ORDER BY id').fetchall())
print(c.execute('SELECT rowid, body FROM memory_fts ORDER BY rowid').fetchall())
print(c.execute('SELECT max(seq) FROM events').fetchall())"
}
before="$(snap)"
out="$("$CG" memory import "$TMP/all.jsonl" --json)"
has "$out" '"imported":0,"skipped":5,"invalid":0,"relinked":0'
[ "$(snap)" = "$before" ] || fail "second import changed the graph"

# ---- supersession in any line order, and in two separate imports ----
newproj c
cd "$TMP/c"
{ head -1 "$TMP/all.jsonl"; tail -n +2 "$TMP/all.jsonl" | tac; } > "$TMP/rev.jsonl"
out="$("$CG" memory import "$TMP/rev.jsonl")"
has "$out" "1 supersession relinked"
newproj c2
cd "$TMP/c2"
{ head -1 "$TMP/all.jsonl"; grep '"Old idea' "$TMP/all.jsonl"; } > "$TMP/old.jsonl"
{ head -1 "$TMP/all.jsonl"; grep '"New idea' "$TMP/all.jsonl"; } > "$TMP/new.jsonl"
"$CG" memory import "$TMP/old.jsonl" >/dev/null
out="$("$CG" memory import "$TMP/new.jsonl")"
has "$out" "1 imported"
has "$out" "0 supersessions relinked"     # the link travels on the old row
out="$("$CG" memory import "$TMP/old.jsonl")"     # skipped, but now linkable
has "$out" "0 imported, 1 skipped (already present), 0 invalid, 1 supersession relinked"

# ---- ac_4: --dry-run writes nothing ----
newproj d
cd "$TMP/d"
snapd() { pydb "
c = db('$TMP/d/.codegraph/graph.db')
print(c.execute('SELECT count(*) FROM memories').fetchall(),
      c.execute('SELECT count(*) FROM memory_superseded').fetchall(),
      c.execute('SELECT max(seq) FROM events').fetchall())"; }
before="$(snapd)"
out="$("$CG" memory import "$TMP/all.jsonl" --dry-run)"
has "$out" "nothing written"
has "$out" "5 imported, 0 skipped (already present), 0 invalid, 1 supersession relinked"
out="$("$CG" memory import "$TMP/all.jsonl" --dry-run --json)"
has "$out" '"dry_run":true'
has "$out" '"imported":5'
[ "$(snapd)" = "$before" ] || fail "dry run wrote"

# ---- ac_4: a malformed line is reported by number; the rest imports ----
hdr="$(head -1 "$TMP/all.jsonl")"
{
    echo "$hdr"
    echo '{"type":"fact","task":null,"body":"good line one","created":1700000000}'
    echo '{"type":"fact","body":"cut off mid-str'
    echo '{"type":"fact","created":1700000000}'
    echo '{"type":"Not A Type!","body":"x"}'
    echo ''
    echo '{"type":"decision","body":"good line two","created":1700000001,"class":"fact","confidence":0.5}'
} > "$TMP/bad.jsonl"
out="$("$CG" memory import "$TMP/bad.jsonl" 2>&1)"
has "$out" "line 3: bad JSON"
has "$out" "line 4: missing body"
has "$out" "line 5: unknown type"
has "$out" "2 imported, 0 skipped (already present), 3 invalid"
out="$("$CG" recall "good line" --json)"
has "$out" '"count":2'
has "$out" '"created":1700000001'
# a dry run reports the same lines
out="$("$CG" memory import "$TMP/bad.jsonl" --dry-run --json 2>/dev/null)"
has "$out" '"invalid":3'
has "$out" '{"line":3,"reason":"bad JSON"}'

# ---- ac_4: unknown format and newer version stop before any write ----
newproj e
cd "$TMP/e"
snape() { pydb "
c = db('$TMP/e/.codegraph/graph.db')
print(c.execute('SELECT count(*) FROM memories').fetchall(),
      c.execute('SELECT max(seq) FROM events').fetchall())"; }
before="$(snape)"
{ echo '{"format":"someone-else","version":1}'; tail -n +2 "$TMP/all.jsonl"; } > "$TMP/fmt.jsonl"
{ echo '{"format":"codify-memories","version":2,"project":"future"}'; tail -n +2 "$TMP/all.jsonl"; } > "$TMP/ver.jsonl"
expect_rc 1 "$CG" memory import "$TMP/fmt.jsonl"
out="$("$CG" memory import "$TMP/fmt.jsonl" 2>&1 || true)"
has "$out" "not a codify-memories header"
has "$out" "nothing imported"
expect_rc 1 "$CG" memory import "$TMP/ver.jsonl"
out="$("$CG" memory import "$TMP/ver.jsonl" 2>&1 || true)"
has "$out" "format version 2 is newer"
expect_rc 1 "$CG" memory import "$TMP/no-such-file.jsonl"
: > "$TMP/empty.jsonl"
expect_rc 1 "$CG" memory import "$TMP/empty.jsonl"
[ "$(snape)" = "$before" ] || fail "a refused import wrote"

# ---- ac_5: --from DIR reads another graph read-only ----
newproj f
cd "$TMP/f"
# the database file itself, byte for byte, and no write-ahead content: a
# read-only reader of a WAL database may leave SQLite's empty -wal and -shm
# companions behind, but never a frame of data
sums() {
    sha256sum "$TMP/a/.codegraph/graph.db"
    [ ! -s "$TMP/a/.codegraph/graph.db-wal" ] || echo "wal has frames"
}
before="$(sums)"
out="$("$CG" memory import --from "$TMP/a/src" --json)"
has "$out" '"project":"a"'
has "$out" '"imported":5'
has "$out" '"relinked":1'
[ "$(sums)" = "$before" ] || fail "--from wrote to the source graph"
out="$("$CG" memory import --from "$TMP/a")"
has "$out" "0 imported, 5 skipped"
expect_rc 1 "$CG" memory import --from "$TMP/f"
out="$("$CG" memory import --from . 2>&1 || true)"
has "$out" "cannot import itself"
expect_rc 1 "$CG" memory import --from /
# an older graph: no class, confidence, branch, nor supersession table
mkdir -p "$TMP/old/.codegraph"
pydb "
c = db('$TMP/old/.codegraph/graph.db')
c.execute('''CREATE TABLE memories(id INTEGER PRIMARY KEY, created INTEGER
    NOT NULL, type TEXT NOT NULL, task TEXT, body TEXT NOT NULL, symbols TEXT,
    files TEXT, source TEXT NOT NULL)''')
c.execute(\"INSERT INTO memories VALUES(1,1600000000,'decision','legacy/1',\"
          \"'A decision from an old graph',NULL,NULL,'manual')\")
c.commit()"
oldsum="$(sha256sum "$TMP/old/.codegraph/graph.db")"
out="$("$CG" memory import --from "$TMP/old")"
has "$out" "memory import from old: 1 imported"
[ "$(sha256sum "$TMP/old/.codegraph/graph.db")" = "$oldsum" ] \
    || fail "--from upgraded an old graph"
out="$("$CG" recall "old graph" --json)"
has "$out" '"created":1600000000'
has "$out" '"source":"import:old/manual"'

# ---- ac_6: unknown branch cleared unless --keep-branch; --retask ----
mkdir -p "$TMP/g"
cd "$TMP/g"
git init -q -b main . 2>/dev/null || { git init -q . && git checkout -q -b main; }
echo 'int main(void){return 0;}' > m.c
"$CG" init >/dev/null
tracked="$("$CG" info --json | python3 -c "import json,sys; print(json.load(sys.stdin)['branch'])")"
[ "$tracked" = main ] || fail "expected the g project on main, got $tracked"
{
    echo "$hdr"
    echo '{"type":"decision","task":"demo/3.1","body":"made on a ghost branch","created":1700000100,"branch":"ghost"}'
    echo '{"type":"decision","task":"demo/3.2","body":"made on main","created":1700000101,"branch":"main"}'
    echo '{"type":"fact","task":"demox/1","body":"near miss for retask","created":1700000102}'
    echo '{"type":"fact","task":"demo","body":"bare feature tag","created":1700000103}'
} > "$TMP/br.jsonl"
cp -r "$TMP/g" "$TMP/g2"
out="$("$CG" memory import "$TMP/br.jsonl" --retask demo=proj --json)"
has "$out" '"imported":4'
has "$out" '"branches_cleared":1'
pydb "
c = db('$TMP/g/.codegraph/graph.db')
r = dict((b, (t, br)) for b, t, br in c.execute('SELECT body, task, branch FROM memories'))
assert r['made on a ghost branch'] == ('proj/3.1', None), r
assert r['made on main'] == ('proj/3.2', 'main'), r
assert r['near miss for retask'] == ('demox/1', None), r
assert r['bare feature tag'] == ('proj', None), r
" || fail "branch clearing / retask"
# cleared means visible: recall on main sees the ghost-branch decision
out="$("$CG" recall ghost)"
has "$out" "made on a ghost branch"
cd "$TMP/g2"
out="$("$CG" memory import "$TMP/br.jsonl" --keep-branch --json)"
has "$out" '"branches_cleared":0'
pydb "
c = db('$TMP/g2/.codegraph/graph.db')
r = dict(c.execute('SELECT body, branch FROM memories'))
assert r['made on a ghost branch'] == 'ghost', r
" || fail "--keep-branch"
expect_rc 1 "$CG" memory import "$TMP/br.jsonl" --retask demo
expect_rc 1 "$CG" memory import "$TMP/br.jsonl" --retask =x

# ---- stdin ----
newproj h
cd "$TMP/a"
"$CG" memory export --type constraint | (cd "$TMP/h" && "$CG" memory import -) > "$TMP/h.out"
has "$(cat "$TMP/h.out")" "1 imported"
cd "$TMP/h"
out="$("$CG" recall secrets)"
has "$out" "Never store secrets"

# usage names the subcommands
out="$("$CG" memory nope 2>&1 || true)"
has "$out" "export"
has "$out" "import"

# ---- ac_7: the MCP tools run the same paths ----
newproj m
cd "$TMP/m"
python3 - "$TMP/all.jsonl" "$TMP/a" <<'EOF' > "$TMP/mcp.in"
import json, sys
data = open(sys.argv[1]).read()
reqs = [
    {"jsonrpc": "2.0", "id": 1, "method": "initialize",
     "params": {"protocolVersion": "2025-06-18"}},
    {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
    {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {
        "name": "memory_import", "arguments": {"data": data, "dry_run": True}}},
    {"jsonrpc": "2.0", "id": 4, "method": "tools/call", "params": {
        "name": "memory_import", "arguments": {"data": data}}},
    {"jsonrpc": "2.0", "id": 5, "method": "tools/call", "params": {
        "name": "memory_import", "arguments": {"from": sys.argv[2]}}},
    {"jsonrpc": "2.0", "id": 6, "method": "tools/call", "params": {
        "name": "memory_export", "arguments": {"task": "demo"}}},
    {"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {
        "name": "memory_import", "arguments": {"data": '{"format":"x","version":1}\n'}}},
]
for r in reqs:
    print(json.dumps(r))
EOF
"$CG" mcp < "$TMP/mcp.in" > "$TMP/mcp.out"
python3 - "$TMP/mcp.out" "$TMP/demo.jsonl" <<'EOF' || fail "mcp memory tools"
import json, sys
by = {l["id"]: l for l in map(json.loads, open(sys.argv[1])) if "id" in l}
tools = {t["name"]: t for t in by[2]["result"]["tools"]}
assert tools["memory_export"]["annotations"]["readOnlyHint"] is True
assert tools["memory_import"]["annotations"]["readOnlyHint"] is False
text = lambda i: by[i]["result"]["content"][0]["text"]
dry = json.loads(text(3))
assert dry["dry_run"] is True and dry["imported"] == 5, dry
real = json.loads(text(4))
assert real["dry_run"] is False and real["imported"] == 5, real
assert real["relinked"] == 1, real
again = json.loads(text(5))
assert again["imported"] == 0 and again["skipped"] == 5, again
lines = text(6).splitlines()
assert json.loads(lines[0])["count"] == 2, lines[0]
# the same memories, by content id and time, the CLI exported from the source
ids = lambda ls: [(json.loads(l)["id"], json.loads(l)["created"]) for l in ls]
assert ids(lines[1:]) == ids(open(sys.argv[2]).read().splitlines()[1:]), lines
assert all(json.loads(l)["source"] == "import:a/manual" for l in lines[1:])
assert by[7]["result"]["isError"] is True, by[7]
assert "not a codify-memories header" in text(7), text(7)
EOF

echo "39_memory_port ok"
