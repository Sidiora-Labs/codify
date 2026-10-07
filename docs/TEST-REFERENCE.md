# Test and fixture reference

These are test-only graph observations, not supported product APIs or live Codify HTTP endpoints. In particular, `GET /api/tasks`, `GET /users`, and `POST /users` come from fixture applications. They test extraction; Codify does not start those applications.

The baseline contains 191 observations in 47 files. Source links and line numbers refer to the checkout used for this documentation pass; rerun the workflow after implementation changes. The declaration column quotes the source line at the indexed location and may be only the first line of a multiline declaration. It is not an inferred behavioral contract.

For shipped modules, see the [source reference](SOURCE-REFERENCE.md). The [testing instructions](../CONTRIBUTING.md#tests) explain how to exercise fixtures in temporary repositories.

## kvx/impl/go/kvx_test.go

[Open source](../kvx/impl/go/kvx_test.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `mustParse` | function | 31 | <code>func mustParse(t *testing.T, src string) *Doc {</code> |
| `TestParseBasics` | function | 40 | <code>func TestParseBasics(t *testing.T) {</code> |
| `TestOrderPreserved` | function | 65 | <code>func TestOrderPreserved(t *testing.T) {</code> |
| `TestSectionsWithPrefix` | function | 77 | <code>func TestSectionsWithPrefix(t *testing.T) {</code> |
| `TestSortDottedIDs` | function | 85 | <code>func TestSortDottedIDs(t *testing.T) {</code> |
| `TestIsList` | function | 94 | <code>func TestIsList(t *testing.T) {</code> |
| `TestDuplicateKeyLastWins` | function | 104 | <code>func TestDuplicateKeyLastWins(t *testing.T) {</code> |
| `TestParseErrors` | function | 114 | <code>func TestParseErrors(t *testing.T) {</code> |
| `TestCanonicalFixedPoint` | function | 128 | <code>func TestCanonicalFixedPoint(t *testing.T) {</code> |
| `TestConformanceCorpus` | function | 140 | <code>func TestConformanceCorpus(t *testing.T) {</code> |

## tests/fixtures/acp/dom-shim.js

[Open source](../tests/fixtures/acp/dom-shim.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `matches` | function | 6 | <code>function matches(el, sel) {</code> |
| `attrs` | function | 14 | <code>const attrs = (parts[3] &#124;&#124; '').match(/\[[^\]]+\]/g) &#124;&#124; [];</code> |
| `El` | class | 25 | <code>class El {</code> |
| `constructor` | method | 26 | <code>constructor(tag) {</code> |
| `add` | method | 39 | <code>add(...c) { c.forEach((x) =&gt; this._s.add(x)); self._sync(); },</code> |
| `remove` | method | 40 | <code>remove(...c) { c.forEach((x) =&gt; this._s.delete(x)); self._sync(); },</code> |
| `contains` | method | 41 | <code>contains(c) { return this._s.has(c); },</code> |
| `toggle` | method | 42 | <code>toggle(c, on) {</code> |
| `_sync` | method | 49 | <code>_sync() { this.attrs.class = [...this.classList._s].join(' '); }</code> |
| `appendChild` | method | 64 | <code>appendChild(c) { c.parent = this; this.children.push(c); return c; }</code> |
| `insertBefore` | method | 65 | <code>insertBefore(c, ref) {</code> |
| `removeChild` | method | 72 | <code>removeChild(c) {</code> |
| `remove` | method | 76 | <code>remove() {</code> |
| `addEventListener` | method | 80 | <code>addEventListener(ev, fn) {</code> |
| `dispatch` | method | 83 | <code>dispatch(ev, arg) {</code> |
| `click` | method | 87 | <code>click() { this.dispatch('click'); }</code> |
| `focus` | method | 88 | <code>focus() { doc.activeElement = this; }</code> |
| `scrollIntoView` | method | 89 | <code>scrollIntoView() {}</code> |
| `querySelectorAll` | method | 90 | <code>querySelectorAll(sel) {</code> |
| `walk` | function | 94 | <code>const walk = (n) =&gt; {</code> |
| `querySelector` | method | 101 | <code>querySelector(sel) { return this.querySelectorAll(sel)[0] &#124;&#124; null; }</code> |
| `dump` | method | 103 | <code>dump(depth) {</code> |
| `createElement` | method | 116 | <code>createElement(tag) { return new El(tag); },</code> |
| `createTextNode` | method | 117 | <code>createTextNode(t) { const e = new El('#text'); e.textContent = t; return e; },</code> |
| `getElementById` | method | 118 | <code>getElementById(id) { return doc._byId.get(id) &#124;&#124; null; },</code> |
| `addEventListener` | method | 121 | <code>addEventListener(ev, fn) {</code> |
| `dispatch` | method | 124 | <code>dispatch(ev, arg) {</code> |
| `bootstrap` | function | 135 | <code>function bootstrap(ids) {</code> |

## tests/fixtures/acp/fake-agent.js

[Open source](../tests/fixtures/acp/fake-agent.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `modes` | function | 28 | <code>function modes() {</code> |
| `configOptions` | function | 35 | <code>function configOptions() {</code> |
| `replaySession` | function | 47 | <code>function replaySession(sid) {</code> |
| `send` | function | 56 | <code>function send(obj) { process.stdout.write(JSON.stringify(obj) + '\n'); }</code> |
| `reply` | function | 57 | <code>function reply(id, result) { send({ jsonrpc: '2.0', id, result }); }</code> |
| `notify` | function | 58 | <code>function notify(method, params) { send({ jsonrpc: '2.0', method, params }); }</code> |
| `update` | function | 59 | <code>function update(sessionId, u) { notify('session/update', { sessionId, update: u }); }</code> |
| `request` | function | 61 | <code>function request(method, params) {</code> |
| `logLine` | function | 69 | <code>function logLine(method, params) {</code> |
| `promptTurn` | function | 75 | <code>async function promptTurn(id, params) {</code> |
| `text` | function | 77 | <code>const text = (params.prompt &#124;&#124; [])</code> |
| `dispatch` | function | 143 | <code>function dispatch(msg) {</code> |

## tests/fixtures/acp/panel-test.js

[Open source](../tests/fixtures/acp/panel-test.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ok` | function | 14 | <code>function ok(what) { console.log(`ok: ${what}`); }</code> |
| `load` | function | 28 | <code>function load() {</code> |
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
| `ok` | function | 20 | <code>function ok(what) { console.log(`ok: ${what}`); }</code> |
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
| `emit` | function | 306 | <code>const emit = (update) =&gt; sessionUpdate(sess, { sessionId: 's', update });</code> |
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

## tests/fixtures/codemap/src/count.c

[Open source](../tests/fixtures/codemap/src/count.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `count_file` | function | 5 | <code>int count_file(const char *path) {</code> |
| `count_lines` | function | 13 | <code>int count_lines(const char *path) {</code> |

## tests/fixtures/codemap/src/main.c

[Open source](../tests/fixtures/codemap/src/main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 6 | <code>int main(int argc, char **argv) {</code> |

## tests/fixtures/codemap/src/tally.h

[Open source](../tests/fixtures/codemap/src/tally.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `TALLY_H` | macro | 3 | <code>#define TALLY_H</code> |
| `count_file` | function | 4 | <code>int count_file(const char *path);</code> |
| `count_lines` | function | 5 | <code>int count_lines(const char *path);</code> |
| `text_load` | function | 6 | <code>char *text_load(const char *path);</code> |
| `text_words` | function | 7 | <code>int text_words(const char *s);</code> |
| `text_free` | function | 8 | <code>void text_free(char *s);</code> |

## tests/fixtures/codemap/src/text.c

[Open source](../tests/fixtures/codemap/src/text.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `text_load` | function | 7 | <code>char *text_load(const char *path) {</code> |
| `text_words` | function | 17 | <code>int text_words(const char *s) {</code> |
| `text_free` | function | 26 | <code>void text_free(char *s) { free(s); }</code> |

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
| `store_open` | function | 4 | <code>Store *store_open(void);</code> |
| `main` | function | 6 | <code>int main(void) {</code> |

## tests/fixtures/explore/proj/src/store.c

[Open source](../tests/fixtures/explore/proj/src/store.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Store` | struct | 5 | <code>struct Store {</code> |
| `write_line` | function | 10 | <code>static int write_line(FILE *out, const char *note) {</code> |
| `memory_export` | function | 14 | <code>int memory_export(Store *s, FILE *out) {</code> |
| `memory_import` | function | 20 | <code>int memory_import(Store *s, FILE *in) {</code> |
| `store_count` | function | 32 | <code>int store_count(const Store *s) {</code> |
| `store_close` | function | 36 | <code>void store_close(Store *s) {</code> |

## tests/fixtures/explore/proj/src/store.h

[Open source](../tests/fixtures/explore/proj/src/store.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `STORE_H` | macro | 3 | <code>#define STORE_H</code> |
| `memory_export` | function | 11 | <code>int memory_export(Store *s,</code> |
| `memory_import` | function | 16 | <code>int memory_import(Store *s, FILE *in);</code> |
| `store_close` | function | 19 | <code>void store_close(Store *s);</code> |
| `store_count` | function | 21 | <code>int store_count(const Store *s);</code> |

## tests/fixtures/explore/proj/tests/test_store.c

[Open source](../tests/fixtures/explore/proj/tests/test_store.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `store_open` | function | 4 | <code>Store *store_open(void);</code> |
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
| `fetchNotes` | function | 1 | <code>export async function fetchNotes(project: string): Promise&lt;string[]&gt; {</code> |

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
| `__init__` | function | 19 | <code>def __init__(self, path):</code> |
| `all` | function | 22 | <code>def all(self):</code> |

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
| `check_path` | function | 13 | <code>static int check_path(const char *path) {</code> |
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

## tests/unit/tap.h

[Open source](../tests/unit/tap.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `TAP_H` | macro | 3 | <code>#define TAP_H</code> |
| `ok` | macro | 10 | <code>#define ok(cond, ...) do { \</code> |
| `ok_str` | macro | 20 | <code>#define ok_str(got, want) do { \</code> |
| `t_done` | function | 30 | <code>static int t_done(const char *name) {</code> |

## tests/unit/test_config.c

[Open source](../tests/unit/test_config.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `project` | function | 12 | <code>static void project(char *out, size_t cap, const char *name, const char *body) {</code> |
| `quiet_load` | function | 25 | <code>static const CgConfig *quiet_load(const char *root) {</code> |
| `main` | function | 37 | <code>int main(void) {</code> |

## tests/unit/test_drivers.c

[Open source](../tests/unit/test_drivers.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Seen` | typedef | 6 | <code>typedef struct {</code> |
| `on` | function | 14 | <code>static void on(const DriverEvent *e, void *ud) {</code> |
| `parse` | function | 30 | <code>static int parse(const char *line, Seen *s) {</code> |
| `joined` | function | 35 | <code>static char *joined(char **av) {</code> |
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
| `write_tmp` | function | 8 | <code>static void write_tmp(const char *content) {</code> |
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
| `definition` | function | 5 | <code>static const SymDef *definition(const ParseResult *result, const char *name) {</code> |
| `reference` | function | 12 | <code>static bool reference(const ParseResult *result, const char *name) {</code> |
| `ref_of` | function | 19 | <code>static const SymRef *ref_of(const ParseResult *result, const char *name) {</code> |
| `span_at` | function | 27 | <code>static const CmtDef *span_at(const ParseResult *result, int line) {</code> |
| `import_row` | function | 34 | <code>static bool import_row(const ParseResult *result, const char *name,</code> |
| `system_import` | function | 43 | <code>static bool system_import(const ParseResult *result, const char *module) {</code> |
| `def_count` | function | 51 | <code>static int def_count(const ParseResult *result, const char *name) {</code> |
| `main` | function | 58 | <code>int main(void) {</code> |

## tests/unit/test_sha256.c

[Open source](../tests/unit/test_sha256.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `vec` | function | 5 | <code>static void vec(const char *msg, size_t len, const char *want) {</code> |
| `main` | function | 11 | <code>int main(void) {</code> |

## tests/unit/test_util.c

[Open source](../tests/unit/test_util.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `main` | function | 6 | <code>int main(void) {</code> |
