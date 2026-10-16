# Hyperfide decisions and qualification register

Status: **DRAFT FOR USER REVIEW — no implementation approval recorded.** This register distinguishes user direction, engineering recommendations and unverified enablement facts. Normative SHALL statements in the native spec describe the proposed contract; they do not imply that every design choice was separately requested or already implemented.

## 1. Functional baseline

| ID | Requirement | Contract consequence |
|---|---|---|
| U-01 | Hyperfide is the successor product name. | Deliberate branding and compatibility migration; no blind historical identifier replacement. |
| U-02 | Specification review precedes implementation. | Every task remains pending, every product case UNRUN and the feature inactive until approval. |
| U-03 | Main server hosts the primary leader, feature managers and supervision. | Implementation and builds are remote; capacity is supplied by private deployment configuration. |
| U-04 | Humans interact through the primary leader; ordinary execution is agent owned. | No routine worker-console intervention or per-task approval within an authorised run policy. |
| U-05 | Managers receive wave work and request sandbox workers through Hyperfide. | Durable packages, ownership, handoffs and scoped context. |
| U-06 | Frontier engineering agents with configured Claude Code and Codex profiles. | Resolve actual supported models before dispatch; advisory models cannot replace coding workers. |
| U-07 | Large-run qualification targets 100 sandboxes, 200 concurrent remote sessions and up to 1,500 session lifetimes over 48–72 hours. | Profile-specific measured concurrency and resource admission; no claim about an existing deployment. |
| U-08 | Railway and Blaxel execution adapters. | Pool quotas, topology and account terms are private, configurable and independently qualified. |
| U-09 | PostgreSQL fleet/graph authority with replica observation and batched ingestion. | Primary consistency, causal freshness and measured performance. |
| U-10 | Dependencies are permitted for this architecture. | Explicitly version the legacy single-binary/dependency policy transition. |
| U-11 | Every configured member of a 10–15-watcher pool reviews every relevant commit; ten-minute issue reconciliation. | Any coverage reduction or cadence change requires an accepted policy amendment. |
| U-12 | Mechanical and semantic assurance plus bounded Span/Jev/D1 decision assistance. | Independent evidence decides qualification; model outputs remain advisory. |

The [native requirements](spec.kvx) and [traceability](traceability.md) define the complete public implementation contract. Private planning records are not build, validation or publication dependencies.

## 2. Recommended design decisions

These are proposed defaults to review with the pack. Changing one requires updating affected contracts, tasks and tests rather than silently weakening implementation.

| ID | Proposed decision | Reason and boundary |
|---|---|---|
| D-01 | Stable feature/domain accountability with successive wave packages; support explicit wave-manager transfers. | Findings remain attributable after the original wave ends. Manager process lifetime and engineering responsibility are distinct. |
| D-02 | Extend main-server execution exclusion to preparation, indexing, tests, reproduction, review execution and integration. | Preserve the supervisory failure/resource boundary. Source inspection and published state/context reads remain allowed. |
| D-03 | TypeScript control/provisioning/dispatch services with official pinned provider SDKs; retain useful C CLI/indexing/supervisor functionality. | Makes provider integration concrete while avoiding a wholesale rewrite. Service and native interfaces require explicit versioning and integration owners. |
| D-04 | PostgreSQL, artifacts and Git outside the main server's failure domain. | Main failure must not erase acknowledged state. This does not provide uninterrupted leader availability. |
| D-05 | Primary-only authority, synchronous eligible-standby durability and qualified old-primary/control-writer fencing. | Prevent acknowledged ownership from disappearing on the qualified single-primary failure path. Exact hosting/HA mechanism remains O-03. |
| D-06 | Replica reads require appropriate freshness and a consistent packet snapshot; use bounded fallback to primary. | A recent graph combined with stale spec/dependency state is not a valid task packet. Replicas cannot grant ownership. |
| D-07 | Split worker compute authority, immutable submission custody, verification-job leases and integration publication authority. | Coding resources can be released while independent review proceeds; expiry must not discard valid admitted work. |
| D-08 | Committed pending-delivery outbox, transactional inbox deduplication and revision checks. | Database sequence allocation is not commit order. Network delivery is at least once; accepted effects are idempotent, not a claim of exactly-once physical execution. |
| D-09 | Central immutable graph generations, remote extraction, bounded bulk staging and atomic publication. | Shared graph scale cannot be achieved by sending every existing SQLite per-row query over a network. Search/FTS parity remains an acceptance requirement. |
| D-10 | Common provider capability contract; fresh supervisor enrollment is baseline. | Preserve Railway disk-only restore and Blaxel lifecycle differences. Preview memory snapshots are optional and disabled unless safe pre-execution identity renewal is proven. |
| D-11 | Explicit isolated worker slots with resource reservations for children, builds, tests, review and indexing. | Two agents per sandbox is a qualified profile, not a universal constant; separate worktrees alone are not credential isolation. |
| D-12 | Independent remote qualification, producer/consumer semantic tests and revision-bound review receipts. | Existing status, proof strings and process exits cannot establish system correctness. Model scores cannot certify completion. |
| D-13 | Canonical internal findings with GitHub as external input/mirror; event routing supplements ten-minute reconciliation. | GitHub delays or duplicated events cannot create duplicate repair ownership or lose accountability. |
| D-14 | Remote protected-ref gateway with sole publication rights, expected-head CAS and unknown-outcome reconciliation. | PostgreSQL fences cannot stop a process holding unrestricted Git credentials. Host/ref enforcement must be qualified. |
| D-15 | Multi-repository candidate manifest and release barrier with explicit partial-publication recovery. | Separate Git refs cannot be updated atomically across repositories by ordinary Git operations. Consumers use the released manifest. |
| D-16 | Asynchronous typed Span/Jev/D1 advice, mandatory context preservation, calibrated abstention and bounded deterministic fallback. | Model outages cannot stop fleet authority/control. No winner is selected before Hyperfide-specific evaluation. |
| D-17 | Single-authority migration with read-only source inventory, shadow parity, quiescent cutover and explicit rollback boundary. | Dual active SQLite/PostgreSQL ownership would create split authority. Imported historical done labels remain historical unless evidenced. |
| D-18 | Public command `hyperfide`, legacy `cg` compatibility; proposed release 2.0.0. | Latest name is settled; exact release numbering, published package/domain/editor identities and compatibility duration need a recorded release decision. No short alias or namespace ownership is assumed. |
| D-19 | Initial 60 Railway / 40 Blaxel illustrative allocation, five prepared replacements, 200 remote agents plus main sessions. | Demonstrates counts and role placement only. Provider split, slot density and exact manager count are adjustable from qualification. |
| D-20 | Staged deterministic checks, live canaries, then real 48/72-hour mixed-workload campaigns. | Simulation and CRUD smoke tests cannot establish long-running native agent, credential, provider or semantic correctness. |

The native spec and detailed contracts include operational safeguards even though legacy Codify defaults are advisory. The user explicitly requested proper fleet coordination and verification; proposals enforce ownership and qualification invariants rather than applying unrelated warning-only policy to authoritative state. New optional policy restrictions outside these contracts remain reviewable rather than silently imposed.

## 3. Open qualification and decision gates

An OPEN item is not assumed resolved by this pack. Each has an owner/workstream and a defined point where evidence is required. Unrelated implementation may proceed after overall approval; a dependent live deployment or claim may not.

| ID | Unresolved item | Resolution evidence / gate | Native task owners |
|---|---|---|---|
| O-01 | Account-session, API-credential or mixed native authentication; actual model alias resolution and licensed access. | Document selected modes using approved credentials; standalone auth probes, safe refresh concurrency, pinned connector launch/resume, actual allowed model identity and 72-hour operation. No copied arbitrary host auth directories. Gate each native route before live use. | 14.3, 13.1–13.4, 27.3 |
| O-02 | Actual Railway/Blaxel account limits, topology, regions, resource classes, create rates, network paths and lifecycle ceilings. | Account-scoped capability records and disposable live provider tests; configured entitlement remains unverified until checked. Gate provider expansion, not all storage development. | 8.2, 8.4, 9.4, 10.4, 27.3 |
| O-03 | PostgreSQL major version, driver/pooler, hosting, synchronous standby, fencing and backup configuration. | Pin supported versions; migration/primary-loss/old-primary-isolation/PITR drills, measured WAL/latency and documented durability guarantees. Gate authority deployment. | 4.1–4.4, 24.4 |
| O-04 | Git host, target ref ACL/server hook or equivalent gateway enforcement; permissions across participating repositories. | Prove direct stale worker/old-gateway target writes fail, reconcile lost response/in-flight requests, and demonstrate multi-repository partial recovery. Gate accepted publication. | 14.4, 19.2, 19.3 |
| O-05 | Artifact store, data retention/deletion policy, project separation, secret broker/injection and approved model egress. | Hash/receipt, ACL, redaction/rotation, retention/restore and failure tests against selected services. Gate durable evidence and external source transfer. | 14.1–14.4, 15.2, 15.4, 24.4 |
| O-06 | Exact per-profile resources, slot density, build/index/review budgets and sustained-concurrency measurement window. | Freeze named load manifests; measure real active sessions versus waiting/idle, steady-state and fault intervals, resource use and useful qualified work. Gate the 100/200 capacity claim. | 5.4, 12.1, 23.1–23.4, 27.2–27.4 |
| O-07 | Actual source/graph corpus and comparative latency/throughput baselines. | Pin real repositories separately from large spec fixtures; record query/edit/write mix, batching, connection/lock pressure, search parity and baseline comparison. Gate speedup claims. | 7.1–7.4, 27.2 |
| O-08 | Model route entitlement, version stability, exact billing/context/media semantics, tail latency and decision quality. | Route tests, actual usage reconciliation, held-out temporally valid labels, calibration/abstention and controlled trials. Gate recommendation-policy promotion; core loop remains available without advice. | 20.1–20.4, 22.1–22.4 |
| O-09 | RPO/RTO, minimum HA topology, retention horizons, latency thresholds and endurance settings. | Initial engineering targets are proposals in storage/verification; freeze accepted campaign settings before execution. Failure cannot be retroactively passed by reducing the target. | 4.4, 23.2, 24.4, 27.3 |
| O-10 | Public release version, package/editor/plugin/domain namespaces and legacy compatibility duration. | Record release decision and namespace ownership before publishing; preserve real historical identifiers. Gate distribution, not use of Hyperfide in this draft. | 26.1–26.4, 28.3 |
| O-11 | Whether to adopt specialist-sharded review or other coverage reductions. | Default is already defined: every configured watcher reviews every relevant commit. An alternative requires explicit policy acceptance and changed coverage tests. No answer is required to implement the default. | 17.1 |
| O-12 | Optional self-host Span and preview provider capabilities. | Compatible remote hardware, pinned artifacts/licensing, pre-resume identity safety and equivalent route/lifecycle qualification. Excluded from production baseline if unqualified; no hidden dependency on a preview. | 20.3, 22.3, 9.4, 10.4 |

These gates do not request new permissions during specification authoring. Provider/model campaigns and production changes must use the scope authorised when that work is reached. Routine actions already within the approved run policy must not introduce repeated human confirmation.

## 4. Explicit dispositions

- **ObjectBox:** assessed rather than ignored. Its strongly consistent server cluster is acknowledged; eventual local-client claim synchronization is not the selected authority design. PostgreSQL matches the selected architecture. No comparative benchmark supports a blanket performance rejection.
- **Cheap coding workers:** superseded by the later frontier-only instruction. Decision models assist bounded judgement; they do not perform implementation work in place of the configured frontier agents.
- **SQLite:** distributed fleet/graph authority migrates to PostgreSQL. Existing local/offline functionality and optional caches may continue with explicitly separate authority; no silent fleet write-back from offline state.
- **Always-on availability:** one supervisory main server is an acknowledged supervision failure domain. Durable recovery and bounded worker continuation are mandatory; continuous leadership failover is not falsely promised.
- **Full memory cloning:** optional, not production foundation. Disk/image preparation and fresh identity are the common provider baseline.
- **Approval and proof:** spec review does not activate a run; a task labelled done does not prove correctness; a source/doc review does not qualify an account, model or deployment.
