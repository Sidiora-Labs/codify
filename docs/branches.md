# One graph for every branch and worktree

A fleet works on many branches at once, in many worktrees of the same
repository. Hyperfide tracks all of them in **one** `.codegraph/` — one
database, one memory, one registry — rather than one index per checkout.
An agent on a wave branch can therefore see what every other worker is
doing without a second `hyperfide init` and without re-parsing files that
did not change between branches.

`hyperfide` is the command. `cg` is the deprecated compatibility alias
from the same executable, with identical arguments, JSON and exit codes
(`hyperfide help`, under "command names"). Some messages quoted below still
print a `cg:` prefix, because that is what this build prints.

Implemented in `src/db.c`, `src/gitint.c`, `src/scan.c`, and `src/main.c`
(the `--branch` and `--all-branches` scope); covered by
`tests/integration/27_branches.sh`.

## The shared project

`hyperfide` resolves two things at startup: the **tree** it operates on,
and the **shared project** that owns the database. They differ only inside
a linked git worktree.

```
$ hyperfide root --json
{"root":"/path/proj","shared":"/path/proj","worktree":false,"branch":"main"}

$ cd /path/wt && hyperfide root --json
{"root":"/path/wt","shared":"/path/proj","worktree":true,"branch":"wave/x"}
```

When the upward walk finds no nearer project, a worktree resolves to the
repository's shared `.codegraph` through git's common directory.
`hyperfide init` inside a worktree of an already-initialized repository
**joins** it instead of refusing or creating a second database. It indexes
the worktree's tree under its own branch and says so:

```
$ hyperfide init
indexed 2 files (0 unchanged, 0 removed, 0 skipped) in 13ms — 2 symbols, 1 refs, 0 routes, 0 comments, 0 soft [2 workers]
joined /path/proj as worktree /path/wt on branch wave/x
```

No `.codegraph` is created in the worktree. `hyperfide info` states the
relationship:

```
project root: /path/wt
worktree of: /path/proj
branch: wave/x
```

Branch identity is read from git's own files — `HEAD`, the refs,
`packed-refs`, the worktree's `gitdir` and `commondir` — without spawning
anything. A fleet runs thousands of `hyperfide` opens; none of them forks
`git` just to learn its branch name.

## The branch registry

```sql
CREATE TABLE branches(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, worktree TEXT,
  head TEXT, base TEXT, updated INTEGER NOT NULL);
```

Every branch whose tree has been indexed gets one row, with the worktree it
was last seen in. The registry is **durable state**: a schema upgrade never
drops it, because its ids are what file rows are scoped by.

A branch unknown to the registry is registered at open, so the first
`hyperfide` call from a fresh worktree costs one small write. If the
database is busy at that moment the branch id stays 0 and the indexer
retries before it writes any rows — rows are never written under an
unknown branch.

A project with no git repository still gets a row; `hyperfide branches`
shows it as `(none)`.

## Branch-scoped rows

```sql
CREATE TABLE files(
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL, lang TEXT,
  size INTEGER, mtime INTEGER, mtime_ns INTEGER, hash TEXT, lines INTEGER,
  base TEXT,
  UNIQUE(branch_id, path));
```

A path exists once per branch. File ids stay unique across branches, so
every child table (`symbols`, `refs`, `routes`, `imports`) keys by file id
alone and needed no change.

The consequence is isolation: a sync run in a worktree adds and removes
rows on **its** branch only. A file created on `wave/x` never appears in
`main`'s rows, and a `main` sync never deletes `wave/x`'s.

## Reading one branch, or all of them

Every query command answers for the branch you are on. Two flags widen
that:

```
--branch <name>     ask another branch instead
--all-branches      ask every branch in the graph
```

They apply to the query commands, among them `search`, `symbol`, `grep`,
`files`, `context`, `survey`, `impact`, `recall`, `anchors`, `check`, and
`guard`. A hit is labelled with its branch **only when more than one branch
is in scope**, so ordinary single-branch output is exactly what it always
was:

```
$ hyperfide search alpha
function   alpha                        a.c:1  int alpha(void)

$ hyperfide search alpha --all-branches
function   alpha                        a.c:1 @main  int alpha(void)
function   alpha                        a.c:1 @wave/x  int alpha(void)
```

`hyperfide grep` labels a file group with the branch in brackets instead
(`a.c [wave/x] — 1 hit`).

That matters for the counting commands too: `hyperfide anchors` and
`hyperfide check` report your branch's symbols, not the sum across every
worktree a fleet happens to have open.

## Parsing once, not once per branch

Ten worktrees of one repository are mostly the same bytes. The indexer
keys parsed content by **hash**, so a file whose content another branch has
already parsed is reused rather than re-parsed:

```
$ hyperfide sync
indexed 50 files (162 unchanged, 0 removed, 0 skipped, 40 reused) in 2086ms — …
```

The text line names `reused` only when the count is not zero; `--json`
always carries `"reused"`. A fresh worktree of a big repository therefore
costs a walk and a copy, not a full parse.

## Per-branch freshness and gates

Freshness bookkeeping is keyed by branch id (`cg_bkey` in `src/db.c` →
`last_index_at:3`, `index_pending_resolve:3`, `project_files:3`), so a
newly created worktree is never reported fresh because a sibling branch
walked seconds ago:

```sh
cd /path/proj && hyperfide sync --max-age 60000 --json   # {…,"fresh":true,…}
cd /path/wt2  && hyperfide sync --max-age 60000 --json   # {…,"fresh":false,…}  first walk
cd /path/wt2  && hyperfide sync --max-age 60000 --json   # {…,"fresh":true,…}
```

The index gate is per branch too: a linked worktree gets
`.codegraph/index.<branch-id>.lock` and `.dirty` beside the main tree's, so
two worktrees walk in parallel while the machine-wide parse slots keep the
total budget bounded. See [sync.md](sync.md).

## `hyperfide branches`

```
$ hyperfide branches
  main                              2 files  3be99812 /path/proj                               0s ago
* wave/x                            3 files  3be99812 /path/wt                                 0s ago
```

A branch with a registry base adds `base <name>` at the end of its line.
`--json` returns the same with `current`, `current_id`, `root`, `shared`,
and per-branch `id`, `name`, `worktree`, `head`, `base`, `files`,
`updated`, `current`.

## Durable columns: schema v16 to v18

The graph's schema stamp in this tree is **18** (`SCHEMA_VERSION` in
`src/db.c`). `v15` introduced the registry and `files.branch_id`. `v16`
widened two durable tables in place, with `ALTER TABLE`, so nothing is
rebuilt:

| Table | Column | Filled by |
|---|---|---|
| `attempts` | `branch` | `hyperfide fleet begin` — the wave branch the work runs on |
| `attempts` | `worktree` | `hyperfide fleet begin` — the checkout it runs in |
| `attempts` | `parent` | the agent's `HYPERFIDE_PARENT` (alias `CG_PARENT`) |
| `memories` | `branch` | `hyperfide remember` — the branch the note was made on |
| `memories` | `class` | `hyperfide memory classify` — Jev's class for the note |
| `memories` | `confidence` | `hyperfide memory classify` — how sure it was |

`v18` widens the durable `agents` table the same way, for native sessions
and subagents (`kind`, `host_kind`, `agent_id`, `agent_type`, `state`,
`cwd`, `task`, `task_source`, `last_tool`, `tool_calls`, and more; see
[events.md](events.md#native-agents-hyperfide-hook-event)). The derived `files`
table gained `base` (the last path segment) and `mtime_ns` within v18, also
in place.

The `attempts` columns are what make a claim answer *which branch was this
done on* after the session is gone. The `claims:` lines of
`hyperfide spec status` name it:

```
  2.1      claimed by w-fleet-1 [worker under fm-fleet] on wave/fleet/1 (attempt 3f2a9c1b0d4e, fence 2, 58 min left)
```

### What an upgrade does and does not touch

On a `meta.schema_version` mismatch, the derived tables — everything the
indexer rebuilds from source — are dropped and recreated, and the
per-branch freshness marks go with the rows they described so the next sync
walks. The branch registry, agent registry, memories, git history, leases,
attempts, runtime events, and work evidence are never touched.

```
cg: schema upgraded to v18 — run 'cg sync' to rebuild the graph
```

After the upgrade the registry still lists every branch, each with 0 files,
and each branch repopulates on its own next sync — `main`'s sync rebuilds
`main`, not `wave/x`.

### Refusing to downgrade

An older binary — an editor's or MCP server's installed one — must never
"upgrade" a newer database. It would drop the graph, the newer binary would
rebuild it, and the two would take turns re-indexing the whole tree on
every open. It refuses instead, and names the fix:

```
cg: /path/proj/.codegraph/graph.db is schema v99, but this cg (2.0.0-dev) only knows v18.
    A newer cg indexed it — install that build (make install) or run it from its tree.
```

The refusal leaves the graph intact.

## Memory follows the code

A memory records the branch it was made on (`memories.branch`), because a
decision taken on a wave branch is not yet a decision of the project. When
that branch merges, the notes go with it:

```
$ hyperfide fleet merge-up 2.1
merged wave/fleet/1 into feature/fleet: 1 commit (head 227a1f98) at …/feature-fleet
  promoted 3 memories to feature/fleet
```

`--json` carries the same as `memories_promoted`. Promotion moves a note to
the base branch and drops it when the base already holds an identical one —
same body, type, and task — so merging twice does not duplicate a decision.

## Knowing where you are

`hyperfide brief` opens with the branch, the worktree it is in, and the
other branches with work in the graph, so a session that resumes in the
wrong tree finds out immediately:

```
$ hyperfide brief
project: /path/proj/.codegraph/worktrees/wave-fleet-1
branch: wave/fleet/1 — worktree /path/proj/.codegraph/worktrees/wave-fleet-1
other branches: main, feature/fleet, wave/fleet/2
task: 2.1 — Alpha work  (in progress)
```

## `hyperfide watch --fleet`

One watcher process for every worktree the graph knows about, instead of
one per tree:

```
$ hyperfide watch --fleet
watching every worktree of /path/proj (debounce 300ms, background passes) — ctrl-c to stop
following main at /path/proj
following wave/x at /path/wt
main: 1 updated (0 reused), 0 removed (14ms)
```

On Linux each tree gets its own inotify descriptor and pending set, and the
registry is rescanned periodically, so a worktree added by
`hyperfide fleet begin` is followed seconds later without a restart. A
build without inotify falls back to periodic reconciliation: every
registered worktree is synced in the background every debounce interval or
3 seconds, whichever is longer, and it says so on stderr (`src/watch.c`).

## The Hyperfide control plane

Everything above is the local binary working on the checkout's own
SQLite graph. The binary selects an authority mode before it opens that
graph (`src/hyperfide/client.c`); `hyperfide authority mode` prints it.
With no descriptor the mode is `local` and every command here behaves as
documented. With a distributed descriptor (`.hyperfide/authority.json` in
the tree or above it, or `HYPERFIDE_AUTHORITY_DESCRIPTOR`), commands with
no distributed mapping — `branches`, `sync`, `fleet begin`,
`fleet merge-up` among them — refuse with `DISTRIBUTED_COMMAND_UNSUPPORTED`
and exit 78 rather than fall back to the local graph.

In that model the control service owns distributed claims, leases and
ownership generations (`services/hyperfide/src/scheduler/claim.ts`,
`scheduler/leases.ts`) and the central versioned graph
(`services/hyperfide/src/graph/`). Import of an existing SQLite graph,
including the branch registry and attempts, is
`services/hyperfide/src/migration/sqlite.ts`. The corresponding tasks
(5.1, 7.1 to 7.4, 25.1, 25.3) are `pending` in `spec/hyperfide/spec.kvx`,
so distributed operation is not qualified in this revision; see
[docs/hyperfide/operations.md](hyperfide/operations.md).

## Limitations

- `--branch` names a branch **in the graph**, not in git. An unknown one is
  refused rather than guessed at:

  ```
  cg: no branch named 'no-such-branch' in this graph (cg branches lists them)
  ```

  A branch nobody has run `hyperfide` in has no rows of its own;
  `hyperfide branches` shows the file count per branch, which is where to
  look when a result seems thin.
- Content reuse is keyed by hash, so two branches holding the same file
  share the parse but still get their own rows. The saving is CPU, not
  storage.
- Without inotify, `hyperfide watch --fleet` reconciles on a timer instead
  of reacting to each change, so an edit waits up to one interval.
- A worktree of a repository that was never initialized binds nothing —
  there is no shared project to join, and `hyperfide init` creates one for
  that tree as usual.
- The registry records the worktree a branch was *last seen* in. A branch
  checked out in two places at different times shows the most recent.
