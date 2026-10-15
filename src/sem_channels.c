#include "sem_channels.h"
#include "semantic.h"
#include "sem_routes.h"
#include <inttypes.h>

/* A named channel is useful only when the parser proved both its literal
 * name and its local receiver.  The same name on unrelated receivers does
 * not establish a delivery relationship. */
#define CHANNEL_MAX_FACTS 100000
#define CHANNEL_MAX_FANOUT 32

typedef struct {
    long file, owner;
    long start_byte, end_byte;
    int line, column, end_line, end_column;
    char *family, *direction, *name, *value, *evidence, *path;
} ChannelFact;

typedef struct { ChannelFact *v; int n, cap; } ChannelFacts;

static void facts_free(ChannelFacts *f) {
    for (int i=0;i<f->n;i++) {
        free(f->v[i].family); free(f->v[i].direction);
        free(f->v[i].name); free(f->v[i].value);
        free(f->v[i].evidence); free(f->v[i].path);
    }
    free(f->v);
}

static char *coldup(sqlite3_stmt *q, int col) {
    const char *p=(const char *)sqlite3_column_text(q,col);
    return xstrdup(p ? p : "");
}

static uint64_t hash_bytes(uint64_t h, const void *data, size_t n) {
    const unsigned char *p=data;
    for (size_t i=0;i<n;i++) { h^=p[i]; h*=UINT64_C(1099511628211); }
    return h;
}

static uint64_t hash_str(uint64_t h, const char *s) {
    size_t n=strlen(s);
    h=hash_bytes(h,&n,sizeof n);
    return hash_bytes(h,s,n);
}

static uint64_t hash_long(uint64_t h, long x) {
    return hash_bytes(h,&x,sizeof x);
}

static bool local_path(const char *p) {
    if (!p || p[0]!='/') return false;
    if (p[1]=='/' || strchr(p,'?') || strchr(p,'#') || strchr(p,'\\')) return false;
    for (const unsigned char *s=(const unsigned char *)p;*s;s++)
        if (*s<32 || *s==127) return false;
    return true;
}

static bool http_method(const char *s) {
    static const char *methods[]={"GET","POST","PUT","PATCH","DELETE","HEAD","OPTIONS",NULL};
    for (int i=0;methods[i];i++) if (strcmp(s,methods[i])==0) return true;
    return false;
}

static bool valid_identity(const char *s) {
    if (!s || !*s || strlen(s)>255) return false;
    if (strstr(s,"://") || strstr(s,"external:") == s ||
        strstr(s,"unresolved:") == s || strchr(s,'?')) return false;
    /* A bare receiver identifier can be local to one file.  Cross-file
     * inference needs a canonical import/module identity with a separator. */
    return strchr(s,'/') || strchr(s,'.') || strchr(s,':');
}

/* Import aliases are mapped to the declaration they actually bind to.
 * Unknown, namespace-only and multiply resolved bindings remain boundaries. */
static char *receiver_identity(Cg *cg, long file, const char *value) {
    if (strncmp(value,"import:",7)) return xstrdup(value);
    const char *local=value+7;
    if (!*local) return xstrdup("");
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT f.path,s.name FROM semantic_bindings b "
        "JOIN files f ON f.id=b.target_file_id "
        "JOIN symbols s ON s.id=b.target_symbol_id "
        "WHERE b.file_id=?1 AND b.local_name=?2 AND b.is_system=0 "
        "AND f.branch_id=?3 LIMIT 2");
    sqlite3_bind_int64(q,1,file);
    sqlite3_bind_text(q,2,local,-1,SQLITE_TRANSIENT);
    sqlite3_bind_int64(q,3,cg->branch_id);
    int count=0; char *out=NULL;
    while (sqlite3_step(q)==SQLITE_ROW) {
        count++;
        if (count==1) {
            const char *path=(const char *)sqlite3_column_text(q,0);
            const char *name=(const char *)sqlite3_column_text(q,1);
            if (path && name) {
                size_t n=strlen(path)+strlen(name)+2;
                out=xmalloc(n); snprintf(out,n,"%s:%s",path,name);
            }
        }
    }
    sqlite3_finalize(q);
    if (count!=1 || !out) { free(out); return xstrdup(""); }
    return out;
}

static bool supported(const ChannelFact *f) {
    if (!f->owner || !f->name[0] || strlen(f->name)>255) return false;
    if (!strcmp(f->family,"http"))
        return !strcmp(f->direction,"producer") &&
               local_path(f->name) && http_method(f->value);
    if (strcmp(f->family,"queue") && strcmp(f->family,"bus") &&
        strcmp(f->family,"socket")) return false;
    if (strcmp(f->direction,"producer") && strcmp(f->direction,"consumer"))
        return false;
    return valid_identity(f->value);
}

static int load_facts(Cg *cg, ChannelFacts *out, uint64_t *digest) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT t.file_id,t.owner_id,t.kind,t.name,t.value,t.evidence,"
        "t.start_line,t.start_column,t.end_line,t.end_column,"
        "t.start_byte,t.end_byte,f.path "
        "FROM semantic_type_facts t JOIN files f ON f.id=t.file_id "
        "WHERE f.branch_id=?1 AND t.kind LIKE 'channel:%' "
        "ORDER BY t.file_id,t.id");
    sqlite3_bind_int64(q,1,cg->branch_id);
    int rc;
    while ((rc=sqlite3_step(q))==SQLITE_ROW) {
        if (out->n==CHANNEL_MAX_FACTS) { sqlite3_finalize(q); return -1; }
        if (out->n==out->cap) {
            out->cap=out->cap ? out->cap*2 : 64;
            out->v=xrealloc(out->v,(size_t)out->cap*sizeof *out->v);
        }
        ChannelFact *f=&out->v[out->n++]; memset(f,0,sizeof *f);
        f->file=sqlite3_column_int64(q,0);
        f->owner=sqlite3_column_int64(q,1);
        char *kind=coldup(q,2);
        char *family=kind+8, *sep=strchr(family,':');
        if (strncmp(kind,"channel:",8)!=0 || !sep) {
            free(kind); f->family=xstrdup(""); f->direction=xstrdup("");
        } else {
            *sep++=0; f->family=xstrdup(family); f->direction=xstrdup(sep);
            free(kind);
        }
        f->name=coldup(q,3);
        char *raw_value=coldup(q,4);
        f->value=receiver_identity(cg,f->file,raw_value);
        free(raw_value);
        f->evidence=coldup(q,5); f->line=sqlite3_column_int(q,6);
        f->column=sqlite3_column_int(q,7);
        f->end_line=sqlite3_column_int(q,8);
        f->end_column=sqlite3_column_int(q,9);
        f->start_byte=sqlite3_column_int64(q,10);
        f->end_byte=sqlite3_column_int64(q,11);
        f->path=coldup(q,12);
        *digest=hash_long(*digest,f->file);
        *digest=hash_long(*digest,f->owner);
        *digest=hash_str(*digest,f->family);
        *digest=hash_str(*digest,f->direction);
        *digest=hash_str(*digest,f->name);
        *digest=hash_str(*digest,f->value);
        *digest=hash_str(*digest,f->evidence);
        *digest=hash_long(*digest,f->line);
        *digest=hash_long(*digest,f->column);
        *digest=hash_long(*digest,f->start_byte);
        *digest=hash_long(*digest,f->end_byte);
    }
    sqlite3_finalize(q);
    return rc==SQLITE_DONE ? 0 : -1;
}

static int hash_routes(Cg *cg, uint64_t *digest) {
    sqlite3_stmt *q=cg_prep(cg,
        "SELECT route_id,route_symbol_id,registration_file_id,method,"
        "pattern,COALESCE(handler_symbol_id,0),status,evidence,registration_line "
        "FROM semantic_route_facts WHERE branch_id=?1 ORDER BY route_id");
    sqlite3_bind_int64(q,1,cg->branch_id);
    int rc;
    while ((rc=sqlite3_step(q))==SQLITE_ROW) {
        for (int i=0;i<3;i++) *digest=hash_long(*digest,sqlite3_column_int64(q,i));
        for (int i=3;i<=4;i++) {
            const char *s=(const char *)sqlite3_column_text(q,i);
            *digest=hash_str(*digest,s?s:"");
        }
        *digest=hash_long(*digest,sqlite3_column_int64(q,5));
        for (int i=6;i<=7;i++) {
            const char *s=(const char *)sqlite3_column_text(q,i);
            *digest=hash_str(*digest,s?s:"");
        }
        *digest=hash_long(*digest,sqlite3_column_int64(q,8));
    }
    sqlite3_finalize(q);
    return rc==SQLITE_DONE ? 0 : -1;
}

static bool change_keys_available(Cg *cg) {
    sqlite3_stmt *q=cg_prep(cg,"SELECT 1 FROM sqlite_master WHERE "
        "type='table' AND name='semantic_change_keys'");
    bool found=sqlite3_step(q)==SQLITE_ROW;
    sqlite3_finalize(q);
    return found;
}

static bool relevant_edit(Cg *cg, const long *changed_files, int nfiles) {
    if (!changed_files) return true;
    if (!nfiles) return false;
    /* An incremental orchestrator records old keys before purging changed
     * facts. This covers a deleted ambiguous registration, which had no
     * edge to inspect after its source row is gone. */
    if (change_keys_available(cg)) {
        sqlite3_stmt *old=cg_prep(cg,"SELECT 1 FROM semantic_change_keys "
            "WHERE branch_id=?1 AND kind IN ('channel','route') LIMIT 1");
        sqlite3_bind_int64(old,1,cg->branch_id);
        bool found=sqlite3_step(old)==SQLITE_ROW;
        sqlite3_finalize(old);
        if (found) return true;
    }
    sqlite3_stmt *q=cg_prep(cg,"SELECT 1 WHERE EXISTS(SELECT 1 FROM "
        "semantic_type_facts WHERE file_id=?1 AND kind LIKE 'channel:%') "
        "OR EXISTS(SELECT 1 FROM semantic_route_facts WHERE "
        "branch_id=?2 AND registration_file_id=?1) "
        "OR EXISTS(SELECT 1 FROM semantic_edges WHERE branch_id=?2 "
        "AND strategy IN ('literal_http_unique_route','literal_named_channel') "
        "AND (source_file_id=?1 OR target_file_id=?1))");
    bool found=false;
    for (int i=0;i<nfiles;i++) {
        sqlite3_bind_int64(q,1,changed_files[i]);
        sqlite3_bind_int64(q,2,cg->branch_id);
        if (sqlite3_step(q)==SQLITE_ROW) found=true;
        sqlite3_reset(q); sqlite3_clear_bindings(q);
        if (found) break;
    }
    sqlite3_finalize(q);
    return found;
}

static bool pair_compatible(const ChannelFact *a, const ChannelFact *b) {
    if (strcmp(a->family,b->family) || strcmp(a->name,b->name) ||
        strcmp(a->value,b->value)) return false;
    if (!strcmp(a->family,"bus") || !strcmp(a->family,"socket")) return true;
    /* Queues are load-balanced when several consumers share a name.  A
     * producer-to-every-consumer edge would assert a false fanout. */
    return !strcmp(a->family,"queue");
}

static int fact_key_cmp(const ChannelFact *a, const ChannelFact *b) {
    int c=strcmp(a->family,b->family);
    if (!c) c=strcmp(a->name,b->name);
    if (!c) c=strcmp(a->value,b->value);
    return c;
}

static int fact_cmp(const void *ap, const void *bp) {
    const ChannelFact *a=ap,*b=bp;
    int c=fact_key_cmp(a,b);
    if (!c) c=strcmp(a->direction,b->direction);
    if (!c) c=(a->file>b->file)-(a->file<b->file);
    if (!c) c=(a->owner>b->owner)-(a->owner<b->owner);
    if (!c) c=(a->line>b->line)-(a->line<b->line);
    if (!c) c=(a->column>b->column)-(a->column<b->column);
    return c;
}

static bool same_site(const ChannelFact *a, const ChannelFact *b) {
    return !fact_cmp(a,b);
}

static int insert_edge(Cg *cg, sqlite3_stmt *q, const ChannelFact *source,
                       long target_file, long target_id, const char *channel,
                       const char *strategy, const char *registration_path,
                       int registration_line, int registration_column,
                       const char *evidence) {
    sqlite3_bind_int64(q,1,cg->branch_id);
    sqlite3_bind_int64(q,2,source->file);
    sqlite3_bind_int64(q,3,target_file);
    sqlite3_bind_int64(q,4,source->owner);
    sqlite3_bind_int64(q,5,target_id);
    sqlite3_bind_text(q,6,channel,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,7,source->evidence,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,8,strategy,-1,SQLITE_STATIC);
    sqlite3_bind_text(q,9,evidence,-1,SQLITE_TRANSIENT);
    sqlite3_bind_text(q,10,registration_path,-1,SQLITE_TRANSIENT);
    sqlite3_bind_int(q,11,source->line);
    sqlite3_bind_int(q,12,source->column);
    sqlite3_bind_int(q,13,source->end_line);
    sqlite3_bind_int(q,14,source->end_column);
    sqlite3_bind_int(q,15,registration_line);
    sqlite3_bind_int(q,16,registration_column);
    sqlite3_bind_int64(q,17,source->start_byte);
    sqlite3_bind_int64(q,18,source->end_byte);
    int rc=sqlite3_step(q);
    sqlite3_reset(q); sqlite3_clear_bindings(q);
    return rc==SQLITE_DONE ? 0 : -1;
}

static int synthesize(Cg *cg, ChannelFacts *facts) {
    qsort(facts->v,(size_t)facts->n,sizeof *facts->v,fact_cmp);
    sqlite3_stmt *q=cg_prep(cg,
        "INSERT INTO semantic_edges(branch_id,source_file_id,target_file_id,"
        "source_id,target_id,kind,original_text,strategy,provenance,evidence,"
        "channel,registration_path,start_line,start_column,end_line,end_column,"
        "registration_line,registration_column,start_byte,end_byte,synthesized) "
        "VALUES(?1,?2,?3,?4,?5,'channel_delivery',?7,?8,'heuristic',?9,"
        "?6,?10,?11,?12,?13,?14,?15,?16,?17,?18,1)");
    int result=0;
    for (int lo=0;lo<facts->n && result==0;) {
        int hi=lo+1;
        while (hi<facts->n && fact_key_cmp(&facts->v[lo],&facts->v[hi])==0)
            hi++;
        int targets[CHANNEL_MAX_FANOUT], count=0;
        if (strcmp(facts->v[lo].family,"http")) {
            for (int j=lo;j<hi;j++) {
                const ChannelFact *b=&facts->v[j];
                if (!supported(b) || strcmp(b->direction,"consumer")) continue;
                if (j>lo && same_site(b,&facts->v[j-1])) continue;
                if (count<CHANNEL_MAX_FANOUT) targets[count]=j;
                count++;
                if (count>CHANNEL_MAX_FANOUT) break;
            }
        }
        for (int i=lo;i<hi && result==0;i++) {
            const ChannelFact *a=&facts->v[i];
            if (!supported(a) || strcmp(a->direction,"producer")) continue;
            if (i>lo && same_site(a,&facts->v[i-1])) continue;
            if (!strcmp(a->family,"http")) {
                SemRouteMatch route={0};
                if (sem_route_lookup_unique(cg,a->value,a->name,&route)!=1 ||
                    !route.route_symbol_id || !route.file_id) continue;
                StrBuf ev; sb_init(&ev);
                sb_printf(&ev,"tier=http; method=%s; local route=%s; source=%s",
                          a->value,a->name,a->evidence);
                result=insert_edge(cg,q,a,route.file_id,route.route_symbol_id,
                                   a->name,"literal_http_unique_route",
                                   route.registration_path,route.line,route.column,
                                   ev.p);
                sb_free(&ev);
                continue;
            }
            if (!count || count>CHANNEL_MAX_FANOUT ||
                (!strcmp(a->family,"queue") && count!=1)) continue;
            for (int j=0;j<count && result==0;j++) {
                const ChannelFact *b=&facts->v[targets[j]];
                if (!pair_compatible(a,b)) continue;
                StrBuf ev; sb_init(&ev);
                sb_printf(&ev,"tier=%s; receiver=%s; source=%s; registration=%s",
                          a->family,a->value,a->evidence,b->evidence);
                result=insert_edge(cg,q,a,b->file,b->owner,a->name,
                                   "literal_named_channel",b->path,b->line,
                                   b->column,ev.p);
                sb_free(&ev);
            }
        }
        lo=hi;
    }
    sqlite3_finalize(q);
    return result;
}

int sem_channels_pass(Cg *cg, const long *changed_files, int nfiles) {
    if (changed_files && nfiles==0) return 0;
    if (!relevant_edit(cg,changed_files,nfiles)) return 0;
    ChannelFacts facts={0};
    uint64_t digest=UINT64_C(14695981039346656037);
    int rc=load_facts(cg,&facts,&digest);
    if (!rc) rc=hash_routes(cg,&digest);
    if (rc) { facts_free(&facts); return -1; }
    char key[128], hex[32];
    cg_bkey(cg,"sem_channels_digest",key,sizeof key);
    snprintf(hex,sizeof hex,"%016" PRIx64,digest);
    char *prior=cg_meta_get(cg,key);
    bool unchanged=prior && !strcmp(prior,hex);
    free(prior);
    if (unchanged && changed_files) { facts_free(&facts); return 0; }
    /* The caller's indexing transaction includes this savepoint.  A failed
     * synthesis leaves the former edge set and retryable digest intact. */
    cg_exec(cg,"SAVEPOINT sem_channels");
    sqlite3_stmt *del=cg_prep(cg,"DELETE FROM semantic_edges WHERE branch_id=?1 "
        "AND strategy IN ('literal_http_unique_route','literal_named_channel') "
        "AND synthesized=1");
    sqlite3_bind_int64(del,1,cg->branch_id);
    rc=sqlite3_step(del)==SQLITE_DONE ? 0 : -1;
    sqlite3_finalize(del);
    if (!rc) rc=synthesize(cg,&facts);
    if (rc) cg_exec(cg,"ROLLBACK TO sem_channels");
    else cg_meta_set(cg,key,hex);
    cg_exec(cg,"RELEASE sem_channels");
    facts_free(&facts);
    return rc;
}

void sem_channels_register(void) {
    sem_pass_register("channels",60,sem_channels_pass);
}
