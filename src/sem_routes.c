/* Route registrations become addressable graph nodes. All links are rebuilt
 * after a changed source file, so changing only registration wiring is enough
 * to remove an obsolete link. Unknown and competing targets stay unresolved. */
#include "cg.h"
#include "sem_routes.h"
#include <ctype.h>

int sem_pass_register(const char *name,int order,
                      int (*fn)(Cg *,const long *,int));

static const char *SCHEMA =
    "CREATE TABLE IF NOT EXISTS semantic_route_facts("
    "route_id INTEGER PRIMARY KEY,route_symbol_id INTEGER NOT NULL,"
    "branch_id INTEGER NOT NULL,registration_file_id INTEGER NOT NULL,"
    "framework TEXT NOT NULL,method TEXT NOT NULL,pattern TEXT NOT NULL,"
    "handler_symbol_id INTEGER,handler_file_id INTEGER,status TEXT NOT NULL,evidence TEXT,"
    "registration_line INTEGER NOT NULL,registration_column INTEGER NOT NULL DEFAULT 0);"
    "CREATE INDEX IF NOT EXISTS idx_sem_route_match ON "
    "semantic_route_facts(branch_id,method,pattern);"
    "CREATE TABLE IF NOT EXISTS semantic_route_compositions("
    "mount_route_id INTEGER NOT NULL,child_route_id INTEGER NOT NULL,"
    "branch_id INTEGER NOT NULL,method TEXT NOT NULL,pattern TEXT NOT NULL,"
    "route_symbol_id INTEGER NOT NULL,handler_symbol_id INTEGER,"
    "registration_file_id INTEGER NOT NULL,registration_line INTEGER NOT NULL,"
    "PRIMARY KEY(mount_route_id,child_route_id));"
    "CREATE INDEX IF NOT EXISTS idx_sem_route_composed_match ON "
    "semantic_route_compositions(branch_id,method,pattern);";

static void ensure_route_schema(Cg *cg) {
    cg_exec(cg,SCHEMA);
    sqlite3_stmt *q=cg_prep(cg,"PRAGMA table_info(semantic_route_facts)");
    bool column=false;
    while(sqlite3_step(q)==SQLITE_ROW) {
        const char *name=(const char*)sqlite3_column_text(q,1);
        if(name&&strcmp(name,"registration_column")==0)column=true;
    }
    sqlite3_finalize(q);
    if(!column)cg_exec(cg,"ALTER TABLE semantic_route_facts "
        "ADD COLUMN registration_column INTEGER NOT NULL DEFAULT 0");
}

static int step_done(sqlite3_stmt *q) {
    int rc=sqlite3_step(q);
    sqlite3_reset(q); sqlite3_clear_bindings(q);
    return rc==SQLITE_DONE ? 0 : -1;
}

static long exact_symbol(Cg *cg, long file, const char *name, int *count) {
    sqlite3_stmt *q=cg_prep(cg,"SELECT id FROM symbols WHERE file_id=?1 "
        "AND name=?2 AND kind IN ('function','method','class','component','variable') "
        "AND decl=0 LIMIT 3");
    sqlite3_bind_int64(q,1,file); sqlite3_bind_text(q,2,name,-1,SQLITE_TRANSIENT);
    long id=0; *count=0;
    while (sqlite3_step(q)==SQLITE_ROW) { id=sqlite3_column_int64(q,0); (*count)++; }
    sqlite3_finalize(q); return *count==1?id:0;
}

static long resolve_handler(Cg *cg,long file,const char *fw,const char *handler,int *count) {
    *count=0;
    if (!handler || !*handler) return 0;
    const char *hash=strrchr(handler,'#');
    if(hash&&hash>handler&&hash[1]) {
        char owner[128];size_t n=(size_t)(hash-handler);
        if(n>=sizeof owner)return 0;
        memcpy(owner,handler,n);owner[n]=0;
        sqlite3_stmt *q=cg_prep(cg,"SELECT s.id FROM symbols s JOIN files f "
            "ON f.id=s.file_id WHERE f.branch_id=?1 AND s.name=?2 "
            "AND lower(f.path) LIKE '%'||lower(?3)||'%' AND "
            "(?4='' OR lower(f.path) LIKE '%'||?4) AND "
            "s.kind IN ('function','method') AND s.decl=0 LIMIT 3");
        sqlite3_bind_int64(q,1,cg->branch_id);
        sqlite3_bind_text(q,2,hash+1,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(q,3,owner,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(q,4,fw&&strcmp(fw,"rails")==0?".rb":
            fw&&strcmp(fw,"laravel")==0?".php":"",-1,SQLITE_STATIC);
        long found=0;while(sqlite3_step(q)==SQLITE_ROW){found=sqlite3_column_int64(q,0);(*count)++;}
        sqlite3_finalize(q);return *count==1?found:0;
    }
    const char *name=strrchr(handler,'.');
    name=name?name+1:handler;
    long id=0;
    if(name==handler){
        id=exact_symbol(cg,file,name,count);
        if(*count)return id;
    } else {
        sqlite3_stmt *owned=cg_prep(cg,"SELECT ss.symbol_id FROM "
            "semantic_symbols ss JOIN symbols s ON s.id=ss.symbol_id "
            "WHERE s.file_id=?1 AND ss.qualified_name=?2 LIMIT 3");
        sqlite3_bind_int64(owned,1,file);
        sqlite3_bind_text(owned,2,handler,-1,SQLITE_TRANSIENT);
        while(sqlite3_step(owned)==SQLITE_ROW){id=sqlite3_column_int64(owned,0);(*count)++;}
        sqlite3_finalize(owned);
        if(*count)return *count==1?id:0;
    }
    /* A local alias may point directly at the exported target. Namespace
     * receivers retain their binding and resolve the member in that file. */
    sqlite3_stmt *direct=cg_prep(cg,"SELECT DISTINCT target_symbol_id FROM "
        "semantic_bindings WHERE file_id=?1 AND local_name=?2 "
        "AND target_symbol_id IS NOT NULL LIMIT 3");
    sqlite3_bind_int64(direct,1,file);
    sqlite3_bind_text(direct,2,handler,-1,SQLITE_TRANSIENT);
    long direct_id=0;int direct_n=0;
    while(sqlite3_step(direct)==SQLITE_ROW){direct_id=sqlite3_column_int64(direct,0);direct_n++;}
    sqlite3_finalize(direct);
    if(direct_n){*count=direct_n;return direct_n==1?direct_id:0;}
    char qualifier[128]={0};
    if(name>handler){size_t qn=(size_t)(name-handler-1);
        if(qn<sizeof qualifier){memcpy(qualifier,handler,qn);qualifier[qn]=0;}}
    sqlite3_stmt *q=cg_prep(cg,"SELECT DISTINCT target_file_id,"
        "CASE WHEN local_name=?2 AND original_name IS NOT NULL "
        "AND original_name!='*' THEN original_name ELSE ?3 END "
        "FROM semantic_bindings WHERE file_id=?1 AND target_file_id IS NOT NULL "
        "AND (local_name=?2 OR local_name=?4) LIMIT 16");
    sqlite3_bind_int64(q,1,file);
    sqlite3_bind_text(q,2,name,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,3,name,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,4,qualifier,-1,SQLITE_TRANSIENT);
    int total=0; long found=0;
    while (sqlite3_step(q)==SQLITE_ROW) {
        const char *original=(const char*)sqlite3_column_text(q,1);
        int n=0; long sid=exact_symbol(cg,sqlite3_column_int64(q,0),
                                       original?original:name,&n);
        total+=n; if (n==1) found=sid;
    }
    sqlite3_finalize(q);
    if(!total) {
        /* Legacy import rows remain useful for languages without richer
         * bindings. A whole-module import without a receiver is not enough. */
        q=cg_prep(cg,"SELECT DISTINCT target_file_id FROM imports WHERE "
            "file_id=?1 AND target_file_id IS NOT NULL AND name=?2 LIMIT 16");
        sqlite3_bind_int64(q,1,file);sqlite3_bind_text(q,2,name,-1,SQLITE_TRANSIENT);
        while(sqlite3_step(q)==SQLITE_ROW){
            int n=0;long sid=exact_symbol(cg,sqlite3_column_int64(q,0),name,&n);
            total+=n;if(n==1)found=sid;
        }
        sqlite3_finalize(q);
    }
    *count=total;
    return total==1?found:0;
}

static long adjacent_handler(Cg *cg,long file,int line,int *count) {
    sqlite3_stmt *q=cg_prep(cg,"SELECT id,line FROM symbols WHERE file_id=?1 "
        "AND kind IN ('function','method') AND decl=0 AND line>=?2 "
        "AND line<=?3 ORDER BY line LIMIT 3");
    sqlite3_bind_int64(q,1,file);sqlite3_bind_int(q,2,line);
    sqlite3_bind_int(q,3,line+5);
    int n=0;long id=0,first_line=0;
    while(sqlite3_step(q)==SQLITE_ROW){
        long at=sqlite3_column_int64(q,1);
        if(n&&at!=first_line)break;
        if(!n)first_line=at;
        id=sqlite3_column_int64(q,0);n++;
    }
    sqlite3_finalize(q);*count=n;return n==1?id:0;
}

static long sole_default_handler(Cg *cg,long file,int *count) {
    sqlite3_stmt *q=cg_prep(cg,"SELECT id FROM symbols WHERE file_id=?1 "
        "AND kind IN ('function','method') AND decl=0 "
        "AND (sig LIKE '%export default%' OR EXISTS("
        "SELECT 1 FROM semantic_bindings b WHERE b.file_id=?1 "
        "AND b.is_export=1 AND b.exported_name='default' "
        "AND b.local_name=symbols.name)) LIMIT 2");
    sqlite3_bind_int64(q,1,file);int n=0;long id=0;
    while(sqlite3_step(q)==SQLITE_ROW){id=sqlite3_column_int64(q,0);n++;}
    sqlite3_finalize(q);*count=n;return n==1?id:0;
}

static bool source_line(Cg *cg,const char *path,int want,char out[4096]) {
    if(!path||strstr(path,".."))return false;
    char full[8192];snprintf(full,sizeof full,"%s/%s",cg->root,path);
    FILE *f=fopen(full,"rb");if(!f)return false;
    bool ok=false;for(int i=1;i<=want;i++){
        if(!fgets(out,4096,f))break;
        if(i==want){ok=true;break;}
    }
    fclose(f);return ok;
}

static int source_column(Cg *cg,const char *path,int line,
                         const char *fw,const char *method) {
    char code[4096];if(!source_line(cg,path,line,code))return 0;
    const char *at=NULL;
    if(fw&&strcmp(fw,"react-router")==0)at=strstr(code,"<Route");
    else if(fw&&strcmp(fw,"vue-router")==0)at=strstr(code,"path:");
    else if(method&&strlen(method)<20){
        char needle[32];snprintf(needle,sizeof needle,".%s(",method);
        at=strcasestr(code,needle);
        if(!at){snprintf(needle,sizeof needle,"::%s(",method);
            at=strcasestr(code,needle);}
    }
    if(at)return (int)(at-code);
    int col=0;while(code[col]==' '||code[col]=='\t')col++;
    return col;
}

static bool receiver_is(const char *line,const char *name) {
    size_t n=strlen(name);if(!n||n>128)return false;
    const char *p=line;
    while((p=strstr(p,name))!=NULL){
        bool left=p==line||!(isalnum((unsigned char)p[-1])||p[-1]=='_');
        if(left&&p[n]=='.')return true;
        p++;
    }
    return false;
}

static bool affected(Cg *cg,const long *changed,int n) {
    if(!changed)return true;
    if(n==0)return false;
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT 1 WHERE EXISTS(SELECT 1 FROM routes WHERE file_id=?1) "
        "OR EXISTS(SELECT 1 FROM semantic_route_facts WHERE branch_id=?2 "
        "AND (registration_file_id=?1 OR handler_file_id=?1)) "
        "OR EXISTS(SELECT 1 FROM imports i JOIN routes r ON r.file_id=i.file_id "
        "WHERE i.target_file_id=?1) LIMIT 1");
    bool yes=false;
    for(int i=0;i<n;i++) {
        sqlite3_bind_int64(q,1,changed[i]);sqlite3_bind_int64(q,2,cg->branch_id);
        yes=sqlite3_step(q)==SQLITE_ROW;
        sqlite3_reset(q);sqlite3_clear_bindings(q);
        if(yes)break;
    }
    sqlite3_finalize(q);return yes;
}

static int compose_mounts(Cg *cg) {
    sqlite3_stmt *clear=cg_prep(cg,"DELETE FROM semantic_route_compositions WHERE branch_id=?1");
    sqlite3_bind_int64(clear,1,cg->branch_id);
    if(step_done(clear)){sqlite3_finalize(clear);return -1;}sqlite3_finalize(clear);
    sqlite3_stmt *mounts=cg_prep(cg,"SELECT rf.route_id,rf.route_symbol_id,"
        "rf.registration_file_id,rf.pattern,r.handler,rf.registration_line,f.path "
        "FROM semantic_route_facts rf JOIN routes r ON r.id=rf.route_id "
        "JOIN files f ON f.id=rf.registration_file_id "
        "WHERE rf.branch_id=?1 AND rf.method='MOUNT' LIMIT 10000");
    sqlite3_bind_int64(mounts,1,cg->branch_id);
    sqlite3_stmt *imp=cg_prep(cg,"SELECT target_file_id FROM imports WHERE "
        "file_id=?1 AND name=?2 AND target_file_id IS NOT NULL LIMIT 2");
    sqlite3_stmt *children=cg_prep(cg,"SELECT rf.route_id,rf.route_symbol_id,"
        "rf.method,rf.pattern,rf.handler_symbol_id,rf.registration_line,f.path "
        "FROM semantic_route_facts rf JOIN files f ON f.id=rf.registration_file_id "
        "WHERE rf.registration_file_id=?1 AND rf.method NOT IN ('MOUNT','PAGE') "
        "LIMIT 257");
    sqlite3_stmt *ins=cg_prep(cg,"INSERT INTO semantic_route_compositions "
        "(mount_route_id,child_route_id,branch_id,method,pattern,route_symbol_id,"
        "handler_symbol_id,registration_file_id,registration_line) "
        "VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)");
    sqlite3_stmt *edge=cg_prep(cg,"INSERT INTO semantic_edges(branch_id,"
        "source_file_id,target_file_id,source_id,target_id,kind,original_text,"
        "strategy,provenance,evidence,channel,registration_path,start_line,"
        "registration_line,synthesized) VALUES(?1,?2,?3,?4,?5,'route_mount',"
        "?6,'route-registration','resolved',?7,?8,?9,?10,?10,0)");
    int rc=0;
    while(sqlite3_step(mounts)==SQLITE_ROW){
        long mid=sqlite3_column_int64(mounts,0),msym=sqlite3_column_int64(mounts,1);
        long mfid=sqlite3_column_int64(mounts,2);
        const char *prefix=(const char*)sqlite3_column_text(mounts,3);
        const char *receiver=(const char*)sqlite3_column_text(mounts,4);
        int mline=sqlite3_column_int(mounts,5);
        const char *mpath=(const char*)sqlite3_column_text(mounts,6);
        if(!receiver||!prefix||prefix[0]!='/')continue;
        long target_file=mfid;
        sqlite3_bind_int64(imp,1,mfid);sqlite3_bind_text(imp,2,receiver,-1,SQLITE_TRANSIENT);
        int ni=0;while(sqlite3_step(imp)==SQLITE_ROW){target_file=sqlite3_column_int64(imp,0);ni++;}
        sqlite3_reset(imp);sqlite3_clear_bindings(imp);
        if(ni>1)continue;
        sqlite3_bind_int64(children,1,target_file);
        int nc=0;
        while(sqlite3_step(children)==SQLITE_ROW){
            if(++nc>256)break;
            const char *child_path=(const char*)sqlite3_column_text(children,6);
            int cline=sqlite3_column_int(children,5);
            char code[4096];
            if(!source_line(cg,child_path,cline,code)||!receiver_is(code,receiver))continue;
            long cid=sqlite3_column_int64(children,0),csym=sqlite3_column_int64(children,1);
            const char *method=(const char*)sqlite3_column_text(children,2);
            const char *suffix=(const char*)sqlite3_column_text(children,3);
            long handler=sqlite3_column_int64(children,4);
            char joined[1024];
            size_t plen=strlen(prefix);
            snprintf(joined,sizeof joined,"%.*s%s",(int)(plen==1?0:
                plen>1&&prefix[plen-1]=='/'?plen-1:plen),prefix,
                suffix&&suffix[0]=='/'?suffix:"/");
            sqlite3_bind_int64(ins,1,mid);sqlite3_bind_int64(ins,2,cid);
            sqlite3_bind_int64(ins,3,cg->branch_id);
            sqlite3_bind_text(ins,4,method,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(ins,5,joined,-1,SQLITE_TRANSIENT);
            sqlite3_bind_int64(ins,6,csym);
            if(handler)sqlite3_bind_int64(ins,7,handler);
            sqlite3_bind_int64(ins,8,mfid);sqlite3_bind_int(ins,9,mline);
            if(step_done(ins)){rc=-1;break;}
            char evidence[1200];snprintf(evidence,sizeof evidence,
                "mount %s:%d composes %s:%d",mpath?mpath:"",mline,child_path?child_path:"",cline);
            sqlite3_bind_int64(edge,1,cg->branch_id);sqlite3_bind_int64(edge,2,mfid);
            sqlite3_bind_int64(edge,3,target_file);sqlite3_bind_int64(edge,4,msym);
            sqlite3_bind_int64(edge,5,csym);
            sqlite3_bind_text(edge,6,receiver,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(edge,7,evidence,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(edge,8,joined,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(edge,9,mpath?mpath:"",-1,SQLITE_TRANSIENT);
            sqlite3_bind_int(edge,10,mline);
            if(step_done(edge)){rc=-1;break;}
        }
        sqlite3_reset(children);sqlite3_clear_bindings(children);
        if(rc)break;
    }
    sqlite3_finalize(mounts);sqlite3_finalize(imp);sqlite3_finalize(children);
    sqlite3_finalize(ins);sqlite3_finalize(edge);return rc;
}

static int link_navigation(Cg *cg) {
    sqlite3_stmt *nav=cg_prep(cg,"SELECT rf.route_symbol_id,rf.registration_file_id,"
        "rf.registration_line,rf.pattern,f.path FROM semantic_route_facts rf "
        "JOIN files f ON f.id=rf.registration_file_id WHERE rf.branch_id=?1 "
        "AND rf.method='NAV' LIMIT 10000");
    sqlite3_bind_int64(nav,1,cg->branch_id);
    sqlite3_stmt *target=cg_prep(cg,"SELECT rf.route_symbol_id,rf.registration_file_id "
        "FROM semantic_route_facts rf WHERE rf.branch_id=?1 AND rf.method='PAGE' "
        "AND rf.pattern=?2 LIMIT 2");
    sqlite3_stmt *edge=cg_prep(cg,"INSERT INTO semantic_edges(branch_id,"
        "source_file_id,target_file_id,source_id,target_id,kind,original_text,"
        "strategy,provenance,evidence,channel,registration_path,start_line,"
        "registration_line,synthesized) VALUES(?1,?2,?3,?4,?5,'route_navigation',"
        "?6,'literal-navigation','resolved',?7,?8,?9,?10,?10,0)");
    int rc=0;
    while(sqlite3_step(nav)==SQLITE_ROW){
        long source=sqlite3_column_int64(nav,0),sf=sqlite3_column_int64(nav,1);
        int line=sqlite3_column_int(nav,2);
        const char *path=(const char*)sqlite3_column_text(nav,3);
        const char *file=(const char*)sqlite3_column_text(nav,4);
        sqlite3_bind_int64(target,1,cg->branch_id);
        sqlite3_bind_text(target,2,path,-1,SQLITE_TRANSIENT);
        int count=0;long tid=0,tf=0;
        while(sqlite3_step(target)==SQLITE_ROW){
            count++;tid=sqlite3_column_int64(target,0);tf=sqlite3_column_int64(target,1);
        }
        sqlite3_reset(target);sqlite3_clear_bindings(target);
        if(count!=1)continue;
        char evidence[768];snprintf(evidence,sizeof evidence,
            "literal navigation at %s:%d",file?file:"",line);
        sqlite3_bind_int64(edge,1,cg->branch_id);sqlite3_bind_int64(edge,2,sf);
        sqlite3_bind_int64(edge,3,tf);sqlite3_bind_int64(edge,4,source);
        sqlite3_bind_int64(edge,5,tid);
        sqlite3_bind_text(edge,6,path,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(edge,7,evidence,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(edge,8,path,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(edge,9,file?file:"",-1,SQLITE_TRANSIENT);
        sqlite3_bind_int(edge,10,line);
        if(step_done(edge)){rc=-1;break;}
    }
    sqlite3_finalize(nav);sqlite3_finalize(target);sqlite3_finalize(edge);
    return rc;
}

int sem_routes_pass(Cg *cg,const long *changed_files,int nfiles) {
    if (changed_files && nfiles==0) return 0;
    ensure_route_schema(cg);
    if(!affected(cg,changed_files,nfiles))return 0;
    /* Remove facts for deleted/replaced registrations and their synthetic
     * graph nodes. File replacement may already have deleted the symbol. */
    sqlite3_stmt *clear=cg_prep(cg,"DELETE FROM semantic_edges WHERE kind IN "
        "('route_handler','route_mount','route_navigation') AND branch_id=?1");
    sqlite3_bind_int64(clear,1,cg->branch_id);
    if (step_done(clear)) {sqlite3_finalize(clear);return -1;}
    sqlite3_finalize(clear);
    sqlite3_stmt *old=cg_prep(cg,"SELECT route_symbol_id FROM semantic_route_facts "
        "WHERE branch_id=?1 AND route_id NOT IN (SELECT r.id FROM routes r "
        "JOIN files f ON f.id=r.file_id WHERE f.branch_id=?1)");
    sqlite3_bind_int64(old,1,cg->branch_id);
    sqlite3_stmt *del_fts=cg_prep(cg,"DELETE FROM symbol_fts WHERE rowid=?1");
    sqlite3_stmt *del_sym=cg_prep(cg,"DELETE FROM symbols WHERE id=?1");
    while (sqlite3_step(old)==SQLITE_ROW) {
        long id=sqlite3_column_int64(old,0);
        sqlite3_bind_int64(del_fts,1,id);sqlite3_bind_int64(del_sym,1,id);
        if (step_done(del_fts)||step_done(del_sym)) {
            sqlite3_finalize(old);sqlite3_finalize(del_fts);
            sqlite3_finalize(del_sym);return -1;
        }
    }
    sqlite3_finalize(old);sqlite3_finalize(del_fts);sqlite3_finalize(del_sym);
    sqlite3_stmt *prune=cg_prep(cg,"DELETE FROM semantic_route_facts WHERE "
        "branch_id=?1 AND route_id NOT IN (SELECT r.id FROM routes r JOIN "
        "files f ON f.id=r.file_id WHERE f.branch_id=?1)");
    sqlite3_bind_int64(prune,1,cg->branch_id);
    if (step_done(prune)) { sqlite3_finalize(prune); return -1; }
    sqlite3_finalize(prune);

    sqlite3_stmt *routes=cg_prep(cg,"SELECT r.id,r.file_id,r.framework,r.method,"
        "r.pattern,r.handler,r.line,rf.route_symbol_id,f.path FROM routes r JOIN files f "
        "ON f.id=r.file_id LEFT JOIN semantic_route_facts rf ON rf.route_id=r.id "
        "WHERE f.branch_id=?1 ORDER BY r.id LIMIT 50000");
    sqlite3_bind_int64(routes,1,cg->branch_id);
    sqlite3_stmt *exists=cg_prep(cg,"SELECT 1 FROM symbols WHERE id=?1");
    sqlite3_stmt *insert_sym=cg_prep(cg,"INSERT INTO symbols(file_id,name,kind,line,"
        "end_line,sig,decl) VALUES(?1,?2,'route',?3,?3,?4,0)");
    sqlite3_stmt *insert_fts=cg_prep(cg,"INSERT INTO symbol_fts(rowid,name,kind,"
        "path,sig,words) VALUES(?1,?2,'route',?3,?4,?5)");
    sqlite3_stmt *fact=cg_prep(cg,"INSERT INTO semantic_route_facts(route_id,"
        "route_symbol_id,branch_id,registration_file_id,framework,method,pattern,"
        "handler_symbol_id,handler_file_id,status,evidence,registration_line,"
        "registration_column) VALUES("
        "?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(route_id) DO UPDATE SET "
        "route_symbol_id=excluded.route_symbol_id,branch_id=excluded.branch_id,"
        "registration_file_id=excluded.registration_file_id,framework=excluded.framework,"
        "method=excluded.method,pattern=excluded.pattern,"
        "handler_symbol_id=excluded.handler_symbol_id,"
        "handler_file_id=excluded.handler_file_id,status=excluded.status,"
        "evidence=excluded.evidence,registration_line=excluded.registration_line,"
        "registration_column=excluded.registration_column");
    sqlite3_stmt *edge=cg_prep(cg,"INSERT INTO semantic_edges(branch_id,"
        "source_file_id,target_file_id,source_id,target_id,kind,original_text,"
        "strategy,provenance,evidence,channel,registration_path,start_line,"
        "start_column,registration_line,registration_column,synthesized) "
        "VALUES(?1,?2,?3,?4,?5,'route_handler',"
        "?6,?7,?8,?9,?10,?11,?12,?13,?12,?13,0)");
    sqlite3_stmt *target_file=cg_prep(cg,"SELECT file_id FROM symbols WHERE id=?1");
    int rc=0;
    while (sqlite3_step(routes)==SQLITE_ROW) {
        long rid=sqlite3_column_int64(routes,0),fid=sqlite3_column_int64(routes,1);
        const char *fw=(const char *)sqlite3_column_text(routes,2);
        const char *method=(const char *)sqlite3_column_text(routes,3);
        const char *path=(const char *)sqlite3_column_text(routes,4);
        const char *handler=(const char *)sqlite3_column_text(routes,5);
        int line=sqlite3_column_int(routes,6);
        long route_sym=sqlite3_column_int64(routes,7);
        const char *source_path=(const char *)sqlite3_column_text(routes,8);
        int column=source_column(cg,source_path,line,fw,method);
        if (route_sym) {
            sqlite3_bind_int64(exists,1,route_sym);
            if (sqlite3_step(exists)!=SQLITE_ROW) route_sym=0;
            sqlite3_reset(exists);sqlite3_clear_bindings(exists);
        }
        if (!route_sym) {
            char name[640]; snprintf(name,sizeof name,"%s %s",method?method:"*",path?path:"");
            sqlite3_bind_int64(insert_sym,1,fid);
            sqlite3_bind_text(insert_sym,2,name,-1,SQLITE_TRANSIENT);
            sqlite3_bind_int(insert_sym,3,line);
            sqlite3_bind_text(insert_sym,4,fw?fw:"route",-1,SQLITE_TRANSIENT);
            if (step_done(insert_sym)) {rc=-1;break;}
            route_sym=sqlite3_last_insert_rowid(cg->db);
            char words[1024];name_words(name,words,sizeof words);
            sqlite3_bind_int64(insert_fts,1,route_sym);
            sqlite3_bind_text(insert_fts,2,name,-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(insert_fts,3,source_path?source_path:"",-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(insert_fts,4,fw?fw:"route",-1,SQLITE_TRANSIENT);
            sqlite3_bind_text(insert_fts,5,words,-1,SQLITE_TRANSIENT);
            if(step_done(insert_fts)){rc=-1;break;}
        }
        int matches=0; long target=resolve_handler(cg,fid,fw,handler,&matches);
        if(!handler && fw && (strcmp(fw,"flask")==0 ||
            strcmp(fw,"fastapi")==0 || strcmp(fw,"spring")==0 ||
            strcmp(fw,"aspnet-attr")==0 || strcmp(fw,"actix-macro")==0 ||
            strcmp(fw,"nestjs")==0))
            target=adjacent_handler(cg,fid,line,&matches);
        if(!handler && fw && (strcmp(fw,"nextjs")==0 ||
            strcmp(fw,"expo-router")==0 || strcmp(fw,"nextjs-app")==0 ||
            strcmp(fw,"nuxt")==0))
            target=sole_default_handler(cg,fid,&matches);
        if(!handler && fw && strcmp(fw,"sveltekit")==0 &&
           strcmp(method?method:"","PAGE")==0 &&
           source_path && strstr(source_path,"/+page.server.")) {
            sqlite3_stmt *q=cg_prep(cg,"SELECT 1 FROM semantic_bindings "
                "WHERE file_id=?1 AND is_export=1 AND exported_name='load' LIMIT 1");
            sqlite3_bind_int64(q,1,fid);
            bool exported=sqlite3_step(q)==SQLITE_ROW;
            sqlite3_finalize(q);
            if(exported)target=exact_symbol(cg,fid,"load",&matches);
        }
        const char *status=strcmp(method?method:"","DYNAMIC")==0?"dynamic":
            target?"resolved":matches>1?"ambiguous":handler?"unresolved":"dynamic";
        char evidence[768]; snprintf(evidence,sizeof evidence,
            "%s registration %s:%d; handler candidates=%d",fw?fw:"route",
            source_path?source_path:"",line,matches);
        sqlite3_bind_int64(fact,1,rid); sqlite3_bind_int64(fact,2,route_sym);
        sqlite3_bind_int64(fact,3,cg->branch_id); sqlite3_bind_int64(fact,4,fid);
        sqlite3_bind_text(fact,5,fw?fw:"route",-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(fact,6,method?method:"*",-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(fact,7,path?path:"",-1,SQLITE_TRANSIENT);
        if(target)sqlite3_bind_int64(fact,8,target);
        long tf=0;
        if(target){sqlite3_bind_int64(target_file,1,target);
            if(sqlite3_step(target_file)==SQLITE_ROW)tf=sqlite3_column_int64(target_file,0);
            sqlite3_reset(target_file);sqlite3_clear_bindings(target_file);}
        if(tf)sqlite3_bind_int64(fact,9,tf);
        sqlite3_bind_text(fact,10,status,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(fact,11,evidence,-1,SQLITE_TRANSIENT);
        sqlite3_bind_int(fact,12,line);
        sqlite3_bind_int(fact,13,column);
        if(step_done(fact)){rc=-1;break;}
        if (!target) continue;
        sqlite3_bind_int64(edge,1,cg->branch_id);sqlite3_bind_int64(edge,2,fid);
        sqlite3_bind_int64(edge,3,tf);sqlite3_bind_int64(edge,4,route_sym);
        sqlite3_bind_int64(edge,5,target);
        sqlite3_bind_text(edge,6,handler?handler:"adjacent declaration",-1,SQLITE_TRANSIENT);
        bool convention=handler&&strchr(handler,'#');
        sqlite3_bind_text(edge,7,convention?"framework-convention":"route-registration",-1,SQLITE_STATIC);
        sqlite3_bind_text(edge,8,convention?"heuristic":"resolved",-1,SQLITE_STATIC);
        sqlite3_bind_text(edge,9,evidence,-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(edge,10,path?path:"",-1,SQLITE_TRANSIENT);
        sqlite3_bind_text(edge,11,source_path?source_path:"",-1,SQLITE_TRANSIENT);
        sqlite3_bind_int(edge,12,line);
        sqlite3_bind_int(edge,13,column);
        if(step_done(edge)){rc=-1;break;}
    }
    sqlite3_finalize(routes);sqlite3_finalize(exists);sqlite3_finalize(insert_sym);
    sqlite3_finalize(insert_fts);
    sqlite3_finalize(fact);sqlite3_finalize(edge);sqlite3_finalize(target_file);
    if(rc)return rc;
    rc=compose_mounts(cg);
    return rc?rc:link_navigation(cg);
}

void sem_routes_register(void) { sem_pass_register("routes",40,sem_routes_pass); }

int sem_route_lookup_unique(Cg *cg,const char *method,const char *path,
                            SemRouteMatch *match) {
    if(match)memset(match,0,sizeof *match);
    if(!method||!path||path[0]!='/')return 0;
    sqlite3_stmt *q=cg_prep(cg,"SELECT route_symbol_id,handler_symbol_id,status,"
        "registration_file_id,registration_line,registration_column,path FROM ("
        "SELECT rf.route_symbol_id,rf.handler_symbol_id,rf.status,"
        "rf.registration_file_id,rf.registration_line,rf.registration_column,"
        "f.path,rf.branch_id,rf.method,rf.pattern "
        "FROM semantic_route_facts rf JOIN files f ON f.id=rf.registration_file_id "
        "UNION ALL SELECT c.route_symbol_id,c.handler_symbol_id,"
        "CASE WHEN c.handler_symbol_id IS NULL THEN 'dynamic' ELSE 'resolved' END,"
        "c.registration_file_id,c.registration_line,rf.registration_column,"
        "f.path,c.branch_id,c.method,c.pattern "
        "FROM semantic_route_compositions c JOIN semantic_route_facts rf "
        "ON rf.route_id=c.mount_route_id JOIN files f ON f.id=c.registration_file_id) "
        "WHERE branch_id=?1 AND method=?2 AND pattern=?3 LIMIT 2");
    sqlite3_bind_int64(q,1,cg->branch_id);sqlite3_bind_text(q,2,method,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,3,path,-1,SQLITE_TRANSIENT);
    int n=0;long route=0,handler=0,file=0;int line=0,col=0;
    char regpath[4096]={0};bool ok=false;
    while(sqlite3_step(q)==SQLITE_ROW) {
        n++;route=sqlite3_column_int64(q,0);handler=sqlite3_column_int64(q,1);
        const char *status=(const char *)sqlite3_column_text(q,2);
        ok=status&&strcmp(status,"resolved")==0;
        file=sqlite3_column_int64(q,3);line=sqlite3_column_int(q,4);
        col=sqlite3_column_int(q,5);
        const char *rp=(const char *)sqlite3_column_text(q,6);
        snprintf(regpath,sizeof regpath,"%s",rp?rp:"");
        if(n>1)break;
    }
    sqlite3_finalize(q);
    if(n>1)return -1;
    if(!ok)return n?-1:0;
    if(match){match->route_symbol_id=route;match->handler_symbol_id=handler;
        match->file_id=file;match->line=line;match->column=col;
        snprintf(match->registration_path,sizeof match->registration_path,"%s",regpath);}
    return 1;
}
