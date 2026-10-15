#!/usr/bin/env bash
# Systems grammars: structural symbols, ownership, bindings, calls and recovery.
. "$(dirname "$0")/../lib.sh"
mkdir -p "$TMP/proj/src"
cp "$FIXTURES/semantic/systems/"* "$TMP/proj/src/"
cd "$TMP/proj"
"$CG" init >/dev/null
"$CG" sync >/dev/null
python3 - <<'PY'
import sqlite3
from pathlib import Path

con = sqlite3.connect(next(Path('.').glob('.*/*.db')))
con.row_factory = sqlite3.Row

def exists(query, args=()):
    return con.execute(query, args).fetchone() is not None

def sym(file, name, kind=None):
    query = '''SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id
               JOIN semantic_symbols m ON m.symbol_id=s.id
               WHERE f.path=? AND s.name=?'''
    args=[f'src/{file}', name]
    if kind:
        query+=' AND s.kind=?'; args.append(kind)
    return con.execute(query,args).fetchone()

def assert_sym(file, name, kind=None):
    assert sym(file,name,kind), (file,name,kind)

def assert_ref(file, text, owner):
    assert exists('''SELECT 1 FROM semantic_references r JOIN files f ON f.id=r.file_id
                     JOIN symbols s ON s.id=r.owner_id
                     WHERE f.path=? AND r.original_text=? AND s.name=?''',
                  (f'src/{file}',text,owner)), (file,text,owner)

def assert_binding(file, module, kind):
    assert exists('''SELECT 1 FROM semantic_bindings b JOIN files f ON f.id=b.file_id
                     WHERE f.path=? AND b.module=? AND b.kind=?''',
                  (f'src/{file}',module,kind)), (file,module,kind)

def assert_fact(file, kind, value):
    assert exists('''SELECT 1 FROM semantic_type_facts t JOIN files f ON f.id=t.file_id
                     WHERE f.path=? AND t.kind=? AND t.value LIKE ?''',
                  (f'src/{file}',kind,f'%{value}%')), (file,kind,value)

for file, symbols in {
  'fixture.c': [('increment','function'),('invoke','function'),('dispatch','function'),('Meter','struct'),('WRAP','macro'),('Forward','struct'),('Future','enum'),('Level','typedef'),('Count','typedef'),('Anonymous','typedef')],
  'fixture.cpp': [('demo','namespace'),('Worker','class'),('run','method'),('execute','function'),('Abstract','struct'),('area','method')],
  'fixture.m': [('Counter','class'),('inc','method'),('invoke','function')],
  'fixture.go': [('Worker','struct'),('Runner','interface'),('Run','method'),('helper','function')],
  'fixture.rs': [('Runner','trait'),('Worker','struct'),('helper','function'),('invoke','function')],
}.items():
    for name,kind in symbols: assert_sym(file,name,kind)
for language in ('c','cpp','objc','go','rust'):
    assert exists('SELECT 1 FROM semantic_symbols WHERE parser_id=?',
                  (f'tree-sitter:{language}',)), language
assert_binding('fixture.c','stdio.h','include')
assert_binding('fixture.cpp','vector','include')
assert_binding('fixture.m','Foundation/Foundation.h','include')
assert_binding('fixture.go','fmt','module_import')
assert_binding('fixture.go','encoding/json','module_import')
assert_binding('fixture.rs','std','use')
for local in ('c','d'):
    assert exists('''SELECT 1 FROM semantic_bindings b JOIN files f ON f.id=b.file_id
                     WHERE f.path='src/fixture.rs' AND b.module='a::b'
                     AND b.local_name=? AND b.kind='use' ''', (local,)), local
assert exists('''SELECT 1 FROM semantic_bindings b JOIN files f ON f.id=b.file_id
                 WHERE f.path='src/fixture.rs' AND b.module='x::y'
                 AND b.local_name='z' AND b.kind='use' ''')
assert_ref('fixture.cpp','helper','run')
assert_ref('fixture.go','helper','Run')
assert_ref('fixture.rs','helper','run')
assert exists('''SELECT 1 FROM semantic_references r JOIN files f ON f.id=r.file_id
                 WHERE f.path='src/fixture.rs' AND r.original_text='load'
                 AND r.qualifier='Config' ''')
for call in ('fn','done'):
    assert exists('''SELECT 1 FROM semantic_references r JOIN files f ON f.id=r.file_id
                     WHERE f.path='src/fixture.c' AND r.original_text=?
                     AND r.qualifier='(param)' ''', (call,)), call
assert exists('''SELECT 1 FROM symbols s JOIN files f ON f.id=s.file_id
                 WHERE f.path='src/fixture.cpp' AND s.name='area' AND s.decl=1 ''')
assert exists('''SELECT 1 FROM symbols m JOIN semantic_symbols sm ON sm.symbol_id=m.id
                 JOIN symbols owner ON owner.id=sm.parent_id
                 JOIN files f ON f.id=m.file_id
                 WHERE f.path='src/fixture.go' AND m.name='Run' AND owner.name='Worker' ''')
assert_fact('fixture.c','pointer','Callback')
assert_fact('fixture.c','function_value','increment')
assert_fact('fixture.c','pointer_slot','increment')
assert_fact('fixture.c','pointer_call','ops.run')
assert_fact('fixture.c','macro_boundary','WRAP')
assert_fact('fixture.c','native_bridge_registration','nativeOpen')
assert not exists('''SELECT 1 FROM semantic_type_facts t JOIN files f ON f.id=t.file_id
                     WHERE f.path='src/fixture.c' AND t.kind='native_bridge_registration'
                     AND t.name='runtimeName' ''')
assert_fact('fixture.cpp','inherits','Base')
assert_fact('fixture.cpp','overrides','run')
overrides = con.execute('''SELECT s.name, m.qualified_name FROM semantic_type_facts t
  JOIN files f ON f.id=t.file_id JOIN symbols s ON s.id=t.owner_id
  JOIN semantic_symbols m ON m.symbol_id=s.id
  WHERE f.path='src/fixture.cpp' AND t.kind='overrides' ''').fetchall()
assert [(row['name'],row['qualified_name']) for row in overrides] == [
    ('run','demo::Worker::run')], overrides
assert_fact('fixture.go','receiver','Worker')
assert_fact('fixture.rs','implements','Runner')
# No phantom definitions or calls may originate from comments and literals.
assert not exists('''SELECT 1 FROM semantic_references r JOIN files f ON f.id=r.file_id
                     WHERE f.path=? AND r.original_text=?''',
                  ('src/fixture.c','phantom_call'))
assert not sym('fixture.c','External')
assert_sym('broken.c','good','function')
assert_sym('broken.c','after','function')
con.close()
PY
