# One graph for every branch and worktree

A fleet works on many branches at once, in many worktrees of the same
repository. Codify tracks all of them in **one** `.codegraph/` — one
database, one memory, one registry — rather than one index per checkout.
An agent on a wave branch can therefore see what every other worker is
doing without a second `cg init` and without re-parsing files that did not
change between branches.

Implemented in `src/db.c`, `src/gitint.c`, and `src/scan.c`; covered by
`tests/integration/27_branches.sh`.

## The shared project

`cg` resolves two things at startup: the **tree** it operates on, and the
**shared project** that owns the database. They differ only inside a linked
git worktree.

```
$ cg root --json
{"root":"/path/proj","shared":"/path/proj","worktree":false,"branch":"main"}

$ cd /path/wt && cg root --json
{"root":"/path/wt","shared":"/path/proj","worktree":true,"branch":"wave/x"}
```

When the upward walk finds no nearer project, a worktree resolves to the
repository's shared `.codegraph` through git's common directory. `cg init`
inside a worktree of an already-initialized repository **joins** it instead
of refusing or creating a second database:

```
$ cg init
joined /path/proj as worktree /path/wt on branch wave/x
```

No `.codegraph` is created in the worktree. `cg info` states the
relationship:

```
project root: /path/proj/.codegraph/worktrees/wave-fleet-1
worktree of:  /path/proj
branch:       wave/fleet/1
```

Branch identity is read from git's own files — `HEAD`, the refs,
`packed-refs`, the worktree's `gitdir` and `commondir` — without spawning
anything. A fleet runs thousands of `cg` opens; none of them forks `git`
just to learn its branch name.

## The branch registry

```sql
CREATE TABLE branches(
  id INTEGER PRIMARY KEY, name TEXT UNIQUE NOT NULL, worktree TEXT,
  head TEXT, base TEXT, updated INTEGER NOT NULL);
```

Every branch whose tree has been indexed gets one row, with the worktree it
was last seen in. The registry is **durable state**: a schema upgrade never
drops it, because its ids are what file rows are scoped by.

A branch unknown to the registry is registered at open, so the first `cg`
call from a fresh worktree costs one small write. If the database is busy
at that moment the branch id stays 0 and the indexer retries before it
writes any rows — rows are never written under an unknown branch.

A project with no git repository still gets a row; `cg branches` shows it
as `(none)`.

## Branch-scoped rows

```sql
CREATE TABLE files(
  id INTEGER PRIMARY KEY, branch_id INTEGER NOT NULL DEFAULT 0,
  path TEXT NOT NULL, lang TEXT, size INTEGER, mtime INTEGER,
  hash TEXT, lines INTEGER,
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

They apply to `search`, `symbol`, `context`, `survey`, `impact`, `recall`,
`anchors`, `check`, and `guard`. A hit is labelled with its branch **only
when more than one branch is in scope**, so ordinary single-branch output
is exactly what it always was:

```
$ cg search syncgate_acquire
function   syncgate_acquire   src/syncgate.c:64  int syncgate_acquire(const Cg *cg, long wait_ms) {

$ cg search syncgate_acquire --all-branches
function   syncgate_acquire   src/syncgate.c:64 @main            int syncgate_acquire(…)
function   syncgate_acquire   src/syncgate.c:64 @wave/fleet/1    int syncgate_acquire(…)
```

That matters for the counting commands too: `cg anchors` and `cg check`
report your branch's symbols, not the sum across every worktree a fleet
happens to have open.

## Parsing once, not once per branch

Ten worktrees of one repository are mostly the same bytes. The indexer
keys parsed content by **hash**, so a file whose content another branch has
already parsed is reused rather than re-parsed:

```
$ cg sync
indexed 50 files (162 unchanged, 0 removed, 0 skipped, 40 reused) in 2086ms — …
```

`reused` appears in the text line and as `"reused"` in `--json`. A fresh
worktree of a big repository therefore costs a walk and a copy, not a full
parse.

## Per-branch freshness and gates

Freshness bookkeeping is keyed by branch id (`cg_bkey` →
`last_index_at:3`, `index_pending_resolve:3`, `project_files:3`), so a
newly created worktree is never reported fresh because a sibling branch
walked seconds ago:

```sh
cd /path/proj && cg sync --max-age 60000 --json   # {"fresh":true,…}
cd /path/wt2  && cg sync --max-age 60000 --json   # {"fresh":false,…}  first walk
cd /path/wt2  && cg sync --max-age 60000 --json   # {"fresh":true,…}
```

The index gate is per branch too: a linked worktree gets
`.codegraph/index.<branch-id>.lock` and `.dirty` beside the main tree's, so
two worktrees walk in parallel while the machine-wide parse slots keep the
total budget bounded. See [sync.md](sync.md).

## `cg branches`

```
$ cg branches
* main                       203 files  bde2b2a9  /path/proj                          9s ago
  feature/fleet                0 files  227a1f98  /path/proj/.codegraph/worktrees/feature-fleet  2m ago  base main
  wave/fleet/1                13 files  b5d899dd  /path/proj/.codegraph/worktrees/wave-fleet-1   1m ago  base feature/fleet
```

`--json` returns the same with `current`, `current_id`, `root`, `shared`,
and per-branch `id`, `name`, `worktree`, `head`, `base`, `files`,
`updated`, `current`.

## Schema v16

`v15` introduced the registry and `files.branch_id`. `v16` widens two
durable tables in place, with `ALTER TABLE`, so nothing is rebuilt:

| Table | Column | Filled by |
|---|---|---|
| `attempts` | `branch` | `cg fleet begin` — the wave branch the work runs on |
| `attempts` | `worktree` | `cg fleet begin` — the checkout it runs in |
| `attempts` | `parent` | the agent's `CG_PARENT` |
| `memories` | `branch` | `cg remember` — the branch the note was made on |
| `memories` | `class` | `cg memory classify` — Jev's class for the note |
| `memories` | `confidence` | `cg memory classify` — how sure it was |

Those first three are what make a claim answer *which branch was this done
on* after the session is gone:

```
2.1  claimed by w-fleet-1 [worker under fm-fleet] on wave/fleet/1
```

### What an upgrade does and does not touch

On a `meta.schema_version` mismatch, the derived tables — everything the
indexer rebuilds from source — are dropped and recreated, and the
per-branch freshness marks go with the rows they described so the next sync
walks. The branch registry, agent registry, memories, git history, leases,
attempts, runtime events, and work evidence are never touched.

```
cg: schema upgraded to v16 — run 'cg sync' to rebuild the graph
```

After the upgrade the registry still lists every branch, each with 0 files,
and each branch repopulates on its own next sync — `main`'s sync rebuilds
`main`, not `wave/x`.

### Refusing to downgrade

An older `cg` — an editor's or MCP server's installed binary — must never
"upgrade" a newer database. It would drop the graph, the newer `cg` would
rebuild it, and the two would take turns re-indexing the whole tree on
every open. It refuses instead, and names the fix:

```
cg: /path/proj/.codegraph/graph.db is schema v99, but this cg (0.9.0) only knows v16.
    A newer cg indexed it — install that build (make install) or run it from its tree.
```

The refusal leaves the graph intact.

## Memory follows the code

A memory records the branch it was made on (`memories.branch`), because a
decision taken on a wave branch is not yet a decision of the project. When
that branch merges, the notes go with it:

```
$ cg fleet merge-up 2.1
merged wave/fleet/1 into feature/fleet: 1 commit (head 227a1f98) at …/feature-fleet
  promoted 3 memories to feature/fleet
```

`--json` carries the same as `memories_promoted`. Promotion moves a note to
the base branch and drops it when the base already holds an identical one —
same body, type, and task — so merging twice does not duplicate a decision.

## Knowing where you are

`cg brief` opens with the branch, the worktree it is in, and the other
branches with work in the graph, so a session that resumes in the wrong
tree finds out immediately:

```
$ cg brief
project: /path/proj/.codegraph/worktrees/wave-fleet-1
branch: wave/fleet/1 — worktree /path/proj/.codegraph/worktrees/wave-fleet-1
other branches: main, feature/fleet, wave/fleet/2
task: 2.1 — Alpha work  (in progress)
```

## `cg watch --fleet`

One watcher process for every worktree the graph knows about, instead of
one per tree:

```
$ cg watch --fleet
watching every worktree of /path/proj (debounce 300ms, background passes) — ctrl-c to stop
following main at /path/proj
following wave/fleet/1 at /path/proj/.codegraph/worktrees/wave-fleet-1
```

Each tree gets its own inotify descriptor and pending set, and the registry
is rescanned periodically, so a worktree added by `cg fleet begin` is
followed seconds later without a restart. It needs inotify; a build without
it says so rather than watching nothing.

## Limitations

- `--branch` names a branch **in the graph**, not in git. An unknown one is
  refused rather than guessed at:

  ```
  cg: no branch named 'no-such-branch' in this graph (cg branches lists them)
  ```

  A branch nobody has run `cg` in has no rows of its own; `cg branches`
  shows the file count per branch, which is where to look when a result
  seems thin.
- Content reuse is keyed by hash, so two branches holding the same file
  share the parse but still get their own rows. The saving is CPU, not
  storage.
- `cg watch --fleet` needs inotify, which means Linux. Elsewhere the
  per-tree `cg watch` is the way.
- A worktree of a repository that was never initialized binds nothing —
  there is no shared project to join, and `cg init` creates one for that
  tree as usual.
- The registry records the worktree a branch was *last seen* in. A branch
  checked out in two places at different times shows the most recent.
