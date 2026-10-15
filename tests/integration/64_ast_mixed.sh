#!/usr/bin/env bash
set -euo pipefail
CG="${CG:-$PWD/cg}"
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
TMP_MIXED="$(mktemp -d)"
trap 'rm -rf "$TMP_MIXED"' EXIT
mkdir -p "$TMP_MIXED/repo"
cp "$ROOT"/tests/fixtures/semantic/mixed/* "$TMP_MIXED/repo/"
cd "$TMP_MIXED/repo"
git init -q -b main .
printf '.codegraph/\n' > .gitignore
git add -A
git -c user.name=Test -c user.email=test@example.invalid commit -qm fixtures
"$CG" init >/dev/null
python3 - .codegraph/graph.db <<'PY'
import sqlite3,sys
c=sqlite3.connect(sys.argv[1]);c.row_factory=sqlite3.Row
symbols=[dict(r) for r in c.execute('SELECT f.path,s.name,s.kind,x.start_byte,x.start_line,x.start_column,x.parser_id FROM symbols s JOIN files f ON f.id=s.file_id JOIN semantic_symbols x ON x.symbol_id=s.id')]
refs=[dict(r) for r in c.execute('SELECT f.path,r.name,r.kind,x.start_byte,x.start_line,x.start_column FROM refs r JOIN files f ON f.id=r.file_id JOIN semantic_references x ON x.ref_id=r.id')]
bindings=[dict(r) for r in c.execute('SELECT f.path,b.module,b.kind,b.start_byte FROM semantic_bindings b JOIN files f ON f.id=b.file_id')]
by_symbol={(r['path'],r['name']) for r in symbols}
by_ref={(r['path'],r['name']) for r in refs}
for item in [('sample.pas','Sample'),('sample.pas','TWorker'),('sample.cbl','HELLO'),('sample.cbl','MAIN-PARA'),('sample.vb','Worker'),('sample.vb','Run'),('sample.cfs','run'),('sample.ets','Card'),('Sample.vue','multi'),('Sample.svelte','load'),('Sample.astro','front'),('Sample.dfm','MainForm'),('Mapper.xml','find'),('Sample.cfm','run')]:
    assert item in by_symbol,(item,symbols)
for item in [('Sample.vue','Card'),('Sample.svelte','Card'),('Sample.astro','Card'),('Sample.liquid','card'),('Sample.razor','Site.Pages.CardModel'),('Sample.dfm','TMainForm'),('Sample.dfm','Button1Click'),('Sample.cfm','users'),('Mapper.xml','fragment')]:
    assert item in by_ref,(item,refs)
assert ('Sample.vue','Ghost') not in by_ref
for path,name in [('sample.pas','Ghost'),('sample.vb','Ghost'),('sample.cfs','ghost'),('sample.ets','Phantom')]:
    assert (path,name) not in by_symbol,(path,name)
assert ('Sample.liquid','ghost') not in by_ref
assert ('Plain.xml','notAMapping') not in by_symbol
assert ('Sample.dfm','GhostHandler') not in by_ref
assert ('Sample.dfm','nil') not in by_ref
owner=c.execute("""SELECT s.name FROM semantic_references x
 JOIN refs r ON r.id=x.ref_id JOIN files f ON f.id=r.file_id
 JOIN symbols s ON s.id=x.owner_id
 WHERE f.path='Sample.dfm' AND r.name='Button1Click'""").fetchone()
assert owner and owner[0]=='Button1',owner
assert ('sample.cbl','WORK-PARA') in by_ref
assert ('sample.pas','SysUtils') in {(b['path'],b['module']) for b in bindings}
assert ('sample.vb','System') in {(b['path'],b['module']) for b in bindings}
assert all(s['parser_id'] for s in symbols),symbols
for r in symbols+refs:
    raw=open(r['path'],'rb').read()
    off=r['start_byte'];line=r['start_line'];col=r['start_column']
    assert 0 <= off < len(raw),(r,len(raw))
    assert line==raw[:off].count(b'\n')+1,(r,raw)
    assert col==off-(raw.rfind(b'\n',0,off)+1),(r,raw)
for path in ['config.json','config.yml','config.twig','config.properties']:
    assert not any(s['path']==path for s in symbols),path
    assert c.execute('SELECT count(*) FROM files WHERE path=?',(path,)).fetchone()[0]==1,path
print('mixed structural, embedded, declarative, negative and original-coordinate checks passed')
PY
