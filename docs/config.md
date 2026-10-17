# Project configuration — hyperfide.kvx

You can put an optional `hyperfide.kvx` at the root of a repository to change
where Hyperfide keeps its files, whether it syncs the graph on its own, how
many parse workers an index pass uses, how a pass finds changed files, and how
the projection, fleet discovery and the Bash hook behave. Every key in the
file is optional. If the file or a key is missing, Hyperfide uses the
default, so a repository without the file works exactly as it did before the
file existed.

The implementation is in `src/config.c`. Tests are in
`tests/unit/test_config.c` and `tests/integration/40_config.sh`.

Examples use `hyperfide`; `cg` is the deprecated compatibility alias of the
same executable, with identical arguments, JSON and exit codes.

## Which file is read

The binary looks for two names at the root of the tree:

| Present | Read | Notes |
|---|---|---|
| neither | — | every setting is the default; `hyperfide config init` and `hyperfide config set` create `hyperfide.kvx` |
| `hyperfide.kvx` only | `hyperfide.kvx` | the canonical name |
| `codify.kvx` only | `codify.kvx` | the legacy name, read unchanged |
| both | `hyperfide.kvx`, only when `.hyperfide/names.json` records a completed names migration | otherwise every command that loads the configuration prints `hyperfide: both hyperfide.kvx and codify.kvx exist without a matching completed names migration; resolve the configuration conflict explicitly` and exits 2 |

A completed migration is a `.hyperfide/names.json` with `schema_version` 1,
`state` `APPLIED`, a `migration_id` and `manifest_digest`, and a mapping from
`codify.kvx` to `hyperfide.kvx` whose `digest` matches the current bytes of
`codify.kvx`. The names migration in `services/hyperfide/src/migration/names.ts`
writes that record; the rename task (26.3 in `spec/hyperfide/spec.kvx`) is
still pending there, so treat the migration as not qualified in this revision.

Every message, origin column and `hyperfide check` line names the file that
was actually read, so a tree still on `codify.kvx` is told about `codify.kvx`.
The rest of this page says `hyperfide.kvx`; read it as `codify.kvx` in a tree
that still uses the legacy name.

## The file

`hyperfide config init` writes the following file. It refuses to overwrite an
existing one (exit 1).

```
# hyperfide.kvx — project configuration for Hyperfide. Every key is optional.
[sync]
auto = true                 # implicit syncs: hooks, read-command freshness, MCP/LSP/serve/watch

[paths]
spec    = "spec"            # workflow.kvx, feature specs, rendered mirrors
context = ".hyperfide/context"         # agent-context.md, recap.md
skills  = ".agents/skills"  # generated SKILL.md files
codemap = "CODEMAP.md"      # written by cg codemap

[index]
# workers = auto            # parse workers per index pass: 1-64; auto sizes from the machine
# walk = auto               # how sync finds changes: git (status + diff since the last pass), full (walk the tree), auto (git above 20000 files)

[projection]
# base    = "main"          # branch the projection folds onto; default [hierarchy] main, else main
# stale   = "24h"           # a branch without a live agent stays active this long after its last index
# exclude = []              # branch-name globs never folded in
# index   = false           # check the projection out and index it as branch codify/projection
# steer   = true            # steer the agents on both branches when a build finds a new conflict
# auto    = true            # hooks, watch, serve and the supervisor start a background build when work happens
# min_interval = "15s"     # an automatic build waits this long after the last one

[fleet]
# discover = true           # fleet status/tree, serve and watch --fleet run cg fleet discover first (once per 10s)

[hooks]
# shell_advice = true       # cg hook pre-bash points a shell grep/find at cg grep and cg files
```

`hyperfide config` lists these sixteen settings, in this order:

| Key | Default | Controls |
|---|---|---|
| `sync.auto` | `true` | Whether Hyperfide syncs the graph without being asked. Accepts `true/yes/on/1` and `false/no/off/0`. |
| `paths.spec` | `spec` | The directory holding `workflow.kvx`, every `<feature>/spec.kvx`, and the rendered mirrors. |
| `paths.context` | `.codify`; `.hyperfide/context` when `hyperfide.kvx` exists | Where `agent-context.md` (`hyperfide agentmd --write`, `hyperfide integrate`) and `recap.md` (`hyperfide recap`) are written. A tree with no file or with only `codify.kvx` keeps `.codify`. |
| `paths.skills` | `.agents/skills` | The directory for generated `SKILL.md` files (`hyperfide skills`, and the `codify-workflow` skill from `hyperfide integrate`). |
| `paths.codemap` | `CODEMAP.md` | The file `hyperfide codemap` writes. |
| `index.workers` | `auto` | Parse workers per index pass for `hyperfide init`, `hyperfide index` and `hyperfide sync`: `1` to `64`, or `auto` (also `0`) for the machine's choice. See [[index] workers](#index-workers). |
| `projection.base` | *(empty)* | The branch `hyperfide projection build` folds onto. Empty means `[hierarchy] main` from `workflow.kvx`, else `main`. See [docs/projection.md](projection.md). |
| `projection.stale` | `24h` | How long after its last index a branch with no live agent still counts as active: `90s`, `30m`, `24h`, `2d`, or plain seconds. |
| `projection.exclude` | `[]` | Branch-name globs (`fnmatch`) never folded into the projection, even when named with `--branch`. `hyperfide config set projection.exclude "tmp/*,wip-*"` writes the list. |
| `projection.index` | `false` | Whether every build also checks the projection out under `.codegraph/worktrees/projection` and indexes it as branch `codify/projection`, as `--index` does. |
| `fleet.discover` | `true` | Whether `hyperfide fleet status`, `hyperfide fleet tree`, `hyperfide serve` and `hyperfide watch --fleet` run a quiet `hyperfide fleet discover` pass first, at most once per 10 seconds per process. `false` leaves discovery to `hyperfide fleet discover` (the `--no-discover` flag does the same for one command). |
| `projection.steer` | `true` | Whether a build that finds a new conflict steers the agents on both branches through the `hyperfide fleet steer` channel. `false` keeps the findings and events and stops the messages. |
| `hooks.shell_advice` | `true` | Whether `hyperfide hook pre-bash` (the Bash PreToolUse hook) answers a shell `grep`/`find` over this tree with the `hyperfide grep` or `hyperfide files` command that does the same from the graph. `false`, like `HYPERFIDE_SHELL_ADVICE=0`, keeps the hook silent; it never blocks the command either way. |
| `index.walk` | `auto` | How a whole-tree pass finds changed files: `full` walks the tree, `git` asks git, `auto` asks git above 20000 indexed files. See [[index] walk](#index-walk). |
| `projection.auto` | `true` | Whether the edit hooks, `hyperfide hook event`, `hyperfide watch`, `hyperfide serve` and the fleet supervisor start a background `hyperfide projection build --quiet` when work happens. `false` leaves builds to `hyperfide projection build`. See [Following the work](projection.md#following-the-work). |
| `projection.min_interval` | `15s` | How long an automatic build waits after the last one, so a burst of edits becomes one build: `5s`, `1m`, or plain seconds. |

The file is read once per process for each root, and the result is cached.
It belongs to the tree it sits in, so it travels with the branch in the same
way `spec/` does. A linked worktree reads its own copy.

## Paths

All paths are relative to the repository root. Hyperfide normalizes them, so
`./planning//specs/` becomes `planning/specs`. It rejects a value that:

- is absolute, or starts with `~`;
- climbs out of the repository with `..`. A `..` that stays inside is allowed:
  `a/../plan` becomes `plan`;
- is empty, or normalizes to the root itself (`.`);
- contains a backslash;
- starts inside `.git/` or `.codegraph/`.

When a value is rejected, Hyperfide prints one line on stderr naming the key and
the file, and uses the default for that key. The command still runs.

### What a relocated spec directory changes

Setting `paths.spec` moves the whole spec workflow to the new directory. Every
part of Hyperfide that reads or writes spec files follows it:

- the spec engine (`hyperfide spec …`);
- the orchestrator (`hyperfide spec run`), the fleet, docs, drift, guard, recap and
  events;
- the MCP `spec/...` resources;
- root discovery. `hyperfide spec` finds the root from any subdirectory, including
  one inside the relocated spec directory.

The files that `hyperfide spec render` and `hyperfide spec new` produce name the configured
directory. For example, CLAUDE.md says ``edit `planning/specs/workflow.kvx` ``.

The hook shims under `.codify/hooks/` stay where they are, because host
configurations refer to those paths. `paths.context` moves only
`agent-context.md` and `recap.md`.

## [sync] auto = false

By default Hyperfide keeps the graph fresh on its own. Setting `auto = false`
stops every implicit sync:

| Implicit sync | With `auto = false` |
|---|---|
| Freshness check before `hyperfide review`, `hyperfide agentmd` and `hyperfide resume --prompt` | skipped; reads the graph as it is |
| `hyperfide hook post-edit` (Claude Code PostToolUse) | the guard still runs; the sync is skipped |
| pre-commit index in `hyperfide commit` | skipped; the snapshot still reads the files on disk |
| git post-commit hook (`hyperfide sync --background --auto`) | skipped |
| MCP tools that sync first; `hyperfide serve`, which runs them | skipped |
| LSP refresh on save | skipped |
| `hyperfide watch` | exits with a message instead of watching |
| fleet watch | skips worktrees whose config turns auto-sync off |
| `hyperfide integrate` agent-context refresh | skipped |
| VS Code panel refresh | skipped (the extension asks `hyperfide config get sync.auto`) |

`hyperfide sync`, `hyperfide index` and `hyperfide init` always run, because you asked for them.
`hyperfide sync --auto` marks a sync as implicit: it does nothing when auto-sync is
off. The installed git hook uses it.

`hyperfide spec done`, `hyperfide spec implemented` and `hyperfide spec trace` still sync before
they qualify a task. Evidence has to reflect the tree as it is, and
`spec trace --no-sync` already lets you skip that sync on purpose.

`hyperfide brief` warns when auto-sync is off so that an agent knows the graph may be
stale. The text output adds a `sync:` line and the JSON output adds
`"auto_sync": false`.

## [index] workers

By default an index pass sizes its parse workers from the machine: the
effective cores, at most 16, fewer when memory is short (`hyperfide info` shows the
result). `[index] workers = N` replaces that choice with N, from 1 to 64 — more
than the machine profile would pick on a big machine, fewer on one you share
with a build:

```
[index]
workers = 24
```

Where several sources name a count, the first one present wins:

1. `--workers N` on `hyperfide index` or `hyperfide sync` (`hyperfide info --workers N` shows what
   it would resolve to);
2. the `HYPERFIDE_INDEX_WORKERS` environment variable, or its legacy
   spelling `CG_INDEX_WORKERS` (setting both to different values makes
   every command print `hyperfide: conflicting variable aliases for
   HYPERFIDE_INDEX_WORKERS (values redacted)` and exit 78);
3. `[index] workers` in `hyperfide.kvx`;
4. the machine profile.

`auto` or `0` in any of them means "not set here" and defers to the next.
The count then still yields to each pass's own bounds: never more workers
than files to parse, two when no machine-wide parse slot is free, and a
background pass (`hyperfide sync --background`, hooks, watchers) takes a quarter of
an asked-for count, at least one, in place of a quarter of the cores.
[docs/sync.md](sync.md) has the full order.

`hyperfide info` prints the count and where it came from, for example
`sized pipeline: 24 workers (hyperfide.kvx), …`; `hyperfide info --json` carries
`"workers"`, `"workers_origin"` (`flag`, `CG_INDEX_WORKERS` for either
variable name, the configuration file name, or `machine`) and `"machine_workers"`. The index summary's `[N workers]` and
`hyperfide sync --json`'s `"workers"` report what a pass actually used.

A value that is not a whole number from 0 to 64 (`65`, `-1`, `2.5`, `many`)
is a bad value like any other: one stderr line (prefixed `cg:`) names the
key and the file,
the machine's choice stands in, `hyperfide config check` lists it and exits 1, and
`hyperfide check` warns. A bad `--workers` on the command line is an error instead
(exit 1): you typed it just now. A count above this machine's effective
cores is allowed — the file travels to bigger machines — but `hyperfide config
check` prints a `warning:` line for it (and a `"warnings"` entry in `--json`)
without failing.

`hyperfide config set index.workers 8` writes `workers = 8`; `hyperfide config set
index.workers auto` writes `workers = "auto"`. In `hyperfide config --json` a count
is a number and `auto` is the string `"auto"`.

## [index] walk

A whole-tree pass (`hyperfide sync` with no paths, a hook, the freshness pass
before a read command) has to find what changed since the last one. By
default it walks the tree: every directory read, every file's size and
mtime compared with the graph. That costs time in proportion to the tree,
whatever changed. `[index] walk` picks how it finds them:

```
[index]
walk = git
```

- `full` — always walk the tree.
- `git` — ask git instead. The candidates are `git status --porcelain=v2
  --untracked-files=all` (modified, added, deleted, unmerged and untracked
  files), `git diff --name-only <head at the last pass>..HEAD` (whatever
  commits since then touched, both sides of a rename), and the files that
  were dirty at the last pass (a file edited and then reverted shows in
  neither list the second time). Only those go through the targeted path
  that `hyperfide sync <path>…` uses.
- `auto` (the default) — `git` once the branch has more than 20000 indexed
  files, `full` below that.

A git pass falls back to the walk, without a warning because nothing is
wrong, when git is not available or fails, when the tree is not a git work
tree, when the head the last pass saw is not recorded or not a commit git
knows, or when a candidate is a `.gitignore` or `.cgignore` (git names the
ignore file, not the files it newly hides or reveals). Every twentieth pass
on a branch, and every `hyperfide index --full`, walks the whole tree regardless,
so anything git could not see (a file under a submodule, an ignored file the
graph indexed before the rule appeared) is caught within twenty passes.
Each pass records the head it saw in the graph's meta table, per branch.

`hyperfide sync --json` and `hyperfide index --json` say which one ran in `"walk"`:
`"full"`, `"git"`, `"targets"` (named paths), or `"none"` (a fresh or
coalesced pass that did not run). `hyperfide config set index.walk git` writes
`walk = "git"`. Any other word is a bad value: it is named with its file,
`auto` stands in, and `hyperfide config check` exits 1.

## hyperfide config

`hyperfide config` works before `hyperfide init`, in a repository that has only a spec
directory, and in a directory with no project at all. Its messages still
name the command `cg config`.

| Command | Does |
|---|---|
| `hyperfide config [--json]` | Lists every setting with its value and origin (the file name, `hyperfide.kvx` or `codify.kvx`, or `default`). |
| `hyperfide config init` | Writes the commented defaults shown above to `hyperfide.kvx`. Refuses (exit 1) if the configuration file exists. |
| `hyperfide config get <key> [--json]` | Prints one value, for example `hyperfide config get paths.spec`. |
| `hyperfide config set <key> <value>` | Validates the value, then rewrites that one line and keeps comments and every other line. Creates `hyperfide.kvx` if no configuration file is present. Writes nothing and exits 1 if the value is invalid. |
| `hyperfide config check [--json]` | Lists parse errors, unknown sections, unknown keys and bad values. Prints `<root>/<file>: ok` (or `absent — every setting is the default`) when there are none and exits 1 when it finds any. Warns, without failing, when `[index] workers` exceeds this machine's effective cores. |

`hyperfide config --json` (in `--json` a boolean is `true`/`false`, a list is
an array, and `default` is the schema default — `.codify` for
`paths.context` even where the effective default is `.hyperfide/context`):

```json
{"root":"…","file":"…/hyperfide.kvx","present":true,
 "settings":[{"key":"paths.spec","value":"planning/specs","default":"spec","origin":"hyperfide.kvx"}, …],
 "problems":0}
```

`hyperfide config check --json`:

```json
{"file":"…/hyperfide.kvx","present":true,"ok":false,
 "problems":[{"kind":"unknown_key","section":"sync","key":"debounce","message":"…"}],
 "warnings":[]}
```

## Problems never stop a command

Unknown sections and keys are ignored, and Hyperfide does not mention them
unprompted. A bad value falls back to its default and gets one stderr line per
process. Neither stops a command.

`hyperfide check` reports any problems as a warning:

```
  warn  N hyperfide.kvx problem(s) — defaults used (cg config check):
```

This adds to the warning count and never to the failure count. The file name in the line is the one that was read. The `--json`
output carries `"config_problems": N` when the file exists. A valid file
reports `ok    hyperfide.kvx is valid`.
