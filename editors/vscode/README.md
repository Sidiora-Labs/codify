# Codify for VS Code

The Codify agent workflow, inside the editor. Two things ship here:

**kvx language support.** Syntax highlighting and editing support for `.kvx` spec files — `[section.sub]` headers, keys, quoted strings, lists, `${ENV}` interpolation, `#` comments, and status values colored by state (`done` green, `in_progress` yellow).

**A live task board.** A "Codify Tasks" view in the Explorer that shows the active feature's plan the way Codify sees it:

- Tasks grouped by dependency wave, with per-wave progress and status icons; the next eligible task is marked.
- Expanding a task reveals its graph-verification data from `cg spec trace`: declared symbols with their resolved location, kind, and reference count; touched-path patterns with whether a matching change exists; and the commits tagged with the task.
- Inline actions run the real workflow: start a pending task, complete an in-progress one (`cg spec done` — the completion is refused if the task's `verify_cmd` or graph checks fail, with the failing checks shown in the Codify output channel and an explicit "Force done" escape hatch).
- A status bar item shows `feature done/total`; clicking it shows the next eligible task with its acceptance criteria.
- The board refreshes automatically when any `spec/**/*.kvx` file changes.

Everything is driven by the `cg` binary — the extension holds no state and never parses specs itself, so it can not disagree with the CLI.

## Requirements

- `cg` on `PATH`, or set `codify.binaryPath`.
- A workspace containing `spec/workflow.kvx` (the task board hides itself otherwise; kvx highlighting works everywhere).

## Settings

| Setting | Default | Description |
|---|---|---|
| `codify.binaryPath` | `cg` | Path to the cg binary |
| `codify.feature` | *(empty)* | Feature override, passed to every spec command as `-f` |

## Install

No build step — the extension is plain JavaScript.

```sh
cd editors/vscode
npx @vscode/vsce package        # produces codify-0.1.0.vsix
code --install-extension codify-0.1.0.vsix
```

For development, open `editors/vscode/` in VS Code and press F5.

## Note on other kvx extensions

If another extension also claims the `.kvx` extension (for example a grammar for a different kvx dialect), VS Code lets the last-installed one win. This grammar targets the Ion spec dialect that Codify parses: `[section]` headers, `key = "value"`, lists, and quote-toggled comments.
