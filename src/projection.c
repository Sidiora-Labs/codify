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
#include <fcntl.h>
#include <fnmatch.h>
#include <time.h>
#include <unistd.h>
#include <sys/file.h>
#include <sys/stat.h>

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
                        bool unchanged, const char *index_json, StrBuf *b) {
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
                           const char *index_json) {
    StrBuf b; sb_init(&b);
    if (json)
        proj_object(r->base, r->base_head, r->commit, r->branches,
                    r->conflicts, r->ms, r->built, unchanged, index_json, &b);
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
    if (fd < 0) {
        fprintf(stderr, "cg projection: another build held the projection "
                "lock for %ld ms — showing the last build\n", o->wait_ms);
        ProjRow r;
        proj_last(cg, &r);
        if (r.found) proj_print_row(&r, true, json, NULL);
        proj_row_free(&r);
        return CG_EXIT_BUSY;
    }
    long t0 = now_ms();
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
        if (!json) {
            printf("projection unchanged — inputs match the build of %.12s; "
                   "--force rebuilds\n", last.commit);
        }
        proj_print_row(&last, true, json, o->index ? ij.p : NULL);
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
    StrBuf ij; sb_init(&ij);
    int irc = 0;
    if (o->index) irc = proj_index(cg, si, p.commit, p.base, &ij, json);
    StrBuf out; sb_init(&out);
    if (json)
        proj_object(p.base, p.base_head, p.commit, bj.p, cj.p, p.ms, p.built,
                    false, o->index ? ij.p : NULL, &out);
    else
        proj_text(p.base, p.base_head, p.commit, bj.p, cj.p, p.ms, &out);
    fputs(out.p, stdout);
    sb_free(&out); sb_free(&ij); sb_free(&bj); sb_free(&cj);
    proj_free(&p);
    proj_unlock(fd);
    return irc != 0 ? 1 : 0;
}

static int proj_status(Cg *cg, bool json) {
    ProjRow r;
    proj_last(cg, &r);
    if (!r.found) {
        if (json) printf("{\"built\":null}\n");
        else printf("no projection built yet — cg projection build\n");
        return 0;
    }
    if (!json) {
        long d = (long)time(NULL) - r.built;
        printf("last build %ld s ago\n", d < 0 ? 0 : d);
    }
    proj_print_row(&r, false, json, NULL);
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
    for (int i = 1; i < argc; i++) {
        if (!strcmp(argv[i], "--force")) o.force = true;
        else if (!strcmp(argv[i], "--strict")) o.strict = true;
        else if (!strcmp(argv[i], "--index")) o.index = true;
        else if (!strcmp(argv[i], "--no-index")) o.index = false;
        else if (!strcmp(argv[i], "--wait") && i + 1 < argc)
            o.wait_ms = atol(argv[++i]);
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
    else if (!strcmp(sub, "status")) rc = proj_status(cg, json);
    else if (!strcmp(sub, "diff")) rc = proj_diff(cg, pos ? pos : first_branch,
                                                   json);
    else if (!strcmp(sub, "show")) rc = proj_show(cg, json);
    else { help_usage("projection"); rc = 1; }
    free(o.extra);
    return rc;
}
