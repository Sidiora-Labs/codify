/* cg serve — one long-lived connection for an editor or supervisor UI.
 *
 * Newline-delimited JSON-RPC 2.0 over stdio:
 *   initialize                      protocol, project, event head
 *   tools/list, tools/call          every MCP tool (the same table)
 *   exec {args:[...]}               any cg command, as the CLI runs it
 *   cancel {id}                     stop an in-flight tools/call or exec
 *   subscribe {since?, kinds?}      push "events" notifications from seq
 *   unsubscribe {subscription}, ping, shutdown
 *
 * Every call runs in a child process (this binary, re-executed), so a
 * verify_cmd that takes minutes never holds up an event push, several calls
 * run at once, and a cancel is a signal to one process group. The server's
 * own connection only reads the event log; idle, it holds no lock and runs
 * no index pass. It wakes on writes to the database files (inotify on
 * Linux; a short poll elsewhere) and reads events_since each subscriber's
 * cursor, so an event reaches the client within milliseconds of its commit
 * rather than on the next poll of some command's output. */
#include "cg.h"
#include <errno.h>
#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>
#ifdef __linux__
#include <sys/inotify.h>
#endif

#define SERVE_PROTOCOL  "codify-serve/1"
#define SERVE_MAX_JOBS  32
#define SERVE_MAX_SUBS  16
#define SERVE_BATCH     500
#define SERVE_POLL_MS   150     /* change check without inotify */
#define SERVE_SAFETY_MS 1000    /* re-check even with inotify */
#define SERVE_MIN_GAP_MS 15     /* coalesce a burst of WAL writes */
#define SERVE_OUT_CAP   (16L << 20)

typedef struct {
    long id, cursor;
    char *kinds;
} Sub;

typedef struct {
    bool live, tool, cancelled, out_eof, err_eof, truncated;
    pid_t pid;
    int out, err;
    StrBuf ob, eb;
    char *rpc_id;             /* raw JSON id of the request */
    char *tool_name;
} Job;

static char g_self[4096];
static bool g_broken;         /* the client went away */

static long mono_ms(void) {
    struct timespec ts;
    clock_gettime(CLOCK_MONOTONIC, &ts);
    return (long)ts.tv_sec * 1000 + ts.tv_nsec / 1000000;
}

static void send_raw(const char *p, size_t n) {
    while (n && !g_broken) {
        ssize_t w = write(STDOUT_FILENO, p, n);
        if (w < 0) {
            if (errno == EINTR) continue;
            if (errno == EAGAIN) {
                struct pollfd pf = { STDOUT_FILENO, POLLOUT, 0 };
                poll(&pf, 1, 1000);
                continue;
            }
            g_broken = true;
            return;
        }
        p += w;
        n -= (size_t)w;
    }
}

static void send_msg(StrBuf *b) {
    sb_putc(b, '\n');
    send_raw(b->p, b->len);
    sb_free(b);
}

static void reply(const char *id, const char *result) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"id\":%s,\"result\":%s}", id, result);
    send_msg(&b);
}

static void reply_err(const char *id, int code, const char *msg) {
    StrBuf b; sb_init(&b);
    sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"id\":%s,\"error\":{\"code\":%d,"
                  "\"message\":", id, code);
    sb_json_str(&b, msg);
    sb_puts(&b, "}}");
    send_msg(&b);
}

/* ---------------- child calls ---------------- */

static void set_nonblock(int fd) {
    int fl = fcntl(fd, F_GETFL);
    if (fl >= 0) fcntl(fd, F_SETFL, fl | O_NONBLOCK);
}

static int job_spawn(Job *jobs, const Cg *cg, char **argv, const char *id,
                     bool tool, const char *tool_name) {
    int slot = -1;
    for (int i = 0; i < SERVE_MAX_JOBS; i++)
        if (!jobs[i].live) { slot = i; break; }
    if (slot < 0) return -2;
    int po[2], pe[2];
    if (pipe(po) != 0) return -1;
    if (pipe(pe) != 0) { close(po[0]); close(po[1]); return -1; }
    pid_t pid = fork();
    if (pid < 0) {
        close(po[0]); close(po[1]); close(pe[0]); close(pe[1]);
        return -1;
    }
    if (pid == 0) {
        setpgid(0, 0);
        int devnull = open("/dev/null", O_RDONLY);
        if (devnull >= 0) { dup2(devnull, STDIN_FILENO); close(devnull); }
        dup2(po[1], STDOUT_FILENO);
        dup2(pe[1], STDERR_FILENO);
        close(po[0]); close(po[1]); close(pe[0]); close(pe[1]);
        signal(SIGPIPE, SIG_DFL);
        if (chdir(cg->root) != 0) _exit(126);
        execv(g_self, argv);
        _exit(127);
    }
    setpgid(pid, pid);
    close(po[1]); close(pe[1]);
    set_nonblock(po[0]); set_nonblock(pe[0]);
    Job *j = &jobs[slot];
    memset(j, 0, sizeof *j);
    j->live = true;
    j->tool = tool;
    j->pid = pid;
    j->out = po[0];
    j->err = pe[0];
    sb_init(&j->ob); sb_init(&j->eb);
    j->rpc_id = xstrdup(id);
    j->tool_name = tool_name ? xstrdup(tool_name) : NULL;
    return slot;
}

/* read what is there; true at EOF */
static bool job_drain(Job *j, int fd, StrBuf *b) {
    char buf[8192];
    for (;;) {
        ssize_t n = read(fd, buf, sizeof buf);
        if (n > 0) {
            if ((long)b->len + n <= SERVE_OUT_CAP) {
                for (ssize_t i = 0; i < n; i++) sb_putc(b, buf[i]);
            } else j->truncated = true;
            continue;
        }
        if (n == 0) return true;
        if (errno == EINTR) continue;
        return false;             /* EAGAIN: more later */
    }
}

static void job_finish(Job *j, int status) {
    int code = WIFEXITED(status) ? WEXITSTATUS(status)
                                 : 128 + WTERMSIG(status);
    StrBuf r; sb_init(&r);
    if (j->tool && code == 2 && strstr(j->eb.p ? j->eb.p : "", "unknown tool")) {
        reply_err(j->rpc_id, -32602, "unknown tool");
    } else if (j->tool) {
        sb_puts(&r, "{\"content\":[{\"type\":\"text\",\"text\":");
        sb_json_str(&r, j->ob.p ? j->ob.p : "");
        sb_printf(&r, "}],\"isError\":%s,\"exit\":%d,\"stderr\":",
                  code == 0 ? "false" : "true", code);
        sb_json_str(&r, j->eb.p ? j->eb.p : "");
        sb_printf(&r, ",\"cancelled\":%s,\"truncated\":%s}",
                  j->cancelled ? "true" : "false",
                  j->truncated ? "true" : "false");
        reply(j->rpc_id, r.p);
    } else {
        sb_printf(&r, "{\"exit\":%d,\"stdout\":", code);
        sb_json_str(&r, j->ob.p ? j->ob.p : "");
        sb_puts(&r, ",\"stderr\":");
        sb_json_str(&r, j->eb.p ? j->eb.p : "");
        sb_printf(&r, ",\"cancelled\":%s,\"truncated\":%s}",
                  j->cancelled ? "true" : "false",
                  j->truncated ? "true" : "false");
        reply(j->rpc_id, r.p);
    }
    sb_free(&r);
    close(j->out); close(j->err);
    sb_free(&j->ob); sb_free(&j->eb);
    free(j->rpc_id); free(j->tool_name);
    memset(j, 0, sizeof *j);
}

/* ---------------- subscriptions ---------------- */

typedef struct { StrBuf *b; int n; long last; } Batch;

static int batch_add(const EventRow *e, void *ud) {
    Batch *bt = ud;
    if (bt->n++) sb_putc(bt->b, ',');
    events_json(bt->b, e);
    bt->last = e->seq;
    return 0;
}

static void serve_push(Cg *cg, Sub *s) {
    long floor = events_pruned_through(cg);
    if (s->cursor < floor) {
        StrBuf g; sb_init(&g);
        sb_printf(&g, "{\"jsonrpc\":\"2.0\",\"method\":\"events/gap\","
                      "\"params\":{\"subscription\":%ld,\"cursor\":%ld,"
                      "\"pruned_through\":%ld}}", s->id, s->cursor, floor);
        send_msg(&g);
        s->cursor = floor;
    }
    for (;;) {
        /* Head is read before the query: every matching row up to it is in
         * this batch unless the batch is full, so the cursor may then skip
         * past rows a kind filter left out — a quiet filter must not rescan
         * the log on every wake. Read after, it could skip a row committed
         * in between. */
        long head0 = events_head(cg);
        StrBuf b; sb_init(&b);
        sb_printf(&b, "{\"jsonrpc\":\"2.0\",\"method\":\"events\",\"params\":"
                      "{\"subscription\":%ld,\"events\":[", s->id);
        Batch bt = { &b, 0, s->cursor };
        events_since(cg, s->cursor, s->kinds, SERVE_BATCH, batch_add, &bt);
        if (bt.n) {
            sb_printf(&b, "],\"cursor\":%ld}}", bt.last);
            send_msg(&b);
        } else {
            sb_free(&b);
        }
        if (bt.n == SERVE_BATCH) { s->cursor = bt.last; continue; }
        s->cursor = bt.last > head0 ? bt.last : (head0 > s->cursor ? head0 : s->cursor);
        return;
    }
}

/* ---------------- requests ---------------- */

typedef struct {
    Cg *cg;
    Job *jobs;
    Sub subs[SERVE_MAX_SUBS];
    int nsubs;
    long next_sub;
    bool shutdown;
} Server;

static char *raw_or(const char *obj, const char *key) {
    return obj ? json_get_raw(obj, key) : NULL;
}

static void serve_dispatch(Server *sv, const char *line) {
    char *method = json_get_string(line, "method");
    char *id = json_get_raw(line, "id");
    if (!method) {
        if (id) reply_err(id, -32600, "invalid request");
        free(id);
        return;
    }
    char *params = json_get_object(line, "params");
    Cg *cg = sv->cg;

    if (!id) {
        /* notifications need no answer; none change server state today */
    } else if (strcmp(method, "initialize") == 0) {
        StrBuf r; sb_init(&r);
        sb_puts(&r, "{\"protocol\":\"" SERVE_PROTOCOL "\",\"server\":"
                    "{\"name\":\"codify\",\"version\":\"" CG_VERSION "\"},"
                    "\"root\":");
        sb_json_str(&r, cg->root);
        sb_puts(&r, ",\"shared\":"); sb_json_str(&r, cg->shared);
        sb_puts(&r, ",\"branch\":"); sb_json_str(&r, cg->branch);
        sb_printf(&r, ",\"head\":%ld,\"pruned_through\":%ld,\"capabilities\":"
                      "{\"tools\":true,\"exec\":true,\"events\":true,"
                      "\"cancel\":true,\"maxInFlight\":%d}}",
                  events_head(cg), events_pruned_through(cg), SERVE_MAX_JOBS);
        reply(id, r.p);
        sb_free(&r);
    } else if (strcmp(method, "tools/list") == 0) {
        StrBuf r; sb_init(&r);
        mcp_tools_json(&r);
        reply(id, r.p);
        sb_free(&r);
    } else if (strcmp(method, "tools/call") == 0) {
        char *name = params ? json_get_string(params, "name") : NULL;
        char *args = params ? json_get_object(params, "arguments") : NULL;
        if (!name) reply_err(id, -32602, "tools/call needs params.name");
        else {
            char *argv[] = { g_self, (char *)"tool", (char *)"call", name,
                             args ? args : (char *)"{}", NULL };
            int s = job_spawn(sv->jobs, cg, argv, id, true, name);
            if (s == -2) reply_err(id, -32000, "too many calls in flight");
            else if (s < 0) reply_err(id, -32603, "cannot start the call");
        }
        free(name); free(args);
    } else if (strcmp(method, "exec") == 0) {
        char *arr = raw_or(params, "args");
        char **items = NULL;
        int n = arr ? json_array_items(arr, &items) : 0;
        char **argv = xmalloc(sizeof(char *) * (size_t)(n + 2));
        argv[0] = g_self;
        int ok = n > 0;
        for (int i = 0; i < n; i++) {
            argv[i + 1] = json_string_value(items[i]);
            if (!argv[i + 1]) ok = 0;
        }
        argv[n + 1] = NULL;
        if (!ok) reply_err(id, -32602, "exec needs params.args: [strings]");
        else {
            int s = job_spawn(sv->jobs, cg, argv, id, false, NULL);
            if (s == -2) reply_err(id, -32000, "too many calls in flight");
            else if (s < 0) reply_err(id, -32603, "cannot start the command");
        }
        for (int i = 0; i < n; i++) { free(items[i]); free(argv[i + 1]); }
        free(items); free(argv); free(arr);
    } else if (strcmp(method, "cancel") == 0) {
        char *target = raw_or(params, "id");
        bool hit = false;
        for (int i = 0; target && i < SERVE_MAX_JOBS; i++) {
            Job *j = &sv->jobs[i];
            if (!j->live || strcmp(j->rpc_id, target) != 0) continue;
            j->cancelled = true;
            if (kill(-j->pid, SIGTERM) != 0) kill(j->pid, SIGTERM);
            hit = true;
        }
        reply(id, hit ? "{\"cancelled\":true}" : "{\"cancelled\":false}");
        free(target);
    } else if (strcmp(method, "subscribe") == 0) {
        if (sv->nsubs >= SERVE_MAX_SUBS) {
            reply_err(id, -32000, "too many subscriptions");
        } else {
            long head = events_head(cg);
            Sub *s = &sv->subs[sv->nsubs++];
            s->id = ++sv->next_sub;
            s->cursor = params ? json_get_int(params, "since", head) : head;
            if (s->cursor < 0) s->cursor = 0;
            char *k = params ? json_get_string(params, "kinds") : NULL;
            s->kinds = k && k[0] ? k : NULL;
            if (k && !k[0]) free(k);
            StrBuf r; sb_init(&r);
            sb_printf(&r, "{\"subscription\":%ld,\"cursor\":%ld,\"head\":%ld}",
                      s->id, s->cursor, head);
            reply(id, r.p);
            sb_free(&r);
            serve_push(cg, s);            /* the backlog since the cursor */
        }
    } else if (strcmp(method, "unsubscribe") == 0) {
        long which = params ? json_get_int(params, "subscription", -1) : -1;
        bool hit = false;
        for (int i = 0; i < sv->nsubs; i++) {
            if (sv->subs[i].id != which) continue;
            free(sv->subs[i].kinds);
            sv->subs[i] = sv->subs[--sv->nsubs];
            hit = true;
            break;
        }
        reply(id, hit ? "{\"unsubscribed\":true}" : "{\"unsubscribed\":false}");
    } else if (strcmp(method, "ping") == 0) {
        reply(id, "{}");
    } else if (strcmp(method, "shutdown") == 0) {
        reply(id, "{}");
        sv->shutdown = true;
    } else {
        reply_err(id, -32601, "method not found");
    }
    free(params);
    free(method);
    free(id);
}

/* ---------------- loop ---------------- */

static void kill_jobs(Job *jobs) {
    for (int i = 0; i < SERVE_MAX_JOBS; i++) {
        if (!jobs[i].live) continue;
        if (kill(-jobs[i].pid, SIGTERM) != 0) kill(jobs[i].pid, SIGTERM);
    }
    for (int i = 0; i < SERVE_MAX_JOBS; i++) {
        if (!jobs[i].live) continue;
        int st;
        waitpid(jobs[i].pid, &st, 0);
        close(jobs[i].out); close(jobs[i].err);
        sb_free(&jobs[i].ob); sb_free(&jobs[i].eb);
        free(jobs[i].rpc_id); free(jobs[i].tool_name);
        jobs[i].live = false;
    }
}

int cmd_serve(Cg *cg, const SysInfo *si) {
    (void)si;
    ssize_t sn = readlink("/proc/self/exe", g_self, sizeof g_self - 1);
    if (sn > 0) g_self[sn] = 0;
    else snprintf(g_self, sizeof g_self, "cg");
    signal(SIGPIPE, SIG_IGN);

    int ino = -1;
#ifdef __linux__
    ino = inotify_init1(IN_NONBLOCK | IN_CLOEXEC);
    if (ino >= 0) {
        char dir[4600];
        snprintf(dir, sizeof dir, "%s/%s", cg->shared, CG_DIR);
        if (inotify_add_watch(ino, dir, IN_MODIFY | IN_CLOSE_WRITE |
                              IN_CREATE | IN_MOVED_TO) < 0) {
            close(ino);
            ino = -1;
        }
    }
#endif

    Job *jobs = xmalloc(sizeof(Job) * SERVE_MAX_JOBS);
    memset(jobs, 0, sizeof(Job) * SERVE_MAX_JOBS);
    Server sv;
    memset(&sv, 0, sizeof sv);
    sv.cg = cg;
    sv.jobs = jobs;

    StrBuf in; sb_init(&in);
    bool stdin_open = true;
    bool dirty = false;          /* a change is waiting to be pushed */
    long last_push = 0, last_check = mono_ms();

    for (;;) {
        bool any_job = false;
        for (int i = 0; i < SERVE_MAX_JOBS; i++) any_job |= jobs[i].live;
        /* the client closing its side ends the session once its in-flight
         * calls have answered; shutdown and a broken pipe end it at once */
        if (g_broken || sv.shutdown || (!stdin_open && !any_job)) break;
        struct pollfd pf[2 + 2 * SERVE_MAX_JOBS];
        int map[2 + 2 * SERVE_MAX_JOBS];
        int np = 0;
        if (stdin_open) {
            pf[np].fd = STDIN_FILENO; pf[np].events = POLLIN; map[np++] = -1;
        }
        if (ino >= 0) { pf[np].fd = ino; pf[np].events = POLLIN; map[np++] = -2; }
        bool reaping = false;
        for (int i = 0; i < SERVE_MAX_JOBS; i++) {
            if (!jobs[i].live) continue;
            if (!jobs[i].out_eof) { pf[np].fd = jobs[i].out; pf[np].events = POLLIN; map[np++] = i; }
            if (!jobs[i].err_eof) { pf[np].fd = jobs[i].err; pf[np].events = POLLIN; map[np++] = i; }
            if (jobs[i].out_eof && jobs[i].err_eof) reaping = true;
        }
        long now = mono_ms();
        int timeout = -1;
        if (sv.nsubs) {
            long period = ino >= 0 ? SERVE_SAFETY_MS : SERVE_POLL_MS;
            long due = last_check + period - now;
            timeout = due > 0 ? (int)due : 0;
            if (dirty) {
                long gap = last_push + SERVE_MIN_GAP_MS - now;
                if (gap < 0) gap = 0;
                if (gap < timeout) timeout = (int)gap;
            }
        }
        if (reaping && (timeout < 0 || timeout > 20)) timeout = 20;

        int pr = poll(pf, (nfds_t)np, timeout);
        if (pr < 0 && errno != EINTR) break;
        now = mono_ms();

        for (int k = 0; pr > 0 && k < np; k++) {
            if (!pf[k].revents) continue;
            if (map[k] == -1) {
                char buf[65536];
                ssize_t n = read(STDIN_FILENO, buf, sizeof buf);
                if (n > 0) {
                    for (ssize_t i = 0; i < n; i++) sb_putc(&in, buf[i]);
                } else if (n == 0 || (errno != EINTR && errno != EAGAIN)) {
                    stdin_open = false;
                }
            } else if (map[k] == -2) {
#ifdef __linux__
                char buf[4096];
                while (read(ino, buf, sizeof buf) > 0) {}
#endif
                dirty = true;
            } else {
                Job *j = &jobs[map[k]];
                if (!j->live) continue;
                if (pf[k].fd == j->out && !j->out_eof)
                    j->out_eof = job_drain(j, j->out, &j->ob);
                else if (pf[k].fd == j->err && !j->err_eof)
                    j->err_eof = job_drain(j, j->err, &j->eb);
            }
        }

        /* complete lines from the client */
        size_t start = 0;
        for (size_t i = 0; i < in.len && !sv.shutdown; i++) {
            if (in.p[i] != '\n') continue;
            in.p[i] = 0;
            const char *l = in.p + start;
            while (*l == ' ' || *l == '\t' || *l == '\r') l++;
            if (*l) serve_dispatch(&sv, l);
            start = i + 1;
        }
        if (start) {
            size_t rest = in.len - start;
            memmove(in.p, in.p + start, rest);
            in.len = rest;
            in.p[rest] = 0;
        }

        for (int i = 0; i < SERVE_MAX_JOBS; i++) {
            if (!jobs[i].live || !jobs[i].out_eof || !jobs[i].err_eof) continue;
            int st;
            if (waitpid(jobs[i].pid, &st, WNOHANG) == jobs[i].pid)
                job_finish(&jobs[i], st);
        }

        if (sv.nsubs) {
            long period = ino >= 0 ? SERVE_SAFETY_MS : SERVE_POLL_MS;
            bool due = now - last_check >= period;
            if ((dirty && now - last_push >= SERVE_MIN_GAP_MS) || due) {
                for (int i = 0; i < sv.nsubs; i++) serve_push(cg, &sv.subs[i]);
                last_push = last_check = now;
                dirty = false;
            }
        } else {
            dirty = false;
        }
    }

    kill_jobs(jobs);
    for (int i = 0; i < sv.nsubs; i++) free(sv.subs[i].kinds);
    free(jobs);
    sb_free(&in);
    if (ino >= 0) close(ino);
    return 0;
}
