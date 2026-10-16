/* @anchor purpose: checkpoint envelopes preserve source bytes and staging, not authority.
 * Local completeness never means durable publication: only the supervisor's artifact
 * service receipt does. Credentials, Git config and native homes are not copied. */
#define _GNU_SOURCE
#include "components.h"
#include <ctype.h>
#include <dirent.h>
#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/file.h>
#include <sys/stat.h>
#include <sys/syscall.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>

extern void sha256_hex(const void *, size_t, char[65]);
#define MAX_CAP (128U * 1024U * 1024U)
#define MAX_TREE (64U * 1024U * 1024U)
#define MAX_FILE (16U * 1024U * 1024U)
#define MAX_ITEMS 20000U
#define CHUNK 196608U
typedef struct {
    unsigned char *p;
    size_t n, cap;
} Buf;
typedef struct {
    char key[64];
    char *val;
} Pair;
typedef struct {
    Pair a[32];
    size_t n;
} Obj;
typedef struct {
    char *name;
    struct stat st;
} Name;
static const char *failure;
static int bad(const char *s) {
    failure = s;
    return -1;
}
static int append(Buf *b, const void *p, size_t n) {
    if (n > MAX_CAP - b->n)
        return bad("RESOURCE_LIMIT");
    if (b->n + n > b->cap) {
        size_t c = b->cap ? b->cap : 4096;
        while (c < b->n + n)
            c *= 2;
        unsigned char *q = realloc(b->p, c);
        if (!q)
            return bad("RESOURCE_LIMIT");
        b->p = q;
        b->cap = c;
    }
    if (n)
        memcpy(b->p + b->n, p, n);
    b->n += n;
    return 0;
}
static int u32(Buf *b, uint32_t v) {
    unsigned char q[4];
    for (int i = 0; i < 4; i++)
        q[i] = (v >> (24 - i * 8)) & 255;
    return append(b, q, 4);
}
static int u64(Buf *b, uint64_t v) {
    unsigned char q[8];
    for (int i = 0; i < 8; i++)
        q[i] = (v >> (56 - i * 8)) & 255;
    return append(b, q, 8);
}
static uint32_t r32(const unsigned char *p) {
    uint32_t v = 0;
    for (int i = 0; i < 4; i++)
        v = v * 256 + p[i];
    return v;
}
static uint64_t r64(const unsigned char *p) {
    uint64_t v = 0;
    for (int i = 0; i < 8; i++)
        v = v * 256 + p[i];
    return v;
}
static void drop(Buf *b) {
    free(b->p);
    memset(b, 0, sizeof(*b));
}
static int writeall(int fd, const void *p, size_t n) {
    const unsigned char *q = p;
    while (n) {
        ssize_t k = write(fd, q, n);
        if (k < 0 && errno == EINTR)
            continue;
        if (k <= 0)
            return bad("IO_ERROR");
        q += k;
        n -= k;
    }
    return 0;
}
static int readbuf(int fd, Buf *b, size_t max) {
    unsigned char q[65536];
    for (;;) {
        ssize_t k = read(fd, q, sizeof q);
        if (k < 0 && errno == EINTR)
            continue;
        if (k < 0)
            return bad("IO_ERROR");
        if (!k)
            break;
        if ((size_t)k > max - b->n)
            return bad("RESOURCE_LIMIT");
        if (append(b, q, k))
            return -1;
    }
    return 0;
}
static int stat_same(const struct stat *a, const struct stat *b) {
    return a->st_dev == b->st_dev && a->st_ino == b->st_ino && a->st_size == b->st_size &&
           a->st_mode == b->st_mode && a->st_mtim.tv_sec == b->st_mtim.tv_sec &&
           a->st_mtim.tv_nsec == b->st_mtim.tv_nsec && a->st_ctim.tv_sec == b->st_ctim.tv_sec &&
           a->st_ctim.tv_nsec == b->st_ctim.tv_nsec;
}
static int safe_path(const char *s) {
    if (!s || !*s || *s == '/' || strlen(s) > 4096)
        return 0;
    const char *p = s;
    while (*p) {
        const char *e = strchr(p, '/');
        size_t n = e ? (size_t)(e - p) : strlen(p);
        if (!n || (n == 1 && p[0] == '.') || (n == 2 && p[0] == '.' && p[1] == '.') ||
            (n == 4 && !memcmp(p, ".git", 4)))
            return 0;
        if (!e)
            break;
        p = e + 1;
    }
    return 1;
}
static int open_dir_path(const char *path) {
    if (!path || path[0] != '/')
        return bad("TRUSTED_ROOT_REQUIRED");
    int fd = open("/", O_RDONLY | O_DIRECTORY | O_CLOEXEC);
    if (fd < 0)
        return -1;
    char *copy = strdup(path), *save = NULL;
    if (!copy) {
        close(fd);
        return -1;
    }
    for (char *t = strtok_r(copy, "/", &save); t; t = strtok_r(NULL, "/", &save)) {
        if (!strcmp(t, ".") || !strcmp(t, "..")) {
            close(fd);
            free(copy);
            return bad("UNSAFE_PATH");
        }
        int n = openat(fd, t, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        close(fd);
        fd = n;
        if (fd < 0)
            break;
    }
    free(copy);
    return fd;
}
/* Determine containment using inode ancestry rather than path prefixes. */
static int beneath(int child, int ancestor) {
    struct stat target, current, parent;
    if (fstat(ancestor, &target))
        return -1;
    int fd = dup(child);
    if (fd < 0)
        return -1;
    for (unsigned depth = 0; depth < 4096; depth++) {
        if (fstat(fd, &current)) {
            close(fd);
            return -1;
        }
        if (current.st_dev == target.st_dev && current.st_ino == target.st_ino) {
            close(fd);
            return 1;
        }
        int next = openat(fd, "..", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        if (next < 0 || fstat(next, &parent)) {
            if (next >= 0)
                close(next);
            close(fd);
            return -1;
        }
        close(fd);
        fd = next;
        if (current.st_dev == parent.st_dev && current.st_ino == parent.st_ino) {
            close(fd);
            return 0;
        }
    }
    close(fd);
    return -1;
}
static int relative_dir(int root, const char *path) {
    if (!safe_path(path))
        return bad("UNSAFE_PATH");
    int fd = dup(root);
    char *c = strdup(path), *save = NULL;
    if (!c) {
        close(fd);
        return -1;
    }
    for (char *t = strtok_r(c, "/", &save); t; t = strtok_r(NULL, "/", &save)) {
        int n = openat(fd, t, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
        close(fd);
        fd = n;
        if (fd < 0)
            break;
    }
    free(c);
    return fd;
}
static const char *skipws(const char *p) {
    while (*p == ' ' || *p == '\t' || *p == '\n' || *p == '\r')
        p++;
    return p;
}
/* Inputs are deliberately flat strings; no lossy generic JSON helper is used.
 * Reject duplicates, escaped keys, Unicode escapes and all unknown fields. */
static char *parse_string(const char **pp) {
    const char *p = *pp;
    if (*p++ != '"')
        return NULL;
    Buf b = {0};
    while (*p && *p != '"') {
        unsigned char c = *p++;
        if (c < 32 || c >= 127) {
            drop(&b);
            return NULL;
        }
        if (c == '\\') {
            c = *p++;
            if (c == 'n')
                c = '\n';
            else if (c == 'r')
                c = '\r';
            else if (c == 't')
                c = '\t';
            else if (c != '"' && c != '\\' && c != '/') {
                drop(&b);
                return NULL;
            }
        }
        if (append(&b, &c, 1)) {
            drop(&b);
            return NULL;
        }
    }
    if (*p != '"') {
        drop(&b);
        return NULL;
    }
    char z = 0;
    append(&b, &z, 1);
    *pp = p + 1;
    return (char *)b.p;
}
static void freeobj(Obj *o) {
    for (size_t i = 0; i < o->n; i++)
        free(o->a[i].val);
}
static int parse(const char *p, Obj *o) {
    memset(o, 0, sizeof *o);
    p = skipws(p);
    if (*p++ != '{')
        return bad("INVALID_REQUEST");
    p = skipws(p);
    if (*p == '}')
        return !*skipws(p + 1) ? 0 : bad("INVALID_REQUEST");
    for (;;) {
        if (o->n == 32)
            return bad("INVALID_REQUEST");
        char *k = parse_string(&p);
        if (!k || strlen(k) > 63) {
            free(k);
            return bad("INVALID_REQUEST");
        }
        for (size_t i = 0; i < o->n; i++)
            if (!strcmp(o->a[i].key, k)) {
                free(k);
                return bad("DUPLICATE_FIELD");
            }
        p = skipws(p);
        if (*p++ != ':') {
            free(k);
            return bad("INVALID_REQUEST");
        }
        p = skipws(p);
        char *v = parse_string(&p);
        if (!v) {
            free(k);
            return bad("INVALID_REQUEST");
        }
        strcpy(o->a[o->n].key, k);
        o->a[o->n++].val = v;
        free(k);
        p = skipws(p);
        if (*p == '}')
            return !*skipws(p + 1) ? 0 : bad("INVALID_REQUEST");
        if (*p++ != ',')
            return bad("INVALID_REQUEST");
        p = skipws(p);
    }
}
static const char *get(Obj *o, const char *k) {
    for (size_t i = 0; i < o->n; i++)
        if (!strcmp(o->a[i].key, k))
            return o->a[i].val;
    return NULL;
}
static int allowed(Obj *o, const char *const *keys) {
    for (size_t i = 0; i < o->n; i++) {
        int found = 0;
        for (size_t j = 0; keys[j]; j++)
            if (!strcmp(o->a[i].key, keys[j]))
                found = 1;
        if (!found)
            return bad("UNKNOWN_FIELD");
    }
    return 0;
}
static int decimal(const char *s, uint64_t *val) {
    if (!s || !*s || (s[0] == '0' && s[1]))
        return 0;
    uint64_t n = 0;
    for (; *s; s++) {
        if (*s < '0' || *s > '9' || n > (UINT64_MAX - (*s - '0')) / 10)
            return 0;
        n = n * 10 + (*s - '0');
    }
    if (val)
        *val = n;
    return 1;
}
static int hex(const char *s, size_t n) {
    if (!s || strlen(s) != n)
        return 0;
    for (size_t i = 0; i < n; i++)
        if (!isdigit((unsigned char)s[i]) && (s[i] < 'a' || s[i] > 'f'))
            return 0;
    return 1;
}
static int digest_ok(const char *s) { return s && !strncmp(s, "sha256:", 7) && hex(s + 7, 64); }
static int uuid(const char *s) {
    if (!s || strlen(s) != 36)
        return 0;
    for (int i = 0; i < 36; i++) {
        if (i == 8 || i == 13 || i == 18 || i == 23) {
            if (s[i] != '-')
                return 0;
        } else if (!isdigit((unsigned char)s[i]) && (s[i] < 'a' || s[i] > 'f'))
            return 0;
    }
    return 1;
}
static void hashbuf(Buf *b, char out[72]) {
    strcpy(out, "sha256:");
    sha256_hex(b->n ? b->p : (const unsigned char *)"", b->n, out + 7);
}
static int quoted(Buf *b, const char *s) {
    if (append(b, "\"", 1))
        return -1;
    for (; *s; s++) {
        unsigned char c = *s;
        if (c == '"' || c == '\\') {
            char slash = '\\';
            if (append(b, &slash, 1))
                return -1;
        }
        if (c < 32)
            return bad("INVALID_METADATA");
        if (append(b, &c, 1))
            return -1;
    }
    return append(b, "\"", 1);
}
static int field(Buf *b, const char *k, const char *v, int *first) {
    if (!*first && append(b, ",", 1))
        return -1;
    *first = 0;
    return quoted(b, k) || append(b, ":", 1) || quoted(b, v);
}
static int command(int dir, const char *const *args, Buf *out, int outputfd) {
    pid_t p;
    int pipes[2];
    if (pipe2(pipes, O_CLOEXEC))
        return bad("IO_ERROR");
    if ((p = fork()) < 0) {
        close(pipes[0]);
        close(pipes[1]);
        return bad("IO_ERROR");
    }
    if (!p) {
        close(pipes[0]);
        if (fchdir(dir))
            _exit(126);
        dup2(outputfd >= 0 ? outputfd : pipes[1], STDOUT_FILENO);
        int null = open("/dev/null", O_RDWR);
        dup2(null, STDIN_FILENO);
        dup2(null, STDERR_FILENO);
        if (null > 2)
            close(null);
        close(pipes[1]);
        clearenv();
        setenv("PATH", "/usr/bin:/bin", 1);
        setenv("HOME", "/nonexistent", 1);
        setenv("GIT_CONFIG_NOSYSTEM", "1", 1);
        setenv("GIT_CONFIG_GLOBAL", "/dev/null", 1);
        setenv("GIT_TERMINAL_PROMPT", "0", 1);
        const char *av[56];
        int n = 0;
        av[n++] = "/usr/bin/git";
        av[n++] = "-c";
        av[n++] = "core.hooksPath=/dev/null";
        av[n++] = "-c";
        av[n++] = "core.fsmonitor=false";
        av[n++] = "-c";
        av[n++] = "core.untrackedCache=false";
        av[n++] = "-c";
        av[n++] = "safe.directory=*";
        av[n++] = "-c";
        av[n++] = "core.worktree=.";
        av[n++] = "-c";
        av[n++] = "core.bare=false";
        for (int i = 0; args[i] && n < 55; i++)
            av[n++] = args[i];
        av[n] = NULL;
        execv(av[0], (char *const *)av);
        _exit(127);
    }
    close(pipes[1]);
    Buf temp = {0};
    int r = readbuf(pipes[0], out ? out : &temp, MAX_TREE);
    close(pipes[0]);
    drop(&temp);
    int status;
    while (waitpid(p, &status, 0) < 0) {
        if (errno != EINTR)
            return bad("IO_ERROR");
    }
    if (r)
        return -1;
    return WIFEXITED(status) ? WEXITSTATUS(status) : 128;
}
#define GIT(dir, out, ...) command(dir, (const char *const[]){__VA_ARGS__, NULL}, out, -1)
static int gittext(int dir, Buf *b, const char *a, const char *c) {
    if (GIT(dir, b, a, c) || !b->n)
        return bad("GIT_FAILED");
    while (b->n && (b->p[b->n - 1] == '\n' || b->p[b->n - 1] == '\r'))
        b->n--;
    return append(b, "", 1);
}
static int sensitive(const char *path) {
    const char *p = path;
    while (*p) {
        const char *e = strchr(p, '/');
        size_t n = e ? (size_t)(e - p) : strlen(p);
        if ((n == 4 && !memcmp(p, ".env", 4)) ||
            (n > 5 && !memcmp(p, ".env.", 5) && !(n == 12 && !memcmp(p, ".env.example", 12))) ||
            (n == 6 && !memcmp(p, ".netrc", 6)) || (n == 6 && !memcmp(p, ".npmrc", 6)) ||
            (n == 4 && !memcmp(p, ".ssh", 4)) || (n == 4 && !memcmp(p, ".aws", 4)) ||
            (n == 6 && !memcmp(p, ".codex", 6)) || (n == 7 && !memcmp(p, ".claude", 7)))
            return 1;
        if (!e)
            break;
        p = e + 1;
    }
    return 0;
}
static int tracked_prefix(Buf *tracked, const char *path) {
    size_t n = strlen(path);
    for (size_t i = 0; i < tracked->n;) {
        char *p = (char *)tracked->p + i;
        size_t m = strlen(p);
        if (m >= n && !memcmp(p, path, n) && (m == n || p[n] == '/'))
            return 1;
        i += m + 1;
    }
    return 0;
}
static int cmpname(const void *a, const void *b) {
    return strcmp(((const Name *)a)->name, ((const Name *)b)->name);
}
static int addrecord(Buf *b, const char *path, unsigned kind, unsigned mode, const void *data,
                     size_t n) {
    size_t m = strlen(path);
    unsigned char k = kind;
    if (b->n + n + m + 17 > MAX_TREE)
        return bad("TREE_LIMIT");
    return u32(b, m) || u64(b, n) || u32(b, mode) || append(b, &k, 1) || append(b, path, m) ||
           append(b, data, n);
}
static int collect(int repo, int dir, const char *prefix, Buf *tracked, Buf *tree,
                   unsigned *count) {
    struct stat before, after;
    if (fstat(dir, &before))
        return bad("IO_ERROR");
    DIR *d = fdopendir(dup(dir));
    if (!d)
        return bad("IO_ERROR");
    Name *names = NULL;
    size_t n = 0;
    struct dirent *e;
    int result = 0;
    rewinddir(d);
    while ((e = readdir(d))) {
        if (!strcmp(e->d_name, ".") || !strcmp(e->d_name, "..") || !strcmp(e->d_name, ".git"))
            continue;
        if (n >= MAX_ITEMS) {
            result = bad("ITEM_LIMIT");
            break;
        }
        Name *q = realloc(names, (n + 1) * sizeof *q);
        if (!q) {
            result = bad("RESOURCE_LIMIT");
            break;
        }
        names = q;
        names[n].name = strdup(e->d_name);
        if (!names[n].name) {
            result = bad("RESOURCE_LIMIT");
            break;
        }
        n++;
    }
    closedir(d);
    if (result)
        goto done;
    qsort(names, n, sizeof *names, cmpname);
    for (size_t i = 0; i < n && !result; i++) {
        char path[4097];
        int k = snprintf(path, sizeof path, "%s%s%s", prefix, *prefix ? "/" : "", names[i].name);
        if (k <= 0 || (size_t)k >= sizeof path || !safe_path(path)) {
            result = bad("UNSAFE_PATH");
            break;
        }
        if (!tracked_prefix(tracked, path)) {
            int ignored = GIT(repo, NULL, "check-ignore", "--quiet", "--", path);
            if (ignored == 0)
                continue;
            if (ignored != 1) {
                result = bad("GIT_FAILED");
                break;
            }
        }
        if (sensitive(path)) {
            result = bad("SENSITIVE_PATH");
            break;
        }
        if (++*count > MAX_ITEMS) {
            result = bad("ITEM_LIMIT");
            break;
        }
        struct stat s;
        if (fstatat(dir, names[i].name, &s, AT_SYMLINK_NOFOLLOW)) {
            result = bad("UNSTABLE_SOURCE");
            break;
        }
        if ((s.st_mode & 07000) || (s.st_nlink > 1 && !S_ISDIR(s.st_mode))) {
            result = bad("UNSUPPORTED_ENTRY");
            break;
        }
        if (S_ISDIR(s.st_mode)) {
            result = addrecord(tree, path, 2, s.st_mode & 0777, NULL, 0);
            if (result)
                break;
            int fd = openat(dir, names[i].name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
            if (fd < 0) {
                result = bad("UNSTABLE_SOURCE");
                break;
            }
            result = collect(repo, fd, path, tracked, tree, count);
            close(fd);
        } else if (S_ISREG(s.st_mode)) {
            if (s.st_size < 0 || s.st_size > MAX_FILE) {
                result = bad("FILE_LIMIT");
                break;
            }
            int fd = openat(dir, names[i].name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
            if (fd < 0) {
                result = bad("UNSTABLE_SOURCE");
                break;
            }
            Buf data = {0};
            struct stat start, end;
            result = fstat(fd, &start) || !stat_same(&s, &start) ? bad("UNSTABLE_SOURCE")
                                                                 : readbuf(fd, &data, MAX_FILE);
            if (!result &&
                (fstat(fd, &end) || !stat_same(&start, &end) || (size_t)end.st_size != data.n))
                result = bad("UNSTABLE_SOURCE");
            close(fd);
            if (!result && data.n >= 42 &&
                !memcmp(data.p, "version https://git-lfs.github.com/spec/v1\n", 42))
                result = bad("LFS_UNSUPPORTED");
            if (!result)
                result = addrecord(tree, path, 1, s.st_mode & 0777, data.p, data.n);
            drop(&data);
        } else if (S_ISLNK(s.st_mode)) {
            char target[4097];
            ssize_t z = readlinkat(dir, names[i].name, target, sizeof target - 1);
            if (z <= 0 || z >= 4096) {
                result = bad("UNSAFE_SYMLINK");
                break;
            }
            target[z] = 0;
            if (!safe_path(target)) {
                result = bad("UNSAFE_SYMLINK");
                break;
            }
            result = addrecord(tree, path, 3, 0777, target, z);
        } else
            result = bad("UNSUPPORTED_ENTRY");
    }
    if (!result && (fstat(dir, &after) || !stat_same(&before, &after)))
        result = bad("UNSTABLE_SOURCE");
done:
    for (size_t i = 0; i < n; i++)
        free(names[i].name);
    free(names);
    return result;
}
static int filebuf(int dir, const char *name, Buf *b) {
    int fd = openat(dir, name, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0)
        return bad("OBJECT_MISSING");
    struct stat s, t;
    int r = fstat(fd, &s) || !S_ISREG(s.st_mode) || s.st_size < 0 || s.st_size > MAX_CAP
                ? bad("INVALID_OBJECT")
                : readbuf(fd, b, MAX_CAP);
    if (!r && (fstat(fd, &t) || !stat_same(&s, &t)))
        r = bad("UNSTABLE_OBJECT");
    close(fd);
    return r;
}
static int cleanup(int dir, const char *name) {
    int fd = openat(dir, name, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (fd < 0)
        return unlinkat(dir, name, 0);
    DIR *d = fdopendir(dup(fd));
    if (!d) {
        close(fd);
        return -1;
    }
    struct dirent *e;
    while ((e = readdir(d)))
        if (strcmp(e->d_name, ".") && strcmp(e->d_name, ".."))
            cleanup(fd, e->d_name);
    closedir(d);
    close(fd);
    return unlinkat(dir, name, AT_REMOVEDIR);
}
static int putfile(int dir, const char *name, const void *data, size_t n, unsigned mode) {
    int fd = openat(dir, name, O_WRONLY | O_CREAT | O_EXCL | O_NOFOLLOW | O_CLOEXEC, 0600);
    if (fd < 0)
        return bad("IO_ERROR");
    int r = writeall(fd, data, n) || fchmod(fd, mode) || fsync(fd);
    close(fd);
    return r ? bad("IO_ERROR") : 0;
}
static int metadata(Obj *o, const char *head, unsigned rootmode, Buf *meta) {
    const char *ids[] = {"organisation_id", "run_id", "repository_id", "task_id", "attempt_id",
                         "workspace_id",    NULL};
    for (int i = 0; ids[i]; i++)
        if (!uuid(get(o, ids[i])))
            return bad("INVALID_IDENTITY");
    const char *digs[] = {"preparation_digest", "dependency_digest", "summary_digest",
                          "findings_digest", NULL};
    for (int i = 0; digs[i]; i++)
        if (!digest_ok(get(o, digs[i])))
            return bad("INVALID_DIGEST");
    const char *base = get(o, "base_commit"), *branch = get(o, "branch_ref"),
               *support = get(o, "native_support"), *session = get(o, "native_session_ref");
    if (!base || !(hex(base, 40) || hex(base, 64)) || !branch || strlen(branch) > 255 ||
        strncmp(branch, "refs/heads/", 11))
        return bad("INVALID_SOURCE_IDENTITY");
    if (!decimal(get(o, "instruction_cursor"), NULL) || !support ||
        (!strcmp(support, "RECORDED") ? !uuid(session)
                                      : strcmp(support, "UNSUPPORTED") || !session || *session))
        return bad("INVALID_RECOVERY_REFERENCE");
    int first = 1;
    if (append(meta, "{", 1))
        return -1;
    field(meta, "schema_version", "1", &first);
    field(meta, "capture_scope", "GIT_AND_NONIGNORED_WORKTREE", &first);
    field(meta, "consistency", "STABLE_SCAN_REQUIRES_SUPERVISOR_QUIESCENCE", &first);
    for (int i = 0; ids[i]; i++)
        field(meta, ids[i], get(o, ids[i]), &first);
    field(meta, "base_commit", base, &first);
    field(meta, "head_commit", head, &first);
    field(meta, "branch_ref", branch, &first);
    for (int i = 0; digs[i]; i++)
        field(meta, digs[i], get(o, digs[i]), &first);
    const char *refs[] = {"instruction_cursor", "native_support", "native_session_ref", NULL};
    for (int i = 0; refs[i]; i++)
        field(meta, refs[i], get(o, refs[i]), &first);
    char mode[16];
    snprintf(mode, sizeof mode, "%u", rootmode);
    field(meta, "workspace_mode", mode, &first);
    field(meta, "index_scope", "STAGED_TREE_NOT_LOCAL_INDEX_FLAGS", &first);
    field(meta, "ignored_disposition", "EXCLUDED_NOT_RECOVERED", &first);
    field(meta, "authority", "NONE", &first);
    return append(meta, "}", 1);
}
typedef struct {
    Buf meta, bundle, patch, tree;
} Parts;
static void partsdrop(Parts *p) {
    drop(&p->meta);
    drop(&p->bundle);
    drop(&p->patch);
    drop(&p->tree);
}
static int unpack(Buf *b, Parts *p) {
    if (b->n < 40 || memcmp(b->p, "HFCP0001", 8))
        return bad("INVALID_CAPSULE");
    uint64_t sizes[4];
    size_t total = 40;
    for (int i = 0; i < 4; i++) {
        sizes[i] = r64(b->p + 8 + i * 8);
        if (sizes[i] > MAX_CAP - total)
            return bad("INVALID_CAPSULE");
        total += sizes[i];
    }
    if (total != b->n || sizes[0] > 65536 || sizes[3] > MAX_TREE)
        return bad("INVALID_CAPSULE");
    Buf *dest[] = {&p->meta, &p->bundle, &p->patch, &p->tree};
    size_t off = 40;
    for (int i = 0; i < 4; i++) {
        if (append(dest[i], b->p + off, sizes[i]))
            return -1;
        off += sizes[i];
    }
    return 0;
}
static int capsule(int spool, const char *digest, Buf *b, Parts *p) {
    if (!digest_ok(digest))
        return bad("INVALID_DIGEST");
    char name[80];
    snprintf(name, sizeof name, "%s.hfc", digest + 7);
    if (filebuf(spool, name, b))
        return -1;
    char actual[72];
    hashbuf(b, actual);
    if (strcmp(digest, actual))
        return bad("CHECKSUM_MISMATCH");
    return unpack(b, p);
}
static int capture(Obj *o, int root, int spool, FILE *out) {
    const char *keys[] = {"candidate_path",
                          "organisation_id",
                          "run_id",
                          "repository_id",
                          "task_id",
                          "attempt_id",
                          "workspace_id",
                          "base_commit",
                          "branch_ref",
                          "preparation_digest",
                          "dependency_digest",
                          "summary_digest",
                          "findings_digest",
                          "instruction_cursor",
                          "native_support",
                          "native_session_ref",
                          NULL};
    if (allowed(o, keys))
        return -1;
    int repo = relative_dir(root, get(o, "candidate_path"));
    if (repo < 0)
        return bad("UNSAFE_CANDIDATE");
    struct stat rst;
    if (beneath(spool, repo) != 0) {
        close(repo);
        return bad("SPOOL_INSIDE_CANDIDATE");
    }
    if (fstat(repo, &rst)) {
        close(repo);
        return bad("IO_ERROR");
    }
    int lock = openat(repo, ".git", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (lock < 0) {
        close(repo);
        return bad("ORDINARY_REPOSITORY_REQUIRED");
    }
    int lf =
        openat(lock, "hyperfide-checkpoint.lock", O_CREAT | O_RDWR | O_NOFOLLOW | O_CLOEXEC, 0600);
    close(lock);
    if (lf < 0 || flock(lf, LOCK_EX | LOCK_NB)) {
        if (lf >= 0)
            close(lf);
        close(repo);
        return bad("CAPTURE_BUSY");
    }
    Parts p = {0};
    Buf head = {0}, branch = {0}, tracked = {0}, again = {0}, check = {0}, full = {0};
    unsigned count = 0, count2 = 0;
    int r = -1;
    char tmp[64] = "";
    int td = -1;
    if (gittext(repo, &head, "rev-parse", "HEAD") || gittext(repo, &branch, "symbolic-ref", "HEAD"))
        goto done;
    if (metadata(o, (char *)head.p, rst.st_mode & 0777, &p.meta))
        goto done;
    if (strcmp(get(o, "branch_ref"), (char *)branch.p)) {
        bad("BRANCH_MISMATCH");
        goto done;
    }
    if (GIT(repo, NULL, "merge-base", "--is-ancestor", get(o, "base_commit"), "HEAD")) {
        bad("BASE_MISMATCH");
        goto done;
    }
    if (GIT(repo, &check, "ls-files", "--unmerged", "-z") || check.n) {
        bad("UNMERGED_INDEX");
        goto done;
    }
    drop(&check);
    if (GIT(repo, &tracked, "ls-files", "--cached", "-z")) {
        bad("GIT_FAILED");
        goto done;
    }
    /* Gitlinks and LFS inputs require their own qualified hydration envelope. */
    if (GIT(repo, &check, "ls-files", "--stage", "-z")) {
        bad("GIT_FAILED");
        goto done;
    }
    for (size_t i = 0; i + 7 < check.n; i++)
        if ((i == 0 || check.p[i - 1] == 0) && !memcmp(check.p + i, "160000 ", 7)) {
            bad("SUBMODULE_UNSUPPORTED");
            goto done;
        }
    drop(&check);
    if (collect(repo, repo, "", &tracked, &p.tree, &count))
        goto done;
    if (GIT(repo, &p.patch, "diff", "--cached", "--binary", "--full-index", "--no-ext-diff",
            "--no-textconv", "HEAD", "--")) {
        bad("GIT_FAILED");
        goto done;
    }
    snprintf(tmp, sizeof tmp, ".capture-%ld-%u", (long)getpid(), (unsigned)rand());
    if (mkdirat(spool, tmp, 0700)) {
        bad("IO_ERROR");
        goto done;
    }
    td = openat(spool, tmp, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (td < 0) {
        bad("IO_ERROR");
        goto done;
    }
    char proc[128];
    snprintf(proc, sizeof proc, "/proc/self/fd/%d/bundle", td);
    int flags = fcntl(td, F_GETFD);
    fcntl(td, F_SETFD, flags & ~FD_CLOEXEC);
    if (GIT(repo, NULL, "bundle", "create", proc, "HEAD") || filebuf(td, "bundle", &p.bundle)) {
        bad("BUNDLE_FAILED");
        goto done;
    }
    fcntl(td, F_SETFD, flags);
    if (collect(repo, repo, "", &tracked, &again, &count2) || p.tree.n != again.n ||
        (p.tree.n && memcmp(p.tree.p, again.p, p.tree.n))) {
        bad("UNSTABLE_SOURCE");
        goto done;
    }
    if (gittext(repo, &check, "rev-parse", "HEAD") || strcmp((char *)check.p, (char *)head.p)) {
        bad("UNSTABLE_SOURCE");
        goto done;
    }
    drop(&check);
    if (GIT(repo, &check, "diff", "--cached", "--binary", "--full-index", "--no-ext-diff",
            "--no-textconv", "HEAD", "--") ||
        p.patch.n != check.n || (p.patch.n && memcmp(p.patch.p, check.p, p.patch.n))) {
        bad("UNSTABLE_SOURCE");
        goto done;
    }
    if (append(&full, "HFCP0001", 8) || u64(&full, p.meta.n) || u64(&full, p.bundle.n) ||
        u64(&full, p.patch.n) || u64(&full, p.tree.n) || append(&full, p.meta.p, p.meta.n) ||
        append(&full, p.bundle.p, p.bundle.n) || append(&full, p.patch.p, p.patch.n) ||
        append(&full, p.tree.p, p.tree.n))
        goto done;
    char digest[72], md[72], name[80];
    hashbuf(&full, digest);
    hashbuf(&p.meta, md);
    snprintf(name, sizeof name, "%s.hfc", digest + 7);
    if (putfile(td, "capsule", full.p, full.n, 0600))
        goto done;
    if (linkat(td, "capsule", spool, name, 0)) {
        if (errno != EEXIST) {
            bad("IO_ERROR");
            goto done;
        }
        Buf old = {0};
        if (filebuf(spool, name, &old) || old.n != full.n || memcmp(old.p, full.p, full.n)) {
            drop(&old);
            bad("OBJECT_CONFLICT");
            goto done;
        }
        drop(&old);
    }
    if (fsync(spool)) {
        bad("IO_ERROR");
        goto done;
    }
    fprintf(out,
            "{\"capture_state\":\"LOCAL_COMPLETE\",\"durability\":\"UNCONFIRMED\",\"authority\":"
            "\"NONE\",\"checkpoint_digest\":\"%s\",\"manifest_digest\":\"%s\",\"size_bytes\":\"%"
            "zu\",\"chunk_count\":%zu,\"file_entry_count\":%u}",
            digest, md, full.n, (full.n + CHUNK - 1) / CHUNK, count);
    r = 0;
done:
    if (td >= 0)
        close(td);
    if (*tmp)
        cleanup(spool, tmp);
    partsdrop(&p);
    drop(&head);
    drop(&branch);
    drop(&tracked);
    drop(&again);
    drop(&check);
    drop(&full);
    close(lf);
    close(repo);
    return r;
}
static const char b64chars[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
static void base64(FILE *out, const unsigned char *p, size_t n) {
    for (size_t i = 0; i < n; i += 3) {
        unsigned v = p[i] << 16;
        if (i + 1 < n)
            v |= p[i + 1] << 8;
        if (i + 2 < n)
            v |= p[i + 2];
        fputc(b64chars[v >> 18], out);
        fputc(b64chars[(v >> 12) & 63], out);
        fputc(i + 1 < n ? b64chars[(v >> 6) & 63] : '=', out);
        fputc(i + 2 < n ? b64chars[v & 63] : '=', out);
    }
}
static int inspect_export(Obj *o, int spool, FILE *out, int exporting) {
    const char *keys[] = {"checkpoint_digest", "offset", "length", NULL};
    if (allowed(o, keys))
        return -1;
    if (!exporting && (get(o, "offset") || get(o, "length")))
        return bad("UNKNOWN_FIELD");
    Buf full = {0};
    Parts p = {0};
    int r = capsule(spool, get(o, "checkpoint_digest"), &full, &p);
    if (r)
        goto done;
    if (exporting) {
        uint64_t offset, length;
        if (!decimal(get(o, "offset"), &offset) || !decimal(get(o, "length"), &length) || !length ||
            length > CHUNK || offset > full.n || length > full.n - offset) {
            r = bad("INVALID_RANGE");
            goto done;
        }
        fprintf(out,
                "{\"checkpoint_digest\":\"%s\",\"offset\":\"%llu\",\"size_bytes\":\"%zu\",\"data_"
                "base64\":\"",
                get(o, "checkpoint_digest"), (unsigned long long)offset, full.n);
        base64(out, full.p + offset, length);
        fprintf(out, "\"}");
    } else {
        char md[72];
        hashbuf(&p.meta, md);
        fprintf(out,
                "{\"capture_state\":\"LOCAL_COMPLETE\",\"durability\":\"UNCONFIRMED\",\"checkpoint_"
                "digest\":\"%s\",\"manifest_digest\":\"%s\",\"size_bytes\":\"%zu\",\"manifest\":",
                get(o, "checkpoint_digest"), md, full.n);
        fwrite(p.meta.p, 1, p.meta.n, out);
        fprintf(out, "}");
    }
done:
    drop(&full);
    partsdrop(&p);
    return r;
}
static int parentfd(int root, const char *path, char **leaf) {
    if (!safe_path(path))
        return bad("UNSAFE_PATH");
    char *c = strdup(path);
    if (!c)
        return -1;
    char *slash = strrchr(c, '/');
    int fd;
    if (slash) {
        *slash = 0;
        fd = relative_dir(root, c);
        *leaf = strdup(slash + 1);
    } else {
        fd = dup(root);
        *leaf = strdup(c);
    }
    free(c);
    return fd;
}
static int clearwork(int fd) {
    DIR *d = fdopendir(dup(fd));
    if (!d)
        return bad("IO_ERROR");
    rewinddir(d);
    struct dirent *e;
    int r = 0;
    while ((e = readdir(d)))
        if (strcmp(e->d_name, ".") && strcmp(e->d_name, "..") && strcmp(e->d_name, ".git"))
            if (cleanup(fd, e->d_name)) {
                r = bad("IO_ERROR");
                break;
            }
    closedir(d);
    return r;
}
static int restore_tree(int dir, Buf *tree) {
    size_t off = 0;
    unsigned count = 0;
    Buf paths = {0};
    int r = 0;
    while (off < tree->n) {
        if (tree->n - off < 17) {
            r = bad("INVALID_TREE");
            break;
        }
        uint32_t pn = r32(tree->p + off), mode = r32(tree->p + off + 12);
        uint64_t n = r64(tree->p + off + 4);
        unsigned kind = tree->p[off + 16];
        off += 17;
        if (!pn || pn > 4096 || n > MAX_FILE || pn > tree->n - off || n > tree->n - off - pn ||
            mode > 0777 || ++count > MAX_ITEMS) {
            r = bad("INVALID_TREE");
            break;
        }
        char *path = malloc(pn + 1);
        if (!path) {
            r = bad("RESOURCE_LIMIT");
            break;
        }
        memcpy(path, tree->p + off, pn);
        path[pn] = 0;
        if (memchr(path, 0, pn) || !safe_path(path) || sensitive(path)) {
            free(path);
            r = bad("UNSAFE_PATH");
            break;
        }
        for (size_t i = 0; i < paths.n;) {
            char *prior = (char *)paths.p + i;
            if (!strcmp(prior, path)) {
                r = bad("DUPLICATE_PATH");
                break;
            }
            i += strlen(prior) + 1;
        }
        if (r) {
            free(path);
            break;
        }
        append(&paths, path, pn + 1);
        char *leaf = NULL;
        int parent = parentfd(dir, path, &leaf);
        if (parent < 0) {
            free(path);
            free(leaf);
            r = bad("INVALID_TREE_ORDER");
            break;
        }
        const unsigned char *data = tree->p + off + pn;
        if (kind == 2) {
            if (n || mkdirat(parent, leaf, 0700))
                r = bad("INVALID_DIRECTORY");
        } else if (kind == 1) {
            r = putfile(parent, leaf, data, n, mode);
        } else if (kind == 3) {
            char *t = malloc(n + 1);
            if (!t)
                r = bad("RESOURCE_LIMIT");
            else {
                memcpy(t, data, n);
                t[n] = 0;
                if (!n || memchr(t, 0, n) || !safe_path(t) || symlinkat(t, parent, leaf))
                    r = bad("UNSAFE_SYMLINK");
                free(t);
            }
        } else
            r = bad("INVALID_KIND");
        close(parent);
        free(leaf);
        free(path);
        if (r)
            break;
        off += pn + n;
    }
    /* Apply directory modes after descendants, so read-only directories are safe. */
    if (!r) {
        size_t *offsets = calloc(count ? count : 1, sizeof(size_t));
        size_t dirs = 0;
        if (!offsets)
            r = bad("RESOURCE_LIMIT");
        else {
            off = 0;
            while (off < tree->n) {
                uint32_t pn = r32(tree->p + off);
                uint64_t n = r64(tree->p + off + 4);
                if (tree->p[off + 16] == 2)
                    offsets[dirs++] = off;
                off += 17 + pn + n;
            }
            while (dirs) {
                off = offsets[--dirs];
                uint32_t pn = r32(tree->p + off), mode = r32(tree->p + off + 12);
                char path[4097];
                memcpy(path, tree->p + off + 17, pn);
                path[pn] = 0;
                int fd = relative_dir(dir, path);
                if (fd < 0 || fchmod(fd, mode)) {
                    if (fd >= 0)
                        close(fd);
                    r = bad("IO_ERROR");
                    break;
                }
                close(fd);
            }
            free(offsets);
        }
    }
    drop(&paths);
    return r;
}
static int restore(Obj *o, int root, int spool, FILE *out) {
    const char *keys[] = {"checkpoint_digest", "candidate_path", "repository_id",
                          "preparation_digest", NULL};
    if (allowed(o, keys))
        return -1;
    const char *dest = get(o, "candidate_path");
    if (!safe_path(dest) || strchr(dest, '/'))
        return bad("RESTORE_FRESH_LEAF_REQUIRED");
    Buf full = {0}, head = {0};
    Parts p = {0};
    Obj meta = {0};
    int stage = -1, r = -1;
    char tmp[80] = "";
    if (capsule(spool, get(o, "checkpoint_digest"), &full, &p) || append(&p.meta, "", 1) ||
        parse((char *)p.meta.p, &meta))
        goto done;
    if (!uuid(get(o, "repository_id")) || !digest_ok(get(o, "preparation_digest")) ||
        !get(&meta, "repository_id") || !get(&meta, "preparation_digest") ||
        strcmp(get(o, "repository_id"), get(&meta, "repository_id")) ||
        strcmp(get(o, "preparation_digest"), get(&meta, "preparation_digest"))) {
        bad("RECOVERY_IDENTITY_MISMATCH");
        goto done;
    }
    struct stat st;
    if (!fstatat(root, dest, &st, AT_SYMLINK_NOFOLLOW) || errno != ENOENT) {
        bad("RESTORE_DESTINATION_EXISTS");
        goto done;
    }
    snprintf(tmp, sizeof tmp, ".restore-%ld-%u", (long)getpid(), (unsigned)rand());
    if (mkdirat(root, tmp, 0700)) {
        bad("IO_ERROR");
        goto done;
    }
    stage = openat(root, tmp, O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (stage < 0) {
        bad("IO_ERROR");
        goto done;
    }
    if (putfile(stage, "source.bundle", p.bundle.p, p.bundle.n, 0600) ||
        putfile(stage, "index.patch", p.patch.p, p.patch.n, 0600))
        goto done;
    if (GIT(stage, NULL, "clone", "--no-hardlinks", "--no-checkout", "source.bundle", "repo")) {
        bad("BUNDLE_INVALID");
        goto done;
    }
    int repo = openat(stage, "repo", O_RDONLY | O_DIRECTORY | O_NOFOLLOW | O_CLOEXEC);
    if (repo < 0) {
        bad("IO_ERROR");
        goto done;
    }
    if (gittext(repo, &head, "rev-parse", "HEAD") || !get(&meta, "head_commit") ||
        strcmp((char *)head.p, get(&meta, "head_commit"))) {
        close(repo);
        bad("SOURCE_IDENTITY_MISMATCH");
        goto done;
    }
    const char *branch = get(&meta, "branch_ref");
    if (!branch || strncmp(branch, "refs/heads/", 11) ||
        GIT(repo, NULL, "check-ref-format", branch) ||
        GIT(repo, NULL, "symbolic-ref", "HEAD", branch) ||
        GIT(repo, NULL, "reset", "--hard", get(&meta, "head_commit"))) {
        close(repo);
        bad("INVALID_SOURCE_IDENTITY");
        goto done;
    }
    if (p.patch.n &&
        GIT(repo, NULL, "apply", "--cached", "--binary", "--whitespace=nowarn", "../index.patch")) {
        close(repo);
        bad("INDEX_RESTORE_FAILED");
        goto done;
    }
    uint64_t rootmode;
    if (!decimal(get(&meta, "workspace_mode"), &rootmode) || rootmode > 0777) {
        close(repo);
        bad("INVALID_WORKSPACE_MODE");
        goto done;
    }
    if (clearwork(repo) || restore_tree(repo, &p.tree) ||
        GIT(repo, NULL, "remote", "remove", "origin") || fchmod(repo, rootmode) || fsync(repo)) {
        close(repo);
        goto done;
    }
    close(repo);
    if (syscall(SYS_renameat2, stage, "repo", root, dest, 1U) || fsync(root)) {
        bad("RESTORE_PUBLICATION_FAILED");
        goto done;
    }
    fprintf(out,
            "{\"capture_state\":\"LOCAL_RESTORED\",\"native_context\":\"NOT_RESTORED\","
            "\"authority\":\"NONE\",\"checkpoint_digest\":\"%s\",\"repository_id\":\"%s\"}",
            get(o, "checkpoint_digest"), get(o, "repository_id"));
    r = 0;
done:
    if (stage >= 0)
        close(stage);
    if (*tmp)
        cleanup(root, tmp);
    drop(&full);
    drop(&head);
    partsdrop(&p);
    freeobj(&meta);
    return r;
}
int hf_component_15_1(const char *action, const char *request, FILE *out) {
    failure = NULL;
    Obj o = {0};
    int result = parse(request, &o);
    int root = -1, spool = -1;
    if (!result) {
        root = open_dir_path(getenv("HF_CHECKPOINT_ALLOWED_ROOT"));
        spool = open_dir_path(getenv("HF_CHECKPOINT_SPOOL_ROOT"));
        if (root < 0 || spool < 0)
            result = bad("TRUSTED_ROOT_REQUIRED");
    }
    if (!result) {
        struct stat a, b;
        if (fstat(root, &a) || fstat(spool, &b) || (a.st_dev == b.st_dev && a.st_ino == b.st_ino) ||
            b.st_uid != geteuid() || (b.st_mode & 0077))
            result = bad("PRIVATE_SEPARATE_SPOOL_REQUIRED");
    }
    if (!result) {
        if (!strcmp(action, "checkpoint.capture"))
            result = capture(&o, root, spool, out);
        else if (!strcmp(action, "checkpoint.inspect"))
            result = inspect_export(&o, spool, out, 0);
        else if (!strcmp(action, "checkpoint.export"))
            result = inspect_export(&o, spool, out, 1);
        else if (!strcmp(action, "checkpoint.restore"))
            result = restore(&o, root, spool, out);
        else
            result = bad("UNKNOWN_ACTION");
    }
    if (root >= 0)
        close(root);
    if (spool >= 0)
        close(spool);
    freeobj(&o);
    if (result) {
        fprintf(out, "{\"capture_state\":\"REFUSED\",\"code\":\"%s\",\"authority\":\"NONE\"}",
                failure ? failure : "IO_ERROR");
        return 0;
    }
    return 0;
}
