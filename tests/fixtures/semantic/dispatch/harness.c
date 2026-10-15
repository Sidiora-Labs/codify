#include "cg.h"
#include "semantic.h"
#include "sem_dispatch.h"
#include <assert.h>

sqlite3_stmt *cg_prep(Cg *cg,const char *sql) {
    sqlite3_stmt *s=NULL;
    if(sqlite3_prepare_v2(cg->db,sql,-1,&s,NULL)!=SQLITE_OK) {
        fprintf(stderr,"prepare: %s: %s\n",sql,sqlite3_errmsg(cg->db));exit(1);
    }
    return s;
}
void cg_exec(Cg *cg,const char *sql) {
    char *err=NULL;
    if(sqlite3_exec(cg->db,sql,NULL,NULL,&err)!=SQLITE_OK) {
        fprintf(stderr,"exec: %s: %s\n",sql,err);exit(1);
    }
}
char *xstrdup(const char *s) { char *p=strdup(s);assert(p);return p; }
int sem_pass_register(const char *name,int order,SemPassFn fn) {
    assert(strcmp(name,"dispatch")==0 && order==50 && fn==sem_dispatch_run);
    return 0;
}

static int count(Cg *cg,const char *sql) {
    sqlite3_stmt *q=cg_prep(cg,sql);assert(sqlite3_step(q)==SQLITE_ROW);
    int n=sqlite3_column_int(q,0);sqlite3_finalize(q);return n;
}
static void equal(Cg *cg,const char *sql,int n) {
    int got=count(cg,sql);
    if(got!=n){fprintf(stderr,"expected %d got %d: %s\n",n,got,sql);exit(1);}
}
static void addfact(Cg *cg,int file,int owner,const char *kind,const char *key,
                    const char *value,int line) {
    sqlite3_stmt *q=cg_prep(cg,"INSERT INTO semantic_type_facts"
        "(file_id,owner_id,kind,name,value,start_line,start_column,evidence) "
        "VALUES(?1,?2,?3,?4,?5,?6,2,'syntax')");
    sqlite3_bind_int(q,1,file);sqlite3_bind_int(q,2,owner);
    sqlite3_bind_text(q,3,kind,-1,SQLITE_STATIC);
    sqlite3_bind_text(q,4,key,-1,SQLITE_STATIC);
    if(value)sqlite3_bind_text(q,5,value,-1,SQLITE_STATIC);
    sqlite3_bind_int(q,6,line);assert(sqlite3_step(q)==SQLITE_DONE);
    sqlite3_finalize(q);
}

int main(void) {
    Cg cg={0};assert(sqlite3_open(":memory:",&cg.db)==SQLITE_OK);cg.branch_id=1;
    cg_exec(&cg,"CREATE TABLE files(id INTEGER PRIMARY KEY,branch_id INTEGER,path TEXT);"
        "CREATE TABLE symbols(id INTEGER PRIMARY KEY,file_id INTEGER,"
        "name TEXT,kind TEXT DEFAULT 'function');"
        "CREATE TABLE semantic_symbols(symbol_id INTEGER PRIMARY KEY,file_id INTEGER,"
        "qualified_name TEXT,parent_id INTEGER);"
        "CREATE TABLE semantic_type_facts(id INTEGER PRIMARY KEY,file_id INTEGER,"
        "owner_id INTEGER,kind TEXT,name TEXT,value TEXT,evidence TEXT,start_line INTEGER,"
        "start_column INTEGER);"
        "CREATE TABLE semantic_references(id INTEGER PRIMARY KEY,file_id INTEGER,"
        "owner_id INTEGER,target_id INTEGER,original_text TEXT,start_line INTEGER,"
        "start_column INTEGER);"
        "CREATE TABLE semantic_edges(id INTEGER PRIMARY KEY,branch_id INTEGER,"
        "source_file_id INTEGER,target_file_id INTEGER,source_id INTEGER,"
        "target_id INTEGER,kind TEXT,original_text TEXT,strategy TEXT,"
        "provenance TEXT,evidence TEXT,channel TEXT,registration_path TEXT,"
        "start_line INTEGER,start_column INTEGER,registration_line INTEGER,"
        "registration_column INTEGER,synthesized INTEGER,registration_end_line INTEGER);"
        "INSERT INTO files VALUES(1,1,'caller.ts'),(2,1,'target.ts'),"
        "(3,1,'impl.ts'),(4,2,'other.ts');"
        "INSERT INTO symbols(id,file_id,name) VALUES(10,1,'caller'),(11,1,'producer'),"
        "(12,1,'Parent'),(13,1,'update'),(20,2,'callback'),"
        "(21,2,'observer'),(22,2,'slotTarget'),(23,2,'Child'),"
        "(24,2,'nativeTarget'),(25,1,'Render'),"
        "(30,3,'Interface'),(31,3,'work'),(32,3,'Concrete'),"
        "(33,3,'work'),(40,4,'callback');"
        "INSERT INTO semantic_symbols(symbol_id,file_id,qualified_name,parent_id) "
        "VALUES(10,1,'caller',NULL),(11,1,'producer',NULL),"
        "(12,1,'Parent',NULL),(13,1,'update',NULL),"
        "(20,2,'callback',NULL),(21,2,'observer',NULL),"
        "(22,2,'slotTarget',NULL),(23,2,'Child',NULL),"
        "(24,2,'nativeTarget',NULL),(25,1,'Render',NULL),"
        "(30,3,'Interface',NULL),(31,3,'Interface.work',30),"
        "(32,3,'Concrete',NULL),(33,3,'Concrete.work',32);"
        "INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
        "source_id,target_id,kind,strategy,provenance,synthesized,start_line) "
        "VALUES(1,3,3,32,30,'implements','type','resolved',0,9);"
        "INSERT INTO semantic_references(file_id,owner_id,target_id,original_text,"
        "start_line,start_column) VALUES(1,10,31,'api.work()',15,4);");
    addfact(&cg,1,10,"callback_registration","addEventListener","callback",2);
    addfact(&cg,1,11,"event_emit","saved",NULL,3);
    addfact(&cg,2,20,"event_subscription","saved","callback",4);
    addfact(&cg,1,11,"observer_notify","changed",NULL,5);
    addfact(&cg,2,21,"observer_subscription","changed","observer",6);
    addfact(&cg,1,11,"pointer_call","table.slot",NULL,7);
    addfact(&cg,1,11,"pointer_slot","table.slot","slotTarget",8);
    addfact(&cg,1,11,"pointer_call","remote.slot",NULL,8);
    addfact(&cg,2,22,"pointer_slot","remote.slot","slotTarget",8);
    addfact(&cg,1,12,"jsx_component","Child",NULL,9);
    addfact(&cg,1,13,"state_setter_call","setCount",NULL,10);
    addfact(&cg,1,25,"state_setter","setCount","Render",11);
    addfact(&cg,1,11,"native_bridge_call","nativeOpen",NULL,12);
    addfact(&cg,2,24,"native_bridge_registration","nativeOpen","nativeTarget",13);
    addfact(&cg,1,11,"event_emit","${dynamic}",NULL,14);
    addfact(&cg,2,20,"event_subscription","not-matching","callback",15);
    cg_exec(&cg,"UPDATE semantic_type_facts SET evidence='path:bus' "
                "WHERE kind IN ('event_emit','event_subscription');"
                "UPDATE semantic_type_facts SET evidence='path:store' "
                "WHERE kind IN ('observer_notify','observer_subscription')");
    addfact(&cg,2,21,"event_subscription","saved","observer",17);
    cg_exec(&cg,"UPDATE semantic_type_facts SET evidence='path:otherBus' "
                "WHERE kind='event_subscription' AND start_line=17");
    sem_dispatch_register();
    assert(sem_dispatch_run(&cg,NULL,0)==0);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE synthesized=1",8);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE kind='interface_dispatch' "
              "AND source_id=10 AND target_id=33",1);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE synthesized=1 AND "
              "(provenance<>'heuristic' OR registration_path='' OR "
              "registration_line IS NULL)",0);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE kind='implements'",1);
    /* No-op and unrelated edits do not replace existing synthesized rows. */
    int id=count(&cg,"SELECT max(id) FROM semantic_edges");
    long unchanged=4; assert(sem_dispatch_run(&cg,&unchanged,0)==0);
    assert(sem_dispatch_run(&cg,&unchanged,1)==0);
    equal(&cg,"SELECT max(id) FROM semantic_edges",id);
    /* Rewiring removes old edges; an ambiguous registration stays unknown. */
    cg_exec(&cg,"UPDATE semantic_type_facts SET name='renamed' "
                "WHERE kind='event_subscription' AND name='saved'");
    long changed=2;assert(sem_dispatch_run(&cg,&changed,1)==0);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE kind='event_dispatch'",0);
    addfact(&cg,1,10,"pointer_slot","table.slot","observer",16);
    assert(sem_dispatch_run(&cg,&changed,1)==0);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE kind='pointer_dispatch'",0);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE kind='implements'",1);
    /* A same-name overload without signature evidence is not a target. */
    cg_exec(&cg,"INSERT INTO symbols(id,file_id,name) VALUES(34,3,'work');"
                "INSERT INTO semantic_symbols(symbol_id,file_id,qualified_name,"
                "parent_id) VALUES(34,3,'Concrete.work#2',32)");
    long changed_type=3;assert(sem_dispatch_run(&cg,&changed_type,1)==0);
    equal(&cg,"SELECT count(*) FROM semantic_edges WHERE kind='interface_dispatch'",0);
    sqlite3_close(cg.db);puts("ok");return 0;
}
