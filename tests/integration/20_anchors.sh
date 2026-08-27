#!/usr/bin/env bash
# the intent layer: comment spans captured, classified, bound, and searchable
. "$(dirname "$0")/../lib.sh"

cp -r "$FIXTURES/anchors" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

dump() {
    python3 - <<'PY'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
q = """SELECT f.path, c.kind, coalesce(s.name,'-'), c.line, c.end_line, c.body
       FROM comments c JOIN files f ON f.id = c.file_id
       LEFT JOIN symbols s ON s.id = c.sym_id
       ORDER BY f.path, c.line"""
for path, kind, sym, ln, en, body in db.execute(q):
    print(f"{path} {kind} {sym} {ln}-{en} {body.splitlines()[0][:56]}")
PY
}
d="$(dump)"

# (a) file headers: the span that opens the file, in every comment syntax
has "$d" "core.c file - 1-2 /* Ledger core"
has "$d" "main.go file - 1-1 // Package main"
has "$d" "server.ts file - 1-3 /**"

# (b) doc: a span sitting directly on a definition binds to that symbol,
# and consecutive comment lines coalesce into one span
has "$d" "core.c doc post_entry 6-6 /* Post one entry"
has "$d" "main.go doc Reconcile 4-5 // Reconcile settles"
has "$d" "server.ts doc handle 5-5 /** Handle one request"

# (c) python keeps its intent in docstrings, which follow the def rather
# than precede it — the module docstring is the file header and a
# function's docstring binds to the function
has "$d" 'tasks.py file - 1-1 """Task storage'
has "$d" 'tasks.py doc load_tasks 7-7 """Read the task list'
# a plain hash comment directly above a def is still that def's doc
has "$d" "tasks.py doc save_tasks 12-12 # Merge new tasks"

# (d) inline: a span inside a symbol's scope binds to the enclosing symbol,
# and a comment trailing code never becomes a doc for the next definition
has "$d" "core.c inline post_entry 8-8 /* trailing note"
has "$d" "core.c inline post_entry 9-9 /* an inline step marker"
has "$d" "main.go inline Reconcile 7-7 // trailing"
has "$d" "tasks.py inline save_tasks 14-14 # step: read before write"

# (e) orphan: attached to nothing, and not promoted to a file header just
# because no definition precedes it
has "$d" "core.c orphan - 13-13 // a stray note"

# (f) the stray note above untouched() is separated by a blank line, so it
# is not that function's doc
hasnt "$d" "core.c doc untouched"

# (g) comment prose is searchable on its own, separately from body_fts
out="$(python3 - <<'PY'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
q = """SELECT f.path, c.kind, c.body FROM comment_fts x
       JOIN comments c ON c.id = x.rowid
       JOIN files f ON f.id = c.file_id
       WHERE comment_fts MATCH 'idempotent'"""
for (p, k, b) in db.execute(q):
    print(p, k, b.splitlines()[-1][:80])
PY
)"
has "$out" "main.go doc"
has "$out" "never retry it blind"

# (g2) the prose index carries anchors and multi-line notes; a single-line
# inline label stays in `comments`, bound to its symbol, but out of the
# prose index — it is a label, not an explanation
out="$(python3 - <<'PY'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
q = """SELECT c.kind, c.line, c.end_line, (x.rowid IS NOT NULL) AS indexed, c.body
       FROM comments c LEFT JOIN comment_fts x ON x.rowid = c.id
       JOIN files f ON f.id = c.file_id WHERE f.path LIKE '%core.c'"""
for kind, ln, en, idx, body in db.execute(q):
    print(f"{kind} {ln}-{en} fts={idx} {body.splitlines()[0][:34]}")
PY
)"
has "$out" "file 1-2 fts=1"          # a file header is always an anchor
has "$out" "doc 6-6 fts=1"           # so is a doc, even on one line
has "$out" "inline 8-8 fts=0"        # a single-line label is not indexed
has "$out" "inline 9-9 fts=0"
# ...but it is still stored and bound, which is what ac 1.4 asks for
has "$d" "core.c inline post_entry 8-8 /* trailing note"

# (h) re-indexing an unchanged tree does not duplicate spans
before="$(dump | wc -l)"
sleep 1
touch core.c
"$CG" sync >/dev/null
after="$(dump | wc -l)"
[ "$before" = "$after" ] || fail "span count changed on reindex: $before -> $after"

# (i) editing a file replaces only its own spans
printf '\n/* appended note */\n' >> core.c
"$CG" sync >/dev/null
d2="$(dump)"
has "$d2" "core.c orphan - 17-17 /* appended note"
has "$d2" "main.go doc Reconcile 4-5 // Reconcile settles"

# ---------------- task 2.1: doc-first retrieval ----------------

# (j) a doc'd symbol leads with intent: context shows the doc and the
# signature line, never the body lines the doc replaces
out="$("$CG" context 'post entry ledger')"
has "$out" "Post one entry. Callers must hold the ledger lock"
has "$out" "int post_entry(int amount) {"
hasnt "$out" "int fee = amount / 100"

# the deep view keeps the body and the doc leads it
out="$("$CG" symbol post_entry)"
has "$out" "Post one entry"
has "$out" "int fee = amount / 100"

# json carries the doc as its own field
out="$("$CG" context 'post entry ledger' --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
s = next(s for s in d['symbols'] if s.get('name') == 'post_entry')
assert 'Callers must hold the ledger lock' in s['doc'], s
assert 'int fee' not in s.get('snippet',''), s
"

# (k) no doc — the body-line fallback is unchanged
out="$("$CG" context untouched)"
has "$out" "int untouched(void) { return 0; }"

# (l) staleness is derived from anchored_hash against the current body.
# Baseline with the true hash computed OUTSIDE cg — this locks the byte
# range hash_lines uses — and the render stays quiet; poison the hash and
# the render says stale rather than presenting the doc as current.
python3 - <<'EOF'
import sqlite3, hashlib
db = sqlite3.connect(".codegraph/graph.db")
ln, en = db.execute("SELECT line, end_line FROM symbols WHERE name='post_entry'").fetchone()
data = open("core.c", "rb").read()
off = [0] + [i + 1 for i, ch in enumerate(data) if ch == 0x0a]
stop = off[en] if en < len(off) else len(data)
h = hashlib.sha256(data[off[ln-1]:stop]).hexdigest()
db.execute("UPDATE comments SET anchored_hash=? WHERE kind='doc' "
           "AND sym_id=(SELECT id FROM symbols WHERE name='post_entry')", (h,))
db.commit()
EOF
out="$("$CG" context 'post entry ledger')"
hasnt "$out" "stale"
python3 - <<'EOF'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
db.execute("UPDATE comments SET anchored_hash='0'||substr(anchored_hash,2) "
           "WHERE kind='doc' AND sym_id=(SELECT id FROM symbols WHERE name='post_entry')")
db.commit()
EOF
out="$("$CG" context 'post entry ledger')"
has "$out" "[stale"
out="$("$CG" context 'post entry ledger' --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
s = next(s for s in d['symbols'] if s.get('name') == 'post_entry')
assert s.get('doc_stale') is True, s
"
python3 - <<'EOF'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
db.execute("UPDATE comments SET anchored_hash=NULL")
db.commit()
EOF

# (m) an over-long doc truncates on a line and says so
{
    echo '/* Contract:'
    for i in $(seq 1 40); do echo " * term $i of the long service contract holds here"; done
    echo ' */'
    echo 'int megadoc(void) { return 1; }'
} > mega.c
"$CG" sync >/dev/null
out="$("$CG" context megadoc)"
has "$out" "(doc truncated)"
has "$out" "int megadoc(void)"
hasnt "$out" "term 40"

# ---------------- task 3.1: soft edges from anchor prose ----------------

# (n) anchors that name real things become refs kind='soft': a symbol
# mention attributed to the bound symbol, a path mention resolved to the
# file, a route mention resolved to the pattern — and prose words that
# match nothing stay silence, not edges
sd="$(python3 - <<'PY2'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
q = """SELECT f.path, r.name, coalesce(r.qual,'sym'), coalesce(s.name,'-')
       FROM refs r JOIN files f ON f.id=r.file_id
       LEFT JOIN symbols s ON s.id=r.sym_id
       WHERE r.kind='soft' ORDER BY f.path, r.name"""
for row in db.execute(q):
    print(" ".join(row))
PY2
)"
has "$sd" "main.go post_entry sym Reconcile"     # cross-language, from prose
has "$sd" "core.c main.go path -"                # file header names a file
has "$sd" "server.ts /api/tasks route serve"     # and a route that exists
hasnt "$sd" "bank"                               # prose words are not edges
hasnt "$sd" "disk"
hasnt "$sd" "invariants"

# (o) traversal labels the soft edge and --no-soft removes it
out="$("$CG" impact post_entry)"
has "$out" "Reconcile (soft)"
out="$("$CG" impact post_entry --no-soft)"
hasnt "$out" "Reconcile"
out="$("$CG" impact post_entry --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
r = next(c for c in d['callers'] if c.get('n') == 'Reconcile')
assert r.get('soft') is True, r
"

# (p) a parsed call is never displaced: save_tasks really calls load_tasks
# and its doc also names it — the call wins and carries no soft label
out="$("$CG" impact save_tasks)"
has "$out" "load_tasks"
hasnt "$out" "load_tasks (soft)"

# ---------------- task 4.1: anchor drift ----------------

# (q) the index writes baselines; a body edit with unchanged doc text goes
# stale; editing the doc text re-baselines and clears it
printf '\n/* seed note */\n' >> core.c
"$CG" sync >/dev/null           # content change: core.c docs get baselines
python3 - <<'PY2'
import sqlite3
db = sqlite3.connect(".codegraph/graph.db")
(ah,) = db.execute("""SELECT c.anchored_hash FROM comments c
    JOIN symbols s ON s.id=c.sym_id WHERE s.name='post_entry'
    AND c.kind='doc'""").fetchone()
assert ah and len(ah) == 64, ah
PY2
out="$("$CG" check 2>/dev/null)"
has "$out" "anchors current"

sed -i 's/    return amount - fee;/    fee += 0;\n    return amount - fee;/' core.c
"$CG" sync >/dev/null
out="$("$CG" check 2>/dev/null)"
has "$out" "1 stale anchor"
out="$("$CG" context 'post entry ledger')"
has "$out" "[stale"

sed -i 's|/\* Post one entry|/* Post one entry and its fee|' core.c
"$CG" sync >/dev/null
out="$("$CG" check 2>/dev/null)"
has "$out" "anchors current"
out="$("$CG" context 'post entry ledger')"
hasnt "$out" "[stale"

# (r) guard reports anchors this work made stale — warnings only, exit 0
mkdir -p spec/drift
cat > spec/workflow.kvx <<'EOF'
[meta]
active_feature = "drift"
EOF
cat > spec/drift/spec.kvx <<'EOF'
# drift check fixture
[meta]
feature = "drift"
[req.1]
title = "d"
ac_1 = "WHEN a body changes THE anchor SHALL warn."
[tasks]
[task.1]
title = "d"
[task.1.1]
title  = "edit the core"
status = "pending"
wave   = 1
touches = ["core.c"]
reqs   = ["1.1"]
EOF
"$CG" spec start 1.1 >/dev/null
"$CG" commit -m base >/dev/null
sed -i 's/    fee += 0;/    fee += 1;/' core.c
"$CG" sync >/dev/null
out="$("$CG" guard)" || fail "guard must not block on stale anchors"
has "$out" "1 anchor(s) went stale"
has "$out" "doc for post_entry"
out="$("$CG" guard --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
sa = d['stale_anchors']
assert len(sa) == 1 and sa[0]['symbol'] == 'post_entry', sa
"

# ---------------- task 4.2: cg survey — the tier below bodies ----------------

# (s) fresh copy: earlier sections mutated core.c and planted a spec
rm -rf "$TMP/svy" && cp -r "$FIXTURES/anchors" "$TMP/svy"
cd "$TMP/svy"
"$CG" init >/dev/null 2>&1

out="$("$CG" survey)"
has "$out" "survey of the whole tree (4 files)"
# file purpose lines and symbol docs with signatures...
has "$out" "core.c — /* Ledger core"
has "$out" "int post_entry(int amount)"
has "$out" "Callers must hold the ledger lock"
has "$out" "def load_tasks(path):"
# ...but never a body line
hasnt "$out" "return amount - fee"
hasnt "$out" "json.load(f)"
hasnt "$out" "return req; // echo"
hasnt "$out" "existing = load_tasks"
# uncovered symbols are named, not dropped
has "$out" "uncovered: untouched"

# server.ts purpose comes from the JSDoc text, not its /** fence
has "$out" "server.ts — HTTP surface for the anchors fixture"

# path scoping narrows; a prose query finds the file that talks about it
out="$("$CG" survey tasks.py)"
has "$out" "(1 file)"
has "$out" "tasks.py"
hasnt "$out" "core.c —"
out="$("$CG" survey "ledger lock")"
has "$out" "core.c"
hasnt "$out" "tasks.py —"

# JSON shape: purpose, docs with sig+line, uncovered, omitted count
out="$("$CG" survey --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['omitted'] == 0, d
files = {f['path']: f for f in d['files']}
assert len(files) == 4, files.keys()
c = files['core.c']
assert 'Ledger core' in c['purpose'], c
assert c['docs'][0]['name'] == 'post_entry', c
assert 'sig' in c['docs'][0] and c['docs'][0]['line'] == 7, c
assert c['uncovered'] == ['untouched'], c
assert files['main.go']['uncovered'] == [], files['main.go']
body_words = ('return amount', 'json.load', 'echo')
raw = json.dumps(d)
assert not any(w in raw for w in body_words), 'body text leaked into survey'
"

# a squeezed budget elides entries but says exactly how many
out="$("$CG" survey --budget 60 --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert len(d['files']) + d['omitted'] == 4, d
assert d['omitted'] > 0, d
"
out="$("$CG" survey --budget 60)"
has "$out" "omitted by the budget"

# (t) the hundred-file bound: a dense tree fits the default budget whole
rm -rf "$TMP/svybig" && mkdir -p "$TMP/svybig/src"
cd "$TMP/svybig"
python3 - <<'PY'
for i in range(100):
    with open(f"src/mod{i:03d}.ts", "w") as f:
        f.write(f"/** Module {i:03d}: owns the widget-{i} lifecycle and its retry policy. */\n\n")
        f.write(f"/** Start widget {i}. Callers must await stop{i:03d} first or state leaks. */\n")
        f.write(f"export function start{i:03d}(cfg: any) {{\n  return cfg;\n}}\n\n")
        f.write(f"/** Stop widget {i} and flush the queue before the pool closes. */\n")
        f.write(f"export function stop{i:03d}() {{\n  return null;\n}}\n\n")
        f.write(f"export function helper{i:03d}() {{\n  return 1;\n}}\n")
PY
"$CG" init >/dev/null 2>&1
out="$("$CG" survey --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert len(d['files']) == 100, len(d['files'])
assert d['omitted'] == 0, d
assert not any('return cfg' in json.dumps(f) for f in d['files']), 'body leaked'
"
out="$("$CG" survey)"
has "$out" "(100 files)"
hasnt "$out" "omitted by the budget"

# ---------------- task 5.1: cg anchors — health and backfill ----------------

# (u) coordination score, not popularity: a tiny utility called 12 times
# from 3 files must rank BELOW a long orchestrator referenced only twice
rm -rf "$TMP/coord" && mkdir -p "$TMP/coord"
cd "$TMP/coord"
cat > util.ts <<'EOF'
export function lower(s: any) {
  return s;
}

export function wrap(s: any) {
  return lower(s);
}
EOF
cat > orch.ts <<'EOF'
export function step1() {
  return 1;
}
export function step2() {
  return 2;
}
export function step3() {
  return 3;
}
export function step4() {
  return 4;
}
export function step5() {
  return 5;
}
export function orchestrate(cfg: any) {
  let total = 0;
  total += step1();
  total += step2();
  total += step3();
  total += step4();
  total += step5();
  if (total > 3) {
    total -= 1;
  }
  return cfg + total;
}
EOF
cat > a.ts <<'EOF'
import { wrap } from './util';
import { orchestrate } from './orch';
export function a() {
  return orchestrate(wrap(wrap(wrap(wrap(1)))));
}
EOF
cat > b.ts <<'EOF'
import { wrap } from './util';
import { orchestrate } from './orch';
export function b() {
  return orchestrate(wrap(wrap(wrap(wrap(2)))));
}
EOF
cat > c.ts <<'EOF'
import { wrap } from './util';
export function c() {
  return wrap(wrap(wrap(wrap(3))));
}
EOF
"$CG" init >/dev/null 2>&1

# premise: raw inbound count would put wrap first — prove it, then prove
# the ranking does not
python3 -c "
import sqlite3
db = sqlite3.connect('.codegraph/graph.db')
wrap = db.execute(\"SELECT COUNT(*) FROM refs WHERE name='wrap'\").fetchone()[0]
orch = db.execute(\"SELECT COUNT(*) FROM refs WHERE name='orchestrate'\").fetchone()[0]
assert wrap > orch, (wrap, orch)
"
out="$("$CG" anchors --uncovered --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
names = [u['name'] for u in d['uncovered']]
assert names[0] == 'orchestrate', names[:5]
assert names.index('orchestrate') < names.index('wrap'), names
o = d['uncovered'][0]
assert o['score'] == o['fanout'] * o['extent'] * o['files'], o
assert o['fanout'] == 5 and o['files'] == 2, o
assert d['uncovered_total'] >= 9, d['uncovered_total']
"
out="$("$CG" anchors)"
has "$out" "uncovered, by coordination score"
has "$out" "orchestrate"
has "$out" "5 callees"
has "$out" "backfill from the top"

# (v) drift meets the work list: cg anchors --stale names the outdated doc
# and cg check points at the command
rm -rf "$TMP/ah" && cp -r "$FIXTURES/anchors" "$TMP/ah"
cd "$TMP/ah"
"$CG" init >/dev/null 2>&1
sed -i 's/    return amount - fee;/    fee += 0;\n    return amount - fee;/' core.c
"$CG" sync >/dev/null
out="$("$CG" anchors --stale)"
has "$out" "1 stale"
has "$out" "post_entry"
hasnt "$out" "uncovered, by coordination score"
out="$("$CG" anchors --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert any(x['symbol'] == 'post_entry' for x in d['stale']), d['stale']
assert 'uncovered' in d and 'anchored' in d, sorted(d)
"
out="$("$CG" check 2>/dev/null)" || true
has "$out" "cg anchors --stale"

# (w) a repository that never adopted the convention: capture, retrieval,
# survey, and anchors all function on a tree with no comments at all
rm -rf "$TMP/bare" && mkdir -p "$TMP/bare"
cd "$TMP/bare"
cat > plain.ts <<'EOF'
export function alpha() {
  return beta();
}
export function beta() {
  return 1;
}
EOF
"$CG" init >/dev/null 2>&1
out="$("$CG" survey)"
has "$out" "(no file anchor)"
has "$out" "uncovered: alpha, beta"
out="$("$CG" context alpha --budget 500)" || fail "context must work unanchored"
has "$out" "alpha"
out="$("$CG" anchors --json)"
python3 -c "
import json
d = json.loads(r'''$out''')
assert d['anchored'] == 0 and d['symbols'] >= 2, d
assert d['stale'] == [], d
assert d['uncovered_total'] == 2, d
"

echo "ok 20_anchors"
