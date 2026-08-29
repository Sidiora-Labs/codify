/*
 * Indexing pipeline: walk -> parallel parse workers -> single DB writer.
 * Worker count comes from sysinfo (container-aware cores, available RAM).
 * Bounded ring buffer keeps memory flat on huge repos.
 */
#include "cg.h"
#include <dirent.h>
#include <pthread.h>
#include <stdatomic.h>
#include <ctype.h>
#include <sys/stat.h>

#define MAX_FILE_BYTES (8L * 1024 * 1024)   /* larger files: skip entirely */
#define MAX_FTS_BYTES  (2L * 1024 * 1024)   /* larger: no body full-text */
#define RING_CAP 256

typedef struct { char *rel; long size, mtime; char dbhash[65]; } Walked;
typedef struct { char *path; long id, size, mtime; char hash[65]; } DbFile;

typedef struct {
    int idx;                 /* -1 = skipped (binary/unreadable/too big) */
    char hash[65];
    char *body;              /* NULL if not keeping body */
    size_t body_len;
    ParseResult pr;
    bool parsed;
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
    wl->n++;
}

static void walk_dir(const char *root, const char *rel, const Ignore *ig,
                     WalkList *wl) {
    char abs[4600];
    snprintf(abs, sizeof abs, "%s/%s", root, rel[0] ? rel : ".");
    DIR *d = opendir(abs);
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0)
            continue;
        char crel[4096];
        if (rel[0]) snprintf(crel, sizeof crel, "%s/%s", rel, e->d_name);
        else        snprintf(crel, sizeof crel, "%s", e->d_name);
        char cabs[4900];
        snprintf(cabs, sizeof cabs, "%s/%s", root, crel);
        struct stat st;
        if (lstat(cabs, &st) != 0) continue;
        if (S_ISLNK(st.st_mode)) continue;
        bool isdir = S_ISDIR(st.st_mode);
        if (ignore_match(ig, crel, isdir)) continue;
        if (isdir) walk_dir(root, crel, ig, wl);
        else if (S_ISREG(st.st_mode) && st.st_size <= MAX_FILE_BYTES)
            walk_push(wl, crel, (long)st.st_size, (long)st.st_mtime);
    }
    closedir(d);
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

        char abs[4900];
        snprintf(abs, sizeof abs, "%s/%s", p->root, p->jobs[i].rel);
        size_t len = 0;
        char *data = read_entire_file(abs, &len);
        if (!data || looks_binary(data, len)) {
            free(data);
            d.idx = -1;
            ring_push(p, &d);
            continue;
        }
        sha256_hex(data, len, d.hash);
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
                 *sel_docs;
} Stmts;

static void stmts_init(Cg *cg, Stmts *s) {
    s->up_file = cg_prep(cg,
        "INSERT INTO files(path,lang,size,mtime,hash,lines) VALUES(?,?,?,?,?,?) "
        "ON CONFLICT(path) DO UPDATE SET lang=excluded.lang,size=excluded.size,"
        "mtime=excluded.mtime,hash=excluded.hash,lines=excluded.lines");
    s->sel_file   = cg_prep(cg, "SELECT id FROM files WHERE path=?");
    s->del_symfts = cg_prep(cg, "DELETE FROM symbol_fts WHERE rowid IN "
                                "(SELECT id FROM symbols WHERE file_id=?)");
    s->del_syms   = cg_prep(cg, "DELETE FROM symbols WHERE file_id=?");
    s->del_refs   = cg_prep(cg, "DELETE FROM refs WHERE file_id=?");
    s->del_routes = cg_prep(cg, "DELETE FROM routes WHERE file_id=?");
    s->del_body   = cg_prep(cg, "DELETE FROM body_fts WHERE rowid=?");
    s->ins_sym    = cg_prep(cg, "INSERT INTO symbols(file_id,name,kind,line,end_line,sig)"
                                " VALUES(?,?,?,?,?,?)");
    s->ins_symfts = cg_prep(cg, "INSERT INTO symbol_fts(rowid,name,kind,path,sig)"
                                " VALUES(?,?,?,?,?)");
    s->ins_ref    = cg_prep(cg, "INSERT INTO refs(file_id,name,line,sym_id,qual,kind,argc)"
                                " VALUES(?,?,?,?,?,?,?)");
    s->ins_route  = cg_prep(cg, "INSERT INTO routes(file_id,framework,method,pattern,handler,line)"
                                " VALUES(?,?,?,?,?,?)");
    s->ins_body   = cg_prep(cg, "INSERT INTO body_fts(rowid,path,body) VALUES(?,?,?)");
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
}

static void stmts_fin(Stmts *s) {
    sqlite3_stmt **all = (sqlite3_stmt **)s;
    for (size_t i = 0; i < sizeof(Stmts) / sizeof(sqlite3_stmt *); i++)
        sqlite3_finalize(all[i]);
}

static void step_reset(sqlite3_stmt *st) {
    sqlite3_step(st);
    sqlite3_reset(st);
    sqlite3_clear_bindings(st);
}

static void purge_file_children(Stmts *s, long file_id) {
    sqlite3_bind_int64(s->del_symfts, 1, file_id); step_reset(s->del_symfts);
    sqlite3_bind_int64(s->del_syms,   1, file_id); step_reset(s->del_syms);
    sqlite3_bind_int64(s->del_refs,   1, file_id); step_reset(s->del_refs);
    sqlite3_bind_int64(s->del_routes, 1, file_id); step_reset(s->del_routes);
    sqlite3_bind_int64(s->del_body,   1, file_id); step_reset(s->del_body);
    sqlite3_bind_int64(s->del_imports,1, file_id); step_reset(s->del_imports);
    sqlite3_bind_int64(s->del_cmtfts, 1, file_id); step_reset(s->del_cmtfts);
    sqlite3_bind_int64(s->del_cmts,   1, file_id); step_reset(s->del_cmts);
}

static void write_done(Cg *cg, Stmts *s, const Walked *w, Done *d,
                       IndexStats *st) {
    const char *lang = lang_for_path(w->rel);
    sqlite3_bind_text (s->up_file, 1, w->rel, -1, SQLITE_STATIC);
    if (lang) sqlite3_bind_text(s->up_file, 2, lang, -1, SQLITE_STATIC);
    else      sqlite3_bind_null(s->up_file, 2);
    sqlite3_bind_int64(s->up_file, 3, w->size);
    sqlite3_bind_int64(s->up_file, 4, w->mtime);
    sqlite3_bind_text (s->up_file, 5, d->hash, -1, SQLITE_STATIC);
    sqlite3_bind_int64(s->up_file, 6, d->pr.nlines);
    step_reset(s->up_file);

    sqlite3_bind_text(s->sel_file, 1, w->rel, -1, SQLITE_STATIC);
    long file_id = 0;
    if (sqlite3_step(s->sel_file) == SQLITE_ROW)
        file_id = sqlite3_column_int64(s->sel_file, 0);
    sqlite3_reset(s->sel_file);
    sqlite3_clear_bindings(s->sel_file);
    if (!file_id) return;

    /* size/mtime changed but content did not (touch, branch switch): the
     * upsert above refreshed the metadata; keep the child rows — and with
     * them, stable symbol rowids. */
    if (w->dbhash[0] && strcmp(w->dbhash, d->hash) == 0) return;

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

    purge_file_children(s, file_id);

    if (d->parsed) {
        ParseResult *pr = &d->pr;
        long *rowids = pr->ndefs ? xmalloc(sizeof(long) * (size_t)pr->ndefs) : NULL;
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
            step_reset(s->ins_sym);
            rowids[i] = sqlite3_last_insert_rowid(cg->db);

            sqlite3_bind_int64(s->ins_symfts, 1, rowids[i]);
            sqlite3_bind_text (s->ins_symfts, 2, pr->defs[i].name, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_symfts, 3, pr->defs[i].kind, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_symfts, 4, w->rel, -1, SQLITE_STATIC);
            sqlite3_bind_text (s->ins_symfts, 5, pr->defs[i].sig, -1, SQLITE_STATIC);
            step_reset(s->ins_symfts);
            st->symbols++;
        }
        /* enclosing symbol for each ref: innermost def whose span contains
         * the ref line, preferring callable kinds; refs contained by no def
         * stay NULL — top-level code is not somebody's call site */
        for (int i = 0; i < pr->nrefs; i++) {
            int best = -1, best_fn = -1;
            for (int dj = 0;
                 dj < pr->ndefs && pr->defs[dj].line <= pr->refs[i].line; dj++) {
                if (ends[dj] < pr->refs[i].line) continue;
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
                    if (ends[dj] < c->line) continue;
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
        free(rowids);
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
    }
    for (int i = 0; i < noldd; i++) { free(oldd[i].body); free(oldd[i].hash); }
    free(oldd);
    st->files_indexed++;
    st->bytes += w->size;
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
    bool hit = sqlite3_step(st) == SQLITE_ROW;
    if (hit && out) {
        const char *p = (const char *)sqlite3_column_text(st, 0);
        snprintf(out, cap, "%s", p ? p : tok);
    }
    sqlite3_reset(st);
    return hit;
}

/* Rebuild refs kind='soft' from anchor comments (kind file and doc).
 * Runs once after the scan completes so existence checks see the whole
 * tree — checking at write time would make edges depend on file order.
 * A token becomes an edge only when it resolves to a symbol, a file, or
 * a route that exists; everything else is silence (req 4.4). */
static void anchor_edges(Cg *cg, IndexStats *st) {
    cg_exec(cg, "DELETE FROM refs WHERE kind='soft'");
    sqlite3_stmt *sel = cg_prep(cg,
        "SELECT c.file_id, c.line, c.sym_id, c.body, coalesce(s.name,'') "
        "FROM comments c LEFT JOIN symbols s ON s.id=c.sym_id "
        "WHERE c.kind IN ('file','doc') ORDER BY c.file_id, c.line");
    sqlite3_stmt *ins = cg_prep(cg,
        "INSERT INTO refs(file_id,name,line,sym_id,qual,kind) "
        "VALUES(?,?,?,?,?,'soft')");
    sqlite3_stmt *is_sym = cg_prep(cg,
        "SELECT 1 FROM symbols WHERE name=? LIMIT 1");
    sqlite3_stmt *is_path = cg_prep(cg,
        "SELECT path FROM files WHERE path=?1 OR path LIKE '%/'||?1 LIMIT 1");
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
}

int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet) {
    long t0 = now_ms();
    memset(st, 0, sizeof *st);
    lang_global_init();

    char pragma[128];
    snprintf(pragma, sizeof pragma, "PRAGMA cache_size=-%d;", si->db_cache_kb);
    cg_exec(cg, pragma);
    snprintf(pragma, sizeof pragma, "PRAGMA mmap_size=%ld;", si->mmap_bytes);
    cg_exec(cg, pragma);

    Ignore ig;
    ignore_load(&ig, cg->root);
    WalkList wl = {0};
    walk_dir(cg->root, "", &ig, &wl);
    ignore_free(&ig);
    qsort(wl.v, (size_t)wl.n, sizeof(Walked), walked_cmp);
    st->files_seen = wl.n;

    /* current DB view */
    DbFile *dbf = NULL;
    int ndbf = 0, cdbf = 0;
    sqlite3_stmt *sel = cg_prep(cg, "SELECT id,path,size,mtime,hash FROM files");
    while (sqlite3_step(sel) == SQLITE_ROW) {
        if (ndbf == cdbf) {
            cdbf = cdbf ? cdbf * 2 : 256;
            dbf = xrealloc(dbf, sizeof(DbFile) * (size_t)cdbf);
        }
        dbf[ndbf].id    = sqlite3_column_int64(sel, 0);
        dbf[ndbf].path  = xstrdup((const char *)sqlite3_column_text(sel, 1));
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
            if (full || wl.v[wi].size != dbf[di].size ||
                wl.v[wi].mtime != dbf[di].mtime) {
                walk_push(&jobs, wl.v[wi].rel, wl.v[wi].size, wl.v[wi].mtime);
                /* remember the stored hash so unchanged content can skip the
                 * purge+reinsert; --full keeps its force-reparse meaning */
                if (!full)
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

    cg_exec(cg, "BEGIN");
    Stmts s;
    stmts_init(cg, &s);

    sqlite3_stmt *del_file = cg_prep(cg, "DELETE FROM files WHERE id=?");
    for (int i = 0; i < nremoved; i++) {
        purge_file_children(&s, removed_ids[i]);
        sqlite3_bind_int64(del_file, 1, removed_ids[i]);
        step_reset(del_file);
        st->files_removed++;
    }
    sqlite3_finalize(del_file);
    free(removed_ids);

    if (jobs.n > 0) {
        Pipe pipe;
        memset(&pipe, 0, sizeof pipe);
        pipe.root = cg->root;
        pipe.jobs = jobs.v;
        pipe.njobs = jobs.n;
        atomic_init(&pipe.next, 0);
        pthread_mutex_init(&pipe.mu, NULL);
        pthread_cond_init(&pipe.can_push, NULL);
        pthread_cond_init(&pipe.can_pop, NULL);

        int nw = si->workers;
        if (nw > jobs.n) nw = jobs.n;
        if (nw < 1) nw = 1;
        pipe.producers_left = nw;
        pthread_t th[16];
        for (int i = 0; i < nw; i++)
            pthread_create(&th[i], NULL, worker, &pipe);

        Done d;
        while (ring_pop(&pipe, &d)) {
            if (d.idx < 0) {
                st->files_skipped++;
            } else {
                write_done(cg, &s, &jobs.v[d.idx], &d, st);
                if (d.parsed) parse_result_free(&d.pr);
                free(d.body);
            }
        }
        for (int i = 0; i < nw; i++)
            pthread_join(th[i], NULL);
        pthread_mutex_destroy(&pipe.mu);
        pthread_cond_destroy(&pipe.can_push);
        pthread_cond_destroy(&pipe.can_pop);
    }

    stmts_fin(&s);
    if (st->files_indexed + st->files_removed > 0) {
        anchor_edges(cg, st);
        resolve_imports(cg);
        resolve_refs(cg);
    }
    cg_exec(cg, "COMMIT");

    st->ms = now_ms() - t0;

    char buf[64];
    snprintf(buf, sizeof buf, "%ld", st->ms);
    cg_meta_set(cg, "last_index_ms", buf);
    snprintf(buf, sizeof buf, "%ld", (long)wl.n);
    cg_meta_set(cg, "project_files", buf);
    snprintf(buf, sizeof buf, "%ld", st->bytes);
    cg_meta_set(cg, "last_index_bytes", buf);

    for (int i = 0; i < wl.n; i++) free(wl.v[i].rel);
    free(wl.v);
    for (int i = 0; i < jobs.n; i++) free(jobs.v[i].rel);
    free(jobs.v);
    for (int i = 0; i < ndbf; i++) free(dbf[i].path);
    free(dbf);

    if (!quiet) {
        printf("indexed %ld file%s (%ld unchanged, %ld removed, %ld skipped) "
               "in %ldms — %ld symbols, %ld refs, %ld routes, %ld comments, "
               "%ld soft [%d workers]\n",
               st->files_indexed, st->files_indexed == 1 ? "" : "s",
               st->files_seen - st->files_indexed - st->files_skipped,
               st->files_removed, st->files_skipped, st->ms,
               st->symbols, st->refs, st->routes, st->anchors, st->soft,
               si->workers);
    }
    return 0;
}
