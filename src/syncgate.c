/*
 * Sync gate: one indexer per project, one core budget per machine.
 *
 * Every cg command that wants a fresh graph used to walk, parse, and resolve
 * on its own. Under a fleet of agents that meant one indexer per hook
 * invocation — fifty processes, each sized for the whole machine. The gate
 * makes indexing a shared resource:
 *
 *   index.lock   — flock'd by the process running the pass. A second caller
 *                  does not queue a second walk; it leaves a note and goes.
 *   index.dirty  — the note. Losers append the paths they wanted synced
 *                  (or "*" for the whole tree). The winner drains it before
 *                  releasing the lock, so nothing an agent wrote during the
 *                  pass waits for a fourth process to notice.
 *   slot.N       — machine-wide parse slots under /tmp/codify-<uid>. A pass
 *                  without a slot still runs, on two threads, so several
 *                  projects indexing at once share the cores instead of each
 *                  taking all of them.
 *
 * A linked worktree that joined the shared graph gets its own lock and
 * note (index.<branch>.lock, index.<branch>.dirty) beside the main tree's:
 * its paths are its own, and its walk is independent — the slots keep the
 * total parse budget bounded across all of them.
 *
 * Nothing here touches SQLite: the database lock still serializes writers
 * the way it always did. The gate only keeps the expensive part — walking
 * and parsing — from happening more than once for the same change.
 */
#include "cg.h"
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/resource.h>
#include <time.h>
#include <unistd.h>

#define GATE_POLL_MS 40
#define DIRTY_MAX_BYTES (256 * 1024)

/* One gate per tree, all under the shared .codegraph. The main worktree
 * keeps the plain names; a linked worktree's gate is keyed by its branch
 * ("index.7.lock"), so two worktrees walk in parallel — the machine-wide
 * slots still cap their workers — and a note left for one never names
 * paths of the other. */
static void gate_path(const Cg *cg, const char *name, char *out, size_t cap) {
    if (cg->worktree && cg->branch_id > 0) {
        const char *dot = strchr(name, '.');
        snprintf(out, cap, "%s/%s/%.*s.%ld%s", cg->shared, CG_DIR,
                 (int)(dot ? dot - name : (long)strlen(name)), name,
                 cg->branch_id, dot ? dot : "");
    } else {
        snprintf(out, cap, "%s/%s/%s", cg->shared, CG_DIR, name);
    }
}

static void sleep_ms(long ms) {
    struct timespec ts = { ms / 1000, (ms % 1000) * 1000000L };
    nanosleep(&ts, NULL);
}

/* Take the project's index gate. wait_ms 0 = try once; >0 = poll up to that
 * long. Returns the lock fd (>=0) while held, -1 when someone else kept it. */
int syncgate_acquire(const Cg *cg, long wait_ms) {
    char p[4700];
    gate_path(cg, "index.lock", p, sizeof p);
    int fd = open(p, O_RDWR | O_CREAT | O_CLOEXEC, 0644);
    if (fd < 0) return -1;
    long waited = 0;
    for (;;) {
        if (flock(fd, LOCK_EX | LOCK_NB) == 0) return fd;
        if (waited >= wait_ms) break;
        long step = wait_ms - waited < GATE_POLL_MS ? wait_ms - waited : GATE_POLL_MS;
        sleep_ms(step);
        waited += step;
    }
    close(fd);
    return -1;
}

void syncgate_release(int fd) {
    if (fd >= 0) { flock(fd, LOCK_UN); close(fd); }
}

/* The dirty marker has its own tiny lock so an appender and the draining
 * winner never interleave: a note written while the winner renames the
 * marker away would otherwise vanish with it. */
static int dirty_lock(const Cg *cg) {
    char p[4700];
    gate_path(cg, "index.dirty.lock", p, sizeof p);
    int fd = open(p, O_RDWR | O_CREAT | O_CLOEXEC, 0644);
    if (fd >= 0) flock(fd, LOCK_EX);
    return fd;
}

/* Leave a note for whoever holds the gate: these paths (relative to the
 * root) changed; npaths 0 means "walk everything". */
void syncgate_mark_dirty(const Cg *cg, const char *const *paths, int npaths) {
    int lk = dirty_lock(cg);
    char p[4700];
    gate_path(cg, "index.dirty", p, sizeof p);
    int fd = open(p, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
    if (fd >= 0) {
        struct stat st;
        /* a runaway marker is as bad as the storm it prevents: past the cap
         * collapse to a whole-tree note */
        bool whole = npaths <= 0 ||
                     (fstat(fd, &st) == 0 && st.st_size > DIRTY_MAX_BYTES);
        if (whole) {
            if (write(fd, "*\n", 2) < 0) { /* best effort */ }
        } else {
            for (int i = 0; i < npaths; i++) {
                size_t n = strlen(paths[i]);
                if (n == 0 || n > 4000) continue;
                if (write(fd, paths[i], n) < 0 || write(fd, "\n", 1) < 0) break;
            }
        }
        close(fd);
    }
    syncgate_release(lk);
}

bool syncgate_is_dirty(const Cg *cg) {
    char p[4700];
    gate_path(cg, "index.dirty", p, sizeof p);
    struct stat st;
    return stat(p, &st) == 0;
}

/* Atomically take the marker: returns its lines (malloc'd, NUL-terminated,
 * possibly empty) and removes it, or NULL when there was none. The marker
 * is renamed to a per-pid name first so a concurrent appender never writes
 * into a file that is about to be unlinked. The caller must hold the gate. */
char *syncgate_take_dirty(const Cg *cg) {
    int lk = dirty_lock(cg);
    char p[4700], taken[4800];
    gate_path(cg, "index.dirty", p, sizeof p);
    snprintf(taken, sizeof taken, "%s.%d", p, (int)getpid());
    char *body = NULL;
    if (rename(p, taken) == 0) {
        size_t len = 0;
        body = read_entire_file(taken, &len);
        if (!body) body = xstrdup("");
        unlink(taken);
    }
    syncgate_release(lk);
    return body;
}

/* ---------------- machine-wide parse slots ---------------- */

static int slot_dir(char *out, size_t cap) {
    const char *base = getenv("CG_SLOT_DIR");
    if (base && base[0]) snprintf(out, cap, "%s", base);
    else snprintf(out, cap, "/tmp/codify-%ld", (long)getuid());
    if (mkdir(out, 0700) != 0 && errno != EEXIST) return -1;
    struct stat st;
    if (stat(out, &st) != 0 || !S_ISDIR(st.st_mode) || st.st_uid != getuid())
        return -1;                       /* not ours: no slots, stay lean */
    return 0;
}

int syncgate_slot_count(const SysInfo *si) {
    const char *e = getenv("CG_INDEX_SLOTS");
    if (e && e[0]) { int n = atoi(e); return n > 0 ? n : 1; }
    int n = si->cores_effective / 4;
    return n > 0 ? n : 1;
}

/* Try each slot once; returns the fd holding one, or -1 when all are busy. */
int syncgate_slot_acquire(const SysInfo *si) {
    char dir[4096];
    if (slot_dir(dir, sizeof dir) != 0) return -1;
    int n = syncgate_slot_count(si);
    for (int i = 0; i < n; i++) {
        char p[4200];
        snprintf(p, sizeof p, "%s/slot.%d", dir, i);
        int fd = open(p, O_RDWR | O_CREAT | O_CLOEXEC, 0600);
        if (fd < 0) continue;
        if (flock(fd, LOCK_EX | LOCK_NB) == 0) return fd;
        close(fd);
    }
    return -1;
}

void syncgate_slot_release(int fd) {
    syncgate_release(fd);
}

/* How many parse threads this pass may use. Background passes (hooks,
 * watchers, editor refreshes) never take more than a quarter of the cores;
 * a pass that could not get a machine slot runs on two. CG_INDEX_WORKERS
 * caps everything. *slot_fd receives the slot to release afterwards. */
int syncgate_worker_budget(const SysInfo *si, const IndexOpts *o, int jobs,
                           int *slot_fd) {
    *slot_fd = -1;
    int w = si->workers;
    if (o->workers_cap > 0 && o->workers_cap < w) w = o->workers_cap;
    const char *e = getenv("CG_INDEX_WORKERS");
    if (e && e[0]) { int n = atoi(e); if (n > 0 && n < w) w = n; }
    if (o->background) {
        int q = si->cores_effective / 4;
        if (q < 2) q = 2;
        if (w > q) w = q;
    }
    if (w > jobs) w = jobs;
    if (w < 1) w = 1;
    if (w > 2) {
        *slot_fd = syncgate_slot_acquire(si);
        if (*slot_fd < 0) w = 2;
    }
    return w;
}

/* Lower this process's priority once. Background syncs should lose to the
 * agent's own build and tests, not compete with them. */
void syncgate_background_nice(void) {
    static bool done = false;
    if (done) return;
    done = true;
    errno = 0;
    if (getpriority(PRIO_PROCESS, 0) < 10) setpriority(PRIO_PROCESS, 0, 10);
}
