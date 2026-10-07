# Project configuration — codify.kvx

You can put an optional `codify.kvx` at the root of a repository to change
where Codify keeps its files, whether it syncs the graph on its own, and how
many parse workers an index pass uses. Every
key in the file is optional. If the file or a key is missing, Codify uses the
default, so a repository without the file works exactly as it did before the
file existed.

The implementation is in `src/config.c`. Tests are in
`tests/unit/test_config.c` and `tests/integration/40_config.sh`.

## The file

`cg config init` writes the following file. It refuses to overwrite an
existing one.

```
# codify.kvx — project configuration for Codify. Every key is optional.
[sync]
auto = true                 # implicit syncs: hooks, read-command freshness, MCP/LSP/serve/watch

[paths]
spec    = "spec"            # workflow.kvx, feature specs, rendered mirrors
context = ".codify"         # agent-context.md, recap.md
skills  = ".agents/skills"  # generated SKILL.md files
codemap = "CODEMAP.md"      # written by cg codemap

[index]
# workers = auto            # parse workers per index pass: 1-64; auto sizes from the machine
```

| Key | Default | Controls |
|---|---|---|
| `sync.auto` | `true` | Whether Codify syncs the graph without being asked. Accepts `true/yes/on/1` and `false/no/off/0`. |
| `paths.spec` | `spec` | The directory holding `workflow.kvx`, every `<feature>/spec.kvx`, and the rendered mirrors. |
| `paths.context` | `.codify` | Where `agent-context.md` (`cg agentmd --write`, `cg integrate`) and `recap.md` (`cg recap`) are written. |
| `paths.skills` | `.agents/skills` | The directory for generated `SKILL.md` files (`cg skills`, and the `codify-workflow` skill from `cg integrate`). |
| `paths.codemap` | `CODEMAP.md` | The file `cg codemap` writes. |
| `index.workers` | `auto` | Parse workers per index pass for `cg init`, `cg index` and `cg sync`: `1` to `64`, or `auto` (also `0`) for the machine's choice. See [[index] workers](#index-workers). |

The file is read once per process for each root, and the result is cached.
It belongs to the tree it sits in, so it travels with the branch in the same
way `spec/` does. A linked worktree reads its own copy.

## Paths

All paths are relative to the repository root. Codify normalizes them, so
`./planning//specs/` becomes `planning/specs`. It rejects a value that:

- is absolute, or starts with `~`;
- climbs out of the repository with `..`. A `..` that stays inside is allowed:
  `a/../plan` becomes `plan`;
- is empty, or normalizes to the root itself (`.`);
- contains a backslash;
- starts inside `.git/` or `.codegraph/`.

When a value is rejected, Codify prints one line on stderr naming the key and
the file, and uses the default for that key. The command still runs.

### What a relocated spec directory changes

Setting `paths.spec` moves the whole spec workflow to the new directory. Every
part of Codify that reads or writes spec files follows it:

- the spec engine (`cg spec …`);
- the orchestrator (`cg spec run`), the fleet, docs, drift, guard, recap and
  events;
- the MCP `spec/...` resources;
- root discovery. `cg spec` finds the root from any subdirectory, including
  one inside the relocated spec directory.

The files that `cg spec render` and `cg spec new` produce name the configured
directory. For example, CLAUDE.md says ``edit `planning/specs/workflow.kvx` ``.

The hook shims under `.codify/hooks/` stay where they are, because host
configurations refer to those paths. `paths.context` moves only
`agent-context.md` and `recap.md`.

## [sync] auto = false

By default Codify keeps the graph fresh on its own. Setting `auto = false`
stops every implicit sync:

| Implicit sync | With `auto = false` |
|---|---|
| Freshness check before `cg review`, `cg agentmd` and `cg resume --prompt` | skipped; reads the graph as it is |
| `cg hook post-edit` (Claude Code PostToolUse) | the guard still runs; the sync is skipped |
| pre-commit index in `cg commit` | skipped; the snapshot still reads the files on disk |
| git post-commit hook (`cg sync --background --auto`) | skipped |
| MCP tools that sync first; `cg serve`, which runs them | skipped |
| LSP refresh on save | skipped |
| `cg watch` | exits with a message instead of watching |
| fleet watch | skips worktrees whose config turns auto-sync off |
| `cg integrate` agent-context refresh | skipped |
| VS Code panel refresh | skipped (the extension asks `cg config get sync.auto`) |

`cg sync`, `cg index` and `cg init` always run, because you asked for them.
`cg sync --auto` marks a sync as implicit: it does nothing when auto-sync is
off. The installed git hook uses it.

`cg spec done`, `cg spec implemented` and `cg spec trace` still sync before
they qualify a task. Evidence has to reflect the tree as it is, and
`spec trace --no-sync` already lets you skip that sync on purpose.

`cg brief` warns when auto-sync is off so that an agent knows the graph may be
stale. The text output adds a `sync:` line and the JSON output adds
`"auto_sync": false`.

## [index] workers

By default an index pass sizes its parse workers from the machine: the
effective cores, at most 16, fewer when memory is short (`cg info` shows the
result). `[index] workers = N` replaces that choice with N, from 1 to 64 — more
than the machine profile would pick on a big machine, fewer on one you share
with a build:

```
[index]
workers = 24
```

Where several sources name a count, the first one present wins:

1. `--workers N` on `cg index` or `cg sync` (`cg info --workers N` shows what
   it would resolve to);
2. the `CG_INDEX_WORKERS` environment variable;
3. `[index] workers` in `codify.kvx`;
4. the machine profile.

`auto` or `0` in any of them means "not set here" and defers to the next.
The count then still yields to each pass's own bounds: never more workers
than files to parse, two when no machine-wide parse slot is free, and a
background pass (`cg sync --background`, hooks, watchers) takes a quarter of
an asked-for count, at least one, in place of a quarter of the cores.
[docs/sync.md](sync.md) has the full order.

`cg info` prints the count and where it came from, for example
`sized pipeline: 24 workers (codify.kvx), …`; `cg info --json` carries
`"workers"`, `"workers_origin"` (`flag`, `CG_INDEX_WORKERS`, `codify.kvx` or
`machine`) and `"machine_workers"`. The index summary's `[N workers]` and
`cg sync --json`'s `"workers"` report what a pass actually used.

A value that is not a whole number from 0 to 64 (`65`, `-1`, `2.5`, `many`)
is a bad value like any other: one stderr line names the key and the file,
the machine's choice stands in, `cg config check` lists it and exits 1, and
`cg check` warns. A bad `--workers` on the command line is an error instead
(exit 1): you typed it just now. A count above this machine's effective
cores is allowed — the file travels to bigger machines — but `cg config
check` prints a `warning:` line for it (and a `"warnings"` entry in `--json`)
without failing.

`cg config set index.workers 8` writes `workers = 8`; `cg config set
index.workers auto` writes `workers = "auto"`. In `cg config --json` a count
is a number and `auto` is the string `"auto"`.

## cg config

`cg config` works before `cg init`, in a repository that has only a spec
directory, and in a directory with no project at all.

| Command | Does |
|---|---|
| `cg config [--json]` | Lists every setting with its value and origin (`codify.kvx` or `default`). |
| `cg config init` | Writes the commented defaults shown above. Refuses if the file exists. |
| `cg config get <key> [--json]` | Prints one value, for example `cg config get paths.spec`. |
| `cg config set <key> <value>` | Validates the value, then rewrites that one line and keeps comments and every other line. Creates the file if it is absent. Writes nothing if the value is invalid. |
| `cg config check [--json]` | Lists parse errors, unknown sections, unknown keys and bad values. Exits 1 when it finds any. Warns, without failing, when `[index] workers` exceeds this machine's effective cores. |

`cg config --json`:

```json
{"root":"…","file":"…/codify.kvx","present":true,
 "settings":[{"key":"paths.spec","value":"planning/specs","default":"spec","origin":"codify.kvx"}, …],
 "problems":0}
```

`cg config check --json`:

```json
{"file":"…/codify.kvx","present":true,"ok":false,
 "problems":[{"kind":"unknown_key","section":"sync","key":"debounce","message":"…"}],
 "warnings":[]}
```

## Problems never stop a command

Unknown sections and keys are ignored, and Codify does not mention them
unprompted. A bad value falls back to its default and gets one stderr line per
process. Neither stops a command.

`cg check` reports any problems as a warning:

```
  warn  N codify.kvx problem(s) — defaults used (cg config check):
```

This adds to the warning count and never to the failure count. The `--json`
output carries `"config_problems": N` when the file exists. A valid file
reports `ok    codify.kvx is valid`.
