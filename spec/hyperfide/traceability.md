# Implementation traceability

Status: approved for implementation on 2026-10-16. This crosswalk is the historical planning baseline; native KVX tracks live task progress, and product cases require independent full-case evidence. This public crosswalk maps the 112 normative clauses in the [native specification](spec.kvx) to 112 implementation task identities, 56 canonical verification cases and their design contracts. It contains implementation coverage, not execution evidence.

A clause identifier `N.M` means `[req.N] ac_M`. Task identifiers resolve in the [implementation plan](implementation-plan.md) and [task catalogue](evidence/task-catalog.json). Verification identifiers resolve in [verification.md](verification.md). The machine-readable source for this table is [traceability.json](evidence/traceability.json).

The listed cases are the exact union assigned to the covering tasks. A task may execute a registered component variant of a case; complete case acceptance still requires all mandatory assertions and every applicable provider, connector and campaign variant. Linking a clause, declaring a task complete or passing structural pack validation does not establish product qualification.

| Native clause | Implementation task | Canonical verification cases | Design contracts |
|---|---|---|---|
| 1.1 | 1.1 | V-007, V-052 | [design.body.md](design.body.md); [execution-contract.md](execution-contract.md) |
| 1.2 | 1.2 | V-001, V-008 | [design.body.md](design.body.md); [execution-contract.md](execution-contract.md) |
| 1.3 | 1.3 | V-042, V-044 | [design.body.md](design.body.md); [execution-contract.md](execution-contract.md) |
| 1.4 | 1.4 | V-001, V-028 | [design.body.md](design.body.md); [execution-contract.md](execution-contract.md) |
| 2.1 | 2.1 | V-001, V-024 | [execution-contract.md](execution-contract.md); [assurance.md](assurance.md) |
| 2.2 | 2.2 | V-001, V-024 | [execution-contract.md](execution-contract.md); [assurance.md](assurance.md) |
| 2.3 | 2.3 | V-001, V-014 | [execution-contract.md](execution-contract.md); [assurance.md](assurance.md) |
| 2.4 | 2.4 | V-013, V-034 | [execution-contract.md](execution-contract.md); [assurance.md](assurance.md) |
| 3.1 | 3.1 | V-001, V-008 | [execution-contract.md](execution-contract.md); [schematics.md](schematics.md) |
| 3.2 | 3.2 | V-001, V-014 | [execution-contract.md](execution-contract.md); [schematics.md](schematics.md) |
| 3.3 | 3.3 | V-010, V-016 | [execution-contract.md](execution-contract.md); [schematics.md](schematics.md) |
| 3.4 | 3.4 | V-007, V-008 | [execution-contract.md](execution-contract.md); [schematics.md](schematics.md) |
| 4.1 | 4.1 | V-002, V-015 | [storage.md](storage.md) |
| 4.2 | 4.2 | V-002, V-011 | [storage.md](storage.md) |
| 4.3 | 4.3 | V-010, V-023 | [storage.md](storage.md) |
| 4.4 | 4.4 | V-009, V-053 | [storage.md](storage.md) |
| 5.1 | 5.1 | V-002, V-007 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 5.2 | 5.2 | V-003, V-004 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 5.3 | 5.3 | V-004, V-037 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 5.4 | 5.4 | V-007, V-047 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 6.1 | 6.1 | V-005 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 6.2 | 6.2 | V-005, V-016 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 6.3 | 6.3 | V-006 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 6.4 | 6.4 | V-005, V-008 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 7.1 | 7.1 | V-018, V-020 | [storage.md](storage.md); [migration.md](migration.md) |
| 7.2 | 7.2 | V-011, V-022 | [storage.md](storage.md); [migration.md](migration.md) |
| 7.3 | 7.3 | V-021, V-022 | [storage.md](storage.md); [migration.md](migration.md) |
| 7.4 | 7.4 | V-020, V-021, V-025, V-048, V-023 | [storage.md](storage.md); [migration.md](migration.md) |
| 8.1 | 8.1 | V-036, V-041 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 8.2 | 8.2 | V-007, V-036 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 8.3 | 8.3 | V-037, V-054 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 8.4 | 8.4 | V-036, V-049 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 9.1 | 9.1 | V-036, V-038, V-041 | [providers/railway.md](providers/railway.md) |
| 9.2 | 9.2 | V-036, V-038 | [providers/railway.md](providers/railway.md) |
| 9.3 | 9.3 | V-039, V-041 | [providers/railway.md](providers/railway.md) |
| 9.4 | 9.4 | V-036, V-037, V-041 | [providers/railway.md](providers/railway.md) |
| 10.1 | 10.1 | V-038, V-039 | [providers/blaxel.md](providers/blaxel.md) |
| 10.2 | 10.2 | V-036, V-041 | [providers/blaxel.md](providers/blaxel.md) |
| 10.3 | 10.3 | V-037, V-041 | [providers/blaxel.md](providers/blaxel.md) |
| 10.4 | 10.4 | V-040, V-041 | [providers/blaxel.md](providers/blaxel.md) |
| 11.1 | 11.1 | V-038, V-040 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 11.2 | 11.2 | V-038, V-039 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 11.3 | 11.3 | V-036, V-038, V-039 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 11.4 | 11.4 | V-007, V-038 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 11.5 | 11.5 | V-038, V-057 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 12.1 | 12.1 | V-015, V-039 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 12.2 | 12.2 | V-006, V-041, V-043 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 12.3 | 12.3 | V-007, V-044 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 12.4 | 12.4 | V-006, V-017 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 13.1 | 13.1 | V-042 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 13.2 | 13.2 | V-042, V-043 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 13.3 | 13.3 | V-043, V-044 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 13.4 | 13.4 | V-007, V-042, V-044 | [execution-contract.md](execution-contract.md); [identity-security.md](identity-security.md) |
| 14.1 | 14.1 | V-015, V-040 | [identity-security.md](identity-security.md) |
| 14.2 | 14.2 | V-040 | [identity-security.md](identity-security.md) |
| 14.3 | 14.3 | V-040, V-042 | [identity-security.md](identity-security.md) |
| 14.4 | 14.4 | V-015, V-016, V-040 | [identity-security.md](identity-security.md) |
| 15.1 | 15.1 | V-012, V-043 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 15.2 | 15.2 | V-012 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 15.3 | 15.3 | V-003, V-014, V-043 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 15.4 | 15.4 | V-012, V-054 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 16.1 | 16.1 | V-013, V-034 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 16.2 | 16.2 | V-013, V-056 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 16.3 | 16.3 | V-013, V-034 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 16.4 | 16.4 | V-014, V-034 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 17.1 | 17.1 | V-031 | [assurance.md](assurance.md) |
| 17.2 | 17.2 | V-029, V-034 | [assurance.md](assurance.md) |
| 17.3 | 17.3 | V-031, V-034 | [assurance.md](assurance.md) |
| 17.4 | 17.4 | V-029, V-030, V-052 | [assurance.md](assurance.md) |
| 18.1 | 18.1 | V-032 | [assurance.md](assurance.md); [execution-contract.md](execution-contract.md) |
| 18.2 | 18.2 | V-032 | [assurance.md](assurance.md); [execution-contract.md](execution-contract.md) |
| 18.3 | 18.3 | V-008, V-032 | [assurance.md](assurance.md); [execution-contract.md](execution-contract.md) |
| 18.4 | 18.4 | V-032, V-034 | [assurance.md](assurance.md); [execution-contract.md](execution-contract.md) |
| 19.1 | 19.1 | V-030, V-034 | [assurance.md](assurance.md); [storage.md](storage.md) |
| 19.2 | 19.2 | V-033 | [assurance.md](assurance.md); [storage.md](storage.md) |
| 19.3 | 19.3 | V-034 | [assurance.md](assurance.md); [storage.md](storage.md) |
| 19.4 | 19.4 | V-030, V-033 | [assurance.md](assurance.md); [storage.md](storage.md) |
| 20.1 | 20.1 | V-045 | [decision-models.md](decision-models.md) |
| 20.2 | 20.2 | V-045 | [decision-models.md](decision-models.md) |
| 20.3 | 20.3 | V-045 | [decision-models.md](decision-models.md) |
| 20.4 | 20.4 | V-011, V-045 | [decision-models.md](decision-models.md) |
| 21.1 | 21.1 | V-024, V-045 | [decision-models.md](decision-models.md) |
| 21.2 | 21.2 | V-044, V-045 | [decision-models.md](decision-models.md) |
| 21.3 | 21.3 | V-045 | [decision-models.md](decision-models.md) |
| 21.4 | 21.4 | V-014, V-045 | [decision-models.md](decision-models.md) |
| 22.1 | 22.1 | V-046 | [decision-models.md](decision-models.md); [verification.md](verification.md) |
| 22.2 | 22.2 | V-046 | [decision-models.md](decision-models.md); [verification.md](verification.md) |
| 22.3 | 22.3 | V-046 | [decision-models.md](decision-models.md); [verification.md](verification.md) |
| 22.4 | 22.4 | V-045, V-046 | [decision-models.md](decision-models.md); [verification.md](verification.md) |
| 23.1 | 23.1 | V-010, V-034 | [execution-contract.md](execution-contract.md); [verification.md](verification.md) |
| 23.2 | 23.2 | V-007, V-048 | [execution-contract.md](execution-contract.md); [verification.md](verification.md) |
| 23.3 | 23.3 | V-011, V-048 | [execution-contract.md](execution-contract.md); [verification.md](verification.md) |
| 23.4 | 23.4 | V-016, V-048 | [execution-contract.md](execution-contract.md); [verification.md](verification.md) |
| 24.1 | 24.1 | V-008, V-043 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 24.2 | 24.2 | V-004, V-041, V-049 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 24.3 | 24.3 | V-017, V-054 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 24.4 | 24.4 | V-009, V-049, V-053 | [execution-contract.md](execution-contract.md); [storage.md](storage.md) |
| 25.1 | 25.1 | V-018, V-019, V-025 | [migration.md](migration.md); [repository-baseline.md](repository-baseline.md) |
| 25.2 | 25.2 | V-019, V-028, V-055 | [migration.md](migration.md); [repository-baseline.md](repository-baseline.md) |
| 25.3 | 25.3 | V-019, V-027, V-028 | [migration.md](migration.md); [repository-baseline.md](repository-baseline.md) |
| 25.4 | 25.4 | V-028, V-052, V-055 | [migration.md](migration.md); [repository-baseline.md](repository-baseline.md) |
| 26.1 | 26.1 | V-026, V-028 | [migration.md](migration.md) |
| 26.2 | 26.2 | V-026, V-028 | [migration.md](migration.md) |
| 26.3 | 26.3 | V-026, V-055 | [migration.md](migration.md) |
| 26.4 | 26.4 | V-026, V-027 | [migration.md](migration.md) |
| 27.1 | 27.1 | V-056 | [verification.md](verification.md) |
| 27.2 | 27.2 | V-024, V-047, V-048, V-049 | [verification.md](verification.md) |
| 27.3 | 27.3 | V-036, V-037, V-038, V-039, V-040, V-041, V-042, V-043, V-044, V-045, V-046, V-050, V-051, V-052 | [verification.md](verification.md) |
| 27.4 | 27.4 | V-002, V-003, V-004, V-005, V-009, V-010, V-012, V-015, V-016, V-017, V-033, V-037, V-040, V-049, V-053, V-054 | [verification.md](verification.md) |
| 28.1 | 28.1 | V-028, V-035, V-052, V-055 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 28.2 | 28.2 | V-035 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 28.3 | 28.3 | V-034, V-053, V-054, V-055, V-056 | [assurance.md](assurance.md); [verification.md](verification.md) |
| 28.4 | 28.4 | V-024, V-034, V-056 | [assurance.md](assurance.md); [verification.md](verification.md) |
