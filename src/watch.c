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
    printf("watching %s (%d dirs, debounce %dms, %d workers) — ctrl-c to stop\n",
           cg->root, w.n, debounce_ms, si->workers);

    /* catch up on anything that changed while we weren't looking */
    IndexStats st;
    cg_index(cg, si, false, &st, true);
    if (st.files_indexed || st.files_removed)
        printf("sync: %ld updated, %ld removed (%ldms)\n",
               st.files_indexed, st.files_removed, st.ms);

    char buf[16384];
    bool pending = false;
    long deadline = 0;
    for (;;) {
        int timeout = -1;
        if (pending) {
            long left = deadline - now_ms();
            timeout = left > 0 ? (int)left : 0;
        }
        struct pollfd pfd = { .fd = w.fd, .events = POLLIN };
        int pr = poll(&pfd, 1, timeout);
        if (pr > 0 && (pfd.revents & POLLIN)) {
            ssize_t len;
            while ((len = read(w.fd, buf, sizeof buf)) > 0) {
                ssize_t off = 0;
                while (off < len) {
                    struct inotify_event *e = (struct inotify_event *)(buf + off);
                    off += (ssize_t)sizeof(*e) + e->len;
                    const char *dir = wd_rel(&w, e->wd);
                    if (!dir) continue;
                    if (e->len == 0) continue;
                    char crel[4096];
                    if (dir[0]) snprintf(crel, sizeof crel, "%s/%s", dir, e->name);
                    else        snprintf(crel, sizeof crel, "%s", e->name);
                    if (ignore_match(&w.ig, crel, (e->mask & IN_ISDIR) != 0))
                        continue;
                    if ((e->mask & IN_ISDIR) &&
                        (e->mask & (IN_CREATE | IN_MOVED_TO)))
                        watch_add_dir(&w, crel);
                    pending = true;
                    deadline = now_ms() + debounce_ms;
                }
            }
        }
        if (pending && now_ms() >= deadline) {
            pending = false;
            cg_index(cg, si, false, &st, true);
            if (st.files_indexed || st.files_removed)
                printf("sync: %ld updated, %ld removed, %ld symbols (%ldms)\n",
                       st.files_indexed, st.files_removed, st.symbols, st.ms);
        }
    }
}

#else  /* !__linux__ */

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
