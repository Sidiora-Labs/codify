# cg integrate

One command configures every agent host Codify knows, and one command tells
you what is wrong with them.

Implemented in `src/integrate.c` and `src/plugin.c`; covered by
`tests/integration/22_control.sh` (hosts and portable assets) and
`tests/integration/48_plugin.sh` (the Claude Code plugin and the Codex
hooks).

| Action | What it does |
|---|---|
| `cg integrate detect` | the default: every host, its config path and state, and the plugin state (read-only) |
| `cg integrate plan` | what `apply` would change, read-only |
| `cg integrate apply [--no-plugin]` | write everything below; idempotent |
| `cg integrate doctor` | findings, with paths; exit 1 when there are any |

All four take `--json`.

## What apply writes

| Target | Where | Ownership |
|---|---|---|
| MCP server entry for ten hosts (Codex, Claude Code, Copilot/VS Code, Cursor, Gemini CLI, OpenCode, Zed, Windsurf, Cline, Continue) | each host's config file | merged into the existing file; the original is kept once as `<file>.codify.bak` |
| Portable Agent Skill | `<skills dir>/codify-workflow/SKILL.md` | `codify-owned:` marker |
| Event shims | `.codify/hooks/event.sh` and one per host | `codify-owned:` marker |
| Graph agent context | `<context dir>/agent-context.md` | `codify-owned: graph-agent-context` |
| Claude Code plugin | `$HOME/.codify/plugins/claude-code/` | `codify-owned: claude-code-plugin cg <version>` in every file |
| Codex hooks | `<root>/.codex/hooks.json` | `codify-owned: codex-hooks cg <version>` in every command |

A generated file is rewritten only when it carries its marker. Anything else
at one of those paths is a **conflict**: reported (text and JSON), counted as
an error in apply's exit status, and left exactly as it was. Delete or rename
the file and apply again to take it back.

`--no-plugin` skips the Claude Code plugin and the Codex hooks entirely:
nothing is written under `$HOME/.codify/plugins` or `.codex/`, and the claude
CLI is not run.

## The Claude Code plugin

The plugin is a one-plugin marketplace that `apply` renders from templates
and the absolute path of the running `cg` (`CG_BINARY` overrides it):

```
$HOME/.codify/plugins/claude-code/
  .claude-plugin/marketplace.json      name codify, owner Codify
  plugins/codify/
    .claude-plugin/plugin.json         name codify, version = cg --version
    hooks/hooks.json                   the hooks below
    .mcp.json                          the codify server: <cg> mcp
    skills/codify-workflow/SKILL.md    the portable skill
    commands/brief.md                  /brief      -> cg brief
    commands/fleet.md                  /fleet      -> cg fleet status
    commands/projection.md             /projection -> cg projection status
```

Every marker names the cg version, so a new `cg` regenerates the whole tree
on its first `apply`. Where a JSON file has no room for a comment the marker
sits in a field Claude Code ignores: `_codify` in the two manifests,
`description` in `hooks.json`, and the server's `CODIFY_OWNED` environment
variable in `.mcp.json` (whose top level is a map of servers, so a stray key
there would read as one). `claude plugin validate` accepts the tree; it warns
that `_codify` is an unknown field, which is the point.

### The hooks

Every hook is a command hook calling `cg` by absolute path with a 20 second
timeout:

| Event | Matcher | Command |
|---|---|---|
| SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop | | `cg hook event --host claude` |
| PreToolUse | `Agent\|Task` | `cg hook event --host claude` |
| PreToolUse | `Bash` | `cg hook pre-bash` |
| PostToolUse | `Edit\|Write\|MultiEdit\|NotebookEdit` | `cg hook post-edit` |
| PostToolUse | `Agent\|Task` | `cg hook event --host claude` |

`cg` exits 0 from every hook, whatever happens: outside a Codify project a
hook drains its stdin and returns, and a hook subcommand this `cg` does not
know prints its usage line on stderr and exits 0, so a plugin rendered by a
newer `cg` never fails an older one's host.

### Installing it

When `claude` is on `PATH` (`CG_CLAUDE` names it outright), apply runs

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
when the installed version is cg's. These are the formats claude 2.1 writes;
`48_plugin.sh` fakes them with a stub `claude` that writes the same two files.

The JSON form, in `detect --json` and `doctor --json`:

```json
"plugin": {"root": "...", "rendered": true, "rendered_version": "1.6.0",
           "registered": true, "installed": true, "version": "1.6.0",
           "cg_version": "1.6.0", "current": true}
```

Doctor reports an installed plugin older than `cg`, and a foreign file at the
plugin's `plugin.json`, as findings. Not installed is a state, not a finding:
`--no-plugin` is a legitimate choice.

### No hook twice

The plugin registers `cg hook post-edit` itself. `cg hook install` therefore
leaves `.claude/settings.json` alone when the plugin is installed and says
so; without the plugin it writes the PostToolUse hook there as before.

## The Codex hooks

`apply` writes `<root>/.codex/hooks.json` in the same shape, with every hook
a command calling `cg` by absolute path and a 20 second timeout:

| Event | Matcher | Command |
|---|---|---|
| SessionStart, SessionEnd, Stop, SubagentStart, SubagentStop, PreToolUse, PostToolUse | | `cg hook event --host codex` |
| PostToolUse | `apply_patch\|Edit\|Write` | `cg hook post-edit` |

The ownership marker is a trailing shell comment on each command
(`# codify-owned: codex-hooks cg <version>`), since Codex's schema for the
file has no free-form field; the shell Codex runs the command through
ignores it.

**The trust step.** Codex does not run repository hooks until they are
trusted: open Codex in the repository and approve them once through
`/hooks`. Apply prints this when it writes the file, and `detect` and
`doctor` carry it as `codex_hooks.trust` in JSON and as a line in text.
