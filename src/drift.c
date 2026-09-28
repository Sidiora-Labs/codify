/* Drift: where work parts from what was declared, found before it merges.
 *
 * Spec drift compares a task's actual change — the git diff of its work —
 * with what the task declared: paths changed outside its touches, and
 * public symbols whose lines changed that are not among its symbols. It
 * runs at `cg spec done` and at `cg fleet merge-up`, and it warns; only a
 * workflow that lists "drift" in a role's approve makes a merge-up wait
 * for a person.
 *
 * Collision prediction asks, before two tasks run at once, whether they
 * will step on each other: overlapping touch globs, or declared symbols
 * that are the same or directly call one another in the graph. The
 * supervisor runs predicted collisions one after the other. */
#include "cg.h"
#include <ctype.h>
#include <fnmatch.h>

typedef struct { int from, to; } Hunk;
typedef struct { char *path; Hunk *h; int nh, ch; } FileDiff;

static void list_free(char **v, int n) {
    for (int i = 0; i < n; i++) free(v[i]);
    free(v);
}

static int packet_strings(const char *packet, const char *key, char ***out) {
    *out = NULL;
    char *raw = packet ? json_get_raw(packet, key) : NULL;
    char **items = NULL;
    int n = raw ? json_array_items(raw, &items) : 0;
    free(raw);
    for (int i = 0; i < n; i++) {
        char *v = json_string_value(items[i]);
        free(items[i]);
        items[i] = v ? v : xstrdup("");
    }
    *out = items;
    return n;
}

static FileDiff *fd_get(FileDiff **v, int *n, int *cap, const char *path) {
    for (int i = 0; i < *n; i++) if (!strcmp((*v)[i].path, path)) return &(*v)[i];
    if (*n == *cap) {
        *cap = *cap ? *cap * 2 : 16;
        *v = xrealloc(*v, sizeof(FileDiff) * (size_t)*cap);
    }
    FileDiff *f = &(*v)[(*n)++];
    memset(f, 0, sizeof *f);
    f->path = xstrdup(path);
    return f;
}

static void fd_hunk(FileDiff *f, int from, int to) {
    if (f->nh == f->ch) {
        f->ch = f->ch ? f->ch * 2 : 8;
        f->h = xrealloc(f->h, sizeof(Hunk) * (size_t)f->ch);
    }
    f->h[f->nh].from = from;
    f->h[f->nh].to = to;
    f->nh++;
}

/* The change as git sees it: head NULL diffs base against the working
 * tree (so uncommitted and untracked work counts), else base...head. */
static int drift_diff(const char *tree, const char *base, const char *head,
                      FileDiff **out) {
    *out = NULL;
    int n = 0, cap = 0;
    StrBuf c; sb_init(&c);
    sb_puts(&c, "git -C ");
    sb_shquote(&c, tree);
    sb_puts(&c, " diff -U0 --no-color --no-ext-diff ");
    if (head) {
        StrBuf r; sb_init(&r);
        sb_printf(&r, "%s...%s", base, head);
        sb_shquote(&c, r.p);
        sb_free(&r);
    } else {
        sb_shquote(&c, base);
    }
    sb_puts(&c, " 2>/dev/null");
    FILE *f = popen(c.p, "r");
    sb_free(&c);
    FileDiff *cur = NULL;
    FileDiff *v = NULL;
    if (f) {
        char line[8192];
        while (fgets(line, sizeof line, f)) {
            if (!strncmp(line, "+++ ", 4)) {
                char *p = line + 4;
                p[strcspn(p, "\r\n")] = 0;
                if (!strcmp(p, "/dev/null")) { cur = NULL; continue; }
                if (!strncmp(p, "b/", 2)) p += 2;
                cur = fd_get(&v, &n, &cap, p);
            } else if (!strncmp(line, "--- a/", 6)) {
                /* a deletion names its file only on the --- line */
                char *p = line + 6;
                p[strcspn(p, "\r\n")] = 0;
                fd_get(&v, &n, &cap, p);
            } else if (!strncmp(line, "@@ ", 3) && cur) {
                char *plus = strchr(line + 3, '+');
                if (!plus) continue;
                int start = atoi(plus + 1), len = 1;
                char *comma = strchr(plus, ',');
                char *space = strchr(plus, ' ');
                if (comma && (!space || comma < space)) len = atoi(comma + 1);
                fd_hunk(cur, start, len > 0 ? start + len - 1 : start);
            }
        }
        pclose(f);
    }
    if (!head) {
        StrBuf u; sb_init(&u);
        sb_puts(&u, "git -C ");
        sb_shquote(&u, tree);
        sb_puts(&u, " ls-files --others --exclude-standard 2>/dev/null");
        FILE *g = popen(u.p, "r");
        sb_free(&u);
        if (g) {
            char line[4096];
            while (fgets(line, sizeof line, g)) {
                line[strcspn(line, "\r\n")] = 0;
                if (line[0]) fd_hunk(fd_get(&v, &n, &cap, line), 1, 1 << 30);
            }
            pclose(g);
        }
    }
    *out = v;
    return n;
}

/* Codify's own bookkeeping moves with every task and is nobody's drift */
static bool drift_exempt(const char *path) {
    return !strncmp(path, "spec/", 5) || !strcmp(path, "AGENTS.md") ||
           !strcmp(path, "CLAUDE.md") || !strncmp(path, ".codify/", 8) ||
           !strncmp(path, ".codegraph/", 11) || !strcmp(path, ".gitignore");
}

static bool drift_in_touches(const char *path, char **touches, int nt) {
    for (int i = 0; i < nt; i++)
        if (!strcmp(path, touches[i]) || fnmatch(touches[i], path, 0) == 0)
            return true;
    return false;
}

/* Public by the languages' own conventions: C static, a leading
 * underscore, an unexported JS/TS function, a lowercase Go name are not. */
static bool drift_public(const char *path, const char *name, const char *kind,
                         const char *sig) {
    static const char *KINDS[] = { "function", "method", "class", "struct",
                                   "typedef", "type", "interface", "enum",
                                   "trait", "impl", NULL };
    bool k = false;
    for (int i = 0; KINDS[i] && !k; i++) k = !strcmp(kind, KINDS[i]);
    if (!k || name[0] == '_') return false;
    const char *dot = strrchr(path, '.');
    if (sig && (!strncmp(sig, "static ", 7) || strstr(sig, " static ")))
        return false;
    if (dot && (!strcmp(dot, ".ts") || !strcmp(dot, ".js") ||
                !strcmp(dot, ".tsx") || !strcmp(dot, ".jsx") ||
                !strcmp(dot, ".mjs")))
        return sig && strstr(sig, "export");
    if (dot && !strcmp(dot, ".go")) return isupper((unsigned char)name[0]);
    return true;
}

int drift_spec_check(Cg *cg, const char *tree, const char *base,
                     const char *head, const char *tag, const char *branch,
                     bool emit, StrBuf *out) {
    char *pk = spec_task_packet(tag);
    if (!pk) return 0;
    char **syms = NULL, **touches = NULL;
    int ns = packet_strings(pk, "symbols", &syms);
    int nt = packet_strings(pk, "touches", &touches);
    free(pk);
    FileDiff *fd = NULL;
    int nf = drift_diff(tree, base, head, &fd);
    long saved = cg->scope_branch;
    if (branch && branch[0]) cg_scope_set(cg, branch, false);
    char scope[64];
    branch_scope_sql(cg, "f", scope, sizeof scope);
    char sql[640];
    snprintf(sql, sizeof sql,
             "SELECT s.name,ifnull(s.kind,''),s.line,ifnull(s.end_line,s.line),"
             "ifnull(s.sig,'') FROM symbols s JOIN files f ON f.id=s.file_id "
             "WHERE f.path=?%s", scope);
    StrBuf files, symbols; sb_init(&files); sb_init(&symbols);
    int nfo = 0, nsu = 0;
    char **seen = NULL;
    int nseen = 0, cseen = 0;
    for (int i = 0; i < nf; i++) {
        FileDiff *f = &fd[i];
        if (drift_exempt(f->path)) continue;
        if (nt && !drift_in_touches(f->path, touches, nt)) {
            sb_printf(&files, "%s", nfo++ ? "," : "");
            sb_json_str(&files, f->path);
        }
        sqlite3_stmt *st = cg_prep(cg, sql);
        sqlite3_bind_text(st, 1, f->path, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *name = (const char *)sqlite3_column_text(st, 0);
            const char *kind = (const char *)sqlite3_column_text(st, 1);
            int from = sqlite3_column_int(st, 2), to = sqlite3_column_int(st, 3);
            const char *sig = (const char *)sqlite3_column_text(st, 4);
            bool hit = false;
            for (int h = 0; h < f->nh && !hit; h++)
                hit = f->h[h].from <= to && f->h[h].to >= from;
            if (!hit || !drift_public(f->path, name, kind, sig)) continue;
            bool declared = false;
            for (int k = 0; k < ns && !declared; k++) declared = !strcmp(syms[k], name);
            for (int k = 0; k < nseen && !declared; k++) declared = !strcmp(seen[k], name);
            if (declared) continue;
            if (nseen == cseen) { cseen = cseen ? cseen * 2 : 16; seen = xrealloc(seen, sizeof(char *) * (size_t)cseen); }
            seen[nseen++] = xstrdup(name);
            sb_printf(&symbols, "%s{\"name\":", nsu++ ? "," : "");
            sb_json_str(&symbols, name);
            sb_puts(&symbols, ",\"path\":"); sb_json_str(&symbols, f->path);
            sb_printf(&symbols, ",\"line\":%d}", from);
        }
        sqlite3_finalize(st);
    }
    cg->scope_branch = saved;
    int findings = nfo + nsu;
    if (out) {
        sb_puts(out, "{\"task\":"); sb_json_str(out, tag);
        sb_printf(out, ",\"files_outside\":[%s],\"symbols_undeclared\":[%s],"
                  "\"findings\":%d}", files.p, symbols.p, findings);
    }
    if (emit && findings) {
        StrBuf p; sb_init(&p);
        sb_puts(&p, "{\"task\":"); sb_json_str(&p, tag);
        sb_puts(&p, ",\"base\":"); sb_json_str(&p, base);
        sb_puts(&p, ",\"head\":");
        if (head) sb_json_str(&p, head); else sb_puts(&p, "null");
        sb_printf(&p, ",\"files_outside\":[%s],\"symbols_undeclared\":[%s]}",
                  files.p, symbols.p);
        events_emit(cg, "drift.spec", tag, p.p);
        sb_free(&p);
    }
    sb_free(&files); sb_free(&symbols);
    list_free(seen, nseen);
    for (int i = 0; i < nf; i++) { free(fd[i].path); free(fd[i].h); }
    free(fd);
    list_free(syms, ns); list_free(touches, nt);
    return findings;
}

/* the report as a reader wants it, on stderr: advice, never an error */
void drift_print(const char *report_json) {
    char *files = json_get_raw(report_json, "files_outside");
    char *syms = json_get_raw(report_json, "symbols_undeclared");
    char **fi = NULL, **si = NULL;
    int nf = files ? json_array_items(files, &fi) : 0;
    int ns = syms ? json_array_items(syms, &si) : 0;
    if (nf) {
        fprintf(stderr, "drift: %d path(s) changed outside the task's touches:", nf);
        for (int i = 0; i < nf; i++) {
            char *v = json_string_value(fi[i]);
            fprintf(stderr, " %s", v ? v : "?");
            free(v);
        }
        fputc('\n', stderr);
    }
    if (ns) {
        fprintf(stderr, "drift: %d public symbol(s) changed but not declared:", ns);
        for (int i = 0; i < ns; i++) {
            char *n = json_get_string(si[i], "name");
            char *p = json_get_string(si[i], "path");
            fprintf(stderr, " %s (%s)", n ? n : "?", p ? p : "?");
            free(n); free(p);
        }
        fputc('\n', stderr);
    }
    if (nf || ns)
        fprintf(stderr, "drift: declare them in the task (touches/symbols) or "
                "keep the change inside its scope\n");
    list_free(fi, nf); list_free(si, ns);
    free(files); free(syms);
}

bool drift_collision_predict(Cg *cg, const char *feature, const char *a,
                             const char *b, char *why, size_t cap) {
    char ta[400], tb[400];
    snprintf(ta, sizeof ta, "%s/%s", feature, a);
    snprintf(tb, sizeof tb, "%s/%s", feature, b);
    char *pa = spec_task_packet(ta), *pb = spec_task_packet(tb);
    char **touch_a = NULL, **touch_b = NULL, **sym_a = NULL, **sym_b = NULL;
    int nta = packet_strings(pa, "touches", &touch_a);
    int ntb = packet_strings(pb, "touches", &touch_b);
    int nsa = packet_strings(pa, "symbols", &sym_a);
    int nsb = packet_strings(pb, "symbols", &sym_b);
    free(pa); free(pb);
    bool hit = false;
    for (int i = 0; i < nta && !hit; i++)
        for (int j = 0; j < ntb && !hit; j++)
            if (spec_globs_overlap(touch_a[i], touch_b[j])) {
                snprintf(why, cap, "both touch %s / %s", touch_a[i], touch_b[j]);
                hit = true;
            }
    for (int i = 0; i < nsa && !hit; i++) {
        for (int j = 0; j < nsb && !hit; j++)
            if (!strcmp(sym_a[i], sym_b[j])) {
                snprintf(why, cap, "both change %s", sym_a[i]);
                hit = true;
            }
        if (hit) break;
        char **nb = NULL;
        int nn = graph_neighbors(cg, sym_a[i], &nb);
        for (int k = 0; k < nn && !hit; k++)
            for (int j = 0; j < nsb && !hit; j++)
                if (!strcmp(nb[k], sym_b[j])) {
                    snprintf(why, cap, "%s and %s call one another", sym_a[i],
                             sym_b[j]);
                    hit = true;
                }
        list_free(nb, nn);
    }
    list_free(touch_a, nta); list_free(touch_b, ntb);
    list_free(sym_a, nsa); list_free(sym_b, nsb);
    return hit;
}

static char *drift_active_feature(Cg *cg) {
    char path[4700];
    snprintf(path, sizeof path, "%s/spec/workflow.kvx", cg->shared);
    Kvx *k = kvx_parse(path);
    char *f = k ? kvx_str(k, "meta", "active_feature") : NULL;
    kvx_free(k);
    return f;
}

/* the feature's leaf tasks not yet done, in plan order */
static int drift_open_tasks(Cg *cg, const char *feature, char ***out) {
    *out = NULL;
    char path[4700];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", cg->shared, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return 0;
    char **ids = NULL;
    int n = kvx_subsections(k, "task", &ids), m = 0;
    kvx_sort_dotted(ids, n);
    for (int i = 0; i < n; i++) {
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", ids[i]);
        char *st = kvx_str(k, sec, "status");
        bool open = kvx_long(k, sec, "wave", -1) >= 0 && !(st && !strcmp(st, "done"));
        free(st);
        if (open) ids[m++] = ids[i]; else free(ids[i]);
    }
    kvx_free(k);
    *out = ids;
    return m;
}

/* cg drift check <id> | collisions [-f F] */
int cmd_drift(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc >= 1 ? argv[0] : "collisions";
    if (!strcmp(sub, "check")) {
        if (argc < 2) {
            fprintf(stderr, "usage: cg drift check <id> [--base REF]\n");
            return 1;
        }
        const char *base = getenv("CG_BASE");
        for (int i = 2; i + 1 < argc; i++)
            if (!strcmp(argv[i], "--base")) base = argv[i + 1];
        if (!base || !base[0]) base = "HEAD";
        char *tag = spec_resolve_task(argv[1], NULL);
        if (!tag) { fprintf(stderr, "cg drift: unknown task %s\n", argv[1]); return 1; }
        StrBuf r; sb_init(&r);
        int n = drift_spec_check(cg, cg->root, base, NULL, tag, NULL, false, &r);
        if (json) printf("%s\n", r.p);
        else if (!n) printf("no drift: %s stays inside its declared scope\n", tag);
        else { drift_print(r.p); }
        sb_free(&r);
        free(tag);
        return 0;
    }
    if (!strcmp(sub, "collisions")) {
        const char *feature = NULL;
        for (int i = 1; i + 1 < argc; i++) if (!strcmp(argv[i], "-f")) feature = argv[i + 1];
        char *active = feature ? NULL : drift_active_feature(cg);
        if (!feature) feature = active;
        if (!feature) { fprintf(stderr, "cg drift: no active feature\n"); return 1; }
        char **ids = NULL;
        int n = drift_open_tasks(cg, feature, &ids);
        StrBuf b; sb_init(&b);
        if (json) sb_puts(&b, "{\"feature\":"), sb_json_str(&b, feature), sb_puts(&b, ",\"collisions\":[");
        int k = 0;
        for (int i = 0; i < n; i++)
            for (int j = i + 1; j < n; j++) {
                char why[300];
                if (!drift_collision_predict(cg, feature, ids[i], ids[j], why, sizeof why))
                    continue;
                if (json) {
                    if (k) sb_putc(&b, ',');
                    sb_puts(&b, "{\"a\":"); sb_json_str(&b, ids[i]);
                    sb_puts(&b, ",\"b\":"); sb_json_str(&b, ids[j]);
                    sb_puts(&b, ",\"why\":"); sb_json_str(&b, why);
                    sb_putc(&b, '}');
                } else {
                    sb_printf(&b, "%-8s %-8s %s\n", ids[i], ids[j], why);
                }
                k++;
            }
        if (json) sb_puts(&b, "]}\n");
        else if (!k) sb_printf(&b, "no predicted collisions among the open tasks of %s\n", feature);
        fputs(b.p, stdout);
        sb_free(&b);
        list_free(ids, n);
        free(active);
        return 0;
    }
    if (!strcmp(sub, "coverage")) {
        const char *feature = NULL;
        for (int i = 1; i + 1 < argc; i++) if (!strcmp(argv[i], "-f")) feature = argv[i + 1];
        char *active = feature ? NULL : drift_active_feature(cg);
        if (!feature) feature = active;
        if (!feature) { fprintf(stderr, "cg drift: no active feature\n"); return 1; }
        StrBuf r; sb_init(&r);
        int nu = coverage_check(cg, feature, &r);
        if (nu < 0) { fprintf(stderr, "cg drift: no spec for %s\n", feature); free(active); return 1; }
        if (json) printf("{\"feature\":\"%s\",\"uncovered\":%s}\n", feature, r.p);
        else if (!nu) printf("coverage: every acceptance criterion of %s has a qualified task\n", feature);
        else coverage_print(r.p, feature);
        sb_free(&r);
        free(active);
        return 0;
    }
    if (!strcmp(sub, "summary")) {
        const char *feature = NULL;
        for (int i = 1; i + 1 < argc; i++) if (!strcmp(argv[i], "-f")) feature = argv[i + 1];
        char *active = feature ? NULL : drift_active_feature(cg);
        if (!feature) feature = active;
        if (!feature) { fprintf(stderr, "cg drift: no active feature\n"); return 1; }
        StrBuf t, j; sb_init(&t); sb_init(&j);
        int n = drift_summary(cg, feature, &t, &j);
        if (json) printf("%s\n", j.p);
        else if (!n) printf("no drift recorded for %s\n", feature);
        else { printf("drift for %s:\n%s", feature, t.p); }
        sb_free(&t); sb_free(&j);
        free(active);
        return 0;
    }
    fprintf(stderr, "usage: cg drift check <id> [--base REF] | collisions [-f F] "
                    "| coverage [-f F] | summary [-f F]\n");
    return 1;
}

/* ---------------- interface drift across branches ---------------- */

/* the file at a commit, parsed: definitions by name with their signature */
static int blob_defs(const char *tree, const char *rev, const char *path,
                     ParseResult *pr) {
    memset(pr, 0, sizeof *pr);
    StrBuf c; sb_init(&c);
    sb_puts(&c, "git -C ");
    sb_shquote(&c, tree);
    sb_puts(&c, " show ");
    StrBuf spec; sb_init(&spec);
    sb_printf(&spec, "%s:%s", rev, path);
    sb_shquote(&c, spec.p);
    sb_free(&spec);
    sb_puts(&c, " 2>/dev/null");
    FILE *f = popen(c.p, "r");
    sb_free(&c);
    if (!f) return -1;
    StrBuf src; sb_init(&src);
    char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0)
        for (size_t i = 0; i < n; i++) sb_putc(&src, buf[i]);
    int rc = pclose(f);
    if (rc != 0) { sb_free(&src); return -1; }      /* absent at that rev */
    lang_global_init();            /* the parser's regexes, compiled once */
    routes_global_init();
    lang_parse(NULL, path, src.p, src.len, pr);
    sb_free(&src);
    return 0;
}

static const SymDef *def_named(const ParseResult *pr, const char *name) {
    for (int i = 0; i < pr->ndefs; i++)
        if (!strcmp(pr->defs[i].name, name)) return &pr->defs[i];
    return NULL;
}

/* Where other live branches reference name: the unified graph holds every
 * branch's rows, so a worker's branch answers even while it is checked out
 * elsewhere. Returns the sites as a JSON array and the agents on those
 * branches (with their parents) as a JSON array of {agent,parent,branch}. */
static int drift_ref_sites(Cg *cg, const char *name, long skip_branch,
                           StrBuf *sites, StrBuf *agents) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT b.name,f.path,r.line,(SELECT a.agent||'|'||ifnull(a.parent,'') "
        "FROM attempts a WHERE a.branch=b.name AND a.state='running' AND "
        "a.expires>strftime('%s','now') LIMIT 1) "
        "FROM refs r JOIN files f ON f.id=r.file_id JOIN branches b ON "
        "b.id=f.branch_id WHERE r.name=? AND f.branch_id<>? AND EXISTS("
        "SELECT 1 FROM attempts a WHERE a.branch=b.name AND a.state='running' "
        "AND a.expires>strftime('%s','now')) ORDER BY b.name,f.path,r.line "
        "LIMIT 40");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 2, skip_branch);
    int n = 0, na = 0;
    char seen[16][300];
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *br = (const char *)sqlite3_column_text(st, 0);
        const char *ag = (const char *)sqlite3_column_text(st, 3);
        if (n++) sb_putc(sites, ',');
        sb_puts(sites, "{\"branch\":"); sb_json_str(sites, br);
        sb_puts(sites, ",\"path\":"); sb_json_str(sites, (const char *)sqlite3_column_text(st, 1));
        sb_printf(sites, ",\"line\":%d}", sqlite3_column_int(st, 2));
        if (!ag) continue;
        bool dup = false;
        for (int i = 0; i < na && !dup; i++) dup = !strcmp(seen[i], ag);
        if (dup || na >= 16) continue;
        snprintf(seen[na++], sizeof seen[0], "%s", ag);
        const char *bar = strchr(ag, '|');
        if (na > 1) sb_putc(agents, ',');
        sb_puts(agents, "{\"agent\":");
        char a[128];
        snprintf(a, sizeof a, "%.*s", bar ? (int)(bar - ag) : (int)strlen(ag), ag);
        sb_json_str(agents, a);
        sb_puts(agents, ",\"parent\":");
        if (bar && bar[1]) sb_json_str(agents, bar + 1); else sb_puts(agents, "null");
        sb_puts(agents, ",\"branch\":"); sb_json_str(agents, br);
        sb_putc(agents, '}');
    }
    sqlite3_finalize(st);
    return n;
}

int drift_interface_check(Cg *cg, const char *tree, const char *base_branch,
                          const char *pre, const char *post, const char *from,
                          const char *tag, StrBuf *out) {
    FileDiff *fd = NULL;
    int nf = drift_diff(tree, pre, post, &fd);
    long base_id = 0;
    sqlite3_stmt *bq = cg_prep(cg, "SELECT id FROM branches WHERE name=?");
    sqlite3_bind_text(bq, 1, base_branch, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(bq) == SQLITE_ROW) base_id = sqlite3_column_int64(bq, 0);
    sqlite3_finalize(bq);
    /* the merged branch's own rows are the change, not a reader of it */
    long from_id = 0;
    bq = cg_prep(cg, "SELECT id FROM branches WHERE name=?");
    sqlite3_bind_text(bq, 1, from, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(bq) == SQLITE_ROW) from_id = sqlite3_column_int64(bq, 0);
    sqlite3_finalize(bq);
    int findings = 0;
    if (out) sb_puts(out, "[");
    for (int i = 0; i < nf; i++) {
        if (drift_exempt(fd[i].path)) continue;
        ParseResult before, after;
        bool had = blob_defs(tree, pre, fd[i].path, &before) == 0;
        bool has = blob_defs(tree, post, fd[i].path, &after) == 0;
        if (!had) { if (has) parse_result_free(&after); continue; }
        for (int d = 0; d < before.ndefs; d++) {
            const SymDef *o = &before.defs[d];
            if (!drift_public(fd[i].path, o->name, o->kind, o->sig)) continue;
            const SymDef *nw = has ? def_named(&after, o->name) : NULL;
            const char *change = !nw ? "removed"
                               : strcmp(o->sig, nw->sig) ? "signature" : NULL;
            if (!change) continue;
            StrBuf sites, agents; sb_init(&sites); sb_init(&agents);
            int ns = drift_ref_sites(cg, o->name, base_id, &sites, &agents);
            /* the merged branch's own references are not other branches */
            (void)from_id;
            if (!ns) { sb_free(&sites); sb_free(&agents); continue; }
            StrBuf p; sb_init(&p);
            sb_puts(&p, "{\"symbol\":"); sb_json_str(&p, o->name);
            sb_puts(&p, ",\"change\":"); sb_json_str(&p, change);
            sb_puts(&p, ",\"path\":"); sb_json_str(&p, fd[i].path);
            sb_puts(&p, ",\"old\":"); sb_json_str(&p, o->sig);
            sb_puts(&p, ",\"new\":");
            if (nw) sb_json_str(&p, nw->sig); else sb_puts(&p, "null");
            sb_puts(&p, ",\"base\":"); sb_json_str(&p, base_branch);
            sb_puts(&p, ",\"from\":"); sb_json_str(&p, from ? from : "");
            sb_puts(&p, ",\"task\":"); sb_json_str(&p, tag ? tag : "");
            sb_printf(&p, ",\"sites\":[%s],\"agents\":[%s]}", sites.p, agents.p);
            events_emit(cg, "drift.interface", tag && tag[0] ? tag : o->name, p.p);
            if (out) { if (findings) sb_putc(out, ','); sb_puts(out, p.p); }
            findings++;
            /* tell the people on those branches, and the managers they
             * report to, what moved under them */
            char **ag = NULL;
            char arr[8192];
            snprintf(arr, sizeof arr, "[%s]", agents.p);
            int na = json_array_items(arr, &ag);
            for (int k = 0; k < na; k++) {
                char *agent = json_get_string(ag[k], "agent");
                char *parent = json_get_string(ag[k], "parent");
                char *branch = json_get_string(ag[k], "branch");
                char msg[900];
                snprintf(msg, sizeof msg, "Interface drift on %s: `%s` (%s) "
                         "was %s by a merge into %s%s%s. Your branch %s "
                         "references it — rebase or merge %s and adjust "
                         "before you qualify.%s%s", base_branch, o->name,
                         fd[i].path, change[0] == 'r' ? "removed" :
                         "changed", base_branch, tag ? " for " : "",
                         tag ? tag : "", branch ? branch : "?", base_branch,
                         nw ? " New signature: " : "", nw ? nw->sig : "");
                if (agent) driver_steer(cg, agent, msg);
                if (parent && parent[0]) driver_steer(cg, parent, msg);
                free(agent); free(parent); free(branch); free(ag[k]);
            }
            free(ag);
            fprintf(stderr, "drift: %s %s (%s) %s by this merge; %d site(s) on "
                    "other live branches were told\n", o->kind, o->name,
                    fd[i].path, change[0] == 'r' ? "removed" : "signature changed",
                    ns);
            sb_free(&p); sb_free(&sites); sb_free(&agents);
        }
        parse_result_free(&before);
        if (has) parse_result_free(&after);
    }
    if (out) sb_puts(out, "]");
    for (int i = 0; i < nf; i++) { free(fd[i].path); free(fd[i].h); }
    free(fd);
    return findings;
}

/* ---------------- requirement coverage ---------------- */

int coverage_check(Cg *cg, const char *feature, StrBuf *out) {
    char path[4700];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", cg->shared, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return -1;
    char **tasks = NULL;
    int nt = kvx_subsections(k, "task", &tasks);
    char **reqs = NULL;
    int nr = kvx_subsections(k, "req", &reqs);
    kvx_sort_dotted(reqs, nr);
    int uncovered = 0, total = 0;
    if (out) sb_puts(out, "[");
    for (int i = 0; i < nr; i++) {
        char rsec[300];
        snprintf(rsec, sizeof rsec, "req.%s", reqs[i]);
        const char **keys = NULL;
        int nk = kvx_keys(k, rsec, &keys);
        for (int j = 0; j < nk; j++) {
            if (strncmp(keys[j], "ac_", 3)) continue;
            char clause[200];
            snprintf(clause, sizeof clause, "%s.%s", reqs[i], keys[j] + 3);
            total++;
            const char *covering = NULL, *pending = NULL;
            for (int t = 0; t < nt && !covering; t++) {
                char tsec[300];
                snprintf(tsec, sizeof tsec, "task.%s", tasks[t]);
                char **cl = NULL;
                int nc = kvx_list(k, tsec, "reqs", &cl);
                bool names = false;
                for (int c = 0; c < nc; c++) {
                    if (!strcmp(cl[c], clause) || !strcmp(cl[c], reqs[i])) names = true;
                    free(cl[c]);
                }
                free(cl);
                if (!names) continue;
                char *st = kvx_str(k, tsec, "status");
                if (st && !strcmp(st, "done")) covering = tasks[t];
                else pending = tasks[t];
                free(st);
            }
            if (covering) continue;
            uncovered++;
            char *text = kvx_str(k, rsec, keys[j]);
            if (out) {
                if (uncovered > 1) sb_putc(out, ',');
                sb_puts(out, "{\"clause\":"); sb_json_str(out, clause);
                sb_puts(out, ",\"text\":"); sb_json_str(out, text ? text : "");
                sb_puts(out, ",\"task\":");
                if (pending) sb_json_str(out, pending); else sb_puts(out, "null");
                sb_putc(out, '}');
            }
            free(text);
        }
        free((void *)keys);
    }
    if (out) sb_puts(out, "]");
    for (int i = 0; i < nt; i++) free(tasks[i]);
    free(tasks);
    for (int i = 0; i < nr; i++) free(reqs[i]);
    free(reqs);
    kvx_free(k);
    if (uncovered) {
        StrBuf p; sb_init(&p);
        sb_puts(&p, "{\"feature\":"); sb_json_str(&p, feature);
        sb_printf(&p, ",\"uncovered\":%d,\"total\":%d}", uncovered, total);
        events_emit(cg, "drift.coverage", feature, p.p);
        sb_free(&p);
    }
    return uncovered;
}

void coverage_print(const char *report_json, const char *feature) {
    char **items = NULL;
    int n = json_array_items(report_json, &items);
    if (!n) return;
    fprintf(stderr, "coverage: %d acceptance criterion(s) of %s have no "
            "qualified task:\n", n, feature);
    for (int i = 0; i < n; i++) {
        char *cl = json_get_string(items[i], "clause");
        char *tx = json_get_string(items[i], "text");
        char *tk = json_get_string(items[i], "task");
        fprintf(stderr, "  %s%s%s%s: %.100s%s\n", cl ? cl : "?",
                tk ? " (" : "", tk ? tk : "", tk ? " not done)" : "",
                tx ? tx : "", tx && strlen(tx) > 100 ? "…" : "");
        free(cl); free(tx); free(tk); free(items[i]);
    }
    free(items);
}

/* recent drift for a feature, one line per kind, for brief and fleet tree;
 * returns the total */
int drift_summary(Cg *cg, const char *feature, StrBuf *text, StrBuf *json) {
    static const char *KINDS[] = { "drift.spec", "drift.interface",
                                   "drift.collision", "drift.coverage", NULL };
    char like[300];
    snprintf(like, sizeof like, "%s/%%", feature);
    int total = 0;
    if (json) sb_putc(json, '{');
    for (int i = 0; KINDS[i]; i++) {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT COUNT(*),MAX(seq) FROM events WHERE kind=? AND (subject=? "
            "OR subject LIKE ?)");
        sqlite3_bind_text(st, 1, KINDS[i], -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, feature, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 3, like, -1, SQLITE_TRANSIENT);
        int n = 0;
        long last = 0;
        if (sqlite3_step(st) == SQLITE_ROW) {
            n = sqlite3_column_int(st, 0);
            last = sqlite3_column_int64(st, 1);
        }
        sqlite3_finalize(st);
        if (json) sb_printf(json, "%s\"%s\":%d", i ? "," : "", KINDS[i] + 6, n);
        if (!n) continue;
        total += n;
        if (text) sb_printf(text, "  %s: %d (latest #%ld)\n", KINDS[i] + 6, n, last);
    }
    if (json) sb_putc(json, '}');
    return total;
}
