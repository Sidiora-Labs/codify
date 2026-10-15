# Extended syntax parsers

Each subdirectory has generated grammar source, its licence, a source revision in
`PROVENANCE`, and the grammar's node description. The generated C parser and
scanner are compiled into the executable. No parser service or package is used
while indexing.

| Language | Grammar directory | Structural facts emitted | Current boundary |
| --- | --- | --- | --- |
| Lua | `lua` | Functions, local variables, direct calls | Dynamic table dispatch remains unresolved. |
| Luau | `luau` | Functions, methods, local variables, type aliases, direct calls | Runtime type refinements are not inferred. |
| R | `r` | Assignment-defined functions and variables, direct calls | Nonstandard evaluation is not resolved. |
| Erlang | `erlang` | Modules, records, function clauses, direct calls | Runtime messaging and dynamic module calls are not resolved. |
| Solidity | `solidity` | Contracts, functions, events, modifiers, state variables, inheritance, direct calls | Dynamic dispatch and deployed contract targets are unresolved. |
| Terraform | `hcl` | Blocks, attributes, variable and function references | Provider values and computed expressions remain unresolved. |
| Nix | `nix` | Attribute bindings, function bindings, direct application and variable references | Laziness and dynamic attribute selection are not evaluated. |

Coverage is structural for the listed facts. Syntax errors, missing grammar
fields and unknown dynamic targets must be reported by the shared extraction
and resolution layers rather than converted into asserted edges.
