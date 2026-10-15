#include "cg.h"
#include "sem_types.h"
#include <assert.h>

sqlite3_stmt *cg_prep(Cg *cg, const char *sql) {
    sqlite3_stmt *q=NULL;
    int rc=sqlite3_prepare_v2(cg->db,sql,-1,&q,NULL);
    if (rc!=SQLITE_OK) { fprintf(stderr,"prepare: %s\n",sqlite3_errmsg(cg->db)); abort(); }
    return q;
}
int sem_pass_register(const char *name,int order,SemPassFn fn) {
    assert(!strcmp(name,"types") && order==30 && fn==sem_types_run);
    return 0;
}
static void sql(Cg *cg,const char *statement) {
    char *error=NULL;
    if (sqlite3_exec(cg->db,statement,NULL,NULL,&error)!=SQLITE_OK) {
        fprintf(stderr,"sql: %s\n",error); abort();
    }
}
static int count(Cg *cg,const char *where) {
    char query[512]; snprintf(query,sizeof query,
        "SELECT count(*) FROM semantic_edges WHERE %s",where);
    sqlite3_stmt *q=cg_prep(cg,query);
    assert(sqlite3_step(q)==SQLITE_ROW);
    int n=sqlite3_column_int(q,0); sqlite3_finalize(q); return n;
}
int main(void) {
    Cg cg={0}; assert(sqlite3_open(":memory:",&cg.db)==SQLITE_OK);
    cg.branch_id=1;
    sql(&cg,"CREATE TABLE files(id INTEGER PRIMARY KEY,branch_id INTEGER);"
        "CREATE TABLE symbols(id INTEGER PRIMARY KEY,file_id INTEGER,name TEXT,kind TEXT);"
        "CREATE TABLE semantic_symbols(symbol_id INTEGER PRIMARY KEY,file_id INTEGER,"
        "parent_id INTEGER,qualified_name TEXT,visibility TEXT,start_byte INTEGER,"
        "end_byte INTEGER,start_line INTEGER,start_column INTEGER,end_line INTEGER,end_column INTEGER);"
        "CREATE TABLE semantic_bindings(file_id INTEGER,target_symbol_id INTEGER);"
        "CREATE TABLE semantic_type_facts(owner_id INTEGER,file_id INTEGER,name TEXT,"
        "kind TEXT,value TEXT,evidence TEXT,id INTEGER PRIMARY KEY,start_byte INTEGER,"
        "end_byte INTEGER,start_line INTEGER,start_column INTEGER,end_line INTEGER,end_column INTEGER);"
        "CREATE TABLE semantic_dependencies(branch_id INTEGER,file_id INTEGER,"
        "dependency_key TEXT,kind TEXT,UNIQUE(branch_id,file_id,dependency_key,kind));"
        "CREATE TABLE semantic_edges(branch_id INTEGER,source_file_id INTEGER,"
        "target_file_id INTEGER,source_id INTEGER,target_id INTEGER,kind TEXT,"
        "original_text TEXT,strategy TEXT,provenance TEXT,evidence TEXT,"
        "start_byte INTEGER,end_byte INTEGER,start_line INTEGER,start_column INTEGER,"
        "end_line INTEGER,end_column INTEGER);");
    sql(&cg,"INSERT INTO files VALUES(1,1),(2,1),(3,1),(4,2);"
        "INSERT INTO symbols VALUES"
        "(10,1,'Base','class'),(11,2,'Derived','class'),"
        "(12,2,'run','method'),(13,1,'Twin','class'),"
        "(14,3,'Twin','class'),(15,1,'I','interface'),"
        "(16,2,'Impl','class'),(17,4,'Base','class'),"
        "(18,2,'Audit','class'),(19,1,'Tag','class'),(20,3,'Tag','class');"
        "INSERT INTO semantic_symbols VALUES"
        "(10,1,NULL,'Base','public',0,5,1,0,1,5),"
        "(11,2,NULL,'Derived','public',0,7,1,0,1,7),"
        "(12,2,11,'Derived.run','public',8,11,2,0,2,3),"
        "(13,1,NULL,'Twin','public',0,4,2,0,2,4),"
        "(14,3,NULL,'Twin','public',0,4,1,0,1,4),"
        "(15,1,NULL,'I','public',6,7,3,0,3,1),"
        "(16,2,NULL,'Impl','public',20,24,4,0,4,4),"
        "(17,4,NULL,'Base','public',0,5,1,0,1,5),"
        "(18,2,NULL,'Audit','public',30,35,6,0,6,5),"
        "(19,1,NULL,'Tag','public',30,33,5,0,5,3),"
        "(20,3,NULL,'Tag','public',30,33,5,0,5,3);"
        "INSERT INTO semantic_bindings VALUES(2,10),(2,15);"
        "INSERT INTO semantic_type_facts VALUES"
        "(11,2,'base','inherits',': public Base','extends clause',1,0,4,1,9,1,13),"
        "(16,2,'interface','implements','I','implements clause',2,20,21,4,5,4,6),"
        "(12,2,'result','returns','-> Base','return annotation',3,8,12,2,4,2,8),"
        "(11,2,'ambiguous','type','Twin','type annotation',4,30,34,5,0,5,4),"
        "(12,2,'run','decorates','@Audit','decorator',5,36,42,7,0,7,6),"
        "(12,2,'run','decorates','@Tag','decorator',6,43,47,8,0,8,4);");
    assert(sem_types_register()==0);
    assert(sem_types_run(&cg,NULL,0)==0);
    assert(count(&cg,"branch_id=1 AND kind='inherits' AND source_id=11 AND target_id=10")==1);
    assert(count(&cg,"branch_id=1 AND kind='implements' AND source_id=16 AND target_id=15")==1);
    assert(count(&cg,"branch_id=1 AND kind='returns' AND source_id=12 AND target_id=10")==1);
    assert(count(&cg,"branch_id=1 AND kind='contains' AND source_id=11 AND target_id=12")==1);
    assert(count(&cg,"branch_id=1 AND kind='decorates' AND source_id=12 AND target_id=18")==1);
    assert(count(&cg,"kind='type' OR target_id=17 OR target_id=19 OR target_id=20")==0);
    sqlite3_stmt *deps=cg_prep(&cg,"SELECT count(*) FROM semantic_dependencies "
        "WHERE branch_id=1 AND file_id=2 AND dependency_key='type:Base'");
    assert(sqlite3_step(deps)==SQLITE_ROW && sqlite3_column_int(deps,0)==1);
    sqlite3_finalize(deps);
    long ids[8];
    assert(sem_type_ancestors(&cg,11,ids,8)==1 && ids[0]==10);
    assert(sem_type_subtypes(&cg,10,ids,8)==1 && ids[0]==11);
    assert(sem_type_implementations(&cg,15,ids,8)==1 && ids[0]==16);
    long empty[1]={0}; assert(sem_types_run(&cg,empty,0)==0);
    assert(count(&cg,"branch_id=1")==5);
    sql(&cg,"INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
        "source_id,target_id,kind,strategy) VALUES(1,1,1,10,15,'type','type_hierarchy');");
    sql(&cg,"DELETE FROM semantic_type_facts WHERE id=1;");
    long changed[1]={2}; assert(sem_types_run(&cg,changed,1)==0);
    assert(count(&cg,"kind='inherits'")==0);
    assert(count(&cg,"source_file_id=1 AND kind='type'")==1);
    assert(sem_type_ancestors(&cg,11,ids,8)==0);
    cg.branch_id=2;
    assert(sem_type_subtypes(&cg,10,ids,8)==0);
    sqlite3_close(cg.db);
    puts("semantic type relations: pass");
    return 0;
}
