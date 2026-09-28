# codify — Agent Context

<!-- codify-owned: graph-agent-context v1 -->

_Generated graph context owned by `cg agentmd`. Regenerate with `cg agentmd --write` after significant changes. Workflow instructions remain owned by `cg spec render`._

## Languages

| Language | Files | Lines |
|---|---:|---:|
| c | 419 | 326113 |
| typescript | 154 | 1210 |
| javascript | 138 | 72804 |
| go | 55 | 5962 |
| python | 22 | 429 |

788 source files, 406518 lines total.

## Directory map

- `kvx/` — 33 files, 5753 lines (mostly go)
- `src/` — 330 files, 314992 lines (mostly c)
- `editors/` — 94 files, 57459 lines (mostly javascript)
- `tests/` — 331 files, 28314 lines (mostly typescript)

## Build & tooling

- `Makefile` — make

## Entry points

- function `main` — `src/main.c:252`
- function `main` — `src/main.c:261`
- function `main` — `src/main.c:252`
- function `main` — `src/main.c:252`
- function `main` — `src/main.c:252`
- function `main` — `src/main.c:254`
- function `main` — `src/main.c:263`
- function `main` — `src/main.c:263`
- function `main` — `src/main.c:261`
- function `main` — `src/main.c:263`
- function `main` — `src/main.c:298`
- function `main` — `tests/fixtures/sample/main.go:9`
- function `main` — `tests/fixtures/sample/main.go:9`
- function `main` — `tests/fixtures/sample/main.go:9`
- function `main` — `tests/fixtures/sample/main.go:9`

## HTTP routes

| Method | Pattern | Handler | Where |
|---|---|---|---|
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
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
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |

## Load-bearing symbols (most referenced)

- `sb_puts` (function, 10441 refs) — `src/util.c:48`
- `sb_printf` (function, 6109 refs) — `src/util.c:54`
- `sb_json_str` (function, 5263 refs) — `src/util.c:67`
- `sb_putc` (function, 3787 refs) — `src/util.c:47`
- `sb_free` (function, 3259 refs) — `src/util.c:41`
- `sb_init` (function, 3156 refs) — `src/util.c:40`
- `cg_prep` (function, 2325 refs) — `src/db.c:425`
- `ok` (macro, 1851 refs) — `tests/unit/tap.h:10`
- `xstrdup` (function, 1719 refs) — `src/util.c:33`
- `json_get_string` (function, 1265 refs) — `src/json.c:106`
- `push` (method, 1048 refs) — `editors/vscode/agents.js:792`
- `one` (function, 1025 refs) — `editors/vscode/language.js:35`
- `xmalloc` (function, 922 refs) — `src/util.c:23`
- `file` (function, 822 refs) — `editors/vscode/memories.js:435`
- `read_entire_file` (function, 701 refs) — `src/util.c:117`

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
