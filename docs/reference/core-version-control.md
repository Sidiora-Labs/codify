# Source reference: C core: version control

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the content-addressed version control and Git integration (`src/vcs.c`, `src/gitint.c`), the branch projection and its conflict findings (`src/projection.c`, `src/conflicts.c`), drift, the event log, the write journal, `hyperfide state` (`src/runtime.c`) and `hyperfide changelog` (`src/changelog.c`): 342 declarations in 9 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## src/changelog.c

[Open source](../../src/changelog.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `git_capture` | function | 36 | <code>static int git_capture(const char &#42;tree, const char &#42;args, StrBuf &#42;out)</code> |
| `repo_url` | function | 59 | <code>static void repo_url(const char &#42;tree, char &#42;out, size_t cap)</code> |
| `Tag` | typedef | 101 | <code>typedef struct</code> |
| `tags_load` | function | 107 | <code>static int tags_load(const char &#42;tree, Tag &#42;&#42;out)</code> |
| `version_source` | function | 147 | <code>static const char &#42;version_source(const char &#42;tree, char &#42;path, size_t cap)</code> |
| `version_parse` | function | 166 | <code>static void version_parse(const char &#42;src, const char &#42;body, char &#42;out, size_t cap)</code> |
| `version_at` | function | 196 | <code>static void version_at(const char &#42;tree, const char &#42;src, const char &#42;rev,</code> |
| `version_now` | function | 217 | <code>static void version_now(const char &#42;tree, const char &#42;src, char &#42;out, size_t cap)</code> |
| `Boundary` | typedef | 229 | <code>typedef struct</code> |
| `boundaries_load` | function | 236 | <code>static int boundaries_load(const char &#42;tree, const char &#42;src, Boundary &#42;&#42;out)</code> |
| `ADD` | macro | 241 | <code>#define ADD(nm, cm, wh)                                            &#92;</code> |
| `Entry` | typedef | 327 | <code>typedef struct</code> |
| `entry_free` | function | 337 | <code>static void entry_free(Entry &#42;e)</code> |
| `GROUPS` | variable | 354 | <code>} GROUPS&#91;&#93; = {</code> |
| `NGROUPS` | macro | 378 | <code>#define NGROUPS ((int)(sizeof GROUPS / sizeof GROUPS&#91;0&#93;))</code> |
| `re_init` | function | 384 | <code>static void re_init(void)</code> |
| `upper_first` | function | 395 | <code>static char &#42;upper_first(const char &#42;s)</code> |
| `trimdup` | function | 403 | <code>static char &#42;trimdup(const char &#42;s, size_t n)</code> |
| `entry_parse` | function | 420 | <code>static void entry_parse(Entry &#42;e, const char &#42;subject, const char &#42;body)</code> |
| `commits_load` | function | 494 | <code>static int commits_load(const char &#42;tree, const char &#42;range, Entry &#42;&#42;out)</code> |
| `Release` | typedef | 549 | <code>typedef struct</code> |
| `group_rank` | function | 557 | <code>static int group_rank(const char &#42;g)</code> |
| `render_release` | function | 567 | <code>static void render_release(StrBuf &#42;md, const Release &#42;r, Entry &#42;v, int n,</code> |
| `Summ` | typedef | 664 | <code>typedef ChatModel Summ;</code> |
| `env_file_key` | function | 668 | <code>void env_file_key(const char &#42;root, const char &#42;want, char &#42;out, size_t cap)</code> |
| `chat_model_config` | function | 711 | <code>void chat_model_config(const Cg &#42;cg, ChatModel &#42;s)</code> |
| `summ_config` | macro | 736 | <code>#define summ_config chat_model_config</code> |
| `cfgquote` | function | 738 | <code>static void cfgquote(StrBuf &#42;b, const char &#42;s)</code> |
| `write_private` | function | 750 | <code>static int write_private(const char &#42;path, const char &#42;data)</code> |
| `summ_ask` | function | 771 | <code>static char &#42;summ_ask(const Cg &#42;cg, const Summ &#42;s, const Release &#42;r,</code> |
| `chat_model_ask` | function | 793 | <code>char &#42;chat_model_ask(const Cg &#42;cg, const ChatModel &#42;s, const char &#42;prompt_text,</code> |
| `highlights_body` | function | 944 | <code>static const char &#42;highlights_body(const char &#42;text)</code> |
| `summ_cache_path` | function | 965 | <code>static void summ_cache_path(const Cg &#42;cg, const Release &#42;r, const Summ &#42;s,</code> |
| `cmd_changelog_git` | function | 978 | <code>int cmd_changelog_git(Cg &#42;cg, const ChangelogOpts &#42;o)</code> |

## src/conflicts.c

[Open source](../../src/conflicts.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `NEAR_LINES` | macro | 35 | <code>#define NEAR_LINES 3</code> |
| `CHunk` | typedef | 39 | <code>typedef struct {</code> |
| `CFile` | typedef | 45 | <code>typedef struct {</code> |
| `CBr` | typedef | 51 | <code>typedef struct {</code> |
| `Span` | typedef | 60 | <code>typedef struct { char &#42;name; int line, end; } Span;</code> |
| `branch_id_of` | function | 62 | <code>static long branch_id_of(Cg &#42;cg, const char &#42;name) {</code> |
| `spans_of` | function | 72 | <code>static int spans_of(Cg &#42;cg, long bid, const char &#42;path, Span &#42;&#42;out) {</code> |
| `spans_free` | function | 101 | <code>static void spans_free(Span &#42;s, int n) {</code> |
| `list_has` | function | 106 | <code>static bool list_has(char &#42;&#42;v, int n, const char &#42;s) {</code> |
| `list_push` | function | 111 | <code>static void list_push(char &#42;&#42;&#42;v, int &#42;n, const char &#42;s) {</code> |
| `list_free` | function | 117 | <code>static void list_free(char &#42;&#42;v, int n) {</code> |
| `hunk_symbols` | function | 124 | <code>static void hunk_symbols(CHunk &#42;ch, const Span &#42;s, int ns, int lo, int hi) {</code> |
| `branch_load` | function | 139 | <code>static void branch_load(Cg &#42;cg, const char &#42;base_head, long base_id, CBr &#42;x) {</code> |
| `agents_ttl` | function | 173 | <code>static long agents_ttl(Cg &#42;cg) {</code> |
| `branch_agents` | function | 186 | <code>static void branch_agents(Cg &#42;cg, long since, CBr &#42;x) {</code> |
| `br_named` | function | 204 | <code>static CBr &#42;br_named(CBr &#42;v, int n, const char &#42;name) {</code> |
| `file_of` | function | 209 | <code>static CFile &#42;file_of(CBr &#42;x, const char &#42;path) {</code> |
| `range_str` | function | 216 | <code>static void range_str(StrBuf &#42;b, int from, int to) {</code> |
| `FList` | typedef | 223 | <code>typedef struct { ProjectionFinding &#42;v; int n, cap; } FList;</code> |
| `str_cmp` | function | 225 | <code>static int str_cmp(const void &#42;a, const void &#42;b) {</code> |
| `fl_add` | function | 229 | <code>static ProjectionFinding &#42;fl_add(FList &#42;l, const char &#42;kind, const char &#42;path,</code> |
| `fl_has_textual` | function | 259 | <code>static bool fl_has_textual(const FList &#42;l, const char &#42;path, const char &#42;a,</code> |
| `lines_on` | function | 275 | <code>static char &#42;lines_on(CBr &#42;v, int nv, char &#42;&#42;branches, int nb,</code> |
| `fold_kind` | function | 299 | <code>static const char &#42;fold_kind(const char &#42;git_kind) {</code> |
| `advice_for` | function | 306 | <code>static char &#42;advice_for(const ProjectionFinding &#42;f, const char &#42;other) {</code> |
| `agents_json` | function | 338 | <code>static char &#42;agents_json(CBr &#42;v, int nv, char &#42;&#42;branches, int nb) {</code> |
| `carries` | function | 362 | <code>static bool carries(Cg &#42;cg, const char &#42;base_head, const ConflictBranch &#42;a,</code> |
| `merge_base` | function | 369 | <code>static int merge_base(Cg &#42;cg, const char &#42;a, const char &#42;b, char &#42;out,</code> |
| `conflicts_compute` | function | 384 | <code>int conflicts_compute(Cg &#42;cg, const char &#42;base, const char &#42;base_head,</code> |
| `conflicts_free` | function | 548 | <code>void conflicts_free(ProjectionFinding &#42;f, int n) {</code> |
| `branch_csv` | function | 559 | <code>static char &#42;branch_csv(const ProjectionFinding &#42;f) {</code> |
| `branches_json_csv` | function | 568 | <code>static void branches_json_csv(StrBuf &#42;b, const char &#42;csv) {</code> |
| `finding_json` | function | 585 | <code>static void finding_json(StrBuf &#42;b, const char &#42;kind, const char &#42;path,</code> |
| `live_count` | function | 608 | <code>static long live_count(Cg &#42;cg) {</code> |
| `conflicts_store` | function | 616 | <code>int conflicts_store(Cg &#42;cg, ProjectionFinding &#42;f, int n, int nbranches,</code> |
| `steer_what` | function | 744 | <code>static void steer_what(StrBuf &#42;b, const ProjectionFinding &#42;f, const char &#42;me) {</code> |
| `conflicts_steer` | function | 767 | <code>int conflicts_steer(Cg &#42;cg, ProjectionFinding &#42;f, int n) {</code> |
| `age_str` | function | 831 | <code>static void age_str(char &#42;out, size_t cap, long s) {</code> |
| `conflicts_print` | function | 839 | <code>int conflicts_print(Cg &#42;cg, bool json, StrBuf &#42;out) {</code> |
| `cmd_projection_findings` | function | 907 | <code>int cmd_projection_findings(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |

## src/drift.c

[Open source](../../src/drift.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Hunk` | typedef | 18 | <code>typedef struct { int from, to, ofrom, oto; } Hunk;   /&#42; new side, base side &#42;/</code> |
| `FileDiff` | typedef | 19 | <code>typedef struct { char &#42;path; Hunk &#42;h; int nh, ch; } FileDiff;</code> |
| `list_free` | function | 21 | <code>static void list_free(char &#42;&#42;v, int n) {</code> |
| `packet_strings` | function | 26 | <code>static int packet_strings(const char &#42;packet, const char &#42;key, char &#42;&#42;&#42;out) {</code> |
| `fd_get` | function | 41 | <code>static FileDiff &#42;fd_get(FileDiff &#42;&#42;v, int &#42;n, int &#42;cap, const char &#42;path) {</code> |
| `fd_hunk` | function | 53 | <code>static void fd_hunk(FileDiff &#42;f, int from, int to) {</code> |
| `drift_diff` | function | 67 | <code>static int drift_diff(const char &#42;tree, const char &#42;base, const char &#42;head,</code> |
| `drift_exempt` | function | 141 | <code>static bool drift_exempt(const char &#42;tree, const char &#42;path) {</code> |
| `drift_in_touches` | function | 153 | <code>static bool drift_in_touches(const char &#42;path, char &#42;&#42;touches, int nt) {</code> |
| `drift_public` | function | 162 | <code>static bool drift_public(const char &#42;path, const char &#42;name, const char &#42;kind,</code> |
| `drift_spec_check` | function | 181 | <code>int drift_spec_check(Cg &#42;cg, const char &#42;tree, const char &#42;base,</code> |
| `drift_print` | function | 263 | <code>void drift_print(const char &#42;report_json) {</code> |
| `drift_collision_predict` | function | 295 | <code>bool drift_collision_predict(Cg &#42;cg, const char &#42;feature, const char &#42;a,</code> |
| `drift_active_feature` | function | 337 | <code>static char &#42;drift_active_feature(Cg &#42;cg) {</code> |
| `drift_open_tasks` | function | 347 | <code>static int drift_open_tasks(Cg &#42;cg, const char &#42;feature, char &#42;&#42;&#42;out) {</code> |
| `cmd_drift` | function | 370 | <code>int cmd_drift(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `blob_defs` | function | 466 | <code>static int blob_defs(const char &#42;tree, const char &#42;rev, const char &#42;path,</code> |
| `def_named` | function | 495 | <code>static const SymDef &#42;def_named(const ParseResult &#42;pr, const char &#42;name) {</code> |
| `drift_ref_sites` | function | 505 | <code>static int drift_ref_sites(Cg &#42;cg, const char &#42;name, long skip_branch,</code> |
| `drift_interface_check` | function | 547 | <code>int drift_interface_check(Cg &#42;cg, const char &#42;tree, const char &#42;base_branch,</code> |
| `drift_hunks` | function | 642 | <code>int drift_hunks(const char &#42;tree, const char &#42;base, const char &#42;head,</code> |
| `drift_files_free` | function | 670 | <code>void drift_files_free(DriftFile &#42;v, int n) {</code> |
| `drift_interface_changes` | function | 675 | <code>int drift_interface_changes(const char &#42;tree, const char &#42;pre,</code> |
| `drift_ifaces_free` | function | 717 | <code>void drift_ifaces_free(DriftIface &#42;v, int n) {</code> |
| `coverage_check` | function | 727 | <code>int coverage_check(Cg &#42;cg, const char &#42;feature, StrBuf &#42;out) {</code> |
| `coverage_print` | function | 798 | <code>void coverage_print(const char &#42;report_json, const char &#42;feature) {</code> |
| `drift_summary` | function | 818 | <code>int drift_summary(Cg &#42;cg, const char &#42;feature, StrBuf &#42;text, StrBuf &#42;json) {</code> |

## src/events.c

[Open source](../../src/events.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EVENTS_KEEP_DFLT` | macro | 22 | <code>#define EVENTS_KEEP_DFLT 50000</code> |
| `EVENTS_PRUNE_EVERY` | macro | 23 | <code>#define EVENTS_PRUNE_EVERY 512</code> |
| `EV_NOW` | macro | 26 | <code>#define EV_NOW "CAST((julianday('now')-2440587.5)&#42;86400000 AS INTEGER)"</code> |
| `events_install` | function | 81 | <code>int events_install(Cg &#42;cg) {</code> |
| `now_ms_wall` | function | 88 | <code>static long now_ms_wall(void) {</code> |
| `bind_or_null` | function | 94 | <code>static void bind_or_null(sqlite3_stmt &#42;st, int i, const char &#42;v) {</code> |
| `events_prune` | function | 101 | <code>static void events_prune(Cg &#42;cg, long seq) {</code> |
| `events_emit` | function | 116 | <code>long events_emit(Cg &#42;cg, const char &#42;kind, const char &#42;subject,</code> |
| `events_insert` | function | 121 | <code>static long events_insert(Cg &#42;cg, long at_ms, const char &#42;kind,</code> |
| `events_emit_at` | function | 146 | <code>long events_emit_at(Cg &#42;cg, long at_ms, const char &#42;kind, const char &#42;subject,</code> |
| `events_queue` | function | 156 | <code>static long events_queue(Cg &#42;cg, long at, const char &#42;kind,</code> |
| `events_emit_as` | function | 179 | <code>long events_emit_as(Cg &#42;cg, const char &#42;kind, const char &#42;subject,</code> |
| `events_emit_quiet` | function | 207 | <code>long events_emit_quiet(const char &#42;kind, const char &#42;subject,</code> |
| `events_bind` | function | 224 | <code>void events_bind(Cg &#42;cg) { g_bound = cg; }</code> |
| `events_unbind` | function | 225 | <code>void events_unbind(void) { g_bound = NULL; }</code> |
| `feature_of` | function | 230 | <code>static bool feature_of(const char &#42;path, char &#42;out, size_t cap) {</code> |
| `events_kvx_status` | function | 245 | <code>void events_kvx_status(const char &#42;path, const char &#42;section,</code> |
| `events_head` | function | 273 | <code>long events_head(Cg &#42;cg) {</code> |
| `events_pruned_through` | function | 284 | <code>long events_pruned_through(Cg &#42;cg) {</code> |
| `EV_MAX_KINDS` | macro | 291 | <code>#define EV_MAX_KINDS 16</code> |
| `events_since` | function | 295 | <code>long events_since(Cg &#42;cg, long since, const char &#42;kinds, int limit,</code> |
| `events_json` | function | 357 | <code>void events_json(StrBuf &#42;b, const EventRow &#42;e) {</code> |
| `EV_OPT` | macro | 360 | <code>#define EV_OPT(name, v) do { sb_puts(b, ",&#92;"" name "&#92;":"); &#92;</code> |
| `ev_on_signal` | function | 376 | <code>static void ev_on_signal(int sig) { (void)sig; g_ev_stop = 1; }</code> |
| `ev_print` | function | 378 | <code>static int ev_print(const EventRow &#42;e, void &#42;ud) {</code> |
| `EvRing` | typedef | 402 | <code>typedef struct { long &#42;v; long cap; long n; } EvRing;</code> |
| `ev_ring_add` | function | 404 | <code>static int ev_ring_add(const EventRow &#42;e, void &#42;ud) {</code> |
| `cmd_events` | function | 411 | <code>int cmd_events(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |

## src/gitint.c

[Open source](../../src/gitint.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `git_available` | function | 21 | <code>bool git_available(const Cg &#42;cg) {</code> |
| `chomp` | function | 32 | <code>static char &#42;chomp(char &#42;s) {</code> |
| `git_abs` | function | 41 | <code>static bool git_abs(const char &#42;base, const char &#42;p, char &#42;out, size_t cap) {</code> |
| `git_dirs` | function | 55 | <code>static bool git_dirs(const char &#42;tree, char &#42;gitdir, char &#42;common, size_t cap) {</code> |
| `git_worktree_main` | function | 87 | <code>bool git_worktree_main(const char &#42;tree, char &#42;main_out, size_t cap) {</code> |
| `git_ref_sha` | function | 100 | <code>static bool git_ref_sha(const char &#42;common, const char &#42;ref, char &#42;sha,</code> |
| `git_head` | function | 131 | <code>bool git_head(const char &#42;tree, char &#42;branch, size_t bcap, char &#42;sha,</code> |
| `git_run` | function | 156 | <code>int git_run(const char &#42;tree, const char &#42;args, StrBuf &#42;out) {</code> |
| `git_branch_exists` | function | 178 | <code>bool git_branch_exists(const char &#42;tree, const char &#42;branch) {</code> |
| `git_worktree_add` | function | 190 | <code>int git_worktree_add(const char &#42;tree, const char &#42;path, const char &#42;branch,</code> |
| `git_conflicted_paths` | function | 224 | <code>int git_conflicted_paths(const char &#42;tree, char &#42;&#42;&#42;out) {</code> |
| `git_capture_raw` | function | 252 | <code>static int git_capture_raw(const char &#42;tree, const char &#42;args, char &#42;&#42;out,</code> |
| `cand_push` | function | 278 | <code>static void cand_push(char &#42;&#42;&#42;v, int &#42;n, int &#42;cap, const char &#42;p, size_t len) {</code> |
| `walk_git_candidates` | function | 300 | <code>int walk_git_candidates(const char &#42;root, const char &#42;since, char &#42;&#42;&#42;out,</code> |
| `branch_register` | function | 370 | <code>long branch_register(Cg &#42;cg, const char &#42;name, const char &#42;worktree,</code> |
| `cg_branch_resolve` | function | 395 | <code>int cg_branch_resolve(Cg &#42;cg) {</code> |
| `ago` | function | 411 | <code>static void ago(long since, char &#42;out, size_t cap) {</code> |
| `cmd_branches` | function | 422 | <code>int cmd_branches(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `git_ingest` | function | 484 | <code>int git_ingest(Cg &#42;cg, int limit, long &#42;ncommits_out, long &#42;npaths_out,</code> |
| `cmd_git_sync` | function | 546 | <code>int cmd_git_sync(Cg &#42;cg, int limit, bool json) {</code> |
| `git_churn_for_path` | function | 570 | <code>int git_churn_for_path(Cg &#42;cg, const char &#42;path) {</code> |
| `git_commit_mirror` | function | 582 | <code>int git_commit_mirror(Cg &#42;cg, const char &#42;message) {</code> |
| `GIT_PROJ_IDENT` | macro | 618 | <code>#define GIT_PROJ_IDENT "GIT_AUTHOR_NAME='Codify projection' " &#92;</code> |
| `git_capture` | function | 626 | <code>static int git_capture(const char &#42;tree, const char &#42;env, const char &#42;args,</code> |
| `git_take_oid` | function | 649 | <code>static bool git_take_oid(const char &#42;s, char &#42;out, size_t cap) {</code> |
| `git_version` | function | 660 | <code>int git_version(int &#42;major, int &#42;minor) {</code> |
| `git_rev_commit` | function | 673 | <code>int git_rev_commit(const char &#42;tree, const char &#42;rev, char &#42;sha, size_t cap) {</code> |
| `git_is_ancestor` | function | 687 | <code>bool git_is_ancestor(const char &#42;tree, const char &#42;a, const char &#42;b) {</code> |
| `git_count_commits` | function | 695 | <code>long git_count_commits(const char &#42;tree, const char &#42;from, const char &#42;to) {</code> |
| `git_split_z` | function | 706 | <code>static int git_split_z(const StrBuf &#42;o, char &#42;&#42;&#42;out) {</code> |
| `git_changed_paths` | function | 728 | <code>int git_changed_paths(const char &#42;tree, const char &#42;from, const char &#42;to,</code> |
| `git_conflict_kind` | function | 743 | <code>static void git_conflict_kind(const char &#42;msg, char &#42;out, size_t cap) {</code> |
| `git_merge_tree` | function | 756 | <code>int git_merge_tree(const char &#42;tree, const char &#42;a, const char &#42;b,</code> |
| `git_commit_tree` | function | 826 | <code>int git_commit_tree(const char &#42;tree, const char &#42;treeid,</code> |
| `git_update_ref` | function | 847 | <code>int git_update_ref(const char &#42;tree, const char &#42;ref, const char &#42;sha) {</code> |
| `git_commit_time` | function | 857 | <code>long git_commit_time(const char &#42;tree, const char &#42;rev) {</code> |
| `git_shadow_tree` | function | 867 | <code>int git_shadow_tree(const char &#42;worktree, const char &#42;tmp_index,</code> |
| `git_tree_diff_count` | function | 904 | <code>int git_tree_diff_count(const char &#42;tree, const char &#42;a, const char &#42;b) {</code> |
| `git_capture_text` | function | 917 | <code>int git_capture_text(const char &#42;tree, const char &#42;args, StrBuf &#42;out) {</code> |

## src/journal.c

[Open source](../../src/journal.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `JOURNAL_SUBDIR` | macro | 37 | <code>#define JOURNAL_SUBDIR CG_DIR "/journal"</code> |
| `journal_set_command` | function | 46 | <code>void journal_set_command(const char &#42;cmd, const char &#42;sub) {</code> |
| `journal_busy_seen` | function | 54 | <code>bool journal_busy_seen(void) { return g_busy_seen; }</code> |
| `journal_mark_busy` | function | 55 | <code>void journal_mark_busy(void) { g_busy_seen = true; }</code> |
| `journal_queued_count` | function | 56 | <code>int  journal_queued_count(void) { return g_queued; }</code> |
| `journal_announced` | function | 57 | <code>void journal_announced(void) { g_announced = true; }</code> |
| `journal_dir` | function | 59 | <code>static void journal_dir(const Cg &#42;cg, char &#42;out, size_t cap) {</code> |
| `journal_atexit` | function | 66 | <code>static void journal_atexit(void) {</code> |
| `journal_append` | function | 75 | <code>int journal_append(Cg &#42;cg, const char &#42;op, const char &#42;args,</code> |
| `name_cmp` | function | 130 | <code>static int name_cmp(const void &#42;a, const void &#42;b) {</code> |
| `list_records` | function | 135 | <code>static int list_records(const char &#42;dir, char &#42;&#42;&#42;out) {</code> |
| `free_list` | function | 157 | <code>static void free_list(char &#42;&#42;v, int n) {</code> |
| `journal_pending` | function | 162 | <code>int journal_pending(const Cg &#42;cg, int &#42;failed) {</code> |
| `any_pending` | function | 179 | <code>static bool any_pending(const Cg &#42;cg) {</code> |
| `rc_busy` | function | 197 | <code>static bool rc_busy(int rc) {</code> |
| `begin_wait` | function | 203 | <code>static int begin_wait(Cg &#42;cg, long wait_ms) {</code> |
| `journal_begin` | function | 211 | <code>int journal_begin(Cg &#42;cg) {</code> |
| `set_err` | function | 227 | <code>static void set_err(char &#42;err, size_t cap, const char &#42;msg) {</code> |
| `apply_record` | function | 234 | <code>static int apply_record(Cg &#42;cg, const char &#42;rec, char &#42;err, size_t cap) {</code> |
| `already_applied` | function | 309 | <code>static bool already_applied(Cg &#42;cg, const char &#42;id) {</code> |
| `mark_applied` | function | 321 | <code>static void mark_applied(Cg &#42;cg, const char &#42;id) {</code> |
| `fail_record` | function | 335 | <code>static void fail_record(const char &#42;dir, const char &#42;name, const char &#42;err) {</code> |
| `order_own_first` | function | 353 | <code>static void order_own_first(char &#42;&#42;v, int n) {</code> |
| `journal_replay` | function | 370 | <code>int journal_replay(Cg &#42;cg, JournalMode mode) {</code> |
| `ci_contains` | function | 491 | <code>static bool ci_contains(const char &#42;hay, const char &#42;needle, size_t n) {</code> |
| `query_hits` | function | 504 | <code>static bool query_hits(const char &#42;q, const char &#42;body, const char &#42;task,</code> |
| `journal_queued_memories` | function | 522 | <code>int journal_queued_memories(const Cg &#42;cg, const char &#42;query, const char &#42;task,</code> |
| `when_str` | function | 570 | <code>static void when_str(long at_ms, char &#42;out, size_t cap) {</code> |
| `list_one` | function | 578 | <code>static void list_one(const char &#42;dir, const char &#42;name, const char &#42;error,</code> |
| `journal_list` | function | 613 | <code>static int journal_list(Cg &#42;cg, bool json) {</code> |
| `drop_in` | function | 646 | <code>static int drop_in(const char &#42;dir, const char &#42;only, bool err_too) {</code> |
| `cmd_journal` | function | 669 | <code>int cmd_journal(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |

## src/projection.c

[Open source](../../src/projection.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PROJ_MIN_MAJOR` | macro | 32 | <code>#define PROJ_MIN_MAJOR 2</code> |
| `PROJ_MIN_MINOR` | macro | 33 | <code>#define PROJ_MIN_MINOR 38</code> |
| `ProjBranch` | typedef | 35 | <code>typedef struct {</code> |
| `Projection` | typedef | 54 | <code>typedef struct {</code> |
| `projection_conflicts_free` | function | 65 | <code>void projection_conflicts_free(ProjectionConflict &#42;v, int n) {</code> |
| `proj_free` | function | 75 | <code>static void proj_free(Projection &#42;p) {</code> |
| `proj_add` | function | 85 | <code>static ProjBranch &#42;proj_add(Projection &#42;p, const char &#42;name) {</code> |
| `dir_has_git` | function | 98 | <code>static bool dir_has_git(const char &#42;dir) {</code> |
| `proj_base_name` | function | 108 | <code>static void proj_base_name(Cg &#42;cg, char &#42;out, size_t cap) {</code> |
| `proj_agents_ttl` | function | 124 | <code>static long proj_agents_ttl(Cg &#42;cg) {</code> |
| `proj_branch_live` | function | 138 | <code>static bool proj_branch_live(Cg &#42;cg, const char &#42;name, const char &#42;worktree,</code> |
| `proj_cmp` | function | 154 | <code>static int proj_cmp(const void &#42;a, const void &#42;b) {</code> |
| `projection_branches` | function | 168 | <code>static int projection_branches(Cg &#42;cg, const char &#42;base, char &#42;&#42;extra, int nextra,</code> |
| `projection_shadow_commit` | function | 271 | <code>static int projection_shadow_commit(Cg &#42;cg, ProjBranch &#42;b, int seq) {</code> |
| `proj_conflict_add` | function | 294 | <code>static void proj_conflict_add(Projection &#42;p, const ProjectionConflict &#42;src,</code> |
| `proj_fold` | function | 321 | <code>static int proj_fold(Cg &#42;cg, Projection &#42;p, bool strict) {</code> |
| `proj_branches_json` | function | 379 | <code>static void proj_branches_json(const Projection &#42;p, StrBuf &#42;b) {</code> |
| `proj_conflicts_json` | function | 408 | <code>static void proj_conflicts_json(const Projection &#42;p, StrBuf &#42;b) {</code> |
| `proj_object` | function | 429 | <code>static void proj_object(const char &#42;base, const char &#42;base_head,</code> |
| `raw_true` | function | 449 | <code>static bool raw_true(const char &#42;obj, const char &#42;key) {</code> |
| `proj_text` | function | 458 | <code>static void proj_text(const char &#42;base, const char &#42;base_head,</code> |
| `ProjRow` | typedef | 519 | <code>typedef struct {</code> |
| `proj_row_free` | function | 526 | <code>static void proj_row_free(ProjRow &#42;r) {</code> |
| `proj_last` | function | 532 | <code>static void proj_last(Cg &#42;cg, ProjRow &#42;r) {</code> |
| `proj_store` | function | 555 | <code>static int proj_store(Cg &#42;cg, const Projection &#42;p, const char &#42;branches,</code> |
| `proj_index` | function | 586 | <code>static int proj_index(Cg &#42;cg, const SysInfo &#42;si, const char &#42;commit,</code> |
| `proj_lock` | function | 676 | <code>static int proj_lock(Cg &#42;cg, long wait_ms, bool &#42;waited) {</code> |
| `proj_unlock` | function | 692 | <code>static void proj_unlock(int fd) {</code> |
| `proj_cg_path` | function | 711 | <code>static void proj_cg_path(Cg &#42;cg, const char &#42;name, char &#42;out, size_t cap) {</code> |
| `projection_mark_dirty` | function | 715 | <code>void projection_mark_dirty(Cg &#42;cg, const char &#42;why) {</code> |
| `proj_dirty` | function | 727 | <code>static bool proj_dirty(Cg &#42;cg) {</code> |
| `proj_dirty_clear` | function | 734 | <code>static void proj_dirty_clear(Cg &#42;cg) {</code> |
| `proj_last_activity` | function | 743 | <code>static long proj_last_activity(Cg &#42;cg) {</code> |
| `proj_worth_building` | function | 770 | <code>static bool proj_worth_building(Cg &#42;cg) {</code> |
| `proj_spawn_background` | function | 791 | <code>static int proj_spawn_background(Cg &#42;cg) {</code> |
| `projection_auto_build` | function | 831 | <code>int projection_auto_build(Cg &#42;cg, const char &#42;why, long &#42;retry_ms) {</code> |
| `projection_follow` | function | 863 | <code>void projection_follow(Cg &#42;cg, const char &#42;why) {</code> |
| `proj_age` | function | 889 | <code>static void proj_age(char &#42;out, size_t cap, long s) {</code> |
| `proj_others` | function | 898 | <code>static void proj_others(const char &#42;csv, const char &#42;me, StrBuf &#42;b) {</code> |
| `proj_findings_of` | function | 911 | <code>static int proj_findings_of(Cg &#42;cg, const char &#42;branch, const char &#42;indent,</code> |
| `projection_branch_findings` | function | 946 | <code>int projection_branch_findings(Cg &#42;cg, const char &#42;branch, StrBuf &#42;out) {</code> |
| `proj_count_for` | function | 960 | <code>static long proj_count_for(Cg &#42;cg, const char &#42;branch) {</code> |
| `proj_branch_names` | function | 977 | <code>static int proj_branch_names(Cg &#42;cg, const char &#42;branches_json, char &#42;&#42;&#42;out) {</code> |
| `proj_names_free` | function | 1021 | <code>static void proj_names_free(char &#42;&#42;v, int n) {</code> |
| `proj_worktree_of` | function | 1027 | <code>static void proj_worktree_of(const char &#42;branches_json, const char &#42;name,</code> |
| `proj_live_findings` | function | 1045 | <code>static long proj_live_findings(Cg &#42;cg) {</code> |
| `proj_folded` | function | 1056 | <code>static int proj_folded(const char &#42;branches_json) {</code> |
| `projection_summary` | function | 1069 | <code>void projection_summary(Cg &#42;cg, StrBuf &#42;b, bool json) {</code> |
| `projection_tree_json` | function | 1143 | <code>void projection_tree_json(Cg &#42;cg, StrBuf &#42;b) {</code> |
| `proj_git_check` | function | 1186 | <code>static int proj_git_check(Cg &#42;cg) {</code> |
| `proj_print_row` | function | 1206 | <code>static void proj_print_row(const ProjRow &#42;r, bool unchanged, bool json,</code> |
| `ProjOpts` | typedef | 1220 | <code>typedef struct {</code> |
| `projection_build` | function | 1227 | <code>static int projection_build(Cg &#42;cg, const SysInfo &#42;si, const ProjOpts &#42;o, bool json) {</code> |
| `proj_status` | function | 1373 | <code>static int proj_status(Cg &#42;cg, bool json, const char &#42;branch) {</code> |
| `proj_against` | function | 1433 | <code>static int proj_against(Cg &#42;cg, const char &#42;branch, char &#42;sha, size_t cap,</code> |
| `proj_diff` | function | 1463 | <code>static int proj_diff(Cg &#42;cg, const char &#42;branch, bool json) {</code> |
| `proj_show` | function | 1493 | <code>static int proj_show(Cg &#42;cg, bool json) {</code> |
| `cmd_projection` | function | 1542 | <code>int cmd_projection(Cg &#42;cg, const SysInfo &#42;si, int argc, char &#42;&#42;argv,</code> |

## src/runtime.c

[Open source](../../src/runtime.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GitState` | typedef | 13 | <code>typedef struct {</code> |
| `state_git` | function | 20 | <code>static void state_git(const Cg &#42;cg, GitState &#42;s) {</code> |
| `StateVcsCall` | typedef | 47 | <code>typedef struct { Cg &#42;g; bool json; } StateVcsCall;</code> |
| `state_call_vcs` | function | 48 | <code>static int state_call_vcs(void &#42;v) {</code> |
| `StateSpecCall` | typedef | 53 | <code>typedef struct { bool json; bool reconcile; } StateSpecCall;</code> |
| `state_call_spec` | function | 54 | <code>static int state_call_spec(void &#42;v) {</code> |
| `state_raw_json` | function | 61 | <code>static void state_raw_json(StrBuf &#42;b, const char &#42;raw) {</code> |
| `state_live_attempt` | function | 70 | <code>static bool state_live_attempt(Cg &#42;cg, const char &#42;agent, SpecAttempt &#42;a,</code> |
| `cmd_state` | function | 99 | <code>int cmd_state(Cg &#42;cg, bool json) {</code> |
| `runtime_key_cmp` | function | 185 | <code>static int runtime_key_cmp(const void &#42;a, const void &#42;b) {</code> |
| `runtime_json_object_valid` | function | 193 | <code>static bool runtime_json_object_valid(const char &#42;payload) {</code> |
| `runtime_canonical_json` | function | 227 | <code>static char &#42;runtime_canonical_json(const char &#42;payload) {</code> |
| `runtime_first_string` | function | 255 | <code>static char &#42;runtime_first_string(const char &#42;payload,</code> |
| `runtime_first_raw` | function | 265 | <code>static char &#42;runtime_first_raw(const char &#42;payload,</code> |
| `runtime_kind` | function | 275 | <code>static char &#42;runtime_kind(const char &#42;payload) {</code> |
| `RuntimeFile` | typedef | 293 | <code>typedef struct {</code> |
| `RuntimeFiles` | typedef | 300 | <code>typedef struct { RuntimeFile &#42;v; int n, cap; } RuntimeFiles;</code> |
| `runtime_files_push` | function | 302 | <code>static void runtime_files_push(RuntimeFiles &#42;files, const char &#42;path,</code> |
| `runtime_walk_files` | function | 319 | <code>static void runtime_walk_files(const char &#42;root, const char &#42;rel,</code> |
| `runtime_file_cmp` | function | 344 | <code>static int runtime_file_cmp(const void &#42;a, const void &#42;b) {</code> |
| `runtime_workspace_revision` | function | 353 | <code>void runtime_workspace_revision(Cg &#42;cg, char out&#91;65&#93;) {</code> |
| `RuntimeEventRow` | typedef | 428 | <code>typedef struct {</code> |
| `runtime_event_store` | function | 437 | <code>static int runtime_event_store(Cg &#42;cg, const RuntimeEventRow &#42;r,</code> |
| `runtime_journal_apply` | function | 475 | <code>int runtime_journal_apply(Cg &#42;cg, const char &#42;args, char &#42;err,</code> |
| `runtime_event_queue` | function | 508 | <code>static bool runtime_event_queue(Cg &#42;cg, const RuntimeEventRow &#42;r) {</code> |
| `runtime_event_ingest` | function | 531 | <code>int runtime_event_ingest(Cg &#42;cg, const char &#42;source, const char &#42;payload,</code> |
| `runtime_event_history` | function | 687 | <code>static int runtime_event_history(Cg &#42;cg, int limit, bool json) {</code> |
| `RuntimeSample` | typedef | 744 | <code>typedef struct {</code> |
| `runtime_contains_ci` | function | 751 | <code>static bool runtime_contains_ci(const char &#42;s, const char &#42;needle) {</code> |
| `runtime_sample_failure` | function | 764 | <code>static bool runtime_sample_failure(const RuntimeSample &#42;s) {</code> |
| `runtime_sample_waiting` | function | 783 | <code>static bool runtime_sample_waiting(const RuntimeSample &#42;s) {</code> |
| `runtime_threshold` | function | 795 | <code>static int runtime_threshold(const char &#42;name, int dflt, int floor) {</code> |
| `runtime_classify_progress` | function | 805 | <code>int runtime_classify_progress(Cg &#42;cg, const char &#42;attempt,</code> |
| `runtime_progress_fields` | function | 959 | <code>static void runtime_progress_fields(StrBuf &#42;b, const RuntimeProgress &#42;p) {</code> |
| `runtime_progress` | function | 978 | <code>int runtime_progress(Cg &#42;cg, bool json) {</code> |
| `cmd_event` | function | 1050 | <code>int cmd_event(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |

## src/vcs.c

[Open source](../../src/vcs.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `obj_path` | function | 17 | <code>static void obj_path(const Cg &#42;cg, const char &#42;hash, char &#42;out, size_t cap) {</code> |
| `obj_write` | function | 21 | <code>static int obj_write(const Cg &#42;cg, const void &#42;data, size_t len, char hash&#91;65&#93;) {</code> |
| `obj_read` | function | 33 | <code>static char &#42;obj_read(const Cg &#42;cg, const char &#42;hash, size_t &#42;len) {</code> |
| `head_read` | function | 39 | <code>static int head_read(const Cg &#42;cg, char hash&#91;65&#93;) {</code> |
| `head_write` | function | 49 | <code>static void head_write(const Cg &#42;cg, const char &#42;hash) {</code> |
| `resolve_commit` | function | 56 | <code>static int resolve_commit(const Cg &#42;cg, const char &#42;ref, char out&#91;65&#93;) {</code> |
| `MEnt` | typedef | 84 | <code>typedef struct { char hash&#91;65&#93;; long size; char &#42;path; } MEnt;</code> |
| `Manifest` | typedef | 85 | <code>typedef struct { MEnt &#42;v; int n, cap; } Manifest;</code> |
| `man_push` | function | 87 | <code>static void man_push(Manifest &#42;m, const char &#42;hash, long size, const char &#42;path) {</code> |
| `man_free` | function | 98 | <code>static void man_free(Manifest &#42;m) {</code> |
| `ment_cmp` | function | 104 | <code>static int ment_cmp(const void &#42;a, const void &#42;b) {</code> |
| `snapshot_tree` | function | 109 | <code>static void snapshot_tree(const Cg &#42;cg, Manifest &#42;m, bool store) {</code> |
| `Frame` | typedef | 113 | <code>typedef struct { char rel&#91;4096&#93;; } Frame;</code> |
| `man_serialize` | function | 158 | <code>static char &#42;man_serialize(const Manifest &#42;m, size_t &#42;len) {</code> |
| `man_load` | function | 166 | <code>static int man_load(const Cg &#42;cg, const char &#42;tree_hash, Manifest &#42;m) {</code> |
| `Commit` | typedef | 186 | <code>typedef struct {</code> |
| `commit_load` | function | 192 | <code>static int commit_load(const Cg &#42;cg, const char &#42;hash, Commit &#42;c) {</code> |
| `cmd_commit_with_options` | function | 208 | <code>int cmd_commit_with_options(Cg &#42;cg, const char &#42;msg, bool quiet,</code> |
| `cmd_commit` | function | 277 | <code>int cmd_commit(Cg &#42;cg, const char &#42;msg, bool quiet) {</code> |
| `cmd_log` | function | 281 | <code>int cmd_log(Cg &#42;cg, int limit, bool json) {</code> |
| `TreeDiff` | typedef | 322 | <code>typedef struct { StrBuf added, modified, deleted; int na, nm, nd;</code> |
| `tree_status` | function | 325 | <code>static void tree_status(Cg &#42;cg, TreeDiff &#42;td, bool json) {</code> |
| `cmd_status` | function | 380 | <code>int cmd_status(Cg &#42;cg, bool json) {</code> |
| `CHANGES_SYM_CAP` | macro | 411 | <code>#define CHANGES_SYM_CAP 40</code> |
| `CHANGES_CAL_CAP` | macro | 412 | <code>#define CHANGES_CAL_CAP 8</code> |
| `cmd_changes` | function | 414 | <code>int cmd_changes(Cg &#42;cg, int limit, bool json) {</code> |
| `DLine` | typedef | 523 | <code>typedef struct { const char &#42;s; size_t n; unsigned long h; } DLine;</code> |
| `split_dlines` | function | 525 | <code>static int split_dlines(char &#42;data, size_t len, DLine &#42;&#42;out) {</code> |
| `dl_eq` | function | 544 | <code>static bool dl_eq(const DLine &#42;a, const DLine &#42;b) {</code> |
| `emit_line` | function | 548 | <code>static void emit_line(StrBuf &#42;b, char mark, const DLine &#42;l) {</code> |
| `diff_blobs` | function | 557 | <code>static void diff_blobs(StrBuf &#42;b, char &#42;ad, size_t al, char &#42;bd, size_t bl) {</code> |
| `Op` | typedef | 592 | <code>typedef struct { char mark; int ai, bi; } Op;</code> |
| `cmd_diff` | function | 630 | <code>int cmd_diff(Cg &#42;cg, const char &#42;ra, const char &#42;rb) {</code> |
| `has_def` | function | 707 | <code>static bool has_def(const ParseResult &#42;pr, const char &#42;name, const char &#42;kind) {</code> |
| `has_route` | function | 715 | <code>static bool has_route(const ParseResult &#42;pr, const RouteDef &#42;r) {</code> |
| `count_lines` | function | 723 | <code>static long count_lines(const char &#42;d, size_t n) {</code> |
| `cmp_u64` | function | 731 | <code>static int cmp_u64(const void &#42;a, const void &#42;b) {</code> |
| `line_hashes` | function | 736 | <code>static uint64_t &#42;line_hashes(const char &#42;d, size_t n, long &#42;count) {</code> |
| `line_delta` | function | 758 | <code>static void line_delta(const char &#42;od, size_t ol, const char &#42;nd, size_t nl,</code> |
| `changelog_file` | function | 775 | <code>static void changelog_file(Cg &#42;cg, StrBuf &#42;md, const char &#42;path,</code> |
| `cmd_changelog` | function | 835 | <code>int cmd_changelog(Cg &#42;cg, int limit, const char &#42;outfile) {</code> |
| `cmd_checkout` | function | 985 | <code>int cmd_checkout(Cg &#42;cg, const char &#42;id, bool force) {</code> |
| `PathSet` | typedef | 1058 | <code>typedef struct { char &#42;&#42;v; int n, cap; } PathSet;</code> |
| `ps_add` | function | 1060 | <code>static void ps_add(PathSet &#42;p, const char &#42;path) {</code> |
| `man_diff_paths` | function | 1071 | <code>static void man_diff_paths(const Manifest &#42;a, const Manifest &#42;b, PathSet &#42;p) {</code> |
| `vcs_commits_for_path` | function | 1088 | <code>int vcs_commits_for_path(Cg &#42;cg, const char &#42;path, int limit, char &#42;&#42;&#42;ids,</code> |
| `vcs_find_commits` | function | 1139 | <code>int vcs_find_commits(Cg &#42;cg, const char &#42;needle, char &#42;&#42;&#42;ids, char &#42;&#42;&#42;msgs,</code> |
| `vcs_changed_paths` | function | 1170 | <code>int vcs_changed_paths(Cg &#42;cg, const char &#42;needle, char &#42;&#42;&#42;out) {</code> |
