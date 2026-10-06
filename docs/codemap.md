# The code map

`cg codemap` writes `CODEMAP.md` at the repository root: the file to read
first in a repository you have never seen. It says what the project is and
how to build and test it, then where things live, where execution starts,
which modules and symbols the rest of the code leans on, how the top-level
directories depend on each other, where the tests are, and where the
workflow and agent instructions live.

Implemented in `src/codemap.c`; covered by
`tests/integration/38_codemap.sh` with the fixture in
`tests/fixtures/codemap/`.

## Usage

```bash
cg codemap                       # refresh the graph, write CODEMAP.md
cg codemap -o docs/MAP.md        # somewhere else (relative to the current directory)
cg codemap -o -                  # print it
cg codemap --json                # the same map as structured data, on stdout
cg codemap --budget 3000         # fit it to 3000 tokens (default 8000)
cg codemap --check               # compare only: exit 1 if missing or stale
cg codemap --force               # replace a CODEMAP.md that cg did not write
```

| Exit | Meaning |
|---|---|
| 0 | written, unchanged, or (`--check`) current |
| 1 | `--check`: missing or different; refusing to overwrite a file without the marker; a write error |
| 2 | usage: `--json` with `-o FILE`, `--check` with `--json` or `-o -`, a budget under 300 tokens, or a budget too small for the map's headings |

## What is in it

Seven sections, always in this order:

1. **Overview**: the project name (the README's first heading, else the
   `package.json`, `Cargo.toml`, `pyproject.toml` or `go.mod` name, else the
   directory name), the README's first sentence, languages with file and
   line counts (test fixtures not counted), and build and test commands
   from the manifests found: Makefile targets in file order, `package.json`
   scripts, go, cargo, python, CMake, Maven, Gradle, Rake.
2. **Layout**: each top-level directory and its subdirectories with file
   and line counts, main language, a tests or fixtures tag, and a purpose
   line taken from the directory's README or from the comment of the file
   that stands for it (`index.ts`, `__init__.py`, `mod.rs`, `doc.go`,
   `<dir>.go`, ...). A directory with more than eight subdirectories lists
   them by name. Hidden directories share one line.
3. **Entry points**: `main` functions, the subcommands a main dispatches on
   (`strcmp(cmd, "x")` in C, `case "x"` over `os.Args` in Go,
   `.command("x")` in JS/TS, `add_parser("x")` in Python), `package.json`
   `main` and `bin`, and HTTP routes.
4. **Modules**: product source grouped by directory (two levels deep),
   most referenced first. Each module lists its key files, ranked by the
   calls and imports they receive, with each file's own comment as its
   purpose. Then come its most-referenced symbols with their signatures.
5. **Dependencies**: edges between top-level directories, counted from
   resolved imports and resolved calls.
6. **Tests**: the test commands, how many product functions the tests call
   directly, each test directory with the source directories it calls into,
   each test file with its leading comment (shell scripts included), and
   fixture roots.
7. **Workflow and agent files**: `spec/workflow.kvx` and the active
   feature's `spec.kvx`, `AGENTS.md`, `CLAUDE.md`, `GEMINI.md`, Copilot,
   Cursor and Windsurf rules, `CONTRIBUTING.md`, `.codify/agent-context.md`,
   and skill directories, but only those the graph indexed. Then the root
   and `docs/` markdown files by title.

Nothing in the map is written by a model, and nothing is invented. Where a
file or directory has no comment or README of its own, the map gives it no
purpose line. Legal headers (copyright, SPDX, license) never count as a
purpose.

## Determinism

The same graph and tree render the same bytes. The map has no timestamps,
no durations, no absolute paths, and every list has a total order. The map
never counts itself: `CODEMAP.md` and the `-o` path are excluded from every
count and listing even after the indexer picks them up. So
`cg codemap && cg codemap --check` exits 0, and a second `cg codemap`
reports the file unchanged and does not rewrite it.

## Budget

`--budget N` is in tokens at about 4 bytes per token, default 8000. Per-section
caps keep the map an overview (24 modules, 40 key files and 12 symbols per
module, 30 dependency edges, 25 routes, 40 files per test directory). Past
those caps, the budget drops whole entries in a fixed order until the
markdown fits:

1. the least-referenced files, symbols, test files, dependency edges and docs;
2. then subdirectories, test directories and routes;
3. then top-level directories, mains, the command list and workflow pointers;
4. then overview rows.

Within a step, fewer references go first and the later entry goes first
on a tie. Every section ends with a `_Not shown: ..._` line counting what it
left out, and each module says how many files and symbols it holds beyond
those shown, with the `cg survey` command that lists them. The budget is
recorded in the marker line, so `--check` and `cg brief` compare at the
budget the map was written with.

## Ownership

The first line is the marker:

```
<!-- codify-owned: codemap v1 budget=8000 — GENERATED by `cg codemap` from the code graph. Do not edit: run `cg codemap` to regenerate. -->
```

A `CODEMAP.md` that does not start with it belongs to someone else.
`cg codemap` refuses to overwrite it (exit 1) unless `--force` is given.
The default path is `[paths] codemap` in `codify.kvx` when it is set
(see [config.md](config.md)), else `CODEMAP.md` at the root; a directory the
setting names is created on the first write. It is decided in one place,
`codemap_default_path()`.

## Staleness in `cg brief`

When the map exists, `cg brief` adds one line: `codemap: CODEMAP.md
(current)`, `(stale — run cg codemap)`, or `(not generated by cg codemap)`.
In `--json` this is a `codemap` object with `path`, `generated` and `stale`.
Brief does not refresh the graph, so "current" means current against the
graph as last indexed.

Staleness is a full render compared byte for byte with the file. There is
no stored digest. The render costs about 50–80 ms on Codify itself (250
files, 21k references) and about 200 ms on a synthetic 5,000-file tree. A
digest would also miss what the render reads from the tree itself (README
prose, manifests, Makefile targets). The compare can never disagree with
`--check`.

## JSON

`--json` emits the entries the markdown keeps, with keys in a fixed order:
`format` (`"codemap"`), `version`, `name`, `description`, `budget`,
`tokens`, `overview`, `layout`, `entry_points`, `modules`, `dependencies`,
`tests`, `workflow`. Each section carries an `omitted` count.

## MCP

The `codemap` tool (read-only) returns the map text, or the JSON with
`"json": true`. It takes an optional `budget` and writes nothing.
