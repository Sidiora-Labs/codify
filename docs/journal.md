# The write journal

An agent finishing a task should not be derailed because an editor's
`cg lsp` happens to be re-indexing the tree. When a lifecycle write is still
blocked after the lock wait (`CG_BUSY_TIMEOUT_MS`, 30 s by default), `cg`
appends it to a journal under `.codegraph/journal/`. The command then exits 0
with its own result complete and says the write is queued. The next `cg`
process that gets the write lock applies the queue.

The journal is implemented in `src/journal.c` and covered by
`tests/integration/42_journal.sh`. `tests/integration/23_dblock.sh` covers
the lock behaviour around it.

## What is journaled, and what is not

| Journaled (exit 0, "queued") | Operation |
|---|---|
| `cg remember` (including `--supersedes`) | `memory.add` |
| the outcome memory of `cg spec done` and of a refusal | `memory.add` |
| the lease release and attempt finish behind `cg spec done`, `implemented`, `release` | `lease.release` |
| `cg spec heartbeat` | `attempt.heartbeat` |
| `cg handoff` | `handoff.add` |
| `cg work open` / `cg work update` (the new revision row) | `work.update` |
| `cg work close --evidence …` | `work.close` |
| `cg event ingest` (agent hooks) | `event.ingest` |
| the events every command emits (`task.status`, …) | `event.emit` |

Some writes are correct only against the live state, so they are never
queued. These keep the old behaviour: they wait, then exit 75 with nothing
changed and a message saying the command is safe to retry. The message also
says why the write is not journaled.

- `cg spec claim`, `cg spec claim-next`, and fleet claims. A claim must see
  the live leases and attempts to decide who owns the task.
- `cg sync` / `cg index`, `cg memory import`, `cg memory compact`, and any
  other maintenance write.

A task status lives in `spec.kvx`, so it is always written immediately.
`cg spec done` never exits 75 after its verification passed. The status
lands in the file and every database side effect behind it is journaled.

The `runtime_files` hash cache is not journaled either. When the database is
busy, the workspace walk still computes an exact revision and leaves the
cache for the next command to fill.

## When the queue is applied

A process replays the journal whenever it holds, or can take, the write
lock:

- right after any successful `cg_begin_write`, inside that same transaction,
  before its own write;
- when the database is opened and the lock is free that instant (a zero-wait
  probe);
- at the start of `cg sync` and `cg index`;
- on `cg journal apply`, which waits the full lock timeout.

Each record is applied once, in its own transaction, and its file is removed
once that transaction commits. The process's own records go first, so a
process that queued a write and then gets the lock sees it before its next
write. Everyone else's records follow in name order, which is time order.

Two processes never apply a record twice:

- Replay holds a non-blocking `flock` on the journal directory. A second
  replayer skips rather than waits, because it may be waiting on the very
  lock the first holds.
- Each applied record's id is written to `journal_applied` in the same
  transaction as the record's effects. A record whose file survived a crash,
  or that was copied back, is recognised and only deleted.
- Applied ids older than seven days are pruned.

A busy wait is paid once per process. After one write has waited the full
timeout, later journaled writes in the same command try the lock once and
queue at once.

## Records

Each record is one file, named `<ms since epoch, 13 digits>-<pid, 7>-<seq,
4>.json`. It is written to a dot-file, fsynced, and renamed into place, so a
reader never sees half a record:

```json
{"v":1,"id":"1791358355788-2292778-0001","at":1791358355788,"pid":2292778,
 "op":"memory.add","command":"remember","summary":"[decision] use the journal",
 "branch":"main","agent":"alpha","run":null,
 "args":{"created":1791358355,"type":"decision","task":"jr/1.1",
         "body":"use the journal","symbols":"formatName","files":"src/a.c",
         "source":"manual","supersedes":0}}
```

`branch`, `agent` and `run` are the writer's. The writer's values are what
is stored, not the replayer's, and that covers all of the following:

- a memory keeps its original creation time, task, type, symbols, files,
  source and branch;
- an event keeps its `at`, run and branch;
- a work revision keeps the file snapshot it was cut from.

Two kinds of record re-check their condition when applied, because their
conditions are fenced:

- A lease release carries the agent, attempt id and fence. If the lease
  changed hands in the meantime, the release is a no-op, not a failure.
- A heartbeat renews only the attempt it names.

## Failed records

Some records fail in a way waiting will not fix:

- the file is not valid JSON;
- the `v` is newer than this binary;
- the operation is unknown;
- the database rejects the write for a reason other than busy.

Such a record is moved to `.codegraph/journal/failed/`, with the error in a
`.err` file beside it, and reported once on stderr. Only that record fails;
the replay goes on to the next one.

## Seeing the queue

- `cg brief` and `cg state` say how many writes are pending (and refused),
  only when there are any. `--json` adds `"journal":{"pending":N,"failed":M}`.
- `cg check` reports pending or refused records as a warning, never a
  failure. Under `--strict`, warnings fail as they always do.
- `cg recall` lists queued memories that match the query, marked `queued`
  and listed before the stored ones. An agent that remembered a decision a
  moment ago still finds it. In `--json` they appear under `"queued"` with
  `"id":null`.
- Every command that queued something without saying so itself prints one
  stderr line on exit: `the graph database is busy — N writes queued in
  .codegraph/journal/; the next cg command that gets the lock applies them`.

## `cg journal`

```
cg journal [list] [--json]       pending and failed records: id, when, command, op, summary
cg journal apply [--json]        replay now, waiting the lock timeout (exit 75 if it never frees)
cg journal drop <id> [--json]    remove one pending or failed record
cg journal drop --failed         remove every failed record
cg journal drop --all            remove every pending and failed record
```

`cg journal apply --json` prints `{"applied":N,"failed":M,"pending":P}`. On
a lock that never frees it prints `{"applied":0,"busy":true,"pending":P}`
and exits 75.

## Limitations

- A queued work revision is returned to the agent at once, but
  `cg work update <revision>` cannot find it until the queue is applied. The
  error says so.
- Events that database triggers emit for a journaled memory or lease carry
  the replay time, not the original. Events the command emits itself are
  journaled with their original `at`.
- The journal is local to the checkout's shared `.codegraph/`. It is not
  synced, exported, or committed.
