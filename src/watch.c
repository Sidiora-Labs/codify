/*
 * File watcher with debounced auto-sync. Platform layer:
 *   Linux   — inotify (implemented below)
 *   macOS   — FSEvents (stub: build target not compiled on this platform yet)
 *   Windows — ReadDirectoryChangesW (stub)
 * Events settle for `debounce_ms` before an incremental sync runs, so a
 * save-storm (branch switch, format-on-save across files) syncs once.
 */
#include "cg.h"
#include "watch_health.h"

#ifdef __linux__
#include <sys/inotify.h>
#include <poll.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/stat.h>
#include <errno.h>

typedef struct { int wd; char *rel; } Watch;
typedef struct {
    int fd;
    Watch *v;
    int n, cap;
    Ignore ig;
    const char *root;
    const Cg *cg;
    bool bad;
} Watcher;

#define IN_MASK (IN_CREATE | IN_CLOSE_WRITE | IN_DELETE | IN_MOVED_FROM | \
                 IN_MOVED_TO | IN_DELETE_SELF | IN_MOVE_SELF)

static void watch_loss(Watcher *w, const char *reason) {
    w->bad = true;
    if (!watch_health_mark(w->cg, reason))
        fprintf(stderr, "cg watch: unable to persist %s reconciliation debt\n", reason);
    fprintf(stderr, "cg watch: coverage degraded (%s); full reconciliation pending\n", reason);
}

static void watch_add_dir(Watcher *w, const char *rel) {
    static bool injected_registration_failure;
    const char *fail_rel = getenv("CG_WATCH_TEST_REG_FAIL_ONCE");
    if (!injected_registration_failure && fail_rel &&
        strcmp(fail_rel, rel) == 0) {
        injected_registration_failure = true;
        watch_loss(w, "registration_error");
        return;
    }
    char abs[4900];
    snprintf(abs, sizeof abs, "%s/%s", w->root, rel[0] ? rel : ".");
    int wd = inotify_add_watch(w->fd, abs, IN_MASK);
    if (wd < 0) { watch_loss(w, "registration_error"); return; }
    bool known = false;
    for (int i = 0; i < w->n; i++) {
        if (w->v[i].wd != wd) continue;
        if (strcmp(w->v[i].rel, rel) != 0) {
            free(w->v[i].rel);
            w->v[i].rel = xstrdup(rel);
        }
        known = true;
        break;
    }
    if (!known && w->n == w->cap) {
        w->cap = w->cap ? w->cap * 2 : 64;
        w->v = xrealloc(w->v, sizeof(Watch) * (size_t)w->cap);
    }
    if (!known) {
        w->v[w->n].wd = wd;
        w->v[w->n].rel = xstrdup(rel);
        w->n++;
    }

    DIR *d = opendir(abs);
    if (!d) { watch_loss(w, "registration_error"); return; }
    struct dirent *e;
    while ((e = readdir(d))) {
        if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0)
            continue;
        char crel[4096];
        if (rel[0]) snprintf(crel, sizeof crel, "%s/%s", rel, e->d_name);
        else        snprintf(crel, sizeof crel, "%s", e->d_name);
        char cabs[4900];
        snprintf(cabs, sizeof cabs, "%s/%s", w->root, crel);
        struct stat st;
        if (lstat(cabs, &st) != 0 || !S_ISDIR(st.st_mode)) continue;
        if (ignore_match(&w->ig, crel, true)) continue;
        watch_add_dir(w, crel);
    }
    closedir(d);
}

static void watch_forget(Watcher *w, int wd) {
    for (int i = 0; i < w->n; i++) {
        if (w->v[i].wd != wd) continue;
        free(w->v[i].rel);
        memmove(&w->v[i], &w->v[i + 1],
                sizeof *w->v * (size_t)(w->n - i - 1));
        w->n--;
        return;
    }
}

static const char *wd_rel(Watcher *w, int wd) {
    for (int i = 0; i < w->n; i++)
        if (w->v[i].wd == wd) return w->v[i].rel;
    return NULL;
}

/* Paths that changed since the last pass. The watcher knows exactly what
 * moved, so the pass walks only that; past WATCH_MAX_TARGETS distinct paths
 * (a branch switch, a formatter over the tree) walking everything is the
 * cheaper plan, and `whole` says so. */
#define WATCH_MAX_TARGETS 256
typedef struct { char **v; int n; bool whole; } Pending;

static void pending_add(Pending *p, const char *rel) {
    if (p->whole) return;
    for (int i = 0; i < p->n; i++)
        if (strcmp(p->v[i], rel) == 0) return;
    if (p->n >= WATCH_MAX_TARGETS) { p->whole = true; return; }
    p->v = xrealloc(p->v, sizeof *p->v * (size_t)(p->n + 1));
    p->v[p->n++] = xstrdup(rel);
}

static void pending_clear(Pending *p) {
    for (int i = 0; i < p->n; i++) free(p->v[i]);
    free(p->v);
    p->v = NULL;
    p->n = 0;
    p->whole = false;
}

/* Drain the inotify queue into the pending set. Returns true when at least
 * one path landed, so the caller knows to restart its debounce. */
static bool watch_drain(Watcher *w, Pending *pend) {
    char buf[16384];
    ssize_t len;
    bool any = false;
    while ((len = read(w->fd, buf, sizeof buf)) > 0) {
        ssize_t off = 0;
        while (off < len) {
            struct inotify_event *e = (struct inotify_event *)(buf + off);
            off += (ssize_t)sizeof(*e) + e->len;
            if (e->mask & IN_Q_OVERFLOW) {
                watch_loss(w, "queue_overflow");
                pend->whole = any = true;
                continue;
            }
            const char *dir = wd_rel(w, e->wd);
            if (e->mask & (IN_IGNORED | IN_DELETE_SELF | IN_MOVE_SELF)) {
                bool root = dir && dir[0] == '\0';
                watch_loss(w, root ? "root_loss" : "directory_loss");
                pend->whole = any = true;
                if (e->mask & IN_IGNORED) watch_forget(w, e->wd);
                else inotify_rm_watch(w->fd, e->wd);
                continue;
            }
            if (!dir || e->len == 0) continue;
            char crel[4096];
            if (dir[0]) snprintf(crel, sizeof crel, "%s/%s", dir, e->name);
            else        snprintf(crel, sizeof crel, "%s", e->name);
            if (ignore_match(&w->ig, crel, (e->mask & IN_ISDIR) != 0))
                continue;
            if ((e->mask & IN_ISDIR) && (e->mask & (IN_CREATE | IN_MOVED_TO)))
                watch_add_dir(w, crel);
            pending_add(pend, crel);
            any = true;
        }
    }
    if (len < 0 && errno != EAGAIN && errno != EINTR) {
        watch_loss(w, "read_error");
        pend->whole = any = true;
    }
    return any;
}

#define WATCH_RECONCILE_MS 30000
static int watch_sync(Cg *cg, const SysInfo *si, const Pending *p,
                      IndexStats *st);
static long watch_interval(void) {
    const char *env = getenv("CG_WATCH_POLL_MS");
    if (env && *env) {
        char *end = NULL;
        long v = strtol(env, &end, 10);
        if (end && !*end && v >= 100 && v <= 300000) return v;
    }
    return WATCH_RECONCILE_MS;
}

static void watch_rearm(Watcher *w, Pending *pend) {
    w->bad = false;
    if (w->fd < 0) w->fd = inotify_init1(IN_NONBLOCK);
    watch_add_dir(w, "");
    WatchHealth health;
    if (watch_health_read(w->cg, &health) && health.pending) pend->whole = true;
}

static bool watch_attempt(Cg *cg, const SysInfo *si, Watcher *w,
                          Pending *pend, IndexStats *st) {
    static bool injected_sync_failure;
    if (!injected_sync_failure && getenv("CG_WATCH_TEST_SYNC_FAIL_ONCE")) {
        injected_sync_failure = true;
        memset(st, 0, sizeof *st);
        watch_loss(w, "sync_error");
        pend->whole = true;
        return false;
    }
    struct stat root_st;
    if (stat(cg->root, &root_st) != 0 || !S_ISDIR(root_st.st_mode)) {
        watch_loss(w, "root_loss");
        pend->whole = true;
        memset(st, 0, sizeof *st);
        return false;
    }
    WatchHealth before = {0};
    if (!watch_health_read(cg, &before)) {
        watch_loss(w, "health_io_error");
        pend->whole = true;
    }
    if (before.pending) pend->whole = true;
    bool whole = pend->whole || pend->n == 0;
    int rc = watch_sync(cg, si, pend, st);
    if (rc != 0 || st->coalesced) {
        if (rc != 0) watch_loss(w, "sync_error");
        else watch_loss(w, "coalesced_pass");
        pend->whole = true;
        return false;
    }
    if (whole && before.pending &&
        (!st->walk || strcmp(st->walk, "full") != 0)) {
        watch_loss(w, "incomplete_walk");
        pend->whole = true;
        return false;
    }
    if (whole && !w->bad && before.pending &&
        watch_health_clear_if(cg, before.generation)) {
        printf("cg watch: coverage recovered after full reconciliation\n");
        fflush(stdout);
    }
    return true;
}

/* One background pass over the pending paths (or the tree). The gate is
 * never waited on: a pass another process is running gets the note and
 * drains it, which is the same outcome a second walk would have bought. */
static int watch_sync(Cg *cg, const SysInfo *si, const Pending *p,
                      IndexStats *st) {
    IndexOpts o = {0};
    o.background = true;
    o.lock_wait_ms = 0;
    o.quiet = true;
    o.force_walk = p->whole;
    if (!p->whole && p->n > 0) {
        o.paths = (const char *const *)p->v;
        o.npaths = p->n;
    }
    return cg_index_ex(cg, si, &o, st);
}

/* With [sync] auto off a watcher has nothing to do; saying so and exiting
 * beats idling silently while the graph goes stale. */
static bool watch_auto_off(const char *root) {
    if (config_auto_sync(root)) return false;
    fprintf(stderr, "cg watch: auto-sync is off ([sync] auto = false in "
                    "%s) — not watching; run `cg sync` after edits\n",
            config_load(root)->file);
    return true;
}

int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {
    if (watch_auto_off(cg->root)) return 0;
    Watcher w;
    memset(&w, 0, sizeof w);
    w.root = cg->root;
    w.cg = cg;
    w.fd = inotify_init1(IN_NONBLOCK);
    if (w.fd < 0) {
        watch_loss(&w, "registration_error");
        fprintf(stderr, "cg watch: using periodic filesystem reconciliation\n");
    }
    ignore_load(&w.ig, cg->root);
    watch_add_dir(&w, "");
    /* Deterministic fault injection for the integration suite. */
    const char *inject = getenv("CG_WATCH_TEST_EVENT");
    if (inject && (!strcmp(inject, "queue_overflow") ||
                   !strcmp(inject, "registration_error") ||
                   !strcmp(inject, "root_loss")))
        watch_loss(&w, inject);
    printf("watching %s (%d dirs, debounce %dms, background passes) — "
           "ctrl-c to stop\n", cg->root, w.n, debounce_ms);

    /* A watcher lives as long as the LSP does and must yield the same way:
     * short lock wait, and a busy database turns into a retry after the
     * debounce instead of a stall or an exit. */
    cg->lock_wait_ms = 2000;
    bool pending = false;
    long deadline = 0;
    Pending pend = {0};

    /* catch up on anything that changed while we weren't looking */
    IndexStats st;
    pend.whole = true;
    if (!watch_attempt(cg, si, &w, &pend, &st)) {
        printf("sync deferred: retrying in %dms\n", debounce_ms);
        pending = true;
        deadline = now_ms() + debounce_ms;
    } else {
        pending_clear(&pend);
        if (st.files_indexed || st.files_removed)
            printf("sync: %ld updated, %ld removed (%ldms)\n",
                   st.files_indexed, st.files_removed, st.ms);
    }
    long proj_at = 0;                   /* codify-v15 3.3: a held-back build */
    long next_reconcile = now_ms() + watch_interval();
    for (;;) {
        long until = next_reconcile - now_ms();
        int timeout = until > 0 ? (int)until : 0;
        if (pending) {
            long left = deadline - now_ms();
            int wait = left > 0 ? (int)left : 0;
            if (wait < timeout) timeout = wait;
        }
        if (proj_at) {
            long left = proj_at - now_ms();
            if (left < 0) left = 0;
            if (timeout < 0 || left < timeout) timeout = (int)left;
        }
        struct pollfd pfd = { .fd = w.fd, .events = POLLIN };
        int pr = poll(&pfd, 1, timeout);
        if (pr < 0 && errno != EINTR) {
            watch_loss(&w, "poll_error");
            pend.whole = pending = true;
            deadline = now_ms();
        }
        if (pr > 0 && (pfd.revents & (POLLERR | POLLHUP | POLLNVAL))) {
            watch_loss(&w, "poll_error");
            pend.whole = pending = true;
            deadline = now_ms() + debounce_ms;
        }
        if (pr > 0 && (pfd.revents & POLLIN) && watch_drain(&w, &pend)) {
            pending = true;
            deadline = now_ms() + debounce_ms;
        }
        if (now_ms() >= next_reconcile) {
            watch_rearm(&w, &pend);
            pend.whole = pending = true;
            deadline = now_ms();
            next_reconcile = now_ms() + watch_interval();
        }
        if (pending && now_ms() >= deadline) {
            pending = false;
            if (!watch_attempt(cg, si, &w, &pend, &st)) {
                printf("sync deferred: retrying in %dms\n",
                       debounce_ms);
                pending = true;                 /* keeps its paths */
                deadline = now_ms() + debounce_ms;
            } else {
                pending_clear(&pend);
                if (st.coalesced)
                    printf("sync: handed to the cg process already indexing\n");
                else if (st.files_indexed || st.files_removed)
                    printf("sync: %ld updated, %ld removed, %ld symbols (%ldms)\n",
                           st.files_indexed, st.files_removed, st.symbols,
                           st.ms);
                if (st.files_indexed || st.files_removed) {
                    projection_mark_dirty(cg, "watch");
                    proj_at = now_ms();
                }
            }
        }
        if (proj_at && now_ms() >= proj_at) {
            long retry = 0;
            proj_at = projection_auto_build(cg, "watch", &retry) < 0
                      ? now_ms() + retry : 0;
        }
    }
}

/* ---------------- fleet watch ---------------- */

/* One tree a fleet watch follows: its own inotify fd and pending set, and
 * its own view of the graph — same database handle, different root and
 * branch, so a pass writes under the branch that tree is on. */
typedef struct {
    Cg cg;
    Watcher w;
    Pending pend;
    bool armed, live;
    long deadline;
    long next_reconcile;
    long id;
} FleetWatch;

/* how often the branches registry is re-read for worktrees that joined or
 * went away — cheap enough to be invisible, quick enough that a worktree
 * added by `cg fleet begin` is followed seconds later */
#define FLEET_POLL_MS 3000

static FleetWatch *fleet_watch_open(const Cg *parent, long id,
                                    const char *name, const char *root) {
    struct stat sb;
    if (stat(root, &sb) != 0 || !S_ISDIR(sb.st_mode)) return NULL;
    FleetWatch *f = xmalloc(sizeof *f);
    memset(f, 0, sizeof *f);
    f->cg = *parent;
    snprintf(f->cg.root, sizeof f->cg.root, "%s", root);
    snprintf(f->cg.branch, sizeof f->cg.branch, "%s", name);
    f->cg.branch_id = id;
    f->cg.worktree = strcmp(f->cg.root, f->cg.shared) != 0;
    f->cg.scope_branch = 0;
    f->id = id;
    f->w.fd = inotify_init1(IN_NONBLOCK);
    f->w.root = f->cg.root;     /* stable: entries are never moved */
    f->w.cg = &f->cg;
    if (f->w.fd < 0) watch_loss(&f->w, "registration_error");
    ignore_load(&f->w.ig, f->cg.root);
    watch_add_dir(&f->w, "");
    /* a tree just picked up is caught up once, whole */
    f->pend.whole = true;
    f->armed = true;
    f->deadline = now_ms();
    f->next_reconcile = now_ms() + watch_interval();
    return f;
}

static void fleet_watch_close(FleetWatch *f) {
    if (f->w.fd >= 0) close(f->w.fd);
    for (int i = 0; i < f->w.n; i++) free(f->w.v[i].rel);
    free(f->w.v);
    ignore_free(&f->w.ig);
    pending_clear(&f->pend);
    free(f);
}

/* Re-read the registry: follow every branch whose worktree is still on
 * disk, drop the ones that are not. The registry is the only discovery
 * mechanism — no process is spawned per branch, and a worktree that
 * disappears takes its watch with it instead of leaving one behind. */
static void fleet_scan(Cg *cg, FleetWatch ***pv, int *pn) {
    FleetWatch **v = *pv;
    int n = *pn;
    for (int i = 0; i < n; i++) v[i]->live = false;
    sqlite3_stmt *st = cg_prep(cg,
        "SELECT id,name,ifnull(worktree,'') FROM branches "
        "WHERE ifnull(worktree,'')<>'' ORDER BY id");
    while (sqlite3_step(st) == SQLITE_ROW) {
        long id = (long)sqlite3_column_int64(st, 0);
        const char *name = (const char *)sqlite3_column_text(st, 1);
        const char *root = (const char *)sqlite3_column_text(st, 2);
        if (!name || !root || !root[0]) continue;
        int at = -1;
        for (int i = 0; i < n; i++)
            if (v[i]->id == id) { at = i; break; }
        if (at >= 0) {
            /* the same branch checked out somewhere else: follow the move */
            if (strcmp(v[at]->cg.root, root) != 0) {
                fleet_watch_close(v[at]);
                v[at] = NULL;
            } else {
                v[at]->live = true;
                continue;
            }
        }
        FleetWatch *f = fleet_watch_open(cg, id, name, root);
        if (!f) { if (at >= 0) { memmove(&v[at], &v[at + 1],
                                        sizeof *v * (size_t)(n - at - 1)); n--; }
                  continue; }
        f->live = true;
        if (at >= 0) {
            v[at] = f;
        } else {
            v = xrealloc(v, sizeof *v * (size_t)(n + 1));
            v[n++] = f;
        }
        printf("following %s at %s\n", name, root);
    }
    sqlite3_finalize(st);
    for (int i = 0; i < n; ) {
        struct stat sb;
        bool gone = !v[i]->live || stat(v[i]->cg.root, &sb) != 0 ||
                    !S_ISDIR(sb.st_mode);
        if (!gone) { i++; continue; }
        if (v[i]->live) watch_loss(&v[i]->w, "root_loss");
        printf("dropped %s (%s is gone)\n", v[i]->cg.branch, v[i]->cg.root);
        fleet_watch_close(v[i]);
        memmove(&v[i], &v[i + 1], sizeof *v * (size_t)(n - i - 1));
        n--;
    }
    *pv = v;
    *pn = n;
}

/* `cg watch --fleet`: one process for every worktree the graph knows about,
 * instead of one watcher per agent. Each tree keeps its own debounce and
 * syncs under its own branch, so a save on one never walks another. */
int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms) {
    FleetWatch **v = NULL;
    int n = 0;
    struct pollfd *pfd = NULL;
    long next_scan = 0;
    if (watch_auto_off(cg->root)) return 0;
    cg->lock_wait_ms = 2000;
    printf("watching every worktree of %s (debounce %dms, background passes) "
           "— ctrl-c to stop\n", cg->shared, debounce_ms);
    fflush(stdout);
    long proj_at = 0;                   /* codify-v15 3.3: a held-back build */
    for (;;) {
        if (now_ms() >= next_scan) {
            native_discover_auto(cg);           /* codify-v15 2.4 */
            fleet_scan(cg, &v, &n);
            next_scan = now_ms() + FLEET_POLL_MS;
            fflush(stdout);
        }
        long until = next_scan;
        for (int i = 0; i < n; i++)
            if (v[i]->armed && v[i]->deadline < until) until = v[i]->deadline;
        for (int i = 0; i < n; i++)
            if (v[i]->next_reconcile < until) until = v[i]->next_reconcile;
        if (proj_at && proj_at < until) until = proj_at;
        long left = until - now_ms();
        int timeout = left > 0 ? (int)left : 0;

        if (n > 0) {
            pfd = xrealloc(pfd, sizeof *pfd * (size_t)n);
            for (int i = 0; i < n; i++) {
                pfd[i].fd = v[i]->w.fd;
                pfd[i].events = POLLIN;
                pfd[i].revents = 0;
            }
        }
        int pr = poll(n > 0 ? pfd : NULL, (nfds_t)n, timeout);
        if (pr < 0 && errno != EINTR)
            for (int i = 0; i < n; i++) {
                watch_loss(&v[i]->w, "poll_error");
                v[i]->pend.whole = v[i]->armed = true;
                v[i]->deadline = now_ms() + debounce_ms;
            }
        if (pr > 0) {
            for (int i = 0; i < n; i++) {
                if (pfd[i].revents & (POLLERR | POLLHUP | POLLNVAL)) {
                    watch_loss(&v[i]->w, "poll_error");
                    v[i]->pend.whole = v[i]->armed = true;
                    v[i]->deadline = now_ms() + debounce_ms;
                } else if ((pfd[i].revents & POLLIN) &&
                    watch_drain(&v[i]->w, &v[i]->pend)) {
                    v[i]->armed = true;
                    v[i]->deadline = now_ms() + debounce_ms;
                }
            }
        }

        for (int i = 0; i < n; i++) {
            if (now_ms() < v[i]->next_reconcile) continue;
            watch_rearm(&v[i]->w, &v[i]->pend);
            v[i]->pend.whole = v[i]->armed = true;
            v[i]->deadline = now_ms();
            v[i]->next_reconcile = now_ms() + watch_interval();
        }

        for (int i = 0; i < n; i++) {
            if (!v[i]->armed || now_ms() < v[i]->deadline) continue;
            v[i]->armed = false;
            /* each worktree carries its own codify.kvx */
            if (!config_auto_sync(v[i]->cg.root)) {
                pending_clear(&v[i]->pend);
                continue;
            }
            IndexStats st;
            if (!watch_attempt(&v[i]->cg, si, &v[i]->w, &v[i]->pend, &st)) {
                v[i]->armed = true;             /* keeps its paths */
                v[i]->deadline = now_ms() + debounce_ms;
                continue;
            }
            pending_clear(&v[i]->pend);
            if (st.coalesced)
                printf("%s: handed to the cg process already indexing\n",
                       v[i]->cg.branch);
            else if (st.files_indexed || st.files_removed)
                printf("%s: %ld updated (%ld reused), %ld removed (%ldms)\n",
                       v[i]->cg.branch, st.files_indexed, st.files_reused,
                       st.files_removed, st.ms);
            if (st.files_indexed || st.files_removed) {
                projection_mark_dirty(cg, "watch --fleet");
                proj_at = now_ms();
            }
            fflush(stdout);
        }
        if (proj_at && now_ms() >= proj_at) {
            long retry = 0;
            proj_at = projection_auto_build(cg, "watch --fleet", &retry) < 0
                      ? now_ms() + retry : 0;
        }
    }
}

#else  /* !__linux__ */
#include <time.h>

static void portable_pause(int ms) {
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}

static void portable_sync(Cg *cg, const SysInfo *si) {
    WatchHealth before = {0};
    watch_health_read(cg, &before);
    IndexOpts opts = {0};
    IndexStats stats = {0};
    opts.background = true;
    opts.quiet = true;
    opts.lock_wait_ms = 0;
    opts.force_walk = true;
    if (cg_index_ex(cg, si, &opts, &stats) != 0 || stats.coalesced) {
        watch_health_mark(cg, "sync_error");
        return;
    }
    if (before.pending) watch_health_clear_if(cg, before.generation);
}

int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms) {
    if (!config_auto_sync(cg->root)) return 0;
    int interval = debounce_ms > 3000 ? debounce_ms : 3000;
    fprintf(stderr, "cg watch --fleet: periodic filesystem reconciliation every %dms\n",
            interval);
    for (;;) {
        sqlite3_stmt *st = cg_prep(cg,
            "SELECT id,name,worktree FROM branches WHERE worktree IS NOT NULL");
        while (sqlite3_step(st) == SQLITE_ROW) {
            const char *root = (const char *)sqlite3_column_text(st, 2);
            if (!root || !root[0]) continue;
            Cg tree = *cg;
            snprintf(tree.root, sizeof tree.root, "%s", root);
            snprintf(tree.branch, sizeof tree.branch, "%s",
                     (const char *)sqlite3_column_text(st, 1));
            tree.branch_id = sqlite3_column_int64(st, 0);
            tree.worktree = strcmp(tree.root, tree.shared) != 0;
            if (config_auto_sync(tree.root)) portable_sync(&tree, si);
        }
        sqlite3_finalize(st);
        portable_pause(interval);
    }
}

int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {
    if (!config_auto_sync(cg->root)) return 0;
    int interval = debounce_ms > 3000 ? debounce_ms : 3000;
    fprintf(stderr, "cg watch: periodic filesystem reconciliation every %dms\n",
            interval);
    for (;;) { portable_sync(cg, si); portable_pause(interval); }
}

#endif
