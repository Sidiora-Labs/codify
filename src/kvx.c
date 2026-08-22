/*
 * kvx: parser for the Ion .kvx sectioned key/value format, mirroring the
 * grammar of ion-agent's spec/specgen/kvx.go — one `key = value` per line,
 * [section] / [section.sub] headers, double-quoted strings, ["a","b"] lists,
 * ${ENV} interpolation, # comments outside quotes. Preserves section and key
 * order so rendered output is deterministic.
 *
 * Also provides a surgical writer: rewrite one `status = "..."` line inside
 * one section, leaving every other byte of the file untouched (the .kvx is
 * the user's source of truth — formatting and comments must survive).
 */
#include "cg.h"
#include <ctype.h>

/* strip # comment outside quotes; returns new length */
static size_t strip_comment(char *s, size_t n) {
    bool inq = false;
    for (size_t i = 0; i < n; i++) {
        if (s[i] == '"') inq = !inq;
        else if (s[i] == '#' && !inq) { n = i; break; }
    }
    while (n && (s[n-1] == ' ' || s[n-1] == '\t' || s[n-1] == '\r')) n--;
    s[n] = 0;
    return n;
}

static char *trim(char *s) {
    while (*s == ' ' || *s == '\t') s++;
    size_t n = strlen(s);
    while (n && (s[n-1] == ' ' || s[n-1] == '\t' || s[n-1] == '\r')) s[--n] = 0;
    return s;
}

static void kvx_add_section(Kvx *k, const char *sec) {
    for (int i = 0; i < k->nsec; i++)
        if (strcmp(k->secs[i], sec) == 0) return;
    if (k->nsec == k->csec) {
        k->csec = k->csec ? k->csec * 2 : 32;
        k->secs = xrealloc(k->secs, sizeof(char *) * (size_t)k->csec);
    }
    k->secs[k->nsec++] = xstrdup(sec);
}

Kvx *kvx_parse(const char *path) {
    char *body = read_entire_file(path, NULL);
    if (!body) return NULL;
    Kvx *k = xmalloc(sizeof *k);
    memset(k, 0, sizeof *k);
    k->path = xstrdup(path);
    char section[256] = "";
    char *save = NULL;
    for (char *line = strtok_r(body, "\n", &save); line;
         line = strtok_r(NULL, "\n", &save)) {
        line = trim(line);
        strip_comment(line, strlen(line));
        if (!line[0]) continue;
        if (line[0] == '[') {
            size_t n = strlen(line);
            if (line[n-1] != ']') { kvx_free(k); free(body); return NULL; }
            line[n-1] = 0;
            snprintf(section, sizeof section, "%s", trim(line + 1));
            kvx_add_section(k, section);
            continue;
        }
        char *eq = strchr(line, '=');
        if (!eq) { kvx_free(k); free(body); return NULL; }
        *eq = 0;
        char *key = trim(line);
        char *val = trim(eq + 1);
        if (!key[0]) { kvx_free(k); free(body); return NULL; }
        kvx_add_section(k, section);
        /* duplicate key: keep position, overwrite value (Go semantics) */
        bool dup = false;
        for (int i = 0; i < k->n; i++)
            if (strcmp(k->v[i].section, section) == 0 &&
                strcmp(k->v[i].key, key) == 0) {
                free(k->v[i].raw);
                k->v[i].raw = xstrdup(val);
                dup = true;
                break;
            }
        if (!dup) {
            if (k->n == k->cap) {
                k->cap = k->cap ? k->cap * 2 : 128;
                k->v = xrealloc(k->v, sizeof(KvxEntry) * (size_t)k->cap);
            }
            k->v[k->n].section = xstrdup(section);
            k->v[k->n].key = xstrdup(key);
            k->v[k->n].raw = xstrdup(val);
            k->n++;
        }
    }
    free(body);
    return k;
}

void kvx_free(Kvx *k) {
    if (!k) return;
    for (int i = 0; i < k->n; i++) {
        free(k->v[i].section); free(k->v[i].key); free(k->v[i].raw);
    }
    free(k->v);
    for (int i = 0; i < k->nsec; i++) free(k->secs[i]);
    free(k->secs);
    free(k->path);
    free(k);
}

bool kvx_has(const Kvx *k, const char *sec) {
    for (int i = 0; i < k->nsec; i++)
        if (strcmp(k->secs[i], sec) == 0) return true;
    return false;
}

const char *kvx_raw(const Kvx *k, const char *sec, const char *key) {
    for (int i = 0; i < k->n; i++)
        if (strcmp(k->v[i].section, sec) == 0 && strcmp(k->v[i].key, key) == 0)
            return k->v[i].raw;
    return NULL;
}

/* ${NAME} where NAME is [A-Za-z_][A-Za-z0-9_]* — anything else stays literal */
static bool env_name(const char *s, size_t n) {
    if (!n) return false;
    if (!isalpha((unsigned char)s[0]) && s[0] != '_') return false;
    for (size_t i = 1; i < n; i++)
        if (!isalnum((unsigned char)s[i]) && s[i] != '_') return false;
    return true;
}

static char *interp_unquote(const char *raw) {
    size_t n = strlen(raw);
    const char *s = raw;
    if (n >= 2 && raw[0] == '"' && raw[n-1] == '"') { s = raw + 1; n -= 2; }
    StrBuf b; sb_init(&b);
    for (size_t i = 0; i < n; i++) {
        if (s[i] == '$' && i + 1 < n && s[i+1] == '{') {
            const char *end = memchr(s + i + 2, '}', n - i - 2);
            if (end) {
                char name[128];
                size_t ln = (size_t)(end - (s + i + 2));
                if (ln < sizeof name && env_name(s + i + 2, ln)) {
                    memcpy(name, s + i + 2, ln);
                    name[ln] = 0;
                    const char *v = getenv(name);
                    if (v) sb_puts(&b, v);
                    i = (size_t)(end - s);
                    continue;
                }
            }
        }
        sb_putc(&b, s[i]);
    }
    return b.p;
}

char *kvx_str(const Kvx *k, const char *sec, const char *key) {
    const char *raw = kvx_raw(k, sec, key);
    if (!raw) return NULL;
    return interp_unquote(raw);
}

long kvx_long(const Kvx *k, const char *sec, const char *key, long dflt) {
    char *s = kvx_str(k, sec, key);
    if (!s || !s[0]) { free(s); return dflt; }
    char *end = NULL;
    long v = strtol(s, &end, 10);
    bool ok = end && *end == 0;
    free(s);
    return ok ? v : dflt;
}

bool kvx_bool(const Kvx *k, const char *sec, const char *key, bool dflt) {
    char *s = kvx_str(k, sec, key);
    if (!s || !s[0]) { free(s); return dflt; }
    bool v = strcasecmp(s, "true") == 0 || strcmp(s, "1") == 0 ||
             strcasecmp(s, "yes") == 0;
    free(s);
    return v;
}

int kvx_list(const Kvx *k, const char *sec, const char *key, char ***out) {
    *out = NULL;
    const char *raw = kvx_raw(k, sec, key);
    if (!raw) return 0;
    size_t n = strlen(raw);
    if (!(n >= 2 && raw[0] == '[' && raw[n-1] == ']')) {
        char *one = interp_unquote(raw);
        if (!one[0]) { free(one); return 0; }
        *out = xmalloc(sizeof(char *));
        (*out)[0] = one;
        return 1;
    }
    char *inner = xmalloc(n - 1);
    memcpy(inner, raw + 1, n - 2);
    inner[n - 2] = 0;
    int cnt = 0, cap = 8;
    char **v = xmalloc(sizeof(char *) * (size_t)cap);
    bool inq = false;
    char *start = inner;
    for (char *p = inner; ; p++) {
        if (*p == '"') inq = !inq;
        if ((*p == ',' && !inq) || *p == 0) {
            bool end = (*p == 0);
            *p = 0;
            char *item = interp_unquote(trim(start));
            if (item[0]) {
                if (cnt == cap) {
                    cap *= 2;
                    v = xrealloc(v, sizeof(char *) * (size_t)cap);
                }
                v[cnt++] = item;
            } else free(item);
            if (end) break;
            start = p + 1;
        }
    }
    free(inner);
    *out = v;
    return cnt;
}

int kvx_keys(const Kvx *k, const char *sec, const char ***out) {
    int cnt = 0;
    for (int i = 0; i < k->n; i++)
        if (strcmp(k->v[i].section, sec) == 0) cnt++;
    const char **v = xmalloc(sizeof(char *) * (size_t)(cnt ? cnt : 1));
    int j = 0;
    for (int i = 0; i < k->n; i++)
        if (strcmp(k->v[i].section, sec) == 0) v[j++] = k->v[i].key;
    *out = v;
    return cnt;
}

int kvx_subsections(const Kvx *k, const char *prefix, char ***out) {
    char pre[256];
    snprintf(pre, sizeof pre, "%s.", prefix);
    size_t pl = strlen(pre);
    int cnt = 0, cap = 16;
    char **v = xmalloc(sizeof(char *) * (size_t)cap);
    for (int i = 0; i < k->nsec; i++) {
        if (strncmp(k->secs[i], pre, pl) != 0) continue;
        if (cnt == cap) {
            cap *= 2;
            v = xrealloc(v, sizeof(char *) * (size_t)cap);
        }
        v[cnt++] = xstrdup(k->secs[i] + pl);
    }
    *out = v;
    return cnt;
}

/* sort ids like "1","1.10","1.2","2" by numeric segments (Go SortDottedIDs:
 * split on '.', per-segment Atoi when BOTH parse — whole segment must be an
 * integer — else lexicographic; equal prefix -> fewer segments first). */
static bool seg_int(const char *s, size_t n, long *out) {
    size_t i = 0;
    if (i < n && (s[i] == '-' || s[i] == '+')) i++;
    if (i == n) return false;
    long v = 0;
    bool neg = (s[0] == '-');
    for (; i < n; i++) {
        if (!isdigit((unsigned char)s[i])) return false;
        v = v * 10 + (s[i] - '0');
    }
    *out = neg ? -v : v;
    return true;
}

static int dotted_cmp(const void *pa, const void *pb) {
    const char *a = *(const char *const *)pa, *b = *(const char *const *)pb;
    for (;;) {
        if (!*a || !*b) return !*a && !*b ? 0 : (!*a ? -1 : 1);
        size_t al = strcspn(a, "."), bl = strcspn(b, ".");
        long av, bv;
        if (seg_int(a, al, &av) && seg_int(b, bl, &bv)) {
            if (av != bv) return av < bv ? -1 : 1;
        } else {
            size_t m = al < bl ? al : bl;
            int c = memcmp(a, b, m);
            if (c) return c;
            if (al != bl) return al < bl ? -1 : 1;
        }
        a += al; if (*a == '.') a++;
        b += bl; if (*b == '.') b++;
    }
}

void kvx_sort_dotted(char **ids, int n) {
    qsort(ids, (size_t)n, sizeof(char *), dotted_cmp);
}

int kvx_set_status(const char *path, const char *section, const char *value) {
    size_t len = 0;
    char *body = read_entire_file(path, &len);
    if (!body) return -1;
    StrBuf out; sb_init(&out);
    char cur[256] = "";
    bool done = false, in_target = false;
    size_t pos = 0;
    while (pos < len) {
        char *nl = memchr(body + pos, '\n', len - pos);
        size_t ll = nl ? (size_t)(nl - (body + pos)) : len - pos;
        char line[4096];
        size_t cl = ll < sizeof line - 1 ? ll : sizeof line - 1;
        memcpy(line, body + pos, cl);
        line[cl] = 0;

        char probe[4096];
        snprintf(probe, sizeof probe, "%s", line);
        strip_comment(probe, strlen(probe));
        char *t = trim(probe);
        if (t[0] == '[' && t[strlen(t)-1] == ']') {
            t[strlen(t)-1] = 0;
            snprintf(cur, sizeof cur, "%s", trim(t + 1));
            in_target = strcmp(cur, section) == 0;
            for (size_t i = 0; i < ll; i++) sb_putc(&out, body[pos + i]);
        } else if (!done && in_target) {
            char *eq = strchr(line, '=');
            bool is_status = false;
            if (eq) {
                char keybuf[64];
                size_t kn = (size_t)(eq - line);
                if (kn < sizeof keybuf) {
                    memcpy(keybuf, line, kn);
                    keybuf[kn] = 0;
                    is_status = strcmp(trim(keybuf), "status") == 0;
                }
            }
            if (is_status) {
                size_t head = (size_t)(eq - line) + 1;
                for (size_t i = 0; i < head; i++) sb_putc(&out, line[i]);
                sb_printf(&out, " \"%s\"", value);
                done = true;
            } else {
                for (size_t i = 0; i < ll; i++) sb_putc(&out, body[pos + i]);
            }
        } else {
            for (size_t i = 0; i < ll; i++) sb_putc(&out, body[pos + i]);
        }
        pos += ll;
        if (nl) { sb_putc(&out, '\n'); pos++; }
    }
    free(body);
    if (!done) { sb_free(&out); return -2; }   /* section or status not found */
    int rc = write_entire_file(path, out.p, out.len);
    sb_free(&out);
    return rc;
}

static void sb_kvx_string(StrBuf *b, const char *value) {
    sb_putc(b, '"');
    for (const unsigned char *p = (const unsigned char *)value; *p; p++) {
        if (*p == '\\' || *p == '"') {
            sb_putc(b, '\\');
            sb_putc(b, (char)*p);
        } else if (*p == '\n') {
            sb_puts(b, "\\n");
        } else if (*p == '\r') {
            sb_puts(b, "\\r");
        } else if (*p == '\t') {
            sb_puts(b, "\\t");
        } else {
            sb_putc(b, (char)*p);
        }
    }
    sb_putc(b, '"');
}

int kvx_set_string(const char *path, const char *section, const char *key,
                   const char *value) {
    size_t len = 0;
    char *body = read_entire_file(path, &len);
    if (!body) return -1;

    bool section_found = false, in_target = false;
    size_t section_end = len;
    size_t key_start = SIZE_MAX, key_len = 0, key_eq = 0, key_tail = 0;
    size_t pos = 0;
    while (pos < len) {
        char *nl = memchr(body + pos, '\n', len - pos);
        size_t ll = nl ? (size_t)(nl - (body + pos)) : len - pos;
        char line[4096];
        size_t cl = ll < sizeof line - 1 ? ll : sizeof line - 1;
        memcpy(line, body + pos, cl);
        line[cl] = 0;

        char probe[4096];
        snprintf(probe, sizeof probe, "%s", line);
        strip_comment(probe, strlen(probe));
        char *t = trim(probe);
        if (t[0] == '[' && t[strlen(t) - 1] == ']') {
            if (in_target) section_end = pos;
            t[strlen(t) - 1] = 0;
            in_target = strcmp(trim(t + 1), section) == 0;
            if (in_target) {
                section_found = true;
                section_end = len;
            }
        } else if (in_target) {
            char *eq = strchr(line, '=');
            if (eq) {
                char keybuf[256];
                size_t kn = (size_t)(eq - line);
                if (kn < sizeof keybuf) {
                    memcpy(keybuf, line, kn);
                    keybuf[kn] = 0;
                    if (strcmp(trim(keybuf), key) == 0) {
                        size_t comment = ll;
                        bool quoted = false, escaped = false;
                        for (size_t i = (size_t)(eq - line) + 1; i < ll; i++) {
                            char c = line[i];
                            if (escaped) { escaped = false; continue; }
                            if (quoted && c == '\\') { escaped = true; continue; }
                            if (c == '"') { quoted = !quoted; continue; }
                            if (!quoted && c == '#') { comment = i; break; }
                        }
                        while (comment > (size_t)(eq - line) + 1 &&
                               isspace((unsigned char)line[comment - 1]))
                            comment--;
                        key_start = pos;
                        key_len = ll;
                        key_eq = (size_t)(eq - line);
                        key_tail = comment;
                    }
                }
            }
        }
        pos += ll + (nl ? 1 : 0);
    }

    StrBuf out; sb_init(&out);
    if (key_start != SIZE_MAX) {
        for (size_t i = 0; i <= key_eq; i++) sb_putc(&out, body[key_start + i]);
        sb_putc(&out, ' ');
        sb_kvx_string(&out, value);
        for (size_t i = key_tail; i < key_len; i++)
            sb_putc(&out, body[key_start + i]);
        if (key_start > 0) {
            StrBuf joined; sb_init(&joined);
            for (size_t i = 0; i < key_start; i++) sb_putc(&joined, body[i]);
            sb_puts(&joined, out.p);
            size_t rest = key_start + key_len;
            for (size_t i = rest; i < len; i++) sb_putc(&joined, body[i]);
            sb_free(&out);
            out = joined;
        } else {
            size_t rest = key_len;
            for (size_t i = rest; i < len; i++) sb_putc(&out, body[i]);
        }
    } else if (section_found) {
        for (size_t i = 0; i < section_end; i++) sb_putc(&out, body[i]);
        if (section_end && body[section_end - 1] != '\n') sb_putc(&out, '\n');
        sb_printf(&out, "%s = ", key);
        sb_kvx_string(&out, value);
        sb_putc(&out, '\n');
        for (size_t i = section_end; i < len; i++) sb_putc(&out, body[i]);
    } else {
        sb_puts(&out, body);
        if (len && body[len - 1] != '\n') sb_putc(&out, '\n');
        if (out.len && (out.len < 2 || out.p[out.len - 2] != '\n'))
            sb_putc(&out, '\n');
        sb_printf(&out, "[%s]\n%s = ", section, key);
        sb_kvx_string(&out, value);
        sb_putc(&out, '\n');
    }

    free(body);
    int rc = write_entire_file(path, out.p, out.len);
    sb_free(&out);
    return rc;
}
