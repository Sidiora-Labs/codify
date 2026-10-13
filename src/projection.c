/*
 * The projection: what main would look like if every branch in flight
 * merged right now. Every active branch — a worktree with a live agent, or
 * one indexed recently — is folded onto the base with git merge-tree, its
 * uncommitted work included through a shadow commit written from a copy of
 * its index, and the result is a real commit at refs/codify/projection that
 * anyone can log, diff, or check out. A conflict does not stop the fold: the
 * branch goes in with git's markers and the path is recorded with every
 * branch that touched it, which is how two agents learn they collide before
 * either of them merges.
 *
 * Nothing here touches a worktree, an index, or a branch ref: shadow
 * commits stage into a temporary index, merge-tree works on objects only,
 * and the one ref written is refs/codify/projection. The optional checkout
 * lives in Codify's own directory (.codegraph/worktrees/projection) and is
 * indexed into the shared graph as branch codify/projection, so every read
 * command answers --branch codify/projection.
 *
 * See docs/projection.md. Task 3.2 builds conflict findings on the records
 * this file writes; task 3.3 triggers builds.
 */
#include "cg.h"
#include <errno.h>
#include <fcntl.h>
#include <fnmatch.h>
#include <time.h>
#include <unistd.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>

#define PROJ_MIN_MAJOR 2
#define PROJ_MIN_MINOR 38

typedef struct {
    char name[256];
    char worktree[4096];   /* "" when the branch is folded from its ref */
    char base[256];        /* the registry's base: topological order */
    long updated;
    bool live, added;
    int  depth;
    char head[65];
    char contribution[65]; /* head, or the shadow commit over it */
    int  dirty;
    long commits;          /* ahead of the base head */
    bool merged;
    const char *skip;      /* why it was left out; NULL when folded */
    char skip_detail[4200];
    int  nconflicts;
    char **changed;        /* paths changed against the base (merge base) */
    int  nchanged;
} ProjBranch;

typedef struct {
    char base[256], base_head[65], commit[65];
    ProjBranch *b;
    int nb, cb;
    ProjectionConflict *c;
    int nc, cc;
    long ms, built;
    bool unchanged;
    char fingerprint[65];
} Projection;

void projection_conflicts_free(ProjectionConflict *v, int n) {
    for (int i = 0; i < n; i++) {
        free(v[i].path);
        free(v[i].branch);
        for (int k = 0; k < v[i].nearlier; k++) free(v[i].earlier[k]);
        free(v[i].earlier);
    }
    free(v);
}

static void proj_free(Projection *p) {
    for (int i = 0; i < p->nb; i++) {
        for (int k = 0; k < p->b[i].nchanged; k++) free(p->b[i].changed[k]);
        free(p->b[i].changed);
    }
    free(p->b);
    projection_conflicts_free(p->c, p->nc);
    memset(p, 0, sizeof *p);
}

static ProjBranch *proj_add(Projection *p, const char *name) {
    for (int i = 0; i < p->nb; i++)
        if (!strcmp(p->b[i].name, name)) return &p->b[i];
    if (p->nb == p->cb) {
        p->cb = p->cb ? p->cb * 2 : 8;
        p->b = xrealloc(p->b, sizeof *p->b * (size_t)p->cb);
    }
    ProjBranch *b = &p->b[p->nb++];
    memset(b, 0, sizeof *b);
    snprintf(b->name, sizeof b->name, "%s", name);
    return b;
}

static bool dir_has_git(const char *dir) {
    char p[4200];
    struct stat st;
    snprintf(p, sizeof p, "%.4090s/.git", dir);
    return dir[0] && stat(p, &st) == 0;
}

/* ---------------- the base and the branch set ---------------- */

/* [projection] base, else [hierarchy] main, else main */
static void proj_base_name(Cg *cg, char *out, size_t cap) {
    const char *b = config_projection_base(cg->shared);
    if (b && b[0]) { snprintf(out, cap, "%s", b); return; }
    char wfp[4600];
    snprintf(out, cap, "main");
    if (!config_workflow_path(cg->shared, wfp, sizeof wfp)) return;
    Kvx *wf = kvx_parse(wfp);
    if (!wf) return;
    char *m = kvx_str(wf, "hierarchy", "main");
    if (m && m[0]) snprintf(out, cap, "%s", m);
    free(m);
    kvx_free(wf);
}

/* the agents ttl ([agents] ttl in workflow.kvx, seconds, default 3600):
 * an agent seen within it is alive */
static long proj_agents_ttl(Cg *cg) {
    char wfp[4600];
    long ttl = 3600;
    if (!config_workflow_path(cg->shared, wfp, sizeof wfp)) return ttl;
    Kvx *wf = kvx_parse(wfp);
    if (!wf) return ttl;
    ttl = kvx_long(wf, "agents", "ttl", 3600);
    kvx_free(wf);
    return ttl > 0 ? ttl : 3600;
}

/* Does a live agent (fleet or native) work on this branch or worktree?
 * Only columns every schema since the branch registry carries are read, so
 * this keeps working as the agents table grows. */
static bool proj_branch_live(Cg *cg, const char *name, const char *worktree,
                             long since) {
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT agent, role, seen FROM agents WHERE seen>=?1 AND "
            "(branch=?2 OR (?3<>'' AND worktree=?3)) LIMIT 1",
            -1, &st, NULL) != SQLITE_OK)
        return false;
    sqlite3_bind_int64(st, 1, since);
    sqlite3_bind_text(st, 2, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, worktree, -1, SQLITE_TRANSIENT);
    bool live = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return live;
}

static int proj_cmp(const void *a, const void *b) {
    const ProjBranch *x = a, *y = b;
    if ((x->skip != NULL) != (y->skip != NULL)) return x->skip ? 1 : -1;
    if (x->depth != y->depth) return x->depth < y->depth ? -1 : 1;
    if (x->updated != y->updated) return x->updated < y->updated ? -1 : 1;
    return strcmp(x->name, y->name);
}

/* The branch set (req 8.1): every registry row whose worktree exists and
 * that has a live agent or was indexed within [projection] stale, minus the
 * base, the projection itself, and the exclude globs, plus the --branch
 * additions; ordered by the depth of their base chain (a feature branch
 * before the waves cut from it), then by registry update time. Branches that
 * qualify but cannot be folded stay in the list with skip set. */
static int projection_branches(Cg *cg, const char *base, char **extra, int nextra,
                        Projection *p) {
    long now = (long)time(NULL);
    long stale = config_projection_stale(cg->shared);
    long since_agent = now - proj_agents_ttl(cg);
    char **ex = NULL;
    int nex = config_projection_exclude(cg->shared, &ex);

    sqlite3_stmt *st = cg_prep(cg,
        "SELECT name, ifnull(worktree,''), ifnull(base,''), updated "
        "FROM branches ORDER BY updated, name");
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *name = (const char *)sqlite3_column_text(st, 0);
        const char *wt = (const char *)sqlite3_column_text(st, 1);
        if (!name || !strcmp(name, base) || !strcmp(name, PROJECTION_BRANCH) ||
            name[0] == '(')                  /* (detached), (none) */
            continue;
        long updated = (long)sqlite3_column_int64(st, 3);
        bool added = false;
        for (int i = 0; i < nextra; i++) added |= !strcmp(extra[i], name);
        bool live = proj_branch_live(cg, name, wt, since_agent);
        if (!live && !added && updated < now - stale) continue;
        ProjBranch *b = proj_add(p, name);
        snprintf(b->worktree, sizeof b->worktree, "%s", wt);
        snprintf(b->base, sizeof b->base, "%s",
                 (const char *)sqlite3_column_text(st, 2));
        b->updated = updated;
        b->live = live;
        b->added = added;
    }
    sqlite3_finalize(st);
    /* --branch names the registry does not hold (or holds without a
     * worktree): folded from their ref */
    for (int i = 0; i < nextra; i++) {
        if (!strcmp(extra[i], base) || !strcmp(extra[i], PROJECTION_BRANCH))
            continue;
        ProjBranch *b = proj_add(p, extra[i]);
        b->added = true;
        if (!b->updated) b->updated = now;
    }

    for (int i = 0; i < p->nb; i++) {
        ProjBranch *b = &p->b[i];
        for (int g = 0; g < nex && !b->skip; g++)
            if (fnmatch(ex[g], b->name, 0) == 0) {
                b->skip = "excluded";
                snprintf(b->skip_detail, sizeof b->skip_detail,
                         "[projection] exclude %s", ex[g]);
            }
        if (b->skip) continue;
        /* the registry names where the branch was last indexed; it counts
         * only while that tree still exists and is still on the branch */
        char hb[256] = "", hs[65] = "";
        if (b->worktree[0] && dir_has_git(b->worktree) &&
            git_head(b->worktree, hb, sizeof hb, hs, sizeof hs) &&
            !strcmp(hb, b->name) && hs[0]) {
            snprintf(b->head, sizeof b->head, "%s", hs);
            continue;
        }
        if (b->added) {
            char ref[300];
            snprintf(ref, sizeof ref, "refs/heads/%s", b->name);
            if (git_rev_commit(cg->shared, ref, b->head, sizeof b->head) == 0) {
                b->worktree[0] = 0;
                continue;
            }
            b->skip = "no such branch";
            snprintf(b->skip_detail, sizeof b->skip_detail,
                     "git has no branch %s", b->name);
            continue;
        }
        b->skip = "worktree missing";
        snprintf(b->skip_detail, sizeof b->skip_detail, "%s",
                 b->worktree[0] ? b->worktree : "(none recorded)");
    }
    for (int g = 0; g < nex; g++) free(ex[g]);
    free(ex);

    /* depth of each branch's base chain inside the set */
    for (int pass = 0; pass < p->nb; pass++) {
        bool moved = false;
        for (int i = 0; i < p->nb; i++)
            for (int j = 0; j < p->nb; j++)
                if (i != j && p->b[i].base[0] &&
                    !strcmp(p->b[i].base, p->b[j].name) &&
                    p->b[i].depth < p->b[j].depth + 1 &&
                    p->b[j].depth + 1 <= p->nb) {
                    p->b[i].depth = p->b[j].depth + 1;
                    moved = true;
                }
        if (!moved) break;
    }
    qsort(p->b, (size_t)p->nb, sizeof *p->b, proj_cmp);
    return p->nb;
}

/* ---------------- contributions ---------------- */

/* A branch's contribution (req 8.2): its head when the worktree is clean,
 * else a shadow commit over the head holding the uncommitted state, staged
 * into a copy of the worktree's index. The shadow is dated with the head's
 * commit time, so the same dirty state yields the same commit id and an
 * unchanged worktree leaves the fingerprint alone. */
static int projection_shadow_commit(Cg *cg, ProjBranch *b, int seq) {
    snprintf(b->contribution, sizeof b->contribution, "%s", b->head);
    b->dirty = 0;
    if (!b->worktree[0]) return 0;
    char dir[4600], tmp[4800];
    snprintf(dir, sizeof dir, "%s/%s/projection", cg->shared, CG_DIR);
    mkdirs(dir);
    snprintf(tmp, sizeof tmp, "%s/index.%ld.%d", dir, (long)getpid(), seq);
    char tree[65];
    if (git_shadow_tree(b->worktree, tmp, tree, sizeof tree) != 0) return -1;
    b->dirty = git_tree_diff_count(cg->shared, b->head, tree);
    if (b->dirty <= 0) { b->dirty = 0; return 0; }
    char msg[512];
    snprintf(msg, sizeof msg, "projection: shadow of %s (%d uncommitted "
             "file%s)", b->name, b->dirty, b->dirty == 1 ? "" : "s");
    const char *parents[1] = { b->head };
    return git_commit_tree(cg->shared, tree, parents, 1, msg,
                           git_commit_time(cg->shared, b->head),
                           b->contribution, sizeof b->contribution);
}

/* ---------------- the fold ---------------- */

static void proj_conflict_add(Projection *p, const ProjectionConflict *src,
                              const char *branch, int upto) {
    if (p->nc == p->cc) {
        p->cc = p->cc ? p->cc * 2 : 8;
        p->c = xrealloc(p->c, sizeof *p->c * (size_t)p->cc);
    }
    ProjectionConflict *c = &p->c[p->nc++];
    memset(c, 0, sizeof *c);
    c->path = xstrdup(src->path);
    snprintf(c->kind, sizeof c->kind, "%s", src->kind);
    c->branch = xstrdup(branch);
    /* the earlier folded branches that changed this path against the base */
    for (int i = 0; i < upto; i++) {
        const ProjBranch *e = &p->b[i];
        if (e->skip || !e->merged) continue;
        bool hit = false;
        for (int k = 0; k < e->nchanged && !hit; k++)
            hit = !strcmp(e->changed[k], src->path);
        if (!hit) continue;
        c->earlier = xrealloc(c->earlier, sizeof *c->earlier *
                              (size_t)(c->nearlier + 1));
        c->earlier[c->nearlier++] = xstrdup(e->name);
    }
}

/* Fold every branch onto the base (req 8.3, 8.4). Returns 0, or -1 when git
 * failed in a way that leaves no projection. */
static int proj_fold(Cg *cg, Projection *p, bool strict) {
    char running[65];
    snprintf(running, sizeof running, "%s", p->base_head);
    for (int i = 0; i < p->nb; i++) {
        ProjBranch *b = &p->b[i];
        if (b->skip) continue;
        char range[200];
        snprintf(range, sizeof range, "%s...%s", p->base_head, b->contribution);
        b->nchanged = git_changed_paths(cg->shared, range, "", &b->changed);
        if (git_is_ancestor(cg->shared, b->contribution, running)) {
            b->merged = true;              /* nothing it adds is missing */
            continue;
        }
        char tree[65];
        ProjectionConflict *cf = NULL;
        int ncf = 0;
        int rc = git_merge_tree(cg->shared, running, b->contribution, tree,
                                sizeof tree, &cf, &ncf);
        if (rc < 0) {
            b->skip = "merge-tree failed";
            snprintf(b->skip_detail, sizeof b->skip_detail,
                     "git merge-tree %.12s %.12s", running, b->contribution);
            continue;
        }
        b->nconflicts = ncf;
        if (rc == 1 && strict) {
            b->skip = "conflicts (--strict)";
            size_t used = 0;
            b->skip_detail[0] = 0;
            for (int k = 0; k < ncf && used < sizeof b->skip_detail; k++)
                used += (size_t)snprintf(b->skip_detail + used,
                                         sizeof b->skip_detail - used,
                                         "%s%s", k ? ", " : "", cf[k].path);
            projection_conflicts_free(cf, ncf);
            continue;
        }
        for (int k = 0; k < ncf; k++) proj_conflict_add(p, &cf[k], b->name, i);
        projection_conflicts_free(cf, ncf);
        char msg[400];
        snprintf(msg, sizeof msg, "projection: + %s", b->name);
        const char *parents[2] = { running, b->contribution };
        char next[65];
        if (git_commit_tree(cg->shared, tree, parents, 2, msg, 0, next,
                            sizeof next) != 0) {
            b->skip = "commit-tree failed";
            snprintf(b->skip_detail, sizeof b->skip_detail, "tree %.12s", tree);
            continue;
        }
        snprintf(running, sizeof running, "%s", next);
        b->merged = true;
    }
    /* no active branch: the projection is the base's own commit */
    snprintf(p->commit, sizeof p->commit, "%s", running);
    return 0;
}

/* ---------------- JSON, the stored row, and the text view ---------------- */

static void proj_branches_json(const Projection *p, StrBuf *b) {
    sb_putc(b, '[');
    for (int i = 0; i < p->nb; i++) {
        const ProjBranch *x = &p->b[i];
        if (i) sb_putc(b, ',');
        sb_puts(b, "{\"name\":");
        sb_json_str(b, x->name);
        sb_puts(b, ",\"head\":");
        if (x->head[0]) sb_json_str(b, x->head); else sb_puts(b, "null");
        sb_puts(b, ",\"contribution\":");
        if (x->contribution[0]) sb_json_str(b, x->contribution);
        else sb_puts(b, "null");
        sb_printf(b, ",\"dirty\":%d,\"commits\":%ld,\"merged\":%s,"
                  "\"conflicts\":%d,\"worktree\":", x->dirty, x->commits,
                  x->merged ? "true" : "false", x->nconflicts);
        if (x->worktree[0]) sb_json_str(b, x->worktree);
        else sb_puts(b, "null");
        sb_printf(b, ",\"live\":%s,\"added\":%s,\"skipped\":",
                  x->live ? "true" : "false", x->added ? "true" : "false");
        if (x->skip) {
            char why[700];
            snprintf(why, sizeof why, "%s: %.600s", x->skip, x->skip_detail);
            sb_json_str(b, why);
        } else sb_puts(b, "null");
        sb_putc(b, '}');
    }
    sb_putc(b, ']');
}

static void proj_conflicts_json(const Projection *p, StrBuf *b) {
    sb_putc(b, '[');
    for (int i = 0; i < p->nc; i++) {
        const ProjectionConflict *c = &p->c[i];
        if (i) sb_putc(b, ',');
        sb_puts(b, "{\"path\":");
        sb_json_str(b, c->path);
        sb_puts(b, ",\"kind\":");
        sb_json_str(b, c->kind);
        sb_puts(b, ",\"branches\":[");
        sb_json_str(b, c->branch);
        for (int k = 0; k < c->nearlier; k++) {
            sb_putc(b, ',');
            sb_json_str(b, c->earlier[k]);
        }
        sb_puts(b, "]}");
    }
    sb_putc(b, ']');
}

/* the stored projection as the object build --json and status --json print */
static void proj_object(const char *base, const char *base_head,
                        const char *commit, const char *branches,
                        const char *conflicts, long ms, long built,
                        bool unchanged, const char *index_json,
                        const char *findings_json, StrBuf *b) {
    sb_puts(b, "{\"base\":");
    sb_json_str(b, base);
    sb_puts(b, ",\"base_head\":");
    sb_json_str(b, base_head);
    sb_puts(b, ",\"ref\":\"" PROJECTION_REF "\",\"commit\":");
    sb_json_str(b, commit);
    sb_printf(b, ",\"unchanged\":%s,\"built\":%ld,\"branches\":%s,"
              "\"conflicts\":%s,\"ms\":%ld", unchanged ? "true" : "false",
              built, branches, conflicts, ms);
    if (index_json) sb_printf(b, ",\"index\":%s", index_json);
    /* codify-v15 3.2: the live findings, {"findings":[...],"count":N} */
    if (findings_json) sb_printf(b, ",\"findings\":%s", findings_json);
    sb_puts(b, "}\n");
}

static bool raw_true(const char *obj, const char *key) {
    char *r = json_get_raw(obj, key);
    bool t = r && !strcmp(r, "true");
    free(r);
    return t;
}

/* req 8.5's text: the base and its head, each branch with its commits ahead
 * and dirty count, the conflicts by path with their branches, the ref */
static void proj_text(const char *base, const char *base_head,
                      const char *commit, const char *branches,
                      const char *conflicts, long ms, StrBuf *b) {
    sb_printf(b, "base %s @ %.12s\n", base, base_head);
    char **items = NULL;
    int n = json_array_items(branches, &items);
    int folded = 0;
    for (int i = 0; i < n; i++) {
        char *name = json_get_string(items[i], "name");
        char *skip = json_get_string(items[i], "skipped");
        char *contrib = json_get_string(items[i], "contribution");
        char *head = json_get_string(items[i], "head");
        long commits = json_get_int(items[i], "commits", 0);
        long dirty = json_get_int(items[i], "dirty", 0);
        long nconf = json_get_int(items[i], "conflicts", 0);
        if (skip) {
            sb_printf(b, "  - %-28s skipped — %s\n", name ? name : "?", skip);
        } else {
            folded++;
            sb_printf(b, "  + %-28s %ld commit%s ahead", name ? name : "?",
                      commits, commits == 1 ? "" : "s");
            if (dirty)
                sb_printf(b, ", %ld dirty file%s (shadow %.12s)", dirty,
                          dirty == 1 ? "" : "s", contrib ? contrib : "?");
            else if (head)
                sb_printf(b, " @ %.12s", head);
            if (nconf)
                sb_printf(b, ", %ld conflict%s", nconf, nconf == 1 ? "" : "s");
            if (!raw_true(items[i], "merged")) sb_puts(b, " (not merged)");
            sb_putc(b, '\n');
        }
        free(name); free(skip); free(contrib); free(head);
        free(items[i]);
    }
    free(items);
    if (!folded) sb_puts(b, "  (no active branches — the projection is the "
                            "base)\n");
    n = json_array_items(conflicts, &items);
    if (n) sb_printf(b, "conflicts (%d):\n", n);
    for (int i = 0; i < n; i++) {
        char *path = json_get_string(items[i], "path");
        char *kind = json_get_string(items[i], "kind");
        char *rb = json_get_raw(items[i], "branches");
        char **names = NULL;
        int nn = rb ? json_array_items(rb, &names) : 0;
        sb_printf(b, "  %s  %s  ", path ? path : "?", kind ? kind : "?");
        for (int k = 0; k < nn; k++) {
            char *s = json_string_value(names[k]);
            sb_printf(b, "%s%s", k ? ", " : "", s ? s : "?");
            free(s);
            free(names[k]);
        }
        free(names);
        sb_putc(b, '\n');
        free(path); free(kind); free(rb);
        free(items[i]);
    }
    free(items);
    sb_printf(b, "%s -> %.12s (%ld ms)\n", PROJECTION_REF, commit, ms);
}

typedef struct {
    bool found;
    long built, ms;
    char base[256], base_head[65], commit[65], fingerprint[65];
    char *branches, *conflicts;
} ProjRow;

static void proj_row_free(ProjRow *r) {
    free(r->branches);
    free(r->conflicts);
    memset(r, 0, sizeof *r);
}

static void proj_last(Cg *cg, ProjRow *r) {
    memset(r, 0, sizeof *r);
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT built, ifnull(base,''), ifnull(base_head,''), "
        "ifnull(commit_id,''), ifnull(fingerprint,''), ifnull(branches,'[]'),"
        " ifnull(conflicts,'[]'), ifnull(ms,0) FROM projections "
        "ORDER BY id DESC LIMIT 1");
    if (sqlite3_step(st) == SQLITE_ROW) {
        r->found = true;
        r->built = (long)sqlite3_column_int64(st, 0);
        snprintf(r->base, sizeof r->base, "%s", sqlite3_column_text(st, 1));
        snprintf(r->base_head, sizeof r->base_head, "%s",
                 sqlite3_column_text(st, 2));
        snprintf(r->commit, sizeof r->commit, "%s", sqlite3_column_text(st, 3));
        snprintf(r->fingerprint, sizeof r->fingerprint, "%s",
                 sqlite3_column_text(st, 4));
        r->branches = xstrdup((const char *)sqlite3_column_text(st, 5));
        r->conflicts = xstrdup((const char *)sqlite3_column_text(st, 6));
        r->ms = (long)sqlite3_column_int64(st, 7);
    }
    sqlite3_finalize(st);
}

static int proj_store(Cg *cg, const Projection *p, const char *branches,
                      const char *conflicts) {
    if (cg_begin_write(cg) != 0) return -1;
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO projections(built,base,base_head,commit_id,fingerprint,"
        "branches,conflicts,ms) VALUES(?,?,?,?,?,?,?,?)");
    sqlite3_bind_int64(st, 1, p->built);
    sqlite3_bind_text(st, 2, p->base, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, p->base_head, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 4, p->commit, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 5, p->fingerprint, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 6, branches, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 7, conflicts, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 8, p->ms);
    bool ok = sqlite3_step(st) == SQLITE_DONE;
    sqlite3_finalize(st);
    /* the history is for status and for task 3.2's diffing; a hundred
     * builds is plenty */
    cg_exec(cg, "DELETE FROM projections WHERE id <= "
                "(SELECT max(id) FROM projections) - 100");
    cg_exec(cg, ok ? "COMMIT" : "ROLLBACK");
    return ok ? 0 : -1;
}

/* ---------------- the projection worktree and its index ---------------- */

/* req 8.7: the projection checked out detached under Codify's directory and
 * indexed into the shared graph as branch codify/projection. A detached
 * HEAD has no branch name, so the name is registered here and the index
 * pass runs with this Cg pointed at that tree and that branch — exactly how
 * a linked worktree's own `cg sync` writes its rows. */
static int proj_index(Cg *cg, const SysInfo *si, const char *commit,
                      const char *base, StrBuf *json, bool quiet) {
    char wt[4096];
    snprintf(wt, sizeof wt, "%.3900s/%s/worktrees/projection", cg->shared,
             CG_DIR);
    bool checked_out = false;
    char hb[256], hs[65];
    if (!dir_has_git(wt)) {
        char parent[4600];
        snprintf(parent, sizeof parent, "%s/%s/worktrees", cg->shared, CG_DIR);
        mkdirs(parent);
        git_run(cg->shared, "worktree prune", NULL);
        StrBuf a; sb_init(&a);
        sb_puts(&a, "worktree add --detach ");
        sb_shquote(&a, wt);
        sb_printf(&a, " %s", commit);
        StrBuf err; sb_init(&err);
        int rc = git_run(cg->shared, a.p, &err);
        sb_free(&a);
        if (rc != 0) {
            fprintf(stderr, "cg projection: cannot add the projection "
                    "worktree at %s: %s", wt, err.p ? err.p : "\n");
            sb_free(&err);
            return -1;
        }
        sb_free(&err);
        checked_out = true;
    } else if (!git_head(wt, hb, sizeof hb, hs, sizeof hs) ||
               strcmp(hs, commit) != 0) {
        StrBuf a; sb_init(&a);
        sb_printf(&a, "checkout -q -f --detach %s", commit);
        StrBuf err; sb_init(&err);
        int rc = git_run(wt, a.p, &err);
        sb_free(&a);
        if (rc != 0) {
            fprintf(stderr, "cg projection: cannot check out %.12s in %s: %s",
                    commit, wt, err.p ? err.p : "\n");
            sb_free(&err);
            return -1;
        }
        sb_free(&err);
        checked_out = true;
    }
    long id = branch_register(cg, PROJECTION_BRANCH, wt, commit, base);
    if (id <= 0) {
        cg_busy_report("cg projection --index");
        return -1;
    }
    /* point this Cg at the projection tree for one index pass */
    char root[4096], branch[256], head[65];
    snprintf(root, sizeof root, "%s", cg->root);
    snprintf(branch, sizeof branch, "%s", cg->branch);
    snprintf(head, sizeof head, "%s", cg->head);
    long bid = cg->branch_id;
    bool worktree = cg->worktree;
    snprintf(cg->root, sizeof cg->root, "%s", wt);
    snprintf(cg->branch, sizeof cg->branch, "%s", PROJECTION_BRANCH);
    snprintf(cg->head, sizeof cg->head, "%s", commit);
    cg->branch_id = id;
    cg->worktree = true;
    IndexOpts o = {0};
    o.lock_wait_ms = -1;
    o.quiet = true;
    IndexStats st;
    int rc = cg_index_ex(cg, si, &o, &st);
    snprintf(cg->root, sizeof cg->root, "%s", root);
    snprintf(cg->branch, sizeof cg->branch, "%s", branch);
    snprintf(cg->head, sizeof cg->head, "%s", head);
    cg->branch_id = bid;
    cg->worktree = worktree;
    if (json) {
        sb_puts(json, "{\"worktree\":");
        sb_json_str(json, wt);
        sb_printf(json, ",\"branch\":\"%s\",\"checked_out\":%s,"
                  "\"files_seen\":%ld,\"files_indexed\":%ld,\"ok\":%s}",
                  PROJECTION_BRANCH, checked_out ? "true" : "false",
                  st.files_seen, st.files_indexed, rc == 0 ? "true" : "false");
    }
    if (!quiet)
        printf("indexed %s as branch %s: %ld files, %ld reindexed%s\n", wt,
               PROJECTION_BRANCH, st.files_seen, st.files_indexed,
               checked_out ? "" : " (checkout unchanged)");
    return rc;
}

/* ---------------- the lock ---------------- */

/* One build at a time per repository. Returns the descriptor, or -1 when
 * wait_ms passed with another build holding it; *waited says whether this
 * caller had to wait at all. */
static int proj_lock(Cg *cg, long wait_ms, bool *waited) {
    char path[4600];
    snprintf(path, sizeof path, "%s/%s/projection.lock", cg->shared, CG_DIR);
    *waited = false;
    int fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (fd < 0) return -1;
    long t0 = now_ms();
    while (flock(fd, LOCK_EX | LOCK_NB) != 0) {
        *waited = true;
        if (now_ms() - t0 >= wait_ms) { close(fd); return -1; }
        struct timespec ts = { 0, 25 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }
    return fd;
}

static void proj_unlock(int fd) {
    if (fd < 0) return;
    flock(fd, LOCK_UN);
    close(fd);
}

/* ---------------- following the work (codify-v15 3.3) ---------------- */

/* Purpose: the projection should be current without anyone running a
 * build. Every place work happens (an edit hook, a host's hook event, a
 * watcher, serve, the supervisor) leaves a dirty note under .codegraph and
 * asks projection_auto_build to act on it; a build consumes the note when it
 * takes the lock, so an edit that lands mid-build is picked up next time.
 * Contract: the callers are hooks the host waits on, so nothing here waits —
 * the build runs in a detached grandchild whose stdio is /dev/null (the host
 * waits for the hook's stdout pipe to close, not for its pid), the lock is
 * probed without blocking, and [projection] min_interval keeps a burst of
 * edits to one build. See docs/projection.md#live. */

static void proj_cg_path(Cg *cg, const char *name, char *out, size_t cap) {
    snprintf(out, cap, "%.4000s/%s/%s", cg->shared, CG_DIR, name);
}

void projection_mark_dirty(Cg *cg, const char *why) {
    char p[4200];
    proj_cg_path(cg, "projection.dirty", p, sizeof p);
    int fd = open(p, O_CREAT | O_WRONLY | O_TRUNC | O_CLOEXEC, 0644);
    if (fd < 0) return;
    char line[300];
    int n = snprintf(line, sizeof line, "%ld %s\n", (long)time(NULL),
                     why ? why : "");
    if (n > 0 && write(fd, line, (size_t)n) < 0) { /* best effort */ }
    close(fd);
}

static bool proj_dirty(Cg *cg) {
    char p[4200];
    struct stat st;
    proj_cg_path(cg, "projection.dirty", p, sizeof p);
    return stat(p, &st) == 0;
}

static void proj_dirty_clear(Cg *cg) {
    char p[4200];
    proj_cg_path(cg, "projection.dirty", p, sizeof p);
    unlink(p);
}

/* when the projection was last built or a background build was last
 * started: the projections row, the projection.built event (a no-op build
 * writes no row), and the launch stamp, whichever is newest */
static long proj_last_activity(Cg *cg) {
    long last = 0;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT ifnull(max(built),0) FROM "
                           "projections", -1, &st, NULL) == SQLITE_OK &&
        sqlite3_step(st) == SQLITE_ROW)
        last = (long)sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    st = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT ifnull(max(at),0) FROM events "
                           "WHERE kind='projection.built'", -1, &st, NULL)
            == SQLITE_OK && sqlite3_step(st) == SQLITE_ROW) {
        long at = (long)sqlite3_column_int64(st, 0);
        if (at > 100000000000L) at /= 1000;           /* stored in ms */
        if (at > last) last = at;
    }
    sqlite3_finalize(st);
    char p[4200];
    struct stat sb;
    proj_cg_path(cg, "projection.launched", p, sizeof p);
    if (stat(p, &sb) == 0 && (long)sb.st_mtime > last) last = (long)sb.st_mtime;
    return last;
}

/* Is there anything to fold, or anything a build would resolve? A
 * repository with one branch and no live findings has no projection worth
 * a process. */
static bool proj_worth_building(Cg *cg) {
    char base[256];
    proj_base_name(cg, base, sizeof base);
    sqlite3_stmt *st = NULL;
    bool any = false;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT (SELECT count(*) FROM branches WHERE name<>?1 AND "
            "name<>?2 AND substr(name,1,1)<>'(' AND ifnull(worktree,'')<>'')"
            " + (SELECT count(*) FROM projection_findings WHERE resolved IS "
            "NULL)", -1, &st, NULL) == SQLITE_OK) {
        sqlite3_bind_text(st, 1, base, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(st, 2, PROJECTION_BRANCH, -1, SQLITE_TRANSIENT);
        any = sqlite3_step(st) == SQLITE_ROW && sqlite3_column_int64(st, 0) > 0;
    }
    sqlite3_finalize(st);
    return any;
}

/* fork, setsid, fork again; the grandchild drops every descriptor it
 * inherited (0-2 to /dev/null) before exec, so whoever reads our stdout
 * sees it close when we exit, not when the build does */
static int proj_spawn_background(Cg *cg) {
    char self[4096];
    ssize_t n = readlink("/proc/self/exe", self, sizeof self - 1);
    if (n > 0) self[n] = 0;
    else snprintf(self, sizeof self, "cg");
    fflush(stdout);
    fflush(stderr);
    pid_t pid = fork();
    if (pid < 0) return -1;
    if (pid == 0) {
        setsid();
        pid_t g = fork();
        if (g != 0) _exit(g < 0 ? 1 : 0);
        int dn = open("/dev/null", O_RDWR);
        if (dn >= 0) {
            dup2(dn, STDIN_FILENO);
            dup2(dn, STDOUT_FILENO);
            dup2(dn, STDERR_FILENO);
        }
        long maxfd = sysconf(_SC_OPEN_MAX);
        if (maxfd < 0 || maxfd > 65536) maxfd = 65536;
        for (int fd = 3; fd < (int)maxfd; fd++) close(fd);
        if (chdir(cg->shared) != 0) _exit(126);
        /* the build is nobody's work: no agent, run, or task identity from
         * whoever triggered it, or its events would count as theirs */
        static const char *const who[] = { "CG_AGENT", "CG_ROLE", "CG_PARENT",
            "CG_FEATURE", "CG_WAVE", "CG_TASK", "CG_RUN", "CG_ATTEMPT",
            "CG_FENCE", "CG_SESSION", "CG_HOST", "CG_BRANCH", "CG_BASE",
            "CG_SLOT_DIR", "CG_SUPERVISOR_LOG", NULL };
        for (int i = 0; who[i]; i++) unsetenv(who[i]);
        char *av[] = { self, (char *)"projection", (char *)"build",
                       (char *)"--quiet", NULL };
        execv(self, av);
        _exit(127);
    }
    int st;
    while (waitpid(pid, &st, 0) < 0 && errno == EINTR) {}
    return 0;
}

int projection_auto_build(Cg *cg, const char *why, long *retry_ms) {
    (void)why;
    if (retry_ms) *retry_ms = 0;
    if (!cg || !cg->db || !config_projection_auto(cg->shared)) return 0;
    if (!proj_dirty(cg) || !dir_has_git(cg->shared)) return 0;
    if (!proj_worth_building(cg)) return 0;
    long now = (long)time(NULL);
    long gap = config_projection_min_interval(cg->shared);
    long last = proj_last_activity(cg);
    if (gap > 0 && last > 0 && now - last < gap) {
        if (retry_ms) *retry_ms = (last + gap - now) * 1000;
        return -1;
    }
    /* a build in flight already has the lock: it, or the next trigger
     * after it, takes the note */
    char lp[4200];
    proj_cg_path(cg, "projection.lock", lp, sizeof lp);
    int fd = open(lp, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (fd < 0) return 0;
    if (flock(fd, LOCK_EX | LOCK_NB) != 0) { close(fd); return 0; }
    flock(fd, LOCK_UN);
    close(fd);
    char sp[4200];
    proj_cg_path(cg, "projection.launched", sp, sizeof sp);
    int sfd = open(sp, O_CREAT | O_WRONLY | O_TRUNC | O_CLOEXEC, 0644);
    if (sfd >= 0) {
        futimens(sfd, NULL);
        close(sfd);
    }
    return proj_spawn_background(cg) == 0 ? 1 : 0;
}

void projection_follow(Cg *cg, const char *why) {
    static long cursor = -1;
    if (!cg || !cg->db) return;
    long head = events_head(cg);
    if (cursor < 0) cursor = head;
    if (head > cursor) {
        sqlite3_stmt *st = NULL;
        bool hit = false;
        if (sqlite3_prepare_v2(cg->db,
                "SELECT 1 FROM events WHERE seq>?1 AND seq<=?2 AND kind IN "
                "('fleet.merge','fleet.land','fleet.begin','orch.spawn',"
                "'agent.native.spawn','agent.native.worktree') LIMIT 1",
                -1, &st, NULL) == SQLITE_OK) {
            sqlite3_bind_int64(st, 1, cursor);
            sqlite3_bind_int64(st, 2, head);
            hit = sqlite3_step(st) == SQLITE_ROW;
        }
        sqlite3_finalize(st);
        cursor = head;
        if (hit) projection_mark_dirty(cg, why);
    }
    projection_auto_build(cg, why, NULL);
}

/* ---------------- the findings, by branch ---------------- */

static void proj_age(char *out, size_t cap, long s) {
    if (s < 0) s = 0;
    if (s < 60) snprintf(out, cap, "%lds", s);
    else if (s < 3600) snprintf(out, cap, "%ldm", s / 60);
    else if (s < 86400) snprintf(out, cap, "%ldh", s / 3600);
    else snprintf(out, cap, "%ldd", s / 86400);
}

/* the branches of a comma-joined set other than me, ", "-joined */
static void proj_others(const char *csv, const char *me, StrBuf *b) {
    int k = 0;
    size_t ml = me ? strlen(me) : 0;
    for (const char *s = csv; s && *s; ) {
        const char *e = strchr(s, ',');
        size_t len = e ? (size_t)(e - s) : strlen(s);
        if (!(me && ml == len && !strncmp(s, me, len)))
            sb_printf(b, "%s%.*s", k++ ? ", " : "", (int)len, s);
        s = e ? e + 1 : NULL;
    }
}

/* the live findings naming branch, two lines each; returns how many */
static int proj_findings_of(Cg *cg, const char *branch, const char *indent,
                            StrBuf *out) {
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT kind, path, symbol, branches, ifnull(advice,''), "
            "first_seen FROM projection_findings WHERE resolved IS NULL AND "
            "(','||branches||',') LIKE '%,'||?1||',%' ORDER BY first_seen, id",
            -1, &st, NULL) != SQLITE_OK) {
        sqlite3_finalize(st);
        return 0;
    }
    sqlite3_bind_text(st, 1, branch, -1, SQLITE_TRANSIENT);
    long now = (long)time(NULL);
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *kind = (const char *)sqlite3_column_text(st, 0);
        const char *path = (const char *)sqlite3_column_text(st, 1);
        const char *sym = (const char *)sqlite3_column_text(st, 2);
        const char *csv = (const char *)sqlite3_column_text(st, 3);
        const char *adv = (const char *)sqlite3_column_text(st, 4);
        char age[32];
        proj_age(age, sizeof age, now - (long)sqlite3_column_int64(st, 5));
        sb_printf(out, "%s%-9s %s", indent, kind ? kind : "?",
                  path ? path : "?");
        if (sym && sym[0]) sb_printf(out, "  %s", sym);
        sb_puts(out, "  with ");
        proj_others(csv, branch, out);
        sb_printf(out, "  (%s)\n", age);
        if (adv && adv[0]) sb_printf(out, "%s    %s\n", indent, adv);
        n++;
    }
    sqlite3_finalize(st);
    return n;
}

int projection_branch_findings(Cg *cg, const char *branch, StrBuf *out) {
    if (!cg || !cg->db || !branch || !branch[0]) return 0;
    StrBuf body; sb_init(&body);
    int n = proj_findings_of(cg, branch, "  ", &body);
    if (n) {
        sb_printf(out, "projection: %d known finding%s on %s — read them "
                  "before this merge (cg projection findings):\n", n,
                  n == 1 ? "" : "s", branch);
        sb_puts(out, body.p);
    }
    sb_free(&body);
    return n;
}

static long proj_count_for(Cg *cg, const char *branch) {
    sqlite3_stmt *st = NULL;
    long n = 0;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT count(*) FROM projection_findings WHERE resolved IS NULL "
            "AND (','||branches||',') LIKE '%,'||?1||',%'", -1, &st, NULL)
            == SQLITE_OK) {
        sqlite3_bind_text(st, 1, branch, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(st) == SQLITE_ROW)
            n = (long)sqlite3_column_int64(st, 0);
    }
    sqlite3_finalize(st);
    return n;
}

/* the branches a build folded, plus any branch a live finding names that
 * the build did not */
static int proj_branch_names(Cg *cg, const char *branches_json, char ***out) {
    char **v = NULL;
    int n = 0;
    char **items = NULL;
    int ni = json_array_items(branches_json, &items);
    for (int i = 0; i < ni; i++) {
        char *name = json_get_string(items[i], "name");
        char *skip = json_get_string(items[i], "skipped");
        if (name && !skip) {
            v = xrealloc(v, sizeof *v * (size_t)(n + 1));
            v[n++] = name;
            name = NULL;
        }
        free(name); free(skip); free(items[i]);
    }
    free(items);
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT branches FROM projection_findings "
                           "WHERE resolved IS NULL", -1, &st, NULL)
            == SQLITE_OK) {
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *csv = (const char *)sqlite3_column_text(st, 0);
            for (const char *s = csv; s && *s; ) {
                const char *e = strchr(s, ',');
                size_t len = e ? (size_t)(e - s) : strlen(s);
                bool have = false;
                for (int k = 0; k < n && !have; k++)
                    have = strlen(v[k]) == len && !strncmp(v[k], s, len);
                if (!have) {
                    char *x = xmalloc(len + 1);
                    memcpy(x, s, len);
                    x[len] = 0;
                    v = xrealloc(v, sizeof *v * (size_t)(n + 1));
                    v[n++] = x;
                }
                s = e ? e + 1 : NULL;
            }
        }
    }
    sqlite3_finalize(st);
    *out = v;
    return n;
}

static void proj_names_free(char **v, int n) {
    for (int i = 0; i < n; i++) free(v[i]);
    free(v);
}

/* the worktree the last build recorded for a branch ("" when none) */
static void proj_worktree_of(const char *branches_json, const char *name,
                             char *out, size_t cap) {
    out[0] = 0;
    char **items = NULL;
    int ni = json_array_items(branches_json, &items);
    for (int i = 0; i < ni; i++) {
        char *nm = json_get_string(items[i], "name");
        if (nm && !strcmp(nm, name) && !out[0]) {
            char *wt = json_get_string(items[i], "worktree");
            if (wt) snprintf(out, cap, "%s", wt);
            free(wt);
        }
        free(nm);
        free(items[i]);
    }
    free(items);
}

static long proj_live_findings(Cg *cg) {
    sqlite3_stmt *st = NULL;
    long n = 0;
    if (sqlite3_prepare_v2(cg->db, "SELECT count(*) FROM projection_findings "
                           "WHERE resolved IS NULL", -1, &st, NULL)
            == SQLITE_OK && sqlite3_step(st) == SQLITE_ROW)
        n = (long)sqlite3_column_int64(st, 0);
    sqlite3_finalize(st);
    return n;
}

static int proj_folded(const char *branches_json) {
    char **items = NULL;
    int ni = json_array_items(branches_json, &items), n = 0;
    for (int i = 0; i < ni; i++) {
        char *skip = json_get_string(items[i], "skipped");
        n += !skip && raw_true(items[i], "merged");
        free(skip);
        free(items[i]);
    }
    free(items);
    return n;
}

void projection_summary(Cg *cg, StrBuf *b, bool json) {
    ProjRow r;
    proj_last(cg, &r);
    if (!r.found) {
        if (json) sb_puts(b, ",\"projection\":null");
        return;
    }
    int folded = proj_folded(r.branches);
    long nf = proj_live_findings(cg);
    long now = (long)time(NULL);
    if (json) {
        sb_puts(b, ",\"projection\":{\"commit\":");
        sb_json_str(b, r.commit);
        sb_printf(b, ",\"built\":%ld,\"age\":%ld,\"branches\":%d,"
                  "\"findings\":%ld,\"first\":[", r.built, now - r.built,
                  folded, nf);
    } else {
        sb_printf(b, "projection: %d branch%s folded, %ld finding%s", folded,
                  folded == 1 ? "" : "es", nf, nf == 1 ? "" : "s");
    }
    sqlite3_stmt *st = NULL;
    int k = 0;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT kind, path, symbol, branches FROM projection_findings "
            "WHERE resolved IS NULL ORDER BY first_seen, id LIMIT 2", -1, &st,
            NULL) == SQLITE_OK) {
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *kind = (const char *)sqlite3_column_text(st, 0);
            const char *path = (const char *)sqlite3_column_text(st, 1);
            const char *sym = (const char *)sqlite3_column_text(st, 2);
            const char *csv = (const char *)sqlite3_column_text(st, 3);
            if (json) {
                if (k) sb_putc(b, ',');
                sb_puts(b, "{\"kind\":");
                sb_json_str(b, kind ? kind : "");
                sb_puts(b, ",\"path\":");
                sb_json_str(b, path ? path : "");
                sb_puts(b, ",\"symbol\":");
                if (sym && sym[0]) sb_json_str(b, sym);
                else sb_puts(b, "null");
                sb_puts(b, ",\"branches\":[");
                int nb = 0;
                for (const char *s = csv; s && *s; ) {
                    const char *e = strchr(s, ',');
                    size_t len = e ? (size_t)(e - s) : strlen(s);
                    char one[512];
                    snprintf(one, sizeof one, "%.*s", (int)len, s);
                    if (nb++) sb_putc(b, ',');
                    sb_json_str(b, one);
                    s = e ? e + 1 : NULL;
                }
                sb_puts(b, "]}");
            } else {
                sb_printf(b, "%s%s ", k ? "; " : " — ", kind ? kind : "?");
                if (sym && sym[0]) sb_printf(b, "%s in ", sym);
                sb_printf(b, "%s (", path ? path : "?");
                proj_others(csv, NULL, b);
                sb_putc(b, ')');
            }
            k++;
        }
    }
    sqlite3_finalize(st);
    if (json) {
        sb_puts(b, "]}");
    } else {
        char age[32];
        proj_age(age, sizeof age, now - r.built);
        sb_printf(b, "%s — built %s ago; cg projection status\n",
                  nf > k ? "; …" : "", age);
    }
    proj_row_free(&r);
}

void projection_tree_json(Cg *cg, StrBuf *b) {
    ProjRow r;
    proj_last(cg, &r);
    if (!r.found) {
        sb_puts(b, ",\"projection\":null");
        return;
    }
    sb_puts(b, ",\"projection\":{\"ref\":\"" PROJECTION_REF "\",\"commit\":");
    sb_json_str(b, r.commit);
    sb_puts(b, ",\"base\":");
    sb_json_str(b, r.base);
    sb_printf(b, ",\"built\":%ld,\"age\":%ld,\"folded\":%d", r.built,
              (long)time(NULL) - r.built, proj_folded(r.branches));
    StrBuf fj; sb_init(&fj);
    conflicts_print(cg, true, &fj);
    char *arr = json_get_raw(fj.p, "findings");
    sb_printf(b, ",\"findings\":%s,\"count\":%ld", arr ? arr : "[]",
              json_get_int(fj.p, "count", 0));
    free(arr);
    sb_free(&fj);
    /* per branch: its worktree (where a finding's path opens) and how many
     * live findings name it */
    sb_puts(b, ",\"branches\":[");
    char **names = NULL;
    int nn = proj_branch_names(cg, r.branches, &names);
    for (int i = 0; i < nn; i++) {
        char wt[4096];
        proj_worktree_of(r.branches, names[i], wt, sizeof wt);
        if (i) sb_putc(b, ',');
        sb_puts(b, "{\"name\":");
        sb_json_str(b, names[i]);
        sb_puts(b, ",\"worktree\":");
        if (wt[0]) sb_json_str(b, wt); else sb_puts(b, "null");
        sb_printf(b, ",\"findings\":%ld}", proj_count_for(cg, names[i]));
    }
    proj_names_free(names, nn);
    sb_puts(b, "]}");
    proj_row_free(&r);
}

/* ---------------- commands ---------------- */

/* req 8.8: a repository and a git that can merge without a worktree */
static int proj_git_check(Cg *cg) {
    if (!dir_has_git(cg->shared)) {
        fprintf(stderr, "cg projection: no git repository at %s — the "
                "projection folds git branches\n", cg->shared);
        return 1;
    }
    int ma, mi;
    if (git_version(&ma, &mi) != 0) {
        fprintf(stderr, "cg projection: git is not installed — the "
                "projection needs git 2.38 or newer\n");
        return 1;
    }
    if (ma < PROJ_MIN_MAJOR || (ma == PROJ_MIN_MAJOR && mi < PROJ_MIN_MINOR)) {
        fprintf(stderr, "cg projection: git %d.%d is older than 2.38, which "
                "added git merge-tree --write-tree — upgrade git\n", ma, mi);
        return 1;
    }
    return 0;
}

static void proj_print_row(const ProjRow *r, bool unchanged, bool json,
                           const char *index_json, const char *findings_json) {
    StrBuf b; sb_init(&b);
    if (json)
        proj_object(r->base, r->base_head, r->commit, r->branches,
                    r->conflicts, r->ms, r->built, unchanged, index_json,
                    findings_json, &b);
    else
        proj_text(r->base, r->base_head, r->commit, r->branches,
                  r->conflicts, r->ms, &b);
    fputs(b.p, stdout);
    sb_free(&b);
}

typedef struct {
    bool force, strict, index, quiet;
    long wait_ms;
    char **extra;
    int nextra;
} ProjOpts;

static int projection_build(Cg *cg, const SysInfo *si, const ProjOpts *o, bool json) {
    int rc = proj_git_check(cg);
    if (rc) return rc;
    bool waited = false;
    int fd = proj_lock(cg, o->wait_ms, &waited);
    /* codify-v15 3.3: a quiet (background) build that finds another build
     * running leaves it to that one — someone else has it, not an error */
    if (fd < 0 && o->quiet) return 0;
    if (fd < 0) {
        fprintf(stderr, "cg projection: another build held the projection "
                "lock for %ld ms — showing the last build\n", o->wait_ms);
        ProjRow r;
        proj_last(cg, &r);
        if (r.found) proj_print_row(&r, true, json, NULL, NULL);
        proj_row_free(&r);
        return CG_EXIT_BUSY;
    }
    long t0 = now_ms();
    proj_dirty_clear(cg);              /* codify-v15 3.3: this build takes it */
    Projection p;
    memset(&p, 0, sizeof p);
    p.built = (long)time(NULL);
    proj_base_name(cg, p.base, sizeof p.base);
    if (git_rev_commit(cg->shared, p.base, p.base_head, sizeof p.base_head)
        != 0) {
        fprintf(stderr, "cg projection: base branch %s does not resolve to a "
                "commit ([projection] base, else [hierarchy] main, else "
                "main)\n", p.base);
        proj_unlock(fd);
        return 1;
    }
    projection_branches(cg, p.base, o->extra, o->nextra, &p);

    /* contributions, then the fingerprint they make */
    StrBuf fp; sb_init(&fp);
    sb_printf(&fp, "%s%s", p.base_head, o->strict ? ";strict" : "");
    for (int i = 0; i < p.nb; i++) {
        ProjBranch *b = &p.b[i];
        if (!b->skip && projection_shadow_commit(cg, b, i) != 0) {
            b->skip = "shadow commit failed";
            snprintf(b->skip_detail, sizeof b->skip_detail, "%s",
                     b->worktree);
        }
        /* a branch reported as skipped is part of what the build says */
        if (b->skip) { sb_printf(&fp, ";%s!%s", b->name, b->skip); continue; }
        b->commits = git_count_commits(cg->shared, p.base_head, b->head);
        sb_printf(&fp, ";%s=%s", b->name, b->contribution);
    }
    sha256_hex(fp.p, fp.len, p.fingerprint);
    sb_free(&fp);

    /* req 8.6: the same inputs fold to the same projection */
    ProjRow last;
    proj_last(cg, &last);
    char refsha[65] = "";
    git_rev_commit(cg->shared, PROJECTION_REF, refsha, sizeof refsha);
    if (!o->force && last.found && !strcmp(last.fingerprint, p.fingerprint) &&
        !strcmp(refsha, last.commit)) {
        StrBuf ij; sb_init(&ij);
        int irc = 0;
        if (o->index)
            irc = proj_index(cg, si, last.commit, last.base, &ij, json);
        if (!json && !o->quiet) {
            printf("projection unchanged — inputs match the build of %.12s; "
                   "--force rebuilds\n", last.commit);
        }
        /* codify-v15 3.2: still a build — projection.built says so; the
         * findings are the last build's, untouched */
        int nb = 0;
        for (int i = 0; i < p.nb; i++) nb += !p.b[i].skip;
        conflicts_store(cg, NULL, 0, nb, last.commit, now_ms() - t0, true);
        StrBuf fj; sb_init(&fj);
        conflicts_print(cg, json, &fj);
        if (!o->quiet) {
            proj_print_row(&last, true, json, o->index ? ij.p : NULL,
                           json ? fj.p : NULL);
            if (!json) fputs(fj.p, stdout);
        }
        sb_free(&fj);
        sb_free(&ij);
        proj_row_free(&last);
        proj_free(&p);
        proj_unlock(fd);
        return irc != 0 ? 1 : 0;
    }
    proj_row_free(&last);
    (void)waited;

    proj_fold(cg, &p, o->strict);
    if (git_update_ref(cg->shared, PROJECTION_REF, p.commit) != 0) {
        fprintf(stderr, "cg projection: git update-ref %s %s failed\n",
                PROJECTION_REF, p.commit);
        proj_free(&p);
        proj_unlock(fd);
        return 1;
    }
    p.ms = now_ms() - t0;
    StrBuf bj; sb_init(&bj);
    StrBuf cj; sb_init(&cj);
    proj_branches_json(&p, &bj);
    proj_conflicts_json(&p, &cj);
    if (proj_store(cg, &p, bj.p, cj.p) != 0)
        cg_busy_report("cg projection (the build row was not stored)");
    /* codify-v15 3.2: the findings of this fold, stored, steered */
    ConflictBranch *cb = p.nb ? xmalloc(sizeof *cb * (size_t)p.nb) : NULL;
    int ncb = 0;
    for (int i = 0; i < p.nb; i++) {
        if (p.b[i].skip || !p.b[i].merged) continue;
        cb[ncb].name = p.b[i].name;
        cb[ncb].worktree = p.b[i].worktree;
        cb[ncb].head = p.b[i].head;
        cb[ncb].contribution = p.b[i].contribution;
        ncb++;
    }
    ProjectionFinding *fs = NULL;
    int nfs = conflicts_compute(cg, p.base, p.base_head, cb, ncb, p.c, p.nc,
                                &fs);
    if (conflicts_store(cg, fs, nfs, ncb, p.commit, now_ms() - t0, false) < 0)
        cg_busy_report("cg projection (the findings were not stored)");
    else
        conflicts_steer(cg, fs, nfs);
    conflicts_free(fs, nfs);
    free(cb);
    StrBuf fj; sb_init(&fj);
    conflicts_print(cg, json, &fj);
    StrBuf ij; sb_init(&ij);
    int irc = 0;
    if (o->index) irc = proj_index(cg, si, p.commit, p.base, &ij, json);
    StrBuf out; sb_init(&out);
    if (json)
        proj_object(p.base, p.base_head, p.commit, bj.p, cj.p, p.ms, p.built,
                    false, o->index ? ij.p : NULL, fj.p, &out);
    else {
        proj_text(p.base, p.base_head, p.commit, bj.p, cj.p, p.ms, &out);
        sb_puts(&out, fj.p);
    }
    sb_free(&fj);
    if (!o->quiet) fputs(out.p, stdout);
    sb_free(&out); sb_free(&ij); sb_free(&bj); sb_free(&cj);
    proj_free(&p);
    proj_unlock(fd);
    return irc != 0 ? 1 : 0;
}

/* the last build, then (codify-v15 3.3) the live findings grouped by the
 * branches they name, with ages — only branch's group when one is named */
static int proj_status(Cg *cg, bool json, const char *branch) {
    ProjRow r;
    proj_last(cg, &r);
    if (!r.found) {
        if (json) printf("{\"built\":null}\n");
        else printf("no projection built yet — cg projection build\n");
        return 0;
    }
    long now = (long)time(NULL);
    char **names = NULL;
    int nn = proj_branch_names(cg, r.branches, &names);
    if (json) {
        /* {"findings":[...],"count":N,"by_branch":{name:{worktree,findings}}} */
        StrBuf fj; sb_init(&fj);
        conflicts_print(cg, true, &fj);
        if (fj.len && fj.p[fj.len - 1] == '}') fj.p[--fj.len] = 0;
        sb_puts(&fj, ",\"by_branch\":{");
        int k = 0;
        for (int i = 0; i < nn; i++) {
            if (branch && strcmp(branch, names[i])) continue;
            char wt[4096];
            proj_worktree_of(r.branches, names[i], wt, sizeof wt);
            if (k++) sb_putc(&fj, ',');
            sb_json_str(&fj, names[i]);
            sb_puts(&fj, ":{\"worktree\":");
            if (wt[0]) sb_json_str(&fj, wt); else sb_puts(&fj, "null");
            sb_printf(&fj, ",\"findings\":%ld}", proj_count_for(cg, names[i]));
        }
        sb_puts(&fj, "}}");
        proj_print_row(&r, false, true, NULL, fj.p);
        sb_free(&fj);
    } else {
        printf("last build %ld s ago\n", now - r.built < 0 ? 0 : now - r.built);
        proj_print_row(&r, false, false, NULL, NULL);
        StrBuf b; sb_init(&b);
        int total = 0;
        for (int i = 0; i < nn; i++) {
            if (branch && strcmp(branch, names[i])) continue;
            StrBuf body; sb_init(&body);
            int n = proj_findings_of(cg, names[i], "    ", &body);
            char wt[4096];
            proj_worktree_of(r.branches, names[i], wt, sizeof wt);
            sb_printf(&b, "  %s%s%s — %d finding%s\n", names[i],
                      wt[0] ? " at " : "", wt, n, n == 1 ? "" : "s");
            if (n) sb_puts(&b, body.p);
            total += n;
            sb_free(&body);
        }
        if (b.len) {
            printf("findings by branch:\n%s", b.p);
            if (!total) printf("  (no live findings)\n");
        }
        sb_free(&b);
    }
    proj_names_free(names, nn);
    proj_row_free(&r);
    return 0;
}

/* the base head the projection was built on, or the named branch */
static int proj_against(Cg *cg, const char *branch, char *sha, size_t cap,
                        char *proj, size_t pcap) {
    if (git_rev_commit(cg->shared, PROJECTION_REF, proj, pcap) != 0) {
        fprintf(stderr, "cg projection: no %s yet — cg projection build\n",
                PROJECTION_REF);
        return 1;
    }
    if (branch) {
        if (git_rev_commit(cg->shared, branch, sha, cap) != 0) {
            fprintf(stderr, "cg projection: %s does not name a commit\n",
                    branch);
            return 1;
        }
        return 0;
    }
    ProjRow r;
    proj_last(cg, &r);
    int rc = 0;
    if (r.found && r.base_head[0]) snprintf(sha, cap, "%s", r.base_head);
    else {
        char base[256];
        proj_base_name(cg, base, sizeof base);
        rc = git_rev_commit(cg->shared, base, sha, cap) == 0 ? 0 : 1;
        if (rc) fprintf(stderr, "cg projection: base %s does not resolve\n",
                        base);
    }
    proj_row_free(&r);
    return rc;
}

static int proj_diff(Cg *cg, const char *branch, bool json) {
    int rc = proj_git_check(cg);
    if (rc) return rc;
    char from[65], proj[65];
    if (proj_against(cg, branch, from, sizeof from, proj, sizeof proj))
        return 1;
    StrBuf a; sb_init(&a);
    sb_printf(&a, "diff --stat %s %s", from, proj);
    StrBuf o; sb_init(&o);
    rc = git_capture_text(cg->shared, a.p, &o);
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"against\":");
        sb_json_str(&b, branch ? branch : "base");
        sb_puts(&b, ",\"from\":");
        sb_json_str(&b, from);
        sb_puts(&b, ",\"commit\":");
        sb_json_str(&b, proj);
        sb_puts(&b, ",\"stat\":");
        sb_json_str(&b, o.p ? o.p : "");
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else if (o.p) {
        fputs(o.p, stdout);
    }
    sb_free(&a); sb_free(&o);
    return rc == 0 ? 0 : 1;
}

static int proj_show(Cg *cg, bool json) {
    int rc = proj_git_check(cg);
    if (rc) return rc;
    char from[65], proj[65];
    if (proj_against(cg, NULL, from, sizeof from, proj, sizeof proj))
        return 1;
    StrBuf a; sb_init(&a);
    sb_printf(&a, "diff --no-renames --name-status %s %s", from, proj);
    StrBuf o; sb_init(&o);
    rc = git_capture_text(cg->shared, a.p, &o);
    sb_free(&a);
    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"base_head\":");
        sb_json_str(&b, from);
        sb_puts(&b, ",\"commit\":");
        sb_json_str(&b, proj);
        sb_puts(&b, ",\"paths\":[");
    }
    int n = 0;
    for (char *line = o.p; rc == 0 && line && *line; ) {
        char *e = strchr(line, '\n');
        if (e) *e = 0;
        char *tab = strchr(line, '\t');
        if (tab) {
            *tab = 0;
            if (json) {
                if (n) sb_putc(&b, ',');
                sb_puts(&b, "{\"status\":");
                sb_json_str(&b, line);
                sb_puts(&b, ",\"path\":");
                sb_json_str(&b, tab + 1);
                sb_putc(&b, '}');
            } else {
                sb_printf(&b, "%s\t%s\n", line, tab + 1);
            }
            n++;
        }
        line = e ? e + 1 : NULL;
    }
    if (json) sb_printf(&b, "],\"count\":%d}\n", n);
    else if (!n) sb_puts(&b, "the projection changes nothing against the "
                             "base\n");
    fputs(b.p, stdout);
    sb_free(&b);
    sb_free(&o);
    return rc == 0 ? 0 : 1;
}

int cmd_projection(Cg *cg, const SysInfo *si, int argc, char **argv,
                   const char *first_branch, bool json) {
    const char *sub = argc > 0 ? argv[0] : "build";
    ProjOpts o;
    memset(&o, 0, sizeof o);
    o.wait_ms = 5000;
    o.index = config_projection_index(cg->shared);
    if (first_branch) {
        o.extra = xrealloc(o.extra, sizeof *o.extra * (size_t)(o.nextra + 1));
        o.extra[o.nextra++] = (char *)first_branch;
    }
    const char *pos = NULL;
    bool wait_set = false;
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--force")) o.force = true;
        else if (!strcmp(argv[i], "--strict")) o.strict = true;
        else if (!strcmp(argv[i], "--index")) o.index = true;
        else if (!strcmp(argv[i], "--no-index")) o.index = false;
        else if (!strcmp(argv[i], "--quiet")) {         /* codify-v15 3.3 */
            o.quiet = true;
            if (!wait_set) o.wait_ms = 0;
        }
        else if (!strcmp(argv[i], "--wait") && i + 1 < argc) {
            o.wait_ms = atol(argv[++i]);
            wait_set = true;
        }
        else if (!strcmp(argv[i], "--branch") && i + 1 < argc) {
            o.extra = xrealloc(o.extra,
                               sizeof *o.extra * (size_t)(o.nextra + 1));
            o.extra[o.nextra++] = argv[++i];
        } else if (argv[i][0] != '-' && !pos) pos = argv[i];
        else {
            help_usage("projection");
            free(o.extra);
            return 1;
        }
    }
    if (o.wait_ms < 0) o.wait_ms = 0;
    int rc;
    if (!strcmp(sub, "build")) rc = projection_build(cg, si, &o, json);
    else if (!strcmp(sub, "status")) rc = proj_status(cg, json, pos);
    else if (!strcmp(sub, "diff")) rc = proj_diff(cg, pos ? pos : first_branch,
                                                   json);
    else if (!strcmp(sub, "show")) rc = proj_show(cg, json);
    else if (!strcmp(sub, "findings"))                  /* codify-v15 3.2 */
        rc = cmd_projection_findings(cg, pos ? 1 : 0, NULL, json);
    else { help_usage("projection"); rc = 1; }
    free(o.extra);
    return rc;
}
