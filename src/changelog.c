/* cg changelog — release notes from git history, the way cliff.toml says.
 *
 * A release starts at a tag or at the commit that changed the project's
 * version (src/cg.h CG_VERSION, VERSION, or package.json); what follows the
 * last one is named by the working tree's version when that is new, by
 * --tag, and only otherwise [Unreleased]. Within a release, commits group by
 * their subject prefix (feat:, fix:, guard:, ...), a `type(scope):` shows
 * its scope, `type!:` is marked breaking, merge commits are not notes, and
 * the `[spec:<feature>/<task>]` a snapshot or a fleet worker tagged the
 * commit with becomes a task reference. Links come from the origin remote;
 * with none, bullets carry the bare hash and the footer is left out. In a
 * tags-only repository with no version file the output is byte-for-byte
 * what git-cliff renders from cliff.toml.
 *
 * On top of that record, optionally, a model writes what it means: with a
 * key for an OpenAI-compatible endpoint, each release gets a short
 * "Highlights" block written from its commits. The bullets stay exactly as
 * derived; the model only adds prose, and a summary is cached by the
 * release's commit range so a new run costs one call for what is new. No
 * key means no call and no change to the output.
 *
 * Without a git repository the snapshot renderer in vcs.c answers, as it
 * always did (also on --snapshots). */
#include "cg.h"
#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <regex.h>
#include <sys/stat.h>
#include <sys/wait.h>
#include <time.h>
#include <unistd.h>

/* ---------------- git ---------------- */

static int git_capture(const char *tree, const char *args, StrBuf *out) {
    StrBuf c; sb_init(&c);
    sb_puts(&c, "git -C ");
    sb_shquote(&c, tree);
    sb_putc(&c, ' ');
    sb_puts(&c, args);
    sb_puts(&c, " 2>/dev/null");
    FILE *f = popen(c.p, "r");
    sb_free(&c);
    if (!f) return -1;
    char buf[8192];
    size_t n;
    while ((n = fread(buf, 1, sizeof buf, f)) > 0)
        for (size_t i = 0; i < n; i++) sb_putc(out, buf[i]);
    int rc = pclose(f);
    return WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
}

/* https://github.com/o/r for the origin remote, whatever form it is in */
static void repo_url(const char *tree, char *out, size_t cap) {
    StrBuf b; sb_init(&b);
    out[0] = 0;
    if (git_capture(tree, "remote get-url origin", &b) != 0 || !b.len) { sb_free(&b); return; }
    char *u = b.p;
    u[strcspn(u, "\r\n")] = 0;
    char tmp[1024];
    if (!strncmp(u, "git@", 4)) {
        char *colon = strchr(u, ':');
        if (colon) { *colon = 0; snprintf(tmp, sizeof tmp, "https://%s/%s", u + 4, colon + 1); }
        else snprintf(tmp, sizeof tmp, "%s", u);
    } else if (!strncmp(u, "ssh://git@", 10)) {
        snprintf(tmp, sizeof tmp, "https://%s", u + 10);
    } else {
        snprintf(tmp, sizeof tmp, "%s", u);
    }
    size_t n = strlen(tmp);
    if (n > 4 && !strcmp(tmp + n - 4, ".git")) tmp[n - 4] = 0;
    n = strlen(tmp);
    while (n && tmp[n - 1] == '/') tmp[--n] = 0;
    snprintf(out, cap, "%s", tmp);
    sb_free(&b);
}

typedef struct { char name[128]; long when; } Tag;

static int tags_load(const char *tree, Tag **out) {
    *out = NULL;
    StrBuf b; sb_init(&b);
    if (git_capture(tree, "tag --sort=creatordate --format='%(refname:short)%09%(creatordate:unix)'", &b) != 0) {
        sb_free(&b);
        return 0;
    }
    int n = 0, cap = 0;
    Tag *v = NULL;
    for (char *line = b.p, *nl; line && *line; line = nl ? nl + 1 : NULL) {
        nl = strchr(line, '\n');
        if (nl) *nl = 0;
        char *tab = strchr(line, '\t');
        if (!tab) continue;
        *tab = 0;
        if (n == cap) { cap = cap ? cap * 2 : 8; v = xrealloc(v, sizeof(Tag) * (size_t)cap); }
        snprintf(v[n].name, sizeof v[n].name, "%s", line);
        v[n].when = atol(tab + 1);
        n++;
    }
    sb_free(&b);
    *out = v;
    return n;
}

/* ---------------- versions ---------------- */

/* Where the project keeps its version: this repository's
 * `#define CG_VERSION "x"` in src/cg.h, a VERSION file, or package.json.
 * Returns the repo-relative path, or "" when nothing is found. */
static const char *version_source(const char *tree, char *path, size_t cap) {
    static const char *CANDIDATES[] = { "src/cg.h", "VERSION", "package.json", NULL };
    for (int i = 0; CANDIDATES[i]; i++) {
        char abs[4900];
        struct stat st;
        snprintf(abs, sizeof abs, "%s/%s", tree, CANDIDATES[i]);
        if (stat(abs, &st) == 0) { snprintf(path, cap, "%s", CANDIDATES[i]); return path; }
    }
    path[0] = 0;
    return path;
}

/* the version in one rendering of the source file; "" when none */
static void version_parse(const char *src, const char *body, char *out, size_t cap) {
    out[0] = 0;
    if (!body) return;
    const char *dot = strrchr(src, '.');
    if (dot && !strcmp(dot, ".h")) {
        const char *d = strstr(body, "define CG_VERSION");
        const char *q = d ? strchr(d, '"') : NULL;
        const char *e = q ? strchr(q + 1, '"') : NULL;
        if (q && e) snprintf(out, cap, "%.*s", (int)(e - q - 1), q + 1);
    } else if (dot && !strcmp(dot, ".json")) {
        char *v = json_get_string(body, "version");
        if (v) snprintf(out, cap, "%s", v);
        free(v);
    } else {
        size_t n = strspn(body, " \t\r\nv");
        const char *b = body + n;
        size_t l = strcspn(b, " \t\r\n");
        snprintf(out, cap, "%.*s", (int)l, b);
    }
}

static void version_at(const char *tree, const char *src, const char *rev,
                       char *out, size_t cap) {
    StrBuf a; sb_init(&a);
    sb_puts(&a, "show ");
    StrBuf spec; sb_init(&spec);
    sb_printf(&spec, "%s:%s", rev, src);
    sb_shquote(&a, spec.p);
    sb_free(&spec);
    StrBuf b; sb_init(&b);
    if (git_capture(tree, a.p, &b) == 0) version_parse(src, b.p, out, cap);
    else out[0] = 0;
    sb_free(&a); sb_free(&b);
}

static void version_now(const char *tree, const char *src, char *out, size_t cap) {
    char abs[4900];
    snprintf(abs, sizeof abs, "%s/%s", tree, src);
    char *body = read_entire_file(abs, NULL);
    version_parse(src, body, out, cap);
    free(body);
}

/* A release boundary: the commit a version first appears in, from a tag or
 * from the version file changing. Tags and bumps that name the same
 * version are one boundary. */
typedef struct { char name[128]; char commit[65]; long when; } Boundary;

static int boundaries_load(const char *tree, const char *src, Boundary **out) {
    *out = NULL;
    int n = 0, cap = 0;
    Boundary *v = NULL;
#define ADD(nm, cm, wh) do { \
        bool dup = false; \
        for (int k_ = 0; k_ < n && !dup; k_++) dup = !strcmp(v[k_].name, (nm)); \
        if (!dup) { if (n == cap) { cap = cap ? cap * 2 : 16; v = xrealloc(v, sizeof(Boundary) * (size_t)cap); } \
            snprintf(v[n].name, sizeof v[n].name, "%s", (nm)); \
            snprintf(v[n].commit, sizeof v[n].commit, "%s", (cm)); v[n].when = (wh); n++; } \
    } while (0)
    if (src[0]) {
        StrBuf a; sb_init(&a);
        sb_puts(&a, "log --reverse --format='%H%x09%ct' -- ");
        sb_shquote(&a, src);
        StrBuf b; sb_init(&b);
        git_capture(tree, a.p, &b);
        sb_free(&a);
        char prev[128] = "";
        for (char *line = b.p, *nl; line && *line; line = nl ? nl + 1 : NULL) {
            nl = strchr(line, '\n');
            if (nl) *nl = 0;
            char *tab = strchr(line, '\t');
            if (!tab) continue;
            *tab = 0;
            char ver[128];
            version_at(tree, src, line, ver, sizeof ver);
            if (!ver[0] || !strcmp(ver, prev)) continue;
            ADD(ver, line, atol(tab + 1));
            snprintf(prev, sizeof prev, "%s", ver);
        }
        sb_free(&b);
    }
    Tag *tags = NULL;
    int nt = tags_load(tree, &tags);
    for (int i = 0; i < nt; i++) {
        StrBuf a; sb_init(&a);
        sb_puts(&a, "rev-list -n 1 ");
        sb_shquote(&a, tags[i].name);
        StrBuf b; sb_init(&b);
        if (git_capture(tree, a.p, &b) == 0 && b.len >= 40) {
            b.p[strcspn(b.p, "\r\n")] = 0;
            const char *nm = tags[i].name[0] == 'v' && isdigit((unsigned char)tags[i].name[1])
                           ? tags[i].name + 1 : tags[i].name;
            ADD(nm, b.p, tags[i].when);
        }
        sb_free(&a); sb_free(&b);
    }
    free(tags);
#undef ADD
    /* oldest first */
    for (int i = 0; i < n; i++)
        for (int j = i + 1; j < n; j++)
            if (v[j].when < v[i].when) { Boundary t = v[i]; v[i] = v[j]; v[j] = t; }
    *out = v;
    return n;
}

/* ---------------- commits ---------------- */

typedef struct {
    char hash[65];
    char *subject, *body, *task;
    char *type, *scope, *message;   /* parsed; type NULL for a plain subject */
    bool breaking, skip;
    const char *group;              /* into GROUPS or a dynamic name */
    char *dyngroup;
} Entry;

static void entry_free(Entry *e) {
    free(e->subject); free(e->body); free(e->task);
    free(e->type); free(e->scope); free(e->message); free(e->dyngroup);
}

/* the parser table of cliff.toml, in its order: what a prefix means, and
 * where its group sits in a release section */
static const struct { const char *re; const char *group; } GROUPS[] = {
    { "^(feat|feature)$", "Features" }, { "^(fix|bugfix|hotfix)$", "Bug fixes" },
    { "^perf$", "Performance" }, { "^refactor$", "Refactoring" },
    { "^docs?$", "Documentation" }, { "^tests?$", "Tests" }, { "^style$", "Style" },
    { "^(build|ci|chore|deps)$", "Build and tooling" }, { "^revert$", "Reverts" },
    { "^release$", "Releases" }, { "^(extension|vscode)$", "Extension" },
    { "^spec$", "Spec workflow" }, { "^guard$", "Guard" }, { "^anchors?$", "Anchors" },
    { "^graph$", "Graph" }, { "^sync$", "Sync" }, { "^fleet$", "Fleet" },
    { "^orchestrate$", "Orchestrate" }, { "^jev$", "Jev" }, { "^skills?$", "Skills" },
    { "^memory$", "Memory" }, { "^(mcp|lsp)$", "Protocols" },
};
#define NGROUPS ((int)(sizeof GROUPS / sizeof GROUPS[0]))
static const char *OTHER = "Other";

static regex_t g_group_re[NGROUPS], g_conv_re;
static bool g_re_ready;

static void re_init(void) {
    if (g_re_ready) return;
    for (int i = 0; i < NGROUPS; i++)
        regcomp(&g_group_re[i], GROUPS[i].re, REG_EXTENDED | REG_NOSUB);
    /* type, optional (scope), optional !, colon — the conventional shape */
    regcomp(&g_conv_re, "^([a-z][a-z0-9_-]*)(\\(([^)]*)\\))?(!)?:[ \t]*", REG_EXTENDED);
    g_re_ready = true;
}

static char *upper_first(const char *s) {
    char *o = xstrdup(s);
    if (o[0]) o[0] = (char)toupper((unsigned char)o[0]);
    return o;
}

static char *trimdup(const char *s, size_t n) {
    while (n && isspace((unsigned char)*s)) { s++; n--; }
    while (n && isspace((unsigned char)s[n - 1])) n--;
    char *o = xmalloc(n + 1);
    memcpy(o, s, n);
    o[n] = 0;
    return o;
}

/* the commit as the notes see it: trailers dropped, the task tag lifted off
 * the subject, the subject parsed into type, scope, breaking, message */
static void entry_parse(Entry *e, const char *subject, const char *body) {
    re_init();
    /* [spec:feature/id] anywhere on the subject becomes the task footer */
    char *s = xstrdup(subject);
    char *lb = strstr(s, "[spec:");
    if (lb) {
        char *rb = strchr(lb, ']');
        if (rb) {
            e->task = trimdup(lb + 6, (size_t)(rb - lb - 6));
            memmove(lb, rb + 1, strlen(rb + 1) + 1);
        }
    }
    char *t = trimdup(s, strlen(s));
    free(s);
    e->subject = t;
    /* the body without attribution trailers */
    StrBuf b; sb_init(&b);
    for (const char *p = body ? body : ""; *p; ) {
        const char *nl = strchr(p, '\n');
        size_t ll = nl ? (size_t)(nl - p) : strlen(p);
        bool trailer = !strncasecmp(p, "Co-Authored-By:", 15) ||
                       !strncasecmp(p, "Signed-off-by:", 14) ||
                       !strncasecmp(p, "Claude-Session:", 15);
        if (!trailer) { for (size_t i = 0; i < ll; i++) sb_putc(&b, p[i]); sb_putc(&b, '\n'); }
        p += ll + (nl ? 1 : 0);
    }
    e->body = trimdup(b.p, b.len);
    sb_free(&b);
    if (!strncmp(t, "Merge branch", 12) || !strncmp(t, "Merge pull request", 18) ||
        !strncmp(t, "Merge remote-tracking", 21)) {
        e->skip = true;
        return;
    }
    regmatch_t m[6];
    if (regexec(&g_conv_re, t, 6, m, 0) == 0) {
        e->type = trimdup(t + m[1].rm_so, (size_t)(m[1].rm_eo - m[1].rm_so));
        if (m[3].rm_so >= 0) e->scope = trimdup(t + m[3].rm_so, (size_t)(m[3].rm_eo - m[3].rm_so));
        e->breaking = m[4].rm_so >= 0;
        e->message = upper_first(t + m[0].rm_eo);
        e->group = NULL;
        for (int i = 0; i < NGROUPS && !e->group; i++)
            if (regexec(&g_group_re[i], e->type, 0, NULL, 0) == 0) e->group = GROUPS[i].group;
        if (!e->group) { e->dyngroup = xstrdup(e->type); e->group = e->dyngroup; }
    } else if (!strncmp(t, "Codify ", 7) && isdigit((unsigned char)t[7])) {
        e->message = xstrdup(t);
        e->group = "Releases";
    } else {
        e->message = upper_first(t);
        e->group = OTHER;
    }
}

static int commits_load(const char *tree, const char *range, Entry **out) {
    *out = NULL;
    StrBuf args; sb_init(&args);
    sb_puts(&args, "log --format='%H%x1f%s%x1f%b%x1e' ");
    sb_shquote(&args, range);
    StrBuf b; sb_init(&b);
    int rc = git_capture(tree, args.p, &b);
    sb_free(&args);
    if (rc != 0) { sb_free(&b); return -1; }
    int n = 0, cap = 0;
    Entry *v = NULL;
    for (char *rec = b.p; rec && *rec; ) {
        char *end = strchr(rec, '\x1e');
        if (end) *end = 0;
        while (*rec == '\n') rec++;
        if (!*rec) { rec = end ? end + 1 : NULL; continue; }
        char *f1 = strchr(rec, '\x1f');
        char *f2 = f1 ? strchr(f1 + 1, '\x1f') : NULL;
        if (f1 && f2) {
            *f1 = 0; *f2 = 0;
            if (n == cap) { cap = cap ? cap * 2 : 32; v = xrealloc(v, sizeof(Entry) * (size_t)cap); }
            Entry *e = &v[n++];
            memset(e, 0, sizeof *e);
            snprintf(e->hash, sizeof e->hash, "%s", rec);
            entry_parse(e, f1 + 1, f2 + 1);
        }
        rec = end ? end + 1 : NULL;
    }
    sb_free(&b);
    *out = v;
    return n;
}

/* ---------------- one release section ---------------- */

typedef struct {
    char name[128];        /* "" for Unreleased */
    char prev[128];        /* the release before, "" for the first */
    long when;             /* tag time, or now for a --tag'd unreleased */
    char range[300];
} Release;

static int group_rank(const char *g) {
    for (int i = 0; i < NGROUPS; i++) if (!strcmp(GROUPS[i].group, g)) return i;
    if (!strcmp(g, OTHER)) return NGROUPS + 1000;      /* last */
    return NGROUPS;                                     /* dynamic, after the table */
}

static void render_release(StrBuf *md, const Release *r, Entry *v, int n,
                           const char *repo, StrBuf *for_model) {
    if (r->name[0]) {
        char day[16];
        time_t t = (time_t)r->when;
        struct tm tm;
        gmtime_r(&t, &tm);
        strftime(day, sizeof day, "%Y-%m-%d", &tm);
        sb_printf(md, "## [%s] - %s\n", r->name, day);
    } else {
        sb_puts(md, "## [Unreleased]\n");
    }
    /* groups in table order, dynamic ones alphabetically after it, Other last */
    const char *names[256];
    int ng = 0;
    for (int i = 0; i < n; i++) {
        if (v[i].skip) continue;
        bool seen = false;
        for (int k = 0; k < ng && !seen; k++) seen = !strcmp(names[k], v[i].group);
        if (!seen && ng < 256) names[ng++] = v[i].group;
    }
    for (int a = 0; a < ng; a++)
        for (int b = a + 1; b < ng; b++) {
            int ra = group_rank(names[a]), rb = group_rank(names[b]);
            if (rb < ra || (rb == ra && ra == NGROUPS && strcmp(names[b], names[a]) < 0)) {
                const char *t = names[a]; names[a] = names[b]; names[b] = t;
            }
        }
    for (int g = 0; g < ng; g++) {
        char *title = upper_first(names[g]);
        sb_printf(md, "\n### %s\n", title);
        if (for_model) sb_printf(for_model, "\n%s:\n", title);
        free(title);
        for (int i = 0; i < n; i++) {
            Entry *e = &v[i];
            if (e->skip || strcmp(e->group, names[g])) continue;
            bool dup = false;
            for (int k = 0; k < i && !dup; k++)
                dup = !v[k].skip && !strcmp(v[k].group, names[g]) &&
                      !strcmp(v[k].message, e->message);
            if (dup) continue;
            sb_puts(md, "- ");
            if (e->scope) sb_printf(md, "**%s:** ", e->scope);
            if (e->breaking) sb_puts(md, "[**breaking**] ");
            if (repo[0])
                sb_printf(md, "%s ([%.7s](%s/commit/%s)", e->message, e->hash, repo, e->hash);
            else
                sb_printf(md, "%s (%.7s", e->message, e->hash);
            if (e->task) sb_printf(md, ", task %s", e->task);
            sb_puts(md, ")\n");
            if (for_model) {
                sb_printf(for_model, "- %s%s%s%s", e->scope ? e->scope : "",
                          e->scope ? ": " : "", e->breaking ? "BREAKING: " : "",
                          e->message);
                if (e->task) sb_printf(for_model, " [task %s]", e->task);
                if (e->body[0]) {
                    /* the first paragraph of the body, briefly */
                    const char *b = e->body;
                    size_t bl = strcspn(b, "\n");
                    if (bl > 240) bl = 240;
                    sb_printf(for_model, " — %.*s", (int)bl, b);
                }
                sb_putc(for_model, '\n');
            }
        }
    }
}

/* ---------------- the model's highlights ---------------- */

/* The gateway chat model is shared with `cg recap`, which writes its brief
 * with the same model and key: ChatModel and its two entry points are
 * declared in cg.h; Summ is the local name. */
typedef ChatModel Summ;

/* CENTRA_API_KEY from the environment, else from the project's .env — a
 * key name is read with its spaces removed, so "CENTRA_API _KEY=" works */
void env_file_key(const char *root, const char *want, char *out, size_t cap) {
    out[0] = 0;
    char p[4700];
    snprintf(p, sizeof p, "%s/.env", root);
    char *body = read_entire_file(p, NULL);
    if (!body) return;
    for (char *line = body, *nl; line && *line; line = nl ? nl + 1 : NULL) {
        nl = strchr(line, '\n');
        if (nl) *nl = 0;
        char *eq = strchr(line, '=');
        if (!eq) continue;
        char k[128];
        int kn = 0;
        for (char *c = line; c < eq && kn < 127; c++)
            if (!isspace((unsigned char)*c)) k[kn++] = *c;
        k[kn] = 0;
        if (!strncmp(k, "export", 6) && kn > 6) memmove(k, k + 6, (size_t)kn - 5);
        if (strcmp(k, want)) continue;
        char *v = eq + 1;
        while (*v == ' ' || *v == '\t') v++;
        size_t vn = strlen(v);
        while (vn && (v[vn - 1] == ' ' || v[vn - 1] == '\r' || v[vn - 1] == '\t')) vn--;
        if (vn >= 2 && ((v[0] == '"' && v[vn - 1] == '"') || (v[0] == '\'' && v[vn - 1] == '\''))) { v++; vn -= 2; }
        snprintf(out, cap, "%.*s", (int)vn, v);
        break;
    }
    free(body);
}

void chat_model_config(const Cg *cg, ChatModel *s) {
    memset(s, 0, sizeof *s);
    const char *e;
    e = getenv("CG_CHANGELOG_KEY");
    if (!e || !e[0]) e = getenv("CENTRA_API_KEY");
    if (e && e[0]) snprintf(s->key, sizeof s->key, "%s", e);
    else { env_file_key(cg->root, "CG_CHANGELOG_KEY", s->key, sizeof s->key);
           if (!s->key[0]) env_file_key(cg->root, "CENTRA_API_KEY", s->key, sizeof s->key); }
    e = getenv("CG_CHANGELOG_ENDPOINT");
    snprintf(s->endpoint, sizeof s->endpoint, "%s",
             e && e[0] ? e : "https://gateway.centra.ag/v1/chat/completions");
    e = getenv("CG_CHANGELOG_MODEL");
    snprintf(s->model, sizeof s->model, "%s",
             e && e[0] ? e : "openrouter/ling-3.0-flash-sante:free(low)");
    e = getenv("CG_CHANGELOG_CURL");
    snprintf(s->curl, sizeof s->curl, "%s", e && e[0] ? e : "curl");
    s->have = s->key[0] != 0;
}
#define summ_config chat_model_config

static void cfgquote(StrBuf *b, const char *s) {
    sb_putc(b, '"');
    for (; *s; s++) {
        if (*s == '"' || *s == '\\') sb_putc(b, '\\');
        sb_putc(b, *s);
    }
    sb_putc(b, '"');
}

static int write_private(const char *path, const char *data) {
    int fd = open(path, O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd < 0) return -1;
    size_t len = strlen(data), off = 0;
    while (off < len) {
        ssize_t w = write(fd, data + off, len - off);
        if (w <= 0) { close(fd); return -1; }
        off += (size_t)w;
    }
    close(fd);
    return 0;
}

/* the model's prose for one release, or NULL; sets *err on failure */
static char *summ_ask(const Cg *cg, const Summ *s, const Release *r,
                      const char *notes, char *err, size_t errcap) {
    err[0] = 0;
    StrBuf prompt; sb_init(&prompt);
    sb_printf(&prompt,
        "You write release notes for Codify, a single-binary developer tool "
        "(code graph, spec-driven task workflow, agent fleet). Below are the "
        "commits of %s, grouped. Write the Highlights for this release: 2 to 5 "
        "sentences in plain prose, then, only if the release is large, up to 5 "
        "short bullets of the changes a user would care about most. Name "
        "commands and features as the commits do; do not invent anything that "
        "is not in the commits; no headings, no preamble, no marketing tone. "
        "Answer in Markdown.\n\n%s",
        r->name[0] ? r->name : "the unreleased changes", notes);
    char *text = chat_model_ask(cg, s, prompt.p, "codify changelog", 1500,
                                err, errcap);
    sb_free(&prompt);
    return text;
}

char *chat_model_ask(const Cg *cg, const ChatModel *s, const char *prompt_text,
                     const char *title, long max_tokens, char *err, size_t errcap) {
    err[0] = 0;
    StrBuf prompt; sb_init(&prompt);
    sb_puts(&prompt, prompt_text);
    /* Reasoning models spend the budget thinking before they answer, and a
     * budget they exhaust returns no content at all: ask for little
     * reasoning, allow room, and try once more with far more room when the
     * answer still comes back empty. */
    long first_budget = max_tokens;
    StrBuf body; sb_init(&body);
retry_bigger:
    body.len = 0; body.p[0] = 0;
    sb_puts(&body, "{\"model\":"); sb_json_str(&body, s->model);
    sb_printf(&body, ",\"temperature\":0.2,\"max_tokens\":%ld,"
                     "\"reasoning\":{\"effort\":\"low\"},"
                     "\"messages\":[{\"role\":\"user\",\"content\":", max_tokens);
    sb_json_str(&body, prompt.p);
    sb_puts(&body, "}]}");
    char dir[4600], cfg[4700], bodyp[4700];
    snprintf(dir, sizeof dir, "%s/%s", cg->shared, CG_DIR);
    snprintf(cfg, sizeof cfg, "%s/changelog.%ld.cfg", dir, (long)getpid());
    snprintf(bodyp, sizeof bodyp, "%s/changelog.%ld.body", dir, (long)getpid());
    StrBuf cf; sb_init(&cf);
    sb_puts(&cf, "url = "); cfgquote(&cf, s->endpoint); sb_putc(&cf, '\n');
    sb_puts(&cf, "request = \"POST\"\n");
    StrBuf auth; sb_init(&auth);
    sb_printf(&auth, "Authorization: Bearer %s", s->key);
    sb_puts(&cf, "header = "); cfgquote(&cf, auth.p); sb_putc(&cf, '\n');
    sb_free(&auth);
    sb_puts(&cf, "header = \"Content-Type: application/json\"\nheader = \"Accept: application/json\"\n");
    StrBuf xt; sb_init(&xt); sb_printf(&xt, "X-Title: %s", title);
    sb_puts(&cf, "header = "); cfgquote(&cf, xt.p); sb_putc(&cf, '\n');
    sb_free(&xt);
    StrBuf at; sb_init(&at); sb_printf(&at, "@%s", bodyp);
    sb_puts(&cf, "data-binary = "); cfgquote(&cf, at.p); sb_putc(&cf, '\n');
    sb_free(&at);
    sb_puts(&cf, "silent\nshow-error\nmax-time = 90\nwrite-out = \"\\n%{http_code}\"\n");
    if (write_private(bodyp, body.p) != 0 || write_private(cfg, cf.p) != 0) {
        snprintf(err, errcap, "cannot write the request under %.300s", dir);
        sb_free(&cf); sb_free(&body); sb_free(&prompt);
        unlink(bodyp); unlink(cfg);
        return NULL;
    }
    sb_free(&cf);
    char *text = NULL;
    for (int attempt = 0; attempt < 2 && !text; attempt++) {
        StrBuf cmd; sb_init(&cmd);
        sb_shquote(&cmd, s->curl);
        sb_puts(&cmd, " -K ");
        sb_shquote(&cmd, cfg);
        sb_puts(&cmd, " 2>&1");
        FILE *f = popen(cmd.p, "r");
        sb_free(&cmd);
        if (!f) { snprintf(err, errcap, "cannot run %s", s->curl); break; }
        StrBuf out; sb_init(&out);
        char buf[8192];
        size_t n;
        while ((n = fread(buf, 1, sizeof buf, f)) > 0)
            for (size_t i = 0; i < n; i++) sb_putc(&out, buf[i]);
        int rc = pclose(f);
        rc = WIFEXITED(rc) ? WEXITSTATUS(rc) : -1;
        int status = 0;
        char *nl = strrchr(out.p, '\n');
        if (nl && strlen(nl + 1) == 3 && isdigit((unsigned char)nl[1])) { status = atoi(nl + 1); *nl = 0; }
        if (rc == 0 && status >= 200 && status < 300) {
            char *choices = json_get_raw(out.p, "choices");
            char **items = NULL;
            int ni = choices ? json_array_items(choices, &items) : 0;
            if (ni > 0) {
                char *msg = json_get_object(items[0], "message");
                text = msg ? json_get_string(msg, "content") : NULL;
                free(msg);
            }
            for (int i = 0; i < ni; i++) free(items[i]);
            free(items); free(choices);
            if (!text) {
                bool cut = strstr(out.p, "\"finish_reason\":\"length\"") != NULL;
                if (cut && max_tokens == first_budget) {
                    sb_free(&out);
                    max_tokens = first_budget * 4;
                    goto retry_bigger;
                }
                snprintf(err, errcap, "no choices[0].message.content in the reply: %.120s", out.p);
            }
            sb_free(&out);
            break;
        }
        snprintf(err, errcap, "HTTP %d%s: %.160s", status, rc ? " (curl failed)" : "", out.p);
        sb_free(&out);
        if (status != 429 && status != 529 && status != 0) break;
        sleep(1);
    }
    unlink(bodyp); unlink(cfg);
    sb_free(&body); sb_free(&prompt);
    if (text) {
        char *t = trimdup(text, strlen(text));
        free(text);
        text = t;
    }
    return text;
}

/* past a first line that only repeats the heading ("Highlights",
 * "## Highlights", "**Highlights:**") — models often echo it */
static const char *highlights_body(const char *text) {
    const char *p = text;
    while (*p == '#' || *p == '*' || *p == '_' || *p == ' ') p++;
    if (strncasecmp(p, "highlights", 10)) return text;
    p += 10;
    while (*p == '*' || *p == '_' || *p == ':' || *p == ' ' || *p == '\t') p++;
    if (*p && *p != '\n' && *p != '\r') return text;
    while (*p == '\n' || *p == '\r' || *p == ' ' || *p == '\t') p++;
    return p;
}

/* A summary is remembered by what it summarised: the release's commit
 * range, the model, and the notes it was shown. The newest section's range
 * ends at HEAD, so every new commit makes a new key and the model is asked
 * again only when there is something new. */
static void summ_cache_path(const Cg *cg, const Release *r, const Summ *s,
                            const char *notes, char *out, size_t cap) {
    char seed[1200], hash[65];
    char nh[65];
    sha256_hex(notes, strlen(notes), nh);
    snprintf(seed, sizeof seed, "%s|%s|%s", r->range, s->model, nh);
    sha256_hex(seed, strlen(seed), hash);
    snprintf(out, cap, "%s/%s/changelog-cache/%.16s.md", cg->shared, CG_DIR, hash);
}

/* ---------------- cg changelog ---------------- */

int cmd_changelog_git(Cg *cg, const ChangelogOpts *o) {
    const char *tree = cg->shared;
    char repo[1024];
    repo_url(tree, repo, sizeof repo);
    char vsrc[256], vnow[128] = "";
    version_source(tree, vsrc, sizeof vsrc);
    if (vsrc[0]) version_now(tree, vsrc, vnow, sizeof vnow);
    Boundary *bd = NULL;
    int nb = boundaries_load(tree, vsrc, &bd);
    /* Releases, newest first. A release is what came in between one version
     * and the next; the newest is what has come since the last boundary,
     * named by the version the working tree carries when that is a new one
     * (the release being prepared), by --tag, else [Unreleased]. */
    int nrel = 0;
    Release *rel = xmalloc(sizeof(Release) * (size_t)(nb + 1));
    {
        Release *u = &rel[nrel++];
        memset(u, 0, sizeof *u);
        const char *last = nb ? bd[nb - 1].name : "";
        if (o->tag && o->tag[0]) snprintf(u->name, sizeof u->name, "%s", o->tag);
        else if (vnow[0] && strcmp(vnow, last) != 0) snprintf(u->name, sizeof u->name, "%s", vnow);
        u->when = (long)time(NULL);
        if (nb) {
            snprintf(u->prev, sizeof u->prev, "%s", last);
            snprintf(u->range, sizeof u->range, "%s..HEAD", bd[nb - 1].commit);
        } else {
            snprintf(u->range, sizeof u->range, "HEAD");
        }
    }
    for (int i = nb - 1; i >= 0 && !o->unreleased; i--) {
        Release *r = &rel[nrel++];
        memset(r, 0, sizeof *r);
        snprintf(r->name, sizeof r->name, "%s", bd[i].name);
        r->when = bd[i].when;
        if (i > 0) {
            snprintf(r->prev, sizeof r->prev, "%s", bd[i - 1].name);
            snprintf(r->range, sizeof r->range, "%s..%s", bd[i - 1].commit, bd[i].commit);
        } else {
            snprintf(r->range, sizeof r->range, "%s", bd[i].commit);
        }
    }
    Summ sm;
    summ_config(cg, &sm);
    bool summarize = o->summarize == 1 || (o->summarize == 0 && sm.have);
    if (o->summarize == 1 && !sm.have) {
        fprintf(stderr, "cg changelog: --summarize needs CENTRA_API_KEY (or CG_CHANGELOG_KEY) "
                        "in the environment or %s/.env — writing the notes without highlights\n",
                cg->root);
        summarize = false;
    }

    StrBuf md; sb_init(&md);
    sb_puts(&md, "# Changelog\n\nAll notable changes to this project are recorded here, "
                 "generated from git history.\nA release is a tag or a version bump; a "
                 "group is the commit-subject prefix; a task\nreference is the "
                 "`[spec:<feature>/<task>]` a snapshot or fleet worker tagged the commit with.\n\n");
    int shown = 0, asked = 0, cached = 0;
    for (int i = 0; i < nrel && shown < o->limit; i++) {
        Release *r = &rel[i];
        Entry *v = NULL;
        int n = commits_load(tree, r->range, &v);
        if (n <= 0) { free(v); continue; }
        int live = 0;
        for (int k = 0; k < n; k++) live += !v[k].skip;
        if (!live) { for (int k = 0; k < n; k++) entry_free(&v[k]); free(v); continue; }
        StrBuf sec; sb_init(&sec);
        StrBuf notes; sb_init(&notes);
        render_release(&sec, r, v, n, repo, summarize ? &notes : NULL);
        if (summarize) {
            char cp[4800];
            summ_cache_path(cg, r, &sm, notes.p, cp, sizeof cp);
            char *text = read_entire_file(cp, NULL);
            if (text) cached++;
            else {
                char err[5000];
                text = summ_ask(cg, &sm, r, notes.p, err, sizeof err);
                asked++;
                if (text) {
                    char dir[4700];
                    snprintf(dir, sizeof dir, "%s/%s/changelog-cache", cg->shared, CG_DIR);
                    mkdirs(dir);
                    write_entire_file(cp, text, strlen(text));
                } else {
                    fprintf(stderr, "cg changelog: highlights for %s skipped — %s\n",
                            r->name[0] ? r->name : "Unreleased", err);
                }
            }
            const char *prose = text ? highlights_body(text) : NULL;
            if (prose && prose[0]) {
                /* the heading line, then the model's prose, then the record */
                char *nl = strchr(sec.p, '\n');
                size_t hl = nl ? (size_t)(nl - sec.p + 1) : sec.len;
                sb_printf(&md, "%.*s\n### Highlights\n\n%s\n%s", (int)hl, sec.p, prose, sec.p + hl);
            } else {
                sb_puts(&md, sec.p);
            }
            free(text);
        } else {
            sb_puts(&md, sec.p);
        }
        sb_putc(&md, '\n');
        sb_free(&sec); sb_free(&notes);
        for (int k = 0; k < n; k++) entry_free(&v[k]);
        free(v);
        shown++;
    }
    /* the footer: a link per release shown */
    int fshown = 0;
    for (int i = 0; repo[0] && i < nrel && fshown < o->limit; i++) {
        Release *r = &rel[i];
        Entry *v = NULL;
        int n = commits_load(tree, r->range, &v);
        int live = 0;
        for (int k = 0; k < n; k++) { live += !v[k].skip; entry_free(&v[k]); }
        free(v);
        if (n <= 0 || !live) continue;
        fshown++;
        if (r->name[0]) {
            if (r->prev[0]) sb_printf(&md, "[%s]: %s/compare/%s...%s\n", r->name, repo, r->prev, r->name);
            else sb_printf(&md, "[%s]: %s/releases/tag/%s\n", r->name, repo, r->name);
        } else if (r->prev[0]) {
            sb_printf(&md, "[Unreleased]: %s/compare/%s...HEAD\n", repo, r->prev);
        }
    }
    free(rel); free(bd);
    if (o->outfile) {
        char abs[4900];
        if (o->outfile[0] == '/') snprintf(abs, sizeof abs, "%s", o->outfile);
        else snprintf(abs, sizeof abs, "%s/%s", cg->root, o->outfile);
        if (write_entire_file(abs, md.p, md.len) != 0) {
            fprintf(stderr, "cg: cannot write %s\n", abs);
            sb_free(&md);
            return 1;
        }
        printf("wrote %s (%d release entr%s%s%s)\n", abs, shown, shown == 1 ? "y" : "ies",
               summarize ? ", highlights by " : "", summarize ? sm.model : "");
        if (summarize) printf("  highlights: %d written now, %d from the cache\n", asked, cached);
    } else {
        fputs(md.p, stdout);
    }
    sb_free(&md);
    return 0;
}
