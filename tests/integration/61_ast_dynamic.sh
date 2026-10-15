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
    assert nested['kind'] == 'function', (ext, nested)
    refs = rows('''SELECT r.name,q.owner_id,q.qualifier,q.start_byte,q.end_byte
                   FROM refs r JOIN semantic_references q ON q.ref_id=r.id
                   WHERE r.file_id=?''', fid)
    assert any(r['name'] == 'execute' and r['qualifier'] in ('engine', '$engine')
               for r in refs), (ext, refs)
    assert not any(r['name'] in ('phantom', 'commented') for r in refs), (ext, refs)
    assert all(r['end_byte'] > r['start_byte'] for r in refs), (ext, refs)
    assert any(r['name'] == 'nested' and r['owner_id'] is not None for r in refs), (ext, refs)
    reads = rows('''SELECT original_text,owner_id FROM semantic_references
                    WHERE file_id=? AND kind='read' ''', fid)
    assert any(r['original_text'].endswith('value') and r['owner_id'] is not None
               for r in reads), (ext, reads)
    assert not any(r['original_text'] in ('phantom', 'commented') for r in reads), (ext, reads)
    bindings = rows('SELECT module,local_name,original_name,kind FROM semantic_bindings WHERE file_id=?', fid)
    assert bindings, (ext, bindings)

py = fileid('src/example.py')
py_signature = rows('SELECT sig FROM symbols WHERE file_id=? AND name=?', py, 'run')
assert py_signature == [{'sig':'def run(self, value: int) -> str:'}], py_signature
later_signature = rows('SELECT sig FROM symbols WHERE file_id=? AND name=?', py, 'later')
assert later_signature == [{'sig':'def later():'}], later_signature
py_bind = rows('SELECT module,local_name,original_name FROM semantic_bindings WHERE file_id=?', py)
assert {'module':'services.core','local_name':'Runner','original_name':'Engine'} in py_bind, py_bind
assert {'module':'os.path','local_name':'paths','original_name':None} in py_bind, py_bind
py_doc = rows('''SELECT q.documentation FROM semantic_symbols q JOIN symbols s ON s.id=q.symbol_id
                 WHERE s.file_id=? AND s.name='run' ''', py)
assert 'Run documentation.' in py_doc[0]['documentation'], py_doc
py_fact = rows('SELECT name,kind,value FROM semantic_type_facts WHERE file_id=?', py)
assert any(f['name']=='engine' and f['kind']=='variable_type' and f['value']=='Runner' for f in py_fact), py_fact
assert any(f['name']=='Worker' and f['kind']=='inherits' and f['value']=='Base' for f in py_fact), py_fact
assert any(f['name']=='run' and f['kind']=='decorates' and f['value']=='cached' for f in py_fact), py_fact

rb = fileid('src/example.rb')
rb_doc = rows('''SELECT q.documentation FROM semantic_symbols q JOIN symbols s ON s.id=q.symbol_id
                 WHERE s.file_id=? AND s.name='run' ''', rb)
assert 'Run documentation.' in rb_doc[0]['documentation'], rb_doc

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
php_fact = rows('SELECT name,kind,value FROM semantic_type_facts WHERE file_id=?', php)
assert any(f['name']=='run' and f['kind']=='decorates' and f['value']=='Route' for f in php_fact), php_fact

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

# A broad syntax tree must walk siblings linearly. The generated comments are
# separate named nodes, which exposes accidental repeated child-index scans.
python3 - <<'PY'
from pathlib import Path
Path('src/wide.py').write_text(''.join(f'# note {i}\n' for i in range(12000)) +
                               'def wide_target():\n    return 7\n')
PY
python3 - <<'PY'
import os, sqlite3, subprocess, time
from pathlib import Path
start = time.monotonic()
subprocess.run([os.environ['CG'], 'sync'], check=True, stdout=subprocess.DEVNULL,
               timeout=25)
elapsed = time.monotonic() - start
db = sqlite3.connect(next(Path('.').glob('.*/*.db')))
found = db.execute('''SELECT count(*) FROM symbols s JOIN files f ON f.id=s.file_id
                      WHERE f.path='src/wide.py' AND s.name='wide_target' ''').fetchone()[0]
assert found == 1, found
assert elapsed < 25, elapsed
db.close()
PY

echo 'ast dynamic: ok'
