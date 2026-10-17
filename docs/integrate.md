# hyperfide integrate

One command configures every agent host Hyperfide knows, and one command tells
you what is wrong with them. Examples use `hyperfide`; `cg` is the deprecated
compatibility alias of the same executable, with identical arguments, JSON
and exit codes, so `cg integrate apply` still works.

Implemented in `src/integrate.c` and `src/plugin.c`; covered by
`tests/integration/22_control.sh` (hosts and portable assets) and
`tests/integration/48_plugin.sh` (the Claude Code plugin and the Codex
hooks).

| Action | What it does |
|---|---|
| `hyperfide integrate detect` | the default: every host, its config path and state, and the plugin state (read-only) |
| `hyperfide integrate plan` | what `apply` would change for the hosts and the portable assets, read-only |
| `hyperfide integrate apply [--no-plugin]` | write everything below; idempotent |
| `hyperfide integrate doctor` | findings, with paths; exit 1 when there are any |
| `hyperfide mcp-install` | compatibility alias for `apply`; text output starts with ``Codify compatibility installer -> `hyperfide integrate apply` `` |

All of them take `--json`. `hyperfide mcp` is the stdio MCP server the host
entries start; its `initialize` answer names the server `hyperfide`.

## What apply writes

| Target | Where | Ownership |
|---|---|---|
| MCP server entry `hyperfide` for ten hosts (Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, OpenCode, Zed, Windsurf, Cline, Continue) | each host's config file | merged into the existing file; the original is kept once as `.hyperfide-backups/<file>.<sha256 of its bytes>` beside it |
| Portable Agent Skill | `<skills dir>/codify-workflow/SKILL.md` | `hyperfide-owned: portable-agent-skill v1` |
| Event shims | `.codify/hooks/event.sh` and one per host (`codex`, `claude`, `copilot`, `cursor`, `gemini`) | `hyperfide-owned: portable-event-shim v1`, `hyperfide-owned: <host>-event-shim v1` |
| Graph agent context | `<context dir>/agent-context.md` | `hyperfide-owned: graph-agent-context v1` |
| Claude Code plugin | `$HOME/.codify/plugins/claude-code/` | `codify-owned: claude-code-plugin cg <version>` in every file |
| Codex hooks | `<root>/.codex/hooks.json` | `codify-owned: codex-hooks cg <version>` in every command |

The skills and context directories come from `[paths]` in the project
configuration (see [config.md](config.md)). Host entries use the absolute
path of the running executable (`HYPERFIDE_BINARY`, or its alias `CG_BINARY`,
overrides it). The host config paths are those `detect` prints: Codex,
Windsurf, Cline and Continue live under `$HOME`, the other six in the
repository.

A host file that already has a server named `codify` (written by a 1.x
release) counts as configured and is left alone. A file that names both
`codify` and `hyperfide` is reported as malformed and is not touched; remove
one of the two entries.

`event.sh` runs `hyperfide event ingest --source <host>`, finding
`hyperfide` on `PATH` rather than by absolute path; each host shim calls
`event.sh` with its own name. A portable asset carrying either the
`hyperfide-owned:` marker or the older `codify-owned:` marker is rewritten
when its content changes, after the same `.hyperfide-backups/` copy. Anything
else at one of those paths is a **conflict**: reported (text and JSON),
counted as an error in apply's exit status, and left exactly as it was.
Delete or rename the file and apply again to take it back.

`--no-plugin` skips the Claude Code plugin and the Codex hooks entirely:
nothing is written under `$HOME/.codify/plugins` or `.codex/`, and the claude
CLI is not run.

## Authority mode

`integrate`, `mcp` and the hooks are local commands. In the default local
mode (`hyperfide authority mode` prints
`{"ok":true,"mode":"local",…}`) they behave as this page describes. When a
distributed authority descriptor is selected (`.hyperfide/authority.json` in
the tree or a parent, or `HYPERFIDE_AUTHORITY_DESCRIPTOR`), or
`HYPERFIDE_MODE` is invalid, they print a JSON error such as
`{"ok":false,"error":{"code":"DISTRIBUTED_COMMAND_UNSUPPORTED",…},"local_fallback":false}`
and exit 78 — the hooks included, so the exit-0 rule under
[The hooks](#the-hooks) holds only in local mode. Under a distributed
descriptor, `hyperfide mcp` with no options becomes the distributed MCP
client instead of the local server, and refuses with
`TRANSPORT_CONFIG_REQUIRED` until `HYPERFIDE_TRANSPORT_CONFIG` names a
transport configuration. Routing these commands through the
authority modes is task 25.3, still pending in `spec/hyperfide/spec.kvx`, so
the distributed path is not qualified in this revision; see
[docs/hyperfide/operations.md](hyperfide/operations.md) for the operating
model.

## The Claude Code plugin

The plugin is a one-plugin marketplace that `apply` renders from templates
and the absolute path of the running executable (`HYPERFIDE_BINARY` overrides it).
The plugin keeps its 1.x identity, `codify`:

```
$HOME/.codify/plugins/claude-code/
  .claude-plugin/marketplace.json      name codify, owner Codify
  plugins/codify/
    .claude-plugin/plugin.json         name codify, version = hyperfide version
    hooks/hooks.json                   the hooks below
    .mcp.json                          the codify server: <hyperfide> mcp
    skills/codify-workflow/SKILL.md    the portable skill
    commands/brief.md                  /brief      -> hyperfide brief
    commands/fleet.md                  /fleet      -> hyperfide fleet status
    commands/projection.md             /projection -> hyperfide projection status
```

Every marker names the version, so a new build regenerates the whole tree
on its first `apply`. Unlike the host configs, these files get no backup
copy: they are generated in full. Where a JSON file has no room for a comment the marker
sits where Claude Code ignores it: a `_codify` field in the two manifests,
a trailing shell comment on every command in `hooks.json`, and the server's `CODIFY_OWNED` environment
variable in `.mcp.json` (whose top level is a map of servers, so a stray key
there would read as one). `claude plugin validate` accepts the tree; it warns
that `_codify` is an unknown field, which is the point.

### The hooks

Every hook is a command hook calling the executable by absolute path with a
20 second timeout:

| Event | Matcher | Command |
|---|---|---|
| SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop | | `hyperfide hook event --host claude` |
| PreToolUse | `Agent\|Task` | `hyperfide hook event --host claude` |
| PreToolUse | `Bash` | `hyperfide hook pre-bash` |
| PostToolUse | `Edit\|Write\|MultiEdit\|NotebookEdit` | `hyperfide hook post-edit` |
| PostToolUse | `Agent\|Task` | `hyperfide hook event --host claude` |

In local mode the executable exits 0 from every hook, whatever happens:
outside a project a hook drains its stdin and returns, and a hook subcommand
this build does not know prints its usage line on stderr and exits 0, so a
plugin rendered by a newer build never fails an older one's host. `hyperfide hook pre-bash`
follows `[hooks] shell_advice` (see [config.md](config.md)).

### Installing it

When `claude` is on `PATH` (`HYPERFIDE_CLAUDE` or `CG_CLAUDE` names it
outright), apply runs

```
claude plugin marketplace add $HOME/.codify/plugins/claude-code
claude plugin install codify@codify --scope user
```

and reports the outcome. If the plugin is already installed at another
version it runs `claude plugin marketplace update codify` and `claude plugin
update codify@codify --scope user` instead; already installed at this version,
it runs nothing. Without `claude`, apply prints the two commands. A refusal
from `claude` is reported, not failed: the rest of apply stands.

Claude Code copies an installed plugin into its cache, so a change to the
tree reaches running sessions after the install or update and a restart.

### Plugin state

`detect` and `doctor` read what Claude Code recorded under
`$HOME/.claude/plugins/`:

- `known_marketplaces.json` — a `codify` key means the marketplace is
  registered (`installLocation` is where it points);
- `installed_plugins.json` — `plugins["codify@codify"][0].version` is the
  installed version.

The plugin counts as **installed** when both are present, and **current**
when the installed version is this build's (`hyperfide version`). These are the formats claude 2.1 writes;
`48_plugin.sh` fakes them with a stub `claude` that writes the same two files.

The JSON form, in `detect --json` and `doctor --json`:

```json
"plugin": {"root": "...", "rendered": true, "rendered_version": "2.0.0-dev",
           "registered": true, "installed": true, "version": "2.0.0-dev",
           "cg_version": "2.0.0-dev", "current": true}
```

Doctor reports an installed plugin at another version than this build, and a
foreign file at the
plugin's `plugin.json`, as findings. Not installed is a state, not a finding:
`--no-plugin` is a legitimate choice.

### No hook twice

The plugin registers `hyperfide hook post-edit` itself. `hyperfide hook
install` therefore
leaves `.claude/settings.json` alone when the plugin is installed and says
so; without the plugin it writes the PostToolUse hook there as before.

## The Codex hooks

`apply` writes `<root>/.codex/hooks.json` in the same shape, with every hook
a command calling the executable by absolute path and a 20 second timeout:

| Event | Matcher | Command |
|---|---|---|
| SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop, PreToolUse, PostToolUse | | `hyperfide hook event --host codex` |
| PostToolUse | `apply_patch\|Edit\|Write` | `hyperfide hook post-edit` |

The ownership marker is a trailing shell comment on each command
(`# codify-owned: codex-hooks cg <version>`), since Codex's schema for the
file has no free-form field; the shell Codex runs the command through
ignores it.

**The trust step.** Codex does not run repository hooks until they are
trusted: open Codex in the repository and approve them once through
`/hooks`. Apply prints this when it writes the file, and `detect` and
`doctor` carry it as `codex_hooks.trust` in JSON and as a line in text.
