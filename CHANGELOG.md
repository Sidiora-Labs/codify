# Changelog

_Maintained from local Codify snapshots (`cg log`); symbol-level changes are derived from the code graph._

## 2026-09-04 — Codify 0.8.1 writable graph under the editor

- The indexer writes in short chunked `BEGIN IMMEDIATE` transactions with parsing outside the lock, so `cg lsp`, `cg watch`, and `cg mcp` no longer hold the graph database for a whole index while an agent tries to record task state
- CLI writes wait `CG_BUSY_TIMEOUT_MS` (default 30 s) for the lock; a lock that never frees now yields exit 75 with a message naming the holder class, stating that nothing changed, and that the same command is safe to retry
- `cg lsp` and `cg watch` take a short lock wait, defer their own index when the database is busy, and keep answering from the last completed index; they never exit on a lock
- `cg spec status` and other read-only paths no longer take a write lock to sweep expired attempts unless one exists; `cg spec done` warns and checks against the last index instead of failing qualification on a busy database
- Remaining deferred `BEGIN` transactions in memory and git import are `BEGIN IMMEDIATE`, removing the `SQLITE_BUSY_SNAPSHOT` failure mode

## 2026-08-31 — Codify 0.8.0 agent control plane

- Separates spec declarations, fenced live attempts, Git state, and Codify snapshots; stale ownership is diagnosable and explicitly repairable
- Integrates Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, OpenCode, Zed, Windsurf, Cline, and Continue through one capability-aware detect/plan/apply/doctor flow
- Normalizes native lifecycle events into durable session/attempt records with semantic deduplication, occurrence identity, exact workspace revisions, and evidence deltas
- Detects repeated failures, observation loops, patch oscillation, and no-evidence windows; returns a bounded advisory recovery ladder instead of blind continuation
- Adds revisioned work packets that open complete task context once, return compact deltas, and close each criterion against evidence or an explicit unverified result
- Negotiates MCP `2025-11-25`, retains older supported revisions, exposes the control plane through honestly annotated tools, and does not claim list-change notifications it never emits
- Gives generated assets deterministic owners: `cg spec render` owns root workflow instructions; `cg agentmd` owns `.codify/agent-context.md`

## 2026-08-29 — Codify 0.7.5

The VS Code Agent view is now a fuller ACP client rather than a thin chat surface.

- Codex and Claude Code sessions expose their ACP-provided modes, model and reasoning options, session title, context usage, and native commands directly in the panel
- `cg mcp` remains injected as the workspace-scoped Codify server and its connected state is visible beside the agent identity
- A live activity line keeps turn state, active/completed tools, plan progress, permission requests, and queued follow-ups visible while detailed cards remain expandable
- Streamed replies render safe Markdown with nested and task lists, tables, quotes, emphasis, fenced code, editor file links, and VS Code-routed external links
- The context bars, transcript, tool cards, permission actions, and composer now reflow for narrow sidebars and wider editor panels
- ACP protocol and DOM fixtures cover early session updates, mode/config round trips, agent-command namespacing, Markdown, activity state, and responsive layout contracts
- A persistent Past sessions selector merges workspace history with ACP session/list and restores through session/load or session/resume with Codify MCP reinjected
- The Agent header displays the running extension version; the current build packages under the authoritative `SidioraLabs.codify` Marketplace identity

## 2026-08-29 — Codify 0.7.0

The resolution layer: Codify now resolves call references at index time and stores the verdict beside every edge.

**Precision** (schema v10)

- C/C++ aggregate patterns (struct/union/enum) now require a body brace, typedef keyword, or forward-declaration semicolon to record a definition; `struct stat st;` is no longer a false definition
- System `#include <header.h>` recorded with a system flag, so builtins like `printf` and `sqlite3_step` are accounted for
- Prototype collapsing: a function prototype and its definition yield exactly one symbol

**Import resolution**

- Import module strings resolved to repository files per language: relative and rooted paths for TS/JS, package paths for Python, `go.mod` paths for Go, quoted includes for C
- Manifest readers for package.json, go.mod, Cargo.toml, pyproject.toml, and requirements.txt
- Each import classified as repo (resolved to a file), manifest (declared dependency), system (system header), or unknown (strongest finding signal)

**The verdict column**

- Every call reference resolved at index time to at most one target symbol via tiered resolution: same file, then a name this file explicitly imports, then the same directory, then a unique definition repository-wide
- No tier fires → unresolved rather than guessed
- Builtin tables per resolving language (C/POSIX gated on headers actually included, JS/Node globals, Python builtins, Go universe scope)
- Member calls with unresolvable receiver → external (unprovable origin is not evidence)
- `callers_of` and `callees_of` traverse `refs.target_id` for resolved references; name equality survives only as a fallback for unresolved refs
- Resolution stats (internal/external/unknown shares) recorded in meta

**Grounding findings**

- Ungrounded call: verdict unknown, in a resolving language, in a file that passes calibration
- Ungrounded import: origin unknown — the highest-confidence finding the tool raises
- Near-miss: edit distance ≤ 2 against `symbol_fts` suggests the likely intended symbol
- Calibration compares a file's accounted share against the language median; below the floor the file raises no finding

**Contract findings**

- Kind mismatch: a call whose target resolves to a struct/type/enum rather than something callable
- Dead route handler: a handler string that names no symbol in the graph
- Argument counting at call sites (abstains when the count is not confident)

**Hygiene findings**

- Unused imports: an imported name with no reference in its file
- Unused symbols: function/method with no inbound reference, excluding entry points (main, exports, route handlers, test files, dispatch-table names)
- Delta by default: findings restricted to the changed paths

**Surface integration**

- `cg guard` reports grounding, contract, and hygiene findings alongside stale anchors (warnings by default; `--strict` gates)
- `cg check` adds finding counts to its summary
- `cg review` includes the findings the change introduced
- LSP diagnostics publish grounding and contract findings at the offending line
- MCP tools inherit findings through guard and review

**Limits**

- Four languages resolve: C/C++, TypeScript/JavaScript, Python, Go. The remaining fifteen index, carry verdicts, and raise no findings.
- Dynamic dispatch: symbols reachable only through dispatch tables are detected by body-text string matching rather than special-cased.
- Untyped receivers: a member call whose receiver has no known origin is marked external, never unknown.

## 2026-08-27 — Codify 0.6.0

The intent layer: the half of a codebase a parser cannot see, indexed.

**Comment capture** (schema v6 — derived tables rebuilt automatically on upgrade; memories, git history, and leases preserved)

- Comments are first-class graph nodes bound to the symbol they describe: file headers, doc comments above definitions, and multi-line notes, across all 19 languages
- The anchor convention ([docs/ANCHORS.md](docs/ANCHORS.md)): four kinds — purpose, contract, danger, pointer — gated by the derivability test: if an agent could have written the comment by reading the code, it is not an anchor

**Doc-first retrieval**

- `cg context` serves doc + signature instead of body lines where an anchor exists — several times more symbols inside the same token budget; `cg symbol` keeps the body and leads with the doc
- Docs that merely restate the name or signature are dropped mechanically, never served

**The survey tier**

- `cg survey [path|query] [--budget N]`: file purpose lines and symbol docs with signatures, grouped by file — never a body. A hundred dense files fit the default budget in one call
- Uncovered files and symbols are named rather than silently dropped; budget cuts are an explicit omitted count
- Exposed over MCP as `survey`, beside `get_context` and `impact_analysis`

**Soft edges**

- Symbol names, paths, and routes inside anchors resolve into references of kind `soft` — the cross-language and dynamic couplings no parser can derive
- Labeled `(soft)` wherever they surface (`cg impact`, callers, callees, JSON); one parsed call always outranks prose; `--no-soft` excludes them entirely

**Anchor drift**

- Every anchor records a baseline of the code it describes; when the code moves on and the doc does not, the anchor is stale — a derived fact, never stored
- `cg check` warns (`cg anchors --stale` lists them), `cg guard` names anchors your uncommitted work made stale, and retrieval marks stale docs `[stale]` instead of serving them as truth. Advisory throughout: warn, don't block

**Anchor health**

- `cg anchors [--stale] [--uncovered]`: coverage, stale docs, and the backfill work list — uncovered symbols ranked by coordination score (fan-out × extent × distinct referencing files, deliberately not raw inbound reference count)
- The workflow loop now names anchoring: survey before context, anchor what a reader could not derive, and the drift lint keeps it honest

## 2026-08-27 — Codify 0.4.0

Agent-native indexing, sessions, and orchestration.

**Indexing accuracy** (schema v2 — derived tables rebuilt automatically on upgrade; memories, git history, and leases preserved)

- Scope-aware extraction: every definition carries a real `end_line` (brace tracking; indentation for Python), and refs are attributed to the innermost enclosing *function* — or to none — instead of "the last definition above"
- Call refs record their receiver qualifier (`recv.name(`, `recv->name(`, `Recv::name(`) and kind; new per-language `imports` table (js/ts, python, go, c/c++, rust, java, c#)
- Multi-line string state in the line cleaner: Python triple quotes and JS/TS template literals no longer emit junk symbols from continuation lines
- Content-hash rescan skip: touching a file (same content) updates size/mtime only, keeping symbol rowids stable

**Retrieval accuracy and agent efficiency**

- Fused, ranked search: exact/prefix/substring/token tiers union (`find_symbols_all`), scored by kind, resolution-aware reference count, churn, and a −40 penalty on test/fixture/vendor paths; deterministic tie-breaks
- Import-aware call-edge resolution: a ref resolves to one definition — same file, then imported file, then same directory, then shallowest path
- Token budgets: `cg context --budget` (default 4000) and `-n K`, `cg impact --budget` (default 8000); compact `name path:line` form for every repeated symbol, explicit `omitted` counts where a budget bites
- `cg changes --limit` with default caps (40 symbols, 8 external callers each) and `(+N more)` markers; `cg show --full` with a truncation marker; full-text hits now carry a line number

**Sessions and lease integrity**

- `cg handoff` (`--done` / `--next` / `--blocked` / `-m`): one structured handoff memory per task, each superseding the last
- `cg resume [--prompt]`: task packet, latest handoff, task-scoped memories, uncommitted paths, lease state — `--prompt` renders a paste-ready briefing for a fresh session
- `cg spec ready`: all eligible tasks across waves, with live-claim conflicts marked
- `cg spec claim-next`: atomic conflict-free claim (spec-file flock + `BEGIN IMMEDIATE`) returning task + lease + memories; exit 3 on an empty frontier
- Lease ownership enforced: no claiming over a live foreign lease, release needs the owner or `--force`, `done`/`implemented` auto-release; kvx rewrites are flock-protected; agent identity from `--agent` > `$CG_AGENT` > `agent`
- `cg brief` memories are task-scoped first, deduplicated, and capped

**Orchestration**

- `cg spec run` (new `src/orchestrate.c`): claims eligible tasks and drives one agent process per slot — `codex exec --sandbox workspace-write`, `claude -p --permission-mode acceptEdits`, or a custom `/bin/sh -c` template with `${PROMPT_FILE}` `${TASK}` `${ROOT}` `${AGENT}`
- Prompts seeded from `cg resume --prompt` into `.codegraph/agents/<feature>-<id>.prompt`; child output logged beside them; failed tasks release their lease and record an outcome memory; `-n`, `--driver`, `--dry-run`, `--max-fail`, `--agent-prefix`
- Configured in `spec/workflow.kvx` `[agents]`: driver, cmd, max, ttl, codex_args, claude_args

**VS Code extension**

- Agent sessions from the task board (`agents.js`): start on task (terminal or headless), hand off, resume, run a wave, stop — with lease decorations, a graph.db watcher, and `codify.agent.*` settings for driver, paths, args, and parallelism
- **The agent view** (`acp.js`, `agentpanel.html`): a persistent chat view in the Codify sidebar backed by a zero-dependency Agent Client Protocol (v1) client — the adapter (Claude Code or Codex) spawns lazily on the first message, no task required, with a driver picker and New Chat; streamed replies and collapsed thinking, tool-call cards with diffs, the agent's plan, permission requests as inline buttons, and Stop as `session/cancel`. Task starts route into the view (busy view offers replace-or-open-beside; editor panels carry concurrent task sessions)
- Chat surface: markdown rendering with copyable code blocks, clickable file paths, an autosizing composer with history, and a `/` palette over the `cg` verbs (`/brief`, `/context`, `/impact`, `/review`, `/check`, `/task`, …) whose output is shown as a card and handed to the agent as context
- Panel sessions carry the task's `cg resume --prompt` packet as the opening prompt and inject Codify's MCP server (`cg mcp`) into `session/new`, so every agent gets all cg tools without repo config; ACP fs reads/writes are served by the extension and refused outside the workspace root
- `codify.agent.interface` (`panel` | `terminal`, default `panel`) decides how Start Agent Session opens; the terminal is offered as fallback when the adapter fails; adapters configured by `codify.acp.claudeCommand` / `codexCommand` / `customCommand`
- Board discipline is shared with the terminal path: claim in parallel mode, release on failed starts, handoff/release offered when a session ends unqualified; `$(comment-discussion)` marks tasks with a live panel

**MCP**

- 37 tools (was 32): `spec_ready`, `spec_claim_next`, `spec_release`, `handoff`, `resume`; `get_context` gains `budget`/`limit`, `impact_analysis` gains `budget`, `change_impact` gains `limit`, `spec_claim` gains `ttl`

## 2026-08-22 06:16 — Name parallel mode in the spec usage string (`ff44e79bf262`)

**1 file changed** (0 added, 1 modified, 0 deleted), **+1 −1 lines**

- Modified `src/spec.c` (+1 −1)

## 2026-08-22 06:15 — Codify v0.3.0 (`188f1c0d82ad`)

**2 files changed** (0 added, 2 modified, 0 deleted), **+2 −2 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+1 −1)

## 2026-08-22 06:15 — Cover root boundaries and out-of-project refusals [spec:codify-v03/6.1] (`9bbc1f41e99a`)

**1 file changed** (0 added, 1 modified, 0 deleted), **+29 −0 lines**

- Modified `tests/integration/09_root.sh` (+29 −0)

## 2026-08-22 06:14 — Document v0.3: governance, git interop, authoring, and the LSP [spec:codify-v03/6.1] (`6686101b7be8`)

**5 files changed** (0 added, 5 modified, 0 deleted), **+156 −26 lines**

- Modified `README.md` (+89 −15)
- Modified `docs/ARCHITECTURE.md` (+63 −7)
- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/cg.h` (+1 −1)

## 2026-08-22 06:10 — Add a Language Server over the graph [spec:codify-v03/5.2] (`48935542c4c2`)

**8 files changed** (2 added, 6 modified, 0 deleted), **+748 −8 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/cg.h` (+8 −0)
- Modified `src/graph.c` (+6 −5)
- New file `src/lsp.c` (+522)
  - added macro `LSP_KIND_FN` (line 21)
  - added function `lsp_read` (line 27)
  - added function `lsp_send` (line 46)
  - added function `lsp_reply` (line 51)
  - added function `lsp_notify` (line 58)
  - added function `uri_to_path` (line 68)
  - added function `path_to_uri` (line 84)
  - added function `rel_of` (line 92)
  - …and 9 more symbols
- Modified `src/main.c` (+3 −0)
- Modified `src/spec.c` (+16 −0)
  - added function `spec_active_touches` (line 2393)
- New file `tests/integration/13_lsp.sh` (+190)

## 2026-08-22 06:05 — Extract MCP annotation, resource, and prompt writers [spec:codify-v03/5.1] (`171fce9bc0a9`)

**1 file changed** (0 added, 1 modified, 0 deleted), **+67 −49 lines**

- Modified `src/mcp.c` (+67 −49)
  - added function `mcp_tool_annotations` (line 586)
  - added function `mcp_list_resources` (line 592)
  - added function `mcp_list_prompts` (line 633)

## 2026-08-22 06:04 — Modernize the MCP surface: annotations, resources, prompts, negotiation [spec:codify-v03/5.1] (`ba012ffac78c`)

**4 files changed** (0 added, 4 modified, 0 deleted), **+495 −28 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/mcp.c` (+426 −24)
  - added function `t_show` (line 191)
  - added function `t_why` (line 199)
  - added function `t_test_impact` (line 207)
  - added function `t_brief` (line 214)
  - added function `t_review` (line 215)
  - added function `t_check` (line 216)
  - added function `t_guard` (line 217)
  - added function `t_git_sync` (line 225)
  - added function `t_spec_wave` (line 230)
  - added function `t_spec_lint` (line 235)
  - added function `t_spec_new` (line 240)
  - added function `t_spec_add` (line 249)
  - added function `t_spec_claim` (line 280)
  - added macro `S_FEATURE` (line 323)
  - added macro `S_PATHOPT` (line 325)
  - added macro `S_NAMEOPT` (line 328)
  - added macro `S_CLAIM` (line 331)
  - added macro `S_ADD` (line 334)
  - added macro `A_READ` (line 353)
  - added macro `A_WRITE` (line 355)
  - added macro `A_MUTATE` (line 357)
  - added struct `stat` (line 699)
  - added struct `dirent` (line 714)
  - added struct `stat` (line 718)
- Modified `tests/integration/04_mcp.sh` (+66 −1)

## 2026-08-22 06:00 — Collapse repeated spec outcomes by their real source tag [spec:codify-v03/4.2] (`e6e8c4a4072a`)

**1 file changed** (0 added, 1 modified, 0 deleted), **+1 −1 lines**

- Modified `src/memory.c` (+1 −1)

## 2026-08-22 05:59 — Collapse repeated spec outcome memories at write time [spec:codify-v03/4.2] (`f05b3dcfa87a`)

**4 files changed** (0 added, 4 modified, 0 deleted), **+42 −4 lines**

- Modified `spec/codify-v03/spec.kvx` (+2 −2)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/memory.c` (+24 −0)
- Modified `tests/integration/08_memory.sh` (+14 −0)

## 2026-08-22 05:58 — Add brief, review, guard, and hook install [spec:codify-v03/4.1] (`6bb5ff7b1f1b`)

**11 files changed** (0 added, 11 modified, 0 deleted), **+763 −31 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/cg.h` (+7 −0)
- Modified `src/db.c` (+3 −0)
- Modified `src/govern.c` (+426 −0)
  - added function `active_task_json` (line 175)
  - added function `cmd_brief` (line 190)
  - added function `path_in_scope` (line 264)
  - added function `cmd_guard` (line 294)
  - added function `cmd_review` (line 364)
  - added function `write_exec` (line 496)
  - added function `cmd_hook_install` (line 516)
  - added function `cmd_hook_install_git` (line 552)
- Modified `src/graph.c` (+51 −20)
- Modified `src/main.c` (+38 −3)
- Modified `src/memory.c` (+120 −5)
  - added macro `SUPERSEDED_RANK` (line 99)
  - added function `memory_supersede` (line 272)
  - added function `cmd_recall_near` (line 295)
  - added function `cmd_memory_compact` (line 335)
- Modified `src/spec.c` (+13 −0)
- Modified `tests/integration/08_memory.sh` (+38 −0)
- Modified `tests/integration/10_lifecycle.sh` (+64 −0)

## 2026-08-22 05:52 — Gate expired and overlapping task leases in cg check [spec:codify-v03/3.2] (`300a45fa693a`)

**2 files changed** (0 added, 2 modified, 0 deleted), **+49 −0 lines**

- Modified `src/govern.c` (+30 −0)
- Modified `tests/integration/12_authoring.sh` (+19 −0)

## 2026-08-22 05:52 — Surface live task claims on the board [spec:codify-v03/3.2] (`7f1de25f73be`)

**2 files changed** (0 added, 2 modified, 0 deleted), **+62 −1 lines**

- Modified `src/spec.c` (+46 −1)
  - added function `spec_live_leases` (line 1180)
- Modified `tests/integration/12_authoring.sh` (+16 −0)

## 2026-08-22 05:50 — Add parallel mode, task leases, and the cg check gate [spec:codify-v03/3.2] (`b3c655d8128d`)

**2 files changed** (0 added, 2 modified, 0 deleted), **+3 −3 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)

## 2026-08-22 05:50 — Add spec authoring: new, add, and lint [spec:codify-v03/3.1] (`3f6b11a0c56a`)

**9 files changed** (2 added, 7 modified, 0 deleted), **+955 −14 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/cg.h` (+6 −0)
  - added function `kvx_set_raw` (line 249)
- New file `src/govern.c` (+139)
  - added function `run_capture` (line 20)
  - added typedef `argc` (line 24)
  - added function `call_spec` (line 26)
  - added function `spec_sub` (line 39)
  - added function `has_spec_repo` (line 49)
  - added struct `stat` (line 51)
  - added function `cmd_check` (line 58)
- Modified `src/kvx.c` (+15 −3)
  - added function `kvx_set_value` (line 372)
  - added function `kvx_set_raw` (line 481)
- Modified `src/main.c` (+4 −0)
- Modified `src/spec.c` (+644 −7)
  - added function `spec_mode_is` (line 700)
  - added function `spec_parallel_mode` (line 714)
  - added function `spec_touches_conflict` (line 1131)
  - added function `spec_wave_cmd` (line 1167)
  - added function `spec_claim_cmd` (line 1225)
  - added function `spec_new_cmd` (line 2030)
  - added function `list_literal` (line 2091)
  - added function `spec_add_cmd` (line 2123)
  - added typedef `b` (line 2188)
  - added function `lint_say` (line 2190)
  - added function `lint_cycle` (line 2202)
  - added function `spec_lint_cmd` (line 2234)
- Modified `tests/integration/05_spec.sh` (+1 −1)
- New file `tests/integration/12_authoring.sh` (+143)

## 2026-08-22 05:44 — Ingest git history, rank by churn, mirror commits into git [spec:codify-v03/2.1] (`ca034a86e12f`)

**8 files changed** (2 added, 6 modified, 0 deleted), **+244 −5 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/cg.h` (+6 −0)
- Modified `src/db.c` (+11 −1)
- New file `src/gitint.c` (+140)
  - added function `git_available` (line 14)
  - added struct `stat` (line 16)
  - added function `cmd_git_sync` (line 24)
  - added function `git_churn_for_path` (line 101)
  - added function `git_commit_mirror` (line 113)
- Modified `src/graph.c` (+4 −0)
- Modified `src/main.c` (+12 −1)
- New file `tests/integration/11_git.sh` (+68)

## 2026-08-22 05:42 — Address symbols by position so editors can ask with a cursor [spec:codify-v03/1.2] (`0de71208ad40`)

**6 files changed** (0 added, 6 modified, 0 deleted), **+55 −5 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/cg.h` (+2 −0)
- Modified `src/graph.c` (+37 −1)
  - added function `symbols_at_position` (line 777)
  - added function `graph_symbol_at` (line 794)
- Modified `src/main.c` (+1 −1)
- Modified `tests/integration/10_lifecycle.sh` (+12 −0)

## 2026-08-22 05:41 — Tokenize multi-word queries and derive entry points from them [spec:codify-v03/1.1] (`a0c698e48e77`)

**7 files changed** (1 added, 6 modified, 0 deleted), **+561 −10 lines**

- Modified `spec/codify-v03/spec.kvx` (+1 −1)
- Modified `spec/codify-v03/tasks.md` (+2 −2)
- Modified `src/cg.h` (+7 −0)
  - added function `vcs_commits_for_path` (line 181)
- Modified `src/graph.c` (+416 −7)
  - added macro `MAX_TOK` (line 133)
  - added function `tokenize` (line 136)
  - added function `ci_contains` (line 153)
  - added typedef `r` (line 161)
  - added function `cand_add` (line 163)
  - added function `cand_cmp` (line 178)
  - added function `find_symbols_tokenized` (line 189)
  - added function `ep_interesting` (line 262)
  - added function `ep_push` (line 269)
  - added function `ep_climb` (line 277)
  - added function `context_entry_points` (line 294)
  - added function `cmd_show` (line 774)
  - added macro `TEST_PATH_SQL` (line 816)
  - added function `graph_path_is_test` (line 823)
  - added function `tests_for_symbol` (line 835)
  - added function `cmd_test_impact` (line 863)
  - added function `cmd_why` (line 921)
- Modified `src/main.c` (+11 −0)
- Modified `src/vcs.c` (+53 −0)
  - added function `vcs_commits_for_path` (line 1049)
- New file `tests/integration/10_lifecycle.sh` (+71)

## 2026-08-22 05:36 — Expand nested gitignore rules for direct and deep matches [spec:codify-v03/0.2] (`0e90a5643d71`)

**1 file changed** (0 added, 1 modified, 0 deleted), **+14 −4 lines**

- Modified `src/util.c` (+14 −4)

## 2026-08-22 05:35 — Apply nested .gitignore rules scoped to their directory [spec:codify-v03/0.2] (`d054a2d2c90e`)

**2 files changed** (0 added, 2 modified, 0 deleted), **+63 −0 lines**

- Modified `src/util.c` (+49 −0)
  - added function `ig_load_nested` (line 230)
  - added function `ig_walk_gitignores` (line 249)
  - added struct `dirent` (line 256)
  - added struct `stat` (line 264)
- Modified `tests/integration/09_root.sh` (+14 −0)

## 2026-08-22 05:34 — Gitignore-aware ignore rules with negation and anchoring [spec:codify-v03/0.2] (`bea69159418d`)

**2 files changed** (0 added, 2 modified, 0 deleted), **+4 −4 lines**

- Modified `spec/codify-v03/spec.kvx` (+2 −2)
- Modified `spec/codify-v03/tasks.md` (+2 −2)

## 2026-08-22 05:34 — Extract cmd_root so the bound project is one command away [spec:codify-v03/0.1] (`ada0eea57447`)

**3 files changed** (0 added, 3 modified, 0 deleted), **+26 −14 lines**

- Modified `src/cg.h` (+1 −0)
- Modified `src/db.c` (+23 −0)
  - added function `cmd_root` (line 111)
- Modified `src/main.c` (+2 −14)

## 2026-08-22 05:34 — Bound root resolution, honour .gitignore, enable WAL [spec:codify-v03/0.1] (`d90bf243563b`)

Initial snapshot — 81 files.
