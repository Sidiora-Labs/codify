# Hyperfide — implementation review pack

**Implementation authorised on 2026-10-16; product qualification remains evidence driven.** Hyperfide is the name requested for the Codify 2.0 successor. The approved workflow selects this feature; released product naming changes remain their own implementation tasks. The proposed public version is `2.0.0`; release numbering and the proposed `hyperfide` command are recorded decisions for review.

The proposed system puts the primary Claude Code or Codex leader and feature managers on a configured supervisory main server. PostgreSQL holds fleet authority and versioned shared graph state. Railway and Blaxel sandboxes run the engineering work. Humans work through the primary leader; managers request execution through Hyperfide, and independent evidence determines qualification and integration.

The specification preserves frontier implementation agents, three decision-model integrations and a qualification target of 100 parallel sandboxes, the large-run target of 200 concurrent remote agents, and 48–72-hour operation. It preserves **each of the configured 10–15 commit watchers reviewing every relevant commit**, with ten-minute GitHub issue reconciliation. Illustrative allocations and proposed optimisations are not account or performance guarantees.

## Read in this order

| Document | What it provides |
|---|---|
| [Design overview](design.body.md) | The complete operating model, boundaries, one-task walkthrough, authority and deployment choices. |
| [Schematics](schematics.md) | Ten architecture views, with thirteen standalone Mermaid sources: topology, roles, execution, state, custody, recovery, graph, reviews, fleet, migration and multiple repositories. |
| [Decisions and qualifications](decisions.md) | Direct user requirements, recommended choices and facts that still require implementation-time evidence. |
| [Implementation plan](implementation-plan.md) | 113 packages across 26 dependency waves, explicit ownership handoffs and verification interfaces. |
| [Native specification](spec.kvx) | 28 requirements / 113 acceptance clauses, live implementation tasks and 57 separately tracked canonical product cases. |
| [Verification](verification.md) | Strict evidence rules, fault tests, provider/native-agent qualification and actual 48/72-hour fleet campaigns. |
| [Traceability](traceability.md) | All 113 acceptance clauses linked to implementation tasks, canonical cases and contracts. |
| [Review report](reviews/README.md) | Review scope, findings, corrections, actual authoring checks and remaining limits. |

## Detailed contracts

- [Execution](execution-contract.md): roles, identities, preparation, bootstrap, slots, native sessions, commands, leases, custody, recovery and controls.
- [Storage](storage.md): PostgreSQL schema and transactions, replica freshness, reliable events, graph ingestion/search, Git publication, HA, backup and retention; ObjectBox assessment.
- [Railway](providers/railway.md) and [Blaxel](providers/blaxel.md): separate provider lifecycle contracts and account qualification.
- [Identity and security](identity-security.md): runtime variables, credential boundaries, enrollment, native authentication, isolation and rotation.
- [Assurance](assurance.md): independent checks, API/consumer semantics, every-commit review, findings, repairs, integration and documentation closure.
- [Decision models](decision-models.md): Span-02, Jev 1.14 and D1 Ultra research, adapters, bounded uses and evaluation; current Jev/recap migration.
- [Migration](migration.md): existing C/local functionality, proposed services, SQLite import, single-authority cutover, rollback, offline behaviour and full Hyperfide rebranding.
- [Repository baseline](repository-baseline.md): current source and verified implementation seams.
- [Requirements](requirements.md) and [publication boundaries](privacy.md): functional scope and the separation of public design from private working material.

## Evidence boundary

Source/documentation research and authoring checks establish a reviewable design. They do not prove that Hyperfide runs, that a deployment account has a required entitlement, or that a native authentication mode supports hundreds of sessions. The [native specification](spec.kvx) is the sole bootstrap task-progress authority. Canonical full-case status remains independent of component completion; the historical planning catalog retains its original pending states. The active repository feature is `hyperfide`.

[Pack validation](evidence/pack-validation.json) and [native lint](evidence/native-lint.json) preserve dated authoring checks against the original draft. Current structural checks use `python3 spec/hyperfide/tools/validate_pack.py --mode implementation` and write a separate report. Neither structural check executes product verification. The renderer requires the same explicit mode and preserves native task statuses and runtime evidence.

Reviewing or approving this pack is separate from provider/model campaign authorisation and release qualification. Routine execution after approval should be autonomous within a declared run policy; the unresolved account/authentication facts are explicit qualification tasks, not hidden assumptions or prompts for per-task human supervision.
