#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/tree/src" "$work/tree/app" "$work/tree/packages/pkg/src"
cat > "$work/runner.c" <<'C'
#include "cg.h"
#include "sem_imports.h"
#include "semantic.h"
#include <string.h>
__attribute__((weak)) int sem_pass_register(const char *name,int order,SemPassFn fn) {
    (void)name;(void)order;(void)fn;return 0;
}
int main(int argc,char **argv) {
    if (argc!=4) return 2;
    Cg cg={0};
    if (sqlite3_open(argv[1],&cg.db)!=SQLITE_OK) return 3;
    snprintf(cg.root,sizeof cg.root,"%s",argv[2]);
    cg.branch_id=atol(argv[3]);
    if (sem_imports_pass(&cg,NULL,0)!=0) return 4;
    int rc=sem_imports_config_changed(&cg) ? 5 : 0;
    sqlite3_close(cg.db);
    return rc;
}
C
make -s build/libcg.a
cc -std=gnu11 -Isrc -o "$work/runner" "$work/runner.c" build/libcg.a -lsqlite3 -lpthread -lm
python3 - "$work" <<'PY'
import json, pathlib, sqlite3, sys
w=pathlib.Path(sys.argv[1]); root=w/'tree'
(root/'app'/'tsconfig.json').write_text('// local aliases\n'+json.dumps({'compilerOptions':{'paths':{'@/*':['../src/*']}}}))
(root/'tsconfig.json').write_text(json.dumps({'compilerOptions':{'paths':{'@/*':['../src/alt']}}}))
(root/'packages/pkg/package.json').write_text(json.dumps({'name':'local-pkg','main':'src/index.ts'}))
db=sqlite3.connect(w/'graph.db')
db.executescript('''
CREATE TABLE files(id INTEGER PRIMARY KEY,branch_id INTEGER,path TEXT,lang TEXT);
CREATE TABLE symbols(id INTEGER PRIMARY KEY,file_id INTEGER,name TEXT,decl INTEGER);
CREATE TABLE semantic_symbols(symbol_id INTEGER,exported INTEGER);
CREATE TABLE semantic_bindings(id INTEGER PRIMARY KEY,file_id INTEGER,module TEXT,local_name TEXT,
 original_name TEXT,kind TEXT,exported_name TEXT,is_export INTEGER,is_system INTEGER,
 target_file_id INTEGER,target_symbol_id INTEGER);
CREATE TABLE semantic_dependencies(id INTEGER PRIMARY KEY,branch_id INTEGER,file_id INTEGER,
 dependency_key TEXT,dependency_hash TEXT,kind TEXT,
 UNIQUE(branch_id,file_id,dependency_key,kind));
''')
files=[(1,1,'src/a.ts','typescript'),(2,1,'src/bar.ts','typescript'),
 (3,1,'app/main.ts','typescript'),(4,1,'src/alt.ts','typescript'),
 (5,1,'packages/pkg/src/index.ts','typescript'),(6,1,'src/cycle1.ts','typescript'),
 (7,1,'src/cycle2.ts','typescript'),(8,1,'app/negative.ts','typescript'),
 (9,2,'src/a.ts','typescript'),(10,1,'packages/pkg/package.json',None),
 (11,1,'pymod.py','python'),(12,1,'src/use.c','c'),(13,1,'src/util.h','c'),
 (14,1,'app/use.py','python'),(15,1,'pkg/mod.py','python'),
 (16,1,'app/helpers.py','python'),(17,1,'src/Foo/Bar.php','php'),
 (18,1,'src/main.php','php'),(19,1,'src/lib.rs','rust'),
 (20,1,'src/foo.rs','rust')]
db.executemany('INSERT INTO files VALUES(?,?,?,?)',files)
db.executemany('INSERT INTO symbols VALUES(?,?,?,0)',[(101,1,'foo'),(104,4,'foo'),(105,5,'foo'),(901,9,'foo'),(111,11,'pyfoo')])
db.executemany('INSERT INTO semantic_symbols VALUES(?,1)',[(101,),(104,),(105,),(901,)])
bindings=[
 (201,1,None,'foo','foo','export','foo',1,0),
 (202,2,'./a',None,'foo','reexport','bar',1,0),
 (203,3,'../src/bar','local','bar','import',None,0,0),
 (204,3,'@/a','aliased','foo','import',None,0,0),
 (205,3,'local-pkg','packageFoo','foo','import',None,0,0),
 (206,5,None,'foo','foo','export','foo',1,0),
 (207,6,'./cycle2',None,'*','export_all',None,1,0),
 (208,7,'./cycle1',None,'*','export_all',None,1,0),
 (209,8,'../src/cycle1','missing','nonexistent','import',None,0,0),
 (210,8,'node:fs','system','*','namespace',None,0,1),
 (211,8,'../src/a','ns','*','namespace',None,0,0),
 (212,9,None,'foo','foo','export','foo',1,0),
 (213,1,None,'foo','foo','export','default',1,0),
 (214,3,'../src/a','defaultFoo',None,'default',None,0,0),
 (215,14,'pymod','pyModule',None,'import',None,0,0),
 (216,12,'util.h',None,'*','include',None,0,0),
 (217,14,'pymod','localPy','pyfoo','from-import',None,0,0),
 (218,14,'pkg.mod','absoluteModule',None,'import',None,0,0),
 (219,14,'.helpers','relativeModule',None,'import',None,0,0),
 (220,14,'..pymod','parentModule',None,'import',None,0,0),
 (221,18,'Foo\\Bar','Bar','Foo\\Bar','namespace-use',None,0,0),
 (222,19,'crate::foo::Item','Item','Item','use',None,0,0)]
db.executemany('''INSERT INTO semantic_bindings(id,file_id,module,local_name,original_name,
 kind,exported_name,is_export,is_system) VALUES(?,?,?,?,?,?,?,?,?)''',bindings)
db.commit();db.close()
PY
"$work/runner" "$work/graph.db" "$work/tree" 1
python3 - "$work" <<'PY'
import pathlib, sqlite3,sys
w=pathlib.Path(sys.argv[1]); db=sqlite3.connect(w/'graph.db')
get=lambda i: db.execute('SELECT target_file_id,target_symbol_id FROM semantic_bindings WHERE id=?',(i,)).fetchone()
assert get(202)==(1,101), get(202)
assert get(203)==(2,101), get(203)
assert get(204)==(1,101), get(204)
assert get(205)==(5,105), get(205)
assert get(209)==(6,None), get(209)
assert get(210)==(None,None), get(210)
assert get(211)==(1,None), get(211)
assert get(212)==(None,None), get(212)
assert get(214)==(1,101), get(214)
assert get(215)==(11,None), get(215)
assert get(216)==(13,None), get(216)
assert get(217)==(11,111), get(217)
assert get(218)==(15,None), get(218)
assert get(219)==(16,None), get(219)
assert get(220)==(11,None), get(220)
assert get(221)==(17,None), get(221)
assert get(222)==(20,None), get(222)
assert db.execute('SELECT COUNT(*) FROM semantic_dependencies WHERE branch_id=1 AND kind="project-config" AND dependency_hash IS NOT NULL').fetchone()[0]>=1
assert db.execute('SELECT COUNT(*) FROM semantic_dependencies WHERE branch_id=2').fetchone()[0]==0
db.close()
PY
python3 - "$work" <<'PY'
import pathlib,json,sys
p=pathlib.Path(sys.argv[1])/'tree/app/tsconfig.json'
p.write_text(json.dumps({'compilerOptions':{'paths':{'@/*':['../src/alt']}}}))
PY
cat > "$work/changed.c" <<'C'
#include "cg.h"
#include "sem_imports.h"
#include "semantic.h"
__attribute__((weak)) int sem_pass_register(const char *name,int order,SemPassFn fn) {
    (void)name;(void)order;(void)fn;return 0;
}
int main(int argc,char **argv) {
 Cg cg={0}; if(argc!=3 || sqlite3_open(argv[1],&cg.db)!=SQLITE_OK) return 2;
 snprintf(cg.root,sizeof cg.root,"%s",argv[2]);cg.branch_id=1;
 int rc=sem_imports_config_changed(&cg)?0:3;
 if(!rc) rc=sem_imports_pass(&cg,NULL,0);
 sqlite3_close(cg.db);return rc;
}
C
cc -std=gnu11 -Isrc -o "$work/changed" "$work/changed.c" build/libcg.a -lsqlite3 -lpthread -lm
"$work/changed" "$work/graph.db" "$work/tree"
python3 - "$work" <<'PY'
import pathlib,sqlite3,sys
w=pathlib.Path(sys.argv[1]);db=sqlite3.connect(w/'graph.db')
row=db.execute('SELECT target_file_id,target_symbol_id FROM semantic_bindings WHERE id=204').fetchone()
assert row==(4,104),row
print('sem_imports: explicit aliases, reexports, cycles, namespace, workspace, config invalidation, branch scope OK')
PY
