#!/usr/bin/env bash
# explore: prototypes are declarations that answer through their
# definitions, a path query gets the file's or directory's outline, phrase
# queries rank names over docs over bodies and source over tests, and
# context fills its budget without passing it. Fixture: fixtures/explore.
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/explore/proj" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null 2>&1

# the symbol rows of search output: everything before the full-text block
sym_rows() { printf '%s\n' "$1" | sed '/full-text matches/,$d' | grep -v '^$' || true; }
# 1-based line of the first line containing a fixed string, 0 when absent
at() { printf '%s\n' "$1" | grep -nF -m1 -- "$2" | cut -d: -f1 || true; }
before() {
    local a b
    a=$(at "$1" "$2"); b=$(at "$1" "$3")
    [ -n "$a" ] || fail "expected '$2' in output"
    [ -n "$b" ] || fail "expected '$3' in output"
    [ "$a" -lt "$b" ] || fail "expected '$2' before '$3'"
}

# ---------------- ac_1: definition first, prototype doc carried ----------------
# (a) the prototype is recorded, as a declaration
out="$("$CG" symbol memory_export --json)"
has "$out" '"path":"src/store.h","line":11'
has "$out" '"decl":true'
# (b) symbol: the definition answers first and carries the header's doc
out="$("$CG" symbol memory_export)"
before "$out" "src/store.c:14" "src/store.h:11"
before "$out" "Write every memory in the store" "src/store.h:11"
# (c) show: definition first
out="$("$CG" show memory_export)"
before "$out" "src/store.c:14-18" "src/store.h:11"
# (d) search: one row for the function, the definition's
rows="$(sym_rows "$("$CG" search memory_export)")"
has "$(printf '%s\n' "$rows" | head -1)" "src/store.c:14"
hasnt "$rows" "src/store.h:11"
# (e) context: the definition, with the prototype's doc
out="$("$CG" context memory_export --json)"
python3 - "$out" <<'PY' || fail "context must answer with the documented definition"
import json, sys
d = json.loads(sys.argv[1])
s = [x for x in d["symbols"] if "name" in x][0]
assert s["path"] == "src/store.c" and s["line"] == 14, s
assert "Write every memory" in json.dumps(s.get("doc", "")), s
PY

# ---------------- ac_2: a declaration ends at its own terminator ----------------
out="$("$CG" show memory_export)"
has "$out" "src/store.h:11-12"
hasnt "$out" "18│ /* Release"
# no phantom callers: store_close is called from main and the test only
out="$("$CG" context store_close)"
has "$out" "main src/main.c:6"
hasnt "$out" "memory_export src/store.h"
out="$("$CG" symbol memory_import)"
has "$out" "src/store.c:20 (referenced 1×)"

# ---------------- ac_3: a path query gets an outline ----------------
out="$("$CG" context src/store.h)"
has "$out" "file src/store.h — 23 lines, 5 symbols"
has "$out" "The memory store: an append-only list"
has "$out" "memory_export                :11"
has "$out" "memory_import                :16"
has "$out" "store_close                  :19"
has "$out" "store_count                  :21"
has "$out" "imports: stdio.h"
has "$out" "depended on by:"
has "$out" "  src/main.c"
has "$out" "  src/store.c"
hasnt "$out" "● "                         # an outline, not a phrase search
out="$("$CG" context ./src/store.h --json)"
python3 - "$out" <<'PY' || fail "file outline json"
import json, sys
raw = sys.argv[1]
d = json.loads(raw)
assert d["kind"] == "file" and d["path"] == "src/store.h", d
names = [s["name"] for s in d["symbols"]]
assert names[:2] == ["STORE_H", "memory_export"], names
assert all("line" in s and "sig" in s and "kind" in s for s in d["symbols"])
assert d["imports"] == ["stdio.h"], d["imports"]
assert "src/main.c" in d["dependents"] and "src/store.c" in d["dependents"]
assert d["tokens_used"] <= d["budget"] and len(raw) <= d["budget"] * 4
PY
# a unique basename resolves to its file
has "$("$CG" context store.h)" "file src/store.h"
# a directory: its files, purpose lines and symbol counts
out="$("$CG" context src/)"
has "$out" "directory src/"
has "$out" "src/store.h"
has "$out" "5 sym  /* The memory store"
has "$out" "src/store.c"
hasnt "$out" "web/memories.ts"
out="$("$CG" context src --json)"
python3 - "$out" <<'PY' || fail "directory outline json"
import json, sys
d = json.loads(sys.argv[1])
assert d["kind"] == "dir", d
f = {x["path"]: x for x in d["files"]}
assert set(f) == {"src/main.c", "src/store.c", "src/store.h"}, f
assert f["src/store.h"]["symbols"] == 5 and f["src/store.h"]["purpose"]
PY
# both stay inside a small budget and count what they left out
for q in src/store.h src; do
    out="$("$CG" context "$q" --json --budget 70)"
    python3 - "$out" <<'PY' || fail "outline of $q must fit 70 tokens"
import json, sys
raw = sys.argv[1]
d = json.loads(raw)
assert len(raw) <= 70 * 4 and d["tokens_used"] <= 70, (len(raw), d)
assert d["omitted"] > 0, d
PY
done

# ---------------- ac_4/ac_5: phrase queries ----------------
# (a) the words index: name words split both ways, no LIKE scan needed
python3 - <<'PY' || fail "symbol_fts must carry name words"
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
w = dict(db.execute("SELECT name, words FROM symbol_fts WHERE name IN "
                    "('memory_export','exportMemory')").fetchall())
assert w == {"memory_export": "memory export",
             "exportMemory": "export memory"}, w
PY
out="$("$CG" search "export memory")"
rows="$(sym_rows "$out")"
top2="$(printf '%s\n' "$rows" | head -2)"
has "$top2" "memory_export"
has "$top2" "exportMemory"
# (b) source over tests and generated files
before "$rows" "exportMemory" "test_export_memory"
before "$rows" "exportMemory" "export_memory_message"
# (c) stopwords drop, docs match: a prototype's doc finds the definition
rows="$(sym_rows "$("$CG" search "keep each memory that is not already stored")")"
has "$(printf '%s\n' "$rows" | head -1)" "memory_import"
has "$(printf '%s\n' "$rows" | head -1)" "src/store.c:20"
# (d) a name hit outranks a doc hit for the same word
rows="$(sym_rows "$("$CG" search "notes archive")")"
has "$(printf '%s\n' "$rows" | head -1)" "snapshot_notes"
# (e) bodies match too: the only mention of tmpfile is inside a test body
rows="$(sym_rows "$("$CG" search "tmpfile rewind")")"
has "$rows" "test_export_memory"

# ---------------- ac_6: context fills the budget, never passes it ----------------
for b in 120 400 4000; do
    out="$("$CG" context "export memory" --json --budget "$b")"
    python3 - "$out" "$b" <<'PY' || fail "context must stay inside budget $b"
import json, sys
raw, b = sys.argv[1], int(sys.argv[2])
d = json.loads(raw)
assert d["budget"] == b and len(raw) <= b * 4, (len(raw), b)
assert 0 < d["tokens_used"] <= b, d
assert isinstance(d["omitted"], int)
if b == 120:
    assert d["omitted"] > 0, d
if b == 4000:
    assert d["omitted"] == 0, d
    syms = [s for s in d["symbols"] if "name" in s]
    assert len(syms) >= 5, syms
    # undocumented hits carry their opening lines
    m = [s for s in syms if s["name"] == "main"][0]
    assert "store_close(s);" in m.get("snippet", ""), m
PY
done

# ---------------- ac_7: file hits show the line; source first ----------------
out="$("$CG" search "export memory")"
files="$(printf '%s\n' "$out" | sed -n '/full-text matches/,$p')"
has "$files" "src/store.c:14  int memory_export(Store *s, FILE *out) {"
has "$files" "src/main.c:8  int n = memory_export(s, stdout);"
before "$files" "src/store.c:14" "tests/test_store.c"
before "$files" "src/main.c:8" "gen/notes_pb2.py"
out="$("$CG" search "export memory" --json)"
python3 - "$out" <<'PY' || fail "search json: file hits carry their line text"
import json, sys
d = json.loads(sys.argv[1])
f = [x for x in d["files"] if "path" in x]
assert all("line" in x and "text" in x and "excerpt" in x for x in f), f
paths = [x["path"] for x in f]
assert paths.index("tests/test_store.c") > paths.index("src/store.c"), paths
PY

# ---------------- ac_8: the gold queries land in the top 3 ----------------
miss=""
while IFS=$'\t' read -r q want; do
    [ -n "$q" ] || continue
    top="$(sym_rows "$("$CG" search "$q")" | head -3)"
    case "$top" in *" $want "*) : ;; *) miss="$miss
  '$q' -> $want" ;; esac
done < "$FIXTURES/explore/gold.tsv"
[ -z "$miss" ] || fail "gold queries outside the top 3:$miss"

echo ok
