# The fleet hierarchy

One repository, a tree of agents. A **main** agent owns the task list and
merges pull requests. A **wave manager** per wave owns that wave's branch,
cut from main. A **task worker** per task implements one task on a branch
cut from its wave's branch. Work flows upward through verified merges: task
branch into wave branch, wave branch into local main, main out through a
pull request.

```
main
├── wm-<feature>-1   wave/<feature>/1   ← main
│   ├── w-<feature>-2.1   task/<feature>/2.1   ← wave/<feature>/1
│   └── w-<feature>-2.2   task/<feature>/2.2   ← wave/<feature>/1
└── wm-<feature>-2   wave/<feature>/2   ← main
    └── w-<feature>-3.1   task/<feature>/3.1   ← wave/<feature>/2
```

That is the default. A workflow whose templates leave out `{wave}` and
`{task}` gets the older shape instead: one **feature manager** per feature
on `feature/<feature>`, and a worker per wave on a branch cut from it (see
[The older shape](#the-older-shape)).

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
worktrees  = ".codegraph/worktrees"          # where wave/task worktrees go
test_gate  = "make test"
lint_gate  = "make cg CFLAGS='-O2 -Werror'"
pr         = "auto"                          # auto | manual
checkpoint = "manual"
main_agent = false                           # true: run Main Gideon as a process

[role.main]
title  = "Main Gideon"
agent  = "gideon"
branch = "{main}"

[role.manager]
title  = "Wave Manager"
agent  = "wm-{feature}-{wave}"
branch = "wave/{feature}/{wave}"
base   = "{main}"

[role.worker]
title  = "Task Worker"
agent  = "w-{feature}-{task}"
branch = "task/{feature}/{task}"
base   = "wave/{feature}/{wave}"
```

Every `[role.*]` key falls back to the default above, so a workflow that
names only what differs still gets a whole tree. The role names are fixed —
`main`, `manager`, `worker`. `[role.feature]` is the same section as
`[role.manager]` under its older name, and `CG_ROLE=feature` is still how a
manager identifies itself. A `[role.something-else]` section is reported as
unknown rather than silently ignored.

Templates expand `{main}`, `{remote}`, `{feature}`, `{wave}`, and `{task}`.
`enabled = false` keeps the configuration but switches the fleet off.

The shape follows the templates. A manager branch that names `{wave}` gives
a manager per wave; a worker branch that names `{task}` gives a worker per
task, so the tasks of one wave run side by side, each on its own branch and
worktree.

### The older shape

Templates without the placeholders give the hierarchy Codify had before
v1.5: one feature manager per feature, and a worker per wave that does its
wave's tasks one after the other on one branch.

```ini
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

In that shape a feature-level template expands `{wave}` and `{task}` to
nothing, `merge-up` goes into `feature/<feature>`, and `land` takes the
feature. Everything else in this document works the same way in both shapes.

`cg fleet roles` prints the resolved tree:

```
hierarchy: enabled (/path/to/proj/spec/workflow.kvx)
main branch: main   remote: origin   worktrees: .codegraph/worktrees
gates: test `sh gate.sh`   lint `sh lint.sh`
pull requests: auto   checkpoint: manual
role     title            agent                branch                   base
main     Main Gideon      gideon               {main}                   —
manager  Wave Manager     wm-{feature}-{wave}  wave/{feature}/{wave}    {main}
worker   Task Worker      w-{feature}-{task}   task/{feature}/{task}    wave/{feature}/{wave}
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

[role.manager]
max  = 3                      # wave managers alive at once (default: every wave)
wall = "45m"

[role.worker]
driver  = "codex"
args    = "--sandbox workspace-write"
wall    = "3h"                # one attempt's wall-clock budget
stall   = "10m"               # no progress for this long: nudge, then restart
spend   = "$4.50"             # one attempt's cost budget
retries = 2                   # attempts after the first
```

| Key | Meaning | main | manager | worker |
|---|---|---|---|---|
| `driver` | `codex`, `claude`, or `custom` | `[agents].driver`, else `codex` | same | same |
| `model` | handed to the driver | driver default | same | same |
| `args` | extra driver argv | `[agents].<driver>_args` | same | same |
| `max` | agents of the role alive at once | 1 (always) | 0 — every wave (older shape: 2) | `[agents].max`, else 2 |
| `wall` | wall-clock budget per attempt | 1h | 1h | 2h |
| `spend` | USD budget per attempt | none | none | none |
| `retries` | attempts after the first, per task | 0 | 1 | 2 |
| `stall` | time without progress before a nudge | 30m | 30m | 15m |
| `approve` | gates that wait for approval: `land`, `pr`, `drift`, `coverage` (`retry` is accepted but not yet enforced) | none | none | none |

Durations take `90s`, `30m`, `2h`, `1d`, or plain seconds; `0` means no
limit. `approve` may be a list or a single string. Blocking is opt-in:
with no `approve`, nothing waits for a person. For the manager role, `max`
bounds the wave managers alive at once in a run, and `0` means one for
every wave; in the older shape it is how many features run at once under
`--all`. For workers it caps the agents writing code at once, alongside
`-n`.

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
manager  custom  —             all     1h      —        1    30m  —
worker   custom  —               3    10m      —        2     2s  —
```

The supervisor started by `cg fleet up` enforces them: each spawn uses the
role's driver, model, and args; `max` bounds the concurrency; `wall`,
`spend`, `stall`, and `retries` drive [supervision](#supervision).

## Identity

An agent's place in the tree lives in its environment, not in a file:

| Variable | Meaning |
|---|---|
| `CG_AGENT` | this agent's name (`w-fleet-2.1`) |
| `CG_ROLE` | `main`, `feature` (a manager), or `worker` |
| `CG_PARENT` | the agent it reports to (`wm-fleet-1`); unset for main |
| `CG_FEATURE` | the feature it is working |
| `CG_WAVE` | the wave a manager or worker belongs to |
| `CG_GH` | path or name of the `gh` binary (otherwise looked up on `PATH`) |

Without `CG_ROLE` nothing is written to the agents registry, so a solo
session leaves no trace and never competes for the write lock. With it,
every claim, start, and heartbeat records who this process is — and so do
the fleet reports, so a manager that only reads still shows up as alive.

The identity reaches the ordinary commands too. `cg brief` gains a line:

```
agent: w-fleet-2.1 — Task Worker, reports to wm-fleet-1 (feature fleet, wave 1)
```

and `cg spec status` carries it into the claim:

```
2.1      claimed by w-fleet-2.1 [worker under wm-fleet-1] on task/fleet/2.1
         (attempt fd4374c04e17, fence 1, 30 min left)
```

Attempts persist the branch, worktree, and parent (schema v16 — see
[branches.md](branches.md)), so the ledger answers *which branch was this
work done on* after the session is gone.

## The branch flow

```
  task/<feature>/<id>  ──merge-up──►  wave/<feature>/<wave>  ──land──►  main  ──pr──►  origin/main
       task worker                       wave manager               (gates)        checkpoint
```

Every lifecycle command operates on the shared project — the main
worktree, where `spec/` is authoritative, where worktrees are cut from, and
where main lives. A worker may run them from its own worktree; the branch
it happens to be standing on is irrelevant to what they do.

### `cg fleet begin <id>`

Creates or reuses the task's branch and worktree, cut from its wave's
branch, then claims the task for its worker.

```
$ cg fleet begin 2.1
begin 2.1 — wave 1 of fleet
  agent:    w-fleet-2.1 (worker, reports to wm-fleet-1)
  branch:   task/fleet/2.1 from wave/fleet/1 (created)   [wave/fleet/1 cut from main]
  worktree: /path/proj/.codegraph/worktrees/task-fleet-2.1 (created)
  claim:    attempt 8e94807ad1cf, fence 1, 30 min
next: cd /path/proj/.codegraph/worktrees/task-fleet-2.1 && CG_AGENT=w-fleet-2.1 \
      CG_ROLE=worker CG_PARENT=wm-fleet-1 CG_FEATURE=fleet CG_WAVE=1 cg spec start 2.1
```

The wave branch is cut from main on first use, so a later wave starts from
a main that already carries the waves landed before it. Main's own
checkout never moves. A second `begin` reuses both branch and worktree and
renews the claim, so a manager can hand the same task to a replacement
worker — `--agent` names that replacement.

Refusals are specific and leave the branch alone: a task another agent
holds (`2.1 is already claimed by intruder` … `task/fleet/2.1 and
<worktree> stay for a retry`), a task id with no wave, a task already
`done`.

### `cg fleet merge-up <id>`

Merges the task's branch into its wave branch, in the wave manager's own
worktree.

```
$ cg fleet merge-up 2.1
merged task/fleet/2.1 into wave/fleet/1: 1 commit (head 1484f740) at …/wave-fleet-1
  promoted 1 memory to wave/fleet/1
```

It is refused until the task's status **on the branch tip** says `done` —
the spec file as committed on the task branch, not the one in the main
tree. A merge of unproven work is what the hierarchy exists to prevent.

```
2.1 is in_progress on task/fleet/2.1, not done — qualify it
(cg spec done 2.1) and commit, or --force
```

A conflict is reported by path and the wave worktree is left exactly as it
was:

```
cg fleet: task/fleet/2.2 does not merge into wave/fleet/1
  conflicts in 1 path(s):
    docs/d.md
  merge aborted
```

`--keep` leaves the merge in place instead, for the manager to resolve by
hand and run `merge-up` again. A wave worktree with uncommitted changes is
refused before any merge is attempted. Re-running after a successful merge
prints `nothing to merge: wave/fleet/1 already contains task/fleet/2.1`.

A note made on a task branch is not yet a decision of the project, so it is
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

### `cg fleet land <wave|id>`

Merges a wave branch into **local** main, then runs the gates. The wave is
named by its number or by any of its task ids; `-f` names the feature when
it is not the active one, and a wave manager's `CG_WAVE` is used when
nothing is given.

```
$ cg fleet land 1
landed wave/fleet/1 into main: 2 commits, gates green (head 67187334)
  test: `sh gate.sh` ok in 5 ms
  lint: `sh lint.sh` ok in 6 ms
```

A wave lands whole or not at all. While any of its tasks is open the land
is refused before anything is merged, and the open tasks are named:

```
cg fleet: wave 1 of fleet is not done — 1 task open: 2.2 (pending)
```

Red gates mean main is reset to where it was. Landing is all or nothing: a
half-landed main is the one state nobody can reason about.

```
landing refused: test gate `sh gate.sh` failed (exit 1) — main reset to b5d899dd
  log: /path/proj/.codegraph/fleet/land-fleet-test.log
```

A wave branch that no longer merges into main — an earlier wave landed
first and touched the same lines — is refused with the conflicting paths
and main untouched. The manager merges main into its wave branch, resolves
there, and lands again.

With `pr = "auto"` a green land opens the pull request in the same call;
`--no-pr` lands without touching `gh`. In the older shape `land` takes the
feature (`cg fleet land fleet`) and merges `feature/fleet`.

### `cg fleet pr <wave|feature>`

Pushes the landed branch — a wave's, or in the older shape the feature's —
and opens the pull request against `<remote>/<main>` through `gh`.

```
$ cg fleet pr 1
opened https://github.com/acme/repo/pull/7 (wave/fleet/1 → main)
```

An already-open PR is reported, not duplicated. `--dry-run` prints what it
would run and calls nothing. When `gh` is absent the exact commands are
printed instead, runnable as they stand — the body file is written either
way:

```
pull request (gh not found): run these to open wave/fleet/1 against origin/main:
  git -C '/path/proj' push -u 'origin' 'wave/fleet/1'
  cd '/path/proj' && 'gh' pr create --base 'main' --head 'wave/fleet/1' \
     --title 'wave/fleet/1' --body-file '/path/proj/.codegraph/fleet/pr-fleet.md'
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

Merges the open Codify pull requests — the ones whose head matches the
manager branch template up to `{feature}`: `wave/*` by default, `feature/*`
in the older shape —
lowest number first, and stops at the first that will not merge, so the
order stays what a reader expects. Anything else is skipped by name
(`skipped #8 hotfix/x — not a wave/* branch`). Local main then
fast-forwards to the remote when it is clean.

```
$ cg fleet checkpoint --dry-run
checkpoint (dry-run): merge the open wave/* pull requests lowest number first:
  gh pr list --base 'main' --state open --json number,headRefName,title,url
  gh pr merge <number> --merge
```

## Reports

```sh
cg fleet roles              # the configured hierarchy
cg fleet status             # who is alive in which role, on which task
cg fleet plan [-f F]        # which manager owns each wave, which worker each task
cg fleet tree [-f F]        # the live tree: main → wave managers → task workers
cg fleet                    # same as status
```

`cg fleet plan` lays the tree over the task list — planned branches on the
left, live agents on the right, a manager row per wave and a worker row per
task under it:

```
fleet plan — feature fleet (hierarchy enabled)
main      gideon               main                                                  live: —
wave 1    wm-fleet-1           wave/fleet/1                 ← main                 live: —
  2.1     pending      w-fleet-2.1          task/fleet/2.1               live: —
          Alpha work
  2.2     pending      w-fleet-2.2          task/fleet/2.2               live: —
          Beta work
wave 2    wm-fleet-2           wave/fleet/2                 ← main                 live: —
  3.1     pending      w-fleet-3.1          task/fleet/3.1               live: —
          Docs work
```

`--json` carries `managers[]`, each with its `wave`, `agent`, `branch` and
`base`, and its `workers[]` with `task`, `agent`, `branch` and `base`. In
the older shape there is one manager with `wave` null and a worker row per
wave.

`cg fleet tree` is the same tree with what actually happened on it —
progress, whether each wave branch is ahead of main or already merged, and
the state and heartbeat of every worker:

```
$ cg fleet tree
fleet tree — fleet
main     gideon           branch main
  wave 1   wm-fleet-1       branch wave/fleet/1         base main
           tasks 1/2 done, 0 running  ahead 2  incomplete  seen -
    worker w-fleet-2.1      branch                      wave 1  task 2.1  completed  hb 1s ago
  wave 2   wm-fleet-2       branch wave/fleet/2         base main
           tasks 0/1 done, 0 running  ahead 0  incomplete  seen -
    (no workers yet)
```

It refuses in a repository with no hierarchy — *this repository runs flat* —
rather than inventing one. `--json` returns `main`, `managers[]` — one per
wave, each with its `wave` — with `tasks {total, done, claimed}`, `ahead`,
`merged` and `complete`, and
`workers[]` with `wave`, `task`, `branch`, `base`, `worktree`, `state`,
`attempt` and `heartbeat`.

All the reports take `--json`.

### Native sessions in the editor

The fleet roles are the agents Codify spawned. A Claude Code or Codex
session working on the project, and every subagent it spawns through its
own Agent tool, is recorded by `cg hook event` (see
[events.md](events.md#native-agents-cg-hook-event)) and shown in the VS Code fleet view
under a **Sessions** root beside Main Gideon — and on its own when the
repository has no `[hierarchy]`. One row per host session, its subagents
nested under it, each reading:

```
Sessions                       2 live · 1 subagent · 1 worktree branch
  claude:5e55105a              live · just now
    general-purpose — Alpha implementer
                               live · 12s ago · worktree-agent-a1b2c3d4 (unmerged)
                               · task fleet/2.2 (prompt) · › Edit
```

- **state** — `live`, `stale` (no hook for 120 s), `pending` (a spawn not
  yet started) or `stopped`, and the age since the last hook;
- **worktree branch** — the branch of the linked worktree the agent works
  in, with `(merged)` or `(unmerged)` when the branch registry holds heads
  for it and its base (the session's branch), and `worktree gone` when the
  folder was removed;
- **task** and where it came from (`env`, `attempt`, `prompt`, `parent`);
- **last tool**, and in the tooltip the model, tool-call count, cwd, and the
  subagent's last message once it stopped.

The rows come from `cg fleet tree --json` (`cg fleet status --json` in a
flat repository) on each refresh. Between refreshes every
`agent.native.*` event the `cg serve` connection pushes is folded by the
serve reducer and patches its row in place — a tool call moves the last
tool and the age, a stop greys the row — so the view follows a native
agent the moment its hook fires. **Open Native Agent Worktree** opens the
worktree folder (a new window, or added to this workspace) and **Open
Native Agent Transcript** opens the JSONL transcript the host writes; a
click on a row opens the transcript too. A live subagent's transcript is
found where the host keeps it, `<session>/subagents/agent-<id>.jsonl`
beside the session's.

### Native agents from transcripts: `cg fleet discover`

`cg hook event` records a host's own sessions and subagents as native rows
in the agents registry (see [events.md](events.md)). A host whose hooks never
fired — an older host, a hook the user has not trusted, a session started
before the plugin — still writes transcripts, and `cg fleet discover` reads
them:

```sh
cg fleet discover                 # transcripts changed in the last 24h
cg fleet discover --since 3d --json
```

- **Claude Code**: `~/.claude/projects/<project path, non-alphanumerics → '-'>/`
  for the main tree, the current tree, and every registered worktree. Each
  `<session>.jsonl` is a session (`claude:<first 8 of the id>`: cwd, model,
  start, transcript); each `<session>/subagents/agent-<id>.meta.json` beside
  `agent-<id>.jsonl` is a subagent (`claude:<id>`, parent the session — or,
  at spawnDepth 2 and deeper, the sibling whose transcript holds its
  `toolUseId` — with agentType, description, model, spawnDepth, and the task
  named in its first prompt). A pending spawn a `PreToolUse` hook recorded
  under that `toolUseId` is claimed, as `SubagentStart` would.
- **Codex**: `~/.codex/sessions/YYYY/MM/DD/rollout-*.jsonl` whose first
  record's cwd is this project or one of its worktrees (`codex:<first 8>`,
  the model from the first `turn_context`).
- **Worktrees**: a `worktreePath` in meta.json (or a transcript cwd) inside a
  linked worktree of this project registers its branch exactly as the hook
  does, with the session's branch as base, so `cg branches`, the shared
  graph, and the projection see it.
- **Never over a hook**: discovery writes a column only while it is empty;
  the `discovered` column (added on first use) lists the columns it wrote,
  `row` first when it created the row. A hook arriving later overwrites
  freely. On rows discovery created, `seen` follows the transcript's mtime.
- **Stale**: an agent whose transcript and last hook are both older than 15
  minutes is marked `stale`; the next hook heartbeat, or the transcript
  moving again, makes it `live`.
- `--json` prints `{since, found: [{agent, host, kind, session, transcript,
  mtime, stale}], changed: [{agent, created, fields, state, claimed}]}`;
  a second run over unchanged transcripts changes nothing.

`cg fleet status`, `cg fleet tree` (the editor's refresh), `cg serve`'s
refresh, and `cg watch --fleet` run discovery first when `[fleet] discover`
in `codify.kvx` is true (the default), at most once per 10 seconds per
process; `--no-discover` skips it for one command. The directory lookup is
the one `cg recap` uses (`CG_RECAP_CLAUDE_DIR` and `CG_RECAP_CODEX_DIR`
override both).

## A worked example

One feature, two waves, from nothing to merged pull requests.

```sh
# --- Gideon, in the main checkout -------------------------------------
cg fleet roles                       # confirm the tree before spawning anything
cg fleet begin 2.1                   # cuts wave/fleet/1 from main, then task/fleet/2.1
cg fleet begin 2.2                   # task/fleet/2.2, from the same wave branch

# --- a task worker, in its own worktree -------------------------------
cd .codegraph/worktrees/task-fleet-2.1
export CG_AGENT=w-fleet-2.1 CG_ROLE=worker CG_PARENT=wm-fleet-1 \
       CG_FEATURE=fleet CG_WAVE=1
cg spec start 2.1
# ...implement...
cg spec done 2.1                     # qualification runs here, on the task branch
git add -A && git commit -m "alpha: implement [spec:fleet/2.1]"
cg fleet merge-up 2.1                # task/fleet/2.1 → wave/fleet/1
# ...the worker on 2.2 does the same, beside it...

# --- the wave manager of wave 1 ---------------------------------------
cg fleet land 1                      # refused while 2.1 or 2.2 is open;
                                     # then wave/fleet/1 → main behind the
                                     # gates, and the PR (pr = "auto")

# --- wave 2 -----------------------------------------------------------
cg fleet begin 3.1                   # wave/fleet/2 is cut from main, so it
                                     # already has wave 1's work
# ...worker, merge-up, cg fleet land 2...

# --- Gideon, at a checkpoint ------------------------------------------
cg fleet checkpoint                  # merge the open Codify PRs in order
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
  feature with work left, each as its own run with its own managers and
  workers; a feature whose `[meta] requires` are not all done waits and
  starts once they are.
- Each run has a manager per wave with work, up to `[role.manager] max`
  alive at once (default: every wave). A wave's manager is woken when its
  workers have nothing left to do and its wave has work to merge up or land.
- `-n N` is the number of worker slots. Workers are also capped by
  `[role.worker] max`.
- `--max-rounds R` is the run's manager wake budget (16 per wave by
  default), so a fleet that cannot finish stops instead of spinning. `--max-fail K` stops
  the run once failed attempts exceed K (default 2).
- `--dry-run` plans without claiming or creating anything, in the
  foreground. `cg spec run --fleet` is the same run as a foreground
  command, and `cg spec run --fleet --status` prints the tree.

A real run reports each spawn and each result, and ends on the merge rather
than on a process exiting:

```
[fleet] alpha — a manager per wave (all at once) + 3 worker slot(s), driver custom, 48 wake(s)
[fleet] run dc70cdc5f81a — supervisor pid 2970055
[fleet] manager wm-alpha-1 on wave/alpha/1 (47 wake(s) left), log .codegraph/agents/alpha-manager-1.log
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
[fleet] beta — a manager per wave (all at once) + 3 worker slot(s), driver custom, 32 wake(s)
[fleet] alpha complete — 4/4 task(s) qualified, wave/alpha/* merged into main, 2 failure(s)
[fleet] beta complete — 2/2 task(s) qualified, wave/beta/* merged into main, 0 failure(s)
```

That is two features, `beta` requiring `alpha`: a task that failed once and
was retried, a worker that stalled and was restarted, and `beta` starting
the moment `alpha` landed.

### Three levels at once

The wave managers and their workers are alive together. Two processes
merging into the same wave worktree would race, so that is a lock:
`merge-up` and `land` take the merge lock of the branch they merge into
(`.codegraph/fleet/merge-<name>.lock`), waiting up to two minutes
(`CG_MERGE_LOCK_WAIT_MS`) before refusing with *another merge into …'s
branch held the lock*.

Each task gets its own slot, branch, and worktree, and the tasks of a wave
run in parallel when their declared touches are disjoint and no collision
is predicted (see [drift.md](drift.md#collision-prediction)). A predicted
collision runs one after the other. A task that is already running is never
handed to a second slot. In the older shape a worker owns a whole wave and
works its tasks in order.

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

**Escalation.** When the retries are spent, the task goes to its wave's
manager: it is steered with the failure and woken to fix the task on the
wave branch, re-plan it, or record it as blocked. If a manager wake
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
tasks actually introduced upstream, with signatures; *Working
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
update`: when another task has merged into the wave branch since the
attempt began, the delta gains an `upstream` list naming the task, the
branch, and the symbols it brought, each resolved in the graph. When
nothing merged, the delta stays as compact as before.

Each child also gets its identity in the environment: `CG_ROLE`,
`CG_PARENT`, `CG_FEATURE`, `CG_WAVE`, `CG_BRANCH`, `CG_BASE`, `CG_RUN` —
and, for a worker, `CG_TASK`, `CG_ATTEMPT` and `CG_FENCE`. The prompts end
on the command that moves work upward: a worker's with `cg fleet merge-up
<id>`, a wave manager's with `cg fleet land <wave> -f <feature>` (the older
shape's feature manager: `cg fleet land <feature>` and `cg fleet pr
<feature>`).

## Limitations

- The lifecycle commands drive `git` and `gh` as subprocesses. Without
  `gh`, `pr` and `checkpoint` print the commands rather than running them.
- `land` runs the gates in the main tree, after the merge, and resets on
  red. It does not run them on the wave branch first.
- Waves land in the order their managers finish, not strictly by number;
  a wave's tasks still wait for the tasks they `require`.
- `merge-up` reads the task's status from the branch tip, so work that
  qualified but was not committed looks unqualified. That is deliberate;
  `--force` exists for the exceptions.
- `checkpoint` only recognises head branches that match the manager
  template (`wave/*`, or `feature/*` in the older shape) as Codify's own.
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
