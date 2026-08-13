#include "cg.h"
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

int write_entire_file(const char *path, const void *data, size_t len) {
    FILE *f = fopen(path, "wb");
    if (!f) return -1;
    size_t wr = fwrite(data, 1, len, f);
    if (fclose(f) != 0 || wr != len) return -1;
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

static void ig_add(Ignore *ig, const char *pat) {
    if (ig->n == ig->cap) {
        ig->cap = ig->cap ? ig->cap * 2 : 32;
        ig->pats = xrealloc(ig->pats, sizeof(char *) * (size_t)ig->cap);
    }
    ig->pats[ig->n++] = xstrdup(pat);
}

void ignore_load(Ignore *ig, const char *root) {
    memset(ig, 0, sizeof *ig);
    for (int i = 0; DEFAULT_IGNORES[i]; i++) ig_add(ig, DEFAULT_IGNORES[i]);
    char path[4096];
    snprintf(path, sizeof path, "%s/%s", root, CG_IGNORE);
    char *body = read_entire_file(path, NULL);
    if (!body) return;
    char *save = NULL;
    for (char *line = strtok_r(body, "\n", &save); line; line = strtok_r(NULL, "\n", &save)) {
        while (*line == ' ' || *line == '\t') line++;
        size_t n = strlen(line);
        while (n && (line[n-1] == ' ' || line[n-1] == '\r' || line[n-1] == '/')) line[--n] = 0;
        if (!n || line[0] == '#') continue;
        ig_add(ig, line);
    }
    free(body);
}

bool ignore_match(const Ignore *ig, const char *rel, bool is_dir) {
    (void)is_dir;
    const char *base = strrchr(rel, '/');
    base = base ? base + 1 : rel;
    if (base[0] == '.' && strcmp(base, ".") != 0) {
        /* hidden files/dirs skipped except a few known source names */
        if (strcmp(base, CG_IGNORE) != 0) return true;
    }
    for (int i = 0; i < ig->n; i++) {
        if (fnmatch(ig->pats[i], base, 0) == 0) return true;
        if (strchr(ig->pats[i], '/') && fnmatch(ig->pats[i], rel, FNM_PATHNAME) == 0)
            return true;
    }
    return false;
}

void ignore_free(Ignore *ig) {
    for (int i = 0; i < ig->n; i++) free(ig->pats[i]);
    free(ig->pats);
    memset(ig, 0, sizeof *ig);
}
