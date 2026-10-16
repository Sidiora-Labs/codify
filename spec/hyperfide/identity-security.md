# Hyperfide identity, credentials, and native session contract

Status: PROPOSED DESIGN for review, 2026-10-16. Implementation and live-provider qualification are UNRUN. This chapter supplies the authentication and authority boundaries for the execution contract; the deployment must select and qualify account-session, API-credential, or mixed authentication profiles before enablement.

## 1. Scope and provenance

The proposed operating model routes human interaction through the primary leader, confines the main control host to supervision, and performs implementation and execution in remote sandboxes. Coding-agent routing follows the declared connector policy. Implementation requires specification approval. Routine task execution must not introduce a human approval per task.

The credentials, enrollment mechanism, capability boundaries, and acceptance cases below are engineering proposals. They need implementation, negative testing, and account-specific qualification. No credential file, account token, or secret was read during authoring.

### Verified current baseline

Source inspection date: 2026-10-16. Existing launch behaviour is evidence about current Codify, not a qualified Hyperfide security boundary.

| Current source | Verified behaviour | Required migration |
|---|---|---|
| `src/drivers.c:74`, `driver_argv` | Builds Codex `exec` arguments with `workspace-write`, and Claude `-p` with `acceptEdits`; structured output is selected when configured. Custom launch templates use a shell. | Replace implicit defaults with a versioned connector/permission profile and structured argument construction. Existing defaults do not prove unattended operation or main-server execution restrictions. |
| `src/orchestrate.c:495`, `orch_spawn`; `src/orchestrate.c:1210`, `orch_fleet_exec` | Forks local processes, supplies task/attempt/fence labels through environment variables, redirects logs, and invokes `execvp`. The fleet launch clears task labels for managers. | Preserve attribution while replacing environment labels as proof of authority. These paths do not establish an authenticated remote credential or environment-allowlist boundary. |
| `src/drivers.c:157`, `parse_claude` | Extracts native session metadata and results from structured output. | Keep the parser, native session, process identity, and Hyperfide assignment distinct; none alone establishes qualification. |

Official documentation checked 2026-10-16 establishes the following bounded facts:

- Codex supports ChatGPT and API-key authentication, with different organisational data controls. Its credential storage may be file-based or use a credential store, and active ChatGPT sessions can refresh authentication. Concurrency entitlement and unattended use must be qualified for each deployment. [Official authentication documentation](https://learn.chatgpt.com/docs/auth)
- Codex noninteractive execution can resume an explicit session ID. Its automation guidance distinguishes saved-account authentication from API credentials and warns against exposing inference keys to repository-controlled jobs. Cross-machine restoration still requires qualification of the pinned runtime and required persisted state. [Official noninteractive documentation](https://learn.chatgpt.com/docs/non-interactive-mode)
- Claude Code documents multiple credential sources, configurable credential directories, and precedence rules. Ambient credentials can change which source is selected. [Official authentication documentation](https://code.claude.com/docs/en/authentication)
- Claude Code documents structured session output, explicit-session resume, and version-dependent unattended permission behaviour. Bare mode changes what configuration and authentication are loaded; it is not an interchangeable default for every account mode. [Official programmatic execution documentation](https://code.claude.com/docs/en/headless)

Model profiles distinguish configured deployment aliases from public vendor identifiers. Hyperfide records the requested profile and the actual runtime-reported model identifier; it must not fabricate vendor identity or availability.

## 2. Identity and authority model

Authentication proves which principal sent a request. Authorisation separately determines whether its role, assignment, generation, run policy, and current state allow that operation. A native CLI session, process ID, branch name, `CG_ROLE`, or model assertion is not an authority credential.

Proposed principals:

| Principal | Identity binding | Permitted surface |
|---|---|---|
| Human operator | Existing operator authentication, selected during deployment qualification | Spec/run authorisation and leader interaction; no worker-facing account secret |
| Primary leader | Registered agent identity and run-scoped supervision session | Programme decisions and delegation within the approved run policy |
| Feature manager | Registered identity, package/domain/wave ownership, generation | Requests, steering, findings, and closure requests for its scope |
| Coordinator/provisioner | Service identity independent of native coding agents | Durable state transitions and provider administration through designated adapters |
| Sandbox runner | Run, provider resource, sandbox generation, boot identity | Slot registration, assigned command receipt, process events, checkpoints, scoped artifact transport |
| Worker/reviewer/verifier | Parent runner, slot, role, agent session, assignment generation | Assigned context and operation-specific API calls |
| Integration publisher | Dedicated integration assignment and target generation | Conditional publication for an authorised target and expected base |
| GitHub mirror | Dedicated service identity and repository scope | Issue/PR mirror operations, event reconciliation, and attribution |

All authority-bearing calls go through authenticated control APIs. Workers receive no PostgreSQL password, arbitrary SQL interface, provider administration token, or fleet-wide credential. Run and attempt IDs are identifiers, not secrets and not authorisation.

### Enrollment and boot generation

1. Before provisioning, the coordinator persists a resource request and its generation. The provisioner obtains a short-lived, single-use enrollment grant bound to that request, run, provider pool, and intended runner role. Store a verifier rather than the reusable grant value in normal PostgreSQL metadata.
2. The provisioner delivers the grant through a provider-supported runtime channel, not through the prepared image, Git, a task prompt, or a command-line argument that is ordinarily logged. The provider adapter must qualify exposure and deletion behaviour for its chosen channel.
3. A fresh runner creates its own key material outside worker-accessible storage. Enrollment presents the grant, key proof, and boot identity. The controller checks grant expiry/consumption and the recorded provider resource using the provider adapter's observation. Provider resource IDs supplied by the runner alone are insufficient proof.
4. An atomic primary-database transaction consumes the grant and binds the runner key to that resource generation. The response supplies an expiring runner credential; mutual TLS with a runner-owned key is the proposed transport identity. Exact certificate authority implementation is an implementation decision, not an existing provider feature claim.
5. Duplicate enrollment cannot establish a second live runner for the same generation. If a cloned or ambiguous boot consumes the grant first, quarantine the generation and reconcile the provider resource before executing work. Do not treat first enrollment alone as conclusive hardware attestation.
6. Restarting, restoring, or replacing a sandbox follows an explicit reattachment/new-generation decision. A restored disk must not cause unattended reuse of a copied live runner identity. Revoked generations cannot renew credentials or accept new work.

Runner authentication does not grant arbitrary task ownership. Assignment acceptance still validates the task attempt's independent ownership generation on the primary. Provider API authentication, runner identity, native agent authentication, and Git identity have distinct lifecycles.

## 3. Run policy and location enforcement

The reviewed run manifest contains a versioned policy: permitted repositories and refs, provider pools, credential profiles, model profiles, external endpoints, artifact scopes, integration targets, allowed action classes, concurrency/spend limits, and recovery behaviour. Agents can request permitted operations; the coordinator validates them. A changed prompt cannot expand that policy.

Main-host leader and manager connectors use a supervision profile: read source/context/evidence, query run state, delegate, steer, and record decisions. They receive remote execution APIs for installs, indexing, builds, tests, reproductions, and integration. Their local workspace access and command surface must enforce the supervision-only placement policy beyond a prompt. In particular, generic local shell or write privileges must not provide an untracked path to implementation on the main server. Unsupported host-level restrictions are an open qualification that blocks production main-host enablement.

Remote worker policies permit the editing, dependency preparation, testing, and other actions required by the assigned role without asking humans for each task. Integration publication remains a separate capability. Missing permission is a structured failure routed to the manager, with the primary leader as the sole human escalation surface. An agent cannot remediate a denied operation by choosing broader native permission flags or a different credential source.

Untrusted repository text, dependency output, build logs, model judgements, and GitHub issue bodies are data. They cannot grant leases, change policy, create credentials, enable providers, or authorise merges. A model's proposed action must pass the same server-side validation as any other request.

## 4. Credential profiles and injection lifecycle

Each connector declares a pluggable authentication profile. Required modes are `account_session` and `api_credential`; a deployment may configure either or both after qualification. Additional vendor-supported modes, such as a qualified gateway or federation, are capability extensions. These names are proposed Hyperfide configuration concepts, not claimed CLI flags or token formats.

The profile records a secret reference, connector/runtime version, intended account/workspace or project identity, permitted model/service, refresh owner, expiry/revocation behaviour, and policy version. PostgreSQL and task packets carry references and non-secret status, never raw refresh tokens, key contents, or credential files.

| Layer | Allowed contents | Lifecycle rule |
|---|---|---|
| Toolchain image/template | Tools, pinned agent binaries, public CA material, non-secret configuration | No active account sessions, enrollment grants, runner keys, or runtime credentials |
| Repository seed/dependency cache | Source/dependencies allowed for its declared repository/trust scope | Remove credential helpers, private auth files, secret configuration, and embedded credential URLs before publication |
| Build preparation | Task-specific package access when required | Ephemeral credential attachment; no model/admin credentials inherited by dependency scripts |
| Runner runtime | Runner credential and selected secret provisioning channel | Supervisor-only ownership; rotate independently of agent conversation state |
| Agent runtime | Only selected connector authentication and assignment capabilities | Explicit allowlist; no inherited controller environment or unrelated credential-source precedence |
| Tests/application runtime | Only fixture/application credentials actually required | Separate from inference, provider administration, Git publication, and runner authority |

Prefer qualified credential brokers/proxies or scoped helper mechanisms where they remove long-lived secrets from repository-controlled processes. A proxy is optional by capability; account sessions and provider protocols must not be silently rerouted or rewritten through an incompatible gateway. If a mode requires a raw credential inside the sandbox, record that exposure and use the narrowest isolated process boundary supported by the qualified profile.

Setting a secret only on an agent process does not by itself isolate it from that agent's child shell. Native home directories alone also do not isolate two processes sharing a UID. Therefore credential-sensitive slots must use distinct operating-system identities or stronger sandbox isolation, with supervisor credentials inaccessible to worker processes. Where the provider cannot enforce that boundary, place the workloads in separate sandboxes or use a qualified broker; do not claim secrecy through directory naming.

Each slot has a distinct native runtime home/configuration, session directory, temporary directory, and credential attachment. Concurrent agents must not share a writable login store. Shared read-only toolchain caches must not contain user sessions. Credential-bearing files, if required, have restrictive ownership and modes and remain outside Git worktrees and ordinary artifact collection.

### Account refresh and 72-hour operation

The authentication adapter declares whether it supports shared account concurrency, per-session credentials, in-place refresh, credential replacement requiring process restart, and remote session restoration. Unknown capabilities remain disabled.

Refreshable account state has one qualified mutation owner per credential lineage, or independently issued lineages with documented safe concurrency. Multiple agents must not race on a copied shared refresh file. Updated refresh state is persisted through the secret service with conditional versioning; an older sandbox cannot overwrite a newer refresh version. The implementation must test actual pinned-client refresh behaviour rather than assuming every OAuth token is safely cloneable.

For a 72-hour run, credential readiness includes predicted expiry and a tested refresh/rotation path. Credential rotation must preserve the distinction between native conversation, running process, authenticated principal, and authoritative attempt. If process restart is required, checkpoint first and resume the explicit session where supported. Authentication failure becomes `AUTH_BLOCKED` or an equivalent typed operational condition, with checkpoints preserved and manager-visible remediation; no retry storm or repeated interactive login prompt.

On reassignment or revocation, invalidate server-side attempt authority immediately. Separately revoke or expire applicable artifact/Git credentials and stop the old process where reachable. An issued remote-service credential may outlive attempt revocation; publication and result-acceptance gates must remain effective despite that window.

## 5. Native connector/session contract

Every launch records the connector build/version, binary digest, structured argument vector with secrets removed, authentication-profile identity, requested and observed model, policy digest, runtime home, workspace identity, native session ID, process identity, parent identity, and assignment generation. Record effective capabilities and startup errors, not just intended configuration.

Use explicit session identity for resume. A generic “most recent session” selector is forbidden for automated recovery in multi-agent environments. Resume requires compatible persisted state, appropriate credentials, checked workspace revision, current lease, and the recorded connector capabilities. When native resume cannot be qualified, start a fresh session from an evidence/checkpoint packet and label it as a new session.

Native child agents must enter Hyperfide's agent registry before executing independently: parent session, child native identity, effective role, resource slot/budget, and inherited or separately assigned task authority. Children cannot silently multiply sessions, inherit provider-admin credentials, acquire a parent manager's full authority, or publish under another attempt. If a native delegation mechanism cannot provide these controls, disable that mechanism for production profiles and delegate through the coordinator instead.

Permission profiles are versioned per connector, role, and authentication mode. Startup qualification verifies that expected tools and hooks loaded, the selected model is usable, unattended actions behave as intended, forbidden actions are denied, and unknown options fail clearly. A clean exit, native success result, or model availability list is not sufficient evidence. Do not add universal bypass flags to solve stalled permissions.

The system must qualify account terms, deployment policy, entitlement, actual runtime concurrency, and model availability through the authorised operator/account channel. This pack neither asserts a licence permission nor invents a prohibition. Account-specific authentication answers remain open; unrelated orchestration design can proceed.

## 6. Git, GitHub, artifacts, and data movement

Workers may fetch assigned repositories and publish only to their assigned attempt namespace through an enforced Git gateway/server ACL or coordinator-mediated publisher. Many broad repository tokens do not restrict a credential to one branch; naming a branch in a task is not an enforcement mechanism. Protected integration refs require the dedicated integration publisher and expected-base/generation checks. A stale worker may upload quarantined recovery artifacts, but cannot mutate accepted results or target refs.

The GitHub mirror has dedicated issue/PR permissions. Workers submit internal findings through the coordinator; the mirror deduplicates by stable finding identity and repository/issue mapping. GitHub webhook authentication and event IDs are validated; replayed events produce one durable effect. External issue content never authorises task reassignment by itself. Existing ten-minute issue polling is retained as the default reconciliation mechanism alongside event-driven routing, without requiring token distribution to each watcher. Changing or disabling that interval requires an explicit accepted run-policy amendment; webhook availability alone does not remove the baseline poll. The run retains the default 10–15 commit-watcher baseline and full commit coverage; any change to that baseline also requires an explicit accepted policy amendment.

Artifact access uses run/repository/assignment scopes, bounded lifetime, and explicit object namespaces. Workers cannot list other runs or overwrite accepted evidence. Completion requires verified object digest and durable storage acknowledgement; an unverified upload URL is not evidence. Sensitive native session archives have a stricter access class than ordinary build logs because they can contain conversation content and user data.

Logs and events redact registered secret values and known credential-bearing fields before normal collection, including provider errors and command arguments. Use stream-aware redaction that handles a value split across output chunks. Redaction cannot prove arbitrary secret absence, so prevent credential exposure at source and keep exceptional restricted raw evidence out of model packets, dashboards, and GitHub. Audit events identify credential references and versions without recording secret values.

Run policy declares source/data egress permissions for frontier providers, decision providers, GitHub, artifacts, package registries, and optional gateways. Decision packets carry the minimum relevant source excerpts and explicit source IDs. Span/Jev/D1 fallback routing cannot bypass a repository's permitted destination or send credential/session material. Retention, deletion, encryption/access mechanisms, region requirements where applicable, and legal holds are explicit deployment/run settings; this pack does not invent deployment retention durations or assume a vendor's privacy terms.

Prepared images and caches are immutable to ordinary workers. A publisher promotes cache artifacts only with scope, toolchain/input identity, integrity metadata, and permission checks. Private dependencies and source seeds must not be exposed to a broader pool through shared cache keys. Cache content is never trusted as authority-bearing configuration.

### Checkpoint/fork handling

Reusable disk snapshots must be created from a sanitised preparation state before enrollment and runtime authentication. A full filesystem checkpoint of an authenticated worker is sensitive runtime recovery material, never a reusable public/base seed. Restoring it requires new runner generation registration, credential revalidation, removal/replacement of copied authority, and process reconciliation before work resumes.

A memory/process snapshot can capture active credentials, private keys, and open authenticated connections. Forking such a snapshot must be disabled unless the adapter demonstrates that children cannot act under duplicated identities before re-enrollment. Stopping workers after a clone has already resumed is insufficient. Use cold preparation plus fresh runners as the baseline when pre-resume identity replacement is unsupported.

## 7. Acceptance scenarios — all UNRUN

These scenarios require implemented interfaces and isolated test credentials after implementation approval. No live credentials are needed to author the pack.

| ID | Scenario | Required observable result |
|---|---|---|
| SEC-01 | Replay a consumed enrollment grant from another process and sandbox generation. | No second runner becomes active; denied call and generation mismatch are audited without logging the grant. |
| SEC-02 | Restore a disk containing a prior runner identity and an expired task packet. | No work or authoritative publication occurs before reattachment/re-enrollment and current-attempt validation. |
| SEC-03 | Simulate simultaneous credential refresh and a stale credential-state writer. | A stale state write cannot replace the current lineage; active session recovery follows the qualified adapter policy. |
| SEC-04 | Run a dependency hook/test that attempts to read provider-admin, runner, other-slot, and inference secrets. | Forbidden credentials are absent or inaccessible under the selected isolation profile; any intentionally exposed credential class is declared and scoped. |
| SEC-05 | Submit a protected-branch push with a valid worker credential, then submit with an expired integration generation. | Both are refused by the enforcement boundary, independently of the model's command choice. |
| SEC-06 | Issue a valid worker API request for another run or assignment. | Authenticated principal receives denial; no data or durable state change crosses scope. |
| SEC-07 | Supply a repository file, GitHub issue, or model recommendation requesting a wider lease or credential. | Request cannot alter authority without a policy-valid coordinator operation. |
| SEC-08 | Put a canary secret into structured error output and split output chunks. | Normal logs, decision packets, issue mirror, and dashboards contain no canary; restricted evidence policy remains explicit. |
| SEC-09 | Attempt to launch a local build/install/indexing job through a main-host manager tool. | Enforced denial plus remote-job route; no implementation workload runs on the main server. |
| SEC-10 | Start two slots and recover each explicit native session after interruption. | Correct conversation/workspace identities are restored; no most-recent-session crossover or shared writable auth store. |
| SEC-11 | Expire/revoke credentials during the 72-hour qualification run. | Refresh/rotation or typed pause is observable; checkpoints survive and no uncontrolled auth retry/interactive prompt loop develops. |
| SEC-12 | Spawn an unregistered native child agent or use an unknown permission option. | Profile refuses unsupported delegation/startup; child cannot obtain untracked execution authority. |
| SEC-13 | Deliver duplicate authenticated GitHub events and duplicate finding publication. | One internal effect and one mirror mapping; spoofed signatures are rejected. |
| SEC-14 | Request another run's artifact or overwrite sealed evidence using an old upload capability. | Access/overwrite denied; accepted digest and evidence record unchanged. |
| SEC-15 | Attempt to seed a prepared image with session files, a runner key, or private cross-scope cache content. | Publication gate rejects the seed or confines it as explicitly classified recovery material. |
| SEC-16 | Restart a manager or rotate runner transport identity while its worker remains valid. | Authority checks preserve valid work without duplicating ownership; security metadata and native session identity remain independently auditable. |
| SEC-17 | Attempt decision-model fallback to a destination disallowed by repository policy. | No outbound request occurs; a policy-compatible abstention/fallback is recorded. |
| SEC-18 | Simulate a clone resuming active identity before sanitisation. | Snapshot mode is disabled or blocked before execution; no duplicate principal can acquire work. |

## 8. Open qualification register

| ID | Question / qualification task | Evidence required before enablement |
|---|---|---|
| AUTH-Q1 | Which authentication modes, account/workspace identities, and entitlement model do the deployment’s Codex/Claude workers use? | Operator-supplied non-secret configuration decision; no copying of credential contents into the pack. |
| AUTH-Q2 | Can each pinned native runtime safely run the required account concurrency and refresh for 72 hours? | Approved account guidance plus controlled concurrency/refresh/restart traces; observed active principal and credential version. |
| AUTH-Q3 | How are launch, interruption, exact-session resume, cross-sandbox restoration, and children exposed by the selected versions? | Connector capability matrix and recorded positive/negative session tests. |
| AUTH-Q4 | Which provider injection channels, filesystem/process isolation, and cleanup semantics meet the contract? | Railway and Blaxel adapter qualification demonstrating absent cross-slot/admin secrets and bootstrap replay denial. |
| AUTH-Q5 | Can model auth be brokered without breaking the selected mode? | End-to-end connector test, actual model request, error/refresh behaviour, and proof that repository processes cannot retrieve the upstream secret. |
| AUTH-Q6 | How are Git ref ACLs and publication fencing enforced? | Server/gateway ACL configuration and stale/unauthorised push tests; branch naming alone fails qualification. |
| AUTH-Q7 | What data destination, retention, region, deletion, and restricted-session policies apply to the deployment? | Approved run/deployment policy; populated defaults and deletion/access tests. |
| AUTH-Q8 | Can main-host profiles enforce supervision-only execution while remaining useful? | Main-role denied-action tests and successful delegation; documented actual OS/tool boundary. |

These are enablement dependencies for the affected profiles. They do not justify fabricating auth commands, token formats, licence rules, or completed qualification, and they do not prevent unrelated contract implementation after specification approval.
