# Source reference: C core: CLI and help

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the command dispatcher (`src/main.c`), the help text (`src/help.c`), the shared header (`src/cg.h`) and the utility, JSON, SHA-256 and machine-detection helpers (`src/util.c`, `src/json.c`, `src/sha256.c`, `src/sysinfo.c`): 651 declarations in 7 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`. Commands are written as `hyperfide`; the same executable is also installed as `cg`, a deprecated compatibility alias with identical arguments, JSON and exit codes, whose wording is defined in [src/hyperfide/branding.c](../../src/hyperfide/branding.c).

## src/cg.h

[Open source](../../src/cg.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_H` | macro | 7 | <code>#define CG_H</code> |
| `_GNU_SOURCE` | macro | 9 | <code>#define _GNU_SOURCE</code> |
| `CG_DIR` | macro | 19 | <code>#define CG_DIR      ".codegraph"</code> |
| `CG_DB` | macro | 20 | <code>#define CG_DB       ".codegraph/graph.db"</code> |
| `CG_OBJECTS` | macro | 21 | <code>#define CG_OBJECTS  ".codegraph/objects"</code> |
| `CG_HEAD` | macro | 22 | <code>#define CG_HEAD     ".codegraph/HEAD"</code> |
| `CG_IGNORE` | macro | 23 | <code>#define CG_IGNORE   ".cgignore"</code> |
| `HYPERFIDE_VERSION` | macro | 25 | <code>#define HYPERFIDE_VERSION "2.0.0-dev"</code> |
| `CG_VERSION` | macro | 27 | <code>#define CG_VERSION HYPERFIDE_VERSION</code> |
| `HYPERFIDE_PRODUCT` | macro | 28 | <code>#define HYPERFIDE_PRODUCT "Hyperfide"</code> |
| `CG_MCP_VERSION` | macro | 29 | <code>#define CG_MCP_VERSION "2025-11-25"</code> |
| `CG_AGENT_CONTEXT` | macro | 30 | <code>#define CG_AGENT_CONTEXT ".codify/agent-context.md"</code> |
| `CG_DOC_TASK` | macro | 31 | <code>#define CG_DOC_TASK "@docs"</code> |
| `CG_DOCS_DIR` | macro | 32 | <code>#define CG_DOCS_DIR ".codegraph/docs"</code> |
| `SysInfo` | typedef | 35 | <code>typedef struct {</code> |
| `sysinfo_detect` | function | 49 | <code>void sysinfo_detect(SysInfo &#42;si);</code> |
| `CG_MAX_WORKERS` | macro | 53 | <code>#define CG_MAX_WORKERS 64</code> |
| `StrBuf` | typedef | 56 | <code>typedef struct { char &#42;p; size_t len, cap; } StrBuf;</code> |
| `sb_init` | function | 57 | <code>void  sb_init(StrBuf &#42;b);</code> |
| `sb_free` | function | 58 | <code>void  sb_free(StrBuf &#42;b);</code> |
| `sb_putc` | function | 59 | <code>void  sb_putc(StrBuf &#42;b, char c);</code> |
| `sb_puts` | function | 60 | <code>void  sb_puts(StrBuf &#42;b, const char &#42;s);</code> |
| `sb_printf` | function | 61 | <code>void  sb_printf(StrBuf &#42;b, const char &#42;fmt, ...);</code> |
| `sb_json_str` | function | 62 | <code>void  sb_json_str(StrBuf &#42;b, const char &#42;s);   /&#42; emits "escaped" incl quotes &#42;/</code> |
| `sb_shquote` | function | 63 | <code>void  sb_shquote(StrBuf &#42;b, const char &#42;s);    /&#42; 'single-quoted' for sh -c &#42;/</code> |
| `cg_find_exe` | function | 65 | <code>bool  cg_find_exe(const char &#42;name, char &#42;out, size_t cap);</code> |
| `xmalloc` | function | 67 | <code>void &#42;xmalloc(size_t n);</code> |
| `xrealloc` | function | 68 | <code>void &#42;xrealloc(void &#42;p, size_t n);</code> |
| `xstrdup` | function | 69 | <code>char &#42;xstrdup(const char &#42;s);</code> |
| `read_entire_file` | function | 70 | <code>char &#42;read_entire_file(const char &#42;path, size_t &#42;out_len); /&#42; NUL-terminated &#42;/</code> |
| `write_entire_file` | function | 71 | <code>int   write_entire_file(const char &#42;path, const void &#42;data, size_t len);</code> |
| `mkdirs` | function | 72 | <code>int   mkdirs(const char &#42;path);                 /&#42; mkdir -p for dirs &#42;/</code> |
| `path_format` | function | 73 | <code>bool path_format(char &#42;out, size_t cap, const char &#42;fmt, ...)</code> |
| `now_ms` | function | 75 | <code>long  now_ms(void);</code> |
| `looks_binary` | function | 76 | <code>bool  looks_binary(const char &#42;data, size_t len);</code> |
| `path_ext` | function | 77 | <code>const char &#42;path_ext(const char &#42;path);</code> |
| `cg_agent_name` | function | 79 | <code>const char &#42;cg_agent_name(const char &#42;flag);</code> |
| `cg_agent_role` | function | 81 | <code>const char &#42;cg_agent_role(const char &#42;flag);</code> |
| `cg_agent_parent` | function | 82 | <code>const char &#42;cg_agent_parent(const char &#42;flag);</code> |
| `sha256_hex` | function | 85 | <code>void sha256_hex(const void &#42;data, size_t len, char out_hex&#91;65&#93;);</code> |
| `hash_lines` | function | 91 | <code>void hash_lines(const char &#42;data, size_t len, int from, int to,</code> |
| `name_words` | function | 97 | <code>void name_words(const char &#42;name, char &#42;out, size_t cap);</code> |
| `IgnorePat` | typedef | 100 | <code>typedef struct {</code> |
| `Ignore` | typedef | 107 | <code>typedef struct {</code> |
| `ignore_load` | function | 111 | <code>void ignore_load(Ignore &#42;ig, const char &#42;root);</code> |
| `ignore_match` | function | 112 | <code>bool ignore_match(const Ignore &#42;ig, const char &#42;rel, bool is_dir);</code> |
| `ignore_free` | function | 113 | <code>void ignore_free(Ignore &#42;ig);</code> |
| `MAX_DEFS_PER_LINE` | macro | 116 | <code>#define MAX_DEFS_PER_LINE 4</code> |
| `SymDef` | typedef | 118 | <code>typedef struct {</code> |
| `SymRef` | typedef | 127 | <code>typedef struct {</code> |
| `ImportDef` | typedef | 138 | <code>typedef struct {</code> |
| `RouteDef` | typedef | 145 | <code>typedef struct {</code> |
| `CmtDef` | typedef | 157 | <code>typedef struct {</code> |
| `ParseResult` | typedef | 164 | <code>typedef struct {</code> |
| `lang_for_path` | function | 181 | <code>const char &#42;lang_for_path(const char &#42;path);       /&#42; NULL if not source &#42;/</code> |
| `lang_parse` | function | 182 | <code>void lang_parse(const char &#42;lang, const char &#42;path, const char &#42;src,</code> |
| `parse_result_free` | function | 184 | <code>void parse_result_free(ParseResult &#42;pr);</code> |
| `lang_global_init` | function | 185 | <code>void lang_global_init(void);                        /&#42; compile all regexes once &#42;/</code> |
| `routes_global_init` | function | 188 | <code>void routes_global_init(void);</code> |
| `routes_scan_file` | function | 189 | <code>void routes_scan_file(const char &#42;path, ParseResult &#42;pr);</code> |
| `routes_scan_line` | function | 190 | <code>void routes_scan_line(const char &#42;lang, const char &#42;path, int lineno,</code> |
| `route_add` | function | 192 | <code>void route_add(ParseResult &#42;pr, const char &#42;framework, const char &#42;method,</code> |
| `Cg` | struct | 196 | <code>typedef struct Cg {</code> |
| `CG_EXIT_BUSY` | macro | 234 | <code>#define CG_EXIT_BUSY 75</code> |
| `cg_open` | function | 236 | <code>int  cg_open(Cg &#42;cg, bool create);                 /&#42; finds root upward &#42;/</code> |
| `cg_begin_write` | function | 240 | <code>int  cg_begin_write(Cg &#42;cg);</code> |
| `cg_lock_wait_default` | function | 241 | <code>long cg_lock_wait_default(void);                   /&#42; CG_BUSY_TIMEOUT_MS &#42;/</code> |
| `cg_busy_report` | function | 244 | <code>void cg_busy_report(const char &#42;what);</code> |
| `cg_close` | function | 245 | <code>void cg_close(Cg &#42;cg);</code> |
| `cg_find_root` | function | 249 | <code>int  cg_find_root(char &#42;out, size_t cap);</code> |
| `cg_find_root_at` | function | 251 | <code>int  cg_find_root_at(const char &#42;start, char &#42;out, size_t cap);</code> |
| `cg_find_project_at` | function | 256 | <code>int  cg_find_project_at(const char &#42;start, char &#42;root, char &#42;shared,</code> |
| `cg_bkey` | function | 260 | <code>void cg_bkey(const Cg &#42;cg, const char &#42;name, char &#42;out, size_t cap);</code> |
| `cg_is_boundary` | function | 262 | <code>bool cg_is_boundary(const char &#42;dir);</code> |
| `cmd_root` | function | 263 | <code>int  cmd_root(bool json);                          /&#42; print the bound root &#42;/</code> |
| `cg_prep` | function | 264 | <code>sqlite3_stmt &#42;cg_prep(Cg &#42;cg, const char &#42;sql);</code> |
| `cg_exec` | function | 265 | <code>void cg_exec(Cg &#42;cg, const char &#42;sql);</code> |
| `cg_meta_set` | function | 266 | <code>void cg_meta_set(Cg &#42;cg, const char &#42;k, const char &#42;v);</code> |
| `cg_meta_get` | function | 267 | <code>char &#42;cg_meta_get(Cg &#42;cg, const char &#42;k);          /&#42; malloc'd or NULL &#42;/</code> |
| `cg_schema_upgrade` | function | 270 | <code>int  cg_schema_upgrade(Cg &#42;cg);</code> |
| `CG_CONFIG_FILE` | macro | 278 | <code>#define CG_CONFIG_FILE "hyperfide.kvx"</code> |
| `CG_LEGACY_CONFIG_FILE` | macro | 279 | <code>#define CG_LEGACY_CONFIG_FILE "codify.kvx"</code> |
| `config_file_name` | function | 282 | <code>const char &#42;config_file_name(const char &#42;root);</code> |
| `hyperfide_environment_aliases` | function | 283 | <code>int hyperfide_environment_aliases(void);</code> |
| `CgConfig` | typedef | 296 | <code>typedef struct {</code> |
| `config_load` | function | 321 | <code>const CgConfig &#42;config_load(const char &#42;root);</code> |
| `config_auto_sync` | function | 322 | <code>bool config_auto_sync(const char &#42;root);</code> |
| `config_spec_rel` | function | 323 | <code>const char &#42;config_spec_rel(const char &#42;root);     /&#42; "spec" &#42;/</code> |
| `config_context_rel` | function | 324 | <code>const char &#42;config_context_rel(const char &#42;root);  /&#42; ".codify" &#42;/</code> |
| `config_skills_rel` | function | 325 | <code>const char &#42;config_skills_rel(const char &#42;root);   /&#42; ".agents/skills" &#42;/</code> |
| `config_codemap_rel` | function | 326 | <code>const char &#42;config_codemap_rel(const char &#42;root);  /&#42; "CODEMAP.md" &#42;/</code> |
| `config_index_workers` | function | 328 | <code>int  config_index_workers(const char &#42;root);</code> |
| `config_parse_workers` | function | 331 | <code>int  config_parse_workers(const char &#42;v);</code> |
| `config_spec_dir` | function | 333 | <code>bool config_spec_dir(const char &#42;root, char &#42;out, size_t cap);</code> |
| `config_workflow_path` | function | 334 | <code>bool config_workflow_path(const char &#42;root, char &#42;out, size_t cap);</code> |
| `config_feature_path` | function | 335 | <code>bool config_feature_path(const char &#42;root, const char &#42;feature, char &#42;out,</code> |
| `config_context_dir` | function | 337 | <code>bool config_context_dir(const char &#42;root, char &#42;out, size_t cap);</code> |
| `config_context_path` | function | 338 | <code>bool config_context_path(const char &#42;root, const char &#42;name, char &#42;out,</code> |
| `config_skills_dir` | function | 340 | <code>bool config_skills_dir(const char &#42;root, char &#42;out, size_t cap);</code> |
| `config_codemap_path` | function | 341 | <code>bool config_codemap_path(const char &#42;root, char &#42;out, size_t cap);</code> |
| `config_in_spec` | function | 343 | <code>bool config_in_spec(const char &#42;root, const char &#42;rel);</code> |
| `config_find_spec_root` | function | 345 | <code>int  config_find_spec_root(const char &#42;start, char &#42;out, size_t cap);</code> |
| `config_check` | function | 349 | <code>int  config_check(const char &#42;root, StrBuf &#42;text, StrBuf &#42;json);</code> |
| `cmd_config` | function | 350 | <code>int  cmd_config(int argc, char &#42;&#42;argv, bool json);</code> |
| `IndexStats` | typedef | 353 | <code>typedef struct {</code> |
| `IndexOpts` | typedef | 384 | <code>typedef struct {</code> |
| `cg_index_ex` | function | 409 | <code>int cg_index_ex(Cg &#42;cg, const SysInfo &#42;si, const IndexOpts &#42;o, IndexStats &#42;st);</code> |
| `WalkEntry` | typedef | 415 | <code>typedef struct { char &#42;rel; long size, mtime, mtime_ns; } WalkEntry;</code> |
| `WalkSet` | typedef | 416 | <code>typedef struct { WalkEntry &#42;v; int n, cap; long dirs; } WalkSet;</code> |
| `walk_parallel` | function | 417 | <code>void walk_parallel(const char &#42;root, const char &#42;rel, const Ignore &#42;ig,</code> |
| `walkset_free` | function | 419 | <code>void walkset_free(WalkSet &#42;w);</code> |
| `walk_threads_default` | function | 420 | <code>int  walk_threads_default(int budget);     /&#42; CG_WALK_THREADS overrides &#42;/</code> |
| `walk_git_candidates` | function | 426 | <code>int  walk_git_candidates(const char &#42;root, const char &#42;since, char &#42;&#42;&#42;out,</code> |
| `index_phase_ms` | function | 429 | <code>void index_phase_ms(IndexStats &#42;st, int phase, long t0);</code> |
| `index_stats_json` | function | 431 | <code>void index_stats_json(const IndexStats &#42;st, bool targeted, StrBuf &#42;b);</code> |
| `index_peak_rss_kb` | function | 432 | <code>long index_peak_rss_kb(void);              /&#42; VmHWM, 0 when unknown &#42;/</code> |
| `db_fts_contentless` | function | 434 | <code>bool db_fts_contentless(Cg &#42;cg);</code> |
| `progress_dirs` | function | 436 | <code>void progress_dirs(long dirs);</code> |
| `config_index_walk` | function | 439 | <code>int  config_index_walk(const char &#42;root);</code> |
| `config_parse_walk` | function | 440 | <code>int  config_parse_walk(const char &#42;v);     /&#42; -1 when not auto&#124;git&#124;full &#42;/</code> |
| `CG_WALK_GIT_MIN_FILES` | macro | 441 | <code>#define CG_WALK_GIT_MIN_FILES 20000        /&#42; auto: git above this many &#42;/</code> |
| `CG_WALK_FULL_EVERY` | macro | 442 | <code>#define CG_WALK_FULL_EVERY    20           /&#42; every Nth pass walks fully &#42;/</code> |
| `cg_index` | function | 444 | <code>int cg_index(Cg &#42;cg, const SysInfo &#42;si, bool full, IndexStats &#42;st, bool quiet);</code> |
| `progress_request` | function | 448 | <code>void progress_request(bool want);   /&#42; the command a person runs asks for it &#42;/</code> |
| `progress_begin` | function | 449 | <code>void progress_begin(const IndexOpts &#42;o);</code> |
| `progress_step` | function | 450 | <code>void progress_step(const char &#42;step);   /&#42; cg init's named steps &#42;/</code> |
| `progress_phase` | function | 451 | <code>void progress_phase(const char &#42;phase, long done, long total);</code> |
| `progress_flush` | function | 452 | <code>void progress_flush(void);              /&#42; draw now: bounded points only &#42;/</code> |
| `progress_tick` | function | 453 | <code>void progress_tick(long done, long total, const char &#42;path);</code> |
| `progress_workers` | function | 454 | <code>void progress_workers(int n);</code> |
| `progress_wait` | function | 455 | <code>void progress_wait(const char &#42;what, long waited_ms);  /&#42; NULL clears &#42;/</code> |
| `progress_end` | function | 456 | <code>void progress_end(void);                /&#42; erases the line; call before output &#42;/</code> |
| `progress_begin_write` | function | 457 | <code>int  progress_begin_write(Cg &#42;cg);      /&#42; cg_begin_write, wait shown &#42;/</code> |
| `syncgate_acquire` | function | 460 | <code>int  syncgate_acquire(const Cg &#42;cg, long wait_ms);     /&#42; fd or -1 &#42;/</code> |
| `syncgate_release` | function | 461 | <code>void syncgate_release(int fd);</code> |
| `syncgate_mark_dirty` | function | 462 | <code>void syncgate_mark_dirty(const Cg &#42;cg, const char &#42;const &#42;paths, int npaths);</code> |
| `syncgate_is_dirty` | function | 463 | <code>bool syncgate_is_dirty(const Cg &#42;cg);</code> |
| `syncgate_take_dirty` | function | 464 | <code>char &#42;syncgate_take_dirty(const Cg &#42;cg);               /&#42; malloc'd or NULL &#42;/</code> |
| `syncgate_slot_count` | function | 465 | <code>int  syncgate_slot_count(const SysInfo &#42;si);</code> |
| `syncgate_slot_acquire` | function | 466 | <code>int  syncgate_slot_acquire(const SysInfo &#42;si);         /&#42; fd or -1 &#42;/</code> |
| `syncgate_slot_release` | function | 467 | <code>void syncgate_slot_release(int fd);</code> |
| `syncgate_worker_request` | function | 472 | <code>int  syncgate_worker_request(const char &#42;root, const SysInfo &#42;si, int flag,</code> |
| `syncgate_worker_budget` | function | 474 | <code>int  syncgate_worker_budget(const char &#42;root, const SysInfo &#42;si,</code> |
| `syncgate_background_nice` | function | 476 | <code>void syncgate_background_nice(void);</code> |
| `resolve_imports` | function | 479 | <code>void resolve_imports(Cg &#42;cg);</code> |
| `resolve_refs` | function | 480 | <code>void resolve_refs(Cg &#42;cg);</code> |
| `resolve_imports_scoped` | function | 485 | <code>void resolve_imports_scoped(Cg &#42;cg);</code> |
| `resolve_refs_scoped` | function | 486 | <code>void resolve_refs_scoped(Cg &#42;cg);</code> |
| `index_scope_begin` | function | 489 | <code>void index_scope_begin(Cg &#42;cg);</code> |
| `index_scope_end` | function | 490 | <code>void index_scope_end(Cg &#42;cg);</code> |
| `index_scope_bounded` | function | 493 | <code>bool index_scope_bounded(Cg &#42;cg);</code> |
| `GroundFinding` | typedef | 496 | <code>typedef struct {</code> |
| `ground_findings` | function | 505 | <code>int ground_findings(Cg &#42;cg, const char &#42;path, GroundFinding &#42;&#42;out);</code> |
| `ground_findings_free` | function | 506 | <code>void ground_findings_free(GroundFinding &#42;v, int n);</code> |
| `file_calibrated` | function | 507 | <code>bool file_calibrated(Cg &#42;cg, long file_id, const char &#42;lang);</code> |
| `ContractFinding` | typedef | 510 | <code>typedef struct {</code> |
| `contract_findings` | function | 518 | <code>int contract_findings(Cg &#42;cg, const char &#42;path, ContractFinding &#42;&#42;out);</code> |
| `contract_findings_free` | function | 519 | <code>void contract_findings_free(ContractFinding &#42;v, int n);</code> |
| `HygieneFinding` | typedef | 522 | <code>typedef struct {</code> |
| `hygiene_findings` | function | 530 | <code>int hygiene_findings(Cg &#42;cg, const char &#42;path, HygieneFinding &#42;&#42;out);</code> |
| `hygiene_findings_all` | function | 531 | <code>int hygiene_findings_all(Cg &#42;cg, HygieneFinding &#42;&#42;out, int limit);</code> |
| `hygiene_findings_free` | function | 532 | <code>void hygiene_findings_free(HygieneFinding &#42;v, int n);</code> |
| `is_entrypoint` | function | 533 | <code>bool is_entrypoint(Cg &#42;cg, long sym_id, const char &#42;name, const char &#42;kind,</code> |
| `cmd_search` | function | 537 | <code>int cmd_search (Cg &#42;cg, const char &#42;q, int limit, bool json);</code> |
| `GREP_MAX_PATHS` | macro | 541 | <code>#define GREP_MAX_PATHS 16</code> |
| `GrepOpts` | typedef | 542 | <code>typedef struct {</code> |
| `cmd_grep` | function | 553 | <code>int cmd_grep(Cg &#42;cg, const SysInfo &#42;si, const GrepOpts &#42;o, bool json);</code> |
| `t_grep` | function | 557 | <code>int t_grep(void &#42;call_ctx);</code> |
| `grep_tri_complete` | function | 561 | <code>bool grep_tri_complete(Cg &#42;cg, long &#42;have, long &#42;want);</code> |
| `cmd_symbol` | function | 562 | <code>int cmd_symbol (Cg &#42;cg, const char &#42;name, bool json);</code> |
| `cmd_impact` | function | 563 | <code>int cmd_impact (Cg &#42;cg, const char &#42;name, int depth, int budget, bool json);</code> |
| `cmd_context` | function | 564 | <code>int cmd_context(Cg &#42;cg, const char &#42;q, int budget, int limit, bool json);</code> |
| `graph_task_focus` | function | 565 | <code>char &#42;graph_task_focus(Cg &#42;cg, const char &#42;task_packet); /&#42; malloc'd query &#42;/</code> |
| `graph_symbol_brief` | function | 568 | <code>int  graph_symbol_brief(Cg &#42;cg, const char &#42;name, int snippet_lines,</code> |
| `graph_glob_symbols` | function | 571 | <code>int  graph_glob_symbols(Cg &#42;cg, const char &#42;glob, int max_files, int max_syms,</code> |
| `task_packet_build` | function | 577 | <code>int  task_packet_build(Cg &#42;cg, const char &#42;tag, int budget, StrBuf &#42;out);</code> |
| `manager_packet_build` | function | 579 | <code>int  manager_packet_build(Cg &#42;cg, const char &#42;feature, int budget, StrBuf &#42;out);</code> |
| `packet_upstream_evidence` | function | 582 | <code>int  packet_upstream_evidence(Cg &#42;cg, const char &#42;feature, const char &#42;req,</code> |
| `cmd_survey` | function | 585 | <code>int cmd_survey(Cg &#42;cg, const char &#42;scope, int budget, bool json);</code> |
| `QF_MAX_PATHS` | macro | 590 | <code>#define QF_MAX_PATHS 16</code> |
| `QueryFilter` | typedef | 591 | <code>typedef struct {</code> |
| `query_filter_parse` | function | 599 | <code>int  query_filter_parse(int &#42;argc, char &#42;&#42;argv, QueryFilter &#42;f);</code> |
| `query_filter_active` | function | 600 | <code>bool query_filter_active(const QueryFilter &#42;f);</code> |
| `query_filter_sql` | function | 604 | <code>char &#42;query_filter_sql(const QueryFilter &#42;f, const char &#42;alias);</code> |
| `query_filter_register` | function | 605 | <code>void query_filter_register(sqlite3 &#42;db);</code> |
| `query_filter_match` | function | 607 | <code>bool query_filter_match(const QueryFilter &#42;f, const char &#42;path,</code> |
| `cg_filter_set` | function | 611 | <code>void cg_filter_set(Cg &#42;cg, const QueryFilter &#42;f);</code> |
| `cg_filter_get` | function | 612 | <code>const QueryFilter &#42;cg_filter_get(const Cg &#42;cg);</code> |
| `cmd_files` | function | 614 | <code>int cmd_files(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `cmd_anchors` | function | 616 | <code>int cmd_anchors(Cg &#42;cg, bool stale_only, bool unc_only, bool json);</code> |
| `cmd_routes` | function | 617 | <code>int cmd_routes (Cg &#42;cg, const char &#42;filter, bool json);</code> |
| `cmd_show` | function | 618 | <code>int cmd_show   (Cg &#42;cg, const char &#42;name, bool full, bool json); /&#42; one body &#42;/</code> |
| `cmd_test_impact` | function | 619 | <code>int cmd_test_impact(Cg &#42;cg, const char &#42;name, bool json);</code> |
| `cmd_why` | function | 620 | <code>int cmd_why    (Cg &#42;cg, const char &#42;name, bool json);   /&#42; provenance join &#42;/</code> |
| `graph_path_is_test` | function | 621 | <code>bool graph_path_is_test(const char &#42;path);</code> |
| `graph_symbol_at` | function | 623 | <code>int  graph_symbol_at(Cg &#42;cg, const char &#42;path, int line, char &#42;name, size_t cap);</code> |
| `branch_scope_sql` | function | 632 | <code>const char &#42;branch_scope_sql(const Cg &#42;cg, const char &#42;alias, char &#42;out,</code> |
| `cg_scope_set` | function | 636 | <code>int  cg_scope_set(Cg &#42;cg, const char &#42;name, bool all);</code> |
| `branch_hit_label` | function | 640 | <code>const char &#42;branch_hit_label(Cg &#42;cg, long branch_id, char &#42;out, size_t cap);</code> |
| `branch_tree` | function | 644 | <code>const char &#42;branch_tree(Cg &#42;cg, long branch_id, char &#42;out, size_t cap);</code> |
| `cmd_commit` | function | 647 | <code>int cmd_commit  (Cg &#42;cg, const char &#42;msg, bool quiet);</code> |
| `cmd_commit_with_options` | function | 648 | <code>int cmd_commit_with_options(Cg &#42;cg, const char &#42;msg, bool quiet,</code> |
| `cmd_log` | function | 650 | <code>int cmd_log     (Cg &#42;cg, int limit, bool json);</code> |
| `cmd_status` | function | 651 | <code>int cmd_status  (Cg &#42;cg, bool json);</code> |
| `cmd_state` | function | 652 | <code>int cmd_state   (Cg &#42;cg, bool json);              /&#42; Git/snapshot/spec/live &#42;/</code> |
| `cmd_event` | function | 653 | <code>int cmd_event(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `runtime_event_ingest` | function | 654 | <code>int runtime_event_ingest(Cg &#42;cg, const char &#42;source, const char &#42;payload,</code> |
| `runtime_workspace_revision` | function | 656 | <code>void runtime_workspace_revision(Cg &#42;cg, char out&#91;65&#93;);</code> |
| `RuntimeProgress` | typedef | 657 | <code>typedef struct {</code> |
| `runtime_classify_progress` | function | 663 | <code>int runtime_classify_progress(Cg &#42;cg, const char &#42;attempt,</code> |
| `runtime_progress` | function | 665 | <code>int runtime_progress(Cg &#42;cg, bool json);</code> |
| `cmd_diff` | function | 666 | <code>int cmd_diff    (Cg &#42;cg, const char &#42;a, const char &#42;b);</code> |
| `cmd_checkout` | function | 667 | <code>int cmd_checkout(Cg &#42;cg, const char &#42;id, bool force);</code> |
| `cmd_changes` | function | 668 | <code>int cmd_changes (Cg &#42;cg, int limit, bool json); /&#42; impact of uncommitted edits &#42;/</code> |
| `vcs_find_commits` | function | 674 | <code>int vcs_find_commits(Cg &#42;cg, const char &#42;needle, char &#42;&#42;&#42;ids, char &#42;&#42;&#42;msgs,</code> |
| `vcs_changed_paths` | function | 678 | <code>int vcs_changed_paths(Cg &#42;cg, const char &#42;needle, char &#42;&#42;&#42;out);</code> |
| `vcs_commits_for_path` | function | 681 | <code>int vcs_commits_for_path(Cg &#42;cg, const char &#42;path, int limit, char &#42;&#42;&#42;ids,</code> |
| `Memory` | typedef | 685 | <code>typedef struct {</code> |
| `memory_add` | function | 699 | <code>long memory_add(Cg &#42;cg, const char &#42;type, const char &#42;task, const char &#42;body,</code> |
| `memory_query` | function | 703 | <code>int  memory_query(Cg &#42;cg, const char &#42;query, const char &#42;task,</code> |
| `memory_clear` | function | 705 | <code>void memory_clear(Memory &#42;m);            /&#42; free one entry's fields &#42;/</code> |
| `memory_free` | function | 706 | <code>void memory_free(Memory &#42;v, int n);</code> |
| `memory_json` | function | 707 | <code>void memory_json(const Memory &#42;m, StrBuf &#42;b);</code> |
| `memory_print_brief` | function | 708 | <code>void memory_print_brief(const Memory &#42;m, const char &#42;indent);</code> |
| `memory_open_quiet` | function | 710 | <code>bool memory_open_quiet(Cg &#42;g);</code> |
| `cmd_remember` | function | 711 | <code>int  cmd_remember(Cg &#42;cg, const char &#42;text, const char &#42;type, const char &#42;task,</code> |
| `cmd_recall` | function | 713 | <code>int  cmd_recall(Cg &#42;cg, const char &#42;query, const char &#42;task, const char &#42;type,</code> |
| `cmd_forget` | function | 715 | <code>int  cmd_forget(Cg &#42;cg, const char &#42;idstr);</code> |
| `memory_supersede` | function | 716 | <code>int  memory_supersede(Cg &#42;cg, long old_id, long new_id);</code> |
| `cmd_recall_near` | function | 717 | <code>int  cmd_recall_near(Cg &#42;cg, const char &#42;path, int limit, bool json);</code> |
| `cmd_memory_compact` | function | 718 | <code>int  cmd_memory_compact(Cg &#42;cg, bool dry_run, bool json);</code> |
| `memory_promote_branch` | function | 723 | <code>int  memory_promote_branch(Cg &#42;cg, const char &#42;from, const char &#42;to);</code> |
| `memory_content_id` | function | 727 | <code>void memory_content_id(const char &#42;type, const char &#42;task, const char &#42;body,</code> |
| `MemExportOpts` | typedef | 729 | <code>typedef struct {</code> |
| `MemImportOpts` | typedef | 735 | <code>typedef struct {</code> |
| `cmd_memory_export` | function | 742 | <code>int  cmd_memory_export(Cg &#42;cg, const MemExportOpts &#42;o, bool json);</code> |
| `cmd_memory_import` | function | 745 | <code>int  cmd_memory_import(Cg &#42;cg, const MemImportOpts &#42;o, bool json);</code> |
| `cmd_watch` | function | 748 | <code>int cmd_watch(Cg &#42;cg, const SysInfo &#42;si, int debounce_ms);</code> |
| `watch_fleet` | function | 753 | <code>int watch_fleet(Cg &#42;cg, const SysInfo &#42;si, int debounce_ms);</code> |
| `json_get_string` | function | 756 | <code>char &#42;json_get_string(const char &#42;obj, const char &#42;key);  /&#42; malloc, unescaped &#42;/</code> |
| `json_string_value` | function | 757 | <code>char &#42;json_string_value(const char &#42;raw);  /&#42; "&#92;"a&#92;&#92;nb&#92;"" -&gt; malloc "a&#92;nb"; NULL if not a string &#42;/</code> |
| `json_get_int` | function | 758 | <code>long  json_get_int(const char &#42;obj, const char &#42;key, long dflt);</code> |
| `json_get_raw` | function | 759 | <code>char &#42;json_get_raw(const char &#42;obj, const char &#42;key);     /&#42; raw token, malloc &#42;/</code> |
| `json_get_object` | function | 760 | <code>char &#42;json_get_object(const char &#42;obj, const char &#42;key);  /&#42; balanced {...}   &#42;/</code> |
| `json_object_keys` | function | 761 | <code>int   json_object_keys(const char &#42;obj, char &#42;&#42;keys, int cap); /&#42; malloc'd each &#42;/</code> |
| `json_array_items` | function | 764 | <code>int   json_array_items(const char &#42;arr, char &#42;&#42;&#42;out);</code> |
| `cg_capture` | function | 767 | <code>int cg_capture(char &#42;&#42;out, int (&#42;fn)(void &#42;), void &#42;ctx);</code> |
| `KvxEntry` | typedef | 770 | <code>typedef struct { char &#42;section, &#42;key, &#42;raw; } KvxEntry;</code> |
| `Kvx` | typedef | 771 | <code>typedef struct {</code> |
| `kvx_parse` | function | 777 | <code>Kvx  &#42;kvx_parse(const char &#42;path);                /&#42; NULL on open/parse error &#42;/</code> |
| `kvx_free` | function | 778 | <code>void  kvx_free(Kvx &#42;k);</code> |
| `kvx_has` | function | 779 | <code>bool  kvx_has(const Kvx &#42;k, const char &#42;sec);</code> |
| `kvx_raw` | function | 780 | <code>const char &#42;kvx_raw(const Kvx &#42;k, const char &#42;sec, const char &#42;key);</code> |
| `kvx_str` | function | 781 | <code>char &#42;kvx_str(const Kvx &#42;k, const char &#42;sec, const char &#42;key); /&#42; malloc; NULL absent &#42;/</code> |
| `kvx_long` | function | 782 | <code>long  kvx_long(const Kvx &#42;k, const char &#42;sec, const char &#42;key, long dflt);</code> |
| `kvx_bool` | function | 783 | <code>bool  kvx_bool(const Kvx &#42;k, const char &#42;sec, const char &#42;key, bool dflt);</code> |
| `kvx_list` | function | 784 | <code>int   kvx_list(const Kvx &#42;k, const char &#42;sec, const char &#42;key, char &#42;&#42;&#42;out);</code> |
| `kvx_keys` | function | 785 | <code>int   kvx_keys(const Kvx &#42;k, const char &#42;sec, const char &#42;&#42;&#42;out); /&#42; borrowed &#42;/</code> |
| `kvx_subsections` | function | 786 | <code>int   kvx_subsections(const Kvx &#42;k, const char &#42;prefix, char &#42;&#42;&#42;out); /&#42; file order &#42;/</code> |
| `kvx_sort_dotted` | function | 787 | <code>void  kvx_sort_dotted(char &#42;&#42;ids, int n);</code> |
| `kvx_set_status` | function | 789 | <code>int   kvx_set_status(const char &#42;path, const char &#42;section, const char &#42;value);</code> |
| `kvx_status_hook` | function | 794 | <code>extern void (&#42;kvx_status_hook)(const char &#42;path, const char &#42;section,</code> |
| `kvx_set_string` | function | 797 | <code>int   kvx_set_string(const char &#42;path, const char &#42;section, const char &#42;key,</code> |
| `kvx_set_raw` | function | 800 | <code>int   kvx_set_raw(const char &#42;path, const char &#42;section, const char &#42;key,</code> |
| `cmd_spec` | function | 803 | <code>int cmd_spec(int argc, char &#42;&#42;argv, bool json);</code> |
| `spec_attempt_set_branch` | function | 807 | <code>int spec_attempt_set_branch(Cg &#42;g, const char &#42;tag, const char &#42;branch,</code> |
| `SpecAttempt` | typedef | 809 | <code>typedef struct {</code> |
| `spec_claim` | function | 821 | <code>int spec_claim(Cg &#42;g, const char &#42;root, const char &#42;feature, const char &#42;id,</code> |
| `spec_active_tag` | function | 825 | <code>char &#42;spec_active_tag(void);</code> |
| `spec_task_tag` | function | 827 | <code>char &#42;spec_task_tag(const char &#42;requested);</code> |
| `spec_active_touches` | function | 829 | <code>int   spec_active_touches(char &#42;&#42;&#42;out);</code> |
| `spec_globs_overlap` | function | 831 | <code>bool  spec_globs_overlap(const char &#42;a, const char &#42;b);</code> |
| `spec_resolve_task` | function | 834 | <code>char &#42;spec_resolve_task(const char &#42;requested, const char &#42;agent);</code> |
| `spec_task_packet` | function | 836 | <code>char &#42;spec_task_packet(const char &#42;requested);</code> |
| `spec_task_memories_tag` | function | 838 | <code>int   spec_task_memories_tag(const char &#42;requested, Memory &#42;&#42;out);</code> |
| `cmd_lsp` | function | 841 | <code>int  cmd_lsp(Cg &#42;cg, const SysInfo &#42;si);</code> |
| `lsp_hover` | function | 842 | <code>void lsp_hover(Cg &#42;cg, const char &#42;name, StrBuf &#42;md);</code> |
| `lsp_diagnostics` | function | 843 | <code>void lsp_diagnostics(Cg &#42;cg, const char &#42;abs, StrBuf &#42;out);</code> |
| `lsp_path_in_task_scope` | function | 844 | <code>bool lsp_path_in_task_scope(Cg &#42;cg, const char &#42;rel);</code> |
| `anchor_stale` | function | 851 | <code>int anchor_stale(Cg &#42;cg,</code> |
| `cmd_check` | function | 856 | <code>int cmd_check(Cg &#42;cg, bool json, bool strict);   /&#42; the single CI gate &#42;/</code> |
| `cmd_brief` | function | 857 | <code>int cmd_brief(Cg &#42;cg, bool json);                /&#42; session state in one call &#42;/</code> |
| `cmd_guard` | function | 858 | <code>int cmd_guard(Cg &#42;cg, int npath, char &#42;&#42;pathv, bool json, bool strict);</code> |
| `cmd_review` | function | 859 | <code>int cmd_review(Cg &#42;cg, bool json);</code> |
| `cmd_hook_install` | function | 860 | <code>int cmd_hook_install(Cg &#42;cg);</code> |
| `cmd_hook_post_edit` | function | 861 | <code>int cmd_hook_post_edit(Cg &#42;cg, const SysInfo &#42;si, bool json);</code> |
| `cmd_hook_event` | function | 866 | <code>int  cmd_hook_event(Cg &#42;cg, const char &#42;host, bool json);   /&#42; always 0 &#42;/</code> |
| `cmd_hook_pre_bash` | function | 870 | <code>int  cmd_hook_pre_bash(Cg &#42;cg, bool json);                  /&#42; always 0 &#42;/</code> |
| `shell_advice_for` | function | 871 | <code>char &#42;shell_advice_for(const char &#42;root, const char &#42;cwd, const char &#42;cmd);</code> |
| `config_shell_advice` | function | 872 | <code>bool config_shell_advice(const char &#42;root);    /&#42; &#91;hooks&#93; shell_advice &#42;/</code> |
| `native_record` | function | 873 | <code>int  native_record(Cg &#42;cg, const char &#42;host, const char &#42;payload,</code> |
| `native_attribute_task` | function | 875 | <code>const char &#42;native_attribute_task(Cg &#42;cg, const char &#42;session,</code> |
| `native_worktree` | function | 878 | <code>bool native_worktree(Cg &#42;cg, const char &#42;cwd, char &#42;wt, size_t wcap,</code> |
| `native_tree_json` | function | 880 | <code>void native_tree_json(Cg &#42;cg, StrBuf &#42;b);           /&#42; &#91;...&#93; &#42;/</code> |
| `native_fleet_section` | function | 881 | <code>void native_fleet_section(Cg &#42;cg, StrBuf &#42;b, bool json);</code> |
| `native_fleet_tree_json` | function | 882 | <code>int  native_fleet_tree_json(Cg &#42;cg, const char &#42;feature);</code> |
| `native_counts` | function | 883 | <code>bool native_counts(Cg &#42;cg, int &#42;live, int &#42;subs, int &#42;branches);</code> |
| `native_summary` | function | 884 | <code>void native_summary(Cg &#42;cg, StrBuf &#42;b, bool json);  /&#42; brief/state line &#42;/</code> |
| `native_flags` | function | 885 | <code>void native_flags(int argc, char &#42;&#42;argv);</code> |
| `transcript_dirs` | function | 890 | <code>void transcript_dirs(const char &#42;root, char &#42;claude, size_t ccap,</code> |
| `transcript_codex_head` | function | 893 | <code>bool transcript_codex_head(const char &#42;path, char &#42;cwd, size_t ccap,</code> |
| `cmd_fleet_discover` | function | 901 | <code>int  cmd_fleet_discover(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `native_discover_auto` | function | 902 | <code>void native_discover_auto(Cg &#42;cg);</code> |
| `config_fleet_discover` | function | 903 | <code>bool config_fleet_discover(const char &#42;root);   /&#42; &#91;fleet&#93; discover &#42;/</code> |
| `cmd_integrate` | function | 904 | <code>int cmd_integrate(Cg &#42;cg, const char &#42;action, bool json, bool compatibility);</code> |
| `integrate_plan` | function | 905 | <code>int integrate_plan(Cg &#42;cg, bool json);</code> |
| `integrate_apply` | function | 906 | <code>int integrate_apply(Cg &#42;cg, bool json);</code> |
| `integrate_doctor` | function | 907 | <code>int integrate_doctor(Cg &#42;cg, bool json);</code> |
| `integrate_apply_portable` | function | 908 | <code>int integrate_apply_portable(Cg &#42;cg, bool quiet);</code> |
| `PluginState` | typedef | 912 | <code>typedef struct {</code> |
| `integrate_self` | function | 923 | <code>void integrate_self(char out&#91;4096&#93;);</code> |
| `integrate_skill_body` | function | 924 | <code>const char &#42;integrate_skill_body(void);</code> |
| `integrate_skip_plugin` | function | 925 | <code>void integrate_skip_plugin(bool skip);</code> |
| `plugin_root` | function | 926 | <code>void plugin_root(char out&#91;4700&#93;);</code> |
| `plugin_render` | function | 927 | <code>int  plugin_render(const char &#42;bin, bool json, StrBuf &#42;out, int &#42;changed,</code> |
| `plugin_install` | function | 929 | <code>int  plugin_install(bool json, StrBuf &#42;out);</code> |
| `plugin_state` | function | 930 | <code>void plugin_state(PluginState &#42;st);</code> |
| `plugin_state_json` | function | 931 | <code>void plugin_state_json(const PluginState &#42;st, StrBuf &#42;b);</code> |
| `plugin_codex_hooks_body` | function | 932 | <code>char &#42;plugin_codex_hooks_body(const char &#42;bin);</code> |
| `plugin_codex_hooks` | function | 933 | <code>int  plugin_codex_hooks(const Cg &#42;cg, const char &#42;bin, char path&#91;4700&#93;);</code> |
| `plugin_codex_state` | function | 934 | <code>const char &#42;plugin_codex_state(const Cg &#42;cg, char path&#91;4700&#93;);</code> |
| `plugin_file_state` | function | 935 | <code>const char &#42;plugin_file_state(const char &#42;path, const char &#42;mark);</code> |
| `cmd_handoff` | function | 937 | <code>int cmd_handoff(Cg &#42;cg, const char &#42;task, const char &#42;done, const char &#42;next,</code> |
| `cmd_resume` | function | 940 | <code>int cmd_resume(Cg &#42;cg, const char &#42;task, bool json, bool prompt);</code> |
| `cmd_work` | function | 941 | <code>int cmd_work(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `work_open` | function | 942 | <code>int work_open(Cg &#42;cg, const char &#42;task, bool json);</code> |
| `work_update` | function | 943 | <code>int work_update(Cg &#42;cg, const char &#42;revision, bool json);</code> |
| `work_close` | function | 944 | <code>int work_close(Cg &#42;cg, const char &#42;task, int nevidence, char &#42;&#42;evidence,</code> |
| `cmd_spec_run` | function | 950 | <code>int cmd_spec_run(int argc, char &#42;&#42;argv);</code> |
| `cmd_fleet_up` | function | 956 | <code>int  cmd_fleet_up(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `cmd_fleet_control` | function | 957 | <code>int  cmd_fleet_control(Cg &#42;cg, const char &#42;verb, int argc, char &#42;&#42;argv,</code> |
| `cmd_fleet_runs` | function | 959 | <code>int  cmd_fleet_runs(Cg &#42;cg, bool json);</code> |
| `fleet_supervisor_alive` | function | 960 | <code>bool fleet_supervisor_alive(const char &#42;shared);</code> |
| `CG_EXIT_APPROVAL` | macro | 965 | <code>#define CG_EXIT_APPROVAL 4</code> |
| `fleet_gate` | function | 966 | <code>int  fleet_gate(Cg &#42;cg, const char &#42;gate, const char &#42;subject);</code> |
| `cmd_fleet_approvals` | function | 967 | <code>int  cmd_fleet_approvals(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `DriverSpec` | typedef | 970 | <code>typedef struct {</code> |
| `driver_argv` | function | 982 | <code>int driver_argv(const DriverSpec &#42;d, const char &#42;root, const char &#42;promptfile,</code> |
| `DriverEvent` | typedef | 984 | <code>typedef struct {</code> |
| `DriverEventFn` | typedef | 992 | <code>typedef void (&#42;DriverEventFn)(const DriverEvent &#42;e, void &#42;ud);</code> |
| `driver_stream_parse` | function | 995 | <code>int driver_stream_parse(const char &#42;line, DriverEventFn fn, void &#42;ud);</code> |
| `DriverTap` | typedef | 996 | <code>typedef struct {</code> |
| `driver_tap_init` | function | 1005 | <code>void driver_tap_init(DriverTap &#42;t, const char &#42;log, const char &#42;agent,</code> |
| `driver_tap_poll` | function | 1009 | <code>int  driver_tap_poll(DriverTap &#42;t);</code> |
| `driver_tap_free` | function | 1010 | <code>void driver_tap_free(DriverTap &#42;t);</code> |
| `driver_steer` | function | 1012 | <code>long driver_steer(Cg &#42;cg, const char &#42;agent, const char &#42;message);</code> |
| `driver_steer_take` | function | 1015 | <code>char &#42;driver_steer_take(Cg &#42;cg, const char &#42;agent, const char &#42;via);</code> |
| `EventRow` | typedef | 1018 | <code>typedef struct {</code> |
| `EventFn` | typedef | 1023 | <code>typedef int (&#42;EventFn)(const EventRow &#42;e, void &#42;ud);</code> |
| `events_install` | function | 1024 | <code>int  events_install(Cg &#42;cg);         /&#42; triggers; called by cg_open &#42;/</code> |
| `events_emit` | function | 1028 | <code>long events_emit(Cg &#42;cg, const char &#42;kind, const char &#42;subject,</code> |
| `events_emit_as` | function | 1032 | <code>long events_emit_as(Cg &#42;cg, const char &#42;kind, const char &#42;subject,</code> |
| `events_emit_quiet` | function | 1034 | <code>long events_emit_quiet(const char &#42;kind, const char &#42;subject,</code> |
| `events_bind` | function | 1036 | <code>void events_bind(Cg &#42;cg);            /&#42; see events_kvx_status &#42;/</code> |
| `events_unbind` | function | 1037 | <code>void events_unbind(void);</code> |
| `events_kvx_status` | function | 1038 | <code>void events_kvx_status(const char &#42;path, const char &#42;section,</code> |
| `events_head` | function | 1040 | <code>long events_head(Cg &#42;cg);</code> |
| `events_pruned_through` | function | 1041 | <code>long events_pruned_through(Cg &#42;cg);</code> |
| `events_since` | function | 1043 | <code>long events_since(Cg &#42;cg, long since, const char &#42;kinds, int limit,</code> |
| `events_json` | function | 1045 | <code>void events_json(StrBuf &#42;b, const EventRow &#42;e);</code> |
| `cmd_events` | function | 1046 | <code>int  cmd_events(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `events_emit_at` | function | 1049 | <code>long events_emit_at(Cg &#42;cg, long at_ms, const char &#42;kind, const char &#42;subject,</code> |
| `JOURNAL_VERSION` | macro | 1058 | <code>#define JOURNAL_VERSION 1</code> |
| `JournalMode` | typedef | 1059 | <code>typedef enum {</code> |
| `journal_append` | function | 1065 | <code>int  journal_append(Cg &#42;cg, const char &#42;op, const char &#42;args,</code> |
| `journal_replay` | function | 1069 | <code>int  journal_replay(Cg &#42;cg, JournalMode mode);</code> |
| `journal_begin` | function | 1073 | <code>int  journal_begin(Cg &#42;cg);</code> |
| `journal_busy_seen` | function | 1074 | <code>bool journal_busy_seen(void);</code> |
| `journal_mark_busy` | function | 1075 | <code>void journal_mark_busy(void);</code> |
| `journal_queued_count` | function | 1076 | <code>int  journal_queued_count(void);          /&#42; records this process appended &#42;/</code> |
| `journal_announced` | function | 1077 | <code>void journal_announced(void);             /&#42; the command said "queued" itself &#42;/</code> |
| `journal_set_command` | function | 1078 | <code>void journal_set_command(const char &#42;cmd, const char &#42;sub);</code> |
| `journal_pending` | function | 1079 | <code>int  journal_pending(const Cg &#42;cg, int &#42;failed);  /&#42; pending; failed via ptr &#42;/</code> |
| `journal_queued_memories` | function | 1082 | <code>int  journal_queued_memories(const Cg &#42;cg, const char &#42;query,</code> |
| `cmd_journal` | function | 1084 | <code>int  cmd_journal(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `cg_busy_why` | function | 1087 | <code>void cg_busy_why(const char &#42;why);</code> |
| `spec_journal_apply` | function | 1090 | <code>int  spec_journal_apply(Cg &#42;g, const char &#42;op, const char &#42;args,</code> |
| `govern_journal_apply` | function | 1092 | <code>int  govern_journal_apply(Cg &#42;g, const char &#42;op, const char &#42;args,</code> |
| `runtime_journal_apply` | function | 1095 | <code>int  runtime_journal_apply(Cg &#42;g, const char &#42;args, char &#42;err, size_t errcap);</code> |
| `memory_add_at` | function | 1096 | <code>long memory_add_at(Cg &#42;cg, long created, const char &#42;branch, const char &#42;type,</code> |
| `cmd_remember_ex` | function | 1099 | <code>int  cmd_remember_ex(Cg &#42;cg, const char &#42;text, const char &#42;type,</code> |
| `drift_spec_check` | function | 1109 | <code>int  drift_spec_check(Cg &#42;cg, const char &#42;tree, const char &#42;base,</code> |
| `drift_print` | function | 1112 | <code>void drift_print(const char &#42;report_json);</code> |
| `drift_collision_predict` | function | 1114 | <code>bool drift_collision_predict(Cg &#42;cg, const char &#42;feature, const char &#42;a,</code> |
| `cmd_drift` | function | 1116 | <code>int  cmd_drift(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `drift_interface_check` | function | 1122 | <code>int  drift_interface_check(Cg &#42;cg, const char &#42;tree, const char &#42;base_branch,</code> |
| `coverage_check` | function | 1127 | <code>int  coverage_check(Cg &#42;cg, const char &#42;feature, StrBuf &#42;out);</code> |
| `coverage_print` | function | 1128 | <code>void coverage_print(const char &#42;report_json, const char &#42;feature);</code> |
| `drift_summary` | function | 1130 | <code>int  drift_summary(Cg &#42;cg, const char &#42;feature, StrBuf &#42;text, StrBuf &#42;json);</code> |
| `graph_neighbors` | function | 1132 | <code>int  graph_neighbors(Cg &#42;cg, const char &#42;name, char &#42;&#42;&#42;out);</code> |
| `RoleCaps` | typedef | 1143 | <code>typedef struct {</code> |
| `FleetRole` | typedef | 1154 | <code>typedef struct {</code> |
| `Hierarchy` | typedef | 1162 | <code>typedef struct {</code> |
| `hier_load` | function | 1179 | <code>bool hier_load(const Kvx &#42;wf, Hierarchy &#42;h);   /&#42; defaults, then overrides &#42;/</code> |
| `hier_role_caps` | function | 1182 | <code>void hier_role_caps(const Kvx &#42;wf, Hierarchy &#42;h);</code> |
| `hier_duration` | function | 1184 | <code>long hier_duration(const char &#42;s);</code> |
| `hier_free` | function | 1185 | <code>void hier_free(Hierarchy &#42;h);</code> |
| `hier_expand_task` | function | 1189 | <code>void hier_expand_task(const Hierarchy &#42;h, const char &#42;tmpl, const char &#42;feature,</code> |
| `hier_per_task` | function | 1191 | <code>bool hier_per_task(const Hierarchy &#42;h);</code> |
| `hier_per_wave` | function | 1195 | <code>bool hier_per_wave(const Hierarchy &#42;h);</code> |
| `hier_manager_wave` | function | 1197 | <code>long hier_manager_wave(const Hierarchy &#42;h, long wave);</code> |
| `fleet_merge_lock` | function | 1202 | <code>int  fleet_merge_lock(const char &#42;shared, const char &#42;feature, long wait_ms);</code> |
| `fleet_merge_unlock` | function | 1203 | <code>void fleet_merge_unlock(int fd);</code> |
| `hier_expand` | function | 1204 | <code>void hier_expand(const Hierarchy &#42;h, const char &#42;tmpl, const char &#42;feature,</code> |
| `fleet_identity_record` | function | 1206 | <code>int  fleet_identity_record(Cg &#42;g);           /&#42; no-op without CG_ROLE &#42;/</code> |
| `fleet_brief` | function | 1207 | <code>void fleet_brief(Cg &#42;cg, StrBuf &#42;b, bool json);</code> |
| `fleet_worker_begin` | function | 1214 | <code>int  fleet_worker_begin(Cg &#42;cg, const char &#42;id, const char &#42;feature,</code> |
| `fleet_merge_up` | function | 1216 | <code>int  fleet_merge_up(Cg &#42;cg, const char &#42;id, const char &#42;feature, bool force,</code> |
| `fleet_feature_land` | function | 1218 | <code>int  fleet_feature_land(Cg &#42;cg, const char &#42;feature, bool no_pr, bool json);</code> |
| `fleet_land` | function | 1222 | <code>int  fleet_land(Cg &#42;cg, const char &#42;what, const char &#42;feature, bool no_pr,</code> |
| `fleet_pr_open` | function | 1224 | <code>int  fleet_pr_open(Cg &#42;cg, const char &#42;feature, bool dry_run, bool json);</code> |
| `fleet_checkpoint` | function | 1225 | <code>int  fleet_checkpoint(Cg &#42;cg, bool dry_run, bool json);</code> |
| `cmd_fleet` | function | 1226 | <code>int  cmd_fleet(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `FleetNode` | typedef | 1231 | <code>typedef struct {</code> |
| `orch_spawn_manager` | function | 1249 | <code>int orch_spawn_manager(Cg &#42;cg, const char &#42;feature, long wave,</code> |
| `orch_spawn_worker` | function | 1255 | <code>int orch_spawn_worker(Cg &#42;cg, const char &#42;feature, const char &#42;id,</code> |
| `orch_tree_status` | function | 1260 | <code>int orch_tree_status(Cg &#42;cg, const char &#42;feature, bool json);</code> |
| `JevQuestion` | typedef | 1272 | <code>typedef struct {</code> |
| `JevAnswer` | typedef | 1279 | <code>typedef struct {</code> |
| `JevResult` | typedef | 1288 | <code>typedef struct {</code> |
| `jev_question_noul` | function | 1300 | <code>int  jev_question_noul(JevQuestion &#42;q, const char &#42;name,</code> |
| `jev_question_choice` | function | 1303 | <code>int  jev_question_choice(JevQuestion &#42;q, const char &#42;name,</code> |
| `jev_question_score` | function | 1306 | <code>int  jev_question_score(JevQuestion &#42;q, const char &#42;name,</code> |
| `jev_question_free` | function | 1309 | <code>void jev_question_free(JevQuestion &#42;q);</code> |
| `jev_request_json` | function | 1313 | <code>void jev_request_json(const char &#42;model, const char &#42;state_json,</code> |
| `jev_ask` | function | 1320 | <code>int  jev_ask(Cg &#42;cg, const char &#42;state_json, const JevQuestion &#42;qs, int nq,</code> |
| `jev_ask_raw` | function | 1324 | <code>int  jev_ask_raw(Cg &#42;cg, const char &#42;body, JevResult &#42;out);</code> |
| `jev_ask_at` | function | 1329 | <code>int  jev_ask_at(Cg &#42;cg, const char &#42;key, const char &#42;model,</code> |
| `jev_answer` | function | 1332 | <code>const JevAnswer &#42;jev_answer(const JevResult &#42;r, const char &#42;name);</code> |
| `jev_result_free` | function | 1333 | <code>void jev_result_free(JevResult &#42;r);</code> |
| `cmd_jev` | function | 1334 | <code>int  cmd_jev(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `jev_advisory_ready` | function | 1342 | <code>bool jev_advisory_ready(const char &#42;what);</code> |
| `JevTriage` | typedef | 1343 | <code>typedef struct {</code> |
| `jev_triage_failure` | function | 1351 | <code>int  jev_triage_failure(Cg &#42;cg, const char &#42;output, JevTriage &#42;out);</code> |
| `JevFinding` | typedef | 1352 | <code>typedef struct {</code> |
| `jev_rank_findings` | function | 1362 | <code>int  jev_rank_findings(Cg &#42;cg, JevFinding &#42;v, int n);</code> |
| `JevReadiness` | typedef | 1363 | <code>typedef struct {</code> |
| `jev_pr_readiness` | function | 1367 | <code>int  jev_pr_readiness(Cg &#42;cg, const char &#42;state_json, JevReadiness &#42;out);</code> |
| `jev_report_error` | function | 1378 | <code>int  jev_report_error(const JevResult &#42;r, const char &#42;what);</code> |
| `memory_get` | function | 1381 | <code>bool memory_get(Cg &#42;cg, long id, Memory &#42;out);</code> |
| `cmd_memory_classify` | function | 1384 | <code>int  cmd_memory_classify(Cg &#42;cg, const char &#42;sel, int limit, bool json);</code> |
| `skill_render` | function | 1388 | <code>int  skill_render(Cg &#42;cg, const Memory &#42;m, char &#42;path_out, size_t cap);</code> |
| `skill_findings` | function | 1391 | <code>int  skill_findings(Cg &#42;cg, char &#42;&#42;&#42;out);</code> |
| `cmd_skills` | function | 1392 | <code>int  cmd_skills(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `git_available` | function | 1394 | <code>bool git_available(const Cg &#42;cg);</code> |
| `git_head` | function | 1399 | <code>bool git_head(const char &#42;tree, char &#42;branch, size_t bcap, char &#42;sha,</code> |
| `git_worktree_main` | function | 1403 | <code>bool git_worktree_main(const char &#42;tree, char &#42;main_out, size_t cap);</code> |
| `cg_branch_resolve` | function | 1407 | <code>int  cg_branch_resolve(Cg &#42;cg);</code> |
| `branch_register` | function | 1411 | <code>long branch_register(Cg &#42;cg, const char &#42;name, const char &#42;worktree,</code> |
| `cmd_branches` | function | 1413 | <code>int  cmd_branches(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `PROJECTION_REF` | macro | 1418 | <code>#define PROJECTION_REF    "refs/codify/projection"</code> |
| `PROJECTION_BRANCH` | macro | 1419 | <code>#define PROJECTION_BRANCH "codify/projection"</code> |
| `ProjectionConflict` | typedef | 1424 | <code>typedef struct {</code> |
| `projection_conflicts_free` | function | 1431 | <code>void projection_conflicts_free(ProjectionConflict &#42;v, int n);</code> |
| `cmd_projection` | function | 1433 | <code>int  cmd_projection(Cg &#42;cg, const SysInfo &#42;si, int argc, char &#42;&#42;argv,</code> |
| `config_projection_base` | function | 1437 | <code>const char &#42;config_projection_base(const char &#42;root);</code> |
| `config_projection_stale` | function | 1438 | <code>long config_projection_stale(const char &#42;root);</code> |
| `config_projection_exclude` | function | 1439 | <code>int  config_projection_exclude(const char &#42;root, char &#42;&#42;&#42;out);  /&#42; malloc'd &#42;/</code> |
| `config_projection_index` | function | 1440 | <code>bool config_projection_index(const char &#42;root);</code> |
| `DriftHunk` | typedef | 1446 | <code>typedef struct { int from, to, ofrom, oto; } DriftHunk; /&#42; head side, base side &#42;/</code> |
| `DriftFile` | typedef | 1447 | <code>typedef struct { char &#42;path; DriftHunk &#42;h; int nh; } DriftFile;</code> |
| `drift_hunks` | function | 1448 | <code>int  drift_hunks(const char &#42;tree, const char &#42;base, const char &#42;head,</code> |
| `drift_files_free` | function | 1450 | <code>void drift_files_free(DriftFile &#42;v, int n);</code> |
| `DriftIface` | typedef | 1451 | <code>typedef struct {</code> |
| `drift_interface_changes` | function | 1455 | <code>int  drift_interface_changes(const char &#42;tree, const char &#42;pre,</code> |
| `drift_ifaces_free` | function | 1457 | <code>void drift_ifaces_free(DriftIface &#42;v, int n);</code> |
| `ConflictBranch` | typedef | 1460 | <code>typedef struct {</code> |
| `ProjectionFinding` | typedef | 1466 | <code>typedef struct {</code> |
| `conflicts_compute` | function | 1479 | <code>int  conflicts_compute(Cg &#42;cg, const char &#42;base, const char &#42;base_head,</code> |
| `conflicts_store` | function | 1486 | <code>int  conflicts_store(Cg &#42;cg, ProjectionFinding &#42;f, int n, int nbranches,</code> |
| `conflicts_steer` | function | 1490 | <code>int  conflicts_steer(Cg &#42;cg, ProjectionFinding &#42;f, int n);</code> |
| `conflicts_free` | function | 1491 | <code>void conflicts_free(ProjectionFinding &#42;f, int n);</code> |
| `conflicts_print` | function | 1493 | <code>int  conflicts_print(Cg &#42;cg, bool json, StrBuf &#42;out);</code> |
| `cmd_projection_findings` | function | 1494 | <code>int  cmd_projection_findings(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `config_projection_steer` | function | 1495 | <code>bool config_projection_steer(const char &#42;root);   /&#42; &#91;projection&#93; steer &#42;/</code> |
| `hier_waves_parallel` | function | 1501 | <code>bool hier_waves_parallel(const Kvx &#42;wf, char &#42;why, size_t cap);</code> |
| `spec_claim_ex` | function | 1505 | <code>int  spec_claim_ex(Cg &#42;g, const char &#42;root, const char &#42;feature,</code> |
| `fleet_worker_begin_ex` | function | 1508 | <code>int  fleet_worker_begin_ex(Cg &#42;cg, const char &#42;id, const char &#42;feature,</code> |
| `spec_start_ahead` | function | 1512 | <code>int  spec_start_ahead(Cg &#42;g, const char &#42;tag, const char &#42;agent,</code> |
| `fleet_sync` | function | 1517 | <code>int  fleet_sync(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json);</code> |
| `fleet_projection_rebuild` | function | 1520 | <code>int  fleet_projection_rebuild(Cg &#42;cg, char &#42;line, size_t cap);</code> |
| `projection_mark_dirty` | function | 1531 | <code>void projection_mark_dirty(Cg &#42;cg, const char &#42;why);</code> |
| `projection_auto_build` | function | 1532 | <code>int  projection_auto_build(Cg &#42;cg, const char &#42;why, long &#42;retry_ms);</code> |
| `projection_follow` | function | 1537 | <code>void projection_follow(Cg &#42;cg, const char &#42;why);</code> |
| `projection_branch_findings` | function | 1540 | <code>int  projection_branch_findings(Cg &#42;cg, const char &#42;branch, StrBuf &#42;out);</code> |
| `projection_summary` | function | 1542 | <code>void projection_summary(Cg &#42;cg, StrBuf &#42;b, bool json);</code> |
| `projection_tree_json` | function | 1544 | <code>void projection_tree_json(Cg &#42;cg, StrBuf &#42;b);</code> |
| `config_projection_auto` | function | 1545 | <code>bool config_projection_auto(const char &#42;root);           /&#42; default true &#42;/</code> |
| `config_projection_min_interval` | function | 1546 | <code>long config_projection_min_interval(const char &#42;root);   /&#42; seconds, 15 &#42;/</code> |
| `git_run` | function | 1550 | <code>int  git_run(const char &#42;tree, const char &#42;args, StrBuf &#42;out);</code> |
| `git_version` | function | 1553 | <code>int  git_version(int &#42;major, int &#42;minor);          /&#42; 0, or -1: no git &#42;/</code> |
| `git_rev_commit` | function | 1555 | <code>int  git_rev_commit(const char &#42;tree, const char &#42;rev, char &#42;sha, size_t cap);</code> |
| `git_is_ancestor` | function | 1556 | <code>bool git_is_ancestor(const char &#42;tree, const char &#42;a, const char &#42;b);</code> |
| `git_count_commits` | function | 1557 | <code>long git_count_commits(const char &#42;tree, const char &#42;from, const char &#42;to);</code> |
| `git_changed_paths` | function | 1559 | <code>int  git_changed_paths(const char &#42;tree, const char &#42;from, const char &#42;to,</code> |
| `git_merge_tree` | function | 1564 | <code>int  git_merge_tree(const char &#42;tree, const char &#42;a, const char &#42;b,</code> |
| `git_commit_tree` | function | 1568 | <code>int  git_commit_tree(const char &#42;tree, const char &#42;treeid,</code> |
| `git_update_ref` | function | 1571 | <code>int  git_update_ref(const char &#42;tree, const char &#42;ref, const char &#42;sha);</code> |
| `git_commit_time` | function | 1572 | <code>long git_commit_time(const char &#42;tree, const char &#42;rev);   /&#42; 0 unknown &#42;/</code> |
| `git_shadow_tree` | function | 1576 | <code>int  git_shadow_tree(const char &#42;worktree, const char &#42;tmp_index,</code> |
| `git_tree_diff_count` | function | 1579 | <code>int  git_tree_diff_count(const char &#42;tree, const char &#42;a, const char &#42;b);</code> |
| `git_capture_text` | function | 1581 | <code>int  git_capture_text(const char &#42;tree, const char &#42;args, StrBuf &#42;out);</code> |
| `git_branch_exists` | function | 1582 | <code>bool git_branch_exists(const char &#42;tree, const char &#42;branch);</code> |
| `git_worktree_add` | function | 1589 | <code>int  git_worktree_add(const char &#42;tree, const char &#42;path, const char &#42;branch,</code> |
| `git_conflicted_paths` | function | 1593 | <code>int  git_conflicted_paths(const char &#42;tree, char &#42;&#42;&#42;out);</code> |
| `git_ingest` | function | 1596 | <code>int  git_ingest(Cg &#42;cg, int limit, long &#42;ncommits, long &#42;npaths, long &#42;seen);</code> |
| `cmd_git_sync` | function | 1597 | <code>int  cmd_git_sync(Cg &#42;cg, int limit, bool json);</code> |
| `git_churn_for_path` | function | 1598 | <code>int  git_churn_for_path(Cg &#42;cg, const char &#42;path);</code> |
| `git_commit_mirror` | function | 1599 | <code>int  git_commit_mirror(Cg &#42;cg, const char &#42;message);</code> |
| `cmd_mcp` | function | 1602 | <code>int cmd_mcp(Cg &#42;cg, const SysInfo &#42;si);            /&#42; stdio MCP server &#42;/</code> |
| `mcp_tools_json` | function | 1606 | <code>void mcp_tools_json(StrBuf &#42;r);                    /&#42; {"tools":&#91;...&#93;} &#42;/</code> |
| `mcp_call_tool` | function | 1607 | <code>int  mcp_call_tool(Cg &#42;cg, const SysInfo &#42;si, const char &#42;name,</code> |
| `cmd_tool` | function | 1609 | <code>int  cmd_tool(Cg &#42;cg, const SysInfo &#42;si, int argc, char &#42;&#42;argv, bool json);</code> |
| `cmd_serve` | function | 1612 | <code>int  cmd_serve(Cg &#42;cg, const SysInfo &#42;si);</code> |
| `cmd_mcp_install` | function | 1613 | <code>int cmd_mcp_install(Cg &#42;cg);                       /&#42; wire into agent configs &#42;/</code> |
| `cmd_changelog` | function | 1615 | <code>int cmd_changelog(Cg &#42;cg, int limit, const char &#42;outfile);</code> |
| `ChangelogOpts` | typedef | 1618 | <code>typedef struct {</code> |
| `cmd_changelog_git` | function | 1624 | <code>int cmd_changelog_git(Cg &#42;cg, const ChangelogOpts &#42;o);</code> |
| `ChatModel` | typedef | 1631 | <code>typedef struct {</code> |
| `chat_model_config` | function | 1635 | <code>void  chat_model_config(const Cg &#42;cg, ChatModel &#42;m);</code> |
| `chat_model_ask` | function | 1638 | <code>char &#42;chat_model_ask(const Cg &#42;cg, const ChatModel &#42;m, const char &#42;prompt,</code> |
| `env_file_key` | function | 1641 | <code>void  env_file_key(const char &#42;root, const char &#42;want, char &#42;out, size_t cap);</code> |
| `RecapOpts` | typedef | 1645 | <code>typedef struct {</code> |
| `cmd_recap` | function | 1655 | <code>int cmd_recap(Cg &#42;cg, const RecapOpts &#42;o);</code> |
| `cmd_agentmd` | function | 1656 | <code>int cmd_agentmd(Cg &#42;cg, bool write_files);         /&#42; graph agent context &#42;/</code> |
| `CodemapOpts` | typedef | 1660 | <code>typedef struct {</code> |
| `cmd_codemap` | function | 1665 | <code>int  cmd_codemap(Cg &#42;cg, const CodemapOpts &#42;o);</code> |
| `codemap_render` | function | 1668 | <code>int  codemap_render(Cg &#42;cg, int budget, bool json, const char &#42;self_rel,</code> |
| `codemap_default_path` | function | 1670 | <code>void codemap_default_path(const Cg &#42;cg, char &#42;out, size_t cap);</code> |
| `codemap_status` | function | 1673 | <code>int  codemap_status(Cg &#42;cg, char &#42;rel, size_t cap);</code> |
| `cmd_docs` | function | 1674 | <code>int cmd_docs(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json); /&#42; documentation closure &#42;/</code> |
| `spec_docs_finish` | function | 1675 | <code>int spec_docs_finish(Cg &#42;cg, const char &#42;feature); /&#42; internal checked closure &#42;/</code> |
| `help_overview` | function | 1681 | <code>void help_overview(void);</code> |
| `help_command` | function | 1682 | <code>int  help_command(const char &#42;name);</code> |
| `cmd_help` | function | 1683 | <code>int  cmd_help(int argc, char &#42;&#42;argv);</code> |
| `help_route` | function | 1684 | <code>int  help_route(int argc, char &#42;&#42;argv);</code> |
| `help_usage` | function | 1685 | <code>void help_usage(const char &#42;name);              /&#42; "usage: cg ..." on stderr &#42;/</code> |
| `help_suggest` | function | 1686 | <code>void help_suggest(const char &#42;name);            /&#42; closest names, on stderr &#42;/</code> |
| `help_known` | function | 1687 | <code>bool help_known(const char &#42;name);              /&#42; a top-level row or alias &#42;/</code> |

## src/help.c

[Open source](../../src/help.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HelpCmd` | typedef | 21 | <code>typedef struct {</code> |
| `HelpGroup` | typedef | 36 | <code>typedef struct { const char &#42;key, &#42;title, &#42;blurb; } HelpGroup;</code> |
| `GROUPS` | variable | 38 | <code>static const HelpGroup GROUPS&#91;&#93; = {</code> |
| `NGROUPS` | macro | 49 | <code>#define NGROUPS (int)(sizeof GROUPS / sizeof GROUPS&#91;0&#93;)</code> |
| `HELP` | variable | 51 | <code>static const HelpCmd HELP&#91;&#93; = {</code> |
| `NHELP` | macro | 1092 | <code>#define NHELP (int)(sizeof HELP / sizeof HELP&#91;0&#93;)</code> |
| `help_width` | function | 1102 | <code>static int help_width(void) {</code> |
| `help_styled` | function | 1117 | <code>static bool help_styled(void) {</code> |
| `Out` | typedef | 1128 | <code>typedef struct { StrBuf b; int width; bool style; int col; } Out;</code> |
| `dwidth` | function | 1131 | <code>static int dwidth(const char &#42;s, size_t n) {</code> |
| `o_raw` | function | 1138 | <code>static void o_raw(Out &#42;o, const char &#42;s, size_t n) {</code> |
| `o_str` | function | 1142 | <code>static void o_str(Out &#42;o, const char &#42;s) { o_raw(o, s, strlen(s)); }</code> |
| `o_nl` | function | 1143 | <code>static void o_nl(Out &#42;o) { sb_putc(&amp;o-&gt;b, '&#92;n'); o-&gt;col = 0; }</code> |
| `o_pad` | function | 1144 | <code>static void o_pad(Out &#42;o, int to) { while (o-&gt;col &lt; to) o_raw(o, " ", 1); }</code> |
| `o_on` | function | 1145 | <code>static void o_on(Out &#42;o, const char &#42;sgr) {</code> |
| `BOLD` | macro | 1148 | <code>#define BOLD "&#92;033&#91;1m"</code> |
| `DIM` | macro | 1149 | <code>#define DIM  "&#92;033&#91;2m"</code> |
| `OFF` | macro | 1150 | <code>#define OFF  "&#92;033&#91;0m"</code> |
| `o_wrap` | function | 1155 | <code>static void o_wrap(Out &#42;o, const char &#42;s, int indent) {</code> |
| `o_init` | function | 1183 | <code>static void o_init(Out &#42;o) {</code> |
| `o_flush` | function | 1189 | <code>static void o_flush(Out &#42;o, FILE &#42;f) {</code> |
| `in_list` | function | 1196 | <code>static bool in_list(const char &#42;list, const char &#42;name) {</code> |
| `help_find` | function | 1208 | <code>static const HelpCmd &#42;help_find(const char &#42;name) {</code> |
| `help_known` | function | 1218 | <code>bool help_known(const char &#42;name) { return help_find(name) != NULL; }</code> |
| `is_child` | function | 1221 | <code>static bool is_child(const HelpCmd &#42;c, const char &#42;parent) {</code> |
| `group_of` | function | 1226 | <code>static const HelpGroup &#42;group_of(const HelpCmd &#42;c) {</code> |
| `row` | function | 1236 | <code>static void row(Out &#42;o, const char &#42;name, const char &#42;args, const char &#42;sum,</code> |
| `left_col` | function | 1250 | <code>static int left_col(const Out &#42;o) {</code> |
| `flags_block` | function | 1255 | <code>static void flags_block(Out &#42;o, const char &#42;flags, int lcol) {</code> |
| `help_overview` | function | 1275 | <code>void help_overview(void) {</code> |
| `section` | function | 1313 | <code>static void section(Out &#42;o, const char &#42;title) {</code> |
| `detail` | function | 1318 | <code>static void detail(Out &#42;o, const HelpCmd &#42;c) {</code> |
| `edit_dist` | function | 1370 | <code>static int edit_dist(const char &#42;a, const char &#42;b) {</code> |
| `help_suggest` | function | 1386 | <code>void help_suggest(const char &#42;name) {</code> |
| `find_words` | function | 1416 | <code>static const HelpCmd &#42;find_words(int n, char &#42;&#42;w) {</code> |
| `help_command` | function | 1430 | <code>int help_command(const char &#42;name) {</code> |
| `help_all` | function | 1443 | <code>static void help_all(void) {</code> |
| `json_list` | function | 1455 | <code>static void json_list(StrBuf &#42;b, const char &#42;list, char sep) {</code> |
| `json_flags` | function | 1472 | <code>static void json_flags(StrBuf &#42;b, const char &#42;flags) {</code> |
| `help_json` | function | 1495 | <code>static void help_json(void) {</code> |
| `help_usage` | function | 1561 | <code>void help_usage(const char &#42;name) {</code> |
| `cmd_help` | function | 1567 | <code>int cmd_help(int argc, char &#42;&#42;argv) {</code> |
| `help_route` | function | 1597 | <code>int help_route(int argc, char &#42;&#42;argv) {</code> |

## src/json.c

[Open source](../../src/json.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `skip_value` | function | 9 | <code>static const char &#42;skip_value(const char &#42;p) {</code> |
| `find_key` | function | 44 | <code>static const char &#42;find_key(const char &#42;obj, const char &#42;key) {</code> |
| `unescape` | function | 72 | <code>static char &#42;unescape(const char &#42;s, size_t n) {</code> |
| `json_string_value` | function | 106 | <code>char &#42;json_string_value(const char &#42;raw) {</code> |
| `json_get_string` | function | 118 | <code>char &#42;json_get_string(const char &#42;obj, const char &#42;key) {</code> |
| `json_get_int` | function | 130 | <code>long json_get_int(const char &#42;obj, const char &#42;key, long dflt) {</code> |
| `json_get_raw` | function | 136 | <code>char &#42;json_get_raw(const char &#42;obj, const char &#42;key) {</code> |
| `json_get_object` | function | 147 | <code>char &#42;json_get_object(const char &#42;obj, const char &#42;key) {</code> |
| `json_object_keys` | function | 158 | <code>int json_object_keys(const char &#42;obj, char &#42;&#42;keys, int cap) {</code> |
| `json_array_items` | function | 185 | <code>int json_array_items(const char &#42;arr, char &#42;&#42;&#42;out) {</code> |

## src/main.c

[Open source](../../src/main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hf_client_authority_guard` | function | 2 | <code>extern int hf_client_authority_guard(const char &#42;operation, FILE &#42;output);</code> |
| `hf_client_dispatch` | function | 3 | <code>extern int hf_client_dispatch(int argc,char &#42;&#42;argv,FILE &#42;out,FILE &#42;err);</code> |
| `hf_entrypoint_dispatch` | function | 4 | <code>extern int hf_entrypoint_dispatch(int argc,char &#42;&#42;argv);</code> |
| `hf_client_authority_guard_args` | function | 5 | <code>extern int hf_client_authority_guard_args(const char &#42;operation,int argc,char &#42;&#42;argv,FILE &#42;output);</code> |
| `usage` | function | 17 | <code>static void usage(void) {</code> |
| `flag` | function | 21 | <code>static bool flag(int &#42;argc, char &#42;&#42;argv, const char &#42;name) {</code> |
| `opt` | function | 33 | <code>static const char &#42;opt(int &#42;argc, char &#42;&#42;argv, const char &#42;name,</code> |
| `workers_opt` | function | 50 | <code>static bool workers_opt(int &#42;argc, char &#42;&#42;argv, const char &#42;cmd, int &#42;out) {</code> |
| `query_budget_arg` | function | 64 | <code>static int query_budget_arg(int argc, char &#42;&#42;argv) {</code> |
| `cmd_info` | function | 70 | <code>static int cmd_info(const SysInfo &#42;si, Cg &#42;cg, bool json, int flag_workers) {</code> |
| `FRESH_WINDOW_MS` | macro | 161 | <code>#define FRESH_WINDOW_MS 3000</code> |
| `index_fresh` | function | 162 | <code>static void index_fresh(Cg &#42;cg, const SysInfo &#42;si) {</code> |
| `main` | function | 172 | <code>int main(int argc, char &#42;&#42;argv) {</code> |

## src/sha256.c

[Open source](../../src/sha256.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Sha256` | typedef | 4 | <code>typedef struct {</code> |
| `K` | variable | 11 | <code>static const uint32_t K&#91;64&#93; = {</code> |
| `ROR` | macro | 25 | <code>#define ROR(x,n) (((x) &gt;&gt; (n)) &#124; ((x) &lt;&lt; (32 - (n))))</code> |
| `sha_block` | function | 27 | <code>static void sha_block(Sha256 &#42;s, const uint8_t &#42;p) {</code> |
| `sha256_hex` | function | 52 | <code>void sha256_hex(const void &#42;data, size_t len, char out_hex&#91;65&#93;) {</code> |

## src/sysinfo.c

[Open source](../../src/sysinfo.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `slurp` | function | 11 | <code>static char &#42;slurp(const char &#42;path) {</code> |
| `cgroup_cpu_quota` | function | 16 | <code>static double cgroup_cpu_quota(void) {</code> |
| `cgroup_mem_avail_kb` | function | 39 | <code>static long cgroup_mem_avail_kb(long &#42;limit_kb_out) {</code> |
| `proc_meminfo` | function | 63 | <code>static void proc_meminfo(long &#42;total_kb, long &#42;avail_kb) {</code> |
| `sysinfo_detect` | function | 74 | <code>void sysinfo_detect(SysInfo &#42;si) {</code> |

## src/util.c

[Open source](../../src/util.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `path_format` | function | 5 | <code>bool path_format(char &#42;out, size_t cap, const char &#42;fmt, ...) {</code> |
| `xmalloc` | function | 24 | <code>void &#42;xmalloc(size_t n) {</code> |
| `xrealloc` | function | 29 | <code>void &#42;xrealloc(void &#42;p, size_t n) {</code> |
| `xstrdup` | function | 34 | <code>char &#42;xstrdup(const char &#42;s) {</code> |
| `sb_init` | function | 41 | <code>void sb_init(StrBuf &#42;b) { b-&gt;p = xmalloc(256); b-&gt;p&#91;0&#93; = 0; b-&gt;len = 0; b-&gt;cap = 256; }</code> |
| `sb_free` | function | 42 | <code>void sb_free(StrBuf &#42;b) { free(b-&gt;p); b-&gt;p = NULL; b-&gt;len = b-&gt;cap = 0; }</code> |
| `sb_grow` | function | 43 | <code>static void sb_grow(StrBuf &#42;b, size_t need) {</code> |
| `sb_putc` | function | 48 | <code>void sb_putc(StrBuf &#42;b, char c) { sb_grow(b, 1); b-&gt;p&#91;b-&gt;len++&#93; = c; b-&gt;p&#91;b-&gt;len&#93; = 0; }</code> |
| `sb_puts` | function | 49 | <code>void sb_puts(StrBuf &#42;b, const char &#42;s) {</code> |
| `sb_printf` | function | 55 | <code>void sb_printf(StrBuf &#42;b, const char &#42;fmt, ...) {</code> |
| `sb_json_str` | function | 68 | <code>void sb_json_str(StrBuf &#42;b, const char &#42;s) {</code> |
| `sb_shquote` | function | 87 | <code>void sb_shquote(StrBuf &#42;b, const char &#42;s) {</code> |
| `cg_find_exe` | function | 96 | <code>bool cg_find_exe(const char &#42;name, char &#42;out, size_t cap) {</code> |
| `read_entire_file` | function | 118 | <code>char &#42;read_entire_file(const char &#42;path, size_t &#42;out_len) {</code> |
| `hash_lines` | function | 147 | <code>void hash_lines(const char &#42;data, size_t len, int from, int to,</code> |
| `name_words` | function | 164 | <code>void name_words(const char &#42;name, char &#42;out, size_t cap) {</code> |
| `write_entire_file` | function | 189 | <code>int write_entire_file(const char &#42;path, const void &#42;data, size_t len) {</code> |
| `mkdirs` | function | 213 | <code>int mkdirs(const char &#42;path) {</code> |
| `cg_capture` | function | 228 | <code>int cg_capture(char &#42;&#42;out, int (&#42;fn)(void &#42;), void &#42;ctx) {</code> |
| `now_ms` | function | 253 | <code>long now_ms(void) {</code> |
| `looks_binary` | function | 259 | <code>bool looks_binary(const char &#42;data, size_t len) {</code> |
| `path_ext` | function | 266 | <code>const char &#42;path_ext(const char &#42;path) {</code> |
| `cg_agent_name` | function | 276 | <code>const char &#42;cg_agent_name(const char &#42;flag) {</code> |
| `cg_agent_role` | function | 288 | <code>const char &#42;cg_agent_role(const char &#42;flag) {</code> |
| `cg_agent_parent` | function | 294 | <code>const char &#42;cg_agent_parent(const char &#42;flag) {</code> |
| `DEFAULT_IGNORES` | variable | 302 | <code>static const char &#42;DEFAULT_IGNORES&#91;&#93; = {</code> |
| `ig_add_flags` | function | 315 | <code>static void ig_add_flags(Ignore &#42;ig, const char &#42;pat, bool negate,</code> |
| `ig_add` | function | 329 | <code>static void ig_add(Ignore &#42;ig, const char &#42;pat) {</code> |
| `ig_load_file` | function | 337 | <code>static void ig_load_file(Ignore &#42;ig, const char &#42;path) {</code> |
| `ig_load_nested` | function | 367 | <code>static void ig_load_nested(Ignore &#42;ig, const char &#42;root, const char &#42;reldir) {</code> |
| `ig_walk_gitignores` | function | 396 | <code>static void ig_walk_gitignores(Ignore &#42;ig, const char &#42;root,</code> |
| `ignore_load` | function | 420 | <code>void ignore_load(Ignore &#42;ig, const char &#42;root) {</code> |
| `pat_match` | function | 433 | <code>static bool pat_match(const char &#42;pat, const char &#42;text, bool anchored) {</code> |
| `ig_entry_hits` | function | 438 | <code>static bool ig_entry_hits(const IgnorePat &#42;e, const char &#42;rel,</code> |
| `ignore_match` | function | 461 | <code>bool ignore_match(const Ignore &#42;ig, const char &#42;rel, bool is_dir) {</code> |
| `ignore_free` | function | 486 | <code>void ignore_free(Ignore &#42;ig) {</code> |
