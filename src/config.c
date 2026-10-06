/*
 * codify.kvx — project configuration, one optional file at the root of a
 * tree.
 *
 *   [sync]  auto = true             implicit syncs (hooks, read-command
 *                                   freshness, MCP/LSP/serve/watch)
 *   [paths] spec = "spec"           workflow.kvx, feature specs, mirrors
 *           context = ".codify"     agent-context.md, recap.md
 *           skills = ".agents/skills"   generated SKILL.md files
 *           codemap = "CODEMAP.md"  written by cg codemap
 *
 * The file belongs to the tree, exactly like the spec directory it may
 * relocate: it travels with the branch, so a linked worktree reads its own
 * copy. Every accessor therefore takes the tree it asks about, and one
 * process that works across several trees (fleet, orchestrator, watch
 * --fleet) gets one cached load per tree.
 *
 * A missing file or key is the built-in default, which is what makes a
 * repository without the file behave exactly as before. A value that cannot
 * be used is reported once per process, naming the key and the file, and the
 * default stands in for it: configuration never stops a command.
 */
#include "cg.h"
#include <ctype.h>
#include <pthread.h>
#include <sys/stat.h>
#include <unistd.h>

typedef enum { CFG_BOOL, CFG_PATH } CfgType;

/* The schema. Order is the order of every listing and of `cg config init`. */
static const struct {
    const char *section, *key;
    CfgType type;
    const char *dflt;
    const char *doc;               /* the comment `cg config init` writes */
} CFG_KEYS[CFG_NKEYS] = {
    [CFG_SYNC_AUTO]    = { "sync",  "auto",    CFG_BOOL, "true",
                           "implicit syncs: hooks, read-command freshness, "
                           "MCP/LSP/serve/watch" },
    [CFG_PATH_SPEC]    = { "paths", "spec",    CFG_PATH, "spec",
                           "workflow.kvx, feature specs, rendered mirrors" },
    [CFG_PATH_CONTEXT] = { "paths", "context", CFG_PATH, ".codify",
                           "agent-context.md, recap.md" },
    [CFG_PATH_SKILLS]  = { "paths", "skills",  CFG_PATH, ".agents/skills",
                           "generated SKILL.md files" },
    [CFG_PATH_CODEMAP] = { "paths", "codemap", CFG_PATH, "CODEMAP.md",
                           "written by cg codemap" },
};

static const char CFG_TEMPLATE[] =
"# codify.kvx — project configuration for Codify. Every key is optional.\n"
"[sync]\n"
"auto = true                 # implicit syncs: hooks, read-command freshness, MCP/LSP/serve/watch\n"
"\n"
"[paths]\n"
"spec    = \"spec\"            # workflow.kvx, feature specs, rendered mirrors\n"
"context = \".codify\"         # agent-context.md, recap.md\n"
"skills  = \".agents/skills\"  # generated SKILL.md files\n"
"codemap = \"CODEMAP.md\"      # written by cg codemap\n";

/* ---------------- reading and validating ---------------- */

typedef struct {
    /* parse | unknown_section | unknown_key | bad_value */
    const char *kind;
    char section[128], key[128];
    char msg[1200];
} CfgIssue;

typedef struct { CfgIssue *v; int n, cap; } CfgIssues;

static void cfg_issue(CfgIssues *is, const char *kind, const char *section,
                      const char *key, const char *fmt, ...)
    __attribute__((format(printf, 5, 6)));

static void cfg_issue(CfgIssues *is, const char *kind, const char *section,
                      const char *key, const char *fmt, ...) {
    if (!is) return;
    if (is->n == is->cap) {
        is->cap = is->cap ? is->cap * 2 : 8;
        is->v = xrealloc(is->v, sizeof *is->v * (size_t)is->cap);
    }
    CfgIssue *x = &is->v[is->n++];
    memset(x, 0, sizeof *x);
    x->kind = kind;
    snprintf(x->section, sizeof x->section, "%s", section ? section : "");
    snprintf(x->key, sizeof x->key, "%s", key ? key : "");
    va_list ap;
    va_start(ap, fmt);
    vsnprintf(x->msg, sizeof x->msg, fmt, ap);
    va_end(ap);
}

static int cfg_index(const char *section, const char *key) {
    for (int i = 0; i < CFG_NKEYS; i++)
        if (!strcmp(CFG_KEYS[i].section, section) &&
            !strcmp(CFG_KEYS[i].key, key))
            return i;
    return -1;
}

/* "section.key" -> index; -1 when the schema has no such key */
static int cfg_index_dotted(const char *dotted) {
    const char *dot = strchr(dotted, '.');
    if (!dot) return -1;
    char sec[128];
    snprintf(sec, sizeof sec, "%.*s", (int)(dot - dotted), dotted);
    return cfg_index(sec, dot + 1);
}

static bool cfg_known_section(const char *section) {
    for (int i = 0; i < CFG_NKEYS; i++)
        if (!strcmp(CFG_KEYS[i].section, section)) return true;
    return false;
}

/* true/false and the usual spellings of each; -1 for anything else */
static int cfg_parse_bool(const char *v) {
    static const char *T[] = { "true", "yes", "on", "1", NULL };
    static const char *F[] = { "false", "no", "off", "0", NULL };
    for (int i = 0; T[i]; i++) if (!strcasecmp(v, T[i])) return 1;
    for (int i = 0; F[i]; i++) if (!strcasecmp(v, F[i])) return 0;
    return -1;
}

/* Normalize a configured path to clean root-relative form ("./a//b/" ->
 * "a/b"). NULL on success, else why it cannot be used. Lexical only: the
 * directory need not exist yet, since `cg spec new` is what creates it. */
static const char *cfg_path_check(const char *v, char *out, size_t cap) {
    if (!v[0]) return "is empty";
    if (v[0] == '/' || v[0] == '~') return "is absolute";
    if (strchr(v, '\\')) return "uses a backslash; write it with /";
    char buf[1024];
    if (strlen(v) >= sizeof buf || strlen(v) >= cap) return "is too long";
    snprintf(buf, sizeof buf, "%s", v);
    char norm[1024] = "";
    size_t nl = 0;
    char *save = NULL;
    for (char *c = strtok_r(buf, "/", &save); c;
         c = strtok_r(NULL, "/", &save)) {
        if (!strcmp(c, ".")) continue;
        if (!strcmp(c, "..")) {
            if (!nl) return "escapes the repository with ..";
            char *slash = strrchr(norm, '/');
            nl = slash ? (size_t)(slash - norm) : 0;
            norm[nl] = 0;
            continue;
        }
        nl += (size_t)snprintf(norm + nl, sizeof norm - nl, "%s%s",
                               nl ? "/" : "", c);
    }
    if (!nl) return "names the repository root itself";
    size_t first = strcspn(norm, "/");
    if ((first == 4 && !strncmp(norm, ".git", 4)) ||
        (first == 10 && !strncmp(norm, CG_DIR, 10)))
        return "lies inside " CG_DIR " or .git, which Codify and git own";
    snprintf(out, cap, "%s", norm);
    return NULL;
}

static char *cfg_slot(CgConfig *c, int i) {
    switch (i) {
    case CFG_PATH_SPEC:    return c->spec;
    case CFG_PATH_CONTEXT: return c->context;
    case CFG_PATH_SKILLS:  return c->skills;
    case CFG_PATH_CODEMAP: return c->codemap;
    default:               return NULL;
    }
}

static void cfg_defaults(CgConfig *c, const char *root) {
    memset(c, 0, sizeof *c);
    snprintf(c->root, sizeof c->root, "%s", root);
    snprintf(c->file, sizeof c->file, "%s/%s", root, CG_CONFIG_FILE);
    c->sync_auto = true;
    for (int i = 0; i < CFG_NKEYS; i++) {
        char *s = cfg_slot(c, i);
        if (s) snprintf(s, sizeof c->spec, "%s", CFG_KEYS[i].dflt);
    }
}

/* Parse <root>/codify.kvx into c, every problem into is (may be NULL). */
static void cfg_read(const char *root, CgConfig *c, CfgIssues *is) {
    cfg_defaults(c, root);
    struct stat st;
    if (stat(c->file, &st) != 0) return;
    c->present = true;
    Kvx *k = kvx_parse(c->file);
    if (!k) {
        cfg_issue(is, "parse", NULL, NULL,
                  "%s does not parse (one `key = value` per line under "
                  "[section] headers) — every setting is the default",
                  c->file);
        return;
    }
    for (int s = 0; s < k->nsec; s++) {
        const char *sec = k->secs[s];
        if (!sec[0] || cfg_known_section(sec)) continue;
        cfg_issue(is, "unknown_section", sec, NULL,
                  "%s: unknown section [%s] — ignored", c->file, sec);
    }
    for (int e = 0; e < k->n; e++) {
        const KvxEntry *x = &k->v[e];
        int i = cfg_index(x->section, x->key);
        if (i < 0) {
            if (!x->section[0])
                cfg_issue(is, "unknown_key", "", x->key,
                          "%s: key %s outside any section — ignored",
                          c->file, x->key);
            else if (cfg_known_section(x->section))
                cfg_issue(is, "unknown_key", x->section, x->key,
                          "%s: unknown key %s in [%s] — ignored",
                          c->file, x->key, x->section);
            continue;
        }
        char *v = kvx_str(k, x->section, x->key);
        if (CFG_KEYS[i].type == CFG_BOOL) {
            int b = cfg_parse_bool(v);
            if (b < 0)
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s is not true or false — using "
                          "the default %s", c->file, x->section, x->key,
                          x->raw, CFG_KEYS[i].dflt);
            else {
                c->sync_auto = b == 1;
                c->from_file[i] = true;
            }
        } else {
            char norm[1024];
            const char *why = cfg_path_check(v, norm, sizeof norm);
            if (why)
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s %s — using the default \"%s\"",
                          c->file, x->section, x->key, x->raw, why,
                          CFG_KEYS[i].dflt);
            else {
                snprintf(cfg_slot(c, i), sizeof c->spec, "%s", norm);
                c->from_file[i] = true;
            }
        }
        free(v);
    }
    kvx_free(k);
}

/* ---------------- the per-tree cache ---------------- */

typedef struct CfgNode { CgConfig c; struct CfgNode *next; } CfgNode;
static CfgNode *cfg_cache;
static pthread_mutex_t cfg_mu = PTHREAD_MUTEX_INITIALIZER;
static bool cfg_quiet;

const CgConfig *config_load(const char *root) {
    char key[4096];
    snprintf(key, sizeof key, "%s", root && root[0] ? root : ".");
    size_t n = strlen(key);
    while (n > 1 && key[n - 1] == '/') key[--n] = 0;
    pthread_mutex_lock(&cfg_mu);
    for (CfgNode *p = cfg_cache; p; p = p->next)
        if (!strcmp(p->c.root, key)) {
            pthread_mutex_unlock(&cfg_mu);
            return &p->c;
        }
    CfgNode *node = xmalloc(sizeof *node);
    CfgIssues is = {0};
    cfg_read(key, &node->c, &is);
    /* only what changes behaviour is said unprompted; unknown names wait
     * for `cg config check` and `cg check`. cg config reports every issue
     * itself. */
    for (int i = 0; i < is.n; i++)
        if (strcmp(is.v[i].kind, "parse") == 0 ||
            strcmp(is.v[i].kind, "bad_value") == 0) {
            if (!cfg_quiet) fprintf(stderr, "cg: %s\n", is.v[i].msg);
            node->c.nproblems++;
        }
    free(is.v);
    node->next = cfg_cache;
    cfg_cache = node;
    pthread_mutex_unlock(&cfg_mu);
    return &node->c;
}

bool config_auto_sync(const char *root) { return config_load(root)->sync_auto; }
const char *config_spec_rel(const char *root) {
    return config_load(root)->spec;
}
const char *config_context_rel(const char *root) {
    return config_load(root)->context;
}
const char *config_skills_rel(const char *root) {
    return config_load(root)->skills;
}
const char *config_codemap_rel(const char *root) {
    return config_load(root)->codemap;
}

bool config_spec_dir(const char *root, char *out, size_t cap) {
    return path_format(out, cap, "%s/%s", root, config_spec_rel(root));
}

bool config_workflow_path(const char *root, char *out, size_t cap) {
    return path_format(out, cap, "%s/%s/workflow.kvx", root,
                       config_spec_rel(root));
}

bool config_feature_path(const char *root, const char *feature, char *out,
                         size_t cap) {
    return path_format(out, cap, "%s/%s/%s/spec.kvx", root,
                       config_spec_rel(root), feature);
}

bool config_context_dir(const char *root, char *out, size_t cap) {
    return path_format(out, cap, "%s/%s", root, config_context_rel(root));
}

bool config_context_path(const char *root, const char *name, char *out,
                         size_t cap) {
    return path_format(out, cap, "%s/%s/%s", root, config_context_rel(root),
                       name);
}

bool config_skills_dir(const char *root, char *out, size_t cap) {
    return path_format(out, cap, "%s/%s", root, config_skills_rel(root));
}

bool config_codemap_path(const char *root, char *out, size_t cap) {
    return path_format(out, cap, "%s/%s", root, config_codemap_rel(root));
}

bool config_in_spec(const char *root, const char *rel) {
    const char *s = config_spec_rel(root);
    size_t n = strlen(s);
    return !strncmp(rel, s, n) && rel[n] == '/';
}

int config_find_spec_root(const char *start, char *out, size_t cap) {
    char dir[4096];
    if (start) snprintf(dir, sizeof dir, "%s", start);
    else if (!getcwd(dir, sizeof dir)) return -1;
    for (;;) {
        char probe[4600];
        if (config_workflow_path(dir, probe, sizeof probe) &&
            access(probe, F_OK) == 0) {
            snprintf(out, cap, "%s", dir);
            return 0;
        }
        char *slash = strrchr(dir, '/');
        if (!slash || slash == dir) return -1;
        *slash = 0;
    }
}

/* ---------------- problems: cg check, cg config check ---------------- */

static void cfg_issues_json(const CgConfig *c, const CfgIssues *is,
                            StrBuf *b) {
    sb_puts(b, "{\"file\":");
    sb_json_str(b, c->file);
    sb_printf(b, ",\"present\":%s,\"ok\":%s,\"problems\":[",
              c->present ? "true" : "false", is->n ? "false" : "true");
    for (int i = 0; i < is->n; i++) {
        if (i) sb_putc(b, ',');
        sb_puts(b, "{\"kind\":");
        sb_json_str(b, is->v[i].kind);
        sb_puts(b, ",\"section\":");
        if (is->v[i].section[0]) sb_json_str(b, is->v[i].section);
        else sb_puts(b, "null");
        sb_puts(b, ",\"key\":");
        if (is->v[i].key[0]) sb_json_str(b, is->v[i].key);
        else sb_puts(b, "null");
        sb_puts(b, ",\"message\":");
        sb_json_str(b, is->v[i].msg);
        sb_putc(b, '}');
    }
    sb_puts(b, "]}");
}

int config_check(const char *root, StrBuf *text, StrBuf *json) {
    CgConfig c;
    CfgIssues is = {0};
    cfg_read(root, &c, &is);
    if (text)
        for (int i = 0; i < is.n; i++)
            sb_printf(text, "%s\n", is.v[i].msg);
    if (json) cfg_issues_json(&c, &is, json);
    int n = is.n;
    free(is.v);
    return n;
}

/* ---------------- cg config ---------------- */

/* The tree `cg config` speaks for: the enclosing Codify project, else the
 * spec root, else here — so it works in a spec-only repository and before
 * cg init. */
static void cfg_root(char *out, size_t cap) {
    char here[4096], root[4096], shared[4096];
    if (!getcwd(here, sizeof here)) snprintf(here, sizeof here, ".");
    if (cg_find_project_at(here, root, shared, sizeof root) == 0)
        snprintf(out, cap, "%s", root);
    else if (config_find_spec_root(here, root, sizeof root) == 0)
        snprintf(out, cap, "%s", root);
    else
        snprintf(out, cap, "%s", here);
}

static const char *cfg_value(const CgConfig *c, int i) {
    if (i == CFG_SYNC_AUTO) return c->sync_auto ? "true" : "false";
    return cfg_slot((CgConfig *)c, i);
}

static void cfg_setting_json(const CgConfig *c, int i, StrBuf *b) {
    sb_puts(b, "{\"key\":");
    char dotted[300];
    snprintf(dotted, sizeof dotted, "%s.%s", CFG_KEYS[i].section,
             CFG_KEYS[i].key);
    sb_json_str(b, dotted);
    sb_puts(b, ",\"value\":");
    if (CFG_KEYS[i].type == CFG_BOOL) sb_puts(b, cfg_value(c, i));
    else sb_json_str(b, cfg_value(c, i));
    sb_puts(b, ",\"default\":");
    if (CFG_KEYS[i].type == CFG_BOOL) sb_puts(b, CFG_KEYS[i].dflt);
    else sb_json_str(b, CFG_KEYS[i].dflt);
    sb_printf(b, ",\"origin\":\"%s\"}",
              c->from_file[i] ? CG_CONFIG_FILE : "default");
}

static int cfg_list(const char *root, bool json) {
    CgConfig c;
    CfgIssues is = {0};
    cfg_read(root, &c, &is);
    StrBuf b; sb_init(&b);
    if (json) {
        sb_puts(&b, "{\"root\":");
        sb_json_str(&b, root);
        sb_puts(&b, ",\"file\":");
        sb_json_str(&b, c.file);
        sb_printf(&b, ",\"present\":%s,\"settings\":[",
                  c.present ? "true" : "false");
        for (int i = 0; i < CFG_NKEYS; i++) {
            if (i) sb_putc(&b, ',');
            cfg_setting_json(&c, i, &b);
        }
        sb_printf(&b, "],\"problems\":%d}\n", is.n);
    } else {
        sb_printf(&b, "%s%s\n", c.file,
                  c.present ? "" : " (absent — every setting is the default)");
        for (int i = 0; i < CFG_NKEYS; i++) {
            char dotted[300];
            snprintf(dotted, sizeof dotted, "%s.%s", CFG_KEYS[i].section,
                     CFG_KEYS[i].key);
            sb_printf(&b, "  %-14s %-24s %s\n", dotted, cfg_value(&c, i),
                      c.from_file[i] ? CG_CONFIG_FILE : "default");
        }
        if (is.n)
            sb_printf(&b, "%d problem(s) — `cg config check` lists them\n",
                      is.n);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    free(is.v);
    return 0;
}

static int cfg_init(const char *root) {
    char path[4600];
    snprintf(path, sizeof path, "%s/%s", root, CG_CONFIG_FILE);
    struct stat st;
    if (stat(path, &st) == 0) {
        fprintf(stderr, "cg config: %s already exists — left alone (`cg "
                "config set` changes one key)\n", path);
        return 1;
    }
    if (write_entire_file(path, CFG_TEMPLATE, sizeof CFG_TEMPLATE - 1) != 0) {
        fprintf(stderr, "cg config: cannot write %s\n", path);
        return 1;
    }
    printf("wrote %s\n", path);
    return 0;
}

static int cfg_get(const char *root, const char *dotted, bool json) {
    int i = cfg_index_dotted(dotted);
    if (i < 0) {
        fprintf(stderr, "cg config: unknown key '%s' (`cg config` lists "
                "them)\n", dotted);
        return 1;
    }
    CgConfig c;
    cfg_read(root, &c, NULL);
    if (json) {
        StrBuf b; sb_init(&b);
        cfg_setting_json(&c, i, &b);
        printf("%s\n", b.p);
        sb_free(&b);
    } else {
        printf("%s\n", cfg_value(&c, i));
    }
    return 0;
}

static int cfg_set(const char *root, const char *dotted, const char *value) {
    int i = cfg_index_dotted(dotted);
    if (i < 0) {
        fprintf(stderr, "cg config: unknown key '%s' (`cg config` lists "
                "them)\n", dotted);
        return 1;
    }
    char norm[1024];
    if (CFG_KEYS[i].type == CFG_BOOL) {
        int b = cfg_parse_bool(value);
        if (b < 0) {
            fprintf(stderr, "cg config: %s takes true or false, not '%s'\n",
                    dotted, value);
            return 1;
        }
        snprintf(norm, sizeof norm, "%s", b ? "true" : "false");
    } else {
        const char *why = cfg_path_check(value, norm, sizeof norm);
        if (why) {
            fprintf(stderr, "cg config: %s = \"%s\" %s — nothing written\n",
                    dotted, value, why);
            return 1;
        }
    }
    char path[4600];
    snprintf(path, sizeof path, "%s/%s", root, CG_CONFIG_FILE);
    struct stat st;
    if (stat(path, &st) != 0) {
        static const char head[] = "# codify.kvx — project configuration for "
                                   "Codify. Every key is optional.\n";
        if (write_entire_file(path, head, sizeof head - 1) != 0) {
            fprintf(stderr, "cg config: cannot write %s\n", path);
            return 1;
        }
    }
    int rc = CFG_KEYS[i].type == CFG_BOOL
           ? kvx_set_raw(path, CFG_KEYS[i].section, CFG_KEYS[i].key, norm)
           : kvx_set_string(path, CFG_KEYS[i].section, CFG_KEYS[i].key, norm);
    if (rc != 0) {
        fprintf(stderr, "cg config: cannot write %s\n", path);
        return 1;
    }
    printf("%s = %s (%s)\n", dotted, norm, path);
    return 0;
}

int cmd_config(int argc, char **argv, bool json) {
    cfg_quiet = true;
    char root[4096];
    cfg_root(root, sizeof root);
    const char *sub = argc > 0 ? argv[0] : NULL;
    if (!sub || !strcmp(sub, "list") || !strcmp(sub, "show"))
        return cfg_list(root, json);
    if (!strcmp(sub, "init")) return cfg_init(root);
    if (!strcmp(sub, "get") && argc == 2) return cfg_get(root, argv[1], json);
    if (!strcmp(sub, "set") && argc == 3)
        return cfg_set(root, argv[1], argv[2]);
    if (!strcmp(sub, "check")) {
        StrBuf t; sb_init(&t);
        StrBuf j; sb_init(&j);
        int n = config_check(root, &t, &j);
        if (json) printf("%s\n", j.p);
        else if (n) fputs(t.p, stdout);
        else if (config_load(root)->present)
            printf("%s/%s: ok\n", root, CG_CONFIG_FILE);
        else
            printf("%s/%s: absent — every setting is the default\n", root,
                   CG_CONFIG_FILE);
        sb_free(&t); sb_free(&j);
        return n ? 1 : 0;
    }
    fprintf(stderr, "usage: cg config [init | get <section.key> | "
            "set <section.key> <value> | check] [--json]\n");
    return 1;
}
