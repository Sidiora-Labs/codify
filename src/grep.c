/*
 * cg grep — line search placed in the graph (codify-v15 1.1).
 *
 * The pattern's trigrams ask body_tri which files can match at all; only
 * those candidates are read, from disk, by parallel workers, so a hit is the
 * text as it is now, not as it was indexed. Each hit line is mapped onto the
 * symbol spans of its file, files are ranked (hit count, source before
 * tests, shallower first), and the answer is cut to -n hits and a token
 * budget with an explicit tail naming what was left out. body_tri only
 * narrows: the scan decides, so a stale or missing index costs speed, never
 * a wrong hit.
 */
#include "cg.h"
#include <pthread.h>
#include <regex.h>
#include <stdatomic.h>
#include <ctype.h>

/* mirrors scan.c: the indexer never reads a file over GREP_FILE_MAX and
 * keeps no body (so no trigrams) for one over GREP_BODY_MAX */
#define GREP_FILE_MAX (8L * 1024 * 1024)
#define GREP_BODY_MAX (2L * 1024 * 1024)
#define GREP_TEXT_MAX 200          /* bytes of a hit line we print */
#define GREP_MAX_TRI  24           /* trigrams asked of the index */

const char GREP_CODE_SCHEMA[] =
    "{\"type\":\"object\",\"properties\":{"
    "\"pattern\":{\"type\":\"string\",\"description\":"
    "\"a literal substring, or a POSIX extended regex with regex=true\"},"
    "\"regex\":{\"type\":\"boolean\",\"description\":\"pattern is an ERE\"},"
    "\"case_sensitive\":{\"type\":\"boolean\",\"description\":"
    "\"default true\"},"
    "\"path\":{\"type\":[\"string\",\"array\"],\"items\":{\"type\":"
    "\"string\"},\"description\":\"glob(s) a file must match, e.g. src/**\"},"
    "\"lang\":{\"type\":\"string\",\"description\":"
    "\"language (c, python, typescript...) or extension\"},"
    "\"symbol\":{\"type\":\"string\",\"description\":"
    "\"only hits inside this symbol's span\"},"
    "\"kind\":{\"type\":\"string\",\"description\":"
    "\"only hits inside symbols of this kind (function, class...)\"},"
    "\"no_tests\":{\"type\":\"boolean\"},"
    "\"context\":{\"type\":\"integer\",\"description\":"
    "\"lines of context around each hit\"},"
    "\"limit\":{\"type\":\"integer\",\"description\":\"most hits (default 50)\"},"
    "\"budget\":{\"type\":\"integer\",\"description\":"
    "\"token budget (default 4000)\"},"
    "\"files\":{\"type\":\"boolean\",\"description\":"
    "\"list matching files with counts only\"},"
    "\"count\":{\"type\":\"boolean\",\"description\":\"the total only\"}},"
    "\"required\":[\"pattern\"]}";

/* ---------------- the pattern's trigrams ---------------- */

static bool ere_meta(char c) { return c && strchr(".[]()*+?{}|^$\\", c); }

/* The literal a match must contain: the whole pattern for a literal, the
 * longest metacharacter-free run for an ERE. A run char followed by a
 * quantifier is optional, so it leaves the run; an alternation anywhere
 * means no run is required at all. */
static char *required_literal(const char *pat, bool regex) {
    if (!regex) return xstrdup(pat);
    if (strchr(pat, '|')) return xstrdup("");
    size_t n = strlen(pat);
    char *best = xstrdup(""), *cur = xmalloc(n + 1);
    size_t cl = 0;
    for (size_t i = 0; i <= n; i++) {
        char c = pat[i];
        bool lit = false;
        char ch = c;
        size_t adv = 0;
        if (c == '\\' && pat[i + 1] && !isalnum((unsigned char)pat[i + 1])) {
            lit = true; ch = pat[i + 1]; adv = 1;      /* \. is a literal . */
        } else if (c && !ere_meta(c)) {
            lit = true;
        }
        char next = c ? pat[i + adv + 1] : 0;
        if (lit && (next == '*' || next == '?' || next == '{')) lit = false;
        if (lit) {
            cur[cl++] = ch;
            i += adv;
            if (next == '+') {           /* x+ needs one x, then the run ends */
                cur[cl] = 0;
                if (cl > strlen(best)) { free(best); best = xstrdup(cur); }
                cl = 0;
            }
            continue;
        }
        cur[cl] = 0;
        if (cl > strlen(best)) { free(best); best = xstrdup(cur); }
        cl = 0;
        if (c == '[') {                  /* skip the bracket expression */
            i++;
            if (pat[i] == '^') i++;
            if (pat[i] == ']') i++;
            while (pat[i] && pat[i] != ']') i++;
        }
        if (!c) break;
    }
    free(cur);
    return best;
}

/* utf-8 length of the character starting at s */
static size_t u8len(const unsigned char *s) {
    if (*s < 0x80) return 1;
    if ((*s & 0xE0) == 0xC0) return 2;
    if ((*s & 0xF0) == 0xE0) return 3;
    if ((*s & 0xF8) == 0xF0) return 4;
    return 1;
}

/* An FTS5 query asking for every trigram of lit (characters, as the
 * trigram tokenizer counts them), each alone — body_tri is detail=none, so
 * a phrase would be refused. Empty when lit is under three characters. */
static int trigram_query(const char *lit, StrBuf *q) {
    size_t n = strlen(lit);
    size_t *starts = xmalloc(sizeof(size_t) * (n + 1));
    int nc = 0;
    for (size_t i = 0; i < n; i += u8len((const unsigned char *)lit + i))
        starts[nc++] = i;
    starts[nc] = n;
    int ntri = nc >= 3 ? nc - 2 : 0, asked = 0;
    /* a long literal: an even spread of its trigrams narrows as well as all */
    int step = ntri > GREP_MAX_TRI ? (ntri + GREP_MAX_TRI - 1) / GREP_MAX_TRI
                                   : 1;
    for (int t = 0; t < ntri; t += step) {
        if (asked++) sb_puts(q, " AND ");
        sb_putc(q, '"');
        for (size_t k = starts[t]; k < starts[t + 3]; k++) {
            if (lit[k] == '"') sb_putc(q, '"');
            sb_putc(q, lit[k]);
        }
        sb_putc(q, '"');
    }
    free(starts);
    return asked;
}

/* ---------------- candidate files ---------------- */

typedef struct { char *name, *kind; int line, end; } GSpan;
typedef struct { int line; char *text; } GHit;

typedef struct {
    long id, branch_id, size;
    char *path;
    const char *tree;          /* the worktree the file's branch lives in */
    bool is_test;
    int depth;
    /* filled by the scan */
    bool skipped;
    int nhits;                 /* hits counted (after --symbol/--kind) */
    GHit *kept; int nkept;     /* the first hits, with text */
    /* --symbol/--kind: the spans a hit must fall in (loaded before scan) */
    GSpan *only; int nonly;
    /* every span of the file, loaded after the scan for files with hits */
    GSpan *spans; int nspans; bool spans_loaded;
} GFile;

static void spans_load(Cg *cg, long file_id, const char *by, const char *val,
                       GSpan **out, int *n) {
    char sql[256];
    snprintf(sql, sizeof sql,
             "SELECT name,kind,line,COALESCE(end_line,line) FROM symbols "
             "WHERE file_id=?1 AND decl=0%s ORDER BY line",
             !by ? "" : strcmp(by, "name") == 0 ? " AND name=?2"
                                                : " AND kind=?2");
    sqlite3_stmt *st = cg_prep(cg, sql);
    sqlite3_bind_int64(st, 1, file_id);
    if (by) sqlite3_bind_text(st, 2, val, -1, SQLITE_STATIC);
    int cap = 0;
    *out = NULL; *n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (*n == cap) {
            cap = cap ? cap * 2 : 16;
            *out = xrealloc(*out, sizeof(GSpan) * (size_t)cap);
        }
        GSpan *s = &(*out)[(*n)++];
        const char *nm = (const char *)sqlite3_column_text(st, 0);
        const char *kd = (const char *)sqlite3_column_text(st, 1);
        s->name = xstrdup(nm ? nm : "");
        s->kind = xstrdup(kd ? kd : "");
        s->line = sqlite3_column_int(st, 2);
        s->end  = sqlite3_column_int(st, 3);
        if (s->end < s->line) s->end = s->line;
    }
    sqlite3_finalize(st);
}

static void spans_free(GSpan *s, int n) {
    for (int i = 0; i < n; i++) { free(s[i].name); free(s[i].kind); }
    free(s);
}

/* the innermost span holding line, or NULL for file scope */
static const GSpan *span_at(const GSpan *s, int n, int line) {
    const GSpan *best = NULL;
    for (int i = 0; i < n && s[i].line <= line; i++) {
        if (s[i].end < line) continue;
        if (!best || s[i].line > best->line ||
            (s[i].line == best->line && s[i].end < best->end))
            best = &s[i];
    }
    return best;
}

/* ---------------- the parallel scan ---------------- */

typedef struct {
    const GrepOpts *o;
    GFile *files;
    int nfiles;
    atomic_int next;
    char *needle;              /* literal, lowercased under -i */
    size_t nlen;
    int keep;                  /* hits per file worth keeping text for */
    atomic_long scanned, skipped;
} GScan;

static void hit_add(GScan *g, GFile *f, int line, const char *ls,
                    const char *le) {
    if (f->nonly) {                       /* --symbol / --kind */
        bool in = false;
        for (int i = 0; i < f->nonly && !in; i++)
            in = f->only[i].line <= line && line <= f->only[i].end;
        if (!in) return;
    }
    f->nhits++;
    if (f->nkept >= g->keep) return;
    while (ls < le && (*ls == ' ' || *ls == '\t')) ls++;
    while (le > ls && (le[-1] == '\r' || le[-1] == ' ' || le[-1] == '\t'))
        le--;
    size_t tl = (size_t)(le - ls);
    if (tl > GREP_TEXT_MAX) {               /* never split a character */
        tl = GREP_TEXT_MAX;
        while (tl > 0 && ((unsigned char)ls[tl] & 0xC0) == 0x80) tl--;
    }
    if ((f->nkept & (f->nkept - 1)) == 0)       /* 0, 1, 2, 4...: grow */
        f->kept = xrealloc(f->kept, sizeof(GHit) *
                           (size_t)(f->nkept ? f->nkept * 2 : 1));
    char *t = xmalloc(tl + 1);
    memcpy(t, ls, tl);
    t[tl] = 0;
    f->kept[f->nkept].line = line;
    f->kept[f->nkept].text = t;
    f->nkept++;
}

/* literal: memmem over the whole buffer, one hit per line */
static void scan_literal(GScan *g, GFile *f, const char *buf, size_t len) {
    char *low = NULL;
    const char *hay = buf;
    if (g->o->icase) {
        low = xmalloc(len + 1);
        for (size_t i = 0; i < len; i++)
            low[i] = (char)tolower((unsigned char)buf[i]);
        low[len] = 0;
        hay = low;
    }
    size_t pos = 0;           /* newlines before pos are counted in line */
    int line = 1;
    while (pos < len) {
        const char *m = memmem(hay + pos, len - pos, g->needle, g->nlen);
        if (!m) break;
        size_t at = (size_t)(m - hay);
        for (size_t k = pos; k < at; k++) if (hay[k] == '\n') line++;
        size_t ls = at;
        while (ls > 0 && buf[ls - 1] != '\n') ls--;
        const char *nl = memchr(buf + at, '\n', len - at);
        size_t le = nl ? (size_t)(nl - buf) : len;
        hit_add(g, f, line, buf + ls, buf + le);
        if (!nl) break;
        pos = le + 1;                     /* past this line's newline */
        line++;
    }
    free(low);
}

static void scan_regex(GScan *g, GFile *f, char *buf, size_t len,
                       regex_t *re) {
    int line = 1;
    char *p = buf, *end = buf + len;
    while (p < end) {
        char *nl = memchr(p, '\n', (size_t)(end - p));
        char *le = nl ? nl : end;
        char save = *le;
        *le = 0;                          /* buf is ours and NUL-terminated */
        if (regexec(re, p, 0, NULL, 0) == 0) hit_add(g, f, line, p, le);
        *le = save;
        if (!nl) break;
        p = nl + 1;
        line++;
    }
}

static void *scan_worker(void *arg) {
    GScan *g = arg;
    regex_t re;
    bool have_re = false;
    if (g->o->regex)
        have_re = regcomp(&re, g->o->pattern, REG_EXTENDED | REG_NOSUB |
                          (g->o->icase ? REG_ICASE : 0)) == 0;
    for (;;) {
        int i = atomic_fetch_add(&g->next, 1);
        if (i >= g->nfiles) break;
        GFile *f = &g->files[i];
        if (f->skipped) continue;
        char abs[4900];
        snprintf(abs, sizeof abs, "%s/%s", f->tree, f->path);
        size_t len = 0;
        char *buf = read_entire_file(abs, &len);
        /* what the indexer would not read is not searched, and counted */
        if (!buf || (long)len > GREP_FILE_MAX || looks_binary(buf, len)) {
            free(buf);
            f->skipped = true;
            atomic_fetch_add(&g->skipped, 1);
            continue;
        }
        atomic_fetch_add(&g->scanned, 1);
        if (g->o->regex) { if (have_re) scan_regex(g, f, buf, len, &re); }
        else scan_literal(g, f, buf, len);
        free(buf);
    }
    if (have_re) regfree(&re);
    return NULL;
}

/* ---------------- ranking and output ---------------- */

static int file_rank(const void *a, const void *b) {
    const GFile *x = a, *y = b;
    if (x->nhits != y->nhits) return y->nhits - x->nhits;
    if (x->is_test != y->is_test) return x->is_test - y->is_test;
    if (x->depth != y->depth) return x->depth - y->depth;
    int c = strcmp(x->path, y->path);
    return c ? c : (x->branch_id > y->branch_id) - (x->branch_id < y->branch_id);
}

/* lines [from..to] of a file, for -C; NULL entries past the end */
typedef struct { char *buf; char **lines; int n; } GLines;

static void glines_load(GLines *gl, const GFile *f) {
    memset(gl, 0, sizeof *gl);
    char abs[4900];
    snprintf(abs, sizeof abs, "%s/%s", f->tree, f->path);
    size_t len = 0;
    gl->buf = read_entire_file(abs, &len);
    if (!gl->buf) return;
    int cap = 256;
    gl->lines = xmalloc(sizeof(char *) * (size_t)cap);
    char *p = gl->buf, *end = gl->buf + len;
    while (p < end) {
        if (gl->n == cap) {
            cap *= 2;
            gl->lines = xrealloc(gl->lines, sizeof(char *) * (size_t)cap);
        }
        gl->lines[gl->n++] = p;
        char *nl = memchr(p, '\n', (size_t)(end - p));
        if (!nl) break;
        *nl = 0;
        if (nl > p && nl[-1] == '\r') nl[-1] = 0;
        p = nl + 1;
    }
}

static void glines_free(GLines *gl) { free(gl->buf); free(gl->lines); }

static void put_trimmed(StrBuf *b, const char *s, bool json) {
    while (*s == ' ' || *s == '\t') s++;
    size_t tl = strlen(s);
    if (tl > GREP_TEXT_MAX) {
        tl = GREP_TEXT_MAX;
        while (tl > 0 && ((unsigned char)s[tl] & 0xC0) == 0x80) tl--;
    }
    char *t = xmalloc(tl + 1);
    memcpy(t, s, tl);
    t[tl] = 0;
    if (json) sb_json_str(b, t); else sb_puts(b, t);
    free(t);
}

/* -C context of one hit in JSON: the lines before and after it */
static void put_context(StrBuf *b, const GLines *gl, int line, int ctx) {
    sb_puts(b, ",\"before\":[");
    int k = 0;
    for (int l = line - ctx; l < line; l++) {
        if (l < 1 || l > gl->n) continue;
        if (k++) sb_putc(b, ',');
        put_trimmed(b, gl->lines[l - 1], true);
    }
    sb_puts(b, "],\"after\":[");
    k = 0;
    for (int l = line + 1; l <= line + ctx; l++) {
        if (l < 1 || l > gl->n) continue;
        if (k++) sb_putc(b, ',');
        put_trimmed(b, gl->lines[l - 1], true);
    }
    sb_putc(b, ']');
}

/* codify-v15 1.5: does body_tri hold a row for every file in scope that
 * carries a body? A graph whose table was created after its files were
 * indexed (SCHEMA adding body_tri to a database already at its version), or
 * a write cut short, holds fewer, and a candidate query over it would miss
 * files silently. The cheap test first: the table's row count against
 * every file the indexer keeps a body for (size within GREP_BODY_MAX, as
 * scan.c's write_done decides; skipped files have no files row at all).
 * Only when that is short is the scope counted file by file. *have and
 * *want report the scoped numbers (both 0 when the cheap test passed). */
bool grep_tri_complete(Cg *cg, long *have, long *want) {
    long h = 0, w = 0;
    if (have) *have = 0;
    if (want) *want = 0;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT count(*) FROM body_tri_docsize",
                           -1, &st, NULL) != SQLITE_OK) {
        sqlite3_finalize(st);
        st = NULL;
        if (sqlite3_prepare_v2(cg->db, "SELECT count(*) FROM body_tri", -1,
                               &st, NULL) != SQLITE_OK) {
            sqlite3_finalize(st);
            return false;                    /* no table: nothing narrows */
        }
    }
    long rows = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int64(st, 0)
                                               : -1;
    sqlite3_finalize(st);
    st = cg_prep(cg, "SELECT count(*) FROM files WHERE size<=?1");
    sqlite3_bind_int64(st, 1, GREP_BODY_MAX);
    long bodies = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int64(st, 0)
                                                 : 0;
    sqlite3_finalize(st);
    if (rows >= bodies) return true;
    char scope[64], sql[320];
    branch_scope_sql(cg, "f", scope, sizeof scope);
    snprintf(sql, sizeof sql,
             "SELECT count(*), count(t.rowid) FROM files f "
             "LEFT JOIN body_tri t ON t.rowid=f.id WHERE f.size<=?1%s", scope);
    if (sqlite3_prepare_v2(cg->db, sql, -1, &st, NULL) != SQLITE_OK) {
        sqlite3_finalize(st);
        return false;
    }
    sqlite3_bind_int64(st, 1, GREP_BODY_MAX);
    if (sqlite3_step(st) == SQLITE_ROW) {
        w = sqlite3_column_int64(st, 0);
        h = sqlite3_column_int64(st, 1);
    }
    sqlite3_finalize(st);
    if (have) *have = h;
    if (want) *want = w;
    return h >= w;
}

static long now_scope_count(Cg *cg) {
    char scope[64], sql[256];
    branch_scope_sql(cg, "f", scope, sizeof scope);
    snprintf(sql, sizeof sql, "SELECT COUNT(*) FROM files f WHERE 1%s",
             scope);
    sqlite3_stmt *st = cg_prep(cg, sql);
    long n = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int64(st, 0) : 0;
    sqlite3_finalize(st);
    return n;
}

/* The files the scan reads: the index's candidates (match = the trigram
 * query) or every indexed file of the branch scope (match = NULL), with
 * the shared QueryFilter (--path/--lang/--no-tests, as search, context,
 * survey and files narrow) inside the SQL and --symbol/--kind as a join. A
 * file whose body the index never kept is counted in big, not read. */
#define GREP_MAX_TREES 32
typedef struct {
    GFile *files; int n, cap;
    long candidates, big;
    struct { long id; char tree[4096]; } trees[GREP_MAX_TREES];
    int ntrees;
} GCands;

static void cands_reset(GCands *c) {
    for (int i = 0; i < c->n; i++) free(c->files[i].path);
    free(c->files);
    c->files = NULL;
    c->n = c->cap = 0;
    c->candidates = c->big = 0;
}

static int cands_collect(Cg *cg, const GrepOpts *o, const QueryFilter *qf,
                         const char *match, GCands *c) {
    char scope[64];
    branch_scope_sql(cg, "f", scope, sizeof scope);
    StrBuf sql; sb_init(&sql);
    sb_puts(&sql, "SELECT f.id,f.path,f.lang,f.branch_id,f.size "
                  "FROM files f WHERE ");
    if (!match) sb_puts(&sql, "1");
    else sb_printf(&sql, "(f.size>%ld OR f.id IN (SELECT rowid FROM body_tri "
                         "WHERE body_tri MATCH ?1))", GREP_BODY_MAX);
    sb_puts(&sql, scope);
    char *flt = query_filter_sql(qf, "f");
    sb_puts(&sql, flt);
    free(flt);
    if (query_filter_active(qf)) query_filter_register(cg->db);
    bool sym = o->symbol && o->symbol[0], kind = o->kind && o->kind[0];
    if (sym)
        sb_puts(&sql, " AND EXISTS(SELECT 1 FROM symbols s WHERE "
                      "s.file_id=f.id AND s.decl=0 AND s.name=?2)");
    if (kind)
        sb_puts(&sql, " AND EXISTS(SELECT 1 FROM symbols s WHERE "
                      "s.file_id=f.id AND s.decl=0 AND s.kind=?3)");
    sb_puts(&sql, " ORDER BY f.path, f.branch_id");
    sqlite3_stmt *st = NULL;
    int rc = sqlite3_prepare_v2(cg->db, sql.p, -1, &st, NULL);
    sb_free(&sql);
    if (rc != SQLITE_OK) return -1;
    if (match) sqlite3_bind_text(st, 1, match, -1, SQLITE_STATIC);
    if (sym)   sqlite3_bind_text(st, 2, o->symbol, -1, SQLITE_STATIC);
    if (kind)  sqlite3_bind_text(st, 3, o->kind, -1, SQLITE_STATIC);
    while ((rc = sqlite3_step(st)) == SQLITE_ROW) {
        const char *path = (const char *)sqlite3_column_text(st, 1);
        const char *lang = (const char *)sqlite3_column_text(st, 2);
        /* the SQL narrowed already; the same decision, row in hand */
        if (!path || !query_filter_match(qf, path, lang)) continue;
        long size = sqlite3_column_int64(st, 4);
        long bid = sqlite3_column_int64(st, 3);
        if (size > GREP_BODY_MAX) { c->big++; continue; }
        c->candidates++;
        if (c->n == c->cap) {
            c->cap = c->cap ? c->cap * 2 : 256;
            c->files = xrealloc(c->files, sizeof(GFile) * (size_t)c->cap);
        }
        GFile *f = &c->files[c->n++];
        memset(f, 0, sizeof *f);
        f->id = sqlite3_column_int64(st, 0);
        f->branch_id = bid;
        f->size = size;
        f->path = xstrdup(path);
        f->is_test = graph_path_is_test(path);
        for (const char *p = path; *p; p++) if (*p == '/') f->depth++;
        /* the bytes of another branch's file live in that branch's tree */
        int t = 0;
        while (t < c->ntrees && c->trees[t].id != bid) t++;
        if (t == c->ntrees && c->ntrees < GREP_MAX_TREES) {
            c->trees[t].id = bid;
            branch_tree(cg, bid, c->trees[t].tree, sizeof c->trees[t].tree);
            c->ntrees++;
        }
        f->tree = t < c->ntrees ? c->trees[t].tree : cg->root;
    }
    sqlite3_finalize(st);
    return rc == SQLITE_DONE ? 0 : -1;
}

int cmd_grep(Cg *cg, const SysInfo *si, const GrepOpts *o, bool json) {
    long t0 = now_ms();
    if (!o->pattern || !o->pattern[0]) {
        fprintf(stderr, "cg grep: an empty pattern matches every line — "
                        "name what to look for\n");
        return 1;
    }
    if (o->regex) {                       /* a bad ERE fails loudly, once */
        regex_t re;
        int rc = regcomp(&re, o->pattern, REG_EXTENDED | REG_NOSUB);
        if (rc != 0) {
            char msg[256];
            regerror(rc, &re, msg, sizeof msg);
            if (json) {
                StrBuf b; sb_init(&b);
                sb_puts(&b, "{\"error\":");
                sb_json_str(&b, msg);
                sb_puts(&b, "}\n");
                fputs(b.p, stdout);
                sb_free(&b);
            } else {
                fprintf(stderr, "cg grep: bad regex: %s\n", msg);
            }
            return 1;
        }
        regfree(&re);
    }
    int limit = o->limit > 0 ? o->limit : 50;
    int budget = o->budget > 0 ? o->budget : 4000;

    /* --path/--lang/--no-tests through the one parser every read shares */
    QueryFilter qf;
    {
        char *av[2 * GREP_MAX_PATHS + 5];
        int ac = 0;
        av[ac++] = "grep";
        for (int i = 0; i < o->npaths && i < GREP_MAX_PATHS; i++) {
            av[ac++] = "--path";
            av[ac++] = (char *)o->paths[i];
        }
        if (o->lang && o->lang[0]) {
            av[ac++] = "--lang";
            av[ac++] = (char *)o->lang;
        }
        if (o->no_tests) av[ac++] = "--no-tests";
        if (query_filter_parse(&ac, av, &qf) != 0) return 1;
    }

    /* the index's candidates: files holding every trigram of the literal */
    char *lit = required_literal(o->pattern, o->regex);
    StrBuf q; sb_init(&q);
    bool full_scan = trigram_query(lit, &q) == 0;
    free(lit);
    /* codify-v15 1.5: a body_tri short of the files it should cover would
     * drop real hits from the candidates; scan the whole scope instead
     * until the next sync puts the rows back */
    long tri_have = 0, tri_want = 0;
    bool tri_short = !full_scan &&
                     !grep_tri_complete(cg, &tri_have, &tri_want);
    if (tri_short) full_scan = true;

    GCands c;
    memset(&c, 0, sizeof c);
    /* an index that cannot answer (a busy or damaged table) narrows
     * nothing: scan the branch rather than report a false "no hits" */
    if (cands_collect(cg, o, &qf, full_scan ? NULL : q.p, &c) != 0) {
        cands_reset(&c);
        if (full_scan || cands_collect(cg, o, &qf, NULL, &c) != 0) {
            fprintf(stderr, "cg grep: %s\n", sqlite3_errmsg(cg->db));
            cands_reset(&c);
            sb_free(&q);
            return 1;
        }
        full_scan = true;
    }
    sb_free(&q);
    GFile *files = c.files;
    int nfiles = c.n;
    long candidates = c.candidates, skipped_big = c.big;
    long indexed = now_scope_count(cg);

    /* --symbol / --kind: the spans a hit must fall inside, per file */
    if ((o->symbol && o->symbol[0]) || (o->kind && o->kind[0])) {
        bool by_name = o->symbol && o->symbol[0];
        for (int i = 0; i < nfiles; i++) {
            spans_load(cg, files[i].id, by_name ? "name" : "kind",
                       by_name ? o->symbol : o->kind,
                       &files[i].only, &files[i].nonly);
            if (by_name && o->kind && o->kind[0]) {  /* both: name and kind */
                int k = 0;
                for (int j = 0; j < files[i].nonly; j++) {
                    if (strcmp(files[i].only[j].kind, o->kind) == 0)
                        files[i].only[k++] = files[i].only[j];
                    else {
                        free(files[i].only[j].name);
                        free(files[i].only[j].kind);
                    }
                }
                files[i].nonly = k;
            }
            if (files[i].nonly == 0) files[i].skipped = true;  /* no span */
        }
    }

    /* the scan: workers over the candidates, as many as the machine's
     * worker budget allows and the candidate count can use */
    GScan g;
    memset(&g, 0, sizeof g);
    g.o = o;
    g.files = files;
    g.nfiles = nfiles;
    atomic_init(&g.next, 0);
    atomic_init(&g.scanned, 0);
    atomic_init(&g.skipped, 0);
    g.keep = limit;
    if (!o->regex) {
        g.needle = xstrdup(o->pattern);
        g.nlen = strlen(g.needle);
        if (o->icase)
            for (char *c = g.needle; *c; c++)
                *c = (char)tolower((unsigned char)*c);
    }
    const char *origin;
    int nw = si ? syncgate_worker_request(cg->root, si, 0, &origin) : 4;
    if (nw > CG_MAX_WORKERS) nw = CG_MAX_WORKERS;
    if (nw > nfiles / 8 + 1) nw = nfiles / 8 + 1;   /* small sets: few */
    if (nw < 1) nw = 1;
    pthread_t th[CG_MAX_WORKERS];
    int started = 0;
    for (int i = 1; i < nw; i++)
        if (pthread_create(&th[started], NULL, scan_worker, &g) == 0)
            started++;
    scan_worker(&g);
    for (int i = 0; i < started; i++) pthread_join(th[i], NULL);
    free(g.needle);
    long scanned = atomic_load(&g.scanned);
    long skipped = atomic_load(&g.skipped) + skipped_big;

    /* rank the files that hit */
    long total = 0;
    int nhitf = 0;
    for (int i = 0; i < nfiles; i++) {
        total += files[i].nhits;
        if (files[i].nhits > 0) files[nhitf++] = files[i];
        else {
            free(files[i].path);
            spans_free(files[i].only, files[i].nonly);
            for (int k = 0; k < files[i].nkept; k++) free(files[i].kept[k].text);
            free(files[i].kept);
        }
    }
    qsort(files, (size_t)nhitf, sizeof(GFile), file_rank);

    StrBuf b; sb_init(&b);
    size_t cap_bytes = (size_t)budget * 4;
    size_t reserve = 320;                 /* the tail and the summary */
    long shown = 0;
    int shown_files = 0;
    char label[256];

    if (json) {
        sb_puts(&b, "{\"query\":");
        sb_json_str(&b, o->pattern);
        sb_printf(&b, ",\"regex\":%s,\"case_sensitive\":%s,"
                  "\"candidates\":%ld,\"scanned\":%ld,\"skipped\":%ld,"
                  "\"indexed\":%ld,\"full_scan\":%s,\"total\":%ld,"
                  "\"files_with_hits\":%d",
                  o->regex ? "true" : "false", o->icase ? "false" : "true",
                  candidates, scanned, skipped, indexed,
                  tri_short ? "\"body_tri incomplete\""
                            : full_scan ? "true" : "false", total, nhitf);
        if (tri_short)
            sb_printf(&b, ",\"body_tri\":{\"rows\":%ld,\"files\":%ld}",
                      tri_have, tri_want);
    }

    if (o->count_only) {
        if (json) sb_puts(&b, ",\"hits\":[]");
        else sb_printf(&b, "%ld hit%s in %d file%s\n", total,
                       total == 1 ? "" : "s", nhitf, nhitf == 1 ? "" : "s");
        shown = total;
        shown_files = nhitf;
    } else if (o->files_only) {
        if (json) sb_puts(&b, ",\"files\":[");
        for (int i = 0; i < nhitf; i++) {
            GFile *f = &files[i];
            StrBuf it; sb_init(&it);
            branch_hit_label(cg, f->branch_id, label, sizeof label);
            if (json) {
                if (shown_files) sb_putc(&it, ',');
                sb_puts(&it, "{\"path\":");
                sb_json_str(&it, f->path);
                sb_printf(&it, ",\"count\":%d", f->nhits);
                if (label[0]) {
                    sb_puts(&it, ",\"branch\":");
                    sb_json_str(&it, label);
                }
                sb_putc(&it, '}');
            } else {
                sb_printf(&it, "%s%s%s%s  %d hit%s\n", f->path,
                          label[0] ? " [" : "", label, label[0] ? "]" : "",
                          f->nhits, f->nhits == 1 ? "" : "s");
            }
            if (shown_files >= limit || b.len + it.len + reserve > cap_bytes) {
                sb_free(&it);
                break;
            }
            sb_puts(&b, it.p);
            sb_free(&it);
            shown_files++;
            shown += f->nhits;
        }
        if (json) sb_putc(&b, ']');
    } else {
        if (json) sb_puts(&b, ",\"hits\":[");
        bool stop = false;
        for (int i = 0; i < nhitf && !stop; i++) {
            GFile *f = &files[i];
            if (!f->spans_loaded) {        /* one span query per hit file */
                spans_load(cg, f->id, NULL, NULL, &f->spans, &f->nspans);
                f->spans_loaded = true;
            }
            GLines gl;
            bool have_ctx = o->context > 0;
            if (have_ctx) glines_load(&gl, f);
            branch_hit_label(cg, f->branch_id, label, sizeof label);
            const GSpan *group = NULL;
            bool first = true;
            int printed_to = 0;
            int in_file = 0;
            for (int k = 0; k < f->nkept; k++) {
                if (shown >= limit) { stop = true; break; }
                GHit *h = &f->kept[k];
                const GSpan *sp = span_at(f->spans, f->nspans, h->line);
                StrBuf it; sb_init(&it);
                if (json) {
                    if (shown) sb_putc(&it, ',');
                    sb_puts(&it, "{\"path\":");
                    sb_json_str(&it, f->path);
                    sb_printf(&it, ",\"line\":%d,\"text\":", h->line);
                    sb_json_str(&it, h->text);
                    sb_puts(&it, ",\"symbol\":");
                    if (sp) sb_json_str(&it, sp->name); else sb_puts(&it, "null");
                    sb_puts(&it, ",\"kind\":");
                    if (sp) sb_json_str(&it, sp->kind); else sb_puts(&it, "null");
                    if (label[0]) {
                        sb_puts(&it, ",\"branch\":");
                        sb_json_str(&it, label);
                    }
                    if (have_ctx && gl.buf)
                        put_context(&it, &gl, h->line, o->context);
                    sb_putc(&it, '}');
                } else {
                    if (first)
                        sb_printf(&it, "%s%s%s%s — %d hit%s\n", f->path,
                                  label[0] ? " [" : "", label,
                                  label[0] ? "]" : "", f->nhits,
                                  f->nhits == 1 ? "" : "s");
                    int from = h->line, to = h->line;
                    if (have_ctx && gl.buf) {
                        from = h->line - o->context;
                        to = h->line + o->context;
                        if (from < 1) from = 1;
                        if (to > gl.n) to = gl.n;
                        if (to < h->line) to = h->line;
                        if (printed_to && from > printed_to + 1)
                            sb_puts(&it, "  --\n");
                        if (from <= printed_to) from = printed_to + 1;
                        if (from > h->line) from = h->line;
                    }
                    if (first || sp != group) {
                        if (sp) sb_printf(&it, "  in %s %s\n", sp->kind,
                                          sp->name);
                        else    sb_puts(&it, "  in (file scope)\n");
                    }
                    for (int l = from; l <= to; l++) {
                        if (l == h->line) {
                            sb_printf(&it, "  %s:%d: %s\n", f->path, l,
                                      h->text);
                        } else {
                            sb_printf(&it, "  %s-%d-", f->path, l);
                            if (gl.lines[l - 1][strspn(gl.lines[l - 1],
                                                       " \t")]) {
                                sb_putc(&it, ' ');
                                put_trimmed(&it, gl.lines[l - 1], false);
                            }
                            sb_putc(&it, '\n');
                        }
                    }
                    if (to > printed_to) printed_to = to;
                }
                if (b.len + it.len + reserve > cap_bytes && shown > 0) {
                    sb_free(&it);
                    stop = true;
                    break;
                }
                sb_puts(&b, it.p);
                sb_free(&it);
                group = sp;
                first = false;
                shown++;
                in_file++;
            }
            if (in_file > 0) shown_files++;
            if (have_ctx) glines_free(&gl);
        }
        if (json) sb_putc(&b, ']');
    }

    long omitted = total - shown;
    if (omitted < 0) omitted = 0;
    /* files with any hit left out: those not reached, plus a partial one */
    int omitted_files = 0;
    if (omitted > 0) {
        long seen = 0;
        for (int i = 0; i < nhitf; i++) {
            if (seen >= shown) { omitted_files++; continue; }
            seen += files[i].nhits;
            if (seen > shown) omitted_files++;
        }
    }
    long ms = now_ms() - t0;
    if (json) {
        sb_printf(&b, ",\"omitted\":%ld,\"omitted_files\":%d,\"ms\":%ld}\n",
                  omitted, omitted_files, ms);
    } else if (!o->count_only) {
        if (omitted > 0)
            sb_printf(&b, "… %ld more hit%s in %d file%s — narrow with "
                      "--path or raise -n\n", omitted, omitted == 1 ? "" : "s",
                      omitted_files, omitted_files == 1 ? "" : "s");
        if (nhitf == 0)
            sb_printf(&b, "no hits for %s%s\n", o->pattern,
                      o->regex ? " (regex)" : "");
        sb_printf(&b, "%ld hit%s in %d file%s · %ld candidate%s of %ld "
                  "indexed file%s · %ld scanned · %ld skipped · %ld ms\n",
                  total, total == 1 ? "" : "s", nhitf, nhitf == 1 ? "" : "s",
                  candidates, candidates == 1 ? "" : "s", indexed,
                  indexed == 1 ? "" : "s", scanned, skipped, ms);
        if (tri_short)
            sb_printf(&b, "full scan — body_tri incomplete (%ld of %ld "
                      "files); the next cg sync repairs it\n",
                      tri_have, tri_want);
        else if (full_scan)
            sb_puts(&b, "no three-character literal in the pattern for the "
                        "trigram index: every indexed file was scanned\n");
    }
    fputs(b.p ? b.p : "", stdout);
    sb_free(&b);

    for (int i = 0; i < nhitf; i++) {
        free(files[i].path);
        spans_free(files[i].only, files[i].nonly);
        spans_free(files[i].spans, files[i].nspans);
        for (int k = 0; k < files[i].nkept; k++) free(files[i].kept[k].text);
        free(files[i].kept);
    }
    free(files);
    return 0;
}

/* ---------------- grep_code over MCP ---------------- */

/* mcp.c's CallCtx, which the tool table hands every handler */
typedef struct { Cg *cg; const SysInfo *si; const char *args; } GrepCall;

static bool arg_true(const char *args, const char *key, bool dflt) {
    char *v = json_get_raw(args, key);
    bool r = dflt;
    if (v) r = strcmp(v, "true") == 0 || strcmp(v, "1") == 0;
    free(v);
    return r;
}

int t_grep(void *v) {
    GrepCall *c = v;
    char *pat = c->args ? json_get_string(c->args, "pattern") : NULL;
    if (!pat) { printf("{\"error\":\"missing pattern\"}\n"); return 1; }
    GrepOpts o;
    memset(&o, 0, sizeof o);
    o.pattern = pat;
    o.regex = arg_true(c->args, "regex", false);
    o.icase = !arg_true(c->args, "case_sensitive", true);
    o.no_tests = arg_true(c->args, "no_tests", false);
    o.files_only = arg_true(c->args, "files", false);
    o.count_only = arg_true(c->args, "count", false);
    o.context = (int)json_get_int(c->args, "context", 0);
    o.limit = (int)json_get_int(c->args, "limit", 50);
    o.budget = (int)json_get_int(c->args, "budget", 4000);
    char *lang = json_get_string(c->args, "lang");
    char *sym = json_get_string(c->args, "symbol");
    char *kind = json_get_string(c->args, "kind");
    o.lang = lang; o.symbol = sym; o.kind = kind;
    /* path: one glob or an array of them */
    char *raw = json_get_raw(c->args, "path");
    char **items = NULL;
    int nitems = 0;
    char *owned[GREP_MAX_PATHS];
    int nowned = 0;
    if (raw && raw[0] == '[') {
        nitems = json_array_items(raw, &items);
        for (int i = 0; i < nitems && nowned < GREP_MAX_PATHS; i++) {
            char *s = json_string_value(items[i]);
            if (s) owned[nowned++] = s;
        }
    } else if (raw) {
        char *s = json_string_value(raw);
        if (s) owned[nowned++] = s;
    }
    for (int i = 0; i < nowned; i++) o.paths[o.npaths++] = owned[i];
    int rc = cmd_grep(c->cg, c->si, &o, true);
    for (int i = 0; i < nitems; i++) free(items[i]);
    free(items);
    for (int i = 0; i < nowned; i++) free(owned[i]);
    free(raw); free(lang); free(sym); free(kind); free(pat);
    return rc;
}
