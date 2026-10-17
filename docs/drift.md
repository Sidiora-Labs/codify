# Drift

A fleet drifts in four ways: a task changes code it never declared, two
tasks that run at once step on each other, a merge changes a symbol another
live branch depends on, or a feature lands with acceptance criteria no
qualified task covers. Hyperfide looks for each before the change merges,
records every finding as an event, and shows it in `hyperfide brief`, `hyperfide fleet
tree`, and the editor's agent chat.

Drift **warns by default**. It blocks only where `spec/workflow.kvx` asks
for it, through a role's `approve` list.

`hyperfide` is the command; `cg` is the deprecated compatibility alias from
the same executable, with identical arguments, JSON and exit codes.

Implemented in `src/drift.c`; covered by `tests/integration/33_drift.sh`
and the fleet end-to-end suite `tests/integration/35_fleet_e2e.sh`.

## Spec drift

A task declares what it will change: `touches` (paths or globs) and
`symbols`. Spec drift compares the task's actual git diff with that
declaration and reports two things: paths changed outside the touches, and
public symbols whose lines changed but are not among the declared symbols.

It runs on its own at `hyperfide spec done` and at `hyperfide fleet merge-up`, and on
demand:

```
$ hyperfide drift check 3.2 --base feature/alpha
drift: 3 path(s) changed outside the task's touches: src/a.ts src/b.ts src/b1.ts
drift: 4 public symbol(s) changed but not declared: alpha (src/a.ts) beta (src/b.ts) b1 (src/b1.ts) delta (src/d.ts)
drift: declare them in the task (touches/symbols) or keep the change inside its scope
```

`--base` defaults to `CG_BASE` (alias `HYPERFIDE_BASE`) when the fleet set
it, else `HEAD`. At `hyperfide spec done` a finding is advice and never a reason to refuse: the task still
qualifies on its `verify_cmd` and graph checks. At `merge-up` it is advice
too, unless a role lists `drift` in `approve` — then the merge waits for
`hyperfide fleet approve` (see [hierarchy.md](hierarchy.md#approvals)). Each check
is recorded as a `drift.spec` event.

## Collision prediction

Before two open tasks run at the same time, the supervisor asks whether
they will collide: overlapping touch globs, the same declared symbol, or
declared symbols that call one another directly in the graph. Predicted
collisions run one after the other instead of side by side, and the
serialization is recorded once as a `drift.collision` event.

```
$ hyperfide drift collisions -f gamma
2.1      2.2      both touch src/*.ts / src/d.ts
```

A pair is listed once, with the first reason found; the other reasons read
`both change alpha` and `alpha and delta call one another`.

With nothing predicted it says `no predicted collisions among the open
tasks of alpha`. `hyperfide drift` alone is the same report for the active feature.

## Interface drift across branches

After every merge into a feature branch, Hyperfide diffs the signatures of the
symbols that merge changed and looks up references to them on every other
live branch through the unified graph (see [branches.md](branches.md)). A
removed symbol or a changed signature that another branch still references
becomes a `drift.interface` event naming the symbol, its old and new
signature, the referencing sites, and the agents on those branches:

```json
{"symbol":"alpha","change":"signature","path":"src/a.ts",
 "old":"export function alpha(): number {","new":"export function alpha(n: number): number {",
 "base":"feature/alpha","from":"task/alpha/2.2",
 "sites":[{"branch":"task/alpha/3.2","path":"src/d.ts","line":3}],
 "agents":[{"agent":"w-alpha-3.2","parent":"fm-alpha","branch":"task/alpha/3.2"}]}
```

Each of those workers, and the manager it reports to, is steered with the
change (see [events.md](events.md#steering-a-running-agent)):

```
Interface drift on feature/alpha: `alpha` (src/a.ts) was changed by a merge into
feature/alpha for alpha/2.2. Your branch task/alpha/3.2 references it — rebase or
merge feature/alpha and adjust before you qualify. New signature: export function
alpha(n: number): number {
```

The same question is asked before any merge: every projection build runs
this machinery over each active branch against the base and reports an
`interface` finding when another branch references the changed symbol in
code it changed, beside the `symbol`, `near`, and textual findings (see
[projection.md](projection.md#findings)).

## Requirement coverage before land

`hyperfide fleet land` first checks that every acceptance criterion of the feature
is traced to a qualified task. An uncovered criterion is printed; the land
continues unless a role lists `coverage` in `approve`, in which case it
waits for approval. The same report on demand:

```
$ hyperfide drift coverage -f alpha
coverage: every acceptance criterion of alpha has a qualified task
```

An uncovered clause reads `coverage: 1 acceptance criterion(s) of alpha
have no qualified task:` followed by the clause, the task that would cover
it when there is one, and the start of its text.

## Where findings show up

```
$ hyperfide drift summary -f alpha
drift for alpha:
  spec: 6 (latest #101)
  interface: 1 (latest #83)
```

The same counts appear in `hyperfide brief` (`drift on alpha: 7 finding(s) — cg
drift summary`) and under the feature manager in `hyperfide fleet tree`. The `#`
numbers are event sequence numbers: `hyperfide events --since 100 -n 1` shows the
latest spec finding. In the editor, an interface-drift finding appears as a
notice in the agent chat, and a chat attached to a fleet agent shows that
agent's drift events inline.

## The Hyperfide control plane

Every drift check here is the binary's, run against the local checkout, its
git history and its SQLite graph (`src/drift.c`, called from `src/spec.c`,
`src/fleet.c` and `src/orchestrate.c`). In distributed authority mode (a
`.hyperfide/authority.json` descriptor, or `HYPERFIDE_AUTHORITY_DESCRIPTOR`;
`hyperfide authority mode` prints the mode), `hyperfide drift` refuses with
`DISTRIBUTED_COMMAND_UNSUPPORTED`, exit 78 (`src/hyperfide/client.c`), as
do `hyperfide fleet merge-up` and `hyperfide fleet land`, which run the
drift and coverage gates.

The control service carries the distributed counterparts: producer-consumer
contracts and behavioural impact analysis
(`services/hyperfide/src/review/contracts.ts`), criterion-level
qualification coverage (`services/hyperfide/src/assurance/coverage.ts`),
assurance invalidation when an input changes
(`services/hyperfide/src/assurance/validity.ts`), and task, wave and
programme closure (`services/hyperfide/src/integration/closure.ts`). Tasks
16.3, 16.4, 17.2 and 19.3 are `pending` in `spec/hyperfide/spec.kvx`, so
that path is not qualified in this revision.

## Limitations

- Spec drift is line-level: a symbol counts as changed when a diff hunk
  overlaps its lines in the graph. A change in behaviour with no line
  change inside the symbol is not seen, and "public" is the graph's
  heuristic, not a compiler's export list.
- Collision prediction looks one call deep. Two tasks whose symbols meet
  only through a third function are not serialized.
- Interface drift sees references the indexer extracted on other live
  branches. Dynamic dispatch, reflection, and references in languages the
  graph does not index are missed.
- The counts in `hyperfide drift summary` and the fleet tree are every finding
  recorded, including ones that were later fixed.
- The feature manager's briefing (`hyperfide fleet brief`) does not yet list drift
  findings; a manager learns of interface drift through the steering
  message, and of spec drift from `hyperfide drift summary`.
