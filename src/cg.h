/*
 * Codify — agent-native code graph + content-addressed version control.
 * Single shared header. C11, POSIX. Linux-first (inotify); watcher has a
 * platform layer with stubs for FSEvents / ReadDirectoryChangesW.
 */
#ifndef CG_H
#define CG_H

#define _GNU_SOURCE
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <stdbool.h>
#include <stdarg.h>
#include <sqlite3.h>

#define CG_DIR      ".codegraph"
#define CG_DB       ".codegraph/graph.db"
#define CG_OBJECTS  ".codegraph/objects"
#define CG_HEAD     ".codegraph/HEAD"
#define CG_IGNORE   ".cgignore"
#define CG_VERSION  "0.2.0"

/* ---------------- sysinfo: adapt to the machine ---------------- */
typedef struct {
    int    cores_online;      /* raw online CPUs */
    int    cores_affinity;    /* sched_getaffinity mask size */
    double cores_quota;       /* cgroup cpu quota (cores), -1 if none */
    int    cores_effective;   /* min of the above, >=1 */
    long   mem_total_kb;      /* MemTotal */
    long   mem_avail_kb;      /* honest available: MemAvailable ∩ cgroup */
    long   cg_mem_limit_kb;   /* cgroup memory limit, -1 if none */
    int    workers;           /* sized worker pool */
    int    db_cache_kb;       /* sqlite page cache budget */
    long   mmap_bytes;        /* sqlite mmap budget */
    const char *profile;      /* "workstation" | "constrained" | "minimal" */
} SysInfo;

void sysinfo_detect(SysInfo *si);

/* ---------------- small utils ---------------- */
typedef struct { char *p; size_t len, cap; } StrBuf;
void  sb_init(StrBuf *b);
void  sb_free(StrBuf *b);
void  sb_putc(StrBuf *b, char c);
void  sb_puts(StrBuf *b, const char *s);
void  sb_printf(StrBuf *b, const char *fmt, ...);
void  sb_json_str(StrBuf *b, const char *s);   /* emits "escaped" incl quotes */

void *xmalloc(size_t n);
void *xrealloc(void *p, size_t n);
char *xstrdup(const char *s);
char *read_entire_file(const char *path, size_t *out_len); /* NUL-terminated */
int   write_entire_file(const char *path, const void *data, size_t len);
int   mkdirs(const char *path);                 /* mkdir -p for dirs */
long  now_ms(void);
bool  looks_binary(const char *data, size_t len);
const char *path_ext(const char *path);

/* ---------------- sha256 ---------------- */
void sha256_hex(const void *data, size_t len, char out_hex[65]);

/* ---------------- ignore rules ---------------- */
typedef struct {
    char **pats; int n, cap;
} Ignore;
void ignore_load(Ignore *ig, const char *root);  /* defaults + .cgignore */
bool ignore_match(const Ignore *ig, const char *rel, bool is_dir);
void ignore_free(Ignore *ig);

/* ---------------- language layer ---------------- */
#define MAX_DEFS_PER_LINE 4

typedef struct {
    char *name;        /* symbol name (owned) */
    const char *kind;  /* static string: function/class/... */
    int line;
    char *sig;         /* trimmed definition line (owned) */
} SymDef;

typedef struct {
    char *name;        /* callee-ish identifier (owned) */
    int line;
} SymRef;

typedef struct {
    const char *framework;
    char *method;      /* GET/POST/... or "*" (owned) */
    char *pattern;     /* url pattern (owned) */
    char *handler;     /* best-effort handler name (owned), may be NULL */
    int line;
} RouteDef;

typedef struct {
    SymDef  *defs;   int ndefs,  cdefs;
    SymRef  *refs;   int nrefs,  crefs;
    RouteDef*routes; int nroutes,croutes;
    int nlines;
} ParseResult;

const char *lang_for_path(const char *path);       /* NULL if not source */
void lang_parse(const char *lang, const char *path, const char *src,
                size_t len, ParseResult *pr);
void parse_result_free(ParseResult *pr);
void lang_global_init(void);                        /* compile all regexes once */

/* routes (framework-aware) — used by lang.c during parse */
void routes_global_init(void);
void routes_scan_file(const char *path, ParseResult *pr);
void routes_scan_line(const char *lang, const char *path, int lineno,
                      const char *orig_line, ParseResult *pr);
void route_add(ParseResult *pr, const char *framework, const char *method,
               const char *pattern, const char *handler, int line);

/* ---------------- database ---------------- */
typedef struct {
    sqlite3 *db;
    char root[4096];       /* project root (dir containing .codegraph) */
} Cg;

int  cg_open(Cg *cg, bool create);                 /* finds root upward */
void cg_close(Cg *cg);
int  cg_find_root(char *out, size_t cap);          /* 0 ok */
sqlite3_stmt *cg_prep(Cg *cg, const char *sql);
void cg_exec(Cg *cg, const char *sql);
void cg_meta_set(Cg *cg, const char *k, const char *v);
char *cg_meta_get(Cg *cg, const char *k);          /* malloc'd or NULL */

/* ---------------- scan / index ---------------- */
typedef struct {
    long files_seen, files_indexed, files_removed, files_skipped;
    long symbols, refs, routes, bytes;
    long ms;
} IndexStats;

int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet);

/* ---------------- graph queries ---------------- */
int cmd_search (Cg *cg, const char *q, int limit, bool json);
int cmd_symbol (Cg *cg, const char *name, bool json);
int cmd_impact (Cg *cg, const char *name, int depth, bool json);
int cmd_context(Cg *cg, const char *q, bool json);
int cmd_routes (Cg *cg, const char *filter, bool json);

/* ---------------- vcs ---------------- */
int cmd_commit  (Cg *cg, const char *msg, bool quiet);
int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,
                            const char *spec_tag, bool amend);
int cmd_log     (Cg *cg, int limit, bool json);
int cmd_status  (Cg *cg, bool json);
int cmd_diff    (Cg *cg, const char *a, const char *b);
int cmd_checkout(Cg *cg, const char *id, bool force);
int cmd_changes (Cg *cg, bool json);   /* impact radius of uncommitted edits */

/* history probes for `cg spec trace` / graph-verified task completion */
/* commits whose message contains needle; fills malloc'd arrays, returns n */
int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,
                     long **dates);
/* unique repo-relative paths changed in worktree-vs-HEAD, plus by commits
 * whose message contains needle (needle may be NULL); returns count */
int vcs_changed_paths(Cg *cg, const char *needle, char ***out);

/* ---------------- agent memory (memories table in graph.db) ---------- */
typedef struct {
    long id, created;                    /* created = unix seconds */
    char *type, *task, *body, *symbols, *files, *source;  /* task.. nullable */
} Memory;

/* insert one memory; returns its id, -1 on failure */
long memory_add(Cg *cg, const char *type, const char *task, const char *body,
                const char *symbols, const char *files, const char *source);
/* query: free text matched via FTS (NULL = recency only); task/type exact
 * filters (NULL = any); fills a malloc'd array, returns count */
int  memory_query(Cg *cg, const char *query, const char *task,
                  const char *type, int limit, Memory **out);
void memory_clear(Memory *m);            /* free one entry's fields */
void memory_free(Memory *v, int n);
void memory_json(const Memory *m, StrBuf *b);
void memory_print_brief(const Memory *m, const char *indent);
/* open the enclosing .codegraph without reindexing; false when absent */
bool memory_open_quiet(Cg *g);
int  cmd_remember(Cg *cg, const char *text, const char *type, const char *task,
                  const char *symbols, const char *files, bool json);
int  cmd_recall(Cg *cg, const char *query, const char *task, const char *type,
                int limit, bool json);
int  cmd_forget(Cg *cg, const char *idstr);

/* ---------------- watcher ---------------- */
int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms);

/* ---------------- minimal JSON reading (for MCP + package.json) ------- */
char *json_get_string(const char *obj, const char *key);  /* malloc, unescaped */
long  json_get_int(const char *obj, const char *key, long dflt);
char *json_get_raw(const char *obj, const char *key);     /* raw token, malloc */
char *json_get_object(const char *obj, const char *key);  /* balanced {...}   */
int   json_object_keys(const char *obj, char **keys, int cap); /* malloc'd each */

/* run fn with stdout captured into *out (malloc'd); returns fn's rc */
int cg_capture(char **out, int (*fn)(void *), void *ctx);

/* ---------------- kvx: Ion spec format ---------------- */
typedef struct { char *section, *key, *raw; } KvxEntry;
typedef struct {
    KvxEntry *v; int n, cap;
    char **secs; int nsec, csec;
    char *path;
} Kvx;

Kvx  *kvx_parse(const char *path);                /* NULL on open/parse error */
void  kvx_free(Kvx *k);
bool  kvx_has(const Kvx *k, const char *sec);
const char *kvx_raw(const Kvx *k, const char *sec, const char *key);
char *kvx_str(const Kvx *k, const char *sec, const char *key); /* malloc; NULL absent */
long  kvx_long(const Kvx *k, const char *sec, const char *key, long dflt);
bool  kvx_bool(const Kvx *k, const char *sec, const char *key, bool dflt);
int   kvx_list(const Kvx *k, const char *sec, const char *key, char ***out);
int   kvx_keys(const Kvx *k, const char *sec, const char ***out); /* borrowed */
int   kvx_subsections(const Kvx *k, const char *prefix, char ***out); /* file order */
void  kvx_sort_dotted(char **ids, int n);
/* surgically rewrite `status = "..."` inside [section]; preserves all else */
int   kvx_set_status(const char *path, const char *section, const char *value);
/* surgically set a quoted scalar, adding the key/section when absent */
int   kvx_set_string(const char *path, const char *section, const char *key,
                     const char *value);

int cmd_spec(int argc, char **argv, bool json);
/* in_progress task of the cwd's spec repo as "feature/id" (malloc'd), or
 * NULL when there is no spec repo / no active task — never prints */
char *spec_active_tag(void);
/* requested in_progress task as "feature/id"; NULL when invalid/not active */
char *spec_task_tag(const char *requested);

/* ---------------- agentic layer ---------------- */
int cmd_mcp(Cg *cg, const SysInfo *si);            /* stdio MCP server */
int cmd_mcp_install(Cg *cg);                       /* wire into agent configs */
int cmd_changelog(Cg *cg, int limit, const char *outfile);
int cmd_agentmd(Cg *cg, bool write_files);         /* AGENTS.md + CLAUDE.md */

#endif
