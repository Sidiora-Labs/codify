/*
 * Projection findings: what the branches in flight collide on, found while
 * every agent involved is still at the keyboard. git's merge-tree only sees
 * lines; two branches can edit different hunks of one function, or one can
 * change a signature another just started calling, and git folds both
 * without a word. This file reads the same fold with the graph in hand:
 *
 *   symbol     two branches change the same symbol (path and name) against
 *              the base, even when git merges the hunks cleanly
 *   interface  one branch re-signatures or removes a public symbol that
 *              another branch references in code it changed
 *   near       two branches edit one file within three lines of each other
 *   content, delete, add-add
 *              git's own conflicts from the fold (ProjectionConflict)
 *
 * Each branch's hunks are those of the three-dot diff base...contribution
 * (uncommitted work included through the shadow commit). Their head-side
 * lines are mapped onto the symbol spans the graph holds for that branch
 * (files.branch_id); a branch the index does not know yet, or a file its
 * index lacks, falls back to the base's spans with the hunks' base-side
 * lines, which is right for every symbol the branch did not move. near
 * compares base-side lines, the one coordinate system two branches share.
 *
 * conflicts_store diffs a build's findings against projection_findings,
 * keyed by kind, path, symbol, and branch set: projection.conflict once when
 * one appears, projection.resolved when a build stops finding it, and
 * projection.built for every build. conflicts_steer tells the agents on the
 * branches of each new finding through driver_steer, once. Nothing here
 * blocks anything, and nothing here prints: a background build (task 3.3)
 * calls the same three functions. See docs/projection.md.
 */
#include "cg.h"
#include <time.h>

#define NEAR_LINES 3

/* ---------------- per-branch hunks and the symbols they hit ---------------- */

typedef struct {
    DriftHunk h;
    char **syms;
    int nsyms;
} CHunk;

typedef struct {
    char *path;
    CHunk *h;
    int nh;
} CFile;

typedef struct {
    const ConflictBranch *b;
    long id;            /* registry id, 0 unknown */
    CFile *f;
    int nf;
    char **agents;      /* live agents on the branch (fleet or native) */
    int nagents;
} CBr;

typedef struct { char *name; int line, end; } Span;

static long branch_id_of(Cg *cg, const char *name) {
    sqlite3_stmt *st = cg_prep(cg, "SELECT id FROM branches WHERE name=?");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
    long id = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int64(st, 0) : 0;
    sqlite3_finalize(st);
    return id;
}

/* the symbols the graph holds for one file of one branch; -1 when the
 * branch's index has no such file */
static int spans_of(Cg *cg, long bid, const char *path, Span **out) {
    *out = NULL;
    if (bid <= 0) return -1;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id FROM files WHERE branch_id=? AND path=?");
    sqlite3_bind_int64(st, 1, bid);
    sqlite3_bind_text(st, 2, path, -1, SQLITE_TRANSIENT);
    long fid = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int64(st, 0) : 0;
    sqlite3_finalize(st);
    if (!fid) return -1;
    st = cg_prep(cg, "SELECT name, line, ifnull(nullif(end_line,0),line) "
                     "FROM symbols WHERE file_id=? ORDER BY line");
    sqlite3_bind_int64(st, 1, fid);
    int n = 0, cap = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n == cap) {
            cap = cap ? cap * 2 : 16;
            *out = xrealloc(*out, sizeof **out * (size_t)cap);
        }
        (*out)[n].name = xstrdup((const char *)sqlite3_column_text(st, 0));
        (*out)[n].line = sqlite3_column_int(st, 1);
        (*out)[n].end = sqlite3_column_int(st, 2);
        if ((*out)[n].end < (*out)[n].line) (*out)[n].end = (*out)[n].line;
        n++;
    }
    sqlite3_finalize(st);
    return n;
}

static void spans_free(Span *s, int n) {
    for (int i = 0; i < n; i++) free(s[i].name);
    free(s);
}

static bool list_has(char **v, int n, const char *s) {
    for (int i = 0; i < n; i++) if (!strcmp(v[i], s)) return true;
    return false;
}

static void list_push(char ***v, int *n, const char *s) {
    if (list_has(*v, *n, s)) return;
    *v = xrealloc(*v, sizeof **v * (size_t)(*n + 1));
    (*v)[(*n)++] = xstrdup(s);
}

static void list_free(char **v, int n) {
    for (int i = 0; i < n; i++) free(v[i]);
    free(v);
}

/* The innermost symbols a line range touches: a method, not the class
 * around it, unless the edit reaches past the methods. */
static void hunk_symbols(CHunk *ch, const Span *s, int ns, int lo, int hi) {
    for (int i = 0; i < ns; i++) {
        if (s[i].end < lo || s[i].line > hi) continue;
        bool outer = false;
        for (int k = 0; k < ns && !outer; k++) {
            if (k == i || s[k].end < lo || s[k].line > hi) continue;
            bool inside = s[k].line >= s[i].line && s[k].end <= s[i].end &&
                          (s[k].line != s[i].line || s[k].end != s[i].end);
            /* the edit stays within the inner symbol */
            outer = inside && lo >= s[k].line && hi <= s[k].end;
        }
        if (!outer) list_push(&ch->syms, &ch->nsyms, s[i].name);
    }
}

static void branch_load(Cg *cg, const char *base_head, long base_id, CBr *x) {
    char range_base[80];
    snprintf(range_base, sizeof range_base, "%s", base_head);
    DriftFile *df = NULL;
    int nf = drift_hunks(cg->shared, range_base, x->b->contribution, &df);
    x->f = nf ? xmalloc(sizeof *x->f * (size_t)nf) : NULL;
    x->nf = nf;
    for (int i = 0; i < nf; i++) {
        CFile *f = &x->f[i];
        f->path = df[i].path;
        df[i].path = NULL;
        f->nh = df[i].nh;
        f->h = f->nh ? xmalloc(sizeof *f->h * (size_t)f->nh) : NULL;
        Span *sp = NULL;
        int ns = spans_of(cg, x->id, f->path, &sp);
        bool own = ns >= 0;          /* else the base's spans, base lines */
        if (!own) ns = spans_of(cg, base_id, f->path, &sp);
        for (int k = 0; k < f->nh; k++) {
            CHunk *ch = &f->h[k];
            memset(ch, 0, sizeof *ch);
            ch->h = df[i].h[k];
            if (ns > 0) {
                int lo = own ? ch->h.from : ch->h.ofrom;
                int hi = own ? ch->h.to : ch->h.oto;
                hunk_symbols(ch, sp, ns, lo, hi);
            }
        }
        if (ns > 0) spans_free(sp, ns);
    }
    drift_files_free(df, nf);
}

/* [agents] ttl in workflow.kvx (default 3600 s): an agent seen within it
 * is alive — the rule the branch set uses */
static long agents_ttl(Cg *cg) {
    char wfp[4600];
    long ttl = 3600;
    if (!config_workflow_path(cg->shared, wfp, sizeof wfp)) return ttl;
    Kvx *wf = kvx_parse(wfp);
    if (!wf) return ttl;
    ttl = kvx_long(wf, "agents", "ttl", 3600);
    kvx_free(wf);
    return ttl > 0 ? ttl : 3600;
}

/* the live agents on a branch: fleet rows by branch, native rows by
 * branch or by the worktree they run in */
static void branch_agents(Cg *cg, long since, CBr *x) {
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT agent FROM agents WHERE seen>=?1 AND "
            "ifnull(state,'live') NOT IN ('stopped','pending') AND "
            "(branch=?2 OR (?3<>'' AND worktree=?3)) ORDER BY agent",
            -1, &st, NULL) != SQLITE_OK)
        return;
    sqlite3_bind_int64(st, 1, since);
    sqlite3_bind_text(st, 2, x->b->name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, x->b->worktree ? x->b->worktree : "", -1,
                      SQLITE_TRANSIENT);
    while (sqlite3_step(st) == SQLITE_ROW)
        list_push(&x->agents, &x->nagents,
                  (const char *)sqlite3_column_text(st, 0));
    sqlite3_finalize(st);
}

static CBr *br_named(CBr *v, int n, const char *name) {
    for (int i = 0; i < n; i++) if (!strcmp(v[i].b->name, name)) return &v[i];
    return NULL;
}

static CFile *file_of(CBr *x, const char *path) {
    for (int i = 0; i < x->nf; i++)
        if (!strcmp(x->f[i].path, path)) return &x->f[i];
    return NULL;
}

/* "3-5" or "9" */
static void range_str(StrBuf *b, int from, int to) {
    if (to > from) sb_printf(b, "%d-%d", from, to);
    else sb_printf(b, "%d", from);
}

/* ---------------- the findings list ---------------- */

typedef struct { ProjectionFinding *v; int n, cap; } FList;

static int str_cmp(const void *a, const void *b) {
    return strcmp(*(char *const *)a, *(char *const *)b);
}

static ProjectionFinding *fl_add(FList *l, const char *kind, const char *path,
                                 const char *symbol, char **branches, int nb) {
    char **set = NULL;
    int ns = 0;
    for (int i = 0; i < nb; i++) list_push(&set, &ns, branches[i]);
    qsort(set, (size_t)ns, sizeof *set, str_cmp);
    for (int i = 0; i < l->n; i++) {      /* one finding per key */
        ProjectionFinding *f = &l->v[i];
        if (strcmp(f->kind, kind) || strcmp(f->path, path) ||
            strcmp(f->symbol, symbol ? symbol : "") || f->nbranches != ns)
            continue;
        bool same = true;
        for (int k = 0; k < ns && same; k++)
            same = !strcmp(f->branches[k], set[k]);
        if (same) { list_free(set, ns); return NULL; }
    }
    if (l->n == l->cap) {
        l->cap = l->cap ? l->cap * 2 : 16;
        l->v = xrealloc(l->v, sizeof *l->v * (size_t)l->cap);
    }
    ProjectionFinding *f = &l->v[l->n++];
    memset(f, 0, sizeof *f);
    snprintf(f->kind, sizeof f->kind, "%s", kind);
    f->path = xstrdup(path);
    f->symbol = xstrdup(symbol ? symbol : "");
    f->branches = set;
    f->nbranches = ns;
    return f;
}

static bool fl_has_textual(const FList *l, const char *path, const char *a,
                           const char *b) {
    for (int i = 0; i < l->n; i++) {
        const ProjectionFinding *f = &l->v[i];
        if (strcmp(f->path, path)) continue;
        if (strcmp(f->kind, "content") && strcmp(f->kind, "delete") &&
            strcmp(f->kind, "add-add") && strcmp(f->kind, "conflict"))
            continue;
        if (list_has(f->branches, f->nbranches, a) &&
            list_has(f->branches, f->nbranches, b))
            return true;
    }
    return false;
}

/* each involved branch's hunks on path, head-side lines: "feat-a 3-5, 9" */
static char *lines_on(CBr *v, int nv, char **branches, int nb,
                      const char *path, const char *symbol) {
    StrBuf b; sb_init(&b);
    for (int i = 0; i < nb; i++) {
        CBr *x = br_named(v, nv, branches[i]);
        CFile *f = x ? file_of(x, path) : NULL;
        if (!f) continue;
        int shown = 0;
        for (int k = 0; k < f->nh && shown < 4; k++) {
            if (symbol && symbol[0] &&
                !list_has(f->h[k].syms, f->h[k].nsyms, symbol))
                continue;
            sb_puts(&b, shown ? ", " : (b.len ? "; " : ""));
            if (!shown) sb_printf(&b, "%s ", branches[i]);
            range_str(&b, f->h[k].h.from, f->h[k].h.to);
            shown++;
        }
    }
    char *s = xstrdup(b.p ? b.p : "");
    sb_free(&b);
    return s;
}

/* the fold's kinds in this file's words */
static const char *fold_kind(const char *git_kind) {
    if (!strcmp(git_kind, "content")) return "content";
    if (!strcmp(git_kind, "add/add")) return "add-add";
    if (strstr(git_kind, "delete")) return "delete";
    return "conflict";               /* rename/rename, file/directory, ... */
}

static char *advice_for(const ProjectionFinding *f, const char *other) {
    StrBuf b; sb_init(&b);
    const char *first = f->nbranches ? f->branches[0] : "?";
    const char *second = f->nbranches > 1 ? f->branches[1] : "?";
    if (!strcmp(f->kind, "symbol"))
        sb_printf(&b, "both branches change %s: agree who owns it, or merge "
                  "%s and rebase %s onto it", f->symbol, first, second);
    else if (!strcmp(f->kind, "interface"))
        sb_printf(&b, "%s changes %s and %s references it: agree on the "
                  "signature, or merge %s first and update the call",
                  f->changer ? f->changer : first, f->symbol,
                  other ? other : second, f->changer ? f->changer : first);
    else if (!strcmp(f->kind, "near"))
        sb_printf(&b, "edits within %d lines of each other merge cleanly but "
                  "may not mean the same thing: read both before either "
                  "merges", NEAR_LINES);
    else if (!strcmp(f->kind, "content"))
        sb_printf(&b, "git cannot merge %s as it stands: merge one branch "
                  "first and resolve on the other", f->path);
    else if (!strcmp(f->kind, "delete"))
        sb_printf(&b, "one branch deletes %s and another changes it: decide "
                  "which wins before either merges", f->path);
    else if (!strcmp(f->kind, "add-add"))
        sb_printf(&b, "both branches add %s: keep one", f->path);
    else
        sb_printf(&b, "git reports a conflict on %s: merge one branch first "
                  "and resolve on the other", f->path);
    char *s = xstrdup(b.p);
    sb_free(&b);
    return s;
}

static char *agents_json(CBr *v, int nv, char **branches, int nb) {
    StrBuf b; sb_init(&b);
    sb_putc(&b, '[');
    int n = 0;
    for (int i = 0; i < nb; i++) {
        CBr *x = br_named(v, nv, branches[i]);
        for (int k = 0; x && k < x->nagents; k++) {
            if (n++) sb_putc(&b, ',');
            sb_puts(&b, "{\"branch\":");
            sb_json_str(&b, branches[i]);
            sb_puts(&b, ",\"agent\":");
            sb_json_str(&b, x->agents[k]);
            sb_putc(&b, '}');
        }
    }
    sb_putc(&b, ']');
    char *s = xstrdup(b.p);
    sb_free(&b);
    return s;
}

/* Does one branch already carry the other's work (a wave cut from a
 * feature branch)? Then its diff against the base repeats the other's, and
 * the pair is one line of work, not two. */
static bool carries(Cg *cg, const char *base_head, const ConflictBranch *a,
                    const ConflictBranch *b) {
    if (!a->head || !a->head[0] || !b->contribution) return false;
    if (git_is_ancestor(cg->shared, a->head, base_head)) return false;
    return git_is_ancestor(cg->shared, a->head, b->contribution);
}

static int merge_base(Cg *cg, const char *a, const char *b, char *out,
                      size_t cap) {
    StrBuf args; sb_init(&args);
    sb_printf(&args, "merge-base %s %s", a, b);
    StrBuf o; sb_init(&o);
    int rc = git_capture_text(cg->shared, args.p, &o);
    out[0] = 0;
    if (rc == 0 && o.p) {
        size_t n = strcspn(o.p, " \r\n");
        if (n == 40 || n == 64) snprintf(out, cap, "%.*s", (int)n, o.p);
    }
    sb_free(&args); sb_free(&o);
    return out[0] ? 0 : -1;
}

int conflicts_compute(Cg *cg, const char *base, const char *base_head,
                      const ConflictBranch *b, int nb,
                      const ProjectionConflict *fold, int nfold,
                      ProjectionFinding **out) {
    *out = NULL;
    FList l = {0};
    long base_id = branch_id_of(cg, base);
    long since = (long)time(NULL) - agents_ttl(cg);
    CBr *v = nb ? xmalloc(sizeof *v * (size_t)nb) : NULL;
    for (int i = 0; i < nb; i++) {
        memset(&v[i], 0, sizeof v[i]);
        v[i].b = &b[i];
        v[i].id = branch_id_of(cg, b[i].name);
        branch_load(cg, base_head, base_id, &v[i]);
        branch_agents(cg, since, &v[i]);
    }

    /* git's own conflicts first: near defers to them */
    for (int i = 0; i < nfold; i++) {
        const ProjectionConflict *c = &fold[i];
        char **set = NULL;
        int ns = 0;
        list_push(&set, &ns, c->branch);
        for (int k = 0; k < c->nearlier; k++) list_push(&set, &ns, c->earlier[k]);
        ProjectionFinding *f = fl_add(&l, fold_kind(c->kind), c->path, "",
                                      set, ns);
        if (f) f->lines = lines_on(v, nb, f->branches, f->nbranches, c->path,
                                   NULL);
        list_free(set, ns);
    }

    /* symbol and near, pairwise */
    for (int i = 0; i < nb; i++)
        for (int j = i + 1; j < nb; j++) {
            CBr *x = &v[i], *y = &v[j];
            if (carries(cg, base_head, x->b, y->b) ||
                carries(cg, base_head, y->b, x->b))
                continue;
            char *pair[2] = { (char *)x->b->name, (char *)y->b->name };
            for (int a = 0; a < x->nf; a++) {
                CFile *fx = &x->f[a];
                CFile *fy = file_of(y, fx->path);
                if (!fy) continue;
                for (int p = 0; p < fx->nh; p++)
                    for (int s = 0; s < fx->h[p].nsyms; s++) {
                        const char *sym = fx->h[p].syms[s];
                        bool both = false;
                        for (int q = 0; q < fy->nh && !both; q++)
                            both = list_has(fy->h[q].syms, fy->h[q].nsyms, sym);
                        if (!both) continue;
                        ProjectionFinding *f = fl_add(&l, "symbol", fx->path,
                                                      sym, pair, 2);
                        if (f) f->lines = lines_on(v, nb, f->branches, 2,
                                                   fx->path, sym);
                    }
                if (fl_has_textual(&l, fx->path, x->b->name, y->b->name))
                    continue;
                bool found = false;
                for (int p = 0; p < fx->nh && !found; p++)
                    for (int q = 0; q < fy->nh && !found; q++) {
                        const CHunk *hx = &fx->h[p], *hy = &fy->h[q];
                        int gap = hy->h.ofrom - hx->h.oto;
                        int gap2 = hx->h.ofrom - hy->h.oto;
                        if (gap2 > gap) gap = gap2;
                        if (gap > NEAR_LINES) continue;
                        /* one symbol both change is the symbol finding */
                        bool shared = false;
                        for (int s = 0; s < hx->nsyms && !shared; s++)
                            shared = list_has(hy->syms, hy->nsyms, hx->syms[s]);
                        if (shared) continue;
                        ProjectionFinding *f = fl_add(&l, "near", fx->path, "",
                                                      pair, 2);
                        if (!f) { found = true; continue; }
                        StrBuf lb; sb_init(&lb);
                        sb_printf(&lb, "%s ", x->b->name);
                        range_str(&lb, hx->h.from, hx->h.to);
                        sb_printf(&lb, "; %s ", y->b->name);
                        range_str(&lb, hy->h.from, hy->h.to);
                        f->lines = xstrdup(lb.p);
                        sb_free(&lb);
                        found = true;
                    }
            }
        }

    /* interface: a public symbol one branch re-signatures or removes, that
     * another branch references inside the code it changed (a new call, or
     * an old one it rewrote) — read from that branch's rows in the graph */
    for (int i = 0; i < nb; i++) {
        CBr *x = &v[i];
        char pre[80];
        if (merge_base(cg, base_head, x->b->contribution, pre, sizeof pre))
            continue;
        DriftIface *ch = NULL;
        int nch = drift_interface_changes(cg->shared, pre, x->b->contribution,
                                          &ch);
        for (int c = 0; c < nch; c++)
            for (int j = 0; j < nb; j++) {
                CBr *y = &v[j];
                if (j == i || y->id <= 0) continue;
                if (carries(cg, base_head, x->b, y->b) ||
                    carries(cg, base_head, y->b, x->b))
                    continue;
                sqlite3_stmt *st = cg_prep(cg,
                    "SELECT f.path, r.line FROM refs r JOIN files f ON "
                    "f.id=r.file_id WHERE f.branch_id=? AND r.name=? "
                    "ORDER BY f.path, r.line");
                sqlite3_bind_int64(st, 1, y->id);
                sqlite3_bind_text(st, 2, ch[c].name, -1, SQLITE_TRANSIENT);
                char site[1200] = "";
                while (!site[0] && sqlite3_step(st) == SQLITE_ROW) {
                    const char *rp = (const char *)sqlite3_column_text(st, 0);
                    int line = sqlite3_column_int(st, 1);
                    CFile *fy = rp ? file_of(y, rp) : NULL;
                    for (int q = 0; fy && q < fy->nh && !site[0]; q++)
                        if (line >= fy->h[q].h.from && line <= fy->h[q].h.to)
                            snprintf(site, sizeof site, "%s:%d", rp, line);
                }
                sqlite3_finalize(st);
                if (!site[0]) continue;
                char *pair[2] = { (char *)x->b->name, (char *)y->b->name };
                ProjectionFinding *f = fl_add(&l, "interface", ch[c].path,
                                              ch[c].name, pair, 2);
                if (!f) continue;
                f->changer = xstrdup(x->b->name);
                StrBuf lb; sb_init(&lb);
                if (ch[c].removed)
                    sb_printf(&lb, "%s removes it", x->b->name);
                else {
                    /* the definition line, up to its body */
                    const char *sig = ch[c].new_sig;
                    size_t sl = strcspn(sig, "{");
                    while (sl && sig[sl - 1] == ' ') sl--;
                    sb_printf(&lb, "%s now %.*s", x->b->name, (int)sl, sig);
                }
                sb_printf(&lb, "; %s references it at %s", y->b->name, site);
                f->lines = xstrdup(lb.p);
                sb_free(&lb);
                f->advice = advice_for(f, y->b->name);
            }
        drift_ifaces_free(ch, nch);
    }

    for (int i = 0; i < l.n; i++) {
        ProjectionFinding *f = &l.v[i];
        if (!f->lines) f->lines = xstrdup("");
        if (!f->advice) f->advice = advice_for(f, NULL);
        f->agents = agents_json(v, nb, f->branches, f->nbranches);
    }
    for (int i = 0; i < nb; i++) {
        for (int k = 0; k < v[i].nf; k++) {
            for (int h = 0; h < v[i].f[k].nh; h++)
                list_free(v[i].f[k].h[h].syms, v[i].f[k].h[h].nsyms);
            free(v[i].f[k].h);
            free(v[i].f[k].path);
        }
        free(v[i].f);
        list_free(v[i].agents, v[i].nagents);
    }
    free(v);
    *out = l.v;
    return l.n;
}

void conflicts_free(ProjectionFinding *f, int n) {
    for (int i = 0; i < n; i++) {
        free(f[i].path); free(f[i].symbol); free(f[i].lines);
        list_free(f[i].branches, f[i].nbranches);
        free(f[i].agents); free(f[i].advice); free(f[i].changer);
    }
    free(f);
}

/* ---------------- storing: the events ---------------- */

static char *branch_csv(const ProjectionFinding *f) {
    StrBuf b; sb_init(&b);
    for (int i = 0; i < f->nbranches; i++)
        sb_printf(&b, "%s%s", i ? "," : "", f->branches[i]);
    char *s = xstrdup(b.p ? b.p : "");
    sb_free(&b);
    return s;
}

static void branches_json_csv(StrBuf *b, const char *csv) {
    sb_putc(b, '[');
    const char *s = csv;
    int n = 0;
    while (s && *s) {
        const char *e = strchr(s, ',');
        size_t len = e ? (size_t)(e - s) : strlen(s);
        char item[512];
        snprintf(item, sizeof item, "%.*s", (int)len, s);
        if (n++) sb_putc(b, ',');
        sb_json_str(b, item);
        s = e ? e + 1 : NULL;
    }
    sb_putc(b, ']');
}

/* the JSON of one finding, as events and cg projection findings carry it */
static void finding_json(StrBuf *b, const char *kind, const char *path,
                         const char *symbol, const char *csv,
                         const char *lines, const char *agents,
                         const char *advice, const char *changer) {
    sb_puts(b, "{\"kind\":");
    sb_json_str(b, kind);
    sb_puts(b, ",\"path\":");
    sb_json_str(b, path);
    sb_puts(b, ",\"symbol\":");
    if (symbol && symbol[0]) sb_json_str(b, symbol); else sb_puts(b, "null");
    sb_puts(b, ",\"lines\":");
    sb_json_str(b, lines ? lines : "");
    sb_puts(b, ",\"branches\":");
    branches_json_csv(b, csv);
    sb_printf(b, ",\"agents\":%s,\"advice\":", agents && agents[0] ? agents
                                                                   : "[]");
    sb_json_str(b, advice ? advice : "");
    if (changer && changer[0]) {
        sb_puts(b, ",\"changer\":");
        sb_json_str(b, changer);
    }
}

static long live_count(Cg *cg) {
    sqlite3_stmt *st = cg_prep(cg, "SELECT count(*) FROM projection_findings "
                                   "WHERE resolved IS NULL");
    long n = sqlite3_step(st) == SQLITE_ROW ? sqlite3_column_int64(st, 0) : 0;
    sqlite3_finalize(st);
    return n;
}

int conflicts_store(Cg *cg, ProjectionFinding *f, int n, int nbranches,
                    const char *commit, long ms, bool unchanged) {
    if (cg_begin_write(cg) != 0) return -1;
    long now = (long)time(NULL);
    int fresh = 0, resolved = 0;
    if (!unchanged) {
        sqlite3_stmt *st = cg_prep(cg, "SELECT ifnull(max(stamp),0)+1 FROM "
                                       "projection_findings");
        long stamp = sqlite3_step(st) == SQLITE_ROW
                   ? sqlite3_column_int64(st, 0) : 1;
        sqlite3_finalize(st);
        for (int i = 0; i < n; i++) {
            char *csv = branch_csv(&f[i]);
            st = cg_prep(cg, "SELECT id, resolved IS NOT NULL FROM "
                             "projection_findings WHERE kind=? AND path=? AND "
                             "symbol=? AND branches=?");
            sqlite3_bind_text(st, 1, f[i].kind, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 2, f[i].path, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 3, f[i].symbol, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 4, csv, -1, SQLITE_TRANSIENT);
            long id = 0;
            bool was_resolved = false;
            if (sqlite3_step(st) == SQLITE_ROW) {
                id = sqlite3_column_int64(st, 0);
                was_resolved = sqlite3_column_int(st, 1) != 0;
            }
            sqlite3_finalize(st);
            f[i].fresh = !id || was_resolved;
            if (!id)
                st = cg_prep(cg, "INSERT INTO projection_findings(kind,path,"
                    "symbol,branches,lines,agents,advice,changer,first_seen,"
                    "last_seen,stamp) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10)");
            else if (was_resolved)    /* it came back: a new appearance */
                st = cg_prep(cg, "UPDATE projection_findings SET lines=?5,"
                    "agents=?6,advice=?7,changer=?8,first_seen=?9,last_seen=?9,"
                    "stamp=?10,resolved=NULL,steered=0 WHERE kind=?1 AND "
                    "path=?2 AND symbol=?3 AND branches=?4");
            else
                st = cg_prep(cg, "UPDATE projection_findings SET lines=?5,"
                    "agents=?6,advice=?7,changer=?8,last_seen=?9,stamp=?10 "
                    "WHERE kind=?1 AND path=?2 AND symbol=?3 AND branches=?4");
            sqlite3_bind_text(st, 1, f[i].kind, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 2, f[i].path, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 3, f[i].symbol, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 4, csv, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 5, f[i].lines, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 6, f[i].agents, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 7, f[i].advice, -1, SQLITE_TRANSIENT);
            if (f[i].changer)
                sqlite3_bind_text(st, 8, f[i].changer, -1, SQLITE_TRANSIENT);
            else sqlite3_bind_null(st, 8);
            sqlite3_bind_int64(st, 9, now);
            sqlite3_bind_int64(st, 10, stamp);
            sqlite3_step(st);
            sqlite3_finalize(st);
            if (f[i].fresh) {
                StrBuf p; sb_init(&p);
                finding_json(&p, f[i].kind, f[i].path, f[i].symbol, csv,
                             f[i].lines, f[i].agents, f[i].advice,
                             f[i].changer);
                sb_puts(&p, ",\"commit\":");
                sb_json_str(&p, commit ? commit : "");
                sb_putc(&p, '}');
                events_emit(cg, "projection.conflict",
                            f[i].symbol[0] ? f[i].symbol : f[i].path, p.p);
                sb_free(&p);
                fresh++;
            }
            free(csv);
        }
        /* what this build no longer finds */
        st = cg_prep(cg, "SELECT id, kind, path, symbol, branches, first_seen "
                         "FROM projection_findings WHERE resolved IS NULL AND "
                         "stamp<? ORDER BY id");
        sqlite3_bind_int64(st, 1, stamp);
        StrBuf ids; sb_init(&ids);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *kind = (const char *)sqlite3_column_text(st, 1);
            const char *path = (const char *)sqlite3_column_text(st, 2);
            const char *sym = (const char *)sqlite3_column_text(st, 3);
            const char *csv = (const char *)sqlite3_column_text(st, 4);
            long first = sqlite3_column_int64(st, 5);
            StrBuf p; sb_init(&p);
            sb_puts(&p, "{\"kind\":");
            sb_json_str(&p, kind);
            sb_puts(&p, ",\"path\":");
            sb_json_str(&p, path);
            sb_puts(&p, ",\"symbol\":");
            if (sym && sym[0]) sb_json_str(&p, sym); else sb_puts(&p, "null");
            sb_puts(&p, ",\"branches\":");
            branches_json_csv(&p, csv);
            sb_printf(&p, ",\"first_seen\":%ld,\"age\":%ld,\"commit\":",
                      first, now - first);
            sb_json_str(&p, commit ? commit : "");
            sb_putc(&p, '}');
            events_emit(cg, "projection.resolved",
                        sym && sym[0] ? sym : path, p.p);
            sb_free(&p);
            sb_printf(&ids, "%s%lld", ids.len ? "," : "",
                      (long long)sqlite3_column_int64(st, 0));
            resolved++;
        }
        sqlite3_finalize(st);
        if (ids.len) {
            StrBuf sql; sb_init(&sql);
            sb_printf(&sql, "UPDATE projection_findings SET resolved=%ld "
                      "WHERE id IN (%s)", now, ids.p);
            cg_exec(cg, sql.p);
            sb_free(&sql);
        }
        sb_free(&ids);
    }
    StrBuf p; sb_init(&p);
    sb_printf(&p, "{\"branches\":%d,\"conflicts\":%ld,\"new\":%d,"
              "\"resolved\":%d,\"ms\":%ld,\"unchanged\":%s,\"commit\":",
              nbranches, live_count(cg), fresh, resolved, ms,
              unchanged ? "true" : "false");
    sb_json_str(&p, commit ? commit : "");
    sb_putc(&p, '}');
    events_emit(cg, "projection.built", commit, p.p);
    sb_free(&p);
    cg_exec(cg, "COMMIT");
    return fresh;
}

/* ---------------- steering ---------------- */

/* "both change alpha in src/a.c", as the sentence's middle */
static void steer_what(StrBuf *b, const ProjectionFinding *f, const char *me) {
    if (!strcmp(f->kind, "symbol"))
        sb_printf(b, "both change %s in %s", f->symbol, f->path);
    else if (!strcmp(f->kind, "interface")) {
        bool mine = f->changer && !strcmp(f->changer, me);
        sb_printf(b, "collide on %s in %s: %s changes its signature and %s "
                  "references it (%s)", f->symbol, f->path,
                  mine ? "your branch" : (f->changer ? f->changer : "?"),
                  mine ? "the other" : "yours", f->lines);
    } else if (!strcmp(f->kind, "near"))
        sb_printf(b, "both edit %s within %d lines of each other (%s)",
                  f->path, NEAR_LINES, f->lines);
    else if (!strcmp(f->kind, "content"))
        sb_printf(b, "both change %s and git cannot merge them", f->path);
    else if (!strcmp(f->kind, "delete"))
        sb_printf(b, "disagree on %s: one deletes it, the other changes it",
                  f->path);
    else if (!strcmp(f->kind, "add-add"))
        sb_printf(b, "both add %s", f->path);
    else
        sb_printf(b, "conflict on %s", f->path);
}

int conflicts_steer(Cg *cg, ProjectionFinding *f, int n) {
    if (!config_projection_steer(cg->shared)) return 0;
    int sent = 0;
    for (int i = 0; i < n; i++) {
        if (!f[i].fresh) continue;
        char **ag = NULL;
        int na = json_array_items(f[i].agents, &ag);
        for (int a = 0; a < na; a++) {
            char *agent = json_get_string(ag[a], "agent");
            char *mine = json_get_string(ag[a], "branch");
            if (!agent || !mine) { free(agent); free(mine); continue; }
            /* the other branches, each with its agents */
            StrBuf others; sb_init(&others);
            StrBuf names; sb_init(&names);
            for (int k = 0; k < f[i].nbranches; k++) {
                const char *ob = f[i].branches[k];
                if (!strcmp(ob, mine)) continue;
                StrBuf who; sb_init(&who);
                for (int m = 0; m < na; m++) {
                    char *b2 = json_get_string(ag[m], "branch");
                    char *a2 = json_get_string(ag[m], "agent");
                    if (b2 && a2 && !strcmp(b2, ob))
                        sb_printf(&who, "%s%s", who.len ? ", " : "", a2);
                    free(b2); free(a2);
                }
                sb_printf(&others, "%s%s (%s%s)", others.len ? ", " : "", ob,
                          who.len ? "agent " : "no live agent",
                          who.len ? who.p : "");
                sb_printf(&names, "%s%s", names.len ? ", " : "", ob);
                sb_free(&who);
            }
            StrBuf msg; sb_init(&msg);
            sb_printf(&msg, "Projection: your branch %s and %s ", mine,
                      others.len ? others.p : "another branch");
            steer_what(&msg, &f[i], mine);
            sb_printf(&msg, " — coordinate or merge %s before you qualify; "
                      "see cg projection findings",
                      names.len ? names.p : "it");
            if (driver_steer(cg, agent, msg.p) > 0) sent++;
            sb_free(&msg); sb_free(&others); sb_free(&names);
            free(agent); free(mine);
        }
        for (int a = 0; a < na; a++) free(ag[a]);
        free(ag);
        /* steered once: a later build that still finds it says nothing */
        char *csv = branch_csv(&f[i]);
        if (cg_begin_write(cg) == 0) {
            sqlite3_stmt *st = cg_prep(cg, "UPDATE projection_findings SET "
                "steered=1 WHERE kind=? AND path=? AND symbol=? AND branches=?");
            sqlite3_bind_text(st, 1, f[i].kind, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 2, f[i].path, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 3, f[i].symbol, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 4, csv, -1, SQLITE_TRANSIENT);
            sqlite3_step(st);
            sqlite3_finalize(st);
            cg_exec(cg, "COMMIT");
        }
        free(csv);
    }
    return sent;
}

/* ---------------- cg projection findings ---------------- */

static void age_str(char *out, size_t cap, long s) {
    if (s < 0) s = 0;
    if (s < 60) snprintf(out, cap, "%lds", s);
    else if (s < 3600) snprintf(out, cap, "%ldm", s / 60);
    else if (s < 86400) snprintf(out, cap, "%ldh", s / 3600);
    else snprintf(out, cap, "%ldd", s / 86400);
}

int conflicts_print(Cg *cg, bool json, StrBuf *out) {
    long now = (long)time(NULL);
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT kind, path, symbol, branches, ifnull(lines,''), "
        "ifnull(agents,'[]'), ifnull(advice,''), ifnull(changer,''), "
        "first_seen, last_seen FROM projection_findings WHERE resolved IS NULL "
        "ORDER BY first_seen, id");
    int n = 0;
    if (json) sb_puts(out, "{\"findings\":[");
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *kind = (const char *)sqlite3_column_text(st, 0);
        const char *path = (const char *)sqlite3_column_text(st, 1);
        const char *sym = (const char *)sqlite3_column_text(st, 2);
        const char *csv = (const char *)sqlite3_column_text(st, 3);
        const char *lines = (const char *)sqlite3_column_text(st, 4);
        const char *agents = (const char *)sqlite3_column_text(st, 5);
        const char *advice = (const char *)sqlite3_column_text(st, 6);
        const char *changer = (const char *)sqlite3_column_text(st, 7);
        long first = sqlite3_column_int64(st, 8);
        long last = sqlite3_column_int64(st, 9);
        if (json) {
            if (n) sb_putc(out, ',');
            finding_json(out, kind, path, sym, csv, lines, agents, advice,
                         changer);
            sb_printf(out, ",\"first_seen\":%ld,\"last_seen\":%ld,\"age\":%ld}",
                      first, last, now - first);
        } else {
            if (!n) sb_puts(out, "findings:\n");
            char age[32];
            age_str(age, sizeof age, now - first);
            sb_printf(out, "  %-9s %s", kind, path);
            if (sym && sym[0]) sb_printf(out, "  %s", sym);
            sb_puts(out, "  — ");
            /* each branch with its agents */
            const char *s = csv;
            int k = 0;
            while (s && *s) {
                const char *e = strchr(s, ',');
                size_t len = e ? (size_t)(e - s) : strlen(s);
                char br[512];
                snprintf(br, sizeof br, "%.*s", (int)len, s);
                sb_printf(out, "%s%s", k++ ? ", " : "", br);
                char **ag = NULL;
                int na = json_array_items(agents, &ag);
                int shown = 0;
                for (int a = 0; a < na; a++) {
                    char *b2 = json_get_string(ag[a], "branch");
                    char *a2 = json_get_string(ag[a], "agent");
                    if (b2 && a2 && !strcmp(b2, br))
                        sb_printf(out, "%s%s", shown++ ? ", " : " (agent ", a2);
                    free(b2); free(a2); free(ag[a]);
                }
                free(ag);
                if (shown) sb_putc(out, ')');
                s = e ? e + 1 : NULL;
            }
            sb_printf(out, "  (%s)\n", age);
            if (lines && lines[0]) sb_printf(out, "      lines: %s\n", lines);
            sb_printf(out, "      %s\n", advice);
        }
        n++;
    }
    sqlite3_finalize(st);
    if (json) sb_printf(out, "],\"count\":%d}", n);
    else if (!n) sb_puts(out, "no live projection findings\n");
    return n;
}

int cmd_projection_findings(Cg *cg, int argc, char **argv, bool json) {
    (void)argv;
    if (argc > 0) { help_usage("projection findings"); return 1; }
    StrBuf b; sb_init(&b);
    conflicts_print(cg, json, &b);
    if (json) sb_putc(&b, '\n');
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}
