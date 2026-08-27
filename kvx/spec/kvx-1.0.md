# KVX Language Specification

**File extension:** `.kvx`
**Full name:** KVX (Key-Value X)
**Version:** 1.0
**Status:** Canonical — implementations must conform.

---

## 1. What KVX is

KVX is an ordered, sectioned key/value document format. It is designed for
documents that are written by humans, read by humans, and consumed by
deterministic tooling: spec files, workflow definitions, API schema modules,
wire-protocol message tables, program interface declarations, and migration
manifests.

Design goals, in priority order:

1. **Determinism.** A KVX document has exactly one canonical form. Parsers
   preserve the insertion order of sections and of keys within a section, so
   rendered output is byte-for-byte reproducible and hashable.
2. **Zero dependencies.** The grammar is parseable line-by-line with no
   grammar library, no schema compiler, and no runtime configuration.
3. **Diff-friendliness.** One fact per line. A one-line change in meaning is a
   one-line change in the file.
4. **Opacity of inner languages.** Values are strings to KVX. Applications may
   layer typed interpretations (integers, booleans, payload expressions,
   URIs) on top; KVX itself does not interpret them.

KVX is *not* a serialization format for arbitrary data structures. There is no
nesting beyond one section level (dotted section names provide grouping by
convention), no multi-line values, and no anchors/references.

## 2. Lexical conventions

### 2.1 Encoding

UTF-8. Implementations SHOULD normalise input to NFC before parse.

### 2.2 Line endings

LF (`\n`). CRLF MUST be normalised to LF on read. A KVX document is a sequence
of lines; there are no multi-line constructs.

### 2.3 Comments

`#` begins a comment that runs to end of line, **unless** the `#` appears
inside a double-quoted string:

```kvx
key = value        # this is a comment
msg = "issue #42"  # the first # is data, this one is a comment
```

Comments are ignored by the data model and MUST be stripped before canonical
rendering and hashing.

### 2.4 Blank lines

Allowed anywhere. Ignored by the parser.

### 2.5 Whitespace

Leading and trailing whitespace on a line is insignificant. Whitespace around
the `=` separator and around list commas is insignificant. Whitespace inside
double-quoted strings is significant.

## 3. Document structure

A document is a sequence of **section headers** and **key/value pairs**.

### 3.1 Sections

```kvx
[meta]
[scalar.AccountId]
[task.1.1]
```

A section header is `[` *name* `]` alone on a line. The section name grammar is:

```
section_name = name_seg { "." name_sub }
name_seg     = ( LETTER | "_" ) { LETTER | DIGIT | "_" | "-" }
name_sub     = ( LETTER | DIGIT | "_" | "-" ) { LETTER | DIGIT | "_" | "-" }
```

Names are case-sensitive. Dots produce **dotted section names**. Segments
after the first may be purely numeric (`[req.1]`, `[task.1.2]`, `[message.7]`).

Dotted names are flat to the data model — `[scalar.AccountId]` is a single
section whose name contains a dot — but they carry a grouping **convention**:
sections sharing a prefix form a table. Implementations SHOULD expose a
prefix query (see §6) and SHOULD order numeric sub-IDs numerically
(`1, 1.2, 1.10, 2` — not lexically) when sorting.

A section MAY be re-opened later in the file; keys accumulate. The section's
position in document order is its **first** occurrence.

Every key/value pair belongs to the most recently opened section. Pairs before
any section header belong to the **root section**, whose name is the empty
string. Producers SHOULD NOT rely on the root section; it exists for
robustness.

### 3.2 Key/value pairs

```kvx
name            = "Codify Workflow"
contract_major  = 1
values          = ["node_info", "submit", "receipt_lookup"]
source_of_truth = spec/ (kvx). Generated files are pointers.
```

One pair per line: everything before the **first** `=` is the key (trimmed),
everything after (trimmed, comment-stripped) is the value token.

Keys are non-empty and SHOULD match `[A-Za-z0-9_.-]+`. Keys are unique within
a section; when a key repeats, the **last occurrence wins** and the key keeps
its original position in key order.

A non-blank, non-comment line that is neither a section header nor contains
`=` is a **parse error**.

## 4. Values

The value token is stored raw. Three surface forms exist:

### 4.1 Bare scalars

Any run of characters up to end of line / unquoted `#`. Applications
conventionally layer these interpretations:

- **integer** — `42`, `1` (`contract_major = 1`)
- **boolean** — `true` / `false` / `1` / `0` / `yes` / `no`
- **everything else** — an opaque string (paths, URIs, expressions such as
  `version:u8 || operation:u8`, prose)

### 4.2 Quoted strings

Double-quoted: `"value"`. A quoted value may contain `#`, `,`, `[`, `]`, and
`=` as data. The surrounding quotes are removed on access. There are no
escape sequences in KVX 1.0; a value must not contain a double quote or a
newline. (Escapes are reserved for a future minor revision.)

### 4.3 Lists

Bracketed, comma-separated:

```kvx
tags   = ["writing", "planning"]
values = ["node_info","submit","receipt_lookup"]
mixed  = [a, "b, with comma", c]
```

Commas inside double-quoted items do not split. Items are trimmed and
unquoted individually. An empty list is `[]`. Accessing a scalar value as a
list yields a one-element list (accessor-level convenience, not grammar).

Lists do not nest in KVX 1.0.

### 4.4 Environment interpolation

`${NAME}` references, where `NAME` matches `[A-Za-z_][A-Za-z0-9_]*`, are
replaced with the value of the environment variable `NAME` **at access time**
(empty string when unset). Interpolation applies to scalars, quoted strings,
and list items. The raw (uninterpolated) token is what participates in
canonical form and hashing.

## 5. Canonical form and hashing

The canonical form of a document is produced by:

1. stripping all comments and blank lines,
2. emitting sections in document order, each as `[name]` on its own line
   (the root section, if non-empty, is emitted first with no header),
3. emitting each section's keys in key order as `key = value` — exactly one
   space around `=`, raw value token (no unquoting, no interpolation),
4. separating consecutive sections with exactly one blank line, and
5. terminating every line with LF.

Canonical rendering is a **fixed point**: parsing the canonical form and
re-rendering it MUST yield identical bytes.

The **document hash** is the SHA-256 of the canonical form's UTF-8 bytes.
Because comments and cosmetic whitespace are erased, the hash is stable
across purely cosmetic edits.

## 6. Required accessor surface

A conforming implementation exposes at least:

| Accessor | Semantics |
|---|---|
| `Has(section)` | section presence |
| `Sections()` | section names in document order |
| `SectionsWithPrefix(p)` | sub-names of sections named `p.…`, in document order |
| `Keys(section)` | keys in key order |
| `Str(section, key)` | unquoted, interpolated string; `""` when absent |
| `Bool(section, key, fallback)` | `true`/`1`/`yes` → true; absent → fallback |
| `List(section, key)` | list items, unquoted + interpolated; scalar → 1-element list |
| `Raw(section, key)` | raw value token, no unquoting/interpolation |
| `Canonical()` | canonical form (§5) |
| `Hash()` | SHA-256 of canonical form (§5) |

## 7. Conformance

The repository ships a language-agnostic corpus under `testdata/`:

- `testdata/valid/*.kvx` — MUST parse; canonical rendering MUST be a fixed
  point.
- `testdata/invalid/*.kvx` — MUST be rejected with an error naming the file
  and line number.

An implementation is conformant when it passes the full corpus and satisfies
§5 and §6.

## 8. Versioning

This spec is versioned independently of implementations. Within major
version 1, revisions may only broaden the accepted grammar (e.g. adding
string escapes) — a document valid under 1.0 remains valid and keeps its
canonical form and hash under every 1.x. Any change that alters the canonical
form of an existing document requires a major version bump.

## 9. Relation to the Argus language (`.agi`)

KVX has a sibling: **Argus** (`.agi`, formerly CentraScript/`.mtx`), a
declarative language with `§SECTION` headers, typed slot declarations, and
block structure. Argus evolved from an early dense key/value dialect that
also used the `.kvx` extension (ALLCAPS section lines, `k=v`, pipe-separated
cells — the `MATRIX.CTX` family). That dialect is **not** KVX 1.0; it is
specified as the legacy data profile of Argus. Files in that form should be
migrated to `.agi` or to KVX 1.0.
