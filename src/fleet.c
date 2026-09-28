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
 * reads to know what its subtree is doing — and the branch lifecycle
 * itself: begin (worktree + claim), merge-up, land behind the gates, the
 * pull request, and the checkpoint. The two-level orchestrator builds on
 * all of it. */
#include "cg.h"
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
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

long hier_duration(const char *s) {
    if (!s) return -1;
    while (*s == ' ') s++;
    if (!*s) return -1;
    char *end = NULL;
    double v = strtod(s, &end);
    if (end == s || v < 0) return -1;
    while (*end == ' ') end++;
    long mul = 1;
    if (*end == 's') { mul = 1; end++; }
    else if (*end == 'm') { mul = 60; end++; }
    else if (*end == 'h') { mul = 3600; end++; }
    else if (*end == 'd') { mul = 86400; end++; }
    while (*end == ' ') end++;
    return *end ? -1 : (long)(v * mul + 0.5);
}

static void hier_problem(Hierarchy *h, const char *fmt, const char *role,
                         const char *key, const char *value) {
    if (h->nproblems >= (int)(sizeof h->problems / sizeof h->problems[0]))
        return;
    char buf[400];
    snprintf(buf, sizeof buf, fmt, role, key, value);
    h->problems[h->nproblems++] = xstrdup(buf);
}

static const struct { const char *name; unsigned bit; } APPROVALS[] = {
    { "land", APPROVE_LAND }, { "pr", APPROVE_PR },
    { "retry", APPROVE_RETRY }, { "drift", APPROVE_DRIFT },
};

/* the raw scalar, as written: numbers come back without quotes */
static char *cap_raw(const Kvx *wf, const char *sec, const char *key) {
    const char *raw = kvx_raw(wf, sec, key);
    if (!raw) return NULL;
    size_t n = strlen(raw);
    if (n >= 2 && raw[0] == '"' && raw[n - 1] == '"') {
        char *o = xmalloc(n - 1);
        memcpy(o, raw + 1, n - 2);
        o[n - 2] = 0;
        return o;
    }
    return xstrdup(raw);
}

static void cap_duration(Hierarchy *h, const Kvx *wf, const char *sec,
                         const char *role, const char *key, long *slot) {
    char *v = cap_raw(wf, sec, key);
    if (!v) return;
    long d = hier_duration(v);
    if (d < 0) hier_problem(h, "[role.%s] %s = \"%s\" is not a duration "
                               "(90s, 30m, 2h, or seconds) — default kept",
                            role, key, v);
    else *slot = d;
    free(v);
}

static void cap_count(Hierarchy *h, const Kvx *wf, const char *sec,
                      const char *role, const char *key, long floor,
                      long *slot) {
    char *v = cap_raw(wf, sec, key);
    if (!v) return;
    char *end = NULL;
    long n = strtol(v, &end, 10);
    if (end == v || *end || n < floor)
        hier_problem(h, "[role.%s] %s = \"%s\" is not a usable count — "
                        "default kept", role, key, v);
    else *slot = n;
    free(v);
}

/* Defaults first, from [agents] where it says anything, then [role.*].
 * A multi-day run must never inherit "unlimited" by accident, so every
 * role gets a wall-clock and retry budget unless the workflow says 0. */
void hier_role_caps(const Kvx *wf, Hierarchy *h) {
    char *driver = wf ? kvx_str(wf, "agents", "driver") : NULL;
    long wmax = wf ? kvx_long(wf, "agents", "max", 2) : 2;
    if (wmax < 1) wmax = 1;
    static const long MAXES[FLEET_ROLES]   = { 1, 2, 0 };
    static const long WALLS[FLEET_ROLES]   = { 3600, 3600, 7200 };
    static const long RETRIES[FLEET_ROLES] = { 0, 1, 2 };
    static const long STALLS[FLEET_ROLES]  = { 1800, 1800, 900 };
    for (int r = 0; r < FLEET_ROLES; r++) {
        RoleCaps *c = &h->roles[r].caps;
        const char *name = ROLE_NAMES[r];
        char sec[64];
        snprintf(sec, sizeof sec, "role.%s", name);
        c->driver = xstrdup(driver && driver[0] ? driver : "codex");
        if (wf) take_str(&c->driver, wf, sec, "driver");
        if (strcmp(c->driver, "codex") && strcmp(c->driver, "claude") &&
            strcmp(c->driver, "custom")) {
            hier_problem(h, "[role.%s] %s = \"%s\" is not codex, claude, or "
                            "custom — using codex", name, "driver", c->driver);
            free(c->driver);
            c->driver = xstrdup("codex");
        }
        c->model = xstrdup("");
        if (wf) take_str(&c->model, wf, sec, "model");
        char akey[64];
        snprintf(akey, sizeof akey, "%s_args", c->driver);
        c->args = wf ? kvx_str(wf, "agents", akey) : NULL;
        if (!c->args) c->args = xstrdup("");
        if (wf) take_str(&c->args, wf, sec, "args");
        c->max = MAXES[r] ? MAXES[r] : wmax;
        c->wall = WALLS[r];
        c->retries = RETRIES[r];
        c->stall = STALLS[r];
        c->spend = 0;
        c->approve = 0;
        if (!wf) continue;
        cap_count(h, wf, sec, name, "max", 1, &c->max);
        cap_count(h, wf, sec, name, "retries", 0, &c->retries);
        cap_duration(h, wf, sec, name, "wall", &c->wall);
        cap_duration(h, wf, sec, name, "stall", &c->stall);
        if (r == FLEET_MAIN && c->max != 1) {
            char given[24];
            snprintf(given, sizeof given, "%ld", c->max);
            hier_problem(h, "[role.%s] %s = \"%s\" — there is one main agent, "
                            "using 1", name, "max", given);
            c->max = 1;
        }
        char *sp = cap_raw(wf, sec, "spend");
        if (sp) {
            const char *p = sp[0] == '$' ? sp + 1 : sp;
            char *end = NULL;
            double v = strtod(p, &end);
            if (end == p || *end || v < 0)
                hier_problem(h, "[role.%s] %s = \"%s\" is not a USD amount — "
                                "no spend limit", name, "spend", sp);
            else c->spend = v;
            free(sp);
        }
        char **ap = NULL;
        int na = kvx_list(wf, sec, "approve", &ap);
        if (na <= 0) {
            /* a single gate may be written as a plain string */
            char *one = kvx_str(wf, sec, "approve");
            if (one && one[0]) { ap = xmalloc(sizeof(char *)); ap[0] = one; na = 1; }
            else free(one);
        }
        for (int i = 0; i < na; i++) {
            bool known = false;
            for (size_t k = 0; k < sizeof APPROVALS / sizeof *APPROVALS; k++)
                if (strcmp(ap[i], APPROVALS[k].name) == 0) {
                    c->approve |= APPROVALS[k].bit;
                    known = true;
                }
            if (!known)
                hier_problem(h, "[role.%s] %s gate \"%s\" is not land, pr, "
                                "retry, or drift — ignored", name, "approve",
                             ap[i]);
            free(ap[i]);
        }
        free(ap);
    }
    free(driver);
}

/* Read [hierarchy] and [role.main|feature|worker] over the built-in
 * defaults, so a workflow that names only what differs still gets a whole
 * tree. Returns whether the hierarchy is enabled: a missing section means
 * this repository runs flat, and the fleet commands then show the defaults
 * they would use. wf may be NULL (no workflow file at all). */
bool hier_load(const Kvx *wf, Hierarchy *h) {
    hier_defaults(h);
    hier_role_caps(wf, h);
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
    h->main_agent = kvx_bool(wf, "hierarchy", "main_agent", false);
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
        free(h->roles[r].caps.driver); free(h->roles[r].caps.model);
        free(h->roles[r].caps.args);
    }
    for (int i = 0; i < h->nunknown; i++) free(h->unknown[i]);
    for (int i = 0; i < h->nproblems; i++) free(h->problems[i]);
    memset(h, 0, sizeof *h);
}

void hier_expand(const Hierarchy *h, const char *tmpl, const char *feature,
                 long wave, char *out, size_t cap) {
    hier_expand_task(h, tmpl, feature, wave, NULL, out, cap);
}

bool hier_per_task(const Hierarchy *h) {
    return strstr(h->roles[FLEET_WORKER].branch, "{task}") != NULL;
}

/* Expand {main}, {remote}, {feature}, {wave}, and {task} in a role
 * template. A wave below zero expands to nothing, so a feature-level
 * template never grows a stray number; {task} likewise without a task.
 * Unknown braces are copied through. */
void hier_expand_task(const Hierarchy *h, const char *tmpl, const char *feature,
                      long wave, const char *task, char *out, size_t cap) {
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
        } else if (strncmp(p, "{task}", 6) == 0) {
            rep = task ? task : ""; skip = 6;
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

/* ---------------- approval gates ---------------- */

static unsigned gate_bit(const char *gate) {
    for (size_t k = 0; k < sizeof APPROVALS / sizeof *APPROVALS; k++)
        if (strcmp(gate, APPROVALS[k].name) == 0) return APPROVALS[k].bit;
    return 0;
}

static void approval_event(Cg *cg, const char *kind, long id, const char *gate,
                           const char *subject, const char *state,
                           const char *by, const char *note) {
    StrBuf p; sb_init(&p);
    sb_printf(&p, "{\"id\":%ld,\"gate\":", id);
    sb_json_str(&p, gate);
    sb_puts(&p, ",\"subject\":"); sb_json_str(&p, subject);
    sb_puts(&p, ",\"state\":"); sb_json_str(&p, state);
    sb_puts(&p, ",\"by\":");
    if (by) sb_json_str(&p, by); else sb_puts(&p, "null");
    sb_puts(&p, ",\"note\":");
    if (note) sb_json_str(&p, note); else sb_puts(&p, "null");
    sb_putc(&p, '}');
    char subj[400];
    snprintf(subj, sizeof subj, "%s:%s", gate, subject);
    events_emit(cg, kind, subj, p.p);
    sb_free(&p);
}

/* One approval covers one attempt: an approved gate is consumed by the
 * land or pr it let through, so a land retried after red gates asks again
 * rather than riding an approval given for different code. */
int fleet_gate(Cg *cg, const char *gate, const char *subject) {
    const char *role = getenv("CG_ROLE");
    if (!role || !role[0]) return 0;
    unsigned bit = gate_bit(gate);
    char path[4700];
    Kvx *wf = fleet_workflow(cg, path, sizeof path);
    Hierarchy h;
    hier_load(wf, &h);
    unsigned want = 0;
    for (int r = 0; r < FLEET_ROLES; r++) want |= h.roles[r].caps.approve;
    hier_free(&h);
    kvx_free(wf);
    if (!bit || !(want & bit)) return 0;

    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id,state,ifnull(decided_by,''),ifnull(note,'') FROM "
        "fleet_approvals WHERE gate=? AND subject=? AND state IN "
        "('pending','approved','rejected') ORDER BY id DESC LIMIT 1");
    sqlite3_bind_text(st, 1, gate, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, subject, -1, SQLITE_TRANSIENT);
    long id = 0;
    char state[16] = "", by[128] = "", note[512] = "";
    if (sqlite3_step(st) == SQLITE_ROW) {
        id = sqlite3_column_int64(st, 0);
        snprintf(state, sizeof state, "%s", (const char *)sqlite3_column_text(st, 1));
        snprintf(by, sizeof by, "%s", (const char *)sqlite3_column_text(st, 2));
        snprintf(note, sizeof note, "%s", (const char *)sqlite3_column_text(st, 3));
    }
    sqlite3_finalize(st);
    if (!strcmp(state, "approved")) {
        sqlite3_stmt *u = cg_prep(cg, "UPDATE fleet_approvals SET state='used' "
                                      "WHERE id=?");
        sqlite3_bind_int64(u, 1, id);
        sqlite3_step(u);
        sqlite3_finalize(u);
        fprintf(stderr, "cg fleet: %s of %s approved%s%s (#%ld)\n", gate,
                subject, by[0] ? " by " : "", by, id);
        return 0;
    }
    if (!strcmp(state, "rejected")) {
        fprintf(stderr, "cg fleet: %s of %s was rejected%s%s (#%ld)%s%s — stop "
                "and report to your parent\n", gate, subject, by[0] ? " by " : "",
                by, id, note[0] ? ": " : "", note);
        return 1;
    }
    if (!id) {
        const char *agent = getenv("CG_AGENT");
        sqlite3_stmt *ins = cg_prep(cg,
            "INSERT INTO fleet_approvals(run,gate,subject,state,requested,"
            "requested_by) VALUES(?,?,?,'pending',?,?)");
        const char *run = getenv("CG_RUN");
        if (run && run[0]) sqlite3_bind_text(ins, 1, run, -1, SQLITE_TRANSIENT);
        else sqlite3_bind_null(ins, 1);
        sqlite3_bind_text(ins, 2, gate, -1, SQLITE_TRANSIENT);
        sqlite3_bind_text(ins, 3, subject, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(ins, 4, (long)time(NULL));
        if (agent) sqlite3_bind_text(ins, 5, agent, -1, SQLITE_TRANSIENT);
        else sqlite3_bind_null(ins, 5);
        sqlite3_step(ins);
        sqlite3_finalize(ins);
        id = (long)sqlite3_last_insert_rowid(cg->db);
        approval_event(cg, "approval.request", id, gate, subject, "pending",
                       agent, NULL);
    }
    fprintf(stderr, "cg fleet: %s of %s waits for approval #%ld — a person runs "
            "`cg fleet approve %ld` (or --reject); exit now and it is retried "
            "on your next wake\n", gate, subject, id, id);
    return CG_EXIT_APPROVAL;
}

int cmd_fleet_approvals(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc >= 3 ? argv[2] : "approvals";
    if (strcmp(sub, "approve") == 0) {
        long id = argc >= 4 ? atol(argv[3]) : 0;
        bool reject = false;
        const char *note = NULL;
        for (int i = 4; i < argc; i++) {
            if (strcmp(argv[i], "--reject") == 0) reject = true;
            else if (strcmp(argv[i], "-m") == 0 && i + 1 < argc) note = argv[++i];
        }
        if (id <= 0) {
            fprintf(stderr, "usage: cg fleet approve <id> [--reject] [-m note]\n");
            return 1;
        }
        sqlite3_stmt *q = cg_prep(cg, "SELECT gate,subject,state FROM "
                                      "fleet_approvals WHERE id=?");
        sqlite3_bind_int64(q, 1, id);
        char gate[32] = "", subject[300] = "", state[16] = "";
        if (sqlite3_step(q) == SQLITE_ROW) {
            snprintf(gate, sizeof gate, "%s", (const char *)sqlite3_column_text(q, 0));
            snprintf(subject, sizeof subject, "%s", (const char *)sqlite3_column_text(q, 1));
            snprintf(state, sizeof state, "%s", (const char *)sqlite3_column_text(q, 2));
        }
        sqlite3_finalize(q);
        if (!gate[0]) {
            fprintf(stderr, "cg fleet: no approval #%ld\n", id);
            return 1;
        }
        if (!strcmp(state, "used")) {
            fprintf(stderr, "cg fleet: approval #%ld was already used\n", id);
            return 1;
        }
        const char *by = getenv("CG_AGENT");
        if (!by || !by[0]) by = getenv("USER");
        const char *to = reject ? "rejected" : "approved";
        sqlite3_stmt *u = cg_prep(cg,
            "UPDATE fleet_approvals SET state=?,decided=?,decided_by=?,note=? "
            "WHERE id=?");
        sqlite3_bind_text(u, 1, to, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(u, 2, (long)time(NULL));
        if (by) sqlite3_bind_text(u, 3, by, -1, SQLITE_TRANSIENT);
        else sqlite3_bind_null(u, 3);
        if (note) sqlite3_bind_text(u, 4, note, -1, SQLITE_TRANSIENT);
        else sqlite3_bind_null(u, 4);
        sqlite3_bind_int64(u, 5, id);
        sqlite3_step(u);
        sqlite3_finalize(u);
        approval_event(cg, "approval.decided", id, gate, subject, to, by, note);
        if (json) printf("{\"id\":%ld,\"state\":\"%s\"}\n", id, to);
        else printf("%s #%ld — %s of %s\n", to, id, gate, subject);
        return 0;
    }
    bool all = false;
    for (int i = 3; i < argc; i++) if (strcmp(argv[i], "--all") == 0) all = true;
    sqlite3_stmt *st = cg_prep(cg, all
        ? "SELECT id,gate,subject,state,ifnull(requested_by,''),requested,"
          "ifnull(decided_by,''),ifnull(note,''),ifnull(run,'') FROM "
          "fleet_approvals ORDER BY id DESC LIMIT 50"
        : "SELECT id,gate,subject,state,ifnull(requested_by,''),requested,"
          "ifnull(decided_by,''),ifnull(note,''),ifnull(run,'') FROM "
          "fleet_approvals WHERE state='pending' ORDER BY id");
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"approvals\":[");
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
#define C(i) ((const char *)sqlite3_column_text(st, i))
        if (json) {
            if (n) sb_putc(&b, ',');
            sb_printf(&b, "{\"id\":%lld,\"gate\":", (long long)sqlite3_column_int64(st, 0));
            sb_json_str(&b, C(1));
            sb_puts(&b, ",\"subject\":"); sb_json_str(&b, C(2));
            sb_puts(&b, ",\"state\":"); sb_json_str(&b, C(3));
            sb_puts(&b, ",\"requested_by\":"); sb_json_str(&b, C(4));
            sb_printf(&b, ",\"requested\":%lld,\"decided_by\":",
                      (long long)sqlite3_column_int64(st, 5));
            sb_json_str(&b, C(6));
            sb_puts(&b, ",\"note\":"); sb_json_str(&b, C(7));
            sb_puts(&b, ",\"run\":"); sb_json_str(&b, C(8));
            sb_putc(&b, '}');
        } else {
            sb_printf(&b, "#%-4lld %-6s %-24s %-9s requested by %s%s%s\n",
                      (long long)sqlite3_column_int64(st, 0), C(1), C(2), C(3),
                      C(4)[0] ? C(4) : "?", C(6)[0] ? ", decided by " : "",
                      C(6));
        }
#undef C
        n++;
    }
    sqlite3_finalize(st);
    if (json) sb_puts(&b, "]}\n");
    else if (!n) sb_puts(&b, all ? "no approvals recorded\n"
                                 : "nothing waits for approval\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}

/* ---------------- cg fleet roles ---------------- */

/* 7200 -> "2h", 90 -> "90s", 0 -> "—" */
static void fmt_secs(long s, char *out, size_t cap) {
    if (s <= 0) snprintf(out, cap, "—");
    else if (s % 86400 == 0) snprintf(out, cap, "%ldd", s / 86400);
    else if (s % 3600 == 0) snprintf(out, cap, "%ldh", s / 3600);
    else if (s % 60 == 0) snprintf(out, cap, "%ldm", s / 60);
    else snprintf(out, cap, "%lds", s);
}

static void approvals(unsigned bits, char *out, size_t cap, const char *sep) {
    size_t o = 0;
    out[0] = 0;
    for (size_t k = 0; k < sizeof APPROVALS / sizeof *APPROVALS; k++) {
        if (!(bits & APPROVALS[k].bit)) continue;
        int n = snprintf(out + o, cap - o, "%s%s", o ? sep : "",
                         APPROVALS[k].name);
        if (n < 0 || (size_t)n >= cap - o) break;
        o += (size_t)n;
    }
}

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
            const RoleCaps *c = &h.roles[r].caps;
            sb_puts(&b, ",\"caps\":{\"driver\":"); sb_json_str(&b, c->driver);
            sb_puts(&b, ",\"model\":");  sb_json_str(&b, c->model);
            sb_puts(&b, ",\"args\":");   sb_json_str(&b, c->args);
            sb_printf(&b, ",\"max\":%ld,\"wall_s\":%ld,\"spend_usd\":%.2f,"
                          "\"retries\":%ld,\"stall_s\":%ld,\"approve\":[",
                      c->max, c->wall, c->spend, c->retries, c->stall);
            char appr[64];
            approvals(c->approve, appr, sizeof appr, "\",\"");
            if (appr[0]) sb_printf(&b, "\"%s\"", appr);
            sb_puts(&b, "]}}");
        }
        sb_puts(&b, "],\"unknown_roles\":[");
        for (int i = 0; i < h.nunknown; i++) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, h.unknown[i]);
        }
        sb_puts(&b, "],\"problems\":[");
        for (int i = 0; i < h.nproblems; i++) {
            if (i) sb_putc(&b, ',');
            sb_json_str(&b, h.problems[i]);
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
        printf("\n%-8s %-7s %-14s %4s %6s %8s %8s %6s  %s\n", "role",
               "driver", "model", "max", "wall", "spend", "retries", "stall",
               "approve");
        for (int r = 0; r < FLEET_ROLES; r++) {
            const RoleCaps *c = &h.roles[r].caps;
            char wall[32], stall[32], spend[32], appr[64] = "";
            fmt_secs(c->wall, wall, sizeof wall);
            fmt_secs(c->stall, stall, sizeof stall);
            if (c->spend > 0) snprintf(spend, sizeof spend, "$%.2f", c->spend);
            else snprintf(spend, sizeof spend, "—");
            approvals(c->approve, appr, sizeof appr, ",");
            printf("%-8s %-7s %-14s %4ld %6s %8s %8ld %6s  %s\n",
                   h.roles[r].name, c->driver, c->model[0] ? c->model : "—",
                   c->max, wall, spend, c->retries, stall,
                   appr[0] ? appr : "—");
        }
        for (int r = 0; r < FLEET_ROLES; r++)
            if (h.roles[r].caps.args[0])
                printf("args %-8s %s\n", h.roles[r].name, h.roles[r].caps.args);
        for (int i = 0; i < h.nunknown; i++)
            printf("warn: [role.%s] is not main, feature, or worker — "
                   "ignored\n", h.unknown[i]);
        for (int i = 0; i < h.nproblems; i++)
            printf("warn: %s\n", h.problems[i]);
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

/* ---------------- branch lifecycle ---------------- */

/* Every lifecycle command works on the shared project (the main worktree):
 * that is where spec/ is authoritative, where worktrees are cut from, and
 * where main lives. A worker may run these from its own worktree; the
 * branch it is on is irrelevant to what they do. */
typedef struct {
    Kvx *wf;
    Hierarchy h;
    char *feature;
    char wfpath[4700];
    char specpath[4700];       /* spec/<feature>/spec.kvx on the main tree */
    const char *tree;          /* cg->shared */
    int gates_ok;              /* 1 green in this command, -1 not run here */
    int merge_fd;              /* the feature's merge lock while held; else -1 */
} Lifecycle;

static void lifecycle_close(Lifecycle *c) {
    fleet_merge_unlock(c->merge_fd);
    c->merge_fd = -1;
    free(c->feature);
    hier_free(&c->h);
    kvx_free(c->wf);
}

int fleet_merge_lock(const char *shared, const char *feature, long wait_ms) {
    char dir[4600], path[4800];
    snprintf(dir, sizeof dir, "%s/%s/fleet", shared, CG_DIR);
    mkdirs(dir);
    snprintf(path, sizeof path, "%s/merge-%s.lock", dir, feature);
    int fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (fd < 0) return -1;
    long waited = 0;
    while (flock(fd, LOCK_EX | LOCK_NB) != 0) {
        if (waited >= wait_ms) { close(fd); return -1; }
        struct timespec ts = { 0, 50 * 1000 * 1000 };
        nanosleep(&ts, NULL);
        waited += 50;
    }
    return fd;
}

void fleet_merge_unlock(int fd) {
    if (fd < 0) return;
    flock(fd, LOCK_UN);
    close(fd);
}

/* take the feature's merge lock for the rest of this lifecycle command */
static int lifecycle_merge_lock(Lifecycle *c) {
    const char *env = getenv("CG_MERGE_LOCK_WAIT_MS");
    long wait = env && env[0] ? atol(env) : 120000;
    c->merge_fd = fleet_merge_lock(c->tree, c->feature, wait);
    if (c->merge_fd >= 0) return 0;
    fprintf(stderr, "cg fleet: another merge into %s's branch held the lock "
            "for %lds — retry when it is done\n", c->feature, wait / 1000);
    return 1;
}

static int lifecycle_open(Cg *cg, const char *feature_ov, Lifecycle *c) {
    memset(c, 0, sizeof *c);
    c->tree = cg->shared;
    c->gates_ok = -1;
    c->merge_fd = -1;
    snprintf(c->wfpath, sizeof c->wfpath, "%s/spec/workflow.kvx", c->tree);
    c->wf = kvx_parse(c->wfpath);
    if (!c->wf) {
        fprintf(stderr, "cg fleet: no spec/workflow.kvx at %s\n", c->tree);
        return 1;
    }
    hier_load(c->wf, &c->h);
    /* an agent's own feature (CG_FEATURE) before the workflow's active
     * one: several features run at once under one supervisor */
    const char *env_feature = getenv("CG_FEATURE");
    if (!feature_ov && env_feature && env_feature[0]) {
        char p[4700];
        struct stat est;
        snprintf(p, sizeof p, "%s/spec/%s/spec.kvx", c->tree, env_feature);
        if (stat(p, &est) == 0) feature_ov = env_feature;
    }
    c->feature = feature_ov ? xstrdup(feature_ov)
                            : kvx_str(c->wf, "meta", "active_feature");
    if (!c->feature || !c->feature[0]) {
        fprintf(stderr, "cg fleet: no active_feature in %s (use -f)\n",
                c->wfpath);
        lifecycle_close(c);
        return 1;
    }
    snprintf(c->specpath, sizeof c->specpath, "%s/spec/%s/spec.kvx", c->tree,
             c->feature);
    if (!git_available(cg)) {
        fprintf(stderr, "cg fleet: %s has no git repository — the branch "
                        "lifecycle needs git\n", c->tree);
        lifecycle_close(c);
        return 1;
    }
    return 0;
}

/* a branch's worktree: <worktrees>/<branch with / as ->, under the main
 * tree unless the configured root is absolute */
static void worktree_path(const Lifecycle *c, const char *branch, char *out,
                          size_t cap) {
    char name[512];
    size_t i = 0;
    for (const char *p = branch; *p && i + 1 < sizeof name; p++)
        name[i++] = *p == '/' ? '-' : *p;
    name[i] = 0;
    if (c->h.worktrees[0] == '/')
        snprintf(out, cap, "%s/%s", c->h.worktrees, name);
    else
        snprintf(out, cap, "%s/%s/%s", c->tree, c->h.worktrees, name);
}

/* wave and status of [task.<id>] in one spec file; false when absent or
 * a heading. status defaults to pending like the rest of the workflow. */
static bool task_wave_status(const char *specpath, const char *id, long *wave,
                             char *status, size_t cap) {
    Kvx *f = kvx_parse(specpath);
    if (!f) return false;
    char sec[300];
    snprintf(sec, sizeof sec, "task.%s", id);
    bool ok = kvx_raw(f, sec, "wave") != NULL;
    if (ok) {
        *wave = kvx_long(f, sec, "wave", 0);
        char *st = kvx_str(f, sec, "status");
        snprintf(status, cap, "%s", st && st[0] ? st : "pending");
        free(st);
    }
    kvx_free(f);
    return ok;
}

/* the status of a task as committed on <branch>: the tip's spec file,
 * not the main tree's — a worker qualifies on its own branch */
static bool task_status_on_branch(const Lifecycle *c, const char *branch,
                                  const char *id, char *status, size_t cap) {
    StrBuf a; sb_init(&a);
    StrBuf spec; sb_init(&spec);
    sb_printf(&spec, "%s:spec/%s/spec.kvx", branch, c->feature);
    sb_puts(&a, "show ");
    sb_shquote(&a, spec.p);
    sb_free(&spec);
    StrBuf out; sb_init(&out);
    int rc = git_run(c->tree, a.p, &out);
    sb_free(&a);
    if (rc != 0) { sb_free(&out); return false; }
    char dir[4700], tmp[4800];
    snprintf(dir, sizeof dir, "%s/%s/fleet", c->tree, CG_DIR);
    mkdirs(dir);
    snprintf(tmp, sizeof tmp, "%s/tip-%ld.kvx", dir, (long)getpid());
    bool ok = write_entire_file(tmp, out.p, out.len) == 0;
    sb_free(&out);
    long wave;
    if (ok) ok = task_wave_status(tmp, id, &wave, status, cap);
    unlink(tmp);
    return ok;
}

static bool tree_clean(const char *tree) {
    StrBuf o; sb_init(&o);
    int rc = git_run(tree, "status --porcelain --untracked-files=no", &o);
    bool clean = rc == 0 && o.len == 0;
    sb_free(&o);
    return clean;
}

static long commits_between(const char *tree, const char *base,
                            const char *branch) {
    StrBuf a; sb_init(&a);
    StrBuf range; sb_init(&range);
    sb_printf(&range, "%s..%s", base, branch);
    sb_puts(&a, "rev-list --count ");
    sb_shquote(&a, range.p);
    sb_free(&range);
    StrBuf o; sb_init(&o);
    int rc = git_run(tree, a.p, &o);
    sb_free(&a);
    long n = rc == 0 ? atol(o.p) : -1;
    sb_free(&o);
    return n;
}

/* create <branch> at <from> without checking it out; false on failure */
static bool ensure_branch(const char *tree, const char *branch,
                          const char *from, bool *created, StrBuf *err) {
    *created = false;
    if (git_branch_exists(tree, branch)) return true;
    StrBuf a; sb_init(&a);
    sb_puts(&a, "branch ");
    sb_shquote(&a, branch);
    sb_putc(&a, ' ');
    sb_shquote(&a, from);
    int rc = git_run(tree, a.p, err);
    sb_free(&a);
    *created = rc == 0;
    return rc == 0;
}

/* one-line excerpt of git's complaint for an error message */
static void excerpt(const StrBuf *b, char *out, size_t cap) {
    size_t n = 0;
    for (const char *p = b->p; p && *p && n + 1 < cap; p++) {
        if (*p == '\n') { if (n && out[n - 1] != ' ') out[n++] = ' '; }
        else out[n++] = *p;
    }
    while (n && out[n - 1] == ' ') n--;
    out[n] = 0;
}

static void json_str_or_null(StrBuf *b, const char *s) {
    if (s && s[0]) sb_json_str(b, s); else sb_puts(b, "null");
}

static void put_conflicts(StrBuf *b, char **paths, int n, bool json) {
    if (json) {
        sb_puts(b, ",\"conflicts\":[");
        for (int i = 0; i < n; i++) {
            if (i) sb_putc(b, ',');
            sb_json_str(b, paths[i]);
        }
        sb_putc(b, ']');
    } else {
        sb_printf(b, "conflicts in %d path(s):\n", n);
        for (int i = 0; i < n; i++) sb_printf(b, "  %s\n", paths[i]);
    }
}

static void free_list(char **v, int n) {
    for (int i = 0; i < n; i++) free(v[i]);
    free(v);
}

/* payload is a StrBuf holding the object's members without braces */
static void fleet_event(Cg *cg, const char *kind, const char *subject,
                        StrBuf *members) {
    StrBuf p; sb_init(&p);
    sb_printf(&p, "{%s}", members->p ? members->p : "");
    events_emit(cg, kind, subject, p.p);
    sb_free(&p);
    sb_free(members);
}

static void ev_str(StrBuf *b, const char *key, const char *v) {
    sb_printf(b, "%s\"%s\":", b->len ? "," : "", key);
    if (v) sb_json_str(b, v); else sb_puts(b, "null");
}

static void ev_long(StrBuf *b, const char *key, long v) {
    sb_printf(b, "%s\"%s\":%ld", b->len ? "," : "", key, v);
}

/* cg fleet begin <id>: the worker's branch and worktree, then its claim.
 * Idempotent — a second begin reuses both and renews the claim, so a
 * manager can hand the same task to a replacement worker. */
int fleet_worker_begin(Cg *cg, const char *id, const char *feature_ov,
                       const char *agent_flag, bool json) {
    Lifecycle c;
    if (lifecycle_open(cg, feature_ov, &c) != 0) return 1;
    long wave = 0;
    char status[64];
    if (!task_wave_status(c.specpath, id, &wave, status, sizeof status)) {
        fprintf(stderr, "cg fleet: no [task.%s] with a wave in %s\n", id,
                c.specpath);
        lifecycle_close(&c);
        return 1;
    }
    if (strcmp(status, "done") == 0) {
        fprintf(stderr, "cg fleet: %s is done — nothing to begin\n", id);
        lifecycle_close(&c);
        return 1;
    }
    const FleetRole *rw = &c.h.roles[FLEET_WORKER];
    const FleetRole *rf = &c.h.roles[FLEET_FEATURE];
    char agent[256], branch[512], base[512], parent[256];
    if (agent_flag && agent_flag[0]) snprintf(agent, sizeof agent, "%s", agent_flag);
    else hier_expand_task(&c.h, rw->agent, c.feature, wave, id, agent, sizeof agent);
    hier_expand_task(&c.h, rw->branch, c.feature, wave, id, branch, sizeof branch);
    hier_expand_task(&c.h, rw->base, c.feature, wave, id, base, sizeof base);
    hier_expand(&c.h, rf->agent, c.feature, -1, parent, sizeof parent);

    StrBuf err; sb_init(&err);
    bool base_created = false;
    if (!ensure_branch(c.tree, base, c.h.main_branch, &base_created, &err)) {
        char ex[300];
        excerpt(&err, ex, sizeof ex);
        fprintf(stderr, "cg fleet: cannot create %s from %s: %s\n", base,
                c.h.main_branch, ex);
        sb_free(&err); lifecycle_close(&c);
        return 1;
    }
    char path[4800], wtroot[4800];
    worktree_path(&c, branch, path, sizeof path);
    snprintf(wtroot, sizeof wtroot, "%s", path);
    char *slash = strrchr(wtroot, '/');
    if (slash) { *slash = 0; mkdirs(wtroot); }
    bool wt_created = false, br_created = false;
    if (git_worktree_add(c.tree, path, branch, base, &wt_created, &br_created,
                         &err) != 0) {
        char ex[300];
        excerpt(&err, ex, sizeof ex);
        fprintf(stderr, "cg fleet: cannot add worktree %s for %s: %s\n", path,
                branch, ex);
        sb_free(&err); lifecycle_close(&c);
        return 1;
    }
    sb_free(&err);
    char head_branch[256], head[65];
    if (!git_head(path, head_branch, sizeof head_branch, head, sizeof head))
        head[0] = 0;
    branch_register(cg, branch, path, head, base);

    /* the claim carries the worker's identity: the attempt, the agents
     * registry, and the worker's own first commands all see the same names */
    char wavebuf[24];
    snprintf(wavebuf, sizeof wavebuf, "%ld", wave);
    setenv("CG_AGENT", agent, 1);
    setenv("CG_ROLE", "worker", 1);
    setenv("CG_PARENT", parent, 1);
    setenv("CG_FEATURE", c.feature, 1);
    setenv("CG_WAVE", wavebuf, 1);
    SpecAttempt at;
    long ttl = 30;
    if (spec_claim(cg, c.tree, c.feature, id, agent, ttl, &at) != 0) {
        fprintf(stderr, "cg fleet: %s was not claimed — %s and %s stay for "
                        "a retry\n", id, branch, path);
        lifecycle_close(&c);
        return 1;
    }
    char tag[300];
    snprintf(tag, sizeof tag, "%s/%s", c.feature, id);
    spec_attempt_set_branch(cg, tag, branch, path, parent);

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"task\":");        sb_json_str(&b, id);
        sb_puts(&b, ",\"feature\":");     sb_json_str(&b, c.feature);
        sb_printf(&b, ",\"wave\":%ld,\"agent\":", wave);
        sb_json_str(&b, agent);
        sb_puts(&b, ",\"role\":\"worker\",\"parent\":");
        sb_json_str(&b, parent);
        sb_puts(&b, ",\"branch\":");      sb_json_str(&b, branch);
        sb_puts(&b, ",\"base\":");        sb_json_str(&b, base);
        sb_printf(&b, ",\"branch_created\":%s,\"base_created\":%s",
                  br_created ? "true" : "false",
                  base_created ? "true" : "false");
        sb_puts(&b, ",\"worktree\":");    sb_json_str(&b, path);
        sb_printf(&b, ",\"worktree_created\":%s,\"head\":",
                  wt_created ? "true" : "false");
        json_str_or_null(&b, head);
        sb_puts(&b, ",\"attempt\":{\"attempt_id\":");
        sb_json_str(&b, at.attempt_id);
        sb_printf(&b, ",\"fence\":%ld,\"expires_in_min\":%ld}", at.fence, ttl);
        sb_puts(&b, ",\"env\":{\"CG_AGENT\":"); sb_json_str(&b, agent);
        sb_puts(&b, ",\"CG_ROLE\":\"worker\",\"CG_PARENT\":");
        sb_json_str(&b, parent);
        sb_puts(&b, ",\"CG_FEATURE\":"); sb_json_str(&b, c.feature);
        sb_printf(&b, ",\"CG_WAVE\":\"%ld\"}}\n", wave);
    } else {
        sb_printf(&b, "begin %s — wave %ld of %s\n", id, wave, c.feature);
        sb_printf(&b, "  agent:    %s (worker, reports to %s)\n", agent, parent);
        sb_printf(&b, "  branch:   %s from %s (%s)", branch, base,
                  br_created ? "created" : "reused");
        if (base_created) sb_printf(&b, "   [%s cut from %s]", base, c.h.main_branch);
        sb_putc(&b, '\n');
        sb_printf(&b, "  worktree: %s (%s)\n", path,
                  wt_created ? "created" : "reused");
        sb_printf(&b, "  claim:    attempt %.12s, fence %ld, %ld min\n",
                  at.attempt_id, at.fence, ttl);
        sb_printf(&b, "next: cd %s && CG_AGENT=%s CG_ROLE=worker CG_PARENT=%s "
                  "CG_FEATURE=%s CG_WAVE=%ld cg spec start %s\n", path, agent,
                  parent, c.feature, wave, id);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    {
        StrBuf e; sb_init(&e);
        char subj[600];
        snprintf(subj, sizeof subj, "%s/%s", c.feature, id);
        ev_str(&e, "task", id); ev_str(&e, "feature", c.feature);
        ev_long(&e, "wave", wave); ev_str(&e, "agent", agent);
        ev_str(&e, "parent", parent); ev_str(&e, "branch", branch);
        ev_str(&e, "base", base); ev_str(&e, "worktree", path);
        ev_str(&e, "attempt", at.attempt_id); ev_long(&e, "fence", at.fence);
        fleet_event(cg, "fleet.begin", subj, &e);
    }
    lifecycle_close(&c);
    return 0;
}

static void ev_list(StrBuf *b, const char *key, char **v, int n) {
    sb_printf(b, "%s\"%s\":[", b->len ? "," : "", key);
    for (int i = 0; i < n; i++) {
        if (i) sb_putc(b, ',');
        sb_json_str(b, v[i]);
    }
    sb_putc(b, ']');
}

static void merge_event(Cg *cg, const Lifecycle *c, const char *id,
                        const char *outcome, const char *branch,
                        const char *base, const char *head, long commits,
                        char **conflicts, int nconf, int promoted) {
    StrBuf e; sb_init(&e);
    char subj[600];
    snprintf(subj, sizeof subj, "%s/%s", c->feature, id);
    ev_str(&e, "task", id); ev_str(&e, "feature", c->feature);
    ev_str(&e, "outcome", outcome); ev_str(&e, "branch", branch);
    ev_str(&e, "base", base); ev_str(&e, "head", head && head[0] ? head : NULL);
    ev_long(&e, "commits", commits);
    ev_list(&e, "conflicts", conflicts, nconf);
    ev_long(&e, "memories_promoted", promoted);
    fleet_event(cg, "fleet.merge", subj, &e);
}

/* cg fleet merge-up <id>: the wave branch into the feature branch, in the
 * feature manager's worktree. Refused until the branch tip says the task
 * qualified — a merge of unproven work is what the hierarchy exists to
 * prevent. A conflict leaves the feature worktree as it was (or, with
 * --keep, mid-merge for the manager to resolve). On success the wave's
 * memories move up with its code, so the base keeps what was learned. */
int fleet_merge_up(Cg *cg, const char *id, const char *feature_ov, bool force,
                   bool keep, bool json) {
    Lifecycle c;
    if (lifecycle_open(cg, feature_ov, &c) != 0) return 1;
    if (lifecycle_merge_lock(&c) != 0) { lifecycle_close(&c); return 1; }
    long wave = 0;
    char status[64];
    if (!task_wave_status(c.specpath, id, &wave, status, sizeof status)) {
        fprintf(stderr, "cg fleet: no [task.%s] with a wave in %s\n", id,
                c.specpath);
        lifecycle_close(&c);
        return 1;
    }
    const FleetRole *rw = &c.h.roles[FLEET_WORKER];
    char branch[512], base[512];
    hier_expand_task(&c.h, rw->branch, c.feature, wave, id, branch, sizeof branch);
    hier_expand_task(&c.h, rw->base, c.feature, wave, id, base, sizeof base);
    if (!git_branch_exists(c.tree, branch)) {
        fprintf(stderr, "cg fleet: no branch %s for %s — run cg fleet begin "
                        "%s first\n", branch, id, id);
        lifecycle_close(&c);
        return 1;
    }
    char tip[64] = "";
    if (!task_status_on_branch(&c, branch, id, tip, sizeof tip))
        snprintf(tip, sizeof tip, "%s", status);
    if (strcmp(tip, "done") != 0 && !force) {
        fprintf(stderr, "cg fleet: %s is %s on %s, not done — qualify it "
                        "(cg spec done %s) and commit, or --force\n", id, tip,
                branch, id);
        lifecycle_close(&c);
        return 1;
    }

    StrBuf err; sb_init(&err);
    bool base_created = false;
    if (!ensure_branch(c.tree, base, c.h.main_branch, &base_created, &err)) {
        char ex[300];
        excerpt(&err, ex, sizeof ex);
        fprintf(stderr, "cg fleet: cannot create %s: %s\n", base, ex);
        sb_free(&err); lifecycle_close(&c);
        return 1;
    }
    char fpath[4800], wtroot[4800];
    worktree_path(&c, base, fpath, sizeof fpath);
    snprintf(wtroot, sizeof wtroot, "%s", fpath);
    char *slash = strrchr(wtroot, '/');
    if (slash) { *slash = 0; mkdirs(wtroot); }
    bool wt_created = false, br_created = false;
    if (git_worktree_add(c.tree, fpath, base, c.h.main_branch, &wt_created,
                         &br_created, &err) != 0) {
        char ex[300];
        excerpt(&err, ex, sizeof ex);
        fprintf(stderr, "cg fleet: cannot add worktree %s for %s: %s\n", fpath,
                base, ex);
        sb_free(&err); lifecycle_close(&c);
        return 1;
    }
    sb_free(&err);
    char on[256], head[65];
    if (!git_head(fpath, on, sizeof on, head, sizeof head) ||
        strcmp(on, base) != 0) {
        fprintf(stderr, "cg fleet: %s is on %s, not %s — check it out there "
                        "first\n", fpath, on, base);
        lifecycle_close(&c);
        return 1;
    }
    if (!tree_clean(fpath)) {
        fprintf(stderr, "cg fleet: %s has uncommitted changes on %s — commit "
                        "or stash them first\n", fpath, base);
        lifecycle_close(&c);
        return 1;
    }
    {
        /* what the wave changed against what its task declared, before it
         * reaches the feature branch; a person decides only where the
         * workflow asked for it (approve = ["drift"]) */
        char tag[400];
        snprintf(tag, sizeof tag, "%s/%s", c.feature, id);
        StrBuf r; sb_init(&r);
        int nd = drift_spec_check(cg, c.tree, base, branch, tag, branch, true, &r);
        if (nd) {
            drift_print(r.p);
            int gate = fleet_gate(cg, "drift", tag);
            if (gate) { sb_free(&r); lifecycle_close(&c); return gate; }
        }
        sb_free(&r);
    }
    long n = commits_between(c.tree, base, branch);
    StrBuf b; sb_init(&b);
    if (n == 0) {
        if (json) {
            sb_puts(&b, "{\"merged\":false,\"commits\":0,\"branch\":");
            sb_json_str(&b, branch);
            sb_puts(&b, ",\"base\":"); sb_json_str(&b, base);
            sb_puts(&b, ",\"worktree\":"); sb_json_str(&b, fpath);
            sb_puts(&b, ",\"head\":"); json_str_or_null(&b, head);
            sb_puts(&b, "}\n");
        } else
            sb_printf(&b, "nothing to merge: %s already contains %s\n", base,
                      branch);
        fputs(b.p, stdout);
        sb_free(&b);
        merge_event(cg, &c, id, "nothing", branch, base, head, 0, NULL, 0, 0);
        lifecycle_close(&c);
        return 0;
    }
    StrBuf a; sb_init(&a);
    StrBuf msg; sb_init(&msg);
    sb_printf(&msg, "merge %s into %s [spec:%s/%s]", branch, base, c.feature, id);
    sb_puts(&a, "merge --no-ff --no-edit -m ");
    sb_shquote(&a, msg.p);
    sb_putc(&a, ' ');
    sb_shquote(&a, branch);
    sb_free(&msg);
    StrBuf out; sb_init(&out);
    int rc = git_run(fpath, a.p, &out);
    sb_free(&a);
    if (rc != 0) {
        char **paths = NULL;
        int np = git_conflicted_paths(fpath, &paths);
        if (!keep) git_run(fpath, "merge --abort", NULL);
        if (json) {
            sb_puts(&b, "{\"merged\":false,\"branch\":");
            sb_json_str(&b, branch);
            sb_puts(&b, ",\"base\":"); sb_json_str(&b, base);
            sb_puts(&b, ",\"worktree\":"); sb_json_str(&b, fpath);
            put_conflicts(&b, paths, np, true);
            sb_printf(&b, ",\"kept\":%s", keep ? "true" : "false");
            if (!np) {
                sb_puts(&b, ",\"error\":");
                char ex[400];
                excerpt(&out, ex, sizeof ex);
                sb_json_str(&b, ex);
            }
            sb_puts(&b, "}\n");
        } else {
            sb_printf(&b, "cg fleet: %s does not merge into %s\n", branch, base);
            if (np) put_conflicts(&b, paths, np, false);
            else {
                char ex[400];
                excerpt(&out, ex, sizeof ex);
                sb_printf(&b, "  %s\n", ex);
            }
            if (keep)
                sb_printf(&b, "merge left in place at %s — resolve, commit, "
                              "then cg fleet merge-up %s again\n", fpath, id);
            else
                sb_puts(&b, "merge aborted\n");
        }
        fputs(b.p, stdout);
        sb_free(&b); sb_free(&out);
        merge_event(cg, &c, id, "conflict", branch, base, head, n, paths, np,
                    0);
        free_list(paths, np);
        lifecycle_close(&c);
        return 1;
    }
    sb_free(&out);
    git_head(fpath, on, sizeof on, head, sizeof head);
    branch_register(cg, base, fpath, head, c.h.main_branch);
    /* the code moved up; so must what was learned writing it, or the next
     * agent on the base rediscovers it from scratch */
    int promoted = memory_promote_branch(cg, branch, base);
    if (promoted < 0) promoted = 0;
    if (json) {
        sb_printf(&b, "{\"merged\":true,\"commits\":%ld,\"branch\":", n);
        sb_json_str(&b, branch);
        sb_puts(&b, ",\"base\":"); sb_json_str(&b, base);
        sb_puts(&b, ",\"worktree\":"); sb_json_str(&b, fpath);
        sb_puts(&b, ",\"head\":"); json_str_or_null(&b, head);
        sb_printf(&b, ",\"memories_promoted\":%d", promoted);
        sb_puts(&b, "}\n");
    } else {
        sb_printf(&b, "merged %s into %s: %ld commit%s (head %.8s) at %s\n",
                  branch, base, n, n == 1 ? "" : "s", head, fpath);
        if (promoted)
            sb_printf(&b, "  promoted %d memor%s to %s\n", promoted,
                      promoted == 1 ? "y" : "ies", base);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    merge_event(cg, &c, id, "merged", branch, base, head, n, NULL, 0,
                promoted);
    lifecycle_close(&c);
    return 0;
}

/* run one gate in the main tree, its output kept in a log file the
 * refusal message points at. Returns the exit status. */
static int run_gate(const char *tree, const char *cmd, const char *logpath,
                    long *ms) {
    StrBuf c; sb_init(&c);
    sb_puts(&c, "cd ");
    sb_shquote(&c, tree);
    sb_puts(&c, " && (");
    sb_puts(&c, cmd);
    sb_puts(&c, ") 2>&1");
    long t0 = now_ms();
    FILE *f = popen(c.p, "r");
    sb_free(&c);
    if (!f) { *ms = 0; return -1; }
    StrBuf out; sb_init(&out);
    char buf[4097];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf - 1, f)) > 0) {
        buf[n] = 0;
        sb_puts(&out, buf);
    }
    int st = pclose(f);
    *ms = now_ms() - t0;
    write_entire_file(logpath, out.p, out.len);
    sb_free(&out);
    if (st == -1) return -1;
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128;
}

static int pr_open_core(Cg *cg, Lifecycle *c, bool dry_run, StrBuf *jb,
                        bool json);

static void pr_event(Cg *cg, const Lifecycle *c, const char *outcome,
                     const char *branch, const char *url, long number,
                     const char *error) {
    StrBuf e; sb_init(&e);
    ev_str(&e, "feature", c->feature); ev_str(&e, "outcome", outcome);
    ev_str(&e, "branch", branch); ev_str(&e, "base", c->h.main_branch);
    ev_str(&e, "url", url && url[0] ? url : NULL);
    if (number > 0) ev_long(&e, "number", number);
    ev_str(&e, "error", error);
    fleet_event(cg, "fleet.pr", c->feature, &e);
}

static void land_event(Cg *cg, const Lifecycle *c, const char *outcome,
                       const char *branch, const char *head, long commits,
                       char **conflicts, int nconf, const char *red_gate) {
    StrBuf e; sb_init(&e);
    ev_str(&e, "feature", c->feature); ev_str(&e, "outcome", outcome);
    ev_str(&e, "branch", branch); ev_str(&e, "main", c->h.main_branch);
    ev_str(&e, "head", head && head[0] ? head : NULL);
    ev_long(&e, "commits", commits);
    ev_list(&e, "conflicts", conflicts, nconf);
    ev_str(&e, "failed_gate", red_gate);
    fleet_event(cg, "fleet.land", c->feature, &e);
}

/* cg fleet land <feature>: the feature branch into local main, behind the
 * test and lint gates. Red means main is reset to where it was — landing is
 * all or nothing, and a half-landed main is the one state nobody can reason
 * about. Green opens the pull request when the policy says auto, and prints
 * the exact commands when it says manual. */
int fleet_feature_land(Cg *cg, const char *feature_ov, bool no_pr, bool json) {
    Lifecycle c;
    if (lifecycle_open(cg, feature_ov, &c) != 0) return 1;
    if (lifecycle_merge_lock(&c) != 0) { lifecycle_close(&c); return 1; }
    const FleetRole *rf = &c.h.roles[FLEET_FEATURE];
    char branch[512];
    hier_expand(&c.h, rf->branch, c.feature, -1, branch, sizeof branch);
    if (!git_branch_exists(c.tree, branch)) {
        fprintf(stderr, "cg fleet: no branch %s — nothing has been merged up "
                        "for %s yet\n", branch, c.feature);
        lifecycle_close(&c);
        return 1;
    }
    int gate = fleet_gate(cg, "land", c.feature);
    if (gate) { lifecycle_close(&c); return gate; }
    char on[256], pre[65];
    if (!git_head(c.tree, on, sizeof on, pre, sizeof pre) ||
        strcmp(on, c.h.main_branch) != 0) {
        fprintf(stderr, "cg fleet: %s is on %s, not %s — land runs on the "
                        "main worktree checked out at %s\n", c.tree, on,
                c.h.main_branch, c.h.main_branch);
        lifecycle_close(&c);
        return 1;
    }
    if (!tree_clean(c.tree)) {
        fprintf(stderr, "cg fleet: %s has uncommitted changes on %s — commit "
                        "or stash them before landing\n", c.tree, c.h.main_branch);
        lifecycle_close(&c);
        return 1;
    }
    long n = commits_between(c.tree, c.h.main_branch, branch);
    StrBuf b; sb_init(&b);
    if (n == 0) {
        if (json) {
            sb_puts(&b, "{\"landed\":false,\"commits\":0,\"feature\":");
            sb_json_str(&b, c.feature);
            sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
            sb_puts(&b, ",\"main\":"); sb_json_str(&b, c.h.main_branch);
            sb_puts(&b, ",\"head\":"); json_str_or_null(&b, pre);
            sb_puts(&b, "}\n");
        } else
            sb_printf(&b, "nothing to land: %s already contains %s\n",
                      c.h.main_branch, branch);
        fputs(b.p, stdout);
        sb_free(&b);
        land_event(cg, &c, "nothing", branch, pre, 0, NULL, 0, NULL);
        lifecycle_close(&c);
        return 0;
    }
    StrBuf a; sb_init(&a);
    StrBuf msg; sb_init(&msg);
    sb_printf(&msg, "land %s into %s [spec:%s]", branch, c.h.main_branch,
              c.feature);
    sb_puts(&a, "merge --no-ff --no-edit -m ");
    sb_shquote(&a, msg.p);
    sb_putc(&a, ' ');
    sb_shquote(&a, branch);
    sb_free(&msg);
    StrBuf out; sb_init(&out);
    int rc = git_run(c.tree, a.p, &out);
    sb_free(&a);
    if (rc != 0) {
        char **paths = NULL;
        int np = git_conflicted_paths(c.tree, &paths);
        git_run(c.tree, "merge --abort", NULL);
        if (json) {
            sb_puts(&b, "{\"landed\":false,\"feature\":");
            sb_json_str(&b, c.feature);
            sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
            sb_puts(&b, ",\"main\":"); sb_json_str(&b, c.h.main_branch);
            put_conflicts(&b, paths, np, true);
            sb_puts(&b, "}\n");
        } else {
            sb_printf(&b, "cg fleet: %s does not merge into %s\n", branch,
                      c.h.main_branch);
            if (np) put_conflicts(&b, paths, np, false);
            else {
                char ex[400];
                excerpt(&out, ex, sizeof ex);
                sb_printf(&b, "  %s\n", ex);
            }
            sb_puts(&b, "merge aborted\n");
        }
        fputs(b.p, stdout);
        sb_free(&b); sb_free(&out);
        land_event(cg, &c, "conflict", branch, pre, n, paths, np, NULL);
        free_list(paths, np);
        lifecycle_close(&c);
        return 1;
    }
    sb_free(&out);

    /* the gates, in the order the workflow names them: test, then lint */
    char logdir[4700];
    snprintf(logdir, sizeof logdir, "%s/%s/fleet", c.tree, CG_DIR);
    mkdirs(logdir);
    const char *names[2] = { "test", "lint" };
    const char *cmds[2] = { c.h.test_gate, c.h.lint_gate };
    long gate_ms[2] = { 0, 0 };
    int gate_rc[2] = { 0, 0 };
    bool gate_ran[2] = { false, false };
    char logs[2][4800];
    int red = -1;
    for (int g = 0; g < 2 && red < 0; g++) {
        if (!cmds[g] || !cmds[g][0]) { logs[g][0] = 0; continue; }
        snprintf(logs[g], sizeof logs[g], "%s/land-%s-%s.log", logdir,
                 c.feature, names[g]);
        gate_ran[g] = true;
        gate_rc[g] = run_gate(c.tree, cmds[g], logs[g], &gate_ms[g]);
        if (gate_rc[g] != 0) red = g;
        StrBuf e; sb_init(&e);
        ev_str(&e, "feature", c.feature); ev_str(&e, "gate", names[g]);
        ev_str(&e, "cmd", cmds[g]);
        sb_printf(&e, ",\"ok\":%s", gate_rc[g] == 0 ? "true" : "false");
        ev_long(&e, "exit", gate_rc[g]); ev_long(&e, "ms", gate_ms[g]);
        ev_str(&e, "log", logs[g]);
        fleet_event(cg, "fleet.gate", c.feature, &e);
    }
    char head[65];
    if (red >= 0) {
        StrBuf r; sb_init(&r);
        sb_puts(&r, "reset --hard ");
        sb_shquote(&r, pre);
        git_run(c.tree, r.p, NULL);
        sb_free(&r);
    } else {
        c.gates_ok = 1;            /* the pull request may say so */
        git_head(c.tree, on, sizeof on, head, sizeof head);
        branch_register(cg, c.h.main_branch, c.tree, head, NULL);
    }
    if (json) {
        sb_printf(&b, "{\"landed\":%s,\"feature\":", red < 0 ? "true" : "false");
        sb_json_str(&b, c.feature);
        sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
        sb_puts(&b, ",\"main\":"); sb_json_str(&b, c.h.main_branch);
        sb_printf(&b, ",\"commits\":%ld,\"head\":", n);
        json_str_or_null(&b, red < 0 ? head : pre);
        sb_puts(&b, ",\"gates\":{");
        for (int g = 0; g < 2; g++) {
            if (g) sb_putc(&b, ',');
            sb_printf(&b, "\"%s\":", names[g]);
            if (!gate_ran[g]) { sb_puts(&b, "null"); continue; }
            sb_puts(&b, "{\"cmd\":"); sb_json_str(&b, cmds[g]);
            sb_printf(&b, ",\"ok\":%s,\"exit\":%d,\"ms\":%ld,\"log\":",
                      gate_rc[g] == 0 ? "true" : "false", gate_rc[g],
                      gate_ms[g]);
            sb_json_str(&b, logs[g]);
            sb_putc(&b, '}');
        }
        sb_putc(&b, '}');
        if (red >= 0) {
            sb_puts(&b, ",\"reset_to\":"); sb_json_str(&b, pre);
            sb_puts(&b, "}\n");
        }
    } else if (red >= 0) {
        sb_printf(&b, "landing refused: %s gate `%s` failed (exit %d) — %s "
                      "reset to %.8s\n  log: %s\n", names[red], cmds[red],
                  gate_rc[red], c.h.main_branch, pre, logs[red]);
    } else {
        sb_printf(&b, "landed %s into %s: %ld commit%s, gates green (head "
                      "%.8s)\n", branch, c.h.main_branch, n, n == 1 ? "" : "s",
                  head);
        for (int g = 0; g < 2; g++)
            if (gate_ran[g])
                sb_printf(&b, "  %s: `%s` ok in %ld ms\n", names[g], cmds[g],
                          gate_ms[g]);
    }
    fputs(b.p, stdout);
    fflush(stdout);
    sb_free(&b);
    land_event(cg, &c, red >= 0 ? "refused" : "landed", branch,
               red >= 0 ? pre : head, n, NULL, 0, red >= 0 ? names[red] : NULL);
    if (red >= 0) { lifecycle_close(&c); return 1; }

    /* the pull request: opened on green when the policy is auto, printed
     * as commands when it is manual, skipped on --no-pr */
    int rc2 = 0;
    if (json) {
        StrBuf jb; sb_init(&jb);
        if (no_pr) sb_puts(&jb, "null");
        else rc2 = pr_open_core(cg, &c, strcmp(c.h.pr, "auto") != 0, &jb, true);
        printf(",\"pr\":%s}\n", jb.p);
        sb_free(&jb);
    } else if (!no_pr) {
        rc2 = pr_open_core(cg, &c, strcmp(c.h.pr, "auto") != 0, NULL, false);
    }
    lifecycle_close(&c);
    return rc2 == 0 ? 0 : rc2 == CG_EXIT_APPROVAL ? CG_EXIT_APPROVAL : 1;
}

/* gh, when the operator has it: CG_GH names it outright, else PATH */
static bool find_gh(char *out, size_t cap) {
    const char *ov = getenv("CG_GH");
    return cg_find_exe(ov && ov[0] ? ov : "gh", out, cap);
}

/* run `cd <tree> && <cmd>`; output appended to out, exit status returned */
static int run_in(const char *tree, const char *cmd, StrBuf *out) {
    StrBuf c; sb_init(&c);
    sb_puts(&c, "cd ");
    sb_shquote(&c, tree);
    sb_puts(&c, " && ");
    sb_puts(&c, cmd);
    sb_puts(&c, " 2>&1");
    FILE *f = popen(c.p, "r");
    sb_free(&c);
    if (!f) return -1;
    char buf[4097];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf - 1, f)) > 0) {
        buf[n] = 0;
        if (out) sb_puts(out, buf);
    }
    int st = pclose(f);
    if (st == -1) return -1;
    return WIFEXITED(st) ? WEXITSTATUS(st) : 128;
}

/* the pull request body: the feature's title, its task list, and Jev's read
 * on whether the branch is ready, written to .codegraph/fleet so the printed
 * gh command is runnable as-is. With no Jev answer the body simply leaves the
 * readiness line out — it never blocks the pull request */
static void write_pr_body(Cg *cg, const Lifecycle *c, const char *branch,
                          char *title, size_t tcap, char *bodypath,
                          size_t bcap) {
    Kvx *f = kvx_parse(c->specpath);
    char *t = f ? kvx_str(f, "meta", "title") : NULL;
    if (t && t[0]) snprintf(title, tcap, "%s", t);
    else snprintf(title, tcap, "feature/%s", c->feature);
    free(t);
    StrBuf b; sb_init(&b);
    sb_printf(&b, "Feature `%s`, landed on `%s` by Codify with the test and "
                  "lint gates green.\n\n## Tasks\n", c->feature, c->h.main_branch);
    StrBuf tasks; sb_init(&tasks);
    int ntask = 0, ndone = 0;
    if (f) {
        char **ids = NULL;
        int nids = kvx_subsections(f, "task", &ids);
        kvx_sort_dotted(ids, nids);
        for (int i = 0; i < nids; i++) {
            char sec[300];
            snprintf(sec, sizeof sec, "task.%s", ids[i]);
            if (!kvx_raw(f, sec, "wave")) { free(ids[i]); continue; }
            char *tt = kvx_str(f, sec, "title");
            char *st = kvx_str(f, sec, "status");
            const char *status = st && st[0] ? st : "pending";
            sb_printf(&b, "- %s %s (%s)\n", ids[i], tt ? tt : "", status);
            if (ntask) sb_putc(&tasks, ',');
            sb_puts(&tasks, "{\"id\":");
            sb_json_str(&tasks, ids[i]);
            sb_puts(&tasks, ",\"status\":");
            sb_json_str(&tasks, status);
            sb_putc(&tasks, '}');
            ntask++;
            if (strcmp(status, "done") == 0) ndone++;
            free(tt); free(st); free(ids[i]);
        }
        free(ids);
    }
    kvx_free(f);
    /* the state a readiness score is worth anything on: what is qualified,
     * what the gates said, and how much work is actually being proposed */
    long commits = commits_between(c->tree, c->h.main_branch, branch);
    const char *gates = c->gates_ok > 0 ? "green"
                      : c->gates_ok == 0 ? "red" : "not run in this command";
    StrBuf state; sb_init(&state);
    sb_puts(&state, "{\"feature\":"); sb_json_str(&state, c->feature);
    sb_puts(&state, ",\"branch\":"); sb_json_str(&state, branch);
    sb_puts(&state, ",\"base\":"); sb_json_str(&state, c->h.main_branch);
    sb_printf(&state, ",\"tasks\":{\"total\":%d,\"done\":%d,\"open\":%d,"
                      "\"list\":[%s]},\"gates\":", ntask, ndone, ntask - ndone,
              tasks.p ? tasks.p : "");
    sb_json_str(&state, gates);
    sb_printf(&state, ",\"commits_ahead\":%ld}", commits);
    sb_free(&tasks);
    JevReadiness rd;
    if (jev_pr_readiness(cg, state.p, &rd) == JEV_OK)
        sb_printf(&b, "\nJev readiness: %.2f (%s) — %d/%d tasks qualified, "
                      "%ld commit%s, gates %s\n", rd.value, rd.band, ndone,
                  ntask, commits, commits == 1 ? "" : "s", gates);
    sb_free(&state);
    char dir[4700];
    snprintf(dir, sizeof dir, "%s/%s/fleet", c->tree, CG_DIR);
    mkdirs(dir);
    snprintf(bodypath, bcap, "%s/pr-%s.md", dir, c->feature);
    write_entire_file(bodypath, b.p, b.len);
    sb_free(&b);
}

/* Open the feature's pull request against <remote>/<main>: push the branch,
 * then create it with the generated body. A pull request already open on the
 * branch is reported rather than duplicated. When gh is absent or the caller
 * asked for a dry run, the two exact commands are printed instead of run.
 * jb receives one JSON object (when json), else text goes to stdout. */
static int pr_open_core(Cg *cg, Lifecycle *c, bool dry_run, StrBuf *jb,
                        bool json) {
    if (!dry_run) {
        int gate = fleet_gate(cg, "pr", c->feature);
        if (gate) {
            if (json) sb_printf(jb, "{\"opened\":false,\"waiting\":%s}",
                                gate == CG_EXIT_APPROVAL ? "\"approval\"" : "\"rejected\"");
            return gate;
        }
    }
    const FleetRole *rf = &c->h.roles[FLEET_FEATURE];
    char branch[512], title[300], bodypath[4800], gh[4096];
    hier_expand(&c->h, rf->branch, c->feature, -1, branch, sizeof branch);
    write_pr_body(cg, c, branch, title, sizeof title, bodypath,
                  sizeof bodypath);
    bool have_gh = find_gh(gh, sizeof gh);

    StrBuf push; sb_init(&push);
    sb_puts(&push, "git -C "); sb_shquote(&push, c->tree);
    sb_puts(&push, " push -u "); sb_shquote(&push, c->h.remote);
    sb_putc(&push, ' '); sb_shquote(&push, branch);
    StrBuf create; sb_init(&create);
    sb_puts(&create, "cd "); sb_shquote(&create, c->tree);
    sb_puts(&create, " && "); sb_shquote(&create, have_gh ? gh : "gh");
    sb_puts(&create, " pr create --base "); sb_shquote(&create, c->h.main_branch);
    sb_puts(&create, " --head "); sb_shquote(&create, branch);
    sb_puts(&create, " --title "); sb_shquote(&create, title);
    sb_puts(&create, " --body-file "); sb_shquote(&create, bodypath);

    StrBuf b; sb_init(&b);
    int rc = 0;
    if (dry_run || !have_gh) {
        const char *why = dry_run ? "dry-run" : "gh not found";
        if (json) {
            sb_puts(&b, "{\"opened\":false,\"reason\":");
            sb_json_str(&b, why);
            sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
            sb_puts(&b, ",\"base\":"); sb_json_str(&b, c->h.main_branch);
            sb_puts(&b, ",\"remote\":"); sb_json_str(&b, c->h.remote);
            sb_puts(&b, ",\"commands\":["); sb_json_str(&b, push.p);
            sb_putc(&b, ','); sb_json_str(&b, create.p);
            sb_puts(&b, "]}");
        } else {
            sb_printf(&b, "pull request (%s): run these to open %s against "
                          "%s/%s:\n  %s\n  %s\n", why, branch, c->h.remote,
                      c->h.main_branch, push.p, create.p);
        }
    } else {
        /* one open PR per branch: gh would refuse anyway, but say why */
        StrBuf q; sb_init(&q);
        sb_shquote(&q, gh);
        sb_puts(&q, " pr list --head "); sb_shquote(&q, branch);
        sb_puts(&q, " --base "); sb_shquote(&q, c->h.main_branch);
        sb_puts(&q, " --state open --json number,url");
        StrBuf out; sb_init(&out);
        char **items = NULL;
        int ni = run_in(c->tree, q.p, &out) == 0
               ? json_array_items(out.p, &items) : 0;
        sb_free(&q);
        if (ni > 0) {
            char *url = json_get_string(items[0], "url");
            long num = json_get_int(items[0], "number", 0);
            if (json) {
                sb_printf(&b, "{\"opened\":false,\"already_open\":true,"
                              "\"number\":%ld,\"url\":", num);
                json_str_or_null(&b, url);
                sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
                sb_puts(&b, ",\"base\":"); sb_json_str(&b, c->h.main_branch);
                sb_putc(&b, '}');
            } else
                sb_printf(&b, "already open: #%ld %s (%s → %s)\n", num,
                          url ? url : "", branch, c->h.main_branch);
            pr_event(cg, c, "already_open", branch, url, num, NULL);
            free(url);
        } else {
            sb_free(&out); sb_init(&out);
            int prc = run_in(c->tree, push.p + 0, &out);
            /* push.p starts with "git -C <tree>", which run_in's cd makes
             * redundant but harmless */
            if (prc != 0) {
                char ex[400];
                excerpt(&out, ex, sizeof ex);
                fprintf(stderr, "cg fleet: push of %s to %s failed: %s\n",
                        branch, c->h.remote, ex);
                pr_event(cg, c, "push_failed", branch, NULL, 0, ex);
                rc = 1;
                if (json) {
                    sb_puts(&b, "{\"opened\":false,\"pushed\":false,\"error\":");
                    sb_json_str(&b, ex);
                    sb_putc(&b, '}');
                }
            } else {
                sb_free(&out); sb_init(&out);
                /* the create command already cds; strip that for run_in */
                const char *cmd = strstr(create.p, " && ");
                cmd = cmd ? cmd + 4 : create.p;
                int crc = run_in(c->tree, cmd, &out);
                if (crc != 0) {
                    char ex[400];
                    excerpt(&out, ex, sizeof ex);
                    fprintf(stderr, "cg fleet: gh pr create failed: %s\n", ex);
                    pr_event(cg, c, "create_failed", branch, NULL, 0, ex);
                    rc = 1;
                    if (json) {
                        sb_puts(&b, "{\"opened\":false,\"pushed\":true,"
                                    "\"error\":");
                        sb_json_str(&b, ex);
                        sb_putc(&b, '}');
                    }
                } else {
                    /* gh prints the new PR's URL as its last line */
                    char url[600] = "";
                    for (char *line = out.p, *e; line && *line; line = e ? e + 1 : NULL) {
                        e = strchr(line, '\n');
                        size_t len = e ? (size_t)(e - line) : strlen(line);
                        if (len && len < sizeof url) {
                            memcpy(url, line, len);
                            url[len] = 0;
                        }
                    }
                    if (json) {
                        sb_puts(&b, "{\"opened\":true,\"url\":");
                        sb_json_str(&b, url);
                        sb_puts(&b, ",\"branch\":"); sb_json_str(&b, branch);
                        sb_puts(&b, ",\"base\":"); sb_json_str(&b, c->h.main_branch);
                        sb_puts(&b, ",\"remote\":"); sb_json_str(&b, c->h.remote);
                        sb_puts(&b, ",\"pushed\":true}");
                    } else
                        sb_printf(&b, "opened %s (%s → %s)\n", url, branch,
                                  c->h.main_branch);
                    pr_event(cg, c, "opened", branch, url, 0, NULL);
                }
            }
        }
        sb_free(&out);
        free_list(items, ni);
    }
    if (json) sb_puts(jb, b.p);
    else fputs(b.p, stdout);
    sb_free(&b); sb_free(&push); sb_free(&create);
    return rc;
}

int fleet_pr_open(Cg *cg, const char *feature_ov, bool dry_run, bool json) {
    Lifecycle c;
    if (lifecycle_open(cg, feature_ov, &c) != 0) return 1;
    const FleetRole *rf = &c.h.roles[FLEET_FEATURE];
    char branch[512];
    hier_expand(&c.h, rf->branch, c.feature, -1, branch, sizeof branch);
    if (!git_branch_exists(c.tree, branch)) {
        fprintf(stderr, "cg fleet: no branch %s to open a pull request "
                        "from\n", branch);
        lifecycle_close(&c);
        return 1;
    }
    int rc;
    if (json) {
        StrBuf jb; sb_init(&jb);
        rc = pr_open_core(cg, &c, dry_run, &jb, true);
        if (jb.len) printf("%s\n", jb.p);
        sb_free(&jb);
    } else
        rc = pr_open_core(cg, &c, dry_run, NULL, false);
    lifecycle_close(&c);
    return rc;
}

typedef struct { long number; char *head, *title, *url; } OpenPr;

/* cg fleet checkpoint: merge the open Codify pull requests — the ones on
 * feature branches — lowest number first, and stop at the first that will
 * not merge so the order stays what a reader expects. Local main then
 * fast-forwards to the remote when it is clean. */
int fleet_checkpoint(Cg *cg, bool dry_run, bool json) {
    Lifecycle c;
    if (lifecycle_open(cg, NULL, &c) != 0) return 1;
    const FleetRole *rf = &c.h.roles[FLEET_FEATURE];
    /* what makes a PR ours: its head matches the feature-branch template
     * up to {feature} (feature/ by default) */
    char prefix[512];
    snprintf(prefix, sizeof prefix, "%s", rf->branch);
    char *brace = strstr(prefix, "{feature}");
    if (brace) *brace = 0;
    char gh[4096];
    bool have_gh = find_gh(gh, sizeof gh);
    StrBuf b; sb_init(&b);
    if (dry_run || !have_gh) {
        const char *why = dry_run ? "dry-run" : "gh not found";
        StrBuf l; sb_init(&l);
        sb_printf(&l, "gh pr list --base '%s' --state open --json "
                      "number,headRefName,title,url", c.h.main_branch);
        if (json) {
            sb_puts(&b, "{\"merged\":[],\"skipped\":[],\"reason\":");
            sb_json_str(&b, why);
            sb_puts(&b, ",\"prefix\":"); sb_json_str(&b, prefix);
            sb_puts(&b, ",\"commands\":["); sb_json_str(&b, l.p);
            sb_puts(&b, ",\"gh pr merge <number> --merge\"]}\n");
        } else
            sb_printf(&b, "checkpoint (%s): merge the open %s* pull requests "
                          "lowest number first:\n  %s\n  gh pr merge <number> "
                          "--merge\n", why, prefix, l.p);
        sb_free(&l);
        fputs(b.p, stdout);
        sb_free(&b);
        lifecycle_close(&c);
        return 0;
    }
    StrBuf q; sb_init(&q);
    sb_shquote(&q, gh);
    sb_puts(&q, " pr list --base "); sb_shquote(&q, c.h.main_branch);
    sb_puts(&q, " --state open --json number,headRefName,title,url");
    StrBuf out; sb_init(&out);
    int lrc = run_in(c.tree, q.p, &out);
    sb_free(&q);
    if (lrc != 0) {
        char ex[400];
        excerpt(&out, ex, sizeof ex);
        fprintf(stderr, "cg fleet: gh pr list failed: %s\n", ex);
        sb_free(&out); sb_free(&b);
        lifecycle_close(&c);
        return 1;
    }
    char **items = NULL;
    int ni = json_array_items(out.p, &items);
    sb_free(&out);
    OpenPr *prs = xmalloc(sizeof(OpenPr) * (size_t)(ni > 0 ? ni : 1));
    OpenPr *skip = xmalloc(sizeof(OpenPr) * (size_t)(ni > 0 ? ni : 1));
    int np = 0, ns = 0;
    for (int i = 0; i < ni; i++) {
        OpenPr p;
        p.number = json_get_int(items[i], "number", 0);
        p.head = json_get_string(items[i], "headRefName");
        p.title = json_get_string(items[i], "title");
        p.url = json_get_string(items[i], "url");
        if (!p.head) p.head = xstrdup("");
        if (!p.title) p.title = xstrdup("");
        if (!p.url) p.url = xstrdup("");
        bool ours = prefix[0] ? strncmp(p.head, prefix, strlen(prefix)) == 0
                              : strcmp(p.head, rf->branch) == 0;
        if (ours) prs[np++] = p; else skip[ns++] = p;
    }
    free_list(items, ni);
    for (int i = 1; i < np; i++) {              /* ascending by number */
        OpenPr t = prs[i];
        int j = i;
        while (j > 0 && prs[j - 1].number > t.number) { prs[j] = prs[j - 1]; j--; }
        prs[j] = t;
    }
    int nok = 0, failed = -1;
    char failmsg[400] = "";
    for (int i = 0; i < np && failed < 0; i++) {
        StrBuf m; sb_init(&m);
        sb_shquote(&m, gh);
        sb_printf(&m, " pr merge %ld --merge", prs[i].number);
        StrBuf mo; sb_init(&mo);
        int mrc = run_in(c.tree, m.p, &mo);
        sb_free(&m);
        if (mrc == 0) nok++;
        else { failed = i; excerpt(&mo, failmsg, sizeof failmsg); }
        sb_free(&mo);
    }
    /* local main follows the remote when nothing here is in the way */
    bool updated = false;
    char head[65] = "", on[256];
    if (nok > 0 && git_head(c.tree, on, sizeof on, head, sizeof head) &&
        strcmp(on, c.h.main_branch) == 0 && tree_clean(c.tree)) {
        StrBuf f; sb_init(&f);
        sb_puts(&f, "fetch "); sb_shquote(&f, c.h.remote);
        sb_putc(&f, ' '); sb_shquote(&f, c.h.main_branch);
        if (git_run(c.tree, f.p, NULL) == 0 &&
            git_run(c.tree, "merge --ff-only FETCH_HEAD", NULL) == 0) {
            updated = true;
            git_head(c.tree, on, sizeof on, head, sizeof head);
            branch_register(cg, c.h.main_branch, c.tree, head, NULL);
        }
        sb_free(&f);
    }
    int remaining = failed >= 0 ? np - failed - 1 : 0;
    {
        StrBuf e; sb_init(&e);
        sb_puts(&e, "\"merged\":[");
        for (int i = 0, k = 0; i < np && (failed < 0 || i < failed); i++)
            sb_printf(&e, "%s%ld", k++ ? "," : "", prs[i].number);
        sb_putc(&e, ']');
        if (failed >= 0) {
            ev_long(&e, "failed", prs[failed].number);
            ev_str(&e, "error", failmsg);
        }
        ev_long(&e, "skipped", ns); ev_long(&e, "remaining", remaining);
        sb_printf(&e, ",\"local_main_updated\":%s", updated ? "true" : "false");
        fleet_event(cg, "fleet.checkpoint", c.h.main_branch, &e);
    }
    if (json) {
        sb_puts(&b, "{\"merged\":[");
        for (int i = 0; i < np && (failed < 0 || i <= failed); i++) {
            if (i) sb_putc(&b, ',');
            sb_printf(&b, "{\"number\":%ld,\"branch\":", prs[i].number);
            sb_json_str(&b, prs[i].head);
            sb_puts(&b, ",\"title\":"); sb_json_str(&b, prs[i].title);
            sb_puts(&b, ",\"url\":"); sb_json_str(&b, prs[i].url);
            sb_printf(&b, ",\"ok\":%s", i == failed ? "false" : "true");
            if (i == failed) { sb_puts(&b, ",\"error\":"); sb_json_str(&b, failmsg); }
            sb_putc(&b, '}');
        }
        sb_puts(&b, "],\"skipped\":[");
        for (int i = 0; i < ns; i++) {
            if (i) sb_putc(&b, ',');
            sb_printf(&b, "{\"number\":%ld,\"branch\":", skip[i].number);
            sb_json_str(&b, skip[i].head);
            sb_puts(&b, ",\"title\":"); sb_json_str(&b, skip[i].title);
            sb_puts(&b, ",\"url\":"); sb_json_str(&b, skip[i].url);
            sb_putc(&b, '}');
        }
        sb_printf(&b, "],\"remaining\":%d,\"local_main\":{\"updated\":%s,"
                      "\"head\":", remaining, updated ? "true" : "false");
        json_str_or_null(&b, head);
        sb_puts(&b, "}}\n");
    } else {
        for (int i = 0; i < np && (failed < 0 || i <= failed); i++) {
            if (i == failed)
                sb_printf(&b, "could not merge #%ld %s — %s\n", prs[i].number,
                          prs[i].head, failmsg);
            else
                sb_printf(&b, "merged #%ld %s — %s (%s)\n", prs[i].number,
                          prs[i].head, prs[i].title, prs[i].url);
        }
        for (int i = 0; i < ns; i++)
            sb_printf(&b, "skipped #%ld %s — not a %s* branch\n",
                      skip[i].number, skip[i].head, prefix);
        sb_printf(&b, "checkpoint: %d merged, %d skipped", nok, ns);
        if (remaining) sb_printf(&b, ", %d remaining", remaining);
        if (!np && !ns) sb_puts(&b, " — no open pull requests");
        sb_putc(&b, '\n');
        if (nok > 0)
            sb_printf(&b, "local %s: %s\n", c.h.main_branch,
                      updated ? "fast-forwarded" : "not updated (checkout "
                      "or working tree in the way, or the remote is ahead "
                      "differently)");
        if (nok > 0 && updated) {
            b.len--;                            /* fold the head in */
            sb_printf(&b, " to %.8s\n", head);
        }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    for (int i = 0; i < np; i++) { free(prs[i].head); free(prs[i].title); free(prs[i].url); }
    for (int i = 0; i < ns; i++) { free(skip[i].head); free(skip[i].title); free(skip[i].url); }
    free(prs); free(skip);
    lifecycle_close(&c);
    return failed >= 0 ? 1 : 0;
}

/* ---------------- dispatch ---------------- */

int cmd_fleet(Cg *cg, int argc, char **argv, bool json) {
    const char *sub = argc >= 3 ? argv[2] : "status";
    const char *feature = NULL, *agent = NULL, *pos = NULL;
    bool force = false, keep = false, no_pr = false, dry = false;
    for (int i = 3; i < argc; i++) {
        if (strcmp(argv[i], "-f") == 0 && i + 1 < argc) feature = argv[++i];
        else if (strcmp(argv[i], "--agent") == 0 && i + 1 < argc) agent = argv[++i];
        else if (strcmp(argv[i], "--force") == 0) force = true;
        else if (strcmp(argv[i], "--keep") == 0) keep = true;
        else if (strcmp(argv[i], "--no-pr") == 0) no_pr = true;
        else if (strcmp(argv[i], "--dry-run") == 0) dry = true;
        else if (argv[i][0] != '-' && !pos) pos = argv[i];
    }
    if (strcmp(sub, "roles") == 0) return fleet_roles(cg, json);
    if (strcmp(sub, "status") == 0) return fleet_status(cg, json);
    if (strcmp(sub, "plan") == 0) return fleet_plan(cg, feature, json);
    /* the running shape of the fleet — main, its managers, their workers —
     * belongs to the orchestrator that spawned them (orchestrate.c) */
    if (strcmp(sub, "tree") == 0) return orch_tree_status(cg, feature, json);
    if (strcmp(sub, "begin") == 0 || strcmp(sub, "merge-up") == 0) {
        if (!pos) {
            fprintf(stderr, "usage: cg fleet %s <task-id> [-f <feature>]%s\n",
                    sub, strcmp(sub, "begin") == 0 ? " [--agent A]"
                                                   : " [--force] [--keep]");
            return 1;
        }
        return strcmp(sub, "begin") == 0
             ? fleet_worker_begin(cg, pos, feature, agent, json)
             : fleet_merge_up(cg, pos, feature, force, keep, json);
    }
    if (strcmp(sub, "land") == 0)
        return fleet_feature_land(cg, pos ? pos : feature, no_pr, json);
    if (strcmp(sub, "pr") == 0)
        return fleet_pr_open(cg, pos ? pos : feature, dry, json);
    if (strcmp(sub, "checkpoint") == 0) return fleet_checkpoint(cg, dry, json);
    if (strcmp(sub, "up") == 0) return cmd_fleet_up(cg, argc - 3, argv + 3, json);
    if (strcmp(sub, "down") == 0 || strcmp(sub, "pause") == 0 ||
        strcmp(sub, "resume") == 0)
        return cmd_fleet_control(cg, sub, argc - 3, argv + 3, json);
    if (strcmp(sub, "runs") == 0) return cmd_fleet_runs(cg, json);
    if (strcmp(sub, "brief") == 0) {
        /* the feature manager's packet, as its next wake would read it */
        char path[4700];
        Kvx *wf = fleet_workflow(cg, path, sizeof path);
        char *active = wf ? kvx_str(wf, "meta", "active_feature") : NULL;
        const char *f = pos ? pos : feature ? feature : active;
        if (!f || !f[0]) {
            fprintf(stderr, "usage: cg fleet brief [feature]\n");
            free(active); kvx_free(wf);
            return 1;
        }
        StrBuf b; sb_init(&b);
        const char *bs = getenv("CG_PACKET_BUDGET");
        manager_packet_build(cg, f, bs && atoi(bs) > 0 ? atoi(bs) : 4000, &b);
        fputs(b.p, stdout);
        sb_free(&b);
        free(active); kvx_free(wf);
        return 0;
    }
    if (strcmp(sub, "approvals") == 0 || strcmp(sub, "approve") == 0)
        return cmd_fleet_approvals(cg, argc, argv, json);
    if (strcmp(sub, "steer") == 0) {
        /* cg fleet steer <agent> <message...> */
        const char *agent = argc >= 4 ? argv[3] : NULL;
        StrBuf m; sb_init(&m);
        for (int i = 4; i < argc; i++) {
            if (m.len) sb_putc(&m, ' ');
            sb_puts(&m, argv[i]);
        }
        if (!agent || !m.len) {
            fprintf(stderr, "usage: cg fleet steer <agent> <message>\n");
            sb_free(&m);
            return 1;
        }
        long seq = driver_steer(cg, agent, m.p);
        if (json) {
            StrBuf j; sb_init(&j);
            sb_printf(&j, "{\"queued\":%s,\"agent\":", seq > 0 ? "true" : "false");
            sb_json_str(&j, agent);
            sb_printf(&j, ",\"seq\":%ld}\n", seq);
            fputs(j.p, stdout);
            sb_free(&j);
        } else if (seq > 0)
            printf("queued for %s (#%ld): delivered at its next edit (Claude "
                   "Code, through the post-edit hook) or its next prompt\n",
                   agent, seq);
        else fprintf(stderr, "cg fleet: could not queue the message\n");
        sb_free(&m);
        return seq > 0 ? 0 : 1;
    }
    fprintf(stderr, "usage: cg fleet roles | status | plan [-f F] | "
                    "tree [-f F] | begin <id> [-f F] [--agent A] | "
                    "merge-up <id> [--force] [--keep] | land <feature> "
                    "[--no-pr] | pr <feature> [--dry-run] | checkpoint "
                    "[--dry-run]\n");
    return 1;
}
