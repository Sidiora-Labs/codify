# Generate and maintain project documentation

Codify's documentation stage gives your existing agent the repository evidence needed to update user and developer docs. Codify prepares the packet, checks recorded claims and scope, and snapshots the result; the connected agent writes and reviews the prose. It does not add an embedded model or authenticate a provider for you.

Start with the [command reference](../README.md#command-reference), [architecture](ARCHITECTURE.md), or [contribution guide](../CONTRIBUTING.md) if you are new to the project.

## Enable the final stage

New feature specs include automatic documentation closure. Existing specs without a documentation section keep legacy completion behavior. To enable the active feature explicitly:

```sh
cg spec docs auto
cg docs plan
cg spec next
```

Documentation becomes eligible only after every ordinary leaf task is `done`. A task marked `implemented` has not yet qualified and does not unlock documentation. The reserved work item is `@docs`; it is not another numbered implementation task.

The feature's `spec.kvx` controls policy and output scope:

```kvx
[documentation]
mode = "auto"
status = "pending"
audiences = ["user", "developer"]
targets = ["README.md", "docs/**", "CONTRIBUTING.md", "CHANGELOG.md"]
```

Use `cg spec docs manual` to keep documentation required but start it yourself, or `cg spec docs off` to skip it explicitly. Status transitions belong to the lifecycle commands, not hand-edited completion flags. Documentation commands accept `-f feature-name` when the active feature is not the intended target.

## Let the configured connector continue

Once implementation tasks have qualified, an orchestrated run can claim and execute `@docs`:

```sh
cg spec next
cg spec run -n 1 --max-fail 0
```

The orchestrator requires an initialized `.codegraph/` and workflow mode `parallel` or `prod`. It reads the driver from `[agents]` in `spec/workflow.kvx`: `codex`, `claude`, or `custom`. The installed driver must already be authenticated and have the permissions needed for the work. `-n 1` limits concurrency, not the total number of tasks; run it at the documentation frontier if that is the only work you want dispatched. `--max-fail 0` stops after the first failure.

Implementation completion only exposes the next stage. `cg spec done` does not recursively launch an agent. Likewise, `cg docs packet` creates evidence, not finished public documentation. A connected interactive session can consume that packet instead of starting another process.

The current dry-run planner may report no pending numbered tasks even when `@docs` is ready. Use `cg spec next` and `cg spec docs status` to inspect the documentation frontier.

## Work in an existing interactive session

When no live agent owns documentation, the local interactive sequence is:

```sh
cg spec docs start
cg docs packet
# Inspect the packet and sources, then edit only the configured documents.
# Fill the document mappings in the private claims.kvx ledger.
cg docs check
cg docs close
cg docs trace
```

For shared workspaces, claim `@docs` first with `cg spec claim @docs --agent docs --ttl 30 --json`. Retain the returned attempt ID and fence, and supply them with `--agent`, `--attempt`, and `--fence` to `cg spec start @docs` and heartbeat calls. The claim/heartbeat `--ttl` is in minutes; the orchestrator's `[agents] ttl` setting is in seconds.

For `cg docs close`, an owned session passes `CG_AGENT`, `CG_TASK`, `CG_ATTEMPT`, and `CG_FENCE` in its environment. `CG_TASK` must be the exact `feature-name/@docs`. The orchestrator supplies these automatically. A live claim cannot be bypassed by omitting its credentials, and a stale fence cannot complete a replacement attempt.

Keep unrelated code changes out of the documentation run. Checks compare the working tree with Codify's latest snapshot, not Git HEAD. Snapshot reviewed implementation work with `cg commit` before documentation starts; do not commit away documentation edits just to hide a failing check. `cg docs close` owns their final snapshot.

## What the agent receives

The private packet lives under `.codegraph/docs/<feature>/packet.md`. It combines the normative feature spec, task trace and qualification state, snapshot history and changelog, graph context, changed symbols, routes, anchors, memories, and a documentation inventory. Source captures have size limits and identify unavailable or omitted evidence. The agent must inspect exact source files when the packet is insufficient.

On the first closure, required coverage is derived from the whole indexed project. Subsequent features use the project-wide baseline and task-tagged changed paths to request incremental updates. This is graph-based coverage, not a language compiler's exported-API inventory: helpers, tests, and vendored tooling can appear. Classify them accurately instead of presenting every indexed name as a supported interface.

For Codify's own baseline, the [source reference](SOURCE-REFERENCE.md) maps implementation symbols to their declarations. The separate [test reference](TEST-REFERENCE.md) identifies fixtures and sample routes. Neither is a promise that internal symbols are stable public APIs.

## Map claims to evidence

`claims.kvx` is an agent-editable ledger in the private feature directory. `required.kvx` is regenerated by Codify during checks; editing it cannot remove required coverage. The following is an illustrative mapping for this repository:

```kvx
[coverage]
user = "docs/DOCUMENTATION.md"
developer = "docs/ARCHITECTURE.md"
release_or_migration = "CHANGELOG.md"
exclusions = "Test routes are fixture examples, not deployed services."
unresolved = ""

[claim.docs_check]
type = "symbol"
value = "docs_check"
document = "docs/ARCHITECTURE.md"
evidence = "src/docs.c"
```

Claim types are `symbol`, `route`, `path`, and `command`. A claim must appear in its mapped document and have a repository evidence path. Symbol and route evidence must point to the file where the graph resolves that name or route. Command checks look for the command text in the evidence file; they do not execute it or prove its runtime behavior. Each recorded claim must be true at that limited level, with behavioral explanations reviewed against source separately.

The current checker requires mappings for user, developer, and release/migration coverage, explicit exclusions, and an empty unresolved field. If a necessary claim cannot be supported, retain it as unresolved and stop closure rather than clearing the field to obtain a pass. Optional claims can be omitted from public documentation when their behavior is not established.

## Checks, closure, and recovery

`cg docs check` verifies target scope, preservation of changed documents, local inline Markdown links, coverage mappings, recorded evidence, and required graph observations. It requires at least one configured document to have changed. The active feature's spec and generated Markdown mirrors are allowed bookkeeping exceptions to document scope.

The checker does not certify arbitrary prose, external URLs, Markdown fragment targets, reference-style links, localized wording, or live provider behavior. It also does not enforce preservation of every existing paragraph inside an allowed file; review the diff for unrelated deletions and rewrites. A pass is structural evidence, not a substitute for editorial or runtime review.

`cg docs close` re-runs the checks, writes a snapshot tagged `[spec:<feature>/@docs]`, then completes the owned attempt and writes baseline metadata. A failed check leaves the stage unfinished. A failed snapshot cannot qualify the stage. Do not use `cg spec docs done`, manually create marker files, or force an implementation task to impersonate documentation closure.

After closure, inspect `cg docs trace`, `cg spec docs status`, and the saved `check.json`. `cg docs check` is a pre-close changed-document gate, not an unconditional post-close audit: it requires a document delta against the latest snapshot.

If a launched agent exits without completion, the orchestrator releases its claim, resets documentation to pending, and records an outcome. Its prompt and log remain under `.codegraph/agents/`. Authentication failures are connector failures, not successful documentation runs; restore provider access or continue in an already-connected session. For a manually blocked stage, use `cg spec docs reset` before starting again, with the correct ownership credentials if a claim is live.

## Developer entry points

The behavior above is implemented in [src/docs.c](../src/docs.c), [src/spec.c](../src/spec.c), and [src/orchestrate.c](../src/orchestrate.c). `docs_packet` assembles evidence, `docs_check` validates recorded claims, and `docs_close` invokes the guarded completion path. `spec_docs_stage` computes effective lifecycle state; `spec_docs_finish` is the internal completion entry used after checks. MCP routing lives in [src/mcp.c](../src/mcp.c).

For changes to this feature, run its real CLI integration coverage against the checkout binary:

```sh
make
CG="$PWD/cg" tests/integration/24_docs.sh
```

That suite covers lifecycle, packet construction, failed claims and links, scope and symlink checks, ownership, snapshot closure, and a controlled custom-driver fixture. The fixture tests connector plumbing; it is not certification of a live Codex or Claude account. Use the [full qualification instructions](../CONTRIBUTING.md#tests) for implementation changes.
