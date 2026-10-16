# Blaxel execution-provider specification

Status: proposed Hyperfide implementation contract, awaiting user review and implementation approval. Documentation checked 2026-10-16. No Blaxel account, credential, API mutation, image build, or sandbox execution was used to author this chapter. All qualification scenarios below are UNRUN.

## Scope and authority

Blaxel is a proposed remote execution provider. The public engineering target is a mixed fleet of 100 sandboxes and 200 concurrent workers, with supervision on a separate control host. This is a qualification profile rather than a statement about an existing account allocation. Capacity, region/workspace distribution, API rate limits, and simultaneous provisioning limits must be configurable and confirmed during approved account qualification. Do not translate Railway's environment topology into an assumed Blaxel topology.

Hyperfide's coordinator owns assignment and acceptance through PostgreSQL. Blaxel supplies compute, storage, and process primitives. Provider status, a provider process exit, a snapshot, or a live model session cannot grant ownership or qualify a task. All preparation, indexing, implementation, builds, tests, and integration execution occur remotely. The main server runs supervision and provider-control requests.

## Verified documentation facts

These statements describe vendor documentation, not measured behaviour in a qualified deployment. Engineering requirements derived from them follow separately.

| ID | Verified fact | Primary source, checked 2026-10-16 |
|---|---|---|
| BLX-F01 | Creation supports names, image selection, region, labels and resources. `createIfNotExists` retrieves an existing named sandbox or creates one. External IDs are mutable, non-unique identifiers. Writable filesystem changes use RAM-backed `tmpfs` over a read-only image. Standby preserves memory/processes but external connections must reconnect. Reserved ports include 80, 443 and 8080. | [Overview](https://docs.blaxel.ai/Sandboxes/Overview) |
| BLX-F02 | Custom images must include/start `sandbox-api`; the declarative builder injects it. Image slimming is enabled by default and removes compilers, headers and build utilities. CLI-published coding images can retain them using `[build] slim = false`. | [Images](https://docs.blaxel.ai/Sandboxes/Templates) |
| BLX-F03 | A sandbox supports one attached volume; a volume attaches to one sandbox at a time. Attachment occurs at creation, hides existing mount-directory content, and currently cannot be detached. Deleting the sandbox clears attachment state; volume data survives. | [Sandbox volumes](https://docs.blaxel.ai/Sandboxes/Volumes) |
| BLX-F04 | Volume templates have versioned revisions. Symlinks and hardlinks are unsupported; links outside the template are forbidden. Vendored `pnpm`/`uv` dependencies can consequently misbehave. | [Volume templates](https://docs.blaxel.ai/Volumes/Volumes-templates) |
| BLX-F05 | Processes detach from client connections. `keepAlive: true` without a timeout kills the process after 600 seconds; `timeout: 0` disables that kill. Without keepAlive, timeout limits API waiting rather than process lifetime; completion waits are limited to 60 seconds. Stdin defaults to EOF. Stdin requires TypeScript SDK ≥0.3.19 or Python ≥0.4.9 and sandbox-api ≥0.2.56. A 503 write can be partially delivered; restart/re-handshake is required. API restart closes stdin; automatic process restart replaces its pipe. | [Processes](https://docs.blaxel.ai/Sandboxes/Processes) |
| BLX-F06 | Sandbox expiration deletes the resource and differs from standby. `ttl-idle` measures resume/suspend events, so continuously active work can still be deleted when its timer expires. Account tiers can impose maximum lifetime limits. | [Expiration](https://docs.blaxel.ai/Sandboxes/Expiration) |
| BLX-F07 | Creation-time and process-specific variables are supported. Running-sandbox environment changes are preview functionality on the new generation. Changes affect subsequently started processes; existing processes retain their original environment. Updating other runtime settings can redeploy and lose state. | [Variables and secrets](https://docs.blaxel.ai/Sandboxes/Variables-and-secrets) |
| BLX-F08 | Explicit snapshots/forks capture files, processes and memory and are private preview, with vendor advice against production use. | [Snapshots and forking](https://docs.blaxel.ai/Sandboxes/Fork) |

## Capability contract

The following interface is a proposed internal adapter contract, not an existing CLI/API. Its transport and SDK versions must be pinned during implementation. Every operation carries a Hyperfide operation ID, deadline, provider account/workspace reference and scope; mutation intents are committed before external calls. Results retain provider request identifiers where available, observation time, retry classification, and redacted error details.

| Operation | Required behaviour |
|---|---|
| `describeCapabilities(pool)` | Return verified limits and support for regions, resource classes, images, volumes, process stdin, standby, expiration, log retrieval, preview features and immutable configuration inspection. Distinguish documented, account-enabled and live-qualified capabilities. |
| `prepare(recipe)` | Build remotely, publish an image and optional volume template, inspect the published environment, and produce an immutable preparation manifest. No task ownership or live credentials enter the reusable preparation. |
| `ensureSandbox(intent)` | Resolve a deterministic name for one provisioning generation, inspect any existing resource, compare configuration, then create/adopt/quarantine. Return a stable provider identity and configuration digest. |
| `observeSandbox(identity)` | Return provider lifecycle state, effective configuration, attachment, expiration and health observations separately from the runner's registered readiness. |
| `startSupervisor(identity, launch)` | Start or reconcile a named foreground supervisor with explicit lifetime settings; register its boot/session identity with the coordinator. Duplicate control delivery cannot create two accepted supervisors. |
| `observeProcess / streamLogs` | Preserve process identity and available logs; report observed exit code, process state and transport errors independently. Stream output to Hyperfide durable storage. |
| `requestStop / destroySandbox` | Execute the durable drain/stop/delete intent; verify observed outcomes. A client timeout leaves the operation uncertain until reconciliation. |
| `reconcile(pool)` | Compare full provider inventory and volume attachments with durable intents, including pagination. Adopt matching in-progress requests, quarantine mismatches/duplicates, and clean up only resources whose ownership is established. |

Preview-only extensions, including full-memory snapshot/fork and running-environment mutation, must be explicit optional capabilities. They cannot be required by the production baseline or silently replace baseline recovery.

### Provisioning idempotency and readiness

1. Atomically reserve a pool allocation and provisioning generation in PostgreSQL. Store expected region, image revision, resource profile, expiration policy, volume identity and mount path, ports, network requirements, configuration digest and supervisor protocol version.
2. Derive a provider-safe sandbox name from that reservation. Store both logical identity and provider identity. Labels/external IDs aid discovery; they are not uniqueness constraints or acceptance credentials.
3. On name collision or ambiguous creation response, inspect the resource. Adoption requires a matching provisioning generation/configuration and successful authenticated supervisor registration. `createIfNotExists` alone does not demonstrate configuration equivalence.
4. If configuration differs, leave the resource unassigned, record the mismatch and reconcile it. Do not update a running resource spec merely to force equivalence: a redeployment may destroy execution state.
5. Require readiness evidence from inside the published sandbox: exact tool versions; sandbox-api and supervisor protocol; usable repository revision; validated dependency preparation; successful coordinator/artifact/Git/model connectivity; storage headroom; effective expiration; separate writable worker slots. Provider `DEPLOYED` alone is insufficient.
6. Provisioning failures release reservations only after the resource outcome is reconciled. A fallback region/provider gets a new durable provisioning generation; it does not reuse an uncertain resource identity.

## Preparation, code and storage

Use a two-layer preparation design: a toolchain image plus a repository/dependency preparation identified by content. The manifest includes operating-system/architecture identity, sandbox-api version, Hyperfide runner version, agent CLI versions, toolchain versions, repository baseline commit(s), dependency-lock hashes, package registry configuration digest, preparation commands and non-secret environment digest.

Build these assets on approved remote preparation capacity. Pin the published revision or resolved digest rather than a moving `latest` tag. The image entrypoint must keep sandbox-api available and start a fresh supervisor registration path without inheriting an assignment. Confirm that runtime compilers survived publication; a successful local Docker build is insufficient because publication can alter the filesystem.

Each assignment materialises its exact commit set from the prepared baseline, then validates preparation compatibility. Changed dependency locks invalidate affected cached preparations. Missing or incompatible caches trigger deterministic remote preparation, not reuse with a warning. Define profiles for C/Rust, Go/blockchain, browser/web and integration workloads as needed by the run, with required capabilities rather than assumed universal sandbox suitability.

Plan writable storage explicitly. The proposed layout puts large checkouts, build outputs, dependency downloads, native agent session data and supervisor spool under a sandbox's dedicated mounted volume where that workload requires it. Worker subdirectories remain separate. Bounded transient files may use the writable layer. Read-only prepared files may remain in the image. This is a placement design, not a claim that every tool can transparently relocate its files; each profile must verify actual paths, cross-filesystem operations and space consumption.

Never attach one writable volume to competing sandboxes. Reserve and reconcile volume ownership in PostgreSQL and inspect provider attachment before replacement. A volume retained after sandbox deletion is recoverable storage, not proof that the old attempt stopped or lost ownership. Fence the old attempt before admitting a replacement.

A new mount can conceal image-preloaded files at its path. Readiness must therefore validate the workspace after mounting. Volume-template recipes must detect link-dependent package layouts and either materialise supported copies, recreate dependencies after mounting, or use another qualified preparation method. Verify executable permissions, links, package resolution and representative builds after publication. Persistent volume performance, size limits and build suitability remain account qualification items.

Git commits and uploaded artifacts remain the portable recovery baseline. A volume cache improves recovery but is not the only copy of unsubmitted work, logs or accepted evidence. Cache retention and provider resource cleanup have separate recorded policies.

## Variables, credentials and networking

Keep stable non-secret defaults in the image. Inject run/task identifiers and ownership metadata when assigning work. Materialise worker credentials through the approved credential mechanism at runtime, scoped to their purpose. Separate agent runtime homes so account/session files cannot collide. Provider management credentials remain with the provisioner; sandbox workers do not receive them.

The baseline rotates credentials by restarting/re-establishing the affected worker process with a new credential version and checkpoint. It does not assume an environment update changes an already running process. Any preview environment-update path needs a separate capability test and conflict-safe read/modify/write procedure. Audit which workers actually loaded a credential version. Preparation, logs, configuration digests and evidence packets must not disclose raw secrets.

All sandboxes must reach an authenticated TLS coordinator endpoint and the required Git, artifact, package and model endpoints. Do not infer shared private routing from Railway's networking model. Record the endpoint and network policy per pool; qualify outbound connectivity, reconnection, DNS/TLS behaviour and any required kernel/network capabilities for each workload. Direct unrestricted access to PostgreSQL is not a worker requirement.

## Long-running supervisor and agent processes

Launch the supervisor as a tracked foreground process, with `keepAlive: true`, `timeout: 0`, and non-blocking completion behaviour. Use separate short, bounded API requests for observation. The run policy still enforces maximum execution duration, cancellation and checkpoint limits in Hyperfide; indefinite provider lifetime is not an unlimited task authorisation.

Distinguish three clocks in records and errors: provisioning deadline, API wait deadline and process execution deadline. A wait-call timeout creates an observation/reconciliation action, not a new task attempt. Finite verification jobs use explicit job deadlines and observed exits.

The supervisor owns each agent's local stdio or local protocol connection and persists the native session identity/checkpoint association. Controller connectivity must not be the lifetime of that local channel. Where provider stdin is used, verify the published sandbox-api/SDK capability. Do not blindly replay a failed byte write: use application-level message IDs, acknowledgements, fencing and session handshakes to recover logical delivery. A broken pipe or partial delivery requires protocol recovery before further instructions. Auto-restarting a process is not evidence that its native agent session or pending messages survived.

Provider standby/resume is a transport event. On reconnect, re-register boot/process/session observations and validate current ownership before accepting authoritative updates. Disable conflicting expiration policies for the intended run where the account permits it; otherwise admit only work whose duration and recovery policy fit the effective expiry. Track expiry as an observed constraint with lead time for checkpoint and replacement. Do not rely on apparent activity to reset `ttl-idle`.

## Recovery and optional snapshot experiments

The baseline recovers using a fresh supervisor, portable source/session checkpoints, durable messages, and a current ownership generation. A restored native session must be identified as resumed or recreated; preserve that distinction in audit history.

Optional snapshot/fork experiments must start from quiescent, credential-sanitised preparation or enforce a boot gate before cloned processes can contact external systems. A child must receive a new sandbox identity and registration credentials; inherited task leases, process identities, credentials and outbound connections cannot authorise it. Full-memory cloning can duplicate live secrets and pending side effects, so a fork is never a shortcut around fencing and registration. No production acceptance depends on the preview feature becoming available.

## Qualification scenarios and evidence

The native plan must map these scenarios to pending implementation/qualification tasks. Commands and harness paths will be defined during implementation; this document does not pretend they already exist. All real-provider tests require implementation approval and the account's permitted test scope.

| Scenario ID | Planned exercise | Passing evidence |
|---|---|---|
| BLX-Q01 | Publish each required toolchain image, including a default-slimming negative fixture. | Remote manifests and actual compiler/build/agent/API probes; negative image rejected before READY. |
| BLX-Q02 | Retry the same creation intent; interrupt the response; race provisioner recovery; return a same-name mismatched sandbox; create duplicate external IDs. | One accepted resource per generation, configuration comparison, complete inventory reconciliation, no unintended adoption. |
| BLX-Q03 | Start two worker slots in one sandbox and execute representative builds/tests. | Separate homes/worktrees/ports/outputs; pinned commits; measured CPU/memory/storage; no cross-slot corruption. |
| BLX-Q04 | Compile a large workload with outputs first in tmpfs and then the configured volume; fill a bounded spool/volume fixture. | Correct capacity rejection/backpressure/checkpoint behaviour; memory and filesystem limits recorded; no loss of previously accepted evidence. |
| BLX-Q05 | Prepare a volume template with `pnpm`/`uv`-style links; mount over preloaded content; replace a sandbox retaining its volume. | Rejected or corrected unsupported layout; post-mount validation; exclusive attachment and fenced recovery. |
| BLX-Q06 | Disconnect the controller beyond normal standby thresholds while a keepAlive supervisor runs; use a shortened keepAlive default-timeout negative fixture. | Worker continuation with explicit lifetime settings, connection-independent tracking; timeout fixture diagnosed correctly. |
| BLX-Q07 | Expire an API completion wait while the process continues; separately enforce a job execution timeout. | Distinct wait/process outcomes; reconciliation without duplicate execution; explicit exit and cancellation evidence. |
| BLX-Q08 | Force stdin partial-write/backpressure, process restart, sandbox-api restart, connection loss and re-handshake. | No silent logical-message loss/duplication, session/generation changes recorded, stale writes/results rejected. |
| BLX-Q09 | Run a short `ttl-idle` negative fixture continuously; observe actual account expiry; restore after sandbox loss. | Expiration model confirmed, incompatible profiles rejected, checkpoint recovered and old attempt fenced. |
| BLX-Q10 | Inject different worker environments, rotate credentials, and optionally exercise preview env updates. | Existing/new-process environment distinction verified, no credential leakage, supported rotation path qualified. |
| BLX-Q11 | Interrupt coordinator/Git/artifact connectivity and simulate standby/resume. | Reconnect and spool handling, authenticated registration, ownership validation, bounded retry and no direct database dependency. |
| BLX-Q12 | Delete/recreate sandbox, crash provisioner during teardown, leave orphaned resource/volume, then reconcile. | No premature deletion of owned resources; eventual cleanup or explicit retained recovery inventory. |
| BLX-Q13 | Run an approved 72-hour profile with representative coding/review/build load; restart control processes and lose a sandbox. | Continuous durable telemetry, checkpoint/evidence integrity, stated recovery limits achieved, complete end-of-run resource inventory. |
| BLX-Q14 | If separately enabled, fork a quiescent preparation and attempt a cloned live ownership update. | Fresh registration succeeds, cloned ownership cannot publish, preview disabled leaves baseline operational. |

Qualification reports must retain SDK/API/image versions, account scope, effective limits, region, configuration manifest, injected-fault timestamps, raw redacted observations, artifact hashes, assertions and residual gaps. Public cold-start claims do not substitute for measured provision-to-ready time with this codebase. No numerical performance improvement is established by this specification.
