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

## Install

No build step and no dependencies — the extension is plain JavaScript, including its Language Server client. `vsce package` needs no `npm install`.

```sh
cd editors/vscode
npx @vscode/vsce package        # produces codify-0.3.0.vsix
code --install-extension codify-0.3.0.vsix
```

For development, open `editors/vscode/` in VS Code and press F5.

## Note on other kvx extensions

If another extension also claims the `.kvx` extension (for example a grammar for a different kvx dialect), VS Code lets the last-installed one win. This grammar targets the Ion spec dialect that Codify parses: `[section]` headers, `key = "value"`, lists, and quote-toggled comments.
