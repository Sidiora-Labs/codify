/*
 * The parallel tree walk (codify-v15 req 3.1).
 *
 * The single-threaded walk stat'ed every entry, directories and ignored
 * files included, one after another. On a tree of a million files that is
 * a minute of syscalls before the first parse. Here directories are a shared
 * work list: each thread takes one, reads it, queues its subdirectories and
 * keeps the files it found, so the top-level directories (and everything
 * under them) spread over the thread budget however lopsided the tree is.
 *
 * Contract, the same as the walk it replaced:
 *   - the ignore rules are applied exactly as before, to every entry, with
 *     the entry's directory-ness, before anything else is done with it;
 *   - symbolic links are never followed or listed; regular files of any
 *     size are reported so the caller can record explicit skipped coverage;
 *   - the result is sorted by path (strcmp), so callers see one list no
 *     matter how many threads produced it or in which order.
 * The directory entry's d_type decides directory, link, or file without a
 * stat; only DT_UNKNOWN (some filesystems never fill it) costs an lstat. A
 * kept file still needs one fstatat, for the size and mtime the diff reads.
 *
 * The calling thread does not walk: it waits, and draws the progress line
 * (directories and files so far, the directory in hand) — progress is
 * main-thread only.
 */
#include "cg.h"
#include <dirent.h>
#include <fcntl.h>
#include <pthread.h>
#include <stdatomic.h>
#include <sys/stat.h>
#include <time.h>

typedef struct {
    const char *root;
    const Ignore *ig;
    long max_bytes;
    /* the directory work list: a stack of root-relative paths */
    char **dirs;
    int ndirs, cdirs;
    int pending;              /* queued + being read; 0 = the walk is over */
    pthread_mutex_t mu;
    pthread_cond_t more;      /* work queued, or the walk finished */
    char cur[512];            /* the directory last taken, for progress */
    atomic_long ndone_dirs, nfiles;
} WalkShared;

typedef struct {
    WalkShared *sh;
    WalkEntry *v;
    int n, cap;
} WalkLocal;

static long stat_mtime_ns(const struct stat *st) {
#ifdef __APPLE__
    return (long)st->st_mtimespec.tv_sec * 1000000000L + st->st_mtimespec.tv_nsec;
#else
    return (long)st->st_mtim.tv_sec * 1000000000L + st->st_mtim.tv_nsec;
#endif
}

static void local_push(WalkLocal *l, const char *rel, long size, long mtime,
                       long mtime_ns) {
    if (l->n == l->cap) {
        l->cap = l->cap ? l->cap * 2 : 256;
        l->v = xrealloc(l->v, sizeof *l->v * (size_t)l->cap);
    }
    l->v[l->n].rel = xstrdup(rel);
    l->v[l->n].size = size;
    l->v[l->n].mtime = mtime;
    l->v[l->n].mtime_ns = mtime_ns;
    l->n++;
}

/* caller holds sh->mu */
static void queue_dir(WalkShared *sh, const char *rel) {
    if (sh->ndirs == sh->cdirs) {
        sh->cdirs = sh->cdirs ? sh->cdirs * 2 : 64;
        sh->dirs = xrealloc(sh->dirs, sizeof *sh->dirs * (size_t)sh->cdirs);
    }
    sh->dirs[sh->ndirs++] = xstrdup(rel);
    sh->pending++;
}

/* Read one directory: files into l, subdirectories back onto the list. */
static void walk_one(WalkLocal *l, const char *rel) {
    WalkShared *sh = l->sh;
    char abs[4600];
    snprintf(abs, sizeof abs, "%s/%s", sh->root, rel[0] ? rel : ".");
    DIR *d = opendir(abs);
    if (!d) return;
    int dfd = dirfd(d);
    char **subs = NULL;
    int nsubs = 0, csubs = 0;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (strcmp(e->d_name, ".") == 0 || strcmp(e->d_name, "..") == 0)
            continue;
        char crel[4096];
        if (rel[0]) snprintf(crel, sizeof crel, "%s/%s", rel, e->d_name);
        else        snprintf(crel, sizeof crel, "%s", e->d_name);
        struct stat st;
        bool have_st = false;
        unsigned char t = e->d_type;
        if (t == DT_UNKNOWN) {
            if (fstatat(dfd, e->d_name, &st, AT_SYMLINK_NOFOLLOW) != 0)
                continue;
            have_st = true;
            t = S_ISDIR(st.st_mode) ? DT_DIR : S_ISREG(st.st_mode) ? DT_REG
              : S_ISLNK(st.st_mode) ? DT_LNK : DT_UNKNOWN;
        }
        if (t == DT_LNK) continue;
        bool isdir = t == DT_DIR;
        if (ignore_match(sh->ig, crel, isdir)) continue;
        if (isdir) {
            if (nsubs == csubs) {
                csubs = csubs ? csubs * 2 : 16;
                subs = xrealloc(subs, sizeof *subs * (size_t)csubs);
            }
            subs[nsubs++] = xstrdup(crel);
            continue;
        }
        if (t != DT_REG) continue;
        if (!have_st &&
            fstatat(dfd, e->d_name, &st, AT_SYMLINK_NOFOLLOW) != 0)
            continue;
        if (!S_ISREG(st.st_mode)) continue;
        local_push(l, crel, (long)st.st_size, (long)st.st_mtime,
                   stat_mtime_ns(&st));
        atomic_fetch_add(&sh->nfiles, 1);
    }
    closedir(d);
    if (nsubs) {
        pthread_mutex_lock(&sh->mu);
        for (int i = 0; i < nsubs; i++) queue_dir(sh, subs[i]);
        pthread_cond_broadcast(&sh->more);
        pthread_mutex_unlock(&sh->mu);
        for (int i = 0; i < nsubs; i++) free(subs[i]);
    }
    free(subs);
}

static void *walk_thread(void *arg) {
    WalkLocal *l = arg;
    WalkShared *sh = l->sh;
    for (;;) {
        pthread_mutex_lock(&sh->mu);
        while (sh->ndirs == 0 && sh->pending > 0)
            pthread_cond_wait(&sh->more, &sh->mu);
        if (sh->ndirs == 0) {               /* pending == 0: all walked */
            pthread_mutex_unlock(&sh->mu);
            return NULL;
        }
        char *rel = sh->dirs[--sh->ndirs];
        snprintf(sh->cur, sizeof sh->cur, "%s", rel);
        pthread_mutex_unlock(&sh->mu);

        walk_one(l, rel);
        free(rel);
        atomic_fetch_add(&sh->ndone_dirs, 1);

        pthread_mutex_lock(&sh->mu);
        if (--sh->pending == 0) pthread_cond_broadcast(&sh->more);
        pthread_mutex_unlock(&sh->mu);
    }
}

static int entry_cmp(const void *a, const void *b) {
    return strcmp(((const WalkEntry *)a)->rel, ((const WalkEntry *)b)->rel);
}

int walk_threads_default(int budget) {
    const char *e = getenv("CG_WALK_THREADS");      /* tests compare 1 vs N */
    int n = e && e[0] ? atoi(e) : budget;
    if (n < 1) n = 1;
    if (n > CG_MAX_WORKERS) n = CG_MAX_WORKERS;
    return n;
}

void walk_parallel(const char *root, const char *rel, const Ignore *ig,
                   int threads, long max_bytes, WalkSet *out) {
    WalkShared sh;
    memset(&sh, 0, sizeof sh);
    sh.root = root;
    sh.ig = ig;
    sh.max_bytes = max_bytes;
    atomic_init(&sh.ndone_dirs, 0);
    atomic_init(&sh.nfiles, 0);
    pthread_mutex_init(&sh.mu, NULL);
    pthread_cond_init(&sh.more, NULL);
    queue_dir(&sh, rel ? rel : "");

    int nt = walk_threads_default(threads);
    WalkLocal *loc = xmalloc(sizeof *loc * (size_t)nt);
    pthread_t *th = xmalloc(sizeof *th * (size_t)nt);
    memset(loc, 0, sizeof *loc * (size_t)nt);
    for (int i = 0; i < nt; i++) loc[i].sh = &sh;
    int started = 0;
    for (int i = 0; i < nt; i++) {
        if (pthread_create(&th[i], NULL, walk_thread, &loc[i]) == 0)
            started++;
        else break;
    }
    if (started == 0) {                 /* no thread to be had: walk here */
        walk_thread(&loc[0]);
    }

    /* wait for the walk to finish, ticking the progress line meanwhile */
    long base_dirs = out->dirs, base_files = out->n;
    pthread_mutex_lock(&sh.mu);
    while (sh.pending > 0) {
        struct timespec ts;
        clock_gettime(CLOCK_REALTIME, &ts);
        ts.tv_nsec += 50 * 1000000L;
        if (ts.tv_nsec >= 1000000000L) { ts.tv_sec++; ts.tv_nsec -= 1000000000L; }
        pthread_cond_timedwait(&sh.more, &sh.mu, &ts);
        if (sh.pending == 0) break;
        char cur[512];
        snprintf(cur, sizeof cur, "%s", sh.cur);
        pthread_mutex_unlock(&sh.mu);
        progress_dirs(base_dirs + atomic_load(&sh.ndone_dirs));
        progress_tick(base_files + atomic_load(&sh.nfiles), 0, cur);
        pthread_mutex_lock(&sh.mu);
    }
    pthread_mutex_unlock(&sh.mu);
    for (int i = 0; i < started; i++) pthread_join(th[i], NULL);

    /* merge the per-thread lists, then one sort makes the order canonical */
    int add = 0;
    for (int i = 0; i < nt; i++) add += loc[i].n;
    if (out->n + add > out->cap) {
        out->cap = out->n + add + 16;
        out->v = xrealloc(out->v, sizeof *out->v * (size_t)out->cap);
    }
    for (int i = 0; i < nt; i++) {
        if (loc[i].n)
            memcpy(out->v + out->n, loc[i].v, sizeof *loc[i].v * (size_t)loc[i].n);
        out->n += loc[i].n;
        free(loc[i].v);
    }
    out->dirs += atomic_load(&sh.ndone_dirs);
    if (out->n > 1) qsort(out->v, (size_t)out->n, sizeof *out->v, entry_cmp);
    progress_dirs(out->dirs);

    free(loc);
    free(th);
    free(sh.dirs);
    pthread_mutex_destroy(&sh.mu);
    pthread_cond_destroy(&sh.more);
}

void walkset_free(WalkSet *w) {
    for (int i = 0; i < w->n; i++) free(w->v[i].rel);
    free(w->v);
    memset(w, 0, sizeof *w);
}
