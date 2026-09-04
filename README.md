<div align="center">

# Codify

<img src="codify.png">

**The agent workflow tool that scales from small, simple projects to large, complex codebases.**

Pure C11. One binary. One SQLite database. Nothing leaves your machine.

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Language: C11](https://img.shields.io/badge/Language-C11-lightgrey.svg)](#)
[![CI](https://img.shields.io/badge/CI-passing-brightgreen.svg)](.github/workflows/ci.yml)

[English](README.md) · [简体中文](docs/i18n/README.zh-CN.md) · [Español](docs/i18n/README.es.md) · [हिन्दी](docs/i18n/README.hi.md) · [العربية](docs/i18n/README.ar.md) · [Français](docs/i18n/README.fr.md) · [Português (BR)](docs/i18n/README.pt-BR.md)

</div>

---

## Overview

Codify (invoked as `cg`) is an agent workflow engine in a single binary. It maintains the four things a project needs beyond the code itself — what the code **is**, how it got **here**, what happens **next**, and what was **learned** along the way — and serves all four to humans and AI agents alike.

Version 0.8.0 adds a local agent control plane: truthful task/runtime state, fenced attempts, capability-aware integration for ten coding-agent hosts, normalized lifecycle evidence, bounded stall recovery, and revisioned work packets.

**What the code is.** Codify indexes 19 languages into a queryable graph: symbols, call edges, framework-aware routes, and instant full-text search, all stored locally in SQLite. `cg context <query>` answers "catch me up on this area" in one call: entry points, matching symbols with snippets, callers, callees, and related routes. And beyond what a parser sees, comments are indexed as first-class nodes — the intent layer: purpose, contracts, dangers, and the couplings that live only in prose.

**How it got here.** A built-in content-addressed snapshot system gives you commits, history, diffs, and restore with no external VCS required. Because snapshots share a database with the graph, `cg changes` reports the blast radius of your uncommitted edits, and `cg changelog` writes symbol-level release notes by itself.

**What happens next.** A spec engine turns plain-text kvx spec files into a working plan: a task board with dependency waves, acceptance criteria attached to every task — and a `done` that is verified, not asserted. `cg spec new` and `cg spec add` create the plan, `cg spec lint` proves it is executable, and the loop runs it. In Prod mode, `implemented` records coding completion and source evidence without claiming qualification; only `done` means executable qualification and graph checks passed. In parallel mode, several agents work at once, bounded by the disjointness of the paths each task declares.

**What was learned along the way.** An agent memory stores deliberate notes — decisions, constraints, outcomes, preferences, facts — in the same database as the graph, linked to the task they were made under. `cg remember` saves one mid-task, every `cg spec done` records an honest outcome automatically (including refusals), and `cg recall` brings it all back, ranked by relevance and recency.

The layers reinforce each other: commits are auto-tagged with the task they implement, memories surface on the task they belong to, `cg why` walks a symbol back to the decisions behind it, and `cg spec trace` walks any task to its symbols, commits, and memories.

**And it is present between the steps, not only at them.** `cg work open` starts with a compact task packet, `cg work update` returns only new state/evidence/workspace deltas, `cg event progress` classifies loops without mistaking activity for progress, and `cg guard` notices when an edit drifts outside declared scope. A built-in MCP server exposes 48 tools, resources, and prompts to every MCP-capable agent, while `cg integrate` plans, applies, and diagnoses each host's native configuration.

**And it drives agents, not just serves them.** `cg handoff` and `cg resume` move a task between sessions without losing state, `cg spec claim-next` hands an idle agent the next conflict-free task atomically, and `cg spec run` fans a whole wave out to Codex CLI or Claude Code sessions — one sandboxed child process per claimed task, logs and prompts on disk, leases released on failure.

There are no API keys, no background services, and no telemetry. Everything runs on your machine and stays there.

## Why Codify

**It closes the loop from plan to proof.** Most tooling either plans work (task lists) or describes code (search, indexes). Codify does both against the same database, so the plan can be checked against reality: when a task declares it introduces `checkMode` and touches `src/*.ts`, `cg spec done` refuses to mark it complete until the graph and the history agree.

**Agents work like engineers, not tourists.** Instead of wandering a repository file by file, an agent asks `cg spec next` for what to do, `cg context` for everything about the area, and `cg impact` for who breaks — then commits with automatic task attribution. The entire loop is available over MCP, so it never has to leave the protocol.

**The project remembers what sessions forget.** Agent context windows reset; the memory table does not. A decision written once with `cg remember` meets the next session automatically — on `cg spec next`, on `cg spec start`, in `cg recall` at session start — instead of being rediscovered at full price. And because refused completions are recorded too, "this task was blocked twice and here is why" is one query away.

**Context arrives in one call, not twenty — and inside a budget.** `cg context <query>` is designed around how agents actually consume code. One request returns everything needed to start working: relevant memories, where execution enters, what matched, who calls it, what it calls, and which routes touch it — ranked (real definitions above test fixtures, called code above dead code) and fitted to a token budget (`--budget`, default 4000). A symbol is printed in full once; every later mention is a compact `name path:line`, and anything cut by the budget is announced with an explicit omitted count instead of silently dropped.

**Impact analysis is a first-class command.** `cg impact <name> -d 3` walks caller and callee edges transitively and answers the two questions that matter before any change: who breaks if this moves, and what does it depend on.

**Search is instant and layered.** An FTS5 trigram index over symbol names gives case-insensitive substring matching with no warm-up, backed by a word index over full file bodies for everything else.

**The index never goes stale.** `cg watch` listens for native OS events (inotify on Linux, FSEvents on macOS, ReadDirectoryChangesW on Windows, all behind one platform layer) and auto-syncs with debouncing. MCP tool calls also sync before reading, so a connected agent always queries fresh data.

**It adapts to the hardware it runs on.** At startup, `cg` sizes its worker pool and SQLite caches from what the system actually provides: container-aware core counts (the intersection of cgroup v1/v2 CPU quota, the affinity mask, and online CPUs), honest available RAM (`MemAvailable` intersected with cgroup memory limits), and measured per-project cost. A 16-core workstation gets the full parallel pipeline. A 2-core VPS gets one tuned to finish reliably. Run `cg info` to see exactly how the pipeline was sized.

**Everything stays local.** The graph lives in a SQLite database under `.codegraph/`, and snapshots are content-addressed objects under `.codegraph/objects/`. Delete the directory and every trace is gone.

## The intent layer

A parser sees symbols, calls, and routes. It cannot see *why* a function
exists, what its callers must hold true, or that `save_tasks` must run
after `load_tasks` reads the disk — that half of the codebase lives only in
comments. Codify indexes it ([docs/ANCHORS.md](docs/ANCHORS.md) is the full
convention):

- **Anchors** are comments that pass the derivability test — *if an agent
  could have written it by reading the code, it is not an anchor.* Four
  kinds pay: **purpose**, **contract**, **danger**, **pointer**.
- **Doc-first retrieval**: where an anchor exists, `cg context` serves doc +
  signature instead of body lines — several times more symbols per token
  budget.
- **`cg survey`** reads a hundred files for the price of one body: purpose
  lines and docs with signatures, never bodies.
- **Soft edges**: names inside anchors resolve into `(soft)` references —
  cross-language and dynamic couplings no parser can derive, labeled so
  they are never mistaken for parsed calls.
- **Drift honesty**: every anchor baselines the code it describes. When the
  code moves on, the doc is marked stale — in `cg check`, `cg guard`, and
  in retrieval itself — until it is updated or deleted. Warn, don't block.
- **`cg anchors`** ranks uncovered symbols by coordination score (fan-out ×
  extent × referencing files, deliberately not raw popularity) so backfill
  starts at orchestration points, not at `sb_puts`.

None of it is required: a repository that never adopts the convention still
gets capture, survey, and soft edges from whatever comments already exist.

## One session with Codify

```sh
cg brief                      # root, active task + ACs, uncommitted work, prior decisions
cg spec next                  # the next eligible task, ACs + relevant memories
cg spec start 16.7            # claim it — one task in progress at a time
cg context "password auth"    # memories, entry points, symbols, callers, routes in one call
cg why verifyLogin            # who changed it, under which task, and what was decided
cg impact verifyLogin -d 2    # who breaks if this changes
# ...implement...
cg guard                      # anything drifting outside what task 16.7 declared?
cg test-impact                # which tests cover what you just changed
cg remember "sessions rotate on login" --type decision   # linked to task 16.7
cg review                     # the change, paired with the ACs it claims to satisfy
cg commit -m "add password auth"   # snapshot, auto-tagged [spec:ion_spec/16.7]
cg spec done 16.7             # qualification: verify_cmd + graph checks; outcome recorded
cg spec trace 16.7            # proof: task -> symbols -> commits -> memories
```

And when a session has to stop before the task is finished — the context window is full, the day is over — the work does not evaporate:

```sh
# session A, stopping early
cg handoff --done "schema migration; token rotation" \
           --next "wire the login route; extend 03_auth test" \
           --blocked "flaky fixture on CI" -m "rotate on login, not refresh"

# session B, hours later, a fresh context window
cg resume --prompt            # paste-ready block: task, steps done, blockers,
                              # next steps, uncommitted files, lease state
```

A handoff is stored as a structured memory linked to the task; each new one supersedes the previous, so `cg resume` always meets the latest state, not a pile of stale notes.

Every command in that loop is also an MCP tool, so a connected agent can run it end to end — and every step works just as well in a ten-file project as in a monorepo. `cg check` runs the whole gate in CI as a single step, and `cg hook install` wires the sync and the scope check so most of this happens without anyone invoking it.

## Supported languages and frameworks

**Languages:** TypeScript, JavaScript, Python, Go, Rust, Java, C#, VB.NET, PHP, Ruby, C, C++, Swift, Kotlin, Erlang, Solidity, Svelte, Vue, Astro.

**Framework-aware routing:** `cg` links URL patterns to their handlers across Express, Koa, Fastify, Hapi, NestJS, Next.js, SvelteKit, Flask, FastAPI, Django, Rails, Sinatra, Laravel, Spring, ASP.NET, Gin, Echo, Fiber, Chi, Actix, and Axum.

## Installation

Linux x86_64 — one command installs (or updates) a checksum-verified static binary:

```sh
curl -fsSL https://codify.centra.ag/install | bash
```

Uninstall the same way: `curl -fsSL https://codify.centra.ag/uninstall | bash`. Per-project `.codegraph/` data is never touched.

Upgrades are safe on existing projects: the database carries a schema version, and on the first open after an upgrade `cg` rebuilds only the derived index tables (files, symbols, refs, routes, imports, and the search indexes) — the next sync repopulates them. Memories, git history, and leases are never dropped by a migration.

Anywhere else, build from source (dependencies: a C compiler and `libsqlite3-dev`):

```sh
make && sudo make install
```

Then, in any project:

```sh
cd your-project
cg init
```

## Command reference

### Graph

| Command | Description |
|---|---|
| `cg init` | Create `.codegraph/` and build the initial index |
| `cg sync` / `cg index [--full]` | Incremental or full reindex |
| `cg search <q> [-n N]` | Symbol and full-text search |
| `cg symbol <name>` | Definition, snippet, and reference count |
| `cg impact <name> [-d N] [--budget N]` | Transitive callers and callees, fitted to a token budget (default 8000) |
| `cg context <q> [--budget N] [-n K]` | One-call context bundle for agents: memories, symbols, entry points, routes — top K symbols (default 8), fitted to a token budget (default 4000) with explicit omitted counts |
| `cg survey [path\|query] [--budget N]` | The tier below bodies: file purpose lines and symbol docs with signatures across ~100 files per call — never a body. Uncovered files and symbols are named, and anything cut by the budget (default 16000) is an explicit omitted count |
| `cg anchors [--stale] [--uncovered]` | Anchor health: docs whose code moved on, and uncovered symbols ranked by coordination score (fan-out × extent × referencing files) — the backfill work list |
| `cg routes [filter]` | URL pattern to handler table |
| `cg show <symbol\|path:line> [--full]` | Just that symbol's body — by name, or by the cursor position an editor holds; long bodies truncate with a `… (+N more lines, use --full)` marker |
| `cg why <symbol>` | Provenance: the commits that changed it, the tasks they implemented, the decisions recorded |
| `cg test-impact [symbol]` | Tests referencing a symbol — or every symbol in your uncommitted changes |
| `cg watch [--debounce MS]` | Auto-sync on native filesystem events |
| `cg root` | The project root `cg` resolves to from here |
| `cg info` | Machine profile, pipeline sizing, and the bound project root |

### Version control

Snapshots are content-addressed with SHA-256 and blobs are deduplicated.

| Command | Description |
|---|---|
| `cg commit -m <msg>` | Snapshot the working tree; `--git` also makes a real git commit with the same spec tag |
| `cg log` / `cg status` | History, and worktree versus HEAD |
| `cg diff [A] [B]` | LCS line diff between snapshots or the worktree |
| `cg checkout <id> [--force]` | Restore a snapshot |
| `cg changes [--limit N]` | Impact radius of uncommitted edits: the symbols you touched plus their external callers — capped by default (40 symbols, 8 callers each) with `(+N more)` markers; `--limit` overrides |
| `cg git-sync [-n N]` | Ingest git history — commits, authors, per-file churn — which then ranks search and context |

Codify's snapshots do not replace git. `.gitignore` is honoured alongside `.cgignore`, `cg git-sync` reads your real history, and `cg commit --git` writes to both, so adopting Codify is never all-or-nothing.

### Memory

Durable agent notes, stored in the same SQLite database as the graph. Memories written while a spec task is in progress link themselves to it, and `cg spec done` records outcomes automatically. Never store secrets in them.

| Command | Description |
|---|---|
| `cg remember <text>` | Save a memory — `--type decision\|constraint\|outcome\|preference\|fact` (default `fact`), `--task <feature/id>` (defaults to the in-progress spec task), optional `--symbols` / `--files` anchors, `--supersedes <id>` to retire a reversed decision |
| `cg recall [query]` | Search memories: full-text over the body, ranked by relevance then recency; filter with `--task`, `--type`, `-n N`, or `--near <file>` for anchored retrieval |
| `cg forget <id>` | Delete a memory |
| `cg memory compact` | Collapse duplicate memories (`--dry-run` to preview) |

A superseded memory is never deleted — the reversal is history worth keeping. It simply stops leading the results, so a session meets the current decision first.

### Agentic

| Command | Description |
|---|---|
| `cg mcp` | Run as an MCP stdio server: 48 tools, plus resources and prompts (see below) |
| `cg lsp` | Run as a Language Server (stdio) — every editor, not just VS Code |
| `cg integrate detect\|plan\|apply\|doctor` | Capability-aware setup for Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, OpenCode, Zed, Windsurf, Cline, and Continue; planning is read-only, apply is idempotent and backed up |
| `cg mcp-install` | Compatibility alias for `cg integrate apply` |
| `cg hook install` | Wire agent and git hooks so the graph stays fresh and scope drift surfaces on its own |
| `cg changelog [-n N] [-o FILE]` | Changelog from snapshots with symbol-level diffs: added and removed functions, new routes |
| `cg agentmd [--write]` | Generate graph orientation at `.codify/agent-context.md`; root `AGENTS.md` and `CLAUDE.md` remain owned by `cg spec render` |

### Agent control plane

Codify keeps four independent authorities explicit: Git state, Codify snapshot state, declared spec state, and live fenced attempts. `cg state` shows them together without treating one as proof of another; `cg spec reconcile` diagnoses orphaned declarations and mutates only with `--repair`.

Native host hooks feed JSON to `cg event ingest`. Each event gets a stable semantic identity, occurrence fingerprint, session/attempt identity, exact workspace revision, and evidence delta. `cg event progress` classifies repeated failure, repeated observation, A-B patch oscillation, and no-evidence windows. Recovery is finite—warn, re-plan, bounded experiment, handoff, waiting for input, optional stop—and advisory unless `CG_PROGRESS_ENFORCE=1` explicitly enables the terminal policy.

`cg work open` composes the objective, criteria, allowed scope, independent state, memories, focused graph context, tests, and latest event into one packet. Its opaque revision feeds `cg work update`, which returns only changed state, evidence, and workspace paths. `cg work close` pairs every criterion with durable evidence or marks it unverified.

The adapter registry reports native, portable, or unavailable capabilities for MCP, instructions, skills, hooks, sessions, and cloud execution. Portable assets live under `.agents/` and `.codify/`; existing host configs are merged with recoverable `.codify.bak` copies. Everything remains local: integrations execute the local `cg` binary, runtime records stay in `.codegraph/graph.db`, and Codify performs no network calls or telemetry.

### Governance

These four are what make Codify present at every step rather than only at the bookends. All of them advise by default; only `--strict` makes them fail.

| Command | Description |
|---|---|
| `cg brief` | Session state in one call: root, active task with its criteria, uncommitted paths, recent decisions |
| `cg review` | The change paired with what it claims: changed symbols, callers now at risk, and the task's acceptance criteria |
| `cg guard [paths] [--strict]` | Edits falling outside the scope the in-progress task declared in `touches` |
| `cg check [--strict]` | The single CI gate: render staleness, spec lint, task evidence, claim consistency, worktree state |
| `cg state` | Separately label Git, snapshot, spec declaration, live-attempt, and stale state |
| `cg event ingest\|history\|progress` | Normalize host lifecycle JSON and classify novel evidence versus activity or loops |
| `cg work open\|update\|close` | Open compact work context, retrieve revision deltas, and close criteria against evidence |
| `cg handoff` | Record session state against a task before stopping: `--done "a;b"`, `--next "a;b"`, `--blocked "x"`, `-m <note>`, `--task <id>` (defaults to your current task). Stored as a structured memory; each handoff supersedes the previous one for the task |
| `cg resume [--task <id>] [--prompt]` | Everything a fresh session needs to pick a task up: the task packet, the latest handoff (parsed back into done/next/blocked), task-scoped memories, uncommitted paths, lease state. `--prompt` renders it as a paste-ready block for a new agent session |

All query commands accept `--json`. That flag, the MCP server, and the language server are the agent-native interfaces.

## Spec workflow

The spec workflow is how Codify turns a feature plan into tracked, verified work. Specs live as plain-text kvx files — readable by humans, diffable, and owned by your repository — and Codify renders them into IDE rule files and markdown mirrors while driving the task loop on top. It works in any repository containing `spec/workflow.kvx`, is fully independent of `.codegraph/`, and is a drop-in C replacement for Ion's `spec/specgen` with byte-identical output.

| Command | Description |
|---|---|
| `cg spec new <feature>` | Scaffold `spec/<feature>/spec.kvx` — and `spec/workflow.kvx` when the repo has none — and make it active |
| `cg spec add <id> --title T` | Insert a task, preserving every other byte: `--wave`, `--requires`, `--symbols`, `--touches`, `--verify`, `--do "a;b"`, `--reqs` |
| `cg spec lint` | Validate the plan: `requires` cycles, requires pointing at unknown tasks, tasks with no acceptance criteria, dead `touches` globs. Exits 2 on errors |
| `cg spec render [--check]` | Regenerate IDE pointer files (Cursor, Devin, Claude, Codex, Copilot, Kiro) and the markdown mirror (`requirements.md`, `design.md`, `tasks.md`); `--check` exits 2 if anything is stale |
| `cg spec` / `cg spec status` | Task board: mode plus separate `done`, `implemented`, `in_progress`, and `pending` counts, progress, the current task, the next eligible one, and any live claims |
| `cg spec mode <prod\|standard\|parallel>` | Configure dependency and concurrency semantics; absent or unknown mode is standard |
| `cg spec wave` | Every eligible task in the current wave, not just the first |
| `cg spec ready` | Every eligible task across **all** waves, grouped by wave, each marked when its `touches` conflict with a live claim — the full frontier an orchestrator can dispatch |
| `cg spec claim <id>` / `release <id>` | Lease a task to an owning agent with an expiry (`--agent`, `--ttl` minutes); claiming refuses a task another agent holds live, and releasing someone else's lease requires that agent's name or `--force` — no silent steals. `done` and `implemented` release the task's lease automatically |
| `cg spec claim-next` | Atomically claim the first eligible task whose `touches` conflict with neither in-progress tasks nor live leases (file lock + one transaction), and return the full packet: task, lease, task-scoped memories. Exits 3 when the frontier is empty — distinct from an error |
| `cg spec run` | Orchestrate a parallel or Prod wave: claim eligible tasks and drive one agent process per slot — see [Driving agents](#driving-agents). `-n N`, `--driver codex\|claude\|custom`, `--dry-run`, `--max-fail K`, `--agent-prefix P` |
| `cg spec next` | The lowest-wave pending task whose `requires` are satisfied (`done` only in standard mode; `implemented` or `done` in Prod mode), with its do-bullets and expanded acceptance criteria |
| `cg spec start <id>` | Mark a task `in_progress`; enforces one at a time and met `requires`, with `--force` to override |
| `cg spec implemented <id>` | In Prod mode, run source graph checks without executing `verify_cmd`, then mark coding complete as `implemented` (unchecked; qualification pending; no `--force`) |
| `cg spec done <id>` | From `in_progress` or `implemented`, run the task's `verify_cmd` and graph checks; mark it `done` only when qualification passes, otherwise preserve `implemented` |
| `cg spec trace [<id>]` | Trace tasks to code: declared symbols resolved in the graph (location, kind, refs), touched paths matched against actual changes, the commits tagged with the task, and its memories |

`mode`, `start`, `implemented`, and `done` rewrite only the single `status = "..."` or mode setting line in the kvx file. Every other byte, comment, and blank line survives. The command then quietly re-renders so the checkboxes in `tasks.md` stay current; implemented tasks remain unchecked and carry `Implemented - qualification pending`. The kvx files remain the single source of truth, and `-f <feature>` overrides `[meta] active_feature`.

`cg commit` automatically tags its message with the in-progress task, for example `... [spec:ion_spec/16.7]`, so `cg log` and `cg changelog` trace every snapshot back to the spec. The spec commands are also exposed as MCP tools, letting a connected agent plan (`spec_new`, `spec_add`, `spec_lint`), drive the standard loop (next, start, snapshot, done) or the Prod loop (next, start, snapshot, implemented, qualification, done), and work the parallel frontier (`spec_ready`, `spec_claim_next`, `spec_release`, `handoff`, `resume`) without leaving the protocol.

### Parallel mode

Standard and Prod mode both run one task at a time. Agents increasingly do not — a fan-out of five or twenty is ordinary now, and the failure that follows is always the same: two of them editing the same files.

`cg spec mode parallel` keeps Prod mode's `implemented`-unlocks-implementation semantics and relaxes only how many tasks may be in flight, because the plan already declares each task's `touches`. That makes overlap knowable before any work starts:

```sh
cg spec ready                         # the whole frontier: every eligible task, every wave,
                                      # conflicts with live claims marked
cg spec claim 4.1 --agent alice       # a lease with an owner and an expiry
cg spec start 4.1                     # refused if another live task claims the same paths
cg spec claim-next --agent bob        # or skip the choosing: atomically claim the first
                                      # conflict-free task and get the full packet back
```

`claim-next` is the primitive a fleet runs on: the pick and the claim happen under a file lock and a single database transaction, so twenty agents calling it at once get twenty different, disjoint tasks — or exit code 3 when the frontier is empty. A claim held by another agent can be neither taken nor released out from under it (`--force` exists, and is loud). Finishing honestly is automatic: `cg spec done` and `cg spec implemented` release the task's lease themselves.

Leases expire, so an agent that dies holding one does not wedge the wave; `cg check` reports expired leases and overlapping live claims as problems.

When the project also has a `.codegraph/` index, tasks can declare what their implementation looks like. `cg spec implemented` checks source evidence without running commands; `cg spec done` performs executable qualification against reality:

```ini
[task.2.1]
title   = "Check mode"
symbols = ["checkMode"]      # must exist in the code graph
touches = ["src/*.ts"]       # a matching path must actually have changed
```

`symbols` are looked up in the indexed graph; `touches` patterns (exact paths or globs) are matched against the union of worktree changes and the files changed by commits tagged with the task — so verification still passes after the work has been committed. In Prod mode, `implemented` satisfies downstream `requires` but is not qualified and never renders as `[x]`; if qualification fails, the task remains `implemented`. `cg spec trace [<id>]` shows the full task→code→commit chain for one task or the whole feature, in text or `--json`.

The workflow also feeds the memory layer on its own. Every completion writes a terse outcome memory — including refused ones, so a later session can see that a task was blocked and why. `cg spec next` and `cg spec start` print the memories relevant to the task (linked by id, or matching its title), and `cg spec trace` includes them in the chain. An agent driving the loop builds up project memory without ever being asked to.

## Driving agents

Everything above serves an agent that already exists. Codify can also be the thing that starts them: from the terminal with `cg spec run`, or from VS Code one task at a time.

### The orchestrator: `cg spec run`

`cg spec run` turns a parallel spec into running agent sessions. It loops the same primitives a human fleet would use — `claim-next` picks a conflict-free task, `resume --prompt` writes its briefing — then forks one driver process per slot, feeding each the prompt on stdin and capturing its output to a per-task log:

```
$ cg spec run -n 3
[run] task 2.1 → codex (agent run-1, log .codegraph/agents/myfeature-2.1.log)
[run] task 2.3 → codex (agent run-2, log .codegraph/agents/myfeature-2.3.log)
[run] task 2.1 exit 0 → status done
...
[run] frontier empty — 0 failure(s) this run
```

Configuration lives in `spec/workflow.kvx`, next to everything else the workflow owns:

```ini
[agents]
driver      = "codex"        # codex | claude | custom
max         = 3              # default slot count (-n overrides)
ttl         = 3600           # lease TTL, seconds
codex_args  = ""             # extra arguments for the codex driver
claude_args = ""             # extra arguments for the claude driver
cmd         = ""             # custom driver: a shell template with
                             # ${PROMPT_FILE} ${TASK} ${ROOT} ${AGENT}
```

The safety posture is deliberate. The `codex` driver runs `codex exec --sandbox workspace-write --skip-git-repo-check -C <root>`, so children get Codex CLI's workspace-write sandbox — they can edit the project and nothing else. The `claude` driver runs `claude -p --permission-mode acceptEdits`: headless, edits auto-accepted, everything riskier still gated by Claude Code's own permission system. The `custom` driver hands your own command template to `/bin/sh -c` with the prompt file, task id, root, and agent name substituted — which is also how the orchestrator tests itself without either CLI installed.

Completion is judged by the spec, not the process: after a child exits, the task's status is re-read. `done` or `implemented` means success (the lease was already auto-released); anything else releases the lease so the task returns to the pool, and records an outcome memory — `agent exited rc=N without completing` — so the failure is knowledge, not just a log line. The run stops when the frontier is empty, or when failures exceed `--max-fail` (default 2). Ctrl-C terminates the children, releases their leases, and exits 130; nothing stays claimed by a dead run. `--dry-run` prints the full plan — waves, tasks, the exact argv per task — and claims nothing.

Orchestration requires a `.codegraph/` index (leases live there) and `cg spec mode parallel` (or `prod`); anything else is refused with a one-line hint.

### The agent view (VS Code)

The Codify sidebar carries a persistent **Agent** chat view: the extension is an [Agent Client Protocol](https://agentclientprotocol.com) client that spawns Claude Code or Codex through its ACP adapter (`claude-code-acp` / `codex-acp`, or any ACP agent via `codify.acp.customCommand`) lazily on your first message — no task required, a driver picker in the header, New Chat to reset. The view renders streamed replies and thinking, tool calls as live status cards with diffs, the agent's plan, and permission requests as inline buttons. Every session gets **Codify's MCP server injected automatically** (`cg mcp`), so the agent has the graph, spec, and memory tools with zero per-repo config; the agent's ACP file reads and writes are served by the extension and confined to the workspace.

The chat itself is a real chat: markdown replies with headings, tables and fenced code blocks that copy in a click, every file path the agent mentions clickable to that line, collapsed thinking, an autosizing composer with history, and a context bar carrying the feature, the attached task's live status, and the driver. Typing `/` opens a palette of **Codify's own verbs** — `/brief`, `/next`, `/context`, `/search`, `/impact`, `/why`, `/changes`, `/review`, `/tests`, `/check`, `/status`, `/remember`, `/handoff`, `/task`, `/open` — each of which runs the real `cg` command in the workspace, shows the output as a card, *and* hands it to the agent as context. Asking "what breaks if I change this?" and running `cg impact` are the same gesture.

**Start Agent Session on Task** drives the same chat with the board discipline: it claims the task, seeds the opening prompt from `cg resume --task <id> --prompt`, and runs the session in the view (or, when the view is busy, in an editor panel beside it — concurrent task sessions each get their own). Set `codify.agent.interface: "terminal"` for the classic seeded terminal instead — that path is also offered automatically when the adapter fails to start.

**Run Agent Headless on Task** runs the claim + prompt as a background VS Code task (`codex exec --sandbox workspace-write` or `claude -p`) and reports the exit as a notification. **Run Wave with Agents** launches `cg spec run -n <codify.agent.parallelism>` in a terminal. **Hand Off Task** and **Resume Task in Agent Session** wrap `cg handoff` and `cg resume`, and **Stop Agent Session** ends a session — a panel or terminal closing with the task unfinished offers a handoff and releases the claim. While sessions run, the task board watches `graph.db` and decorates each task with the agent holding its lease. See [editors/vscode/README.md](editors/vscode/README.md).

## Editors

### Language server

`cg lsp` is a Language Server over the same graph, so every editor gets Codify — not just the one with an extension. It needs no compiler, no toolchain, and no project configuration: everything is answered from `.codegraph/`.

| Capability | What you get |
|---|---|
| Go to definition, find references | Straight from the `symbols` and `refs` tables |
| Hover | What the symbol is, how many references it has, **and the decisions recorded about it** |
| Workspace and document symbols | Instant trigram-backed lookup across the project |
| Code lens | Reference count and test-reference count above every function — coverage gaps become visible while reading |
| Diagnostics | kvx parse errors, and files edited outside the in-progress task's declared `touches` |

That last row is the point: scope drift shows up as a squiggle at the moment of the edit, for the human and the agent alike, without either of them running a command.

Point any LSP client at `cg lsp` over stdio. For Neovim:

```lua
vim.lsp.start({ name = "codify", cmd = { "cg", "lsp" },
                root_dir = vim.fs.root(0, { ".codegraph", ".git" }) })
```

### VS Code extension

`editors/vscode/` ships the Codify extension — the whole workflow in the editor:

- **Code navigation from the graph.** It runs `cg lsp` and speaks LSP to it, so go-to-definition, find-references, workspace symbols, and code lens work in every indexed language with no compiler and no configuration. Hover shows what a symbol is, how many references it has, and the decisions recorded about it.
- **Scope drift as a squiggle.** Editing a file outside the in-progress task's declared `touches` raises a warning in the Problems panel, at the moment of the edit. Advisory, never an error.
- **A live task board.** Tasks by dependency wave with their verification data — declared symbols resolved in the graph, touched paths, tagged commits, memories. Start, mark implemented, and complete run the real `cg spec` commands, refusal included. In parallel mode it shows who holds each lease.
- **Agent sessions from the task board.** Start a Claude Code or Codex session on a task — in the ACP agent panel by default, or a terminal, or headless — hand off, resume, run a whole wave, and stop sessions, with live lease decorations on the board. See [Driving agents](#driving-agents).
- **A memory view**, and one Actions menu covering brief, review, test-impact, why, check, guard, snapshot, spec authoring, and hook installation. Reports open as rendered markdown.
- **kvx editing.** Go-to-definition on a `requires` entry jumps to that task; completion offers the keys a task actually understands; the outline lists every requirement and task.

The extension has no dependencies and no build step — including its Language Server client, which is written by hand for exactly that reason.

```sh
cd editors/vscode
npx @vscode/vsce package        # produces codify-0.4.0.vsix
code --install-extension codify-0.4.0.vsix
```

See [editors/vscode/README.md](editors/vscode/README.md). Any other editor gets the same navigation by pointing its LSP client at `cg lsp`.

## Development

```sh
make             # build ./cg            (deps: C compiler, libsqlite3-dev)
make unit        # C unit tests          (tests/unit/*.c against build/libcg.a)
make integration # end-to-end CLI tests  (tests/integration/*.sh in sandboxes)
make test        # both
make release     # static release binary -> tested -> published to the web root
```

Repository layout:

```
src/                 one .c file per module; src/cg.h is the only header
src/govern.c         brief, review, guard, check, handoff, resume — the governance layer
src/orchestrate.c    cg spec run — drives agent processes over claimed tasks
src/lsp.c            language server over the graph
src/gitint.c         git history ingestion, churn, commit mirroring
tests/unit/          kvx grammar, SHA-256 vectors, JSON scanner, StrBuf/IO
tests/integration/   graph, vcs, agentic, MCP protocol, spec engine, watcher
tests/fixtures/      sample polyglot project and a spec repo with golden outputs
editors/vscode/      VS Code extension: kvx language + task board (plain JS)
scripts/             install/uninstall scripts served at codify.centra.ag + release publisher
docs/ARCHITECTURE.md how the pieces fit together
```

The spec-render goldens were generated by the original Go specgen, so rendering parity is locked in by `make test`. CI builds and runs the full suite on every push via `.github/workflows/ci.yml`.

## Sharing the graph between the editor and agents

The graph is one SQLite file in WAL mode and every `cg` process in a checkout writes to it — the editor's `cg lsp`, `cg watch`, `cg mcp`, and each agent's commands. Writers take the lock in short bursts (the indexer commits every few dozen files and parses outside the lock), and a CLI command waits up to `CG_BUSY_TIMEOUT_MS` (default 30000) for its turn, so `cg spec start`/`done` during an editor index simply waits a moment. If the lock never frees, the command exits 75 with a message that says nothing was applied and the same command is safe to retry — no debugging required, run it again. `cg lsp` and `cg watch` never hold an agent up: they defer their own index while the database is busy and keep answering from the last completed one.

## Notes and limitations

- Ignore rules combine sensible defaults (VCS directories, `node_modules`, build output, binaries) with a `.cgignore` file using one glob per line.
- Symbol extraction is heuristic. A comment-aware and string-aware pattern engine per language is tuned for recall on definitions and call sites. It is not a full type-checked resolver.
- Snapshots store every non-ignored file up to 32 MB, including binaries. The graph indexes text files up to 8 MB.

## Community

- [Why Codify exists](WHY.md)
- [Contributing guide](CONTRIBUTING.md)
- [Security policy](SECURITY.md)
- [Code of conduct](CODE_OF_CONDUCT.md)
- [Maintainers](MAINTAINERS.md)
- [How to cite](CITATION.cff)

## License

MIT © [Sidiora Labs](https://sidiora.com)
