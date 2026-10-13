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
`src/gitint.c` and the findings in `src/conflicts.c`. The tests are
`tests/integration/51_projection.sh` and `52_conflicts.sh`.

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
| `cg projection findings` | The live conflict findings between branches, with their branches, agents, lines, advice, and age (see [Findings](#findings)). |

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

## Findings

The fold only knows lines. Two branches can change different hunks of one
function, or one can change a signature another just started calling, and
the merge is clean. Every `build` therefore reads the fold again with the
graph in hand (`src/conflicts.c`) and reports *findings*:

| Kind | When |
|---|---|
| `symbol` | Two active branches change the same symbol (path and name) against the base, even when the merge is clean. |
| `interface` | One branch changes the signature of, or removes, a public symbol, and another branch references it in code it changed: a new call, or an existing one it rewrote. |
| `near` | Two branches edit one file within three lines of each other (and the fold did not already report the path for that pair). |
| `content`, `delete`, `add-add` | The fold's own conflicts, from the `ProjectionConflict` records: a content conflict, a modify/delete, an add/add. Rarer kinds git reports are `conflict`. |

How they are found:

- **Hunks.** For each folded branch, the zero-context diff
  `base...contribution` (so uncommitted work counts through the shadow
  commit), with both sides' line ranges. Codify's own bookkeeping (the spec
  directory, `AGENTS.md`, `CLAUDE.md`, `.codify/`, `codify.kvx`, …) is left
  out, as spec drift leaves it out, so every worker flipping a task status
  does not collide.
- **Symbols.** Each hunk's head-side lines are mapped onto the symbol spans
  the graph holds for *that branch* (`files.branch_id`), keeping the
  innermost symbol (a method, not the class around it). A branch the index
  does not know yet, or a file its index lacks, falls back to the base's
  spans with the hunk's base-side lines: right for every symbol the branch
  did not move. The spans are as fresh as the branch's last index; a
  worktree's hooks keep that current.
- **Pairs.** `symbol` and `near` are pairwise. A pair where one branch
  already carries the other's commits (a wave cut from an active feature
  branch) is one line of work and is not compared. `near` compares
  base-side lines, the one coordinate system two branches share, and stays
  quiet when the two hunks already share a symbol (that is the `symbol`
  finding).
- **Interface.** The same machinery as [interface drift](drift.md#interface-drift-across-branches)
  (`drift_interface_changes`): the public definitions of each changed file
  are parsed at the merge base and at the contribution; a changed definition
  line or a missing one is a change. The references are read from the
  other branch's rows in the unified graph and count when they sit inside
  that branch's own hunks. A branch that is not indexed has no references to
  read.

Each finding carries `kind`, `path`, `symbol` (null when none), `lines`
(each branch's hunks, `feat-a 3-5; feat-b 9`), `branches`, `agents` (the
live fleet and native agents on those branches, by branch or worktree) and a
one-line `advice`; an interface finding also names its `changer`.

```
$ cg projection findings
findings:
  symbol    src/core.c  compute  — feat-a (agent claude:aaaaaaaa), feat-b (agent claude:bbbbbbbb)  (2m)
      lines: feat-a 2; feat-b 8
      both branches change compute: agree who owns it, or merge feat-a and rebase feat-b onto it
  interface src/api.c  helper  — feat-a (agent claude:aaaaaaaa), feat-b (agent claude:bbbbbbbb)  (2m)
      lines: feat-a now int helper(int x, int y); feat-b references it at src/use.c:2
      feat-a changes helper and feat-b references it: agree on the signature, or merge feat-a first and update the call
```

`build` prints the same list after the fold; `build --json` and
`findings --json` carry `findings: {findings: [...], count}`, each with
`first_seen`, `last_seen`, and `age` in seconds.

### Stored, announced once, resolved

Findings live in the `projection_findings` table, one row per kind, path,
symbol, and branch set, with `first_seen`, `last_seen`, and `resolved`
(null while a build still finds it). Each build diffs against it:

- a finding that is new (or back after it resolved) emits
  `projection.conflict` with the finding as payload;
- a finding that persists emits nothing and updates `last_seen`;
- a live finding the build no longer finds is marked resolved and emits
  `projection.resolved`;
- every build emits `projection.built` (`branches`, `conflicts` live,
  `new`, `resolved`, `ms`, `commit`, `unchanged`). A no-op build leaves the
  findings as they are and still emits it.

### Steering the agents involved

When a finding appears, every live agent on each of its branches is
steered once, through the channel `cg fleet steer` uses (`driver_steer`, an
`agent.steer` event), which a Claude Code session reads at its next
post-edit hook:

```
Projection: your branch feat-a and feat-b (agent claude:bbbbbbbb) both change compute
in src/core.c — coordinate or merge feat-b before you qualify; see cg projection findings
```

Nothing blocks. `[projection] steer = false` keeps the findings and events
and stops the messages. The compute, store, and steer functions print
nothing, so a background build calls them the same way.

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
| `steer` | `true` | Steer the agents on both branches when a build finds a new conflict. |

The liveness window for agents is `[agents] ttl` in `spec/workflow.kvx`.

## Following the work {#live}

Nobody has to run `cg projection build`. Work marks the projection dirty
(the note is `.codegraph/projection.dirty`), and the next trigger starts one
background `cg projection build --quiet`. The build is detached, prints
nothing, and gives way to a build that already holds the lock.

| Trigger | When |
|---|---|
| `cg hook post-edit` | after every edit, once the graph is synced |
| `cg hook event` | on `PostToolUse`, `Stop`, `SubagentStop`, `SessionEnd`, `WorktreeCreate`, and `WorktreeRemove`; session starts and prompts are not work |
| `cg watch`, `cg watch --fleet` | when edits settle and the sync has run |
| `cg serve` | on its refresh, after a `fleet.merge`, `fleet.land`, `fleet.begin`, or spawn event |
| the fleet supervisor | on its tick, after the same events |

A trigger starts a build only when all of these hold:

- the projection is dirty
- `[projection] auto` is not `false`
- the repository has another branch in a worktree, or live findings
- the last build, or the last build started, is older than `[projection] min_interval` (15s)

A trigger held back by the interval is not lost. The note stays, so the
next trigger after the interval builds. `cg watch` also retries on its own
when the interval ends.

### Where the findings show

- **`cg projection status`** shows the last build and its age, then every
  live finding grouped under each branch it involves, with that branch's
  worktree. `--json` adds
  `findings: {findings, count, by_branch: {name: {worktree, findings}}}`.
- **`cg brief` and `cg state`** add the line
  `projection: N branches folded, M findings — the first two named — built
  Ns ago`. Under `--json` this is
  `projection: {commit, built, age, branches, findings, first}`, or `null`
  before the first build.
- **`cg fleet tree --json`** adds
  `projection: {ref, commit, base, built, age, folded, findings, count,
  branches: [{name, worktree, findings}]}`. The `findings` field inside
  `branches` is that branch's count.
- **The MCP tool `projection_status`** returns the same JSON as
  `cg projection status --json`.
- **`cg serve`** pushes `projection.built`, `projection.conflict`, and
  `projection.resolved` to subscribers, for example with
  `{"kinds": "projection.*"}`.
- **The editor's fleet view** shows a Projection node. It lists each finding
  with its branches, and each branch row opens the file in that branch's
  worktree. Agent and session rows on an involved branch carry an
  `N findings` badge.
- **`cg fleet merge-up` and `cg fleet land`** print the branch's known
  findings before they merge. With `--json` the findings go to stderr. The
  findings are advice and never block the merge.

The steer a build sends reaches a Claude Code session in the
`additionalContext` of its next post-edit hook.

| Key | Default | Meaning |
|---|---|---|
| `auto` | `true` | Hooks, watch, serve, and the supervisor start a background build when work happens. |
| `min_interval` | `15s` | An automatic build waits this long after the last one. |
