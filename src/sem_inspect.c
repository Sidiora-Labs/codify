#include "sem_inspect.h"
#include "sem_types.h"
#include <ctype.h>

#define INSPECT_MAX 64
#define INSPECT_SCAN_MAX 512
#define INSPECT_REACH_MAX 4096

static Cg *scope(Cg *cg, Cg *view, bool json) {
    if (cg->scope_branch==-1) {
        if (json) puts("{\"error\":\"inspect requires one branch\"}");
        else fputs("cg inspect: select one branch\n",stderr);
        return NULL;
    }
    *view=*cg;
    if (cg->scope_branch>0) {
        view->branch_id=cg->scope_branch;
        sqlite3_stmt *q=cg_prep(cg,"SELECT name FROM branches WHERE id=?1");
        sqlite3_bind_int64(q,1,view->branch_id);
        if (sqlite3_step(q)==SQLITE_ROW)
            snprintf(view->branch,sizeof view->branch,"%s",
                     (const char *)sqlite3_column_text(q,0));
        sqlite3_finalize(q);
    }
    return view;
}

static const char *col(sqlite3_stmt *q, int i) {
    const char *s = (const char *)sqlite3_column_text(q,i);
    return s ? s : "";
}

static void item(Cg *cg, StrBuf *b, long id) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT s.name,s.kind,f.path,s.line,coalesce(ss.qualified_name,'') "
        "FROM symbols s JOIN files f ON f.id=s.file_id "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE s.id=?1 AND f.branch_id=?2");
    sqlite3_bind_int64(q,1,id);
    sqlite3_bind_int64(q,2,cg->branch_id);
    if (sqlite3_step(q)==SQLITE_ROW) {
        sb_puts(b,"{\"name\":"); sb_json_str(b,col(q,0));
        sb_puts(b,",\"kind\":"); sb_json_str(b,col(q,1));
        sb_puts(b,",\"path\":"); sb_json_str(b,col(q,2));
        sb_printf(b,",\"line\":%d,\"qualified_name\":",
                  sqlite3_column_int(q,3));
        sb_json_str(b,col(q,4)); sb_putc(b,'}');
    } else sb_puts(b,"null");
    sqlite3_finalize(q);
}

static void hierarchy_set(Cg *cg, StrBuf *b, const char *key,
                          long symbol_id, int limit, int mode) {
    long ids[INSPECT_MAX];
    int n = mode==0 ? sem_type_ancestors(cg,symbol_id,ids,limit) :
            mode==1 ? sem_type_subtypes(cg,symbol_id,ids,limit) :
                      sem_type_implementations(cg,symbol_id,ids,limit);
    sb_json_str(b,key); sb_puts(b,":[");
    for (int i=0;i<n;i++) {
        if (i) sb_putc(b,',');
        item(cg,b,ids[i]);
    }
    sb_putc(b,']');
    if (n==limit) sb_printf(b,",\"%s_limit_reached\":true",key);
}

int cmd_sem_hierarchy(Cg *cg, const char *name, int limit, bool json) {
    if (!name || !*name) return 1;
    Cg view;
    cg=scope(cg,&view,json);
    if (!cg) return 1;
    if (limit<1) limit=16;
    if (limit>INSPECT_MAX) limit=INSPECT_MAX;
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=?1 AND (s.name=?2 OR ss.qualified_name=?2) "
        "ORDER BY (ss.qualified_name=?2) DESC,f.path,s.line,s.id LIMIT 9");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_text(q,2,name,-1,SQLITE_TRANSIENT);
    StrBuf b; sb_init(&b);
    sb_puts(&b,"{\"branch\":"); sb_json_str(&b,cg->branch);
    sb_puts(&b,",\"query\":"); sb_json_str(&b,name);
    sb_printf(&b,",\"per_relation_limit\":%d,\"matches\":[",limit);
    int n=0;
    while (sqlite3_step(q)==SQLITE_ROW) {
        if (n==8) break;
        if (n++) sb_putc(&b,',');
        long id=sqlite3_column_int64(q,0);
        sb_puts(&b,"{\"symbol\":"); item(cg,&b,id);
        sb_putc(&b,','); hierarchy_set(cg,&b,"ancestors",id,limit,0);
        sb_putc(&b,','); hierarchy_set(cg,&b,"subtypes",id,limit,1);
        sb_putc(&b,','); hierarchy_set(cg,&b,"implementations",id,limit,2);
        sb_putc(&b,'}');
    }
    sqlite3_finalize(q);
    sb_printf(&b,"],\"ambiguous\":%s,\"match_limit_reached\":%s,"
                 "\"evidence\":\"typed relations in the current branch\"}",
              n>1?"true":"false",n==8?"true":"false");
    if (json) puts(b.p);
    else {
        printf("hierarchy for %s (%s): %d matching symbol%s\n%s\n",
               name,cg->branch,n,n==1?"":"s",b.p);
    }
    sb_free(&b);
    return 0;
}

static bool table_exists(Cg *cg, const char *table) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?1");
    sqlite3_bind_text(q,1,table,-1,SQLITE_TRANSIENT);
    bool yes=sqlite3_step(q)==SQLITE_ROW;
    sqlite3_finalize(q);
    return yes;
}

static bool generated_path(const char *path) {
    return strstr(path,"/generated/") || strstr(path,"/gen/") ||
           strstr(path,"/dist/") || strstr(path,"/build/") ||
           strstr(path,".generated.") || strstr(path,".g.");
}

static bool test_root(const char *path) {
    return strstr(path,"/test/") || strstr(path,"/tests/") ||
           strstr(path,".test.") || strstr(path,".spec.") ||
           strstr(path,"_test.");
}

static bool entry_root(const char *path, const char *name) {
    return !strcmp(name,"main") || strstr(path,"/main.") ||
           strstr(path,"/index.") || strstr(path,"/entry.");
}

/* The set is a bounded proof of reachability through recorded edges only.
 * Exhausting the budget makes absence from it unknown, never unreachable. */
static int reachability(Cg *cg, int budget) {
    cg_exec(cg,"CREATE TEMP TABLE IF NOT EXISTS inspect_reached(id INTEGER PRIMARY KEY)");
    cg_exec(cg,"DELETE FROM temp.inspect_reached");
    sqlite3_stmt *q=cg_prep(cg,
        "WITH RECURSIVE reached(id) AS ("
        "SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=?1 AND (coalesce(ss.exported,0)=1 "
        "OR ss.visibility='public' OR s.name='main' "
        "OR f.path GLOB '*/test/*' OR f.path GLOB '*/tests/*' "
        "OR f.path GLOB '*.test.*' OR f.path GLOB '*.spec.*' "
        "OR f.path GLOB '*_test.*' OR f.path GLOB '*/main.*' "
        "OR f.path GLOB '*/index.*' OR f.path GLOB '*/entry.*' "
        "OR EXISTS(SELECT 1 FROM routes r WHERE r.file_id=f.id "
        "AND (r.handler=s.name OR r.handler LIKE '%'||s.name||'%')) "
        "OR EXISTS(SELECT 1 FROM semantic_edges e WHERE e.branch_id=?1 "
        "AND e.target_id=s.id AND e.kind='route_handler')) "
        "UNION SELECT e.target_id FROM semantic_edges e "
        "JOIN reached r ON r.id=e.source_id WHERE e.branch_id=?1 "
        "AND e.target_id IS NOT NULL AND e.kind!='contains') "
        "INSERT OR IGNORE INTO temp.inspect_reached(id) "
        "SELECT id FROM reached LIMIT ?2");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_int(q,2,budget+1);
    int rc=sqlite3_step(q);
    sqlite3_finalize(q);
    if (rc!=SQLITE_DONE) return -1;
    q=cg_prep(cg,"SELECT count(*) FROM temp.inspect_reached");
    int n=sqlite3_step(q)==SQLITE_ROW?sqlite3_column_int(q,0):-1;
    sqlite3_finalize(q);
    return n;
}

static bool yes(Cg *cg, sqlite3_stmt *q, long id) {
    sqlite3_reset(q); sqlite3_clear_bindings(q);
    sqlite3_bind_int64(q,1,id);
    sqlite3_bind_int64(q,2,cg->branch_id);
    return sqlite3_step(q)==SQLITE_ROW;
}

static void reason(StrBuf *b, bool *first, const char *code) {
    if (!*first) sb_putc(b,',');
    sb_json_str(b,code); *first=false;
}

int cmd_sem_unreferenced(Cg *cg, const char *path, int limit, bool json) {
    Cg view;
    cg=scope(cg,&view,json);
    if (!cg) return 1;
    if (limit<1) limit=20;
    if (limit>INSPECT_MAX) limit=INSPECT_MAX;
    int reach_budget=INSPECT_REACH_MAX;
    const char *budget_env=getenv("CG_INSPECT_REACH_LIMIT");
    if (budget_env && *budget_env) {
        char *end=NULL;
        long n=strtol(budget_env,&end,10);
        if (end && !*end && n>=1 && n<=INSPECT_REACH_MAX)
            reach_budget=(int)n;
    }
    int reached=reachability(cg,reach_budget);
    if (reached<0) return 1;
    bool reach_truncated=reached>reach_budget;
    bool health=table_exists(cg,"extraction_health");
    bool coverage_incomplete=!health;
    if (health) {
        sqlite3_stmt *coverage_check=cg_prep(cg,
            "SELECT 1 FROM files f LEFT JOIN extraction_health h "
            "ON h.branch_id=f.branch_id AND h.path=f.path "
            "WHERE f.branch_id=?1 AND (h.status IS NULL OR h.status!='complete') "
            "LIMIT 1");
        sqlite3_bind_int64(coverage_check,1,cg->branch_id);
        coverage_incomplete=sqlite3_step(coverage_check)==SQLITE_ROW;
        sqlite3_finalize(coverage_check);
    }
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT s.id,s.name,s.kind,f.path,s.line,coalesce(ss.exported,0),"
        "coalesce(ss.visibility,''),coalesce(ss.modifiers,'') "
        "FROM symbols s JOIN files f ON f.id=s.file_id "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=?1 AND s.decl=0 AND (?2='' OR f.path GLOB ?2) "
        "AND NOT EXISTS(SELECT 1 FROM refs r WHERE r.target_id=s.id) "
        "AND NOT EXISTS(SELECT 1 FROM semantic_references r WHERE r.target_id=s.id) "
        "ORDER BY f.path,s.line,s.id LIMIT 513");
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_text(q,2,path&&*path?path:"",-1,SQLITE_TRANSIENT);
    sqlite3_stmt *exports=cg_prep(cg,
        "SELECT 1 FROM semantic_bindings b JOIN files f ON f.id=b.file_id "
        "WHERE b.target_symbol_id=?1 AND f.branch_id=?2 AND b.is_export=1 LIMIT 1");
    sqlite3_stmt *routes=cg_prep(cg,
        "SELECT 1 FROM routes r JOIN files f ON f.id=r.file_id "
        "JOIN symbols s ON s.id=?1 WHERE f.branch_id=?2 "
        "AND (r.handler=s.name OR r.handler LIKE '%'||s.name||'%') "
        "UNION SELECT 1 FROM semantic_edges e WHERE e.target_id=?1 "
        "AND e.branch_id=?2 AND e.kind IN "
        "('route_handler','route_navigation','route_mount') LIMIT 1");
    sqlite3_stmt *uncertain=cg_prep(cg,
        "SELECT 1 FROM refs r JOIN files f ON f.id=r.file_id "
        "JOIN symbols s ON s.id=?1 WHERE f.branch_id=?2 "
        "AND r.target_id IS NULL AND r.name=s.name LIMIT 1");
    sqlite3_stmt *reflection=cg_prep(cg,
        "SELECT 1 FROM semantic_references r JOIN files f ON f.id=r.file_id "
        "JOIN symbols s ON s.id=?1 WHERE f.branch_id=?2 "
        "AND r.original_text=s.name AND r.kind IN ('reflection','reflective') LIMIT 1");
    sqlite3_stmt *incoming=cg_prep(cg,
        "SELECT 1 FROM semantic_edges e WHERE e.target_id=?1 "
        "AND e.branch_id=?2 AND e.source_id!=e.target_id "
        "AND e.kind NOT IN ('contains','exports','route_handler') LIMIT 1");
    sqlite3_stmt *reached_q=cg_prep(cg,
        "SELECT 1 FROM temp.inspect_reached WHERE id=?1");
    sqlite3_stmt *coverage=health?cg_prep(cg,
        "SELECT status,generated FROM extraction_health WHERE branch_id=?1 AND path=?2"):NULL;
    StrBuf b; sb_init(&b);
    sb_puts(&b,"{\"branch\":"); sb_json_str(&b,cg->branch);
    sb_puts(&b,",\"path\":"); sb_json_str(&b,path?path:"");
    sb_puts(&b,",\"candidates\":[");
    int emitted=0,scanned=0,excluded=0,disconnected=0;
    while (sqlite3_step(q)==SQLITE_ROW && scanned<INSPECT_SCAN_MAX && emitted<limit) {
        scanned++;
        long id=sqlite3_column_int64(q,0);
        bool has_incoming=yes(cg,incoming,id);
        sqlite3_reset(reached_q); sqlite3_clear_bindings(reached_q);
        sqlite3_bind_int64(reached_q,1,id);
        bool from_root=sqlite3_step(reached_q)==SQLITE_ROW;
        if (has_incoming && from_root) continue;
        char *name=xstrdup(col(q,1)),*kind=xstrdup(col(q,2)),
             *file=xstrdup(col(q,3));
        int line=sqlite3_column_int(q,4);
        bool exported=sqlite3_column_int(q,5)!=0 || yes(cg,exports,id);
        const char *visibility=col(q,6),*modifiers=col(q,7);
        bool public_api=!strcmp(visibility,"public") ||
                        strstr(modifiers,"public")!=NULL;
        bool framework=yes(cg,routes,id);
        bool dynamic=yes(cg,uncertain,id);
        bool reflective=yes(cg,reflection,id);
        bool generated=generated_path(file);
        bool test=test_root(file),entry=entry_root(file,name);
        const char *status="unknown";
        if (coverage) {
            sqlite3_reset(coverage); sqlite3_clear_bindings(coverage);
            sqlite3_bind_int64(coverage,1,cg->branch_id);
            sqlite3_bind_text(coverage,2,file,-1,SQLITE_TRANSIENT);
            if (sqlite3_step(coverage)==SQLITE_ROW) {
                status=col(coverage,0);
                generated|=sqlite3_column_int(coverage,1)!=0;
            }
        }
        bool disconnected_candidate=has_incoming && !from_root &&
                                    !reach_truncated && !coverage_incomplete &&
                                    !dynamic &&
                                    !reflective && !exported && !public_api &&
                                    !framework && !generated && !test && !entry &&
                                    !strcmp(status,"complete");
        if (disconnected_candidate) disconnected++;
        if (emitted++) sb_putc(&b,',');
        sb_puts(&b,"{\"name\":"); sb_json_str(&b,name);
        sb_puts(&b,",\"kind\":"); sb_json_str(&b,kind);
        sb_puts(&b,",\"path\":"); sb_json_str(&b,file);
        sb_printf(&b,",\"line\":%d,\"classification\":\"%s\","
                  "\"reachability\":\"%s\",\"unreachable_proven\":false,"
                  "\"exclusion_reasons\":[",line,
                  disconnected_candidate?"unreachable_from_known_roots":"unreferenced",
                  disconnected_candidate?"not_reached_from_known_roots":"unknown");
        bool first=true;
        if (exported) reason(&b,&first,"exported");
        if (public_api) reason(&b,&first,"public_api");
        if (framework) reason(&b,&first,"framework_root");
        if (reflective) reason(&b,&first,"reflection");
        if (generated) reason(&b,&first,"generated");
        if (test) reason(&b,&first,"test_root");
        if (entry) reason(&b,&first,"entry_point");
        if (dynamic) reason(&b,&first,"uncertain_incoming");
        if (strcmp(status,"complete")!=0) reason(&b,&first,"coverage_unverified");
        if (has_incoming && reach_truncated)
            reason(&b,&first,"reachability_budget");
        if (has_incoming && coverage_incomplete)
            reason(&b,&first,"reachability_coverage");
        if (!first) excluded++;
        sb_puts(&b,"],\"coverage\":"); sb_json_str(&b,status);
        sb_putc(&b,'}');
        free(name);free(kind);free(file);
    }
    sqlite3_finalize(q);
    sqlite3_finalize(exports);sqlite3_finalize(routes);
    sqlite3_finalize(uncertain);sqlite3_finalize(reflection);
    sqlite3_finalize(incoming);sqlite3_finalize(reached_q);
    if (coverage) sqlite3_finalize(coverage);
    sb_printf(&b,"],\"shown\":%d,\"excluded\":%d,"
                 "\"unreachable_from_known_roots\":%d,"
                 "\"reachable_nodes_checked\":%d,\"reachability_budget\":%d,"
                 "\"reachability_truncated\":%s,"
                 "\"coverage_incomplete\":%s,"
                 "\"result_limit_reached\":%s,\"scan_limit_reached\":%s,"
                 "\"unreachable_proven\":0,\"advice\":\"Candidates are only "
                 "unreferenced or outside known roots in the indexed graph; "
                 "none is proven safe to delete.\"}",
              emitted,excluded,disconnected,reached,reach_budget,
              reach_truncated?"true":"false",
              coverage_incomplete?"true":"false",
              emitted==limit?"true":"false",
              scanned==INSPECT_SCAN_MAX?"true":"false");
    if (json) puts(b.p);
    else printf("unreferenced inspection (%s): %d shown, %d excluded\n%s\n",
                cg->branch,emitted,excluded,b.p);
    sb_free(&b);
    return 0;
}
