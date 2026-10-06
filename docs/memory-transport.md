# Memory transport

`cg memory export` and `cg memory import` move agent memories from one Codify
graph to another: from an old checkout to a new one, from one repository to
a sibling, or from a project you are retiring into the one that replaces it.
The file between them is a contract between graphs and between versions of
`cg`, and this page specifies it.

```sh
cg memory export -o decisions.jsonl --task codify-v12     # in the source
cg memory import decisions.jsonl --dry-run                # in the target
cg memory import decisions.jsonl
cg memory import --from ../old-checkout                   # graph to graph
```

## Commands

### `cg memory export [-o FILE] [--task T] [--type T] [--branch B] [--since DAYS]`

Writes the header line and one line per selected memory to stdout, or to
`FILE` with `-o` (`-o -` is stdout). With `-o`, a one-line report names the
count and the file (`--json`: `{"ok":true,"exported":N,"file":...}`).

| Filter | Selects |
|---|---|
| `--task T` | memories whose task is `T`, or starts with `T/` — so `--task codify-v12` takes every task of that feature, `--task codify-v12/1.1` one task |
| `--type T` | memories of that type, exactly |
| `--branch B` | memories that carry branch `B`, exactly. The name need not be a branch this graph tracks, and a memory with no branch (visible on every branch) is not selected |
| `--since DAYS` | memories created in the last `DAYS` days |

Rows are ordered by `created`, then by row id, and the header carries no
timestamp, so two exports of the same graph with the same filters are
byte-identical and can be committed and diffed.

Exit status: 0, or 1 when the file cannot be written.

### `cg memory import <FILE|-> [--dry-run] [--keep-branch] [--retask OLD=NEW]`
### `cg memory import --from DIR [...]`

Reads an export from `FILE`, from stdin with `-`, or — with `--from DIR` —
straight out of the Codify project that owns `DIR`. Every memory whose
content id the target does not hold is inserted; the ones it holds are
skipped. Then supersession links are restored. All of it is one
transaction.

| Flag | Effect |
|---|---|
| `--dry-run` | Prints the same report, with the same counts and line errors, and writes nothing |
| `--keep-branch` | Keep branch names the target does not track (see [Branches](#branches)) |
| `--retask OLD=NEW` | Rewrite a task-tag prefix on the way in (see [Retasking](#retasking)) |
| `--from DIR` | Read another project's graph instead of a file |
| `--json` | The report as one JSON object |

The report:

```text
memory import from alpha: 12 imported, 3 skipped (already present), 1 invalid, 2 supersessions relinked, 1 branch cleared
```

```json
{"ok":true,"dry_run":false,"project":"alpha","read":16,"imported":12,
 "skipped":3,"invalid":1,"relinked":2,"branches_cleared":1,
 "errors":[{"line":7,"reason":"bad JSON"}]}
```

`skipped` counts memories already in the target and repeats of the same
memory within the input. In text mode each invalid line is also printed on
stderr as `line N: reason`.

Exit status:

| Status | Meaning |
|---|---|
| 0 | The import ran (invalid lines are reported and skipped; they do not fail it) |
| 1 | Nothing was written: unreadable input, an unknown format, a newer version, an unusable `--retask`, `--from` naming no project or this project, or a write that failed and was rolled back |
| 75 | The database stayed busy past the lock wait; nothing was written, retry |

## The format

UTF-8 text, one JSON object per line (JSONL), `\n` line ends (a trailing `\r`
is tolerated on import). Blank lines are ignored.

### Header — the first non-blank line

```json
{"format":"codify-memories","version":1,"project":"alpha","cg_version":"1.1.0","count":3}
```

| Key | Type | Meaning |
|---|---|---|
| `format` | string | Always `codify-memories`. Anything else stops the import |
| `version` | integer | The format version, `1` here. A version newer than the importing `cg` reads stops the import |
| `project` | string | The name (directory basename) of the exporting project; recorded as provenance on import |
| `cg_version` | string | The `cg` that wrote the file. Informational |
| `count` | integer | The number of memory lines that follow. Informational |

Readers ignore header keys they do not know.

### Memory lines

Every exporter writes every key, in this order, with `null` for an absent
value:

```json
{"id":"8f1e…","created":1759700000,"type":"decision","task":"codify-v12/1.1","body":"Chose trigram FTS for symbol search","symbols":"cmd_search","files":"src/graph.c","source":"manual","branch":null,"class":"skill","confidence":0.85,"superseded_by":null,"superseded_at":null}
```

| Key | Type | Required on import | Meaning |
|---|---|---|---|
| `id` | string | no | The memory's content id in the exporting graph (below). Used to resolve `superseded_by` within the file; computed when absent |
| `created` | integer | no | Unix seconds when the memory was written. Kept as is; the import time when absent |
| `type` | string | **yes** | `decision`, `constraint`, `outcome`, `preference`, `fact`, `handoff`, … — any lowercase word of letters, digits, `_` or `-`, at most 32 bytes |
| `task` | string or null | no | The spec task tag, `feature/id` |
| `body` | string | **yes** | The note itself; never empty |
| `symbols` | string or null | no | Comma-separated symbol anchors |
| `files` | string or null | no | Comma-separated file anchors |
| `source` | string or null | no | How the memory was written: `manual`, `auto`, or an earlier import's provenance |
| `branch` | string or null | no | The branch the decision was made on; null means every branch sees it |
| `class` | string or null | no | Jev's verdict (`skill`, `decision`, `constraint`, `fact`, `noise`), null when unclassified |
| `confidence` | number or null | no | Jev's confidence in `class`; kept only with a class |
| `superseded_by` | string or null | no | The content id of the memory that replaced this one |
| `superseded_at` | integer or null | no | Unix seconds when it was replaced |

Readers ignore keys they do not know, so a version-1 file may grow keys
without breaking an older reader; a change an older reader would
misunderstand bumps `version`.

### Content id

```text
id = lowercase hex SHA-256 of  type 0x1F task 0x1F body
```

`type`, `task`, and `body` as UTF-8 bytes, joined by the single byte `0x1F`
(unit separator), with a null task written as the empty string. No trailing
separator, no newline. For example the decision `Use WAL` with no task is
`sha256("decision\x1f\x1fUse WAL")`.

This is exactly what `cg memory compact` treats as one memory — same type,
same task (null and empty alike), same body — so the same note has the same
id in every graph, whatever its row id, time, anchors, branch, or class.
`type` is a plain word and a task tag never holds `0x1F` (an import refuses
a task that does), so no two different triples join to the same bytes.

Because the id covers only those three fields, an import never updates a
memory the target already holds: a different class, anchors, or branch on
the incoming copy does not overwrite the target's.

## Import rules

**Validation before the write.** The header is read first; an unknown
`format`, a `version` newer than the reader's, a missing header, or empty
input stops the import with exit 1 before the transaction opens. Each
memory line is then checked on its own: a line that is not one complete JSON
object (`bad JSON`), has no `body` (`missing body`), no `type`
(`missing type`), or a type that is not a lowercase word (`unknown type`),
or a text field that is not a string, is reported as `line N: reason` —
`N` counting every line of the input, header included, from 1 — counted as
invalid, and skipped. The rest still imports.

**One transaction.** Inserts, the full-text index, supersession links, and
the event all commit together. A failure part-way rolls everything back
and the report says so.

**Deduplication.** The content id is computed for every memory in the
target and for every incoming memory after `--retask`. A match is skipped;
the target's row stays as it is. Two identical memories in one file import
once.

**Kept as written.** `created`, `type`, `task`, `body`, `symbols`, `files`,
`class`, and `confidence` are stored as they arrive. `cg recall` in the
target returns the same values the source did.

**Provenance.** `source` becomes `import:<project>/<original source>` —
`import:alpha/manual`, `import:alpha/auto` — so where a memory came from and
how it was first written both survive. A source that already starts with
`import:` is kept as it is: provenance names the project where the memory
was first written, not every graph it passed through.

**Supersession.** A memory whose `superseded_by` names another memory is
linked to it when both ends are in the target after the import: rows that
were already there, rows arriving in the same file, in any line order, or a
row an earlier import brought — import the file again once the other end
has arrived and the link is made. The link keeps `superseded_at`. A link the
target already holds for that memory is the target's own decision and is
left alone. `relinked` counts the links made.

**Full-text index.** Every inserted memory enters `memory_fts` in the same
transaction, so `cg recall <word>` finds it at once.

**Events.** An import that changes anything writes one `memory.import`
event (`{"project","imported","skipped","invalid","relinked"}`) in place of
the per-row `memory.add` events, which never become visible.

### Branches

A memory's `branch` decides which branches see it. When the incoming branch
is one the target graph tracks (`cg branches`), it is kept. When the target
does not track it, the branch is cleared — `null`, visible on every branch —
because a name nothing in the target carries would hide the memory from
every recall. `--keep-branch` keeps such names anyway, for a graph that will
index that branch later. The report counts `branches_cleared`.

### Retasking

`--retask OLD=NEW` replaces the prefix `OLD` of each incoming task with
`NEW`, on a tag boundary: `--retask codify-v12=codify-v13` turns
`codify-v12/1.1` into `codify-v13/1.1` and `codify-v12` into `codify-v13`,
but leaves `codify-v120/1.1` alone (an `OLD` ending in `/` matches as a plain
prefix). The content id is computed on the rewritten task, so a retasked
memory is new to a target that holds the original. `OLD` must not be
empty; `OLD=` with an empty `NEW` clears a whole-tag match.

### `--from DIR`

`DIR` is resolved the way `cg` finds a project — upward to the directory
holding `.codegraph`, or, for a linked git worktree, to the main worktree
whose graph it shares. That graph is opened with `SQLITE_OPEN_READONLY`:
no schema upgrade, no triggers, nothing but `SELECT`. (A read-only SQLite
reader of a WAL database may leave empty `-wal`/`-shm` companion files; it
never writes a page.) An older graph whose `memories` table predates
`class`, `confidence`, or `branch`, or that has no `memory_superseded`
table, imports what it has, with those values null.

The memories read are exported in memory, exactly as `cg memory export`
would write them with no filters, and then imported through the same path
as a file. Naming the target's own project — directly, through a
subdirectory, or through one of its worktrees — is refused.

## MCP

`memory_export` and `memory_import` run the same code paths.

| Tool | Arguments | Returns |
|---|---|---|
| `memory_export` | `task`, `type`, `branch`, `since` (days), `path` | The export text, or with `path` the `--json` write report |
| `memory_import` | one of `path` (a file), `data` (the export text itself), `from` (a project directory); `dry_run`, `keep_branch`, `retask` | The `--json` report |

`path: "-"` is refused over MCP: the server's stdin is its request stream.
A refusal (unknown format, newer version, …) comes back as an error result
carrying the same message the CLI prints.
