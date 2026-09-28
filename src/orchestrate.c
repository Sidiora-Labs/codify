/*
 * cg spec run — the orchestrator that turns a parallel spec into running
 * agents. It loops the wave-1 primitives: claim-next picks a conflict-free
 * task per free slot, resume --prompt (in-process) writes the agent's
 * briefing, then fork/exec hands the prompt to a driver (codex, claude, or
 * a custom command) with stdout+stderr captured to a per-task log.
 *
 * The child's exit code is advisory only: the task's status in spec.kvx is
 * re-read on exit, and anything not done/implemented is treated as a failed
 * attempt — the lease is released, the status returns to pending so the
 * work goes back to the pool, and an auto outcome memory records the exit.
 * The run stops when the frontier is empty (exit 0) or when failures exceed
 * --max-fail (exit 1). SIGINT/SIGTERM/SIGHUP TERM each child's process
 * group, release its lease only once the child is reaped, and exit 130.
 */
#include "cg.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <dirent.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

#define ORCH_MAX_SLOTS 16
#define ORCH_MAX_ARGV  64

static volatile sig_atomic_t g_orch_int;

static void orch_on_signal(int sig) {
    (void)sig;
    g_orch_int = 1;
}

/* ---------------- config: workflow.kvx [agents] ---------------- */

typedef struct {
    const char *driver;   /* "codex" | "claude" | "custom" */
    char *cmd;            /* custom template, raw (uninterpolated), or NULL */
    char *codex_args;     /* extra argv for codex, whitespace-split */
    char *claude_args;    /* extra argv for claude */
    long  max;            /* default slot count */
    long  ttl;            /* lease ttl, seconds */
    char  driver_buf[32];
} OrchCfg;

/* The custom template must reach us UNinterpolated: kvx_str substitutes
 * ${NAME} from the environment at read time, which would eat the very
 * ${PROMPT_FILE}/${TASK}/${ROOT}/${AGENT} markers we substitute per task.
 * kvx_raw hands back the verbatim token; strip the quotes ourselves. */
static char *orch_raw_str(const Kvx *k, const char *sec, const char *key) {
    const char *raw = kvx_raw(k, sec, key);
    if (!raw) return NULL;
    size_t n = strlen(raw);
    if (n >= 2 && raw[0] == '"' && raw[n - 1] == '"') {
        char *out = xmalloc(n - 1);
        memcpy(out, raw + 1, n - 2);
        out[n - 2] = 0;
        return out;
    }
    return xstrdup(raw);
}

/* [agents] structured and model: how every driver is launched */
static bool g_structured = true;
static char g_model[128];

static void orch_cfg_load(const Kvx *wf, OrchCfg *c) {
    memset(c, 0, sizeof *c);
    char *d = kvx_str(wf, "agents", "driver");
    snprintf(c->driver_buf, sizeof c->driver_buf, "%s",
             d && d[0] ? d : "codex");
    free(d);
    c->driver = c->driver_buf;
    c->cmd = orch_raw_str(wf, "agents", "cmd");
    c->codex_args = kvx_str(wf, "agents", "codex_args");
    c->claude_args = kvx_str(wf, "agents", "claude_args");
    c->max = kvx_long(wf, "agents", "max", 2);
    c->ttl = kvx_long(wf, "agents", "ttl", 3600);
    g_structured = kvx_bool(wf, "agents", "structured", true);
    char *m = kvx_str(wf, "agents", "model");
    snprintf(g_model, sizeof g_model, "%s", m ? m : "");
    free(m);
}

static void orch_cfg_free(OrchCfg *c) {
    free(c->cmd);
    free(c->codex_args);
    free(c->claude_args);
}

/* ---------------- in-process composition (govern.c pattern) --------- */

typedef struct { int argc; char **argv; bool json; } OrchSpecCall;

static int orch_call_spec(void *v) {
    OrchSpecCall *c = v;
    fflush(stderr);
    int saved = dup(2);
    dup2(1, 2);                     /* keep refusals with the capture */
    int rc = cmd_spec(c->argc, c->argv, c->json);
    fflush(stdout);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
    return rc;
}

static int orch_spec(char **out, bool json, int argc, ...) {
    va_list ap;
    char *argv[12];
    va_start(ap, argc);
    for (int i = 0; i < argc && i < 12; i++) argv[i] = va_arg(ap, char *);
    va_end(ap);
    OrchSpecCall c = { argc, argv, json };
    return cg_capture(out, orch_call_spec, &c);
}

typedef struct { Cg *g; const char *task; } OrchResumeCall;

static int orch_call_resume(void *v) {
    OrchResumeCall *c = v;
    return cmd_resume(c->g, c->task, false, true);
}

static int orch_call_docs_packet(void *v) {
    Cg *g = v;
    char *argv[] = { (char *)"packet" };
    return cmd_docs(g, 1, argv, false);
}

/* The reserved closure item uses the same connector and fenced attempt as a
 * coding task, but its prompt comes from the documentation evidence packet. */
static bool orch_docs_ready(const char *id) {
    return id && strcmp(id, CG_DOC_TASK) == 0;
}

/* ---------------- driver command lines ---------------- */

/* How each fleet role is launched, from [role.*] (task 1.2), unless the
 * command line named a driver for the whole run. Filled by the fleet run;
 * a flat run leaves it unset and uses [agents]. */
static struct {
    bool set;
    char driver[16], model[128], args[1024];
    long wall, stall, retries, max;
    double spend;
} g_role[FLEET_ROLES];
static bool g_driver_explicit;
/* worker branches name {task}: a wave's tasks each get their own */
static bool g_per_task;
/* the attempt a worker being spawned is on: 0 first, else a retry */
static int g_retry_attempt;
static void orch_prompt_retry(const char *path, const char *feature,
                              const char *id, int attempt);

static void orch_roles_load(const Hierarchy *h) {
    g_per_task = hier_per_task(h);
    for (int r = 0; r < FLEET_ROLES; r++) {
        const RoleCaps *c = &h->roles[r].caps;
        g_role[r].set = true;
        snprintf(g_role[r].driver, sizeof g_role[r].driver, "%s", c->driver);
        snprintf(g_role[r].model, sizeof g_role[r].model, "%s", c->model);
        snprintf(g_role[r].args, sizeof g_role[r].args, "%s", c->args);
        g_role[r].wall = c->wall;
        g_role[r].stall = c->stall;
        g_role[r].retries = c->retries;
        g_role[r].spend = c->spend;
        g_role[r].max = c->max;
    }
}

/* role: FLEET_FEATURE or FLEET_WORKER for a fleet node, -1 for a flat slot */
static int orch_argv(const char *driver, const char *extra, const char *cmd,
                     int role, const char *root, const char *prompt,
                     const char *task, const char *agent, char **av, int cap) {
    DriverSpec d = { driver, g_model, extra, cmd, g_structured };
    if (role >= 0 && role < FLEET_ROLES && g_role[role].set &&
        !g_driver_explicit) {
        d.driver = g_role[role].driver;
        d.args = g_role[role].args;
        if (g_role[role].model[0]) d.model = g_role[role].model;
    }
    return driver_argv(&d, root, prompt, task, agent, av, cap);
}

static void orch_argv_free(char **av) {
    for (int i = 0; av[i]; i++) free(av[i]);
}

static void orch_argv_print(char **av) {
    for (int i = 0; av[i]; i++) {
        if (i) putchar(' ');
        if (strpbrk(av[i], " \t\n"))
            printf("'%s'", av[i]);
        else
            fputs(av[i], stdout);
    }
    putchar('\n');
}

/* ---------------- per-task plumbing ---------------- */

static int orch_spec_root(char *out, size_t cap) {
    char dir[4096];
    if (!getcwd(dir, sizeof dir)) return -1;
    for (;;) {
        char probe[4600];
        snprintf(probe, sizeof probe, "%s/spec/workflow.kvx", dir);
        if (access(probe, F_OK) == 0) {
            snprintf(out, cap, "%s", dir);
            return 0;
        }
        char *slash = strrchr(dir, '/');
        if (!slash || slash == dir) return -1;
        *slash = 0;
    }
}

/* Child success needs both authorities: the declaration must be qualified and
 * the exact fenced attempt we launched must be the one recorded completed. */
static char *orch_task_status(const char *specroot, const char *feature,
                              const char *id, const char *attempt,
                              long fence) {
    char path[4600];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", specroot, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return NULL;
    char sec[300];
    if (orch_docs_ready(id)) snprintf(sec, sizeof sec, "documentation");
    else snprintf(sec, sizeof sec, "task.%s", id);
    char *st = kvx_str(k, sec, "status");
    kvx_free(k);
    if (st && (strcmp(st, "done") == 0 ||
               (!orch_docs_ready(id) && strcmp(st, "implemented") == 0)) &&
        attempt && attempt[0]) {
        Cg g;
        bool completed = false;
        if (memory_open_quiet(&g)) {
            char tag[700];
            snprintf(tag, sizeof tag, "%s/%s", feature, id);
            sqlite3_stmt *q = cg_prep(&g,
                "SELECT 1 FROM attempts WHERE attempt_id=? AND task=? "
                "AND fence=? AND state='completed' LIMIT 1");
            sqlite3_bind_text(q, 1, attempt, -1, SQLITE_TRANSIENT);
            sqlite3_bind_text(q, 2, tag, -1, SQLITE_TRANSIENT);
            sqlite3_bind_int64(q, 3, fence);
            completed = sqlite3_step(q) == SQLITE_ROW;
            sqlite3_finalize(q);
            cg_close(&g);
        }
        if (!completed) {
            free(st);
            return xstrdup("stale_owner");
        }
    }
    return st;
}

/* An attempt that did not finish may return work to the pool only while its
 * exact attempt id and fence still own the task. A refused fenced release
 * means a replacement exists and its declaration must remain untouched. */
static void orch_abandon(const char *specroot, const char *feature,
                         const char *id, const char *agent,
                         const char *attempt, long fence) {
    char *out = NULL;
    char fencebuf[32];
    snprintf(fencebuf, sizeof fencebuf, "%ld", fence);
    int rr = orch_spec(&out, false, 8, (char *)"release", (char *)id,
                       (char *)"--agent", (char *)agent,
                       (char *)"--attempt", (char *)attempt,
                       (char *)"--fence", fencebuf);
    free(out);
    /* a refused release means the lease expired and another agent adopted
     * the task — its in_progress is theirs, not ours to reset */
    if (rr != 0) return;
    char path[4600], sec[300];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", specroot, feature);
    if (orch_docs_ready(id)) snprintf(sec, sizeof sec, "documentation");
    else snprintf(sec, sizeof sec, "task.%s", id);
    char *st = NULL;
    Kvx *k = kvx_parse(path);
    if (k) { st = kvx_str(k, sec, "status"); kvx_free(k); }
    int src = -1;
    if (st && strcmp(st, "in_progress") == 0)
        src = orch_docs_ready(id)
            ? kvx_set_string(path, sec, "status", "pending")
            : kvx_set_status(path, sec, "pending");
    if (src == 0) {
        out = NULL;
        orch_spec(&out, false, 1, (char *)"render");  /* keep mirrors fresh */
        free(out);
    }
    free(st);
}

/* exit_code < -900 means "not an exit" (a spawn); NULL strings are omitted */
static void orch_event(const char *kind, const char *role, const char *agent,
                       const char *feature, const char *task, long pid,
                       int exit_code, const char *outcome, const char *branch,
                       const char *log) {
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"role\":");
    sb_json_str(&p, role ? role : "");
#define OE(k, v) do { if (v) { sb_puts(&p, ",\"" k "\":"); \
        sb_json_str(&p, v); } } while (0)
    OE("agent", agent); OE("feature", feature); OE("task", task);
    OE("outcome", outcome); OE("branch", branch); OE("log", log);
#undef OE
    if (pid > 0) sb_printf(&p, ",\"pid\":%ld", pid);
    if (exit_code > -900) sb_printf(&p, ",\"exit\":%d", exit_code);
    sb_putc(&p, '}');
    char subj[600];
    if (task && feature) snprintf(subj, sizeof subj, "%s/%s", feature, task);
    else snprintf(subj, sizeof subj, "%s", feature ? feature : "");
    events_emit_quiet(kind, subj[0] ? subj : NULL, p.p);
    sb_free(&p);
}

static void orch_note_failure(const char *feature, const char *id, int rc) {
    Cg g;
    if (!memory_open_quiet(&g)) return;
    char tag[300], body[128];
    snprintf(tag, sizeof tag, "%s/%s", feature, id);
    snprintf(body, sizeof body, "agent exited rc=%d without completing", rc);
    memory_add(&g, "outcome", tag, body, NULL, NULL, "auto");
    cg_close(&g);
}

/* The agent's briefing comes from resume for code tasks and from the grounded
 * packet for @docs. The packet also tells the agent that `cg docs close`, not
 * recursive orchestration or `spec done`, is the only valid exit. */
/* Messages queued for this agent (cg fleet steer) that it has not seen
 * yet ride at the end of its prompt: the last thing it reads before it
 * starts is what the operator asked of it. */
static void orch_prompt_steer(const char *path, const char *agent) {
    Cg g;
    if (!agent || !agent[0] || !memory_open_quiet(&g)) return;
    char *msgs = driver_steer_take(&g, agent, "prompt");
    cg_close(&g);
    if (!msgs) return;
    char *body = read_entire_file(path, NULL);
    StrBuf b; sb_init(&b);
    sb_puts(&b, body ? body : "");
    sb_puts(&b, "\n\n## Messages from your operator\n\n"
                "Take these into account before anything else:\n");
    sb_puts(&b, msgs);
    write_entire_file(path, b.p, b.len);
    sb_free(&b);
    free(body);
    free(msgs);
}

static int orch_write_prompt(const char *cgroot, const char *feature,
                             const char *id, char *path, size_t cap) {
    char dir[4600];
    snprintf(dir, sizeof dir, "%s/.codegraph/agents", cgroot);
    mkdirs(dir);
    snprintf(path, cap, "%s/.codegraph/agents/%s-%s.prompt", cgroot,
             feature, id);
    Cg g;
    if (!memory_open_quiet(&g)) return -1;
    char *out = NULL;
    OrchResumeCall c = { &g, id };
    int rc = orch_docs_ready(id)
        ? cg_capture(&out, orch_call_docs_packet, &g)
        : cg_capture(&out, orch_call_resume, &c);
    cg_close(&g);
    if (rc != 0 || !out || !out[0]) {
        free(out);
        return -1;
    }
    StrBuf prompt; sb_init(&prompt);
    if (orch_docs_ready(id)) {
        sb_puts(&prompt, "You own Codify's final @docs closure. Use the evidence "
                "packet below to update only the configured documentation targets. "
                "Keep user, developer, and release coverage explicit; update the "
                "claims ledger when needed; finish only with `cg docs close`. Do not "
                "run `cg spec run` or `cg spec done @docs`.\n\n");
    }
    sb_puts(&prompt, out);
    int wrc = write_entire_file(path, prompt.p, prompt.len);
    sb_free(&prompt);
    free(out);
    return wrc;
}

static pid_t orch_spawn(char **av, const char *root, const char *promptfile,
                        const char *logpath, const char *agent,
                        const char *feature, const char *task,
                        const char *attempt, long fence) {
    pid_t pid = fork();
    if (pid != 0) {
        /* both sides setpgid to close the fork/exec race; after the exec
         * the parent's call fails harmlessly */
        if (pid > 0) setpgid(pid, pid);
        return pid;
    }
    /* child — its own process group, so shutdown can kill the whole
     * driver tree, not just the /bin/sh in front of it */
    setpgid(0, 0);
    int in = open(promptfile, O_RDONLY);
    if (in < 0) _exit(127);     /* never inherit the orchestrator's stdin */
    int lg = open(logpath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    dup2(in, 0);
    if (lg >= 0) { dup2(lg, 1); dup2(lg, 2); }
    if (in > 2) close(in);
    if (lg > 2) close(lg);
    if (chdir(root) != 0) _exit(127);
    setenv("CG_AGENT", agent, 1);
    char tasktag[256];
    snprintf(tasktag, sizeof tasktag, "%s/%s", feature, task);
    setenv("CG_TASK", tasktag, 1);
    setenv("CG_ATTEMPT", attempt, 1);
    char fencebuf[32];
    snprintf(fencebuf, sizeof fencebuf, "%ld", fence);
    setenv("CG_FENCE", fencebuf, 1);
    execvp(av[0], av);
    _exit(127);
}

/* ---------------- dry run: the plan, claiming nothing ---------------- */

static int orch_dry_run(const char *specroot, const char *cgroot,
                        const char *feature, const OrchCfg *cfg,
                        const char *extra, int nslots, const char *prefix) {
    char path[4600];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", specroot, feature);
    Kvx *k = kvx_parse(path);
    if (!k) {
        fprintf(stderr, "cg spec run: cannot parse %s\n", path);
        return 1;
    }
    char **ids;
    int nids = kvx_subsections(k, "task", &ids);
    kvx_sort_dotted(ids, nids);

    /* pending leaves, ordered by wave (dotted order within a wave) */
    int *el = xmalloc(sizeof(int) * (size_t)(nids > 0 ? nids : 1));
    int ne = 0;
    for (int i = 0; i < nids; i++) {
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", ids[i]);
        if (!kvx_raw(k, sec, "wave")) continue;        /* heading */
        char *st = kvx_str(k, sec, "status");
        bool pending = !st || !st[0] || strcmp(st, "pending") == 0;
        free(st);
        if (pending) el[ne++] = i;
    }
    for (int i = 1; i < ne; i++) {
        int v = el[i];
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", ids[v]);
        long w = kvx_long(k, sec, "wave", 0);
        int j = i;
        while (j > 0) {
            snprintf(sec, sizeof sec, "task.%s", ids[el[j - 1]]);
            if (kvx_long(k, sec, "wave", 0) <= w) break;
            el[j] = el[j - 1];
            j--;
        }
        el[j] = v;
    }

    printf("plan — driver %s, %d slot(s), feature %s (dry run: nothing "
           "claimed)\n", cfg->driver, nslots, feature);
    long lastw = -1;
    for (int e = 0; e < ne; e++) {
        const char *id = ids[el[e]];
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", id);
        long w = kvx_long(k, sec, "wave", 0);
        if (w != lastw) printf("wave %ld:\n", w);
        lastw = w;
        char *title = kvx_str(k, sec, "title");
        printf("  %-8s %s\n", id, title ? title : "");
        free(title);
        char prompt[4700], agent[80];
        snprintf(prompt, sizeof prompt, "%s/.codegraph/agents/%s-%s.prompt",
                 cgroot, feature, id);
        snprintf(agent, sizeof agent, "%s-%d", prefix, e % nslots + 1);
        char *av[ORCH_MAX_ARGV];
        int ac = orch_argv(cfg->driver, extra, cfg->cmd, -1, cgroot,
                           prompt, id, agent, av, ORCH_MAX_ARGV);
        if (ac > 0) {
            printf("    ");
            orch_argv_print(av);
            orch_argv_free(av);
        }
    }
    if (!ne) printf("nothing to run — no pending tasks\n");
    for (int i = 0; i < nids; i++) free(ids[i]);
    free(ids);
    free(el);
    kvx_free(k);
    return 0;
}

/* ---------------- the run loop ---------------- */

typedef struct {
    pid_t pid;
    bool  live;
    char  id[64];
    char  feature[128];
    char  agent[128];
    char  attempt[65];
    long  fence;
    long  last_heartbeat;
    DriverTap tap;        /* the agent's log, read into agent.* events */
} OrchSlot;

static int orch_heartbeat(OrchSlot *slot, long ttl_min) {
    char fencebuf[32], ttlbuf[32];
    snprintf(fencebuf, sizeof fencebuf, "%ld", slot->fence);
    snprintf(ttlbuf, sizeof ttlbuf, "%ld", ttl_min);
    char *out = NULL;
    int rc = orch_spec(&out, true, 10, (char *)"heartbeat", slot->id,
                       (char *)"--agent", slot->agent,
                       (char *)"--attempt", slot->attempt,
                       (char *)"--fence", fencebuf,
                       (char *)"--ttl", ttlbuf);
    if (rc != 0 && out && out[0]) fprintf(stderr, "%s", out);
    free(out);
    if (rc == 0) slot->last_heartbeat = (long)time(NULL);
    return rc;
}

static int orch_live(const OrchSlot *slots, int n) {
    int c = 0;
    for (int i = 0; i < n; i++) c += slots[i].live;
    return c;
}

/* Shutdown reap. A repeated signal EINTRs a blocking wait, and a lease
 * must never be released while its child can still run — so poll ~5s for
 * the TERM to land, then SIGKILL the group and insist. 0 only once the
 * child is provably gone. */
static int orch_reap(pid_t pid) {
    int st;
    for (int i = 0; i < 50; i++) {
        pid_t r = waitpid(pid, &st, WNOHANG);
        if (r == pid) return 0;
        if (r < 0 && errno == ECHILD) return 0;
        struct timespec ts = { 0, 100 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }
    if (kill(-pid, SIGKILL) != 0) kill(pid, SIGKILL);
    for (;;) {
        pid_t r = waitpid(pid, &st, 0);
        if (r == pid) return 0;
        if (r < 0 && errno == EINTR) continue;
        return (r < 0 && errno == ECHILD) ? 0 : -1;
    }
}

/* the two-level run, at the end of this file: one feature manager per
 * feature and wave workers under it, each in its own worktree */
/* --run-id names a new run (cg fleet up picks it before detaching);
 * --resume continues one: "" for the newest unfinished run */
typedef struct { const char *run_id; const char *resume; bool all; } FleetRunOpts;
static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,
                          const char *extra, int nslots, int maxfail,
                          int maxrounds, bool dry, bool status,
                          const FleetRunOpts *ro);

int cmd_spec_run(int argc, char **argv) {
    int nflag = 0, maxfail = 2, maxrounds = 0;
    const char *driver_ov = NULL, *prefix = "run", *feature_ov = NULL;
    const char *run_id = NULL, *resume = NULL;
    bool all_features = false;
    bool dry = false, fleet = false, tree = false;
    for (int i = 0; i < argc; i++) {
        if (strcmp(argv[i], "-n") == 0 && i + 1 < argc)
            nflag = atoi(argv[++i]);
        else if (strcmp(argv[i], "--driver") == 0 && i + 1 < argc)
            driver_ov = argv[++i];
        else if (strcmp(argv[i], "--dry-run") == 0)
            dry = true;
        else if (strcmp(argv[i], "--max-fail") == 0 && i + 1 < argc)
            maxfail = atoi(argv[++i]);
        else if (strcmp(argv[i], "--agent-prefix") == 0 && i + 1 < argc)
            prefix = argv[++i];
        else if (strcmp(argv[i], "--fleet") == 0)
            fleet = true;
        else if (strcmp(argv[i], "--status") == 0)
            tree = true;
        else if (strcmp(argv[i], "-f") == 0 && i + 1 < argc)
            feature_ov = argv[++i];
        else if (strcmp(argv[i], "--max-rounds") == 0 && i + 1 < argc)
            maxrounds = atoi(argv[++i]);
        else if (strcmp(argv[i], "--run-id") == 0 && i + 1 < argc)
            run_id = argv[++i];
        else if (strcmp(argv[i], "--all") == 0) {
            all_features = true;
            fleet = true;
        }
        else if (strcmp(argv[i], "--resume") == 0) {
            /* an optional run id: the next word unless it is a flag */
            resume = (i + 1 < argc && argv[i + 1][0] != '-') ? argv[++i] : "";
            fleet = true;
        }
        else {
            fprintf(stderr, "usage: cg spec run [-n N] [--driver "
                    "codex|claude|custom] [--dry-run] [--max-fail K] "
                    "[--agent-prefix P] [--fleet [-f <feature>] "
                    "[--max-rounds R] [--status] [--resume [RUN]]]\n");
            return 1;
        }
    }

    char specroot[4096];
    if (orch_spec_root(specroot, sizeof specroot) != 0) {
        fprintf(stderr, "cg spec run: no spec/workflow.kvx here — scaffold "
                "one with `cg spec new <feature>`\n");
        return 1;
    }
    char wfpath[4600];
    snprintf(wfpath, sizeof wfpath, "%s/spec/workflow.kvx", specroot);
    Kvx *wf = kvx_parse(wfpath);
    if (!wf) {
        fprintf(stderr, "cg spec run: cannot parse %s\n", wfpath);
        return 1;
    }
    char *mode = kvx_str(wf, "mode", "name");
    if (!mode || (strcmp(mode, "parallel") != 0 &&
                  strcmp(mode, "prod") != 0)) {
        fprintf(stderr, "cg spec run: mode is '%s' — orchestration needs "
                "`cg spec mode parallel` (or prod)\n",
                mode && mode[0] ? mode : "standard");
        free(mode);
        kvx_free(wf);
        return 1;
    }
    free(mode);

    char cgroot[4096];
    if (cg_find_root(cgroot, sizeof cgroot) != 0) {
        fprintf(stderr, "cg spec run: leases need a Codify index — run "
                "`cg init` first\n");
        kvx_free(wf);
        return 1;
    }

    char *feature = kvx_str(wf, "meta", "active_feature");
    if (!feature || !feature[0]) {
        fprintf(stderr, "cg spec run: no active_feature in %s\n", wfpath);
        free(feature);
        kvx_free(wf);
        return 1;
    }

    OrchCfg cfg;
    orch_cfg_load(wf, &cfg);
    kvx_free(wf);
    if (driver_ov) cfg.driver = driver_ov;
    g_driver_explicit = driver_ov != NULL;
    if (strcmp(cfg.driver, "codex") != 0 &&
        strcmp(cfg.driver, "claude") != 0 &&
        strcmp(cfg.driver, "custom") != 0) {
        fprintf(stderr, "cg spec run: unknown driver '%s' (codex, claude, "
                "or custom)\n", cfg.driver);
        orch_cfg_free(&cfg);
        free(feature);
        return 1;
    }
    if (strcmp(cfg.driver, "custom") == 0 && (!cfg.cmd || !cfg.cmd[0])) {
        fprintf(stderr, "cg spec run: the custom driver needs cmd = \"...\" "
                "in workflow.kvx [agents]\n");
        orch_cfg_free(&cfg);
        free(feature);
        return 1;
    }
    const char *extra = strcmp(cfg.driver, "codex") == 0 ? cfg.codex_args
                      : strcmp(cfg.driver, "claude") == 0 ? cfg.claude_args
                      : NULL;
    int nslots = nflag > 0 ? nflag : (int)cfg.max;
    if (nslots < 1) nslots = 1;
    if (nslots > ORCH_MAX_SLOTS) nslots = ORCH_MAX_SLOTS;

    /* the fleet run owns its own plan, slots, and shutdown; the flat run
     * below stays exactly what a repository without a hierarchy gets */
    if (fleet || tree) {
        FleetRunOpts ro = { run_id, resume, all_features };
        int rc = orch_fleet_run(feature_ov ? feature_ov : feature, &cfg,
                                extra, nslots, maxfail, maxrounds, dry, tree,
                                &ro);
        orch_cfg_free(&cfg);
        free(feature);
        return rc;
    }

    if (dry) {
        int rc = orch_dry_run(specroot, cgroot, feature, &cfg, extra,
                              nslots, prefix);
        orch_cfg_free(&cfg);
        free(feature);
        return rc;
    }

    long ttl_min = cfg.ttl > 0 ? (cfg.ttl + 59) / 60 : 60;
    OrchSlot slots[ORCH_MAX_SLOTS];
    memset(slots, 0, sizeof slots);
    int failures = 0, rc = 0;
    bool stopping = false;

    struct sigaction sa, oldint, oldterm, oldhup;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = orch_on_signal;
    g_orch_int = 0;
    sigaction(SIGINT, &sa, &oldint);
    sigaction(SIGTERM, &sa, &oldterm);
    sigaction(SIGHUP, &sa, &oldhup);

    for (;;) {
        if (g_orch_int) {
            for (int i = 0; i < nslots; i++)
                if (slots[i].live && kill(-slots[i].pid, SIGTERM) != 0)
                    kill(slots[i].pid, SIGTERM);
            for (int i = 0; i < nslots; i++) {
                if (!slots[i].live) continue;
                if (orch_reap(slots[i].pid) != 0) continue;
                slots[i].live = false;
                orch_abandon(specroot, slots[i].feature, slots[i].id,
                             slots[i].agent, slots[i].attempt,
                             slots[i].fence);
            }
            fprintf(stderr, "cg spec run: interrupted — children terminated,"
                    " leases released\n");
            rc = 130;
            break;
        }

        /* what each live agent wrote since the last tick */
        for (int i = 0; i < nslots; i++)
            if (slots[i].live) driver_tap_poll(&slots[i].tap);

        /* reap finished slots; the spec file, not the exit code, decides */
        for (int i = 0; i < nslots; i++) {
            if (!slots[i].live) continue;
            int st;
            pid_t r = waitpid(slots[i].pid, &st, WNOHANG);
            if (r == 0) continue;
            slots[i].live = false;
            driver_tap_poll(&slots[i].tap);
            driver_tap_free(&slots[i].tap);
            int crc = WIFEXITED(st) ? WEXITSTATUS(st)
                                    : 128 + WTERMSIG(st);
            char *tstat = orch_task_status(specroot, slots[i].feature,
                                           slots[i].id, slots[i].attempt,
                                           slots[i].fence);
            bool okdone = tstat && (strcmp(tstat, "done") == 0 ||
                                    strcmp(tstat, "implemented") == 0);
            printf("[run] task %s exit %d → status %s\n", slots[i].id, crc,
                   okdone ? tstat : "INCOMPLETE");
            fflush(stdout);
            orch_event("orch.exit", "flat", slots[i].agent, slots[i].feature,
                       slots[i].id, slots[i].pid, crc,
                       okdone ? tstat : "incomplete", NULL, NULL);
            if (!okdone) {
                orch_abandon(specroot, slots[i].feature, slots[i].id,
                             slots[i].agent, slots[i].attempt,
                             slots[i].fence);
                orch_note_failure(slots[i].feature, slots[i].id, crc);
                failures++;
            }
            free(tstat);
        }

        /* A running child keeps the exact fenced attempt alive. Heartbeat
         * loss means ownership was lost; stop that process before it can
         * write under a replacement attempt. */
        long heartbeat_every = cfg.ttl > 0 ? cfg.ttl / 3 : 20;
        if (heartbeat_every < 1) heartbeat_every = 1;
        long heartbeat_now = (long)time(NULL);
        for (int i = 0; i < nslots; i++) {
            if (!slots[i].live ||
                heartbeat_now - slots[i].last_heartbeat < heartbeat_every)
                continue;
            if (orch_heartbeat(&slots[i], ttl_min) == 0) continue;
            char *tstat = orch_task_status(specroot, slots[i].feature,
                                           slots[i].id, slots[i].attempt,
                                           slots[i].fence);
            bool finished = tstat && (strcmp(tstat, "done") == 0 ||
                                      strcmp(tstat, "implemented") == 0);
            free(tstat);
            if (finished) {
                slots[i].last_heartbeat = heartbeat_now;
                continue;
            }
            fprintf(stderr, "cg spec run: task %s lost fenced ownership — "
                            "terminating stale agent %s\n", slots[i].id,
                    slots[i].agent);
            if (kill(-slots[i].pid, SIGTERM) != 0)
                kill(slots[i].pid, SIGTERM);
            orch_reap(slots[i].pid);
            slots[i].live = false;
            orch_note_failure(slots[i].feature, slots[i].id, -2);
            failures++;
        }
        if (!stopping && failures > maxfail) {
            fprintf(stderr, "cg spec run: %d failure(s) exceed --max-fail "
                    "%d — waiting for running agents, then stopping\n",
                    failures, maxfail);
            stopping = true;
            rc = 1;
        }

        /* refill every free slot from the frontier */
        bool empty = false;
        for (int i = 0; i < nslots && !stopping && !g_orch_int; i++) {
            if (slots[i].live) continue;
            char agent[80], ttlbuf[32];
            snprintf(agent, sizeof agent, "%s-%d", prefix, i + 1);
            snprintf(ttlbuf, sizeof ttlbuf, "%ld", ttl_min);
            char *out = NULL;
            int cr = orch_spec(&out, true, 5, (char *)"claim-next",
                               (char *)"--agent", agent,
                               (char *)"--ttl", ttlbuf);
            if (cr == 3) {
                free(out);
                empty = true;
                break;
            }
            if (cr != 0) {
                fprintf(stderr, "%s", out ? out : "");
                fprintf(stderr, "cg spec run: claim-next failed (rc %d)\n",
                        cr);
                free(out);
                stopping = true;
                rc = 1;
                break;
            }
            char *tobj = out ? json_get_object(out, "task") : NULL;
            char *lobj = out ? json_get_object(out, "lease") : NULL;
            char *id = tobj ? json_get_string(tobj, "id") : NULL;
            char *feat = tobj ? json_get_string(tobj, "feature") : NULL;
            char *attempt = lobj ? json_get_string(lobj, "attempt_id") : NULL;
            long fence = lobj ? json_get_int(lobj, "fence", 0) : 0;
            free(tobj);
            free(lobj);
            free(out);
            if (!id || !id[0] || !attempt || !attempt[0] || fence <= 0) {
                fprintf(stderr, "cg spec run: could not parse claim-next "
                        "attempt identity\n");
                if (id && id[0])
                    orch_abandon(specroot, feat && feat[0] ? feat : feature,
                                 id, agent, attempt ? attempt : "", fence);
                free(id);
                free(feat);
                free(attempt);
                stopping = true;
                rc = 1;
                break;
            }
            const char *tfeat = feat && feat[0] ? feat : feature;

            char prompt[4700];
            int wprc = orch_write_prompt(cgroot, tfeat, id, prompt,
                                         sizeof prompt);
            if (wprc == 0) orch_prompt_steer(prompt, agent);
            if (wprc != 0) {
                fprintf(stderr, "cg spec run: could not write prompt for "
                        "task %s\n", id);
                orch_abandon(specroot, tfeat, id, agent, attempt, fence);
                orch_note_failure(tfeat, id, -1);
                failures++;
                free(id);
                free(feat);
                free(attempt);
                continue;
            }
            char *av[ORCH_MAX_ARGV];
            int ac = orch_argv(cfg.driver, extra, cfg.cmd, -1, cgroot,
                               prompt, id, agent, av, ORCH_MAX_ARGV);
            if (ac < 0) {
                fprintf(stderr, "cg spec run: cannot build a %s command "
                        "line\n", cfg.driver);
                orch_abandon(specroot, tfeat, id, agent, attempt, fence);
                free(id);
                free(feat);
                free(attempt);
                stopping = true;
                rc = 1;
                break;
            }
            char logpath[4700];
            snprintf(logpath, sizeof logpath,
                     "%s/.codegraph/agents/%s-%s.log", cgroot, tfeat, id);
            pid_t pid = orch_spawn(av, cgroot, prompt, logpath, agent,
                                   tfeat, id, attempt, fence);
            orch_argv_free(av);
            if (pid < 0) {
                fprintf(stderr, "cg spec run: fork failed: %s\n",
                        strerror(errno));
                orch_abandon(specroot, tfeat, id, agent, attempt, fence);
                orch_note_failure(tfeat, id, -1);
                failures++;
                free(id);
                free(feat);
                free(attempt);
                continue;
            }
            slots[i].pid = pid;
            slots[i].live = true;
            snprintf(slots[i].id, sizeof slots[i].id, "%s", id);
            snprintf(slots[i].feature, sizeof slots[i].feature, "%s", tfeat);
            snprintf(slots[i].agent, sizeof slots[i].agent, "%s", agent);
            snprintf(slots[i].attempt, sizeof slots[i].attempt, "%s",
                     attempt);
            slots[i].fence = fence;
            slots[i].last_heartbeat = (long)time(NULL);
            printf("[run] task %s → %s (agent %s, log "
                   ".codegraph/agents/%s-%s.log)\n", id, cfg.driver, agent,
                   tfeat, id);
            fflush(stdout);
            orch_event("orch.spawn", "flat", agent, tfeat, id, pid, -999,
                       NULL, NULL, logpath);
            {
                char subj[300];
                snprintf(subj, sizeof subj, "%s/%s", tfeat, id);
                driver_tap_init(&slots[i].tap, logpath, agent, "flat", subj);
            }
            free(id);
            free(feat);
            free(attempt);
        }

        int live = orch_live(slots, nslots);
        if (live == 0) {
            if (stopping) break;
            if (empty) {
                printf("[run] frontier empty — %d failure(s) this run\n",
                       failures);
                break;
            }
        }
        struct timespec ts = { 0, 150 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }

    sigaction(SIGINT, &oldint, NULL);
    sigaction(SIGTERM, &oldterm, NULL);
    sigaction(SIGHUP, &oldhup, NULL);
    orch_cfg_free(&cfg);
    free(feature);
    return rc;
}

/* ================= the two-level fleet run (task 2.3) =================
 *
 * The flat run above claims a task per slot and drives one agent each. A
 * fleet run adds the level the hierarchy declares: one feature manager per
 * feature — owning the feature branch and its worktree — and wave workers
 * under it, each on the wave branch `cg fleet begin` cuts for them. Every
 * child carries its identity in its environment (CG_AGENT, CG_ROLE,
 * CG_PARENT, CG_FEATURE, CG_WAVE, CG_BRANCH, CG_BASE), so the first cg it
 * runs already knows who it is, whose subtree it is in, and which branch
 * its work belongs on.
 *
 * A manager is not finished when its process exits: it is finished when
 * every task of its feature is qualified and the feature branch is merged
 * into main. Until then it is woken again — once its workers are idle,
 * because the two levels share the feature worktree and must not race for
 * it — from a fixed budget of wakes. The run ends when the subtree is
 * complete (0), when failures exceed --max-fail, or when no wake is left
 * to spend (1).
 *
 * Statuses live on branches here: a worker qualifies its task on its wave
 * branch, so the main tree's spec.kvx still says pending until the feature
 * lands. Every "is this done" question therefore asks three sources — the
 * main tree, the feature worktree's checkout, and the attempt ledger. */

#define ORCH_WAKE_BACKOFF  1          /* seconds between manager wakes */
#define ORCH_ROUNDS_DFLT   16          /* manager wakes before giving up */

/* ---------------- small shared pieces ---------------- */

static Kvx *orch_hier(const char *tree, Hierarchy *h) {
    char path[4700];
    snprintf(path, sizeof path, "%s/spec/workflow.kvx", tree);
    Kvx *wf = kvx_parse(path);
    hier_load(wf, h);
    return wf;
}

/* a branch's worktree, exactly where the lifecycle puts it:
 * <worktrees>/<branch with / as ->, under the shared tree unless the
 * configured root is absolute */
static void orch_worktree_path(const Hierarchy *h, const char *tree,
                               const char *branch, char *out, size_t cap) {
    char name[512];
    size_t i = 0;
    for (const char *p = branch; *p && i + 1 < sizeof name; p++)
        name[i++] = *p == '/' ? '-' : *p;
    name[i] = 0;
    if (h->worktrees[0] == '/') snprintf(out, cap, "%s/%s", h->worktrees, name);
    else snprintf(out, cap, "%s/%s/%s", tree, h->worktrees, name);
}

static void orch_excerpt(const StrBuf *b, char *out, size_t cap) {
    size_t n = 0;
    for (const char *p = b->p; p && *p && n + 1 < cap; p++) {
        if (*p == '\n') { if (n && out[n - 1] != ' ') out[n++] = ' '; }
        else out[n++] = *p;
    }
    while (n && out[n - 1] == ' ') n--;
    out[n] = 0;
}

/* commits on <branch> that <base> does not have; -1 when there is no such
 * branch (nothing has been merged up yet) */
static long orch_ahead(const char *tree, const char *base, const char *branch) {
    if (!git_branch_exists(tree, branch)) return -1;
    StrBuf range; sb_init(&range);
    sb_printf(&range, "%s..%s", base, branch);
    StrBuf a; sb_init(&a);
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

/* The identity a child inherits. fleet_worker_begin sets these in this
 * process too (its claim has to carry them), so the orchestrator saves what
 * it had and puts it back: an orchestrator left with CG_ROLE=worker would
 * register itself as one on its next in-process claim. */
enum { ORCH_ENVN = 7 };
static const char *ORCH_ENV[ORCH_ENVN] = {
    "CG_AGENT", "CG_ROLE", "CG_PARENT", "CG_FEATURE", "CG_WAVE",
    "CG_BRANCH", "CG_BASE"
};
typedef struct { char *v[ORCH_ENVN]; } OrchEnv;

static void orch_env_save(OrchEnv *s) {
    for (int i = 0; i < ORCH_ENVN; i++) {
        const char *v = getenv(ORCH_ENV[i]);
        s->v[i] = v ? xstrdup(v) : NULL;
    }
}

static void orch_env_restore(OrchEnv *s) {
    for (int i = 0; i < ORCH_ENVN; i++) {
        if (s->v[i]) setenv(ORCH_ENV[i], s->v[i], 1);
        else unsetenv(ORCH_ENV[i]);
        free(s->v[i]);
        s->v[i] = NULL;
    }
}

static void orch_env_apply(const FleetNode *n) {
    setenv("CG_AGENT", n->agent, 1);
    setenv("CG_ROLE", n->role, 1);
    if (n->parent[0]) setenv("CG_PARENT", n->parent, 1);
    else unsetenv("CG_PARENT");
    setenv("CG_FEATURE", n->feature, 1);
    setenv("CG_BRANCH", n->branch, 1);
    setenv("CG_BASE", n->base, 1);
    if (n->wave >= 0) {
        char w[24];
        snprintf(w, sizeof w, "%ld", n->wave);
        setenv("CG_WAVE", w, 1);
    } else {
        unsetenv("CG_WAVE");
    }
}

/* Who this node is, in the agents registry, before it has run anything — so
 * `cg fleet tree` and the fleet view see the branch and worktree the
 * orchestrator handed it while the child is still starting up. */
static void orch_agent_record(Cg *g, const FleetNode *n) {
    sqlite3_stmt *st = cg_prep(g,
        "INSERT INTO agents(agent,role,parent,feature,wave,branch,worktree,"
        "base,seen) VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(agent) DO UPDATE "
        "SET role=excluded.role,parent=excluded.parent,"
        "feature=excluded.feature,wave=excluded.wave,branch=excluded.branch,"
        "worktree=excluded.worktree,base=excluded.base,seen=excluded.seen");
    if (!st) return;
    sqlite3_bind_text(st, 1, n->agent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, n->role, -1, SQLITE_TRANSIENT);
    if (n->parent[0]) sqlite3_bind_text(st, 3, n->parent, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 3);
    sqlite3_bind_text(st, 4, n->feature, -1, SQLITE_TRANSIENT);
    if (n->wave >= 0) sqlite3_bind_int64(st, 5, n->wave);
    else sqlite3_bind_null(st, 5);
    sqlite3_bind_text(st, 6, n->branch, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 7, n->worktree, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 8, n->base, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 9, (long)time(NULL));
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* fork/exec one fleet child: its own process group, the briefing on stdin,
 * everything it says in its log, and the whole identity in its environment.
 * A manager carries no task, so CG_TASK/CG_ATTEMPT/CG_FENCE are cleared
 * rather than inherited from the orchestrator. */
static pid_t orch_fleet_exec(char **av, const FleetNode *n,
                             const char *promptfile, const char *logpath) {
    pid_t pid = fork();
    if (pid != 0) {
        if (pid > 0) setpgid(pid, pid);
        return pid;
    }
    setpgid(0, 0);
    int in = open(promptfile, O_RDONLY);
    if (in < 0) _exit(127);
    int lg = open(logpath, O_WRONLY | O_CREAT | O_TRUNC, 0644);
    dup2(in, 0);
    if (lg >= 0) { dup2(lg, 1); dup2(lg, 2); }
    if (in > 2) close(in);
    if (lg > 2) close(lg);
    if (chdir(n->worktree) != 0) _exit(127);
    setenv("CG_AGENT", n->agent, 1);
    setenv("CG_ROLE", n->role, 1);
    if (n->parent[0]) setenv("CG_PARENT", n->parent, 1);
    setenv("CG_FEATURE", n->feature, 1);
    setenv("CG_BRANCH", n->branch, 1);
    setenv("CG_BASE", n->base, 1);
    char buf[32];
    if (n->wave >= 0) {
        snprintf(buf, sizeof buf, "%ld", n->wave);
        setenv("CG_WAVE", buf, 1);
    } else {
        unsetenv("CG_WAVE");
    }
    if (n->task[0]) {
        char tag[256];
        snprintf(tag, sizeof tag, "%s/%s", n->feature, n->task);
        setenv("CG_TASK", tag, 1);
        setenv("CG_ATTEMPT", n->attempt, 1);
        snprintf(buf, sizeof buf, "%ld", n->fence);
        setenv("CG_FENCE", buf, 1);
    } else {
        unsetenv("CG_TASK");
        unsetenv("CG_ATTEMPT");
        unsetenv("CG_FENCE");
    }
    execvp(av[0], av);
    _exit(127);
}

/* ---------------- the feature's task list, branch-aware ---------------- */

typedef struct {
    char id[64];
    char title[200];
    char status[32];      /* what the main tree declares */
    long wave;
    bool finished;        /* qualified: main, the feature branch, or the ledger */
    bool claimed;         /* a live lease is out on it */
    char **req; int nreq;
} OrchTask;

static void orch_tasks_free(OrchTask *v, int n) {
    for (int i = 0; i < n; i++) {
        for (int j = 0; j < v[i].nreq; j++) free(v[i].req[j]);
        free(v[i].req);
    }
    free(v);
}

/* The feature's leaves with all three answers to "is it done": the main
 * tree's declaration, the feature worktree's checkout (what merge-up has
 * brought up), and a completed attempt (what a worker qualified on its own
 * branch, before any merge). fwt may be NULL. */
static int orch_tasks_load(Cg *cg, const char *feature, const char *fwt,
                           OrchTask **out) {
    *out = NULL;
    char path[4700];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", cg->shared, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return 0;
    Kvx *fk = NULL;
    if (fwt && fwt[0]) {
        char fp[4800];
        snprintf(fp, sizeof fp, "%s/spec/%s/spec.kvx", fwt, feature);
        fk = kvx_parse(fp);
    }
    char **ids = NULL;
    int nids = kvx_subsections(k, "task", &ids);
    kvx_sort_dotted(ids, nids);
    OrchTask *v = xmalloc(sizeof(OrchTask) * (size_t)(nids > 0 ? nids : 1));
    int n = 0;
    for (int i = 0; i < nids; i++) {
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", ids[i]);
        if (kvx_raw(k, sec, "wave")) {          /* a leaf, not a heading */
            OrchTask *t = &v[n++];
            memset(t, 0, sizeof *t);
            snprintf(t->id, sizeof t->id, "%s", ids[i]);
            char *s = kvx_str(k, sec, "title");
            snprintf(t->title, sizeof t->title, "%s", s ? s : "");
            free(s);
            s = kvx_str(k, sec, "status");
            snprintf(t->status, sizeof t->status, "%s",
                     s && s[0] ? s : "pending");
            free(s);
            t->wave = kvx_long(k, sec, "wave", 0);
            t->nreq = kvx_list(k, sec, "requires", &t->req);
            t->finished = strcmp(t->status, "done") == 0 ||
                          strcmp(t->status, "implemented") == 0;
            if (!t->finished && fk) {
                char *fs = kvx_str(fk, sec, "status");
                if (fs && (strcmp(fs, "done") == 0 ||
                           strcmp(fs, "implemented") == 0))
                    t->finished = true;
                free(fs);
            }
        }
        free(ids[i]);
    }
    free(ids);
    kvx_free(k);
    kvx_free(fk);

    sqlite3_stmt *st = cg_prep(cg,
        "SELECT task FROM attempts WHERE task LIKE ?||'/%' "
        "AND state='completed'");
    if (st) {
        sqlite3_bind_text(st, 1, feature, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *tag = (const char *)sqlite3_column_text(st, 0);
            const char *id = strrchr(tag, '/');
            id = id ? id + 1 : tag;
            for (int i = 0; i < n; i++)
                if (strcmp(v[i].id, id) == 0) v[i].finished = true;
        }
        sqlite3_finalize(st);
    }
    st = cg_prep(cg,
        "SELECT task FROM leases WHERE task LIKE ?||'/%' "
        "AND expires > strftime('%s','now')");
    if (st) {
        sqlite3_bind_text(st, 1, feature, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *tag = (const char *)sqlite3_column_text(st, 0);
            const char *id = strrchr(tag, '/');
            id = id ? id + 1 : tag;
            for (int i = 0; i < n; i++)
                if (strcmp(v[i].id, id) == 0) v[i].claimed = true;
        }
        sqlite3_finalize(st);
    }
    for (int i = 1; i < n; i++) {            /* wave order, dotted within */
        OrchTask t = v[i];
        int j = i;
        while (j > 0 && v[j - 1].wave > t.wave) { v[j] = v[j - 1]; j--; }
        v[j] = t;
    }
    *out = v;
    return n;
}

static long orch_task_wave(Cg *cg, const char *feature, const char *id) {
    char path[4700], sec[300];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", cg->shared, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return -1;
    snprintf(sec, sizeof sec, "task.%s", id);
    long w = kvx_raw(k, sec, "wave") ? kvx_long(k, sec, "wave", 0) : -1;
    kvx_free(k);
    return w;
}

/* what a manager still owes, in one struct */
typedef struct {
    int  total, done, claimed;
    bool all_done;
    long ahead;        /* feature branch commits main does not have; -1 none */
    bool merged;
    bool complete;
} OrchSubtree;

static void orch_subtree(Cg *cg, const char *feature, const char *fbranch,
                         const char *fwt, const char *main_branch,
                         OrchSubtree *s) {
    memset(s, 0, sizeof *s);
    OrchTask *v = NULL;
    int n = orch_tasks_load(cg, feature, fwt, &v);
    for (int i = 0; i < n; i++) {
        s->total++;
        if (v[i].finished) s->done++;
        else if (v[i].claimed) s->claimed++;
    }
    orch_tasks_free(v, n);
    s->all_done = s->total > 0 && s->done == s->total;
    s->ahead = orch_ahead(cg->shared, main_branch, fbranch);
    s->merged = s->ahead <= 0;
    s->complete = s->all_done && s->merged;
}

/* ---------------- level one: the feature manager ---------------- */

typedef struct { Cg *g; const char *feature; } OrchPlanCall;

static int orch_call_plan(void *v) {
    OrchPlanCall *c = v;
    char *av[5] = { (char *)"cg", (char *)"fleet", (char *)"plan",
                    (char *)"-f", (char *)c->feature };
    fflush(stderr);
    int saved = dup(2);
    dup2(1, 2);
    int rc = cmd_fleet(c->g, 5, av, false);
    fflush(stdout);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
    return rc;
}

/* A manager holds no task, so it gets no task packet: its briefing is who
 * it is, the fleet's own plan for the feature, and the two commands that
 * are the only way its subtree can end. */
static int orch_manager_prompt(Cg *cg, const FleetNode *n, const char *path) {
    char dir[4600];
    snprintf(dir, sizeof dir, "%s/.codegraph/agents", cg->shared);
    mkdirs(dir);
    StrBuf b; sb_init(&b);
    sb_printf(&b, "# feature manager: %s\n\n", n->feature);
    sb_printf(&b, "You are %s, the feature manager for %s.\n", n->agent,
              n->feature);
    sb_printf(&b, "  branch:   %s (cut from %s)\n", n->branch, n->base);
    sb_printf(&b, "  worktree: %s\n", n->worktree);
    sb_printf(&b, "  reports:  %s\n\n", n->parent[0] ? n->parent : "-");
    sb_puts(&b, "Your wave workers are spawned for you, each on its own wave "
            "branch and worktree. You own the feature branch: take what they "
            "hand up, keep it green, and land it.\n\n");
    char *plan = NULL;
    OrchPlanCall pc = { cg, n->feature };
    if (cg_capture(&plan, orch_call_plan, &pc) == 0 && plan && plan[0]) {
        sb_puts(&b, plan);
        sb_putc(&b, '\n');
    }
    free(plan);
    const char *bs = getenv("CG_PACKET_BUDGET");
    manager_packet_build(cg, n->feature, bs && atoi(bs) > 0 ? atoi(bs) : 4000, &b);
    sb_printf(&b,
        "Your subtree is complete only once every task of %s is qualified "
        "and %s is merged into %s:\n"
        "  cg fleet tree -f %s      # where your workers stand\n"
        "  cg fleet merge-up <id>   # a wave branch a worker handed up\n"
        "  cg fleet land %s         # the gates, then main\n"
        "  cg fleet pr %s           # the pull request\n",
        n->feature, n->branch, n->base, n->feature, n->feature, n->feature);
    int rc = write_entire_file(path, b.p, b.len);
    sb_free(&b);
    return rc;
}

int orch_spawn_manager(Cg *cg, const char *feature, const char *driver,
                       const char *extra, const char *cmd_tmpl, bool dry_run,
                       FleetNode *n) {
    memset(n, 0, sizeof *n);
    n->pid = -1;
    n->wave = -1;
    Hierarchy h;
    Kvx *wf = orch_hier(cg->shared, &h);
    if (!h.enabled) {
        fprintf(stderr, "cg spec run: no enabled [hierarchy] in "
                "spec/workflow.kvx — there is no fleet to spawn\n");
        hier_free(&h);
        kvx_free(wf);
        return 1;
    }
    const FleetRole *rf = &h.roles[FLEET_FEATURE];
    snprintf(n->feature, sizeof n->feature, "%s", feature);
    snprintf(n->role, sizeof n->role, "feature");
    hier_expand(&h, rf->agent, feature, -1, n->agent, sizeof n->agent);
    hier_expand(&h, rf->branch, feature, -1, n->branch, sizeof n->branch);
    hier_expand(&h, rf->base, feature, -1, n->base, sizeof n->base);
    hier_expand(&h, h.roles[FLEET_MAIN].agent, feature, -1, n->parent,
                sizeof n->parent);
    orch_worktree_path(&h, cg->shared, n->branch, n->worktree,
                       sizeof n->worktree);
    hier_free(&h);
    kvx_free(wf);

    char prompt[4700], logpath[4700];
    snprintf(prompt, sizeof prompt, "%s/.codegraph/agents/%s-manager.prompt",
             cg->shared, feature);
    snprintf(logpath, sizeof logpath, "%s/.codegraph/agents/%s-manager.log",
             cg->shared, feature);
    if (dry_run) {
        printf("  manager %s — %s on %s (from %s)\n", n->agent, feature,
               n->branch, n->base);
        printf("    worktree %s\n", n->worktree);
        char *av[ORCH_MAX_ARGV];
        int ac = orch_argv(driver, extra, cmd_tmpl, FLEET_FEATURE, n->worktree,
                           prompt, feature, n->agent, av, ORCH_MAX_ARGV);
        if (ac > 0) {
            printf("    ");
            orch_argv_print(av);
            orch_argv_free(av);
        }
        return 0;
    }

    char parent_dir[4600];
    snprintf(parent_dir, sizeof parent_dir, "%s", n->worktree);
    char *slash = strrchr(parent_dir, '/');
    if (slash) { *slash = 0; mkdirs(parent_dir); }
    StrBuf err; sb_init(&err);
    bool wt_created = false, br_created = false;
    if (git_worktree_add(cg->shared, n->worktree, n->branch, n->base,
                         &wt_created, &br_created, &err) != 0) {
        char ex[300];
        orch_excerpt(&err, ex, sizeof ex);
        fprintf(stderr, "cg spec run: cannot add the manager worktree %s "
                "for %s: %s\n", n->worktree, n->branch, ex);
        sb_free(&err);
        return 1;
    }
    sb_free(&err);
    char hb[256], head[65];
    if (!git_head(n->worktree, hb, sizeof hb, head, sizeof head)) head[0] = 0;
    branch_register(cg, n->branch, n->worktree, head, n->base);

    if (orch_manager_prompt(cg, n, prompt) != 0) {
        fprintf(stderr, "cg spec run: could not write the briefing for %s\n",
                n->agent);
        return 1;
    }
    orch_prompt_steer(prompt, n->agent);
    char *av[ORCH_MAX_ARGV];
    int ac = orch_argv(driver, extra, cmd_tmpl, FLEET_FEATURE, n->worktree,
                       prompt, feature, n->agent, av, ORCH_MAX_ARGV);
    if (ac < 0) {
        fprintf(stderr, "cg spec run: cannot build a %s command line\n",
                driver);
        return 1;
    }
    orch_agent_record(cg, n);
    pid_t pid = orch_fleet_exec(av, n, prompt, logpath);
    orch_argv_free(av);
    if (pid < 0) {
        fprintf(stderr, "cg spec run: fork failed: %s\n", strerror(errno));
        return 1;
    }
    n->pid = (int)pid;
    return 0;
}

/* ---------------- level two: the wave worker ---------------- */

typedef struct { Cg *g; const char *id; const char *feature; } OrchBeginCall;

static int orch_call_begin(void *v) {
    OrchBeginCall *c = v;
    fflush(stderr);
    int saved = dup(2);
    dup2(1, 2);                     /* keep refusals with the capture */
    int rc = fleet_worker_begin(c->g, c->id, c->feature, NULL, true);
    fflush(stdout);
    fflush(stderr);
    dup2(saved, 2);
    close(saved);
    return rc;
}

static void orch_json_into(const char *js, const char *key, char *out,
                           size_t cap) {
    char *s = json_get_string(js, key);
    if (s && s[0]) snprintf(out, cap, "%s", s);
    free(s);
}

int orch_spawn_worker(Cg *cg, const char *feature, const char *id,
                      const char *driver, const char *extra,
                      const char *cmd_tmpl, bool dry_run, FleetNode *n) {
    memset(n, 0, sizeof *n);
    n->pid = -1;
    n->wave = -1;
    snprintf(n->feature, sizeof n->feature, "%s", feature);
    snprintf(n->role, sizeof n->role, "worker");
    snprintf(n->task, sizeof n->task, "%s", id);

    Hierarchy h;
    Kvx *wf = orch_hier(cg->shared, &h);
    if (!h.enabled) {
        fprintf(stderr, "cg spec run: no enabled [hierarchy] in "
                "spec/workflow.kvx — there is no fleet to spawn\n");
        hier_free(&h);
        kvx_free(wf);
        return 1;
    }
    long wave = orch_task_wave(cg, feature, id);
    const FleetRole *rw = &h.roles[FLEET_WORKER];
    n->wave = wave;
    hier_expand_task(&h, rw->agent, feature, wave, id, n->agent, sizeof n->agent);
    hier_expand_task(&h, rw->branch, feature, wave, id, n->branch, sizeof n->branch);
    hier_expand_task(&h, rw->base, feature, wave, id, n->base, sizeof n->base);
    hier_expand(&h, h.roles[FLEET_FEATURE].agent, feature, -1, n->parent,
                sizeof n->parent);
    orch_worktree_path(&h, cg->shared, n->branch, n->worktree,
                       sizeof n->worktree);
    hier_free(&h);
    kvx_free(wf);

    char prompt[4700], logpath[4700];
    snprintf(prompt, sizeof prompt, "%s/.codegraph/agents/%s-%s.prompt",
             cg->shared, feature, id);
    snprintf(logpath, sizeof logpath, "%s/.codegraph/agents/%s-%s.log",
             cg->shared, feature, id);
    if (dry_run) {
        printf("    worker %s — %s (wave %ld) on %s (from %s)\n", n->agent,
               id, wave, n->branch, n->base);
        char *av[ORCH_MAX_ARGV];
        int ac = orch_argv(driver, extra, cmd_tmpl, FLEET_WORKER, n->worktree,
                           prompt, id, n->agent, av, ORCH_MAX_ARGV);
        if (ac > 0) {
            printf("      ");
            orch_argv_print(av);
            orch_argv_free(av);
        }
        return 0;
    }

    /* The branch, the worktree, and the fenced claim are one step, and it
     * is the lifecycle's — not a second copy of it here. It setenvs the
     * worker's identity into this process to make the claim, so the
     * orchestrator's own environment is saved around the call. */
    OrchEnv saved;
    orch_env_save(&saved);
    char *js = NULL;
    OrchBeginCall bc = { cg, id, feature };
    int brc = cg_capture(&js, orch_call_begin, &bc);
    if (brc != 0) {
        orch_env_restore(&saved);
        if (js && js[0]) fprintf(stderr, "%s", js);
        fprintf(stderr, "cg spec run: `cg fleet begin %s` was refused "
                "(rc %d) — nothing was spawned for it\n", id, brc);
        free(js);
        return 1;
    }
    orch_json_into(js, "agent", n->agent, sizeof n->agent);
    orch_json_into(js, "parent", n->parent, sizeof n->parent);
    orch_json_into(js, "branch", n->branch, sizeof n->branch);
    orch_json_into(js, "base", n->base, sizeof n->base);
    orch_json_into(js, "worktree", n->worktree, sizeof n->worktree);
    n->wave = json_get_int(js, "wave", wave);
    char *at = json_get_object(js, "attempt");
    if (at) {
        orch_json_into(at, "attempt_id", n->attempt, sizeof n->attempt);
        n->fence = json_get_int(at, "fence", 0);
        free(at);
    }
    free(js);
    if (!n->attempt[0] || n->fence <= 0) {
        orch_env_restore(&saved);
        fprintf(stderr, "cg spec run: `cg fleet begin %s` returned no fenced "
                "claim\n", id);
        return 1;
    }

    /* the briefing is written under the worker's identity, so resume ends
     * on the command that hands the wave up */
    orch_env_apply(n);
    int prc = orch_write_prompt(cg->shared, feature, id, prompt,
                                sizeof prompt);
    orch_env_restore(&saved);
    if (prc == 0) orch_prompt_steer(prompt, n->agent);
    if (prc == 0 && g_retry_attempt > 0)
        orch_prompt_retry(prompt, feature, id, g_retry_attempt);
    if (prc != 0) {
        fprintf(stderr, "cg spec run: could not write the briefing for task "
                "%s\n", id);
        orch_abandon(cg->shared, feature, id, n->agent, n->attempt, n->fence);
        return 1;
    }
    char *av[ORCH_MAX_ARGV];
    int ac = orch_argv(driver, extra, cmd_tmpl, FLEET_WORKER, n->worktree,
                       prompt, id, n->agent, av, ORCH_MAX_ARGV);
    if (ac < 0) {
        fprintf(stderr, "cg spec run: cannot build a %s command line\n",
                driver);
        orch_abandon(cg->shared, feature, id, n->agent, n->attempt, n->fence);
        return 1;
    }
    orch_agent_record(cg, n);
    pid_t pid = orch_fleet_exec(av, n, prompt, logpath);
    orch_argv_free(av);
    if (pid < 0) {
        fprintf(stderr, "cg spec run: fork failed: %s\n", strerror(errno));
        orch_abandon(cg->shared, feature, id, n->agent, n->attempt, n->fence);
        return 1;
    }
    n->pid = (int)pid;
    return 0;
}

/* ---------------- the tree: main -> managers -> workers ---------------- */

static void orch_ago(long seen, char *out, size_t cap) {
    if (seen <= 0) { snprintf(out, cap, "-"); return; }
    long d = (long)time(NULL) - seen;
    if (d < 0) d = 0;
    if (d < 60)        snprintf(out, cap, "%lds ago", d);
    else if (d < 3600) snprintf(out, cap, "%ldm ago", d / 60);
    else               snprintf(out, cap, "%ldh ago", d / 3600);
}

typedef struct {
    char agent[128], branch[256], base[256], worktree[4096];
    char task[64], attempt[65], state[32];
    long wave, heartbeat, seen;
} OrchWorkerRow;

/* every worker the registry knows for this feature, newest attempt each */
static int orch_worker_rows(Cg *cg, const char *feature, OrchWorkerRow **out) {
    *out = NULL;
    int n = 0, cap = 0;
    OrchWorkerRow *v = NULL;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT agent, COALESCE(wave,-1), COALESCE(branch,''), "
        "COALESCE(base,''), COALESCE(worktree,''), seen FROM agents "
        "WHERE role='worker' AND feature=? ORDER BY wave, agent");
    if (!st) return 0;
    sqlite3_bind_text(st, 1, feature, -1, SQLITE_TRANSIENT);
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (n == cap) {
            cap = cap ? cap * 2 : 8;
            OrchWorkerRow *bigger = realloc(v, sizeof(OrchWorkerRow) *
                                            (size_t)cap);
            if (!bigger) { free(v); sqlite3_finalize(st); return 0; }
            v = bigger;
        }
        OrchWorkerRow *r = &v[n++];
        memset(r, 0, sizeof *r);
        snprintf(r->agent, sizeof r->agent, "%s",
                 (const char *)sqlite3_column_text(st, 0));
        r->wave = sqlite3_column_int64(st, 1);
        snprintf(r->branch, sizeof r->branch, "%s",
                 (const char *)sqlite3_column_text(st, 2));
        snprintf(r->base, sizeof r->base, "%s",
                 (const char *)sqlite3_column_text(st, 3));
        snprintf(r->worktree, sizeof r->worktree, "%s",
                 (const char *)sqlite3_column_text(st, 4));
        r->seen = sqlite3_column_int64(st, 5);
    }
    sqlite3_finalize(st);
    for (int i = 0; i < n; i++) {
        sqlite3_stmt *q = cg_prep(cg,
            /* rowid breaks the tie: two attempts of the same agent can
             * start within one second, and the newest is the later row */
            "SELECT task, attempt_id, state, heartbeat FROM attempts "
            "WHERE agent=? ORDER BY started DESC, rowid DESC LIMIT 1");
        if (!q) break;
        sqlite3_bind_text(q, 1, v[i].agent, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(q) == SQLITE_ROW) {
            const char *tag = (const char *)sqlite3_column_text(q, 0);
            const char *slash = tag ? strrchr(tag, '/') : NULL;
            snprintf(v[i].task, sizeof v[i].task, "%s",
                     slash ? slash + 1 : (tag ? tag : ""));
            snprintf(v[i].attempt, sizeof v[i].attempt, "%s",
                     (const char *)sqlite3_column_text(q, 1));
            snprintf(v[i].state, sizeof v[i].state, "%s",
                     (const char *)sqlite3_column_text(q, 2));
            v[i].heartbeat = sqlite3_column_int64(q, 3);
        }
        sqlite3_finalize(q);
    }
    *out = v;
    return n;
}

int orch_tree_status(Cg *cg, const char *feature_ov, bool json) {
    Hierarchy h;
    Kvx *wf = orch_hier(cg->shared, &h);
    if (!h.configured) {
        fprintf(stderr, "cg fleet tree: no [hierarchy] in "
                "spec/workflow.kvx — this repository runs flat\n");
        hier_free(&h);
        kvx_free(wf);
        return 1;
    }
    char *active = wf ? kvx_str(wf, "meta", "active_feature") : NULL;
    char feature[128];
    snprintf(feature, sizeof feature, "%s",
             feature_ov && feature_ov[0] ? feature_ov
                                         : (active ? active : ""));
    free(active);
    if (!feature[0]) {
        fprintf(stderr, "cg fleet tree: no active_feature (use -f)\n");
        hier_free(&h);
        kvx_free(wf);
        return 1;
    }
    char mainbr[256], mainagent[128], fagent[128], fbranch[256], fbase[256];
    snprintf(mainbr, sizeof mainbr, "%s", h.main_branch);
    hier_expand(&h, h.roles[FLEET_MAIN].agent, feature, -1, mainagent,
                sizeof mainagent);
    hier_expand(&h, h.roles[FLEET_FEATURE].agent, feature, -1, fagent,
                sizeof fagent);
    hier_expand(&h, h.roles[FLEET_FEATURE].branch, feature, -1, fbranch,
                sizeof fbranch);
    hier_expand(&h, h.roles[FLEET_FEATURE].base, feature, -1, fbase,
                sizeof fbase);
    char fwt[4600];
    orch_worktree_path(&h, cg->shared, fbranch, fwt, sizeof fwt);
    bool enabled = h.enabled;
    hier_free(&h);
    kvx_free(wf);

    OrchSubtree sub;
    orch_subtree(cg, feature, fbranch, fwt, mainbr, &sub);
    long mseen = 0;
    sqlite3_stmt *st = cg_prep(cg, "SELECT seen FROM agents WHERE agent=?");
    if (st) {
        sqlite3_bind_text(st, 1, fagent, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(st) == SQLITE_ROW) mseen = sqlite3_column_int64(st, 0);
        sqlite3_finalize(st);
    }
    OrchWorkerRow *w = NULL;
    int nw = orch_worker_rows(cg, feature, &w);

    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"feature\":");
        sb_json_str(&b, feature);
        sb_printf(&b, ",\"enabled\":%s,\"main\":{\"agent\":",
                  enabled ? "true" : "false");
        sb_json_str(&b, mainagent);
        sb_puts(&b, ",\"role\":\"main\",\"branch\":");
        sb_json_str(&b, mainbr);
        sb_puts(&b, ",\"worktree\":");
        sb_json_str(&b, cg->shared);
        sb_puts(&b, "},\"managers\":[{\"agent\":");
        sb_json_str(&b, fagent);
        sb_puts(&b, ",\"role\":\"feature\",\"parent\":");
        sb_json_str(&b, mainagent);
        sb_puts(&b, ",\"feature\":");
        sb_json_str(&b, feature);
        sb_puts(&b, ",\"branch\":");
        sb_json_str(&b, fbranch);
        sb_puts(&b, ",\"base\":");
        sb_json_str(&b, fbase);
        sb_puts(&b, ",\"worktree\":");
        sb_json_str(&b, fwt);
        sb_printf(&b, ",\"seen\":%ld,\"tasks\":{\"total\":%d,\"done\":%d,"
                  "\"claimed\":%d},\"ahead\":%ld,\"merged\":%s,"
                  "\"complete\":%s,\"drift\":", mseen, sub.total, sub.done,
                  sub.claimed, sub.ahead, sub.merged ? "true" : "false",
                  sub.complete ? "true" : "false");
        drift_summary(cg, feature, NULL, &b);
        sb_puts(&b, ",\"workers\":[");
        for (int i = 0; i < nw; i++) {
            if (i) sb_putc(&b, ',');
            sb_puts(&b, "{\"agent\":");
            sb_json_str(&b, w[i].agent);
            sb_puts(&b, ",\"role\":\"worker\",\"parent\":");
            sb_json_str(&b, fagent);
            sb_printf(&b, ",\"wave\":%ld,\"branch\":", w[i].wave);
            sb_json_str(&b, w[i].branch);
            sb_puts(&b, ",\"base\":");
            sb_json_str(&b, w[i].base);
            sb_puts(&b, ",\"worktree\":");
            sb_json_str(&b, w[i].worktree);
            sb_puts(&b, ",\"task\":");
            sb_json_str(&b, w[i].task);
            sb_puts(&b, ",\"attempt\":");
            sb_json_str(&b, w[i].attempt);
            sb_puts(&b, ",\"state\":");
            sb_json_str(&b, w[i].state[0] ? w[i].state : "idle");
            sb_printf(&b, ",\"heartbeat\":%ld,\"seen\":%ld}", w[i].heartbeat,
                      w[i].seen);
        }
        sb_puts(&b, "]}]}\n");
    } else {
        char ago[32];
        sb_printf(&b, "fleet tree — %s%s\n", feature,
                  enabled ? "" : " (hierarchy disabled)");
        sb_printf(&b, "main     %-16s branch %s\n", mainagent, mainbr);
        orch_ago(mseen, ago, sizeof ago);
        sb_printf(&b, "  feature  %-16s branch %-20s base %s\n", fagent,
                  fbranch, fbase);
        sb_printf(&b, "           tasks %d/%d done, %d running  ahead %ld  "
                  "%s  seen %s\n", sub.done, sub.total, sub.claimed,
                  sub.ahead < 0 ? 0 : sub.ahead,
                  sub.complete ? "complete" : "incomplete", ago);
        {
            StrBuf dt; sb_init(&dt);
            int nd = drift_summary(cg, feature, &dt, NULL);
            if (nd) sb_printf(&b, "           drift %d finding(s):\n%s", nd, dt.p);
            sb_free(&dt);
        }
        if (!nw) sb_puts(&b, "    (no workers yet)\n");
        for (int i = 0; i < nw; i++) {
            orch_ago(w[i].heartbeat, ago, sizeof ago);
            sb_printf(&b, "    worker %-16s branch %-20s wave %ld  task %s  "
                      "%s  hb %s\n", w[i].agent, w[i].branch, w[i].wave,
                      w[i].task[0] ? w[i].task : "-",
                      w[i].state[0] ? w[i].state : "idle", ago);
        }
    }
    fputs(b.p, stdout);
    sb_free(&b);
    free(w);
    return 0;
}

/* ---------------- the two-level loop ---------------- */

enum { ORCH_MAX_TRIED = 256 };

typedef struct {
    FleetNode n;
    bool live;
    long last_heartbeat;
    DriverTap tap;
    long node;            /* fleet_nodes.id */
    long pid_start;       /* kernel start time of n.pid; -1 unknown */
    bool adopted;         /* spawned by an earlier supervisor: not our child */
    /* supervision (4.2): when this attempt began, when it last did
     * anything, and the fingerprints that say whether it has since */
    long started, progress, checked, seen_seq, log_size;
    char tree_fp[65];
    int nudges;
    char why[160];        /* why the supervisor ended it, when it did */
} OrchFleetSlot;

static int orch_live_fleet(const OrchFleetSlot *s, int n) {
    int c = 0;
    for (int i = 0; i < n; i++) c += s[i].live;
    return c;
}

static bool orch_finished_id(const OrchTask *v, int n, const char *id) {
    const char *slash = strrchr(id, '/');
    if (slash) id = slash + 1;
    for (int i = 0; i < n; i++)
        if (strcmp(v[i].id, id) == 0) return v[i].finished;
    return true;                       /* not ours to wait for */
}

/* The next task a worker may take: its requirements qualified, nobody
 * holding it, not already tried in this run, and no live worker on its
 * wave — a wave's branch and worktree are shared, so its tasks run one at
 * a time while different waves run side by side. */
/* attempts this run has made at task id: tried[] keeps one entry per spawn */
static int orch_attempts(char **tried, int ntried, const char *id) {
    int c = 0;
    for (int t = 0; t < ntried; t++) c += strcmp(tried[t], id) == 0;
    return c;
}

/* max_attempts: a task tried this many times is not handed out again */
static int g_max_attempts = 1;


/* Predicted collisions, cached per pair for the run: the graph is asked
 * once, and a serialization is reported once. */
static struct { char a[64], b[64]; bool hit; } g_coll[256];
static int g_ncoll;
static Cg *g_coll_cg;
static const char *g_coll_feature;

static bool orch_collides(const char *a, const char *b) {
    if (!g_coll_cg || !g_coll_feature) return false;
    for (int i = 0; i < g_ncoll; i++)
        if ((!strcmp(g_coll[i].a, a) && !strcmp(g_coll[i].b, b)) ||
            (!strcmp(g_coll[i].a, b) && !strcmp(g_coll[i].b, a)))
            return g_coll[i].hit;
    char why[300] = "";
    bool hit = drift_collision_predict(g_coll_cg, g_coll_feature, a, b, why,
                                       sizeof why);
    if (g_ncoll < 256) {
        snprintf(g_coll[g_ncoll].a, sizeof g_coll[0].a, "%s", a);
        snprintf(g_coll[g_ncoll].b, sizeof g_coll[0].b, "%s", b);
        g_coll[g_ncoll].hit = hit;
        g_ncoll++;
    }
    if (hit) {
        StrBuf p; sb_init(&p);
        sb_puts(&p, "{\"task\":"); sb_json_str(&p, a);
        sb_puts(&p, ",\"with\":"); sb_json_str(&p, b);
        sb_puts(&p, ",\"why\":"); sb_json_str(&p, why);
        sb_puts(&p, ",\"action\":\"serialized\"}");
        char subj[300];
        snprintf(subj, sizeof subj, "%s/%s", g_coll_feature, a);
        events_emit(g_coll_cg, "drift.collision", subj, p.p);
        sb_free(&p);
        printf("[fleet] %s waits for %s — predicted collision: %s\n", a, b, why);
        fflush(stdout);
    }
    return hit;
}

/* May this task take a slot beside the live ones? A wave's tasks share a
 * branch and worktree unless the worker template names {task}, so then
 * they run one after the other; either way a predicted collision with a
 * live task waits. */
static bool orch_task_slots(const OrchTask *t, const OrchFleetSlot *slots,
                            int nslots) {
    for (int s = 0; s < nslots; s++) {
        if (!slots[s].live) continue;
        if (!g_per_task && slots[s].n.wave == t->wave) return false;
        if (orch_collides(t->id, slots[s].n.task)) return false;
    }
    return true;
}

static bool orch_next_task(const OrchTask *v, int n, char **tried, int ntried,
                           const OrchFleetSlot *slots, int nslots,
                           char *out, size_t cap) {
    for (int i = 0; i < n; i++) {
        if (v[i].finished || v[i].claimed) continue;
        bool skip = orch_attempts(tried, ntried, v[i].id) >= g_max_attempts;
        for (int j = 0; j < v[i].nreq && !skip; j++)
            if (!orch_finished_id(v, n, v[i].req[j])) skip = true;
        if (!skip && !orch_task_slots(&v[i], slots, nslots)) skip = true;
        if (skip) continue;
        snprintf(out, cap, "%s", v[i].id);
        return true;
    }
    return false;
}

static int orch_node_heartbeat(const FleetNode *n, long ttl_min) {
    OrchSlot s;
    memset(&s, 0, sizeof s);
    snprintf(s.id, sizeof s.id, "%s", n->task);
    snprintf(s.agent, sizeof s.agent, "%s", n->agent);
    snprintf(s.attempt, sizeof s.attempt, "%s", n->attempt);
    s.fence = n->fence;
    return orch_heartbeat(&s, ttl_min);
}

/* ---------------- durable runs: the supervisor ---------------- */

/* The kernel's start time for pid (clock ticks since boot), so a pid the
 * kernel has since handed to another process is not taken for the agent. */
static long proc_start_time(pid_t pid) {
#ifdef __linux__
    char p[64];
    snprintf(p, sizeof p, "/proc/%d/stat", (int)pid);
    FILE *f = fopen(p, "r");
    if (!f) return -1;
    char buf[2048];
    size_t n = fread(buf, 1, sizeof buf - 1, f);
    fclose(f);
    buf[n] = 0;
    char *rp = strrchr(buf, ')');       /* comm may hold spaces and parens */
    if (!rp) return -1;
    int field = 2;
    char *save = NULL;
    for (char *t = strtok_r(rp + 1, " ", &save); t; t = strtok_r(NULL, " ", &save)) {
        if (++field == 3 && t[0] == 'Z') return -2;   /* a zombie is gone */
        if (field == 22) return atol(t);
    }
    return -1;
#else
    (void)pid;
    return -1;
#endif
}

static bool proc_alive(pid_t pid, long start) {
    if (pid <= 0) return false;
    if (kill(pid, 0) != 0 && errno != EPERM) return false;
    long now = proc_start_time(pid);
    if (now == -2) return false;
    return start <= 0 || now < 0 || now == start;
}

/* one supervisor per project: held for the supervisor's whole life */
static int sup_lock_path(const char *shared, char *out, size_t cap) {
    char dir[4600];
    snprintf(dir, sizeof dir, "%s/%s/fleet", shared, CG_DIR);
    mkdirs(dir);
    return snprintf(out, cap, "%s/supervisor.lock", dir) < (int)cap ? 0 : -1;
}

static int sup_lock_take(const char *shared) {
    char p[4700];
    if (sup_lock_path(shared, p, sizeof p) != 0) return -1;
    int fd = open(p, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (fd < 0) return -1;
    if (flock(fd, LOCK_EX | LOCK_NB) != 0) { close(fd); return -1; }
    return fd;
}

bool fleet_supervisor_alive(const char *shared) {
    int fd = sup_lock_take(shared);
    if (fd < 0) return true;
    flock(fd, LOCK_UN);
    close(fd);
    return false;
}

typedef struct {
    Cg *g;
    char run[40], feature[128], fbranch[256], fwt[4600], mainbr[256];
    const OrchCfg *cfg;
    const char *extra;
    int nslots, maxfail, failures, rc, wakes, ntried;
    OrchFleetSlot *slots;
    FleetNode mgr;
    DriverTap mgr_tap;
    bool mgr_live, mgr_adopted;
    long mgr_node, mgr_start, last_wake, ttl_min, waiting_on;
    bool stopping, paused, first_turn, frontier_empty;
    char *tried[ORCH_MAX_TRIED];
    char state[16];
    /* escalations (4.2): a task out of retries goes to its manager (level
     * 1), then — after a manager wake that did not rescue it — to main and
     * is blocked (level 2) */
    char esc_task[32][64];
    int esc_level[32], nesc, n_unfinished, n_blocked;
    int esc_wakes[32];
    bool mgr_needed;      /* an escalation or a conflict wants the manager */
    long conflict_seq;    /* merge conflicts seen up to this event */
} Sup;

enum { SUP_GO = 0, SUP_DONE = 1 };

static void sup_event(Sup *s, const char *state, const char *reason) {
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"run\":"); sb_json_str(&p, s->run);
    sb_puts(&p, ",\"feature\":"); sb_json_str(&p, s->feature);
    sb_puts(&p, ",\"state\":"); sb_json_str(&p, state);
    sb_puts(&p, ",\"reason\":");
    if (reason) sb_json_str(&p, reason); else sb_puts(&p, "null");
    sb_printf(&p, ",\"failures\":%d,\"wakes_left\":%d,\"pid\":%d}",
              s->failures, s->wakes, (int)getpid());
    events_emit(s->g, "fleet.run", s->run, p.p);
    sb_free(&p);
}

static void sup_save(Sup *s) {
    sqlite3_stmt *st = cg_prep(s->g,
        "UPDATE fleet_runs SET wakes_left=?,failures=?,first_turn=?,"
        "last_wake=?,updated=? WHERE run=?");
    sqlite3_bind_int(st, 1, s->wakes);
    sqlite3_bind_int(st, 2, s->failures);
    sqlite3_bind_int(st, 3, s->first_turn ? 1 : 0);
    sqlite3_bind_int64(st, 4, s->last_wake);
    sqlite3_bind_int64(st, 5, (long)time(NULL));
    sqlite3_bind_text(st, 6, s->run, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

static void sup_set_state(Sup *s, const char *state, const char *reason) {
    sqlite3_stmt *st = cg_prep(s->g,
        "UPDATE fleet_runs SET state=?,reason=?,rc=?,updated=? WHERE run=?");
    sqlite3_bind_text(st, 1, state, -1, SQLITE_TRANSIENT);
    if (reason) sqlite3_bind_text(st, 2, reason, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 2);
    sqlite3_bind_int(st, 3, s->rc);
    sqlite3_bind_int64(st, 4, (long)time(NULL));
    sqlite3_bind_text(st, 5, s->run, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
    snprintf(s->state, sizeof s->state, "%s", state);
    sup_event(s, state, reason);
}

/* the state a person asked for: running, paused, draining, or stopping */
static void sup_control(Sup *s) {
    sqlite3_stmt *st = cg_prep(s->g, "SELECT state FROM fleet_runs WHERE run=?");
    sqlite3_bind_text(st, 1, s->run, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(st) == SQLITE_ROW) {
        const char *v = (const char *)sqlite3_column_text(st, 0);
        if (v) snprintf(s->state, sizeof s->state, "%s", v);
    }
    sqlite3_finalize(st);
}

static long sup_node_add(Sup *s, const FleetNode *n, const char *log,
                         long pid_start) {
    sqlite3_stmt *st = cg_prep(s->g,
        "INSERT INTO fleet_nodes(run,role,agent,parent,feature,task,wave,"
        "branch,base,worktree,pid,pid_start,attempt,fence,state,log,started) "
        "VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,'live',?,?)");
    sqlite3_bind_text(st, 1, s->run, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, n->role, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, n->agent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 4, n->parent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 5, n->feature, -1, SQLITE_TRANSIENT);
    if (n->task[0]) sqlite3_bind_text(st, 6, n->task, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 6);
    sqlite3_bind_int64(st, 7, n->wave);
    sqlite3_bind_text(st, 8, n->branch, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 9, n->base, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 10, n->worktree, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(st, 11, n->pid);
    sqlite3_bind_int64(st, 12, pid_start);
    sqlite3_bind_text(st, 13, n->attempt, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 14, n->fence);
    sqlite3_bind_text(st, 15, log, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int64(st, 16, (long)time(NULL));
    sqlite3_step(st);
    sqlite3_finalize(st);
    return (long)sqlite3_last_insert_rowid(s->g->db);
}

/* exit < -900: not known (an adopted process, reaped by someone else) */
static void sup_node_end(Sup *s, long id, const char *state, int exit,
                         const char *outcome) {
    if (id <= 0) return;
    sqlite3_stmt *st = cg_prep(s->g,
        "UPDATE fleet_nodes SET state=?,exit=?,outcome=?,ended=? WHERE id=?");
    sqlite3_bind_text(st, 1, state, -1, SQLITE_TRANSIENT);
    if (exit > -900) sqlite3_bind_int(st, 2, exit); else sqlite3_bind_null(st, 2);
    if (outcome) sqlite3_bind_text(st, 3, outcome, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 3);
    sqlite3_bind_int64(st, 4, (long)time(NULL));
    sqlite3_bind_int64(st, 5, id);
    sqlite3_step(st);
    sqlite3_finalize(st);
}

/* Has the process ended? Our own children are reaped with waitpid; one an
 * earlier supervisor spawned is not ours to wait for, so its pid and start
 * time are checked instead — its exit status is then unknown (-999), which
 * is fine: the branch tip, not the exit code, decides. */
static bool sup_gone(pid_t pid, long start, bool adopted, int *crc) {
    if (!adopted) {
        int st;
        pid_t r = waitpid(pid, &st, WNOHANG);
        if (r == 0) return false;
        *crc = r < 0 ? -999 : WIFEXITED(st) ? WEXITSTATUS(st)
                                            : 128 + WTERMSIG(st);
        return true;
    }
    if (proc_alive(pid, start)) return false;
    *crc = -999;
    return true;
}

static void sup_kill(pid_t pid, long start, bool adopted) {
    if (kill(-pid, SIGTERM) != 0) kill(pid, SIGTERM);
    if (!adopted) { orch_reap(pid); return; }
    for (int i = 0; i < 30 && proc_alive(pid, start); i++) {
        struct timespec ts = { 0, 100 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }
    if (proc_alive(pid, start) && kill(-pid, SIGKILL) != 0) kill(pid, SIGKILL);
}

/* Terminate everything the run has alive, release the workers' claims, and
 * keep every branch: stopping is a pause of the work, not its deletion. */
static void sup_terminate(Sup *s) {
    if (s->mgr_live) {
        sup_kill(s->mgr.pid, s->mgr_start, s->mgr_adopted);
        s->mgr_live = false;
        sup_node_end(s, s->mgr_node, "killed", -999, "stopped");
    }
    for (int i = 0; i < s->nslots; i++) {
        OrchFleetSlot *sl = &s->slots[i];
        if (!sl->live) continue;
        sup_kill(sl->n.pid, sl->pid_start, sl->adopted);
        sl->live = false;
        driver_tap_poll(&sl->tap);
        orch_abandon(s->g->shared, s->feature, sl->n.task, sl->n.agent,
                     sl->n.attempt, sl->n.fence);
        sup_node_end(s, sl->node, "killed", -999, "stopped");
    }
}

static void sup_tap_adopt(DriverTap *t, const char *log, const char *agent,
                          const char *role, const char *subject) {
    driver_tap_init(t, log, agent, role, subject);
    /* what the agent wrote before the crash was read (or lost) then;
     * start at the end rather than replay it as new events */
    struct stat st;
    if (stat(log, &st) == 0) t->off = (long)st.st_size;
}

/* Reload a run a previous supervisor left: counters, what was tried, and
 * every node still marked live — adopted when its process is still the
 * one that was spawned, and otherwise handed to the next tick, which sees
 * it gone and judges it by its branch tip like any other exit. */
static int fleet_run_resume(Sup *s) {
    sqlite3_stmt *st = cg_prep(s->g,
        "SELECT wakes_left,failures,first_turn,last_wake,slots,max_fail "
        "FROM fleet_runs WHERE run=?");
    sqlite3_bind_text(st, 1, s->run, -1, SQLITE_TRANSIENT);
    int found = sqlite3_step(st) == SQLITE_ROW;
    if (found) {
        s->wakes = sqlite3_column_int(st, 0);
        s->failures = sqlite3_column_int(st, 1);
        s->first_turn = sqlite3_column_int(st, 2) != 0;
        s->last_wake = sqlite3_column_int64(st, 3);
        int ns = sqlite3_column_int(st, 4);
        if (ns > 0 && ns <= ORCH_MAX_SLOTS) s->nslots = ns;
        if (sqlite3_column_type(st, 5) != SQLITE_NULL)
            s->maxfail = sqlite3_column_int(st, 5);
    }
    sqlite3_finalize(st);
    if (!found) return -1;
    st = cg_prep(s->g, "SELECT task FROM fleet_nodes WHERE run=? "
                       "AND role='worker' AND task IS NOT NULL ORDER BY id");
    sqlite3_bind_text(st, 1, s->run, -1, SQLITE_TRANSIENT);
    while (sqlite3_step(st) == SQLITE_ROW && s->ntried < ORCH_MAX_TRIED)
        s->tried[s->ntried++] = xstrdup((const char *)sqlite3_column_text(st, 0));
    sqlite3_finalize(st);
    st = cg_prep(s->g,
        "SELECT id,role,agent,ifnull(parent,''),ifnull(feature,''),"
        "ifnull(task,''),ifnull(wave,-1),ifnull(branch,''),ifnull(base,''),"
        "ifnull(worktree,''),ifnull(pid,-1),ifnull(pid_start,-1),"
        "ifnull(attempt,''),ifnull(fence,0),ifnull(log,'') "
        "FROM fleet_nodes WHERE run=? AND state='live' ORDER BY id");
    sqlite3_bind_text(st, 1, s->run, -1, SQLITE_TRANSIENT);
    int slot = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        FleetNode n;
        memset(&n, 0, sizeof n);
        long id = sqlite3_column_int64(st, 0);
#define COL(i) ((const char *)sqlite3_column_text(st, i))
        snprintf(n.role, sizeof n.role, "%s", COL(1));
        snprintf(n.agent, sizeof n.agent, "%s", COL(2));
        snprintf(n.parent, sizeof n.parent, "%s", COL(3));
        snprintf(n.feature, sizeof n.feature, "%s", COL(4));
        snprintf(n.task, sizeof n.task, "%s", COL(5));
        n.wave = sqlite3_column_int64(st, 6);
        snprintf(n.branch, sizeof n.branch, "%s", COL(7));
        snprintf(n.base, sizeof n.base, "%s", COL(8));
        snprintf(n.worktree, sizeof n.worktree, "%s", COL(9));
        n.pid = sqlite3_column_int(st, 10);
        long start = sqlite3_column_int64(st, 11);
        snprintf(n.attempt, sizeof n.attempt, "%s", COL(12));
        n.fence = sqlite3_column_int64(st, 13);
        char log[4700];
        snprintf(log, sizeof log, "%s", COL(14));
#undef COL
        bool alive = proc_alive(n.pid, start);
        if (strcmp(n.role, "feature") == 0) {
            if (!alive) { sup_node_end(s, id, "exited", -999, "lost"); continue; }
            s->mgr = n;
            s->mgr_live = true;
            s->mgr_adopted = true;
            s->mgr_node = id;
            s->mgr_start = start;
            sup_tap_adopt(&s->mgr_tap, log, n.agent, "feature", s->feature);
            printf("[fleet] adopted manager %s (pid %d)\n", n.agent, n.pid);
            continue;
        }
        if (slot >= s->nslots) {
            /* more live workers than slots: the extra ones keep running
             * and are judged when they end, just not in a slot */
            sup_node_end(s, id, "exited", -999, "unslotted");
            continue;
        }
        OrchFleetSlot *sl = &s->slots[slot++];
        sl->n = n;
        sl->live = true;
        sl->adopted = true;
        sl->node = id;
        sl->pid_start = start;
        sl->last_heartbeat = 0;
        char subj[300];
        snprintf(subj, sizeof subj, "%s/%s", s->feature, n.task);
        sup_tap_adopt(&sl->tap, log, n.agent, "worker", subj);
        printf("[fleet] %s worker %s → %s (pid %d)\n",
               alive ? "adopted" : "found ended", n.agent, n.task, n.pid);
    }
    sqlite3_finalize(st);
    fflush(stdout);
    return 0;
}

/* ---------------- supervision: stalls, budgets, retries, escalation ---- */

static long wall_ms_now(void) {
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    return (long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void sup_slot_begin(Cg *g, OrchFleetSlot *sl) {
    long now = wall_ms_now();
    sl->started = sl->progress = now;
    sl->checked = 0;
    sl->seen_seq = events_head(g);
    sl->log_size = 0;
    sl->tree_fp[0] = 0;
    sl->nudges = 0;
    sl->why[0] = 0;
}

/* git's view of the worktree: status and HEAD, hashed */
static void sup_tree_fp(const char *wt, char out[65]) {
    StrBuf c; sb_init(&c);
    sb_puts(&c, "git -C ");
    sb_shquote(&c, wt);
    sb_puts(&c, " status --porcelain -uall 2>/dev/null; git -C ");
    sb_shquote(&c, wt);
    sb_puts(&c, " rev-parse HEAD 2>/dev/null");
    FILE *f = popen(c.p, "r");
    sb_free(&c);
    StrBuf o; sb_init(&o);
    if (f) {
        char buf[4096];
        size_t n;
        while ((n = fread(buf, 1, sizeof buf, f)) > 0)
            for (size_t i = 0; i < n; i++) sb_putc(&o, buf[i]);
        pclose(f);
    }
    sha256_hex(o.p, o.len, out);
    sb_free(&o);
}

/* Progress is work, not liveness: an event from the agent or about its
 * task (a tool call, a message, a hook, a claim, a status change), output
 * in its log, or a change git can see in its worktree. The supervisor's
 * own events and steering do not count. */
static bool sup_progressed(Sup *s, OrchFleetSlot *sl) {
    bool moved = false;
    char subj[300];
    snprintf(subj, sizeof subj, "%s/%s", s->feature, sl->n.task);
    sqlite3_stmt *st = cg_prep(s->g,
        "SELECT ifnull(MAX(seq),0) FROM events WHERE seq>? AND "
        "(node=? OR subject=?) AND kind NOT LIKE 'supervisor.%' AND "
        "kind NOT LIKE 'agent.steer%'");
    sqlite3_bind_int64(st, 1, sl->seen_seq);
    sqlite3_bind_text(st, 2, sl->n.agent, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 3, subj, -1, SQLITE_TRANSIENT);
    if (sqlite3_step(st) == SQLITE_ROW) {
        long m = sqlite3_column_int64(st, 0);
        if (m > sl->seen_seq) { sl->seen_seq = m; moved = true; }
    }
    sqlite3_finalize(st);
    struct stat lst;
    if (stat(sl->tap.log, &lst) == 0 && (long)lst.st_size != sl->log_size) {
        if (sl->log_size || lst.st_size) moved = true;
        sl->log_size = (long)lst.st_size;
    }
    char fp[65];
    sup_tree_fp(sl->n.worktree, fp);
    if (sl->tree_fp[0] && strcmp(fp, sl->tree_fp) != 0) moved = true;
    snprintf(sl->tree_fp, sizeof sl->tree_fp, "%s", fp);
    return moved;
}

static void sup_note(Sup *s, const char *kind, const OrchFleetSlot *sl,
                     const char *action, const char *reason, long value) {
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"agent\":"); sb_json_str(&p, sl->n.agent);
    sb_puts(&p, ",\"task\":"); sb_json_str(&p, sl->n.task);
    sb_puts(&p, ",\"action\":"); sb_json_str(&p, action);
    sb_puts(&p, ",\"reason\":"); sb_json_str(&p, reason);
    sb_printf(&p, ",\"value\":%ld}", value);
    char subj[300];
    snprintf(subj, sizeof subj, "%s/%s", s->feature, sl->n.task);
    events_emit(s->g, kind, subj, p.p);
    sb_free(&p);
}

typedef struct { Cg *cg; const char *task, *blocked, *note; } HandoffCall;
static int sup_handoff_call(void *v) {
    HandoffCall *h = v;
    return cmd_handoff(h->cg, h->task, NULL, "retry from this state",
                       h->blocked, h->note, false);
}

/* end an attempt the supervisor gave up on; the reap that follows judges
 * it by its branch tip like any other exit, and counts it */
static void sup_end_attempt(Sup *s, OrchFleetSlot *sl, const char *kind,
                            const char *why, long value) {
    snprintf(sl->why, sizeof sl->why, "%s", why);
    sup_note(s, kind, sl, "stop", why, value);
    char tag[300];
    snprintf(tag, sizeof tag, "%s/%s", s->feature, sl->n.task);
    HandoffCall h = { s->g, tag, why, "recorded by the supervisor" };
    char *out = NULL;
    cg_capture(&out, sup_handoff_call, &h);
    free(out);
    printf("[fleet] worker %s on %s: %s — stopping it\n", sl->n.agent,
           sl->n.task, why);
    fflush(stdout);
    if (kill(-sl->n.pid, SIGTERM) != 0) kill(sl->n.pid, SIGTERM);
}

/* true when the attempt was ended for spending its wall-clock or USD budget */
static bool supervisor_budget_check(Sup *s, OrchFleetSlot *sl, long now) {
    long wall = g_role[FLEET_WORKER].set ? g_role[FLEET_WORKER].wall : 7200;
    double spend = g_role[FLEET_WORKER].set ? g_role[FLEET_WORKER].spend : 0;
    char why[160];
    if (wall > 0 && now - sl->started > wall * 1000) {
        snprintf(why, sizeof why, "wall-clock budget of %lds spent", wall);
        sup_end_attempt(s, sl, "supervisor.budget", why, wall);
        return true;
    }
    if (spend > 0 && sl->tap.cost > spend) {
        snprintf(why, sizeof why, "spend budget of $%.2f exceeded ($%.2f)",
                 spend, sl->tap.cost);
        sup_end_attempt(s, sl, "supervisor.budget", why,
                        (long)(sl->tap.cost * 100));
        return true;
    }
    return false;
}

/* One window without progress earns a nudge and one more window; a second
 * ends the attempt with a handoff, and the retry takes it from there. */
static void supervisor_stall_check(Sup *s, OrchFleetSlot *sl, long now) {
    long stall = g_role[FLEET_WORKER].set ? g_role[FLEET_WORKER].stall : 900;
    long cadence = stall > 0 ? stall * 250 : 30000;     /* a quarter window */
    if (cadence < 250) cadence = 250;
    if (cadence > 30000) cadence = 30000;
    if (now - sl->checked >= cadence) {
        sl->checked = now;
        if (sup_progressed(s, sl)) sl->progress = now;
    }
    if (stall <= 0 || now - sl->progress < stall * 1000) return;
    long idle = (now - sl->progress) / 1000;
    if (sl->nudges == 0) {
        char msg[400];
        snprintf(msg, sizeof msg, "The supervisor has seen no progress on "
                 "%s for %lds. Continue if you are working; if you are "
                 "stuck, record why with `cg handoff --task %s --blocked "
                 "\"...\"` and exit.", sl->n.task, idle, sl->n.task);
        driver_steer(s->g, sl->n.agent, msg);
        sup_note(s, "supervisor.stall", sl, "nudge", "no progress", idle);
        printf("[fleet] worker %s on %s: no progress for %lds — nudged\n",
               sl->n.agent, sl->n.task, idle);
        fflush(stdout);
        sl->nudges = 1;
        sl->progress = now;                 /* one more window */
    } else {
        char why[160];
        snprintf(why, sizeof why, "stalled — no progress for %lds after a "
                 "nudge", idle);
        sup_end_attempt(s, sl, "supervisor.stall", why, idle);
    }
}

static void sup_supervise(Sup *s) {
    long now = wall_ms_now();
    for (int i = 0; i < s->nslots; i++) {
        OrchFleetSlot *sl = &s->slots[i];
        if (!sl->live || sl->why[0]) continue;
        if (!sl->started) sup_slot_begin(s->g, sl);   /* adopted */
        if (supervisor_budget_check(s, sl, now)) continue;
        supervisor_stall_check(s, sl, now);
    }
}

static int sup_esc_find(Sup *s, const char *task) {
    for (int i = 0; i < s->nesc; i++)
        if (strcmp(s->esc_task[i], task) == 0) return i;
    return -1;
}

static void supervisor_escalate(Sup *s, const char *task, int level,
                         const char *reason) {
    int k = sup_esc_find(s, task);
    if (k < 0) {
        if (s->nesc >= 32) return;
        k = s->nesc++;
        snprintf(s->esc_task[k], sizeof s->esc_task[k], "%s", task);
    }
    s->esc_level[k] = level;
    s->esc_wakes[k] = s->wakes;
    if (level == 1) s->mgr_needed = true;
    char to[128];
    if (level == 1)
        snprintf(to, sizeof to, "%s", s->mgr.agent[0] ? s->mgr.agent : "manager");
    else
        snprintf(to, sizeof to, "%s", "main");
    char subj[300];
    snprintf(subj, sizeof subj, "%s/%s", s->feature, task);
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"task\":"); sb_json_str(&p, task);
    sb_printf(&p, ",\"level\":%d,\"to\":", level);
    sb_json_str(&p, level == 1 ? "manager" : "main");
    sb_puts(&p, ",\"agent\":"); sb_json_str(&p, to);
    sb_puts(&p, ",\"reason\":"); sb_json_str(&p, reason);
    sb_putc(&p, '}');
    events_emit(s->g, level == 2 ? "supervisor.blocked" : "supervisor.escalate",
                subj, p.p);
    sb_free(&p);
    char msg[600];
    if (level == 1) {
        snprintf(msg, sizeof msg, "Task %s failed every attempt the budget "
                 "allows (%s). Decide: fix it on the feature branch yourself, "
                 "re-plan it, or record it as blocked with `cg handoff --task "
                 "%s --blocked \"...\"` so the run can finish the rest.",
                 task, reason, task);
        driver_steer(s->g, to, msg);
        printf("[fleet] %s out of retries — escalated to %s\n", task, to);
    } else {
        snprintf(msg, sizeof msg, "Task %s of %s is blocked: every attempt "
                 "failed and the feature manager did not rescue it (%s).",
                 task, s->feature, reason);
        const char *main_agent = "gideon";
        driver_steer(s->g, main_agent, msg);
        char body[700];
        snprintf(body, sizeof body, "blocked: %s — out of retries, escalated "
                 "to the feature manager and main (%s)", task, reason);
        memory_add(s->g, "outcome", subj, body, NULL, NULL, "auto");
        printf("[fleet] %s blocked — escalated to main\n", task);
    }
    fflush(stdout);
}

/* after a reap: a failed task is retried while its attempts last (the
 * refill hands it out again), and goes up a level once they are spent */
static void supervisor_retry(Sup *s, const char *task, const char *why) {
    if (orch_attempts(s->tried, s->ntried, task) < g_max_attempts) return;
    if (sup_esc_find(s, task) >= 0) return;
    supervisor_escalate(s, task, 1, why && why[0] ? why : "attempts exhausted");
}

/* a manager wake came and went and the task is still not qualified */
static void sup_escalations_check(Sup *s, const OrchTask *v, int n) {
    for (int k = 0; k < s->nesc; k++) {
        if (s->esc_level[k] != 1 || s->mgr_live) continue;
        if (s->wakes >= s->esc_wakes[k]) continue;     /* no wake since */
        if (orch_finished_id(v, n, s->esc_task[k])) continue;
        supervisor_escalate(s, s->esc_task[k], 2, "the manager did not rescue it");
    }
    s->n_unfinished = s->n_blocked = 0;
    for (int i = 0; i < n; i++) {
        if (v[i].finished) continue;
        s->n_unfinished++;
        int k = sup_esc_find(s, v[i].id);
        if (k >= 0 && s->esc_level[k] == 2) s->n_blocked++;
    }
}

/* What the last attempts at a task left behind, for the next one's prompt:
 * why the supervisor stopped it, what the agent said last, and the
 * recorded outcomes (verify failures and their triage among them). */
static void orch_prompt_retry(const char *path, const char *feature,
                              const char *id, int attempt) {
    Cg g;
    if (!memory_open_quiet(&g)) return;
    char subj[300];
    snprintf(subj, sizeof subj, "%s/%s", feature, id);
    StrBuf b; sb_init(&b);
    sb_printf(&b, "\n\n## Previous attempts\n\nThis is attempt %d at %s. "
              "Do not repeat what failed:\n", attempt + 1, id);
    sqlite3_stmt *st = cg_prep(&g,
        "SELECT kind,payload FROM events WHERE subject=? AND (kind IN "
        "('agent.result','supervisor.stall','supervisor.budget') OR "
        "(kind='agent.text')) ORDER BY seq DESC LIMIT 12");
    sqlite3_bind_text(st, 1, subj, -1, SQLITE_TRANSIENT);
    int texts = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *k = (const char *)sqlite3_column_text(st, 0);
        const char *p = (const char *)sqlite3_column_text(st, 1);
        if (!strncmp(k, "supervisor.", 11)) {
            char *r = json_get_string(p, "reason");
            char *a = json_get_string(p, "action");
            if (a && !strcmp(a, "stop")) sb_printf(&b, "- stopped by the supervisor: %s\n", r ? r : "?");
            free(r); free(a);
        } else if (!strcmp(k, "agent.result")) {
            char *t = json_get_string(p, "text");
            char *sub = json_get_string(p, "subtype");
            sb_printf(&b, "- the agent finished with %s%s%s\n", sub ? sub : "?",
                      t && t[0] ? ": " : "", t ? t : "");
            free(t); free(sub);
        } else if (texts < 2) {
            char *t = json_get_string(p, "text");
            if (t && t[0]) { sb_printf(&b, "- it said: %s\n", t); texts++; }
            free(t);
        }
    }
    sqlite3_finalize(st);
    Memory *mem = NULL;
    int nm = memory_query(&g, NULL, subj, "outcome", 3, &mem);
    for (int i = 0; i < nm; i++) sb_printf(&b, "- outcome: %s\n", mem[i].body);
    memory_free(mem, nm);
    cg_close(&g);
    char *body = read_entire_file(path, NULL);
    StrBuf o; sb_init(&o);
    sb_puts(&o, body ? body : "");
    sb_puts(&o, b.p);
    write_entire_file(path, o.p, o.len);
    sb_free(&o);
    sb_free(&b);
    free(body);
}

/* 1: an approval for this feature is pending (the manager has nothing to
 * do but wait); 2: one was rejected (the run stops); 0: neither */
static int sup_approval(Sup *s, long *id) {
    sqlite3_stmt *st = cg_prep(s->g,
        "SELECT id,state FROM fleet_approvals WHERE (subject=?1 OR subject "
        "LIKE ?1||'/%') AND state IN ('pending','rejected') ORDER BY id DESC "
        "LIMIT 1");
    sqlite3_bind_text(st, 1, s->feature, -1, SQLITE_TRANSIENT);
    int r = 0;
    if (sqlite3_step(st) == SQLITE_ROW) {
        *id = sqlite3_column_int64(st, 0);
        r = strcmp((const char *)sqlite3_column_text(st, 1), "pending") == 0 ? 1 : 2;
    }
    sqlite3_finalize(st);
    return r;
}

static int supervisor_tick(Sup *s) {
    Cg *g = s->g;
    const OrchCfg *cfg = s->cfg;
    const char *feature = s->feature;

    sup_control(s);
    if (g_orch_int || strcmp(s->state, "stopping") == 0) {
        bool sig = g_orch_int != 0;
        sup_terminate(s);
        fprintf(stderr, "cg spec run: %s — the fleet was terminated, worker "
                "claims released, branches kept\n",
                sig ? "interrupted" : "stopped (cg fleet down)");
        if (sig) s->rc = 130;
        sup_set_state(s, "stopped", sig ? "signal" : "down");
        return SUP_DONE;
    }
    if (strcmp(s->state, "draining") == 0 && !s->stopping) {
        printf("[fleet] draining — no new agents; waiting for the live ones\n");
        fflush(stdout);
        s->stopping = true;
    }
    s->paused = strcmp(s->state, "paused") == 0;

    for (int i = 0; i < s->nslots; i++)
        if (s->slots[i].live) driver_tap_poll(&s->slots[i].tap);
    if (s->mgr_live) driver_tap_poll(&s->mgr_tap);
    if (!s->paused) sup_supervise(s);

    /* reap workers: the branch tip, not the exit code, decides */
    for (int i = 0; i < s->nslots; i++) {
        OrchFleetSlot *sl = &s->slots[i];
        if (!sl->live) continue;
        int crc;
        if (!sup_gone(sl->n.pid, sl->pid_start, sl->adopted, &crc)) continue;
        sl->live = false;
        driver_tap_poll(&sl->tap);
        driver_tap_free(&sl->tap);
        char *ts = orch_task_status(sl->n.worktree, feature, sl->n.task,
                                    sl->n.attempt, sl->n.fence);
        bool ok = ts && (strcmp(ts, "done") == 0 ||
                         strcmp(ts, "implemented") == 0);
        char ex[16];
        if (crc > -900) snprintf(ex, sizeof ex, "%d", crc);
        else snprintf(ex, sizeof ex, "?");
        printf("[fleet] worker %s task %s exit %s → %s\n", sl->n.agent,
               sl->n.task, ex, ok ? ts : "INCOMPLETE");
        fflush(stdout);
        const char *outcome = ok ? ts : sl->why[0] ? sl->why : "incomplete";
        orch_event("orch.exit", "worker", sl->n.agent, feature, sl->n.task,
                   sl->n.pid, crc > -900 ? crc : -1, outcome, sl->n.branch, NULL);
        sup_node_end(s, sl->node, "exited", crc, outcome);
        if (!ok) {
            orch_abandon(g->shared, feature, sl->n.task, sl->n.agent,
                         sl->n.attempt, sl->n.fence);
            orch_note_failure(feature, sl->n.task, crc > -900 ? crc : -1);
            s->failures++;
            sup_save(s);
            supervisor_retry(s, sl->n.task, sl->why);
        }
        sl->why[0] = 0;
        free(ts);
    }

    /* a live worker keeps its fenced attempt alive */
    long every = cfg->ttl > 0 ? cfg->ttl / 3 : 20;
    if (every < 1) every = 1;
    long now = (long)time(NULL);
    for (int i = 0; i < s->nslots; i++) {
        OrchFleetSlot *sl = &s->slots[i];
        if (!sl->live || now - sl->last_heartbeat < every) continue;
        if (orch_node_heartbeat(&sl->n, s->ttl_min) == 0) {
            sl->last_heartbeat = now;
            continue;
        }
        char *ts = orch_task_status(sl->n.worktree, feature, sl->n.task,
                                    sl->n.attempt, sl->n.fence);
        bool done = ts && (strcmp(ts, "done") == 0 ||
                           strcmp(ts, "implemented") == 0);
        free(ts);
        if (done) { sl->last_heartbeat = now; continue; }
        fprintf(stderr, "cg spec run: worker %s lost fenced ownership of %s "
                "— terminating it\n", sl->n.agent, sl->n.task);
        sup_kill(sl->n.pid, sl->pid_start, sl->adopted);
        sl->live = false;
        driver_tap_free(&sl->tap);
        orch_event("orch.exit", "worker", sl->n.agent, feature, sl->n.task,
                   sl->n.pid, -1, "lost_ownership", sl->n.branch, NULL);
        sup_node_end(s, sl->node, "killed", -999, "lost_ownership");
        orch_note_failure(feature, sl->n.task, -2);
        s->failures++;
        sup_save(s);
        supervisor_retry(s, sl->n.task, "lost its fenced claim");
    }

    if (s->mgr_live) {
        int crc;
        if (sup_gone(s->mgr.pid, s->mgr_start, s->mgr_adopted, &crc)) {
            s->mgr_live = false;
            driver_tap_poll(&s->mgr_tap);
            char ex[16];
            if (crc > -900) snprintf(ex, sizeof ex, "%d", crc);
            else snprintf(ex, sizeof ex, "?");
            printf("[fleet] manager %s exit %s\n", s->mgr.agent, ex);
            fflush(stdout);
            orch_event("orch.exit", "feature", s->mgr.agent, feature, NULL,
                       s->mgr.pid, crc > -900 ? crc : -1, NULL, s->mgr.branch,
                       NULL);
            sup_node_end(s, s->mgr_node, "exited", crc, NULL);
        }
    }

    /* A manager is done when its subtree is: every task qualified and
     * the feature branch merged. The process exiting proves nothing. */
    OrchSubtree sub;
    orch_subtree(g, feature, s->fbranch, s->fwt, s->mainbr, &sub);
    int live = orch_live_fleet(s->slots, s->nslots);
    if (sub.complete && !s->mgr_live && live == 0) {
        printf("[fleet] %s complete — %d/%d task(s) qualified, %s merged "
               "into %s, %d failure(s)\n", feature, sub.done, sub.total,
               s->fbranch, s->mainbr, s->failures);
        orch_event("orch.complete", "feature", NULL, feature, NULL, 0, -999,
                   "merged", s->fbranch, NULL);
        sup_set_state(s, "complete", "merged");
        return SUP_DONE;
    }
    if (!s->stopping && s->failures > s->maxfail) {
        fprintf(stderr, "cg spec run: %d failure(s) exceed --max-fail %d — "
                "waiting for the fleet, then stopping\n", s->failures,
                s->maxfail);
        orch_event("orch.stop", "feature", NULL, feature, NULL, 0, -999,
                   "max_fail", s->fbranch, NULL);
        s->stopping = true;
        s->rc = 1;
    }

    /* The manager takes the first turn — it owns the feature branch, and
     * its worktree is where every wave is handed up — and each turn after
     * that once no worker is live and the frontier has nothing left to
     * give: it is then the only one who can move the subtree. Every turn is
     * spent from a fixed budget, so a fleet that cannot finish stops
     * instead of spinning. Paused, nothing new starts. */
    now = (long)time(NULL);
    long appr = 0;
    int ap = !s->mgr_live && live == 0 ? sup_approval(s, &appr) : 0;
    if (ap == 2) {
        fprintf(stderr, "cg spec run: approval #%ld for %s was rejected — "
                "stopping the run (branches kept)\n", appr, feature);
        s->rc = 1;
        sup_set_state(s, "stopped", "rejected");
        return SUP_DONE;
    }
    if (ap == 1 && s->waiting_on != appr) {
        printf("[fleet] waiting for approval #%ld — cg fleet approve %ld\n",
               appr, appr);
        fflush(stdout);
        s->waiting_on = appr;
    }
    /* nothing left that anyone can move: every unfinished task is blocked
     * after its manager and main were told — end, and say which */
    if (!s->mgr_live && live == 0 && !sub.complete && s->frontier_empty &&
        s->n_unfinished > 0 && s->n_unfinished == s->n_blocked) {
        StrBuf r; sb_init(&r);
        sb_puts(&r, "blocked:");
        for (int k = 0; k < s->nesc; k++)
            if (s->esc_level[k] == 2) sb_printf(&r, " %s", s->esc_task[k]);
        printf("[fleet] %s cannot finish — %s\n", feature, r.p);
        fflush(stdout);
        s->rc = 1;
        sup_set_state(s, "blocked", r.p);
        sb_free(&r);
        return SUP_DONE;
    }
    /* a merge-up that hit conflicts is the manager's to resolve */
    {
        char like[300];
        snprintf(like, sizeof like, "%s/%%", feature);
        sqlite3_stmt *cq = cg_prep(g, "SELECT seq,payload FROM events WHERE "
                                      "kind='fleet.merge' AND seq>? AND subject LIKE ?");
        sqlite3_bind_int64(cq, 1, s->conflict_seq);
        sqlite3_bind_text(cq, 2, like, -1, SQLITE_TRANSIENT);
        while (sqlite3_step(cq) == SQLITE_ROW) {
            s->conflict_seq = sqlite3_column_int64(cq, 0);
            char *oc = json_get_string((const char *)sqlite3_column_text(cq, 1), "outcome");
            if (oc && !strcmp(oc, "conflict")) s->mgr_needed = true;
            free(oc);
        }
        sqlite3_finalize(cq);
    }
    if (!s->stopping && !s->paused && !s->mgr_live && !sub.complete &&
        ap == 0 && (s->first_turn || (s->frontier_empty && live == 0) ||
                    s->mgr_needed) &&
        now - s->last_wake >= ORCH_WAKE_BACKOFF) {
        if (s->wakes <= 0) {
            fprintf(stderr, "cg spec run: %s did not complete and no manager "
                    "wake is left (--max-rounds) — %d/%d task(s) qualified, "
                    "%ld commit(s) still on %s\n", feature, sub.done,
                    sub.total, sub.ahead < 0 ? 0 : sub.ahead, s->fbranch);
            orch_event("orch.stop", "feature", NULL, feature, NULL, 0, -999,
                       "no_wakes_left", s->fbranch, NULL);
            s->rc = 1;
            sup_set_state(s, "failed", "no_wakes_left");
            return SUP_DONE;
        }
        FleetNode mn;
        if (orch_spawn_manager(g, feature, cfg->driver, s->extra, cfg->cmd,
                               false, &mn) != 0) {
            s->rc = 1;
            sup_set_state(s, "failed", "manager_spawn");
            return SUP_DONE;
        }
        s->mgr = mn;
        s->mgr_live = true;
        s->mgr_adopted = false;
        s->mgr_start = proc_start_time(mn.pid);
        s->last_wake = now;
        s->first_turn = false;
        s->mgr_needed = false;
        s->wakes--;
        printf("[fleet] manager %s on %s (%d wake(s) left), log "
               ".codegraph/agents/%s-manager.log\n", s->mgr.agent,
               s->mgr.branch, s->wakes, feature);
        fflush(stdout);
        orch_event("orch.spawn", "feature", s->mgr.agent, feature, NULL,
                   s->mgr.pid, -999, NULL, s->mgr.branch, NULL);
        char lp[4700];
        snprintf(lp, sizeof lp, "%s/.codegraph/agents/%s-manager.log",
                 g->shared, feature);
        driver_tap_free(&s->mgr_tap);
        driver_tap_init(&s->mgr_tap, lp, s->mgr.agent, "feature", feature);
        s->mgr_node = sup_node_add(s, &s->mgr, lp, s->mgr_start);
        sup_save(s);
    }

    /* Refill worker slots from the frontier — never while the manager runs,
     * for the same reason: a worker handing its wave up merges into the
     * manager's worktree, so the two levels take turns rather than race
     * for it. */
    if (!s->stopping && !s->paused) {
        OrchTask *v = NULL;
        int n = orch_tasks_load(g, feature, s->fwt, &v);
        for (int i = 0; i < s->nslots && s->ntried < ORCH_MAX_TRIED; i++) {
            OrchFleetSlot *sl = &s->slots[i];
            if (sl->live) continue;
            char id[64];
            if (!orch_next_task(v, n, s->tried, s->ntried, s->slots,
                                s->nslots, id, sizeof id))
                break;
            g_retry_attempt = orch_attempts(s->tried, s->ntried, id);
            s->tried[s->ntried++] = xstrdup(id);
            FleetNode wn;
            int wrc = orch_spawn_worker(g, feature, id, cfg->driver, s->extra,
                                        cfg->cmd, false, &wn);
            g_retry_attempt = 0;
            if (wrc != 0) {
                orch_note_failure(feature, id, -1);
                s->failures++;
                sup_save(s);
                continue;
            }
            sl->n = wn;
            sl->live = true;
            sl->adopted = false;
            sl->pid_start = proc_start_time(wn.pid);
            sl->last_heartbeat = (long)time(NULL);
            sup_slot_begin(g, sl);
            printf("[fleet] worker %s → %s (wave %ld) on %s, log "
                   ".codegraph/agents/%s-%s.log\n", wn.agent, id, wn.wave,
                   wn.branch, feature, id);
            fflush(stdout);
            orch_event("orch.spawn", "worker", wn.agent, feature, id, wn.pid,
                       -999, NULL, wn.branch, NULL);
            char lp[4700], subj[300];
            snprintf(lp, sizeof lp, "%s/.codegraph/agents/%s-%s.log",
                     g->shared, feature, id);
            snprintf(subj, sizeof subj, "%s/%s", feature, id);
            driver_tap_init(&sl->tap, lp, wn.agent, "worker", subj);
            sl->node = sup_node_add(s, &wn, lp, sl->pid_start);
        }
        char probe[64];
        s->frontier_empty = !orch_next_task(v, n, s->tried, s->ntried,
                                            s->slots, s->nslots, probe,
                                            sizeof probe);
        sup_escalations_check(s, v, n);
        orch_tasks_free(v, n);
    }

    if (s->stopping && !s->mgr_live && orch_live_fleet(s->slots, s->nslots) == 0) {
        sup_set_state(s, "stopped", s->rc ? "max_fail" : "drained");
        return SUP_DONE;
    }
    return SUP_GO;
}

static void run_id_new(const char *feature, char *out, size_t cap) {
    char seed[400], hash[65];
    struct timespec ts;
    clock_gettime(CLOCK_REALTIME, &ts);
    snprintf(seed, sizeof seed, "%s|%ld|%ld|%d", feature, (long)ts.tv_sec,
             ts.tv_nsec, (int)getpid());
    sha256_hex(seed, strlen(seed), hash);
    snprintf(out, cap, "%.12s", hash);
}

/* the newest run no supervisor finished: what --resume continues */
static bool run_latest_open(Cg *g, char *out, size_t cap, char *feature,
                            size_t fcap) {
    sqlite3_stmt *st = cg_prep(g,
        "SELECT run,feature FROM fleet_runs WHERE state IN "
        "('running','paused','draining','stopping') ORDER BY started DESC, "
        "rowid DESC LIMIT 1");
    bool ok = sqlite3_step(st) == SQLITE_ROW;
    if (ok) {
        snprintf(out, cap, "%s", (const char *)sqlite3_column_text(st, 0));
        if (feature) snprintf(feature, fcap, "%s",
                              (const char *)sqlite3_column_text(st, 1));
    }
    sqlite3_finalize(st);
    return ok;
}

/* Record a new run: everything a later supervisor needs to continue it */
static int fleet_run_open(Sup *s, const char *host) {
    Cg *g = s->g;
    const char *log = getenv("CG_SUPERVISOR_LOG");
    sqlite3_stmt *st = cg_prep(g,
        "INSERT INTO fleet_runs(run,feature,state,pid,pid_start,host,"
        "driver,slots,max_fail,wakes_left,failures,first_turn,last_wake,"
        "log,started,updated) VALUES(?,?,'running',?,?,?,?,?,?,?,0,1,0,?,"
        "?,?)");
    sqlite3_bind_text(st, 1, s->run, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 2, s->feature, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(st, 3, (int)getpid());
    sqlite3_bind_int64(st, 4, proc_start_time(getpid()));
    sqlite3_bind_text(st, 5, host, -1, SQLITE_TRANSIENT);
    sqlite3_bind_text(st, 6, s->cfg->driver, -1, SQLITE_TRANSIENT);
    sqlite3_bind_int(st, 7, s->nslots);
    sqlite3_bind_int(st, 8, s->maxfail);
    sqlite3_bind_int(st, 9, s->wakes);
    if (log) sqlite3_bind_text(st, 10, log, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 10);
    sqlite3_bind_int64(st, 11, (long)time(NULL));
    sqlite3_bind_int64(st, 12, (long)time(NULL));
    int rc = sqlite3_step(st) == SQLITE_DONE ? 0 : -1;
    sqlite3_finalize(st);
    return rc;
}

/* the branch, worktree, and main a feature's run works with */
static void sup_feature_paths(Cg *g, const char *feature, char *fbranch,
                              size_t fbcap, char *fwt, size_t fwcap,
                              char *mainbr, size_t mbcap) {
    Hierarchy h;
    Kvx *wf = orch_hier(g->shared, &h);
    snprintf(mainbr, mbcap, "%s", h.main_branch);
    hier_expand(&h, h.roles[FLEET_FEATURE].branch, feature, -1, fbranch, fbcap);
    orch_worktree_path(&h, g->shared, fbranch, fwt, fwcap);
    hier_free(&h);
    kvx_free(wf);
}

/* every leaf task of the feature done on the main tree */
static bool feature_done(Cg *g, const char *feature) {
    char path[4700];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", g->shared, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return false;
    char **ids = NULL;
    int n = kvx_subsections(k, "task", &ids), leaves = 0, done = 0;
    for (int i = 0; i < n; i++) {
        char sec[300];
        snprintf(sec, sizeof sec, "task.%s", ids[i]);
        if (kvx_long(k, sec, "wave", -1) >= 0) {
            leaves++;
            char *st = kvx_str(k, sec, "status");
            if (st && !strcmp(st, "done")) done++;
            free(st);
        }
        free(ids[i]);
    }
    free(ids);
    kvx_free(k);
    return leaves > 0 && done == leaves;
}

/* [meta] requires of a feature, all done? names the first that is not */
static bool feature_ready(Cg *g, const char *feature, char *waiting, size_t cap) {
    char path[4700];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", g->shared, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return false;
    char **req = NULL;
    int n = kvx_list(k, "meta", "requires", &req);
    bool ok = true;
    for (int i = 0; i < n; i++) {
        if (ok && !feature_done(g, req[i])) {
            ok = false;
            if (waiting) snprintf(waiting, cap, "%s", req[i]);
        }
        free(req[i]);
    }
    free(req);
    kvx_free(k);
    return ok;
}

/* features with work left, for --all: every spec/<feature>/spec.kvx with
 * a leaf task not done, in name order */
static int features_open(Cg *g, char ***out) {
    *out = NULL;
    char dir[4600];
    snprintf(dir, sizeof dir, "%s/spec", g->shared);
    DIR *d = opendir(dir);
    if (!d) return 0;
    char **v = NULL;
    int n = 0, cap = 0;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (e->d_name[0] == '.') continue;
        char kv[4900];
        snprintf(kv, sizeof kv, "%s/%s/spec.kvx", dir, e->d_name);
        struct stat st;
        if (stat(kv, &st) != 0 || feature_done(g, e->d_name)) continue;
        Kvx *k = kvx_parse(kv);
        char **ids = NULL;
        int nt = k ? kvx_subsections(k, "task", &ids) : 0;
        for (int i = 0; i < nt; i++) free(ids[i]);
        free(ids);
        kvx_free(k);
        if (!nt) continue;
        if (n == cap) { cap = cap ? cap * 2 : 8; v = xrealloc(v, sizeof(char *) * (size_t)cap); }
        v[n++] = xstrdup(e->d_name);
    }
    closedir(d);
    kvx_sort_dotted(v, n);
    *out = v;
    return n;
}

static int sup_open(Cg *g, Sup *s, const char *feature, const OrchCfg *cfg,
                    const char *extra, int nslots, int maxfail, int maxrounds,
                    const char *run_id, const char *resume) {
    memset(s, 0, sizeof *s);
    s->g = g;
    s->cfg = cfg;
    s->extra = extra;
    s->nslots = nslots;
    s->maxfail = maxfail;
    s->wakes = maxrounds > 0 ? maxrounds : ORCH_ROUNDS_DFLT;
    s->first_turn = true;
    s->ttl_min = cfg->ttl > 0 ? (cfg->ttl + 59) / 60 : 60;
    s->mgr.pid = -1;
    snprintf(s->feature, sizeof s->feature, "%s", feature);
    sup_feature_paths(g, feature, s->fbranch, sizeof s->fbranch, s->fwt,
                      sizeof s->fwt, s->mainbr, sizeof s->mainbr);
    if (g_role[FLEET_WORKER].set && g_role[FLEET_WORKER].max > 0 &&
        s->nslots > g_role[FLEET_WORKER].max)
        s->nslots = (int)g_role[FLEET_WORKER].max;
    s->slots = xmalloc(sizeof(OrchFleetSlot) * ORCH_MAX_SLOTS);
    memset(s->slots, 0, sizeof(OrchFleetSlot) * ORCH_MAX_SLOTS);
    s->conflict_seq = events_head(g);
    char host[256] = "";
    gethostname(host, sizeof host - 1);
    if (resume) {
        snprintf(s->run, sizeof s->run, "%s", resume);
        if (fleet_run_resume(s) != 0) {
            fprintf(stderr, "cg fleet: no run %s to resume\n", s->run);
            return 1;
        }
        sqlite3_stmt *st = cg_prep(g,
            "UPDATE fleet_runs SET pid=?,pid_start=?,host=?,state="
            "CASE WHEN state='stopping' THEN 'stopping' WHEN state='paused' "
            "THEN 'paused' WHEN state='draining' THEN 'draining' ELSE "
            "'running' END,updated=? WHERE run=?");
        sqlite3_bind_int(st, 1, (int)getpid());
        sqlite3_bind_int64(st, 2, proc_start_time(getpid()));
        sqlite3_bind_text(st, 3, host, -1, SQLITE_TRANSIENT);
        sqlite3_bind_int64(st, 4, (long)time(NULL));
        sqlite3_bind_text(st, 5, s->run, -1, SQLITE_TRANSIENT);
        sqlite3_step(st);
        sqlite3_finalize(st);
    } else {
        if (run_id && run_id[0]) snprintf(s->run, sizeof s->run, "%s", run_id);
        else run_id_new(feature, s->run, sizeof s->run);
        if (fleet_run_open(s, host) != 0) {
            fprintf(stderr, "cg fleet: could not record run %s\n", s->run);
            return 1;
        }
    }
    sup_control(s);
    sup_event(s, s->state[0] ? s->state : "running", resume ? "resumed" : "started");
    printf("[fleet] %s — manager + %d worker slot(s), driver %s, %d wake(s)\n",
           feature, s->nslots, cfg->driver, s->wakes);
    printf("[fleet] run %s%s — supervisor pid %d\n", s->run,
           resume ? " (resumed)" : "", (int)getpid());
    fflush(stdout);
    return 0;
}

static void sup_close(Sup *s) {
    for (int i = 0; i < s->ntried; i++) free(s->tried[i]);
    for (int i = 0; i < ORCH_MAX_SLOTS && s->slots; i++)
        driver_tap_free(&s->slots[i].tap);
    driver_tap_free(&s->mgr_tap);
    free(s->slots);
    s->slots = NULL;
}

/* ---------------- the main agent ---------------- */

/* Main Gideon as a process, when [hierarchy] main_agent asks for one: it
 * owns decisions, not code — it is woken when the run starts, when a task
 * is blocked, and when a feature finishes, and answers with steering,
 * approvals, memories, and checkpoints. */
typedef struct {
    bool enabled, live, adopted;
    FleetNode n;
    long start;
    DriverTap tap;
    int wakes;
    char reason[300];
    long blocked_seq;
} MainAgent;

static int orch_main_prompt(Cg *g, const FleetNode *n, Sup *sups, int nsup,
                            const char *reason, const char *path) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "# %s — main\n\nYou are %s, the main agent. You own the "
              "plan and the decisions; feature managers own their features "
              "and wave workers write the code. Do not edit code yourself.\n\n",
              n->agent, n->agent);
    sb_printf(&b, "You were woken because: %s\n\n## Features\n", reason);
    for (int i = 0; i < nsup; i++) {
        OrchSubtree sub;
        orch_subtree(g, sups[i].feature, sups[i].fbranch, sups[i].fwt,
                     sups[i].mainbr, &sub);
        sb_printf(&b, "- %s: %d of %d task(s) done, %s%s — run %s (%s), "
                  "%d failure(s)\n", sups[i].feature, sub.done, sub.total,
                  sub.merged ? "merged into " : "not yet merged into ",
                  sups[i].mainbr, sups[i].run, sups[i].state[0] ?
                  sups[i].state : "running", sups[i].failures);
        for (int k = 0; k < sups[i].nesc; k++)
            if (sups[i].esc_level[k] == 2)
                sb_printf(&b, "  - blocked: %s\n", sups[i].esc_task[k]);
    }
    sqlite3_stmt *st = cg_prep(g, "SELECT id,gate,subject FROM fleet_approvals "
                                  "WHERE state='pending' ORDER BY id");
    int na = 0;
    while (sqlite3_step(st) == SQLITE_ROW) {
        if (!na++) sb_puts(&b, "\n## Waiting for a person\n");
        sb_printf(&b, "- approval #%lld: %s of %s\n",
                  (long long)sqlite3_column_int64(st, 0),
                  (const char *)sqlite3_column_text(st, 1),
                  (const char *)sqlite3_column_text(st, 2));
    }
    sqlite3_finalize(st);
    sb_puts(&b, "\n## What you can do\n"
            "  cg fleet runs / cg fleet tree -f <feature> / cg fleet brief <feature>\n"
            "  cg fleet steer <agent> \"<message>\"   # tell a manager what to do\n"
            "  cg remember \"<decision>\" --type decision\n"
            "  cg fleet checkpoint                   # merge landed pull requests, when the policy allows\n"
            "Decide, record why, and exit; you are woken again when something needs you.\n");
    int rc = write_entire_file(path, b.p, b.len);
    sb_free(&b);
    return rc;
}

static int orch_spawn_main(Cg *g, const char *driver, const char *extra,
                    const char *cmd, Sup *sups, int nsup, const char *reason,
                    FleetNode *n) {
    Hierarchy h;
    Kvx *wf = orch_hier(g->shared, &h);
    memset(n, 0, sizeof *n);
    snprintf(n->role, sizeof n->role, "main");
    hier_expand(&h, h.roles[FLEET_MAIN].agent, NULL, -1, n->agent, sizeof n->agent);
    snprintf(n->branch, sizeof n->branch, "%s", h.main_branch);
    snprintf(n->worktree, sizeof n->worktree, "%s", g->shared);
    n->wave = -1;
    n->pid = -1;
    hier_free(&h);
    kvx_free(wf);
    char dir[4600], prompt[4700], logpath[4700];
    snprintf(dir, sizeof dir, "%s/.codegraph/agents", g->shared);
    mkdirs(dir);
    snprintf(prompt, sizeof prompt, "%s/main.prompt", dir);
    snprintf(logpath, sizeof logpath, "%s/main.log", dir);
    if (orch_main_prompt(g, n, sups, nsup, reason, prompt) != 0) return 1;
    orch_prompt_steer(prompt, n->agent);
    char *av[ORCH_MAX_ARGV];
    int ac = orch_argv(driver, extra, cmd, FLEET_MAIN, g->shared, prompt,
                       "main", n->agent, av, ORCH_MAX_ARGV);
    if (ac < 0) return 1;
    pid_t pid = orch_fleet_exec(av, n, prompt, logpath);
    orch_argv_free(av);
    if (pid < 0) return 1;
    n->pid = pid;
    return 0;
}

static void main_wake(MainAgent *m, const char *reason) {
    if (!m->enabled) return;
    if (m->reason[0] && strlen(m->reason) + strlen(reason) + 4 < sizeof m->reason) {
        strcat(m->reason, "; ");
        strcat(m->reason, reason);
    } else if (!m->reason[0]) {
        snprintf(m->reason, sizeof m->reason, "%s", reason);
    }
}

static void main_tick(Cg *g, MainAgent *m, Sup *sups, int nsup,
                      const OrchCfg *cfg, const char *extra) {
    if (!m->enabled) return;
    /* blocked tasks anywhere in the run want main */
    sqlite3_stmt *st = cg_prep(g, "SELECT seq,subject FROM events WHERE "
                                  "kind='supervisor.blocked' AND seq>?");
    sqlite3_bind_int64(st, 1, m->blocked_seq);
    while (sqlite3_step(st) == SQLITE_ROW) {
        m->blocked_seq = sqlite3_column_int64(st, 0);
        char r[200];
        snprintf(r, sizeof r, "%s is blocked",
                 (const char *)sqlite3_column_text(st, 1));
        main_wake(m, r);
    }
    sqlite3_finalize(st);
    if (m->live) {
        driver_tap_poll(&m->tap);
        int crc;
        if (sup_gone(m->n.pid, m->start, m->adopted, &crc)) {
            m->live = false;
            driver_tap_poll(&m->tap);
            printf("[fleet] main %s exit %d\n", m->n.agent, crc > -900 ? crc : -1);
            fflush(stdout);
            orch_event("orch.exit", "main", m->n.agent, NULL, NULL, m->n.pid,
                       crc > -900 ? crc : -1, NULL, m->n.branch, NULL);
        }
        return;
    }
    if (!m->reason[0] || m->wakes <= 0) return;
    FleetNode n;
    if (orch_spawn_main(g, cfg->driver, extra, cfg->cmd, sups, nsup, m->reason,
                        &n) != 0) {
        fprintf(stderr, "cg spec run: could not start the main agent\n");
        m->reason[0] = 0;
        return;
    }
    m->n = n;
    m->live = true;
    m->start = proc_start_time(n.pid);
    m->wakes--;
    printf("[fleet] main %s woken (%s), log .codegraph/agents/main.log\n",
           n.agent, m->reason);
    fflush(stdout);
    orch_event("orch.spawn", "main", n.agent, NULL, NULL, n.pid, -999,
               m->reason, n.branch, NULL);
    char lp[4700];
    snprintf(lp, sizeof lp, "%s/.codegraph/agents/main.log", g->shared);
    driver_tap_free(&m->tap);
    driver_tap_init(&m->tap, lp, n.agent, "main", NULL);
    m->reason[0] = 0;
}

/* One supervisor, one or more features. Each feature is its own run with
 * its own manager and workers; a feature whose [meta] requires are not all
 * done waits, and starts once they are — up to [role.feature] max alive at
 * once. The main agent, when enabled, sees them all. */
static int supervisor_run(Cg *g, char **features, int nfeat,
                          const OrchCfg *cfg, const char *extra, int nslots,
                          int maxfail, int maxrounds, const FleetRunOpts *ro) {
    int lock = sup_lock_take(g->shared);
    if (lock < 0) {
        fprintf(stderr, "cg fleet: a supervisor is already running for this "
                "project — see `cg fleet runs`, or stop it with `cg fleet "
                "down`\n");
        return 1;
    }
    g_max_attempts = 1 + (int)(g_role[FLEET_WORKER].set
                               ? g_role[FLEET_WORKER].retries : 2);
    if (g_max_attempts < 1) g_max_attempts = 1;
    g_coll_cg = g;
    g_ncoll = 0;
    int fmax = g_role[FLEET_FEATURE].set && g_role[FLEET_FEATURE].max > 0
             ? (int)g_role[FLEET_FEATURE].max : 2;

    Sup *sups = xmalloc(sizeof(Sup) * (size_t)(nfeat > 0 ? nfeat : 1));
    memset(sups, 0, sizeof(Sup) * (size_t)(nfeat > 0 ? nfeat : 1));
    bool *started = xmalloc(sizeof(bool) * (size_t)(nfeat > 0 ? nfeat : 1));
    bool *finished = xmalloc(sizeof(bool) * (size_t)(nfeat > 0 ? nfeat : 1));
    memset(started, 0, sizeof(bool) * (size_t)(nfeat > 0 ? nfeat : 1));
    memset(finished, 0, sizeof(bool) * (size_t)(nfeat > 0 ? nfeat : 1));

    Hierarchy h;
    Kvx *wf = orch_hier(g->shared, &h);
    MainAgent main_agent;
    memset(&main_agent, 0, sizeof main_agent);
    main_agent.enabled = h.main_agent;
    main_agent.wakes = 8;
    main_agent.blocked_seq = events_head(g);
    hier_free(&h);
    kvx_free(wf);

    struct sigaction sa, oldint, oldterm, oldhup;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = orch_on_signal;
    g_orch_int = 0;
    sigaction(SIGINT, &sa, &oldint);
    sigaction(SIGTERM, &sa, &oldterm);
    sigaction(SIGHUP, &sa, &oldhup);

    int rc = 0, active = 0, done_count = 0;
    bool first = true;
    for (;;) {
        /* start what may start: prerequisites done, a feature slot free */
        for (int i = 0; i < nfeat; i++) {
            if (started[i] || active >= fmax) continue;
            char waiting[128] = "";
            bool resuming = ro && ro->resume && i == 0;
            if (!resuming && !feature_ready(g, features[i], waiting, sizeof waiting))
                continue;
            if (sup_open(g, &sups[i], features[i], cfg, extra, nslots, maxfail,
                         maxrounds, nfeat == 1 && ro ? ro->run_id : NULL,
                         resuming ? ro->resume : NULL) != 0) {
                started[i] = finished[i] = true;
                rc = 1;
                done_count++;
                continue;
            }
            setenv("CG_RUN", sups[i].run, 1);
            started[i] = true;
            active++;
        }
        if (first) {
            main_wake(&main_agent, "the run is starting");
            first = false;
        }
        for (int i = 0; i < nfeat; i++) {
            if (!started[i] || finished[i]) continue;
            g_coll_feature = sups[i].feature;
            setenv("CG_RUN", sups[i].run, 1);   /* children carry their run */
            if (supervisor_tick(&sups[i]) == SUP_DONE) {
                finished[i] = true;
                active--;
                done_count++;
                if (sups[i].rc) rc = sups[i].rc;
                char r[200];
                snprintf(r, sizeof r, "feature %s ended %s", sups[i].feature,
                         sups[i].state);
                main_wake(&main_agent, r);
            }
        }
        main_tick(g, &main_agent, sups, nfeat, cfg, extra);
        if (g_orch_int && main_agent.live) {
            sup_kill(main_agent.n.pid, main_agent.start, main_agent.adopted);
            main_agent.live = false;
        }
        if (done_count >= nfeat) {
            /* the main agent hears how it ended, once, if it is enabled */
            if (!main_agent.enabled || g_orch_int ||
                (!main_agent.live && !main_agent.reason[0]) ||
                main_agent.wakes <= 0) {
                if (main_agent.live) {
                    struct timespec ts = { 0, 150 * 1000 * 1000 };
                    nanosleep(&ts, NULL);
                    continue;
                }
                break;
            }
        }
        /* nothing running and nothing that can start: say what waits */
        if (active == 0 && done_count < nfeat) {
            bool can = false;
            for (int i = 0; i < nfeat; i++)
                if (!started[i] && feature_ready(g, features[i], NULL, 0)) can = true;
            if (!can) {
                for (int i = 0; i < nfeat; i++) {
                    char waiting[128] = "";
                    if (started[i]) continue;
                    feature_ready(g, features[i], waiting, sizeof waiting);
                    fprintf(stderr, "cg spec run: %s waits for %s, which did "
                            "not finish\n", features[i], waiting);
                }
                rc = 1;
                break;
            }
        }
        struct timespec ts = { 0, 150 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }

    sigaction(SIGINT, &oldint, NULL);
    sigaction(SIGTERM, &oldterm, NULL);
    sigaction(SIGHUP, &oldhup, NULL);
    for (int i = 0; i < nfeat; i++) if (started[i]) sup_close(&sups[i]);
    driver_tap_free(&main_agent.tap);
    free(sups); free(started); free(finished);
    flock(lock, LOCK_UN);
    close(lock);
    return rc;
}

static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,
                          const char *extra, int nslots, int maxfail,
                          int maxrounds, bool dry, bool status,
                          const FleetRunOpts *ro) {
    Cg g;
    if (!memory_open_quiet(&g)) {
        fprintf(stderr, "cg spec run: --fleet needs a Codify index — run "
                "`cg init` first\n");
        return 1;
    }
    char resume_feature[128] = "", resume_run[40] = "";
    FleetRunOpts ro_eff = ro ? *ro : (FleetRunOpts){ NULL, NULL, false };
    if (ro && ro->resume) {
        bool found;
        if (ro->resume[0]) {
            sqlite3_stmt *st = cg_prep(&g, "SELECT feature FROM fleet_runs "
                                           "WHERE run=?");
            sqlite3_bind_text(st, 1, ro->resume, -1, SQLITE_TRANSIENT);
            found = sqlite3_step(st) == SQLITE_ROW;
            if (found) snprintf(resume_feature, sizeof resume_feature, "%s",
                                (const char *)sqlite3_column_text(st, 0));
            sqlite3_finalize(st);
            snprintf(resume_run, sizeof resume_run, "%s", ro->resume);
        } else {
            found = run_latest_open(&g, resume_run, sizeof resume_run,
                                    resume_feature, sizeof resume_feature);
        }
        if (!found) {
            fprintf(stderr, "cg fleet: nothing to resume — no unfinished run%s%s\n",
                    ro->resume[0] ? " named " : "", ro->resume);
            cg_close(&g);
            return 1;
        }
        feature_ov = resume_feature;
        ro_eff.resume = resume_run;
    }
    ro = &ro_eff;
    Hierarchy h;
    Kvx *wf = orch_hier(g.shared, &h);
    orch_roles_load(&h);
    char *active = wf ? kvx_str(wf, "meta", "active_feature") : NULL;
    char feature[128];
    snprintf(feature, sizeof feature, "%s",
             feature_ov && feature_ov[0] ? feature_ov
                                         : (active ? active : ""));
    free(active);
    bool configured = h.configured, enabled = h.enabled;
    char mainbr[256], fbranch[256];
    snprintf(mainbr, sizeof mainbr, "%s", h.main_branch);
    hier_expand(&h, h.roles[FLEET_FEATURE].branch, feature, -1, fbranch,
                sizeof fbranch);
    char fwt[4600];
    orch_worktree_path(&h, g.shared, fbranch, fwt, sizeof fwt);
    hier_free(&h);
    kvx_free(wf);

    if (!feature[0]) {
        fprintf(stderr, "cg spec run: no active_feature — name one with "
                "-f <feature>\n");
        cg_close(&g);
        return 1;
    }
    /* Without a hierarchy there is no second level to run, and the flat
     * `cg spec run` is the whole answer — so nothing is spawned here. */
    if (!configured || !enabled) {
        fprintf(stderr, "cg spec run: --fleet needs a%s [hierarchy] in "
                "spec/workflow.kvx — without one `cg spec run` is the "
                "single-level run and nothing was spawned\n",
                configured ? "n enabled" : "");
        cg_close(&g);
        return 1;
    }
    if (status) {
        int rc = orch_tree_status(&g, feature, false);
        cg_close(&g);
        return rc;
    }
    if (!git_available(&g)) {
        fprintf(stderr, "cg spec run: %s has no git repository — the fleet "
                "needs branches\n", g.shared);
        cg_close(&g);
        return 1;
    }

    if (dry) {
        printf("fleet plan — driver %s, %d worker slot(s), feature %s "
               "(dry run: nothing claimed)\n", cfg->driver, nslots, feature);
        FleetNode mn;
        if (orch_spawn_manager(&g, feature, cfg->driver, extra, cfg->cmd,
                               true, &mn) != 0) {
            cg_close(&g);
            return 1;
        }
        OrchTask *v = NULL;
        int n = orch_tasks_load(&g, feature, fwt, &v);
        int shown = 0;
        for (int i = 0; i < n; i++) {
            if (v[i].finished) continue;
            FleetNode wn;
            orch_spawn_worker(&g, feature, v[i].id, cfg->driver, extra,
                              cfg->cmd, true, &wn);
            shown++;
        }
        if (!shown)
            printf("    nothing to run — every task of %s is qualified\n",
                   feature);
        orch_tasks_free(v, n);
        cg_close(&g);
        return 0;
    }

    if (nslots > ORCH_MAX_SLOTS) nslots = ORCH_MAX_SLOTS;
    if (nslots < 1) nslots = 1;
    char **feats = NULL;
    int nfeat = 0;
    if (ro && ro->all && !ro->resume) {
        nfeat = features_open(&g, &feats);
        if (!nfeat) {
            printf("[fleet] nothing to run — every feature is done\n");
            cg_close(&g);
            return 0;
        }
    } else {
        feats = xmalloc(sizeof(char *));
        feats[0] = xstrdup(feature);
        nfeat = 1;
    }
    int rc = supervisor_run(&g, feats, nfeat, cfg, extra, nslots, maxfail,
                            maxrounds, ro);
    for (int i = 0; i < nfeat; i++) free(feats[i]);
    free(feats);
    cg_close(&g);
    return rc;
}

/* ---------------- cg fleet up | down | pause | resume | runs ------------ */

static void self_exe(char *out, size_t cap) {
    ssize_t n = readlink("/proc/self/exe", out, cap - 1);
    if (n > 0) out[n] = 0;
    else snprintf(out, cap, "cg");
}

/* the run's state and whether its supervisor is alive, for the newest
 * unfinished run (or `run` when named) */
typedef struct { char run[40], feature[128], state[16]; int pid; bool alive; } RunRef;

static bool run_ref(Cg *cg, const char *run, RunRef *r) {
    memset(r, 0, sizeof *r);
    sqlite3_stmt *st = run && run[0]
        ? cg_prep(cg, "SELECT run,feature,state,ifnull(pid,0) FROM fleet_runs "
                      "WHERE run=?")
        : cg_prep(cg, "SELECT run,feature,state,ifnull(pid,0) FROM fleet_runs "
                      "WHERE state IN ('running','paused','draining','stopping') "
                      "ORDER BY started DESC, rowid DESC LIMIT 1");
    if (run && run[0]) sqlite3_bind_text(st, 1, run, -1, SQLITE_TRANSIENT);
    bool ok = sqlite3_step(st) == SQLITE_ROW;
    if (ok) {
        snprintf(r->run, sizeof r->run, "%s", (const char *)sqlite3_column_text(st, 0));
        snprintf(r->feature, sizeof r->feature, "%s", (const char *)sqlite3_column_text(st, 1));
        snprintf(r->state, sizeof r->state, "%s", (const char *)sqlite3_column_text(st, 2));
        r->pid = sqlite3_column_int(st, 3);
    }
    sqlite3_finalize(st);
    r->alive = ok && fleet_supervisor_alive(cg->shared);
    return ok;
}

static void run_state_set(Cg *cg, const char *run, const char *state,
                          const char *reason) {
    sqlite3_stmt *st = cg_prep(cg,
        "UPDATE fleet_runs SET state=?,reason=ifnull(?,reason),updated=? "
        "WHERE run=?");
    sqlite3_bind_text(st, 1, state, -1, SQLITE_TRANSIENT);
    if (reason) sqlite3_bind_text(st, 2, reason, -1, SQLITE_TRANSIENT);
    else sqlite3_bind_null(st, 2);
    sqlite3_bind_int64(st, 3, (long)time(NULL));
    sqlite3_bind_text(st, 4, run, -1, SQLITE_TRANSIENT);
    sqlite3_step(st);
    sqlite3_finalize(st);
    StrBuf p; sb_init(&p);
    sb_puts(&p, "{\"run\":"); sb_json_str(&p, run);
    sb_puts(&p, ",\"state\":"); sb_json_str(&p, state);
    sb_puts(&p, ",\"reason\":");
    if (reason) sb_json_str(&p, reason); else sb_puts(&p, "null");
    sb_puts(&p, ",\"by\":\"cli\"}");
    events_emit(cg, "fleet.run", run, p.p);
    sb_free(&p);
}

/* No supervisor to act on the request: stop what the run left alive
 * ourselves — the same terminate-and-release a supervisor does. */
static int run_cleanup(Cg *cg, const char *run, const char *feature) {
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id,role,agent,ifnull(task,''),ifnull(pid,-1),"
        "ifnull(pid_start,-1),ifnull(attempt,''),ifnull(fence,0) "
        "FROM fleet_nodes WHERE run=? AND state='live'");
    sqlite3_bind_text(st, 1, run, -1, SQLITE_TRANSIENT);
    typedef struct { long id; char role[16], agent[128], task[64], attempt[65];
                     int pid; long start, fence; } Live;
    Live v[64];
    int n = 0;
    while (sqlite3_step(st) == SQLITE_ROW && n < 64) {
        Live *l = &v[n++];
        l->id = sqlite3_column_int64(st, 0);
        snprintf(l->role, sizeof l->role, "%s", (const char *)sqlite3_column_text(st, 1));
        snprintf(l->agent, sizeof l->agent, "%s", (const char *)sqlite3_column_text(st, 2));
        snprintf(l->task, sizeof l->task, "%s", (const char *)sqlite3_column_text(st, 3));
        l->pid = sqlite3_column_int(st, 4);
        l->start = sqlite3_column_int64(st, 5);
        snprintf(l->attempt, sizeof l->attempt, "%s", (const char *)sqlite3_column_text(st, 6));
        l->fence = sqlite3_column_int64(st, 7);
    }
    sqlite3_finalize(st);
    int killed = 0;
    for (int i = 0; i < n; i++) {
        if (proc_alive(v[i].pid, v[i].start)) {
            sup_kill(v[i].pid, v[i].start, true);
            killed++;
        }
        if (strcmp(v[i].role, "worker") == 0 && v[i].task[0])
            orch_abandon(cg->shared, feature, v[i].task, v[i].agent,
                         v[i].attempt, v[i].fence);
        sqlite3_stmt *u = cg_prep(cg, "UPDATE fleet_nodes SET state='killed',"
                                      "outcome='stopped',ended=? WHERE id=?");
        sqlite3_bind_int64(u, 1, (long)time(NULL));
        sqlite3_bind_int64(u, 2, v[i].id);
        sqlite3_step(u);
        sqlite3_finalize(u);
    }
    return killed;
}

/* the run named by pos, or the newest unfinished one */
static const char *pos_arg(int argc, char **argv) {
    for (int i = 0; i < argc; i++) {
        if (argv[i][0] != '-') return argv[i];
        if (strcmp(argv[i], "-m") == 0 || strcmp(argv[i], "--wait") == 0) i++;
    }
    return NULL;
}

static int detach_supervisor(Cg *cg, char **pass, int npass,
                             const char *run_id, const char *resume,
                             bool json) {
    char self[4096], logdir[4600], logpath[4800];
    self_exe(self, sizeof self);
    snprintf(logdir, sizeof logdir, "%s/%s/fleet", cg->shared, CG_DIR);
    mkdirs(logdir);
    const char *name = resume ? resume : run_id;
    snprintf(logpath, sizeof logpath, "%s/supervisor-%s.log", logdir, name);
    char **av = xmalloc(sizeof(char *) * (size_t)(npass + 8));
    int n = 0;
    av[n++] = self;
    av[n++] = (char *)"spec";
    av[n++] = (char *)"run";
    av[n++] = (char *)"--fleet";
    if (resume) { av[n++] = (char *)"--resume"; av[n++] = (char *)resume; }
    else { av[n++] = (char *)"--run-id"; av[n++] = (char *)run_id; }
    for (int i = 0; i < npass; i++) av[n++] = pass[i];
    av[n] = NULL;
    pid_t pid = fork();
    if (pid < 0) { free(av); fprintf(stderr, "cg fleet: fork failed\n"); return 1; }
    if (pid == 0) {
        setsid();
        int in = open("/dev/null", O_RDONLY);
        int lg = open(logpath, O_WRONLY | O_CREAT | O_APPEND, 0644);
        if (in >= 0) { dup2(in, 0); close(in); }
        if (lg >= 0) { dup2(lg, 1); dup2(lg, 2); close(lg); }
        setenv("CG_SUPERVISOR_LOG", logpath, 1);
        if (chdir(cg->root) != 0) _exit(126);
        execv(self, av);
        _exit(127);
    }
    free(av);
    /* back once the supervisor has recorded (or re-claimed) the run, or
     * has already given up — then its log says why */
    int exited = 0, st = 0;
    bool ready = false;
    for (int i = 0; i < 200 && !ready; i++) {
        if (waitpid(pid, &st, WNOHANG) == pid) { exited = 1; break; }
        sqlite3_stmt *q = cg_prep(cg, "SELECT pid FROM fleet_runs WHERE run=?");
        sqlite3_bind_text(q, 1, name, -1, SQLITE_TRANSIENT);
        if (sqlite3_step(q) == SQLITE_ROW && sqlite3_column_int(q, 0) == pid)
            ready = true;
        sqlite3_finalize(q);
        if (!ready) {
            struct timespec ts = { 0, 50 * 1000 * 1000 };
            nanosleep(&ts, NULL);
        }
    }
    if (!ready) {
        char *tail = read_entire_file(logpath, NULL);
        const char *t = tail ? tail : "";
        size_t tl = strlen(t);
        if (tl > 1200) t += tl - 1200;
        fprintf(stderr, "cg fleet: the supervisor %s before recording run %s\n%s",
                exited ? "exited" : "did not start", name, t);
        free(tail);
        return 1;
    }
    if (json) {
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"run\":"); sb_json_str(&b, name);
        sb_printf(&b, ",\"pid\":%d,\"resumed\":%s,\"log\":", (int)pid,
                  resume ? "true" : "false");
        sb_json_str(&b, logpath);
        sb_puts(&b, "}\n");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        printf("fleet %s: run %s — supervisor pid %d\n",
               resume ? "resumed" : "up", name, (int)pid);
        printf("  log:    %s\n  follow: cg events --follow   status: cg fleet "
               "runs   stop: cg fleet down\n", logpath);
    }
    return 0;
}

int cmd_fleet_up(Cg *cg, int argc, char **argv, bool json) {
    bool fg = false;
    const char *resume = NULL;
    char **pass = xmalloc(sizeof(char *) * (size_t)(argc + 1));
    int np = 0;
    for (int i = 0; i < argc; i++) {
        if (strcmp(argv[i], "--foreground") == 0) fg = true;
        else if (strcmp(argv[i], "--resume") == 0)
            resume = (i + 1 < argc && argv[i + 1][0] != '-') ? argv[++i] : "";
        else pass[np++] = argv[i];
    }
    int rc;
    if (fg) {
        char **av = xmalloc(sizeof(char *) * (size_t)(np + 4));
        int n = 0;
        av[n++] = (char *)"--fleet";
        if (resume) { av[n++] = (char *)"--resume"; av[n++] = (char *)resume; }
        for (int i = 0; i < np; i++) av[n++] = pass[i];
        rc = cmd_spec_run(n, av);
        free(av);
    } else if (fleet_supervisor_alive(cg->shared)) {
        RunRef r;
        run_ref(cg, NULL, &r);
        fprintf(stderr, "cg fleet: a supervisor is already running%s%s — see "
                "`cg fleet runs`, or stop it with `cg fleet down`\n",
                r.run[0] ? " run " : "", r.run);
        rc = 1;
    } else if (resume) {
        RunRef r;
        if (!run_ref(cg, resume, &r)) {
            fprintf(stderr, "cg fleet: nothing to resume — no unfinished run%s%s\n",
                    resume[0] ? " named " : "", resume);
            rc = 1;
        } else {
            rc = detach_supervisor(cg, pass, np, NULL, r.run, json);
        }
    } else {
        char run[40], feature[128] = "";
        for (int i = 0; i + 1 < np; i++)
            if (strcmp(pass[i], "-f") == 0) snprintf(feature, sizeof feature, "%s", pass[i + 1]);
        run_id_new(feature, run, sizeof run);
        rc = detach_supervisor(cg, pass, np, run, NULL, json);
    }
    free(pass);
    return rc;
}

int cmd_fleet_control(Cg *cg, const char *verb, int argc, char **argv,
                      bool json) {
    const char *named = pos_arg(argc, argv);
    bool drain = false;
    long wait_s = 30;
    for (int i = 0; i < argc; i++) {
        if (strcmp(argv[i], "--drain") == 0) drain = true;
        else if (strcmp(argv[i], "--wait") == 0 && i + 1 < argc) wait_s = atol(argv[++i]);
    }
    RunRef r;
    if (!run_ref(cg, named, &r)) {
        fprintf(stderr, "cg fleet %s: no %srun%s%s\n", verb,
                named ? "" : "unfinished ", named ? " named " : "",
                named ? named : "");
        return 1;
    }
    const char *result = NULL;
    int rc = 0;
    if (strcmp(verb, "pause") == 0) {
        run_state_set(cg, r.run, "paused", "pause");
        result = r.alive ? "paused — live agents finish, nothing new starts"
                         : "marked paused (no supervisor is running; `cg fleet "
                           "resume` starts one)";
    } else if (strcmp(verb, "resume") == 0) {
        if (r.alive) {
            if (strcmp(r.state, "running") == 0) result = "already running";
            else {
                run_state_set(cg, r.run, "running", "resume");
                result = "running";
            }
        } else {
            if (strcmp(r.state, "running") != 0)
                run_state_set(cg, r.run, "running", "resume");
            return detach_supervisor(cg, NULL, 0, NULL, r.run, json);
        }
    } else if (strcmp(verb, "down") == 0) {
        if (!r.alive) {
            int killed = run_cleanup(cg, r.run, r.feature);
            run_state_set(cg, r.run, "stopped", "down (no supervisor)");
            char buf[200];
            snprintf(buf, sizeof buf, "stopped — no supervisor was running; "
                     "%d agent(s) terminated, claims released, branches kept",
                     killed);
            result = buf;
            if (json) printf("{\"run\":\"%s\",\"state\":\"stopped\",\"killed\":%d}\n",
                             r.run, killed);
            else printf("fleet down: run %s %s\n", r.run, result);
            return 0;
        }
        run_state_set(cg, r.run, drain ? "draining" : "stopping",
                      drain ? "down --drain" : "down");
        /* wait for the supervisor to act on it; a drain can take as long
         * as the slowest live agent, so it only waits when asked to */
        long deadline = (long)time(NULL) + (drain && wait_s == 30 ? 0 : wait_s);
        char st[16] = "";
        for (;;) {
            RunRef now;
            run_ref(cg, r.run, &now);
            snprintf(st, sizeof st, "%s", now.state);
            if (!strcmp(st, "stopped") || !strcmp(st, "complete") ||
                !strcmp(st, "failed") || (long)time(NULL) >= deadline)
                break;
            struct timespec ts = { 0, 100 * 1000 * 1000 };
            nanosleep(&ts, NULL);
        }
        result = !strcmp(st, "stopped") ? "stopped — agents terminated, claims "
                                          "released, branches kept"
               : drain ? "draining — live agents finish, then the supervisor stops"
               : "stop requested — the supervisor has not confirmed yet";
        if (strcmp(st, "stopped") && !drain) rc = 1;
    } else {
        fprintf(stderr, "cg fleet: unknown control %s\n", verb);
        return 1;
    }
    if (json) {
        RunRef now;
        run_ref(cg, r.run, &now);
        StrBuf b; sb_init(&b);
        sb_puts(&b, "{\"run\":"); sb_json_str(&b, r.run);
        sb_puts(&b, ",\"state\":"); sb_json_str(&b, now.state);
        sb_printf(&b, ",\"supervisor\":%s}\n", now.alive ? "true" : "false");
        fputs(b.p, stdout);
        sb_free(&b);
    } else {
        printf("fleet %s: run %s %s\n", verb, r.run, result);
    }
    return rc;
}

int cmd_fleet_runs(Cg *cg, bool json) {
    bool alive = fleet_supervisor_alive(cg->shared);
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT r.run,r.feature,r.state,ifnull(r.pid,0),ifnull(r.failures,0),"
        "ifnull(r.wakes_left,0),r.started,r.updated,ifnull(r.reason,''),"
        "ifnull(r.log,''),(SELECT COUNT(*) FROM fleet_nodes n WHERE n.run=r.run "
        "AND n.state='live'),(SELECT COUNT(*) FROM fleet_nodes n WHERE "
        "n.run=r.run) FROM fleet_runs r ORDER BY r.started DESC, r.rowid DESC "
        "LIMIT 20");
    StrBuf b; sb_init(&b);
    if (json) sb_puts(&b, "{\"runs\":[");
    else sb_printf(&b, "%-12s %-18s %-9s %-10s %5s %5s %5s  %s\n", "run",
                   "feature", "state", "supervisor", "live", "nodes", "fails",
                   "reason");
    int n = 0;
    bool first_open = true;
    while (sqlite3_step(st) == SQLITE_ROW) {
        const char *run = (const char *)sqlite3_column_text(st, 0);
        const char *state = (const char *)sqlite3_column_text(st, 2);
        bool open = !strcmp(state, "running") || !strcmp(state, "paused") ||
                    !strcmp(state, "draining") || !strcmp(state, "stopping");
        /* one supervisor per project: only the newest open run can be its */
        bool sup = open && first_open && alive;
        if (open) first_open = false;
        if (json) {
            if (n) sb_putc(&b, ',');
            sb_puts(&b, "{\"run\":"); sb_json_str(&b, run);
            sb_puts(&b, ",\"feature\":");
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 1));
            sb_puts(&b, ",\"state\":"); sb_json_str(&b, state);
            sb_printf(&b, ",\"supervisor\":%s,\"pid\":%d,\"failures\":%d,"
                          "\"wakes_left\":%d,\"started\":%lld,\"updated\":%lld,"
                          "\"live\":%d,\"nodes\":%d,\"reason\":",
                      sup ? "true" : "false", sqlite3_column_int(st, 3),
                      sqlite3_column_int(st, 4), sqlite3_column_int(st, 5),
                      (long long)sqlite3_column_int64(st, 6),
                      (long long)sqlite3_column_int64(st, 7),
                      sqlite3_column_int(st, 10), sqlite3_column_int(st, 11));
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 8));
            sb_puts(&b, ",\"log\":");
            sb_json_str(&b, (const char *)sqlite3_column_text(st, 9));
            sb_putc(&b, '}');
        } else {
            sb_printf(&b, "%-12s %-18s %-9s %-10s %5d %5d %5d  %s\n", run,
                      (const char *)sqlite3_column_text(st, 1), state,
                      sup ? "alive" : open ? "GONE" : "—",
                      sqlite3_column_int(st, 10), sqlite3_column_int(st, 11),
                      sqlite3_column_int(st, 4),
                      (const char *)sqlite3_column_text(st, 8));
        }
        n++;
    }
    sqlite3_finalize(st);
    if (json) sb_puts(&b, "]}\n");
    else if (!n) sb_puts(&b, "no fleet runs yet — start one with `cg fleet up`\n");
    fputs(b.p, stdout);
    sb_free(&b);
    return 0;
}
