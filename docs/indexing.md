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
identified separately. Syntax recovery, excessive depth or node count,
unreadable files, and unsupported input appear as partial, skipped, or
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

`cg flow callers <name>`, `cg flow callees <name>`, `cg flow impact <name>`
and `cg flow paths <source> <target>` traverse typed branch-scoped relations.
The query bounds depth, nodes, edges, elapsed time and output bytes; JSON
includes source sites, provenance, dynamic boundaries and truncation reasons.
A missing path within those limits is not proof that no runtime path exists.
`cg search` and `cg context` accept path, language, kind and exact-name
filters. Identifier postings make compound names searchable by segment;
weaker typo-tolerant matches remain labelled as such.

`cg inspect hierarchy <name>` reports bounded ancestors, subtypes and
implementations from the typed graph. `cg inspect unused` identifies symbols
with no known incoming reference and internally referenced islands outside
known entry roots. Its results carry reasons for excluding exports, framework
roots, reflection candidates, generated files and uncertain incoming
boundaries. The CLI and MCP inspection surfaces use the current branch;
absence from the known graph is never a safe-deletion verdict.

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

The labelled conformance gate contains 43 adapter cases: 37 structural,
two reference-only, and four file-only. It also checks 37 typed relation
cases and 16 framework cases, each with a supported example and a decoy.
The integrated fixture run observed no labelled false positives or false
negatives, and its 13 incremental/rebuild checkpoints had no graph-set
differences. These are narrow micro-fixtures; they do not measure recall or
precision on arbitrary repositories.

The recorded resource run used binary SHA-256
`ab11a0a34cecd3427aa57cdd543d27d1e1891c45ea008fe6352f48172e31e92f`.
It predates the final retrieval follow-ups, so its timings are fixture observations
for that recorded binary rather than final-binary performance claims.
The run used two workers, generator seed 15, Linux 6.8 on
x86_64 with six effective cores, and SQLite 3.45.1 in contentless FTS mode.
The small fixture had 20 requested source files and 17,170 source bytes; the
large fixture had 1,000 files, 97,484 actual lines and 2,485,542 source bytes.
Measured process wall time for that single run was:

| Operation | Small | Large |
| --- | ---: | ---: |
| Cold index | 247 ms | 19,483 ms |
| No-op update | 40 ms | 88 ms |
| Edit one file | 46 ms | 4,361 ms |
| Delete one file | 33 ms | 4,113 ms |
| Rename one file | 47 ms | 4,028 ms |
| Replay back / forward | 63 / 49 ms | 4,342 / 4,172 ms |
| Full reindex | 152 ms | 21,948 ms |

The large fixture's edit-to-query wall time was 4,385 ms. Its full reindex
used about 58 MiB peak resident memory. After a sibling worktree index, its
SQLite main file plus WAL occupied 43,222,184 bytes, about 17.4 times the
source bytes across the two branch views. The main branch ended with 998
complete files, two skipped files and two files with diagnostics. A separate
160,000-comment-line Go file indexed in 835 ms with 89,340 KiB peak
resident memory; a 600-block-deep Go file reported partial coverage. These
figures describe those fixtures on that host, not a throughput guarantee.
The raw output is reproducible with `scripts/bench-indexing.py`; wall time is
authoritative because the phase timers do not include every semantic pass.

The strict release build produced one `cg` executable of 68,345,504 bytes
(about 65.2 MiB). The vendored parser source tree occupies 341,397,866 bytes
in this checkout (about 325.6 MiB) and increases checkout and build cost;
it adds no runtime parser package or service. These sizes are build artifacts
from this checkout, not limits on future builds.
