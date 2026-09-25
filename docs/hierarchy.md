# The fleet hierarchy

One repository, a tree of agents. A **main** agent owns the task list and
merges pull requests, one **feature manager** per feature owns the feature
branch, and **wave workers** implement one wave each on a branch cut from
the feature branch. Work flows upward through verified merges: wave into
feature, feature into local main, main out through a pull request.

Implemented in `src/fleet.c` and `src/gitint.c`; covered by
`tests/integration/26_fleet.sh`.

## Declaring the hierarchy

Two kinds of section in `spec/workflow.kvx`. Both are optional: a
repository with no `[hierarchy]` section runs flat, and the fleet commands
then show the defaults they *would* use, marked `not configured`.

```ini
[hierarchy]
enabled    = true
main       = "main"                          # the branch everything lands on
remote     = "origin"
worktrees  = ".codegraph/worktrees"          # where wave/feature worktrees go
test_gate  = "make test"
lint_gate  = "make cg CFLAGS='-O2 -Werror'"
pr         = "auto"                          # auto | manual
checkpoint = "manual"

[role.main]
title  = "Main Gideon"
agent  = "gideon"
branch = "{main}"

[role.feature]
title  = "Feature Manager"
agent  = "fm-{feature}"
branch = "feature/{feature}"
base   = "{main}"

[role.worker]
title  = "Wave Worker"
agent  = "w-{feature}-{wave}"
branch = "wave/{feature}/{wave}"
base   = "feature/{feature}"
```

Every `[role.*]` key falls back to the default above, so a workflow that
names only what differs still gets a whole tree. The role names are fixed —
`main`, `feature`, `worker`. A `[role.something-else]` section is reported
as unknown rather than silently ignored.

Templates expand `{main}`, `{remote}`, `{feature}`, and `{wave}`. A
feature-level template expands `{wave}` to nothing, so it never grows a
stray number. `enabled = false` keeps the configuration but switches the
fleet off.

`cg fleet roles` prints the resolved tree:

```
hierarchy: enabled (/path/to/proj/spec/workflow.kvx)
main branch: main   remote: origin   worktrees: .codegraph/worktrees
gates: test `sh gate.sh`   lint `sh lint.sh`
pull requests: auto   checkpoint: manual
role     title            agent                branch                   base
main     Main Gideon      gideon               {main}                   —
feature  Feature Manager  fm-{feature}         feature/{feature}        {main}
worker   Wave Worker      w-{feature}-{wave}   wave/{feature}/{wave}    feature/{feature}
```

## Identity

An agent's place in the tree lives in its environment, not in a file:

| Variable | Meaning |
|---|---|
| `CG_AGENT` | this agent's name (`w-fleet-1`) |
| `CG_ROLE` | `main`, `feature`, or `worker` |
| `CG_PARENT` | the agent it reports to (`fm-fleet`); unset for main |
| `CG_FEATURE` | the feature it is working |
| `CG_WAVE` | the wave a worker owns |
| `CG_GH` | path or name of the `gh` binary (otherwise looked up on `PATH`) |

Without `CG_ROLE` nothing is written to the agents registry, so a solo
session leaves no trace and never competes for the write lock. With it,
every claim, start, and heartbeat records who this process is — and so do
the fleet reports, so a manager that only reads still shows up as alive.

The identity reaches the ordinary commands too. `cg brief` gains a line:

```
agent: w-fleet-1 — Wave Worker, reports to fm-fleet (feature fleet, wave 1)
```

and `cg spec status` carries it into the claim:

```
2.1      claimed by w-fleet-1 [worker under fm-fleet] on wave/fleet/1
         (attempt fd4374c04e17, fence 1, 30 min left)
```

Attempts persist the branch, worktree, and parent (schema v16 — see
[branches.md](branches.md)), so the ledger answers *which branch was this
work done on* after the session is gone.

## The branch flow

```
  wave/<feature>/<wave>  ──merge-up──►  feature/<feature>  ──land──►  main  ──pr──►  origin/main
        worker                             feature manager            (gates)        checkpoint
```

Every lifecycle command operates on the shared project — the main
worktree, where `spec/` is authoritative, where worktrees are cut from, and
where main lives. A worker may run them from its own worktree; the branch
it happens to be standing on is irrelevant to what they do.

### `cg fleet begin <id>`

Creates or reuses the wave branch and its worktree, then claims the task
for its worker.

```
$ cg fleet begin 2.1
begin 2.1 — wave 1 of fleet
  agent:    w-fleet-1 (worker, reports to fm-fleet)
  branch:   wave/fleet/1 from feature/fleet (created)   [feature/fleet cut from main]
  worktree: /path/proj/.codegraph/worktrees/wave-fleet-1 (created)
  claim:    attempt fd4374c04e17, fence 1, 30 min
next: cd /path/proj/.codegraph/worktrees/wave-fleet-1 && CG_AGENT=w-fleet-1 \
      CG_ROLE=worker CG_PARENT=fm-fleet CG_FEATURE=fleet CG_WAVE=1 cg spec start 2.1
```

The feature branch is cut from main on first use. Main's own checkout never
moves. A second `begin` reuses both branch and worktree and renews the
claim, so a manager can hand the same task to a replacement worker —
`--agent` names that replacement.

Refusals are specific and leave the branch alone: a task another agent
holds (`2.1 is already claimed by intruder` … `wave/fleet/1 and <worktree>
stay for a retry`), a task id with no wave, a task already `done`.

### `cg fleet merge-up <id>`

Merges the wave branch into the feature branch, in the feature manager's
own worktree.

```
$ cg fleet merge-up 2.1
merged wave/fleet/1 into feature/fleet: 1 commit (head 227a1f98) at …/feature-fleet
```

It is refused until the task's status **on the branch tip** says `done` —
the spec file as committed on the wave branch, not the one in the main
tree. A merge of unproven work is what the hierarchy exists to prevent.

```
2.1 is in_progress on wave/fleet/1, not done — qualify it
(cg spec done 2.1) and commit, or --force
```

A conflict is reported by path and the feature worktree is left exactly as
it was:

```
cg fleet: wave/fleet/2 does not merge into feature/fleet
  conflicts in 1 path(s):
    docs/d.md
  merge aborted
```

`--keep` leaves the merge in place instead, for the manager to resolve by
hand and run `merge-up` again. A feature worktree with uncommitted changes
is refused before any merge is attempted. Re-running after a successful
merge prints `nothing to merge: feature/fleet already contains
wave/fleet/1`.

A successful merge also brings the memories with it:

```
$ cg fleet merge-up 2.1
merged wave/fleet/1 into feature/fleet: 1 commit (head 227a1f98) at …/feature-fleet
  promoted 3 memories to feature/fleet
```

A note made on a wave branch is not yet a decision of the project, so it is
recorded against that branch and promoted to the base when the code is —
dropping any the base already holds, so merging twice never duplicates a
decision. `--json` reports it as `memories_promoted`.

### A tagged git commit counts as evidence

`cg spec done` checks that the paths a task declared were actually
touched. Uncommitted work in the tree satisfies that, which is the usual
case — qualify, then commit, then `merge-up`.

A fleet also produces the other case: the work is already committed and the
worktree is clean. Codify's snapshot chain cannot attribute it, because
every worker commits with **git** on its own branch while the snapshot
chain is one line shared by all of them. So a plain git commit whose
message carries the task tag is evidence too:

```sh
git commit -m "alpha: implement [spec:fleet/2.1]"
# ...later, or from a resumed session...
cg spec done 2.1          # ✓ touched src/*.ts
```

Git history is ingested before the check runs, so that commit does not need
a `cg git-sync` first. This is what lets a worker be resumed, or its task
qualified by its manager, after the change has already been committed.

### `cg fleet land <feature>`

Merges the feature branch into **local** main, then runs the gates.

```
$ cg fleet land fleet
landed feature/fleet into main: 2 commits, gates green (head 67187334)
  test: `sh gate.sh` ok in 5 ms
  lint: `sh lint.sh` ok in 6 ms
```

Red means main is reset to where it was. Landing is all or nothing: a
half-landed main is the one state nobody can reason about.

```
landing refused: test gate `sh gate.sh` failed (exit 1) — main reset to b5d899dd
  log: /path/proj/.codegraph/fleet/land-fleet-test.log
```

With `pr = "auto"` a green land opens the pull request in the same call;
`--no-pr` lands without touching `gh`.

### `cg fleet pr <feature>`

Pushes the feature branch and opens the pull request against
`<remote>/<main>` through `gh`.

```
$ cg fleet pr fleet
opened https://github.com/acme/repo/pull/7 (feature/fleet → main)
```

An already-open PR is reported, not duplicated. `--dry-run` prints what it
would run and calls nothing. When `gh` is absent the exact commands are
printed instead, runnable as they stand — the body file is written either
way:

```
pull request (gh not found): run these to open feature/fleet against origin/main:
  git -C '/path/proj' push -u 'origin' 'feature/fleet'
  cd '/path/proj' && 'gh' pr create --base 'main' --head 'feature/fleet' \
     --title 'feature/fleet' --body-file '/path/proj/.codegraph/fleet/pr-fleet.md'
```

The body is the feature's title, its task list, and a readiness line:

```markdown
Feature `fleet`, landed on `main` by Codify with the test and lint gates green.

## Tasks
- 1.1 First task (done)
- 2.1 Alpha work (done)
- 3.1 Docs work (pending)

Jev readiness: 0.95 (high) — 2/3 tasks qualified, 4 commits, gates not run in this command
```

The readiness line is Jev's opinion of the state Codify can prove — branch,
base, commits ahead, and what is qualified. It is advice: a low score says
so and still opens the pull request, and with no `OPENROUTER_API_KEY` the
line is simply absent (`jev: OPENROUTER_API_KEY is not set — pull request
readiness skipped`). See [jev.md](jev.md#pull-request-readiness).

### `cg fleet checkpoint`

Merges the open Codify pull requests — the ones on `feature/*` branches —
lowest number first, and stops at the first that will not merge, so the
order stays what a reader expects. Anything else is skipped by name
(`skipped #8 hotfix/x — not a feature/* branch`). Local main then
fast-forwards to the remote when it is clean.

```
$ cg fleet checkpoint --dry-run
checkpoint (dry-run): merge the open feature/* pull requests lowest number first:
  gh pr list --base 'main' --state open --json number,headRefName,title,url
  gh pr merge <number> --merge
```

## Reports

```sh
cg fleet roles              # the configured hierarchy
cg fleet status             # who is alive in which role, on which task
cg fleet plan [-f F]        # which manager owns the feature, which worker each wave
cg fleet tree [-f F]        # the live tree: main → managers → workers
cg fleet                    # same as status
```

`cg fleet plan` lays the tree over the task list — planned branches on the
left, live agents on the right:

```
fleet plan — feature fleet (hierarchy enabled)
main      gideon               main                                  live: —
feature   fm-fleet             feature/fleet           ← main        live: —
wave 0    w-fleet-0            wave/fleet/0            ← feature/fleet  live: —
          1.1      done         First task
wave 1    w-fleet-1            wave/fleet/1            ← feature/fleet  live: —
          2.1      done         Alpha work
wave 2    w-fleet-2            wave/fleet/2            ← feature/fleet  live: —
          3.1      pending      Docs work
```

`cg fleet tree` is the same tree with what actually happened on it —
progress, whether the feature branch is ahead of its base or already merged,
and the state and heartbeat of every worker:

```
$ cg fleet tree
fleet tree — codify-v10
main     gideon           branch main
  feature  fm-codify-v10    branch feature/codify-v10   base main
           tasks 13/16 done, 0 running  ahead 0  incomplete  seen -
    (no workers yet)
```

It refuses in a repository with no hierarchy — *this repository runs flat* —
rather than inventing one. `--json` returns `main`, `managers[]` with
`tasks {total, done, claimed}`, `ahead`, `merged` and `complete`, and
`workers[]` with `wave`, `task`, `branch`, `base`, `worktree`, `state`,
`attempt` and `heartbeat`.

All the reports take `--json`.

## A worked example

One feature, two waves, from nothing to a merged pull request.

```sh
# --- Gideon, in the main checkout -------------------------------------
cg fleet roles                       # confirm the tree before spawning anything
cg fleet begin 2.1                   # cuts feature/fleet from main, then wave/fleet/1

# --- the worker, in its own worktree ----------------------------------
cd .codegraph/worktrees/wave-fleet-1
export CG_AGENT=w-fleet-1 CG_ROLE=worker CG_PARENT=fm-fleet \
       CG_FEATURE=fleet CG_WAVE=1
cg spec start 2.1
# ...implement...
cg spec done 2.1                     # qualification runs here, on the wave branch
git add -A && git commit -m "alpha: implement [spec:fleet/2.1]"

# --- the feature manager ----------------------------------------------
cd /path/proj
cg fleet merge-up 2.1                # wave/fleet/1 → feature/fleet
cg fleet begin 3.1                   # wave 2 is cut from the feature branch,
                                     # so it already has wave 1's work
# ...worker 2 does the same...
cg fleet merge-up 3.1

# --- landing ----------------------------------------------------------
cg fleet land fleet                  # feature/fleet → main behind the gates,
                                     # then the PR (pr = "auto")

# --- Gideon, at a checkpoint ------------------------------------------
cg fleet checkpoint                  # merge the open feature/* PRs in order
```

The claim on 2.1 was taken by `begin` and released by `cg spec done`, as
for any other parallel-mode task — the fleet shares the same lease
primitives, it does not add a second ownership system. See the parallel
mode section of the [README](../README.md#parallel-mode).

## Running the tree: `cg spec run --fleet`

Everything above is the manual path. `cg spec run --fleet` drives the same
commands as a two-level orchestrator: one feature manager per feature, wave
workers under it, each spawned in its own worktree with its identity in the
environment.

```
cg spec run --fleet [-f <feature>] [-n N] [--max-rounds R] [--status]
                    [--dry-run] [--driver codex|claude|custom] [--max-fail K]
```

`-n` is the number of **worker** slots; the manager is always one more.
`--dry-run` plans without claiming or creating anything:

```
$ cg spec run --fleet --dry-run -n 2
fleet plan — driver claude, 2 worker slot(s), feature codify-v10 (dry run: nothing claimed)
  manager fm-codify-v10 — codify-v10 on feature/codify-v10 (from main)
    worktree /path/proj/.codegraph/worktrees/feature-codify-v10
    claude -p --permission-mode acceptEdits
    worker w-codify-v10-5 — 2.3 (wave 5) on wave/codify-v10/5 (from feature/codify-v10)
      claude -p --permission-mode acceptEdits
```

A real run reports each spawn and each result, and ends on the merge rather
than on a process exiting:

```
$ cg spec run --fleet -n 1
[fleet] fleet — manager + 1 worker slot(s), driver custom, 16 wake(s)
[fleet] manager fm-fleet on feature/fleet, log .codegraph/agents/fleet-manager.log
[fleet] worker w-fleet-1 → 2.1 (wave 1) on wave/fleet/1, log .codegraph/agents/fleet-2.1.log
[fleet] worker w-fleet-1 task 2.1 exit 0 → done
[fleet] worker w-fleet-2 → 3.1 (wave 2) on wave/fleet/2
[fleet] fleet complete — 4/4 task(s) qualified, feature/fleet merged into main, 0 failure(s)
```

Three things make that line trustworthy. The subtree is **complete because
it merged**, not because the manager's process returned: the run checks the
task list and the branch state. Each child is handed `CG_ROLE`,
`CG_PARENT`, `CG_FEATURE`, `CG_WAVE`, `CG_BRANCH`, `CG_BASE` — and, for a
worker, `CG_TASK`, `CG_ATTEMPT` and `CG_FENCE` — and runs with its branch
already checked out in its own worktree. And the prompts end on the command
that moves work upward: a worker's briefing closes with
`cg fleet merge-up <id>`, a manager's with `cg fleet land <feature>` and
`cg fleet pr <feature>`, so an agent that reads only the last line still
does the right thing.

`--status` prints `cg fleet tree` for the run instead of starting one.
The manager is woken from a fixed budget — 16 wakes by default, a second
apart — and `--max-rounds R` changes it, so a fleet that cannot finish
stops instead of spinning:

```
$ cg spec run --fleet --max-rounds 2
cg spec: no manager wake is left (--max-rounds)
```

That exits 1, and leaves no claims behind. A run with nothing left to do is
complete without spawning anything.

Both `--fleet` refusals happen before anything is created:

```
$ cg spec run --fleet
cg spec: --fleet needs a [hierarchy] in spec/workflow.kvx — nothing was spawned
```

and, when the section exists with `enabled = false`, *--fleet needs an
enabled [hierarchy]*. The single-level `cg spec run` is untouched by any of
this and still works in a repository that runs flat.

## Limitations

- The lifecycle commands drive `git` and `gh` as subprocesses. Without
  `gh`, `pr` and `checkpoint` print the commands rather than running them.
- `land` runs the gates in the main tree, after the merge, and resets on
  red. It does not run them on the feature branch first.
- `merge-up` reads the task's status from the wave branch tip, so work that
  qualified but was not committed looks unqualified. That is deliberate;
  `--force` exists for the exceptions.
- `checkpoint` only recognises `feature/*` head branches as Codify's own.
- `cg spec run --fleet` is two levels: main → feature manager → wave
  workers. There is no third level, and one manager per run.
- A worker slot is a wave, not a task. Two tasks in the same wave are done
  by the same worker on the same branch, one after the other.
- The orchestrator spawns agents through the `[agents]` driver, exactly as
  the single-level `cg spec run` does. It does not talk to any agent
  vendor's API itself.
