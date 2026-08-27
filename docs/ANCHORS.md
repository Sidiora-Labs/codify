# The anchor convention

Half of a codebase is invisible to a parser. Symbols, calls, and routes are
the structure graph; *purpose, contract, danger, and coupling* live only in
prose. Codify indexes that prose — comments become first-class graph nodes,
bound to the symbol they describe — and this document is the convention for
writing prose worth indexing.

## The derivability test

One rule decides whether a comment is an anchor:

> **If an agent could have written the comment by reading the code, it is
> not an anchor.**

`i++ // increment i` fails the test. So does `// constructor` above a
constructor, and any comment that restates the signature. Codify applies a
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
sentence at the top of the file is what `cg survey` prints as the file's
purpose line.

## What the machinery does with them

- **Capture** — every anchor is indexed and bound to its symbol; multi-line
  notes are searchable via `cg search` and `cg context`.
- **Doc-first retrieval** — `cg context` serves doc + signature instead of
  body lines where an anchor exists, so one budget covers several times
  more symbols. `cg symbol` keeps the body and leads with the doc.
- **The survey tier** — `cg survey [path|query]` reads ~100 files for the
  price of one body: purpose lines, docs with signatures, never bodies.
- **Soft edges** — names inside anchors (symbols, paths, routes) become
  references of kind `soft`: the cross-language and dynamic couplings a
  parser cannot derive. They appear labeled `(soft)` in `cg impact` and
  never masquerade as parsed calls; `--no-soft` excludes them.
- **Drift honesty** — every anchor records a baseline of the code it
  describes. When the code moves on and the doc does not, the anchor is
  *stale*: `cg check` warns, `cg guard` names it after your edits, and
  retrieval marks the doc `[stale]` rather than serving it as truth.
  Updating (or deleting) the comment clears it. Warn, don't block.

## Backfilling a repository

Do not anchor everything — anchor where coordination happens.

```
cg anchors               # health: coverage, stale docs, top of the work list
cg anchors --uncovered   # the backfill work list, ranked
cg anchors --stale       # docs whose code moved on
```

The ranking is a **coordination score**: fan-out × extent × distinct
referencing files. Deliberately *not* raw inbound reference count — that
metric ranks the `sb_puts`/`xmalloc` tail highest, and self-evident
utilities are exactly the symbols that need no anchor. Orchestration
points — long functions that call many things and are referenced from many
files — rise to the top; a score of zero is a leaf that explains itself.

Work from the top of `cg anchors --uncovered`, write only comments that
pass the derivability test, and let the drift lint keep the backfill honest
afterwards: a stale anchor is worse than none, and `cg check` will say so.

Nothing here is required for adoption. A repository that has never heard of
this convention still gets capture, retrieval, survey, and soft edges from
whatever comments it already has — the convention only makes them pay more.
