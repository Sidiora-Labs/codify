# Codify for VS Code

The whole Codify workflow, inside the editor. Everything is driven by the `cg` binary — the extension holds no state and never parses specs or code itself, so it cannot disagree with the CLI.

## Code navigation from the graph

The extension runs `cg lsp` and speaks the Language Server Protocol to it, so every language Codify indexes gets real editor support with **no compiler, no toolchain, and no project configuration**:

| Feature | Backed by |
|---|---|
| Go to definition, find all references | The `symbols` and `refs` tables |
| Hover | What the symbol is, how many references it has, **and the decisions recorded about it** |
| Go to symbol in workspace / in file | The trigram index — instant, no warm-up |
| Code lens | Reference count and test-reference count above every function, so coverage gaps are visible while reading |
| Problems | kvx parse errors, and files edited outside the in-progress task's declared `touches` |

That last row is the point. **Scope drift shows up as a squiggle at the moment of the edit** — for you and for whatever agent is working alongside you — instead of waiting for someone to run a command. It is a warning, never an error: Codify advises, and only `--strict` enforces.

Turn it off with `codify.languageServer` if you want the task board alone.

## Task board

A "Codify" container in the activity bar, with two views.

**Tasks** shows the active feature's plan the way Codify sees it:

- Tasks grouped by dependency wave, with per-wave progress and status icons. The next eligible task is marked; `implemented` tasks are shown as *qualification pending* rather than done.
- Expanding a task reveals its verification data from `cg spec trace`: declared symbols with resolved location, kind and reference count; touched-path patterns with whether a matching change exists; the commits tagged with the task; and the memories written under it.
- Inline actions run the real workflow — start, mark implemented, complete. `cg spec done` is refused when `verify_cmd` or the graph checks fail, with the failing checks shown in the Codify output and a deliberately awkward, modal "Force done anyway" escape hatch.
- In parallel mode, tasks show who holds their lease, and claim/release actions appear.

**Memory** lists recent decisions, constraints and facts, grouped by type, with the task each was written under. Add one from anywhere with **Codify: Remember a Decision** — if a file is open, it is anchored to that file automatically.

## The agent view

The Codify sidebar has an **Agent** view — a persistent chat with Claude Code or Codex, always there, no task required. The extension speaks the [Agent Client Protocol](https://agentclientprotocol.com) to the agent's ACP adapter (`claude-code-acp` or `codex-acp`); the adapter spawns lazily on your first message, running in the workspace with **Codify's own MCP server injected** (`cg mcp`), so the agent has the full graph, spec, and memory toolset without any per-repo MCP config. A driver picker in the header switches between codex and claude for the next chat; the **＋ New Agent Chat** button on the view resets to a fresh session.

The view streams the agent's replies and (collapsed) thinking, renders each tool call as a card with its status and diffs, tracks the agent's plan, and surfaces **permission requests as buttons** — allow once, always, reject — answered inline, never in a modal. File reads and writes requested by the agent over ACP are served by the extension and are refused outside the workspace root. **Stop** cancels the in-flight turn (`session/cancel`); typing while the agent is working queues your message for the next turn.

Replies render as markdown — headings, lists, tables, quotes, inline code, and fenced code blocks with a copy button and the language on the rail. Any file path the agent mentions (`src/graph.c`, `editors/vscode/acp.js:42`) becomes a link that opens the file at that line, and so does every location a tool call reports. The composer grows with your message, `↑` recalls what you sent before, and the context bar above the chat carries the active feature and mode, the attached task and its live board status, and the driver.

### Codify commands in the chat

Type `/` for the command palette. Each one runs the real `cg` verb in the workspace, shows the output as a collapsible card, and hands the same output to the agent as context with a short instruction — so the agent works from the graph rather than from a guess.

| Command | Runs |
|---|---|
| `/brief` | `cg brief` — session state: task, changes, decisions |
| `/next` | `cg spec next` — the next eligible task |
| `/status` | `cg spec status` — the board for the active feature |
| `/task [id]` | Claim, start, and attach a task, then brief the agent with its resume packet |
| `/context <query>` | `cg context` — symbols, snippets and edges in one call |
| `/search <query>` | `cg search` — find code by name across the graph |
| `/impact <name>` | `cg impact` — callers and callees |
| `/why <name>` | `cg why` — commits, tasks, decisions behind a symbol |
| `/changes` | `cg changes` — impact radius of the uncommitted edits |
| `/review` | `cg review` — changed symbols vs the task's acceptance criteria |
| `/tests [symbol]` | `cg test-impact` — the tests that exercise it |
| `/check` | `cg check` — the gate: render, lint, evidence, tree |
| `/remember <text>` | `cg remember` — save a decision to project memory |
| `/handoff` | `cg handoff` — record where you stopped on the attached task |
| `/open <path>` | Open a file in the editor |
| `/new`, `/help` | Fresh chat; the palette itself |

`/brief`, `/next`, `/review`, `/check` and `/task` are also one-click chips on the empty chat.

### Working tasks in the view

The board *drives* the same chat. **Start Agent Session on Task** (task node or palette) runs the whole pickup into the Agent view:

1. In parallel mode the task is claimed first (`cg spec claim <id> --agent vscode-acp-<n>`), then started. A claim someone else holds is refused, not stolen.
2. A resume packet is generated with `cg resume --task <id> --prompt` (degrading to the session brief on an older `cg`) and sent as the opening prompt.
3. The view's header shows the task id, title, and live board status while the agent works it.

If the view already has a chat going, you choose: replace it (with the usual handoff/release offer for an attached task) or **open beside** — an editor panel running a second concurrent session. When any session ends with its task not yet qualified, the extension offers to record a handoff or release the claim — the same discipline as the terminal path.

If the adapter is missing or fails to start (auth methods, when the agent reports them, are named in the error), any claim is released and the extension offers the terminal session as the fallback. Set `codify.agent.interface: "terminal"` to route task starts to a seeded terminal (`codify: <driver> <id>`) instead of the view.

The rest of the lifecycle:

| Command | What it does |
|---|---|
| Run Agent Headless on Task | Same claim + prompt, but runs `codex exec --sandbox workspace-write` (or `claude -p`) as a VS Code task; the exit is reported with the task's resulting status |
| Hand Off Task | Records what is done, what is next, and what is blocked (`cg handoff`) so a fresh session can pick up cleanly |
| Resume Task in Agent Session | Quick-picks an in-progress task and opens a new driver terminal seeded from `cg resume --prompt` — the fresh-session half of a handoff |
| Run Wave with Agents | Opens a terminal running `cg spec run -n <codify.agent.parallelism> --driver <driver>` — the built-in orchestrator works the whole eligible frontier |
| Stop Agent Session | Closes the session's terminal (or terminates the headless task) |

When a session's terminal closes — or a headless run exits — with the task not yet `done` or `implemented`, the extension offers to release the claim so the task returns to the frontier. While any tracked session exists, the board refreshes on a 3-second poll in addition to watching `.codegraph/graph.db`, so work done by agents outside the editor shows up without a manual refresh. Tasks with a live claim show `$(person)` plus the agent name; `$(terminal)` marks tasks with a tracked terminal session and `$(comment-discussion)` marks tasks with a live agent panel in this window.

## The rest of the workflow

Click the status bar item, or run **Codify: Actions…**, for one menu covering the whole loop:

| Command | What it does |
|---|---|
| Session Brief | Project state, the active task and its criteria, uncommitted paths, recent decisions — the thing to run first |
| Review the Change | Changed symbols, the callers now at risk, and the acceptance criteria the change claims to satisfy |
| Tests Touching This Change | Which tests exercise the symbol under the cursor, or everything you have changed |
| Why Does This Exist? | Provenance for the symbol under the cursor: commits, the tasks they implemented, the decisions behind them |
| Check the Repository | The full gate — render staleness, spec lint, task evidence, claim consistency |
| Check Edit Scope | What `cg guard` sees right now |
| New Feature Spec / Add Task | Create a plan without leaving the editor |
| Lint Spec | Requires cycles, unknown ids, missing criteria, dead globs |
| Snapshot the Working Tree | `cg commit`, auto-tagged with the in-progress task |
| Install Hooks | Wire the agent and git hooks so the graph stays fresh on its own |

Reports open as rendered markdown previews rather than console dumps.

A second status bar item appears **only when edits have drifted outside the current task's scope**, listing the files. It is advisory; clicking it shows the detail.

## kvx editing

Beyond syntax highlighting:

- **Go to definition** on a `requires` entry jumps to that task; on a `reqs` entry, to the requirement it satisfies; on a concrete `touches` path, to the file.
- **Completion** offers the keys a task section actually understands — with what each one does — and real task ids when completing `requires`.
- **Hover** on any key explains what the spec engine does with it.
- **Outline** lists every requirement, design section and task, with titles.

## Requirements

- `cg` on `PATH`, or set `codify.binaryPath`.
- For the task board: a workspace containing `spec/workflow.kvx`.
- For code navigation: a workspace with `.codegraph/` — run `cg init`.

Neither is required for the other. kvx highlighting works everywhere.

## Settings

| Setting | Default | Description |
|---|---|---|
| `codify.binaryPath` | `cg` | Path to the cg binary |
| `codify.feature` | *(empty)* | Feature override, passed to every spec command as `-f` |
| `codify.languageServer` | `true` | Run `cg lsp` for navigation, hover, code lens and diagnostics |
| `codify.agentName` | *(empty)* | Default name used when claiming a task in parallel mode |
| `codify.agent.driver` | `codex` | Which agent drives task sessions: `codex` or `claude` |
| `codify.agent.interface` | `panel` | How a session opens: the ACP agent panel or a seeded terminal |
| `codify.acp.claudeCommand` | `claude-code-acp` | Command that starts the Claude Code ACP adapter (quote-aware) |
| `codify.acp.codexCommand` | `codex-acp` | Command that starts the Codex ACP adapter (quote-aware) |
| `codify.acp.customCommand` | *(empty)* | Any ACP-speaking agent command; overrides both adapter settings |
| `codify.agent.codexPath` | `codex` | Path to the Codex CLI (terminal sessions) |
| `codify.agent.claudePath` | `claude` | Path to the Claude Code CLI |
| `codify.agent.codexArgs` | *(empty)* | Extra arguments passed to codex when starting a session |
| `codify.agent.claudeArgs` | *(empty)* | Extra arguments passed to claude when starting a session |
| `codify.agent.parallelism` | `2` | Agent slots used by Run Wave with Agents (`cg spec run -n`) |

## Install

No build step and no dependencies — the extension is plain JavaScript, including its Language Server client. `vsce package` needs no `npm install`.

```sh
cd editors/vscode
npx @vscode/vsce package        # produces codify-0.4.0.vsix
code --install-extension codify-0.4.0.vsix
```

For development, open `editors/vscode/` in VS Code and press F5.

## Note on other kvx extensions

If another extension also claims the `.kvx` extension (for example a grammar for a different kvx dialect), VS Code lets the last-installed one win. This grammar targets the Ion spec dialect that Codify parses: `[section]` headers, `key = "value"`, lists, and quote-toggled comments.
