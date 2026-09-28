# The fleet hierarchy

One repository, a tree of agents. A **main** agent owns the task list and
merges pull requests, one **feature manager** per feature owns the feature
branch, and **workers** implement a wave — or, with a `{task}` branch
template, a single task — on a branch cut from the feature branch. Work
flows upward through verified merges: worker branch into feature, feature
into local main, main out through a pull request.

You can drive every step by hand, or hand the spec to `cg fleet up`: a
durable supervisor that runs all three levels at once, supervises every
Codex or Claude Code process until its work is qualified and merged, and
survives being killed.

Implemented in `src/fleet.c`, `src/gitint.c`, and `src/orchestrate.c`;
covered by `tests/integration/26_fleet.sh`, `32_supervisor.sh`,
`34_context.sh`, and the end-to-end `35_fleet_e2e.sh`. The event stream,
`cg serve`, and the drivers are in [events.md](events.md); drift is in
[drift.md](drift.md).

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
main_agent = false                           # true: run Main Gideon as a process

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

Templates expand `{main}`, `{remote}`, `{feature}`, `{wave}`, and `{task}`.
A feature-level template expands `{wave}` and `{task}` to nothing, so it
never grows a stray number. `enabled = false` keeps the configuration but
switches the fleet off.

A worker template that names `{task}` gives every task its own branch and
worktree, so the tasks of one wave can run side by side:

```ini
[role.worker]
agent  = "w-{feature}-{task}"
branch = "task/{feature}/{task}"
```

Without `{task}`, a worker owns a whole wave and does its tasks one after
the other on one branch.

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

## Role capabilities

Each `[role.*]` section can also say how its agents are run and what they
may spend. Nothing here is required: every key has a default, and the
defaults are chosen so that a multi-day run never inherits "unlimited" by
accident.

```ini
[agents]
driver      = "claude"        # the default driver for every role
max         = 6               # the default worker concurrency
claude_args = "--permission-mode acceptEdits"

[role.main]
model   = "opus"
approve = ["pr", "drift"]     # stop here until `cg fleet approve`

[role.feature]
max  = 3                      # feature managers alive at once
wall = "45m"

[role.worker]
driver  = "codex"
args    = "--sandbox workspace-write"
wall    = "3h"                # one attempt's wall-clock budget
stall   = "10m"               # no progress for this long: nudge, then restart
spend   = "$4.50"             # one attempt's cost budget
retries = 2                   # attempts after the first
```

| Key | Meaning | main | feature | worker |
|---|---|---|---|---|
| `driver` | `codex`, `claude`, or `custom` | `[agents].driver`, else `codex` | same | same |
| `model` | handed to the driver | driver default | same | same |
| `args` | extra driver argv | `[agents].<driver>_args` | same | same |
| `max` | agents of the role alive at once | 1 (always) | 2 | `[agents].max`, else 2 |
| `wall` | wall-clock budget per attempt | 1h | 1h | 2h |
| `spend` | USD budget per attempt | none | none | none |
| `retries` | attempts after the first, per task | 0 | 1 | 2 |
| `stall` | time without progress before a nudge | 30m | 30m | 15m |
| `approve` | gates that wait for approval: `land`, `pr`, `drift`, `coverage` (`retry` is accepted but not yet enforced) | none | none | none |

Durations take `90s`, `30m`, `2h`, `1d`, or plain seconds; `0` means no
limit. `approve` may be a list or a single string. Blocking is opt-in:
with no `approve`, nothing waits for a person. For the feature role, `max`
is how many features run at once under `--all`; for workers it caps the
agents writing code at once, alongside `-n`.

A value that cannot be used is reported, never silently dropped, and the
default is kept:

```
warn: [role.worker] wall = "soon" is not a duration (90s, 30m, 2h, or seconds) — default kept
warn: [role.worker] approve gate "merge" is not land, pr, retry, drift, or coverage — ignored
```

`cg fleet roles` prints the resolved capabilities under the role table, and
`--json` carries them as `roles[].caps` with `wall_s`, `stall_s`, and
`spend_usd`, plus a top-level `problems` list:

```
role     driver  model           max   wall    spend  retries  stall  approve
main     custom  —               1     1h      —        0    30m  —
feature  custom  —               2     1h      —        1    30m  —
worker   custom  —               3    10m      —        2     2s  —
```

The supervisor started by `cg fleet up` enforces them: each spawn uses the
role's driver, model, and args; `max` bounds the concurrency; `wall`,
`spend`, `stall`, and `retries` drive [supervision](#supervision).

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

## Running the tree: `cg fleet up`

Everything above is the manual path. `cg fleet up` drives the same
commands for you, as a supervisor that outlives your terminal:

```
cg fleet up [--foreground] [--resume [RUN]] [-f F | --all] [-n N]
            [--driver D] [--max-fail K] [--max-rounds R] [--dry-run]
```

```
$ cg fleet up --all -n 3
fleet up: run dc70cdc5f81a — supervisor pid 2970055
  log:    /path/proj/.codegraph/fleet/supervisor-dc70cdc5f81a.log
  follow: cg events --follow   status: cg fleet runs   stop: cg fleet down
```

The supervisor is a detached process (`--foreground` keeps it in your
terminal) that owns a tick loop: reap children, check progress and
budgets, retry or escalate, decide approvals, and spawn into free slots.
Everything it knows is in the database — the run, and every node with its
role, parent, agent, task, branch, worktree, pid, attempt, fence, retries,
and spend — so a new supervisor can pick the run up where the last one
stopped.

- `-f F` runs one feature (default: the active one). `--all` runs every
  feature with work left, each as its own run with its own manager and
  workers; a feature whose `[meta] requires` are not all done waits and
  starts once they are, up to `[role.feature] max` at once.
- `-n N` is the number of worker slots. Workers are also capped by
  `[role.worker] max`.
- `--max-rounds R` is each manager's wake budget (16 by default), so a
  fleet that cannot finish stops instead of spinning. `--max-fail K` stops
  the run once failed attempts exceed K (default 2).
- `--dry-run` plans without claiming or creating anything, in the
  foreground. `cg spec run --fleet` is the same run as a foreground
  command, and `cg spec run --fleet --status` prints the tree.

A real run reports each spawn and each result, and ends on the merge rather
than on a process exiting:

```
[fleet] alpha — manager + 3 worker slot(s), driver custom, 16 wake(s)
[fleet] run dc70cdc5f81a — supervisor pid 2970055
[fleet] manager fm-alpha on feature/alpha (15 wake(s) left), log .codegraph/agents/alpha-manager.log
[fleet] worker w-alpha-2.1 → 2.1 (wave 1) on task/alpha/2.1, log .codegraph/agents/alpha-2.1.log
[fleet] worker w-alpha-2.2 → 2.2 (wave 1) on task/alpha/2.2, log .codegraph/agents/alpha-2.2.log
[fleet] worker w-alpha-3.2 → 3.2 (wave 2) on task/alpha/3.2, log .codegraph/agents/alpha-3.2.log
[fleet] worker w-alpha-2.1 task 2.1 exit 1 → INCOMPLETE
[fleet] worker w-alpha-2.1 → 2.1 (wave 1) on task/alpha/2.1, log .codegraph/agents/alpha-2.1.log
[fleet] worker w-alpha-2.1 task 2.1 exit 0 → done
[fleet] worker w-alpha-2.2 on 2.2: no progress for 2s — nudged
[fleet] worker w-alpha-2.2 on 2.2: stalled — no progress for 2s after a nudge — stopping it
[fleet] worker w-alpha-2.2 task 2.2 exit 143 → INCOMPLETE
[fleet] worker w-alpha-2.2 → 2.2 (wave 1) on task/alpha/2.2, log .codegraph/agents/alpha-2.2.log
[fleet] worker w-alpha-2.2 task 2.2 exit 0 → done
[fleet] worker w-alpha-3.2 task 3.2 exit 0 → done
[fleet] beta — manager + 3 worker slot(s), driver custom, 16 wake(s)
[fleet] alpha complete — 4/4 task(s) qualified, feature/alpha merged into main, 2 failure(s)
[fleet] beta complete — 2/2 task(s) qualified, feature/beta merged into main, 0 failure(s)
```

That is two features, `beta` requiring `alpha`: a task that failed once and
was retried, a worker that stalled and was restarted, and `beta` starting
the moment `alpha` landed.

### Three levels at once

The manager and its workers are alive together. What used to make them
take turns — two processes merging into the same feature worktree — is now
a lock: `merge-up` and `land` take the feature's merge lock
(`.codegraph/fleet/merge-<feature>.lock`), waiting up to two minutes
(`CG_MERGE_LOCK_WAIT_MS`) before refusing with *another merge into …'s
branch held the lock*.

With a `{task}` worker template each task gets its own slot, branch, and
worktree, and the tasks of a wave run in parallel when their declared
touches are disjoint and no collision is predicted (see
[drift.md](drift.md#collision-prediction)). A predicted collision runs one
after the other. A task that is already running is never handed to a
second slot.

The outcome of a child is decided by the task's status on its branch tip
and by the merge state, never by the exit code alone: `exit 1 →
INCOMPLETE` above is the spec saying the task is not done, and a subtree
is complete because it merged.

### The main agent

With `[hierarchy] main_agent = true`, Main Gideon runs as a real driver
process too, logged to `.codegraph/agents/main.log`. It owns decisions,
not code: it is woken when the run starts, when a task is blocked, and
when a feature finishes, and it answers with steering, approvals,
memories, and checkpoints. Without it, "main" is you.

### Runs: down, pause, resume

```
$ cg fleet runs
run          feature            state     supervisor  live nodes fails  reason
a6e57e899fc5 beta               complete  —            0     3     0  merged
dc70cdc5f81a alpha              complete  —            0     7     2  merged
```

| Command | Does |
|---|---|
| `cg fleet down` | terminate the live agents, release their claims, keep every branch; the run is `stopped` |
| `cg fleet down --drain` | let the live agents finish, start nothing new, then stop |
| `cg fleet pause` | freeze spawning: live agents finish, nothing new starts |
| `cg fleet resume [RUN]` | continue a paused run, or start a supervisor for one that has none |
| `cg fleet up --resume [RUN]` | continue the newest unfinished run (or `RUN`) under a new supervisor |

There is one supervisor per project; a second `cg fleet up` is refused
while one is alive. The supervisor column says `alive` for the run it
owns and `GONE` for an unfinished run whose supervisor died.

**Crash resume.** Kill the supervisor — `kill -9` in the end-to-end test —
and `cg fleet up --resume` continues the run. Every node still marked live
is checked by pid *and* process start time: an agent that is still the
process that was spawned is adopted, not respawned, and one that is gone
is judged by its branch tip like any other exit. Retry counts and what was
tried survive, so a resumed run does not grant fresh attempts. The suite
kills a supervisor mid-run and asserts the resumed run ends in exactly the
state of an uninterrupted one.

## Supervision

A multi-day run cannot depend on every agent behaving. The supervisor
watches each one for progress, budget, and failure.

**Progress is work, not liveness.** An agent is making progress when it
produces an event (a tool call, a message, a claim, a status change, a
hook), when its log grows, or when git sees a change in its worktree — its
status or its HEAD. The supervisor's own events and steering do not count.
The check runs every quarter of the role's `stall` window (between 0.25 s
and 30 s).

**Stalls.** One window without progress earns a nudge — a steering message
asking the agent to continue or record why it is stuck — and one more
window. A second window without progress stops the attempt with a
supervisor handoff (`blocked: stalled — no progress for 2s after a
nudge`), and the retry takes it from there.

**Budgets.** An attempt that runs past the role's `wall` or reports more
than its `spend` is stopped, the reason recorded as a `supervisor.budget`
event, and the attempt counted as failed.

**Retries.** A failed task is retried up to `retries` more times in the
run. The new attempt's prompt carries what went wrong, under
`## Previous attempts`: why the supervisor stopped the last one, what the
agent said last, and the task's outcome memories — including `verify_cmd`
failures and their Jev triage.

**Escalation.** When the retries are spent, the task goes to the feature
manager: it is steered with the failure and woken to fix the task on the
feature branch, re-plan it, or record it as blocked. If a manager wake
comes and goes and the task is still not qualified, it goes to main,
is marked blocked with the reason, and an outcome memory records it — and
the rest of the run continues.

Every decision is an event (`supervisor.stall`, `supervisor.budget`,
`supervisor.escalate`, `supervisor.blocked`), so `cg events --kind
supervisor.` is the supervision log.

## Approvals

Blocking is opt-in. A gate listed in any role's `approve` makes the
command that reaches it stop and ask:

| Gate | Stops |
|---|---|
| `land` | `cg fleet land`, before merging into main |
| `pr` | `cg fleet pr`, before pushing and opening the pull request |
| `drift` | `cg fleet merge-up`, when the branch drifted from its task's declaration |
| `coverage` | `cg fleet land`, when an acceptance criterion has no qualified task |

Gates apply to fleet agents (a process with `CG_ROLE` set); a person
running the same command by hand is not stopped. The agent sees:

```
cg fleet: land of alpha waits for approval #3 — a person runs `cg fleet approve 3` (or --reject); exit now and it is retried on your next wake
```

and the command exits 4. The request is an `approval.request` event.

```sh
cg fleet approvals            # what waits (--all includes decided ones)
cg fleet approve 3 -m "ok"    # let it through once
cg fleet approve 3 --reject   # stop it; the agent reports to its parent
```

One approval covers one attempt: an approved gate is consumed by the land
or pull request it let through, so a land retried after red gates asks
again rather than riding an approval given for different code.

## Briefings from the graph

Every spawned agent gets a prompt built from the graph, not from prose,
fitted to a token budget (`CG_PACKET_BUDGET`, 6000 for a worker and 4000
for a manager by default). The same worker packet is what `cg resume
--task <id> --prompt` prints:

```
## Task 2.2 — Stalls once, changes alpha

Acceptance criteria — the work is judged against these:
- 1.1: WHEN <trigger> THE <component> SHALL <observable behaviour>.

Scope:
- edit only: src/a.ts  (cg guard reports anything else)
- symbols to introduce or change: alpha
- done means `cg spec done` passes: verify_cmd, every declared symbol in the graph, every declared path touched

### The code you will touch (from the graph)
- `alpha` (function) src/a.ts:1-3
  ...
  called by: delta src/d.ts:2
```

A worker packet holds, in priority order: the task, its criteria and scope;
the current definitions of its declared symbols with their callers and
callees; *What your prerequisites produced* — the symbols its required
tasks actually introduced on the feature branch, with signatures; *Working
alongside you* — the touches of live sibling workers, to leave alone; the
decisions and constraints recorded for it; and the files in scope. When
the budget runs out, lower parts are cut before higher ones.

A manager packet (`cg fleet brief <feature>`) holds its subtree's state,
the live workers, failed attempts with their triage, merge conflicts to
resolve, and pending approvals:

```
$ cg fleet brief alpha
### Your subtree: 1 of 4 task(s) done
- 1.1 (wave 0) done — First task
- 2.1 (wave 1) pending — Failing once
- 2.2 (wave 1) pending — Stalls once, changes alpha
- 3.2 (wave 2) pending — Docs, conflicting
```

While a worker runs, work merged upstream reaches it through `cg work
update`: when another task has merged into the feature branch since the
attempt began, the delta gains an `upstream` list naming the task, the
branch, and the symbols it brought, each resolved in the graph. When
nothing merged, the delta stays as compact as before.

Each child also gets its identity in the environment: `CG_ROLE`,
`CG_PARENT`, `CG_FEATURE`, `CG_WAVE`, `CG_BRANCH`, `CG_BASE`, `CG_RUN` —
and, for a worker, `CG_TASK`, `CG_ATTEMPT` and `CG_FENCE`. The prompts end
on the command that moves work upward: a worker's with `cg fleet merge-up
<id>`, a manager's with `cg fleet land <feature>` and `cg fleet pr
<feature>`.

## Limitations

- The lifecycle commands drive `git` and `gh` as subprocesses. Without
  `gh`, `pr` and `checkpoint` print the commands rather than running them.
- `land` runs the gates in the main tree, after the merge, and resets on
  red. It does not run them on the feature branch first.
- `merge-up` reads the task's status from the branch tip, so work that
  qualified but was not committed looks unqualified. That is deliberate;
  `--force` exists for the exceptions.
- `checkpoint` only recognises `feature/*` head branches as Codify's own.
- One supervisor per project. `--all` runs several features under it, but
  two independent `cg fleet up` calls in one repository are refused.
- `--dry-run` previews one feature — the one named by `-f`, else the
  active feature — even with `--all`.
- The `retry` approval gate is accepted in `approve` but nothing stops on
  it yet; retries run up to the role's limit and then escalate.
- The manager packet lists recent merge conflicts from the event log,
  including ones a later merge already resolved, and does not yet include
  drift findings.
- A `spend` budget is only as good as the cost the driver reports; a
  driver with no usage output never reaches it. `wall` always applies.
- The supervisor spawns agents through the configured driver. It does not
  talk to any agent vendor's API itself, and it does not authenticate the
  CLIs it starts.
