# Semantic conformance corpus

`catalog.py` labels one real declaration and one non-code decoy for each
advertised language or file-level adapter. `edge_catalog.py` labels a real
caller-to-target relation and a real unrelated source for each structural
adapter. `frameworks.py` labels a route, a named handler, their typed link and
a commented-out decoy registration for every advertised route adapter.

`run.py` indexes each fixture with the supplied `cg` binary and reads the
resulting database. It scores labelled facts by source path, name, kind,
location and relationship endpoints. Its precision and recall are **over the
labelled facts**, not an estimate of all code in a repository. It reports
unresolved semantic references and extraction status/parser by adapter. The
gate requires every labelled positive and negative to pass; missing semantic
tables, parser identity, evidence or coverage are failures. File-only formats
must identify their limited coverage and emit no structural symbol.

`convergence.py` indexes real files, then compares the whole normalized graph
set after edits, competing definitions, rename, deletion, configuration and
registration changes, sequential commits, an interrupted semantic write and
a linked worktree. Each checkpoint rebuilds a separate copy of the same
source tree. Set comparison includes files, extraction health, symbols,
ownership, name postings, references, bindings, type facts, typed edges,
route facts, compositions and dependency keys with locations and provenance;
it excludes database IDs and insertion order. It also checks name search
after a semantic version refresh over unchanged source bytes. The interruption
trigger only fails a write;
it does not insert fake symbols or relationships.

Run `CG=/absolute/path/to/cg bash tests/integration/76_semantic_conformance.sh`.
Set `CG_SEMANTIC_REPORT_DIR` to keep the JSON reports. A failed gate means
the named adapter or convergence scenario is unfinished; do not remove its
label to make a release green. Source snippets are intentionally small so a
failure points to one boundary. Larger real repositories belong in separate
resource and agent evaluations.
