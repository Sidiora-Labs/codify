# Test and fixture reference

These are test-only declarations, not supported product APIs or live Hyperfide HTTP endpoints. Route observations (kind `route`) are excluded for that reason: those under `tests/fixtures/`, such as `GET /api/tasks`, `GET /users` and `POST /users`, come from fixture applications that test extraction and that Hyperfide does not start, and those under `tests/hyperfide/` and in `tests/semantic/run.py` are not routes at all but route patterns misreading dictionary `.get()` calls and path strings in those test scripts.

This baseline was regenerated at revision `a2a367f9` (2026-10-17) of the Hyperfide 2.0 development tree, whose binary reports `hyperfide version` 2.0.0-dev. No generator script exists in the tree, and `hyperfide docs packet` declines to write a packet in this revision. The tables were produced the same way as the [source reference](SOURCE-REFERENCE.md), with the same declaration kinds and the same rule for top-level constants and exported top-level variables, covering every file that `graph_path_is_test()` in [src/graph.c](../src/graph.c) classifies as a test. Local bindings (other `variable` and `object` rows, `action` rows, and functions nested in another function, such as helpers defined inside a Python test function) are omitted, as are the fixture-only extraction kinds `attribute`, `block`, `component`, `contract`, `event`, `impl`, `mapper`, `paragraph`, `program`, `query`, `record` and `statement`. Test files with no declaration left are not listed. The binary is invoked as `hyperfide`; `cg` remains a deprecated compatibility alias for the same executable.

The baseline contains 2712 declarations in 285 files. Source links and line numbers refer to revision `a2a367f9`; rerun the workflow after implementation changes. The declaration column quotes the source line at the indexed location and may be only the first line of a multiline declaration; quotes longer than 200 characters are cut and end in `…`. It is not an inferred behavioral contract.

For shipped modules, see the [source reference](SOURCE-REFERENCE.md). The [testing instructions](../CONTRIBUTING.md#tests) explain how the integration tests run the binary in temporary repositories.

## kvx/impl/go/kvx_test.go

[Open source](../kvx/impl/go/kvx_test.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `mustParse` | function | 31 | <code>func mustParse(t &#42;testing.T, src string) &#42;Doc {</code> |
| `TestParseBasics` | function | 40 | <code>func TestParseBasics(t &#42;testing.T) {</code> |
| `TestOrderPreserved` | function | 65 | <code>func TestOrderPreserved(t &#42;testing.T) {</code> |
| `TestSectionsWithPrefix` | function | 77 | <code>func TestSectionsWithPrefix(t &#42;testing.T) {</code> |
| `TestSortDottedIDs` | function | 85 | <code>func TestSortDottedIDs(t &#42;testing.T) {</code> |
| `TestIsList` | function | 94 | <code>func TestIsList(t &#42;testing.T) {</code> |
| `TestDuplicateKeyLastWins` | function | 104 | <code>func TestDuplicateKeyLastWins(t &#42;testing.T) {</code> |
| `TestParseErrors` | function | 114 | <code>func TestParseErrors(t &#42;testing.T) {</code> |
| `TestCanonicalFixedPoint` | function | 128 | <code>func TestCanonicalFixedPoint(t &#42;testing.T) {</code> |
| `TestConformanceCorpus` | function | 140 | <code>func TestConformanceCorpus(t &#42;testing.T) {</code> |

## tests/fixtures/acp/dom-shim.js

[Open source](../tests/fixtures/acp/dom-shim.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `matches` | function | 6 | <code>function matches(el, sel) {</code> |
| `El` | class | 25 | <code>class El {</code> |
| `constructor` | method | 26 | <code>constructor(tag) {</code> |
| `add` | method | 39 | <code>add(...c) { c.forEach((x) =&gt; this._s.add(x)); self._sync(); },</code> |
| `remove` | method | 40 | <code>remove(...c) { c.forEach((x) =&gt; this._s.delete(x)); self._sync(); },</code> |
| `contains` | method | 41 | <code>contains(c) { return this._s.has(c); },</code> |
| `toggle` | method | 42 | <code>toggle(c, on) {</code> |
| `_sync` | method | 49 | <code>_sync() { this.attrs.class = &#91;...this.classList._s&#93;.join(' '); }</code> |
| `id` | method | 52 | <code>set id(v) { this._id = v; doc._byId.set(v, this); }</code> |
| `id` | method | 53 | <code>get id() { return this._id &#124;&#124; ''; }</code> |
| `className` | method | 54 | <code>set className(v) {</code> |
| `className` | method | 58 | <code>get className() { return &#91;...this.classList._s&#93;.join(' '); }</code> |
| `textContent` | method | 59 | <code>set textContent(v) { this.children = &#91;&#93;; this._text = String(v); }</code> |
| `textContent` | method | 60 | <code>get textContent() {</code> |
| `childElementCount` | method | 63 | <code>get childElementCount() { return this.children.length; }</code> |
| `appendChild` | method | 64 | <code>appendChild(c) { c.parent = this; this.children.push(c); return c; }</code> |
| `insertBefore` | method | 65 | <code>insertBefore(c, ref) {</code> |
| `firstChild` | method | 71 | <code>get firstChild() { return this.children&#91;0&#93; &#124;&#124; null; }</code> |
| `removeChild` | method | 72 | <code>removeChild(c) {</code> |
| `remove` | method | 76 | <code>remove() {</code> |
| `addEventListener` | method | 80 | <code>addEventListener(ev, fn) {</code> |
| `dispatch` | method | 83 | <code>dispatch(ev, arg) {</code> |
| `preventDefault` | method | 85 | <code>Object.assign({ preventDefault() {}, target: this }, arg &#124;&#124; {})));</code> |
| `click` | method | 87 | <code>click() { this.dispatch('click'); }</code> |
| `focus` | method | 88 | <code>focus() { doc.activeElement = this; }</code> |
| `scrollIntoView` | method | 89 | <code>scrollIntoView() {}</code> |
| `querySelectorAll` | method | 90 | <code>querySelectorAll(sel) {</code> |
| `querySelector` | method | 101 | <code>querySelector(sel) { return this.querySelectorAll(sel)&#91;0&#93; &#124;&#124; null; }</code> |
| `dump` | method | 103 | <code>dump(depth) {</code> |
| `doc` | object | 112 | <code>const doc = {</code> |
| `createElement` | method | 116 | <code>createElement(tag) { return new El(tag); },</code> |
| `createTextNode` | method | 117 | <code>createTextNode(t) { const e = new El('#text'); e.textContent = t; return e; },</code> |
| `getElementById` | method | 118 | <code>getElementById(id) { return doc._byId.get(id) &#124;&#124; null; },</code> |
| `addEventListener` | method | 121 | <code>addEventListener(ev, fn) {</code> |
| `dispatch` | method | 124 | <code>dispatch(ev, arg) {</code> |
| `preventDefault` | method | 126 | <code>Object.assign({ preventDefault() {}, target: doc.body }, arg &#124;&#124; {})));</code> |
| `bootstrap` | function | 135 | <code>function bootstrap(ids) {</code> |

## tests/fixtures/acp/fake-agent.js

[Open source](../tests/fixtures/acp/fake-agent.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `waiting` | variable | 19 | <code>const waiting = new Map();         /&#42; id -&gt; resolve &#42;/</code> |
| `modes` | function | 28 | <code>function modes() {</code> |
| `configOptions` | function | 35 | <code>function configOptions() {</code> |
| `replaySession` | function | 47 | <code>function replaySession(sid) {</code> |
| `send` | function | 56 | <code>function send(obj) { process.stdout.write(JSON.stringify(obj) + '&#92;n'); }</code> |
| `reply` | function | 57 | <code>function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }</code> |
| `notify` | function | 58 | <code>function notify(method, params) { send({ jsonrpc: '2.0', method, params }); }</code> |
| `update` | function | 59 | <code>function update(sessionId, u) { notify('session/update', { sessionId, update: u }); }</code> |
| `request` | function | 61 | <code>function request(method, params) {</code> |
| `logLine` | function | 69 | <code>function logLine(method, params) {</code> |
| `promptTurn` | function | 75 | <code>async function promptTurn(id, params) {</code> |
| `dispatch` | function | 143 | <code>function dispatch(msg) {</code> |

## tests/fixtures/acp/panel-test.js

[Open source](../tests/fixtures/acp/panel-test.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ok` | function | 14 | <code>function ok(what) { console.log(&#96;ok: ${what}&#96;); }</code> |
| `assert` | function | 15 | <code>function assert(cond, what) {</code> |
| `load` | function | 28 | <code>function load() {</code> |
| `markdown` | function | 51 | <code>function markdown() {</code> |
| `cards` | function | 101 | <code>function cards() {</code> |
| `composer` | function | 168 | <code>function composer() {</code> |
| `agentState` | function | 209 | <code>function agentState() {</code> |
| `state` | function | 264 | <code>function state() {</code> |
| `providers` | function | 327 | <code>function providers() {</code> |
| `toolbar` | function | 356 | <code>function toolbar() {</code> |
| `subagents` | function | 391 | <code>function subagents() {</code> |
| `replay` | function | 447 | <code>function replay() {</code> |
| `evidence` | function | 477 | <code>function evidence() {</code> |
| `chatControls` | function | 530 | <code>function chatControls() {</code> |
| `handshake` | function | 623 | <code>function handshake() {</code> |
| `responsiveContract` | function | 631 | <code>function responsiveContract() {</code> |

## tests/fixtures/acp/test-client.js

[Open source](../tests/fixtures/acp/test-client.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ok` | function | 20 | <code>function ok(what) { console.log(&#96;ok: ${what}&#96;); }</code> |
| `assert` | function | 21 | <code>function assert(cond, what) {</code> |
| `sleep` | function | 24 | <code>function sleep(ms) { return new Promise((r) =&gt; setTimeout(r, ms)); }</code> |
| `fsHandlers` | function | 27 | <code>function fsHandlers(root, answers) {</code> |
| `newClient` | function | 45 | <code>function newClient(extra, onNotify, onRequest, onClose) {</code> |
| `happyPath` | function | 55 | <code>async function happyPath() {</code> |
| `rejectPath` | function | 148 | <code>async function rejectPath() {</code> |
| `cancelPath` | function | 171 | <code>async function cancelPath() {</code> |
| `versionMismatch` | function | 193 | <code>async function versionMismatch() {</code> |
| `spawnFailure` | function | 204 | <code>async function spawnFailure() {</code> |
| `malformedFrame` | function | 213 | <code>async function malformedFrame() {</code> |
| `agentDeath` | function | 228 | <code>async function agentDeath() {</code> |
| `bridgeSanity` | function | 243 | <code>function bridgeSanity() {</code> |
| `splitSanity` | function | 271 | <code>function splitSanity() {</code> |
| `adapterCommandSanity` | function | 279 | <code>function adapterCommandSanity() {</code> |
| `updateMappingSanity` | function | 300 | <code>function updateMappingSanity() {</code> |
| `harnessTextSanity` | function | 323 | <code>function harnessTextSanity() {</code> |
| `chatCoreSanity` | function | 354 | <code>async function chatCoreSanity() {</code> |

## tests/fixtures/anchors/core.c

[Open source](../tests/fixtures/anchors/core.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `post_entry` | function | 7 | <code>int post_entry(int amount) {</code> |
| `untouched` | function | 15 | <code>int untouched(void) { return 0; }</code> |

## tests/fixtures/anchors/main.go

[Open source](../tests/fixtures/anchors/main.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Reconcile` | function | 6 | <code>func Reconcile(total int) int {</code> |

## tests/fixtures/anchors/server.ts

[Open source](../tests/fixtures/anchors/server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `handle` | function | 6 | <code>export function handle(req: any) {</code> |
| `serve` | function | 11 | <code>export function serve(app: any) {</code> |

## tests/fixtures/anchors/tasks.py

[Open source](../tests/fixtures/anchors/tasks.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load_tasks` | function | 6 | <code>def load_tasks(path):</code> |
| `save_tasks` | function | 13 | <code>def save_tasks(path, tasks):</code> |

## tests/fixtures/ast_runtime/json/parser.c

[Open source](../tests/fixtures/ast_runtime/json/parser.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LANGUAGE_VERSION` | macro | 7 | <code>#define LANGUAGE_VERSION 14</code> |
| `STATE_COUNT` | macro | 8 | <code>#define STATE_COUNT 32</code> |
| `LARGE_STATE_COUNT` | macro | 9 | <code>#define LARGE_STATE_COUNT 7</code> |
| `SYMBOL_COUNT` | macro | 10 | <code>#define SYMBOL_COUNT 25</code> |
| `ALIAS_COUNT` | macro | 11 | <code>#define ALIAS_COUNT 0</code> |
| `TOKEN_COUNT` | macro | 12 | <code>#define TOKEN_COUNT 15</code> |
| `EXTERNAL_TOKEN_COUNT` | macro | 13 | <code>#define EXTERNAL_TOKEN_COUNT 0</code> |
| `FIELD_COUNT` | macro | 14 | <code>#define FIELD_COUNT 2</code> |
| `MAX_ALIAS_SEQUENCE_LENGTH` | macro | 15 | <code>#define MAX_ALIAS_SEQUENCE_LENGTH 4</code> |
| `PRODUCTION_ID_COUNT` | macro | 16 | <code>#define PRODUCTION_ID_COUNT 2</code> |
| `ts_symbol_identifiers` | enum | 18 | <code>enum ts_symbol_identifiers {</code> |
| `ts_symbol_names` | variable | 45 | <code>static const char &#42; const ts_symbol_names&#91;&#93; = {</code> |
| `ts_symbol_map` | variable | 73 | <code>static const TSSymbol ts_symbol_map&#91;&#93; = {</code> |
| `ts_symbol_metadata` | variable | 101 | <code>static const TSSymbolMetadata ts_symbol_metadata&#91;&#93; = {</code> |
| `ts_field_identifiers` | enum | 205 | <code>enum ts_field_identifiers {</code> |
| `ts_field_names` | variable | 210 | <code>static const char &#42; const ts_field_names&#91;&#93; = {</code> |
| `ts_field_map_slices` | variable | 216 | <code>static const TSFieldMapSlice ts_field_map_slices&#91;PRODUCTION_ID_COUNT&#93; = {</code> |
| `ts_field_map_entries` | variable | 220 | <code>static const TSFieldMapEntry ts_field_map_entries&#91;&#93; = {</code> |
| `ts_alias_sequences` | variable | 226 | <code>static const TSSymbol ts_alias_sequences&#91;PRODUCTION_ID_COUNT&#93;&#91;MAX_ALIAS_SEQUENCE_LENGTH&#93; = {</code> |
| `ts_non_terminal_alias_map` | variable | 230 | <code>static const uint16_t ts_non_terminal_alias_map&#91;&#93; = {</code> |
| `ts_primary_state_ids` | variable | 234 | <code>static const TSStateId ts_primary_state_ids&#91;STATE_COUNT&#93; = {</code> |
| `ts_lex` | function | 269 | <code>static bool ts_lex(TSLexer &#42;lexer, TSStateId state) {</code> |
| `ts_lex_modes` | variable | 514 | <code>static const TSLexMode ts_lex_modes&#91;STATE_COUNT&#93; = {</code> |
| `ts_parse_table` | variable | 549 | <code>static const uint16_t ts_parse_table&#91;LARGE_STATE_COUNT&#93;&#91;SYMBOL_COUNT&#93; = {</code> |
| `ts_small_parse_table` | variable | 662 | <code>static const uint16_t ts_small_parse_table&#91;&#93; = {</code> |
| `ts_small_parse_table_map` | variable | 942 | <code>static const uint32_t ts_small_parse_table_map&#91;&#93; = {</code> |
| `ts_parse_actions` | variable | 970 | <code>static const TSParseActionEntry ts_parse_actions&#91;&#93; = {</code> |
| `TS_PUBLIC` | macro | 1022 | <code>#define TS_PUBLIC</code> |
| `TS_PUBLIC` | macro | 1024 | <code>#define TS_PUBLIC __declspec(dllexport)</code> |
| `TS_PUBLIC` | macro | 1026 | <code>#define TS_PUBLIC __attribute__((visibility("default")))</code> |
| `tree_sitter_json` | function | 1029 | <code>TS_PUBLIC const TSLanguage &#42;tree_sitter_json(void) {</code> |

## tests/fixtures/ast_runtime/json/tree_sitter/parser.h

[Open source](../tests/fixtures/ast_runtime/json/tree_sitter/parser.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `TREE_SITTER_PARSER_H_` | macro | 2 | <code>#define TREE_SITTER_PARSER_H_</code> |
| `ts_builtin_sym_error` | macro | 12 | <code>#define ts_builtin_sym_error ((TSSymbol)-1)</code> |
| `ts_builtin_sym_end` | macro | 13 | <code>#define ts_builtin_sym_end 0</code> |
| `TREE_SITTER_SERIALIZATION_BUFFER_SIZE` | macro | 14 | <code>#define TREE_SITTER_SERIALIZATION_BUFFER_SIZE 1024</code> |
| `TSStateId` | typedef | 17 | <code>typedef uint16_t TSStateId;</code> |
| `TSSymbol` | typedef | 18 | <code>typedef uint16_t TSSymbol;</code> |
| `TSFieldId` | typedef | 19 | <code>typedef uint16_t TSFieldId;</code> |
| `TSFieldMapEntry` | typedef | 23 | <code>typedef struct {</code> |
| `TSFieldMapSlice` | typedef | 29 | <code>typedef struct {</code> |
| `TSSymbolMetadata` | typedef | 34 | <code>typedef struct {</code> |
| `TSLexer` | struct | 42 | <code>struct TSLexer {</code> |
| `TSParseActionType` | typedef | 53 | <code>typedef enum {</code> |
| `TSParseAction` | typedef | 60 | <code>typedef union {</code> |
| `TSLexMode` | typedef | 77 | <code>typedef struct {</code> |
| `TSParseActionEntry` | typedef | 82 | <code>typedef union {</code> |
| `TSCharacterRange` | typedef | 90 | <code>typedef struct {</code> |
| `TSLanguage` | struct | 95 | <code>struct TSLanguage {</code> |
| `set_contains` | function | 134 | <code>static inline bool set_contains(TSCharacterRange &#42;ranges, uint32_t len, int32_t lookahead) {</code> |
| `UNUSED` | macro | 157 | <code>#define UNUSED __pragma(warning(suppress : 4101))</code> |
| `UNUSED` | macro | 159 | <code>#define UNUSED __attribute__((unused))</code> |
| `START_LEXER` | macro | 162 | <code>#define START_LEXER()           &#92;</code> |
| `ADVANCE` | macro | 175 | <code>#define ADVANCE(state_value) &#92;</code> |
| `ADVANCE_MAP` | macro | 181 | <code>#define ADVANCE_MAP(...)                                              &#92;</code> |
| `SKIP` | macro | 192 | <code>#define SKIP(state_value) &#92;</code> |
| `ACCEPT_TOKEN` | macro | 199 | <code>#define ACCEPT_TOKEN(symbol_value)     &#92;</code> |
| `END_STATE` | macro | 204 | <code>#define END_STATE() return result;</code> |
| `SMALL_STATE` | macro | 210 | <code>#define SMALL_STATE(id) ((id) - LARGE_STATE_COUNT)</code> |
| `STATE` | macro | 212 | <code>#define STATE(id) id</code> |
| `ACTIONS` | macro | 214 | <code>#define ACTIONS(id) id</code> |
| `SHIFT` | macro | 216 | <code>#define SHIFT(state_value)            &#92;</code> |
| `SHIFT_REPEAT` | macro | 224 | <code>#define SHIFT_REPEAT(state_value)     &#92;</code> |
| `SHIFT_EXTRA` | macro | 233 | <code>#define SHIFT_EXTRA()                 &#92;</code> |
| `REDUCE` | macro | 241 | <code>#define REDUCE(symbol_name, children, precedence, prod_id) &#92;</code> |
| `RECOVER` | macro | 252 | <code>#define RECOVER()                    &#92;</code> |
| `ACCEPT_INPUT` | macro | 257 | <code>#define ACCEPT_INPUT()              &#92;</code> |

## tests/fixtures/ast_runtime/test_runtime.c

[Open source](../tests/fixtures/ast_runtime/test_runtime.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tree_sitter_json` | function | 7 | <code>extern const TSLanguage &#42;tree_sitter_json(void);</code> |
| `visit` | function | 9 | <code>static bool visit(AstContext &#42;ctx, TSNode node, void &#42;user) {</code> |
| `extract` | function | 22 | <code>static void extract(AstContext &#42;ctx) {</code> |
| `JSON` | variable | 37 | <code>static const AstAdapter JSON = { "runtime_fixture", tree_sitter_json, extract };</code> |
| `extract_recovery` | function | 38 | <code>static void extract_recovery(AstContext &#42;ctx) {</code> |
| `RECOVERY` | variable | 41 | <code>static const AstAdapter RECOVERY = {</code> |
| `extract_file_only` | function | 44 | <code>static void extract_file_only(AstContext &#42;ctx) {</code> |
| `FILE_ONLY` | variable | 48 | <code>static const AstAdapter FILE_ONLY = {</code> |
| `run_parse` | function | 52 | <code>static void &#42;run_parse(void &#42;unused) {</code> |
| `main` | function | 67 | <code>int main(void) {</code> |

## tests/fixtures/codemap/src/count.c

[Open source](../tests/fixtures/codemap/src/count.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `count_file` | function | 5 | <code>int count_file(const char &#42;path) {</code> |
| `count_lines` | function | 13 | <code>int count_lines(const char &#42;path) {</code> |

## tests/fixtures/codemap/src/main.c

[Open source](../tests/fixtures/codemap/src/main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 6 | <code>int main(int argc, char &#42;&#42;argv) {</code> |

## tests/fixtures/codemap/src/tally.h

[Open source](../tests/fixtures/codemap/src/tally.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `TALLY_H` | macro | 3 | <code>#define TALLY_H</code> |
| `count_file` | function | 4 | <code>int count_file(const char &#42;path);</code> |
| `count_lines` | function | 5 | <code>int count_lines(const char &#42;path);</code> |
| `text_load` | function | 6 | <code>char &#42;text_load(const char &#42;path);</code> |
| `text_words` | function | 7 | <code>int text_words(const char &#42;s);</code> |
| `text_free` | function | 8 | <code>void text_free(char &#42;s);</code> |

## tests/fixtures/codemap/src/text.c

[Open source](../tests/fixtures/codemap/src/text.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `text_load` | function | 7 | <code>char &#42;text_load(const char &#42;path) {</code> |
| `text_words` | function | 17 | <code>int text_words(const char &#42;s) {</code> |
| `text_free` | function | 26 | <code>void text_free(char &#42;s) { free(s); }</code> |

## tests/fixtures/codemap/tests/test_count.c

[Open source](../tests/fixtures/codemap/tests/test_count.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 5 | <code>int main(void) {</code> |

## tests/fixtures/codemap/tools/stats.py

[Open source](../tests/fixtures/codemap/tools/stats.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tally` | function | 5 | <code>def tally(path):</code> |
| `report` | function | 9 | <code>def report(paths):</code> |

## tests/fixtures/explore/proj/gen/notes_pb2.py

[Open source](../tests/fixtures/explore/proj/gen/notes_pb2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `export_memory_message` | function | 2 | <code>def export_memory_message(notes):</code> |

## tests/fixtures/explore/proj/src/main.c

[Open source](../tests/fixtures/explore/proj/src/main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `store_open` | function | 4 | <code>Store &#42;store_open(void);</code> |
| `main` | function | 6 | <code>int main(void) {</code> |

## tests/fixtures/explore/proj/src/store.c

[Open source](../tests/fixtures/explore/proj/src/store.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Store` | struct | 5 | <code>struct Store {</code> |
| `write_line` | function | 10 | <code>static int write_line(FILE &#42;out, const char &#42;note) {</code> |
| `memory_export` | function | 14 | <code>int memory_export(Store &#42;s, FILE &#42;out) {</code> |
| `memory_import` | function | 20 | <code>int memory_import(Store &#42;s, FILE &#42;in) {</code> |
| `store_count` | function | 32 | <code>int store_count(const Store &#42;s) {</code> |
| `store_close` | function | 36 | <code>void store_close(Store &#42;s) {</code> |

## tests/fixtures/explore/proj/src/store.h

[Open source](../tests/fixtures/explore/proj/src/store.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `STORE_H` | macro | 3 | <code>#define STORE_H</code> |
| `memory_export` | function | 11 | <code>int memory_export(Store &#42;s,</code> |
| `memory_import` | function | 16 | <code>int memory_import(Store &#42;s, FILE &#42;in);</code> |
| `store_close` | function | 19 | <code>void store_close(Store &#42;s);</code> |
| `store_count` | function | 21 | <code>int store_count(const Store &#42;s);</code> |

## tests/fixtures/explore/proj/tests/test_store.c

[Open source](../tests/fixtures/explore/proj/tests/test_store.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `store_open` | function | 4 | <code>Store &#42;store_open(void);</code> |
| `test_export_memory` | function | 7 | <code>int test_export_memory(void) {</code> |

## tests/fixtures/explore/proj/tools/backup.py

[Open source](../tests/fixtures/explore/proj/tools/backup.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `rotate_archives` | function | 5 | <code>def rotate_archives(folder, keep):</code> |
| `snapshot_notes` | function | 12 | <code>def snapshot_notes(rows, path):</code> |

## tests/fixtures/explore/proj/web/api.ts

[Open source](../tests/fixtures/explore/proj/web/api.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fetchNotes` | function | 1 | <code>export async function fetchNotes(project: string): Promise&lt;string&#91;&#93;&gt; {</code> |

## tests/fixtures/explore/proj/web/memories.ts

[Open source](../tests/fixtures/explore/proj/web/memories.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `exportMemory` | function | 4 | <code>export async function exportMemory(project: string): Promise&lt;Blob&gt; {</code> |
| `renderBadge` | function | 9 | <code>export function renderBadge(count: number): string {</code> |

## tests/fixtures/grounding/src/app.ts

[Open source](../tests/fixtures/grounding/src/app.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `startApp` | function | 5 | <code>export function startApp() {</code> |

## tests/fixtures/grounding/src/typo.ts

[Open source](../tests/fixtures/grounding/src/typo.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `doWork` | function | 3 | <code>export function doWork() {</code> |

## tests/fixtures/grounding/src/util.ts

[Open source](../tests/fixtures/grounding/src/util.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `helper` | function | 1 | <code>export function helper(): string {</code> |
| `unused` | function | 5 | <code>export function unused(): void {</code> |

## tests/fixtures/sample/lib/tasks.py

[Open source](../tests/fixtures/sample/lib/tasks.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load_tasks` | function | 6 | <code>def load_tasks(path):</code> |
| `save_tasks` | function | 11 | <code>def save_tasks(path, tasks):</code> |
| `TaskStore` | class | 18 | <code>class TaskStore:</code> |
| `__init__` | method | 19 | <code>def __init__(self, path):</code> |
| `all` | method | 22 | <code>def all(self):</code> |

## tests/fixtures/sample/main.go

[Open source](../tests/fixtures/sample/main.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `handleReq` | function | 5 | <code>func handleReq(name string) string {</code> |
| `main` | function | 9 | <code>func main() {</code> |

## tests/fixtures/sample/src/audit.ts

[Open source](../tests/fixtures/sample/src/audit.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `record` | function | 3 | <code>export function record(entry: string): string {</code> |

## tests/fixtures/sample/src/gauge.ts

[Open source](../tests/fixtures/sample/src/gauge.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `bumpGauge` | function | 3 | <code>export function bumpGauge(): number {</code> |

## tests/fixtures/sample/src/helpers.c

[Open source](../tests/fixtures/sample/src/helpers.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Config` | struct | 7 | <code>struct Config {</code> |
| `check_path` | function | 13 | <code>static int check_path(const char &#42;path) {</code> |
| `Opaque` | struct | 20 | <code>struct Opaque;</code> |
| `Node` | struct | 23 | <code>typedef struct Node {</code> |
| `Level` | enum | 29 | <code>enum Level { LOW, MEDIUM, HIGH };</code> |
| `helpers_init` | function | 35 | <code>int helpers_init(int flags);</code> |
| `helpers_init` | function | 38 | <code>int helpers_init(int flags) {</code> |

## tests/fixtures/sample/src/hooks.ts

[Open source](../tests/fixtures/sample/src/hooks.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `registerHandler` | function | 1 | <code>export function registerHandler(topic: string): string {</code> |
| `trackChange` | function | 5 | <code>export function trackChange(entry: string): string {</code> |

## tests/fixtures/sample/src/jobs.ts

[Open source](../tests/fixtures/sample/src/jobs.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `scheduleJob` | function | 3 | <code>export function scheduleJob(name: string): string {</code> |

## tests/fixtures/sample/src/metrics.ts

[Open source](../tests/fixtures/sample/src/metrics.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `record` | function | 1 | <code>export function record(value: number): number {</code> |

## tests/fixtures/sample/src/replay/exporter.ts

[Open source](../tests/fixtures/sample/src/replay/exporter.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `replayAudit` | function | 3 | <code>export function replayAudit(): string {</code> |

## tests/fixtures/sample/src/replay/local.ts

[Open source](../tests/fixtures/sample/src/replay/local.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `record` | function | 1 | <code>export function record(note: string): string {</code> |

## tests/fixtures/sample/src/report.ts

[Open source](../tests/fixtures/sample/src/report.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `writeReport` | function | 3 | <code>export function writeReport(): string {</code> |

## tests/fixtures/sample/src/server.ts

[Open source](../tests/fixtures/sample/src/server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `getUsers` | function | 6 | <code>export function getUsers(req: any, res: any) {</code> |
| `createUser` | function | 10 | <code>export function createUser(req: any, res: any) {</code> |
| `UserService` | class | 15 | <code>export class UserService {</code> |
| `find` | method | 16 | <code>find(id: string) {</code> |

## tests/fixtures/sample/src/util.ts

[Open source](../tests/fixtures/sample/src/util.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `formatName` | function | 1 | <code>export function formatName(first: string, last: string): string {</code> |
| `capitalize` | function | 5 | <code>export function capitalize(s: string): string {</code> |

## tests/fixtures/semantic/channels/client.js

[Open source](../tests/fixtures/semantic/channels/client.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `bus` | variable | 1 | <code>const bus = new EventBus();</code> |
| `queue` | variable | 2 | <code>const queue = new Queue();</code> |
| `socket` | variable | 3 | <code>const socket = new Socket();</code> |
| `requestPing` | function | 4 | <code>function requestPing() { return fetch('/ping'); }</code> |
| `publishJob` | function | 5 | <code>function publishJob() { return bus.emit('job.ready'); }</code> |
| `publishQueue` | function | 6 | <code>function publishQueue() { return queue.publish('job.ready'); }</code> |
| `publishSocket` | function | 7 | <code>function publishSocket() { return socket.emit('job.ready'); }</code> |
| `onJob` | function | 8 | <code>function onJob() { return bus.on('job.ready', () =&gt; {}); }</code> |
| `onQueue` | function | 9 | <code>function onQueue() { return queue.subscribe('job.ready', () =&gt; {}); }</code> |
| `onSocket` | function | 10 | <code>function onSocket() { return socket.on('job.ready', () =&gt; {}); }</code> |
| `externalCall` | function | 11 | <code>function externalCall() { return fetch('https://example.invalid/ping'); }</code> |

## tests/fixtures/semantic/channels/consumers.js

[Open source](../tests/fixtures/semantic/channels/consumers.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `competingQueue` | function | 1 | <code>function competingQueue() { return true; }</code> |
| `competingBus` | function | 2 | <code>function competingBus() { return true; }</code> |

## tests/fixtures/semantic/channels/server.js

[Open source](../tests/fixtures/semantic/channels/server.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ping` | function | 1 | <code>function ping() { return 'pong'; }</code> |

## tests/fixtures/semantic/dispatch/Bridge.java

[Open source](../tests/fixtures/semantic/dispatch/Bridge.java)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Bridge` | class | 1 | <code>class Bridge {</code> |
| `nativeOpen` | method | 2 | <code>native int nativeOpen();</code> |
| `run` | method | 3 | <code>int run() { return nativeOpen(); }</code> |

## tests/fixtures/semantic/dispatch/Flow.pas

[Open source](../tests/fixtures/semantic/dispatch/Flow.pas)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Flow` | module | 1 | <code>unit Flow;</code> |
| `TFlow` | type | 4 | <code>TFlow = class(TForm)</code> |
| `HandleSave` | function | 5 | <code>procedure HandleSave(Sender: TObject);</code> |
| `TFlow.HandleSave` | function | 8 | <code>procedure TFlow.HandleSave(Sender: TObject); begin end;</code> |

## tests/fixtures/semantic/dispatch/Worker.java

[Open source](../tests/fixtures/semantic/dispatch/Worker.java)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Worker` | interface | 1 | <code>interface Worker {</code> |
| `work` | method | 2 | <code>void work();</code> |
| `invoke` | method | 3 | <code>default void invoke() { this.work(); }</code> |
| `Concrete` | class | 5 | <code>class Concrete implements Worker { public void work() {} }</code> |
| `work` | method | 5 | <code>class Concrete implements Worker { public void work() {} }</code> |
| `Caller` | class | 6 | <code>class Caller { void run(Worker service) { service.work(); } }</code> |
| `run` | method | 6 | <code>class Caller { void run(Worker service) { service.work(); } }</code> |

## tests/fixtures/semantic/dispatch/harness.c

[Open source](../tests/fixtures/semantic/dispatch/harness.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `cg_prep` | function | 6 | <code>sqlite3_stmt &#42;cg_prep(Cg &#42;cg,const char &#42;sql) {</code> |
| `cg_exec` | function | 13 | <code>void cg_exec(Cg &#42;cg,const char &#42;sql) {</code> |
| `xstrdup` | function | 19 | <code>char &#42;xstrdup(const char &#42;s) { char &#42;p=strdup(s);assert(p);return p; }</code> |
| `sem_pass_register` | function | 20 | <code>int sem_pass_register(const char &#42;name,int order,SemPassFn fn) {</code> |
| `count` | function | 25 | <code>static int count(Cg &#42;cg,const char &#42;sql) {</code> |
| `equal` | function | 29 | <code>static void equal(Cg &#42;cg,const char &#42;sql,int n) {</code> |
| `addfact` | function | 33 | <code>static void addfact(Cg &#42;cg,int file,int owner,const char &#42;kind,const char &#42;key,</code> |
| `main` | function | 46 | <code>int main(void) {</code> |

## tests/fixtures/semantic/dispatch/native.c

[Open source](../tests/fixtures/semantic/dispatch/native.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Callback` | typedef | 1 | <code>typedef int (&#42;Callback)(int);</code> |
| `Ops` | struct | 2 | <code>struct Ops { Callback run; };</code> |
| `increment` | function | 3 | <code>int increment(int x) { return x + 1; }</code> |
| `dispatch` | function | 5 | <code>int dispatch(void) { return ops.run(4); }</code> |
| `NativeMethod` | typedef | 7 | <code>typedef struct { const char &#42;name; const char &#42;sig; void &#42;fn; } NativeMethod;</code> |
| `nativeOpen` | function | 8 | <code>int nativeOpen(void) { return 1; }</code> |
| `methods` | variable | 9 | <code>NativeMethod methods&#91;&#93; = {{"nativeOpen", "()V", (void&#42;)nativeOpen}};</code> |
| `unknown` | variable | 11 | <code>NativeMethod unknown&#91;&#93; = {{computedName, "()V", (void&#42;)nativeOpen}};</code> |
| `registerMethods` | function | 12 | <code>int registerMethods(void &#42;env, void &#42;klass) {</code> |

## tests/fixtures/semantic/dispatch/observer.js

[Open source](../tests/fixtures/semantic/dispatch/observer.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Observer` | class | 1 | <code>class Observer {</code> |
| `addObserver` | method | 2 | <code>addObserver(name, fn) { void name; void fn; }</code> |
| `notifyObservers` | method | 3 | <code>notifyObservers(name) { void name; }</code> |
| `observer` | variable | 5 | <code>const observer = new Observer();</code> |
| `onChange` | function | 6 | <code>function onChange() {}</code> |
| `listen` | function | 7 | <code>function listen() { observer.addObserver('changed', onChange); }</code> |
| `update` | function | 8 | <code>function update() { observer.notifyObservers('changed'); }</code> |
| `shadow` | function | 9 | <code>function shadow(observer) { observer.notifyObservers('changed'); }</code> |
| `bad` | function | 10 | <code>function bad() { unknownObserver.notifyObservers('changed'); }</code> |

## tests/fixtures/semantic/dispatch/web.tsx

[Open source](../tests/fixtures/semantic/dispatch/web.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EventBus` | class | 1 | <code>class EventBus {</code> |
| `on` | method | 2 | <code>on(name: string, fn: () =&gt; void) { void name; void fn; }</code> |
| `emit` | method | 3 | <code>emit(name: string) { void name; }</code> |
| `bus` | variable | 5 | <code>const bus = new EventBus();</code> |
| `handleSaved` | function | 6 | <code>function handleSaved() {}</code> |
| `Child` | function | 7 | <code>function Child() { return &lt;span /&gt;; }</code> |
| `Parent` | function | 8 | <code>function Parent() {</code> |
| `unproved` | function | 15 | <code>function unproved(options: unknown) { void options; }</code> |
| `unknownCall` | function | 16 | <code>function unknownCall() { unproved(handleSaved); }</code> |

## tests/fixtures/semantic/dynamic/example.php

[Open source](../tests/fixtures/semantic/dynamic/example.php)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Services` | module | 2 | <code>namespace Services;</code> |
| `Worker` | class | 6 | <code>#&#91;Service&#93;</code> |
| `run` | method | 9 | <code>#&#91;Route('/run')&#93;</code> |
| `nested` | function | 11 | <code>function nested($item) { return $item; }</code> |
| `later` | function | 19 | <code>function later(): int { return 3; }</code> |

## tests/fixtures/semantic/dynamic/example.py

[Open source](../tests/fixtures/semantic/dynamic/example.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Base` | class | 4 | <code>class Base:</code> |
| `Worker` | class | 8 | <code>class Worker(Base):</code> |
| `run` | method | 12 | <code>def run(self, value: int) -&gt; str:</code> |
| `later` | function | 23 | <code>def later():</code> |

## tests/fixtures/semantic/dynamic/example.rb

[Open source](../tests/fixtures/semantic/dynamic/example.rb)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Services` | module | 2 | <code>module Services</code> |
| `Worker` | class | 3 | <code>class Worker &lt; Base</code> |
| `run` | method | 5 | <code>def run(value)</code> |
| `nested` | function | 6 | <code>def nested(item)</code> |
| `later` | function | 17 | <code>def later</code> |

## tests/fixtures/semantic/dynamic/recovery.py

[Open source](../tests/fixtures/semantic/dynamic/recovery.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `before` | function | 1 | <code>def before():</code> |
| `after` | function | 6 | <code>def after():</code> |

## tests/fixtures/semantic/extended/assert.c

[Open source](../tests/fixtures/semantic/extended/assert.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ast_extended_register` | function | 7 | <code>extern void ast_extended_register(void);</code> |
| `Case` | typedef | 9 | <code>typedef struct {</code> |
| `has_symbol` | function | 13 | <code>static int has_symbol(const SemResult &#42;r, const char &#42;name, const char &#42;kind) {</code> |
| `has_ref` | function | 19 | <code>static int has_ref(const SemResult &#42;r, const char &#42;name) {</code> |
| `has_terraform_address` | function | 24 | <code>static int has_terraform_address(const SemResult &#42;r) {</code> |
| `has_nix_reference` | function | 39 | <code>static int has_nix_reference(const SemResult &#42;r) {</code> |
| `main` | function | 50 | <code>int main(void) {</code> |

## tests/fixtures/semantic/extended/sample.erl

[Open source](../tests/fixtures/semantic/extended/sample.erl)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sample` | module | 1 | <code>-module(sample).</code> |
| `launch` | function | 3 | <code>launch(X) -&gt; run(X).</code> |
| `str` | function | 5 | <code>str() -&gt; "fake()".</code> |

## tests/fixtures/semantic/extended/sample.lua

[Open source](../tests/fixtures/semantic/extended/sample.lua)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 1 | <code>local function launch(x)</code> |

## tests/fixtures/semantic/extended/sample.luau

[Open source](../tests/fixtures/semantic/extended/sample.luau)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 1 | <code>local function launch(x: number): number</code> |

## tests/fixtures/semantic/extended/sample.nix

[Open source](../tests/fixtures/semantic/extended/sample.nix)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 2 | <code>launch = x: run x;</code> |

## tests/fixtures/semantic/extended/sample.r

[Open source](../tests/fixtures/semantic/extended/sample.r)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 1 | <code>launch &lt;- function(x) {</code> |

## tests/fixtures/semantic/extended/sample.sol

[Open source](../tests/fixtures/semantic/extended/sample.sol)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 3 | <code>function launch(uint x) public { run(x); }</code> |
| `run` | function | 4 | <code>function run(uint x) internal {}</code> |

## tests/fixtures/semantic/managed/Box.cs

[Open source](../tests/fixtures/semantic/managed/Box.cs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Box` | class | 2 | <code>class Box&lt;T&gt; : Base, IRunnable {</code> |
| `Get` | method | 3 | <code>public T Get(T value) { return value; }</code> |
| `Get` | method | 4 | <code>public T Get(int index) { return default; }</code> |
| `Run` | method | 5 | <code>public void Run() { Get(1); }</code> |

## tests/fixtures/semantic/managed/Box.dart

[Open source](../tests/fixtures/semantic/managed/Box.dart)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Box` | class | 2 | <code>class Box&lt;T&gt; extends Base implements Runnable {</code> |
| `get` | method | 3 | <code>T get(T value) { return value; }</code> |
| `get` | method | 4 | <code>T? get(int index) { return null; }</code> |
| `run` | method | 5 | <code>void run() { get(1); }</code> |

## tests/fixtures/semantic/managed/Box.java

[Open source](../tests/fixtures/semantic/managed/Box.java)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Box` | class | 2 | <code>class Box&lt;T&gt; extends Base implements Runnable {</code> |
| `get` | method | 3 | <code>public T get(T value) { return value; }</code> |
| `get` | method | 4 | <code>public T get(int index) { return null; }</code> |
| `run` | method | 5 | <code>public void run() { get(1); }</code> |

## tests/fixtures/semantic/managed/Box.kt

[Open source](../tests/fixtures/semantic/managed/Box.kt)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Box` | class | 2 | <code>class Box&lt;T&gt; : Base(), Runnable {</code> |
| `get` | method | 3 | <code>fun get(value: T): T = value</code> |
| `get` | method | 4 | <code>fun get(index: Int): T? = null</code> |
| `run` | method | 5 | <code>override fun run() { get(1) }</code> |

## tests/fixtures/semantic/managed/Box.scala

[Open source](../tests/fixtures/semantic/managed/Box.scala)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Box` | class | 2 | <code>class Box&#91;T&#93; extends Base with Runnable {</code> |
| `get` | method | 3 | <code>def get(value: T): T = value</code> |
| `get` | method | 4 | <code>def get(index: Int): T = null.asInstanceOf&#91;T&#93;</code> |
| `run` | method | 5 | <code>def run(): Unit = { get(1) }</code> |

## tests/fixtures/semantic/managed/Box.swift

[Open source](../tests/fixtures/semantic/managed/Box.swift)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Box` | class | 2 | <code>class Box&lt;T&gt;: Base, Runnable {</code> |
| `get` | method | 3 | <code>func get(_ value: T) -&gt; T { return value }</code> |
| `get` | method | 4 | <code>func get(_ index: Int) -&gt; T? { return nil }</code> |
| `run` | method | 5 | <code>func run() { let _ = get(1) }</code> |

## tests/fixtures/semantic/managed/test_managed.c

[Open source](../tests/fixtures/semantic/managed/test_managed.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ast_managed_register` | function | 8 | <code>extern void ast_managed_register(void);</code> |
| `die` | function | 10 | <code>static void die(const char &#42;lang, const char &#42;what) {</code> |
| `check` | function | 15 | <code>static void check(const char &#42;lang, const char &#42;path) {</code> |
| `check_namespace` | function | 121 | <code>static void check_namespace(const char &#42;lang, const char &#42;source) {</code> |
| `check_java_wildcard` | function | 138 | <code>static void check_java_wildcard(void) {</code> |
| `check_wide_syntax` | function | 150 | <code>static void check_wide_syntax(void) {</code> |
| `main` | function | 175 | <code>int main(int argc, char &#42;&#42;argv) {</code> |

## tests/fixtures/semantic/mixed/Bare.cfc

[Open source](../tests/fixtures/semantic/mixed/Bare.cfc)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `bare` | function | 2 | <code>function bare() { return 1; }</code> |

## tests/fixtures/semantic/mixed/Sample.astro

[Open source](../tests/fixtures/semantic/mixed/Sample.astro)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `front` | function | 2 | <code>export function front() { return 1; }</code> |

## tests/fixtures/semantic/mixed/Sample.cfm

[Open source](../tests/fixtures/semantic/mixed/Sample.cfm)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `target` | function | 2 | <code>&lt;cffunction name="target"&gt;&lt;cfreturn 1&gt;&lt;/cffunction&gt;</code> |
| `run` | function | 3 | <code>&lt;cffunction name="run"&gt;&lt;cfreturn target()&gt;&lt;cfquery name="cacheResult"&gt;SELECT &#42; FROM users&lt;/cfquery&gt;&lt;/cffunction&gt;</code> |
| `fetch` | function | 4 | <code>&lt;cffunction name="fetch"&gt;&lt;cfquery name="other"&gt;SELECT &#42; FROM cacheResult&lt;/cfquery&gt;&lt;/cffunction&gt;</code> |

## tests/fixtures/semantic/mixed/Sample.svelte

[Open source](../tests/fixtures/semantic/mixed/Sample.svelte)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 2 | <code>function load() { return 1; }</code> |

## tests/fixtures/semantic/mixed/Sample.vue

[Open source](../tests/fixtures/semantic/mixed/Sample.vue)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `multi` | function | 3 | <code>export function multi(</code> |

## tests/fixtures/semantic/mixed/sample.cfs

[Open source](../tests/fixtures/semantic/mixed/sample.cfs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `run` | function | 2 | <code>function run(value) {</code> |

## tests/fixtures/semantic/mixed/sample.ets

[Open source](../tests/fixtures/semantic/mixed/sample.ets)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Card` | class | 1 | <code>@Component</code> |
| `build` | method | 3 | <code>build() {</code> |

## tests/fixtures/semantic/mixed/sample.pas

[Open source](../tests/fixtures/semantic/mixed/sample.pas)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Sample` | module | 1 | <code>unit Sample;</code> |
| `TWorker` | type | 4 | <code>type TWorker = class</code> |
| `Run` | function | 5 | <code>procedure Run;</code> |
| `TWorker.Run` | function | 8 | <code>procedure TWorker.Run;</code> |

## tests/fixtures/semantic/mixed/sample.vb

[Open source](../tests/fixtures/semantic/mixed/sample.vb)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Worker` | class | 2 | <code>Public Class Worker</code> |
| `Run` | method | 3 | <code>Public Function Run(value As Integer) As Integer</code> |

## tests/fixtures/semantic/routes/api.js

[Open source](../tests/fixtures/semantic/routes/api.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `listItems` | function | 1 | <code>function listItems(req, res) { return res.json(&#91;&#93;); }</code> |

## tests/fixtures/semantic/routes/api.py

[Open source](../tests/fixtures/semantic/routes/api.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `list_items` | function | 1 | <code>def list_items():</code> |
| `multiline` | function | 8 | <code>def multiline():</code> |

## tests/fixtures/semantic/routes/app/orders/route.ts

[Open source](../tests/fixtures/semantic/routes/app/orders/route.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET` | function | 1 | <code>export function GET() { return new Response('ok'); }</code> |
| `POST` | function | 2 | <code>export async function POST() { return new Response('created'); }</code> |

## tests/fixtures/semantic/routes/app/profile/index.tsx

[Open source](../tests/fixtures/semantic/routes/app/profile/index.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Profile` | function | 1 | <code>export default function Profile() { return &lt;p&gt;Profile&lt;/p&gt;; }</code> |

## tests/fixtures/semantic/routes/app/report.tsx

[Open source](../tests/fixtures/semantic/routes/app/report.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `reportHandler` | function | 1 | <code>export default function reportHandler() { return null; }</code> |

## tests/fixtures/semantic/routes/pages/api/items.ts

[Open source](../tests/fixtures/semantic/routes/pages/api/items.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `handler` | function | 1 | <code>export default function handler(req, res) { return res.json(&#91;&#93;); }</code> |

## tests/fixtures/semantic/routes/server/api/widgets.get.ts

[Open source](../tests/fixtures/semantic/routes/server/api/widgets.get.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `handler` | function | 1 | <code>export default function handler() { return { widgets: &#91;&#93; }; }</code> |

## tests/fixtures/semantic/routes/src/Api.cs

[Open source](../tests/fixtures/semantic/routes/src/Api.cs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Api` | class | 1 | <code>class Api {</code> |
| `Home` | method | 2 | <code>&#91;HttpGet("/asp/home")&#93;</code> |

## tests/fixtures/semantic/routes/src/Handler.java

[Open source](../tests/fixtures/semantic/routes/src/Handler.java)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Handler` | class | 1 | <code>class Handler {</code> |
| `home` | method | 2 | <code>@GetMapping("/spring/home")</code> |
| `create` | method | 4 | <code>@PostMapping(</code> |

## tests/fixtures/semantic/routes/src/HomeController.php

[Open source](../tests/fixtures/semantic/routes/src/HomeController.php)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HomeController` | class | 2 | <code>class HomeController {</code> |
| `index` | method | 3 | <code>public function index() { return 'home'; }</code> |

## tests/fixtures/semantic/routes/src/api.go

[Open source](../tests/fixtures/semantic/routes/src/api.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `list` | function | 2 | <code>func list(c &#42;Context) { }</code> |
| `register` | function | 3 | <code>func register(r &#42;Engine) { r.GET("/gin/list", list) }</code> |
| `registerMore` | function | 4 | <code>func registerMore(r &#42;Engine) {</code> |

## tests/fixtures/semantic/routes/src/api.rs

[Open source](../tests/fixtures/semantic/routes/src/api.rs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `list` | function | 1 | <code>fn list() {}</code> |
| `router` | function | 2 | <code>fn router(app: Router) { app.route("/axum/list", get(list)); }</code> |

## tests/fixtures/semantic/routes/src/api.swift

[Open source](../tests/fixtures/semantic/routes/src/api.swift)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `show` | function | 1 | <code>func show(req: Request) -&gt; String { return "ok" }</code> |

## tests/fixtures/semantic/routes/src/flask.py

[Open source](../tests/fixtures/semantic/routes/src/flask.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ping` | function | 2 | <code>def ping():</code> |

## tests/fixtures/semantic/routes/src/flask_get.py

[Open source](../tests/fixtures/semantic/routes/src/flask_get.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `flask_get_handler` | function | 4 | <code>def flask_get_handler():</code> |

## tests/fixtures/semantic/routes/src/home_controller.rb

[Open source](../tests/fixtures/semantic/routes/src/home_controller.rb)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HomeController` | class | 1 | <code>class HomeController</code> |
| `index` | method | 2 | <code>def index</code> |

## tests/fixtures/semantic/routes/src/misc.py

[Open source](../tests/fixtures/semantic/routes/src/misc.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `unrelated` | function | 1 | <code>def unrelated():</code> |

## tests/fixtures/semantic/routes/src/navigation.tsx

[Open source](../tests/fixtures/semantic/routes/src/navigation.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Navigation` | function | 1 | <code>function Navigation() {</code> |

## tests/fixtures/semantic/routes/src/router.tsx

[Open source](../tests/fixtures/semantic/routes/src/router.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Page` | function | 1 | <code>function Page() { return &lt;p&gt;Page&lt;/p&gt;; }</code> |

## tests/fixtures/semantic/routes/src/router_object.tsx

[Open source](../tests/fixtures/semantic/routes/src/router_object.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RouteObjectHandler` | function | 1 | <code>function RouteObjectHandler() { return &lt;p&gt;ok&lt;/p&gt;; }</code> |

## tests/fixtures/semantic/routes/src/routes/notes/+server.ts

[Open source](../tests/fixtures/semantic/routes/src/routes/notes/+server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET` | function | 1 | <code>export function GET() { return new Response('ok'); }</code> |

## tests/fixtures/semantic/routes/src/routes/report/+page.server.ts

[Open source](../tests/fixtures/semantic/routes/src/routes/report/+page.server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 1 | <code>export function load() { return { ok: true }; }</code> |

## tests/fixtures/semantic/routes/src/rust_lifetime.rs

[Open source](../tests/fixtures/semantic/routes/src/rust_lifetime.rs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `lifetimeHandler` | function | 2 | <code>async fn lifetimeHandler() -&gt; &amp;'static str { "ok" }</code> |
| `router` | function | 3 | <code>fn router() -&gt; Router {</code> |

## tests/fixtures/semantic/routes/src/urls.py

[Open source](../tests/fixtures/semantic/routes/src/urls.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `show` | function | 1 | <code>def show(request):</code> |

## tests/fixtures/semantic/routes/src/vue-router.ts

[Open source](../tests/fixtures/semantic/routes/src/vue-router.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Account` | function | 1 | <code>function Account() { return null; }</code> |

## tests/fixtures/semantic/systems/broken.c

[Open source](../tests/fixtures/semantic/systems/broken.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `good` | function | 1 | <code>int good(void) { return 1; }</code> |
| `after` | function | 2 | <code>int after(void) { return good(); }</code> |

## tests/fixtures/semantic/systems/fixture.c

[Open source](../tests/fixtures/semantic/systems/fixture.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `WRAP` | macro | 3 | <code>#define WRAP(x) (x)</code> |
| `Callback` | typedef | 4 | <code>typedef int (&#42;Callback)(int);</code> |
| `Meter` | struct | 5 | <code>struct Meter { int count; };</code> |
| `Forward` | struct | 7 | <code>struct Forward;</code> |
| `Future` | enum | 8 | <code>enum Future;</code> |
| `Level` | typedef | 9 | <code>typedef enum { LOW, HIGH } Level;</code> |
| `Count` | typedef | 10 | <code>typedef unsigned long Count;</code> |
| `Anonymous` | typedef | 11 | <code>typedef struct { int value; } Anonymous;</code> |
| `increment` | function | 12 | <code>int increment(int x) { return x + 1; }</code> |
| `Ops` | struct | 13 | <code>struct Ops { Callback run; };</code> |
| `invoke` | function | 15 | <code>int invoke(Callback cb, int x) { return cb(x); }</code> |
| `apply` | function | 16 | <code>int apply(int (&#42;fn)(int), int x, Callback done) {</code> |
| `dispatch` | function | 19 | <code>int dispatch(void) {</code> |
| `NativeMethod` | typedef | 25 | <code>typedef struct { const char &#42;name; const char &#42;sig; void &#42;fn; } NativeMethod;</code> |
| `nativeOpen` | function | 26 | <code>int nativeOpen(void) { return 1; }</code> |
| `methods` | variable | 27 | <code>NativeMethod methods&#91;&#93; = {{"nativeOpen", "()V", (void&#42;)nativeOpen}};</code> |
| `dynamicMethods` | variable | 29 | <code>NativeMethod dynamicMethods&#91;&#93; = {{dynamicName, "()V", (void&#42;)nativeOpen}};</code> |
| `registerMethods` | function | 30 | <code>int registerMethods(void &#42;env, void &#42;klass) {</code> |

## tests/fixtures/semantic/systems/fixture.cpp

[Open source](../tests/fixtures/semantic/systems/fixture.cpp)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `demo` | namespace | 2 | <code>namespace demo {</code> |
| `Base` | class | 3 | <code>class Base { public: virtual int run(int x) { return x; } };</code> |
| `run` | method | 3 | <code>class Base { public: virtual int run(int x) { return x; } };</code> |
| `Worker` | class | 4 | <code>class Worker : public Base {</code> |
| `run` | method | 6 | <code>int run(int x) override { return helper(x); }</code> |
| `helper` | method | 7 | <code>int helper(int x) { return x + 1; }</code> |
| `Abstract` | struct | 9 | <code>struct Abstract { virtual double area() const = 0; };</code> |
| `area` | method | 9 | <code>struct Abstract { virtual double area() const = 0; };</code> |
| `execute` | function | 10 | <code>int execute() { Worker w; return w.run(2); }</code> |

## tests/fixtures/semantic/systems/fixture.go

[Open source](../tests/fixtures/semantic/systems/fixture.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Runner` | interface | 6 | <code>type Runner interface { Run(int) int }</code> |
| `Worker` | struct | 7 | <code>type Worker struct { n int }</code> |
| `Run` | method | 8 | <code>func (w Worker) Run(value int) int { return helper(value) }</code> |
| `helper` | function | 9 | <code>func helper(value int) int { fmt.Println(value); return value + 1 }</code> |
| `invoke` | function | 10 | <code>func invoke(cb func(int) int) int {</code> |

## tests/fixtures/semantic/systems/fixture.m

[Open source](../tests/fixtures/semantic/systems/fixture.m)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Counter` | class | 2 | <code>@interface Counter : NSObject</code> |
| `inc` | method | 3 | <code>- (int)inc:(int)value;</code> |
| `Counter` | class | 5 | <code>@implementation Counter</code> |
| `inc` | method | 6 | <code>- (int)inc:(int)value { return value + 1; }</code> |
| `invoke` | function | 8 | <code>int invoke(Counter &#42;counter) { return &#91;counter inc:2&#93;; }</code> |

## tests/fixtures/semantic/systems/fixture.rs

[Open source](../tests/fixtures/semantic/systems/fixture.rs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Runner` | trait | 4 | <code>trait Runner { fn run(&amp;self, value: i32) -&gt; i32; }</code> |
| `run` | method | 4 | <code>trait Runner { fn run(&amp;self, value: i32) -&gt; i32; }</code> |
| `Worker` | struct | 5 | <code>struct Worker { n: i32 }</code> |
| `run` | method | 7 | <code>fn run(&amp;self, value: i32) -&gt; i32 { helper(value) }</code> |
| `helper` | function | 9 | <code>fn helper(value: i32) -&gt; i32 { value + 1 }</code> |
| `invoke` | function | 10 | <code>fn invoke() -&gt; i32 {</code> |
| `scoped` | function | 14 | <code>fn scoped() { Config::load(); }</code> |

## tests/fixtures/semantic/web/ambiguous.ts

[Open source](../tests/fixtures/semantic/web/ambiguous.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AmbiguousPanel` | class | 1 | <code>@Tag</code> |

## tests/fixtures/semantic/web/ambiguous_a.ts

[Open source](../tests/fixtures/semantic/web/ambiguous_a.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Tag` | function | 1 | <code>export function Tag(target: unknown): unknown { return target; }</code> |

## tests/fixtures/semantic/web/ambiguous_b.ts

[Open source](../tests/fixtures/semantic/web/ambiguous_b.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Tag` | function | 1 | <code>export function Tag(target: unknown): unknown { return target; }</code> |

## tests/fixtures/semantic/web/api.ts

[Open source](../tests/fixtures/semantic/web/api.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `track` | function | 1 | <code>export function track(value: unknown): void { void value; }</code> |

## tests/fixtures/semantic/web/broken.ts

[Open source](../tests/fixtures/semantic/web/broken.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `intact` | function | 1 | <code>export function intact(): number { return 1; }</code> |

## tests/fixtures/semantic/web/channels.ts

[Open source](../tests/fixtures/semantic/web/channels.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EventBus` | class | 1 | <code>export class EventBus {</code> |
| `on` | method | 2 | <code>on(channel: string, callback: () =&gt; void) { void channel; void callback; }</code> |
| `emit` | method | 3 | <code>emit(channel: string, data: unknown) { void channel; void data; }</code> |
| `bus` | variable | 5 | <code>export const bus = new EventBus();</code> |

## tests/fixtures/semantic/web/decorators.ts

[Open source](../tests/fixtures/semantic/web/decorators.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Audit` | function | 1 | <code>export function Audit(target: unknown): unknown { return target; }</code> |
| `route` | function | 2 | <code>export function route(path: string) {</code> |

## tests/fixtures/semantic/web/main.tsx

[Open source](../tests/fixtures/semantic/web/main.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ResultView` | interface | 8 | <code>interface ResultView&lt;T&gt; extends Result { value: T }</code> |
| `Choice` | type | 9 | <code>type Choice = Result &#124; null;</code> |
| `LocalBus` | class | 10 | <code>class LocalBus {</code> |
| `on` | method | 11 | <code>on(channel: string, handler: () =&gt; void) { void channel; void handler; }</code> |
| `emit` | method | 12 | <code>emit(channel: string, value: unknown) { void channel; void value; }</code> |
| `bus` | variable | 14 | <code>const bus = new LocalBus();</code> |
| `handleSaved` | function | 15 | <code>function handleSaved() {}</code> |
| `DecoratedPanel` | class | 17 | <code>@Audit</code> |
| `DynamicDecorated` | class | 22 | <code>class DynamicDecorated {}</code> |
| `arityZero` | function | 25 | <code>function arityZero() {}</code> |
| `arityTwo` | function | 26 | <code>function arityTwo(left: number, right: number) { return left + right; }</code> |
| `Panel` | class | 33 | <code>export class Panel&lt;T&gt; extends BasePanel implements Runnable {</code> |
| `render` | method | 35 | <code>public async render(</code> |
| `Screen` | function | 45 | <code>export function Screen(</code> |
| `cancel` | method | 50 | <code>const actions = { save: () =&gt; load(props.id), cancel() { setCount(0); } };</code> |

## tests/fixtures/semantic/web/plain.js

[Open source](../tests/fixtures/semantic/web/plain.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Counter` | class | 1 | <code>export class Counter {</code> |
| `increment` | method | 2 | <code>increment(</code> |
| `makeCounter` | function | 8 | <code>export const makeCounter = () =&gt; new Counter();</code> |

## tests/fixtures/semantic/web/service.ts

[Open source](../tests/fixtures/semantic/web/service.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Result` | interface | 1 | <code>export interface Result { value: string }</code> |
| `fetchItem` | function | 2 | <code>export function fetchItem(id: string): Promise&lt;Result&gt; {</code> |
| `Main` | class | 5 | <code>export default class Main {}</code> |

## tests/fixtures/semantic/web/usage.jsx

[Open source](../tests/fixtures/semantic/web/usage.jsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `View` | function | 2 | <code>export default function View({ item }) {</code> |
| `close` | method | 5 | <code>close() { return item.close(); }</code> |

## tests/fixtures/semantic/web/widget.jsx

[Open source](../tests/fixtures/semantic/web/widget.jsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Widget` | class | 1 | <code>export default class Widget {</code> |
| `open` | method | 2 | <code>static open(item) { return item; }</code> |

## tests/hyperfide/campaigns/authority.py

[Open source](../tests/hyperfide/campaigns/authority.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AuthorityError` | class | 21 | <code>class AuthorityError(ValueError):</code> |
| `require` | function | 24 | <code>def require(value, message):</code> |
| `closed` | function | 28 | <code>def closed(value, keys, label):</code> |
| `canonical` | function | 31 | <code>def canonical(value):</code> |
| `sha` | function | 38 | <code>def sha(value):</code> |
| `digest` | function | 41 | <code>def digest(value):</code> |
| `identity` | function | 45 | <code>def identity(value, nullable=False):</code> |
| `decimal` | function | 49 | <code>def decimal(value):</code> |
| `timestamp` | function | 53 | <code>def timestamp(value):</code> |
| `milliseconds` | function | 63 | <code>def milliseconds(value):</code> |
| `fresh` | function | 68 | <code>def fresh(observed, expires, checked_at):</code> |
| `strict_json` | function | 72 | <code>def strict_json(source):</code> |
| `inspect_journal` | function | 86 | <code>def inspect_journal(document, deployment_id):</code> |
| `inspect_transition` | function | 140 | <code>def inspect_transition(proof, expected):</code> |

## tests/hyperfide/campaigns/deterministic.py

[Open source](../tests/hyperfide/campaigns/deterministic.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CampaignError` | class | 25 | <code>class CampaignError(Exception):</code> |
| `Blocked` | class | 28 | <code>class Blocked(CampaignError):</code> |
| `require` | function | 34 | <code>def require(condition, message):</code> |
| `canonical` | function | 38 | <code>def canonical(value):</code> |
| `digest` | function | 41 | <code>def digest(value):</code> |
| `pairs` | function | 44 | <code>def pairs(items):</code> |
| `decode` | function | 51 | <code>def decode(data):</code> |
| `utc` | function | 57 | <code>def utc():</code> |
| `timestamp` | function | 60 | <code>def timestamp(value):</code> |
| `integer` | function | 67 | <code>def integer(value, name, minimum=1):</code> |
| `authority_uuid` | function | 71 | <code>def authority_uuid(value, name='authority epoch'):</code> |
| `sealed_write` | function | 75 | <code>def sealed_write(path, value):</code> |
| `pinned_file` | function | 92 | <code>def pinned_file(pin, root):</code> |
| `load_manifest` | function | 108 | <code>def load_manifest(path, kind):</code> |
| `observer_trust` | function | 158 | <code>def observer_trust(manifest, root):</code> |
| `verify_observation` | function | 181 | <code>def verify_observation(observation, manifest, root, request, roles, authority_epoch=None):</code> |
| `verify_full_receipt` | function | 211 | <code>def verify_full_receipt(pin, manifest, root, evidence=None, policy=None):</code> |
| `require_case_coverage` | function | 232 | <code>def require_case_coverage(receipt, required_cases):</code> |
| `anchored_full_receipt` | function | 237 | <code>def anchored_full_receipt(record, manifest, root, input_name, evidence=None, policy=None, required_cases=None):</code> |
| `child_pids` | function | 246 | <code>def child_pids():</code> |
| `process_identity` | function | 249 | <code>def process_identity(pid):</code> |
| `reap_owned_children` | function | 256 | <code>def reap_owned_children(original, deadline_seconds=5):</code> |
| `CommandAdapter` | class | 288 | <code>class CommandAdapter:</code> |
| `__init__` | method | 294 | <code>def __init__(self, specification, root, evidence):</code> |
| `call` | method | 318 | <code>def call(self, request):</code> |
| `validate_activation` | function | 398 | <code>def validate_activation(proof, previous_epoch, new_epoch, deployment_id, operation_id):</code> |
| `Reference` | class | 428 | <code>class Reference:</code> |
| `__init__` | method | 430 | <code>def __init__(self, sandboxes=100, slots=200, initial_epoch=None, deployment_id=None, authority_contract="legacy-ordinary-v1"):</code> |
| `apply` | method | 445 | <code>def apply(self, event):</code> |
| `state` | method | 579 | <code>def state(self):</code> |
| `reconstruct` | function | 582 | <code>def reconstruct(events, profile):</code> |
| `schedule` | function | 589 | <code>def schedule(profile, seed):</code> |
| `require_simulated_agents` | function | 605 | <code>def require_simulated_agents(events):</code> |
| `Trace` | class | 614 | <code>class Trace:</code> |
| `__init__` | method | 616 | <code>def __init__(self, epoch):</code> |
| `add` | method | 619 | <code>def add(self, kind, accepted, at=None, &#42;&#42;fields):</code> |
| `ratio` | function | 625 | <code>def ratio(value):</code> |
| `mixed_trace` | function | 630 | <code>def mixed_trace(profile, seed, faults=(), concurrency=None, batch_size=1000, write_read_ratio="1:9", replica_lag_ms=0, graph_symbols=None):</code> |
| `check_invariants` | function | 757 | <code>def check_invariants(events, state, profile, faults=()):</code> |
| `nearest_rank` | function | 766 | <code>def nearest_rank(samples, fraction):</code> |
| `simulated_metrics` | function | 770 | <code>def simulated_metrics(summary, state, virtual_ms):</code> |
| `sweep_points` | function | 786 | <code>def sweep_points(dimensions=SWEEP_DIMENSIONS):</code> |
| `sweep` | function | 791 | <code>def sweep(profile, seed, dimensions=SWEEP_DIMENSIONS):</code> |
| `fault_combinations` | function | 802 | <code>def fault_combinations(seed, extra=4):</code> |
| `replay_faults` | function | 809 | <code>def replay_faults(profile, seed, combinations=None):</code> |
| `simulate` | function | 819 | <code>def simulate(profile, seeds):</code> |
| `compare_metrics` | function | 837 | <code>def compare_metrics(current, baseline):</code> |
| `run` | function | 869 | <code>def run(path, evidence):</code> |
| `simulate_campaign` | function | 908 | <code>def simulate_campaign(path, evidence):</code> |
| `main` | function | 920 | <code>def main():</code> |

## tests/hyperfide/campaigns/faults.py

[Open source](../tests/hyperfide/campaigns/faults.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `required_pairs` | function | 24 | <code>def required_pairs(manifest):</code> |
| `overlapping_pairs` | function | 37 | <code>def overlapping_pairs(intervals):</code> |
| `validate_faults` | function | 45 | <code>def validate_faults(manifest):</code> |
| `inspect_state` | function | 69 | <code>def inspect_state(observation, manifest):</code> |
| `inspect_fault_reports` | function | 84 | <code>def inspect_fault_reports(observation, manifest):</code> |
| `verify_recovery_receipts` | function | 115 | <code>def verify_recovery_receipts(observation, manifest, root, evidence=None):</code> |
| `inspect_reconstruction` | function | 135 | <code>def inspect_reconstruction(observation, manifest, root, evidence=None):</code> |
| `run` | function | 141 | <code>def run(path, evidence):</code> |
| `main` | function | 186 | <code>def main():</code> |

## tests/hyperfide/campaigns/live.py

[Open source](../tests/hyperfide/campaigns/live.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `validate_live` | function | 28 | <code>def validate_live(manifest):</code> |
| `inspect_snapshot` | function | 53 | <code>def inspect_snapshot(snapshot, manifest, previous=None):</code> |
| `enforce_allocation` | function | 113 | <code>def enforce_allocation(state, manifest):</code> |
| `cleanup_result` | function | 117 | <code>def cleanup_result(result, retained, expected_ids=None):</code> |
| `run` | function | 136 | <code>def run(path, evidence):</code> |
| `main` | function | 218 | <code>def main():</code> |

## tests/hyperfide/campaigns/parity.py

[Open source](../tests/hyperfide/campaigns/parity.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `prefix` | function | 56 | <code>def prefix(case):</code> |
| `assertion_ids` | function | 59 | <code>def assertion_ids(case):</code> |
| `registered_ids` | function | 62 | <code>def registered_ids(case, registry=REGISTRY):</code> |
| `manifest_env` | function | 65 | <code>def manifest_env(case):</code> |
| `load_manifest` | function | 68 | <code>def load_manifest(path, case, approved_sha256):</code> |
| `input_digests` | function | 100 | <code>def input_digests(manifest):</code> |
| `outcome` | function | 103 | <code>def outcome(passed, &#42;&#42;detail):</code> |
| `run_case` | function | 106 | <code>def run_case(case, manifest_path, evidence, approved_sha256):</code> |
| `campaign_policy` | function | 179 | <code>def campaign_policy():</code> |
| `main_case` | function | 186 | <code>def main_case(case):</code> |

## tests/hyperfide/cases/support/checkpoint_source.py

[Open source](../tests/hyperfide/cases/support/checkpoint_source.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 10 | <code>def load(name,path):</code> |
| `canonical` | function | 12 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()</code> |
| `digest` | function | 13 | <code>def digest(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `expect` | function | 14 | <code>def expect(value,detail):</code> |
| `check` | function | 16 | <code>def check(identity,fn):</code> |
| `Fixture` | class | 26 | <code>class Fixture:</code> |
| `__init__` | method | 27 | <code>def __init__(self,base,native_root):</code> |
| `restore` | method | 68 | <code>def restore(self):</code> |
| `call` | method | 72 | <code>def call(self,workspace,_native_result,&#42;&#42;changes):</code> |
| `valid` | method | 80 | <code>def valid(self):</code> |
| `rejects` | method | 82 | <code>def rejects(self,mutation,code=None):</code> |
| `direct_negative` | method | 85 | <code>def direct_negative(self,&#42;&#42;changes):</code> |
| `run` | function | 87 | <code>def run(native_root,out):</code> |

## tests/hyperfide/cases/support/graph_contracts.py

[Open source](../tests/hyperfide/cases/support/graph_contracts.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `legacy` | function | 45 | <code>def legacy(path):</code> |
| `body_paths` | function | 47 | <code>def body_paths(db,q):return sorted(r&#91;0&#93; for r in db.execute("SELECT f.path FROM body_fts JOIN files f ON f.id=body_fts.rowid WHERE body_fts MATCH ?",('"'+q.replace('"','""')+'"',)))</code> |
| `body_paths_ranked` | function | 48 | <code>def body_paths_ranked(db,q):return &#91;r&#91;0&#93; for r in db.execute("SELECT f.path FROM body_fts JOIN files f ON f.id=body_fts.rowid WHERE body_fts MATCH ? ORDER BY bm25(body_fts)",('"'+q+'"',))&#93;</code> |
| `grep_paths` | function | 51 | <code>def grep_paths(checkout,q):</code> |
| `comment_bodies` | function | 56 | <code>def comment_bodies(db,q):return sorted(r&#91;0&#93; for r in db.execute("SELECT c.body FROM comments c JOIN comment_fts ft ON ft.rowid=c.id WHERE comment_fts MATCH ?",('"'+q+'"',)))</code> |
| `symbol_substrings` | function | 57 | <code>def symbol_substrings(db,q):return sorted(r&#91;0&#93; for r in db.execute("SELECT name FROM symbols WHERE instr(lower(name),lower(?))&gt;0",(q,)))</code> |
| `legacy_routes` | function | 58 | <code>def legacy_routes(db):</code> |
| `legacy_compositions` | function | 61 | <code>def legacy_compositions(db):return {(r&#91;0&#93;,r&#91;1&#93;) for r in db.execute("SELECT m.pattern,c.pattern FROM semantic_route_compositions x JOIN routes m ON m.id=x.mount_route_id JOIN routes c ON c.id=x.child_…</code> |
| `legacy_annotations` | function | 62 | <code>def legacy_annotations(db):</code> |
| `legacy_callers` | function | 64 | <code>def legacy_callers(db,name):</code> |
| `legacy_unprojected` | function | 68 | <code>def legacy_unprojected(db):return db.execute("SELECT count(&#42;) FROM semantic_edges WHERE source_id IS NULL OR target_id IS NULL").fetchone()&#91;0&#93;</code> |
| `symbol_ids` | function | 70 | <code>def symbol_ids(h,manifest,name):</code> |
| `central_callers` | function | 72 | <code>def central_callers(h,manifest,name):</code> |
| `run` | function | 81 | <code>def run(h):</code> |
| `corpus` | function | 162 | <code>def corpus(h):</code> |
| `migration` | function | 243 | <code>def migration(h):</code> |

## tests/hyperfide/cases/support/graph_projection.py

[Open source](../tests/hyperfide/cases/support/graph_projection.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonical` | function | 11 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)</code> |
| `facts_digest` | function | 12 | <code>def facts_digest(files):return "sha256:"+hashlib.sha256(canonical(sorted(files,key=lambda f:f&#91;"path"&#93;.encode())).encode()).hexdigest()</code> |
| `cell` | function | 13 | <code>def cell(value):return None if value is None else str(value)</code> |
| `ordered` | function | 14 | <code>def ordered(rows):return sorted(rows,key=lambda row:canonical(row).encode())</code> |
| `legacy_facts` | function | 16 | <code>def legacy_facts(db):</code> |
| `differences` | function | 37 | <code>def differences(expected,actual,limit=12):</code> |
| `git` | function | 52 | <code>def git(cwd,&#42;args):</code> |
| `Repo` | class | 57 | <code>class Repo:</code> |
| `__init__` | method | 59 | <code>def __init__(self,h,name):</code> |
| `commit` | method | 66 | <code>def commit(self,files,message):</code> |
| `extract` | method | 81 | <code>def extract(self,revision,configuration=None,overlay=None):</code> |
| `checkout` | method | 87 | <code>def checkout(self,revision,name,overlay_files=None):</code> |
| `legacy_index` | function | 97 | <code>def legacy_index(checkout,full=True):</code> |
| `overlay_payload` | function | 106 | <code>def overlay_payload(name,files):</code> |
| `run` | function | 132 | <code>def run(h):</code> |

## tests/hyperfide/cases/support/graph_replicas.py

[Open source](../tests/hyperfide/cases/support/graph_replicas.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `routed` | function | 13 | <code>def routed(url,path):</code> |
| `drain` | function | 15 | <code>def drain(child):</code> |
| `restart` | function | 19 | <code>def restart(h,&#42;&#42;env):</code> |
| `attach` | function | 25 | <code>def attach(h):</code> |
| `standby` | function | 32 | <code>def standby(h,statement):return h.cluster.sql(statement,replica=True,database=h.database)</code> |
| `wait_replayed` | function | 33 | <code>def wait_replayed(h,timeout=20):</code> |
| `semantic` | function | 40 | <code>def semantic(result):return {k:v for k,v in result.items() if k!="provenance"}</code> |
| `artifacts` | function | 41 | <code>def artifacts(h,manifest,status):</code> |
| `authority_snapshot` | function | 43 | <code>def authority_snapshot(h):</code> |
| `run` | function | 46 | <code>def run(h):</code> |
| `percentiles` | function | 163 | <code>def percentiles(values):</code> |
| `mixed_load` | function | 173 | <code>def mixed_load(h,seconds=30):</code> |

## tests/hyperfide/cases/support/postgres_cluster.py

[Open source](../tests/hyperfide/cases/support/postgres_cluster.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PostgresCluster` | class | 4 | <code>class PostgresCluster:</code> |
| `__init__` | method | 5 | <code>def __init__(self,root=None):</code> |
| `run` | method | 14 | <code>def run(self,&#42;args,timeout=45):</code> |
| `configure` | method | 20 | <code>def configure(self,directory,socketdir):</code> |
| `start` | method | 22 | <code>def start(self,directory):</code> |
| `stop` | method | 34 | <code>def stop(self,directory):</code> |
| `sql` | method | 37 | <code>def sql(self,text,replica=False,user='hf_operator',database='postgres'):</code> |
| `url` | method | 39 | <code>def url(self,replica=False,user='hf_operator'):</code> |
| `replicate` | method | 41 | <code>def replicate(self):</code> |
| `synchronous` | method | 51 | <code>def synchronous(self,enabled=True):</code> |
| `promote` | method | 59 | <code>def promote(self):self.run('pg_ctl','-D',str(self.standby),'-w','promote')</code> |
| `backup` | method | 60 | <code>def backup(self,name='backup'):</code> |
| `stopped` | method | 62 | <code>def stopped(self,directory,socketdir):</code> |
| `close` | method | 68 | <code>def close(self):</code> |

## tests/hyperfide/cases/support/postgres_drills.py

[Open source](../tests/hyperfide/cases/support/postgres_drills.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 114 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/10_1.py

[Open source](../tests/hyperfide/cases/tasks/10_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 12 | <code>def expect(v,m="assertion failed"):</code> |
| `check` | function | 14 | <code>def check(name,fn):</code> |
| `Fixture` | class | 20 | <code>class Fixture(up.Fixture):</code> |
| `__init__` | method | 21 | <code>def __init__(self,base,tools,port):</code> |
| `image` | method | 34 | <code>def image(self):</code> |
| `storage` | method | 36 | <code>def storage(self):</code> |
| `create` | method | 38 | <code>def create(self):return super().create()</code> |
| `call` | method | 39 | <code>def call(self,action,payload,env=None):</code> |
| `plan_input` | method | 48 | <code>def plan_input(self):</code> |
| `plan` | method | 50 | <code>def plan(self,data=None):</code> |
| `inspect_input` | method | 52 | <code>def inspect_input(self,plan):</code> |
| `published` | method | 54 | <code>def published(self):</code> |
| `reject` | method | 56 | <code>def reject(self,action,payload,code=None,env=None):</code> |
| `main` | function | 60 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/10_2.py

[Open source](../tests/hyperfide/cases/tasks/10_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 11 | <code>def expect(v,m="assertion failed"):</code> |
| `check` | function | 13 | <code>def check(name,fn):</code> |
| `policy` | function | 18 | <code>def policy():</code> |
| `observed` | function | 20 | <code>def observed():</code> |
| `Fixture` | class | 22 | <code>class Fixture:</code> |
| `__init__` | method | 23 | <code>def __init__(self,base):</code> |
| `call` | method | 27 | <code>def call(self,action,data):</code> |
| `assess` | method | 33 | <code>def assess(self,p=None,o=None,now=NOW):</code> |
| `reject` | method | 35 | <code>def reject(self,data):</code> |
| `main` | function | 37 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/10_3.py

[Open source](../tests/hyperfide/cases/tasks/10_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 7 | <code>def expect(v,m="assertion failed"):</code> |
| `check` | function | 9 | <code>def check(name,fn):</code> |
| `canon` | function | 14 | <code>def canon(v):return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False)</code> |
| `dg` | function | 15 | <code>def dg(v):return "sha256:"+hashlib.sha256((v if isinstance(v,bytes)else canon(v).encode())).hexdigest()</code> |
| `scope` | function | 16 | <code>def scope():return {"organisation_id":"org","pool_id":"pool","provider":"blaxel","provider_account_id":"account","environment_id":"workspace","region":"us-pdx-1","configuration_digest":"sha256:"+"a"&#42;6…</code> |
| `operation` | function | 17 | <code>def operation(kind="execute"):</code> |
| `rehash` | function | 22 | <code>def rehash(o):</code> |
| `lifetime` | function | 24 | <code>def lifetime():return {"schema_version":1,"run_seconds":259200,"checkpoint_lead_seconds":300,"termination_grace_seconds":30,"api_wait_seconds":30,"process":{"keep_alive":True,"timeout_seconds":0},"exp…</code> |
| `prepared` | function | 25 | <code>def prepared(o):</code> |
| `Fixture` | class | 28 | <code>class Fixture:</code> |
| `__init__` | method | 29 | <code>def __init__(self,base,root_component="10.3"):</code> |
| `close` | method | 41 | <code>def close(self):</code> |
| `call` | method | 44 | <code>def call(self,action,data):</code> |
| `good` | method | 48 | <code>def good(self,action,data):</code> |
| `bad` | method | 50 | <code>def bad(self,action,data,code=None):</code> |
| `reap` | function | 53 | <code>def reap():</code> |
| `capture_deadline` | function | 68 | <code>def capture_deadline():</code> |
| `pure_isolation` | function | 74 | <code>def pure_isolation():</code> |
| `main` | function | 81 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/10_4.py

[Open source](../tests/hyperfide/cases/tasks/10_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 7 | <code>def check(name,fn):</code> |
| `request` | function | 12 | <code>def request():return {"source":"FRESH_IMAGE","authenticated_memory_present":False,"environment_changed":False,"retained_volumes":&#91;&#93;,"checkpoint_digest":None}</code> |
| `main` | function | 13 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/11_1.py

[Open source](../tests/hyperfide/cases/tasks/11_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `digest` | function | 36 | <code>def digest(data):</code> |
| `canonical` | function | 39 | <code>def canonical(value):</code> |
| `expect` | function | 42 | <code>def expect(condition, detail):</code> |
| `check` | function | 46 | <code>def check(identity, callback):</code> |
| `Fixture` | class | 56 | <code>class Fixture:</code> |
| `__init__` | method | 57 | <code>def __init__(self, base):</code> |
| `pin` | method | 81 | <code>def pin(self,path):</code> |
| `make_profile` | method | 84 | <code>def make_profile(self):</code> |
| `invoke` | method | 111 | <code>def invoke(self, action="create", payload=None, &#42;, role="provisioner", trusted=True, extra_env=None):</code> |
| `create` | method | 136 | <code>def create(self):</code> |
| `verify` | method | 142 | <code>def verify(self,manifest):</code> |
| `reject` | method | 145 | <code>def reject(self,payload=None,&#42;,action="create",trusted=True,role="provisioner"):</code> |
| `using` | function | 154 | <code>def using(base,callback):</code> |
| `main` | function | 158 | <code>def main():</code> |
| `install_local_package` | function | 584 | <code>def install_local_package(candidate,manager):</code> |
| `link_cases` | function | 605 | <code>def link_cases(case):</code> |

## tests/hyperfide/cases/tasks/11_2.py

[Open source](../tests/hyperfide/cases/tasks/11_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 7 | <code>def expect(value,message):</code> |
| `check` | function | 9 | <code>def check(identity,callback):</code> |
| `git` | function | 13 | <code>def git(root,&#42;args):</code> |
| `Fixture` | class | 16 | <code>class Fixture:</code> |
| `__init__` | method | 17 | <code>def __init__(self,base):</code> |
| `invoke` | method | 32 | <code>def invoke(self,request=None,raw=None):</code> |
| `materialize` | method | 39 | <code>def materialize(self):</code> |
| `refused` | method | 42 | <code>def refused(self):</code> |
| `main` | function | 48 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/11_3.py

[Open source](../tests/hyperfide/cases/tasks/11_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `digest` | function | 9 | <code>def digest(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `canonical` | function | 10 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()</code> |
| `expect` | function | 11 | <code>def expect(value,message):</code> |
| `check` | function | 13 | <code>def check(identity,callback):</code> |
| `cleanup` | function | 17 | <code>def cleanup():</code> |
| `package_manager` | function | 20 | <code>def package_manager(name):</code> |
| `tool_invocation` | function | 32 | <code>def tool_invocation(resolved):</code> |
| `git` | function | 42 | <code>def git(path,&#42;args):</code> |
| `Fixture` | class | 44 | <code>class Fixture:</code> |
| `__init__` | method | 45 | <code>def __init__(self,base):</code> |
| `publish` | method | 96 | <code>def publish(self):</code> |
| `workspace_inventory` | method | 101 | <code>def workspace_inventory(self):</code> |
| `invoke` | method | 109 | <code>def invoke(self,action="environment.readiness"):</code> |
| `ready` | method | 114 | <code>def ready(self):</code> |
| `refused` | method | 122 | <code>def refused(self,reason=None):</code> |
| `close` | method | 126 | <code>def close(self):</code> |
| `main` | function | 128 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/11_4.py

[Open source](../tests/hyperfide/cases/tasks/11_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 13 | <code>def load(name,path):</code> |
| `expect` | function | 31 | <code>def expect(value,message):</code> |
| `check` | function | 33 | <code>def check(name,callback):</code> |
| `sha` | function | 38 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `canonical` | function | 39 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()</code> |
| `become_subreaper` | function | 40 | <code>def become_subreaper():</code> |
| `reap_orphans` | function | 43 | <code>def reap_orphans(keep,seconds=15):</code> |
| `recipe_policy` | function | 54 | <code>def recipe_policy(repository,command):</code> |
| `PrewarmFixture` | class | 58 | <code>class PrewarmFixture(scheduler.SchedulerFixture):</code> |
| `__init__` | method | 60 | <code>def __init__(self):</code> |
| `manifest` | method | 65 | <code>def manifest(self,profile,command,name):</code> |
| `sql` | method | 77 | <code>def sql(self,sql,values=None,admin=False,serial=True):</code> |
| `accept_spec` | method | 95 | <code>def accept_spec(f):</code> |
| `setup` | method | 106 | <code>def setup(f):</code> |
| `write_pool_config` | method | 117 | <code>def write_pool_config(f):</code> |
| `seed_quota` | method | 119 | <code>def seed_quota(f):</code> |
| `start_provisioner` | method | 127 | <code>def start_provisioner(f):</code> |
| `stop_provisioner` | method | 145 | <code>def stop_provisioner(f):</code> |
| `close` | method | 151 | <code>def close(f):</code> |
| `main` | function | 157 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/12_1.py

[Open source](../tests/hyperfide/cases/tasks/12_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 20 | <code>def check(name, fn):</code> |
| `expect` | function | 27 | <code>def expect(ok, message='unexpected outcome'):</code> |
| `uid` | function | 30 | <code>def uid(): return str(uuid.uuid4())</code> |
| `sha` | function | 31 | <code>def sha(data): return 'sha256:' + hashlib.sha256(data).hexdigest()</code> |
| `b64` | function | 32 | <code>def b64(data): return base64.urlsafe_b64encode(data).decode().rstrip('=')</code> |
| `canonical` | function | 33 | <code>def canonical(value): return json.dumps(value, separators=(',', ':'))</code> |
| `private` | function | 34 | <code>def private(path, value):</code> |
| `native` | function | 40 | <code>def native(action, request, timeout=60):</code> |
| `ok` | function | 49 | <code>def ok(action, request, &#42;&#42;kw):</code> |
| `refused` | function | 54 | <code>def refused(action, request, expected_code):</code> |
| `run` | function | 59 | <code>def run(argv, &#42;&#42;kw):</code> |
| `build_contract_checks` | function | 63 | <code>def build_contract_checks():</code> |
| `setup` | function | 119 | <code>def setup(f):</code> |
| `certificate` | function | 124 | <code>def certificate(folder, name, sans, ca=None):</code> |
| `users` | function | 135 | <code>def users(count):</code> |
| `as_slot` | function | 188 | <code>def as_slot(slot, mode, tag, &#42;args, stdin=False):</code> |
| `finished` | function | 193 | <code>def finished(process, timeout=60):</code> |
| `https` | function | 198 | <code>def https(f, body, headers, port=None):</code> |
| `main` | function | 208 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/12_2.py

[Open source](../tests/hyperfide/cases/tasks/12_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 77 | <code>def uid():</code> |
| `sha` | function | 81 | <code>def sha(data):</code> |
| `canonical` | function | 85 | <code>def canonical(value):</code> |
| `b64` | function | 89 | <code>def b64(data):</code> |
| `unb64` | function | 93 | <code>def unb64(text):</code> |
| `check` | function | 97 | <code>def check(name, ok, detail=None):</code> |
| `wait_for` | function | 103 | <code>def wait_for(predicate, seconds, step=0.1):</code> |
| `Coordinator` | class | 116 | <code>class Coordinator:</code> |
| `__init__` | method | 117 | <code>def __init__(self, directory):</code> |
| `save` | method | 131 | <code>def save(self):</code> |
| `verify` | method | 137 | <code>def verify(self, headers, body):</code> |
| `packet` | method | 169 | <code>def packet(self, ins, now):</code> |
| `find` | method | 178 | <code>def find(self, command):</code> |
| `native_observed` | method | 181 | <code>def native_observed(self, command):</code> |
| `handle` | method | 184 | <code>def handle(self, payload):</code> |
| `control` | method | 289 | <code>def control(self, request):</code> |
| `serve` | method | 305 | <code>def serve(self):</code> |
| `Handler` | class | 308 | <code>class Handler(BaseHTTPRequestHandler):</code> |
| `log_message` | method | 311 | <code>def log_message(self, &#42;args):</code> |
| `reply` | method | 314 | <code>def reply(self, status, value):</code> |
| `do_POST` | method | 322 | <code>def do_POST(self):</code> |
| `Probe` | class | 366 | <code>class Probe:</code> |
| `__init__` | method | 367 | <code>def __init__(self):</code> |
| `openssl` | method | 382 | <code>def openssl(self, &#42;args):</code> |
| `setup` | method | 385 | <code>def setup(self):</code> |
| `start_coordinator` | method | 448 | <code>def start_coordinator(self):</code> |
| `stop_coordinator` | method | 454 | <code>def stop_coordinator(self):</code> |
| `control` | method | 461 | <code>def control(self, value):</code> |
| `cstate` | method | 470 | <code>def cstate(self):</code> |
| `native` | method | 475 | <code>def native(self, action, request, timeout=30):</code> |
| `start_serve` | method | 484 | <code>def start_serve(self, slot="S1", seconds=150):</code> |
| `stop_serve` | method | 490 | <code>def stop_serve(self, sig):</code> |
| `helper` | method | 496 | <code>def helper(self, suid):</code> |
| `proc_stat` | method | 505 | <code>def proc_stat(pid):</code> |
| `proc_uid` | method | 514 | <code>def proc_uid(pid):</code> |
| `alive` | method | 522 | <code>def alive(self, pid, start=None):</code> |
| `uid_processes` | method | 526 | <code>def uid_processes(self, suid):</code> |
| `ledger` | method | 533 | <code>def ledger(self, sql, args=()):</code> |
| `launch` | method | 543 | <code>def launch(self, launch_id):</code> |
| `events` | method | 547 | <code>def events(self, launch_id, kind=None):</code> |
| `stdout` | method | 552 | <code>def stdout(self, launch_id):</code> |
| `lock_held` | method | 558 | <code>def lock_held(self, launch_id):</code> |
| `instruction` | method | 573 | <code>def instruction(self, kind, launch_id, body, attempt, generation="2", held=False, suppress=True):</code> |
| `start_body` | method | 580 | <code>def start_body(self, slot, session=None):</code> |
| `steer_body` | method | 583 | <code>def steer_body(self, text):</code> |
| `simulate_accepted` | method | 586 | <code>def simulate_accepted(self, ins, slot, state="ACCEPTED", agent=None):</code> |
| `cleanup` | method | 606 | <code>def cleanup(self):</code> |
| `scenario` | function | 654 | <code>def scenario(p):</code> |
| `cleanup_state` | function | 830 | <code>def cleanup_state():</code> |
| `cleanup_only` | function | 839 | <code>def cleanup_only():</code> |
| `dispatch_probe` | function | 857 | <code>def dispatch_probe():</code> |
| `main` | function | 878 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/12_3.py

[Open source](../tests/hyperfide/cases/tasks/12_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `emit` | function | 14 | <code>def emit(assertion, expected, actual):</code> |
| `start_time` | function | 109 | <code>def start_time(pid):</code> |
| `session_of` | function | 113 | <code>def session_of(pid):</code> |
| `boot_id` | function | 119 | <code>def boot_id():</code> |
| `slot_pids` | function | 122 | <code>def slot_pids():</code> |
| `reap_orphans` | function | 136 | <code>def reap_orphans():</code> |
| `kill_slot` | function | 145 | <code>def kill_slot():</code> |
| `wait_gone` | function | 159 | <code>def wait_gone(pid, seconds=10):</code> |
| `Fixture` | class | 174 | <code>class Fixture:</code> |
| `__init__` | method | 175 | <code>def __init__(self, work):</code> |
| `request` | method | 186 | <code>def request(self, &#42;&#42;extra):</code> |
| `observe` | method | 191 | <code>def observe(self, &#42;&#42;extra):</code> |
| `raw` | method | 194 | <code>def raw(self, body):</code> |
| `write_lock` | method | 203 | <code>def write_lock(self, owner):</code> |
| `setup` | method | 209 | <code>def setup(self):</code> |
| `command` | method | 251 | <code>def command(self, op):</code> |
| `helper` | method | 256 | <code>def helper(self, mode, target):</code> |
| `serve_broker` | method | 264 | <code>def serve_broker(self, state):</code> |
| `cleanup` | method | 281 | <code>def cleanup(self):</code> |
| `member` | function | 311 | <code>def member(observation, pid):</code> |
| `relation` | function | 314 | <code>def relation(observation, pid):</code> |
| `progress_line` | function | 318 | <code>def progress_line(sequence, useful, state="WORKING", &#42;&#42;extra):</code> |
| `scenarios` | function | 321 | <code>def scenarios(fx):</code> |
| `build` | function | 475 | <code>def build(work):</code> |
| `main` | function | 485 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/12_4.py

[Open source](../tests/hyperfide/cases/tasks/12_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 18 | <code>def uid():return str(uuid.uuid4())</code> |
| `sha` | function | 19 | <code>def sha(b):return "sha256:"+hashlib.sha256(b).hexdigest()</code> |
| `expect` | function | 20 | <code>def expect(value,message):</code> |
| `check` | function | 22 | <code>def check(name,fn):</code> |
| `load` | function | 26 | <code>def load(name,path):</code> |
| `Control` | class | 34 | <code>class Control:</code> |
| `__init__` | method | 35 | <code>def __init__(self):</code> |
| `svc` | method | 53 | <code>def svc(self,action,value,key="operator"):</code> |
| `ok` | method | 56 | <code>def ok(self,action,value,key="operator"):</code> |
| `refused` | method | 58 | <code>def refused(self,action,value,code,key="operator"):</code> |
| `issue` | method | 60 | <code>def issue(self,action,launch,policy=POLICY,outputs=OUTPUTS,generation=None,command=None):</code> |
| `run` | method | 64 | <code>def run(self,action,launch,command,&#42;&#42;extra):</code> |
| `inspect` | method | 66 | <code>def inspect(self,command):return self.ok("runner.control.inspect",{"command_id":command})</code> |
| `published` | method | 67 | <code>def published(self,attempt,generation):return self.ok("runner.publication.check",{"attempt_id":attempt,"attempt_generation":generation})&#91;"allowed"&#93;</code> |
| `states` | method | 68 | <code>def states(self,user):return &#91;s for _,s in slots.uid_processes(user)&#93;</code> |
| `close` | method | 69 | <code>def close(self):</code> |
| `respawner` | function | 79 | <code>def respawner(user,seconds):</code> |
| `validate` | function | 90 | <code>def validate(items):</code> |
| `control_probe` | function | 94 | <code>def control_probe(c):</code> |
| `subprobes` | function | 362 | <code>def subprobes():</code> |
| `main` | function | 387 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/12_4_executor.py

[Open source](../tests/hyperfide/cases/tasks/12_4_executor.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 13 | <code>def uid():return str(uuid.uuid4())</code> |
| `digest` | function | 14 | <code>def digest(b):return "sha256:"+hashlib.sha256(b).hexdigest()</code> |
| `canonical` | function | 15 | <code>def canonical(v):return json.dumps(v,separators=(",",":"),ensure_ascii=False).encode()</code> |
| `expect` | function | 16 | <code>def expect(v,message):</code> |
| `check` | function | 18 | <code>def check(name,callback):</code> |
| `load` | function | 22 | <code>def load(name,path):</code> |
| `Actor` | class | 79 | <code>class Actor:</code> |
| `__init__` | method | 80 | <code>def __init__(self,f,components,config):</code> |
| `read` | method | 85 | <code>def read(self):</code> |
| `request` | method | 91 | <code>def request(self,value):</code> |
| `close` | method | 93 | <code>def close(self):</code> |
| `Fixture` | class | 100 | <code>class Fixture:</code> |
| `__init__` | method | 101 | <code>def __init__(self,base):</code> |
| `seed_uncertain_history` | method | 133 | <code>def seed_uncertain_history(self):</code> |
| `proof` | method | 154 | <code>def proof(self,key="provisioner",component="14.1",action="identity.describe",value=None):</code> |
| `command` | method | 159 | <code>def command(self,op,&#42;&#42;values):return self.actor.request({"op":op,&#42;&#42;self.proof(),&#42;&#42;values})</code> |
| `refused` | method | 160 | <code>def refused(self,value,code):</code> |
| `config_refused` | method | 162 | <code>def config_refused(self,name,content=None,mode=0o600,source=None):</code> |
| `wait_admission_refused` | method | 169 | <code>def wait_admission_refused(self):</code> |
| `history_unchanged` | method | 177 | <code>def history_unchanged(self):</code> |
| `sql_refused` | method | 184 | <code>def sql_refused(self,sql,values):</code> |
| `metadata_guard_tests` | method | 188 | <code>def metadata_guard_tests(self):</code> |
| `stored_read_tests` | method | 210 | <code>def stored_read_tests(self,artifact,payload):</code> |
| `reference_link_tests` | method | 243 | <code>def reference_link_tests(self,artifact):</code> |
| `close` | method | 255 | <code>def close(self):</code> |
| `main` | function | 261 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/13_1.py

[Open source](../tests/hyperfide/cases/tasks/13_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 9 | <code>def expect(ok,detail):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `digest` | function | 16 | <code>def digest(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `invoke` | function | 17 | <code>def invoke(action,value,env):</code> |
| `success` | function | 22 | <code>def success(action,value,env):</code> |
| `refuse` | function | 25 | <code>def refuse(action,value,env):</code> |
| `profile` | function | 27 | <code>def profile(name,executable):</code> |
| `enable_subreaper` | function | 35 | <code>def enable_subreaper():</code> |
| `drain_owned_children` | function | 38 | <code>def drain_owned_children():</code> |
| `actual_supervisory_host` | function | 57 | <code>def actual_supervisory_host():</code> |
| `main` | function | 71 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/13_1_host.py

[Open source](../tests/hyperfide/cases/tasks/13_1_host.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 7 | <code>def uid():return str(uuid.uuid4())</code> |
| `sha` | function | 8 | <code>def sha(b):return 'sha256:'+hashlib.sha256(b).hexdigest()</code> |
| `check` | function | 9 | <code>def check(name,fn):</code> |
| `expect` | function | 13 | <code>def expect(ok,message='Unexpected real host outcome'):</code> |
| `until` | function | 15 | <code>def until(fn,timeout=5):</code> |
| `proc` | function | 22 | <code>def proc(pid):</code> |
| `Fixture` | class | 49 | <code>class Fixture:</code> |
| `__init__` | method | 50 | <code>def __init__(self):</code> |
| `as_control` | method | 72 | <code>def as_control(self,value):</code> |
| `write` | method | 75 | <code>def write(self,path,body):path.write_bytes(json.dumps(body,separators=(',',':')).encode()+b'&#92;n');path.chmod(0o600)</code> |
| `uid_pids` | method | 76 | <code>def uid_pids(self,target):</code> |
| `argv` | method | 85 | <code>def argv(self,config=None):</code> |
| `start_host` | method | 87 | <code>def start_host(self,nofile=None):</code> |
| `request` | method | 97 | <code>def request(self,value,raw=None):</code> |
| `ok` | method | 106 | <code>def ok(self,value):</code> |
| `no` | method | 108 | <code>def no(self,value,code=None,raw=None):</code> |
| `plan` | method | 110 | <code>def plan(self,mode='echo',&#42;&#42;changes):</code> |
| `launch` | method | 112 | <code>def launch(self,mode='echo',&#42;&#42;changes):</code> |
| `inspect` | method | 114 | <code>def inspect(self,p,&#42;&#42;kw):return self.ok(dict(action='inspect',launch_id=p&#91;'launch_id'&#93;,&#42;&#42;kw))</code> |
| `frame` | method | 115 | <code>def frame(self,p,identity,data,operation=None):return {'action':'input','launch_id':p&#91;'launch_id'&#93;,'process_identity':identity,'operation_id':operation or uid(),'frame_digest':sha(data),'frame_b64':ba…</code> |
| `stop` | method | 116 | <code>def stop(self,p,r,operation=None):return self.ok({'action':'stop','launch_id':p&#91;'launch_id'&#93;,'process_identity':r&#91;'process_identity'&#93;,'operation_id':operation or uid()})</code> |
| `stream` | method | 117 | <code>def stream(self,p,name='stdout'):return b''.join(base64.b64decode(x&#91;'frame_b64'&#93;) for x in self.inspect(p)&#91;'frames'&#93; if x&#91;'stream'&#93;==name)</code> |
| `ready` | method | 118 | <code>def ready(self,p):return until(lambda:self.stream(p).startswith(b'{') and b'&#92;n' in self.stream(p) and json.loads(self.stream(p).split(b'&#92;n')&#91;0&#93;))</code> |
| `shrink_pipe` | method | 119 | <code>def shrink_pipe(self):</code> |
| `reap` | method | 132 | <code>def reap(self):</code> |
| `close` | method | 138 | <code>def close(self):</code> |

## tests/hyperfide/cases/tasks/13_2.py

[Open source](../tests/hyperfide/cases/tasks/13_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 10 | <code>def uid():return str(uuid.uuid4())</code> |
| `sha` | function | 11 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `expect` | function | 12 | <code>def expect(value,message):</code> |
| `check` | function | 14 | <code>def check(identity,callback):</code> |
| `enable_subreaper` | function | 19 | <code>def enable_subreaper():</code> |
| `drain_owned_children` | function | 22 | <code>def drain_owned_children():</code> |
| `SessionIdentityFixture` | class | 41 | <code>class SessionIdentityFixture(IdentityFixture):</code> |
| `stop` | method | 42 | <code>def stop(self):</code> |
| `NativeHandshake` | class | 47 | <code>class NativeHandshake:</code> |
| `__init__` | method | 49 | <code>def __init__(self,count=4):</code> |
| `rpc` | method | 80 | <code>def rpc(self,message):</code> |
| `terminate` | method | 95 | <code>def terminate(self):</code> |
| `native_descendants` | method | 99 | <code>def native_descendants(self):</code> |
| `close` | method | 113 | <code>def close(self):</code> |
| `__enter__` | method | 132 | <code>def __enter__(self):return self</code> |
| `__exit__` | method | 133 | <code>def __exit__(self,&#42;_):self.close()</code> |
| `AgentFixture` | class | 135 | <code>class AgentFixture(NativeHandshake):</code> |
| `__init__` | method | 136 | <code>def __init__(self,admission=False,qualified=False):</code> |
| `foreign_runner` | method | 186 | <code>def foreign_runner(self):</code> |
| `invoke` | method | 199 | <code>def invoke(self,action,value,component="13.2",key="operator"):</code> |
| `ok` | method | 201 | <code>def ok(self,action,value,component="13.2",key="operator"):</code> |
| `bad` | method | 203 | <code>def bad(self,action,value,code=None,component="13.2",key="operator"):</code> |
| `bind` | method | 206 | <code>def bind(self,session=None,native=None):</code> |
| `close` | method | 209 | <code>def close(self,resource):</code> |
| `cleanup_state` | function | 224 | <code>def cleanup_state(resource):</code> |
| `cleanup_only` | function | 230 | <code>def cleanup_only(resource):</code> |
| `handshake_isolation` | function | 240 | <code>def handshake_isolation():</code> |
| `main` | function | 250 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/13_3.py

[Open source](../tests/hyperfide/cases/tasks/13_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 8 | <code>def expect(ok,message):</code> |
| `check` | function | 10 | <code>def check(identity,fn):</code> |
| `invoke` | function | 14 | <code>def invoke(value,fds=()):</code> |
| `result` | function | 20 | <code>def result(value,fds=()):</code> |
| `refuse` | function | 22 | <code>def refuse(value,fds=()):</code> |
| `decision` | function | 24 | <code>def decision(value,name,reason=None,fds=()):</code> |
| `spawn` | function | 28 | <code>def spawn(argv,&#42;&#42;kw):</code> |
| `stat` | function | 30 | <code>def stat(pid):return Path(f"/proc/{pid}/stat").read_text().rsplit(")",1)&#91;1&#93;.split()</code> |
| `wait_for` | function | 31 | <code>def wait_for(fn,message):</code> |
| `handoff` | function | 36 | <code>def handoff(base,new_session,&#42;&#42;override):</code> |
| `main` | function | 41 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/13_4.py

[Open source](../tests/hyperfide/cases/tasks/13_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonical` | function | 16 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()</code> |
| `_release_sql` | function | 18 | <code>def _release_sql(self,sql,values=None,&#42;&#42;kwargs):</code> |
| `ReleaseIdentityFixture` | class | 28 | <code>class ReleaseIdentityFixture(module.SessionIdentityFixture):</code> |
| `__init__` | method | 31 | <code>def __init__(self,extra_components=(),extra_setup=None,&#42;&#42;kwargs):</code> |
| `AdmissionFixture` | class | 37 | <code>class AdmissionFixture(AgentFixture):</code> |
| `__init__` | method | 38 | <code>def __init__(self):</code> |
| `adapt` | method | 42 | <code>def adapt(self,f):</code> |
| `policy_digest` | method | 54 | <code>def policy_digest(self,quota):</code> |
| `seed_reservation` | method | 56 | <code>def seed_reservation(self,quota,session,reservation,request,active):</code> |
| `seed_dispatch` | method | 60 | <code>def seed_dispatch(self):</code> |
| `resolve_dispatch` | method | 66 | <code>def resolve_dispatch(self,command):</code> |
| `check` | function | 69 | <code>def check(identity,fn):</code> |
| `startup_budget` | function | 73 | <code>def startup_budget():</code> |
| `classifier_table` | function | 140 | <code>def classifier_table():</code> |
| `main` | function | 146 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/14_1.py

[Open source](../tests/hyperfide/cases/tasks/14_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `service_rpc_probe` | function | 7 | <code>def service_rpc_probe(f):</code> |
| `main` | function | 45 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/14_2.py

[Open source](../tests/hyperfide/cases/tasks/14_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 9 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/14_3.py

[Open source](../tests/hyperfide/cases/tasks/14_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `file_hash` | function | 8 | <code>def file_hash(p):</code> |
| `main` | function | 10 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/14_4.py

[Open source](../tests/hyperfide/cases/tasks/14_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 8 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/14_isolation_transport.py

[Open source](../tests/hyperfide/cases/tasks/14_isolation_transport.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 155 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/14_writer_observation_transport.py

[Open source](../tests/hyperfide/cases/tasks/14_writer_observation_transport.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 192 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/15_1.py

[Open source](../tests/hyperfide/cases/tasks/15_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 30 | <code>def expect(value,message="observed assertion failed"):</code> |
| `check` | function | 32 | <code>def check(identity,callback):</code> |
| `git` | function | 41 | <code>def git(repo,&#42;args):</code> |
| `invoke` | function | 44 | <code>def invoke(action,request,env=None,raw=None):</code> |
| `Fixture` | class | 52 | <code>class Fixture:</code> |
| `__init__` | method | 53 | <code>def __init__(self,base,scope=None):</code> |
| `refuse` | method | 107 | <code>def refuse(self,action,request,code=None,env=None,raw=None):</code> |
| `capture_refused` | method | 113 | <code>def capture_refused(self,mutate,code=None):</code> |
| `restore` | method | 118 | <code>def restore(self,request=None):</code> |
| `chunks` | method | 122 | <code>def chunks(self):</code> |
| `capsule_variant` | method | 130 | <code>def capsule_variant(self,mutator):</code> |
| `native_suite` | function | 134 | <code>def native_suite(f):</code> |
| `evidence_dir` | function | 278 | <code>def evidence_dir():</code> |
| `sql` | function | 282 | <code>def sql(statement,database="postgres"):</code> |
| `cleanup` | function | 290 | <code>def cleanup(emit=True):</code> |
| `AuthenticatedArtifactAdapter` | class | 308 | <code>class AuthenticatedArtifactAdapter:</code> |
| `__init__` | method | 315 | <code>def __init__(self,objects,base,database,resource_id):</code> |
| `close` | method | 353 | <code>def close(self):</code> |
| `durable_suite` | function | 356 | <code>def durable_suite(f):</code> |
| `pin_manifest` | function | 442 | <code>def pin_manifest():</code> |
| `main` | function | 471 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/15_2.py

[Open source](../tests/hyperfide/cases/tasks/15_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 77 | <code>def expect(condition, detail):</code> |
| `check` | function | 81 | <code>def check(identity, callback):</code> |
| `digest` | function | 93 | <code>def digest(data):</code> |
| `canonical` | function | 96 | <code>def canonical(value):</code> |
| `environment` | function | 99 | <code>def environment(database=None):</code> |
| `sql` | function | 107 | <code>def sql(statement, &#42;, database=None, allow_error=False):</code> |
| `rows` | function | 116 | <code>def rows(statement):</code> |
| `artifacts` | function | 120 | <code>def artifacts():</code> |
| `find` | function | 125 | <code>def find(data, run=None):</code> |
| `output_dir` | function | 131 | <code>def output_dir():</code> |
| `cleanup` | function | 136 | <code>def cleanup():</code> |
| `ObjectFixture` | class | 161 | <code>class ObjectFixture:</code> |
| `__init__` | method | 163 | <code>def __init__(self):</code> |
| `Sink` | class | 173 | <code>class Sink(BaseHTTPRequestHandler):</code> |
| `log_message` | method | 174 | <code>def log_message(self, &#42;args): pass</code> |
| `do_GET` | method | 175 | <code>def do_GET(self):</code> |
| `Handler` | class | 183 | <code>class Handler(BaseHTTPRequestHandler):</code> |
| `log_message` | method | 185 | <code>def log_message(self, &#42;args): pass</code> |
| `reply` | method | 186 | <code>def reply(self, status, data=b"", &#42;, length=None, headers=None):</code> |
| `do_GET` | method | 196 | <code>def do_GET(self): self.perform()</code> |
| `do_PUT` | method | 197 | <code>def do_PUT(self): self.perform()</code> |
| `perform` | method | 198 | <code>def perform(self):</code> |
| `signature` | method | 255 | <code>def signature(method, path, headers, body):</code> |
| `key` | method | 283 | <code>def key(self, data, run=None):</code> |
| `set_mode` | method | 287 | <code>def set_mode(self, data, mode, run=None):</code> |
| `stop` | method | 291 | <code>def stop(self):</code> |
| `Service` | class | 300 | <code>class Service:</code> |
| `__init__` | method | 302 | <code>def __init__(self, base, fixture, database=None, resource_id=None):</code> |
| `request` | method | 350 | <code>def request(self, action, value, &#42;, component="15.2", env=None, principal_run=None, &#42;&#42;obsolete):</code> |
| `ok` | method | 371 | <code>def ok(self, action, value, &#42;&#42;options):</code> |
| `reject` | method | 377 | <code>def reject(self, action, value, code, &#42;&#42;options):</code> |
| `put` | method | 383 | <code>def put(self, data, &#42;&#42;changes):</code> |
| `by_id` | method | 387 | <code>def by_id(self, result):</code> |
| `crash_upload` | method | 390 | <code>def crash_upload(self, action, value, blob, path):</code> |
| `close` | method | 415 | <code>def close(self):</code> |
| `AuthenticatedArtifactFixture` | class | 424 | <code>class AuthenticatedArtifactFixture:</code> |
| `__init__` | method | 425 | <code>def __init__(self, base, database, resource_id):</code> |
| `close` | method | 431 | <code>def close(self):</code> |
| `createAuthenticatedFixture` | function | 437 | <code>def createAuthenticatedFixture(base, database, resource_id):</code> |
| `upload` | function | 441 | <code>def upload(data, &#42;&#42;changes):</code> |
| `verified` | function | 448 | <code>def verified(result, data=None):</code> |
| `unavailable` | function | 464 | <code>def unavailable(service, action, value, &#42;, availability=None, codes=()):</code> |
| `seed` | function | 475 | <code>def seed():</code> |
| `main` | function | 489 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/15_3.py

[Open source](../tests/hyperfide/cases/tasks/15_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `module` | function | 13 | <code>def module(name,path):</code> |
| `accepted_intent` | function | 24 | <code>def accepted_intent():</code> |
| `sha` | function | 47 | <code>def sha(data):return 'sha256:'+hashlib.sha256(data).hexdigest()</code> |
| `canonical` | function | 48 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()</code> |
| `expect` | function | 49 | <code>def expect(value,message='Observed checkpoint assertion failed'):</code> |
| `check` | function | 51 | <code>def check(name,call):</code> |
| `CheckpointFixture` | class | 55 | <code>class CheckpointFixture:</code> |
| `__init__` | method | 56 | <code>def __init__(self):</code> |
| `ok` | method | 102 | <code>def ok(self,action,value,component='15.3',key='operator'):</code> |
| `put` | method | 104 | <code>def put(self,data):</code> |
| `upload` | method | 107 | <code>def upload(self,data):</code> |
| `reject` | method | 113 | <code>def reject(self,value,codes,key='operator',action='artifact.checkpoint.register'):</code> |
| `adopt_request` | method | 116 | <code>def adopt_request(self,&#42;&#42;overrides):</code> |
| `close` | method | 118 | <code>def close(self):</code> |
| `adoption` | function | 122 | <code>def adoption(f,checkpoint_id):</code> |
| `main` | function | 188 | <code>def main():</code> |
| `cleanup` | function | 230 | <code>def cleanup():</code> |

## tests/hyperfide/cases/tasks/15_4.py

[Open source](../tests/hyperfide/cases/tasks/15_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `module` | function | 9 | <code>def module(name,path):</code> |
| `expect` | function | 17 | <code>def expect(value,message):</code> |
| `check` | function | 19 | <code>def check(name,call):</code> |
| `sha` | function | 23 | <code>def sha(data):return 'sha256:'+hashlib.sha256(data).hexdigest()</code> |
| `output` | function | 24 | <code>def output():</code> |
| `DeleteFixture` | class | 26 | <code>class DeleteFixture(objects.ObjectFixture):</code> |
| `__init__` | method | 27 | <code>def __init__(self):</code> |
| `cleanup` | function | 64 | <code>def cleanup():</code> |
| `main` | function | 84 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/16_1.py

[Open source](../tests/hyperfide/cases/tasks/16_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `directory` | function | 16 | <code>def directory():</code> |
| `emit` | function | 21 | <code>def emit(key, actual, expected=True):</code> |
| `node` | function | 27 | <code>def node(program):</code> |
| `authority_cases` | function | 34 | <code>def authority_cases():</code> |
| `primary_cases` | function | 89 | <code>def primary_cases():</code> |
| `sql` | function | 129 | <code>def sql(text, database=None, accept_error=False):</code> |
| `semantic_cases` | function | 139 | <code>def semantic_cases():</code> |
| `signed_cases` | function | 176 | <code>def signed_cases():</code> |
| `OwnedFixture` | class | 205 | <code>class OwnedFixture(IdentityFixture):</code> |
| `__init__` | method | 206 | <code>def __init__(self,&#42;&#42;kwargs):</code> |
| `cleanup_signed` | function | 253 | <code>def cleanup_signed():</code> |
| `cleanup` | function | 319 | <code>def cleanup(report=True):</code> |
| `git_cases` | function | 341 | <code>def git_cases():</code> |
| `preparation_cases` | function | 426 | <code>def preparation_cases():</code> |
| `cleanup_preparation` | function | 491 | <code>def cleanup_preparation():</code> |
| `cleanup_git` | function | 503 | <code>def cleanup_git():</code> |
| `submission_record` | function | 517 | <code>def submission_record():</code> |
| `submission_stack_module` | function | 520 | <code>def submission_stack_module():</code> |
| `submission_cases` | function | 525 | <code>def submission_cases():</code> |
| `connected_stack_cases` | function | 639 | <code>def connected_stack_cases():</code> |
| `cleanup_connected` | function | 653 | <code>def cleanup_connected():</code> |
| `cleanup_submission` | function | 660 | <code>def cleanup_submission():</code> |
| `schema_cases` | function | 668 | <code>def schema_cases():</code> |
| `main` | function | 712 | <code>def main(task="16.1"):</code> |

## tests/hyperfide/cases/tasks/16_2.py

[Open source](../tests/hyperfide/cases/tasks/16_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `gate_cases` | function | 26 | <code>def gate_cases():</code> |
| `harness_case` | function | 93 | <code>def harness_case():</code> |
| `history_cases` | function | 114 | <code>def history_cases(fixture):</code> |
| `install_history_hook` | function | 196 | <code>def install_history_hook():</code> |
| `history_authority_cases` | function | 210 | <code>def history_authority_cases():</code> |
| `install_cases` | function | 226 | <code>def install_cases():</code> |

## tests/hyperfide/cases/tasks/16_3.py

[Open source](../tests/hyperfide/cases/tasks/16_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 28 | <code>def load(name, path):</code> |
| `sha` | function | 44 | <code>def sha(data):</code> |
| `canonical` | function | 47 | <code>def canonical(value):</code> |
| `uid` | function | 50 | <code>def uid():</code> |
| `oid` | function | 53 | <code>def oid(label):</code> |
| `behaviour_cases` | function | 56 | <code>def behaviour_cases():</code> |
| `OwnedFixture` | class | 132 | <code>class OwnedFixture(IdentityFixture):</code> |
| `__init__` | method | 133 | <code>def __init__(self, &#42;&#42;kwargs):</code> |
| `start` | method | 145 | <code>def start(self):</code> |
| `cleanup_behaviour` | function | 318 | <code>def cleanup_behaviour():</code> |
| `primary_cases` | function | 368 | <code>def primary_cases():</code> |
| `quiet_cleanup` | function | 372 | <code>def quiet_cleanup():</code> |

## tests/hyperfide/cases/tasks/16_4.py

[Open source](../tests/hyperfide/cases/tasks/16_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 25 | <code>def sha(text):return "sha256:"+hashlib.sha256(text.encode()).hexdigest()</code> |
| `lit` | function | 26 | <code>def lit(value):</code> |
| `behaviour_task` | function | 32 | <code>def behaviour_task():</code> |
| `record_path` | function | 38 | <code>def record_path():</code> |
| `Behaviour` | class | 41 | <code>class Behaviour:</code> |
| `__init__` | method | 43 | <code>def __init__(self,fixture):</code> |
| `sql` | method | 55 | <code>def sql(self,text):return self.f.sql(text)</code> |
| `one` | method | 56 | <code>def one(self,text):</code> |
| `seed` | method | 59 | <code>def seed(self,authority="ACTIVE",checks=CHECKS,task_state="QUALIFIED",running=False):</code> |
| `snapshot` | method | 89 | <code>def snapshot(self,seeded):</code> |
| `call` | method | 103 | <code>def call(self,action,payload,request_id=None):</code> |
| `invalidate` | method | 110 | <code>def invalidate(self,seeded,changes,version="1",request_id=None,extra=None):</code> |
| `inspect` | method | 115 | <code>def inspect(self,seeded):</code> |
| `expected_affected` | function | 118 | <code>def expected_affected(checks,keys):</code> |
| `check` | function | 121 | <code>def check(key,predicate):</code> |
| `behaviour_cases` | function | 127 | <code>def behaviour_cases(b):</code> |
| `run_behaviour` | function | 212 | <code>def run_behaviour():</code> |
| `OwnedFixture` | class | 229 | <code>class OwnedFixture(IdentityFixture):</code> |
| `__init__` | method | 230 | <code>def __init__(self,&#42;&#42;kwargs):</code> |
| `primary_cases` | function | 251 | <code>def primary_cases():</code> |
| `cleanup_behaviour` | function | 256 | <code>def cleanup_behaviour():</code> |

## tests/hyperfide/cases/tasks/17_1.py

[Open source](../tests/hyperfide/cases/tasks/17_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `xid` | function | 31 | <code>def xid(n):return f"00000000-0000-4000-8000-{n:012x}"</code> |
| `expect` | function | 32 | <code>def expect(value,message):</code> |
| `check` | function | 34 | <code>def check(identity,callback):</code> |
| `database` | function | 38 | <code>def database(task):</code> |
| `database_env` | function | 41 | <code>def database_env(task,maintenance=False):</code> |
| `sql` | function | 45 | <code>def sql(task,statement,maintenance=False,allow_error=False):</code> |
| `evidence_dir` | function | 51 | <code>def evidence_dir(task):</code> |
| `cleanup` | function | 53 | <code>def cleanup(task):</code> |
| `Fixture` | class | 64 | <code>class Fixture:</code> |
| `__init__` | method | 65 | <code>def __init__(self,task,base,components=None,extra_setup=None):</code> |
| `setup` | method | 91 | <code>def setup(self,f):</code> |
| `git` | method | 114 | <code>def git(self,&#42;args):</code> |
| `commit` | method | 117 | <code>def commit(self,message,body=None):</code> |
| `session` | method | 120 | <code>def session(self,number):</code> |
| `request` | method | 128 | <code>def request(self,action,value=None,component="17.1",extra_env=None,key="operator"):</code> |
| `ok` | method | 134 | <code>def ok(self,action,value,&#42;&#42;kwargs):</code> |
| `reject` | method | 136 | <code>def reject(self,action,value,code,&#42;&#42;kwargs):</code> |
| `configure` | method | 138 | <code>def configure(self,policy=None,extra_env=None):</code> |
| `discover` | method | 141 | <code>def discover(self,batch=64):</code> |
| `coverage` | method | 143 | <code>def coverage(self,commit,&#42;&#42;fields):</code> |
| `save` | method | 145 | <code>def save(self,failed):</code> |
| `closed_audit` | function | 147 | <code>def closed_audit(f,action,body,component,write=False):</code> |
| `cases` | function | 166 | <code>def cases(f):</code> |
| `main` | function | 235 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/17_2.py

[Open source](../tests/hyperfide/cases/tasks/17_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonical` | function | 19 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"))</code> |
| `seed_graph` | function | 20 | <code>def seed_graph(f,tag,sources,symbols,edges,unresolved=False):</code> |
| `behavioural` | function | 42 | <code>def behavioural(f,publish,before,consumer,identity):</code> |
| `main` | function | 110 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/17_3.py

[Open source](../tests/hyperfide/cases/tasks/17_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `seed_inputs` | function | 25 | <code>def seed_inputs(f):</code> |
| `lock_order_probe` | function | 38 | <code>def lock_order_probe(f):</code> |
| `graph_custody_probe` | function | 75 | <code>def graph_custody_probe(f,seed):</code> |
| `main` | function | 96 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/17_4.py

[Open source](../tests/hyperfide/cases/tasks/17_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 36 | <code>def check(identity,callback):</code> |
| `emit` | function | 42 | <code>def emit():</code> |
| `check_executable` | function | 46 | <code>def check_executable():</code> |
| `check_definition` | function | 51 | <code>def check_definition(name):</code> |
| `sha` | function | 67 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `canonical` | function | 68 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()</code> |
| `setup` | function | 81 | <code>def setup(f,d):</code> |
| `seed` | function | 103 | <code>def seed(f):</code> |
| `reader_boundaries` | function | 113 | <code>def reader_boundaries(f):</code> |
| `generation_storage_boundary` | function | 128 | <code>def generation_storage_boundary(f,job):</code> |
| `descendants` | function | 220 | <code>def descendants(pid):</code> |
| `cmdline` | function | 233 | <code>def cmdline(pid):</code> |
| `RemoteExecutor` | class | 236 | <code>class RemoteExecutor:</code> |
| `__init__` | method | 238 | <code>def __init__(self,repo,uid=65534):</code> |
| `Handler` | class | 242 | <code>class Handler(socketserver.StreamRequestHandler):</code> |
| `handle` | method | 243 | <code>def handle(self):</code> |
| `git` | method | 251 | <code>def git(self,&#42;args,cwd=None):</code> |
| `materialise` | method | 253 | <code>def materialise(self,session_id,commit):</code> |
| `op_workspace` | method | 261 | <code>def op_workspace(self,session_id):return self.sessions.get(session_id)</code> |
| `op_allocation` | method | 262 | <code>def op_allocation(self,reservation_id):return self.allocations.get(reservation_id)</code> |
| `op_prepare` | method | 263 | <code>def op_prepare(self,operation_id,session_id,argv,artifact_paths,timeout_ms):</code> |
| `op_execute` | method | 266 | <code>def op_execute(self,operation_id):</code> |
| `close` | method | 302 | <code>def close(self):</code> |
| `remote_runtime` | function | 304 | <code>def remote_runtime(f,folder,executor,objects):</code> |
| `load_objects` | function | 325 | <code>def load_objects():</code> |
| `remote_executions` | function | 331 | <code>def remote_executions(f,folder,request,planned,verifier,bound):</code> |
| `main` | function | 420 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/18_1.py

[Open source](../tests/hyperfide/cases/tasks/18_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 15 | <code>def expect(value,message='Observed result differs from the recorded contract'):</code> |
| `check` | function | 17 | <code>def check(name,callback):</code> |
| `campaign` | function | 21 | <code>def campaign():return Path(os.environ.get('HYPERFIDE_CAMPAIGN_DIR','/tmp/hyperfide/domain18-standalone'))</code> |
| `record_database` | function | 22 | <code>def record_database(task,database,directory):</code> |
| `cleanup` | function | 25 | <code>def cleanup(task):</code> |
| `insert` | function | 42 | <code>def insert(f,table,data):</code> |
| `scoped` | function | 44 | <code>def scoped(f,&#42;&#42;data):return dict(organisation_id=f.ids&#91;'organisation'&#93;,run_id=f.ids&#91;'run'&#93;,&#42;&#42;data)</code> |
| `seed` | function | 45 | <code>def seed(f,task):</code> |
| `accept_spec` | function | 80 | <code>def accept_spec(f,proof_check):</code> |
| `observation` | function | 92 | <code>def observation(f,fingerprint='same-reproducer',severity='ERROR',source=OID,evidence=None):</code> |
| `call` | function | 94 | <code>def call(f,action,payload,component='finding-registry',key='operator'):</code> |
| `reject` | function | 98 | <code>def reject(f,action,payload,code=None,component='finding-registry',key='operator'):</code> |
| `finding` | function | 101 | <code>def finding(f,obs=None,condition=None,collaborators=None):</code> |
| `fixture` | function | 103 | <code>def fixture(task,extra=(),env=None,after_seed=None):</code> |
| `main` | function | 108 | <code>def main():</code> |
| `cross_feature_owner` | function | 158 | <code>def cross_feature_owner(f,finding_id):</code> |
| `cross_feature_explicit` | function | 163 | <code>def cross_feature_explicit(f,target,source,third):</code> |
| `missing_context_hierarchy` | function | 170 | <code>def missing_context_hierarchy(f):</code> |
| `assert_sql_refused` | function | 174 | <code>def assert_sql_refused(f,query):</code> |

## tests/hyperfide/cases/tasks/18_2.py

[Open source](../tests/hyperfide/cases/tasks/18_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GitHubFixture` | class | 9 | <code>class GitHubFixture:</code> |
| `__init__` | method | 10 | <code>def __init__(self):</code> |
| `Handler` | class | 12 | <code>class Handler(http.server.BaseHTTPRequestHandler):</code> |
| `log_message` | method | 13 | <code>def log_message(self,&#42;args):pass</code> |
| `reply` | method | 14 | <code>def reply(self,code,value):</code> |
| `do_GET` | method | 16 | <code>def do_GET(self):</code> |
| `do_POST` | method | 22 | <code>def do_POST(self):</code> |
| `do_PATCH` | method | 27 | <code>def do_PATCH(self):</code> |
| `close` | method | 30 | <code>def close(self):self.server.shutdown();self.server.server_close();self.thread.join(5);expect(not self.thread.is_alive(),'Loopback HTTP server did not stop')</code> |
| `main` | function | 31 | <code>def main():</code> |
| `accepted_proof_intent` | function | 96 | <code>def accepted_proof_intent(f):</code> |
| `ordered_refusal` | function | 113 | <code>def ordered_refusal(reject,op,github):</code> |
| `ack_replay` | function | 115 | <code>def ack_replay(call,op,github):</code> |
| `not_due` | function | 117 | <code>def not_due(call,payload,github):</code> |

## tests/hyperfide/cases/tasks/18_3.py

[Open source](../tests/hyperfide/cases/tasks/18_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `managers` | function | 8 | <code>def managers(f):</code> |
| `accepted_proof_intent` | function | 10 | <code>def accepted_proof_intent(f):</code> |
| `main` | function | 30 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/18_4.py

[Open source](../tests/hyperfide/cases/tasks/18_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `accepted_intent` | function | 44 | <code>def accepted_intent(f,criteria):</code> |
| `setup` | function | 70 | <code>def setup(f):</code> |
| `closed_issue_delivery` | function | 102 | <code>def closed_issue_delivery(f,fid):</code> |
| `restart` | function | 108 | <code>def restart(f,limit):</code> |
| `claim` | function | 113 | <code>def claim(f,name='a'):</code> |
| `reopen_after_change` | function | 116 | <code>def reopen_after_change(f,call,fid):</code> |
| `main` | function | 125 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/19_1.py

[Open source](../tests/hyperfide/cases/tasks/19_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 42 | <code>def expect(condition,message):</code> |
| `check` | function | 44 | <code>def check(identity,callback):</code> |
| `run` | function | 50 | <code>def run(argv,&#42;,cwd=ROOT,text="",env=None,allow_error=False):</code> |
| `db_env` | function | 54 | <code>def db_env(database=DATABASE):</code> |
| `sql` | function | 60 | <code>def sql(statement,&#42;,database=DATABASE,allow_error=False):</code> |
| `node` | function | 64 | <code>def node(source,args=None,env=None):</code> |
| `cleanup` | function | 66 | <code>def cleanup(emit=True):</code> |
| `bootstrap` | function | 81 | <code>def bootstrap():</code> |
| `Fixture` | class | 89 | <code>class Fixture:</code> |
| `__init__` | method | 90 | <code>def __init__(self,base):</code> |
| `close` | method | 144 | <code>def close(self):</code> |
| `g` | method | 152 | <code>def g(self,args,allow_error=False):</code> |
| `invoke` | method | 154 | <code>def invoke(self,component,action,value):</code> |
| `reject` | method | 162 | <code>def reject(self,component,action,value,code):</code> |
| `wire` | method | 165 | <code>def wire(self):</code> |
| `canon` | function | 170 | <code>def canon(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)</code> |
| `sha` | function | 171 | <code>def sha(value):return "sha256:"+hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()</code> |
| `q` | function | 172 | <code>def q(value):return "NULL" if value is None else "'"+str(value).replace("'","''")+"'"</code> |
| `integration_seed` | function | 173 | <code>def integration_seed(ids,run,repository,oids,gate):</code> |
| `candidate_cases` | function | 206 | <code>def candidate_cases(f):</code> |
| `integration_cases` | function | 229 | <code>def integration_cases(f):</code> |
| `adopt_orphans` | function | 352 | <code>def adopt_orphans():</code> |
| `reap_orphans` | function | 356 | <code>def reap_orphans(keep):</code> |
| `publication_cases` | function | 374 | <code>def publication_cases(f):</code> |
| `publication_checks` | function | 378 | <code>def publication_checks(f):</code> |
| `closure_uuid` | function | 464 | <code>def closure_uuid():return str(__import__("uuid").uuid4())</code> |
| `closure_digest` | function | 465 | <code>def closure_digest(label):return "sha256:"+hashlib.sha256(label.encode()).hexdigest()</code> |
| `closure_seed` | function | 466 | <code>def closure_seed(f):</code> |
| `closure_publish` | function | 481 | <code>def closure_publish(f,x):</code> |
| `closure_accept` | function | 491 | <code>def closure_accept(f,x):</code> |
| `closure_open_finding` | function | 497 | <code>def closure_open_finding(f,x):</code> |
| `closure_expire_lease` | function | 500 | <code>def closure_expire_lease(f,x):</code> |
| `closure_programme_receipt` | function | 502 | <code>def closure_programme_receipt(f,x,gate,covered,digest):</code> |
| `closure_policy_file` | function | 511 | <code>def closure_policy_file(f):</code> |
| `closure_evaluate` | function | 518 | <code>def closure_evaluate(f,&#42;&#42;scope):</code> |
| `closure_unmet` | function | 522 | <code>def closure_unmet(result):return set(result&#91;"status"&#93;&#91;"unmet_obligations"&#93;)</code> |
| `closure_release` | function | 523 | <code>def closure_release(result,key):return &#91;d for d in result&#91;"dependency_release"&#93; if d&#91;"task_key"&#93;==key&#93;</code> |
| `publication_gateway_cases` | function | 524 | <code>def publication_gateway_cases(f,module):</code> |
| `closure_cases` | function | 666 | <code>def closure_cases(f):</code> |
| `release_repositories` | function | 785 | <code>def release_repositories(f):</code> |
| `release_commit` | function | 797 | <code>def release_commit(f,rid,parent,label):</code> |
| `release_ref` | function | 800 | <code>def release_ref(f,rid):return run(&#91;"git","--git-dir="+str(f.release&#91;rid&#93;&#91;"receive"&#93;),"rev-parse","refs/heads/main"&#93;).stdout.strip()</code> |
| `q` | function | 801 | <code>def q(value):return "NULL" if value is None else "'"+str(value).replace("'","''")+"'"</code> |
| `adb` | function | 802 | <code>def adb(f,statement,allow_error=False):return sql(statement,database=f.auth.database,allow_error=allow_error)</code> |
| `precondition` | function | 803 | <code>def precondition(f,statements):</code> |
| `release_context` | function | 807 | <code>def release_context(f):</code> |
| `commit_set` | function | 813 | <code>def commit_set(&#42;entries):return sorted(&#91;{"repository_id":rid,"candidate_head":head,"expected_old_head":old} for rid,old,head in entries&#93;,key=lambda x:x&#91;"repository_id"&#93;)</code> |
| `seed_candidate` | function | 814 | <code>def seed_candidate(f,ctx,n,rid,old,head,pinned):</code> |
| `seed_operation` | function | 821 | <code>def seed_operation(f,ctx,n,candidate,state,observed=None,admitted=False):</code> |
| `gateway_record` | function | 828 | <code>def gateway_record(ctx,op,candidate,state,observed=None):</code> |
| `gateway_publish` | function | 837 | <code>def gateway_publish(f,ctx,op,candidate):</code> |
| `interrupted_publisher` | function | 841 | <code>def interrupted_publisher(f,ctx,first,first_op,second,second_op=None):</code> |
| `ok` | function | 850 | <code>def ok(f,action,value):</code> |
| `by_repo` | function | 853 | <code>def by_repo(result):return {o&#91;"repository_id"&#93;:o for o in result&#91;"outcomes"&#93;}</code> |
| `release_cases` | function | 854 | <code>def release_cases(f):</code> |
| `main` | function | 968 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/1_1.py

[Open source](../tests/hyperfide/cases/tasks/1_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 5 | <code>def check(name,fn):</code> |
| `expect` | function | 9 | <code>def expect(ok,message='unexpected service outcome'):</code> |
| `digest` | function | 11 | <code>def digest(text):return 'sha256:'+hashlib.sha256(text.encode()).hexdigest()</code> |
| `profile_for` | function | 21 | <code>def profile_for(f):</code> |
| `binding` | function | 23 | <code>def binding(host='main',boot='1'):</code> |
| `closed` | function | 25 | <code>def closed(f,path,database):</code> |
| `static_checks` | function | 31 | <code>def static_checks():</code> |
| `authenticated_checks` | function | 91 | <code>def authenticated_checks():</code> |
| `supervisor_checks` | function | 268 | <code>def supervisor_checks():</code> |

## tests/hyperfide/cases/tasks/1_2.py

[Open source](../tests/hyperfide/cases/tasks/1_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 7 | <code>def expect(ok,message='unexpected human routing outcome'):</code> |
| `check` | function | 9 | <code>def check(name,fn):</code> |
| `Unavailable` | class | 15 | <code>class Unavailable:</code> |
| `__init__` | method | 17 | <code>def __init__(self,name,error):self.name=name;self.error=error</code> |
| `fail` | method | 18 | <code>def fail(self,&#42;_):raise AssertionError('prerequisite '+self.name+' failed: '+self.error)</code> |
| `step` | function | 20 | <code>def step(name,fn):</code> |
| `setup` | function | 25 | <code>def setup(f):</code> |

## tests/hyperfide/cases/tasks/1_3.py

[Open source](../tests/hyperfide/cases/tasks/1_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 7 | <code>def check(name,fn):</code> |
| `expect` | function | 11 | <code>def expect(ok,message='unexpected service outcome'):</code> |
| `sha` | function | 13 | <code>def sha(text):return 'sha256:'+hashlib.sha256(text.encode()).hexdigest()</code> |
| `profile` | function | 14 | <code>def profile(connector,alias):</code> |
| `setup` | function | 34 | <code>def setup(f):</code> |

## tests/hyperfide/cases/tasks/1_4.py

[Open source](../tests/hyperfide/cases/tasks/1_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `run` | function | 56 | <code>def run(argv, &#42;, cwd=ROOT, text="", timeout=40):</code> |
| `expect` | function | 62 | <code>def expect(condition, detail):</code> |
| `check` | function | 67 | <code>def check(identity, callback):</code> |
| `response` | function | 77 | <code>def response(result):</code> |
| `error_code` | function | 83 | <code>def error_code(result):</code> |
| `ServiceFixture` | class | 106 | <code>class ServiceFixture:</code> |
| `__init__` | method | 107 | <code>def __init__(self, directory):</code> |
| `module` | method | 119 | <code>def module(self, name, content):</code> |
| `fixture` | method | 122 | <code>def fixture(self, ident="fixture", &#42;, roles=None, requires=None, action="fixture.echo",</code> |
| `fragment` | method | 144 | <code>def fragment(self, name, value):</code> |
| `event_rows` | method | 147 | <code>def event_rows(self):</code> |
| `invoke` | method | 150 | <code>def invoke(self, &#42;, role="control", request=None, raw=None, revision="fixture-revision", policy=True):</code> |
| `service_case` | function | 162 | <code>def service_case(base, callback):</code> |
| `policy_reject` | function | 167 | <code>def policy_reject(base, mutation, code, &#42;, missing=False):</code> |
| `registry_reject` | function | 176 | <code>def registry_reject(base, mutation, &#42;, before_import=True):</code> |
| `mutate_fragment` | function | 187 | <code>def mutate_fragment(fixture, mutation):</code> |
| `native_fixture` | function | 194 | <code>def native_fixture(base):</code> |
| `native_exec` | function | 213 | <code>def native_exec(directory, component="99.1", action="fixture.echo", text="{}&#92;n"):</code> |
| `authoring_fixture` | function | 217 | <code>def authoring_fixture(base):</code> |
| `authoring_command` | function | 229 | <code>def authoring_command(pack, tool, &#42;args):</code> |
| `main` | function | 234 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/20_1.py

[Open source](../tests/hyperfide/cases/tasks/20_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 29 | <code>def expect(condition,message):</code> |
| `request` | function | 32 | <code>def request():</code> |
| `Fixture` | class | 35 | <code>class Fixture:</code> |
| `__init__` | method | 36 | <code>def __init__(self,base,component="20.1",actions=None):</code> |
| `invoke` | method | 47 | <code>def invoke(self,action,input=None,env=None,timeout=10):</code> |
| `HTTPFixture` | class | 60 | <code>class HTTPFixture:</code> |
| `__init__` | method | 61 | <code>def __init__(self,mode="valid"):</code> |
| `Handler` | class | 64 | <code>class Handler(BaseHTTPRequestHandler):</code> |
| `log_message` | method | 65 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 66 | <code>def do_POST(self):</code> |
| `env` | method | 94 | <code>def env(self,route="span-native",model="span-02"):</code> |
| `close` | method | 99 | <code>def close(self):</code> |
| `run_checks` | function | 102 | <code>def run_checks(fixture,emit=True):</code> |
| `main` | function | 203 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/20_2.py

[Open source](../tests/hyperfide/cases/tasks/20_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `request` | function | 23 | <code>def request(kind="noul"):</code> |
| `response` | function | 28 | <code>def response(kind="noul"):</code> |
| `identity` | function | 33 | <code>def identity():</code> |
| `main` | function | 37 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/20_3.py

[Open source](../tests/hyperfide/cases/tasks/20_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `png` | function | 20 | <code>def png(width=280,height=280):</code> |
| `profile` | function | 24 | <code>def profile(route="span-native"):</code> |
| `main` | function | 30 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/20_4.py

[Open source](../tests/hyperfide/cases/tasks/20_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 20 | <code>def expect(v,msg):</code> |
| `uid` | function | 22 | <code>def uid():return str(uuid.uuid4())</code> |
| `canonical` | function | 23 | <code>def canonical(v):return json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()</code> |
| `Provider` | class | 24 | <code>class Provider:</code> |
| `__init__` | method | 25 | <code>def __init__(self,mode="valid",delay=0):</code> |
| `Handler` | class | 27 | <code>class Handler(http.server.BaseHTTPRequestHandler):</code> |
| `log_message` | method | 28 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 29 | <code>def do_POST(self):</code> |
| `config` | method | 43 | <code>def config(self,model):</code> |
| `close` | method | 46 | <code>def close(self):</code> |
| `capprofile` | function | 49 | <code>def capprofile():</code> |
| `Fixture` | class | 75 | <code>class Fixture(identity.IdentityFixture):</code> |
| `__init__` | method | 76 | <code>def __init__(self,provider=None,second=None,settings=None,signer=False):</code> |
| `start` | method | 114 | <code>def start(self):</code> |
| `stop` | method | 128 | <code>def stop(self):</code> |
| `close` | method | 133 | <code>def close(self):</code> |
| `call` | method | 137 | <code>def call(self,action,input,component="20.4",&#42;&#42;kwargs):</code> |
| `reject` | method | 141 | <code>def reject(self,action,input,code=None,component="20.4"):</code> |
| `packet` | method | 145 | <code>def packet(self):</code> |
| `submission` | method | 152 | <code>def submission(self,packet=None,&#42;&#42;kwargs):return {"purpose":"fixture-review","input":{"packet_id":(packet or self.packet())&#91;"id"&#93;},"route_ids":&#91;"span-native"&#93;,"deadline_ms":2000,"mode":"online",&#42;&#42;kwar…</code> |
| `submit` | method | 153 | <code>def submit(self,&#42;&#42;kwargs):return self.call("decision.jobs.submit",self.submission(&#42;&#42;kwargs))&#91;"decision_id"&#93;</code> |
| `process` | method | 154 | <code>def process(self,id):return self.call("decision.jobs.process",{"decision_id":id})</code> |
| `status` | method | 155 | <code>def status(self,id):return self.call("decision.jobs.status",{"decision_id":id})</code> |
| `advance` | method | 156 | <code>def advance(self):self.sql("UPDATE hyperfide.runs SET state_version=state_version+1 WHERE organisation_id=$1 AND id=$2",&#91;self.ids&#91;"organisation"&#93;,self.ids&#91;"run"&#93;&#93;)</code> |
| `core_loop_setup` | function | 157 | <code>def core_loop_setup(f):</code> |
| `core_cycle` | function | 165 | <code>def core_cycle(f,core,version,budget=1.5):</code> |
| `core_state` | function | 184 | <code>def core_state(f,core):</code> |
| `deterministic` | function | 189 | <code>def deterministic(v,providers):</code> |
| `main` | function | 194 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/21_1.py

[Open source](../tests/hyperfide/cases/tasks/21_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fragments` | function | 18 | <code>def fragments():</code> |
| `spec_closure` | function | 25 | <code>def spec_closure():</code> |
| `linkage_probe` | function | 35 | <code>def linkage_probe():</code> |
| `function_probe` | function | 64 | <code>def function_probe(env):</code> |
| `include_spec_closure` | function | 73 | <code>def include_spec_closure():</code> |
| `child_probe` | function | 86 | <code>def child_probe(kind,env):</code> |
| `psql` | function | 98 | <code>def psql(env,query):</code> |
| `owned` | function | 103 | <code>def owned(env):</code> |
| `main` | function | 107 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/21_2.py

[Open source](../tests/hyperfide/cases/tasks/21_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `native_elf` | function | 8 | <code>def native_elf(executable):</code> |
| `native_admission_probe` | function | 18 | <code>def native_admission_probe():</code> |
| `ExtendedFixture` | class | 46 | <code>class ExtendedFixture(original):</code> |
| `__init__` | method | 47 | <code>def __init__(self,&#42;args,&#42;&#42;kwargs):</code> |
| `sql` | method | 67 | <code>def sql(self,query,values=None,&#42;&#42;kwargs):</code> |
| `emit` | function | 121 | <code>def emit(name,ok,detail):</code> |
| `repeat_receipt_probe` | function | 124 | <code>def repeat_receipt_probe():</code> |
| `triage_probe` | function | 135 | <code>def triage_probe():</code> |
| `main` | function | 153 | <code>def main():</code> |
| `cleanup` | function | 170 | <code>def cleanup():</code> |

## tests/hyperfide/cases/tasks/21_3.py

[Open source](../tests/hyperfide/cases/tasks/21_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `emit` | function | 14 | <code>def emit(identity,good,message):</code> |
| `check` | function | 17 | <code>def check(identity,fn):</code> |
| `admin` | function | 22 | <code>def admin(sql,values=()):</code> |
| `owned_identities` | function | 28 | <code>def owned_identities():</code> |
| `component_probe` | function | 32 | <code>def component_probe():</code> |
| `signed_probe` | function | 52 | <code>def signed_probe():</code> |
| `FakeAuthority` | class | 65 | <code>class FakeAuthority:</code> |
| `__init__` | method | 68 | <code>def __init__(self,folder,run,credential):</code> |
| `Handler` | class | 73 | <code>class Handler(http.server.BaseHTTPRequestHandler):</code> |
| `log_message` | method | 74 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 75 | <code>def do_POST(self):</code> |
| `close` | method | 100 | <code>def close(self):self.server.shutdown();self.server.server_close()</code> |
| `native_probe` | function | 102 | <code>def native_probe():</code> |
| `main` | function | 187 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/21_4.py

[Open source](../tests/hyperfide/cases/tasks/21_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `storage_helper` | function | 8 | <code>def storage_helper():</code> |
| `probe_inventory_file` | function | 14 | <code>def probe_inventory_file():</code> |
| `track_probe_fixtures` | function | 16 | <code>def track_probe_fixtures(identity_module):</code> |
| `cleanup_probe_fixtures` | function | 25 | <code>def cleanup_probe_fixtures(helper):</code> |
| `cleanup_task` | function | 41 | <code>def cleanup_task():</code> |
| `environment` | function | 54 | <code>def environment():</code> |
| `service_probe` | function | 65 | <code>def service_probe(task,env,directory):</code> |
| `run_task` | function | 99 | <code>def run_task(task):</code> |
| `ensure_semantic_fence_schema` | function | 137 | <code>def ensure_semantic_fence_schema(f,service=None):</code> |
| `apply_advisory_fixture_migration` | function | 150 | <code>def apply_advisory_fixture_migration(f,name,service=None):</code> |
| `seed_advisory_amendment_source` | function | 165 | <code>def seed_advisory_amendment_source(f,service):</code> |
| `signed_authority_probe` | function | 198 | <code>def signed_authority_probe(include_findings=False,include_amendment=False,include_legacy=False):</code> |
| `durable_job_probe` | function | 365 | <code>def durable_job_probe():</code> |
| `AdvisoryFixture` | class | 377 | <code>class AdvisoryFixture(jobs.Fixture):</code> |
| `start` | method | 378 | <code>def start(self):</code> |

## tests/hyperfide/cases/tasks/22_1.py

[Open source](../tests/hyperfide/cases/tasks/22_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonical` | function | 10 | <code>def canonical(value):</code> |
| `digest` | function | 12 | <code>def digest(value):</code> |
| `utc` | function | 14 | <code>def utc(value):</code> |
| `require` | function | 16 | <code>def require(value,message):</code> |
| `check` | function | 18 | <code>def check(identity,callback):</code> |
| `Fixture` | class | 57 | <code>class Fixture:</code> |
| `__init__` | method | 58 | <code>def __init__(self,base):</code> |
| `close` | method | 78 | <code>def close(self):</code> |
| `sign` | method | 83 | <code>def sign(self,kind,payload,key="packet",observed=None):</code> |
| `resign` | method | 87 | <code>def resign(self,envelope,key=None):</code> |
| `make_case` | method | 90 | <code>def make_case(self,i,target="yes"):</code> |
| `changed_case` | method | 103 | <code>def changed_case(self,pair,callback):</code> |
| `ask` | method | 110 | <code>def ask(self,action,value,ok=True):</code> |
| `dataset` | method | 122 | <code>def dataset(self,cases=None,name="fixture-dataset",ok=True):</code> |
| `profile` | method | 124 | <code>def profile(self,identity,model=None):</code> |
| `predictions` | method | 126 | <code>def predictions(self,cases,profiles,wrong_baseline=False,abstain_last=False):</code> |
| `main` | function | 140 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/22_2.py

[Open source](../tests/hyperfide/cases/tasks/22_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `profiles` | function | 8 | <code>def profiles(f):</code> |
| `build_scorecard` | function | 12 | <code>def build_scorecard(f):</code> |
| `main` | function | 23 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/22_3.py

[Open source](../tests/hyperfide/cases/tasks/22_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `build_trial` | function | 10 | <code>def build_trial(f,mode="controlled"):</code> |
| `main` | function | 35 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/22_4.py

[Open source](../tests/hyperfide/cases/tasks/22_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 9 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/23_1.py

[Open source](../tests/hyperfide/cases/tasks/23_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 16 | <code>def uid(n): return f"23000000-0000-4000-8000-{n:012d}"</code> |
| `set_task` | function | 19 | <code>def set_task(task):</code> |
| `database` | function | 23 | <code>def database(): return "hf_task_"+TASK.replace(".","_")+"_qualification"</code> |
| `output` | function | 24 | <code>def output():</code> |
| `db_env` | function | 27 | <code>def db_env(name=None):</code> |
| `sql` | function | 32 | <code>def sql(query,name=None,allow_error=False):</code> |
| `expect` | function | 36 | <code>def expect(value,message="observed result differs"):</code> |
| `check` | function | 38 | <code>def check(identity,fn):</code> |
| `cleanup` | function | 43 | <code>def cleanup():</code> |
| `seed` | function | 53 | <code>def seed():</code> |
| `Fixture` | class | 74 | <code>class Fixture:</code> |
| `__init__` | method | 75 | <code>def __init__(self,task,components,extra_env=None):</code> |
| `__enter__` | method | 77 | <code>def __enter__(self):</code> |
| `_enter` | method | 82 | <code>def _enter(self):</code> |
| `request` | method | 118 | <code>def request(self,component,action,value=None,role="OPERATOR",run=RUN,unsigned=False):</code> |
| `ok` | method | 135 | <code>def ok(self,component,action,value=None,&#42;&#42;kw):</code> |
| `reject` | method | 137 | <code>def reject(self,component,action,value,code=None,&#42;&#42;kw):</code> |
| `__exit__` | method | 141 | <code>def __exit__(self,typ,value,tb):</code> |
| `finish` | function | 152 | <code>def finish():</code> |
| `views_cases` | function | 155 | <code>def views_cases(f):</code> |
| `main` | function | 224 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/23_2.py

[Open source](../tests/hyperfide/cases/tasks/23_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `budget_cases` | function | 9 | <code>def budget_cases(f):</code> |
| `accounting_cases` | function | 54 | <code>def accounting_cases(f,profiles,sample):</code> |
| `main` | function | 118 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/23_3.py

[Open source](../tests/hyperfide/cases/tasks/23_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `stamp` | function | 8 | <code>def stamp(offset=0.0):return time.strftime("%Y-%m-%dT%H:%M:%S",time.gmtime(time.time()+offset))+".000Z"</code> |
| `Holder` | class | 9 | <code>class Holder:</code> |
| `__init__` | method | 11 | <code>def __init__(self):</code> |
| `run` | method | 13 | <code>def run(self,statement,timeout=20):</code> |
| `close` | method | 23 | <code>def close(self):</code> |
| `concurrently` | function | 26 | <code>def concurrently(fns):</code> |
| `join` | function | 34 | <code>def join(threads):</code> |
| `main` | function | 36 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/23_4.py

[Open source](../tests/hyperfide/cases/tasks/23_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `digest` | function | 17 | <code>def digest(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `ObjectFixture` | class | 18 | <code>class ObjectFixture:</code> |
| `__init__` | method | 20 | <code>def __init__(self):</code> |
| `Sink` | class | 30 | <code>class Sink(BaseHTTPRequestHandler):</code> |
| `log_message` | method | 31 | <code>def log_message(self, &#42;args): pass</code> |
| `do_GET` | method | 32 | <code>def do_GET(self):</code> |
| `Handler` | class | 40 | <code>class Handler(BaseHTTPRequestHandler):</code> |
| `log_message` | method | 42 | <code>def log_message(self, &#42;args): pass</code> |
| `reply` | method | 43 | <code>def reply(self, status, data=b"", &#42;, length=None, headers=None):</code> |
| `do_GET` | method | 53 | <code>def do_GET(self): self.perform()</code> |
| `do_PUT` | method | 54 | <code>def do_PUT(self): self.perform()</code> |
| `perform` | method | 55 | <code>def perform(self):</code> |
| `signature` | method | 112 | <code>def signature(method, path, headers, body):</code> |
| `key` | method | 140 | <code>def key(self, data, run=None):</code> |
| `set_mode` | method | 144 | <code>def set_mode(self, data, mode, run=None):</code> |
| `stop` | method | 148 | <code>def stop(self):</code> |
| `main` | function | 157 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/24_1.py

[Open source](../tests/hyperfide/cases/tasks/24_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 16 | <code>def uid(n):return "00000000-0000-4000-8000-"+format(n,"012x")</code> |
| `expect` | function | 25 | <code>def expect(condition,message="unexpected result"):</code> |
| `check` | function | 27 | <code>def check(identity,fn):</code> |
| `env_for` | function | 32 | <code>def env_for(db):</code> |
| `sql` | function | 38 | <code>def sql(text,db=None):</code> |
| `seed` | function | 43 | <code>def seed():</code> |
| `component_dependencies` | function | 69 | <code>def component_dependencies(names):</code> |
| `Fixture` | class | 83 | <code>class Fixture:</code> |
| `__init__` | method | 84 | <code>def __init__(self,task):</code> |
| `request` | method | 106 | <code>def request(self,action,payload,component=None):</code> |
| `ok` | method | 111 | <code>def ok(self,action,payload,component=None):</code> |
| `rejected` | method | 113 | <code>def rejected(self,action,payload,code,component=None):</code> |
| `close` | method | 115 | <code>def close(self):self.identity.close()</code> |
| `setup` | function | 116 | <code>def setup(task):return Fixture(task)</code> |
| `observation_dir` | function | 117 | <code>def observation_dir():</code> |
| `cleanup` | function | 121 | <code>def cleanup(emit=True):</code> |
| `tests` | function | 165 | <code>def tests(f):</code> |
| `count_attempts` | function | 211 | <code>def count_attempts():return sql("SELECT count(&#42;) FROM hyperfide.attempts WHERE organisation_id='"+ORG+"' AND run_id='"+RUN+"';")</code> |
| `session` | function | 212 | <code>def session(snapshot,identity):</code> |
| `control_loss` | function | 214 | <code>def control_loss(f,initial,base):</code> |
| `session_liveness` | function | 242 | <code>def session_liveness(f):</code> |
| `run` | function | 278 | <code>def run(task,callback):</code> |

## tests/hyperfide/cases/tasks/24_2.py

[Open source](../tests/hyperfide/cases/tasks/24_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tests` | function | 6 | <code>def tests(f):</code> |
| `stamp` | function | 40 | <code>def stamp(delta=0):return (datetime.now(timezone.utc)+timedelta(seconds=delta)).isoformat(timespec="milliseconds").replace("+00:00","Z")</code> |
| `target_sandbox` | function | 41 | <code>def target_sandbox(sandbox,slot):</code> |
| `checkpoint` | function | 43 | <code>def checkpoint(base,attempt,generation,sandbox,slot,session,support):</code> |
| `rejected_code` | function | 52 | <code>def rejected_code(f,action,payload):</code> |
| `restoration_flow` | function | 54 | <code>def restoration_flow(f):</code> |

## tests/hyperfide/cases/tasks/24_3.py

[Open source](../tests/hyperfide/cases/tasks/24_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fencing_tests` | function | 7 | <code>def fencing_tests():</code> |
| `u` | function | 20 | <code>def u(n):return m.uid(0x100+n)</code> |
| `q` | function | 21 | <code>def q(text):return m.sql(text)</code> |
| `restart` | function | 22 | <code>def restart(f):</code> |
| `fencing_record` | function | 24 | <code>def fencing_record():return m.observation_dir()/"fencing-fixture.json"</code> |
| `identity_module` | function | 25 | <code>def identity_module():</code> |
| `fencing_configuration` | function | 28 | <code>def fencing_configuration(root):</code> |
| `listening` | function | 40 | <code>def listening(port):</code> |
| `managed_fencing_tests` | function | 44 | <code>def managed_fencing_tests():</code> |
| `inflight` | function | 80 | <code>def inflight(task,attempt,sandbox,slot,lease,key,session=None,execution="RUNNING",sandbox_state="RUNNING"):</code> |
| `control` | function | 91 | <code>def control(kind,scope_id):return q(f"SELECT mode&#124;&#124;':'&#124;&#124;status&#124;&#124;':'&#124;&#124;generation FROM hyperfide.recovery_controls WHERE scope_kind='{kind}' AND scope_id='{scope_id}';")</code> |
| `gate` | function | 92 | <code>def gate(kind,scope_id):return q(f"SELECT mode FROM hyperfide.execution_controls WHERE scope_kind='{kind}' AND scope_id='{scope_id}';")</code> |
| `attempt_state` | function | 93 | <code>def attempt_state(attempt):return q(f"SELECT compute_authority&#124;&#124;':'&#124;&#124;execution_state FROM hyperfide.attempts WHERE id='{attempt}';")</code> |
| `lease_state` | function | 94 | <code>def lease_state(lease):return q(f"SELECT state FROM hyperfide.compute_leases WHERE id='{lease}';")</code> |
| `run_state` | function | 95 | <code>def run_state():return q(f"SELECT state FROM hyperfide.runs WHERE id='{m.RUN}';")</code> |
| `open_debts` | function | 96 | <code>def open_debts(op):return sorted(q(f"SELECT id FROM hyperfide.recovery_resource_debts WHERE operation_id='{op}' AND status&lt;&gt;'RESOLVED';").split())</code> |
| `debt_resources` | function | 97 | <code>def debt_resources(op,kind):return sorted(q(f"SELECT resource_id FROM hyperfide.recovery_resource_debts WHERE operation_id='{op}' AND resource_kind='{kind}';").split())</code> |
| `record_inventory` | function | 98 | <code>def record_inventory(name,value):</code> |
| `pause_tests` | function | 101 | <code>def pause_tests(f):</code> |
| `drain_tests` | function | 120 | <code>def drain_tests(f):</code> |
| `stop_tests` | function | 142 | <code>def stop_tests(f):</code> |
| `historical_tests` | function | 185 | <code>def historical_tests(f,request):</code> |
| `cancel_tests` | function | 203 | <code>def cancel_tests(f,request):</code> |
| `tests` | function | 220 | <code>def tests(f):</code> |
| `drop_fencing_database` | function | 227 | <code>def drop_fencing_database():</code> |
| `cleanup` | function | 237 | <code>def cleanup(emit):</code> |
| `main` | function | 250 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/24_4.py

[Open source](../tests/hyperfide/cases/tasks/24_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `profile_setup` | function | 14 | <code>def profile_setup():</code> |
| `execute` | function | 25 | <code>def execute(f,op):return f.ok("recovery.drill.execute",{"scope":m.SCOPE,"operation_id":op})</code> |
| `wait` | function | 26 | <code>def wait(f,op,deadline=240):</code> |
| `retained` | function | 32 | <code>def retained(op,expected):</code> |
| `tests` | function | 35 | <code>def tests(f):</code> |
| `main` | function | 133 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/25_1.py

[Open source](../tests/hyperfide/cases/tasks/25_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 10 | <code>def expect(v,m):</code> |
| `check` | function | 12 | <code>def check(name,fn):</code> |
| `env` | function | 17 | <code>def env():</code> |
| `sql` | function | 19 | <code>def sql(s,database=DB):</code> |
| `artifacts` | function | 23 | <code>def artifacts():</code> |
| `cleanup` | function | 25 | <code>def cleanup():</code> |
| `history_commit_proxy` | function | 30 | <code>def history_commit_proxy(directory):</code> |
| `HistoryCommitProxy` | class | 34 | <code>class HistoryCommitProxy(module.CommitAckProxy):</code> |
| `forward` | method | 37 | <code>def forward(self,source,target,state,frontend):</code> |
| `main` | function | 77 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/25_2.py

[Open source](../tests/hyperfide/cases/tasks/25_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 7 | <code>def check(name,fn):</code> |
| `expect` | function | 12 | <code>def expect(v,message):</code> |
| `main` | function | 16 | <code>def main():</code> |
| `isolated_positive` | function | 117 | <code>def isolated_positive():</code> |
| `campaign_dir` | function | 173 | <code>def campaign_dir():</code> |
| `service_probe` | function | 175 | <code>def service_probe():</code> |
| `service_child` | function | 195 | <code>def service_child():</code> |
| `cleanup_probe` | function | 438 | <code>def cleanup_probe():</code> |

## tests/hyperfide/cases/tasks/25_3.py

[Open source](../tests/hyperfide/cases/tasks/25_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `artifacts` | function | 6 | <code>def artifacts():</code> |
| `cleanup` | function | 8 | <code>def cleanup():</code> |
| `close_fixture` | function | 12 | <code>def close_fixture(f,resource):</code> |
| `expect` | function | 20 | <code>def expect(v,m):</code> |
| `check` | function | 22 | <code>def check(name,fn):</code> |
| `main` | function | 27 | <code>def main():</code> |
| `workflow_checks` | function | 80 | <code>def workflow_checks():</code> |
| `protected_reader_checks` | function | 94 | <code>def protected_reader_checks():</code> |
| `network_checks` | function | 168 | <code>def network_checks():</code> |
| `Proxy` | class | 231 | <code>class Proxy(http.server.BaseHTTPRequestHandler):</code> |
| `log_message` | method | 232 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 233 | <code>def do_POST(self):</code> |
| `mapping_checks` | function | 276 | <code>def mapping_checks():</code> |
| `business_unknown_checks` | function | 388 | <code>def business_unknown_checks():</code> |

## tests/hyperfide/cases/tasks/25_3_workflow.py

[Open source](../tests/hyperfide/cases/tasks/25_3_workflow.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 9 | <code>def expect(value,message='Unexpected actual workflow behavior'):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `main` | function | 15 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/25_4.py

[Open source](../tests/hyperfide/cases/tasks/25_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 6 | <code>def expect(v,m):</code> |
| `check` | function | 8 | <code>def check(name,fn):</code> |
| `artifacts` | function | 13 | <code>def artifacts():</code> |
| `cleanup` | function | 15 | <code>def cleanup():</code> |
| `main` | function | 19 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_1.py

[Open source](../tests/hyperfide/cases/tasks/26_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 8 | <code>def check(identity, fn):</code> |
| `invoke` | function | 16 | <code>def invoke(action,payload=None):</code> |
| `result` | function | 20 | <code>def result(action):</code> |
| `main` | function | 23 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_2.py

[Open source](../tests/hyperfide/cases/tasks/26_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 7 | <code>def expect(value):</code> |
| `check` | function | 9 | <code>def check(name,fn):</code> |
| `run` | function | 13 | <code>def run(&#42;args,&#42;&#42;kw):</code> |
| `main` | function | 22 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_3.py

[Open source](../tests/hyperfide/cases/tasks/26_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 8 | <code>def expect(v):</code> |
| `check` | function | 10 | <code>def check(name,fn):</code> |
| `Fixture` | class | 15 | <code>class Fixture:</code> |
| `__init__` | method | 16 | <code>def __init__(self,p):</code> |
| `call` | method | 24 | <code>def call(self,a,v,env=None):</code> |
| `ok` | method | 28 | <code>def ok(self,a,v,env=None):</code> |
| `reject` | method | 30 | <code>def reject(self,a,v,code,env=None):</code> |
| `plan` | method | 32 | <code>def plan(self):return self.ok("plan",{"workspace":"repo","migration_id":self.id})</code> |
| `apply` | method | 33 | <code>def apply(self,m):return self.ok("apply",{"workspace":"repo","manifest":m})</code> |
| `rollback` | method | 34 | <code>def rollback(self,m):return self.ok("rollback",{"workspace":"repo","manifest":m})</code> |
| `native` | function | 35 | <code>def native(f,&#42;args):</code> |
| `main` | function | 37 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_4.py

[Open source](../tests/hyperfide/cases/tasks/26_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 11 | <code>def expect(v):</code> |
| `check` | function | 13 | <code>def check(name,fn):</code> |
| `Fixture` | class | 18 | <code>class Fixture:</code> |
| `__init__` | method | 19 | <code>def __init__(self,base):</code> |
| `native` | method | 31 | <code>def native(self,&#42;args,binary="hyperfide"):</code> |
| `call` | method | 33 | <code>def call(self,action,value,env=None):</code> |
| `ok` | method | 37 | <code>def ok(self,action,value):</code> |
| `reject` | method | 39 | <code>def reject(self,action,value,code,env=None):</code> |
| `main` | function | 41 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_4_bootstrap.py

[Open source](../tests/hyperfide/cases/tasks/26_4_bootstrap.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 9 | <code>def expect(value,message="Actual bootstrap contract differs"):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `main` | function | 15 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_4_launchers.py

[Open source](../tests/hyperfide/cases/tasks/26_4_launchers.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 8 | <code>def uid():return str(uuid.uuid4())</code> |
| `expect` | function | 9 | <code>def expect(value,message='Actual launcher contract differs'):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `last_json` | function | 15 | <code>def last_json(text):</code> |
| `digest` | function | 17 | <code>def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()</code> |
| `tree` | function | 18 | <code>def tree(path):return {str(p.relative_to(path)):digest(p) for p in sorted(path.rglob('&#42;')) if p.is_file()}</code> |
| `Release` | class | 19 | <code>class Release:</code> |
| `__init__` | method | 21 | <code>def __init__(self,base):</code> |
| `run` | method | 28 | <code>def run(self,args,env,binary='hyperfide',timeout=60,cwd=None):</code> |
| `HostFixture` | class | 31 | <code>class HostFixture:</code> |
| `__init__` | method | 33 | <code>def __init__(self,base):</code> |
| `write` | method | 47 | <code>def write(self,path,body,mode=0o600):path.write_text(json.dumps(body));path.chmod(mode);return path</code> |
| `launchers` | function | 48 | <code>def launchers(base,env):</code> |
| `offline` | function | 95 | <code>def offline(base,env):</code> |
| `main` | function | 125 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_4_recovery.py

[Open source](../tests/hyperfide/cases/tasks/26_4_recovery.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 9 | <code>def expect(value,message='Actual bootstrap recovery contract differs'):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `main` | function | 15 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_4_watcher.py

[Open source](../tests/hyperfide/cases/tasks/26_4_watcher.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 11 | <code>def uid():return str(uuid.uuid4())</code> |
| `expect` | function | 12 | <code>def expect(value,message='Actual watcher contract differs'):</code> |
| `check` | function | 14 | <code>def check(name,fn):</code> |
| `Control` | class | 20 | <code>class Control:</code> |
| `__init__` | method | 22 | <code>def __init__(self,base):</code> |
| `Handler` | class | 27 | <code>class Handler(BaseHTTPRequestHandler):</code> |
| `log_message` | method | 28 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 29 | <code>def do_POST(self):</code> |
| `actions` | method | 40 | <code>def actions(self):return &#91;r&#91;'payload'&#93;&#91;'action'&#93; for r in self.requests&#93;</code> |
| `close` | method | 41 | <code>def close(self):self.server.shutdown();self.server.server_close();self.thread.join(5)</code> |
| `main` | function | 42 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/27_2.py

[Open source](../tests/hyperfide/cases/tasks/27_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 22 | <code>def check(identity, function):</code> |
| `reject` | function | 34 | <code>def reject(function, kind=d.CampaignError):</code> |
| `pin` | function | 41 | <code>def pin(path):</code> |
| `trace` | function | 46 | <code>def trace():</code> |
| `model` | function | 66 | <code>def model(events, sandboxes=100, slots=200):</code> |
| `small` | function | 72 | <code>def small(kind, accepted=True, sequence=1, &#42;&#42;fields):</code> |
| `activation` | function | 75 | <code>def activation(sequence=1):</code> |
| `mixed_load_checks` | function | 83 | <code>def mixed_load_checks():</code> |
| `parity_checks` | function | 119 | <code>def parity_checks():</code> |
| `run` | function | 171 | <code>def run():</code> |

## tests/hyperfide/cases/tasks/27_3.py

[Open source](../tests/hyperfide/cases/tasks/27_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 16 | <code>def check(identity, action):</code> |
| `reject` | function | 24 | <code>def reject(action):</code> |
| `manifest` | function | 29 | <code>def manifest():</code> |
| `snapshot` | function | 32 | <code>def snapshot():</code> |
| `run` | function | 35 | <code>def run():</code> |

## tests/hyperfide/cases/tasks/27_4.py

[Open source](../tests/hyperfide/cases/tasks/27_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 24 | <code>def check(identity,action):</code> |
| `reject` | function | 32 | <code>def reject(action,message=None):</code> |
| `pin` | function | 39 | <code>def pin(path):</code> |
| `run` | function | 42 | <code>def run():</code> |

## tests/hyperfide/cases/tasks/28_1.py

[Open source](../tests/hyperfide/cases/tasks/28_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 7 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/28_2.py

[Open source](../tests/hyperfide/cases/tasks/28_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `configure_task` | function | 12 | <code>def configure_task(task):</code> |
| `fixture_artifact` | function | 15 | <code>def fixture_artifact(name):</code> |
| `fixture_ledger` | function | 18 | <code>def fixture_ledger():</code> |
| `ledger_record` | function | 21 | <code>def ledger_record(name,&#42;&#42;updates):</code> |
| `TrackedIdentityFixture` | class | 26 | <code>class TrackedIdentityFixture(IdentityFixture):</code> |
| `sql` | method | 27 | <code>def sql(self,sql,values=None,admin=False):</code> |
| `start` | method | 31 | <code>def start(self):</code> |
| `close` | method | 34 | <code>def close(self):</code> |
| `cleanup_event` | function | 46 | <code>def cleanup_event(task,extra_resources=None):</code> |
| `cleanup_only` | function | 56 | <code>def cleanup_only(task):</code> |
| `canonical` | function | 84 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()</code> |
| `digest` | function | 85 | <code>def digest(value):return"sha256:"+hashlib.sha256(canonical(value)).hexdigest()</code> |
| `require` | function | 86 | <code>def require(value,message):</code> |
| `check` | function | 88 | <code>def check(name,callback):</code> |
| `component_files` | function | 92 | <code>def component_files(&#42;ids):</code> |
| `setup` | function | 107 | <code>def setup(f):</code> |
| `drop_documentation_schema` | function | 110 | <code>def drop_documentation_schema(f):</code> |
| `fixture` | function | 113 | <code>def fixture(extra=("28.2",),migrate=True):return IdentityFixture(extra_components=component_files(&#42;extra),extra_setup=setup if migrate else drop_documentation_schema)</code> |
| `call` | function | 114 | <code>def call(f,action,payload,component="28.2",ok=True,&#42;&#42;kwargs):</code> |
| `pins` | function | 118 | <code>def pins(f):return{"spec_revision_id":f.ids&#91;"spec"&#93;,"spec_generation":"1","programme_manifest_digest":digest("fixture-programme"),"source_manifest_digest":digest(&#91;&#93;)}</code> |
| `node` | function | 119 | <code>def node(script,value=None,env=None):</code> |
| `positive_fixture_setup` | function | 122 | <code>def positive_fixture_setup(f):</code> |
| `seed_checker` | function | 159 | <code>def seed_checker(f,packet_id,failed=False,cleanup='CONFIRMED'):</code> |
| `publish_relevant_change` | function | 169 | <code>def publish_relevant_change(f):</code> |
| `counts` | function | 183 | <code>def counts(f):</code> |
| `closures` | function | 186 | <code>def closures(f):return f.sql("SELECT count(&#42;)::int AS n FROM hyperfide.documentation_closures")&#91;0&#93;&#91;"n"&#93;</code> |
| `positive_persistence_probes` | function | 187 | <code>def positive_persistence_probes():</code> |
| `main` | function | 301 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/28_3.py

[Open source](../tests/hyperfide/cases/tasks/28_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `controlled` | function | 30 | <code>def controlled(change="",positive=False):</code> |
| `portable_cleanup_resource` | function | 35 | <code>def portable_cleanup_resource(remove=False):</code> |
| `cleanup_readiness` | function | 52 | <code>def cleanup_readiness():</code> |
| `portable_cases` | function | 67 | <code>def portable_cases():</code> |
| `main` | function | 193 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/28_4.py

[Open source](../tests/hyperfide/cases/tasks/28_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `kvx_sections` | function | 8 | <code>def kvx_sections(text):</code> |
| `independent_view` | function | 17 | <code>def independent_view(root):</code> |
| `controlled_pack` | function | 30 | <code>def controlled_pack(base,mismatches):</code> |
| `main` | function | 44 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/2_1.py

[Open source](../tests/hyperfide/cases/tasks/2_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 21 | <code>def expect(value,message):</code> |
| `sql` | function | 23 | <code>def sql(command,db=None,allow_error=False):return storage.sql(command,database=db or DB,allow_error=allow_error).stdout.strip()</code> |
| `check` | function | 24 | <code>def check(identity,callback):</code> |
| `outdir` | function | 29 | <code>def outdir():</code> |
| `Service` | class | 32 | <code>class Service:</code> |
| `__init__` | method | 33 | <code>def __init__(self,base):</code> |
| `_bootstrap` | method | 62 | <code>def _bootstrap(self,value,run,overrides=None):</code> |
| `_enrol` | method | 69 | <code>def _enrol(self,run):</code> |
| `request` | method | 76 | <code>def request(self,action,input,run,component="spec-import",overrides=None):</code> |
| `ok` | method | 94 | <code>def ok(self,&#42;args,&#42;&#42;kwargs):</code> |
| `reject` | method | 96 | <code>def reject(self,action,input,run,codes,&#42;&#42;kwargs):</code> |
| `source` | method | 98 | <code>def source(self,content=SOURCE):</code> |
| `envelope` | method | 101 | <code>def envelope(self,run,source=None):</code> |
| `probe` | function | 103 | <code>def probe(s):</code> |
| `private_profile` | function | 239 | <code>def private_profile():</code> |
| `private_probe` | function | 257 | <code>def private_probe(service):</code> |
| `qualify_private` | function | 299 | <code>def qualify_private():</code> |
| `cleanup` | function | 331 | <code>def cleanup():</code> |
| `main` | function | 344 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/2_2.py

[Open source](../tests/hyperfide/cases/tasks/2_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 18 | <code>def expect(condition,message):</code> |
| `check` | function | 20 | <code>def check(ident,callback):</code> |
| `artifact_root` | function | 25 | <code>def artifact_root():</code> |
| `sources` | function | 31 | <code>def sources(f):</code> |
| `add_repository` | function | 33 | <code>def add_repository(f,name):</code> |
| `import_run` | function | 38 | <code>def import_run(f,content,repositories):</code> |
| `enrol` | function | 52 | <code>def enrol(f,run):</code> |
| `run_fixture` | function | 61 | <code>def run_fixture(build,callback):</code> |
| `request` | function | 72 | <code>def request(f,run,action,payload,component='spec-dependencies',timeout=60):</code> |
| `success` | function | 76 | <code>def success(f,run,action,payload,&#42;&#42;kwargs):</code> |
| `refused` | function | 80 | <code>def refused(f,run,action,payload,code):</code> |
| `pins` | function | 83 | <code>def pins(run,&#42;&#42;changes):return dict({key:run&#91;key&#93; for key in &#91;'run_id','spec_revision_id','spec_generation','state_version'&#93;},&#42;&#42;changes)</code> |
| `current_state` | function | 84 | <code>def current_state(f,run):return f.sql("SELECT state,spec_generation::text,state_version::text FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",&#91;f.ids&#91;'organisation'&#93;,run&#91;'run_id'&#93;&#93;)&#91;0&#93;</code> |
| `task_id` | function | 85 | <code>def task_id(f,run,key):return f.sql("SELECT id FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND task_key=$3",&#91;f.ids&#91;'organisation'&#93;,run&#91;'run_id'&#93;,key&#93;)&#91;0&#93;&#91;'id'&#93;</code> |
| `edges_of` | function | 86 | <code>def edges_of(f,run):return f.sql("SELECT t.task_key,p.task_key AS predecessor_key,d.predecessor_run_id,d.milestone,d.predecessor_repository_id,d.integration_ref,d.predecessor_spec_generation::text,d.p…</code> |
| `descriptor` | function | 87 | <code>def descriptor(f,target,key,feature,milestone='QUALIFIED',repository=None,&#42;&#42;changes):</code> |
| `header` | function | 92 | <code>def header(slug):return '&#91;meta&#93;&#92;nslug = "'+slug+'"&#92;n&#91;req.1&#93;&#92;nac_1 = "An actual executable obligation"&#92;n&#91;acceptance.1&#93;&#92;nreq = "1.1"&#92;n'</code> |
| `task` | function | 93 | <code>def task(key,requires,wave=1,&#42;&#42;fields):</code> |
| `codes_for` | function | 96 | <code>def codes_for(report,key):return {row&#91;'code'&#93; for row in report&#91;'diagnostics'&#93; if row.get('task_key')==key}</code> |
| `find` | function | 97 | <code>def find(rows,code,key=None):return &#91;row for row in rows if row&#91;'code'&#93;==code and (key is None or row.get('task_key')==key)&#93;</code> |
| `build_positive` | function | 100 | <code>def build_positive(f,plan):</code> |
| `advance_run_snapshot` | function | 112 | <code>def advance_run_snapshot(f,run):</code> |
| `positive` | function | 124 | <code>def positive(f,plan):</code> |
| `build_invalid` | function | 223 | <code>def build_invalid(f,plan):</code> |
| `invalid` | function | 240 | <code>def invalid(f,plan):</code> |
| `build_large` | function | 276 | <code>def build_large(f,plan):</code> |
| `large` | function | 283 | <code>def large(f,plan):</code> |
| `corpus_bytes` | function | 300 | <code>def corpus_bytes():return (ROOT/CORPUS).read_bytes()</code> |
| `build_corpus` | function | 301 | <code>def build_corpus(f,plan):</code> |
| `corpus` | function | 307 | <code>def corpus(f,plan):</code> |
| `main` | function | 344 | <code>def main():</code> |
| `cleanup` | function | 355 | <code>def cleanup():</code> |

## tests/hyperfide/cases/tasks/2_3.py

[Open source](../tests/hyperfide/cases/tasks/2_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `artifact_root` | function | 50 | <code>def artifact_root():</code> |
| `expect` | function | 52 | <code>def expect(value,message):</code> |
| `check` | function | 54 | <code>def check(ident,body):</code> |
| `parse` | function | 59 | <code>def parse(source):</code> |
| `executable` | function | 61 | <code>def executable():return str(Path(sys.executable).resolve())</code> |
| `proof_source` | function | 62 | <code>def proof_source(base):</code> |
| `setup` | function | 65 | <code>def setup(f):</code> |
| `invoke` | function | 88 | <code>def invoke(f,action,value,key='operator',component='spec-revisions'):</code> |
| `success` | function | 92 | <code>def success(f,action,value,key='operator',component='spec-revisions'):</code> |
| `refused` | function | 94 | <code>def refused(f,action,value,code,key='operator'):</code> |
| `run_row` | function | 96 | <code>def run_row(f):return f.sql("SELECT state,spec_generation::text g,spec_revision_id::text s,state_version::text v FROM hyperfide.runs WHERE organisation_id=$1 AND id=$2",&#91;f.ids&#91;'organisation'&#93;,f.ids&#91;'r…</code> |
| `task_row` | function | 97 | <code>def task_row(f,name):return f.sql("SELECT state,spec_generation::text g,criteria_digest c,definition FROM hyperfide.tasks WHERE organisation_id=$1 AND run_id=$2 AND id=$3",&#91;f.ids&#91;'organisation'&#93;,f.ids…</code> |
| `count` | function | 98 | <code>def count(f,sql,values=None):return f.sql("SELECT count(&#42;)::int n FROM "+sql,values or &#91;&#93;)&#91;0&#93;&#91;'n'&#93;</code> |
| `request` | function | 99 | <code>def request(f,source,purpose='REPLAN',name='replacement.kvx'):</code> |
| `policy` | function | 102 | <code>def policy(f,task,criteria,spec,generation,clause,acceptance):</code> |
| `admit` | function | 104 | <code>def admit(f,proposal,revalidate,proofs=None,key='operator'):</code> |
| `activate` | function | 107 | <code>def activate(f):</code> |
| `probe` | function | 128 | <code>def probe(f):</code> |
| `derived` | function | 280 | <code>def derived(value):</code> |
| `components` | function | 283 | <code>def components():</code> |
| `main` | function | 295 | <code>def main():</code> |
| `cleanup` | function | 307 | <code>def cleanup():</code> |

## tests/hyperfide/cases/tasks/2_4.py

[Open source](../tests/hyperfide/cases/tasks/2_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 67 | <code>def expect(condition,message):</code> |
| `check` | function | 69 | <code>def check(ident,callback):</code> |
| `artifact_root` | function | 74 | <code>def artifact_root():</code> |
| `setup` | function | 76 | <code>def setup(f):</code> |
| `proof_input` | function | 100 | <code>def proof_input(f,task='task1'):</code> |
| `invoke` | function | 104 | <code>def invoke(f,action,payload,key='operator'):</code> |
| `success` | function | 107 | <code>def success(f,action,payload):</code> |
| `refused` | function | 111 | <code>def refused(f,action,payload,code):</code> |
| `inspection` | function | 114 | <code>def inspection(value):return {key:value&#91;key&#93; for key in &#91;'run_id','task_id','spec_revision_id','spec_generation'&#93;}</code> |
| `advance_run_snapshot` | function | 116 | <code>def advance_run_snapshot(f):</code> |
| `probe` | function | 129 | <code>def probe(f):</code> |
| `main` | function | 289 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/3_1.py

[Open source](../tests/hyperfide/cases/tasks/3_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 14 | <code>def expect(value,message):</code> |
| `check` | function | 16 | <code>def check(identity,callback):</code> |
| `apply_migration` | function | 21 | <code>def apply_migration(f,name):</code> |
| `HierarchyFixture` | class | 24 | <code>class HierarchyFixture(IdentityFixture):</code> |
| `__init__` | method | 25 | <code>def __init__(self,extra_components=(),extra_setup=None,bootstrap=True,extra_env=None,seed_historical_runtime=True,source_object_id=None):</code> |
| `ok` | method | 59 | <code>def ok(self,action,payload=None,key="leader",component="3.1"):</code> |
| `reject` | method | 63 | <code>def reject(self,action,payload,code,key="leader",component="3.1"):</code> |
| `bootstrap` | method | 67 | <code>def bootstrap(self):</code> |
| `snapshot` | method | 72 | <code>def snapshot(self):</code> |
| `add_package` | function | 77 | <code>def add_package(f,key,feature,wave,task=False):</code> |
| `configure` | function | 83 | <code>def configure(f,key,feature,policy,suffix=""):</code> |
| `assignment` | function | 85 | <code>def assignment(f,key,manager,generation="1",suffix=""):</code> |
| `move` | function | 87 | <code>def move(f,key,generation,frm,to,suffix="",refs=(),lg="1"):</code> |
| `package_row` | function | 89 | <code>def package_row(f,key):</code> |
| `generations` | function | 91 | <code>def generations(f,keys):</code> |
| `proposal` | function | 93 | <code>def proposal(f,name,successor,keys=ALPHA,lg="1",supersedes=None):</code> |
| `ownership_and_lifecycle` | function | 97 | <code>def ownership_and_lifecycle(f,state):</code> |
| `leader_loss_recovery` | function | 220 | <code>def leader_loss_recovery(f,state):</code> |
| `readiness_refusals` | function | 240 | <code>def readiness_refusals(f):</code> |
| `main` | function | 273 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/3_2.py

[Open source](../tests/hyperfide/cases/tasks/3_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 12 | <code>def expect(value,message):</code> |
| `check` | function | 14 | <code>def check(identity,fn):</code> |
| `canonical` | function | 18 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False)</code> |
| `identity` | function | 19 | <code>def identity(value):return sha(canonical(value).encode())</code> |
| `dependencies` | function | 20 | <code>def dependencies(stems):</code> |
| `parse_kvx` | function | 35 | <code>def parse_kvx(source):</code> |
| `accept_spec` | function | 37 | <code>def accept_spec(f,generation,criterion="A task packet SHALL identify exact inputs. Mandatory intent and constraints SHALL not be removed by context ranking."):</code> |
| `move_run` | function | 47 | <code>def move_run(f,generation,spec,state):</code> |
| `prepared_slot` | function | 49 | <code>def prepared_slot(f,key,commit):</code> |
| `PacketFixture` | class | 72 | <code>class PacketFixture(HierarchyFixture):</code> |
| `__init__` | method | 73 | <code>def __init__(self,extra_components=(),extra_setup=None,bootstrap=True,seed_historical_runtime=True,extra_env=None,source_object_id=None):</code> |
| `task_definition` | method | 88 | <code>def task_definition(self,section=None,&#42;&#42;overrides):</code> |
| `insert_task` | method | 95 | <code>def insert_task(self,key,definition,criteria=None,generation=2,spec=None):</code> |
| `proof_policy` | method | 99 | <code>def proof_policy(self,criteria,generation=2,spec=None):</code> |
| `register_proof` | method | 104 | <code>def register_proof(self,task,policy):</code> |
| `accepted_task` | method | 107 | <code>def accepted_task(self,key,&#42;&#42;overrides):</code> |
| `packet_input` | method | 109 | <code>def packet_input(self,&#42;&#42;overrides):</code> |
| `create_packet` | method | 111 | <code>def create_packet(self,&#42;&#42;overrides):</code> |
| `refuse_packet` | method | 113 | <code>def refuse_packet(self,code,&#42;&#42;overrides):</code> |
| `validate` | method | 115 | <code>def validate(self,digest):</code> |
| `stale` | method | 117 | <code>def stale(self,digest,reason):</code> |
| `without_attempt` | function | 121 | <code>def without_attempt(mandatory):</code> |
| `main` | function | 123 | <code>def main():</code> |
| `graph_inputs_regression` | function | 285 | <code>def graph_inputs_regression():</code> |

## tests/hyperfide/cases/tasks/3_3.py

[Open source](../tests/hyperfide/cases/tasks/3_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 21 | <code>def expect(value,message):</code> |
| `check` | function | 23 | <code>def check(identity,fn):</code> |
| `size` | function | 27 | <code>def size(value):return len(json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode())</code> |
| `public_candidates` | function | 28 | <code>def public_candidates():</code> |
| `private_candidates` | function | 32 | <code>def private_candidates():</code> |
| `load_corpus` | function | 41 | <code>def load_corpus(private):</code> |
| `field` | function | 52 | <code>def field(definition,key):</code> |
| `expected_intent` | function | 55 | <code>def expected_intent(definition,criteria):</code> |
| `main` | function | 64 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/3_4.py

[Open source](../tests/hyperfide/cases/tasks/3_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 14 | <code>def expect(value,message):</code> |
| `check` | function | 16 | <code>def check(identity,fn):</code> |
| `native_profiles` | function | 20 | <code>def native_profiles(f):</code> |
| `accepted_intent` | function | 37 | <code>def accepted_intent(f):</code> |
| `claim` | function | 54 | <code>def claim(f):</code> |
| `rotate_epoch` | function | 63 | <code>def rotate_epoch(f,writer):</code> |
| `SupervisorFixture` | class | 70 | <code>class SupervisorFixture(sched.SchedulerFixture):</code> |
| `__init__` | method | 71 | <code>def __init__(self,extra_setup=None,bootstrap=True):</code> |
| `main` | function | 77 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/4_1.py

[Open source](../tests/hyperfide/cases/tasks/4_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 23 | <code>def uid(n): return f"30000000-0000-0000-0000-{n:012d}"</code> |
| `expect` | function | 39 | <code>def expect(value, message):</code> |
| `check` | function | 42 | <code>def check(identity, callback):</code> |
| `database_env` | function | 52 | <code>def database_env(database=DATABASE):</code> |
| `sql` | function | 60 | <code>def sql(text, &#42;, database=DATABASE, allow_error=False):</code> |
| `observation_dir` | function | 74 | <code>def observation_dir():</code> |
| `cleanup` | function | 79 | <code>def cleanup():</code> |
| `Service` | class | 97 | <code>class Service:</code> |
| `__init__` | method | 98 | <code>def __init__(self, base):</code> |
| `request` | method | 106 | <code>def request(self, action, value=None, &#42;, policy=None, env=None):</code> |
| `ok` | method | 122 | <code>def ok(self,action,value=None):</code> |
| `reject` | method | 127 | <code>def reject(self,action,value,code):</code> |
| `create` | method | 132 | <code>def create(self,kind,record):</code> |
| `reject_create` | method | 134 | <code>def reject_create(self,kind,record,code):</code> |
| `validators` | function | 144 | <code>def validators(service):</code> |
| `schema_checks` | function | 195 | <code>def schema_checks(service):</code> |
| `final_schema_negatives` | function | 261 | <code>def final_schema_negatives(service):</code> |
| `relational` | function | 283 | <code>def relational(service):</code> |
| `relational_final` | function | 353 | <code>def relational_final(service,xid,scope,epoch,custody):</code> |
| `main` | function | 404 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/4_2.py

[Open source](../tests/hyperfide/cases/tasks/4_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CommitAckProxy` | class | 16 | <code>class CommitAckProxy:</code> |
| `__init__` | method | 17 | <code>def __init__(self,directory):</code> |
| `accept` | method | 24 | <code>def accept(self):</code> |
| `forward` | method | 33 | <code>def forward(self,source,target,state,frontend):</code> |
| `close` | method | 61 | <code>def close(self):</code> |
| `envdb` | function | 69 | <code>def envdb(db):</code> |
| `sql` | function | 71 | <code>def sql(text,db=DATABASE):</code> |
| `cleanup` | function | 75 | <code>def cleanup(emit=True):</code> |
| `main` | function | 99 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/4_3.py

[Open source](../tests/hyperfide/cases/tasks/4_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `module` | function | 13 | <code>def module(name,path):</code> |
| `expect` | function | 19 | <code>def expect(value,message):</code> |
| `check` | function | 21 | <code>def check(identity,operation):</code> |
| `canonical` | function | 26 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)</code> |
| `sha` | function | 27 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `output` | function | 28 | <code>def output():</code> |
| `socket_up` | function | 30 | <code>def socket_up(path):</code> |
| `cleanup` | function | 35 | <code>def cleanup():</code> |
| `routed` | function | 46 | <code>def routed(url,path):</code> |
| `Fixture` | class | 48 | <code>class Fixture:</code> |
| `__init__` | method | 49 | <code>def __init__(self):</code> |
| `graph` | method | 87 | <code>def graph(self,component,action,value):</code> |
| `publish_graph` | method | 89 | <code>def publish_graph(self,generation,expected):</code> |
| `graph_packet` | method | 103 | <code>def graph_packet(self,manifest,label):</code> |
| `request` | method | 110 | <code>def request(self,action,value,key="manager"):</code> |
| `ok` | method | 114 | <code>def ok(self,action,value,key="manager"):</code> |
| `reject` | method | 118 | <code>def reject(self,action,value,code=None,key="manager"):</code> |
| `read` | method | 122 | <code>def read(self,&#42;&#42;overrides):return self.ok("storage.packet.read",dict(digest=self.digest,barrier=self.barrier,&#42;&#42;overrides))</code> |
| `signed_barrier` | method | 123 | <code>def signed_barrier(self,&#42;&#42;changes):</code> |
| `promote` | method | 128 | <code>def promote(self):</code> |
| `close` | method | 134 | <code>def close(self):</code> |
| `main` | function | 146 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/4_4.py

[Open source](../tests/hyperfide/cases/tasks/4_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CommitAckProxy` | class | 13 | <code>class CommitAckProxy:</code> |
| `__init__` | method | 14 | <code>def __init__(self,directory):</code> |
| `accept` | method | 21 | <code>def accept(self):</code> |
| `forward` | method | 30 | <code>def forward(self,source,target,state,frontend):</code> |
| `close` | method | 59 | <code>def close(self):</code> |
| `uid` | function | 67 | <code>def uid():return str(uuid.uuid4())</code> |
| `cleanup` | function | 68 | <code>def cleanup(emit=True):</code> |
| `main` | function | 81 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/5_1.py

[Open source](../tests/hyperfide/cases/tasks/5_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `campaign_root` | function | 15 | <code>def campaign_root():</code> |
| `owned_receipt` | function | 17 | <code>def owned_receipt():</code> |
| `write_json` | function | 19 | <code>def write_json(path,value):</code> |
| `configure_cleanup` | function | 25 | <code>def configure_cleanup(task):</code> |
| `process_start` | function | 29 | <code>def process_start(pid):</code> |
| `record_fixture` | function | 32 | <code>def record_fixture(f):</code> |
| `cleanup_owned` | function | 38 | <code>def cleanup_owned(task):</code> |
| `expect` | function | 80 | <code>def expect(value,message):</code> |
| `check` | function | 82 | <code>def check(name,callback):</code> |
| `accept_scheduler_spec` | function | 91 | <code>def accept_scheduler_spec(f,tasks):</code> |
| `SchedulerFixture` | class | 106 | <code>class SchedulerFixture(PacketFixture):</code> |
| `__init__` | method | 107 | <code>def __init__(self,extra_components=(),extra_setup=None,agent_limit=2,bootstrap=True,sandbox_cpu_limit=8000,sandbox_cpu_headroom=1000,source_object_id=None,extra_env=None,extra_tasks=()):</code> |
| `start` | method | 143 | <code>def start(self):</code> |
| `capacity` | method | 147 | <code>def capacity(self,job="AGENT"):</code> |
| `packet_request` | method | 151 | <code>def packet_request(self,name="a",&#42;&#42;overrides):</code> |
| `prepare_claim` | method | 153 | <code>def prepare_claim(self,name="a",lease_ms=300000):</code> |
| `claim` | method | 158 | <code>def claim(self,name="a",request=None,lease_ms=300000):</code> |
| `primary` | method | 161 | <code>def primary(self,body,data=None):</code> |
| `counts` | method | 179 | <code>def counts(self):</code> |
| `allow_describe` | function | 181 | <code>def allow_describe(f):</code> |
| `add_slot` | function | 191 | <code>def add_slot(f,key):</code> |
| `ledger` | function | 193 | <code>def ledger(f):</code> |
| `refused_unchanged` | function | 203 | <code>def refused_unchanged(f,request,code,key="manager",message=None):</code> |
| `main` | function | 208 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/5_2.py

[Open source](../tests/hyperfide/cases/tasks/5_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `kvx` | function | 10 | <code>def kvx(name,&#42;&#42;fields):return {"name":name,"fields":{key:{"value":value} for key,value in fields.items()}}</code> |
| `SchedulerFixture` | class | 16 | <code>class SchedulerFixture(m.SchedulerFixture):</code> |
| `sql` | method | 17 | <code>def sql(self,sql,values=None,admin=False,serial=True):</code> |
| `lease_setup` | function | 31 | <code>def lease_setup(f):</code> |
| `lease_fixture` | function | 47 | <code>def lease_fixture():</code> |
| `reclaim` | function | 49 | <code>def reclaim(f,name,generation,lease_ms=300000):</code> |
| `bootstrap_runner` | function | 56 | <code>def bootstrap_runner(f):</code> |
| `try_reclaim` | function | 64 | <code>def try_reclaim(f,name,generation):</code> |
| `delegate_worker` | function | 73 | <code>def delegate_worker(f,token,name):</code> |
| `renew` | function | 79 | <code>def renew(f,key,token,lease_ms=1000,&#42;&#42;kwargs):</code> |
| `expire` | function | 81 | <code>def expire(f):</code> |
| `code` | function | 83 | <code>def code(response):return response.get("error",{}).get("code")</code> |
| `primary_now` | function | 84 | <code>def primary_now(f):return f.sql("SELECT clock_timestamp()::text AS now")&#91;0&#93;&#91;"now"&#93;</code> |
| `from_primary` | function | 85 | <code>def from_primary(f,expires,before,after,ms):</code> |
| `attempt_state` | function | 87 | <code>def attempt_state(f,attempt):</code> |
| `current_generations` | function | 89 | <code>def current_generations(f,task):</code> |
| `wait_past` | function | 91 | <code>def wait_past(f,expires,margin_ms=50):</code> |
| `concurrently` | function | 93 | <code>def concurrently(&#42;calls):</code> |
| `admit_custody` | function | 100 | <code>def admit_custody(f,token):</code> |
| `revoke_custody` | function | 108 | <code>def revoke_custody(f,custody):</code> |
| `generations` | function | 118 | <code>def generations():</code> |
| `m_try` | function | 226 | <code>def m_try(call):</code> |
| `races` | function | 233 | <code>def races():</code> |
| `cleanup` | function | 289 | <code>def cleanup():</code> |
| `main` | function | 304 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/5_3.py

[Open source](../tests/hyperfide/cases/tasks/5_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `field` | function | 9 | <code>def field(key,value,line):return {"key":key,"raw":json.dumps(value),"value":value,"line":line}</code> |
| `accepted_intent` | function | 10 | <code>def accepted_intent(f):</code> |
| `describe_access` | function | 25 | <code>def describe_access(f):</code> |
| `fixture` | function | 33 | <code>def fixture(describe=False,&#42;&#42;kwargs):</code> |
| `registered` | function | 38 | <code>def registered(f):</code> |
| `reconcile_probe` | function | 53 | <code>def reconcile_probe(f,request_id,observation):return f.primary(RECONCILE_JS,{"request_id":request_id,"observation":observation})</code> |
| `outcome` | function | 54 | <code>def outcome(response):</code> |
| `refused` | function | 56 | <code>def refused(response,code):expect(response.get("error",{}).get("code")==code,"Expected "+code+", observed "+json.dumps(response))</code> |
| `receipt` | function | 57 | <code>def receipt(f,state="COMPLETED"):</code> |
| `dispatch` | function | 62 | <code>def dispatch(f,request_id):</code> |
| `attempt` | function | 64 | <code>def attempt(f,attempt_id):</code> |
| `lost_response` | function | 71 | <code>def lost_response(f,action,payload,key,component):</code> |
| `crash_after_commit` | function | 91 | <code>def crash_after_commit(f,request):</code> |
| `wait_rows` | function | 94 | <code>def wait_rows(f,sql,values,deadline=20):</code> |
| `prepare_replacement` | function | 101 | <code>def prepare_replacement(f,name,generation):</code> |
| `cleanup` | function | 109 | <code>def cleanup():</code> |
| `main` | function | 125 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/5_4.py

[Open source](../tests/hyperfide/cases/tasks/5_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `accept_generation_two` | function | 34 | <code>def accept_generation_two(f):</code> |
| `setup` | function | 52 | <code>def setup(f):</code> |
| `ResourceFixture` | class | 73 | <code>class ResourceFixture(m.SchedulerFixture):</code> |
| `__init__` | method | 74 | <code>def __init__(self):</code> |
| `prepare_claim` | method | 76 | <code>def prepare_claim(self,name="a",lease_ms=300000):</code> |
| `set_policy` | method | 78 | <code>def set_policy(self,&#42;&#42;values):</code> |
| `account` | method | 81 | <code>def account(self,ident):</code> |
| `lower` | method | 83 | <code>def lower(self,body,data=None,timeout=60):</code> |
| `new_pool` | method | 101 | <code>def new_pool(self,limits):</code> |
| `scope_of` | function | 110 | <code>def scope_of(f):</code> |
| `job` | function | 113 | <code>def job(f,kind,priority=0,wait="CAPACITY",deadline=300000,task="a"):</code> |
| `queue` | function | 115 | <code>def queue(f,request):return f.ok("scheduler.resources.queue",request,key="manager",component="5.4")</code> |
| `admit` | function | 116 | <code>def admit(f,waiter,&#42;&#42;extra):return f.ok("scheduler.resources.admit",dict(scope_of(f),waiter_id=waiter,&#42;&#42;extra),key="manager",component="5.4")</code> |
| `expire` | function | 117 | <code>def expire(f,waiter):</code> |
| `reservations` | function | 119 | <code>def reservations(f,requests):</code> |
| `waiter_request` | function | 121 | <code>def waiter_request(f,waiter):return f.sql("SELECT request_id FROM hyperfide.resource_waiters WHERE id=$1",&#91;waiter&#93;)&#91;0&#93;&#91;"request_id"&#93;</code> |
| `limit_kind` | function | 123 | <code>def limit_kind(f,kind,observed):</code> |
| `primary_section` | function | 137 | <code>def primary_section(f):</code> |
| `fairness_section` | function | 253 | <code>def fairness_section(f):</code> |
| `ceiling_section` | function | 361 | <code>def ceiling_section(f):</code> |
| `workload` | function | 394 | <code>def workload(seed):</code> |
| `reference` | function | 404 | <code>def reference(events):</code> |
| `replay_section` | function | 433 | <code>def replay_section(f,base_seed):</code> |
| `run_fixture` | function | 461 | <code>def run_fixture(name,section,&#42;args):</code> |
| `main` | function | 468 | <code>def main():</code> |
| `cleanup` | function | 477 | <code>def cleanup():</code> |

## tests/hyperfide/cases/tasks/6_1.py

[Open source](../tests/hyperfide/cases/tasks/6_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 11 | <code>def uid(n):return f"00000000-0000-4000-8000-{n:012x}"</code> |
| `expect` | function | 13 | <code>def expect(value,message):</code> |
| `check` | function | 15 | <code>def check(name,callback):</code> |
| `q` | function | 20 | <code>def q(value):return "'"+str(value).replace("'","''")+"'"</code> |
| `database` | function | 21 | <code>def database():return "hf_task_"+TASK.replace(".","_")+"_qualification"</code> |
| `env` | function | 22 | <code>def env():</code> |
| `sql` | function | 27 | <code>def sql(text,admin=False):</code> |
| `target` | function | 32 | <code>def target():</code> |
| `cleanup` | function | 35 | <code>def cleanup():</code> |
| `Service` | class | 173 | <code>class Service(identity.IdentityFixture):</code> |
| `__init__` | method | 174 | <code>def __init__(self,include_instructions=None):</code> |
| `prepare` | method | 188 | <code>def prepare(self,f):</code> |
| `start` | method | 222 | <code>def start(self):</code> |
| `request_action` | method | 233 | <code>def request_action(self,action,value,runner=None):</code> |
| `ok` | method | 241 | <code>def ok(self,action,value=None,runner=None):</code> |
| `reject` | method | 245 | <code>def reject(self,action,value,code=None,runner=None):</code> |
| `enroll_runner` | method | 249 | <code>def enroll_runner(self):</code> |
| `event` | function | 257 | <code>def event(n,version="1",aggregate=None,event_type="fixture.changed"):</code> |
| `claim` | function | 260 | <code>def claim(s,lease=300000,limit=64):return s.ok("outbox.claim",dict(S,consumer_id=CONSUMER,limit=limit,lease_ms=lease))</code> |
| `receipt` | function | 261 | <code>def receipt(e,consumer=CONSUMER):</code> |
| `ack` | function | 263 | <code>def ack(s,c,inbox):</code> |
| `raw_event_sql` | function | 265 | <code>def raw_event_sql(e):</code> |
| `Session` | class | 268 | <code>class Session:</code> |
| `__init__` | method | 269 | <code>def __init__(self):</code> |
| `call` | method | 272 | <code>def call(self,text):</code> |
| `close` | method | 279 | <code>def close(self):</code> |
| `suite61` | function | 283 | <code>def suite61(s):</code> |
| `suite62` | function | 371 | <code>def suite62(s):</code> |
| `concurrent_duplicate` | function | 444 | <code>def concurrent_duplicate(s):</code> |
| `seed_native_attempt` | function | 451 | <code>def seed_native_attempt(f):</code> |
| `command` | function | 462 | <code>def command(n,kind):</code> |
| `control` | function | 467 | <code>def control(s,mode,operation,expected=None):</code> |
| `suite63` | function | 471 | <code>def suite63(s):</code> |
| `suite64` | function | 624 | <code>def suite64(s):</code> |
| `daemon_lifecycle` | function | 672 | <code>def daemon_lifecycle(s):</code> |
| `main` | function | 771 | <code>def main(task="6.1"):</code> |

## tests/hyperfide/cases/tasks/6_3.py

[Open source](../tests/hyperfide/cases/tasks/6_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 13 | <code>def check(name,fn):</code> |
| `Service` | class | 17 | <code>class Service(commands.Service):</code> |
| `enroll_runner` | method | 19 | <code>def enroll_runner(self):</code> |
| `digest` | function | 28 | <code>def digest(value):return "sha256:"+hashlib.sha256(json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()).hexdigest()</code> |
| `structured` | function | 29 | <code>def structured(f,n,sequence,payload=None,&#42;&#42;changes):</code> |
| `ingest` | function | 35 | <code>def ingest(f,value):return f.ok("instructions.events.ingest",value,runner=True)</code> |
| `refuse` | function | 36 | <code>def refuse(f,value,code,runner=True):return f.reject("instructions.events.ingest",value,code,runner=runner)</code> |
| `count` | function | 37 | <code>def count(f,where,values=()):</code> |
| `api` | function | 39 | <code>def api():</code> |
| `main` | function | 101 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/7_1.py

[Open source](../tests/hyperfide/cases/tasks/7_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `encoded` | function | 18 | <code>def encoded(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)</code> |
| `sha` | function | 19 | <code>def sha(value):return "sha256:"+hashlib.sha256(value if isinstance(value,bytes) else value.encode()).hexdigest()</code> |
| `expect` | function | 20 | <code>def expect(value,message):</code> |
| `check` | function | 22 | <code>def check(identity,fn):</code> |
| `process` | function | 27 | <code>def process(args,cwd,&#42;&#42;kw):</code> |
| `Service` | class | 31 | <code>class Service:</code> |
| `__init__` | method | 32 | <code>def __init__(self,base,extra_components=(),database="hf_graph_7_1_qualification",graph_schema=False):</code> |
| `__enter__` | method | 68 | <code>def __enter__(self):return self</code> |
| `__exit__` | method | 69 | <code>def __exit__(self,&#42;_):self.close()</code> |
| `close` | method | 70 | <code>def close(self):</code> |
| `request` | method | 77 | <code>def request(self,action,value,env=None):</code> |
| `ok` | method | 84 | <code>def ok(self,action,value):</code> |
| `reject` | method | 88 | <code>def reject(self,action,value,code=None):</code> |
| `chunks` | method | 92 | <code>def chunks(self,manifest):</code> |
| `main` | function | 99 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/7_2.py

[Open source](../tests/hyperfide/cases/tasks/7_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 20 | <code>def check(identity,fn):</code> |
| `sql` | function | 25 | <code>def sql(statement,&#42;,database=None,allow_error=False):</code> |
| `artifact_root` | function | 32 | <code>def artifact_root():</code> |
| `cleanup` | function | 34 | <code>def cleanup():</code> |
| `Fixture` | class | 48 | <code>class Fixture:</code> |
| `__init__` | method | 49 | <code>def __init__(self,base):</code> |
| `extract` | method | 64 | <code>def extract(self,generation):</code> |
| `request` | method | 66 | <code>def request(self,component,action,value):</code> |
| `ok` | method | 70 | <code>def ok(self,component,action,value):</code> |
| `reject` | method | 74 | <code>def reject(self,component,action,value,code=None):</code> |
| `scoped` | method | 78 | <code>def scoped(self,&#42;&#42;kw):return dict(SCOPE,&#42;&#42;kw)</code> |
| `create` | method | 79 | <code>def create(self,manifest=None):</code> |
| `stage` | method | 81 | <code>def stage(self,build,manifest=None,chunks=None):</code> |
| `ready` | method | 84 | <code>def ready(self,manifest=None):</code> |
| `publish` | method | 91 | <code>def publish(self,build,channel="main",expected="0",operation=None):</code> |
| `ingestion` | function | 93 | <code>def ingestion(f):</code> |
| `branch_commit` | function | 160 | <code>def branch_commit(f):</code> |
| `extract_at` | function | 168 | <code>def extract_at(f,source,generation):</code> |
| `drive` | function | 170 | <code>def drive(f,manifest,chunks,limit):</code> |
| `committed_transactions` | function | 180 | <code>def committed_transactions():</code> |
| `network_amplification` | function | 184 | <code>def network_amplification(f,branch):</code> |
| `graph_saturation` | function | 205 | <code>def graph_saturation(f,build):</code> |
| `branch_race` | function | 259 | <code>def branch_race(f,branch):</code> |
| `artifact_status` | function | 290 | <code>def artifact_status(build,status):</code> |
| `publication` | function | 294 | <code>def publication(f):</code> |
| `querying` | function | 380 | <code>def querying(f):</code> |
| `main` | function | 528 | <code>def main(mode="7.2"):</code> |

## tests/hyperfide/cases/tasks/7_3.py

[Open source](../tests/hyperfide/cases/tasks/7_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Service` | class | 13 | <code>class Service(native_service):</code> |
| `__init__` | method | 17 | <code>def __init__(self,&#42;args,graph_schema=False,&#42;&#42;kw):</code> |
| `failed_build_exposes_debt` | function | 22 | <code>def failed_build_exposes_debt(f):</code> |
| `publication` | function | 50 | <code>def publication(f):</code> |

## tests/hyperfide/cases/tasks/7_4.py

[Open source](../tests/hyperfide/cases/tasks/7_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 12 | <code>def load(name,path):</code> |
| `CoordinatedSchemaService` | class | 21 | <code>class CoordinatedSchemaService(module.native.Service):</code> |
| `__init__` | method | 24 | <code>def __init__(self,&#42;args,graph_schema=False,&#42;&#42;kw):</code> |
| `Harness` | class | 29 | <code>class Harness:</code> |
| `__init__` | method | 30 | <code>def __init__(self,fixture,cluster):</code> |
| `obs` | method | 34 | <code>def obs(self,value):module.OBS.append(value)</code> |
| `sql` | method | 35 | <code>def sql(self,statement):return module.sql(statement).stdout.strip()</code> |
| `raw` | method | 36 | <code>def raw(self,action,&#42;&#42;kw):return self.f.request("7.4",action,self.f.scoped(&#42;&#42;kw))&#91;1&#93;</code> |
| `ok` | method | 37 | <code>def ok(self,action,&#42;&#42;kw):return self.f.ok("7.4",action,self.f.scoped(&#42;&#42;kw))</code> |
| `ok_raw` | method | 38 | <code>def ok_raw(self,action,value):return self.f.ok("7.4",action,value)</code> |
| `reject` | method | 39 | <code>def reject(self,action,code=None,&#42;&#42;kw):return self.f.reject("7.4",action,self.f.scoped(&#42;&#42;kw),code)</code> |
| `ready` | method | 40 | <code>def ready(self,manifest):</code> |
| `publish_manifest` | method | 46 | <code>def publish_manifest(self,manifest,channel):</code> |
| `write_artifact` | method | 50 | <code>def write_artifact(self,relative,value):</code> |
| `ledger` | function | 54 | <code>def ledger():return module.artifact_root()/"cluster-resources.json"</code> |
| `socket_up` | function | 55 | <code>def socket_up(path):</code> |
| `absence` | function | 60 | <code>def absence(item):</code> |
| `cleanup` | function | 64 | <code>def cleanup():</code> |
| `main` | function | 78 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/8_1.py

[Open source](../tests/hyperfide/cases/tasks/8_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `clone` | function | 66 | <code>def clone(value):</code> |
| `canonical_digest` | function | 70 | <code>def canonical_digest(value):</code> |
| `operation` | function | 75 | <code>def operation(kind):</code> |
| `resign` | function | 87 | <code>def resign(value):</code> |
| `capability_check` | function | 93 | <code>def capability_check():</code> |
| `page` | function | 98 | <code>def page(&#42;, cursor=None, next_cursor=None, more=False, complete=True, identity="sandbox-1"):</code> |
| `process_result` | function | 104 | <code>def process_result():</code> |
| `succeeded` | function | 110 | <code>def succeeded(kind):</code> |
| `uncertain` | function | 129 | <code>def uncertain(kind="create"):</code> |
| `expect` | function | 139 | <code>def expect(condition, detail):</code> |
| `add` | function | 144 | <code>def add(identity, action, payload, oracle):</code> |
| `valid` | function | 149 | <code>def valid(result):</code> |
| `rejected` | function | 154 | <code>def rejected(row):</code> |
| `accepted` | function | 158 | <code>def accepted(oracle):</code> |
| `reason` | function | 165 | <code>def reason(code):</code> |
| `change` | function | 173 | <code>def change(base, path, value):</code> |
| `invalid_op` | function | 182 | <code>def invalid_op(identity, kind, path, value, &#42;, rehash=True):</code> |
| `invalid_outcome` | function | 189 | <code>def invalid_outcome(identity, kind, path, value):</code> |
| `inventory` | function | 193 | <code>def inventory(pages):</code> |
| `inventory_oracle` | function | 197 | <code>def inventory_oracle(complete, eligible, count):</code> |
| `define_cases` | function | 206 | <code>def define_cases():</code> |
| `Service` | class | 382 | <code>class Service:</code> |
| `__init__` | method | 383 | <code>def __init__(self, directory):</code> |
| `request` | method | 400 | <code>def request(self, action, payload):</code> |
| `close` | method | 414 | <code>def close(self):</code> |
| `main` | function | 427 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/8_2.py

[Open source](../tests/hyperfide/cases/tasks/8_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 13 | <code>def expect(condition,detail):</code> |
| `check` | function | 15 | <code>def check(name,fn):</code> |
| `sha` | function | 19 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `ProvisionerFixture` | class | 20 | <code>class ProvisionerFixture(identity.IdentityFixture):</code> |
| `__init__` | method | 21 | <code>def __init__(self,&#42;args,&#42;&#42;kwargs):super().__init__(&#42;args,service_role="provisioner",&#42;&#42;kwargs)</code> |
| `main` | function | 22 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/8_3.py

[Open source](../tests/hyperfide/cases/tasks/8_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 7 | <code>def load(name,path):</code> |
| `check` | function | 21 | <code>def check(name,fn):</code> |
| `sha` | function | 25 | <code>def sha(value):return "sha256:"+hashlib.sha256(value).hexdigest()</code> |
| `utc` | function | 26 | <code>def utc(ms=60000):return time.strftime("%Y-%m-%dT%H:%M:%S",time.gmtime((time.time()&#42;1000+ms)/1000))+".000Z"</code> |
| `prepare_provider_intent_fixture` | function | 27 | <code>def prepare_provider_intent_fixture(f):</code> |
| `seed_provider_capacity` | function | 37 | <code>def seed_provider_capacity(f):</code> |
| `spawn_service` | function | 95 | <code>def spawn_service(f,role,port,components,module_root):</code> |
| `simulated_module_root` | function | 108 | <code>def simulated_module_root(folder):</code> |
| `SimulatedProvisionerFixture` | class | 117 | <code>class SimulatedProvisionerFixture(pools.ProvisionerFixture):</code> |
| `__init__` | method | 119 | <code>def __init__(self,module_root,&#42;&#42;kwargs):self.module_root=module_root;super().__init__(&#42;&#42;kwargs)</code> |
| `start` | method | 120 | <code>def start(self):self.child=spawn_service(self,"provisioner",self.port,self.components,self.module_root)</code> |
| `crash` | method | 121 | <code>def crash(self):</code> |
| `stop` | method | 123 | <code>def stop(self):</code> |
| `wait_for` | function | 130 | <code>def wait_for(predicate,detail,seconds=30):</code> |
| `worker_composition` | function | 139 | <code>def worker_composition(check):</code> |
| `main` | function | 270 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/8_4.py

[Open source](../tests/hyperfide/cases/tasks/8_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 120 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/9_1.py

[Open source](../tests/hyperfide/cases/tasks/9_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `clone` | function | 38 | <code>def clone(v): return copy.deepcopy(v)</code> |
| `sha` | function | 39 | <code>def sha(data): return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `digest` | function | 40 | <code>def digest(v): return sha(json.dumps(v,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode())</code> |
| `utc` | function | 41 | <code>def utc(delta=0): return (datetime.now(timezone.utc)+timedelta(seconds=delta)).isoformat(timespec="milliseconds").replace("+00:00","Z")</code> |
| `expect` | function | 42 | <code>def expect(condition,detail):</code> |
| `check` | function | 44 | <code>def check(identity,callback):</code> |
| `result` | function | 52 | <code>def result(row):</code> |
| `reject` | function | 55 | <code>def reject(row):</code> |
| `alter` | function | 57 | <code>def alter(v,path,value):</code> |
| `base` | function | 63 | <code>def base():</code> |
| `profile` | function | 67 | <code>def profile():</code> |
| `resign_profile` | function | 77 | <code>def resign_profile(v):</code> |
| `observed` | function | 82 | <code>def observed():</code> |
| `operation` | function | 85 | <code>def operation(kind,identity,params=None):</code> |
| `Fixture` | class | 101 | <code>class Fixture:</code> |
| `__init__` | method | 102 | <code>def __init__(self,directory):</code> |
| `Handler` | class | 105 | <code>class Handler(http.server.BaseHTTPRequestHandler):</code> |
| `log_message` | method | 106 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 107 | <code>def do_POST(self):</code> |
| `write_config` | method | 170 | <code>def write_config(self):</code> |
| `close` | method | 172 | <code>def close(self):self.server.shutdown();self.server.server_close();self.thread.join(timeout=5)</code> |
| `Service` | class | 174 | <code>class Service:</code> |
| `__init__` | method | 176 | <code>def __init__(self,directory,fixture):</code> |
| `call` | method | 193 | <code>def call(self,component,action,payload):</code> |
| `close` | method | 197 | <code>def close(self):self.actual.close()</code> |
| `simulated_sandbox` | function | 254 | <code>def simulated_sandbox(fixture,sandbox_id,boot_id,preparation_digest,processes=()):</code> |
| `simulated_restore` | function | 262 | <code>def simulated_restore(fixture,key,sandbox_id,preparation_digest):</code> |
| `WebSocketFixture` | class | 268 | <code>class WebSocketFixture:</code> |
| `__init__` | method | 269 | <code>def __init__(self,directory,fixture):</code> |
| `snapshot` | method | 282 | <code>def snapshot(self):return json.loads(self.state.read_text())</code> |
| `close` | method | 283 | <code>def close(self):</code> |
| `main` | function | 293 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/9_2.py

[Open source](../tests/hyperfide/cases/tasks/9_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 16 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/9_3.py

[Open source](../tests/hyperfide/cases/tasks/9_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `wait_exit` | function | 21 | <code>def wait_exit(service,session,timeout=30):</code> |
| `start` | function | 31 | <code>def start(service,identity,argv,stdin=False):</code> |
| `stop` | function | 38 | <code>def stop(service,session,identity):</code> |
| `reap_fixture_descendants` | function | 41 | <code>def reap_fixture_descendants():</code> |
| `main` | function | 49 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/9_4.py

[Open source](../tests/hyperfide/cases/tasks/9_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `simulate_quota` | function | 26 | <code>def simulate_quota(fixture):</code> |
| `actual_factory_checks` | function | 43 | <code>def actual_factory_checks(fixture,folder):</code> |
| `main` | function | 137 | <code>def main():</code> |

## tests/hyperfide/check-evidence.py

[Open source](../tests/hyperfide/check-evidence.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `InvalidEvidence` | class | 23 | <code>class InvalidEvidence(Exception):</code> |
| `require` | function | 27 | <code>def require(condition, message):</code> |
| `unique_object` | function | 32 | <code>def unique_object(pairs):</code> |
| `decode` | function | 40 | <code>def decode(value):</code> |
| `canonical` | function | 45 | <code>def canonical(value):</code> |
| `digest_file` | function | 49 | <code>def digest_file(path):</code> |
| `load` | function | 59 | <code>def load(path):</code> |
| `identifiers` | function | 66 | <code>def identifiers(value, label, empty=False):</code> |
| `positive_integer` | function | 74 | <code>def positive_integer(value, label, zero=False):</code> |
| `sha` | function | 78 | <code>def sha(value, label):</code> |
| `relative_file` | function | 82 | <code>def relative_file(root, relative):</code> |
| `checked_file` | function | 95 | <code>def checked_file(root, record):</code> |
| `timestamp` | function | 105 | <code>def timestamp(value):</code> |
| `command_shape` | function | 110 | <code>def command_shape(command):</code> |
| `physical_file` | function | 124 | <code>def physical_file(path):</code> |
| `physical_directory` | function | 127 | <code>def physical_directory(path):</code> |
| `logical_file` | function | 130 | <code>def logical_file(path):</code> |
| `command_pass` | function | 133 | <code>def command_pass(command):</code> |
| `observed_events` | function | 157 | <code>def observed_events(path):</code> |
| `verify_receipt_integrity` | function | 174 | <code>def verify_receipt_integrity(root, receipt, manifest_hash, registry_hash, registration_hash):</code> |
| `source_inventory` | function | 248 | <code>def source_inventory(workspace, registration, campaign):</code> |
| `worktree_inventory` | function | 268 | <code>def worktree_inventory(workspace, campaign, commit, inventory):</code> |
| `verify_selected` | function | 306 | <code>def verify_selected(root, receipt, manifest, registry, registration, events, artifact_map):</code> |
| `check` | function | 444 | <code>def check(args):</code> |
| `main` | function | 494 | <code>def main():</code> |

## tests/hyperfide/inspect-proof.py

[Open source](../tests/hyperfide/inspect-proof.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Rejected` | class | 23 | <code>class Rejected(Exception):</code> |
| `require` | function | 26 | <code>def require(ok, message):</code> |
| `canonical` | function | 30 | <code>def canonical(value):</code> |
| `digest` | function | 33 | <code>def digest(raw):</code> |
| `pairs` | function | 36 | <code>def pairs(items):</code> |
| `decode` | function | 43 | <code>def decode(raw):</code> |
| `closed` | function | 47 | <code>def closed(value, keys, label):</code> |
| `identifier` | function | 50 | <code>def identifier(value):</code> |
| `sha` | function | 53 | <code>def sha(value):</code> |
| `revision` | function | 56 | <code>def revision(value):</code> |
| `cases` | function | 59 | <code>def cases(value):</code> |
| `parity_policy` | function | 63 | <code>def parity_policy(value):</code> |
| `validate_request` | function | 75 | <code>def validate_request(value):</code> |
| `under` | function | 89 | <code>def under(root, relative, directory=False):</code> |
| `bounded_read` | function | 101 | <code>def bounded_read(path):</code> |
| `recheck` | function | 107 | <code>def recheck(pins):</code> |
| `canonical_check` | function | 111 | <code>def canonical_check(campaign, receipt_id, relocation=None):</code> |
| `_inspect` | function | 143 | <code>def _inspect(request, evidence_root, require_full=False):</code> |
| `inspect` | function | 187 | <code>def inspect(request, evidence_root, require_full=False):</code> |
| `main` | function | 209 | <code>def main():</code> |

## tests/hyperfide/integration/agent_double.py

[Open source](../tests/hyperfide/integration/agent_double.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 12 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `b64` | function | 13 | <code>def b64(data):return base64.urlsafe_b64encode(data).decode().rstrip("=")</code> |
| `canonical` | function | 14 | <code>def canonical(value):return json.dumps(value,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()</code> |
| `main` | function | 15 | <code>def main():</code> |

## tests/hyperfide/integration/connected-stack.py

[Open source](../tests/hyperfide/integration/connected-stack.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `directory` | function | 22 | <code>def directory():</code> |
| `record` | function | 25 | <code>def record():return directory()/("connected-resource-"+TASK+".json")</code> |
| `emit` | function | 26 | <code>def emit(key,actual,expected=True):</code> |
| `observe` | function | 30 | <code>def observe(key,value):print(json.dumps({"type":"observation","id":PREFIX+key,"value":value}),flush=True)</code> |
| `support` | function | 31 | <code>def support():</code> |
| `start_of` | function | 34 | <code>def start_of(pid):</code> |
| `command_of` | function | 37 | <code>def command_of(pid):</code> |
| `free_port` | function | 40 | <code>def free_port():</code> |
| `wait_for` | function | 42 | <code>def wait_for(predicate,timeout=20,interval=.05):</code> |
| `Service` | class | 50 | <code>class Service:</code> |
| `__init__` | method | 52 | <code>def __init__(self,stack,role,fragments):</code> |
| `start` | method | 57 | <code>def start(self):</code> |
| `stop` | method | 70 | <code>def stop(self):</code> |
| `restart` | method | 76 | <code>def restart(self):</code> |
| `main` | function | 79 | <code>def main():</code> |
| `Control` | class | 96 | <code>class Control:port=None</code> |
| `psql` | function | 252 | <code>def psql(text):</code> |
| `cleanup_resources` | function | 257 | <code>def cleanup_resources():</code> |

## tests/hyperfide/integration/submission_stack.py

[Open source](../tests/hyperfide/integration/submission_stack.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load` | function | 14 | <code>def load(name,relative):</code> |
| `sha` | function | 17 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `uid` | function | 18 | <code>def uid():return str(uuid.uuid4())</code> |
| `process_start` | function | 19 | <code>def process_start(pid):</code> |
| `SubmissionStack` | class | 23 | <code>class SubmissionStack:</code> |
| `__init__` | method | 25 | <code>def __init__(self,record,tasks,extra_components=(),agent_limit=6,prefix="hyperfide-assurance-submit-",before_start=None):</code> |
| `OwnedScheduler` | class | 44 | <code>class OwnedScheduler(self.scheduler.SchedulerFixture):</code> |
| `start` | method | 45 | <code>def start(self):</code> |
| `save` | method | 62 | <code>def save(self):self.record.write_text(json.dumps(self.state))</code> |
| `remember` | method | 63 | <code>def remember(self,f):</code> |
| `own_process` | method | 70 | <code>def own_process(self,pid,label,port=None):</code> |
| `own_path` | method | 74 | <code>def own_path(self,path,prefix):</code> |
| `git` | method | 76 | <code>def git(self,&#42;args):</code> |
| `setup` | method | 79 | <code>def setup(self,f):</code> |
| `put` | method | 121 | <code>def put(self,data):</code> |
| `claim` | method | 126 | <code>def claim(self,name,lease_ms=300000,upload=True):</code> |
| `submission` | method | 143 | <code>def submission(self,name,&#42;&#42;changes):</code> |
| `envelope` | method | 150 | <code>def envelope(self,name,value):</code> |
| `send` | method | 153 | <code>def send(self,name,operation):return self.fixture.request(operation,key="worker_"+name)&#91;1&#93;</code> |
| `submit` | method | 154 | <code>def submit(self,name,value):return self.send(name,self.envelope(name,value))</code> |
| `scalar` | method | 156 | <code>def scalar(self,text,values):return self.fixture.sql(text,values)&#91;0&#93;</code> |
| `custodies` | method | 157 | <code>def custodies(self,name):</code> |
| `attempt_state` | method | 160 | <code>def attempt_state(self,name):</code> |
| `close` | method | 163 | <code>def close(self):</code> |
| `code` | function | 172 | <code>def code(response):return response.get("error",{}).get("code") if isinstance(response,dict) and response.get("ok") is False else None</code> |
| `cleanup_stack` | function | 174 | <code>def cleanup_stack(record,prefix,run_sql,resource_prefix,artifact,write_absence):</code> |

## tests/hyperfide/integration/tls_relay.py

[Open source](../tests/hyperfide/integration/tls_relay.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `read_message` | function | 10 | <code>def read_message(stream):</code> |
| `main` | function | 27 | <code>def main():</code> |

## tests/hyperfide/proof_relocation.py

[Open source](../tests/hyperfide/proof_relocation.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `guard_staging` | function | 11 | <code>def guard_staging(root, require):</code> |
| `Relocation` | class | 22 | <code>class Relocation:</code> |
| `__init__` | method | 23 | <code>def __init__(self, mapping, base, require):</code> |
| `absolute` | method | 58 | <code>def absolute(self, value):</code> |
| `relative` | method | 62 | <code>def relative(self, value, directory=False):</code> |
| `file` | method | 72 | <code>def file(self, original):</code> |
| `directory` | method | 80 | <code>def directory(self, original):</code> |
| `logical` | method | 87 | <code>def logical(self, staged):</code> |
| `executable` | method | 94 | <code>def executable(self, command, original):</code> |
| `safe_git` | function | 102 | <code>def safe_git(workspace, arguments, require, portable=False):</code> |

## tests/hyperfide/qualify.py

[Open source](../tests/hyperfide/qualify.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GateError` | class | 19 | <code>class GateError(Exception):</code> |
| `canonical` | function | 22 | <code>def canonical(value):</code> |
| `digest` | function | 25 | <code>def digest(data):</code> |
| `pairs` | function | 28 | <code>def pairs(items):</code> |
| `read_json` | function | 36 | <code>def read_json(path):</code> |
| `strings` | function | 43 | <code>def strings(value, name, nonempty=True):</code> |
| `utc` | function | 52 | <code>def utc():</code> |
| `immutable` | function | 55 | <code>def immutable(path, data):</code> |
| `snapshot` | function | 66 | <code>def snapshot(campaign, original, category, original_label=None):</code> |
| `children` | function | 78 | <code>def children():</code> |
| `source_inventory` | function | 81 | <code>def source_inventory(root, registration, output_dir):</code> |
| `worktree_inventory` | function | 97 | <code>def worktree_inventory(root, inventory, output_dir, commit):</code> |
| `run_child` | function | 124 | <code>def run_child(argv, root, timeout, env):</code> |
| `load_registry` | function | 202 | <code>def load_registry(path):</code> |
| `validate_manifest` | function | 257 | <code>def validate_manifest(manifest, registration, registry):</code> |
| `parse_events` | function | 300 | <code>def parse_events(output):</code> |
| `execute` | function | 330 | <code>def execute(args, root, registry_path, registry, registration, registration_path, manifest_path, manifest):</code> |
| `main` | function | 545 | <code>def main():</code> |

## tests/hyperfide/selftest_harness.py

[Open source](../tests/hyperfide/selftest_harness.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `digest` | function | 102 | <code>def digest(data: bytes) -&gt; str:</code> |
| `write_json` | function | 106 | <code>def write_json(path: Path, value: object) -&gt; None:</code> |
| `seal_receipt` | function | 110 | <code>def seal_receipt(receipt: dict) -&gt; None:</code> |
| `Fixture` | class | 115 | <code>class Fixture:</code> |
| `__init__` | method | 116 | <code>def __init__(self, mode: str = "success") -&gt; None:</code> |
| `pin` | method | 146 | <code>def pin(self, relative: str) -&gt; None:</code> |
| `save` | method | 152 | <code>def save(self) -&gt; None:</code> |
| `run` | method | 157 | <code>def run(self, &#42;selector: str, extra: tuple&#91;str, ...&#93; = (), runner: Path &#124; None = None) -&gt; subprocess.CompletedProcess:</code> |
| `successful` | method | 166 | <code>def successful(self, &#42;selector: str) -&gt; tuple&#91;Path, dict&#93;:</code> |
| `check` | method | 195 | <code>def check(self, campaign: Path, receipt_id: str &#124; None = None) -&gt; subprocess.CompletedProcess:</code> |
| `close` | method | 201 | <code>def close(self) -&gt; None:</code> |
| `HarnessTests` | class | 205 | <code>class HarnessTests(unittest.TestCase):</code> |
| `setUpClass` | method | 207 | <code>def setUpClass(cls) -&gt; None:</code> |
| `setUp` | method | 211 | <code>def setUp(self) -&gt; None:</code> |
| `tearDown` | method | 214 | <code>def tearDown(self) -&gt; None:</code> |
| `fixture` | method | 218 | <code>def fixture(self, mode: str = "success") -&gt; Fixture:</code> |
| `rejected` | method | 223 | <code>def rejected(self, result: subprocess.CompletedProcess) -&gt; None:</code> |
| `test_01_missing_selector` | method | 233 | <code>def test_01_missing_selector(self):</code> |
| `test_02_unknown_selector` | method | 236 | <code>def test_02_unknown_selector(self):</code> |
| `test_03_empty_selector` | method | 239 | <code>def test_03_empty_selector(self):</code> |
| `test_04_duplicate_selector` | method | 242 | <code>def test_04_duplicate_selector(self):</code> |
| `test_05_empty_suite` | method | 245 | <code>def test_05_empty_suite(self):</code> |
| `test_06_missing_runner` | method | 251 | <code>def test_06_missing_runner(self):</code> |
| `test_07_missing_child` | method | 257 | <code>def test_07_missing_child(self):</code> |
| `test_08_missing_checker` | method | 263 | <code>def test_08_missing_checker(self):</code> |
| `test_09_missing_fixture` | method | 273 | <code>def test_09_missing_fixture(self):</code> |
| `test_10_fixture_digest` | method | 279 | <code>def test_10_fixture_digest(self):</code> |
| `test_11_missing_credential` | method | 289 | <code>def test_11_missing_credential(self):</code> |
| `test_12_failed_child` | method | 295 | <code>def test_12_failed_child(self):</code> |
| `test_13_timeout_descendants` | method | 298 | <code>def test_13_timeout_descendants(self):</code> |
| `test_14_zero_assertions` | method | 323 | <code>def test_14_zero_assertions(self):</code> |
| `test_15_duplicate_assertions` | method | 326 | <code>def test_15_duplicate_assertions(self):</code> |
| `test_16_unexecuted_assertions` | method | 329 | <code>def test_16_unexecuted_assertions(self):</code> |
| `test_17_failed_assertion` | method | 332 | <code>def test_17_failed_assertion(self):</code> |
| `test_18_malformed_assertion` | method | 335 | <code>def test_18_malformed_assertion(self):</code> |
| `test_19_missing_cleanup` | method | 338 | <code>def test_19_missing_cleanup(self):</code> |
| `test_20_failed_cleanup` | method | 341 | <code>def test_20_failed_cleanup(self):</code> |
| `test_21_missing_artifact` | method | 350 | <code>def test_21_missing_artifact(self):</code> |
| `test_22_tampered_artifact` | method | 358 | <code>def test_22_tampered_artifact(self):</code> |
| `test_23_tampered_receipt` | method | 365 | <code>def test_23_tampered_receipt(self):</code> |
| `test_24_scope_forgery` | method | 374 | <code>def test_24_scope_forgery(self):</code> |
| `test_25_inventory_forgery` | method | 384 | <code>def test_25_inventory_forgery(self):</code> |
| `test_26_snapshot_tampered` | method | 395 | <code>def test_26_snapshot_tampered(self):</code> |
| `test_27_append_only` | method | 404 | <code>def test_27_append_only(self):</code> |
| `test_28_changed_input` | method | 417 | <code>def test_28_changed_input(self):</code> |
| `test_29_task_selector` | method | 427 | <code>def test_29_task_selector(self):</code> |
| `test_30_suite_selector` | method | 430 | <code>def test_30_suite_selector(self):</code> |
| `test_31_failed_then_pass` | method | 433 | <code>def test_31_failed_then_pass(self):</code> |
| `test_32_canonical_checker` | method | 445 | <code>def test_32_canonical_checker(self):</code> |
| `test_33_normal_exit_descendants` | method | 454 | <code>def test_33_normal_exit_descendants(self):</code> |
| `imported_helper` | method | 477 | <code>def imported_helper(self, declared: bool):</code> |
| `test_34_declared_import` | method | 492 | <code>def test_34_declared_import(self):</code> |
| `test_35_undeclared_import_in_root` | method | 495 | <code>def test_35_undeclared_import_in_root(self):</code> |
| `retained_fixture` | method | 499 | <code>def retained_fixture(self, approved: bool = True, omit: str &#124; None = None):</code> |
| `test_36_retention_approved` | method | 520 | <code>def test_36_retention_approved(self):</code> |
| `test_37_retention_unapproved` | method | 528 | <code>def test_37_retention_unapproved(self):</code> |
| `test_38_retention_owner_missing` | method | 532 | <code>def test_38_retention_owner_missing(self):</code> |
| `test_39_retention_expiry_missing` | method | 536 | <code>def test_39_retention_expiry_missing(self):</code> |
| `test_40_registry_boolean_version` | method | 541 | <code>def test_40_registry_boolean_version(self):</code> |
| `test_41_registration_boolean_version` | method | 547 | <code>def test_41_registration_boolean_version(self):</code> |
| `test_42_manifest_boolean_version` | method | 553 | <code>def test_42_manifest_boolean_version(self):</code> |
| `test_43_input_boolean_size` | method | 559 | <code>def test_43_input_boolean_size(self):</code> |
| `test_44_manifest_unknown_field` | method | 569 | <code>def test_44_manifest_unknown_field(self):</code> |
| `test_45_approval_unknown_field` | method | 575 | <code>def test_45_approval_unknown_field(self):</code> |
| `test_46_output_equals_workspace` | method | 582 | <code>def test_46_output_equals_workspace(self):</code> |
| `test_47_output_contains_source` | method | 587 | <code>def test_47_output_contains_source(self):</code> |
| `test_48_detached_pipe_timeout` | method | 601 | <code>def test_48_detached_pipe_timeout(self):</code> |
| `test_49_git_bytecode_parity` | method | 627 | <code>def test_49_git_bytecode_parity(self):</code> |
| `required_artifact_regression` | method | 646 | <code>def required_artifact_regression(self, method):</code> |
| `test_50_required_artifacts_per_receipt` | method | 654 | <code>def test_50_required_artifacts_per_receipt(self):</code> |
| `test_51_required_artifact_old_snapshot_tamper` | method | 657 | <code>def test_51_required_artifact_old_snapshot_tamper(self):</code> |
| `test_52_required_artifact_logical_alias_forgery` | method | 660 | <code>def test_52_required_artifact_logical_alias_forgery(self):</code> |
| `test_53_cleanup_immutable_absence_reference` | method | 663 | <code>def test_53_cleanup_immutable_absence_reference(self):</code> |
| `proof_regression` | method | 666 | <code>def proof_regression(self, method):</code> |
| `test_54_proof_component_inspection_is_not_authority` | method | 674 | <code>def test_54_proof_component_inspection_is_not_authority(self):</code> |
| `test_55_proof_component_cannot_satisfy_full` | method | 677 | <code>def test_55_proof_component_cannot_satisfy_full(self):</code> |
| `test_56_proof_exact_anchor_and_source` | method | 680 | <code>def test_56_proof_exact_anchor_and_source(self):</code> |
| `test_57_proof_case_and_closed_policy_binding` | method | 683 | <code>def test_57_proof_case_and_closed_policy_binding(self):</code> |
| `test_58_proof_path_escape_and_symlink` | method | 686 | <code>def test_58_proof_path_escape_and_symlink(self):</code> |
| `test_59_proof_duplicate_and_unknown_request_keys` | method | 689 | <code>def test_59_proof_duplicate_and_unknown_request_keys(self):</code> |
| `test_60_proof_real_canonical_artifact_tamper` | method | 692 | <code>def test_60_proof_real_canonical_artifact_tamper(self):</code> |
| `test_61_proof_portable_real_source_and_executable_checks` | method | 695 | <code>def test_61_proof_portable_real_source_and_executable_checks(self):</code> |
| `test_62_proof_portable_rejects_missing_map_and_changed_tool` | method | 698 | <code>def test_62_proof_portable_rejects_missing_map_and_changed_tool(self):</code> |
| `test_63_proof_portable_rejects_wrong_commit_and_escape` | method | 701 | <code>def test_63_proof_portable_rejects_wrong_commit_and_escape(self):</code> |
| `test_64_proof_postcheck_bytes_are_rechecked` | method | 704 | <code>def test_64_proof_postcheck_bytes_are_rechecked(self):</code> |
| `test_65_proof_git_filter_no_execution` | method | 707 | <code>def test_65_proof_git_filter_no_execution(self):</code> |
| `test_66_proof_external_campaign_environment` | method | 709 | <code>def test_66_proof_external_campaign_environment(self):</code> |
| `test_67_proof_private_staging_lock` | method | 711 | <code>def test_67_proof_private_staging_lock(self):</code> |
| `test_68_proof_immutable_child_runtime_assets` | method | 714 | <code>def test_68_proof_immutable_child_runtime_assets(self):</code> |
| `InventoryResult` | class | 717 | <code>class InventoryResult(unittest.TextTestResult):</code> |
| `__init__` | method | 718 | <code>def __init__(self, &#42;args, &#42;&#42;kwargs):</code> |
| `addSuccess` | method | 722 | <code>def addSuccess(self, test):</code> |
| `addFailure` | method | 726 | <code>def addFailure(self, test, error):</code> |
| `addError` | method | 730 | <code>def addError(self, test, error):</code> |
| `main` | function | 735 | <code>def main() -&gt; int:</code> |

## tests/hyperfide/support/identity_fixture.py

[Open source](../tests/hyperfide/support/identity_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 13 | <code>def sha(data):return "sha256:"+hashlib.sha256(data).hexdigest()</code> |
| `b64` | function | 14 | <code>def b64(data):return base64.urlsafe_b64encode(data).decode().rstrip("=")</code> |
| `uid` | function | 15 | <code>def uid():return str(uuid.uuid4())</code> |
| `canonical` | function | 16 | <code>def canonical(value):return json.dumps(value,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()</code> |
| `expect` | function | 17 | <code>def expect(value,message):</code> |
| `check` | function | 19 | <code>def check(name,callback):</code> |
| `IdentityFixture` | class | 27 | <code>class IdentityFixture:</code> |
| `__init__` | method | 28 | <code>def __init__(self,extra_components=(),extra_env=None,extra_setup=None,components=None,database=None,service_role="control",extra_actions=()):</code> |
| `sql` | method | 118 | <code>def sql(self,sql,values=None,admin=False,serial=True):</code> |
| `start` | method | 123 | <code>def start(self):</code> |
| `stop` | method | 134 | <code>def stop(self):</code> |
| `close` | method | 141 | <code>def close(self):</code> |
| `seed_fixture_principal` | method | 149 | <code>def seed_fixture_principal(self,record):</code> |
| `apply_migration` | method | 151 | <code>def apply_migration(self,name):</code> |
| `add_principal` | method | 156 | <code>def add_principal(self,name,role,actor_id=None):</code> |
| `operation` | method | 173 | <code>def operation(self,component,action,input,run=None,authority=None,expected_version=None,operation=None):</code> |
| `sign` | method | 176 | <code>def sign(self,key,message):</code> |
| `request` | method | 178 | <code>def request(self,body,key="operator",endpoint="/v1/invoke",credential=None,nonce=None,seconds=None,headers=None,ca=None,timeout_seconds=10):</code> |
| `invoke` | method | 192 | <code>def invoke(self,action,input,component="14.1",key="operator",authority=None,&#42;&#42;kwargs):</code> |
| `bind` | method | 195 | <code>def bind(self):</code> |
| `issue` | method | 197 | <code>def issue(self,grant=None,ttl=300,actions=None):</code> |
| `enrollment` | method | 199 | <code>def enrollment(self,key="runner",boot=None):</code> |
| `_bootstrap_runner` | function | 204 | <code>def _bootstrap_runner(self,actions=None):</code> |
| `_delegate_principal` | function | 211 | <code>def _delegate_principal(self,name,session_id,allowed_actions=None):</code> |
| `_evidence_base` | function | 230 | <code>def _evidence_base():</code> |
| `_record_fixture` | function | 238 | <code>def _record_fixture(fixture):</code> |
| `write_identity_observations` | function | 251 | <code>def write_identity_observations():</code> |
| `cleanup_identity_evidence` | function | 256 | <code>def cleanup_identity_evidence(task):</code> |

## tests/hyperfide/support/preparation_process_fixture.py

[Open source](../tests/hyperfide/support/preparation_process_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid_processes` | function | 151 | <code>def uid_processes():</code> |
| `main` | function | 166 | <code>def main():</code> |

## tests/hyperfide/support/preparation_receipts.test.mjs

[Open source](../tests/hyperfide/support/preparation_receipts.test.mjs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 10 | <code>const sha=b=&gt;'sha256:'+createHash('sha256').update(b).digest('hex');</code> |
| `fixture` | function | 11 | <code>function fixture(){</code> |
| `bytes` | function | 18 | <code>const bytes=v=&gt;Buffer.from(JSON.stringify(v));</code> |
| `refused` | function | 19 | <code>const refused=(fn,code)=&gt;assert.throws(fn,e=&gt;e.code===code);</code> |

## tests/hyperfide/support/preparation_stage_fixture.py

[Open source](../tests/hyperfide/support/preparation_stage_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 18 | <code>def sha(data):</code> |
| `StageService` | class | 21 | <code>class StageService:</code> |
| `__init__` | method | 23 | <code>def __init__(self, root, objects, fixture, database):</code> |
| `ok` | method | 34 | <code>def ok(self, action, value):</code> |
| `put` | method | 38 | <code>def put(self, data):</code> |
| `close` | method | 40 | <code>def close(self):</code> |
| `run_probe` | function | 43 | <code>def run_probe(binary, service_root):</code> |

## tests/hyperfide/support/reproduction_jobs.test.mjs

[Open source](../tests/hyperfide/support/reproduction_jobs.test.mjs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `id` | function | 6 | <code>const id=n=&gt;'00000000-0000-4000-8000-'+String(n).padStart(12,'0');</code> |
| `digest` | function | 7 | <code>const digest=n=&gt;'sha256:'+createHash('sha256').update(String(n)).digest('hex');</code> |
| `denied` | function | 8 | <code>const denied=e=&gt;e?.code==='REPRODUCTION_INPUT_AUTHORITY_DENIED';</code> |
| `fixture` | function | 9 | <code>function fixture(){</code> |

## tests/hyperfide/support/runner_budget_fixture.py

[Open source](../tests/hyperfide/support/runner_budget_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 104 | <code>def uid():return str(uuid.uuid4())</code> |
| `check` | function | 105 | <code>def check(value,message):</code> |
| `kernel_parent` | function | 107 | <code>def kernel_parent():</code> |
| `BudgetFixture` | class | 123 | <code>class BudgetFixture:</code> |
| `__init__` | method | 124 | <code>def __init__(self):</code> |
| `invoke` | method | 136 | <code>def invoke(self,&#42;,config=None,charge=None,mode="prepare",permissions=0o600,symlink=False):</code> |
| `enable_isolated_delegation` | method | 145 | <code>def enable_isolated_delegation(self):</code> |
| `close` | method | 160 | <code>def close(self):</code> |
| `run` | function | 165 | <code>def run():</code> |

## tests/hyperfide/support/runner_commands_fixture.py

[Open source](../tests/hyperfide/support/runner_commands_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 14 | <code>def check(name,fn):</code> |
| `expect` | function | 20 | <code>def expect(value,message):base.expect(value,message)</code> |
| `Service` | class | 21 | <code>class Service(base.Service):</code> |
| `__init__` | method | 22 | <code>def __init__(self):super().__init__(include_instructions=True)</code> |
| `enroll_runner` | method | 23 | <code>def enroll_runner(self):</code> |
| `poll` | method | 32 | <code>def poll(self,limit=16):</code> |
| `setup` | function | 34 | <code>def setup():</code> |
| `register` | function | 37 | <code>def register(f):return f.ok("instructions.consumer.register",dict(base.S,consumer_id=base.CONSUMER),runner=True)</code> |
| `due` | function | 38 | <code>def due():time.sleep(1.08)</code> |
| `state` | function | 39 | <code>def state(f,event):return f.sql("SELECT state FROM hyperfide.event_deliveries WHERE event_id=$1 AND consumer_id=$2",&#91;event,base.CONSUMER&#93;)&#91;0&#93;&#91;"state"&#93;</code> |
| `issue` | function | 40 | <code>def issue(f,n,kind):</code> |
| `basic` | function | 42 | <code>def basic():</code> |
| `suppressed` | function | 75 | <code>def suppressed():</code> |
| `historical` | function | 85 | <code>def historical():</code> |
| `main` | function | 100 | <code>def main():</code> |

## tests/hyperfide/support/sqlite_schema_fixture.py

[Open source](../tests/hyperfide/support/sqlite_schema_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `_literals` | function | 4 | <code>def _literals(text,start):</code> |
| `source_variant` | function | 13 | <code>def source_variant(root,database):</code> |

## tests/hyperfide/support/supervisor_daemon_fixture.py

[Open source](../tests/hyperfide/support/supervisor_daemon_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 12 | <code>def expect(value,message):</code> |
| `check` | function | 14 | <code>def check(name,fn):</code> |
| `wait_for` | function | 18 | <code>def wait_for(fn,timeout=15):</code> |
| `private` | function | 25 | <code>def private(path,value):</code> |
| `build` | function | 27 | <code>def build(folder):</code> |
| `load_fixture` | function | 36 | <code>def load_fixture():</code> |
| `Child` | class | 42 | <code>class Child:</code> |
| `__init__` | method | 43 | <code>def __init__(self,binary,config):</code> |
| `stop` | method | 45 | <code>def stop(self,kill=False):</code> |
| `entrypoint_probe` | function | 51 | <code>def entrypoint_probe(f,folder):</code> |
| `entry_main` | function | 109 | <code>def entry_main():</code> |
| `main` | function | 121 | <code>def main():</code> |

## tests/hyperfide/support/workspace_registration_fixture.py

[Open source](../tests/hyperfide/support/workspace_registration_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 18 | <code>def uid():return str(uuid.uuid4())</code> |
| `private` | function | 19 | <code>def private(path,value):</code> |
| `uid_processes` | function | 21 | <code>def uid_processes(user):</code> |
| `NativeRunner` | class | 33 | <code>class NativeRunner:</code> |
| `__init__` | method | 35 | <code>def __init__(self,base,scope,transport=None):</code> |
| `configure` | method | 47 | <code>def configure(self,transport,name="runner.json"):</code> |
| `unconfigure` | method | 53 | <code>def unconfigure(self):</code> |
| `add_slot` | method | 56 | <code>def add_slot(self,user,credentials=("worker-token",)):</code> |
| `credential` | method | 67 | <code>def credential(self,slot,user,name,data=b"slot-scoped fixture credential"):</code> |
| `credentials` | method | 69 | <code>def credentials(self,slot):</code> |
| `slot_state` | method | 71 | <code>def slot_state(self,slot):</code> |
| `add_launch` | method | 73 | <code>def add_launch(self,slot,launch=None,attempt=None,attempt_generation="1",logs=True):</code> |
| `launch_state` | method | 85 | <code>def launch_state(self,launch):</code> |
| `spawn` | method | 88 | <code>def spawn(self,user,code):</code> |
| `tree` | method | 93 | <code>def tree(self,user,count=2):</code> |
| `wait` | method | 97 | <code>def wait(self,condition,timeout=10):</code> |
| `request` | method | 103 | <code>def request(self,launch,command=None,&#42;&#42;extra):</code> |
| `native` | method | 108 | <code>def native(self,action,request,timeout=120):</code> |
| `control` | method | 117 | <code>def control(self,table,where="",values=()):</code> |
| `close` | method | 120 | <code>def close(self):</code> |

## tests/hyperfide/test_authority_campaign.py

[Open source](../tests/hyperfide/test_authority_campaign.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 15 | <code>def uid(number):</code> |
| `raw_hash` | function | 23 | <code>def raw_hash(raw):</code> |
| `seal_document` | function | 26 | <code>def seal_document(document):</code> |
| `accepted` | function | 32 | <code>def accepted(history, operation, epoch, database):</code> |
| `active` | function | 42 | <code>def active(history):</code> |
| `fixture` | function | 47 | <code>def fixture(mode="RESTORE"):</code> |
| `AuthorityMetadataTests` | class | 97 | <code>class AuthorityMetadataTests(unittest.TestCase):</code> |
| `test_current_contract_modes_are_metadata_only` | method | 98 | <code>def test_current_contract_modes_are_metadata_only(self):</code> |
| `test_restored_database_is_distinct_from_external_head` | method | 106 | <code>def test_restored_database_is_distinct_from_external_head(self):</code> |
| `test_restore_cannot_reconstruct_missing_external_journal` | method | 114 | <code>def test_restore_cannot_reconstruct_missing_external_journal(self):</code> |
| `test_unseen_database_lineage_rejected_even_with_valid_document_seal` | method | 121 | <code>def test_unseen_database_lineage_rejected_even_with_valid_document_seal(self):</code> |
| `test_pending_must_precede_positive_commit_and_publication` | method | 130 | <code>def test_pending_must_precede_positive_commit_and_publication(self):</code> |
| `test_missing_pending_cannot_be_replaced_by_active_head` | method | 137 | <code>def test_missing_pending_cannot_be_replaced_by_active_head(self):</code> |
| `test_resealed_history_cannot_reuse_epoch_or_drop_lineage` | method | 144 | <code>def test_resealed_history_cannot_reuse_epoch_or_drop_lineage(self):</code> |
| `test_sorted_request_hash_cannot_replace_actual_ordered_json_stringify` | method | 155 | <code>def test_sorted_request_hash_cannot_replace_actual_ordered_json_stringify(self):</code> |
| `test_database_predecessor_must_be_observed_revoked` | method | 163 | <code>def test_database_predecessor_must_be_observed_revoked(self):</code> |
| `test_boolean_isolation_and_wrong_operation_are_not_identity` | method | 169 | <code>def test_boolean_isolation_and_wrong_operation_are_not_identity(self):</code> |
| `test_fence_expiry_and_clock_skew_match_primary_milliseconds` | method | 178 | <code>def test_fence_expiry_and_clock_skew_match_primary_milliseconds(self):</code> |
| `test_exact_raw_proof_bytes_are_bound` | method | 184 | <code>def test_exact_raw_proof_bytes_are_bound(self):</code> |
| `test_retained_older_candidate_can_reconcile_positive_commit` | method | 190 | <code>def test_retained_older_candidate_can_reconcile_positive_commit(self):</code> |
| `test_current_attestation_must_match_published_head` | method | 199 | <code>def test_current_attestation_must_match_published_head(self):</code> |
| `test_duplicate_nonfinite_and_invalid_timestamp_refused` | method | 205 | <code>def test_duplicate_nonfinite_and_invalid_timestamp_refused(self):</code> |
| `test_reference_consumes_current_restore_and_fences_old_owner` | method | 213 | <code>def test_reference_consumes_current_restore_and_fences_old_owner(self):</code> |
| `test_current_reference_never_downgrades_missing_journal` | method | 230 | <code>def test_current_reference_never_downgrades_missing_journal(self):</code> |
| `test_fixture_deployment_cannot_rotate_live_reference` | method | 244 | <code>def test_fixture_deployment_cannot_rotate_live_reference(self):</code> |
| `test_original_journal_bytes_and_absence_are_bound` | method | 254 | <code>def test_original_journal_bytes_and_absence_are_bound(self):</code> |
| `test_opaque_unsealed_or_unknown_contract_cannot_pass` | method | 265 | <code>def test_opaque_unsealed_or_unknown_contract_cannot_pass(self):</code> |

## tests/hyperfide/test_inspect_proof.py

[Open source](../tests/hyperfide/test_inspect_proof.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 18 | <code>def sha(raw):</code> |
| `policy` | function | 21 | <code>def policy():</code> |
| `ProofInspectionTests` | class | 26 | <code>class ProofInspectionTests(unittest.TestCase):</code> |
| `setUp` | method | 27 | <code>def setUp(self):</code> |
| `tearDown` | method | 43 | <code>def tearDown(self):</code> |
| `run_inspector` | method | 50 | <code>def run_inspector(self, request=None, full=False, root=None, raw=None, environment=None):</code> |
| `reject` | method | 53 | <code>def reject(self, result):</code> |
| `test_component_inspection_is_not_authority` | method | 59 | <code>def test_component_inspection_is_not_authority(self):</code> |
| `test_component_cannot_satisfy_full` | method | 68 | <code>def test_component_cannot_satisfy_full(self):</code> |
| `test_exact_anchor_and_source` | method | 71 | <code>def test_exact_anchor_and_source(self):</code> |
| `test_case_and_closed_policy_binding` | method | 80 | <code>def test_case_and_closed_policy_binding(self):</code> |
| `test_path_escape_and_symlink` | method | 93 | <code>def test_path_escape_and_symlink(self):</code> |
| `test_duplicate_and_unknown_request_keys` | method | 103 | <code>def test_duplicate_and_unknown_request_keys(self):</code> |
| `test_real_canonical_artifact_tamper` | method | 108 | <code>def test_real_canonical_artifact_tamper(self):</code> |
| `portable` | method | 113 | <code>def portable(self):</code> |
| `test_portable_real_source_and_executable_checks` | method | 140 | <code>def test_portable_real_source_and_executable_checks(self):</code> |
| `test_portable_rejects_missing_map_and_changed_tool` | method | 149 | <code>def test_portable_rejects_missing_map_and_changed_tool(self):</code> |
| `test_portable_rejects_wrong_commit_and_escape` | method | 161 | <code>def test_portable_rejects_wrong_commit_and_escape(self):</code> |
| `test_postcheck_bytes_are_rechecked` | method | 169 | <code>def test_postcheck_bytes_are_rechecked(self):</code> |
| `test_git_filter_configuration_never_executes` | method | 179 | <code>def test_git_filter_configuration_never_executes(self):</code> |
| `test_portable_external_campaign_with_closed_environment` | method | 227 | <code>def test_portable_external_campaign_with_closed_environment(self):</code> |
| `test_portable_checker_preserves_immutable_assets` | method | 237 | <code>def test_portable_checker_preserves_immutable_assets(self):</code> |
| `test_portable_stage_permissions_and_exclusive_lock` | method | 255 | <code>def test_portable_stage_permissions_and_exclusive_lock(self):</code> |

## tests/hyperfide/test_required_artifact_receipts.py

[Open source](../tests/hyperfide/test_required_artifact_receipts.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DefaultCampaignFixture` | class | 11 | <code>class DefaultCampaignFixture(Fixture):</code> |
| `run` | method | 12 | <code>def run(self, &#42;selector, extra=(), runner=None):</code> |
| `RequiredArtifactReceiptTests` | class | 22 | <code>class RequiredArtifactReceiptTests(unittest.TestCase):</code> |
| `setUp` | method | 23 | <code>def setUp(self):</code> |
| `tearDown` | method | 25 | <code>def tearDown(self):</code> |
| `dynamic` | method | 27 | <code>def dynamic(self):</code> |
| `receipt` | method | 37 | <code>def receipt(self, campaign, summary):</code> |
| `required` | method | 39 | <code>def required(self, receipt):</code> |
| `test_two_cases_preserve_distinct_artifact_bytes` | method | 41 | <code>def test_two_cases_preserve_distinct_artifact_bytes(self):</code> |
| `test_tampered_old_snapshot_still_fails` | method | 57 | <code>def test_tampered_old_snapshot_still_fails(self):</code> |
| `test_alias_cannot_redirect_to_another_logical_artifact` | method | 65 | <code>def test_alias_cannot_redirect_to_another_logical_artifact(self):</code> |
| `test_real_cleanup_reference_uses_immutable_absence_evidence` | method | 72 | <code>def test_real_cleanup_reference_uses_immutable_absence_evidence(self):</code> |

## tests/integration/67_sem_types_case.c

[Open source](../tests/integration/67_sem_types_case.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `cg_prep` | function | 5 | <code>sqlite3_stmt &#42;cg_prep(Cg &#42;cg, const char &#42;sql) {</code> |
| `sem_pass_register` | function | 11 | <code>int sem_pass_register(const char &#42;name,int order,SemPassFn fn) {</code> |
| `sql` | function | 15 | <code>static void sql(Cg &#42;cg,const char &#42;statement) {</code> |
| `count` | function | 21 | <code>static int count(Cg &#42;cg,const char &#42;where) {</code> |
| `main` | function | 28 | <code>int main(void) {</code> |

## tests/scale/gen.py

[Open source](../tests/scale/gen.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Lcg` | class | 28 | <code>class Lcg:</code> |
| `__init__` | method | 29 | <code>def __init__(self, seed):</code> |
| `next` | method | 32 | <code>def next(self):</code> |
| `below` | method | 36 | <code>def below(self, n):</code> |
| `plan` | function | 40 | <code>def plan(nfiles):</code> |
| `mdir` | function | 56 | <code>def mdir(mod):</code> |
| `fname` | function | 60 | <code>def fname(lang, i, k):</code> |
| `rel_ts` | function | 64 | <code>def rel_ts(here, t):</code> |
| `render` | function | 74 | <code>def render(lang, i, mod, stem, peers, rng, per_file, nfuncs):</code> |
| `header` | function | 181 | <code>def header(i, stem, nfuncs):</code> |
| `main` | function | 190 | <code>def main():</code> |

## tests/semantic/catalog.py

[Open source](../tests/semantic/catalog.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Case` | class | 12 | <code>class Case:</code> |

## tests/semantic/convergence.py

[Open source](../tests/semantic/convergence.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `git` | function | 30 | <code>def git(root: Path, &#42;args: str) -&gt; str:</code> |
| `write` | function | 37 | <code>def write(root: Path, rel: str, body: str) -&gt; None:</code> |
| `sym_key` | function | 43 | <code>def sym_key(path: str, name: str, kind: str, qualified: str, start: int,</code> |
| `graph_set` | function | 48 | <code>def graph_set(db: sqlite3.Connection, branch: str &#124; None = None) -&gt; dict&#91;str, set&#93;:</code> |
| `snapshot` | function | 174 | <code>def snapshot(root: Path, branch: str &#124; None = None) -&gt; dict&#91;str, set&#93;:</code> |
| `rebuild` | function | 181 | <code>def rebuild(cg: Path, root: Path, work: Path, label: str) -&gt; Path:</code> |
| `compare` | function | 191 | <code>def compare(cg: Path, root: Path, work: Path, label: str,</code> |
| `main` | function | 211 | <code>def main() -&gt; int:</code> |

## tests/semantic/edge_catalog.py

[Open source](../tests/semantic/edge_catalog.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EdgeCase` | class | 13 | <code>class EdgeCase:</code> |

## tests/semantic/frameworks.py

[Open source](../tests/semantic/frameworks.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Framework` | class | 11 | <code>class Framework:</code> |

## tests/semantic/run.py

[Open source](../tests/semantic/run.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `execute` | function | 33 | <code>def execute(cg: Path, root: Path, &#42;args: str) -&gt; subprocess.CompletedProcess:</code> |
| `project` | function | 43 | <code>def project(work: Path, name: str, files: dict&#91;str, str&#93;) -&gt; Path:</code> |
| `database_path` | function | 53 | <code>def database_path(root: Path) -&gt; Path:</code> |
| `db_open` | function | 71 | <code>def db_open(root: Path) -&gt; sqlite3.Connection:</code> |
| `file_coverage` | function | 82 | <code>def file_coverage(db: sqlite3.Connection, path: str) -&gt; dict:</code> |
| `symbol_rows` | function | 100 | <code>def symbol_rows(db: sqlite3.Connection, path: str) -&gt; list&#91;dict&#93;:</code> |
| `route_rows` | function | 111 | <code>def route_rows(db: sqlite3.Connection) -&gt; list&#91;dict&#93;:</code> |
| `edge_rows` | function | 118 | <code>def edge_rows(db: sqlite3.Connection) -&gt; list&#91;dict&#93;:</code> |
| `symbol_line` | function | 139 | <code>def symbol_line(source: str, name: str) -&gt; int:</code> |
| `score_language` | function | 149 | <code>def score_language(cg: Path, work: Path, case) -&gt; dict:</code> |
| `score_edge` | function | 209 | <code>def score_edge(cg: Path, work: Path, case) -&gt; dict:</code> |
| `score_framework` | function | 255 | <code>def score_framework(cg: Path, work: Path, case) -&gt; dict:</code> |
| `ratio` | function | 305 | <code>def ratio(num: int, den: int) -&gt; float &#124; None:</code> |
| `main` | function | 309 | <code>def main() -&gt; int:</code> |

## tests/unit/tap.h

[Open source](../tests/unit/tap.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `TAP_H` | macro | 3 | <code>#define TAP_H</code> |
| `ok` | macro | 10 | <code>#define ok(cond, ...) do { &#92;</code> |
| `ok_str` | macro | 20 | <code>#define ok_str(got, want) do { &#92;</code> |
| `t_done` | function | 30 | <code>static int t_done(const char &#42;name) {</code> |

## tests/unit/test_config.c

[Open source](../tests/unit/test_config.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `project` | function | 12 | <code>static void project(char &#42;out, size_t cap, const char &#42;name, const char &#42;body) {</code> |
| `quiet_load` | function | 25 | <code>static const CgConfig &#42;quiet_load(const char &#42;root) {</code> |
| `main` | function | 37 | <code>int main(void) {</code> |

## tests/unit/test_drivers.c

[Open source](../tests/unit/test_drivers.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Seen` | typedef | 6 | <code>typedef struct {</code> |
| `on` | function | 14 | <code>static void on(const DriverEvent &#42;e, void &#42;ud) {</code> |
| `parse` | function | 30 | <code>static int parse(const char &#42;line, Seen &#42;s) {</code> |
| `joined` | function | 35 | <code>static char &#42;joined(char &#42;&#42;av) {</code> |
| `main` | function | 45 | <code>int main(void) {</code> |

## tests/unit/test_json.c

[Open source](../tests/unit/test_json.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 5 | <code>int main(void) {</code> |

## tests/unit/test_kvx.c

[Open source](../tests/unit/test_kvx.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `write_tmp` | function | 8 | <code>static void write_tmp(const char &#42;content) {</code> |
| `test_parse` | function | 43 | <code>static void test_parse(void) {</code> |
| `test_sort_edge` | function | 126 | <code>static void test_sort_edge(void) {</code> |
| `test_errors` | function | 137 | <code>static void test_errors(void) {</code> |
| `test_set_status` | function | 145 | <code>static void test_set_status(void) {</code> |
| `test_set_string` | function | 182 | <code>static void test_set_string(void) {</code> |
| `main` | function | 251 | <code>int main(void) {</code> |

## tests/unit/test_lang.c

[Open source](../tests/unit/test_lang.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `definition` | function | 5 | <code>static const SymDef &#42;definition(const ParseResult &#42;result, const char &#42;name) {</code> |
| `reference` | function | 12 | <code>static bool reference(const ParseResult &#42;result, const char &#42;name) {</code> |
| `ref_of` | function | 19 | <code>static const SymRef &#42;ref_of(const ParseResult &#42;result, const char &#42;name) {</code> |
| `span_at` | function | 27 | <code>static const CmtDef &#42;span_at(const ParseResult &#42;result, int line) {</code> |
| `import_row` | function | 34 | <code>static bool import_row(const ParseResult &#42;result, const char &#42;name,</code> |
| `system_import` | function | 43 | <code>static bool system_import(const ParseResult &#42;result, const char &#42;module) {</code> |
| `def_count` | function | 51 | <code>static int def_count(const ParseResult &#42;result, const char &#42;name) {</code> |
| `main` | function | 58 | <code>int main(void) {</code> |

## tests/unit/test_sha256.c

[Open source](../tests/unit/test_sha256.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `vec` | function | 5 | <code>static void vec(const char &#42;msg, size_t len, const char &#42;want) {</code> |
| `main` | function | 11 | <code>int main(void) {</code> |

## tests/unit/test_util.c

[Open source](../tests/unit/test_util.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 6 | <code>int main(void) {</code> |
