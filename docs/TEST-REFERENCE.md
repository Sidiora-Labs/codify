# Test and fixture reference

These are test-only graph observations, not supported product APIs or live Hyperfide HTTP endpoints. In particular, the `route` rows under `tests/fixtures/`, such as `GET /api/tasks`, `GET /users` and `POST /users`, come from fixture applications. They test extraction; Hyperfide does not start those applications. The `route` rows under `tests/hyperfide/` and in `tests/semantic/run.py` are not routes at all: route patterns misread dictionary `.get()` calls and path strings in those test scripts.

This baseline was regenerated at revision `e599fbc3` (2026-10-17) of the Hyperfide 2.0 development tree, whose binary reports `hyperfide version` 2.0.0-dev. No generator script exists in the tree, and `hyperfide docs packet` declines to write a packet in this revision. The tables were produced the same way as the [source reference](SOURCE-REFERENCE.md): a read-only query of the index after `hyperfide index`, covering every file that `graph_path_is_test()` in [src/graph.c](../src/graph.c) classifies as a test. `is_entrypoint()` in [src/resolve.c](../src/resolve.c) accepts every symbol in such a file, so all of its indexed symbols are listed. The binary is invoked as `hyperfide`; `cg` remains a deprecated compatibility alias for the same executable.

The baseline contains 4835 observations in 294 files. Source links and line numbers refer to revision `e599fbc3`; rerun the workflow after implementation changes. The declaration column quotes the source line at the indexed location and may be only the first line of a multiline declaration; quotes longer than 200 characters are cut and end in `…`. It is not an inferred behavioral contract.

For shipped modules, see the [source reference](SOURCE-REFERENCE.md). The [testing instructions](../CONTRIBUTING.md#tests) explain how to exercise fixtures in temporary repositories.

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
| `walk` | function | 94 | <code>const walk = (n) =&gt; {</code> |
| `querySelector` | method | 101 | <code>querySelector(sel) { return this.querySelectorAll(sel)&#91;0&#93; &#124;&#124; null; }</code> |
| `dump` | method | 103 | <code>dump(depth) {</code> |
| `doc` | object | 112 | <code>const doc = {</code> |
| `createElement` | method | 116 | <code>createElement(tag) { return new El(tag); },</code> |
| `createTextNode` | method | 117 | <code>createTextNode(t) { const e = new El('#text'); e.textContent = t; return e; },</code> |
| `e` | variable | 117 | <code>createTextNode(t) { const e = new El('#text'); e.textContent = t; return e; },</code> |
| `getElementById` | method | 118 | <code>getElementById(id) { return doc._byId.get(id) &#124;&#124; null; },</code> |
| `addEventListener` | method | 121 | <code>addEventListener(ev, fn) {</code> |
| `dispatch` | method | 124 | <code>dispatch(ev, arg) {</code> |
| `preventDefault` | method | 126 | <code>Object.assign({ preventDefault() {}, target: doc.body }, arg &#124;&#124; {})));</code> |
| `bootstrap` | function | 135 | <code>function bootstrap(ids) {</code> |
| `e` | variable | 140 | <code>const e = new El(id === 'input' ? 'textarea' :</code> |

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
| `ctx` | object | 34 | <code>const ctx = {</code> |
| `acquireVsCodeApi` | action | 35 | <code>acquireVsCodeApi: () =&gt; ({ postMessage: (x) =&gt; posted.push(x) }),</code> |
| `postMessage` | action | 35 | <code>acquireVsCodeApi: () =&gt; ({ postMessage: (x) =&gt; posted.push(x) }),</code> |
| `addEventListener` | action | 37 | <code>window: { addEventListener: (ev, fn) =&gt; { if (ev === 'message') listeners.push(fn); } },</code> |
| `requestAnimationFrame` | action | 38 | <code>requestAnimationFrame: (fn) =&gt; fn(),</code> |
| `setTimeout` | action | 39 | <code>setTimeout: (fn) =&gt; fn,</code> |
| `send` | function | 45 | <code>const send = (msg) =&gt; listeners.forEach((fn) =&gt; fn({ data: msg }));</code> |
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
| `answers` | object | 60 | <code>const answers = { pick: 'allow-once', asked: &#91;&#93; };</code> |
| `rejectPath` | function | 148 | <code>async function rejectPath() {</code> |
| `answers` | object | 152 | <code>const answers = { pick: 'reject-once', asked: &#91;&#93; };</code> |
| `cancelPath` | function | 171 | <code>async function cancelPath() {</code> |
| `versionMismatch` | function | 193 | <code>async function versionMismatch() {</code> |
| `spawnFailure` | function | 204 | <code>async function spawnFailure() {</code> |
| `c` | variable | 206 | <code>const c = new AcpClient({ command: path.join(TMP, 'no-such-agent-binary') });</code> |
| `malformedFrame` | function | 213 | <code>async function malformedFrame() {</code> |
| `agentDeath` | function | 228 | <code>async function agentDeath() {</code> |
| `bridgeSanity` | function | 243 | <code>function bridgeSanity() {</code> |
| `splitSanity` | function | 271 | <code>function splitSanity() {</code> |
| `adapterCommandSanity` | function | 279 | <code>function adapterCommandSanity() {</code> |
| `updateMappingSanity` | function | 300 | <code>function updateMappingSanity() {</code> |
| `postMessage` | action | 303 | <code>const sess = { webview: { postMessage: (m) =&gt; shown.push(m) },</code> |
| `sess` | object | 303 | <code>const sess = { webview: { postMessage: (m) =&gt; shown.push(m) },</code> |
| `emit` | function | 306 | <code>const emit = (update) =&gt; sessionUpdate(sess, { sessionId: 's', update });</code> |
| `harnessTextSanity` | function | 323 | <code>function harnessTextSanity() {</code> |
| `postMessage` | action | 340 | <code>const sess = { webview: { postMessage: (m) =&gt; shown.push(m) }, localEcho: '',</code> |
| `sess` | object | 340 | <code>const sess = { webview: { postMessage: (m) =&gt; shown.push(m) }, localEcho: '',</code> |
| `chatCoreSanity` | function | 354 | <code>async function chatCoreSanity() {</code> |
| `chat` | variable | 379 | <code>const chat = new AgentPanel((m) =&gt; posted.push(m));</code> |

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
| `GET /api/tasks` | route | 12 | <code>app.get('/api/tasks', handle);</code> |

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
| `language` | variable | 1030 | <code>static const TSLanguage language = {</code> |

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
| `span` | variable | 29 | <code>SemSpan span = { .line = 2, .column = 2, .end_line = 2,</code> |
| `JSON` | variable | 37 | <code>static const AstAdapter JSON = { "runtime_fixture", tree_sitter_json, extract };</code> |
| `extract_recovery` | function | 38 | <code>static void extract_recovery(AstContext &#42;ctx) {</code> |
| `RECOVERY` | variable | 41 | <code>static const AstAdapter RECOVERY = {</code> |
| `extract_file_only` | function | 44 | <code>static void extract_file_only(AstContext &#42;ctx) {</code> |
| `FILE_ONLY` | variable | 48 | <code>static const AstAdapter FILE_ONLY = {</code> |
| `run_parse` | function | 52 | <code>static void &#42;run_parse(void &#42;unused) {</code> |
| `result` | variable | 55 | <code>ParseResult result = {0};</code> |
| `main` | function | 67 | <code>int main(void) {</code> |
| `file_only_fallback` | variable | 74 | <code>ParseResult file_only_fallback = {0};</code> |
| `wide_result` | variable | 96 | <code>ParseResult wide_result = {0};</code> |
| `result` | variable | 106 | <code>ParseResult result = {0};</code> |

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
| `GET /users` | route | 21 | <code>app.get("/users", getUsers);</code> |
| `POST /users` | route | 22 | <code>app.post("/users", createUser);</code> |

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
| `GET /ping` | route | 2 | <code>app.get('/ping', ping);</code> |

## tests/fixtures/semantic/dispatch/Bridge.java

[Open source](../tests/fixtures/semantic/dispatch/Bridge.java)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Bridge` | class | 1 | <code>class Bridge {</code> |
| `nativeOpen` | method | 2 | <code>native int nativeOpen();</code> |
| `run` | method | 3 | <code>int run() { return nativeOpen(); }</code> |

## tests/fixtures/semantic/dispatch/Flow.dfm

[Open source](../tests/fixtures/semantic/dispatch/Flow.dfm)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MainForm` | component | 1 | <code>object MainForm: TFlow</code> |
| `SaveButton` | component | 2 | <code>object SaveButton: TButton</code> |

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
| `cg` | variable | 47 | <code>Cg cg={0};assert(sqlite3_open(":memory:",&amp;cg.db)==SQLITE_OK);cg.branch_id=1;</code> |

## tests/fixtures/semantic/dispatch/native.c

[Open source](../tests/fixtures/semantic/dispatch/native.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Callback` | typedef | 1 | <code>typedef int (&#42;Callback)(int);</code> |
| `Ops` | struct | 2 | <code>struct Ops { Callback run; };</code> |
| `increment` | function | 3 | <code>int increment(int x) { return x + 1; }</code> |
| `ops` | variable | 4 | <code>static struct Ops ops = { .run = increment };</code> |
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
| `nested` | function | 14 | <code>def nested(item):</code> |
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
| `cases` | variable | 51 | <code>static const Case cases&#91;&#93; = {</code> |
| `result` | variable | 66 | <code>ParseResult result={0};</code> |
| `wide_result` | variable | 117 | <code>ParseResult wide_result={0};</code> |

## tests/fixtures/semantic/extended/sample.erl

[Open source](../tests/fixtures/semantic/extended/sample.erl)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sample` | module | 1 | <code>-module(sample).</code> |
| `state` | record | 2 | <code>-record(state, {value}).</code> |
| `launch` | function | 3 | <code>launch(X) -&gt; run(X).</code> |
| `str` | function | 5 | <code>str() -&gt; "fake()".</code> |

## tests/fixtures/semantic/extended/sample.lua

[Open source](../tests/fixtures/semantic/extended/sample.lua)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 1 | <code>local function launch(x)</code> |
| `value` | variable | 4 | <code>local value = launch(1)</code> |
| `txt` | variable | 6 | <code>local txt = 'fake()'</code> |

## tests/fixtures/semantic/extended/sample.luau

[Open source](../tests/fixtures/semantic/extended/sample.luau)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 1 | <code>local function launch(x: number): number</code> |
| `value` | variable | 4 | <code>local value = launch(1)</code> |
| `txt` | variable | 6 | <code>local txt = 'fake()'</code> |

## tests/fixtures/semantic/extended/sample.nix

[Open source](../tests/fixtures/semantic/extended/sample.nix)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 2 | <code>launch = x: run x;</code> |
| `value` | attribute | 3 | <code>value = launch 1;</code> |
| `txt` | attribute | 5 | <code>txt = "fake()";</code> |
| `v16_edge_target` | attribute | 6 | <code>v16_edge_target = 1;</code> |
| `v16_edge_caller` | attribute | 7 | <code>v16_edge_caller = v16_edge_target;</code> |
| `v16_edge_unrelated` | attribute | 8 | <code>v16_edge_unrelated = 0; # v16_edge_target</code> |

## tests/fixtures/semantic/extended/sample.r

[Open source](../tests/fixtures/semantic/extended/sample.r)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `launch` | function | 1 | <code>launch &lt;- function(x) {</code> |
| `value` | variable | 4 | <code>value &lt;- launch(1)</code> |
| `txt` | variable | 6 | <code>txt &lt;- 'fake()'</code> |

## tests/fixtures/semantic/extended/sample.sol

[Open source](../tests/fixtures/semantic/extended/sample.sol)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Ledger` | contract | 1 | <code>contract Ledger {</code> |
| `Updated` | event | 2 | <code>event Updated(uint value);</code> |
| `launch` | function | 3 | <code>function launch(uint x) public { run(x); }</code> |
| `run` | function | 4 | <code>function run(uint x) internal {}</code> |
| `txt` | variable | 6 | <code>string private txt = "fake()";</code> |

## tests/fixtures/semantic/extended/sample.tf

[Open source](../tests/fixtures/semantic/extended/sample.tf)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `local_file` | block | 1 | <code>resource "local_file" "output" {</code> |
| `filename` | attribute | 2 | <code>filename = var.path</code> |
| `content` | attribute | 3 | <code>content = format("%s", var.name)</code> |
| `note` | attribute | 5 | <code>note = "fake()"</code> |
| `null_resource` | block | 7 | <code>resource "null_resource" "v16_edge_target" {}</code> |
| `null_resource` | block | 8 | <code>resource "null_resource" "v16_edge_caller" {</code> |
| `depends_on` | attribute | 9 | <code>depends_on = &#91;null_resource.v16_edge_target&#93;</code> |
| `null_resource` | block | 11 | <code>resource "null_resource" "v16_edge_unrelated" {</code> |

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
| `r` | variable | 19 | <code>ParseResult r = {0};</code> |
| `overload_keys` | variable | 26 | <code>const char &#42;overload_keys&#91;2&#93; = {0};</code> |
| `partial` | variable | 109 | <code>ParseResult partial = {0};</code> |
| `check_namespace` | function | 121 | <code>static void check_namespace(const char &#42;lang, const char &#42;source) {</code> |
| `r` | variable | 122 | <code>ParseResult r = {0};</code> |
| `check_java_wildcard` | function | 138 | <code>static void check_java_wildcard(void) {</code> |
| `r` | variable | 140 | <code>ParseResult r = {0};</code> |
| `check_wide_syntax` | function | 150 | <code>static void check_wide_syntax(void) {</code> |
| `r` | variable | 159 | <code>ParseResult r = {0};</code> |
| `main` | function | 175 | <code>int main(int argc, char &#42;&#42;argv) {</code> |
| `names` | variable | 180 | <code>const char &#42;names&#91;&#93; = {"java", "kotlin", "scala", "csharp", "swift", "dart"};</code> |
| `exts` | variable | 181 | <code>const char &#42;exts&#91;&#93; = {"java", "kt", "scala", "cs", "swift", "dart"};</code> |

## tests/fixtures/semantic/mixed/Ambiguous.xml

[Open source](../tests/fixtures/semantic/mixed/Ambiguous.xml)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `site.Ambiguous` | mapper | 1 | <code>&lt;mapper namespace="site.Ambiguous"&gt;</code> |
| `fragment` | statement | 2 | <code>&lt;sql id="fragment"&gt;A&lt;/sql&gt;</code> |
| `fragment` | statement | 3 | <code>&lt;sql id="fragment"&gt;B&lt;/sql&gt;</code> |
| `caller` | statement | 4 | <code>&lt;select id="caller"&gt;&lt;include refid="fragment" /&gt;&lt;/select&gt;</code> |

## tests/fixtures/semantic/mixed/Bare.cfc

[Open source](../tests/fixtures/semantic/mixed/Bare.cfc)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `bare` | function | 2 | <code>function bare() { return 1; }</code> |

## tests/fixtures/semantic/mixed/Mapper.xml

[Open source](../tests/fixtures/semantic/mixed/Mapper.xml)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `site.Mapper` | mapper | 1 | <code>&lt;mapper namespace="site.Mapper"&gt;</code> |
| `fragment` | statement | 2 | <code>&lt;sql id="fragment"&gt;SELECT 1&lt;/sql&gt;</code> |
| `find` | statement | 3 | <code>&lt;select id="find"&gt;&lt;include refid="fragment" /&gt;&lt;/select&gt;</code> |

## tests/fixtures/semantic/mixed/Sample.astro

[Open source](../tests/fixtures/semantic/mixed/Sample.astro)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `front` | function | 2 | <code>export function front() { return 1; }</code> |

## tests/fixtures/semantic/mixed/Sample.cfm

[Open source](../tests/fixtures/semantic/mixed/Sample.cfm)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Worker` | component | 1 | <code>&lt;cfcomponent name="Worker"&gt;</code> |
| `target` | function | 2 | <code>&lt;cffunction name="target"&gt;&lt;cfreturn 1&gt;&lt;/cffunction&gt;</code> |
| `cacheResult` | query | 3 | <code>&lt;cffunction name="run"&gt;&lt;cfreturn target()&gt;&lt;cfquery name="cacheResult"&gt;SELECT &#42; FROM users&lt;/cfquery&gt;&lt;/cffunction&gt;</code> |
| `run` | function | 3 | <code>&lt;cffunction name="run"&gt;&lt;cfreturn target()&gt;&lt;cfquery name="cacheResult"&gt;SELECT &#42; FROM users&lt;/cfquery&gt;&lt;/cffunction&gt;</code> |
| `fetch` | function | 4 | <code>&lt;cffunction name="fetch"&gt;&lt;cfquery name="other"&gt;SELECT &#42; FROM cacheResult&lt;/cfquery&gt;&lt;/cffunction&gt;</code> |
| `other` | query | 4 | <code>&lt;cffunction name="fetch"&gt;&lt;cfquery name="other"&gt;SELECT &#42; FROM cacheResult&lt;/cfquery&gt;&lt;/cffunction&gt;</code> |

## tests/fixtures/semantic/mixed/Sample.dfm

[Open source](../tests/fixtures/semantic/mixed/Sample.dfm)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MainForm` | component | 1 | <code>object MainForm: TMainForm</code> |
| `Button1` | component | 2 | <code>object Button1: TButton</code> |

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

## tests/fixtures/semantic/mixed/sample.cbl

[Open source](../tests/fixtures/semantic/mixed/sample.cbl)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HELLO` | program | 2 | <code>PROGRAM-ID. HELLO.</code> |
| `MAIN-PARA` | paragraph | 4 | <code>MAIN-PARA.</code> |
| `WORK-PARA` | paragraph | 7 | <code>WORK-PARA.</code> |

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
| `GET /express/items` | route | 2 | <code>app.get('/express/items', listItems);</code> |
| `POST /express/multiline` | route | 3 | <code>app.post(</code> |
| `PUT /express/long` | route | 7 | <code>app.put(</code> |
| `GET /express/unknown` | route | 23 | <code>app.get('/express/unknown', missingHandler);</code> |
| `GET /express/duplicate` | route | 24 | <code>app.get('/express/duplicate', listItems);</code> |
| `GET /express/duplicate` | route | 25 | <code>app.get('/express/duplicate', missingHandler);</code> |
| `DYNAMIC /dynamic/${id}` | route | 28 | <code>app.get(&#96;/dynamic/${id}&#96;, listItems);</code> |
| `GET /child` | route | 29 | <code>router.get('/child', listItems);</code> |
| `MOUNT /mounted` | route | 30 | <code>app.use('/mounted', router);</code> |

## tests/fixtures/semantic/routes/api.py

[Open source](../tests/fixtures/semantic/routes/api.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `list_items` | function | 1 | <code>def list_items():</code> |
| `GET /fastapi/items` | route | 4 | <code>app.get('/fastapi/items', list_items)</code> |
| `POST /fastapi/multiline` | route | 5 | <code>@app.post(</code> |
| `multiline` | function | 8 | <code>def multiline():</code> |
| `GET /fastapi/missing` | route | 10 | <code>app.get('/fastapi/missing', missing_handler)</code> |

## tests/fixtures/semantic/routes/app/orders/route.ts

[Open source](../tests/fixtures/semantic/routes/app/orders/route.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET` | function | 1 | <code>export function GET() { return new Response('ok'); }</code> |
| `GET /orders` | route | 1 | <code>export function GET() { return new Response('ok'); }</code> |
| `POST` | function | 2 | <code>export async function POST() { return new Response('created'); }</code> |
| `POST /orders` | route | 2 | <code>export async function POST() { return new Response('created'); }</code> |

## tests/fixtures/semantic/routes/app/profile/index.tsx

[Open source](../tests/fixtures/semantic/routes/app/profile/index.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PAGE /profile` | route | 1 | <code>export default function Profile() { return &lt;p&gt;Profile&lt;/p&gt;; }</code> |
| `Profile` | function | 1 | <code>export default function Profile() { return &lt;p&gt;Profile&lt;/p&gt;; }</code> |

## tests/fixtures/semantic/routes/app/report.tsx

[Open source](../tests/fixtures/semantic/routes/app/report.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PAGE /report` | route | 1 | <code>export default function reportHandler() { return null; }</code> |
| `reportHandler` | function | 1 | <code>export default function reportHandler() { return null; }</code> |

## tests/fixtures/semantic/routes/pages/account.vue

[Open source](../tests/fixtures/semantic/routes/pages/account.vue)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PAGE /account` | route | 1 | <code>&lt;template&gt;&lt;h1&gt;Account&lt;/h1&gt;&lt;/template&gt;</code> |

## tests/fixtures/semantic/routes/pages/api/items.ts

[Open source](../tests/fixtures/semantic/routes/pages/api/items.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `* /api/items` | route | 1 | <code>export default function handler(req, res) { return res.json(&#91;&#93;); }</code> |
| `handler` | function | 1 | <code>export default function handler(req, res) { return res.json(&#91;&#93;); }</code> |

## tests/fixtures/semantic/routes/server/api/widgets.get.ts

[Open source](../tests/fixtures/semantic/routes/server/api/widgets.get.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET /api/widgets` | route | 1 | <code>export default function handler() { return { widgets: &#91;&#93; }; }</code> |
| `handler` | function | 1 | <code>export default function handler() { return { widgets: &#91;&#93; }; }</code> |

## tests/fixtures/semantic/routes/src/Api.cs

[Open source](../tests/fixtures/semantic/routes/src/Api.cs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Api` | class | 1 | <code>class Api {</code> |
| `GET /asp/home` | route | 2 | <code>&#91;HttpGet("/asp/home")&#93;</code> |
| `Home` | method | 2 | <code>&#91;HttpGet("/asp/home")&#93;</code> |

## tests/fixtures/semantic/routes/src/Handler.java

[Open source](../tests/fixtures/semantic/routes/src/Handler.java)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Handler` | class | 1 | <code>class Handler {</code> |
| `GET /spring/home` | route | 2 | <code>@GetMapping("/spring/home")</code> |
| `home` | method | 2 | <code>@GetMapping("/spring/home")</code> |
| `POST /spring/multiline` | route | 4 | <code>@PostMapping(</code> |
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
| `GET /gin/list` | route | 3 | <code>func register(r &#42;Engine) { r.GET("/gin/list", list) }</code> |
| `register` | function | 3 | <code>func register(r &#42;Engine) { r.GET("/gin/list", list) }</code> |
| `registerMore` | function | 4 | <code>func registerMore(r &#42;Engine) {</code> |
| `POST /gin/multiline` | route | 5 | <code>r.POST(</code> |

## tests/fixtures/semantic/routes/src/api.rs

[Open source](../tests/fixtures/semantic/routes/src/api.rs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `list` | function | 1 | <code>fn list() {}</code> |
| `GET /axum/list` | route | 2 | <code>fn router(app: Router) { app.route("/axum/list", get(list)); }</code> |
| `router` | function | 2 | <code>fn router(app: Router) { app.route("/axum/list", get(list)); }</code> |

## tests/fixtures/semantic/routes/src/api.swift

[Open source](../tests/fixtures/semantic/routes/src/api.swift)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `show` | function | 1 | <code>func show(req: Request) -&gt; String { return "ok" }</code> |
| `GET /vapor/show` | route | 2 | <code>app.get("/vapor/show", use: show)</code> |

## tests/fixtures/semantic/routes/src/flask.py

[Open source](../tests/fixtures/semantic/routes/src/flask.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET /flask/ping` | route | 1 | <code>@app.route('/flask/ping')</code> |
| `ping` | function | 2 | <code>def ping():</code> |

## tests/fixtures/semantic/routes/src/flask_get.py

[Open source](../tests/fixtures/semantic/routes/src/flask_get.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET /flask/get` | route | 3 | <code>@app.get('/flask/get')</code> |
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
| `NAV /react/page` | route | 3 | <code>&lt;Link to="/react/page"/&gt;</code> |
| `NAV /profile` | route | 4 | <code>&lt;Link href="/profile"/&gt;</code> |

## tests/fixtures/semantic/routes/src/router.tsx

[Open source](../tests/fixtures/semantic/routes/src/router.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Page` | function | 1 | <code>function Page() { return &lt;p&gt;Page&lt;/p&gt;; }</code> |
| `PAGE /react/page` | route | 2 | <code>const tree = &lt;Route path="/react/page" element={&lt;Page /&gt;} /&gt;;</code> |

## tests/fixtures/semantic/routes/src/router_object.tsx

[Open source](../tests/fixtures/semantic/routes/src/router_object.tsx)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RouteObjectHandler` | function | 1 | <code>function RouteObjectHandler() { return &lt;p&gt;ok&lt;/p&gt;; }</code> |
| `PAGE /react/object` | route | 2 | <code>const router = createBrowserRouter(&#91;{ path: '/react/object', element: &lt;RouteObjectHandler /&gt; }&#93;);</code> |

## tests/fixtures/semantic/routes/src/routes.rb

[Open source](../tests/fixtures/semantic/routes/src/routes.rb)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET /rails/home` | route | 1 | <code>get '/rails/home', to: 'home#index'</code> |

## tests/fixtures/semantic/routes/src/routes/notes/+server.ts

[Open source](../tests/fixtures/semantic/routes/src/routes/notes/+server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET` | function | 1 | <code>export function GET() { return new Response('ok'); }</code> |
| `GET /notes` | route | 1 | <code>export function GET() { return new Response('ok'); }</code> |

## tests/fixtures/semantic/routes/src/routes/report/+page.server.ts

[Open source](../tests/fixtures/semantic/routes/src/routes/report/+page.server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `PAGE /report` | route | 1 | <code>export function load() { return { ok: true }; }</code> |
| `load` | function | 1 | <code>export function load() { return { ok: true }; }</code> |

## tests/fixtures/semantic/routes/src/rust_lifetime.rs

[Open source](../tests/fixtures/semantic/routes/src/rust_lifetime.rs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `lifetimeHandler` | function | 2 | <code>async fn lifetimeHandler() -&gt; &amp;'static str { "ok" }</code> |
| `router` | function | 3 | <code>fn router() -&gt; Router {</code> |
| `GET /rust/lifetime` | route | 4 | <code>Router::new().route("/rust/lifetime", get(lifetimeHandler))</code> |

## tests/fixtures/semantic/routes/src/urls.py

[Open source](../tests/fixtures/semantic/routes/src/urls.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `show` | function | 1 | <code>def show(request):</code> |
| `* /django/show` | route | 4 | <code>urlpatterns = &#91;path('django/show', show)&#93;</code> |

## tests/fixtures/semantic/routes/src/vue-router.ts

[Open source](../tests/fixtures/semantic/routes/src/vue-router.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Account` | function | 1 | <code>function Account() { return null; }</code> |
| `PAGE /vue/account` | route | 2 | <code>const routes = &#91;{ path: '/vue/account', component: Account }&#93;;</code> |

## tests/fixtures/semantic/routes/src/web.php

[Open source](../tests/fixtures/semantic/routes/src/web.php)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GET /laravel/home` | route | 2 | <code>Route::get('/laravel/home', &#91;HomeController::class, 'index'&#93;);</code> |

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
| `ops` | variable | 14 | <code>static struct Ops ops = { .run = increment };</code> |
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
| `Worker` | impl | 6 | <code>impl Runner for Worker {</code> |
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
| `panel` | variable | 49 | <code>const panel: Panel&lt;string&gt; = new Panel&lt;string&gt;();</code> |
| `actions` | object | 50 | <code>const actions = { save: () =&gt; load(props.id), cancel() { setCount(0); } };</code> |
| `cancel` | method | 50 | <code>const actions = { save: () =&gt; load(props.id), cancel() { setCount(0); } };</code> |
| `save` | action | 50 | <code>const actions = { save: () =&gt; load(props.id), cancel() { setCount(0); } };</code> |

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
| `actions` | object | 3 | <code>const actions = {</code> |
| `open` | action | 4 | <code>open: () =&gt; Widget.open(item),</code> |
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
| `pairs` | function | 73 | <code>def pairs(items):</code> |
| `constant` | function | 79 | <code>def constant(_value):</code> |
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
| `inject` | function | 650 | <code>def inject(fault, kind, &#42;&#42;fields):</code> |
| `cost` | function | 671 | <code>def cost(base_us):</code> |
| `check_invariants` | function | 757 | <code>def check_invariants(events, state, profile, faults=()):</code> |
| `nearest_rank` | function | 766 | <code>def nearest_rank(samples, fraction):</code> |
| `simulated_metrics` | function | 770 | <code>def simulated_metrics(summary, state, virtual_ms):</code> |
| `ms` | function | 775 | <code>def ms(value):</code> |
| `sweep_points` | function | 786 | <code>def sweep_points(dimensions=SWEEP_DIMENSIONS):</code> |
| `sweep` | function | 791 | <code>def sweep(profile, seed, dimensions=SWEEP_DIMENSIONS):</code> |
| `fault_combinations` | function | 802 | <code>def fault_combinations(seed, extra=4):</code> |
| `replay_faults` | function | 809 | <code>def replay_faults(profile, seed, combinations=None):</code> |
| `simulate` | function | 819 | <code>def simulate(profile, seeds):</code> |
| `compare_metrics` | function | 837 | <code>def compare_metrics(current, baseline):</code> |
| `number` | function | 850 | <code>def number(value):</code> |
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
| `call` | function | 118 | <code>def call(side, check):</code> |
| `harness` | function | 155 | <code>def harness(name, passed, &#42;&#42;detail):</code> |
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
| `valid` | function | 91 | <code>def valid():</code> |
| `overlays` | function | 96 | <code>def overlays():</code> |
| `measured` | function | 103 | <code>def measured():</code> |
| `symlink` | function | 115 | <code>def symlink(w):(w/"link").unlink();(w/"link").symlink_to("untracked.bin")</code> |
| `hardlink` | function | 120 | <code>def hardlink(w):os.link(w/"tracked.bin",w/"extra-link")</code> |
| `invalid_header` | function | 126 | <code>def invalid_header():</code> |
| `unchanged` | function | 131 | <code>def unchanged():</code> |
| `no_monitor` | function | 136 | <code>def no_monitor():</code> |
| `include` | function | 145 | <code>def include(w):</code> |
| `worktree_config` | function | 150 | <code>def worktree_config(w,kind):</code> |

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
| `setup` | function | 84 | <code>def setup():</code> |
| `routes` | function | 92 | <code>def routes():</code> |
| `annotations` | function | 107 | <code>def annotations():</code> |
| `callers` | function | 115 | <code>def callers():</code> |
| `ranking` | function | 123 | <code>def ranking():</code> |
| `declared` | function | 141 | <code>def declared():</code> |
| `unicode_trigram` | function | 153 | <code>def unicode_trigram():</code> |
| `corpus` | function | 162 | <code>def corpus(h):</code> |
| `setup` | function | 166 | <code>def setup():</code> |
| `facts` | function | 185 | <code>def facts():</code> |
| `callers` | function | 196 | <code>def callers():</code> |
| `search` | function | 207 | <code>def search():</code> |
| `trigram` | function | 219 | <code>def trigram():</code> |
| `changes` | function | 232 | <code>def changes():</code> |
| `migration` | function | 243 | <code>def migration(h):</code> |
| `applied` | function | 249 | <code>def applied():</code> |
| `interrupted` | function | 260 | <code>def interrupted():</code> |
| `incomplete_snapshot` | function | 274 | <code>def incomplete_snapshot():</code> |
| `legacy_syntax` | function | 283 | <code>def legacy_syntax():</code> |

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
| `setup` | function | 135 | <code>def setup():</code> |
| `q` | function | 144 | <code>def q(action,&#42;&#42;kw):return h.ok(action,repository_id=repo.id,&#42;&#42;kw)</code> |
| `classification` | function | 145 | <code>def classification():</code> |
| `equivalence` | function | 153 | <code>def equivalence():</code> |
| `legacy_incremental` | function | 161 | <code>def legacy_incremental():</code> |
| `stale_facts` | function | 169 | <code>def stale_facts():</code> |
| `configuration` | function | 177 | <code>def configuration():</code> |
| `failed_parse` | function | 191 | <code>def failed_parse():</code> |
| `branch_projection` | function | 209 | <code>def branch_projection():</code> |
| `rebase` | function | 221 | <code>def rebase():</code> |

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
| `identity` | function | 51 | <code>def identity():</code> |
| `lag` | function | 66 | <code>def lag():</code> |
| `resume` | function | 88 | <code>def resume():time.sleep(.6);standby(h,"SELECT pg_wal_replay_resume()")</code> |
| `cache` | function | 96 | <code>def cache():</code> |
| `eviction` | function | 110 | <code>def eviction():</code> |
| `disconnected` | function | 123 | <code>def disconnected():</code> |
| `unavailable` | function | 139 | <code>def unavailable():</code> |
| `privilege` | function | 152 | <code>def privilege():</code> |
| `percentiles` | function | 163 | <code>def percentiles(values):</code> |
| `mixed_load` | function | 173 | <code>def mixed_load(h,seconds=30):</code> |
| `amplification` | function | 186 | <code>def amplification():</code> |
| `baseline` | function | 202 | <code>def baseline():</code> |
| `load` | function | 210 | <code>def load():</code> |
| `reader` | function | 213 | <code>def reader(name):</code> |
| `writer` | function | 221 | <code>def writer():</code> |
| `sampler` | function | 229 | <code>def sampler():</code> |
| `invariants` | function | 258 | <code>def invariants():</code> |

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
| `interrupt` | function | 121 | <code>def interrupt(&#42;unused):raise InterruptedError('Owned fixture cancelled; cleanup required')</code> |
| `save` | function | 123 | <code>def save(name,value):</code> |
| `invoke` | function | 127 | <code>def invoke(mode,url,&#42;&#42;kw):</code> |
| `inventory` | function | 137 | <code>def inventory(update=None):</code> |
| `effect` | function | 142 | <code>def effect(url,intent,ref):</code> |
| `reconcile` | function | 145 | <code>def reconcile(url,current_epoch,stale_epochs):</code> |

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
| `case` | function | 85 | <code>def case(name,fn):</code> |
| `deterministic` | function | 92 | <code>def deterministic(f):expect(f.plan()==f.plan())</code> |
| `bad` | function | 99 | <code>def bad(f,key=key,value=value,code=code):p=f.plan_input();p&#91;"image"&#93;&#91;key&#93;=value;f.reject("plan",p,code)</code> |
| `memory` | function | 101 | <code>def memory(f):p=f.plan_input();p&#91;"storage"&#93;&#91;"overlay_bytes"&#93;="4294967296";f.reject("plan",p,"IMAGE_STORAGE_UNSATISFIED")</code> |
| `headroom` | function | 103 | <code>def headroom(f):p=f.plan_input();p&#91;"storage"&#93;&#91;"writable_paths"&#93;&#91;0&#93;&#91;"required_bytes"&#93;="67108864";f.reject("plan",p,"IMAGE_STORAGE_UNSATISFIED")</code> |
| `overlap` | function | 105 | <code>def overlap(f):p=f.plan_input();p&#91;"storage"&#93;&#91;"writable_paths"&#93;&#91;1&#93;&#91;"path"&#93;="/work/one/child";f.reject("plan",p,"IMAGE_STORAGE_UNSATISFIED")</code> |
| `noncanonical` | function | 107 | <code>def noncanonical(f):p=f.plan_input();p&#91;"storage"&#93;&#91;"overlay_bytes"&#93;="01";f.reject("plan",p,"BLAXEL_IMAGE_INVALID")</code> |
| `mount` | function | 109 | <code>def mount(f):p=f.plan_input();p&#91;"storage"&#93;&#91;"volume"&#93;={"reference":"fixture-v1","mount_path":"/opt/hyperfide/prepared","size_bytes":"1073741824","template_revision":"r1","template_path":"empty"};f.reje…</code> |
| `drift` | function | 111 | <code>def drift(f):p=f.plan_input();(f.candidate/"recipe.sh").write_text("changed");f.reject("plan",p,"PREPARATION_MISMATCH")</code> |
| `tamper` | function | 113 | <code>def tamper(f):p=f.plan();p&#91;"recipe"&#93;&#91;"dockerfile"&#93;+="RUN malicious&#92;n";f.reject("inspect",f.inspect_input(p),"PREPARATION_MISMATCH")</code> |
| `secret` | function | 115 | <code>def secret(f):q=f.plan_input();(f.candidate/"payload").write_text(up.SECRET);f.reject("plan",q,"PREPARATION_MISMATCH")</code> |
| `local` | function | 117 | <code>def local(f):</code> |
| `content_drift` | function | 120 | <code>def content_drift(f):p=f.plan();f.published();(f.runtime/"opt/hyperfide/prepared/recipe.sh").write_text("different");f.reject("inspect",f.inspect_input(p),"PREPARATION_MISMATCH")</code> |
| `wrong_tool` | function | 122 | <code>def wrong_tool(f):f.profile&#91;"toolchains"&#93;&#91;0&#93;&#91;"version"&#93;="0.0.1";p=f.plan();f.published();f.reject("inspect",f.inspect_input(p),"IMAGE_TOOL_MISMATCH")</code> |
| `missing_api` | function | 124 | <code>def missing_api(f):p=f.plan();f.published();f.reject("inspect",f.inspect_input(p),"IMAGE_TOOL_MISMATCH",{"HF_BLAXEL_PROBE_API_PORT":"1"})</code> |
| `missing_compiler` | function | 126 | <code>def missing_compiler(f):p=f.plan();f.published();f.reject("inspect",f.inspect_input(p),"IMAGE_TOOL_MISMATCH",{"HF_BLAXEL_PROBE_PATH":str(tools)})</code> |
| `package` | function | 128 | <code>def package(f):</code> |
| `missing_package` | function | 135 | <code>def missing_package(f):q=f.plan_input();q&#91;"probe_requirements"&#93;&#91;"packages"&#93;=&#91;{"ecosystem":"node","name":"missing-hyperfide-fixture","version":"1.0.0"}&#93;;p=f.plan(q);f.published();f.reject("inspect",f.i…</code> |
| `no_live` | function | 137 | <code>def no_live(f):p=f.plan();q=f.inspect_input(p);q&#91;"sandbox_reference"&#93;="fixture";f.reject("inspect",q,"BLAXEL_CREDENTIALS_UNAVAILABLE",{"HF_BLAXEL_PROBE_TRANSPORT":"blaxel"})</code> |
| `spoof_live` | function | 139 | <code>def spoof_live(f):p=f.plan();q=f.inspect_input(p);q&#91;"sandbox_reference"&#93;="pretend-live";f.reject("inspect",q,"BLAXEL_IMAGE_INVALID")</code> |
| `omitted_probe` | function | 141 | <code>def omitted_probe(f):p=f.plan();q=f.inspect_input(p);q&#91;"tools"&#93;=&#91;&#93;;f.reject("inspect",q,"BLAXEL_IMAGE_INVALID")</code> |
| `symlink` | function | 143 | <code>def symlink(f):p=f.plan();f.published();shutil.rmtree(f.runtime/"work/two");(f.runtime/"work/two").symlink_to(f.runtime/"work/one",target_is_directory=True);f.reject("inspect",f.inspect_input(p),"IMAG…</code> |
| `expiry` | function | 145 | <code>def expiry(f):p=f.plan();p&#91;"manifest"&#93;&#91;"profile"&#93;&#91;"policy"&#93;&#91;"expires_at"&#93;="2000-01-01T00:00:00.000Z";f.reject("inspect",f.inspect_input(p),"PREPARATION_MISMATCH")</code> |
| `operation` | function | 147 | <code>def operation(f,plan):</code> |
| `publisher` | function | 152 | <code>def publisher(f,delay=False,bad_hash=False):</code> |
| `no_publish_credentials` | function | 167 | <code>def no_publish_credentials(f):</code> |
| `template_link` | function | 170 | <code>def template_link(f,hard=False):</code> |
| `volume_plan` | function | 180 | <code>def volume_plan(f):</code> |
| `escaped_descendant` | function | 184 | <code>def escaped_descendant(f):</code> |
| `supervisor_error` | function | 196 | <code>def supervisor_error(f):</code> |
| `supervisor_override` | function | 200 | <code>def supervisor_override(f,kind):</code> |
| `isolated_python` | function | 209 | <code>def isolated_python(f):</code> |
| `sdk_config` | function | 214 | <code>def sdk_config(f):</code> |
| `sdk_override` | function | 218 | <code>def sdk_override(f):f.reject("describe",{},"BLAXEL_CREDENTIALS_UNAVAILABLE",{"BL_API_URL":"https://untrusted.example.invalid"})</code> |

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
| `explicit` | function | 43 | <code>def explicit():</code> |
| `bad` | function | 63 | <code>def bad(mutator=mutator):p=policy();mutator(p);f.reject(p)</code> |
| `reason` | function | 65 | <code>def reason(name,change,pchange=None,now=NOW):</code> |
| `idle` | function | 78 | <code>def idle():</code> |
| `heartbeat` | function | 82 | <code>def heartbeat():</code> |
| `earliest` | function | 85 | <code>def earliest():</code> |
| `missing_live` | function | 89 | <code>def missing_live():</code> |
| `read_budget` | function | 92 | <code>def read_budget(cancel=False):</code> |
| `request` | function | 104 | <code>def request(method,path,data=None):</code> |
| `process_timeout` | function | 114 | <code>def process_timeout():</code> |
| `infinite_timeout` | function | 123 | <code>def infinite_timeout():</code> |
| `api_wait` | function | 126 | <code>def api_wait():</code> |

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
| `add` | function | 31 | <code>def add(name):</code> |
| `close` | method | 41 | <code>def close(self):</code> |
| `call` | method | 44 | <code>def call(self,action,data):</code> |
| `good` | method | 48 | <code>def good(self,action,data):</code> |
| `bad` | method | 50 | <code>def bad(self,action,data,code=None):</code> |
| `reap` | function | 53 | <code>def reap():</code> |
| `capture_deadline` | function | 68 | <code>def capture_deadline():</code> |
| `pure_isolation` | function | 74 | <code>def pure_isolation():</code> |
| `main` | function | 81 | <code>def main():</code> |
| `plan` | function | 89 | <code>def plan():</code> |
| `stable` | function | 94 | <code>def stable():</code> |
| `bad_timeout` | function | 98 | <code>def bad_timeout():</code> |
| `raw_secret` | function | 101 | <code>def raw_secret():</code> |
| `tampered` | function | 104 | <code>def tampered():</code> |
| `create` | function | 107 | <code>def create():</code> |
| `mismatch` | function | 113 | <code>def mismatch(key=key):</code> |
| `external` | function | 118 | <code>def external():</code> |
| `replaced` | function | 123 | <code>def replaced():</code> |
| `vector` | function | 128 | <code>def vector():</code> |
| `wrong_artifact` | function | 132 | <code>def wrong_artifact():</code> |
| `retained_mismatch` | function | 138 | <code>def retained_mismatch():</code> |
| `request` | function | 150 | <code>def request(method,path,data=None,raw=False):</code> |
| `terminal` | function | 154 | <code>def terminal(ref):</code> |
| `capture` | function | 169 | <code>def capture():</code> |
| `overflow` | function | 177 | <code>def overflow():</code> |
| `escaped` | function | 182 | <code>def escaped():</code> |
| `captured_stdin` | function | 189 | <code>def captured_stdin():</code> |
| `bad_capture` | function | 195 | <code>def bad_capture(change):</code> |
| `lock` | function | 202 | <code>def lock():</code> |
| `eof` | function | 212 | <code>def eof():</code> |
| `partial` | function | 218 | <code>def partial():</code> |
| `disconnect_post` | function | 226 | <code>def disconnect_post(path,body,accepted):</code> |
| `launch_lost_response` | function | 234 | <code>def launch_lost_response():</code> |
| `stdin_lost_response` | function | 242 | <code>def stdin_lost_response():</code> |
| `restart_stdin` | function | 253 | <code>def restart_stdin():</code> |

## tests/hyperfide/cases/tasks/10_4.py

[Open source](../tests/hyperfide/cases/tasks/10_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 7 | <code>def check(name,fn):</code> |
| `request` | function | 12 | <code>def request():return {"source":"FRESH_IMAGE","authenticated_memory_present":False,"environment_changed":False,"retained_volumes":&#91;&#93;,"checkpoint_digest":None}</code> |
| `main` | function | 13 | <code>def main():</code> |
| `described` | function | 16 | <code>def described():</code> |
| `fresh` | function | 20 | <code>def fresh():</code> |
| `cloned` | function | 29 | <code>def cloned(source=source):</code> |
| `auth_memory` | function | 32 | <code>def auth_memory():</code> |
| `forge` | function | 35 | <code>def forge():</code> |
| `disk` | function | 39 | <code>def disk():</code> |
| `missing` | function | 43 | <code>def missing():</code> |
| `surprise` | function | 46 | <code>def surprise():</code> |
| `volumes` | function | 49 | <code>def volumes():</code> |
| `duplicate` | function | 54 | <code>def duplicate():</code> |
| `environment` | function | 57 | <code>def environment():</code> |
| `actual_environment` | function | 61 | <code>def actual_environment():</code> |
| `memory_guard` | function | 69 | <code>def memory_guard():</code> |
| `add` | function | 82 | <code>def add(name):</code> |
| `setup` | function | 87 | <code>def setup(auth):</code> |
| `enrolled` | function | 106 | <code>def enrolled():</code> |
| `wrong_boot` | function | 112 | <code>def wrong_boot():</code> |
| `old_heartbeat` | function | 116 | <code>def old_heartbeat():</code> |
| `wrong_config` | function | 122 | <code>def wrong_config():</code> |
| `revoked` | function | 126 | <code>def revoked():</code> |

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
| `case` | function | 161 | <code>def case(identity,callback):</code> |
| `inventory` | function | 164 | <code>def inventory(f):</code> |
| `roundtrip` | function | 185 | <code>def roundtrip(f):</code> |
| `portable` | function | 194 | <code>def portable(f):</code> |
| `scan_declaration` | function | 202 | <code>def scan_declaration(f):</code> |
| `drift` | function | 214 | <code>def drift(f,mutation):</code> |
| `profile_drift` | function | 234 | <code>def profile_drift(f):</code> |
| `manifest_tamper` | function | 242 | <code>def manifest_tamper(f,mutation):</code> |
| `unsafe_path` | function | 261 | <code>def unsafe_path(f,p=path):</code> |
| `root_symlink` | function | 270 | <code>def root_symlink(f):</code> |
| `nested_symlink` | function | 275 | <code>def nested_symlink(f):</code> |
| `ancestor_symlink` | function | 279 | <code>def ancestor_symlink(f):</code> |
| `hardlink` | function | 283 | <code>def hardlink(f):</code> |
| `fifo` | function | 287 | <code>def fifo(f):</code> |
| `special_mode` | function | 291 | <code>def special_mode(f):</code> |
| `inside_manifest` | function | 295 | <code>def inside_manifest(f):</code> |
| `contaminated` | function | 303 | <code>def contaminated(f,v=value):</code> |
| `filename_canary` | function | 307 | <code>def filename_canary(f):</code> |
| `dirname_canary` | function | 311 | <code>def dirname_canary(f):</code> |
| `authpath` | function | 317 | <code>def authpath(f,n=name):</code> |
| `authority` | function | 322 | <code>def authority(f,k=key):</code> |
| `private_key` | function | 326 | <code>def private_key(f):</code> |
| `env_example` | function | 330 | <code>def env_example(f):</code> |
| `empty_scan` | function | 334 | <code>def empty_scan(f):</code> |
| `bad_profile` | function | 363 | <code>def bad_profile(f,m=mutation):</code> |
| `bad_scan` | function | 366 | <code>def bad_scan(f):</code> |
| `big_file` | function | 370 | <code>def big_file(f):</code> |
| `real_binary` | function | 375 | <code>def real_binary(f):</code> |
| `chunk_canary` | function | 389 | <code>def chunk_canary(f):</code> |
| `late_mutation` | function | 393 | <code>def late_mutation(f):</code> |
| `rewrite` | function | 405 | <code>def rewrite():</code> |
| `schema_password` | function | 425 | <code>def schema_password(f):</code> |
| `duplicate_credentials` | function | 432 | <code>def duplicate_credentials(f):</code> |
| `escaped_credentials` | function | 436 | <code>def escaped_credentials(f):</code> |
| `authority_other_extension` | function | 440 | <code>def authority_other_extension(f):</code> |
| `oci_image` | function | 444 | <code>def oci_image(f):</code> |
| `oci_mismatch` | function | 450 | <code>def oci_mismatch(f):</code> |
| `large_inventory` | function | 455 | <code>def large_inventory(f):</code> |
| `default_input_limit` | function | 471 | <code>def default_input_limit(f):</code> |
| `invalid_limit` | function | 480 | <code>def invalid_limit(f,key=option,value=setting):</code> |
| `request_limit_override` | function | 485 | <code>def request_limit_override(f):</code> |
| `outside_sibling_mutation` | function | 490 | <code>def outside_sibling_mutation(f):</code> |
| `mutate` | function | 499 | <code>def mutate():</code> |
| `scan_cancellation` | function | 513 | <code>def scan_cancellation(f):</code> |
| `interrupt` | function | 529 | <code>def interrupt():</code> |
| `marker_only` | function | 548 | <code>def marker_only(f):</code> |
| `adjacent_markers` | function | 552 | <code>def adjacent_markers(f):</code> |
| `actual_mise` | function | 557 | <code>def actual_mise(f):</code> |
| `unwrapped_pem` | function | 568 | <code>def unwrapped_pem(f):</code> |
| `empty_candidate` | function | 574 | <code>def empty_candidate(f):</code> |
| `install_local_package` | function | 584 | <code>def install_local_package(candidate,manager):</code> |
| `link_cases` | function | 605 | <code>def link_cases(case):</code> |
| `internal` | function | 606 | <code>def internal(f):</code> |
| `directory_graph` | function | 612 | <code>def directory_graph(f):</code> |
| `target_drift` | function | 618 | <code>def target_drift(f):</code> |
| `absolute` | function | 623 | <code>def absolute(f):</code> |
| `escape` | function | 626 | <code>def escape(f):</code> |
| `intermediate` | function | 630 | <code>def intermediate(f):</code> |
| `dangling` | function | 633 | <code>def dangling(f):</code> |
| `loop` | function | 636 | <code>def loop(f):</code> |
| `non_directory` | function | 639 | <code>def non_directory(f):</code> |
| `invalid_utf8` | function | 642 | <code>def invalid_utf8(f):</code> |
| `repeated` | function | 645 | <code>def repeated(f):</code> |
| `finite_repetition` | function | 653 | <code>def finite_repetition(f):</code> |
| `canary` | function | 658 | <code>def canary(f):</code> |
| `hardlinks` | function | 664 | <code>def hardlinks(f):</code> |
| `alias_drift` | function | 670 | <code>def alias_drift(f):</code> |
| `external_alias` | function | 675 | <code>def external_alias(f):</code> |
| `legacy` | function | 678 | <code>def legacy(f):</code> |
| `installed` | function | 685 | <code>def installed(f,manager):</code> |
| `mutation` | function | 694 | <code>def mutation(f,kind):</code> |
| `mutate` | function | 703 | <code>def mutate():</code> |
| `case` | function | 727 | <code>def case(identity,callback):check("preparation."+identity,lambda:using(Path(folder),callback))</code> |

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
| `case` | function | 51 | <code>def case(identity,callback):</code> |
| `run` | function | 52 | <code>def run():</code> |
| `exact` | function | 55 | <code>def exact(f):</code> |
| `partial_download` | function | 63 | <code>def partial_download(f):</code> |
| `submodule` | function | 80 | <code>def submodule(f,nested=False):</code> |
| `module_exact` | function | 88 | <code>def module_exact(f):</code> |
| `module_wrong` | function | 92 | <code>def module_wrong(f):</code> |
| `module_missing` | function | 95 | <code>def module_missing(f):</code> |
| `module_outside` | function | 98 | <code>def module_outside(f):</code> |
| `module_nested` | function | 102 | <code>def module_nested(f):</code> |
| `lfs` | function | 111 | <code>def lfs(f,corrupt=False):</code> |
| `install` | function | 125 | <code>def install(f):</code> |
| `large_artifact` | function | 129 | <code>def large_artifact(f):</code> |
| `large_diagnostic` | function | 133 | <code>def large_diagnostic(f):</code> |
| `arguments` | function | 137 | <code>def arguments(f):</code> |
| `failing` | function | 141 | <code>def failing(f):</code> |
| `mutation` | function | 145 | <code>def mutation(f):</code> |
| `index_bypass` | function | 148 | <code>def index_bypass(f):</code> |
| `timeout` | function | 153 | <code>def timeout(f):</code> |
| `configure_cache` | function | 171 | <code>def configure_cache(f):</code> |
| `cached` | function | 175 | <code>def cached(f):</code> |
| `invalidate` | function | 182 | <code>def invalidate(f):</code> |
| `corrupt` | function | 187 | <code>def corrupt(f):</code> |
| `tracked` | function | 192 | <code>def tracked(f):</code> |
| `missing_cache` | function | 195 | <code>def missing_cache(f):</code> |
| `cache_secret` | function | 198 | <code>def cache_secret(f):</code> |
| `duplicate` | function | 201 | <code>def duplicate(f):</code> |
| `existing` | function | 205 | <code>def existing(f):</code> |
| `symlink` | function | 209 | <code>def symlink(f):</code> |

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
| `accept` | function | 67 | <code>def accept():</code> |
| `publish` | method | 96 | <code>def publish(self):</code> |
| `workspace_inventory` | method | 101 | <code>def workspace_inventory(self):</code> |
| `invoke` | method | 109 | <code>def invoke(self,action="environment.readiness"):</code> |
| `ready` | method | 114 | <code>def ready(self):</code> |
| `refused` | method | 122 | <code>def refused(self,reason=None):</code> |
| `close` | method | 126 | <code>def close(self):</code> |
| `main` | function | 128 | <code>def main():</code> |
| `case` | function | 130 | <code>def case(identity,fn):</code> |
| `run` | function | 131 | <code>def run():</code> |
| `package_readiness` | function | 138 | <code>def package_readiness(f,manager,mutation=None):</code> |
| `source_verified` | function | 161 | <code>def source_verified(f):</code> |
| `source_refused` | function | 166 | <code>def source_refused(f):</code> |
| `source_without_runtime` | function | 169 | <code>def source_without_runtime(f):</code> |
| `forged_object` | function | 173 | <code>def forged_object(f,kind):</code> |
| `fsck_override` | function | 198 | <code>def fsck_override(f):</code> |
| `worktree_config` | function | 201 | <code>def worktree_config(f,setting):</code> |
| `absent_inventory` | function | 221 | <code>def absent_inventory(f):</code> |
| `index_bypass` | function | 224 | <code>def index_bypass(f):</code> |
| `republished_index_drift` | function | 229 | <code>def republished_index_drift(f,flag):</code> |
| `transformed_source` | function | 234 | <code>def transformed_source(f):</code> |
| `tracked_symlink` | function | 237 | <code>def tracked_symlink(f,mutated=False):</code> |
| `root_config` | function | 246 | <code>def root_config(f):</code> |
| `source_semantics` | function | 249 | <code>def source_semantics(f):</code> |
| `subreaper` | function | 252 | <code>def subreaper(f):</code> |
| `changed_base` | function | 256 | <code>def changed_base(f):</code> |
| `canary` | function | 259 | <code>def canary(f):</code> |
| `ignored` | function | 266 | <code>def ignored(f,covered=False,mutate=False):</code> |
| `tools` | function | 278 | <code>def tools(f):</code> |
| `credential` | function | 281 | <code>def credential(f,key,value):</code> |
| `duplicate` | function | 289 | <code>def duplicate(f):</code> |
| `network` | function | 294 | <code>def network(f):</code> |
| `capability` | function | 297 | <code>def capability(f):</code> |
| `os_wrong` | function | 300 | <code>def os_wrong(f):</code> |

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
| `call` | function | 164 | <code>def call(action,payload,key,component,remote=False):return (f.remote if remote else f).invoke(action,payload,key=key,component=component)</code> |
| `ok` | function | 165 | <code>def ok(action,payload,key="leader",component="11.4",remote=False):</code> |
| `refused` | function | 167 | <code>def refused(action,payload,code,key="leader",component="11.4",remote=False):</code> |
| `schedule` | function | 170 | <code>def schedule(warm=False,request_key=None,job_class="PREPARATION",pool=None,profile=None):</code> |
| `reservations` | function | 172 | <code>def reservations():return f.sql("SELECT count(&#42;)::int AS n FROM hyperfide.reservations WHERE organisation_id=$1 AND run_id=$2",&#91;org,run&#93;)&#91;0&#93;&#91;"n"&#93;</code> |
| `bases` | function | 173 | <code>def bases(where="TRUE",values=()):return f.sql("SELECT &#42; FROM hyperfide.provider_prepared_bases WHERE organisation_id=$1 AND "+where,&#91;org,&#42;values&#93;)</code> |
| `account` | function | 174 | <code>def account(dimension,klass="EXECUTION"):return f.sql("SELECT configured_limit::int AS limit,reserved::int AS reserved FROM hyperfide.capacity_accounts WHERE organisation_id=$1 AND pool_id=$2 AND dime…</code> |
| `separated` | function | 179 | <code>def separated():</code> |
| `no_work` | function | 187 | <code>def no_work():</code> |
| `manager_warm` | function | 192 | <code>def manager_warm():</code> |
| `warm` | function | 196 | <code>def warm():</code> |
| `budget` | function | 201 | <code>def budget():</code> |
| `demand` | function | 206 | <code>def demand():</code> |
| `limits` | function | 211 | <code>def limits():</code> |
| `accounting` | function | 222 | <code>def accounting():</code> |
| `idempotent` | function | 228 | <code>def idempotent():</code> |
| `intents` | function | 233 | <code>def intents():</code> |
| `execute` | function | 240 | <code>def execute(job):return ok("preparation.jobs.execute",{"job_id":job&#91;"id"&#93;},key="provisioner",component="11.4-provisioner",remote=True)</code> |
| `get` | function | 241 | <code>def get(job):return ok("preparation.jobs.get",{"job_id":job&#91;"id"&#93;},key="provisioner",component="11.4-provisioner",remote=True)</code> |
| `wait_due` | function | 242 | <code>def wait_due(job):</code> |
| `provider_unavailable` | function | 244 | <code>def provider_unavailable():</code> |
| `bounded` | function | 252 | <code>def bounded():</code> |
| `simulate_create` | function | 262 | <code>def simulate_create(job):</code> |
| `awaiting` | function | 269 | <code>def awaiting():</code> |
| `remote_run` | function | 275 | <code>def remote_run(job,command,host_class="remote"):</code> |
| `store` | function | 282 | <code>def store(document):</code> |
| `report` | function | 287 | <code>def report(job,dispatch,receipt,downloads,readiness="READY",host_class="remote",sandbox=None,persist=True,boot=None):</code> |
| `downloads_of` | function | 296 | <code>def downloads_of(path,expected=None):</code> |
| `send` | function | 299 | <code>def send(payload):return f.remote.invoke("preparation.jobs.report",payload,key="provisioner",component="11.4-provisioner")&#91;1&#93;</code> |
| `main_host` | function | 300 | <code>def main_host():</code> |
| `incomplete` | function | 308 | <code>def incomplete():</code> |
| `publish` | function | 314 | <code>def publish():</code> |
| `identity_matches` | function | 323 | <code>def identity_matches():</code> |
| `no_secret` | function | 328 | <code>def no_secret():</code> |
| `cache_hit` | function | 334 | <code>def cache_hit():</code> |
| `changed_input` | function | 341 | <code>def changed_input():</code> |
| `tampered` | function | 346 | <code>def tampered():</code> |
| `dispatch_a` | function | 351 | <code>def dispatch_a():</code> |
| `no_base_for_a` | function | 353 | <code>def no_base_for_a():return bases("source_sandbox_id=$2",&#91;jobs&#91;"A"&#93;&#91;"sandbox_id"&#93;&#93;)==&#91;&#93;</code> |
| `package` | function | 354 | <code>def package():</code> |
| `partial` | function | 360 | <code>def partial():</code> |
| `readiness` | function | 366 | <code>def readiness():</code> |
| `obsolete` | function | 371 | <code>def obsolete():</code> |
| `stale` | function | 378 | <code>def stale():</code> |
| `diagnostics` | function | 382 | <code>def diagnostics():</code> |
| `preserved` | function | 391 | <code>def preserved():</code> |
| `indexing` | function | 397 | <code>def indexing():</code> |

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
| `qualified` | function | 66 | <code>def qualified():</code> |
| `sources` | function | 77 | <code>def sources():</code> |
| `registry` | function | 84 | <code>def registry():</code> |
| `main_cli` | function | 94 | <code>def main_cli():</code> |
| `runtime` | function | 103 | <code>def runtime():</code> |
| `setup` | function | 119 | <code>def setup(f):</code> |
| `certificate` | function | 124 | <code>def certificate(folder, name, sans, ca=None):</code> |
| `users` | function | 135 | <code>def users(count):</code> |
| `as_slot` | function | 188 | <code>def as_slot(slot, mode, tag, &#42;args, stdin=False):</code> |
| `finished` | function | 193 | <code>def finished(process, timeout=60):</code> |
| `https` | function | 198 | <code>def https(f, body, headers, port=None):</code> |
| `main` | function | 208 | <code>def main():</code> |
| `issue` | function | 224 | <code>def issue(grant_id, ttl=300):</code> |
| `enrollment_payload` | function | 228 | <code>def enrollment_payload(public_key, boot=None):</code> |
| `call` | function | 231 | <code>def call(action, config, payload, &#42;&#42;extra):</code> |
| `describe_payload` | function | 236 | <code>def describe_payload(component='14.1', action='identity.describe', input=None):</code> |
| `native_enroll` | function | 241 | <code>def native_enroll():</code> |
| `signed_invoke` | function | 254 | <code>def signed_invoke():</code> |
| `stale_grant` | function | 259 | <code>def stale_grant():</code> |
| `wrong_sandbox` | function | 269 | <code>def wrong_sandbox():</code> |
| `forbidden_role` | function | 280 | <code>def forbidden_role():</code> |
| `wrong_certificate` | function | 288 | <code>def wrong_certificate():</code> |
| `wrong_hostname` | function | 295 | <code>def wrong_hostname():</code> |
| `modified_payload` | function | 314 | <code>def modified_payload():</code> |
| `replay` | function | 324 | <code>def replay():</code> |
| `stale_time` | function | 333 | <code>def stale_time():</code> |
| `wrong_key` | function | 338 | <code>def wrong_key():</code> |
| `slot_request` | function | 348 | <code>def slot_request(index, profile='distinct_uid', sensitive=False, storage=None, slot_id=None):</code> |
| `allocate` | function | 355 | <code>def allocate():</code> |
| `colliding` | function | 373 | <code>def colliding():</code> |
| `cross` | function | 392 | <code>def cross():</code> |
| `exhaustion` | function | 400 | <code>def exhaustion():</code> |
| `status_row` | function | 419 | <code>def status_row(credential=None):</code> |
| `wait_for` | function | 422 | <code>def wait_for(fn, timeout=20):</code> |
| `serve` | function | 429 | <code>def serve(config):</code> |
| `derived` | function | 434 | <code>def derived():</code> |
| `heartbeat` | function | 445 | <code>def heartbeat():</code> |
| `reregister` | function | 451 | <code>def reregister():</code> |
| `observations_verified` | function | 459 | <code>def observations_verified():</code> |
| `observation` | function | 461 | <code>def observation(slot, &#42;&#42;change):</code> |
| `reconnect` | function | 478 | <code>def reconnect():</code> |
| `override` | function | 490 | <code>def override():</code> |
| `release` | function | 499 | <code>def release():</code> |
| `exclusive` | function | 510 | <code>def exclusive():</code> |
| `rotation` | function | 522 | <code>def rotation():</code> |
| `rotated_active` | function | 560 | <code>def rotated_active():</code> |
| `revoked` | function | 574 | <code>def revoked():</code> |
| `write_registration` | function | 581 | <code>def write_registration():</code> |
| `no_secret_leak` | function | 585 | <code>def no_secret_leak():</code> |
| `node_suite` | function | 604 | <code>def node_suite():</code> |
| `daemon_fixture` | function | 610 | <code>def daemon_fixture():</code> |

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
| `GET /suppress` | route | 213 | <code>if ins&#91;"kind"&#93; != "CANCEL" and ins.get("suppress", True) and any(o&#91;"kind"&#93; == "CANCEL" and o&#91;"attempt_id"&#93; == ins&#91;"attempt_id"&#93; for o in self.state&#91;"instructions"&#93;):</code> |
| `control` | method | 289 | <code>def control(self, request):</code> |
| `GET /with_commands` | route | 302 | <code>self.state&#91;"drops"&#93;.append({"action": request&#91;"action"&#93;, "count": request&#91;"count"&#93;, "with_commands": request.get("with_commands", False)})</code> |
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
| `executing` | function | 674 | <code>def executing():</code> |
| `drained` | function | 814 | <code>def drained():</code> |
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
| `run` | function | 269 | <code>def run():</code> |
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
| `setup` | function | 40 | <code>def setup(f):</code> |
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
| `transport_required` | function | 100 | <code>def transport_required():</code> |
| `unissued` | function | 106 | <code>def unissued():</code> |
| `unreachable` | function | 111 | <code>def unreachable():</code> |
| `paused` | function | 118 | <code>def paused():</code> |
| `observed` | function | 127 | <code>def observed():</code> |
| `resumed` | function | 131 | <code>def resumed():</code> |
| `draining` | function | 138 | <code>def draining():</code> |
| `drain_repeat` | function | 144 | <code>def drain_repeat():</code> |
| `drained` | function | 149 | <code>def drained():</code> |
| `deadline` | function | 158 | <code>def deadline():</code> |
| `fenced_before_delivery` | function | 164 | <code>def fenced_before_delivery():</code> |
| `cancelled` | function | 172 | <code>def cancelled():</code> |
| `revoked` | function | 179 | <code>def revoked():</code> |
| `durable` | function | 183 | <code>def durable():</code> |
| `confirmed` | function | 192 | <code>def confirmed():</code> |
| `repeat` | function | 196 | <code>def repeat():</code> |
| `conflict` | function | 201 | <code>def conflict():</code> |
| `lost_ack` | function | 204 | <code>def lost_ack():</code> |
| `superseded` | function | 213 | <code>def superseded():</code> |
| `stale_generation` | function | 218 | <code>def stale_generation():</code> |
| `mismatch` | function | 222 | <code>def mismatch():</code> |
| `graceful` | function | 231 | <code>def graceful():</code> |
| `process_residue` | function | 238 | <code>def process_residue():</code> |
| `credential_residue` | function | 246 | <code>def credential_residue():</code> |
| `reusable` | function | 252 | <code>def reusable():</code> |
| `unresolved_stop` | function | 262 | <code>def unresolved_stop():</code> |
| `restart` | function | 272 | <code>def restart():</code> |
| `repeat_stop` | function | 278 | <code>def repeat_stop():</code> |
| `before_ack` | function | 284 | <code>def before_ack():</code> |
| `after_reconnect` | function | 289 | <code>def after_reconnect():</code> |
| `disconnected_job` | function | 295 | <code>def disconnected_job():</code> |
| `provisioner_validator` | function | 313 | <code>def provisioner_validator():</code> |
| `item` | function | 314 | <code>def item(name,action,mutate=None):</code> |
| `thawed` | function | 319 | <code>def thawed(r):r&#91;"processes"&#93;&#91;0&#93;&#91;"state"&#93;="S"</code> |
| `forged` | function | 320 | <code>def forged(r):r&#91;"required_artifacts"&#93;&#91;0&#93;&#91;"capture_receipt"&#93;=None</code> |
| `complete` | function | 321 | <code>def complete(r):r&#91;"cleanup_complete"&#93;=True</code> |
| `contradiction` | function | 327 | <code>def contradiction():</code> |
| `preparation_receipt` | function | 335 | <code>def preparation_receipt():</code> |
| `committed` | function | 343 | <code>def committed():</code> |
| `subprobes` | function | 362 | <code>def subprobes():</code> |
| `receipts` | function | 364 | <code>def receipts():</code> |
| `staging` | function | 368 | <code>def staging():</code> |
| `budget` | function | 372 | <code>def budget():</code> |
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
| `setup` | function | 105 | <code>def setup(f):</code> |
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
| `configure` | function | 76 | <code>def configure(name):</code> |
| `probe` | function | 88 | <code>def probe(name=name):</code> |
| `unknown_option` | function | 92 | <code>def unknown_option(name=name):</code> |
| `launch` | function | 97 | <code>def launch(name=name):</code> |
| `unicode` | function | 126 | <code>def unicode():</code> |
| `initialize` | function | 134 | <code>def initialize():</code> |
| `actual_init` | function | 139 | <code>def actual_init():</code> |
| `rpc` | function | 144 | <code>def rpc(frame,reply=True):</code> |
| `private_dir` | function | 184 | <code>def private_dir(label):</code> |
| `dirs_for` | function | 186 | <code>def dirs_for(label):</code> |
| `codex_profile` | function | 191 | <code>def codex_profile(&#42;&#42;changes):</code> |
| `codex_launch_request` | function | 193 | <code>def codex_launch_request(p,home=codex_home):</code> |
| `resolve_codex` | function | 195 | <code>def resolve_codex():</code> |
| `unresolved` | function | 201 | <code>def unresolved():</code> |
| `drift` | function | 210 | <code>def drift():</code> |
| `codex_observed` | function | 219 | <code>def codex_observed():</code> |
| `rpc` | function | 224 | <code>def rpc(frame,reply=True):</code> |
| `codex_children` | function | 258 | <code>def codex_children():</code> |
| `claude_profile` | function | 266 | <code>def claude_profile(&#42;&#42;changes):</code> |
| `claude_observed` | function | 268 | <code>def claude_observed():</code> |
| `qualification_registry` | function | 306 | <code>def qualification_registry():</code> |
| `receipt_env` | function | 357 | <code>def receipt_env(name,payload=None,key=None):</code> |
| `receipt_dispatch` | function | 363 | <code>def receipt_dispatch():</code> |
| `receipt_resume` | function | 378 | <code>def receipt_resume():</code> |
| `recover_with` | function | 392 | <code>def recover_with(e):</code> |

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
| `probe` | function | 163 | <code>def probe():</code> |
| `bad_config` | function | 168 | <code>def bad_config():</code> |
| `plan_conflict` | function | 177 | <code>def plan_conflict():</code> |
| `immutable_scope` | function | 180 | <code>def immutable_scope():</code> |
| `frames_valid` | function | 194 | <code>def frames_valid():</code> |
| `peer_denied` | function | 211 | <code>def peer_denied():</code> |
| `deny_plan` | function | 219 | <code>def deny_plan(change=change):</code> |
| `forged_file` | function | 222 | <code>def forged_file(mode):</code> |
| `historical_stop` | function | 237 | <code>def historical_stop():</code> |
| `broker_positive` | function | 240 | <code>def broker_positive():</code> |
| `broker_request` | function | 251 | <code>def broker_request():</code> |
| `concurrent_starts` | function | 256 | <code>def concurrent_starts():</code> |
| `actual_pid_reuse` | function | 278 | <code>def actual_pid_reuse():</code> |
| `original_policy_provenance` | function | 307 | <code>def original_policy_provenance():</code> |
| `large_historical_journal` | function | 310 | <code>def large_historical_journal():</code> |
| `drift` | function | 315 | <code>def drift():</code> |

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
| `setup` | function | 140 | <code>def setup(f):</code> |
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
| `isolation_guards` | function | 256 | <code>def isolation_guards():</code> |
| `first_binding` | function | 269 | <code>def first_binding():</code> |
| `refused_sql` | function | 273 | <code>def refused_sql(statement):</code> |
| `lineage` | function | 286 | <code>def lineage():</code> |
| `unqualified` | function | 314 | <code>def unqualified():</code> |
| `decision_persisted` | function | 320 | <code>def decision_persisted():</code> |
| `decision_replay` | function | 327 | <code>def decision_replay():</code> |
| `GET /reconcile` | route | 342 | <code>check("sessions.resume-unresumable-decision-refused",lambda:f.bad("agent.session.bind",{"scope":successor,"binding":renewed,"resume":dict(link,resume_operation_id=decisions.get("reconcile",uid()))},"A…</code> |
| `links_predecessor` | function | 343 | <code>def links_predecessor():</code> |
| `not_retroactive` | function | 354 | <code>def not_retroactive():</code> |
| `restart_resume_lineage` | function | 362 | <code>def restart_resume_lineage():</code> |

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
| `live` | function | 48 | <code>def live():</code> |
| `transport_independent` | function | 53 | <code>def transport_independent():</code> |
| `pending` | function | 61 | <code>def pending():</code> |
| `dead_pipe` | function | 67 | <code>def dead_pipe():</code> |
| `zombie` | function | 80 | <code>def zombie():</code> |
| `absent` | function | 87 | <code>def absent():</code> |
| `reused` | function | 91 | <code>def reused():</code> |
| `orphaned` | function | 95 | <code>def orphaned():</code> |
| `fresh_handoff` | function | 103 | <code>def fresh_handoff():</code> |
| `unbound` | function | 110 | <code>def unbound():</code> |
| `unqualified` | function | 117 | <code>def unqualified():</code> |
| `mismatch` | function | 121 | <code>def mismatch():</code> |

## tests/hyperfide/cases/tasks/13_4.py

[Open source](../tests/hyperfide/cases/tasks/13_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonical` | function | 16 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False).encode()</code> |
| `_release_sql` | function | 18 | <code>def _release_sql(self,sql,values=None,&#42;&#42;kwargs):</code> |
| `ReleaseIdentityFixture` | class | 28 | <code>class ReleaseIdentityFixture(module.SessionIdentityFixture):</code> |
| `__init__` | method | 31 | <code>def __init__(self,extra_components=(),extra_setup=None,&#42;&#42;kwargs):</code> |
| `setup` | function | 32 | <code>def setup(f):</code> |
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
| `plans` | function | 155 | <code>def plans():return f.inner.sql("SELECT &#42; FROM hyperfide.native_launch_plans ORDER BY created_at")</code> |
| `blocked` | function | 156 | <code>def blocked():</code> |
| `unsafe_policy` | function | 162 | <code>def unsafe_policy(kind):</code> |
| `plan_call` | function | 181 | <code>def plan_call(action,value,key="operator"):return f.ok(action,value,component="13.4.dispatch",key=key)</code> |
| `registered` | function | 182 | <code>def registered():</code> |
| `unqualified_plan` | function | 187 | <code>def unqualified_plan():</code> |
| `child_delegation` | function | 192 | <code>def child_delegation():</code> |
| `call` | function | 204 | <code>def call(action,value,key="operator"):return f.ok(action,value,component="13.4",key=key)</code> |
| `bad` | function | 205 | <code>def bad(value,code,key="operator"):return f.bad("agent.admission.report",value,code,component="13.4",key=key)</code> |
| `inspect` | function | 207 | <code>def inspect():return call("agent.admission.inspect",base)&#91;"reservation"&#93;</code> |
| `context` | function | 209 | <code>def context():</code> |
| `first` | function | 215 | <code>def first():</code> |
| `waiting_plan` | function | 219 | <code>def waiting_plan():</code> |
| `refs` | function | 227 | <code>def refs():</code> |
| `portable` | function | 231 | <code>def portable():</code> |
| `bounded` | function | 238 | <code>def bounded():</code> |
| `durable_escalation` | function | 242 | <code>def durable_escalation():</code> |
| `exhausted_plan` | function | 248 | <code>def exhausted_plan():</code> |
| `operator_change` | function | 252 | <code>def operator_change():</code> |
| `persisted` | function | 258 | <code>def persisted():</code> |
| `replay` | function | 268 | <code>def replay():</code> |
| `immutable` | function | 272 | <code>def immutable():</code> |
| `worker_self_release` | function | 278 | <code>def worker_self_release():</code> |
| `reconcile_first` | function | 287 | <code>def reconcile_first():</code> |
| `held` | function | 294 | <code>def held():</code> |
| `observe` | function | 301 | <code>def observe(event,connector="codex",refs=True):</code> |
| `status_only` | function | 304 | <code>def status_only():</code> |
| `approval_prompt` | function | 311 | <code>def approval_prompt():</code> |
| `change` | function | 316 | <code>def change(digest,refs=True):return dict(base2,operation_id=uid(),reason="CONDITION_CHANGED",&#42;&#42;({"condition_digest":digest}if digest else{}),&#42;&#42;({"diagnostic_refs":&#91;artifact&#93;}if refs else{}))</code> |
| `requires_change` | function | 317 | <code>def requires_change():</code> |
| `recorded_change` | function | 323 | <code>def recorded_change():</code> |
| `delegation_signal` | function | 330 | <code>def delegation_signal():</code> |
| `resolution_budget` | function | 334 | <code>def resolution_budget():</code> |
| `release_observed` | function | 347 | <code>def release_observed():</code> |

## tests/hyperfide/cases/tasks/14_1.py

[Open source](../tests/hyperfide/cases/tasks/14_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `service_rpc_probe` | function | 7 | <code>def service_rpc_probe(f):</code> |
| `main` | function | 45 | <code>def main():</code> |
| `existing_database` | function | 94 | <code>def existing_database():</code> |
| `fresh_runner` | function | 108 | <code>def fresh_runner(target):</code> |
| `expiry_crossing_lock` | function | 148 | <code>def expiry_crossing_lock():</code> |
| `global_expiry_lock` | function | 157 | <code>def global_expiry_lock():</code> |
| `renewal_expiry_during_lock_upgrade` | function | 189 | <code>def renewal_expiry_during_lock_upgrade():</code> |
| `no_runtime_seed` | function | 208 | <code>def no_runtime_seed():</code> |
| `missing_journal_refuses` | function | 221 | <code>def missing_journal_refuses():</code> |

## tests/hyperfide/cases/tasks/14_2.py

[Open source](../tests/hyperfide/cases/tasks/14_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 9 | <code>def main():</code> |
| `setup` | function | 15 | <code>def setup(f):</code> |
| `private_resolve` | function | 24 | <code>def private_resolve(request):</code> |
| `as_uid` | function | 42 | <code>def as_uid(number,path):</code> |
| `race` | function | 53 | <code>def race():</code> |

## tests/hyperfide/cases/tasks/14_3.py

[Open source](../tests/hyperfide/cases/tasks/14_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `file_hash` | function | 8 | <code>def file_hash(p):</code> |
| `main` | function | 10 | <code>def main():</code> |
| `setup` | function | 19 | <code>def setup(f):</code> |
| `mode_config` | function | 45 | <code>def mode_config(revision,&#42;&#42;changes):</code> |
| `code` | function | 52 | <code>def code(value):return value.get('error',{}).get('code')</code> |
| `secret_config_refused` | function | 54 | <code>def secret_config_refused():</code> |
| `separately` | function | 63 | <code>def separately():</code> |
| `inspected` | function | 80 | <code>def inspected():</code> |
| `durable` | function | 86 | <code>def durable():</code> |
| `append_only` | function | 92 | <code>def append_only():</code> |
| `refresher` | function | 100 | <code>def refresher(n):</code> |
| `stale_refused` | function | 106 | <code>def stale_refused():</code> |
| `migration_required` | function | 113 | <code>def migration_required():</code> |
| `wrapper_refused` | function | 174 | <code>def wrapper_refused():</code> |

## tests/hyperfide/cases/tasks/14_4.py

[Open source](../tests/hyperfide/cases/tasks/14_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 8 | <code>def main():</code> |
| `setup` | function | 13 | <code>def setup(f):</code> |
| `call` | function | 29 | <code>def call(kind,target,repository=None,profile=None,key='operator'):</code> |
| `signed` | function | 31 | <code>def signed(component,action,input,key='operator',expected_version=None,authority=None):</code> |
| `code` | function | 33 | <code>def code(r):return (r.get('error') or {}).get('code')</code> |
| `allowed` | function | 35 | <code>def allowed(r):expect(r.get('ok') is True and r&#91;'result'&#93;&#91;'authority'&#93;=='POLICY_ONLY' and r&#91;'result'&#93;&#91;'publication_authorized'&#93; is False,'Expected bounded policy admission: '+json.dumps(r))</code> |
| `denied` | function | 36 | <code>def denied(r):expect(r.get('ok') is False,'Untrusted resource expanded authority: '+json.dumps(r))</code> |
| `publisher_credential` | function | 89 | <code>def publisher_credential():</code> |
| `reject_mutable_policy` | function | 107 | <code>def reject_mutable_policy():</code> |

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
| `checksum` | function | 180 | <code>def checksum():</code> |
| `truncated` | function | 185 | <code>def truncated():</code> |
| `missing` | function | 190 | <code>def missing():</code> |
| `malformed` | function | 195 | <code>def malformed():</code> |
| `traversal` | function | 201 | <code>def traversal():</code> |
| `mutate` | function | 202 | <code>def mutate(b):</code> |
| `samebranch` | function | 215 | <code>def samebranch():</code> |
| `mutation_case` | function | 224 | <code>def mutation_case(name,mutator,code):</code> |
| `tracked_secret` | function | 231 | <code>def tracked_secret(x):</code> |
| `submodule` | function | 234 | <code>def submodule(x):</code> |
| `large` | function | 237 | <code>def large(x):</code> |
| `lfs` | function | 240 | <code>def lfs(x):</code> |
| `capture_busy` | function | 243 | <code>def capture_busy():</code> |
| `nested_spool` | function | 249 | <code>def nested_spool():</code> |
| `live_writer` | function | 255 | <code>def live_writer():</code> |
| `write` | function | 258 | <code>def write():</code> |
| `evidence_dir` | function | 278 | <code>def evidence_dir():</code> |
| `sql` | function | 282 | <code>def sql(statement,database="postgres"):</code> |
| `cleanup` | function | 290 | <code>def cleanup(emit=True):</code> |
| `AuthenticatedArtifactAdapter` | class | 308 | <code>class AuthenticatedArtifactAdapter:</code> |
| `__init__` | method | 315 | <code>def __init__(self,objects,base,database,resource_id):</code> |
| `setup` | function | 322 | <code>def setup(i):</code> |
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
| `setup` | function | 312 | <code>def setup(f):</code> |
| `request` | method | 350 | <code>def request(self, action, value, &#42;, component="15.2", env=None, principal_run=None, &#42;&#42;obsolete):</code> |
| `ok` | method | 371 | <code>def ok(self, action, value, &#42;&#42;options):</code> |
| `reject` | method | 377 | <code>def reject(self, action, value, code, &#42;&#42;options):</code> |
| `put` | method | 383 | <code>def put(self, data, &#42;&#42;changes):</code> |
| `GET /run_id` | route | 385 | <code>principal_run=changes.get("run_id", RUN))</code> |
| `by_id` | method | 387 | <code>def by_id(self, result):</code> |
| `crash_upload` | method | 390 | <code>def crash_upload(self, action, value, blob, path):</code> |
| `invoke` | function | 394 | <code>def invoke():</code> |
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
| `linked` | function | 496 | <code>def linked():</code> |
| `roundtrip` | function | 504 | <code>def roundtrip():</code> |
| `replay` | function | 515 | <code>def replay():</code> |
| `preexisting` | function | 522 | <code>def preexisting():</code> |
| `crash` | function | 530 | <code>def crash():</code> |
| `reconcile_crash` | function | 534 | <code>def reconcile_crash():</code> |
| `pending_absent` | function | 542 | <code>def pending_absent():</code> |
| `ambiguous` | function | 555 | <code>def ambiguous():</code> |
| `object_fault` | function | 562 | <code>def object_fault(name, mode, &#42;, absence=None, remove=False):</code> |
| `corrupt_precondition` | function | 579 | <code>def corrupt_precondition():</code> |
| `redirect` | function | 585 | <code>def redirect():</code> |
| `binding_conflict` | function | 592 | <code>def binding_conflict():</code> |
| `scope` | function | 598 | <code>def scope():</code> |
| `invalid` | function | 608 | <code>def invalid(field, value):</code> |
| `config` | function | 622 | <code>def config():</code> |
| `complete` | function | 638 | <code>def complete():</code> |
| `read_manifest` | function | 654 | <code>def read_manifest():</code> |
| `replay_manifest` | function | 661 | <code>def replay_manifest():</code> |
| `empty_manifest` | function | 666 | <code>def empty_manifest():</code> |
| `bad_manifest` | function | 671 | <code>def bad_manifest(mutator, codes="ARTIFACT_MANIFEST_INVALID"):</code> |
| `child_fault` | function | 697 | <code>def child_fault(mode):</code> |
| `missing_child` | function | 704 | <code>def missing_child():</code> |
| `retention` | function | 711 | <code>def retention():</code> |
| `retained_children` | function | 722 | <code>def retained_children():</code> |
| `promotion_bypass` | function | 731 | <code>def promotion_bypass():</code> |
| `signatures` | function | 754 | <code>def signatures():</code> |
| `sanitized` | function | 762 | <code>def sanitized():</code> |
| `locate_after_id_loss` | function | 770 | <code>def locate_after_id_loss():</code> |
| `locate_absent_metadata` | function | 779 | <code>def locate_absent_metadata():</code> |
| `locate_pending` | function | 788 | <code>def locate_pending():</code> |
| `raw_stdio_denied` | function | 802 | <code>def raw_stdio_denied():</code> |
| `forged_context_denied` | function | 814 | <code>def forged_context_denied():</code> |
| `revoke_during_upload` | function | 825 | <code>def revoke_during_upload():</code> |

## tests/hyperfide/cases/tasks/15_3.py

[Open source](../tests/hyperfide/cases/tasks/15_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `module` | function | 13 | <code>def module(name,path):</code> |
| `accepted_intent` | function | 24 | <code>def accepted_intent():</code> |
| `field` | function | 28 | <code>def field(key,value):return {'key':key,'raw':json.dumps(value),'value':value,'line':1}</code> |
| `section` | function | 29 | <code>def section(name,&#42;&#42;fields):return {'name':name,'line':1,'fields':{k:field(k,v) for k,v in fields.items()}}</code> |
| `sql` | function | 30 | <code>def sql(self,query,values=None,&#42;args,&#42;&#42;kwargs):</code> |
| `sha` | function | 47 | <code>def sha(data):return 'sha256:'+hashlib.sha256(data).hexdigest()</code> |
| `canonical` | function | 48 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False).encode()</code> |
| `expect` | function | 49 | <code>def expect(value,message='Observed checkpoint assertion failed'):</code> |
| `check` | function | 51 | <code>def check(name,call):</code> |
| `CheckpointFixture` | class | 55 | <code>class CheckpointFixture:</code> |
| `__init__` | method | 56 | <code>def __init__(self):</code> |
| `setup` | function | 61 | <code>def setup(f):</code> |
| `ok` | method | 102 | <code>def ok(self,action,value,component='15.3',key='operator'):</code> |
| `put` | method | 104 | <code>def put(self,data):</code> |
| `upload` | method | 107 | <code>def upload(self,data):</code> |
| `reject` | method | 113 | <code>def reject(self,value,codes,key='operator',action='artifact.checkpoint.register'):</code> |
| `adopt_request` | method | 116 | <code>def adopt_request(self,&#42;&#42;overrides):</code> |
| `close` | method | 118 | <code>def close(self):</code> |
| `adoption` | function | 122 | <code>def adoption(f,checkpoint_id):</code> |
| `adopt` | function | 168 | <code>def adopt():</code> |
| `provenance` | function | 171 | <code>def provenance():</code> |
| `fence` | function | 178 | <code>def fence():</code> |
| `replay` | function | 184 | <code>def replay():</code> |
| `main` | function | 188 | <code>def main():</code> |
| `register` | function | 206 | <code>def register():</code> |
| `replay` | function | 215 | <code>def replay():</code> |
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
| `patched_reply` | function | 30 | <code>def patched_reply(h,status,data=b'',&#42;,length=None,headers=None):</code> |
| `delete` | function | 36 | <code>def delete(h):</code> |
| `cleanup` | function | 64 | <code>def cleanup():</code> |
| `main` | function | 84 | <code>def main():</code> |
| `setup` | function | 90 | <code>def setup(f):</code> |
| `invoke` | function | 111 | <code>def invoke(action,value,&#42;,body=None):</code> |
| `ok` | function | 113 | <code>def ok(action,value,component='15.4',body=None):</code> |
| `rejected` | function | 117 | <code>def rejected(action,value,codes):</code> |
| `put` | function | 120 | <code>def put(data,&#42;&#42;changes):</code> |
| `ref` | function | 123 | <code>def ref(result):return dict(scope,artifact_id=result&#91;'artifact'&#93;&#91;'artifact_id'&#93;,policy_digest=policy_digest)</code> |
| `inspect` | function | 124 | <code>def inspect(result):return ok('artifact.retention.inspect',ref(result))</code> |
| `collect` | function | 125 | <code>def collect(result,body=None):</code> |
| `finding_retention` | function | 129 | <code>def finding_retention():</code> |
| `finding_reopen` | function | 150 | <code>def finding_reopen():</code> |
| `no_policy` | function | 161 | <code>def no_policy():</code> |
| `minimum_age` | function | 167 | <code>def minimum_age():</code> |
| `add_hold` | function | 181 | <code>def add_hold():</code> |
| `release_hold` | function | 186 | <code>def release_hold():</code> |
| `audited_policy` | function | 190 | <code>def audited_policy():</code> |
| `conditional_delete` | function | 195 | <code>def conditional_delete():</code> |
| `unknown_delete` | function | 204 | <code>def unknown_delete():</code> |
| `reconcile` | function | 209 | <code>def reconcile():</code> |
| `delete_fault` | function | 215 | <code>def delete_fault(label):</code> |
| `replace` | function | 223 | <code>def replace():</code> |
| `late_hold` | function | 229 | <code>def late_hold():</code> |
| `parent_dependency` | function | 236 | <code>def parent_dependency():</code> |
| `auth_required` | function | 243 | <code>def auth_required():</code> |
| `gc_binding` | function | 249 | <code>def gc_binding():</code> |
| `replay_conflict` | function | 255 | <code>def replay_conflict():</code> |
| `release_audit` | function | 264 | <code>def release_audit():</code> |
| `discovered_fk` | function | 271 | <code>def discovered_fk(kind):</code> |
| `required_evidence` | function | 287 | <code>def required_evidence():</code> |
| `crash_reconcile` | function | 297 | <code>def crash_reconcile():</code> |
| `crash` | function | 299 | <code>def crash():</code> |
| `debt_after_restart` | function | 314 | <code>def debt_after_restart():</code> |
| `prior_boot` | function | 328 | <code>def prior_boot():</code> |
| `never_worked` | function | 342 | <code>def never_worked():</code> |

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
| `include` | function | 185 | <code>def include(key):</code> |
| `setup` | function | 195 | <code>def setup(fixture):</code> |
| `OwnedFixture` | class | 205 | <code>class OwnedFixture(IdentityFixture):</code> |
| `__init__` | method | 206 | <code>def __init__(self,&#42;&#42;kwargs):</code> |
| `error` | function | 230 | <code>def error(action,payload,key="operator"):</code> |
| `cleanup_signed` | function | 253 | <code>def cleanup_signed():</code> |
| `current` | function | 275 | <code>def current():</code> |
| `cleanup` | function | 319 | <code>def cleanup(report=True):</code> |
| `git_cases` | function | 341 | <code>def git_cases():</code> |
| `git` | function | 349 | <code>def git(&#42;args):</code> |
| `commit` | function | 357 | <code>def commit(changes):</code> |
| `preparation_cases` | function | 426 | <code>def preparation_cases():</code> |
| `git` | function | 432 | <code>def git(&#42;args):</code> |
| `cleanup_preparation` | function | 491 | <code>def cleanup_preparation():</code> |
| `cleanup_git` | function | 503 | <code>def cleanup_git():</code> |
| `submission_record` | function | 517 | <code>def submission_record():</code> |
| `submission_stack_module` | function | 520 | <code>def submission_stack_module():</code> |
| `submission_cases` | function | 525 | <code>def submission_cases():</code> |
| `racer` | function | 587 | <code>def racer(index):responses&#91;index&#93;=send("q2",envelope("q2",value))</code> |
| `late_submit` | function | 597 | <code>def late_submit():</code> |
| `sweeper` | function | 599 | <code>def sweeper():</code> |
| `connected_stack_cases` | function | 639 | <code>def connected_stack_cases():</code> |
| `cleanup_connected` | function | 653 | <code>def cleanup_connected():</code> |
| `cleanup_submission` | function | 660 | <code>def cleanup_submission():</code> |
| `absence` | function | 663 | <code>def absence(value):</code> |
| `schema_cases` | function | 668 | <code>def schema_cases():</code> |
| `main` | function | 712 | <code>def main(task="16.1"):</code> |

## tests/hyperfide/cases/tasks/16_2.py

[Open source](../tests/hyperfide/cases/tasks/16_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `gate_cases` | function | 26 | <code>def gate_cases():</code> |
| `harness_case` | function | 93 | <code>def harness_case():</code> |
| `history_cases` | function | 114 | <code>def history_cases(fixture):</code> |
| `imported` | function | 169 | <code>def imported(claim):</code> |
| `install_history_hook` | function | 196 | <code>def install_history_hook():</code> |
| `close` | function | 200 | <code>def close(self):</code> |
| `history_authority_cases` | function | 210 | <code>def history_authority_cases():</code> |
| `install_cases` | function | 226 | <code>def install_cases():</code> |
| `authority_cases` | function | 228 | <code>def authority_cases():</code> |
| `primary_cases` | function | 233 | <code>def primary_cases():</code> |
| `cleanup` | function | 242 | <code>def cleanup():</code> |

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
| `save` | function | 63 | <code>def save():</code> |
| `include` | function | 75 | <code>def include(key):</code> |
| `field` | function | 96 | <code>def field(value): return {"value": value}</code> |
| `setup` | function | 107 | <code>def setup(f):</code> |
| `OwnedFixture` | class | 132 | <code>class OwnedFixture(IdentityFixture):</code> |
| `__init__` | method | 133 | <code>def __init__(self, &#42;&#42;kwargs):</code> |
| `start` | method | 145 | <code>def start(self):</code> |
| `call` | function | 159 | <code>def call(action, payload, component=TASK, key="operator"):</code> |
| `code` | function | 163 | <code>def code(response):</code> |
| `put` | function | 165 | <code>def put(data):</code> |
| `custody` | function | 222 | <code>def custody(item):</code> |
| `judgement` | function | 224 | <code>def judgement(item, clause, &#42;&#42;changes):</code> |
| `inspect` | function | 229 | <code>def inspect(item):</code> |
| `clause` | function | 233 | <code>def clause(view, key):</code> |
| `row` | function | 235 | <code>def row(item):</code> |
| `contend` | function | 293 | <code>def contend(name, action, payload, component):</code> |
| `cleanup_behaviour` | function | 318 | <code>def cleanup_behaviour():</code> |
| `current` | function | 324 | <code>def current():</code> |
| `closed` | function | 334 | <code>def closed(port):</code> |
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
| `include` | function | 220 | <code>def include(key):</code> |
| `OwnedFixture` | class | 229 | <code>class OwnedFixture(IdentityFixture):</code> |
| `__init__` | method | 230 | <code>def __init__(self,&#42;&#42;kwargs):</code> |
| `primary_cases` | function | 251 | <code>def primary_cases():</code> |
| `cleanup_behaviour` | function | 256 | <code>def cleanup_behaviour():</code> |
| `quiet_cleanup` | function | 264 | <code>def quiet_cleanup():</code> |

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
| `GET /HYPERFIDE_CAMPAIGN_DIR` | route | 52 | <code>path=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR",f"/tmp/hyperfide/review-{task}-standalone"))/"review";path.mkdir(parents=True,exist_ok=True);return path</code> |
| `cleanup` | function | 53 | <code>def cleanup(task):</code> |
| `Fixture` | class | 64 | <code>class Fixture:</code> |
| `__init__` | method | 65 | <code>def __init__(self,task,base,components=None,extra_setup=None):</code> |
| `add_dependencies` | function | 80 | <code>def add_dependencies(name):</code> |
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
| `configure` | function | 167 | <code>def configure():</code> |
| `reject_sixteen` | function | 174 | <code>def reject_sixteen():</code> |
| `first` | function | 184 | <code>def first():</code> |
| `second` | function | 187 | <code>def second():</code> |
| `replay` | function | 190 | <code>def replay():</code> |
| `all_watchers` | function | 193 | <code>def all_watchers():</code> |
| `omission` | function | 198 | <code>def omission():</code> |
| `repair` | function | 202 | <code>def repair():</code> |
| `rewrite` | function | 205 | <code>def rewrite():</code> |
| `history` | function | 209 | <code>def history():</code> |
| `replace` | function | 214 | <code>def replace():</code> |
| `old_stale` | function | 219 | <code>def old_stale():</code> |
| `untagged` | function | 223 | <code>def untagged():</code> |
| `empty` | function | 227 | <code>def empty():</code> |
| `main` | function | 235 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/17_2.py

[Open source](../tests/hyperfide/cases/tasks/17_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `canonical` | function | 19 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"))</code> |
| `seed_graph` | function | 20 | <code>def seed_graph(f,tag,sources,symbols,edges,unresolved=False):</code> |
| `behavioural` | function | 42 | <code>def behavioural(f,publish,before,consumer,identity):</code> |
| `mutate` | function | 44 | <code>def mutate(key,changes,revision="2",base=None):</code> |
| `unchanged_signature` | function | 48 | <code>def unchanged_signature(key,changes,expected):</code> |
| `reproductions` | function | 60 | <code>def reproductions():</code> |
| `no_template` | function | 70 | <code>def no_template():</code> |
| `unchanged_consumer` | function | 76 | <code>def unchanged_consumer():</code> |
| `graph_contract` | function | 87 | <code>def graph_contract(key,symbol_ids,producer=f.first):</code> |
| `callers` | function | 90 | <code>def callers():</code> |
| `unknown_edges` | function | 97 | <code>def unknown_edges():</code> |
| `unbound` | function | 102 | <code>def unbound():</code> |
| `unavailable` | function | 106 | <code>def unavailable():</code> |
| `main` | function | 110 | <code>def main():</code> |
| `publish` | function | 120 | <code>def publish(body,revision="1",key="prices"):</code> |

## tests/hyperfide/cases/tasks/17_3.py

[Open source](../tests/hyperfide/cases/tasks/17_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `seed_inputs` | function | 25 | <code>def seed_inputs(f):</code> |
| `lock_order_probe` | function | 38 | <code>def lock_order_probe(f):</code> |
| `invoke` | function | 50 | <code>def invoke():</code> |
| `graph_custody_probe` | function | 75 | <code>def graph_custody_probe(f,seed):</code> |
| `inspect` | function | 89 | <code>def inspect(run):</code> |
| `main` | function | 96 | <code>def main():</code> |
| `immutable_inputs` | function | 115 | <code>def immutable_inputs():</code> |
| `immutable_receipt` | function | 149 | <code>def immutable_receipt():</code> |
| `watcher1_missing` | function | 157 | <code>def watcher1_missing():</code> |
| `duplicate_cannot_fill` | function | 161 | <code>def duplicate_cannot_fill():</code> |
| `rank_cannot_certify` | function | 168 | <code>def rank_cannot_certify():</code> |
| `non_watcher_cannot_satisfy` | function | 174 | <code>def non_watcher_cannot_satisfy():</code> |
| `inspect_advisory` | function | 182 | <code>def inspect_advisory():</code> |
| `exact_observation` | function | 200 | <code>def exact_observation():</code> |
| `immutable_observation` | function | 204 | <code>def immutable_observation():</code> |

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
| `watch` | function | 274 | <code>def watch():</code> |
| `demote` | function | 280 | <code>def demote():os.setgid(self.uid);os.setuid(self.uid)</code> |
| `close` | method | 302 | <code>def close(self):</code> |
| `remote_runtime` | function | 304 | <code>def remote_runtime(f,folder,executor,objects):</code> |
| `runtime_start` | function | 318 | <code>def runtime_start():</code> |
| `load_objects` | function | 325 | <code>def load_objects():</code> |
| `remote_executions` | function | 331 | <code>def remote_executions(f,folder,request,planned,verifier,bound):</code> |
| `guarded` | function | 364 | <code>def guarded(callback):</code> |
| `run` | function | 365 | <code>def run():</code> |
| `bound_receipt` | function | 372 | <code>def bound_receipt(name,variant,outcome,commit):</code> |
| `component_pass` | function | 377 | <code>def component_pass(name):</code> |
| `integrated` | function | 384 | <code>def integrated():</code> |
| `replay` | function | 391 | <code>def replay():</code> |
| `placement` | function | 396 | <code>def placement():</code> |
| `control_host` | function | 406 | <code>def control_host():</code> |
| `main` | function | 420 | <code>def main():</code> |
| `immutable` | function | 446 | <code>def immutable():</code> |
| `guidance` | function | 452 | <code>def guidance():</code> |

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
| `setup` | function | 104 | <code>def setup(f):</code> |
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
| `call` | function | 35 | <code>def call(action,payload):return common.call(f,action,payload,component='finding-github')</code> |
| `reject` | function | 36 | <code>def reject(action,payload,code=None):return common.reject(f,action,payload,code,component='finding-github')</code> |
| `delivery` | function | 60 | <code>def delivery(issue,identity=None,signature=None):</code> |
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
| `call` | function | 33 | <code>def call(action,payload,key='operator'):return c.call(f,action,payload,component='finding-routing',key=key)</code> |
| `reject` | function | 34 | <code>def reject(action,payload,code=None,key='operator'):return c.reject(f,action,payload,code,component='finding-routing',key=key)</code> |
| `version` | function | 35 | <code>def version(fid):return str(c.call(f,'finding.inspect',{'finding_id':fid})&#91;'finding'&#93;&#91;'registry_version'&#93;)</code> |
| `restart_durable` | function | 45 | <code>def restart_durable():</code> |

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
| `call` | function | 128 | <code>def call(action,payload):return c.call(f,action,payload,component='finding-remediation')</code> |
| `reject` | function | 129 | <code>def reject(action,payload,code=None):return c.reject(f,action,payload,code,component='finding-remediation')</code> |
| `finding_version` | function | 130 | <code>def finding_version(fid):return str(c.call(f,'finding.inspect',{'finding_id':fid})&#91;'finding'&#93;&#91;'registry_version'&#93;)</code> |
| `repair_version` | function | 131 | <code>def repair_version(rid):return str(f.sql('SELECT state_version::text AS version FROM hyperfide.finding_repairs WHERE id=$1',&#91;rid&#93;)&#91;0&#93;&#91;'version'&#93;)</code> |

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
| `dependency` | function | 115 | <code>def dependency(name):</code> |
| `setup` | function | 122 | <code>def setup(real):</code> |
| `close` | method | 144 | <code>def close(self):</code> |
| `g` | method | 152 | <code>def g(self,args,allow_error=False):</code> |
| `invoke` | method | 154 | <code>def invoke(self,component,action,value):</code> |
| `reject` | method | 162 | <code>def reject(self,component,action,value,code):</code> |
| `wire` | method | 165 | <code>def wire(self):</code> |
| `GET /result` | route | 168 | <code>data=row.get("result",row.get("output",{}))</code> |
| `canon` | function | 170 | <code>def canon(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False)</code> |
| `sha` | function | 171 | <code>def sha(value):return "sha256:"+hashlib.sha256(value.encode() if isinstance(value,str) else value).hexdigest()</code> |
| `q` | function | 172 | <code>def q(value):return "NULL" if value is None else "'"+str(value).replace("'","''")+"'"</code> |
| `integration_seed` | function | 173 | <code>def integration_seed(ids,run,repository,oids,gate):</code> |
| `candidate_cases` | function | 206 | <code>def candidate_cases(f):</code> |
| `conflict` | function | 215 | <code>def conflict():</code> |
| `immutable` | function | 221 | <code>def immutable():</code> |
| `integration_cases` | function | 229 | <code>def integration_cases(f):</code> |
| `prepare` | function | 232 | <code>def prepare():</code> |
| `commit` | function | 237 | <code>def commit(name,base,filename):</code> |
| `db` | function | 253 | <code>def db(statement,values=None):return f.auth.sql(statement,values or &#91;&#93;)</code> |
| `result` | function | 254 | <code>def result(row):</code> |
| `GET /result` | route | 255 | <code>expect(row.get("ok") is True,"Service refused: "+json.dumps(row)&#91;:1500&#93;);return row.get("result",row.get("output"))</code> |
| `status` | function | 256 | <code>def status(candidate):return result(f.invoke(TASK,"integration.candidate.status",{&#42;&#42;SCOPE,"candidate_id":candidate}))</code> |
| `remote_required` | function | 257 | <code>def remote_required():</code> |
| `combined_rejected` | function | 267 | <code>def combined_rejected():</code> |
| `successor_held` | function | 280 | <code>def successor_held():</code> |
| `level_status` | function | 291 | <code>def level_status():</code> |
| `history` | function | 305 | <code>def history():return &#91;&#91;r&#91;"v"&#93; for r in db(sql_text,&#91;&#91;U(610),U(611),U(740),U(741)&#93;&#93; if "$1" in sql_text else &#91;&#93;)&#93; for sql_text in history_sql&#93;</code> |
| `input_changed` | function | 306 | <code>def input_changed():</code> |
| `history_intact` | function | 318 | <code>def history_intact():</code> |
| `leftovers` | function | 325 | <code>def leftovers():</code> |
| `refs_of` | function | 331 | <code>def refs_of(directory):return run(&#91;"git","--git-dir="+str(directory if directory==f.receive else directory/".git"),"for-each-ref","--format=%(refname)","refs/hyperfide/integration/"&#93;).stdout.split()</code> |
| `cleanup_reconciles` | function | 332 | <code>def cleanup_reconciles():</code> |
| `cleanup_idempotent` | function | 344 | <code>def cleanup_idempotent():</code> |
| `adopt_orphans` | function | 352 | <code>def adopt_orphans():</code> |
| `reap_orphans` | function | 356 | <code>def reap_orphans(keep):</code> |
| `publication_cases` | function | 374 | <code>def publication_cases(f):</code> |
| `publication_checks` | function | 378 | <code>def publication_checks(f):</code> |
| `unsigned` | function | 387 | <code>def unsigned():</code> |
| `immutable_admission` | function | 392 | <code>def immutable_admission():</code> |
| `target_exclusive` | function | 397 | <code>def target_exclusive():</code> |
| `unsupported_github` | function | 402 | <code>def unsupported_github():</code> |
| `GET /result` | route | 404 | <code>result=row.get("result",row.get("output",{}))</code> |
| `https_isolated` | function | 455 | <code>def https_isolated():</code> |
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
| `GET /result` | route | 521 | <code>return row.get("result",row.get("output",{}))</code> |
| `closure_unmet` | function | 522 | <code>def closure_unmet(result):return set(result&#91;"status"&#93;&#91;"unmet_obligations"&#93;)</code> |
| `closure_release` | function | 523 | <code>def closure_release(result,key):return &#91;d for d in result&#91;"dependency_release"&#93; if d&#91;"task_key"&#93;==key&#93;</code> |
| `publication_gateway_cases` | function | 524 | <code>def publication_gateway_cases(f,module):</code> |
| `rg` | function | 531 | <code>def rg(&#42;args):return run(&#91;"git","--git-dir="+str(f.receive),&#42;args&#93;,env=f.gitenv).stdout.strip()</code> |
| `state` | function | 532 | <code>def state(table,ident):return a.sql("SELECT state FROM hyperfide."+table+" WHERE organisation_id=$1 AND run_id=$2 AND id=$3",&#91;org,runid,ident&#93;)&#91;0&#93;&#91;"state"&#93;</code> |
| `admissions` | function | 533 | <code>def admissions(op):return int(a.sql("SELECT count(&#42;)::int AS n FROM hyperfide.publication_gateway_admissions WHERE organisation_id=$1 AND run_id=$2 AND operation_id=$3",&#91;org,runid,op&#93;)&#91;0&#93;&#91;"n"&#93;)</code> |
| `call` | function | 534 | <code>def call(action,value):return f.invoke(TASK,action,{"organisation_id":org,"run_id":runid,&#42;&#42;value})</code> |
| `refused` | function | 535 | <code>def refused(row,code):expect(row.get("ok") is False and row.get("error",{}).get("code")==code,"Expected "+code+": "+json.dumps(row)&#91;:600&#93;)</code> |
| `permit` | function | 536 | <code>def permit(op,old,next_,digest,key=None):</code> |
| `worker_push` | function | 540 | <code>def worker_push(oid,token=None):</code> |
| `candidate` | function | 570 | <code>def candidate(old,next_,ba,generation,policy=None):</code> |
| `intent` | function | 580 | <code>def intent(c,op_state,intent_state):</code> |
| `head_advanced` | function | 588 | <code>def head_advanced():</code> |
| `stale_worker` | function | 597 | <code>def stale_worker():</code> |
| `direct_push` | function | 605 | <code>def direct_push():</code> |
| `unknown` | function | 619 | <code>def unknown():</code> |
| `not_superseded` | function | 624 | <code>def not_superseded():</code> |
| `custody_held` | function | 632 | <code>def custody_held():</code> |
| `sql_error` | function | 636 | <code>def sql_error(statement,values):</code> |
| `reconciled` | function | 641 | <code>def reconciled():</code> |
| `release_held` | function | 649 | <code>def release_held():</code> |
| `changed_inputs` | function | 658 | <code>def changed_inputs():</code> |
| `closure_cases` | function | 666 | <code>def closure_cases(f):</code> |
| `policy_refuse` | function | 673 | <code>def policy_refuse(field):</code> |
| `immutable` | function | 678 | <code>def immutable():</code> |
| `reject_unregistered` | function | 682 | <code>def reject_unregistered():</code> |
| `mismatch` | function | 687 | <code>def mismatch():</code> |
| `programme_cases_registered` | function | 692 | <code>def programme_cases_registered():</code> |
| `qualified_only` | function | 699 | <code>def qualified_only():</code> |
| `lease_expiry` | function | 705 | <code>def lease_expiry():</code> |
| `competing_custody` | function | 711 | <code>def competing_custody():</code> |
| `without_acceptance` | function | 721 | <code>def without_acceptance():</code> |
| `accepted` | function | 727 | <code>def accepted():</code> |
| `held_despite_tasks` | function | 731 | <code>def held_despite_tasks():</code> |
| `blocking_finding` | function | 737 | <code>def blocking_finding():</code> |
| `withheld` | function | 744 | <code>def withheld():</code> |
| `own_status` | function | 749 | <code>def own_status():</code> |
| `GET /result` | route | 753 | <code>row=f.invoke(TASK,"integration.closure.inspect",{&#42;&#42;SCOPE,"evaluation_id":result&#91;"evaluation_id"&#93;});stored=row.get("result",row.get("output",{}))</code> |
| `requires_programme_cases` | function | 758 | <code>def requires_programme_cases():</code> |
| `programme_cases_current` | function | 763 | <code>def programme_cases_current():</code> |
| `each_wave` | function | 774 | <code>def each_wave():</code> |
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
| `GET /result` | route | 852 | <code>return row.get("result",row.get("output",{}))</code> |
| `by_repo` | function | 853 | <code>def by_repo(result):return {o&#91;"repository_id"&#93;:o for o in result&#91;"outcomes"&#93;}</code> |
| `release_cases` | function | 854 | <code>def release_cases(f):</code> |
| `immutable` | function | 859 | <code>def immutable():</code> |
| `interrupted_unknown` | function | 865 | <code>def interrupted_unknown():</code> |
| `interrupted_partial` | function | 883 | <code>def interrupted_partial():</code> |
| `recorded_policy` | function | 894 | <code>def recorded_policy():</code> |
| `advance` | function | 900 | <code>def advance():</code> |
| `successor_release` | function | 915 | <code>def successor_release():</code> |
| `audit` | function | 925 | <code>def audit():</code> |
| `compensation_required` | function | 933 | <code>def compensation_required():</code> |
| `direct_push_refused` | function | 945 | <code>def direct_push_refused():</code> |
| `through_gateway` | function | 953 | <code>def through_gateway():</code> |
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
| `setup` | function | 32 | <code>def setup(f):</code> |
| `restart` | function | 36 | <code>def restart(value):</code> |
| `invoke` | function | 41 | <code>def invoke(job='supervision',tool='supervise',profile=None,payload=None,action='placement.check',credential=None):</code> |
| `accepted` | function | 45 | <code>def accepted(&#42;&#42;kw):</code> |
| `rejected` | function | 47 | <code>def rejected(code='PLACEMENT_DENIED',&#42;&#42;kw):</code> |
| `negative` | function | 62 | <code>def negative(keys=keys,value=value):</code> |
| `bad_expiry` | function | 68 | <code>def bad_expiry(expiry=expiry):</code> |
| `bad_binding` | function | 80 | <code>def bad_binding(value=value):restart(json.dumps(value));rejected()</code> |
| `missing` | function | 82 | <code>def missing():restart(None);rejected()</code> |
| `authenticated_checks` | function | 91 | <code>def authenticated_checks():</code> |
| `setup` | function | 92 | <code>def setup(f):</code> |
| `call` | function | 100 | <code>def call(action,payload,key='provisioner',credential=None):</code> |
| `ok` | function | 103 | <code>def ok(action,payload,&#42;&#42;kwargs):</code> |
| `no` | function | 105 | <code>def no(action,payload,&#42;&#42;kwargs):</code> |
| `restart` | function | 107 | <code>def restart(boot,host='main'):</code> |
| `forged_invocation` | function | 110 | <code>def forged_invocation():</code> |
| `admitted` | function | 144 | <code>def admitted(runner_action=runner_action,job=job,tool=tool):</code> |
| `envelope_binding` | function | 162 | <code>def envelope_binding():</code> |
| `run_remote` | function | 184 | <code>def run_remote(expected_job):</code> |
| `delegated` | function | 197 | <code>def delegated(job=job):</code> |
| `exec_replay` | function | 209 | <code>def exec_replay():</code> |
| `completion_conflict` | function | 218 | <code>def completion_conflict():</code> |
| `drained` | function | 222 | <code>def drained():</code> |
| `audited` | function | 229 | <code>def audited():audit.update(ok('placement.audit',{},key='operator'))</code> |
| `attribution` | function | 233 | <code>def attribution():</code> |
| `stale_boot` | function | 243 | <code>def stale_boot():</code> |
| `newer_boot` | function | 248 | <code>def newer_boot():</code> |
| `foreign_host` | function | 253 | <code>def foreign_host():</code> |
| `supervisor_checks` | function | 268 | <code>def supervisor_checks():</code> |
| `setup` | function | 269 | <code>def setup(f):</code> |
| `call` | function | 288 | <code>def call(action,payload,key='leader',component='1.1'):return f.invoke(action,payload,key=key,component=component)&#91;1&#93;</code> |
| `ok` | function | 289 | <code>def ok(action,payload,&#42;&#42;kwargs):</code> |
| `no` | function | 291 | <code>def no(payload,&#42;&#42;kwargs):expect(call('placement.supervisor.authorize',payload,&#42;&#42;kwargs).get('ok') is False,'invalid main session admitted')</code> |
| `authorised` | function | 298 | <code>def authorised(request,key,role):</code> |

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
| `invoke` | function | 42 | <code>def invoke(action,payload,key='operator',component='1.2'):</code> |
| `ok` | function | 44 | <code>def ok(action,payload,&#42;&#42;kwargs):</code> |
| `no` | function | 46 | <code>def no(action,payload,&#42;&#42;kwargs):expect(invoke(action,payload,&#42;&#42;kwargs).get('ok') is False,'unsafe intent accepted')</code> |
| `request` | function | 47 | <code>def request(kind='INTENT',generation='1',package=False):</code> |
| `deliveries` | function | 50 | <code>def deliveries(event):return f.sql('SELECT consumer_id FROM hyperfide.event_deliveries WHERE event_id=$1 ORDER BY consumer_id',&#91;event&#93;)</code> |
| `bind` | function | 51 | <code>def bind(session,consumer):</code> |
| `concurrent_idempotence` | function | 67 | <code>def concurrent_idempotence():</code> |
| `envelope_binding` | function | 73 | <code>def envelope_binding():</code> |
| `human_change` | function | 84 | <code>def human_change(kind=kind):</code> |
| `autonomous` | function | 96 | <code>def autonomous(operation=operation):</code> |
| `consumed` | function | 105 | <code>def consumed(operation=operation):</code> |
| `unapproved_executor` | function | 115 | <code>def unapproved_executor():</code> |
| `manager_loss` | function | 131 | <code>def manager_loss():</code> |
| `survived_restart` | function | 138 | <code>def survived_restart():</code> |
| `delivered_once` | function | 201 | <code>def delivered_once():</code> |

## tests/hyperfide/cases/tasks/1_3.py

[Open source](../tests/hyperfide/cases/tasks/1_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 7 | <code>def check(name,fn):</code> |
| `expect` | function | 11 | <code>def expect(ok,message='unexpected service outcome'):</code> |
| `sha` | function | 13 | <code>def sha(text):return 'sha256:'+hashlib.sha256(text.encode()).hexdigest()</code> |
| `profile` | function | 14 | <code>def profile(connector,alias):</code> |
| `setup` | function | 34 | <code>def setup(f):</code> |
| `canon` | function | 60 | <code>def canon(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False)</code> |
| `admit` | function | 65 | <code>def admit(dims,expires="clock_timestamp()+interval '1 hour'"):</code> |
| `invoke` | function | 73 | <code>def invoke(config=None,payload=None,trusted=True,role='control',action='frontier.check'):</code> |
| `accepted` | function | 77 | <code>def accepted(payload=None):</code> |
| `rejected` | function | 79 | <code>def rejected(config=None,payload=None,&#42;&#42;kw):expect(invoke(config,payload,&#42;&#42;kw).get('ok') is False,'unsafe route accepted')</code> |
| `mutate` | function | 80 | <code>def mutate(path,value):</code> |
| `actual_unqualified` | function | 124 | <code>def actual_unqualified():</code> |
| `refuse_file_only` | function | 129 | <code>def refuse_file_only():</code> |
| `receipt_body` | function | 138 | <code>def receipt_body(native,&#42;&#42;changes):</code> |
| `envelope` | function | 145 | <code>def envelope(body,key='qualifier'):return {'body':body,'signature_b64':f.sign(key,canon(body).encode())}</code> |
| `write_receipts` | function | 147 | <code>def write_receipts(envelopes,mode=0o600):</code> |
| `qualified` | function | 149 | <code>def qualified(connector):</code> |
| `select` | function | 160 | <code>def select(task,admission=None,config=None,receipts=None,key='operator',&#42;&#42;changes):</code> |
| `selected` | function | 164 | <code>def selected(task,&#42;&#42;kw):</code> |
| `denied` | function | 166 | <code>def denied(code,task,&#42;&#42;kw):</code> |
| `stored` | function | 168 | <code>def stored(selection_id):</code> |
| `qualified_sustained` | function | 170 | <code>def qualified_sustained():</code> |
| `qualified_short` | function | 177 | <code>def qualified_short():</code> |
| `recorded` | function | 180 | <code>def recorded():</code> |
| `measured` | function | 186 | <code>def measured():</code> |
| `replay` | function | 193 | <code>def replay():</code> |
| `insecure` | function | 203 | <code>def insecure():</code> |
| `forged_snapshot` | function | 209 | <code>def forged_snapshot():</code> |
| `decision_route` | function | 214 | <code>def decision_route():</code> |
| `outcome` | function | 223 | <code>def outcome(selection_id,sequence,signal,evidence=None):</code> |
| `ok` | function | 225 | <code>def ok(row):expect(row.get('ok') is True,json.dumps(row)&#91;:600&#93;);return row&#91;'result'&#93;</code> |
| `code` | function | 226 | <code>def code(row,expected):expect(row.get('ok') is False and row.get('error',{}).get('code')==expected,'expected '+expected+': '+json.dumps(row)&#91;:600&#93;)</code> |
| `series` | function | 227 | <code>def series(task,signals):</code> |
| `distinct` | function | 229 | <code>def distinct():</code> |
| `errors` | function | 235 | <code>def errors():</code> |
| `limits` | function | 240 | <code>def limits():</code> |
| `auth` | function | 244 | <code>def auth():</code> |
| `noop` | function | 249 | <code>def noop():</code> |
| `verbose` | function | 254 | <code>def verbose():</code> |
| `progress_resets` | function | 258 | <code>def progress_resets():</code> |
| `recorded_outcomes` | function | 262 | <code>def recorded_outcomes():</code> |
| `replay_outcome` | function | 268 | <code>def replay_outcome():</code> |
| `gap` | function | 272 | <code>def gap():</code> |
| `unknown_signal` | function | 276 | <code>def unknown_signal():</code> |
| `escalated` | function | 279 | <code>def escalated():</code> |
| `budget` | function | 284 | <code>def budget():</code> |

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
| `case` | function | 168 | <code>def case(fixture):</code> |
| `registry_reject` | function | 176 | <code>def registry_reject(base, mutation, &#42;, before_import=True):</code> |
| `case` | function | 177 | <code>def case(fixture):</code> |
| `mutate_fragment` | function | 187 | <code>def mutate_fragment(fixture, mutation):</code> |
| `native_fixture` | function | 194 | <code>def native_fixture(base):</code> |
| `native_exec` | function | 213 | <code>def native_exec(directory, component="99.1", action="fixture.echo", text="{}&#92;n"):</code> |
| `authoring_fixture` | function | 217 | <code>def authoring_fixture(base):</code> |
| `authoring_command` | function | 229 | <code>def authoring_command(pack, tool, &#42;args):</code> |
| `main` | function | 234 | <code>def main():</code> |
| `role_test` | function | 238 | <code>def role_test(role=role):</code> |
| `case` | function | 239 | <code>def case(f):</code> |
| `cannot_approve` | function | 259 | <code>def cannot_approve():</code> |
| `case` | function | 260 | <code>def case(f):</code> |
| `denied_request` | function | 267 | <code>def denied_request():</code> |
| `case` | function | 268 | <code>def case(f):</code> |
| `authorize` | function | 275 | <code>def authorize():</code> |
| `reverse_close` | function | 302 | <code>def reverse_close():</code> |
| `case` | function | 303 | <code>def case(f):</code> |
| `pending_factory` | function | 311 | <code>def pending_factory():</code> |
| `case` | function | 312 | <code>def case(f):</code> |
| `pending_import` | function | 350 | <code>def pending_import():</code> |
| `case` | function | 351 | <code>def case(f):</code> |
| `request_test` | function | 389 | <code>def request_test(n=name,q=request,c=code):</code> |
| `case` | function | 390 | <code>def case(f):</code> |
| `stable_result_snapshot` | function | 397 | <code>def stable_result_snapshot():</code> |
| `case` | function | 398 | <code>def case(f):</code> |
| `linked` | function | 412 | <code>def linked():</code> |
| `native_negative` | function | 422 | <code>def native_negative(component,action,text,code=None):</code> |
| `native_fragment_test` | function | 430 | <code>def native_fragment_test(name=name):</code> |
| `pinned_build` | function | 459 | <code>def pinned_build():</code> |
| `validate_approved` | function | 476 | <code>def validate_approved():</code> |
| `preserve` | function | 482 | <code>def preserve():</code> |
| `check_no_write` | function | 498 | <code>def check_no_write():</code> |
| `structural_reject` | function | 504 | <code>def structural_reject(unknown=False):</code> |
| `draft_refusal` | function | 513 | <code>def draft_refusal():</code> |
| `workflow_refusal` | function | 520 | <code>def workflow_refusal(kind):</code> |
| `extra_structural_refusal` | function | 545 | <code>def extra_structural_refusal(kind):</code> |
| `draft_control` | function | 563 | <code>def draft_control():</code> |
| `history` | function | 585 | <code>def history():</code> |
| `canonical_source_order` | function | 591 | <code>def canonical_source_order():</code> |

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
| `check` | function | 104 | <code>def check(identity,fn):</code> |
| `success` | function | 108 | <code>def success(action,input=None,env=None):</code> |
| `rejected` | function | 112 | <code>def rejected(input,code="DECISION_SCHEMA"):</code> |
| `routes` | function | 115 | <code>def routes():</code> |
| `unknown_qualification` | function | 121 | <code>def unknown_qualification():</code> |
| `prepared` | function | 128 | <code>def prepared(rid=rid,model=model):</code> |
| `transport` | function | 146 | <code>def transport(rid=rid,model=model):</code> |
| `missing_credential` | function | 154 | <code>def missing_credential():</code> |
| `unqualified` | function | 162 | <code>def unqualified():</code> |
| `negative` | function | 167 | <code>def negative(mode=mode,code=code):</code> |
| `legacy` | function | 176 | <code>def legacy():</code> |
| `reserved` | function | 181 | <code>def reserved():</code> |
| `gateway_media` | function | 193 | <code>def gateway_media():</code> |
| `main` | function | 203 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/20_2.py

[Open source](../tests/hyperfide/cases/tasks/20_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `request` | function | 23 | <code>def request(kind="noul"):</code> |
| `response` | function | 28 | <code>def response(kind="noul"):</code> |
| `identity` | function | 33 | <code>def identity():</code> |
| `main` | function | 37 | <code>def main():</code> |
| `check` | function | 42 | <code>def check(i,fn):</code> |
| `validate` | function | 46 | <code>def validate(req,res):</code> |
| `reject` | function | 50 | <code>def reject(req,res):</code> |
| `half` | function | 53 | <code>def half():</code> |
| `ninety` | function | 57 | <code>def ninety():</code> |
| `normalization` | function | 62 | <code>def normalization():</code> |
| `preview` | function | 80 | <code>def preview():</code> |
| `evaluate` | function | 84 | <code>def evaluate(calibration=False):</code> |
| `attestation` | function | 95 | <code>def attestation():</code> |
| `invalid_identity` | function | 104 | <code>def invalid_identity():</code> |
| `prepared_transport` | function | 109 | <code>def prepared_transport(forged=False):</code> |

## tests/hyperfide/cases/tasks/20_3.py

[Open source](../tests/hyperfide/cases/tasks/20_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `png` | function | 20 | <code>def png(width=280,height=280):</code> |
| `chunk` | function | 21 | <code>def chunk(k,b):return struct.pack("&gt;I",len(b))+k+b+struct.pack("&gt;I",zlib.crc32(k+b)&amp;0xffffffff)</code> |
| `profile` | function | 24 | <code>def profile(route="span-native"):</code> |
| `main` | function | 30 | <code>def main():</code> |
| `check` | function | 35 | <code>def check(i,fn):</code> |
| `invoke` | function | 39 | <code>def invoke(inp,p=None,route=None,action=ACTIONS&#91;0&#93;):</code> |
| `good` | function | 43 | <code>def good(inp,p=None,route=None,action=ACTIONS&#91;0&#93;):</code> |
| `bad` | function | 45 | <code>def bad(inp,p=None,route=None):</code> |
| `req` | function | 47 | <code>def req(route="span-native",&#42;&#42;kw):return {"route_id":route,"request":{"state":"bounded synthetic source","questions":{"q":{"type":"noul","instructions":"Is target present?"}}},"timeout_ms":1000,&#42;&#42;kw}</code> |
| `media` | function | 48 | <code>def media(route="span-native",uri=None):</code> |
| `jev_assets` | function | 60 | <code>def jev_assets():</code> |
| `gateway` | function | 63 | <code>def gateway():</code> |
| `number` | function | 83 | <code>def number():</code> |
| `box` | function | 88 | <code>def box():</code> |
| `bill` | function | 92 | <code>def bill(route="ultra-native",p=None,&#42;&#42;kw):return good({"route_id":route,"questions":10,"state_tokens":10000,"question_tokens":0,&#42;&#42;kw},p,route,ACTIONS&#91;1&#93;)</code> |
| `shared_batch` | function | 95 | <code>def shared_batch():</code> |
| `observed` | function | 98 | <code>def observed():</code> |
| `expanded` | function | 104 | <code>def expanded():</code> |
| `key_context` | function | 110 | <code>def key_context():</code> |
| `output_price` | function | 115 | <code>def output_price():</code> |

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
| `setup` | function | 78 | <code>def setup(f):</code> |
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
| `timed` | function | 168 | <code>def timed(action,input,component,key="operator"):</code> |
| `core_state` | function | 184 | <code>def core_state(f,core):</code> |
| `deterministic` | function | 189 | <code>def deterministic(v,providers):</code> |
| `main` | function | 194 | <code>def main():</code> |
| `check` | function | 196 | <code>def check(i,fn):</code> |
| `basic` | function | 201 | <code>def basic():</code> |
| `admission` | function | 213 | <code>def admission():</code> |
| `isolation_guard` | function | 217 | <code>def isolation_guard():</code> |
| `replay` | function | 222 | <code>def replay():</code> |
| `validated` | function | 228 | <code>def validated():</code> |
| `immutable_attempt` | function | 232 | <code>def immutable_attempt():</code> |
| `immutable_result` | function | 237 | <code>def immutable_result():</code> |
| `receipt` | function | 243 | <code>def receipt():</code> |
| `replay_request` | function | 250 | <code>def replay_request():</code> |
| `business_version` | function | 258 | <code>def business_version():</code> |
| `changed_submission` | function | 263 | <code>def changed_submission():</code> |
| `stale_replay` | function | 269 | <code>def stale_replay():</code> |
| `scenario` | function | 283 | <code>def scenario(index,fn,mode="valid",delay=0,settings=None,second=None):</code> |
| `auth` | function | 294 | <code>def auth(f,p,o):</code> |
| `invalid` | function | 296 | <code>def invalid(f,p,o):</code> |
| `fallback` | function | 298 | <code>def fallback(f,p,o):</code> |
| `deadline` | function | 300 | <code>def deadline(f,p,o):</code> |
| `responsive` | function | 303 | <code>def responsive(f,p,o):</code> |
| `queue` | function | 308 | <code>def queue(f,p,o):</code> |
| `active` | function | 310 | <code>def active(f,p,o):</code> |
| `budget` | function | 314 | <code>def budget(f,p,o):</code> |
| `rate` | function | 316 | <code>def rate(f,p,o):</code> |
| `circuit` | function | 318 | <code>def circuit(f,p,o):</code> |
| `stale_admission` | function | 320 | <code>def stale_admission(f,p,o):</code> |
| `stale_completion` | function | 322 | <code>def stale_completion(f,p,o):</code> |
| `cancel_queued` | function | 325 | <code>def cancel_queued(f,p,o):</code> |
| `cancel_running` | function | 327 | <code>def cancel_running(f,p,o):</code> |
| `restart` | function | 330 | <code>def restart(f,p,o):</code> |
| `expired` | function | 332 | <code>def expired(f,p,o):</code> |
| `slow_freshness` | function | 334 | <code>def slow_freshness(f,p,o):</code> |
| `restart_inflight` | function | 340 | <code>def restart_inflight(f,p,o):</code> |
| `dispatch` | function | 342 | <code>def dispatch():</code> |
| `completion_deadline` | function | 350 | <code>def completion_deadline(f,p,o):</code> |
| `admission_deadline` | function | 356 | <code>def admission_deadline(f,p,o):</code> |
| `semantic_lock_order` | function | 361 | <code>def semantic_lock_order(f,p,o):</code> |
| `request` | function | 363 | <code>def request():box.append(f.invoke("decision.fixture.submit",inp,component="99.20"))</code> |
| `insert_freshness` | function | 388 | <code>def insert_freshness():</code> |
| `account_quota` | function | 397 | <code>def account_quota(f,p,o):</code> |
| `core_timeout` | function | 403 | <code>def core_timeout(f,p,o):</code> |
| `core_removed` | function | 421 | <code>def core_removed(f,p,o):</code> |

## tests/hyperfide/cases/tasks/21_1.py

[Open source](../tests/hyperfide/cases/tasks/21_1.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fragments` | function | 18 | <code>def fragments():</code> |
| `spec_closure` | function | 25 | <code>def spec_closure():</code> |
| `linkage_probe` | function | 35 | <code>def linkage_probe():</code> |
| `linked` | function | 48 | <code>def linked():</code> |
| `fails_closed` | function | 56 | <code>def fails_closed():</code> |
| `function_probe` | function | 64 | <code>def function_probe(env):</code> |
| `include_spec_closure` | function | 73 | <code>def include_spec_closure():</code> |
| `exec_module` | function | 78 | <code>def exec_module(loader,target):</code> |
| `init` | function | 82 | <code>def init(fixture,&#42;args,extra_components=(),&#42;&#42;kwargs):base(fixture,&#42;args,extra_components=tuple(extra_components)+names,&#42;&#42;kwargs)</code> |
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
| `check` | function | 30 | <code>def check(name,fn):</code> |
| `ExtendedFixture` | class | 46 | <code>class ExtendedFixture(original):</code> |
| `__init__` | method | 47 | <code>def __init__(self,&#42;args,&#42;&#42;kwargs):</code> |
| `setup` | function | 49 | <code>def setup(f):</code> |
| `sql` | method | 67 | <code>def sql(self,query,values=None,&#42;&#42;kwargs):</code> |
| `packet` | function | 87 | <code>def packet():</code> |
| `current` | function | 93 | <code>def current(packet_id):return f.inner.invoke("fixture.jobs.current",{"packet_id":packet_id},component="20.4")&#91;1&#93;</code> |
| `repeat_preserved` | function | 99 | <code>def repeat_preserved():</code> |
| `repeat_checkpoint` | function | 108 | <code>def repeat_checkpoint():</code> |
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
| `purposes` | function | 37 | <code>def purposes():</code> |
| `signed_probe` | function | 52 | <code>def signed_probe():</code> |
| `FakeAuthority` | class | 65 | <code>class FakeAuthority:</code> |
| `__init__` | method | 68 | <code>def __init__(self,folder,run,credential):</code> |
| `Handler` | class | 73 | <code>class Handler(http.server.BaseHTTPRequestHandler):</code> |
| `log_message` | method | 74 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 75 | <code>def do_POST(self):</code> |
| `close` | method | 100 | <code>def close(self):self.server.shutdown();self.server.server_close()</code> |
| `native_probe` | function | 102 | <code>def native_probe():</code> |
| `ask` | function | 117 | <code>def ask(purpose,env,observation='{"fixture":true}'):</code> |
| `descriptor` | function | 122 | <code>def descriptor(epoch):</code> |
| `local` | function | 124 | <code>def local():</code> |
| `offline` | function | 129 | <code>def offline():</code> |
| `real` | function | 140 | <code>def real():</code> |
| `routed` | function | 156 | <code>def routed():</code> |
| `refused` | function | 167 | <code>def refused(mode,code):</code> |
| `run` | function | 168 | <code>def run():</code> |
| `malformed` | function | 174 | <code>def malformed():</code> |
| `late` | function | 179 | <code>def late():</code> |
| `main` | function | 187 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/21_4.py

[Open source](../tests/hyperfide/cases/tasks/21_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `storage_helper` | function | 8 | <code>def storage_helper():</code> |
| `probe_inventory_file` | function | 14 | <code>def probe_inventory_file():</code> |
| `track_probe_fixtures` | function | 16 | <code>def track_probe_fixtures(identity_module):</code> |
| `record` | function | 19 | <code>def record(fixture):</code> |
| `cleanup_probe_fixtures` | function | 25 | <code>def cleanup_probe_fixtures(helper):</code> |
| `cleanup_task` | function | 41 | <code>def cleanup_task():</code> |
| `environment` | function | 54 | <code>def environment():</code> |
| `service_probe` | function | 65 | <code>def service_probe(task,env,directory):</code> |
| `run_task` | function | 99 | <code>def run_task(task):</code> |
| `uid` | function | 110 | <code>def uid(n):return "40000000-0000-0000-0000-"+str(n).zfill(12)</code> |
| `ensure_semantic_fence_schema` | function | 137 | <code>def ensure_semantic_fence_schema(f,service=None):</code> |
| `apply_advisory_fixture_migration` | function | 150 | <code>def apply_advisory_fixture_migration(f,name,service=None):</code> |
| `seed_advisory_amendment_source` | function | 165 | <code>def seed_advisory_amendment_source(f,service):</code> |
| `signed_authority_probe` | function | 198 | <code>def signed_authority_probe(include_findings=False,include_amendment=False,include_legacy=False):</code> |
| `setup` | function | 226 | <code>def setup(f):</code> |
| `call` | function | 247 | <code>def call(action,data,component="21.4",&#42;&#42;kwargs):return f.invoke(action,{"scope":scope,&#42;&#42;data},component=component,&#42;&#42;kwargs)&#91;1&#93;</code> |
| `amendment` | function | 251 | <code>def amendment(source):</code> |
| `analyse` | function | 254 | <code>def analyse(source):</code> |
| `positive` | function | 256 | <code>def positive():</code> |
| `invalid_graph` | function | 262 | <code>def invalid_graph():</code> |
| `weakened` | function | 266 | <code>def weakened():</code> |
| `stale` | function | 270 | <code>def stale():</code> |
| `wrong_digest` | function | 275 | <code>def wrong_digest():</code> |
| `untouched` | function | 280 | <code>def untouched():</code> |
| `read_context` | function | 286 | <code>def read_context():</code> |
| `no_eligibility` | function | 295 | <code>def no_eligibility():</code> |
| `legacy_declared` | function | 315 | <code>def legacy_declared():</code> |
| `legacy_abstains` | function | 324 | <code>def legacy_abstains():</code> |
| `legacy_result` | function | 333 | <code>def legacy_result():</code> |
| `legacy_input` | function | 341 | <code>def legacy_input():</code> |
| `no_grants` | function | 348 | <code>def no_grants():</code> |
| `durable_job_probe` | function | 365 | <code>def durable_job_probe():</code> |
| `check` | function | 373 | <code>def check(name,fn):</code> |
| `AdvisoryFixture` | class | 377 | <code>class AdvisoryFixture(jobs.Fixture):</code> |
| `start` | method | 378 | <code>def start(self):</code> |
| `legacy_real` | function | 423 | <code>def legacy_real():</code> |
| `legacy_egress` | function | 437 | <code>def legacy_egress():</code> |
| `egress_never_accepted` | function | 443 | <code>def egress_never_accepted():</code> |

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
| `inspect_packet` | function | 149 | <code>def inspect_packet():</code> |
| `reject` | function | 161 | <code>def reject(callback=callback):</code> |
| `late_receipt` | function | 164 | <code>def late_receipt():</code> |
| `source_after_receipt` | function | 169 | <code>def source_after_receipt():</code> |
| `later` | function | 171 | <code>def later(p):</code> |
| `signer_alias` | function | 175 | <code>def signer_alias():</code> |
| `normalized_duplicate` | function | 180 | <code>def normalized_duplicate():</code> |
| `forged_live` | function | 184 | <code>def forged_live():</code> |
| `invented_human` | function | 188 | <code>def invented_human():</code> |
| `wrong_label_binding` | function | 194 | <code>def wrong_label_binding():</code> |
| `shared_group` | function | 200 | <code>def shared_group():</code> |
| `overlapping_group` | function | 204 | <code>def overlapping_group():</code> |
| `duplicate` | function | 208 | <code>def duplicate():</code> |
| `uncertain` | function | 211 | <code>def uncertain():</code> |
| `tamper` | function | 216 | <code>def tamper():</code> |

## tests/hyperfide/cases/tasks/22_2.py

[Open source](../tests/hyperfide/cases/tasks/22_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `profiles` | function | 8 | <code>def profiles(f):</code> |
| `build_scorecard` | function | 12 | <code>def build_scorecard(f):</code> |
| `main` | function | 23 | <code>def main():</code> |
| `missing` | function | 39 | <code>def missing():</code> |
| `duplicate` | function | 42 | <code>def duplicate():</code> |
| `bad_mass` | function | 45 | <code>def bad_mass():</code> |
| `false_actual` | function | 50 | <code>def false_actual():</code> |
| `stale_calibration` | function | 55 | <code>def stale_calibration():</code> |
| `holdout_fit` | function | 59 | <code>def holdout_fit():</code> |
| `forged_receipt` | function | 63 | <code>def forged_receipt():</code> |
| `unknown_usage` | function | 67 | <code>def unknown_usage():</code> |
| `error_rate` | function | 73 | <code>def error_rate():</code> |

## tests/hyperfide/cases/tasks/22_3.py

[Open source](../tests/hyperfide/cases/tasks/22_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `build_trial` | function | 10 | <code>def build_trial(f,mode="controlled"):</code> |
| `approve` | function | 19 | <code>def approve(value):</code> |
| `main` | function | 35 | <code>def main():</code> |
| `missing_approval` | function | 47 | <code>def missing_approval():</code> |
| `changed_plan` | function | 50 | <code>def changed_plan():</code> |
| `overlap` | function | 54 | <code>def overlap():</code> |
| `duplicate` | function | 58 | <code>def duplicate():</code> |
| `wrong_arm` | function | 61 | <code>def wrong_arm():</code> |
| `incomplete_cost` | function | 67 | <code>def incomplete_cost():</code> |
| `incomplete` | function | 73 | <code>def incomplete():</code> |
| `invariant_stop` | function | 77 | <code>def invariant_stop():</code> |
| `budget_stop` | function | 83 | <code>def budget_stop():</code> |
| `shadow` | function | 89 | <code>def shadow():</code> |

## tests/hyperfide/cases/tasks/22_4.py

[Open source](../tests/hyperfide/cases/tasks/22_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 9 | <code>def main():</code> |
| `qualification` | function | 20 | <code>def qualification(kind,p=candidate):</code> |
| `drift` | function | 30 | <code>def drift():</code> |
| `drift_replay` | function | 35 | <code>def drift_replay():</code> |
| `expired_qualification` | function | 45 | <code>def expired_qualification():</code> |
| `substituted_scorecard` | function | 54 | <code>def substituted_scorecard():</code> |
| `missing_route` | function | 64 | <code>def missing_route():</code> |
| `stale_route` | function | 68 | <code>def stale_route():</code> |
| `component_proof` | function | 74 | <code>def component_proof():</code> |
| `missing_required_case` | function | 80 | <code>def missing_required_case():</code> |
| `invalid_policy` | function | 87 | <code>def invalid_policy():</code> |
| `unknown_override` | function | 92 | <code>def unknown_override():</code> |
| `missing_selfhost` | function | 96 | <code>def missing_selfhost():</code> |
| `optional` | function | 101 | <code>def optional(requested=requested):</code> |

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
| `add` | function | 86 | <code>def add(identity):</code> |
| `setup` | function | 94 | <code>def setup(parent):</code> |
| `request` | method | 118 | <code>def request(self,component,action,value=None,role="OPERATOR",run=RUN,unsigned=False):</code> |
| `ok` | method | 135 | <code>def ok(self,component,action,value=None,&#42;&#42;kw):</code> |
| `reject` | method | 137 | <code>def reject(self,component,action,value,code=None,&#42;&#42;kw):</code> |
| `__exit__` | method | 141 | <code>def __exit__(self,typ,value,tb):</code> |
| `finish` | function | 152 | <code>def finish():</code> |
| `views_cases` | function | 155 | <code>def views_cases(f):</code> |
| `replica_absent` | function | 158 | <code>def replica_absent():</code> |
| `distinct` | function | 171 | <code>def distinct():</code> |
| `future` | function | 178 | <code>def future():</code> |
| `priority` | function | 182 | <code>def priority():</code> |
| `live_pid` | function | 188 | <code>def live_pid():</code> |
| `evidence` | function | 197 | <code>def evidence():</code> |
| `graph` | function | 205 | <code>def graph():</code> |
| `integrated_label` | function | 211 | <code>def integrated_label():</code> |
| `cycle` | function | 216 | <code>def cycle():</code> |
| `large` | function | 220 | <code>def large():</code> |
| `main` | function | 224 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/23_2.py

[Open source](../tests/hyperfide/cases/tasks/23_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `budget_cases` | function | 9 | <code>def budget_cases(f):</code> |
| `read` | function | 10 | <code>def read(value=None):return f.ok("23.2","fleet.resources.sandbox-budgets",value)</code> |
| `qualified` | function | 30 | <code>def qualified():</code> |
| `page` | function | 41 | <code>def page():</code> |
| `accounting_cases` | function | 54 | <code>def accounting_cases(f,profiles,sample):</code> |
| `dims` | function | 84 | <code>def dims(r,density):return {d&#91;"dimension"&#93;:d for d in next(p for p in r&#91;"profiles"&#93; if p&#91;"declared_agents_per_sandbox"&#93;==density)&#91;"dimensions"&#93;}</code> |
| `sweep` | function | 85 | <code>def sweep():</code> |
| `reservations` | function | 89 | <code>def reservations():</code> |
| `scheduler` | function | 93 | <code>def scheduler():</code> |
| `provider` | function | 97 | <code>def provider():</code> |
| `children` | function | 101 | <code>def children():</code> |
| `hidden` | function | 105 | <code>def hidden():</code> |
| `distinct` | function | 109 | <code>def distinct():</code> |
| `reasons` | function | 113 | <code>def reasons():</code> |
| `main` | function | 118 | <code>def main():</code> |
| `profile` | function | 123 | <code>def profile(n,density):</code> |
| `stale` | function | 148 | <code>def stale():</code> |
| `distinct` | function | 154 | <code>def distinct():</code> |

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
| `run` | function | 28 | <code>def run(i,fn):</code> |
| `join` | function | 34 | <code>def join(threads):</code> |
| `main` | function | 36 | <code>def main():</code> |
| `packet` | function | 41 | <code>def packet(n,variant="CURRENT",values=None,kind="REPLAY",name="api_latency",phase="API"):</code> |
| `unknown_absent` | function | 46 | <code>def unknown_absent():</code> |
| `lifecycle` | function | 51 | <code>def lifecycle():</code> |
| `event_lag` | function | 61 | <code>def event_lag():</code> |
| `cardinality` | function | 71 | <code>def cardinality():</code> |
| `held_record` | function | 76 | <code>def held_record(n,receipt):</code> |
| `accepted` | function | 79 | <code>def accepted(results):</code> |
| `explicit` | function | 81 | <code>def explicit(results):</code> |
| `lock_pressure` | function | 83 | <code>def lock_pressure():</code> |
| `deadlock` | function | 96 | <code>def deadlock():</code> |
| `pool_pressure` | function | 111 | <code>def pool_pressure():</code> |
| `queue_separate` | function | 126 | <code>def queue_separate():</code> |
| `conflict` | function | 138 | <code>def conflict():</code> |
| `mismatch` | function | 142 | <code>def mismatch():</code> |
| `malformed` | function | 148 | <code>def malformed(field,value):</code> |
| `oversized` | function | 154 | <code>def oversized():</code> |
| `old` | function | 157 | <code>def old():</code> |
| `future` | function | 160 | <code>def future():</code> |
| `separate` | function | 165 | <code>def separate():</code> |
| `actual` | function | 170 | <code>def actual():</code> |
| `equivalent` | function | 174 | <code>def equivalent():</code> |

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
| `register` | function | 168 | <code>def register(identity,key):</code> |
| `notice` | function | 174 | <code>def notice(n):</code> |
| `credential_rejection` | function | 189 | <code>def credential_rejection():</code> |
| `budget` | function | 208 | <code>def budget():</code> |
| `acknowledged` | function | 220 | <code>def acknowledged():</code> |
| `redaction_surfaces` | function | 228 | <code>def redaction_surfaces():</code> |
| `late_ack` | function | 248 | <code>def late_ack():</code> |
| `packet` | function | 255 | <code>def packet(value,role="OPERATOR"):</code> |
| `raw_send` | function | 258 | <code>def raw_send(body,stamp=None,nonce=None,role="OPERATOR"):</code> |
| `state` | function | 270 | <code>def state():</code> |
| `refused` | function | 272 | <code>def refused(result,&#42;codes):</code> |
| `adversarial_timestamps` | function | 274 | <code>def adversarial_timestamps():</code> |
| `stale_replay` | function | 281 | <code>def stale_replay():</code> |
| `malformed_isolated` | function | 289 | <code>def malformed_isolated():</code> |
| `instruction_text_inert` | function | 299 | <code>def instruction_text_inert():</code> |
| `dedup_flood` | function | 308 | <code>def dedup_flood():</code> |
| `backlog` | function | 332 | <code>def backlog():</code> |
| `missing` | function | 338 | <code>def missing():</code> |

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
| `visit` | function | 75 | <code>def visit(name):</code> |
| `Fixture` | class | 83 | <code>class Fixture:</code> |
| `__init__` | method | 84 | <code>def __init__(self,task):</code> |
| `prepare` | function | 90 | <code>def prepare(identity):</code> |
| `request` | method | 106 | <code>def request(self,action,payload,component=None):</code> |
| `ok` | method | 111 | <code>def ok(self,action,payload,component=None):</code> |
| `rejected` | method | 113 | <code>def rejected(self,action,payload,code,component=None):</code> |
| `close` | method | 115 | <code>def close(self):self.identity.close()</code> |
| `setup` | function | 116 | <code>def setup(task):return Fixture(task)</code> |
| `observation_dir` | function | 117 | <code>def observation_dir():</code> |
| `cleanup` | function | 121 | <code>def cleanup(emit=True):</code> |
| `tests` | function | 165 | <code>def tests(f):</code> |
| `absent_supervisor` | function | 197 | <code>def absent_supervisor():</code> |
| `count_attempts` | function | 211 | <code>def count_attempts():return sql("SELECT count(&#42;) FROM hyperfide.attempts WHERE organisation_id='"+ORG+"' AND run_id='"+RUN+"';")</code> |
| `session` | function | 212 | <code>def session(snapshot,identity):</code> |
| `control_loss` | function | 214 | <code>def control_loss(f,initial,base):</code> |
| `leader_manager_loss` | function | 237 | <code>def leader_manager_loss():</code> |
| `session_liveness` | function | 242 | <code>def session_liveness(f):</code> |
| `consistent_checkpoint` | function | 266 | <code>def consistent_checkpoint():</code> |
| `diverged_source` | function | 270 | <code>def diverged_source():</code> |
| `limitation_reported` | function | 274 | <code>def limitation_reported():</code> |
| `run` | function | 278 | <code>def run(task,callback):</code> |

## tests/hyperfide/cases/tasks/24_2.py

[Open source](../tests/hyperfide/cases/tasks/24_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `tests` | function | 6 | <code>def tests(f):</code> |
| `immutable_source` | function | 30 | <code>def immutable_source():</code> |
| `stamp` | function | 40 | <code>def stamp(delta=0):return (datetime.now(timezone.utc)+timedelta(seconds=delta)).isoformat(timespec="milliseconds").replace("+00:00","Z")</code> |
| `target_sandbox` | function | 41 | <code>def target_sandbox(sandbox,slot):</code> |
| `checkpoint` | function | 43 | <code>def checkpoint(base,attempt,generation,sandbox,slot,session,support):</code> |
| `rejected_code` | function | 52 | <code>def rejected_code(f,action,payload):</code> |
| `restoration_flow` | function | 54 | <code>def restoration_flow(f):</code> |
| `primary_window` | function | 94 | <code>def primary_window():</code> |
| `immutable` | function | 122 | <code>def immutable(statement,message):</code> |
| `residue` | function | 129 | <code>def residue():</code> |

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
| `ask` | function | 53 | <code>def ask(payload):</code> |
| `unsigned` | function | 61 | <code>def unsigned():</code> |
| `refused` | function | 70 | <code>def refused():</code> |
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
| `unconfigured` | function | 52 | <code>def unconfigured():</code> |
| `tampered` | function | 58 | <code>def tampered():</code> |
| `measured` | function | 72 | <code>def measured(scenario):</code> |
| `no_replay` | function | 86 | <code>def no_replay():</code> |
| `blocked` | function | 96 | <code>def blocked():</code> |
| `reconciled` | function | 100 | <code>def reconciled():</code> |
| `all_reconciled` | function | 107 | <code>def all_reconciled():</code> |
| `incomplete` | function | 116 | <code>def incomplete():</code> |
| `identity_expiry` | function | 121 | <code>def identity_expiry():</code> |
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
| `legacy_describe` | function | 126 | <code>def legacy_describe():</code> |
| `legacy_capability` | function | 131 | <code>def legacy_capability():</code> |
| `legacy_input` | function | 137 | <code>def legacy_input():</code> |
| `legacy_unsigned` | function | 141 | <code>def legacy_unsigned():</code> |
| `setup` | function | 160 | <code>def setup(fixture):</code> |
| `request` | function | 183 | <code>def request(action,value):</code> |
| `ok` | function | 186 | <code>def ok(action,v):</code> |
| `reject` | function | 188 | <code>def reject(action,v,code):</code> |
| `unauthenticated` | function | 191 | <code>def unauthenticated():</code> |
| `wrong_scope` | function | 200 | <code>def wrong_scope():</code> |
| `legacy_role_scoped` | function | 205 | <code>def legacy_role_scoped():</code> |
| `schema_absent` | function | 209 | <code>def schema_absent():</code> |
| `unapproved_archive` | function | 231 | <code>def unapproved_archive():</code> |
| `preserve` | function | 238 | <code>def preserve():</code> |
| `independent_bytes` | function | 244 | <code>def independent_bytes():</code> |
| `restarted_archive` | function | 256 | <code>def restarted_archive():</code> |
| `external_observed` | function | 270 | <code>def external_observed():</code> |
| `kvx_unqualified` | function | 276 | <code>def kvx_unqualified():</code> |
| `commit_loss` | function | 291 | <code>def commit_loss():</code> |
| `reconcile_commit` | function | 299 | <code>def reconcile_commit():</code> |
| `typed_keys` | function | 306 | <code>def typed_keys():</code> |
| `rowid_shadow` | function | 310 | <code>def rowid_shadow():</code> |
| `lease_reconciliation` | function | 318 | <code>def lease_reconciliation():</code> |
| `table_columns` | function | 348 | <code>def table_columns(snapshot,table):</code> |
| `mapped` | function | 368 | <code>def mapped(import_id,table):</code> |
| `different_namespace` | function | 381 | <code>def different_namespace(source_name):</code> |
| `different_table` | function | 387 | <code>def different_table():</code> |
| `unicode_distinct` | function | 396 | <code>def unicode_distinct():</code> |
| `wrong_schema` | function | 405 | <code>def wrong_schema():</code> |

## tests/hyperfide/cases/tasks/25_2.py

[Open source](../tests/hyperfide/cases/tasks/25_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 7 | <code>def check(name,fn):</code> |
| `expect` | function | 12 | <code>def expect(v,message):</code> |
| `main` | function | 16 | <code>def main():</code> |
| `call` | function | 24 | <code>def call(action,input=None,env=None):</code> |
| `rejected` | function | 27 | <code>def rejected(action,code,input=None,env=None):</code> |
| `private` | function | 32 | <code>def private():</code> |
| `bootstrap_admission` | function | 37 | <code>def bootstrap_admission():</code> |
| `namespace` | function | 52 | <code>def namespace():</code> |
| `disable` | function | 57 | <code>def disable():</code> |
| `native_boundary` | function | 64 | <code>def native_boundary():</code> |
| `holder` | function | 71 | <code>def holder(script):</code> |
| `tamper` | function | 83 | <code>def tamper():</code> |
| `symlink` | function | 88 | <code>def symlink():</code> |
| `private_namespace` | function | 94 | <code>def private_namespace():</code> |
| `initial_namespace` | function | 101 | <code>def initial_namespace():</code> |
| `isolated_positive` | function | 117 | <code>def isolated_positive():</code> |
| `call` | function | 126 | <code>def call(action):</code> |
| `campaign_dir` | function | 173 | <code>def campaign_dir():</code> |
| `service_probe` | function | 175 | <code>def service_probe():</code> |
| `service_child` | function | 195 | <code>def service_child():</code> |
| `check` | function | 200 | <code>def check(name,fn):</code> |
| `setup` | function | 228 | <code>def setup(fixture):</code> |
| `visit` | function | 240 | <code>def visit(name):</code> |
| `call` | function | 251 | <code>def call(action,payload,opid=None,component="25.2"):</code> |
| `ok` | function | 255 | <code>def ok(action,payload,opid=None,component="25.2"):</code> |
| `rejected` | function | 257 | <code>def rejected(action,payload,code,opid=None,component="25.2"):</code> |
| `mutation` | function | 259 | <code>def mutation(action,generation,&#42;&#42;extra):</code> |
| `m` | function | 261 | <code>def m(name):return ok("migration.sqlite."+name&#91;0&#93;,name&#91;1&#93;,component="25.1")</code> |
| `inspect` | function | 262 | <code>def inspect():return ok("cutover.inspect",{"scope_id":run})</code> |
| `describe` | function | 264 | <code>def describe():</code> |
| `schema_gate` | function | 267 | <code>def schema_gate():</code> |
| `running` | function | 273 | <code>def running():</code> |
| `run_state` | function | 281 | <code>def run_state(state):F.sql("UPDATE hyperfide.runs SET state=$2,state_version=state_version+1 WHERE id=$1",&#91;run,state&#93;)</code> |
| `writable` | function | 283 | <code>def writable():</code> |
| `prepare` | function | 291 | <code>def prepare():</code> |
| `replay` | function | 299 | <code>def replay():</code> |
| `conflict` | function | 302 | <code>def conflict():</code> |
| `stale_generation` | function | 306 | <code>def stale_generation():</code> |
| `unquiesced_validate` | function | 317 | <code>def unquiesced_validate():</code> |
| `no_archive` | function | 322 | <code>def no_archive():</code> |
| `pre_quiesce` | function | 332 | <code>def pre_quiesce():</code> |
| `tampered` | function | 336 | <code>def tampered():</code> |
| `shadow` | function | 345 | <code>def shadow():</code> |
| `validate` | function | 354 | <code>def validate():</code> |
| `activate` | function | 361 | <code>def activate():</code> |
| `single` | function | 371 | <code>def single():</code> |
| `rollback_before` | function | 381 | <code>def rollback_before():</code> |
| `reprepare` | function | 387 | <code>def reprepare():</code> |
| `rollback_after` | function | 394 | <code>def rollback_after():</code> |
| `no_sqlite` | function | 402 | <code>def no_sqlite():</code> |
| `recover` | function | 406 | <code>def recover():</code> |
| `archive_never` | function | 412 | <code>def archive_never():</code> |
| `recorded` | function | 421 | <code>def recorded():</code> |
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
| `run` | function | 33 | <code>def run(args,root=plain,mode=None,config=None):</code> |
| `blocked` | function | 39 | <code>def blocked(args,code,root=distributed,mode=None,config=None):</code> |
| `mode_cache` | function | 48 | <code>def mode_cache(root,mode,expected_mode,freshness):</code> |
| `workflow_checks` | function | 80 | <code>def workflow_checks():</code> |
| `protected_reader_checks` | function | 94 | <code>def protected_reader_checks():</code> |
| `drop` | function | 102 | <code>def drop(gid=33025):</code> |
| `run` | function | 104 | <code>def run(mode,p,gid=33025):</code> |
| `foreign_group` | function | 110 | <code>def foreign_group():</code> |
| `supplementary_only` | function | 115 | <code>def supplementary_only():</code> |
| `supplemental` | function | 116 | <code>def supplemental():</code> |
| `writable_parent` | function | 121 | <code>def writable_parent():</code> |
| `mutable_owner_parent` | function | 126 | <code>def mutable_owner_parent():</code> |
| `symlink_parent` | function | 131 | <code>def symlink_parent():</code> |
| `hardlink` | function | 136 | <code>def hardlink():</code> |
| `malformed_run_context` | function | 145 | <code>def malformed_run_context():</code> |
| `catalog` | function | 159 | <code>def catalog():</code> |
| `network_checks` | function | 168 | <code>def network_checks():</code> |
| `invoke` | function | 176 | <code>def invoke(action,value,operation=None):</code> |
| `describe` | function | 183 | <code>def describe():</code> |
| `mutate` | function | 193 | <code>def mutate():</code> |
| `replay` | function | 198 | <code>def replay():</code> |
| `wrong_origin` | function | 203 | <code>def wrong_origin():</code> |
| `mcp` | function | 210 | <code>def mcp():</code> |
| `unknown_ack` | function | 225 | <code>def unknown_ack():</code> |
| `Proxy` | class | 231 | <code>class Proxy(http.server.BaseHTTPRequestHandler):</code> |
| `log_message` | method | 232 | <code>def log_message(self,&#42;args):pass</code> |
| `do_POST` | method | 233 | <code>def do_POST(self):</code> |
| `revoked` | function | 267 | <code>def revoked():</code> |
| `mapping_checks` | function | 276 | <code>def mapping_checks():</code> |
| `setup` | function | 279 | <code>def setup(f):</code> |
| `verify` | function | 287 | <code>def verify(result):</code> |
| `cli` | function | 292 | <code>def cli():</code> |
| `mcp` | function | 298 | <code>def mcp():</code> |
| `tool` | function | 305 | <code>def tool(name,id):</code> |
| `finite_policy` | function | 307 | <code>def finite_policy():</code> |
| `bad_policy` | function | 315 | <code>def bad_policy(fields,mode=0o600):</code> |
| `bootstrap` | function | 324 | <code>def bootstrap():</code> |
| `exchange` | function | 328 | <code>def exchange(value):</code> |
| `wrong_subject` | function | 348 | <code>def wrong_subject():</code> |
| `nonroot_signed` | function | 356 | <code>def nonroot_signed():</code> |
| `drop` | function | 367 | <code>def drop():</code> |
| `business_unknown_checks` | function | 388 | <code>def business_unknown_checks():</code> |
| `setup` | function | 397 | <code>def setup(f):</code> |
| `payload` | function | 405 | <code>def payload(data):</code> |
| `observed` | function | 407 | <code>def observed(result,data):</code> |
| `cli_unknown` | function | 413 | <code>def cli_unknown():</code> |
| `mcp_unknown` | function | 422 | <code>def mcp_unknown():</code> |

## tests/hyperfide/cases/tasks/25_3_workflow.py

[Open source](../tests/hyperfide/cases/tasks/25_3_workflow.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 9 | <code>def expect(value,message='Unexpected actual workflow behavior'):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `main` | function | 15 | <code>def main():</code> |
| `seed` | function | 16 | <code>def seed(f):</code> |
| `payload` | function | 19 | <code>def payload(task=None,&#42;&#42;extra):return dict(task=task or i&#91;'task'&#93;,leader_generation='1',package_generation='2',&#42;&#42;extra)</code> |
| `ok` | function | 20 | <code>def ok(action,value,key='leader'):</code> |
| `no` | function | 22 | <code>def no(action,value,code,key='leader'):</code> |
| `native_cli` | function | 37 | <code>def native_cli(sub,value):</code> |
| `verify_native` | function | 39 | <code>def verify_native(value):</code> |
| `cli_open` | function | 41 | <code>def cli_open():</code> |
| `cli_update` | function | 44 | <code>def cli_update():</code> |
| `native_mcp` | function | 47 | <code>def native_mcp(name,value):</code> |
| `mcp_update` | function | 50 | <code>def mcp_update():</code> |
| `native_receipt` | function | 53 | <code>def native_receipt():</code> |
| `exact_replay` | function | 69 | <code>def exact_replay():</code> |
| `conflict` | function | 72 | <code>def conflict():</code> |
| `budget` | function | 82 | <code>def budget():</code> |

## tests/hyperfide/cases/tasks/25_4.py

[Open source](../tests/hyperfide/cases/tasks/25_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 6 | <code>def expect(v,m):</code> |
| `check` | function | 8 | <code>def check(name,fn):</code> |
| `artifacts` | function | 13 | <code>def artifacts():</code> |
| `cleanup` | function | 15 | <code>def cleanup():</code> |
| `main` | function | 19 | <code>def main():</code> |
| `request` | function | 51 | <code>def request(action,value):</code> |
| `ok` | function | 54 | <code>def ok(action,value):</code> |
| `rejected` | function | 56 | <code>def rejected(action,value):</code> |
| `large_inventory` | function | 59 | <code>def large_inventory():</code> |
| `units_reported` | function | 88 | <code>def units_reported():</code> |
| `installable_unqualified` | function | 93 | <code>def installable_unqualified():</code> |
| `run_job` | function | 110 | <code>def run_job(apply=True,environment=None):</code> |
| `absent_credential` | function | 115 | <code>def absent_credential():</code> |
| `actual_apply` | function | 120 | <code>def actual_apply():</code> |
| `actual_inspect` | function | 131 | <code>def actual_inspect():</code> |
| `authenticated` | function | 146 | <code>def authenticated():</code> |
| `changed_signature` | function | 152 | <code>def changed_signature():</code> |
| `changed_key` | function | 157 | <code>def changed_key():</code> |
| `writable_key` | function | 164 | <code>def writable_key():</code> |
| `writable_ancestor` | function | 169 | <code>def writable_ancestor():</code> |
| `linked_key` | function | 174 | <code>def linked_key():</code> |
| `symlink_ancestor` | function | 179 | <code>def symlink_ancestor():</code> |
| `fifo_anchor` | function | 184 | <code>def fifo_anchor():</code> |
| `missing_signature` | function | 193 | <code>def missing_signature():</code> |
| `run_install` | function | 203 | <code>def run_install(arguments=None):</code> |
| `stage_service` | function | 207 | <code>def stage_service():</code> |
| `promote_service` | function | 213 | <code>def promote_service():</code> |
| `drop` | function | 216 | <code>def drop():</code> |
| `bad_signature_stage` | function | 223 | <code>def bad_signature_stage():</code> |
| `wrong_manifest_stage` | function | 230 | <code>def wrong_manifest_stage():</code> |
| `noncanonical_destination` | function | 235 | <code>def noncanonical_destination():</code> |
| `changed_source_during_copy` | function | 240 | <code>def changed_source_during_copy():</code> |
| `mutate` | function | 244 | <code>def mutate():</code> |
| `child_owned_destination` | function | 260 | <code>def child_owned_destination():</code> |

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
| `install` | function | 40 | <code>def install(env=None):</code> |
| `command` | function | 62 | <code>def command(name,&#42;args):return run(str(directory/name),&#42;args,cwd=base,env=e)</code> |

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
| `native_conflict` | function | 40 | <code>def native_conflict(canonical,legacy):</code> |
| `conflict` | function | 60 | <code>def conflict():</code> |
| `equal` | function | 64 | <code>def equal():</code> |

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
| `editor_commands` | function | 109 | <code>def editor_commands():</code> |
| `repo_guidance` | function | 117 | <code>def repo_guidance():</code> |

## tests/hyperfide/cases/tasks/26_4_bootstrap.py

[Open source](../tests/hyperfide/cases/tasks/26_4_bootstrap.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 9 | <code>def expect(value,message="Actual bootstrap contract differs"):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `main` | function | 15 | <code>def main():</code> |
| `invoke` | function | 31 | <code>def invoke(extra=None):</code> |

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
| `native` | function | 102 | <code>def native(&#42;args,extra=None,binary='hyperfide'):</code> |
| `main` | function | 125 | <code>def main():</code> |

## tests/hyperfide/cases/tasks/26_4_recovery.py

[Open source](../tests/hyperfide/cases/tasks/26_4_recovery.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 9 | <code>def expect(value,message='Actual bootstrap recovery contract differs'):</code> |
| `check` | function | 11 | <code>def check(name,fn):</code> |
| `main` | function | 15 | <code>def main():</code> |
| `invoke` | function | 30 | <code>def invoke(value,recover=True,extra=None):</code> |
| `recovery` | function | 38 | <code>def recovery(&#42;&#42;changes):</code> |
| `mutate` | function | 66 | <code>def mutate():</code> |

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
| `call` | function | 49 | <code>def call(action,value):</code> |
| `ok` | function | 52 | <code>def ok(action,value):</code> |
| `refused` | function | 54 | <code>def refused(action,value,code):</code> |
| `config` | function | 60 | <code>def config(&#42;&#42;changes):</code> |
| `write_config` | function | 76 | <code>def write_config(value,mode=0o600):</code> |
| `watch` | function | 78 | <code>def watch(path,extra=None):</code> |
| `healthy_answer` | function | 90 | <code>def healthy_answer(component,action,value):</code> |

## tests/hyperfide/cases/tasks/27_2.py

[Open source](../tests/hyperfide/cases/tasks/27_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 22 | <code>def check(identity, function):</code> |
| `reject` | function | 34 | <code>def reject(function, kind=d.CampaignError):</code> |
| `pin` | function | 41 | <code>def pin(path):</code> |
| `trace` | function | 46 | <code>def trace():</code> |
| `event` | function | 48 | <code>def event(kind, accepted=True, &#42;&#42;fields):</code> |
| `model` | function | 66 | <code>def model(events, sandboxes=100, slots=200):</code> |
| `small` | function | 72 | <code>def small(kind, accepted=True, sequence=1, &#42;&#42;fields):</code> |
| `activation` | function | 75 | <code>def activation(sequence=1):</code> |
| `mixed_load_checks` | function | 83 | <code>def mixed_load_checks():</code> |
| `parity_checks` | function | 119 | <code>def parity_checks():</code> |
| `adapter` | function | 133 | <code>def adapter(side,&#42;modes):</code> |
| `manifest` | function | 135 | <code>def manifest(case,legacy=(),candidate_modes=(),differences=(),adapters=None):</code> |
| `execute` | function | 141 | <code>def execute(case,&#42;&#42;options):</code> |
| `status` | function | 144 | <code>def status(results,name):</code> |
| `absent` | function | 149 | <code>def absent():</code> |
| `run` | function | 171 | <code>def run():</code> |
| `adapter` | function | 261 | <code>def adapter(name, specification=None):</code> |
| `escaped` | function | 272 | <code>def escaped(mode):</code> |
| `interrupted` | function | 294 | <code>def interrupted():</code> |
| `interrupt` | function | 301 | <code>def interrupt(process,&#42;args,&#42;&#42;kwargs):</code> |
| `constructor_interrupt` | function | 329 | <code>def constructor_interrupt():</code> |
| `launch_then_interrupt` | function | 334 | <code>def launch_then_interrupt(&#42;args,&#42;&#42;kwargs):</code> |
| `definite_spawn_failure` | function | 351 | <code>def definite_spawn_failure():</code> |
| `load` | function | 370 | <code>def load(candidate):</code> |
| `simulation_cli` | function | 388 | <code>def simulation_cli():</code> |
| `authority_case` | function | 401 | <code>def authority_case(name):</code> |

## tests/hyperfide/cases/tasks/27_3.py

[Open source](../tests/hyperfide/cases/tasks/27_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `check` | function | 16 | <code>def check(identity, action):</code> |
| `reject` | function | 24 | <code>def reject(action):</code> |
| `manifest` | function | 29 | <code>def manifest():</code> |
| `snapshot` | function | 32 | <code>def snapshot():</code> |
| `run` | function | 35 | <code>def run():</code> |
| `pin` | function | 87 | <code>def pin(path):</code> |
| `signed` | function | 93 | <code>def signed(changes=None):</code> |

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
| `checker_help` | function | 16 | <code>def checker_help():</code> |
| `qualifier_help` | function | 20 | <code>def qualifier_help():</code> |
| `authenticated` | function | 26 | <code>def authenticated():</code> |
| `request_cannot_approve` | function | 30 | <code>def request_cannot_approve():</code> |
| `wrong_scope` | function | 36 | <code>def wrong_scope():</code> |
| `restart` | function | 41 | <code>def restart():</code> |

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
| `GET /listener_absent` | route | 49 | <code>complete=bool(entries)and all(r.get("observed_absent")is True and r.get("listener_absent",True)is True for r in entries)</code> |
| `cleanup_only` | function | 56 | <code>def cleanup_only(task):</code> |
| `GET /service_started` | route | 67 | <code>listener_absent=not record.get("service_started",False)</code> |
| `canonical` | function | 84 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False).encode()</code> |
| `digest` | function | 85 | <code>def digest(value):return"sha256:"+hashlib.sha256(canonical(value)).hexdigest()</code> |
| `require` | function | 86 | <code>def require(value,message):</code> |
| `check` | function | 88 | <code>def check(name,callback):</code> |
| `component_files` | function | 92 | <code>def component_files(&#42;ids):</code> |
| `add` | function | 100 | <code>def add(component):</code> |
| `setup` | function | 107 | <code>def setup(f):</code> |
| `drop_documentation_schema` | function | 110 | <code>def drop_documentation_schema(f):</code> |
| `fixture` | function | 113 | <code>def fixture(extra=("28.2",),migrate=True):return IdentityFixture(extra_components=component_files(&#42;extra),extra_setup=setup if migrate else drop_documentation_schema)</code> |
| `call` | function | 114 | <code>def call(f,action,payload,component="28.2",ok=True,&#42;&#42;kwargs):</code> |
| `pins` | function | 118 | <code>def pins(f):return{"spec_revision_id":f.ids&#91;"spec"&#93;,"spec_generation":"1","programme_manifest_digest":digest("fixture-programme"),"source_manifest_digest":digest(&#91;&#93;)}</code> |
| `node` | function | 119 | <code>def node(script,value=None,env=None):</code> |
| `positive_fixture_setup` | function | 122 | <code>def positive_fixture_setup(f):</code> |
| `git` | function | 126 | <code>def git(&#42;args):</code> |
| `seed_checker` | function | 159 | <code>def seed_checker(f,packet_id,failed=False,cleanup='CONFIRMED'):</code> |
| `publish_relevant_change` | function | 169 | <code>def publish_relevant_change(f):</code> |
| `counts` | function | 183 | <code>def counts(f):</code> |
| `closures` | function | 186 | <code>def closures(f):return f.sql("SELECT count(&#42;)::int AS n FROM hyperfide.documentation_closures")&#91;0&#93;&#91;"n"&#93;</code> |
| `positive_persistence_probes` | function | 187 | <code>def positive_persistence_probes():</code> |
| `real_fragment` | function | 190 | <code>def real_fragment():</code> |
| `check_requires_verifier` | function | 199 | <code>def check_requires_verifier():</code> |
| `check_requires_bound_runner` | function | 204 | <code>def check_requires_bound_runner():</code> |
| `connector_exit` | function | 214 | <code>def connector_exit():</code> |
| `baseline_failure` | function | 225 | <code>def baseline_failure():</code> |
| `durable` | function | 240 | <code>def durable():</code> |
| `stale_inputs` | function | 249 | <code>def stale_inputs():</code> |
| `incremental` | function | 258 | <code>def incremental():</code> |
| `no_dispatch` | function | 268 | <code>def no_dispatch():</code> |
| `lost_fence` | function | 272 | <code>def lost_fence():</code> |
| `mismatch` | function | 294 | <code>def mismatch():</code> |
| `main` | function | 301 | <code>def main():</code> |
| `inspection_held` | function | 304 | <code>def inspection_held():</code> |
| `stale_spec` | function | 308 | <code>def stale_spec():</code> |
| `no_client_override` | function | 313 | <code>def no_client_override():</code> |
| `no_connector_success` | function | 316 | <code>def no_connector_success():</code> |
| `no_plain_transaction` | function | 320 | <code>def no_plain_transaction():</code> |
| `isolation_guards` | function | 324 | <code>def isolation_guards():</code> |
| `immutable` | function | 331 | <code>def immutable():</code> |
| `isolation_refusal` | function | 337 | <code>def isolation_refusal():</code> |
| `restart` | function | 343 | <code>def restart():</code> |

## tests/hyperfide/cases/tasks/28_3.py

[Open source](../tests/hyperfide/cases/tasks/28_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `controlled` | function | 30 | <code>def controlled(change="",positive=False):</code> |
| `portable_cleanup_resource` | function | 35 | <code>def portable_cleanup_resource(remove=False):</code> |
| `cleanup_readiness` | function | 52 | <code>def cleanup_readiness():</code> |
| `portable_cases` | function | 67 | <code>def portable_cases():</code> |
| `record_paths` | function | 79 | <code>def record_paths():H&#91;"fixture_artifact"&#93;("task-28.3-portable.json").write_text(json.dumps({"owner":"task:28.3","paths":paths,"observed_absent":all(not Path(p).exists()for p in paths)},sort_keys=True)+…</code> |
| `inspect` | function | 92 | <code>def inspect(expected=True,proof_assets=None):</code> |
| `immutable_qualified_assets` | function | 98 | <code>def immutable_qualified_assets():</code> |
| `closed_environment` | function | 109 | <code>def closed_environment():</code> |
| `exposed` | function | 127 | <code>def exposed():</code> |
| `locked` | function | 132 | <code>def locked():</code> |
| `missing_map` | function | 138 | <code>def missing_map():</code> |
| `changed_tool` | function | 145 | <code>def changed_tool():</code> |
| `changed_artifact` | function | 150 | <code>def changed_artifact():</code> |
| `missing_source_map` | function | 155 | <code>def missing_source_map():</code> |
| `read` | function | 173 | <code>def read(expected=True):</code> |
| `unsafe_index` | function | 177 | <code>def unsafe_index():</code> |
| `symlink_index` | function | 182 | <code>def symlink_index():</code> |
| `legacy_index` | function | 187 | <code>def legacy_index():</code> |
| `main` | function | 193 | <code>def main():</code> |
| `manifest_binding` | function | 220 | <code>def manifest_binding(tampered):</code> |
| `no_unadmitted` | function | 235 | <code>def no_unadmitted():</code> |
| `seal_unadmitted` | function | 240 | <code>def seal_unadmitted():</code> |
| `seal_guard` | function | 246 | <code>def seal_guard():</code> |

## tests/hyperfide/cases/tasks/28_4.py

[Open source](../tests/hyperfide/cases/tasks/28_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `kvx_sections` | function | 8 | <code>def kvx_sections(text):</code> |
| `independent_view` | function | 17 | <code>def independent_view(root):</code> |
| `controlled_pack` | function | 30 | <code>def controlled_pack(base,mismatches):</code> |
| `main` | function | 44 | <code>def main():</code> |
| `setup_archive` | function | 50 | <code>def setup_archive(f,pack_root=None):</code> |
| `implemented_verdict` | function | 66 | <code>def implemented_verdict():</code> |
| `review_states` | function | 86 | <code>def review_states():</code> |
| `private_audit` | function | 97 | <code>def private_audit():</code> |
| `stale_digest` | function | 104 | <code>def stale_digest():</code> |
| `archive_roundtrip` | function | 108 | <code>def archive_roundtrip():</code> |
| `archive_unknown_refused` | function | 127 | <code>def archive_unknown_refused():</code> |
| `accepted` | function | 133 | <code>def accepted():</code> |
| `mutate_states` | function | 140 | <code>def mutate_states(c,key,field,value):c&#91;"review_states"&#93;&#91;key&#93;&#91;field&#93;=value</code> |
| `reject` | function | 156 | <code>def reject(change=change):</code> |
| `tampered` | function | 161 | <code>def tampered():</code> |
| `stale_revision` | function | 166 | <code>def stale_revision():</code> |

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
| `setup` | function | 37 | <code>def setup(f):</code> |
| `_bootstrap` | method | 62 | <code>def _bootstrap(self,value,run,overrides=None):</code> |
| `_enrol` | method | 69 | <code>def _enrol(self,run):</code> |
| `request` | method | 76 | <code>def request(self,action,input,run,component="spec-import",overrides=None):</code> |
| `ok` | method | 94 | <code>def ok(self,&#42;args,&#42;&#42;kwargs):</code> |
| `reject` | method | 96 | <code>def reject(self,action,input,run,codes,&#42;&#42;kwargs):</code> |
| `source` | method | 98 | <code>def source(self,content=SOURCE):</code> |
| `envelope` | method | 101 | <code>def envelope(self,run,source=None):</code> |
| `probe` | function | 103 | <code>def probe(s):</code> |
| `imported` | function | 108 | <code>def imported():</code> |
| `concurrent_replay` | function | 124 | <code>def concurrent_replay():</code> |
| `badsource` | function | 133 | <code>def badsource(content,code):</code> |
| `changed_source` | function | 157 | <code>def changed_source():</code> |
| `pages` | function | 169 | <code>def pages():</code> |
| `export_reject` | function | 178 | <code>def export_reject(cursor,codes):</code> |
| `rollback` | function | 184 | <code>def rollback():</code> |
| `migration_readiness` | function | 193 | <code>def migration_readiness():</code> |
| `isolation` | function | 202 | <code>def isolation(table=table):</code> |
| `inspect_fence` | function | 209 | <code>def inspect_fence():</code> |
| `replay_fence` | function | 214 | <code>def replay_fence():</code> |
| `raw_refused` | function | 220 | <code>def raw_refused():</code> |
| `role_refused` | function | 226 | <code>def role_refused():</code> |
| `revoked` | function | 231 | <code>def revoked():</code> |
| `private_profile` | function | 239 | <code>def private_profile():</code> |
| `private_probe` | function | 257 | <code>def private_probe(service):</code> |
| `imported` | function | 276 | <code>def imported():</code> |
| `history` | function | 283 | <code>def history():</code> |
| `exported` | function | 287 | <code>def exported():</code> |
| `qualify_private` | function | 299 | <code>def qualify_private():</code> |
| `pin` | function | 314 | <code>def pin(path):</code> |
| `immutable` | function | 316 | <code>def immutable(path,value):</code> |
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
| `prepare` | function | 63 | <code>def prepare(f):</code> |
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
| `linked` | function | 126 | <code>def linked():</code> |
| `imported` | function | 131 | <code>def imported():</code> |
| `check_graph` | function | 136 | <code>def check_graph():</code> |
| `frontier` | function | 148 | <code>def frontier():</code> |
| `late_failure` | function | 157 | <code>def late_failure():</code> |
| `admit` | function | 166 | <code>def admit():</code> |
| `exact_edges` | function | 176 | <code>def exact_edges():</code> |
| `immutable` | function | 186 | <code>def immutable():</code> |
| `isolation` | function | 192 | <code>def isolation():</code> |
| `restart` | function | 198 | <code>def restart():</code> |
| `legacy_binding` | function | 205 | <code>def legacy_binding():</code> |
| `undeclared_binding` | function | 210 | <code>def undeclared_binding():</code> |
| `stale_binding` | function | 215 | <code>def stale_binding():</code> |
| `build_invalid` | function | 223 | <code>def build_invalid(f,plan):</code> |
| `invalid` | function | 240 | <code>def invalid(f,plan):</code> |
| `checked` | function | 242 | <code>def checked():</code> |
| `unqualified` | function | 249 | <code>def unqualified():</code> |
| `ownership` | function | 258 | <code>def ownership():</code> |
| `prose` | function | 262 | <code>def prose():</code> |
| `refusal` | function | 270 | <code>def refusal():</code> |
| `build_large` | function | 276 | <code>def build_large(f,plan):</code> |
| `large` | function | 283 | <code>def large(f,plan):</code> |
| `checked` | function | 285 | <code>def checked():</code> |
| `schema` | function | 291 | <code>def schema():</code> |
| `corpus_bytes` | function | 300 | <code>def corpus_bytes():return (ROOT/CORPUS).read_bytes()</code> |
| `build_corpus` | function | 301 | <code>def build_corpus(f,plan):</code> |
| `corpus` | function | 307 | <code>def corpus(f,plan):</code> |
| `unchanged` | function | 311 | <code>def unchanged():</code> |
| `records` | function | 317 | <code>def records():</code> |
| `genuine` | function | 322 | <code>def genuine():</code> |
| `resolve` | function | 331 | <code>def resolve():</code> |
| `joint_query` | function | 335 | <code>def joint_query():</code> |
| `not_completion` | function | 339 | <code>def not_completion():</code> |
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
| `analyse` | function | 136 | <code>def analyse():</code> |
| `active_impact` | function | 143 | <code>def active_impact():</code> |
| `propose` | function | 150 | <code>def propose():</code> |
| `provenance` | function | 155 | <code>def provenance():</code> |
| `immutable` | function | 160 | <code>def immutable():</code> |
| `scenario` | function | 171 | <code>def scenario(ident,source,code=None,purpose='REPLAN'):</code> |
| `body` | function | 172 | <code>def body():</code> |
| `invalid_rejected` | function | 190 | <code>def invalid_rejected():</code> |
| `explicit_revalidation` | function | 201 | <code>def explicit_revalidation():</code> |
| `during_execution` | function | 205 | <code>def during_execution():</code> |
| `versioned` | function | 212 | <code>def versioned():</code> |
| `replay` | function | 219 | <code>def replay():</code> |
| `stale` | function | 223 | <code>def stale():</code> |
| `active_compute` | function | 229 | <code>def active_compute():</code> |
| `revalidate` | function | 238 | <code>def revalidate():</code> |
| `evidence_stale` | function | 244 | <code>def evidence_stale():</code> |
| `requalify` | function | 252 | <code>def requalify():</code> |
| `decomposition` | function | 258 | <code>def decomposition():</code> |
| `derived` | function | 280 | <code>def derived(value):</code> |
| `components` | function | 283 | <code>def components():</code> |
| `include` | function | 289 | <code>def include(key):</code> |
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
| `register` | function | 132 | <code>def register():</code> |
| `restart` | function | 138 | <code>def restart():</code> |
| `immutable` | function | 200 | <code>def immutable(operation=operation):</code> |
| `existing_tx` | function | 219 | <code>def existing_tx():</code> |
| `concurrent` | function | 225 | <code>def concurrent():</code> |
| `crossrun` | function | 233 | <code>def crossrun():</code> |
| `role` | function | 240 | <code>def role():</code> |
| `accepted_task_command` | function | 245 | <code>def accepted_task_command():</code> |
| `accepted_empty_artifacts` | function | 254 | <code>def accepted_empty_artifacts():</code> |
| `legacy_unbound` | function | 262 | <code>def legacy_unbound():</code> |
| `unchanged_history` | function | 270 | <code>def unchanged_history():</code> |
| `changed_history` | function | 276 | <code>def changed_history():</code> |
| `revoked` | function | 281 | <code>def revoked():</code> |
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
| `setup` | function | 26 | <code>def setup(f):</code> |
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
| `described` | function | 100 | <code>def described():</code> |
| `inspected` | function | 107 | <code>def inspected():</code> |
| `history` | function | 114 | <code>def history():</code> |
| `mismatch` | function | 124 | <code>def mismatch():</code> |
| `third_wave` | function | 129 | <code>def third_wave():</code> |
| `blocked` | function | 138 | <code>def blocked():</code> |
| `unproven` | function | 146 | <code>def unproven():</code> |
| `wave_allocation` | function | 152 | <code>def wave_allocation():</code> |
| `wave_boundary` | function | 156 | <code>def wave_boundary():</code> |
| `closed` | function | 163 | <code>def closed():</code> |
| `sql_graph` | function | 171 | <code>def sql_graph():</code> |
| `cancelled` | function | 176 | <code>def cancelled():</code> |
| `unassigned` | function | 181 | <code>def unassigned():</code> |
| `domain_handoff` | function | 188 | <code>def domain_handoff():</code> |
| `withdrawn` | function | 196 | <code>def withdrawn():</code> |
| `GET /withdrawn` | route | 203 | <code>check("hierarchy.handoff.withdrawn-ack-refused",lambda:f.reject("hierarchy.package.handoff.acknowledge",{"idempotency_key":"ack-withdrawn","leader_generation":"1","handoff_id":state.get("withdrawn",ui…</code> |
| `withdraw_replay` | function | 204 | <code>def withdraw_replay():</code> |
| `single` | function | 208 | <code>def single():</code> |
| `manager_loss` | function | 212 | <code>def manager_loss():</code> |
| `leader_loss_recovery` | function | 220 | <code>def leader_loss_recovery(f,state):</code> |
| `GET /pending` | route | 223 | <code>ack={"idempotency_key":"ack-pending","leader_generation":"2","handoff_id":state.get("pending",uid())}</code> |
| `supersede` | function | 225 | <code>def supersede():</code> |
| `GET /pending` | route | 226 | <code>offered=f.ok("hierarchy.package.handoff.propose",proposal(f,"recovery-handoff","manager",lg="2",supersedes=state.get("pending",uid())),key=key)</code> |
| `recovered` | function | 232 | <code>def recovered():</code> |
| `GET /recovery` | route | 233 | <code>result=f.ok("hierarchy.package.handoff.acknowledge",{"idempotency_key":"ack-recovery","leader_generation":"2","handoff_id":state.get("recovery",uid())},key="manager")</code> |
| `readiness_refusals` | function | 240 | <code>def readiness_refusals(f):</code> |
| `refused` | function | 242 | <code>def refused():f.reject("hierarchy.describe",{},"HIERARCHY_SCHEMA_REQUIRED",key="manager")</code> |
| `provenance` | function | 243 | <code>def provenance():</code> |
| `table` | function | 252 | <code>def table():</code> |
| `startup` | function | 258 | <code>def startup():</code> |
| `main` | function | 273 | <code>def main():</code> |
| `envelope_binding` | function | 295 | <code>def envelope_binding():</code> |
| `GET /handoff_id` | route | 308 | <code>ack={"idempotency_key":"ack","leader_generation":"1","handoff_id":state.get("handoff_id",uid())}</code> |
| `immutable` | function | 315 | <code>def immutable():</code> |
| `isolation` | function | 319 | <code>def isolation():</code> |
| `race` | function | 325 | <code>def race():</code> |
| `request` | function | 326 | <code>def request(key):return f.invoke("hierarchy.leader.acquire",{"idempotency_key":"replace-"+key,"expected_generation":"1","reason":"Concurrent replacement"},component="3.1",key=key)&#91;1&#93;</code> |
| `revoked` | function | 336 | <code>def revoked():</code> |
| `absence` | function | 343 | <code>def absence():</code> |

## tests/hyperfide/cases/tasks/3_2.py

[Open source](../tests/hyperfide/cases/tasks/3_2.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `expect` | function | 12 | <code>def expect(value,message):</code> |
| `check` | function | 14 | <code>def check(identity,fn):</code> |
| `canonical` | function | 18 | <code>def canonical(value):return json.dumps(value,sort_keys=True,separators=(",",":"),ensure_ascii=False,allow_nan=False)</code> |
| `identity` | function | 19 | <code>def identity(value):return sha(canonical(value).encode())</code> |
| `dependencies` | function | 20 | <code>def dependencies(stems):</code> |
| `visit` | function | 26 | <code>def visit(stem):</code> |
| `parse_kvx` | function | 35 | <code>def parse_kvx(source):</code> |
| `accept_spec` | function | 37 | <code>def accept_spec(f,generation,criterion="A task packet SHALL identify exact inputs. Mandatory intent and constraints SHALL not be removed by context ranking."):</code> |
| `move_run` | function | 47 | <code>def move_run(f,generation,spec,state):</code> |
| `prepared_slot` | function | 49 | <code>def prepared_slot(f,key,commit):</code> |
| `PacketFixture` | class | 72 | <code>class PacketFixture(HierarchyFixture):</code> |
| `__init__` | method | 73 | <code>def __init__(self,extra_components=(),extra_setup=None,bootstrap=True,seed_historical_runtime=True,extra_env=None,source_object_id=None):</code> |
| `setup` | function | 74 | <code>def setup(f):</code> |
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
| `setup` | function | 125 | <code>def setup(f):</code> |
| `exact_identity` | function | 148 | <code>def exact_identity():</code> |
| `mandatory_intent` | function | 153 | <code>def mandatory_intent():</code> |
| `validate_inputs` | function | 168 | <code>def validate_inputs():</code> |
| `prepared_roles` | function | 172 | <code>def prepared_roles():</code> |
| `derive` | function | 174 | <code>def derive(value):return f.ok("hierarchy.packet.derive",{"leader_generation":"1","package_generation":"2","digest":state&#91;"digest"&#93;,"manifest":value},key="manager",component="3.2")</code> |
| `refused` | function | 175 | <code>def refused(value):f.reject("hierarchy.packet.derive",{"leader_generation":"1","package_generation":"2","digest":state&#91;"digest"&#93;,"manifest":value},"ENVIRONMENT_PROFILE_INVALID",key="manager",component…</code> |
| `rehash` | function | 176 | <code>def rehash(value):value&#91;"digest"&#93;=identity({k:v for k,v in value.items() if k!="digest"});return value</code> |
| `immutable` | function | 191 | <code>def immutable():</code> |
| `repeatable_read_refused` | function | 195 | <code>def repeatable_read_refused():</code> |
| `trim` | function | 200 | <code>def trim():</code> |
| `mandatory_invariant` | function | 208 | <code>def mandatory_invariant():</code> |
| `optional_digest` | function | 213 | <code>def optional_digest():</code> |
| `change_baseline` | function | 229 | <code>def change_baseline():</code> |
| `irrelevant` | function | 235 | <code>def irrelevant():</code> |
| `dependency_change` | function | 241 | <code>def dependency_change():</code> |
| `contract_change` | function | 245 | <code>def contract_change():</code> |
| `amendment` | function | 250 | <code>def amendment():</code> |
| `constraint_digest` | function | 263 | <code>def constraint_digest():</code> |
| `source_change` | function | 267 | <code>def source_change():</code> |
| `no_sources` | function | 274 | <code>def no_sources():</code> |
| `graph_inputs_regression` | function | 285 | <code>def graph_inputs_regression():</code> |
| `command` | function | 290 | <code>def command(args):</code> |
| `setup` | function | 302 | <code>def setup(f):</code> |
| `scoped` | function | 306 | <code>def scoped(&#42;&#42;kwargs):return dict(organisation_id=i&#91;"organisation"&#93;,run_id=i&#91;"run"&#93;,authority_epoch=i&#91;"epoch"&#93;,&#42;&#42;kwargs)</code> |
| `graph` | function | 307 | <code>def graph(component,action,value):return f.ok(action,value,key="operator",component=component)</code> |
| `publish` | function | 309 | <code>def publish():</code> |
| `packet` | function | 324 | <code>def packet():</code> |
| `quarantine` | function | 333 | <code>def quarantine():</code> |

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
| `setup` | function | 68 | <code>def setup(f):</code> |
| `selected` | function | 93 | <code>def selected():</code> |
| `read` | function | 97 | <code>def read():</code> |
| `intent` | function | 101 | <code>def intent():</code> |
| `links` | function | 110 | <code>def links():</code> |
| `freshness` | function | 115 | <code>def freshness():</code> |
| `finding_only` | function | 123 | <code>def finding_only():</code> |
| `dependencies` | function | 127 | <code>def dependencies():</code> |
| `budget` | function | 134 | <code>def budget():</code> |
| `outrank` | function | 143 | <code>def outrank():</code> |
| `untrusted` | function | 148 | <code>def untrusted():</code> |
| `malformed` | function | 154 | <code>def malformed():</code> |
| `isolated` | function | 159 | <code>def isolated():</code> |

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
| `setup` | function | 72 | <code>def setup(f):</code> |
| `main` | function | 77 | <code>def main():</code> |
| `unbound_running` | function | 90 | <code>def unbound_running():</code> |
| `first_binding` | function | 94 | <code>def first_binding():</code> |
| `reject_sql` | function | 98 | <code>def reject_sql(column,value,session=None):</code> |
| `register_primary` | function | 105 | <code>def register_primary():</code> |
| `worker_register` | function | 113 | <code>def worker_register():</code> |
| `GET /worker` | route | 121 | <code>worker=state.get("worker",m.uid())</code> |
| `child_register` | function | 127 | <code>def child_register():</code> |
| `parentage` | function | 131 | <code>def parentage():</code> |
| `counted` | function | 136 | <code>def counted():</code> |
| `hidden_visible` | function | 150 | <code>def hidden_visible():</code> |
| `unaccounted_refused` | function | 155 | <code>def unaccounted_refused():</code> |
| `child_view` | function | 166 | <code>def child_view():</code> |
| `renewal_gap` | function | 173 | <code>def renewal_gap():</code> |
| `realigned` | function | 178 | <code>def realigned():</code> |
| `released` | function | 187 | <code>def released():</code> |
| `still_counted` | function | 197 | <code>def still_counted():</code> |
| `adoption_proposed` | function | 204 | <code>def adoption_proposed():</code> |
| `adopted` | function | 214 | <code>def adopted():</code> |
| `not_restarted` | function | 220 | <code>def not_restarted():</code> |
| `single_owner` | function | 226 | <code>def single_owner():</code> |
| `successor_view` | function | 234 | <code>def successor_view():</code> |
| `worker_seat_after_adoption` | function | 238 | <code>def worker_seat_after_adoption():</code> |
| `snapshot_write` | function | 250 | <code>def snapshot_write():</code> |
| `immutable_history` | function | 255 | <code>def immutable_history():</code> |
| `recovery_bootstrap` | function | 261 | <code>def recovery_bootstrap():</code> |
| `recovery_select` | function | 274 | <code>def recovery_select():</code> |

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
| `valid` | function | 155 | <code>def valid(k=kind,r=record):</code> |
| `schema_checks` | function | 195 | <code>def schema_checks(service):</code> |
| `describe` | function | 205 | <code>def describe():</code> |
| `bootstrap` | function | 214 | <code>def bootstrap():</code> |
| `replay` | function | 219 | <code>def replay():</code> |
| `inspect` | function | 224 | <code>def inspect():</code> |
| `config_missing` | function | 239 | <code>def config_missing():</code> |
| `config_bounded` | function | 245 | <code>def config_bounded():</code> |
| `url_override` | function | 251 | <code>def url_override():</code> |
| `final_schema_negatives` | function | 261 | <code>def final_schema_negatives(service):</code> |
| `checksum_conflict` | function | 263 | <code>def checksum_conflict():</code> |
| `namespace_conflict` | function | 271 | <code>def namespace_conflict():</code> |
| `relational` | function | 283 | <code>def relational(service):</code> |
| `xid` | function | 285 | <code>def xid(n): return f"00000000-0000-4000-8000-{n:012x}"</code> |
| `source_create` | function | 290 | <code>def source_create():</code> |
| `attempt_create` | function | 299 | <code>def attempt_create():</code> |
| `admitted` | function | 314 | <code>def admitted():</code> |
| `custody_create` | function | 330 | <code>def custody_create():</code> |
| `compute_expiry` | function | 339 | <code>def compute_expiry():</code> |
| `immutable` | function | 343 | <code>def immutable():</code> |
| `relational_final` | function | 353 | <code>def relational_final(service,xid,scope,epoch,custody):</code> |
| `publication_seed` | function | 355 | <code>def publication_seed():</code> |
| `publication` | function | 363 | <code>def publication():</code> |
| `rollback` | function | 372 | <code>def rollback():</code> |
| `repeatable_write` | function | 380 | <code>def repeatable_write():</code> |
| `immutable_spec` | function | 387 | <code>def immutable_spec():</code> |
| `history` | function | 391 | <code>def history():</code> |
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
| `git` | function | 57 | <code>def git(&#42;args):return subprocess.check_output(&#91;"git",&#42;args&#93;,cwd=self.repo,stderr=subprocess.PIPE,text=True).strip()</code> |
| `setup` | function | 64 | <code>def setup(f):</code> |
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
| `replica` | function | 152 | <code>def replica():</code> |
| `graph_exact` | function | 171 | <code>def graph_exact(which):</code> |
| `graph_mixed` | function | 179 | <code>def graph_mixed():</code> |
| `privilege` | function | 186 | <code>def privilege():</code> |
| `lag` | function | 194 | <code>def lag():</code> |
| `wait` | function | 203 | <code>def wait():</code> |
| `resume` | function | 204 | <code>def resume():time.sleep(.75);f.c.sql("SELECT pg_wal_replay_resume()",replica=True)</code> |
| `unavailable` | function | 215 | <code>def unavailable():</code> |
| `promoted` | function | 222 | <code>def promoted():</code> |
| `promoted_fallback` | function | 225 | <code>def promoted_fallback():</code> |
| `nonowner` | function | 231 | <code>def nonowner():</code> |

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
| `call` | function | 100 | <code>def call(input,env=None,action='fixture44.execute',timeout=45):</code> |
| `read_artifact` | function | 185 | <code>def read_artifact(replica=False):return json.loads(c.sql(artifact_query,replica=replica))</code> |

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
| `setup` | function | 108 | <code>def setup(f):</code> |
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
| `barred` | function | 232 | <code>def barred(name):return dict(a,request_id=uid(),task_id=i&#91;"task_"+name&#93;,attempt_id=uid(),slot_id=i&#91;"slot_"+name&#93;)</code> |
| `run_not_admitting` | function | 237 | <code>def run_not_admitting():</code> |
| `second_owner` | function | 244 | <code>def second_owner():</code> |
| `wired` | function | 250 | <code>def wired():</code> |
| `race` | function | 258 | <code>def race():</code> |
| `envelope_conflict` | function | 266 | <code>def envelope_conflict():</code> |
| `cleanup` | function | 276 | <code>def cleanup():</code> |
| `quota_race` | function | 285 | <code>def quota_race():</code> |
| `sandbox_race` | function | 301 | <code>def sandbox_race():</code> |
| `reserve` | function | 319 | <code>def reserve(request,dimensions,dynamic=False):</code> |
| `occupied` | function | 326 | <code>def occupied():return edge.sql("SELECT reserved::text,allocated::text FROM hyperfide.capacity_accounts WHERE id=$1",&#91;agent&#93;)&#91;0&#93;</code> |
| `seeded_counted` | function | 327 | <code>def seeded_counted():</code> |
| `sandbox_used` | function | 337 | <code>def sandbox_used():return edge.sql("SELECT (reserved+allocated)::text n FROM hyperfide.capacity_accounts WHERE id=$1",&#91;physical&#93;)&#91;0&#93;&#91;"n"&#93;</code> |
| `rate_used` | function | 338 | <code>def rate_used():return edge.sql("SELECT coalesce(sum(consumed),0)::text n FROM hyperfide.capacity_rate_windows WHERE capacity_account_id=$1",&#91;rate&#93;)&#91;0&#93;&#91;"n"&#93;</code> |
| `separate_limits` | function | 339 | <code>def separate_limits():</code> |
| `survived` | function | 380 | <code>def survived(name=name,state=state,token=token):</code> |
| `reclaim_refused` | function | 386 | <code>def reclaim_refused(name=name,token=token):</code> |
| `custody_counted` | function | 392 | <code>def custody_counted():</code> |
| `no_replan` | function | 402 | <code>def no_replan():</code> |

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
| `run` | function | 95 | <code>def run(call):</code> |
| `admit_custody` | function | 100 | <code>def admit_custody(f,token):</code> |
| `revoke_custody` | function | 108 | <code>def revoke_custody(f,custody):</code> |
| `generations` | function | 118 | <code>def generations():</code> |
| `registered` | function | 121 | <code>def registered():</code> |
| `worker_renews` | function | 129 | <code>def worker_renews():</code> |
| `refuses_invalid` | function | 145 | <code>def refuses_invalid():</code> |
| `strict_clock_inputs` | function | 151 | <code>def strict_clock_inputs():</code> |
| `expired_refused` | function | 164 | <code>def expired_refused():</code> |
| `stale_refusals` | function | 173 | <code>def stale_refusals():</code> |
| `stale_never_current` | function | 183 | <code>def stale_never_current():</code> |
| `stale_history` | function | 187 | <code>def stale_history():</code> |
| `expiry_preserves` | function | 201 | <code>def expiry_preserves():</code> |
| `fence_preserves` | function | 205 | <code>def fence_preserves():</code> |
| `revocation_serializes` | function | 211 | <code>def revocation_serializes():</code> |
| `m_try` | function | 226 | <code>def m_try(call):</code> |
| `races` | function | 233 | <code>def races():</code> |
| `skewed_clients` | function | 237 | <code>def skewed_clients():</code> |
| `skewed_timezone` | function | 246 | <code>def skewed_timezone():</code> |
| `race_iteration` | function | 254 | <code>def race_iteration(offset):</code> |
| `race_all` | function | 280 | <code>def race_all():</code> |
| `cleanup` | function | 289 | <code>def cleanup():</code> |
| `main` | function | 304 | <code>def main():</code> |
| `recovery_rollback` | function | 355 | <code>def recovery_rollback():</code> |

## tests/hyperfide/cases/tasks/5_3.py

[Open source](../tests/hyperfide/cases/tasks/5_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `field` | function | 9 | <code>def field(key,value,line):return {"key":key,"raw":json.dumps(value),"value":value,"line":line}</code> |
| `accepted_intent` | function | 10 | <code>def accepted_intent(f):</code> |
| `describe_access` | function | 25 | <code>def describe_access(f):</code> |
| `fixture` | function | 33 | <code>def fixture(describe=False,&#42;&#42;kwargs):</code> |
| `setup` | function | 34 | <code>def setup(f):</code> |
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
| `race` | function | 149 | <code>def race():</code> |
| `concurrent_consumers` | function | 175 | <code>def concurrent_consumers():</code> |
| `crash_retry` | function | 188 | <code>def crash_retry():</code> |
| `timeout_retry` | function | 196 | <code>def timeout_retry():</code> |
| `consumer_waits` | function | 213 | <code>def consumer_waits():</code> |
| `single_authority` | function | 231 | <code>def single_authority():</code> |
| `mismatches` | function | 237 | <code>def mismatches():</code> |
| `unadmitted` | function | 242 | <code>def unadmitted():</code> |

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
| `exclusive` | function | 177 | <code>def exclusive():</code> |
| `backpressure` | function | 199 | <code>def backpressure():</code> |
| `distinguish` | function | 205 | <code>def distinguish():</code> |
| `released` | function | 231 | <code>def released():</code> |
| `relief_check` | function | 242 | <code>def relief_check():</code> |
| `describe` | function | 246 | <code>def describe():</code> |
| `fairness_section` | function | 253 | <code>def fairness_section(f):</code> |
| `priority` | function | 262 | <code>def priority():</code> |
| `bounded` | function | 270 | <code>def bounded():</code> |
| `overload` | function | 278 | <code>def overload():</code> |
| `descendants` | function | 299 | <code>def descendants():</code> |
| `child_release` | function | 304 | <code>def child_release():</code> |
| `provision` | function | 320 | <code>def provision():</code> |
| `rates` | function | 344 | <code>def rates():</code> |
| `rate_replay` | function | 353 | <code>def rate_replay():</code> |
| `ceiling_section` | function | 361 | <code>def ceiling_section(f):</code> |
| `sequential` | function | 385 | <code>def sequential():</code> |
| `workload` | function | 394 | <code>def workload(seed):</code> |
| `reference` | function | 404 | <code>def reference(events):</code> |
| `replay_section` | function | 433 | <code>def replay_section(f,base_seed):</code> |
| `run_fixture` | function | 461 | <code>def run_fixture(name,section,&#42;args):</code> |
| `main` | function | 468 | <code>def main():</code> |
| `second` | function | 472 | <code>def second(f):</code> |
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
| `runtime_role` | function | 286 | <code>def runtime_role():</code> |
| `concurrent_claims` | function | 312 | <code>def concurrent_claims():</code> |
| `late_lower` | function | 323 | <code>def late_lower():</code> |
| `immutable_binding` | function | 361 | <code>def immutable_binding():</code> |
| `suite62` | function | 371 | <code>def suite62(s):</code> |
| `concurrent_duplicate` | function | 444 | <code>def concurrent_duplicate(s):</code> |
| `seed_native_attempt` | function | 451 | <code>def seed_native_attempt(f):</code> |
| `command` | function | 462 | <code>def command(n,kind):</code> |
| `control` | function | 467 | <code>def control(s,mode,operation,expected=None):</code> |
| `suite63` | function | 471 | <code>def suite63(s):</code> |
| `crash_bootstrap` | function | 481 | <code>def crash_bootstrap():</code> |
| `actor_call` | function | 499 | <code>def actor_call(name,action,value,component="6.3",expected=None):</code> |
| `accept` | function | 538 | <code>def accept(c):return s.ok("instructions.accept",dict(S,event_id=c&#91;"id"&#93;,consumer_id=CONSUMER))</code> |
| `retained_bootstrap` | function | 540 | <code>def retained_bootstrap():</code> |
| `native_packet` | function | 550 | <code>def native_packet():</code> |
| `internal_lookup` | function | 567 | <code>def internal_lookup(value):</code> |
| `provisioner_lookup` | function | 570 | <code>def provisioner_lookup():</code> |
| `mismatched_state` | function | 577 | <code>def mismatched_state(field,value):</code> |
| `start_index` | function | 589 | <code>def start_index(aggregate):</code> |
| `suite64` | function | 624 | <code>def suite64(s):</code> |
| `crash_recover` | function | 651 | <code>def crash_recover(number,after):</code> |
| `daemon_lifecycle` | function | 672 | <code>def daemon_lifecycle(s):</code> |
| `start_dispatch` | function | 692 | <code>def start_dispatch():</code> |
| `stop_dispatch` | function | 709 | <code>def stop_dispatch(kill=False):</code> |
| `wait_for` | function | 716 | <code>def wait_for(predicate,message):</code> |
| `describe_dispatch` | function | 722 | <code>def describe_dispatch():</code> |
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
| `lost_poll_rediscovered` | function | 77 | <code>def lost_poll_rediscovered():</code> |
| `reconnect` | function | 91 | <code>def reconnect():</code> |
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
| `setup` | function | 54 | <code>def setup(f):</code> |
| `__enter__` | method | 68 | <code>def __enter__(self):return self</code> |
| `__exit__` | method | 69 | <code>def __exit__(self,&#42;_):self.close()</code> |
| `close` | method | 70 | <code>def close(self):</code> |
| `request` | method | 77 | <code>def request(self,action,value,env=None):</code> |
| `ok` | method | 84 | <code>def ok(self,action,value):</code> |
| `reject` | method | 88 | <code>def reject(self,action,value,code=None):</code> |
| `chunks` | method | 92 | <code>def chunks(self,manifest):</code> |
| `main` | function | 99 | <code>def main():</code> |
| `create` | function | 105 | <code>def create():</code> |
| `chunks` | function | 114 | <code>def chunks():</code> |
| `changed` | function | 128 | <code>def changed(field,value):</code> |
| `config_change` | function | 133 | <code>def config_change():</code> |
| `overlay` | function | 138 | <code>def overlay():</code> |
| `placement` | function | 152 | <code>def placement():</code> |
| `scanner` | function | 157 | <code>def scanner():</code> |
| `tamper` | function | 162 | <code>def tamper():</code> |
| `body_budget` | function | 169 | <code>def body_budget():</code> |
| `auth_missing` | function | 177 | <code>def auth_missing():</code> |
| `role_denied` | function | 182 | <code>def role_denied():</code> |
| `dispatch_native` | function | 187 | <code>def dispatch_native():</code> |
| `GET /HYPERFIDE_CAMPAIGN_DIR` | route | 208 | <code>artifact=Path(os.environ.get("HYPERFIDE_CAMPAIGN_DIR",str(base)))/"graph"</code> |
| `sql` | function | 222 | <code>def sql(statement):</code> |

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
| `create` | function | 96 | <code>def create():state&#91;"build"&#93;=f.create()&#91;"build_id"&#93;;expect(sql("SELECT count(&#42;) FROM hyperfide.graph_builds").stdout.strip()=="1","build was not durably created")</code> |
| `chunk` | function | 101 | <code>def chunk():</code> |
| `restart_staging` | function | 106 | <code>def restart_staging():</code> |
| `corrupt` | function | 112 | <code>def corrupt():</code> |
| `rest` | function | 118 | <code>def rest():f.stage(b);expect(sql("SELECT count(&#42;) FROM hyperfide.graph_fact_rows").stdout.strip()==str(sum(f.manifest&#91;"counts"&#93;.values())),"native facts were lost")</code> |
| `resolve` | function | 122 | <code>def resolve():</code> |
| `concurrent_build` | function | 134 | <code>def concurrent_build():</code> |
| `pending_artifact` | function | 142 | <code>def pending_artifact():</code> |
| `unavailable_replay` | function | 149 | <code>def unavailable_replay():</code> |
| `branch_commit` | function | 160 | <code>def branch_commit(f):</code> |
| `extract_at` | function | 168 | <code>def extract_at(f,source,generation):</code> |
| `drive` | function | 170 | <code>def drive(f,manifest,chunks,limit):</code> |
| `committed_transactions` | function | 180 | <code>def committed_transactions():</code> |
| `network_amplification` | function | 184 | <code>def network_amplification(f,branch):</code> |
| `graph_saturation` | function | 205 | <code>def graph_saturation(f,build):</code> |
| `restart` | function | 206 | <code>def restart(env):</code> |
| `poll` | function | 210 | <code>def poll(statement,predicate,message,seconds=4):</code> |
| `coordination` | function | 236 | <code>def coordination():</code> |
| `branch_race` | function | 259 | <code>def branch_race(f,branch):</code> |
| `artifact_status` | function | 290 | <code>def artifact_status(build,status):</code> |
| `publication` | function | 294 | <code>def publication(f):</code> |
| `ready` | function | 297 | <code>def ready():state&#91;"build"&#93;=f.ready();expect(state&#91;"build"&#93;==b,"ready replay changed build")</code> |
| `quarantined_publish` | function | 299 | <code>def quarantined_publish():</code> |
| `publish` | function | 307 | <code>def publish():</code> |
| `isolation` | function | 314 | <code>def isolation(table):</code> |
| `crash_after_publication` | function | 325 | <code>def crash_after_publication():</code> |
| `immutable` | function | 333 | <code>def immutable():</code> |
| `next_generation` | function | 337 | <code>def next_generation():</code> |
| `generation_collision` | function | 341 | <code>def generation_collision():</code> |
| `extension_move_denied` | function | 348 | <code>def extension_move_denied():</code> |
| `snapshot` | function | 357 | <code>def snapshot():</code> |
| `race` | function | 366 | <code>def race():</code> |
| `quarantined_history` | function | 372 | <code>def quarantined_history():</code> |
| `querying` | function | 380 | <code>def querying(f):</code> |
| `ready` | function | 382 | <code>def ready():</code> |
| `request` | function | 387 | <code>def request(action,&#42;&#42;kw):return f.ok("7.4",action,f.scoped(manifest_id=manifest,&#42;&#42;kw))</code> |
| `quarantined_query` | function | 389 | <code>def quarantined_query():</code> |
| `symbols` | function | 403 | <code>def symbols():</code> |
| `bodies` | function | 409 | <code>def bodies():</code> |
| `comments` | function | 414 | <code>def comments():</code> |
| `trigram` | function | 419 | <code>def trigram():</code> |
| `body_trigram` | function | 424 | <code>def body_trigram():</code> |
| `pagination` | function | 429 | <code>def pagination():</code> |
| `cursor` | function | 436 | <code>def cursor():</code> |
| `context` | function | 441 | <code>def context():</code> |
| `traversal` | function | 450 | <code>def traversal():</code> |
| `semantic_debt` | function | 455 | <code>def semantic_debt():</code> |
| `readiness` | function | 470 | <code>def readiness():</code> |
| `changed_source` | function | 476 | <code>def changed_source():</code> |
| `multiple_repositories` | function | 495 | <code>def multiple_repositories():</code> |
| `main` | function | 528 | <code>def main(mode="7.2"):</code> |

## tests/hyperfide/cases/tasks/7_3.py

[Open source](../tests/hyperfide/cases/tasks/7_3.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Service` | class | 13 | <code>class Service(native_service):</code> |
| `__init__` | method | 17 | <code>def __init__(self,&#42;args,graph_schema=False,&#42;&#42;kw):</code> |
| `failed_build_exposes_debt` | function | 22 | <code>def failed_build_exposes_debt(f):</code> |
| `scenario` | function | 25 | <code>def scenario():</code> |
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
| `inspect` | function | 159 | <code>def inspect(row):</code> |
| `reason` | function | 165 | <code>def reason(code):</code> |
| `inspect` | function | 166 | <code>def inspect(result):</code> |
| `change` | function | 173 | <code>def change(base, path, value):</code> |
| `invalid_op` | function | 182 | <code>def invalid_op(identity, kind, path, value, &#42;, rehash=True):</code> |
| `invalid_outcome` | function | 189 | <code>def invalid_outcome(identity, kind, path, value):</code> |
| `inventory` | function | 193 | <code>def inventory(pages):</code> |
| `inventory_oracle` | function | 197 | <code>def inventory_oracle(complete, eligible, count):</code> |
| `inspect` | function | 198 | <code>def inspect(result):</code> |
| `define_cases` | function | 206 | <code>def define_cases():</code> |
| `inspect` | function | 250 | <code>def inspect(result, kind=kind):</code> |
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
| `setup` | function | 26 | <code>def setup(f):</code> |
| `invoke` | function | 34 | <code>def invoke(action,input=None,key="operator"):</code> |
| `result` | function | 37 | <code>def result(action,input=None,key="operator"):</code> |
| `refused` | function | 39 | <code>def refused(action,input=None,key="operator",code=None):</code> |
| `config_negative` | function | 42 | <code>def config_negative(change):</code> |
| `mode` | function | 56 | <code>def mode():</code> |
| `symlink` | function | 61 | <code>def symlink():</code> |
| `observation` | function | 99 | <code>def observation(dimension,value,seconds=120):</code> |
| `dimension` | function | 102 | <code>def dimension(name):return next(d for d in result("provider.pools.capacity",{"pool_id":f.provider_pool})&#91;"dimensions"&#93; if d&#91;"name"&#93;==name)</code> |
| `expired` | function | 106 | <code>def expired():</code> |
| `orphan` | function | 111 | <code>def orphan():</code> |
| `account` | function | 118 | <code>def account(kind,quantity):</code> |
| `separate` | function | 123 | <code>def separate():</code> |
| `pending` | function | 127 | <code>def pending():</code> |
| `changed` | function | 131 | <code>def changed():</code> |
| `save_declaration` | function | 142 | <code>def save_declaration():f.declaration_path.write_text(json.dumps(declaration));f.declaration_path.chmod(0o600)</code> |
| `declare` | function | 144 | <code>def declare():</code> |
| `held_provenance` | function | 150 | <code>def held_provenance():</code> |
| `private_declaration` | function | 158 | <code>def private_declaration():</code> |
| `conflict` | function | 163 | <code>def conflict():</code> |
| `expired_declaration` | function | 168 | <code>def expired_declaration():</code> |

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
| `provider` | function | 144 | <code>def provider():return json.loads(state.read_text())</code> |
| `configure` | function | 145 | <code>def configure(v):</code> |
| `setup` | function | 150 | <code>def setup(fx):</code> |
| `call` | function | 163 | <code>def call(target,action,input,key,component="8.3"):</code> |
| `ok` | function | 165 | <code>def ok(target,action,input,key="operator",component="8.3"):</code> |
| `refused` | function | 167 | <code>def refused(target,action,input,key,code):</code> |
| `intent` | function | 169 | <code>def intent(iid):return f.sql("SELECT state,native_sandbox_id,failure_code,last_outcome FROM hyperfide.provisioning_intents WHERE organisation_id=$1 AND id=$2",&#91;org,iid&#93;)&#91;0&#93;</code> |
| `calls` | function | 170 | <code>def calls(method,iid):return &#91;c for c in provider()&#91;"calls"&#93; if c&#91;"method"&#93;==method and (c&#91;"operation_id"&#93;==iid or c&#91;"correlation_id"&#93;==iid)&#93;</code> |
| `reserve` | function | 172 | <code>def reserve():</code> |
| `commit` | function | 179 | <code>def commit(deadline_ms=60000):</code> |
| `incompatible` | function | 187 | <code>def incompatible():</code> |
| `ready` | function | 194 | <code>def ready():</code> |
| `committed` | function | 202 | <code>def committed():</code> |
| `consumed` | function | 206 | <code>def consumed():</code> |
| `observed` | function | 210 | <code>def observed():</code> |
| `crashed` | function | 217 | <code>def crashed():</code> |
| `resumed` | function | 223 | <code>def resumed():</code> |
| `ambiguous` | function | 235 | <code>def ambiguous():</code> |
| `not_replayed` | function | 242 | <code>def not_replayed():</code> |
| `destroyed` | function | 248 | <code>def destroyed():</code> |
| `credentials_isolated` | function | 255 | <code>def credentials_isolated():</code> |
| `main` | function | 270 | <code>def main():</code> |
| `invoke` | function | 274 | <code>def invoke(action,input,key="operator",component="8.3"):</code> |
| `result` | function | 276 | <code>def result(action,input,key="operator",component="8.3"):</code> |
| `reject` | function | 278 | <code>def reject(action,input,code=None,key="operator"):</code> |
| `changed` | function | 281 | <code>def changed(&#42;&#42;kwargs):value=copy.deepcopy(request);value.update(kwargs);return value</code> |
| `create` | function | 289 | <code>def create():</code> |
| `no_adapter` | function | 306 | <code>def no_adapter():</code> |
| `crash` | function | 311 | <code>def crash():</code> |
| `held` | function | 316 | <code>def held():</code> |
| `worked` | function | 328 | <code>def worked():</code> |
| `irreversible` | function | 332 | <code>def irreversible():</code> |
| `branded` | function | 339 | <code>def branded():</code> |
| `child_manifest` | function | 350 | <code>def child_manifest(escalate=False,v2=False,tamper=False):</code> |
| `lineage` | function | 358 | <code>def lineage(child,manifest,&#42;,state="QUALIFIED",expired=False,tamper=False,parent_id=None):</code> |
| `select` | function | 368 | <code>def select(child,manifest,code):</code> |
| `manifest_tamper` | function | 374 | <code>def manifest_tamper():</code> |
| `escalated` | function | 378 | <code>def escalated():</code> |
| `stale` | function | 381 | <code>def stale():</code> |
| `expired` | function | 384 | <code>def expired():</code> |
| `hash_tamper` | function | 387 | <code>def hash_tamper():</code> |
| `lost_custody` | function | 390 | <code>def lost_custody():</code> |
| `parent_binding` | function | 394 | <code>def parent_binding():</code> |
| `v2_body` | function | 397 | <code>def v2_body():</code> |
| `immutable_lineage` | function | 400 | <code>def immutable_lineage():</code> |
| `recipe_policy` | function | 438 | <code>def recipe_policy():</code> |
| `missing_adapter` | function | 486 | <code>def missing_adapter():</code> |
| `missing_adapter_idle` | function | 490 | <code>def missing_adapter_idle():</code> |

## tests/hyperfide/cases/tasks/8_4.py

[Open source](../tests/hyperfide/cases/tasks/8_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 120 | <code>def main():</code> |
| `check` | function | 127 | <code>def check(n,fn):</code> |
| `setup` | function | 132 | <code>def setup(f):</code> |
| `lower_cpu` | function | 140 | <code>def lower_cpu(profile):profile&#91;"resources"&#93;&#91;"cpu_millis"&#93;-=1</code> |
| `unbound` | function | 141 | <code>def unbound(value):value&#91;"profile"&#93;&#91;"profile_version"&#93;="tampered-without-rehash"</code> |
| `invoke` | function | 153 | <code>def invoke(action,value,component="8.4",key="provisioner"):</code> |
| `result` | function | 155 | <code>def result(action,value,component="8.4",key="provisioner"):</code> |
| `reject` | function | 157 | <code>def reject(action,value,code=None):</code> |
| `backoff` | function | 174 | <code>def backoff():</code> |
| `wrong_run` | function | 179 | <code>def wrong_run():</code> |
| `private_policy` | function | 188 | <code>def private_policy():</code> |
| `incompatible` | function | 224 | <code>def incompatible():</code> |
| `unbound` | function | 228 | <code>def unbound():</code> |
| `compatible` | function | 233 | <code>def compatible():</code> |
| `preserved` | function | 238 | <code>def preserved():</code> |
| `fenced` | function | 244 | <code>def fenced():</code> |
| `replay` | function | 248 | <code>def replay():</code> |
| `fresh` | function | 253 | <code>def fresh():</code> |

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
| `include` | function | 182 | <code>def include(name):</code> |
| `call` | method | 193 | <code>def call(self,component,action,payload):</code> |
| `close` | method | 197 | <code>def close(self):self.actual.close()</code> |
| `simulated_sandbox` | function | 254 | <code>def simulated_sandbox(fixture,sandbox_id,boot_id,preparation_digest,processes=()):</code> |
| `simulated_restore` | function | 262 | <code>def simulated_restore(fixture,key,sandbox_id,preparation_digest):</code> |
| `WebSocketFixture` | class | 268 | <code>class WebSocketFixture:</code> |
| `__init__` | method | 269 | <code>def __init__(self,directory,fixture):</code> |
| `snapshot` | method | 282 | <code>def snapshot(self):return json.loads(self.state.read_text())</code> |
| `close` | method | 283 | <code>def close(self):</code> |
| `main` | function | 293 | <code>def main():</code> |
| `describe` | function | 312 | <code>def describe():</code> |
| `service_capture` | function | 429 | <code>def service_capture():</code> |
| `file_restored` | function | 450 | <code>def file_restored():</code> |
| `process_absent` | function | 455 | <code>def process_absent():</code> |

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
| `alive` | function | 300 | <code>def alive():</code> |

## tests/hyperfide/cases/tasks/9_4.py

[Open source](../tests/hyperfide/cases/tasks/9_4.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `simulate_quota` | function | 26 | <code>def simulate_quota(fixture):</code> |
| `do_POST` | function | 29 | <code>def do_POST(self):</code> |
| `actual_factory_checks` | function | 43 | <code>def actual_factory_checks(fixture,folder):</code> |
| `setup` | function | 56 | <code>def setup(actual):</code> |
| `invoke` | function | 63 | <code>def invoke(action,input,component="8.3",key="operator"):</code> |
| `main` | function | 137 | <code>def main():</code> |
| `adapter` | function | 204 | <code>def adapter(operation=None,fail=False,isolation=False):</code> |

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
| `git` | function | 276 | <code>def git(arguments):</code> |
| `verify_selected` | function | 306 | <code>def verify_selected(root, receipt, manifest, registry, registration, events, artifact_map):</code> |
| `resource_id` | function | 426 | <code>def resource_id(item):</code> |
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
| `call` | function | 92 | <code>def call(service,action,payload,component,key="operator"):</code> |
| `Control` | class | 96 | <code>class Control:port=None</code> |
| `private` | function | 113 | <code>def private(path,value):path.write_text(json.dumps(value,separators=(",",":")));path.chmod(0o600)</code> |
| `heartbeat` | function | 118 | <code>def heartbeat():</code> |
| `GET /input_packet_digest` | route | 136 | <code>emit("claim-from-packet",{"packet_bound":packet&#91;"packet"&#93;==packet&#91;"input_packet_digest"&#93;==token.get("input_packet_digest",packet&#91;"input_packet_digest"&#93;),"compute_authority":packet&#91;"compute_authority"&#93;…</code> |
| `delivery` | function | 140 | <code>def delivery():</code> |
| `start_relay` | function | 155 | <code>def start_relay(drop):</code> |
| `spawn` | function | 165 | <code>def spawn(port,label):</code> |
| `psql` | function | 252 | <code>def psql(text):</code> |
| `cleanup_resources` | function | 257 | <code>def cleanup_resources():</code> |
| `absence` | function | 258 | <code>def absence(value):(directory()/("connected-absence-"+TASK+".json")).write_text(json.dumps(value)+"&#92;n")</code> |

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
| `setup` | function | 48 | <code>def setup(f):</code> |
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
| `alive` | function | 181 | <code>def alive(row):return row&#91;"pid"&#93; is not None and row&#91;"start"&#93; is not None and process_start(row&#91;"pid"&#93;)==row&#91;"start"&#93;</code> |
| `row` | function | 220 | <code>def row(key,absent):return {"id":resource_prefix+key,"status":"deleted" if absent else "unknown","observed_absent":absent,"evidence_artifact":artifact}</code> |

## tests/hyperfide/integration/tls_relay.py

[Open source](../tests/hyperfide/integration/tls_relay.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `read_message` | function | 10 | <code>def read_message(stream):</code> |
| `main` | function | 27 | <code>def main():</code> |
| `event` | function | 39 | <code>def event(value):</code> |
| `serve` | function | 42 | <code>def serve(raw):</code> |

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
| `GET /task` | route | 336 | <code>base_dir = root / 'artifacts/hyperfide/tasks' / registration.get('task', manifest&#91;'campaign_id'&#93;)</code> |
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
| `admin` | function | 262 | <code>def admin(sql,values=()):</code> |

## tests/hyperfide/support/preparation_process_fixture.py

[Open source](../tests/hyperfide/support/preparation_process_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid_processes` | function | 151 | <code>def uid_processes():</code> |
| `main` | function | 166 | <code>def main():</code> |
| `check` | function | 176 | <code>def check(name, ok):</code> |
| `run` | function | 210 | <code>def run(mode):</code> |

## tests/hyperfide/support/preparation_receipts.test.mjs

[Open source](../tests/hyperfide/support/preparation_receipts.test.mjs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 10 | <code>const sha=b=&gt;'sha256:'+createHash('sha256').update(b).digest('hex');</code> |
| `fixture` | function | 11 | <code>function fixture(){</code> |
| `* /srv/slots/a/worktree` | route | 14 | <code>const plan={operation_id,plan_digest:sha('plan'),argv,executable_digest:node,workspace_path:'/srv/slots/a/worktree',uid:62001,gid:62001};</code> |
| `plan` | object | 14 | <code>const plan={operation_id,plan_digest:sha('plan'),argv,executable_digest:node,workspace_path:'/srv/slots/a/worktree',uid:62001,gid:62001};</code> |
| `receipt` | object | 15 | <code>const receipt={execution_plane:'REMOTE',operation_id,plan_digest:plan.plan_digest,executable_digest:node,preparation_stage:{stage_root,context_path:stage_root+'/context.json',context_digest:sha('conte…</code> |
| `bytes` | function | 18 | <code>const bytes=v=&gt;Buffer.from(JSON.stringify(v));</code> |
| `refused` | function | 19 | <code>const refused=(fn,code)=&gt;assert.throws(fn,e=&gt;e.code===code);</code> |
| `* /bin/sh` | route | 35 | <code>refused(()=&gt;verifyPreparationReceipt(bytes({...receipt,preparation_stage:{...receipt.preparation_stage,recipe_path:'/bin/sh'}}),plan),'PREPARATION_RECEIPT_MISMATCH');</code> |
| `* /etc` | route | 37 | <code>refused(()=&gt;verifyPreparationReceipt(bytes({...receipt,preparation_stage:{...receipt.preparation_stage,workspace_path:'/etc'}}),plan),'PREPARATION_RECEIPT_MISMATCH');</code> |

## tests/hyperfide/support/preparation_stage_fixture.py

[Open source](../tests/hyperfide/support/preparation_stage_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sha` | function | 18 | <code>def sha(data):</code> |
| `StageService` | class | 21 | <code>class StageService:</code> |
| `__init__` | method | 23 | <code>def __init__(self, root, objects, fixture, database):</code> |
| `setup` | function | 26 | <code>def setup(f):</code> |
| `ok` | method | 34 | <code>def ok(self, action, value):</code> |
| `put` | method | 38 | <code>def put(self, data):</code> |
| `close` | method | 40 | <code>def close(self):</code> |
| `run_probe` | function | 43 | <code>def run_probe(binary, service_root):</code> |
| `check` | function | 51 | <code>def check(name, condition):</code> |
| `claim` | function | 81 | <code>def claim(refs=None):</code> |
| `invoke` | function | 104 | <code>def invoke(value,config_path=None):</code> |
| `drop` | function | 120 | <code>def drop():</code> |

## tests/hyperfide/support/reproduction_jobs.test.mjs

[Open source](../tests/hyperfide/support/reproduction_jobs.test.mjs)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `id` | function | 6 | <code>const id=n=&gt;'00000000-0000-4000-8000-'+String(n).padStart(12,'0');</code> |
| `digest` | function | 7 | <code>const digest=n=&gt;'sha256:'+createHash('sha256').update(String(n)).digest('hex');</code> |
| `denied` | function | 8 | <code>const denied=e=&gt;e?.code==='REPRODUCTION_INPUT_AUTHORITY_DENIED';</code> |
| `fixture` | function | 9 | <code>function fixture(){</code> |
| `request` | object | 10 | <code>const request={job_namespace:'REPRODUCTION',job_id:id(1),lease_generation:'2',reservation_id:id(3),input_manifest_digest:digest('manifest'),environment_digest:digest('environment')};</code> |
| `scope` | object | 11 | <code>const scope={organisation_id:id(4),run_id:id(5)};</code> |
| `authority` | object | 12 | <code>const authority={authority:'EXPECTED_AUTHORITY',namespace:'REPRODUCTION',...scope,job_id:request.job_id,lease_generation:request.lease_generation,reservation_id:request.reservation_id,input_manifest_d…</code> |
| `prepared` | object | 16 | <code>const prepared={...structuredClone(authority),runner_session_id:id(11),preparation_digest:digest('prepared-files'),source_state_digest:digest('source-state'),workspace_digest:digest('workspace'),recei…</code> |
| `query` | action | 42 | <code>await assert.rejects(reader({query:async()=&gt;({rows:&#91;&#93;})},{},f.request),e=&gt;e?.code==='TX_CLOSED');assert.equal(calls,0);</code> |
| `guard` | action | 48 | <code>try{await resources.gateway.withPrimaryTransaction({timeoutMs:5000},async tx=&gt;{await assert.rejects(reader(tx,{principal:f.scope,guard:async()=&gt;{}},f.request),e=&gt;e?.code==='AUTH_REQUIRED');});}</code> |

## tests/hyperfide/support/runner_budget_fixture.py

[Open source](../tests/hyperfide/support/runner_budget_fixture.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `uid` | function | 104 | <code>def uid():return str(uuid.uuid4())</code> |
| `check` | function | 105 | <code>def check(value,message):</code> |
| `kernel_parent` | function | 107 | <code>def kernel_parent():</code> |
| `decode` | function | 109 | <code>def decode(value):</code> |
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
| `schema` | function | 15 | <code>def schema(name,symbol):</code> |
| `widen` | function | 48 | <code>def widen():</code> |

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
| `GET /HYPERFIDE_IDENTITY_FIXTURE_ROOT` | route | 37 | <code>root=Path(os.environ.get("HYPERFIDE_IDENTITY_FIXTURE_ROOT",str(ROOT))).resolve()</code> |
| `Child` | class | 42 | <code>class Child:</code> |
| `__init__` | method | 43 | <code>def __init__(self,binary,config):</code> |
| `stop` | method | 45 | <code>def stop(self,kill=False):</code> |
| `entrypoint_probe` | function | 51 | <code>def entrypoint_probe(f,folder):</code> |
| `version` | function | 71 | <code>def version():</code> |
| `entry_main` | function | 109 | <code>def entry_main():</code> |
| `main` | function | 121 | <code>def main():</code> |
| `state` | function | 139 | <code>def state():</code> |
| `db` | function | 142 | <code>def db():</code> |

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
| `GET /epoch` | route | 76 | <code>"attempt_id":attempt,"attempt_generation":attempt_generation,"authority_epoch":self.scope.get("epoch",uid()),"agent_session_id":uid()}</code> |
| `launch_state` | method | 85 | <code>def launch_state(self,launch):</code> |
| `spawn` | method | 88 | <code>def spawn(self,user,code):</code> |
| `drop` | function | 89 | <code>def drop():</code> |
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
| `required` | function | 220 | <code>def required(value, message):</code> |
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
| `cg` | variable | 29 | <code>Cg cg={0}; assert(sqlite3_open(":memory:",&amp;cg.db)==SQLITE_OK);</code> |
| `empty` | variable | 100 | <code>long empty&#91;1&#93;={0}; assert(sem_types_run(&amp;cg,empty,0)==0);</code> |
| `changed` | variable | 105 | <code>long changed&#91;1&#93;={2}; assert(sem_types_run(&amp;cg,changed,1)==0);</code> |

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
| `ignore` | function | 184 | <code>def ignore(directory: str, names: list&#91;str&#93;) -&gt; list&#91;str&#93;:</code> |
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
| `node_exists` | function | 219 | <code>def node_exists(name: str, qualified: str &#124; None) -&gt; bool:</code> |
| `score_framework` | function | 255 | <code>def score_framework(cg: Path, work: Path, case) -&gt; dict:</code> |
| `ratio` | function | 305 | <code>def ratio(num: int, den: int) -&gt; float &#124; None:</code> |
| `main` | function | 309 | <code>def main() -&gt; int:</code> |
| `GET /parser_ok` | route | 388 | <code>if fp or fn or not row.get("parser_ok", True) or not row.get("coverage_ok", True):</code> |

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
| `yes` | variable | 156 | <code>const char &#42;yes&#91;&#93; = { "true", "yes", "on", "1", "&#92;"true&#92;"" };</code> |
| `no` | variable | 157 | <code>const char &#42;no&#91;&#93; = { "false", "no", "off", "0", "&#92;"off&#92;"" };</code> |
| `bad` | variable | 171 | <code>const char &#42;bad&#91;&#93; = { "&#92;"/abs/spec&#92;"", "&#92;"../out&#92;"", "&#92;"a/../../b&#92;"",</code> |
| `nw` | variable | 199 | <code>const char &#42;nw&#91;&#93; = { "65", "-1", "+3", "3.5", "x", "", "8x", "1e2",</code> |
| `goodw` | variable | 207 | <code>const char &#42;goodw&#91;&#93; = { "1", "64", "&#92;"16&#92;"", "auto", "&#92;"auto&#92;"", "0" };</code> |
| `wantw` | variable | 208 | <code>const int   wantw&#91;&#93; = { 1, 64, 16, 0, 0, 0 };</code> |
| `badw` | variable | 221 | <code>const char &#42;badw&#91;&#93; = { "65", "-2", "many", "2.5", "&#92;"&#92;"" };</code> |

## tests/unit/test_drivers.c

[Open source](../tests/unit/test_drivers.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Seen` | typedef | 6 | <code>typedef struct {</code> |
| `on` | function | 14 | <code>static void on(const DriverEvent &#42;e, void &#42;ud) {</code> |
| `parse` | function | 30 | <code>static int parse(const char &#42;line, Seen &#42;s) {</code> |
| `joined` | function | 35 | <code>static char &#42;joined(char &#42;&#42;av) {</code> |
| `main` | function | 45 | <code>int main(void) {</code> |
| `d` | variable | 135 | <code>DriverSpec d = { "claude", "sonnet", "--x y", NULL, true };</code> |
| `c` | variable | 140 | <code>DriverSpec c = { "codex", "", "--extra", NULL, true };</code> |
| `u` | variable | 145 | <code>DriverSpec u = { "custom", "m1", NULL, "run ${TASK} ${MODEL} ${AGENT} ${OTHER}", false };</code> |
| `none` | variable | 149 | <code>DriverSpec none = { "custom", NULL, NULL, NULL, true };</code> |
| `bad` | variable | 152 | <code>DriverSpec bad = { "gpt", NULL, NULL, NULL, true };</code> |

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
| `ids` | variable | 127 | <code>char &#42;ids&#91;&#93; = { xstrdup("1.10"), xstrdup("1.2"), xstrdup("1"),</code> |
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
