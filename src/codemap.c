/*
 * cg codemap: CODEMAP.md, the repository in one read — what the project is
 * and how to build and test it, its layout, entry points, the modules and
 * the symbols they lean on, the dependencies between top-level directories,
 * where the tests live, and pointers to the workflow and agent files.
 *
 * Built from the graph plus a few manifests read from the tree, never from
 * a model: a purpose line is a file's own comment or a README's own words,
 * and where there is none the map says nothing. The same graph renders the
 * same bytes — no timestamps, no absolute paths, a total order everywhere —
 * and the map never counts itself, so writing it cannot make it stale.
 */
#include "cg.h"
#include <ctype.h>
#include <unistd.h>

#define CG_CODEMAP "CODEMAP.md"

/* The first line of every generated map; a file that does not start with
 * it is somebody else's and is never overwritten without --force. */
#define CM_MARKER "<!-- codify-owned: codemap v1"
#define CM_BUDGET 8000
#define CM_MIN_BUDGET 300

/* per-section caps: past these the map stops being an overview */
#define CAP_MOD_SYMS   12
#define CAP_MOD_FILES  40
#define CAP_MODULES    24
#define CAP_TEST_FILES 40
#define CAP_ROUTES     25
#define CAP_DEPS       30
#define CAP_DOCS       24
#define CAP_SUBDIRS    8
#define CAP_COMMANDS   96

/* The one place the default output path is decided, repo-relative. */
void codemap_default_path(const Cg *cg, char *out, size_t cap) {
    (void)cg;
    snprintf(out, cap, "%s", CG_CODEMAP);
}

/* The spec directory the workflow pointers name. */
static const char *cm_spec_dir(void) { return "spec"; }

/* ---------------- model ---------------- */

/* Every droppable entry carries one: the budget drops the lowest tier
 * first, the least referenced within a tier, and the later entry on a tie,
 * so the same graph always loses the same lines. */
typedef struct { int tier; long rank; int seq; bool drop; } Cut;

typedef struct {
    long id;
    char *path, *lang, *purpose;
    long lines, refs_in, imports_in, covers;
    bool test, fixture;
} CmFile;

typedef struct { char *name; long files, lines; Cut cut; } CmLang;
typedef struct { char *tool, *manifest, *dir, *cmds; Cut cut; } CmBuild;

typedef struct {
    char *path, *purpose, *role, *subs;  /* subs: compact child list */
    long files, lines;
    char lang[32];
    int depth, nsubs;
    Cut cut;
} CmDir;

typedef struct { char *path, *sig; char name[128]; int line; Cut cut; } CmMain;
typedef struct { char *manifest, *what; Cut cut; } CmPkg;
typedef struct {
    char *method, *pattern, *handler, *path;
    int line;
    Cut cut;
} CmRoute;

typedef struct { CmFile *f; Cut cut; } CmModFile;
typedef struct {
    char *name, *kind, *path, *sig;
    int line;
    long refs;
    Cut cut;
} CmSym;
typedef struct {
    char *path, *purpose;
    char lang[32];
    long files, lines, refs, nsyms;
    CmModFile *fv; int nf, cf;
    CmSym *sv; int ns, cs;
    Cut cut;
} CmMod;

typedef struct { char *from, *to; long imports, calls; Cut cut; } CmDep;

typedef struct { CmFile *f; Cut cut; } CmTestFile;
typedef struct {
    char *path, *covers;            /* covers: "`src/` (312)" list */
    long files;
    CmTestFile *tv; int nt, ct;
    Cut cut;
} CmTestDir;
typedef struct { char *path, *subs; long files; Cut cut; } CmFixture;

typedef struct { char *path, *what; Cut cut; } CmPtr;

typedef struct {
    Cg *cg;
    char skip[2][1024];
    int budget;

    char name[160];
    char *desc;
    long src_files, src_lines, fixture_files;

    CmFile *files; int nfiles, cfiles;
    struct { long id; int idx; } *byid;

    CmLang *langs; int nlang, clang;
    CmBuild *builds; int nbuild, cbuild;
    CmDir *dirs; int ndir, cdir;
    char *root_files, *hidden_dirs;
    CmMain *mains; int nmain, cmain;
    char *cmd_file, *cmd_list; Cut cmd_cut; int ncmds;
    CmPkg *pkgs; int npkg, cpkg;
    CmRoute *routes; int nroute, croute; long routes_total;
    CmMod *mods; int nmod, cmod; long mods_total;
    CmDep *deps; int ndep, cdep; long deps_total;
    CmTestDir *tdirs; int ntd, ctd;
    CmFixture *fixtures; int nfx, cfx;
    long covered, coverable;
    CmPtr *ptrs; int nptr, cptr;
    CmPtr *docs; int ndoc, cdoc; long docs_total;

    Cut **cuts; int ncut, ccut;
    int seq;
} Map;

#define VPUSH(v, n, c) \
    ((n) == (c) ? ((c) = (c) ? (c) * 2 : 16, \
                   (v) = xrealloc((v), sizeof *(v) * (size_t)(c))) : 0, \
     memset(&(v)[(n)], 0, sizeof *(v)), &(v)[(n)++])

/* Register a droppable entry. Pointers into a growable vector move on
 * realloc, so cuts are collected only after every vector is final. */
static void cut_init(Map *m, Cut *c, int tier, long rank) {
    c->tier = tier;
    c->rank = rank;
    c->seq = m->seq++;
    c->drop = false;
}
static void cut_add(Map *m, Cut *c) {
    if (m->ncut == m->ccut) {
        m->ccut = m->ccut ? m->ccut * 2 : 256;
        m->cuts = xrealloc(m->cuts, sizeof *m->cuts * (size_t)m->ccut);
    }
    m->cuts[m->ncut++] = c;
}

/* ---------------- text helpers ---------------- */

static const char *num(long n, char *buf) {          /* 39334 -> "39,334" */
    char t[32];
    snprintf(t, sizeof t, "%ld", n < 0 ? -n : n);
    int len = (int)strlen(t), o = 0;
    if (n < 0) buf[o++] = '-';
    for (int i = 0; i < len; i++) {
        if (i && (len - i) % 3 == 0) buf[o++] = ',';
        buf[o++] = t[i];
    }
    buf[o] = 0;
    return buf;
}

static bool starts_ci(const char *s, const char *pre) {
    return strncasecmp(s, pre, strlen(pre)) == 0;
}

/* A line of a comment with its leader and trailer stripped. */
static void strip_leader(const char **p, int *ll) {
    static const char *LEAD[] = { "/**", "/*!", "/*", "*/", "///", "//!",
                                  "//", "\"\"\"", "'''", "#", "--", ";;",
                                  "*", NULL };
    while (*ll > 0 && isspace((unsigned char)**p)) { (*p)++; (*ll)--; }
    for (int i = 0; LEAD[i]; i++) {
        int n = (int)strlen(LEAD[i]);
        if (*ll >= n && strncmp(*p, LEAD[i], (size_t)n) == 0) {
            *p += n; *ll -= n;
            break;
        }
    }
    while (*ll > 0 && isspace((unsigned char)**p)) { (*p)++; (*ll)--; }
    while (*ll > 0 && isspace((unsigned char)(*p)[*ll - 1])) (*ll)--;
    for (int k = 0; k < 2; k++) {
        if (*ll >= 2 && strncmp(*p + *ll - 2, "*/", 2) == 0) *ll -= 2;
        if (*ll >= 3 && (strncmp(*p + *ll - 3, "\"\"\"", 3) == 0 ||
                         strncmp(*p + *ll - 3, "'''", 3) == 0)) *ll -= 3;
        while (*ll > 0 && isspace((unsigned char)(*p)[*ll - 1])) (*ll)--;
    }
}

static bool has_alnum(const char *p, int ll) {
    for (int i = 0; i < ll; i++) if (isalnum((unsigned char)p[i])) return true;
    return false;
}

/* Legal boilerplate says nothing about what a file is for. */
static bool boilerplate(const char *p, int ll) {
    static const char *B[] = { "copyright", "spdx-", "(c)", "©",
                               "license", "licensed ", "all rights",
                               "-*-", "vim:", "eslint", "@ts-", "prettier",
                               "go:build", "+build", "nolint", NULL };
    char t[64];
    snprintf(t, sizeof t, "%.*s", ll < 63 ? ll : 63, p);
    for (int i = 0; B[i]; i++) if (starts_ci(t, B[i])) return true;
    return false;
}

/* Cut prose to its first sentence, at most max bytes on a word boundary. */
static char *sentence(const char *s, int max) {
    int n = (int)strlen(s), cut = n;
    for (int i = 0; i + 1 < n; i++) {
        if (s[i] == '.' && s[i + 1] == ' ' &&
            (i + 2 >= n || isupper((unsigned char)s[i + 2]) ||
             s[i + 2] == '`')) {
            bool abbr = i >= 3 && (strncmp(s + i - 3, "e.g", 3) == 0 ||
                                   strncmp(s + i - 3, "i.e", 3) == 0);
            if (!abbr) { cut = i + 1; break; }
        }
    }
    StrBuf b; sb_init(&b);
    if (cut > max) {
        int k = max;
        while (k > max / 2 && s[k] != ' ') k--;
        if (s[k] != ' ') k = max;
        while (k > 0 && (s[k - 1] == ' ' || s[k - 1] == ',' ||
                         s[k - 1] == ';' || s[k - 1] == ':')) k--;
        sb_printf(&b, "%.*s …", k, s);
    } else {
        sb_printf(&b, "%.*s", cut, s);
    }
    return b.p;
}

/* The first paragraph of prose in a comment, as one sentence: comment
 * leaders, blank fences, and legal boilerplate skipped; NULL when nothing
 * is left. */
static char *purpose_of(const char *body, int max) {
    StrBuf para; sb_init(&para);
    bool started = false;
    const char *p = body;
    while (p && *p) {
        const char *nl = strchr(p, '\n');
        int ll = nl ? (int)(nl - p) : (int)strlen(p);
        const char *q = p;
        int ql = ll;
        p = nl ? nl + 1 : NULL;
        if (ql >= 2 && q[0] == '#' && q[1] == '!') continue;   /* shebang */
        strip_leader(&q, &ql);
        if (!has_alnum(q, ql)) { if (started) break; continue; }
        if (boilerplate(q, ql)) { if (started) break; continue; }
        if (q[0] == '@') {
            if (started) break;
            if (ql > 7 && strncmp(q, "@brief ", 7) == 0) { q += 7; ql -= 7; }
            else if (ql > 6 && strncmp(q, "@file", 5) == 0) continue;
        }
        if (started) sb_putc(&para, ' ');
        sb_printf(&para, "%.*s", ql, q);
        started = true;
    }
    char *out = started ? sentence(para.p, max) : NULL;
    sb_free(&para);
    return out;
}

/* A markdown file's first heading, without the hashes. */
static char *md_title(const char *body) {
    for (const char *p = body; p && *p; ) {
        const char *nl = strchr(p, '\n');
        int ll = nl ? (int)(nl - p) : (int)strlen(p);
        if (ll > 2 && p[0] == '#' && p[1] == ' ') {
            const char *q = p + 2;
            int ql = ll - 2;
            while (ql > 0 && isspace((unsigned char)q[ql - 1])) ql--;
            if (ql > 0) {
                StrBuf b; sb_init(&b);
                sb_printf(&b, "%.*s", ql > 120 ? 120 : ql, q);
                return b.p;
            }
        }
        p = nl ? nl + 1 : NULL;
    }
    return NULL;
}

/* Drop markdown emphasis markers; links keep their text. */
static void md_plain(StrBuf *b, const char *p, int ll) {
    for (int i = 0; i < ll; i++) {
        if ((p[i] == '*' || p[i] == '_') && i + 1 < ll && p[i + 1] == p[i]) {
            i++;
            continue;
        }
        sb_putc(b, p[i]);
    }
}

/* A README's first prose paragraph: past the title, badges, images, HTML,
 * rules, and section headings. */
static char *readme_prose(const char *body, int max) {
    StrBuf para; sb_init(&para);
    bool started = false, fence = false;
    for (const char *p = body; p && *p; ) {
        const char *nl = strchr(p, '\n');
        int ll = nl ? (int)(nl - p) : (int)strlen(p);
        const char *q = p;
        p = nl ? nl + 1 : NULL;
        while (ll > 0 && isspace((unsigned char)*q)) { q++; ll--; }
        while (ll > 0 && isspace((unsigned char)q[ll - 1])) ll--;
        if (ll >= 3 && strncmp(q, "```", 3) == 0) { fence = !fence; continue; }
        if (fence) continue;
        bool skip = ll == 0 || q[0] == '#' || q[0] == '<' || q[0] == '[' ||
                    q[0] == '!' || q[0] == '|' || q[0] == '=' ||
                    (ll >= 3 && (strncmp(q, "---", 3) == 0 ||
                                 strncmp(q, "***", 3) == 0)) ||
                    !has_alnum(q, ll);
        if (skip) { if (started) break; continue; }
        if (q[0] == '>') { q++; ll--; while (ll && *q == ' ') { q++; ll--; } }
        if (started) sb_putc(&para, ' ');
        md_plain(&para, q, ll);
        started = true;
    }
    char *out = started ? sentence(para.p, max) : NULL;
    sb_free(&para);
    return out;
}

/* Strip a signature to its declaration: no body, no trailing brace. */
static char *clean_sig(const char *sig) {
    if (!sig) return NULL;
    StrBuf b; sb_init(&b);
    int depth = 0;
    for (const char *p = sig; *p && *p != '\n'; p++) {
        if (*p == '(' || *p == '[' || *p == '<') depth++;
        else if ((*p == ')' || *p == ']' || *p == '>') && depth > 0) depth--;
        else if (*p == '{' && depth == 0) break;
        sb_putc(&b, *p == '\t' ? ' ' : *p);
    }
    while (b.len && (b.p[b.len - 1] == ' ' || b.p[b.len - 1] == '=' ||
                     b.p[b.len - 1] == ';' || b.p[b.len - 1] == ':'))
        b.p[--b.len] = 0;
    if (b.len > 160) {
        b.len = 157;
        b.p[b.len] = 0;
        sb_puts(&b, "...");
    }
    if (!b.len) { sb_free(&b); return NULL; }
    return b.p;
}

/* ---------------- path classification ---------------- */

static bool cm_skipped(const Map *m, const char *path) {
    for (int i = 0; i < 2; i++)
        if (m->skip[i][0] && strcmp(m->skip[i], path) == 0) return true;
    return false;
}

/* fixture data is neither the product nor a test of it */
static bool cm_fixture(const char *path) {
    static const char *D[] = { "fixtures/", "__fixtures__/", "testdata/",
                               "__snapshots__/", "fixture/", NULL };
    for (int i = 0; D[i]; i++) {
        const char *h = strstr(path, D[i]);
        if (h && (h == path || h[-1] == '/')) return true;
    }
    return false;
}

static bool cm_test(const char *path) {
    return cm_fixture(path) || graph_path_is_test(path);
}

/* first path component ("" for a root file) */
static void top_dir(const char *path, char *out, size_t cap) {
    const char *s = strchr(path, '/');
    snprintf(out, cap, "%.*s", s ? (int)(s - path) : 0, path);
}

/* the directory of path, truncated to two components: the module key */
static void mod_dir(const char *path, char *out, size_t cap) {
    const char *last = strrchr(path, '/');
    if (!last) { snprintf(out, cap, "%s", ""); return; }
    const char *s1 = strchr(path, '/');
    const char *s2 = s1 && s1 < last ? strchr(s1 + 1, '/') : NULL;
    const char *end = s2 ? s2 : last;
    snprintf(out, cap, "%.*s", (int)(end - path), path);
}

static void fn_skip(sqlite3_context *c, int n, sqlite3_value **v) {
    (void)n;
    const char *p = (const char *)sqlite3_value_text(v[0]);
    sqlite3_result_int(c, p && cm_skipped(sqlite3_user_data(c), p));
}
static void fn_test(sqlite3_context *c, int n, sqlite3_value **v) {
    (void)n;
    const char *p = (const char *)sqlite3_value_text(v[0]);
    sqlite3_result_int(c, p && cm_test(p));
}
static void fn_top(sqlite3_context *c, int n, sqlite3_value **v) {
    (void)n;
    const char *p = (const char *)sqlite3_value_text(v[0]);
    char d[1024];
    top_dir(p ? p : "", d, sizeof d);
    sqlite3_result_text(c, d, -1, SQLITE_TRANSIENT);
}
static void fn_mod(sqlite3_context *c, int n, sqlite3_value **v) {
    (void)n;
    const char *p = (const char *)sqlite3_value_text(v[0]);
    char d[1024];
    mod_dir(p ? p : "", d, sizeof d);
    sqlite3_result_text(c, d, -1, SQLITE_TRANSIENT);
}

static void cm_functions(Map *m, bool on) {
    static const struct {
        const char *name;
        void (*fn)(sqlite3_context *, int, sqlite3_value **);
    } F[] = { { "cm_skip", fn_skip }, { "cm_test", fn_test },
              { "cm_top", fn_top }, { "cm_mod", fn_mod } };
    for (size_t i = 0; i < sizeof F / sizeof F[0]; i++)
        sqlite3_create_function(m->cg->db, F[i].name, 1,
                                SQLITE_UTF8 | SQLITE_DETERMINISTIC, m,
                                on ? F[i].fn : NULL, NULL, NULL);
}

/* One statement with the branch predicate for alias spliced in; head must
 * end inside a WHERE clause. */
static sqlite3_stmt *cm_prep(Map *m, const char *alias, const char *head,
                             const char *tail) {
    char scope[64];
    branch_scope_sql(m->cg, alias, scope, sizeof scope);
    StrBuf q; sb_init(&q);
    sb_printf(&q, "%s%s%s", head, scope, tail);
    sqlite3_stmt *st = cg_prep(m->cg, q.p);
    sb_free(&q);
    return st;
}

static const char *col(sqlite3_stmt *st, int i) {
    const char *s = (const char *)sqlite3_column_text(st, i);
    return s ? s : "";
}

static int byid_cmp(const void *a, const void *b) {
    long x = *(const long *)a, y = *(const long *)b;
    return x < y ? -1 : x > y;
}

static CmFile *file_by_id(Map *m, long id) {
    int lo = 0, hi = m->nfiles - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        if (m->byid[mid].id == id) return &m->files[m->byid[mid].idx];
        if (m->byid[mid].id < id) lo = mid + 1; else hi = mid - 1;
    }
    return NULL;
}

static CmFile *file_by_path(Map *m, const char *path) {
    int lo = 0, hi = m->nfiles - 1;
    while (lo <= hi) {
        int mid = (lo + hi) / 2;
        int c = strcmp(m->files[mid].path, path);
        if (c == 0) return &m->files[mid];
        if (c < 0) lo = mid + 1; else hi = mid - 1;
    }
    return NULL;
}

/* The files under directory dir ("" = every file) as [*lo, *hi): paths
 * sharing a prefix are contiguous in the byte-sorted list, so a
 * per-directory walk is a bisection plus that directory's own files. */
static void dir_range(const Map *m, const char *dir, int *lo, int *hi) {
    if (!dir[0]) { *lo = 0; *hi = m->nfiles; return; }
    char pre[1100];
    snprintf(pre, sizeof pre, "%s/", dir);
    size_t pl = strlen(pre);
    int a = 0, b = m->nfiles;
    while (a < b) {
        int mid = a + (b - a) / 2;
        if (strcmp(m->files[mid].path, pre) < 0) a = mid + 1; else b = mid;
    }
    *lo = a;
    for (b = a; b < m->nfiles && strncmp(m->files[b].path, pre, pl) == 0; b++)
        ;
    *hi = b;
}

static char *tree_read(Map *m, const char *rel) {
    char abs[5200];
    if (!path_format(abs, sizeof abs, "%s/%s", m->cg->root, rel)) return NULL;
    return read_entire_file(abs, NULL);
}

/* ---------------- collection ---------------- */

static void load_files(Map *m) {
    /* ordered by path with the C locale's byte order, which strcmp shares,
     * so file_by_path can bisect it */
    sqlite3_stmt *st = cm_prep(m, "f",
        "SELECT f.id, f.path, f.lang, IFNULL(f.lines,0) FROM files f "
        "WHERE NOT cm_skip(f.path)", " ORDER BY f.path COLLATE BINARY");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmFile *f = VPUSH(m->files, m->nfiles, m->cfiles);
        f->id = sqlite3_column_int64(st, 0);
        f->path = xstrdup(col(st, 1));
        f->lang = sqlite3_column_type(st, 2) == SQLITE_NULL
                ? NULL : xstrdup(col(st, 2));
        f->lines = sqlite3_column_int64(st, 3);
        f->fixture = cm_fixture(f->path);
        f->test = f->fixture || graph_path_is_test(f->path);
    }
    sqlite3_finalize(st);
    m->byid = xmalloc(sizeof *m->byid * (size_t)(m->nfiles ? m->nfiles : 1));
    for (int i = 0; i < m->nfiles; i++) {
        m->byid[i].id = m->files[i].id;
        m->byid[i].idx = i;
    }
    qsort(m->byid, (size_t)m->nfiles, sizeof *m->byid, byid_cmp);

    st = cm_prep(m, "f",
        "SELECT c.file_id, c.body FROM comments c JOIN files f "
        "ON f.id=c.file_id WHERE c.kind='file'", " ORDER BY c.file_id, c.line");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmFile *f = file_by_id(m, sqlite3_column_int64(st, 0));
        if (!f || f->purpose) continue;
        f->purpose = purpose_of(col(st, 1), 160);
    }
    sqlite3_finalize(st);

    st = cm_prep(m, "rf",
        "SELECT s.file_id, COUNT(*) FROM refs r JOIN files rf ON "
        "rf.id=r.file_id JOIN symbols s ON s.id=r.target_id "
        "WHERE r.kind='call' AND r.file_id<>s.file_id AND NOT cm_skip(rf.path)",
        " GROUP BY s.file_id");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmFile *f = file_by_id(m, sqlite3_column_int64(st, 0));
        if (f) f->refs_in = sqlite3_column_int64(st, 1);
    }
    sqlite3_finalize(st);

    st = cm_prep(m, "rf",
        "SELECT i.target_file_id, COUNT(*) FROM imports i JOIN files rf ON "
        "rf.id=i.file_id WHERE i.target_file_id IS NOT NULL AND "
        "i.file_id<>i.target_file_id AND NOT cm_skip(rf.path)",
        " GROUP BY i.target_file_id");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmFile *f = file_by_id(m, sqlite3_column_int64(st, 0));
        if (f) f->imports_in = sqlite3_column_int64(st, 1);
    }
    sqlite3_finalize(st);
}

static void load_name(Map *m) {
    CmFile *rd = file_by_path(m, "README.md");
    if (!rd) rd = file_by_path(m, "README");
    if (!rd) rd = file_by_path(m, "readme.md");
    if (rd) {
        char *body = tree_read(m, rd->path);
        if (body) {
            char *t = md_title(body);
            if (t) {
                StrBuf b; sb_init(&b);
                md_plain(&b, t, (int)strlen(t));
                snprintf(m->name, sizeof m->name, "%s", b.p);
                sb_free(&b);
                free(t);
            }
            m->desc = readme_prose(body, 300);
            free(body);
        }
    }
    if (!m->name[0] || !m->desc) {
        char *pj = file_by_path(m, "package.json") ? tree_read(m, "package.json")
                                                   : NULL;
        if (pj) {
            char *n = json_get_string(pj, "name");
            char *d = json_get_string(pj, "description");
            if (!m->name[0] && n && n[0]) snprintf(m->name, sizeof m->name, "%s", n);
            if (!m->desc && d && d[0]) m->desc = sentence(d, 300);
            free(n); free(d);
            free(pj);
        }
    }
    static const char *MANI[] = { "Cargo.toml", "pyproject.toml", NULL };
    for (int i = 0; MANI[i] && !m->name[0]; i++) {
        if (!file_by_path(m, MANI[i])) continue;
        char *body = tree_read(m, MANI[i]);
        const char *p = body ? strstr(body, "\nname") : NULL;
        if (p) {
            p = strchr(p, '"');
            const char *e = p ? strchr(p + 1, '"') : NULL;
            if (e) snprintf(m->name, sizeof m->name, "%.*s",
                            (int)(e - p - 1), p + 1);
        }
        free(body);
    }
    if (!m->name[0] && file_by_path(m, "go.mod")) {
        char *body = tree_read(m, "go.mod");
        if (body && strncmp(body, "module ", 7) == 0) {
            const char *e = body + 7 + strcspn(body + 7, " \r\n");
            const char *s = e;
            while (s > body + 7 && s[-1] != '/') s--;
            snprintf(m->name, sizeof m->name, "%.*s", (int)(e - s), s);
        }
        free(body);
    }
    if (!m->name[0]) {
        const char *b = strrchr(m->cg->root, '/');
        snprintf(m->name, sizeof m->name, "%.159s", b && b[1] ? b + 1 : m->cg->root);
    }
}

static int lang_cmp(const void *a, const void *b) {
    const CmLang *x = a, *y = b;
    if (x->files != y->files) return x->files < y->files ? 1 : -1;
    if (x->lines != y->lines) return x->lines < y->lines ? 1 : -1;
    return strcmp(x->name, y->name);
}

static void load_langs(Map *m) {
    for (int i = 0; i < m->nfiles; i++) {
        CmFile *f = &m->files[i];
        if (!f->lang) continue;
        if (f->fixture) { m->fixture_files++; continue; }
        m->src_files++;
        m->src_lines += f->lines;
        CmLang *l = NULL;
        for (int k = 0; k < m->nlang; k++)
            if (strcmp(m->langs[k].name, f->lang) == 0) { l = &m->langs[k]; break; }
        if (!l) {
            l = VPUSH(m->langs, m->nlang, m->clang);
            l->name = xstrdup(f->lang);
        }
        l->files++;
        l->lines += f->lines;
    }
    qsort(m->langs, (size_t)m->nlang, sizeof *m->langs, lang_cmp);
    for (int i = 0; i < m->nlang; i++)
        cut_init(m, &m->langs[i].cut, 3, m->langs[i].files);
}

/* manifest directory, "" at the root */
static void dir_of(const char *path, char *out, size_t cap) {
    const char *s = strrchr(path, '/');
    snprintf(out, cap, "%.*s", s ? (int)(s - path) : 0, path);
}

static void add_build(Map *m, const char *tool, const char *manifest,
                      const char *cmds) {
    CmBuild *b = VPUSH(m->builds, m->nbuild, m->cbuild);
    char d[1024];
    dir_of(manifest, d, sizeof d);
    b->tool = xstrdup(tool);
    b->manifest = xstrdup(manifest);
    b->dir = xstrdup(d);
    b->cmds = xstrdup(cmds);
    int depth = 0;
    for (const char *p = manifest; *p; p++) depth += *p == '/';
    cut_init(m, &b->cut, 3, 100 - depth);
}

/* Makefile targets in file order: the default first, pattern rules and
 * variables out. */
static void make_targets(const char *body, StrBuf *b) {
    char seen[64][64];
    int ns = 0;
    for (const char *p = body; p && *p; ) {
        const char *nl = strchr(p, '\n');
        int ll = nl ? (int)(nl - p) : (int)strlen(p);
        const char *line = p;
        p = nl ? nl + 1 : NULL;
        if (!ll || !(isalnum((unsigned char)line[0]) || line[0] == '_')) continue;
        const char *colon = memchr(line, ':', (size_t)ll);
        if (!colon || (colon + 1 < line + ll && colon[1] == '=')) continue;
        bool var = false;
        for (const char *q = line; q < colon; q++)
            if (*q == '=' || *q == '$' || *q == '%' || *q == '(') var = true;
        if (var) continue;
        for (const char *q = line; q < colon; ) {
            while (q < colon && isspace((unsigned char)*q)) q++;
            const char *s = q;
            while (q < colon && !isspace((unsigned char)*q)) q++;
            if (q == s || q - s >= 64 || ns >= 64) continue;
            char t[64];
            snprintf(t, sizeof t, "%.*s", (int)(q - s), s);
            if (strchr(t, '/') || strchr(t, '.')) continue;   /* file targets */
            bool dup = false;
            for (int k = 0; k < ns; k++) if (strcmp(seen[k], t) == 0) dup = true;
            if (dup) continue;
            snprintf(seen[ns++], 64, "%s", t);
            if (b->len) sb_puts(b, ", ");
            if (ns == 1) sb_printf(b, "`make` (default: `%s`)", t);
            else         sb_printf(b, "`make %s`", t);
        }
    }
}

static void load_builds(Map *m) {
    for (int i = 0; i < m->nfiles; i++) {
        CmFile *f = &m->files[i];
        if (f->test) continue;
        const char *base = strrchr(f->path, '/');
        base = base ? base + 1 : f->path;
        bool root = base == f->path;
        StrBuf c; sb_init(&c);
        const char *tool = NULL;
        if (strcmp(base, "Makefile") == 0 || strcmp(base, "GNUmakefile") == 0 ||
            strcmp(base, "makefile") == 0) {
            char *body = tree_read(m, f->path);
            if (body) make_targets(body, &c);
            free(body);
            tool = "make";
        } else if (strcmp(base, "package.json") == 0) {
            char *body = tree_read(m, f->path);
            char *scripts = body ? json_get_object(body, "scripts") : NULL;
            if (scripts) {
                char *keys[32];
                int nk = json_object_keys(scripts, keys, 32);
                for (int k = 0; k < nk; k++) {
                    if (c.len) sb_puts(&c, ", ");
                    if (strcmp(keys[k], "test") == 0 ||
                        strcmp(keys[k], "start") == 0)
                        sb_printf(&c, "`npm %s`", keys[k]);
                    else
                        sb_printf(&c, "`npm run %s`", keys[k]);
                    free(keys[k]);
                }
                free(scripts);
            }
            free(body);
            if (!c.len) sb_puts(&c, "`npm install`");
            tool = "npm";
        } else if (strcmp(base, "go.mod") == 0) {
            sb_puts(&c, "`go build ./...`, `go test ./...`");
            tool = "go";
        } else if (strcmp(base, "Cargo.toml") == 0) {
            sb_puts(&c, "`cargo build`, `cargo test`");
            tool = "cargo";
        } else if (strcmp(base, "pyproject.toml") == 0 ||
                   (root && strcmp(base, "setup.py") == 0)) {
            sb_puts(&c, "`python -m pip install -e .`, `python -m pytest`");
            tool = "python";
        } else if (root && strcmp(base, "CMakeLists.txt") == 0) {
            sb_puts(&c, "`cmake -S . -B build && cmake --build build`, "
                        "`ctest --test-dir build`");
            tool = "cmake";
        } else if (strcmp(base, "pom.xml") == 0) {
            sb_puts(&c, "`mvn package`, `mvn test`");
            tool = "maven";
        } else if (strcmp(base, "build.gradle") == 0 ||
                   strcmp(base, "build.gradle.kts") == 0) {
            sb_puts(&c, "`./gradlew build`, `./gradlew test`");
            tool = "gradle";
        } else if (root && strcmp(base, "Rakefile") == 0) {
            sb_puts(&c, "`bundle exec rake`");
            tool = "rake";
        }
        if (tool && c.len) add_build(m, tool, f->path, c.p);
        sb_free(&c);
    }
}

/* ---- layout ---- */

/* a directory's own words: its README, else the comment of the file that
 * stands for it (index.ts, __init__.py, mod.rs, doc.go, <dir>.go) */
static char *dir_purpose(Map *m, const char *dir) {
    static const char *RD[] = { "README.md", "README", "readme.md",
                                "README.rst", "README.txt", NULL };
    char p[2048];
    for (int i = 0; RD[i]; i++) {
        snprintf(p, sizeof p, "%s/%s", dir, RD[i]);
        if (!file_by_path(m, p)) continue;
        char *body = tree_read(m, p);
        char *s = body ? readme_prose(body, 160) : NULL;
        free(body);
        if (s) return s;
    }
    const char *bn = strrchr(dir, '/');
    bn = bn ? bn + 1 : dir;
    size_t dl = strlen(dir);
    int lo, hi;
    dir_range(m, dir, &lo, &hi);
    for (int i = lo; i < hi; i++) {
        CmFile *f = &m->files[i];
        if (!f->purpose || strchr(f->path + dl + 1, '/')) continue;
        const char *b = f->path + dl + 1;
        size_t stem = strcspn(b, ".");
        static const char *IDX[] = { "index", "__init__", "mod", "lib", "doc",
                                     "package-info", NULL };
        bool hit = stem == strlen(bn) && strncmp(b, bn, stem) == 0;
        for (int k = 0; IDX[k] && !hit; k++)
            hit = stem == strlen(IDX[k]) && strncmp(b, IDX[k], stem) == 0;
        if (hit) return xstrdup(f->purpose);
    }
    return NULL;
}

static CmDir *dir_get(Map *m, const char *path, int depth) {
    for (int i = 0; i < m->ndir; i++)
        if (strcmp(m->dirs[i].path, path) == 0) return &m->dirs[i];
    CmDir *d = VPUSH(m->dirs, m->ndir, m->cdir);
    d->path = xstrdup(path);
    d->depth = depth;
    return d;
}

static int dir_cmp(const void *a, const void *b) {
    return strcmp(((const CmDir *)a)->path, ((const CmDir *)b)->path);
}

static void load_layout(Map *m) {
    StrBuf rootf; sb_init(&rootf);
    typedef struct { char lang[32]; long n; } LN;
    int last1 = -1, last2 = -1;
    for (int i = 0; i < m->nfiles; i++) {
        CmFile *f = &m->files[i];
        const char *s1 = strchr(f->path, '/');
        if (!s1) {
            if (rootf.len) sb_puts(&rootf, ", ");
            sb_printf(&rootf, "`%s`", f->path);
            continue;
        }
        /* sorted paths: a directory's files arrive together, so only a
         * change of directory pays for the lookup */
        char d1[1024], d2[1024];
        snprintf(d1, sizeof d1, "%.*s", (int)(s1 - f->path), f->path);
        if (last1 < 0 || strcmp(m->dirs[last1].path, d1) != 0)
            last1 = (int)(dir_get(m, d1, 1) - m->dirs);
        m->dirs[last1].files++;
        m->dirs[last1].lines += f->lines;
        const char *s2 = strchr(s1 + 1, '/');
        if (s2) {
            snprintf(d2, sizeof d2, "%.*s", (int)(s2 - f->path), f->path);
            if (last2 < 0 || strcmp(m->dirs[last2].path, d2) != 0)
                last2 = (int)(dir_get(m, d2, 2) - m->dirs);
            m->dirs[last2].files++;
            m->dirs[last2].lines += f->lines;
        }
    }
    m->root_files = rootf.len ? rootf.p : (sb_free(&rootf), NULL);
    qsort(m->dirs, (size_t)m->ndir, sizeof *m->dirs, dir_cmp);

    for (int i = 0; i < m->ndir; i++) {
        CmDir *d = &m->dirs[i];
        LN ln[16];
        int nln = 0, ntest = 0, nfix = 0, nall = 0, lo, hi;
        long refs = 0;
        dir_range(m, d->path, &lo, &hi);
        for (int k = lo; k < hi; k++) {
            CmFile *f = &m->files[k];
            nall++;
            refs += f->refs_in;
            if (f->fixture) nfix++;
            else if (f->test) ntest++;
            if (!f->lang) continue;
            int j = 0;
            while (j < nln && strcmp(ln[j].lang, f->lang) != 0) j++;
            if (j == nln && nln < 16) {
                snprintf(ln[nln].lang, sizeof ln[0].lang, "%s", f->lang);
                ln[nln++].n = 0;
            }
            if (j < nln) ln[j].n++;
        }
        long best = 0;
        for (int j = 0; j < nln; j++)
            if (ln[j].n > best ||
                (ln[j].n == best && strcmp(ln[j].lang, d->lang) < 0)) {
                best = ln[j].n;
                snprintf(d->lang, sizeof d->lang, "%.31s", ln[j].lang);
            }
        if (nfix && nfix * 2 >= nall) d->role = xstrdup("test fixtures");
        else if (ntest && (ntest + nfix) * 2 >= nall) d->role = xstrdup("tests");
        d->purpose = dir_purpose(m, d->path);
        cut_init(m, &d->cut, d->depth == 1 ? 2 : 1, refs);
    }
    /* a top-level directory with many children lists them by name instead */
    for (int i = 0; i < m->ndir; i++) {
        CmDir *d = &m->dirs[i];
        if (d->depth != 1) continue;
        size_t dl = strlen(d->path);
        StrBuf s; sb_init(&s);
        for (int k = 0; k < m->ndir; k++) {
            CmDir *c = &m->dirs[k];
            if (c->depth != 2 || strncmp(c->path, d->path, dl) != 0 ||
                c->path[dl] != '/')
                continue;
            if (s.len) sb_puts(&s, ", ");
            sb_printf(&s, "`%s/`", c->path + dl + 1);
            d->nsubs++;
        }
        if (d->nsubs > CAP_SUBDIRS) d->subs = s.p; else sb_free(&s);
    }
    /* hidden top-level directories: one line, they are tool configuration */
    StrBuf h; sb_init(&h);
    for (int i = 0; i < m->ndir; i++) {
        CmDir *d = &m->dirs[i];
        if (d->depth != 1 || d->path[0] != '.') continue;
        char n[32];
        if (h.len) sb_puts(&h, ", ");
        sb_printf(&h, "`%s/` (%s)", d->path, num(d->files, n));
    }
    m->hidden_dirs = h.len ? h.p : (sb_free(&h), NULL);
}

/* is d listed on its own line: hidden dirs and children of a collapsed
 * parent are not */
static bool dir_listed(const Map *m, const CmDir *d) {
    if (d->path[0] == '.') return false;
    if (d->depth == 1) return true;
    char top[1024];
    top_dir(d->path, top, sizeof top);
    for (int i = 0; i < m->ndir; i++)
        if (m->dirs[i].depth == 1 && strcmp(m->dirs[i].path, top) == 0)
            return !m->dirs[i].subs;
    return false;
}

/* ---- entry points ---- */

static bool word_ok(const char *s, int n) {
    if (n < 1 || n > 40 || !islower((unsigned char)s[0])) return false;
    for (int i = 0; i < n; i++)
        if (!isalnum((unsigned char)s[i]) && s[i] != '-' && s[i] != '_' &&
            s[i] != ':')
            return false;
    return true;
}

static void cmd_push(StrBuf *b, int *n, char seen[][48], const char *s, int len) {
    if (!word_ok(s, len) || *n >= CAP_COMMANDS) return;
    for (int i = 0; i < *n; i++)
        if ((int)strlen(seen[i]) == len && strncmp(seen[i], s, (size_t)len) == 0)
            return;
    snprintf(seen[(*n)++], 48, "%.*s", len, s);
    if (b->len) sb_puts(b, ", ");
    sb_printf(b, "`%.*s`", len, s);
}

/* Subcommands a main dispatches on, read from its file: strcmp(cmd, "x")
 * in C, case "x" over os.Args in Go, .command("x") in JS/TS, add_parser("x")
 * in Python. File order, each once. */
static int scan_commands(const char *body, StrBuf *b) {
    static char seen[CAP_COMMANDS][48];
    int n = 0;
    static const char *VAR[] = { "cmd", "command", "sub", "subcmd", "verb",
                                 "action", "argv[1]", NULL };
    bool goargs = strstr(body, "os.Args") != NULL;
    for (const char *p = body; *p; p++) {
        if (strncmp(p, "strcmp(", 7) == 0) {
            const char *q = p + 7;
            while (*q == ' ') q++;
            for (int i = 0; VAR[i]; i++) {
                size_t vl = strlen(VAR[i]);
                if (strncmp(q, VAR[i], vl) != 0) continue;
                const char *r = q + vl;
                while (*r == ' ') r++;
                if (*r != ',') continue;
                r++;
                while (*r == ' ') r++;
                if (*r != '"') continue;
                const char *e = strchr(r + 1, '"');
                if (e) cmd_push(b, &n, seen, r + 1, (int)(e - r - 1));
            }
        } else if (goargs && strncmp(p, "case \"", 6) == 0) {
            const char *r = p + 5;
            while (*r == '"') {
                const char *e = strchr(r + 1, '"');
                if (!e) break;
                cmd_push(b, &n, seen, r + 1, (int)(e - r - 1));
                r = e + 1;
                while (*r == ',' || *r == ' ') r++;
            }
        } else if (strncmp(p, ".command(", 9) == 0 ||
                   strncmp(p, "add_parser(", 11) == 0) {
            const char *r = strchr(p, '(') + 1;
            if (*r != '"' && *r != '\'') continue;
            char qc = *r;
            const char *e = strchr(r + 1, qc);
            if (!e) continue;
            int len = (int)strcspn(r + 1, " <[");
            if (len > (int)(e - r - 1)) len = (int)(e - r - 1);
            cmd_push(b, &n, seen, r + 1, len);
        }
    }
    return n;
}

static void load_entries(Map *m) {
    sqlite3_stmt *st = cm_prep(m, "f",
        "SELECT f.path, s.name, s.line, s.sig FROM symbols s JOIN files f "
        "ON f.id=s.file_id WHERE s.name IN ('main','Main','__main__') "
        "AND NOT cm_test(f.path) AND NOT cm_skip(f.path)",
        " ORDER BY f.path COLLATE BINARY, s.line");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmMain *e = VPUSH(m->mains, m->nmain, m->cmain);
        e->path = xstrdup(col(st, 0));
        snprintf(e->name, sizeof e->name, "%s", col(st, 1));
        e->line = sqlite3_column_int(st, 2);
        e->sig = clean_sig(col(st, 3));
        CmFile *f = file_by_path(m, e->path);
        cut_init(m, &e->cut, 2, f ? f->refs_in : 0);
    }
    sqlite3_finalize(st);

    for (int i = 0; i < m->nmain && !m->cmd_list; i++) {
        char *body = tree_read(m, m->mains[i].path);
        if (!body) continue;
        StrBuf b; sb_init(&b);
        int n = scan_commands(body, &b);
        free(body);
        if (n >= 2) {
            m->cmd_file = xstrdup(m->mains[i].path);
            m->cmd_list = b.p;
            m->ncmds = n;
            cut_init(m, &m->cmd_cut, 2, n);
        } else {
            sb_free(&b);
        }
    }

    for (int i = 0; i < m->nfiles; i++) {
        CmFile *f = &m->files[i];
        const char *base = strrchr(f->path, '/');
        base = base ? base + 1 : f->path;
        if (f->test || strcmp(base, "package.json") != 0) continue;
        char *body = tree_read(m, f->path);
        if (!body) continue;
        StrBuf w; sb_init(&w);
        char *mainf = json_get_string(body, "main");
        if (mainf && mainf[0]) sb_printf(&w, "main `%s`", mainf);
        free(mainf);
        char *bin = json_get_raw(body, "bin");
        if (bin && bin[0] == '"') {
            char *v = json_string_value(bin);
            if (v) {
                sb_printf(&w, "%sbin `%s`", w.len ? ", " : "", v);
                free(v);
            }
        } else if (bin && bin[0] == '{') {
            char *keys[16];
            int nk = json_object_keys(bin, keys, 16);
            for (int k = 0; k < nk; k++) {
                char *v = json_get_string(bin, keys[k]);
                sb_printf(&w, "%sbin `%s` → `%s`", w.len ? ", " : "", keys[k],
                          v ? v : "");
                free(v);
                free(keys[k]);
            }
        }
        free(bin);
        free(body);
        if (w.len) {
            CmPkg *p = VPUSH(m->pkgs, m->npkg, m->cpkg);
            p->manifest = xstrdup(f->path);
            p->what = w.p;
            cut_init(m, &p->cut, 2, 0);
        } else {
            sb_free(&w);
        }
    }

    st = cm_prep(m, "f",
        "SELECT IFNULL(r.method,''), IFNULL(r.pattern,''), r.handler, f.path, "
        "r.line FROM routes r JOIN files f ON f.id=r.file_id "
        "WHERE NOT cm_test(f.path) AND NOT cm_skip(f.path)",
        " ORDER BY r.pattern COLLATE BINARY, r.method COLLATE BINARY, "
        "f.path COLLATE BINARY, r.line");
    while (sqlite3_step(st) == SQLITE_ROW) {
        m->routes_total++;
        if (m->nroute >= CAP_ROUTES) continue;
        CmRoute *r = VPUSH(m->routes, m->nroute, m->croute);
        r->method = xstrdup(col(st, 0));
        r->pattern = xstrdup(col(st, 1));
        r->handler = sqlite3_column_type(st, 2) == SQLITE_NULL
                   ? NULL : xstrdup(col(st, 2));
        r->path = xstrdup(col(st, 3));
        r->line = sqlite3_column_int(st, 4);
        cut_init(m, &r->cut, 1, 0);
    }
    sqlite3_finalize(st);
}

/* ---- modules ---- */

static int modfile_cmp(const void *a, const void *b) {
    const CmModFile *x = a, *y = b;
    long rx = x->f->refs_in + x->f->imports_in, ry = y->f->refs_in + y->f->imports_in;
    if (rx != ry) return rx < ry ? 1 : -1;
    return strcmp(x->f->path, y->f->path);
}

static int mod_cmp(const void *a, const void *b) {
    const CmMod *x = a, *y = b;
    if (x->refs != y->refs) return x->refs < y->refs ? 1 : -1;
    if (x->lines != y->lines) return x->lines < y->lines ? 1 : -1;
    return strcmp(x->path, y->path);
}

static CmMod *mod_lookup(Map *m, const char *path) {
    for (int i = 0; i < m->nmod; i++)
        if (strcmp(m->mods[i].path, path) == 0) return &m->mods[i];
    return NULL;
}

static void load_modules(Map *m) {
    for (int i = 0; i < m->nfiles; i++) {
        CmFile *f = &m->files[i];
        if (!f->lang || f->test) continue;
        char key[1024];
        mod_dir(f->path, key, sizeof key);
        CmMod *d = mod_lookup(m, key);
        if (!d) {
            d = VPUSH(m->mods, m->nmod, m->cmod);
            d->path = xstrdup(key);
        }
        d->files++;
        d->lines += f->lines;
        d->refs += f->refs_in + f->imports_in;
    }
    qsort(m->mods, (size_t)m->nmod, sizeof *m->mods, mod_cmp);
    m->mods_total = m->nmod;
    if (m->nmod > CAP_MODULES) m->nmod = CAP_MODULES;  /* rest: omitted */

    for (int i = 0; i < m->nmod; i++) {
        CmMod *d = &m->mods[i];
        size_t dl = strlen(d->path);
        typedef struct { char lang[32]; long n; } LN;
        LN ln[16];
        int nln = 0, lo, hi;
        dir_range(m, d->path, &lo, &hi);
        for (int k = lo; k < hi; k++) {
            CmFile *f = &m->files[k];
            if (!f->lang || f->test) continue;
            char key[1024];
            mod_dir(f->path, key, sizeof key);
            if (strcmp(key, d->path) != 0) continue;
            CmModFile *mf = VPUSH(d->fv, d->nf, d->cf);
            mf->f = f;
            int j = 0;
            while (j < nln && strcmp(ln[j].lang, f->lang) != 0) j++;
            if (j == nln && nln < 16) {
                snprintf(ln[nln].lang, sizeof ln[0].lang, "%s", f->lang);
                ln[nln++].n = 0;
            }
            if (j < nln) ln[j].n++;
        }
        long best = 0;
        for (int j = 0; j < nln; j++)
            if (ln[j].n > best) {
                best = ln[j].n;
                snprintf(d->lang, sizeof d->lang, "%.31s", ln[j].lang);
            }
        qsort(d->fv, (size_t)d->nf, sizeof *d->fv, modfile_cmp);
        d->purpose = dl ? dir_purpose(m, d->path) : NULL;
    }

    /* top symbols per module in one pass: a window over every symbol in a
     * product source file, ranked by the calls that resolve to it */
    sqlite3_stmt *st = cm_prep(m, "f",
        "SELECT m, name, kind, path, line, sig, n, tot FROM ("
        " SELECT cm_mod(f.path) m, s.name, s.kind, f.path, s.line, s.sig,"
        "  IFNULL(c.n,0) n,"
        "  ROW_NUMBER() OVER (PARTITION BY cm_mod(f.path) ORDER BY"
        "   IFNULL(c.n,0) DESC, f.path COLLATE BINARY, s.line,"
        "   s.name COLLATE BINARY) rn,"
        "  COUNT(*) OVER (PARTITION BY cm_mod(f.path)) tot"
        " FROM symbols s JOIN files f ON f.id=s.file_id"
        " LEFT JOIN (SELECT r.target_id id, COUNT(*) n FROM refs r"
        "  JOIN files rf ON rf.id=r.file_id WHERE r.kind='call'"
        "  AND r.target_id IS NOT NULL AND NOT cm_skip(rf.path)"
        "  GROUP BY r.target_id) c ON c.id=s.id"
        " WHERE f.lang IS NOT NULL AND NOT cm_test(f.path)"
        " AND NOT cm_skip(f.path)",
        ") WHERE rn <= 48 ORDER BY m COLLATE BINARY, rn");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmMod *d = mod_lookup(m, col(st, 0));
        if (!d) continue;
        d->nsyms = sqlite3_column_int64(st, 7);
        if (d->ns >= CAP_MOD_SYMS) continue;
        const char *name = col(st, 1);
        size_t nl = strlen(name);
        if (strcmp(col(st, 2), "macro") == 0 && sqlite3_column_int64(st, 6) == 0
            && ((nl > 2 && strcmp(name + nl - 2, "_H") == 0) ||
                (nl > 3 && strcmp(name + nl - 3, "_H_") == 0)))
            continue;                                    /* include guard */
        bool dup = false;     /* a prototype and its definition: one entry */
        for (int k = 0; k < d->ns && !dup; k++)
            dup = strcmp(d->sv[k].name, name) == 0;
        if (dup) continue;
        CmSym *y = VPUSH(d->sv, d->ns, d->cs);
        y->name = xstrdup(name);
        y->kind = xstrdup(col(st, 2));
        y->path = xstrdup(col(st, 3));
        y->line = sqlite3_column_int(st, 4);
        y->sig = clean_sig(col(st, 5));
        y->refs = sqlite3_column_int64(st, 6);
    }
    sqlite3_finalize(st);

    for (int i = 0; i < m->nmod; i++) {
        CmMod *d = &m->mods[i];
        long top = 0;
        for (int k = 0; k < d->ns; k++) if (d->sv[k].refs > top) top = d->sv[k].refs;
        for (int k = 0; k < d->nf && k < CAP_MOD_FILES; k++) {
            long r = d->fv[k].f->refs_in + d->fv[k].f->imports_in;
            if (r > top) top = r;
        }
        cut_init(m, &d->cut, 0, top);
    }
    for (int i = 0; i < m->nmod; i++) {
        CmMod *d = &m->mods[i];
        for (int k = 0; k < d->nf && k < CAP_MOD_FILES; k++)
            cut_init(m, &d->fv[k].cut, 0,
                     d->fv[k].f->refs_in + d->fv[k].f->imports_in);
        for (int k = 0; k < d->ns; k++)
            cut_init(m, &d->sv[k].cut, 0, d->sv[k].refs);
    }
}

/* ---- dependencies ---- */

static CmDep *dep_get(Map *m, const char *a, const char *b) {
    for (int i = 0; i < m->ndep; i++)
        if (strcmp(m->deps[i].from, a) == 0 && strcmp(m->deps[i].to, b) == 0)
            return &m->deps[i];
    CmDep *d = VPUSH(m->deps, m->ndep, m->cdep);
    d->from = xstrdup(a);
    d->to = xstrdup(b);
    return d;
}

static int dep_cmp(const void *a, const void *b) {
    const CmDep *x = a, *y = b;
    long tx = x->imports + x->calls, ty = y->imports + y->calls;
    if (tx != ty) return tx < ty ? 1 : -1;
    int c = strcmp(x->from, y->from);
    return c ? c : strcmp(x->to, y->to);
}

static void load_deps(Map *m) {
    sqlite3_stmt *st = cm_prep(m, "rf",
        "SELECT cm_top(rf.path), cm_top(sf.path), COUNT(*) FROM refs r "
        "JOIN files rf ON rf.id=r.file_id JOIN symbols s ON s.id=r.target_id "
        "JOIN files sf ON sf.id=s.file_id WHERE r.kind='call' "
        "AND NOT cm_skip(rf.path)", " GROUP BY 1, 2");
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (strcmp(col(st, 0), col(st, 1)) == 0) continue;
        dep_get(m, col(st, 0), col(st, 1))->calls += sqlite3_column_int64(st, 2);
    }
    sqlite3_finalize(st);
    st = cm_prep(m, "rf",
        "SELECT cm_top(rf.path), cm_top(tf.path), COUNT(*) FROM imports i "
        "JOIN files rf ON rf.id=i.file_id JOIN files tf ON "
        "tf.id=i.target_file_id WHERE NOT cm_skip(rf.path)", " GROUP BY 1, 2");
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (strcmp(col(st, 0), col(st, 1)) == 0) continue;
        dep_get(m, col(st, 0), col(st, 1))->imports += sqlite3_column_int64(st, 2);
    }
    sqlite3_finalize(st);
    qsort(m->deps, (size_t)m->ndep, sizeof *m->deps, dep_cmp);
    m->deps_total = m->ndep;
    if (m->ndep > CAP_DEPS) m->ndep = CAP_DEPS;
    for (int i = 0; i < m->ndep; i++)
        cut_init(m, &m->deps[i].cut, 0, m->deps[i].imports + m->deps[i].calls);
}

/* ---- tests ---- */

/* a script's leading comment, for test files the graph does not parse */
static char *script_purpose(Map *m, const char *path) {
    const char *ext = path_ext(path);
    if (!ext || (strcmp(ext, ".sh") && strcmp(ext, ".bash") &&
                 strcmp(ext, ".bats")))
        return NULL;
    char *body = tree_read(m, path);
    if (!body) return NULL;
    StrBuf c; sb_init(&c);
    for (const char *p = body; p && *p; ) {
        const char *nl = strchr(p, '\n');
        int ll = nl ? (int)(nl - p) : (int)strlen(p);
        if (ll >= 2 && p[0] == '#' && p[1] == '!') { p = nl ? nl + 1 : NULL; continue; }
        if (ll < 1 || p[0] != '#') break;
        sb_printf(&c, "%.*s\n", ll, p);
        p = nl ? nl + 1 : NULL;
    }
    free(body);
    char *out = c.len ? purpose_of(c.p, 160) : NULL;
    sb_free(&c);
    return out;
}

static CmTestDir *tdir_lookup(Map *m, const char *path) {
    for (int i = 0; i < m->ntd; i++)
        if (strcmp(m->tdirs[i].path, path) == 0) return &m->tdirs[i];
    return NULL;
}

/* the fixture root a path sits under: everything up to the fixture dir */
static void fixture_root(const char *path, char *out, size_t cap) {
    static const char *D[] = { "fixtures/", "__fixtures__/", "testdata/",
                               "__snapshots__/", "fixture/", NULL };
    for (int i = 0; D[i]; i++) {
        const char *h = strstr(path, D[i]);
        if (h && (h == path || h[-1] == '/')) {
            snprintf(out, cap, "%.*s", (int)(h - path + strlen(D[i]) - 1), path);
            return;
        }
    }
    snprintf(out, cap, "%s", path);
}

static int tfile_cmp(const void *a, const void *b) {
    const CmTestFile *x = a, *y = b;
    if (x->f->covers != y->f->covers) return x->f->covers < y->f->covers ? 1 : -1;
    return strcmp(x->f->path, y->f->path);
}

static int tdir_cmp(const void *a, const void *b) {
    return strcmp(((const CmTestDir *)a)->path, ((const CmTestDir *)b)->path);
}

static void load_tests(Map *m) {
    sqlite3_stmt *st = cm_prep(m, "rf",
        "SELECT r.file_id, COUNT(DISTINCT r.target_id) FROM refs r "
        "JOIN files rf ON rf.id=r.file_id JOIN symbols s ON s.id=r.target_id "
        "JOIN files sf ON sf.id=s.file_id WHERE r.kind='call' "
        "AND cm_test(rf.path) AND NOT cm_test(sf.path)", " GROUP BY r.file_id");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmFile *f = file_by_id(m, sqlite3_column_int64(st, 0));
        if (f) f->covers = sqlite3_column_int64(st, 1);
    }
    sqlite3_finalize(st);

    for (int i = 0; i < m->nfiles; i++) {
        CmFile *f = &m->files[i];
        if (!f->test) continue;
        if (f->fixture) {
            char root[1024];
            fixture_root(f->path, root, sizeof root);
            CmFixture *x = NULL;
            for (int k = 0; k < m->nfx; k++)
                if (strcmp(m->fixtures[k].path, root) == 0) x = &m->fixtures[k];
            if (!x) {
                x = VPUSH(m->fixtures, m->nfx, m->cfx);
                x->path = xstrdup(root);
            }
            x->files++;
            continue;
        }
        char key[1024];
        mod_dir(f->path, key, sizeof key);
        CmTestDir *d = tdir_lookup(m, key);
        if (!d) {
            d = VPUSH(m->tdirs, m->ntd, m->ctd);
            d->path = xstrdup(key);
        }
        d->files++;
        CmTestFile *t = VPUSH(d->tv, d->nt, d->ct);
        t->f = f;
        if (!f->purpose) f->purpose = script_purpose(m, f->path);
    }

    for (int i = 0; i < m->nfx; i++) {
        CmFixture *x = &m->fixtures[i];
        size_t xl = strlen(x->path);
        StrBuf s; sb_init(&s);
        char last[256] = "";
        int n = 0, lo, hi;
        dir_range(m, x->path, &lo, &hi);
        for (int k = lo; k < hi; k++) {
            const char *p = m->files[k].path;
            const char *sub = p + xl + 1, *sl = strchr(sub, '/');
            if (!sl) continue;
            char nm[256];
            snprintf(nm, sizeof nm, "%.*s", (int)(sl - sub), sub);
            if (strcmp(nm, last) == 0) continue;
            snprintf(last, sizeof last, "%s", nm);
            if (n++ < 16) sb_printf(&s, "%s`%s/`", s.len ? ", " : "", nm);
        }
        if (n > 16) sb_printf(&s, " and %d more", n - 16);
        x->subs = s.len ? s.p : (sb_free(&s), NULL);
        cut_init(m, &x->cut, 1, x->files);
    }

    st = cm_prep(m, "rf",
        "SELECT cm_mod(rf.path), cm_mod(sf.path), COUNT(DISTINCT r.target_id) "
        "FROM refs r JOIN files rf ON rf.id=r.file_id JOIN symbols s ON "
        "s.id=r.target_id JOIN files sf ON sf.id=s.file_id WHERE r.kind='call' "
        "AND cm_test(rf.path) AND NOT cm_test(sf.path)",
        " GROUP BY 1, 2 ORDER BY 1 COLLATE BINARY, 3 DESC, 2 COLLATE BINARY");
    while (sqlite3_step(st) == SQLITE_ROW) {
        CmTestDir *d = tdir_lookup(m, col(st, 0));
        if (!d) continue;
        StrBuf c; sb_init(&c);
        if (d->covers) sb_printf(&c, "%s, ", d->covers);
        sb_printf(&c, "`%s/` (%lld)", col(st, 1)[0] ? col(st, 1) : ".",
                  (long long)sqlite3_column_int64(st, 2));
        free(d->covers);
        d->covers = c.p;
    }
    sqlite3_finalize(st);

    st = cm_prep(m, "rf",
        "SELECT COUNT(DISTINCT r.target_id) FROM refs r JOIN files rf ON "
        "rf.id=r.file_id JOIN symbols s ON s.id=r.target_id JOIN files sf ON "
        "sf.id=s.file_id WHERE r.kind='call' AND s.kind IN ('function','method') "
        "AND cm_test(rf.path) AND NOT cm_test(sf.path) AND NOT cm_skip(sf.path)",
        "");
    if (sqlite3_step(st) == SQLITE_ROW) m->covered = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    st = cm_prep(m, "f",
        "SELECT COUNT(*) FROM symbols s JOIN files f ON f.id=s.file_id WHERE "
        "s.kind IN ('function','method') AND f.lang IS NOT NULL AND "
        "NOT cm_test(f.path) AND NOT cm_skip(f.path)", "");
    if (sqlite3_step(st) == SQLITE_ROW) m->coverable = sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);

    qsort(m->tdirs, (size_t)m->ntd, sizeof *m->tdirs, tdir_cmp);
    for (int i = 0; i < m->ntd; i++) {
        CmTestDir *d = &m->tdirs[i];
        qsort(d->tv, (size_t)d->nt, sizeof *d->tv, tfile_cmp);
        cut_init(m, &d->cut, 1, d->files);
    }
    for (int i = 0; i < m->ntd; i++) {
        CmTestDir *d = &m->tdirs[i];
        for (int k = 0; k < d->nt && k < CAP_TEST_FILES; k++)
            cut_init(m, &d->tv[k].cut, 0, d->tv[k].f->covers);
    }
}

/* ---- workflow and agent files ---- */

static void add_ptr(Map *m, const char *path, const char *what) {
    CmPtr *p = VPUSH(m->ptrs, m->nptr, m->cptr);
    p->path = xstrdup(path);
    p->what = xstrdup(what);
    cut_init(m, &p->cut, 2, 0);
}

static void load_pointers(Map *m) {
    char p[1100];
    const char *sd = cm_spec_dir();
    snprintf(p, sizeof p, "%s/workflow.kvx", sd);
    if (file_by_path(m, p)) {
        StrBuf w; sb_init(&w);
        sb_puts(&w, "the spec workflow: principles, the session loop "
                    "(`cg brief`, `cg spec next`, `cg spec start <id>`, "
                    "`cg spec done <id>`), and hard rules");
        char abs[5200];
        Kvx *k = path_format(abs, sizeof abs, "%s/%s", m->cg->root, p)
               ? kvx_parse(abs) : NULL;
        char *feat = k ? kvx_str(k, "meta", "active_feature") : NULL;
        kvx_free(k);
        add_ptr(m, p, w.p);
        sb_free(&w);
        char fp[1400];
        if (feat && feat[0] &&
            path_format(fp, sizeof fp, "%s/%s/spec.kvx", sd, feat) &&
            file_by_path(m, fp))
            add_ptr(m, fp, "the active feature: requirements, acceptance "
                           "criteria, and the task list in waves");
        free(feat);
    }
    static const struct { const char *path, *what; } AG[] = {
        { "AGENTS.md", "instructions for coding agents" },
        { "CLAUDE.md", "instructions for Claude Code" },
        { "GEMINI.md", "instructions for Gemini CLI" },
        { ".github/copilot-instructions.md", "instructions for GitHub Copilot" },
        { ".cursorrules", "instructions for Cursor" },
        { ".windsurfrules", "instructions for Windsurf" },
        { "CONVENTIONS.md", "coding conventions" },
        { "CONTRIBUTING.md", "how to contribute" },
        { CG_AGENT_CONTEXT, "graph orientation generated by `cg agentmd`" },
        { NULL, NULL }
    };
    for (int i = 0; AG[i].path; i++)
        if (file_by_path(m, AG[i].path)) add_ptr(m, AG[i].path, AG[i].what);
    static const char *SK[] = { ".agents/skills/", ".claude/skills/", NULL };
    for (int i = 0; SK[i]; i++) {
        int n = 0;
        size_t sl = strlen(SK[i]);
        for (int k = 0; k < m->nfiles; k++) {
            const char *f = m->files[k].path;
            const char *b = strrchr(f, '/');
            if (strncmp(f, SK[i], sl) == 0 && b && strcmp(b, "/SKILL.md") == 0)
                n++;
        }
        if (n) {
            char what[64], d[64];
            snprintf(what, sizeof what, "%d agent skill%s (SKILL.md)", n,
                     n == 1 ? "" : "s");
            snprintf(d, sizeof d, "%.*s", (int)sl - 1, SK[i]);
            add_ptr(m, d, what);
        }
    }

    /* prose docs: root-level markdown beyond the README and the files named
     * above, then docs/ one level deep, each by its title */
    for (int pass = 0; pass < 2; pass++) {
        for (int k = 0; k < m->nfiles; k++) {
            const char *f = m->files[k].path;
            const char *ext = path_ext(f);
            if (!ext || strcasecmp(ext, ".md") != 0) continue;
            const char *sl = strchr(f, '/');
            if (pass == 0 ? sl != NULL
                          : (strncmp(f, "docs/", 5) != 0 || strchr(f + 5, '/')))
                continue;
            if (pass == 0 && (starts_ci(f, "README") || starts_ci(f, "CHANGELOG")))
                continue;
            bool named = false;
            for (int i = 0; AG[i].path && !named; i++)
                named = strcmp(AG[i].path, f) == 0;
            if (named) continue;
            m->docs_total++;
            if (m->ndoc >= CAP_DOCS) continue;
            char *body = tree_read(m, f);
            char *t = body ? md_title(body) : NULL;
            free(body);
            CmPtr *d = VPUSH(m->docs, m->ndoc, m->cdoc);
            d->path = xstrdup(f);
            if (t) {
                StrBuf b; sb_init(&b);
                md_plain(&b, t, (int)strlen(t));
                d->what = b.p;
                free(t);
            }
            cut_init(m, &d->cut, 0, 0);
        }
    }
}

/* ---------------- rendering ---------------- */

static bool kept(const Cut *c) { return !c->drop; }

static void md_section_omitted(StrBuf *b, const char *what) {
    if (what[0]) sb_printf(b, "\n_Not shown: %s._\n", what);
}

static void omit_add(StrBuf *o, long n, const char *one, const char *many) {
    if (n <= 0) return;
    char t[32];
    if (o->len) sb_puts(o, ", ");
    sb_printf(o, "%s %s", num(n, t), n == 1 ? one : many);
}

static void render_md(Map *m, StrBuf *b) {
    char t1[32], t2[32];
    sb_printf(b, "%s budget=%d — GENERATED by `cg codemap` from the code "
                 "graph. Do not edit: run `cg codemap` to regenerate. -->\n",
              CM_MARKER, m->budget);
    sb_printf(b, "# %s — code map\n\n", m->name);
    if (m->desc) sb_printf(b, "> %s\n\n", m->desc);
    sb_puts(b, "Read this first. It is derived from the code graph: purpose "
               "lines are the code's own comments, symbols are ranked by the "
               "calls that resolve to them. Go deeper with `cg context "
               "<query>`, `cg survey <dir>`, `cg symbol <name>`, and "
               "`cg impact <name>`.\n\n");

    /* ---- overview ---- */
    StrBuf om; sb_init(&om);
    sb_puts(b, "## Overview\n\n");
    int shown = 0, dropped = 0;
    for (int i = 0; i < m->nlang; i++) {
        if (!kept(&m->langs[i].cut)) { dropped++; continue; }
        if (!shown++) sb_puts(b, "| Language | Files | Lines |\n|---|---:|---:|\n");
        sb_printf(b, "| %s | %s | %s |\n", m->langs[i].name,
                  num(m->langs[i].files, t1), num(m->langs[i].lines, t2));
    }
    sb_printf(b, "%s%s source files, %s lines", shown ? "\n" : "",
              num(m->src_files, t1), num(m->src_lines, t2));
    if (m->fixture_files)
        sb_printf(b, " (test fixtures not counted: %s more)",
                  num(m->fixture_files, t1));
    sb_puts(b, ".\n");
    omit_add(&om, dropped, "language", "languages");
    shown = dropped = 0;
    for (int i = 0; i < m->nbuild; i++) {
        CmBuild *x = &m->builds[i];
        if (!kept(&x->cut)) { dropped++; continue; }
        if (!shown++) sb_puts(b, "\nBuild and test:\n\n");
        sb_printf(b, "- %s (`%s`", x->tool, x->manifest);
        if (x->dir[0]) sb_printf(b, ", run in `%s/`", x->dir);
        sb_printf(b, "): %s\n", x->cmds);
    }
    if (!m->nbuild) sb_puts(b, "\nNo build manifest detected.\n");
    omit_add(&om, dropped, "build manifest", "build manifests");
    md_section_omitted(b, om.p);
    sb_putc(b, '\n');

    /* ---- layout ---- */
    om.len = 0; om.p[0] = 0;
    sb_puts(b, "## Layout\n\n");
    dropped = 0;
    for (int i = 0; i < m->ndir; i++) {
        CmDir *d = &m->dirs[i];
        if (!dir_listed(m, d)) continue;
        if (!kept(&d->cut)) { dropped++; continue; }
        if (d->depth == 2) {
            char top[1024];
            top_dir(d->path, top, sizeof top);
            bool parent = false;
            for (int k = 0; k < m->ndir; k++)
                if (m->dirs[k].depth == 1 && strcmp(m->dirs[k].path, top) == 0)
                    parent = kept(&m->dirs[k].cut);
            if (!parent) { dropped++; continue; }
        }
        sb_printf(b, "%s- `%s/` — %s file%s", d->depth == 2 ? "  " : "",
                  d->path, num(d->files, t1), d->files == 1 ? "" : "s");
        if (d->lines) sb_printf(b, ", %s lines", num(d->lines, t2));
        if (d->lang[0]) sb_printf(b, ", mostly %s", d->lang);
        if (d->role) sb_printf(b, " (%s)", d->role);
        if (d->purpose) sb_printf(b, ". %s", d->purpose);
        sb_putc(b, '\n');
        if (d->subs) sb_printf(b, "  - %d subdirectories: %s\n", d->nsubs, d->subs);
    }
    if (m->root_files) sb_printf(b, "\nRoot files: %s\n", m->root_files);
    if (m->hidden_dirs) sb_printf(b, "\nHidden directories: %s\n", m->hidden_dirs);
    omit_add(&om, dropped, "directory", "directories");
    md_section_omitted(b, om.p);
    sb_putc(b, '\n');

    /* ---- entry points ---- */
    om.len = 0; om.p[0] = 0;
    sb_puts(b, "## Entry points\n\n");
    shown = dropped = 0;
    for (int i = 0; i < m->nmain; i++) {
        CmMain *e = &m->mains[i];
        if (!kept(&e->cut)) { dropped++; continue; }
        shown++;
        sb_printf(b, "- `%s` — `%s:%d`", e->name, e->path, e->line);
        if (e->sig) sb_printf(b, " `%s`", e->sig);
        sb_putc(b, '\n');
    }
    omit_add(&om, dropped, "main function", "main functions");
    if (m->cmd_list) {
        if (kept(&m->cmd_cut)) {
            shown++;
            sb_printf(b, "- Commands dispatched in `%s`: %s\n", m->cmd_file,
                      m->cmd_list);
        } else {
            omit_add(&om, 1, "command list", "command lists");
        }
    }
    dropped = 0;
    for (int i = 0; i < m->npkg; i++) {
        if (!kept(&m->pkgs[i].cut)) { dropped++; continue; }
        shown++;
        sb_printf(b, "- `%s`: %s\n", m->pkgs[i].manifest, m->pkgs[i].what);
    }
    omit_add(&om, dropped, "package entry", "package entries");
    int rshown = 0;
    for (int i = 0; i < m->nroute; i++) {
        CmRoute *r = &m->routes[i];
        if (!kept(&r->cut)) continue;
        if (!rshown++) sb_printf(b, "%sRoutes:\n\n", shown ? "\n" : "");
        sb_printf(b, "- `%s %s` — `%s:%d`", r->method, r->pattern, r->path,
                  r->line);
        if (r->handler) sb_printf(b, " → `%s`", r->handler);
        sb_putc(b, '\n');
    }
    shown += rshown;
    omit_add(&om, m->routes_total - rshown, "route", "routes");
    if (!shown) sb_puts(b, "No `main`, command dispatch, package entry, or "
                           "route found.\n");
    md_section_omitted(b, om.p);
    sb_putc(b, '\n');

    /* ---- modules ---- */
    om.len = 0; om.p[0] = 0;
    sb_puts(b, "## Modules\n\nProduct source by directory, most referenced "
               "first: key files by the references they receive, then the "
               "symbols the rest of the code calls most.\n");
    long mod_drop = m->mods_total - m->nmod, fdrop = 0, sdrop = 0;
    for (int i = 0; i < m->nmod; i++) {
        CmMod *d = &m->mods[i];
        if (!kept(&d->cut)) {
            mod_drop++;
            continue;
        }
        sb_printf(b, "\n### `%s/` — %s file%s, %s lines, %s\n\n",
                  d->path[0] ? d->path : ".", num(d->files, t1),
                  d->files == 1 ? "" : "s", num(d->lines, t2), d->lang);
        if (d->purpose) sb_printf(b, "%s\n\n", d->purpose);
        long mf = 0, ms = 0;
        int fs = 0;
        for (int k = 0; k < d->nf; k++) {
            CmModFile *x = &d->fv[k];
            if (k >= CAP_MOD_FILES || !kept(&x->cut)) { mf++; continue; }
            if (!fs++) sb_puts(b, "Key files:\n\n");
            sb_printf(b, "- `%s`", x->f->path);
            long r = x->f->refs_in + x->f->imports_in;
            if (r) sb_printf(b, " (%s inbound ref%s)", num(r, t1),
                             r == 1 ? "" : "s");
            if (x->f->purpose) sb_printf(b, " — %s", x->f->purpose);
            sb_putc(b, '\n');
        }
        int ss = 0;
        for (int k = 0; k < d->ns; k++) {
            CmSym *y = &d->sv[k];
            if (!kept(&y->cut)) continue;
            if (!ss++) sb_printf(b, "%sMost-referenced symbols:\n\n", fs ? "\n" : "");
            sb_printf(b, "- `%s` %s — `%s:%d`", y->name, y->kind, y->path, y->line);
            if (y->refs) sb_printf(b, ", %s ref%s", num(y->refs, t1),
                                   y->refs == 1 ? "" : "s");
            if (y->sig) sb_printf(b, "\n  `%s`", y->sig);
            sb_putc(b, '\n');
        }
        ms = d->nsyms - ss;
        if (mf || ms) {
            StrBuf mo; sb_init(&mo);
            omit_add(&mo, mf, "file", "files");
            omit_add(&mo, ms, "symbol", "symbols");
            sb_printf(b, "\n_Also %s — `cg survey %s%s`_\n", mo.p,
                      d->path, d->path[0] ? "/" : ".");
            sb_free(&mo);
        }
        fdrop += mf;
        sdrop += ms;
    }
    if (!m->mods_total) sb_puts(b, "\nNo product source files indexed.\n");
    omit_add(&om, mod_drop, "module", "modules");
    omit_add(&om, fdrop, "file", "files");
    omit_add(&om, sdrop, "symbol", "symbols");
    md_section_omitted(b, om.p);
    sb_putc(b, '\n');

    /* ---- dependencies ---- */
    om.len = 0; om.p[0] = 0;
    sb_puts(b, "## Dependencies\n\nBetween top-level directories, from "
               "resolved imports and calls (`.` is the root):\n\n");
    shown = 0;
    for (int i = 0; i < m->ndep; i++) {
        CmDep *d = &m->deps[i];
        if (!kept(&d->cut)) continue;
        shown++;
        sb_printf(b, "- `%s%s` → `%s%s`: ", d->from[0] ? d->from : ".",
                  d->from[0] ? "/" : "", d->to[0] ? d->to : ".",
                  d->to[0] ? "/" : "");
        if (d->imports) sb_printf(b, "%s import%s", num(d->imports, t1),
                                  d->imports == 1 ? "" : "s");
        if (d->imports && d->calls) sb_puts(b, ", ");
        if (d->calls) sb_printf(b, "%s call%s", num(d->calls, t2),
                                d->calls == 1 ? "" : "s");
        sb_putc(b, '\n');
    }
    if (!m->deps_total)
        sb_puts(b, "- none: no resolved import or call crosses a top-level "
                   "directory\n");
    omit_add(&om, m->deps_total - shown, "edge", "edges");
    md_section_omitted(b, om.p);
    sb_putc(b, '\n');

    /* ---- tests ---- */
    om.len = 0; om.p[0] = 0;
    sb_puts(b, "## Tests\n\n");
    StrBuf run; sb_init(&run);
    for (int i = 0; i < m->nbuild; i++) {
        if (!kept(&m->builds[i].cut)) continue;
        const char *c = m->builds[i].cmds;
        for (const char *p = c; (p = strchr(p, '`')); ) {
            const char *e = strchr(p + 1, '`');
            if (!e) break;
            if (memmem(p, (size_t)(e - p), "test", 4))
                sb_printf(&run, "%s%.*s", run.len ? ", " : "", (int)(e - p + 1), p);
            p = e + 1;
        }
    }
    if (run.len) sb_printf(b, "Run: %s\n\n", run.p);
    sb_free(&run);
    if (m->coverable)
        sb_printf(b, "Test code calls %s of the %s functions in product "
                     "source directly (tests that drive a built binary are "
                     "not counted).\n\n", num(m->covered, t1),
                  num(m->coverable, t2));
    long tdrop = 0, tddrop = 0;
    shown = 0;
    for (int i = 0; i < m->ntd; i++) {
        CmTestDir *d = &m->tdirs[i];
        if (!kept(&d->cut)) { tddrop++; continue; }
        shown++;
        sb_printf(b, "- `%s/` — %s test file%s", d->path[0] ? d->path : ".",
                  num(d->files, t1), d->files == 1 ? "" : "s");
        if (d->covers) sb_printf(b, "; calls into %s", d->covers);
        sb_putc(b, '\n');
        long dd = 0;
        for (int k = 0; k < d->nt; k++) {
            CmTestFile *x = &d->tv[k];
            if (k >= CAP_TEST_FILES || !kept(&x->cut)) { dd++; continue; }
            const char *bn = x->f->path + (d->path[0] ? strlen(d->path) + 1 : 0);
            sb_printf(b, "  - `%s`", bn);
            if (x->f->purpose) sb_printf(b, " — %s", x->f->purpose);
            sb_putc(b, '\n');
        }
        if (dd) sb_printf(b, "  - _+%s more_\n", num(dd, t1));
        tdrop += dd;
    }
    for (int i = 0; i < m->nfx; i++) {
        CmFixture *x = &m->fixtures[i];
        if (!kept(&x->cut)) { tddrop++; continue; }
        shown++;
        sb_printf(b, "- `%s/` — %s fixture file%s", x->path, num(x->files, t1),
                  x->files == 1 ? "" : "s");
        if (x->subs) sb_printf(b, ": %s", x->subs);
        sb_putc(b, '\n');
    }
    if (!m->ntd && !m->nfx) sb_puts(b, "No test files found.\n");
    omit_add(&om, tddrop, "test directory", "test directories");
    omit_add(&om, tdrop, "test file", "test files");
    md_section_omitted(b, om.p);
    sb_putc(b, '\n');

    /* ---- workflow ---- */
    om.len = 0; om.p[0] = 0;
    sb_puts(b, "## Workflow and agent files\n\n");
    shown = dropped = 0;
    for (int i = 0; i < m->nptr; i++) {
        if (!kept(&m->ptrs[i].cut)) { dropped++; continue; }
        shown++;
        sb_printf(b, "- `%s` — %s\n", m->ptrs[i].path, m->ptrs[i].what);
    }
    if (!m->nptr) sb_puts(b, "No spec workflow or agent instruction file "
                             "found.\n");
    omit_add(&om, dropped, "pointer", "pointers");
    int ds = 0;
    for (int i = 0; i < m->ndoc; i++) {
        if (!kept(&m->docs[i].cut)) continue;
        if (!ds++) sb_puts(b, "\nDocs:\n\n");
        sb_printf(b, "- `%s`", m->docs[i].path);
        if (m->docs[i].what) sb_printf(b, " — %s", m->docs[i].what);
        sb_putc(b, '\n');
    }
    omit_add(&om, m->docs_total - ds, "doc", "docs");
    md_section_omitted(b, om.p);
    sb_free(&om);
}

/* JSON: the same kept entries as the markdown, keys in a fixed order */
static void js_str_or_null(StrBuf *b, const char *s) {
    if (s) sb_json_str(b, s); else sb_puts(b, "null");
}

static void render_json(Map *m, StrBuf *b, long md_len) {
    sb_puts(b, "{\"format\":\"codemap\",\"version\":1,\"name\":");
    sb_json_str(b, m->name);
    sb_puts(b, ",\"description\":");
    js_str_or_null(b, m->desc);
    sb_printf(b, ",\"budget\":%d,\"tokens\":%ld", m->budget, (md_len + 3) / 4);

    long dropped = 0;
    int n = 0;
    sb_printf(b, ",\"overview\":{\"source_files\":%ld,\"source_lines\":%ld,"
                 "\"languages\":[", m->src_files, m->src_lines);
    for (int i = 0; i < m->nlang; i++) {
        if (!kept(&m->langs[i].cut)) { dropped++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"name\":");
        sb_json_str(b, m->langs[i].name);
        sb_printf(b, ",\"files\":%ld,\"lines\":%ld}", m->langs[i].files,
                  m->langs[i].lines);
    }
    sb_puts(b, "],\"build\":[");
    n = 0;
    for (int i = 0; i < m->nbuild; i++) {
        CmBuild *x = &m->builds[i];
        if (!kept(&x->cut)) { dropped++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"tool\":");     sb_json_str(b, x->tool);
        sb_puts(b, ",\"manifest\":"); sb_json_str(b, x->manifest);
        sb_puts(b, ",\"dir\":");      sb_json_str(b, x->dir);
        sb_puts(b, ",\"commands\":["); /* the backticked commands, unquoted */
        int c = 0;
        for (const char *p = x->cmds; (p = strchr(p, '`')); ) {
            const char *e = strchr(p + 1, '`');
            if (!e) break;
            char cmd[512];
            snprintf(cmd, sizeof cmd, "%.*s", (int)(e - p - 1), p + 1);
            if (c++) sb_putc(b, ',');
            sb_json_str(b, cmd);
            p = e + 1;
        }
        sb_puts(b, "]}");
    }
    sb_printf(b, "],\"omitted\":%ld}", dropped);

    sb_puts(b, ",\"layout\":{\"directories\":[");
    n = 0; dropped = 0;
    for (int i = 0; i < m->ndir; i++) {
        CmDir *d = &m->dirs[i];
        if (!dir_listed(m, d)) continue;
        bool parent = true;
        if (d->depth == 2) {
            char top[1024];
            top_dir(d->path, top, sizeof top);
            for (int k = 0; k < m->ndir; k++)
                if (m->dirs[k].depth == 1 && strcmp(m->dirs[k].path, top) == 0)
                    parent = kept(&m->dirs[k].cut);
        }
        if (!kept(&d->cut) || !parent) { dropped++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"path\":");   sb_json_str(b, d->path);
        sb_printf(b, ",\"depth\":%d,\"files\":%ld,\"lines\":%ld,\"language\":",
                  d->depth, d->files, d->lines);
        js_str_or_null(b, d->lang[0] ? d->lang : NULL);
        sb_puts(b, ",\"role\":");    js_str_or_null(b, d->role);
        sb_puts(b, ",\"purpose\":"); js_str_or_null(b, d->purpose);
        sb_puts(b, ",\"subdirectories\":");
        js_str_or_null(b, d->subs);
        sb_putc(b, '}');
    }
    sb_puts(b, "],\"root_files\":");
    js_str_or_null(b, m->root_files);
    sb_puts(b, ",\"hidden\":");
    js_str_or_null(b, m->hidden_dirs);
    sb_printf(b, ",\"omitted\":%ld}", dropped);

    sb_puts(b, ",\"entry_points\":{\"mains\":[");
    n = 0; dropped = 0;
    for (int i = 0; i < m->nmain; i++) {
        CmMain *e = &m->mains[i];
        if (!kept(&e->cut)) { dropped++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"name\":"); sb_json_str(b, e->name);
        sb_puts(b, ",\"path\":"); sb_json_str(b, e->path);
        sb_printf(b, ",\"line\":%d,\"signature\":", e->line);
        js_str_or_null(b, e->sig);
        sb_putc(b, '}');
    }
    sb_puts(b, "],\"commands\":");
    if (m->cmd_list && kept(&m->cmd_cut)) {
        sb_puts(b, "{\"file\":");
        sb_json_str(b, m->cmd_file);
        sb_puts(b, ",\"names\":[");
        int c = 0;
        for (const char *p = m->cmd_list; (p = strchr(p, '`')); ) {
            const char *e = strchr(p + 1, '`');
            if (!e) break;
            char w[64];
            snprintf(w, sizeof w, "%.*s", (int)(e - p - 1), p + 1);
            if (c++) sb_putc(b, ',');
            sb_json_str(b, w);
            p = e + 1;
        }
        sb_puts(b, "]}");
    } else {
        if (m->cmd_list) dropped++;
        sb_puts(b, "null");
    }
    sb_puts(b, ",\"packages\":[");
    n = 0;
    for (int i = 0; i < m->npkg; i++) {
        if (!kept(&m->pkgs[i].cut)) { dropped++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"manifest\":"); sb_json_str(b, m->pkgs[i].manifest);
        sb_puts(b, ",\"entry\":");    sb_json_str(b, m->pkgs[i].what);
        sb_putc(b, '}');
    }
    sb_puts(b, "],\"routes\":[");
    n = 0;
    for (int i = 0; i < m->nroute; i++) {
        CmRoute *r = &m->routes[i];
        if (!kept(&r->cut)) continue;
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"method\":");  sb_json_str(b, r->method);
        sb_puts(b, ",\"pattern\":"); sb_json_str(b, r->pattern);
        sb_puts(b, ",\"handler\":"); js_str_or_null(b, r->handler);
        sb_puts(b, ",\"path\":");    sb_json_str(b, r->path);
        sb_printf(b, ",\"line\":%d}", r->line);
    }
    dropped += m->routes_total - n;
    sb_printf(b, "],\"omitted\":%ld}", dropped);

    sb_puts(b, ",\"modules\":{\"items\":[");
    long mod_drop = m->mods_total - m->nmod, fdrop = 0, sdrop = 0;
    n = 0;
    for (int i = 0; i < m->nmod; i++) {
        CmMod *d = &m->mods[i];
        if (!kept(&d->cut)) { mod_drop++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"path\":"); sb_json_str(b, d->path);
        sb_printf(b, ",\"files\":%ld,\"lines\":%ld,\"language\":", d->files,
                  d->lines);
        sb_json_str(b, d->lang);
        sb_puts(b, ",\"purpose\":"); js_str_or_null(b, d->purpose);
        sb_puts(b, ",\"key_files\":[");
        int c = 0;
        long mf = 0;
        for (int k = 0; k < d->nf; k++) {
            CmModFile *x = &d->fv[k];
            if (k >= CAP_MOD_FILES || !kept(&x->cut)) { mf++; continue; }
            if (c++) sb_putc(b, ',');
            sb_puts(b, "{\"path\":"); sb_json_str(b, x->f->path);
            sb_printf(b, ",\"refs_in\":%ld,\"purpose\":",
                      x->f->refs_in + x->f->imports_in);
            js_str_or_null(b, x->f->purpose);
            sb_putc(b, '}');
        }
        sb_puts(b, "],\"symbols\":[");
        c = 0;
        for (int k = 0; k < d->ns; k++) {
            CmSym *y = &d->sv[k];
            if (!kept(&y->cut)) continue;
            if (c++) sb_putc(b, ',');
            sb_puts(b, "{\"name\":"); sb_json_str(b, y->name);
            sb_puts(b, ",\"kind\":"); sb_json_str(b, y->kind);
            sb_puts(b, ",\"path\":"); sb_json_str(b, y->path);
            sb_printf(b, ",\"line\":%d,\"refs\":%ld,\"signature\":", y->line,
                      y->refs);
            js_str_or_null(b, y->sig);
            sb_putc(b, '}');
        }
        long ms = d->nsyms - c;
        sb_printf(b, "],\"omitted_files\":%ld,\"omitted_symbols\":%ld}", mf, ms);
        fdrop += mf;
        sdrop += ms;
    }
    sb_printf(b, "],\"omitted\":{\"modules\":%ld,\"files\":%ld,\"symbols\":%ld}}",
              mod_drop, fdrop, sdrop);

    sb_puts(b, ",\"dependencies\":{\"edges\":[");
    n = 0;
    for (int i = 0; i < m->ndep; i++) {
        CmDep *d = &m->deps[i];
        if (!kept(&d->cut)) continue;
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"from\":"); sb_json_str(b, d->from);
        sb_puts(b, ",\"to\":");   sb_json_str(b, d->to);
        sb_printf(b, ",\"imports\":%ld,\"calls\":%ld}", d->imports, d->calls);
    }
    sb_printf(b, "],\"omitted\":%ld}", m->deps_total - n);

    sb_printf(b, ",\"tests\":{\"functions_called\":%ld,\"functions\":%ld,"
                 "\"directories\":[", m->covered, m->coverable);
    long tdrop = 0, tddrop = 0;
    n = 0;
    for (int i = 0; i < m->ntd; i++) {
        CmTestDir *d = &m->tdirs[i];
        if (!kept(&d->cut)) { tddrop++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"path\":"); sb_json_str(b, d->path);
        sb_printf(b, ",\"files\":%ld,\"calls_into\":", d->files);
        js_str_or_null(b, d->covers);
        sb_puts(b, ",\"test_files\":[");
        int c = 0;
        for (int k = 0; k < d->nt; k++) {
            CmTestFile *x = &d->tv[k];
            if (k >= CAP_TEST_FILES || !kept(&x->cut)) { tdrop++; continue; }
            if (c++) sb_putc(b, ',');
            sb_puts(b, "{\"path\":"); sb_json_str(b, x->f->path);
            sb_printf(b, ",\"covers\":%ld,\"purpose\":", x->f->covers);
            js_str_or_null(b, x->f->purpose);
            sb_putc(b, '}');
        }
        sb_puts(b, "]}");
    }
    sb_puts(b, "],\"fixtures\":[");
    n = 0;
    for (int i = 0; i < m->nfx; i++) {
        CmFixture *x = &m->fixtures[i];
        if (!kept(&x->cut)) { tddrop++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"path\":"); sb_json_str(b, x->path);
        sb_printf(b, ",\"files\":%ld,\"subdirectories\":", x->files);
        js_str_or_null(b, x->subs);
        sb_putc(b, '}');
    }
    sb_printf(b, "],\"omitted\":{\"directories\":%ld,\"files\":%ld}}",
              tddrop, tdrop);

    sb_puts(b, ",\"workflow\":{\"pointers\":[");
    n = 0; dropped = 0;
    for (int i = 0; i < m->nptr; i++) {
        if (!kept(&m->ptrs[i].cut)) { dropped++; continue; }
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"path\":"); sb_json_str(b, m->ptrs[i].path);
        sb_puts(b, ",\"what\":"); sb_json_str(b, m->ptrs[i].what);
        sb_putc(b, '}');
    }
    sb_puts(b, "],\"docs\":[");
    n = 0;
    for (int i = 0; i < m->ndoc; i++) {
        if (!kept(&m->docs[i].cut)) continue;
        if (n++) sb_putc(b, ',');
        sb_puts(b, "{\"path\":");  sb_json_str(b, m->docs[i].path);
        sb_puts(b, ",\"title\":"); js_str_or_null(b, m->docs[i].what);
        sb_putc(b, '}');
    }
    dropped += m->docs_total - n;
    sb_printf(b, "],\"omitted\":%ld}}\n", dropped);
}

/* ---------------- fitting ---------------- */

static int cut_cmp(const void *a, const void *b) {
    const Cut *x = *(Cut *const *)a, *y = *(Cut *const *)b;
    if (x->tier != y->tier) return x->tier < y->tier ? -1 : 1;
    if (x->rank != y->rank) return x->rank < y->rank ? -1 : 1;
    return x->seq > y->seq ? -1 : x->seq < y->seq;
}

static size_t md_len_dropping(Map *m, int k) {
    for (int i = 0; i < m->ncut; i++) m->cuts[i]->drop = i < k;
    StrBuf b; sb_init(&b);
    render_md(m, &b);
    size_t n = b.len;
    sb_free(&b);
    return n;
}

static void collect_cuts(Map *m) {
    for (int i = 0; i < m->nlang; i++) cut_add(m, &m->langs[i].cut);
    for (int i = 0; i < m->nbuild; i++) cut_add(m, &m->builds[i].cut);
    for (int i = 0; i < m->ndir; i++)
        if (dir_listed(m, &m->dirs[i])) cut_add(m, &m->dirs[i].cut);
    for (int i = 0; i < m->nmain; i++) cut_add(m, &m->mains[i].cut);
    if (m->cmd_list) cut_add(m, &m->cmd_cut);
    for (int i = 0; i < m->npkg; i++) cut_add(m, &m->pkgs[i].cut);
    for (int i = 0; i < m->nroute; i++) cut_add(m, &m->routes[i].cut);
    for (int i = 0; i < m->nmod; i++) {
        CmMod *d = &m->mods[i];
        cut_add(m, &d->cut);
        for (int k = 0; k < d->nf && k < CAP_MOD_FILES; k++)
            cut_add(m, &d->fv[k].cut);
        for (int k = 0; k < d->ns; k++) cut_add(m, &d->sv[k].cut);
    }
    for (int i = 0; i < m->ndep; i++) cut_add(m, &m->deps[i].cut);
    for (int i = 0; i < m->ntd; i++) {
        cut_add(m, &m->tdirs[i].cut);
        for (int k = 0; k < m->tdirs[i].nt && k < CAP_TEST_FILES; k++)
            cut_add(m, &m->tdirs[i].tv[k].cut);
    }
    for (int i = 0; i < m->nfx; i++) cut_add(m, &m->fixtures[i].cut);
    for (int i = 0; i < m->nptr; i++) cut_add(m, &m->ptrs[i].cut);
    for (int i = 0; i < m->ndoc; i++) cut_add(m, &m->docs[i].cut);
    qsort(m->cuts, (size_t)m->ncut, sizeof *m->cuts, cut_cmp);
}

/* The fewest drops that fit, in drop order. Size falls with every drop
 * except where a first omission note appears, so the bisection is checked
 * and walked forward. -1 when even the bare skeleton does not fit. */
static int fit(Map *m, size_t cap) {
    if (md_len_dropping(m, 0) <= cap) return 0;
    int lo = 1, hi = m->ncut;
    if (md_len_dropping(m, hi) > cap) return -1;
    while (lo < hi) {
        int mid = lo + (hi - lo) / 2;
        if (md_len_dropping(m, mid) <= cap) hi = mid; else lo = mid + 1;
    }
    while (lo < m->ncut && md_len_dropping(m, lo) > cap) lo++;
    md_len_dropping(m, lo);
    return lo;
}

static void map_free(Map *m) {
    for (int i = 0; i < m->nfiles; i++) {
        free(m->files[i].path); free(m->files[i].lang); free(m->files[i].purpose);
    }
    free(m->files); free(m->byid);
    for (int i = 0; i < m->nlang; i++) free(m->langs[i].name);
    free(m->langs);
    for (int i = 0; i < m->nbuild; i++) {
        free(m->builds[i].tool); free(m->builds[i].manifest);
        free(m->builds[i].dir); free(m->builds[i].cmds);
    }
    free(m->builds);
    for (int i = 0; i < m->ndir; i++) {
        free(m->dirs[i].path); free(m->dirs[i].purpose);
        free(m->dirs[i].role); free(m->dirs[i].subs);
    }
    free(m->dirs);
    free(m->root_files); free(m->hidden_dirs); free(m->desc);
    for (int i = 0; i < m->nmain; i++) { free(m->mains[i].path); free(m->mains[i].sig); }
    free(m->mains);
    free(m->cmd_file); free(m->cmd_list);
    for (int i = 0; i < m->npkg; i++) { free(m->pkgs[i].manifest); free(m->pkgs[i].what); }
    free(m->pkgs);
    for (int i = 0; i < m->nroute; i++) {
        free(m->routes[i].method); free(m->routes[i].pattern);
        free(m->routes[i].handler); free(m->routes[i].path);
    }
    free(m->routes);
    for (int i = 0; i < m->cmod && i < m->mods_total; i++) {
        CmMod *d = &m->mods[i];
        free(d->path); free(d->purpose); free(d->fv);
        for (int k = 0; k < d->ns; k++) {
            free(d->sv[k].name); free(d->sv[k].kind);
            free(d->sv[k].path); free(d->sv[k].sig);
        }
        free(d->sv);
    }
    free(m->mods);
    for (int i = 0; i < m->deps_total; i++) { free(m->deps[i].from); free(m->deps[i].to); }
    free(m->deps);
    for (int i = 0; i < m->ntd; i++) {
        free(m->tdirs[i].path); free(m->tdirs[i].covers); free(m->tdirs[i].tv);
    }
    free(m->tdirs);
    for (int i = 0; i < m->nfx; i++) { free(m->fixtures[i].path); free(m->fixtures[i].subs); }
    free(m->fixtures);
    for (int i = 0; i < m->nptr; i++) { free(m->ptrs[i].path); free(m->ptrs[i].what); }
    free(m->ptrs);
    for (int i = 0; i < m->ndoc; i++) { free(m->docs[i].path); free(m->docs[i].what); }
    free(m->docs);
    free(m->cuts);
}

int codemap_render(Cg *cg, int budget, bool json, const char *self_rel,
                   StrBuf *out) {
    Map *m = xmalloc(sizeof *m);
    memset(m, 0, sizeof *m);
    m->cg = cg;
    m->budget = budget > 0 ? budget : CM_BUDGET;
    codemap_default_path(cg, m->skip[0], sizeof m->skip[0]);
    if (self_rel) snprintf(m->skip[1], sizeof m->skip[1], "%s", self_rel);
    cm_functions(m, true);

    load_files(m);
    load_name(m);
    load_langs(m);
    load_builds(m);
    load_layout(m);
    load_entries(m);
    load_modules(m);
    load_deps(m);
    load_tests(m);
    load_pointers(m);
    collect_cuts(m);

    int rc = 0;
    if (fit(m, (size_t)m->budget * 4) < 0) {
        rc = -1;
    } else {
        StrBuf md; sb_init(&md);
        render_md(m, &md);
        if (json) render_json(m, out, (long)md.len);
        else sb_puts(out, md.p);
        sb_free(&md);
    }
    cm_functions(m, false);
    map_free(m);
    free(m);
    return rc;
}

/* ---------------- the file ---------------- */

/* The budget an existing map was generated with, from its marker; 0 when
 * the file is not ours. */
static int marker_budget(const char *body) {
    size_t ml = strlen(CM_MARKER);
    if (!body || strncmp(body, CM_MARKER, ml) != 0) return 0;
    const char *nl = strchr(body, '\n');
    const char *b = strstr(body, "budget=");
    if (!b || (nl && b > nl)) return CM_BUDGET;
    int v = atoi(b + 7);
    return v > 0 ? v : CM_BUDGET;
}

/* repo-relative form of an output path, "" when it lies outside the tree */
static void out_rel(const Cg *cg, const char *abs, char *rel, size_t cap) {
    size_t rl = strlen(cg->root);
    if (strncmp(abs, cg->root, rl) == 0 && abs[rl] == '/')
        snprintf(rel, cap, "%s", abs + rl + 1);
    else
        snprintf(rel, cap, "%s", "");
}

int codemap_status(Cg *cg, char *rel, size_t cap) {
    codemap_default_path(cg, rel, cap);
    char abs[5200];
    if (!path_format(abs, sizeof abs, "%s/%s", cg->root, rel)) return -1;
    char *body = read_entire_file(abs, NULL);
    if (!body) return -1;
    int budget = marker_budget(body);
    if (!budget) { free(body); return 2; }
    StrBuf b; sb_init(&b);
    int rc = codemap_render(cg, budget, false, rel, &b);
    int st = rc == 0 && strcmp(b.p, body) == 0 ? 0 : 1;
    sb_free(&b);
    free(body);
    return st;
}

int cmd_codemap(Cg *cg, const CodemapOpts *o) {
    bool to_stdout = o->outfile && strcmp(o->outfile, "-") == 0;
    if (o->json && o->outfile && !to_stdout) {
        fprintf(stderr, "cg codemap: --json prints to stdout; use -o - or "
                        "redirect it\n");
        return 2;
    }
    if (o->check && (o->json || to_stdout)) {
        fprintf(stderr, "cg codemap: --check compares a file; it takes no "
                        "--json or -o -\n");
        return 2;
    }
    if (o->budget < 0 || (o->budget > 0 && o->budget < CM_MIN_BUDGET)) {
        fprintf(stderr, "cg codemap: --budget must be at least %d tokens\n",
                CM_MIN_BUDGET);
        return 2;
    }

    /* where the map goes: -o relative to the caller, else the default
     * under the project root */
    char abs[5200], rel[4096];
    if (o->outfile && !to_stdout) {
        if (o->outfile[0] == '/') {
            snprintf(abs, sizeof abs, "%s", o->outfile);
        } else {
            char cwd[4096];
            if (!getcwd(cwd, sizeof cwd)) {
                fprintf(stderr, "cg codemap: cannot determine the current "
                                "directory\n");
                return 1;
            }
            if (!path_format(abs, sizeof abs, "%s/%s", cwd, o->outfile)) {
                fprintf(stderr, "cg codemap: output path too long\n");
                return 2;
            }
        }
        out_rel(cg, abs, rel, sizeof rel);
    } else {
        codemap_default_path(cg, rel, sizeof rel);
        if (!path_format(abs, sizeof abs, "%s/%s", cg->root, rel)) {
            fprintf(stderr, "cg codemap: output path too long\n");
            return 2;
        }
    }

    char *old = (to_stdout || o->json) ? NULL : read_entire_file(abs, NULL);
    int budget = o->budget;
    if (!budget && o->check) budget = marker_budget(old);
    if (!budget) budget = CM_BUDGET;

    StrBuf b; sb_init(&b);
    if (codemap_render(cg, budget, o->json, rel[0] ? rel : NULL, &b) != 0) {
        fprintf(stderr, "cg codemap: a budget of %d tokens cannot hold even "
                        "the map's headings; raise --budget\n", budget);
        sb_free(&b);
        free(old);
        return 2;
    }
    int rc = 0;
    if (o->json || to_stdout) {
        fputs(b.p, stdout);
    } else if (o->check) {
        const char *show = rel[0] ? rel : abs;
        if (!old) {
            printf("codemap: %s is missing — run cg codemap\n", show);
            rc = 1;
        } else if (strcmp(old, b.p) != 0) {
            printf("codemap: %s is stale — run cg codemap\n", show);
            rc = 1;
        } else {
            printf("codemap: %s is current\n", show);
        }
    } else if (old && !marker_budget(old) && !o->force) {
        fprintf(stderr, "cg codemap: %s exists and was not generated by cg "
                        "codemap; refusing to overwrite it (--force to "
                        "replace it, -o to write elsewhere)\n",
                rel[0] ? rel : abs);
        rc = 1;
    } else if (old && strcmp(old, b.p) == 0) {
        printf("codemap: %s unchanged (%zu tokens)\n", rel[0] ? rel : abs,
               (b.len + 3) / 4);
    } else if (write_entire_file(abs, b.p, b.len) != 0) {
        fprintf(stderr, "cg codemap: cannot write %s\n", abs);
        rc = 1;
    } else {
        printf("codemap: wrote %s (%zu tokens, budget %d)\n",
               rel[0] ? rel : abs, (b.len + 3) / 4, budget);
    }
    sb_free(&b);
    free(old);
    return rc;
}
