#include "sem_flow.h"
#include <time.h>

/* Every allocation below is capped by the request limits. Traversal uses
 * branch-scoped endpoint indexes and never follows an unknown endpoint. */
typedef struct {
    long id, file_id;
    char *name, *kind, *path, *qualified;
    int line, depth, parent;
    long via;
} FlowNode;
typedef struct {
    long id, source, target;
    char *kind, *provenance, *strategy, *evidence, *original;
    char *channel, *registration, *path;
    int line, column, registration_line;
    bool heuristic;
} FlowEdge;
typedef struct {
    long owner;
    char *text, *kind, *strategy, *evidence, *path;
    int line;
} FlowBoundary;

static long monotonic_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC,&ts);
    return (long)ts.tv_sec*1000L+ts.tv_nsec/1000000L;
}

static char *bounded_text_n(sqlite3_stmt *q, int col, size_t cap) {
    const char *s = (const char *)sqlite3_column_text(q, col);
    if (!s) return xstrdup("");
    size_t len = strlen(s), n = len < cap ? len : cap;
    char *p = xmalloc(n + 1);
    memcpy(p, s, n);
    if (len > cap && n >= 3) memcpy(p+n-3,"...",3);
    p[n] = 0;
    return p;
}
static char *bounded_text(sqlite3_stmt *q, int col) {
    return bounded_text_n(q,col,256);
}
static char *path_text(sqlite3_stmt *q, int col) {
    return bounded_text_n(q,col,4096);
}
static void field(StrBuf *b, const char *key, const char *val) {
    sb_printf(b, ",\"%s\":", key);
    sb_json_str(b, val ? val : "");
}
static int node_index(const FlowNode *v, int n, long id) {
    for (int i = 0; i < n; i++) if (v[i].id == id) return i;
    return -1;
}
static bool node_load(Cg *cg, long branch, long id, FlowNode *n) {
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT s.name,s.kind,f.path,s.line,ss.qualified_name,s.file_id "
        "FROM symbols s JOIN files f ON f.id=s.file_id "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE s.id=?1 AND f.branch_id=?2");
    sqlite3_bind_int64(q, 1, id);
    sqlite3_bind_int64(q, 2, branch);
    bool ok = sqlite3_step(q) == SQLITE_ROW;
    if (ok) {
        n->id = id;
        n->name = bounded_text(q, 0);
        n->kind = bounded_text(q, 1);
        n->path = path_text(q, 2);
        n->line = sqlite3_column_int(q, 3);
        n->qualified = bounded_text(q, 4);
        n->file_id = sqlite3_column_int64(q, 5);
    }
    sqlite3_finalize(q);
    return ok;
}
static void node_free(FlowNode *n) {
    free(n->name); free(n->kind); free(n->path); free(n->qualified);
}
static void edge_free(FlowEdge *e) {
    free(e->kind); free(e->provenance); free(e->strategy);
    free(e->evidence); free(e->original); free(e->channel);
    free(e->registration); free(e->path);
}
static void boundary_free(FlowBoundary *b) {
    free(b->text); free(b->kind); free(b->strategy);
    free(b->evidence); free(b->path);
}
static void write_node(StrBuf *b, const FlowNode *n) {
    sb_printf(b, "{\"id\":%ld,\"depth\":%d,\"line\":%d",
              n->id,n->depth,n->line);
    field(b,"name",n->name); field(b,"qualified_name",n->qualified);
    field(b,"kind",n->kind); field(b,"path",n->path);
    sb_puts(b,"}");
}
static void write_edge(StrBuf *b, const FlowEdge *e) {
    sb_printf(b,"{\"id\":%ld,\"source\":%ld,\"target\":%ld,"
              "\"line\":%d,\"column\":%d,\"registration_line\":%d,"
              "\"heuristic\":%s",e->id,e->source,e->target,e->line,
              e->column,e->registration_line,e->heuristic?"true":"false");
    field(b,"kind",e->kind); field(b,"provenance",e->provenance);
    field(b,"strategy",e->strategy); field(b,"evidence",e->evidence);
    field(b,"original_text",e->original); field(b,"channel",e->channel);
    field(b,"registration_path",e->registration); field(b,"path",e->path);
    sb_puts(b,"}");
}
static void write_boundary(StrBuf *b, const FlowBoundary *v) {
    sb_printf(b,"{\"owner\":%ld,\"line\":%d",v->owner,v->line);
    field(b,"text",v->text); field(b,"kind",v->kind);
    field(b,"strategy",v->strategy); field(b,"evidence",v->evidence);
    field(b,"path",v->path); sb_puts(b,"}");
}

int sem_flow_query(Cg *cg, const char *mode, const char *name,
                   const char *target, SemFlowLimits lim, bool json) {
    bool reverse = mode && (!strcmp(mode,"callers") || !strcmp(mode,"impact"));
    bool paths = mode && !strcmp(mode,"paths");
    bool calls = mode && (!strcmp(mode,"callers") || !strcmp(mode,"callees"));
    if (!mode || (!reverse && !paths && !calls) || !name || !*name ||
        (paths && (!target || !*target)) || cg->scope_branch == -1) {
        puts("{\"error\":\"invalid flow query or branch scope\"}");
        return 1;
    }
    if (lim.depth < 1) lim.depth = 3;
    if (lim.nodes < 1) lim.nodes = 64;
    if (lim.edges < 1) lim.edges = 128;
    if (lim.time_ms < 1) lim.time_ms = 200;
    if (lim.output_bytes < 1) lim.output_bytes = 16000;
    if (lim.depth > 8) lim.depth = 8;
    if (lim.nodes > 256) lim.nodes = 256;
    if (lim.edges > 512) lim.edges = 512;
    if (lim.time_ms > 2000) lim.time_ms = 2000;
    if (lim.output_bytes > 131072) lim.output_bytes = 131072;
    if (lim.output_bytes < 1024) {
        puts("{\"error\":\"output budget must be at least 1024 bytes\"}");
        return 1;
    }
    long branch = cg->scope_branch > 0 ? cg->scope_branch : cg->branch_id;
    char branch_name[256];
    snprintf(branch_name,sizeof branch_name,"%s",cg->branch);
    if (cg->scope_branch > 0) {
        sqlite3_stmt *bq=cg_prep(cg,"SELECT name FROM branches WHERE id=?1");
        sqlite3_bind_int64(bq,1,branch);
        if (sqlite3_step(bq)==SQLITE_ROW) {
            const char *label=(const char *)sqlite3_column_text(bq,0);
            snprintf(branch_name,sizeof branch_name,"%s",label?label:"");
        }
        sqlite3_finalize(bq);
    }
    long start = monotonic_ms();
    FlowNode *nv = calloc((size_t)lim.nodes,sizeof *nv);
    FlowEdge *ev = calloc((size_t)lim.edges,sizeof *ev);
    FlowBoundary *bv = calloc((size_t)lim.edges,sizeof *bv);
    if (!nv || !ev || !bv) { free(nv); free(ev); free(bv); return 1; }
    int nn=0,ne=0,nb=0,head=0,found=-1;
    bool trunc_nodes=false,trunc_edges=false,trunc_depth=false;
    bool trunc_time=false,trunc_output=false,ambiguous=false;
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT s.id FROM symbols s JOIN files f ON f.id=s.file_id "
        "LEFT JOIN semantic_symbols ss ON ss.symbol_id=s.id "
        "WHERE f.branch_id=?1 AND (s.name=?2 OR ss.qualified_name=?2) "
        "ORDER BY s.id LIMIT 17");
    sqlite3_bind_int64(q,1,branch); sqlite3_bind_text(q,2,name,-1,SQLITE_STATIC);
    while (sqlite3_step(q)==SQLITE_ROW) {
        if (nn>=16 || nn>=lim.nodes) {
            ambiguous=true;
            if (nn>=lim.nodes) trunc_nodes=true;
            break;
        }
        long id=sqlite3_column_int64(q,0);
        if (node_load(cg,branch,id,&nv[nn])) { nv[nn].parent=-1; nn++; }
    }
    sqlite3_finalize(q);
    if (nn>1) ambiguous=true;
    if (!nn) {
        printf("{\"error\":\"symbol not found\",\"query\":");
        StrBuf b; sb_init(&b); sb_json_str(&b,name); printf("%s}\n",b.p); sb_free(&b);
        free(nv);free(ev);free(bv);return 1;
    }
    const char *edge_sql_forward =
        "SELECT e.id,e.source_id,e.target_id,e.kind,e.provenance,e.strategy,"
        "e.evidence,e.original_text,e.channel,e.registration_path,e.start_line,"
        "e.start_column,e.registration_line,e.synthesized,f.path FROM semantic_edges e "
        "JOIN files f ON f.id=e.source_file_id "
        "WHERE e.branch_id=?1 AND e.source_id=?2 "
        "AND (?3=0 OR e.kind IN ('calls','call','callback','dispatch',"
        "'event','http','queue','route_handler')) "
        "ORDER BY e.kind,e.id LIMIT ?4";
    const char *edge_sql_reverse =
        "SELECT e.id,e.source_id,e.target_id,e.kind,e.provenance,e.strategy,"
        "e.evidence,e.original_text,e.channel,e.registration_path,e.start_line,"
        "e.start_column,e.registration_line,e.synthesized,f.path FROM semantic_edges e "
        "JOIN files f ON f.id=e.source_file_id "
        "WHERE e.branch_id=?1 AND e.target_id=?2 "
        "AND (?3=0 OR e.kind IN ('calls','call','callback','dispatch',"
        "'event','http','queue','route_handler')) "
        "ORDER BY e.kind,e.id LIMIT ?4";
    sqlite3_stmt *edgeq=cg_prep(cg,reverse?edge_sql_reverse:edge_sql_forward);
    sqlite3_stmt *boundaryq=cg_prep(cg,
        "SELECT r.original_text,r.kind,r.strategy,r.evidence,f.path,r.start_line "
        "FROM semantic_references r JOIN files f ON f.id=r.file_id "
        "WHERE f.branch_id=?1 AND r.file_id=?2 AND r.owner_id=?3 "
        "AND r.target_id IS NULL ORDER BY r.ref_id LIMIT ?4");
    while (head<nn) {
        if (monotonic_ms()-start>=lim.time_ms) { trunc_time=true; break; }
        FlowNode *cur=&nv[head];
        if (paths && (strcmp(cur->name,target)==0 ||
                      strcmp(cur->qualified,target)==0)) { found=head; break; }
        if (cur->depth>=lim.depth) {
            sqlite3_reset(edgeq); sqlite3_clear_bindings(edgeq);
            sqlite3_bind_int64(edgeq,1,branch);
            sqlite3_bind_int64(edgeq,2,cur->id);
            sqlite3_bind_int(edgeq,3,calls);
            sqlite3_bind_int(edgeq,4,1);
            if (sqlite3_step(edgeq)==SQLITE_ROW) trunc_depth=true;
            if (!reverse) {
                sqlite3_reset(boundaryq); sqlite3_clear_bindings(boundaryq);
                sqlite3_bind_int64(boundaryq,1,branch);
                sqlite3_bind_int64(boundaryq,2,cur->file_id);
                sqlite3_bind_int64(boundaryq,3,cur->id);
                sqlite3_bind_int(boundaryq,4,1);
                if (sqlite3_step(boundaryq)==SQLITE_ROW) trunc_depth=true;
            }
            head++;
            continue;
        }
        if (!reverse && nb<lim.edges) {
            sqlite3_reset(boundaryq); sqlite3_clear_bindings(boundaryq);
            sqlite3_bind_int64(boundaryq,1,branch);
            sqlite3_bind_int64(boundaryq,2,cur->file_id);
            sqlite3_bind_int64(boundaryq,3,cur->id);
            sqlite3_bind_int(boundaryq,4,lim.edges-nb+1);
            while (sqlite3_step(boundaryq)==SQLITE_ROW) {
                if (nb>=lim.edges) { trunc_edges=true; break; }
                FlowBoundary *v=&bv[nb++]; v->owner=cur->id;
                v->text=bounded_text(boundaryq,0); v->kind=bounded_text(boundaryq,1);
                v->strategy=bounded_text(boundaryq,2);
                v->evidence=bounded_text(boundaryq,3);
                v->path=path_text(boundaryq,4);
                v->line=sqlite3_column_int(boundaryq,5);
            }
        }
        sqlite3_reset(edgeq); sqlite3_clear_bindings(edgeq);
        sqlite3_bind_int64(edgeq,1,branch);
        sqlite3_bind_int64(edgeq,2,cur->id);
        sqlite3_bind_int(edgeq,3,calls);
        sqlite3_bind_int(edgeq,4,lim.edges-ne+1);
        while (sqlite3_step(edgeq)==SQLITE_ROW) {
            if (monotonic_ms()-start>=lim.time_ms) { trunc_time=true; break; }
            if (ne>=lim.edges) { trunc_edges=true; break; }
            long src=sqlite3_column_int64(edgeq,1);
            long dst=sqlite3_column_int64(edgeq,2);
            long next=reverse?src:dst;
            if (!next) { /* The unknown endpoint is a visible boundary. */
                if (nb<lim.edges) {
                    FlowBoundary *v=&bv[nb++]; v->owner=cur->id;
                    v->text=bounded_text(edgeq,7); v->kind=bounded_text(edgeq,3);
                    v->strategy=bounded_text(edgeq,5);
                    v->evidence=bounded_text(edgeq,6);
                    v->path=path_text(edgeq,14);
                    v->line=sqlite3_column_int(edgeq,10);
                } else trunc_edges=true;
                continue;
            }
            int ni=node_index(nv,nn,next);
            if (ni<0 && nn>=lim.nodes) { trunc_nodes=true; continue; }
            FlowEdge *e=&ev[ne++];
            e->id=sqlite3_column_int64(edgeq,0); e->source=src; e->target=dst;
            e->kind=bounded_text(edgeq,3); e->provenance=bounded_text(edgeq,4);
            e->strategy=bounded_text(edgeq,5); e->evidence=bounded_text(edgeq,6);
            e->original=bounded_text(edgeq,7); e->channel=bounded_text(edgeq,8);
            e->registration=path_text(edgeq,9); e->line=sqlite3_column_int(edgeq,10);
            e->column=sqlite3_column_int(edgeq,11);
            e->registration_line=sqlite3_column_int(edgeq,12);
            e->heuristic=sqlite3_column_int(edgeq,13)!=0 ||
                         strcmp(e->provenance,"heuristic")==0;
            e->path=path_text(edgeq,14);
            if (ni<0) {
                if (node_load(cg,branch,next,&nv[nn])) {
                    nv[nn].depth=cur->depth+1; nv[nn].parent=head;
                    nv[nn].via=e->id; nn++;
                } else {
                    if (nb<lim.edges) {
                        FlowBoundary *v=&bv[nb++]; v->owner=cur->id;
                        v->text=xstrdup(e->original); v->kind=xstrdup(e->kind);
                        v->strategy=xstrdup("missing_target");
                        v->evidence=xstrdup(e->evidence);
                        v->path=xstrdup(e->path); v->line=e->line;
                    } else trunc_edges=true;
                    edge_free(e);
                    ne--;
                }
            }
        }
        if (trunc_time) break;
        head++;
    }
    sqlite3_finalize(edgeq); sqlite3_finalize(boundaryq);

    StrBuf b; sb_init(&b);
    sb_puts(&b,"{\"branch\":"); sb_json_str(&b,branch_name);
    field(&b,"mode",mode); field(&b,"query",name);
    if (target) field(&b,"target",target);
    sb_printf(&b,",\"limits\":{\"depth\":%d,\"nodes\":%d,\"edges\":%d,"
              "\"time_ms\":%d,\"output_bytes\":%d}",lim.depth,lim.nodes,
              lim.edges,lim.time_ms,lim.output_bytes);
    sb_printf(&b,",\"ambiguous_roots\":%s,\"nodes\":[",ambiguous?"true":"false");
    for (int i=0;i<nn;i++) {
        StrBuf item; sb_init(&item); write_node(&item,&nv[i]);
        if (b.len+item.len+512>(size_t)lim.output_bytes) { trunc_output=true; sb_free(&item); break; }
        if (i) sb_puts(&b,",");
        sb_puts(&b,item.p);
        sb_free(&item);
    }
    sb_puts(&b,"],\"edges\":[");
    int emitted_edges=0;
    for (int i=0;i<ne;i++) {
        StrBuf item; sb_init(&item); write_edge(&item,&ev[i]);
        if (b.len+item.len+512>(size_t)lim.output_bytes) { trunc_output=true; sb_free(&item); break; }
        if (emitted_edges++) sb_puts(&b,",");
        sb_puts(&b,item.p);
        sb_free(&item);
    }
    sb_puts(&b,"],\"boundaries\":[");
    int emitted_boundaries=0;
    for (int i=0;i<nb;i++) {
        StrBuf item; sb_init(&item); write_boundary(&item,&bv[i]);
        if (b.len+item.len+512>(size_t)lim.output_bytes) { trunc_output=true; sb_free(&item); break; }
        if (emitted_boundaries++) sb_puts(&b,",");
        sb_puts(&b,item.p);
        sb_free(&item);
    }
    sb_puts(&b,"],\"path\":[");
    long chain[9], path_edges[9]; int nchain=0;
    if (found>=0) {
        for (int at=found; at>=0 && nchain<9; at=nv[at].parent) {
            chain[nchain]=nv[at].id;
            path_edges[nchain]=nv[at].via;
            nchain++;
        }
        for (int i=nchain-1;i>=0;i--) sb_printf(&b,"%s%ld",i==nchain-1?"":",",chain[i]);
    }
    sb_puts(&b,"],\"path_edges\":[");
    for (int i=nchain-2;i>=0;i--)
        sb_printf(&b,"%s%ld",i==nchain-2?"":",",path_edges[i]);
    sb_printf(&b,"],\"found\":%s,\"truncated\":{\"depth\":%s,"
              "\"nodes\":%s,\"edges\":%s,\"time\":%s,\"output\":%s}}",
              found>=0?"true":"false",trunc_depth?"true":"false",
              trunc_nodes?"true":"false",trunc_edges?"true":"false",
              trunc_time?"true":"false",trunc_output?"true":"false");
    if (b.len>(size_t)lim.output_bytes) {
        sb_free(&b); sb_init(&b);
        sb_puts(&b,"{\"error\":\"output budget exceeded\",\"truncated\":true}");
    }
    if (json) puts(b.p);
    else {
        StrBuf plain; sb_init(&plain);
        sb_printf(&plain,"flow %s %s: %d symbol(s), %d relation(s), %d boundary(ies)%s\n",
                  mode,name,nn,ne,nb,found>=0?", path found":"");
        for (int i=0;i<ne && i<16;i++) {
            StrBuf line; sb_init(&line);
            sb_printf(&line,"  %ld -> %ld  %s  %s:%d  %s\n",
                      ev[i].source,ev[i].target,ev[i].kind,ev[i].path,
                      ev[i].line,ev[i].evidence);
            if (plain.len+line.len+80>(size_t)lim.output_bytes) {
                trunc_output=true;
                sb_free(&line);
                break;
            }
            sb_puts(&plain,line.p);
            sb_free(&line);
        }
        if (trunc_nodes||trunc_edges||trunc_depth||trunc_time||trunc_output)
            sb_puts(&plain,"  traversal limited; use --json for exact limits and omissions\n");
        if (plain.len>(size_t)lim.output_bytes) plain.len=(size_t)lim.output_bytes;
        plain.p[plain.len]=0;
        fputs(plain.p,stdout);
        sb_free(&plain);
    }
    sb_free(&b);
    for (int i=0;i<nn;i++) node_free(&nv[i]);
    for (int i=0;i<ne;i++) edge_free(&ev[i]);
    for (int i=0;i<nb;i++) boundary_free(&bv[i]);
    free(nv);free(ev);free(bv);
    return 0;
}
