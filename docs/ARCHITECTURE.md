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
- **`db.c`** owns the schema: `files`, `symbols`, `refs` (with `qual` and
  `kind`), `imports`, `routes`, `meta`, `memories`, `memory_superseded`,
  `git_commits`, `git_churn`, `leases`, fenced `attempts`, normalized
  `runtime_events`, incremental `runtime_files`, revision baselines in
  `work_packets` / `work_files`, and criterion-linked `work_evidence`,
  plus three FTS5 tables — trigram over symbol names (substring search),
  unicode61 over file bodies (word search), and unicode61 over memory
  bodies. The schema is versioned in `meta.schema_version`
  (`cg_schema_upgrade`): on a mismatch the derived tables — everything the
  indexer rebuilds from source — are dropped and recreated for the next
  sync, while memories, git history, attempts, runtime history, and work
  evidence are never touched.
  It also resolves the project root, which is load-bearing:
  `cg_find_root_at` stops the upward walk at a `.git`/`go.mod`/
  `package.json`-style boundary, at `$HOME`, and at a mount change, so a
  stray `.codegraph` in an ancestor can never silently capture a project
  beneath it. `CODIFY_ROOT` overrides the walk; `cg root` prints the
  answer.
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

## Watcher (`watch.c`)

Recursive inotify with dynamic directory registration and a debounce
loop; each quiet period triggers an incremental index. A busy database
turns into a retry after the next debounce. Non-Linux platforms stub
out behind the same interface.

## Agent surface (`mcp.c`, `agent.c`, `json.c`)

`cg mcp` is a newline-delimited JSON-RPC 2.0 stdio server exposing 48
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

## Git interop (`gitint.c`)

`cg git-sync` pipes `git log --name-only` into `git_commits` and
`git_churn` — no libgit2, no new link-time dependency. Churn then feeds
the fused ranking in `find_symbols_tokenized`, lifting code that is
actually being worked on. `cg commit --git` mirrors a snapshot into a
real git commit carrying the same `[spec:feature/id]` tag, and
`ignore_load` reads `.gitignore` (including nested ones, with negation
and anchoring) alongside `.cgignore`. Adopting Codify is therefore never
all-or-nothing.

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
- `required.kvx` is regenerated from changed public symbols and routes.
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
task is unfinished offers to release the claim. A `graph.db` watcher
plus a slow poll — active only while sessions exist — keeps the task
board fresh, decorating tasks with the lease-holding agent and a
terminal marker. Every `cg` verb is called defensively, so an older
binary fails with a message rather than a hang; the manifest-coherence
test keeps declared and registered commands in lockstep.

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
  atomicity plus handoff/resume round-trips (`17_session`), and the
  orchestrator run end to end on a custom driver (`18_orchestrate`).
