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
    char *argv[8];
    va_start(ap, argc);
    for (int i = 0; i < argc && i < 8; i++) argv[i] = va_arg(ap, char *);
    va_end(ap);
    OrchSpecCall c = { argc, argv, json };
    return cg_capture(out, orch_call_spec, &c);
}

typedef struct { Cg *g; const char *task; } OrchResumeCall;

static int orch_call_resume(void *v) {
    OrchResumeCall *c = v;
    return cmd_resume(c->g, c->task, false, true);
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

/* the authoritative answer on child exit: what does spec.kvx say now? */
static char *orch_task_status(const char *specroot, const char *feature,
                              const char *id) {
    char path[4600];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", specroot, feature);
    Kvx *k = kvx_parse(path);
    if (!k) return NULL;
    char sec[300];
    snprintf(sec, sizeof sec, "task.%s", id);
    char *st = kvx_str(k, sec, "status");
    kvx_free(k);
    return st;
}

/* an attempt that did not finish: free the lease and put the task back in
 * the pool so another slot (or a retry) can pick it up */
static void orch_abandon(const char *specroot, const char *feature,
                         const char *id, const char *agent) {
    char *out = NULL;
    int rr = orch_spec(&out, false, 4, (char *)"release", (char *)id,
                       (char *)"--agent", (char *)agent);
    free(out);
    /* a refused release means the lease expired and another agent adopted
     * the task — its in_progress is theirs, not ours to reset */
    if (rr != 0) return;
    char path[4600], sec[300];
    snprintf(path, sizeof path, "%s/spec/%s/spec.kvx", specroot, feature);
    snprintf(sec, sizeof sec, "task.%s", id);
    char *st = NULL;
    Kvx *k = kvx_parse(path);
    if (k) { st = kvx_str(k, sec, "status"); kvx_free(k); }
    if (st && strcmp(st, "in_progress") == 0 &&
        kvx_set_status(path, sec, "pending") == 0) {
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

/* the agent's briefing, straight from the resume --prompt machinery */
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
    int rc = cg_capture(&out, orch_call_resume, &c);
    cg_close(&g);
    if (rc != 0 || !out || !out[0]) {
        free(out);
        return -1;
    }
    int wrc = write_entire_file(path, out, strlen(out));
    free(out);
    return wrc;
}

static pid_t orch_spawn(char **av, const char *root, const char *promptfile,
                        const char *logpath, const char *agent) {
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
} OrchSlot;

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

int cmd_spec_run(int argc, char **argv) {
    int nflag = 0, maxfail = 2;
    const char *driver_ov = NULL, *prefix = "run";
    bool dry = false;
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
        else {
            fprintf(stderr, "usage: cg spec run [-n N] [--driver "
                    "codex|claude|custom] [--dry-run] [--max-fail K] "
                    "[--agent-prefix P]\n");
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
                             slots[i].agent);
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
                                           slots[i].id);
            bool okdone = tstat && (strcmp(tstat, "done") == 0 ||
                                    strcmp(tstat, "implemented") == 0);
            printf("[run] task %s exit %d → status %s\n", slots[i].id, crc,
                   okdone ? tstat : "INCOMPLETE");
            fflush(stdout);
            if (!okdone) {
                orch_abandon(specroot, slots[i].feature, slots[i].id,
                             slots[i].agent);
                orch_note_failure(slots[i].feature, slots[i].id, crc);
                failures++;
            }
            free(tstat);
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
            char *id = tobj ? json_get_string(tobj, "id") : NULL;
            char *feat = tobj ? json_get_string(tobj, "feature") : NULL;
            free(tobj);
            free(out);
            if (!id || !id[0]) {
                fprintf(stderr, "cg spec run: could not parse claim-next "
                        "output\n");
                free(id);
                free(feat);
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
                orch_abandon(specroot, tfeat, id, agent);
                orch_note_failure(tfeat, id, -1);
                failures++;
                free(id);
                free(feat);
                continue;
            }
            char *av[ORCH_MAX_ARGV];
            int ac = orch_driver_argv(cfg.driver, extra, cfg.cmd, cgroot,
                                      prompt, id, agent, av, ORCH_MAX_ARGV);
            if (ac < 0) {
                fprintf(stderr, "cg spec run: cannot build a %s command "
                        "line\n", cfg.driver);
                orch_abandon(specroot, tfeat, id, agent);
                free(id);
                free(feat);
                stopping = true;
                rc = 1;
                break;
            }
            char logpath[4700];
            snprintf(logpath, sizeof logpath,
                     "%s/.codegraph/agents/%s-%s.log", cgroot, tfeat, id);
            pid_t pid = orch_spawn(av, cgroot, prompt, logpath, agent);
            orch_argv_free(av);
            if (pid < 0) {
                fprintf(stderr, "cg spec run: fork failed: %s\n",
                        strerror(errno));
                orch_abandon(specroot, tfeat, id, agent);
                orch_note_failure(tfeat, id, -1);
                failures++;
                free(id);
                free(feat);
                continue;
            }
            slots[i].pid = pid;
            slots[i].live = true;
            snprintf(slots[i].id, sizeof slots[i].id, "%s", id);
            snprintf(slots[i].feature, sizeof slots[i].feature, "%s", tfeat);
            snprintf(slots[i].agent, sizeof slots[i].agent, "%s", agent);
            printf("[run] task %s → %s (agent %s, log "
                   ".codegraph/agents/%s-%s.log)\n", id, cfg.driver, agent,
                   tfeat, id);
            fflush(stdout);
            free(id);
            free(feat);
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
