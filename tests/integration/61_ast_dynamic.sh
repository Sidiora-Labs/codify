#!/usr/bin/env bash
# Grammar-backed Python, Ruby and PHP extraction, ownership and negatives.
. "$(dirname "$0")/../lib.sh"

mkdir -p "$TMP/proj/src"
cp "$FIXTURES/semantic/dynamic/example.py" "$TMP/proj/src/example.py"
cp "$FIXTURES/semantic/dynamic/example.rb" "$TMP/proj/src/example.rb"
cp "$FIXTURES/semantic/dynamic/example.php" "$TMP/proj/src/example.php"
cd "$TMP/proj"
"$CG" init >/dev/null

python3 - <<'PY'
import sqlite3
from pathlib import Path

db = sqlite3.connect(next(Path('.').glob('.*/*.db')))
db.row_factory = sqlite3.Row

def rows(sql, *args):
    return [dict(r) for r in db.execute(sql, args)]

def fileid(path):
    found = rows('SELECT id FROM files WHERE path=?', path)
    assert len(found) == 1, (path, found)
    return found[0]['id']

for ext in ('py', 'rb', 'php'):
    fid = fileid('src/example.' + ext)
    syms = rows('''SELECT s.name,s.kind,q.qualified_name,q.parent_id,
                         q.start_byte,q.end_byte,q.documentation,q.decorators
                  FROM symbols s JOIN semantic_symbols q ON q.symbol_id=s.id
                  WHERE s.file_id=?''', fid)
    names = {r['name'] for r in syms}
    assert {'Worker', 'run', 'nested', 'later'} <= names, (ext, syms)
    assert not {'phantom', 'commented'} & names, (ext, syms)
    assert all(r['end_byte'] > r['start_byte'] for r in syms), (ext, syms)
    method = next(r for r in syms if r['name'] == 'run')
    assert method['parent_id'] is not None, (ext, method)
    assert method['qualified_name'].endswith('Worker.run'), (ext, method)
    nested = next(r for r in syms if r['name'] == 'nested')
    assert nested['parent_id'] is not None and nested['qualified_name'].endswith('run.nested'), (ext, nested)
    refs = rows('''SELECT r.name,q.owner_id,q.qualifier,q.start_byte,q.end_byte
                   FROM refs r JOIN semantic_references q ON q.ref_id=r.id
                   WHERE r.file_id=?''', fid)
    assert any(r['name'] == 'execute' and r['qualifier'] in ('engine', '$engine')
               for r in refs), (ext, refs)
    assert not any(r['name'] in ('phantom', 'commented') for r in refs), (ext, refs)
    assert all(r['end_byte'] > r['start_byte'] for r in refs), (ext, refs)
    assert any(r['name'] == 'nested' and r['owner_id'] is not None for r in refs), (ext, refs)
    bindings = rows('SELECT module,local_name,original_name,kind FROM semantic_bindings WHERE file_id=?', fid)
    assert bindings, (ext, bindings)

py = fileid('src/example.py')
py_bind = rows('SELECT module,local_name,original_name FROM semantic_bindings WHERE file_id=?', py)
assert {'module':'services.core','local_name':'Runner','original_name':'Engine'} in py_bind, py_bind
assert {'module':'os.path','local_name':'paths','original_name':None} in py_bind, py_bind
py_doc = rows('''SELECT q.documentation FROM semantic_symbols q JOIN symbols s ON s.id=q.symbol_id
                 WHERE s.file_id=? AND s.name='run' ''', py)
assert 'Run documentation.' in py_doc[0]['documentation'], py_doc
py_fact = rows('SELECT name,kind,value FROM semantic_type_facts WHERE file_id=?', py)
assert any(f['name']=='engine' and f['kind']=='variable_type' and f['value']=='Runner' for f in py_fact), py_fact
assert any(f['name']=='Worker' and f['kind']=='inherits' and f['value']=='Base' for f in py_fact), py_fact

php = fileid('src/example.php')
php_bind = rows('SELECT module,local_name FROM semantic_bindings WHERE file_id=?', php)
assert {'module':'Vendor\\Runtime\\Engine','local_name':'Runner'} in php_bind, php_bind
assert {'module':'Vendor\\Tool\\Alpha','local_name':'Alpha'} in php_bind, php_bind
assert {'module':'Vendor\\Tool\\Beta','local_name':'Named'} in php_bind, php_bind
php_run = rows('''SELECT q.decorators,q.visibility,q.result_type,q.documentation
                  FROM semantic_symbols q JOIN symbols s ON s.id=q.symbol_id
                  WHERE s.file_id=? AND s.name='run' ''', php)
assert 'Route' in php_run[0]['decorators'], php_run
assert 'public' in php_run[0]['visibility'], php_run
assert 'string' in php_run[0]['result_type'], php_run
assert 'Run documentation.' in php_run[0]['documentation'], php_run

db.close()
PY

# A syntax error marks partial coverage while retaining independently parsed nodes.
cp "$FIXTURES/semantic/dynamic/recovery.py" src/recovery.py
"$CG" sync >/dev/null
python3 - <<'PY'
import sqlite3
from pathlib import Path
db = sqlite3.connect(next(Path('.').glob('.*/*.db')))
names = {r[0] for r in db.execute('''SELECT s.name FROM symbols s JOIN files f ON f.id=s.file_id
                                     WHERE f.path='src/recovery.py' ''')}
assert {'before', 'after'} <= names, names
db.close()
PY

echo 'ast dynamic: ok'
