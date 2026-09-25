/*
 * File watcher with debounced auto-sync. Platform layer:
 *   Linux   — inotify (implemented below)
 *   macOS   — FSEvents (stub: build target not compiled on this platform yet)
 *   Windows — ReadDirectoryChangesW (stub)
 * Events settle for `debounce_ms` before an incremental sync runs, so a
 * save-storm (branch switch, format-on-save across files) syncs once.
 */
#include "cg.h"

#ifdef __linux__
#include <sys/inotify.h>
#include <poll.h>
#include <dirent.h>
#include <unistd.h>
#include <sys/stat.h>

typedef struct { int wd; char *rel; } Watch;
typedef struct {
    int fd;
    Watch *v;
    int n, cap;
    Ignore ig;
    const char *root;
} Watcher;

#define IN_MASK (IN_CREATE | IN_CLOSE_WRITE | IN_DELETE | IN_MOVED_FROM | \
                 IN_MOVED_TO | IN_DELETE_SELF)

static void watch_add_dir(Watcher *w, const char *rel) {
    char abs[4900];
    snprintf(abs, sizeof abs, "%s/%s", w->root, rel[0] ? rel : ".");
    int wd = inotify_add_watch(w->fd, abs, IN_MASK);
    if (wd < 0) return;
    for (int i = 0; i < w->n; i++)
        if (w->v[i].wd == wd) { free(w->v[i].rel); w->v[i].rel = xstrdup(rel); return; }
    if (w->n == w->cap) {
        w->cap = w->cap ? w->cap * 2 : 64;
        w->v = xrealloc(w->v, sizeof(Watch) * (size_t)w->cap);
    }
    w->v[w->n].wd = wd;
    w->v[w->n].rel = xstrdup(rel);
    w->n++;

    DIR *d = opendir(abs);
    if (!d) return;
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
            const char *dir = wd_rel(w, e->wd);
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
    return any;
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
    if (!p->whole && p->n > 0) {
        o.paths = (const char *const *)p->v;
        o.npaths = p->n;
    }
    return cg_index_ex(cg, si, &o, st);
}

int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {
    Watcher w;
    memset(&w, 0, sizeof w);
    w.root = cg->root;
    w.fd = inotify_init1(IN_NONBLOCK);
    if (w.fd < 0) {
        perror("cg: inotify_init1");
        return 1;
    }
    ignore_load(&w.ig, cg->root);
    watch_add_dir(&w, "");
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
    if (watch_sync(cg, si, &pend, &st) != 0 && st.busy) {
        printf("sync deferred: database busy, retrying in %dms\n", debounce_ms);
        pending = true;
        deadline = now_ms() + debounce_ms;
    } else {
        pending_clear(&pend);
        if (st.files_indexed || st.files_removed)
            printf("sync: %ld updated, %ld removed (%ldms)\n",
                   st.files_indexed, st.files_removed, st.ms);
    }
    for (;;) {
        int timeout = -1;
        if (pending) {
            long left = deadline - now_ms();
            timeout = left > 0 ? (int)left : 0;
        }
        struct pollfd pfd = { .fd = w.fd, .events = POLLIN };
        int pr = poll(&pfd, 1, timeout);
        if (pr > 0 && (pfd.revents & POLLIN) && watch_drain(&w, &pend)) {
            pending = true;
            deadline = now_ms() + debounce_ms;
        }
        if (pending && now_ms() >= deadline) {
            pending = false;
            if (watch_sync(cg, si, &pend, &st) != 0 && st.busy) {
                printf("sync deferred: database busy, retrying in %dms\n",
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
            }
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
    if (f->w.fd < 0) { free(f); return NULL; }
    f->w.root = f->cg.root;     /* stable: entries are never moved */
    ignore_load(&f->w.ig, f->cg.root);
    watch_add_dir(&f->w, "");
    /* a tree just picked up is caught up once, whole */
    f->pend.whole = true;
    f->armed = true;
    f->deadline = now_ms();
    return f;
}

static void fleet_watch_close(FleetWatch *f) {
    close(f->w.fd);
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
    cg->lock_wait_ms = 2000;
    printf("watching every worktree of %s (debounce %dms, background passes) "
           "— ctrl-c to stop\n", cg->shared, debounce_ms);
    fflush(stdout);
    for (;;) {
        if (now_ms() >= next_scan) {
            fleet_scan(cg, &v, &n);
            next_scan = now_ms() + FLEET_POLL_MS;
            fflush(stdout);
        }
        long until = next_scan;
        for (int i = 0; i < n; i++)
            if (v[i]->armed && v[i]->deadline < until) until = v[i]->deadline;
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
        if (pr > 0)
            for (int i = 0; i < n; i++)
                if ((pfd[i].revents & POLLIN) &&
                    watch_drain(&v[i]->w, &v[i]->pend)) {
                    v[i]->armed = true;
                    v[i]->deadline = now_ms() + debounce_ms;
                }

        for (int i = 0; i < n; i++) {
            if (!v[i]->armed || now_ms() < v[i]->deadline) continue;
            v[i]->armed = false;
            IndexStats st;
            if (watch_sync(&v[i]->cg, si, &v[i]->pend, &st) != 0 && st.busy) {
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
            fflush(stdout);
        }
    }
}

#else  /* !__linux__ */

int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms) {
    (void)cg; (void)si; (void)debounce_ms;
    fprintf(stderr, "cg: watch --fleet needs inotify; this binary was built "
                    "for another platform\n");
    return 1;
}

int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {
    (void)cg; (void)si; (void)debounce_ms;
#ifdef __APPLE__
    fprintf(stderr, "cg: watch on macOS (FSEvents) is not built into this "
                    "binary yet; run `cg sync` after edits\n");
#elif defined(_WIN32)
    fprintf(stderr, "cg: watch on Windows (ReadDirectoryChangesW) is not built "
                    "into this binary yet; run `cg sync` after edits\n");
#else
    fprintf(stderr, "cg: watch is unsupported on this platform\n");
#endif
    return 1;
}

#endif
