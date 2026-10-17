# The anchor convention

Half of a codebase is invisible to a parser. Symbols, calls, and routes are
the structure graph; *purpose, contract, danger, and coupling* live only in
prose. Hyperfide indexes that prose — comments become first-class graph nodes,
bound to the symbol they describe — and this document is the convention for
writing prose worth indexing.

Commands below use `hyperfide`, the canonical command; `cg` is a deprecated
compatibility alias from the same executable with identical arguments, JSON
and exit codes, kept for the compatibility window of the approved release.

## The derivability test

One rule decides whether a comment is an anchor:

> **If an agent could have written the comment by reading the code, it is
> not an anchor.**

`i++ // increment i` fails the test. So does `// constructor` above a
constructor, and any comment that restates the signature. Hyperfide applies a
mechanical version of the same test at retrieval time: a doc whose every
word already appears in the symbol's name or signature is dropped rather
than served. Write the thing the code *cannot* say, or write nothing.

## The four kinds

**Purpose** — why this exists, not what it does.

```c
/* One command for CI. Everything Codify can prove about the repository,
 * gated behind a single exit code so a pipeline needs exactly one step. */
```

**Contract** — what callers must hold true. Locks, ordering, units,
ownership, blocking behaviour.

```c
/* Post one entry. Callers must hold the ledger lock. */
```

**Danger** — what will break and how, the invariant that is not obvious at
the call site.

```c
/* Never reuse a statement across threads: SQLite will not save you. */
```

**Pointer** — the coupling no parser can see: the other file, symbol, or
route this code moves with.

```py
# Merge new tasks after load_tasks reads the disk.
```

A file-level header stating the file's purpose is the fifth surface — one
sentence at the top of the file is what `hyperfide survey` prints as the file's
purpose line.

## What the machinery does with them

- **Capture** — every anchor is indexed and bound to its symbol; multi-line
  notes are searchable via `hyperfide search` and `hyperfide context`.
- **Doc-first retrieval** — `hyperfide context` serves doc + signature
  instead of body lines where an anchor exists, so one budget covers
  several times more symbols. `hyperfide symbol` keeps the body and leads
  with the doc.
- **The survey tier** — `hyperfide survey [path|query]` reads about 100
  files per call (default budget 16000 tokens): purpose lines, docs with
  signatures, never bodies.
- **Soft edges** — names inside anchors (symbols, paths, routes) become
  references of kind `soft`: the cross-language and dynamic couplings a
  parser cannot derive. They appear labeled `(soft)` in `hyperfide impact` and
  never masquerade as parsed calls; `--no-soft` excludes them.
- **Drift honesty** — every anchor records a baseline of the code it
  describes. When the code moves on and the doc does not, the anchor is
  *stale*: `hyperfide check` warns, `hyperfide guard` names it after your
  edits (advisory, never a failure), and retrieval marks the doc
  `[stale — code changed after this was written]` (`"doc_stale": true` in
  JSON) rather than serving it as truth.
  Updating (or deleting) the comment clears it. Warn, don't block.

## Backfilling a repository

Do not anchor everything — anchor where coordination happens.

```
hyperfide anchors               # health: coverage, stale docs, top of the work list
hyperfide anchors --uncovered   # the backfill work list, ranked
hyperfide anchors --stale       # docs whose code moved on
```

The ranking is a **coordination score**: fan-out × extent × distinct
referencing files (soft references do not count toward fan-out).
`--json` reports `symbols`, `anchored`, `stale`, `uncovered` and
`uncovered_total`, and the MCP `anchors` tool returns the same report.
Deliberately *not* raw inbound reference count — that
metric ranks the `sb_puts`/`xmalloc` tail highest, and self-evident
utilities are exactly the symbols that need no anchor. Orchestration
points — long functions that call many things and are referenced from many
files — rise to the top; a score of zero is a leaf that explains itself.

Work from the top of `hyperfide anchors --uncovered`, write only comments that
pass the derivability test, and let the drift lint keep the backfill honest
afterwards: a stale anchor is worse than none, and `hyperfide check` will say so.

Nothing here is required for adoption. A repository that has never heard of
this convention still gets capture, retrieval, survey, and soft edges from
whatever comments it already has — the convention only makes them pay more.
