# Architecture

One binary (`cg`), one SQLite database (`.codegraph/graph.db`), no
dependencies beyond libsqlite3. C11 + POSIX. Every module is a single
`.c` file; `src/cg.h` is the only header.

## Data flow

```
        walk (ignore rules)            pthread workers            single writer
files ───────────────────────► jobs ──────────────────► parsed ───────────────► SQLite
                                        (regex-based                 (short chunked
                                         language specs)              transactions)
```

- **`sysinfo.c`** sizes the pipeline before anything runs: effective cores =
  min(online, affinity mask, cgroup v1/v2 CPU quota); honest memory =
  `MemAvailable` ∩ cgroup limits. Workers, SQLite page cache, and mmap
  budgets derive from that, so the same binary behaves sanely on a
  16-core workstation and a 512 MB container.
- **`scan.c`** walks the tree, diffs (mtime, size) against the `files`
  table, fans changed files out to a worker pool through a bounded ring
  buffer, and writes results back on the main thread in short chunked
  transactions (`INDEX_CHUNK` files per `BEGIN IMMEDIATE`). Parsing happens
  outside the lock, so the write lock is held for milliseconds at a time
  and every other `cg` process gets a turn between chunks. When the lock
  cannot be taken within the caller's wait, the index stops at a chunk
  boundary, records `index_pending_resolve` so the next run finishes edge
  resolution, and returns busy instead of exiting — the LSP and the
  watcher defer and retry; CLI commands report it (see below).
- **`lang.c` / `routes.c`** are table-driven: a language is a comment/string
  spec plus POSIX ERE definition patterns; a framework route is one regex
  row. Adding a language or framework is adding a table entry. Extraction
  is scope-aware: each definition gets a real `end_line` (brace-depth
  tracking for brace languages, indentation for Python), each call ref
  records its immediate receiver qualifier (`recv.name(` / `recv->name(` /
  `Recv::name(`) and a ref kind, and per-language import patterns fill an
  `imports` table (one row per imported name; `*` for whole-module).
  `clean_line` keeps persistent state across lines for block comments *and*
  multi-line strings (Python triple quotes, JS/TS template literals), so
  string continuation lines never emit junk symbols.
- **`scan.c`** attribution uses those scopes: a ref belongs to the innermost
  *function-like* definition whose `[line, end_line]` contains it, and refs
  contained by no definition get a NULL symbol — a call between two
  functions is no longer credited to the one above it. A rescan whose
  content hash is unchanged (touch, branch switch) updates size/mtime only,
  so symbol rowids stay stable.
- **`db.c`** owns the schema: `branches`, `files` (scoped by `branch_id`,
  `UNIQUE(branch_id, path)`), `symbols`, `refs` (with `qual` and `kind`),
  `imports`, `routes`, `meta`, `memories` (with `branch`, `class`,
  `confidence`), `memory_superseded`, `git_commits`, `git_churn`,
  `leases`, fenced `attempts` (with `branch`, `worktree`, `parent`),
  the `agents` registry, normalized `runtime_events`, incremental
  `runtime_files`, revision baselines in `work_packets` / `work_files`,
  and criterion-linked `work_evidence`, plus three FTS5 tables — trigram
  over symbol names and their split name words (substring and word
  search), unicode61 over file bodies (word search), and unicode61 over
  memory bodies. C/C++ prototypes are `symbols` rows with `decl=1` that
  end at their own `;`; `refs.target_id` is indexed (see
  [retrieval.md](retrieval.md)). The schema is versioned in
  `meta.schema_version` (`cg_schema_upgrade`, currently v17): on a mismatch
  the derived tables — everything the indexer rebuilds from source — are
  dropped and recreated for the next sync, while the branch and agent
  registries, memories, git history, attempts, runtime history, and work
  evidence are never touched. A database written by a *newer* `cg` is
  refused rather than downgraded, so an old editor binary and a new CLI
  cannot take turns re-indexing the tree.
  It also resolves the project root, which is load-bearing:
  `cg_find_root_at` stops the upward walk at a `.git`/`go.mod`/
  `package.json`-style boundary, at `$HOME`, and at a mount change, so a
  stray `.codegraph` in an ancestor can never silently capture a project
  beneath it. `cg_find_project_at` returns both halves — the tree to
  operate on and the shared project that owns the database — which differ
  only inside a linked git worktree, where the shared project is found
  through git's common directory. `CODIFY_ROOT` overrides the walk;
  `cg root` prints the answer.
- **`graph.c`** implements the query commands (`search`, `symbol`,
  `impact`, `context`, `routes`) with `--json` variants. Ranking fuses
  exact, prefix, substring, and token tiers (`find_symbols_all` — no
  exact-match short-circuit), then scores by kind (functions and types
  above macros and vars), resolution-aware reference count, git churn, and
  a hard penalty on test/fixture/vendor paths; ties break on refs then
  path, deterministically. Call edges resolve a name to *one* definition:
  same file, then a file the ref's file imports (module path matched
  against candidate paths), then same directory, then shallowest path.
  Output is budgeted: `context` (default 4000 tokens) and `impact`
  (default 8000) emit each symbol in full once and as a compact
  `{"n","at"}` form on every repeat, cut sections carry an explicit
  `omitted` count, full-text hits carry a line number, and `show`
  truncates long bodies with a `use --full` marker.

## Version control (`vcs.c`, `sha256.c`)

Content-addressed snapshots: blobs and commit objects under
`.codegraph/objects/<aa>/<hash>`, a manifest per commit (sorted
`hash size\tpath` lines), `HEAD` pointing at the last commit. Diffs are
LCS at line level. `cg changes` joins the working-tree diff against the
graph to list touched symbols and their external callers. `cg commit`
tags its message with the in-progress spec task when one exists.

## Database locking (`db.c`)

The graph is one SQLite file in WAL mode, shared by every `cg` process in
a checkout: the editor's `cg lsp`, `cg watch`, `cg mcp`, and each agent's
CLI calls. Only one writer exists at a time, so the rules are about who
waits and for how long.

- Every write transaction is `BEGIN IMMEDIATE`, taken through
  `cg_begin_write`, so a writer either has the lock or knows it does not;
  a deferred `BEGIN` that upgrades mid-transaction would fail with
  `SQLITE_BUSY_SNAPSHOT` and lose the work.
- CLI commands wait `CG_BUSY_TIMEOUT_MS` (default 30 s) for the lock. An
  agent updating task state during an editor index therefore waits a
  moment and succeeds. Only after the whole wait does `cg_exec` print an
  actionable message — which process class holds the lock, that nothing
  was applied, that the same command is safe to retry — and exit 75
  (`CG_EXIT_BUSY`, EX_TEMPFAIL) rather than a generic "database is locked".
- Long-lived servers (`cg lsp`, `cg watch`) set a short `lock_wait_ms`
  and never exit on busy: their index is deferred and retried later, and
  they keep answering from the last completed index meanwhile.
- Read-only paths must not take the write lock: `spec_attempt_sweep`
  checks for expired attempts before it opens a write, so editor board
  polling of `cg spec status` does not compete with agents' writes.
- `spec done` refreshes the graph before its checks; if the database is
  still busy after the full wait it warns and checks against the last
  index rather than failing qualification on a lock.

## Sync gate (`syncgate.c`)

Database locking decides who *writes*; the gate decides who *walks*.
`.codegraph/index.lock` is `flock`'d by the one process running an index
pass; a loser appends the paths it wanted to `.codegraph/index.dirty`
(guarded by its own small lock, renamed per-pid before it is drained) and
returns `coalesced` without walking. The holder drains the note in at most
three bounded passes before releasing. A freshness window keyed by
`meta.last_index_at:<branch>` lets a caller skip the walk entirely, and
machine-wide `slot.N` files under `/tmp/codify-<uid>` ration parse threads
across concurrent projects — a pass without a slot runs on two threads
rather than claiming the machine. A linked worktree gets its own lock and
note keyed by branch id. `IndexOpts` (freshness, lock wait, worker cap,
background, target paths) and `IndexStats` (`fresh`, `coalesced`, `busy`,
`scoped`, `passes`, `workers`) are the whole interface between callers and
`cg_index_ex`. Full contract: [sync.md](sync.md).

## Watcher (`watch.c`)

Recursive inotify with dynamic directory registration and a debounce
loop; each quiet period triggers an incremental index through the sync
gate, so the watcher coalesces with hooks rather than racing them. A busy
database turns into a retry after the next debounce. Non-Linux platforms
stub out behind the same interface.

## Fleet (`fleet.c`)

The hierarchy that turns one repository into a tree of agents. `hier_load`
reads `[hierarchy]` and `[role.main|feature|worker]` from
`spec/workflow.kvx` over built-in defaults; `hier_expand` fills `{main}`,
`{remote}`, `{feature}`, `{wave}`, and `{task}` in the branch and agent
templates. `hier_role_caps` resolves each role's capabilities (driver,
model, args, max, wall, spend, retries, stall, approve) into a `RoleCaps`,
reporting unusable values instead of dropping them.
Identity comes from the environment (`CG_AGENT`, `CG_ROLE`, `CG_PARENT`,
`CG_FEATURE`, `CG_WAVE`) and is recorded in the `agents` registry only when
a role is set, so solo sessions leave no trace. The branch lifecycle —
`fleet_worker_begin`, `fleet_merge_up`, `fleet_feature_land`,
`fleet_pr_open`, `fleet_checkpoint` — drives `git` and `gh` through the
helpers in `gitint.c`, always against the shared project (the main
worktree), and shares the spec engine's claim primitives rather than
adding a second ownership system. `merge-up` and `land` take the
feature's merge lock (`fleet_merge_lock`, an `flock` on
`.codegraph/fleet/merge-<feature>.lock`), which is what lets a manager and
its workers run at the same time. `fleet_gate` is the opt-in approval
gate: for a fleet agent whose workflow lists the gate, it records a
pending row in `fleet_approvals` and returns `CG_EXIT_APPROVAL` (4) until
`cg fleet approve` decides it, and an approval is consumed by the one
command it let through. `cg fleet tree` is dispatched here but
implemented as `orch_tree_status` in `orchestrate.c`, beside the run it
reports on. Full contract: [hierarchy.md](hierarchy.md).

## Event log (`events.c`)

One append-only `events` table (`seq`, `at`, `kind`, `subject`, `run`,
`node`, `branch`, `payload`), added without a schema bump. Triggers on the
durable tables emit inside the writer's own transaction, so an event never
outlives a rolled-back change and an older binary emits without knowing
it; they are installed on every open, after the schema upgrade, because
two of them name columns only v16 adds. The kvx status hook reports task
transitions, which live in `spec.kvx` rather than SQLite, and
`events_emit` covers what has no row: merges, gates, pull requests,
supervisor decisions, drift, agent output. `events_since` reads from a
cursor with a kind filter (a trailing `.` or `*` is a prefix). Retention
prunes by count (`CG_EVENTS_KEEP`, default 50000); `AUTOINCREMENT` keeps a
sequence number from ever being reused, and `meta.events_pruned_through`
tells a lagging reader it missed events. Full contract:
[events.md](events.md).

## Serve (`serve.c`)

`cg serve` is the editor's one connection: newline-delimited JSON-RPC 2.0
on stdio with `initialize`, `tools/list`, `tools/call`, `exec`, `cancel`,
`subscribe`, `unsubscribe`, `ping`, and `shutdown`. It shares the MCP tool
table with `cg mcp` rather than keeping a second list. Every call runs in a
child — the binary re-executed in its own process group — so a long
`verify_cmd` never delays an event push, calls run concurrently (up to
32), and `cancel` is a signal. The server's own connection only reads: it
waits on inotify over the database files (a 150 ms stat poll elsewhere,
plus a one-second safety check), coalesces a burst of WAL writes, and
pushes `events_since` each subscriber's cursor. Idle, it holds no lock and
runs no index pass. `cg tool list|call` (`cmd_tool` in `mcp.c`) runs the
same table from a shell.

## Drivers (`drivers.c`)

How an agent is launched and read back. `driver_argv` builds the argv from
a `DriverSpec` — driver, model, extra args, custom template, and whether to
ask for structured output, which is the default: `claude -p --output-format
stream-json --verbose` and `codex exec --json`. A `DriverTap` follows the
agent's log by byte offset and `driver_stream_parse` turns each complete
JSON line into `agent.*` events (session, text, tool, usage, result), in
either dialect, recognised per line. `driver_steer` queues a message as an
`agent.steer` event; `driver_steer_take` hands the undelivered ones to the
post-edit hook (Claude Code's `PostToolUse` `additionalContext`) or to the
next prompt, advancing a per-agent cursor in `meta`.

## Drift (`drift.c`)

`drift_spec_check` compares a task's git diff with its declared `touches`
and `symbols` (public symbols whose lines a hunk overlaps) and runs at
`cg spec done` and `cg fleet merge-up`. `drift_collision_predict` flags two
open tasks whose touch globs overlap or whose declared symbols are the
same or call one another; the supervisor's slot picker serializes those
pairs. `drift_interface_check` runs after a merge into a feature branch: it
diffs the signatures of the merged symbols and finds references on other
live branches through the unified graph, then steers the agents on them
and their managers. `coverage_check` lists acceptance criteria with no
qualified task, before `land`. All four record events and warn; only the
`drift` and `coverage` approval gates block. Full contract:
[drift.md](drift.md).

## Jev decisions (`jev.c`)

The one remote call. `jev_ask` builds a canonical request body (sorted
question names and criteria keys, compact, state verbatim) for `noul`,
`choice`, and `score` questions, runs the system `curl` through `popen`
with a private `0600` config file so the key never reaches a command line
nor the body a shell, retries `429`/`529` with doubling backoff, and
appends one JSON line per call to `.codegraph/jev.log`. A missing
`OPENROUTER_API_KEY` is an error, never a fallback; every answer is advice,
and no answer changes an exit code.

Three callers live inside commands that must keep working without Jev, so
they share one gate: `jev_advisory_ready` checks the key in a single place
and `jev_advisory_failed` makes a broken call read like a missing one.
`jev_triage_failure` classifies a red `verify_cmd` from the tail of its
output (last 40 lines, 4 KiB), `jev_rank_findings` scores up to 50 `cg
guard` findings in one request, and `jev_pr_readiness` scores a feature
branch for the pull request body. A caller that only adds a line to its
output can ignore the return value: the fields stay empty and it prints
nothing. Full contract: [jev.md](jev.md).

## Skills (`skills.c`)

What happens to a memory Jev classed a `skill`. `cg skills promote` renders
one memory as `.agents/skills/<slug>/SKILL.md` — the portable format every
agent host reads — and `cg skills render` refreshes every file already
written. Two invariants keep it honest. The file carries Codify's
`codify-owned:` marker (the same convention `integrate.c` uses for every
asset it writes) naming the memory it came from, and a file without that
marker is never overwritten. And promotion lives in the file, not in the
database: `memories.class` stays Jev's opinion of the note, so
re-classifying never silently un-promotes a skill in use — it only makes
the rendered copy stale.

## Agent surface (`mcp.c`, `agent.c`, `json.c`)

`cg mcp` is a newline-delimited JSON-RPC 2.0 stdio server exposing 57
tools, each carrying read-only/destructive annotations so a client can
auto-approve reads instead of prompting on every search. It also serves
resources (the workflow file, rendered board, graph context, and every
feature spec) and prompts (the workflow loop itself,
so Codify's opinion travels to any client). `initialize` negotiates a
protocolVersion the server actually speaks, including `2025-11-25`, rather
than echoing the client's. List-change capabilities remain false because
the server emits no list-change notifications. CLI command output is captured via `dup2` + tmpfile
(`cg_capture`), so the CLI and MCP surfaces share one implementation.
`json.c` is a minimal scanner (no DOM) used for JSON-RPC parsing and
`package.json` introspection. `cg mcp-install` splices the server into
agent configs without a full JSON parser by inserting after the root
key's opening brace.

`integrate.c` is the vendor-neutral adapter registry. Every host declares
MCP, instruction, skill, hook, session, and cloud capabilities as native,
portable, or unavailable. Detect and plan are read-only; apply merges the
canonical `codify` server, backs up existing files, and installs portable
Agent Skill and lifecycle shims; doctor reports incomplete, malformed,
stale, unsupported, or conflicting ownership.

Generated assets have one writer each. `cg spec render` owns root workflow
instructions (`AGENTS.md`, `CLAUDE.md`, and IDE pointers). `cg agentmd`
owns only `.codify/agent-context.md`, a deterministic graph projection.
Running either generator therefore cannot overwrite the other's source or
projection.

## Agent control plane (`runtime.c`, `govern.c`)

Declared task status is not runtime liveness. Claims create durable attempt
ids and monotonically increasing fencing tokens; heartbeats renew only the
matching generation, and completion refuses an expired or superseded owner.
`cg state` labels Git, Codify snapshots, spec declarations, live attempts,
and stale contradictions independently. Reconciliation diagnoses by default
and repairs only with an explicit flag.

Lifecycle adapters feed one JSON object to `cg event ingest`. The runtime
normalizes common host fields, preserves session/attempt/task identity, and
records both a semantic fingerprint and a transition-sensitive occurrence
fingerprint. Workspace revisions are content manifests cached by nanosecond
metadata, so heartbeats avoid re-reading unchanged files without missing
same-second edits. Activity, changed output, evidence deltas, and
implementation progress remain separate facts.

The progress classifier inspects a bounded event window for repeated
failure, repeated observation, patch oscillation, and no-evidence activity.
It emits one step from a finite recovery ladder (warn, re-plan, bounded
experiment, handoff, waiting input, stop), never a recursive continuation.
Policy is advisory unless enforcement is explicitly enabled.

Work packets join the spec, independent state, task memories, graph context,
test impact, and runtime evidence once. Each local opaque revision snapshots
only the hashes needed for later comparison; updates contain state,
evidence, and workspace deltas rather than replaying the full packet. Close
pairs criteria with durable manual or lifecycle evidence and names every
remaining criterion as unverified.

Release qualification keeps these contracts executable. The isolated
`22_control` suite covers stale declaration repair, lease expiry and fencing,
heartbeat renewal, semantic event deduplication, bounded no-progress recovery,
integration planning/apply/doctor idempotence, current and legacy MCP
negotiation, and revisioned work deltas. `make test` runs that suite with the
unit tests and every other integration fixture before `cg check` verifies the
rendered spec, task evidence, claims, and tree state.

## Spec engine (`kvx.c`, `spec.c`)

`kvx.c` parses the Ion `.kvx` format (ordered sections, `key = "value"`,
`${ENV}` interpolation) and can surgically rewrite a single `status`
line, preserving every other byte; the rewrite takes an advisory `flock`
on a `<file>.lock` side file, so parallel agents' read-modify-writes on
the same spec.kvx are atomic across processes. `spec.c` renders IDE
pointer files and the markdown mirror byte-identically to the original
Go `specgen` (locked in by golden fixtures under
`tests/fixtures/specrepo/`), and drives the task loop: wave-ordered
`next`, one-in-progress `start`, `verify_cmd`-gated `done`. When the
repo also has a `.codegraph/`, `done` additionally checks the task's
declared `symbols` against the graph and its `touches` globs against
worktree changes plus commits tagged with the task, and `cg spec trace`
walks task → symbols → commits.

Parallel mode adds a dispatch frontier with integrity guarantees.
`spec ready` lists every eligible task across waves with a
`conflicts_with_live` flag; `spec claim-next` picks and claims the first
conflict-free one under the spec-file flock plus a `BEGIN IMMEDIATE`
transaction, returning the full task packet (task + lease + task-scoped
memories) — exit 3, not an error, on an empty frontier. Leases have
owners: claiming a task held live by someone else is refused, releasing
one requires the owner's name or `--force`, and `done`/`implemented`
auto-release on success. Agent identity comes from `--agent`, then
`$CG_AGENT`, then `"agent"`, and in parallel mode "the current task"
means the one the agent holds a live lease on.

## Agent memory (`memory.c`)

Deliberate notes (`decision`/`constraint`/`outcome`/`preference`/`fact`)
in the `memories` table of graph.db, linked to spec tasks by
`feature/id`. `cg remember` defaults its task link to the in-progress
one; `cg spec done` records terse outcome memories automatically —
refusals included — via a quiet no-reindex open, so the spec engine
still works without a graph. Retrieval (`cg recall`, MCP `recall`) is
FTS5 over the body: free text becomes OR'd quoted prefix terms ranked by
bm25, recency breaking ties. `spec next`/`start` surface task-linked and
title-matched memories; `trace` appends the task's memories to its
chain.

Memories travel between graphs as JSONL (`cmd_memory_export`,
`cmd_memory_import`; format in [memory-transport.md](memory-transport.md)).
`memory_content_id` is the SHA-256 of type, task and body, so the same
note has the same id in every graph: import inserts only the ids the
target lacks, relinks supersession by id, and runs as one write
transaction that folds the per-row `memory.add` events into a single
`memory.import`. `--from DIR` opens the other project's `graph.db`
read-only and feeds it through the same parser, so a graph older than
the class, confidence, and branch columns still imports.

## Project configuration (`config.c`)

`codify.kvx` at the root of a tree is optional; `config_load` parses it
once per root into a cached, mutex-guarded `CgConfig` and every caller
asks an accessor instead of joining a literal. `config_spec_dir`,
`config_workflow_path` and `config_feature_path` replace each
`<root>/spec` join in the spec engine, orchestrator, fleet, docs, drift,
guard, recap and MCP resources; `config_context_path`,
`config_skills_dir` and `config_codemap_path` do the same for
`.codify/`, `.agents/skills/` and `CODEMAP.md`. A path that is absolute,
empty, escapes the tree, or lands in `.git/` or `.codegraph/` is
rejected with a message naming the key, and the default stands.
`config_auto_sync` gates the implicit syncs — the freshness pass before
read commands, the post-edit hook, the pre-commit index, `work open`,
MCP `sync_first` tools, the LSP, the watcher, fleet watch and integrate
— while `cg sync`, `cg index` and qualification still index.
`config_check` reports unknown sections, keys and unusable values;
`cg check` shows them as warnings. See [config.md](config.md).

## Code map (`codemap.c`)

`cmd_codemap` writes `CODEMAP.md` (or the `[paths] codemap` file) and
`codemap_render` builds it from tables the index already holds: files,
symbols, refs, imports, routes and comments, plus README prose and
build manifests read from the tree. Every list has a total order and
nothing carries a timestamp or an absolute path, so the same graph
renders the same bytes; the map's own path is excluded inside the SQL,
so writing it cannot make it stale. Each droppable entry carries a tier
and a reference count; a bisection drops the lowest tier and the least
referenced first until the text fits the token budget, and each section
says what it left out. The first line is an ownership marker recording
the budget: a file without it is never overwritten without `--force`,
and `--check` and `cg brief` (`codemap_status`) re-render at the
recorded budget and compare bytes. See [codemap.md](codemap.md).

## Git interop (`gitint.c`)

`cg git-sync` pipes `git log --name-only` into `git_commits` and
`git_churn` — no libgit2, no new link-time dependency. Churn then feeds
the fused ranking in `find_symbols_tokenized`, lifting code that is
actually being worked on. `cg commit --git` mirrors a snapshot into a
real git commit carrying the same `[spec:feature/id]` tag, and
`ignore_load` reads `.gitignore` (including nested ones, with negation
and anchoring) alongside `.cgignore`. Adopting Codify is therefore never
all-or-nothing.

## Changelog (`changelog.c`)

`src/changelog.c` is the git-history changelog renderer. `cmd_changelog_git`
reads tags and commits through `git` pipes, groups each subject by its
`area:` prefix, turns a trailing `[spec:<feature>/<task>]` into a task
reference, and builds commit and compare links from `git remote get-url
origin` (with no remote, bullets carry the bare hash and the footer is
omitted). Release boundaries are tags merged with version bumps:
`boundaries_load` walks the history of the project's version file
(`src/cg.h` `CG_VERSION`, `VERSION`, or `package.json`) and starts a
release at every commit that changed the version. The newest section is
named by the working tree's version when that is newer than the last
boundary, by `--tag`, and only otherwise `[Unreleased]`. For a tags-only
repository with no version file, the output matches `cliff.toml`, the
git-cliff configuration at the repository root; git-cliff is a
reference, never a runtime dependency.

Optionally a model adds prose. With `CENTRA_API_KEY` (or
`CG_CHANGELOG_KEY`) in the environment or the project's `.env`, each
release gets a `### Highlights` block written from its grouped commits by
an OpenAI-compatible endpoint (`CG_CHANGELOG_ENDPOINT`,
`CG_CHANGELOG_MODEL`), called through `curl` with a private `0600` config
file as Jev does. The bullets are never altered. Answers are cached under
`.codegraph/changelog-cache/`, keyed by the release's commit range, the
model, and the notes, so a rerun asks only about what is new; a failed
call prints why on stderr and leaves the notes without prose. The
snapshot renderer in `vcs.c` stays as the `--snapshots` mode and as the
fallback for a project with no `.git`.

## Recap (`recap.c`)

`src/recap.c` builds a resume brief from the transcripts Claude Code and
Codex keep locally. `find_claude` maps the root to
`~/.claude/projects/<root with non-alphanumerics as "-">/*.jsonl`;
`find_codex` walks `~/.codex/sessions` and keeps the rollouts whose
`session_meta.cwd` is the root or under it. The newest `--sessions`
within `--since` days are parsed line by line with the `json.c` readers
(`parse_claude`, `parse_codex`) into statements: a user's own words
(`user_words` unwraps `<user_query>`, drops reminders, notifications and
compaction summaries), each paragraph or bullet of an assistant message
(`assistant_words` skips headings, tables and code fences), files edited,
and commands that committed, built, or tested. Thinking and tool output
are never read. A session is capped (`sess_cap`) to its newest user
requests plus the newest of the rest.

The decision pass (`decide_all`) cuts each session into chunks of six
statements and asks the System One endpoint three typed questions per
statement — kind (choice over eight), still true (noul), needed to resume
(noul) — with the chunk, the session's cleaned ending, and its title as
the state. It goes through `jev_ask_at`, the Jev client pointed at
another key, model and endpoint (`openrouter/upstage/solar-decide` at the
Centra gateway's `/v1/systemone`), so the request builder, private-config
curl, retries and `jev.log` are shared. The endpoint bills each question
against the whole state and caps a request at 100 questions, so chunks
stay small and `decide_parallel` forks workers that fill the cache
(`.codegraph/recap-cache/<sha of state|model>.txt`, one line per
statement) and exit; the parent's own pass then reads it. Forking rather
than threading keeps jev's per-pid request files apart.

`select_picks` scores a statement as P(kind) × P(still true) × P(needed),
drops noise and anything under 0.5 on either noul, and fills `--budget`
characters best first. `render_decided` writes the decided log —
sessions oldest first as `[sN]`, each picked statement with its three
probabilities — to `.codegraph/recap/decided.md`. `repo_facts` adds what
the repository says on its own: the active feature and task counts from
the kvx, HEAD, dirty count and the window's commits from git, and the
newest decision, constraint, handoff and fact memories. `write_brief`
hands FACTS and the DECIDED LOG to `chat_model_ask` (the changelog's
gateway model) with the section list and the rule to invent nothing and
cite `[sN]`; the brief lands at `-o` (default `.codify/recap.md`) under a
comment naming both models and the counts. `--decided` stops before the
writer; `--facts` runs no model at all.

## Governance (`govern.c`)

The commands that put Codify inside the loop rather than at its ends:
`cg brief` (session state in one call — task-scoped memories first,
padded with recent, deduplicated, bodies capped), `cg review` (changed
symbols paired with the acceptance criteria they claim and the callers
now at risk), `cg guard` (edits outside the in-progress task's declared
`touches`), and `cg check` (the single CI gate: render staleness, lint,
task evidence, lease consistency, worktree state). They read the spec
through `cmd_spec`'s own `--json` output via `cg_capture`, so there is
one implementation of the task model rather than two.

`govern.c` also owns session continuity. `cg handoff` writes one
structured memory of type `handoff`
(`handoff|done:…|next:…|blocked:…|note:…|files:…`, files = current
uncommitted paths) linked to the task; each new handoff supersedes the
previous live one through the `memory_superseded` chain, so there is
exactly one current handoff per task. `cg resume` reverses it for a
fresh session: task packet, the latest handoff parsed back into fields,
task-scoped memories, uncommitted paths, and lease state — `--prompt`
renders the bundle as a paste-ready briefing, which is also what the
orchestrator and the VS Code extension feed to agent sessions.

Everything here is advisory by default. `cg guard` exits zero unless
`--strict`, which is what makes `cg hook install` safe: wiring it into a
`PostToolUse` hook or a pre-commit hook can report scope drift without
ever breaking a workflow that was working before.

## Orchestrator (`orchestrate.c`)

`cg spec run` composes the primitives above into a driver of agent
processes: `claim-next` picks a conflict-free task per free slot,
`resume --prompt` (captured in-process via `cg_capture`) writes its
briefing to `.codegraph/agents/<feature>-<id>.prompt`, and `fork`/`exec`
hands that prompt on stdin to the configured driver — `codex exec
--sandbox workspace-write --skip-git-repo-check -C <root>`, `claude -p
--permission-mode acceptEdits`, or a custom `/bin/sh -c` template with
`${PROMPT_FILE}` `${TASK}` `${ROOT}` `${AGENT}` substituted — with
stdout+stderr captured to `.codegraph/agents/<feature>-<id>.log`.
Configuration is the `[agents]` section of `spec/workflow.kvx` (driver,
cmd, max, ttl, codex_args, claude_args); the custom template is read
uninterpolated so kvx's own `${ENV}` expansion cannot eat the
placeholders.

The reserved `@docs` item enters this same loop after the numbered frontier is
qualified. `claim-next` gives it a normal lease and fenced attempt, while its
prompt is produced by `cg docs packet` instead of `cg resume`. The child must
finish with `cg docs close`; a plain exit, direct `spec docs done`, or stale
owner is incomplete and follows the existing release/retry path. No completion
command recursively launches another orchestrator.

Success is judged by the spec, not the exit code alone: after `waitpid`,
the task's status is re-read — `done`/`implemented` count as success
(the lease was auto-released by the completion), anything else releases
the lease and records an auto `outcome` memory (`agent exited rc=N
without completing`). The loop stops on an empty frontier or when
failures exceed `--max-fail`; SIGINT terminates the children, releases
their leases, and exits 130. `--dry-run` prints waves, tasks, and the
exact argv per task without claiming anything. Requires a `.codegraph/`
and parallel or prod mode.

### The supervisor (`--fleet`, `cg fleet up`)

`cg spec run --fleet` wraps that loop in the hierarchy, and `cg fleet up`
runs it detached: `detach_supervisor` forks a `setsid` child running `cg
spec run --fleet --run-id <id>` with its output in
`.codegraph/fleet/supervisor-<run>.log`, and returns once the child has
recorded the run. `supervisor_run` owns one or more features, each its own
run; `supervisor_tick` is one pass over persisted state — reap, progress,
budgets, retries, escalation, approvals, spawn. The `fleet_runs` and
`fleet_nodes` tables hold everything a later supervisor needs (every node's
role, parent, agent, task, branch, worktree, pid and start time, attempt,
fence, retries, spend), so `--resume` adopts a child whose pid and
`/proc` start time still match and judges any other by its branch tip.

`orch_spawn_manager` starts a feature manager in the feature worktree and
`orch_spawn_worker` a worker per free slot — per task when the worker
template names `{task}`, per wave otherwise — each through the role's
driver capabilities, with the role, parent, feature, wave, branch, base,
and run exported and the branch already checked out. Workers and managers
run concurrently; the merge lock in `fleet.c` serializes their merges.
The main agent, when `[hierarchy] main_agent` asks for one, is a driver
process woken at start, on a blocked task, and when a feature finishes.

Supervision is four named checks: `supervisor_stall_check` (progress is an
event by or about the agent, log growth, or a git status/HEAD change in its
worktree; one idle window nudges through `driver_steer`, a second stops the
attempt with a handoff), `supervisor_budget_check` (wall and spend),
`supervisor_retry` (the next attempt's prompt carries the previous
attempts' reasons, last output, and outcome memories), and
`supervisor_escalate` (manager, then main, then blocked while the run
continues). A run ends when the subtree is **merged**, not when a process
exits, and a manager has a wake budget (16 by default, `--max-rounds`).
`orch_tree_status` renders the same join for `cg fleet tree` and
`--status`. Without an enabled `[hierarchy]` the flag is refused before
anything is spawned, and the single-level path above is untouched.

### Briefings (`govern.c`)

`task_packet_build` composes a worker's briefing within a token budget
from parts in priority order — the task with its criteria and scope, the
declared symbols' definitions with callers and callees, what required
tasks introduced on the feature branch (`packet_upstream_evidence`), live
siblings' touches, decisions, and the file map — and `packet_assemble`
drops lower parts first when the budget is short. `manager_packet_build`
does the same for a feature manager: subtree state, live workers, failed
attempts, conflicted merges, and pending approvals. `cg work update`
gains an `upstream` delta (`work_upstream_delta`) naming the tasks merged
into the attempt's base since it began and the symbols they brought.

## Documentation closure (`docs.c`)

The [documentation walkthrough](DOCUMENTATION.md) covers operation and recovery. For exact indexed declarations, use the [source reference](SOURCE-REFERENCE.md); [test-only observations](TEST-REFERENCE.md) are kept separate from product interfaces.

The main entry points are `docs_packet`, `docs_check`, and `docs_close` in `src/docs.c`. `spec_docs_stage` in `src/spec.c` computes effective state, while `spec_docs_finish` couples the successful snapshot with fenced completion. A `docs_check` claim proves the existence and mapping it checks, not the semantics of every sentence in a document.

Documentation closure is a projection over existing authorities, not a second
source of truth. Its inputs are the active kvx feature, qualification and trace
output, task-tagged Codify snapshots and changelog, graph symbols and routes,
anchors, memories, command results, and the repository's existing Markdown/RST
inventory. Packet generation captures each source's exit status and labels
unavailable evidence instead of filling the gap with an inference.

Derived state is isolated at `.codegraph/docs/<feature>/`:

- `packet.md` is the bounded agent brief.
- `provenance.json` records evidence sources and baseline mode.
- `claims.kvx` maps factual claims and audience coverage to public documents
  and repository evidence; the agent may edit it.
- `required.kvx` is regenerated from the changed public symbols and routes the
  open branch holds, so a shared fleet graph does not derive a path's surface
  once per worktree.
- `check.json` and `verified` are deterministic checker outputs.
- `baseline.json` records the successfully closed workspace revision.

The lifecycle is `waiting -> pending -> in_progress -> done`, with `blocked`
and reset paths. Implementation qualification is never rolled back by a docs
failure. Closure rechecks evidence and uses process-local authorization, not an
editable closing marker. It records a snapshot explicitly tagged `<feature>/@docs`
before completing the attempt under its ownership fence. A failed snapshot leaves
the stage and attempt in progress. `.codegraph/docs/baseline.json` makes the next
feature's plan incremental; per-feature baselines remain available for trace.
The effective state remains
`legacy` for old specs and `off` when project policy disables the stage.

## VS Code agent sessions (`editors/vscode/agents.js`)

The extension's counterpart to the orchestrator, in the same
zero-dependency plain JS as the rest of `editors/vscode/`. It claims a
task (`spec claim` + `spec start`), writes a prompt file from
`cg resume --task <id> --prompt`, and launches the configured driver in
a named terminal or as a headless VS Code task; closing a terminal whose
task is unfinished offers to release the claim. A 10-second poll —
active only while sessions exist — keeps the task board fresh,
decorating tasks with the lease-holding agent and a terminal marker.
Every refresh in the extension, this poll included, goes through one
scheduler (`editors/vscode/refresh.js`): a single chain of `cg` calls at
a time (`sync --max-age --background --wait 0`, `spec status`,
`spec trace --no-sync`, `recall`, `guard`), bursts debounced into one
run, a floor between runs, and at most one trailing run queued. The
extension does not watch `graph.db`, because its own sync writes it and
a watcher there made every refresh trigger the next. Every `cg` verb is
called defensively, so an older binary fails with a message rather than
a hang; the manifest-coherence test keeps declared and registered
commands in lockstep.

Against a `cg` that has `serve`, the polling above is off.
`editors/vscode/serve.js` holds one `cg serve` child for the whole
extension: every `cg` call goes down it as an `exec`, events come back as
pushed notifications, and `applyEvent` folds each into a small live model
the task, memory, and fleet views patch themselves from. It reconnects
with a backoff and takes one full refresh after a reconnect, since events
pushed while the pipe was down are gone. With `codify.serve` off, or an
older binary, the extension shells out and polls as before. `fleet.js`
builds the Start plan from `cg fleet roles`, a dry run, `cg drift
collisions`, and `cg fleet runs`, and folds agent and supervisor events
onto the tree. In the chat (`agents.js`), `ChatCapabilities` turns the
served tool list into slash commands with arguments typed from each
tool's input schema, `approvalCard` renders an approval request as an
actionable card, and `Window` keeps a transcript at ten thousand entries
responsive by keeping only the newest rows in the DOM.

## Language server (`lsp.c`)

`cg lsp` speaks Content-Length framed JSON-RPC 2.0 on stdio and answers
definition, references, hover, document and workspace symbols, and code
lens straight from the graph — no compiler, no toolchain, no project
configuration. Reading reuses `json.c`, the same scanner the MCP server
uses; LSP's zero-based positions are converted at the boundary.

The server refreshes the graph on `initialized`, `didOpen`, and `didSave`
with a 1.5 s lock wait; when another process holds the lock it logs one
"index deferred" line to stderr, keeps serving from the last index, and
retries on the next message after 3 s. It never blocks an agent's write
for long, and it never dies on a lock.

Diagnostics are the reason it exists as much as navigation: an
unparseable kvx file and an edit outside the active task's `touches` are
published as squiggles, so governance reaches the editor without anyone
running a command. Hover joins all four layers — what the symbol is, how
many references it has, and the decisions recorded about it.

## Tests

- `tests/unit/` — standalone binaries linked against `build/libcg.a`
  (everything except `main.o`): kvx grammar, SHA-256 vectors, JSON
  scanner, StrBuf/file IO.
- `tests/integration/` — shell scripts driving the real binary in
  temp sandboxes: graph queries, VCS flows, changelog/agentmd/
  mcp-install, the MCP protocol, the spec engine against Go-generated
  goldens, graph-verified completion + trace, agent memory, the inotify
  watcher, root-resolution boundaries and .gitignore (`09_root`), the
  read and governance lifecycle (`10_lifecycle`), git interop
  (`11_git`), spec authoring and the CI gate (`12_authoring`), the
  language server driven as a real editor would (`13_lsp`), the VS Code
  extension without VS Code — syntax checks, manifest coherence, the
  LSP client against the real binary (`14_vscode`) — indexing accuracy:
  scope attribution, stable rowids on touch, schema migration
  (`15_accuracy`), ranking and budgets (`16_retrieval`), claim-next
  atomicity plus handoff/resume round-trips (`17_session`), the
  orchestrator run end to end on a custom driver (`18_orchestrate`), the
  ACP agent client (`19_acp`), the intent layer's anchors (`20_anchors`),
  import resolution and manifest grounding (`21_grounding`), the control plane (`22_control`), database locking
  (`23_dblock`), documentation closure (`24_docs`), the sync gate
  (`25_syncgate`), the fleet lifecycle and role capabilities (`26_fleet`),
  branch-scoped reads (`27_branches`), Jev against a fake curl
  (`28_jev`), the git changelog and its highlights against a fake
  endpoint (`29_changelog`), the event log (`30_events`), `cg serve`
  push latency and idle locking (`31_serve`), the supervisor's runs,
  resume, supervision, and approvals (`32_supervisor`), drift
  (`33_drift`), worker and manager briefings and the upstream delta
  (`34_context`), and the
  fleet end to end under failure, straight and with the supervisor killed
  and resumed (`35_fleet_e2e`), and the recap's transcript parsing,
  decision pass, cache and writer against fixture transcripts and both
  fakes (`36_recap`), declarations, phrase ranking, path outlines and the
  context budget against a gold set (`37_explore`), the code map's
  sections, determinism, budget and ownership (`38_codemap`), memory
  export and import across graphs (`39_memory_port`), and `codify.kvx`
  with a relocated spec directory and auto-sync off (`40_config`).
