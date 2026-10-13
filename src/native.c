/* Native agents: the Claude Code and Codex sessions working on this project,
 * and the subagents they spawn through their own Agent tool, recorded in the
 * same agents registry the fleet uses (kind = 'native').
 *
 * cg fleet only knows the processes it started; a host's own subagents never
 * pass through it. Their hooks do: `cg hook event --host H` reads one hook
 * payload on stdin and turns it into registry rows, branch registrations,
 * and agent.native.* events, then hands the same payload to the runtime
 * event normalization (`cg event ingest --source H`) so evidence keeps
 * flowing exactly as before.
 *
 * Contract (spec/codify-v15 req 6):
 *   - names: the session is H:<first 8 of session_id>, a subagent H:<agent_id>;
 *     a spawn announced by PreToolUse Agent|Task waits as H:spawn:<tool_use_id>
 *     in state 'pending' until its SubagentStart claims it — by the toolUseId
 *     in the subagent's meta.json when that file exists, else the oldest
 *     pending spawn of the same type in the session;
 *   - subagent hooks carry the PARENT session_id, so the session row is
 *     created on first sight of any payload, not only on SessionStart;
 *   - a cwd inside a linked worktree of this project registers its branch
 *     (base: the session's branch), read from git's files, never spawning git;
 *   - the command always exits 0: a hook that fails wedges the host's tool
 *     loop, and a malformed payload is only logged.
 * Rows are never deleted except a pending spawn once claimed; views hide
 * sessions stopped for more than a day unless --all. */
#include "cg.h"
#include <ctype.h>
#include <dirent.h>
#include <time.h>
#include <limits.h>
#include <sys/stat.h>
#include <unistd.h>

#define NATIVE_STALE_S 120         /* no hook for this long: shown as stale */
#define NATIVE_HIDE_S  86400       /* stopped this long: hidden unless --all */
#define NATIVE_PROMPT_CHARS 200
#define NATIVE_MESSAGE_CHARS 300
#define NATIVE_BUSY_MS 3000        /* a hook waits this long for the lock */

bool native_show_all = false;

/* ---------------- the payload ---------------- */

typedef struct {
    const char *host;
    char *event, *session, *agent_id, *agent_type, *tool_name, *tool_input,
         *tool_use_id, *cwd, *agent_transcript, *last_message, *model,
         *transcript;
    char sname[160];               /* H:<first 8 of session_id> */
} Hook;

static char *jstr(const char *obj, const char *key) {
    if (!obj) return NULL;
    char *v = json_get_string(obj, key);
    if (v && !v[0]) { free(v); v = NULL; }
    return v;
}

/* model is a string on some hosts and {id, display_name} on others */
static char *jmodel(const char *obj) {
    char *m = jstr(obj, "model");
    if (m) return m;
    char *o = obj ? json_get_object(obj, "model") : NULL;
    if (!o) return NULL;
    m = jstr(o, "id");
    if (!m) m = jstr(o, "display_name");
    free(o);
    return m;
}

static void hook_free(Hook *h) {
    free(h->event); free(h->session); free(h->agent_id); free(h->agent_type);
    free(h->tool_name); free(h->tool_input); free(h->tool_use_id);
    free(h->cwd); free(h->agent_transcript); free(h->last_message);
    free(h->model); free(h->transcript);
}

static void hook_parse(Hook *h, const char *host, const char *p) {
    memset(h, 0, sizeof *h);
    h->host = host;
    h->event = jstr(p, "hook_event_name");
    h->session = jstr(p, "session_id");
    if (!h->session) h->session = jstr(p, "sessionId");
    h->agent_id = jstr(p, "agent_id");
    h->agent_type = jstr(p, "agent_type");
    h->tool_name = jstr(p, "tool_name");
    h->tool_input = json_get_object(p, "tool_input");
    h->tool_use_id = jstr(p, "tool_use_id");
    h->cwd = jstr(p, "cwd");
    h->agent_transcript = jstr(p, "agent_transcript_path");
    h->last_message = jstr(p, "last_assistant_message");
    h->model = jmodel(p);
    h->transcript = jstr(p, "transcript_path");
    snprintf(h->sname, sizeof h->sname, "%s:%.8s", host,
             h->session ? h->session : "unknown");
}

static void agent_name(const Hook *h, const char *id, char *out, size_t cap) {
    snprintf(out, cap, "%s:%s", h->host, id);
}

/* the first n characters (UTF-8 safe: never splits a sequence) */
static char *excerpt(const char *s, size_t n) {
    if (!s) return NULL;
    size_t len = strlen(s);
    if (len <= n) return xstrdup(s);
    while (n > 0 && ((unsigned char)s[n] & 0xC0) == 0x80) n--;
    char *o = xmalloc(n + 1);
    memcpy(o, s, n);
    o[n] = 0;
    return o;
}

/* ---------------- small SQL helpers ---------------- */

static void bind_s(sqlite3_stmt *st, int i, const char *v) {
    if (v && v[0]) sqlite3_bind_text(st, i, v, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, i);
}

static void col_cpy(sqlite3_stmt *st, int c, char *out, size_t cap) {
    const char *v = (const char *)sqlite3_column_text(st, c);
    snprintf(out, cap, "%s", v ? v : "");
}

static bool exec_ok(Cg *cg, const char *sql) {
    return sqlite3_exec(cg->db, sql, NULL, NULL, NULL) == SQLITE_OK;
}

static void put_kv(StrBuf *b, const char *k, const char *v) {
    sb_printf(b, ",\"%s\":", k);
    if (v && v[0]) sb_json_str(b, v); else sb_puts(b, "null");
}

/* One native row as the hook code needs it. */
typedef struct {
    bool found;
    char parent[160], session[160], state[16], task[256], task_source[16],
         branch[256], worktree[4096], cwd[4096], description[512],
         agent_type[128], model[128];
    long depth, tool_calls;
} NRow;

static void row_get(Cg *cg, const char *agent, NRow *r) {
    memset(r, 0, sizeof *r);
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT ifnull(parent,''),ifnull(session,''),ifnull(state,''),"
        "ifnull(task,''),ifnull(task_source,''),ifnull(branch,''),"
        "ifnull(worktree,''),ifnull(cwd,''),ifnull(description,''),"
        "ifnull(agent_type,''),ifnull(model,''),ifnull(depth,0),"
        "ifnull(tool_calls,0) FROM agents WHERE agent=?");
    sqlite3_bind_text(st, 1, agent, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(st) == SQLITE_ROW) {
        r->found = true;
        col_cpy(st, 0, r->parent, sizeof r->parent);
        col_cpy(st, 1, r->session, sizeof r->session);
        col_cpy(st, 2, r->state, sizeof r->state);
        col_cpy(st, 3, r->task, sizeof r->task);
        col_cpy(st, 4, r->task_source, sizeof r->task_source);
        col_cpy(st, 5, r->branch, sizeof r->branch);
        col_cpy(st, 6, r->worktree, sizeof r->worktree);
        col_cpy(st, 7, r->cwd, sizeof r->cwd);
        col_cpy(st, 8, r->description, sizeof r->description);
        col_cpy(st, 9, r->agent_type, sizeof r->agent_type);
        col_cpy(st, 10, r->model, sizeof r->model);
        r->depth = (long)sqlite3_column_int64(st, 11);
        r->tool_calls = (long)sqlite3_column_int64(st, 12);
    }
    sqlite3_finalize(st);
}

static const char *machine(void) {
    static char host[256];
    if (host[0]) return host;
    const char *h = getenv("CG_HOST");
    if (h && h[0]) snprintf(host, sizeof host, "%s", h);
    else if (gethostname(host, sizeof host - 1) != 0)
        snprintf(host, sizeof host, "unknown");
    host[sizeof host - 1] = 0;
    return host;
}

/* ---------------- worktree detection ---------------- */

static bool same_dir(const char *a, const char *b) {
    char ra[PATH_MAX], rb[PATH_MAX];
    if (!realpath(a, ra)) snprintf(ra, sizeof ra, "%s", a);
    if (!realpath(b, rb)) snprintf(rb, sizeof rb, "%s", b);
    return strcmp(ra, rb) == 0;
}

/* The tree cwd belongs to and its branch, read from git's own files.
 * Returns true when cwd is inside a LINKED worktree of this project (wt set
 * to its root); branch is filled whenever cwd is in any tree of it. */
bool native_worktree(Cg *cg, const char *cwd, char *wt, size_t wcap,
                     char *branch, size_t bcap, char *head, size_t hcap) {
    wt[0] = 0; branch[0] = 0; head[0] = 0;
    if (!cwd || !cwd[0]) return false;
    char root[4096], shared[4096];
    if (cg_find_project_at(cwd, root, shared, sizeof root) != 0) return false;
    if (!same_dir(shared, cg->shared)) return false;
    if (!git_head(root, branch, bcap, head, hcap)) return false;
    if (same_dir(root, shared)) return false;
    snprintf(wt, wcap, "%s", root);
    return true;
}

/* The session's branch: the branch of the session's own cwd, else the
 * branch of the project's main worktree. */
static void session_branch(Cg *cg, const char *sname, char *out, size_t cap) {
    NRow s;
    row_get(cg, sname, &s);
    if (s.branch[0]) { snprintf(out, cap, "%s", s.branch); return; }
    char sha[65];
    if (!git_head(cg->shared, out, cap, sha, sizeof sha)) out[0] = 0;
}

/* Record where agent works: cwd, branch, and — for a linked worktree — the
 * worktree, registered in the branch registry with base the session's
 * branch so the shared graph, the fleet views, and the projection see it. */
static void place_agent(Cg *cg, const char *agent, const char *sname,
                        const char *cwd, const char *fallback_wt) {
    if ((!cwd || !cwd[0]) && (!fallback_wt || !fallback_wt[0])) return;
    char wt[4096], br[256], head[65];
    bool linked = native_worktree(cg, cwd, wt, sizeof wt, br, sizeof br,
                                  head, sizeof head);
    if (!linked && fallback_wt && fallback_wt[0])
        linked = native_worktree(cg, fallback_wt, wt, sizeof wt, br,
                                 sizeof br, head, sizeof head);
    if (linked && strcmp(br, "(detached)") != 0) {
        char base[256] = "";
        if (strcmp(agent, sname) != 0) session_branch(cg, sname, base, sizeof base);
        if (strcmp(base, br) == 0) base[0] = 0;
        branch_register(cg, br, wt, head, base[0] ? base : NULL);
    }
    sqlite3_stmt *st = cg_prep(cg,
        "UPDATE agents SET cwd=ifnull(?,cwd),branch=ifnull(?,branch),"
        "worktree=CASE WHEN ? THEN ? ELSE worktree END WHERE agent=?");
    bind_s(st, 1, cwd);
    bind_s(st, 2, br);
    sqlite3_bind_int(st, 3, linked ? 1 : 0);
    bind_s(st, 4, wt);
    sqlite3_bind_text(st, 5, agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* ---------------- task attribution ---------------- */

/* The active feature's name and task ids (cached for the process). */
static char g_feature[128];
static char **g_ids;
static int g_nids = -1;

static void active_tasks(Cg *cg) {
    if (g_nids >= 0) return;
    g_nids = 0;
    char wp[4700];
    const char *roots[2] = { cg->root, cg->shared };
    for (int r = 0; r < 2 && !g_nids; r++) {
        if (!config_workflow_path(roots[r], wp, sizeof wp)) continue;
        Kvx *wf = kvx_parse(wp);
        char *f = wf ? kvx_str(wf, "meta", "active_feature") : NULL;
        kvx_free(wf);
        if (!f || !f[0]) { free(f); continue; }
        char dir[4096], sp[4700];
        if (config_spec_dir(roots[r], dir, sizeof dir)) {
            snprintf(sp, sizeof sp, "%s/%s/spec.kvx", dir, f);
            Kvx *k = kvx_parse(sp);
            if (k) {
                snprintf(g_feature, sizeof g_feature, "%s", f);
                g_nids = kvx_subsections(k, "task", &g_ids);
                kvx_free(k);
            }
        }
        free(f);
    }
}

static bool is_task_id(const char *id, size_t n) {
    for (int i = 0; i < g_nids; i++)
        if (strlen(g_ids[i]) == n && strncmp(g_ids[i], id, n) == 0) return true;
    return false;
}

static bool idch(char c) {
    return isalnum((unsigned char)c) || c == '_' || c == '-' || c == '/';
}

/* A task of the active feature named in text: a [spec:feature/id] tag
 * first, else the earliest bare dotted id (2.1, never a lone 2 — too many
 * numbers in prose are not tasks). "feature/id" into out. */
static bool task_in_text(const char *text, char *out, size_t cap) {
    if (!text || !g_nids || !g_feature[0]) return false;
    for (const char *p = strstr(text, "[spec:"); p; p = strstr(p + 1, "[spec:")) {
        const char *s = p + 6, *e = strchr(s, ']'), *sl = strchr(s, '/');
        if (!e || !sl || sl > e) continue;
        size_t fl = (size_t)(sl - s);
        if (fl == strlen(g_feature) && strncmp(s, g_feature, fl) == 0 &&
            is_task_id(sl + 1, (size_t)(e - sl - 1))) {
            snprintf(out, cap, "%s/%.*s", g_feature, (int)(e - sl - 1), sl + 1);
            return true;
        }
    }
    for (const char *p = text; *p; p++) {
        if (!isdigit((unsigned char)*p)) continue;
        if (p > text && (idch(p[-1]) || p[-1] == '.')) {
            while (isdigit((unsigned char)p[1]) || p[1] == '.') p++;
            continue;
        }
        const char *e = p;
        while (isdigit((unsigned char)*e) ||
               (*e == '.' && isdigit((unsigned char)e[1])))
            e++;
        size_t n = (size_t)(e - p);
        bool dotted = memchr(p, '.', n) != NULL;
        if (dotted && !idch(*e) && is_task_id(p, n)) {
            snprintf(out, cap, "%s/%.*s", g_feature, (int)n, p);
            return true;
        }
        p = e - 1;
    }
    return false;
}

/* The task a native agent works on, in the order req 6.3 fixes: CG_TASK in
 * the hook's environment; the task of a live attempt of this session; a
 * task id of the active feature named in the spawn's description or prompt;
 * the parent's task. Returns the source ("env", "attempt", "prompt",
 * "parent") with task filled, or NULL with task empty. */
static const char *attribute_task(Cg *cg, bool use_env, const char *session,
                                  const char *description, const char *prompt,
                                  const char *parent, char *task, size_t cap) {
    task[0] = 0;
    const char *env = use_env ? getenv("CG_TASK") : NULL;
    if (env && env[0]) { snprintf(task, cap, "%s", env); return "env"; }
    if (session && session[0]) {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT task FROM attempts WHERE session=? AND state='running' "
            "AND expires>strftime('%s','now') ORDER BY heartbeat DESC LIMIT 1");
        sqlite3_bind_text(st, 1, session, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(st) == SQLITE_ROW) col_cpy(st, 0, task, cap);
        sqlite3_finalize(st);
        if (task[0]) return "attempt";
    }
    active_tasks(cg);
    if (task_in_text(description, task, cap) || task_in_text(prompt, task, cap))
        return "prompt";
    if (parent && parent[0]) {
        NRow p;
        row_get(cg, parent, &p);
        if (p.task[0]) { snprintf(task, cap, "%s", p.task); return "parent"; }
    }
    return NULL;
}

const char *native_attribute_task(Cg *cg, const char *session,
                                  const char *description, const char *prompt,
                                  const char *parent, char *task, size_t cap) {
    return attribute_task(cg, true, session, description, prompt, parent,
                          task, cap);
}

/* ---------------- events ---------------- */

static void emit(Cg *cg, const char *kind, const char *agent,
                 const char *node, const char *extra) {
    NRow r;
    row_get(cg, agent, &r);
    StrBuf b; sb_init(&b);
    sb_puts(&b, "{\"agent\":");
    sb_json_str(&b, agent);
    {
        /* the host kind is the name's prefix: claude:…, codex:… */
        const char *colon = strchr(agent, ':');
        char hk[32];
        snprintf(hk, sizeof hk, "%.*s", colon ? (int)(colon - agent) : 0, agent);
        put_kv(&b, "host", hk);
    }
    put_kv(&b, "session", r.session);
    put_kv(&b, "parent", r.parent);
    put_kv(&b, "state", r.state);
    put_kv(&b, "agent_type", r.agent_type);
    put_kv(&b, "description", r.description);
    put_kv(&b, "model", r.model);
    sb_printf(&b, ",\"depth\":%ld", r.depth);
    put_kv(&b, "cwd", r.cwd);
    put_kv(&b, "worktree", r.worktree);
    put_kv(&b, "branch", r.branch);
    put_kv(&b, "task", r.task);
    put_kv(&b, "task_source", r.task_source);
    if (extra && extra[0]) sb_puts(&b, extra);
    sb_putc(&b, '}');
    events_emit_as(cg, kind, r.task[0] ? r.task : NULL, node ? node : agent,
                   b.p);
    sb_free(&b);
}

/* ---------------- the rows ---------------- */

/* The session row, created on first sight of any payload of the session.
 * Returns true when it was created now. */
static bool ensure_session(Cg *cg, const Hook *h) {
    char wt[4096], br[256], head[65];
    native_worktree(cg, h->cwd, wt, sizeof wt, br, sizeof br, head, sizeof head);
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO agents(agent,kind,host,host_kind,session,cwd,model,depth,"
        "state,started,seen,branch) VALUES(?,'native',?,?,?,?,?,0,'live',"
        "strftime('%s','now'),strftime('%s','now'),?) "
        "ON CONFLICT(agent) DO NOTHING");
    sqlite3_bind_text(st, 1, h->sname, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, machine(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, h->host, -1, SQLITE_TRANSIENT);
    bind_s(st, 4, h->session);
    /* a subagent's cwd is its worktree, not the session's: leave it out */
    bind_s(st, 5, h->agent_id ? NULL : h->cwd);
    bind_s(st, 6, h->agent_id ? NULL : h->model);
    bind_s(st, 7, h->agent_id ? NULL : br);
    sqlite3_step(st);
    sqlite3_finalize(st);
    bool created = sqlite3_changes(cg->db) > 0;
    if (created) {
        char task[256];
        const char *src = native_attribute_task(cg, h->session, NULL, NULL,
                                                NULL, task, sizeof task);
        if (src) {
            st = cg_prep(cg, "UPDATE agents SET task=?,task_source=? "
                             "WHERE agent=?");
            sqlite3_bind_text(st, 1, task, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 2, src, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(st, 3, h->sname, -1, SQLITE_TRANSIENT);
            sqlite3_step(st);
            sqlite3_finalize(st);
        }
        if (!h->agent_id) place_agent(cg, h->sname, h->sname, h->cwd, NULL);
    }
    return created;
}

/* A subagent row seen before its SubagentStart (hooks lost or reordered):
 * created under the session so its activity is never dropped. */
static bool ensure_subagent(Cg *cg, const Hook *h, const char *name) {
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO agents(agent,kind,host,host_kind,session,parent,agent_id,"
        "agent_type,depth,state,started,seen) VALUES(?,'native',?,?,?,?,?,?,1,"
        "'live',strftime('%s','now'),strftime('%s','now')) "
        "ON CONFLICT(agent) DO NOTHING");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, machine(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, h->host, -1, SQLITE_TRANSIENT);
    bind_s(st, 4, h->session);
    sqlite3_bind_text(st, 5, h->sname, -1, SQLITE_TRANSIENT);
    bind_s(st, 6, h->agent_id);
    bind_s(st, 7, h->agent_type);
    sqlite3_step(st);
    sqlite3_finalize(st);
    return sqlite3_changes(cg->db) > 0;
}

static void set_task_if_none(Cg *cg, const char *agent, const char *session,
                             const char *desc, const char *prompt,
                             const char *parent) {
    NRow r;
    row_get(cg, agent, &r);
    if (r.task[0]) return;
    char task[256];
    const char *src = native_attribute_task(cg, session, desc, prompt, parent,
                                            task, sizeof task);
    if (!src) return;
    sqlite3_stmt *st = cg_prep(cg,
        "UPDATE agents SET task=?,task_source=? WHERE agent=?");
    sqlite3_bind_text(st, 1, task, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, src, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* The agent a payload speaks for: the subagent when agent_id is present,
 * else the session. */
static void actor(const Hook *h, char *out, size_t cap) {
    if (h->agent_id) agent_name(h, h->agent_id, out, cap);
    else snprintf(out, cap, "%s", h->sname);
}

static void heartbeat(Cg *cg, const char *agent, const char *tool,
                      bool count) {
    sqlite3_stmt *st = cg_prep(cg,
        "UPDATE agents SET seen=strftime('%s','now'),"
        "state=CASE WHEN state='stopped' AND agent_id IS NOT NULL THEN state "
        "ELSE 'live' END,ended=CASE WHEN agent_id IS NULL THEN NULL "
        "ELSE ended END,last_tool=ifnull(?,last_tool),"
        "tool_calls=ifnull(tool_calls,0)+? WHERE agent=?");
    bind_s(st, 1, tool);
    sqlite3_bind_int(st, 2, count ? 1 : 0);
    sqlite3_bind_text(st, 3, agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* PreToolUse of Agent|Task: the spawn waits as H:spawn:<tool_use_id> until
 * its SubagentStart claims it. */
static void record_spawn(Cg *cg, const Hook *h, const char *spawner) {
    const char *ti = h->tool_input;
    char *desc = jstr(ti, "description");
    char *stype = jstr(ti, "subagent_type");
    char *model = jstr(ti, "model");
    char *isolation = jstr(ti, "isolation");
    char *bg = ti ? json_get_raw(ti, "run_in_background") : NULL;
    char *prompt_full = jstr(ti, "prompt");
    char *prompt = excerpt(prompt_full, NATIVE_PROMPT_CHARS);
    char tuid[160], pname[256];
    if (h->tool_use_id) snprintf(tuid, sizeof tuid, "%s", h->tool_use_id);
    else snprintf(tuid, sizeof tuid, "anon-%ld-%d", (long)time(NULL),
                  (int)getpid());
    agent_name(h, "spawn:", pname, sizeof pname);
    snprintf(pname + strlen(pname), sizeof pname - strlen(pname), "%s", tuid);

    NRow sp;
    row_get(cg, spawner, &sp);
    char task[256];
    const char *src = native_attribute_task(cg, h->session, desc, prompt_full,
                                            spawner, task, sizeof task);
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO agents(agent,kind,host,host_kind,session,parent,"
        "agent_type,description,model,depth,state,started,seen,cwd,task,"
        "task_source) VALUES(?,'native',?,?,?,?,?,?,?,?,'pending',"
        "strftime('%s','now'),strftime('%s','now'),?,?,?) "
        "ON CONFLICT(agent) DO UPDATE SET seen=excluded.seen");
    sqlite3_bind_text(st, 1, pname, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, machine(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, h->host, -1, SQLITE_TRANSIENT);
    bind_s(st, 4, h->session);
    sqlite3_bind_text(st, 5, spawner, -1, SQLITE_TRANSIENT);
    bind_s(st, 6, stype ? stype : "general-purpose");
    bind_s(st, 7, desc);
    bind_s(st, 8, model);
    sqlite3_bind_int64(st, 9, sp.depth + 1);
    bind_s(st, 10, h->cwd);
    bind_s(st, 11, src ? task : NULL);
    bind_s(st, 12, src);
    sqlite3_step(st);
    sqlite3_finalize(st);

    StrBuf x; sb_init(&x);
    put_kv(&x, "subagent_type", stype ? stype : "general-purpose");
    put_kv(&x, "isolation", isolation);
    sb_printf(&x, ",\"run_in_background\":%s",
              bg && strcmp(bg, "true") == 0 ? "true" : "false");
    put_kv(&x, "tool_use_id", tuid);
    put_kv(&x, "prompt", prompt);
    emit(cg, "agent.native.spawn", pname, spawner, x.p);
    sb_free(&x);
    free(desc); free(stype); free(model); free(isolation); free(bg);
    free(prompt_full); free(prompt);
}

/* The subagent's meta.json beside its transcript, when the host wrote one:
 * <projects>/<cwd slug>/<session>/subagents/agent-<id>.meta.json. */
static char *read_meta(Cg *cg, const Hook *h) {
    if (!h->session || !h->agent_id) return NULL;
    char dirs[3][4096];
    int nd = 0;
    if (h->transcript) {
        snprintf(dirs[nd], sizeof dirs[nd], "%s", h->transcript);
        char *sl = strrchr(dirs[nd], '/');
        if (sl) { *sl = 0; nd++; }
    }
    const char *home = getenv("HOME");
    if (home && home[0]) {
        const char *cwds[2] = { cg->shared, cg->root };
        for (int i = 0; i < 2; i++) {
            char slug[4096];
            size_t k = 0;
            for (const char *p = cwds[i]; *p && k + 1 < sizeof slug; p++)
                slug[k++] = isalnum((unsigned char)*p) ? *p : '-';
            slug[k] = 0;
            int w = snprintf(dirs[nd], sizeof dirs[nd],
                             "%s/.claude/projects/%s", home, slug);
            if (w > 0 && (size_t)w < sizeof dirs[nd]) nd++;
        }
    }
    for (int i = 0; i < nd; i++) {
        char p[4700];
        int w = snprintf(p, sizeof p, "%s/%s/subagents/agent-%s.meta.json",
                         dirs[i], h->session, h->agent_id);
        if (w <= 0 || (size_t)w >= sizeof p) continue;
        char *m = read_entire_file(p, NULL);
        if (m) return m;
    }
    return NULL;
}

/* SubagentStart: the subagent's row, with the pending spawn it answers. */
static void record_start(Cg *cg, const Hook *h) {
    char name[256];
    agent_name(h, h->agent_id, name, sizeof name);
    char *meta = read_meta(cg, h);
    char *meta_tuid = jstr(meta, "toolUseId");
    char *meta_wt = jstr(meta, "worktreePath");
    char *meta_desc = jstr(meta, "description");
    char *meta_model = jstr(meta, "model");
    long meta_depth = meta ? json_get_int(meta, "spawnDepth", -1) : -1;

    /* the pending spawn: by tool_use_id when meta.json names it, else the
     * oldest pending spawn of this type in the session */
    char pending[256] = "", tuid[160] = "";
    sqlite3_stmt *st;
    if (meta_tuid) {
        char pn[256];
        agent_name(h, "spawn:", pn, sizeof pn);
        snprintf(pn + strlen(pn), sizeof pn - strlen(pn), "%s", meta_tuid);
        st = cg_prep(cg, "SELECT agent FROM agents WHERE agent=? "
                         "AND state='pending'");
        sqlite3_bind_text(st, 1, pn, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(st) == SQLITE_ROW) col_cpy(st, 0, pending, sizeof pending);
        sqlite3_finalize(st);
    }
    if (!pending[0]) {
        st = cg_prep(cg,
            "SELECT agent FROM agents WHERE kind='native' AND state='pending' "
            "AND session=? AND agent_type IS ? "
            "ORDER BY started, rowid LIMIT 1");
        bind_s(st, 1, h->session);
        bind_s(st, 2, h->agent_type ? h->agent_type : "general-purpose");
        if (sqlite3_step(st) == SQLITE_ROW) col_cpy(st, 0, pending, sizeof pending);
        sqlite3_finalize(st);
    }
    NRow pr;
    memset(&pr, 0, sizeof pr);
    if (pending[0]) {
        row_get(cg, pending, &pr);
        const char *c = strstr(pending, ":spawn:");
        if (c) snprintf(tuid, sizeof tuid, "%s", c + 7);
    } else if (meta_tuid) {
        snprintf(tuid, sizeof tuid, "%s", meta_tuid);
    }

    const char *parent = pr.found && pr.parent[0] ? pr.parent : h->sname;
    long depth = pr.found ? pr.depth : meta_depth > 0 ? meta_depth : 1;
    st = cg_prep(cg,
        "INSERT INTO agents(agent,kind,host,host_kind,session,parent,agent_id,"
        "agent_type,description,model,depth,state,started,seen,ended,cwd,task,"
        "task_source) VALUES(?1,'native',?2,?3,?4,?5,?6,?7,?8,?9,?10,'live',"
        "strftime('%s','now'),strftime('%s','now'),NULL,?11,?12,?13) "
        "ON CONFLICT(agent) DO UPDATE SET kind='native',state='live',"
        "seen=excluded.seen,ended=NULL,parent=excluded.parent,"
        "agent_type=ifnull(excluded.agent_type,agents.agent_type),"
        "description=ifnull(excluded.description,agents.description),"
        "model=ifnull(excluded.model,agents.model),depth=excluded.depth,"
        "cwd=ifnull(excluded.cwd,agents.cwd),"
        "task=ifnull(agents.task,excluded.task),"
        "task_source=ifnull(agents.task_source,excluded.task_source)");
    sqlite3_bind_text(st, 1, name, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, machine(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, h->host, -1, SQLITE_TRANSIENT);
    bind_s(st, 4, h->session);
    sqlite3_bind_text(st, 5, parent, -1, SQLITE_TRANSIENT);
    bind_s(st, 6, h->agent_id);
    bind_s(st, 7, h->agent_type ? h->agent_type : pr.agent_type);
    bind_s(st, 8, pr.description[0] ? pr.description : meta_desc);
    bind_s(st, 9, h->model ? h->model : pr.model[0] ? pr.model : meta_model);
    sqlite3_bind_int64(st, 10, depth);
    bind_s(st, 11, h->cwd);
    bind_s(st, 12, pr.task);
    bind_s(st, 13, pr.task_source);
    sqlite3_step(st);
    sqlite3_finalize(st);
    if (pending[0]) {
        st = cg_prep(cg, "DELETE FROM agents WHERE agent=?");
        sqlite3_bind_text(st, 1, pending, -1, SQLITE_TRANSIENT);
        sqlite3_step(st);
        sqlite3_finalize(st);
    }
    place_agent(cg, name, h->sname, h->cwd, meta_wt);
    set_task_if_none(cg, name, h->session, meta_desc, NULL, parent);

    /* the spawn's own words travel with the start: isolation, background,
     * and the prompt excerpt live in its agent.native.spawn payload */
    StrBuf x; sb_init(&x);
    put_kv(&x, "tool_use_id", tuid);
    sb_printf(&x, ",\"matched\":%s", pending[0] ? (meta_tuid ? "\"tool_use_id\""
                                                             : "\"type\"")
                                                : "null");
    if (tuid[0]) {
        st = cg_prep(cg,
            "SELECT json_extract(payload,'$.isolation'),"
            "json_extract(payload,'$.run_in_background'),"
            "json_extract(payload,'$.prompt') FROM events "
            "WHERE kind='agent.native.spawn' "
            "AND json_extract(payload,'$.tool_use_id')=? "
            "ORDER BY seq DESC LIMIT 1");
        sqlite3_bind_text(st, 1, tuid, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(st) == SQLITE_ROW) {
            put_kv(&x, "isolation", (const char *)sqlite3_column_text(st, 0));
            sb_printf(&x, ",\"run_in_background\":%s",
                      sqlite3_column_int(st, 1) ? "true" : "false");
            put_kv(&x, "prompt", (const char *)sqlite3_column_text(st, 2));
        }
        sqlite3_finalize(st);
    }
    emit(cg, "agent.native.start", name, name, x.p);
    sb_free(&x);
    free(meta); free(meta_tuid); free(meta_wt); free(meta_desc); free(meta_model);
}

static void record_stop(Cg *cg, const Hook *h, const char *agent,
                        bool subagent) {
    NRow r;
    row_get(cg, agent, &r);
    bool was_live = strcmp(r.state, "stopped") != 0;
    sqlite3_stmt *st = cg_prep(cg,
        "UPDATE agents SET state='stopped',ended=strftime('%s','now'),"
        "seen=strftime('%s','now'),transcript=ifnull(?,transcript) "
        "WHERE agent=?");
    bind_s(st, 1, subagent ? h->agent_transcript : h->transcript);
    sqlite3_bind_text(st, 2, agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
    if (!was_live) return;            /* Stop fires every turn: report once */
    char *msg = excerpt(h->last_message, NATIVE_MESSAGE_CHARS);
    StrBuf x; sb_init(&x);
    put_kv(&x, "hook", h->event);
    put_kv(&x, "transcript", subagent ? h->agent_transcript : h->transcript);
    put_kv(&x, "last_message", msg);
    emit(cg, "agent.native.stop", agent, agent, x.p);
    sb_free(&x);
    free(msg);
}

static bool is_spawn_tool(const char *t) {
    return t && (strcmp(t, "Agent") == 0 || strcmp(t, "Task") == 0);
}

/* One payload, recorded. */
int native_record(Cg *cg, const char *host, const char *payload,
                  char *agent_out, size_t cap) {
    Hook h;
    hook_parse(&h, host, payload);
    if (agent_out && cap) agent_out[0] = 0;
    if (!h.event || !h.session) { hook_free(&h); return -1; }
    const char *ev = h.event;
    char me[256];
    actor(&h, me, sizeof me);

    bool fresh = ensure_session(cg, &h);
    if (strcmp(ev, "SessionStart") == 0) {
        sqlite3_stmt *st = cg_prep(cg,
            "UPDATE agents SET state='live',ended=NULL,"
            "seen=strftime('%s','now'),model=ifnull(?,model),"
            "cwd=ifnull(?,cwd),transcript=ifnull(?,transcript) WHERE agent=?");
        bind_s(st, 1, h.model);
        bind_s(st, 2, h.cwd);
        bind_s(st, 3, h.transcript);
        sqlite3_bind_text(st, 4, h.sname, -1, SQLITE_TRANSIENT);
        sqlite3_step(st);
        sqlite3_finalize(st);
        place_agent(cg, h.sname, h.sname, h.cwd, NULL);
        StrBuf x; sb_init(&x);
        char *src = jstr(payload, "source");
        put_kv(&x, "source", src);
        free(src);
        emit(cg, "agent.native.start", h.sname, h.sname, x.p);
        sb_free(&x);
    } else {
        if (fresh) emit(cg, "agent.native.start", h.sname, h.sname, NULL);
        if (strcmp(ev, "SubagentStart") == 0 && h.agent_id) {
            heartbeat(cg, h.sname, NULL, false);
            record_start(cg, &h);
        } else if (strcmp(ev, "SubagentStop") == 0 && h.agent_id) {
            ensure_subagent(cg, &h, me);
            record_stop(cg, &h, me, true);
        } else if (strcmp(ev, "Stop") == 0 || strcmp(ev, "SessionEnd") == 0) {
            if (h.agent_id) {          /* a subagent's own Stop */
                ensure_subagent(cg, &h, me);
                heartbeat(cg, me, NULL, false);
            } else {
                record_stop(cg, &h, h.sname, false);
            }
        } else {
            bool pre = strcmp(ev, "PreToolUse") == 0;
            bool post = strcmp(ev, "PostToolUse") == 0;
            if (h.agent_id && ensure_subagent(cg, &h, me)) {
                place_agent(cg, me, h.sname, h.cwd, NULL);
                emit(cg, "agent.native.start", me, me, NULL);
            }
            heartbeat(cg, me, (pre || post) ? h.tool_name : NULL, post);
            if (h.agent_id) {
                place_agent(cg, me, h.sname, h.cwd, NULL);
                NRow r;
                row_get(cg, me, &r);
                set_task_if_none(cg, me, h.session, NULL, NULL, r.parent);
            } else if (h.cwd && h.session) {
                set_task_if_none(cg, me, h.session, NULL, NULL, NULL);
            }
            if (pre && is_spawn_tool(h.tool_name)) record_spawn(cg, &h, me);
            if (post) {
                NRow r;
                row_get(cg, me, &r);
                StrBuf x; sb_init(&x);
                put_kv(&x, "tool", h.tool_name);
                put_kv(&x, "tool_use_id", h.tool_use_id);
                sb_printf(&x, ",\"tool_calls\":%ld", r.tool_calls);
                emit(cg, "agent.native.tool", me, me, x.p);
                sb_free(&x);
            }
            if (strcmp(ev, "WorktreeCreate") == 0 ||
                strcmp(ev, "WorktreeRemove") == 0) {
                StrBuf x; sb_init(&x);
                put_kv(&x, "hook", ev);
                sb_puts(&x, ",\"payload\":");
                sb_puts(&x, payload);
                emit(cg, "agent.native.worktree", me, me, x.p);
                sb_free(&x);
            }
        }
    }
    if (agent_out && cap) snprintf(agent_out, cap, "%s", me);
    hook_free(&h);
    return 0;
}

/* ---------------- cg hook event ---------------- */

static char *read_stdin_all(void) {
    if (isatty(STDIN_FILENO)) return NULL;
    StrBuf b; sb_init(&b);
    char chunk[4096];
    size_t n;
    while ((n = fread(chunk, 1, sizeof chunk, stdin)) > 0)
        for (size_t i = 0; i < n; i++) sb_putc(&b, chunk[i]);
    while (b.len && isspace((unsigned char)b.p[b.len - 1])) b.p[--b.len] = 0;
    if (!b.len) { sb_free(&b); return NULL; }
    return b.p;
}

/* Malformed or unusable payloads go to .codegraph/hooks.log and stderr —
 * never to the agent as a failed hook. */
static void hook_log(Cg *cg, const char *why, const char *payload) {
    fprintf(stderr, "cg hook event: %s\n", why);
    char p[4700];
    snprintf(p, sizeof p, "%s/%s/hooks.log", cg->shared, CG_DIR);
    FILE *f = fopen(p, "a");
    if (!f) return;
    char *ex = excerpt(payload ? payload : "", 200);
    for (char *c = ex; *c; c++) if (*c == '\n') *c = ' ';
    fprintf(f, "%ld hook event: %s: %s\n", (long)time(NULL), why, ex);
    free(ex);
    fclose(f);
}

typedef struct { Cg *cg; const char *host; const char *payload; } IngestCall;

static int ingest_call(void *u) {
    IngestCall *c = u;
    return runtime_event_ingest(c->cg, c->host, c->payload, false);
}

int cmd_hook_event(Cg *cg, const char *host, bool json) {
    if (!host || !host[0]) host = "claude";
    char *payload = read_stdin_all();
    if (!payload) {
        if (json) printf("{\"recorded\":false,\"reason\":\"empty payload\"}\n");
        return 0;
    }
    /* the runtime normalization validates the payload structurally; its
     * one-line report is not for the agent (SessionStart stdout would land
     * in the model's context), so it is captured and dropped */
    IngestCall ic = { cg, host, payload };
    char *out = NULL;
    int irc = cg_capture(&out, ingest_call, &ic);
    free(out);
    if (irc != 0) {
        hook_log(cg, "malformed payload (expected one JSON object)", payload);
        if (json) printf("{\"recorded\":false,\"reason\":\"malformed payload\"}\n");
        free(payload);
        return 0;
    }
    char agent[256] = "";
    sqlite3_busy_timeout(cg->db, NATIVE_BUSY_MS);
    int rc = -1;
    if (exec_ok(cg, "BEGIN IMMEDIATE")) {
        rc = native_record(cg, host, payload, agent, sizeof agent);
        if (rc == 0) {
            if (!exec_ok(cg, "COMMIT")) {
                exec_ok(cg, "ROLLBACK");
                rc = -2;
            }
        } else {
            exec_ok(cg, "ROLLBACK");
        }
    } else {
        rc = -2;
    }
    sqlite3_busy_timeout(cg->db, (int)cg->lock_wait_ms);
    /* codify-v15 3.3: work events mark the projection dirty and may start a
     * background build; session starts and prompts are not work */
    if (rc == 0) {
        char *ev = jstr(payload, "hook_event_name");
        if (ev && (!strcmp(ev, "PostToolUse") || !strcmp(ev, "Stop") ||
                   !strcmp(ev, "SubagentStop") || !strcmp(ev, "SessionEnd") ||
                   !strcmp(ev, "WorktreeCreate") || !strcmp(ev, "WorktreeRemove"))) {
            projection_mark_dirty(cg, ev);
            projection_auto_build(cg, ev, NULL);
        }
        free(ev);
    }
    if (rc == -1)
        hook_log(cg, "payload without hook_event_name or session_id", payload);
    else if (rc == -2)
        hook_log(cg, "database busy; native agent not recorded", payload);
    if (json) {
        printf("{\"recorded\":%s,\"agent\":", rc == 0 ? "true" : "false");
        if (agent[0]) { StrBuf b; sb_init(&b); sb_json_str(&b, agent);
                        fputs(b.p, stdout); sb_free(&b); }
        else fputs("null", stdout);
        puts("}");
    }
    free(payload);
    return 0;
}

/* ---------------- the views ---------------- */

typedef struct {
    char agent[256], host[32], session[160], model[128], state[16],
         cwd[1024], worktree[1024], branch[256], task[256], task_source[16],
         description[512], agent_type[128], parent[256], last_tool[128],
         transcript[1024];
    long started, seen, ended, depth, tool_calls;
    bool hidden;
} NView;

static int load_views(Cg *cg, NView **out) {
    *out = NULL;
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db,
            "SELECT agent,ifnull(host_kind,''),ifnull(session,''),"
            "ifnull(model,''),ifnull(state,''),ifnull(cwd,''),"
            "ifnull(worktree,''),ifnull(branch,''),ifnull(task,''),"
            "ifnull(task_source,''),ifnull(description,''),"
            "ifnull(agent_type,''),ifnull(parent,''),ifnull(last_tool,''),"
            "ifnull(transcript,''),ifnull(started,0),seen,ifnull(ended,0),"
            "ifnull(depth,0),ifnull(tool_calls,0) FROM agents "
            "WHERE kind='native' ORDER BY depth, started, agent",
            -1, &st, NULL) != SQLITE_OK)
        return 0;                       /* a database before schema 18 */
    int n = 0, cap = 0;
    NView *v = NULL;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n == cap) {
            cap = cap ? cap * 2 : 16;
            v = xrealloc(v, sizeof *v * (size_t)cap);
        }
        NView *r = &v[n++];
        memset(r, 0, sizeof *r);
        col_cpy(st, 0, r->agent, sizeof r->agent);
        col_cpy(st, 1, r->host, sizeof r->host);
        col_cpy(st, 2, r->session, sizeof r->session);
        col_cpy(st, 3, r->model, sizeof r->model);
        col_cpy(st, 4, r->state, sizeof r->state);
        col_cpy(st, 5, r->cwd, sizeof r->cwd);
        col_cpy(st, 6, r->worktree, sizeof r->worktree);
        col_cpy(st, 7, r->branch, sizeof r->branch);
        col_cpy(st, 8, r->task, sizeof r->task);
        col_cpy(st, 9, r->task_source, sizeof r->task_source);
        col_cpy(st, 10, r->description, sizeof r->description);
        col_cpy(st, 11, r->agent_type, sizeof r->agent_type);
        col_cpy(st, 12, r->parent, sizeof r->parent);
        col_cpy(st, 13, r->last_tool, sizeof r->last_tool);
        col_cpy(st, 14, r->transcript, sizeof r->transcript);
        r->started = (long)sqlite3_column_int64(st, 15);
        r->seen = (long)sqlite3_column_int64(st, 16);
        r->ended = (long)sqlite3_column_int64(st, 17);
        r->depth = (long)sqlite3_column_int64(st, 18);
        r->tool_calls = (long)sqlite3_column_int64(st, 19);
    }
    sqlite3_finalize(st);
    /* a session stopped for more than a day is hidden with its subtree */
    long now = (long)time(NULL);
    for (int i = 0; i < n; i++) {
        if (v[i].parent[0]) continue;
        long last = v[i].ended > v[i].seen ? v[i].ended : v[i].seen;
        v[i].hidden = !native_show_all && strcmp(v[i].state, "stopped") == 0 &&
                      now - last > NATIVE_HIDE_S;
    }
    for (int pass = 0; pass < 8; pass++)
        for (int i = 0; i < n; i++) {
            if (!v[i].parent[0] || v[i].hidden) continue;
            for (int j = 0; j < n; j++)
                if (v[j].hidden && strcmp(v[j].agent, v[i].parent) == 0) {
                    v[i].hidden = true;
                    break;
                }
        }
    *out = v;
    return n;
}

static bool is_root(const NView *v, int n, int i) {
    if (!v[i].parent[0]) return true;
    for (int j = 0; j < n; j++)
        if (strcmp(v[j].agent, v[i].parent) == 0) return false;
    return true;                         /* an orphan shows at the top */
}

static const char *shown_state(const NView *r) {
    if (strcmp(r->state, "live") == 0 &&
        (long)time(NULL) - r->seen > NATIVE_STALE_S)
        return "stale";
    return r->state[0] ? r->state : "?";
}

static void age(long t, char *out, size_t cap) {
    long d = (long)time(NULL) - t;
    if (d < 0) d = 0;
    if (d < 90) snprintf(out, cap, "%lds ago", d);
    else if (d < 5400) snprintf(out, cap, "%ldm ago", (d + 30) / 60);
    else if (d < 172800) snprintf(out, cap, "%ldh ago", (d + 1800) / 3600);
    else snprintf(out, cap, "%ldd ago", d / 86400);
}

static void text_node(StrBuf *b, const NView *v, int n, int i, int indent) {
    const NView *r = &v[i];
    char when[32];
    age(r->seen, when, sizeof when);
    sb_printf(b, "%*s%s", indent, "", r->agent);
    if (r->agent_type[0] && r->parent[0]) sb_printf(b, " [%s]", r->agent_type);
    sb_printf(b, "  %s  %s  %s  model %s  branch %s%s  task %s%s%s%s  last %s",
              shown_state(r), when, r->host[0] ? r->host : "?",
              r->model[0] ? r->model : "-", r->branch[0] ? r->branch : "-",
              r->worktree[0] ? " (worktree)" : "",
              r->task[0] ? r->task : "-", r->task_source[0] ? " (" : "",
              r->task_source, r->task_source[0] ? ")" : "",
              r->last_tool[0] ? r->last_tool : "-");
    if (r->description[0]) sb_printf(b, "  — %s", r->description);
    sb_putc(b, '\n');
    for (int j = 0; j < n; j++)
        if (!v[j].hidden && j != i && strcmp(v[j].parent, r->agent) == 0)
            text_node(b, v, n, j, indent + 2);
}

static void json_node(StrBuf *b, const NView *v, int n, int i, int guard) {
    const NView *r = &v[i];
    sb_puts(b, "{\"agent\":");
    sb_json_str(b, r->agent);
    put_kv(b, "host", r->host);
    put_kv(b, "session", r->session);
    put_kv(b, "model", r->model);
    sb_printf(b, ",\"started\":%ld", r->started);
    put_kv(b, "state", r->state);
    sb_printf(b, ",\"stale\":%s,\"seen\":%ld",
              strcmp(shown_state(r), "stale") == 0 ? "true" : "false", r->seen);
    put_kv(b, "cwd", r->cwd);
    put_kv(b, "worktree", r->worktree);
    put_kv(b, "branch", r->branch);
    put_kv(b, "task", r->task);
    put_kv(b, "task_source", r->task_source);
    put_kv(b, "description", r->description);
    put_kv(b, "agent_type", r->agent_type);
    put_kv(b, "parent", r->parent);
    sb_printf(b, ",\"depth\":%ld", r->depth);
    put_kv(b, "last_tool", r->last_tool);
    sb_printf(b, ",\"tool_calls\":%ld", r->tool_calls);
    if (r->ended) sb_printf(b, ",\"ended\":%ld", r->ended);
    else sb_puts(b, ",\"ended\":null");
    put_kv(b, "transcript", r->transcript);
    sb_puts(b, ",\"children\":[");
    int k = 0;
    if (guard < 16)
        for (int j = 0; j < n; j++)
            if (!v[j].hidden && j != i && strcmp(v[j].parent, r->agent) == 0) {
                if (k++) sb_putc(b, ',');
                json_node(b, v, n, j, guard + 1);
            }
    sb_puts(b, "]}");
}

/* native: [...] — sessions at the top, their subagents nested */
void native_tree_json(Cg *cg, StrBuf *b) {
    NView *v;
    int n = load_views(cg, &v);
    sb_putc(b, '[');
    int k = 0;
    for (int i = 0; i < n; i++) {
        if (v[i].hidden || !is_root(v, n, i)) continue;
        if (k++) sb_putc(b, ',');
        json_node(b, v, n, i, 0);
    }
    sb_putc(b, ']');
    free(v);
}

/* The section cg fleet status appends after the fleet roles: text prints
 * nothing when no native agent is visible; JSON adds ,"native":[...]. */
void native_fleet_section(Cg *cg, StrBuf *b, bool json) {
    if (json) {
        sb_puts(b, ",\"native\":");
        native_tree_json(cg, b);
        return;
    }
    NView *v;
    int n = load_views(cg, &v);
    int shown = 0;
    for (int i = 0; i < n; i++) {
        if (v[i].hidden || !is_root(v, n, i)) continue;
        if (!shown++) sb_puts(b, "native sessions:\n");
        text_node(b, v, n, i, 2);
    }
    free(v);
}

/* cg fleet tree --json with the native sessions beside the hierarchy. A
 * flat repository (no [hierarchy]) still answers with its native agents. */
typedef struct { Cg *cg; const char *feature; } TreeCall;

static int tree_call(void *u) {
    TreeCall *t = u;
    return orch_tree_status(t->cg, t->feature, true);
}

int native_fleet_tree_json(Cg *cg, const char *feature) {
    char wp[4700];
    Hierarchy h;
    memset(&h, 0, sizeof h);
    Kvx *wf = config_workflow_path(cg->root, wp, sizeof wp) ? kvx_parse(wp)
                                                             : NULL;
    hier_load(wf, &h);
    bool configured = h.configured;
    hier_free(&h);
    kvx_free(wf);
    StrBuf b; sb_init(&b);
    int rc = 0;
    if (!configured) {
        sb_puts(&b, "{\"hierarchy\":false");
        native_fleet_section(cg, &b, true);
        projection_tree_json(cg, &b);           /* codify-v15 3.3 */
        sb_puts(&b, "}\n");
    } else {
        TreeCall t = { cg, feature };
        char *out = NULL;
        rc = cg_capture(&out, tree_call, &t);
        size_t len = out ? strlen(out) : 0;
        while (len && isspace((unsigned char)out[len - 1])) len--;
        if (rc == 0 && len && out[len - 1] == '}') {
            out[len - 1] = 0;
            sb_puts(&b, out);
            native_fleet_section(cg, &b, true);
            projection_tree_json(cg, &b);       /* codify-v15 3.3 */
            sb_puts(&b, "}\n");
        } else if (out) {
            sb_puts(&b, out);
        }
        free(out);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    return rc;
}

/* native agents: N live, M subagents, K worktree branches */
bool native_counts(Cg *cg, int *live, int *subs, int *branches) {
    *live = *subs = *branches = 0;
    NView *v;
    int n = load_views(cg, &v);
    int visible = 0;
    char **seen = n ? xmalloc(sizeof(char *) * (size_t)n) : NULL;
    int ns = 0;
    for (int i = 0; i < n; i++) {
        if (v[i].hidden || strcmp(v[i].state, "pending") == 0) continue;
        visible++;
        bool on = strcmp(shown_state(&v[i]), "live") == 0;
        if (!v[i].parent[0]) { if (on) (*live)++; }
        else if (on) (*subs)++;
        if (v[i].worktree[0] && v[i].branch[0]) {
            bool dup = false;
            for (int j = 0; j < ns && !dup; j++) dup = !strcmp(seen[j], v[i].branch);
            if (!dup) seen[ns++] = v[i].branch;
        }
    }
    *branches = ns;
    free(seen);
    free(v);
    return visible > 0;
}

/* the one line cg brief and cg state print; nothing when no native agent */
void native_summary(Cg *cg, StrBuf *b, bool json) {
    int live, subs, brs;
    bool any = native_counts(cg, &live, &subs, &brs);
    if (json) {
        sb_printf(b, ",\"native\":{\"live\":%d,\"subagents\":%d,"
                  "\"worktree_branches\":%d}", live, subs, brs);
        return;
    }
    if (!any) return;
    sb_printf(b, "native agents: %d live, %d subagent%s, %d worktree branch%s"
              " — cg fleet status\n", live, subs, subs == 1 ? "" : "s", brs,
              brs == 1 ? "" : "es");
}

void native_flags(int argc, char **argv) {
    for (int i = 0; i < argc; i++)
        if (strcmp(argv[i], "--all") == 0) native_show_all = true;
}

/* ---------------- cg fleet discover ---------------- */

/* Hosts without hooks — an older host, a hook the user has not trusted, a
 * session started before the plugin — still write transcripts. Discovery
 * reads them (spec/codify-v15 req 7):
 *   - Claude Code: <claude dir>/<session>.jsonl and, per session,
 *     <session>/subagents/agent-<id>.jsonl with agent-<id>.meta.json
 *     (agentType, worktreePath, worktreeBranch, description, model,
 *     spawnDepth, toolUseId); the claude dirs are those of the main tree, of
 *     this tree, and of every registered worktree;
 *   - Codex: rollouts whose session_meta cwd is inside this project.
 * Directories come from transcript_dirs (recap.c), the one lookup recap uses.
 *
 * Provenance: the agents column `discovered` (added on first use) lists the
 * fields discovery wrote, "row" first when discovery created the row. A field
 * is written only while it is empty, so whatever a hook wrote is never
 * overwritten, and a hook arriving later simply wins. Two things move on a
 * row after it is filled: `seen` follows the transcript's mtime on rows
 * discovery created; and `state` goes live -> stale when the transcript and
 * the last hook are both older than 15 minutes, back to live (only when
 * discovery set the stale) when the transcript moves again — any hook's
 * heartbeat makes it live as well. A pending spawn named by a meta.json's
 * toolUseId is claimed exactly as SubagentStart claims it. */

#define DISCOVER_STALE_S   900     /* transcript untouched: the agent is stale */
#define DISCOVER_EVERY_S   10      /* automatic runs: at most one per process */
#define DISCOVER_HEAD_LINES 400    /* lines read for cwd, model, prompt */

bool native_no_discover = false;

typedef struct {
    long now, oldest;
    StrBuf found, changed;
    int nfound, nchanged, nclaude, ncodex;
    char **seen_dirs;
    int nseen_dirs;
} Disc;

/* one agent's changes during this run, reported once */
typedef struct {
    char agent[256];
    bool created;
    char claimed[256];
    StrBuf fields;
    const char *state;
} Delta;

static void delta_init(Delta *d, const char *agent) {
    memset(d, 0, sizeof *d);
    snprintf(d->agent, sizeof d->agent, "%s", agent);
    sb_init(&d->fields);
}

static void delta_field(Delta *d, const char *f) {
    if (d->fields.len) sb_putc(&d->fields, ',');
    sb_putc(&d->fields, '"');
    sb_puts(&d->fields, f);
    sb_putc(&d->fields, '"');
}

static void delta_done(Disc *D, Delta *d) {
    if (d->created || d->fields.len || d->state || d->claimed[0]) {
        if (D->nchanged++) sb_putc(&D->changed, ',');
        sb_puts(&D->changed, "{\"agent\":");
        sb_json_str(&D->changed, d->agent);
        sb_printf(&D->changed, ",\"created\":%s,\"fields\":[%s]",
                  d->created ? "true" : "false", d->fields.len ? d->fields.p : "");
        put_kv(&D->changed, "state", d->state);
        put_kv(&D->changed, "claimed", d->claimed);
        sb_putc(&D->changed, '}');
    }
    sb_free(&d->fields);
}

static long mtime_of(const char *p) {
    struct stat st;
    return stat(p, &st) == 0 ? (long)st.st_mtime : 0;
}

static bool is_dir(const char *p) {
    struct stat st;
    return stat(p, &st) == 0 && S_ISDIR(st.st_mode);
}

static bool ends_with(const char *s, const char *suf) {
    size_t n = strlen(s), m = strlen(suf);
    return n >= m && strcmp(s + n - m, suf) == 0;
}

/* 2026-10-13T01:10:53.654Z -> epoch seconds; 0 when unreadable */
static long iso_time(const char *ts) {
    if (!ts || !ts[0]) return 0;
    struct tm tm;
    memset(&tm, 0, sizeof tm);
    if (sscanf(ts, "%d-%d-%dT%d:%d:%d", &tm.tm_year, &tm.tm_mon, &tm.tm_mday,
               &tm.tm_hour, &tm.tm_min, &tm.tm_sec) != 6)
        return 0;
    tm.tm_year -= 1900;
    tm.tm_mon -= 1;
    return (long)timegm(&tm);
}

static bool has_agents_column(Cg *cg, const char *col) {
    sqlite3_stmt *q = NULL;
    bool have = false;
    if (sqlite3_prepare_v2(cg->db, "SELECT 1 FROM pragma_table_info('agents') "
                           "WHERE name=?", -1, &q, NULL) == SQLITE_OK) {
        sqlite3_bind_text(q, 1, col, -1, SQLITE_STATIC);
        have = sqlite3_step(q) == SQLITE_ROW;
        sqlite3_finalize(q);
    }
    return have;
}

/* false on a database without the native columns (before schema 18) */
static bool ensure_discovered_column(Cg *cg) {
    if (!has_agents_column(cg, "state")) return false;
    if (!has_agents_column(cg, "discovered"))
        exec_ok(cg, "ALTER TABLE agents ADD COLUMN discovered TEXT");
    return has_agents_column(cg, "discovered");
}

/* is field f in the agent's discovered list? */
static bool disc_has(Cg *cg, const char *agent, const char *f) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT 1 FROM agents WHERE agent=? AND "
        "instr(','||ifnull(discovered,'')||',', ','||?||',')>0");
    sqlite3_bind_text(st, 1, agent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, f, -1, SQLITE_TRANSIENT);
    bool r = sqlite3_step(st) == SQLITE_ROW;
    sqlite3_finalize(st);
    return r;
}

static void disc_note(Cg *cg, const char *agent, const char *f) {
    if (disc_has(cg, agent, f)) return;
    sqlite3_stmt *st = cg_prep(cg,
        "UPDATE agents SET discovered=CASE WHEN ifnull(discovered,'')='' "
        "THEN ?1 ELSE discovered||','||?1 END WHERE agent=?2");
    sqlite3_bind_text(st, 1, f, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* Write column col only while it is empty: a hook's value always stands. */
static void fill(Cg *cg, Delta *d, const char *col, const char *v) {
    if (!v || !v[0]) return;
    char sql[256];
    snprintf(sql, sizeof sql, "UPDATE agents SET %s=? WHERE agent=? AND "
             "(%s IS NULL OR %s='')", col, col, col);
    sqlite3_stmt *st = cg_prep(cg, sql);
    sqlite3_bind_text(st, 1, v, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, d->agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
    if (sqlite3_changes(cg->db) > 0) {
        disc_note(cg, d->agent, col);
        delta_field(d, col);
    }
}

static void fill_int(Cg *cg, Delta *d, const char *col, long v) {
    if (v <= 0) return;
    char sql[256];
    snprintf(sql, sizeof sql, "UPDATE agents SET %s=? WHERE agent=? AND "
             "%s IS NULL", col, col);
    sqlite3_stmt *st = cg_prep(cg, sql);
    sqlite3_bind_int64(st, 1, v);
    sqlite3_bind_text(st, 2, d->agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
    if (sqlite3_changes(cg->db) > 0) {
        disc_note(cg, d->agent, col);
        delta_field(d, col);
    }
}

/* A row discovery creates: live, seen at the transcript's mtime. */
static void disc_create(Cg *cg, Delta *d, const char *host, const char *session,
                        const char *parent, const char *agent_id, long depth,
                        long started, long mtime, const char *task,
                        const char *task_source) {
    sqlite3_stmt *st = cg_prep(cg,
        "INSERT INTO agents(agent,kind,host,host_kind,session,parent,agent_id,"
        "depth,state,started,seen,task,task_source,discovered) "
        "VALUES(?,'native',?,?,?,?,?,?,'live',?,?,?,?,'row') "
        "ON CONFLICT(agent) DO NOTHING");
    sqlite3_bind_text(st, 1, d->agent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, machine(), -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, host, -1, SQLITE_TRANSIENT);
    bind_s(st, 4, session);
    bind_s(st, 5, parent);
    bind_s(st, 6, agent_id);
    sqlite3_bind_int64(st, 7, depth);
    sqlite3_bind_int64(st, 8, started > 0 ? started : mtime);
    sqlite3_bind_int64(st, 9, mtime);
    bind_s(st, 10, task);
    bind_s(st, 11, task_source);
    sqlite3_step(st);
    sqlite3_finalize(st);
    d->created = sqlite3_changes(cg->db) > 0;
}

/* seen and the stale mark, from the transcript's mtime */
static void disc_liveness(Cg *cg, Disc *D, Delta *d, long mtime) {
    if (mtime <= 0) return;
    if (disc_has(cg, d->agent, "row")) {
        sqlite3_stmt *st = cg_prep(cg,
            "UPDATE agents SET seen=? WHERE agent=? AND seen<?");
        sqlite3_bind_int64(st, 1, mtime);
        sqlite3_bind_text(st, 2, d->agent, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(st, 3, mtime);
        sqlite3_step(st);
        sqlite3_finalize(st);
    }
    char state[16] = "";
    long seen = 0;
    sqlite3_stmt *st = cg_prep(cg, "SELECT ifnull(state,''),seen FROM agents "
                                   "WHERE agent=?");
    sqlite3_bind_text(st, 1, d->agent, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(st) == SQLITE_ROW) {
        col_cpy(st, 0, state, sizeof state);
        seen = (long)sqlite3_column_int64(st, 1);
    }
    sqlite3_finalize(st);
    long last = seen > mtime ? seen : mtime;
    const char *to = NULL;
    if (strcmp(state, "live") == 0 && D->now - last > DISCOVER_STALE_S)
        to = "stale";
    else if (strcmp(state, "stale") == 0 && D->now - mtime <= DISCOVER_STALE_S &&
             disc_has(cg, d->agent, "state"))
        to = "live";
    if (!to) return;
    st = cg_prep(cg, "UPDATE agents SET state=? WHERE agent=?");
    sqlite3_bind_text(st, 1, to, -1, SQLITE_STATIC);
    sqlite3_bind_text(st, 2, d->agent, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
    disc_note(cg, d->agent, "state");
    d->state = to;
}

/* Where an agent works: cwd, branch, and — inside a linked worktree of this
 * project — the worktree, registered as req 6 ac_2 registers it (base: the
 * session's branch). Only empty columns are written. */
static void disc_place(Cg *cg, Delta *d, const char *sname, const char *cwd,
                       const char *wt_hint) {
    char wt[4096] = "", br[256] = "", head[65] = "";
    bool linked = false;
    if (wt_hint && wt_hint[0] && is_dir(wt_hint))
        linked = native_worktree(cg, wt_hint, wt, sizeof wt, br, sizeof br,
                                 head, sizeof head);
    if (!linked && cwd && cwd[0])
        linked = native_worktree(cg, cwd, wt, sizeof wt, br, sizeof br,
                                 head, sizeof head);
    bool named = br[0] && strcmp(br, "(detached)") != 0;
    if (linked && named) {
        char base[256] = "";
        if (strcmp(d->agent, sname) != 0) session_branch(cg, sname, base, sizeof base);
        if (strcmp(base, br) == 0) base[0] = 0;
        branch_register(cg, br, wt, head, base[0] ? base : NULL);
        fill(cg, d, "worktree", wt);
    }
    fill(cg, d, "cwd", linked ? wt : cwd);
    if (named) fill(cg, d, "branch", br);
}

static void disc_found(Disc *D, const char *agent, const char *host,
                       const char *kind, const char *session,
                       const char *transcript, long mtime) {
    if (D->nfound++) sb_putc(&D->found, ',');
    sb_puts(&D->found, "{\"agent\":");
    sb_json_str(&D->found, agent);
    put_kv(&D->found, "host", host);
    put_kv(&D->found, "kind", kind);
    put_kv(&D->found, "session", session);
    put_kv(&D->found, "transcript", transcript);
    sb_printf(&D->found, ",\"mtime\":%ld,\"stale\":%s}", mtime,
              D->now - mtime > DISCOVER_STALE_S ? "true" : "false");
}

static void disc_finish(Cg *cg, Disc *D, Delta *d) {
    if (d->created)
        emit(cg, "agent.native.start", d->agent, d->agent,
             ",\"source\":\"discover\"");
    delta_done(D, d);
}

/* The first lines of a Claude Code transcript: cwd, model, the first
 * timestamp, and (want_prompt) the first user message when it is text. */
typedef struct { char cwd[4096], model[128], ts[64]; char *prompt; } Head;

static void claude_head(const char *path, Head *h, bool want_prompt) {
    memset(h, 0, sizeof *h);
    FILE *f = fopen(path, "r");
    if (!f) return;
    char *line = NULL; size_t cap = 0;
    for (int n = 0; n < DISCOVER_HEAD_LINES && getline(&line, &cap, f) > 0; n++) {
        if (!h->cwd[0]) {
            char *v = jstr(line, "cwd");
            if (v) snprintf(h->cwd, sizeof h->cwd, "%s", v);
            free(v);
        }
        if (!h->ts[0]) {
            char *v = jstr(line, "timestamp");
            if (v) snprintf(h->ts, sizeof h->ts, "%s", v);
            free(v);
        }
        char *type = jstr(line, "type");
        bool asst = type && strcmp(type, "assistant") == 0;
        bool user = type && strcmp(type, "user") == 0;
        free(type);
        if ((asst && !h->model[0]) || (user && want_prompt && !h->prompt)) {
            char *m = json_get_object(line, "message");
            if (asst) {
                char *v = jstr(m, "model");
                if (v && strcmp(v, "<synthetic>") != 0)
                    snprintf(h->model, sizeof h->model, "%s", v);
                free(v);
            } else {
                h->prompt = jstr(m, "content");   /* NULL for block arrays */
            }
            free(m);
        }
        if (h->cwd[0] && h->model[0] && h->ts[0] && (!want_prompt || h->prompt))
            break;
    }
    free(line);
    fclose(f);
}

/* The agent that spawned a nested subagent: the sibling whose transcript
 * holds the spawn's tool_use id. */
static void nested_parent(const char *subdir, const char *self_id,
                          const char *tuid, char *out, size_t cap) {
    out[0] = 0;
    DIR *dd = opendir(subdir);
    if (!dd) return;
    struct dirent *de;
    while ((de = readdir(dd)) != NULL && !out[0]) {
        const char *n = de->d_name;
        if (strncmp(n, "agent-", 6) != 0 || !ends_with(n, ".jsonl")) continue;
        char id[256];
        snprintf(id, sizeof id, "%.*s", (int)(strlen(n) - 12), n + 6);
        if (!id[0] || strcmp(id, self_id) == 0) continue;
        char p[4700];
        int w = snprintf(p, sizeof p, "%s/%s", subdir, n);
        if (w <= 0 || (size_t)w >= sizeof p) continue;
        char *body = read_entire_file(p, NULL);
        if (body && strstr(body, tuid) &&
            snprintf(out, cap, "claude:%s", id) >= (int)cap)
            out[0] = 0;
        free(body);
    }
    closedir(dd);
}

static void discover_subagent(Cg *cg, Disc *D, const char *sid,
                              const char *sname, const char *subdir,
                              const char *aid) {
    char tpath[4700], mpath[4700];
    int w1 = snprintf(tpath, sizeof tpath, "%s/agent-%s.jsonl", subdir, aid);
    int w2 = snprintf(mpath, sizeof mpath, "%s/agent-%s.meta.json", subdir, aid);
    if (w1 <= 0 || w2 <= 0 || (size_t)w1 >= sizeof tpath ||
        (size_t)w2 >= sizeof mpath)
        return;
    long mtime = mtime_of(tpath);
    bool have_t = mtime > 0;
    if (!mtime) mtime = mtime_of(mpath);
    if (!mtime) return;
    char *meta = read_entire_file(mpath, NULL);
    char *m_type = jstr(meta, "agentType"), *m_wt = jstr(meta, "worktreePath"),
         *m_desc = jstr(meta, "description"), *m_model = jstr(meta, "model"),
         *m_tuid = jstr(meta, "toolUseId"), *m_wbr = jstr(meta, "worktreeBranch");
    long m_depth = meta ? json_get_int(meta, "spawnDepth", 0) : 0;

    char name[256];
    snprintf(name, sizeof name, "claude:%s", aid);
    Delta d;
    delta_init(&d, name);
    NRow r;
    row_get(cg, name, &r);

    /* a spawn a PreToolUse hook announced and no SubagentStart claimed */
    NRow pr;
    memset(&pr, 0, sizeof pr);
    char pending[256] = "";
    if (!r.found && m_tuid) {
        snprintf(pending, sizeof pending, "claude:spawn:%s", m_tuid);
        row_get(cg, pending, &pr);
        if (!pr.found || strcmp(pr.state, "pending") != 0) {
            pending[0] = 0;
            memset(&pr, 0, sizeof pr);
        }
    }
    Head h;
    claude_head(tpath, &h, true);
    char parent[256] = "";
    if (pr.found && pr.parent[0]) snprintf(parent, sizeof parent, "%s", pr.parent);
    else if (m_depth > 1 && m_tuid)
        nested_parent(subdir, aid, m_tuid, parent, sizeof parent);
    if (!parent[0]) snprintf(parent, sizeof parent, "%s", sname);
    long depth = pr.found ? pr.depth : m_depth > 0 ? m_depth : 1;
    if (!r.found) {
        disc_create(cg, &d, "claude", sid, parent, aid, depth, iso_time(h.ts),
                    mtime, pr.task[0] ? pr.task : NULL,
                    pr.task_source[0] ? pr.task_source : NULL);
        if (pending[0] && d.created) {
            sqlite3_stmt *st = cg_prep(cg, "DELETE FROM agents WHERE agent=?");
            sqlite3_bind_text(st, 1, pending, -1, SQLITE_TRANSIENT);
            sqlite3_step(st);
            sqlite3_finalize(st);
            snprintf(d.claimed, sizeof d.claimed, "%s", pending);
        }
    }
    fill(cg, &d, "parent", parent);
    fill(cg, &d, "session", sid);
    fill(cg, &d, "agent_id", aid);
    fill(cg, &d, "agent_type", m_type ? m_type : "general-purpose");
    fill(cg, &d, "description", pr.description[0] ? pr.description : m_desc);
    fill(cg, &d, "model", pr.model[0] ? pr.model : m_model ? m_model : h.model);
    fill_int(cg, &d, "depth", depth);
    if (have_t) fill(cg, &d, "transcript", tpath);
    disc_place(cg, &d, sname, h.cwd[0] ? h.cwd : NULL, m_wt);
    if (m_wbr) fill(cg, &d, "branch", m_wbr);
    NRow now;
    row_get(cg, name, &now);
    if (!now.task[0]) {
        char task[256];
        const char *src = attribute_task(cg, false, sid, now.description,
                                         h.prompt, now.parent, task, sizeof task);
        if (src) {
            fill(cg, &d, "task", task);
            fill(cg, &d, "task_source", src);
        }
    }
    disc_liveness(cg, D, &d, mtime);
    disc_found(D, name, "claude", "subagent", sid, have_t ? tpath : mpath, mtime);
    D->nclaude++;
    disc_finish(cg, D, &d);
    free(h.prompt);
    free(meta); free(m_type); free(m_wt); free(m_desc); free(m_model);
    free(m_tuid); free(m_wbr);
}

static long meta_depth(const char *subdir, const char *aid) {
    char mp[4700];
    int w = snprintf(mp, sizeof mp, "%s/agent-%s.meta.json", subdir, aid);
    if (w <= 0 || (size_t)w >= sizeof mp) return 1;
    char *meta = read_entire_file(mp, NULL);
    long dep = meta ? json_get_int(meta, "spawnDepth", 1) : 1;
    free(meta);
    return dep;
}

static void discover_session(Cg *cg, Disc *D, const char *dir, const char *sid) {
    char tpath[4700], subdir[4700];
    int w1 = snprintf(tpath, sizeof tpath, "%s/%s.jsonl", dir, sid);
    int w2 = snprintf(subdir, sizeof subdir, "%s/%s/subagents", dir, sid);
    if (w1 <= 0 || w2 <= 0 || (size_t)w1 >= sizeof tpath ||
        (size_t)w2 >= sizeof subdir)
        return;
    long smtime = mtime_of(tpath), newest = smtime;

    /* the subagents of the session, each by its id */
    char **ids = NULL;
    int nids = 0, cids = 0;
    DIR *dd = opendir(subdir);
    if (dd) {
        struct dirent *de;
        while ((de = readdir(dd)) != NULL) {
            const char *n = de->d_name;
            if (strncmp(n, "agent-", 6) != 0) continue;
            size_t cut = ends_with(n, ".meta.json") ? 10
                       : ends_with(n, ".jsonl") ? 6 : 0;
            if (!cut || strlen(n) <= 6 + cut) continue;
            char id[256];
            snprintf(id, sizeof id, "%.*s", (int)(strlen(n) - 6 - cut), n + 6);
            char p[4700];
            int w = snprintf(p, sizeof p, "%s/%s", subdir, n);
            if (w > 0 && (size_t)w < sizeof p) {
                long m = mtime_of(p);
                if (m > newest) newest = m;
            }
            bool dup = false;
            for (int i = 0; i < nids && !dup; i++) dup = !strcmp(ids[i], id);
            if (dup) continue;
            if (nids == cids) {
                cids = cids ? cids * 2 : 8;
                ids = xrealloc(ids, sizeof *ids * (size_t)cids);
            }
            ids[nids++] = xstrdup(id);
        }
        closedir(dd);
    }
    if (newest > 0 && newest >= D->oldest) {
        char sname[160];
        snprintf(sname, sizeof sname, "claude:%.8s", sid);
        Delta d;
        delta_init(&d, sname);
        NRow r;
        row_get(cg, sname, &r);
        Head h;
        memset(&h, 0, sizeof h);
        if (smtime && (!r.found || !r.cwd[0] || !r.model[0]))
            claude_head(tpath, &h, false);
        long when = smtime ? smtime : newest;
        if (!r.found)
            disc_create(cg, &d, "claude", sid, NULL, NULL, 0, iso_time(h.ts),
                        when, NULL, NULL);
        fill(cg, &d, "session", sid);
        fill(cg, &d, "model", h.model);
        if (smtime) fill(cg, &d, "transcript", tpath);
        if (h.cwd[0]) disc_place(cg, &d, sname, h.cwd, NULL);
        if (!r.task[0]) {
            char task[256];
            const char *src = attribute_task(cg, false, sid, NULL, NULL, NULL,
                                             task, sizeof task);
            if (src) { fill(cg, &d, "task", task); fill(cg, &d, "task_source", src); }
        }
        disc_liveness(cg, D, &d, when);
        disc_found(D, sname, "claude", "session", sid, smtime ? tpath : subdir,
                   when);
        D->nclaude++;
        disc_finish(cg, D, &d);
        /* depth 1 first, so a nested subagent finds its parent's row */
        for (int pass = 0; pass < 2; pass++)
            for (int i = 0; i < nids; i++) {
                bool top = meta_depth(subdir, ids[i]) <= 1;
                if ((pass == 0) == top)
                    discover_subagent(cg, D, sid, sname, subdir, ids[i]);
            }
    }
    for (int i = 0; i < nids; i++) free(ids[i]);
    free(ids);
}

static void discover_claude_dir(Cg *cg, Disc *D, const char *dir) {
    for (int i = 0; i < D->nseen_dirs; i++)
        if (strcmp(D->seen_dirs[i], dir) == 0) return;
    D->seen_dirs = xrealloc(D->seen_dirs,
                            sizeof(char *) * (size_t)(D->nseen_dirs + 1));
    D->seen_dirs[D->nseen_dirs++] = xstrdup(dir);
    DIR *dd = opendir(dir);
    if (!dd) return;
    char **sids = NULL;
    int n = 0, c = 0;
    struct dirent *de;
    while ((de = readdir(dd)) != NULL) {
        const char *nm = de->d_name;
        if (nm[0] == '.') continue;
        char sid[256];
        if (ends_with(nm, ".jsonl")) {
            snprintf(sid, sizeof sid, "%.*s", (int)(strlen(nm) - 6), nm);
        } else {
            char p[4700];
            int w = snprintf(p, sizeof p, "%s/%s/subagents", dir, nm);
            if (w <= 0 || (size_t)w >= sizeof p || !is_dir(p)) continue;
            snprintf(sid, sizeof sid, "%s", nm);
        }
        bool dup = !sid[0];
        for (int i = 0; i < n && !dup; i++) dup = !strcmp(sids[i], sid);
        if (dup) continue;
        if (n == c) {
            c = c ? c * 2 : 16;
            sids = xrealloc(sids, sizeof *sids * (size_t)c);
        }
        sids[n++] = xstrdup(sid);
    }
    closedir(dd);
    for (int i = 0; i < n; i++) {
        discover_session(cg, D, dir, sids[i]);
        free(sids[i]);
    }
    free(sids);
}

/* Claude Code: the project directories of the main tree, this tree, and
 * every registered worktree (a session opened inside a worktree). */
static void discover_claude(Cg *cg, Disc *D) {
    char dir[4300];
    transcript_dirs(cg->shared, dir, sizeof dir, NULL, 0);
    discover_claude_dir(cg, D, dir);
    transcript_dirs(cg->root, dir, sizeof dir, NULL, 0);
    discover_claude_dir(cg, D, dir);
    sqlite3_stmt *st = NULL;
    if (sqlite3_prepare_v2(cg->db, "SELECT worktree FROM branches WHERE "
                           "worktree IS NOT NULL AND worktree<>''", -1, &st,
                           NULL) != SQLITE_OK)
        return;
    char **wts = NULL;
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        wts = xrealloc(wts, sizeof(char *) * (size_t)(n + 1));
        wts[n++] = xstrdup((const char *)sqlite3_column_text(st, 0));
    }
    sqlite3_finalize(st);
    for (int i = 0; i < n; i++) {
        transcript_dirs(wts[i], dir, sizeof dir, NULL, 0);
        discover_claude_dir(cg, D, dir);
        free(wts[i]);
    }
    free(wts);
}

/* a working directory inside this project: the main tree or any of its
 * linked worktrees */
static bool in_project(Cg *cg, const char *cwd) {
    size_t n = strlen(cg->shared);
    if (strncmp(cwd, cg->shared, n) == 0 && (cwd[n] == 0 || cwd[n] == '/'))
        return true;
    char root[4096], shared[4096];
    if (!is_dir(cwd) || cg_find_project_at(cwd, root, shared, sizeof root) != 0)
        return false;
    return same_dir(shared, cg->shared);
}

/* the model a rollout ran with: the first turn_context's payload.model */
static void codex_model(const char *path, char *out, size_t cap) {
    out[0] = 0;
    FILE *f = fopen(path, "r");
    if (!f) return;
    char *line = NULL; size_t lc = 0;
    for (int n = 0; n < DISCOVER_HEAD_LINES && getline(&line, &lc, f) > 0; n++) {
        if (!strstr(line, "\"turn_context\"")) continue;
        char *pl = json_get_object(line, "payload");
        char *m = jstr(pl, "model");
        if (m) snprintf(out, cap, "%s", m);
        free(m); free(pl);
        if (out[0]) break;
    }
    free(line);
    fclose(f);
}

static void discover_codex_file(Cg *cg, Disc *D, const char *path, long mtime) {
    char cwd[4096], id[256], ts[64];
    if (!transcript_codex_head(path, cwd, sizeof cwd, id, sizeof id, ts, sizeof ts))
        return;
    if (!id[0] || !in_project(cg, cwd)) return;
    char name[160];
    snprintf(name, sizeof name, "codex:%.8s", id);
    Delta d;
    delta_init(&d, name);
    NRow r;
    row_get(cg, name, &r);
    if (!r.found)
        disc_create(cg, &d, "codex", id, NULL, NULL, 0, iso_time(ts), mtime,
                    NULL, NULL);
    fill(cg, &d, "session", id);
    if (!r.model[0]) {
        char model[128];
        codex_model(path, model, sizeof model);
        fill(cg, &d, "model", model);
    }
    fill(cg, &d, "transcript", path);
    disc_place(cg, &d, name, cwd, NULL);
    if (!r.task[0]) {
        char task[256];
        const char *src = attribute_task(cg, false, id, NULL, NULL, NULL,
                                         task, sizeof task);
        if (src) { fill(cg, &d, "task", task); fill(cg, &d, "task_source", src); }
    }
    disc_liveness(cg, D, &d, mtime);
    disc_found(D, name, "codex", "session", id, path, mtime);
    D->ncodex++;
    disc_finish(cg, D, &d);
}

static void discover_codex_in(Cg *cg, Disc *D, const char *dir, int depth) {
    DIR *dd = opendir(dir);
    if (!dd) return;
    struct dirent *de;
    while ((de = readdir(dd)) != NULL) {
        if (de->d_name[0] == '.') continue;
        char p[4400];
        int w = snprintf(p, sizeof p, "%s/%s", dir, de->d_name);
        if (w <= 0 || (size_t)w >= sizeof p) continue;
        struct stat st;
        if (stat(p, &st) != 0) continue;
        if (S_ISDIR(st.st_mode)) {
            if (depth < 4) discover_codex_in(cg, D, p, depth + 1);
            continue;
        }
        if (strncmp(de->d_name, "rollout-", 8) != 0 ||
            !ends_with(de->d_name, ".jsonl"))
            continue;
        if ((long)st.st_mtime < D->oldest) continue;
        discover_codex_file(cg, D, p, (long)st.st_mtime);
    }
    closedir(dd);
}

/* Codex: every rollout changed within the window whose cwd is ours. */
static void discover_codex(Cg *cg, Disc *D) {
    char dir[4300];
    transcript_dirs(cg->shared, NULL, 0, dir, sizeof dir);
    discover_codex_in(cg, D, dir, 0);
}

/* One discovery pass under one write transaction. 0 ok, -1 busy, -2 a
 * database without the native agent columns. */
static int discover_run(Cg *cg, long since, Disc *D) {
    memset(D, 0, sizeof *D);
    D->now = (long)time(NULL);
    D->oldest = since > 0 ? D->now - since : 0;
    sb_init(&D->found);
    sb_init(&D->changed);
    sqlite3_busy_timeout(cg->db, NATIVE_BUSY_MS);
    int rc = -1;
    if (exec_ok(cg, "BEGIN IMMEDIATE")) {
        if (!ensure_discovered_column(cg)) {
            exec_ok(cg, "ROLLBACK");
            rc = -2;
        } else {
            discover_claude(cg, D);
            discover_codex(cg, D);
            if (exec_ok(cg, "COMMIT")) rc = 0;
            else exec_ok(cg, "ROLLBACK");
        }
    }
    sqlite3_busy_timeout(cg->db, (int)cg->lock_wait_ms);
    for (int i = 0; i < D->nseen_dirs; i++) free(D->seen_dirs[i]);
    free(D->seen_dirs);
    D->seen_dirs = NULL;
    D->nseen_dirs = 0;
    return rc;
}

static void disc_free(Disc *D) {
    sb_free(&D->found);
    sb_free(&D->changed);
}

/* cg fleet discover [--since DUR] [--json] */
int cmd_fleet_discover(Cg *cg, int argc, char **argv, bool json) {
    long since = 86400;
    for (int i = 0; i < argc; i++)
        if (strcmp(argv[i], "--since") == 0 && i + 1 < argc) {
            since = hier_duration(argv[++i]);
            if (since < 0) {
                fprintf(stderr, "cg fleet discover: --since %s is not a "
                                "duration (90s, 30m, 24h, 2d)\n", argv[i]);
                return 1;
            }
        }
    Disc D;
    int drc = discover_run(cg, since, &D);
    if (drc != 0) {
        disc_free(&D);
        fprintf(stderr, "cg fleet discover: %s\n", drc == -2
                ? "the graph predates native agents (schema 18); run cg sync"
                : "the database is busy; try again");
        return 1;
    }
    if (json) {
        printf("{\"since\":%ld,\"found\":[%s],\"changed\":[%s]}\n", since,
               D.nfound ? D.found.p : "", D.nchanged ? D.changed.p : "");
        disc_free(&D);
        return 0;
    }
    printf("discovered %d agent%s from transcripts (%d claude, %d codex), "
           "%d changed\n", D.nfound, D.nfound == 1 ? "" : "s", D.nclaude,
           D.ncodex, D.nchanged);
    /* the changes, one line each, read back from their JSON */
    StrBuf arr; sb_init(&arr);
    sb_printf(&arr, "[%s]", D.nchanged ? D.changed.p : "");
    char **items = NULL;
    int n = json_array_items(arr.p, &items);
    for (int i = 0; i < n; i++) {
        char *a = jstr(items[i], "agent"), *st = jstr(items[i], "state"),
             *cl = jstr(items[i], "claimed"), *fl = json_get_raw(items[i], "fields"),
             *cr = json_get_raw(items[i], "created");
        bool created = cr && strcmp(cr, "true") == 0;
        printf("  %s %s", created ? "+" : "~", a ? a : "?");
        if (created) printf("  created");
        if (fl && strcmp(fl, "[]") != 0) printf("  filled %s", fl);
        if (st) printf("  now %s", st);
        if (cl) printf("  claimed %s", cl);
        putchar('\n');
        free(a); free(st); free(cl); free(fl); free(cr); free(items[i]);
    }
    free(items);
    sb_free(&arr);
    disc_free(&D);
    return 0;
}

/* The automatic run in front of the fleet views: quiet, bounded to one scan
 * per DISCOVER_EVERY_S per process, off under [fleet] discover = false or
 * --no-discover. */
void native_discover_auto(Cg *cg) {
    static long last;
    if (native_no_discover || !config_fleet_discover(cg->root)) return;
    long now = (long)time(NULL);
    if (last && now - last < DISCOVER_EVERY_S) return;
    last = now;
    Disc D;
    discover_run(cg, 86400, &D);
    disc_free(&D);
}
