# codify — Agent Context

<!-- codify-owned: graph-agent-context v1 -->

_Generated graph context owned by `cg agentmd`. Regenerate with `cg agentmd --write` after significant changes. Workflow instructions remain owned by `cg spec render`._

## Languages

| Language | Files | Lines |
|---|---:|---:|
| c | 291 | 230098 |
| typescript | 80 | 625 |
| javascript | 75 | 47230 |
| python | 26 | 826 |
| go | 25 | 2710 |

497 source files, 281489 lines total.

## Directory map

- `kvx/` — 15 files, 2615 lines (mostly go)
- `src/` — 196 files, 221653 lines (mostly c)
- `editors/` — 55 files, 39665 lines (mostly javascript)
- `tests/` — 230 files, 17075 lines (mostly c)
- `scripts/` — 1 files, 481 lines (mostly python)

## Build & tooling

- `Makefile` — make

## Entry points

- function `main` — `scripts/format_changelog.py:410`
- function `main` — `src/main.c:119`
- function `main` — `src/main.c:350`
- function `main` — `src/main.c:325`
- function `main` — `src/main.c:328`
- function `main` — `src/main.c:144`
- function `main` — `tests/fixtures/codemap/src/main.c:6`
- function `main` — `tests/fixtures/codemap/src/main.c:6`
- function `main` — `tests/fixtures/codemap/src/main.c:6`
- function `main` — `tests/fixtures/codemap/src/main.c:6`
- function `main` — `tests/fixtures/codemap/src/main.c:6`
- function `main` — `tests/fixtures/codemap/tests/test_count.c:5`
- function `main` — `tests/fixtures/codemap/tests/test_count.c:5`
- function `main` — `tests/fixtures/codemap/tests/test_count.c:5`
- function `main` — `tests/fixtures/codemap/tests/test_count.c:5`

## HTTP routes

| Method | Pattern | Handler | Where |
|---|---|---|---|
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |

## Load-bearing symbols (most referenced)

- `sb_puts` (function, 6876 refs) — `src/util.c:49`
- `sb_printf` (function, 4439 refs) — `src/util.c:55`
- `sb_json_str` (function, 3451 refs) — `src/util.c:68`
- `sb_putc` (function, 2496 refs) — `src/util.c:48`
- `sb_free` (function, 2480 refs) — `src/util.c:42`
- `sb_init` (function, 2392 refs) — `src/util.c:41`
- `cg_prep` (function, 1375 refs) — `src/db.c:480`
- `ok` (macro, 1285 refs) — `tests/unit/tap.h:10`
- `xstrdup` (function, 1088 refs) — `src/util.c:34`
- `json_get_string` (function, 1070 refs) — `src/json.c:118`
- `push` (method, 875 refs) — `editors/vscode/agents.js:792`
- `one` (function, 814 refs) — `editors/vscode/language.js:35`
- `file` (function, 602 refs) — `editors/vscode/memories.js:438`
- `xmalloc` (function, 587 refs) — `src/util.c:24`
- `ok_str` (macro, 450 refs) — `tests/unit/tap.h:20`

## Querying this codebase

This project is indexed by Codify (SQLite + FTS5, 100% local). Prefer these over grep/file-walking — one call returns definitions, snippets, and call edges:

```bash
cg context <query>      # symbols + snippets + callers/callees + routes
cg search <text>        # instant name/full-text search
cg symbol <name>        # definition + snippet + reference count
cg impact <name> -d 3   # who breaks if this changes
cg routes [filter]      # URL pattern -> handler
cg changes              # impact radius of uncommitted edits
```

All of the above accept `--json`. The graph auto-syncs via `cg watch`, or connect over MCP with `cg mcp-install`.

When another process (an editor's indexer) holds the database, `cg remember`, `cg handoff`, and the bookkeeping behind `cg spec done` say **queued**: the write is kept in `.codegraph/journal/` and the next `cg` command applies it — do not re-run it. Exit 75 (a claim) means nothing changed: re-run the same command. `cg journal` lists what is queued.
