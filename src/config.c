/*
 * hyperfide.kvx (legacy codify.kvx) — project configuration, one optional
 * file at the root of a tree.
 *
 *   [sync]  auto = true             implicit syncs (hooks, read-command
 *                                   freshness, MCP/LSP/serve/watch)
 *   [paths] spec = "spec"           workflow.kvx, feature specs, mirrors
 *           context = ".codify"     agent-context.md, recap.md
 *           skills = ".agents/skills"   generated SKILL.md files
 *           codemap = "CODEMAP.md"  written by hyperfide codemap
 *   [index] workers = auto          parse workers per index pass: 1..64,
 *                                   or auto (0) for the machine's choice
 *           walk = auto             how a whole-tree pass finds changes:
 *                                   git above 20000 files, else the walk
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
 * default stands in for it: a value never stops a command. The one refusal
 * is which file to read: hyperfide.kvx beside codify.kvx without a completed
 * names migration exits 2, because spec/hyperfide 26.3 requires a config
 * conflict to be detected and resolved explicitly, never guessed.
 */
#include "cg.h"
#include <ctype.h>
#include <errno.h>
#include <pthread.h>
#include <sys/stat.h>
#include <unistd.h>

/* Validate every explicit alias group before mutating the environment. */
int hyperfide_environment_aliases(void) {
    static const char *names[][3] = {
        {"HYPERFIDE_AGENT","CG_AGENT",""},
        {"HYPERFIDE_ATTEMPT","CG_ATTEMPT",""},
        {"HYPERFIDE_BASE","CG_BASE",""},
        {"HYPERFIDE_BINARY","CG_BINARY",""},
        {"HYPERFIDE_BODY_FIRST","CG_BODY_FIRST",""},
        {"HYPERFIDE_BRANCH","CG_BRANCH",""},
        {"HYPERFIDE_BUSY_TIMEOUT_MS","CG_BUSY_TIMEOUT_MS",""},
        {"HYPERFIDE_CHANGELOG_CURL","CG_CHANGELOG_CURL",""},
        {"HYPERFIDE_CHANGELOG_ENDPOINT","CG_CHANGELOG_ENDPOINT",""},
        {"HYPERFIDE_CHANGELOG_KEY","CG_CHANGELOG_KEY",""},
        {"HYPERFIDE_CHANGELOG_MODEL","CG_CHANGELOG_MODEL",""},
        {"HYPERFIDE_CLAUDE","CG_CLAUDE",""},
        {"HYPERFIDE_COLOR","CG_COLOR",""},
        {"HYPERFIDE_EVENTS_KEEP","CG_EVENTS_KEEP",""},
        {"HYPERFIDE_FEATURE","CG_FEATURE",""},
        {"HYPERFIDE_FENCE","CG_FENCE",""},
        {"HYPERFIDE_GH","CG_GH",""},
        {"HYPERFIDE_HOST","CG_HOST",""},
        {"HYPERFIDE_INDEX_SLOTS","CG_INDEX_SLOTS",""},
        {"HYPERFIDE_INDEX_WORKERS","CG_INDEX_WORKERS",""},
        {"HYPERFIDE_INSPECT_REACH_LIMIT","CG_INSPECT_REACH_LIMIT",""},
        {"HYPERFIDE_JEV_ATTEMPTS","CG_JEV_ATTEMPTS",""},
        {"HYPERFIDE_JEV_BACKOFF_MS","CG_JEV_BACKOFF_MS",""},
        {"HYPERFIDE_JEV_CURL","CG_JEV_CURL",""},
        {"HYPERFIDE_JEV_ENDPOINT","CG_JEV_ENDPOINT",""},
        {"HYPERFIDE_JEV_MODEL","CG_JEV_MODEL",""},
        {"HYPERFIDE_JEV_TIMEOUT","CG_JEV_TIMEOUT",""},
        {"HYPERFIDE_MERGE_LOCK_WAIT_MS","CG_MERGE_LOCK_WAIT_MS",""},
        {"HYPERFIDE_PACKET_BUDGET","CG_PACKET_BUDGET",""},
        {"HYPERFIDE_PARENT","CG_PARENT",""},
        {"HYPERFIDE_PROGRESS","CG_PROGRESS",""},
        {"HYPERFIDE_PROGRESS_ENFORCE","CG_PROGRESS_ENFORCE",""},
        {"HYPERFIDE_RECAP_CHUNK","CG_RECAP_CHUNK",""},
        {"HYPERFIDE_RECAP_CLAUDE_DIR","CG_RECAP_CLAUDE_DIR",""},
        {"HYPERFIDE_RECAP_CODEX_DIR","CG_RECAP_CODEX_DIR",""},
        {"HYPERFIDE_RECAP_DECIDE_ENDPOINT","CG_RECAP_DECIDE_ENDPOINT",""},
        {"HYPERFIDE_RECAP_DECIDE_MODEL","CG_RECAP_DECIDE_MODEL",""},
        {"HYPERFIDE_RECAP_MAX_SNIPPETS","CG_RECAP_MAX_SNIPPETS",""},
        {"HYPERFIDE_RECAP_MODEL","CG_RECAP_MODEL",""},
        {"HYPERFIDE_RECAP_PARALLEL","CG_RECAP_PARALLEL",""},
        {"HYPERFIDE_ROLE","CG_ROLE",""},
        {"HYPERFIDE_RUN","CG_RUN",""},
        {"HYPERFIDE_SEM_FAIL_BEFORE_PUBLISH","CG_SEM_FAIL_BEFORE_PUBLISH",""},
        {"HYPERFIDE_SESSION","CG_SESSION",""},
        {"HYPERFIDE_SHELL_ADVICE","CG_SHELL_ADVICE",""},
        {"HYPERFIDE_SLOT_DIR","CG_SLOT_DIR",""},
        {"HYPERFIDE_SUPERVISOR_LOG","CG_SUPERVISOR_LOG",""},
        {"HYPERFIDE_TASK","CG_TASK",""},
        {"HYPERFIDE_WALK_THREADS","CG_WALK_THREADS",""},
        {"HYPERFIDE_WATCH_POLL_MS","CG_WATCH_POLL_MS",""},
        {"HYPERFIDE_WATCH_TEST_EVENT","CG_WATCH_TEST_EVENT",""},
        {"HYPERFIDE_WATCH_TEST_REG_FAIL_ONCE","CG_WATCH_TEST_REG_FAIL_ONCE",""},
        {"HYPERFIDE_WATCH_TEST_SYNC_FAIL_ONCE","CG_WATCH_TEST_SYNC_FAIL_ONCE",""},
        {"HYPERFIDE_WAVE","CG_WAVE",""},
        {"HYPERFIDE_ROOT","CODIFY_ROOT",""},
        {"HYPERFIDE_AUTHORITY_URL","CG_AUTHORITY_URL","CODIFY_AUTHORITY_URL"},
        {"HYPERFIDE_CREDENTIAL_FILE","CG_CREDENTIAL_FILE","CODIFY_CREDENTIAL_FILE"},
        {"HYPERFIDE_AUTHORITY_DESCRIPTOR","CG_AUTHORITY_DESCRIPTOR","CODIFY_AUTHORITY_DESCRIPTOR"},
        {"HYPERFIDE_TRANSPORT_CONFIG","CG_TRANSPORT_CONFIG","CODIFY_TRANSPORT_CONFIG"},
        {"HYPERFIDE_MCP_TOOL_POLICY_FILE","CG_MCP_TOOL_POLICY_FILE","CODIFY_MCP_TOOL_POLICY_FILE"},
        {"HYPERFIDE_MODE","CG_MODE","CODIFY_MODE"},
        {"HYPERFIDE_INSTALL_DIR","CODIFY_INSTALL_DIR",""},
        {"HYPERFIDE_BASE_URL","CODIFY_BASE_URL",""},
    };
    for (size_t i=0;i<sizeof names/sizeof names[0];i++) {
        const char *value=NULL;
        for(int j=0;j<3&&names[i][j][0];j++) {
            const char *candidate=getenv(names[i][j]);
            if(candidate && value && strcmp(candidate,value)) {
                fprintf(stderr,"hyperfide: conflicting variable aliases for %s (values redacted)\n",names[i][0]);
                return 2;
            }
            if(candidate)value=candidate;
        }
    }
    for(size_t i=0;i<sizeof names/sizeof names[0];i++) {
        char *value=NULL;
        for(int j=0;j<3&&names[i][j][0];j++)if(getenv(names[i][j])){value=xstrdup(getenv(names[i][j]));break;}
        if(!value)continue;
        for(int j=0;j<3&&names[i][j][0];j++)if(setenv(names[i][j],value,1)){free(value);return 2;}
        free(value);
    }
    return 0;
}
static char *names_metadata(const char *filename) {
    struct stat st;
    if(lstat(filename,&st)||!S_ISREG(st.st_mode)||st.st_size>1048576)return NULL;
    return read_entire_file(filename,NULL);
}
static bool names_migration_selects_canonical(const char *root,const char *legacy) {
    char pathname[4600];
    snprintf(pathname,sizeof pathname,"%s/.hyperfide",root);
    struct stat st;
    if(lstat(pathname,&st)||!S_ISDIR(st.st_mode))return false;
    snprintf(pathname,sizeof pathname,"%s/.hyperfide/names.json",root);
    char *body=names_metadata(pathname);
    if(!body)return false;
    char *id=json_get_string(body,"migration_id"),*digest=json_get_string(body,"manifest_digest"),
         *state=json_get_string(body,"state"),*raw=json_get_raw(body,"mappings");
    bool valid=id&&strlen(id)==36&&digest&&strlen(digest)==71&&!strncmp(digest,"sha256:",7)&&state&&!strcmp(state,"APPLIED")&&json_get_int(body,"schema_version",0)==1;
    if(valid)for(int i=0;i<36;i++)if((i==8||i==13||i==18||i==23)?id[i]!='-':!isxdigit((unsigned char)id[i]))valid=false;
    bool mapping=false;
    char **items=NULL;int count=raw?json_array_items(raw,&items):0;
    for(int i=0;i<count;i++){
        char *from=json_get_string(items[i],"legacy"),*to=json_get_string(items[i],"canonical"),*pin=json_get_string(items[i],"digest");
        if(from&&to&&pin&&!strcmp(from,"codify.kvx")&&!strcmp(to,"hyperfide.kvx")){
            size_t length=0;char *source=read_entire_file(legacy,&length);char actual[72]="sha256:";
            if(source){sha256_hex(source,length,actual+7);mapping=!strcmp(pin,actual);free(source);}
        }
        free(from);free(to);free(pin);free(items[i]);
    }
    free(items);
    /* The completed selection is portable; private rollback journals stay local. */
    free(body);free(id);free(digest);free(state);free(raw);
    return valid&&mapping;
}
static void config_selected_path(const char *root,char *out,size_t capacity) {
    char canonical[4600],legacy[4600];struct stat a,b;
    snprintf(canonical,sizeof canonical,"%s/hyperfide.kvx",root);
    snprintf(legacy,sizeof legacy,"%s/codify.kvx",root);
    bool has_new=stat(canonical,&a)==0,has_old=stat(legacy,&b)==0;
    if(has_new&&has_old&&!names_migration_selects_canonical(root,legacy)) {
        fprintf(stderr,"hyperfide: both hyperfide.kvx and codify.kvx exist without a matching completed names migration; resolve the configuration conflict explicitly\n");
        exit(2);
    }
    snprintf(out,capacity,"%s",has_new?canonical:has_old?legacy:canonical);
}

typedef enum { CFG_BOOL, CFG_PATH, CFG_INT, CFG_STR, CFG_DUR,
               CFG_LIST, CFG_ENUM } CfgType;   /* codify-v15 3.1, 1.3 */

/* The schema. Order is the order of every listing and of `hyperfide config init`. */
static const struct {
    const char *section, *key;
    CfgType type;
    const char *dflt;
    const char *doc;               /* the comment `hyperfide config init` writes */
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
                           "written by hyperfide codemap" },
    [CFG_INDEX_WORKERS] = { "index", "workers", CFG_INT, "auto",
                           "parse workers per index pass: 1-64, or auto" },
    /* codify-v15 3.1 */
    [CFG_PROJ_BASE]    = { "projection", "base", CFG_STR, "",
                           "branch the projection folds onto; empty: "
                           "[hierarchy] main, else main" },
    [CFG_PROJ_STALE]   = { "projection", "stale", CFG_DUR, "24h",
                           "a branch without a live agent stays active this "
                           "long after its last index" },
    [CFG_PROJ_EXCLUDE] = { "projection", "exclude", CFG_LIST, "",
                           "branch-name globs never folded in" },
    [CFG_PROJ_INDEX]   = { "projection", "index", CFG_BOOL, "false",
                           "check the projection out and index it as branch "
                           "codify/projection" },
    /* codify-v15 2.4 */
    [CFG_FLEET_DISCOVER] = { "fleet", "discover", CFG_BOOL, "true",
                           "fleet status/tree, serve and watch --fleet run hyperfide "
                           "fleet discover first (once per 10s)" },
    /* codify-v15 3.2 */
    [CFG_PROJ_STEER]   = { "projection", "steer", CFG_BOOL, "true",
                           "steer the agents on both branches when a build "
                           "finds a new conflict" },
    /* codify-v15 1.4 */
    [CFG_HOOKS_SHELL_ADVICE] = { "hooks", "shell_advice", CFG_BOOL, "true",
                           "hyperfide hook pre-bash points a shell grep/find at "
                           "hyperfide grep and hyperfide files" },
    /* codify-v15 1.3 */
    [CFG_INDEX_WALK]   = { "index", "walk", CFG_ENUM, "auto",
                           "how a whole-tree pass finds changes: auto, git, "
                           "or full" },
    /* codify-v15 3.3 */
    [CFG_PROJ_AUTO]    = { "projection", "auto", CFG_BOOL, "true",
                           "hooks, watch, serve and the supervisor start a "
                           "background build when work happens" },
    [CFG_PROJ_MIN_INTERVAL] = { "projection", "min_interval", CFG_DUR, "15s",
                           "an automatic build waits this long after the "
                           "last one" },
};

static const char CFG_TEMPLATE[] =
"# hyperfide.kvx — project configuration for Hyperfide. Every key is optional.\n"
"[sync]\n"
"auto = true                 # implicit syncs: hooks, read-command freshness, MCP/LSP/serve/watch\n"
"\n"
"[paths]\n"
"spec    = \"spec\"            # workflow.kvx, feature specs, rendered mirrors\n"
"context = \".hyperfide/context\"         # agent-context.md, recap.md\n"
"skills  = \".agents/skills\"  # generated SKILL.md files\n"
"codemap = \"CODEMAP.md\"      # written by hyperfide codemap\n"
"\n"
"[index]\n"
"# workers = auto            # parse workers per index pass: 1-64; auto sizes from the machine\n"
"# walk = auto               # how sync finds changes: git (status + diff since the last pass), full (walk the tree), auto (git above 20000 files)\n"
"\n"
"[projection]\n"
"# base    = \"main\"          # branch the projection folds onto; default [hierarchy] main, else main\n"
"# stale   = \"24h\"           # a branch without a live agent stays active this long after its last index\n"
"# exclude = []              # branch-name globs never folded in\n"
"# index   = false           # check the projection out and index it as branch codify/projection\n"
"# steer   = true            # steer the agents on both branches when a build finds a new conflict\n"
"# auto    = true            # hooks, watch, serve and the supervisor start a background build when work happens\n"
"# min_interval = \"15s\"     # an automatic build waits this long after the last one\n"
"\n"
"[fleet]\n"
"# discover = true           # fleet status/tree, serve and watch --fleet run hyperfide fleet discover first (once per 10s)\n"
"\n"
"[hooks]\n"
"# shell_advice = true       # hyperfide hook pre-bash points a shell grep/find at hyperfide grep and hyperfide files\n";

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

int config_parse_workers(const char *v) {
    if (!v) return -1;
    while (isspace((unsigned char)*v)) v++;
    if (!strcasecmp(v, "auto")) return 0;
    if (!isdigit((unsigned char)*v)) return -1;   /* no sign, no blank */
    char *end = NULL;
    errno = 0;
    long n = strtol(v, &end, 10);
    while (end && isspace((unsigned char)*end)) end++;
    if (errno || !end || *end || n > CG_MAX_WORKERS) return -1;
    return (int)n;
}

/* [index] walk (codify-v15 1.3): auto, git, or full; -1 for anything else */
int config_parse_walk(const char *v) {
    if (!v) return -1;
    while (isspace((unsigned char)*v)) v++;
    if (!strcasecmp(v, "auto")) return CG_WALK_AUTO;
    if (!strcasecmp(v, "git"))  return CG_WALK_GIT;
    if (!strcasecmp(v, "full")) return CG_WALK_FULL;
    return -1;
}

static const char *walk_name(int w) {
    return w == CG_WALK_GIT ? "git" : w == CG_WALK_FULL ? "full" : "auto";
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

/* The default a key takes in this tree. New canonical configuration gets
 * canonical context; a legacy-only or file-less repository keeps .codify. */
static const char *cfg_dflt(const CgConfig *c, int i) {
    struct stat st;
    size_t n = strlen(c->file), m = strlen("/hyperfide.kvx");
    if (i == CFG_PATH_CONTEXT && n > m &&
        !strcmp(c->file + n - m, "/hyperfide.kvx") && stat(c->file, &st) == 0)
        return ".hyperfide/context";
    return CFG_KEYS[i].dflt;
}

static void cfg_defaults(CgConfig *c, const char *root) {
    memset(c, 0, sizeof *c);
    snprintf(c->root, sizeof c->root, "%s", root);
    config_selected_path(root,c->file,sizeof c->file);
    c->sync_auto = true;
    c->fleet_discover = true;                  /* codify-v15 2.4 */
    c->proj_steer = true;              /* codify-v15 3.2 */
    c->shell_advice = true;
    snprintf(c->proj_stale_s, sizeof c->proj_stale_s, "24h");
    c->proj_stale = 86400;
    /* codify-v15 3.3 */
    c->proj_auto = true;
    snprintf(c->proj_min_interval_s, sizeof c->proj_min_interval_s, "15s");
    c->proj_min_interval = 15;
    for (int i = 0; i < CFG_NKEYS; i++) {
        char *s = cfg_slot(c, i);
        if (s) snprintf(s, sizeof c->spec, "%s", cfg_dflt(c, i));
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
        if (CFG_KEYS[i].type == CFG_ENUM) {
            int w = config_parse_walk(v);
            if (w < 0)
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s is not auto, git, or full — "
                          "using %s", c->file, x->section, x->key, x->raw,
                          CFG_KEYS[i].dflt);
            else {
                c->index_walk = w;
                c->from_file[i] = true;
            }
        } else if (CFG_KEYS[i].type == CFG_INT) {
            int n = config_parse_workers(v);
            if (n < 0)
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s is not a worker count from 1 to "
                          "%d — using %s (the machine's choice)", c->file,
                          x->section, x->key, x->raw, CG_MAX_WORKERS,
                          CFG_KEYS[i].dflt);
            else {
                c->index_workers = n;
                c->from_file[i] = true;
            }
        } else if (CFG_KEYS[i].type == CFG_BOOL) {
            int b = cfg_parse_bool(v);
            if (b < 0)
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s is not true or false — using "
                          "the default %s", c->file, x->section, x->key,
                          x->raw, CFG_KEYS[i].dflt);
            else {
                if (i == CFG_PROJ_INDEX) c->proj_index = b == 1;
                else if (i == CFG_FLEET_DISCOVER) c->fleet_discover = b == 1;
                else if (i == CFG_PROJ_STEER) c->proj_steer = b == 1;
                else if (i == CFG_HOOKS_SHELL_ADVICE) c->shell_advice = b == 1;
                else if (i == CFG_PROJ_AUTO) c->proj_auto = b == 1;  /* 3.3 */
                else c->sync_auto = b == 1;
                c->from_file[i] = true;
            }
        } else if (CFG_KEYS[i].type == CFG_STR) {
            if (!v || !v[0] || strpbrk(v, " \t"))
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s is not a branch name — using "
                          "the default", c->file, x->section, x->key, x->raw);
            else {
                snprintf(c->proj_base, sizeof c->proj_base, "%s", v);
                c->from_file[i] = true;
            }
        } else if (CFG_KEYS[i].type == CFG_DUR) {
            long d = hier_duration(v);
            if (d < 0)
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s is not a duration (90s, 30m, 24h, "
                          "2d) — using the default %s", c->file, x->section,
                          x->key, x->raw, CFG_KEYS[i].dflt);
            else if (i == CFG_PROJ_MIN_INTERVAL) {     /* codify-v15 3.3 */
                snprintf(c->proj_min_interval_s,
                         sizeof c->proj_min_interval_s, "%s", v);
                c->proj_min_interval = d;
                c->from_file[i] = true;
            } else {
                snprintf(c->proj_stale_s, sizeof c->proj_stale_s, "%s", v);
                c->proj_stale = d;
                c->from_file[i] = true;
            }
        } else if (CFG_KEYS[i].type == CFG_LIST) {
            char **items = NULL;
            int n = kvx_list(k, x->section, x->key, &items);
            size_t used = 0;
            c->proj_exclude[0] = 0;
            for (int j = 0; j < n; j++) {
                used += (size_t)snprintf(c->proj_exclude + used,
                    used < sizeof c->proj_exclude
                        ? sizeof c->proj_exclude - used : 0,
                    "%s%s", used ? "," : "", items[j]);
                free(items[j]);
            }
            free(items);
            c->from_file[i] = true;
        } else {
            char norm[1024];
            const char *why = cfg_path_check(v, norm, sizeof norm);
            if (why)
                cfg_issue(is, "bad_value", x->section, x->key,
                          "%s: [%s] %s = %s %s — using the default \"%s\"",
                          c->file, x->section, x->key, x->raw, why,
                          cfg_dflt(c, i));
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

/* Labels name the file that was read, not the canonical spelling: a tree
 * still on codify.kvx is told about codify.kvx (origin columns, cg check,
 * cg info, config check). */
static const char *cfg_file_name(const CgConfig *c) {
    const char *slash = strrchr(c->file, '/');
    return slash ? slash + 1 : c->file;
}
const char *config_file_name(const char *root) {
    return cfg_file_name(config_load(root));
}

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
            if (!cfg_quiet) fprintf(stderr, "hyperfide: %s\n", is.v[i].msg);
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
int config_index_workers(const char *root) {
    return config_load(root)->index_workers;
}
/* codify-v15 3.1 */
const char *config_projection_base(const char *root) {
    return config_load(root)->proj_base;
}
long config_projection_stale(const char *root) {
    return config_load(root)->proj_stale;
}
bool config_projection_index(const char *root) {
    return config_load(root)->proj_index;
}
/* codify-v15 2.4 */
bool config_fleet_discover(const char *root) {
    return config_load(root)->fleet_discover;
}
bool config_projection_steer(const char *root) {   /* codify-v15 3.2 */
    return config_load(root)->proj_steer;
}
bool config_shell_advice(const char *root) {    /* codify-v15 1.4 */
    return config_load(root)->shell_advice;
}
/* codify-v15 3.3 */
bool config_projection_auto(const char *root) {
    return config_load(root)->proj_auto;
}
long config_projection_min_interval(const char *root) {
    return config_load(root)->proj_min_interval;
}
int config_projection_exclude(const char *root, char ***out) {
    *out = NULL;
    const char *s = config_load(root)->proj_exclude;
    int n = 0;
    while (*s) {
        const char *e = strchr(s, ',');
        size_t len = e ? (size_t)(e - s) : strlen(s);
        if (len) {
            *out = xrealloc(*out, sizeof **out * (size_t)(n + 1));
            (*out)[n] = xmalloc(len + 1);
            memcpy((*out)[n], s, len);
            (*out)[n++][len] = 0;
        }
        s += len + (e ? 1 : 0);
    }
    return n;
}
int config_index_walk(const char *root) {
    return config_load(root)->index_walk;
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

/* More workers than this machine has cores is legal — the file travels to
 * bigger machines — but here it only adds contention, so cg config check
 * says so without failing. Empty when there is nothing to say. */
static void cfg_core_warning(const char *root, char *out, size_t cap) {
    out[0] = 0;
    CgConfig c;
    cfg_read(root, &c, NULL);
    if (!c.index_workers) return;
    SysInfo si;
    sysinfo_detect(&si);
    if (c.index_workers > si.cores_effective)
        snprintf(out, cap, "%s: [index] workers = %d is more than the %d "
                 "effective core(s) here — the extra workers only contend "
                 "(allowed; not an error)", c.file, c.index_workers,
                 si.cores_effective);
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
    if (i == CFG_PROJ_INDEX) return c->proj_index ? "true" : "false";
    if (i == CFG_FLEET_DISCOVER) return c->fleet_discover ? "true" : "false";
    if (i == CFG_PROJ_STEER) return c->proj_steer ? "true" : "false";
    if (i == CFG_HOOKS_SHELL_ADVICE) return c->shell_advice ? "true" : "false";
    if (i == CFG_PROJ_AUTO) return c->proj_auto ? "true" : "false";  /* 3.3 */
    if (i == CFG_PROJ_MIN_INTERVAL) return c->proj_min_interval_s;
    if (i == CFG_PROJ_BASE) return c->proj_base;
    if (i == CFG_PROJ_STALE) return c->proj_stale_s;
    if (i == CFG_PROJ_EXCLUDE) return c->proj_exclude;
    if (i == CFG_INDEX_WALK) return walk_name(c->index_walk);
    if (i == CFG_INDEX_WORKERS) {
        static char num[16];           /* cg config is one thread */
        if (!c->index_workers) return "auto";
        snprintf(num, sizeof num, "%d", c->index_workers);
        return num;
    }
    return cfg_slot((CgConfig *)c, i);
}

static void cfg_setting_json(const CgConfig *c, int i, StrBuf *b) {
    sb_puts(b, "{\"key\":");
    char dotted[300];
    snprintf(dotted, sizeof dotted, "%s.%s", CFG_KEYS[i].section,
             CFG_KEYS[i].key);
    sb_json_str(b, dotted);
    sb_puts(b, ",\"value\":");
    if (CFG_KEYS[i].type == CFG_LIST) {        /* codify-v15 3.1 */
        sb_putc(b, '[');
        const char *s = c->proj_exclude;
        bool first = true;
        while (*s) {
            const char *e = strchr(s, ',');
            size_t len = e ? (size_t)(e - s) : strlen(s);
            char item[1024];
            snprintf(item, sizeof item, "%.*s", (int)len, s);
            if (item[0]) {
                if (!first) sb_putc(b, ',');
                sb_json_str(b, item);
                first = false;
            }
            s += len + (e ? 1 : 0);
        }
        sb_putc(b, ']');
    } else
    /* a worker count is a number in JSON; auto stays the string "auto" */
    if (CFG_KEYS[i].type == CFG_BOOL ||
        (CFG_KEYS[i].type == CFG_INT && c->index_workers))
        sb_puts(b, cfg_value(c, i));
    else sb_json_str(b, cfg_value(c, i));
    sb_puts(b, ",\"default\":");
    if (CFG_KEYS[i].type == CFG_BOOL) sb_puts(b, CFG_KEYS[i].dflt);
    else if (CFG_KEYS[i].type == CFG_LIST) sb_puts(b, "[]");
    else sb_json_str(b, cfg_dflt(c, i));
    sb_printf(b, ",\"origin\":\"%s\"}",
              c->from_file[i] ? cfg_file_name(c) : "default");
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
                      c.from_file[i] ? cfg_file_name(&c) : "default");
        }
        if (is.n)
            sb_printf(&b, "%d problem(s) — `hyperfide config check` lists them\n",
                      is.n);
    }
    fputs(b.p, stdout);
    sb_free(&b);
    free(is.v);
    return 0;
}

static int cfg_init(const char *root) {
    char path[4600];
    config_selected_path(root,path,sizeof path);
    struct stat st;
    if (stat(path, &st) == 0) {
        fprintf(stderr, "hyperfide config: %s already exists — left alone (`hyperfide "
                "config set` changes one key)\n", path);
        return 1;
    }
    if (write_entire_file(path, CFG_TEMPLATE, sizeof CFG_TEMPLATE - 1) != 0) {
        fprintf(stderr, "hyperfide config: cannot write %s\n", path);
        return 1;
    }
    printf("wrote %s\n", path);
    return 0;
}

static int cfg_get(const char *root, const char *dotted, bool json) {
    int i = cfg_index_dotted(dotted);
    if (i < 0) {
        fprintf(stderr, "hyperfide config: unknown key '%s' (`hyperfide config` lists "
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
        fprintf(stderr, "hyperfide config: unknown key '%s' (`hyperfide config` lists "
                "them)\n", dotted);
        return 1;
    }
    char norm[1024];
    if (CFG_KEYS[i].type == CFG_ENUM) {
        int w = config_parse_walk(value);
        if (w < 0) {
            fprintf(stderr, "hyperfide config: %s takes auto, git, or full — not "
                    "'%s'\n", dotted, value);
            return 1;
        }
        snprintf(norm, sizeof norm, "%s", walk_name(w));
    } else if (CFG_KEYS[i].type == CFG_INT) {
        int n = config_parse_workers(value);
        if (n < 0) {
            fprintf(stderr, "hyperfide config: %s takes a worker count from 1 to "
                    "%d, or auto — not '%s'\n", dotted, CG_MAX_WORKERS,
                    value);
            return 1;
        }
        if (n) snprintf(norm, sizeof norm, "%d", n);
        else snprintf(norm, sizeof norm, "auto");
    } else if (CFG_KEYS[i].type == CFG_BOOL) {
        int b = cfg_parse_bool(value);
        if (b < 0) {
            fprintf(stderr, "hyperfide config: %s takes true or false, not '%s'\n",
                    dotted, value);
            return 1;
        }
        snprintf(norm, sizeof norm, "%s", b ? "true" : "false");
    } else if (CFG_KEYS[i].type == CFG_STR) {     /* codify-v15 3.1 */
        if (!value[0] || strpbrk(value, " \t")) {
            fprintf(stderr, "hyperfide config: %s takes a branch name, not '%s'\n",
                    dotted, value);
            return 1;
        }
        snprintf(norm, sizeof norm, "%s", value);
    } else if (CFG_KEYS[i].type == CFG_DUR) {
        if (hier_duration(value) < 0) {
            fprintf(stderr, "hyperfide config: %s takes a duration (90s, 30m, 24h, "
                    "2d), not '%s'\n", dotted, value);
            return 1;
        }
        snprintf(norm, sizeof norm, "%s", value);
    } else if (CFG_KEYS[i].type == CFG_LIST) {
        /* "a,b" is written as the list ["a", "b"] */
        StrBuf l; sb_init(&l);
        sb_putc(&l, '[');
        char tmp[1024];
        snprintf(tmp, sizeof tmp, "%s", value);
        char *save = NULL;
        int n = 0;
        for (char *t = strtok_r(tmp, ",", &save); t;
             t = strtok_r(NULL, ",", &save)) {
            while (*t == ' ') t++;
            if (!*t) continue;
            if (n++) sb_puts(&l, ", ");
            sb_json_str(&l, t);
        }
        sb_putc(&l, ']');
        snprintf(norm, sizeof norm, "%s", l.p);
        sb_free(&l);
    } else {
        const char *why = cfg_path_check(value, norm, sizeof norm);
        if (why) {
            fprintf(stderr, "hyperfide config: %s = \"%s\" %s — nothing written\n",
                    dotted, value, why);
            return 1;
        }
    }
    char path[4600];
    config_selected_path(root,path,sizeof path);
    struct stat st;
    if (stat(path, &st) != 0) {
        /* an absent file is created under the canonical name */
        static const char head[] = "# " CG_CONFIG_FILE " — project "
                                   "configuration for Hyperfide. Every key "
                                   "is optional.\n";
        if (write_entire_file(path, head, sizeof head - 1) != 0) {
            fprintf(stderr, "hyperfide config: cannot write %s\n", path);
            return 1;
        }
    }
    /* a count is written bare (workers = 8); auto is quoted like a path */
    bool raw = CFG_KEYS[i].type == CFG_BOOL || CFG_KEYS[i].type == CFG_LIST ||
               (CFG_KEYS[i].type == CFG_INT && strcmp(norm, "auto"));
    int rc = raw
           ? kvx_set_raw(path, CFG_KEYS[i].section, CFG_KEYS[i].key, norm)
           : kvx_set_string(path, CFG_KEYS[i].section, CFG_KEYS[i].key, norm);
    if (rc != 0) {
        fprintf(stderr, "hyperfide config: cannot write %s\n", path);
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
        char warn[4800];
        cfg_core_warning(root, warn, sizeof warn);
        if (json) {
            /* the object config_check built, with a warnings list spliced
             * in before its closing brace */
            if (j.len && j.p[j.len - 1] == '}') j.p[--j.len] = 0;
            sb_puts(&j, ",\"warnings\":[");
            if (warn[0]) sb_json_str(&j, warn);
            sb_puts(&j, "]}");
            printf("%s\n", j.p);
        } else if (n) {
            fputs(t.p, stdout);
            if (warn[0]) printf("warning: %s\n", warn);
        } else if (warn[0]) {
            printf("warning: %s\n", warn);
        } else if (config_load(root)->present)
            printf("%s/%s: ok\n", root, config_file_name(root));
        else
            printf("%s/%s: absent — every setting is the default\n", root,
                   config_file_name(root));
        sb_free(&t); sb_free(&j);
        return n ? 1 : 0;
    }
    fprintf(stderr, "usage: hyperfide config [init | get <section.key> | "
            "set <section.key> <value> | check] [--json]\n");
    return 1;
}
