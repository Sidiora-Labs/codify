# Codify Prod Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a repository-configured Prod mode whose `implemented` task state records coding completion without executing or implying qualification.

**Architecture:** Extend the existing spec engine in `src/spec.c` with a mode predicate, a dependency-satisfaction predicate, and a non-executing implemented transition that reuses graph checks. Keep qualification in `spec_done_cmd`, then expose the lifecycle through the existing CLI, MCP table, renderer, fixtures, and documentation without changing standard-mode behavior.

**Tech Stack:** C11, KVX workflow/spec files, POSIX shell integration tests, JSON MCP protocol.

**Spec:** `docs/superpowers/specs/2026-08-22-codify-prod-mode-design.md`

## Global Constraints

- `done` continues to mean executable qualification and graph checks passed.
- `implemented` never executes `verify_cmd` and never renders as `[x]`.
- Only Prod mode lets `implemented` satisfy `requires`.
- The implemented transition has no force bypass.
- Missing or unknown mode configuration behaves as standard mode.
- Existing CLI and JSON fields remain backward-compatible.

---

### Task 1: Specify the lifecycle with failing integration tests

**Files:**
- Modify: `tests/integration/05_spec.sh`
- Modify: `tests/integration/04_mcp.sh`
- Modify: `tests/fixtures/specrepo/spec/workflow.kvx`

**Interfaces:**
- Consumes: current `cg spec status|next|start|done|render` and MCP tool listing.
- Produces: executable expectations for `cg spec mode`, `cg spec implemented`, four-state counts, dependency semantics, qualification promotion, and MCP discovery.

- [ ] **Step 1: Add a standard-mode refusal test**

Add a fresh fixture copy, start task `1.2`, and assert:

```bash
out="$($CG spec implemented 1.2 2>&1)" && fail "implemented should require Prod mode"
has "$out" "requires Prod mode"
```

- [ ] **Step 2: Add Prod-mode transition and non-execution tests**

Activate Prod mode, set a `verify_cmd` that creates a sentinel, transition the task, and assert the sentinel is absent:

```bash
$CG spec mode prod >/dev/null
$CG spec start 1.2 >/dev/null
$CG spec implemented 1.2 >/dev/null
[ ! -e qualification.ran ] || fail "implemented executed verify_cmd"
grep -q 'status.*=.*"implemented"' spec/demo/spec.kvx
grep -q 'Implemented - qualification pending' spec/demo/tasks.md
```

- [ ] **Step 3: Add dependency and qualification tests**

Assert an implemented prerequisite unlocks `2.1` in Prod mode, failed `cg spec done 1.2` preserves `implemented`, and successful qualification promotes it to `done`.

- [ ] **Step 4: Add status and MCP expectations**

Assert text and JSON expose mode and implemented counts and MCP lists `spec_mode` plus `spec_implemented`.

- [ ] **Step 5: Run focused integration tests and verify RED**

Run:

```bash
make all
CG="$PWD/cg" bash tests/integration/05_spec.sh
CG="$PWD/cg" bash tests/integration/04_mcp.sh
```

Expected: failures identify missing `mode`/`implemented` commands and MCP tools, not fixture or shell errors.

- [ ] **Step 6: Commit the red tests**

```bash
git add tests/integration/05_spec.sh tests/integration/04_mcp.sh tests/fixtures/specrepo/spec/workflow.kvx
git commit -m "Specify Codify Prod mode lifecycle"
```

### Task 2: Implement Prod mode and the four-state engine

**Files:**
- Modify: `src/spec.c`

**Interfaces:**
- Consumes: `Kvx`, `kvx_set_status`, `spec_verify_task`, `spec_note_outcome`, and existing task rendering helpers.
- Produces: `spec_prod_mode(const Spec *)`, `task_satisfies_requires(const Spec *, const char *)`, `spec_mode_cmd(Spec *, const char *)`, and `spec_implemented_cmd(Spec *, const char *)`.

- [ ] **Step 1: Add mode and dependency predicates**

Implement exact predicates equivalent to:

```c
static bool spec_prod_mode(const Spec *s) {
    char *name = S(s->wf, "mode", "name");
    bool prod = strcmp(name, "prod") == 0;
    free(name);
    return prod;
}

static bool task_satisfies_requires(const Spec *s, const char *id) {
    char *st = task_status(s, id);
    bool ready = strcmp(st, "done") == 0 ||
                 (spec_prod_mode(s) && strcmp(st, "implemented") == 0);
    free(st);
    return ready;
}
```

Use the second predicate in dependency checks and requirement presentation without changing qualified completion accounting.

- [ ] **Step 2: Add the implemented transition**

Require Prod mode, a leaf task, and current `in_progress` status. Run only `spec_verify_task`; on failure, retain `in_progress` and record a blocked source-evidence outcome. On success, set `implemented`, render, record `implemented: <title> - qualification pending`, and print the next eligible task.

- [ ] **Step 3: Preserve qualification semantics**

Allow `spec_done_cmd` to accept `implemented`. If `verify_cmd` or graph checks fail, retain its original state. A successful invocation still writes only `done`.

- [ ] **Step 4: Extend state presentation**

Count implemented separately, add `"mode":"prod|standard"` and `"implemented":N` to JSON, report qualified and coding progress separately, and prevent `spec_start_cmd` from silently restarting implemented tasks.

- [ ] **Step 5: Render implemented honestly**

Keep an unchecked checkbox and append the exact suffix:

```text
 — **Implemented - qualification pending**
```

Do not change standard-mode golden output when no implemented state exists.

- [ ] **Step 6: Add command dispatch**

Extend `cmd_spec` usage and dispatch for `mode <prod|standard>` and `implemented <id>`, with no `--force` accepted by the latter.

- [ ] **Step 7: Run the focused spec test and verify GREEN**

Run `make all && CG="$PWD/cg" bash tests/integration/05_spec.sh`.

Expected: `PASS`/`ok` with Prod-mode assertions and all pre-existing spec assertions intact.

- [ ] **Step 8: Commit the engine**

```bash
git add src/spec.c
git commit -m "Add implemented lifecycle state for Prod mode"
```

### Task 3: Expose Prod mode through CLI and MCP

**Files:**
- Modify: `src/main.c`
- Modify: `src/mcp.c`

**Interfaces:**
- Consumes: `cmd_spec`, `run_spec`, the static MCP schema/tool table.
- Produces: CLI help for both commands and MCP tools `spec_mode` and `spec_implemented`.

- [ ] **Step 1: Extend CLI help**

Document:

```text
spec mode <prod|standard> configure dependency semantics
spec implemented <id>     mark coding complete without running verify_cmd
```

- [ ] **Step 2: Add MCP handlers and schemas**

`spec_mode` requires `mode` with enum `prod|standard`. `spec_implemented` requires only dotted task `id`; it must not expose a force argument.

- [ ] **Step 3: Update MCP descriptions**

State explicitly that `spec_implemented` performs graph checks, does not execute `verify_cmd`, and is available only in Prod mode. Update `spec_next`, `spec_status`, and `spec_done` descriptions for the four-state lifecycle.

- [ ] **Step 4: Run the focused MCP test and verify GREEN**

Run `make all && CG="$PWD/cg" bash tests/integration/04_mcp.sh`.

Expected: all MCP discovery and invocation assertions pass with the two new tools.

- [ ] **Step 5: Commit the interfaces**

```bash
git add src/main.c src/mcp.c
git commit -m "Expose Prod mode through CLI and MCP"
```

### Task 4: Update user-facing workflow documentation

**Files:**
- Modify: `README.md`
- Modify: `SECURITY.md`
- Modify: `docs/i18n/README.*.md`

**Interfaces:**
- Consumes: final command and lifecycle behavior from Tasks 2-3.
- Produces: an accurate public workflow contract in English and synchronized command references in existing translations.

- [ ] **Step 1: Document the four-state lifecycle and activation**

Add `cg spec mode prod`, `cg spec implemented <id>`, dependency semantics, and promotion to `done` to the primary README.

- [ ] **Step 2: Document the execution boundary**

State in `SECURITY.md` that `spec implemented` never executes `verify_cmd`; `spec done` remains the executable-command boundary.

- [ ] **Step 3: Synchronize translated command tables**

Add the two commands and the `implemented` state to every existing `docs/i18n/README.*.md` command table without removing translated content.

- [ ] **Step 4: Run documentation searches**

Run:

```bash
rg -L 'spec implemented' README.md docs/i18n/README.*.md
rg -n 'spec implemented|spec mode|implemented' README.md SECURITY.md docs/i18n/README.*.md
```

Expected: the first command returns no files; the second shows the new contract everywhere intended.

- [ ] **Step 5: Commit documentation**

```bash
git add README.md SECURITY.md docs/i18n/README.*.md
git commit -m "Document Codify Prod mode"
```

### Task 5: Verify and publish Codify

**Files:**
- Review: all files changed since `3747b23`

**Interfaces:**
- Consumes: the complete feature branch.
- Produces: fresh verification evidence, independent review, an updated installed binary, and a pushed Git commit history.

- [ ] **Step 1: Synchronize and inspect with Codify**

Run `./cg sync`, `./cg changes`, and targeted `./cg symbol` queries for new named functions.

- [ ] **Step 2: Run full verification**

Run `make clean && make test`.

Expected: all unit assertions and integration scripts pass; no new compiler warnings attributable to changed lines.

- [ ] **Step 3: Run independent code review**

Review the full diff from `3747b23` against the approved design, fixing all Critical and Important findings and re-running focused tests for any fixes.

- [ ] **Step 4: Re-run final verification**

Run `make clean && make test` again after review changes.

Expected: the same complete green result on the exact tree to publish.

- [ ] **Step 5: Install and smoke-test**

Run `make install` and verify `cg --version`, `cg spec mode --help` behavior, and LayerX `cg spec status --json` with the updated binary.

- [ ] **Step 6: Publish**

Fast-forward the approved branch to `main`, push `main` to `origin`, and verify the remote SHA. Remove only the feature worktree and branch created for this plan after publication is confirmed.
