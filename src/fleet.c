/* Fleet: the hierarchy that turns one repository into a tree of agents.
 *
 * Three roles, declared in spec/workflow.kvx: a main agent that owns the
 * task list and merges pull requests, one feature manager per feature that
 * owns the feature branch, and wave workers that implement one wave each
 * on a branch cut from the feature branch. Work flows upward through
 * verified merges — worker into feature, feature into local main, main
 * out through a pull request.
 *
 * This file holds the parts that hold the tree together: the hierarchy
 * config, the identity every agent carries in its environment (CG_AGENT,
 * CG_ROLE, CG_PARENT, CG_FEATURE, CG_WAVE), the registry of who is alive
 * in which role, and the reports — roles, status, plan — that a manager
 * reads to know what its subtree is doing. The branch lifecycle and the
 * two-level orchestrator build on it. */
#include "cg.h"
#include <time.h>
#include <unistd.h>

/* ---------------- identity ---------------- */

typedef struct {
    const char *agent;     /* never NULL */
    const char *role;      /* NULL outside a fleet */
    const char *parent;    /* NULL for the main agent or outside a fleet */
    const char *feature;   /* NULL when the environment does not say */
    long wave;             /* -1 when the environment does not say */
} FleetIdentity;

static void fleet_identity(FleetIdentity *id) {
    id->agent = cg_agent_name(NULL);
    id->role = cg_agent_role(NULL);
    id->parent = cg_agent_parent(NULL);
    const char *f = getenv("CG_FEATURE");
    id->feature = f && f[0] ? f : NULL;
    const char *w = getenv("CG_WAVE");
    id->wave = w && w[0] ? atol(w) : -1;
}

static void bind_opt(sqlite3_stmt *st, int i, const char *v) {
    if (v && v[0]) sqlite3_bind_text(st, i, v, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, i);
}

/* Record who this process is in the agents registry. Outside a fleet
 * (no CG_ROLE) nothing is written, so a solo session leaves no trace and
 * never competes for the write lock. Called from every claim, start, and
 * heartbeat, and from the fleet reports, so a manager that only reads
 * still shows up as alive. */
int fleet_identity_record(Cg *g) {
    FleetIdentity id;
    fleet_identity(&id);
    if (!id.role) return 0;
    char host[256] = "unknown";
    const char *h = getenv("CG_HOST");
    if (h && h[0]) snprintf(host, sizeof host, "%s", h);
    else if (gethostname(host, sizeof host - 1) == 0) host[sizeof host - 1] = 0;
    sqlite3_stmt *st = cg_prep(g,
        "INSERT INTO agents(agent,role,parent,feature,wave,host,session,seen) "
        "VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(agent) DO UPDATE SET "
        "role=excluded.role,parent=excluded.parent,"
        "feature=ifnull(excluded.feature,agents.feature),"
        "wave=ifnull(excluded.wave,agents.wave),"
        "host=excluded.host,session=excluded.session,seen=excluded.seen");
    if (!st) return -1;
    sqlite3_bind_text(st, 1, id.agent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, id.role, -1, SQLITE_TRANSIENT);
    bind_opt(st, 3, id.parent);
    bind_opt(st, 4, id.feature);
    if (id.wave >= 0) sqlite3_bind_int64(st, 5, id.wave);
    else sqlite3_bind_null(st, 5);
    sqlite3_bind_text(st, 6, host, -1, SQLITE_TRANSIENT);
    bind_opt(st, 7, getenv("CG_SESSION"));
    sqlite3_bind_int64(st, 8, (long)time(NULL));
    int rc = sqlite3_step(st) == SQLITE_DONE ? 0 : -1;
    sqlite3_finalize(st);
    return rc;
}

/* ---------------- hierarchy config ---------------- */

static const char *ROLE_NAMES[FLEET_ROLES] = { "main", "feature", "worker" };

static void role_set(FleetRole *r, const char *name, const char *title,
                     const char *agent, const char *branch, const char *base) {
    r->name = xstrdup(name);
    r->title = xstrdup(title);
    r->agent = xstrdup(agent);
    r->branch = xstrdup(branch);
    r->base = xstrdup(base);
}

static void hier_defaults(Hierarchy *h) {
    memset(h, 0, sizeof *h);
    h->main_branch = xstrdup("main");
    h->remote = xstrdup("origin");
    h->worktrees = xstrdup(".codegraph/worktrees");
    h->test_gate = xstrdup("make test");
    h->lint_gate = xstrdup("");
    h->pr = xstrdup("auto");
    h->checkpoint = xstrdup("manual");
    role_set(&h->roles[FLEET_MAIN], "main", "Main Gideon", "gideon",
             "{main}", "");
    role_set(&h->roles[FLEET_FEATURE], "feature", "Feature Manager",
             "fm-{feature}", "feature/{feature}", "{main}");
    role_set(&h->roles[FLEET_WORKER], "worker", "Wave Worker",
             "w-{feature}-{wave}", "wave/{feature}/{wave}",
             "feature/{feature}");
}

static void take_str(char **slot, const Kvx *k, const char *sec,
                     const char *key) {
    char *v = kvx_str(k, sec, key);
    if (!v) return;
    free(*slot);
    *slot = v;
}

/* Read [hierarchy] and [role.main|feature|worker] over the built-in
 * defaults, so a workflow that names only what differs still gets a whole
 * tree. Returns whether the hierarchy is enabled: a missing section means
 * this repository runs flat, and the fleet commands then show the defaults
 * they would use. wf may be NULL (no workflow file at all). */
bool hier_load(const Kvx *wf, Hierarchy *h) {
    hier_defaults(h);
    if (!wf || !kvx_has(wf, "hierarchy")) return false;
    h->configured = true;
    h->enabled = kvx_bool(wf, "hierarchy", "enabled", true);
    take_str(&h->main_branch, wf, "hierarchy", "main");
    take_str(&h->remote, wf, "hierarchy", "remote");
    take_str(&h->worktrees, wf, "hierarchy", "worktrees");
    take_str(&h->test_gate, wf, "hierarchy", "test_gate");
    take_str(&h->lint_gate, wf, "hierarchy", "lint_gate");
    take_str(&h->pr, wf, "hierarchy", "pr");
    take_str(&h->checkpoint, wf, "hierarchy", "checkpoint");
    char **names = NULL;
    int n = kvx_subsections(wf, "role", &names);
    for (int i = 0; i < n; i++) {
        char sec[128];
        snprintf(sec, sizeof sec, "role.%s", names[i]);
        int which = -1;
        for (int r = 0; r < FLEET_ROLES; r++)
            if (strcmp(names[i], ROLE_NAMES[r]) == 0) which = r;
        if (which < 0) {
            if (h->nunknown < (int)(sizeof h->unknown / sizeof h->unknown[0]))
                h->unknown[h->nunknown++] = xstrdup(names[i]);
        } else {
            FleetRole *r = &h->roles[which];
            take_str(&r->title, wf, sec, "title");
            take_str(&r->agent, wf, sec, "agent");
            take_str(&r->branch, wf, sec, "branch");
            take_str(&r->base, wf, sec, "base");
        }
        free(names[i]);
    }
    free(names);
    return h->enabled;
}

void hier_free(Hierarchy *h) {
    free(h->main_branch); free(h->remote); free(h->worktrees);
    free(h->test_gate); free(h->lint_gate); free(h->pr); free(h->checkpoint);
    for (int r = 0; r < FLEET_ROLES; r++) {
        free(h->roles[r].name); free(h->roles[r].title);
        free(h->roles[r].agent); free(h->roles[r].branch);
        free(h->roles[r].base);
    }
    for (int i = 0; i < h->nunknown; i++) free(h->unknown[i]);
    memset(h, 0, sizeof *h);
}

/* Expand {main}, {remote}, {feature}, and {wave} in a role template. A
 * wave below zero expands to nothing, so a feature-level template never
 * grows a stray number. Unknown braces are copied through. */
void hier_expand(const Hierarchy *h, const char *tmpl, const char *feature,
                 long wave, char *out, size_t cap) {
    size_t o = 0;
    out[0] = 0;
    for (const char *p = tmpl; *p && o + 1 < cap; ) {
        const char *rep = NULL;
        size_t skip = 0;
        char wbuf[24];
        if (strncmp(p, "{main}", 6) == 0) { rep = h->main_branch; skip = 6; }
        else if (strncmp(p, "{remote}", 8) == 0) { rep = h->remote; skip = 8; }
        else if (strncmp(p, "{feature}", 9) == 0) {
            rep = feature ? feature : ""; skip = 9;
        } else if (strncmp(p, "{wave}", 6) == 0) {
            if (wave >= 0) snprintf(wbuf, sizeof wbuf, "%ld", wave);
            else wbuf[0] = 0;
            rep = wbuf; skip = 6;
        }
        if (rep) {
            size_t n = strlen(rep);
            if (n > cap - 1 - o) n = cap - 1 - o;
            memcpy(out + o, rep, n);
            o += n;
            p += skip;
        } else {
            out[o++] = *p++;
        }
    }
    out[o] = 0;
}

/* ---------------- shared pieces ---------------- */

static Kvx *fleet_workflow(const Cg *cg, char *path, size_t cap) {
    snprintf(path, cap, "%s/spec/workflow.kvx", cg->root);
    return kvx_parse(path);
}

static const char *role_title(const Hierarchy *h, const char *role) {
    if (!role) return "";
    for (int r = 0; r < FLEET_ROLES; r++)
        if (strcmp(h->roles[r].name, role) == 0) return h->roles[r].title;
    return role;
}

static void ago(long seen, char *out, size_t cap) {
    long d = (long)time(NULL) - seen;
    if (d < 0) d = 0;
    if (d < 90) snprintf(out, cap, "%lds ago", d);
    else if (d < 5400) snprintf(out, cap, "%ldm ago", (d + 30) / 60);
    else snprintf(out, cap, "%ldh ago", (d + 1800) / 3600);
}

/* The identity block `cg brief` prints: who this process is in the fleet.
 * Prints nothing outside a fleet, so a solo brief looks as it always did. */
void fleet_brief(Cg *cg, StrBuf *b, bool json) {
    FleetIdentity id;
    fleet_identity(&id);
    if (json) {
        sb_puts(b, ",\"agent\":{\"name\":");
        sb_json_str(b, id.agent);
        sb_puts(b, ",\"role\":");
        if (id.role) sb_json_str(b, id.role); else sb_puts(b, "null");
        sb_puts(b, ",\"parent\":");
        if (id.parent) sb_json_str(b, id.parent); else sb_puts(b, "null");
        sb_puts(b, ",\"feature\":");
        if (id.feature) sb_json_str(b, id.feature); else sb_puts(b, "null");
        if (id.wave >= 0) sb_printf(b, ",\"wave\":%ld", id.wave);
        else sb_puts(b, ",\"wave\":null");
        sb_putc(b, '}');
    }
    if (!id.role) return;
    fleet_identity_record(cg);
    if (json) return;
    char path[4700];
    Kvx *wf = fleet_workflow(cg, path, sizeof path);
    Hierarchy h;
    hier_load(wf, &h);
    sb_printf(b, "agent: %s — %s", id.agent, role_title(&h, id.role));
    if (id.parent) sb_printf(b, ", reports to %s", id.parent);
    if (id.feature) sb_printf(b, " (feature %s", id.feature);
    if (id.feature && id.wave >= 0) sb_printf(b, ", wave %ld)", id.wave);
    else if (id.feature) sb_puts(b, ")");
    sb_putc(b, '\n');
    hier_free(&h);
    kvx_free(wf);
}

/* ---------------- cg fleet roles ---------------- */

static int fleet_roles(Cg *cg, bool json) {
    char path[4700];
    Kvx *wf = fleet_workflow(cg, path, sizeof path);
    Hierarchy h;
    hier_load(wf, &h);
    if (json) {
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"configured\":%s,\"enabled\":%s,\"workflow\":",
                  h.configured ? "true" : "false",
                  h.enabled ? "true" : "false");
        if (wf) sb_json_str(&b, path); else sb_puts(&b, "null");
        sb_puts(&b, ",\"main\":");      sb_json_str(&b, h.main_branch);
        sb_puts(&b, ",\"remote\":");    sb_json_str(&b, h.remote);
        sb_puts(&b, ",\"worktrees\":"); sb_json_str(&b, h.worktrees);
        sb_puts(&b, ",\"test_gate\":"); sb_json_str(&b, h.test_gate);
        sb_puts(&b, ",\"lint_gate\":"); sb_json_str(&b, h.lint_gate);
        sb_puts(&b, ",\"pr\":");        sb_json_str(&b, h.pr);
        sb_puts(&b, ",\"checkpoint\":"); sb_json_str(&b, h.checkpoint);
        sb_puts(&b, ",\"roles\":[");
        for (int r = 0; r < FLEET_ROLES; r++) {
            if (r) sb_putc(&b, ',');
            sb_puts(&b, "{\"name\":");    sb_json_str(&b, h.roles[r].name);
            sb_puts(&b, ",\"title\":");   sb_json_str(&b, h.roles[r].title);
            sb_puts(&b, ",\"agent\":");   sb_json_str(&b, h.roles[r].agent);
            sb_puts(&b, ",\"branch\":");  sb_json_str(&b, h.roles[r].branch);
            sb_puts(&b, ",\"base\":");    sb_json_str(&b, h.roles[r].base);
            sb_putc(&b, '}');
        }
        sb_puts(&b, "],\"unknown_roles\":[");
        for (int i = 0; i < h.nunknown; i++) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, h.unknown[i]);
        }
        sb_puts(&b, "]}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        if (!wf)
            printf("hierarchy: no spec/workflow.kvx at %s — defaults shown\n",
                   cg->root);
        else if (!h.configured)
            printf("hierarchy: not configured — add [hierarchy] to %s to "
                   "enable the fleet (defaults shown)\n", path);
        else
            printf("hierarchy: %s (%s)\n",
                   h.enabled ? "enabled" : "disabled", path);
        printf("main branch: %s   remote: %s   worktrees: %s\n",
               h.main_branch, h.remote, h.worktrees);
        printf("gates: test `%s`   lint %s%s%s\n", h.test_gate,
               h.lint_gate[0] ? "`" : "", h.lint_gate[0] ? h.lint_gate : "none",
               h.lint_gate[0] ? "`" : "");
        printf("pull requests: %s   checkpoint: %s\n", h.pr, h.checkpoint);
        printf("%-8s %-16s %-20s %-24s %s\n", "role", "title", "agent",
               "branch", "base");
        for (int r = 0; r < FLEET_ROLES; r++)
            printf("%-8s %-16s %-20s %-24s %s\n", h.roles[r].name,
                   h.roles[r].title, h.roles[r].agent, h.roles[r].branch,
                   h.roles[r].base[0] ? h.roles[r].base : "—");
        for (int i = 0; i < h.nunknown; i++)
            printf("warn: [role.%s] is not main, feature, or worker — "
                   "ignored\n", h.unknown[i]);
    }
    hier_free(&h);
    kvx_free(wf);
    return 0;
}

/* ---------------- cg fleet status ---------------- */

/* live tasks of one agent as "feature/id feature/id ..." */
static char *agent_live_tasks(Cg *g, const char *agent) {
    sqlite3_stmt *st = cg_prep(g,
        "SELECT task, (expires - strftime('%s','now') + 59) / 60 "
        "FROM attempts WHERE agent=? AND state='running' "
        "AND expires>strftime('%s','now') ORDER BY task");
    if (!st) return xstrdup("");
    sqlite3_bind_text(st, 1, agent, -1, SQLITE_TRANSIENT);
    StrBuf b; sb_init(&b);
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (b.len) sb_putc(&b, ' ');
        sb_printf(&b, "%s", (const char *)sqlite3_column_text(st, 0));
    }
    sqlite3_finalize(st);
    return b.p;
}

static int fleet_status(Cg *cg, bool json) {
    FleetIdentity id;
    fleet_identity(&id);
    fleet_identity_record(cg);
    char path[4700];
    Kvx *wf = fleet_workflow(cg, path, sizeof path);
    Hierarchy h;
    hier_load(wf, &h);
    long ttl = wf ? kvx_long(wf, "agents", "ttl", 3600) : 3600;

    /* every registered agent seen inside the ttl, plus any agent holding
     * a live attempt without ever declaring a role */
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT agent, role, parent, feature, wave, seen FROM ("
        "  SELECT a.agent agent, ifnull(a.role,'') role, "
        "         ifnull(a.parent,'') parent, ifnull(a.feature,'') feature, "
        "         ifnull(a.wave,-1) wave, a.seen seen FROM agents a "
        "  WHERE a.seen > strftime('%s','now') - ? "
        "     OR EXISTS(SELECT 1 FROM attempts t WHERE t.agent=a.agent "
        "               AND t.state='running' AND t.expires>strftime('%s','now'))"
        "  UNION "
        "  SELECT t.agent, '', '', '', -1, max(t.heartbeat) FROM attempts t "
        "  WHERE t.state='running' AND t.expires>strftime('%s','now') "
        "    AND t.agent NOT IN (SELECT agent FROM agents) GROUP BY t.agent"
        ") ORDER BY CASE role WHEN 'main' THEN 0 WHEN 'feature' THEN 1 "
        "WHEN 'worker' THEN 2 ELSE 3 END, feature, wave, agent");
    StrBuf b; sb_init(&b);
    int n = 0;
    if (json) {
        sb_puts(&b, "{\"you\":{\"name\":");
        sb_json_str(&b, id.agent);
        sb_puts(&b, ",\"role\":");
        if (id.role) sb_json_str(&b, id.role); else sb_puts(&b, "null");
        sb_puts(&b, ",\"parent\":");
        if (id.parent) sb_json_str(&b, id.parent); else sb_puts(&b, "null");
        sb_printf(&b, "},\"hierarchy\":{\"configured\":%s,\"enabled\":%s,"
                  "\"main\":", h.configured ? "true" : "false",
                  h.enabled ? "true" : "false");
        sb_json_str(&b, h.main_branch);
        sb_puts(&b, ",\"remote\":");
        sb_json_str(&b, h.remote);
        sb_puts(&b, "},\"agents\":[");
    } else {
        sb_printf(&b, "you: %s", id.agent);
        if (id.role) {
            sb_printf(&b, " — %s", role_title(&h, id.role));
            if (id.parent) sb_printf(&b, ", reports to %s", id.parent);
        } else {
            sb_puts(&b, " — no role (set CG_ROLE=main|feature|worker and "
                        "CG_PARENT to join the fleet)");
        }
        sb_printf(&b, "\nhierarchy: %s — main %s, remote %s, PRs %s\n",
                  !h.configured ? "not configured"
                                : h.enabled ? "enabled" : "disabled",
                  h.main_branch, h.remote, h.pr);
    }
    if (st) {
        sqlite3_bind_int64(st, 1, ttl);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *agent = (const char *)sqlite3_column_text(st, 0);
            const char *role = (const char *)sqlite3_column_text(st, 1);
            const char *parent = (const char *)sqlite3_column_text(st, 2);
            const char *feature = (const char *)sqlite3_column_text(st, 3);
            long wave = (long)sqlite3_column_int64(st, 4);
            long seen = (long)sqlite3_column_int64(st, 5);
            char *tasks = agent_live_tasks(cg, agent);
            char when[32];
            ago(seen, when, sizeof when);
            if (json) {
                if (n) sb_putc(&b, ',');
                sb_puts(&b, "{\"agent\":");   sb_json_str(&b, agent);
                sb_puts(&b, ",\"role\":");
                if (role[0]) sb_json_str(&b, role); else sb_puts(&b, "null");
                sb_puts(&b, ",\"parent\":");
                if (parent[0]) sb_json_str(&b, parent); else sb_puts(&b, "null");
                sb_puts(&b, ",\"feature\":");
                if (feature[0]) sb_json_str(&b, feature); else sb_puts(&b, "null");
                if (wave >= 0) sb_printf(&b, ",\"wave\":%ld", wave);
                else sb_puts(&b, ",\"wave\":null");
                sb_printf(&b, ",\"seen\":%ld,\"tasks\":[", seen);
                int k = 0;
                for (char *p = tasks; *p; ) {
                    char *e = strchr(p, ' ');
                    if (e) *e = 0;
                    if (k++) sb_putc(&b, ',');
                    sb_json_str(&b, p);
                    if (!e) break;
                    p = e + 1;
                }
                sb_puts(&b, "]}");
            } else {
                char scope[160] = "";
                if (feature[0] && wave >= 0)
                    snprintf(scope, sizeof scope, "%s wave %ld", feature, wave);
                else if (feature[0])
                    snprintf(scope, sizeof scope, "%s", feature);
                sb_printf(&b, "  %-8s %-20s %-24s %-9s %s%s%s%s%s\n",
                          role[0] ? role : "?", agent, scope, when,
                          parent[0] ? "under " : "", parent,
                          tasks[0] ? "  on " : "", tasks,
                          role[0] ? "" : "  (no CG_ROLE)");
            }
            free(tasks);
            n++;
        }
        sqlite3_finalize(st);
    }
    if (json) {
        sb_puts(&b, "]}\n");
    } else if (!n) {
        sb_puts(&b, "no live agents\n");
    }
    fputs(b.p, stdout);
    sb_free(&b);
    hier_free(&h);
    kvx_free(wf);
    return 0;
}

/* ---------------- cg fleet plan ---------------- */

typedef struct { char *id, *title, *status; long wave; } PlanTask;

static int plan_task_cmp(const void *a, const void *b) {
    const PlanTask *x = a, *y = b;
    if (x->wave != y->wave) return x->wave < y->wave ? -1 : 1;
    return 0;  /* qsort is not stable; ids were dotted-sorted before */
}

/* live agents on one feature, by role; workers are keyed by the wave of
 * the task they hold, managers by the feature they registered */
typedef struct { char *agent; long wave; char *role; } LiveAgent;

static void live_add(LiveAgent **v, int *n, int *cap, const char *agent,
                     long wave, const char *role) {
    for (int i = 0; i < *n; i++)
        if (strcmp((*v)[i].agent, agent) == 0 && (*v)[i].wave == wave) return;
    if (*n == *cap) {
        *cap = *cap ? *cap * 2 : 8;
        *v = xrealloc(*v, sizeof(LiveAgent) * (size_t)*cap);
    }
    (*v)[*n].agent = xstrdup(agent);
    (*v)[*n].wave = wave;
    (*v)[*n].role = xstrdup(role);
    (*n)++;
}

static void live_names(const LiveAgent *v, int n, const char *role,
                       long wave, StrBuf *b, bool json) {
    int k = 0;
    for (int i = 0; i < n; i++) {
        if (strcmp(v[i].role, role) != 0) continue;
        if (wave >= 0 && v[i].wave != wave) continue;
        if (k++) sb_puts(b, json ? "," : ", ");
        if (json) sb_json_str(b, v[i].agent); else sb_puts(b, v[i].agent);
    }
    if (!k && !json) sb_puts(b, "—");
}

static int fleet_plan(Cg *cg, const char *feature_ov, bool json) {
    fleet_identity_record(cg);
    char path[4700];
    Kvx *wf = fleet_workflow(cg, path, sizeof path);
    if (!wf) {
        fprintf(stderr, "cg fleet: no spec/workflow.kvx at %s\n", cg->root);
        return 1;
    }
    Hierarchy h;
    hier_load(wf, &h);
    char *feature = feature_ov ? xstrdup(feature_ov)
                               : kvx_str(wf, "meta", "active_feature");
    if (!feature || !feature[0]) {
        fprintf(stderr, "cg fleet: no active_feature in %s (use -f)\n", path);
        free(feature); hier_free(&h); kvx_free(wf);
        return 1;
    }
    char fpath[4700];
    snprintf(fpath, sizeof fpath, "%s/spec/%s/spec.kvx", cg->root, feature);
    Kvx *f = kvx_parse(fpath);
    if (!f) {
        fprintf(stderr, "cg fleet: cannot parse %s\n", fpath);
        free(feature); hier_free(&h); kvx_free(wf);
        return 1;
    }
    char **ids = NULL;
    int nids = kvx_subsections(f, "task", &ids);
    kvx_sort_dotted(ids, nids);
    PlanTask *tasks = xmalloc(sizeof(PlanTask) * (size_t)(nids > 0 ? nids : 1));
    int nt = 0;
    for (int i = 0; i < nids; i++) {
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", ids[i]);
        if (!kvx_raw(f, sec, "wave")) continue;         /* heading */
        char *st = kvx_str(f, sec, "status");
        tasks[nt].id = xstrdup(ids[i]);
        tasks[nt].title = kvx_str(f, sec, "title");
        if (!tasks[nt].title) tasks[nt].title = xstrdup("");
        tasks[nt].status = st && st[0] ? st : xstrdup("pending");
        if (st && !st[0]) free(st);
        tasks[nt].wave = kvx_long(f, sec, "wave", 0);
        nt++;
    }
    /* a stable order: dotted order inside each wave */
    for (int i = 1; i < nt; i++) {
        PlanTask t = tasks[i];
        int j = i;
        while (j > 0 && tasks[j - 1].wave > t.wave) { tasks[j] = tasks[j - 1]; j--; }
        tasks[j] = t;
    }
    (void)plan_task_cmp;

    /* who is alive on this feature */
    LiveAgent *live = NULL;
    int nlive = 0, clive = 0;
    long ttl = kvx_long(wf, "agents", "ttl", 3600);
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT t.task, t.agent, ifnull(a.role,'worker') FROM attempts t "
        "LEFT JOIN agents a ON a.agent=t.agent "
        "WHERE t.task LIKE ?||'/%' AND t.state='running' "
        "AND t.expires>strftime('%s','now')");
    if (st) {
        sqlite3_bind_text(st, 1, feature, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *task = (const char *)sqlite3_column_text(st, 0);
            const char *id = strrchr(task, '/');
            id = id ? id + 1 : task;
            long wave = -1;
            for (int i = 0; i < nt; i++)
                if (strcmp(tasks[i].id, id) == 0) { wave = tasks[i].wave; break; }
            const char *role = (const char *)sqlite3_column_text(st, 2);
            /* a manager holding a task is still listed as the manager */
            live_add(&live, &nlive, &clive,
                     (const char *)sqlite3_column_text(st, 1),
                     strcmp(role, "worker") == 0 ? wave : -1, role);
        }
        sqlite3_finalize(st);
    }
    st = cg_prep(cg,
        "SELECT agent, role FROM agents WHERE role IN ('main','feature') "
        "AND (role='main' OR ifnull(feature,'')=?) "
        "AND seen > strftime('%s','now') - ?");
    if (st) {
        sqlite3_bind_text(st, 1, feature, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(st, 2, ttl);
        while (sqlite3_step(st) == SQLITE_ROW)
            live_add(&live, &nlive, &clive,
                     (const char *)sqlite3_column_text(st, 0), -1,
                     (const char *)sqlite3_column_text(st, 1));
        sqlite3_finalize(st);
    }

    char agent[256], branch[512], base[512];
    StrBuf b; sb_init(&b);
    const FleetRole *rm = &h.roles[FLEET_MAIN];
    const FleetRole *rf = &h.roles[FLEET_FEATURE];
    const FleetRole *rw = &h.roles[FLEET_WORKER];
    if (json) {
        sb_puts(&b, "{\"feature\":");
        sb_json_str(&b, feature);
        sb_printf(&b, ",\"hierarchy\":{\"configured\":%s,\"enabled\":%s}",
                  h.configured ? "true" : "false", h.enabled ? "true" : "false");
        hier_expand(&h, rm->agent, feature, -1, agent, sizeof agent);
        hier_expand(&h, rm->branch, feature, -1, branch, sizeof branch);
        sb_puts(&b, ",\"main\":{\"agent\":"); sb_json_str(&b, agent);
        sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
        sb_puts(&b, ",\"live\":["); live_names(live, nlive, "main", -1, &b, true);
        sb_puts(&b, "]}");
        hier_expand(&h, rf->agent, feature, -1, agent, sizeof agent);
        hier_expand(&h, rf->branch, feature, -1, branch, sizeof branch);
        hier_expand(&h, rf->base, feature, -1, base, sizeof base);
        sb_puts(&b, ",\"feature_manager\":{\"agent\":"); sb_json_str(&b, agent);
        sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
        sb_puts(&b, ",\"base\":"); sb_json_str(&b, base);
        sb_puts(&b, ",\"live\":["); live_names(live, nlive, "feature", -1, &b, true);
        sb_puts(&b, "]},\"waves\":[");
    } else {
        sb_printf(&b, "fleet plan — feature %s (hierarchy %s)\n", feature,
                  !h.configured ? "not configured, defaults shown"
                                : h.enabled ? "enabled" : "disabled");
        hier_expand(&h, rm->agent, feature, -1, agent, sizeof agent);
        hier_expand(&h, rm->branch, feature, -1, branch, sizeof branch);
        sb_printf(&b, "%-9s %-20s %-28s %-24s live: ", "main", agent, branch, "");
        live_names(live, nlive, "main", -1, &b, false);
        hier_expand(&h, rf->agent, feature, -1, agent, sizeof agent);
        hier_expand(&h, rf->branch, feature, -1, branch, sizeof branch);
        hier_expand(&h, rf->base, feature, -1, base, sizeof base);
        char basecol[540];
        snprintf(basecol, sizeof basecol, "← %s", base);
        sb_printf(&b, "\n%-9s %-20s %-28s %-24s live: ", "feature", agent,
                  branch, basecol);
        live_names(live, nlive, "feature", -1, &b, false);
        sb_putc(&b, '\n');
    }
    long lastw = -1;
    int nw = 0;
    for (int i = 0; i < nt; i++) {
        long w = tasks[i].wave;
        if (w != lastw) {
            hier_expand(&h, rw->agent, feature, w, agent, sizeof agent);
            hier_expand(&h, rw->branch, feature, w, branch, sizeof branch);
            hier_expand(&h, rw->base, feature, w, base, sizeof base);
            if (json) {
                if (nw) sb_puts(&b, "]}");
                if (nw++) sb_putc(&b, ',');
                sb_printf(&b, "{\"wave\":%ld,\"agent\":", w);
                sb_json_str(&b, agent);
                sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
                sb_puts(&b, ",\"base\":"); sb_json_str(&b, base);
                sb_puts(&b, ",\"live\":[");
                live_names(live, nlive, "worker", w, &b, true);
                sb_puts(&b, "],\"tasks\":[");
            } else {
                char wl[24], basecol[540];
                snprintf(wl, sizeof wl, "wave %ld", w);
                snprintf(basecol, sizeof basecol, "← %s", base);
                sb_printf(&b, "%-9s %-20s %-28s %-24s live: ", wl, agent,
                          branch, basecol);
                live_names(live, nlive, "worker", w, &b, false);
                sb_putc(&b, '\n');
                nw++;
            }
            lastw = w;
        }
        if (json) {
            const char *prev = b.p + b.len - 1;
            if (*prev != '[') sb_putc(&b, ',');
            sb_puts(&b, "{\"id\":");      sb_json_str(&b, tasks[i].id);
            sb_puts(&b, ",\"status\":");  sb_json_str(&b, tasks[i].status);
            sb_puts(&b, ",\"title\":");   sb_json_str(&b, tasks[i].title);
            sb_putc(&b, '}');
        } else {
            sb_printf(&b, "          %-8s %-12s %s\n", tasks[i].id,
                      tasks[i].status, tasks[i].title);
        }
    }
    if (json) {
        if (nw) sb_puts(&b, "]}");
        sb_puts(&b, "]}\n");
    } else if (!nt) {
        sb_puts(&b, "no tasks with a wave\n");
    }
    fputs(b.p, stdout);
    sb_free(&b);
    for (int i = 0; i < nlive; i++) { free(live[i].agent); free(live[i].role); }
    free(live);
    for (int i = 0; i < nt; i++) {
        free(tasks[i].id); free(tasks[i].title); free(tasks[i].status);
    }
    free(tasks);
    for (int i = 0; i < nids; i++) free(ids[i]);
    free(ids);
    kvx_free(f);
    free(feature);
    hier_free(&h);
    kvx_free(wf);
    return 0;
}

/* ---------------- dispatch ---------------- */

int cmd_fleet(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc >= 3 ? argv[2] : "status";
    const char *feature = NULL;
    for (int i = 3; i < argc; i++) {
        if (strcmp(argv[i], "-f") == 0 && i + 1 < argc) feature = argv[++i];
    }
    if (strcmp(sub, "roles") == 0) return fleet_roles(cg, json);
    if (strcmp(sub, "status") == 0) return fleet_status(cg, json);
    if (strcmp(sub, "plan") == 0) return fleet_plan(cg, feature, json);
    fprintf(stderr, "usage: cg fleet roles | status | plan [-f <feature>]\n");
    return 1;
}
