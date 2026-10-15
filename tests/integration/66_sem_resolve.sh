#!/usr/bin/env bash
set -euo pipefail
repo=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cat >"$tmp/runner.c" <<'EOF'
#include "cg.h"
#include "sem_resolve.h"
#include <stdio.h>
#include <stdlib.h>
sqlite3_stmt *cg_prep(Cg *cg, const char *sql) {
    sqlite3_stmt *q=NULL;
    if (sqlite3_prepare_v2(cg->db,sql,-1,&q,NULL)!=SQLITE_OK) {
        fprintf(stderr,"prepare: %s\n",sqlite3_errmsg(cg->db)); exit(2);
    }
    return q;
}
int sem_pass_register(const char *name,int order,SemPassFn fn) {
    (void)name;(void)order;(void)fn;return 0;
}
int main(int argc,char **argv) {
    if (argc<3 || argc>35) return 2;
    Cg cg={0}; cg.branch_id=atol(argv[2]);
    if (sqlite3_open(argv[1],&cg.db)!=SQLITE_OK) return 2;
    long changed[32];
    for (int i=3;i<argc;i++) changed[i-3]=atol(argv[i]);
    int rc=sem_resolve_run(&cg,argc>3?changed:NULL,argc-3);
    sqlite3_close(cg.db);
    return rc;
}
EOF
cc -std=c11 -Wall -Wextra -Werror -I"$repo/src" \
    "$repo/src/sem_resolve.c" "$tmp/runner.c" -lsqlite3 -o "$tmp/runner"
python3 - "$tmp/test.db" "$tmp/runner" <<'PY'
import sqlite3, subprocess, sys
db, runner = sys.argv[1:]
c = sqlite3.connect(db)
c.executescript('''
CREATE TABLE files(id INTEGER PRIMARY KEY,branch_id INTEGER,path TEXT);
CREATE TABLE symbols(id INTEGER PRIMARY KEY,file_id INTEGER,name TEXT,kind TEXT,decl INTEGER,sig TEXT,line INTEGER);
CREATE TABLE refs(id INTEGER PRIMARY KEY,file_id INTEGER,name TEXT,qual TEXT,argc INTEGER,kind TEXT,target_id INTEGER,verdict TEXT,conf TEXT);
CREATE TABLE semantic_symbols(symbol_id INTEGER PRIMARY KEY,parent_id INTEGER,visibility TEXT,qualified_name TEXT);
CREATE TABLE semantic_references(ref_id INTEGER PRIMARY KEY,owner_id INTEGER,qualifier TEXT,original_text TEXT,start_line INTEGER,start_column INTEGER,target_id INTEGER,strategy TEXT,evidence TEXT);
CREATE TABLE semantic_bindings(file_id INTEGER,local_name TEXT,original_name TEXT,module TEXT,is_export INTEGER,is_system INTEGER,target_symbol_id INTEGER,target_file_id INTEGER);
CREATE TABLE imports(file_id INTEGER,module TEXT,target_file_id INTEGER);
CREATE TABLE semantic_type_facts(file_id INTEGER,name TEXT,kind TEXT,owner_id INTEGER,start_line INTEGER,value TEXT);
CREATE TABLE semantic_edges(branch_id INTEGER,source_file_id INTEGER,target_file_id INTEGER,source_id INTEGER,target_id INTEGER,source_ref_id INTEGER,kind TEXT,original_text TEXT,strategy TEXT,provenance TEXT,evidence TEXT,start_line INTEGER,start_column INTEGER,synthesized INTEGER);
INSERT INTO files VALUES(1,1,'app.ts'),(2,1,'service.ts'),(3,1,'other.ts'),(4,2,'service.ts');
INSERT INTO symbols VALUES
 (10,1,'A','class',0,'',1),(11,1,'go','method',0,'go(x)',2),
 (12,1,'go','method',0,'go(x,y)',3),(13,1,'caller','method',0,'caller()',4),
 (20,2,'B','class',0,'',1),(21,2,'go','method',0,'go(x)',2),
 (22,2,'free','function',0,'free()',3),(23,2,'privateCall','function',0,'privateCall()',4),
 (24,2,'free','function',0,'free()',5),(30,3,'go','function',0,'go(x)',2),
 (40,4,'go','function',0,'go(x)',1);
INSERT INTO semantic_symbols(symbol_id,parent_id,visibility) VALUES
 (10,NULL,NULL),(11,10,'public'),(12,10,'public'),(13,10,'public'),
 (20,NULL,NULL),(21,20,'public'),(22,NULL,'public'),(23,NULL,'private'),
 (24,NULL,'public'),(30,NULL,'public'),(40,NULL,'public');
INSERT INTO refs VALUES
 (101,1,'go','this',1,'call',21,'internal','same-name'),
 (102,1,'go','this',2,'call',21,'internal','same-name'),
 (103,1,'go','mystery',1,'call',21,'internal','same-name'),
 (104,1,'go','object',1,'call',21,'internal','same-name'),
 (105,1,'go','mod',1,'call',21,'internal','same-name'),
 (106,1,'free','',0,'call',22,'internal','same-name'),
 (107,1,'privateCall','',0,'call',23,'internal','same-name'),
 (108,1,'go','object',2,'call',21,'internal','same-name'),
 (109,2,'go','self',1,'call',11,'internal','same-name');
INSERT INTO semantic_references(ref_id,owner_id,qualifier,original_text,start_line,start_column) VALUES
 (101,13,'this','this.go(1)',5,2),(102,13,'this','this.go(1,2)',6,2),
 (103,13,'mystery','mystery.go(1)',7,2),(104,13,'object','object.go(1)',8,2),
 (105,13,'mod','mod.go(1)',9,2),(106,13,'','free()',10,2),
 (107,13,'','privateCall()',11,2),(108,13,'object','object.go(1,2)',12,2),
 (109,21,'self','self.go(1)',7,2);
INSERT INTO semantic_type_facts VALUES(1,'object','constructor',13,4,'B');
INSERT INTO semantic_bindings(file_id,local_name,is_export,is_system,target_symbol_id,target_file_id) VALUES(1,'mod',0,0,NULL,3);
''')
c.commit()
subprocess.run([runner,db,'1'],check=True)
rows=dict(c.execute('SELECT ref_id,target_id FROM semantic_references'))
expected={101:11,102:12,103:None,104:21,105:30,106:None,107:None,108:None,109:21}
assert rows==expected,(rows,expected)
assert c.execute("SELECT original_text,strategy,provenance FROM semantic_edges WHERE source_ref_id=101").fetchone()==('this.go(1)','receiver-owner','resolved-receiver')
assert c.execute('SELECT count(*) FROM semantic_edges').fetchone()[0]==5
assert c.execute('SELECT verdict,target_id FROM refs WHERE id=103').fetchone()==('unknown',None)
assert 'unknown receiver' in c.execute('SELECT evidence FROM semantic_references WHERE ref_id=103').fetchone()[0]
# An adapter's exact-site syntax edge wins. Another site for the same target
# must still get its own resolved edge.
c.executemany('INSERT INTO refs VALUES(?,?,?,?,?,?,?,?,?)', [
    (110,1,'go','this',1,'call',None,None,None),
    (111,1,'go','this',1,'call',None,None,None)])
c.executemany('''INSERT INTO semantic_references
    (ref_id,owner_id,qualifier,original_text,start_line,start_column)
    VALUES(?,?,?,?,?,?)''', [
    (110,13,'this','go',20,2),(111,13,'this','go',21,2)])
c.executemany('''INSERT INTO semantic_edges
    (branch_id,source_file_id,target_file_id,source_id,target_id,
     source_ref_id,kind,original_text,strategy,provenance,evidence,
     start_line,start_column,synthesized) VALUES(1,1,1,13,11,?,
     'calls','go','syntax','syntax','exact site',?,?,0)''', [
    (110,20,2),(111,21,3)])
c.commit()
subprocess.run([runner,db,'1','1'],check=True)
assert c.execute("SELECT count(*) FROM semantic_edges WHERE source_ref_id=110").fetchone()[0]==1
assert c.execute("SELECT provenance FROM semantic_edges WHERE source_ref_id=110").fetchone()[0]=='syntax'
assert c.execute("SELECT count(*) FROM semantic_edges WHERE source_ref_id=111").fetchone()[0]==2
# A newly introduced competing receiver leaves an unchanged caller unresolved.
c.execute("INSERT INTO symbols VALUES(25,2,'go','method',0,'go(x)',6)")
c.execute("INSERT INTO semantic_symbols(symbol_id,parent_id,visibility) VALUES(25,20,'public')")
c.commit()
subprocess.run([runner,db,'1','1'],check=True)
assert c.execute('SELECT target_id FROM semantic_references WHERE ref_id=104').fetchone()[0] is None
assert c.execute('SELECT count(*) FROM semantic_edges WHERE source_ref_id=104').fetchone()[0]==0
assert c.execute('SELECT target_id FROM semantic_references WHERE ref_id=109').fetchone()[0]==21
subprocess.run([runner,db,'1'],check=True)
assert c.execute('SELECT target_id FROM semantic_references WHERE ref_id=109').fetchone()[0] is None
# Removing it restores the original link, with no duplicate edge.
c.execute('DELETE FROM semantic_symbols WHERE symbol_id=25')
c.execute('DELETE FROM symbols WHERE id=25')
c.commit()
subprocess.run([runner,db,'1','1','2'],check=True)
assert c.execute('SELECT target_id FROM semantic_references WHERE ref_id=104').fetchone()[0]==21
assert c.execute('SELECT count(*) FROM semantic_edges WHERE source_ref_id=104').fetchone()[0]==1
assert c.execute('SELECT target_id FROM semantic_references WHERE ref_id=109').fetchone()[0]==21
print('receiver and overload resolution: owner, arity, import, type, ambiguity, visibility, branch and scoped retry passed')
PY

# Exercise the production extractor, writer and pass registration together.
mkdir "$tmp/source"
cat >"$tmp/source/app.ts" <<'EOF'
class A {
  go(x: number) {}
  go(x: number, y: number) {}
  caller() {
    this.go(1);
    this.go(1, 2);
    unknown.go(1);
  }
}
EOF
(cd "$tmp/source" && "$CG" init >/dev/null)
python3 - "$tmp/source" <<'PY'
import pathlib, sqlite3, sys
root = pathlib.Path(sys.argv[1])
db = sqlite3.connect(next(root.glob('.*/*.db')))
rows = db.execute('''SELECT r.argc, r.qual, r.verdict, r.conf, s.sig,
                           sr.evidence
                     FROM refs r JOIN semantic_references sr ON sr.ref_id=r.id
                     LEFT JOIN symbols s ON s.id=r.target_id
                     WHERE r.name='go' ORDER BY r.id''').fetchall()
assert len(rows) == 3, rows
assert rows[0][0:4] == (1, 'this', 'internal', 'receiver-owner'), rows
assert rows[1][0:4] == (2, 'this', 'internal', 'receiver-owner'), rows
assert rows[0][4] != rows[1][4], rows
assert rows[2][1:4] == ('unknown', 'unknown', 'semantic-unresolved'), rows
assert 'unknown receiver' in rows[2][5], rows
assert db.execute("SELECT count(*) FROM semantic_edges WHERE provenance='resolved-receiver' AND kind='calls'").fetchone()[0] == 2
print('production extractor, storage and receiver pass: arity and unknown receiver passed')
PY

# Container kinds outside class/struct still establish lexical ownership.
mkdir "$tmp/scala" "$tmp/solidity"
cat >"$tmp/scala/Flow.scala" <<'EOF'
object Flow {
  def target(): Int = 1
  def caller(): Int = target()
}
EOF
cat >"$tmp/solidity/Flow.sol" <<'EOF'
pragma solidity ^0.8.0;
contract Flow {
  function target() public pure returns(uint) { return 1; }
  function caller() public pure returns(uint) { return target(); }
}
EOF
for family in scala solidity; do
    (cd "$tmp/$family" && "$CG" init >/dev/null)
done
python3 - "$tmp/scala" "$tmp/solidity" <<'PY'
import pathlib, sqlite3, sys
for path in sys.argv[1:]:
    db = sqlite3.connect(next(pathlib.Path(path).glob('.*/*.db')))
    row = db.execute('''SELECT r.verdict,r.conf,s.name,ss.parent_id
                        FROM refs r LEFT JOIN symbols s ON s.id=r.target_id
                        LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id
                        WHERE r.kind='call' AND r.name='target' ''').fetchone()
    assert row and row[:3] == ('internal','lexical-owner','target') and row[3], (path,row)
PY

# An unqualified value reference resolves only to a unique lexical target.
mkdir "$tmp/nix" "$tmp/terraform"
cat >"$tmp/nix/flow.nix" <<'EOF'
{ }: let
  target = 1;
  caller = target;
  unrelated = 0; # target
in caller
EOF
cat >"$tmp/terraform/flow.tf" <<'EOF'
resource "null_resource" "first" {}
resource "null_resource" "second" {
  depends_on = [null_resource.first, null_resource.missing]
}
EOF
for family in nix terraform; do
    (cd "$tmp/$family" && "$CG" init >/dev/null)
done
python3 - "$tmp/nix" "$tmp/terraform" <<'PY'
import pathlib, sqlite3, sys
def database(path):
    return sqlite3.connect(next(pathlib.Path(path).glob('.*/*.db')))
nix = database(sys.argv[1])
assert nix.execute('''SELECT e.kind,s.name,o.name FROM semantic_edges e
                      JOIN symbols s ON s.id=e.target_id
                      JOIN symbols o ON o.id=e.source_id
                      WHERE e.provenance='resolved-receiver' ''').fetchall() == [
                          ('references','target','caller')]
assert nix.execute("SELECT count(*) FROM semantic_references WHERE original_text='target'").fetchone()[0] == 1
terraform = database(sys.argv[2])
assert terraform.execute('''SELECT e.kind,ss.qualified_name FROM semantic_edges e
                            JOIN semantic_symbols ss ON ss.symbol_id=e.target_id
                            WHERE e.provenance='resolved-receiver' ''').fetchall() == [
                                ('references','resource.null_resource.first')]
assert terraform.execute("SELECT target_id FROM semantic_references WHERE original_text='null_resource.missing'").fetchone()[0] is None
PY

# Declarative adapters can prove the same target at extraction time. Retain
# that exact syntax edge and do not add another edge at its source site.
mkdir "$tmp/mixed"
cat >"$tmp/mixed/flow.cfc" <<'EOF'
<cfscript>
  function target() { return 1; }
  function caller() { return target(); }
  function unrelated() { /* target() */ return 0; }
</cfscript>
EOF
cat >"$tmp/mixed/flow.cfm" <<'EOF'
<cffunction name="target"><cfreturn 1></cffunction>
<cffunction name="caller"><cfreturn target()></cffunction>
<cffunction name="unrelated"><!--- target() ---><cfreturn 0></cffunction>
EOF
cat >"$tmp/mixed/flow.xml" <<'EOF'
<mapper namespace="Flow">
  <sql id="target">SELECT 1</sql>
  <select id="caller"><include refid="target"/></select>
  <select id="unrelated">SELECT 0</select>
  <!-- <include refid="target"/> -->
</mapper>
EOF
(cd "$tmp/mixed" && "$CG" init >/dev/null)
python3 - "$tmp/mixed" <<'PY'
import pathlib, sqlite3, sys
db=sqlite3.connect(next(pathlib.Path(sys.argv[1]).glob('.*/*.db')))
for path in ('flow.cfc','flow.cfm','flow.xml'):
    rows=db.execute('''SELECT e.source_ref_id,e.source_id,e.target_id,e.kind,
                             e.start_line,e.start_column,e.provenance
                       FROM semantic_edges e JOIN files f ON f.id=e.source_file_id
                       WHERE f.path=? AND e.provenance='syntax'
                         AND e.source_ref_id IS NOT NULL''',(path,)).fetchall()
    assert rows,(path,rows)
    for rid,source,target,kind,line,column,provenance in rows:
        sites=db.execute('''SELECT provenance FROM semantic_edges
                            WHERE source_ref_id=? AND source_id IS ?
                              AND target_id=? AND kind=? AND start_line=?
                              AND start_column=?''',
                         (rid,source,target,kind,line,column)).fetchall()
        assert sites==[(provenance,)],(path,rid,sites)
PY
