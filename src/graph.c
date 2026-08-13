/*
 * Graph queries: full-text search, symbol lookup, impact analysis,
 * and `context` — the one-call answer for coding agents.
 * Every command has --json output.
 */
#include "cg.h"
#include <ctype.h>

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
static char *file_snippet(Cg *cg, const char *rel, int from, int to) {
    if (from < 1) from = 1;
    if (to < from) to = from;
    if (to - from > 40) to = from + 40;
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

typedef struct {
    long id;
    char name[256], kind[32], path[1024], sig[512];
    int line, end_line;
} SymRow;

static int sym_from_stmt(sqlite3_stmt *st, SymRow *r) {
    r->id = sqlite3_column_int64(st, 0);
    snprintf(r->name, sizeof r->name, "%s", (const char *)sqlite3_column_text(st, 1));
    const char *k = (const char *)sqlite3_column_text(st, 2);
    snprintf(r->kind, sizeof r->kind, "%s", k ? k : "");
    snprintf(r->path, sizeof r->path, "%s", (const char *)sqlite3_column_text(st, 3));
    r->line = sqlite3_column_int(st, 4);
    r->end_line = sqlite3_column_int(st, 5);
    const char *s = (const char *)sqlite3_column_text(st, 6);
    snprintf(r->sig, sizeof r->sig, "%s", s ? s : "");
    return 0;
}

#define SYM_COLS "s.id,s.name,s.kind,f.path,s.line,s.end_line,s.sig"

/* find symbols matching a name: exact first, then trigram/LIKE */
static int find_symbols(Cg *cg, const char *q, SymRow *out, int cap) {
    int n = 0;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT " SYM_COLS " FROM symbols s JOIN files f ON f.id=s.file_id "
        "WHERE s.name=? ORDER BY f.path,s.line LIMIT ?");
    sqlite3_bind_text(st, 1, q, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 2, cap);
    while (n < cap && sqlite3_step(st) == SQLITE_ROW)
        sym_from_stmt(st, &out[n++]);
    sqlite3_finalize(st);
    if (n > 0) return n;

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

/* callers of a symbol NAME: enclosing symbols of refs to it */
static int callers_of(Cg *cg, const char *name, SymRow *out, int cap) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT DISTINCT " SYM_COLS
        " FROM refs r JOIN symbols s ON s.id=r.sym_id "
        "JOIN files f ON f.id=s.file_id "
        "WHERE r.name=? AND s.name<>? LIMIT ?");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_STATIC);
    sqlite3_bind_text(st, 2, name, -1, SQLITE_STATIC);
    sqlite3_bind_int(st, 3, cap);
    int n = 0;
    while (n < cap && sqlite3_step(st) == SQLITE_ROW)
        sym_from_stmt(st, &out[n++]);
    sqlite3_finalize(st);
    return n;
}

/* callees: names referenced inside symbol id that resolve to definitions */
static int callees_of(Cg *cg, long sym_id, SymRow *out, int cap) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT DISTINCT " SYM_COLS
        " FROM refs r JOIN symbols s ON s.name=r.name "
        "JOIN files f ON f.id=s.file_id "
        "WHERE r.sym_id=? AND s.id<>r.sym_id "
        "GROUP BY s.name HAVING s.id=MIN(s.id) LIMIT ?");
    sqlite3_bind_int64(st, 1, sym_id);
    sqlite3_bind_int(st, 2, cap);
    int n = 0;
    while (n < cap && sqlite3_step(st) == SQLITE_ROW)
        sym_from_stmt(st, &out[n++]);
    sqlite3_finalize(st);
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

static void json_sym(StrBuf *b, const SymRow *r) {
    sb_puts(b, "{\"name\":");   sb_json_str(b, r->name);
    sb_puts(b, ",\"kind\":");   sb_json_str(b, r->kind);
    sb_puts(b, ",\"path\":");   sb_json_str(b, r->path);
    sb_printf(b, ",\"line\":%d,\"end_line\":%d,\"sig\":", r->line, r->end_line);
    sb_json_str(b, r->sig);
    sb_putc(b, '}');
}

/* ---------------- search ---------------- */

int cmd_search(Cg *cg, const char *q, int limit, bool json) {
    SymRow *rows = xmalloc(sizeof(SymRow) * (size_t)limit);
    int n = find_symbols(cg, q, rows, limit);

    /* body full-text hits */
    char *fw = fts_words(q);
    StrBuf files; sb_init(&files);
    int nf = 0;
    if (fw) {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT f.path, snippet(body_fts,1,'>>','<<','…',10) "
            "FROM body_fts JOIN files f ON f.id=body_fts.rowid "
            "WHERE body_fts MATCH ? ORDER BY rank LIMIT 8");
        sqlite3_bind_text(st, 1, fw, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *path = (const char *)sqlite3_column_text(st, 0);
            const char *snip = (const char *)sqlite3_column_text(st, 1);
            if (json) {
                if (nf) sb_putc(&files, ',');
                sb_puts(&files, "{\"path\":");
                sb_json_str(&files, path);
                sb_puts(&files, ",\"excerpt\":");
                sb_json_str(&files, snip ? snip : "");
                sb_putc(&files, '}');
            } else {
                sb_printf(&files, "  %s\n", path);
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
        char *snip = file_snippet(cg, r->path, r->line,
                                  r->end_line > r->line + 11 ? r->line + 11
                                                             : r->end_line);
        if (json) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"name\":"); sb_json_str(&b, r->name);
            sb_puts(&b, ",\"kind\":"); sb_json_str(&b, r->kind);
            sb_puts(&b, ",\"path\":"); sb_json_str(&b, r->path);
            sb_printf(&b, ",\"line\":%d,\"end_line\":%d,\"references\":%d,"
                          "\"snippet\":", r->line, r->end_line, refs);
            sb_json_str(&b, snip ? snip : "");
            sb_putc(&b, '}');
        } else {
            sb_printf(&b, "%s %s — %s:%d (referenced %d×)\n",
                      r->kind, r->name, r->path, r->line, refs);
            if (snip) { sb_puts(&b, snip); sb_putc(&b, '\n'); }
        }
        free(snip);
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
static int impact_bfs(Cg *cg, const char *root_name, long root_id,
                      int depth, bool up, INode *out) {
    int n = 0, qhead = 0;
    INode *q = xmalloc(sizeof(INode) * IMPACT_CAP);
    snprintf(q[0].name, sizeof q[0].name, "%s", root_name);
    q[0].depth = 0;
    q[0].loc.id = root_id;
    int qn = 1;
    while (qhead < qn && n < IMPACT_CAP) {
        INode cur = q[qhead++];
        if (cur.depth >= depth) continue;
        SymRow nb[32];
        int k;
        if (up) k = callers_of(cg, cur.name, nb, 32);
        else    k = callees_of(cg, cur.loc.id, nb, 32);
        for (int i = 0; i < k && n < IMPACT_CAP; i++) {
            if (strcmp(nb[i].name, root_name) == 0) continue;
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

int cmd_impact(Cg *cg, const char *name, int depth, bool json) {
    SymRow rows[4];
    int nr = find_symbols(cg, name, rows, 4);
    if (nr == 0) {
        if (json) printf("{\"symbol\":null}\n");
        else fprintf(stderr, "cg: symbol '%s' not found\n", name);
        return 1;
    }
    INode *up = xmalloc(sizeof(INode) * IMPACT_CAP);
    INode *dn = xmalloc(sizeof(INode) * IMPACT_CAP);
    int nu = impact_bfs(cg, rows[0].name, rows[0].id, depth, true, up);
    int nd = impact_bfs(cg, rows[0].name, rows[0].id, depth, false, dn);

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"symbol\":");
        json_sym(&b, &rows[0]);
        sb_printf(&b, ",\"depth\":%d,\"callers\":[", depth);
        for (int i = 0; i < nu; i++) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"symbol\":"); json_sym(&b, &up[i].loc);
            sb_printf(&b, ",\"depth\":%d,\"via\":", up[i].depth);
            sb_json_str(&b, up[i].via);
            sb_putc(&b, '}');
        }
        sb_puts(&b, "],\"callees\":[");
        for (int i = 0; i < nd; i++) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"symbol\":"); json_sym(&b, &dn[i].loc);
            sb_printf(&b, ",\"depth\":%d,\"via\":", dn[i].depth);
            sb_json_str(&b, dn[i].via);
            sb_putc(&b, '}');
        }
        sb_puts(&b, "]}\n");
    } else {
        sb_printf(&b, "%s %s — %s:%d\n\n", rows[0].kind, rows[0].name,
                  rows[0].path, rows[0].line);
        sb_printf(&b, "impact radius (callers, depth ≤ %d): %d symbol%s\n",
                  depth, nu, nu == 1 ? "" : "s");
        for (int d = 1; d <= depth; d++)
            for (int i = 0; i < nu; i++)
                if (up[i].depth == d)
                    sb_printf(&b, "  %*s%-28s %s:%d  (via %s)\n", d * 2, "",
                              up[i].name, up[i].loc.path, up[i].loc.line,
                              up[i].via);
        sb_printf(&b, "\ndepends on (callees, depth ≤ %d): %d symbol%s\n",
                  depth, nd, nd == 1 ? "" : "s");
        for (int d = 1; d <= depth; d++)
            for (int i = 0; i < nd; i++)
                if (dn[i].depth == d)
                    sb_printf(&b, "  %*s%-28s %s:%d\n", d * 2, "",
                              dn[i].name, dn[i].loc.path, dn[i].loc.line);
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

/* ---------------- context: the one-call agent answer ---------------- */

int cmd_context(Cg *cg, const char *q, bool json) {
    SymRow rows[8];
    int n = find_symbols(cg, q, rows, 8);

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"query\":");
        sb_json_str(&b, q);
        sb_puts(&b, ",\"symbols\":[");
    } else {
        sb_printf(&b, "context for '%s'\n", q);
    }

    for (int i = 0; i < n; i++) {
        SymRow *r = &rows[i];
        bool detail = i < 3;      /* top hits get snippets + graph edges */
        char *snip = detail ? file_snippet(cg, r->path, r->line,
                        r->end_line > r->line + 11 ? r->line + 11 : r->end_line)
                            : NULL;
        SymRow cal[8], cee[8];
        int ncal = detail ? callers_of(cg, r->name, cal, 8) : 0;
        int ncee = detail ? callees_of(cg, r->id, cee, 8) : 0;

        if (json) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"name\":"); sb_json_str(&b, r->name);
            sb_puts(&b, ",\"kind\":"); sb_json_str(&b, r->kind);
            sb_puts(&b, ",\"path\":"); sb_json_str(&b, r->path);
            sb_printf(&b, ",\"line\":%d,\"end_line\":%d,\"sig\":",
                      r->line, r->end_line);
            sb_json_str(&b, r->sig);
            if (snip) {
                sb_puts(&b, ",\"snippet\":");
                sb_json_str(&b, snip);
            }
            sb_puts(&b, ",\"callers\":[");
            for (int j = 0; j < ncal; j++) {
                if (j) sb_putc(&b, ',');
                json_sym(&b, &cal[j]);
            }
            sb_puts(&b, "],\"callees\":[");
            for (int j = 0; j < ncee; j++) {
                if (j) sb_putc(&b, ',');
                json_sym(&b, &cee[j]);
            }
            sb_puts(&b, "]}");
        } else {
            sb_printf(&b, "\n● %s %s — %s:%d\n", r->kind, r->name,
                      r->path, r->line);
            if (snip) sb_puts(&b, snip);
            if (ncal) {
                sb_puts(&b, "  callers:");
                for (int j = 0; j < ncal; j++)
                    sb_printf(&b, " %s(%s:%d)", cal[j].name, cal[j].path,
                              cal[j].line);
                sb_putc(&b, '\n');
            }
            if (ncee) {
                sb_puts(&b, "  calls:");
                for (int j = 0; j < ncee; j++)
                    sb_printf(&b, " %s", cee[j].name);
                sb_putc(&b, '\n');
            }
        }
        free(snip);
    }

    /* entry points: main()s and routes touching the query */
    if (json) sb_puts(&b, "],\"entry_points\":[");
    else sb_puts(&b, "\nentry points:\n");
    int ne = 0;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT " SYM_COLS " FROM symbols s JOIN files f ON f.id=s.file_id "
        "WHERE s.name IN ('main','Main','__main__') LIMIT 5");
    while (sqlite3_step(st) == SQLITE_ROW) {
        SymRow r; sym_from_stmt(st, &r);
        if (json) {
            if (ne) sb_putc(&b, ',');
            json_sym(&b, &r);
        } else {
            sb_printf(&b, "  %s %s — %s:%d\n", r.kind, r.name, r.path, r.line);
        }
        ne++;
    }
    sqlite3_finalize(st);

    char like[300];
    snprintf(like, sizeof like, "%%%s%%", q);
    st = cg_prep(cg,
        "SELECT r.framework,r.method,r.pattern,r.handler,f.path,r.line "
        "FROM routes r JOIN files f ON f.id=r.file_id "
        "WHERE r.pattern LIKE ?1 OR ifnull(r.handler,'') LIKE ?1 LIMIT 10");
    sqlite3_bind_text(st, 1, like, -1, SQLITE_TRANSIENT);
    if (json) sb_puts(&b, "],\"routes\":[");
    int nrt = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *fw = (const char *)sqlite3_column_text(st, 0);
        const char *me = (const char *)sqlite3_column_text(st, 1);
        const char *pa = (const char *)sqlite3_column_text(st, 2);
        const char *ha = (const char *)sqlite3_column_text(st, 3);
        const char *pt = (const char *)sqlite3_column_text(st, 4);
        int line = sqlite3_column_int(st, 5);
        if (json) {
            if (nrt) sb_putc(&b, ',');
            sb_puts(&b, "{\"framework\":"); sb_json_str(&b, fw);
            sb_puts(&b, ",\"method\":");    sb_json_str(&b, me);
            sb_puts(&b, ",\"pattern\":");   sb_json_str(&b, pa);
            sb_puts(&b, ",\"handler\":");
            if (ha) sb_json_str(&b, ha); else sb_puts(&b, "null");
            sb_puts(&b, ",\"path\":");      sb_json_str(&b, pt);
            sb_printf(&b, ",\"line\":%d}", line);
        } else {
            sb_printf(&b, "  route %s %s — %s:%d\n", me, pa, pt, line);
        }
        nrt++;
    }
    sqlite3_finalize(st);

    /* file-level full-text hits for non-symbol terms */
    if (json) sb_puts(&b, "],\"files\":[");
    char *fw2 = fts_words(q);
    int nfl = 0;
    if (fw2) {
        st = cg_prep(cg,
            "SELECT f.path, snippet(body_fts,1,'>>','<<','…',10) "
            "FROM body_fts JOIN files f ON f.id=body_fts.rowid "
            "WHERE body_fts MATCH ? ORDER BY rank LIMIT 5");
        sqlite3_bind_text(st, 1, fw2, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *path = (const char *)sqlite3_column_text(st, 0);
            const char *sn = (const char *)sqlite3_column_text(st, 1);
            if (json) {
                if (nfl) sb_putc(&b, ',');
                sb_puts(&b, "{\"path\":");
                sb_json_str(&b, path);
                sb_puts(&b, ",\"excerpt\":");
                sb_json_str(&b, sn ? sn : "");
                sb_putc(&b, '}');
            } else if (nfl == 0 && n == 0) {
                sb_printf(&b, "  text match: %s\n", path);
            }
            nfl++;
        }
        sqlite3_finalize(st);
        free(fw2);
    }
    if (json) sb_puts(&b, "]}\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}
