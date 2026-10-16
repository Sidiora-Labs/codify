# Hyperfide 2.0 — migration, deployment, and product transition

Status: **proposed design; implementation pending user approval**. Verified current-source observations below were checked on 2026-10-16. This chapter does not activate the feature, change repository policy, rename the checkout, deploy services, or create provider resources. Dependencies are permitted for this proposed design; review and approval precede implementation.

## 1. Product and implementation boundary

The successor product is **Hyperfide**. Version 2.0 is the proposed release line; exact published release numbering is a release decision. Proposed canonical command: `hyperfide`, retaining `cg` as a compatibility entry point. No short alias such as `hf` is assumed available. Existing repositories and historical identifiers continue to say Codify where they identify real historical objects.

The proposed implementation uses TypeScript control services with pinned official Railway and Blaxel SDKs, PostgreSQL, durable object storage, and the existing C code for compatible CLI/indexing functionality and sandbox-supervisor seams. This is a deliberate multi-component deployment. The existing one-binary/no-new-dependencies policy is superseded for the approved Hyperfide design, but existing policy files must only be updated during authorised implementation through their source and generators.

### 1.1 Current facts that the migration must preserve

| Verified current fact | Source | Migration consequence |
|---|---|---|
| Checkout CLI reports `1.6.0`; source defines `CG_VERSION "1.6.0"`; editor package is also 1.6.0. | `src/cg.h:24`; `./cg --version`; `editors/vscode/package.json:5` | Start from the inspected 1.6 baseline and recheck generated workflow pointers against their source. |
| Current workflow activates `codify-v16`. | `spec/workflow.kvx:5` | Draft Hyperfide does not displace active implementation. Capture the actual source revision again when implementation starts. |
| Database path is `.codegraph/graph.db`; project configuration is `codify.kvx`; generated context defaults to `.codify`. | `src/cg.h:19–26,274`; `src/config.c:43–54` | Product renaming needs explicit data/configuration discovery and compatibility, not a repository-wide text replacement. |
| SQLite schema stamp is 18, with several durable-column additions performed within schema 18. | `src/db.c:253,569–640` | Detect table and column capabilities; the schema number alone is insufficient to choose an importer. Never open the source database with an upgrader just to discover its shape. |
| Graph and operational data share the database: branches, memories, leases, attempts, agents, runtime events, events, fleet runs/nodes, approvals, work evidence, and projections. | `src/db.c:9–239` | Inventory durable data and external files before replacing storage. Preserve historical state and distinguish it from current ownership. |
| Existing schema upgrades rebuild derived graph tables while preserving durable state; newer database stamps are rejected by older clients. | `src/db.c:562–711` | Preserve the distinction between rebuildable data and irreplaceable evidence. Maintain explicit forward-version rejection and capability negotiation. |
| Search relies on SQLite FTS5 trigram and unicode61 tokenisation, contentless tables, and row identities. | `src/db.c:46–50,69–70,201–226,544–548` | PostgreSQL search needs behavioural qualification; virtual-table bytes cannot be copied into a new engine as equivalent search. |
| Build/install produces `cg`; release script publishes static `cg`, checksums, VERSION and installer to an existing Codify web root. | `Makefile:12,65–80`; `scripts/release.sh:1–42`; `scripts/install.sh:1–88` | Release packaging must cover new services and compatibility artifacts as well as the native binary. Existing distribution URLs are historical facts, not assumed Hyperfide domains. |
| MCP server/configuration names and resource URIs use `codify`; hooks and generated skills include owned-file markers and agent-native configuration. | `src/mcp.c:1243–1248,1551–1552,1679`; `src/integrate.c:20–47,221–262,401–409` | Migrate host integrations without duplicate servers/hooks or overwritten user configuration. Preserve old URI aliases and ownership markers during transition. |

These observations establish compatibility work, not completion or performance of any proposed system.

## 2. Concrete deployment proposal

### 2.1 Deployable units

| Unit | Proposed implementation and placement | Durable inputs/outputs |
|---|---|---|
| `hyperfide-control` | TypeScript API, assignment/lease controller, graph query API and evidence acceptance; supervision server. | PostgreSQL primary for transitions; freshness-aware observation reads from replica; artifact references. |
| `hyperfide-provisioner` | Separate TypeScript process using pinned official SDK adapters; supervision server. | Durable provisioning intents and inventory observations; scoped provider credentials. |
| `hyperfide-dispatch` | TypeScript event delivery, finding/issue routing and reconciliation process; supervision server. | Durable outbox, delivery acknowledgements and reconciliation cursors. |
| Primary leader and feature managers | Existing Claude Code or Codex connectors on supervision server, registered through Hyperfide. | Native sessions plus durable manager packages, steering and checkpoints. |
| `hyperfide` and compatibility `cg` | Native C CLI/MCP façade retaining useful existing local functions and adding distributed API transport. | Explicit mode, workspace identity, graph/evidence identities; local cache/spool only when connected to a run. |
| Sandbox supervisor | C supervisor executable/subcommand sharing native process-control code; remote sandboxes. | Boot identity, isolated worker slots, local IPC and bounded spool; outbound authenticated control connection. |
| Index, preparation, build, verification and integration jobs | Remote execution profiles using prebuilt/pinned images or provider templates. | Git objects, published graph generations, artifacts and evidence. |
| PostgreSQL primary and read replica | Managed or separately operated service outside the main server's failure domain. | Shared live authority and versioned graph data; independent backup/recovery policy. |
| Durable artifact store | S3-compatible service outside the main server's failure domain; exact vendor/region parameterised. | Checksummed, access-controlled log chunks, checkpoints, evidence and release artifacts. |

This proposal intentionally starts with these units. PostgreSQL holds the durable queue/outbox; no additional broker or workflow platform is required for the baseline. Additional infrastructure requires a measured gap and a bounded integration proposal. API, provisioner and dispatcher are separate processes built from one control-service codebase so slow SDK calls and log transport cannot block ownership handling. Process separation is a design requirement; per-process scaling is measured during qualification.

The official Railway repository describes a TypeScript SDK and explicitly warns that its beta API can change. Blaxel's official sandbox documentation provides TypeScript SDK creation and execution interfaces. Adapter contracts, pinned dependency versions and live provider qualification therefore remain mandatory. Sources: [Railway SDK](https://github.com/railwayapp/railway-ts-sdk), [Blaxel sandbox API](https://docs.blaxel.ai/Sandboxes/Overview). No SDK version or account permission is assumed merely from these pages.

### 2.2 Build and release mechanics

1. A remote build job checks out the pinned Hyperfide revision, builds/tests the native artifacts and TypeScript service packages, and produces immutable digests with a manifest. Node/runtime version, dependency lockfile, SDK versions, compiler, target platform and build inputs are recorded. Pin a supported runtime during implementation; do not use unbounded `latest` in a production image.
2. The same release manifest identifies API protocol range, database migration range, runner protocol range, CLI version, editor version, preparation-profile compatibility and rollback compatibility. Releases cannot quietly mix incompatible artifacts sharing a brand version.
3. CI publishes signed or otherwise authenticated manifests and checksums to the selected release store. The installed main server downloads/verifies prebuilt artifacts; it does not compile TypeScript/native code, install application dependencies from source, index repositories, or run qualification jobs.
4. Main-server services run under an OS service manager with restart/backoff, dedicated service identities, bounded logs, readiness probes and orderly shutdown. Exact service files are an implementation artifact; an additional container scheduler is unnecessary for this baseline.
5. A remote migration job applies schema changes with a dedicated migration identity. Normal services lack schema-changing permissions. Migrations are versioned, checksummed, transactional where supported, resumable where necessary, and mutually excluded through a database migration lock.
6. Immutable sandbox images/templates include the qualified runner, CLI and required agent connectors. Reusable preparations exclude active ownership, native session identities and runtime credentials. Provider-specific preparation mechanics are specified in the provider chapters.
7. Roll out backward-compatible readers first, then compatible service code/runners, then activate new transitions by explicit release capability. Destructive schema contraction waits until old versions and rollback needs are retired. At each stage, record the installed/observed artifact digests.

### 2.3 Network and credentials

All sandbox pools initiate outbound authenticated connections to a parameterised coordinator URL. Railway environments and Blaxel must not depend on one Railway environment's private database DNS. Sandboxes receive no general PostgreSQL credentials. CLI/MCP clients use the control API; only service identities access database endpoints.

The API and provisioner load secrets from a selected credential facility at runtime. Provider administration credentials remain in the provisioner; worker credentials are scoped to the assignment. The database stores credential references, versions and audit metadata, not secret values. Bootstrap tokens are one-use/short-lived, bound to provisioning intent and exchanged for registered runner credentials. Rotation, expiry, revocation and controller restart must be qualified. Artifact upload credentials are bounded to allowed prefixes/operations and expiry. Exact account authentication mechanisms for frontier agents remain open qualifications; never bake reusable user-account sessions into templates.

Replica traffic is authenticated separately and read-only. Ownership, result acceptance and integration authorisation always use the primary. Observation APIs return their freshness identity; stale replica observations cannot grant authority. The main server exposes supervision/API traffic only, with bounded packet and log retrieval. Large artifact transformations remain remote.

### 2.4 Recovery and operations

The main server is a supervision failure domain. External PostgreSQL and artifact storage preserve state through its loss; they do not make leader/FMs continuously available. A standby main-control host is an optional later deployment, qualified before advertising uninterrupted supervision. Without it, workers use the execution chapter's bounded continuation/checkpoint/pause policy and the restarted control services reconcile before launching replacements.

The PostgreSQL read replica is a read-scaling component, not automatically a tested HA/failover solution. Select a primary/standby policy and qualify fencing, recovery point and replication durability. After any restore/failover, advance an external authority epoch or otherwise prove that ownership generations cannot be reused, suspend acceptance until runners are reconciled, and reject pre-restore assignments. The mechanism must survive database rewind; a counter restored from the same backup is insufficient by itself.

Backups cover database, artifact manifests and required objects, release/configuration manifests and encryption-key recovery. PostgreSQL base backups plus WAL archiving can support point-in-time recovery; replication alone is not a backup. Restore exercises must demonstrate joins from accepted evidence to the referenced Git revision and artifact bytes, including incompletely uploaded objects. Source: [PostgreSQL continuous archiving and recovery](https://www.postgresql.org/docs/current/continuous-archiving.html).

Before production qualification, declare and measure recovery time, acceptable data loss, retention, replica lag, connection pool limits and artifact-spool bounds in a deployment profile. These are explicit operational gates, not invented numerical guarantees in this draft. Correctness gates (no stale authoritative acceptance, no two publishers for the same target, complete evidence provenance) remain absolute across profiles.

## 3. Storage migration and authority cutover

### 3.1 Modes and ownership

Each repository/run has a persisted authority descriptor with repository identity, mode (`local` or `distributed`), authority service identity, authority epoch and migration identity. In distributed mode PostgreSQL is the sole live authority. KVX files retain versioned intent; task statuses exported to files are labelled projections with source revision/event checkpoint. Workers cannot edit those status projections to grant completion. Spec intent changes pass through the explicit run-revision protocol.

Local/offline operation remains useful for standalone work. It may maintain a local graph, memories and explicitly local tasks. It cannot issue a distributed assignment, accept a distributed result, release a distributed dependency, or authorise an integration update while disconnected. Any disconnected progress is a pending submission with its original inputs/fence; reconnect requires current-primary validation. Switching a distributed repository into independent local mode is an explicit fork/exit operation with a new local identity, not automatic fallback after network failure.

Authority selection must be enforced in every mutating CLI, MCP, hook, editor and background-watch path. A modern `cg` alias routes to the same implementation as `hyperfide`; an old 1.x executable is not that alias. Old executables must be stopped and removed from active hooks/editor launch paths at cutover. Their isolated local writes cannot become accepted distributed state. Shared-directory markers alone cannot secure a server against an old binary that ignores them.

### 3.2 Import inventory and provenance

Before import, generate a complete inventory of SQLite tables/columns/indexes/triggers, configuration, active processes, Git worktrees, refs and uncommitted work, journals/spools, snapshots, memories, documentation baselines and native agent state. Inspect actual table shapes in addition to schema stamp 18. Record source code/binary versions, repository remotes and object formats, configuration hashes and filesystem locations. Inspect external files without exposing credential contents in audit reports.

| Source class | Required disposition |
|---|---|
| Branch registry, refs, indexed branch IDs, base/head, worktree mapping | Import repository-scoped identity and original values. Re-resolve actual Git heads. Preserve missing/deleted branches as history rather than inventing live refs. Branch names are not globally unique across repositories. |
| Memories and supersession, Git history/churn | Preserve identity links, original text/provenance and timestamps. Import idempotently; do not silently discard unclassified memories. |
| Leases, attempts, agents, fleet runs/nodes | Preserve historical identities and events; import active-looking rows as `requires_reconciliation`. Local PID/host observations do not prove a live remote worker. New ownership requires reconciliation and a new authority epoch/fence. |
| Runtime events and ordinary events | Preserve original source sequence/fingerprints and payload provenance under a source-database namespace. Import gaps/retention boundaries honestly. New event delivery follows the PostgreSQL outbox contract; historical SQLite sequence values do not become a cross-database delivery cursor. |
| Approvals and policy decisions | Preserve gate, decision, actor and evidence. Re-evaluate applicability to the new run/version; an old approval does not automatically authorise a changed action. |
| Work packets/files/evidence, projections and findings | Preserve fingerprints, referenced revisions and artifacts. Mark unavailable or unverifiable source/evidence explicitly. Reconstructed projection findings do not grant qualification. |
| Graph, semantic tables and freshness metadata | Rebuild on remote executors or import into unpublished staging with exact extractor/source identity. Publish only after parity, integrity and coverage checks. Incomplete/stale old graphs remain labelled accordingly. |
| Documentation closure baselines/snapshots and external state files | Archive and reconnect identities where supported. Preserve ownership and source revisions. Never infer closure from the existence of a directory. |
| Pending lifecycle journals and filesystem checkpoints | Drain under the old writer before final freeze or import as pending records with provenance. Reject/quarantine malformed entries; account for every entry. |
| Secret/session files | Preserve only through approved encrypted/session-recovery mechanisms; never include raw secret bytes in general migration artifacts or logs. Agent resume remains connector-specific. |

Use a deterministic import map keyed by source database identity, table, legacy primary key and repository identity. Retain original keys in provenance; allocate new globally scoped IDs without collisions. Validate foreign keys, deduplication fingerprints, supersession chains and source-to-destination counts/hashes. Set PostgreSQL identity generators beyond imported IDs when numerical keys are preserved. Repeat imports must produce the same mapping and counts, not duplicate attempts/events.

Cross-repository and cross-programme dependencies require explicit destination identities and milestone semantics. Unresolved references remain blocked/unknown with diagnostics. Imported `done` status without qualifying evidence is historical declaration; never manufacture acceptance from it. A declared `done` task with `UNRUN` scenarios does not establish current runtime proof.

### 3.3 Search and graph parity

The PostgreSQL design may use `pg_trgm` for indexed substring/similarity candidates and native full-text facilities for word search. These are proposed building blocks; they do not replicate SQLite FTS5 semantics automatically. [`pg_trgm` documentation](https://www.postgresql.org/docs/current/pgtrgm.html) describes trigram matching and indexes, not equivalence to Codify's tokenisers/ranking.

Qualify exact/segment/substring matching, punctuation, Unicode, case handling, path/glob/language filters, phrase/boolean syntax, ranking and deterministic tie breaks, branch isolation, missing source, contentless body lookup and output budgets. Preserve response coverage/freshness labels. Port query intent rather than FTS SQL syntax. Version any necessary observable ranking changes and report them in release notes.

All graph rebuilds and differential corpus runs occur remotely. Batch ingestion and set-based resolution must be measured against local indexed baselines and mixed fleet load; converting per-symbol SQLite calls into network round trips is unacceptable without demonstrated bounds.

### 3.4 Cutover sequence

1. **Inventory and dry-run.** Read-only snapshot/export into an isolated staging database; no scheduling, provider calls, issue writes or integration credentials in the importer. Produce inventory, mapping, unresolved-reference report and parity results.
2. **Prepare compatibility.** Install qualified CLI/runner/services and update owned integration launch paths in a canary workspace. Rehearse rollback. Old writer capability is disabled before this workspace joins a distributed run.
3. **Quiesce the selected authority scope.** Stop new assignments and integration; drain or checkpoint workers. Stop legacy background indexers/watchers/hooks that mutate the shared database. Record outstanding attempts, pending journals, branch heads, worktrees and dirty files. The scope includes every participating repository, not only the main checkout.
4. **Capture a consistent source.** Use the SQLite backup API or a verified clean shutdown/snapshot procedure, including WAL state. Copying only a live `graph.db` file is not an adequate procedure. Preserve a checksummed read-only archive and final source checkpoint. Source: [SQLite online backup API](https://www.sqlite.org/backup.html).
5. **Final import and validation.** Import into destination staging, compare the final source inventory/map/counts, reconcile Git and artifact manifests, and classify all unfinished ownership. Freeze further source imports after recording the final import checkpoint.
6. **Activate distributed authority once.** Commit the new authority descriptor/epoch and imported state on the primary. Point compatible clients to that authority and invalidate legacy active ownership. Enable new scheduling only after all service/runner capability checks and reconciliation gates pass.
7. **Canary then expansion.** First new run uses a bounded remote pool and required independent qualification. Expand only after cutover/recovery/compatibility gates pass; then qualify full 100-sandbox, 200-concurrent-agent profile and 48–72-hour operation. Historical runs stay readable without being silently restarted.
8. **Archive and retire.** Keep source SQLite/configuration/export archives for the declared retention period. No automatic deletion. Retire compatibility only in an explicit future release with usage evidence and notice.

A shadow PostgreSQL dataset may compare reads and simulate scheduling, but has no execution or publication authority. There is no dual-active-write period. The frozen source archive plus import manifest defines the rollback boundary.

### 3.5 Rollback boundaries

| Point | Permitted recovery |
|---|---|
| Before distributed activation/new authoritative writes | Disable destination writers, restore compatibility configurations from recorded backups, verify original source integrity, then resume the original single authority. Retain failed-import evidence. |
| After activation but before any new distributed authoritative transition | Prove absence of new accepted transitions/provider effects, stop compatible writers, revoke the distributed epoch, reconcile any bootstrap resources, then follow the previous case. Absence must be audited, not assumed from an empty dashboard. |
| After new distributed writes or external effects | Do not reopen the pre-cutover SQLite archive as current state. Freeze assignments/publication, capture a final destination checkpoint, reconcile live sandboxes/Git/issues/artifacts, then either roll code back against a compatible PostgreSQL schema or perform a separately qualified reverse migration. All post-cutover facts must be represented before any alternate authority can open. |
| After database restore to an older point | Treat acknowledged/external effects since the restore point as uncertain. Fence all old assignments using a non-reused authority epoch, inventory branches/provider processes/artifacts, and reconcile acceptance before resuming. |

Code rollback does not imply data rollback. Database migrations must declare whether previous service/CLI versions can read/write the new schema. A destructive rollback requires a recovery plan retaining new evidence; it cannot be hidden behind a generic downgrade command.

## 4. Hyperfide naming and compatibility workstream

No actual repository, package, domain, account or GitHub organisation rename is performed during specification authoring. Public namespace availability, ownership and redirects are open release qualifications. A full rebrand covers the following inventory.

| Surface | Proposed destination | Compatibility contract |
|---|---|---|
| Product/release identity | Hyperfide; proposed 2.0 release line | Display product and machine protocol versions separately; retain historical Codify release provenance. |
| Native command and build/package names | `hyperfide` canonical; `cg` alias to same qualified binary | Preserve command arguments, JSON fields and exit statuses unless versioned. Diagnose when PATH resolves to an unrelated/old `cg`. No recursive wrapper lookup. |
| Project configuration | `hyperfide.kvx` canonical for new repositories | Read legacy `codify.kvx` when no migrated configuration is selected. If both exist without an explicit migration manifest, report conflict; never silently merge precedence. Explicit conversion is atomic and backed up. |
| Repository data/context directories | Proposed `.hyperfide/` with distinct state/cache/context subpaths | Existing `.codegraph/` and `.codify/` remain discoverable via a migration manifest until explicit relocation. No auto-move/delete on ordinary commands. Preserve Git worktree links and external configured paths. |
| User installation/plugin state | Proposed user Hyperfide directory and Hyperfide plugin metadata | Preserve existing `$HOME/.codify/plugins/claude-code` and native session references until owned integration is migrated. Do not rewrite provider-native account directories. |
| Environment variables | `HYPERFIDE_*` canonical, with documented `CG_*` and `CODIFY_*` aliases | Define alias mapping per variable. Equal values accepted; conflicting values fail for authority/auth-sensitive settings and diagnose elsewhere. Secrets never printed. Exclude third-party credential names from blanket renaming. |
| Spec metadata and task identity | New Hyperfide features under the normal spec structure | Retain historical feature/task IDs, commit `[spec:feature/id]` tags and accepted evidence links. Rename display labels separately from immutable identity. |
| Generated instruction/context/codemap files | Hyperfide text generated from source KVX/templates | Update `spec/workflow.kvx` only after approval and regenerate AGENTS/CLAUDE through `cg spec render`/successor, context through agentmd, CODEMAP through codemap. Recognise old and new ownership markers. Preserve user-owned text. |
| MCP server name and resources | New installations use `hyperfide` and `hyperfide://` | Accept legacy `codify://` resources; preserve tool names/schemas or version changes. Migrate owned server entries atomically with backups; one active server/hook set per workspace. Existing sessions can retain old entry names until restart. |
| Hooks, Claude plugin and portable skills | Hyperfide identity and owned asset markers | Recognise old markers; migrate only owned files. One event identity/dedup path prevents double ingestion when old/new event shims coexist briefly. User custom hooks remain untouched. |
| VS Code extension | Hyperfide display/product metadata; package/publisher identity qualified | Retain `codify.*` command/settings aliases and map persisted workspace/global state. Avoid two simultaneous active implementations. Package identity changes need a distribution/migration route, not only changing `name` in JSON. |
| Docs, CLI help, example prompts and agent packets | Hyperfide operational language and current topology | Update generated templates and examples; preserve historical quoted instructions. Version prompts/rubrics and record hashes so naming edits cannot silently alter evaluation baselines. |
| Installer/uninstaller/update channel | Hyperfide artifacts plus `cg` compatibility artifacts | Authenticated/checksummed releases, atomic installation, custom install-dir support and compatibility version checks. Uninstall removes owned binaries/integrations by explicit scope; user data stays unless separately requested. |
| URLs, repository references, release webroot, registries and badges | Parameterised until ownership confirmed | Configure old-to-new redirects and immutable old downloads where controlled. Never claim a domain/package/repository was obtained or renamed. |
| Tests, fixtures and telemetry-free diagnostics | Product strings updated selectively; legacy fixtures retained | Positive Hyperfide tests plus negative/legacy Codify compatibility fixtures. Machine identities and historic evidence remain readable. No new telemetry is implied by rebranding. |

User-session continuity requires both old and new command/resource names to remain usable during a controlled transition. Current native sessions retain provider session IDs and their original transcript identities; no migration fabricates resumability. A resumed agent receives a small versioned instruction update pointing to the canonical command and its current assignment; it does not silently adopt another task/fence.

## 5. Implementation packages and qualification

All packages below are **pending**, subordinate to the root task graph. They identify bounded deliverables for that graph; no commands/files named as future gates are claimed to exist.

| Package | Dependencies | Deliverable and planned gate |
|---|---|---|
| MIG-01 Baseline inventory | Approved pack | Read-only schema/filesystem/integration inventory and source-version fixture archive; account for every durable source class. |
| MIG-02 Release/deployment contract | Protocol and deployment decisions | Remote reproducible native/TypeScript builds, manifest, dependency pins, service definitions and capability checks; install verified prebuilt outputs on a clean supervision host. |
| MIG-03 Import mapping and snapshot export | MIG-01; storage schema | Deterministic IDs/provenance, WAL-safe export, resumable import; repeat/interruption/collision/unknown-column fixtures. |
| MIG-04 Query/search compatibility | Central graph query interface | Versioned search semantics and differential corpus against local baseline; no hidden stale/partial coverage. |
| MIG-05 Client authority modes | Execution and storage invariants | CLI/MCP/hook/editor routing; offline constraints; legacy writer fencing and conflict diagnosis. |
| MIG-06 Naming transition | MIG-02, MIG-05 | Canonical command/config/assets, legacy aliases, generated-source updates and reversible integration migration. |
| MIG-07 Cutover/reverse-recovery rehearsal | MIG-03–06; provider sandbox contract | Full authority switch with live-worker/dirty-tree/journal fixtures, rollback before new writes and recovery after new external effects. |
| MIG-08 Operational deployment qualification | MIG-07; full system qualification | External DB/object-store restore exercise, controller-loss recovery, replica/failover handling and staged live fleet release. |

### Planned scenario catalogue

| Scenario | Required observation |
|---|---|
| MIG-T01 Same v18 stamp, different actual columns | Importer reports actual capabilities; preserves all durable fields and refuses unknown destructive assumptions. |
| MIG-T02 WAL-active source plus import interruption | Snapshot is consistent; retry import uses the same identity map with no duplicate rows/events. |
| MIG-T03 Two repositories share branch names and integer IDs | Destination retains disjoint identities and correct cross-repository links. |
| MIG-T04 `done` KVX task with absent/UNRUN evidence | History retained; no qualified status fabricated. |
| MIG-T05 Legacy binary and modern alias both present | Doctor identifies each executable/version; old hooks/processes cannot publish accepted distributed transitions. |
| MIG-T06 API unavailable during local work | Reads show cache freshness; progress spools as pending; no offline distributed claims, completion or integration. |
| MIG-T07 Both project config filenames or conflicting env aliases | Actionable conflict; no silent authority switch or secret output. |
| MIG-T08 Rebrand apply interrupted, then retried | Owned configuration restored or completed atomically; no duplicate MCP servers/hooks; user content preserved. |
| MIG-T09 Active native session during migration | Historical session identity and evidence remain readable; resume capability is reported truthfully; assignment/fence validated anew. |
| MIG-T10 Rollback after first new authoritative write | Old snapshot cannot reopen as live authority; post-cutover facts and external effects reconciled through the documented recovery path. |
| MIG-T11 Database restore predates issued fences | Previous runner messages and branch publications are rejected under a fresh, non-reused authority epoch. |
| MIG-T12 Replica unavailable/behind during deployment | Observations disclose lag; primary-only transitions remain correct; replica outage is not mistaken for empty fleet state. |
| MIG-T13 Main host install/update | Prebuilt artifacts verify and start; no builds, dependency preparation, indexing, verification or integration execute on that host. |
| MIG-T14 Restore database and referenced objects independently | Missing/orphaned artifacts are diagnosed; accepted evidence references valid bytes or explicitly enters recovery. |
| MIG-T15 CLI/MCP/editor old/new interfaces | Contract fixtures preserve supported schemas, exit codes, resource aliases, command/settings aliases and historical links. |
| MIG-T16 Search migration corpus | Exact/substring/Unicode/filter/branch/phrase cases and freshness budgets meet declared compatibility criteria; differences are versioned. |

These scenarios must become executable gates in the implementation task graph. Qualification evidence must record exact release inputs and execute remotely.

## 6. Open deployment qualifications

The implementation team must resolve and record these parameters before the affected live gate, without inventing values or blocking unrelated development:

- Exact Hyperfide release version, controlled domain/repository/package names, canonical public download endpoint and compatibility support window.
- Supported Node/runtime, PostgreSQL and OS versions; approved official SDK pins and any required account/server capabilities.
- Database hosting, replica/failover policy, non-reused authority-epoch recovery mechanism, measured recovery point/time objectives and backup retention.
- Artifact vendor/region, consistency/access/retention settings, encryption/key recovery and cross-provider transfer requirements.
- Railway project/environment IDs, Blaxel workspace/pool topology, regions, quotas and account-scoped credentials. Actual capacity requires account inspection and live qualification before admission.
- Frontier-agent authentication and supported resume/checkpoint semantics on each provider and connector. Use explicitly configured native model identifiers qualified for the selected Claude Code and Codex connectors.
- Which existing runs/databases must migrate, which finish under legacy supervision, and the maintenance window/scope for final source quiescence.

The root acceptance plan must distinguish completion of implementation, local/fixture qualification, live provider qualification, and production activation. User review of this pack precedes all implementation work.
