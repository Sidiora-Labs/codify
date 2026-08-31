/*
 * Graph queries: full-text search, symbol lookup, impact analysis,
 * and `context` — the one-call answer for coding agents.
 * Every command has --json output.
 */
#include "cg.h"
#include <ctype.h>
#include <strings.h>

/* ---------------- helpers ---------------- */

static char *fts_quote(const char *q) {          /* "..." literal, "" escaped */
    StrBuf b; sb_init(&b);
    sb_putc(&b, '"');
    for (const char *p = q; *p; p++) {
        if (*p == '"') sb_puts(&b, "\"\"");
        else sb_putc(&b, *p);
    }
    sb_putc(&b, '"');
    return b.p;
}

static char *fts_words(const char *q) {          /* tok* tok* for unicode61 */
    StrBuf b; sb_init(&b);
    const char *p = q;
    while (*p) {
        while (*p && !isalnum((unsigned char)*p) && *p != '_') p++;
        if (!*p) break;
        const char *s = p;
        while (*p && (isalnum((unsigned char)*p) || *p == '_')) p++;
        if (b.len) sb_putc(&b, ' ');
        sb_putc(&b, '"');
        for (const char *c = s; c < p; c++) sb_putc(&b, *c);
        sb_puts(&b, "\" *");
        /* NEAR-less AND: fts5 syntax `"tok" *` is prefix; join by space */
        b.len -= 0;
    }
    if (!b.len) { sb_free(&b); return NULL; }
    return b.p;
}

/* print lines [from..to] of a file under root, JSON-escaped into sb or raw */
static char *file_snippet_n(Cg *cg, const char *rel, int from, int to,
                            int maxlines) {
    if (from < 1) from = 1;
    if (to < from) to = from;
    /* [from..to] is inclusive: cap at exactly maxlines printed lines */
    if (to - from + 1 > maxlines) to = from + maxlines - 1;
    char abs[4900];
    snprintf(abs, sizeof abs, "%s/%s", cg->root, rel);
    size_t len = 0;
    char *data = read_entire_file(abs, &len);
    if (!data) return NULL;
    StrBuf b; sb_init(&b);
    int line = 1;
    const char *p = data;
    while (p < data + len && line <= to) {
        const char *nl = memchr(p, '\n', (size_t)(data + len - p));
        size_t ll = nl ? (size_t)(nl - p) : (size_t)(data + len - p);
        if (line >= from) {
            sb_printf(&b, "%5d│ ", line);
            if (ll > 300) ll = 300;
            for (size_t i = 0; i < ll; i++) if (p[i] != '\r') sb_putc(&b, p[i]);
            sb_putc(&b, '\n');
        }
        p += ll + (nl ? 1 : 0);
        line++;
    }
    free(data);
    return b.p;
}

static char *file_snippet(Cg *cg, const char *rel, int from, int to) {
    return file_snippet_n(cg, rel, from, to, 40);
}

typedef struct {
    long id;
    char name[256], kind[32], path[1024], sig[512];
    int line, end_line;
    bool soft;             /* reached over a prose-derived edge, not a call */
} SymRow;

static int sym_from_stmt_at(sqlite3_stmt *st, int off, SymRow *r) {
    r->id = sqlite3_column_int64(st, off);
    snprintf(r->name, sizeof r->name, "%s",
             (const char *)sqlite3_column_text(st, off + 1));
    const char *k = (const char *)sqlite3_column_text(st, off + 2);
    snprintf(r->kind, sizeof r->kind, "%s", k ? k : "");
    snprintf(r->path, sizeof r->path, "%s",
             (const char *)sqlite3_column_text(st, off + 3));
    r->line = sqlite3_column_int(st, off + 4);
    r->end_line = sqlite3_column_int(st, off + 5);
    const char *s = (const char *)sqlite3_column_text(st, off + 6);
    snprintf(r->sig, sizeof r->sig, "%s", s ? s : "");
    r->soft = false;
    return 0;
}

static int sym_from_stmt(sqlite3_stmt *st, SymRow *r) {
    return sym_from_stmt_at(st, 0, r);
}

#define SYM_COLS "s.id,s.name,s.kind,f.path,s.line,s.end_line,s.sig"

/* ---------------- doc-first: intent before boilerplate ---------------- */

/* case-insensitive substring — strcasestr without the GNU extension */
static bool ci_has(const char *hay, const char *needle) {
    size_t n = strlen(needle);
    for (const char *p = hay; *p; p++)
        if (strncasecmp(p, needle, n) == 0) return true;
    return n == 0;
}

/* The derivability test from the anchor convention, applied mechanically:
 * a doc whose every word already appears in the name or signature restates
 * the code, so doc-first drops it and lets the body speak. */
static bool doc_derivable(const char *doc, const char *name, const char *sig) {
    const char *p = doc;
    char tok[128];
    while (*p) {
        while (*p && !isalnum((unsigned char)*p) && *p != '_') p++;
        if (!*p) break;
        const char *s = p;
        while (*p && (isalnum((unsigned char)*p) || *p == '_')) p++;
        size_t n = (size_t)(p - s);
        if (n < 3 || n >= sizeof tok) continue;  /* 'a', 'of', minified runs */
        memcpy(tok, s, n);
        tok[n] = 0;
        if (!ci_has(name, tok) && !ci_has(sig, tok)) return false;
    }
    return true;             /* nothing beyond the code itself — not a doc */
}

#define DOC_MAX_BYTES 700    /* per-symbol share: ~10 lines of prose */

typedef struct { char *body; bool stale, cut; } SymDoc;

/* CG_BODY_FIRST=1 restores pre-0.6 body-first snippets. Kept as the live
 * baseline the doc-first budget claim is measured against (16_retrieval). */
static bool body_first(void) {
    const char *e = getenv("CG_BODY_FIRST");
    return e && *e && strcmp(e, "0") != 0;
}

/* The doc comment bound to a symbol: body NULL when there is none or the
 * text fails the derivability test; stale when the comment was baselined
 * against a body that has since changed (anchored_hash, task 4.1); cut
 * when it overran the per-symbol share and was truncated on a line. */
/* copy body into d, truncated on a line at the per-symbol share */
static void doc_take(SymDoc *d, const char *body, bool stale) {
    size_t n = strlen(body);
    d->cut = false;
    if (n > DOC_MAX_BYTES) {
        n = DOC_MAX_BYTES;                      /* cut on a line boundary */
        while (n && body[n - 1] != '\n') n--;
        if (!n) n = DOC_MAX_BYTES;
        d->cut = true;
    }
    free(d->body);
    d->body = xmalloc(n + 1);
    memcpy(d->body, body, n);
    while (n && (d->body[n-1] == '\n' || d->body[n-1] == ' ')) n--;
    d->body[n] = 0;
    d->stale = stale;
}

static bool symbol_doc(Cg *cg, const SymRow *r, SymDoc *d) {
    d->body = NULL;
    d->stale = d->cut = false;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT body, anchored_hash FROM comments "
        "WHERE sym_id=? AND kind='doc' ORDER BY line DESC LIMIT 4");
    sqlite3_bind_int64(st, 1, r->id);
    char *data = NULL;                          /* the file, read at most once */
    size_t len = 0;
    bool tried = false;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *body = (const char *)sqlite3_column_text(st, 0);
        const char *ah   = (const char *)sqlite3_column_text(st, 1);
        if (!body || !*body || doc_derivable(body, r->name, r->sig)) continue;
        bool stale = false;
        if (ah && *ah) {                        /* drift: derived, not stored */
            if (!tried) {
                tried = true;
                char abs[5200];
                snprintf(abs, sizeof abs, "%s/%s", cg->root, r->path);
                data = read_entire_file(abs, &len);
            }
            if (data) {
                char h[65];
                hash_lines(data, len, r->line, r->end_line, h);
                stale = strcmp(h, ah) != 0;
            }
        }
        /* stale anchors rank below current ones: the nearest current doc
         * wins, and a stale one is shown (marked) only when nothing else
         * is left to say */
        if (!d->body) doc_take(d, body, stale);
        else if (d->stale && !stale) doc_take(d, body, stale);
        if (!d->stale) break;
    }
    free(data);
    sqlite3_finalize(st);
    return d->body != NULL;
}

/* text-mode prose render; the caller decides what code line follows */
static void doc_render(StrBuf *b, const SymDoc *d) {
    if (d->stale)
        sb_puts(b, "  ┊ [stale — code changed after this was written]\n");
    const char *p = d->body;
    while (*p) {
        const char *nl = strchr(p, '\n');
        size_t ll = nl ? (size_t)(nl - p) : strlen(p);
        while (ll && (*p == ' ' || *p == '\t')) { p++; ll--; }
        sb_printf(b, "  ┊ %.*s\n", (int)ll, p);
        p += ll;
        if (*p == '\n') p++;
    }
    if (d->cut) sb_puts(b, "  ┊ … (doc truncated)\n");
}

/* Walk every baselined doc anchor; report the stale ones. Stale is
 * derived on the spot — the stored baseline against the current bytes —
 * so nothing here can go out of date. Rows come ordered by path, which
 * lets one file read serve all of a file's anchors. */
int anchor_stale(Cg *cg,
                 void (*cb)(void *u, const char *path, int line,
                            const char *sym, int sym_line),
                 void *u) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT f.path, c.line, s.name, s.line, s.end_line, c.anchored_hash "
        "FROM comments c JOIN symbols s ON s.id=c.sym_id "
        "JOIN files f ON f.id=c.file_id "
        "WHERE c.kind='doc' AND c.anchored_hash IS NOT NULL "
        "ORDER BY f.path, c.line");
    char lastp[1024] = "";
    char *data = NULL;
    size_t len = 0;
    int stale = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *path = (const char *)sqlite3_column_text(st, 0);
        int cline        = sqlite3_column_int(st, 1);
        const char *sym  = (const char *)sqlite3_column_text(st, 2);
        int sline        = sqlite3_column_int(st, 3);
        int send         = sqlite3_column_int(st, 4);
        const char *ah   = (const char *)sqlite3_column_text(st, 5);
        if (!path || !ah) continue;
        if (strcmp(path, lastp) != 0) {
            free(data);
            len = 0;
            char abs[5200];
            snprintf(abs, sizeof abs, "%s/%s", cg->root, path);
            data = read_entire_file(abs, &len);
            snprintf(lastp, sizeof lastp, "%s", path);
        }
        if (!data) continue;
        char h[65];
        hash_lines(data, len, sline, send, h);
        if (strcmp(h, ah) != 0) {
            stale++;
            if (cb) cb(u, path, cline, sym ? sym : "?", sline);
        }
    }
    free(data);
    sqlite3_finalize(st);
    return stale;
}

/* JSON doc fields, shared by context and symbol */
static void doc_json(StrBuf *b, const SymDoc *d) {
    sb_puts(b, ",\"doc\":");
    sb_json_str(b, d->body);
    if (d->stale) sb_puts(b, ",\"doc_stale\":true");
    if (d->cut)   sb_puts(b, ",\"doc_truncated\":true");
}

/* exact-name definitions, deterministically ordered */
static int defs_named(Cg *cg, const char *name, SymRow *out, int cap) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT " SYM_COLS " FROM symbols s JOIN files f ON f.id=s.file_id "
        "WHERE s.name=? ORDER BY f.path,s.line LIMIT ?");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, cap);
    int n = 0;
    while (n < cap && sqlite3_step(st) == SQLITE_ROW)
        sym_from_stmt(st, &out[n++]);
    sqlite3_finalize(st);
    return n;
}

/* find symbols matching a name: exact first, then trigram/LIKE */
static int find_symbols(Cg *cg, const char *q, SymRow *out, int cap) {
    int n = defs_named(cg, q, out, cap);
    if (n > 0) return n;
    sqlite3_stmt *st;

    if (strlen(q) >= 3) {
        char *fq = fts_quote(q);
        st = cg_prep(cg,
            "SELECT " SYM_COLS " FROM symbol_fts "
            "JOIN symbols s ON s.id=symbol_fts.rowid "
            "JOIN files f ON f.id=s.file_id "
            "WHERE symbol_fts MATCH ? ORDER BY rank LIMIT ?");
        sqlite3_bind_text(st, 1, fq, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(st, 2, cap);
        while (n < cap && sqlite3_step(st) == SQLITE_ROW)
            sym_from_stmt(st, &out[n++]);
        sqlite3_finalize(st);
        free(fq);
    } else {
        char like[300];
        snprintf(like, sizeof like, "%%%s%%", q);
        st = cg_prep(cg,
            "SELECT " SYM_COLS " FROM symbols s JOIN files f ON f.id=s.file_id "
            "WHERE s.name LIKE ? ORDER BY length(s.name) LIMIT ?");
        sqlite3_bind_text(st, 1, like, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(st, 2, cap);
        while (n < cap && sqlite3_step(st) == SQLITE_ROW)
            sym_from_stmt(st, &out[n++]);
        sqlite3_finalize(st);
    }
    return n;
}

/* every tier, no exact short-circuit: exact hits first, then trigram/LIKE
 * additions deduped by id. The fusion path scores tiers against each other
 * instead of letting one exact hit suppress every substring candidate. */
static int find_symbols_all(Cg *cg, const char *q, SymRow *out, int cap) {
    int n = defs_named(cg, q, out, cap);
    if (n >= cap) return n;
    sqlite3_stmt *st;
    if (strlen(q) >= 3) {
        char *fq = fts_quote(q);
        st = cg_prep(cg,
            "SELECT " SYM_COLS " FROM symbol_fts "
            "JOIN symbols s ON s.id=symbol_fts.rowid "
            "JOIN files f ON f.id=s.file_id "
            "WHERE symbol_fts MATCH ? ORDER BY rank,f.path,s.line LIMIT ?");
        sqlite3_bind_text(st, 1, fq, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(st, 2, cap);
        free(fq);
    } else {
        char like[300];
        snprintf(like, sizeof like, "%%%s%%", q);
        st = cg_prep(cg,
            "SELECT " SYM_COLS " FROM symbols s JOIN files f ON f.id=s.file_id "
            "WHERE s.name LIKE ? ORDER BY length(s.name),f.path,s.line LIMIT ?");
        sqlite3_bind_text(st, 1, like, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int(st, 2, cap);
    }
    while (n < cap && sqlite3_step(st) == SQLITE_ROW) {
        SymRow r;
        sym_from_stmt(st, &r);
        bool dup = false;
        for (int i = 0; i < n; i++)
            if (out[i].id == r.id) { dup = true; break; }
        if (!dup) out[n++] = r;
    }
    sqlite3_finalize(st);
    return n;
}

/* ---------------- edge resolution ---------------- */

#define RESOLVE_MAX_DEFS 64

/* test/fixture/vendored scaffolding must not outrank the code it exercises */
static bool rank_path_penalized(const char *path) {
    static const char *SEGS[] = { "test", "tests", "__tests__", "fixtures",
                                  "vendor", "node_modules", "examples", NULL };
    for (const char *p = path; *p; ) {
        const char *e = strchr(p, '/');
        size_t len = e ? (size_t)(e - p) : strlen(p);
        for (int i = 0; SEGS[i]; i++)
            if (strlen(SEGS[i]) == len && strncmp(p, SEGS[i], len) == 0)
                return true;
        if (!e) break;
        p = e + 1;
    }
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    return strstr(base, "_test.") || strstr(base, ".test.") ||
           strstr(base, ".spec.") != NULL;
}

static int path_depth(const char *p) {
    int d = 0;
    for (; *p; p++)
        if (*p == '/') d++;
    return d;
}

/* Does an import's module string plausibly name this file? A trailing
 * code-file extension is stripped first ('./find.js' names find, 'helper.h'
 * names helper) — only known extensions, so 'os.path' stays a dotted module —
 * then separators are normalized (:: and . become /) and matched against the
 * candidate path minus extension, preferring a component-boundary suffix. */
static bool module_matches(const char *module, const char *cand_path) {
    char mod[512];
    snprintf(mod, sizeof mod, "%s", module);
    char *mdot = strrchr(mod, '.');
    if (mdot && mdot != mod && mdot[-1] != '/' && mdot[-1] != '.') {
        static const char *EXTS[] = { "js", "jsx", "ts", "tsx", "mjs", "cjs",
                                      "c", "cc", "cpp", "cxx", "h", "hh",
                                      "hpp", "hxx", "py", "rb", "go", "rs",
                                      "java", "kt", "php", "cs", "swift",
                                      "m", "mm", "vue", "svelte", NULL };
        for (int i = 0; EXTS[i]; i++)
            if (strcmp(mdot + 1, EXTS[i]) == 0) { *mdot = 0; break; }
    }
    char norm[512];
    size_t j = 0;
    for (const char *p = mod; *p && j + 1 < sizeof norm; p++) {
        if (p[0] == ':' && p[1] == ':') { norm[j++] = '/'; p++; }
        else if (*p == '.') norm[j++] = '/';
        else norm[j++] = *p;
    }
    norm[j] = 0;
    const char *m = norm;
    while (*m == '/') m++;              /* "./util" normalizes to "//util" */
    if (!*m) return false;
    char noext[1024];
    snprintf(noext, sizeof noext, "%s", cand_path);
    char *dot = strrchr(noext, '.');
    if (dot && !strchr(dot, '/')) *dot = 0;
    size_t ml = strlen(m), pl = strlen(noext);
    if (ml <= pl && strcmp(noext + pl - ml, m) == 0 &&
        (pl == ml || noext[pl - ml - 1] == '/'))
        return true;                    /* suffix at a component boundary */
    return strstr(noext, m) != NULL;
}

/* Pick the definition a reference from `from_path` most plausibly targets:
 * same file, then a file named by the referencing file's imports, then the
 * same directory, then the shallowest path. Candidates arrive path ASC, so
 * the first best index is the deterministic winner. */
static int resolve_best(Cg *cg, long from_fid, const char *from_path,
                        const SymRow *cands, int nc) {
    if (nc <= 1) return 0;
    struct { char name[128]; char module[256]; } imps[32];
    int ni = 0;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT name,module FROM imports WHERE file_id=? ORDER BY id LIMIT 32");
    sqlite3_bind_int64(st, 1, from_fid);
    while (ni < 32 && sqlite3_step(st) == SQLITE_ROW) {
        snprintf(imps[ni].name, sizeof imps[ni].name, "%s",
                 (const char *)sqlite3_column_text(st, 0));
        snprintf(imps[ni].module, sizeof imps[ni].module, "%s",
                 (const char *)sqlite3_column_text(st, 1));
        ni++;
    }
    sqlite3_finalize(st);

    const char *slash = strrchr(from_path, '/');
    size_t dirlen = slash ? (size_t)(slash - from_path) : 0;

    int best = 0, best_tier = 9, best_depth = 0;
    for (int i = 0; i < nc; i++) {
        int tier = 3;
        if (strcmp(cands[i].path, from_path) == 0) {
            tier = 0;
        } else {
            for (int k = 0; k < ni && tier > 1; k++)
                if ((strcmp(imps[k].name, cands[i].name) == 0 ||
                     strcmp(imps[k].name, "*") == 0) &&
                    module_matches(imps[k].module, cands[i].path))
                    tier = 1;
            if (tier > 2) {
                const char *cs = strrchr(cands[i].path, '/');
                size_t cd = cs ? (size_t)(cs - cands[i].path) : 0;
                if (cd == dirlen &&
                    (dirlen == 0 ||
                     strncmp(cands[i].path, from_path, dirlen) == 0))
                    tier = 2;
            }
        }
        int depth = path_depth(cands[i].path);
        if (tier < best_tier || (tier == best_tier && depth < best_depth)) {
            best = i;
            best_tier = tier;
            best_depth = depth;
        }
    }
    return best;
}

/* callers of def: enclosing function/method symbols of refs to its name.
 * With several same-named defs, keep only refs whose own file resolves to
 * this def, so a fixture's `find` no longer claims unrelated callers. */
static int callers_of(Cg *cg, const SymRow *def, SymRow *out, int cap) {
    int n = 0;

    /* Primary path: refs that resolved to this symbol at index time.
     * This replaces the old resolve_best per-query disambiguation. */
    {
        char sql[512];
        snprintf(sql, sizeof sql,
            "SELECT " SYM_COLS ", MIN(r.kind='soft')"
            " FROM refs r JOIN symbols s ON s.id=r.sym_id "
            "JOIN files f ON f.id=s.file_id "
            "WHERE r.target_id=?1 %s"
            "AND s.kind IN ('function','method') "
            "GROUP BY s.id ORDER BY f.path,s.line LIMIT ?2",
            cg->no_soft ? "AND r.kind<>'soft' " : "");
        sqlite3_stmt *st = cg_prep(cg, sql);
        sqlite3_bind_int64(st, 1, def->id);
        sqlite3_bind_int(st, 2, cap);
        while (n < cap && sqlite3_step(st) == SQLITE_ROW) {
            sym_from_stmt(st, &out[n]);
            out[n].soft = sqlite3_column_int(st, 7) != 0;
            n++;
        }
        sqlite3_finalize(st);
    }

    /* Fallback: refs that did not resolve (target_id IS NULL) — name
     * equality, same as v0.6. Soft edges also come through here. */
    if (n < cap) {
        char sql[512];
        snprintf(sql, sizeof sql,
            "SELECT " SYM_COLS ", MIN(r.kind='soft')"
            " FROM refs r JOIN symbols s ON s.id=r.sym_id "
            "JOIN files f ON f.id=s.file_id "
            "WHERE r.name=?1 AND r.target_id IS NULL AND s.name<>?1 %s"
            "AND s.kind IN ('function','method') "
            "GROUP BY s.id ORDER BY f.path,s.line LIMIT ?2",
            cg->no_soft ? "AND r.kind<>'soft' " : "");
        sqlite3_stmt *st = cg_prep(cg, sql);
        sqlite3_bind_text(st, 1, def->name, -1, SQLITE_STATIC);
        sqlite3_bind_int(st, 2, cap - n);
        while (n < cap && sqlite3_step(st) == SQLITE_ROW) {
            SymRow r;
            sym_from_stmt(st, &r);
            r.soft = sqlite3_column_int(st, 7) != 0;
            bool dup = false;
            for (int i = 0; i < n; i++)
                if (out[i].id == r.id) { dup = true; break; }
            if (!dup) out[n++] = r;
        }
        sqlite3_finalize(st);
    }

    return n;
}

static int sym_path_line_cmp(const void *a, const void *b) {
    const SymRow *x = a, *y = b;
    int c = strcmp(x->path, y->path);
    if (c) return c;
    if (x->line != y->line) return x->line - y->line;
    return strcmp(x->name, y->name);
}

/* callees: names referenced inside symbol id, each resolved to the def the
 * referencing file most plausibly targets — not the repo-wide lowest rowid */
static int callees_of(Cg *cg, long sym_id, SymRow *out, int cap) {
    int n = 0;

    /* Primary path: refs inside this symbol that already have a target_id
     * resolved at index time. */
    {
        char sql[512];
        snprintf(sql, sizeof sql,
            "SELECT " SYM_COLS ", MIN(r.kind='soft')"
            " FROM refs r JOIN symbols s ON s.id=r.target_id "
            "JOIN files f ON f.id=s.file_id "
            "WHERE r.sym_id=?1 AND r.target_id IS NOT NULL "
            "AND r.target_id<>?1 %s"
            "GROUP BY s.id ORDER BY f.path,s.line LIMIT ?2",
            cg->no_soft ? "AND r.kind<>'soft' " : "");
        sqlite3_stmt *st = cg_prep(cg, sql);
        sqlite3_bind_int64(st, 1, sym_id);
        sqlite3_bind_int(st, 2, cap);
        while (n < cap && sqlite3_step(st) == SQLITE_ROW) {
            sym_from_stmt(st, &out[n]);
            out[n].soft = sqlite3_column_int(st, 7) != 0;
            n++;
        }
        sqlite3_finalize(st);
    }

    /* Fallback: unresolved refs (target_id IS NULL) — name equality
     * with the old defs_named + resolve_best path. */
    if (n < cap) {
        long from_fid = 0;
        char from_path[1024] = "";
        sqlite3_stmt *q = cg_prep(cg,
            "SELECT f.id, f.path FROM symbols s JOIN files f ON f.id=s.file_id "
            "WHERE s.id=?");
        sqlite3_bind_int64(q, 1, sym_id);
        if (sqlite3_step(q) == SQLITE_ROW) {
            from_fid = sqlite3_column_int64(q, 0);
            snprintf(from_path, sizeof from_path, "%s",
                     (const char *)sqlite3_column_text(q, 1));
        }
        sqlite3_finalize(q);

        SymRow *cands = xmalloc(sizeof(SymRow) * RESOLVE_MAX_DEFS);
        char sql[256];
        snprintf(sql, sizeof sql,
            "SELECT r.name, MIN(r.kind='soft') FROM refs r "
            "WHERE r.sym_id=? AND r.target_id IS NULL %s"
            "GROUP BY r.name ORDER BY r.name",
            cg->no_soft ? "AND r.kind<>'soft' " : "");
        sqlite3_stmt *st = cg_prep(cg, sql);
        sqlite3_bind_int64(st, 1, sym_id);
        while (n < cap && sqlite3_step(st) == SQLITE_ROW) {
            const char *nm = (const char *)sqlite3_column_text(st, 0);
            bool soft = sqlite3_column_int(st, 1) != 0;
            int nc = defs_named(cg, nm, cands, RESOLVE_MAX_DEFS);
            int kept = 0;
            for (int i = 0; i < nc; i++)
                if (cands[i].id != sym_id) cands[kept++] = cands[i];
            if (kept == 0) continue;
            int b = resolve_best(cg, from_fid, from_path, cands, kept);
            bool dup = false;
            for (int i = 0; i < n; i++)
                if (out[i].id == cands[b].id) {
                    if (!soft) out[i].soft = false;
                    dup = true;
                    break;
                }
            if (!dup) { cands[b].soft = soft; out[n++] = cands[b]; }
        }
        sqlite3_finalize(st);
        free(cands);
    }

    qsort(out, (size_t)n, sizeof(SymRow), sym_path_line_cmp);
    return n;
}

static int ref_count(Cg *cg, const char *name) {
    sqlite3_stmt *st = cg_prep(cg, "SELECT COUNT(*) FROM refs WHERE name=?");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_STATIC);
    int n = 0;
    if (sqlite3_step(st) == SQLITE_ROW) n = sqlite3_column_int(st, 0);
    sqlite3_finalize(st);
    return n;
}

/* refs that plausibly target this def: count resolved refs (target_id)
 * plus unresolved refs that fall back to name equality. */
static int ref_count_resolved(Cg *cg, const SymRow *def) {
    int total = 0;
    /* resolved refs targeting this symbol */
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT COUNT(*) FROM refs WHERE target_id=?");
    sqlite3_bind_int64(st, 1, def->id);
    if (sqlite3_step(st) == SQLITE_ROW)
        total = sqlite3_column_int(st, 0);
    sqlite3_finalize(st);

    /* unresolved refs by name (fallback) */
    SymRow *cands = xmalloc(sizeof(SymRow) * RESOLVE_MAX_DEFS);
    int nc = defs_named(cg, def->name, cands, RESOLVE_MAX_DEFS);
    if (nc <= 1) {
        /* sole definition: all unresolved name-matched refs are ours */
        st = cg_prep(cg,
            "SELECT COUNT(*) FROM refs WHERE name=? AND target_id IS NULL");
        sqlite3_bind_text(st, 1, def->name, -1, SQLITE_STATIC);
        if (sqlite3_step(st) == SQLITE_ROW)
            total += sqlite3_column_int(st, 0);
        sqlite3_finalize(st);
    }
    free(cands);
    return total;
}

#define MAX_TOK 8

/* split a free-text query into identifier-ish tokens */
static int tokenize(const char *q, char toks[][128], int cap) {
    int n = 0;
    for (const char *p = q; *p && n < cap; ) {
        while (*p && !isalnum((unsigned char)*p) && *p != '_') p++;
        if (!*p) break;
        const char *s = p;
        while (*p && (isalnum((unsigned char)*p) || *p == '_')) p++;
        size_t len = (size_t)(p - s);
        if (len < 2) continue;                  /* single letters are noise */
        if (len > 127) len = 127;
        memcpy(toks[n], s, len);
        toks[n][len] = 0;
        n++;
    }
    return n;
}

static bool ci_contains(const char *hay, const char *needle) {
    size_t nl = strlen(needle);
    for (const char *p = hay; *p; p++) {
        if (strncasecmp(p, needle, nl) == 0) return true;
    }
    return false;
}

typedef struct { SymRow r; int score, hits, refs; } Cand;

static void cand_add(Cand *c, int *nc, int cap, const SymRow *r, int score) {
    for (int i = 0; i < *nc; i++) {
        if (c[i].r.id == r->id) {
            c[i].score += score;
            c[i].hits++;
            return;
        }
    }
    if (*nc >= cap) return;
    c[*nc].r = *r;
    c[*nc].score = score;
    c[*nc].hits = 1;
    c[*nc].refs = 0;
    (*nc)++;
}

static int cand_cmp(const void *a, const void *b) {
    const Cand *x = a, *y = b;
    if (x->hits != y->hits) return y->hits - x->hits;   /* more tokens first */
    if (x->score != y->score) return y->score - x->score;
    if (x->refs != y->refs) return y->refs - x->refs;   /* centrality */
    return strcmp(x->r.path, y->r.path);
}

/* Multi-word queries are the common case for agents ("password auth",
 * "spec done"), and matching the whole phrase as one trigram string finds
 * nothing. Match each token separately and fuse: symbols hit by more tokens
 * rank above symbols hit by one, exact name matches above substrings. */
static int find_symbols_tokenized(Cg *cg, const char *q, SymRow *out, int cap) {
    int n = find_symbols_all(cg, q, out, cap);  /* whole phrase is strongest */
    char toks[MAX_TOK][128];
    int nt = tokenize(q, toks, MAX_TOK);
    if (nt < 2 || n >= cap) return n;

    Cand cands[128];
    int nc = 0;
    for (int i = 0; i < n; i++) cand_add(cands, &nc, 128, &out[i], 1000);

    SymRow tmp[24];
    for (int t = 0; t < nt; t++) {
        int m = find_symbols_all(cg, toks[t], tmp, 24);
        size_t tl = strlen(toks[t]);
        for (int i = 0; i < m; i++) {
            int score = 20;
            if (strcasecmp(tmp[i].name, toks[t]) == 0) score = 100;
            else if (strncasecmp(tmp[i].name, toks[t], tl) == 0) score = 60;
            else if (ci_contains(tmp[i].name, toks[t])) score = 45;
            /* churn lifts code that is actually being worked on; absent git
             * history this is a uniform zero and changes nothing */
            int churn = git_churn_for_path(cg, tmp[i].path);
            score += churn > 10 ? 20 : churn * 2;
            cand_add(cands, &nc, 128, &tmp[i], score);
        }
    }
    /* per-symbol signals, applied once after fusion: what it is, how
     * referenced it is, and whether it lives in test scaffolding */
    for (int i = 0; i < nc; i++) {
        const SymRow *r = &cands[i].r;
        if (strcmp(r->kind, "function") == 0 ||
            strcmp(r->kind, "method") == 0 ||
            strcmp(r->kind, "class") == 0 || strcmp(r->kind, "struct") == 0)
            cands[i].score += 15;
        cands[i].refs = ref_count_resolved(cg, r);
        cands[i].score += (cands[i].refs > 30 ? 30 : cands[i].refs) / 2;
        if (rank_path_penalized(r->path)) cands[i].score -= 40;
    }
    qsort(cands, (size_t)nc, sizeof(Cand), cand_cmp);
    int k = 0;
    for (int i = 0; i < nc && k < cap; i++) out[k++] = cands[i].r;
    return k;
}

/* Entry points that actually relate to the query: handlers of routes whose
 * pattern or handler name matches, then call-graph roots found by walking up
 * from the matched symbols. main() is a fallback the caller applies only when
 * this returns nothing. */
static bool ep_interesting(const SymRow *r) {
    /* heuristic extraction yields some noise (macros, struct tags); entry
     * points are callable things, so keep only those kinds */
    return strcmp(r->kind, "function") == 0 || strcmp(r->kind, "method") == 0 ||
           strcmp(r->kind, "class") == 0;
}

static bool ep_push(SymRow *out, int *n, int cap, const SymRow *r) {
    if (*n >= cap) return false;
    if (graph_path_is_test(r->path)) return false;  /* tests are not entries */
    for (int i = 0; i < *n; i++)
        if (strcmp(out[i].name, r->name) == 0) return false;   /* by name */
    out[(*n)++] = *r;
    return true;
}

static void ep_climb(Cg *cg, const SymRow *from, SymRow *out, int *n, int cap,
                     int depth, char seen[][256], int *nseen) {
    if (depth <= 0 || *n >= cap || *nseen >= 64) return;
    for (int i = 0; i < *nseen; i++)
        if (strcmp(seen[i], from->name) == 0) return;
    snprintf(seen[(*nseen)++], 256, "%s", from->name);

    SymRow up[8];
    int nu = callers_of(cg, from, up, 8);
    if (nu == 0) {                       /* nothing calls it — a root */
        if (ep_interesting(from)) ep_push(out, n, cap, from);
        return;
    }
    for (int j = 0; j < nu && *n < cap; j++)
        ep_climb(cg, &up[j], out, n, cap, depth - 1, seen, nseen);
}

static int context_entry_points(Cg *cg, const char *q, const SymRow *matched,
                                int nmatched, SymRow *out, int cap) {
    int n = 0;
    char like[300];
    snprintf(like, sizeof like, "%%%s%%", q);
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT " SYM_COLS " FROM routes r "
        "JOIN symbols s ON s.name=r.handler "
        "JOIN files f ON f.id=s.file_id "
        "WHERE r.pattern LIKE ?1 OR ifnull(r.handler,'') LIKE ?1 "
        "ORDER BY f.path,s.line LIMIT ?2");
    sqlite3_bind_text(st, 1, like, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(st, 2, cap);
    while (n < cap && sqlite3_step(st) == SQLITE_ROW) {
        SymRow r; sym_from_stmt(st, &r);
        ep_push(out, &n, cap, &r);
    }
    sqlite3_finalize(st);

    char seen[64][256];
    int nseen = 0;
    for (int i = 0; i < nmatched && n < cap; i++)
        ep_climb(cg, &matched[i], out, &n, cap, 5, seen, &nseen);
    return n;
}

static void json_sym(StrBuf *b, const SymRow *r) {
    sb_puts(b, "{\"name\":");   sb_json_str(b, r->name);
    sb_puts(b, ",\"kind\":");   sb_json_str(b, r->kind);
    sb_puts(b, ",\"path\":");   sb_json_str(b, r->path);
    sb_printf(b, ",\"line\":%d,\"end_line\":%d,\"sig\":", r->line, r->end_line);
    sb_json_str(b, r->sig);
    sb_putc(b, '}');
}

/* compact repeat form: enough to jump to the code without restating it */
static void json_sym_compact(StrBuf *b, const SymRow *r) {
    char at[1100];
    snprintf(at, sizeof at, "%s:%d", r->path, r->line);
    sb_puts(b, "{\"n\":");  sb_json_str(b, r->name);
    sb_puts(b, ",\"at\":"); sb_json_str(b, at);
    if (r->soft) sb_puts(b, ",\"soft\":true");   /* prose edge, not a call */
    sb_putc(b, '}');
}

/* names already emitted in full form — later mentions go compact */
typedef struct { char v[96][256]; int n; } SeenSet;

static bool seen_has(const SeenSet *s, const char *name) {
    for (int i = 0; i < s->n; i++)
        if (strcmp(s->v[i], name) == 0) return true;
    return false;
}

static void seen_add(SeenSet *s, const char *name) {
    if (s->n < 96 && !seen_has(s, name))
        snprintf(s->v[s->n++], sizeof s->v[0], "%s", name);
}

/* first line of the file containing tok, case-insensitive; 0 when absent —
 * body FTS matches whole files, agents need a line to jump to */
static int body_first_line(Cg *cg, const char *rel, const char *tok) {
    char abs[4900];
    snprintf(abs, sizeof abs, "%s/%s", cg->root, rel);
    size_t len = 0;
    char *data = read_entire_file(abs, &len);
    if (!data) return 0;
    size_t tl = strlen(tok);
    int line = 1, hit = 0;
    const char *p = data;
    while (p < data + len && !hit && tl) {
        const char *nl = memchr(p, '\n', (size_t)(data + len - p));
        size_t ll = nl ? (size_t)(nl - p) : (size_t)(data + len - p);
        for (size_t i = 0; i + tl <= ll; i++)
            if (strncasecmp(p + i, tok, tl) == 0) { hit = line; break; }
        p += ll + (nl ? 1 : 0);
        line++;
    }
    free(data);
    return hit;
}

/* ---------------- search ---------------- */

int cmd_search(Cg *cg, const char *q, int limit, bool json) {
    SymRow *rows = xmalloc(sizeof(SymRow) * (size_t)limit);
    int n = find_symbols_tokenized(cg, q, rows, limit);

    /* body full-text hits, located by the first line holding the first
     * query token so the agent can jump straight to it */
    char ftoks[1][128];
    const char *ftok = tokenize(q, ftoks, 1) > 0 ? ftoks[0] : q;
    char *fw = fts_words(q);
    StrBuf files; sb_init(&files);
    int nf = 0;
    if (fw) {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT f.path, snippet(body_fts,1,'>>','<<','…',10) "
            "FROM body_fts JOIN files f ON f.id=body_fts.rowid "
            "WHERE body_fts MATCH ? ORDER BY rank,f.path LIMIT 8");
        sqlite3_bind_text(st, 1, fw, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *path = (const char *)sqlite3_column_text(st, 0);
            const char *snip = (const char *)sqlite3_column_text(st, 1);
            int ln = body_first_line(cg, path, ftok);
            if (json) {
                if (nf) sb_putc(&files, ',');
                sb_puts(&files, "{\"path\":");
                sb_json_str(&files, path);
                if (ln) sb_printf(&files, ",\"line\":%d", ln);
                sb_puts(&files, ",\"excerpt\":");
                sb_json_str(&files, snip ? snip : "");
                sb_putc(&files, '}');
            } else {
                if (ln) sb_printf(&files, "  %s:%d\n", path, ln);
                else sb_printf(&files, "  %s\n", path);
                if (snip) {
                    StrBuf one; sb_init(&one);
                    for (const char *p = snip; *p; p++)
                        sb_putc(&one, *p == '\n' ? ' ' : *p);
                    sb_printf(&files, "    %.200s\n", one.p);
                    sb_free(&one);
                }
            }
            nf++;
        }
        sqlite3_finalize(st);
        free(fw);
    }

    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"query\":");
        sb_json_str(&b, q);
        sb_puts(&b, ",\"symbols\":[");
        for (int i = 0; i < n; i++) {
            if (i) sb_putc(&b, ',');
            json_sym(&b, &rows[i]);
        }
        sb_puts(&b, "],\"files\":[");
        sb_puts(&b, files.p);
        sb_puts(&b, "]}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        if (n == 0 && nf == 0) {
            printf("no matches for '%s'\n", q);
        } else {
            for (int i = 0; i < n; i++)
                printf("%-10s %-28s %s:%d  %s\n", rows[i].kind, rows[i].name,
                       rows[i].path, rows[i].line, rows[i].sig);
            if (nf) {
                printf("%s— full-text matches —\n", n ? "\n" : "");
                fputs(files.p, stdout);
            }
        }
    }
    sb_free(&files);
    free(rows);
    return 0;
}

/* ---------------- symbol ---------------- */

int cmd_symbol(Cg *cg, const char *name, bool json) {
    SymRow rows[16];
    int n = find_symbols(cg, name, rows, 16);
    if (n == 0) {
        if (json) printf("{\"symbol\":null}\n");
        else fprintf(stderr, "cg: symbol '%s' not found\n", name);
        return 1;
    }
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"definitions\":[");
    for (int i = 0; i < n; i++) {
        SymRow *r = &rows[i];
        int refs = ref_count(cg, r->name);
        SymDoc d = {0};
        /* the deep view keeps the body; the doc leads it rather than
         * replacing it — cg symbol is where an agent goes for the whole
         * picture, cg context is where the budget is fought over */
        bool docd = !body_first() && symbol_doc(cg, r, &d);
        char *snip = file_snippet(cg, r->path, r->line,
                                  r->end_line > r->line + 11 ? r->line + 11
                                                             : r->end_line);
        if (json) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"name\":"); sb_json_str(&b, r->name);
            sb_puts(&b, ",\"kind\":"); sb_json_str(&b, r->kind);
            sb_puts(&b, ",\"path\":"); sb_json_str(&b, r->path);
            sb_printf(&b, ",\"line\":%d,\"end_line\":%d,\"references\":%d",
                      r->line, r->end_line, refs);
            if (docd) doc_json(&b, &d);
            sb_puts(&b, ",\"snippet\":");
            sb_json_str(&b, snip ? snip : "");
            sb_putc(&b, '}');
        } else {
            sb_printf(&b, "%s %s — %s:%d (referenced %d×)\n",
                      r->kind, r->name, r->path, r->line, refs);
            if (docd) doc_render(&b, &d);
            if (snip) { sb_puts(&b, snip); sb_putc(&b, '\n'); }
        }
        free(snip);
        free(d.body);
    }
    if (json) sb_puts(&b, "]}\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}

/* ---------------- impact ---------------- */

typedef struct { char name[256]; char via[256]; int depth; SymRow loc; } INode;

static bool inode_seen(INode *v, int n, const char *name) {
    for (int i = 0; i < n; i++)
        if (strcmp(v[i].name, name) == 0) return true;
    return false;
}

#define IMPACT_CAP 400

/* BFS over caller edges (dir=up) or callee edges (dir=down) */
static int impact_bfs(Cg *cg, const SymRow *root, int depth, bool up,
                      INode *out) {
    int n = 0, qhead = 0;
    INode *q = xmalloc(sizeof(INode) * IMPACT_CAP);
    snprintf(q[0].name, sizeof q[0].name, "%s", root->name);
    q[0].depth = 0;
    q[0].loc = *root;
    int qn = 1;
    while (qhead < qn && n < IMPACT_CAP) {
        INode cur = q[qhead++];
        if (cur.depth >= depth) continue;
        SymRow nb[32];
        int k;
        if (up) k = callers_of(cg, &cur.loc, nb, 32);
        else    k = callees_of(cg, cur.loc.id, nb, 32);
        for (int i = 0; i < k && n < IMPACT_CAP; i++) {
            if (strcmp(nb[i].name, root->name) == 0) continue;
            if (inode_seen(out, n, nb[i].name) || inode_seen(q, qn, nb[i].name))
                continue;
            INode *o = &out[n++];
            snprintf(o->name, sizeof o->name, "%s", nb[i].name);
            snprintf(o->via, sizeof o->via, "%s", cur.name);
            o->depth = cur.depth + 1;
            o->loc = nb[i];
            if (qn < IMPACT_CAP) q[qn++] = *o;
        }
    }
    free(q);
    return n;
}

/* one BFS direction as compact JSON nodes, byte-budgeted with an
 * omission marker so agents always see how much was cut */
static void impact_json_dir(StrBuf *b, const char *key, const INode *v, int n,
                            size_t cap) {
    if (n == 0) return;                     /* omit empty arrays entirely */
    sb_printf(b, ",\"%s\":[", key);
    int emitted = 0, omitted = 0;
    for (int i = 0; i < n; i++) {
        StrBuf it; sb_init(&it);
        char at[1100];
        snprintf(at, sizeof at, "%s:%d", v[i].loc.path, v[i].loc.line);
        sb_puts(&it, "{\"n\":");  sb_json_str(&it, v[i].name);
        sb_puts(&it, ",\"at\":"); sb_json_str(&it, at);
        if (v[i].loc.soft) sb_puts(&it, ",\"soft\":true");
        sb_printf(&it, ",\"depth\":%d,\"via\":", v[i].depth);
        sb_json_str(&it, v[i].via);
        sb_putc(&it, '}');
        if (b->len + it.len > cap) { omitted = n - i; sb_free(&it); break; }
        if (emitted) sb_putc(b, ',');
        sb_puts(b, it.p);
        sb_free(&it);
        emitted++;
    }
    if (omitted)
        sb_printf(b, "%s{\"omitted\":%d}", emitted ? "," : "", omitted);
    sb_putc(b, ']');
}

int cmd_impact(Cg *cg, const char *name, int depth, int budget, bool json) {
    if (budget <= 0) budget = 8000;
    size_t cap = (size_t)budget * 4;        /* ~4 bytes per token */
    SymRow rows[4];
    int nr = find_symbols(cg, name, rows, 4);
    if (nr == 0) {
        if (json) printf("{\"symbol\":null}\n");
        else fprintf(stderr, "cg: symbol '%s' not found\n", name);
        return 1;
    }
    INode *up = xmalloc(sizeof(INode) * IMPACT_CAP);
    INode *dn = xmalloc(sizeof(INode) * IMPACT_CAP);
    int nu = impact_bfs(cg, &rows[0], depth, true, up);
    int nd = impact_bfs(cg, &rows[0], depth, false, dn);

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"symbol\":");
        json_sym(&b, &rows[0]);
        sb_printf(&b, ",\"depth\":%d", depth);
        impact_json_dir(&b, "callers", up, nu, cap);
        impact_json_dir(&b, "callees", dn, nd, cap);
        sb_puts(&b, "}\n");
    } else {
        sb_printf(&b, "%s %s — %s:%d\n\n", rows[0].kind, rows[0].name,
                  rows[0].path, rows[0].line);
        sb_printf(&b, "impact radius (callers, depth ≤ %d): %d symbol%s\n",
                  depth, nu, nu == 1 ? "" : "s");
        for (int d = 1; d <= depth; d++)
            for (int i = 0; i < nu; i++)
                if (up[i].depth == d) {
                    char nm[272];
                    snprintf(nm, sizeof nm, "%s%s", up[i].name,
                             up[i].loc.soft ? " (soft)" : "");
                    sb_printf(&b, "  %*s%-28s %s:%d  (via %s)\n", d * 2, "",
                              nm, up[i].loc.path, up[i].loc.line, up[i].via);
                }
        sb_printf(&b, "\ndepends on (callees, depth ≤ %d): %d symbol%s\n",
                  depth, nd, nd == 1 ? "" : "s");
        for (int d = 1; d <= depth; d++)
            for (int i = 0; i < nd; i++)
                if (dn[i].depth == d) {
                    char nm[272];
                    snprintf(nm, sizeof nm, "%s%s", dn[i].name,
                             dn[i].loc.soft ? " (soft)" : "");
                    sb_printf(&b, "  %*s%-28s %s:%d\n", d * 2, "",
                              nm, dn[i].loc.path, dn[i].loc.line);
                }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    free(up); free(dn);
    return 0;
}

/* ---------------- routes ---------------- */

int cmd_routes(Cg *cg, const char *filter, bool json) {
    const char *sql =
        "SELECT r.framework,r.method,r.pattern,r.handler,f.path,r.line "
        "FROM routes r JOIN files f ON f.id=r.file_id "
        "WHERE (?1 IS NULL OR r.pattern LIKE ?2 OR r.handler LIKE ?2 "
        "OR r.framework LIKE ?2) ORDER BY r.pattern LIMIT 500";
    sqlite3_stmt *st = cg_prep(cg, sql);
    if (filter) {
        char like[300];
        snprintf(like, sizeof like, "%%%s%%", filter);
        sqlite3_bind_text(st, 1, filter, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, like, -1, SQLITE_TRANSIENT);
    } else {
        sqlite3_bind_null(st, 1);
        sqlite3_bind_null(st, 2);
    }
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"routes\":[");
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *fw = (const char *)sqlite3_column_text(st, 0);
        const char *me = (const char *)sqlite3_column_text(st, 1);
        const char *pa = (const char *)sqlite3_column_text(st, 2);
        const char *ha = (const char *)sqlite3_column_text(st, 3);
        const char *pt = (const char *)sqlite3_column_text(st, 4);
        int line = sqlite3_column_int(st, 5);
        if (json) {
            if (n) sb_putc(&b, ',');
            sb_puts(&b, "{\"framework\":"); sb_json_str(&b, fw);
            sb_puts(&b, ",\"method\":");    sb_json_str(&b, me);
            sb_puts(&b, ",\"pattern\":");   sb_json_str(&b, pa);
            sb_puts(&b, ",\"handler\":");
            if (ha) sb_json_str(&b, ha); else sb_puts(&b, "null");
            sb_puts(&b, ",\"path\":");      sb_json_str(&b, pt);
            sb_printf(&b, ",\"line\":%d}", line);
        } else {
            sb_printf(&b, "%-7s %-32s %s:%d", me, pa, pt, line);
            if (ha) sb_printf(&b, "  → %s", ha);
            sb_printf(&b, "  [%s]\n", fw);
        }
        n++;
    }
    sqlite3_finalize(st);
    if (json) sb_puts(&b, "]}\n");
    else if (n == 0) sb_puts(&b, "no routes found\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}

/* ---------------- survey: the tier below bodies ---------------- */

/* First substantive line of a comment body, capped. Lines with no
 * letter or digit (a bare opener, a rule of dashes) are skipped and a
 * block-comment gutter is trimmed, so a JSDoc block reads as its text,
 * not as its fence. The ellipsis appears only when prose follows. */
static void first_line(StrBuf *b, const char *body, int max) {
    const char *p = body;
    for (;;) {
        const char *nl = strchr(p, '\n');
        int ll = nl ? (int)(nl - p) : (int)strlen(p);
        bool word = false;
        for (int i = 0; i < ll && !word; i++)
            word = isalnum((unsigned char)p[i]);
        if (!word && nl) { p = nl + 1; continue; }
        while (ll > 0 && (*p == ' ' || *p == '\t')) { p++; ll--; }
        if (ll > 1 && p[0] == '*' && p[1] != '/') {
            p++; ll--;
            while (ll > 0 && *p == ' ') { p++; ll--; }
        }
        bool more = false;                  /* any prose on later lines? */
        for (const char *q = nl; q && !more; q = strchr(q + 1, '\n'))
            for (const char *c = q + 1; *c && *c != '\n' && !more; c++)
                more = isalnum((unsigned char)*c);
        if (ll > max) { ll = max; more = true; }
        sb_printf(b, "%.*s", ll, p);
        if (more) sb_puts(b, " …");
        return;
    }
}

/* One symbol row of a survey: name, signature, and the doc's first line.
 * The whole point is what is absent — never a body line. */
typedef struct {
    char name[256], kind[32], sig[512];
    int line, end_line;
    char *doc;            /* owned */
    bool stale;
} SurveySym;

int cmd_survey(Cg *cg, const char *scope, int budget, bool json) {
    /* the wide tier: ~160 tokens per dense file, sized for 100 files */
    if (budget <= 0) budget = 16000;
    size_t cap = (size_t)budget * 4;        /* ~4 bytes per token */
    const char *arg = scope ? scope : "";

    /* path mode when the argument prefixes at least one indexed path;
     * otherwise the argument is a prose query against the anchor index */
    bool pathmode = true;
    if (arg[0]) {
        sqlite3_stmt *pq = cg_prep(cg,
            "SELECT 1 FROM files WHERE path LIKE ?1||'%' LIMIT 1");
        sqlite3_bind_text(pq, 1, arg, -1, SQLITE_STATIC);
        pathmode = sqlite3_step(pq) == SQLITE_ROW;
        sqlite3_finalize(pq);
    }

    /* the files in scope, deterministically ordered */
    struct { long id; char path[1024]; } *fv = NULL;
    int nf = 0, cf = 0;
    sqlite3_stmt *fq;
    if (pathmode) {
        fq = cg_prep(cg,
            "SELECT id, path FROM files WHERE path LIKE ?1||'%' "
            "ORDER BY path");
        sqlite3_bind_text(fq, 1, arg, -1, SQLITE_STATIC);
    } else {
        char *fw = fts_words(arg);
        if (!fw) {
            if (json) printf("{\"scope\":\"\",\"files\":[],\"omitted\":0}\n");
            else printf("survey: nothing matches '%s'\n", arg);
            return 1;
        }
        fq = cg_prep(cg,
            "SELECT f.id, f.path FROM comment_fts x "
            "JOIN comments c ON c.id = x.rowid "
            "JOIN files f ON f.id = c.file_id "
            "WHERE comment_fts MATCH ?1 "
            "GROUP BY f.id ORDER BY min(rank), f.path");
        sqlite3_bind_text(fq, 1, fw, -1, SQLITE_TRANSIENT);
        free(fw);
    }
    while (sqlite3_step(fq) == SQLITE_ROW) {
        if (nf == cf) {
            cf = cf ? cf * 2 : 64;
            fv = xrealloc(fv, sizeof *fv * (size_t)cf);
        }
        fv[nf].id = sqlite3_column_int64(fq, 0);
        snprintf(fv[nf].path, sizeof fv[nf].path, "%s",
                 (const char *)sqlite3_column_text(fq, 1));
        nf++;
    }
    sqlite3_finalize(fq);

    sqlite3_stmt *purq = cg_prep(cg,
        "SELECT body FROM comments WHERE file_id=? AND kind='file' "
        "ORDER BY line LIMIT 1");
    /* one doc per symbol: the span nearest the def wins, like symbol_doc */
    sqlite3_stmt *docq = cg_prep(cg,
        "SELECT s.name, s.kind, s.sig, s.line, s.end_line, c.body, "
        "c.anchored_hash FROM symbols s "
        "JOIN comments c ON c.sym_id = s.id AND c.kind='doc' "
        "WHERE s.file_id=?1 AND c.line = (SELECT max(c2.line) FROM comments "
        "c2 WHERE c2.sym_id = s.id AND c2.kind='doc') ORDER BY s.line");
    sqlite3_stmt *uncq = cg_prep(cg,
        "SELECT name FROM symbols WHERE file_id=?1 AND id NOT IN "
        "(SELECT sym_id FROM comments WHERE kind='doc' AND sym_id IS NOT "
        "NULL) ORDER BY line");

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"scope\":");
        sb_json_str(&b, arg);
        sb_puts(&b, ",\"files\":[");
    } else {
        sb_printf(&b, "survey of %s (%d file%s)\n",
                  arg[0] ? arg : "the whole tree", nf, nf == 1 ? "" : "s");
    }

    int emitted = 0, omitted = 0;
    for (int i = 0; i < nf; i++) {
        StrBuf it; sb_init(&it);

        char *purpose = NULL;
        sqlite3_bind_int64(purq, 1, fv[i].id);
        if (sqlite3_step(purq) == SQLITE_ROW) {
            const char *pb = (const char *)sqlite3_column_text(purq, 0);
            if (pb) purpose = xstrdup(pb);
        }
        sqlite3_reset(purq);

        SurveySym sv[64];
        int nsv = 0;
        char *data = NULL;              /* file bytes, read only for drift */
        size_t dlen = 0;
        bool tried = false;
        sqlite3_bind_int64(docq, 1, fv[i].id);
        while (nsv < 64 && sqlite3_step(docq) == SQLITE_ROW) {
            const char *nm = (const char *)sqlite3_column_text(docq, 0);
            const char *kd = (const char *)sqlite3_column_text(docq, 1);
            const char *sg = (const char *)sqlite3_column_text(docq, 2);
            const char *bd = (const char *)sqlite3_column_text(docq, 5);
            const char *ah = (const char *)sqlite3_column_text(docq, 6);
            if (!nm || !bd) continue;
            if (doc_derivable(bd, nm, sg ? sg : "")) continue;
            SurveySym *y = &sv[nsv++];
            snprintf(y->name, sizeof y->name, "%s", nm);
            snprintf(y->kind, sizeof y->kind, "%s", kd ? kd : "");
            snprintf(y->sig, sizeof y->sig, "%s", sg ? sg : "");
            y->line = sqlite3_column_int(docq, 3);
            y->end_line = sqlite3_column_int(docq, 4);
            y->doc = xstrdup(bd);
            y->stale = false;
            if (ah && *ah) {
                if (!tried) {
                    tried = true;
                    char abs[5200];
                    snprintf(abs, sizeof abs, "%s/%s", cg->root, fv[i].path);
                    data = read_entire_file(abs, &dlen);
                }
                if (data) {
                    char h[65];
                    hash_lines(data, dlen, y->line, y->end_line, h);
                    y->stale = strcmp(h, ah) != 0;
                }
            }
        }
        sqlite3_reset(docq);
        free(data);

        /* stale anchors rank below current ones, order stable within */
        SurveySym ord[64];
        int no = 0;
        for (int j = 0; j < nsv; j++) if (!sv[j].stale) ord[no++] = sv[j];
        for (int j = 0; j < nsv; j++) if (sv[j].stale)  ord[no++] = sv[j];

        char unc[8][256];
        int nunc = 0, more_unc = 0;
        sqlite3_bind_int64(uncq, 1, fv[i].id);
        while (sqlite3_step(uncq) == SQLITE_ROW) {
            const char *nm = (const char *)sqlite3_column_text(uncq, 0);
            if (!nm) continue;
            if (nunc < 8) snprintf(unc[nunc++], sizeof unc[0], "%s", nm);
            else more_unc++;
        }
        sqlite3_reset(uncq);

        enum { DOCS_SHOWN = 3 };
        int shown = no < DOCS_SHOWN ? no : DOCS_SHOWN;
        if (json) {
            sb_puts(&it, "{\"path\":");
            sb_json_str(&it, fv[i].path);
            sb_puts(&it, ",\"purpose\":");
            if (purpose) {
                StrBuf pl; sb_init(&pl);
                first_line(&pl, purpose, 140);
                sb_json_str(&it, pl.p ? pl.p : "");
                sb_free(&pl);
            } else {
                sb_puts(&it, "null");
            }
            sb_puts(&it, ",\"docs\":[");
            for (int j = 0; j < shown; j++) {
                if (j) sb_putc(&it, ',');
                sb_puts(&it, "{\"name\":");
                sb_json_str(&it, ord[j].name);
                sb_puts(&it, ",\"kind\":");
                sb_json_str(&it, ord[j].kind);
                sb_printf(&it, ",\"line\":%d,\"sig\":", ord[j].line);
                sb_json_str(&it, ord[j].sig);
                sb_puts(&it, ",\"doc\":");
                StrBuf dl; sb_init(&dl);
                first_line(&dl, ord[j].doc, 140);
                sb_json_str(&it, dl.p ? dl.p : "");
                sb_free(&dl);
                if (ord[j].stale) sb_puts(&it, ",\"stale\":true");
                sb_putc(&it, '}');
            }
            sb_putc(&it, ']');
            if (no > shown) sb_printf(&it, ",\"more_docs\":%d", no - shown);
            sb_puts(&it, ",\"uncovered\":[");
            for (int j = 0; j < nunc; j++) {
                if (j) sb_putc(&it, ',');
                sb_json_str(&it, unc[j]);
            }
            sb_putc(&it, ']');
            if (more_unc) sb_printf(&it, ",\"more_uncovered\":%d", more_unc);
            sb_putc(&it, '}');
        } else {
            sb_printf(&it, "\n%s — ", fv[i].path);
            if (purpose) first_line(&it, purpose, 140);
            else sb_puts(&it, "(no file anchor)");
            sb_putc(&it, '\n');
            for (int j = 0; j < shown; j++) {
                sb_printf(&it, "  %s:%d  ", ord[j].name, ord[j].line);
                first_line(&it, ord[j].sig, 100);
                if (ord[j].stale) sb_puts(&it, "  [stale]");
                sb_puts(&it, "\n      ");
                first_line(&it, ord[j].doc, 140);
                sb_putc(&it, '\n');
            }
            if (no > shown)
                sb_printf(&it, "  (+%d more documented)\n", no - shown);
            if (nunc) {
                sb_puts(&it, "  uncovered:");
                for (int j = 0; j < nunc; j++)
                    sb_printf(&it, "%s %s", j ? "," : "", unc[j]);
                if (more_unc) sb_printf(&it, " (+%d more)", more_unc);
                sb_putc(&it, '\n');
            }
        }
        free(purpose);
        for (int j = 0; j < nsv; j++) free(sv[j].doc);

        if (b.len + it.len > cap) { omitted = nf - i; sb_free(&it); break; }
        if (json && emitted) sb_putc(&b, ',');
        sb_puts(&b, it.p);
        sb_free(&it);
        emitted++;
    }

    if (json) {
        sb_printf(&b, "],\"omitted\":%d}\n", omitted);
    } else if (omitted) {
        sb_printf(&b, "\n(+%d file%s omitted by the budget — raise "
                  "--budget or narrow the scope)\n", omitted,
                  omitted == 1 ? "" : "s");
    }
    fputs(b.p, stdout);
    sb_free(&b);
    sqlite3_finalize(purq);
    sqlite3_finalize(docq);
    sqlite3_finalize(uncq);
    free(fv);
    return nf > 0 ? 0 : 1;
}

/* ---------------- anchors: health and the backfill work list ---------------- */

typedef struct { StrBuf *txt, *js; int n; } AnchStale;

static void anch_stale_cb(void *u, const char *path, int line,
                          const char *sym, int sym_line) {
    AnchStale *a = u;
    if (a->txt)
        sb_printf(a->txt, "  %s:%d  %s (line %d)\n", path, line, sym,
                  sym_line);
    if (a->js) {
        if (a->n) sb_putc(a->js, ',');
        sb_puts(a->js, "{\"path\":");
        sb_json_str(a->js, path);
        sb_printf(a->js, ",\"line\":%d,\"symbol\":", line);
        sb_json_str(a->js, sym);
        sb_printf(a->js, ",\"sym_line\":%d}", sym_line);
    }
    a->n++;
}

/* Anchor health for the repository: how much is covered, which docs have
 * gone stale, and — the point of the command — which uncovered symbols to
 * anchor first. Ranking is a coordination score, fan-out x extent x
 * distinct referencing files, deliberately not raw inbound reference
 * count: that metric ranks the sb_puts tail highest, and those are
 * exactly the symbols that need no anchor. */
int cmd_anchors(Cg *cg, bool stale_only, bool unc_only, bool json) {
    long nsym = 0, nanch = 0, nunc = 0;
    sqlite3_stmt *q = cg_prep(cg,
        "SELECT COUNT(*),"
        " COUNT(DISTINCT (SELECT c.sym_id FROM comments c WHERE"
        "   c.sym_id = s.id AND c.kind='doc')) FROM symbols s");
    if (sqlite3_step(q) == SQLITE_ROW) {
        nsym = sqlite3_column_int64(q, 0);
        nanch = sqlite3_column_int64(q, 1);
    }
    sqlite3_finalize(q);

    StrBuf stx, sjs;
    sb_init(&stx); sb_init(&sjs);
    AnchStale as = { unc_only ? NULL : &stx, unc_only ? NULL : &sjs, 0 };
    if (!unc_only) anchor_stale(cg, anch_stale_cb, &as);

    /* uncovered functions and methods, coordination-scored in SQL */
    StrBuf utx, ujs;
    sb_init(&utx); sb_init(&ujs);
    int nu = 0;
    if (!stale_only) {
        sqlite3_stmt *uq = cg_prep(cg,
            "SELECT name, path, line, extent, fanout, nfiles,"
            " fanout * extent * nfiles AS score FROM ("
            "SELECT s.name AS name, f.path AS path, s.line AS line,"
            " s.end_line - s.line + 1 AS extent,"
            " (SELECT COUNT(DISTINCT r.name) FROM refs r"
            "   WHERE r.sym_id = s.id AND r.kind <> 'soft') AS fanout,"
            " (SELECT COUNT(DISTINCT s2.file_id) FROM refs r2"
            "   JOIN symbols s2 ON s2.id = r2.sym_id"
            "   WHERE r2.name = s.name AND r2.kind <> 'soft'"
            "   AND s2.id <> s.id) AS nfiles"
            " FROM symbols s JOIN files f ON f.id = s.file_id"
            " WHERE s.kind IN ('function','method') AND s.id NOT IN"
            "  (SELECT sym_id FROM comments WHERE kind='doc'"
            "   AND sym_id IS NOT NULL)"
            ") ORDER BY score DESC, path, line LIMIT ?1");
        sqlite3_bind_int(uq, 1, json ? 100 : 20);
        while (sqlite3_step(uq) == SQLITE_ROW) {
            const char *nm = (const char *)sqlite3_column_text(uq, 0);
            const char *pt = (const char *)sqlite3_column_text(uq, 1);
            int ln = sqlite3_column_int(uq, 2);
            long ext = sqlite3_column_int64(uq, 3);
            long fan = sqlite3_column_int64(uq, 4);
            long nfl = sqlite3_column_int64(uq, 5);
            long sc = sqlite3_column_int64(uq, 6);
            if (json) {
                if (nu) sb_putc(&ujs, ',');
                sb_puts(&ujs, "{\"name\":");
                sb_json_str(&ujs, nm);
                sb_puts(&ujs, ",\"path\":");
                sb_json_str(&ujs, pt);
                sb_printf(&ujs, ",\"line\":%d,\"score\":%ld,\"fanout\":%ld,"
                          "\"extent\":%ld,\"files\":%ld}", ln, sc, fan, ext,
                          nfl);
            } else {
                sb_printf(&utx, "  %6ld  %-24s %s:%d", sc, nm, pt, ln);
                if (sc > 0)
                    sb_printf(&utx, "   %ld callee%s × %ld line%s × %ld "
                              "file%s", fan, fan == 1 ? "" : "s", ext,
                              ext == 1 ? "" : "s", nfl,
                              nfl == 1 ? "" : "s");
                sb_putc(&utx, '\n');
            }
            nu++;
        }
        sqlite3_finalize(uq);
        sqlite3_stmt *cq = cg_prep(cg,
            "SELECT COUNT(*) FROM symbols s WHERE s.kind IN"
            " ('function','method') AND s.id NOT IN (SELECT sym_id FROM"
            " comments WHERE kind='doc' AND sym_id IS NOT NULL)");
        if (sqlite3_step(cq) == SQLITE_ROW)
            nunc = sqlite3_column_int64(cq, 0);
        sqlite3_finalize(cq);
    }

    if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"symbols\":%ld,\"anchored\":%ld", nsym, nanch);
        if (!unc_only)
            sb_printf(&b, ",\"stale\":[%s]", sjs.p ? sjs.p : "");
        if (!stale_only)
            sb_printf(&b, ",\"uncovered\":[%s],\"uncovered_total\":%ld",
                      ujs.p ? ujs.p : "", nunc);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        printf("anchors — %ld symbols, %ld anchored (%ld%%)", nsym, nanch,
               nsym ? nanch * 100 / nsym : 0);
        if (!unc_only) printf(", %d stale", as.n);
        if (!stale_only) printf(", %ld uncovered", nunc);
        printf("\n");
        if (!unc_only && as.n) {
            printf("\nstale — the doc predates the code; update it or "
                   "delete it:\n%s", stx.p ? stx.p : "");
        }
        if (!stale_only && nu) {
            printf("\nuncovered, by coordination score (fan-out × extent × "
                   "referencing files):\n%s", utx.p ? utx.p : "");
            if (nunc > nu)
                printf("  ... %ld more — score 0 is a self-evident leaf "
                       "and needs no anchor\n", nunc - nu);
            printf("\nbackfill from the top: anchor what a reader of the "
                   "code could not derive.\ncg check keeps the result "
                   "honest — a doc goes stale when its code moves on.\n");
        }
    }
    sb_free(&stx); sb_free(&sjs);
    sb_free(&utx); sb_free(&ujs);
    return 0;
}

/* ---------------- context: the one-call agent answer ---------------- */

int cmd_context(Cg *cg, const char *q, int budget, int limit, bool json) {
    if (budget <= 0) budget = 4000;
    if (limit <= 0) limit = 8;
    if (limit > 64) limit = 64;
    size_t cap = (size_t)budget * 4;        /* ~4 bytes per token */
    SymRow *rows = xmalloc(sizeof(SymRow) * (size_t)limit);
    int n = find_symbols_tokenized(cg, q, rows, limit);
    SeenSet *seen = xmalloc(sizeof *seen);
    seen->n = 0;

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"query\":");
        sb_json_str(&b, q);
    } else {
        sb_printf(&b, "context for '%s'\n", q);
    }

    /* task-relevant memories first: prior decisions frame the code below */
    Memory *mem = NULL;
    int nm = memory_query(cg, q, NULL, NULL, 3, &mem);
    if (nm > 0) {
        int emitted = 0, omitted = 0;
        if (json) sb_puts(&b, ",\"memories\":[");
        else sb_puts(&b, "\nmemories:\n");
        for (int i = 0; i < nm; i++) {
            StrBuf it; sb_init(&it);
            if (json) memory_json(&mem[i], &it);
            else sb_printf(&it, "  [%s] %s\n", mem[i].type, mem[i].body);
            if (b.len + it.len > cap) { omitted = nm - i; sb_free(&it); break; }
            if (json && emitted) sb_putc(&b, ',');
            sb_puts(&b, it.p);
            sb_free(&it);
            emitted++;
        }
        if (omitted) {
            if (json) sb_printf(&b, "%s{\"omitted\":%d}", emitted ? "," : "",
                                omitted);
            else sb_printf(&b, "  (+%d more)\n", omitted);
        }
        if (json) sb_putc(&b, ']');
    }
    memory_free(mem, nm);

    if (n > 0) {
        int emitted = 0, omitted = 0;
        if (json) sb_puts(&b, ",\"symbols\":[");
        for (int i = 0; i < n; i++) {
            SymRow *r = &rows[i];
            bool repeat = seen_has(seen, r->name);
            bool detail = !repeat && i < 3;   /* top hits get snippets+edges */
            StrBuf it; sb_init(&it);
            if (repeat) {
                if (json) json_sym_compact(&it, r);
                else sb_printf(&it, "\n● %s %s:%d\n", r->name, r->path,
                               r->line);
            } else {
                SymDoc d = {0};
                bool docd = detail && !body_first() && symbol_doc(cg, r, &d);
                /* doc-first: the intent plus the signature line buys the
                 * same understanding as twelve body lines at a fraction of
                 * the budget, so more symbols survive the same cap */
                char *snip = !detail ? NULL
                    : file_snippet(cg, r->path, r->line,
                          docd ? r->line
                               : r->end_line > r->line + 11 ? r->line + 11
                                                            : r->end_line);
                SymRow cal[8], cee[8];
                int ncal = detail ? callers_of(cg, r, cal, 8) : 0;
                int ncee = detail ? callees_of(cg, r->id, cee, 8) : 0;
                if (json) {
                    sb_puts(&it, "{\"name\":"); sb_json_str(&it, r->name);
                    sb_puts(&it, ",\"kind\":"); sb_json_str(&it, r->kind);
                    sb_puts(&it, ",\"path\":"); sb_json_str(&it, r->path);
                    sb_printf(&it, ",\"line\":%d,\"end_line\":%d,\"sig\":",
                              r->line, r->end_line);
                    sb_json_str(&it, r->sig);
                    if (docd) doc_json(&it, &d);
                    if (snip) {
                        sb_puts(&it, ",\"snippet\":");
                        sb_json_str(&it, snip);
                    }
                    if (ncal) {                /* edge lists stay compact */
                        sb_puts(&it, ",\"callers\":[");
                        for (int j = 0; j < ncal; j++) {
                            if (j) sb_putc(&it, ',');
                            json_sym_compact(&it, &cal[j]);
                        }
                        sb_putc(&it, ']');
                    }
                    if (ncee) {
                        sb_puts(&it, ",\"callees\":[");
                        for (int j = 0; j < ncee; j++) {
                            if (j) sb_putc(&it, ',');
                            json_sym_compact(&it, &cee[j]);
                        }
                        sb_putc(&it, ']');
                    }
                    sb_putc(&it, '}');
                } else {
                    sb_printf(&it, "\n● %s %s — %s:%d\n", r->kind,
                              r->name, r->path, r->line);
                    if (docd) doc_render(&it, &d);
                    if (snip) sb_puts(&it, snip);
                    if (ncal) {
                        sb_puts(&it, "  callers:");
                        for (int j = 0; j < ncal; j++)
                            sb_printf(&it, "%s %s%s %s:%d", j ? "," : "",
                                      cal[j].name,
                                      cal[j].soft ? "(soft)" : "",
                                      cal[j].path, cal[j].line);
                        sb_putc(&it, '\n');
                    }
                    if (ncee) {
                        sb_puts(&it, "  calls:");
                        for (int j = 0; j < ncee; j++)
                            sb_printf(&it, " %s%s", cee[j].name,
                                      cee[j].soft ? "(soft)" : "");
                        sb_putc(&it, '\n');
                    }
                }
                free(snip);
                free(d.body);
            }
            if (b.len + it.len > cap) { omitted = n - i; sb_free(&it); break; }
            if (json && emitted) sb_putc(&b, ',');
            sb_puts(&b, it.p);
            sb_free(&it);
            if (!repeat) seen_add(seen, r->name);
            emitted++;
        }
        if (omitted) {
            if (json) sb_printf(&b, "%s{\"omitted\":%d}", emitted ? "," : "",
                                omitted);
            else sb_printf(&b, "  (+%d more)\n", omitted);
        }
        if (json) sb_putc(&b, ']');
    }

    /* entry points: derived from the query — route handlers that match it,
     * then call-graph roots above the matched symbols, and only then main() */
    SymRow eps[8];
    int nep = context_entry_points(cg, q, rows, n, eps, 8);
    if (nep == 0) {                     /* nothing query-specific — fall back */
        sqlite3_stmt *fst = cg_prep(cg,
            "SELECT " SYM_COLS " FROM symbols s JOIN files f ON f.id=s.file_id "
            "WHERE s.name IN ('main','Main','__main__') "
            "ORDER BY (f.path LIKE '%test%' OR f.path LIKE '%fixture%'), "
            "length(f.path) LIMIT 3");
        while (nep < 3 && sqlite3_step(fst) == SQLITE_ROW)
            sym_from_stmt(fst, &eps[nep++]);
        sqlite3_finalize(fst);
    }
    if (nep > 0) {
        int emitted = 0, omitted = 0;
        if (json) sb_puts(&b, ",\"entry_points\":[");
        else sb_puts(&b, "\nentry points:\n");
        for (int i = 0; i < nep; i++) {
            bool repeat = seen_has(seen, eps[i].name);
            StrBuf it; sb_init(&it);
            if (json) {
                if (repeat) json_sym_compact(&it, &eps[i]);
                else json_sym(&it, &eps[i]);
            } else if (repeat) {
                sb_printf(&it, "  %s %s:%d\n", eps[i].name, eps[i].path,
                          eps[i].line);
            } else {
                sb_printf(&it, "  %s %s — %s:%d\n", eps[i].kind,
                          eps[i].name, eps[i].path, eps[i].line);
            }
            if (b.len + it.len > cap) {
                omitted = nep - i;
                sb_free(&it);
                break;
            }
            if (json && emitted) sb_putc(&b, ',');
            sb_puts(&b, it.p);
            sb_free(&it);
            if (!repeat) seen_add(seen, eps[i].name);
            emitted++;
        }
        if (omitted) {
            if (json) sb_printf(&b, "%s{\"omitted\":%d}", emitted ? "," : "",
                                omitted);
            else sb_printf(&b, "  (+%d more)\n", omitted);
        }
        if (json) sb_putc(&b, ']');
    }

    /* routes that match the query text */
    struct {
        char fw[64], me[16], pa[256], ha[256], pt[1024];
        int line;
        bool has_ha;
    } rts[10];
    int nrt = 0;
    char like[300];
    snprintf(like, sizeof like, "%%%s%%", q);
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT r.framework,r.method,r.pattern,r.handler,f.path,r.line "
        "FROM routes r JOIN files f ON f.id=r.file_id "
        "WHERE r.pattern LIKE ?1 OR ifnull(r.handler,'') LIKE ?1 "
        "ORDER BY r.pattern,f.path,r.line LIMIT 10");
    sqlite3_bind_text(st, 1, like, -1, SQLITE_TRANSIENT);
    while (nrt < 10 && sqlite3_step(st) == SQLITE_ROW) {
        const char *ha = (const char *)sqlite3_column_text(st, 3);
        snprintf(rts[nrt].fw, sizeof rts[nrt].fw, "%s",
                 (const char *)sqlite3_column_text(st, 0));
        snprintf(rts[nrt].me, sizeof rts[nrt].me, "%s",
                 (const char *)sqlite3_column_text(st, 1));
        snprintf(rts[nrt].pa, sizeof rts[nrt].pa, "%s",
                 (const char *)sqlite3_column_text(st, 2));
        snprintf(rts[nrt].ha, sizeof rts[nrt].ha, "%s", ha ? ha : "");
        rts[nrt].has_ha = ha != NULL;
        snprintf(rts[nrt].pt, sizeof rts[nrt].pt, "%s",
                 (const char *)sqlite3_column_text(st, 4));
        rts[nrt].line = sqlite3_column_int(st, 5);
        nrt++;
    }
    sqlite3_finalize(st);
    if (nrt > 0) {
        int emitted = 0, omitted = 0;
        if (json) sb_puts(&b, ",\"routes\":[");
        for (int i = 0; i < nrt; i++) {
            StrBuf it; sb_init(&it);
            if (json) {
                sb_puts(&it, "{\"framework\":"); sb_json_str(&it, rts[i].fw);
                sb_puts(&it, ",\"method\":");    sb_json_str(&it, rts[i].me);
                sb_puts(&it, ",\"pattern\":");   sb_json_str(&it, rts[i].pa);
                sb_puts(&it, ",\"handler\":");
                if (rts[i].has_ha) sb_json_str(&it, rts[i].ha);
                else sb_puts(&it, "null");
                sb_puts(&it, ",\"path\":");      sb_json_str(&it, rts[i].pt);
                sb_printf(&it, ",\"line\":%d}", rts[i].line);
            } else {
                sb_printf(&it, "  route %s %s — %s:%d\n", rts[i].me,
                          rts[i].pa, rts[i].pt, rts[i].line);
            }
            if (b.len + it.len > cap) {
                omitted = nrt - i;
                sb_free(&it);
                break;
            }
            if (json && emitted) sb_putc(&b, ',');
            sb_puts(&b, it.p);
            sb_free(&it);
            emitted++;
        }
        if (omitted) {
            if (json) sb_printf(&b, "%s{\"omitted\":%d}", emitted ? "," : "",
                                omitted);
            else sb_printf(&b, "  (+%d more)\n", omitted);
        }
        if (json) sb_putc(&b, ']');
    }

    /* file-level full-text hits for non-symbol terms, with a line to jump
     * to (the first line holding the first query token) */
    char ftoks[1][128];
    const char *ftok = tokenize(q, ftoks, 1) > 0 ? ftoks[0] : q;
    struct { char path[1024]; char *ex; int line; } fls[5];
    int nfl = 0;
    char *fw2 = fts_words(q);
    if (fw2) {
        st = cg_prep(cg,
            "SELECT f.path, snippet(body_fts,1,'>>','<<','…',10) "
            "FROM body_fts JOIN files f ON f.id=body_fts.rowid "
            "WHERE body_fts MATCH ? ORDER BY rank,f.path LIMIT 5");
        sqlite3_bind_text(st, 1, fw2, -1, SQLITE_TRANSIENT);
        while (nfl < 5 && sqlite3_step(st) == SQLITE_ROW) {
            const char *path = (const char *)sqlite3_column_text(st, 0);
            const char *sn = (const char *)sqlite3_column_text(st, 1);
            snprintf(fls[nfl].path, sizeof fls[nfl].path, "%s", path);
            fls[nfl].ex = xstrdup(sn ? sn : "");
            fls[nfl].line = body_first_line(cg, path, ftok);
            nfl++;
        }
        sqlite3_finalize(st);
        free(fw2);
    }
    if (nfl > 0) {
        int emitted = 0, omitted = 0;
        if (json) sb_puts(&b, ",\"files\":[");
        else sb_puts(&b, "\nfiles:\n");
        for (int i = 0; i < nfl; i++) {
            StrBuf it; sb_init(&it);
            if (json) {
                sb_puts(&it, "{\"path\":");
                sb_json_str(&it, fls[i].path);
                if (fls[i].line) sb_printf(&it, ",\"line\":%d", fls[i].line);
                sb_puts(&it, ",\"excerpt\":");
                sb_json_str(&it, fls[i].ex);
                sb_putc(&it, '}');
            } else if (fls[i].line) {
                sb_printf(&it, "  %s:%d\n", fls[i].path, fls[i].line);
            } else {
                sb_printf(&it, "  %s\n", fls[i].path);
            }
            if (b.len + it.len > cap) {
                omitted = nfl - i;
                sb_free(&it);
                break;
            }
            if (json && emitted) sb_putc(&b, ',');
            sb_puts(&b, it.p);
            sb_free(&it);
            emitted++;
        }
        if (omitted) {
            if (json) sb_printf(&b, "%s{\"omitted\":%d}", emitted ? "," : "",
                                omitted);
            else sb_printf(&b, "  (+%d more)\n", omitted);
        }
        if (json) sb_putc(&b, ']');
    }
    for (int i = 0; i < nfl; i++) free(fls[i].ex);

    if (json) sb_puts(&b, "}\n");
    fputs(b.p, stdout);
    sb_free(&b);
    free(seen);
    free(rows);
    return 0;
}

/* ---------------- show: one symbol, not its whole file ---------------- */

/* Agents burn context reading a 2000-line file to see one function. `cg show`
 * returns exactly the symbol body the graph already knows the bounds of. */
/* Resolve "path:line" to the symbol whose body encloses that line. Editors
 * and agents hold a cursor, not a name, so this is the position-first door
 * into the graph — the same lookup `cg lsp` answers over the wire. */
static int symbols_at_position(Cg *cg, const char *path, int line,
                               SymRow *out, int cap) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT " SYM_COLS " FROM symbols s JOIN files f ON f.id=s.file_id "
        "WHERE (f.path=?1 OR f.path LIKE '%/' || ?1) "
        "AND s.line<=?2 AND (s.end_line>=?2 OR s.end_line=0) "
        "ORDER BY s.line DESC LIMIT ?3");
    sqlite3_bind_text(st, 1, path, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, line);
    sqlite3_bind_int(st, 3, cap);
    int n = 0;
    while (n < cap && sqlite3_step(st) == SQLITE_ROW)
        sym_from_stmt(st, &out[n++]);
    sqlite3_finalize(st);
    return n;
}

int graph_symbol_at(Cg *cg, const char *path, int line, char *name,
                    size_t cap) {
    SymRow r[1];
    if (symbols_at_position(cg, path, line, r, 1) == 0) return -1;
    snprintf(name, cap, "%s", r[0].name);
    return 0;
}

int cmd_show(Cg *cg, const char *name, bool full, bool json) {
    SymRow rows[8];
    int n = 0;
    /* "src/util.ts:42" addresses a position; a bare word addresses a name */
    const char *colon = strrchr(name, ':');
    if (colon && colon[1] && strspn(colon + 1, "0123456789") == strlen(colon + 1)) {
        char path[1024];
        snprintf(path, sizeof path, "%.*s", (int)(colon - name), name);
        n = symbols_at_position(cg, path, atoi(colon + 1), rows, 8);
    }
    if (n == 0) n = find_symbols(cg, name, rows, 8);
    if (n == 0) {
        if (json) printf("{\"name\":\"%s\",\"definitions\":[]}\n", name);
        else fprintf(stderr, "cg: no symbol named '%s'\n", name);
        return 1;
    }
    StrBuf b; sb_init(&b);
    if (json) { sb_puts(&b, "{\"name\":"); sb_json_str(&b, name);
                sb_puts(&b, ",\"definitions\":["); }
    for (int i = 0; i < n; i++) {
        int from = rows[i].line;
        int to = rows[i].end_line > from ? rows[i].end_line : from;
        int total = to - from + 1;
        int shown = (!full && total > 40) ? 40 : total;
        char *body = file_snippet_n(cg, rows[i].path, from, to, shown);
        char marker[80] = "";
        if (shown < total)
            snprintf(marker, sizeof marker,
                     "… (+%d more lines, use --full)\n", total - shown);
        if (json) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"path\":");     sb_json_str(&b, rows[i].path);
            sb_printf(&b, ",\"line\":%d,\"end_line\":%d,\"kind\":",
                      rows[i].line, rows[i].end_line);
            sb_json_str(&b, rows[i].kind);
            sb_puts(&b, ",\"body\":");
            if (body && marker[0]) {
                StrBuf tb; sb_init(&tb);
                sb_puts(&tb, body);
                sb_puts(&tb, marker);
                sb_json_str(&b, tb.p);
                sb_free(&tb);
            } else {
                sb_json_str(&b, body ? body : "");
            }
            sb_putc(&b, '}');
        } else {
            sb_printf(&b, "%s %s — %s:%d-%d\n", rows[i].kind, rows[i].name,
                      rows[i].path, rows[i].line, rows[i].end_line);
            if (body) sb_puts(&b, body);
            if (marker[0]) sb_puts(&b, marker);
            if (i + 1 < n) sb_putc(&b, '\n');
        }
        free(body);
    }
    if (json) sb_puts(&b, "]}\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}

/* ---------------- test impact ---------------- */

/* Path shapes that mean "this file is a test" across the supported languages.
 * Kept as SQL so the join stays in one query. */
#define TEST_PATH_SQL \
    "(f.path LIKE 'test/%' OR f.path LIKE 'tests/%' OR f.path LIKE '%/test/%'" \
    " OR f.path LIKE '%/tests/%' OR f.path LIKE '%/spec/%' OR f.path LIKE 'spec/%'" \
    " OR f.path LIKE '%\\_test.%' ESCAPE '\\' OR f.path LIKE '%test\\_%' ESCAPE '\\'" \
    " OR f.path LIKE '%.test.%' OR f.path LIKE '%.spec.%' OR f.path LIKE '%Test.%'" \
    " OR f.path LIKE '%Tests.%' OR f.path LIKE '%_spec.%')"

bool graph_path_is_test(const char *path) {
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    const char *ext = path_ext(path);

    /* Plans and prose are never tests. Codify's own spec/ directory holds kvx
     * and markdown, so a bare `spec/` prefix cannot mean "test" on its own. */
    /* path_ext keeps the leading dot */
    static const char *PROSE[] = { ".md", ".kvx", ".txt", ".json", ".yml",
                                   ".yaml", NULL };
    for (int i = 0; ext && PROSE[i]; i++)
        if (strcasecmp(ext, PROSE[i]) == 0) return false;

    if (strstr(path, "/test/") || strstr(path, "/tests/") ||
        strstr(path, "/__tests__/") || strncmp(path, "test/", 5) == 0 ||
        strncmp(path, "tests/", 6) == 0)
        return true;
    /* `spec/` is a test directory in Ruby, and a plan directory here */
    if ((strncmp(path, "spec/", 5) == 0 || strstr(path, "/spec/")) &&
        ext && strcasecmp(ext, ".rb") == 0)
        return true;

    /* filename conventions: foo.test.ts, foo_test.go, test_foo.py, FooTest.java */
    if (strstr(base, ".test.") || strstr(base, ".spec.") ||
        strstr(base, "_test.") || strstr(base, "_spec.") ||
        strncmp(base, "test_", 5) == 0)
        return true;
    size_t bl = strlen(base);
    const char *dot = strrchr(base, '.');
    size_t stem = dot ? (size_t)(dot - base) : bl;
    if (stem > 4 && strncmp(base + stem - 4, "Test", 4) == 0) return true;
    if (stem > 5 && strncmp(base + stem - 5, "Tests", 5) == 0) return true;
    return false;
}

/* tests referencing `name`; returns count, appends rows to b */
static int tests_for_symbol(Cg *cg, const char *name, StrBuf *b, bool json,
                            int *emitted) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT DISTINCT f.path, r.line FROM refs r "
        "JOIN files f ON f.id=r.file_id "
        "WHERE r.name=? AND " TEST_PATH_SQL " ORDER BY f.path, r.line LIMIT 25");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_STATIC);
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *path = (const char *)sqlite3_column_text(st, 0);
        int line = sqlite3_column_int(st, 1);
        if (json) {
            if (*emitted) sb_putc(b, ',');
            sb_puts(b, "{\"symbol\":");  sb_json_str(b, name);
            sb_puts(b, ",\"path\":");    sb_json_str(b, path);
            sb_printf(b, ",\"line\":%d}", line);
        } else {
            sb_printf(b, "  %-28s %s:%d\n", name, path, line);
        }
        (*emitted)++;
        n++;
    }
    sqlite3_finalize(st);
    return n;
}

/* Choose the first declared task symbol the current graph can actually
 * resolve. Work packets use this instead of title search so their one context
 * call starts at a real definition; title is the deterministic fallback. */
char *graph_task_focus(Cg *cg, const char *task_packet) {
    char *symbols = task_packet ? json_get_raw(task_packet, "symbols") : NULL;
    if (symbols) {
        for (const char *p = symbols; *p; p++) {
            if (*p != '"') continue;
            const char *s = ++p;
            while (*p && !(*p == '"' && p[-1] != '\\')) p++;
            size_t n = (size_t)(p - s);
            if (!n || n >= 256) continue;
            char name[256];
            memcpy(name, s, n); name[n] = 0;
            sqlite3_stmt *st = cg_prep(cg,
                "SELECT 1 FROM symbols WHERE name=? LIMIT 1");
            sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
            bool found = sqlite3_step(st) == SQLITE_ROW;
            sqlite3_finalize(st);
            if (found) { free(symbols); return xstrdup(name); }
        }
        free(symbols);
    }
    char *title = task_packet ? json_get_string(task_packet, "title") : NULL;
    return title ? title : xstrdup("task");
}

/* Which tests exercise this change? With a name, that symbol; without one,
 * every symbol defined in a file that differs from the last snapshot. */
int cmd_test_impact(Cg *cg, const char *name, bool json) {
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"covered\":[");
    else      sb_puts(&b, "tests touching this change:\n");
    int emitted = 0, uncovered = 0;
    StrBuf un; sb_init(&un);

    if (name) {
        if (tests_for_symbol(cg, name, &b, json, &emitted) == 0) {
            uncovered++;
            sb_printf(&un, "  %s\n", name);
        }
    } else {
        char **paths = NULL;
        int np = vcs_changed_paths(cg, NULL, &paths);
        for (int i = 0; i < np; i++) {
            if (graph_path_is_test(paths[i])) { free(paths[i]); continue; }
            sqlite3_stmt *st = cg_prep(cg,
                "SELECT s.name FROM symbols s JOIN files f ON f.id=s.file_id "
                "WHERE f.path=? ORDER BY s.line");
            sqlite3_bind_text(st, 1, paths[i], -1, SQLITE_STATIC);
            while (sqlite3_step(st) == SQLITE_ROW) {
                const char *sn = (const char *)sqlite3_column_text(st, 0);
                char keep[256];
                snprintf(keep, sizeof keep, "%s", sn);
                if (tests_for_symbol(cg, keep, &b, json, &emitted) == 0) {
                    uncovered++;
                    if (uncovered <= 20) sb_printf(&un, "  %s (%s)\n", keep,
                                                   paths[i]);
                }
            }
            sqlite3_finalize(st);
            free(paths[i]);
        }
        free(paths);
    }

    if (json) {
        sb_printf(&b, "],\"uncovered_count\":%d}\n", uncovered);
    } else {
        if (!emitted) sb_puts(&b, "  (none)\n");
        if (uncovered) {
            sb_printf(&b, "\nno test references (%d):\n", uncovered);
            sb_puts(&b, un.p);
        }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    sb_free(&un);
    return 0;
}

/* ---------------- why: provenance for a symbol ---------------- */

/* Codify already stores what the code is, what changed it, which task owned
 * that change, and what was decided along the way. `cg why` is the join:
 * symbol -> definition -> commits that touched its file -> spec tasks tagged
 * on those commits -> memories anchored to the symbol or those tasks. */
int cmd_why(Cg *cg, const char *name, bool json) {
    SymRow rows[4];
    int n = find_symbols(cg, name, rows, 4);
    if (n == 0) {
        if (json) printf("{\"symbol\":\"%s\",\"found\":false}\n", name);
        else fprintf(stderr, "cg: no symbol named '%s'\n", name);
        return 1;
    }
    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"symbol\":"); sb_json_str(&b, name);
        sb_puts(&b, ",\"definitions\":[");
        for (int i = 0; i < n; i++) { if (i) sb_putc(&b, ','); json_sym(&b, &rows[i]); }
        sb_puts(&b, "],\"commits\":[");
    } else {
        sb_printf(&b, "why %s\n", name);
        for (int i = 0; i < n; i++)
            sb_printf(&b, "  defined  %s %s — %s:%d\n", rows[i].kind,
                      rows[i].name, rows[i].path, rows[i].line);
    }

    /* history for the defining file, and the spec tasks those commits carry */
    char tasks[16][128];
    int ntask = 0, ncom = 0;
    for (int i = 0; i < n; i++) {
        char **ids = NULL, **msgs = NULL; long *dates = NULL;
        int nc = vcs_commits_for_path(cg, rows[i].path, 20, &ids, &msgs, &dates);
        for (int j = 0; j < nc; j++) {
            if (json) {
                if (ncom) sb_putc(&b, ',');
                sb_puts(&b, "{\"id\":");
                char sid[16]; snprintf(sid, sizeof sid, "%.12s", ids[j]);
                sb_json_str(&b, sid);
                sb_puts(&b, ",\"message\":"); sb_json_str(&b, msgs[j]);
                sb_printf(&b, ",\"date\":%ld}", dates[j]);
            } else if (ncom < 10) {
                sb_printf(&b, "  changed  %.12s  %s\n", ids[j], msgs[j]);
            }
            ncom++;
            const char *tag = strstr(msgs[j], "[spec:");
            if (tag && ntask < 16) {
                char buf[128];
                snprintf(buf, sizeof buf, "%s", tag + 6);
                char *end = strchr(buf, ']');
                if (end) *end = 0;
                bool dup = false;
                for (int k = 0; k < ntask; k++)
                    if (strcmp(tasks[k], buf) == 0) { dup = true; break; }
                if (!dup) snprintf(tasks[ntask++], 128, "%s", buf);
            }
            free(ids[j]); free(msgs[j]);
        }
        free(ids); free(msgs); free(dates);
    }

    if (json) sb_puts(&b, "],\"tasks\":[");
    else if (ntask) sb_puts(&b, "\n");
    for (int i = 0; i < ntask; i++) {
        if (json) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, tasks[i]);
        } else {
            sb_printf(&b, "  task     %s\n", tasks[i]);
        }
    }

    /* Memories anchored to the symbol, or written under one of those tasks.
     * The two queries overlap, so dedupe by id — the same decision reported
     * twice reads as two decisions. */
    if (json) sb_puts(&b, "],\"memories\":[");
    int nm_emitted = 0;
    long seen_ids[64];
    int nseen_id = 0;
    for (int pass = 0; pass <= ntask; pass++) {
        Memory *mem = NULL;
        int nm = pass == 0 ? memory_query(cg, name, NULL, NULL, 5, &mem)
                           : memory_query(cg, NULL, tasks[pass - 1], NULL, 5,
                                          &mem);
        for (int i = 0; i < nm; i++) {
            bool dup = false;
            for (int k = 0; k < nseen_id; k++)
                if (seen_ids[k] == mem[i].id) { dup = true; break; }
            if (dup) continue;
            if (nseen_id < 64) seen_ids[nseen_id++] = mem[i].id;
            if (json) {
                if (nm_emitted) sb_putc(&b, ',');
                memory_json(&mem[i], &b);
            } else {
                sb_printf(&b, "  memory   [%s] %s\n", mem[i].type,
                          mem[i].body);
            }
            nm_emitted++;
        }
        memory_free(mem, nm);
    }
    if (json) sb_puts(&b, "]}\n");
    else if (!ncom && !nm_emitted)
        sb_puts(&b, "  (no history or memories yet for this symbol)\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}
