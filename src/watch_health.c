#include "watch_health.h"
#include <errno.h>
#include <fcntl.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <unistd.h>

static void marker_path(const Cg *cg, char *path, size_t cap, bool lock) {
    if (cg->worktree && cg->branch_id > 0)
        snprintf(path, cap, "%s/%s/watch.reconcile.%ld%s", cg->shared,
                 CG_DIR, cg->branch_id, lock ? ".lock" : "");
    else
        snprintf(path, cap, "%s/%s/watch.reconcile%s", cg->shared,
                 CG_DIR, lock ? ".lock" : "");
}

static int lock_marker(const Cg *cg) {
    char path[4700];
    marker_path(cg, path, sizeof path, true);
    int fd = open(path, O_CREAT | O_RDWR | O_CLOEXEC, 0644);
    if (fd < 0) return -1;
    if (flock(fd, LOCK_EX) != 0) { close(fd); return -1; }
    return fd;
}

static void unlock_marker(int fd) { flock(fd, LOCK_UN); close(fd); }

static bool read_locked(const Cg *cg, WatchHealth *out) {
    memset(out, 0, sizeof *out);
    char path[4700];
    marker_path(cg, path, sizeof path, false);
    int fd = open(path, O_RDONLY | O_CLOEXEC);
    if (fd < 0) return errno == ENOENT;
    char buf[96] = {0};
    ssize_t n = read(fd, buf, sizeof buf - 1);
    close(fd);
    if (n <= 0) return false;
    unsigned int pending = 0;
    unsigned long long generation = 0;
    char reason[32] = {0};
    if (sscanf(buf, "%u %llu %31s", &pending, &generation, reason) != 3 ||
        pending > 1) return false;
    out->pending = pending != 0;
    out->generation = generation;
    snprintf(out->reason, sizeof out->reason, "%s", reason);
    return true;
}

bool watch_health_read(const Cg *cg, WatchHealth *out) {
    int lk = lock_marker(cg);
    if (lk < 0) return false;
    bool ok = read_locked(cg, out);
    unlock_marker(lk);
    return ok;
}

static bool write_locked(const Cg *cg, bool pending,
                         unsigned long long generation, const char *reason) {
    char path[4700], tmp[4800], body[96];
    marker_path(cg, path, sizeof path, false);
    snprintf(tmp, sizeof tmp, "%s.%ld", path, (long)getpid());
    int n = snprintf(body, sizeof body, "%d %llu %.31s\n",
                     pending ? 1 : 0, generation, reason);
    int fd = open(tmp, O_CREAT | O_TRUNC | O_WRONLY | O_CLOEXEC, 0644);
    bool ok = fd >= 0 && write(fd, body, (size_t)n) == n && fsync(fd) == 0;
    if (fd >= 0) close(fd);
    if (ok) ok = rename(tmp, path) == 0;
    if (!ok) unlink(tmp);
    return ok;
}

bool watch_health_mark(const Cg *cg, const char *reason) {
    int lk = lock_marker(cg);
    if (lk < 0) return false;
    WatchHealth old;
    if (!read_locked(cg, &old)) { unlock_marker(lk); return false; }
    bool ok = write_locked(cg, true, old.generation + 1, reason);
    unlock_marker(lk);
    return ok;
}

bool watch_health_clear_if(const Cg *cg, unsigned long long generation) {
    int lk = lock_marker(cg);
    if (lk < 0) return false;
    WatchHealth now;
    bool ok = read_locked(cg, &now) && now.pending &&
              now.generation == generation;
    if (ok) ok = write_locked(cg, false, generation, "reconciled");
    unlock_marker(lk);
    return ok;
}
