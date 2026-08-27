/*
 * Indexing pipeline: walk -> parallel parse workers -> single DB writer.
 * Worker count comes from sysinfo (container-aware cores, available RAM).
 * Bounded ring buffer keeps memory flat on huge repos.
 */
#include "cg.h"
#include <dirent.h>
#include <pthread.h>
#include <stdatomic.h>
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
                 *ins_route, *ins_body, *del_imports, *ins_import;
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
    s->ins_ref    = cg_prep(cg, "INSERT INTO refs(file_id,name,line,sym_id,qual,kind)"
                                " VALUES(?,?,?,?,?,?)");
    s->ins_route  = cg_prep(cg, "INSERT INTO routes(file_id,framework,method,pattern,handler,line)"
                                " VALUES(?,?,?,?,?,?)");
    s->ins_body   = cg_prep(cg, "INSERT INTO body_fts(rowid,path,body) VALUES(?,?,?)");
    s->del_imports= cg_prep(cg, "DELETE FROM imports WHERE file_id=?");
    s->ins_import = cg_prep(cg, "INSERT INTO imports(file_id,name,module,line)"
                                " VALUES(?,?,?,?)");
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
            step_reset(s->ins_ref);
            st->refs++;
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
            step_reset(s->ins_import);
        }
    }

    if (d->body) {
        sqlite3_bind_int64(s->ins_body, 1, file_id);
        sqlite3_bind_text (s->ins_body, 2, w->rel, -1, SQLITE_STATIC);
        sqlite3_bind_text (s->ins_body, 3, d->body, (int)d->body_len, SQLITE_STATIC);
        step_reset(s->ins_body);
    }
    st->files_indexed++;
    st->bytes += w->size;
}

/* ---------------- top level ---------------- */

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
               "in %ldms — %ld symbols, %ld refs, %ld routes [%d workers]\n",
               st->files_indexed, st->files_indexed == 1 ? "" : "s",
               st->files_seen - st->files_indexed - st->files_skipped,
               st->files_removed, st->files_skipped, st->ms,
               st->symbols, st->refs, st->routes, si->workers);
    }
    return 0;
}
