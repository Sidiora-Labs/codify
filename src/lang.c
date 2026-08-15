/*
 * Language layer: heuristic symbol + reference extraction.
 * One engine, per-language spec: comment/string syntax and POSIX ERE
 * definition patterns run against comment/string-stripped lines.
 */
#include "cg.h"
#include <regex.h>
#include <ctype.h>

#define ID "[A-Za-z_][A-Za-z0-9_]*"
#define NW "(^|[^A-Za-z0-9_])"          /* non-word boundary, consumes 0-1 */

typedef struct { const char *kind; const char *pat; int group; } DefPat;

#define MAXPATS 12
typedef struct {
    const char *name;
    const char *line_comment;
    const char *line_comment2;
    const char *block_open, *block_close;
    const char *quotes;
    bool icase;
    DefPat pats[MAXPATS];
    regex_t re[MAXPATS];
    int npats;
} LangSpec;

static LangSpec LANGS[] = {
    { .name = "c", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .pats = {
        {"function", "^[A-Za-z_][A-Za-z0-9_ \t*]*[ \t*](" ID ")[ \t]*\\(", 1},
        {"macro",    "^#[ \t]*define[ \t]+(" ID ")", 1},
        {"struct",   "^[ \t]*(typedef[ \t]+)?(struct|union)[ \t]+(" ID ")", 3},
        {"enum",     "^[ \t]*(typedef[ \t]+)?enum[ \t]+(" ID ")", 2},
        {"typedef",  "^typedef[^(;]*[ \t*](" ID ")[ \t]*;", 1},
    }},
    { .name = "cpp", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .pats = {
        {"function",  "^[A-Za-z_][A-Za-z0-9_ \t*&:<>~]*[ \t*&](" ID ")[ \t]*\\(", 1},
        {"method",    "(" ID ")::(~?" ID ")[ \t]*\\(", 2},
        {"macro",     "^#[ \t]*define[ \t]+(" ID ")", 1},
        {"class",     "^[ \t]*(class|struct)[ \t]+(" ID ")", 2},
        {"enum",      "^[ \t]*enum[ \t]+(class[ \t]+)?(" ID ")", 2},
        {"namespace", "^[ \t]*namespace[ \t]+(" ID ")", 1},
    }},
    { .name = "python", .line_comment = "#", .quotes = "\"'", .pats = {
        {"function", "^[ \t]*(async[ \t]+)?def[ \t]+(" ID ")", 2},
        {"class",    "^[ \t]*class[ \t]+(" ID ")", 1},
    }},
    { .name = "js", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'`", .pats = {
        {"function",  NW "function[ \t*]+(" ID ")", 2},
        {"class",     NW "class[ \t]+(" ID ")", 2},
        {"function",  "^[ \t]*(export[ \t]+)?(const|let|var)[ \t]+(" ID ")[ \t]*=[ \t]*"
                      "(async[ \t]+)?(\\(|function|" ID "[ \t]*=>)", 3},
        {"method",    "^[ \t]+(static[ \t]+)?(async[ \t]+)?(" ID ")[ \t]*\\([^;=]*\\)[ \t]*\\{", 3},
        {"interface", "^[ \t]*(export[ \t]+)?interface[ \t]+(" ID ")", 2},
        {"type",      "^[ \t]*(export[ \t]+)?type[ \t]+(" ID ")[ \t]*=", 2},
        {"enum",      "^[ \t]*(export[ \t]+)?(const[ \t]+)?enum[ \t]+(" ID ")", 3},
    }},
    { .name = "go", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'`", .pats = {
        {"function", "^func[ \t]+(" ID ")[ \t]*[(\\[]", 1},
        {"method",   "^func[ \t]*\\([^)]*\\)[ \t]*(" ID ")[ \t]*[(\\[]", 1},
        {"type",     "^type[ \t]+(" ID ")", 1},
    }},
    { .name = "rust", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"", .pats = {
        {"function", NW "fn[ \t]+(" ID ")", 2},
        {"struct",   NW "struct[ \t]+(" ID ")", 2},
        {"enum",     NW "enum[ \t]+(" ID ")", 2},
        {"trait",    NW "trait[ \t]+(" ID ")", 2},
        {"module",   "^[ \t]*(pub[ \t]+)?mod[ \t]+(" ID ")", 2},
        {"macro",    "macro_rules![ \t]*(" ID ")", 1},
    }},
    { .name = "java", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .pats = {
        {"class",  NW "(class|interface|enum|record)[ \t]+(" ID ")", 3},
        {"method", "^[ \t]+(public|private|protected|static|final|abstract|synchronized|native|default)"
                   "[ \t].*[ \t](" ID ")[ \t]*\\(", 2},
    }},
    { .name = "csharp", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .pats = {
        {"class",     NW "(class|interface|struct|record|enum)[ \t]+(" ID ")", 3},
        {"namespace", "^[ \t]*namespace[ \t]+([A-Za-z_][A-Za-z0-9_.]*)", 1},
        {"method",    "^[ \t]+(public|private|protected|internal|static|override|virtual|async|sealed)"
                      "[ \t].*[ \t](" ID ")[ \t]*\\(", 2},
    }},
    { .name = "ruby", .line_comment = "#", .quotes = "\"'", .pats = {
        {"function", "^[ \t]*def[ \t]+(self\\.)?(" ID "[!?=]?)", 2},
        {"class",    "^[ \t]*(class|module)[ \t]+(" ID ")", 2},
    }},
    { .name = "php", .line_comment = "//", .line_comment2 = "#",
      .block_open = "/*", .block_close = "*/", .quotes = "\"'", .pats = {
        {"function", "function[ \t]+&?[ \t]*(" ID ")", 1},
        {"class",    NW "(class|interface|trait)[ \t]+(" ID ")", 3},
    }},
    { .name = "swift", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"", .pats = {
        {"function", NW "func[ \t]+(" ID ")", 2},
        {"type",     NW "(class|struct|enum|protocol|extension|actor)[ \t]+(" ID ")", 3},
    }},
    { .name = "kotlin", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .pats = {
        {"function", NW "fun[ \t]+(<[^>]*>[ \t]*)?(" ID ")", 3},
        {"class",    NW "(class|object|interface)[ \t]+(" ID ")", 3},
    }},
    { .name = "erlang", .line_comment = "%", .quotes = "\"", .pats = {
        {"function", "^([a-z][A-Za-z0-9_]*)\\(", 1},
        {"record",   "^-record\\((" ID ")", 1},
        {"module",   "^-module\\((" ID ")", 1},
    }},
    { .name = "solidity", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .pats = {
        {"function", NW "function[ \t]+(" ID ")", 2},
        {"contract", NW "(contract|interface|library)[ \t]+(" ID ")", 3},
        {"event",    NW "(event|modifier|error)[ \t]+(" ID ")", 3},
    }},
    { .name = "vbnet", .line_comment = "'", .quotes = "\"", .icase = true, .pats = {
        {"function", "(^|[ \t])(sub|function)[ \t]+(" ID ")", 3},
        {"class",    "(^|[ \t])(class|module|structure|interface)[ \t]+(" ID ")", 3},
        {"property", "(^|[ \t])property[ \t]+(" ID ")", 2},
    }},
};
#define NLANGS ((int)(sizeof LANGS / sizeof LANGS[0]))

/* ext -> (recorded language, spec used) */
static const struct { const char *ext, *lang, *spec; } EXTMAP[] = {
    {".c","c","c"},           {".h","c","cpp"},
    {".cpp","cpp","cpp"},     {".cc","cpp","cpp"},   {".cxx","cpp","cpp"},
    {".hpp","cpp","cpp"},     {".hh","cpp","cpp"},   {".hxx","cpp","cpp"},
    {".py","python","python"},{".pyw","python","python"},
    {".js","javascript","js"},{".jsx","javascript","js"},
    {".mjs","javascript","js"},{".cjs","javascript","js"},
    {".ts","typescript","js"},{".tsx","typescript","js"},
    {".mts","typescript","js"},{".cts","typescript","js"},
    {".go","go","go"},        {".rs","rust","rust"},
    {".java","java","java"},  {".cs","csharp","csharp"},
    {".vb","vbnet","vbnet"},  {".php","php","php"},
    {".rb","ruby","ruby"},    {".swift","swift","swift"},
    {".kt","kotlin","kotlin"},{".kts","kotlin","kotlin"},
    {".erl","erlang","erlang"},{".hrl","erlang","erlang"},
    {".sol","solidity","solidity"},
    {".svelte","svelte","js"},{".vue","vue","js"},   {".astro","astro","js"},
    {NULL,NULL,NULL}
};

static const char *KEYWORDS[] = {
    "if","for","while","switch","return","catch","sizeof","typeof","throw",
    "else","elif","case","defer","select","except","raise","until","unless",
    "when","foreach","yield","await","typeid","alignof","decltype","using",
    "delete","new","do","try","in","instanceof","assert",NULL
};

static const char *RUST_KEYWORDS[] = {
    "abstract","as","async","await","become","box","break","const",
    "continue","crate","do","dyn","else","enum","extern","false","final",
    "fn","for","gen","if","impl","in","let","loop","macro","match",
    "mod","move","mut","override","priv","pub","ref","return","self",
    "Self","static","struct","super","trait","true","try","type","typeof",
    "unsafe","unsized","use","virtual","where","while","yield",NULL
};

static bool word_in(const char *const *words, const char *s, size_t n) {
    for (int i = 0; words[i]; i++)
        if (strlen(words[i]) == n && strncmp(words[i], s, n) == 0)
            return true;
    return false;
}

static bool is_keyword(const LangSpec *L, const char *s, size_t n) {
    if (strcmp(L->name, "rust") == 0)
        return word_in(RUST_KEYWORDS, s, n);
    return word_in(KEYWORDS, s, n);
}

void lang_global_init(void) {
    static bool done = false;
    if (done) return;
    done = true;
    for (int i = 0; i < NLANGS; i++) {
        LangSpec *L = &LANGS[i];
        int n = 0;
        for (; n < MAXPATS && L->pats[n].pat; n++) {
            int fl = REG_EXTENDED | (L->icase ? REG_ICASE : 0);
            int rc = regcomp(&L->re[n], L->pats[n].pat, fl);
            if (rc != 0) {
                char eb[256];
                regerror(rc, &L->re[n], eb, sizeof eb);
                fprintf(stderr, "cg: internal regex error (%s #%d): %s\n",
                        L->name, n, eb);
                exit(2);
            }
        }
        L->npats = n;
    }
    routes_global_init();
}

static const LangSpec *spec_by_name(const char *name) {
    for (int i = 0; i < NLANGS; i++)
        if (strcmp(LANGS[i].name, name) == 0) return &LANGS[i];
    return NULL;
}

const char *lang_for_path(const char *path) {
    const char *ext = path_ext(path);
    for (int i = 0; EXTMAP[i].ext; i++)
        if (strcasecmp(EXTMAP[i].ext, ext) == 0) return EXTMAP[i].lang;
    return NULL;
}

static const LangSpec *spec_for_path(const char *path) {
    const char *ext = path_ext(path);
    for (int i = 0; EXTMAP[i].ext; i++)
        if (strcasecmp(EXTMAP[i].ext, ext) == 0) return spec_by_name(EXTMAP[i].spec);
    return NULL;
}

/* ---------------- result buffers ---------------- */

static void add_def(ParseResult *pr, const char *name, size_t nlen,
                    const char *kind, int line, const char *sig) {
    for (int i = pr->ndefs - 1; i >= 0 && pr->defs[i].line == line; i--)
        if (strlen(pr->defs[i].name) == nlen &&
            strncmp(pr->defs[i].name, name, nlen) == 0)
            return;                              /* dedupe same line+name */
    if (pr->ndefs == pr->cdefs) {
        pr->cdefs = pr->cdefs ? pr->cdefs * 2 : 64;
        pr->defs = xrealloc(pr->defs, sizeof(SymDef) * (size_t)pr->cdefs);
    }
    SymDef *d = &pr->defs[pr->ndefs++];
    d->name = xmalloc(nlen + 1);
    memcpy(d->name, name, nlen);
    d->name[nlen] = 0;
    d->kind = kind;
    d->line = line;
    /* signature: trimmed line, capped */
    while (*sig == ' ' || *sig == '\t') sig++;
    size_t sl = strlen(sig);
    while (sl && (sig[sl-1] == '\n' || sig[sl-1] == '\r' ||
                  sig[sl-1] == ' '  || sig[sl-1] == '\t')) sl--;
    if (sl > 160) sl = 160;
    d->sig = xmalloc(sl + 1);
    memcpy(d->sig, sig, sl);
    d->sig[sl] = 0;
}

static void add_ref(ParseResult *pr, const char *name, size_t nlen, int line) {
    if (pr->nrefs == pr->crefs) {
        pr->crefs = pr->crefs ? pr->crefs * 2 : 128;
        pr->refs = xrealloc(pr->refs, sizeof(SymRef) * (size_t)pr->crefs);
    }
    SymRef *r = &pr->refs[pr->nrefs++];
    r->name = xmalloc(nlen + 1);
    memcpy(r->name, name, nlen);
    r->name[nlen] = 0;
    r->line = line;
}

void route_add(ParseResult *pr, const char *framework, const char *method,
               const char *pattern, const char *handler, int line) {
    if (pr->nroutes == pr->croutes) {
        pr->croutes = pr->croutes ? pr->croutes * 2 : 8;
        pr->routes = xrealloc(pr->routes, sizeof(RouteDef) * (size_t)pr->croutes);
    }
    RouteDef *r = &pr->routes[pr->nroutes++];
    r->framework = framework;
    r->method = xstrdup(method ? method : "*");
    r->pattern = xstrdup(pattern ? pattern : "");
    r->handler = handler ? xstrdup(handler) : NULL;
    r->line = line;
}

void parse_result_free(ParseResult *pr) {
    for (int i = 0; i < pr->ndefs; i++) { free(pr->defs[i].name); free(pr->defs[i].sig); }
    for (int i = 0; i < pr->nrefs; i++) free(pr->refs[i].name);
    for (int i = 0; i < pr->nroutes; i++) {
        free(pr->routes[i].method); free(pr->routes[i].pattern);
        free(pr->routes[i].handler);
    }
    free(pr->defs); free(pr->refs); free(pr->routes);
    memset(pr, 0, sizeof *pr);
}

/* ---------------- line cleaning ---------------- */

static bool starts_with(const char *s, const char *pre) {
    return pre && strncmp(s, pre, strlen(pre)) == 0;
}

/* Blank strings and comments in-place into `clean` (same length as line). */
static void clean_line(const LangSpec *L, const char *line, size_t n,
                       char *clean, bool *in_block) {
    size_t i = 0;
    char quote = 0;
    while (i < n) {
        char c = line[i];
        if (*in_block) {
            if (starts_with(line + i, L->block_close)) {
                size_t bl = strlen(L->block_close);
                for (size_t k = 0; k < bl; k++) clean[i + k] = ' ';
                i += bl;
                *in_block = false;
            } else { clean[i++] = ' '; }
        } else if (quote) {
            if (c == '\\' && i + 1 < n && strcmp(L->name, "vbnet") != 0) {
                clean[i] = ' '; clean[i+1] = ' '; i += 2;
            } else {
                if (c == quote) quote = 0;
                clean[i++] = ' ';
            }
        } else if (L->line_comment && starts_with(line + i, L->line_comment)) {
            while (i < n) clean[i++] = ' ';
        } else if (L->line_comment2 && starts_with(line + i, L->line_comment2)) {
            while (i < n) clean[i++] = ' ';
        } else if (L->block_open && starts_with(line + i, L->block_open)) {
            size_t bl = strlen(L->block_open);
            for (size_t k = 0; k < bl && i + k < n; k++) clean[i + k] = ' ';
            i += bl;
            *in_block = true;
        } else if (L->quotes && strchr(L->quotes, c)) {
            quote = c;
            clean[i++] = ' ';
        } else {
            clean[i++] = c;
        }
    }
    clean[n] = 0;
}

static bool idstart(char c) { return isalpha((unsigned char)c) || c == '_'; }
static bool idchar(char c)  { return isalnum((unsigned char)c) || c == '_'; }

void lang_parse(const char *lang, const char *path, const char *src,
                size_t len, ParseResult *pr) {
    (void)lang;
    memset(pr, 0, sizeof *pr);
    const LangSpec *L = spec_for_path(path);
    if (!L) return;
    bool cfam_protos = strcmp(L->name, "c") == 0 || strcmp(L->name, "cpp") == 0;

    bool in_block = false;
    int lineno = 0;
    size_t pos = 0;
    char orig[4096], clean[4096];

    routes_scan_file(path, pr);

    while (pos < len) {
        const char *ls = src + pos;
        const char *nl = memchr(ls, '\n', len - pos);
        size_t ll = nl ? (size_t)(nl - ls) : len - pos;
        pos += ll + (nl ? 1 : 0);
        lineno++;
        if (ll >= sizeof orig) {           /* minified / generated: skip */
            /* still track block comments conservatively: leave state as-is */
            continue;
        }
        memcpy(orig, ls, ll);
        orig[ll] = 0;
        if (ll && orig[ll-1] == '\r') orig[--ll] = 0;

        clean_line(L, orig, ll, clean, &in_block);

        int defs_before = pr->ndefs;

        for (int p = 0; p < L->npats; p++) {
            regmatch_t m[8];
            const char *cursor = clean;
            regoff_t base = 0;
            /* find every match on the line (rare to have >1, but cheap) */
            while (regexec((regex_t *)&L->re[p], cursor, 8, m, 0) == 0) {
                int g = L->pats[p].group;
                if (m[g].rm_so >= 0 && m[g].rm_eo > m[g].rm_so) {
                    const char *nm = cursor + m[g].rm_so;
                    size_t nn = (size_t)(m[g].rm_eo - m[g].rm_so);
                    bool skip = is_keyword(L, nm, nn);
                    /* C/C++: a line ending in ';' that looks like a def is a
                       prototype/extern decl, not a definition */
                    if (!skip && cfam_protos &&
                        strcmp(L->pats[p].kind, "function") == 0) {
                        size_t cl = strlen(clean);
                        while (cl && (clean[cl-1] == ' ' || clean[cl-1] == '\t')) cl--;
                        if (cl && clean[cl-1] == ';') skip = true;
                    }
                    if (!skip)
                        add_def(pr, nm, nn, L->pats[p].kind, lineno, orig);
                }
                if (m[0].rm_eo <= 0) break;
                cursor += m[0].rm_eo;
                base += m[0].rm_eo;
                if (*cursor == 0) break;
            }
        }

        /* reference candidates: identifier immediately-ish followed by '(' */
        size_t cl = strlen(clean);
        for (size_t i = 0; i < cl; ) {
            if (idstart(clean[i]) && (i == 0 || !idchar(clean[i-1]))) {
                size_t j = i + 1;
                while (j < cl && idchar(clean[j])) j++;
                size_t k = j;
                while (k < cl && (clean[k] == ' ' || clean[k] == '\t')) k++;
                if (k < cl && clean[k] == '(' && j - i >= 2 &&
                    !is_keyword(L, clean + i, j - i)) {
                    bool is_def = false;
                    for (int d = defs_before; d < pr->ndefs; d++)
                        if (strlen(pr->defs[d].name) == j - i &&
                            strncmp(pr->defs[d].name, clean + i, j - i) == 0)
                            { is_def = true; break; }
                    if (!is_def)
                        add_ref(pr, clean + i, j - i, lineno);
                }
                i = j;
            } else i++;
        }

        routes_scan_line(L->name, path, lineno, orig, pr);
    }
    pr->nlines = lineno;
}
