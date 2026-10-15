# Code indexing in Codify 1.6

Codify indexes source facts locally and records how it reached each graph
relationship. Queries report the branch, extraction coverage, and a bounded
check of the source files that contributed to the answer. A missing relation
does not prove that a call or data flow cannot occur.

```mermaid
flowchart LR
    A[Files and Git candidates] --> B[Change verification]
    B --> C[Bounded syntax extraction]
    C --> D[Symbols, references, bindings and type facts]
    D --> E[Scoped resolution]
    E --> F[Route and runtime relations]
    F --> G[Branch-scoped SQLite index]
    G --> H[Search, context and graph queries]
    H --> I[Coverage and source freshness]
```

## Extraction coverage

| Source family | Indexing mode | Boundary |
| --- | --- | --- |
| JavaScript, JSX, TypeScript, TSX | Native syntax grammar | Static imports, declarations, members, calls and JSX facts; computed targets remain unresolved. |
| C, C++, Objective-C, Go, Rust | Native syntax grammar | Macro expansion, dynamic dispatch and unknown function-pointer targets remain boundaries. |
| Python, Ruby, PHP | Native syntax grammar | Runtime attribute assignment, reflection and dynamic imports cannot be inferred from syntax alone. |
| Java, Kotlin, Scala, C#, Swift, Dart | Native syntax grammar | Overloads and ownership are recorded; dispatch without sufficient receiver or signature evidence stays unresolved. |
| Lua, Luau, R, Erlang, Solidity, Terraform, Nix | Native syntax grammar | Structural facts are extracted; each language's supported relation kinds depend on the syntax evidence available. |
| Pascal, COBOL, VB.NET, CFScript, CFQuery, ArkTS | Native syntax grammar | Error recovery can produce partial coverage; generated grammar facts do not imply runtime behavior. |
| CFML, Vue, Svelte, Astro, MyBatis XML | Embedded or declarative adapter | Embedded facts retain source coordinates; only recognized script, template and mapping constructs receive relationships. |
| Liquid, Razor, Delphi forms | Text or declarative adapter | Recognition is limited to supported literal constructs and references. |
| JSON, YAML, Twig, properties | File tracking only | These files are tracked but do not provide structural symbols or call relations. |

The parser identity and status are stored per file. Native grammar support
means that the file is parsed into syntax nodes; it does not mean that every
language construct is modeled. If parsing fails, the heuristic fallback is
identified separately. Syntax recovery, excessive depth or node count, long
lines, unreadable files, and unsupported input appear as partial, skipped, or
failed coverage with reason codes. The scanner skips files above 8 MiB; the
syntax runtime also bounds source size to 32 MiB, traversal to 500,000 nodes
and depth 512, and applies a two-second timeout to the parse stage. That
timeout is not an end-to-end indexing time limit.

## Relationships and evidence

Symbols retain their owner, qualified name, source span and available
signature, visibility, export, type and decorator facts. Import bindings
preserve local and original names, defaults, namespaces and re-exports. The
resolver uses those bindings, lexical ownership, declared or constructed
receiver types and known call arity before considering a name. Equal plausible
targets stay unresolved. An unknown receiver is an explicit boundary.

Call and other typed relations retain a source site, target when known,
strategy, provenance and evidence. `original_text` is the source-written
callee or reference name; qualifier and exact source span are separate
fields. This text is never replaced by the normalized target name.
Framework registrations become route facts. Unique handlers and literal
mounts can be connected, while competing handlers and computed paths stay
unresolved. Callback, event, queue and HTTP relations are heuristic when
they depend on registration or matching rules; their evidence records the
channel or registration site. These links are navigation aids, not proof of
all possible runtime flows.

## Freshness and migrations

`cg init` builds an index, `cg sync` updates changed files, and
`cg index --full` requests a full pass. `cg info --json`, `cg status --json`
and the `index_status` MCP tool show branch coverage, parser inventory,
pending reconciliation and degraded state. Code answers classify contributing
files as verified, stale or unchecked. The answer check has caps of 16 files,
4 MiB and 25 ms, so unchecked is a real limit rather than a freshness claim.

File changes use subsecond metadata and content verification for explicitly
dirty paths. Watcher loss creates durable reconciliation debt; the debt clears
only after successful reconciliation. Extractor output has a version separate
from the database schema. A version change re-extracts stale files, and
partial or failed passes do not stamp them current. Derived index tables may
be migrated or rebuilt; project memory, snapshots and workflow history remain
independent of derived extraction state.

Branch-specific files and graph endpoints stay isolated even when worktrees
share storage. Resolution and synthesized relations are retried when their
definitions, bindings or registrations change. A no-op sync skips those passes.

## Reproducing the release checks

`tests/integration/76_semantic_conformance.sh` runs the labelled adapter,
route and graph-convergence corpus. The labels distinguish recognized syntax,
resolved targets and explicitly unresolved cases; a file being parsed is not
counted as a successful relationship. `tests/integration/77_index_resources.sh`
checks cold, no-op and incremental operations against fixed fixture limits.
`scripts/bench-indexing.py` emits the raw timings, peak memory, database size,
diagnostics and source-to-query latency for repeatable local inspection.

`tests/integration/78_v16_release.sh` performs a clean strict build, runs the
unit and integration suites, checks the spec, and verifies the binary version.
Performance figures depend on the host, fixture, worker count and SQLite
version; keep those together when reporting an individual run.
