#include "cg.h"
#include <dirent.h>
#include <errno.h>
#include <sys/stat.h>
#include <sys/time.h>
#include <fnmatch.h>
#include <unistd.h>

void *xmalloc(size_t n) {
    void *p = malloc(n ? n : 1);
    if (!p) { fprintf(stderr, "cg: out of memory (%zu bytes)\n", n); exit(2); }
    return p;
}
void *xrealloc(void *p, size_t n) {
    void *q = realloc(p, n ? n : 1);
    if (!q) { fprintf(stderr, "cg: out of memory (%zu bytes)\n", n); exit(2); }
    return q;
}
char *xstrdup(const char *s) {
    size_t n = strlen(s) + 1;
    char *p = xmalloc(n);
    memcpy(p, s, n);
    return p;
}

void sb_init(StrBuf *b) { b->p = xmalloc(256); b->p[0] = 0; b->len = 0; b->cap = 256; }
void sb_free(StrBuf *b) { free(b->p); b->p = NULL; b->len = b->cap = 0; }
static void sb_grow(StrBuf *b, size_t need) {
    if (b->len + need + 1 <= b->cap) return;
    while (b->cap < b->len + need + 1) b->cap *= 2;
    b->p = xrealloc(b->p, b->cap);
}
void sb_putc(StrBuf *b, char c) { sb_grow(b, 1); b->p[b->len++] = c; b->p[b->len] = 0; }
void sb_puts(StrBuf *b, const char *s) {
    size_t n = strlen(s);
    sb_grow(b, n);
    memcpy(b->p + b->len, s, n + 1);
    b->len += n;
}
void sb_printf(StrBuf *b, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    va_list ap2;
    va_copy(ap2, ap);
    int n = vsnprintf(NULL, 0, fmt, ap);
    va_end(ap);
    if (n < 0) { va_end(ap2); return; }
    sb_grow(b, (size_t)n);
    vsnprintf(b->p + b->len, (size_t)n + 1, fmt, ap2);
    va_end(ap2);
    b->len += (size_t)n;
}
void sb_json_str(StrBuf *b, const char *s) {
    sb_putc(b, '"');
    for (const unsigned char *p = (const unsigned char *)s; *p; p++) {
        switch (*p) {
        case '"':  sb_puts(b, "\\\""); break;
        case '\\': sb_puts(b, "\\\\"); break;
        case '\n': sb_puts(b, "\\n");  break;
        case '\r': sb_puts(b, "\\r");  break;
        case '\t': sb_puts(b, "\\t");  break;
        default:
            if (*p < 0x20) sb_printf(b, "\\u%04x", *p);
            else sb_putc(b, (char)*p);
        }
    }
    sb_putc(b, '"');
}

char *read_entire_file(const char *path, size_t *out_len) {
    /* chunked read: works for regular files AND /proc//sys files that
       report st_size == 0 */
    FILE *f = fopen(path, "rb");
    if (!f) return NULL;
    size_t cap = 8192, len = 0;
    char *buf = xmalloc(cap);
    for (;;) {
        if (len + 4096 + 1 > cap) {
            cap *= 2;
            buf = xrealloc(buf, cap);
        }
        size_t rd = fread(buf + len, 1, 4096, f);
        len += rd;
        if (rd < 4096) {
            if (ferror(f)) { fclose(f); free(buf); return NULL; }
            break;
        }
    }
    fclose(f);
    buf[len] = 0;
    if (out_len) *out_len = len;
    return buf;
}

/* sha256 of the raw bytes of lines [from..to], 1-based inclusive, each
 * line taken through its newline. The anchored_hash identity: scan.c
 * baselines with it at index time, graph.c re-derives it at render time,
 * and 20_anchors locks the byte range from the outside. */
void hash_lines(const char *data, size_t len, int from, int to,
                char out_hex[65]) {
    const char *p = data, *end = data + len, *a = NULL, *b = end;
    int line = 1;
    while (p < end && line <= to) {
        const char *nl = memchr(p, '\n', (size_t)(end - p));
        const char *stop = nl ? nl + 1 : end;
        if (line == from) a = p;
        if (line == to) b = stop;
        p = stop;
        line++;
        if (!nl) break;
    }
    if (!a || b < a) { sha256_hex("", 0, out_hex); return; }
    sha256_hex(a, (size_t)(b - a), out_hex);
}

int write_entire_file(const char *path, const void *data, size_t len) {
    /* temp + rename in the same directory: lock-free readers see either the
       old file or the new one, never a truncated or partial write */
    size_t plen = strlen(path);
    char *tmp = xmalloc(plen + 32);
    snprintf(tmp, plen + 32, "%s.tmp.%ld", path, (long)getpid());
    FILE *f = fopen(tmp, "wb");
    if (!f) { free(tmp); return -1; }
    size_t wr = fwrite(data, 1, len, f);
    if (wr != len || fflush(f) != 0) {
        fclose(f);
        unlink(tmp);
        free(tmp);
        return -1;
    }
    if (fclose(f) != 0 || rename(tmp, path) != 0) {
        unlink(tmp);
        free(tmp);
        return -1;
    }
    free(tmp);
    return 0;
}

int mkdirs(const char *path) {
    char tmp[4096];
    snprintf(tmp, sizeof tmp, "%s", path);
    for (char *p = tmp + 1; *p; p++) {
        if (*p == '/') {
            *p = 0;
            if (mkdir(tmp, 0755) != 0 && errno != EEXIST) return -1;
            *p = '/';
        }
    }
    if (mkdir(tmp, 0755) != 0 && errno != EEXIST) return -1;
    return 0;
}

/* run fn with stdout redirected to a temp file; captured text -> *out */
int cg_capture(char **out, int (*fn)(void *), void *ctx) {
    fflush(stdout);
    int saved = dup(1);
    FILE *tmp = tmpfile();
    if (saved < 0 || !tmp) {
        if (saved >= 0) close(saved);
        if (tmp) fclose(tmp);
        *out = xstrdup("");
        return fn(ctx);
    }
    dup2(fileno(tmp), 1);
    int rc = fn(ctx);
    fflush(stdout);
    dup2(saved, 1);
    close(saved);
    long sz = ftell(tmp);
    rewind(tmp);
    char *buf = xmalloc((size_t)(sz > 0 ? sz : 0) + 1);
    size_t rd = sz > 0 ? fread(buf, 1, (size_t)sz, tmp) : 0;
    buf[rd] = 0;
    fclose(tmp);
    *out = buf;
    return rc;
}

long now_ms(void) {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (long)tv.tv_sec * 1000 + tv.tv_usec / 1000;
}

bool looks_binary(const char *data, size_t len) {
    size_t n = len < 8192 ? len : 8192;
    for (size_t i = 0; i < n; i++)
        if (data[i] == 0) return true;
    return false;
}

const char *path_ext(const char *path) {
    const char *base = strrchr(path, '/');
    base = base ? base + 1 : path;
    const char *dot = strrchr(base, '.');
    return dot ? dot : "";
}

/* Who is acting? An explicit --agent flag wins, then $CG_AGENT (how a
 * parallel orchestrator names each worker), then a shared default. Never
 * NULL, never malloc'd — always safe to print or bind. */
const char *cg_agent_name(const char *flag) {
    if (flag && flag[0]) return flag;
    const char *env = getenv("CG_AGENT");
    if (env && env[0]) return env;
    return "agent";
}

/* ---------------- ignore rules ---------------- */

static const char *DEFAULT_IGNORES[] = {
    ".git", ".hg", ".svn", CG_DIR, "node_modules", "bower_components",
    "dist", "build", "out", "target", "vendor", "venv", ".venv", "env",
    "__pycache__", ".mypy_cache", ".pytest_cache", ".tox", ".idea",
    ".vscode", "coverage", ".next", ".nuxt", ".cache", "Pods",
    "*.min.js", "*.min.css", "*.map", "*.lock", "package-lock.json",
    "*.o", "*.a", "*.so", "*.dylib", "*.dll", "*.exe", "*.class",
    "*.pyc", "*.jar", "*.zip", "*.tar", "*.gz", "*.png", "*.jpg",
    "*.jpeg", "*.gif", "*.ico", "*.svg", "*.woff", "*.woff2", "*.ttf",
    "*.pdf", "*.mp4", "*.mp3", "*.db", "*.sqlite",
    NULL
};

static void ig_add_flags(Ignore *ig, const char *pat, bool negate,
                         bool dir_only, bool anchored) {
    if (!pat[0]) return;
    if (ig->n == ig->cap) {
        ig->cap = ig->cap ? ig->cap * 2 : 64;
        ig->pats = xrealloc(ig->pats, sizeof(IgnorePat) * (size_t)ig->cap);
    }
    IgnorePat *e = &ig->pats[ig->n++];
    e->pat = xstrdup(pat);
    e->negate = negate;
    e->dir_only = dir_only;
    e->anchored = anchored;
}

static void ig_add(Ignore *ig, const char *pat) {
    ig_add_flags(ig, pat, false, false, strchr(pat, '/') != NULL);
}

/* Parse one ignore file with gitignore semantics: `#` comments, `!` negation,
 * a trailing `/` restricting to directories, and a leading or interior `/`
 * anchoring the pattern to the repository root instead of matching basenames.
 * Later entries win, which is what makes `!` work. */
static void ig_load_file(Ignore *ig, const char *path) {
    char *body = read_entire_file(path, NULL);
    if (!body) return;
    char *save = NULL;
    for (char *line = strtok_r(body, "\n", &save); line;
         line = strtok_r(NULL, "\n", &save)) {
        while (*line == ' ' || *line == '\t') line++;
        size_t n = strlen(line);
        while (n && (line[n-1] == ' ' || line[n-1] == '\r')) line[--n] = 0;
        if (!n || line[0] == '#') continue;
        bool negate = false;
        if (line[0] == '!') { negate = true; line++; n--; }
        else if (line[0] == '\\' && (line[1] == '#' || line[1] == '!')) {
            line++; n--;                     /* escaped literal # or ! */
        }
        bool dir_only = false;
        while (n && line[n-1] == '/') { dir_only = true; line[--n] = 0; }
        if (!n) continue;
        bool anchored = strchr(line, '/') != NULL;
        if (line[0] == '/') { line++; n--; anchored = true; }
        if (!n) continue;
        ig_add_flags(ig, line, negate, dir_only, anchored);
    }
    free(body);
}

/* Rules from a nested .gitignore apply only beneath its own directory, so
 * rebase each pattern onto that prefix: an unanchored name gains a
 * double-star segment under the directory, an anchored one is joined
 * directly. Either way the result is matched against the full rel path. */
static void ig_load_nested(Ignore *ig, const char *root, const char *reldir) {
    char path[4700];
    snprintf(path, sizeof path, "%s/%s/.gitignore", root, reldir);
    int before = ig->n;
    ig_load_file(ig, path);
    int after = ig->n;
    for (int i = before; i < after; i++) {
        IgnorePat *e = &ig->pats[i];
        bool deep = !e->anchored;
        StrBuf b; sb_init(&b);
        sb_printf(&b, "%s/%s", reldir, e->pat);
        /* An unanchored name also matches at any depth below the directory.
         * fnmatch's `**` will not match zero segments, so that case needs its
         * own entry rather than a single double-star pattern. */
        if (deep) {
            StrBuf d; sb_init(&d);
            sb_printf(&d, "%s/**/%s", reldir, e->pat);
            ig_add_flags(ig, d.p, e->negate, e->dir_only, true);
            sb_free(&d);
            e = &ig->pats[i];         /* ig_add_flags may realloc */
        }
        free(e->pat);
        e->pat = b.p;
        e->anchored = true;
    }
}

/* Collect nested .gitignore files, bounded in depth so the scan stays cheap
 * on deep trees. Directories already ignored are not descended into. */
static void ig_walk_gitignores(Ignore *ig, const char *root,
                               const char *reldir, int depth) {
    if (depth > 6) return;
    char abs[4700];
    snprintf(abs, sizeof abs, "%s%s%s", root, reldir[0] ? "/" : "", reldir);
    DIR *d = opendir(abs);
    if (!d) return;
    struct dirent *e;
    while ((e = readdir(d))) {
        if (e->d_name[0] == '.') continue;
        char rel[4700];
        snprintf(rel, sizeof rel, "%s%s%s", reldir, reldir[0] ? "/" : "",
                 e->d_name);
        char child[4800];
        snprintf(child, sizeof child, "%s/%s", root, rel);
        struct stat st;
        if (stat(child, &st) != 0 || !S_ISDIR(st.st_mode)) continue;
        if (ignore_match(ig, rel, true)) continue;
        ig_load_nested(ig, root, rel);
        ig_walk_gitignores(ig, root, rel, depth + 1);
    }
    closedir(d);
}

void ignore_load(Ignore *ig, const char *root) {
    memset(ig, 0, sizeof *ig);
    for (int i = 0; DEFAULT_IGNORES[i]; i++) ig_add(ig, DEFAULT_IGNORES[i]);
    char path[4096];
    /* .gitignore first so an explicit .cgignore rule can still override it */
    snprintf(path, sizeof path, "%s/.gitignore", root);
    ig_load_file(ig, path);
    ig_walk_gitignores(ig, root, "", 0);
    snprintf(path, sizeof path, "%s/%s", root, CG_IGNORE);
    ig_load_file(ig, path);
}

/* fnmatch with `**` allowed to span separators, as gitignore specifies */
static bool pat_match(const char *pat, const char *text, bool anchored) {
    int flags = anchored && !strstr(pat, "**") ? FNM_PATHNAME : 0;
    return fnmatch(pat, text, flags) == 0;
}

static bool ig_entry_hits(const IgnorePat *e, const char *rel,
                          const char *base, bool is_dir) {
    if (e->dir_only && !is_dir) return false;
    if (e->anchored) {
        if (pat_match(e->pat, rel, true)) return true;
        /* an anchored directory rule also covers everything beneath it */
        size_t pl = strlen(e->pat);
        if (strncmp(rel, e->pat, pl) == 0 && rel[pl] == '/') return true;
        return false;
    }
    if (pat_match(e->pat, base, false)) return true;
    /* an unanchored name matches at any depth, including parent segments */
    const char *p = rel;
    for (;;) {
        const char *slash = strchr(p, '/');
        if (!slash) break;
        size_t seg = (size_t)(slash - p);
        if (strlen(e->pat) == seg && strncmp(e->pat, p, seg) == 0) return true;
        p = slash + 1;
    }
    return false;
}

bool ignore_match(const Ignore *ig, const char *rel, bool is_dir) {
    const char *base = strrchr(rel, '/');
    base = base ? base + 1 : rel;
    if (base[0] == '.' && strcmp(base, ".") != 0) {
        /* Keep authored GitHub automation visible to snapshots and task
         * traces while retaining the fail-closed default for secret-bearing
         * and tool-owned hidden paths. Negation cannot reopen this. */
        if (strcmp(base, CG_IGNORE) != 0 && strcmp(base, ".github") != 0 &&
            strcmp(base, ".gitignore") != 0)
            return true;
    }
    bool ignored = false;
    for (int i = 0; i < ig->n; i++) {
        const IgnorePat *e = &ig->pats[i];
        if (!ig_entry_hits(e, rel, base, is_dir)) continue;
        /* A root build directory is generated output, but repositories
         * commonly keep authored build rules under tools/build. */
        if (is_dir && !e->negate && strcmp(e->pat, "build") == 0 &&
            strchr(rel, '/') != NULL)
            continue;
        ignored = !e->negate;      /* last matching rule wins */
    }
    return ignored;
}

void ignore_free(Ignore *ig) {
    for (int i = 0; i < ig->n; i++) free(ig->pats[i].pat);
    free(ig->pats);
    memset(ig, 0, sizeof *ig);
}
