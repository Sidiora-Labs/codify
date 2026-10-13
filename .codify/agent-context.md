# codify — Agent Context

<!-- codify-owned: graph-agent-context v1 -->

_Generated graph context owned by `cg agentmd`. Regenerate with `cg agentmd --write` after significant changes. Workflow instructions remain owned by `cg spec render`._

## Languages

| Language | Files | Lines |
|---|---:|---:|
| c | 67 | 60193 |
| typescript | 16 | 125 |
| javascript | 15 | 10064 |
| python | 7 | 783 |
| go | 5 | 542 |

110 source files, 71707 lines total.

## Directory map

- `kvx/` — 3 files, 523 lines (mostly go)
- `scripts/` — 1 files, 481 lines (mostly python)
- `editors/` — 11 files, 8551 lines (mostly javascript)
- `src/` — 48 files, 58430 lines (mostly c)
- `tests/` — 47 files, 3722 lines (mostly c)

## Build & tooling

- `Makefile` — make

## Entry points

- function `main` — `scripts/format_changelog.py:410`
- function `main` — `src/main.c:155`
- function `main` — `tests/fixtures/codemap/src/main.c:6`
- function `main` — `tests/fixtures/codemap/tests/test_count.c:5`
- function `main` — `tests/fixtures/explore/proj/src/main.c:6`
- function `main` — `tests/fixtures/sample/main.go:9`
- function `main` — `tests/scale/gen.py:190`
- function `main` — `tests/unit/test_config.c:37`
- function `main` — `tests/unit/test_drivers.c:45`
- function `main` — `tests/unit/test_json.c:5`
- function `main` — `tests/unit/test_kvx.c:251`
- function `main` — `tests/unit/test_lang.c:58`
- function `main` — `tests/unit/test_sha256.c:11`
- function `main` — `tests/unit/test_util.c:6`

## HTTP routes

| Method | Pattern | Handler | Where |
|---|---|---|---|
| GET | `/api/tasks` | `handle` | `tests/fixtures/anchors/server.ts:12` |
| GET | `/users` | `getUsers` | `tests/fixtures/sample/src/server.ts:21` |
| POST | `/users` | `createUser` | `tests/fixtures/sample/src/server.ts:22` |

## Load-bearing symbols (most referenced)

- `sb_puts` (function, 1699 refs) — `src/util.c:49`
- `sb_printf` (function, 1131 refs) — `src/util.c:55`
- `sb_json_str` (function, 843 refs) — `src/util.c:68`
- `sb_free` (function, 689 refs) — `src/util.c:42`
- `sb_init` (function, 662 refs) — `src/util.c:41`
- `sb_putc` (function, 619 refs) — `src/util.c:48`
- `cg_prep` (function, 345 refs) — `src/db.c:688`
- `ok` (function, 286 refs) — `tests/fixtures/acp/panel-test.js:14`
- `json_get_string` (function, 278 refs) — `src/json.c:118`
- `xstrdup` (function, 275 refs) — `src/util.c:34`
- `one` (function, 224 refs) — `editors/vscode/language.js:35`
- `push` (method, 193 refs) — `editors/vscode/agents.js:792`
- `file` (function, 146 refs) — `editors/vscode/memories.js:438`
- `xmalloc` (function, 145 refs) — `src/util.c:24`
- `branch` (function, 128 refs) — `editors/vscode/fleet.js:377`

## Querying this codebase

This project is indexed by Codify (SQLite + FTS5, 100% local). Prefer these over grep/file-walking — one call returns definitions, snippets, and call edges:

```bash
cg context <query>      # symbols + snippets + callers/callees + routes
cg search <text>        # instant name/full-text search
cg grep <pattern> [-i]  # line search, each hit in its symbol
cg files <glob|words>   # find files; --dirs maps directories
cg symbol <name>        # definition + snippet + reference count
cg impact <name> -d 3   # who breaks if this changes
cg routes [filter]      # URL pattern -> handler
cg changes              # impact radius of uncommitted edits
```

All of the above accept `--json`. The graph auto-syncs via `cg watch`, or connect over MCP with `cg mcp-install`.

Over MCP, use `grep_code`, `find_files`, `search_code`, and `get_context` before any shell search: `cg grep` and `cg files` answer what grep, rg, and find would, ranked and capped to a token budget.

When another process (an editor's indexer) holds the database, `cg remember`, `cg handoff`, and the bookkeeping behind `cg spec done` say **queued**: the write is kept in `.codegraph/journal/` and the next `cg` command applies it — do not re-run it. Exit 75 (a claim) means nothing changed: re-run the same command. `cg journal` lists what is queued.
