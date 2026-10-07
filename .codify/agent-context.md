# codify — Agent Context

<!-- codify-owned: graph-agent-context v1 -->

_Generated graph context owned by `cg agentmd`. Regenerate with `cg agentmd --write` after significant changes. Workflow instructions remain owned by `cg spec render`._

## Languages

| Language | Files | Lines |
| --- | ---: | ---: |
| c | 57 | 44727 |
| typescript | 16 | 125 |
| javascript | 15 | 9446 |
| python | 5 | 69 |
| go | 5 | 542 |

98 source files, 54909 lines total.

## Directory map

- `kvx/` — 3 files, 523 lines (mostly go)
- `src/` — 38 files, 43060 lines (mostly c)
- `editors/` — 11 files, 7933 lines (mostly javascript)
- `tests/` — 46 files, 3393 lines (mostly c)

## Build & tooling

- `Makefile` — make

## Entry points

- function `main` — `src/main.c:325`
- function `main` — `tests/fixtures/codemap/src/main.c:6`
- function `main` — `tests/fixtures/codemap/tests/test_count.c:5`
- function `main` — `tests/fixtures/explore/proj/src/main.c:6`
- function `main` — `tests/fixtures/sample/main.go:9`
- function `main` — `tests/unit/test_config.c:37`
- function `main` — `tests/unit/test_drivers.c:45`
- function `main` — `tests/unit/test_json.c:5`
- function `main` — `tests/unit/test_kvx.c:251`
- function `main` — `tests/unit/test_lang.c:58`
- function `main` — `tests/unit/test_sha256.c:11`
- function `main` — `tests/unit/test_util.c:6`

## HTTP routes

| Method | Pattern | Handler | Where |
| --- | --- | --- | --- |
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |

## Load-bearing symbols (most referenced)

- `sb_puts` (function, 1335 refs) — `src/util.c:49`
- `sb_printf` (function, 878 refs) — `src/util.c:55`
- `sb_json_str` (function, 666 refs) — `src/util.c:68`
- `sb_putc` (function, 491 refs) — `src/util.c:48`
- `sb_free` (function, 487 refs) — `src/util.c:42`
- `sb_init` (function, 471 refs) — `src/util.c:41`
- `cg_prep` (function, 274 refs) — `src/db.c:480`
- `ok` (macro, 249 refs) — `tests/unit/tap.h:10`
- `xstrdup` (function, 217 refs) — `src/util.c:34`
- `json_get_string` (function, 199 refs) — `src/json.c:118`
- `push` (method, 175 refs) — `editors/vscode/agents.js:792`
- `one` (function, 146 refs) — `editors/vscode/language.js:35`
- `xmalloc` (function, 118 refs) — `src/util.c:24`
- `file` (function, 112 refs) — `editors/vscode/memories.js:438`
- `ok_str` (macro, 90 refs) — `tests/unit/tap.h:20`

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
