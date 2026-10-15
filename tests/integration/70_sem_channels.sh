#!/usr/bin/env bash
# Literal channel synthesis, ambiguity, invalidation, and unrelated work.
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj"
cp "$FIXTURES/semantic/channels/"*.js "$TMP/proj/"
cd "$TMP/proj"
"$CG" init >/dev/null
DB="$(graph_db)"

# The syntax adapter must persist the literal facts and their owning symbols.
# Direct inserts below exercise duplicate and negative graph cases only.
python3 - <<'PY'
import sqlite3
from pathlib import Path
db=sqlite3.connect(next(Path('.').glob('.*/*.db')))
def owner(path,name):
    rows=db.execute('SELECT s.id,f.id FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path=? AND s.name=?',(path,name)).fetchall()
    assert len(rows)==1,(path,name,rows)
    return rows[0]
def fact(path,name,kind,channel,value,line=1):
    sym,file=owner(path,name)
    db.execute('INSERT INTO semantic_type_facts(file_id,owner_id,name,kind,value,evidence,start_line,start_column,end_line,end_column) VALUES(?,?,?,?,?,?,?,?,?,?)',(file,sym,channel,kind,value,kind+'('+channel+')',line,0,line,24))
actual=set(db.execute("SELECT t.kind,t.name,t.value FROM semantic_type_facts t JOIN files f ON f.id=t.file_id WHERE f.path='client.js' AND t.kind LIKE 'channel:%'"))
expected={('channel:http:producer','/ping','GET')}
for family,name in [('bus','bus'),('queue','queue'),('socket','socket')]:
    for direction in ('producer','consumer'):
        expected.add((f'channel:{family}:{direction}','job.ready',f'client.js:{name}'))
assert expected <= actual,(expected-actual,actual)
# An identical persisted fact must not double the graph edge.
db.execute("INSERT INTO semantic_type_facts(file_id,owner_id,name,kind,value,evidence,start_line,start_column,end_line,end_column,start_byte,end_byte) SELECT file_id,owner_id,name,kind,value,evidence,start_line,start_column,end_line,end_column,start_byte,end_byte FROM semantic_type_facts WHERE kind='channel:bus:producer' AND name='job.ready' LIMIT 1")
# Same channel text cannot cross families or receivers. External and computed
# paths have no literal local fact; an injected absolute URL is rejected too.
fact('client.js','externalCall','channel:http:producer','https://example.invalid/ping','GET')
fact('client.js','externalCall','channel:http:producer','/ping','POST')
fact('consumers.js','competingBus','channel:bus:consumer','job.ready','elsewhere/bus:events')
db.commit()
PY
echo '// route dependency refresh 1' >> server.js
"$CG" sync >/dev/null
python3 - <<'PY'
import sqlite3
from pathlib import Path
db=sqlite3.connect(next(Path('.').glob('.*/*.db')))
rows=db.execute("SELECT s.name,t.name,e.channel,e.strategy,e.provenance,e.registration_path,e.registration_line FROM semantic_edges e JOIN symbols s ON s.id=e.source_id JOIN symbols t ON t.id=e.target_id WHERE e.strategy IN ('literal_http_unique_route','literal_named_channel') ORDER BY s.name").fetchall()
assert len(rows)==4,rows
assert {r[0] for r in rows}=={'requestPing','publishJob','publishQueue','publishSocket'},rows
assert all(r[4]=='heuristic' and r[5] and r[6]>0 for r in rows),rows
assert next(r for r in rows if r[0]=='requestPing')[1]=='GET /ping',rows
PY

# Unrelated edits do not rewrite edges.  The digest is scoped to semantic
# facts, routes and resolved bindings, not every file mtime.
before="$(sqlite3 "$DB" "SELECT group_concat(id,',') FROM semantic_edges WHERE strategy IN ('literal_http_unique_route','literal_named_channel') ORDER BY id")"
echo 'int trigger(void) { return 2; }' > trigger.c
"$CG" sync >/dev/null
after="$(sqlite3 "$DB" "SELECT group_concat(id,',') FROM semantic_edges WHERE strategy IN ('literal_http_unique_route','literal_named_channel') ORDER BY id")"
[ "$before" = "$after" ] || fail "unrelated edit rewrote channel edges"

# Two exact routes make the HTTP target ambiguous, so its edge disappears.
cat > duplicate.js <<'EOF'
function otherPing() { return 'other'; }
app.get('/ping', otherPing);
EOF
"$CG" sync >/dev/null
count="$(sqlite3 "$DB" "SELECT count(*) FROM semantic_edges WHERE strategy='literal_http_unique_route'")"
[ "$count" -eq 0 ] || fail "ambiguous route was linked"
rm duplicate.js
"$CG" sync >/dev/null
count="$(sqlite3 "$DB" "SELECT count(*) FROM semantic_edges WHERE strategy='literal_http_unique_route'")"
[ "$count" -eq 1 ] || fail "route edge failed to recover"

# A second queue consumer is a competing worker, not deterministic delivery.
python3 - <<'PY'
import sqlite3
from pathlib import Path
db=sqlite3.connect(next(Path('.').glob('.*/*.db')))
s,f=db.execute("SELECT s.id,f.id FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='consumers.js' AND s.name='competingQueue'").fetchone()
db.execute("INSERT INTO semantic_type_facts(file_id,owner_id,name,kind,value,evidence,start_line) VALUES(?,?,?,?,?,?,?)",(f,s,'job.ready','channel:queue:consumer','client.js:queue','queue.subscribe',1))
db.commit()
PY
echo '// route dependency refresh 2' >> server.js
"$CG" sync >/dev/null
count="$(sqlite3 "$DB" "SELECT count(*) FROM semantic_edges WHERE strategy='literal_named_channel' AND channel='job.ready' AND source_id=(SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='client.js' AND s.name='publishQueue')")"
[ "$count" -eq 0 ] || fail "ambiguous queue delivery was linked"

python3 - <<'PY'
import sqlite3
from pathlib import Path
db=sqlite3.connect(next(Path('.').glob('.*/*.db')))
s,f=db.execute("SELECT s.id,f.id FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='consumers.js' AND s.name='competingBus'").fetchone()
for line in range(10,43):
    db.execute("INSERT INTO semantic_type_facts(file_id,owner_id,name,kind,value,evidence,start_line) VALUES(?,?,?,?,?,?,?)",(f,s,'job.ready','channel:bus:consumer','client.js:bus','bus.on',line))
db.commit()
PY
echo '// route dependency refresh 3' >> server.js
"$CG" sync >/dev/null
count="$(sqlite3 "$DB" "SELECT count(*) FROM semantic_edges WHERE strategy='literal_named_channel' AND source_id=(SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id WHERE f.path='client.js' AND s.name='publishJob')")"
[ "$count" -eq 0 ] || fail "unbounded bus fanout was linked"

rm client.js
"$CG" sync >/dev/null
count="$(sqlite3 "$DB" "SELECT count(*) FROM semantic_edges WHERE strategy='literal_named_channel'")"
[ "$count" -eq 0 ] || fail "deleted registrations left incoming edges"

echo ok
