# Source reference: C core: graph and index

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the parsers and semantic passes (`src/ast*`, `src/sem_*`, `src/semantic.*`), the graph and its schema (`src/graph.c`, `src/db.c`), scanning, walking, language detection and resolution (`src/scan.c`, `src/walk.c`, `src/lang.c`, `src/resolve.c`, `src/routes.c`), file and line search (`src/files.c`, `src/grep.c`), the watcher, the sync gate, progress output and the index, watch and answer health records: 1071 declarations in 48 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## src/answer_health.c

[Open source](../../src/answer_health.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AH_FILES` | macro | 8 | <code>#define AH_FILES 16</code> |
| `AH_BYTES` | macro | 9 | <code>#define AH_BYTES (4 &#42; 1024 &#42; 1024)</code> |
| `AH_FILE_BYTES` | macro | 10 | <code>#define AH_FILE_BYTES (1024 &#42; 1024)</code> |
| `AH_MS` | macro | 11 | <code>#define AH_MS 25</code> |
| `StatusCall` | typedef | 13 | <code>typedef struct { Cg &#42;cg; } StatusCall;</code> |
| `status_call` | function | 14 | <code>static int status_call(void &#42;v) { return cmd_status(((StatusCall &#42;)v)-&gt;cg, true); }</code> |
| `table_exists` | function | 16 | <code>static bool table_exists(Cg &#42;cg, const char &#42;name) {</code> |
| `selected_branch` | function | 25 | <code>static long selected_branch(Cg &#42;cg) {</code> |
| `branch_name` | function | 29 | <code>static void branch_name(Cg &#42;cg, long id, char &#42;out, size_t cap) {</code> |
| `safe_path` | function | 40 | <code>static bool safe_path(const char &#42;p) {</code> |
| `validate_file` | function | 49 | <code>static const char &#42;validate_file(const char &#42;root, const char &#42;path,</code> |
| `get_paths` | function | 78 | <code>static int get_paths(const char &#42;json, char paths&#91;AH_FILES&#93;&#91;4096&#93;,</code> |
| `answer_health_append` | function | 103 | <code>void answer_health_append(StrBuf &#42;out, Cg &#42;cg, const char &#42;answer) {</code> |
| `answer_health_json` | function | 239 | <code>char &#42;answer_health_json(Cg &#42;cg, const char &#42;answer) {</code> |
| `answer_health_query_budget` | function | 254 | <code>int answer_health_query_budget(int requested) {</code> |
| `replace_number` | function | 261 | <code>static char &#42;replace_number(const char &#42;json, const char &#42;key, long value) {</code> |
| `final_tokens` | function | 277 | <code>static char &#42;final_tokens(char &#42;json) {</code> |
| `answer_health_json_limit` | function | 287 | <code>char &#42;answer_health_json_limit(Cg &#42;cg, const char &#42;answer, size_t max_bytes) {</code> |
| `answer_health_status` | function | 415 | <code>int answer_health_status(Cg &#42;cg, bool json) {</code> |
| `answer_health_text` | function | 429 | <code>void answer_health_text(Cg &#42;cg) {</code> |
| `answer_health_capture_begin` | function | 448 | <code>void answer_health_capture_begin(AnswerCapture &#42;cap, size_t max_bytes) {</code> |
| `answer_health_capture_end` | function | 464 | <code>void answer_health_capture_end(AnswerCapture &#42;cap, Cg &#42;cg) {</code> |

## src/answer_health.h

[Open source](../../src/answer_health.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_ANSWER_HEALTH_H` | macro | 2 | <code>#define CG_ANSWER_HEALTH_H</code> |
| `answer_health_json` | function | 8 | <code>char &#42;answer_health_json(Cg &#42;cg, const char &#42;answer);</code> |
| `answer_health_json_limit` | function | 9 | <code>char &#42;answer_health_json_limit(Cg &#42;cg, const char &#42;answer, size_t max_bytes);</code> |
| `answer_health_query_budget` | function | 10 | <code>int answer_health_query_budget(int requested);</code> |
| `answer_health_status` | function | 11 | <code>int answer_health_status(Cg &#42;cg, bool json);</code> |
| `answer_health_append` | function | 12 | <code>void answer_health_append(StrBuf &#42;out, Cg &#42;cg, const char &#42;answer);</code> |
| `answer_health_text` | function | 13 | <code>void answer_health_text(Cg &#42;cg);</code> |
| `AnswerCapture` | typedef | 15 | <code>typedef struct { int saved_stdout; FILE &#42;stream; size_t max_bytes; } AnswerCapture;</code> |
| `answer_health_capture_begin` | function | 16 | <code>void answer_health_capture_begin(AnswerCapture &#42;cap, size_t max_bytes);</code> |
| `answer_health_capture_end` | function | 17 | <code>void answer_health_capture_end(AnswerCapture &#42;cap, Cg &#42;cg);</code> |

## src/ast.c

[Open source](../../src/ast.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AST_MAX_ADAPTERS` | macro | 7 | <code>#define AST_MAX_ADAPTERS 96</code> |
| `AST_MAX_SOURCE` | macro | 8 | <code>#define AST_MAX_SOURCE (32u &#42; 1024u &#42; 1024u)</code> |
| `AST_MAX_NODES` | macro | 9 | <code>#define AST_MAX_NODES 500000u</code> |
| `AST_MAX_DEPTH` | macro | 10 | <code>#define AST_MAX_DEPTH 512u</code> |
| `AST_TIMEOUT_US` | macro | 11 | <code>#define AST_TIMEOUT_US 2000000u</code> |
| `project_semantic` | function | 17 | <code>static void project_semantic(ParseResult &#42;result) {</code> |
| `collect_comment` | function | 82 | <code>static bool collect_comment(AstContext &#42;ctx, TSNode node, void &#42;unused) {</code> |
| `scan_routes` | function | 142 | <code>static void scan_routes(AstContext &#42;ctx) {</code> |
| `ast_web_register` | function | 161 | <code>extern void ast_web_register(void) __attribute__((weak));</code> |
| `ast_systems_register` | function | 162 | <code>extern void ast_systems_register(void) __attribute__((weak));</code> |
| `ast_dynamic_register` | function | 163 | <code>extern void ast_dynamic_register(void) __attribute__((weak));</code> |
| `ast_managed_register` | function | 164 | <code>extern void ast_managed_register(void) __attribute__((weak));</code> |
| `ast_extended_register` | function | 165 | <code>extern void ast_extended_register(void) __attribute__((weak));</code> |
| `ast_mixed_register` | function | 166 | <code>extern void ast_mixed_register(void) __attribute__((weak));</code> |
| `register_families` | function | 168 | <code>static void register_families(void) {</code> |
| `ast_register` | function | 177 | <code>bool ast_register(const AstAdapter &#42;adapter) {</code> |
| `ast_register_all` | function | 187 | <code>void ast_register_all(void) { pthread_once(&amp;registry_once, register_families); }</code> |
| `ast_adapter` | function | 189 | <code>const AstAdapter &#42;ast_adapter(const char &#42;language) {</code> |
| `ast_field` | function | 197 | <code>TSNode ast_field(TSNode node, const char &#42;field) {</code> |
| `ast_slice` | function | 203 | <code>char &#42;ast_slice(const AstContext &#42;ctx, uint32_t start, uint32_t end) {</code> |
| `ast_text` | function | 212 | <code>char &#42;ast_text(const AstContext &#42;ctx, TSNode node) {</code> |
| `ast_line` | function | 217 | <code>int ast_line(TSNode node) { return (int)ts_node_start_point(node).row + 1; }</code> |
| `ast_column` | function | 218 | <code>int ast_column(TSNode node) { return (int)ts_node_start_point(node).column; }</code> |
| `ast_walk` | function | 222 | <code>void ast_walk(AstContext &#42;ctx, TSNode root, AstVisitFn visit, void &#42;user) {</code> |
| `ast_try_parse_ex` | function | 259 | <code>bool ast_try_parse_ex(const char &#42;language, const char &#42;path,</code> |
| `ast_try_parse` | function | 329 | <code>bool ast_try_parse(const char &#42;language, const char &#42;path, const char &#42;source,</code> |

## src/ast.h

[Open source](../../src/ast.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_AST_H` | macro | 2 | <code>#define CG_AST_H</code> |
| `AstContext` | struct | 10 | <code>typedef struct AstContext {</code> |
| `AstAdapter` | struct | 22 | <code>typedef struct AstAdapter {</code> |
| `ast_register` | function | 31 | <code>bool ast_register(const AstAdapter &#42;adapter);</code> |
| `ast_adapter` | function | 32 | <code>const AstAdapter &#42;ast_adapter(const char &#42;language);</code> |
| `ast_register_all` | function | 33 | <code>void ast_register_all(void);</code> |
| `ast_try_parse` | function | 34 | <code>bool ast_try_parse(const char &#42;language, const char &#42;path, const char &#42;source,</code> |
| `ast_try_parse_ex` | function | 36 | <code>bool ast_try_parse_ex(const char &#42;language, const char &#42;path,</code> |
| `AstVisitFn` | typedef | 43 | <code>typedef bool (&#42;AstVisitFn)(AstContext &#42;ctx, TSNode node, void &#42;user);</code> |
| `ast_walk` | function | 44 | <code>void ast_walk(AstContext &#42;ctx, TSNode root, AstVisitFn visit, void &#42;user);</code> |
| `ast_field` | function | 45 | <code>TSNode ast_field(TSNode node, const char &#42;field);</code> |
| `ast_text` | function | 46 | <code>char &#42;ast_text(const AstContext &#42;ctx, TSNode node);</code> |
| `ast_slice` | function | 47 | <code>char &#42;ast_slice(const AstContext &#42;ctx, uint32_t start, uint32_t end);</code> |
| `ast_line` | function | 48 | <code>int ast_line(TSNode node);               /&#42; one-based &#42;/</code> |
| `ast_column` | function | 49 | <code>int ast_column(TSNode node);             /&#42; zero-based byte column &#42;/</code> |

## src/ast_dynamic.c

[Open source](../../src/ast_dynamic.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tree_sitter_python` | function | 7 | <code>extern const TSLanguage &#42;tree_sitter_python(void);</code> |
| `tree_sitter_ruby` | function | 8 | <code>extern const TSLanguage &#42;tree_sitter_ruby(void);</code> |
| `tree_sitter_php` | function | 9 | <code>extern const TSLanguage &#42;tree_sitter_php(void);</code> |
| `DynWalk` | typedef | 11 | <code>typedef struct { AstContext &#42;ctx; int owner; } DynWalk;</code> |
| `first_named` | function | 12 | <code>static TSNode first_named(TSNode n);</code> |
| `is` | function | 14 | <code>static bool is(TSNode n, const char &#42;s) {</code> |
| `span` | function | 18 | <code>static SemSpan span(TSNode n) {</code> |
| `text` | function | 24 | <code>static char &#42;text(AstContext &#42;c, TSNode n) {</code> |
| `short_name` | function | 28 | <code>static char &#42;short_name(const char &#42;s) {</code> |
| `qualified` | function | 36 | <code>static char &#42;qualified(SemResult &#42;r, int owner, const char &#42;name) {</code> |
| `decorators_text` | function | 45 | <code>static char &#42;decorators_text(AstContext &#42;ctx, TSNode wrapper) {</code> |
| `python_signature` | function | 58 | <code>static char &#42;python_signature(AstContext &#42;ctx, TSNode declaration, TSNode body) {</code> |
| `add_symbol` | function | 82 | <code>static int add_symbol(DynWalk &#42;w, TSNode node, TSNode name_node,</code> |
| `add_ref` | function | 108 | <code>static void add_ref(DynWalk &#42;w, TSNode site, TSNode target, TSNode receiver,</code> |
| `add_read` | function | 133 | <code>static void add_read(DynWalk &#42;w, TSNode node) {</code> |
| `add_binding` | function | 146 | <code>static void add_binding(DynWalk &#42;w, TSNode site, const char &#42;module,</code> |
| `add_type` | function | 157 | <code>static void add_type(DynWalk &#42;w, TSNode site, TSNode variable, TSNode type_node,</code> |
| `add_relation` | function | 175 | <code>static void add_relation(AstContext &#42;ctx, int owner, TSNode site,</code> |
| `add_relation_children` | function | 187 | <code>static void add_relation_children(AstContext &#42;ctx, int owner, TSNode list,</code> |
| `literal_string` | function | 197 | <code>static char &#42;literal_string(AstContext &#42;ctx, TSNode node) {</code> |
| `python_channel` | function | 210 | <code>static void python_channel(DynWalk &#42;w, TSNode call, TSNode callee, TSNode args) {</code> |
| `first_named` | function | 242 | <code>static TSNode first_named(TSNode n) {</code> |
| `python_import` | function | 246 | <code>static void python_import(DynWalk &#42;w, TSNode node) {</code> |
| `php_import` | function | 274 | <code>static void php_import(DynWalk &#42;w, TSNode node) {</code> |
| `ruby_import` | function | 309 | <code>static void ruby_import(DynWalk &#42;w, TSNode node) {</code> |
| `python_doc_node` | function | 330 | <code>static TSNode python_doc_node(TSNode body) {</code> |
| `python_capture_doc` | function | 337 | <code>static void python_capture_doc(AstContext &#42;ctx, TSNode node) {</code> |
| `preceding_comment` | function | 352 | <code>static char &#42;preceding_comment(AstContext &#42;c, TSNode n) {</code> |
| `py_decorators` | function | 365 | <code>static TSNode py_decorators(TSNode n) {</code> |
| `walk` | function | 370 | <code>static void walk(DynWalk &#42;w, TSNode n, unsigned depth) {</code> |
| `extract` | function | 549 | <code>static void extract(AstContext &#42;ctx) {</code> |
| `ast_dynamic_register` | function | 554 | <code>void ast_dynamic_register(void) {</code> |

## src/ast_extended.c

[Open source](../../src/ast_extended.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tree_sitter_lua` | function | 9 | <code>extern const TSLanguage &#42;tree_sitter_lua(void);</code> |
| `tree_sitter_luau` | function | 10 | <code>extern const TSLanguage &#42;tree_sitter_luau(void);</code> |
| `tree_sitter_r` | function | 11 | <code>extern const TSLanguage &#42;tree_sitter_r(void);</code> |
| `tree_sitter_erlang` | function | 12 | <code>extern const TSLanguage &#42;tree_sitter_erlang(void);</code> |
| `tree_sitter_solidity` | function | 13 | <code>extern const TSLanguage &#42;tree_sitter_solidity(void);</code> |
| `tree_sitter_hcl` | function | 14 | <code>extern const TSLanguage &#42;tree_sitter_hcl(void);</code> |
| `tree_sitter_nix` | function | 15 | <code>extern const TSLanguage &#42;tree_sitter_nix(void);</code> |
| `is` | function | 17 | <code>static int is(TSNode n, const char &#42;type) {</code> |
| `named` | function | 20 | <code>static TSNode named(TSNode n, unsigned i) { return ts_node_named_child(n, i); }</code> |
| `span` | function | 21 | <code>static SemSpan span(TSNode n) {</code> |
| `first_named` | function | 27 | <code>static TSNode first_named(TSNode n) { return named(n,0); }</code> |
| `ExtendedState` | typedef | 31 | <code>typedef struct { int active&#91;512&#93;; unsigned depth; } ExtendedState;</code> |
| `enclosing` | function | 32 | <code>static int enclosing(AstContext &#42;c, ExtendedState &#42;state, TSNode n) {</code> |
| `unquote` | function | 41 | <code>static void unquote(char &#42;text) {</code> |
| `add_symbol` | function | 48 | <code>static void add_symbol(AstContext &#42;c, TSNode whole, TSNode id,</code> |
| `add_ref` | function | 68 | <code>static void add_ref(AstContext &#42;c, TSNode node, TSNode id,</code> |
| `terraform_reference` | function | 81 | <code>static void terraform_reference(AstContext &#42;c, TSNode expression, int owner) {</code> |
| `simple_id` | function | 138 | <code>static TSNode simple_id(TSNode node) {</code> |
| `visit` | function | 149 | <code>static bool visit(AstContext &#42;c, TSNode n, void &#42;unused) {</code> |
| `extract` | function | 260 | <code>static void extract(AstContext &#42;ctx) {</code> |
| `ast_extended_register` | function | 271 | <code>void ast_extended_register(void) {</code> |

## src/ast_managed.c

[Open source](../../src/ast_managed.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tree_sitter_java` | function | 11 | <code>extern const TSLanguage &#42;tree_sitter_java(void);</code> |
| `tree_sitter_kotlin` | function | 12 | <code>extern const TSLanguage &#42;tree_sitter_kotlin(void);</code> |
| `tree_sitter_scala` | function | 13 | <code>extern const TSLanguage &#42;tree_sitter_scala(void);</code> |
| `tree_sitter_c_sharp` | function | 14 | <code>extern const TSLanguage &#42;tree_sitter_c_sharp(void);</code> |
| `tree_sitter_swift` | function | 15 | <code>extern const TSLanguage &#42;tree_sitter_swift(void);</code> |
| `tree_sitter_dart` | function | 16 | <code>extern const TSLanguage &#42;tree_sitter_dart(void);</code> |
| `Managed` | typedef | 18 | <code>typedef struct { AstContext &#42;ctx; } Managed;</code> |
| `is_type` | function | 20 | <code>static bool is_type(const char &#42;t, const char &#42;s) { return t &amp;&amp; !strcmp(t, s); }</code> |
| `has` | function | 21 | <code>static bool has(const char &#42;t, const char &#42;s) { return strstr(t, s) != NULL; }</code> |
| `span` | function | 23 | <code>static SemSpan span(TSNode n) {</code> |
| `direct_type` | function | 30 | <code>static TSNode direct_type(TSNode n, const char &#42;type) {</code> |
| `field_or_type` | function | 39 | <code>static TSNode field_or_type(TSNode n, const char &#42;field, const char &#42;type) {</code> |
| `node_text` | function | 44 | <code>static char &#42;node_text(AstContext &#42;c, TSNode n) {</code> |
| `limited_text` | function | 48 | <code>static char &#42;limited_text(AstContext &#42;c, TSNode n, TSNode body) {</code> |
| `decl_kind` | function | 60 | <code>static const char &#42;decl_kind(const char &#42;lang, const char &#42;t) {</code> |
| `callable` | function | 84 | <code>static bool callable(const char &#42;kind) {</code> |
| `body_node` | function | 89 | <code>static TSNode body_node(TSNode n) {</code> |
| `name_node` | function | 102 | <code>static TSNode name_node(TSNode n) {</code> |
| `first_type_params` | function | 119 | <code>static char &#42;first_type_params(AstContext &#42;c, TSNode n) {</code> |
| `body_node` | function | 125 | <code>static TSNode body_node(TSNode n);</code> |
| `result_type` | function | 127 | <code>static char &#42;result_type(AstContext &#42;c, TSNode n) {</code> |
| `relation_leaf` | function | 159 | <code>static void relation_leaf(AstContext &#42;c, int owner, TSNode n, const char &#42;kind) {</code> |
| `relation` | function | 170 | <code>static void relation(AstContext &#42;c, int owner, TSNode n, const char &#42;kind,</code> |
| `type_relations` | function | 185 | <code>static void type_relations(AstContext &#42;c, TSNode n, int owner) {</code> |
| `symbol_metadata` | function | 213 | <code>static void symbol_metadata(AstContext &#42;c, TSNode n, SemSymbol &#42;s) {</code> |
| `parameter_identity` | function | 256 | <code>static char &#42;parameter_identity(const char &#42;signature) {</code> |
| `add_symbol` | function | 273 | <code>static int add_symbol(AstContext &#42;c, TSNode n, const char &#42;kind, int parent) {</code> |
| `call_type` | function | 332 | <code>static bool call_type(const char &#42;lang, const char &#42;t) {</code> |
| `import_binding` | function | 339 | <code>static void import_binding(AstContext &#42;c, TSNode n) {</code> |
| `last_identifier` | function | 410 | <code>static TSNode last_identifier(TSNode n) {</code> |
| `add_call` | function | 422 | <code>static void add_call(AstContext &#42;c, TSNode n, int owner) {</code> |
| `dart_selector_call` | function | 449 | <code>static void dart_selector_call(AstContext &#42;c, TSNode n, int owner) {</code> |
| `add_type_reference` | function | 465 | <code>static void add_type_reference(AstContext &#42;c, TSNode n, int owner) {</code> |
| `visit` | function | 490 | <code>static void visit(Managed &#42;m, TSNode n, int parent, unsigned depth) {</code> |
| `extract` | function | 545 | <code>static void extract(AstContext &#42;c) {</code> |
| `ast_managed_register` | function | 550 | <code>void ast_managed_register(void) {</code> |

## src/ast_mixed.c

[Open source](../../src/ast_mixed.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tree_sitter_pascal` | function | 6 | <code>extern const TSLanguage &#42;tree_sitter_pascal(void);</code> |
| `tree_sitter_COBOL` | function | 7 | <code>extern const TSLanguage &#42;tree_sitter_COBOL(void);</code> |
| `tree_sitter_vb_dotnet` | function | 8 | <code>extern const TSLanguage &#42;tree_sitter_vb_dotnet(void);</code> |
| `tree_sitter_cfml` | function | 9 | <code>extern const TSLanguage &#42;tree_sitter_cfml(void);</code> |
| `tree_sitter_cfscript` | function | 10 | <code>extern const TSLanguage &#42;tree_sitter_cfscript(void);</code> |
| `tree_sitter_cfquery` | function | 11 | <code>extern const TSLanguage &#42;tree_sitter_cfquery(void);</code> |
| `tree_sitter_arkts` | function | 12 | <code>extern const TSLanguage &#42;tree_sitter_arkts(void);</code> |
| `MIXED_LINE_STEP` | macro | 14 | <code>#define MIXED_LINE_STEP 4096u</code> |
| `MixedLinePoint` | typedef | 15 | <code>typedef struct {uint32_t line, start;} MixedLinePoint;</code> |
| `MixedLines` | struct | 16 | <code>typedef struct MixedLines {</code> |
| `lines_begin` | function | 24 | <code>static void lines_begin(MixedLines &#42;m,const AstContext &#42;c) {</code> |
| `lines_end` | function | 39 | <code>static void lines_end(MixedLines &#42;m) {</code> |
| `line_pos` | function | 42 | <code>static void line_pos(const MixedLines &#42;m,size_t byte,int &#42;line,int &#42;column) {</code> |
| `span_bytes` | function | 51 | <code>static SemSpan span_bytes(const AstContext &#42;c, size_t lo, size_t hi) {</code> |
| `span_node` | function | 72 | <code>static SemSpan span_node(AstContext &#42;c, TSNode n) {</code> |
| `eq` | function | 80 | <code>static bool eq(const char &#42;a, const char &#42;b) { return strcmp(a,b)==0; }</code> |
| `decl` | function | 81 | <code>static void decl(AstContext &#42;c,const char &#42;name,const char &#42;kind,size_t lo,size_t hi,int owner);</code> |
| `boundary` | function | 82 | <code>static bool boundary(const AstContext &#42;c,size_t p,size_t n);</code> |
| `identify` | function | 83 | <code>static void identify(AstContext &#42;c,const char &#42;prefix) {</code> |
| `node_name` | function | 89 | <code>static char &#42;node_name(AstContext &#42;c, TSNode n) {</code> |
| `add_symbol` | function | 110 | <code>static int add_symbol(AstContext &#42;c, TSNode n, const char &#42;kind, int parent) {</code> |
| `add_ref` | function | 148 | <code>static void add_ref(AstContext &#42;c, TSNode n, TSNode name, const char &#42;kind,int owner) {</code> |
| `MixedOwners` | typedef | 157 | <code>typedef struct {</code> |
| `grammar_visit` | function | 163 | <code>static bool grammar_visit(AstContext &#42;c, TSNode n, void &#42;unused) {</code> |
| `grammar_extract` | function | 246 | <code>static void grammar_extract(AstContext &#42;c) {</code> |
| `at` | function | 253 | <code>static bool at(const AstContext &#42;c,size_t p,const char &#42;s) {</code> |
| `until` | function | 256 | <code>static size_t until(const AstContext &#42;c,size_t p,char end) {</code> |
| `attr` | function | 263 | <code>static char &#42;attr(const AstContext &#42;c,size_t a,size_t b,const char &#42;key,size_t &#42;site) {</code> |
| `decl` | function | 277 | <code>static void decl(AstContext &#42;c,const char &#42;name,const char &#42;kind,size_t lo,size_t hi,int owner) {</code> |
| `ref` | function | 290 | <code>static void ref(AstContext &#42;c,const char &#42;text,const char &#42;kind,size_t lo,size_t hi,int owner,const char &#42;why) {</code> |
| `embedded_fallback` | function | 296 | <code>static void embedded_fallback(AstContext &#42;c,size_t a,size_t b) {</code> |
| `parse_embedded` | function | 320 | <code>static void parse_embedded(AstContext &#42;c,const char &#42;language,size_t a,size_t b) {</code> |
| `MixedLiteralTarget` | typedef | 366 | <code>typedef struct {const char &#42;kind,&#42;name;int id;} MixedLiteralTarget;</code> |
| `literal_target_cmp` | function | 367 | <code>static int literal_target_cmp(const void &#42;a,const void &#42;b) {</code> |
| `link_local_literals` | function | 372 | <code>static void link_local_literals(AstContext &#42;c,const char &#42;lang) {</code> |
| `markup_extract` | function | 410 | <code>static void markup_extract(AstContext &#42;c) {</code> |
| `boundary` | function | 506 | <code>static bool boundary(const AstContext &#42;c,size_t p,size_t n) {</code> |
| `delphi_extract` | function | 510 | <code>static void delphi_extract(AstContext &#42;c) {</code> |
| `text_extract` | function | 566 | <code>static void text_extract(AstContext &#42;c) {</code> |
| `file_only` | function | 612 | <code>static void file_only(AstContext &#42;c) {</code> |
| `ast_mixed_register` | function | 618 | <code>void ast_mixed_register(void) {</code> |

## src/ast_systems.c

[Open source](../../src/ast_systems.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tree_sitter_c` | function | 8 | <code>extern const TSLanguage &#42;tree_sitter_c(void);</code> |
| `tree_sitter_cpp` | function | 9 | <code>extern const TSLanguage &#42;tree_sitter_cpp(void);</code> |
| `tree_sitter_objc` | function | 10 | <code>extern const TSLanguage &#42;tree_sitter_objc(void);</code> |
| `tree_sitter_go` | function | 11 | <code>extern const TSLanguage &#42;tree_sitter_go(void);</code> |
| `tree_sitter_rust` | function | 12 | <code>extern const TSLanguage &#42;tree_sitter_rust(void);</code> |
| `is` | function | 14 | <code>static bool is(TSNode n, const char &#42;kind) {</code> |
| `span` | function | 18 | <code>static SemSpan span(TSNode n) {</code> |
| `field` | function | 25 | <code>static TSNode field(TSNode n, const char &#42;name) {</code> |
| `named` | function | 29 | <code>static TSNode named(TSNode n, unsigned i) { return ts_node_named_child(n, i); }</code> |
| `copy_text` | function | 31 | <code>static char &#42;copy_text(AstContext &#42;ctx, TSNode n) {</code> |
| `slice_until` | function | 35 | <code>static char &#42;slice_until(AstContext &#42;ctx, TSNode n, TSNode end) {</code> |
| `name_leaf` | function | 44 | <code>static TSNode name_leaf(TSNode n) {</code> |
| `qualified` | function | 62 | <code>static char &#42;qualified(const char &#42;parent, const char &#42;name) {</code> |
| `known_type` | function | 71 | <code>static int known_type(AstContext &#42;ctx, TSNode type_node) {</code> |
| `symbol` | function | 89 | <code>static int symbol(AstContext &#42;ctx, TSNode n, TSNode name_node,</code> |
| `type_fact` | function | 130 | <code>static void type_fact(AstContext &#42;ctx, TSNode n, const char &#42;kind,</code> |
| `binding` | function | 139 | <code>static void binding(AstContext &#42;ctx, TSNode n, const char &#42;kind,</code> |
| `is_c_parameter` | function | 158 | <code>static bool is_c_parameter(AstContext &#42;ctx, TSNode call, const char &#42;name) {</code> |
| `ref` | function | 179 | <code>static void ref(AstContext &#42;ctx, TSNode n, TSNode target, const char &#42;kind,</code> |
| `child_type` | function | 196 | <code>static TSNode child_type(TSNode n, const char &#42;type) {</code> |
| `callee_qualifier` | function | 205 | <code>static TSNode callee_qualifier(TSNode n) {</code> |
| `objc_name` | function | 220 | <code>static TSNode objc_name(TSNode n) {</code> |
| `first_named` | function | 228 | <code>static TSNode first_named(TSNode n) { return named(n,0); }</code> |
| `rust_use` | function | 230 | <code>static void rust_use(AstContext &#42;ctx, TSNode n) {</code> |
| `find_table` | function | 249 | <code>static TSNode find_table(TSNode n, const char &#42;table, AstContext &#42;ctx,</code> |
| `native_registration` | function | 274 | <code>static void native_registration(AstContext &#42;ctx, TSNode call, int owner) {</code> |
| `extract_node` | function | 308 | <code>static void extract_node(AstContext &#42;ctx, TSNode n, int owner, int depth) {</code> |
| `systems_extract` | function | 550 | <code>static void systems_extract(AstContext &#42;ctx) {</code> |
| `ast_systems_register` | function | 554 | <code>void ast_systems_register(void) {</code> |

## src/ast_web.c

[Open source](../../src/ast_web.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tree_sitter_javascript` | function | 10 | <code>extern const TSLanguage &#42;tree_sitter_javascript(void);</code> |
| `tree_sitter_typescript` | function | 11 | <code>extern const TSLanguage &#42;tree_sitter_typescript(void);</code> |
| `tree_sitter_tsx` | function | 12 | <code>extern const TSLanguage &#42;tree_sitter_tsx(void);</code> |
| `is` | function | 14 | <code>static bool is(TSNode n, const char &#42;type) {</code> |
| `WebChildren` | typedef | 17 | <code>typedef struct { TSTreeCursor cursor; bool valid; } WebChildren;</code> |
| `children` | function | 18 | <code>static WebChildren children(TSNode parent) {</code> |
| `next_named` | function | 23 | <code>static bool next_named(WebChildren &#42;it, TSNode &#42;out) {</code> |
| `children_done` | function | 31 | <code>static void children_done(WebChildren &#42;it) { ts_tree_cursor_delete(&amp;it-&gt;cursor); }</code> |
| `argument_at` | function | 32 | <code>static TSNode argument_at(TSNode args, unsigned wanted) {</code> |
| `span` | function | 43 | <code>static SemSpan span(TSNode n) {</code> |
| `text` | function | 48 | <code>static char &#42;text(AstContext &#42;c, TSNode n) {</code> |
| `unquote` | function | 51 | <code>static char &#42;unquote(AstContext &#42;c, TSNode n) {</code> |
| `head` | function | 60 | <code>static char &#42;head(AstContext &#42;c, TSNode n, TSNode body) {</code> |
| `qualified` | function | 65 | <code>static char &#42;qualified(SemResult &#42;r, int parent, const char &#42;name) {</code> |
| `contains_word` | function | 73 | <code>static bool contains_word(const char &#42;s, const char &#42;word) {</code> |
| `decorator_target` | function | 81 | <code>static char &#42;decorator_target(AstContext &#42;c, TSNode decorator) {</code> |
| `symbol` | function | 89 | <code>static int symbol(AstContext &#42;c, TSNode n, TSNode name, const char &#42;kind,</code> |
| `bare_call_boundary` | function | 164 | <code>static const char &#42;bare_call_boundary(AstContext &#42;c, TSNode site, const char &#42;name) {</code> |
| `reference` | function | 190 | <code>static void reference(AstContext &#42;c, TSNode site, TSNode name, const char &#42;kind,</code> |
| `binding` | function | 205 | <code>static void binding(AstContext &#42;c, TSNode site, const char &#42;module,</code> |
| `imports` | function | 213 | <code>static void imports(AstContext &#42;c, TSNode n) {</code> |
| `export_context` | function | 246 | <code>static bool export_context(TSNode n) {</code> |
| `exports` | function | 250 | <code>static void exports(AstContext &#42;c, TSNode n) {</code> |
| `fact` | function | 289 | <code>static void fact(AstContext &#42;c, TSNode node, TSNode name,</code> |
| `named_fact` | function | 298 | <code>static void named_fact(AstContext &#42;c, TSNode node, const char &#42;name,</code> |
| `heritage` | function | 305 | <code>static void heritage(AstContext &#42;c, TSNode n, int owner) {</code> |
| `component_name` | function | 324 | <code>static bool component_name(const char &#42;s) {</code> |
| `local_path` | function | 327 | <code>static bool local_path(const char &#42;s) {</code> |
| `locally_constructed` | function | 330 | <code>static bool locally_constructed(AstContext &#42;c, TSNode root,</code> |
| `declaration_count` | function | 353 | <code>static int declaration_count(AstContext &#42;c, TSNode root,</code> |
| `imported_receiver` | function | 372 | <code>static bool imported_receiver(AstContext &#42;c, const char &#42;receiver) {</code> |
| `channel_fact` | function | 380 | <code>static void channel_fact(AstContext &#42;c, TSNode n, TSNode fn,</code> |
| `call_arity` | function | 455 | <code>static int call_arity(TSNode args) {</code> |
| `visit` | function | 468 | <code>static void visit(AstContext &#42;c, TSNode n, int owner, int depth) {</code> |
| `extract` | function | 633 | <code>static void extract(AstContext &#42;c) { visit(c,c-&gt;root,-1,0); }</code> |
| `ast_web_register` | function | 634 | <code>void ast_web_register(void) {</code> |

## src/db.c

[Open source](../../src/db.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `body_tri_compat` | function | 244 | <code>static const char &#42;body_tri_compat(sqlite3 &#42;db) {</code> |
| `SCHEMA_VERSION` | macro | 253 | <code>#define SCHEMA_VERSION "18"</code> |
| `db_fts_create` | function | 257 | <code>static int db_fts_create(Cg &#42;cg);       /&#42; codify-v15 1.3, below &#42;/</code> |
| `path_exists` | function | 261 | <code>static bool path_exists(const char &#42;base, const char &#42;name) {</code> |
| `is_project_dir` | function | 268 | <code>static bool is_project_dir(const char &#42;base) {</code> |
| `cg_is_boundary` | function | 278 | <code>bool cg_is_boundary(const char &#42;dir) {</code> |
| `git_file_at` | function | 290 | <code>static bool git_file_at(const char &#42;dir) {</code> |
| `cg_find_project_at` | function | 297 | <code>int cg_find_project_at(const char &#42;start, char &#42;root, char &#42;shared,</code> |
| `cg_find_root_at` | function | 346 | <code>int cg_find_root_at(const char &#42;start, char &#42;out, size_t cap) {</code> |
| `cg_find_root` | function | 351 | <code>int cg_find_root(char &#42;out, size_t cap) {</code> |
| `cg_bkey` | function | 357 | <code>void cg_bkey(const Cg &#42;cg, const char &#42;name, char &#42;out, size_t cap) {</code> |
| `cmd_root` | function | 363 | <code>int cmd_root(bool json) {</code> |
| `cg_open` | function | 394 | <code>int cg_open(Cg &#42;cg, bool create) {</code> |
| `FTS_CONTENTLESS_MIN` | macro | 482 | <code>#define FTS_CONTENTLESS_MIN 3043000</code> |
| `fts_mode_read` | function | 484 | <code>static char &#42;fts_mode_read(Cg &#42;cg) {</code> |
| `db_fts_contentless` | function | 496 | <code>bool db_fts_contentless(Cg &#42;cg) {</code> |
| `body_fts_state` | function | 505 | <code>static int body_fts_state(Cg &#42;cg) {</code> |
| `db_fts_create` | function | 518 | <code>static int db_fts_create(Cg &#42;cg) {</code> |
| `cg_schema_upgrade` | function | 569 | <code>int cg_schema_upgrade(Cg &#42;cg) {</code> |
| `cg_close` | function | 717 | <code>void cg_close(Cg &#42;cg) {</code> |
| `cg_prep` | function | 722 | <code>sqlite3_stmt &#42;cg_prep(Cg &#42;cg, const char &#42;sql) {</code> |
| `busy_rc` | function | 731 | <code>static bool busy_rc(int rc) {</code> |
| `cg_busy_why` | function | 738 | <code>void cg_busy_why(const char &#42;why) { g_busy_why = why; }</code> |
| `cg_busy_report` | function | 744 | <code>void cg_busy_report(const char &#42;what) {</code> |
| `cg_lock_wait_default` | function | 760 | <code>long cg_lock_wait_default(void) {</code> |
| `cg_begin_write` | function | 766 | <code>int cg_begin_write(Cg &#42;cg) {</code> |
| `cg_exec` | function | 787 | <code>void cg_exec(Cg &#42;cg, const char &#42;sql) {</code> |
| `cg_meta_set` | function | 801 | <code>void cg_meta_set(Cg &#42;cg, const char &#42;k, const char &#42;v) {</code> |
| `cg_meta_get` | function | 811 | <code>char &#42;cg_meta_get(Cg &#42;cg, const char &#42;k) {</code> |

## src/files.c

[Open source](../../src/files.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `has_glob` | function | 19 | <code>static bool has_glob(const char &#42;s) { return strpbrk(s, "&#42;?&#91;") != NULL; }</code> |
| `lang_normalise` | function | 22 | <code>static void lang_normalise(const char &#42;in, char &#42;out, size_t cap) {</code> |
| `qf_add_path` | function | 30 | <code>static void qf_add_path(QueryFilter &#42;f, const char &#42;p) {</code> |
| `query_filter_parse` | function | 36 | <code>int query_filter_parse(int &#42;argc, char &#42;&#42;argv, QueryFilter &#42;f) {</code> |
| `query_filter_active` | function | 64 | <code>bool query_filter_active(const QueryFilter &#42;f) {</code> |
| `qf_globs` | function | 72 | <code>static int qf_globs(const char &#42;in, char out&#91;2&#93;&#91;1100&#93;, bool &#42;exact) {</code> |
| `query_filter_sql` | function | 102 | <code>char &#42;query_filter_sql(const QueryFilter &#42;f, const char &#42;alias) {</code> |
| `query_filter_match` | function | 132 | <code>bool query_filter_match(const QueryFilter &#42;f, const char &#42;path,</code> |
| `sql_is_test` | function | 151 | <code>static void sql_is_test(sqlite3_context &#42;ctx, int argc, sqlite3_value &#42;&#42;argv) {</code> |
| `query_filter_register` | function | 157 | <code>void query_filter_register(sqlite3 &#42;db) {</code> |
| `cg_filter_set` | function | 166 | <code>void cg_filter_set(Cg &#42;cg, const QueryFilter &#42;f) {</code> |
| `cg_filter_get` | function | 173 | <code>const QueryFilter &#42;cg_filter_get(const Cg &#42;cg) {</code> |
| `FileRow` | typedef | 179 | <code>typedef struct {</code> |
| `filerow_cmp` | function | 187 | <code>static int filerow_cmp(const void &#42;a, const void &#42;b) {</code> |
| `files_prep` | function | 194 | <code>static sqlite3_stmt &#42;files_prep(Cg &#42;cg, const QueryFilter &#42;f,</code> |
| `rows_push` | function | 208 | <code>static void rows_push(FileRow &#42;&#42;v, int &#42;n, int &#42;c, sqlite3_stmt &#42;st) {</code> |
| `FILE_COLS` | macro | 222 | <code>#define FILE_COLS "f.id, f.path, f.lang, ifnull(f.lines,0)"</code> |
| `words_score` | function | 227 | <code>static int words_score(const char &#42;path, char terms&#91;&#93;&#91;64&#93;, int nt) {</code> |
| `print_rows` | function | 254 | <code>static void print_rows(Cg &#42;cg, FileRow &#42;v, int n, int limit, bool json,</code> |
| `SubDir` | typedef | 278 | <code>typedef struct { char name&#91;512&#93;; int files; long lines; } SubDir;</code> |
| `subdir_cmp` | function | 280 | <code>static int subdir_cmp(const void &#42;a, const void &#42;b) {</code> |
| `files_dir` | function | 284 | <code>static int files_dir(Cg &#42;cg, const QueryFilter &#42;f, const char &#42;dir,</code> |
| `DLANGS` | macro | 367 | <code>#define DLANGS 6</code> |
| `DirAgg` | typedef | 368 | <code>typedef struct {</code> |
| `DirMap` | typedef | 377 | <code>typedef struct {</code> |
| `str_hash` | function | 384 | <code>static size_t str_hash(const char &#42;s, size_t n) {</code> |
| `dm_grow` | function | 390 | <code>static void dm_grow(DirMap &#42;m) {</code> |
| `dm_get` | function | 404 | <code>static int dm_get(DirMap &#42;m, const char &#42;p, size_t len, int depth, int parent) {</code> |
| `dir_add_lang` | function | 428 | <code>static void dir_add_lang(DirAgg &#42;d, const char &#42;lang, long lines) {</code> |
| `dir_dominant` | function | 440 | <code>static const char &#42;dir_dominant(const DirAgg &#42;d) {</code> |
| `dirorder_cmp` | function | 448 | <code>static int dirorder_cmp(const void &#42;a, const void &#42;b) {</code> |
| `dirs_emit` | function | 457 | <code>static void dirs_emit(DirMap &#42;m, int parent, int &#42;order, int &#42;no) {</code> |
| `files_dirs` | function | 473 | <code>static int files_dirs(Cg &#42;cg, const QueryFilter &#42;f, const char &#42;prefix,</code> |
| `files_glob` | function | 582 | <code>static int files_glob(Cg &#42;cg, const QueryFilter &#42;f, const char &#42;pat,</code> |
| `files_words` | function | 601 | <code>static int files_words(Cg &#42;cg, const QueryFilter &#42;f, const char &#42;pat,</code> |
| `is_dir_path` | function | 651 | <code>static bool is_dir_path(Cg &#42;cg, const char &#42;p) {</code> |
| `files_query` | function | 667 | <code>static int files_query(Cg &#42;cg, const QueryFilter &#42;fp, const char &#42;pat,</code> |
| `cmd_files` | function | 670 | <code>int cmd_files(Cg &#42;cg, int argc, char &#42;&#42;argv, bool json) {</code> |
| `files_query` | function | 705 | <code>static int files_query(Cg &#42;cg, const QueryFilter &#42;fp, const char &#42;pat,</code> |

## src/graph.c

[Open source](../../src/graph.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fts_quote` | function | 13 | <code>static char &#42;fts_quote(const char &#42;q) {          /&#42; "..." literal, "" escaped &#42;/</code> |
| `fts_words` | function | 24 | <code>static char &#42;fts_words(const char &#42;q) {          /&#42; tok&#42; tok&#42; for unicode61 &#42;/</code> |
| `scope_id` | function | 47 | <code>static long scope_id(const Cg &#42;cg) {</code> |
| `branch_scope_sql` | function | 53 | <code>const char &#42;branch_scope_sql(const Cg &#42;cg, const char &#42;alias, char &#42;out,</code> |
| `cg_scope_set` | function | 64 | <code>int cg_scope_set(Cg &#42;cg, const char &#42;name, bool all) {</code> |
| `branch_hit_label` | function | 77 | <code>const char &#42;branch_hit_label(Cg &#42;cg, long branch_id, char &#42;out, size_t cap) {</code> |
| `branch_tree` | function | 90 | <code>const char &#42;branch_tree(Cg &#42;cg, long branch_id, char &#42;out, size_t cap) {</code> |
| `prep_scoped` | function | 107 | <code>static sqlite3_stmt &#42;prep_scoped(Cg &#42;cg, const char &#42;head, const char &#42;tail) {</code> |
| `file_snippet_n` | function | 128 | <code>static char &#42;file_snippet_n(Cg &#42;cg, long branch_id, const char &#42;rel, int from,</code> |
| `file_snippet` | function | 159 | <code>static char &#42;file_snippet(Cg &#42;cg, long branch_id, const char &#42;rel, int from,</code> |
| `SymRow` | typedef | 164 | <code>typedef struct {</code> |
| `sym_from_stmt_at` | function | 173 | <code>static int sym_from_stmt_at(sqlite3_stmt &#42;st, int off, SymRow &#42;r) {</code> |
| `sym_from_stmt` | function | 191 | <code>static int sym_from_stmt(sqlite3_stmt &#42;st, SymRow &#42;r) {</code> |
| `SYM_COLS` | macro | 199 | <code>#define SYM_COLS &#92;</code> |
| `ci_has` | function | 205 | <code>static bool ci_has(const char &#42;hay, const char &#42;needle) {</code> |
| `doc_derivable` | function | 215 | <code>static bool doc_derivable(const char &#42;doc, const char &#42;name, const char &#42;sig) {</code> |
| `DOC_MAX_BYTES` | macro | 232 | <code>#define DOC_MAX_BYTES 700    /&#42; per-symbol share: ~10 lines of prose &#42;/</code> |
| `SymDoc` | typedef | 234 | <code>typedef struct { char &#42;body; bool stale, cut; } SymDoc;</code> |
| `body_first` | function | 238 | <code>static bool body_first(void) {</code> |
| `doc_take` | function | 248 | <code>static void doc_take(SymDoc &#42;d, const char &#42;body, bool stale) {</code> |
| `symbol_doc_rows` | function | 267 | <code>static void symbol_doc_rows(Cg &#42;cg, const SymRow &#42;r, const SymRow &#42;own,</code> |
| `symbol_doc` | function | 309 | <code>static bool symbol_doc(Cg &#42;cg, const SymRow &#42;r, SymDoc &#42;d) {</code> |
| `doc_render` | function | 331 | <code>static void doc_render(StrBuf &#42;b, const SymDoc &#42;d) {</code> |
| `anchor_stale` | function | 351 | <code>int anchor_stale(Cg &#42;cg,</code> |
| `doc_json` | function | 406 | <code>static void doc_json(StrBuf &#42;b, const SymDoc &#42;d) {</code> |
| `defs_named` | function | 414 | <code>static int defs_named(Cg &#42;cg, const char &#42;name, SymRow &#42;out, int cap) {</code> |
| `find_symbols` | function | 430 | <code>static int find_symbols(Cg &#42;cg, const char &#42;q, SymRow &#42;out, int cap) {</code> |
| `find_symbols_all` | function | 469 | <code>static int find_symbols_all(Cg &#42;cg, const char &#42;q, SymRow &#42;out, int cap) {</code> |
| `RESOLVE_MAX_DEFS` | macro | 508 | <code>#define RESOLVE_MAX_DEFS 64</code> |
| `rank_path_penalized` | function | 512 | <code>static bool rank_path_penalized(const char &#42;path) {</code> |
| `path_depth` | function | 533 | <code>static int path_depth(const char &#42;p) {</code> |
| `module_matches` | function | 545 | <code>static bool module_matches(const char &#42;module, const char &#42;cand_path) {</code> |
| `resolve_best` | function | 584 | <code>static int resolve_best(Cg &#42;cg, long from_fid, const char &#42;from_path,</code> |
| `qf_keep` | function | 637 | <code>static int qf_keep(const Cg &#42;cg, SymRow &#42;v, int n) {</code> |
| `callers_of` | function | 651 | <code>static int callers_of(Cg &#42;cg, const SymRow &#42;def, SymRow &#42;out, int cap) {</code> |
| `sym_path_line_cmp` | function | 709 | <code>static int sym_path_line_cmp(const void &#42;a, const void &#42;b) {</code> |
| `callees_of` | function | 720 | <code>static int callees_of(Cg &#42;cg, long sym_id, SymRow &#42;out, int cap) {</code> |
| `ref_count` | function | 800 | <code>static int ref_count(Cg &#42;cg, const char &#42;name) {</code> |
| `ref_count_resolved` | function | 814 | <code>static int ref_count_resolved(Cg &#42;cg, const SymRow &#42;def) {</code> |
| `STOPWORDS` | variable | 848 | <code>static const char &#42;STOPWORDS&#91;&#93; = {</code> |
| `MAX_TERMS` | macro | 856 | <code>#define MAX_TERMS 8</code> |
| `Terms` | typedef | 857 | <code>typedef struct { char t&#91;MAX_TERMS&#93;&#91;64&#93;; int n; } Terms;</code> |
| `query_terms` | function | 862 | <code>static void query_terms(const char &#42;q, Terms &#42;T) {</code> |
| `term_hits` | function | 890 | <code>static bool term_hits(const char &#42;t, const char &#42;w, size_t wn) {</code> |
| `words_mask` | function | 898 | <code>static unsigned words_mask(const char &#42;words, const Terms &#42;T) {</code> |
| `text_mask` | function | 912 | <code>static unsigned text_mask(const char &#42;text, size_t len, const Terms &#42;T) {</code> |
| `popcount` | function | 928 | <code>static int popcount(unsigned m) {</code> |
| `Hit` | typedef | 936 | <code>typedef struct {</code> |
| `RANK_CAP` | macro | 943 | <code>#define RANK_CAP 256</code> |
| `hit_get` | function | 945 | <code>static Hit &#42;hit_get(Hit &#42;h, int &#42;nh, const SymRow &#42;r, bool add) {</code> |
| `hit_cmp` | function | 955 | <code>static int hit_cmp(const void &#42;a, const void &#42;b) {</code> |
| `FileHit` | typedef | 967 | <code>typedef struct {</code> |
| `FILE_SCAN` | macro | 976 | <code>#define FILE_SCAN 16</code> |
| `filehit_cmp` | function | 978 | <code>static int filehit_cmp(const void &#42;a, const void &#42;b) {</code> |
| `filehits_free` | function | 986 | <code>static void filehits_free(FileHit &#42;f, int n) {</code> |
| `fts_terms` | function | 992 | <code>static char &#42;fts_terms(const Terms &#42;T, bool any) {</code> |
| `rank_bodies` | function | 1006 | <code>static void rank_bodies(Cg &#42;cg, const Terms &#42;T, Hit &#42;h, int &#42;nh,</code> |
| `signature_identity` | function | 1132 | <code>static void signature_identity(const char &#42;sig, char &#42;out, size_t cap) {</code> |
| `signature_static` | function | 1151 | <code>static bool signature_static(const char &#42;sig) {</code> |
| `prototype_matches` | function | 1162 | <code>static bool prototype_matches(Cg &#42;cg, const SymRow &#42;decl, const SymRow &#42;def) {</code> |
| `declaration_has_definition` | function | 1204 | <code>static bool declaration_has_definition(Cg &#42;cg, const SymRow &#42;decl) {</code> |
| `rank_query` | function | 1219 | <code>static int rank_query(Cg &#42;cg, const char &#42;q, SymRow &#42;out, int cap,</code> |
| `structured_query` | function | 1385 | <code>static int structured_query(Cg &#42;cg, const char &#42;q, SymRow &#42;out, int cap,</code> |
| `ep_interesting` | function | 1433 | <code>static bool ep_interesting(const SymRow &#42;r) {</code> |
| `ep_push` | function | 1442 | <code>static bool ep_push(SymRow &#42;out, int &#42;n, int cap, const SymRow &#42;r) {</code> |
| `ep_climb` | function | 1451 | <code>static void ep_climb(Cg &#42;cg, const SymRow &#42;from, SymRow &#42;out, int &#42;n, int cap,</code> |
| `context_entry_points` | function | 1468 | <code>static int context_entry_points(Cg &#42;cg, const char &#42;q, const SymRow &#42;matched,</code> |
| `hit_tag` | function | 1497 | <code>static const char &#42;hit_tag(Cg &#42;cg, const SymRow &#42;r, char &#42;out, size_t cap) {</code> |
| `json_sym` | function | 1505 | <code>static void json_sym(Cg &#42;cg, StrBuf &#42;b, const SymRow &#42;r) {</code> |
| `json_sym_compact` | function | 1522 | <code>static void json_sym_compact(Cg &#42;cg, StrBuf &#42;b, const SymRow &#42;r) {</code> |
| `SeenSet` | typedef | 1536 | <code>typedef struct { char v&#91;96&#93;&#91;256&#93;; int n; } SeenSet;</code> |
| `seen_has` | function | 1538 | <code>static bool seen_has(const SeenSet &#42;s, const char &#42;name) {</code> |
| `seen_add` | function | 1544 | <code>static void seen_add(SeenSet &#42;s, const char &#42;name) {</code> |
| `filehit_put` | function | 1553 | <code>static void filehit_put(Cg &#42;cg, StrBuf &#42;b, const FileHit &#42;f, bool json) {</code> |
| `cmd_search` | function | 1574 | <code>int cmd_search(Cg &#42;cg, const char &#42;q, int limit, bool json) {</code> |
| `cmd_symbol` | function | 1629 | <code>int cmd_symbol(Cg &#42;cg, const char &#42;name, bool json) {</code> |
| `INode` | typedef | 1683 | <code>typedef struct { char name&#91;256&#93;; char via&#91;256&#93;; int depth; SymRow loc; } INode;</code> |
| `inode_seen` | function | 1685 | <code>static bool inode_seen(INode &#42;v, int n, const char &#42;name) {</code> |
| `IMPACT_CAP` | macro | 1691 | <code>#define IMPACT_CAP 400</code> |
| `impact_bfs` | function | 1694 | <code>static int impact_bfs(Cg &#42;cg, const SymRow &#42;root, int depth, bool up,</code> |
| `impact_json_dir` | function | 1728 | <code>static void impact_json_dir(Cg &#42;cg, StrBuf &#42;b, const char &#42;key, const INode &#42;v,</code> |
| `cmd_impact` | function | 1758 | <code>int cmd_impact(Cg &#42;cg, const char &#42;name, int depth, int budget, bool json) {</code> |
| `cmd_routes` | function | 1820 | <code>int cmd_routes(Cg &#42;cg, const char &#42;filter, bool json) {</code> |
| `first_line` | function | 1876 | <code>static void first_line(StrBuf &#42;b, const char &#42;body, int max) {</code> |
| `SurveySym` | typedef | 1903 | <code>typedef struct {</code> |
| `cmd_survey` | function | 1910 | <code>int cmd_survey(Cg &#42;cg, const char &#42;scope, int budget, bool json) {</code> |
| `AnchStale` | typedef | 2155 | <code>typedef struct { StrBuf &#42;txt, &#42;js; int n; } AnchStale;</code> |
| `anch_stale_cb` | function | 2157 | <code>static void anch_stale_cb(void &#42;u, const char &#42;path, int line,</code> |
| `DOC_VIA_DECL` | macro | 2181 | <code>#define DOC_VIA_DECL &#92;</code> |
| `cmd_anchors` | function | 2186 | <code>int cmd_anchors(Cg &#42;cg, bool stale_only, bool unc_only, bool json) {</code> |
| `CTX_TAIL` | macro | 2307 | <code>#define CTX_TAIL 96</code> |
| `CTX_MARK` | macro | 2309 | <code>#define CTX_MARK 16</code> |
| `ctx_tail` | function | 2311 | <code>static void ctx_tail(StrBuf &#42;b, int budget, int omitted, bool json) {</code> |
| `file_purpose` | function | 2328 | <code>static void file_purpose(Cg &#42;cg, long file_id, char &#42;out, size_t cap) {</code> |
| `ctx_fit` | function | 2347 | <code>static bool ctx_fit(StrBuf &#42;b, StrBuf &#42;it, size_t room, bool json, int &#42;emitted,</code> |
| `ctx_omitted` | function | 2361 | <code>static void ctx_omitted(StrBuf &#42;b, int emitted, int omitted, bool json) {</code> |
| `context_path_outline` | function | 2374 | <code>static int context_path_outline(Cg &#42;cg, const char &#42;q, int budget, bool json) {</code> |
| `DirFile` | struct | 2588 | <code>struct DirFile { long id, lines; int syms; char &#42;path; } &#42;dv = NULL;</code> |
| `DirSub` | struct | 2607 | <code>struct DirSub { char name&#91;512&#93;; int files, syms; long lines; } &#42;sd = NULL;</code> |
| `CTX_OPEN_MAX` | macro | 2708 | <code>#define CTX_OPEN_MAX 60           /&#42; opening lines one hit may grow to &#42;/</code> |
| `CTX_MIN_BUDGET` | macro | 2711 | <code>#define CTX_MIN_BUDGET 64</code> |
| `cmd_context` | function | 2713 | <code>int cmd_context(Cg &#42;cg, const char &#42;q, int budget, int limit, bool json) {</code> |
| `symbols_at_position` | function | 3128 | <code>static int symbols_at_position(Cg &#42;cg, const char &#42;path, int line,</code> |
| `graph_symbol_at` | function | 3147 | <code>int graph_symbol_at(Cg &#42;cg, const char &#42;path, int line, char &#42;name,</code> |
| `cmd_show` | function | 3158 | <code>int cmd_show(Cg &#42;cg, const char &#42;name, bool full, bool json) {</code> |
| `TEST_PATH_SQL` | macro | 3223 | <code>#define TEST_PATH_SQL &#92;</code> |
| `graph_path_is_test` | function | 3230 | <code>bool graph_path_is_test(const char &#42;path) {</code> |
| `tests_for_symbol` | function | 3266 | <code>static int tests_for_symbol(Cg &#42;cg, const char &#42;name, StrBuf &#42;b, bool json,</code> |
| `graph_task_focus` | function | 3295 | <code>char &#42;graph_task_focus(Cg &#42;cg, const char &#42;task_packet) {</code> |
| `cmd_test_impact` | function | 3321 | <code>int cmd_test_impact(Cg &#42;cg, const char &#42;name, bool json) {</code> |
| `cmd_why` | function | 3380 | <code>int cmd_why(Cg &#42;cg, const char &#42;name, bool json) {</code> |
| `path_is_header` | function | 3485 | <code>static bool path_is_header(const char &#42;path) {</code> |
| `lang_family` | function | 3495 | <code>static const char &#42;lang_family(const char &#42;path) {</code> |
| `edges_prefer_impl` | function | 3505 | <code>static int edges_prefer_impl(Cg &#42;cg, SymRow &#42;e, int n, bool callers,</code> |
| `graph_symbol_brief` | function | 3531 | <code>int graph_symbol_brief(Cg &#42;cg, const char &#42;name, int snippet_lines,</code> |
| `graph_glob_symbols` | function | 3619 | <code>int graph_glob_symbols(Cg &#42;cg, const char &#42;glob, int max_files, int max_syms,</code> |
| `graph_neighbors` | function | 3653 | <code>int graph_neighbors(Cg &#42;cg, const char &#42;name, char &#42;&#42;&#42;out) {</code> |

## src/grep.c

[Open source](../../src/grep.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GREP_FILE_MAX` | macro | 21 | <code>#define GREP_FILE_MAX (8L &#42; 1024 &#42; 1024)</code> |
| `GREP_BODY_MAX` | macro | 22 | <code>#define GREP_BODY_MAX (2L &#42; 1024 &#42; 1024)</code> |
| `GREP_TEXT_MAX` | macro | 23 | <code>#define GREP_TEXT_MAX 200          /&#42; bytes of a hit line we print &#42;/</code> |
| `GREP_MAX_TRI` | macro | 24 | <code>#define GREP_MAX_TRI  24           /&#42; trigrams asked of the index &#42;/</code> |
| `ere_meta` | function | 54 | <code>static bool ere_meta(char c) { return c &amp;&amp; strchr(".&#91;&#93;()&#42;+?{}&#124;^$&#92;&#92;", c); }</code> |
| `required_literal` | function | 60 | <code>static char &#42;required_literal(const char &#42;pat, bool regex) {</code> |
| `u8len` | function | 104 | <code>static size_t u8len(const unsigned char &#42;s) {</code> |
| `trigram_query` | function | 115 | <code>static int trigram_query(const char &#42;lit, StrBuf &#42;q) {</code> |
| `GSpan` | typedef | 141 | <code>typedef struct { char &#42;name, &#42;kind; int line, end; } GSpan;</code> |
| `GHit` | typedef | 142 | <code>typedef struct { int line; char &#42;text; } GHit;</code> |
| `GFile` | typedef | 144 | <code>typedef struct {</code> |
| `spans_load` | function | 160 | <code>static void spans_load(Cg &#42;cg, long file_id, const char &#42;by, const char &#42;val,</code> |
| `spans_free` | function | 190 | <code>static void spans_free(GSpan &#42;s, int n) {</code> |
| `span_at` | function | 196 | <code>static const GSpan &#42;span_at(const GSpan &#42;s, int n, int line) {</code> |
| `GScan` | typedef | 209 | <code>typedef struct {</code> |
| `hit_add` | function | 220 | <code>static void hit_add(GScan &#42;g, GFile &#42;f, int line, const char &#42;ls,</code> |
| `scan_literal` | function | 250 | <code>static void scan_literal(GScan &#42;g, GFile &#42;f, const char &#42;buf, size_t len) {</code> |
| `scan_regex` | function | 279 | <code>static void scan_regex(GScan &#42;g, GFile &#42;f, char &#42;buf, size_t len,</code> |
| `scan_worker` | function | 296 | <code>static void &#42;scan_worker(void &#42;arg) {</code> |
| `file_rank` | function | 330 | <code>static int file_rank(const void &#42;a, const void &#42;b) {</code> |
| `GLines` | typedef | 340 | <code>typedef struct { char &#42;buf; char &#42;&#42;lines; int n; } GLines;</code> |
| `glines_load` | function | 342 | <code>static void glines_load(GLines &#42;gl, const GFile &#42;f) {</code> |
| `glines_free` | function | 366 | <code>static void glines_free(GLines &#42;gl) { free(gl-&gt;buf); free(gl-&gt;lines); }</code> |
| `put_trimmed` | function | 368 | <code>static void put_trimmed(StrBuf &#42;b, const char &#42;s, bool json) {</code> |
| `put_context` | function | 383 | <code>static void put_context(StrBuf &#42;b, const GLines &#42;gl, int line, int ctx) {</code> |
| `grep_tri_complete` | function | 410 | <code>bool grep_tri_complete(Cg &#42;cg, long &#42;have, long &#42;want) {</code> |
| `now_scope_count` | function | 454 | <code>static long now_scope_count(Cg &#42;cg) {</code> |
| `GREP_MAX_TREES` | macro | 470 | <code>#define GREP_MAX_TREES 32</code> |
| `GCands` | typedef | 471 | <code>typedef struct {</code> |
| `cands_reset` | function | 478 | <code>static void cands_reset(GCands &#42;c) {</code> |
| `cands_collect` | function | 486 | <code>static int cands_collect(Cg &#42;cg, const GrepOpts &#42;o, const QueryFilter &#42;qf,</code> |
| `cmd_grep` | function | 551 | <code>int cmd_grep(Cg &#42;cg, const SysInfo &#42;si, const GrepOpts &#42;o, bool json) {</code> |
| `GrepCall` | typedef | 914 | <code>typedef struct { Cg &#42;cg; const SysInfo &#42;si; const char &#42;args; } GrepCall;</code> |
| `arg_true` | function | 916 | <code>static bool arg_true(const char &#42;args, const char &#42;key, bool dflt) {</code> |
| `t_grep` | function | 924 | <code>int t_grep(void &#42;v) {</code> |

## src/index_health.c

[Open source](../../src/index_health.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `index_health_init` | function | 6 | <code>int index_health_init(Cg &#42;cg) {</code> |
| `index_health_stale` | function | 38 | <code>bool index_health_stale(Cg &#42;cg, const char &#42;path) {</code> |
| `index_health_branch_stale` | function | 56 | <code>bool index_health_branch_stale(Cg &#42;cg) {</code> |
| `index_health_record` | function | 73 | <code>void index_health_record(Cg &#42;cg, const char &#42;path, const IndexHealthResult &#42;r) {</code> |
| `parse_diagnostic_add` | function | 107 | <code>void parse_diagnostic_add(ParseResult &#42;pr, const char &#42;code, int line) {</code> |
| `index_health_finish` | function | 122 | <code>void index_health_finish(Cg &#42;cg) {</code> |
| `index_health_remove` | function | 133 | <code>void index_health_remove(Cg &#42;cg, long file_id) {</code> |
| `index_health_prune_missing` | function | 143 | <code>void index_health_prune_missing(Cg &#42;cg) {</code> |
| `index_health_generated` | function | 169 | <code>bool index_health_generated(const char &#42;path, const char &#42;body, size_t len) {</code> |

## src/index_health.h

[Open source](../../src/index_health.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `INDEX_HEALTH_H` | macro | 2 | <code>#define INDEX_HEALTH_H</code> |
| `CG_EXTRACTION_VERSION` | macro | 7 | <code>#define CG_EXTRACTION_VERSION 3</code> |
| `IndexHealthResult` | typedef | 9 | <code>typedef struct {</code> |
| `index_health_init` | function | 19 | <code>int index_health_init(Cg &#42;cg);</code> |
| `index_health_stale` | function | 20 | <code>bool index_health_stale(Cg &#42;cg, const char &#42;path);</code> |
| `index_health_branch_stale` | function | 21 | <code>bool index_health_branch_stale(Cg &#42;cg);</code> |
| `index_health_record` | function | 22 | <code>void index_health_record(Cg &#42;cg, const char &#42;path, const IndexHealthResult &#42;r);</code> |
| `index_health_finish` | function | 23 | <code>void index_health_finish(Cg &#42;cg);</code> |
| `index_health_remove` | function | 24 | <code>void index_health_remove(Cg &#42;cg, long file_id);</code> |
| `index_health_prune_missing` | function | 25 | <code>void index_health_prune_missing(Cg &#42;cg);</code> |
| `index_health_generated` | function | 26 | <code>bool index_health_generated(const char &#42;path, const char &#42;body, size_t len);</code> |
| `parse_diagnostic_add` | function | 27 | <code>void parse_diagnostic_add(ParseResult &#42;pr, const char &#42;code, int line);</code> |

## src/lang.c

[Open source](../../src/lang.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ID` | macro | 12 | <code>#define ID "&#91;A-Za-z_&#93;&#91;A-Za-z0-9_&#93;&#42;"</code> |
| `NW` | macro | 13 | <code>#define NW "(^&#124;&#91;^A-Za-z0-9_&#93;)"          /&#42; non-word boundary, consumes 0-1 &#42;/</code> |
| `DefPat` | typedef | 15 | <code>typedef struct { const char &#42;kind; const char &#42;pat; int group; } DefPat;</code> |
| `ImpStyle` | typedef | 18 | <code>typedef enum {</code> |
| `MAXPATS` | macro | 28 | <code>#define MAXPATS 12</code> |
| `LangSpec` | typedef | 29 | <code>typedef struct {</code> |
| `NLANGS` | macro | 141 | <code>#define NLANGS ((int)(sizeof LANGS / sizeof LANGS&#91;0&#93;))</code> |
| `EXTMAP` | variable | 144 | <code>static const struct { const char &#42;ext, &#42;lang, &#42;spec; } EXTMAP&#91;&#93; = {</code> |
| `KEYWORDS` | variable | 183 | <code>static const char &#42;KEYWORDS&#91;&#93; = {</code> |
| `RUST_KEYWORDS` | variable | 192 | <code>static const char &#42;RUST_KEYWORDS&#91;&#93; = {</code> |
| `word_in` | function | 201 | <code>static bool word_in(const char &#42;const &#42;words, const char &#42;s, size_t n) {</code> |
| `STMT_LEADS` | variable | 209 | <code>static const char &#42;STMT_LEADS&#91;&#93; = {</code> |
| `is_keyword` | function | 214 | <code>static bool is_keyword(const LangSpec &#42;L, const char &#42;s, size_t n) {</code> |
| `lang_global_init` | function | 220 | <code>void lang_global_init(void) {</code> |
| `spec_by_name` | function | 243 | <code>static const LangSpec &#42;spec_by_name(const char &#42;name) {</code> |
| `lang_for_path` | function | 250 | <code>const char &#42;lang_for_path(const char &#42;path) {</code> |
| `spec_for_path` | function | 257 | <code>static const LangSpec &#42;spec_for_path(const char &#42;path) {</code> |
| `CMT_MAX_BYTES` | macro | 266 | <code>#define CMT_MAX_BYTES 4000        /&#42; a span longer than this is a licence header &#42;/</code> |
| `add_cmt` | function | 268 | <code>static void add_cmt(ParseResult &#42;pr, const char &#42;body, int line, int end,</code> |
| `CmtAcc` | typedef | 285 | <code>typedef struct { StrBuf b; int line, end; bool pure, open, below; } CmtAcc;</code> |
| `cmt_flush` | function | 287 | <code>static void cmt_flush(CmtAcc &#42;a, ParseResult &#42;pr) {</code> |
| `PARAM_MAX` | macro | 299 | <code>#define PARAM_MAX 16</code> |
| `PARAM_LEN` | macro | 300 | <code>#define PARAM_LEN 64</code> |
| `idstart` | function | 302 | <code>static bool idstart(char c);</code> |
| `idchar` | function | 303 | <code>static bool idchar(char c);</code> |
| `params_capture` | function | 313 | <code>static bool params_capture(const char &#42;after, bool cfam, bool cont,</code> |
| `add_def` | function | 368 | <code>static void add_def(ParseResult &#42;pr, const char &#42;name, size_t nlen,</code> |
| `count_args` | function | 400 | <code>static int count_args(const char &#42;clean, size_t open) {</code> |
| `add_ref` | function | 416 | <code>static void add_ref(ParseResult &#42;pr, const char &#42;name, size_t nlen, int line,</code> |
| `add_import` | function | 438 | <code>static void add_import(ParseResult &#42;pr, const char &#42;name, size_t nlen,</code> |
| `route_add` | function | 458 | <code>void route_add(ParseResult &#42;pr, const char &#42;framework, const char &#42;method,</code> |
| `parse_result_free` | function | 472 | <code>void parse_result_free(ParseResult &#42;pr) {</code> |
| `starts_with` | function | 491 | <code>static bool starts_with(const char &#42;s, const char &#42;pre) {</code> |
| `CmtRange` | typedef | 498 | <code>typedef struct { int start, end; } CmtRange;</code> |
| `cmt_mark` | function | 500 | <code>static void cmt_mark(CmtRange &#42;cr, size_t a, size_t b) {</code> |
| `CleanState` | typedef | 507 | <code>typedef struct {</code> |
| `clean_line` | function | 516 | <code>static void clean_line(const LangSpec &#42;L, const char &#42;line, size_t n,</code> |
| `idstart` | function | 593 | <code>static bool idstart(char c) { return isalpha((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `idchar` | function | 594 | <code>static bool idchar(char c)  { return isalnum((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `lang_scope_end` | function | 603 | <code>static int lang_scope_end(const LangSpec &#42;L, char &#42;const &#42;lines, int nlines,</code> |
| `SIG_SPAN` | macro | 648 | <code>#define SIG_SPAN 40</code> |
| `callable_end` | function | 649 | <code>static int callable_end(const LangSpec &#42;L, char &#42;const &#42;lines, int nlines,</code> |
| `skip_sp` | function | 706 | <code>static const char &#42;skip_sp(const char &#42;s) {</code> |
| `kw_at` | function | 711 | <code>static bool kw_at(const char &#42;s, const char &#42;kw) {</code> |
| `quoted_span` | function | 717 | <code>static bool quoted_span(const char &#42;s, const char &#42;&#42;out, size_t &#42;n) {</code> |
| `seg_name` | function | 729 | <code>static void seg_name(const char &#42;s, const char &#42;e, const char &#42;&#42;out, size_t &#42;n) {</code> |
| `imp_js` | function | 744 | <code>static void imp_js(const char &#42;line, int lineno, ParseResult &#42;pr) {</code> |
| `imp_py` | function | 780 | <code>static void imp_py(const char &#42;line, int lineno, ParseResult &#42;pr) {</code> |
| `imp_go` | function | 822 | <code>static void imp_go(const char &#42;line, int lineno, ParseResult &#42;pr, int &#42;state) {</code> |
| `imp_inc` | function | 845 | <code>static void imp_inc(const char &#42;line, int lineno, ParseResult &#42;pr) {</code> |
| `imp_rust` | function | 862 | <code>static void imp_rust(const char &#42;line, int lineno, ParseResult &#42;pr) {</code> |
| `imp_dot` | function | 898 | <code>static void imp_dot(const LangSpec &#42;L, const char &#42;line, int lineno,</code> |
| `lang_scan_imports` | function | 922 | <code>static void lang_scan_imports(const LangSpec &#42;L, const char &#42;line, int lineno,</code> |
| `lang_parse` | function | 935 | <code>void lang_parse(const char &#42;lang, const char &#42;path, const char &#42;src,</code> |

## src/progress.c

[Open source](../../src/progress.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FIRST_DRAW_MS` | macro | 28 | <code>#define FIRST_DRAW_MS  250</code> |
| `TTY_EVERY_MS` | macro | 29 | <code>#define TTY_EVERY_MS   100</code> |
| `PLAIN_EVERY_MS` | macro | 30 | <code>#define PLAIN_EVERY_MS 2000</code> |
| `WRITE_SLICE_MS` | macro | 31 | <code>#define WRITE_SLICE_MS 100</code> |
| `MAX_PHASES` | macro | 32 | <code>#define MAX_PHASES     8</code> |
| `active` | function | 54 | <code>static bool active(void) {</code> |
| `term_width` | function | 58 | <code>static int term_width(void) {</code> |
| `erase` | function | 67 | <code>static void erase(void) {</code> |
| `compose` | function | 75 | <code>static void compose(char &#42;out, size_t cap, long now) {</code> |
| `ADD` | macro | 77 | <code>#define ADD(...) do { if (n &lt; cap) &#92;</code> |
| `render` | function | 97 | <code>static void render(bool entered, bool force) {</code> |
| `at_exit_erase` | function | 134 | <code>static void at_exit_erase(void) { erase(); }</code> |
| `progress_request` | function | 136 | <code>void progress_request(bool want) {</code> |
| `progress_begin` | function | 153 | <code>void progress_begin(const IndexOpts &#42;o) {</code> |
| `progress_step` | function | 163 | <code>void progress_step(const char &#42;step) {</code> |
| `progress_phase` | function | 174 | <code>void progress_phase(const char &#42;phase, long done, long total) {</code> |
| `progress_dirs` | function | 186 | <code>void progress_dirs(long dirs) {</code> |
| `progress_tick` | function | 192 | <code>void progress_tick(long done, long total, const char &#42;path) {</code> |
| `progress_flush` | function | 201 | <code>void progress_flush(void) {</code> |
| `progress_workers` | function | 205 | <code>void progress_workers(int n) {</code> |
| `progress_wait` | function | 209 | <code>void progress_wait(const char &#42;what, long waited_ms) {</code> |
| `progress_end` | function | 220 | <code>void progress_end(void) {</code> |
| `progress_begin_write` | function | 231 | <code>int progress_begin_write(Cg &#42;cg) {</code> |

## src/resolve.c

[Open source](../../src/resolve.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ManifestDep` | typedef | 14 | <code>typedef struct { char &#42;name; } ManifestDep;</code> |
| `Manifest` | typedef | 16 | <code>typedef struct {</code> |
| `manifest_add` | function | 22 | <code>static void manifest_add(Manifest &#42;m, const char &#42;name, size_t len) {</code> |
| `manifest_free` | function | 33 | <code>static void manifest_free(Manifest &#42;m) {</code> |
| `manifest_has` | function | 39 | <code>static bool manifest_has(const Manifest &#42;m, const char &#42;module) {</code> |
| `load_package_json` | function | 54 | <code>static void load_package_json(const char &#42;root, Manifest &#42;js) {</code> |
| `load_go_mod` | function | 81 | <code>static void load_go_mod(const char &#42;root, Manifest &#42;go) {</code> |
| `load_requirements_txt` | function | 124 | <code>static void load_requirements_txt(const char &#42;root, Manifest &#42;py) {</code> |
| `load_pyproject_toml` | function | 152 | <code>static void load_pyproject_toml(const char &#42;root, Manifest &#42;py) {</code> |
| `load_cargo_toml` | function | 187 | <code>static void load_cargo_toml(const char &#42;root, Manifest &#42;rs) {</code> |
| `strip_ext` | function | 226 | <code>static void strip_ext(char &#42;buf, size_t cap, const char &#42;path) {</code> |
| `norm_dots` | function | 235 | <code>static void norm_dots(char &#42;p) {</code> |
| `find_repo_file` | function | 265 | <code>static long find_repo_file(Cg &#42;cg, const char &#42;module, const char &#42;from_path,</code> |
| `NEAR_MAX` | macro | 472 | <code>#define NEAR_MAX 32</code> |
| `NearManifest` | typedef | 473 | <code>typedef struct { char dir&#91;1024&#93;; Manifest m; bool exists; } NearManifest;</code> |
| `near_manifest_has` | function | 475 | <code>static bool near_manifest_has(Cg &#42;cg, NearManifest &#42;near, int &#42;nnear,</code> |
| `node_core_module` | function | 501 | <code>static bool node_core_module(const char &#42;module) {</code> |
| `mod_matches` | function | 522 | <code>static bool mod_matches(const char &#42;module, const char &#42;cand_path);</code> |
| `resolve_imports_run` | function | 533 | <code>static void resolve_imports_run(Cg &#42;cg, bool scoped) {</code> |
| `resolve_imports` | function | 690 | <code>void resolve_imports(Cg &#42;cg)        { resolve_imports_run(cg, false); }</code> |
| `resolve_imports_scoped` | function | 691 | <code>void resolve_imports_scoped(Cg &#42;cg) { resolve_imports_run(cg, true); }</code> |
| `C_BUILTINS` | variable | 701 | <code>static const struct { const char &#42;header; const char &#42;names; } C_BUILTINS&#91;&#93; = {</code> |
| `C_ALWAYS` | variable | 792 | <code>static const char &#42;C_ALWAYS&#91;&#93; = {</code> |
| `JS_BUILTINS` | variable | 804 | <code>static const char &#42;JS_BUILTINS&#91;&#93; = {</code> |
| `PY_BUILTINS` | variable | 850 | <code>static const char &#42;PY_BUILTINS&#91;&#93; = {</code> |
| `GO_BUILTINS` | variable | 869 | <code>static const char &#42;GO_BUILTINS&#91;&#93; = {</code> |
| `in_list` | function | 880 | <code>static bool in_list(const char &#42;const &#42;list, const char &#42;name) {</code> |
| `in_names` | function | 888 | <code>static bool in_names(const char &#42;names, const char &#42;name) {</code> |
| `C_HDR_MAX` | macro | 909 | <code>#define C_HDR_MAX 64</code> |
| `C_HDR_LEN` | macro | 910 | <code>#define C_HDR_LEN 48</code> |
| `c_load_headers` | function | 917 | <code>static void c_load_headers(Cg &#42;cg, long file_id) {</code> |
| `c_builtin` | function | 940 | <code>static bool c_builtin(Cg &#42;cg, long file_id, const char &#42;name) {</code> |
| `c_builtin_reset` | function | 952 | <code>static void c_builtin_reset(void) { c_hdrs.file_id = -1; c_hdrs.n = 0; }</code> |
| `is_resolving_lang` | function | 955 | <code>static bool is_resolving_lang(const char &#42;lang) {</code> |
| `is_builtin` | function | 962 | <code>static bool is_builtin(Cg &#42;cg, const char &#42;lang, long file_id,</code> |
| `Cand` | typedef | 980 | <code>typedef struct {</code> |
| `find_candidates` | function | 989 | <code>static int find_candidates(Cg &#42;cg, const char &#42;name, Cand &#42;out, int cap) {</code> |
| `path_stem` | function | 1013 | <code>static size_t path_stem(const char &#42;path, const char &#42;&#42;out) {</code> |
| `cand_definition` | function | 1027 | <code>static int cand_definition(const Cand &#42;c, int nc, int pick) {</code> |
| `mod_matches` | function | 1055 | <code>static bool mod_matches(const char &#42;module, const char &#42;cand_path) {</code> |
| `ImpCache` | typedef | 1092 | <code>typedef struct { char name&#91;128&#93;; char module&#91;256&#93;; } ImpCache;</code> |
| `load_imports` | function | 1094 | <code>static int load_imports(Cg &#42;cg, long file_id, ImpCache &#42;out, int cap) {</code> |
| `resolve_refs_run` | function | 1117 | <code>static void resolve_refs_run(Cg &#42;cg, bool scoped) {</code> |
| `resolve_refs` | function | 1316 | <code>void resolve_refs(Cg &#42;cg)        { resolve_refs_run(cg, false); }</code> |
| `resolve_refs_scoped` | function | 1317 | <code>void resolve_refs_scoped(Cg &#42;cg) { resolve_refs_run(cg, true); }</code> |
| `edit_distance` | function | 1322 | <code>static int edit_distance(const char &#42;a, const char &#42;b) {</code> |
| `near_miss` | function | 1340 | <code>static bool near_miss(Cg &#42;cg, const char &#42;name, char &#42;out, size_t cap) {</code> |
| `file_calibrated` | function | 1366 | <code>bool file_calibrated(Cg &#42;cg, long file_id, const char &#42;lang) {</code> |
| `ground_findings` | function | 1426 | <code>int ground_findings(Cg &#42;cg, const char &#42;path, GroundFinding &#42;&#42;out) {</code> |
| `ground_findings_free` | function | 1511 | <code>void ground_findings_free(GroundFinding &#42;v, int n) {</code> |
| `kind_callable` | function | 1519 | <code>static bool kind_callable(const char &#42;kind) {</code> |
| `contract_findings` | function | 1526 | <code>int contract_findings(Cg &#42;cg, const char &#42;path, ContractFinding &#42;&#42;out) {</code> |
| `contract_findings_free` | function | 1596 | <code>void contract_findings_free(ContractFinding &#42;v, int n) {</code> |
| `is_entrypoint` | function | 1604 | <code>bool is_entrypoint(Cg &#42;cg, long sym_id, const char &#42;name, const char &#42;kind,</code> |
| `hygiene_file` | function | 1653 | <code>static int hygiene_file(Cg &#42;cg, const char &#42;path, long file_id,</code> |
| `hygiene_findings` | function | 1719 | <code>int hygiene_findings(Cg &#42;cg, const char &#42;path, HygieneFinding &#42;&#42;out) {</code> |
| `hygiene_findings_all` | function | 1737 | <code>int hygiene_findings_all(Cg &#42;cg, HygieneFinding &#42;&#42;out, int limit) {</code> |
| `hygiene_findings_free` | function | 1753 | <code>void hygiene_findings_free(HygieneFinding &#42;v, int n) {</code> |

## src/routes.c

[Open source](../../src/routes.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RoutePat` | typedef | 15 | <code>typedef struct {</code> |
| `NRP` | macro | 120 | <code>#define NRP ((int)(sizeof RP / sizeof RP&#91;0&#93;))</code> |
| `routes_global_init` | function | 122 | <code>void routes_global_init(void) {</code> |
| `lang_in` | function | 138 | <code>static bool lang_in(const char &#42;langs, const char &#42;lang) {</code> |
| `upcase` | function | 145 | <code>static void upcase(char &#42;s) {</code> |
| `code_at` | function | 151 | <code>static bool code_at(const char &#42;s,size_t pos,const char &#42;lang) {</code> |
| `RouteLex` | typedef | 171 | <code>typedef struct {</code> |
| `scrub_route_line` | function | 185 | <code>static void scrub_route_line(const char &#42;lang,const char &#42;path,int line,</code> |
| `route_opener` | function | 239 | <code>static const char &#42;route_opener(const char &#42;s,const char &#42;lang) {</code> |
| `route_statement_complete` | function | 250 | <code>static bool route_statement_complete(const char &#42;s,size_t start) {</code> |
| `route_limit` | function | 268 | <code>static void route_limit(ParseResult &#42;pr,int line) {</code> |
| `routes_scan_line` | function | 272 | <code>void routes_scan_line(const char &#42;lang, const char &#42;path, int lineno,</code> |
| `routes_scan_file` | function | 445 | <code>void routes_scan_file(const char &#42;path, ParseResult &#42;pr) {</code> |

## src/scan.c

[Open source](../../src/scan.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MAX_FILE_BYTES` | macro | 16 | <code>#define MAX_FILE_BYTES (8L &#42; 1024 &#42; 1024)   /&#42; larger files: skip entirely &#42;/</code> |
| `MAX_FTS_BYTES` | macro | 17 | <code>#define MAX_FTS_BYTES  (2L &#42; 1024 &#42; 1024)   /&#42; larger: no body full-text &#42;/</code> |
| `RING_CAP` | macro | 18 | <code>#define RING_CAP 256</code> |
| `INDEX_CHUNK` | macro | 23 | <code>#define INDEX_CHUNK 96</code> |
| `Walked` | typedef | 28 | <code>typedef struct {</code> |
| `DbFile` | typedef | 33 | <code>typedef struct { char &#42;path; long id, size, mtime_ns; bool legacy_time;</code> |
| `stat_mtime_ns` | function | 36 | <code>static long stat_mtime_ns(const struct stat &#42;st) {</code> |
| `Done` | typedef | 44 | <code>typedef struct {</code> |
| `WalkList` | typedef | 58 | <code>typedef struct { Walked &#42;v; int n, cap; } WalkList;</code> |
| `walk_push` | function | 60 | <code>static void walk_push(WalkList &#42;wl, const char &#42;rel, long size, long mtime,</code> |
| `walk_dir` | function | 82 | <code>static void walk_dir(const char &#42;root, const char &#42;rel, const Ignore &#42;ig,</code> |
| `walked_cmp` | function | 93 | <code>static int walked_cmp(const void &#42;a, const void &#42;b) {</code> |
| `dbfile_cmp` | function | 96 | <code>static int dbfile_cmp(const void &#42;a, const void &#42;b) {</code> |
| `Pipe` | typedef | 102 | <code>typedef struct {</code> |
| `ring_push` | function | 115 | <code>static void ring_push(Pipe &#42;p, Done &#42;d) {</code> |
| `producer_done` | function | 126 | <code>static void producer_done(Pipe &#42;p) {</code> |
| `ring_pop` | function | 133 | <code>static bool ring_pop(Pipe &#42;p, Done &#42;out) {</code> |
| `worker` | function | 149 | <code>static void &#42;worker(void &#42;arg) {</code> |
| `Stmts` | typedef | 211 | <code>typedef struct {</code> |
| `stmts_init` | function | 232 | <code>static void stmts_init(Cg &#42;cg, Stmts &#42;s) {</code> |
| `step_reset` | function | 361 | <code>static void step_reset(sqlite3_stmt &#42;st);</code> |
| `scope_record_file` | function | 367 | <code>static void scope_record_file(Stmts &#42;s, long file_id, bool added) {</code> |
| `scope_name` | function | 387 | <code>static void scope_name(Stmts &#42;s, const char &#42;name) {</code> |
| `stmts_fin` | function | 393 | <code>static void stmts_fin(Stmts &#42;s) {</code> |
| `step_reset` | function | 399 | <code>static void step_reset(sqlite3_stmt &#42;st) {</code> |
| `purge_file_children` | function | 405 | <code>static int purge_file_children(Cg &#42;cg, Stmts &#42;s, long file_id) {</code> |
| `index_copy_rows` | function | 447 | <code>static int index_copy_rows(Cg &#42;cg, Stmts &#42;s, long file_id, long from,</code> |
| `write_done` | function | 481 | <code>static int write_done(Cg &#42;cg, Stmts &#42;s, const Walked &#42;w, Done &#42;d,</code> |
| `drop_skipped_file` | function | 781 | <code>static int drop_skipped_file(Cg &#42;cg, Stmts &#42;s, const Walked &#42;w,</code> |
| `soft_insert` | function | 813 | <code>static void soft_insert(sqlite3_stmt &#42;ins, long file_id, int line,</code> |
| `probe` | function | 829 | <code>static bool probe(sqlite3_stmt &#42;st, const char &#42;tok, char &#42;out, size_t cap) {</code> |
| `index_scope_begin` | function | 846 | <code>void index_scope_begin(Cg &#42;cg) {</code> |
| `index_scope_end` | function | 856 | <code>void index_scope_end(Cg &#42;cg) {</code> |
| `count_sql` | function | 861 | <code>static long count_sql(Cg &#42;cg, const char &#42;sql) {</code> |
| `index_scope_bounded` | function | 868 | <code>bool index_scope_bounded(Cg &#42;cg) {</code> |
| `scope_anchor_files` | function | 881 | <code>static void scope_anchor_files(Cg &#42;cg) {</code> |
| `SOFT_FROM` | macro | 936 | <code>#define SOFT_FROM "CASE WHEN s.decl=1 THEN NULL ELSE c.sym_id END"</code> |
| `anchor_edges_run` | function | 938 | <code>static void anchor_edges_run(Cg &#42;cg, IndexStats &#42;st, bool scoped) {</code> |
| `anchor_edges` | function | 1038 | <code>static void anchor_edges(Cg &#42;cg, IndexStats &#42;st) {</code> |
| `anchor_edges_scoped` | function | 1042 | <code>static void anchor_edges_scoped(Cg &#42;cg, IndexStats &#42;st) {</code> |
| `fts_prepurge` | function | 1052 | <code>static void fts_prepurge(Cg &#42;cg, Stmts &#42;s, Walked &#42;jobs, Done &#42;chunk, int n) {</code> |
| `semantic_retry_debt` | function | 1080 | <code>static void semantic_retry_debt(Cg &#42;cg) {</code> |
| `flush_chunk` | function | 1086 | <code>static int flush_chunk(Cg &#42;cg, Stmts &#42;s, Walked &#42;jobs, Done &#42;chunk, int n,</code> |
| `target_rel` | function | 1143 | <code>static bool target_rel(const char &#42;root, const char &#42;in, char &#42;out, size_t cap) {</code> |
| `targets_cover` | function | 1162 | <code>static bool targets_cover(char &#42;&#42;t, int nt, const char &#42;path) {</code> |
| `walk_targets` | function | 1175 | <code>static void walk_targets(const char &#42;root, const Ignore &#42;ig, char &#42;&#42;t, int nt,</code> |
| `note_targets` | function | 1204 | <code>static int note_targets(const char &#42;root, const char &#42;note, char &#42;&#42;&#42;out,</code> |
| `targets_free` | function | 1229 | <code>static void targets_free(char &#42;&#42;t, int n) {</code> |
| `index_find_twins` | function | 1240 | <code>static void index_find_twins(Cg &#42;cg, WalkList &#42;jobs, const IndexOpts &#42;o) {</code> |
| `index_pass` | function | 1277 | <code>static int index_pass(Cg &#42;cg, const SysInfo &#42;si, const IndexOpts &#42;o,</code> |
| `TRI_REPAIR_MAX` | macro | 1507 | <code>#define TRI_REPAIR_MAX 50000</code> |
| `tri_rows` | function | 1509 | <code>static long tri_rows(Cg &#42;cg) {</code> |
| `index_tri_repair` | function | 1528 | <code>static void index_tri_repair(Cg &#42;cg, long &#42;repaired) {</code> |
| `index_phase_ms` | function | 1586 | <code>void index_phase_ms(IndexStats &#42;st, int phase, long t0) {</code> |
| `index_peak_rss_kb` | function | 1591 | <code>long index_peak_rss_kb(void) {</code> |
| `index_stats_json` | function | 1600 | <code>void index_stats_json(const IndexStats &#42;st, bool targeted, StrBuf &#42;b) {</code> |
| `is_ignore_file` | function | 1625 | <code>static bool is_ignore_file(const char &#42;rel) {</code> |
| `WALK_DIRTY_MAX` | macro | 1631 | <code>#define WALK_DIRTY_MAX (256 &#42; 1024)</code> |
| `index_git_plan` | function | 1641 | <code>static bool index_git_plan(Cg &#42;cg, const IndexOpts &#42;o, const char &#42;head,</code> |
| `index_git_record` | function | 1711 | <code>static void index_git_record(Cg &#42;cg, const char &#42;head, bool gitpass) {</code> |
| `index_is_fresh` | function | 1751 | <code>static bool index_is_fresh(Cg &#42;cg, long max_age_ms) {</code> |
| `index_report` | function | 1776 | <code>static void index_report(const IndexStats &#42;st, const IndexOpts &#42;o) {</code> |
| `cg_index_ex` | function | 1810 | <code>int cg_index_ex(Cg &#42;cg, const SysInfo &#42;si, const IndexOpts &#42;o, IndexStats &#42;st) {</code> |
| `cg_index` | function | 2057 | <code>int cg_index(Cg &#42;cg, const SysInfo &#42;si, bool full, IndexStats &#42;st, bool quiet) {</code> |

## src/sem_channels.c

[Open source](../../src/sem_channels.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CHANNEL_MAX_FACTS` | macro | 9 | <code>#define CHANNEL_MAX_FACTS 100000</code> |
| `CHANNEL_MAX_FANOUT` | macro | 10 | <code>#define CHANNEL_MAX_FANOUT 32</code> |
| `ChannelFact` | typedef | 12 | <code>typedef struct {</code> |
| `ChannelFacts` | typedef | 19 | <code>typedef struct { ChannelFact &#42;v; int n, cap; } ChannelFacts;</code> |
| `facts_free` | function | 21 | <code>static void facts_free(ChannelFacts &#42;f) {</code> |
| `coldup` | function | 30 | <code>static char &#42;coldup(sqlite3_stmt &#42;q, int col) {</code> |
| `hash_bytes` | function | 35 | <code>static uint64_t hash_bytes(uint64_t h, const void &#42;data, size_t n) {</code> |
| `hash_str` | function | 41 | <code>static uint64_t hash_str(uint64_t h, const char &#42;s) {</code> |
| `hash_long` | function | 47 | <code>static uint64_t hash_long(uint64_t h, long x) {</code> |
| `local_path` | function | 51 | <code>static bool local_path(const char &#42;p) {</code> |
| `http_method` | function | 59 | <code>static bool http_method(const char &#42;s) {</code> |
| `valid_identity` | function | 65 | <code>static bool valid_identity(const char &#42;s) {</code> |
| `receiver_identity` | function | 76 | <code>static char &#42;receiver_identity(Cg &#42;cg, long file, const char &#42;value) {</code> |
| `supported` | function | 106 | <code>static bool supported(const ChannelFact &#42;f) {</code> |
| `load_facts` | function | 118 | <code>static int load_facts(Cg &#42;cg, ChannelFacts &#42;out, uint64_t &#42;digest) {</code> |
| `hash_routes` | function | 172 | <code>static int hash_routes(Cg &#42;cg, uint64_t &#42;digest) {</code> |
| `change_keys_available` | function | 196 | <code>static bool change_keys_available(Cg &#42;cg) {</code> |
| `relevant_edit` | function | 204 | <code>static bool relevant_edit(Cg &#42;cg, const long &#42;changed_files, int nfiles) {</code> |
| `edge_marker` | function | 237 | <code>static int edge_marker(Cg &#42;cg, char out&#91;64&#93;) {</code> |
| `pair_compatible` | function | 251 | <code>static bool pair_compatible(const ChannelFact &#42;a, const ChannelFact &#42;b) {</code> |
| `fact_key_cmp` | function | 260 | <code>static int fact_key_cmp(const ChannelFact &#42;a, const ChannelFact &#42;b) {</code> |
| `fact_cmp` | function | 267 | <code>static int fact_cmp(const void &#42;ap, const void &#42;bp) {</code> |
| `same_site` | function | 278 | <code>static bool same_site(const ChannelFact &#42;a, const ChannelFact &#42;b) {</code> |
| `insert_edge` | function | 282 | <code>static int insert_edge(Cg &#42;cg, sqlite3_stmt &#42;q, const ChannelFact &#42;source,</code> |
| `synthesize` | function | 310 | <code>static int synthesize(Cg &#42;cg, ChannelFacts &#42;facts) {</code> |
| `sem_channels_pass` | function | 373 | <code>int sem_channels_pass(Cg &#42;cg, const long &#42;changed_files, int nfiles) {</code> |
| `sem_channels_register` | function | 414 | <code>void sem_channels_register(void) {</code> |

## src/sem_channels.h

[Open source](../../src/sem_channels.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_CHANNELS_H` | macro | 2 | <code>#define CG_SEM_CHANNELS_H</code> |
| `sem_channels_register` | function | 10 | <code>void sem_channels_register(void);</code> |
| `sem_channels_pass` | function | 11 | <code>int sem_channels_pass(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |

## src/sem_dispatch.c

[Open source](../../src/sem_dispatch.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DISPATCH_CAP` | macro | 7 | <code>#define DISPATCH_CAP 32</code> |
| `done` | function | 9 | <code>static int done(sqlite3_stmt &#42;q) { int rc=sqlite3_step(q); sqlite3_finalize(q); return rc==SQLITE_DONE?0:-1; }</code> |
| `callback_api` | function | 11 | <code>static int callback_api(const char &#42;name) {</code> |
| `unique_symbol` | function | 21 | <code>static long unique_symbol(Cg &#42;cg, long branch, long preferred_file,</code> |
| `symbol_file` | function | 53 | <code>static long symbol_file(Cg &#42;cg,long id) {</code> |
| `edge_evidence` | function | 60 | <code>static const char &#42;edge_evidence(const char &#42;kind) {</code> |
| `edge` | function | 73 | <code>static int edge(Cg &#42;cg,long branch,long source,long target,long source_file,</code> |
| `relevant` | function | 98 | <code>static int relevant(Cg &#42;cg,const long &#42;files,int n) {</code> |
| `local_observer` | function | 149 | <code>static char &#42;local_observer(Cg &#42;cg,long file,int line) {</code> |
| `paired` | function | 190 | <code>static int paired(Cg &#42;cg,long branch,const char &#42;invoke_kind,</code> |
| `direct` | function | 250 | <code>static int direct(Cg &#42;cg,long branch,const char &#42;fact_kind,const char &#42;edge_kind,</code> |
| `interfaces` | function | 272 | <code>static int interfaces(Cg &#42;cg,long branch) {</code> |
| `form_events` | function | 320 | <code>static int form_events(Cg &#42;cg,long branch) {</code> |
| `sem_dispatch_run` | function | 385 | <code>int sem_dispatch_run(Cg &#42;cg,const long &#42;changed_files,int nfiles) {</code> |
| `sem_dispatch_register` | function | 409 | <code>void sem_dispatch_register(void) { (void)sem_pass_register("dispatch",50,sem_dispatch_run); }</code> |

## src/sem_dispatch.h

[Open source](../../src/sem_dispatch.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_DISPATCH_H` | macro | 2 | <code>#define CG_SEM_DISPATCH_H</code> |
| `sem_dispatch_run` | function | 7 | <code>int sem_dispatch_run(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |
| `sem_dispatch_register` | function | 8 | <code>void sem_dispatch_register(void);</code> |

## src/sem_flow.c

[Open source](../../src/sem_flow.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FlowNode` | typedef | 6 | <code>typedef struct {</code> |
| `FlowEdge` | typedef | 12 | <code>typedef struct {</code> |
| `FlowBoundary` | typedef | 19 | <code>typedef struct {</code> |
| `monotonic_ms` | function | 25 | <code>static long monotonic_ms(void) {</code> |
| `bounded_text_n` | function | 31 | <code>static char &#42;bounded_text_n(sqlite3_stmt &#42;q, int col, size_t cap) {</code> |
| `bounded_text` | function | 41 | <code>static char &#42;bounded_text(sqlite3_stmt &#42;q, int col) {</code> |
| `path_text` | function | 44 | <code>static char &#42;path_text(sqlite3_stmt &#42;q, int col) {</code> |
| `field` | function | 47 | <code>static void field(StrBuf &#42;b, const char &#42;key, const char &#42;val) {</code> |
| `node_index` | function | 51 | <code>static int node_index(const FlowNode &#42;v, int n, long id) {</code> |
| `node_load` | function | 55 | <code>static bool node_load(Cg &#42;cg, long branch, long id, FlowNode &#42;n) {</code> |
| `node_free` | function | 76 | <code>static void node_free(FlowNode &#42;n) {</code> |
| `edge_free` | function | 79 | <code>static void edge_free(FlowEdge &#42;e) {</code> |
| `boundary_free` | function | 84 | <code>static void boundary_free(FlowBoundary &#42;b) {</code> |
| `write_node` | function | 88 | <code>static void write_node(StrBuf &#42;b, const FlowNode &#42;n) {</code> |
| `write_edge` | function | 95 | <code>static void write_edge(StrBuf &#42;b, const FlowEdge &#42;e) {</code> |
| `write_boundary` | function | 106 | <code>static void write_boundary(StrBuf &#42;b, const FlowBoundary &#42;v) {</code> |
| `sem_flow_query` | function | 113 | <code>int sem_flow_query(Cg &#42;cg, const char &#42;mode, const char &#42;name,</code> |

## src/sem_flow.h

[Open source](../../src/sem_flow.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_FLOW_H` | macro | 2 | <code>#define CG_SEM_FLOW_H</code> |
| `SemFlowLimits` | typedef | 6 | <code>typedef struct {</code> |
| `sem_flow_query` | function | 12 | <code>int sem_flow_query(Cg &#42;cg, const char &#42;mode, const char &#42;name,</code> |

## src/sem_imports.c

[Open source](../../src/sem_imports.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PATH_CAP` | macro | 9 | <code>#define PATH_CAP 4096</code> |
| `EXPORT_DEPTH` | macro | 10 | <code>#define EXPORT_DEPTH 24</code> |
| `Binding` | typedef | 12 | <code>typedef struct {</code> |
| `Package` | typedef | 18 | <code>typedef struct { char &#42;path, &#42;name, &#42;entry; } Package;</code> |
| `ImportPass` | typedef | 20 | <code>typedef struct {</code> |
| `make_scope` | function | 27 | <code>static void make_scope(Cg &#42;cg,const long &#42;changed,int n) {</code> |
| `copy_col` | function | 64 | <code>static char &#42;copy_col(sqlite3_stmt &#42;q, int col) {</code> |
| `bind_str` | function | 68 | <code>static void bind_str(sqlite3_stmt &#42;q, int col, const char &#42;s) {</code> |
| `checked_step` | function | 72 | <code>static void checked_step(Cg &#42;cg, sqlite3_stmt &#42;q) {</code> |
| `normalize` | function | 79 | <code>static bool normalize(const char &#42;input, char out&#91;PATH_CAP&#93;) {</code> |
| `dirname_join` | function | 98 | <code>static bool dirname_join(const char &#42;from, const char &#42;module, char out&#91;PATH_CAP&#93;) {</code> |
| `exact_file` | function | 105 | <code>static long exact_file(ImportPass &#42;p, const char &#42;path) {</code> |
| `candidate_file` | function | 112 | <code>static long candidate_file(ImportPass &#42;p, const char &#42;input, const char &#42;lang) {</code> |
| `dependency` | function | 138 | <code>static void dependency(ImportPass &#42;p, long fid, const char &#42;key, const char &#42;hash,</code> |
| `file_dependency` | function | 145 | <code>static void file_dependency(ImportPass &#42;p,long source,long target) {</code> |
| `unresolved_candidates` | function | 155 | <code>static void unresolved_candidates(ImportPass &#42;p,long source,const char &#42;from,</code> |
| `config_data` | function | 170 | <code>static char &#42;config_data(ImportPass &#42;p, long fid, const char &#42;relative,</code> |
| `strip_json_comments` | function | 179 | <code>static void strip_json_comments(char &#42;data) {</code> |
| `alias_match` | function | 202 | <code>static bool alias_match(const char &#42;pattern,const char &#42;module,char capture&#91;PATH_CAP&#93;) {</code> |
| `alias_value` | function | 212 | <code>static bool alias_value(const char &#42;value,const char &#42;capture,char out&#91;PATH_CAP&#93;) {</code> |
| `config_aliases` | function | 218 | <code>static long config_aliases(ImportPass &#42;p,long fid,const char &#42;from,</code> |
| `load_packages` | function | 278 | <code>static void load_packages(ImportPass &#42;p) {</code> |
| `workspace_package` | function | 303 | <code>static long workspace_package(ImportPass &#42;p,long fid,const char &#42;from,</code> |
| `module_file` | function | 323 | <code>static long module_file(ImportPass &#42;p,long fid,const char &#42;from,const char &#42;module,</code> |
| `symbol_named` | function | 419 | <code>static long symbol_named(ImportPass &#42;p,long file,const char &#42;name) {</code> |
| `exported_symbol` | function | 431 | <code>static long exported_symbol(ImportPass &#42;p,long file,const char &#42;name,</code> |
| `update` | function | 470 | <code>static void update(ImportPass &#42;p,long id,long file,long symbol) {</code> |
| `sem_imports_pass` | function | 476 | <code>int sem_imports_pass(Cg &#42;cg,const long &#42;changed_files,int nfiles) {</code> |
| `sem_imports_register` | function | 571 | <code>void sem_imports_register(void) {</code> |
| `sem_imports_config_changed` | function | 575 | <code>bool sem_imports_config_changed(Cg &#42;cg) {</code> |

## src/sem_imports.h

[Open source](../../src/sem_imports.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_IMPORTS_H` | macro | 2 | <code>#define CG_SEM_IMPORTS_H</code> |
| `sem_imports_register` | function | 6 | <code>void sem_imports_register(void);</code> |
| `sem_imports_pass` | function | 7 | <code>int sem_imports_pass(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |
| `sem_imports_config_changed` | function | 9 | <code>bool sem_imports_config_changed(Cg &#42;cg);</code> |

## src/sem_incremental.c

[Open source](../../src/sem_incremental.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sem_pass_run` | function | 4 | <code>extern int sem_pass_run(Cg &#42;, const long &#42;, int) __attribute__((weak));</code> |
| `sem_imports_config_changed` | function | 5 | <code>extern bool sem_imports_config_changed(Cg &#42;) __attribute__((weak));</code> |
| `table_exists` | function | 7 | <code>static int table_exists(Cg &#42;cg, const char &#42;name) {</code> |
| `sem_incremental_init` | function | 16 | <code>void sem_incremental_init(Cg &#42;cg) {</code> |
| `collect` | function | 32 | <code>static void collect(Cg &#42;cg, long file_id, const char &#42;kind,</code> |
| `sem_incremental_note` | function | 57 | <code>void sem_incremental_note(Cg &#42;cg, long file_id) {</code> |
| `sem_incremental_pending` | function | 93 | <code>int sem_incremental_pending(Cg &#42;cg) {</code> |
| `sem_incremental_needs_run` | function | 103 | <code>int sem_incremental_needs_run(Cg &#42;cg) {</code> |
| `add_ids` | function | 108 | <code>static void add_ids(Cg &#42;cg, const char &#42;sql, long &#42;&#42;ids, int &#42;n, int &#42;cap) {</code> |
| `affected` | function | 125 | <code>static void affected(Cg &#42;cg, long &#42;&#42;ids, int &#42;n) {</code> |
| `collect_new` | function | 159 | <code>static void collect_new(Cg &#42;cg) {</code> |
| `long_cmp` | function | 189 | <code>static int long_cmp(const void &#42;a, const void &#42;b) {</code> |
| `sem_incremental_run` | function | 194 | <code>int sem_incremental_run(Cg &#42;cg, int force_full) {</code> |

## src/sem_incremental.h

[Open source](../../src/sem_incremental.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_INCREMENTAL_H` | macro | 2 | <code>#define CG_SEM_INCREMENTAL_H</code> |
| `sem_incremental_init` | function | 8 | <code>void sem_incremental_init(Cg &#42;cg);</code> |
| `sem_incremental_note` | function | 9 | <code>void sem_incremental_note(Cg &#42;cg, long file_id);</code> |
| `sem_incremental_pending` | function | 10 | <code>int sem_incremental_pending(Cg &#42;cg);</code> |
| `sem_incremental_needs_run` | function | 11 | <code>int sem_incremental_needs_run(Cg &#42;cg);</code> |
| `sem_incremental_run` | function | 12 | <code>int sem_incremental_run(Cg &#42;cg, int force_full);</code> |

## src/sem_inspect.c

[Open source](../../src/sem_inspect.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `INSPECT_MAX` | macro | 5 | <code>#define INSPECT_MAX 64</code> |
| `INSPECT_SCAN_MAX` | macro | 6 | <code>#define INSPECT_SCAN_MAX 512</code> |
| `INSPECT_REACH_MAX` | macro | 7 | <code>#define INSPECT_REACH_MAX 4096</code> |
| `scope` | function | 9 | <code>static Cg &#42;scope(Cg &#42;cg, Cg &#42;view, bool json) {</code> |
| `col` | function | 28 | <code>static const char &#42;col(sqlite3_stmt &#42;q, int i) {</code> |
| `item` | function | 33 | <code>static void item(Cg &#42;cg, StrBuf &#42;b, long id) {</code> |
| `hierarchy_set` | function | 52 | <code>static void hierarchy_set(Cg &#42;cg, StrBuf &#42;b, const char &#42;key,</code> |
| `cmd_sem_hierarchy` | function | 67 | <code>int cmd_sem_hierarchy(Cg &#42;cg, const char &#42;name, int limit, bool json) {</code> |
| `table_exists` | function | 109 | <code>static bool table_exists(Cg &#42;cg, const char &#42;table) {</code> |
| `generated_path` | function | 118 | <code>static bool generated_path(const char &#42;path) {</code> |
| `test_root` | function | 124 | <code>static bool test_root(const char &#42;path) {</code> |
| `entry_root` | function | 130 | <code>static bool entry_root(const char &#42;path, const char &#42;name) {</code> |
| `reachability` | function | 137 | <code>static int reachability(Cg &#42;cg, int budget) {</code> |
| `yes` | function | 170 | <code>static bool yes(Cg &#42;cg, sqlite3_stmt &#42;q, long id) {</code> |
| `reason` | function | 177 | <code>static void reason(StrBuf &#42;b, bool &#42;first, const char &#42;code) {</code> |
| `cmd_sem_unreferenced` | function | 182 | <code>int cmd_sem_unreferenced(Cg &#42;cg, const char &#42;path, int limit, bool json) {</code> |

## src/sem_inspect.h

[Open source](../../src/sem_inspect.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_INSPECT_H` | macro | 2 | <code>#define CG_SEM_INSPECT_H</code> |
| `cmd_sem_hierarchy` | function | 5 | <code>int cmd_sem_hierarchy(Cg &#42;cg, const char &#42;name, int limit, bool json);</code> |
| `cmd_sem_unreferenced` | function | 6 | <code>int cmd_sem_unreferenced(Cg &#42;cg, const char &#42;path, int limit, bool json);</code> |

## src/sem_resolve.c

[Open source](../../src/sem_resolve.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MAX_CANDIDATES` | macro | 10 | <code>#define MAX_CANDIDATES 128</code> |
| `Candidate` | typedef | 11 | <code>typedef struct {</code> |
| `col` | function | 18 | <code>static const char &#42;col(sqlite3_stmt &#42;q, int n) {</code> |
| `signature_arity` | function | 25 | <code>static void signature_arity(const char &#42;sig, int &#42;minimum, int &#42;maximum) {</code> |
| `nearest_class` | function | 53 | <code>static long nearest_class(Cg &#42;cg, long owner) {</code> |
| `symbol_parent` | function | 78 | <code>static long symbol_parent(Cg &#42;cg, long symbol_id) {</code> |
| `binding_target` | function | 88 | <code>static long binding_target(Cg &#42;cg, long file_id, const char &#42;receiver,</code> |
| `call_import` | function | 106 | <code>static void call_import(Cg &#42;cg, long file_id, const char &#42;name,</code> |
| `normalize_module_path` | function | 133 | <code>static void normalize_module_path(char &#42;out, size_t cap,</code> |
| `module_file_match` | function | 155 | <code>static int module_file_match(const char &#42;candidate, const char &#42;source,</code> |
| `typed_owner` | function | 165 | <code>static long typed_owner(Cg &#42;cg, long file_id, long lexical_owner,</code> |
| `candidates` | function | 196 | <code>static int candidates(Cg &#42;cg, const char &#42;name, Candidate &#42;out, int address) {</code> |
| `bind_nullable_id` | function | 230 | <code>static void bind_nullable_id(sqlite3_stmt &#42;q, int colno, long id) {</code> |
| `sem_resolve_run` | function | 235 | <code>int sem_resolve_run(Cg &#42;cg, const long &#42;changed_files, int nfiles) {</code> |
| `sem_resolve_register` | function | 481 | <code>int sem_resolve_register(void) {</code> |

## src/sem_resolve.h

[Open source](../../src/sem_resolve.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_RESOLVE_H` | macro | 2 | <code>#define CG_SEM_RESOLVE_H</code> |
| `sem_resolve_register` | function | 7 | <code>int sem_resolve_register(void);</code> |
| `sem_resolve_run` | function | 8 | <code>int sem_resolve_run(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |

## src/sem_routes.c

[Open source](../../src/sem_routes.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sem_pass_register` | function | 8 | <code>int sem_pass_register(const char &#42;name,int order,</code> |
| `ensure_route_schema` | function | 31 | <code>static void ensure_route_schema(Cg &#42;cg) {</code> |
| `step_done` | function | 44 | <code>static int step_done(sqlite3_stmt &#42;q) {</code> |
| `sem_routes_purge_file` | function | 53 | <code>int sem_routes_purge_file(Cg &#42;cg,long file_id) {</code> |
| `exact_symbol` | function | 85 | <code>static long exact_symbol(Cg &#42;cg, long file, const char &#42;name, int &#42;count) {</code> |
| `resolve_handler` | function | 95 | <code>static long resolve_handler(Cg &#42;cg,long file,const char &#42;fw,const char &#42;handler,int &#42;count) {</code> |
| `adjacent_handler` | function | 179 | <code>static long adjacent_handler(Cg &#42;cg,long file,int line,int &#42;count) {</code> |
| `sole_default_handler` | function | 195 | <code>static long sole_default_handler(Cg &#42;cg,long file,int &#42;count) {</code> |
| `source_line` | function | 207 | <code>static bool source_line(Cg &#42;cg,const char &#42;path,int want,char out&#91;4096&#93;) {</code> |
| `source_column` | function | 218 | <code>static int source_column(Cg &#42;cg,const char &#42;path,int line,</code> |
| `receiver_is` | function | 235 | <code>static bool receiver_is(const char &#42;line,const char &#42;name) {</code> |
| `affected` | function | 246 | <code>static bool affected(Cg &#42;cg,const long &#42;changed,int n) {</code> |
| `compose_mounts` | function | 266 | <code>static int compose_mounts(Cg &#42;cg) {</code> |
| `link_navigation` | function | 350 | <code>static int link_navigation(Cg &#42;cg) {</code> |
| `sem_routes_pass` | function | 394 | <code>int sem_routes_pass(Cg &#42;cg,const long &#42;changed_files,int nfiles) {</code> |
| `sem_routes_register` | function | 570 | <code>void sem_routes_register(void) { sem_pass_register("routes",40,sem_routes_pass); }</code> |
| `sem_route_lookup_unique` | function | 572 | <code>int sem_route_lookup_unique(Cg &#42;cg,const char &#42;method,const char &#42;path,</code> |

## src/sem_routes.h

[Open source](../../src/sem_routes.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_ROUTES_H` | macro | 2 | <code>#define CG_SEM_ROUTES_H</code> |
| `SemRouteMatch` | typedef | 6 | <code>typedef struct {</code> |
| `sem_routes_register` | function | 14 | <code>void sem_routes_register(void);</code> |
| `sem_routes_pass` | function | 15 | <code>int sem_routes_pass(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |
| `sem_routes_purge_file` | function | 16 | <code>int sem_routes_purge_file(Cg &#42;cg, long file_id);</code> |
| `sem_route_lookup_unique` | function | 20 | <code>int sem_route_lookup_unique(Cg &#42;cg, const char &#42;method, const char &#42;path,</code> |

## src/sem_search.c

[Open source](../../src/sem_search.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sem_search_filter_set` | function | 8 | <code>void sem_search_filter_set(Cg &#42;cg, const char &#42;kind, const char &#42;name) {</code> |
| `sem_search_filter_kind` | function | 13 | <code>const char &#42;sem_search_filter_kind(const Cg &#42;cg) {</code> |
| `sem_search_filter_name` | function | 16 | <code>const char &#42;sem_search_filter_name(const Cg &#42;cg) {</code> |
| `typo_one` | function | 20 | <code>static bool typo_one(const char &#42;a, const char &#42;b) {</code> |
| `sem_search_schema_init` | function | 37 | <code>int sem_search_schema_init(Cg &#42;cg) {</code> |
| `post_name` | function | 51 | <code>static int post_name(sqlite3_stmt &#42;put, long sid, long fid, const char &#42;name) {</code> |
| `sem_search_file_purge` | function | 75 | <code>int sem_search_file_purge(Cg &#42;cg, long file_id) {</code> |
| `sem_search_file_replace` | function | 84 | <code>int sem_search_file_replace(Cg &#42;cg, long file_id) {</code> |
| `sem_search_file_copy` | function | 110 | <code>int sem_search_file_copy(Cg &#42;cg, long source_file_id, long dest_file_id) {</code> |
| `seen` | function | 115 | <code>static bool seen(const SemSearchHit &#42;v, int n, long id) {</code> |
| `lookup_stage` | function | 120 | <code>static int lookup_stage(Cg &#42;cg, const char &#42;term, const char &#42;kind,</code> |
| `sem_search_lookup` | function | 164 | <code>int sem_search_lookup(Cg &#42;cg, const char &#42;term, const char &#42;kind,</code> |

## src/sem_search.h

[Open source](../../src/sem_search.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_SEARCH_H` | macro | 2 | <code>#define CG_SEM_SEARCH_H</code> |
| `sem_search_schema_init` | function | 8 | <code>int sem_search_schema_init(Cg &#42;cg);</code> |
| `sem_search_file_replace` | function | 9 | <code>int sem_search_file_replace(Cg &#42;cg, long file_id);</code> |
| `sem_search_file_copy` | function | 10 | <code>int sem_search_file_copy(Cg &#42;cg, long source_file_id, long dest_file_id);</code> |
| `sem_search_file_purge` | function | 11 | <code>int sem_search_file_purge(Cg &#42;cg, long file_id);</code> |
| `SemMatch` | typedef | 13 | <code>typedef enum { SEM_MATCH_EXACT, SEM_MATCH_SEGMENT, SEM_MATCH_TYPO } SemMatch;</code> |
| `SemSearchHit` | typedef | 14 | <code>typedef struct { long symbol_id; SemMatch match; } SemSearchHit;</code> |
| `sem_search_lookup` | function | 18 | <code>int sem_search_lookup(Cg &#42;cg, const char &#42;term, const char &#42;kind,</code> |
| `sem_search_filter_set` | function | 20 | <code>void sem_search_filter_set(Cg &#42;cg, const char &#42;kind, const char &#42;name);</code> |
| `sem_search_filter_kind` | function | 21 | <code>const char &#42;sem_search_filter_kind(const Cg &#42;cg);</code> |
| `sem_search_filter_name` | function | 22 | <code>const char &#42;sem_search_filter_name(const Cg &#42;cg);</code> |

## src/sem_types.c

[Open source](../../src/sem_types.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `TYPE_MAX_CANDIDATES` | macro | 6 | <code>#define TYPE_MAX_CANDIDATES 64</code> |
| `TYPE_MAX_WALK` | macro | 7 | <code>#define TYPE_MAX_WALK 256</code> |
| `relation_kind` | function | 9 | <code>static const char &#42;relation_kind(const char &#42;kind) {</code> |
| `is_type_kind` | function | 20 | <code>static bool is_type_kind(const char &#42;s) {</code> |
| `canonical_name` | function | 31 | <code>static bool canonical_name(const char &#42;src, char out&#91;256&#93;) {</code> |
| `Candidate` | typedef | 58 | <code>typedef struct { long id, file_id, parent_id; int score; } Candidate;</code> |
| `candidate_allowed` | function | 60 | <code>static bool candidate_allowed(const char &#42;relation, const char &#42;kind,</code> |
| `resolve_target` | function | 79 | <code>static long resolve_target(Cg &#42;cg, long owner_id, long file_id,</code> |
| `resolve_override` | function | 131 | <code>static long resolve_override(Cg &#42;cg,long method,const char &#42;spelling) {</code> |
| `insert_edge` | function | 162 | <code>static int insert_edge(Cg &#42;cg, sqlite3_stmt &#42;q, long source_file,</code> |
| `sem_types_run` | function | 182 | <code>int sem_types_run(Cg &#42;cg, const long &#42;changed_files, int nfiles) {</code> |
| `sem_types_register` | function | 341 | <code>int sem_types_register(void) {</code> |
| `walk` | function | 345 | <code>static int walk(Cg &#42;cg,long start,long &#42;out,int cap,bool reverse) {</code> |
| `sem_type_ancestors` | function | 370 | <code>int sem_type_ancestors(Cg &#42;cg,long id,long &#42;out,int cap) {</code> |
| `sem_type_subtypes` | function | 373 | <code>int sem_type_subtypes(Cg &#42;cg,long id,long &#42;out,int cap) {</code> |
| `sem_type_implementations` | function | 376 | <code>int sem_type_implementations(Cg &#42;cg,long id,long &#42;out,int cap) {</code> |

## src/sem_types.h

[Open source](../../src/sem_types.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEM_TYPES_H` | macro | 2 | <code>#define CG_SEM_TYPES_H</code> |
| `sem_types_register` | function | 7 | <code>int sem_types_register(void);</code> |
| `sem_types_run` | function | 8 | <code>int sem_types_run(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |
| `sem_type_ancestors` | function | 12 | <code>int sem_type_ancestors(Cg &#42;cg, long symbol_id, long &#42;out, int cap);</code> |
| `sem_type_subtypes` | function | 13 | <code>int sem_type_subtypes(Cg &#42;cg, long symbol_id, long &#42;out, int cap);</code> |
| `sem_type_implementations` | function | 14 | <code>int sem_type_implementations(Cg &#42;cg, long interface_id, long &#42;out, int cap);</code> |

## src/semantic.c

[Open source](../../src/semantic.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `dup` | function | 3 | <code>static char &#42;dup(const char &#42;s) { return s ? xstrdup(s) : NULL; }</code> |
| `grow` | function | 4 | <code>static void &#42;grow(void &#42;p, int &#42;cap, int n, size_t size) {</code> |
| `sem_symbol_add` | function | 10 | <code>SemSymbol &#42;sem_symbol_add(SemResult &#42;r, const char &#42;name, const char &#42;kind,</code> |
| `sem_reference_add` | function | 19 | <code>SemReference &#42;sem_reference_add(SemResult &#42;r, const char &#42;text,</code> |
| `sem_binding_add` | function | 29 | <code>SemBinding &#42;sem_binding_add(SemResult &#42;r, const char &#42;module,</code> |
| `sem_type_fact_add` | function | 39 | <code>SemTypeFact &#42;sem_type_fact_add(SemResult &#42;r, const char &#42;name,</code> |
| `sem_edge_add` | function | 48 | <code>SemEdge &#42;sem_edge_add(SemResult &#42;r, const char &#42;kind, int source,</code> |
| `sem_result_free` | function | 58 | <code>void sem_result_free(SemResult &#42;r) {</code> |
| `sem_search_schema_init` | function | 169 | <code>extern int sem_search_schema_init(Cg &#42;cg) __attribute__((weak));</code> |
| `sem_search_file_replace` | function | 170 | <code>extern int sem_search_file_replace(Cg &#42;cg, long file_id) __attribute__((weak));</code> |
| `sem_search_file_copy` | function | 171 | <code>extern int sem_search_file_copy(Cg &#42;cg, long source_file_id,</code> |
| `sem_search_file_purge` | function | 173 | <code>extern int sem_search_file_purge(Cg &#42;cg, long file_id) __attribute__((weak));</code> |
| `sem_routes_purge_file` | function | 174 | <code>extern int sem_routes_purge_file(Cg &#42;cg, long file_id) __attribute__((weak));</code> |
| `sem_schema_init` | function | 175 | <code>int sem_schema_init(Cg &#42;cg) {</code> |
| `bind_text` | function | 180 | <code>static void bind_text(sqlite3_stmt &#42;q, int n, const char &#42;s) {</code> |
| `bind_id` | function | 184 | <code>static void bind_id(sqlite3_stmt &#42;q, int n, long id) {</code> |
| `bind_span` | function | 188 | <code>static void bind_span(sqlite3_stmt &#42;q, int n, SemSpan s) {</code> |
| `done` | function | 195 | <code>static void done(Cg &#42;cg, sqlite3_stmt &#42;q) {</code> |
| `sem_file_purge` | function | 206 | <code>int sem_file_purge(Cg &#42;cg, long file_id) {</code> |
| `mapped` | function | 239 | <code>static long mapped(const long &#42;ids, int n, int index) {</code> |
| `sem_file_replace` | function | 243 | <code>int sem_file_replace(Cg &#42;cg, long file_id, const SemResult &#42;r,</code> |
| `sem_file_copy` | function | 365 | <code>int sem_file_copy(Cg &#42;cg, long file_id, long twin_file_id) {</code> |
| `SEM_MAX_PASSES` | macro | 437 | <code>#define SEM_MAX_PASSES 16</code> |
| `sem_imports_register` | function | 442 | <code>extern void sem_imports_register(void) __attribute__((weak));</code> |
| `sem_resolve_register` | function | 443 | <code>extern void sem_resolve_register(void) __attribute__((weak));</code> |
| `sem_types_register` | function | 444 | <code>extern int sem_types_register(void) __attribute__((weak));</code> |
| `sem_routes_register` | function | 445 | <code>extern void sem_routes_register(void) __attribute__((weak));</code> |
| `sem_dispatch_register` | function | 446 | <code>extern void sem_dispatch_register(void) __attribute__((weak));</code> |
| `sem_channels_register` | function | 447 | <code>extern void sem_channels_register(void) __attribute__((weak));</code> |
| `register_available` | function | 448 | <code>static void register_available(void) {</code> |
| `sem_pass_register` | function | 459 | <code>int sem_pass_register(const char &#42;name, int order, SemPassFn fn) {</code> |
| `sem_pass_run` | function | 467 | <code>int sem_pass_run(Cg &#42;cg, const long &#42;changed_files, int nfiles) {</code> |

## src/semantic.h

[Open source](../../src/semantic.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_SEMANTIC_H` | macro | 2 | <code>#define CG_SEMANTIC_H</code> |
| `SemSpan` | typedef | 12 | <code>typedef struct {</code> |
| `SemSymbol` | typedef | 17 | <code>typedef struct {</code> |
| `SemReference` | typedef | 27 | <code>typedef struct {</code> |
| `SemBinding` | typedef | 36 | <code>typedef struct {</code> |
| `SemTypeFact` | typedef | 44 | <code>typedef struct {</code> |
| `SemEdge` | typedef | 50 | <code>typedef struct {</code> |
| `SemResult` | typedef | 59 | <code>typedef struct {</code> |
| `sem_symbol_add` | function | 71 | <code>SemSymbol &#42;sem_symbol_add(SemResult &#42;r, const char &#42;name, const char &#42;kind,</code> |
| `sem_reference_add` | function | 73 | <code>SemReference &#42;sem_reference_add(SemResult &#42;r, const char &#42;text,</code> |
| `sem_binding_add` | function | 75 | <code>SemBinding &#42;sem_binding_add(SemResult &#42;r, const char &#42;module,</code> |
| `sem_type_fact_add` | function | 77 | <code>SemTypeFact &#42;sem_type_fact_add(SemResult &#42;r, const char &#42;name,</code> |
| `sem_edge_add` | function | 79 | <code>SemEdge &#42;sem_edge_add(SemResult &#42;r, const char &#42;kind, int source,</code> |
| `sem_result_free` | function | 81 | <code>void sem_result_free(SemResult &#42;r);</code> |
| `sem_schema_init` | function | 84 | <code>int sem_schema_init(Cg &#42;cg);</code> |
| `sem_file_replace` | function | 85 | <code>int sem_file_replace(Cg &#42;cg, long file_id, const SemResult &#42;r,</code> |
| `sem_file_copy` | function | 88 | <code>int sem_file_copy(Cg &#42;cg, long file_id, long twin_file_id);</code> |
| `sem_file_purge` | function | 89 | <code>int sem_file_purge(Cg &#42;cg, long file_id);</code> |
| `SemPassFn` | typedef | 92 | <code>typedef int (&#42;SemPassFn)(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |
| `sem_pass_register` | function | 93 | <code>int sem_pass_register(const char &#42;name, int order, SemPassFn fn);</code> |
| `sem_pass_run` | function | 94 | <code>int sem_pass_run(Cg &#42;cg, const long &#42;changed_files, int nfiles);</code> |

## src/syncgate.c

[Open source](../../src/syncgate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GATE_POLL_MS` | macro | 38 | <code>#define GATE_POLL_MS 40</code> |
| `DIRTY_MAX_BYTES` | macro | 39 | <code>#define DIRTY_MAX_BYTES (256 &#42; 1024)</code> |
| `gate_path` | function | 46 | <code>static void gate_path(const Cg &#42;cg, const char &#42;name, char &#42;out, size_t cap) {</code> |
| `sleep_ms` | function | 57 | <code>static void sleep_ms(long ms) {</code> |
| `syncgate_acquire` | function | 64 | <code>int syncgate_acquire(const Cg &#42;cg, long wait_ms) {</code> |
| `syncgate_release` | function | 83 | <code>void syncgate_release(int fd) {</code> |
| `dirty_lock` | function | 90 | <code>static int dirty_lock(const Cg &#42;cg) {</code> |
| `syncgate_mark_dirty` | function | 100 | <code>void syncgate_mark_dirty(const Cg &#42;cg, const char &#42;const &#42;paths, int npaths) {</code> |
| `syncgate_is_dirty` | function | 125 | <code>bool syncgate_is_dirty(const Cg &#42;cg) {</code> |
| `syncgate_take_dirty` | function | 136 | <code>char &#42;syncgate_take_dirty(const Cg &#42;cg) {</code> |
| `slot_dir` | function | 154 | <code>static int slot_dir(char &#42;out, size_t cap) {</code> |
| `syncgate_slot_count` | function | 165 | <code>int syncgate_slot_count(const SysInfo &#42;si) {</code> |
| `syncgate_slot_acquire` | function | 173 | <code>int syncgate_slot_acquire(const SysInfo &#42;si) {</code> |
| `syncgate_slot_release` | function | 188 | <code>void syncgate_slot_release(int fd) {</code> |
| `syncgate_worker_request` | function | 192 | <code>int syncgate_worker_request(const char &#42;root, const SysInfo &#42;si, int flag,</code> |
| `syncgate_worker_budget` | function | 214 | <code>int syncgate_worker_budget(const char &#42;root, const SysInfo &#42;si,</code> |
| `syncgate_background_nice` | function | 237 | <code>void syncgate_background_nice(void) {</code> |

## src/walk.c

[Open source](../../src/walk.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `WalkShared` | typedef | 34 | <code>typedef struct {</code> |
| `WalkLocal` | typedef | 48 | <code>typedef struct {</code> |
| `stat_mtime_ns` | function | 54 | <code>static long stat_mtime_ns(const struct stat &#42;st) {</code> |
| `local_push` | function | 62 | <code>static void local_push(WalkLocal &#42;l, const char &#42;rel, long size, long mtime,</code> |
| `queue_dir` | function | 76 | <code>static void queue_dir(WalkShared &#42;sh, const char &#42;rel) {</code> |
| `walk_one` | function | 86 | <code>static void walk_one(WalkLocal &#42;l, const char &#42;rel) {</code> |
| `walk_thread` | function | 143 | <code>static void &#42;walk_thread(void &#42;arg) {</code> |
| `entry_cmp` | function | 168 | <code>static int entry_cmp(const void &#42;a, const void &#42;b) {</code> |
| `walk_threads_default` | function | 172 | <code>int walk_threads_default(int budget) {</code> |
| `walk_parallel` | function | 180 | <code>void walk_parallel(const char &#42;root, const char &#42;rel, const Ignore &#42;ig,</code> |
| `walkset_free` | function | 252 | <code>void walkset_free(WalkSet &#42;w) {</code> |

## src/watch.c

[Open source](../../src/watch.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Watch` | typedef | 20 | <code>typedef struct { int wd; char &#42;rel; } Watch;</code> |
| `Watcher` | typedef | 21 | <code>typedef struct {</code> |
| `IN_MASK` | macro | 31 | <code>#define IN_MASK (IN_CREATE &#124; IN_CLOSE_WRITE &#124; IN_DELETE &#124; IN_MOVED_FROM &#124; &#92;</code> |
| `watch_loss` | function | 34 | <code>static void watch_loss(Watcher &#42;w, const char &#42;reason) {</code> |
| `watch_add_dir` | function | 41 | <code>static void watch_add_dir(Watcher &#42;w, const char &#42;rel) {</code> |
| `watch_forget` | function | 93 | <code>static void watch_forget(Watcher &#42;w, int wd) {</code> |
| `wd_rel` | function | 104 | <code>static const char &#42;wd_rel(Watcher &#42;w, int wd) {</code> |
| `WATCH_MAX_TARGETS` | macro | 114 | <code>#define WATCH_MAX_TARGETS 256</code> |
| `Pending` | typedef | 115 | <code>typedef struct { char &#42;&#42;v; int n; bool whole; } Pending;</code> |
| `pending_add` | function | 117 | <code>static void pending_add(Pending &#42;p, const char &#42;rel) {</code> |
| `pending_clear` | function | 126 | <code>static void pending_clear(Pending &#42;p) {</code> |
| `watch_drain` | function | 136 | <code>static bool watch_drain(Watcher &#42;w, Pending &#42;pend) {</code> |
| `WATCH_RECONCILE_MS` | macro | 178 | <code>#define WATCH_RECONCILE_MS 30000</code> |
| `watch_sync` | function | 179 | <code>static int watch_sync(Cg &#42;cg, const SysInfo &#42;si, const Pending &#42;p,</code> |
| `watch_interval` | function | 181 | <code>static long watch_interval(void) {</code> |
| `watch_rearm` | function | 191 | <code>static void watch_rearm(Watcher &#42;w, Pending &#42;pend) {</code> |
| `watch_attempt` | function | 199 | <code>static bool watch_attempt(Cg &#42;cg, const SysInfo &#42;si, Watcher &#42;w,</code> |
| `watch_sync` | function | 247 | <code>static int watch_sync(Cg &#42;cg, const SysInfo &#42;si, const Pending &#42;p,</code> |
| `watch_auto_off` | function | 263 | <code>static bool watch_auto_off(const char &#42;root) {</code> |
| `cmd_watch` | function | 271 | <code>int cmd_watch(Cg &#42;cg, const SysInfo &#42;si, int debounce_ms) {</code> |
| `FleetWatch` | typedef | 385 | <code>typedef struct {</code> |
| `FLEET_POLL_MS` | macro | 398 | <code>#define FLEET_POLL_MS 3000</code> |
| `fleet_watch_open` | function | 400 | <code>static FleetWatch &#42;fleet_watch_open(const Cg &#42;parent, long id,</code> |
| `fleet_watch_close` | function | 427 | <code>static void fleet_watch_close(FleetWatch &#42;f) {</code> |
| `fleet_scan` | function | 440 | <code>static void fleet_scan(Cg &#42;cg, FleetWatch &#42;&#42;&#42;pv, int &#42;pn) {</code> |
| `watch_fleet` | function | 497 | <code>int watch_fleet(Cg &#42;cg, const SysInfo &#42;si, int debounce_ms) {</code> |
| `portable_pause` | function | 600 | <code>static void portable_pause(int ms) {</code> |
| `portable_sync` | function | 605 | <code>static void portable_sync(Cg &#42;cg, const SysInfo &#42;si) {</code> |
| `watch_fleet` | function | 621 | <code>int watch_fleet(Cg &#42;cg, const SysInfo &#42;si, int debounce_ms) {</code> |
| `cmd_watch` | function | 645 | <code>int cmd_watch(Cg &#42;cg, const SysInfo &#42;si, int debounce_ms) {</code> |

## src/watch_health.c

[Open source](../../src/watch_health.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `marker_path` | function | 8 | <code>static void marker_path(const Cg &#42;cg, char &#42;path, size_t cap, bool lock) {</code> |
| `lock_marker` | function | 17 | <code>static int lock_marker(const Cg &#42;cg) {</code> |
| `unlock_marker` | function | 26 | <code>static void unlock_marker(int fd) { flock(fd, LOCK_UN); close(fd); }</code> |
| `read_locked` | function | 28 | <code>static bool read_locked(const Cg &#42;cg, WatchHealth &#42;out) {</code> |
| `watch_health_read` | function | 49 | <code>bool watch_health_read(const Cg &#42;cg, WatchHealth &#42;out) {</code> |
| `write_locked` | function | 57 | <code>static bool write_locked(const Cg &#42;cg, bool pending,</code> |
| `watch_health_mark` | function | 72 | <code>bool watch_health_mark(const Cg &#42;cg, const char &#42;reason) {</code> |
| `watch_health_clear_if` | function | 82 | <code>bool watch_health_clear_if(const Cg &#42;cg, unsigned long long generation) {</code> |

## src/watch_health.h

[Open source](../../src/watch_health.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_WATCH_HEALTH_H` | macro | 2 | <code>#define CG_WATCH_HEALTH_H</code> |
| `WatchHealth` | typedef | 5 | <code>typedef struct {</code> |
| `watch_health_mark` | function | 13 | <code>bool watch_health_mark(const Cg &#42;cg, const char &#42;reason);</code> |
| `watch_health_read` | function | 14 | <code>bool watch_health_read(const Cg &#42;cg, WatchHealth &#42;out);</code> |
| `watch_health_clear_if` | function | 15 | <code>bool watch_health_clear_if(const Cg &#42;cg, unsigned long long generation);</code> |
