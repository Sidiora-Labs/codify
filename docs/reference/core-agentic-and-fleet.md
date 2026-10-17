# Source reference: C core: agentic and fleet

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the fleet, the spec orchestrator and governance (`src/fleet.c`, `src/orchestrate.c`, `src/govern.c`), native agent sessions and agent drivers (`src/native.c`, `src/drivers.c`), agent integration and the Claude Code plugin (`src/integrate.c`, `src/plugin.c`), and the MCP, LSP and `serve` servers (`src/mcp.c`, `src/lsp.c`, `src/serve.c`): 735 declarations in 10 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## src/drivers.c

[Open source](../../src/drivers.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `split_into` | function | 29 | <code>static int split_into(const char &#42;s, char &#42;&#42;av, int n, int cap) {</code> |
| `subst` | function | 46 | <code>static char &#42;subst(const char &#42;tmpl, const DriverSpec &#42;d, const char &#42;pf,</code> |
| `driver_argv` | function | 74 | <code>int driver_argv(const DriverSpec &#42;d, const char &#42;root, const char &#42;promptfile,</code> |
| `raw_num` | function | 116 | <code>static double raw_num(const char &#42;obj, const char &#42;key, double dflt) {</code> |
| `raw_true` | function | 123 | <code>static bool raw_true(const char &#42;obj, const char &#42;key) {</code> |
| `tool_detail` | function | 132 | <code>static char &#42;tool_detail(const char &#42;input) {</code> |
| `emit_usage` | function | 142 | <code>static void emit_usage(DriverEventFn fn, void &#42;ud, const char &#42;usage,</code> |
| `parse_claude` | function | 157 | <code>static int parse_claude(const char &#42;line, const char &#42;type, DriverEventFn fn,</code> |
| `parse_codex` | function | 225 | <code>static int parse_codex(const char &#42;line, const char &#42;type, DriverEventFn fn,</code> |
| `driver_stream_parse` | function | 288 | <code>int driver_stream_parse(const char &#42;line, DriverEventFn fn, void &#42;ud) {</code> |
| `wall_ms` | function | 302 | <code>static long wall_ms(void) {</code> |
| `driver_tap_init` | function | 308 | <code>void driver_tap_init(DriverTap &#42;t, const char &#42;log, const char &#42;agent,</code> |
| `driver_tap_free` | function | 319 | <code>void driver_tap_free(DriverTap &#42;t) {</code> |
| `TAP_TEXT_MAX` | macro | 323 | <code>#define TAP_TEXT_MAX 600</code> |
| `TapCtx` | typedef | 325 | <code>typedef struct { DriverTap &#42;t; StrBuf &#42;batch; int n; } TapCtx;</code> |
| `clip` | function | 327 | <code>static void clip(StrBuf &#42;b, const char &#42;key, const char &#42;v) {</code> |
| `tap_on` | function | 343 | <code>static void tap_on(const DriverEvent &#42;e, void &#42;ud) {</code> |
| `driver_tap_poll` | function | 401 | <code>int driver_tap_poll(DriverTap &#42;t) {</code> |
| `driver_steer` | function | 448 | <code>long driver_steer(Cg &#42;cg, const char &#42;agent, const char &#42;message) {</code> |
| `SteerAcc` | typedef | 461 | <code>typedef struct { StrBuf &#42;b; long last; int n; } SteerAcc;</code> |
| `steer_add` | function | 463 | <code>static int steer_add(const EventRow &#42;e, void &#42;ud) {</code> |
| `driver_steer_take` | function | 477 | <code>char &#42;driver_steer_take(Cg &#42;cg, const char &#42;agent, const char &#42;via) {</code> |

## src/fleet.c

[Open source](../../src/fleet.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hf_decision_advice` | function | 20 | <code>extern int hf_decision_advice(int purpose, const char &#42;observation, char &#42;&#42;advice);</code> |
| `hf_advice_unit` | function | 21 | <code>extern int hf_advice_unit(const char &#42;obj, const char &#42;key, double &#42;out);</code> |
| `FleetIdentity` | typedef | 32 | <code>typedef struct {</code> |
| `fleet_identity` | function | 40 | <code>static void fleet_identity(FleetIdentity &#42;id) {</code> |
| `bind_opt` | function | 50 | <code>static void bind_opt(sqlite3_stmt &#42;st, int i, const char &#42;v) {</code> |
| `fleet_identity_record` | function | 60 | <code>int fleet_identity_record(Cg &#42;g) {</code> |
| `ROLE_NAMES` | variable | 92 | <code>static const char &#42;ROLE_NAMES&#91;FLEET_ROLES&#93; = { "main", "manager", "worker" };</code> |
| `role_sections` | function | 97 | <code>static int role_sections(int r, const char &#42;out&#91;2&#93;) {</code> |
| `role_set` | function | 103 | <code>static void role_set(FleetRole &#42;r, const char &#42;name, const char &#42;title,</code> |
| `hier_defaults` | function | 112 | <code>static void hier_defaults(Hierarchy &#42;h) {</code> |
| `take_str` | function | 130 | <code>static void take_str(char &#42;&#42;slot, const Kvx &#42;k, const char &#42;sec,</code> |
| `hier_duration` | function | 138 | <code>long hier_duration(const char &#42;s) {</code> |
| `hier_problem` | function | 155 | <code>static void hier_problem(Hierarchy &#42;h, const char &#42;fmt, const char &#42;role,</code> |
| `APPROVALS` | variable | 164 | <code>static const struct { const char &#42;name; unsigned bit; } APPROVALS&#91;&#93; = {</code> |
| `cap_raw` | function | 171 | <code>static char &#42;cap_raw(const Kvx &#42;wf, const char &#42;sec, const char &#42;key) {</code> |
| `cap_duration` | function | 184 | <code>static void cap_duration(Hierarchy &#42;h, const Kvx &#42;wf, const char &#42;sec,</code> |
| `cap_count` | function | 196 | <code>static void cap_count(Hierarchy &#42;h, const Kvx &#42;wf, const char &#42;sec,</code> |
| `role_caps_section` | function | 210 | <code>static void role_caps_section(Hierarchy &#42;h, const Kvx &#42;wf, int r,</code> |
| `hier_role_caps` | function | 216 | <code>void hier_role_caps(const Kvx &#42;wf, Hierarchy &#42;h) {</code> |
| `role_caps_section` | function | 266 | <code>static void role_caps_section(Hierarchy &#42;h, const Kvx &#42;wf, int r,</code> |
| `role_reset` | function | 320 | <code>static void role_reset(char &#42;&#42;slot, const char &#42;v) {</code> |
| `hier_old_shape` | function | 330 | <code>static void hier_old_shape(Hierarchy &#42;h, bool set&#91;FLEET_ROLES&#93;&#91;4&#93;) {</code> |
| `hier_load` | function | 357 | <code>bool hier_load(const Kvx &#42;wf, Hierarchy &#42;h) {</code> |
| `hier_free` | function | 411 | <code>void hier_free(Hierarchy &#42;h) {</code> |
| `hier_expand` | function | 426 | <code>void hier_expand(const Hierarchy &#42;h, const char &#42;tmpl, const char &#42;feature,</code> |
| `hier_per_task` | function | 431 | <code>bool hier_per_task(const Hierarchy &#42;h) {</code> |
| `hier_per_wave` | function | 435 | <code>bool hier_per_wave(const Hierarchy &#42;h) {</code> |
| `git_folds` | function | 441 | <code>static bool git_folds(void) {</code> |
| `hier_waves_parallel` | function | 450 | <code>bool hier_waves_parallel(const Kvx &#42;wf, char &#42;why, size_t cap) {</code> |
| `hier_manager_wave` | function | 468 | <code>long hier_manager_wave(const Hierarchy &#42;h, long wave) {</code> |
| `hier_expand_task` | function | 476 | <code>void hier_expand_task(const Hierarchy &#42;h, const char &#42;tmpl, const char &#42;feature,</code> |
| `fleet_workflow` | function | 510 | <code>static Kvx &#42;fleet_workflow(const Cg &#42;cg, char &#42;path, size_t cap) {</code> |
| `role_title` | function | 515 | <code>static const char &#42;role_title(const Hierarchy &#42;h, const char &#42;role) {</code> |
| `ago` | function | 525 | <code>static void ago(long seen, char &#42;out, size_t cap) {</code> |
| `fleet_brief` | function | 535 | <code>void fleet_brief(Cg &#42;cg, StrBuf &#42;b, bool json) {</code> |
| `gate_bit` | function | 570 | <code>static unsigned gate_bit(const char &#42;gate) {</code> |
| `approval_event` | function | 576 | <code>static void approval_event(Cg &#42;cg, const char &#42;kind, long id, const char &#42;gate,</code> |
| `fleet_gate` | function | 598 | <code>int fleet_gate(Cg &#42;cg, const char &#42;gate, const char &#42;subject) {</code> |
| `cmd_fleet_approvals` | function | 668 | <code>int cmd_fleet_approvals(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `C` | macro | 733 | <code>#define C(i) ((const char &#42;)sqlite3_column_text(st, i))</code> |
| `fmt_secs` | function | 768 | <code>static void fmt_secs(long s, char &#42;out, size_t cap) {</code> |
| `approvals` | function | 776 | <code>static void approvals(unsigned bits, char &#42;out, size_t cap, const char &#42;sep) {</code> |
| `fleet_roles` | function | 788 | <code>static int fleet_roles(Cg &#42;cg, bool json) {</code> |
| `agent_live_tasks` | function | 897 | <code>static char &#42;agent_live_tasks(Cg &#42;g, const char &#42;agent) {</code> |
| `fleet_status` | function | 913 | <code>static int fleet_status(Cg &#42;cg, bool json) {</code> |
| `PlanTask` | typedef | 1037 | <code>typedef struct { char &#42;id, &#42;title, &#42;status; long wave; } PlanTask;</code> |
| `plan_task_cmp` | function | 1039 | <code>static int plan_task_cmp(const void &#42;a, const void &#42;b) {</code> |
| `LiveAgent` | typedef | 1047 | <code>typedef struct { char &#42;agent; long wave; char &#42;role; char &#42;task; } LiveAgent;</code> |
| `live_add` | function | 1049 | <code>static void live_add(LiveAgent &#42;&#42;v, int &#42;n, int &#42;cap, const char &#42;agent,</code> |
| `live_names` | function | 1067 | <code>static void live_names(const LiveAgent &#42;v, int n, const char &#42;role,</code> |
| `fleet_plan` | function | 1087 | <code>static int fleet_plan(Cg &#42;cg, const char &#42;feature_ov, bool json) {</code> |
| `Lifecycle` | typedef | 1339 | <code>typedef struct {</code> |
| `lifecycle_close` | function | 1351 | <code>static void lifecycle_close(Lifecycle &#42;c) {</code> |
| `fleet_merge_lock` | function | 1359 | <code>int fleet_merge_lock(const char &#42;shared, const char &#42;feature, long wait_ms) {</code> |
| `fleet_merge_unlock` | function | 1376 | <code>void fleet_merge_unlock(int fd) {</code> |
| `lifecycle_merge_lock` | function | 1383 | <code>static int lifecycle_merge_lock(Lifecycle &#42;c) {</code> |
| `lifecycle_open` | function | 1393 | <code>static int lifecycle_open(Cg &#42;cg, const char &#42;feature_ov, Lifecycle &#42;c) {</code> |
| `worktree_path` | function | 1435 | <code>static void worktree_path(const Lifecycle &#42;c, const char &#42;branch, char &#42;out,</code> |
| `task_wave_status` | function | 1450 | <code>static bool task_wave_status(const char &#42;specpath, const char &#42;id, long &#42;wave,</code> |
| `task_status_on_branch` | function | 1469 | <code>static bool task_status_on_branch(const Lifecycle &#42;c, const char &#42;branch,</code> |
| `tree_clean` | function | 1494 | <code>static bool tree_clean(const char &#42;tree) {</code> |
| `commits_between` | function | 1504 | <code>static long commits_between(const char &#42;tree, const char &#42;base,</code> |
| `ensure_branch` | function | 1521 | <code>static bool ensure_branch(const char &#42;tree, const char &#42;branch,</code> |
| `excerpt` | function | 1537 | <code>static void excerpt(const StrBuf &#42;b, char &#42;out, size_t cap) {</code> |
| `json_str_or_null` | function | 1547 | <code>static void json_str_or_null(StrBuf &#42;b, const char &#42;s) {</code> |
| `put_conflicts` | function | 1551 | <code>static void put_conflicts(StrBuf &#42;b, char &#42;&#42;paths, int n, bool json) {</code> |
| `free_list` | function | 1565 | <code>static void free_list(char &#42;&#42;v, int n) {</code> |
| `fleet_event` | function | 1571 | <code>static void fleet_event(Cg &#42;cg, const char &#42;kind, const char &#42;subject,</code> |
| `ev_str` | function | 1580 | <code>static void ev_str(StrBuf &#42;b, const char &#42;key, const char &#42;v) {</code> |
| `ev_long` | function | 1585 | <code>static void ev_long(StrBuf &#42;b, const char &#42;key, long v) {</code> |
| `fleet_worker_begin` | function | 1592 | <code>int fleet_worker_begin(Cg &#42;cg, const char &#42;id, const char &#42;feature_ov,</code> |
| `fleet_worker_begin_ex` | function | 1597 | <code>int fleet_worker_begin_ex(Cg &#42;cg, const char &#42;id, const char &#42;feature_ov,</code> |
| `ev_list` | function | 1733 | <code>static void ev_list(StrBuf &#42;b, const char &#42;key, char &#42;&#42;v, int n) {</code> |
| `merge_event` | function | 1742 | <code>static void merge_event(Cg &#42;cg, const Lifecycle &#42;c, const char &#42;id,</code> |
| `fleet_merge_up` | function | 1765 | <code>int fleet_merge_up(Cg &#42;cg, const char &#42;id, const char &#42;feature_ov, bool force,</code> |
| `run_gate` | function | 1971 | <code>static int run_gate(const char &#42;tree, const char &#42;cmd, const char &#42;logpath,</code> |
| `pr_open_core` | function | 1998 | <code>static int pr_open_core(Cg &#42;cg, Lifecycle &#42;c, bool dry_run, StrBuf &#42;jb,</code> |
| `pr_event` | function | 2001 | <code>static void pr_event(Cg &#42;cg, const Lifecycle &#42;c, const char &#42;outcome,</code> |
| `land_event` | function | 2014 | <code>static void land_event(Cg &#42;cg, const Lifecycle &#42;c, const char &#42;outcome,</code> |
| `lifecycle_subject` | function | 2031 | <code>static void lifecycle_subject(const Lifecycle &#42;c, char &#42;out, size_t cap) {</code> |
| `lifecycle_branch` | function | 2037 | <code>static void lifecycle_branch(const Lifecycle &#42;c, char &#42;out, size_t cap) {</code> |
| `spec_on_branch` | function | 2043 | <code>static Kvx &#42;spec_on_branch(const Lifecycle &#42;c, const char &#42;branch) {</code> |
| `wave_open_tasks` | function | 2067 | <code>static int wave_open_tasks(const Lifecycle &#42;c, long wave, const char &#42;branch,</code> |
| `lifecycle_target` | function | 2106 | <code>static int lifecycle_target(Lifecycle &#42;c, const char &#42;what, const char &#42;verb) {</code> |
| `fleet_feature_land` | function | 2156 | <code>int fleet_feature_land(Cg &#42;cg, const char &#42;feature_ov, bool no_pr, bool json) {</code> |
| `names_wave_or_task` | function | 2168 | <code>static bool names_wave_or_task(const char &#42;s) {</code> |
| `fleet_land` | function | 2175 | <code>int fleet_land(Cg &#42;cg, const char &#42;what, const char &#42;feature_ov, bool no_pr,</code> |
| `find_gh` | function | 2423 | <code>static bool find_gh(char &#42;out, size_t cap) {</code> |
| `run_in` | function | 2429 | <code>static int run_in(const char &#42;tree, const char &#42;cmd, StrBuf &#42;out) {</code> |
| `write_pr_body` | function | 2457 | <code>static void write_pr_body(Cg &#42;cg, const Lifecycle &#42;c, const char &#42;branch,</code> |
| `pr_open_core` | function | 2553 | <code>static int pr_open_core(Cg &#42;cg, Lifecycle &#42;c, bool dry_run, StrBuf &#42;jb,</code> |
| `fleet_pr_open` | function | 2697 | <code>int fleet_pr_open(Cg &#42;cg, const char &#42;feature_ov, bool dry_run, bool json) {</code> |
| `OpenPr` | typedef | 2732 | <code>typedef struct { long number; char &#42;head, &#42;title, &#42;url; } OpenPr;</code> |
| `fleet_checkpoint` | function | 2738 | <code>int fleet_checkpoint(Cg &#42;cg, bool dry_run, bool json) {</code> |
| `ProjRebuild` | typedef | 2921 | <code>typedef struct { Cg &#42;cg; } ProjRebuild;</code> |
| `proj_rebuild_run` | function | 2923 | <code>static int proj_rebuild_run(void &#42;ctx) {</code> |
| `fleet_projection_rebuild` | function | 2931 | <code>int fleet_projection_rebuild(Cg &#42;cg, char &#42;line, size_t cap) {</code> |
| `git_lines` | function | 2949 | <code>static int git_lines(const char &#42;tree, const char &#42;args, char &#42;&#42;&#42;out,</code> |
| `sync_base` | function | 2972 | <code>static void sync_base(Cg &#42;cg, const char &#42;branch, const char &#42;flag, char &#42;out,</code> |
| `fleet_sync` | function | 2993 | <code>int fleet_sync(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `cmd_fleet` | function | 3188 | <code>int cmd_fleet(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |

## src/govern.c

[Open source](../../src/govern.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hf_client_authority_guard` | function | 2 | <code>extern int hf_client_authority_guard(const char &#42;operation, FILE &#42;output);</code> |
| `hf_decision_advice` | function | 3 | <code>extern int hf_decision_advice(int purpose, const char &#42;observation, char &#42;&#42;advice); /&#42; 21.3, recap.c &#42;/</code> |
| `run_capture` | function | 25 | <code>static int run_capture(char &#42;&#42;out, int (&#42;fn)(void &#42;), void &#42;ctx) {</code> |
| `SpecCall` | typedef | 29 | <code>typedef struct { int argc; char &#42;&#42;argv; bool json; } SpecCall;</code> |
| `call_spec` | function | 31 | <code>static int call_spec(void &#42;v) {</code> |
| `spec_sub` | function | 44 | <code>static int spec_sub(char &#42;&#42;out, bool json, int argc, ...) {</code> |
| `has_spec_repo` | function | 54 | <code>static bool has_spec_repo(const char &#42;root) {</code> |
| `lease_touches_overlap` | function | 63 | <code>static bool lease_touches_overlap(const char &#42;a, const char &#42;b) {</code> |
| `cmd_check` | function | 81 | <code>int cmd_check(Cg &#42;cg, bool json, bool strict)</code> |
| `active_task_json` | function | 318 | <code>static char &#42;active_task_json(bool &#42;is_current) {</code> |
| `brief_cap_body` | function | 332 | <code>static void brief_cap_body(Memory &#42;m) {</code> |
| `brief_memories` | function | 346 | <code>static int brief_memories(Cg &#42;cg, const char &#42;task_json, Memory &#42;&#42;out) {</code> |
| `brief_branches` | function | 392 | <code>static void brief_branches(Cg &#42;cg, StrBuf &#42;b, bool json) {</code> |
| `brief_feature` | function | 451 | <code>static char &#42;brief_feature(Cg &#42;cg, const char &#42;task_json) {</code> |
| `cmd_brief` | function | 464 | <code>int cmd_brief(Cg &#42;cg, bool json)</code> |
| `path_in_scope` | function | 599 | <code>static bool path_in_scope(const char &#42;task_json, const char &#42;path) {</code> |
| `GuardStale` | typedef | 630 | <code>typedef struct {</code> |
| `guard_stale_cb` | function | 638 | <code>static void guard_stale_cb(void &#42;u, const char &#42;path, int line,</code> |
| `guard_collect` | function | 661 | <code>static void guard_collect(JevFinding &#42;&#42;v, int &#42;n, int &#42;cap, const char &#42;kind,</code> |
| `guard_decision_rank` | function | 681 | <code>static int guard_decision_rank(JevFinding &#42;v, int n) {</code> |
| `cmd_guard` | function | 726 | <code>int cmd_guard(Cg &#42;cg, int npath, char &#42;&#42;pathv, bool json, bool strict)</code> |
| `cmd_review` | function | 883 | <code>int cmd_review(Cg &#42;cg, bool json)</code> |
| `cmd_hook_install_git` | function | 1054 | <code>static int cmd_hook_install_git(Cg &#42;cg, const char &#42;bin);</code> |
| `write_exec` | function | 1056 | <code>static int write_exec(const char &#42;path, const char &#42;body) {</code> |
| `cmd_hook_install` | function | 1087 | <code>int cmd_hook_install(Cg &#42;cg)</code> |
| `cmd_hook_install_git` | function | 1136 | <code>static int cmd_hook_install_git(Cg &#42;cg, const char &#42;bin)</code> |
| `hook_read_stdin` | function | 1186 | <code>static char &#42;hook_read_stdin(void) {</code> |
| `hook_edited_path` | function | 1199 | <code>static char &#42;hook_edited_path(const char &#42;payload) {</code> |
| `HookGuard` | typedef | 1210 | <code>typedef struct { Cg &#42;cg; char &#42;path; bool json; } HookGuard;</code> |
| `hook_guard_call` | function | 1212 | <code>static int hook_guard_call(void &#42;u) {</code> |
| `HOOK_MAX_LINES` | macro | 1218 | <code>#define HOOK_MAX_LINES 24</code> |
| `cmd_hook_post_edit` | function | 1227 | <code>int cmd_hook_post_edit(Cg &#42;cg, const SysInfo &#42;si, bool json) {</code> |
| `SA_MAXTOK` | macro | 1317 | <code>#define SA_MAXTOK 128</code> |
| `SA_MAXSEG` | macro | 1318 | <code>#define SA_MAXSEG 32</code> |
| `SaSeg` | typedef | 1320 | <code>typedef struct {</code> |
| `SaCtx` | typedef | 1327 | <code>typedef struct {</code> |
| `SaList` | typedef | 1336 | <code>typedef struct {</code> |
| `sa_seg_free` | function | 1343 | <code>static void sa_seg_free(SaSeg &#42;s) {</code> |
| `sa_flush` | function | 1348 | <code>static void sa_flush(SaSeg &#42;s, StrBuf &#42;t, bool &#42;have, bool &#42;dyn) {</code> |
| `sa_split` | function | 1361 | <code>static int sa_split(const char &#42;cmd, SaSeg &#42;seg, int max) {</code> |
| `sa_rel` | function | 1417 | <code>static bool sa_rel(SaCtx &#42;x, const char &#42;operand, bool dyn, char &#42;rel,</code> |
| `sa_path` | function | 1454 | <code>static bool sa_path(SaCtx &#42;x, const char &#42;operand, bool dyn, char &#42;rel,</code> |
| `sa_quote` | function | 1461 | <code>static void sa_quote(StrBuf &#42;b, const char &#42;s) {</code> |
| `sa_suggest` | function | 1475 | <code>static void sa_suggest(SaCtx &#42;x, const char &#42;line) {</code> |
| `sa_base` | function | 1482 | <code>static const char &#42;sa_base(const char &#42;w) {</code> |
| `sa_tool` | function | 1487 | <code>static int sa_tool(const char &#42;w) {      /&#42; 1 grep-like, 2 find, 3 fd, 4 ls &#42;/</code> |
| `sa_find` | function | 1498 | <code>static void sa_find(SaCtx &#42;x, SaSeg &#42;s, int a, SaList &#42;l) {</code> |
| `sa_fd` | function | 1528 | <code>static void sa_fd(SaCtx &#42;x, SaSeg &#42;s, int a, SaList &#42;l) {</code> |
| `sa_files_line` | function | 1572 | <code>static void sa_files_line(SaCtx &#42;x, const SaList &#42;l) {</code> |
| `sa_grep` | function | 1593 | <code>static void sa_grep(SaCtx &#42;x, SaSeg &#42;s, int a, const SaList &#42;prev,</code> |
| `sa_prefix_word` | function | 1726 | <code>static bool sa_prefix_word(const char &#42;w) {</code> |
| `shell_advice_for` | function | 1732 | <code>char &#42;shell_advice_for(const char &#42;root, const char &#42;cwd, const char &#42;cmd) {</code> |
| `sa_env_off` | function | 1887 | <code>static bool sa_env_off(void) {</code> |
| `cmd_hook_pre_bash` | function | 1901 | <code>int cmd_hook_pre_bash(Cg &#42;cg, bool json) {</code> |
| `HANDOFF_KEYS` | variable | 1962 | <code>static const char &#42;HANDOFF_KEYS&#91;&#93; = { "done", "next", "blocked", "note",</code> |
| `handoff_field` | function | 1966 | <code>static char &#42;handoff_field(const char &#42;body, const char &#42;key) {</code> |
| `handoff_live_id` | function | 1987 | <code>static long handoff_live_id(Cg &#42;cg, const char &#42;tag) {</code> |
| `handoff_store` | function | 2001 | <code>static long handoff_store(Cg &#42;cg, const char &#42;tag, const char &#42;body,</code> |
| `handoff_files` | function | 2013 | <code>static char &#42;handoff_files(Cg &#42;cg, int cap, int &#42;count) {</code> |
| `cmd_handoff` | function | 2030 | <code>int cmd_handoff(Cg &#42;cg, const char &#42;task, const char &#42;done, const char &#42;next,</code> |
| `resume_json_field` | function | 2120 | <code>static void resume_json_field(StrBuf &#42;b, const char &#42;name, const char &#42;v) {</code> |
| `cmd_resume` | function | 2131 | <code>int cmd_resume(Cg &#42;cg, const char &#42;task, bool json, bool prompt)</code> |
| `WorkCapture` | typedef | 2352 | <code>typedef struct { Cg &#42;cg; const char &#42;query; } WorkCapture;</code> |
| `work_call_state` | function | 2353 | <code>static int work_call_state(void &#42;v) {</code> |
| `work_call_progress` | function | 2356 | <code>static int work_call_progress(void &#42;v) {</code> |
| `work_call_context` | function | 2359 | <code>static int work_call_context(void &#42;v) {</code> |
| `work_call_tests` | function | 2363 | <code>static int work_call_tests(void &#42;v) {</code> |
| `work_raw_json` | function | 2368 | <code>static void work_raw_json(StrBuf &#42;b, const char &#42;raw) {</code> |
| `work_last_event` | function | 2377 | <code>static long work_last_event(Cg &#42;cg, const char &#42;task) {</code> |
| `work_event_json` | function | 2387 | <code>static void work_event_json(Cg &#42;cg, StrBuf &#42;b, const char &#42;task, long after,</code> |
| `work_memories_json` | function | 2425 | <code>static void work_memories_json(Cg &#42;cg, StrBuf &#42;b, const char &#42;task) {</code> |
| `work_revision_store` | function | 2442 | <code>static void work_revision_store(Cg &#42;cg, const char &#42;revision, long created,</code> |
| `work_revision_create` | function | 2486 | <code>static bool work_revision_create(Cg &#42;cg, const char &#42;task, long event_id,</code> |
| `work_open` | function | 2534 | <code>int work_open(Cg &#42;cg, const char &#42;task, bool json) {</code> |
| `work_workspace_delta` | function | 2601 | <code>static void work_workspace_delta(Cg &#42;cg, StrBuf &#42;b, const char &#42;revision,</code> |
| `packet_list` | function | 2625 | <code>static int packet_list(const char &#42;packet, const char &#42;key, char &#42;&#42;&#42;out);</code> |
| `list_free` | function | 2626 | <code>static void list_free(char &#42;&#42;v, int n);</code> |
| `packet_scope` | function | 2627 | <code>static long packet_scope(Cg &#42;cg);</code> |
| `work_upstream_delta` | function | 2632 | <code>static int work_upstream_delta(Cg &#42;cg, const char &#42;task, long since_s,</code> |
| `work_update` | function | 2705 | <code>int work_update(Cg &#42;cg, const char &#42;revision, bool json) {</code> |
| `work_supplied_evidence` | function | 2795 | <code>static const char &#42;work_supplied_evidence(const char &#42;clause, int n,</code> |
| `work_recorded_evidence` | function | 2804 | <code>static char &#42;work_recorded_evidence(Cg &#42;cg, const char &#42;task,</code> |
| `work_close` | function | 2843 | <code>int work_close(Cg &#42;cg, const char &#42;requested, int nevidence, char &#42;&#42;evidence,</code> |
| `govern_journal_apply` | function | 2945 | <code>int govern_journal_apply(Cg &#42;cg, const char &#42;op, const char &#42;args,</code> |
| `cmd_work` | function | 3012 | <code>int cmd_work(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `packet_list` | function | 3034 | <code>static int packet_list(const char &#42;packet, const char &#42;key, char &#42;&#42;&#42;out) {</code> |
| `list_free` | function | 3049 | <code>static void list_free(char &#42;&#42;v, int n) {</code> |
| `packet_scope` | function | 3057 | <code>static long packet_scope(Cg &#42;cg) {</code> |
| `packet_upstream_evidence` | function | 3070 | <code>int packet_upstream_evidence(Cg &#42;cg, const char &#42;feature, const char &#42;req,</code> |
| `PacketPart` | typedef | 3111 | <code>typedef struct { const char &#42;name; StrBuf b; bool must; } PacketPart;</code> |
| `packet_assemble` | function | 3116 | <code>static int packet_assemble(PacketPart &#42;parts, int n, int budget, StrBuf &#42;out) {</code> |
| `task_packet_build` | function | 3145 | <code>int task_packet_build(Cg &#42;cg, const char &#42;tag, int budget, StrBuf &#42;out) {</code> |
| `manager_packet_build` | function | 3300 | <code>int manager_packet_build(Cg &#42;cg, const char &#42;feature, int budget, StrBuf &#42;out) {</code> |

## src/integrate.c

[Open source](../../src/integrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hf_client_authority_guard` | function | 2 | <code>extern int hf_client_authority_guard(const char &#42;operation, FILE &#42;output);</code> |
| `hyperfide_owned_write` | function | 10 | <code>extern int hyperfide_owned_write(const char &#42;,const char &#42;,size_t,const char &#42;,bool);</code> |
| `ConfigKind` | typedef | 17 | <code>typedef enum { CFG_JSON, CFG_VSCODE, CFG_TOML } ConfigKind;</code> |
| `Adapter` | typedef | 19 | <code>typedef struct {</code> |
| `ADAPTERS` | variable | 25 | <code>static const Adapter ADAPTERS&#91;&#93; = {</code> |
| `NADAPTERS` | macro | 52 | <code>#define NADAPTERS ((int)(sizeof ADAPTERS / sizeof ADAPTERS&#91;0&#93;))</code> |
| `ConfigState` | typedef | 54 | <code>typedef struct {</code> |
| `integrate_self` | function | 59 | <code>void integrate_self(char out&#91;4096&#93;) {</code> |
| `integrate_path` | function | 67 | <code>static void integrate_path(const Cg &#42;cg, const char &#42;tmpl, char out&#91;4700&#93;) {</code> |
| `json_balanced` | function | 81 | <code>static bool json_balanced(const char &#42;s) {</code> |
| `protocol_supported` | function | 100 | <code>static bool protocol_supported(const char &#42;v) {</code> |
| `integrate_config_state` | function | 106 | <code>static ConfigState integrate_config_state(const Adapter &#42;a,</code> |
| `integrate_action` | function | 136 | <code>static const char &#42;integrate_action(const ConfigState &#42;s) {</code> |
| `ensure_parent` | function | 143 | <code>static int ensure_parent(const char &#42;path) {</code> |
| `backup_existing` | function | 152 | <code>static int backup_existing(const char &#42;path,const char &#42;body) {</code> |
| `integrate_entry` | function | 177 | <code>static char &#42;integrate_entry(const char &#42;bin, bool vscode) {</code> |
| `integrate_json_apply` | function | 186 | <code>static int integrate_json_apply(const Adapter &#42;a, const char &#42;path,</code> |
| `integrate_toml_apply` | function | 232 | <code>static int integrate_toml_apply(const char &#42;path, const char &#42;bin) {</code> |
| `SHIM_HOSTS` | variable | 275 | <code>static const char &#42;SHIM_HOSTS&#91;&#93; = {</code> |
| `asset_state` | function | 279 | <code>static const char &#42;asset_state(const char &#42;path, const char &#42;marker) {</code> |
| `apply_asset` | function | 288 | <code>static int apply_asset(const char &#42;path, const char &#42;body, bool executable) {</code> |
| `integrate_skill_body` | function | 300 | <code>const char &#42;integrate_skill_body(void) { return SKILL_BODY; }</code> |
| `integrate_skip_plugin` | function | 304 | <code>void integrate_skip_plugin(bool skip) { skip_plugin = skip; }</code> |
| `integrate_plugin_apply` | function | 311 | <code>static void integrate_plugin_apply(Cg &#42;cg, const char &#42;bin, bool json,</code> |
| `integrate_plugin_report` | function | 357 | <code>static void integrate_plugin_report(Cg &#42;cg, bool json, StrBuf &#42;b) {</code> |
| `host_shim_body` | function | 382 | <code>static char &#42;host_shim_body(const char &#42;host) {</code> |
| `IntegrateAgentmd` | typedef | 389 | <code>typedef struct { Cg &#42;cg; } IntegrateAgentmd;</code> |
| `integrate_agentmd_call` | function | 390 | <code>static int integrate_agentmd_call(void &#42;v) {</code> |
| `integrate_agent_context` | function | 399 | <code>static int integrate_agent_context(Cg &#42;cg) {</code> |
| `integrate_apply_portable` | function | 426 | <code>int integrate_apply_portable(Cg &#42;cg, bool quiet) {</code> |
| `adapter_json` | function | 452 | <code>static void adapter_json(const Adapter &#42;a, const char &#42;path,</code> |
| `integrate_plan` | function | 470 | <code>int integrate_plan(Cg &#42;cg, bool json) {</code> |
| `integrate_apply` | function | 532 | <code>int integrate_apply(Cg &#42;cg, bool json) {</code> |
| `doctor_find` | function | 584 | <code>static void doctor_find(StrBuf &#42;findings, int &#42;n, bool json,</code> |
| `integrate_doctor` | function | 600 | <code>int integrate_doctor(Cg &#42;cg, bool json) {</code> |
| `integrate_detect` | function | 716 | <code>static int integrate_detect(Cg &#42;cg, bool json) {</code> |
| `cmd_integrate` | function | 749 | <code>int cmd_integrate(Cg &#42;cg, const char &#42;action, bool json, bool compatibility) {</code> |

## src/lsp.c

[Open source](../../src/lsp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LSP_KIND_FN` | macro | 22 | <code>#define LSP_KIND_FN 12</code> |
| `LSP_LOCK_WAIT_MS` | macro | 29 | <code>#define LSP_LOCK_WAIT_MS 1500</code> |
| `LSP_INDEX_RETRY_MS` | macro | 30 | <code>#define LSP_INDEX_RETRY_MS 3000</code> |
| `LSP_FRESH_MS` | macro | 31 | <code>#define LSP_FRESH_MS 3000</code> |
| `lsp_index` | function | 40 | <code>static void lsp_index(Cg &#42;cg, const SysInfo &#42;si, const char &#42;abs) {</code> |
| `lsp_read` | function | 70 | <code>static char &#42;lsp_read(void) {</code> |
| `lsp_send` | function | 89 | <code>static void lsp_send(const char &#42;payload) {</code> |
| `lsp_reply` | function | 94 | <code>static void lsp_reply(const char &#42;id, const char &#42;result) {</code> |
| `lsp_notify` | function | 101 | <code>static void lsp_notify(const char &#42;method, const char &#42;params) {</code> |
| `uri_to_path` | function | 111 | <code>static void uri_to_path(const char &#42;uri, char &#42;out, size_t cap) {</code> |
| `path_to_uri` | function | 127 | <code>static void path_to_uri(const char &#42;root, const char &#42;rel, StrBuf &#42;b) {</code> |
| `rel_of` | function | 135 | <code>static const char &#42;rel_of(const Cg &#42;cg, const char &#42;abs) {</code> |
| `emit_location` | function | 143 | <code>static void emit_location(Cg &#42;cg, StrBuf &#42;b, const char &#42;path, int line,</code> |
| `word_at` | function | 156 | <code>static bool word_at(const char &#42;abs, int line0, int chr, char &#42;out, size_t cap) {</code> |
| `lsp_hover` | function | 182 | <code>void lsp_hover(Cg &#42;cg, const char &#42;name, StrBuf &#42;md) {</code> |
| `diag_add` | function | 224 | <code>static void diag_add(StrBuf &#42;b, int &#42;n, int line, int severity,</code> |
| `lsp_path_in_task_scope` | function | 238 | <code>bool lsp_path_in_task_scope(Cg &#42;cg, const char &#42;rel) {</code> |
| `lsp_diagnostics` | function | 258 | <code>void lsp_diagnostics(Cg &#42;cg, const char &#42;abs, StrBuf &#42;out) {</code> |
| `publish_diagnostics` | function | 311 | <code>static void publish_diagnostics(Cg &#42;cg, const char &#42;uri, const char &#42;abs) {</code> |
| `request_word` | function | 324 | <code>static bool request_word(Cg &#42;cg, const char &#42;params, char &#42;word, size_t wcap,</code> |
| `cmd_lsp` | function | 345 | <code>int cmd_lsp(Cg &#42;cg, const SysInfo &#42;si) {</code> |

## src/mcp.c

[Open source](../../src/mcp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hf_client_authority_guard` | function | 2 | <code>extern int hf_client_authority_guard(const char &#42;operation, FILE &#42;output);</code> |
| `CallCtx` | typedef | 26 | <code>typedef struct {</code> |
| `mcp_filter` | function | 35 | <code>static void mcp_filter(const CallCtx &#42;c, QueryFilter &#42;f) {</code> |
| `t_search` | function | 71 | <code>static int t_search(void &#42;v) {</code> |
| `t_context` | function | 89 | <code>static int t_context(void &#42;v) {</code> |
| `t_files` | function | 114 | <code>static int t_files(void &#42;v) {</code> |
| `t_survey` | function | 142 | <code>static int t_survey(void &#42;v) {</code> |
| `t_anchors` | function | 151 | <code>static int t_anchors(void &#42;v) {</code> |
| `t_symbol` | function | 160 | <code>static int t_symbol(void &#42;v) {</code> |
| `t_impact` | function | 168 | <code>static int t_impact(void &#42;v) {</code> |
| `t_flow` | function | 182 | <code>static int t_flow(void &#42;v) {</code> |
| `t_inspect_hierarchy` | function | 198 | <code>static int t_inspect_hierarchy(void &#42;v) {</code> |
| `t_inspect_unreferenced` | function | 207 | <code>static int t_inspect_unreferenced(void &#42;v) {</code> |
| `t_routes` | function | 215 | <code>static int t_routes(void &#42;v) {</code> |
| `t_status` | function | 222 | <code>static int t_status(void &#42;v)  { CallCtx &#42;c = v; return answer_health_status(c-&gt;cg, true); }</code> |
| `t_index_status` | function | 223 | <code>static int t_index_status(void &#42;v) {</code> |
| `t_state` | function | 230 | <code>static int t_state(void &#42;v)   { CallCtx &#42;c = v; return cmd_state(c-&gt;cg, true); }</code> |
| `t_projection_status` | function | 232 | <code>static int t_projection_status(void &#42;v) {</code> |
| `t_integrate` | function | 237 | <code>static int t_integrate(void &#42;v) {</code> |
| `t_event_ingest` | function | 244 | <code>static int t_event_ingest(void &#42;v) {</code> |
| `t_event_history` | function | 255 | <code>static int t_event_history(void &#42;v) {</code> |
| `t_progress` | function | 262 | <code>static int t_progress(void &#42;v) {</code> |
| `t_work_open` | function | 266 | <code>static int t_work_open(void &#42;v) {</code> |
| `t_work_update` | function | 273 | <code>static int t_work_update(void &#42;v) {</code> |
| `t_work_close` | function | 281 | <code>static int t_work_close(void &#42;v) {</code> |
| `t_changes` | function | 295 | <code>static int t_changes(void &#42;v) {</code> |
| `t_log` | function | 300 | <code>static int t_log(void &#42;v) {</code> |
| `t_commit` | function | 305 | <code>static int t_commit(void &#42;v) {</code> |
| `fold_stderr` | function | 317 | <code>static int fold_stderr(void) {</code> |
| `unfold_stderr` | function | 323 | <code>static void unfold_stderr(int saved) {</code> |
| `run_spec` | function | 329 | <code>static int run_spec(int argc, char &#42;&#42;argv, bool json) {</code> |
| `t_spec_status` | function | 336 | <code>static int t_spec_status(void &#42;v) {</code> |
| `t_spec_reconcile` | function | 341 | <code>static int t_spec_reconcile(void &#42;v) {</code> |
| `t_spec_next` | function | 350 | <code>static int t_spec_next(void &#42;v) {</code> |
| `t_spec_start` | function | 355 | <code>static int t_spec_start(void &#42;v) {</code> |
| `t_spec_mode` | function | 364 | <code>static int t_spec_mode(void &#42;v) {</code> |
| `t_spec_implemented` | function | 373 | <code>static int t_spec_implemented(void &#42;v) {</code> |
| `t_spec_done` | function | 388 | <code>static int t_spec_done(void &#42;v) {</code> |
| `t_spec_render` | function | 400 | <code>static int t_spec_render(void &#42;v) {</code> |
| `t_spec_trace` | function | 408 | <code>static int t_spec_trace(void &#42;v) {</code> |
| `t_docs` | function | 417 | <code>static int t_docs(void &#42;v, const char &#42;action) {</code> |
| `t_docs_status` | function | 422 | <code>static int t_docs_status(void &#42;v) { return t_docs(v, "status"); }</code> |
| `t_docs_plan` | function | 423 | <code>static int t_docs_plan(void &#42;v)   { return t_docs(v, "plan"); }</code> |
| `t_docs_packet` | function | 424 | <code>static int t_docs_packet(void &#42;v) { return t_docs(v, "packet"); }</code> |
| `t_docs_check` | function | 425 | <code>static int t_docs_check(void &#42;v)  { return t_docs(v, "check"); }</code> |
| `t_docs_trace` | function | 426 | <code>static int t_docs_trace(void &#42;v)  { return t_docs(v, "trace"); }</code> |
| `t_docs_close` | function | 427 | <code>static int t_docs_close(void &#42;v)  { return t_docs(v, "close"); }</code> |
| `t_remember` | function | 428 | <code>static int t_remember(void &#42;v) {</code> |
| `t_recall` | function | 441 | <code>static int t_recall(void &#42;v) {</code> |
| `t_memory_export` | function | 451 | <code>static int t_memory_export(void &#42;v) {</code> |
| `t_memory_import` | function | 469 | <code>static int t_memory_import(void &#42;v) {</code> |
| `t_show` | function | 499 | <code>static int t_show(void &#42;v) {</code> |
| `t_why` | function | 510 | <code>static int t_why(void &#42;v) {</code> |
| `t_test_impact` | function | 518 | <code>static int t_test_impact(void &#42;v) {</code> |
| `t_brief` | function | 525 | <code>static int t_brief(void &#42;v)  { CallCtx &#42;c = v; return cmd_brief(c-&gt;cg, true); }</code> |
| `t_review` | function | 526 | <code>static int t_review(void &#42;v) { CallCtx &#42;c = v; return cmd_review(c-&gt;cg, true); }</code> |
| `t_check` | function | 527 | <code>static int t_check(void &#42;v)  { CallCtx &#42;c = v; return cmd_check(c-&gt;cg, true, false); }</code> |
| `t_guard` | function | 528 | <code>static int t_guard(void &#42;v) {</code> |
| `t_git_sync` | function | 536 | <code>static int t_git_sync(void &#42;v) {</code> |
| `t_spec_wave` | function | 541 | <code>static int t_spec_wave(void &#42;v) {</code> |
| `t_spec_lint` | function | 546 | <code>static int t_spec_lint(void &#42;v) {</code> |
| `t_spec_new` | function | 551 | <code>static int t_spec_new(void &#42;v) {</code> |
| `t_spec_add` | function | 560 | <code>static int t_spec_add(void &#42;v) {</code> |
| `t_spec_claim` | function | 591 | <code>static int t_spec_claim(void &#42;v) {</code> |
| `t_spec_release` | function | 606 | <code>static int t_spec_release(void &#42;v) {</code> |
| `t_spec_ready` | function | 621 | <code>static int t_spec_ready(void &#42;v) {</code> |
| `t_spec_claim_next` | function | 626 | <code>static int t_spec_claim_next(void &#42;v) {</code> |
| `t_handoff` | function | 639 | <code>static int t_handoff(void &#42;v) {</code> |
| `t_resume` | function | 652 | <code>static int t_resume(void &#42;v) {</code> |
| `t_memory_classify` | function | 663 | <code>static int t_memory_classify(void &#42;v) {</code> |
| `t_skills_list` | function | 673 | <code>static int t_skills_list(void &#42;v) {</code> |
| `t_skills_promote` | function | 678 | <code>static int t_skills_promote(void &#42;v) {</code> |
| `t_codemap` | function | 689 | <code>static int t_codemap(void &#42;v) {</code> |
| `S_QFILTER` | macro | 700 | <code>#define S_QFILTER "&#92;"path&#92;":{&#92;"type&#92;":&#91;&#92;"string&#92;",&#92;"array&#92;"&#93;,&#92;"items&#92;":" &#92;</code> |
| `S_QUERY` | macro | 708 | <code>#define S_QUERY  "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"query&#92;":{&#92;"type&#92;":&#92;"string&#92;"}," &#92;</code> |
| `S_CTX` | macro | 711 | <code>#define S_CTX    "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"query&#92;":{&#92;"type&#92;":&#92;"string&#92;"}," &#92;</code> |
| `go` | macro | 715 | <code>#define S_FILES  "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"pattern&#92;":{&#92;"type&#92;":" &#92;</code> |
| `S_SURVEY` | macro | 724 | <code>#define S_SURVEY "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"scope&#92;":{&#92;"type&#92;":" &#92;</code> |
| `S_ANCHORS` | macro | 728 | <code>#define S_ANCHORS "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"stale&#92;":{&#92;"type&#92;":" &#92;</code> |
| `S_NAME` | macro | 732 | <code>#define S_NAME   "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"name&#92;":{&#92;"type&#92;":&#92;"string&#92;"}}," &#92;</code> |
| `S_IMPACT` | macro | 734 | <code>#define S_IMPACT "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"name&#92;":{&#92;"type&#92;":&#92;"string&#92;"}," &#92;</code> |
| `S_FLOW` | macro | 738 | <code>#define S_FLOW "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"mode&#92;":{&#92;"type&#92;":&#92;"string&#92;"," &#92;</code> |
| `S_INSPECT_HIERARCHY` | macro | 744 | <code>#define S_INSPECT_HIERARCHY "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"name&#92;":{&#92;"type&#92;":&#92;"string&#92;"}," &#92;</code> |
| `S_INSPECT_UNUSED` | macro | 746 | <code>#define S_INSPECT_UNUSED "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"path&#92;":{&#92;"type&#92;":&#92;"string&#92;"}," &#92;</code> |
| `S_FILTER` | macro | 748 | <code>#define S_FILTER "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"filter&#92;":{&#92;"type&#92;":&#92;"string&#92;"}}}"</code> |
| `S_EMPTY` | macro | 749 | <code>#define S_EMPTY  "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{}}"</code> |
| `S_INTEGRATE` | macro | 750 | <code>#define S_INTEGRATE "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_EVENT` | macro | 754 | <code>#define S_EVENT "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_WORK_OPEN` | macro | 758 | <code>#define S_WORK_OPEN "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_WORK_UPDATE` | macro | 760 | <code>#define S_WORK_UPDATE "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_WORK_CLOSE` | macro | 763 | <code>#define S_WORK_CLOSE "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_RECONCILE` | macro | 767 | <code>#define S_RECONCILE "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_LIMIT` | macro | 770 | <code>#define S_LIMIT  "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"limit&#92;":{&#92;"type&#92;":&#92;"integer&#92;"}}}"</code> |
| `S_MSG` | macro | 771 | <code>#define S_MSG    "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"message&#92;":{&#92;"type&#92;":&#92;"string&#92;"}}," &#92;</code> |
| `S_TASKID` | macro | 773 | <code>#define S_TASKID "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"id&#92;":{&#92;"type&#92;":&#92;"string&#92;"," &#92;</code> |
| `S_TASKDN` | macro | 775 | <code>#define S_TASKDN "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"id&#92;":{&#92;"type&#92;":&#92;"string&#92;"," &#92;</code> |
| `S_MODE` | macro | 778 | <code>#define S_MODE   "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"mode&#92;":{" &#92;</code> |
| `S_CHECK` | macro | 781 | <code>#define S_CHECK  "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"check&#92;":{&#92;"type&#92;":&#92;"boolean&#92;"}}}"</code> |
| `S_TRACE` | macro | 782 | <code>#define S_TRACE  "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"id&#92;":{&#92;"type&#92;":&#92;"string&#92;"," &#92;</code> |
| `S_REMEMBER` | macro | 784 | <code>#define S_REMEMBER "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_FEATURE` | macro | 792 | <code>#define S_FEATURE "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"feature&#92;":" &#92;</code> |
| `S_PATHOPT` | macro | 794 | <code>#define S_PATHOPT "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"path&#92;":" &#92;</code> |
| `S_SHOW` | macro | 797 | <code>#define S_SHOW   "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"name&#92;":{&#92;"type&#92;":&#92;"string&#92;"}," &#92;</code> |
| `S_NAMEOPT` | macro | 800 | <code>#define S_NAMEOPT "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{&#92;"name&#92;":" &#92;</code> |
| `S_CLAIM` | macro | 803 | <code>#define S_CLAIM  "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_ADD` | macro | 808 | <code>#define S_ADD    "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_RECALL` | macro | 818 | <code>#define S_RECALL "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_MEMEXPORT` | macro | 823 | <code>#define S_MEMEXPORT "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_MEMIMPORT` | macro | 832 | <code>#define S_MEMIMPORT "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_CLAIMNEXT` | macro | 844 | <code>#define S_CLAIMNEXT "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_RELEASE` | macro | 849 | <code>#define S_RELEASE "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_HANDOFF` | macro | 855 | <code>#define S_HANDOFF "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_RESUME` | macro | 862 | <code>#define S_RESUME "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_CLASSIFY` | macro | 865 | <code>#define S_CLASSIFY "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_PROMOTE` | macro | 870 | <code>#define S_PROMOTE "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `S_CODEMAP` | macro | 873 | <code>#define S_CODEMAP "{&#92;"type&#92;":&#92;"object&#92;",&#92;"properties&#92;":{" &#92;</code> |
| `A_READ` | macro | 882 | <code>#define A_READ  "{&#92;"readOnlyHint&#92;":true,&#92;"destructiveHint&#92;":false," &#92;</code> |
| `A_WRITE` | macro | 884 | <code>#define A_WRITE "{&#92;"readOnlyHint&#92;":false,&#92;"destructiveHint&#92;":false," &#92;</code> |
| `A_MUTATE` | macro | 886 | <code>#define A_MUTATE "{&#92;"readOnlyHint&#92;":false,&#92;"destructiveHint&#92;":true," &#92;</code> |
| `MCP_FRESH_MS` | macro | 891 | <code>#define MCP_FRESH_MS 1500</code> |
| `MCP_GATE_WAIT_MS` | macro | 892 | <code>#define MCP_GATE_WAIT_MS 1500</code> |
| `TOOLS` | variable | 898 | <code>} TOOLS&#91;&#93; = {</code> |
| `NTOOLS` | macro | 1236 | <code>#define NTOOLS ((int)(sizeof TOOLS / sizeof TOOLS&#91;0&#93;))</code> |
| `RESOURCES` | variable | 1245 | <code>} RESOURCES&#91;&#93; = {</code> |
| `PROMPTS` | variable | 1259 | <code>static const struct { const char &#42;name, &#42;title, &#42;desc, &#42;body; } PROMPTS&#91;&#93; = {</code> |
| `mcp_tool_annotations` | function | 1311 | <code>static void mcp_tool_annotations(int i, StrBuf &#42;b) {</code> |
| `mcp_resource_abs` | function | 1317 | <code>static void mcp_resource_abs(Cg &#42;cg, const char &#42;rel, char &#42;out, size_t cap) {</code> |
| `mcp_list_resources` | function | 1329 | <code>static void mcp_list_resources(Cg &#42;cg, StrBuf &#42;r) {</code> |
| `mcp_list_prompts` | function | 1370 | <code>static void mcp_list_prompts(StrBuf &#42;r) {</code> |
| `mcp_tools_json` | function | 1384 | <code>void mcp_tools_json(StrBuf &#42;r) {</code> |
| `mcp_call_tool` | function | 1401 | <code>int mcp_call_tool(Cg &#42;cg, const SysInfo &#42;si, const char &#42;name,</code> |
| `cmd_tool` | function | 1451 | <code>int cmd_tool(Cg &#42;cg, const SysInfo &#42;si, int argc, char &#42;&#42;argv, bool json) {</code> |
| `send_line` | function | 1501 | <code>static void send_line(StrBuf &#42;b) {</code> |
| `reply_result` | function | 1508 | <code>static void reply_result(const char &#42;id, const char &#42;result_json) {</code> |
| `reply_error` | function | 1515 | <code>static void reply_error(const char &#42;id, int code, const char &#42;msg) {</code> |
| `cmd_mcp` | function | 1524 | <code>int cmd_mcp(Cg &#42;cg, const SysInfo &#42;si) {</code> |
| `self_path` | function | 1684 | <code>static int self_path(char &#42;out, size_t cap) {</code> |
| `server_entry` | function | 1691 | <code>static char &#42;server_entry(const char &#42;bin, bool vscode_style) {</code> |
| `install_json` | function | 1702 | <code>static void install_json(const char &#42;path, const char &#42;root_key,</code> |
| `cmd_mcp_install` | function | 1750 | <code>int cmd_mcp_install(Cg &#42;cg) {</code> |

## src/native.c

[Open source](../../src/native.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `NATIVE_STALE_S` | macro | 34 | <code>#define NATIVE_STALE_S 120         /&#42; no hook for this long: shown as stale &#42;/</code> |
| `NATIVE_HIDE_S` | macro | 35 | <code>#define NATIVE_HIDE_S  86400       /&#42; stopped this long: hidden unless --all &#42;/</code> |
| `NATIVE_PROMPT_CHARS` | macro | 36 | <code>#define NATIVE_PROMPT_CHARS 200</code> |
| `NATIVE_MESSAGE_CHARS` | macro | 37 | <code>#define NATIVE_MESSAGE_CHARS 300</code> |
| `NATIVE_BUSY_MS` | macro | 38 | <code>#define NATIVE_BUSY_MS 3000        /&#42; a hook waits this long for the lock &#42;/</code> |
| `Hook` | typedef | 44 | <code>typedef struct {</code> |
| `jstr` | function | 52 | <code>static char &#42;jstr(const char &#42;obj, const char &#42;key) {</code> |
| `jmodel` | function | 60 | <code>static char &#42;jmodel(const char &#42;obj) {</code> |
| `hook_free` | function | 71 | <code>static void hook_free(Hook &#42;h) {</code> |
| `hook_parse` | function | 78 | <code>static void hook_parse(Hook &#42;h, const char &#42;host, const char &#42;p) {</code> |
| `agent_name` | function | 98 | <code>static void agent_name(const Hook &#42;h, const char &#42;id, char &#42;out, size_t cap) {</code> |
| `excerpt` | function | 103 | <code>static char &#42;excerpt(const char &#42;s, size_t n) {</code> |
| `bind_s` | function | 116 | <code>static void bind_s(sqlite3_stmt &#42;st, int i, const char &#42;v) {</code> |
| `col_cpy` | function | 121 | <code>static void col_cpy(sqlite3_stmt &#42;st, int c, char &#42;out, size_t cap) {</code> |
| `exec_ok` | function | 126 | <code>static bool exec_ok(Cg &#42;cg, const char &#42;sql) {</code> |
| `put_kv` | function | 130 | <code>static void put_kv(StrBuf &#42;b, const char &#42;k, const char &#42;v) {</code> |
| `NRow` | typedef | 136 | <code>typedef struct {</code> |
| `row_get` | function | 144 | <code>static void row_get(Cg &#42;cg, const char &#42;agent, NRow &#42;r) {</code> |
| `machine` | function | 172 | <code>static const char &#42;machine(void) {</code> |
| `same_dir` | function | 185 | <code>static bool same_dir(const char &#42;a, const char &#42;b) {</code> |
| `native_worktree` | function | 195 | <code>bool native_worktree(Cg &#42;cg, const char &#42;cwd, char &#42;wt, size_t wcap,</code> |
| `session_branch` | function | 210 | <code>static void session_branch(Cg &#42;cg, const char &#42;sname, char &#42;out, size_t cap) {</code> |
| `place_agent` | function | 221 | <code>static void place_agent(Cg &#42;cg, const char &#42;agent, const char &#42;sname,</code> |
| `active_tasks` | function | 255 | <code>static void active_tasks(Cg &#42;cg) {</code> |
| `is_task_id` | function | 280 | <code>static bool is_task_id(const char &#42;id, size_t n) {</code> |
| `idch` | function | 286 | <code>static bool idch(char c) {</code> |
| `task_in_text` | function | 293 | <code>static bool task_in_text(const char &#42;text, char &#42;out, size_t cap) {</code> |
| `attribute_task` | function | 331 | <code>static const char &#42;attribute_task(Cg &#42;cg, bool use_env, const char &#42;session,</code> |
| `native_attribute_task` | function | 357 | <code>const char &#42;native_attribute_task(Cg &#42;cg, const char &#42;session,</code> |
| `emit` | function | 366 | <code>static void emit(Cg &#42;cg, const char &#42;kind, const char &#42;agent,</code> |
| `ensure_session` | function | 403 | <code>static bool ensure_session(Cg &#42;cg, const Hook &#42;h) {</code> |
| `ensure_subagent` | function | 442 | <code>static bool ensure_subagent(Cg &#42;cg, const Hook &#42;h, const char &#42;name) {</code> |
| `set_task_if_none` | function | 460 | <code>static void set_task_if_none(Cg &#42;cg, const char &#42;agent, const char &#42;session,</code> |
| `actor` | function | 481 | <code>static void actor(const Hook &#42;h, char &#42;out, size_t cap) {</code> |
| `heartbeat` | function | 486 | <code>static void heartbeat(Cg &#42;cg, const char &#42;agent, const char &#42;tool,</code> |
| `record_spawn` | function | 503 | <code>static void record_spawn(Cg &#42;cg, const Hook &#42;h, const char &#42;spawner) {</code> |
| `read_meta` | function | 560 | <code>static char &#42;read_meta(Cg &#42;cg, const Hook &#42;h) {</code> |
| `record_start` | function | 595 | <code>static void record_start(Cg &#42;cg, const Hook &#42;h) {</code> |
| `record_stop` | function | 707 | <code>static void record_stop(Cg &#42;cg, const Hook &#42;h, const char &#42;agent,</code> |
| `is_spawn_tool` | function | 731 | <code>static bool is_spawn_tool(const char &#42;t) {</code> |
| `native_record` | function | 736 | <code>int native_record(Cg &#42;cg, const char &#42;host, const char &#42;payload,</code> |
| `read_stdin_all` | function | 825 | <code>static char &#42;read_stdin_all(void) {</code> |
| `hook_log` | function | 839 | <code>static void hook_log(Cg &#42;cg, const char &#42;why, const char &#42;payload) {</code> |
| `IngestCall` | typedef | 852 | <code>typedef struct { Cg &#42;cg; const char &#42;host; const char &#42;payload; } IngestCall;</code> |
| `ingest_call` | function | 854 | <code>static int ingest_call(void &#42;u) {</code> |
| `cmd_hook_event` | function | 859 | <code>int cmd_hook_event(Cg &#42;cg, const char &#42;host, bool json) {</code> |
| `NView` | typedef | 925 | <code>typedef struct {</code> |
| `load_views` | function | 934 | <code>static int load_views(Cg &#42;cg, NView &#42;&#42;out) {</code> |
| `is_root` | function | 1000 | <code>static bool is_root(const NView &#42;v, int n, int i) {</code> |
| `shown_state` | function | 1007 | <code>static const char &#42;shown_state(const NView &#42;r) {</code> |
| `age` | function | 1014 | <code>static void age(long t, char &#42;out, size_t cap) {</code> |
| `text_node` | function | 1023 | <code>static void text_node(StrBuf &#42;b, const NView &#42;v, int n, int i, int indent) {</code> |
| `json_node` | function | 1043 | <code>static void json_node(StrBuf &#42;b, const NView &#42;v, int n, int i, int guard) {</code> |
| `native_tree_json` | function | 1080 | <code>void native_tree_json(Cg &#42;cg, StrBuf &#42;b) {</code> |
| `native_fleet_section` | function | 1096 | <code>void native_fleet_section(Cg &#42;cg, StrBuf &#42;b, bool json) {</code> |
| `TreeCall` | typedef | 1115 | <code>typedef struct { Cg &#42;cg; const char &#42;feature; } TreeCall;</code> |
| `tree_call` | function | 1117 | <code>static int tree_call(void &#42;u) {</code> |
| `native_fleet_tree_json` | function | 1122 | <code>int native_fleet_tree_json(Cg &#42;cg, const char &#42;feature) {</code> |
| `native_counts` | function | 1162 | <code>bool native_counts(Cg &#42;cg, int &#42;live, int &#42;subs, int &#42;branches) {</code> |
| `native_summary` | function | 1188 | <code>void native_summary(Cg &#42;cg, StrBuf &#42;b, bool json) {</code> |
| `native_flags` | function | 1202 | <code>void native_flags(int argc, char &#42;&#42;argv) {</code> |
| `DISCOVER_STALE_S` | macro | 1231 | <code>#define DISCOVER_STALE_S   900     /&#42; transcript untouched: the agent is stale &#42;/</code> |
| `DISCOVER_EVERY_S` | macro | 1232 | <code>#define DISCOVER_EVERY_S   10      /&#42; automatic runs: at most one per process &#42;/</code> |
| `DISCOVER_HEAD_LINES` | macro | 1233 | <code>#define DISCOVER_HEAD_LINES 400    /&#42; lines read for cwd, model, prompt &#42;/</code> |
| `Disc` | typedef | 1237 | <code>typedef struct {</code> |
| `Delta` | typedef | 1246 | <code>typedef struct {</code> |
| `delta_init` | function | 1254 | <code>static void delta_init(Delta &#42;d, const char &#42;agent) {</code> |
| `delta_field` | function | 1260 | <code>static void delta_field(Delta &#42;d, const char &#42;f) {</code> |
| `delta_done` | function | 1267 | <code>static void delta_done(Disc &#42;D, Delta &#42;d) {</code> |
| `mtime_of` | function | 1281 | <code>static long mtime_of(const char &#42;p) {</code> |
| `is_dir` | function | 1286 | <code>static bool is_dir(const char &#42;p) {</code> |
| `ends_with` | function | 1291 | <code>static bool ends_with(const char &#42;s, const char &#42;suf) {</code> |
| `iso_time` | function | 1297 | <code>static long iso_time(const char &#42;ts) {</code> |
| `has_agents_column` | function | 1309 | <code>static bool has_agents_column(Cg &#42;cg, const char &#42;col) {</code> |
| `ensure_discovered_column` | function | 1322 | <code>static bool ensure_discovered_column(Cg &#42;cg) {</code> |
| `disc_has` | function | 1330 | <code>static bool disc_has(Cg &#42;cg, const char &#42;agent, const char &#42;f) {</code> |
| `disc_note` | function | 1341 | <code>static void disc_note(Cg &#42;cg, const char &#42;agent, const char &#42;f) {</code> |
| `fill` | function | 1353 | <code>static void fill(Cg &#42;cg, Delta &#42;d, const char &#42;col, const char &#42;v) {</code> |
| `fill_int` | function | 1369 | <code>static void fill_int(Cg &#42;cg, Delta &#42;d, const char &#42;col, long v) {</code> |
| `disc_create` | function | 1386 | <code>static void disc_create(Cg &#42;cg, Delta &#42;d, const char &#42;host, const char &#42;session,</code> |
| `disc_liveness` | function | 1412 | <code>static void disc_liveness(Cg &#42;cg, Disc &#42;D, Delta &#42;d, long mtime) {</code> |
| `disc_place` | function | 1453 | <code>static void disc_place(Cg &#42;cg, Delta &#42;d, const char &#42;sname, const char &#42;cwd,</code> |
| `disc_found` | function | 1475 | <code>static void disc_found(Disc &#42;D, const char &#42;agent, const char &#42;host,</code> |
| `disc_finish` | function | 1489 | <code>static void disc_finish(Cg &#42;cg, Disc &#42;D, Delta &#42;d) {</code> |
| `Head` | typedef | 1498 | <code>typedef struct { char cwd&#91;4096&#93;, model&#91;128&#93;, ts&#91;64&#93;; char &#42;prompt; } Head;</code> |
| `claude_head` | function | 1500 | <code>static void claude_head(const char &#42;path, Head &#42;h, bool want_prompt) {</code> |
| `nested_parent` | function | 1541 | <code>static void nested_parent(const char &#42;subdir, const char &#42;self_id,</code> |
| `discover_subagent` | function | 1565 | <code>static void discover_subagent(Cg &#42;cg, Disc &#42;D, const char &#42;sid,</code> |
| `meta_depth` | function | 1653 | <code>static long meta_depth(const char &#42;subdir, const char &#42;aid) {</code> |
| `discover_session` | function | 1663 | <code>static void discover_session(Cg &#42;cg, Disc &#42;D, const char &#42;dir, const char &#42;sid) {</code> |
| `discover_claude_dir` | function | 1745 | <code>static void discover_claude_dir(Cg &#42;cg, Disc &#42;D, const char &#42;dir) {</code> |
| `discover_claude` | function | 1787 | <code>static void discover_claude(Cg &#42;cg, Disc &#42;D) {</code> |
| `in_project` | function | 1815 | <code>static bool in_project(Cg &#42;cg, const char &#42;cwd) {</code> |
| `codex_model` | function | 1826 | <code>static void codex_model(const char &#42;path, char &#42;out, size_t cap) {</code> |
| `discover_codex_file` | function | 1843 | <code>static void discover_codex_file(Cg &#42;cg, Disc &#42;D, const char &#42;path, long mtime) {</code> |
| `discover_codex_in` | function | 1877 | <code>static void discover_codex_in(Cg &#42;cg, Disc &#42;D, const char &#42;dir, int depth) {</code> |
| `discover_codex` | function | 1902 | <code>static void discover_codex(Cg &#42;cg, Disc &#42;D) {</code> |
| `discover_run` | function | 1910 | <code>static int discover_run(Cg &#42;cg, long since, Disc &#42;D) {</code> |
| `disc_free` | function | 1937 | <code>static void disc_free(Disc &#42;D) {</code> |
| `cmd_fleet_discover` | function | 1943 | <code>int cmd_fleet_discover(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `native_discover_auto` | function | 1999 | <code>void native_discover_auto(Cg &#42;cg) {</code> |

## src/orchestrate.c

[Open source](../../src/orchestrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `hf_client_authority_guard` | function | 2 | <code>extern int hf_client_authority_guard(const char &#42;operation, FILE &#42;output);</code> |
| `ORCH_MAX_SLOTS` | macro | 30 | <code>#define ORCH_MAX_SLOTS 16</code> |
| `ORCH_MAX_ARGV` | macro | 31 | <code>#define ORCH_MAX_ARGV  64</code> |
| `orch_on_signal` | function | 35 | <code>static void orch_on_signal(int sig) {</code> |
| `OrchCfg` | typedef | 42 | <code>typedef struct {</code> |
| `orch_raw_str` | function | 56 | <code>static char &#42;orch_raw_str(const Kvx &#42;k, const char &#42;sec, const char &#42;key) {</code> |
| `orch_cfg_load` | function | 73 | <code>static void orch_cfg_load(const Kvx &#42;wf, OrchCfg &#42;c) {</code> |
| `orch_cfg_free` | function | 91 | <code>static void orch_cfg_free(OrchCfg &#42;c) {</code> |
| `OrchSpecCall` | typedef | 99 | <code>typedef struct { int argc; char &#42;&#42;argv; bool json; } OrchSpecCall;</code> |
| `orch_call_spec` | function | 101 | <code>static int orch_call_spec(void &#42;v) {</code> |
| `orch_spec` | function | 114 | <code>static int orch_spec(char &#42;&#42;out, bool json, int argc, ...) {</code> |
| `OrchResumeCall` | typedef | 124 | <code>typedef struct { Cg &#42;g; const char &#42;task; } OrchResumeCall;</code> |
| `orch_call_resume` | function | 126 | <code>static int orch_call_resume(void &#42;v) {</code> |
| `orch_call_docs_packet` | function | 131 | <code>static int orch_call_docs_packet(void &#42;v) {</code> |
| `orch_docs_ready` | function | 139 | <code>static bool orch_docs_ready(const char &#42;id) {</code> |
| `sup_branch_has_main` | function | 179 | <code>static bool sup_branch_has_main(const char &#42;repo, const char &#42;mainbr,</code> |
| `sup_wave_fresh` | function | 191 | <code>static bool sup_wave_fresh(long wave) {</code> |
| `orch_prompt_retry` | function | 203 | <code>static void orch_prompt_retry(const char &#42;path, const char &#42;feature,</code> |
| `orch_roles_load` | function | 206 | <code>static void orch_roles_load(const Hierarchy &#42;h) {</code> |
| `orch_argv` | function | 224 | <code>static int orch_argv(const char &#42;driver, const char &#42;extra, const char &#42;cmd,</code> |
| `orch_argv_free` | function | 237 | <code>static void orch_argv_free(char &#42;&#42;av) {</code> |
| `orch_argv_print` | function | 241 | <code>static void orch_argv_print(char &#42;&#42;av) {</code> |
| `orch_spec_root` | function | 254 | <code>static int orch_spec_root(char &#42;out, size_t cap) {</code> |
| `orch_task_status` | function | 260 | <code>static char &#42;orch_task_status(const char &#42;specroot, const char &#42;feature,</code> |
| `orch_abandon` | function | 301 | <code>static void orch_abandon(const char &#42;specroot, const char &#42;feature,</code> |
| `orch_event` | function | 336 | <code>static void orch_event(const char &#42;kind, const char &#42;role, const char &#42;agent,</code> |
| `OE` | macro | 343 | <code>#define OE(k, v) do { if (v) { sb_puts(&amp;p, ",&#92;"" k "&#92;":"); &#92;</code> |
| `orch_note_failure` | function | 358 | <code>static void orch_note_failure(const char &#42;feature, const char &#42;id, int rc) {</code> |
| `orch_prompt_steer` | function | 374 | <code>static void orch_prompt_steer(const char &#42;path, const char &#42;agent) {</code> |
| `orch_hier` | function | 392 | <code>static Kvx &#42;orch_hier(const char &#42;tree, Hierarchy &#42;h);</code> |
| `orch_prompt_ahead` | function | 396 | <code>static void orch_prompt_ahead(Cg &#42;cg, const FleetNode &#42;n, const char &#42;feature,</code> |
| `orch_write_prompt` | function | 463 | <code>static int orch_write_prompt(const char &#42;cgroot, const char &#42;feature,</code> |
| `orch_spawn` | function | 497 | <code>static pid_t orch_spawn(char &#42;&#42;av, const char &#42;root, const char &#42;promptfile,</code> |
| `orch_dry_run` | function | 533 | <code>static int orch_dry_run(const char &#42;specroot, const char &#42;cgroot,</code> |
| `OrchSlot` | typedef | 610 | <code>typedef struct {</code> |
| `orch_heartbeat` | function | 622 | <code>static int orch_heartbeat(OrchSlot &#42;slot, long ttl_min) {</code> |
| `orch_live` | function | 638 | <code>static int orch_live(const OrchSlot &#42;slots, int n) {</code> |
| `orch_reap` | function | 648 | <code>static int orch_reap(pid_t pid) {</code> |
| `FleetRunOpts` | typedef | 670 | <code>typedef struct { const char &#42;run_id; const char &#42;resume; bool all; } FleetRunOpts;</code> |
| `orch_fleet_run` | function | 671 | <code>static int orch_fleet_run(const char &#42;feature_ov, const OrchCfg &#42;cfg,</code> |
| `cmd_spec_run` | function | 676 | <code>int cmd_spec_run(int argc, char &#42;&#42;argv) {</code> |
| `ORCH_WAKE_BACKOFF` | macro | 1084 | <code>#define ORCH_WAKE_BACKOFF  1          /&#42; seconds between manager wakes &#42;/</code> |
| `ORCH_ROUNDS_DFLT` | macro | 1085 | <code>#define ORCH_ROUNDS_DFLT   16          /&#42; manager wakes before giving up &#42;/</code> |
| `orch_hier` | function | 1089 | <code>static Kvx &#42;orch_hier(const char &#42;tree, Hierarchy &#42;h) {</code> |
| `orch_worktree_path` | function | 1100 | <code>static void orch_worktree_path(const Hierarchy &#42;h, const char &#42;tree,</code> |
| `orch_excerpt` | function | 1111 | <code>static void orch_excerpt(const StrBuf &#42;b, char &#42;out, size_t cap) {</code> |
| `orch_ahead` | function | 1123 | <code>static long orch_ahead(const char &#42;tree, const char &#42;base, const char &#42;branch) {</code> |
| `ORCH_ENV` | variable | 1144 | <code>static const char &#42;ORCH_ENV&#91;ORCH_ENVN&#93; = {</code> |
| `OrchEnv` | typedef | 1148 | <code>typedef struct { char &#42;v&#91;ORCH_ENVN&#93;; } OrchEnv;</code> |
| `orch_env_save` | function | 1150 | <code>static void orch_env_save(OrchEnv &#42;s) {</code> |
| `orch_env_restore` | function | 1157 | <code>static void orch_env_restore(OrchEnv &#42;s) {</code> |
| `orch_env_apply` | function | 1166 | <code>static void orch_env_apply(const FleetNode &#42;n) {</code> |
| `orch_agent_record` | function | 1186 | <code>static void orch_agent_record(Cg &#42;g, const FleetNode &#42;n) {</code> |
| `orch_fleet_exec` | function | 1213 | <code>static pid_t orch_fleet_exec(char &#42;&#42;av, const FleetNode &#42;n,</code> |
| `OrchTask` | typedef | 1260 | <code>typedef struct {</code> |
| `orch_tasks_free` | function | 1272 | <code>static void orch_tasks_free(OrchTask &#42;v, int n) {</code> |
| `orch_tasks_wave_trees` | function | 1282 | <code>static void orch_tasks_wave_trees(Cg &#42;cg, const char &#42;feature, OrchTask &#42;v,</code> |
| `orch_tasks_load` | function | 1320 | <code>static int orch_tasks_load(Cg &#42;cg, const char &#42;feature, const char &#42;fwt,</code> |
| `orch_task_wave` | function | 1410 | <code>static long orch_task_wave(Cg &#42;cg, const char &#42;feature, const char &#42;id) {</code> |
| `OrchSubtree` | typedef | 1422 | <code>typedef struct {</code> |
| `orch_subtree` | function | 1431 | <code>static void orch_subtree(Cg &#42;cg, const char &#42;feature, long wave,</code> |
| `OrchPlanCall` | typedef | 1452 | <code>typedef struct { Cg &#42;g; const char &#42;feature; } OrchPlanCall;</code> |
| `orch_call_plan` | function | 1454 | <code>static int orch_call_plan(void &#42;v) {</code> |
| `orch_manager_prompt` | function | 1472 | <code>static int orch_manager_prompt(Cg &#42;cg, const FleetNode &#42;n, const char &#42;path) {</code> |
| `orch_spawn_manager` | function | 1531 | <code>int orch_spawn_manager(Cg &#42;cg, const char &#42;feature, long wave,</code> |
| `OrchBeginCall` | typedef | 1635 | <code>typedef struct { Cg &#42;g; const char &#42;id; const char &#42;feature; } OrchBeginCall;</code> |
| `orch_call_begin` | function | 1637 | <code>static int orch_call_begin(void &#42;v) {</code> |
| `orch_json_into` | function | 1652 | <code>static void orch_json_into(const char &#42;js, const char &#42;key, char &#42;out,</code> |
| `orch_spawn_worker` | function | 1659 | <code>int orch_spawn_worker(Cg &#42;cg, const char &#42;feature, const char &#42;id,</code> |
| `orch_ago` | function | 1786 | <code>static void orch_ago(long seen, char &#42;out, size_t cap) {</code> |
| `OrchWorkerRow` | typedef | 1795 | <code>typedef struct {</code> |
| `orch_worker_rows` | function | 1802 | <code>static int orch_worker_rows(Cg &#42;cg, const char &#42;feature, OrchWorkerRow &#42;&#42;out) {</code> |
| `orch_tree_has_wave` | function | 1859 | <code>static bool orch_tree_has_wave(const long &#42;waves, int n, long wave) {</code> |
| `orch_tree_status` | function | 1864 | <code>int orch_tree_status(Cg &#42;cg, const char &#42;feature_ov, bool json) {</code> |
| `TREE_OWNS` | macro | 1946 | <code>#define TREE_OWNS(i) (!per_wave &#124;&#124; w&#91;i&#93;.wave == wave &#124;&#124; &#92;</code> |
| `OrchFleetSlot` | typedef | 2039 | <code>typedef struct {</code> |
| `orch_live_fleet` | function | 2055 | <code>static int orch_live_fleet(const OrchFleetSlot &#42;s, int n) {</code> |
| `orch_finished_id` | function | 2061 | <code>static bool orch_finished_id(const OrchTask &#42;v, int n, const char &#42;id) {</code> |
| `orch_attempts` | function | 2074 | <code>static int orch_attempts(char &#42;&#42;tried, int ntried, const char &#42;id) {</code> |
| `orch_collides` | function | 2091 | <code>static bool orch_collides(const char &#42;a, const char &#42;b) {</code> |
| `orch_task_slots` | function | 2126 | <code>static bool orch_task_slots(const OrchTask &#42;t, const OrchFleetSlot &#42;slots,</code> |
| `orch_req_ready` | function | 2144 | <code>static bool orch_req_ready(const OrchTask &#42;v, int n, const OrchTask &#42;t,</code> |
| `orch_next_task_in` | function | 2167 | <code>static bool orch_next_task_in(const OrchTask &#42;v, int n, char &#42;&#42;tried,</code> |
| `orch_next_task` | function | 2185 | <code>static bool orch_next_task(const OrchTask &#42;v, int n, char &#42;&#42;tried, int ntried,</code> |
| `orch_node_heartbeat` | function | 2191 | <code>static int orch_node_heartbeat(const FleetNode &#42;n, long ttl_min) {</code> |
| `proc_start_time` | function | 2205 | <code>static long proc_start_time(pid_t pid) {</code> |
| `proc_alive` | function | 2230 | <code>static bool proc_alive(pid_t pid, long start) {</code> |
| `sup_lock_path` | function | 2239 | <code>static int sup_lock_path(const char &#42;shared, char &#42;out, size_t cap) {</code> |
| `sup_lock_take` | function | 2246 | <code>static int sup_lock_take(const char &#42;shared) {</code> |
| `fleet_supervisor_alive` | function | 2255 | <code>bool fleet_supervisor_alive(const char &#42;shared) {</code> |
| `SupMgr` | typedef | 2266 | <code>typedef struct {</code> |
| `Sup` | typedef | 2277 | <code>typedef struct {</code> |
| `sup_mgr` | function | 2302 | <code>static SupMgr &#42;sup_mgr(Sup &#42;s, long wave) {</code> |
| `sup_mgrs_live` | function | 2315 | <code>static int sup_mgrs_live(const Sup &#42;s) {</code> |
| `sup_mgr_agent` | function | 2328 | <code>static void sup_mgr_agent(Sup &#42;s, long wave, char &#42;out, size_t cap);</code> |
| `sup_forward_finding` | function | 2331 | <code>static void sup_forward_finding(Cg &#42;g, char &#42;&#42;paths, int np, char &#42;out,</code> |
| `sup_forward_steer` | function | 2357 | <code>static int sup_forward_steer(Sup &#42;s, long wave, const char &#42;br,</code> |
| `sup_forward_merge` | function | 2405 | <code>static int sup_forward_merge(Sup &#42;s, long wave) {</code> |
| `sup_wave_branch` | function | 2542 | <code>static void sup_wave_branch(Sup &#42;s, long wave, char &#42;br, size_t cap) {</code> |
| `sup_wave_mark_fresh` | function | 2553 | <code>static void sup_wave_mark_fresh(Sup &#42;s, long wave) {</code> |
| `sup_forward_lands` | function | 2570 | <code>static void sup_forward_lands(Sup &#42;s) {</code> |
| `sup_mgr_agent` | function | 2616 | <code>static void sup_mgr_agent(Sup &#42;s, long wave, char &#42;out, size_t cap) {</code> |
| `sup_mgr_log` | function | 2627 | <code>static void sup_mgr_log(const Sup &#42;s, long wave, char &#42;out, size_t cap) {</code> |
| `sup_event` | function | 2638 | <code>static void sup_event(Sup &#42;s, const char &#42;state, const char &#42;reason) {</code> |
| `sup_save` | function | 2651 | <code>static void sup_save(Sup &#42;s) {</code> |
| `sup_set_state` | function | 2665 | <code>static void sup_set_state(Sup &#42;s, const char &#42;state, const char &#42;reason) {</code> |
| `sup_control` | function | 2681 | <code>static void sup_control(Sup &#42;s) {</code> |
| `sup_node_add` | function | 2691 | <code>static long sup_node_add(Sup &#42;s, const FleetNode &#42;n, const char &#42;log,</code> |
| `sup_node_end` | function | 2720 | <code>static void sup_node_end(Sup &#42;s, long id, const char &#42;state, int exit,</code> |
| `sup_gone` | function | 2739 | <code>static bool sup_gone(pid_t pid, long start, bool adopted, int &#42;crc) {</code> |
| `sup_kill` | function | 2753 | <code>static void sup_kill(pid_t pid, long start, bool adopted) {</code> |
| `sup_terminate` | function | 2765 | <code>static void sup_terminate(Sup &#42;s) {</code> |
| `sup_tap_adopt` | function | 2785 | <code>static void sup_tap_adopt(DriverTap &#42;t, const char &#42;log, const char &#42;agent,</code> |
| `fleet_run_resume` | function | 2798 | <code>static int fleet_run_resume(Sup &#42;s) {</code> |
| `COL` | macro | 2834 | <code>#define COL(i) ((const char &#42;)sqlite3_column_text(st, i))</code> |
| `wall_ms_now` | function | 2891 | <code>static long wall_ms_now(void) {</code> |
| `sup_slot_begin` | function | 2897 | <code>static void sup_slot_begin(Cg &#42;g, OrchFleetSlot &#42;sl) {</code> |
| `sup_tree_fp` | function | 2913 | <code>static void sup_tree_fp(const char &#42;wt, char out&#91;65&#93;) {</code> |
| `sup_progressed` | function | 2939 | <code>static bool sup_progressed(Sup &#42;s, OrchFleetSlot &#42;sl) {</code> |
| `sup_note` | function | 2967 | <code>static void sup_note(Sup &#42;s, const char &#42;kind, const OrchFleetSlot &#42;sl,</code> |
| `HandoffCall` | typedef | 2981 | <code>typedef struct { Cg &#42;cg; const char &#42;task, &#42;blocked, &#42;note; } HandoffCall;</code> |
| `sup_handoff_call` | function | 2982 | <code>static int sup_handoff_call(void &#42;v) {</code> |
| `sup_end_attempt` | function | 2990 | <code>static void sup_end_attempt(Sup &#42;s, OrchFleetSlot &#42;sl, const char &#42;kind,</code> |
| `supervisor_budget_check` | function | 3007 | <code>static bool supervisor_budget_check(Sup &#42;s, OrchFleetSlot &#42;sl, long now) {</code> |
| `supervisor_stall_check` | function | 3028 | <code>static void supervisor_stall_check(Sup &#42;s, OrchFleetSlot &#42;sl, long now) {</code> |
| `sup_supervise` | function | 3060 | <code>static void sup_supervise(Sup &#42;s) {</code> |
| `sup_esc_find` | function | 3071 | <code>static int sup_esc_find(Sup &#42;s, const char &#42;task) {</code> |
| `supervisor_escalate` | function | 3077 | <code>static void supervisor_escalate(Sup &#42;s, const char &#42;task, int level,</code> |
| `supervisor_retry` | function | 3131 | <code>static void supervisor_retry(Sup &#42;s, const char &#42;task, const char &#42;why) {</code> |
| `sup_escalations_check` | function | 3138 | <code>static void sup_escalations_check(Sup &#42;s, const OrchTask &#42;v, int n) {</code> |
| `orch_prompt_retry` | function | 3161 | <code>static void orch_prompt_retry(const char &#42;path, const char &#42;feature,</code> |
| `sup_approval` | function | 3214 | <code>static int sup_approval(Sup &#42;s, long &#42;id) {</code> |
| `sup_subtree` | function | 3231 | <code>static void sup_subtree(Sup &#42;s, OrchSubtree &#42;sub) {</code> |
| `sup_wake_managers` | function | 3272 | <code>static int sup_wake_managers(Sup &#42;s, const OrchSubtree &#42;sub, long now) {</code> |
| `supervisor_tick` | function | 3373 | <code>static int supervisor_tick(Sup &#42;s) {</code> |
| `run_id_new` | function | 3641 | <code>static void run_id_new(const char &#42;feature, char &#42;out, size_t cap) {</code> |
| `run_latest_open` | function | 3652 | <code>static bool run_latest_open(Cg &#42;g, char &#42;out, size_t cap, char &#42;feature,</code> |
| `fleet_run_open` | function | 3669 | <code>static int fleet_run_open(Sup &#42;s, const char &#42;host) {</code> |
| `sup_feature_paths` | function | 3699 | <code>static bool sup_feature_paths(Cg &#42;g, const char &#42;feature, char &#42;fbranch,</code> |
| `feature_done` | function | 3724 | <code>static bool feature_done(Cg &#42;g, const char &#42;feature) {</code> |
| `feature_ready` | function | 3748 | <code>static bool feature_ready(Cg &#42;g, const char &#42;feature, char &#42;waiting, size_t cap) {</code> |
| `features_open` | function | 3770 | <code>static int features_open(Cg &#42;g, char &#42;&#42;&#42;out) {</code> |
| `sup_open` | function | 3801 | <code>static int sup_open(Cg &#42;g, Sup &#42;s, const char &#42;feature, const OrchCfg &#42;cfg,</code> |
| `sup_close` | function | 3886 | <code>static void sup_close(Sup &#42;s) {</code> |
| `MainAgent` | typedef | 3901 | <code>typedef struct {</code> |
| `orch_main_prompt` | function | 3911 | <code>static int orch_main_prompt(Cg &#42;g, const FleetNode &#42;n, Sup &#42;sups, int nsup,</code> |
| `orch_spawn_main` | function | 3953 | <code>static int orch_spawn_main(Cg &#42;g, const char &#42;driver, const char &#42;extra,</code> |
| `main_wake` | function | 3985 | <code>static void main_wake(MainAgent &#42;m, const char &#42;reason) {</code> |
| `main_tick` | function | 3995 | <code>static void main_tick(Cg &#42;g, MainAgent &#42;m, Sup &#42;sups, int nsup,</code> |
| `supervisor_run` | function | 4051 | <code>static int supervisor_run(Cg &#42;g, char &#42;&#42;features, int nfeat,</code> |
| `orch_fleet_run` | function | 4192 | <code>static int orch_fleet_run(const char &#42;feature_ov, const OrchCfg &#42;cfg,</code> |
| `self_exe` | function | 4347 | <code>static void self_exe(char &#42;out, size_t cap) {</code> |
| `RunRef` | typedef | 4355 | <code>typedef struct { char run&#91;40&#93;, feature&#91;128&#93;, state&#91;16&#93;; int pid; bool alive; } RunRef;</code> |
| `run_ref` | function | 4357 | <code>static bool run_ref(Cg &#42;cg, const char &#42;run, RunRef &#42;r) {</code> |
| `run_state_set` | function | 4378 | <code>static void run_state_set(Cg &#42;cg, const char &#42;run, const char &#42;state,</code> |
| `run_cleanup` | function | 4402 | <code>static int run_cleanup(Cg &#42;cg, const char &#42;run, const char &#42;feature) {</code> |
| `Live` | typedef | 4408 | <code>typedef struct { long id; char role&#91;16&#93;, agent&#91;128&#93;, task&#91;64&#93;, attempt&#91;65&#93;;</code> |
| `pos_arg` | function | 4444 | <code>static const char &#42;pos_arg(int argc, char &#42;&#42;argv) {</code> |
| `detach_supervisor` | function | 4452 | <code>static int detach_supervisor(Cg &#42;cg, char &#42;&#42;pass, int npass,</code> |
| `cmd_fleet_up` | function | 4529 | <code>int cmd_fleet_up(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `cmd_fleet_control` | function | 4577 | <code>int cmd_fleet_control(Cg &#42;cg, const char &#42;verb, int argc, char &#42;&#42;argv,</code> |
| `cmd_fleet_runs` | function | 4666 | <code>int cmd_fleet_runs(Cg &#42;cg, bool json) {</code> |

## src/plugin.c

[Open source](../../src/plugin.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PLUGIN_MARK` | macro | 24 | <code>#define PLUGIN_MARK "codify-owned: claude-code-plugin cg " CG_VERSION</code> |
| `CODEX_MARK` | macro | 25 | <code>#define CODEX_MARK  "codify-owned: codex-hooks cg " CG_VERSION</code> |
| `HOOK_TIMEOUT` | macro | 26 | <code>#define HOOK_TIMEOUT 20</code> |
| `plugin_root` | function | 28 | <code>void plugin_root(char out&#91;4700&#93;) {</code> |
| `plugin_mkparent` | function | 34 | <code>static int plugin_mkparent(const char &#42;path) {</code> |
| `plugin_write` | function | 44 | <code>static int plugin_write(const char &#42;path, const char &#42;body) {</code> |
| `shell_word` | function | 54 | <code>static void shell_word(StrBuf &#42;b, const char &#42;s) {</code> |
| `hook_cmd` | function | 64 | <code>static void hook_cmd(StrBuf &#42;b, const char &#42;bin, const char &#42;args,</code> |
| `hook_group` | function | 76 | <code>static void hook_group(StrBuf &#42;b, const char &#42;matcher, const char &#42;bin,</code> |
| `HookRow` | typedef | 89 | <code>typedef struct { const char &#42;event, &#42;matcher, &#42;args; } HookRow;</code> |
| `CLAUDE_HOOKS` | variable | 97 | <code>static const HookRow CLAUDE_HOOKS&#91;&#93; = {</code> |
| `CODEX_HOOKS` | variable | 112 | <code>static const HookRow CODEX_HOOKS&#91;&#93; = {</code> |
| `hooks_object` | function | 126 | <code>static void hooks_object(StrBuf &#42;b, const HookRow &#42;rows, const char &#42;bin,</code> |
| `claude_hooks_body` | function | 153 | <code>static char &#42;claude_hooks_body(const char &#42;bin) {</code> |
| `plugin_codex_hooks_body` | function | 164 | <code>char &#42;plugin_codex_hooks_body(const char &#42;bin) {</code> |
| `marketplace_body` | function | 172 | <code>static char &#42;marketplace_body(void) {</code> |
| `plugin_json_body` | function | 192 | <code>static char &#42;plugin_json_body(void) {</code> |
| `mcp_json_body` | function | 206 | <code>static char &#42;mcp_json_body(const char &#42;bin) {</code> |
| `skill_body` | function | 217 | <code>static char &#42;skill_body(void) {</code> |
| `command_body` | function | 224 | <code>static char &#42;command_body(const char &#42;bin, const char &#42;desc,</code> |
| `PluginFile` | typedef | 234 | <code>typedef struct { const char &#42;rel; char &#42;body; } PluginFile;</code> |
| `plugin_render` | function | 239 | <code>int plugin_render(const char &#42;bin, bool json, StrBuf &#42;out, int &#42;changed,</code> |
| `plugin_codex_hooks` | function | 287 | <code>int plugin_codex_hooks(const Cg &#42;cg, const char &#42;bin, char path&#91;4700&#93;) {</code> |
| `plugin_file_state` | function | 296 | <code>const char &#42;plugin_file_state(const char &#42;path, const char &#42;mark) {</code> |
| `plugin_codex_state` | function | 305 | <code>const char &#42;plugin_codex_state(const Cg &#42;cg, char path&#91;4700&#93;) {</code> |
| `plugin_state` | function | 316 | <code>void plugin_state(PluginState &#42;st) {</code> |
| `plugin_state_json` | function | 383 | <code>void plugin_state_json(const PluginState &#42;st, StrBuf &#42;b) {</code> |
| `find_claude` | function | 397 | <code>static bool find_claude(char &#42;out, size_t cap) {</code> |
| `claude_run` | function | 405 | <code>static int claude_run(const char &#42;claude, const char &#42;args, char &#42;last,</code> |
| `plugin_install` | function | 446 | <code>int plugin_install(bool json, StrBuf &#42;out) {</code> |

## src/serve.c

[Open source](../../src/serve.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SERVE_PROTOCOL` | macro | 32 | <code>#define SERVE_PROTOCOL  "codify-serve/1"</code> |
| `SERVE_MAX_JOBS` | macro | 33 | <code>#define SERVE_MAX_JOBS  32</code> |
| `SERVE_MAX_SUBS` | macro | 34 | <code>#define SERVE_MAX_SUBS  16</code> |
| `SERVE_BATCH` | macro | 35 | <code>#define SERVE_BATCH     500</code> |
| `SERVE_POLL_MS` | macro | 36 | <code>#define SERVE_POLL_MS   150     /&#42; change check without inotify &#42;/</code> |
| `SERVE_SAFETY_MS` | macro | 37 | <code>#define SERVE_SAFETY_MS 1000    /&#42; re-check even with inotify &#42;/</code> |
| `SERVE_MIN_GAP_MS` | macro | 38 | <code>#define SERVE_MIN_GAP_MS 15     /&#42; coalesce a burst of WAL writes &#42;/</code> |
| `SERVE_OUT_CAP` | macro | 39 | <code>#define SERVE_OUT_CAP   (16L &lt;&lt; 20)</code> |
| `Sub` | typedef | 41 | <code>typedef struct {</code> |
| `Job` | typedef | 46 | <code>typedef struct {</code> |
| `mono_ms` | function | 58 | <code>static long mono_ms(void) {</code> |
| `send_raw` | function | 64 | <code>static void send_raw(const char &#42;p, size_t n) {</code> |
| `send_msg` | function | 82 | <code>static void send_msg(StrBuf &#42;b) {</code> |
| `reply` | function | 88 | <code>static void reply(const char &#42;id, const char &#42;result) {</code> |
| `reply_err` | function | 94 | <code>static void reply_err(const char &#42;id, int code, const char &#42;msg) {</code> |
| `set_nonblock` | function | 105 | <code>static void set_nonblock(int fd) {</code> |
| `job_spawn` | function | 110 | <code>static int job_spawn(Job &#42;jobs, const Cg &#42;cg, char &#42;&#42;argv, const char &#42;id,</code> |
| `job_drain` | function | 153 | <code>static bool job_drain(Job &#42;j, int fd, StrBuf &#42;b) {</code> |
| `job_finish` | function | 169 | <code>static void job_finish(Job &#42;j, int status) {</code> |
| `Batch` | typedef | 204 | <code>typedef struct { StrBuf &#42;b; int n; long last; } Batch;</code> |
| `batch_add` | function | 206 | <code>static int batch_add(const EventRow &#42;e, void &#42;ud) {</code> |
| `serve_push` | function | 214 | <code>static void serve_push(Cg &#42;cg, Sub &#42;s) {</code> |
| `serve_snapshot` | function | 254 | <code>static void serve_snapshot(Cg &#42;cg, const char &#42;id, const char &#42;params) {</code> |
| `Server` | typedef | 276 | <code>typedef struct {</code> |
| `raw_or` | function | 285 | <code>static char &#42;raw_or(const char &#42;obj, const char &#42;key) {</code> |
| `serve_dispatch` | function | 289 | <code>static void serve_dispatch(Server &#42;sv, const char &#42;line) {</code> |
| `kill_jobs` | function | 413 | <code>static void kill_jobs(Job &#42;jobs) {</code> |
| `cmd_serve` | function | 429 | <code>int cmd_serve(Cg &#42;cg, const SysInfo &#42;si) {</code> |
