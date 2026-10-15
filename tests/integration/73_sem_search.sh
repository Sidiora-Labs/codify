#!/usr/bin/env bash
# Structured retrieval, posting lifecycle and explicit context limits.
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj/src" "$TMP/proj/tests"
cd "$TMP/proj"
cat > src/alpha.c <<'EOF'
/** Keep the decoder contract stable for account records. */
int parseUserRecord(int raw) {
    int decoded = raw + 7;
    return decoded * 2;
}
int overload(int x) {
    return parseUserRecord(x);
}
EOF
cat > src/beta.c <<'EOF'
int overload(int x) {
    return x + 19;
}
int parseUserReceipt(int x) {
    return overload(x);
}
EOF
cat > src/alpha.h <<'EOF'
/** Keep the decoder contract stable for account records. */
int parseUserRecord(int raw);
EOF
cat > tests/fixture.c <<'EOF'
int parseUserRecord(int raw) {
    return -raw;
}
EOF
git init -q -b main . 2>/dev/null || git init -q .
git config user.email t@t
git config user.name t
git add -A
git commit -qm base
"$CG" init >/dev/null

python3 - <<'PY'
import sqlite3
db=sqlite3.connect('.codegraph/graph.db')
rows=db.execute('SELECT p.segment,f.path FROM semantic_identifier_postings p '
                'JOIN files f ON f.id=p.file_id WHERE p.segment="record"').fetchall()
assert ('record','src/alpha.c') in rows, rows
assert ('record','tests/fixture.c') in rows, rows
PY

out="$("$CG" search record --json --kind function --lang c --path src)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
assert d['symbols'] and d['symbols'][0]['name']=='parseUserRecord', d
assert all(x['kind']=='function' and x['path'].startswith('src/') for x in d['symbols']), d
PY
out="$("$CG" search record --json --kind class)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert d['symbols']==[], d
PY
out="$("$CG" search record --json --name parseUserRecord --path src)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1])
assert [x['name'] for x in d['symbols']]==['parseUserRecord'], d
PY
out="$("$CG" search parseUserRecorb --json)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert any(x['name']=='parseUserRecord' for x in d['symbols']), d
assert d['weak_matches']>0, d
PY

req() { printf '%s\n' "$1" | "$CG" mcp 2>/dev/null; }
out="$(req '{"jsonrpc":"2.0","id":1,"method":"tools/list"}')"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); tools={t['name']:t for t in d['result']['tools']}
for tool in ('search_code','get_context'):
    fields=tools[tool]['inputSchema']['properties']
    assert all(x in fields for x in ('kind','name','lang','path')), fields
PY
out="$(req '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"search_code","arguments":{"query":"record","kind":"function","name":"parseUserRecord","path":"src"}}}')"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(json.loads(sys.argv[1])['result']['content'][0]['text'])
assert [x['path'] for x in d['symbols']]==['src/alpha.c'], d
PY
out="$(req '{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"get_context","arguments":{"query":"parseUserRecord","budget":200,"limit":2}}}')"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(json.loads(sys.argv[1])['result']['content'][0]['text'])
assert any(s.get('name')=='parseUserRecord' for s in d['symbols']), d
assert d['tokens_used']<=d['budget']==200, d
PY

out="$("$CG" context overload --json --budget 1200)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); r=[x for x in d['symbols'] if x.get('name')=='overload']
assert len(r)==2, r
assert all('return ' in x.get('snippet','') for x in r), r
assert d['tokens_used']<=d['budget'], d
PY
out="$("$CG" context parseUserRecord --json --budget 1000)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); r=next(x for x in d['symbols']
                                if x.get('name')=='parseUserRecord')
assert r.get('doc') and 'contract' in r['doc'], r
assert 'int decoded' not in r.get('snippet',''), r
assert r.get('body_omitted_lines',0)>0, r
PY
out="$("$CG" symbol parseUserRecord --json)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); r=next(x for x in d['definitions']
                                if x['path']=='src/alpha.c')
assert 'int decoded' in r['snippet'], r
PY
out="$("$CG" context src/alpha.c --json --kind function --name overload)"
python3 - "$out" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); r=[x for x in d['symbols'] if 'name' in x]
assert d['kind']=='file' and [x['name'] for x in r]==['overload'], d
PY

# A linked worktree reuses identical content with distinct branch-owned
# posting rows. Subsequent edits must not alter the other branch's answers.
git worktree add -q "$TMP/wt" -b variant
cd "$TMP/wt"
"$CG" init >/dev/null
python3 - "$TMP/proj/.codegraph/graph.db" <<'PY'
import sqlite3,sys
db=sqlite3.connect(sys.argv[1])
rows=db.execute('SELECT b.name,count(*) FROM semantic_identifier_postings p '
                'JOIN files f ON f.id=p.file_id JOIN branches b ON b.id=f.branch_id '
                'GROUP BY b.name').fetchall()
d=dict(rows)
assert d['main']==d['variant'] and d['main']>0, d
PY
cat > src/alpha.c <<'EOF'
int variantOnlyRecord(int raw) {
    return raw * 13;
}
EOF
"$CG" sync >/dev/null
has "$("$CG" search variantOnlyRecord --json)" 'variantOnlyRecord'
hasnt "$("$CG" search variantOnlyRecord --branch main --json)" '"name":"variantOnlyRecord"'
cd "$TMP/proj"

cat > src/alpha.c <<'EOF'
int parseAccountRecord(int raw) {
    return raw + 71;
}
EOF
"$CG" sync >/dev/null
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('.codegraph/graph.db')
rows=db.execute('SELECT p.segment FROM semantic_identifier_postings p '
                'JOIN files f ON f.id=p.file_id WHERE f.path="src/alpha.c"').fetchall()
segments={x[0] for x in rows}
assert 'account' in segments and 'user' not in segments, segments
PY
rm src/beta.c
"$CG" sync >/dev/null
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('.codegraph/graph.db')
assert not db.execute('SELECT 1 FROM semantic_identifier_postings p '
                      'JOIN files f ON f.id=p.file_id '
                      'JOIN branches b ON b.id=f.branch_id '
                      'WHERE f.path="src/beta.c" AND b.name="main"').fetchone()
PY
