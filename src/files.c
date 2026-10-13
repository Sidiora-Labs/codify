/*
 * cg files — finding files by glob, by the words of their path, or by
 * directory, answered from the files table and file_fts; and the shared
 * QueryFilter (--path, --lang, --no-tests) that search, context, survey,
 * grep and files all narrow by.
 *
 * Contract: every read here is scoped to the branch in scope through
 * branch_scope_sql and narrowed by the filter inside the SQL, so a narrowed
 * query never scans more rows than the wide one. file_fts holds
 * name_words(path) under the trigram tokenizer, rowid = files.id; scan.c
 * writes it beside the files row.
 */
#include "cg.h"
#include <ctype.h>
#include <fnmatch.h>

/* ---------------- the shared filter ---------------- */

static bool has_glob(const char *s) { return strpbrk(s, "*?[") != NULL; }

/* "py", "ts", "h" → the files.lang spelling; a lang name stays as given */
static void lang_normalise(const char *in, char *out, size_t cap) {
    char probe[64];
    snprintf(probe, sizeof probe, "x.%s", in);
    const char *l = lang_for_path(probe);
    snprintf(out, cap, "%s", l && !strchr(in, '.') ? l : in);
    for (char *p = out; *p; p++) *p = (char)tolower((unsigned char)*p);
}

static void qf_add_path(QueryFilter *f, const char *p) {
    if (f->npaths >= QF_MAX_PATHS || !p[0]) return;
    while (p[0] == '.' && p[1] == '/') p += 2;
    snprintf(f->paths[f->npaths++], sizeof f->paths[0], "%s", p);
}

int query_filter_parse(int *argc, char **argv, QueryFilter *f) {
    memset(f, 0, sizeof *f);
    int w = 1;
    for (int i = 1; i < *argc; i++) {
        const char *a = argv[i];
        const char *val = NULL;
        int kind = 0;                         /* 1 path, 2 lang */
        if (strcmp(a, "--no-tests") == 0) { f->no_tests = true; continue; }
        if (strcmp(a, "--path") == 0 || strcmp(a, "--lang") == 0) {
            kind = a[2] == 'p' ? 1 : 2;
            if (i + 1 >= *argc) {
                fprintf(stderr, "cg: %s needs a value\n", a);
                return -1;
            }
            val = argv[++i];
        } else if (strncmp(a, "--path=", 7) == 0) {
            kind = 1; val = a + 7;
        } else if (strncmp(a, "--lang=", 7) == 0) {
            kind = 2; val = a + 7;
        }
        if (kind == 1) { qf_add_path(f, val); continue; }
        if (kind == 2) { lang_normalise(val, f->lang, sizeof f->lang); continue; }
        argv[w++] = argv[i];
    }
    *argc = w;
    return 0;
}

bool query_filter_active(const QueryFilter *f) {
    return f && (f->npaths > 0 || f->lang[0] || f->no_tests);
}

/* One --path value as GLOB patterns over the path column. `**` folds into
 * `*`, which already crosses `/` in GLOB and fnmatch without FNM_PATHNAME;
 * a plain path is itself or anything under it; a slashless glob also
 * matches a basename at any depth. At most two patterns per value. */
static int qf_globs(const char *in, char out[2][1100], bool *exact) {
    char p[1024];
    size_t o = 0;
    for (const char *s = in; *s && o + 1 < sizeof p; s++) {
        if (s[0] == '*' && s[1] == '*') {
            s++;
            if (s[1] == '/') s++;
            p[o++] = '*';
            continue;
        }
        p[o++] = *s;
    }
    p[o] = 0;
    *exact = false;
    if (!has_glob(p)) {
        while (o > 1 && p[o - 1] == '/') p[--o] = 0;
        snprintf(out[0], 1100, "%s", p);           /* the file itself */
        snprintf(out[1], 1100, "%s/*", p);         /* or under the dir */
        *exact = true;
        return 2;
    }
    if (o && p[o - 1] == '/') snprintf(out[0], 1100, "%s*", p);
    else snprintf(out[0], 1100, "%s", p);
    if (!strchr(p, '/')) {
        snprintf(out[1], 1100, "*/%s%s", p, o && p[o - 1] == '/' ? "*" : "");
        return 2;
    }
    return 1;
}

char *query_filter_sql(const QueryFilter *f, const char *alias) {
    StrBuf b; sb_init(&b);
    if (!query_filter_active(f)) { sb_puts(&b, ""); return b.p; }
    const char *a = alias && alias[0] ? alias : "f";
    if (f->npaths) {
        sb_puts(&b, " AND (");
        for (int i = 0; i < f->npaths; i++) {
            char g[2][1100];
            bool exact;
            int n = qf_globs(f->paths[i], g, &exact);
            for (int k = 0; k < n; k++) {
                char *q = exact && k == 0
                    ? sqlite3_mprintf("%s.path=%Q", a, g[k])
                    : sqlite3_mprintf("%s.path GLOB %Q", a, g[k]);
                sb_printf(&b, "%s%s", i || k ? " OR " : "", q);
                sqlite3_free(q);
            }
        }
        sb_putc(&b, ')');
    }
    if (f->lang[0]) {
        char *q = sqlite3_mprintf(" AND %s.lang=%Q COLLATE NOCASE", a, f->lang);
        sb_puts(&b, q);
        sqlite3_free(q);
    }
    if (f->no_tests) sb_printf(&b, " AND NOT cg_is_test(%s.path)", a);
    sb_putc(&b, ' ');
    return b.p;
}

bool query_filter_match(const QueryFilter *f, const char *path,
                        const char *lang) {
    if (!query_filter_active(f)) return true;
    if (f->lang[0] && (!lang || strcasecmp(lang, f->lang) != 0)) return false;
    if (f->no_tests && graph_path_is_test(path)) return false;
    if (!f->npaths) return true;
    for (int i = 0; i < f->npaths; i++) {
        char g[2][1100];
        bool exact;
        int n = qf_globs(f->paths[i], g, &exact);
        for (int k = 0; k < n; k++) {
            if (exact && k == 0 ? strcmp(path, g[k]) == 0
                                : fnmatch(g[k], path, 0) == 0)
                return true;
        }
    }
    return false;
}

static void sql_is_test(sqlite3_context *ctx, int argc, sqlite3_value **argv) {
    (void)argc;
    const char *p = (const char *)sqlite3_value_text(argv[0]);
    sqlite3_result_int(ctx, p && graph_path_is_test(p) ? 1 : 0);
}

void query_filter_register(sqlite3 *db) {
    sqlite3_create_function(db, "cg_is_test", 1,
                            SQLITE_UTF8 | SQLITE_DETERMINISTIC, NULL,
                            sql_is_test, NULL, NULL);
}

static __thread const Cg *qf_owner;
static __thread QueryFilter qf_cur;

void cg_filter_set(Cg *cg, const QueryFilter *f) {
    if (!query_filter_active(f)) { qf_owner = NULL; return; }
    qf_cur = *f;
    qf_owner = cg;
    if (cg && cg->db) query_filter_register(cg->db);
}

const QueryFilter *cg_filter_get(const Cg *cg) {
    return cg && qf_owner == cg ? &qf_cur : NULL;
}

/* ---------------- cg files ---------------- */

typedef struct {
    long id;
    char *path;
    char lang[32];
    long lines;
    int score;            /* match quality, higher first */
} FileRow;

static int filerow_cmp(const void *a, const void *b) {
    const FileRow *x = a, *y = b;
    if (x->score != y->score) return y->score - x->score;
    return strcmp(x->path, y->path);
}

/* the scoped, filtered statement: head ends inside a WHERE clause */
static sqlite3_stmt *files_prep(Cg *cg, const QueryFilter *f,
                                const char *head, const char *tail) {
    char scope[64];
    branch_scope_sql(cg, "f", scope, sizeof scope);
    char *flt = query_filter_sql(f, "f");
    StrBuf b; sb_init(&b);
    sb_printf(&b, "%s%s%s%s", head, scope, flt, tail);
    free(flt);
    if (query_filter_active(f)) query_filter_register(cg->db);
    sqlite3_stmt *st = cg_prep(cg, b.p);
    sb_free(&b);
    return st;
}

static void rows_push(FileRow **v, int *n, int *c, sqlite3_stmt *st) {
    if (*n == *c) {
        *c = *c ? *c * 2 : 256;
        *v = xrealloc(*v, sizeof **v * (size_t)*c);
    }
    FileRow *r = &(*v)[(*n)++];
    r->id = sqlite3_column_int64(st, 0);
    r->path = xstrdup((const char *)sqlite3_column_text(st, 1));
    const char *l = (const char *)sqlite3_column_text(st, 2);
    snprintf(r->lang, sizeof r->lang, "%s", l ? l : "");
    r->lines = sqlite3_column_int64(st, 3);
    r->score = 0;
}

#define FILE_COLS "f.id, f.path, f.lang, ifnull(f.lines,0)"

/* Words mode quality: per query word, a whole word of the basename (3)
 * over a piece of one (2) over a directory segment (1); a path that
 * carries every word in its basename leads. */
static int words_score(const char *path, char terms[][64], int nt) {
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    char bw[1024], dw[2048], dir[2048];
    name_words(base, bw, sizeof bw);
    snprintf(dir, sizeof dir, "%.*s", (int)(base - path), path);
    name_words(dir, dw, sizeof dw);
    int s = 0, inbase = 0;
    for (int i = 0; i < nt; i++) {
        size_t tl = strlen(terms[i]);
        int best = 0;
        for (const char *p = bw; *p; ) {
            const char *e = strchr(p, ' ');
            size_t wl = e ? (size_t)(e - p) : strlen(p);
            if (wl == tl && strncmp(p, terms[i], tl) == 0) best = 3;
            if (!e) break;
            p = e + 1;
        }
        if (!best && strstr(bw, terms[i])) best = 2;
        if (!best && strstr(dw, terms[i])) best = 1;
        if (best >= 2) inbase++;
        s += best;
    }
    if (inbase == nt) s += 4;
    return s;
}

static void print_rows(Cg *cg, FileRow *v, int n, int limit, bool json,
                       StrBuf *b) {
    sqlite3_stmt *sc = cg_prep(cg,
        "SELECT COUNT(*) FROM symbols WHERE file_id=? AND decl=0");
    int shown = n < limit ? n : limit;
    for (int i = 0; i < shown; i++) {
        sqlite3_bind_int64(sc, 1, v[i].id);
        int ns = sqlite3_step(sc) == SQLITE_ROW ? sqlite3_column_int(sc, 0) : 0;
        sqlite3_reset(sc);
        if (json) {
            if (i) sb_putc(b, ',');
            sb_puts(b, "{\"path\":"); sb_json_str(b, v[i].path);
            sb_puts(b, ",\"lang\":");
            if (v[i].lang[0]) sb_json_str(b, v[i].lang); else sb_puts(b, "null");
            sb_printf(b, ",\"lines\":%ld,\"symbols\":%d}", v[i].lines, ns);
        } else {
            sb_printf(b, "%-48s %-10s %6ld lines %4d sym\n", v[i].path,
                      v[i].lang[0] ? v[i].lang : "-", v[i].lines, ns);
        }
    }
    sqlite3_finalize(sc);
}

/* a bare directory: its subdirectories with counts, then its own files */
typedef struct { char name[512]; int files; long lines; } SubDir;

static int subdir_cmp(const void *a, const void *b) {
    return strcmp(((const SubDir *)a)->name, ((const SubDir *)b)->name);
}

static int files_dir(Cg *cg, const QueryFilter *f, const char *dir,
                     int limit, bool json) {
    char pre[1100];
    snprintf(pre, sizeof pre, "%s%s", dir, dir[0] ? "/" : "");
    sqlite3_stmt *st = files_prep(cg, f,
        "SELECT " FILE_COLS " FROM files f WHERE substr(f.path,1,?2)=?1",
        " ORDER BY f.path");
    sqlite3_bind_text(st, 1, pre, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, (int)strlen(pre));
    FileRow *v = NULL;
    int n = 0, c = 0, total = 0;
    SubDir *sd = NULL;
    int nsd = 0, csd = 0;
    size_t pl = strlen(pre);
    while (sqlite3_step(st) == SQLITE_ROW) {
        total++;
        const char *p = (const char *)sqlite3_column_text(st, 1);
        const char *rest = p + pl;
        const char *slash = strchr(rest, '/');
        if (!slash) { rows_push(&v, &n, &c, st); continue; }
        size_t l = (size_t)(slash - rest);
        if (!nsd || strlen(sd[nsd - 1].name) != l ||
            strncmp(sd[nsd - 1].name, rest, l) != 0) {
            if (nsd == csd) {
                csd = csd ? csd * 2 : 32;
                sd = xrealloc(sd, sizeof *sd * (size_t)csd);
            }
            snprintf(sd[nsd].name, sizeof sd[0].name, "%.*s", (int)l, rest);
            sd[nsd].files = 0;
            sd[nsd].lines = 0;
            nsd++;
        }
        sd[nsd - 1].files++;
        sd[nsd - 1].lines += sqlite3_column_int64(st, 3);
    }
    sqlite3_finalize(st);
    if (total == 0) { free(v); free(sd); return -1; }
    qsort(sd, (size_t)nsd, sizeof *sd, subdir_cmp);

    StrBuf b; sb_init(&b);
    int sdshown = nsd < limit ? nsd : limit;
    int room = limit - sdshown;
    int fshown = n < room ? n : room;
    int omitted = (nsd - sdshown) + (n - fshown);
    if (json) {
        sb_puts(&b, "{\"mode\":\"dir\",\"path\":");
        sb_json_str(&b, dir);
        sb_puts(&b, ",\"dirs\":[");
        for (int i = 0; i < sdshown; i++) {
            char full[1100];
            snprintf(full, sizeof full, "%s%s", pre, sd[i].name);
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"path\":"); sb_json_str(&b, full);
            sb_printf(&b, ",\"files\":%d,\"lines\":%ld}", sd[i].files,
                      sd[i].lines);
        }
        sb_puts(&b, "],\"files\":[");
        print_rows(cg, v, n, fshown, true, &b);
        sb_printf(&b, "],\"total\":%d,\"omitted\":%d}\n", total, omitted);
    } else {
        sb_printf(&b, "%s — %d file%s below\n", dir[0] ? pre : "./", total,
                  total == 1 ? "" : "s");
        for (int i = 0; i < sdshown; i++) {
            char full[1100];
            snprintf(full, sizeof full, "%s%s/", pre, sd[i].name);
            sb_printf(&b, "%-48s %-10s %6ld lines %4d files\n", full, "dir",
                      sd[i].lines, sd[i].files);
        }
        print_rows(cg, v, n, fshown, false, &b);
        if (omitted)
            sb_printf(&b, "(+%d more entr%s omitted; -n %d shows more)\n",
                      omitted, omitted == 1 ? "y" : "ies", limit * 2);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    for (int i = 0; i < n; i++) free(v[i].path);
    free(v);
    free(sd);
    return 0;
}

/* ---------------- --dirs: the map ---------------- */

#define DLANGS 6
typedef struct {
    char *path;
    int depth, files;
    long lines;
    char lang[DLANGS][32];
    long llines[DLANGS];
    int parent;           /* index of the parent dir, -1 at the top */
} DirAgg;

typedef struct {
    DirAgg *v;
    int n, c;
    int *slot;            /* open addressing over v indexes, -1 empty */
    size_t cap;
} DirMap;

static size_t str_hash(const char *s, size_t n) {
    size_t h = 1469598103934665603ull;
    for (size_t i = 0; i < n; i++) { h ^= (unsigned char)s[i]; h *= 1099511628211ull; }
    return h;
}

static void dm_grow(DirMap *m) {
    size_t nc = m->cap ? m->cap * 2 : 1024;
    int *ns = xmalloc(sizeof(int) * nc);
    for (size_t i = 0; i < nc; i++) ns[i] = -1;
    for (int i = 0; i < m->n; i++) {
        size_t h = str_hash(m->v[i].path, strlen(m->v[i].path)) & (nc - 1);
        while (ns[h] >= 0) h = (h + 1) & (nc - 1);
        ns[h] = i;
    }
    free(m->slot);
    m->slot = ns;
    m->cap = nc;
}

static int dm_get(DirMap *m, const char *p, size_t len, int depth, int parent) {
    if ((size_t)(m->n + 1) * 2 > m->cap) dm_grow(m);
    size_t h = str_hash(p, len) & (m->cap - 1);
    while (m->slot[h] >= 0) {
        DirAgg *d = &m->v[m->slot[h]];
        if (strlen(d->path) == len && strncmp(d->path, p, len) == 0)
            return m->slot[h];
        h = (h + 1) & (m->cap - 1);
    }
    if (m->n == m->c) {
        m->c = m->c ? m->c * 2 : 256;
        m->v = xrealloc(m->v, sizeof *m->v * (size_t)m->c);
    }
    DirAgg *d = &m->v[m->n];
    memset(d, 0, sizeof *d);
    d->path = xmalloc(len + 1);
    memcpy(d->path, p, len);
    d->path[len] = 0;
    d->depth = depth;
    d->parent = parent;
    m->slot[h] = m->n;
    return m->n++;
}

static void dir_add_lang(DirAgg *d, const char *lang, long lines) {
    if (!lang || !lang[0]) return;
    for (int i = 0; i < DLANGS; i++) {
        if (!d->lang[i][0]) {
            snprintf(d->lang[i], sizeof d->lang[i], "%s", lang);
            d->llines[i] = lines;
            return;
        }
        if (strcmp(d->lang[i], lang) == 0) { d->llines[i] += lines; return; }
    }
}

static const char *dir_dominant(const DirAgg *d) {
    int best = -1;
    for (int i = 0; i < DLANGS && d->lang[i][0]; i++)
        if (best < 0 || d->llines[i] > d->llines[best]) best = i;
    return best < 0 ? "-" : d->lang[best];
}

static const DirMap *g_sort_map;
static int dirorder_cmp(const void *a, const void *b) {
    const DirAgg *x = &g_sort_map->v[*(const int *)a];
    const DirAgg *y = &g_sort_map->v[*(const int *)b];
    if (x->files != y->files) return y->files - x->files;
    if (x->lines != y->lines) return y->lines > x->lines ? 1 : -1;
    return strcmp(x->path, y->path);
}

/* depth-first, children largest first: the tree reads as a map */
static void dirs_emit(DirMap *m, int parent, int *order, int *no) {
    int *kids = NULL, nk = 0;
    for (int i = 0; i < m->n; i++)
        if (m->v[i].parent == parent) {
            kids = xrealloc(kids, sizeof(int) * (size_t)(nk + 1));
            kids[nk++] = i;
        }
    g_sort_map = m;
    qsort(kids, (size_t)nk, sizeof(int), dirorder_cmp);
    for (int i = 0; i < nk; i++) {
        order[(*no)++] = kids[i];
        dirs_emit(m, kids[i], order, no);
    }
    free(kids);
}

static int files_dirs(Cg *cg, const QueryFilter *f, const char *prefix,
                      int depth, int limit, bool json) {
    char pre[1100] = "";
    if (prefix && prefix[0]) {
        const char *p = prefix;
        while (p[0] == '.' && p[1] == '/') p += 2;
        snprintf(pre, sizeof pre, "%s", p);
        size_t l = strlen(pre);
        while (l && pre[l - 1] == '/') pre[--l] = 0;
        if (l) snprintf(pre + l, sizeof pre - l, "/");
    }
    sqlite3_stmt *st = files_prep(cg, f,
        "SELECT " FILE_COLS " FROM files f WHERE substr(f.path,1,?2)=?1", "");
    sqlite3_bind_text(st, 1, pre, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, (int)strlen(pre));
    DirMap m = {0};
    DirAgg top = {0};
    top.parent = -1;
    size_t pl = strlen(pre);
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *p = (const char *)sqlite3_column_text(st, 1);
        const char *lang = (const char *)sqlite3_column_text(st, 2);
        long ln = sqlite3_column_int64(st, 3);
        top.files++;
        top.lines += ln;
        dir_add_lang(&top, lang, ln);
        int parent = -1;
        const char *s = p + pl;
        for (int d = 1; d <= depth; d++) {
            const char *slash = strchr(s, '/');
            if (!slash) break;
            int i = dm_get(&m, p, (size_t)(slash - p), d, parent);
            DirAgg *a = &m.v[i];
            a->files++;
            a->lines += ln;
            dir_add_lang(a, lang, ln);
            parent = i;
            s = slash + 1;
        }
    }
    sqlite3_finalize(st);
    if (top.files == 0) {
        if (json) {
            StrBuf e; sb_init(&e);
            sb_puts(&e, "{\"mode\":\"dirs\",\"prefix\":");
            sb_json_str(&e, pre);
            sb_puts(&e, ",\"dirs\":[],\"files\":0,\"lines\":0,\"omitted\":0}\n");
            fputs(e.p, stdout);
            sb_free(&e);
        }
        else printf("files: no indexed files under '%s'\n", pre[0] ? pre : ".");
        free(m.slot);
        return 1;
    }
    int *order = xmalloc(sizeof(int) * (size_t)(m.n + 1));
    int no = 0;
    dirs_emit(&m, -1, order, &no);
    int shown = no < limit ? no : limit;

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"mode\":\"dirs\",\"prefix\":");
        sb_json_str(&b, pre);
        sb_printf(&b, ",\"depth\":%d,\"files\":%d,\"lines\":%ld,\"lang\":",
                  depth, top.files, top.lines);
        sb_json_str(&b, dir_dominant(&top));
        sb_puts(&b, ",\"dirs\":[");
        for (int i = 0; i < shown; i++) {
            DirAgg *d = &m.v[order[i]];
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"path\":"); sb_json_str(&b, d->path);
            sb_printf(&b, ",\"depth\":%d,\"files\":%d,\"lines\":%ld,\"lang\":",
                      d->depth, d->files, d->lines);
            sb_json_str(&b, dir_dominant(d));
            sb_putc(&b, '}');
        }
        sb_printf(&b, "],\"omitted\":%d}\n", no - shown);
    } else {
        sb_printf(&b, "%-48s %6d files %8ld lines  %s\n",
                  pre[0] ? pre : "./", top.files, top.lines,
                  dir_dominant(&top));
        for (int i = 0; i < shown; i++) {
            DirAgg *d = &m.v[order[i]];
            char label[1200];
            const char *nm = d->path + pl;
            if (d->parent >= 0) {
                const char *ps = strrchr(d->path, '/');
                nm = ps ? ps + 1 : d->path;
            }
            snprintf(label, sizeof label, "%*s%s/", d->depth * 2, "", nm);
            sb_printf(&b, "%-48s %6d files %8ld lines  %s\n", label, d->files,
                      d->lines, dir_dominant(d));
        }
        if (no > shown)
            sb_printf(&b, "(+%d more director%s omitted; -n %d or --depth %d "
                      "shows more)\n", no - shown, no - shown == 1 ? "y" : "ies",
                      limit * 2, depth > 1 ? depth - 1 : 1);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    for (int i = 0; i < m.n; i++) free(m.v[i].path);
    free(m.v);
    free(m.slot);
    free(order);
    return 0;
}

/* ---------------- globs and words ---------------- */

static int files_glob(Cg *cg, const QueryFilter *f, const char *pat,
                      FileRow **v, int *n, int *c) {
    QueryFilter g = *f;               /* the pattern is one more --path */
    if (g.npaths) {
        /* both must hold: the pattern AND any --path; rows checked in C */
        g.npaths = 0;
    }
    qf_add_path(&g, pat);
    sqlite3_stmt *st = files_prep(cg, &g,
        "SELECT " FILE_COLS " FROM files f WHERE 1", " ORDER BY f.path");
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *p = (const char *)sqlite3_column_text(st, 1);
        if (f->npaths && !query_filter_match(f, p, NULL)) continue;
        rows_push(v, n, c, st);
    }
    sqlite3_finalize(st);
    return 0;
}

static int files_words(Cg *cg, const QueryFilter *f, const char *pat,
                       FileRow **v, int *n, int *c) {
    char words[1024];
    name_words(pat, words, sizeof words);
    char terms[16][64];
    int nt = 0;
    for (char *w = words; *w && nt < 16; ) {
        char *e = strchr(w, ' ');
        if (e) *e = 0;
        if (strlen(w) < sizeof terms[0]) snprintf(terms[nt++], 64, "%s", w);
        if (!e) break;
        w = e + 1;
    }
    if (!nt) return 0;
    /* trigram MATCH for every word it can reach (three characters and up);
     * shorter words narrow with instr over the same words column */
    StrBuf m; sb_init(&m);
    StrBuf shortw; sb_init(&shortw);
    sb_puts(&shortw, "");
    for (int i = 0; i < nt; i++) {
        if (strlen(terms[i]) >= 3) {
            sb_printf(&m, "%s\"%s\"", m.len ? " AND " : "", terms[i]);
        } else {
            char *q = sqlite3_mprintf(" AND instr(x.words,%Q)>0", terms[i]);
            sb_puts(&shortw, q);
            sqlite3_free(q);
        }
    }
    StrBuf head; sb_init(&head);
    if (m.len)
        sb_printf(&head, "SELECT " FILE_COLS " FROM file_fts x "
                  "JOIN files f ON f.id=x.rowid WHERE file_fts MATCH ?1%s",
                  shortw.p);
    else
        sb_printf(&head, "SELECT " FILE_COLS " FROM file_fts x "
                  "JOIN files f ON f.id=x.rowid WHERE 1%s", shortw.p);
    sqlite3_stmt *st = files_prep(cg, f, head.p, "");
    if (m.len) sqlite3_bind_text(st, 1, m.p, -1, SQLITE_TRANSIENT);
    while (sqlite3_step(st) == SQLITE_ROW) {
        rows_push(v, n, c, st);
        FileRow *r = &(*v)[*n - 1];
        r->score = words_score(r->path, terms, nt);
    }
    sqlite3_finalize(st);
    sb_free(&m);
    sb_free(&shortw);
    sb_free(&head);
    return 0;
}

static bool is_dir_path(Cg *cg, const char *p) {
    if (!p[0]) return true;
    char pre[1100];
    snprintf(pre, sizeof pre, "%s/", p);
    char scope[64];
    branch_scope_sql(cg, "f", scope, sizeof scope);
    char sql[256];
    snprintf(sql, sizeof sql, "SELECT 1 FROM files f WHERE f.path>=?1 AND "
             "f.path<?1||char(0x10FFFF)%s LIMIT 1", scope);
    sqlite3_stmt *st = cg_prep(cg, sql);
    sqlite3_bind_text(st, 1, pre, -1, SQLITE_STATIC);
    bool yes = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return yes;
}

static int files_query(Cg *cg, const QueryFilter *fp, const char *pat,
                       bool dirs, int depth, int limit, bool json);

int cmd_files(Cg *cg, int argc, char **argv, bool json) {
    /* argv[0] is "files"; the filters come out first */
    QueryFilter f;
    if (query_filter_parse(&argc, argv, &f) != 0) return 1;
    bool dirs = false;
    int depth = 2, limit = 40;
    const char *pat = NULL;
    StrBuf words; sb_init(&words);
    for (int i = 1; i < argc; i++) {
        const char *a = argv[i];
        if (strcmp(a, "--dirs") == 0) dirs = true;
        else if ((strcmp(a, "--depth") == 0 || strcmp(a, "-n") == 0) &&
                 i + 1 < argc) {
            int v = atoi(argv[++i]);
            if (a[1] == 'n') limit = v; else depth = v;
        } else if (strncmp(a, "--depth=", 8) == 0) depth = atoi(a + 8);
        else if (a[0] == '-' && a[1]) {
            fprintf(stderr, "cg files: unknown flag '%s'\n", a);
            help_usage("files");
            return 1;
        } else {
            /* several words are one phrase: cg files sync gate */
            if (words.len) sb_putc(&words, ' ');
            sb_puts(&words, a);
            pat = words.p;
        }
    }
    if (limit <= 0) limit = 40;
    if (depth <= 0) depth = 2;
    if (depth > 16) depth = 16;
    int rc = files_query(cg, &f, pat, dirs, depth, limit, json);
    sb_free(&words);
    return rc;
}

static int files_query(Cg *cg, const QueryFilter *fp, const char *pat,
                       bool dirs, int depth, int limit, bool json) {
    QueryFilter f = *fp;
    if (dirs) return files_dirs(cg, &f, pat, depth, limit, json);

    char p[1024];
    const char *s = pat ? pat : "";
    while (s[0] == '.' && s[1] == '/') s += 2;
    snprintf(p, sizeof p, "%s", s);
    size_t pl = strlen(p);
    bool slash = pl && p[pl - 1] == '/';
    while (pl && p[pl - 1] == '/') p[--pl] = 0;
    if (strcmp(p, ".") == 0) p[0] = 0;

    if (!has_glob(p) && (slash || !strchr(p, ' ')) && is_dir_path(cg, p)) {
        int rc = files_dir(cg, &f, p, limit, json);
        if (rc == 0 || slash || !p[0]) {
            if (rc != 0) {
                if (json) printf("{\"mode\":\"dir\",\"files\":[],\"total\":0,"
                                 "\"omitted\":0}\n");
                else printf("files: nothing under '%s/' matches\n", p);
                return 1;
            }
            return 0;
        }
    }

    FileRow *v = NULL;
    int n = 0, c = 0;
    const char *mode = has_glob(p) ? "glob" : "words";
    if (has_glob(p)) files_glob(cg, &f, p, &v, &n, &c);
    else files_words(cg, &f, p, &v, &n, &c);
    qsort(v, (size_t)n, sizeof *v, filerow_cmp);

    int shown = n < limit ? n : limit;
    StrBuf b; sb_init(&b);
    if (json) {
        sb_printf(&b, "{\"mode\":\"%s\",\"pattern\":", mode);
        sb_json_str(&b, p);
        sb_puts(&b, ",\"files\":[");
        print_rows(cg, v, n, shown, true, &b);
        sb_printf(&b, "],\"total\":%d,\"omitted\":%d}\n", n, n - shown);
    } else if (n == 0) {
        sb_printf(&b, "files: nothing matches '%s'\n", p);
    } else {
        print_rows(cg, v, n, shown, false, &b);
        if (n > shown)
            sb_printf(&b, "(+%d more file%s omitted; -n %d, --path or --lang "
                      "narrows)\n", n - shown, n - shown == 1 ? "" : "s",
                      limit * 2);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    for (int i = 0; i < n; i++) free(v[i].path);
    free(v);
    return n ? 0 : 1;
}
