/*
 * MCP (Model Context Protocol) stdio server + auto-install.
 *
 * `cg mcp`         — newline-delimited JSON-RPC 2.0 on stdin/stdout,
 *                    exposing the graph as tools. The graph is incrementally
 *                    synced before every read so answers are always fresh.
 * `cg mcp-install` — writes/merges Codify into the MCP configs of popular
 *                    coding agents (Claude Code, Cursor, VS Code, Windsurf,
 *                    Gemini CLI, Codex CLI).
 */
#include "cg.h"
#include <unistd.h>
#include <sys/stat.h>
#include <dirent.h>

/* ---------------- tool table ---------------- */

typedef struct {
    Cg *cg;
    const SysInfo *si;
    const char *args;      /* arguments object, or NULL */
} CallCtx;

static int t_search(void *v) {
    CallCtx *c = v;
    char *q = c->args ? json_get_string(c->args, "query") : NULL;
    if (!q) { printf("{\"error\":\"missing query\"}\n"); return 1; }
    int limit = (int)json_get_int(c->args, "limit", 20);
    int rc = cmd_search(c->cg, q, limit > 0 ? limit : 20, true);
    free(q);
    return rc;
}
static int t_context(void *v) {
    CallCtx *c = v;
    char *q = c->args ? json_get_string(c->args, "query") : NULL;
    if (!q) { printf("{\"error\":\"missing query\"}\n"); return 1; }
    int budget = (int)json_get_int(c->args, "budget", 4000);
    int limit = (int)json_get_int(c->args, "limit", 8);
    int rc = cmd_context(c->cg, q, budget > 0 ? budget : 4000,
                         limit > 0 ? limit : 8, true);
    free(q);
    return rc;
}

static int t_survey(void *v) {
    CallCtx *c = v;
    char *scope = c->args ? json_get_string(c->args, "scope") : NULL;
    int budget = (int)json_get_int(c->args, "budget", 16000);
    int rc = cmd_survey(c->cg, scope, budget > 0 ? budget : 16000, true);
    free(scope);
    return rc;
}

static int t_anchors(void *v) {
    CallCtx *c = v;
    char *st = c->args ? json_get_raw(c->args, "stale") : NULL;
    char *un = c->args ? json_get_raw(c->args, "uncovered") : NULL;
    int rc = cmd_anchors(c->cg, st && strcmp(st, "true") == 0,
                         un && strcmp(un, "true") == 0, true);
    free(st); free(un);
    return rc;
}
static int t_symbol(void *v) {
    CallCtx *c = v;
    char *n = c->args ? json_get_string(c->args, "name") : NULL;
    if (!n) { printf("{\"error\":\"missing name\"}\n"); return 1; }
    int rc = cmd_symbol(c->cg, n, true);
    free(n);
    return rc;
}
static int t_impact(void *v) {
    CallCtx *c = v;
    char *n = c->args ? json_get_string(c->args, "name") : NULL;
    if (!n) { printf("{\"error\":\"missing name\"}\n"); return 1; }
    int depth = (int)json_get_int(c->args, "depth", 3);
    int budget = (int)json_get_int(c->args, "budget", 8000);
    int rc = cmd_impact(c->cg, n, depth > 0 ? depth : 3,
                        budget > 0 ? budget : 8000, true);
    free(n);
    return rc;
}
static int t_routes(void *v) {
    CallCtx *c = v;
    char *f = c->args ? json_get_string(c->args, "filter") : NULL;
    int rc = cmd_routes(c->cg, f, true);
    free(f);
    return rc;
}
static int t_status(void *v)  { CallCtx *c = v; return cmd_status(c->cg, true); }
static int t_state(void *v)   { CallCtx *c = v; return cmd_state(c->cg, true); }
static int t_integrate(void *v) {
    CallCtx *c = v;
    char *action = c->args ? json_get_string(c->args, "action") : NULL;
    int rc = cmd_integrate(c->cg, action ? action : "detect", true, false);
    free(action);
    return rc;
}
static int t_event_ingest(void *v) {
    CallCtx *c = v;
    char *source = c->args ? json_get_string(c->args, "source") : NULL;
    char *payload = c->args ? json_get_object(c->args, "payload") : NULL;
    if (!payload && c->args) payload = json_get_string(c->args, "payload");
    if (!payload) { free(source); printf("{\"error\":\"missing payload\"}\n"); return 1; }
    int rc = runtime_event_ingest(c->cg, source ? source : "mcp", payload,
                                  true);
    free(source); free(payload);
    return rc;
}
static int t_event_history(void *v) {
    CallCtx *c = v;
    int limit = c->args ? (int)json_get_int(c->args, "limit", 20) : 20;
    char lim[24]; snprintf(lim, sizeof lim, "%d", limit);
    char *a[] = { "history", "-n", lim };
    return cmd_event(c->cg, 3, a, true);
}
static int t_progress(void *v) {
    CallCtx *c = v;
    return runtime_progress(c->cg, true);
}
static int t_work_open(void *v) {
    CallCtx *c = v;
    char *task = c->args ? json_get_string(c->args, "task") : NULL;
    int rc = work_open(c->cg, task, true);
    free(task);
    return rc;
}
static int t_work_update(void *v) {
    CallCtx *c = v;
    char *revision = c->args ? json_get_string(c->args, "revision") : NULL;
    if (!revision) { printf("{\"error\":\"missing revision\"}\n"); return 1; }
    int rc = work_update(c->cg, revision, true);
    free(revision);
    return rc;
}
static int t_work_close(void *v) {
    CallCtx *c = v;
    char *task = c->args ? json_get_string(c->args, "task") : NULL;
    char *raw = c->args ? json_get_string(c->args, "evidence") : NULL;
    char *items[64]; int n = 0;
    if (raw) {
        char *save = NULL;
        for (char *p = strtok_r(raw, ";", &save); p && n < 64;
             p = strtok_r(NULL, ";", &save)) items[n++] = p;
    }
    int rc = work_close(c->cg, task, n, items, true);
    free(task); free(raw);
    return rc;
}
static int t_changes(void *v) {
    CallCtx *c = v;
    int limit = c->args ? (int)json_get_int(c->args, "limit", 0) : 0;
    return cmd_changes(c->cg, limit, true);
}
static int t_log(void *v) {
    CallCtx *c = v;
    int limit = c->args ? (int)json_get_int(c->args, "limit", 20) : 20;
    return cmd_log(c->cg, limit > 0 ? limit : 20, true);
}
static int t_commit(void *v) {
    CallCtx *c = v;
    char *m = c->args ? json_get_string(c->args, "message") : NULL;
    if (!m) { printf("{\"error\":\"missing message\"}\n"); return 1; }
    int rc = cmd_commit(c->cg, m, false);
    free(m);
    return rc;
}

/* spec tools: cmd_spec (and cmd_handoff/cmd_resume) report refusals on
 * stderr, which cg_capture does not see — temporarily fold stderr into the
 * captured stdout so the agent gets the explanation, not just isError:true */
static int fold_stderr(void) {
    fflush(stderr);
    int saved = dup(2);
    dup2(1, 2);
    return saved;
}
static void unfold_stderr(int saved) {
    fflush(stdout);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
}
static int run_spec(int argc, char **argv, bool json) {
    int saved = fold_stderr();
    int rc = cmd_spec(argc, argv, json);
    unfold_stderr(saved);
    return rc;
}

static int t_spec_status(void *v) {
    (void)v;
    char *a[] = { "status" };
    return run_spec(1, a, true);
}
static int t_spec_next(void *v) {
    (void)v;
    char *a[] = { "next" };
    return run_spec(1, a, true);
}
static int t_spec_start(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    if (!id) { printf("{\"error\":\"missing id\"}\n"); return 1; }
    char *a[] = { "start", id };
    int rc = run_spec(2, a, true);
    free(id);
    return rc;
}
static int t_spec_mode(void *v) {
    CallCtx *c = v;
    char *mode = c->args ? json_get_string(c->args, "mode") : NULL;
    if (!mode) { printf("{\"error\":\"missing mode\"}\n"); return 1; }
    char *a[] = { "mode", mode };
    int rc = run_spec(2, a, true);
    free(mode);
    return rc;
}
static int t_spec_implemented(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    if (!id) { printf("{\"error\":\"missing id\"}\n"); return 1; }
    char *force = c->args ? json_get_raw(c->args, "force") : NULL;
    if (force) {
        free(force); free(id);
        printf("{\"error\":\"spec_implemented does not support force\"}\n");
        return 1;
    }
    char *a[] = { "implemented", id };
    int rc = run_spec(2, a, true);
    free(id);
    return rc;
}
static int t_spec_done(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    if (!id) { printf("{\"error\":\"missing id\"}\n"); return 1; }
    char *force = c->args ? json_get_raw(c->args, "force") : NULL;
    bool f = force && strcmp(force, "true") == 0;
    free(force);
    char *a[] = { "done", id, "--force" };
    int rc = run_spec(f ? 3 : 2, a, true);
    free(id);
    return rc;
}
static int t_spec_render(void *v) {
    CallCtx *c = v;
    char *check = c->args ? json_get_raw(c->args, "check") : NULL;
    bool chk = check && strcmp(check, "true") == 0;
    free(check);
    char *a[] = { "render", "--check" };
    return run_spec(chk ? 2 : 1, a, true);
}
static int t_spec_trace(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    char *a[] = { "trace", id };
    int rc = run_spec(id ? 2 : 1, a, true);
    free(id);
    return rc;
}
static int t_remember(void *v) {
    CallCtx *c = v;
    char *text = c->args ? json_get_string(c->args, "text") : NULL;
    if (!text) { printf("{\"error\":\"missing text\"}\n"); return 1; }
    char *type = c->args ? json_get_string(c->args, "type") : NULL;
    char *task = c->args ? json_get_string(c->args, "task") : NULL;
    char *symbols = c->args ? json_get_string(c->args, "symbols") : NULL;
    char *files = c->args ? json_get_string(c->args, "files") : NULL;
    if (!task) task = spec_active_tag();
    int rc = cmd_remember(c->cg, text, type, task, symbols, files, true);
    free(text); free(type); free(task); free(symbols); free(files);
    return rc;
}
static int t_recall(void *v) {
    CallCtx *c = v;
    char *q = c->args ? json_get_string(c->args, "query") : NULL;
    char *task = c->args ? json_get_string(c->args, "task") : NULL;
    char *type = c->args ? json_get_string(c->args, "type") : NULL;
    int limit = c->args ? (int)json_get_int(c->args, "limit", 10) : 10;
    int rc = cmd_recall(c->cg, q, task, type, limit > 0 ? limit : 10, true);
    free(q); free(task); free(type);
    return rc;
}

static int t_show(void *v) {
    CallCtx *c = v;
    char *n = c->args ? json_get_string(c->args, "name") : NULL;
    if (!n) { printf("{\"error\":\"missing name\"}\n"); return 1; }
    char *fv = json_get_raw(c->args, "full");
    bool full = fv && (strcmp(fv, "true") == 0 || strcmp(fv, "1") == 0);
    free(fv);
    int rc = cmd_show(c->cg, n, full, true);
    free(n);
    return rc;
}
static int t_why(void *v) {
    CallCtx *c = v;
    char *n = c->args ? json_get_string(c->args, "name") : NULL;
    if (!n) { printf("{\"error\":\"missing name\"}\n"); return 1; }
    int rc = cmd_why(c->cg, n, true);
    free(n);
    return rc;
}
static int t_test_impact(void *v) {
    CallCtx *c = v;
    char *n = c->args ? json_get_string(c->args, "name") : NULL;
    int rc = cmd_test_impact(c->cg, n, true);
    free(n);
    return rc;
}
static int t_brief(void *v)  { CallCtx *c = v; return cmd_brief(c->cg, true); }
static int t_review(void *v) { CallCtx *c = v; return cmd_review(c->cg, true); }
static int t_check(void *v)  { CallCtx *c = v; return cmd_check(c->cg, true, false); }
static int t_guard(void *v) {
    CallCtx *c = v;
    char *p = c->args ? json_get_string(c->args, "path") : NULL;
    char *argv[1] = { p };
    int rc = cmd_guard(c->cg, p ? 1 : 0, p ? argv : NULL, true, false);
    free(p);
    return rc;
}
static int t_git_sync(void *v) {
    CallCtx *c = v;
    int limit = c->args ? (int)json_get_int(c->args, "limit", 500) : 500;
    return cmd_git_sync(c->cg, limit > 0 ? limit : 500, true);
}
static int t_spec_wave(void *v) {
    (void)v;
    char *a[] = { "wave" };
    return run_spec(1, a, true);
}
static int t_spec_lint(void *v) {
    (void)v;
    char *a[] = { "lint" };
    return run_spec(1, a, true);
}
static int t_spec_new(void *v) {
    CallCtx *c = v;
    char *f = c->args ? json_get_string(c->args, "feature") : NULL;
    if (!f) { printf("{\"error\":\"missing feature\"}\n"); return 1; }
    char *a[] = { "new", f };
    int rc = run_spec(2, a, true);
    free(f);
    return rc;
}
static int t_spec_add(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    char *title = c->args ? json_get_string(c->args, "title") : NULL;
    if (!id || !title) {
        free(id); free(title);
        printf("{\"error\":\"id and title are required\"}\n");
        return 1;
    }
    char *wave = json_get_string(c->args, "wave");
    char *req  = json_get_string(c->args, "requires");
    char *sym  = json_get_string(c->args, "symbols");
    char *tch  = json_get_string(c->args, "touches");
    char *vfy  = json_get_string(c->args, "verify_cmd");
    char *dos  = json_get_string(c->args, "do");
    char *rqs  = json_get_string(c->args, "reqs");
    char *a[20];
    int n = 0;
    a[n++] = "add"; a[n++] = id; a[n++] = "--title"; a[n++] = title;
    if (wave) { a[n++] = "--wave";     a[n++] = wave; }
    if (req)  { a[n++] = "--requires"; a[n++] = req;  }
    if (sym)  { a[n++] = "--symbols";  a[n++] = sym;  }
    if (tch)  { a[n++] = "--touches";  a[n++] = tch;  }
    if (vfy)  { a[n++] = "--verify";   a[n++] = vfy;  }
    if (dos)  { a[n++] = "--do";       a[n++] = dos;  }
    if (rqs)  { a[n++] = "--reqs";     a[n++] = rqs;  }
    int rc = run_spec(n, a, true);
    free(id); free(title); free(wave); free(req); free(sym); free(tch);
    free(vfy); free(dos); free(rqs);
    return rc;
}
static int t_spec_claim(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    if (!id) { printf("{\"error\":\"missing id\"}\n"); return 1; }
    char *agent = json_get_string(c->args, "agent");
    long ttl = json_get_int(c->args, "ttl", 30);
    char ttlbuf[24];
    snprintf(ttlbuf, sizeof ttlbuf, "%ld", ttl > 0 ? ttl : 30);
    char *a[] = { "claim", id, "--agent",
                  agent && agent[0] ? agent : (char *)cg_agent_name(NULL),
                  "--ttl", ttlbuf };
    int rc = run_spec(6, a, true);
    free(id); free(agent);
    return rc;
}
static int t_spec_release(void *v) {
    CallCtx *c = v;
    char *id = c->args ? json_get_string(c->args, "id") : NULL;
    if (!id) { printf("{\"error\":\"missing id\"}\n"); return 1; }
    char *agent = json_get_string(c->args, "agent");
    char *force = json_get_raw(c->args, "force");
    bool f = force && strcmp(force, "true") == 0;
    free(force);
    char *a[] = { "release", id, "--agent",
                  agent && agent[0] ? agent : (char *)cg_agent_name(NULL),
                  "--force" };
    int rc = run_spec(f ? 5 : 4, a, true);
    free(id); free(agent);
    return rc;
}
static int t_spec_ready(void *v) {
    (void)v;
    char *a[] = { "ready" };
    return run_spec(1, a, true);
}
static int t_spec_claim_next(void *v) {
    CallCtx *c = v;
    char *agent = c->args ? json_get_string(c->args, "agent") : NULL;
    long ttl = c->args ? json_get_int(c->args, "ttl", 30) : 30;
    char ttlbuf[24];
    snprintf(ttlbuf, sizeof ttlbuf, "%ld", ttl > 0 ? ttl : 30);
    char *a[] = { "claim-next", "--agent",
                  agent && agent[0] ? agent : (char *)cg_agent_name(NULL),
                  "--ttl", ttlbuf };
    int rc = run_spec(5, a, true);
    free(agent);
    return rc;
}
static int t_handoff(void *v) {
    CallCtx *c = v;
    char *task = c->args ? json_get_string(c->args, "task") : NULL;
    char *done = c->args ? json_get_string(c->args, "done") : NULL;
    char *next = c->args ? json_get_string(c->args, "next") : NULL;
    char *blocked = c->args ? json_get_string(c->args, "blocked") : NULL;
    char *note = c->args ? json_get_string(c->args, "note") : NULL;
    int saved = fold_stderr();
    int rc = cmd_handoff(c->cg, task, done, next, blocked, note, true);
    unfold_stderr(saved);
    free(task); free(done); free(next); free(blocked); free(note);
    return rc;
}
static int t_resume(void *v) {
    CallCtx *c = v;
    char *task = c->args ? json_get_string(c->args, "task") : NULL;
    int saved = fold_stderr();
    int rc = cmd_resume(c->cg, task, true, false);
    unfold_stderr(saved);
    free(task);
    return rc;
}

#define S_QUERY  "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \
                 "\"limit\":{\"type\":\"integer\"}},\"required\":[\"query\"]}"
#define S_CTX    "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \
                 "\"budget\":{\"type\":\"integer\",\"description\":" \
                 "\"token budget, default 4000\"}," \
                 "\"limit\":{\"type\":\"integer\"}},\"required\":[\"query\"]}"
#define S_SURVEY "{\"type\":\"object\",\"properties\":{\"scope\":{\"type\":" \
                 "\"string\",\"description\":\"path prefix or prose query; omit " \
                 "for the whole tree\"},\"budget\":{\"type\":\"integer\"," \
                 "\"description\":\"token budget, default 16000\"}}}"
#define S_ANCHORS "{\"type\":\"object\",\"properties\":{\"stale\":{\"type\":" \
                 "\"boolean\",\"description\":\"only stale anchors\"}," \
                 "\"uncovered\":{\"type\":\"boolean\",\"description\":" \
                 "\"only the uncovered backfill list\"}}}"
#define S_NAME   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}," \
                 "\"required\":[\"name\"]}"
#define S_IMPACT "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \
                 "\"depth\":{\"type\":\"integer\"}," \
                 "\"budget\":{\"type\":\"integer\",\"description\":" \
                 "\"token budget, default 8000\"}},\"required\":[\"name\"]}"
#define S_FILTER "{\"type\":\"object\",\"properties\":{\"filter\":{\"type\":\"string\"}}}"
#define S_EMPTY  "{\"type\":\"object\",\"properties\":{}}"
#define S_INTEGRATE "{\"type\":\"object\",\"properties\":{" \
                    "\"action\":{\"type\":\"string\",\"enum\":[" \
                    "\"detect\",\"plan\",\"apply\",\"doctor\"]}}," \
                    "\"required\":[\"action\"]}"
#define S_EVENT "{\"type\":\"object\",\"properties\":{" \
                "\"source\":{\"type\":\"string\"}," \
                "\"payload\":{\"type\":\"object\"}}," \
                "\"required\":[\"payload\"]}"
#define S_WORK_OPEN "{\"type\":\"object\",\"properties\":{" \
                    "\"task\":{\"type\":\"string\"}}}"
#define S_WORK_UPDATE "{\"type\":\"object\",\"properties\":{" \
                      "\"revision\":{\"type\":\"string\"}}," \
                      "\"required\":[\"revision\"]}"
#define S_WORK_CLOSE "{\"type\":\"object\",\"properties\":{" \
                     "\"task\":{\"type\":\"string\"}," \
                     "\"evidence\":{\"type\":\"string\"," \
                     "\"description\":\"semicolon separated CLAUSE=PROOF pairs\"}}}"
#define S_LIMIT  "{\"type\":\"object\",\"properties\":{\"limit\":{\"type\":\"integer\"}}}"
#define S_MSG    "{\"type\":\"object\",\"properties\":{\"message\":{\"type\":\"string\"}}," \
                 "\"required\":[\"message\"]}"
#define S_TASKID "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \
                 "\"description\":\"dotted task id, e.g. 16.7\"}},\"required\":[\"id\"]}"
#define S_TASKDN "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \
                 "\"description\":\"dotted task id, e.g. 16.7\"}," \
                 "\"force\":{\"type\":\"boolean\"}},\"required\":[\"id\"]}"
#define S_MODE   "{\"type\":\"object\",\"properties\":{\"mode\":{" \
                 "\"type\":\"string\",\"enum\":[\"prod\",\"standard\"]}}," \
                 "\"required\":[\"mode\"]}"
#define S_CHECK  "{\"type\":\"object\",\"properties\":{\"check\":{\"type\":\"boolean\"}}}"
#define S_TRACE  "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \
                 "\"description\":\"dotted task id; omit for all tasks\"}}}"
#define S_REMEMBER "{\"type\":\"object\",\"properties\":{" \
                 "\"text\":{\"type\":\"string\"}," \
                 "\"type\":{\"type\":\"string\",\"description\":" \
                 "\"decision|constraint|outcome|preference|fact (default fact)\"}," \
                 "\"task\":{\"type\":\"string\",\"description\":" \
                 "\"feature/id; defaults to the in-progress spec task\"}," \
                 "\"symbols\":{\"type\":\"string\"}," \
                 "\"files\":{\"type\":\"string\"}},\"required\":[\"text\"]}"
#define S_FEATURE "{\"type\":\"object\",\"properties\":{\"feature\":" \
                 "{\"type\":\"string\"}},\"required\":[\"feature\"]}"
#define S_PATHOPT "{\"type\":\"object\",\"properties\":{\"path\":" \
                 "{\"type\":\"string\",\"description\":" \
                 "\"repo-relative path; omit to check the whole worktree\"}}}"
#define S_SHOW   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \
                 "\"full\":{\"type\":\"boolean\",\"description\":" \
                 "\"return whole body, no 40-line cap\"}},\"required\":[\"name\"]}"
#define S_NAMEOPT "{\"type\":\"object\",\"properties\":{\"name\":" \
                 "{\"type\":\"string\",\"description\":" \
                 "\"symbol name; omit to use your uncommitted changes\"}}}"
#define S_CLAIM  "{\"type\":\"object\",\"properties\":{" \
                 "\"id\":{\"type\":\"string\"}," \
                 "\"agent\":{\"type\":\"string\"}," \
                 "\"ttl\":{\"type\":\"integer\",\"description\":" \
                 "\"lease minutes (default 30)\"}},\"required\":[\"id\"]}"
#define S_ADD    "{\"type\":\"object\",\"properties\":{" \
                 "\"id\":{\"type\":\"string\",\"description\":\"dotted id\"}," \
                 "\"title\":{\"type\":\"string\"}," \
                 "\"wave\":{\"type\":\"string\"}," \
                 "\"requires\":{\"type\":\"string\",\"description\":\"comma separated ids\"}," \
                 "\"symbols\":{\"type\":\"string\"}," \
                 "\"touches\":{\"type\":\"string\"}," \
                 "\"verify_cmd\":{\"type\":\"string\"}," \
                 "\"do\":{\"type\":\"string\",\"description\":\"semicolon separated steps\"}," \
                 "\"reqs\":{\"type\":\"string\"}},\"required\":[\"id\",\"title\"]}"
#define S_RECALL "{\"type\":\"object\",\"properties\":{" \
                 "\"query\":{\"type\":\"string\",\"description\":" \
                 "\"free text; omit for most recent\"}," \
                 "\"task\":{\"type\":\"string\"},\"type\":{\"type\":\"string\"}," \
                 "\"limit\":{\"type\":\"integer\"}}}"
#define S_CLAIMNEXT "{\"type\":\"object\",\"properties\":{" \
                 "\"agent\":{\"type\":\"string\",\"description\":" \
                 "\"claiming agent name (default CG_AGENT or 'agent')\"}," \
                 "\"ttl\":{\"type\":\"integer\",\"description\":" \
                 "\"lease minutes (default 30)\"}}}"
#define S_RELEASE "{\"type\":\"object\",\"properties\":{" \
                 "\"id\":{\"type\":\"string\"}," \
                 "\"agent\":{\"type\":\"string\"}," \
                 "\"force\":{\"type\":\"boolean\",\"description\":" \
                 "\"release even when another agent holds the lease\"}}," \
                 "\"required\":[\"id\"]}"
#define S_HANDOFF "{\"type\":\"object\",\"properties\":{" \
                 "\"task\":{\"type\":\"string\",\"description\":" \
                 "\"feature/id or id; defaults to your current task\"}," \
                 "\"done\":{\"type\":\"string\"}," \
                 "\"next\":{\"type\":\"string\"}," \
                 "\"blocked\":{\"type\":\"string\"}," \
                 "\"note\":{\"type\":\"string\"}}}"
#define S_RESUME "{\"type\":\"object\",\"properties\":{" \
                 "\"task\":{\"type\":\"string\",\"description\":" \
                 "\"feature/id or id; defaults to your current task\"}}}"

/* Tool annotations let a client decide what it may run without asking. A
 * read-only tool can be auto-approved; without the hint every search prompts
 * the user, which is the difference between a usable and an annoying agent. */
#define A_READ  "{\"readOnlyHint\":true,\"destructiveHint\":false," \
                "\"idempotentHint\":true,\"openWorldHint\":false}"
#define A_WRITE "{\"readOnlyHint\":false,\"destructiveHint\":false," \
                "\"idempotentHint\":false,\"openWorldHint\":false}"
#define A_MUTATE "{\"readOnlyHint\":false,\"destructiveHint\":true," \
                "\"idempotentHint\":false,\"openWorldHint\":false}"

static const struct {
    const char *name, *desc, *schema, *annotations, *title;
    int (*fn)(void *);
    bool sync_first;
} TOOLS[] = {
    { "search_code",
      "Full-text + trigram search over symbols and file contents. Returns "
      "matching symbols with locations and full-text file hits.",
      S_QUERY, A_READ, "Search code", t_search, true },
    { "get_context",
      "One-call surgical context for a query: top symbol definitions with "
      "code snippets, their callers and callees, entry points, and related "
      "routes. Use this first when exploring unfamiliar code.",
      S_CTX, A_READ, "Get context", t_context, true },
    { "survey",
      "Wide, cheap orientation over many files: each file's purpose line "
      "and its documented symbols with signatures — never bodies. Covers "
      "~100 files per call; undocumented files and symbols are named as "
      "uncovered. Use before get_context when the area is unfamiliar.",
      S_SURVEY, A_READ, "Survey", t_survey, true },
    { "anchors",
      "Anchor health: doc comments gone stale (their code moved on) and "
      "uncovered symbols ranked by coordination score — fan-out × extent × "
      "distinct referencing files. The backfill work list: anchor from the "
      "top; a score of zero is a self-evident leaf that needs none.",
      S_ANCHORS, A_READ, "Anchors", t_anchors, true },
    { "get_symbol",
      "Definition(s) of a symbol by name: location, code snippet, reference "
      "count.",
      S_NAME, A_READ, "Get symbol", t_symbol, true },
    { "impact_analysis",
      "Impact radius of a symbol before changing it: transitive callers "
      "(who breaks) and callees (what it depends on) to the given depth.",
      S_IMPACT, A_READ, "Impact analysis", t_impact, true },
    { "list_routes",
      "Framework-aware HTTP routes (URL pattern -> handler) detected across "
      "the codebase, optionally filtered.",
      S_FILTER, A_READ, "List routes", t_routes, true },
    { "vcs_status",
      "Working-tree status vs the last Codify snapshot (added/modified/"
      "deleted files).",
      S_EMPTY, A_READ, "Working tree status", t_status, false },
    { "state",
      "Truthful state across independent authorities: Git working tree, "
      "Codify snapshot, spec declarations, this agent's live attempt, and "
      "stale declarations. Use this when diagnosing apparent task drift.",
      S_EMPTY, A_READ, "Agent control-plane state", t_state, false },
    { "integrate",
      "Detect capabilities, plan exact paths without writes, apply "
      "recoverable agent integrations, or diagnose incomplete and stale "
      "configuration across every supported coding host.",
      S_INTEGRATE, A_WRITE, "Integrate coding agents", t_integrate, false },
    { "event_ingest",
      "Normalize and persist one native agent lifecycle event with a stable "
      "fingerprint, workspace revision, and explicit evidence delta.",
      S_EVENT, A_WRITE, "Ingest lifecycle event", t_event_ingest, false },
    { "event_history",
      "Recent normalized lifecycle events across hosts, sessions, and "
      "attempts, including activity and evidence deltas.",
      S_LIMIT, A_READ, "Lifecycle event history", t_event_history, false },
    { "progress_status",
      "Latest runtime activity for the current attempt or session. "
      "Heartbeats and output changes stay distinct from implementation "
      "progress.",
      S_EMPTY, A_READ, "Runtime progress status", t_progress, false },
    { "work_open",
      "Open one compact task-aware work packet with criteria, allowed scope, "
      "independent state, memories, focused graph context, tests, and latest "
      "runtime evidence. Returns an opaque revision for delta updates.",
      S_WORK_OPEN, A_WRITE, "Open work packet", t_work_open, true },
    { "work_update",
      "Return only state, lifecycle evidence, and workspace paths changed "
      "since an opaque work revision.",
      S_WORK_UPDATE, A_WRITE, "Update work packet", t_work_update, false },
    { "work_close",
      "Pair every task criterion with recorded evidence or an explicit "
      "unverified result. Evidence uses CLAUSE=PROOF pairs.",
      S_WORK_CLOSE, A_WRITE, "Close work packet", t_work_close, false },
    { "change_impact",
      "Impact radius of uncommitted edits: symbols in changed files plus "
      "their external callers. Run before committing.",
      S_LIMIT, A_READ, "Change impact", t_changes, true },
    { "vcs_log",
      "Snapshot history (Codify's local version control).",
      S_LIMIT, A_READ, "Snapshot history", t_log, false },
    { "vcs_commit",
      "Snapshot the working tree into Codify's local, content-addressed "
      "version control. Automatically tagged with the in-progress spec task "
      "when one exists.",
      S_MSG, A_WRITE, "Snapshot the tree", t_commit, false },
    { "spec_status",
      "Task board of the active Ion spec feature (spec/<feature>/spec.kvx): "
      "workflow mode, separate done/implemented totals, current in-progress "
      "task, and the next eligible task.",
      S_EMPTY, A_READ, "Task board", t_spec_status, false },
    { "spec_next",
      "The next eligible spec task — lowest wave whose `requires` are all "
      "done (or implemented in Prod mode) — with its implementation bullets "
      "and expanded acceptance criteria. Call before starting new work.",
      S_EMPTY, A_READ, "Next task", t_spec_next, false },
    { "spec_mode",
      "Set the repository spec workflow to Prod mode or standard mode. Prod "
      "mode lets implemented prerequisites unlock later implementation.",
      S_MODE, A_WRITE, "Set workflow mode", t_spec_mode, false },
    { "spec_start",
      "Mark a spec task in_progress in spec.kvx (enforces one-at-a-time and "
      "met `requires`) and refresh the markdown mirror. Do this before "
      "implementing the task.",
      S_TASKID, A_WRITE, "Start a task", t_spec_start, false },
    { "spec_implemented",
      "Prod mode only: run non-executing symbol/touched-path graph checks and "
      "mark coding complete with qualification pending. Never executes "
      "verify_cmd and has no force bypass.",
      S_TASKID, A_WRITE, "Mark coding complete", t_spec_implemented, false },
    { "spec_done",
      "Qualify an in-progress or implemented task: run verify_cmd and graph "
      "checks, mark done only on success, refresh the mirror, and report the "
      "next task. Failed qualification preserves implemented status.",
      S_TASKDN, A_WRITE, "Qualify a task", t_spec_done, false },
    { "spec_render",
      "Regenerate the spec system's IDE pointer files and markdown mirror "
      "from the kvx sources (check:true only reports staleness).",
      S_CHECK, A_WRITE, "Render spec mirror", t_spec_render, false },
    { "spec_trace",
      "Trace spec tasks to code: declared symbols resolved in the graph "
      "(location, refs), touched paths matched against actual changes, and "
      "commits tagged with the task. One task by id, or all tasks.",
      S_TRACE, A_READ, "Trace task to code", t_spec_trace, false },   /* trace refreshes its own graph */
    { "remember",
      "Save a durable project memory — a decision, constraint, outcome, "
      "preference, or fact worth knowing in later sessions — into Codify's "
      "database. Automatically linked to the in-progress spec task unless "
      "a task is given. Never store secrets.",
      S_REMEMBER, A_WRITE, "Save a memory", t_remember, false },
    { "recall",
      "Search project memories: full-text over the body, ranked by relevance "
      "then recency, filterable by task (feature/id) and type. Call at "
      "session start and before starting a task to load prior decisions "
      "and outcomes.",
      S_RECALL, A_READ, "Search memories", t_recall, false },
    { "get_source",
      "The body of one symbol, by name — not the whole file. Use instead of "
      "reading a file when you only need a single function.",
      S_SHOW, A_READ, "Show symbol source", t_show, true },
    { "why",
      "Provenance for a symbol: where it is defined, the snapshots that "
      "changed it, the spec tasks those snapshots implemented, and the "
      "decisions recorded along the way. Ask before changing unfamiliar code.",
      S_NAME, A_READ, "Why does this exist", t_why, true },
    { "test_impact",
      "Which tests reference a symbol — or, with no name, every symbol in "
      "your uncommitted changes. Use to pick what to run instead of the "
      "whole suite, and to see what has no coverage at all.",
      S_NAMEOPT, A_READ, "Tests covering this change", t_test_impact, true },
    { "brief",
      "Session state in one call: project root, the active or next spec "
      "task with its criteria, uncommitted paths, and recent decisions. "
      "Call this first in a new session.",
      S_EMPTY, A_READ, "Session brief", t_brief, true },
    { "review",
      "The change paired with what it claims to do: changed paths, the "
      "symbols in them, callers outside the change that are now at risk, "
      "and the active task's acceptance criteria. Call before spec_done.",
      S_EMPTY, A_READ, "Review the change", t_review, true },
    { "guard",
      "Report edits that fall outside the scope the in-progress task "
      "declared in its `touches`. Advisory: it never fails the call.",
      S_PATHOPT, A_READ, "Check edit scope", t_guard, true },
    { "check",
      "The full repository gate in one call: spec render staleness, spec "
      "lint, task evidence, claim consistency, and worktree state.",
      S_EMPTY, A_READ, "Repository check", t_check, true },
    { "spec_wave",
      "Every eligible task in the current wave, not just the first. Use "
      "when dispatching several agents at once; in parallel mode each task "
      "also reports the paths it claims.",
      S_EMPTY, A_READ, "Current wave", t_spec_wave, false },
    { "spec_lint",
      "Validate the plan: requires cycles, requires pointing at unknown "
      "tasks, tasks with no acceptance criteria, and touches globs that "
      "cannot match anything.",
      S_EMPTY, A_READ, "Lint the spec", t_spec_lint, false },
    { "spec_new",
      "Scaffold a new feature spec (and spec/workflow.kvx when the repo has "
      "none) and make it the active feature. The first step of planning.",
      S_FEATURE, A_WRITE, "New feature spec", t_spec_new, false },
    { "spec_add",
      "Add a task to the active feature, preserving every other byte of the "
      "kvx file. Declare `symbols` and `touches` so spec_done can verify the "
      "work against the graph.",
      S_ADD, A_WRITE, "Add a task", t_spec_add, false },
    { "spec_claim",
      "Claim a task with an owning agent and an expiring lease, so parallel "
      "agents do not collide. Refuses when another agent holds it or its "
      "declared paths overlap a live claim.",
      S_CLAIM, A_WRITE, "Claim a task", t_spec_claim, false },
    { "git_sync",
      "Ingest git history into the graph: commits, authors, and per-file "
      "churn, which then rank search and context results.",
      S_LIMIT, A_WRITE, "Ingest git history", t_git_sync, false },
    { "spec_ready",
      "Every eligible task across all waves, each with whether its declared "
      "paths conflict with a live claim. The dispatch view for parallel "
      "work: what could start right now, and what would collide.",
      S_EMPTY, A_READ, "All eligible tasks", t_spec_ready, false },
    { "spec_claim_next",
      "Atomically claim the first eligible task whose declared paths are "
      "disjoint from every in-progress task and live lease, mark it "
      "in_progress, and return the task with its lease and related "
      "memories. Empty frontier returns empty:true.",
      S_CLAIMNEXT, A_WRITE, "Claim next task", t_spec_claim_next, false },
    { "spec_release",
      "Release a task's lease. Owner-checked: refuses when another agent "
      "holds it unless force is set.",
      S_RELEASE, A_WRITE, "Release a claim", t_spec_release, false },
    { "handoff",
      "Record session state against a task before stopping: what got done, "
      "what comes next, what is blocked, plus the dirty paths. Supersedes "
      "the previous handoff so resume reads exactly one note.",
      S_HANDOFF, A_WRITE, "Hand off a task", t_handoff, false },
    { "resume",
      "Pick a task back up: the task packet, the latest handoff, task-"
      "scoped memories, uncommitted paths, and the lease holder. Call at "
      "session start when continuing earlier work.",
      S_RESUME, A_READ, "Resume a task", t_resume, false },
};
#define NTOOLS ((int)(sizeof TOOLS / sizeof TOOLS[0]))

/* ---------------- resources and prompts ---------------- */

/* Documents a client can attach directly, rather than calling a tool and
 * pasting the result. The spec is the source of truth for how to work here,
 * so it belongs in context, not behind a function call. */
static const struct {
    const char *uri, *rel, *name, *desc, *mime;
} RESOURCES[] = {
    { "codify://spec/workflow", "spec/workflow.kvx", "Spec workflow",
      "How work is driven in this repository: principles, loop, hard rules.",
      "text/plain" },
    { "codify://tasks", "spec/tasks.md", "Task board",
      "Rendered task list for the active feature.", "text/markdown" },
    { "codify://agents", "AGENTS.md", "Agent brief",
      "Generated orientation: languages, layout, entry points, key symbols.",
      "text/markdown" },
    { "codify://claude", "CLAUDE.md", "Claude brief",
      "Generated orientation for Claude Code.", "text/markdown" },
    { NULL, NULL, NULL, NULL, NULL }
};

/* The workflow loop, shipped as prompts so Codify's opinion reaches any
 * client — not only the ones whose users read the README. */
static const struct { const char *name, *title, *desc, *body; } PROMPTS[] = {
    { "start-work", "Start the next task",
      "Load session state, take the next eligible task, and gather context.",
      "Use Codify to begin the next piece of work in this repository:\n"
      "1. Call `brief` for project state, the active task, and prior decisions.\n"
      "2. Call `spec_next` (or `spec_wave` if you are dispatching several "
      "agents) and pick a task.\n"
      "3. Call `spec_start` with its id.\n"
      "4. Call `get_context` for the area the task names, and `why` for any "
      "symbol you are about to change.\n"
      "5. Restate the task's acceptance criteria before writing code.\n"
      "Do not begin editing until you have done all five." },
    { "review-change", "Review the current change",
      "Check uncommitted work against the criteria it claims to satisfy.",
      "Review the current uncommitted change in this repository:\n"
      "1. Call `review` for the changed symbols, at-risk callers, and the "
      "active task's acceptance criteria.\n"
      "2. Call `test_impact` to see which tests cover the change and which "
      "symbols have no coverage.\n"
      "3. Call `guard` to find edits outside the task's declared scope.\n"
      "For each acceptance criterion, state plainly whether the change "
      "satisfies it and cite the symbol that does so. Name anything "
      "unverified rather than assuming it passes." },
    { "close-task", "Close out a task",
      "Snapshot, qualify, and record what was learned.",
      "Finish the in-progress task in this repository:\n"
      "1. Call `review` and resolve anything it raises.\n"
      "2. Call `remember` for any decision or constraint discovered while "
      "working, so the next session does not rediscover it.\n"
      "3. Call `vcs_commit` with a message describing the change.\n"
      "4. Call `spec_done` with the task id.\n"
      "If `spec_done` refuses, do not force it and do not weaken the spec to "
      "match the code — report exactly which check failed and why." },
    { "orient", "Orient in an unfamiliar repository",
      "Build a working picture of a codebase you have not seen before.",
      "Orient yourself in this repository before doing anything else:\n"
      "1. Call `brief`, then read the `codify://agents` resource.\n"
      "2. Call `list_routes` to find the externally reachable surface.\n"
      "3. Call `get_context` for each area the task at hand touches.\n"
      "4. Call `recall` for decisions already made about those areas.\n"
      "Summarise what the project is, how it is laid out, and where the code "
      "you need lives — citing paths from the graph, not guesses." },
    { NULL, NULL, NULL, NULL }
};

/* Emit the client-facing annotation object for tool `i`. Kept as a function
 * so the hint policy lives in one place rather than being inlined into the
 * tools/list writer. */
static void mcp_tool_annotations(int i, StrBuf *b) {
    sb_puts(b, TOOLS[i].annotations);
}

/* Build the resources/list payload: the fixed documents that exist, plus one
 * entry per feature spec found under spec/. */
static void mcp_list_resources(Cg *cg, StrBuf *r) {
    sb_puts(r, "{\"resources\":[");
    int nr = 0;
    for (int i = 0; RESOURCES[i].uri; i++) {
        char abs[4700];
        struct stat rst;
        snprintf(abs, sizeof abs, "%s/%s", cg->root, RESOURCES[i].rel);
        if (stat(abs, &rst) != 0) continue;
        if (nr++) sb_putc(r, ',');
        sb_puts(r, "{\"uri\":");         sb_json_str(r, RESOURCES[i].uri);
        sb_puts(r, ",\"name\":");        sb_json_str(r, RESOURCES[i].name);
        sb_puts(r, ",\"description\":"); sb_json_str(r, RESOURCES[i].desc);
        sb_puts(r, ",\"mimeType\":");    sb_json_str(r, RESOURCES[i].mime);
        sb_putc(r, '}');
    }
    char specdir[4600];
    snprintf(specdir, sizeof specdir, "%s/spec", cg->root);
    DIR *d = opendir(specdir);
    if (d) {
        struct dirent *e;
        while ((e = readdir(d))) {
            if (e->d_name[0] == '.') continue;
            char kv[4800];
            struct stat kst;
            snprintf(kv, sizeof kv, "%s/%s/spec.kvx", specdir, e->d_name);
            if (stat(kv, &kst) != 0) continue;
            char uri[512], nm[300];
            snprintf(uri, sizeof uri, "codify://spec/%s", e->d_name);
            snprintf(nm, sizeof nm, "spec: %s", e->d_name);
            if (nr++) sb_putc(r, ',');
            sb_puts(r, "{\"uri\":");  sb_json_str(r, uri);
            sb_puts(r, ",\"name\":"); sb_json_str(r, nm);
            sb_puts(r, ",\"description\":\"Feature spec (kvx source of "
                       "truth)\",\"mimeType\":\"text/plain\"}");
        }
        closedir(d);
    }
    sb_puts(r, "]}");
}

/* Build the prompts/list payload — the workflow loop, as prompts. */
static void mcp_list_prompts(StrBuf *r) {
    sb_puts(r, "{\"prompts\":[");
    for (int i = 0; PROMPTS[i].name; i++) {
        if (i) sb_putc(r, ',');
        sb_puts(r, "{\"name\":");        sb_json_str(r, PROMPTS[i].name);
        sb_puts(r, ",\"title\":");       sb_json_str(r, PROMPTS[i].title);
        sb_puts(r, ",\"description\":"); sb_json_str(r, PROMPTS[i].desc);
        sb_puts(r, ",\"arguments\":[]}");
    }
    sb_puts(r, "]}");
}

/* ---------------- server loop ---------------- */

static void send_line(StrBuf *b) {
    fwrite(b->p, 1, b->len, stdout);
    fputc('\n', stdout);
    fflush(stdout);
    sb_free(b);
}

static void reply_result(const char *id, const char *result_json) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":%s", id, result_json);
    sb_putc(&b, '}');
    send_line(&b);
}

static void reply_error(const char *id, int code, const char *msg) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"id\":%s,\"error\":{\"code\":%d,"
                  "\"message\":", id, code);
    sb_json_str(&b, msg);
    sb_puts(&b, "}}");
    send_line(&b);
}

int cmd_mcp(Cg *cg, const SysInfo *si) {
    char *line = NULL;
    size_t cap = 0;
    ssize_t n;
    while ((n = getline(&line, &cap, stdin)) > 0) {
        if (n <= 1) continue;
        char *method = json_get_string(line, "method");
        char *id = json_get_raw(line, "id");
        if (!method) { free(id); continue; }

        if (strcmp(method, "initialize") == 0 && id) {
            char *params = json_get_object(line, "params");
            char *ver = params ? json_get_string(params, "protocolVersion") : NULL;
            /* Negotiate: echo the client's version only when we actually
             * speak it, otherwise answer with our newest. Echoing blindly
             * claims support for revisions this server has never seen. */
            static const char *SUPPORTED[] = {
                "2025-06-18", "2025-03-26", "2024-11-05", NULL
            };
            const char *agreed = SUPPORTED[0];
            for (int i = 0; ver && SUPPORTED[i]; i++)
                if (strcmp(ver, SUPPORTED[i]) == 0) { agreed = SUPPORTED[i]; break; }
            StrBuf r; sb_init(&r);
            sb_puts(&r, "{\"protocolVersion\":");
            sb_json_str(&r, agreed);
            sb_puts(&r, ",\"capabilities\":{"
                        "\"tools\":{\"listChanged\":true},"
                        "\"resources\":{\"listChanged\":true,\"subscribe\":false},"
                        "\"prompts\":{\"listChanged\":false}},"
                        "\"serverInfo\":{\"name\":\"codify\",\"version\":\""
                        CG_VERSION "\"},"
                        "\"instructions\":\"Codify serves this repository's "
                        "code graph, snapshots, spec tasks, and memories. Start "
                        "a session with `brief`. In unfamiliar areas call "
                        "`survey` first, then `get_context`, then `why`. "
                        "Before `spec_done` call `review`. Record decisions "
                        "with `remember`. When you write code, anchor what a "
                        "reader could not derive from it — purpose, contract, "
                        "danger, pointer — as doc comments; `anchors` lists "
                        "stale docs and where coverage pays next.\"}");
            reply_result(id, r.p);
            sb_free(&r);
            free(ver); free(params);
        } else if (strcmp(method, "tools/list") == 0 && id) {
            StrBuf r; sb_init(&r);
            sb_puts(&r, "{\"tools\":[");
            for (int i = 0; i < NTOOLS; i++) {
                if (i) sb_putc(&r, ',');
                sb_puts(&r, "{\"name\":");
                sb_json_str(&r, TOOLS[i].name);
                sb_puts(&r, ",\"title\":");
                sb_json_str(&r, TOOLS[i].title);
                sb_puts(&r, ",\"description\":");
                sb_json_str(&r, TOOLS[i].desc);
                sb_printf(&r, ",\"inputSchema\":%s,\"annotations\":",
                          TOOLS[i].schema);
                mcp_tool_annotations(i, &r);
                sb_putc(&r, '}');
            }
            sb_puts(&r, "]}");
            reply_result(id, r.p);
            sb_free(&r);
        } else if (strcmp(method, "tools/call") == 0 && id) {
            char *params = json_get_object(line, "params");
            char *name = params ? json_get_string(params, "name") : NULL;
            char *args = params ? json_get_object(params, "arguments") : NULL;
            int ti = -1;
            for (int i = 0; name && i < NTOOLS; i++)
                if (strcmp(TOOLS[i].name, name) == 0) { ti = i; break; }
            if (ti < 0) {
                reply_error(id, -32602, "unknown tool");
            } else {
                if (TOOLS[ti].sync_first) {          /* always fresh */
                    IndexStats st;
                    cg_index(cg, si, false, &st, true);
                }
                CallCtx ctx = { cg, si, args };
                char *out = NULL;
                int rc = cg_capture(&out, TOOLS[ti].fn, &ctx);
                StrBuf r; sb_init(&r);
                sb_puts(&r, "{\"content\":[{\"type\":\"text\",\"text\":");
                sb_json_str(&r, out ? out : "");
                sb_printf(&r, "}],\"isError\":%s}", rc == 0 ? "false" : "true");
                reply_result(id, r.p);
                sb_free(&r);
                free(out);
            }
            free(params); free(name); free(args);
        } else if (strcmp(method, "resources/list") == 0 && id) {
            /* The plan and the generated agent brief are documents, not tool
             * calls. Exposing them as resources lets a client attach them to
             * context directly instead of round-tripping through a tool. */
            StrBuf r; sb_init(&r);
            mcp_list_resources(cg, &r);
            reply_result(id, r.p);
            sb_free(&r);
        } else if (strcmp(method, "resources/read") == 0 && id) {
            char *params = json_get_object(line, "params");
            char *uri = params ? json_get_string(params, "uri") : NULL;
            char rel[1024] = "";
            for (int i = 0; uri && RESOURCES[i].uri; i++)
                if (strcmp(uri, RESOURCES[i].uri) == 0)
                    snprintf(rel, sizeof rel, "%s", RESOURCES[i].rel);
            if (uri && !rel[0] && strncmp(uri, "codify://spec/", 14) == 0)
                snprintf(rel, sizeof rel, "spec/%s/spec.kvx", uri + 14);
            if (!rel[0]) {
                reply_error(id, -32602, "unknown resource");
            } else {
                char abs[4900];
                snprintf(abs, sizeof abs, "%s/%s", cg->root, rel);
                char *body = read_entire_file(abs, NULL);
                if (!body) {
                    reply_error(id, -32602, "resource not readable");
                } else {
                    StrBuf r; sb_init(&r);
                    sb_puts(&r, "{\"contents\":[{\"uri\":");
                    sb_json_str(&r, uri);
                    sb_puts(&r, ",\"mimeType\":\"text/plain\",\"text\":");
                    sb_json_str(&r, body);
                    sb_puts(&r, "}]}");
                    reply_result(id, r.p);
                    sb_free(&r);
                    free(body);
                }
            }
            free(uri); free(params);
        } else if (strcmp(method, "prompts/list") == 0 && id) {
            StrBuf r; sb_init(&r);
            mcp_list_prompts(&r);
            reply_result(id, r.p);
            sb_free(&r);
        } else if (strcmp(method, "prompts/get") == 0 && id) {
            char *params = json_get_object(line, "params");
            char *name = params ? json_get_string(params, "name") : NULL;
            const char *body = NULL, *desc = NULL;
            for (int i = 0; name && PROMPTS[i].name; i++)
                if (strcmp(name, PROMPTS[i].name) == 0) {
                    body = PROMPTS[i].body;
                    desc = PROMPTS[i].desc;
                }
            if (!body) {
                reply_error(id, -32602, "unknown prompt");
            } else {
                StrBuf r; sb_init(&r);
                sb_puts(&r, "{\"description\":");
                sb_json_str(&r, desc);
                sb_puts(&r, ",\"messages\":[{\"role\":\"user\","
                            "\"content\":{\"type\":\"text\",\"text\":");
                sb_json_str(&r, body);
                sb_puts(&r, "}}]}");
                reply_result(id, r.p);
                sb_free(&r);
            }
            free(name); free(params);
        } else if (strcmp(method, "ping") == 0 && id) {
            reply_result(id, "{}");
        } else if (id) {
            reply_error(id, -32601, "method not found");
        }
        /* notifications (no id) are accepted silently */
        free(method);
        free(id);
    }
    free(line);
    return 0;
}

/* ---------------- auto-install into agent configs ---------------- */

static int self_path(char *out, size_t cap) {
    ssize_t n = readlink("/proc/self/exe", out, cap - 1);
    if (n <= 0) return -1;
    out[n] = 0;
    return 0;
}

static char *server_entry(const char *bin, bool vscode_style) {
    StrBuf b; sb_init(&b);
    sb_puts(&b, "\"codify\":{");
    if (vscode_style) sb_puts(&b, "\"type\":\"stdio\",");
    sb_puts(&b, "\"command\":");
    sb_json_str(&b, bin);
    sb_puts(&b, ",\"args\":[\"mcp\"]}");
    return b.p;
}

/* merge `entry` under `root_key` in a JSON config file; create if missing */
static void install_json(const char *path, const char *root_key,
                         const char *entry, const char *agent) {
    char *body = read_entire_file(path, NULL);
    if (!body) {
        char dir[4096];
        snprintf(dir, sizeof dir, "%s", path);
        char *slash = strrchr(dir, '/');
        if (slash) { *slash = 0; mkdirs(dir); }
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\n  \"%s\": {\n    %s\n  }\n}\n", root_key, entry);
        if (write_entire_file(path, b.p, b.len) == 0)
            printf("  ✓ %-12s %s (created)\n", agent, path);
        else
            printf("  ✗ %-12s cannot write %s\n", agent, path);
        sb_free(&b);
        return;
    }
    if (strstr(body, "\"codify\"")) {
        printf("  • %-12s already configured (%s)\n", agent, path);
        free(body);
        return;
    }
    char needle[128];
    snprintf(needle, sizeof needle, "\"%s\"", root_key);
    char *k = strstr(body, needle);
    char *brace = k ? strchr(k + strlen(needle), '{') : NULL;
    if (brace) {
        /* splice entry right after the opening brace */
        const char *p = brace + 1;
        while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r') p++;
        bool empty = (*p == '}');
        StrBuf b; sb_init(&b);
        size_t head = (size_t)(brace + 1 - body);
        for (size_t i = 0; i < head; i++) sb_putc(&b, body[i]);
        sb_printf(&b, "\n    %s%s", entry, empty ? "\n  " : ",");
        sb_puts(&b, body + head);
        if (write_entire_file(path, b.p, b.len) == 0)
            printf("  ✓ %-12s %s (merged)\n", agent, path);
        else
            printf("  ✗ %-12s cannot write %s\n", agent, path);
        sb_free(&b);
    } else {
        printf("  ! %-12s %s exists but has no \"%s\" section — add manually:\n"
               "      \"%s\": { %s }\n", agent, path, root_key, root_key, entry);
    }
    free(body);
}

int cmd_mcp_install(Cg *cg) {
    return cmd_integrate(cg, "apply", false, true);

    /* Legacy implementation retained below as a source reference while the
     * compatibility entry point delegates to the recoverable registry. */
    char bin[4096];
    if (self_path(bin, sizeof bin) != 0)
        snprintf(bin, sizeof bin, "cg");
    char *std = server_entry(bin, false);
    char *vsc = server_entry(bin, true);
    const char *home = getenv("HOME");
    char path[4600];

    printf("connecting Codify MCP server (%s mcp) to coding agents:\n", bin);

    /* project-scoped configs */
    snprintf(path, sizeof path, "%s/.mcp.json", cg->root);
    install_json(path, "mcpServers", std, "claude-code");
    snprintf(path, sizeof path, "%s/.cursor/mcp.json", cg->root);
    install_json(path, "mcpServers", std, "cursor");
    snprintf(path, sizeof path, "%s/.vscode/mcp.json", cg->root);
    install_json(path, "servers", vsc, "vscode");
    snprintf(path, sizeof path, "%s/.gemini/settings.json", cg->root);
    install_json(path, "mcpServers", std, "gemini-cli");
    snprintf(path, sizeof path, "%s/.zed/settings.json", cg->root);
    install_json(path, "context_servers", std, "zed");
    snprintf(path, sizeof path, "%s/.opencode/opencode.json", cg->root);
    install_json(path, "mcp", std, "opencode");

    /* user-scoped configs */
    if (home) {
        snprintf(path, sizeof path, "%s/.codeium/windsurf/mcp_config.json", home);
        install_json(path, "mcpServers", std, "windsurf");
        snprintf(path, sizeof path,
                 "%s/.config/Code/User/globalStorage/saoudrizwan.claude-dev/"
                 "settings/cline_mcp_settings.json", home);
        install_json(path, "mcpServers", std, "cline");
        snprintf(path, sizeof path, "%s/.continue/config.json", home);
        install_json(path, "mcpServers", std, "continue");

        snprintf(path, sizeof path, "%s/.codex/config.toml", home);
        char *toml = read_entire_file(path, NULL);
        if (toml && strstr(toml, "mcp_servers.codegraph")) {
            printf("  • %-12s already configured (%s)\n", "codex-cli", path);
        } else {
            char dir[4600];
            snprintf(dir, sizeof dir, "%s/.codex", home);
            mkdirs(dir);
            FILE *f = fopen(path, "a");
            if (f) {
                fprintf(f, "%s[mcp_servers.codegraph]\ncommand = \"%s\"\n"
                           "args = [\"mcp\"]\n", toml ? "\n" : "", bin);
                fclose(f);
                printf("  ✓ %-12s %s (appended)\n", "codex-cli", path);
            } else {
                printf("  ✗ %-12s cannot write %s\n", "codex-cli", path);
            }
        }
        free(toml);
    }
    free(std);
    free(vsc);
    printf("\nrestart your agent (or reload MCP servers) to pick up the "
           "connection.\n");
    return 0;
}
