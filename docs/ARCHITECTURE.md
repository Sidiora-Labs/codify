# Architecture

Hyperfide 2.0 (`hyperfide version` prints `2.0.0-dev`; this tree is a
development revision, not a release) has three parts: one local C binary with
its SQLite graph, a registry of native C components linked into it, and a Node
control plane under `services/hyperfide` that keeps distributed authority in
PostgreSQL. The local binary is described first and at length, because every
command a reader runs today goes through it; [Hyperfide 2.0 layout](#hyperfide-20-layout)
covers the other two parts and what the specification records as implemented.

One binary (`hyperfide`), one local SQLite database, and runtime libraries
libsqlite3, libcurl, libcrypto, libm, libpthread and libc (`LDLIBS` in the `Makefile`).
`cg` is a deprecated compatibility alias: `make` copies the same executable
to `cg`, so it takes identical arguments and gives identical JSON and exit
codes, and it stays for the compatibility window of the approved release
(`hyperfide help` prints the wording under "command names";
`src/hyperfide/branding.c` is the source of truth). Every example below uses
`hyperfide`. The tree-sitter runtime (`vendor/tree-sitter`) and the grammar
sources (`vendor/parsers/<family>`) are vendored and linked into that binary.
C11 with GNU extensions (`-std=gnu11`) + POSIX. `src/cg.h` remains the shared
core header; semantic, parser and inspection modules also have focused
headers.

## Data flow

```mermaid
flowchart LR
    A[Walk or Git candidates] --> B[Metadata and content verification]
    B --> C[Bounded worker extraction]
    C --> D[Native syntax, embedded adapter or labelled fallback]
    D --> E[Chunked SQLite writes]
    E --> F[Branch-scoped semantic passes and retry debt]
    F --> G[Search, flow, inspection and answer health]
```

The [indexing guide](indexing.md) gives the coverage matrix and parser limits.
The sections below describe both the existing graph tables and the newer
semantic layer; language-specific syntax coverage does not imply complete
runtime dispatch knowledge.

- **`sysinfo.c`** sizes the pipeline before anything runs: effective cores =
  min(online, affinity mask, cgroup v1/v2 CPU quota); honest memory =
  `MemAvailable` ∩ cgroup limits. Workers, SQLite page cache, and mmap
  budgets derive from that, so the same binary behaves sanely on a
  16-core workstation and a 512 MB container. The machine's own worker
  pick stays at or under 16; a person may ask for more — `--workers N`,
  `HYPERFIDE_INDEX_WORKERS` (or `CG_INDEX_WORKERS`), or `[index] workers` in
  the project configuration file, in that order
  of precedence, up to `CG_MAX_WORKERS` (64) — and
  `syncgate_worker_request` is the one place that resolves the request
  and names its origin.
- **`scan.c`** walks the tree (in parallel, through `walk.c`, or asks git
  for the candidates; see [Walk and the index at scale](#walk-and-the-index-at-scale-walkc-scanc)),
  checks subsecond metadata and content when paths are dirty or suspect against
  the `files` table, fans changed files out to a worker pool through a bounded ring
  buffer, and writes results back on the main thread in short chunked
  transactions (`INDEX_CHUNK` files per `BEGIN IMMEDIATE`). Parsing happens
  outside the lock, so the write lock is held for milliseconds at a time
  and every other `hyperfide` process gets a turn between chunks. When the lock
  cannot be taken within the caller's wait, the index stops at a chunk
  boundary, records `index_pending_resolve` so the next run finishes edge
  resolution, and returns busy instead of exiting — the LSP and the
  watcher defer and retry; CLI commands report it (see below).
- **`lang.c` / `routes.c`** retain comment-aware, string-aware heuristic
  extraction and route recognition for fallback and older formats. Native
  syntax adapters in `ast_*.c` parse supported language families with bounded
  tree traversal. Embedded and declarative adapters recognize selected
  constructs; file-only formats have no structural graph. `semantic.c` stores
  syntax facts, while `sem_imports.c`, `sem_resolve.c`, `sem_types.c`,
  `sem_routes.c` and `sem_channels.c` derive branch-scoped relationships from
  evidence. Ambiguous targets stay unresolved. `sem_incremental.c` tracks
  dependencies and retries affected callers when definitions or bindings
  change. These modules are coordinated by `sem_dispatch.c`. On the read
  side, `sem_search.c` ranks symbols from `semantic_identifier_postings`
  (exact, segment and typo tiers), `sem_flow.c` answers `hyperfide flow` with
  bounded traversal over branch-scoped typed edges, and `sem_inspect.c`
  answers `hyperfide inspect hierarchy|unused`. `resolve.c` maps import
  strings to repository files and classifies their origin. `index_health.c`
  records each file's extraction status in `extraction_health`,
  `answer_health.c` attaches a bounded index-health object to JSON answers
  for the paths they name, and `watch_health.c` keeps a durable per-branch
  marker that asks for a whole-tree reconciliation.
- **`scan.c`** attributes extracted references to source owners where the
  adapter has lexical evidence, and records parser identity and coverage.
  A metadata match or unchanged content hash can reuse extraction only when
  its extraction version is current; a version bump or retained semantic
  debt forces the needed refresh. Durable source spans and original reference
  text remain available for later resolution.
- **`db.c`** owns the schema: `branches`, `files` (scoped by `branch_id`,
  `UNIQUE(branch_id, path)`), `symbols`, `refs` (with `qual` and `kind`),
  `imports`, `routes`, `meta`, the semantic symbols, references, bindings,
  type facts, edges and dependencies, and `memories` (with `branch`, `class`,
  `confidence`), `memory_superseded`, `git_commits`, `git_churn`,
  `leases`, fenced `attempts` (with `branch`, `worktree`, `parent`),
  the `agents` registry, normalized `runtime_events`, incremental
  `runtime_files`, revision baselines in `work_packets` / `work_files`,
  and criterion-linked `work_evidence`, the `projections` and
  `projection_findings` tables (durable, see
  [Projection](#projection-projectionc-conflictsc)), plus the FTS5 tables —
  trigram over symbol names and their split name words (substring and word
  search), unicode61 over file bodies (`body_fts`, word search), unicode61
  over comments and over memory bodies, trigram over every file body
  (`body_tri`, the candidates for `hyperfide grep`), and trigram over each path's
  words (`file_fts`, for `hyperfide files`). `files.base` holds a path's last
  segment. C/C++ prototypes are `symbols` rows with `decl=1` that
  end at their own `;`; `refs.target_id` is indexed (see
  [retrieval.md](retrieval.md)). The schema is versioned in
  `meta.schema_version` (`cg_schema_upgrade`, `SCHEMA_VERSION` currently
  18): on a mismatch the derived tables — `files`, `symbols`, `refs`,
  `routes`, `imports`, `comments` and their FTS tables, `file_fts` and
  `body_tri`, the semantic tables (`semantic_symbols`, `semantic_references`,
  `semantic_bindings`, `semantic_type_facts`, `semantic_edges`,
  `semantic_dependencies`, `semantic_identifier_postings`) and
  `extraction_health`, with `meta.fts_mode` and the per-branch `last_index_*`,
  `walk_*`, `project_files*` and `index_pending_resolve*` marks — are
  dropped and recreated for the next sync, while the branch and agent
  registries, memories, git history, attempts, runtime history, work
  evidence, and projection builds and findings are never touched. A few
  guarded `ALTER TABLE`s run on *every* open, before the version check,
  because a database stamped v18 by an earlier build of v18 can lack them:
  the `agents` table gains the native-agent columns (`kind`, `host_kind`,
  `agent_id`, `agent_type`, `description`, `model`, `depth`, `state`,
  `started`, `ended`, `transcript`, `cwd`, `task`, `task_source`,
  `last_tool`, `tool_calls`, `discovered`), each added only when
  `pragma_table_info` says it is missing; `files` gains `base`, filled
  from `path` in place rather than by a rebuild; and `files` gains
  `mtime_ns`, left NULL on legacy rows rather than backfilled. After the upgrade
  `cg_open` runs `db_fts_create`, which creates `body_fts` contentless
  (`content=''`, `contentless_delete=1`) on SQLite 3.43.0 or newer and
  content-bearing otherwise, and records the form in `meta.fts_mode`; an
  existing table's DDL wins over the meta row, so a database is always
  used in the form it was built with, and a contentless one opened by an
  older SQLite is refused with the version named. `body_tri_compat`
  does the same for `body_tri` before the schema runs. `idx_file_base`
  (`files(base, branch_id)`), `idx_file_legacy_time` and `idx_import_target`
  are created after the upgrade, since a v17 `files` table has no `base`. A database written by
  a *newer* `hyperfide` is refused rather than downgraded, so an old editor
  binary and a new CLI cannot take turns re-indexing the tree.
  It also resolves the project root, which is load-bearing:
  `cg_find_root_at` stops the upward walk at a `.git`/`go.mod`/
  `package.json`-style boundary, at `$HOME`, and at a mount change, so a
  stray `.codegraph` in an ancestor can never silently capture a project
  beneath it. `cg_find_project_at` returns both halves — the tree to
  operate on and the shared project that owns the database — which differ
  only inside a linked git worktree, where the shared project is found
  through git's common directory. `HYPERFIDE_ROOT` (alias `CODIFY_ROOT`)
  overrides the walk;
  `hyperfide root` prints the answer.
- **`graph.c`** implements the query commands (`search`, `symbol`,
  `impact`, `context`, `routes`) with `--json` variants. Ranking fuses
  exact, prefix, substring, and token tiers (`find_symbols_all` — no
  exact-match short-circuit), then scores by kind (functions and types
  above macros and vars), resolution-aware reference count, and
  a hard penalty on test/fixture/vendor paths; ties break on refs then
  path, deterministically. Call edges resolve a name to *one* definition:
  same file, then a file the ref's file imports (module path matched
  against candidate paths), then same directory, then shallowest path.
  Output is budgeted: `context` (default 4000 tokens) and `impact`
  (default 8000) emit each symbol in full once and as a compact
  `{"n","at"}` form on every repeat, cut sections carry an explicit
  `omitted` count, full-text hits carry a line number, and `show`
  truncates long bodies with a `use --full` marker.

## Walk and the index at scale (`walk.c`, `scan.c`)

A whole-tree pass pays for finding what changed, parsing it, writing it,
and resolving references; each is kept proportional to the change rather
than to the tree wherever it can be.

`walk_parallel` replaces the recursive walk. Directories are a shared work
list: each walk thread takes one, reads it, queues its subdirectories and
keeps the regular files it found, so a lopsided tree still spreads over
the threads. The thread count is `walk_threads_default`: the parse budget,
or `HYPERFIDE_WALK_THREADS` (1 to `CG_MAX_WORKERS`). The entry's `d_type` decides
directory, link or file without a stat (only `DT_UNKNOWN` costs an
`lstat`); a kept file costs one `fstatat` for the size and mtime the diff
reads. The ignore rules apply to every entry as before, symbolic links are
never followed, and the merged list is sorted with `strcmp`, so the result
does not depend on the thread count. The calling thread does not walk: it
waits and draws the progress line (`progress_dirs`, `progress_tick`),
since progress is main-thread only.

`[index] walk` (`config_index_walk`: `auto`, `git` or `full`) lets a
whole-tree pass ask git instead of walking. `index_git_plan` uses git when
the mode is `git`, or `auto` with more than `CG_WALK_GIT_MIN_FILES` (20000)
files on the branch, and when the head the last pass recorded
(`meta` `walk_head`, per branch) is known. `walk_git_candidates` in
`gitint.c` returns `git status --porcelain=v2 -z --untracked-files=all`
plus `git diff --name-only <recorded head> HEAD`; the paths that were dirty
at the last pass (`walk_dirty`) are added, because a file edited and then
reverted shows in neither list the second time. The candidates then go
through the same targeted path `hyperfide sync <path>…` uses. The pass walks the
whole tree instead when `hyperfide index --full` asked for it, when git fails or
the recorded head is not a commit it knows, when a candidate is a
`.gitignore` or `.cgignore` (git names the ignore file, not what it newly
hides or reveals), when the dirty set kept for the next pass outgrew
`WALK_DIRTY_MAX` (256 KiB of paths, stored as `*`), and on every
`CG_WALK_FULL_EVERY`th (20th) pass, counted in `walk_passes`.
`index_git_record` stores the head, the next dirty set and the count after
a pass that completed. Full contract: [sync.md](sync.md#the-index-at-scale)
and [config.md](config.md#index-walk).

The write side changed with it. `body_fts` is contentless on SQLite 3.43+
(see `db.c` above), so snippets and matching lines are read from the file
on disk. Name lookups in the resolver, the C header lookup, path outlines
and position lookups use `files.base` behind `idx_file_base` instead of
`LIKE '%/'||name` scans, and `idx_import_target` serves "who imports this
file". A DELETE on an FTS5 table flushes its pending segment even when it
matches nothing, so `fts_prepurge` collects a chunk's rewritten file ids
in `temp.fts_purge` and clears `symbol_fts`, `comment_fts`, `body_fts` and
`body_tri` with one statement per table before any row of the chunk is
inserted. `index_tri_repair` (after every whole-tree pass) re-inserts the
`body_tri` rows the open branch is missing, at most `TRI_REPAIR_MAX`
(50000) a pass, which is what clears `hyperfide grep`'s completeness guard.

`IndexStats` carries `walk` (`full`, `git`, `targets`, `none`),
`phase_ms` (`walk`, `parse`, `write`, `resolve`, `soft`, added up by
`index_phase_ms`) and `peak_rss_kb` (`VmHWM` from `/proc/self/status`,
`index_peak_rss_kb`); `index_stats_json` puts them in `hyperfide sync --json` and
`hyperfide index --json`, and the one-line summary is unchanged. `hyperfide info` names
the body index mode. `tests/scale/gen.py` writes a deterministic
repository (seeded LCG; default 20000 files, about 2M lines of C, Go,
Python, TypeScript and Rust with cross-file imports and calls, and one
unique `scale_marker_<n>` literal per file), and `scripts/bench.sh` builds
it in a scratch git repository, times `hyperfide init`, no-change and one-file
syncs under each walk mode and the read commands, and prints a markdown
table. Measured on the development machine (20000 files, 1.95M lines; the
full table and profile are in [sync.md](sync.md#measured)):

| Operation | Before (v1.4) | Now |
|---|---|---|
| `hyperfide init` | 331 s | 30–40 s |
| database after init | 208.6 MB | 141 MB |
| `hyperfide sync`, nothing changed | | about 370 ms |

## Line search (`grep.c`)

`hyperfide grep <pattern>` answers where a string occurs, with each hit placed in
the graph. `cmd_grep` takes a `GrepOpts`; the pattern is a literal
substring by default and a POSIX ERE (libc `regcomp`) with `-E`/`--regex`,
case-sensitive unless `-i`. A bad regex fails once, before anything is
read.

Candidates come from `body_tri`, the trigram FTS5 table over every indexed
file body, written beside `body_fts` (contentless with `detail=none` on
SQLite 3.43+, content-bearing before; `meta.fts_mode` records which).
`required_literal` picks the literal a match must contain — the whole
pattern for a literal, the longest metacharacter-free run for a regex, none
when the regex has a `|` — and `trigram_query` asks for each of its
trigrams on its own (at most `GREP_MAX_TRI`, 24), since `detail=none`
refuses phrases. `cands_collect` runs that query under the branch
predicate `branch_scope_sql` builds, with the shared `QueryFilter` spliced
in by `query_filter_sql` and `--symbol`/`--kind` as `EXISTS` joins on
`symbols`. A pattern with no three-character literal, or a candidate query
that fails, scans every indexed file of the scope instead, and the summary
says so. Before trusting the index, `grep_tri_complete` compares
`body_tri`'s row count (from `body_tri_docsize`) with the files that carry
a body (size at most `GREP_BODY_MAX`, 2 MB); when the table is short it
counts the scope file by file, and a scope with any file missing its row
is scanned whole, reported as `full scan — body_tri incomplete` and
`"full_scan":"body_tri incomplete"` in `--json`. The next whole-tree pass
repairs the rows (`index_tri_repair` above).

`scan_worker` threads read the candidates from disk, in each branch's own
worktree (`branch_tree`), so a hit is the text as it is now. Their count is
`syncgate_worker_request`'s budget, capped at `CG_MAX_WORKERS` and at one
thread per eight candidates plus one. A literal is found with `memmem`
(over a lowercased copy under `-i`), a regex with `regexec`, one hit per
line. Files over `GREP_FILE_MAX` (8 MB), files whose body the index does
not keep (over 2 MB) and binary files are counted as skipped, not searched.
For each file with hits, `spans_load` reads its definition spans
(`decl=0`) once and `span_at` places each hit in the innermost one, or in
`(file scope)`. Files are ranked by hit count, then source before tests,
then shallower paths (`file_rank`). Output groups hits by file and names
the enclosing symbol once per run; `-C N` adds context, `-n` (default 50)
and `--budget` (default 4000 tokens) cut the answer with an explicit
`… N more hits in M files` tail, `--files` lists files with counts, and
`--count` prints the total. `--path GLOB` (repeatable), `--lang` and
`--no-tests` go through `query_filter_parse`, the same parser search,
context, survey and files use, so a glob selects the same files on every
command; `--branch` and `--all-branches` scope it as they scope the other
reads. Over MCP the same command is the read-only `grep_code` tool
(`t_grep`, schema `GREP_CODE_SCHEMA`). Full contract:
[retrieval.md](retrieval.md) (line search).

## File finding (`files.c`)

`hyperfide files` finds files from the `files` table without touching the disk,
and `files.c` also owns the `QueryFilter` every narrowed read shares.
`query_filter_parse` takes `--path GLOB` (repeatable, a plain path meaning
that file or anything under it), `--lang L` (a language or an extension,
normalised through `lang_for_path`) and `--no-tests` out of an argv;
`query_filter_sql` turns them into a predicate on `path`, `lang` and the
`cg_is_test` SQL function (`query_filter_register`), and
`query_filter_match` makes the same decision in C on a row in hand.
`main.c` parses the filter once for `search`, `context` and `survey` and
hands it to `graph.c` with `cg_filter_set`, a thread-local the queries read
back through `cg_filter_get`; grep builds its own argv for the same parser,
and the MCP tools `search_code`, `get_context` and `find_files` take
`path`, `lang` and `no_tests` the same way.

`cmd_files` picks its mode from the pattern. A glob (any of `*?[`) is one
more `--path` (`files_glob`). Words go to `files_words`, which matches
`file_fts` — `name_words(path)` under the trigram tokenizer, rowid
`files.id`, written once when the `files` row first appears — with a
`MATCH` for every word of three characters or more and `instr` for the
shorter ones, then scores basename words above directory words
(`words_score`). A bare directory (`is_dir_path`) lists its subdirectories
with counts, then its files (`files_dir`). Each row prints path, language,
lines and symbol count, at most `-n` (default 40) with a tail naming what
was left out. `--dirs [prefix]` aggregates instead (`files_dirs`): every
directory to `--depth` (default 2, at most 16) with file and line counts
and the dominant language by lines, largest first. Every query is scoped
by `branch_scope_sql` and narrowed inside the SQL. Full contract:
[retrieval.md](retrieval.md) (finding files).

## The command line (`main.c`, `help.c`)

`main.c` dispatches `hyperfide <command>` with one `strcmp` branch per command;
subcommand switches live with their modules (`cmd_spec`, `cmd_fleet`,
`cmd_config`, `cmd_docs`, `cmd_drift`, `cmd_work`, ...). What the CLI *says*
about itself lives in one place: the static `HELP` table in `help.c`, one row
per command and subcommand (group, name, principal arguments, usage, summary,
detail, flags, examples, related, aliases). Four views are drawn from it —
`help_overview` (`hyperfide`, `hyperfide help`, `-h`, `--help`: the grouped map),
`help_command` (`hyperfide help <name>`, `hyperfide <name> --help`), the `--all` dump, and
`--json` — and `help_usage` prints a row's usage line when `main.c` meets a
bad argument. `help_route` runs before any flag is consumed, and
`help_known` runs before the graph is opened, so a misspelt command gets its
`did you mean` in a tree without `.codegraph/` too, instead of
`not inside a Codify project`. Text is wrapped
to `COLUMNS`, then the tty width, default 80, floor 60; bold and dim are
added only on a terminal without `NO_COLOR` or `TERM=dumb` (`HYPERFIDE_COLOR=0|1`
overrides). Module dispatchers that still print their own `usage:` line
carry it byte for byte in their row. `tests/integration/43_help.sh` scans
`main.c` and every subcommand switch and fails when a dispatched name has no
row, when a row's usage and a bad-argument line disagree, or when the
README's command reference misses a command.

## Version control (`vcs.c`, `sha256.c`)

Content-addressed snapshots: blobs and commit objects under
`.codegraph/objects/<first two hex>/<rest of the hash>`, a manifest per commit (sorted
`hash size\tpath` lines), `HEAD` pointing at the last commit. Diffs are
LCS at line level. `hyperfide changes` joins the working-tree diff against the
graph to list touched symbols and their external callers. `hyperfide commit`
tags its message with the in-progress spec task when one exists.

## Database locking (`db.c`)

The graph is one SQLite file in WAL mode, shared by every `hyperfide` process in
a checkout: the editor's `hyperfide lsp`, `hyperfide watch`, `hyperfide mcp`, and each agent's
CLI calls. Only one writer exists at a time, so the rules are about who
waits and for how long.

- Every write transaction is `BEGIN IMMEDIATE`, taken through
  `cg_begin_write`, so a writer either has the lock or knows it does not;
  a deferred `BEGIN` that upgrades mid-transaction would fail with
  `SQLITE_BUSY_SNAPSHOT` and lose the work.
- CLI commands wait `HYPERFIDE_BUSY_TIMEOUT_MS` (default 30 s) for the lock. An
  agent updating task state during an editor index therefore waits a
  moment and succeeds. Only after the whole wait does `cg_exec` print an
  actionable message — which process class holds the lock, that nothing
  was applied, that the same command is safe to retry — and exit 75
  (`CG_EXIT_BUSY`, EX_TEMPFAIL) rather than a generic "database is locked".
- A lifecycle write — a memory, an event, a handoff, a work revision, a
  lease release, a heartbeat — that still finds the lock held after the
  wait is not failed but queued in the write journal (below), and the
  command exits 0 saying so. Claims, fleet claims, and the indexer must
  see the live state, so they keep waiting and exit 75.
- Long-lived servers (`hyperfide lsp`, `hyperfide watch`) set a short `lock_wait_ms`
  and never exit on busy: their index is deferred and retried later, and
  they keep answering from the currently committed graph meanwhile; queued
  changes are not certified visible until reconciliation finishes.
- Read-only paths must not take the write lock: `spec_attempt_sweep`
  checks for expired attempts before it opens a write, so editor board
  polling of `hyperfide spec status` does not compete with agents' writes.
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

## Write journal (`journal.c`)

Locking says who waits; the journal says what happens when waiting runs
out. `journal_begin` is `cg_begin_write` for the lifecycle writes: it takes
the lock or returns -1, and once a process has waited out the full timeout
(`journal_mark_busy`) the later journaled writes in that same command try
the lock once and queue at once. A write that cannot get the lock is
`journal_append`ed as one JSON record under
`.codegraph/journal/<ms>-<pid>-<seq>.json` — written to a dot-file,
fsynced, renamed, so a reader never sees half of one — carrying the
operation (`memory.add`, `event.emit`, `event.ingest`, `handoff.add`,
`work.update`, `work.close`, `lease.release`, `attempt.heartbeat`), its
arguments, and the writer's branch, agent, and run, so replay stores what
the writer meant rather than the replayer's context. `journal_replay`
holds a non-blocking `flock` on the directory (a second replayer skips
rather than waits, since it may be waiting on the very lock the first
holds) and runs in three modes: `JOURNAL_HELD` inside a transaction the
caller already holds, which is every successful `cg_begin_write`;
`JOURNAL_PROBE` at database open and at the start of `hyperfide sync` and
`hyperfide index`, taking the lock only if it is free that instant; and
`JOURNAL_WAIT` for `hyperfide journal apply`. Each record is applied in its own
transaction by the module that owns the operation — `memory_add_at`,
`events_emit_at`, `spec_journal_apply`, `govern_journal_apply`,
`runtime_journal_apply` — and its id lands in `journal_applied` inside
that transaction, so a crash between commit and unlink cannot apply it
twice. A record the database rejects for a reason other than busy moves
to `failed/` with its `.err` and is reported once. `journal_pending`
feeds the counts in `hyperfide brief`, `hyperfide state`, and `hyperfide check`;
`journal_queued_memories` lets `hyperfide recall` show a memory that is still
queued. Full contract: [journal.md](journal.md).

## Progress (`progress.c`)

The status line for the passes a person waits on. `progress_request` is
called only by `hyperfide init`, `hyperfide index`, and `hyperfide sync` run without `--json`,
`--auto`, or `--background`; every implicit sync — the freshness pass
before a read, the hook, MCP, LSP, serve, watch, fleet, the editors —
reaches `cg_index_ex` without it and so can never draw. `progress_begin`
mutes a quiet or background pass; `progress_phase` names the pipeline's
stages (walking the tree, parsing files, writing the graph, resolving
references, finishing); `progress_tick` carries files done of files to
do and the path in hand; `progress_workers` the thread count; and
`progress_wait` what the pass is waiting on — the index gate in
`syncgate.c`, or the database write lock through `progress_begin_write`
— so a wait is never mistaken for a hang. Main thread only: parse
workers never call in, and the counts come from what the consumer loop
already holds, so the pipeline pays one clock read per popped file and
nothing under its ring mutex. On a terminal the line is redrawn in place
from 250 ms into the pass, at most every 100 ms, and erased by
`progress_end` (and at exit) before the summary, so the finished output
is byte for byte what it was. `HYPERFIDE_PROGRESS=plain` prints a plain line on
each phase change and at most every two seconds, terminal or not;
`HYPERFIDE_PROGRESS=0`, or a pipe without it, prints nothing. See
[sync.md](sync.md#progress).

## Watcher (`watch.c`)

Recursive inotify with dynamic directory registration and a debounce
loop; each quiet period triggers an incremental index through the sync
gate, so the watcher coalesces with hooks rather than racing them. A busy
database turns into a retry after the next debounce. Non-Linux platforms
stub out behind the same interface.

## Fleet (`fleet.c`)

The hierarchy that turns one repository into a tree of agents. `hier_load`
reads `[hierarchy]` and `[role.main|manager|worker]` from
`spec/workflow.kvx` over built-in defaults (`[role.feature]` is the
manager's older name; `role_sections` reads both, `[role.manager]`
winning); `hier_expand` fills `{main}`, `{remote}`, `{feature}`, `{wave}`,
and `{task}` in the branch and agent templates. The defaults
(`hier_defaults`) are a Wave Manager per wave (`wm-{feature}-{wave}` on
`wave/{feature}/{wave}`, based on `{main}`) and a Task Worker per task
(`w-{feature}-{task}` on `task/{feature}/{task}`, based on the wave
branch), so the waves of one feature run side by side. A workflow written
for the old shape — a worker template without `{task}` — keeps it:
`hier_old_shape` turns the defaults it did not override back into a
Feature Manager on `feature/{feature}` (`fm-{feature}`) over a Wave Worker
per wave (`w-{feature}-{wave}`) whose base is the manager's branch.
`hier_per_wave` and `hier_per_task` tell the two shapes apart by the
placeholders in the branch templates, and `fleet_plan` lays out the tree a
feature would get. `hier_role_caps` resolves each role's capabilities (driver,
model, args, max, wall, spend, retries, stall, approve) into a `RoleCaps`,
reporting unusable values instead of dropping them.
Identity comes from the environment (`HYPERFIDE_AGENT`, `HYPERFIDE_ROLE`, `HYPERFIDE_PARENT`,
`HYPERFIDE_FEATURE`, `HYPERFIDE_WAVE`) and is recorded in the `agents` registry only when
a role is set, so solo sessions leave no trace. The branch lifecycle —
`fleet_worker_begin`, `fleet_merge_up`, `fleet_land`, `fleet_pr_open`,
`fleet_checkpoint` — drives `git` and `gh` through the helpers in
`gitint.c`, always against the shared project (the main worktree), and
shares the spec engine's claim primitives rather than adding a second
ownership system. `begin <id>` creates the worker's branch from its base
(creating the base from main when it is missing), adds its worktree and
registers the branch; `merge-up <id>` merges the worker's branch into its
base — the wave branch, by default — in that branch's worktree; `land` and
`pr` take a wave number or a task id in the wave (`lifecycle_target`,
defaulting to `HYPERFIDE_WAVE`, so a Wave Manager lands its own wave), and
`land <feature>` still lands the feature branch in the old shape
(`fleet_feature_land` delegates to `fleet_land`). `merge-up` and `land` take the
feature's merge lock (`fleet_merge_lock`, an `flock` on
`.codegraph/fleet/merge-<feature>.lock`), which is what lets a manager and
its workers run at the same time. `fleet_gate` is the opt-in approval
gate: for a fleet agent whose workflow lists the gate, it records a
pending row in `fleet_approvals` and returns `CG_EXIT_APPROVAL` (4) until
`hyperfide fleet approve` decides it, and an approval is consumed by the one
command it let through. `fleet_sync` (`hyperfide fleet sync`) is the worker's
side of a forward merge: in a task worktree it merges the base branch
(`--base`, else `HYPERFIDE_BASE`, else the `branches` registry) into the task
branch, refusing while an uncommitted file there is also changed on the
base, aborting a conflict with its paths named, and otherwise listing the
commits and files that came in before a projection build; a `fleet.sync`
event records each one. `hier_waves_parallel` reads `[hierarchy] waves`
(`parallel` | `sequential`): parallel when the key says so or, unset, when
git is 2.38 or newer — the projection the ahead tasks build against needs
`merge-tree --write-tree` — and it reports which and why. `hyperfide fleet tree`
is dispatched here and drawn by `orch_tree_status` in
`orchestrate.c`, beside the run it reports on; `--json` goes through
`native_fleet_tree_json` in `native.c`, which adds the native-agent and
`projection{}` blocks. Full contract:
[hierarchy.md](hierarchy.md).

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
prunes by count (`HYPERFIDE_EVENTS_KEEP`, default 50000); `AUTOINCREMENT` keeps a
sequence number from ever being reused, and `meta.events_pruned_through`
tells a lagging reader it missed events. Full contract:
[events.md](events.md).

## Serve (`serve.c`)

`hyperfide serve` is the editor's one connection: newline-delimited JSON-RPC 2.0
on stdio with `initialize`, `tools/list`, `tools/call`, `exec`, `cancel`,
`subscribe`, `unsubscribe`, `ping`, and `shutdown`. It shares the MCP tool
table with `hyperfide mcp` rather than keeping a second list. Every call runs in a
child — the binary re-executed in its own process group — so a long
`verify_cmd` never delays an event push, calls run concurrently (up to
32), and `cancel` is a signal. The server's own connection only reads: it
waits on inotify over the database files (a 150 ms stat poll elsewhere,
plus a one-second safety check), coalesces a burst of WAL writes, and
pushes `events_since` each subscriber's cursor. Idle, it holds no lock and
runs no index pass. `hyperfide tool list|call` (`cmd_tool` in `mcp.c`) runs the
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
`hyperfide spec done` and `hyperfide fleet merge-up`. `drift_collision_predict` flags two
open tasks whose touch globs overlap or whose declared symbols are the
same or call one another; the supervisor's slot picker serializes those
pairs. `drift_interface_check` runs after a merge into a feature branch: it
diffs the signatures of the merged symbols and finds references on other
live branches through the unified graph, then steers the agents on them
and their managers. `coverage_check` lists acceptance criteria with no
qualified task, before `land`. All four record events and warn; only the
`drift` and `coverage` approval gates block. Full contract:
[drift.md](drift.md).

## Projection (`projection.c`, `conflicts.c`)

`hyperfide projection build` answers what main would look like if every branch in
flight merged now. `projection_branches` takes every registered branch
whose worktree exists and that has a live agent (seen within `[agents]
ttl`) or was indexed within `[projection] stale` (default 24h), minus the
base, the projection itself and the `[projection] exclude` globs, plus any
`--branch`; they are folded in order of the depth of their base chain,
then registry update time (`proj_cmp`). The base is `[projection] base`,
else `[hierarchy] main`, else `main`. A branch's uncommitted work goes in
through a shadow commit written from a copy of its index
(`projection_shadow_commit`), and `proj_fold` folds each contribution onto
the result so far with `git merge-tree --write-tree` (git 2.38 or later,
`proj_git_check`), commits it with `git commit-tree` and moves one ref,
`refs/codify/projection`. Nothing touches a worktree, an index or a branch
ref. A conflict does not stop the fold: the branch goes in with git's
markers and the path is recorded with every branch that touched it
(`--strict` instead leaves a conflicting branch out). Builds take an
`flock` on `.codegraph/projection.lock`, waiting `--wait` ms (5000); a
timeout prints the last build and exits `CG_EXIT_BUSY` (75). A build whose
fingerprint (base head and each branch's contribution and skip reason)
matches the last one is a no-op. Builds are stored in `projections`;
`--index` (or `[projection] index`) checks the result out at
`.codegraph/worktrees/projection` and indexes it as branch
`codify/projection`, so every read command answers `--branch
codify/projection`. `status`, `diff`, `show` and `findings` read what the
builds stored.

`conflicts_compute` reads the same fold with the graph in hand. Besides
git's own conflicts (content, delete, add-add) it finds `symbol` (two
branches change the same symbol against the base, even when git merges
the hunks cleanly), `interface` (one branch re-signatures or removes a
public symbol another branch references in code it changed, through
`drift_interface_changes`) and `near` (two branches edit one file within
`NEAR_LINES`, 3, of each other). Each branch's hunks are mapped onto the
symbol spans the graph holds for that branch (`files.branch_id`), falling
back to the base's spans. `conflicts_store` diffs a build's findings
against `projection_findings`, keyed by kind, path, symbol and branch set:
`projection.conflict` once when one appears, `projection.resolved` when a
build stops finding it, and `projection.built` for every build, the no-op
included. `conflicts_steer` (on unless `[projection] steer = false`) tells
the agents on the branches of each new finding through `driver_steer`,
once. Nothing here blocks.

The projection follows the work without anyone running a build. Every
place work happens leaves a dirty note under `.codegraph`
(`projection_mark_dirty`) and asks `projection_auto_build` to act on it:
`hyperfide hook post-edit`, the work events `hyperfide hook event` receives from a host
(`PostToolUse`, `Stop`, `SubagentStop`, `SessionEnd`, `WorktreeCreate`,
`WorktreeRemove`; a session start or a prompt is not work), `hyperfide watch`
and `watch --fleet` once an index pass has settled, `hyperfide serve`, and the
supervisor after a merge, a land, a begin and a spawn. The callers are
hooks a host waits on, so nothing there waits: the build runs as a
detached grandchild (`hyperfide projection build --quiet`, stdio on
`/dev/null`, every `CG_*` identity variable unset so its events are
nobody's work), the lock is probed without blocking, a build already
running is left to it, and `[projection] min_interval` (default 15s)
keeps a burst of edits to one build; `[projection] auto = false` turns
the automatic builds off and leaves `hyperfide projection build` to the user. A
build consumes the note when it takes the lock, so an edit that lands
mid-build is picked up by the next one. The findings then show wherever
the work is looked at: `hyperfide projection status` groups the live findings by
the branch they involve, with ages and each branch's worktree; `hyperfide brief`
and `hyperfide state` name the first two (`projection_summary`); `hyperfide fleet
merge-up` and `hyperfide fleet land` print the branch's known findings before
merging; `hyperfide fleet tree --json` carries a `projection{}` block with
per-branch counts (`projection_tree_json`), the `projection_status` MCP
tool answers the same question to an agent, and the editor's fleet view
gains a Projection node whose branch rows open the file in that worktree,
with badges on the branches involved. Full contract:
[projection.md](projection.md).

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
output (last 40 lines, 4 KiB), `jev_rank_findings` scores up to 50 `hyperfide
guard` findings in one request, and `jev_pr_readiness` scores a feature
branch for the pull request body. A caller that only adds a line to its
output can ignore the return value: the fields stay empty and it prints
nothing. Full contract: [jev.md](jev.md).

## Skills (`skills.c`)

What happens to a memory Jev classed a `skill`. `hyperfide skills promote` renders
one memory as `.agents/skills/<slug>/SKILL.md` — the portable format every
agent host reads — and `hyperfide skills render` refreshes every file already
written. Two invariants keep it honest. The file carries the
`codify-owned:` marker (`integrate.c` now writes `hyperfide-owned:` on the
assets it writes and still accepts `codify-owned:` as the legacy form) naming the memory it came from, and a file without that
marker is never overwritten. And promotion lives in the file, not in the
database: `memories.class` stays Jev's opinion of the note, so
re-classifying never silently un-promotes a skill in use — it only makes
the rendered copy stale.

## Agent surface (`mcp.c`, `agent.c`, `json.c`)

`hyperfide mcp` is a newline-delimited JSON-RPC 2.0 stdio server exposing 67
tools, each carrying read-only/destructive annotations so a client can
auto-approve reads instead of prompting on every search. It also serves
resources (the workflow file, rendered board, graph context, and every
feature spec) and prompts (the workflow loop itself,
so the workflow's opinion travels to any client). `initialize` negotiates a
protocolVersion the server actually speaks, including `2025-11-25`, rather
than echoing the client's. List-change capabilities remain false because
the server emits no list-change notifications. CLI command output is captured via `dup2` + tmpfile
(`cg_capture`), so the CLI and MCP surfaces share one implementation.
`json.c` is a minimal scanner (no DOM) used for JSON-RPC parsing and
`package.json` introspection. `hyperfide mcp-install` splices the server, still under the legacy
name `codify`, into agent configs without a full JSON parser by inserting after the root
key's opening brace.

The finding tools are `search_code`, `grep_code` (line search, `t_grep`
in `grep.c`), `find_files` (`hyperfide files`) and `get_context`; `search_code`
and `get_context` take the same `path`, `lang` and `no_tests` narrowing as
the other two, parsed into the shared `QueryFilter` (`mcp_filter`). Their
descriptions and the served prompts tell an agent to use them before any
shell `grep` or `find`.

`integrate.c` is the vendor-neutral adapter registry. Every host declares
MCP, instruction, skill, hook, session, and cloud capabilities as native,
portable, or unavailable. Detect and plan are read-only; apply merges the
canonical `hyperfide` server (a
legacy `codify` entry is recognised, and both together are reported as
malformed), backs up existing files, and installs portable
Agent Skill and lifecycle shims; doctor reports incomplete, malformed,
stale, unsupported, or conflicting ownership.

Generated assets have one writer each. `hyperfide spec render` owns root workflow
instructions (`AGENTS.md`, `CLAUDE.md`, and IDE pointers). `hyperfide agentmd`
owns only the agent context file (`.codify/agent-context.md` by default,
`.hyperfide/context/agent-context.md` when `hyperfide.kvx` is the
configuration file), a deterministic graph projection.
Running either generator therefore cannot overwrite the other's source or
projection.

## Native agents (`native.c`)

The fleet knows only the processes it started; the Claude Code and Codex
sessions working on the project, and the subagents they spawn through
their own Agent tool, reach Hyperfide through their hooks. `hyperfide hook event
--host claude|codex` (`cmd_hook_event`) reads one hook payload on stdin,
first hands it to the runtime event normalization (`runtime_event_ingest`
through `cg_capture`, output dropped, so evidence flows as before), then
records it in the same `agents` registry the fleet uses with
`kind='native'`. It takes the write lock with `BEGIN IMMEDIATE` and waits
at most `NATIVE_BUSY_MS` (3 s); a malformed payload or a busy database is
written to `.codegraph/hooks.log`, and the command always exits 0, because
a failing hook wedges the host's tool loop.

Names are stable: a session is `H:<first 8 of session_id>`, a subagent
`H:<agent_id>`. A spawn announced by `PreToolUse Agent|Task` waits as
`H:spawn:<tool_use_id>` in state `pending` until its `SubagentStart`
claims it — by the `toolUseId` in the subagent's `meta.json` when that
file exists, else the oldest pending spawn of the same type in the
session. Subagent payloads carry the parent's session id, so the session
row is created on first sight of any payload. A cwd inside a linked
worktree of the project (`native_worktree`, read from git's files without
spawning git) registers that branch with the session's branch as its base.
`attribute_task` gives the agent a task from `HYPERFIDE_TASK`, else a live
attempt of the session, else a task id of the active feature named in the
description or prompt, else the parent's, and records which source it
used. Each step emits `agent.native.start`, `.spawn`, `.tool`, `.stop` or
`.worktree` with the task as subject and the agent as node. Rows are never
deleted, except a pending spawn once claimed; a row is shown stale after
`NATIVE_STALE_S` (120 s) without a hook and hidden once stopped for
`NATIVE_HIDE_S` (a day) unless `--all`. `native_fleet_section`,
`native_fleet_tree_json` and `native_summary` put them in `hyperfide fleet
status`, `hyperfide fleet tree`, `hyperfide brief` and `hyperfide state`.

`hyperfide fleet discover` (`cmd_fleet_discover`, `--since`, default a day) finds
the same agents from what the hosts leave on disk, for sessions that ran
without the hooks: the Claude Code transcript directories of the shared
tree, this tree and every registered worktree (`transcript_dirs` in
`recap.c`), with their `subagents/*.jsonl` and `.meta.json`, and the
Codex rollouts whose cwd is inside the project. It reads the first
`DISCOVER_HEAD_LINES` (400) lines of each for cwd, model and prompt,
links subagents to their parents, registers branches and claims pending
spawns like the hooks do. A field is written only while it is empty, and
the `discovered` column records which fields discovery wrote, so a hook's
value is never overwritten. A live row with no transcript or hook activity
for `DISCOVER_STALE_S` (15 minutes) turns stale, and back when its
transcript moves. `native_discover_auto` runs a quiet pass in front of
the fleet views, `hyperfide serve` and `hyperfide watch --fleet`, at most once per
`DISCOVER_EVERY_S` (10 s) per process, unless `[fleet] discover = false`
or `--no-discover`.

## The Claude Code plugin (`plugin.c`, `integrate.c`)

`hyperfide integrate apply` installs Hyperfide into Claude Code as a plugin (still
published under its Codify identity: plugin `codify@codify`, MCP server
`codify` in its `.mcp.json`) from a
local marketplace instead of editing `settings.json` (`--no-plugin`
skips it; `integrate_plugin_apply`). `plugin.c` writes the marketplace
under `$HOME/.codify/plugins/claude-code`: `.claude-plugin/marketplace.json`,
and under `plugins/codify/` the `plugin.json` (version `CG_VERSION`),
`hooks/hooks.json`, `.mcp.json` (the `codify` server as the absolute `hyperfide`
path with `mcp`), the `codify-workflow` skill (`integrate_skill_body`) and
the `brief`, `fleet` and `projection` commands (`hyperfide brief`, `hyperfide fleet
status`, `hyperfide projection status`). Every file carries an ownership marker
(`codify-owned: claude-code-plugin cg <version>`, as a JSON key, a shell
comment in each hook command, an env value or an HTML comment), and
`plugin_write` rewrites only a file that carries it: an existing file
without the marker is reported as a conflict and kept, and a current file
is left unchanged. `plugin_install` then runs `claude plugin marketplace
add|update` and `claude plugin install|update codify@codify --scope user`
when the `claude` CLI is on the PATH, and prints those two commands when
it is not.

The plugin's hooks (timeout `HOOK_TIMEOUT`, 20 s) send `SessionStart`,
`SessionEnd`, `Stop`, `SubagentStart`, `SubagentStop` and
`PreToolUse`/`PostToolUse` on `Agent|Task` to `hyperfide hook event --host
claude`, `PreToolUse Bash` to `hyperfide hook pre-bash`, and `PostToolUse` on
`Edit|Write|MultiEdit|NotebookEdit` to `hyperfide hook post-edit`. There is no
`WorktreeCreate` hook: one replaces git's worktree creation and must print
the path, so a silent hook would make creation fail. For Codex,
`<project>/.codex/hooks.json` gets the same lifecycle events plus every
`PreToolUse`/`PostToolUse` to `hyperfide hook event --host codex` and
`apply_patch|Edit|Write` to `post-edit`, under its own marker; Codex asks
for it to be trusted once through `/hooks`. With the plugin installed, `hyperfide
hook install` leaves `settings.json` hooks alone so nothing runs twice.
`integrate_plugin_report` adds the plugin's state (from
`$HOME/.claude/plugins`) to `detect` and `doctor`.

`hyperfide hook pre-bash` (`cmd_hook_pre_bash` in `govern.c`) is the shell
advice. `sa_tool` recognises a search through `grep`/`egrep`/`fgrep`/`rg`/
`ag`/`ack`, `find`, `fd`, or a recursive `ls`, including `find -exec grep`,
`xargs`, `git ls-files` pipelines and a leading `cd`; `shell_advice_for`
returns nothing when the command looks outside the project, and otherwise
the equivalent `hyperfide grep` or `hyperfide files` command with its MCP tool name
(`grep_code`, `find_files`), followed by a line asking the agent to use
`grep_code`, `find_files`, `search_code` and `get_context` before a shell
search. The advice goes back as `additionalContext` in a `PreToolUse`
`hookSpecificOutput` with no permission decision, so the command still
runs; it is given once per session per command (a `meta` key on the
session and a hash of the command), and is silent under
`HYPERFIDE_SHELL_ADVICE=0` or `[hooks] shell_advice = false`. The hook always
exits 0.

## Agent control plane (`runtime.c`, `govern.c`)

Declared task status is not runtime liveness. Claims create durable attempt
ids and monotonically increasing fencing tokens; heartbeats renew only the
matching generation, and completion refuses an expired or superseded owner.
`hyperfide state` labels Git, Hyperfide snapshots, spec declarations, live attempts,
and stale contradictions independently. Reconciliation diagnoses by default
and repairs only with an explicit flag.

Lifecycle adapters feed one JSON object to `hyperfide event ingest`. The runtime
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
`22_control` suite covers stale declaration repair, fencing,
heartbeat renewal, semantic event deduplication, bounded no-progress recovery,
integration planning/apply/doctor idempotence, current and legacy MCP
negotiation, and revisioned work deltas. `make test` runs the unit tests
and every integration fixture, that suite included (`tests/run.sh`);
`hyperfide check` is the separate gate that verifies the rendered spec, task
evidence, claims, and tree state.

## Spec engine (`kvx.c`, `spec.c`)

`kvx.c` parses the Ion `.kvx` format (ordered sections, `key = "value"`,
`${ENV}` interpolation) and can surgically rewrite a single `status`
line, preserving every other byte; the rewrite takes an advisory `flock`
on a `<file>.lock` side file, so parallel agents' read-modify-writes on
the same spec.kvx are atomic across processes. `spec.c` renders IDE
pointer files and the markdown mirror byte-identically to the original
Go `specgen` apart from a leading `<!-- hyperfide-owned: generated-spec v1 -->`
ownership line (locked in by golden fixtures under
`tests/fixtures/specrepo/`), and drives the task loop: wave-ordered
`next`, one-in-progress `start`, `verify_cmd`-gated `done`. When the
repo also has a `.codegraph/`, `done` additionally checks the task's
declared `symbols` against the graph and its `touches` globs against
worktree changes plus commits tagged with the task, and `hyperfide spec trace`
walks task → symbols → commits.

Parallel mode adds a dispatch frontier with integrity guarantees.
`spec ready` lists every eligible task across waves with a
`conflicts_with_live` flag; `spec claim-next` picks and claims the first
conflict-free one under a `<spec>.claim.lock` `flock` (separate from
kvx's `<file>.lock`, which the status rewrite takes inside the same call)
plus a `BEGIN IMMEDIATE`
transaction, returning the full task packet (task + lease + task-scoped
memories) — exit 3, not an error, on an empty frontier. Leases have
owners: claiming a task held live by someone else is refused, releasing
one requires the owner's name or `--force`, and `done`/`implemented`
auto-release on success. Agent identity comes from `--agent`, then
`$HYPERFIDE_AGENT`, then `"agent"`, and in parallel mode "the current task"
means the one the agent holds a live lease on.

## Agent memory (`memory.c`)

Deliberate notes (`decision`/`constraint`/`outcome`/`preference`/`fact`)
in the `memories` table of graph.db, linked to spec tasks by
`feature/id`. `hyperfide remember` defaults its task link to the in-progress
one; `hyperfide spec done` records terse outcome memories automatically —
refusals included — via a quiet no-reindex open, so the spec engine
still works without a graph. Retrieval (`hyperfide recall`, MCP `recall`) is
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

The configuration file at the root of a tree is optional. It is
`hyperfide.kvx` (`CG_CONFIG_FILE`); a tree that has only the legacy
`codify.kvx` is read from that file, and `config_selected_path` refuses to
run (exit 2) when both exist without a completed names migration recorded
in `.hyperfide/names.json`. `config_load` parses the selected file
once per root into a cached, mutex-guarded `CgConfig` and every caller
asks an accessor instead of joining a literal. `config_spec_dir`,
`config_workflow_path` and `config_feature_path` replace each
`<root>/spec` join in the spec engine, orchestrator, fleet, docs, drift,
guard, recap and MCP resources; `config_context_path`,
`config_skills_dir` and `config_codemap_path` do the same for
the context directory (`.codify/` by default, `.hyperfide/context/` when
`hyperfide.kvx` is the file), `.agents/skills/` and `CODEMAP.md`. A path that is absolute,
empty, escapes the tree, or lands in `.git/` or `.codegraph/` is
rejected with a message naming the key, and the default stands.
`config_auto_sync` gates the implicit syncs — the freshness pass before
read commands, the post-edit hook, the pre-commit index, `work open`,
MCP `sync_first` tools, the LSP, the watcher, fleet watch and integrate
— while `hyperfide sync`, `hyperfide index` and qualification still index.
`[index] workers` sets the parse thread count: `config_index_workers`
returns the count asked for (0 = the machine's), `config_parse_workers`
reads a count as written anywhere — the configuration file,
`HYPERFIDE_INDEX_WORKERS`,
`--workers` — and `hyperfide info` prints which source won.
Every key is a row of `CFG_KEYS` with a type — `CFG_BOOL`, `CFG_PATH`,
`CFG_INT`, `CFG_STR`, `CFG_DUR` (a duration such as `24h`, read by
`hier_duration`), `CFG_LIST` and `CFG_ENUM` — a default, and the comment
`hyperfide config init` writes. The keys beyond paths and workers are
`[sync] auto` (default true, `config_auto_sync`), `[index] walk` (`auto`, `git` or `full`; `config_index_walk`, parsed by
`config_parse_walk`), `[projection] base`, `stale` (default `24h`),
`exclude` (branch-name globs), `index` (default false), `steer`
(default true), `auto` (default true) and `min_interval` (default `15s`)
behind the `config_projection_*` accessors, `[fleet]
discover` (default true, `config_fleet_discover`) and `[hooks]
shell_advice` (default true, `config_shell_advice`).
`config_check` reports unknown sections, keys and unusable values;
`hyperfide check` shows them as warnings. See [config.md](config.md).

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
and `--check` and `hyperfide brief` (`codemap_status`) re-render at the
recorded budget and compare bytes. See [codemap.md](codemap.md).

## Git interop (`gitint.c`)

`hyperfide git-sync` pipes `git log --name-only` into `git_commits` and
`git_churn` — no libgit2, no new link-time dependency. Churn then feeds
`touches` evidence in `vcs.c`; search ranking does not read it in this
revision. `hyperfide commit --git` mirrors a snapshot into a
real git commit carrying the same `[spec:feature/id]` tag, and
`ignore_load` (in `util.c`) reads `.gitignore` (including nested ones, with negation
and anchoring) alongside `.cgignore`. Adopting Hyperfide is therefore never
all-or-nothing.

## Changelog (`changelog.c`)

`src/changelog.c` is the git-history changelog renderer. `cmd_changelog_git`
reads tags and commits through `git` pipes, groups each subject by its
`area:` prefix, turns a trailing `[spec:<feature>/<task>]` into a task
reference, and builds commit and compare links from `git remote get-url
origin` (with no remote, bullets carry the bare hash and the footer is
omitted). Release boundaries are tags merged with version bumps:
`boundaries_load` walks the history of the project's version file
(`src/cg.h`, `VERSION`, or `package.json`; for `src/cg.h` it takes the
first quoted string after `define CG_VERSION`) and starts a
release at every commit that changed the version. The newest section is
named by the working tree's version when that is newer than the last
boundary, by `--tag`, and only otherwise `[Unreleased]`. In this tree `CG_VERSION` is
defined as `HYPERFIDE_VERSION`, so the first quoted string after it is
`HYPERFIDE_PRODUCT`'s `"Hyperfide"` rather than a version number, and
`hyperfide changelog` on this repository names its newest section
`[Unreleased]`. For a tags-only
repository with no version file, the output matches `cliff.toml`, the
git-cliff configuration at the repository root; git-cliff is a
reference, never a runtime dependency.

Optionally a model adds prose. With `CENTRA_API_KEY` (or
`HYPERFIDE_CHANGELOG_KEY`) in the environment or the project's `.env`, each
release gets a `### Highlights` block written from its grouped commits by
an OpenAI-compatible endpoint (`HYPERFIDE_CHANGELOG_ENDPOINT`,
`HYPERFIDE_CHANGELOG_MODEL`), called through `curl` with a private `0600` config
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
the state. Outside local mode the chunk is first offered to the
distributed decision service (`hf_decision_advice`, purpose `recap`), whose
answers are not cached; in local mode, or when that path is not routed, it
goes through `jev_ask_at`, the Jev client pointed at
another key, model and endpoint (`openrouter/upstage/solar-decide` at the
Centra gateway's `/v1/systemone`), so the request builder, private-config
curl, retries and `jev.log` are shared. The endpoint bills each question
against the whole state and caps a request at 100 questions, so chunks
stay small and `decide_parallel` forks workers that fill the cache
(`.codegraph/recap-cache/<first 20 hex of sha256(model|sha256(state))>.txt`, one line per
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
cite `[sN]`; the brief lands at `-o` (default `recap.md` in the context directory,
`.codify/` or `.hyperfide/context/`) under a
comment naming both models and the counts. `--decided` stops before the
writer; `--facts` runs no model at all.

## Governance (`govern.c`)

The commands that put Hyperfide inside the loop rather than at its ends:
`hyperfide brief` (session state in one call — task-scoped memories first,
padded with recent, deduplicated, bodies capped), `hyperfide review` (changed
symbols paired with the acceptance criteria they claim and the callers
now at risk), `hyperfide guard` (edits outside the in-progress task's declared
`touches`), and `hyperfide check` (the single CI gate: render staleness, lint,
task evidence, lease consistency, worktree state). They read the spec
through `cmd_spec`'s own `--json` output via `cg_capture`, so there is
one implementation of the task model rather than two.

`govern.c` also owns session continuity. `hyperfide handoff` writes one
structured memory of type `handoff`
(`handoff|done:…|next:…|blocked:…|note:…|files:…`, files = current
uncommitted paths) linked to the task; each new handoff supersedes the
previous live one through the `memory_superseded` chain, so there is
exactly one current handoff per task. `hyperfide resume` reverses it for a
fresh session: task packet, the latest handoff parsed back into fields,
task-scoped memories, uncommitted paths, and lease state — `--prompt`
renders the bundle as a paste-ready briefing, which is also what the
orchestrator and the VS Code extension feed to agent sessions.

Everything here is advisory by default. `hyperfide guard` exits zero unless
`--strict`, which is what makes `hyperfide hook install` safe: wiring it into a
`PostToolUse` hook or a pre-commit hook can report scope drift without
ever breaking a workflow that was working before.

## Orchestrator (`orchestrate.c`)

`hyperfide spec run` composes the primitives above into a driver of agent
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
prompt is produced by `hyperfide docs packet` instead of `hyperfide resume`. The child must
finish with `hyperfide docs close`; a plain exit, direct `spec docs done`, or stale
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

### The supervisor (`--fleet`, `hyperfide fleet up`)

`hyperfide spec run --fleet` wraps that loop in the hierarchy, and `hyperfide fleet up`
runs it detached: `detach_supervisor` forks a `setsid` child running `hyperfide
spec run --fleet --run-id <id>` with its output in
`.codegraph/fleet/supervisor-<run>.log`, and returns once the child has
recorded the run. `supervisor_run` owns one or more features, each its own
run; `supervisor_tick` is one pass over persisted state — reap, progress,
budgets, retries, escalation, approvals, spawn. The `fleet_runs` and
`fleet_nodes` tables hold everything a later supervisor needs (every node's
role, parent, agent, task, branch, worktree, pid and start time, attempt,
fence, retries, spend), so `--resume` adopts a child whose pid and
`/proc` start time still match and judges any other by its branch tip.

`orch_spawn_manager` starts a manager in its branch's worktree — one per
wave (`wm-{feature}-{wave}` on the wave branch), or one for the feature in
the old shape (wave -1) — and `orch_spawn_worker` a worker per free slot,
per task when the worker template names `{task}`, per wave otherwise. The
supervisor keeps its managers in an array of `SupMgr` slots
(`sup_mgr(wave)`, at most `SUP_MAX_MGRS`, 64; `sup_mgrs_live` counts the
live ones). `sup_wake_managers` gives a turn to every wave that still owes
something — an unfinished task or a branch not yet landed — on the run's
first turn, and later to a wave whose workers have all ended with an empty
frontier, or whose manager an escalation or a conflict asks for; live
managers are capped by `[role.manager] max` when it is set (`mgr_max`;
unset means every wave, and the old shape has one manager) and every turn
spends one of the run's wakes.
Two tasks of one wave run one after the other only when the worker
template has no `{task}` (they would share a branch); with per-task
workers, the waves and the tasks in them run side by side, apart from
predicted collisions. Each is spawned through the role's
driver capabilities, with the role, parent, feature, wave, branch, base,
and run exported and the branch already checked out. Workers and managers
run concurrently; the merge lock in `fleet.c` serializes their merges.
The main agent, when `[hierarchy] main_agent` asks for one, is a driver
process woken at start, on a blocked task, and when a feature finishes.

Waves run side by side by default. `orch_req_ready` is the gate: with
`[hierarchy] waves = parallel` a requirement is ready when it is finished
or when a live slot is working on it, so the dependent task starts ahead,
builds against the projection, and its `done` waits for the land; with
`sequential` a requirement is ready only where the task's branch is cut
from — main for another wave's task (the manager-per-wave shape, and not
while a land still owes a forward merge), the wave branch for its own.
`orch_next_task_in` picks the lowest such task of one wave, and
`orch_next_task` of the whole feature. A worker spawned ahead is started through
`spec_start_ahead`, which records what the lease is ahead of in
`leases.ahead` (a column added on first use) and gives the worker's prompt
an *Ahead of its requirements* section naming the open requirements,
their branches, `--branch codify/projection` and `hyperfide projection
findings`; `hyperfide spec start --ahead` and `hyperfide fleet begin --ahead` are the
same path by hand, and `--force` no longer bypasses `requires` anywhere.
`hyperfide spec done` stays strict: `task_unmet` lists the requirements not done
in the tree it runs in, and inside a fleet run (`HYPERFIDE_RUN` or `HYPERFIDE_ROLE` set)
`--force` does not get past them, so an ahead task qualifies only once
its requirements have landed and come in through `hyperfide fleet sync`. After a
land, `sup_forward_merge` merges main into every live wave branch in that
wave's manager worktree, between the manager's turns and under the merge
lock; each live worker of the wave is steered to `hyperfide fleet sync` and a
`fleet.forward` event records who was told. A conflict is aborted and
handed to the manager with the paths and the projection finding that
predicted them, and the workers are steered once main is an ancestor of
the wave branch again. A projection build follows every land and every
sync. Sequential waves keep one more gate: a land merges into main before
its test and lint gates run and emits `fleet.land` only after them, so
the main tree's spec says *done* before the land is known, and a task cut
then from a wave branch that has not had main merged forward would be
refused at its own done. `sup_forward_lands` therefore records on every
tick, per wave, whether main is an ancestor of the wave's branch
(`sup_wave_branch` names it from the manager template, `sup_wave_mark_fresh`
asks git through `sup_branch_has_main`), and `orch_req_ready` consults
`sup_wave_fresh` before it lets a task start on a requirement from another
wave. The mark is taken at the top of the tick and the frontier is read
later in it, so a land that reaches main between the two would leave a
mark that says fresh beside a spec that says landed: `sup_wave_fresh`
re-asks git for a mark that says fresh at the moment the gate decides,
after the frontier was read, and a stale *not fresh* only costs a tick.
The supervisor reads a
worktree without touching it: `sup_tree_fp`
(the stall check's git view) and `fleet.c`'s `tree_clean` run `git
--no-optional-locks status`, because a plain `git status` refreshes the
index under `index.lock` and, taken while the worker runs `git add` or
`git commit` in that worktree, fails the worker's command — a qualified
task that never reached its wave branch was the fleet tests' flake.

Supervision is four named checks: `supervisor_stall_check` (progress is an
event by or about the agent, log growth, or a git status/HEAD change in its
worktree; one idle window nudges through `driver_steer`, a second stops the
attempt with a handoff), `supervisor_budget_check` (wall and spend),
`supervisor_retry` (the next attempt's prompt carries the previous
attempts' reasons, last output, and outcome memories), and
`supervisor_escalate` (manager, then main, then blocked while the run
continues). A run ends when the subtree is **merged**, not when a process
exits, and the managers share one wake budget for the run (16 per wave
that has a manager by default, `ORCH_ROUNDS_DFLT`; `--max-rounds` sets the
whole run's).
`orch_tree_status` renders the same join for `hyperfide fleet tree` and
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
attempts, conflicted merges, and pending approvals. `hyperfide work update`
gains an `upstream` delta (`work_upstream_delta`) naming the tasks merged
into the attempt's base since it began and the symbols they brought.

## Documentation closure (`docs.c`)

The [documentation walkthrough](DOCUMENTATION.md) covers operation and recovery. For exact indexed declarations, use the [source reference](SOURCE-REFERENCE.md); [test-only observations](TEST-REFERENCE.md) are kept separate from product interfaces.

The main entry points are `docs_packet`, `docs_check`, and `docs_close` in `src/docs.c`. `spec_docs_stage` in `src/spec.c` computes effective state, while `spec_docs_finish` couples the successful snapshot with fenced completion. A `docs_check` claim proves the existence and mapping it checks, not the semantics of every sentence in a document.

Documentation closure is a projection over existing authorities, not a second
source of truth. Its inputs are the active kvx feature, qualification and trace
output, task-tagged snapshots and changelog, graph symbols and routes,
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
`hyperfide resume --task <id> --prompt`, and launches the configured driver in
a named terminal or as a headless VS Code task; closing a terminal whose
task is unfinished offers to release the claim. A 10-second poll —
active only while sessions exist — keeps the task board fresh,
decorating tasks with the lease-holding agent and a terminal marker.
Every refresh in the extension, this poll included, goes through one
scheduler (`editors/vscode/refresh.js`): a single chain of `hyperfide` calls at
a time (`sync --max-age --background --wait 0`, `spec status`,
`spec trace --no-sync`, `recall`, `guard`), bursts debounced into one
run, a floor between runs, and at most one trailing run queued. The
extension does not watch `graph.db`, because its own sync writes it and
a watcher there made every refresh trigger the next. Every `hyperfide` verb is
called defensively, so an older binary fails with a message rather than
a hang; the manifest-coherence test keeps declared and registered
commands in lockstep.

Against a `hyperfide` that has `serve`, the polling above is off.
`editors/vscode/serve.js` holds one `hyperfide serve` child for the whole
extension: every `hyperfide` call goes down it as an `exec`, events come back as
pushed notifications, and `applyEvent` folds each into a small live model
the task, memory, and fleet views patch themselves from. It reconnects
with a backoff and takes one full refresh after a reconnect, since events
pushed while the pipe was down are gone. With `codify.serve` off, or an
older binary, the extension shells out and polls as before. `fleet.js`
builds the Start plan from `hyperfide fleet roles`, a dry run, `hyperfide drift
collisions`, and `hyperfide fleet runs`, and folds agent and supervisor events
onto the tree. In the chat (`agents.js`), `ChatCapabilities` turns the
served tool list into slash commands with arguments typed from each
tool's input schema, `approvalCard` renders an approval request as an
actionable card, and `Window` keeps a transcript at ten thousand entries
responsive by keeping only the newest rows in the DOM.

## Language server (`lsp.c`)

`hyperfide lsp` speaks Content-Length framed JSON-RPC 2.0 on stdio and answers
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

## Hyperfide 2.0 layout

Everything above is the local, single-machine core inherited from Codify
1.x. Hyperfide 2.0 adds two layers around it. The specification for that
work is `spec/hyperfide/spec.kvx`, and the operating model is described in
[operations.md](hyperfide/operations.md),
[design.body.md](../spec/hyperfide/design.body.md),
[migration.md](../spec/hyperfide/migration.md) and
[execution-contract.md](../spec/hyperfide/execution-contract.md).

### Implementation state

`spec/hyperfide/spec.kvx` has 113 tasks. Eight have `status = "done"`: 1.4,
4.1, 4.2, 4.4, 8.1, 10.1, 11.1 and 27.1. The other 105 are `pending`, and
that includes the tasks that own most of the native components and services
described below. The spec's `[execution]` section records that all product
acceptance remains UNRUN. `artifacts/hyperfide/tasks/<id>/evidence-index.json`
exists for 102 tasks. Each one records a `verify_cmd` run against a
registered task-component manifest: the commit, the exit code (0 for every
task except 18.4, which recorded 1) and an output tail whose
receipts say `"full_case_status": "INCOMPLETE"`. A component receipt is not a
full-case qualification. Source that exists for a pending task is therefore
described here as implemented, not qualified. The fleet sizes in the design
(hundreds of agents, 100 concurrent sandboxes) are planning targets. No
throughput, availability or provider limit has been measured.

### Native component registry (`src/hyperfide/`)

Native components are C modules owned by individual tasks. Each task
declares its module in a fragment, `src/hyperfide/components/<task>.kvx`,
and `src/hyperfide/components/schema.kvx` fixes the fragment format.
- Required fields: `schema_version`, `id`, `source`, `entry` and `actions`.
- Optional fields: `requires`, `support_sources`, `headers`, `libraries` and
  `native_dependencies`.
- One callback signature:
  `int entry(const char *action, const char *request_json, FILE *output)`.

`scripts/hyperfide-native-components.py` validates every fragment: the
fields, repository-relative non-symlink paths and the dependency order. The
`Makefile` calls it with `--sources`, `--headers` and `--libraries`, so
registered sources are compiled into `hyperfide` beside `src/*.c`. Python
runs only at build time; execution stays in the C binary.

`make hyperfide-native` regenerates `build/hyperfide-native-registry.inc` and
`build/hyperfide-native-link-contract.json`, then links
`build/hyperfide-native` from `component_main.c`. That executable is an
internal dispatcher, not a public command. It takes
`--component ID --action NAME` and one JSON object, either on stdin or in
`--request-base64` (URL-safe alphabet), at most 1 MiB. It answers with one
line:

```text
$ echo '{}' | build/hyperfide-native --component 26.1 --action branding.identity.describe
{"ok":true,"result":{"product":"Hyperfide","version":"2.0.0-dev","canonical_command":"hyperfide","compatibility_commands":["cg"],"native_protocol_version":1,"release_status":"development"}
```

The tree registers thirteen fragments. Every owning task is pending.

| Fragment | Source | Actions |
|---|---|---|
| 11.2 | `bootstrap.c` | `bootstrap.materialize` |
| 11.3 | `readiness.c` | `environment.readiness`, `environment.source.verify` |
| 12.1 | `supervisor.c` (+ `transport.c`, `supervisor_daemon.c`) | `supervisor.*`: keys, slots, enrolment, heartbeat, reconnect, serve |
| 12.2 | `launch.c` | `launch.start`, `.instruction`, `.reconcile`, `.serve` |
| 12.3 | `process_tree.c` | `process_tree.observe` |
| 12.4 | `control.c` (+ `job.c`, `preparation_stage.c`, `budget.c`) | `runner.*`: observe, stop, pause, drain, cancel, resume, slot release, reconcile, preparation stage, job execute |
| 13.1 | `connectors.c` | `connector.*`: describe, probe, launch, initialize, encode, resolve, observe, children |
| 13.3 | `connector_recovery.c` | `connector.recover` |
| 15.1 | `checkpoint.c` | `checkpoint.capture`, `.inspect`, `.export`, `.restore` |
| 21.4 | `advisory.c` | `decision.advisory.describe`, `.resolve` |
| 25.3 | `client.c` (+ `transport.c`) | `authority.mode` |
| 26.1 | `branding.c` | `branding.identity.describe`, `branding.compatibility.inventory` |
| 26.4 | `entrypoint.c` | `entrypoint.launchers.describe` |

Fragments 12.1 and 25.3 are the components that need libcurl and libcrypto.

### The public binary's front door (`main.c`, `client.c`, `entrypoint.c`)

`main` handles three Hyperfide layers before any local command runs.

1. **Environment aliases.** `hyperfide_environment_aliases` (`config.c`)
   pairs each `HYPERFIDE_*` variable with its legacy `CG_*` or `CODIFY_*`
   names. Examples are `HYPERFIDE_ROOT`/`CODIFY_ROOT`,
   `HYPERFIDE_INDEX_WORKERS`/`CG_INDEX_WORKERS` and `HYPERFIDE_MODE`/`CG_MODE`/
   `CODIFY_MODE`. Whichever name is set is copied to the others, so the legacy
   `CG_*` and `CODIFY_*` names keep working. If two names in a group hold
   different values, the binary prints
   `hyperfide: conflicting variable aliases for <NAME> (values redacted)` and
   exits 78.
2. **Packaged launchers.** After `version`, `hf_entrypoint_dispatch` handles
   `bootstrap`, `issue-watcher` and `supervisory-host`. It execs
   `<release>/runtime/node <release>/services/dist/<name>.js`, where
   `<release>` is the parent of the binary's `bin/` directory, or
   `HYPERFIDE_RELEASE_ROOT`. There is no PATH fallback. Outside a packaged
   release the binary prints
   `{"ok":false,"error":{"code":"PACKAGED_RUNTIME_REQUIRED"},"local_fallback":false}`
   and exits 78.
3. **Authority mode.** `hf_client_dispatch` takes the mode from
   `HYPERFIDE_MODE` (`local`, `offline` or `distributed`) together with a
   `HYPERFIDE_AUTHORITY_DESCRIPTOR`. `hyperfide authority mode` reports it.
   In a scratch directory with neither set, it printed:

   ```text
   {"ok":true,"mode":"local","remote_ownership":false,"local_fallback":false,"cache":{"store":"local","present":false,"authoritative":false,"freshness":"ABSENT","overwrite_remote":false}}
   ```

   In local mode every other command falls through to the local
   implementation described above. In distributed mode, only the commands in
   `hf_routes25` are sent over the authenticated transport that
   `HYPERFIDE_TRANSPORT_CONFIG` names. Those commands include
   `spec status|frontier|resolve`, `task claim|dispatch|renew|cancel|eligible`,
   `submission submit|inspect|revoke` and `graph status|search`. Any other
   command is refused with `DISTRIBUTED_COMMAND_UNSUPPORTED`, and offline mode
   refuses remote ownership. Neither mode falls back to local state.
   `authority` has no row in the help table in this revision. Task 25.3, which
   owns this routing, is pending.

### Control plane (`services/hyperfide`)

The control plane is a TypeScript package, `@hyperfide/control-services`
(version 2.0.0-dev). Its `engines` field pins Node 24.22.0, and it depends
on `pg`, `ws`, `@blaxel/core` and `railway`. Three `make` targets drive it:
- `make hyperfide-deps` runs `npm ci --ignore-scripts`.
- `make hyperfide-services` runs `tsc` into `dist/`.
- `make hyperfide-check` type-checks only.

`src/control.ts`, `src/provisioner.ts` and `src/dispatch.ts` are the three
role entrypoints. Each calls `runService(role)` in
`src/components/service.ts`. Startup needs `--policy FILE` and
`--spec-revision REV`. The service also accepts `--components`,
`--module-root`, `--mode stdio|https|daemon` (default `stdio`), `--host`,
`--port`, `--tls-cert` and `--tls-key`, and refuses any other flag:

```text
$ node services/hyperfide/dist/control.js
{"ok":false,"error":{"code":"INVALID_ARGS","message":"Explicit trusted policy and pinned specification revision required"}}
```

Service components are JSON fragments in `services/hyperfide/components/`,
112 in this tree. Each fragment names its `id`, owning `task`, `roles`,
`module`, `entry`, `api_version`, `actions` and `requires`.
`ComponentRegistry` (`src/components/registry.ts`) loads only the fragments
whose `roles` include the running service. In this tree 95 fragments include
`control`, 28 `provisioner` and 10 `dispatch`. The registry refuses a
dependency that the fragment does not declare, and one whose target lacks the
role.

A request is `{id, component, action, input}`, with
`system`/`system.describe` reserved for the registry itself. Request and
response sizes are bounded by `HF_SERVICE_MAX_REQUEST_BYTES` and
`HF_SERVICE_MAX_RESPONSE_BYTES` (default 1 MiB, range 256 bytes to 64 MiB).

The domain modules sit under `src/`:
- **Specification and hierarchy:** `spec`, `hierarchy`, `policy`.
- **Scheduling and dispatch:** `scheduler`, `events`, `agents`.
- **Graph:** `graph`.
- **Execution:** `providers` (Railway, Blaxel), `preparation`, `runner`.
- **Identity and transport:** `identity`, `transport`.
- **Artifacts and assurance:** `artifacts`, `assurance`, `review`,
  `findings`.
- **Integration and release:** `integration`, `release`, `deployment`.
- **Decisions and evaluation:** `decisions`, `evaluation`.
- **Operations:** `observability`, `recovery`.
- **Migration and docs:** `migration`, `docs`.

`bootstrap.ts`, `issue-watcher.ts` and `supervisory-host.ts` are the modules
behind the binary's packaged launchers.

PostgreSQL is the distributed authority, and everything lives in schema
`hyperfide`. The migrations are `services/hyperfide/migrations/NNNN-name.sql`:
35 files, from `0001-authority.sql` to `0704-graph-query-parity.sql`.
`src/storage/durability.ts` applies them in ascending order and records each
one's checksum in `hyperfide.schema_migrations`. An applied migration whose
bytes changed is refused with `MIGRATION_DRIFT`. A lower version inserted
below an applied one is refused with `MIGRATION_ORDER_INVALID`. Connection
and pool settings are read by `src/storage/runtime.ts` and
`src/storage/schema.ts`; [operations.md](hyperfide/operations.md#postgresql-and-migrations)
lists them. The local SQLite graph stays the store for the local commands.
Importing its history into PostgreSQL (task 25.1) and cutover (task 25.2)
are implemented as control components, and both tasks are pending.

## Tests

- `tests/unit/` — standalone binaries linked against every object except
  `main.o` (the set `build/libcg.a` archives): kvx grammar, SHA-256
  vectors, JSON scanner, StrBuf/file IO, configuration, drivers and
  language detection (`test_config.c`, `test_drivers.c`, `test_lang.c`).
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
  endpoint (`29_changelog`), the event log (`30_events`), `hyperfide serve`
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
  export and import across graphs (`39_memory_port`), `codify.kvx`
  with a relocated spec directory and auto-sync off (`40_config`), the
  progress line in its terminal, plain and silent forms (`41_progress`),
  the write journal's queue, replay, fencing and `hyperfide journal`
  (`42_journal`), the help table against `main.c`, every subcommand
  switch and the README's command reference (`43_help`), line search —
  trigram candidates, literal and regex scans from disk, symbol placement,
  ranking, the `-n`/`--budget` tail, `--json` and `grep_code` (`44_grep`),
  file finding by glob, path words and directory, `--dirs`, the shared
  filters on search, context and survey, and `find_files` over MCP
  (`45_files`), the index at scale on a 2000-file profile of the scale
  fixture — parallel and one-thread walks agree, literal candidates under
  5%, a one-file edit, the `--json` phases, RSS and walk mode, and
  `walk = git` through adds, edits, deletes, renames, commits and reverts
  (`46_scale`; `CG_SCALE=1` runs the default profile), the pre-bash shell
  advice and its opt-outs (`47_advice`), the Claude Code plugin and Codex
  hooks under a temporary `HOME` with a stubbed `claude` CLI
  (`48_plugin`), native agents from hook payloads — rows, worktrees,
  attribution, events, the fleet views, the upgrade of an old `agents`
  table and exit 0 on malformed input (`49_native`), discovery from the
  fixture transcripts in `tests/fixtures/native` (`50_discover`), the
  projection's fold, shadow commits, conflicts, ref, stored builds, no-op
  and `--index` (`51_projection`), its symbol, interface and near
  findings, events and steering (`52_conflicts`), and the builds that
  follow the work — the hooks, `hyperfide watch`, `hyperfide serve`, the supervisor,
  `min_interval`, `auto = false`, and the findings on `status`, `brief`,
  `merge-up` and `fleet tree --json` (`53_projection_live`). The semantic
  layer has its own fixtures: subsecond freshness (`54_freshness`), watch
  and index health (`55_watch_health`, `56_index_health`), the semantic
  store (`57_semantic_store`), the tree-sitter runtime and each grammar
  family (`58_ast_runtime` to `64_ast_mixed`), imports, resolution, types,
  routes, dispatch, channels and incremental debt (`65_sem_imports` to
  `71_sem_incremental`), answer health (`72_answer_health`), structured
  search, flow and inspection (`73_sem_search` to `75_sem_inspect`), the
  labelled conformance corpus in `tests/semantic/`
  (`76_semantic_conformance`), the index resource profile
  (`77_index_resources`), and a release-candidate pass that rebuilds with
  warnings fatal and runs every fixture once (`78_v16_release`).
- `tests/hyperfide/` — the Hyperfide qualification harness:
  `qualify.py` runs a registered case against a task manifest
  (`tests/hyperfide/manifests/tasks/<id>.json`, cases under
  `tests/hyperfide/cases/`) and `check-evidence.py` independently checks the
  resulting campaign. These are the `verify_cmd`s of `spec/hyperfide`
  tasks; a task-component receipt does not qualify a full case.
- `tests/scale/gen.py` — the deterministic scale fixture (default 20000
  files, about 2M lines) that `46_scale` and `scripts/bench.sh` build.
