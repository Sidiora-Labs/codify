# Hyperfide implementation plan

**Approved implementation baseline on 2026-10-16. Per-task states below are historical planning states; native `spec.kvx` owns live bootstrap progress.**

This approved dependency graph contains 112 bounded implementation and qualification packages across 26 waves. It covers all 112 native acceptance clauses. The native KVX task sections are generated from [the versioned planning catalog](evidence/task-catalog.json); the IDs remain stable even when explicitly approved scope or dependency amendments revise the plan. Live native statuses and runtime metadata are never imported from historical catalog states. Each task initially owns one acceptance clause, and its concrete steps integrate the relevant cross-cutting contracts. A task can be implemented before full programme qualification, but its component receipts cannot claim a full acceptance case passed.

The implementation team must re-read the pinned current source and approved architecture at task start. Proposed paths describe intended ownership, including files that do not yet exist; they are not claims about shipped modules. Current source paths named by an integration task are edited only after approval. All builds, prerequisites, indexing, implementation, tests, reproductions, integration and qualification run remotely. The main server receives verified prebuilt outputs and performs supervision.

## How to execute the approved graph

1. Record the user-approved specification revision and unresolved deployment choices through the primary leader; resolve only choices required by the next stage. No authoring task or review receipt grants implementation approval.
2. Begin with task 27.1: use existing approved provider/remote-access tooling to create the first disposable remote workspace, recording its IDs, owner and expiry in a durable bootstrap ledger until the new inventory can adopt it. Bootstrap the fail-closed harness and independent checker there; the future Hyperfide provisioner is not a prerequisite for its own implementation. Its self-tests deliberately observe negative outcomes without requiring absent product components or paid credentials to pass. Task1.4 then applies approved policy/dependency/build boundaries.
3. Assign eligible packages to accountable feature/domain managers; the scheduler validates prerequisite milestones, scope, resource reservations and current authority. Wave numbers derive from the dependency DAG; changing them requires structural validation and cannot weaken dependencies.
4. Implement the exact component and registered assertions. Independent remote verification captures immutable receipts. A task whose implementation is ready but required live capability is unavailable remains unqualified with explicit BLOCKED evidence; its dependants do not silently proceed.
5. Assemble candidates and run full cross-component suites. Component variants are deliberately insufficient for programme qualification. Provider/account/native authentication and endurance claims require actual permitted live evidence.
6. Complete migration/rebrand, stage the live fleet, execute fault/recovery campaigns, close documentation, and reconstruct release readiness independently before production activation.

## Command and assertion contract

Every `verify_cmd` below describes its task verification interface. Actual execution and source-bound receipts are tracked independently; the planning descriptions below are not evidence of execution. `tests/hyperfide/qualify.py --case V-NNN --manifest tests/hyperfide/manifests/tasks/N.M.json` selects a **registered component variant** via the immutable manifest. Each variant declares exact assertion IDs and expected counts; unknown/missing/empty variants, credentials, fixtures, executables and required results fail nonzero. The harness never silently shrinks a V-case or substitutes a simulator for live evidence. A full-case/campaign manifest declares all assertions and provider/connector variants required by the [verification registry](verification.md). Each case selection emits a separate scope-qualified receipt. Task28.3 requires full-case evidence, including obligations that span multiple component tasks. Task28.4 establishes validated traceability before final closure; the checker qualifies itself against controlled packs before it seals the actual candidate inventory, avoiding a receipt that requires itself as an input.

Task27.1 owns core harness/schema/checker/registry files. Task1.4 takes serialized ownership of the evidence checker from task27.1 only to align canonical path ordering across runner and checker; inventory and content validation remain strict, with an actual file-prefix/directory regression. Later tasks add separate case-registration fragments and component probe files under their own paths; the harness discovers fragments deterministically and rejects duplicate/unknown IDs. This avoids concurrent writes to the central case registry. Its bootstrap command runs `selftest_harness.py` first, then the V-056 harness variant; it is meaningful only after those programs are implemented and cannot pass through file-existence checks.

## Ownership and integration seams

Control, provisioner and dispatch services share a pinned TypeScript codebase under `services/hyperfide/`; the compatible CLI and supervisor use C modules under `src/hyperfide/`. Protocol/storage/role records are frozen in task4.1 and expanded through versioned schema changes owned by the relevant component. Task1.4 owns initial package/build policy wiring, task25.3 owns the existing CLI/MCP/hook/editor/orchestrator façade retrofit, and task26.1/26.4 own later branding/generator integration. Task1.4 owns actual service entrypoints and the typed registration/build seams. Every later module owns a separate component fragment and must exercise the linked internal API or runner interface; task25.3 later wires existing public façades.  Shared-source edits outside a task's declared scope need an explicit additional dependency/owner, not an untracked concurrent patch. A new module still requires real entrypoint/build/service wiring and black-box integration evidence; compiling disconnected scaffolding is insufficient.

Each task owns its declared exact paths while active; same-wave overlap is forbidden. Serialized shared paths: services/hyperfide/src/components/registry.ts owned by 1.4 -> 4.2 -> 14.1; services/hyperfide/src/components/service.ts owned by 1.4 -> 14.1; Makefile owned by 1.4 -> 12.1 -> 25.3 -> 26.2; src/hyperfide/components/schema.kvx owned by 1.4 -> 12.1; scripts/hyperfide-native-components.py owned by 1.4 -> 12.1; src/hyperfide/component_main.c owned by 1.4 -> 25.3; src/hyperfide/components.h owned by 1.4 -> 25.3; scripts/install.sh owned by 26.1 -> 26.2; scripts/release.sh owned by 26.1 -> 26.2; src/spec.c owned by 25.3 -> 26.4. Other shared-source edits require explicit serialized ownership and dependencies before work starts.

The JSON catalog contains complete approved task paths, steps, commands, owners and artifact outputs. Scope amendments require one coordinator writer and matching native/catalog structure. Native task statuses and runtime metadata remain authoritative during bootstrap; rendering must preserve them. Ignored generated agent pointers are regenerated through the owning workflow and are not task1.4 tracked commit paths.

## Qualification stages and dependencies

| Stage | Tasks / exit |
|---|---|
| Remote foundations |27.1→1.4→schema/spec/identity/transaction modules; strict negative harness before component work.|
| Distributed core |Primary claims/leases, durable events, scoped packets, replica barriers and provider/runner contracts.|
| Integrated execution |Prepared source, isolated slots, real frontier connectors, artifact receipts, independent assurance and recovery.|
| Semantic/integration |Every-watcher/every-commit coverage, producer-consumer contracts, findings/GitHub, sole Git publication gateway and multi-repository release barrier.|
| Migration and product |Actual SQLite-shape import, single-authority cutover/rollback, old/new CLI/MCP/editor/offline parity and Hyperfide identity.|
| Advisory decisions |Three typed candidate adapters, migrated existing Jev/recap purposes, async fallback, temporally valid evaluation and controlled promotion.|
| Release qualification |27.2 deterministic replay→27.3 real-provider staged48/72-hour campaigns→27.4 combinedfaults→28.3 fullcurrent-evidence closure.|

These stages are workstream explanations; the exact predecessor list below determines scheduling. Campaign numbering S0–S7 in verification.md is independent from implementation wave numbers.

Live provider/model probes are explicit manifest variants. Deterministic contract fixtures qualify only the bounded component behavior they execute. An unavailable credential blocks a required live variant; it never silently selects a simulated variant. Early standalone auth probes precede connector integration, while actual renewal endurance belongs to the live campaign. Task25.2 rehearses cutover/rollback after the naming/client transition, before task27.3 begins expensive fleet endurance.

## Runtime and distribution integration ownership

Task4.2 composes initialized components with a bounded per-process resource container and explicit dependency capabilities. Task14.1 owns the authenticated coordinator HTTPS listener, versioned external protocol and service lifetime independent of stdin. It reuses the established dispatcher and resource container; remote messages cannot choose trusted actor identity, policy or capabilities.

Task12.1 owns the reusable native libcurl/TLS transport and extends the actual component build contract after the foundation. Task25.3 links nested native modules into the real public CLI/MCP entrypoints and reuses that transport. Task26.2 owns canonical executable, installer, release and uninstall integration after their explicit ownership predecessors. Each gate exercises actual process, socket, linked artifact or installed command behavior rather than disconnected helpers.

These are approved implementation assignments for existing requirements, not claims that the future listener, transport or distribution integration already exists. The detailed packets below carry the exact owned paths and dependencies.

## Wave index

### Wave 1 — 1 package

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 27.1 | Bootstrap strict qualification harness and independent receipt checker | qualification | Approval boundary only | V-056 |

### Wave 2 — 1 package

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 1.4 | Record approval policy and bootstrap dependency-enabled build boundaries | foundation | 27.1 | V-001, V-028 |

### Wave 3 — 3 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 4.1 | Create namespaced PostgreSQL authority schema and API record contracts | storage | 1.4 | V-002, V-015 |
| 8.1 | Define capability-aware provider interface and unsupported outcomes | providers | 1.4 | V-036, V-041 |
| 11.1 | Publish content-derived environment profiles without live identity | preparation | 1.4 | V-038, V-040 |

### Wave 4 — 4 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 2.1 | Import pinned run specifications with immutable revision identity | specification | 4.1 | V-001, V-024 |
| 4.2 | Implement bounded primary transaction gateway | storage | 4.1, 1.4 | V-002, V-011 |
| 10.1 | Build Blaxel coding images with qualified writable storage and mounts | blaxel | 8.1, 11.1 | V-038, V-039 |
| 15.2 | Store complete immutable artifacts with receipts and checksums | artifacts | 4.1 | V-012 |

### Wave 5 — 8 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 14.1 | Enroll role-scoped identities bound to intent and boot generation | identity | 4.1, 8.1, 4.2, 1.4 | V-015, V-040 |
| 15.1 | Publish attributable attempt source and recoverable workspace checkpoints | artifacts | 4.1, 11.1, 15.2 | V-012, V-043 |
| 2.2 | Validate cross-programme dependency graphs and explicit milestones | specification | 2.1 | V-001, V-024 |
| 3.1 | Register leader, manager, wave-package and execution role ownership | hierarchy | 2.1 | V-001, V-008 |
| 4.4 | Establish database migration, durability and old-primary fencing | storage | 4.2 | V-009, V-053 |
| 6.1 | Implement transactional pending outbox and committed delivery obligations | delivery | 4.2 | V-005 |
| 7.1 | Extract repository and workspace graph bundles remotely | graph | 4.1, 2.1 | V-018, V-020 |
| 25.1 | Inventory actual SQLite shapes and import historical state with provenance | migration | 4.1, 2.1, 15.2 | V-018, V-019, V-025 |

### Wave 6 — 11 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 12.1 | Register supervisor boots and isolate writable worker slots | runner | 14.1, 11.1, 1.4 | V-015, V-039 |
| 14.2 | Inject layered variables and rotate scoped credential references | identity | 14.1 | V-040 |
| 14.4 | Enforce scoped API, artifact, Git and model-egress authority | identity | 14.1, 15.2 | V-015, V-016, V-040 |
| 11.2 | Materialise exact source and keyed dependency caches | preparation | 11.1, 15.1 | V-038, V-039 |
| 1.1 | Enforce supervision-only main-host placement across all job classes | policy | 8.1, 3.1 | V-007, V-052 |
| 2.3 | Version task decomposition and active-run replanning | specification | 2.2 | V-001, V-014 |
| 2.4 | Register criterion-level proof obligations and permitted review rubrics | assurance | 2.2 | V-013, V-034 |
| 3.3 | Provide bounded leader and manager context views | hierarchy | 3.1, 2.2 | V-010, V-016 |
| 5.1 | Atomically admit task claims and capacity reservations | scheduler | 4.2, 2.2, 3.1 | V-002, V-007 |
| 6.2 | Implement inbox deduplication, revisions and replay-gap recovery | delivery | 6.1 | V-005, V-016 |
| 7.2 | Bulk-stage graph facts and resolve references in bounded batches | graph | 7.1, 4.2 | V-011, V-022 |

### Wave 7 — 8 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 9.1 | Implement Railway preparation, disk checkpoints and fresh restore enrollment | railway | 8.1, 11.1, 14.1, 12.1 | V-036, V-038, V-041 |
| 14.3 | Qualify account-session and API authentication modes separately | identity | 14.2 | V-040, V-042 |
| 20.1 | Implement typed Span, Jev1.14 and d1-ultra route adapters | decisions | 14.2, 1.4 | V-045 |
| 11.3 | Probe actual environment readiness before assignment | preparation | 11.2, 14.2 | V-036, V-038, V-039 |
| 3.2 | Build immutable scoped execution packets | hierarchy | 3.1, 2.4 | V-001, V-014 |
| 5.2 | Enforce monotonic generations and primary-clock leases | scheduler | 5.1 | V-003, V-004 |
| 5.4 | Replace fixed local slot/start limits with resource admission and fairness | scheduler | 5.1 | V-007, V-047 |
| 7.3 | Publish complete graph generations atomically | graph | 7.2 | V-021, V-022 |

### Wave 8 — 8 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 20.2 | Preserve output probability and confidence semantics with abstention | decisions | 20.1 | V-045 |
| 20.3 | Represent route-specific images, reasoning and actual billing | decisions | 20.1 | V-045 |
| 3.4 | Register native descendants and adopt valid work after manager replacement | hierarchy | 3.1, 5.2 | V-007, V-008 |
| 4.3 | Assemble consistent packets with topology-aware replica barriers | storage | 4.2, 3.2 | V-010, V-023 |
| 5.3 | Reconcile idempotent dispatch and uncertain external outcomes | scheduler | 5.2, 6.1, 1.1 | V-004, V-037 |
| 6.3 | Deliver generation-bound start, steering and cancellation instructions | delivery | 6.2, 5.2, 14.1 | V-006 |
| 8.2 | Implement pool inventory and separately qualified account quotas | providers | 8.1, 5.4 | V-007, V-036 |
| 15.3 | Adopt stale-attempt artifacts without restoring stale authority | artifacts | 15.1, 15.2, 5.2 | V-003, V-014, V-043 |

### Wave 9 — 8 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 6.4 | Recover durable dispatch after controller restart | delivery | 6.2, 14.1, 6.3 | V-005, V-008 |
| 20.4 | Run decision jobs asynchronously with deadlines and safe fallback | decisions | 20.2, 20.3, 6.2 | V-045, V-011 |
| 1.2 | Expose one human programme interface through primary leader | policy | 3.1, 6.3 | V-001, V-008 |
| 7.4 | Port graph query and search semantics with differential parity | graph | 7.3, 4.3 | V-020, V-021, V-025, V-048 |
| 8.4 | Implement authenticated cross-pool connectivity and compatible relocation | providers | 8.2, 14.1 | V-036, V-049 |
| 9.2 | Apply complete Railway runtime profiles for every launch | railway | 9.1, 8.2 | V-036, V-038 |
| 10.2 | Apply explicit Blaxel process and sandbox lifetime controls | blaxel | 10.1, 8.2 | V-036, V-041 |
| 12.2 | Persist local start ledger and own agent IPC across reconnects | runner | 12.1, 6.3 | V-006, V-041, V-043 |

### Wave 10 — 6 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 8.3 | Persist provisioning intents and quarantine ambiguous or orphan resources | providers | 8.2, 5.3, 6.4, 14.1 | V-037, V-054 |
| 21.1 | Add advisory clause critique with validated change proposals | decisions | 20.4, 2.3 | V-045, V-024 |
| 21.4 | Persist complete decision audit records and eventual outcomes | decisions | 20.4, 15.2 | V-045, V-014 |
| 9.3 | Track Railway durable sessions, logs and process termination | railway | 9.2, 12.2, 15.2 | V-039, V-041 |
| 12.3 | Observe process trees, useful progress and resource usage separately | runner | 12.2, 3.4 | V-007, V-044 |
| 13.1 | Implement pinned Claude Code and Codex connector capability profiles | connectors | 12.2, 14.3 | V-042 |

### Wave 11 — 11 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 10.3 | Reconcile Blaxel create-or-get and recover process streams | blaxel | 10.2, 12.2, 8.3 | V-037, V-041 |
| 11.4 | Schedule remote preparation and eligible-work-driven prewarming | preparation | 11.1, 5.4, 8.3, 1.1 | V-007, V-038 |
| 15.4 | Implement reference-safe retention, garbage collection and destruction gates | artifacts | 15.2, 8.3 | V-012, V-054 |
| 16.1 | Submit immutable worker results and dispatch independent qualification | assurance | 2.4, 5.2, 15.2, 12.2, 6.4, 8.3, 14.4, 11.3, 13.1, 3.2 | V-013, V-034 |
| 22.1 | Build temporally valid labelled evaluation datasets | evaluation | 21.4 | V-046 |
| 1.3 | Apply qualified frontier assignment policy and user model aliases | policy | 13.1, 5.4 | V-042, V-044 |
| 9.4 | Reconcile Railway API edge cases and qualify actual account lifecycle | railway | 9.3, 8.3, 8.4 | V-036, V-037, V-041 |
| 12.4 | Implement runner pause, drain, cancel and verified stop | runner | 12.3, 15.2 | V-006, V-017 |
| 13.2 | Persist native session lineage and source-linked checkpoints | connectors | 13.1, 15.1 | V-042, V-043 |
| 13.4 | Integrate native quotas, permission profiles and autonomous escalation | connectors | 13.1, 5.4 | V-007, V-042, V-044 |
| 23.2 | Account for distinct infrastructure and model resource dimensions | observability | 5.4, 8.2, 12.3 | V-007, V-048 |

### Wave 12 — 5 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 10.4 | Gate Blaxel preview capabilities and qualify fresh-identity recovery | blaxel | 10.3, 14.1, 15.3 | V-040, V-041 |
| 16.2 | Reject false qualification from missing checks and legacy force paths | assurance | 16.1, 27.1 | V-013, V-056 |
| 17.1 | Discover every commit and enforce the full watcher obligation matrix | review | 16.1, 13.1 | V-031 |
| 22.2 | Measure calibrated quality, latency and billed cost against baseline | evaluation | 22.1, 20.3 | V-046 |
| 13.3 | Recover transport and process loss with explicit context outcomes | connectors | 13.2, 15.3 | V-043, V-044 |

### Wave 13 — 3 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 16.3 | Record clause evidence and policy-limited independent review judgements | assurance | 16.2, 2.4 | V-013, V-034 |
| 21.2 | Rank policy-permitted recovery actions from preserved failure packets | decisions | 20.4, 13.4, 16.2 | V-045, V-044 |
| 24.1 | Recover supervisory desired state and bounded offline continuation | recovery | 6.4, 3.4, 13.3 | V-008, V-043 |

### Wave 14 — 4 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 16.4 | Invalidate affected assurance while retaining task history | assurance | 16.3, 7.3 | V-014, V-034 |
| 17.2 | Build producer-consumer contracts and behavioural impact analysis | review | 7.4, 16.3 | V-029, V-034 |
| 18.1 | Implement canonical findings and provenance-preserving deduplication | findings | 16.3, 3.1 | V-032 |
| 24.2 | Recover lost sandboxes and processes with fenced compatible replacement | recovery | 24.1, 8.4, 15.3 | V-004, V-041, V-049 |

### Wave 15 — 9 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 17.3 | Persist revision-specific review receipts and invalidate stale conclusions | review | 17.1, 17.2, 16.4 | V-031, V-034 |
| 17.4 | Dispatch remote reproductions and contract/system qualification jobs | review | 17.2, 16.2, 11.3 | V-029, V-030, V-052 |
| 18.2 | Project findings to GitHub with ten-minute reconciliation | findings | 18.1, 6.2, 14.2 | V-032 |
| 18.3 | Route findings through revision, attempt and current accountable manager | findings | 18.1, 3.4 | V-032, V-008 |
| 21.3 | Rank eligible frontier profiles, optional context and review/finding advice | decisions | 20.4, 5.4, 18.1, 17.2 | V-045 |
| 23.1 | Expose desired/observed fleet state, evidence and critical paths | observability | 3.3, 5.4, 16.4 | V-010, V-034 |
| 23.3 | Instrument lifecycle, graph freshness, recovery and qualified outcome cost | observability | 6.4, 7.3, 16.4, 21.4 | V-011, V-048 |
| 25.3 | Route CLI, MCP, editor, hooks and offline workflows through authority modes | migration | 4.3, 6.3, 16.4, 2.1, 12.2, 14.1, 12.1, 1.4 | V-019, V-027, V-028 |
| 24.3 | Implement scoped pause, drain, cancel and fleet stop controllers | recovery | 12.4, 24.2, 15.4 | V-017, V-054 |

### Wave 16 — 4 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 18.4 | Close findings only after fenced repair and recorded resolution proof | findings | 18.3, 16.4 | V-032, V-034 |
| 22.3 | Run shadow evaluation then bounded controlled decision trials | evaluation | 22.2, 21.1, 21.2, 21.3 | V-046 |
| 23.4 | Deliver bounded actionable notifications and durable evidence links | observability | 23.1, 6.2 | V-016, V-048 |
| 25.4 | Build reproducible releases and deploy prebuilt services in compatibility order | deployment | 25.3, 4.4, 12.4, 13.4, 1.1 | V-028, V-052, V-055 |

### Wave 17 — 3 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 19.1 | Build immutable multi-repository integration candidates remotely | integration | 16.4, 17.4, 18.4 | V-030, V-034 |
| 22.4 | Gate decision promotion, drift rollback and optional Span self-hosting | evaluation | 22.3 | V-045, V-046 |
| 26.1 | Apply Hyperfide identity to owned product and distribution surfaces | branding | 25.4 | V-026, V-028 |

### Wave 18 — 2 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 19.2 | Enforce sole protected-target publication gateway and CAS reconciliation | integration | 19.1, 14.4, 5.2 | V-033 |
| 26.2 | Ship canonical hyperfide entrypoint with explicit cg compatibility policy | branding | 26.1, 25.3 | V-026, V-028 |

### Wave 19 — 2 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 19.3 | Evaluate task, wave and programme closure against required milestones | integration | 19.2, 16.3, 18.4 | V-034 |
| 26.3 | Migrate config, directories and variable aliases with backups and conflict checks | branding | 26.2, 25.1 | V-026, V-055 |

### Wave 20 — 2 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 19.4 | Publish explicit partial outcomes behind multi-repository release barrier | integration | 19.2, 19.3 | V-030, V-033 |
| 26.4 | Regenerate owned guidance and verify old/new integration parity | branding | 26.3, 25.3 | V-026, V-027 |

### Wave 21 — 3 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 25.2 | Rehearse single-authority cutover and separate rollback boundaries | migration | 25.1, 7.4, 4.4, 24.3, 26.4, 25.4 | V-019, V-028, V-055 |
| 24.4 | Exercise operational recovery runbooks and declared RPO/RTO | recovery | 24.3, 4.4, 19.4 | V-009, V-049, V-053 |
| 27.2 | Replay deterministic large-spec, mixed-graph and 1500-session schedules | qualification | 5.4, 7.4, 23.4, 24.3, 19.4 | V-024, V-047, V-048, V-049 |

### Wave 22 — 1 package

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 27.3 | Qualify both live providers and native agents through staged48/72-hour fleet campaigns | qualification | 27.2, 9.4, 10.4, 13.4, 11.4, 19.4, 23.3, 24.4, 22.4, 26.4, 1.2, 1.3, 14.4, 17.3, 18.2, 25.2 | V-036, V-037, V-038, V-039, V-040, V-041, V-042, V-043, V-044, V-045, V-046, V-050, V-051, V-052 |

### Wave 23 — 2 packages

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 27.4 | Run composite fault qualification and independent invariant reconstruction | qualification | 27.3, 24.4, 19.4 | V-002, V-003, V-004, V-005, V-009, V-010, V-012, V-015, V-016, V-017, V-033, V-037, V-040, V-049, V-053, V-054 |
| 28.1 | Publish operational documentation from qualified implementation interfaces | documentation | 26.4, 27.3 | V-028, V-035, V-052, V-055 |

### Wave 24 — 1 package

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 28.2 | Persist deterministic documentation closure snapshots and receipts | documentation | 28.1, 19.3, 15.2 | V-035 |

### Wave 25 — 1 package

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 28.4 | Retain requirements, decisions, source evidence and implementation traceability | release | 27.4, 28.2, 25.2, 19.4, 15.4 | V-024, V-034, V-056 |

### Wave 26 — 1 package

| Task | Deliverable | Owner | Requires | Cases |
|---|---|---|---|---|
| 28.3 | Assemble independent release readiness and complete closure evidence | release | 27.4, 28.2, 25.2, 19.4, 15.4, 28.4 | V-034, V-053, V-054, V-055, V-056 |

## Detailed implementation packets

The catalog is the versioned planning source. Per-task states below describe the initial planning baseline; native KVX owns live bootstrap progress. Paths describe approved task ownership, including future files. Verification commands are interfaces whose actual execution and receipts are tracked separately.

### Task 27.1 — Bootstrap strict qualification harness and independent receipt checker

Planning baseline pending · wave 1 · owner `qualification` · clause `27.1`

Requires: user approval only.

1. Bootstrap the first disposable remote workspace through an existing approved provider SDK/CLI or remote-access tool, before Hyperfide adapters exist. Record resource IDs/credentials references/owner/expiry in a durable bootstrap ledger; edit/build/execute the harness remotely, verify cleanup, and import surviving resources into Hyperfide inventory when available. No bootstrap build or implementation runs on the supervision host.
2. Implement registered case/variant manifests, exact assertion inventories and append-only evidence receipts; bootstrap its own negative self-tests without product/cloud prerequisites.
3. Reject absent or unknown selectors, zero assertions, missing required fixtures/credentials, failed children and unresolved cleanup; self-tests assert these failures rather than treating absence as success.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `tests/hyperfide/qualify.py`, `tests/hyperfide/manifests/tasks/27.1.json`, `tests/hyperfide/check-evidence.py`, `tests/hyperfide/registry.json`, `tests/hyperfide/selftest_harness.py`, `tests/hyperfide/manifest.schema.json`, `tests/hyperfide/cases/tasks/27_1.py`, `tests/hyperfide/registrations/27.1.json`, `tests/hyperfide/bootstrap-contract.md`.

Verification interface:

```sh
python3 tests/hyperfide/selftest_harness.py && python3 tests/hyperfide/qualify.py --case V-056 --manifest tests/hyperfide/manifests/tasks/27.1.json
```

Outputs: `artifacts/hyperfide/tasks/27.1/manifest.json`, `artifacts/hyperfide/tasks/27.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 1.4 — Record approval policy and bootstrap dependency-enabled build boundaries

Planning baseline pending · wave 2 · owner `foundation` · clause `1.4`

Requires: 27.1.

1. Implement approved run-policy revision and inactive/unapproved refusal; supersede the local single-binary/dependency restrictions through their owning workflow source only after user approval.
2. Establish pinned TypeScript/native build inputs and control/provisioner/dispatch process boundaries; prove an unapproved programme cannot activate or dispatch.
3. Create real control/provisioner/dispatch entrypoints and a versioned per-component registration/build contract. Each later module task contributes its own explicit registration fragment and exercises the resulting internal service or runner interface; existing public CLI/MCP/editor wiring is completed by task25.3. Reject duplicate component IDs, unsupported schemas and missing linked modules.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/policy/programme.ts`, `tests/hyperfide/manifests/tasks/1.4.json`, `spec/workflow.kvx`, `Makefile`, `services/hyperfide/package.json`, `services/hyperfide/package-lock.json`, `services/hyperfide/tsconfig.json`, `tests/hyperfide/cases/tasks/1_4.py`, `tests/hyperfide/registrations/1.4.json`, `services/hyperfide/src/control.ts`, `services/hyperfide/src/provisioner.ts`, `services/hyperfide/src/dispatch.ts`, `services/hyperfide/src/components/registry.ts`, `services/hyperfide/components/schema.json`, `src/hyperfide/components/schema.kvx`, `services/hyperfide/src/components/service.ts`, `services/hyperfide/components/1.4.json`, `spec/hyperfide/tools/render_native.py`, `spec/hyperfide/tools/validate_pack.py`, `spec/hyperfide/README.md`, `spec/hyperfide/requirements.md`, `spec/hyperfide/implementation-plan.md`, `spec/hyperfide/traceability.md`, `spec/hyperfide/privacy.md`, `spec/hyperfide/decisions.md`, `spec/hyperfide/evidence/traceability.json`, `scripts/hyperfide-native-components.py`, `src/hyperfide/components.h`, `src/hyperfide/component_main.c`, `spec/hyperfide/spec.kvx`, `spec/hyperfide/evidence/task-catalog.json`, `.gitignore`, `tests/hyperfide/check-evidence.py`, `spec/hyperfide/evidence/implementation-validation.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/1.4.json && python3 tests/hyperfide/qualify.py --case V-028 --manifest tests/hyperfide/manifests/tasks/1.4.json
```

Outputs: `artifacts/hyperfide/tasks/1.4/manifest.json`, `artifacts/hyperfide/tasks/1.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 4.1 — Create namespaced PostgreSQL authority schema and API record contracts

Planning baseline pending · wave 3 · owner `storage` · clause `4.1`

Requires: 1.4.

1. Create versioned keys, constraints and records for run/spec/task/attempt/lease/pool/reservation/sandbox/slot/session/graph/finding/evidence/publication entities.
2. Exercise duplicate identities, foreign-run references and invalid source/artifact relationships; preserve Git and object storage as separate payload authorities.
3. Define submitted-result custody as a separate versioned authority record: immutable submission ID, source attempt/generation, custody generation/state and independent qualification outcome. Constrain at most one active custody per task and include requalification and publication-operation records.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/storage/schema.ts`, `tests/hyperfide/manifests/tasks/4.1.json`, `services/hyperfide/migrations/0001-authority.sql`, `services/hyperfide/src/contracts/records.ts`, `tests/hyperfide/cases/tasks/4_1.py`, `tests/hyperfide/registrations/4.1.json`, `services/hyperfide/components/4.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-002 --manifest tests/hyperfide/manifests/tasks/4.1.json && python3 tests/hyperfide/qualify.py --case V-015 --manifest tests/hyperfide/manifests/tasks/4.1.json
```

Outputs: `artifacts/hyperfide/tasks/4.1/manifest.json`, `artifacts/hyperfide/tasks/4.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 8.1 — Define capability-aware provider interface and unsupported outcomes

Planning baseline pending · wave 3 · owner `providers` · clause `8.1`

Requires: 1.4.

1. Define pinned prepare/create/list/observe/attach/execute/stop/transfer/lifetime/destroy interfaces and typed unknown/error outcomes.
2. Validate required capabilities before placement; unsupported stdin/snapshot/network/storage features fail explicitly rather than degrade task requirements.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/contract.ts`, `tests/hyperfide/manifests/tasks/8.1.json`, `tests/hyperfide/cases/tasks/8_1.py`, `tests/hyperfide/registrations/8.1.json`, `services/hyperfide/components/8.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/8.1.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/8.1.json
```

Outputs: `artifacts/hyperfide/tasks/8.1/manifest.json`, `artifacts/hyperfide/tasks/8.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 11.1 — Publish content-derived environment profiles without live identity

Planning baseline pending · wave 3 · owner `preparation` · clause `11.1`

Requires: 1.4.

1. Pin OS/architecture/toolchains/lock inputs/native CLIs/runner versions and required capabilities in content-derived preparation manifests.
2. Scan designated canary identities/secrets and active leases from candidate bases; changed recipe/toolchain/locks produce a distinct preparation identity.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/preparation/manifests.ts`, `tests/hyperfide/manifests/tasks/11.1.json`, `tests/hyperfide/cases/tasks/11_1.py`, `tests/hyperfide/registrations/11.1.json`, `services/hyperfide/components/11.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/11.1.json && python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/11.1.json
```

Outputs: `artifacts/hyperfide/tasks/11.1/manifest.json`, `artifacts/hyperfide/tasks/11.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 2.1 — Import pinned run specifications with immutable revision identity

Planning baseline pending · wave 4 · owner `specification` · clause `2.1`

Requires: 4.1.

1. Import KVX criteria, task identities, repositories, allowed actions and closure policy into one pinned run revision; export revision-labelled KVX projections.
2. Reject stale projection writes and preserve declared legacy status as history; load both large fixtures without treating declarations as runtime proof.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/spec/import.ts`, `tests/hyperfide/manifests/tasks/2.1.json`, `tests/hyperfide/cases/tasks/2_1.py`, `tests/hyperfide/registrations/2.1.json`, `services/hyperfide/components/2.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/2.1.json && python3 tests/hyperfide/qualify.py --case V-024 --manifest tests/hyperfide/manifests/tasks/2.1.json
```

Outputs: `artifacts/hyperfide/tasks/2.1/manifest.json`, `artifacts/hyperfide/tasks/2.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 4.2 — Implement bounded primary transaction gateway

Planning baseline pending · wave 4 · owner `storage` · clause `4.2`

Requires: 4.1, 1.4.

1. Build pooled short-transaction APIs for authoritative operations with explicit deadlines, deadlock retry and current-state validation.
2. Separate replica candidate discovery from primary decisions; hold no database lock across agent or provider execution and expose overload reasons.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Own the long-lived per-process shared resource container: bounded primary/replica PostgreSQL pools with service-specific credentials, transaction capability handles, listener connections where needed, cancellation and deterministic shutdown. Components must reuse this container rather than create hidden independent global pools.
5. Extend the established component registry through an explicit task1.4-to4.2 ownership transfer. Resolve declared same-role dependency capabilities against initialized component instances, reject missing or role-incompatible dependencies before readiness, and dispose dependants before shared resources. Preserve control/provisioner/dispatch process separation; cross-role work remains durable queue/API communication.
6. Exercise at least two registered components through the actual service dispatcher using the same process-owned PostgreSQL resources; verify bounded connection use, shared committed state and shutdown. Direct helper tests alone do not establish runtime composition.
7. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/storage/transactions.ts`, `tests/hyperfide/manifests/tasks/4.2.json`, `tests/hyperfide/cases/tasks/4_2.py`, `tests/hyperfide/registrations/4.2.json`, `services/hyperfide/components/4.2.json`, `services/hyperfide/src/storage/runtime.ts`, `services/hyperfide/src/components/registry.ts`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-002 --manifest tests/hyperfide/manifests/tasks/4.2.json && python3 tests/hyperfide/qualify.py --case V-011 --manifest tests/hyperfide/manifests/tasks/4.2.json
```

Outputs: `artifacts/hyperfide/tasks/4.2/manifest.json`, `artifacts/hyperfide/tasks/4.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 10.1 — Build Blaxel coding images with qualified writable storage and mounts

Planning baseline pending · wave 4 · owner `blaxel` · clause `10.1`

Requires: 8.1, 11.1.

1. Retain sandbox API and compilers/build tools, disable incompatible slimming and size RAM-backed writable overlays versus persistent volumes.
2. Test mount-over-preloaded paths and pnpm/uv-style symlink/hardlink templates; validate actual toolchains and package resolution after mounting.
3. Separate deterministic image/storage contract probes from actual image creation/mount/toolchain probes. Real-provider acceptance requires an approved small live manifest with actual package resolution; a simulator receipt cannot satisfy it.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/blaxel/images.ts`, `tests/hyperfide/manifests/tasks/10.1.json`, `tests/hyperfide/cases/tasks/10_1.py`, `tests/hyperfide/registrations/10.1.json`, `services/hyperfide/components/10.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/10.1.json && python3 tests/hyperfide/qualify.py --case V-039 --manifest tests/hyperfide/manifests/tasks/10.1.json
```

Outputs: `artifacts/hyperfide/tasks/10.1/manifest.json`, `artifacts/hyperfide/tasks/10.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 14.1 — Enroll role-scoped identities bound to intent and boot generation

Planning baseline pending · wave 5 · owner `identity` · clause `14.1`

Requires: 4.1, 8.1, 4.2, 1.4.

1. Keep provider administration credentials only in provisioner scope; exchange one-use/controlled bootstrap grants bound to provisioning intent/boot for runner identity.
2. Replay enrollment from another sandbox/generation and forge role events; server-side authority rejects access independently of model text.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Own the authenticated coordinator HTTPS listener and persistent daemon lifecycle. Transfer components/service.ts from task1.4 and components/registry.ts from task4.2 before editing them; reuse handleRequest and the initialized registry/shared resources rather than create another dispatcher. Bind readiness to successful policy, resource, component and listener initialization; shut down listeners and background workers before shared resources.
5. Validate TLS server identity, bounded request/response sizes, deadlines, concurrent request admission and the versioned external protocol envelope. Explicitly map operation identity, idempotency key, payload digest, correlation/causation and expected-version fields to internal dispatch; a JSONL correlation id is not durable idempotency.
6. Bind an immutable trusted actor/run/role/attempt context to each invocation after authentication. Wire payloads cannot select or replace identity, startup policy or shared resource capabilities. Limit unauthenticated enrollment to valid scoped bootstrap grants; deny non-granted remote operations by default and provide the later task14.4 authorization module an explicit middleware/capability hook. Local stdio access must not bypass remote identity requirements.
7. Run the listener in an explicit service mode whose lifetime does not depend on stdin remaining open. Qualify real separate-process HTTPS enrollment and authenticated requests, malformed/wrong-peer/wrong-scope requests, startup failure and orderly termination using designated test credentials only.
8. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/identity/enrollment.ts`, `tests/hyperfide/manifests/tasks/14.1.json`, `tests/hyperfide/cases/tasks/14_1.py`, `tests/hyperfide/registrations/14.1.json`, `services/hyperfide/components/14.1.json`, `services/hyperfide/src/transport/http.ts`, `services/hyperfide/src/transport/protocol.ts`, `services/hyperfide/src/components/service.ts`, `services/hyperfide/src/components/registry.ts`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-015 --manifest tests/hyperfide/manifests/tasks/14.1.json && python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/14.1.json
```

Outputs: `artifacts/hyperfide/tasks/14.1/manifest.json`, `artifacts/hyperfide/tasks/14.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 15.2 — Store complete immutable artifacts with receipts and checksums

Planning baseline pending · wave 4 · owner `artifacts` · clause `15.2`

Requires: 4.1.

1. Implement content-addressed/immutable objects, chunk sequences, completeness manifests, upload receipts, retention classes and database registrations.
2. Crash between upload/registration and corrupt/truncate/replay chunks; incomplete provider backfill or missing objects cannot become accepted complete evidence.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/artifacts/objects.ts`, `tests/hyperfide/manifests/tasks/15.2.json`, `tests/hyperfide/cases/tasks/15_2.py`, `tests/hyperfide/registrations/15.2.json`, `services/hyperfide/components/15.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-012 --manifest tests/hyperfide/manifests/tasks/15.2.json
```

Outputs: `artifacts/hyperfide/tasks/15.2/manifest.json`, `artifacts/hyperfide/tasks/15.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 15.1 — Publish attributable attempt source and recoverable workspace checkpoints

Planning baseline pending · wave 5 · owner `artifacts` · clause `15.1`

Requires: 4.1, 11.1, 15.2.

1. Create immutable source/checkpoint manifests preserving repository identity, attempt branches, committed/uncommitted changes, session references and dependency/environment inputs.
2. Lose a sandbox after a dirty checkpoint and reuse branch names across repositories; verify source identity and complete recovery envelope rather than names alone.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/checkpoint.c`, `tests/hyperfide/manifests/tasks/15.1.json`, `tests/hyperfide/cases/tasks/15_1.py`, `tests/hyperfide/registrations/15.1.json`, `src/hyperfide/components/15.1.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-012 --manifest tests/hyperfide/manifests/tasks/15.1.json && python3 tests/hyperfide/qualify.py --case V-043 --manifest tests/hyperfide/manifests/tasks/15.1.json
```

Outputs: `artifacts/hyperfide/tasks/15.1/manifest.json`, `artifacts/hyperfide/tasks/15.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 2.2 — Validate cross-programme dependency graphs and explicit milestones

Planning baseline pending · wave 5 · owner `specification` · clause `2.2`

Requires: 2.1.

1. Validate unknown references, cycles, contradictory scope ownership and wave constraints using fully qualified feature/programme/repository identities.
2. Emit concrete cycle paths and prose-reference diagnostics; distinguish qualified-revision dependencies from integrated-target dependencies.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/spec/dependencies.ts`, `tests/hyperfide/manifests/tasks/2.2.json`, `tests/hyperfide/cases/tasks/2_2.py`, `tests/hyperfide/registrations/2.2.json`, `services/hyperfide/components/2.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/2.2.json && python3 tests/hyperfide/qualify.py --case V-024 --manifest tests/hyperfide/manifests/tasks/2.2.json
```

Outputs: `artifacts/hyperfide/tasks/2.2/manifest.json`, `artifacts/hyperfide/tasks/2.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 3.1 — Register leader, manager, wave-package and execution role ownership

Planning baseline pending · wave 5 · owner `hierarchy` · clause `3.1`

Requires: 2.1.

1. Implement leader epochs, accountable manager packages, wave allocations and distinct worker/reviewer/integrator roles.
2. Expose stable cross-wave manager ownership as proposed selectable policy; retain explicit wave-based manager allocation and auditable handoff.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/hierarchy/packages.ts`, `tests/hyperfide/manifests/tasks/3.1.json`, `tests/hyperfide/cases/tasks/3_1.py`, `tests/hyperfide/registrations/3.1.json`, `services/hyperfide/components/3.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/3.1.json && python3 tests/hyperfide/qualify.py --case V-008 --manifest tests/hyperfide/manifests/tasks/3.1.json
```

Outputs: `artifacts/hyperfide/tasks/3.1/manifest.json`, `artifacts/hyperfide/tasks/3.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 4.4 — Establish database migration, durability and old-primary fencing

Planning baseline pending · wave 5 · owner `storage` · clause `4.4`

Requires: 4.2.

1. Implement checksummed schema migration coordination, authority epoch bootstrap and configurable acknowledged-write durability outside the main failure domain.
2. Exercise primary loss and old-primary isolation before reopening writes; document and test backup retention/RPO assumptions instead of assuming async replication is lossless.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/storage/durability.ts`, `tests/hyperfide/manifests/tasks/4.4.json`, `tests/hyperfide/cases/tasks/4_4.py`, `tests/hyperfide/registrations/4.4.json`, `services/hyperfide/components/4.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-009 --manifest tests/hyperfide/manifests/tasks/4.4.json && python3 tests/hyperfide/qualify.py --case V-053 --manifest tests/hyperfide/manifests/tasks/4.4.json
```

Outputs: `artifacts/hyperfide/tasks/4.4/manifest.json`, `artifacts/hyperfide/tasks/4.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 6.1 — Implement transactional pending outbox and committed delivery obligations

Planning baseline pending · wave 5 · owner `delivery` · clause `6.1`

Requires: 4.2.

1. Commit state changes with pending delivery records, persist acknowledgement and retry metadata and dispatch only committed obligations.
2. Invert commit order after sequence allocation; prove a late lower sequence cannot be skipped by a higher consumer cursor.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/events/outbox.ts`, `tests/hyperfide/manifests/tasks/6.1.json`, `tests/hyperfide/cases/tasks/6_1.py`, `tests/hyperfide/registrations/6.1.json`, `services/hyperfide/components/6.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-005 --manifest tests/hyperfide/manifests/tasks/6.1.json
```

Outputs: `artifacts/hyperfide/tasks/6.1/manifest.json`, `artifacts/hyperfide/tasks/6.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 7.1 — Extract repository and workspace graph bundles remotely

Planning baseline pending · wave 5 · owner `graph` · clause `7.1`

Requires: 4.1, 2.1.

1. Key extraction by repository/tree or named overlay, parser/config version and generation; emit remotely produced graph bundles with provenance.
2. Reject cross-branch identity mixing and label optional local caches non-authoritative; preserve current source/body/comment extraction coverage.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/graph/extraction.ts`, `tests/hyperfide/manifests/tasks/7.1.json`, `src/scan.c`, `tests/hyperfide/cases/tasks/7_1.py`, `tests/hyperfide/registrations/7.1.json`, `services/hyperfide/components/7.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-018 --manifest tests/hyperfide/manifests/tasks/7.1.json && python3 tests/hyperfide/qualify.py --case V-020 --manifest tests/hyperfide/manifests/tasks/7.1.json
```

Outputs: `artifacts/hyperfide/tasks/7.1/manifest.json`, `artifacts/hyperfide/tasks/7.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 12.1 — Register supervisor boots and isolate writable worker slots

Planning baseline pending · wave 6 · owner `runner` · clause `12.1`

Requires: 14.1, 11.1, 1.4.

1. Register boot/capability/preparation/slot inventory and allocate separate worktree/build/home/temp/ports with explicit security isolation profiles.
2. Run colliding builds and credential-sensitive jobs; separate worktrees are not accepted as an OS boundary and unsafe co-location is refused.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Own a reusable native HTTPS transport linked against libcurl with a qualified TLS backend. Transfer Makefile and the native component link/build contract from task1.4 after its foundation work is complete before extending them; declare libcurl headers, libraries, TLS backend and runtime dependency versions in the remote build/preparation manifests. Do not implement TLS through shell-command interpolation or relax certificate/hostname verification.
5. Extend the actual scripts/hyperfide-native-components.py build helper alongside Makefile and the native fragment schema. Its validated component source/header/library declarations must support the shared libcurl transport and export a source/link contract usable by the later public CLI build, while excluding duplicate standalone-main definitions.
6. Implement outbound bootstrap enrollment, supervisor registration, heartbeat and reconnect against task14.1 coordinator HTTPS operations. Enforce explicit endpoint identity, request deadlines, bounded response handling, credential rotation and conservative reconnect/backoff. Sandboxes receive no general PostgreSQL credentials.
7. Connect the real supervisor process lifecycle to authenticated network registration and slot inventory, using server-returned identity and current boot generation. Prove correct-server success and wrong-certificate/wrong-host/revoked-token failure over actual sockets in a remote disposable fixture.
8. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/supervisor.c`, `tests/hyperfide/manifests/tasks/12.1.json`, `tests/hyperfide/cases/tasks/12_1.py`, `tests/hyperfide/registrations/12.1.json`, `src/hyperfide/components/12.1.kvx`, `src/hyperfide/transport.c`, `src/hyperfide/transport.h`, `Makefile`, `src/hyperfide/components/schema.kvx`, `scripts/hyperfide-native-components.py`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-015 --manifest tests/hyperfide/manifests/tasks/12.1.json && python3 tests/hyperfide/qualify.py --case V-039 --manifest tests/hyperfide/manifests/tasks/12.1.json
```

Outputs: `artifacts/hyperfide/tasks/12.1/manifest.json`, `artifacts/hyperfide/tasks/12.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 14.2 — Inject layered variables and rotate scoped credential references

Planning baseline pending · wave 6 · owner `identity` · clause `14.2`

Requires: 14.1.

1. Implement distinct image/build/runtime/process layers, secret-reference resolution, designated-canary redaction and revoke/rotate protocols.
2. Race refresh writers and split secrets across chunks; dependency hooks/other slots cannot read forbidden secrets, and reusable images/packets/logs contain no live credentials.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/identity/credentials.ts`, `tests/hyperfide/manifests/tasks/14.2.json`, `tests/hyperfide/cases/tasks/14_2.py`, `tests/hyperfide/registrations/14.2.json`, `services/hyperfide/components/14.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/14.2.json
```

Outputs: `artifacts/hyperfide/tasks/14.2/manifest.json`, `artifacts/hyperfide/tasks/14.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 14.4 — Enforce scoped API, artifact, Git and model-egress authority

Planning baseline pending · wave 6 · owner `identity` · clause `14.4`

Requires: 14.1, 15.2.

1. Apply role/run/attempt policies to controller operations, artifact namespaces and permitted decision destinations; isolate protected Git credentials from workers.
2. Attempt cross-run access, stale overwrite, repository/log prompt injection and disallowed model fallback; reject all authority expansion through untrusted content.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/identity/authorization.ts`, `tests/hyperfide/manifests/tasks/14.4.json`, `tests/hyperfide/cases/tasks/14_4.py`, `tests/hyperfide/registrations/14.4.json`, `services/hyperfide/components/14.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-015 --manifest tests/hyperfide/manifests/tasks/14.4.json && python3 tests/hyperfide/qualify.py --case V-016 --manifest tests/hyperfide/manifests/tasks/14.4.json && python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/14.4.json
```

Outputs: `artifacts/hyperfide/tasks/14.4/manifest.json`, `artifacts/hyperfide/tasks/14.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 25.1 — Inventory actual SQLite shapes and import historical state with provenance

Planning baseline pending · wave 5 · owner `migration` · clause `25.1`

Requires: 4.1, 2.1, 15.2.

1. Read actual tables/columns including same-v18 additive variants; inventory external journals/config/memory/attempt/event/graph/docs evidence and WAL-safe snapshots.
2. Map IDs by source database/repository/key deterministically, preserve unavailable provenance and import active/forced claims as reconciliation/history rather than qualification.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/migration/sqlite.ts`, `tests/hyperfide/manifests/tasks/25.1.json`, `tests/hyperfide/cases/tasks/25_1.py`, `tests/hyperfide/registrations/25.1.json`, `services/hyperfide/components/25.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-018 --manifest tests/hyperfide/manifests/tasks/25.1.json && python3 tests/hyperfide/qualify.py --case V-019 --manifest tests/hyperfide/manifests/tasks/25.1.json && python3 tests/hyperfide/qualify.py --case V-025 --manifest tests/hyperfide/manifests/tasks/25.1.json
```

Outputs: `artifacts/hyperfide/tasks/25.1/manifest.json`, `artifacts/hyperfide/tasks/25.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 9.1 — Implement Railway preparation, disk checkpoints and fresh restore enrollment

Planning baseline pending · wave 7 · owner `railway` · clause `9.1`

Requires: 8.1, 11.1, 14.1, 12.1.

1. Pin Railway SDK/runtime and implement templates, captures, checkpoint ID/key compatibility and same-environment/region preparation affinity.
2. Fork a sentinel process and file: validate disk restoration and fresh runner identity without assuming process memory survives; reject contaminated preparation.
3. Component probes may use a recorded deterministic provider contract fixture, labelled as simulated; real disk/fresh-enrollment behavior requires an explicitly approved small live provider manifest before provider acceptance. Missing live credentials block that variant and cannot become a simulator PASS.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/railway/preparation.ts`, `tests/hyperfide/manifests/tasks/9.1.json`, `tests/hyperfide/cases/tasks/9_1.py`, `tests/hyperfide/registrations/9.1.json`, `services/hyperfide/components/9.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/9.1.json && python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/9.1.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/9.1.json
```

Outputs: `artifacts/hyperfide/tasks/9.1/manifest.json`, `artifacts/hyperfide/tasks/9.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 11.2 — Materialise exact source and keyed dependency caches

Planning baseline pending · wave 6 · owner `preparation` · clause `11.2`

Requires: 11.1, 15.1.

1. Fetch pinned repository commit sets into isolated writable workspaces and restore only caches keyed by source/locks/commands/config/toolchain as applicable.
2. Exercise partial download, incompatible cache, dependency hook and multi-repository identity failures without publishing incomplete preparation.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/bootstrap.c`, `tests/hyperfide/manifests/tasks/11.2.json`, `tests/hyperfide/cases/tasks/11_2.py`, `tests/hyperfide/registrations/11.2.json`, `src/hyperfide/components/11.2.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/11.2.json && python3 tests/hyperfide/qualify.py --case V-039 --manifest tests/hyperfide/manifests/tasks/11.2.json
```

Outputs: `artifacts/hyperfide/tasks/11.2/manifest.json`, `artifacts/hyperfide/tasks/11.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 1.1 — Enforce supervision-only main-host placement across all job classes

Planning baseline pending · wave 6 · owner `policy` · clause `1.1`

Requires: 8.1, 3.1.

1. Implement allowed main-host supervision/control/source-inspection roles and mandatory remote implementation/preparation/index/build/test/repro/integration execution policies for the configured supervisory host.
2. Attempt manager/native-tool local jobs and prove enforcement plus successful remote delegation; install/upgrade and future Hyperfide self-development obey the same boundary.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/policy/placement.ts`, `tests/hyperfide/manifests/tasks/1.1.json`, `tests/hyperfide/cases/tasks/1_1.py`, `tests/hyperfide/registrations/1.1.json`, `services/hyperfide/components/1.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/1.1.json && python3 tests/hyperfide/qualify.py --case V-052 --manifest tests/hyperfide/manifests/tasks/1.1.json
```

Outputs: `artifacts/hyperfide/tasks/1.1/manifest.json`, `artifacts/hyperfide/tasks/1.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 2.3 — Version task decomposition and active-run replanning

Planning baseline pending · wave 6 · owner `specification` · clause `2.3`

Requires: 2.2.

1. Implement manager proposals, impact computation and atomic revision admission for task/dependency changes with active attempts.
2. Reject weakening criteria through ordinary retry and invalidate affected packets/evidence while preserving change provenance.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/spec/revisions.ts`, `tests/hyperfide/manifests/tasks/2.3.json`, `tests/hyperfide/cases/tasks/2_3.py`, `tests/hyperfide/registrations/2.3.json`, `services/hyperfide/components/2.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/2.3.json && python3 tests/hyperfide/qualify.py --case V-014 --manifest tests/hyperfide/manifests/tasks/2.3.json
```

Outputs: `artifacts/hyperfide/tasks/2.3/manifest.json`, `artifacts/hyperfide/tasks/2.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 2.4 — Register criterion-level proof obligations and permitted review rubrics

Planning baseline pending · wave 6 · owner `assurance` · clause `2.4`

Requires: 2.2.

1. Create clause-specific gate registry with executable assertions or explicitly permitted review rubrics and required input identities.
2. Reject unknown, empty and whole-requirement-only proof mappings; distinguish linked source text, status declarations and genuine behavioural evidence.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/spec/obligations.ts`, `tests/hyperfide/manifests/tasks/2.4.json`, `tests/hyperfide/cases/tasks/2_4.py`, `tests/hyperfide/registrations/2.4.json`, `services/hyperfide/components/2.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-013 --manifest tests/hyperfide/manifests/tasks/2.4.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/2.4.json
```

Outputs: `artifacts/hyperfide/tasks/2.4/manifest.json`, `artifacts/hyperfide/tasks/2.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 3.3 — Provide bounded leader and manager context views

Planning baseline pending · wave 6 · owner `hierarchy` · clause `3.3`

Requires: 3.1, 2.2.

1. Expose scoped summaries, dependency exceptions, current findings and evidence links with freshness, provenance and omitted-context counts.
2. Enforce page/packet budgets on the largest approved manifest-selected fixture; prove truncation cannot omit mandatory intent or conceal blocking exceptions.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/hierarchy/views.ts`, `tests/hyperfide/manifests/tasks/3.3.json`, `tests/hyperfide/cases/tasks/3_3.py`, `tests/hyperfide/registrations/3.3.json`, `services/hyperfide/components/3.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-010 --manifest tests/hyperfide/manifests/tasks/3.3.json && python3 tests/hyperfide/qualify.py --case V-016 --manifest tests/hyperfide/manifests/tasks/3.3.json
```

Outputs: `artifacts/hyperfide/tasks/3.3/manifest.json`, `artifacts/hyperfide/tasks/3.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 5.1 — Atomically admit task claims and capacity reservations

Planning baseline pending · wave 6 · owner `scheduler` · clause `5.1`

Requires: 4.2, 2.2, 3.1.

1. Implement transactional dependency/wave/scope/role/run validation with one current task owner and multidimensional capacity reservations.
2. Race managers at quota boundaries and count creating, prepared and uncertain resources; report the precise failed admission dimension.
3. Exclude every active coordinator-owned submission custody from compute-expiry reclaim, including submitted, qualifying, qualified and integrating work; retain uncertain occupied resource accounting until quiescence or explicit orphan allocation is established.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/scheduler/claim.ts`, `tests/hyperfide/manifests/tasks/5.1.json`, `tests/hyperfide/cases/tasks/5_1.py`, `tests/hyperfide/registrations/5.1.json`, `services/hyperfide/components/5.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-002 --manifest tests/hyperfide/manifests/tasks/5.1.json && python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/5.1.json
```

Outputs: `artifacts/hyperfide/tasks/5.1/manifest.json`, `artifacts/hyperfide/tasks/5.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 6.2 — Implement inbox deduplication, revisions and replay-gap recovery

Planning baseline pending · wave 6 · owner `delivery` · clause `6.2`

Requires: 6.1.

1. Deduplicate events by identity and apply expected revisions; define explicit resynchronisation when retention creates a gap.
2. Reorder, duplicate, truncate and replay delivery; terminal actions and source provenance cannot regress or duplicate effects.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/events/inbox.ts`, `tests/hyperfide/manifests/tasks/6.2.json`, `tests/hyperfide/cases/tasks/6_2.py`, `tests/hyperfide/registrations/6.2.json`, `services/hyperfide/components/6.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-005 --manifest tests/hyperfide/manifests/tasks/6.2.json && python3 tests/hyperfide/qualify.py --case V-016 --manifest tests/hyperfide/manifests/tasks/6.2.json
```

Outputs: `artifacts/hyperfide/tasks/6.2/manifest.json`, `artifacts/hyperfide/tasks/6.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 7.2 — Bulk-stage graph facts and resolve references in bounded batches

Planning baseline pending · wave 6 · owner `graph` · clause `7.2`

Requires: 7.1, 4.2.

1. Implement bounded COPY/staging chunks and set-based reference resolution with independent coordination/graph admission and idempotent chunk identities.
2. Interrupt upload and resolution, race branches and count network queries; avoid per-symbol network amplification and long ownership-blocking transactions.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/graph/ingestion.ts`, `tests/hyperfide/manifests/tasks/7.2.json`, `tests/hyperfide/cases/tasks/7_2.py`, `tests/hyperfide/registrations/7.2.json`, `services/hyperfide/components/7.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-011 --manifest tests/hyperfide/manifests/tasks/7.2.json && python3 tests/hyperfide/qualify.py --case V-022 --manifest tests/hyperfide/manifests/tasks/7.2.json
```

Outputs: `artifacts/hyperfide/tasks/7.2/manifest.json`, `artifacts/hyperfide/tasks/7.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 14.3 — Qualify account-session and API authentication modes separately

Planning baseline pending · wave 7 · owner `identity` · clause `14.3`

Requires: 14.2.

1. Resolve the unanswered current-auth choice through non-secret operator configuration and qualified per-connector account/API profiles.
2. Exercise concurrent refresh/72-hour renewal assumptions within approved account guidance; unsupported portability or arbitrary host-auth-directory copying blocks that mode.
3. The foundation variant uses standalone pinned native-CLI authentication probes and controlled refresh-race fixtures, without depending on the later connector transport. It does not claim a 72-hour renewal result; task13.1 proves connector integration and task27.3 records actual endurance.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/identity/native_auth.ts`, `tests/hyperfide/manifests/tasks/14.3.json`, `tests/hyperfide/cases/tasks/14_3.py`, `tests/hyperfide/registrations/14.3.json`, `services/hyperfide/components/14.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/14.3.json && python3 tests/hyperfide/qualify.py --case V-042 --manifest tests/hyperfide/manifests/tasks/14.3.json
```

Outputs: `artifacts/hyperfide/tasks/14.3/manifest.json`, `artifacts/hyperfide/tasks/14.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 20.1 — Implement typed Span, Jev1.14 and d1-ultra route adapters

Planning baseline pending · wave 7 · owner `decisions` · clause `20.1`

Requires: 14.2, 1.4.

1. Pin requested respan/span-02, typesafe/jev-1.14 and liquid/d1-ultra route IDs/context/modality/question capability and response schemas; retain current Jev/recap configuration migration.
2. Reject unsupported number/box/vision/experimental paths; native and gateway routes have distinct qualified profiles rather than assumed interchangeability.
3. Qualify schema/transport parsing first with fixed malformed and valid response fixtures; record real native/gateway response and billing qualification separately under an approved model-call manifest. Optional routes remain disabled until their own live probe passes.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/adapters.ts`, `tests/hyperfide/manifests/tasks/20.1.json`, `tests/hyperfide/cases/tasks/20_1.py`, `tests/hyperfide/registrations/20.1.json`, `services/hyperfide/components/20.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/20.1.json
```

Outputs: `artifacts/hyperfide/tasks/20.1/manifest.json`, `artifacts/hyperfide/tasks/20.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 11.3 — Probe actual environment readiness before assignment

Planning baseline pending · wave 7 · owner `preparation` · clause `11.3`

Requires: 11.2, 14.2.

1. Probe tools/source/credential availability/storage/network and required execution features against the published manifest after mounts and runtime injection.
2. Return typed failures without secret disclosure; provider RUNNING alone and stale preparation manifests cannot make a slot READY.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/readiness.c`, `tests/hyperfide/manifests/tasks/11.3.json`, `tests/hyperfide/cases/tasks/11_3.py`, `tests/hyperfide/registrations/11.3.json`, `src/hyperfide/components/11.3.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/11.3.json && python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/11.3.json && python3 tests/hyperfide/qualify.py --case V-039 --manifest tests/hyperfide/manifests/tasks/11.3.json
```

Outputs: `artifacts/hyperfide/tasks/11.3/manifest.json`, `artifacts/hyperfide/tasks/11.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 3.2 — Build immutable scoped execution packets

Planning baseline pending · wave 7 · owner `hierarchy` · clause `3.2`

Requires: 3.1, 2.4.

1. Build versioned packets binding spec/task/attempt/generation/parent/manager, exact source inputs, scope, contracts, obligations, limits and environment profile.
2. Hash mandatory intent and constraints independently from optional ranked context; reject missing identities and incompatible revisions.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/hierarchy/packets.ts`, `tests/hyperfide/manifests/tasks/3.2.json`, `tests/hyperfide/cases/tasks/3_2.py`, `tests/hyperfide/registrations/3.2.json`, `services/hyperfide/components/3.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/3.2.json && python3 tests/hyperfide/qualify.py --case V-014 --manifest tests/hyperfide/manifests/tasks/3.2.json
```

Outputs: `artifacts/hyperfide/tasks/3.2/manifest.json`, `artifacts/hyperfide/tasks/3.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 5.2 — Enforce monotonic generations and primary-clock leases

Planning baseline pending · wave 7 · owner `scheduler` · clause `5.2`

Requires: 5.1.

1. Issue monotonic attempt generations, primary-clock expiry and generation-bearing renew/result/cancel requests; reject missing or stale authority.
2. Race expiry, renewal and reassignment with skewed clocks; retain useful stale artifacts without resurrecting ownership.
3. Separate worker compute authority from admitted immutable submission custody; serialize renewal, submission, custody revocation and reassignment. Idempotent submission replay resolves its prior outcome before checking the now-released worker lease; primary-clock expiry never reclaims active custody.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/scheduler/leases.ts`, `tests/hyperfide/manifests/tasks/5.2.json`, `tests/hyperfide/cases/tasks/5_2.py`, `tests/hyperfide/registrations/5.2.json`, `services/hyperfide/components/5.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-003 --manifest tests/hyperfide/manifests/tasks/5.2.json && python3 tests/hyperfide/qualify.py --case V-004 --manifest tests/hyperfide/manifests/tasks/5.2.json
```

Outputs: `artifacts/hyperfide/tasks/5.2/manifest.json`, `artifacts/hyperfide/tasks/5.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 5.4 — Replace fixed local slot/start limits with resource admission and fairness

Planning baseline pending · wave 7 · owner `scheduler` · clause `5.4`

Requires: 5.1.

1. Implement dynamic agent/build/test/review/index/exclusive-service limits with provider quotas and API-rate budgets; remove orchestration-path fixed 16-slot/256-start assumptions.
2. Exercise queued build/model/review waits, starvation and backpressure; native descendants and provision reservations remain counted.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/scheduler/resources.ts`, `tests/hyperfide/manifests/tasks/5.4.json`, `tests/hyperfide/cases/tasks/5_4.py`, `tests/hyperfide/registrations/5.4.json`, `services/hyperfide/components/5.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/5.4.json && python3 tests/hyperfide/qualify.py --case V-047 --manifest tests/hyperfide/manifests/tasks/5.4.json
```

Outputs: `artifacts/hyperfide/tasks/5.4/manifest.json`, `artifacts/hyperfide/tasks/5.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 6.4 — Recover durable dispatch after controller restart

Planning baseline pending · wave 9 · owner `delivery` · clause `6.4`

Requires: 6.2, 14.1, 6.3.

1. Use notifications/streams only as wakeups over durable queues and periodic reconciliation; restore unacknowledged obligations after restart.
2. Lose stream notifications and crash dispatch before/after external send; prove committed work remains discoverable without an always-live subscription.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Own the continuously running dispatch-role delivery worker: claim committed pending delivery rows, invoke registered delivery handlers, persist acknowledgement/retry outcomes, and periodically reconcile independently of notifications. Use the established daemon lifecycle and process-owned PostgreSQL resources; no stdin EOF or transient stream disconnect may terminate durable delivery silently.
5. Keep command publication and acknowledgement coordinated with task6.3 API bindings. Start separate control and dispatch processes against the same PostgreSQL fixture, commit work in one, observe delivery in the other, restart the dispatcher and prove the same logical effect after lost acknowledgement.
6. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/events/recovery.ts`, `tests/hyperfide/manifests/tasks/6.4.json`, `tests/hyperfide/cases/tasks/6_4.py`, `tests/hyperfide/registrations/6.4.json`, `services/hyperfide/components/6.4.json`, `services/hyperfide/src/events/dispatcher.ts`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-005 --manifest tests/hyperfide/manifests/tasks/6.4.json && python3 tests/hyperfide/qualify.py --case V-008 --manifest tests/hyperfide/manifests/tasks/6.4.json
```

Outputs: `artifacts/hyperfide/tasks/6.4/manifest.json`, `artifacts/hyperfide/tasks/6.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 7.3 — Publish complete graph generations atomically

Planning baseline pending · wave 7 · owner `graph` · clause `7.3`

Requires: 7.2.

1. Build immutable manifests with extraction/resolution/coverage checks and atomically switch published generations only when complete.
2. Crash before/after publish and return an older extraction; retain previous complete graph and expose failed/unresolved staging debt.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/graph/publication.ts`, `tests/hyperfide/manifests/tasks/7.3.json`, `tests/hyperfide/cases/tasks/7_3.py`, `tests/hyperfide/registrations/7.3.json`, `services/hyperfide/components/7.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-021 --manifest tests/hyperfide/manifests/tasks/7.3.json && python3 tests/hyperfide/qualify.py --case V-022 --manifest tests/hyperfide/manifests/tasks/7.3.json
```

Outputs: `artifacts/hyperfide/tasks/7.3/manifest.json`, `artifacts/hyperfide/tasks/7.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 20.2 — Preserve output probability and confidence semantics with abstention

Planning baseline pending · wave 8 · owner `decisions` · clause `20.2`

Requires: 20.1.

1. Validate and preserve raw choice distributions/yes probabilities/ordinal scores/provider confidence and optional number/box results.
2. Exercise malformed/NaN/out-of-range/missing outputs; keep Noul max(p,1-p) distinct from provider confidence and require per-purpose calibration before thresholds.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/results.ts`, `tests/hyperfide/manifests/tasks/20.2.json`, `tests/hyperfide/cases/tasks/20_2.py`, `tests/hyperfide/registrations/20.2.json`, `services/hyperfide/components/20.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/20.2.json
```

Outputs: `artifacts/hyperfide/tasks/20.2/manifest.json`, `artifacts/hyperfide/tasks/20.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 20.3 — Represent route-specific images, reasoning and actual billing

Planning baseline pending · wave 8 · owner `decisions` · clause `20.3`

Requires: 20.1.

1. Implement provider image formats, context limits, reasoning controls and zero-budget distinctions with observed usage/price provenance.
2. Test per-question repeated-state versus qualified shared-batch accounting, Jev route billing uncertainty and hosted/self-host Span defaults; unknown cost remains unknown.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/capabilities.ts`, `tests/hyperfide/manifests/tasks/20.3.json`, `tests/hyperfide/cases/tasks/20_3.py`, `tests/hyperfide/registrations/20.3.json`, `services/hyperfide/components/20.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/20.3.json
```

Outputs: `artifacts/hyperfide/tasks/20.3/manifest.json`, `artifacts/hyperfide/tasks/20.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 3.4 — Register native descendants and adopt valid work after manager replacement

Planning baseline pending · wave 8 · owner `hierarchy` · clause `3.4`

Requires: 3.1, 5.2.

1. Register native-child parentage, task association, sandbox/slot and resource consumption; persist adoption/handoff requests.
2. Replace a manager against a versioned package without duplicating owners or restarting valid children; refuse unaccounted child execution authority.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/hierarchy/adoption.ts`, `tests/hyperfide/manifests/tasks/3.4.json`, `tests/hyperfide/cases/tasks/3_4.py`, `tests/hyperfide/registrations/3.4.json`, `services/hyperfide/components/3.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/3.4.json && python3 tests/hyperfide/qualify.py --case V-008 --manifest tests/hyperfide/manifests/tasks/3.4.json
```

Outputs: `artifacts/hyperfide/tasks/3.4/manifest.json`, `artifacts/hyperfide/tasks/3.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 4.3 — Assemble consistent packets with topology-aware replica barriers

Planning baseline pending · wave 8 · owner `storage` · clause `4.3`

Requires: 4.2, 3.2.

1. Implement snapshot-consistent spec/source/dependency/graph packet reads and freshness classes; attach timeline/topology-qualified causal barriers.
2. Delay replay, change primary timeline and request absent graph versions; wait/fallback/fail explicitly rather than mix packet generations.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/storage/replicas.ts`, `tests/hyperfide/manifests/tasks/4.3.json`, `tests/hyperfide/cases/tasks/4_3.py`, `tests/hyperfide/registrations/4.3.json`, `services/hyperfide/components/4.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-010 --manifest tests/hyperfide/manifests/tasks/4.3.json && python3 tests/hyperfide/qualify.py --case V-023 --manifest tests/hyperfide/manifests/tasks/4.3.json
```

Outputs: `artifacts/hyperfide/tasks/4.3/manifest.json`, `artifacts/hyperfide/tasks/4.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 5.3 — Reconcile idempotent dispatch and uncertain external outcomes

Planning baseline pending · wave 8 · owner `scheduler` · clause `5.3`

Requires: 5.2, 6.1, 1.1.

1. Bind dispatch requests to stable operation identity and persisted outcomes; reconcile uncertain create/spawn effects before compatible replacement.
2. Lose responses across crash windows and return delayed surviving workers; permit duplicate physical execution only with one accepted authority.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/scheduler/dispatch.ts`, `tests/hyperfide/manifests/tasks/5.3.json`, `tests/hyperfide/cases/tasks/5_3.py`, `tests/hyperfide/registrations/5.3.json`, `services/hyperfide/components/5.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-004 --manifest tests/hyperfide/manifests/tasks/5.3.json && python3 tests/hyperfide/qualify.py --case V-037 --manifest tests/hyperfide/manifests/tasks/5.3.json
```

Outputs: `artifacts/hyperfide/tasks/5.3/manifest.json`, `artifacts/hyperfide/tasks/5.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 6.3 — Deliver generation-bound start, steering and cancellation instructions

Planning baseline pending · wave 8 · owner `delivery` · clause `6.3`

Requires: 6.2, 5.2, 14.1.

1. Persist stable command IDs, target generation, ordering, delivery state and acknowledgements with bounded spool/central retention.
2. Race cancellation with launch and lose acknowledgements; redelivery cannot append the same instruction or start another logical agent.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Bind command poll/delivery, ordered steering/cancel, acknowledgement and structured event-ingress operations into the authenticated coordinator API with exact runner/boot/attempt scope. Make durable command state discoverable on reconnect; a failed response never implies command absence.
5. Exercise the actual HTTPS API and durable inbox/outbox state across lost delivery/acknowledgement and duplicate instruction delivery. An isolated instructions handler cannot substitute for the network binding.
6. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/events/instructions.ts`, `tests/hyperfide/manifests/tasks/6.3.json`, `tests/hyperfide/cases/tasks/6_3.py`, `tests/hyperfide/registrations/6.3.json`, `services/hyperfide/components/6.3.json`, `services/hyperfide/src/events/api.ts`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-006 --manifest tests/hyperfide/manifests/tasks/6.3.json
```

Outputs: `artifacts/hyperfide/tasks/6.3/manifest.json`, `artifacts/hyperfide/tasks/6.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 8.2 — Implement pool inventory and separately qualified account quotas

Planning baseline pending · wave 8 · owner `providers` · clause `8.2`

Requires: 8.1, 5.4.

1. Record provider/account/environment/workspace/region/profile and quota dimensions, separating planning assertions from observed account capabilities.
2. Read provider quotas and environment/workspace topology from private deployment configuration; qualify each pool independently and enforce the approved operating budget separately.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/pools.ts`, `tests/hyperfide/manifests/tasks/8.2.json`, `tests/hyperfide/cases/tasks/8_2.py`, `tests/hyperfide/registrations/8.2.json`, `services/hyperfide/components/8.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/8.2.json && python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/8.2.json
```

Outputs: `artifacts/hyperfide/tasks/8.2/manifest.json`, `artifacts/hyperfide/tasks/8.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 15.3 — Adopt stale-attempt artifacts without restoring stale authority

Planning baseline pending · wave 8 · owner `artifacts` · clause `15.3`

Requires: 15.1, 15.2, 5.2.

1. Validate source/session/environment compatibility and preserve provenance when a new attempt adopts old recoverable artifacts.
2. Return an expired worker and incompatible checkpoint; adoption does not renew its fence or reuse a mismatched native session silently.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/artifacts/adoption.ts`, `tests/hyperfide/manifests/tasks/15.3.json`, `tests/hyperfide/cases/tasks/15_3.py`, `tests/hyperfide/registrations/15.3.json`, `services/hyperfide/components/15.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-003 --manifest tests/hyperfide/manifests/tasks/15.3.json && python3 tests/hyperfide/qualify.py --case V-014 --manifest tests/hyperfide/manifests/tasks/15.3.json && python3 tests/hyperfide/qualify.py --case V-043 --manifest tests/hyperfide/manifests/tasks/15.3.json
```

Outputs: `artifacts/hyperfide/tasks/15.3/manifest.json`, `artifacts/hyperfide/tasks/15.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 20.4 — Run decision jobs asynchronously with deadlines and safe fallback

Planning baseline pending · wave 9 · owner `decisions` · clause `20.4`

Requires: 20.2, 20.3, 6.2.

1. Move calls outside scheduler/heartbeat critical path with admission, total deadlines, bounded retry/circuit policy and packet freshness checks.
2. Timeout or remove every decision provider during live core-loop fixtures; deterministic policy/abstention/escalation preserves safe scheduling and qualification.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/jobs.ts`, `tests/hyperfide/manifests/tasks/20.4.json`, `tests/hyperfide/cases/tasks/20_4.py`, `tests/hyperfide/registrations/20.4.json`, `services/hyperfide/components/20.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/20.4.json && python3 tests/hyperfide/qualify.py --case V-011 --manifest tests/hyperfide/manifests/tasks/20.4.json
```

Outputs: `artifacts/hyperfide/tasks/20.4/manifest.json`, `artifacts/hyperfide/tasks/20.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 1.2 — Expose one human programme interface through primary leader

Planning baseline pending · wave 9 · owner `policy` · clause `1.2`

Requires: 3.1, 6.3.

1. Route human intent/criteria/programme changes only through registered primary leader; routine scheduling/provision/repair/review/qualification follows approved autonomous policy.
2. Simulate manager/task escalation and leader replacement; unresolved intent reaches leader while routine job execution does not demand human worker prompts.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/policy/human_interface.ts`, `tests/hyperfide/manifests/tasks/1.2.json`, `tests/hyperfide/cases/tasks/1_2.py`, `tests/hyperfide/registrations/1.2.json`, `services/hyperfide/components/1.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-001 --manifest tests/hyperfide/manifests/tasks/1.2.json && python3 tests/hyperfide/qualify.py --case V-008 --manifest tests/hyperfide/manifests/tasks/1.2.json
```

Outputs: `artifacts/hyperfide/tasks/1.2/manifest.json`, `artifacts/hyperfide/tasks/1.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 7.4 — Port graph query and search semantics with differential parity

Planning baseline pending · wave 9 · owner `graph` · clause `7.4`

Requires: 7.3, 4.3.

1. Implement grouped context/traversal and PostgreSQL word/body/comment/trigram queries with provenance, branch and budget controls.
2. Compare current SQLite search and full/incremental graph results on pinned real-source corpora, including Unicode/deletion/config changes and mixed state load.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/graph/query.ts`, `tests/hyperfide/manifests/tasks/7.4.json`, `tests/hyperfide/cases/tasks/7_4.py`, `tests/hyperfide/registrations/7.4.json`, `services/hyperfide/components/7.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-020 --manifest tests/hyperfide/manifests/tasks/7.4.json && python3 tests/hyperfide/qualify.py --case V-021 --manifest tests/hyperfide/manifests/tasks/7.4.json && python3 tests/hyperfide/qualify.py --case V-025 --manifest tests/hyperfide/manifests/tasks/7.4.json && python3 tests/hyperfide/qualify.py --case V-048 --manifest tests/hyperfide/manifests/tasks/7.4.json
```

Outputs: `artifacts/hyperfide/tasks/7.4/manifest.json`, `artifacts/hyperfide/tasks/7.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 8.3 — Persist provisioning intents and quarantine ambiguous or orphan resources

Planning baseline pending · wave 10 · owner `providers` · clause `8.3`

Requires: 8.2, 5.3, 6.4, 14.1.

1. Record intent before external create, persist returned IDs early and completely paginate inventory for reconciliation.
2. Interrupt create/readiness/delete responses; retain uncertain quota consumption, quarantine ambiguous resources and clean only resources with established ownership.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Own the persistent provisioner-role worker that claims durable provisioning intents and invokes the configured provider adapter create/observe/destroy methods with bounded concurrency. Persist returned identifiers and uncertain outcomes through the actual shared authority; method wrappers without an executing worker are insufficient.
5. Keep provider administration credentials only in the provisioner process. Control and dispatch communicate with it through durable PostgreSQL obligations or authenticated internal operations, not through cross-role in-process capability injection. A configured pool with a missing or incompatible adapter cannot report operational readiness.
6. Prove the provisioner consumes a committed intent from a separately running control process, records adapter-observed state, resumes reconciliation after worker restart and leaves ambiguous external outcomes visible. Controlled adapter fixtures qualify this composition only; real provider behavior still requires its dedicated live variants.
7. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/reconcile.ts`, `tests/hyperfide/manifests/tasks/8.3.json`, `tests/hyperfide/cases/tasks/8_3.py`, `tests/hyperfide/registrations/8.3.json`, `services/hyperfide/components/8.3.json`, `services/hyperfide/src/providers/worker.ts`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-037 --manifest tests/hyperfide/manifests/tasks/8.3.json && python3 tests/hyperfide/qualify.py --case V-054 --manifest tests/hyperfide/manifests/tasks/8.3.json
```

Outputs: `artifacts/hyperfide/tasks/8.3/manifest.json`, `artifacts/hyperfide/tasks/8.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 8.4 — Implement authenticated cross-pool connectivity and compatible relocation

Planning baseline pending · wave 9 · owner `providers` · clause `8.4`

Requires: 8.2, 14.1.

1. Qualify coordinator/Git/artifact/model reachability per pool without cross-environment private DNS assumptions; apply region/profile compatibility rules.
2. Inject rate limits and provider partitions; bounded relocation preserves source/environment/fence identities and requires fresh enrollment.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/placement.ts`, `tests/hyperfide/manifests/tasks/8.4.json`, `tests/hyperfide/cases/tasks/8_4.py`, `tests/hyperfide/registrations/8.4.json`, `services/hyperfide/components/8.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/8.4.json && python3 tests/hyperfide/qualify.py --case V-049 --manifest tests/hyperfide/manifests/tasks/8.4.json
```

Outputs: `artifacts/hyperfide/tasks/8.4/manifest.json`, `artifacts/hyperfide/tasks/8.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 9.2 — Apply complete Railway runtime profiles for every launch

Planning baseline pending · wave 9 · owner `railway` · clause `9.2`

Requires: 9.1, 8.2.

1. Pass explicit variables/resources/network/region/lifetime/domain settings for create/fork/restore and distinguish build-time/runtime values.
2. Probe non-inherited options and incompatible region placement; profile digest must match observed child configuration.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/railway/profile.ts`, `tests/hyperfide/manifests/tasks/9.2.json`, `tests/hyperfide/cases/tasks/9_2.py`, `tests/hyperfide/registrations/9.2.json`, `services/hyperfide/components/9.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/9.2.json && python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/9.2.json
```

Outputs: `artifacts/hyperfide/tasks/9.2/manifest.json`, `artifacts/hyperfide/tasks/9.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 10.2 — Apply explicit Blaxel process and sandbox lifetime controls

Planning baseline pending · wave 9 · owner `blaxel` · clause `10.2`

Requires: 10.1, 8.2.

1. Configure keepAlive:true and timeout:0 where qualified; separate API wait, process deadline, standby and deletion expiration controls.
2. Run shortened600s/default-timeout and continuously-active ttl-idle negative fixtures; reject profiles incompatible with nonstop runs.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/blaxel/lifetime.ts`, `tests/hyperfide/manifests/tasks/10.2.json`, `tests/hyperfide/cases/tasks/10_2.py`, `tests/hyperfide/registrations/10.2.json`, `services/hyperfide/components/10.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/10.2.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/10.2.json
```

Outputs: `artifacts/hyperfide/tasks/10.2/manifest.json`, `artifacts/hyperfide/tasks/10.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 12.2 — Persist local start ledger and own agent IPC across reconnects

Planning baseline pending · wave 9 · owner `runner` · clause `12.2`

Requires: 12.1, 6.3.

1. Durably accept generation-bound starts before spawn, record process/session associations and retain supervisor-owned IPC independently of controller transport.
2. Crash immediately before/after spawn and ledger writes; inspect/adopt existing process or record uncertainty rather than blindly launching another session.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Use task12.1 shared native transport for command polling, start/steer/cancel delivery, acknowledgements, lease renewal and structured event upload. Connect durable local instruction/start records to actual agent process spawning and reconnect; do not leave launch execution accessible only through isolated component-dispatch tests.
5. Run a separate coordinator/dispatch process and a native supervisor process over HTTPS, interrupt their transport around spawn/ack windows, and verify restored command identity, existing-process adoption and bounded spool replay without duplicate logical starts.
6. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/launch.c`, `tests/hyperfide/manifests/tasks/12.2.json`, `tests/hyperfide/cases/tasks/12_2.py`, `tests/hyperfide/registrations/12.2.json`, `src/hyperfide/components/12.2.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-006 --manifest tests/hyperfide/manifests/tasks/12.2.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/12.2.json && python3 tests/hyperfide/qualify.py --case V-043 --manifest tests/hyperfide/manifests/tasks/12.2.json
```

Outputs: `artifacts/hyperfide/tasks/12.2/manifest.json`, `artifacts/hyperfide/tasks/12.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 21.1 — Add advisory clause critique with validated change proposals

Planning baseline pending · wave 10 · owner `decisions` · clause `21.1`

Requires: 20.4, 2.3.

1. Build scoped criterion/interface/dependency critique packets with source-linked findings and ambiguity/missing-proof categories.
2. Adversarial advice cannot mutate live specs or release dependencies; every proposed revision passes ordinary structural/impact validation.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/spec_critique.ts`, `tests/hyperfide/manifests/tasks/21.1.json`, `tests/hyperfide/cases/tasks/21_1.py`, `tests/hyperfide/registrations/21.1.json`, `services/hyperfide/components/21.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/21.1.json && python3 tests/hyperfide/qualify.py --case V-024 --manifest tests/hyperfide/manifests/tasks/21.1.json
```

Outputs: `artifacts/hyperfide/tasks/21.1/manifest.json`, `artifacts/hyperfide/tasks/21.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 21.4 — Persist complete decision audit records and eventual outcomes

Planning baseline pending · wave 10 · owner `decisions` · clause `21.4`

Requires: 20.4, 15.2.

1. Record purpose/packet hash/revisions/rubric/model/route/raw output/calibrated interpretation/action/latency/usage and outcome links.
2. Reject stale-packet action attempts and policy-disallowed egress; advisory records cannot supply leases, waived evidence or protected publication.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/audit.ts`, `tests/hyperfide/manifests/tasks/21.4.json`, `tests/hyperfide/cases/tasks/21_4.py`, `tests/hyperfide/registrations/21.4.json`, `services/hyperfide/components/21.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/21.4.json && python3 tests/hyperfide/qualify.py --case V-014 --manifest tests/hyperfide/manifests/tasks/21.4.json
```

Outputs: `artifacts/hyperfide/tasks/21.4/manifest.json`, `artifacts/hyperfide/tasks/21.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 9.3 — Track Railway durable sessions, logs and process termination

Planning baseline pending · wave 10 · owner `railway` · clause `9.3`

Requires: 9.2, 12.2, 15.2.

1. Persist sandbox/session IDs, exit codes and reattachment state; use supported long-running sessions and independent durable output spooling beyond provider8MiB retention.
2. Exercise disconnect/stdin capability/backpressure/timeout/abort/kill and unconfirmed termination; HTTP command or incomplete provider logs cannot stand in for complete evidence.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/railway/processes.ts`, `tests/hyperfide/manifests/tasks/9.3.json`, `tests/hyperfide/cases/tasks/9_3.py`, `tests/hyperfide/registrations/9.3.json`, `services/hyperfide/components/9.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-039 --manifest tests/hyperfide/manifests/tasks/9.3.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/9.3.json
```

Outputs: `artifacts/hyperfide/tasks/9.3/manifest.json`, `artifacts/hyperfide/tasks/9.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 10.3 — Reconcile Blaxel create-or-get and recover process streams

Planning baseline pending · wave 11 · owner `blaxel` · clause `10.3`

Requires: 10.2, 12.2, 8.3.

1. Verify actual configuration on named create-or-get; treat mutable/nonunique externalID as metadata; persist process IDs/exits/logs.
2. Exercise partial stdin writes, default EOF, API/process restart and lost response; reconcile before retrying a logical instruction or process launch.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/blaxel/processes.ts`, `tests/hyperfide/manifests/tasks/10.3.json`, `tests/hyperfide/cases/tasks/10_3.py`, `tests/hyperfide/registrations/10.3.json`, `services/hyperfide/components/10.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-037 --manifest tests/hyperfide/manifests/tasks/10.3.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/10.3.json
```

Outputs: `artifacts/hyperfide/tasks/10.3/manifest.json`, `artifacts/hyperfide/tasks/10.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 11.4 — Schedule remote preparation and eligible-work-driven prewarming

Planning baseline pending · wave 11 · owner `preparation` · clause `11.4`

Requires: 11.1, 5.4, 8.3, 1.1.

1. Dispatch prerequisite installation and indexing preparation remotely with bounded retry/diagnostics and capacity reservations driven by eligible work.
2. Inject package failure/partial download and obsolete manifests; preserve warm spare budget without publishing incomplete bases or launching main-host preparation.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/preparation/prewarm.ts`, `tests/hyperfide/manifests/tasks/11.4.json`, `tests/hyperfide/cases/tasks/11_4.py`, `tests/hyperfide/registrations/11.4.json`, `services/hyperfide/components/11.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/11.4.json && python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/11.4.json
```

Outputs: `artifacts/hyperfide/tasks/11.4/manifest.json`, `artifacts/hyperfide/tasks/11.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 12.3 — Observe process trees, useful progress and resource usage separately

Planning baseline pending · wave 10 · owner `runner` · clause `12.3`

Requires: 12.2, 3.4.

1. Track descendants, boot/PID identity, job limits and progress events separately from sandbox reachability/process liveness/assurance validity.
2. Kill/reuse PIDs, spawn native children and saturate quotas; entire process trees remain accountable for cancellation and checkpoints.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/process_tree.c`, `tests/hyperfide/manifests/tasks/12.3.json`, `tests/hyperfide/cases/tasks/12_3.py`, `tests/hyperfide/registrations/12.3.json`, `src/hyperfide/components/12.3.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/12.3.json && python3 tests/hyperfide/qualify.py --case V-044 --manifest tests/hyperfide/manifests/tasks/12.3.json
```

Outputs: `artifacts/hyperfide/tasks/12.3/manifest.json`, `artifacts/hyperfide/tasks/12.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 13.1 — Implement pinned Claude Code and Codex connector capability profiles

Planning baseline pending · wave 10 · owner `connectors` · clause `13.1`

Requires: 12.2, 14.3.

1. Qualify actual launch/input/output/steer/cancel/child/resume capabilities for each pinned CLI/auth mode and resolve user frontier aliases from real configuration.
2. Exercise actual authorised native launches and unsupported-option refusal; do not simulate preserved context or substitute decision models for coding workers.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/connectors.c`, `tests/hyperfide/manifests/tasks/13.1.json`, `tests/hyperfide/cases/tasks/13_1.py`, `tests/hyperfide/registrations/13.1.json`, `src/hyperfide/components/13.1.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-042 --manifest tests/hyperfide/manifests/tasks/13.1.json
```

Outputs: `artifacts/hyperfide/tasks/13.1/manifest.json`, `artifacts/hyperfide/tasks/13.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 15.4 — Implement reference-safe retention, garbage collection and destruction gates

Planning baseline pending · wave 11 · owner `artifacts` · clause `15.4`

Requires: 15.2, 8.3.

1. Track active evidence/findings/publication/recovery references, retention policy and garbage-collection tombstones before destruction.
2. Crash cleanup and leave unreachable provider resources; required source/evidence survives and unresolved deletions remain visible debt.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/artifacts/retention.ts`, `tests/hyperfide/manifests/tasks/15.4.json`, `tests/hyperfide/cases/tasks/15_4.py`, `tests/hyperfide/registrations/15.4.json`, `services/hyperfide/components/15.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-012 --manifest tests/hyperfide/manifests/tasks/15.4.json && python3 tests/hyperfide/qualify.py --case V-054 --manifest tests/hyperfide/manifests/tasks/15.4.json
```

Outputs: `artifacts/hyperfide/tasks/15.4/manifest.json`, `artifacts/hyperfide/tasks/15.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 16.1 — Submit immutable worker results and dispatch independent qualification

Planning baseline pending · wave 11 · owner `assurance` · clause `16.1`

Requires: 2.4, 5.2, 15.2, 12.2, 6.4, 8.3, 14.4, 11.3, 13.1, 3.2.

1. Admit generation-bound immutable source/evidence/criteria/contract submission manifests with idempotent conflicting-payload rejection.
2. Run required checks in separate clean remote qualification environments; worker completion text or process exit cannot qualify its own task.
3. Atomically validate current compute authority and complete immutable artifacts, create active coordinator submission custody, release original compute authority and schedule independent verification jobs under their own leases. Race the expiry sweeper, lost-response replay and coding-sandbox cleanup; admitted custody remains valid through qualification and integration.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Own a mandatory connected-stack integration variant using separately running control, dispatch and provisioner services, a real disposable PostgreSQL database, the coordinator HTTPS listener and a real native supervisor process. Exercise imported run/packet creation, eligibility/claim, durable dispatch, preparation/readiness, actual process spawn, immutable artifact submission, compute-to-custody transfer and independent qualification after coding-slot cleanup.
6. Restart dispatch and interrupt the network between commit/send/ack; observe actual process identity, PostgreSQL records and immutable artifacts independently. The connected variant cannot be satisfied by in-process registry invocation, direct handler calls, fabricated occupancy or unrelated component PASS receipts.
7. Controlled provider and agent process doubles may be explicitly selected for the first connected-stack probe, while network transport, database and service/process boundaries remain real. Such evidence never qualifies a real provider/native frontier variant; those require their own approved live probes and campaign receipts. Required full-case inventories must include this connected-stack assertion family.
8. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/assurance/submission.ts`, `tests/hyperfide/manifests/tasks/16.1.json`, `tests/hyperfide/cases/tasks/16_1.py`, `tests/hyperfide/registrations/16.1.json`, `services/hyperfide/components/16.1.json`, `tests/hyperfide/integration/connected-stack.py`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-013 --manifest tests/hyperfide/manifests/tasks/16.1.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/16.1.json
```

Outputs: `artifacts/hyperfide/tasks/16.1/manifest.json`, `artifacts/hyperfide/tasks/16.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 22.1 — Build temporally valid labelled evaluation datasets

Planning baseline pending · wave 11 · owner `evaluation` · clause `22.1`

Requires: 21.4.

1. Create packets containing only historically available information with incident/feature-separated splits and independent labels for missed defects/interventions.
2. Detect leakage from later fixes, issue closure and accepted task labels; preserve uncertain labels and independent adjudication provenance.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/evaluation/datasets.ts`, `tests/hyperfide/manifests/tasks/22.1.json`, `tests/hyperfide/cases/tasks/22_1.py`, `tests/hyperfide/registrations/22.1.json`, `services/hyperfide/components/22.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-046 --manifest tests/hyperfide/manifests/tasks/22.1.json
```

Outputs: `artifacts/hyperfide/tasks/22.1/manifest.json`, `artifacts/hyperfide/tasks/22.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 1.3 — Apply qualified frontier assignment policy and user model aliases

Planning baseline pending · wave 11 · owner `policy` · clause `1.3`

Requires: 13.1, 5.4.

1. Resolve actual native deployment configuration for Claude short-critical-complex and Codex sustained-complex assignment without hardcoding user aliases as public model IDs.
2. Reject missing/unqualified routes and decision-model worker substitution; record actual configured model/provider lineage and measured selection inputs.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/policy/frontier.ts`, `tests/hyperfide/manifests/tasks/1.3.json`, `tests/hyperfide/cases/tasks/1_3.py`, `tests/hyperfide/registrations/1.3.json`, `services/hyperfide/components/1.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-042 --manifest tests/hyperfide/manifests/tasks/1.3.json && python3 tests/hyperfide/qualify.py --case V-044 --manifest tests/hyperfide/manifests/tasks/1.3.json
```

Outputs: `artifacts/hyperfide/tasks/1.3/manifest.json`, `artifacts/hyperfide/tasks/1.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 9.4 — Reconcile Railway API edge cases and qualify actual account lifecycle

Planning baseline pending · wave 11 · owner `railway` · clause `9.4`

Requires: 9.3, 8.3, 8.4.

1. Implement complete inventory/session pagination, early-ID readiness recovery and installed-SDK checkpoint identifier compatibility.
2. Qualify networking/quota/idle/72-hour profile inputs through approved probes; unresolved creation is not replayed blindly and actual endurance evidence remains a later campaign gate.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/railway/reconciliation.ts`, `tests/hyperfide/manifests/tasks/9.4.json`, `tests/hyperfide/cases/tasks/9_4.py`, `tests/hyperfide/registrations/9.4.json`, `services/hyperfide/components/9.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/9.4.json && python3 tests/hyperfide/qualify.py --case V-037 --manifest tests/hyperfide/manifests/tasks/9.4.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/9.4.json
```

Outputs: `artifacts/hyperfide/tasks/9.4/manifest.json`, `artifacts/hyperfide/tasks/9.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 10.4 — Gate Blaxel preview capabilities and qualify fresh-identity recovery

Planning baseline pending · wave 12 · owner `blaxel` · clause `10.4`

Requires: 10.3, 14.1, 15.3.

1. Make fresh image-based runner enrollment baseline; separately negotiate preview env updates, shared storage and memory snapshot/fork capability.
2. Reject a restored authenticated clone before outward action or disable that path; verify existing-process variables and separately retained volumes are handled explicitly.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/providers/blaxel/recovery.ts`, `tests/hyperfide/manifests/tasks/10.4.json`, `tests/hyperfide/cases/tasks/10_4.py`, `tests/hyperfide/registrations/10.4.json`, `services/hyperfide/components/10.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/10.4.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/10.4.json
```

Outputs: `artifacts/hyperfide/tasks/10.4/manifest.json`, `artifacts/hyperfide/tasks/10.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 12.4 — Implement runner pause, drain, cancel and verified stop

Planning baseline pending · wave 11 · owner `runner` · clause `12.4`

Requires: 12.3, 15.2.

1. Implement distinct control semantics with fenced authority and artifact-safe cleanup; report confirmed and unresolved termination explicitly.
2. Cancel disconnected jobs, repeat commands and restart cleanup; slot reuse waits for process/credential residue checks and durable required outputs.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/control.c`, `tests/hyperfide/manifests/tasks/12.4.json`, `tests/hyperfide/cases/tasks/12_4.py`, `tests/hyperfide/registrations/12.4.json`, `src/hyperfide/components/12.4.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-006 --manifest tests/hyperfide/manifests/tasks/12.4.json && python3 tests/hyperfide/qualify.py --case V-017 --manifest tests/hyperfide/manifests/tasks/12.4.json
```

Outputs: `artifacts/hyperfide/tasks/12.4/manifest.json`, `artifacts/hyperfide/tasks/12.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 13.2 — Persist native session lineage and source-linked checkpoints

Planning baseline pending · wave 11 · owner `connectors` · clause `13.2`

Requires: 13.1, 15.1.

1. Record role/parent/task/attempt/native session/process/boot/config identity and compatible workspace/session checkpoint references.
2. Reject most-recent-session crossover and mismatched source trees; preserve exact named conversation lineage during resumed work.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/agents/sessions.ts`, `tests/hyperfide/manifests/tasks/13.2.json`, `tests/hyperfide/cases/tasks/13_2.py`, `tests/hyperfide/registrations/13.2.json`, `services/hyperfide/components/13.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-042 --manifest tests/hyperfide/manifests/tasks/13.2.json && python3 tests/hyperfide/qualify.py --case V-043 --manifest tests/hyperfide/manifests/tasks/13.2.json
```

Outputs: `artifacts/hyperfide/tasks/13.2/manifest.json`, `artifacts/hyperfide/tasks/13.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 13.4 — Integrate native quotas, permission profiles and autonomous escalation

Planning baseline pending · wave 11 · owner `connectors` · clause `13.4`

Requires: 13.1, 5.4.

1. Bind provider/model quotas and qualified approval/permission behaviour to the approved run policy; enforce bounded retry and escalation.
2. Exercise native interactive prompts/rate limits/auth failures and unsupported delegation; no hidden credential-sharing assumption or uncontrolled respawn loop is permitted.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/agents/admission.ts`, `tests/hyperfide/manifests/tasks/13.4.json`, `tests/hyperfide/cases/tasks/13_4.py`, `tests/hyperfide/registrations/13.4.json`, `services/hyperfide/components/13.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/13.4.json && python3 tests/hyperfide/qualify.py --case V-042 --manifest tests/hyperfide/manifests/tasks/13.4.json && python3 tests/hyperfide/qualify.py --case V-044 --manifest tests/hyperfide/manifests/tasks/13.4.json
```

Outputs: `artifacts/hyperfide/tasks/13.4/manifest.json`, `artifacts/hyperfide/tasks/13.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 16.2 — Reject false qualification from missing checks and legacy force paths

Planning baseline pending · wave 12 · owner `assurance` · clause `16.2`

Requires: 16.1, 27.1.

1. Execute registered gates with complete command/environment/exit/artifact receipts; reject skipped/empty/unknown/interrupted/stale required checks.
2. Import forced-done KVX/task and proof-text-only records as history; assert those states never release qualification-dependent work.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/assurance/executor.ts`, `tests/hyperfide/manifests/tasks/16.2.json`, `tests/hyperfide/cases/tasks/16_2.py`, `tests/hyperfide/registrations/16.2.json`, `services/hyperfide/components/16.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-013 --manifest tests/hyperfide/manifests/tasks/16.2.json && python3 tests/hyperfide/qualify.py --case V-056 --manifest tests/hyperfide/manifests/tasks/16.2.json
```

Outputs: `artifacts/hyperfide/tasks/16.2/manifest.json`, `artifacts/hyperfide/tasks/16.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 17.1 — Discover every commit and enforce the full watcher obligation matrix

Planning baseline pending · wave 12 · owner `review` · clause `17.1`

Requires: 16.1, 13.1.

1. Discover attributable commits durably and create obligations for every one of the configured10–15 watchers per commit by default.
2. Omit/duplicate reviews, rewrite history and replace a watcher; missing no-finding receipts stay visible, and specialist sharding requires an approved policy change.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/review/coverage.ts`, `tests/hyperfide/manifests/tasks/17.1.json`, `tests/hyperfide/cases/tasks/17_1.py`, `tests/hyperfide/registrations/17.1.json`, `services/hyperfide/components/17.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-031 --manifest tests/hyperfide/manifests/tasks/17.1.json
```

Outputs: `artifacts/hyperfide/tasks/17.1/manifest.json`, `artifacts/hyperfide/tasks/17.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 22.2 — Measure calibrated quality, latency and billed cost against baseline

Planning baseline pending · wave 12 · owner `evaluation` · clause `22.2`

Requires: 22.1, 20.3.

1. Measure per-purpose precision/recall/calibration/abstention risk/coverage, latency distributions/errors/actual usage and cost per qualified outcome.
2. Compare all three candidates to declared current-policy baseline with uncertainty; vendor benchmarks and raw token reduction are not workload success evidence.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/evaluation/scorecard.ts`, `tests/hyperfide/manifests/tasks/22.2.json`, `tests/hyperfide/cases/tasks/22_2.py`, `tests/hyperfide/registrations/22.2.json`, `services/hyperfide/components/22.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-046 --manifest tests/hyperfide/manifests/tasks/22.2.json
```

Outputs: `artifacts/hyperfide/tasks/22.2/manifest.json`, `artifacts/hyperfide/tasks/22.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 23.2 — Account for distinct infrastructure and model resource dimensions

Planning baseline pending · wave 11 · owner `observability` · clause `23.2`

Requires: 5.4, 8.2, 12.3.

1. Report reservations and measured CPU/RAM/disk/build/link/test/exclusive/index/model/API dimensions per profile and observed utilisation.
2. Exercise more than two density profiles and saturation; do not infer uniform per-agent capacity or use prepared spares as observed running sessions.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/observability/resources.ts`, `tests/hyperfide/manifests/tasks/23.2.json`, `tests/hyperfide/cases/tasks/23_2.py`, `tests/hyperfide/registrations/23.2.json`, `services/hyperfide/components/23.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-007 --manifest tests/hyperfide/manifests/tasks/23.2.json && python3 tests/hyperfide/qualify.py --case V-048 --manifest tests/hyperfide/manifests/tasks/23.2.json
```

Outputs: `artifacts/hyperfide/tasks/23.2/manifest.json`, `artifacts/hyperfide/tasks/23.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 13.3 — Recover transport and process loss with explicit context outcomes

Planning baseline pending · wave 12 · owner `connectors` · clause `13.3`

Requires: 13.2, 15.3.

1. Inspect/reconnect existing native execution on transport loss; resume qualified state or create a new identified session from provenance-bearing handoff on process loss.
2. Inject partial protocol writes, dead pipes, expired auth and absent resume state; report context loss and prevent silent source/session substitution.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/connector_recovery.c`, `tests/hyperfide/manifests/tasks/13.3.json`, `tests/hyperfide/cases/tasks/13_3.py`, `tests/hyperfide/registrations/13.3.json`, `src/hyperfide/components/13.3.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-043 --manifest tests/hyperfide/manifests/tasks/13.3.json && python3 tests/hyperfide/qualify.py --case V-044 --manifest tests/hyperfide/manifests/tasks/13.3.json
```

Outputs: `artifacts/hyperfide/tasks/13.3/manifest.json`, `artifacts/hyperfide/tasks/13.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 16.3 — Record clause evidence and policy-limited independent review judgements

Planning baseline pending · wave 13 · owner `assurance` · clause `16.3`

Requires: 16.2, 2.4.

1. Map assertions and permitted rubric judgements to exact acceptance clauses with reviewer identity, support and limitations.
2. Link one test to a multi-clause requirement and prove uncovered clauses stay open; model confidence cannot fill required executable proof.
3. Accept qualification only against the exact current submission/custody generation and retain active custody after PASS; race revocation/reassignment and reject the losing expected-version transition independently of the former worker compute lease.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/assurance/coverage.ts`, `tests/hyperfide/manifests/tasks/16.3.json`, `tests/hyperfide/cases/tasks/16_3.py`, `tests/hyperfide/registrations/16.3.json`, `services/hyperfide/components/16.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-013 --manifest tests/hyperfide/manifests/tasks/16.3.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/16.3.json
```

Outputs: `artifacts/hyperfide/tasks/16.3/manifest.json`, `artifacts/hyperfide/tasks/16.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 21.2 — Rank policy-permitted recovery actions from preserved failure packets

Planning baseline pending · wave 13 · owner `decisions` · clause `21.2`

Requires: 20.4, 13.4, 16.2.

1. Build failure/context/resource packets and recommend only allowed retry/context/profile/manager/insufficient-evidence responses.
2. Migrate existing failure triage; each repeated attempt records what changed and outage/stale advice uses deterministic bounded fallback.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/recovery.ts`, `tests/hyperfide/manifests/tasks/21.2.json`, `tests/hyperfide/cases/tasks/21_2.py`, `tests/hyperfide/registrations/21.2.json`, `services/hyperfide/components/21.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/21.2.json && python3 tests/hyperfide/qualify.py --case V-044 --manifest tests/hyperfide/manifests/tasks/21.2.json
```

Outputs: `artifacts/hyperfide/tasks/21.2/manifest.json`, `artifacts/hyperfide/tasks/21.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 16.4 — Invalidate affected assurance while retaining task history

Planning baseline pending · wave 14 · owner `assurance` · clause `16.4`

Requires: 16.3, 7.3.

1. Separate progress/milestones from CURRENT/STALE/MISSING evidence applicability and compute invalidation for relevant input changes.
2. Change source/dependency/toolchain/config/graph/contract independently and irrelevant input separately; retain historical passes and schedule only justified requalification.
3. After terminal integration releases custody, schedule fresh coordinator-owned requalification operations from immutable integration receipts; never resurrect the released custody or original worker compute lease.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/assurance/validity.ts`, `tests/hyperfide/manifests/tasks/16.4.json`, `tests/hyperfide/cases/tasks/16_4.py`, `tests/hyperfide/registrations/16.4.json`, `services/hyperfide/components/16.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-014 --manifest tests/hyperfide/manifests/tasks/16.4.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/16.4.json
```

Outputs: `artifacts/hyperfide/tasks/16.4/manifest.json`, `artifacts/hyperfide/tasks/16.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 17.2 — Build producer-consumer contracts and behavioural impact analysis

Planning baseline pending · wave 14 · owner `review` · clause `17.2`

Requires: 7.4, 16.3.

1. Version schemas/signatures/errors/auth/state/units/precision/ordering/idempotency/compatibility obligations and affected consumers across repositories.
2. Inject unchanged-signature stale-price/unit/error-order defects and unknown graph edges; emit cross-component reproductions rather than infer correctness from symbols.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/review/contracts.ts`, `tests/hyperfide/manifests/tasks/17.2.json`, `tests/hyperfide/cases/tasks/17_2.py`, `tests/hyperfide/registrations/17.2.json`, `services/hyperfide/components/17.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-029 --manifest tests/hyperfide/manifests/tasks/17.2.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/17.2.json
```

Outputs: `artifacts/hyperfide/tasks/17.2/manifest.json`, `artifacts/hyperfide/tasks/17.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 18.1 — Implement canonical findings and provenance-preserving deduplication

Planning baseline pending · wave 14 · owner `findings` · clause `18.1`

Requires: 16.3, 3.1.

1. Store affected contract/revision/evidence/severity/origin/owner/collaborators/resolution conditions and related duplicate observations.
2. Merge duplicate suggestions without losing reports or creating uncontrolled repairs; ambiguous cross-feature accountability remains explicit for leader resolution.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/findings/registry.ts`, `tests/hyperfide/manifests/tasks/18.1.json`, `tests/hyperfide/cases/tasks/18_1.py`, `tests/hyperfide/registrations/18.1.json`, `services/hyperfide/components/18.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-032 --manifest tests/hyperfide/manifests/tasks/18.1.json
```

Outputs: `artifacts/hyperfide/tasks/18.1/manifest.json`, `artifacts/hyperfide/tasks/18.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 24.1 — Recover supervisory desired state and bounded offline continuation

Planning baseline pending · wave 13 · owner `recovery` · clause `24.1`

Requires: 6.4, 3.4, 13.3.

1. Reconstruct runs/packages/instructions and adopt valid supervisors/sessions after control or main-server loss with approved conservative offline policy.
2. Expose single supervisory failure domain and require separately qualified standby before uninterrupted failover claims; healthy remote work is not needlessly duplicated.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/recovery/control.ts`, `tests/hyperfide/manifests/tasks/24.1.json`, `tests/hyperfide/cases/tasks/24_1.py`, `tests/hyperfide/registrations/24.1.json`, `services/hyperfide/components/24.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-008 --manifest tests/hyperfide/manifests/tasks/24.1.json && python3 tests/hyperfide/qualify.py --case V-043 --manifest tests/hyperfide/manifests/tasks/24.1.json
```

Outputs: `artifacts/hyperfide/tasks/24.1/manifest.json`, `artifacts/hyperfide/tasks/24.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 17.3 — Persist revision-specific review receipts and invalidate stale conclusions

Planning baseline pending · wave 15 · owner `review` · clause `17.3`

Requires: 17.1, 17.2, 16.4.

1. Record reviewer/rubric/contract/spec/source/dependency inputs, coverage, findings and limitations; invalidate relevant changed inputs.
2. Ensure duplicate reviewer activity cannot substitute a required independent obligation and decision-model risk ranks never certify correctness.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/review/receipts.ts`, `tests/hyperfide/manifests/tasks/17.3.json`, `tests/hyperfide/cases/tasks/17_3.py`, `tests/hyperfide/registrations/17.3.json`, `services/hyperfide/components/17.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-031 --manifest tests/hyperfide/manifests/tasks/17.3.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/17.3.json
```

Outputs: `artifacts/hyperfide/tasks/17.3/manifest.json`, `artifacts/hyperfide/tasks/17.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 17.4 — Dispatch remote reproductions and contract/system qualification jobs

Planning baseline pending · wave 15 · owner `review` · clause `17.4`

Requires: 17.2, 16.2, 11.3.

1. Run reproductions and contract/system scenarios remotely with identified candidate inputs; retain projection conflicts as uncertain guidance.
2. Demonstrate separately passing components fail an integrated behavioural fixture and prove no main-server execution was scheduled.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/review/reproductions.ts`, `tests/hyperfide/manifests/tasks/17.4.json`, `tests/hyperfide/cases/tasks/17_4.py`, `tests/hyperfide/registrations/17.4.json`, `services/hyperfide/components/17.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-029 --manifest tests/hyperfide/manifests/tasks/17.4.json && python3 tests/hyperfide/qualify.py --case V-030 --manifest tests/hyperfide/manifests/tasks/17.4.json && python3 tests/hyperfide/qualify.py --case V-052 --manifest tests/hyperfide/manifests/tasks/17.4.json
```

Outputs: `artifacts/hyperfide/tasks/17.4/manifest.json`, `artifacts/hyperfide/tasks/17.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 18.2 — Project findings to GitHub with ten-minute reconciliation

Planning baseline pending · wave 15 · owner `findings` · clause `18.2`

Requires: 18.1, 6.2, 14.2.

1. Implement authenticated webhooks plus idempotent issue outbox/inbox and bounded ten-minute periodic external reconciliation.
2. Lose create acknowledgements/webhooks and replay external events; preserve one internal mapping, detect externally created issues and report API outage backlog.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/findings/github.ts`, `tests/hyperfide/manifests/tasks/18.2.json`, `tests/hyperfide/cases/tasks/18_2.py`, `tests/hyperfide/registrations/18.2.json`, `services/hyperfide/components/18.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-032 --manifest tests/hyperfide/manifests/tasks/18.2.json
```

Outputs: `artifacts/hyperfide/tasks/18.2/manifest.json`, `artifacts/hyperfide/tasks/18.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 18.3 — Route findings through revision, attempt and current accountable manager

Planning baseline pending · wave 15 · owner `findings` · clause `18.3`

Requires: 18.1, 3.4.

1. Resolve finding→reviewed revision→commit/attempt→feature→current manager with explicit collaborators and durable routing acknowledgement.
2. Reorder/duplicate events and transfer managers; no finding silently drops, routes only to a dead owner or starts duplicate repair authority.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/findings/routing.ts`, `tests/hyperfide/manifests/tasks/18.3.json`, `tests/hyperfide/cases/tasks/18_3.py`, `tests/hyperfide/registrations/18.3.json`, `services/hyperfide/components/18.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-032 --manifest tests/hyperfide/manifests/tasks/18.3.json && python3 tests/hyperfide/qualify.py --case V-008 --manifest tests/hyperfide/manifests/tasks/18.3.json
```

Outputs: `artifacts/hyperfide/tasks/18.3/manifest.json`, `artifacts/hyperfide/tasks/18.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 21.3 — Rank eligible frontier profiles, optional context and review/finding advice

Planning baseline pending · wave 15 · owner `decisions` · clause `21.3`

Requires: 20.4, 5.4, 18.1, 17.2.

1. Rank only deterministically eligible frontier choices and optional packet context; offer semantic routing/duplicate suggestions while preserving evidence/ownership.
2. Retain required packet intent and migrate guard/readiness/memory/recap consumers through explicit capability/purpose policy; no advisory output grants authority.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/decisions/ranking.ts`, `tests/hyperfide/manifests/tasks/21.3.json`, `tests/hyperfide/cases/tasks/21_3.py`, `tests/hyperfide/registrations/21.3.json`, `services/hyperfide/components/21.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/21.3.json
```

Outputs: `artifacts/hyperfide/tasks/21.3/manifest.json`, `artifacts/hyperfide/tasks/21.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 23.1 — Expose desired/observed fleet state, evidence and critical paths

Planning baseline pending · wave 15 · owner `observability` · clause `23.1`

Requires: 3.3, 5.4, 16.4.

1. Provide leader-facing run/task/attempt/agent/sandbox state with freshness, queue reasons, review/integration backlog, evidence validity and critical dependency paths.
2. Inject stale observations and verbose no-op activity; neither live PID nor log volume becomes useful-progress completion.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/observability/views.ts`, `tests/hyperfide/manifests/tasks/23.1.json`, `tests/hyperfide/cases/tasks/23_1.py`, `tests/hyperfide/registrations/23.1.json`, `services/hyperfide/components/23.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-010 --manifest tests/hyperfide/manifests/tasks/23.1.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/23.1.json
```

Outputs: `artifacts/hyperfide/tasks/23.1/manifest.json`, `artifacts/hyperfide/tasks/23.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 23.3 — Instrument lifecycle, graph freshness, recovery and qualified outcome cost

Planning baseline pending · wave 15 · owner `observability` · clause `23.3`

Requires: 6.4, 7.3, 16.4, 21.4.

1. Collect readiness/start/preparation/lease/result/event/replica/graph/recovery/qualification/retry/cost metrics with bounded cardinality and provenance.
2. Compare controlled mixed-load baseline and current distributions; unknown measurements stay absent/labelled and queued waiting is separate from API latency.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/observability/metrics.ts`, `tests/hyperfide/manifests/tasks/23.3.json`, `tests/hyperfide/cases/tasks/23_3.py`, `tests/hyperfide/registrations/23.3.json`, `services/hyperfide/components/23.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-011 --manifest tests/hyperfide/manifests/tasks/23.3.json && python3 tests/hyperfide/qualify.py --case V-048 --manifest tests/hyperfide/manifests/tasks/23.3.json
```

Outputs: `artifacts/hyperfide/tasks/23.3/manifest.json`, `artifacts/hyperfide/tasks/23.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 24.2 — Recover lost sandboxes and processes with fenced compatible replacement

Planning baseline pending · wave 14 · owner `recovery` · clause `24.2`

Requires: 24.1, 8.4, 15.3.

1. Fence old ownership, inventory surviving processes/artifacts and restore compatible source/session/environment into new identified attempts.
2. Partition and later return old/new workers in both orders; stale outputs retain provenance but cannot publish authoritative completion.
3. Sandbox loss revokes unfinished compute authority while preserving active custody whose complete immutable inputs are already durable; recover lost qualification jobs under their own leases rather than restarting the coding attempt.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/recovery/workers.ts`, `tests/hyperfide/manifests/tasks/24.2.json`, `tests/hyperfide/cases/tasks/24_2.py`, `tests/hyperfide/registrations/24.2.json`, `services/hyperfide/components/24.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-004 --manifest tests/hyperfide/manifests/tasks/24.2.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/24.2.json && python3 tests/hyperfide/qualify.py --case V-049 --manifest tests/hyperfide/manifests/tasks/24.2.json
```

Outputs: `artifacts/hyperfide/tasks/24.2/manifest.json`, `artifacts/hyperfide/tasks/24.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 25.3 — Route CLI, MCP, editor, hooks and offline workflows through authority modes

Planning baseline pending · wave 15 · owner `migration` · clause `25.3`

Requires: 4.3, 6.3, 16.4, 2.1, 12.2, 14.1, 12.1, 1.4.

1. Integrate distributed API transport and explicit local/offline modes with work_open/update/handoff/projection/docs, CLI/MCP/editor/hooks contracts.
2. With network/PG/model credentials absent retain promised local core functions, show cache freshness and forbid offline remote ownership or stale projection overwrite.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Take Makefile ownership from task12.1 and native component_main.c/components.h dispatch/ABI ownership from task1.4. Link the registered nested src/hyperfide component and transport sources into the real public CLI/MCP binary; the existing src/*.c wildcard cannot discover them. Preserve the standalone runner build without linking two main functions, and exercise the public CLI against the running coordinator.
5. Reuse the established task12.1 native HTTPS transport and task14.1 protocol for the existing CLI/MCP/editor/hooks authority facade. Do not introduce an independent late RPC implementation, duplicate shared pools, or a path that bypasses trusted identity and expected-version checks.
6. Exercise real existing CLI and MCP entrypoints against the running coordinator, including nonzero structured errors and offline refusal of distributed authority; direct client helper calls alone cannot establish public entrypoint integration.
7. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/client.c`, `tests/hyperfide/manifests/tasks/25.3.json`, `src/main.c`, `src/mcp.c`, `src/integrate.c`, `src/govern.c`, `src/spec.c`, `src/orchestrate.c`, `editors/vscode/extension.js`, `tests/hyperfide/cases/tasks/25_3.py`, `tests/hyperfide/registrations/25.3.json`, `src/hyperfide/components/25.3.kvx`, `Makefile`, `src/hyperfide/component_main.c`, `src/hyperfide/components.h`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-019 --manifest tests/hyperfide/manifests/tasks/25.3.json && python3 tests/hyperfide/qualify.py --case V-027 --manifest tests/hyperfide/manifests/tasks/25.3.json && python3 tests/hyperfide/qualify.py --case V-028 --manifest tests/hyperfide/manifests/tasks/25.3.json
```

Outputs: `artifacts/hyperfide/tasks/25.3/manifest.json`, `artifacts/hyperfide/tasks/25.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 18.4 — Close findings only after fenced repair and recorded resolution proof

Planning baseline pending · wave 16 · owner `findings` · clause `18.4`

Requires: 18.3, 16.4.

1. Create ordinary scoped fenced repair attempts and execute recorded resolution conditions on intended revisions before marking assurance restored.
2. Externally close an issue without a fix and reopen after relevant change; repair retries are bounded and preserve current evidence links.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/findings/remediation.ts`, `tests/hyperfide/manifests/tasks/18.4.json`, `tests/hyperfide/cases/tasks/18_4.py`, `tests/hyperfide/registrations/18.4.json`, `services/hyperfide/components/18.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-032 --manifest tests/hyperfide/manifests/tasks/18.4.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/18.4.json
```

Outputs: `artifacts/hyperfide/tasks/18.4/manifest.json`, `artifacts/hyperfide/tasks/18.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 22.3 — Run shadow evaluation then bounded controlled decision trials

Planning baseline pending · wave 16 · owner `evaluation` · clause `22.3`

Requires: 22.2, 21.1, 21.2, 21.3.

1. Implement shadow-only collection and separately approved bounded live policy trials with declared outcome measures and stop conditions.
2. Report retries, qualified throughput and total cost; do not infer counterfactual scheduling improvement from recommendation agreement alone.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/evaluation/trials.ts`, `tests/hyperfide/manifests/tasks/22.3.json`, `tests/hyperfide/cases/tasks/22_3.py`, `tests/hyperfide/registrations/22.3.json`, `services/hyperfide/components/22.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-046 --manifest tests/hyperfide/manifests/tasks/22.3.json
```

Outputs: `artifacts/hyperfide/tasks/22.3/manifest.json`, `artifacts/hyperfide/tasks/22.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 23.4 — Deliver bounded actionable notifications and durable evidence links

Planning baseline pending · wave 16 · owner `observability` · clause `23.4`

Requires: 23.1, 6.2.

1. Send scoped leader/manager exceptions through durable delivery with page budgets, deduplication and retrievable evidence links.
2. Flood logs/events/alerts during72-hour-equivalent workload; buffers, connections and database writes remain bounded without hiding required failures.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/observability/notifications.ts`, `tests/hyperfide/manifests/tasks/23.4.json`, `tests/hyperfide/cases/tasks/23_4.py`, `tests/hyperfide/registrations/23.4.json`, `services/hyperfide/components/23.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-016 --manifest tests/hyperfide/manifests/tasks/23.4.json && python3 tests/hyperfide/qualify.py --case V-048 --manifest tests/hyperfide/manifests/tasks/23.4.json
```

Outputs: `artifacts/hyperfide/tasks/23.4/manifest.json`, `artifacts/hyperfide/tasks/23.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 24.3 — Implement scoped pause, drain, cancel and fleet stop controllers

Planning baseline pending · wave 15 · owner `recovery` · clause `24.3`

Requires: 12.4, 24.2, 15.4.

1. Enforce enclosing run controls over package/attempt/sandbox scopes; revoke authority, deliver termination and preserve required artifacts with idempotent cleanup.
2. Stop during prepare/build/review/publication and restart controller; report confirmed inventory and explicit unreachable-resource debt before declaring stop complete.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/recovery/stop.ts`, `tests/hyperfide/manifests/tasks/24.3.json`, `tests/hyperfide/cases/tasks/24_3.py`, `tests/hyperfide/registrations/24.3.json`, `services/hyperfide/components/24.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-017 --manifest tests/hyperfide/manifests/tasks/24.3.json && python3 tests/hyperfide/qualify.py --case V-054 --manifest tests/hyperfide/manifests/tasks/24.3.json
```

Outputs: `artifacts/hyperfide/tasks/24.3/manifest.json`, `artifacts/hyperfide/tasks/24.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 25.4 — Build reproducible releases and deploy prebuilt services in compatibility order

Planning baseline pending · wave 16 · owner `deployment` · clause `25.4`

Requires: 25.3, 4.4, 12.4, 13.4, 1.1.

1. Produce remote native/TS builds with pinned dependencies/SDKs/runtime, capability/schema/protocol manifests, authenticated artifacts and service definitions.
2. Install only verified prebuilt outputs on supervision host; test expand/contract upgrade ordering and refusal of unsupported runner/client/schema combinations.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/deployment/releases.ts`, `tests/hyperfide/manifests/tasks/25.4.json`, `deploy/hyperfide/control.service`, `deploy/hyperfide/provisioner.service`, `deploy/hyperfide/dispatch.service`, `scripts/build-hyperfide-release.sh`, `tests/hyperfide/cases/tasks/25_4.py`, `tests/hyperfide/registrations/25.4.json`, `services/hyperfide/components/25.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-028 --manifest tests/hyperfide/manifests/tasks/25.4.json && python3 tests/hyperfide/qualify.py --case V-052 --manifest tests/hyperfide/manifests/tasks/25.4.json && python3 tests/hyperfide/qualify.py --case V-055 --manifest tests/hyperfide/manifests/tasks/25.4.json
```

Outputs: `artifacts/hyperfide/tasks/25.4/manifest.json`, `artifacts/hyperfide/tasks/25.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 19.1 — Build immutable multi-repository integration candidates remotely

Planning baseline pending · wave 17 · owner `integration` · clause `19.1`

Requires: 16.4, 17.4, 18.4.

1. Assemble exact qualified commit sets with environment/graph/contract manifests and run mechanical/semantic/regression/system gates remotely.
2. Change one source/dependency input during qualification; affected gates invalidate while historical isolated task results remain intact.
3. Pin active custody generations for newly pending contributors and prior integration receipts for already integrated base inputs; remote candidate verification has its own job authority and resource reservation.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/integration/candidates.ts`, `tests/hyperfide/manifests/tasks/19.1.json`, `tests/hyperfide/cases/tasks/19_1.py`, `tests/hyperfide/registrations/19.1.json`, `services/hyperfide/components/19.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-030 --manifest tests/hyperfide/manifests/tasks/19.1.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/19.1.json
```

Outputs: `artifacts/hyperfide/tasks/19.1/manifest.json`, `artifacts/hyperfide/tasks/19.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 22.4 — Gate decision promotion, drift rollback and optional Span self-hosting

Planning baseline pending · wave 17 · owner `evaluation` · clause `22.4`

Requires: 22.3.

1. Version purpose/model/route/rubric thresholds and rollback on drift; replay before promotion or capability change.
2. Keep self-host Span optional, with separate remote GPU/licence/engine/correctness/overload/restart qualification; absent GPU cannot block hosted baseline release.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/evaluation/promotion.ts`, `tests/hyperfide/manifests/tasks/22.4.json`, `tests/hyperfide/cases/tasks/22_4.py`, `tests/hyperfide/registrations/22.4.json`, `services/hyperfide/components/22.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/22.4.json && python3 tests/hyperfide/qualify.py --case V-046 --manifest tests/hyperfide/manifests/tasks/22.4.json
```

Outputs: `artifacts/hyperfide/tasks/22.4/manifest.json`, `artifacts/hyperfide/tasks/22.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 26.1 — Apply Hyperfide identity to owned product and distribution surfaces

Planning baseline pending · wave 17 · owner `branding` · clause `26.1`

Requires: 25.4.

1. Inventory compatibility/history/third-party names and update CLI/version/installers/packages/editor/MCP/docs/runtime/agent identity through their owning sources.
2. Compare user-facing brand completeness while preserving immutable historical feature/task/commit evidence and native provider identifiers.
3. Link this module through its task-owned native component/build fragment and exercise the resulting runner/client interface; disconnected compilation cannot satisfy the component gate. Public legacy/new CLI integration remains task25.3/26.2 responsibility.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `src/hyperfide/branding.c`, `tests/hyperfide/manifests/tasks/26.1.json`, `src/cg.h`, `scripts/install.sh`, `scripts/release.sh`, `editors/vscode/package.json`, `tests/hyperfide/cases/tasks/26_1.py`, `tests/hyperfide/registrations/26.1.json`, `src/hyperfide/components/26.1.kvx`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-026 --manifest tests/hyperfide/manifests/tasks/26.1.json && python3 tests/hyperfide/qualify.py --case V-028 --manifest tests/hyperfide/manifests/tasks/26.1.json
```

Outputs: `artifacts/hyperfide/tasks/26.1/manifest.json`, `artifacts/hyperfide/tasks/26.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 19.2 — Enforce sole protected-target publication gateway and CAS reconciliation

Planning baseline pending · wave 18 · owner `integration` · clause `19.2`

Requires: 19.1, 14.4, 5.2.

1. Give only the publication path protected-ref credentials; bind durable intents to expected head/candidate/generation/evidence and enforce actual Git-side authorisation.
2. Advance target head, lose Git response, return stale worker and attempt direct protected push; read back unknown outcomes before supersession and never equate a DB lease with Git fencing.
3. Maintain active contributor custody through uncertain publication and bind the separate integration publication fence; serialize explicit custody revocation with publication admission, reconcile actual Git outcomes, and release custody only by terminal integration/disposition.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/integration/publication.ts`, `tests/hyperfide/manifests/tasks/19.2.json`, `tests/hyperfide/cases/tasks/19_2.py`, `tests/hyperfide/registrations/19.2.json`, `services/hyperfide/components/19.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-033 --manifest tests/hyperfide/manifests/tasks/19.2.json
```

Outputs: `artifacts/hyperfide/tasks/19.2/manifest.json`, `artifacts/hyperfide/tasks/19.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 26.2 — Ship canonical hyperfide entrypoint with explicit cg compatibility policy

Planning baseline pending · wave 18 · owner `branding` · clause `26.2`

Requires: 26.1, 25.3.

1. Implement proposed hyperfide command and cg alias with argument/JSON/exit parity and nonrecursive executable resolution.
2. Resolve approved release version/support window and public namespace ownership separately; never reserve or assume short alias/domain/package availability.
3. Take Makefile ownership after task25.3 and installer/release-script ownership after task26.1. Build and install an actual canonical hyperfide executable and the approved cg compatibility entrypoint from the same qualified linked implementation; a wrapper over an unbuilt or unrelated PATH executable is insufficient. Preserve all native component, libcurl and TLS link dependencies without duplicate standalone-main objects.
4. Update the actual installer, release and uninstaller paths to consume the approved canonical artifact manifest and install/remove both declared command names safely. Existing scripts/release.sh hardcodes strip/publish cg and overrides LDLIBS with legacy static flags; preserve the qualified link contract and explicitly package any required runtime libraries rather than silently dropping the new transport. Namespace and publication destinations remain configuration, never invented ownership.
5. Qualify clean remote builds, installation to a disposable prefix, both command names, argument/JSON/exit parity and uninstall against the real produced artifacts. Run documented release construction in a nonpublishing fixture; this task does not independently authorize production publication.
6. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `scripts/hyperfide-entrypoint.sh`, `tests/hyperfide/manifests/tasks/26.2.json`, `tests/hyperfide/cases/tasks/26_2.py`, `tests/hyperfide/registrations/26.2.json`, `Makefile`, `scripts/install.sh`, `scripts/release.sh`, `scripts/uninstall.sh`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-026 --manifest tests/hyperfide/manifests/tasks/26.2.json && python3 tests/hyperfide/qualify.py --case V-028 --manifest tests/hyperfide/manifests/tasks/26.2.json
```

Outputs: `artifacts/hyperfide/tasks/26.2/manifest.json`, `artifacts/hyperfide/tasks/26.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 19.3 — Evaluate task, wave and programme closure against required milestones

Planning baseline pending · wave 19 · owner `integration` · clause `19.3`

Requires: 19.2, 16.3, 18.4.

1. Release dependencies only at their declared qualified/integrated milestone; require accepted candidate, current criteria/reviews and blocking-finding dispositions.
2. Fail a wave gate despite passing tasks and withhold downstream/activation release; programme closure includes specified end-to-end/rehearsal obligations.
3. Compute task qualification from current custody and subsequent integration/requalification receipts; a coding lease expiring cannot invalidate admitted work or admit a competing replacement.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/integration/closure.ts`, `tests/hyperfide/manifests/tasks/19.3.json`, `tests/hyperfide/cases/tasks/19_3.py`, `tests/hyperfide/registrations/19.3.json`, `services/hyperfide/components/19.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/19.3.json
```

Outputs: `artifacts/hyperfide/tasks/19.3/manifest.json`, `artifacts/hyperfide/tasks/19.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 26.3 — Migrate config, directories and variable aliases with backups and conflict checks

Planning baseline pending · wave 19 · owner `branding` · clause `26.3`

Requires: 26.2, 25.1.

1. Convert codify.kvx/data/env paths through explicit manifests and atomic backups; preserve workspace/session/hook/task-tag links and original provenance.
2. Test both config names, conflicting auth/authority variables and interrupted migration; preserve native auth directories and user-owned customisations.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/migration/names.ts`, `tests/hyperfide/manifests/tasks/26.3.json`, `tests/hyperfide/cases/tasks/26_3.py`, `tests/hyperfide/registrations/26.3.json`, `services/hyperfide/components/26.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-026 --manifest tests/hyperfide/manifests/tasks/26.3.json && python3 tests/hyperfide/qualify.py --case V-055 --manifest tests/hyperfide/manifests/tasks/26.3.json
```

Outputs: `artifacts/hyperfide/tasks/26.3/manifest.json`, `artifacts/hyperfide/tasks/26.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 19.4 — Publish explicit partial outcomes behind multi-repository release barrier

Planning baseline pending · wave 20 · owner `integration` · clause `19.4`

Requires: 19.2, 19.3.

1. Persist programme commit-set manifests, per-repository publication outcomes and release-barrier state with compensating recovery policy.
2. Interrupt between ordinary Git pushes and crash gateway; partial sets cannot appear as approved release or pretend atomic multi-repository transaction semantics.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/integration/release_barrier.ts`, `tests/hyperfide/manifests/tasks/19.4.json`, `tests/hyperfide/cases/tasks/19_4.py`, `tests/hyperfide/registrations/19.4.json`, `services/hyperfide/components/19.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-030 --manifest tests/hyperfide/manifests/tasks/19.4.json && python3 tests/hyperfide/qualify.py --case V-033 --manifest tests/hyperfide/manifests/tasks/19.4.json
```

Outputs: `artifacts/hyperfide/tasks/19.4/manifest.json`, `artifacts/hyperfide/tasks/19.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 26.4 — Regenerate owned guidance and verify old/new integration parity

Planning baseline pending · wave 20 · owner `branding` · clause `26.4`

Requires: 26.3, 25.3.

1. Update generator-owned workflow/templates and regenerate AGENTS/CLAUDE/context/codemap/spec mirrors after approval; migrate owned MCP/hooks/editor assets with backups.
2. Test old/new commands/resources/settings, one active hook/server implementation and active session links; never hand-edit generated ownership or erase historic evidence.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Transfer ownership of src/spec.c from completed task25.3 before changing the existing C spec renderer; update the actual src/agent.c agent-context generator and plain-JavaScript editor sources rather than introducing replacement paths inferred from stale generated guidance.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/migration/generated.ts`, `tests/hyperfide/manifests/tasks/26.4.json`, `AGENTS.md`, `CLAUDE.md`, `CODEMAP.md`, `src/spec.c`, `src/agent.c`, `src/codemap.c`, `tests/hyperfide/cases/tasks/26_4.py`, `tests/hyperfide/registrations/26.4.json`, `services/hyperfide/components/26.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-026 --manifest tests/hyperfide/manifests/tasks/26.4.json && python3 tests/hyperfide/qualify.py --case V-027 --manifest tests/hyperfide/manifests/tasks/26.4.json
```

Outputs: `artifacts/hyperfide/tasks/26.4/manifest.json`, `artifacts/hyperfide/tasks/26.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 25.2 — Rehearse single-authority cutover and separate rollback boundaries

Planning baseline pending · wave 21 · owner `migration` · clause `25.2`

Requires: 25.1, 7.4, 4.4, 24.3, 26.4, 25.4.

1. Quiesce all legacy writers, snapshot/import/reconcile source/Git/artifacts and commit one named authority epoch; allow read-only shadow comparison only.
2. Rehearse rollback before new writes and recovery/reverse migration after external effects; old SQLite snapshot cannot reopen as current distributed authority.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/migration/cutover.ts`, `tests/hyperfide/manifests/tasks/25.2.json`, `tests/hyperfide/cases/tasks/25_2.py`, `tests/hyperfide/registrations/25.2.json`, `services/hyperfide/components/25.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-019 --manifest tests/hyperfide/manifests/tasks/25.2.json && python3 tests/hyperfide/qualify.py --case V-028 --manifest tests/hyperfide/manifests/tasks/25.2.json && python3 tests/hyperfide/qualify.py --case V-055 --manifest tests/hyperfide/manifests/tasks/25.2.json
```

Outputs: `artifacts/hyperfide/tasks/25.2/manifest.json`, `artifacts/hyperfide/tasks/25.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 24.4 — Exercise operational recovery runbooks and declared RPO/RTO

Planning baseline pending · wave 21 · owner `recovery` · clause `24.4`

Requires: 24.3, 4.4, 19.4.

1. Implement and remotely rehearse DB/object/Git/provider/auth/full-disk recovery with recorded proposed then measured RPO/RTO and non-reused restore epoch.
2. Restore inconsistent snapshots and corrupt objects; reconcile external effects and stale workers before resuming safe authority.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/recovery/drills.ts`, `tests/hyperfide/manifests/tasks/24.4.json`, `tests/hyperfide/cases/tasks/24_4.py`, `tests/hyperfide/registrations/24.4.json`, `services/hyperfide/components/24.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-009 --manifest tests/hyperfide/manifests/tasks/24.4.json && python3 tests/hyperfide/qualify.py --case V-049 --manifest tests/hyperfide/manifests/tasks/24.4.json && python3 tests/hyperfide/qualify.py --case V-053 --manifest tests/hyperfide/manifests/tasks/24.4.json
```

Outputs: `artifacts/hyperfide/tasks/24.4/manifest.json`, `artifacts/hyperfide/tasks/24.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 27.2 — Replay deterministic large-spec, mixed-graph and 1500-session schedules

Planning baseline pending · wave 21 · owner `qualification` · clause `27.2`

Requires: 5.4, 7.4, 23.4, 24.3, 19.4.

1. Implement independent reference-model schedules with the approved manifest-selected planning corpus, pinned graph corpora, 100 sandbox equivalents, 200 simultaneous slots, 1,500 session lifetimes, 72 virtual hours and multiple fault seeds.
2. Exercise stale generations, reversed commits, unknown creates, replica lag, saturation and cleanup; report simulation separately from live frontier evidence and measure baseline parity/performance.
3. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `tests/hyperfide/campaigns/deterministic.py`, `tests/hyperfide/manifests/tasks/27.2.json`, `tests/hyperfide/cases/tasks/27_2.py`, `tests/hyperfide/registrations/27.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-024 --manifest tests/hyperfide/manifests/tasks/27.2.json && python3 tests/hyperfide/qualify.py --case V-047 --manifest tests/hyperfide/manifests/tasks/27.2.json && python3 tests/hyperfide/qualify.py --case V-048 --manifest tests/hyperfide/manifests/tasks/27.2.json && python3 tests/hyperfide/qualify.py --case V-049 --manifest tests/hyperfide/manifests/tasks/27.2.json
```

Outputs: `artifacts/hyperfide/tasks/27.2/manifest.json`, `artifacts/hyperfide/tasks/27.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 27.3 — Qualify both live providers and native agents through staged48/72-hour fleet campaigns

Planning baseline pending · wave 22 · owner `qualification` · clause `27.3`

Requires: 27.2, 9.4, 10.4, 13.4, 11.4, 19.4, 23.3, 24.4, 22.4, 26.4, 1.2, 1.3, 14.4, 17.3, 18.2, 25.2.

1. Resolve actual account/auth/region/profile/SLO and sustained-concurrency window, qualify each provider separately in small canaries, then ramp the approved combined allocation through 2 slots → 10 sandboxes/20 sessions → 25/50 → 50/100 → 100 sandboxes/200 remote frontier sessions. The 100-sandbox target is the combined fleet; separate full-size provider soaks require an explicit additional campaign decision.
2. Run approved48-hour then72-hour/1500-session campaigns with real native workloads, graph/build/review/integration and credential renewal; record actual concurrency, per-provider evidence, main-host exclusion and full resource inventory.
3. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `tests/hyperfide/campaigns/live.py`, `tests/hyperfide/manifests/tasks/27.3.json`, `tests/hyperfide/cases/tasks/27_3.py`, `tests/hyperfide/registrations/27.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-036 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-037 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-038 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-039 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-041 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-042 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-043 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-044 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-045 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-046 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-050 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-051 --manifest tests/hyperfide/manifests/tasks/27.3.json && python3 tests/hyperfide/qualify.py --case V-052 --manifest tests/hyperfide/manifests/tasks/27.3.json
```

Outputs: `artifacts/hyperfide/tasks/27.3/manifest.json`, `artifacts/hyperfide/tasks/27.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 27.4 — Run composite fault qualification and independent invariant reconstruction

Planning baseline pending · wave 23 · owner `qualification` · clause `27.4`

Requires: 27.3, 24.4, 19.4.

1. Inject combined controller/DB/provider/credential/artifact/Git faults under declared mixed load, including lost Git acknowledgement and delayed old publishers.
2. Independently reconstruct accepted ownership, protected refs, receipts and resource inventory; zero conflicting accepted owners or unqualified publication is mandatory regardless of latency.
3. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `tests/hyperfide/campaigns/faults.py`, `tests/hyperfide/manifests/tasks/27.4.json`, `tests/hyperfide/cases/tasks/27_4.py`, `tests/hyperfide/registrations/27.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-002 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-003 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-004 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-005 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-009 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-010 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-012 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-015 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-016 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-017 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-033 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-037 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-040 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-049 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-053 --manifest tests/hyperfide/manifests/tasks/27.4.json && python3 tests/hyperfide/qualify.py --case V-054 --manifest tests/hyperfide/manifests/tasks/27.4.json
```

Outputs: `artifacts/hyperfide/tasks/27.4/manifest.json`, `artifacts/hyperfide/tasks/27.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 28.1 — Publish operational documentation from qualified implementation interfaces

Planning baseline pending · wave 23 · owner `documentation` · clause `28.1`

Requires: 26.4, 27.3.

1. Document actual API/CLI/roles/provider/auth/migration/rebrand/stop/recovery/retention and measured limits with architecture schematics and troubleshooting.
2. Execute documented workflows remotely on the candidate; label unsupported/proposed features and preserve real command output/evidence links without inventing guarantees.
3. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `docs/hyperfide/operations.md`, `tests/hyperfide/manifests/tasks/28.1.json`, `tests/hyperfide/cases/tasks/28_1.py`, `tests/hyperfide/registrations/28.1.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-028 --manifest tests/hyperfide/manifests/tasks/28.1.json && python3 tests/hyperfide/qualify.py --case V-035 --manifest tests/hyperfide/manifests/tasks/28.1.json && python3 tests/hyperfide/qualify.py --case V-052 --manifest tests/hyperfide/manifests/tasks/28.1.json && python3 tests/hyperfide/qualify.py --case V-055 --manifest tests/hyperfide/manifests/tasks/28.1.json
```

Outputs: `artifacts/hyperfide/tasks/28.1/manifest.json`, `artifacts/hyperfide/tasks/28.1/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 28.2 — Persist deterministic documentation closure snapshots and receipts

Planning baseline pending · wave 24 · owner `documentation` · clause `28.2`

Requires: 28.1, 19.3, 15.2.

1. Implement distributed virtual@docs packet/check/close against identified candidate with durable baseline/snapshot receipt and incremental reload.
2. Inject baseline persistence failure, stale inputs and lost fence; successful connector exit or warning-only failure cannot close docs or recursively dispatch a new run.
3. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
4. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/docs/closure.ts`, `tests/hyperfide/manifests/tasks/28.2.json`, `tests/hyperfide/cases/tasks/28_2.py`, `tests/hyperfide/registrations/28.2.json`, `services/hyperfide/components/28.2.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-035 --manifest tests/hyperfide/manifests/tasks/28.2.json
```

Outputs: `artifacts/hyperfide/tasks/28.2/manifest.json`, `artifacts/hyperfide/tasks/28.2/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 28.4 — Retain requirements, decisions, source evidence and implementation traceability

Planning baseline pending · wave 25 · owner `release` · clause `28.4`

Requires: 27.4, 28.2, 25.2, 19.4, 15.4.

1. Carry forward public requirements, source evidence, proposed decisions, open qualifications, diagrams, task graph and independent review dispositions into release records. Optional private source audits stay access-controlled and are never a public build or qualification dependency.
2. Validate bidirectional clause/task/case/evidence mappings against the implemented revision; distinguish original approval, pack review and actual product qualification.
3. Implement traceability validation before final readiness and prove rejection of missing/tampered mappings using controlled packs. Its receipt is an input to task28.3; it does not require final release closure already to exist.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/release/traceability.ts`, `tests/hyperfide/manifests/tasks/28.4.json`, `tests/hyperfide/cases/tasks/28_4.py`, `tests/hyperfide/registrations/28.4.json`, `services/hyperfide/components/28.4.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-024 --manifest tests/hyperfide/manifests/tasks/28.4.json && python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/28.4.json && python3 tests/hyperfide/qualify.py --case V-056 --manifest tests/hyperfide/manifests/tasks/28.4.json
```

Outputs: `artifacts/hyperfide/tasks/28.4/manifest.json`, `artifacts/hyperfide/tasks/28.4/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

### Task 28.3 — Assemble independent release readiness and complete closure evidence

Planning baseline pending · wave 26 · owner `release` · clause `28.3`

Requires: 27.4, 28.2, 25.2, 19.4, 15.4, 28.4.

1. Run every required full registered case/variant and reconstruct all112clause obligations, candidate/programme gates, policy findings, restore/rollback/cleanup and docs receipts.
2. Tamper with hashes, omit one case and retain an unexplained resource; reject closure until exact-current evidence is complete and unsupported features remain excluded.
3. First qualify the independent closure checker against complete controlled packs and missing/tampered negative packs. Then build the candidate evidence inventory including traceability and this checker self-test receipt; seal a final closure receipt only after every required external/full-case obligation is satisfied. The receipt names its validated input inventory and does not recursively require its own digest as an input.
4. Register this module through its task-owned component fragment in the established service entrypoint and verify its externally observable internal API behavior; an unreferenced source file or direct function-only test cannot satisfy the component gate.
5. Implement the task's registered positive/negative assertions and immutable manifest; execute them remotely after approval, preserving command, exact revisions, complete artifacts and independent observed outcomes.

Owns: `services/hyperfide/src/release/readiness.ts`, `tests/hyperfide/manifests/tasks/28.3.json`, `tests/hyperfide/cases/tasks/28_3.py`, `tests/hyperfide/registrations/28.3.json`, `services/hyperfide/components/28.3.json`.

Verification interface:

```sh
python3 tests/hyperfide/qualify.py --case V-034 --manifest tests/hyperfide/manifests/tasks/28.3.json && python3 tests/hyperfide/qualify.py --case V-053 --manifest tests/hyperfide/manifests/tasks/28.3.json && python3 tests/hyperfide/qualify.py --case V-054 --manifest tests/hyperfide/manifests/tasks/28.3.json && python3 tests/hyperfide/qualify.py --case V-055 --manifest tests/hyperfide/manifests/tasks/28.3.json && python3 tests/hyperfide/qualify.py --case V-056 --manifest tests/hyperfide/manifests/tasks/28.3.json
```

Outputs: `artifacts/hyperfide/tasks/28.3/manifest.json`, `artifacts/hyperfide/tasks/28.3/evidence-index.json`.

Registered task-component variant only; all cases remain UNRUN now. This task receipt cannot replace any required full-case/provider/connector/campaign receipt.

## Planned gates for open choices

- Account quotas/topology/networking:8.2,8.4,9.4,10.4 and27.3. Approved deployment budgets and observed account capabilities must be recorded before live execution.
- Native account/API authentication, permission and cross-sandbox resume:14.3,13.1–13.4 and27.3. No assumption of host credential portability.
- Supported runtime/SDK/database/object-store versions and durability/recovery settings:1.4,4.4,25.4 and24.4, before affected live stages.
- Canonical CLI/version/public namespaces/config migration:26.1–26.4 and25.2; unresolved namespace ownership cannot be invented.
- Small-run versus large-run concurrency, slot density and exact sustained200-session interval:23.2 and27.3, agreed before expensive live campaigns.
- Span/Jev/D1 quality/billing/routes and optional self-host:20.1–20.4 and22.1–22.4. No permanent winner or quality claim precedes evidence.

Each is a bounded implementation/qualification obligation. Open choices block only the affected capability or campaign, while unrelated approved work continues. Optional preview/self-host capabilities remain disabled unless separately qualified.
