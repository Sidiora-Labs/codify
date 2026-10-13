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

## Line search: cg grep

`cg grep <pattern>` answers "where does this string occur" — the question
an agent otherwise asks `grep` or `rg` — with each hit placed in the graph.
The code is `src/grep.c`; over MCP it is the `grep_code` tool, which takes
the same parameters (`pattern`, `regex`, `case_sensitive`, `path`, `lang`,
`symbol`, `kind`, `no_tests`, `context`, `limit`, `budget`, `files`,
`count`) and answers with the `--json` object.

**Matching.** The pattern is a literal substring by default and a POSIX
extended regular expression (libc `regcomp`) with `-E`/`--regex`. Both are
case-sensitive unless `-i` is given.

**Candidates.** `body_tri` is a trigram FTS5 table over every indexed file
body. It is contentless, with `detail=none`, and its rowid is `files.id`.
The indexer writes it beside `body_fts`. On SQLite older than 3.43,
which cannot delete from a contentless table, it keeps its content, and
meta `fts_mode` records which form was built. grep takes the literal a
match must contain: the whole pattern for a literal, or the longest
metacharacter-free run for a regex. A character followed by `*`, `?` or `{`
is optional and leaves the run, and any `|` means no run is required. It
then asks for every trigram of that literal, each on its own, because
`detail=none` refuses phrase queries. The files that hold all of them,
within the branch scope (`--branch`, `--all-branches`), are the
candidates. A pattern with no three-character literal skips this step:
every indexed file of the scope is scanned, and the summary says so. The
index only narrows the search. A candidate that does not match costs a
read, never a wrong hit.

**The completeness guard.** A candidate list is only as good as the table
behind it. A graph whose `body_tri` was created after its files were
indexed (the table added to a database already at its schema version), or
whose write was cut short, holds fewer rows than files, and the files
without a row would never be candidates: a silent miss. So before it asks
the index, grep compares `body_tri`'s row count with the count of indexed
files that carry a body (at most 2 MB; files the indexer skipped have no
`files` row and do not count). When the table is short, grep counts the
scope file by file and, if any file in scope lacks its row, scans every
file in scope instead. The summary says
`full scan — body_tri incomplete (N of M files); the next cg sync repairs it`
and `--json` carries `"full_scan":"body_tri incomplete"` with
`"body_tri":{"rows":N,"files":M}`. The guard clears itself: every whole-tree
index pass (`cg sync`, `cg index`, and the freshness pass a read command
runs) makes the same comparison, re-reads the open branch's files that have
no row, inserts them (at most 50,000 a pass), and reports
`N trigram rows repaired`. `cg index --full` rebuilds every row regardless.

**Scanning.** Candidates are read from disk, in that branch's worktree, by
parallel workers. Their count is the machine's index worker budget,
bounded by the number of candidates. A literal is found with `memmem`
(over a lowercased copy under `-i`) and a regex with `regexec`, one hit per
line. Hits are what the file holds now, so an edit made since the last sync
is found in any file the index already names. `cg grep` also runs the same
freshness pass as the other read commands before it starts. A file the
indexer would not read (binary, or larger than 8 MB) or whose body it does
not index (larger than 2 MB) is not searched. Each one is counted as
`skipped`.

**Placement and ranking.** For each file with hits, one query loads its
symbol spans (definitions only, not prototypes). Each hit is placed in the
innermost span that holds it, or in `(file scope)` when none does.
`--symbol NAME` keeps only hits inside a span of that name, and `--kind K`
only hits inside spans of that kind. `--path GLOB` (repeatable), `--lang`
(a language name or an extension) and `--no-tests` filter the files through
the same `QueryFilter` that search, context, survey and files use
(`query_filter_parse`, applied inside the candidate query by
`query_filter_sql`), so a glob selects the same files on every command. Files are ranked by hit count, then
source before tests, then shallower paths first.

**Output.** Hits are grouped by file. The enclosing symbol is named once
for each run of hits inside it, and each hit is written as
`path:line: text`. `-C N` adds context lines (`path-N- text`). The answer
stops at `-n` hits (default 50) or at the `--budget` (default 4000 tokens),
whichever comes first, and ends with the tail:

```
… 3 more hits in 2 files — narrow with --path or raise -n
5 hits in 2 files · 2 candidates of 14 indexed files · 2 scanned · 0 skipped · 1 ms
```

`--files` lists only the matching files with their counts, and `--count`
prints only the total. The `--json` object is:

```
{"query","regex","case_sensitive","candidates","scanned","skipped",
 "indexed","full_scan","body_tri"?,"total","files_with_hits",
 "hits":[{"path","line","text","symbol","kind","branch"?,"before"?,"after"?}],
 "omitted","omitted_files","ms"}
```

`full_scan` is false when the index narrowed, true when the pattern has
no trigram (or the index could not answer), and `"body_tri incomplete"`
when the completeness guard fired. `symbol` and `kind` are null for file
scope. `branch` is present when more
than one branch is in scope. `before` and `after` are present with
`context`. With `--files`, `hits` is replaced by `files:[{"path","count"}]`.

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
