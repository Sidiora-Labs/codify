# Repository baseline and implementation seams

Status: source audit, 2026-10-16. This document records current source facts and proposed migration implications. It does not establish runtime throughput, model quality, provider behaviour or successful implementation of Hyperfide. Source must be refreshed when implementation begins.

## Source identity and audit limits

The current source version is `1.6.0` in [`src/cg.h`](../../src/cg.h). The workflow source selects `codify-v16` in [`spec/workflow.kvx`](../workflow.kvx); generated agent pointers may lag that source. The Hyperfide draft does not activate a feature or change the installed product. Product version, database schema version and proposed successor release version are separate identities.

The SQLite schema constant is `18` in [`src/db.c`](../../src/db.c). Additive compatibility handling means an importer must inspect actual tables, columns and indexes rather than infer their entire shape from that number.

This audit inspects repository code. It does not inventory external launchers or establish any particular deployment's resources, account entitlements or authentication mode. Qualification corpora must be supplied through approved manifests with content identity, permission to use them and expected assertions. Public deterministic invalid-input fixtures should exercise unknown dependencies, cycles and contradictory ownership without embedding operational source material.

## Process supervision and hierarchy

Current source facts in [`src/orchestrate.c`](../../src/orchestrate.c):

- `ORCH_MAX_SLOTS` is 16 and configured local supervisor slots are clamped to it. Multiple feature supervisors can exist; 16 is not a global account limit.
- `ORCH_MAX_TRIED` is 256. This bounds start history per feature supervisor, including retries. The dispatch and restart-loading paths respect the bound; increasing concurrency alone does not remove this lifetime limit.
- `SUP_MAX_MGRS` is 64, with additional fixed-size escalation records. Distributed capacity cannot be implemented by increasing a single slot constant.
- Spawn and fleet execution use local fork/exec, local worktree directories, Linux `/proc` identity and process-group operations. Supervisor locks use filesystem `flock`.
- Durable fleet records retain PID/start identity, attempts, branches, supervisor state and outcomes. Existing restart handling is a useful seam for a remote supervisor contract.

Hierarchy configuration in [`src/fleet.c`](../../src/fleet.c) and `src/orchestrate.c` supports managers per wave and a feature-wide mode. Persistent accountable feature ownership with successive wave packages is a proposed policy. Manager responsibility and the lifetime of a particular manager process must remain distinct.

Migration implication: persist sandbox, boot, slot and native-session identity, retain process adapters inside remote supervisors, and replace host-local assumptions at the control boundary. Size records from stored data and explicit configurable limits. The inspected launch paths do not establish a complete provider inventory, cross-provider reconciliation protocol or globally enforced build/test budget; external tools remain a discovery item.

## Ownership and fencing

The database schema includes task leases and attempts with host, session, fence, state, heartbeat, expiry, branch, worktree and parent identity. In [`src/spec.c`](../../src/spec.c), `spec_attempt_begin` advances a fence and supersedes previous running attempts inside a writer transaction. `spec_attempt_heartbeat` checks exact task, agent, attempt, fence, running state and expiry. These are useful foundations for distributed ownership.

The source also exposes limits that the migration must resolve:

1. `spec_require_owner` permits ordinary manual lifecycle operations without attempt/fence credentials. Documentation closure has an additional live-attempt check. Distributed authority-changing worker operations require complete current credentials.
2. `spec_set_status_owned` spans SQLite state and a KVX file. Its busy path can rewrite KVX status immediately and queue a fenced release for later replay. That later release does not make the earlier file rewrite an atomic global completion decision.
3. Helpers such as `spec_attempt_set_branch` and `spec_attempt_finish` select a running task attempt without a generation in their interface. Their distributed call paths require explicit review.
4. Integration locking in `src/fleet.c` coordinates cooperating local processes. It does not fence independent remote Git writers.

Migration implication: PostgreSQL must commit ownership, result acceptance and outgoing event intent as one authoritative transaction. Exported KVX state is a projection. A protected Git publication gateway needs expected-head comparison and current publication authority; a database lease cannot by itself stop a stale process that retains unrestricted Git write credentials.

## Shared SQLite writer and graph ingestion

`Cg` holds a SQLite connection and defaults to `.codegraph/graph.db` in `src/cg.h`. The schema in `src/db.c` stores files, symbols, references, routes and FTS alongside leases, attempts, agents, runtime events, fleet state and approvals. Schema creation enables WAL and `synchronous=NORMAL`.

Indexing already batches writes. [`src/scan.c`](../../src/scan.c) defines `INDEX_CHUNK` as 96. Parsing occurs before `flush_chunk` begins its write transaction, and the writer is released between chunks. The final reference-resolution phase holds a write transaction across anchor edges, imports, references, semantic incremental resolution and graph-health publication. File removal has its own transaction. `cg_begin_write` uses `BEGIN IMMEDIATE`, a configured busy wait and queued-write replay. Claims require live ownership state and can fail rather than journal a deferred claim.

These are source-observed contention opportunities. They do not quantify lock-wait contribution or establish a PostgreSQL speedup. The migration needs mixed claims, heartbeats, events, graph writes and read traffic measurements.

Specific compatibility work includes:

- SQLite FTS5 trigram/unicode61 tables, row IDs, contentless-body modes, `MATCH` and ranking behaviour. PostgreSQL search needs explicit recall/ranking fixtures.
- SQLite JSON triggers, date expressions, conflict handling, affected-row checks and inserted identity semantics.
- Direct SQLite preparation/binding/column extraction across graph, runtime, specification, governance, projection and memory modules. Changing a connection string is insufficient.
- Query algorithms whose per-symbol/per-file lookups would otherwise become network round trips. Bulk staging and set-based resolution require deliberate implementation.
- Exact repository, source revision or overlay, extractor and configuration identities; complete graph-generation publication; degradation metadata; causal replica freshness.

## Events, work packets and agent-facing interfaces

[`src/events.c`](../../src/events.c) implements row-trigger events, KVX status hooks, explicit events, monotonic event IDs and retained-history handling. This observation machinery is not yet the full contract for durable remote acknowledgements, consumer retention, authenticated transport and reconnect/replay semantics. A PostgreSQL sequence allocation order is not a safe transaction commit-order cursor.

[`src/govern.c`](../../src/govern.c) and [`src/mcp.c`](../../src/mcp.c) expose:

| Existing interface | Current capability | Migration obligation |
|---|---|---|
| `work_open` | Criteria, scope, task state, memories, graph context, test impact, runtime evidence and revision | Preserve packet semantics while routing preparation and auto-indexing to approved execution locations. |
| `work_update` | Delta state, evidence and workspace paths since a stored revision | Add consistent distributed revisions, freshness and explicit resynchronisation. |
| `work_close` | Criterion-to-proof bookkeeping with unverified entries | Validate provenance and observed results independently from submitted text. |
| Runtime progress | Activity and evidence observations | Preserve the distinction between liveness, activity, useful progress and qualification. |
| Agent registry/events | Native IDs, parentage, model/session and process-facing state | Link remote boot/slot identity, descendants, cancellation and recovery. |

`work_close` currently labels a criterion verified when a supplied or stored proof string is nonempty. That operation does not execute or independently validate the proof. Retain evidence submission while adding independent acceptance.

## Qualification and documentation closure

The current source distinguishes `implemented` and `done`. Prod-mode `spec_implemented` runs non-executing graph checks rather than `verify_cmd`; some prerequisite scheduling can unlock from implemented state. Hyperfide must declare whether a dependency needs implementation, qualification or integration.

`spec_done_cmd` in `src/spec.c` checks supplied ownership credentials, executes declared verification, runs graph checks and writes status. Ordinary in-progress tasks still have `--force` paths past failed verification and failed graph checks. The implemented-to-done path rejects forced completion. Fleet dependency checks add further restrictions. Therefore a universal non-bypassable qualification contract requires implementation work rather than assuming every current path already enforces it.

Graph-open logic can warn and use the last completed index when current indexing is busy. Existing graph checks primarily establish declared symbol existence and changed-path evidence. Coverage in [`src/drift.c`](../../src/drift.c) maps clauses to tasks marked done; a whole requirement reference can cover its clauses. Neither check independently demonstrates behaviour or test adequacy.

[`src/docs.c`](../../src/docs.c) has a separate closure lifecycle: deterministic documentation checks, an attributed snapshot, captured-tree checks and incremental baseline persistence. Baseline persistence can warn after closure while the command reports success. A durable distributed closure receipt must therefore distinguish check, snapshot and baseline outcomes. This source audit establishes no successful documentation qualification run.

## Projection and semantic assurance

[`src/projection.c`](../../src/projection.c) folds branch contributions onto a base through Git object operations. Uncommitted changes can be represented by shadow commits. It records a projection ref and contribution metadata; diagnostic conflicts can remain in the projection. A diagnostic projection is distinct from a qualified integration candidate.

[`src/conflicts.c`](../../src/conflicts.c) checks public signature removal or change used in changed code on another branch, alongside other textual/symbol conflict checks. That pass does not establish compatibility for unchanged consumers or behavioural changes with unchanged signatures.

`contract_findings` in [`src/resolve.c`](../../src/resolve.c) identifies calls to non-callable resolved symbols and missing route-handler graph names. Structured semantic extraction and resolution supply useful evidence, but do not themselves prove units, freshness, retries, authorisation, idempotence or end-to-end invariants.

The new design must distinguish diagnostic projections, qualified task results, tested integration candidates and landed revisions. Producer/consumer contracts, exact-input executable evidence, change invalidation and programme-level closure remain explicit implementation obligations.

## Existing decision routes

[`src/jev.c`](../../src/jev.c) defaults to `typesafe/jev-1.13` through a decision endpoint, supports model/endpoint/transport overrides and includes bounded retries and timeout handling. Its typed outputs are Noul, Choice and Score; additional provider extensions require adapters and tests.

Noul confidence is derived as `max(p, 1-p)`; Choice and Score consume returned confidence fields. These values need provider- and purpose-specific calibration. Existing logs contain route identity, request/response hashes, timing, token, cost and error metadata; they do not constitute a complete replayable packet with policy, run, task and observed-outcome lineage.

[`src/recap.c`](../../src/recap.c) uses a separate Solar Decide route through Centra. Migration must inventory it explicitly instead of assuming that every decision uses the Jev configuration. Current failure triage remains advisory: command failure establishes the result before model interpretation.

No inference or comparative model evaluation was performed for this source baseline. Route capabilities and source-qualified provider claims belong in [decision-models.md](decision-models.md), with future runtime qualification.

## Work boundaries and remaining qualification

The [implementation plan](implementation-plan.md) assigns exact file ownership and dependencies for storage, specification, scheduling, remote execution, native connectors, graph ingestion, assurance, integration, durable events, decision assistance, migration, branding and documentation closure. Existing local semantics must be inventoried before replacing their seams.

Outstanding evidence includes actual database shapes, differential search behaviour, approved workload corpora, mixed graph/control-plane load, external launcher topology, connector authentication modes, provider capabilities, remote recovery and sustained-operation campaigns. All product cases remain **UNRUN**. The source audit does not turn these unknowns into deployment guarantees.
