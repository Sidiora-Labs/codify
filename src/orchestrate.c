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

static int split_args(const char *s, char **av, int n, int cap) {
    if (!s) return n;
    while (*s && n < cap - 1) {
        while (*s && isspace((unsigned char)*s)) s++;
        if (!*s) break;
        const char *start = s;
        while (*s && !isspace((unsigned char)*s)) s++;
        char *tok = xmalloc((size_t)(s - start) + 1);
        memcpy(tok, start, (size_t)(s - start));
        tok[s - start] = 0;
        av[n++] = tok;
    }
    return n;
}

/* ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT} — kvx's ${} interpolation style,
 * but a plain string replace against these four names only */
static char *orch_subst(const char *tmpl, const char *promptfile,
                        const char *task, const char *root,
                        const char *agent) {
    StrBuf b;
    sb_init(&b);
    for (const char *p = tmpl; *p;) {
        if (p[0] == '$' && p[1] == '{') {
            const char *end = strchr(p + 2, '}');
            if (end) {
                size_t n = (size_t)(end - (p + 2));
                const char *v = NULL;
                if (n == 11 && strncmp(p + 2, "PROMPT_FILE", n) == 0)
                    v = promptfile;
                else if (n == 4 && strncmp(p + 2, "TASK", n) == 0)
                    v = task;
                else if (n == 4 && strncmp(p + 2, "ROOT", n) == 0)
                    v = root;
                else if (n == 5 && strncmp(p + 2, "AGENT", n) == 0)
                    v = agent;
                if (v) {
                    sb_puts(&b, v);
                    p = end + 1;
                    continue;
                }
            }
        }
        sb_putc(&b, *p++);
    }
    return b.p;
}

/* Build the argv that runs one task under one driver. Entries are malloc'd
 * and NULL-terminated; returns argc, or -1 for an unknown driver / a custom
 * driver without a cmd template. The prompt file always arrives on stdin;
 * only the custom template also sees it as ${PROMPT_FILE}. */
int orch_driver_argv(const char *driver, const char *extra_args,
                     const char *cmd_tmpl, const char *root,
                     const char *promptfile, const char *task,
                     const char *agent, char **av, int cap) {
    int n = 0;
    if (strcmp(driver, "codex") == 0) {
        av[n++] = xstrdup("codex");
        av[n++] = xstrdup("exec");
        av[n++] = xstrdup("--sandbox");
        av[n++] = xstrdup("workspace-write");
        av[n++] = xstrdup("--skip-git-repo-check");
        av[n++] = xstrdup("-C");
        av[n++] = xstrdup(root);
        n = split_args(extra_args, av, n, cap - 1);
        av[n++] = xstrdup("-");
    } else if (strcmp(driver, "claude") == 0) {
        av[n++] = xstrdup("claude");
        av[n++] = xstrdup("-p");
        av[n++] = xstrdup("--permission-mode");
        av[n++] = xstrdup("acceptEdits");
        n = split_args(extra_args, av, n, cap);
    } else if (strcmp(driver, "custom") == 0) {
        if (!cmd_tmpl || !cmd_tmpl[0]) return -1;
        av[n++] = xstrdup("/bin/sh");
        av[n++] = xstrdup("-c");
        av[n++] = orch_subst(cmd_tmpl, promptfile, task, root, agent);
    } else {
        return -1;
    }
    av[n] = NULL;
    return n;
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
        int ac = orch_driver_argv(cfg->driver, extra, cfg->cmd, cgroot,
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
    char  agent[80];
    char  attempt[65];
    long  fence;
    long  last_heartbeat;
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
static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,
                          const char *extra, int nslots, int maxfail,
                          int maxrounds, bool dry, bool status);

int cmd_spec_run(int argc, char **argv) {
    int nflag = 0, maxfail = 2, maxrounds = 0;
    const char *driver_ov = NULL, *prefix = "run", *feature_ov = NULL;
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
        else {
            fprintf(stderr, "usage: cg spec run [-n N] [--driver "
                    "codex|claude|custom] [--dry-run] [--max-fail K] "
                    "[--agent-prefix P] [--fleet [-f <feature>] "
                    "[--max-rounds R] [--status]]\n");
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
        int rc = orch_fleet_run(feature_ov ? feature_ov : feature, &cfg,
                                extra, nslots, maxfail, maxrounds, dry, tree);
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

        /* reap finished slots; the spec file, not the exit code, decides */
        for (int i = 0; i < nslots; i++) {
            if (!slots[i].live) continue;
            int st;
            pid_t r = waitpid(slots[i].pid, &st, WNOHANG);
            if (r == 0) continue;
            slots[i].live = false;
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
            if (orch_write_prompt(cgroot, tfeat, id, prompt,
                                  sizeof prompt) != 0) {
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
            int ac = orch_driver_argv(cfg.driver, extra, cfg.cmd, cgroot,
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
        int ac = orch_driver_argv(driver, extra, cmd_tmpl, n->worktree,
                                  prompt, feature, n->agent, av,
                                  ORCH_MAX_ARGV);
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
    char *av[ORCH_MAX_ARGV];
    int ac = orch_driver_argv(driver, extra, cmd_tmpl, n->worktree, prompt,
                              feature, n->agent, av, ORCH_MAX_ARGV);
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
    hier_expand(&h, rw->agent, feature, wave, n->agent, sizeof n->agent);
    hier_expand(&h, rw->branch, feature, wave, n->branch, sizeof n->branch);
    hier_expand(&h, rw->base, feature, wave, n->base, sizeof n->base);
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
        int ac = orch_driver_argv(driver, extra, cmd_tmpl, n->worktree,
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
    if (prc != 0) {
        fprintf(stderr, "cg spec run: could not write the briefing for task "
                "%s\n", id);
        orch_abandon(cg->shared, feature, id, n->agent, n->attempt, n->fence);
        return 1;
    }
    char *av[ORCH_MAX_ARGV];
    int ac = orch_driver_argv(driver, extra, cmd_tmpl, n->worktree, prompt,
                              id, n->agent, av, ORCH_MAX_ARGV);
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
                  "\"complete\":%s,\"workers\":[", mseen, sub.total, sub.done,
                  sub.claimed, sub.ahead, sub.merged ? "true" : "false",
                  sub.complete ? "true" : "false");
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
static bool orch_next_task(const OrchTask *v, int n, char **tried, int ntried,
                           const OrchFleetSlot *slots, int nslots,
                           char *out, size_t cap) {
    for (int i = 0; i < n; i++) {
        if (v[i].finished || v[i].claimed) continue;
        bool skip = false;
        for (int t = 0; t < ntried && !skip; t++)
            if (strcmp(tried[t], v[i].id) == 0) skip = true;
        for (int j = 0; j < v[i].nreq && !skip; j++)
            if (!orch_finished_id(v, n, v[i].req[j])) skip = true;
        for (int s = 0; s < nslots && !skip; s++)
            if (slots[s].live && slots[s].n.wave == v[i].wave) skip = true;
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

static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,
                          const char *extra, int nslots, int maxfail,
                          int maxrounds, bool dry, bool status) {
    Cg g;
    if (!memory_open_quiet(&g)) {
        fprintf(stderr, "cg spec run: --fleet needs a Codify index — run "
                "`cg init` first\n");
        return 1;
    }
    Hierarchy h;
    Kvx *wf = orch_hier(g.shared, &h);
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
    long ttl_min = cfg->ttl > 0 ? (cfg->ttl + 59) / 60 : 60;
    OrchFleetSlot *slots = xmalloc(sizeof(OrchFleetSlot) * (size_t)nslots);
    memset(slots, 0, sizeof(OrchFleetSlot) * (size_t)nslots);
    FleetNode mgr;
    memset(&mgr, 0, sizeof mgr);
    mgr.pid = -1;
    bool mgr_live = false, stopping = false;
    bool first_turn = true, frontier_empty = false;
    long last_wake = 0;
    int wakes = maxrounds > 0 ? maxrounds : ORCH_ROUNDS_DFLT;
    char *tried[ORCH_MAX_TRIED];
    int ntried = 0, failures = 0, rc = 0;

    struct sigaction sa, oldint, oldterm, oldhup;
    memset(&sa, 0, sizeof sa);
    sa.sa_handler = orch_on_signal;
    g_orch_int = 0;
    sigaction(SIGINT, &sa, &oldint);
    sigaction(SIGTERM, &sa, &oldterm);
    sigaction(SIGHUP, &sa, &oldhup);

    printf("[fleet] %s — manager + %d worker slot(s), driver %s, %d wake(s)\n",
           feature, nslots, cfg->driver, wakes);
    fflush(stdout);

    for (;;) {
        if (g_orch_int) {
            if (mgr_live && kill(-mgr.pid, SIGTERM) != 0)
                kill(mgr.pid, SIGTERM);
            for (int i = 0; i < nslots; i++)
                if (slots[i].live && kill(-slots[i].n.pid, SIGTERM) != 0)
                    kill(slots[i].n.pid, SIGTERM);
            if (mgr_live && orch_reap(mgr.pid) == 0) mgr_live = false;
            for (int i = 0; i < nslots; i++) {
                if (!slots[i].live) continue;
                if (orch_reap(slots[i].n.pid) != 0) continue;
                slots[i].live = false;
                orch_abandon(g.shared, feature, slots[i].n.task,
                             slots[i].n.agent, slots[i].n.attempt,
                             slots[i].n.fence);
            }
            fprintf(stderr, "cg spec run: interrupted — the fleet was "
                    "terminated, worker claims released, branches kept\n");
            rc = 130;
            break;
        }

        /* reap workers: the branch tip, not the exit code, decides */
        for (int i = 0; i < nslots; i++) {
            if (!slots[i].live) continue;
            int st;
            pid_t r = waitpid(slots[i].n.pid, &st, WNOHANG);
            if (r == 0) continue;
            slots[i].live = false;
            int crc = WIFEXITED(st) ? WEXITSTATUS(st) : 128 + WTERMSIG(st);
            char *ts = orch_task_status(slots[i].n.worktree, feature,
                                        slots[i].n.task, slots[i].n.attempt,
                                        slots[i].n.fence);
            bool ok = ts && (strcmp(ts, "done") == 0 ||
                             strcmp(ts, "implemented") == 0);
            printf("[fleet] worker %s task %s exit %d → %s\n",
                   slots[i].n.agent, slots[i].n.task, crc,
                   ok ? ts : "INCOMPLETE");
            fflush(stdout);
            if (!ok) {
                orch_abandon(g.shared, feature, slots[i].n.task,
                             slots[i].n.agent, slots[i].n.attempt,
                             slots[i].n.fence);
                orch_note_failure(feature, slots[i].n.task, crc);
                failures++;
            }
            free(ts);
        }

        /* a live worker keeps its fenced attempt alive */
        long every = cfg->ttl > 0 ? cfg->ttl / 3 : 20;
        if (every < 1) every = 1;
        long now = (long)time(NULL);
        for (int i = 0; i < nslots; i++) {
            if (!slots[i].live || now - slots[i].last_heartbeat < every)
                continue;
            if (orch_node_heartbeat(&slots[i].n, ttl_min) == 0) {
                slots[i].last_heartbeat = now;
                continue;
            }
            char *ts = orch_task_status(slots[i].n.worktree, feature,
                                        slots[i].n.task, slots[i].n.attempt,
                                        slots[i].n.fence);
            bool done = ts && (strcmp(ts, "done") == 0 ||
                               strcmp(ts, "implemented") == 0);
            free(ts);
            if (done) { slots[i].last_heartbeat = now; continue; }
            fprintf(stderr, "cg spec run: worker %s lost fenced ownership of "
                    "%s — terminating it\n", slots[i].n.agent,
                    slots[i].n.task);
            if (kill(-slots[i].n.pid, SIGTERM) != 0)
                kill(slots[i].n.pid, SIGTERM);
            orch_reap(slots[i].n.pid);
            slots[i].live = false;
            orch_note_failure(feature, slots[i].n.task, -2);
            failures++;
        }

        if (mgr_live) {
            int st;
            pid_t r = waitpid(mgr.pid, &st, WNOHANG);
            if (r != 0) {
                mgr_live = false;
                int crc = WIFEXITED(st) ? WEXITSTATUS(st)
                                        : 128 + WTERMSIG(st);
                printf("[fleet] manager %s exit %d\n", mgr.agent, crc);
                fflush(stdout);
            }
        }

        /* A manager is done when its subtree is: every task qualified and
         * the feature branch merged. The process exiting proves nothing. */
        OrchSubtree sub;
        orch_subtree(&g, feature, fbranch, fwt, mainbr, &sub);
        int live = orch_live_fleet(slots, nslots);
        if (sub.complete && !mgr_live && live == 0) {
            printf("[fleet] %s complete — %d/%d task(s) qualified, %s merged "
                   "into %s, %d failure(s)\n", feature, sub.done, sub.total,
                   fbranch, mainbr, failures);
            break;
        }
        if (!stopping && failures > maxfail) {
            fprintf(stderr, "cg spec run: %d failure(s) exceed --max-fail %d "
                    "— waiting for the fleet, then stopping\n", failures,
                    maxfail);
            stopping = true;
            rc = 1;
        }

        /* The manager takes the first turn — it owns the feature branch,
         * and its worktree is where every wave is handed up — and each
         * turn after that once no worker is live and the frontier has
         * nothing left to give: it is then the only one who can move the
         * subtree. Every turn is spent from a fixed budget, so a fleet
         * that cannot finish stops instead of spinning. */
        now = (long)time(NULL);
        if (!stopping && !mgr_live && !sub.complete && live == 0 &&
            (first_turn || frontier_empty) &&
            now - last_wake >= ORCH_WAKE_BACKOFF) {
            if (wakes <= 0) {
                fprintf(stderr, "cg spec run: %s did not complete and no "
                        "manager wake is left (--max-rounds) — %d/%d task(s) "
                        "qualified, %ld commit(s) still on %s\n", feature,
                        sub.done, sub.total, sub.ahead < 0 ? 0 : sub.ahead,
                        fbranch);
                rc = 1;
                break;
            }
            FleetNode mn;
            if (orch_spawn_manager(&g, feature, cfg->driver, extra, cfg->cmd,
                                   false, &mn) != 0) {
                rc = 1;
                break;
            }
            mgr = mn;
            mgr_live = true;
            last_wake = now;
            first_turn = false;
            wakes--;
            printf("[fleet] manager %s on %s (%d wake(s) left), log "
                   ".codegraph/agents/%s-manager.log\n", mgr.agent,
                   mgr.branch, wakes, feature);
            fflush(stdout);
        }

        /* Refill worker slots from the frontier — never while the manager
         * runs, for the same reason: a worker handing its wave up merges
         * into the manager's worktree, so the two levels take turns rather
         * than race for it. */
        if (!stopping && !mgr_live) {
            OrchTask *v = NULL;
            int n = orch_tasks_load(&g, feature, fwt, &v);
            for (int i = 0; i < nslots && ntried < ORCH_MAX_TRIED; i++) {
                if (slots[i].live) continue;
                char id[64];
                if (!orch_next_task(v, n, tried, ntried, slots, nslots, id,
                                    sizeof id))
                    break;
                tried[ntried++] = xstrdup(id);
                FleetNode wn;
                if (orch_spawn_worker(&g, feature, id, cfg->driver, extra,
                                      cfg->cmd, false, &wn) != 0) {
                    orch_note_failure(feature, id, -1);
                    failures++;
                    continue;
                }
                slots[i].n = wn;
                slots[i].live = true;
                slots[i].last_heartbeat = (long)time(NULL);
                printf("[fleet] worker %s → %s (wave %ld) on %s, log "
                       ".codegraph/agents/%s-%s.log\n", wn.agent, id,
                       wn.wave, wn.branch, feature, id);
                fflush(stdout);
            }
            char probe[64];
            frontier_empty = !orch_next_task(v, n, tried, ntried, slots,
                                             nslots, probe, sizeof probe);
            orch_tasks_free(v, n);
        }

        if (stopping && !mgr_live && orch_live_fleet(slots, nslots) == 0)
            break;
        struct timespec ts = { 0, 150 * 1000 * 1000 };
        nanosleep(&ts, NULL);
    }

    sigaction(SIGINT, &oldint, NULL);
    sigaction(SIGTERM, &oldterm, NULL);
    sigaction(SIGHUP, &oldhup, NULL);
    for (int i = 0; i < ntried; i++) free(tried[i]);
    free(slots);
    cg_close(&g);
    return rc;
}
