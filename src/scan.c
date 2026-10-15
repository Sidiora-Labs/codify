/*
 * Indexing pipeline: walk -> parallel parse workers -> single DB writer.
 * Worker count comes from sysinfo (container-aware cores, available RAM).
 * Bounded ring buffer keeps memory flat on huge repos.
 */
#include "cg.h"
#include "index_health.h"
#include <dirent.h>
#include <pthread.h>
#include <stdatomic.h>
#include <ctype.h>
#include <stddef.h>
#include <sys/stat.h>

#define MAX_FILE_BYTES (8L * 1024 * 1024)   /* larger files: skip entirely */
#define MAX_FTS_BYTES  (2L * 1024 * 1024)   /* larger: no body full-text */
#define RING_CAP 256
/* files written per write transaction: small enough that a waiting agent
 * command gets the write lock within a fraction of a second and a stalled
 * pass keeps every chunk it wrote before the stall, large enough that a
 * full index is not dominated by commit overhead */
#define INDEX_CHUNK 96

/* twin_*: the same path already parsed on another branch. When the content
 * hash the worker computes equals twin_hash, the parse is skipped and the
 * twin's rows are copied — the whole point of one graph for many branches. */
typedef struct {
    char *rel; long size, mtime; char dbhash[65];
    bool semantic_stale;
    long twin_id, twin_lines; char twin_hash[65], twin_parser[32];
} Walked;
typedef struct { char *path; long id, size, mtime; char hash[65]; } DbFile;

typedef struct {
    int idx;                 /* -1 = skipped (binary/unreadable/too big) */
    char hash[65];
    char *body;              /* NULL if not keeping body */
    size_t body_len;
    ParseResult pr;
    bool parsed;
    bool failed_read, binary, oversized, generated;
    long reuse_from;         /* file id whose rows this one copies (0 = none) */
    long reuse_lines;
} Done;

/* ---------------- directory walk ---------------- */

typedef struct { Walked *v; int n, cap; } WalkList;

static void walk_push(WalkList *wl, const char *rel, long size, long mtime) {
    if (wl->n == wl->cap) {
        wl->cap = wl->cap ? wl->cap * 2 : 256;
        wl->v = xrealloc(wl->v, sizeof(Walked) * (size_t)wl->cap);
    }
    wl->v[wl->n].rel = xstrdup(rel);
    wl->v[wl->n].size = size;
    wl->v[wl->n].mtime = mtime;
    wl->v[wl->n].dbhash[0] = 0;
    wl->v[wl->n].twin_hash[0] = 0;
    wl->v[wl->n].twin_parser[0] = 0;
    wl->v[wl->n].twin_id = 0;
    wl->v[wl->n].twin_lines = 0;
    wl->v[wl->n].semantic_stale = false;
    wl->n++;
}

/* The tree (or one directory of it) through the parallel walk in walk.c:
 * the same ignore rules and the same files the recursive walk found, read
 * by `threads` threads, appended to wl. */
static void walk_dir(const char *root, const char *rel, const Ignore *ig,
                     int threads, WalkList *wl) {
    WalkSet ws = {0};
    ws.n = 0;
    walk_parallel(root, rel, ig, threads, MAX_FILE_BYTES, &ws);
    for (int i = 0; i < ws.n; i++)
        walk_push(wl, ws.v[i].rel, ws.v[i].size, ws.v[i].mtime);
    walkset_free(&ws);
}

static int walked_cmp(const void *a, const void *b) {
    return strcmp(((const Walked *)a)->rel, ((const Walked *)b)->rel);
}
static int dbfile_cmp(const void *a, const void *b) {
    return strcmp(((const DbFile *)a)->path, ((const DbFile *)b)->path);
}

/* ---------------- worker pool ---------------- */

typedef struct {
    const char *root;
    Walked *jobs;
    int njobs;
    atomic_int next;
    /* ring */
    Done ring[RING_CAP];
    int head, tail, count;
    pthread_mutex_t mu;
    pthread_cond_t can_push, can_pop;
    int producers_left;
} Pipe;

static void ring_push(Pipe *p, Done *d) {
    pthread_mutex_lock(&p->mu);
    while (p->count == RING_CAP)
        pthread_cond_wait(&p->can_push, &p->mu);
    p->ring[p->head] = *d;
    p->head = (p->head + 1) % RING_CAP;
    p->count++;
    pthread_cond_signal(&p->can_pop);
    pthread_mutex_unlock(&p->mu);
}

static void producer_done(Pipe *p) {
    pthread_mutex_lock(&p->mu);
    p->producers_left--;
    pthread_cond_signal(&p->can_pop);
    pthread_mutex_unlock(&p->mu);
}

static bool ring_pop(Pipe *p, Done *out) {
    pthread_mutex_lock(&p->mu);
    while (p->count == 0 && p->producers_left > 0)
        pthread_cond_wait(&p->can_pop, &p->mu);
    if (p->count == 0) {
        pthread_mutex_unlock(&p->mu);
        return false;
    }
    *out = p->ring[p->tail];
    p->tail = (p->tail + 1) % RING_CAP;
    p->count--;
    pthread_cond_signal(&p->can_push);
    pthread_mutex_unlock(&p->mu);
    return true;
}

static void *worker(void *arg) {
    Pipe *p = arg;
    for (;;) {
        int i = atomic_fetch_add(&p->next, 1);
        if (i >= p->njobs) break;
        Done d;
        memset(&d, 0, sizeof d);
        d.idx = i;
        if (p->jobs[i].size > MAX_FILE_BYTES) {
            d.oversized = true;
            ring_push(p, &d);
            continue;
        }

        char abs[4900];
        snprintf(abs, sizeof abs, "%s/%s", p->root, p->jobs[i].rel);
        size_t len = 0;
        char *data = read_entire_file(abs, &len);
        if (!data || looks_binary(data, len)) {
            d.failed_read = !data;
            d.binary = data != NULL;
            free(data);
            ring_push(p, &d);
            continue;
        }
        d.generated = index_health_generated(p->jobs[i].rel, data, len);
        sha256_hex(data, len, d.hash);
        /* identical bytes to a twin on another branch: the parse would
         * rebuild rows the graph already holds, so hand the writer the
         * twin's id instead and skip the expensive part outright */
        if (p->jobs[i].twin_hash[0] &&
            strcmp(p->jobs[i].twin_hash, d.hash) == 0) {
            d.reuse_from  = p->jobs[i].twin_id;
            d.reuse_lines = p->jobs[i].twin_lines;
            if ((long)len <= MAX_FTS_BYTES) {   /* codify-v15 1.1: body_tri */
                d.body = data;
                d.body_len = len;
            } else {
                free(data);
            }
            ring_push(p, &d);
            continue;
        }
        const char *lang = lang_for_path(p->jobs[i].rel);
        if (lang) {
            lang_parse(lang, p->jobs[i].rel, data, len, &d.pr);
            d.parsed = true;
        }
        if ((long)len <= MAX_FTS_BYTES) {
            d.body = data;
            d.body_len = len;
        } else {
            free(data);
        }
        ring_push(p, &d);
    }
    producer_done(p);
    return NULL;
}

/* ---------------- writer ---------------- */

typedef struct {
    sqlite3_stmt *up_file, *sel_file, *del_symfts, *del_syms, *del_refs,
                 *del_routes, *del_body, *ins_sym, *ins_symfts, *ins_ref,
                 *ins_route, *ins_body, *del_imports, *ins_import,
                 *del_cmts, *del_cmtfts, *ins_cmt, *ins_cmtfts,
                 *sel_docs,
                 /* change scope for incremental resolution (temp tables
                  * created by index_scope_begin before these are prepared) */
                 *scope_file, *scope_name, *scope_syms, *scope_routes,
                 *scope_path,
                 /* branch reuse: copy a twin's rows instead of parsing */
                 *cp_syms, *cp_symfts, *cp_refs, *cp_cmts, *cp_cmtfts,
                 *cp_routes, *cp_imports, *cp_body,
                 *has_rows, *purge_add, *purge_sym, *purge_cmt,
                 *purge_body, *purge_clear;
    sqlite3_stmt *put_filefts, *del_filefts;      /* codify-v15 1.2 */
    sqlite3_stmt *del_tri, *ins_tri, *purge_tri;  /* codify-v15 1.1: body_tri */
    bool contentless;      /* body_fts keeps no text (codify-v15 1.3) */
    bool fts_purged;       /* this chunk's FTS rows went in one statement */
} Stmts;

static void stmts_init(Cg *cg, Stmts *s) {
    s->contentless = db_fts_contentless(cg);
    /* rows belong to the branch this tree is on; the same path on another
     * branch is another row, so a worktree never overwrites its siblings */
    s->up_file = cg_prep(cg,
        "INSERT INTO files(path,lang,size,mtime,hash,lines,branch_id,base) "
        "VALUES(?,?,?,?,?,?,?7,?8) "
        "ON CONFLICT(branch_id,path) DO UPDATE SET lang=excluded.lang,"
        "size=excluded.size,mtime=excluded.mtime,hash=excluded.hash,"
        "lines=excluded.lines,base=excluded.base");
    s->sel_file   = cg_prep(cg, "SELECT id FROM files WHERE path=? AND branch_id=?2");
    s->del_symfts = cg_prep(cg, "DELETE FROM symbol_fts WHERE rowid IN "
                                "(SELECT id FROM symbols WHERE file_id=?)");
    s->del_syms   = cg_prep(cg, "DELETE FROM symbols WHERE file_id=?");
    s->del_refs   = cg_prep(cg, "DELETE FROM refs WHERE file_id=?");
    s->del_routes = cg_prep(cg, "DELETE FROM routes WHERE file_id=?");
    s->del_body   = cg_prep(cg, "DELETE FROM body_fts WHERE rowid=?");
    s->ins_sym    = cg_prep(cg, "INSERT INTO symbols(file_id,name,kind,line,end_line,sig,"
                                "decl) VALUES(?,?,?,?,?,?,?)");
    s->ins_symfts = cg_prep(cg, "INSERT INTO symbol_fts(rowid,name,kind,path,sig,"
                                "words) VALUES(?,?,?,?,?,?)");
    s->ins_ref    = cg_prep(cg, "INSERT INTO refs(file_id,name,line,sym_id,qual,kind,argc)"
                                " VALUES(?,?,?,?,?,?,?)");
    s->ins_route  = cg_prep(cg, "INSERT INTO routes(file_id,framework,method,pattern,handler,line)"
                                " VALUES(?,?,?,?,?,?)");
    s->ins_body   = cg_prep(cg, "INSERT INTO body_fts(rowid,path,body) VALUES(?,?,?)");
    s->del_tri    = cg_prep(cg, "DELETE FROM body_tri WHERE rowid=?");
    s->ins_tri    = cg_prep(cg, "INSERT INTO body_tri(rowid,body) VALUES(?,?)");
    s->del_imports= cg_prep(cg, "DELETE FROM imports WHERE file_id=?");
    s->ins_import = cg_prep(cg, "INSERT INTO imports(file_id,name,module,line,system)"
                                " VALUES(?,?,?,?,?)");
    s->del_cmtfts = cg_prep(cg, "DELETE FROM comment_fts WHERE rowid IN"
                                " (SELECT id FROM comments WHERE file_id=?)");
    s->del_cmts   = cg_prep(cg, "DELETE FROM comments WHERE file_id=?");
    s->ins_cmt    = cg_prep(cg, "INSERT INTO comments"
                                "(file_id,line,end_line,kind,sym_id,body,"
                                "anchored_hash) VALUES(?,?,?,?,?,?,?)");
    s->ins_cmtfts = cg_prep(cg, "INSERT INTO comment_fts(rowid,body)"
                                " VALUES(?,?)");
    s->sel_docs   = cg_prep(cg, "SELECT body, anchored_hash FROM comments"
                                " WHERE file_id=? AND kind='doc'"
                                " AND anchored_hash IS NOT NULL");
    s->scope_file = cg_prep(cg, "INSERT INTO temp.scope_files(id,added)"
                                " VALUES(?,?) ON CONFLICT(id) DO UPDATE SET"
                                " added=max(added,excluded.added)");
    s->scope_name = cg_prep(cg, "INSERT OR IGNORE INTO temp.scope_names(name)"
                                " VALUES(?)");
    s->scope_syms = cg_prep(cg, "INSERT OR IGNORE INTO temp.scope_names(name)"
                                " SELECT name FROM symbols WHERE file_id=?");
    s->scope_routes = cg_prep(cg, "INSERT OR IGNORE INTO temp.scope_names(name)"
                                " SELECT pattern FROM routes WHERE file_id=?");
    s->scope_path = cg_prep(cg, "SELECT path FROM files WHERE id=?");

    /* ?1 = the row being written, ?2 = its byte-identical twin, ?3 = path.
     * Symbol ids differ per branch, so refs and comments re-point at the
     * copy by (name,line) — unique within a file, and identical bytes gave
     * both files the same set. Soft refs are left out: anchor_edges rebuilds
     * them for every file in scope after the walk. */
    s->cp_syms = cg_prep(cg,
        "INSERT INTO symbols(file_id,name,kind,line,end_line,sig,decl) "
        "SELECT ?1,name,kind,line,end_line,sig,decl FROM symbols "
        "WHERE file_id=?2 ORDER BY id");
    s->cp_symfts = cg_prep(cg,
        "INSERT INTO symbol_fts(rowid,name,kind,path,sig,words) "
        "SELECT n.id,n.name,n.kind,?3,n.sig,t.words FROM symbols n "
        "JOIN symbols o ON o.file_id=?2 AND o.name=n.name AND o.line=n.line "
        "JOIN symbol_fts t ON t.rowid=o.id WHERE n.file_id=?1");
    s->cp_refs = cg_prep(cg,
        "INSERT INTO refs(file_id,name,line,sym_id,qual,kind,argc) "
        "SELECT ?1,r.name,r.line,"
        "(SELECT n.id FROM symbols n JOIN symbols o ON o.id=r.sym_id "
        " WHERE n.file_id=?1 AND n.name=o.name AND n.line=o.line LIMIT 1),"
        "r.qual,r.kind,r.argc FROM refs r "
        "WHERE r.file_id=?2 AND r.kind<>'soft'");
    s->cp_cmts = cg_prep(cg,
        "INSERT INTO comments(file_id,line,end_line,kind,sym_id,body,"
        "anchored_hash) SELECT ?1,c.line,c.end_line,c.kind,"
        "(SELECT n.id FROM symbols n JOIN symbols o ON o.id=c.sym_id "
        " WHERE n.file_id=?1 AND n.name=o.name AND n.line=o.line LIMIT 1),"
        "c.body,c.anchored_hash FROM comments c WHERE c.file_id=?2");
    /* the same rule write_done applies when it fills comment_fts */
    s->cp_cmtfts = cg_prep(cg,
        "INSERT INTO comment_fts(rowid,body) SELECT id,body FROM comments "
        "WHERE file_id=?1 AND (kind IN ('file','doc') OR end_line>line)");
    s->cp_routes = cg_prep(cg,
        "INSERT INTO routes(file_id,framework,method,pattern,handler,line) "
        "SELECT ?1,framework,method,pattern,handler,line FROM routes "
        "WHERE file_id=?2");
    s->cp_imports = cg_prep(cg,
        "INSERT INTO imports(file_id,name,module,line,system) "
        "SELECT ?1,name,module,line,system FROM imports WHERE file_id=?2");
    /* which FTS rows a file has: a DELETE on an FTS5 table, even one that
     * matches nothing, flushes the table's pending inserts into a new
     * segment, so a pass of new files that purged them first wrote one
     * segment per file (codify-v15 1.3) */
    s->has_rows = cg_prep(cg,
        "SELECT EXISTS(SELECT 1 FROM symbols WHERE file_id=?1),"
        "EXISTS(SELECT 1 FROM comments WHERE file_id=?1),"
        "EXISTS(SELECT 1 FROM body_fts_docsize WHERE id=?1)");
    /* and so a chunk's rewritten files leave the FTS tables in one DELETE
     * per table, before any row of the chunk is inserted */
    cg_exec(cg, "CREATE TEMP TABLE IF NOT EXISTS fts_purge"
                "(id INTEGER PRIMARY KEY)");
    s->purge_add = cg_prep(cg,
        "INSERT OR IGNORE INTO temp.fts_purge(id) "
        "SELECT id FROM files WHERE path=?1 AND branch_id=?2");
    s->purge_sym = cg_prep(cg,
        "DELETE FROM symbol_fts WHERE rowid IN (SELECT s.id FROM symbols s "
        "WHERE s.file_id IN (SELECT id FROM temp.fts_purge))");
    s->purge_cmt = cg_prep(cg,
        "DELETE FROM comment_fts WHERE rowid IN (SELECT c.id FROM comments c "
        "WHERE c.file_id IN (SELECT id FROM temp.fts_purge))");
    s->purge_body = cg_prep(cg,
        "DELETE FROM body_fts WHERE rowid IN (SELECT id FROM temp.fts_purge)");
    s->purge_tri = cg_prep(cg,           /* codify-v15 1.1 */
        "DELETE FROM body_tri WHERE rowid IN (SELECT id FROM temp.fts_purge)");
    s->purge_clear = cg_prep(cg, "DELETE FROM temp.fts_purge");
    s->cp_body = cg_prep(cg,
        "INSERT INTO body_fts(rowid,path,body) SELECT ?1,?3,body "
        "FROM body_fts WHERE rowid=?2");
    /* codify-v15 1.2: a files row keeps its path for life, so its path
     * words are written once, when the row first appears */
    s->put_filefts = cg_prep(cg,
        "INSERT INTO file_fts(rowid,words) SELECT ?1,?2 WHERE NOT EXISTS "
        "(SELECT 1 FROM file_fts WHERE rowid=?1)");
    s->del_filefts = cg_prep(cg, "DELETE FROM file_fts WHERE rowid=?");
}

static void step_reset(sqlite3_stmt *st);

/* Record a file whose rows are about to change: its id, every symbol name
 * and route pattern it defined (a ref or a prose mention of those must be
 * re-resolved), and its basename (prose naming the file). Names it defines
 * after the rewrite are added by scope_name as they are inserted. */
static void scope_record_file(Stmts *s, long file_id, bool added) {
    sqlite3_bind_int64(s->scope_file, 1, file_id);
    sqlite3_bind_int  (s->scope_file, 2, added ? 1 : 0);
    step_reset(s->scope_file);
    sqlite3_bind_int64(s->scope_syms, 1, file_id);   step_reset(s->scope_syms);
    sqlite3_bind_int64(s->scope_routes, 1, file_id); step_reset(s->scope_routes);
    sqlite3_bind_int64(s->scope_path, 1, file_id);
    if (sqlite3_step(s->scope_path) == SQLITE_ROW) {
        const char *p = (const char *)sqlite3_column_text(s->scope_path, 0);
        const char *base = p ? strrchr(p, '/') : NULL;
        base = base ? base + 1 : p;
        if (base && base[0]) {
            sqlite3_bind_text(s->scope_name, 1, base, -1, SQLITE_TRANSIENT);
            step_reset(s->scope_name);
        }
    }
    sqlite3_reset(s->scope_path);
    sqlite3_clear_bindings(s->scope_path);
}

static void scope_name(Stmts *s, const char *name) {
    if (!name || !name[0]) return;
    sqlite3_bind_text(s->scope_name, 1, name, -1, SQLITE_STATIC);
    step_reset(s->scope_name);
}

static void stmts_fin(Stmts *s) {
    sqlite3_stmt **all = (sqlite3_stmt **)s;
    for (size_t i = 0; i < offsetof(Stmts, contentless) / sizeof(sqlite3_stmt *); i++)
        sqlite3_finalize(all[i]);
}

static void step_reset(sqlite3_stmt *st) {
    sqlite3_step(st);
    sqlite3_reset(st);
    sqlite3_clear_bindings(st);
}

static void purge_file_children(Cg *cg, Stmts *s, long file_id) {
    /* Shared semantic facts and incoming targets are invalidated before
     * legacy symbols disappear. Both operations use the current chunk's
     * write transaction. */
    sem_file_purge(cg, file_id);
    bool syms = true, cmts = true, body = true;
    if (s->fts_purged) {
        syms = cmts = body = false;
    } else if (s->has_rows) {
        sqlite3_bind_int64(s->has_rows, 1, file_id);
        if (sqlite3_step(s->has_rows) == SQLITE_ROW) {
            syms = sqlite3_column_int(s->has_rows, 0);
            cmts = sqlite3_column_int(s->has_rows, 1);
            body = sqlite3_column_int(s->has_rows, 2);
        }
        sqlite3_reset(s->has_rows);
        sqlite3_clear_bindings(s->has_rows);
    }
    if (syms) {
        sqlite3_bind_int64(s->del_symfts, 1, file_id); step_reset(s->del_symfts);
    }
    sqlite3_bind_int64(s->del_syms,   1, file_id); step_reset(s->del_syms);
    sqlite3_bind_int64(s->del_refs,   1, file_id); step_reset(s->del_refs);
    sqlite3_bind_int64(s->del_routes, 1, file_id); step_reset(s->del_routes);
    if (body) {
        sqlite3_bind_int64(s->del_body, 1, file_id); step_reset(s->del_body);
    }
    if (!s->fts_purged) {   /* codify-v15 1.1: body_tri, else purged with the chunk */
        sqlite3_bind_int64(s->del_tri, 1, file_id); step_reset(s->del_tri);
    }
    sqlite3_bind_int64(s->del_imports,1, file_id); step_reset(s->del_imports);
    if (cmts) {
        sqlite3_bind_int64(s->del_cmtfts, 1, file_id); step_reset(s->del_cmtfts);
    }
    sqlite3_bind_int64(s->del_cmts,   1, file_id); step_reset(s->del_cmts);
}

/* Copy every child row of `from` onto `file_id` — the branch-reuse path.
 * Truthful because the two files hold the same bytes: the parse, the doc
 * baselines (hash_lines over identical lines) and the body index would all
 * come out the same, so only the ids differ. */
static void index_copy_rows(Cg *cg, Stmts *s, long file_id, long from,
                            const char *rel, const Done *d, IndexStats *st) {
    /* a contentless body index has no text to copy: the worker kept the
     * file's bytes, and they are indexed like a parsed file's */
    sqlite3_stmt *in_order[] = { s->cp_syms, s->cp_symfts, s->cp_refs,
                                 s->cp_cmts, s->cp_cmtfts, s->cp_routes,
                                 s->cp_imports,
                                 s->contentless ? NULL : s->cp_body };
    long *count[] = { &st->symbols, NULL, &st->refs, &st->anchors, NULL,
                      &st->routes, NULL, NULL };
    for (size_t i = 0; i < sizeof in_order / sizeof *in_order; i++) {
        if (!in_order[i]) continue;
        sqlite3_bind_int64(in_order[i], 1, file_id);
        sqlite3_bind_int64(in_order[i], 2, from);
        sqlite3_bind_text (in_order[i], 3, rel, -1, SQLITE_STATIC);
        step_reset(in_order[i]);
        if (count[i]) *count[i] += sqlite3_changes(cg->db);
    }
    sem_file_copy(cg, file_id, from);
    if (s->contentless && d->body) {
        sqlite3_bind_int64(s->ins_body, 1, file_id);
        sqlite3_bind_text (s->ins_body, 2, rel, -1, SQLITE_STATIC);
        sqlite3_bind_text (s->ins_body, 3, d->body, (int)d->body_len,
                           SQLITE_STATIC);
        step_reset(s->ins_body);
    }
    /* names the copy defines must re-enter the change scope, exactly as
     * scope_name does for each freshly parsed definition */
    sqlite3_bind_int64(s->scope_syms, 1, file_id);   step_reset(s->scope_syms);
    sqlite3_bind_int64(s->scope_routes, 1, file_id); step_reset(s->scope_routes);
    st->files_reused++;
}

static void write_done(Cg *cg, Stmts *s, const Walked *w, Done *d,
                       IndexStats *st) {
    IndexHealthResult hr = {
        .status = d->parsed && d->pr.partial ? "partial" :
                  d->parsed || d->reuse_from ? "complete" : "skipped",
        .reason = d->parsed ? d->pr.diagnostic :
                  d->reuse_from ? "" : "unsupported_language",
        .parser = d->parsed ? d->pr.parser :
                  d->reuse_from ? w->twin_parser : "none",
        .diagnostic_line = d->pr.diagnostic_line,
        .diagnostics = d->pr.diagnostics,
        .generated = d->generated,
        .content_hash = d->hash,
    };
    const char *lang = lang_for_path(w->rel);
    sqlite3_bind_text (s->up_file, 1, w->rel, -1, SQLITE_STATIC);
    if (lang) sqlite3_bind_text(s->up_file, 2, lang, -1, SQLITE_STATIC);
    else      sqlite3_bind_null(s->up_file, 2);
    sqlite3_bind_int64(s->up_file, 3, w->size);
    sqlite3_bind_int64(s->up_file, 4, w->mtime);
    sqlite3_bind_text (s->up_file, 5, d->hash, -1, SQLITE_STATIC);
    sqlite3_bind_int64(s->up_file, 6, d->reuse_from ? d->reuse_lines
                                                    : d->pr.nlines);
    sqlite3_bind_int64(s->up_file, 7, cg->branch_id);
    const char *base = strrchr(w->rel, '/');
    sqlite3_bind_text (s->up_file, 8, base ? base + 1 : w->rel, -1,
                       SQLITE_STATIC);
    step_reset(s->up_file);

    sqlite3_bind_text(s->sel_file, 1, w->rel, -1, SQLITE_STATIC);
    sqlite3_bind_int64(s->sel_file, 2, cg->branch_id);
    long file_id = 0;
    if (sqlite3_step(s->sel_file) == SQLITE_ROW)
        file_id = sqlite3_column_int64(s->sel_file, 0);
    sqlite3_reset(s->sel_file);
    sqlite3_clear_bindings(s->sel_file);
    if (!file_id) return;
    {                                             /* codify-v15 1.2 */
        char pw[2048];
        name_words(w->rel, pw, sizeof pw);
        sqlite3_bind_int64(s->put_filefts, 1, file_id);
        sqlite3_bind_text(s->put_filefts, 2, pw, -1, SQLITE_TRANSIENT);
        step_reset(s->put_filefts);
    }

    /* size/mtime changed but content did not (touch, branch switch): the
     * upsert above refreshed the metadata; keep the child rows — and with
     * them, stable symbol rowids. */
    if (w->dbhash[0] && strcmp(w->dbhash, d->hash) == 0 &&
        !w->semantic_stale) return;

    scope_record_file(s, file_id, w->dbhash[0] == 0);

    if (d->reuse_from) {
        purge_file_children(cg, s, file_id);
        index_copy_rows(cg, s, file_id, d->reuse_from, w->rel, d, st);
        /* codify-v15 1.1: body_tri keeps no content to copy from the twin;
         * the worker kept these bytes for it */
        if (d->body) {
            sqlite3_bind_int64(s->ins_tri, 1, file_id);
            sqlite3_bind_text (s->ins_tri, 2, d->body, (int)d->body_len,
                               SQLITE_STATIC);
            step_reset(s->ins_tri);
        }
        st->files_indexed++;
        st->bytes += w->size;
        index_health_record(cg, w->rel, &hr);
        return;
    }

    /* Drift baselines about to be purged with the rows: a doc whose text
     * is unchanged must keep the body hash it was written against, so a
     * body edit shows up as a stale anchor instead of silently
     * re-baselining. Changed or new text re-baselines below. */
    struct { char *body, *hash; } *oldd = NULL;
    int noldd = 0;
    sqlite3_bind_int64(s->sel_docs, 1, file_id);
    while (sqlite3_step(s->sel_docs) == SQLITE_ROW) {
        const char *ob = (const char *)sqlite3_column_text(s->sel_docs, 0);
        const char *oh = (const char *)sqlite3_column_text(s->sel_docs, 1);
        if (!ob || !oh) continue;
        oldd = xrealloc(oldd, sizeof *oldd * (size_t)(noldd + 1));
        oldd[noldd].body = xstrdup(ob);
        oldd[noldd].hash = xstrdup(oh);
        noldd++;
    }
    sqlite3_reset(s->sel_docs);
    sqlite3_clear_bindings(s->sel_docs);

    purge_file_children(cg, s, file_id);

    if (d->parsed) {
        ParseResult *pr = &d->pr;
        long *rowids = pr->ndefs ? xmalloc(sizeof(long) * (size_t)pr->ndefs) : NULL;
        long *refids = pr->nrefs ? xmalloc(sizeof(long) * (size_t)pr->nrefs) : NULL;
        int  *ends   = pr->ndefs ? xmalloc(sizeof(int) * (size_t)pr->ndefs) : NULL;
        for (int i = 0; i < pr->ndefs; i++) {
            int end = pr->defs[i].end_line;
            if (end <= 0)     /* parser could not resolve: gap estimate */
                end = (i + 1 < pr->ndefs && pr->defs[i+1].line > pr->defs[i].line)
                        ? pr->defs[i+1].line - 1
                        : (i + 1 < pr->ndefs ? pr->defs[i].line : pr->nlines);
            if (end < pr->defs[i].line) end = pr->defs[i].line;
            ends[i] = end;
            sqlite3_bind_int64(s->ins_sym, 1, file_id);
            sqlite3_bind_text (s->ins_sym, 2, pr->defs[i].name, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_sym, 3, pr->defs[i].kind, -1, SQLITE_STATIC);
            sqlite3_bind_int  (s->ins_sym, 4, pr->defs[i].line);
            sqlite3_bind_int  (s->ins_sym, 5, end);
            sqlite3_bind_text (s->ins_sym, 6, pr->defs[i].sig, -1, SQLITE_STATIC);
            sqlite3_bind_int  (s->ins_sym, 7, pr->defs[i].decl ? 1 : 0);
            step_reset(s->ins_sym);
            rowids[i] = sqlite3_last_insert_rowid(cg->db);

            sqlite3_bind_int64(s->ins_symfts, 1, rowids[i]);
            sqlite3_bind_text (s->ins_symfts, 2, pr->defs[i].name, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_symfts, 3, pr->defs[i].kind, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_symfts, 4, w->rel, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_symfts, 5, pr->defs[i].sig, -1, SQLITE_STATIC);
            char words[256];
            name_words(pr->defs[i].name, words, sizeof words);
            sqlite3_bind_text (s->ins_symfts, 6, words, -1, SQLITE_TRANSIENT);
            step_reset(s->ins_symfts);
            scope_name(s, pr->defs[i].name);
            st->symbols++;
        }
        /* enclosing symbol for each ref: innermost def whose span contains
         * the ref line, preferring callable kinds; refs contained by no def
         * stay NULL — top-level code is not somebody's call site, and
         * neither is a prototype */
        for (int i = 0; i < pr->nrefs; i++) {
            int best = -1, best_fn = -1;
            for (int dj = 0;
                 dj < pr->ndefs && pr->defs[dj].line <= pr->refs[i].line; dj++) {
                if (ends[dj] < pr->refs[i].line || pr->defs[dj].decl) continue;
                best = dj;              /* defs ascend by line: later = inner */
                const char *k = pr->defs[dj].kind;
                if (strcmp(k, "function") == 0 || strcmp(k, "method") == 0 ||
                    strcmp(k, "ctor") == 0)
                    best_fn = dj;
            }
            int pick = best_fn >= 0 ? best_fn : best;
            long enc = pick >= 0 ? rowids[pick] : 0;
            sqlite3_bind_int64(s->ins_ref, 1, file_id);
            sqlite3_bind_text (s->ins_ref, 2, pr->refs[i].name, -1, SQLITE_STATIC);
            sqlite3_bind_int  (s->ins_ref, 3, pr->refs[i].line);
            if (enc) sqlite3_bind_int64(s->ins_ref, 4, enc);
            else     sqlite3_bind_null (s->ins_ref, 4);
            if (pr->refs[i].qual[0])
                sqlite3_bind_text(s->ins_ref, 5, pr->refs[i].qual, -1,
                                  SQLITE_STATIC);
            else
                sqlite3_bind_null(s->ins_ref, 5);
            sqlite3_bind_text(s->ins_ref, 6, "call", -1, SQLITE_STATIC);
            sqlite3_bind_int(s->ins_ref, 7, pr->refs[i].argc);
            step_reset(s->ins_ref);
            refids[i] = sqlite3_last_insert_rowid(cg->db);
            st->refs++;
        }
        /* Comment classification, against the very extents that attributed
         * the refs above: doc when the span sits directly on a definition,
         * file when nothing is defined above it, inline when it falls inside
         * a symbol's scope, orphan otherwise. Position is the whole schema —
         * no annotation syntax to learn and none to get wrong. */
        for (int i = 0; i < pr->ncmts; i++) {
            CmtDef *c = &pr->cmts[i];
            const char *kind = "orphan";
            long sym = 0;
            char ah[65];
            ah[0] = 0;
            int doc = -1;
            if (c->pure)
                for (int dj = 0; dj < pr->ndefs; dj++)
                    if (c->below ? pr->defs[dj].line == c->line - 1
                                 : pr->defs[dj].line == c->end_line + 1)
                        { doc = dj; break; }
            if (doc >= 0) {
                kind = "doc";
                sym = rowids[doc];
                const char *keep = NULL;    /* unchanged text keeps baseline */
                for (int oi = 0; oi < noldd; oi++)
                    if (strcmp(oldd[oi].body, c->body) == 0)
                        { keep = oldd[oi].hash; break; }
                if (keep)
                    snprintf(ah, sizeof ah, "%s", keep);
                else if (d->body)           /* new or edited: re-baseline */
                    hash_lines(d->body, d->body_len,
                               pr->defs[doc].line, ends[doc], ah);
            } else {
                int best = -1, best_fn = -1;
                for (int dj = 0;
                     dj < pr->ndefs && pr->defs[dj].line <= c->line; dj++) {
                    if (ends[dj] < c->line || pr->defs[dj].decl) continue;
                    best = dj;
                    const char *k = pr->defs[dj].kind;
                    if (strcmp(k, "function") == 0 || strcmp(k, "method") == 0 ||
                        strcmp(k, "ctor") == 0)
                        best_fn = dj;
                }
                int pick = best_fn >= 0 ? best_fn : best;
                if (pick >= 0) {
                    kind = "inline";
                    sym = rowids[pick];
                } else if (c->pure && (!pr->first_code_line ||
                                       c->line < pr->first_code_line)) {
                    /* opens the file: nothing but comment above it. A note
                     * merely sitting above the first def is not a header. */
                    kind = "file";
                }
            }
            sqlite3_bind_int64(s->ins_cmt, 1, file_id);
            sqlite3_bind_int  (s->ins_cmt, 2, c->line);
            sqlite3_bind_int  (s->ins_cmt, 3, c->end_line);
            sqlite3_bind_text (s->ins_cmt, 4, kind, -1, SQLITE_STATIC);
            if (sym) sqlite3_bind_int64(s->ins_cmt, 5, sym);
            else     sqlite3_bind_null (s->ins_cmt, 5);
            sqlite3_bind_text (s->ins_cmt, 6, c->body, -1, SQLITE_STATIC);
            if (ah[0]) sqlite3_bind_text(s->ins_cmt, 7, ah, -1, SQLITE_TRANSIENT);
            else       sqlite3_bind_null(s->ins_cmt, 7);
            step_reset(s->ins_cmt);

            /* The prose index carries anchors — every file header and doc
             * — plus any multi-line note, which is someone stopping to
             * explain something. Single-line labels ("raw online CPUs")
             * stay in `comments`, bound to their symbol and still word-
             * searchable through body_fts; indexing them here would cost
             * a fifth of the index budget to make the prose index worse. */
            if (strcmp(kind, "file") == 0 || strcmp(kind, "doc") == 0 ||
                c->end_line > c->line) {
                sqlite3_bind_int64(s->ins_cmtfts, 1,
                                   sqlite3_last_insert_rowid(cg->db));
                sqlite3_bind_text (s->ins_cmtfts, 2, c->body, -1,
                                   SQLITE_STATIC);
                step_reset(s->ins_cmtfts);
            }
            st->anchors++;
        }
        sem_file_replace(cg, file_id, &pr->sem, rowids, pr->ndefs,
                         refids, pr->nrefs);
        free(rowids);
        free(refids);
        free(ends);
        for (int i = 0; i < pr->nroutes; i++) {
            sqlite3_bind_int64(s->ins_route, 1, file_id);
            sqlite3_bind_text (s->ins_route, 2, pr->routes[i].framework, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_route, 3, pr->routes[i].method, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_route, 4, pr->routes[i].pattern, -1, SQLITE_STATIC);
            if (pr->routes[i].handler)
                sqlite3_bind_text(s->ins_route, 5, pr->routes[i].handler, -1, SQLITE_STATIC);
            else
                sqlite3_bind_null(s->ins_route, 5);
            sqlite3_bind_int(s->ins_route, 6, pr->routes[i].line);
            step_reset(s->ins_route);
            scope_name(s, pr->routes[i].pattern);
            st->routes++;
        }
        for (int i = 0; i < pr->nimports; i++) {
            sqlite3_bind_int64(s->ins_import, 1, file_id);
            sqlite3_bind_text (s->ins_import, 2, pr->imports[i].name, -1,
                               SQLITE_STATIC);
            sqlite3_bind_text (s->ins_import, 3, pr->imports[i].module, -1,
                               SQLITE_STATIC);
            sqlite3_bind_int  (s->ins_import, 4, pr->imports[i].line);
            sqlite3_bind_int  (s->ins_import, 5, pr->imports[i].system ? 1 : 0);
            step_reset(s->ins_import);
        }
    }

    if (d->body) {
        sqlite3_bind_int64(s->ins_body, 1, file_id);
        sqlite3_bind_text (s->ins_body, 2, w->rel, -1, SQLITE_STATIC);
        sqlite3_bind_text (s->ins_body, 3, d->body, (int)d->body_len, SQLITE_STATIC);
        step_reset(s->ins_body);
        sqlite3_bind_int64(s->ins_tri, 1, file_id);
        sqlite3_bind_text (s->ins_tri, 2, d->body, (int)d->body_len, SQLITE_STATIC);
        step_reset(s->ins_tri);
    }
    for (int i = 0; i < noldd; i++) { free(oldd[i].body); free(oldd[i].hash); }
    free(oldd);
    st->files_indexed++;
    st->bytes += w->size;
    index_health_record(cg, w->rel, &hr);
}

/* A file that became binary or exceeded the read budget cannot keep old
 * source facts. A transient read failure takes a different path and keeps
 * those facts with failed coverage until the retry succeeds. */
static void drop_skipped_file(Cg *cg, Stmts *s, const Walked *w,
                              IndexStats *st) {
    sqlite3_bind_text(s->sel_file, 1, w->rel, -1, SQLITE_STATIC);
    sqlite3_bind_int64(s->sel_file, 2, cg->branch_id);
    long file_id = sqlite3_step(s->sel_file) == SQLITE_ROW
        ? sqlite3_column_int64(s->sel_file, 0) : 0;
    sqlite3_reset(s->sel_file);
    sqlite3_clear_bindings(s->sel_file);
    if (!file_id) return;
    scope_record_file(s, file_id, false);
    purge_file_children(cg, s, file_id);
    sqlite3_stmt *del = cg_prep(cg, "DELETE FROM files WHERE id=?1");
    sqlite3_bind_int64(del, 1, file_id);
    sqlite3_step(del);
    sqlite3_finalize(del);
    sqlite3_bind_int64(s->del_filefts, 1, file_id);
    step_reset(s->del_filefts);
    st->files_removed++;
}

/* ---------------- top level ---------------- */

/* -------- soft edges: the couplings only prose records -------- */

/* One resolved mention: insert refs(kind='soft'). qual carries what the
 * name is — NULL a symbol, 'path' a file, 'route' a route pattern. */
static void soft_insert(sqlite3_stmt *ins, long file_id, int line,
                        long sym_id, const char *name, const char *qual,
                        IndexStats *st) {
    sqlite3_bind_int64(ins, 1, file_id);
    sqlite3_bind_text (ins, 2, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int  (ins, 3, line);
    if (sym_id) sqlite3_bind_int64(ins, 4, sym_id);
    else        sqlite3_bind_null (ins, 4);
    if (qual) sqlite3_bind_text(ins, 5, qual, -1, SQLITE_STATIC);
    else      sqlite3_bind_null(ins, 5);
    sqlite3_step(ins);
    sqlite3_reset(ins);
    st->soft++;
}

/* single-row existence probe; for is_path returns the resolved path */
static bool probe(sqlite3_stmt *st, const char *tok, char *out, size_t cap) {
    sqlite3_bind_text(st, 1, tok, -1, SQLITE_TRANSIENT);
    if (sqlite3_bind_parameter_count(st) >= 3) {     /* is_path: the base */
        const char *b = strrchr(tok, '/');
        sqlite3_bind_text(st, 3, b ? b + 1 : tok, -1, SQLITE_TRANSIENT);
    }
    bool hit = sqlite3_step(st) == SQLITE_ROW;
    if (hit && out) {
        const char *p = (const char *)sqlite3_column_text(st, 0);
        snprintf(out, cap, "%s", p ? p : tok);
    }
    sqlite3_reset(st);
    return hit;
}

/* ---------------- change scope ---------------- */

void index_scope_begin(Cg *cg) {
    cg_exec(cg,
        "CREATE TEMP TABLE IF NOT EXISTS scope_files("
        "  id INTEGER PRIMARY KEY, added INTEGER NOT NULL DEFAULT 0);"
        "CREATE TEMP TABLE IF NOT EXISTS scope_names(name TEXT PRIMARY KEY);"
        "CREATE TEMP TABLE IF NOT EXISTS scope_afiles(id INTEGER PRIMARY KEY);"
        "DELETE FROM scope_files; DELETE FROM scope_names;"
        "DELETE FROM scope_afiles;");
}

void index_scope_end(Cg *cg) {
    cg_exec(cg, "DELETE FROM scope_files; DELETE FROM scope_names;"
                "DELETE FROM scope_afiles;");
}

static long count_sql(Cg *cg, const char *sql) {
    sqlite3_stmt *q = cg_prep(cg, sql);
    long n = sqlite3_step(q) == SQLITE_ROW ? sqlite3_column_int64(q, 0) : 0;
    sqlite3_finalize(q);
    return n;
}

bool index_scope_bounded(Cg *cg) {
    long nf = count_sql(cg, "SELECT count(*) FROM temp.scope_files");
    char sql[96];
    snprintf(sql, sizeof sql, "SELECT count(*) FROM files WHERE branch_id=%ld",
             cg->branch_id);
    long total = count_sql(cg, sql);
    return nf > 0 && (nf <= 64 || nf * 4 < total);
}

/* Which files' anchor comments must be rebuilt: the changed files, plus
 * any file whose prose mentions a name the change touched (a doc that
 * cites a symbol just added gains an edge; one citing a removed symbol
 * loses it). Names become FTS phrases the way unicode61 tokenises them. */
static void scope_anchor_files(Cg *cg) {
    cg_exec(cg, "INSERT OR IGNORE INTO temp.scope_afiles(id) "
                "SELECT id FROM temp.scope_files");
    sqlite3_stmt *names = cg_prep(cg, "SELECT name FROM temp.scope_names");
    sqlite3_stmt *hit = cg_prep(cg,
        "INSERT OR IGNORE INTO temp.scope_afiles(id) "
        "SELECT DISTINCT c.file_id FROM comment_fts f "
        "JOIN comments c ON c.id=f.rowid WHERE comment_fts MATCH ?");
    StrBuf q;
    sb_init(&q);
    int batch = 0;
    while (sqlite3_step(names) == SQLITE_ROW) {
        const char *n = (const char *)sqlite3_column_text(names, 0);
        if (!n) continue;
        /* phrase = the alnum runs of the name, in order */
        char phrase[600];
        size_t j = 0;
        bool intok = false;
        int ntok = 0;
        for (const char *p = n; *p && j + 2 < sizeof phrase; p++) {
            bool a = isalnum((unsigned char)*p) || ((unsigned char)*p >= 0x80);
            if (a) { if (!intok) { if (j) phrase[j++] = ' '; ntok++; }
                     phrase[j++] = *p; intok = true; }
            else intok = false;
        }
        phrase[j] = 0;
        if (ntok == 0 || j < 3) continue;
        sb_printf(&q, "%s\"%s\"", batch ? " OR " : "", phrase);
        if (++batch == 48) {
            sqlite3_bind_text(hit, 1, q.p, -1, SQLITE_TRANSIENT);
            sqlite3_step(hit);
            sqlite3_reset(hit);
            sb_free(&q); sb_init(&q);
            batch = 0;
        }
    }
    if (batch) {
        sqlite3_bind_text(hit, 1, q.p, -1, SQLITE_TRANSIENT);
        sqlite3_step(hit);
        sqlite3_reset(hit);
    }
    sb_free(&q);
    sqlite3_finalize(names);
    sqlite3_finalize(hit);
}

/* Rebuild refs kind='soft' from anchor comments (kind file and doc).
 * Runs once after the scan completes so existence checks see the whole
 * tree — checking at write time would make edges depend on file order.
 * A token becomes an edge only when it resolves to a symbol, a file, or
 * a route that exists; everything else is silence (req 4.4).
 * scoped: only the files scope_anchor_files picked are rescanned, and
 * st->soft is recounted from the table so the report stays truthful. */
/* A prototype's doc still yields edges, but from no symbol: the prototype
 * calls nothing, and naming it as the source would invent callers. */
#define SOFT_FROM "CASE WHEN s.decl=1 THEN NULL ELSE c.sym_id END"

static void anchor_edges_run(Cg *cg, IndexStats *st, bool scoped) {
    if (scoped) {
        scope_anchor_files(cg);
        cg_exec(cg, "DELETE FROM refs WHERE kind='soft' AND file_id IN "
                    "(SELECT id FROM temp.scope_afiles)");
    } else {
        cg_exec(cg, "DELETE FROM refs WHERE kind='soft'");
    }
    sqlite3_stmt *sel = cg_prep(cg, scoped ?
        "SELECT c.file_id, c.line, " SOFT_FROM ", c.body, coalesce(s.name,'') "
        "FROM comments c LEFT JOIN symbols s ON s.id=c.sym_id "
        "WHERE c.kind IN ('file','doc') AND c.file_id IN "
        "(SELECT id FROM temp.scope_afiles) ORDER BY c.file_id, c.line" :
        "SELECT c.file_id, c.line, " SOFT_FROM ", c.body, coalesce(s.name,'') "
        "FROM comments c LEFT JOIN symbols s ON s.id=c.sym_id "
        "WHERE c.kind IN ('file','doc') ORDER BY c.file_id, c.line");
    sqlite3_stmt *ins = cg_prep(cg,
        "INSERT INTO refs(file_id,name,line,sym_id,qual,kind) "
        "VALUES(?,?,?,?,?,'soft')");
    sqlite3_stmt *is_sym = cg_prep(cg,
        "SELECT 1 FROM symbols WHERE name=? LIMIT 1");
    /* by name through idx_file_base: a full path matches itself, a partial
     * one (main.go, src/db.c) any path it ends — the suffix test runs only
     * on the rows whose last segment is the token's */
    sqlite3_stmt *is_path = cg_prep(cg,
        "SELECT path FROM files INDEXED BY idx_file_base "
        "WHERE base=?3 AND branch_id=?2 AND "
        "(path=?1 OR substr(path, -length(?1) - 1) = '/' || ?1) "
        "ORDER BY path LIMIT 1");
    sqlite3_bind_int64(is_path, 2, cg->branch_id);   /* survives reset */
    sqlite3_stmt *is_route = cg_prep(cg,
        "SELECT pattern FROM routes WHERE pattern=?1 LIMIT 1");
    while (sqlite3_step(sel) == SQLITE_ROW) {
        long fid    = sqlite3_column_int64(sel, 0);
        int  line   = sqlite3_column_int  (sel, 1);
        long sym    = sqlite3_column_int64(sel, 2);
        const char *body = (const char *)sqlite3_column_text(sel, 3);
        const char *self = (const char *)sqlite3_column_text(sel, 4);
        if (!body) continue;
        char seen[24][512];                 /* per-span dedupe */
        int nseen = 0;
        for (const char *p = body; *p && nseen < 24; ) {
            /* words are runs of identifier/path characters */
            while (*p && !(isalnum((unsigned char)*p) || *p == '_' ||
                           *p == '/' || *p == '.')) p++;
            if (!*p) break;
            const char *w = p;
            while (isalnum((unsigned char)*p) || *p == '_' ||
                   *p == '/' || *p == '.' || *p == '-') p++;
            size_t n = (size_t)(p - w);
            while (n && (w[n-1] == '.' || w[n-1] == ',' || w[n-1] == '-' ||
                         w[n-1] == '/')) n--;      /* sentence punctuation */
            if (n < 3 || n >= 512) continue;
            char tok[512];
            memcpy(tok, w, n); tok[n] = 0;
            bool digits = true;
            for (size_t i = 0; i < n; i++)
                if (!isdigit((unsigned char)tok[i]) && tok[i] != '.')
                    { digits = false; break; }
            if (digits) continue;                  /* versions, numbers */
            if (self[0] && strcmp(tok, self) == 0) continue;  /* self-edge */
            bool dup = false;
            for (int i = 0; i < nseen; i++)
                if (strcmp(seen[i], tok) == 0) { dup = true; break; }
            if (dup) continue;
            snprintf(seen[nseen++], sizeof seen[0], "%s", tok);

            char rp[1024];
            const char *slash = strchr(tok, '/');
            const char *dot   = strchr(tok, '.');
            if (slash) {
                /* route patterns first (/api/tasks), then repo paths */
                if (tok[0] == '/' && probe(is_route, tok, NULL, 0))
                    soft_insert(ins, fid, line, sym, tok, "route", st);
                else if (probe(is_path, tok, rp, sizeof rp))
                    soft_insert(ins, fid, line, sym, rp, "path", st);
            } else if (probe(is_sym, tok, NULL, 0)) {
                soft_insert(ins, fid, line, sym, tok, NULL, st);
            } else if (dot) {
                /* main.go — a bare basename; db.Reconcile — a dotted name */
                if (probe(is_path, tok, rp, sizeof rp)) {
                    soft_insert(ins, fid, line, sym, rp, "path", st);
                } else {
                    const char *last = strrchr(tok, '.') + 1;
                    if (strlen(last) >= 3 && strcmp(last, self) != 0 &&
                        probe(is_sym, last, NULL, 0))
                        soft_insert(ins, fid, line, sym, last, NULL, st);
                }
            }
        }
    }
    sqlite3_finalize(sel);
    sqlite3_finalize(ins);
    sqlite3_finalize(is_sym);
    sqlite3_finalize(is_path);
    sqlite3_finalize(is_route);
    if (scoped)
        st->soft = count_sql(cg, "SELECT count(*) FROM refs WHERE kind='soft'");
}

static void anchor_edges(Cg *cg, IndexStats *st) {
    anchor_edges_run(cg, st, false);
}

static void anchor_edges_scoped(Cg *cg, IndexStats *st) {
    anchor_edges_run(cg, st, true);
}

/* Write one parsed chunk under the lock. Returns -1 when the lock never came;
 * the chunk is then dropped (its files stay unhashed in the DB and are
 * re-parsed by the next run), and every result is freed either way. */
/* Every file of the chunk whose rows write_done is about to replace (it
 * has a row and its content changed) leaves the FTS tables here, three
 * statements for the chunk instead of three per file. */
static void fts_prepurge(Cg *cg, Stmts *s, Walked *jobs, Done *chunk, int n) {
    s->fts_purged = false;
    if (!s->purge_add || !s->purge_sym || !s->purge_cmt || !s->purge_body ||
        !s->purge_tri || !s->purge_clear)
        return;
    int k = 0;
    for (int i = 0; i < n; i++) {
        const Walked *w = &jobs[chunk[i].idx];
        if (chunk[i].failed_read || chunk[i].binary || chunk[i].oversized) continue;
        if (w->dbhash[0] && strcmp(w->dbhash, chunk[i].hash) == 0) continue;
        sqlite3_bind_text(s->purge_add, 1, w->rel, -1, SQLITE_STATIC);
        sqlite3_bind_int64(s->purge_add, 2, cg->branch_id);
        step_reset(s->purge_add);
        k++;
    }
    if (k) {
        step_reset(s->purge_sym);
        step_reset(s->purge_cmt);
        step_reset(s->purge_body);
        step_reset(s->purge_tri);
        step_reset(s->purge_clear);
    }
    s->fts_purged = true;
}

static int flush_chunk(Cg *cg, Stmts *s, Walked *jobs, Done *chunk, int n,
                       IndexStats *st) {
    long t0 = now_ms();
    int rc = progress_begin_write(cg);
    if (rc == 0) fts_prepurge(cg, s, jobs, chunk, n);
    for (int i = 0; i < n; i++) {
        if (rc == 0) {
            const Walked *w = &jobs[chunk[i].idx];
            if (chunk[i].failed_read || chunk[i].binary || chunk[i].oversized) {
                IndexHealthResult hr = {
                    .status = chunk[i].failed_read ? "failed" : "skipped",
                    .reason = chunk[i].failed_read ? "read_error" :
                              chunk[i].oversized ? "size_limit" : "binary_file",
                    .parser = "none", .generated = false,
                };
                index_health_record(cg, w->rel, &hr);
                if (!chunk[i].failed_read) drop_skipped_file(cg, s, w, st);
                st->files_skipped++;
            } else write_done(cg, s, w, &chunk[i], st);
        }
        if (chunk[i].parsed) parse_result_free(&chunk[i].pr);
        free(chunk[i].body);
    }
    s->fts_purged = false;
    if (rc == 0) cg_exec(cg, "COMMIT");
    index_phase_ms(st, IDX_PH_WRITE, t0);
    return rc;
}

/* ---------------- targeted walks ---------------- */

/* Normalise a caller's path to root-relative form: absolute paths under the
 * root are stripped, "./" and trailing slashes dropped. Returns false for a
 * path outside the project. */
static bool target_rel(const char *root, const char *in, char *out, size_t cap) {
    const char *p = in;
    size_t rl = strlen(root);
    if (p[0] == '/') {
        if (strncmp(p, root, rl) != 0 || (p[rl] != '/' && p[rl] != 0))
            return false;
        p += rl;
        while (*p == '/') p++;
    }
    while (strncmp(p, "./", 2) == 0) p += 2;
    size_t n = strlen(p);
    while (n > 0 && p[n - 1] == '/') n--;
    if (n >= cap) return false;
    memcpy(out, p, n);
    out[n] = 0;
    return true;
}

/* true when a DB row path is one of the targets or lives under a target dir */
static bool targets_cover(char **t, int nt, const char *path) {
    for (int i = 0; i < nt; i++) {
        if (t[i][0] == 0) return true;            /* the root itself */
        size_t n = strlen(t[i]);
        if (strncmp(path, t[i], n) == 0 && (path[n] == 0 || path[n] == '/'))
            return true;
    }
    return false;
}

/* Walk only the targets: a directory target recurses like the full walk, a
 * file target is stat'd alone. Ignore rules apply to both so an agent
 * editing something under node_modules cannot pull it into the graph. */
static void walk_targets(const char *root, const Ignore *ig, char **t, int nt,
                         int threads, WalkList *wl) {
    for (int i = 0; i < nt; i++) {
        if (t[i][0] == 0) { walk_dir(root, "", ig, threads, wl); continue; }
        char abs[4900];
        snprintf(abs, sizeof abs, "%s/%s", root, t[i]);
        struct stat st;
        if (lstat(abs, &st) != 0 || S_ISLNK(st.st_mode)) continue;
        bool isdir = S_ISDIR(st.st_mode);
        /* every ancestor must pass the ignore rules too */
        bool ignored = false;
        char anc[4096];
        snprintf(anc, sizeof anc, "%s", t[i]);
        for (char *s = anc + 1; *s; s++) {
            if (*s != '/') continue;
            *s = 0;
            if (ignore_match(ig, anc, true)) { ignored = true; break; }
            *s = '/';
        }
        if (ignored || ignore_match(ig, t[i], isdir)) continue;
        if (isdir) walk_dir(root, t[i], ig, threads, wl);
        else if (S_ISREG(st.st_mode))
            walk_push(wl, t[i], (long)st.st_size, (long)st.st_mtime);
    }
}

/* Turn a dirty note (one path per line, "*" = everything) into a target
 * list. Returns the count; *whole is set when any line asks for the tree. */
static int note_targets(const char *root, const char *note, char ***out,
                        bool *whole) {
    *whole = false;
    char **v = NULL;
    int n = 0;
    const char *p = note;
    while (p && *p) {
        const char *e = strchr(p, '\n');
        size_t len = e ? (size_t)(e - p) : strlen(p);
        if (len == 1 && p[0] == '*') *whole = true;
        else if (len > 0 && len < 4096) {
            char raw[4096], rel[4096];
            memcpy(raw, p, len);
            raw[len] = 0;
            if (target_rel(root, raw, rel, sizeof rel)) {
                v = xrealloc(v, sizeof *v * (size_t)(n + 1));
                v[n++] = xstrdup(rel);
            }
        }
        p = e ? e + 1 : NULL;
    }
    *out = v;
    return n;
}

static void targets_free(char **t, int n) {
    for (int i = 0; i < n; i++) free(t[i]);
    free(t);
}

/* Mark every job that another branch has already parsed byte for byte.
 * Only the path and the stored hash are read here; the worker confirms the
 * hash against the bytes on disk before anything is reused, so a twin that
 * went stale between the two is simply parsed as usual. A single-branch
 * project never pays for the lookup, and --full keeps its promise of a
 * genuine reparse. */
static void index_find_twins(Cg *cg, WalkList *jobs, const IndexOpts *o) {
    if (o->full || jobs->n == 0) return;
    if (count_sql(cg, "SELECT count(*) FROM branches") < 2) return;
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT f.id,f.hash,f.lines,h.parser FROM files f "
        "JOIN extraction_health h ON h.branch_id=f.branch_id AND h.path=f.path "
        "WHERE f.path=?1 AND f.branch_id<>?2 AND f.hash IS NOT NULL "
        "AND h.status='complete' AND h.extraction_version="
        "CAST(?3 AS INTEGER) LIMIT 1");
    sqlite3_bind_int64(q, 2, cg->branch_id);      /* survives reset */
    sqlite3_bind_int(q, 3, CG_EXTRACTION_VERSION);
    for (int i = 0; i < jobs->n; i++) {
        sqlite3_bind_text(q, 1, jobs->v[i].rel, -1, SQLITE_STATIC);
        if (sqlite3_step(q) == SQLITE_ROW) {
            const char *h = (const char *)sqlite3_column_text(q, 1);
            if (h && h[0]) {
                jobs->v[i].twin_id = sqlite3_column_int64(q, 0);
                jobs->v[i].twin_lines = sqlite3_column_int64(q, 2);
                snprintf(jobs->v[i].twin_hash, sizeof jobs->v[i].twin_hash,
                         "%s", h);
                const char *parser = (const char *)sqlite3_column_text(q, 3);
                snprintf(jobs->v[i].twin_parser, sizeof jobs->v[i].twin_parser,
                         "%s", parser ? parser : "");
            }
        }
        sqlite3_reset(q);
    }
    sqlite3_finalize(q);
}

/* One walk+diff+parse+write pass. targets NULL means the whole tree; with
 * targets, only rows under those paths are diffed, so files elsewhere are
 * never mistaken for removals. Only the open branch's rows are diffed and
 * written: a sibling worktree's slice of the graph is invisible here, so
 * its files can never look removed — though a file byte-identical to one
 * already parsed there is copied rather than parsed again. Adds to st;
 * returns 0, or -1 when the database stayed busy (a stall). */
static int index_pass(Cg *cg, const SysInfo *si, const IndexOpts *o,
                      char **targets, int ntargets, IndexStats *st) {
    if (index_health_init(cg) != 0) return -1;
    long tw = now_ms();
    Ignore ig;
    ignore_load(&ig, cg->root);
    WalkList wl = {0};
    progress_phase("walking the tree", 0, 0);
    /* the walk's threads: the pass's own worker request, a quarter of it
     * in the background, never above the cap a caller set */
    const char *worigin;
    int wthreads = syncgate_worker_request(cg->root, si, o->workers, &worigin);
    if (o->workers_cap > 0 && o->workers_cap < wthreads)
        wthreads = o->workers_cap;
    if (o->background) wthreads = wthreads / 4 > 1 ? wthreads / 4 : 1;
    if (targets) walk_targets(cg->root, &ig, targets, ntargets, wthreads, &wl);
    else         walk_dir(cg->root, "", &ig, wthreads, &wl);
    ignore_free(&ig);
    progress_tick(wl.n, 0, "");
    progress_flush();                   /* the count, once known */
    qsort(wl.v, (size_t)wl.n, sizeof(Walked), walked_cmp);
    /* a path named twice (a target and its directory, or git's status and
     * the last pass's dirty list) is one file: a second entry would meet
     * no row in the merge below and be rewritten as new */
    int nu = 0;
    for (int i = 0; i < wl.n; i++) {
        if (nu && strcmp(wl.v[nu - 1].rel, wl.v[i].rel) == 0) {
            free(wl.v[i].rel);
            continue;
        }
        wl.v[nu++] = wl.v[i];
    }
    wl.n = nu;
    index_phase_ms(st, IDX_PH_WALK, tw);
    if (!targets && wl.n > st->files_seen) st->files_seen = wl.n;
    if (targets) st->files_seen += wl.n;

    /* current DB view — for a targeted pass only the rows the targets
     * cover, so nothing outside them can look removed */
    DbFile *dbf = NULL;
    int ndbf = 0, cdbf = 0;
    sqlite3_stmt *sel = cg_prep(cg,
        "SELECT id,path,size,mtime,hash FROM files WHERE branch_id=?");
    sqlite3_bind_int64(sel, 1, cg->branch_id);
    while (sqlite3_step(sel) == SQLITE_ROW) {
        const char *path = (const char *)sqlite3_column_text(sel, 1);
        if (targets && !targets_cover(targets, ntargets, path)) continue;
        if (ndbf == cdbf) {
            cdbf = cdbf ? cdbf * 2 : 256;
            dbf = xrealloc(dbf, sizeof(DbFile) * (size_t)cdbf);
        }
        dbf[ndbf].id    = sqlite3_column_int64(sel, 0);
        dbf[ndbf].path  = xstrdup(path);
        dbf[ndbf].size  = sqlite3_column_int64(sel, 2);
        dbf[ndbf].mtime = sqlite3_column_int64(sel, 3);
        const char *h = (const char *)sqlite3_column_text(sel, 4);
        snprintf(dbf[ndbf].hash, 65, "%s", h ? h : "");
        ndbf++;
    }
    sqlite3_finalize(sel);
    qsort(dbf, (size_t)ndbf, sizeof(DbFile), dbfile_cmp);

    /* diff walk vs DB: build job list + removal list */
    WalkList jobs = {0};
    int wi = 0, di = 0;
    long *removed_ids = ndbf ? xmalloc(sizeof(long) * (size_t)ndbf) : NULL;
    int nremoved = 0;
    while (wi < wl.n || di < ndbf) {
        int c = (wi >= wl.n) ? 1 : (di >= ndbf) ? -1
              : strcmp(wl.v[wi].rel, dbf[di].path);
        if (c == 0) {
            bool semantic_stale = index_health_stale(cg, wl.v[wi].rel);
            if (o->full || wl.v[wi].size != dbf[di].size ||
                wl.v[wi].mtime != dbf[di].mtime || semantic_stale) {
                walk_push(&jobs, wl.v[wi].rel, wl.v[wi].size, wl.v[wi].mtime);
                jobs.v[jobs.n - 1].semantic_stale = semantic_stale;
                /* remember the stored hash so unchanged content can skip the
                 * purge+reinsert; --full keeps its force-reparse meaning */
                if (!o->full)
                    snprintf(jobs.v[jobs.n - 1].dbhash,
                             sizeof jobs.v[jobs.n - 1].dbhash, "%s",
                             dbf[di].hash);
            }
            wi++; di++;
        } else if (c < 0) {
            walk_push(&jobs, wl.v[wi].rel, wl.v[wi].size, wl.v[wi].mtime);
            wi++;
        } else {
            removed_ids[nremoved++] = dbf[di].id;
            di++;
        }
    }

    index_find_twins(cg, &jobs, o);

    /* The write lock is the scarce resource: while one process holds it,
     * every other cg command that mutates state — an agent's `cg spec done`
     * above all — waits. Parsing is the slow part and needs no lock, so
     * workers parse ahead into a buffer and the main thread takes the lock
     * only to write one chunk at a time. Between chunks the lock is free
     * and waiting writers get through; a lease or status write lands in
     * the gap instead of after the whole tree. Chunks already committed
     * stay valid if a later one has to be abandoned. */
    Stmts s;
    stmts_init(cg, &s);
    bool stalled = false;

    if (nremoved > 0) {
        long trm = now_ms();
        progress_phase("writing the graph", 0, nremoved);
        if (progress_begin_write(cg) != 0) {
            stalled = true;
        } else {
            sqlite3_stmt *del_file = cg_prep(cg, "DELETE FROM files WHERE id=?");
            for (int i = 0; i < nremoved; i++) {
                scope_record_file(&s, removed_ids[i], false);
                purge_file_children(cg, &s, removed_ids[i]);
                index_health_remove(cg, removed_ids[i]);
                sqlite3_bind_int64(del_file, 1, removed_ids[i]);
                step_reset(del_file);
                sqlite3_bind_int64(s.del_filefts, 1, removed_ids[i]);
                step_reset(s.del_filefts);               /* codify-v15 1.2 */
                st->files_removed++;
            }
            sqlite3_finalize(del_file);
            cg_exec(cg, "COMMIT");
        }
        index_phase_ms(st, IDX_PH_WRITE, trm);
    }
    free(removed_ids);

    if (jobs.n > 0 && !stalled) {
        long tp = now_ms(), w0 = st->phase_ms[IDX_PH_WRITE];
        Pipe pipe;
        memset(&pipe, 0, sizeof pipe);
        pipe.root = cg->root;
        pipe.jobs = jobs.v;
        pipe.njobs = jobs.n;
        atomic_init(&pipe.next, 0);
        pthread_mutex_init(&pipe.mu, NULL);
        pthread_cond_init(&pipe.can_push, NULL);
        pthread_cond_init(&pipe.can_pop, NULL);

        int slot = -1;
        int nw = syncgate_worker_budget(cg->root, si, o, jobs.n, &slot);
        if (nw > CG_MAX_WORKERS) nw = CG_MAX_WORKERS;
        if (nw > st->workers) st->workers = nw;
        pipe.producers_left = nw;
        pthread_t th[CG_MAX_WORKERS];
        for (int i = 0; i < nw; i++)
            pthread_create(&th[i], NULL, worker, &pipe);


        /* progress counts what the consumer already sees: one per pop */
        long popped = 0;
        progress_workers(nw);
        progress_phase("parsing files", 0, jobs.n);
        Done chunk[INDEX_CHUNK];
        int nchunk = 0;
        Done d;
        while (ring_pop(&pipe, &d)) {
            popped++;
            progress_tick(popped, jobs.n, d.idx >= 0 ? jobs.v[d.idx].rel : NULL);
            if (stalled) {                 /* drain so the workers can exit */
                if (d.parsed) parse_result_free(&d.pr);
                free(d.body);
                continue;
            }
            chunk[nchunk++] = d;
            if (nchunk == INDEX_CHUNK) {
                progress_phase("writing the graph", popped, jobs.n);
                if (flush_chunk(cg, &s, jobs.v, chunk, nchunk, st) != 0)
                    stalled = true;
                nchunk = 0;
                progress_phase("parsing files", popped, jobs.n);
            }
        }
        progress_phase("writing the graph", popped, jobs.n);
        if (nchunk && !stalled &&
            flush_chunk(cg, &s, jobs.v, chunk, nchunk, st) != 0)
            stalled = true;
        for (int i = 0; i < nw; i++)
            pthread_join(th[i], NULL);
        pthread_mutex_destroy(&pipe.mu);
        pthread_cond_destroy(&pipe.can_push);
        pthread_cond_destroy(&pipe.can_pop);
        syncgate_slot_release(slot);
        /* parse: the pipeline's wall time less the chunks written in it */
        st->phase_ms[IDX_PH_PARSE] += now_ms() - tp -
                                      (st->phase_ms[IDX_PH_WRITE] - w0);
    }

    stmts_fin(&s);
    if (!stalled) index_health_prune_missing(cg);

    for (int i = 0; i < wl.n; i++) free(wl.v[i].rel);
    free(wl.v);
    for (int i = 0; i < jobs.n; i++) free(jobs.v[i].rel);
    free(jobs.v);
    for (int i = 0; i < ndbf; i++) free(dbf[i].path);
    free(dbf);
    return stalled ? -1 : 0;
}

/* codify-v15 1.5: body_tri rows a graph should hold but does not — the
 * table was created on a database already at its schema version, or a
 * write was cut short. A pass only rewrites files whose size or mtime
 * moved, so an unchanged file never gets its row back on its own. When the
 * table is short of the files that carry a body (size within
 * MAX_FTS_BYTES, the predicate write_done applies), this re-reads the open
 * branch's files that have no row and inserts them, at most
 * TRI_REPAIR_MAX per pass so a huge repair spreads over several syncs.
 * cg grep's completeness guard (grep_tri_complete) clears once it is done. */
#define TRI_REPAIR_MAX 50000

static long tri_rows(Cg *cg) {
    sqlite3_stmt *q = NULL;
    /* the docsize shadow holds one row per document and counts without
     * walking the full-text index; body_tri itself when it is absent */
    if (sqlite3_prepare_v2(cg->db, "SELECT count(*) FROM body_tri_docsize",
                           -1, &q, NULL) != SQLITE_OK) {
        sqlite3_finalize(q);
        q = NULL;
        if (sqlite3_prepare_v2(cg->db, "SELECT count(*) FROM body_tri", -1,
                               &q, NULL) != SQLITE_OK) {
            sqlite3_finalize(q);
            return -1;
        }
    }
    long n = sqlite3_step(q) == SQLITE_ROW ? sqlite3_column_int64(q, 0) : -1;
    sqlite3_finalize(q);
    return n;
}

static void index_tri_repair(Cg *cg, long *repaired) {
    char sql[160];
    snprintf(sql, sizeof sql, "SELECT count(*) FROM files WHERE size<=%ld",
             MAX_FTS_BYTES);
    long want = count_sql(cg, sql), have = tri_rows(cg);
    if (have < 0 || have >= want) return;
    sqlite3_stmt *sel = cg_prep(cg,
        "SELECT f.id,f.path FROM files f WHERE f.branch_id=?1 AND f.size<=?2 "
        "AND NOT EXISTS(SELECT 1 FROM body_tri t WHERE t.rowid=f.id) "
        "ORDER BY f.id LIMIT ?3");
    sqlite3_bind_int64(sel, 1, cg->branch_id);
    sqlite3_bind_int64(sel, 2, MAX_FTS_BYTES);
    sqlite3_bind_int64(sel, 3, TRI_REPAIR_MAX);
    long *ids = NULL;
    char **paths = NULL;
    long n = 0, cap = 0;
    while (sqlite3_step(sel) == SQLITE_ROW) {
        if (n == cap) {
            cap = cap ? cap * 2 : 256;
            ids = xrealloc(ids, sizeof *ids * (size_t)cap);
            paths = xrealloc(paths, sizeof *paths * (size_t)cap);
        }
        ids[n] = sqlite3_column_int64(sel, 0);
        const char *p = (const char *)sqlite3_column_text(sel, 1);
        paths[n++] = xstrdup(p ? p : "");
    }
    sqlite3_finalize(sel);
    if (n == 0) { free(ids); free(paths); return; }
    progress_phase("repairing trigram rows", 0, n);
    if (progress_begin_write(cg) == 0) {
        sqlite3_stmt *ins = cg_prep(cg,
            "INSERT INTO body_tri(rowid,body) VALUES(?,?)");
        for (long i = 0; i < n; i++) {
            char abs[4900];
            snprintf(abs, sizeof abs, "%s/%s", cg->root, paths[i]);
            size_t len = 0;
            char *data = read_entire_file(abs, &len);
            /* what write_done would not have kept is not invented here */
            if (data && (long)len <= MAX_FTS_BYTES && !looks_binary(data, len)) {
                sqlite3_bind_int64(ins, 1, ids[i]);
                sqlite3_bind_text(ins, 2, data, (int)len, SQLITE_STATIC);
                if (sqlite3_step(ins) == SQLITE_DONE) (*repaired)++;
                sqlite3_reset(ins);
                sqlite3_clear_bindings(ins);
            }
            free(data);
            progress_tick(i + 1, n, paths[i]);
        }
        sqlite3_finalize(ins);
        cg_exec(cg, "COMMIT");
    }
    for (long i = 0; i < n; i++) free(paths[i]);
    free(paths);
    free(ids);
}

/* ---------------- codify-v15 1.3: phases, memory, the git-assisted pass ---- */

void index_phase_ms(IndexStats *st, int phase, long t0) {
    if (phase >= 0 && phase < (int)(sizeof st->phase_ms / sizeof *st->phase_ms))
        st->phase_ms[phase] += now_ms() - t0;
}

long index_peak_rss_kb(void) {
    char *s = read_entire_file("/proc/self/status", NULL);
    if (!s) return 0;
    const char *p = strstr(s, "VmHWM:");
    long kb = p ? atol(p + 6) : 0;
    free(s);
    return kb;
}

void index_stats_json(const IndexStats *st, bool targeted, StrBuf *b) {
    sb_printf(b, "{\"indexed\":%ld,\"removed\":%ld,\"seen\":%ld,"
              "\"skipped\":%ld,\"reused\":%ld,"
              "\"ms\":%ld,\"workers\":%d,\"passes\":%d,"
              "\"fresh\":%s,\"coalesced\":%s,\"busy\":%s,"
              "\"scoped\":%s,\"targeted\":%s,\"walk\":\"%s\","
              "\"phase_ms\":{\"walk\":%ld,\"parse\":%ld,\"write\":%ld,"
              "\"resolve\":%ld,\"soft\":%ld},\"peak_rss_kb\":%ld}",
              st->files_indexed, st->files_removed, st->files_seen,
              st->files_skipped, st->files_reused,
              st->ms, st->workers, st->passes,
              st->fresh ? "true" : "false",
              st->coalesced ? "true" : "false",
              st->busy ? "true" : "false",
              st->scoped ? "true" : "false",
              targeted ? "true" : "false",
              st->walk ? st->walk : "none",
              st->phase_ms[IDX_PH_WALK], st->phase_ms[IDX_PH_PARSE],
              st->phase_ms[IDX_PH_WRITE], st->phase_ms[IDX_PH_RESOLVE],
              st->phase_ms[IDX_PH_SOFT], st->peak_rss_kb);
}

/* A path whose change alters what the walk may see: an ignore file. git
 * reports the file, not the files it newly hides or reveals, so a pass that
 * sees one walks the tree. */
static bool is_ignore_file(const char *rel) {
    const char *b = strrchr(rel, '/');
    b = b ? b + 1 : rel;
    return strcmp(b, ".gitignore") == 0 || strcmp(b, CG_IGNORE) == 0;
}

#define WALK_DIRTY_MAX (256 * 1024)

/* A whole-tree pass asks git instead of walking when [index] walk is git,
 * or auto with more than CG_WALK_GIT_MIN_FILES files on the branch; when
 * git answers; when the last pass recorded the head it saw; and unless
 * this is the CG_WALK_FULL_EVERY-th pass since the last full walk. The
 * candidates are git's (walk_git_candidates) plus the paths that were
 * dirty at the last pass — a file edited then and reverted since is in
 * neither of git's lists now. Returns true with *targets set; false means
 * walk the tree. */
static bool index_git_plan(Cg *cg, const IndexOpts *o, const char *head,
                           char ***targets, int *ntargets) {
    if (index_health_branch_stale(cg)) return false;
    if (o->full || !head[0]) return false;
    int mode = config_index_walk(cg->root);
    if (mode == CG_WALK_FULL) return false;
    char key[64];
    if (mode == CG_WALK_AUTO) {
        char sql[96];
        snprintf(sql, sizeof sql,
                 "SELECT count(*) FROM files WHERE branch_id=%ld", cg->branch_id);
        if (count_sql(cg, sql) <= CG_WALK_GIT_MIN_FILES) return false;
    }
    cg_bkey(cg, "walk_passes", key, sizeof key);
    char *np = cg_meta_get(cg, key);
    long passes = np ? atol(np) : 0;
    free(np);
    if (passes + 1 >= CG_WALK_FULL_EVERY) return false;
    cg_bkey(cg, "walk_head", key, sizeof key);
    char *since = cg_meta_get(cg, key);
    if (!since || !since[0]) { free(since); return false; }
    cg_bkey(cg, "walk_dirty", key, sizeof key);
    char *prev = cg_meta_get(cg, key);
    if (prev && strcmp(prev, "*") == 0) {   /* too many to have kept */
        free(prev); free(since);
        return false;
    }
    char **v = NULL;
    int nstatus = 0;
    int n = walk_git_candidates(cg->root, since, &v, &nstatus);
    free(since);
    if (n < 0) { free(prev); return false; }
    for (const char *p = prev; p && *p; ) {
        const char *e = strchr(p, '\n');
        size_t len = e ? (size_t)(e - p) : strlen(p);
        if (len) {
            v = xrealloc(v, sizeof *v * (size_t)(n + 1));
            v[n] = xmalloc(len + 1);
            memcpy(v[n], p, len);
            v[n][len] = 0;
            n++;
        }
        p = e ? e + 1 : NULL;
    }
    free(prev);
    bool walk = false;
    for (int i = 0; i < n && !walk; i++) walk = is_ignore_file(v[i]);
    if (walk) { targets_free(v, n); return false; }
    /* the dirty set the next pass must re-check: today's status paths */
    StrBuf d; sb_init(&d);
    for (int i = 0; i < nstatus && d.len <= WALK_DIRTY_MAX; i++)
        sb_printf(&d, "%s\n", v[i]);
    cg_bkey(cg, "walk_dirty_next", key, sizeof key);
    cg_meta_set(cg, key, d.len > WALK_DIRTY_MAX ? "*" : (d.p ? d.p : ""));
    sb_free(&d);
    *targets = v;
    *ntargets = n;
    return true;
}

/* After a pass that covered the tree: the head it saw, the dirty set the
 * next git pass must include, and the count of git passes since the last
 * full walk. Called only when the pass completed. */
static void index_git_record(Cg *cg, const char *head, bool gitpass) {
    if (!head[0]) return;
    char key[64], nkey[64];
    cg_bkey(cg, "walk_head", key, sizeof key);
    cg_meta_set(cg, key, head);
    cg_bkey(cg, "walk_passes", key, sizeof key);
    char *np = gitpass ? cg_meta_get(cg, key) : NULL;
    char buf[32];
    snprintf(buf, sizeof buf, "%ld", gitpass ? (np ? atol(np) : 0) + 1 : 0L);
    free(np);
    cg_meta_set(cg, key, buf);
    cg_bkey(cg, "walk_dirty", key, sizeof key);
    cg_bkey(cg, "walk_dirty_next", nkey, sizeof nkey);
    char *next = gitpass ? cg_meta_get(cg, nkey) : NULL;
    /* after a full walk the graph matches the tree: nothing carried over,
     * but what is dirty now must be re-checked once it is reverted */
    if (!gitpass) {
        char **v = NULL;
        int nstatus = 0;
        int n = walk_git_candidates(cg->root, head, &v, &nstatus);
        StrBuf d; sb_init(&d);
        for (int i = 0; i < nstatus && d.len <= WALK_DIRTY_MAX; i++)
            sb_printf(&d, "%s\n", v[i]);
        if (n >= 0)
            cg_meta_set(cg, key, d.len > WALK_DIRTY_MAX ? "*" : (d.p ? d.p : ""));
        else
            cg_meta_set(cg, key, "*");
        sb_free(&d);
        if (n > 0) targets_free(v, n);
    } else {
        cg_meta_set(cg, key, next ? next : "");
    }
    free(next);
}

/* The graph is fresh for a caller when the last whole-tree walk of its
 * branch started inside its window and nothing has been queued since: no
 * resolve left behind by a stall, no dirty note from a coalesced caller.
 * Freshness is per branch, so a worktree just added is never told its
 * unindexed branch is fresh because a sibling walked seconds ago. */
static bool index_is_fresh(Cg *cg, long max_age_ms) {
    if (max_age_ms <= 0) return false;
    if (index_health_branch_stale(cg)) return false;
    if (syncgate_is_dirty(cg)) return false;
    char key[64];
    cg_bkey(cg, "index_pending_resolve", key, sizeof key);
    char *p = cg_meta_get(cg, key);
    bool pending = p && p[0] == '1';
    free(p);
    if (pending) return false;
    cg_bkey(cg, "last_index_at", key, sizeof key);
    char *at = cg_meta_get(cg, key);
    long t = at ? atol(at) : 0;
    free(at);
    if (t <= 0) return false;
    long age = now_ms() - t;
    return age >= 0 && age < max_age_ms;
}

static void index_report(const IndexStats *st, const IndexOpts *o) {
    progress_end();                     /* the summary replaces the line */
    if (o->quiet) return;
    if (st->busy) {
        fprintf(stderr, "cg: index stalled — the database stayed busy; "
                        "%ld file%s written before the stall are kept\n",
                st->files_indexed, st->files_indexed == 1 ? "" : "s");
    } else if (st->coalesced) {
        printf("index in progress in another cg process — change queued for it\n");
    } else if (st->fresh) {
        printf("graph is fresh (indexed %ldms ago)\n", st->ms);
    } else {
        char reused[64];
        reused[0] = 0;
        if (st->files_reused)
            snprintf(reused, sizeof reused, ", %ld reused", st->files_reused);
        printf("indexed %ld file%s (%ld unchanged, %ld removed, %ld skipped%s) "
               "in %ldms — %ld symbols, %ld refs, %ld routes, %ld comments, "
               "%ld soft [%d workers%s]\n",
               st->files_indexed, st->files_indexed == 1 ? "" : "s",
               st->files_seen - st->files_indexed - st->files_skipped,
               st->files_removed, st->files_skipped, reused, st->ms,
               st->symbols, st->refs, st->routes, st->anchors, st->soft,
               st->workers, st->passes > 1 ? ", drained" : "");
        if (st->tri_repaired)                    /* codify-v15 1.5 */
            printf("%ld trigram row%s repaired\n", st->tri_repaired,
                   st->tri_repaired == 1 ? "" : "s");
    }
}

int cg_index_ex(Cg *cg, const SysInfo *si, const IndexOpts *o, IndexStats *st) {
    long t0 = now_ms();
    memset(st, 0, sizeof *st);
    lang_global_init();
    if (o->background) syncgate_background_nice();
    progress_begin(o);

    /* rows are written under the branch; without a registered one (the
     * database was busy at open) there is nothing correct to write */
    if (cg->branch_id <= 0 && cg_branch_resolve(cg) != 0) {
        st->busy = true;
        st->ms = now_ms() - t0;
        index_report(st, o);
        return -1;
    }
    char key[64];
    if (index_is_fresh(cg, o->max_age_ms)) {
        cg_bkey(cg, "last_index_at", key, sizeof key);
        char *at = cg_meta_get(cg, key);
        st->fresh = true;
        st->ms = at ? now_ms() - atol(at) : 0;
        free(at);
        index_report(st, o);
        return 0;
    }

    long wait = o->lock_wait_ms < 0 ? cg->lock_wait_ms : o->lock_wait_ms;
    int gate = syncgate_acquire(cg, wait);
    if (gate < 0) {
        /* someone else is walking: leave the note and go. Its drain picks
         * the note up before it releases; if it already passed that point
         * the note keeps the graph from looking fresh until the next pass. */
        syncgate_mark_dirty(cg, o->paths, o->npaths);
        st->coalesced = true;
        st->ms = now_ms() - t0;
        index_report(st, o);
        return 0;
    }

    /* what earlier losers queued while we waited */
    char *note = syncgate_take_dirty(cg);
    if (!note && index_is_fresh(cg, o->max_age_ms)) {
        cg_bkey(cg, "last_index_at", key, sizeof key);
        char *at = cg_meta_get(cg, key);
        st->fresh = true;
        st->ms = at ? now_ms() - atol(at) : 0;
        free(at);
        syncgate_release(gate);
        index_report(st, o);
        return 0;
    }

    char pragma[128];
    snprintf(pragma, sizeof pragma, "PRAGMA cache_size=-%d;", si->db_cache_kb);
    cg_exec(cg, pragma);
    snprintf(pragma, sizeof pragma, "PRAGMA mmap_size=%ld;", si->mmap_bytes);
    cg_exec(cg, pragma);

    /* first pass: the caller's targets plus whatever the note names */
    char **targets = NULL;
    int ntargets = 0;
    bool whole = o->npaths <= 0;
    if (!whole) {
        for (int i = 0; i < o->npaths; i++) {
            char rel[4096];
            if (!target_rel(cg->root, o->paths[i], rel, sizeof rel)) continue;
            targets = xrealloc(targets, sizeof *targets * (size_t)(ntargets + 1));
            targets[ntargets++] = xstrdup(rel);
        }
        if (note) {
            char **nt = NULL;
            bool nwhole = false;
            int nn = note_targets(cg->root, note, &nt, &nwhole);
            if (nwhole) whole = true;
            for (int i = 0; i < nn; i++) {
                targets = xrealloc(targets, sizeof *targets * (size_t)(ntargets + 1));
                targets[ntargets++] = nt[i];
            }
            free(nt);
        }
    }
    free(note);

    /* codify-v15 1.3: a whole-tree pass on a large git tree takes its
     * candidates from git; the head is read before anything is walked, so
     * a commit made during the pass is diffed by the next one */
    char walk_head[65] = "", walk_branch[256];
    bool tree_pass = whole, gitpass = false;
    if (whole && git_head(cg->root, walk_branch, sizeof walk_branch,
                          walk_head, sizeof walk_head) &&
        index_git_plan(cg, o, walk_head, &targets, &ntargets)) {
        gitpass = true;
        whole = false;
    }
    st->walk = gitpass ? "git" : whole ? "full" : ntargets > 0 ? "targets"
             : "none";

    index_scope_begin(cg);
    long whole_at = 0;
    bool stalled = false;
    /* every named path was outside the project: nothing to walk, and no
     * reason to fall back to the whole tree the caller did not ask for */
    for (int pass = 0; pass < 3 && (whole || ntargets > 0 || gitpass); pass++) {
        long ps = now_ms();
        st->passes++;
        if (whole || (gitpass && pass == 0)) whole_at = ps;
        if (index_pass(cg, si, o, whole ? NULL : targets, ntargets, st) != 0) {
            stalled = true;
            break;
        }
        if (gitpass && pass == 0) {
            /* the tree's count, as a walk would have seen it */
            char sql[96];
            snprintf(sql, sizeof sql,
                     "SELECT count(*) FROM files WHERE branch_id=%ld",
                     cg->branch_id);
            st->files_seen = count_sql(cg, sql) + st->files_skipped;
        }
        targets_free(targets, ntargets);
        targets = NULL; ntargets = 0;
        /* a note left while we walked: an agent wrote during the pass.
         * Drain it now rather than leave it for a fourth process. Three
         * passes bound the loop; anything after that stays queued. */
        if (pass == 2) break;
        char *more = syncgate_take_dirty(cg);
        if (!more) break;
        ntargets = note_targets(cg->root, more, &targets, &whole);
        free(more);
        if (!whole && ntargets == 0) break;
    }
    targets_free(targets, ntargets);
    /* codify-v15 1.5: a whole walk also puts back missing body_tri rows */
    if (!stalled && whole_at > 0) index_tri_repair(cg, &st->tri_repaired);

    /* Chunks committed before a stall carry unresolved refs and edges. The
     * pending flag makes the next successful index finish that work even
     * when no file has changed since. */
    char pkey[64];
    cg_bkey(cg, "index_pending_resolve", pkey, sizeof pkey);
    char *pending = cg_meta_get(cg, pkey);
    bool need_resolve = st->files_indexed + st->files_removed > 0 ||
                        (pending && pending[0] == '1');
    bool recover = pending && pending[0] == '1';
    free(pending);
    if (!stalled && need_resolve) {
        progress_workers(0);
        progress_phase("resolving references", 0, 3);
        progress_flush();               /* long and silent: draw it now */
        if (progress_begin_write(cg) != 0) {
            stalled = true;
        } else {
            long ts = now_ms();
            if (o->full || recover || !index_scope_bounded(cg)) {
                anchor_edges(cg, st);
                index_phase_ms(st, IDX_PH_SOFT, ts);
                ts = now_ms();
                progress_tick(1, 3, NULL);
                resolve_imports(cg);
                progress_tick(2, 3, NULL);
                resolve_refs(cg);
            } else {
                st->scoped = true;
                anchor_edges_scoped(cg, st);
                index_phase_ms(st, IDX_PH_SOFT, ts);
                ts = now_ms();
                progress_tick(1, 3, NULL);
                resolve_imports_scoped(cg);
                progress_tick(2, 3, NULL);
                resolve_refs_scoped(cg);
            }
            index_phase_ms(st, IDX_PH_RESOLVE, ts);
            progress_tick(3, 3, NULL);
            bool full_sem = o->full || recover || !st->scoped;
            long *changed = NULL;
            int nchanged = 0;
            if (!full_sem) {
                sqlite3_stmt *q = cg_prep(cg,
                    "SELECT id FROM temp.scope_files ORDER BY id");
                while (sqlite3_step(q) == SQLITE_ROW) {
                    changed = xrealloc(changed,
                        sizeof *changed * (size_t)(nchanged + 1));
                    changed[nchanged++] = sqlite3_column_int64(q, 0);
                }
                sqlite3_finalize(q);
            }
            int sem_rc = sem_pass_run(cg, full_sem ? NULL : changed, nchanged);
            free(changed);
            if (sem_rc == 0) {
                index_health_finish(cg);
                cg_meta_set(cg, pkey, "0");
                cg_exec(cg, "COMMIT");
            } else {
                cg_exec(cg, "ROLLBACK");
                stalled = true;
            }
        }
    }
    index_scope_end(cg);
    st->busy = stalled;
    st->ms = now_ms() - t0;
    progress_workers(0);
    progress_phase("finishing", 0, 0);

    /* a stalled run leaves the bookkeeping alone: every write below would
     * wait on the same lock, and the numbers would describe a partial pass */
    char buf[64];
    if (stalled) {
        if (st->files_indexed > 0)
            cg_meta_set(cg, pkey, "1");
    } else {
        snprintf(buf, sizeof buf, "%ld", st->ms);
        cg_bkey(cg, "last_index_ms", key, sizeof key);
        cg_meta_set(cg, key, buf);
        snprintf(buf, sizeof buf, "%ld", st->bytes);
        cg_bkey(cg, "last_index_bytes", key, sizeof key);
        cg_meta_set(cg, key, buf);
        if (whole_at > 0) {
            /* the walk's start, not its end: a file written while the walk
             * ran may have been passed already, and must not hide behind
             * a freshness window that begins after it */
            snprintf(buf, sizeof buf, "%ld", whole_at);
            cg_bkey(cg, "last_index_at", key, sizeof key);
            cg_meta_set(cg, key, buf);
            snprintf(buf, sizeof buf, "%ld", st->files_seen);
            cg_bkey(cg, "project_files", key, sizeof key);
            cg_meta_set(cg, key, buf);
        }
        if (tree_pass) index_git_record(cg, walk_head, gitpass);
        /* the registry says where this branch was last indexed from and
         * at which commit; readers of cg branches see it move */
        branch_register(cg, cg->branch, cg->root, cg->head, NULL);
    }
    syncgate_release(gate);
    st->peak_rss_kb = index_peak_rss_kb();
    index_report(st, o);
    return stalled ? -1 : 0;
}

int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet) {
    IndexOpts o = {0};
    o.full = full;
    o.lock_wait_ms = -1;
    o.quiet = quiet;
    return cg_index_ex(cg, si, &o, st);
}
