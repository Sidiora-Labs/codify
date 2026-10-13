# The sync gate

One indexer per project, one core budget per machine.

Every `cg` command that wants a fresh graph used to walk, parse, and
resolve on its own. That is fine for one session. Under a fleet of agents
it meant one indexer per hook invocation — fifty processes, each sized for
the whole machine, all walking the same tree for the same change. The gate
makes indexing a shared resource instead of a per-process habit.

Implemented in `src/syncgate.c` and `src/scan.c`; covered by
`tests/integration/25_syncgate.sh`.

## The gate

Three files under `.codegraph/`, and no SQLite involvement at all — the
database lock still serializes writers exactly as it did. The gate only
keeps the expensive part, walking and parsing, from happening more than
once for the same change.

| File | Role |
|---|---|
| `index.lock` | `flock`'d by the process running the pass |
| `index.dirty` | the note a loser leaves: one root-relative path per line, or `*` for the whole tree |
| `index.dirty.lock` | keeps an appender and the draining winner from interleaving |

A caller takes the lock non-blocking (or polls for `--wait` ms). The
winner walks. A loser does **not** queue a second walk: it appends the
paths it wanted synced to `index.dirty` and returns `coalesced`, having
indexed nothing. Before releasing the lock the winner drains the note, so
a file an agent wrote *during* the pass does not wait for a fourth process
to notice it. The drain is bounded at three passes; anything queued after
that stays queued for the next caller.

A runaway marker is as bad as the storm it prevents, so past 256 KiB the
note collapses to `*`.

The marker is taken atomically: it is renamed to a per-pid name, read, and
unlinked, so a concurrent appender never writes into a file that is about
to disappear.

**Per worktree.** A linked worktree that joined the shared graph gets its
own lock and note beside the main tree's — `index.<branch-id>.lock`,
`index.<branch-id>.dirty`. Its paths are its own and its walk is
independent; the machine-wide slots below keep the total parse budget
bounded across all of them. See [branches.md](branches.md).

## Freshness

`meta.last_index_at:<branch-id>` records when the branch's last whole-tree
walk finished. A caller passes the age it is willing to accept, and the
walk is skipped entirely when all three hold:

- the last pass is younger than that window,
- no `index_pending_resolve` flag was left by a stalled pass,
- no dirty note exists.

The key is scoped to the branch, so a freshly created worktree is never
reported fresh because a sibling branch walked seconds ago.

The windows the built-in callers use:

| Caller | Window | Lock wait |
|---|---|---|
| read-mostly CLI (`review`, `brief`, `agentmd`, `commit`) | 3000 ms | full `CG_BUSY_TIMEOUT_MS` |
| `cg mcp` tool calls that sync first | 1500 ms | bounded |
| `cg lsp` | 3000 ms | short, never blocking |
| `cg spec` graph checks | none — always walks | full wait |
| `cg hook post-edit` (path in payload) | targeted, no window | 0 — coalesces immediately |
| `cg hook post-edit` (no path) | 5000 ms | 0 |
| VS Code refresh | 3000 ms | 0 |

`cg spec trace --no-sync` answers from the last completed index without
touching the gate at all — that is what the editor polls.

A sync or index holds the write lock in short bursts. While one runs, other
commands' lifecycle writes may outlast their lock wait. That covers
`cg remember`, `cg handoff`, the bookkeeping behind `cg spec done`, and hook
events. Those writes are queued in the write journal under
`.codegraph/journal/` instead of failing, and the command still exits 0
([journal.md](journal.md)). `cg sync` and `cg index` replay any queued
writes before they walk, as does every process that takes the lock. The
indexer's own writes are never journaled. A sync that cannot get the lock
reports busy as before.

## Machine-wide parse slots

Freshness and coalescing bound one project. Slots bound the machine: a
directory of lock files under `/tmp/codify-<uid>` (override with
`CG_SLOT_DIR`), `cores_effective / 4` of them by default (`CG_INDEX_SLOTS`
overrides, minimum 1).

A pass that wants more than two parse threads must hold a slot. Without
one it still runs — on two threads. Several projects indexing at once
therefore share the cores instead of each claiming all of them.

The worker budget for one pass (`syncgate_worker_budget`), in order:

1. The count asked for — the first of `--workers N` on `cg index` or
   `cg sync`, `CG_INDEX_WORKERS`, `[index] workers` in `codify.kvx`
   ([docs/config.md](config.md#index-workers)), and the machine's sized
   worker count (at most 16). An asked-for count may exceed the machine's
   choice, up to 64, the pipeline's hard cap. `auto` or `0` defers to the
   next source; `cg info` prints the result and its origin.
2. Capped by the caller's ceiling (the language server asks for a quarter
   of the cores).
3. For a background pass, a quarter of an asked-for count (minimum 1), or
   with nothing asked for, a quarter of the cores (minimum 2).
4. Capped by the number of files actually queued.
5. Capped to 2 when no slot was free. A
background pass also renices itself to 10 once: a hook's sync should lose
to the agent's own build and tests, not compete with them.

## Incremental post-scan resolution

Walking less is only half of it — the pass after the walk used to rewrite
every reference, import, and anchor edge in the graph for a one-file edit.

The write phase now collects the changed file ids and the symbol names the
change added or removed into temp tables (`index_scope_begin`). When the
scope is bounded and the caller did not ask for `--full`, resolution runs
over it alone:

- refs **in** changed files, plus refs **anywhere** that name a touched
  symbol (a rename has to unresolve its old callers),
- imports of changed files, plus unresolved imports a new file could now
  satisfy,
- soft anchor edges for comments in changed files or naming a touched
  symbol.

`--full`, and the recovery path after a stalled pass, keep the global
rebuild. Resolution meta counters are recomputed from the table rather than
incremented, so they stay truthful either way, and the test asserts that a
scoped pass and a full rebuild agree on the resulting soft-edge count.

`cg sync --json` reports `"scoped": true` when the short path ran.

## Commands

```sh
cg sync                          # incremental; coalesces, honours freshness
cg sync src/a.ts src/b.ts        # targeted: only these paths are walked
cg sync --max-age 3000           # skip if a pass finished in the last 3s
cg sync --background --wait 0    # low priority, never waits for the gate
cg index --full                  # the blocking form: wait, then always walk
```

`cg sync` waits 2000 ms for the gate by default (0 with `--background`).
`cg index` is the form for a person who wants the pass to happen now: it
waits for the gate and always walks.

A targeted sync only stats, parses, or removes the paths named — a
directory target recurses, a path outside the project is ignored rather
than walked, and a targeted pass never claims the whole tree is fresh.

`--json` reports the gate's decisions:

```json
{"indexed":0,"removed":0,"seen":15,"skipped":0,"ms":4,"workers":0,
 "passes":1,"fresh":false,"coalesced":false,"busy":false,
 "scoped":false,"targeted":false}
```

In text form the same three outcomes read as:

```
indexed 9 files (6 unchanged, 0 removed, 0 skipped) in 16ms — … [9 workers]
index in progress in another cg process — change queued for it
graph is fresh (indexed 412ms ago)
```

## One hook, one process

`cg hook post-edit` is the wired edit hook. It reads the Claude Code hook
payload on stdin, does **one** targeted background sync of the edited path,
and guards that path — where the old template ran a full `cg sync` and a
separate `cg guard`, two whole-tree passes per edit. A payload with no file
path degrades to a background sync inside a 5-second window rather than an
error.

The guard output is capped at 24 lines with a `run \`cg guard <path>\``
pointer, because an edit hook's output lands in the agent's transcript and
the transcript is its working memory.

`cg hook install` writes the template that uses it, and the git
`post-commit` hook syncs with `--background`.

## Progress

`cg init`, `cg index`, and `cg sync` run by a person show one status line on
stderr while the pass runs: the phase (walking the tree, parsing files,
writing the graph, resolving references, finishing), files done of files to
do, the parse workers, the elapsed time, and the path in hand. On a terminal
it is drawn in place from 250 ms into the pass, at most ten times a second,
and erased before the summary, so the finished output is the same as before.
`cg init` also names its first step (creating the graph directory) and the
walk's file count once it is known.

A pass that waits says so — `waiting 3.1s for another cg process's index
pass` at the gate, `waiting 1.4s for the database write lock` between chunks
— so a wait is never mistaken for a hang. The stall and busy messages are
unchanged.

Piped output prints nothing new. `CG_PROGRESS=plain` prints one plain line
(no escape codes) at each phase change and at most every two seconds;
`CG_PROGRESS=0` turns progress off everywhere. `--json`, `--auto`,
`--background`, the post-edit hook, the freshness pass before read
commands, and the MCP, LSP, serve, watch, fleet, and editor refreshes never
show it. The counts come from the consumer loop the pipeline already runs;
parse workers never touch it.

## The index at scale

A whole-tree pass has four costs: finding what changed, parsing it, writing
it, and resolving references. Each one scales with the size of the change,
not with the size of the repository, wherever it can.

- **The walk is parallel.** Directories go into a shared queue, and walk
  threads read them (the parse budget, or `CG_WALK_THREADS`). The result is
  sorted, so the file list does not depend on the thread count. `.cgignore`,
  `.gitignore` and the size cap apply as before.
- **Git can supply the candidates.** With `[index] walk = git`
  (or `auto` above 20000 indexed files), a pass asks for changed and
  untracked files with `git status --porcelain=v2 -z`, plus a `git diff --name-only`
  since the head the last pass recorded. Only those files are stat'ed and
  hashed. Several events force a full walk: a changed ignore file, a moved
  head the diff cannot reach, a candidate list over 256K entries, or every
  twentieth pass. See [[index] walk](config.md#index-walk).
- **The body index is contentless** on SQLite 3.43 and later
  (`content=''`, `contentless_delete=1`). It stores the index but not a
  second copy of every file. Excerpts are cut from the file on disk.
  `cg info` names the mode (`body index: contentless` or `stored`), and
  `meta.fts_mode` records it.
- **Name lookups use `files.base`**, the indexed last path segment. The
  import resolver, the C header lookup, `cg context` path outlines and
  position lookups no longer use `LIKE '%/name'` scans.
- **A chunk purges its FTS rows in one statement per table.** Per-file FTS
  deletes each flushed the pending segment.
- `--json` reports `"walk"` (`git`, `full`, `targets`, `none`), `phase_ms`
  (`walk`, `parse`, `write`, `resolve`, `soft`) and `peak_rss_kb`. The
  one-line summary is unchanged.

### Measured

`scripts/bench.sh` builds the profile below in a scratch repository and
times each operation. `CG_SCALE=1 tests/integration/46_scale.sh` checks the
same profile against its limits (peak RSS under 2 GB, database under 6× the
source). Without `CG_SCALE`, the test runs a 2000-file profile on every
`make test`.

Profile: workstation, 16 effective cores, SQLite 3.45.1, body index
contentless. Fixture: 20000 files, 1,950,030 lines, 50.5 MB of source. The
machine was shared during the runs, so times vary by about 25%.

| Operation | Before (v1.4) | Now | Notes |
|---|---|---|---|
| `cg init` | 331 s | 30–40 s | 500–670 files/s, 49–65k lines/s |
| database after init | 208.6 MB (4.1×) | 141 MB (2.8×) | bytes per source byte in parentheses |
| peak RSS, `cg init` | 276 MB | 206 MB | |
| `cg sync`, nothing changed, `walk = full` | | 372 ms | walk 204 ms |
| `cg sync`, nothing changed, `walk = git` | | 362 ms | |
| `cg sync`, one file edited, `walk = full` | | 1073 ms | resolve 372 ms, soft 114 ms |
| `cg sync`, one file edited, `walk = git` | | 901 ms | |
| `cg index --full` | | 39–61 s | write 39–51 s, resolve 7 s; peak RSS 351–376 MB; database 180 MB (3.56×) |
| `cg context` (a literal) | | 326 ms | |
| `cg search` | | 93 ms | |

On the 2000-file profile, `cg init` drops from 6.0 s to 2.3 s and the
database from 20.7 MB to 13.9 MB.

Some costs remain:

- `cg index --full` spends most of its time writing. It deletes and
  re-inserts every FTS row, so it costs more per file than `cg init`.
- The scoped resolve still counts call verdicts over the whole refs table
  (about 150–300 ms at 20000 files).
- `git status` costs about 90 ms of a `walk = git` pass.
- An unresolved import whose target lies outside the pass's scope waits
  for the next `--full`.

## Environment

| Variable | Effect |
|---|---|
| `CG_INDEX_WORKERS` | parse threads for any pass, 1–64: beats `[index] workers`, yields to `--workers` (`auto`/`0`/unusable: unset) |
| `CG_INDEX_SLOTS` | machine-wide parse slots (default `cores/4`, minimum 1) |
| `CG_SLOT_DIR` | where the slot files live (default `/tmp/codify-<uid>`) |
| `CG_BUSY_TIMEOUT_MS` | how long a CLI write waits for the database lock (default 30000) |
| `CG_PROGRESS` | `plain`: progress as plain lines even when piped; `0`: no progress |
| `CG_WALK_THREADS` | walk threads for a whole-tree pass (default: the parse budget, 1–64) |

## Limitations

- The gate coordinates walking and parsing. It does not make SQLite
  writes concurrent: one writer at a time, as before.
- A coalesced caller returns without a fresh graph. It queued its change
  for the process that holds the gate; the answer it prints is from the
  last completed index.
- Three drain passes bound the winner's work. Under a continuous write
  storm the tail stays queued for the next caller rather than holding the
  gate indefinitely.
- Slot files are per user under `/tmp`. A directory that is not owned by
  the current uid is ignored, and the pass runs lean (two threads) instead
  of failing.
