# KVX

**KVX** is an ordered, sectioned key/value document format for specs,
workflows, schemas, and interface declarations — designed for determinism,
diff-friendliness, and zero-dependency parsing.

```kvx
# One fact per line. Order is preserved. Output is reproducible.

[meta]
name    = "Codify Workflow"
version = 1

[scalar.AccountId]
json   = "string"
prefix = "act_"

[task.1.1]
title   = "ACP core"
status  = "done"
touches = ["editors/vscode/acp.js", "tests/integration/19_acp.sh"]
```

KVX is used in production by [Codify](https://github.com/sidiora-labs/codify)
(spec engine, workflow files) and the LayerX Protocol (API schema modules,
wire-protocol message tables, program interfaces, migrations).

## Repository layout

```
spec/
  kvx-1.0.md       # normative specification
  grammar.ebnf     # formal grammar
impl/
  go/              # reference implementation (zero-dependency Go)
testdata/
  valid/           # conformance corpus — must parse, canonical fixed point
  invalid/         # conformance corpus — must be rejected with file:line
examples/          # real-world documents
```

## The format in six rules

1. **Sections**: `[name]` or dotted `[group.sub.id]`; case-sensitive;
   dotted names form tables by convention.
2. **Pairs**: one `key = value` per line; last duplicate wins.
3. **Values**: bare scalars, double-quoted strings, or bracketed lists —
   all opaque strings to KVX; typing is the application's concern.
4. **Comments**: `#` to end of line, except inside quotes.
5. **Interpolation**: `${ENV_VAR}` resolved at access time.
6. **Canonical form**: comments stripped, order preserved, one canonical
   rendering; documents are hashable (SHA-256 of canonical bytes).

See [`spec/kvx-1.0.md`](spec/kvx-1.0.md) for the full specification.

## Go reference implementation

```go
import kvx "github.com/sidiora-labs/kvx/impl/go"

doc, err := kvx.ParseFile("spec/workflow.kvx")
name  := doc.Str("meta", "name")
tasks := doc.SectionsWithPrefix("task")
files := doc.List("task.1.1", "touches")
hash  := doc.Hash()
```

Run the conformance suite:

```bash
cd impl/go && go test ./...
```

## Conformance

Any implementation (in any language) is conformant when it passes the
corpus under `testdata/` and satisfies §5 (canonical form) and §6
(accessor surface) of the spec.

## Relation to Argus (`.agi`)

An earlier dense key/value dialect (ALLCAPS sections, `k=v`, the
`MATRIX.CTX` family) also used the `.kvx` extension. That dialect is now the
legacy data profile of the [Argus language](https://github.com/sidiora-labs/argus)
and is not KVX 1.0.

## License

MIT © 2026 Sidiora Labs
