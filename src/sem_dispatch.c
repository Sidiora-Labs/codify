#include "cg.h"
#include "semantic.h"
#include "sem_dispatch.h"

/* These are syntax facts, not names mined from source text. A parser must
 * establish a literal key and a registration site before this pass links it. */
#define DISPATCH_CAP 32

static int done(sqlite3_stmt *q) { int rc=sqlite3_step(q); sqlite3_finalize(q); return rc==SQLITE_DONE?0:-1; }

static int callback_api(const char *name) {
    if (!name) return 0;
    const char *last=strrchr(name,'.'); last=last?last+1:name;
    static const char *apis[]={"on","once","subscribe","addEventListener",
                               "addObserver","registerCallback","registerHandler"};
    for (size_t i=0;i<sizeof apis/sizeof *apis;i++)
        if (strcmp(last,apis[i])==0) return 1;
    return 0;
}

static long unique_symbol(Cg *cg, long branch, long preferred_file,
                          const char *name) {
    if (!name || !*name || strchr(name,'(') || strchr(name,'[')) return 0;
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=?1 AND s.kind IN "
        "('function','method','action','class','component') "
        "AND (ss.qualified_name=?2 OR s.name=?2) "
        "ORDER BY (s.file_id=?3) DESC LIMIT 2");
    sqlite3_bind_int64(q,1,branch); sqlite3_bind_text(q,2,name,-1,SQLITE_TRANSIENT);
    sqlite3_bind_int64(q,3,preferred_file);
    long first=0, second=0;
    if (sqlite3_step(q)==SQLITE_ROW) first=sqlite3_column_int64(q,0);
    if (sqlite3_step(q)==SQLITE_ROW) second=sqlite3_column_int64(q,0);
    sqlite3_finalize(q);
    if (!second) return first;
    sqlite3_stmt *p=cg_prep(cg,"SELECT file_id FROM symbols WHERE id=?1");
    sqlite3_bind_int64(p,1,first); long file=0;
    if (sqlite3_step(p)==SQLITE_ROW) file=sqlite3_column_int64(p,0);
    sqlite3_finalize(p);
    /* A local declaration wins only when it is itself unique in that file. */
    if (file!=preferred_file) return 0;
    p=cg_prep(cg,"SELECT count(*) FROM symbols s LEFT JOIN semantic_symbols ss "
                 "ON ss.symbol_id=s.id WHERE s.file_id=?1 AND "
                 "s.kind IN ('function','method','action','class','component') "
                 "AND (ss.qualified_name=?2 OR s.name=?2)");
    sqlite3_bind_int64(p,1,file); sqlite3_bind_text(p,2,name,-1,SQLITE_TRANSIENT);
    int count=0; if (sqlite3_step(p)==SQLITE_ROW) count=sqlite3_column_int(p,0);
    sqlite3_finalize(p); return count==1?first:0;
}

static long symbol_file(Cg *cg,long id) {
    sqlite3_stmt *q=cg_prep(cg,"SELECT file_id FROM symbols WHERE id=?1");
    sqlite3_bind_int64(q,1,id); long f=0;
    if (sqlite3_step(q)==SQLITE_ROW) f=sqlite3_column_int64(q,0);
    sqlite3_finalize(q); return f;
}

static int edge(Cg *cg,long branch,long source,long target,long source_file,
                const char *kind,const char *channel,const char *text,
                const char *registration_path,int site_line,int site_col,
                int registration_line,int registration_col) {
    if (!source || !target || source==target || !source_file) return 0;
    long target_file=symbol_file(cg,target); if (!target_file) return 0;
    sqlite3_stmt *q=cg_prep(cg,
        "INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
        "source_id,target_id,kind,original_text,strategy,provenance,evidence,"
        "channel,registration_path,start_line,start_column,registration_line,"
        "registration_column,synthesized) VALUES(?1,?2,?3,?4,?5,?6,?7,"
        "'dispatch:explicit','heuristic','literal registration and syntax fact',"
        "?8,?9,?10,?11,?12,?13,1)");
    sqlite3_bind_int64(q,1,branch); sqlite3_bind_int64(q,2,source_file);
    sqlite3_bind_int64(q,3,target_file); sqlite3_bind_int64(q,4,source);
    sqlite3_bind_int64(q,5,target); sqlite3_bind_text(q,6,kind,-1,SQLITE_STATIC);
    sqlite3_bind_text(q,7,text?text:"",-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,8,channel?channel:"",-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,9,registration_path?registration_path:"",-1,SQLITE_TRANSIENT);
    sqlite3_bind_int(q,10,site_line); sqlite3_bind_int(q,11,site_col);
    sqlite3_bind_int(q,12,registration_line); sqlite3_bind_int(q,13,registration_col);
    return done(q);
}

static int relevant(Cg *cg,const long *files,int n) {
    if (!files) return 1;
    if (!n) return 0;
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT 1 FROM semantic_type_facts WHERE file_id=?1 AND ("
        "kind IN ('callback_registration','event_subscription','event_emit',"
        "'observer_subscription','observer_notify',"
        "'pointer_slot','pointer_call','jsx_component','state_setter',"
        "'state_setter_call','native_bridge_registration','native_bridge_call') "
        "OR kind LIKE 'dispatch.%') LIMIT 1");
    sqlite3_stmt *e=cg_prep(cg,
        "SELECT 1 FROM semantic_edges WHERE branch_id=?1 AND "
        "(strategy LIKE 'dispatch:%' OR kind='implements') "
        "AND (source_file_id=?2 OR target_file_id=?2 "
        "OR registration_path=(SELECT path FROM files WHERE id=?2)) LIMIT 1");
    sqlite3_stmt *missing=cg_prep(cg,"SELECT 1 FROM files WHERE id=?1");
    sqlite3_stmt *refs=cg_prep(cg,
        "SELECT 1 FROM semantic_references v JOIN semantic_symbols m "
        "ON m.symbol_id=v.target_id JOIN semantic_edges i "
        "ON i.target_id=m.parent_id AND i.kind='implements' "
        "WHERE v.file_id=?1 AND i.branch_id=?2 LIMIT 1");
    for (int i=0;i<n;i++) {
        sqlite3_reset(q); sqlite3_clear_bindings(q);
        sqlite3_bind_int64(q,1,files[i]); if(sqlite3_step(q)==SQLITE_ROW) {
            sqlite3_finalize(q); sqlite3_finalize(e);
            sqlite3_finalize(missing);sqlite3_finalize(refs);return 1;
        }
        sqlite3_reset(e); sqlite3_clear_bindings(e);
        sqlite3_bind_int64(e,1,cg->branch_id); sqlite3_bind_int64(e,2,files[i]);
        if(sqlite3_step(e)==SQLITE_ROW) { sqlite3_finalize(q); sqlite3_finalize(e);
            sqlite3_finalize(missing);sqlite3_finalize(refs);return 1; }
        sqlite3_reset(refs);sqlite3_clear_bindings(refs);
        sqlite3_bind_int64(refs,1,files[i]);sqlite3_bind_int64(refs,2,cg->branch_id);
        if(sqlite3_step(refs)==SQLITE_ROW) {sqlite3_finalize(q);sqlite3_finalize(e);
            sqlite3_finalize(missing);sqlite3_finalize(refs);return 1;}
        sqlite3_reset(missing);sqlite3_clear_bindings(missing);
        sqlite3_bind_int64(missing,1,files[i]);
        if(sqlite3_step(missing)!=SQLITE_ROW) {sqlite3_finalize(q);sqlite3_finalize(e);
            sqlite3_finalize(missing);sqlite3_finalize(refs);return 1;}
    }
    sqlite3_finalize(q);sqlite3_finalize(e);
    sqlite3_finalize(missing);sqlite3_finalize(refs);return 0;
}

/* Pair a literal invocation with exactly one registration. Multiple
 * registrations or targets are an explicit ambiguity, never a guessed edge. */
static int paired(Cg *cg,long branch,const char *invoke_kind,
                  const char *register_kind,const char *edge_kind,
                  int same_file,int require_identity) {
    sqlite3_stmt *inv=cg_prep(cg,
        "SELECT t.name,t.owner_id,t.file_id,t.start_line,t.start_column,t.evidence "
        "FROM semantic_type_facts t JOIN files f ON f.id=t.file_id "
        "WHERE f.branch_id=?1 AND t.kind=?2 AND t.name IS NOT NULL "
        "AND t.name<>'' AND t.owner_id IS NOT NULL");
    sqlite3_bind_int64(inv,1,branch); sqlite3_bind_text(inv,2,invoke_kind,-1,SQLITE_STATIC);
    sqlite3_stmt *reg=cg_prep(cg,
        "SELECT t.value,t.file_id,t.start_line,t.start_column,f.path,t.evidence "
        "FROM semantic_type_facts t JOIN files f ON f.id=t.file_id "
        "WHERE f.branch_id=?1 AND t.kind=?2 AND t.name=?3 AND t.value IS NOT NULL "
        "AND t.value<>'' AND (?4=0 OR t.file_id=?4) "
        "AND (?5=0 OR t.evidence=?6) LIMIT 2");
    while(sqlite3_step(inv)==SQLITE_ROW) {
        const char *key=(const char*)sqlite3_column_text(inv,0);
        const char *identity=(const char*)sqlite3_column_text(inv,5);
        if (require_identity && (!identity || !strchr(identity,':'))) continue;
        long source=sqlite3_column_int64(inv,1),source_file=sqlite3_column_int64(inv,2);
        int line=sqlite3_column_int(inv,3),col=sqlite3_column_int(inv,4);
        sqlite3_reset(reg); sqlite3_clear_bindings(reg);
        sqlite3_bind_int64(reg,1,branch);
        sqlite3_bind_text(reg,2,register_kind,-1,SQLITE_STATIC);
        sqlite3_bind_text(reg,3,key,-1,SQLITE_TRANSIENT);
        sqlite3_bind_int64(reg,4,same_file?source_file:0);
        sqlite3_bind_int(reg,5,require_identity);
        if (identity) sqlite3_bind_text(reg,6,identity,-1,SQLITE_TRANSIENT);
        if (sqlite3_step(reg)!=SQLITE_ROW) continue;
        const char *value=(const char*)sqlite3_column_text(reg,0);
        long reg_file=sqlite3_column_int64(reg,1);
        int rline=sqlite3_column_int(reg,2),rcol=sqlite3_column_int(reg,3);
        const char *path=(const char*)sqlite3_column_text(reg,4);
        const char *registered_identity=(const char*)sqlite3_column_text(reg,5);
        if (require_identity && (!registered_identity ||
            strcmp(identity,registered_identity)!=0)) continue;
        long target=unique_symbol(cg,branch,reg_file,value);
        char *path_copy=xstrdup(path?path:"");
        if (sqlite3_step(reg)==SQLITE_ROW || !target) { free(path_copy); continue; }
        int erc=edge(cg,branch,source,target,source_file,edge_kind,key,key,
                     path_copy,line,col,rline,rcol);
        free(path_copy);
        if (erc) { sqlite3_finalize(inv); sqlite3_finalize(reg); return -1; }
    }
    sqlite3_finalize(inv); sqlite3_finalize(reg); return 0;
}

static int direct(Cg *cg,long branch,const char *fact_kind,const char *edge_kind,
                  int target_from_name) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT t.name,t.value,t.owner_id,t.file_id,t.start_line,"
        "t.start_column,f.path FROM semantic_type_facts t JOIN files f "
        "ON f.id=t.file_id WHERE f.branch_id=?1 AND t.kind=?2 "
        "AND t.owner_id IS NOT NULL");
    sqlite3_bind_int64(q,1,branch);sqlite3_bind_text(q,2,fact_kind,-1,SQLITE_STATIC);
    while(sqlite3_step(q)==SQLITE_ROW) {
        const char *name=(const char*)sqlite3_column_text(q,0);
        if (!strcmp(fact_kind,"callback_registration") && !callback_api(name)) continue;
        const char *value=(const char*)sqlite3_column_text(q,1);
        long source=sqlite3_column_int64(q,2), file=sqlite3_column_int64(q,3);
        int line=sqlite3_column_int(q,4), col=sqlite3_column_int(q,5);
        const char *path=(const char*)sqlite3_column_text(q,6);
        long target=unique_symbol(cg,branch,file,target_from_name?name:value);
        if (target && edge(cg,branch,source,target,file,edge_kind,name,name,path,
                           line,col,line,col)) {sqlite3_finalize(q);return -1;}
    }
    sqlite3_finalize(q);return 0;
}

static int interfaces(Cg *cg,long branch) {
    sqlite3_stmt *r=cg_prep(cg,
        "SELECT v.owner_id,v.file_id,v.original_text,v.start_line,v.start_column,"
        "m.name,p.symbol_id FROM semantic_references v "
        "JOIN files f ON f.id=v.file_id JOIN symbols m ON m.id=v.target_id "
        "JOIN semantic_symbols sm ON sm.symbol_id=m.id "
        "JOIN semantic_symbols p ON p.symbol_id=sm.parent_id "
        "WHERE f.branch_id=?1 AND v.owner_id IS NOT NULL");
    sqlite3_bind_int64(r,1,branch);
    sqlite3_stmt *c=cg_prep(cg,
        "SELECT m.id,f.path,e.start_line,e.start_column FROM semantic_edges e "
        "JOIN semantic_symbols child ON child.symbol_id=e.source_id "
        "JOIN semantic_symbols method ON method.parent_id=child.symbol_id "
        "JOIN symbols m ON m.id=method.symbol_id "
        "JOIN files f ON f.id=m.file_id "
        "WHERE e.branch_id=?1 AND e.kind='implements' AND e.target_id=?2 "
        "AND m.name=?3 AND (SELECT count(*) FROM semantic_symbols other "
        "JOIN symbols os ON os.id=other.symbol_id WHERE "
        "other.parent_id=child.symbol_id AND os.name=?3)=1 "
        "ORDER BY m.id LIMIT 33");
    while(sqlite3_step(r)==SQLITE_ROW) {
        long source=sqlite3_column_int64(r,0),file=sqlite3_column_int64(r,1);
        const char *text=(const char*)sqlite3_column_text(r,2);
        int line=sqlite3_column_int(r,3),col=sqlite3_column_int(r,4);
        const char *method=(const char*)sqlite3_column_text(r,5);
        long parent=sqlite3_column_int64(r,6);
        sqlite3_reset(c);sqlite3_clear_bindings(c);
        sqlite3_bind_int64(c,1,branch);sqlite3_bind_int64(c,2,parent);
        sqlite3_bind_text(c,3,method,-1,SQLITE_TRANSIENT);
        long targets[DISPATCH_CAP]; int rl[DISPATCH_CAP],rc[DISPATCH_CAP],n=0;
        char *paths[DISPATCH_CAP]={0};
        while(sqlite3_step(c)==SQLITE_ROW && n<=DISPATCH_CAP) {
            if(n==DISPATCH_CAP) {n++;break;}
            targets[n]=sqlite3_column_int64(c,0);
            paths[n]=xstrdup((const char*)sqlite3_column_text(c,1));
            rl[n]=sqlite3_column_int(c,2);rc[n]=sqlite3_column_int(c,3);n++;
        }
        if(n<=DISPATCH_CAP) for(int i=0;i<n;i++)
            if(edge(cg,branch,source,targets[i],file,"interface_dispatch",method,
                    text,paths[i],line,col,rl[i],rc[i])) {
                for(int j=0;j<n;j++)free(paths[j]);
                sqlite3_finalize(r);sqlite3_finalize(c);return -1;
            }
        for(int i=0;i<n && i<DISPATCH_CAP;i++)free(paths[i]);
    }
    sqlite3_finalize(r);sqlite3_finalize(c);return 0;
}

int sem_dispatch_run(Cg *cg,const long *changed_files,int nfiles) {
    if (!cg || !cg->branch_id || !relevant(cg,changed_files,nfiles)) return 0;
    /* Savepoint permits this pass to be called inside the scan writer's
     * transaction; rollback leaves both old and base edges intact. */
    cg_exec(cg,"SAVEPOINT sem_dispatch");
    sqlite3_stmt *d=cg_prep(cg,"DELETE FROM semantic_edges WHERE branch_id=?1 "
                              "AND synthesized=1 AND provenance='heuristic' "
                              "AND strategy LIKE 'dispatch:%'");
    sqlite3_bind_int64(d,1,cg->branch_id);
    int rc=done(d);
    if (!rc) rc=direct(cg,cg->branch_id,"callback_registration","callback",0);
    if (!rc) rc=direct(cg,cg->branch_id,"jsx_component","renders_component",1);
    if (!rc) rc=paired(cg,cg->branch_id,"event_emit","event_subscription","event_dispatch",0,1);
    if (!rc) rc=paired(cg,cg->branch_id,"observer_notify","observer_subscription","observer_dispatch",0,1);
    if (!rc) rc=paired(cg,cg->branch_id,"pointer_call","pointer_slot","pointer_dispatch",1,0);
    if (!rc) rc=paired(cg,cg->branch_id,"native_bridge_call","native_bridge_registration","native_dispatch",0,0);
    /* A state setter call triggers the component that owns the hook. */
    if (!rc) rc=paired(cg,cg->branch_id,"state_setter_call","state_setter","state_render",1,0);
    if (!rc) rc=interfaces(cg,cg->branch_id);
    cg_exec(cg,rc?"ROLLBACK TO sem_dispatch; RELEASE sem_dispatch":"RELEASE sem_dispatch");
    return rc;
}

void sem_dispatch_register(void) { (void)sem_pass_register("dispatch",50,sem_dispatch_run); }
