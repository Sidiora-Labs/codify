# Test and fixture reference

These are test-only graph observations, not supported product APIs or live Codify HTTP endpoints. In particular, `GET /api/tasks`, `GET /users`, and `POST /users` come from fixture applications. They test extraction; Codify does not start those applications.

The baseline contains 145 observations in 31 files. Source links and line numbers refer to the checkout used for this documentation pass; rerun the workflow after implementation changes. The declaration column quotes the source line at the indexed location and may be only the first line of a multiline declaration. It is not an inferred behavioral contract.

For shipped modules, see the [source reference](SOURCE-REFERENCE.md). The [testing instructions](../CONTRIBUTING.md#tests) explain how to exercise fixtures in temporary repositories.

## kvx/impl/go/kvx_test.go

[Open source](../kvx/impl/go/kvx_test.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `mustParse` | symbol | 31 | <code>func mustParse(t *testing.T, src string) *Doc {</code> |
| `TestParseBasics` | symbol | 40 | <code>func TestParseBasics(t *testing.T) {</code> |
| `TestOrderPreserved` | symbol | 65 | <code>func TestOrderPreserved(t *testing.T) {</code> |
| `TestSectionsWithPrefix` | symbol | 77 | <code>func TestSectionsWithPrefix(t *testing.T) {</code> |
| `TestSortDottedIDs` | symbol | 85 | <code>func TestSortDottedIDs(t *testing.T) {</code> |
| `TestIsList` | symbol | 94 | <code>func TestIsList(t *testing.T) {</code> |
| `TestDuplicateKeyLastWins` | symbol | 104 | <code>func TestDuplicateKeyLastWins(t *testing.T) {</code> |
| `TestParseErrors` | symbol | 114 | <code>func TestParseErrors(t *testing.T) {</code> |
| `TestCanonicalFixedPoint` | symbol | 128 | <code>func TestCanonicalFixedPoint(t *testing.T) {</code> |
| `TestConformanceCorpus` | symbol | 140 | <code>func TestConformanceCorpus(t *testing.T) {</code> |

## tests/fixtures/acp/dom-shim.js

[Open source](../tests/fixtures/acp/dom-shim.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `matches` | symbol | 6 | <code>function matches(el, sel) {</code> |
| `attrs` | symbol | 14 | <code>const attrs = (parts[3] &#124;&#124; '').match(/\[[^\]]+\]/g) &#124;&#124; [];</code> |
| `El` | symbol | 25 | <code>class El {</code> |
| `constructor` | symbol | 26 | <code>constructor(tag) {</code> |
| `add` | symbol | 39 | <code>add(...c) { c.forEach((x) =&gt; this._s.add(x)); self._sync(); },</code> |
| `remove` | symbol | 40 | <code>remove(...c) { c.forEach((x) =&gt; this._s.delete(x)); self._sync(); },</code> |
| `contains` | symbol | 41 | <code>contains(c) { return this._s.has(c); },</code> |
| `toggle` | symbol | 42 | <code>toggle(c, on) {</code> |
| `_sync` | symbol | 49 | <code>_sync() { this.attrs.class = [...this.classList._s].join(' '); }</code> |
| `appendChild` | symbol | 64 | <code>appendChild(c) { c.parent = this; this.children.push(c); return c; }</code> |
| `insertBefore` | symbol | 65 | <code>insertBefore(c, ref) {</code> |
| `removeChild` | symbol | 72 | <code>removeChild(c) {</code> |
| `remove` | symbol | 76 | <code>remove() {</code> |
| `addEventListener` | symbol | 80 | <code>addEventListener(ev, fn) {</code> |
| `dispatch` | symbol | 83 | <code>dispatch(ev, arg) {</code> |
| `click` | symbol | 87 | <code>click() { this.dispatch('click'); }</code> |
| `focus` | symbol | 88 | <code>focus() { doc.activeElement = this; }</code> |
| `scrollIntoView` | symbol | 89 | <code>scrollIntoView() {}</code> |
| `querySelectorAll` | symbol | 90 | <code>querySelectorAll(sel) {</code> |
| `walk` | symbol | 94 | <code>const walk = (n) =&gt; {</code> |
| `querySelector` | symbol | 101 | <code>querySelector(sel) { return this.querySelectorAll(sel)[0] &#124;&#124; null; }</code> |
| `dump` | symbol | 103 | <code>dump(depth) {</code> |
| `createElement` | symbol | 115 | <code>createElement(tag) { return new El(tag); },</code> |
| `createTextNode` | symbol | 116 | <code>createTextNode(t) { const e = new El('#text'); e.textContent = t; return e; },</code> |
| `getElementById` | symbol | 117 | <code>getElementById(id) { return doc._byId.get(id) &#124;&#124; null; },</code> |
| `addEventListener` | symbol | 118 | <code>addEventListener() {},</code> |
| `bootstrap` | symbol | 125 | <code>function bootstrap(ids) {</code> |

## tests/fixtures/acp/fake-agent.js

[Open source](../tests/fixtures/acp/fake-agent.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `modes` | symbol | 28 | <code>function modes() {</code> |
| `configOptions` | symbol | 35 | <code>function configOptions() {</code> |
| `replaySession` | symbol | 47 | <code>function replaySession(sid) {</code> |
| `send` | symbol | 56 | <code>function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }</code> |
| `reply` | symbol | 57 | <code>function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }</code> |
| `notify` | symbol | 58 | <code>function notify(method, params) { send({ jsonrpc: '2.0', method, params }); }</code> |
| `update` | symbol | 59 | <code>function update(sessionId, u) { notify('session/update', { sessionId, update: u }); }</code> |
| `request` | symbol | 61 | <code>function request(method, params) {</code> |
| `logLine` | symbol | 69 | <code>function logLine(method, params) {</code> |
| `promptTurn` | symbol | 75 | <code>async function promptTurn(id, params) {</code> |
| `text` | symbol | 77 | <code>const text = (params.prompt &#124;&#124; [])</code> |
| `dispatch` | symbol | 143 | <code>function dispatch(msg) {</code> |

## tests/fixtures/acp/panel-test.js

[Open source](../tests/fixtures/acp/panel-test.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ok` | symbol | 14 | <code>function ok(what) { console.log(&#96;ok: ${what}&#96;); }</code> |
| `load` | symbol | 27 | <code>function load() {</code> |
| `send` | symbol | 44 | <code>const send = (msg) =&gt; listeners.forEach((fn) =&gt; fn({ data: msg }));</code> |
| `markdown` | symbol | 50 | <code>function markdown() {</code> |
| `cards` | symbol | 99 | <code>function cards() {</code> |
| `composer` | symbol | 160 | <code>function composer() {</code> |
| `agentState` | symbol | 201 | <code>function agentState() {</code> |
| `state` | symbol | 256 | <code>function state() {</code> |
| `providers` | symbol | 319 | <code>function providers() {</code> |
| `toolbar` | symbol | 348 | <code>function toolbar() {</code> |
| `subagents` | symbol | 383 | <code>function subagents() {</code> |
| `replay` | symbol | 439 | <code>function replay() {</code> |
| `handshake` | symbol | 469 | <code>function handshake() {</code> |
| `responsiveContract` | symbol | 477 | <code>function responsiveContract() {</code> |

## tests/fixtures/acp/test-client.js

[Open source](../tests/fixtures/acp/test-client.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ok` | symbol | 17 | <code>function ok(what) { console.log(&#96;ok: ${what}&#96;); }</code> |
| `sleep` | symbol | 21 | <code>function sleep(ms) { return new Promise((r) =&gt; setTimeout(r, ms)); }</code> |
| `fsHandlers` | symbol | 24 | <code>function fsHandlers(root, answers) {</code> |
| `newClient` | symbol | 42 | <code>function newClient(extra, onNotify, onRequest, onClose) {</code> |
| `happyPath` | symbol | 52 | <code>async function happyPath() {</code> |
| `rejectPath` | symbol | 145 | <code>async function rejectPath() {</code> |
| `cancelPath` | symbol | 168 | <code>async function cancelPath() {</code> |
| `versionMismatch` | symbol | 190 | <code>async function versionMismatch() {</code> |
| `spawnFailure` | symbol | 201 | <code>async function spawnFailure() {</code> |
| `malformedFrame` | symbol | 210 | <code>async function malformedFrame() {</code> |
| `agentDeath` | symbol | 225 | <code>async function agentDeath() {</code> |
| `bridgeSanity` | symbol | 240 | <code>function bridgeSanity() {</code> |
| `splitSanity` | symbol | 268 | <code>function splitSanity() {</code> |
| `adapterCommandSanity` | symbol | 276 | <code>function adapterCommandSanity() {</code> |
| `updateMappingSanity` | symbol | 297 | <code>function updateMappingSanity() {</code> |
| `emit` | symbol | 303 | <code>const emit = (update) =&gt; sessionUpdate(sess, { sessionId: 's', update });</code> |
| `harnessTextSanity` | symbol | 320 | <code>function harnessTextSanity() {</code> |

## tests/fixtures/anchors/core.c

[Open source](../tests/fixtures/anchors/core.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `post_entry` | symbol | 7 | <code>int post_entry(int amount) {</code> |
| `untouched` | symbol | 15 | <code>int untouched(void) { return 0; }</code> |

## tests/fixtures/anchors/main.go

[Open source](../tests/fixtures/anchors/main.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Reconcile` | symbol | 6 | <code>func Reconcile(total int) int {</code> |

## tests/fixtures/anchors/server.ts

[Open source](../tests/fixtures/anchors/server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `handle` | symbol | 6 | <code>export function handle(req: any) {</code> |
| `serve` | symbol | 11 | <code>export function serve(app: any) {</code> |
| `GET /api/tasks` | route | 12 | <code>app.get('/api/tasks', handle);</code> |

## tests/fixtures/anchors/tasks.py

[Open source](../tests/fixtures/anchors/tasks.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load_tasks` | symbol | 6 | <code>def load_tasks(path):</code> |
| `save_tasks` | symbol | 13 | <code>def save_tasks(path, tasks):</code> |

## tests/fixtures/grounding/src/app.ts

[Open source](../tests/fixtures/grounding/src/app.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `startApp` | symbol | 5 | <code>export function startApp() {</code> |

## tests/fixtures/grounding/src/typo.ts

[Open source](../tests/fixtures/grounding/src/typo.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `doWork` | symbol | 3 | <code>export function doWork() {</code> |

## tests/fixtures/grounding/src/util.ts

[Open source](../tests/fixtures/grounding/src/util.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `helper` | symbol | 1 | <code>export function helper(): string {</code> |
| `unused` | symbol | 5 | <code>export function unused(): void {</code> |

## tests/fixtures/sample/lib/tasks.py

[Open source](../tests/fixtures/sample/lib/tasks.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `load_tasks` | symbol | 6 | <code>def load_tasks(path):</code> |
| `save_tasks` | symbol | 11 | <code>def save_tasks(path, tasks):</code> |
| `TaskStore` | symbol | 18 | <code>class TaskStore:</code> |
| `__init__` | symbol | 19 | <code>def __init__(self, path):</code> |
| `all` | symbol | 22 | <code>def all(self):</code> |

## tests/fixtures/sample/main.go

[Open source](../tests/fixtures/sample/main.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `handleReq` | symbol | 5 | <code>func handleReq(name string) string {</code> |
| `main` | symbol | 9 | <code>func main() {</code> |

## tests/fixtures/sample/src/audit.ts

[Open source](../tests/fixtures/sample/src/audit.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `record` | symbol | 3 | <code>export function record(entry: string): string {</code> |

## tests/fixtures/sample/src/gauge.ts

[Open source](../tests/fixtures/sample/src/gauge.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `bumpGauge` | symbol | 3 | <code>export function bumpGauge(): number {</code> |

## tests/fixtures/sample/src/helpers.c

[Open source](../tests/fixtures/sample/src/helpers.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Config` | symbol | 7 | <code>struct Config {</code> |
| `check_path` | symbol | 13 | <code>static int check_path(const char *path) {</code> |
| `Opaque` | symbol | 20 | <code>struct Opaque;</code> |
| `Node` | symbol | 23 | <code>typedef struct Node {</code> |
| `Level` | symbol | 29 | <code>enum Level { LOW, MEDIUM, HIGH };</code> |
| `helpers_init` | symbol | 38 | <code>int helpers_init(int flags) {</code> |

## tests/fixtures/sample/src/hooks.ts

[Open source](../tests/fixtures/sample/src/hooks.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `registerHandler` | symbol | 1 | <code>export function registerHandler(topic: string): string {</code> |
| `trackChange` | symbol | 5 | <code>export function trackChange(entry: string): string {</code> |

## tests/fixtures/sample/src/jobs.ts

[Open source](../tests/fixtures/sample/src/jobs.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `scheduleJob` | symbol | 3 | <code>export function scheduleJob(name: string): string {</code> |

## tests/fixtures/sample/src/metrics.ts

[Open source](../tests/fixtures/sample/src/metrics.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `record` | symbol | 1 | <code>export function record(value: number): number {</code> |

## tests/fixtures/sample/src/replay/exporter.ts

[Open source](../tests/fixtures/sample/src/replay/exporter.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `replayAudit` | symbol | 3 | <code>export function replayAudit(): string {</code> |

## tests/fixtures/sample/src/replay/local.ts

[Open source](../tests/fixtures/sample/src/replay/local.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `record` | symbol | 1 | <code>export function record(note: string): string {</code> |

## tests/fixtures/sample/src/report.ts

[Open source](../tests/fixtures/sample/src/report.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `writeReport` | symbol | 3 | <code>export function writeReport(): string {</code> |

## tests/fixtures/sample/src/server.ts

[Open source](../tests/fixtures/sample/src/server.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `getUsers` | symbol | 6 | <code>export function getUsers(req: any, res: any) {</code> |
| `createUser` | symbol | 10 | <code>export function createUser(req: any, res: any) {</code> |
| `UserService` | symbol | 15 | <code>export class UserService {</code> |
| `find` | symbol | 16 | <code>find(id: string) {</code> |
| `GET /users` | route | 21 | <code>app.get("/users", getUsers);</code> |
| `POST /users` | route | 22 | <code>app.post("/users", createUser);</code> |

## tests/fixtures/sample/src/util.ts

[Open source](../tests/fixtures/sample/src/util.ts)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `formatName` | symbol | 1 | <code>export function formatName(first: string, last: string): string {</code> |
| `capitalize` | symbol | 5 | <code>export function capitalize(s: string): string {</code> |

## tests/unit/tap.h

[Open source](../tests/unit/tap.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `TAP_H` | symbol | 3 | <code>#define TAP_H</code> |
| `ok` | symbol | 10 | <code>#define ok(cond, ...) do { \</code> |
| `ok_str` | symbol | 20 | <code>#define ok_str(got, want) do { \</code> |
| `t_done` | symbol | 30 | <code>static int t_done(const char *name) {</code> |

## tests/unit/test_json.c

[Open source](../tests/unit/test_json.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | symbol | 5 | <code>int main(void) {</code> |

## tests/unit/test_kvx.c

[Open source](../tests/unit/test_kvx.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `write_tmp` | symbol | 8 | <code>static void write_tmp(const char *content) {</code> |
| `test_parse` | symbol | 43 | <code>static void test_parse(void) {</code> |
| `test_sort_edge` | symbol | 126 | <code>static void test_sort_edge(void) {</code> |
| `test_errors` | symbol | 137 | <code>static void test_errors(void) {</code> |
| `test_set_status` | symbol | 145 | <code>static void test_set_status(void) {</code> |
| `test_set_string` | symbol | 182 | <code>static void test_set_string(void) {</code> |
| `main` | symbol | 251 | <code>int main(void) {</code> |

## tests/unit/test_lang.c

[Open source](../tests/unit/test_lang.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `definition` | symbol | 5 | <code>static const SymDef *definition(const ParseResult *result, const char *name) {</code> |
| `reference` | symbol | 12 | <code>static bool reference(const ParseResult *result, const char *name) {</code> |
| `ref_of` | symbol | 19 | <code>static const SymRef *ref_of(const ParseResult *result, const char *name) {</code> |
| `span_at` | symbol | 27 | <code>static const CmtDef *span_at(const ParseResult *result, int line) {</code> |
| `import_row` | symbol | 34 | <code>static bool import_row(const ParseResult *result, const char *name,</code> |
| `system_import` | symbol | 43 | <code>static bool system_import(const ParseResult *result, const char *module) {</code> |
| `def_count` | symbol | 51 | <code>static int def_count(const ParseResult *result, const char *name) {</code> |
| `main` | symbol | 58 | <code>int main(void) {</code> |

## tests/unit/test_sha256.c

[Open source](../tests/unit/test_sha256.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `vec` | symbol | 5 | <code>static void vec(const char *msg, size_t len, const char *want) {</code> |
| `main` | symbol | 11 | <code>int main(void) {</code> |

## tests/unit/test_util.c

[Open source](../tests/unit/test_util.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | symbol | 6 | <code>int main(void) {</code> |
