# Architecture

One binary (`cg`), one SQLite database (`.codegraph/graph.db`), no
dependencies beyond libsqlite3. C11 + POSIX. Every module is a single
`.c` file; `src/cg.h` is the only header.

## Data flow

```
        walk (ignore rules)            pthread workers            single writer
files ───────────────────────► jobs ──────────────────► parsed ───────────────► SQLite
                                        (regex-based                 (one
                                         language specs)              transaction)
```

- **`sysinfo.c`** sizes the pipeline before anything runs: effective cores =
  min(online, affinity mask, cgroup v1/v2 CPU quota); honest memory =
  `MemAvailable` ∩ cgroup limits. Workers, SQLite page cache, and mmap
  budgets derive from that, so the same binary behaves sanely on a
  16-core workstation and a 512 MB container.
- **`scan.c`** walks the tree, diffs (mtime, size) against the `files`
  table, fans changed files out to a worker pool through a bounded ring
  buffer, and writes results back on the main thread in one transaction.
- **`lang.c` / `routes.c`** are table-driven: a language is a comment/string
  spec plus POSIX ERE definition patterns; a framework route is one regex
  row. Adding a language or framework is adding a table entry.
- **`db.c`** owns the schema: `files`, `symbols`, `refs`, `routes`, `meta`,
  `memories`, plus three FTS5 tables — trigram over symbol names
  (substring search), unicode61 over file bodies (word search), and
  unicode61 over memory bodies.
- **`graph.c`** implements the query commands (`search`, `symbol`,
  `impact`, `context`, `routes`) with `--json` variants.

## Version control (`vcs.c`, `sha256.c`)

Content-addressed snapshots: blobs and commit objects under
`.codegraph/objects/<aa>/<hash>`, a manifest per commit (sorted
`hash size\tpath` lines), `HEAD` pointing at the last commit. Diffs are
LCS at line level. `cg changes` joins the working-tree diff against the
graph to list touched symbols and their external callers. `cg commit`
tags its message with the in-progress spec task when one exists.

## Watcher (`watch.c`)

Recursive inotify with dynamic directory registration and a debounce
loop; each quiet period triggers an incremental index. Non-Linux
platforms stub out behind the same interface.

## Agent surface (`mcp.c`, `agent.c`, `json.c`)

`cg mcp` is a newline-delimited JSON-RPC 2.0 stdio server exposing 17
tools. CLI command output is captured via `dup2` + tmpfile
(`cg_capture`), so the CLI and MCP surfaces share one implementation.
`json.c` is a minimal scanner (no DOM) used for JSON-RPC parsing and
`package.json` introspection. `cg mcp-install` splices the server into
agent configs without a full JSON parser by inserting after the root
key's opening brace.

## Spec engine (`kvx.c`, `spec.c`)

`kvx.c` parses the Ion `.kvx` format (ordered sections, `key = "value"`,
`${ENV}` interpolation) and can surgically rewrite a single `status`
line, preserving every other byte. `spec.c` renders IDE pointer files
and the markdown mirror byte-identically to the original Go `specgen`
(locked in by golden fixtures under `tests/fixtures/specrepo/`), and
drives the task loop: wave-ordered `next`, one-in-progress `start`,
`verify_cmd`-gated `done`. When the repo also has a `.codegraph/`, `done`
additionally checks the task's declared `symbols` against the graph and
its `touches` globs against worktree changes plus commits tagged with
the task, and `cg spec trace` walks task → symbols → commits.

## Agent memory (`memory.c`)

Deliberate notes (`decision`/`constraint`/`outcome`/`preference`/`fact`)
in the `memories` table of graph.db, linked to spec tasks by
`feature/id`. `cg remember` defaults its task link to the in-progress
one; `cg spec done` records terse outcome memories automatically —
refusals included — via a quiet no-reindex open, so the spec engine
still works without a graph. Retrieval (`cg recall`, MCP `recall`) is
FTS5 over the body: free text becomes OR'd quoted prefix terms ranked by
bm25, recency breaking ties. `spec next`/`start` surface task-linked and
title-matched memories; `trace` appends the task's memories to its
chain.

## Tests

- `tests/unit/` — standalone binaries linked against `build/libcg.a`
  (everything except `main.o`): kvx grammar, SHA-256 vectors, JSON
  scanner, StrBuf/file IO.
- `tests/integration/` — shell scripts driving the real binary in
  temp sandboxes: graph queries, VCS flows, changelog/agentmd/
  mcp-install, the MCP protocol, the spec engine against Go-generated
  goldens, graph-verified completion + trace, agent memory, and the
  inotify watcher.
