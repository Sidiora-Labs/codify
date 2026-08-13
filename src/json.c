/*
 * Minimal JSON reading — just enough to serve MCP requests and peek into
 * package.json. String/escape-aware balanced scanning, no DOM.
 */
#include "cg.h"
#include <ctype.h>

/* skip over one JSON value starting at p; returns just past it */
static const char *skip_value(const char *p) {
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p == '"') {
        p++;
        while (*p && *p != '"') {
            if (*p == '\\' && p[1]) p++;
            p++;
        }
        return *p ? p + 1 : p;
    }
    if (*p == '{' || *p == '[') {
        char open = *p, close = (open == '{') ? '}' : ']';
        int depth = 0;
        while (*p) {
            if (*p == '"') {
                p++;
                while (*p && *p != '"') {
                    if (*p == '\\' && p[1]) p++;
                    p++;
                }
                if (*p) p++;
                continue;
            }
            if (*p == open) depth++;
            else if (*p == close && --depth == 0) return p + 1;
            p++;
        }
        return p;
    }
    while (*p && !strchr(",}] \t\r\n", *p)) p++;
    return p;
}

/* find "key": at the CURRENT nesting level of obj (which starts at '{');
   returns pointer to the value, or NULL */
static const char *find_key(const char *obj, const char *key) {
    const char *p = obj;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '{') return NULL;
    p++;
    size_t klen = strlen(key);
    for (;;) {
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p == ',') { p++; continue; }
        if (*p != '"') return NULL;               /* end or malformed */
        const char *ks = ++p;
        while (*p && *p != '"') {
            if (*p == '\\' && p[1]) p++;
            p++;
        }
        size_t kl = (size_t)(p - ks);
        if (*p) p++;
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p != ':') return NULL;
        p++;
        while (*p && isspace((unsigned char)*p)) p++;
        if (kl == klen && strncmp(ks, key, klen) == 0) return p;
        p = skip_value(p);
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p == '}') return NULL;
    }
}

static char *unescape(const char *s, size_t n) {
    StrBuf b; sb_init(&b);
    for (size_t i = 0; i < n; i++) {
        if (s[i] != '\\' || i + 1 >= n) { sb_putc(&b, s[i]); continue; }
        i++;
        switch (s[i]) {
        case 'n': sb_putc(&b, '\n'); break;
        case 't': sb_putc(&b, '\t'); break;
        case 'r': sb_putc(&b, '\r'); break;
        case 'b': sb_putc(&b, '\b'); break;
        case 'f': sb_putc(&b, '\f'); break;
        case 'u': {
            if (i + 4 < n) {
                unsigned cp = 0;
                sscanf(s + i + 1, "%4x", &cp);
                i += 4;
                if (cp < 0x80) sb_putc(&b, (char)cp);
                else if (cp < 0x800) {
                    sb_putc(&b, (char)(0xC0 | (cp >> 6)));
                    sb_putc(&b, (char)(0x80 | (cp & 0x3F)));
                } else {
                    sb_putc(&b, (char)(0xE0 | (cp >> 12)));
                    sb_putc(&b, (char)(0x80 | ((cp >> 6) & 0x3F)));
                    sb_putc(&b, (char)(0x80 | (cp & 0x3F)));
                }
            }
            break;
        }
        default: sb_putc(&b, s[i]);
        }
    }
    return b.p;
}

char *json_get_string(const char *obj, const char *key) {
    const char *v = find_key(obj, key);
    if (!v || *v != '"') return NULL;
    v++;
    const char *e = v;
    while (*e && *e != '"') {
        if (*e == '\\' && e[1]) e++;
        e++;
    }
    return unescape(v, (size_t)(e - v));
}

long json_get_int(const char *obj, const char *key, long dflt) {
    const char *v = find_key(obj, key);
    if (!v || (!isdigit((unsigned char)*v) && *v != '-')) return dflt;
    return atol(v);
}

char *json_get_raw(const char *obj, const char *key) {
    const char *v = find_key(obj, key);
    if (!v) return NULL;
    const char *e = skip_value(v);
    size_t n = (size_t)(e - v);
    char *out = xmalloc(n + 1);
    memcpy(out, v, n);
    out[n] = 0;
    return out;
}

char *json_get_object(const char *obj, const char *key) {
    const char *v = find_key(obj, key);
    if (!v || *v != '{') return NULL;
    const char *e = skip_value(v);
    size_t n = (size_t)(e - v);
    char *out = xmalloc(n + 1);
    memcpy(out, v, n);
    out[n] = 0;
    return out;
}

int json_object_keys(const char *obj, char **keys, int cap) {
    const char *p = obj;
    while (*p && isspace((unsigned char)*p)) p++;
    if (*p != '{') return 0;
    p++;
    int n = 0;
    for (;;) {
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p == ',') { p++; continue; }
        if (*p != '"' || n >= cap) return n;
        const char *ks = ++p;
        while (*p && *p != '"') {
            if (*p == '\\' && p[1]) p++;
            p++;
        }
        keys[n++] = unescape(ks, (size_t)(p - ks));
        if (*p) p++;
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p != ':') return n;
        p++;
        while (*p && isspace((unsigned char)*p)) p++;
        p = skip_value(p);
        while (*p && isspace((unsigned char)*p)) p++;
        if (*p == '}' || !*p) return n;
    }
}
