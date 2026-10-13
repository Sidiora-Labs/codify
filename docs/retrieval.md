# Retrieval: search, symbol, show, context, files

How `cg search`, `cg symbol`, `cg show`, `cg context` and `cg files` decide
what to answer with, and in what order. The code lives in `src/graph.c`,
and `cg files` and the shared filters live in `src/files.c`. The
parsing it relies on is in `src/lang.c`, and the resolution in
`src/resolve.c`.

## Declarations

A C or C++ prototype (`int memory_export(Store *s, FILE *out);`) is
recorded as a symbol with `decl=1`. Its span ends at its own `;`, even when
the parameter list runs over several lines. Before schema v17 a multi-line
prototype ran on to the next definition or the end of the file. Every
reference inside that span was then filed under the prototype, which
produced phantom callers such as "memory_export calls store_close" from a
header.

- **The parser** (`callable_end` in `src/lang.c`) follows the parameter
  list's parentheses across lines. After the list closes, a `;` makes the
  symbol a declaration and a `{` makes it a definition, whose body is then
  brace-matched. A pure virtual `= 0;` is a declaration too. A line that
  starts with `return`, `else`, `case` and similar is a statement, not a
  prototype, even at column 0.
- **Attribution** never files a reference or an inline comment under a
  declaration. A declaration has no body.
- **Resolution** first resolves a call through the usual tiers (same file,
  import, same directory, unique). If the winner is a declaration, the call
  goes to its definition instead, chosen in this order:
  1. the one in the file with the header's stem (`store.h` → `store.c`)
  2. else the single non-static definition, or the first one when they all
     sit in one file as `#ifdef` alternatives
  3. else the single definition

  If none of these applies, the call stays on the prototype. Callers,
  reference counts and impact therefore land on the function that runs.
- **Answers** list the definition first, in `defs_named`, `find_symbols`
  and every caller of theirs. When the definition has no doc of its own,
  `symbol_doc` uses the prototype's doc. `cg anchors --uncovered` counts a
  definition documented at its prototype as covered.
- **Soft edges**: prose in a prototype's doc still creates soft edges, but
  they come from no symbol. A prototype calls nothing.
- **JSON**: `"decl": true` marks a declaration row in `symbol --json` and
  in every `json_sym` row.

## Phrase queries

`rank_query` ranks the hits for both `search` and `context`.

1. **The query becomes words.** Stopwords are dropped ("how does the",
   "of", "to"), and identifiers are split by `name_words`: snake_case,
   camelCase, PascalCase, digit runs, and `HTTPServer` → `http server`.
   At most 8 words are kept.
2. **Names.** `symbol_fts` has a `words` column holding each name's split
   words. `"export memory"` therefore matches `memory_export` and
   `exportMemory` through the index, with no `LIKE` scan. The lookup runs
   an all-words pass first, then one pass per word. An exact name match
   always leads.
3. **Docs.** `comment_fts` (doc comments) is matched with the same words.
4. **Bodies.** `body_fts` returns the files whose text holds the words: an
   AND pass, then an OR pass. Each file is read once. The line holding the
   most query words becomes that file's hit, and each line's words are
   credited to the innermost definition that contains it.
5. **Prototypes fold** into their definitions, which pick up the
   prototype's name, doc and body credit.
6. **Score.** For each query word, a symbol earns the best of:
   - 300 if its name carries the word
   - 120 if its doc does
   - 40 if its body does

   It then adds:
   - 40 per distinct word it carries
   - 150 when it carries every word and its name carries at least one (a
     doc that merely mentions every word must not outrank a name that is
     one of them)
   - 100 when its name carries every word
   - a small bonus for callables, classes and structs
   - up to 40 for being referenced

   Paths under tests, fixtures, mocks, `generated`, `dist`, `*_pb2.py`,
   `*.pb.*`, `*.min.*` and `*.generated.*` lose 250.

File hits sort source first, then by how many query words the line holds,
then by full-text rank. Text output shows the matching line beside the
path:

```
— full-text matches —
  src/store.c:14  int memory_export(Store *s, FILE *out) {
  src/main.c:8  int n = memory_export(s, stdout);
  tests/test_store.c:6  /* export memory round trip: ... */
```

In JSON, each file hit gains a `text` key. Every existing key is unchanged.

## Path queries

When the context query names an indexed file (`src/store.h`,
`./src/store.h`, or a basename such as `store.h` that only one file has),
`context_path_outline` answers with the file's outline instead of a phrase
search. The outline holds:

- the purpose line (the first line of the file's header comment)
- every symbol with its kind, line and signature (a prototype reads `proto` in the text outline and carries `"decl":true` in `--json`)
- the file's imports
- its dependents: files whose calls resolve into it, plus files whose
  imports name it

A directory (`src`, `src/`) gets its indexed files, each with its purpose
line, symbol count and line count. When those files overflow the budget
and the directory has subdirectories, the outline becomes a map: the
immediate subdirectories first, each with its file, symbol and line
counts, then the directory's own files, then deeper ones, as many as fit,
with the omitted count. A small directory still gets the flat list.

Imports and dependents are measured before the symbol list, so a long file
cannot crowd them out. A purpose line that would leave no room for the
answer's skeleton is dropped and counted as omitted.

JSON shapes:

```
{"query","path","kind":"file","lines","purpose","symbols":[…],
 "imports":[…],"dependents":[…],"tokens_used","budget","omitted"}
{"query","path","kind":"dir","files":[{"path","purpose","symbols","lines"}],
 "tokens_used","budget","omitted"}
{"query","path","kind":"dir","subdirs":[{"path","files","symbols","lines"}],
 "files":[…],"tokens_used","budget","omitted"}        (the map form)
```

## Filters: --path, --lang, --no-tests

`cg search`, `cg context`, `cg survey` and `cg files` take the same three
filters, parsed once (`query_filter_parse` in `src/files.c`):

- `--path GLOB`, repeatable, any one matching. A plain path is that file or
  anything under that directory (`--path src/net`). In a glob, `*` and `**`
  both cross `/` (`src/**/*.go` and `src/*.go` match the same paths), and
  a glob without a `/` also matches basenames at any depth
  (`--path '*_test.go'`).
- `--lang L`: one language, in the spelling `files.lang` uses (`c`,
  `python`, `typescript`, `go`, ...). An extension (`py`, `ts`, `h`) is
  translated through the same table the indexer uses.
- `--no-tests`: drop every file `graph_path_is_test` calls a test.

The filter is applied inside the SQL, not after it. `prep_scoped` splices
`query_filter_sql` beside the branch predicate, so the symbol, doc and body
passes of the ranking, the directory outline and survey's file list all
narrow before `LIMIT` and before ranking. A narrowed query never reads
more rows than the wide one. Callers and callees, which are read through
the reference join, are filtered on the way out. Over MCP, `search_code`
and `get_context` take `path` (a string or a list), `lang` and `no_tests`.

## Finding files: cg files

`cg files` answers from the `files` table, without walking the disk:

```
cg files 'src/**/*.c'       # a glob over paths
cg files sync gate          # the words of the path
cg files src                # a directory: subdirectories, then its files
cg files --dirs             # the map: directories with counts
```

- **A glob** (any of `*?[`) matches paths the way `--path` does.
- **Words** match the words of the path's segments. `file_fts` holds
  `name_words(path)` under the trigram tokenizer, so `sync gate` finds
  `syncgate.c` and `sync_gate.py`. Ranking is by match quality: a whole
  word of the basename beats part of one, which beats a directory segment.
  A path that carries every word in its basename leads, and ties sort by
  path.
- **A bare directory** lists its subdirectories with file and line counts,
  then its own files.

Each row prints the path, language, lines and symbol count. At most `-n N`
rows are printed (40 by default), and a tail line names how many were
left out.

`--dirs [prefix]` aggregates instead. It lists every directory down to
`--depth N` (default 2) below the prefix, with its file count, line count
and dominant language (by lines), largest first and nested under its
parent, so a tree of a million files reads as a map. The filters apply to
both forms (`cg files --dirs --lang go`).

JSON shapes:

```
{"mode":"glob"|"words","pattern","files":[{"path","lang","lines","symbols"}],
 "total","omitted"}
{"mode":"dir","path","dirs":[{"path","files","lines"}],"files":[…],
 "total","omitted"}
{"mode":"dirs","prefix","depth","files","lines","lang",
 "dirs":[{"path","depth","files","lines","lang"}],"omitted"}
```

Over MCP the tool is `find_files` (pattern, dirs, depth, lang, limit). It
is read-only.

The indexer writes `file_fts` beside the `files` row, once, when the row
first appears, since a row keeps its path for life. The entry is deleted
with the row.

## The budget

`--budget N` tokens is about 4N bytes, and the whole response counts,
including the closing `tokens_used`/`budget`/`omitted` keys.

- **Free-text answers** expand every hit, not only the top three: a doc,
  or else opening lines. Each hit's opening lines grow with its share of
  the room left, up to 60. A sixth of the budget is held back for entry
  points and files.
- **Documented hits** keep doc plus signature. `cg show --full` is the deep
  view.
- **Callers and callees** are attached only to the top three hits.
- **What does not fit** is counted. Each section carries an `omitted`
  marker, and `--json` ends with the total.
- **The minimum budget** is 64 tokens. Below that, the answer's skeleton
  alone would not fit, so the budget is raised and the output reports
  64.

## Cost

A first `cg context` on Codify's own tree (about 250 files and 20k refs)
used to spend most of its time on full scans of `refs` for "who resolved
to this symbol". Callers, reference counts, entry-point climbs and
dependents all ask that question. `idx_ref_target` makes each one an index
lookup. The index is created after the schema upgrade, because an older
`refs` table without `target_id` would refuse it. The body pass no longer
sends single letters or prefix-matched two-letter words to `body_fts`.
`"c" *` on a path query was the slowest single query. A path query now
goes straight to the outline.
