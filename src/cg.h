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
#define CG_VERSION  "0.7.0"

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
/* agent identity: flag > $CG_AGENT > "agent"; never NULL, not malloc'd */
const char *cg_agent_name(const char *flag);

/* ---------------- sha256 ---------------- */
void sha256_hex(const void *data, size_t len, char out_hex[65]);
/* sha256 of the raw bytes of lines [from..to], 1-based inclusive — the
 * drift identity behind comments.anchored_hash. Index time and query time
 * must compute it identically, so both go through here. */
void hash_lines(const char *data, size_t len, int from, int to,
                char out_hex[65]);

/* ---------------- ignore rules ---------------- */
typedef struct {
    char *pat;
    bool negate;       /* `!rule` — re-includes a previously ignored path */
    bool dir_only;     /* `rule/` — matches directories only */
    bool anchored;     /* rule holds a `/` — matched against the full rel path */
} IgnorePat;

typedef struct {
    IgnorePat *pats; int n, cap;
} Ignore;
/* defaults + .gitignore + .cgignore, in that precedence order */
void ignore_load(Ignore *ig, const char *root);
bool ignore_match(const Ignore *ig, const char *rel, bool is_dir);
void ignore_free(Ignore *ig);

/* ---------------- language layer ---------------- */
#define MAX_DEFS_PER_LINE 4

typedef struct {
    char *name;        /* symbol name (owned) */
    const char *kind;  /* static string: function/class/... */
    int line;
    char *sig;         /* trimmed definition line (owned) */
    int end_line;      /* real scope end (brace/indent tracked); 0 = unresolved */
} SymDef;

typedef struct {
    char *name;        /* callee-ish identifier (owned) */
    int line;
    char qual[64];     /* immediate receiver of a.b( / a->b( / A::b(; "" none */
    char ref_kind;     /* 'c' = call */
    int argc;          /* argument count at call site; -1 = uncountable */
} SymRef;

typedef struct {
    char *name;        /* imported name, "*" = whole module (owned) */
    char *module;      /* module/path as written (owned) */
    int line;
    bool system;       /* true for <header.h> system includes */
} ImportDef;

typedef struct {
    const char *framework;
    char *method;      /* GET/POST/... or "*" (owned) */
    char *pattern;     /* url pattern (owned) */
    char *handler;     /* best-effort handler name (owned), may be NULL */
    int line;
} RouteDef;

/* One captured comment span — the raw material of the intent layer.
 * lang.c lexes and coalesces; scan.c classifies and binds it to a symbol,
 * exactly as it does for refs. `pure` is false for a comment trailing code
 * on the same line, which never coalesces into a doc block. */
typedef struct {
    char *body;        /* span text, lines joined with '\n' (owned) */
    int line, end_line;
    bool pure;         /* the span's lines carry no code */
    bool below;        /* documents the def ABOVE it — a python docstring */
} CmtDef;

typedef struct {
    SymDef  *defs;   int ndefs,  cdefs;
    SymRef  *refs;   int nrefs,  crefs;
    RouteDef*routes; int nroutes,croutes;
    int nlines;
    ImportDef *imports; int nimports, cimports;
    CmtDef  *cmts;   int ncmts,  ccmts;
    int first_code_line;   /* 1-based; 0 = the file is all comment or empty */
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
    bool no_soft;          /* --no-soft: exclude prose-derived soft edges */
} Cg;

int  cg_open(Cg *cg, bool create);                 /* finds root upward */
void cg_close(Cg *cg);
int  cg_find_root(char *out, size_t cap);          /* 0 ok */
/* resolve from an explicit directory (LSP/MCP roots, hooks) */
int  cg_find_root_at(const char *start, char *out, size_t cap);
/* true when dir owns its subtree (.git, go.mod, package.json, ...) */
bool cg_is_boundary(const char *dir);
int  cmd_root(bool json);                          /* print the bound root */
sqlite3_stmt *cg_prep(Cg *cg, const char *sql);
void cg_exec(Cg *cg, const char *sql);
void cg_meta_set(Cg *cg, const char *k, const char *v);
char *cg_meta_get(Cg *cg, const char *k);          /* malloc'd or NULL */
/* schema_version migration: drop+recreate derived tables so the next sync
 * rebuilds them; memories/history/leases always survive. 0 ok */
int  cg_schema_upgrade(Cg *cg);

/* ---------------- scan / index ---------------- */
typedef struct {
    long files_seen, files_indexed, files_removed, files_skipped;
    long symbols, refs, routes, anchors, soft, bytes;
    long ms;
} IndexStats;

int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet);

/* import resolution and ref resolution (resolve.c) — runs post-scan */
void resolve_imports(Cg *cg);
void resolve_refs(Cg *cg);

/* grounding findings (resolve.c) — query-time, never stored */
typedef struct {
    char path[512];
    int line;
    char name[128];
    char kind[16];      /* "call" or "import" */
    char near[128];     /* near-miss suggestion, "" if none */
    char detail[256];   /* human-readable explanation */
} GroundFinding;

int ground_findings(Cg *cg, const char *path, GroundFinding **out);
void ground_findings_free(GroundFinding *v, int n);
bool file_calibrated(Cg *cg, long file_id, const char *lang);

/* contract findings: arity and kind checks */
typedef struct {
    char path[512];
    int line;
    char name[128];
    char kind[32];      /* "arity" or "kind-mismatch" or "dead-handler" */
    char detail[256];
} ContractFinding;

int contract_findings(Cg *cg, const char *path, ContractFinding **out);
void contract_findings_free(ContractFinding *v, int n);

/* hygiene findings: unused symbols and imports, delta by default */
typedef struct {
    char path[512];
    int line;
    char name[128];
    char kind[16];      /* "unused-sym" or "unused-import" */
    char detail[256];
} HygieneFinding;

int hygiene_findings(Cg *cg, const char *path, HygieneFinding **out);
int hygiene_findings_all(Cg *cg, HygieneFinding **out, int limit);
void hygiene_findings_free(HygieneFinding *v, int n);
bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,
                   const char *path);

/* ---------------- graph queries ---------------- */
int cmd_search (Cg *cg, const char *q, int limit, bool json);
int cmd_symbol (Cg *cg, const char *name, bool json);
int cmd_impact (Cg *cg, const char *name, int depth, int budget, bool json);
int cmd_context(Cg *cg, const char *q, int budget, int limit, bool json);
/* the tier below bodies: purpose lines and docs, wide and cheap */
int cmd_survey(Cg *cg, const char *scope, int budget, bool json);
/* anchor health: stale docs plus the coordination-ranked backfill list */
int cmd_anchors(Cg *cg, bool stale_only, bool unc_only, bool json);
int cmd_routes (Cg *cg, const char *filter, bool json);
int cmd_show   (Cg *cg, const char *name, bool full, bool json); /* one body */
int cmd_test_impact(Cg *cg, const char *name, bool json);
int cmd_why    (Cg *cg, const char *name, bool json);   /* provenance join */
bool graph_path_is_test(const char *path);
/* name of the symbol enclosing path:line; 0 ok, -1 when nothing encloses it */
int  graph_symbol_at(Cg *cg, const char *path, int line, char *name, size_t cap);

/* ---------------- vcs ---------------- */
int cmd_commit  (Cg *cg, const char *msg, bool quiet);
int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,
                            const char *spec_tag, bool amend);
int cmd_log     (Cg *cg, int limit, bool json);
int cmd_status  (Cg *cg, bool json);
int cmd_state   (Cg *cg, bool json);              /* Git/snapshot/spec/live */
int cmd_event(Cg *cg, int argc, char **argv, bool json);
int runtime_event_ingest(Cg *cg, const char *source, const char *payload,
                         bool json);
void runtime_workspace_revision(Cg *cg, char out[65]);
int runtime_progress(Cg *cg, bool json);
int cmd_diff    (Cg *cg, const char *a, const char *b);
int cmd_checkout(Cg *cg, const char *id, bool force);
int cmd_changes (Cg *cg, int limit, bool json); /* impact of uncommitted edits */

/* history probes for `cg spec trace` / graph-verified task completion */
/* commits whose message contains needle; fills malloc'd arrays, returns n */
int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,
                     long **dates);
/* unique repo-relative paths changed in worktree-vs-HEAD, plus by commits
 * whose message contains needle (needle may be NULL); returns count */
int vcs_changed_paths(Cg *cg, const char *needle, char ***out);
/* commits whose snapshot changed <path>, newest first — provenance for why */
int vcs_commits_for_path(Cg *cg, const char *path, int limit, char ***ids,
                         char ***msgs, long **dates);

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
int  memory_supersede(Cg *cg, long old_id, long new_id);
int  cmd_recall_near(Cg *cg, const char *path, int limit, bool json);
int  cmd_memory_compact(Cg *cg, bool dry_run, bool json);

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
/* same, but writes the literal (a list such as ["a", "b"]) unquoted */
int   kvx_set_raw(const char *path, const char *section, const char *key,
                  const char *raw);

int cmd_spec(int argc, char **argv, bool json);
typedef struct {
    char attempt_id[65];
    char task[700];
    char agent[256];
    long fence;
    long heartbeat;
    long expires;
} SpecAttempt;
/* in_progress task of the cwd's spec repo as "feature/id" (malloc'd), or
 * NULL when there is no spec repo / no active task — never prints */
char *spec_active_tag(void);
/* requested in_progress task as "feature/id"; NULL when invalid/not active */
char *spec_task_tag(const char *requested);
/* touches globs of the in-progress task; 0 when none (everything in scope) */
int   spec_active_touches(char ***out);
/* can these two touch patterns cover a common path? glob-vs-glob aware */
bool  spec_globs_overlap(const char *a, const char *b);
/* resolve "id" or "feature/id" (or, when NULL, the calling agent's current
 * task) to a malloc'd "feature/id"; NULL when nothing matches */
char *spec_resolve_task(const char *requested, const char *agent);
/* json task packet for a resolved "feature/id" (malloc'd); NULL if unknown */
char *spec_task_packet(const char *requested);
/* task-scoped memories for a resolved "feature/id"; count (<=5), malloc'd */
int   spec_task_memories_tag(const char *requested, Memory **out);

/* ---------------- language server (lsp.c) ---------------- */
int  cmd_lsp(Cg *cg, const SysInfo *si);
void lsp_hover(Cg *cg, const char *name, StrBuf *md);
void lsp_diagnostics(Cg *cg, const char *abs, StrBuf *out);
bool lsp_path_in_task_scope(Cg *cg, const char *rel);

/* ---------------- governance (govern.c) ---------------- */
/* Walk every baselined doc anchor; report each stale one through cb (which
 * may be NULL when only the count matters). Returns the stale count. Stale is
 * derived, never stored: the baseline in comments.anchored_hash no longer
 * matches the bound symbol's current body bytes. */
int anchor_stale(Cg *cg,
                 void (*cb)(void *u, const char *path, int line,
                            const char *sym, int sym_line),
                 void *u);

int cmd_check(Cg *cg, bool json, bool strict);   /* the single CI gate */
int cmd_brief(Cg *cg, bool json);                /* session state in one call */
int cmd_guard(Cg *cg, int npath, char **pathv, bool json, bool strict);
int cmd_review(Cg *cg, bool json);
int cmd_hook_install(Cg *cg);
int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility);
int integrate_plan(Cg *cg, bool json);
int integrate_apply(Cg *cg, bool json);
int integrate_doctor(Cg *cg, bool json);
int integrate_apply_portable(Cg *cg, bool quiet);
/* structured session handoff stored as a superseding task memory */
int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,
                const char *blocked, const char *note, bool json);
/* task packet + latest handoff + task memories + tree/lease state */
int cmd_resume(Cg *cg, const char *task, bool json, bool prompt);

/* ---------------- orchestrator (orchestrate.c) ---------------- */
/* `cg spec run` — claim conflict-free tasks and drive one agent per slot;
 * argv is everything after `run` */
int cmd_spec_run(int argc, char **argv);
/* build one driver command line: codex/claude take extra_args split on
 * whitespace (the prompt file arrives on stdin); custom renders cmd_tmpl
 * with ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT} substituted and runs it via
 * /bin/sh -c. av receives malloc'd entries plus a NULL terminator; returns
 * argc, or -1 for an unknown driver / custom without a template. */
int orch_driver_argv(const char *driver, const char *extra_args,
                     const char *cmd_tmpl, const char *root,
                     const char *promptfile, const char *task,
                     const char *agent, char **av, int cap);

/* ---------------- git interop (gitint.c) ---------------- */
bool git_available(const Cg *cg);
int  cmd_git_sync(Cg *cg, int limit, bool json);
int  git_churn_for_path(Cg *cg, const char *path);
int  git_commit_mirror(Cg *cg, const char *message);

/* ---------------- agentic layer ---------------- */
int cmd_mcp(Cg *cg, const SysInfo *si);            /* stdio MCP server */
int cmd_mcp_install(Cg *cg);                       /* wire into agent configs */
int cmd_changelog(Cg *cg, int limit, const char *outfile);
int cmd_agentmd(Cg *cg, bool write_files);         /* AGENTS.md + CLAUDE.md */

#endif
