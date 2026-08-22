# Codify Prod Mode Design

## Purpose

Codify currently conflates source implementation with qualification in the `done` transition. `cg spec done` executes `verify_cmd`, performs graph checks, and marks a task `done`. Repositories that separate agent implementation from human qualification need an explicit intermediate state that records completed coding work without claiming compilation or test success.

## Lifecycle

Prod mode adds one state without changing the meaning of any existing state:

```text
pending -> in_progress -> implemented -> done
```

- `pending`: implementation has not started.
- `in_progress`: an agent owns the implementation slot.
- `implemented`: coding is complete and declared source evidence exists, but compilation and tests have not been claimed.
- `done`: the task's executable qualification and graph checks have passed.

The `implemented` state is never rendered as completed and never contributes to the qualified `done` count.

## Activation

Prod mode is repository-owned configuration in `spec/workflow.kvx`:

```kvx
[mode]
name = "prod"
```

`cg spec mode prod` writes that setting surgically and refreshes generated projections. `cg spec mode standard` restores standard behavior. An absent or unrecognized mode behaves as `standard`, preserving compatibility with every existing workflow file. Only the literal repository value `prod` activates Prod mode; environment interpolation cannot activate it implicitly.

## Commands

`cg spec implemented <id>` is available only when Prod mode is active. It requires the task to be `in_progress`, performs the existing non-executing symbol and touched-path graph checks, does not read or execute `verify_cmd`, changes only the task status to `implemented`, refreshes projections, records an `implemented: <title> - qualification pending` outcome, and reports the next implementation-eligible task. It has no `--force` option.

`cg spec done <id>` retains its current qualification behavior. It accepts either `in_progress` or `implemented`, executes `verify_cmd`, performs graph checks, and changes the status to `done` only if all checks pass. Failed qualification leaves an `implemented` task implemented.

The legacy `--force` behavior remains available for non-implemented tasks for backward compatibility, but it cannot promote an `implemented` task past failed qualification. That boundary ensures `implemented -> done` always carries real qualification evidence.

## Dependency Semantics

In standard mode, only `done` satisfies `requires`.

In Prod mode, both `implemented` and `done` satisfy `requires` for `cg spec next` and `cg spec start`. This lets agents continue dependency-ordered implementation while qualified completion remains independently visible.

An implemented task cannot be restarted without the existing explicit force path, and it does not count against `max_in_progress`.

## Presentation and APIs

- Text status reports separate `done`, `implemented`, `in progress`, and `pending` counts.
- JSON status adds `mode` and `implemented` fields while retaining existing fields.
- Qualified progress remains based only on `done`; coding progress is reported separately from `done + implemented`.
- Markdown task mirrors render implemented tasks as an unchecked task with the suffix `Implemented - qualification pending`; they never use `[x]`.
- Requirement displays distinguish `(done)`, `(implemented)`, and `(NOT ready)`.
- Trace output and JSON preserve the exact `implemented` status.
- MCP exposes `spec_implemented` and `spec_mode`; existing tools retain their names and behavior.
- Codify snapshots remain auto-tagged only while a task is `in_progress`, so the intended flow is snapshot first, then mark implemented, then create the real Git commit.

## Safety and Compatibility

- `cg spec implemented` never executes shell commands.
- There is no force bypass for the implemented transition.
- Standard mode remains byte-compatible for existing generated fixtures and behavior-compatible for existing task workflows.
- Existing specs containing only `pending`, `in_progress`, and `done` require no migration.
- `done` continues to mean qualified completion; no existing success signal is weakened.

## Verification

Integration coverage proves mode activation, non-execution of `verify_cmd`, graph-check refusal, dependency unlocking only in Prod mode, promotion from implemented to done, preservation of implemented after failed qualification, status/JSON counts, Markdown rendering, MCP exposure, and standard-mode backward compatibility. The complete unit and integration suite must pass before publication.
