# Native syntax runtime

Upstream: https://github.com/tree-sitter/tree-sitter

Release: `v0.25.9`  
Commit: `a467ea8502d95562171f97953a6dc5b2a8622609`

The vendored `lib/src` and `lib/include/tree_sitter/api.h` compile into the
`cg` executable. `lib/include/tree_sitter/parser.h` is a copy of the runtime's
parser ABI header for generated grammar C sources. The upstream root licence
is retained as `LICENSE`; the bundled Unicode notice is retained under
`lib/src/unicode/LICENSE`.

Grammar families under `vendor/parsers` keep separate revision and licence
records. The checkout builds offline; no parser process or package manager is
needed at runtime.
