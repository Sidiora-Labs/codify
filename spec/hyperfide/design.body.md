# Hyperfide design overview

Status: **proposed implementation design, awaiting review and explicit go-ahead**. Functional requirements and open qualifications are separated in [decisions.md](decisions.md). Detailed contracts prevail over this overview; a contradiction must be resolved before implementation rather than choosing whichever text is convenient.

## 1. Purpose and scale

Hyperfide evolves Codify from predominantly local process and SQLite coordination into a distributed engineering system. The purpose is to make large frontier-agent runs manageable, recoverable and semantically coherent—not to replace frontier reasoning with small decision models. Representative large specification corpora are selected through approved qualification manifests; declaration counts alone do not prove successful implementations. The [baseline audit](repository-baseline.md) identifies current local process assumptions, fixed limits, split file/database status writes and verification gaps requiring explicit changes.

Proposed qualification profiles cover 48–72-hour runs, up to 1,500 agent-session lifetimes and 200 concurrent remote frontier sessions. Smaller runs use their own explicit concurrency settings. Hyperfide reports session lifetimes, attempts, current concurrency, peak concurrency, native children and deterministic jobs separately; none is inferred from another.

The large-run qualification target is 100 sandboxes across configured Railway and Blaxel pools. Provider quotas, regions, creation rates and negotiated account terms are private deployment inputs that must be qualified. Sandboxes and agent slots are separate capacity dimensions. A proposed example uses 75 implementation sandboxes ×2 agents, 10 review sandboxes ×3, 10 qualification/integration sandboxes ×2 and five prepared replacements: 200 remote agents in 100 allocated sandboxes. One leader and an illustrative 13 managers are additional main-server sessions. This is arithmetic, not measured density.

## 2. Physical and authority boundaries

| Location | Responsibilities | Durable authority |
|---|---|---|
| Supervisory main server | Primary leader, feature managers, coordination API, scheduling, provider SDK control, issue routing, observation and recovery decisions. | PostgreSQL transactions and recorded policy; local processes are replaceable. |
| External data services | PostgreSQL primary, qualified HA standby/read replicas, Git, durable artifact storage. | Primary owns live state; Git owns source objects; artifact storage owns large immutable payloads. |
| Railway / Blaxel pools | Sandbox supervisors, frontier workers, review agents, qualification, integration, preparation and graph extraction jobs. | Scoped execution capabilities; no independent right to change global ownership or protected target refs. |
| Protected publication gateway | Remote, isolated publication path with sole protected-target write capability. | Current primary-authorised publication intent, expected Git head and externally enforced fencing. |

The main server is reserved for supervision; implementation and builds execute remotely. The recommended contract extends that boundary to dependency preparation, indexing, tests, reproductions, review execution and integration, keeping heavy execution and its failure modes remote. Source reading and published graph queries remain supervisory. Installation uses prebuilt artifacts; compiling the platform itself on the main server is not a loophole. A process/permission boundary must enforce placement, with negative tests; instructions alone are insufficient.

External PostgreSQL/artifacts preserve acknowledged state during main-server failure. They do not make the sole leader/API continuously available. Already admitted workers have a bounded offline deadline, checkpoint and quiesce if authority cannot be renewed; recovered control services reconcile before dispatch. An always-on alternate main server is a separate optional availability design.

## 3. Roles and how Hyperfide is used

| Role | Engineering responsibility | Hyperfide operations and limits |
|---|---|---|
| Human | Supply specification, constraints and changes to intent. | Interacts with primary leader; reviews programme-level decisions, not ordinary worker dispatch. |
| Primary leader | Interpret and amend programme intent, appoint managers, resolve cross-feature disputes, report evidence and exceptions. | Validate/pin run, assign or transfer packages, inspect closure and issue run controls. One logical leader epoch. |
| Feature manager | Own a wave package, choose a configured frontier worker profile, steer implementation and repair, own findings. | Request eligible task attempt, inspect context/evidence, steer, request recovery or escalation. Cannot self-certify missing proof. |
| Coordinator | Enforce scheduling, authority, budgets, state transitions and qualification prerequisites. | Primary transactions, durable commands/outbox, replica-aware reads, reconciliation. Model advice cannot bypass it. |
| Provisioner | Translate approved capacity requests into provider lifecycle operations. | Persist intent before calls, apply full profile, discover resources, quarantine ambiguity and reconcile deletion. Holds provider administration capability. |
| Sandbox supervisor | Prepare and isolate slots, own agent IPC/processes, report events, checkpoint and clean up. | Boot enrollment, readiness, idempotent launch ledger, resource accounting and bounded spooling. |
| Implementation / repair worker | Perform assigned work with the selected frontier model and exact context. | Registered attempt and children, attributable source/artifacts, immutable submission; no protected target publication. |
| Commit / semantic reviewer | Inspect every required revision and producer/consumer behaviour, report evidence-backed findings. | Revision-pinned review packet, rubric, coverage receipt and internal finding. Ten to fifteen commit watchers each cover every relevant commit initially. |
| Qualification executor | Reproduce required checks independently of the submitting worker. | Separate job/lease/environment, complete result artifacts, exact input identities and assertion inventory. |
| Integration role | Assemble and qualify candidates; publish through the isolated gateway. | Exact commit-set manifest, expected-head operation, per-target receipts and programme release barrier. |
| Finding / issue dispatcher | Maintain accountable ownership, deduplicate and route repairs, mirror GitHub. | Durable internal events plus ten-minute external reconciliation. Issue closure alone cannot close a finding. |

Stable feature/domain ownership across successive wave packages is recommended. Wave-oriented manager allocation remains supported through explicit package ownership and handoffs. Manager count is not hardcoded to wave count or feature count. Native child agents register and reserve capacity before meaningful execution; an unsupported delegation mechanism is disabled for that profile.

The detailed logical operations are in [execution contract §6](execution-contract.md#6-proposed-protocol-and-atomic-operations). Existing `cg brief`, `spec`, graph/context, review/guard, commit and documentation concepts become compatible façades over those contracts. Exact new CLI/API names are proposed interfaces, not already shipped commands. The canonical public command is proposed as `hyperfide`, with `cg` retained according to the migration matrix.

## 4. One task from intent to integrated evidence

1. The leader pins the spec, repositories, allowed actions, closure policy and manager package. Import validates dependencies, cycles and required milestones. Invalid dependency fixtures must produce concrete cycle diagnostics even when task labels say `done`.
2. The manager requests an eligible task. One primary transaction validates dependencies, run state, scope, capabilities and resource budgets, reserves capacity and grants a fenced compute attempt. It persists dispatch intent with the state change.
3. The provisioner selects a compatible warm sandbox or creates one using a durable intent. Unknown create outcomes enter reconciliation. Returned provider identity is recorded before lengthy readiness work where possible. Warm, creating and uncertain resources count toward limits.
4. The fresh supervisor enrolls, proves the prepared profile, materialises exact source/dependency inputs and injects scoped runtime credentials. Each slot has separate writable source, home, build/temp paths and ports; sensitive credentials require actual OS/sandbox isolation. Readiness is established by probes, not the provider's RUNNING label.
5. The supervisor accepts a stable launch operation, records it durably and starts the configured native session. It owns local IPC, tracks parent/children/process identities, spools logs and renews authority. Reconnecting the controller must not close agent stdin or spawn a duplicate session.
6. The worker checkpoints code and supported native session state, emits progress and submits immutable source/evidence. Initial submission validates its live compute lease and generation, then atomically transfers the result into coordinator-owned submission custody. An identical retry returns the stored result even after the compute lease has been released.
7. Independent checks and required reviewers execute remotely. They validate current submission/custody generations and exact inputs, using their own compute jobs. The coding slot can be cleaned up. Its lease expiry cannot reclaim submitted, qualifying or qualified work awaiting integration. Explicit revocation/reassignment must supersede custody transactionally.
8. Qualification records current evidence; implementation progress and assurance validity remain separate. Failures create attributable findings and repair work. Graph/signature agreement does not prove units, errors, ordering, authorisation or producer/consumer behaviour.
9. Integration builds and qualifies an exact candidate. The publication gateway checks current authority and expected target head. A lost Git response is reconciled before retry or replacement. Multiple repositories publish through per-target receipts and one release barrier; ordinary Git ref updates are not globally atomic.
10. Wave/programme closure evaluates its own dependency, review, semantic, documentation, cleanup and evidence obligations. It cannot be inferred from task count, process success or an optimistic summary. Later changes invalidate affected assurance and schedule new verification without rewriting historical receipts.

## 5. Storage, graph and event design

PostgreSQL is a proposed central authority, not a connection-string substitution. Live spec state, tasks, attempts, custody, leases, reservations, sandboxes, slots, sessions, findings, graph manifests, commands and evidence references need explicit relational constraints and transaction boundaries. Every authoritative operation returns a committed, idempotent result. No transaction remains open around a model call, provider request, build or Git push.

Read replicas serve appropriate observation and exact-version graph/context reads. A packet pins its complete source/spec/dependency/graph inputs in a consistent snapshot. Timeline-aware freshness checks or primary fallback prevent combining incompatible versions. Replicas never grant claims or publication. Bounded client pools and separate budgets protect lease/control traffic from graph ingestion and logs.

Graph parsing/indexing occurs remotely. Bounded staging, bulk loading and set-based resolution replace network-per-symbol patterns. Publication exposes complete immutable generations while partial staging remains invisible. SQLite FTS, Unicode/trigram behaviour, incremental invalidation, branch overlays and provenance require explicit parity fixtures. PostgreSQL speedup and batching choices require mixed-load measurements.

State changes and delivery obligations commit together. Consumers acknowledge pending committed records, deduplicate inbox identities and enforce revisions. A bare sequence high-water cursor can skip a later-committing lower sequence and is prohibited. Notifications only wake durable consumers. Retention gaps trigger resynchronisation; overflow cannot silently discard required evidence.

The authority tier requires qualified durability/failover fencing; restoring a backup introduces a non-reused deployment epoch and reconciliation of Git/provider effects. ObjectBox was assessed fairly: its server cluster can provide consensus, but eventual client synchronization is not the selected atomic fleet-claim contract. No database comparison benchmark has been performed.

## 6. Advisory decision models

[Decision-model research and contracts](decision-models.md) cover the exact requested Span-02, Jev 1.14 and D1 Ultra routes, capabilities, context/media/reasoning differences, billing and unknowns. Candidate uses include spec contradiction/coverage flags, context ranking, frontier profile advice, failure triage, review prioritisation and semantic risk signals. Existing Jev consumers and the distinct Solar Decide/Centra recap path require explicit migration.

The common path is bounded asynchronous typed advice with source/rubric/version provenance, capability validation, confidence calibration, deadlines, abstention and deterministic fallback. Models cannot grant ownership, suppress required review, prove correctness, close issues or authorise publication. Route-level egress policy excludes credentials and controls source disclosure. No winner or cost saving is asserted from vendor benchmarks; held-out historical evaluation and controlled live trials determine adoption.

## 7. Implementation and release strategy

The recommended deployment uses TypeScript control/provisioning services and pinned official provider SDKs, PostgreSQL and durable object storage, with existing C functionality retained behind a native CLI/MCP façade and remote supervisor seams. Dependencies are explicitly permitted. The service/driver/tool versions and HA hosting choices are qualification decisions, with interfaces frozen before dependent work.

The [task plan](implementation-plan.md) starts with a strict remotely executed qualification harness and dependency-enabled foundations, then storage/protocol/identity, graph and execution adapters, native connectors, assurance, migration/rebrand and advisory evaluation. Each bounded task has exact scope, dependencies, steps, future commands and evidence outputs. Registered component checks cannot satisfy full provider or campaign qualification.

Migration inventories actual SQLite columns as well as schema version, retains historical evidence, compares parity in an isolated destination, then quiesces and fences legacy writers before one authority cutover. Rollback after new distributed writes requires reconciliation/export, not pointing an old binary at stale SQLite. Existing config, data paths, hooks, MCP/editor integrations and historical identifiers have explicit compatibility treatment.

Qualification ramps through deterministic fault testing, independent provider tests, real native canaries, mixed graph/fleet load, 10/20 → 25/50 → 50/100 → 100/200 sandbox/remote-agent profiles, and real 48/72-hour campaigns. Every required account/auth/model capability must be evidenced. Main-host placement, failover/restore, stale worker publication, cleanup, documentation and release rollback are included. All of that work is future and UNRUN; this pack only authorises review until the user gives the implementation go-ahead.
