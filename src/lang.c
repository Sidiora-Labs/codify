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

/* import extraction style — table-driven per language */
typedef enum {
    IMP_NONE = 0,
    IMP_JS,     /* import {a,b} from 'm' / import d from 'm' / require('m') */
    IMP_PY,     /* from m import a, b / import m */
    IMP_GO,     /* import "p" and import ( ... ) blocks */
    IMP_INC,    /* #include "p" — local includes only */
    IMP_RUST,   /* use a::b::{c,d} / use a::b::c */
    IMP_DOT,    /* imp_kw a.b.C; — java import / c# using */
} ImpStyle;

#define MAXPATS 12
typedef struct {
    const char *name;
    const char *line_comment;
    const char *line_comment2;
    const char *block_open, *block_close;
    const char *quotes;
    bool icase;
    ImpStyle imp;
    const char *imp_kw;       /* IMP_DOT keyword: "import" / "using" */
    DefPat pats[MAXPATS];
    regex_t re[MAXPATS];
    int npats;
} LangSpec;

static LangSpec LANGS[] = {
    { .name = "c", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .imp = IMP_INC, .pats = {
        {"function", "^[A-Za-z_][A-Za-z0-9_ \t*]*[ \t*](" ID ")[ \t]*\\(", 1},
        {"macro",    "^#[ \t]*define[ \t]+(" ID ")", 1},
        {"struct",   "^[ \t]*(typedef[ \t]+)?(struct|union)[ \t]+(" ID ")", 3},
        {"enum",     "^[ \t]*(typedef[ \t]+)?enum[ \t]+(" ID ")", 2},
        {"typedef",  "^typedef[^(;]*[ \t*](" ID ")[ \t]*;", 1},
    }},
    { .name = "cpp", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .imp = IMP_INC, .pats = {
        {"function",  "^[A-Za-z_][A-Za-z0-9_ \t*&:<>~]*[ \t*&](" ID ")[ \t]*\\(", 1},
        {"method",    "(" ID ")::(~?" ID ")[ \t]*\\(", 2},
        {"macro",     "^#[ \t]*define[ \t]+(" ID ")", 1},
        {"class",     "^[ \t]*(class|struct)[ \t]+(" ID ")", 2},
        {"enum",      "^[ \t]*enum[ \t]+(class[ \t]+)?(" ID ")", 2},
        {"namespace", "^[ \t]*namespace[ \t]+(" ID ")", 1},
    }},
    { .name = "python", .line_comment = "#", .quotes = "\"'", .imp = IMP_PY,
      .pats = {
        {"function", "^[ \t]*(async[ \t]+)?def[ \t]+(" ID ")", 2},
        {"class",    "^[ \t]*class[ \t]+(" ID ")", 1},
    }},
    { .name = "js", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'`", .imp = IMP_JS, .pats = {
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
      .quotes = "\"'`", .imp = IMP_GO, .pats = {
        {"function", "^func[ \t]+(" ID ")[ \t]*[(\\[]", 1},
        {"method",   "^func[ \t]*\\([^)]*\\)[ \t]*(" ID ")[ \t]*[(\\[]", 1},
        {"type",     "^type[ \t]+(" ID ")", 1},
    }},
    { .name = "rust", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"", .imp = IMP_RUST, .pats = {
        {"function", NW "fn[ \t]+(" ID ")", 2},
        {"struct",   NW "struct[ \t]+(" ID ")", 2},
        {"enum",     NW "enum[ \t]+(" ID ")", 2},
        {"trait",    NW "trait[ \t]+(" ID ")", 2},
        {"module",   "^[ \t]*(pub[ \t]+)?mod[ \t]+(" ID ")", 2},
        {"macro",    "macro_rules![ \t]*(" ID ")", 1},
    }},
    { .name = "java", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .imp = IMP_DOT, .imp_kw = "import", .pats = {
        {"class",  NW "(class|interface|enum|record)[ \t]+(" ID ")", 3},
        {"method", "^[ \t]+(public|private|protected|static|final|abstract|synchronized|native|default)"
                   "[ \t].*[ \t](" ID ")[ \t]*\\(", 2},
    }},
    { .name = "csharp", .line_comment = "//", .block_open = "/*", .block_close = "*/",
      .quotes = "\"'", .imp = IMP_DOT, .imp_kw = "using", .pats = {
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

#define CMT_MAX_BYTES 4000        /* a span longer than this is a licence header */

static void add_cmt(ParseResult *pr, const char *body, int line, int end,
                    bool pure, bool below) {
    while (*body == ' ' || *body == '\t') body++;
    if (!*body) return;                      /* a bare marker carries nothing */
    if (pr->ncmts == pr->ccmts) {
        pr->ccmts = pr->ccmts ? pr->ccmts * 2 : 64;
        pr->cmts = xrealloc(pr->cmts, sizeof(CmtDef) * (size_t)pr->ccmts);
    }
    CmtDef *c = &pr->cmts[pr->ncmts++];
    c->body = xstrdup(body);
    c->line = line;
    c->end_line = end;
    c->pure = pure;
    c->below = below;
}

/* Coalescing accumulator: consecutive pure-comment lines become one span. */
typedef struct { StrBuf b; int line, end; bool pure, open, below; } CmtAcc;

static void cmt_flush(CmtAcc *a, ParseResult *pr) {
    if (!a->open) return;
    /* trim trailing blank lines the block may have collected */
    while (a->b.len && (a->b.p[a->b.len-1] == '\n' ||
                        a->b.p[a->b.len-1] == ' ' ||
                        a->b.p[a->b.len-1] == '\t'))
        a->b.p[--a->b.len] = 0;
    add_cmt(pr, a->b.p, a->line, a->end, a->pure, a->below);
    sb_free(&a->b);
    memset(a, 0, sizeof *a);
}

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
    d->end_line = 0;
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

static void add_ref(ParseResult *pr, const char *name, size_t nlen, int line,
                    const char *qual, size_t qlen) {
    if (pr->nrefs == pr->crefs) {
        pr->crefs = pr->crefs ? pr->crefs * 2 : 128;
        pr->refs = xrealloc(pr->refs, sizeof(SymRef) * (size_t)pr->crefs);
    }
    SymRef *r = &pr->refs[pr->nrefs++];
    r->name = xmalloc(nlen + 1);
    memcpy(r->name, name, nlen);
    r->name[nlen] = 0;
    r->line = line;
    r->ref_kind = 'c';
    if (qual && qlen) {
        if (qlen >= sizeof r->qual) qlen = sizeof r->qual - 1;
        memcpy(r->qual, qual, qlen);
        r->qual[qlen] = 0;
    } else {
        r->qual[0] = 0;
    }
}

static void add_import(ParseResult *pr, const char *name, size_t nlen,
                       const char *module, size_t mlen, int line) {
    if (nlen == 0) return;
    if (pr->nimports == pr->cimports) {
        pr->cimports = pr->cimports ? pr->cimports * 2 : 8;
        pr->imports = xrealloc(pr->imports,
                               sizeof(ImportDef) * (size_t)pr->cimports);
    }
    ImportDef *im = &pr->imports[pr->nimports++];
    im->name = xmalloc(nlen + 1);
    memcpy(im->name, name, nlen);
    im->name[nlen] = 0;
    im->module = xmalloc(mlen + 1);
    if (mlen) memcpy(im->module, module, mlen);
    im->module[mlen] = 0;
    im->line = line;
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
    for (int i = 0; i < pr->nimports; i++) {
        free(pr->imports[i].name); free(pr->imports[i].module);
    }
    for (int i = 0; i < pr->ncmts; i++) free(pr->cmts[i].body);
    free(pr->defs); free(pr->refs); free(pr->routes); free(pr->imports);
    free(pr->cmts);
    memset(pr, 0, sizeof *pr);
}

/* ---------------- line cleaning ---------------- */

static bool starts_with(const char *s, const char *pre) {
    return pre && strncmp(s, pre, strlen(pre)) == 0;
}

/* Byte range of comment text on the current line, as a by-product of the
 * pass that blanks it. start < 0 means the line carried no comment. The
 * range is the union over the line: a line rarely holds more than one. */
typedef struct { int start, end; } CmtRange;

static void cmt_mark(CmtRange *cr, size_t a, size_t b) {
    if (!cr) return;
    if (cr->start < 0 || (int)a < cr->start) cr->start = (int)a;
    if ((int)b > cr->end) cr->end = (int)b;
}

/* cross-line stripper state: block comments and multi-line strings */
typedef struct {
    bool in_block;     /* inside a block comment */
    char mstr;         /* multi-line string delimiter char, 0 = none */
    bool triple;       /* mstr is a python ''' / """ (else a js backtick) */
} CleanState;

/* Blank strings and comments in-place into `clean` (same length as line).
 * clean may be NULL: advance the cross-line state only, emitting nothing —
 * used for over-long lines so skipping them cannot desync the stripper. */
static void clean_line(const LangSpec *L, const char *line, size_t n,
                       char *clean, CleanState *cs, CmtRange *cr) {
    if (cr) { cr->start = -1; cr->end = -1; }
    bool py = strcmp(L->name, "python") == 0;
    bool jss = strcmp(L->name, "js") == 0;
    size_t i = 0;
    char quote = 0;
    while (i < n) {
        char c = line[i];
        if (cs->in_block) {
            if (starts_with(line + i, L->block_close)) {
                size_t bl = strlen(L->block_close);
                for (size_t k = 0; k < bl && i + k < n; k++)
                    if (clean) clean[i + k] = ' ';
                cmt_mark(cr, i, i + bl > n ? n : i + bl);
                i += bl;
                cs->in_block = false;
            } else { if (clean) clean[i] = ' '; cmt_mark(cr, i, i + 1); i++; }
        } else if (cs->mstr) {
            if (cs->triple && i + 2 < n && c == cs->mstr &&
                line[i+1] == cs->mstr && line[i+2] == cs->mstr) {
                if (clean) { clean[i] = clean[i+1] = clean[i+2] = ' '; }
                i += 3;
                cs->mstr = 0;
            } else if (!cs->triple && c == '\\' && i + 1 < n) {
                if (clean) { clean[i] = ' '; clean[i+1] = ' '; }
                i += 2;
            } else if (!cs->triple && c == cs->mstr) {
                if (clean) clean[i] = ' ';
                i++;
                cs->mstr = 0;
            } else { if (clean) clean[i] = ' '; i++; }
        } else if (quote) {
            if (c == '\\' && i + 1 < n && strcmp(L->name, "vbnet") != 0) {
                if (clean) { clean[i] = ' '; clean[i+1] = ' '; }
                i += 2;
            } else {
                if (c == quote) quote = 0;
                if (clean) clean[i] = ' ';
                i++;
            }
        } else if (L->line_comment && starts_with(line + i, L->line_comment)) {
            cmt_mark(cr, i, n);
            while (i < n) { if (clean) clean[i] = ' '; i++; }
        } else if (L->line_comment2 && starts_with(line + i, L->line_comment2)) {
            cmt_mark(cr, i, n);
            while (i < n) { if (clean) clean[i] = ' '; i++; }
        } else if (L->block_open && starts_with(line + i, L->block_open)) {
            size_t bl = strlen(L->block_open);
            for (size_t k = 0; k < bl && i + k < n; k++)
                if (clean) clean[i + k] = ' ';
            cmt_mark(cr, i, i + bl > n ? n : i + bl);
            i += bl;
            cs->in_block = true;
        } else if (py && (c == '\'' || c == '"') && i + 2 < n &&
                   line[i+1] == c && line[i+2] == c) {
            if (clean) { clean[i] = clean[i+1] = clean[i+2] = ' '; }
            i += 3;
            cs->mstr = c;
            cs->triple = true;
        } else if (jss && c == '`') {
            if (clean) clean[i] = ' ';
            i++;
            cs->mstr = '`';
            cs->triple = false;
        } else if (L->quotes && strchr(L->quotes, c)) {
            quote = c;
            if (clean) clean[i] = ' ';
            i++;
        } else {
            if (clean) clean[i] = c;
            i++;
        }
    }
    if (clean) clean[n] = 0;
}

static bool idstart(char c) { return isalpha((unsigned char)c) || c == '_'; }
static bool idchar(char c)  { return isalnum((unsigned char)c) || c == '_'; }

/* ---------------- scope ends ---------------- */

/* Real scope end for a definition starting at def_line (1-based), from the
 * file's cleaned lines. Brace languages: depth tracking from the def line,
 * accepting the opening brace on the def line or the next one. Python: the
 * last non-blank line indented deeper than the def line. 0 = unresolved —
 * the writer falls back to its gap estimate. */
static int lang_scope_end(const LangSpec *L, char *const *lines, int nlines,
                          int def_line) {
    if (def_line < 1 || def_line > nlines) return 0;
    if (strcmp(L->name, "python") == 0) {
        const char *dl = lines[def_line - 1];
        int base = 0;
        while (dl[base] == ' ' || dl[base] == '\t') base++;
        int last = 0;
        for (int j = def_line + 1; j <= nlines; j++) {
            const char *s = lines[j - 1];
            int ind = 0;
            while (s[ind] == ' ' || s[ind] == '\t') ind++;
            if (!s[ind]) continue;                 /* blank / stripped line */
            if (ind <= base) break;
            last = j;
        }
        return last;
    }
    if (strcmp(L->name, "ruby") == 0 || strcmp(L->name, "erlang") == 0 ||
        strcmp(L->name, "vbnet") == 0)
        return 0;                                  /* no brace scopes */
    int depth = 0;
    bool opened = false;
    for (int j = def_line; j <= nlines; j++) {
        for (const char *s = lines[j - 1]; *s; s++) {
            if (!opened) {
                if (*s == '{') { opened = true; depth = 1; }
                else if (*s == ';') return 0;      /* declaration, no body */
            } else if (*s == '{') {
                depth++;
            } else if (*s == '}' && --depth == 0) {
                return j;
            }
        }
        if (!opened && j > def_line) return 0;     /* body brace not nearby */
    }
    return 0;
}

/* ---------------- imports ---------------- */

static const char *skip_sp(const char *s) {
    while (*s == ' ' || *s == '\t') s++;
    return s;
}

static bool kw_at(const char *s, const char *kw) {
    size_t n = strlen(kw);
    return strncmp(s, kw, n) == 0 && !idchar(s[n]);
}

/* first 'm' / "m" span on s; false when absent or unterminated */
static bool quoted_span(const char *s, const char **out, size_t *n) {
    while (*s && *s != '"' && *s != '\'') s++;
    if (!*s) return false;
    const char *e = strchr(s + 1, *s);
    if (!e) return false;
    *out = s + 1;
    *n = (size_t)(e - s - 1);
    return true;
}

/* last identifier token in [s,e); a '*' anywhere wins (star import).
 * "a as b" therefore yields the binding name b. */
static void seg_name(const char *s, const char *e, const char **out, size_t *n) {
    *out = NULL;
    *n = 0;
    for (const char *p = s; p < e; p++) {
        if (*p == '*') { *out = "*"; *n = 1; return; }
        if (idstart(*p)) {
            const char *q = p;
            while (q < e && idchar(*q)) q++;
            *out = p;
            *n = (size_t)(q - p);
            p = q;
        }
    }
}

static void imp_js(const char *line, int lineno, ParseResult *pr) {
    const char *s = skip_sp(line);
    if (kw_at(s, "export")) s = skip_sp(s + 6);
    if (kw_at(s, "import")) {
        const char *from = NULL;
        for (const char *p = s + 6; *p; p++)
            if (!idchar(p[-1]) && kw_at(p, "from")) { from = p; break; }
        const char *mod;
        size_t ml;
        if (from && quoted_span(from + 4, &mod, &ml) && ml) {
            const char *it = s + 6;                /* one row per name */
            for (const char *p = it; ; p++) {
                if (p >= from || *p == ',') {
                    const char *nm;
                    size_t nn;
                    seg_name(it, p, &nm, &nn);
                    if (nn) add_import(pr, nm, nn, mod, ml, lineno);
                    it = p + 1;
                    if (p >= from) break;
                }
            }
        }
    }
    for (const char *r = line; (r = strstr(r, "require")); r += 7) {
        if (r > line && idchar(r[-1])) continue;
        if (idchar(r[7])) continue;
        const char *p = skip_sp(r + 7);
        if (*p != '(') continue;
        const char *cl = strchr(p, ')');
        const char *mod;
        size_t ml;
        if (cl && quoted_span(p, &mod, &ml) && ml && mod + ml < cl)
            add_import(pr, "*", 1, mod, ml, lineno);
    }
}

static void imp_py(const char *line, int lineno, ParseResult *pr) {
    const char *s = skip_sp(line);
    if (kw_at(s, "from")) {
        const char *m = skip_sp(s + 4);
        const char *q = m;
        while (idchar(*q) || *q == '.') q++;
        if (q == m) return;
        const char *im = skip_sp(q);
        if (!kw_at(im, "import")) return;
        const char *list = skip_sp(im + 6);
        const char *end = list + strlen(list);
        const char *it = list;                     /* one row per name */
        for (const char *p = it; ; p++) {
            if (p >= end || *p == ',') {
                const char *nm;
                size_t nn;
                seg_name(it, p, &nm, &nn);
                if (nn) add_import(pr, nm, nn, m, (size_t)(q - m), lineno);
                it = p + 1;
                if (p >= end) break;
            }
        }
    } else if (kw_at(s, "import")) {
        const char *p = skip_sp(s + 6);
        while (*p) {                               /* import a.b, c as d */
            const char *m = p;
            const char *q = m;
            while (idchar(*q) || *q == '.') q++;
            if (q == m) break;
            add_import(pr, "*", 1, m, (size_t)(q - m), lineno);
            p = skip_sp(q);
            if (kw_at(p, "as")) {
                p = skip_sp(p + 2);
                while (idchar(*p)) p++;
                p = skip_sp(p);
            }
            if (*p != ',') break;
            p = skip_sp(p + 1);
        }
    }
}

static void imp_go(const char *line, int lineno, ParseResult *pr, int *state) {
    const char *s = skip_sp(line);
    const char *mod;
    size_t ml;
    if (*state) {                                  /* inside import ( ... ) */
        if (*s == ')') { *state = 0; return; }
        if (quoted_span(s, &mod, &ml) && ml)
            add_import(pr, "*", 1, mod, ml, lineno);
        return;
    }
    if (!kw_at(s, "import")) return;
    const char *p = skip_sp(s + 6);
    if (*p == '(') {
        *state = 1;
        if (quoted_span(p, &mod, &ml) && ml)
            add_import(pr, "*", 1, mod, ml, lineno);
        if (strchr(p, ')')) *state = 0;            /* one-line block */
        return;
    }
    if (quoted_span(p, &mod, &ml) && ml)
        add_import(pr, "*", 1, mod, ml, lineno);
}

static void imp_inc(const char *line, int lineno, ParseResult *pr) {
    const char *s = skip_sp(line);
    if (*s != '#') return;
    s = skip_sp(s + 1);
    if (strncmp(s, "include", 7) != 0) return;
    s = skip_sp(s + 7);
    if (*s != '"') return;                         /* <...> system: skip */
    const char *e = strchr(s + 1, '"');
    if (e && e > s + 1)
        add_import(pr, "*", 1, s + 1, (size_t)(e - s - 1), lineno);
}

static void imp_rust(const char *line, int lineno, ParseResult *pr) {
    const char *s = skip_sp(line);
    if (kw_at(s, "pub")) s = skip_sp(s + 3);
    if (!kw_at(s, "use")) return;
    const char *p = skip_sp(s + 3);
    const char *semi = strchr(p, ';');
    const char *end = semi ? semi : p + strlen(p);
    const char *brace = memchr(p, '{', (size_t)(end - p));
    const char *nm;
    size_t nn;
    if (brace) {                                   /* use a::b::{c, d}; */
        const char *me = brace;
        while (me > p && (me[-1] == ':' || me[-1] == ' ' || me[-1] == '\t'))
            me--;
        const char *close = memchr(brace, '}', (size_t)(end - brace));
        const char *ge = close ? close : end;
        const char *it = brace + 1;
        for (const char *q = it; ; q++) {
            if (q >= ge || *q == ',') {
                seg_name(it, q, &nm, &nn);
                if (nn) add_import(pr, nm, nn, p, (size_t)(me - p), lineno);
                it = q + 1;
                if (q >= ge) break;
            }
        }
        return;
    }
    const char *last = NULL;                       /* use a::b::c; */
    for (const char *q = p; q + 1 < end; q++)
        if (q[0] == ':' && q[1] == ':') last = q;
    seg_name(last ? last + 2 : p, end, &nm, &nn);
    if (!nn) return;
    if (last) add_import(pr, nm, nn, p, (size_t)(last - p), lineno);
    else      add_import(pr, nm, nn, nm, nn, lineno);
}

static void imp_dot(const LangSpec *L, const char *line, int lineno,
                    ParseResult *pr) {
    const char *s = skip_sp(line);
    if (!kw_at(s, L->imp_kw)) return;
    const char *p = skip_sp(s + strlen(L->imp_kw));
    if (kw_at(p, "static")) p = skip_sp(p + 6);    /* java import static */
    const char *q = p;
    while (idchar(*q) || *q == '.') q++;
    bool star = *q == '*';                         /* import a.b.*; */
    if (q == p || *skip_sp(star ? q + 1 : q) != ';') return;
    const char *dot = NULL;
    for (const char *r = p; r < q; r++)
        if (*r == '.') dot = r;
    if (star) {
        if (dot) add_import(pr, "*", 1, p, (size_t)(dot - p), lineno);
    } else if (dot) {
        add_import(pr, dot + 1, (size_t)(q - dot - 1), p, (size_t)(dot - p),
                   lineno);
    } else {
        add_import(pr, p, (size_t)(q - p), "", 0, lineno);
    }
}

/* table-driven import extraction; `state` carries go's import-block flag */
static void lang_scan_imports(const LangSpec *L, const char *line, int lineno,
                              ParseResult *pr, int *state) {
    switch (L->imp) {
    case IMP_JS:   imp_js(line, lineno, pr);        break;
    case IMP_PY:   imp_py(line, lineno, pr);        break;
    case IMP_GO:   imp_go(line, lineno, pr, state); break;
    case IMP_INC:  imp_inc(line, lineno, pr);       break;
    case IMP_RUST: imp_rust(line, lineno, pr);      break;
    case IMP_DOT:  imp_dot(L, line, lineno, pr);    break;
    case IMP_NONE: break;
    }
}

void lang_parse(const char *lang, const char *path, const char *src,
                size_t len, ParseResult *pr) {
    (void)lang;
    memset(pr, 0, sizeof *pr);
    const LangSpec *L = spec_for_path(path);
    if (!L) return;
    bool cfam_protos = strcmp(L->name, "c") == 0 || strcmp(L->name, "cpp") == 0;

    CleanState cs = {0};
    CmtRange cr = { -1, -1 };
    CmtAcc acc; memset(&acc, 0, sizeof acc);
    bool pylang = strcmp(L->name, "python") == 0;
    bool ds_open = false;              /* inside a docstring we accepted */
    int impstate = 0;
    int lineno = 0;
    size_t pos = 0;
    char orig[4096], clean[4096];
    char **clines = NULL;              /* cleaned lines, for scope tracking */
    int ccl = 0;

    routes_scan_file(path, pr);

    while (pos < len) {
        const char *ls = src + pos;
        const char *nl = memchr(ls, '\n', len - pos);
        size_t ll = nl ? (size_t)(nl - ls) : len - pos;
        pos += ll + (nl ? 1 : 0);
        lineno++;
        if (lineno > ccl) {
            ccl = ccl ? ccl * 2 : 256;
            if (ccl < lineno) ccl = lineno;
            clines = xrealloc(clines, sizeof(char *) * (size_t)ccl);
        }
        if (ll >= sizeof orig) {           /* minified / generated: skip */
            /* advance the stripper state so later lines stay in sync */
            clean_line(L, ls, ll, NULL, &cs, NULL);
            clines[lineno - 1] = xstrdup("");
            cmt_flush(&acc, pr);
            continue;
        }
        memcpy(orig, ls, ll);
        orig[ll] = 0;
        if (ll && orig[ll-1] == '\r') orig[--ll] = 0;

        bool in_str = cs.mstr != 0 || cs.in_block;   /* line starts inside */
        clean_line(L, orig, ll, clean, &cs, &cr);
        clines[lineno - 1] = xstrdup(clean);

        bool code = false;
        for (const char *q = clean; *q; q++)
            if (!isspace((unsigned char)*q)) { code = true; break; }
        if (code && !pr->first_code_line) pr->first_code_line = lineno;

        /* Python keeps its intent in docstrings, which the stripper sees as
         * strings, not comments. A triple-quoted string opening a module or
         * sitting directly under a def is the language's doc comment, so it
         * enters the same index — flagged `below`, since unlike every other
         * language it follows the definition it documents. */
        bool ds_line = false;
        if (pylang) {
            if (ds_open) {
                ds_line = true;
            } else if (!code) {
                const char *t = orig;
                while (*t == ' ' || *t == '\t') t++;
                bool opens = strncmp(t, "\"\"\"", 3) == 0 ||
                             strncmp(t, "'''", 3) == 0;
                if (opens && (!pr->first_code_line ||
                              (pr->ndefs &&
                               pr->defs[pr->ndefs-1].line == lineno - 1)))
                    ds_line = true;
            }
            ds_open = ds_line && cs.mstr != 0;
        }
        if (ds_line) {
            const char *t = orig;
            while (*t == ' ' || *t == '\t') t++;
            bool cont = acc.open && acc.below && acc.end == lineno - 1;
            if (!cont) {
                cmt_flush(&acc, pr);
                sb_init(&acc.b);
                acc.open = true; acc.line = lineno;
                acc.pure = true; acc.below = true;
            } else {
                sb_putc(&acc.b, '\n');
            }
            if (acc.b.len < CMT_MAX_BYTES) sb_puts(&acc.b, t);
            acc.end = lineno;
        }
        /* Comment capture, free-riding on the pass that just blanked them:
         * consecutive pure-comment lines coalesce into one span, a comment
         * trailing code stands alone, and any other line closes the block. */
        else if (cr.start >= 0) {
            int cs0 = cr.start;
            int ce  = cr.end > (int)ll ? (int)ll : cr.end;
            while (ce > cs0 && (orig[ce-1] == ' ' || orig[ce-1] == '\t')) ce--;
            bool pure = !code;
            /* only pure lines extend a pure block, and only contiguously */
            if (!(acc.open && pure && acc.pure && !acc.below &&
                  acc.end == lineno - 1))
                cmt_flush(&acc, pr);
            if (!acc.open) {
                sb_init(&acc.b);
                acc.open = true; acc.line = lineno; acc.pure = pure;
            } else {
                sb_putc(&acc.b, '\n');
            }
            if (acc.b.len < CMT_MAX_BYTES)
                for (int q = cs0; q < ce; q++) sb_putc(&acc.b, orig[q]);
            acc.end = lineno;
        } else {
            cmt_flush(&acc, pr);
        }

        if (!in_str) lang_scan_imports(L, orig, lineno, pr, &impstate);

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
                    if (!is_def) {
                        /* immediate receiver: recv.name( recv->name( R::name( */
                        size_t e = 0;
                        if (i >= 2 && clean[i-1] == '.') e = i - 1;
                        else if (i >= 3 && clean[i-2] == '-' && clean[i-1] == '>')
                            e = i - 2;
                        else if (i >= 3 && clean[i-2] == ':' && clean[i-1] == ':')
                            e = i - 2;
                        const char *qs = NULL;
                        size_t qn = 0;
                        if (e) {
                            size_t st = e;
                            while (st > 0 && idchar(clean[st-1])) st--;
                            if (st < e && idstart(clean[st])) {
                                qs = clean + st;
                                qn = e - st;
                            }
                        }
                        add_ref(pr, clean + i, j - i, lineno, qs, qn);
                    }
                }
                i = j;
            } else i++;
        }

        routes_scan_line(L->name, path, lineno, orig, pr);
    }
    cmt_flush(&acc, pr);
    /* real scope ends now that every line's cleaned form is known */
    for (int i = 0; i < pr->ndefs; i++)
        pr->defs[i].end_line = lang_scope_end(L, clines, lineno,
                                              pr->defs[i].line);
    for (int i = 0; i < lineno; i++) free(clines[i]);
    free(clines);
    pr->nlines = lineno;
}
