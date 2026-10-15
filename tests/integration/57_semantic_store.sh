#!/usr/bin/env bash
set -euo pipefail

repo=$(cd "$(dirname "$0")/../.." && pwd)
tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
cd "$tmp"
"${CG:-$repo/cg}" init --nested >/dev/null

cat > "$tmp/check.c" <<'C'
#include "cg.h"
#include <assert.h>
#include <unistd.h>

static long scalar(Cg *cg, const char *sql) {
    sqlite3_stmt *q=cg_prep(cg,sql);
    assert(sqlite3_step(q)==SQLITE_ROW);
    long v=sqlite3_column_int64(q,0);
    sqlite3_finalize(q);
    return v;
}
static void insert_file(Cg *cg, long branch, const char *path) {
    sqlite3_stmt *q=cg_prep(cg,
        "INSERT INTO files(branch_id,path,lang,size,mtime,hash,lines) "
        "VALUES(?1,?2,'typescript',1,1,'same',1)");
    sqlite3_bind_int64(q,1,branch);
    sqlite3_bind_text(q,2,path,-1,SQLITE_STATIC);
    assert(sqlite3_step(q)==SQLITE_DONE);
    sqlite3_finalize(q);
}
int main(void) {
    Cg cg;
    assert(cg_open(&cg,false)==0);
    long original_branch=cg.branch_id;
    assert(original_branch>0);
    assert(cg_begin_write(&cg)==0);
    insert_file(&cg,original_branch,"sample.ts");
    long source_file=sqlite3_last_insert_rowid(cg.db);
    SemResult r={0};
    SemSpan class_span={.line=1,.column=0,.end_line=5,.end_column=1,
                        .start_byte=0,.end_byte=80};
    SemSymbol *cl=sem_symbol_add(&r,"Machine","class",class_span);
    cl->qualified_name=xstrdup("Machine");
    cl->visibility=xstrdup("public");
    cl->generic_params=xstrdup("T");
    cl->exported=true;
    SemSpan method_span={.line=2,.column=2,.end_line=4,.end_column=3,
                         .start_byte=20,.end_byte=70};
    SemSymbol *method=sem_symbol_add(&r,"run","method",method_span);
    method->parent=0;
    method->qualified_name=xstrdup("Machine.run");
    method->result_type=xstrdup("T");
    method->scope_key=xstrdup("run(T)");
    SemReference *ref=sem_reference_add(&r,"run","call",method_span);
    ref->owner=1; ref->target=1; ref->argc=1;
    ref->strategy=xstrdup("syntax");
    SemBinding *binding=sem_binding_add(&r,"./machine","Machine",class_span);
    binding->kind=xstrdup("named"); binding->original_name=xstrdup("Machine");
    SemTypeFact *fact=sem_type_fact_add(&r,"T","return",method_span);
    fact->owner=1; fact->value=xstrdup("T");
    SemEdge *edge=sem_edge_add(&r,"contains",0,1,method_span);
    edge->provenance=xstrdup("syntax"); edge->original_text=xstrdup("run");
    r.parser_id=xstrdup("fixture-parser");
    assert(sem_file_replace(&cg,source_file,&r,NULL,0,NULL,0)==0);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_symbols")==2);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_references")==1);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_bindings")==1);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_type_facts")==1);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_edges")==1);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_edges e JOIN symbols s "
                      "ON s.id=e.target_id WHERE s.name='run'")==1);
    cg_exec(&cg,"COMMIT");

    assert(cg_begin_write(&cg)==0);
    long twin_branch=original_branch+1000;
    cg.branch_id=twin_branch;
    insert_file(&cg,twin_branch,"sample.ts");
    long copied_file=sqlite3_last_insert_rowid(cg.db);
    sqlite3_stmt *q=cg_prep(&cg,
        "INSERT INTO symbols(file_id,name,kind,line,end_line,sig,decl) "
        "SELECT ?1,name,kind,line,end_line,sig,decl FROM symbols "
        "WHERE file_id=?2 ORDER BY id");
    sqlite3_bind_int64(q,1,copied_file); sqlite3_bind_int64(q,2,source_file);
    assert(sqlite3_step(q)==SQLITE_DONE); sqlite3_finalize(q);
    q=cg_prep(&cg,"INSERT INTO refs(file_id,name,line,sym_id,qual,kind,argc) "
        "SELECT ?1,r.name,r.line,n.id,r.qual,r.kind,r.argc FROM refs r "
        "LEFT JOIN symbols o ON o.id=r.sym_id "
        "LEFT JOIN symbols n ON n.file_id=?1 AND n.name=o.name "
        "WHERE r.file_id=?2 ORDER BY r.id");
    sqlite3_bind_int64(q,1,copied_file); sqlite3_bind_int64(q,2,source_file);
    assert(sqlite3_step(q)==SQLITE_DONE); sqlite3_finalize(q);
    assert(sem_file_copy(&cg,copied_file,source_file)==0);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_symbols")==4);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_edges e JOIN symbols s "
                      "ON s.id=e.target_id WHERE e.branch_id>1000")==1);
    q=cg_prep(&cg,"INSERT INTO semantic_edges(branch_id,source_file_id,"
        "target_file_id,kind) VALUES(?1,?2,?3,'call')");
    sqlite3_bind_int64(q,1,twin_branch);
    sqlite3_bind_int64(q,2,copied_file);
    sqlite3_bind_int64(q,3,source_file);
    assert(sqlite3_step(q)==SQLITE_CONSTRAINT);
    sqlite3_finalize(q);
    cg_exec(&cg,"COMMIT");

    assert(cg_begin_write(&cg)==0);
    assert(sem_file_purge(&cg,source_file)==0);
    q=cg_prep(&cg,"DELETE FROM symbols WHERE file_id=?1");
    sqlite3_bind_int64(q,1,source_file);
    assert(sqlite3_step(q)==SQLITE_DONE); sqlite3_finalize(q);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_symbols")==2);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_edges")==1);
    cg_exec(&cg,"COMMIT");

    assert(cg_begin_write(&cg)==0);
    assert(sem_file_purge(&cg,copied_file)==0);
    assert(scalar(&cg,"SELECT count(*) FROM semantic_edges")==0);
    cg_exec(&cg,"ROLLBACK");
    assert(scalar(&cg,"SELECT count(*) FROM semantic_edges")==1);
    sem_result_free(&r);
    cg_close(&cg);
    return 0;
}
C

make -C "$repo" -j2 build/libcg.a >/dev/null
cc -std=gnu11 -Wall -Wextra -pthread -I"$repo/src" "$tmp/check.c" \
  "$repo/build/libcg.a" -lsqlite3 -lpthread -lm -o "$tmp/check"
"$tmp/check"
