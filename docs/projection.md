# The projection — every branch in flight, merged now

When several agents work on several branches at once, the question nobody
can answer from one worktree is: what does main look like if all of this
merged right now, and where does it collide? `cg projection build` answers it
with a real git commit. It folds every active branch onto the base with
`git merge-tree`, includes each worktree's uncommitted work, and writes the
result to `refs/codify/projection`. Anyone can `git log`, `git diff`, or
`git checkout` that ref.

A conflict does not stop the fold. The branch goes in with git's conflict
markers in the affected files, and the path is recorded with every branch
that touched it. Two agents learn they collide before either of them merges.

The implementation is in `src/projection.c`, with the git plumbing in
`src/gitint.c`. The test is `tests/integration/51_projection.sh`.

## Commands

| Command | What it does |
|---|---|
| `cg projection build` | Fold the active branches onto the base and update the ref. A no-op that says so when nothing changed. |
| `cg projection build --force` | Rebuild even when the inputs are unchanged. |
| `cg projection build --strict` | Leave a branch whose merge step conflicts out of the projection, and say so, instead of folding it with markers. |
| `cg projection build --branch NAME` | Fold NAME too, whether or not it is active. Repeatable. A branch the registry does not know is folded from its ref. |
| `cg projection build --index` | Also check the projection out and index it as branch `codify/projection` (see below). |
| `cg projection build --wait MS` | How long to wait for a build that is already running (default 5000). |
| `cg projection status` | The last build, from the database, without rebuilding. |
| `cg projection diff [branch]` | `git diff --stat` of the projection against the base head it was built on, or against the named branch. |
| `cg projection show` | The paths the projection changes against the base, with git's status letter. |

Every command takes `--json`. The projection needs git 2.38 or newer, the
release that added `git merge-tree --write-tree`. Without a git repository,
or with an older git, the command says exactly that and exits 1.

## How a build works

1. **The base.** `[projection] base` in `codify.kvx`, else `[hierarchy] main`
   in `spec/workflow.kvx`, else `main`.
2. **The active branches.** Every branch in the registry (`cg branches`)
   whose worktree still exists and is still on that branch, and that either
   has a live agent or was indexed within `[projection] stale` (default 24h).
   An agent is live when its row in the agents table was seen within
   `[agents] ttl` (default 3600 seconds) and names the branch or its
   worktree; fleet and native agents count alike. The base, the projection
   itself (`codify/projection`), and `(detached)` are never folded. `--branch`
   adds names; `[projection] exclude` globs remove them, and win over
   `--branch`. A branch that qualifies but whose worktree is gone is
   reported as skipped.
3. **The order.** Topological by base: a branch whose registry base is
   another active branch folds after it (a feature branch before the waves
   cut from it). Ties go by registry update time, then by name.
4. **Each contribution.** A clean worktree contributes its head. A worktree
   with uncommitted changes contributes a *shadow commit*: its git index is
   copied to a temporary file, `git add -A` stages the worktree into the copy
   (honoring `.gitignore`, never `.codegraph`), `git write-tree` stores it,
   and `git commit-tree -p <head>` wraps it. The real index, the worktree,
   and the branch are never touched. The copy starts from the real index's
   stat data, so only changed files are hashed. A shadow commit is dated with
   its head's commit time under a fixed identity, so the same dirty state
   gives the same commit id.
5. **The fold.** Starting from the base head, each step runs
   `git merge-tree --write-tree --messages -z <projection so far>
   <contribution>` and writes a commit of the resulting tree with two
   parents — the previous projection commit and the contribution — and the
   message `projection: + <branch>`. A contribution already contained in the
   projection adds nothing and is marked merged. With no active branch the
   projection is the base's own commit.
6. **Conflicts.** Each conflicted path of a step is recorded with the branch
   being folded, the earlier folded branches that changed the same path
   against the base (`git diff base...contribution`), and the kind:
   `content`, `modify/delete`, `add/add`, or git's own word for rarer kinds.
   The record is `ProjectionConflict` in `src/cg.h`.
7. **The ref.** `refs/codify/projection` is updated to the final commit with
   `git update-ref`. No branch ref moves.

### Output

```
base main @ 5486f6dc60bb
  + feat-a                       1 commit ahead @ e8690d3aa9ff
  + feat-b                       0 commits ahead, 2 dirty files (shadow 3be73e8f2909)
  + feat-c                       1 commit ahead @ b62f862be27f, 1 conflict
  - feat-e                       skipped — worktree missing: /work/wt-e
conflicts (1):
  shared.txt  content  feat-c, feat-a
refs/codify/projection -> 50a583e4f15d (288 ms)
```

The conflict line names the branch whose step reported it first, then the
earlier branches that touched the path.

`--json` prints `base`, `base_head`, `ref`, `commit`, `unchanged`, `built`,
`ms`, `branches: [{name, head, contribution, dirty, commits, merged,
conflicts, worktree, live, added, skipped}]`, and `conflicts: [{path, kind,
branches}]`. `commits` counts the head's commits ahead of the base head;
`dirty` counts the files the shadow commit changes; `conflicts` on a branch
counts its conflicted paths; `skipped` is null or the reason. With `--index`
an `index` object is added (below).

### Stored builds and the no-op

Every build is a row in the `projections` table: `built`, `base`,
`base_head`, `commit_id`, `fingerprint`, `branches` (JSON), `conflicts`
(JSON), `ms`. The last hundred are kept. `cg projection status` prints the
newest one.

The fingerprint is a hash of the base head, every folded branch's name and
contribution id, every skipped branch and its reason, and `--strict`. When
it matches the last build and the ref still points at that build's commit,
`build` prints `projection unchanged` and the stored result, and writes
nothing. `--force` rebuilds anyway.

### The lock

A build holds `.codegraph/projection.lock` (an `flock`) from start to
finish, so two builds never race on the ref or the table. A second caller
waits up to `--wait MS` (default 5000). If the first build finishes in that
time, the second one finds the inputs unchanged and reports the fresh
result. If not, it prints the last stored build and exits 75 (busy; safe to
retry).

## The projection worktree and its index

With `--index`, or `[projection] index = true`, the build also checks the
projection out, detached, at `.codegraph/worktrees/projection`. The first
use runs `git worktree add --detach`; later builds run
`git checkout --detach <commit>` there, and skip the checkout when the
commit did not change. The tree is then indexed into the shared graph as
branch `codify/projection`. A detached HEAD has no branch name, so the build
registers the name itself and runs the index pass as that branch, the same
way a linked worktree's own `cg sync` writes its rows.

From then on every read command answers for the projection:

```
cg search Handler --branch codify/projection
cg context src/server.c --branch codify/projection
cg impact parse_config --branch codify/projection
```

The `index` object in `--json` carries `worktree`, `branch`,
`checked_out`, `files_seen`, `files_indexed`, and `ok`. The worktree belongs
to Codify; do not edit it.

## Configuration

`[projection]` in `codify.kvx` (see [config.md](config.md)):

| Key | Default | Meaning |
|---|---|---|
| `base` | *(empty)* | The branch folded onto. Empty means `[hierarchy] main`, else `main`. |
| `stale` | `24h` | How long a branch without a live agent stays active after its last index. |
| `exclude` | `[]` | Branch-name globs never folded in. |
| `index` | `false` | Check out and index the projection on every build. |

The liveness window for agents is `[agents] ttl` in `spec/workflow.kvx`.
