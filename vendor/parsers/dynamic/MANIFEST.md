# Dynamic language parser sources

The generated grammar sources here are compiled into `cg`. A checkout with
these files builds and indexes without fetching packages or running generators.

| Language | Upstream source revision | Grammar | License |
| --- | --- | --- | --- |
| Python | `tree-sitter/tree-sitter-python@26855eabccb19c6abf499fbc5b8dc7cc9ab8bc64` | `python/parser.c`, `python/scanner.c` | MIT, `python/LICENSE` |
| Ruby | `tree-sitter/tree-sitter-ruby@ad907a69da0c8a4f7a943a7fe012712208da6dee` | `ruby/parser.c`, `ruby/scanner.c` | MIT, `ruby/LICENSE` |
| PHP | `tree-sitter/tree-sitter-php@58d5643086ae60e93a3746cca648363ee97c8761` | `php/parser.c`, `php/scanner.c` (`php` grammar) | MIT, `php/LICENSE` |

`node-types.json` beside each parser is retained to make the adapter's syntax
contract reviewable. The parser ABI is 15 for Python/PHP and 14 for Ruby.
Each grammar retains its generated `tree_sitter` headers because their parser
layouts differ by ABI. The PHP common scanner header is copied into `common/`;
its relative include paths and the PHP scanner's include path are adjusted to
the vendored layout without changing scanner behavior.
