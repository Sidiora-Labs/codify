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
#define CG_VERSION  "0.9.0"
#define CG_MCP_VERSION "2025-11-25"
#define CG_AGENT_CONTEXT ".codify/agent-context.md"
#define CG_DOC_TASK "@docs"
#define CG_DOCS_DIR ".codegraph/docs"

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
void  sb_shquote(StrBuf *b, const char *s);    /* 'single-quoted' for sh -c */
/* resolve a program name through PATH (or check a path); false when absent */
bool  cg_find_exe(const char *name, char *out, size_t cap);

void *xmalloc(size_t n);
void *xrealloc(void *p, size_t n);
char *xstrdup(const char *s);
char *read_entire_file(const char *path, size_t *out_len); /* NUL-terminated */
int   write_entire_file(const char *path, const void *data, size_t len);
int   mkdirs(const char *path);                 /* mkdir -p for dirs */
bool path_format(char *out, size_t cap, const char *fmt, ...)
    __attribute__((format(printf, 3, 4))); /* false and empty on overflow */
long  now_ms(void);
bool  looks_binary(const char *data, size_t len);
const char *path_ext(const char *path);
/* agent identity: flag > $CG_AGENT > "agent"; never NULL, not malloc'd */
const char *cg_agent_name(const char *flag);
/* fleet identity: flag > $CG_ROLE / $CG_PARENT; NULL when unset */
const char *cg_agent_role(const char *flag);
const char *cg_agent_parent(const char *flag);

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
    /* The tree cg operates on: files are read, walked, and git-queried
     * here, and spec/ is read from here because it travels with the branch.
     * Equals shared unless this is a linked git worktree of an initialized
     * repository. */
    char root[4096];
    /* Where .codegraph lives: the database, object store, index gate, and
     * docs packets. One per repository, shared by every worktree of it. */
    char shared[4096];
    bool worktree;         /* root != shared: a linked worktree joined in */
    /* The branch root is on, resolved at open time from git's HEAD (no
     * process spawned) and registered in branches. Every file row the
     * indexer writes from this tree carries branch_id; "(detached)" and
     * "(none)" stand in when there is no branch name. 0 only when the
     * registry could not be written (database busy). */
    long branch_id;
    char branch[256];
    char head[65];         /* commit HEAD points at, "" when unknown */
    bool no_soft;          /* --no-soft: exclude prose-derived soft edges */
    /* How long a write may wait for another cg process to release the
     * database before giving up. CLI commands wait the full default so an
     * agent's `cg spec done` survives an editor re-index; long-running
     * servers (lsp, watch) set a short wait and defer their own index
     * instead, because they must never hold agents up. */
    long lock_wait_ms;
} Cg;

/* Exit status when the database stayed busy past lock_wait_ms. Distinct from
 * the generic 2 so an orchestrator can retry instead of treating the task as
 * broken; 75 is EX_TEMPFAIL from sysexits. */
#define CG_EXIT_BUSY 75

int  cg_open(Cg *cg, bool create);                 /* finds root upward */
/* Take the write lock (BEGIN IMMEDIATE), waiting up to cg->lock_wait_ms.
 * Returns 0 holding the lock, -1 when the database stayed busy — without
 * exiting, so a server can defer. Any other SQL failure still exits. */
int  cg_begin_write(Cg *cg);
long cg_lock_wait_default(void);                   /* CG_BUSY_TIMEOUT_MS */
/* The message a person or agent should see when a write gave up on a busy
 * database: names the likely holder and says nothing was changed. */
void cg_busy_report(const char *what);
void cg_close(Cg *cg);
/* The shared project directory (the one holding .codegraph) for the
 * current directory: the nearest ancestor, or — from a linked git worktree
 * whose main worktree is initialized — that main worktree. 0 ok */
int  cg_find_root(char *out, size_t cap);
/* resolve from an explicit directory (LSP/MCP roots, hooks) */
int  cg_find_root_at(const char *start, char *out, size_t cap);
/* Both halves: the tree to operate on and the shared project. They differ
 * only for a linked worktree that joined an initialized repository. */
int  cg_find_project_at(const char *start, char *root, char *shared,
                        size_t cap);
/* meta key scoped to the open branch ("last_index_at:3"): freshness and
 * file counts describe one branch's rows, not the whole database */
void cg_bkey(const Cg *cg, const char *name, char *out, size_t cap);
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
    /* the database stayed busy past lock_wait_ms; the graph is whatever the
     * last index left (any chunks written before the stall are kept) */
    bool busy;
    /* the walk was skipped: the last pass is younger than the caller's
     * freshness window and nothing is pending or marked dirty */
    bool fresh;
    /* another process held the index gate; this caller left a dirty note
     * for it instead of walking, and returned without indexing */
    bool coalesced;
    int  workers;          /* parse threads the pass actually used */
    int  passes;           /* walks run, including dirty-marker drains */
    bool scoped;           /* resolution ran over the change scope only */
} IndexStats;

/* How a caller wants its index pass run. Zero-initialised means: walk now,
 * wait cg->lock_wait_ms for the gate, full machine budget, foreground. */
typedef struct {
    bool full;             /* reparse every file (cg index --full) */
    /* skip the walk when meta.last_index_at is younger than this and no
     * resolve is pending and no dirty note exists; 0 = always walk */
    long max_age_ms;
    /* how long to wait for another process's index pass to finish before
     * coalescing into it: 0 = never, -1 = cg->lock_wait_ms */
    long lock_wait_ms;
    int  workers_cap;      /* 0 = sysinfo's choice */
    bool background;       /* hook/watch/editor: renice, quarter of the cores */
    bool quiet;
    /* targeted sync: only these root-relative paths (files or dirs) are
     * stat'd, parsed, or removed; a targeted pass never claims the whole
     * tree is fresh */
    const char *const *paths;
    int npaths;
} IndexOpts;

/* Returns 0, or -1 with st->busy set when another process held the write
 * lock for the whole wait. Never exits on a busy database. A coalesced or
 * fresh pass returns 0 with the matching flag set and no files indexed. */
int cg_index_ex(Cg *cg, const SysInfo *si, const IndexOpts *o, IndexStats *st);
/* Blocking full-strength wrapper: waits for the gate, always walks. */
int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet);

/* syncgate.c — the single-writer index gate and machine-wide parse slots */
int  syncgate_acquire(const Cg *cg, long wait_ms);     /* fd or -1 */
void syncgate_release(int fd);
void syncgate_mark_dirty(const Cg *cg, const char *const *paths, int npaths);
bool syncgate_is_dirty(const Cg *cg);
char *syncgate_take_dirty(const Cg *cg);               /* malloc'd or NULL */
int  syncgate_slot_count(const SysInfo *si);
int  syncgate_slot_acquire(const SysInfo *si);         /* fd or -1 */
void syncgate_slot_release(int fd);
int  syncgate_worker_budget(const SysInfo *si, const IndexOpts *o, int jobs,
                            int *slot_fd);
void syncgate_background_nice(void);

/* import resolution and ref resolution (resolve.c) — runs post-scan */
void resolve_imports(Cg *cg);
void resolve_refs(Cg *cg);
/* Incremental variants: only rows the change scope reaches — imports and
 * refs in changed files, refs anywhere naming a symbol the change added or
 * removed, unresolved imports a new file could satisfy. Valid between
 * index_scope_begin and index_scope_end on the same connection. */
void resolve_imports_scoped(Cg *cg);
void resolve_refs_scoped(Cg *cg);
/* change scope (scan.c): temp tables scope_files(id,added) and
 * scope_names(name) that the write phase fills */
void index_scope_begin(Cg *cg);
void index_scope_end(Cg *cg);
/* true when the scope is small next to the graph, so the scoped passes
 * beat rebuilding everything */
bool index_scope_bounded(Cg *cg);

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
char *graph_task_focus(Cg *cg, const char *task_packet); /* malloc'd query */
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
typedef struct {
    char classification[40], reason[256], action[40], next_action[40];
    int no_evidence_events, repeated_failures, signal_events, stage;
    long latest_event_id, age_seconds;
    bool activity, stalled, waiting, enforced, patch_oscillation;
} RuntimeProgress;
int runtime_classify_progress(Cg *cg, const char *attempt,
                              const char *session, RuntimeProgress *out);
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
    /* Jev's verdict from `cg memory classify`: skill|fact|decision|
     * constraint|noise, NULL until the memory has been classified, with the
     * confidence it was given. Advice, never a gate. */
    char *cls;
    double confidence;
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
/* the raw items of a JSON array (malloc'd each, and the vector); 0 when
 * arr is not an array */
int   json_array_items(const char *arr, char ***out);

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
/* Record where a task's live attempt is being worked: its branch, the
 * worktree holding it, and the manager it reports to. 0 when a running
 * attempt for tag ("feature/id") was updated, 1 when there was none. */
int spec_attempt_set_branch(Cg *g, const char *tag, const char *branch,
                            const char *worktree, const char *parent);
typedef struct {
    char attempt_id[65];
    char task[700];
    char agent[256];
    long fence;
    long heartbeat;
    long expires;
} SpecAttempt;
/* Claim task <id> of <feature> (NULL: the active one) in the spec repo at
 * <root>, on an open graph, exactly as `cg spec claim` would: same
 * eligibility, ownership, and touch-conflict refusals, printed to stderr.
 * 0 with *out filled, 1 refused. */
int spec_claim(Cg *g, const char *root, const char *feature, const char *id,
               const char *agent, long ttl_min, SpecAttempt *out);
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
int cmd_hook_post_edit(Cg *cg, const SysInfo *si, bool json);
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
int cmd_work(Cg *cg, int argc, char **argv, bool json);
int work_open(Cg *cg, const char *task, bool json);
int work_update(Cg *cg, const char *revision, bool json);
int work_close(Cg *cg, const char *task, int nevidence, char **evidence,
               bool json);

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
/* ---------------- fleet: hierarchy, identity, reports (fleet.c) -------- */
enum { FLEET_MAIN = 0, FLEET_FEATURE = 1, FLEET_WORKER = 2, FLEET_ROLES = 3 };
typedef struct {
    char *name;        /* main | feature | worker */
    char *title;       /* what the role is called in reports and prompts */
    char *agent;       /* agent-name template: {feature}, {wave} */
    char *branch;      /* branch template: {main}, {feature}, {wave} */
    char *base;        /* branch the role's branch is cut from and merges into */
} FleetRole;
typedef struct {
    bool configured;   /* [hierarchy] present in spec/workflow.kvx */
    bool enabled;      /* configured and not switched off */
    char *main_branch; /* the main role's local integration branch */
    char *remote;      /* where pull requests go */
    char *worktrees;   /* root for per-branch worktrees, relative to the repo */
    char *test_gate;   /* shell command that must exit 0 before a PR opens */
    char *lint_gate;   /* same; "" means no lint gate is configured */
    char *pr;          /* auto: open on green; manual: print the commands */
    char *checkpoint;  /* manual | auto: when open PRs merge */
    FleetRole roles[FLEET_ROLES];
    char *unknown[8];  /* [role.X] names that are none of the three */
    int nunknown;
} Hierarchy;
bool hier_load(const Kvx *wf, Hierarchy *h);   /* defaults, then overrides */
void hier_free(Hierarchy *h);
void hier_expand(const Hierarchy *h, const char *tmpl, const char *feature,
                 long wave, char *out, size_t cap);
int  fleet_identity_record(Cg *g);           /* no-op without CG_ROLE */
void fleet_brief(Cg *cg, StrBuf *b, bool json);
/* The branch lifecycle (fleet.c). Every step is a git operation the
 * hierarchy already names: a worker's wave branch and worktree, its merge
 * into the feature branch, the feature's landing on local main behind the
 * gates, the pull request, and the checkpoint that merges what is open.
 * feature NULL means the workflow's active feature. All return the exit
 * code to print. */
int  fleet_worker_begin(Cg *cg, const char *id, const char *feature,
                        const char *agent_flag, bool json);
int  fleet_merge_up(Cg *cg, const char *id, const char *feature, bool force,
                    bool keep, bool json);
int  fleet_feature_land(Cg *cg, const char *feature, bool no_pr, bool json);
int  fleet_pr_open(Cg *cg, const char *feature, bool dry_run, bool json);
int  fleet_checkpoint(Cg *cg, bool dry_run, bool json);
int  cmd_fleet(Cg *cg, int argc, char **argv, bool json);

/* The two-level fleet run (orchestrate.c). One node is one process
 * `cg spec run --fleet` spawned: the identity it carries in its
 * environment, and the branch and worktree it works in. */
typedef struct {
    char agent[128];      /* CG_AGENT */
    char role[16];        /* CG_ROLE: "feature" | "worker" */
    char parent[128];     /* CG_PARENT */
    char feature[128];    /* CG_FEATURE */
    long wave;            /* CG_WAVE; -1 for a feature manager */
    char task[64];        /* the task a worker holds; "" for a manager */
    char branch[256];     /* CG_BRANCH */
    char base[256];       /* CG_BASE */
    char worktree[4096];  /* the tree the child runs in */
    char attempt[65];     /* the claim a worker carries; "" for a manager */
    long fence;
    int  pid;             /* -1 when nothing was forked (dry run) */
} FleetNode;
/* Spawn one feature manager for <feature>: its worktree on the feature
 * branch (cut from main when new), a briefing built from the feature plan,
 * and the driver exec'd there. 0 with *n filled, 1 when nothing ran. */
int orch_spawn_manager(Cg *cg, const char *feature, const char *driver,
                       const char *extra, const char *cmd_tmpl, bool dry_run,
                       FleetNode *n);
/* Spawn one wave worker for task <id>: the branch, worktree, and claim come
 * from `cg fleet begin` (fleet_worker_begin), the prompt from resume. */
int orch_spawn_worker(Cg *cg, const char *feature, const char *id,
                      const char *driver, const char *extra,
                      const char *cmd_tmpl, bool dry_run, FleetNode *n);
/* The tree main → feature managers → wave workers, with branches, attempts,
 * heartbeats, and what the subtree still owes. feature NULL: the active one. */
int orch_tree_status(Cg *cg, const char *feature, bool json);

/* ---------------- jev: System One decisions (jev.c) ----------------
 * Jev is TypeSafe AI's decision model, reached through OpenRouter with
 * OPENROUTER_API_KEY. It answers a fixed set of typed questions about a
 * state: noul (probability a statement is true), choice (one of up to 255
 * labelled options), score (an ordinal level). It never generates text and
 * its answers are advice — verify_cmd and the graph checks stay the
 * authority. The key is mandatory for every feature built on it: a missing
 * key is an error, not a silent fallback. */
enum { JEV_NOUL, JEV_CHOICE, JEV_SCORE };
enum { JEV_OK = 0, JEV_ECONFIG = 1, JEV_EREQUEST = 2, JEV_EPARSE = 3 };
typedef struct {
    char *name, *instructions;
    int type;
    char **keys;     /* choice: option keys; noul: "true"/"false"; score: NULL */
    char **descs;    /* option or criterion text; score: the levels in order */
    int n;
} JevQuestion;
typedef struct {
    char *name;
    int type;
    double value;         /* noul: probability true; score: the score */
    char *choice;         /* choice: the selected option key */
    double confidence;    /* noul: distance from undecided */
    char *probabilities;  /* raw JSON object, NULL when absent */
    char *legend;         /* score: raw JSON object level -> text */
} JevAnswer;
typedef struct {
    char *model, *requested_model, *id;
    long input_tokens, output_tokens;
    double cost;
    int status, attempts;
    long ms;
    JevAnswer *answers; int n;
    char error[640];      /* set when jev_ask returns non-zero */
} JevResult;
/* Build one question; -1 when the cardinality is invalid (choice needs 2
 * to 255 options, score at least 2 levels). when_true/when_false may be
 * NULL. Strings are copied. */
int  jev_question_noul(JevQuestion *q, const char *name,
                       const char *instructions, const char *when_true,
                       const char *when_false);
int  jev_question_choice(JevQuestion *q, const char *name,
                         const char *instructions, const char *const *keys,
                         const char *const *descs, int n);
int  jev_question_score(JevQuestion *q, const char *name,
                        const char *instructions, const char *const *levels,
                        int n);
void jev_question_free(JevQuestion *q);
/* The canonical request body: sorted question names and criteria keys,
 * compact, state verbatim. */
void jev_request_json(const char *model, const char *state_json,
                      const JevQuestion *qs, int nq, StrBuf *out);
/* Ask Jev. Returns JEV_OK with answers, or JEV_E* with out->error filled
 * (key or curl missing; the request failed after retries on 429 and 529;
 * the response could not be read). Every call is logged to
 * <shared>/.codegraph/jev.log; cg may be NULL (no project, no log). */
int  jev_ask(Cg *cg, const char *state_json, const JevQuestion *qs, int nq,
             JevResult *out);
/* Same, with a complete {"model","questions","state"} body; a missing
 * model is filled in from the configuration. */
int  jev_ask_raw(Cg *cg, const char *body, JevResult *out);
const JevAnswer *jev_answer(const JevResult *r, const char *name);
void jev_result_free(JevResult *r);
int  cmd_jev(Cg *cg, int argc, char **argv, bool json);

/* Advisory Jev: the decisions that ride inside a deterministic command.
 * Jev is mandatory for these features and never for the loop they live in
 * — `cg spec done`, `cg guard`, and `cg fleet pr` reach their own verdict
 * with or without an answer. One gate decides: without OPENROUTER_API_KEY
 * (or when the call fails) each helper prints one warning naming what was
 * skipped, leaves its output neutral, and returns non-zero. */
bool jev_advisory_ready(const char *what);
typedef struct {
    char category[64];     /* test_failure, build_error, flaky, ... */
    char action[64];       /* fix_code, fix_test, rerun, ask_human, ... */
    double category_confidence, action_confidence;  /* -1 when unstated */
    char line[240];        /* both, formatted for a human */
} JevTriage;
/* Classify a failed command: only the tail of output (40 lines / 4 KB) is
 * sent, since that is where a failure says what it was. */
int  jev_triage_failure(Cg *cg, const char *output, JevTriage *out);
typedef struct {
    char kind[24];         /* grounding | contract | hygiene */
    char path[512];
    int  line;
    char detail[256];
    double score;          /* Jev severity; -1 when it was not ranked */
    char level[64];        /* the legend text for that score, "" if none */
} JevFinding;
/* Rank findings most severe first, in one call (one score question each),
 * stably, so an unranked run keeps the order it was collected in. */
int  jev_rank_findings(Cg *cg, JevFinding *v, int n);
typedef struct {
    double value;          /* probability the feature is ready to merge */
    char band[16];         /* low | medium | high */
} JevReadiness;
int  jev_pr_readiness(Cg *cg, const char *state_json, JevReadiness *out);

/* ---------------- skills: classified memory -> SKILL.md (skills.c) ----
 * A memory is a note; a skill is a note worth carrying into other tasks.
 * `cg memory classify` asks Jev which is which and writes the verdict on
 * the row; `cg skills promote` renders a candidate as a portable
 * .agents/skills/<slug>/SKILL.md carrying Codify's ownership marker and the
 * id of the memory it came from. Promotion is recorded by that generated
 * file, not by the class column: the column stays Jev's opinion. */
/* Report a failed Jev call on stderr as "cg: <what>: <error>" and return 1,
 * so every Jev-backed command fails the same way. Defined in jev.c. */
int  jev_report_error(const JevResult *r, const char *what);
/* One memory by id; false when there is no such row. Fields are owned by
 * the caller (memory_clear). */
bool memory_get(Cg *cg, long id, Memory *out);
/* Classify memories with Jev and store class + confidence. sel is NULL or
 * "--unclassified" (rows with no class yet), "--all", or a memory id. */
int  cmd_memory_classify(Cg *cg, const char *sel, int limit, bool json);
/* Render one memory as .agents/skills/<slug>/SKILL.md; path_out receives the
 * repo-relative path. 0 wrote it, 1 already identical, 2 the file exists and
 * is not Codify's, -1 the write failed. */
int  skill_render(Cg *cg, const Memory *m, char *path_out, size_t cap);
/* Generated skills that no longer agree with the memories they came from:
 * one malloc'd sentence each (the vector is malloc'd too). */
int  skill_findings(Cg *cg, char ***out);
int  cmd_skills(Cg *cg, int argc, char **argv, bool json);

bool git_available(const Cg *cg);
/* Where tree's HEAD points, read from the git files themselves so opening
 * the graph never spawns a process. branch gets the short ref name, or
 * "(detached)"; sha gets the commit when it could be found, else "".
 * false when tree is not a git worktree. */
bool git_head(const char *tree, char *branch, size_t bcap, char *sha,
              size_t scap);
/* For a linked worktree (tree/.git is a file), the main worktree it
 * belongs to: the directory holding the common .git. false otherwise. */
bool git_worktree_main(const char *tree, char *main_out, size_t cap);
/* Resolve cg->root's branch into cg (name, head, branch_id), registering a
 * branch never seen before. 0 ok; -1 when the registry could not be
 * written, leaving branch_id 0. */
int  cg_branch_resolve(Cg *cg);
/* Upsert one branch row; base NULL keeps the stored base. Returns its id,
 * or -1 when the write failed. */
long branch_register(Cg *cg, const char *name, const char *worktree,
                     const char *head, const char *base);
int  cmd_branches(Cg *cg, int argc, char **argv, bool json);
/* Run `git -C <tree> <args>` (args already shell-quoted), stdout and
 * stderr appended to out (may be NULL). Returns the exit status, -1 when
 * git could not be started. */
int  git_run(const char *tree, const char *args, StrBuf *out);
bool git_branch_exists(const char *tree, const char *branch);
/* Make sure <path> is a worktree of <tree> on <branch>: reuse it when it is
 * there, else add it, creating the branch from <base> when it does not
 * exist yet. *created says whether the worktree was added; *branch_created
 * whether the branch was. Returns 0, or -1 with git's words in err. */
int  git_worktree_add(const char *tree, const char *path, const char *branch,
                      const char *base, bool *created, bool *branch_created,
                      StrBuf *err);
/* paths still conflicted in tree's index (malloc'd each); returns count */
int  git_conflicted_paths(const char *tree, char ***out);
int  cmd_git_sync(Cg *cg, int limit, bool json);
int  git_churn_for_path(Cg *cg, const char *path);
int  git_commit_mirror(Cg *cg, const char *message);

/* ---------------- agentic layer ---------------- */
int cmd_mcp(Cg *cg, const SysInfo *si);            /* stdio MCP server */
int cmd_mcp_install(Cg *cg);                       /* wire into agent configs */
int cmd_changelog(Cg *cg, int limit, const char *outfile);
int cmd_agentmd(Cg *cg, bool write_files);         /* graph agent context */
int cmd_docs(Cg *cg, int argc, char **argv, bool json); /* documentation closure */
int spec_docs_finish(Cg *cg, const char *feature); /* internal checked closure */

#endif
