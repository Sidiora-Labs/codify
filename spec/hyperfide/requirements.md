# Requirements index

Status: approved for implementation on 2026-10-16. Runtime qualification remains independent. The [native specification](spec.kvx) defines 28 requirement domains, each containing four normative acceptance clauses. All 112 clauses retain an explicit implementation and verification mapping in the [public crosswalk](traceability.md).

This index summarises engineering obligations. Deployment-specific resources, provider quotas, credentials, model aliases, permissions and workload inputs are supplied through an approved run policy and qualification manifests. Source research and structural authoring checks do not establish runtime behaviour or measured performance.

| Domain | Requirement | Native clauses | Detailed contracts |
|---|---|---|---|
| 1 | Programme authority and execution boundaries | 1.1–1.4 | [design.body.md](design.body.md); [execution-contract.md](execution-contract.md) |
| 2 | Versioned specification and dependency semantics | 2.1–2.4 | [execution-contract.md](execution-contract.md); [assurance.md](assurance.md) |
| 3 | Agent hierarchy and scoped context | 3.1–3.4 | [execution-contract.md](execution-contract.md); [schematics.md](schematics.md) |
| 4 | PostgreSQL authority and causal read routing | 4.1–4.4 | [storage.md](storage.md) |
| 5 | Scheduling, reservations and fenced ownership | 5.1–5.4 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 6 | Durable events, commands and steering | 6.1–6.4 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 7 | Central versioned graph and efficient indexing | 7.1–7.4 | [storage.md](storage.md); [migration.md](migration.md) |
| 8 | Provider abstraction and fleet inventory | 8.1–8.4 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 9 | Railway execution adapter | 9.1–9.4 | [providers/railway.md](providers/railway.md) |
| 10 | Blaxel execution adapter | 10.1–10.4 | [providers/blaxel.md](providers/blaxel.md) |
| 11 | Prepared environments and exact source bootstrap | 11.1–11.5 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 12 | Sandbox supervisor and isolated worker slots | 12.1–12.4 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 13 | Frontier agent connectors and session continuity | 13.1–13.4 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 14 | Identity, credentials and authority boundaries | 14.1–14.4 | [identity-security.md](identity-security.md) |
| 15 | Source workspaces, artifacts and checkpoints | 15.1–15.4 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 16 | Independent task qualification | 16.1–16.4 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 17 | Commit and semantic assurance | 17.1–17.4 | [assurance.md](assurance.md) |
| 18 | Finding lifecycle and GitHub issue coordination | 18.1–18.4 | [assurance.md](assurance.md); [execution-contract.md](execution-contract.md) |
| 19 | Integration, wave closure and programme acceptance | 19.1–19.4 | [assurance.md](assurance.md); [storage.md](storage.md) |
| 20 | Typed decision-provider interface | 20.1–20.4 | [decision-models.md](decision-models.md) |
| 21 | Bounded decision assistance | 21.1–21.4 | [decision-models.md](decision-models.md) |
| 22 | Decision evaluation and promotion | 22.1–22.4 | [decision-models.md](decision-models.md); [verification.md](verification.md) |
| 23 | Observability, resource admission and progress | 23.1–23.4 | [execution-contract.md](execution-contract.md); [verification.md](verification.md) |
| 24 | Failure recovery and operational control | 24.1–24.4 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 25 | Migration and compatibility | 25.1–25.4 | [migration.md](migration.md); [repository-baseline.md](repository-baseline.md) |
| 26 | Hyperfide rebranding and identity migration | 26.1–26.4 | [migration.md](migration.md) |
| 27 | Distributed qualification and scale campaign | 27.1–27.4 | [verification.md](verification.md) |
| 28 | Documentation closure and release readiness | 28.1–28.4 | [assurance.md](assurance.md); [verification.md](verification.md) |

## Acceptance boundary

The historical implementation catalog records initial pending states; native KVX owns live bootstrap progress. Canonical product cases remain UNRUN until their complete obligations qualify. Registered tests must validate exact source, environment, policy and evidence identities; unavailable fixtures, credentials or required variants block qualification. Worker declarations, nonempty proof strings, model recommendations and linked requirement identifiers cannot substitute for independent results.

Changes to programme intent, authority, dependency policy or closure criteria require a versioned review. Routine scheduling, recovery and repairs operate autonomously within the approved policy. Public repository artifacts contain reusable contracts and deliberately exclude deployment-specific operating records.
