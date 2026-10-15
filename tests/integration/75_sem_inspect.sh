#!/usr/bin/env bash
# Bounded hierarchy, branch isolation, and cautious unreferenced inspection.
. "$(dirname "$0")/../lib.sh"
cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
mkdir -p src/generated
printf '// inspection fixture\n' > src/inspect_fixture.ts
printf '// generated fixture\n' > src/generated/out.ts
"$CG" init >/dev/null
printf '[sync]\nauto = false\n' > codify.kvx
db_file="$(ls -d .*/graph.db)"

python3 - "$db_file" <<'PY'
import sqlite3, sys
db=sqlite3.connect(sys.argv[1])
b=db.execute("SELECT id FROM branches ORDER BY id LIMIT 1").fetchone()[0]
f=db.execute("SELECT id FROM files WHERE branch_id=? AND path='src/inspect_fixture.ts'",(b,)).fetchone()[0]
g=db.execute("SELECT id FROM files WHERE branch_id=? AND path='src/generated/out.ts'",(b,)).fetchone()[0]
rows=[(100001,f,'Base','class',1),(100002,f,'Child','class',2),
      (100003,f,'Interface','interface',3),(100004,f,'Impl','class',4),
      (100005,f,'quiet','function',5),(100006,f,'api','function',6),
      (100007,g,'machineMade','function',1),(100008,f,'routeHandler','function',8),
      (100009,f,'reflective','function',9),(100010,f,'uncertain','function',10),
      (100011,f,'used','function',11),(100012,f,'publicMethod','method',12),
      (100013,f,'partial','function',13)]
db.executemany('INSERT INTO symbols(id,file_id,name,kind,line,decl) VALUES(?,?,?,?,?,0)',rows)
for ordinal,(sid,fid,name,kind,line) in enumerate(rows):
    db.execute('INSERT INTO semantic_symbols(symbol_id,file_id,ordinal,qualified_name,'
               'visibility,exported) VALUES(?,?,?,?,?,?)',
               (sid,fid,ordinal,name,'public' if name=='publicMethod' else 'private',
                1 if name=='api' else 0))
for src,dst,kind in [(100002,100001,'inherits'),(100004,100003,'implements')]:
    db.execute('INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,'
               'source_id,target_id,kind,strategy) VALUES(?,?,?,?,?,?,?)',
               (b,f,f,src,dst,kind,'type_hierarchy'))
db.execute("INSERT INTO routes(file_id,framework,method,pattern,handler,line) "
           "VALUES(?, 'express','GET','/x','routeHandler',8)",(f,))
db.execute("INSERT INTO semantic_references(file_id,ordinal,original_text,kind) "
           "VALUES(?,?,?,?)",(f,0,'reflective','reflection'))
db.execute("INSERT INTO refs(file_id,name,line,target_id) VALUES(?,?,?,NULL)",
           (f,'uncertain',10))
db.execute("INSERT INTO refs(file_id,name,line,target_id) VALUES(?,?,?,?)",
           (f,'used',11,100011))
db.execute('CREATE TABLE IF NOT EXISTS extraction_health('
           'branch_id INTEGER NOT NULL,path TEXT NOT NULL,status TEXT NOT NULL,'
           'generated INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(branch_id,path))')
db.execute('INSERT OR REPLACE INTO extraction_health(branch_id,path,status,generated) '
           'VALUES(?,?,?,?)',(b,'src/inspect_fixture.ts','complete',0))
db.execute('INSERT OR REPLACE INTO extraction_health(branch_id,path,status,generated) '
           'VALUES(?,?,?,?)',(b,'src/generated/out.ts','complete',1))
db.execute("INSERT INTO branches(id,name,updated) VALUES(999,'other',0)")
db.execute("INSERT INTO files(id,branch_id,path) VALUES(900001,999,'other.ts')")
db.execute("INSERT INTO symbols(id,file_id,name,kind,line,decl) "
           "VALUES(900001,900001,'Child','class',1,0)")
db.execute("INSERT INTO semantic_symbols(symbol_id,file_id,ordinal,qualified_name) "
           "VALUES(900001,900001,0,'Child')")
db.commit()
PY

hier="$("$CG" inspect hierarchy Base --json)"
python3 - "$hier" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert d['branch']
m=d['matches']; assert len(m)==1,m
assert [x['name'] for x in m[0]['subtypes']]==['Child'],m
assert m[0]['ancestors']==[],m
PY
hier="$("$CG" inspect hierarchy Child --json)"
python3 - "$hier" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert [x['name'] for x in d['matches'][0]['ancestors']]==['Base']
PY
hier="$("$CG" tool call inspect_hierarchy '{"name":"Interface"}')"
python3 - "$hier" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert [x['name'] for x in d['matches'][0]['implementations']]==['Impl']
PY

unused="$("$CG" inspect unused --path 'src/inspect_fixture.ts' --json)"
python3 - "$unused" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); by={x['name']:x for x in d['candidates']}
assert 'quiet' in by and by['quiet']['exclusion_reasons']==[],by
assert 'used' not in by and 'Base' not in by,by
for name,reason in [('api','exported'),('routeHandler','framework_root'),
                    ('reflective','reflection'),('uncertain','uncertain_incoming'),
                    ('publicMethod','public_api')]:
    assert reason in by[name]['exclusion_reasons'],(name,by)
assert all(not x['unreachable_proven'] for x in by.values())
assert d['unreachable_proven']==0 and 'safe to delete' in d['advice']
PY
limited="$("$CG" inspect unused --path 'src/inspect_fixture.ts' -n 1 --json)"
python3 - "$limited" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert d['shown']==1 and len(d['candidates'])==1,d
assert d['result_limit_reached'],d
PY
unused="$("$CG" tool call inspect_unreferenced '{"path":"src/generated/*"}')"
python3 - "$unused" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert len(d['candidates'])==1,d
assert 'generated' in d['candidates'][0]['exclusion_reasons'],d
PY
sqlite3 "$db_file" "DELETE FROM extraction_health WHERE path='src/inspect_fixture.ts'"
unverified="$("$CG" inspect unused --path 'src/inspect_fixture.ts' --json)"
python3 - "$unverified" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); by={x['name']:x for x in d['candidates']}
assert 'coverage_unverified' in by['quiet']['exclusion_reasons'],by
PY

# A second branch's matching name cannot enter the current branch's answer.
hier="$("$CG" inspect hierarchy Child --json)"
python3 - "$hier" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert len(d['matches'])==1,d
assert [x['name'] for x in d['matches'][0]['ancestors']]==['Base'],d
PY
hier="$("$CG" inspect hierarchy Child --branch other --json)"
python3 - "$hier" <<'PY'
import json,sys
d=json.loads(sys.argv[1]); assert d['branch']=='other',d
assert len(d['matches'])==1 and d['matches'][0]['ancestors']==[],d
PY
set +e
all="$("$CG" inspect hierarchy Child --all-branches --json)"
rc=$?
set -e
[ "$rc" -ne 0 ] || fail 'all-branch inspection silently used one branch'
has "$all" 'requires one branch'
"$CG" help inspect >/dev/null
echo ok
