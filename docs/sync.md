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

## Machine-wide parse slots

Freshness and coalescing bound one project. Slots bound the machine: a
directory of lock files under `/tmp/codify-<uid>` (override with
`CG_SLOT_DIR`), `cores_effective / 4` of them by default (`CG_INDEX_SLOTS`
overrides, minimum 1).

A pass that wants more than two parse threads must hold a slot. Without
one it still runs — on two threads. Several projects indexing at once
therefore share the cores instead of each claiming all of them.

The worker budget for one pass, in order: the machine's sized worker count,
capped by the caller, capped by `CG_INDEX_WORKERS`, capped to a quarter of
the cores (minimum 2) for a background pass, capped by the number of files
actually queued, and finally capped to 2 when no slot was free. A
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

## Environment

| Variable | Effect |
|---|---|
| `CG_INDEX_WORKERS` | hard cap on parse threads for any pass |
| `CG_INDEX_SLOTS` | machine-wide parse slots (default `cores/4`, minimum 1) |
| `CG_SLOT_DIR` | where the slot files live (default `/tmp/codify-<uid>`) |
| `CG_BUSY_TIMEOUT_MS` | how long a CLI write waits for the database lock (default 30000) |

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
