# Source reference

This is a source-navigation companion to the [architecture guide](ARCHITECTURE.md) and [contributor guide](../CONTRIBUTING.md), generated from Codify's own documentation evidence packet. It records indexed symbols, not promises that every symbol is public or stable. Static helpers, shared declarations, and JavaScript implementation details are included because the baseline coverage heuristic includes them.

The baseline contains 998 observations in 34 files. Source links and line numbers refer to the checkout used for this documentation pass; rerun the workflow after implementation changes. The declaration column quotes the source line at the indexed location and may be only the first line of a multiline declaration. It is not an inferred behavioral contract.

For tests, deliberately invalid examples, and sample web routes, see the separate [test and fixture reference](TEST-REFERENCE.md). Go files under `kvx/impl/go/` are vendored reference tooling; the shipped `cg` build uses the C sources selected by the [Makefile](../Makefile).

## editors/vscode/acp.js

[Open source](../editors/vscode/acp.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AcpClient` | symbol | 26 | <code>function AcpClient(opts) {</code> |
| `extensionVersion` | symbol | 219 | <code>function extensionVersion() {</code> |
| `splitCommand` | symbol | 224 | <code>function splitCommand(s) {</code> |
| `normalizeCodexAdapterCommand` | symbol | 238 | <code>function normalizeCodexAdapterCommand(value) {</code> |
| `config` | symbol | 268 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `firstLine` | symbol | 270 | <code>function firstLine(s) {</code> |
| `driverId` | symbol | 275 | <code>function driverId(v) { return DRIVER_IDS.indexOf(v) &gt;= 0 ? v : 'codex'; }</code> |
| `adapterCatalog` | symbol | 280 | <code>function adapterCatalog() {</code> |
| `custom` | symbol | 281 | <code>const custom = (config().get('acp.customCommand') &#124;&#124; '').trim();</code> |
| `adapterMap` | symbol | 292 | <code>function adapterMap() {</code> |
| `adapterCommand` | symbol | 303 | <code>function adapterCommand(override) {</code> |
| `custom` | symbol | 304 | <code>const custom = (config().get('acp.customCommand') &#124;&#124; '').trim();</code> |
| `rememberViewDriver` | symbol | 321 | <code>function rememberViewDriver(value) {</code> |
| `classifyUserText` | symbol | 334 | <code>function classifyUserText(raw) {</code> |
| `args` | symbol | 341 | <code>const args = (cmd[2] &#124;&#124; '').trim();</code> |
| `sessionTitle` | symbol | 352 | <code>function sessionTitle(raw) {</code> |
| `sessionRecord` | symbol | 368 | <code>function sessionRecord(row, driver) {</code> |
| `mergeSessionHistory` | symbol | 379 | <code>function mergeSessionHistory(rows, driver) {</code> |
| `rememberSession` | symbol | 396 | <code>function rememberSession(sess, extra) {</code> |
| `mcpServers` | symbol | 407 | <code>function mcpServers() {</code> |
| `workspacePath` | symbol | 415 | <code>function workspacePath(root, p) {</code> |
| `readTextFile` | symbol | 426 | <code>function readTextFile(root, params) {</code> |
| `writeTextFile` | symbol | 438 | <code>function writeTextFile(root, params) {</code> |
| `taskStatus` | symbol | 445 | <code>async function taskStatus(id) {</code> |
| `taskRow` | symbol | 455 | <code>async function taskRow(id) {</code> |
| `resumePrompt` | symbol | 466 | <code>async function resumePrompt(id) {</code> |
| `panelPost` | symbol | 486 | <code>function panelPost(sess, msg) {</code> |
| `panelHtml` | symbol | 490 | <code>function panelHtml(webview) {</code> |
| `sendPrompt` | symbol | 501 | <code>function sendPrompt(sess, text, echo) {</code> |
| `cancelTurn` | symbol | 539 | <code>function cancelTurn(sess) {</code> |
| `sessionRequest` | symbol | 550 | <code>function sessionRequest(sess, method, params) {</code> |
| `sessionUpdate` | symbol | 573 | <code>function sessionUpdate(sess, params) {</code> |
| `u` | symbol | 574 | <code>const u = (params &amp;&amp; params.update) &#124;&#124; {};</code> |
| `endOfSession` | symbol | 633 | <code>async function endOfSession(sess, why) {</code> |
| `connectAgent` | symbol | 669 | <code>async function connectAgent(sess, driverOverride) {</code> |
| `publishConnectedSession` | symbol | 699 | <code>function publishConnectedSession(sess, res) {</code> |
| `connectSession` | symbol | 721 | <code>async function connectSession(sess, driverOverride) {</code> |
| `connectFailureHint` | symbol | 732 | <code>function connectFailureHint(sess, e) {</code> |
| `surfacePost` | symbol | 741 | <code>function surfacePost(sess, msg) {</code> |
| `openLocation` | symbol | 747 | <code>async function openLocation(p, line) {</code> |
| `openExternal` | symbol | 772 | <code>async function openExternal(href) {</code> |
| `boardInfo` | symbol | 816 | <code>async function boardInfo() {</code> |
| `runCgSlash` | symbol | 824 | <code>async function runCgSlash(sess, cmd, args, send) {</code> |
| `out` | symbol | 835 | <code>const out = ((r.stdout &#124;&#124; '') + (r.code === 0 ? '' : '\n' + (r.stderr &#124;&#124; ''))).trim();</code> |
| `ask` | symbol | 843 | <code>const ask = (spec.zero &amp;&amp; args) ? args : spec.ask;</code> |
| `attachTask` | symbol | 850 | <code>async function attachTask(sess, id) {</code> |
| `taskLifecycle` | symbol | 881 | <code>async function taskLifecycle(sess, verb, send) {</code> |
| `out` | symbol | 892 | <code>const out = ((r.stdout &#124;&#124; '') + (r.code === 0 ? '' : '\n' + (r.stderr &#124;&#124; ''))).trim();</code> |
| `pickTaskId` | symbol | 906 | <code>async function pickTaskId(placeHolder) {</code> |
| `items` | symbol | 908 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `handleSessionMessage` | symbol | 922 | <code>function handleSessionMessage(sess, msg) {</code> |
| `sessionSlash` | symbol | 991 | <code>async function sessionSlash(sess, cmd, args) {</code> |
| `newSession` | symbol | 1032 | <code>function newSession(webview, extra) {</code> |
| `openAgentPanel` | symbol | 1046 | <code>async function openAgentPanel(id, agent, promptText, claimed) {</code> |
| `startPanelSession` | symbol | 1094 | <code>async function startPanelSession(id) {</code> |
| `currentDriver` | symbol | 1133 | <code>function currentDriver() {</code> |
| `postView` | symbol | 1137 | <code>function postView(msg) {</code> |
| `viewIdle` | symbol | 1143 | <code>function viewIdle() { return !viewSession; }</code> |
| `focusView` | symbol | 1146 | <code>async function focusView() {</code> |
| `agentCapabilities` | symbol | 1156 | <code>function agentCapabilities(sess) {</code> |
| `listPastSessions` | symbol | 1163 | <code>async function listPastSessions(quiet) {</code> |
| `restorePastSession` | symbol | 1216 | <code>async function restorePastSession(sessionId, driver) {</code> |
| `startChatSession` | symbol | 1266 | <code>async function startChatSession(firstText, taskOpts, echo) {</code> |
| `startTaskInView` | symbol | 1298 | <code>async function startTaskInView(id) {</code> |
| `resetViewSession` | symbol | 1332 | <code>async function resetViewSession() {</code> |
| `postViewInit` | symbol | 1347 | <code>async function postViewInit() {</code> |
| `idleSlash` | symbol | 1370 | <code>async function idleSlash(cmd, args) {</code> |
| `chooseDriver` | symbol | 1404 | <code>async function chooseDriver(value) {</code> |
| `cmdConfigure` | symbol | 1426 | <code>async function cmdConfigure() {</code> |
| `registerAgentView` | symbol | 1464 | <code>function registerAgentView(ctx) {</code> |
| `resolveWebviewView` | symbol | 1466 | <code>resolveWebviewView(view) {</code> |
| `cmdOpenPanel` | symbol | 1518 | <code>async function cmdOpenPanel(arg) {</code> |
| `items` | symbol | 1522 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `cmdNewChat` | symbol | 1558 | <code>async function cmdNewChat() {</code> |
| `registerAcpCommands` | symbol | 1562 | <code>function registerAcpCommands(ctx) {</code> |
| `register` | symbol | 1573 | <code>function register(ctx, d) {</code> |

## editors/vscode/agents.js

[Open source](../editors/vscode/agents.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `config` | symbol | 22 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `firstLine` | symbol | 24 | <code>function firstLine(s) {</code> |
| `driverName` | symbol | 28 | <code>function driverName() {</code> |
| `driverBits` | symbol | 32 | <code>function driverBits() {</code> |
| `driverLaunch` | symbol | 44 | <code>function driverLaunch(promptfile) {</code> |
| `headlessLaunch` | symbol | 51 | <code>function headlessLaunch(promptfile) {</code> |
| `ensurePolling` | symbol | 61 | <code>function ensurePolling() {</code> |
| `stopPollingIfIdle` | symbol | 69 | <code>function stopPollingIfIdle() {</code> |
| `specMode` | symbol | 78 | <code>async function specMode() {</code> |
| `taskStatus` | symbol | 83 | <code>async function taskStatus(id) {</code> |
| `liveClaim` | symbol | 93 | <code>async function liveClaim(id) {</code> |
| `pickTask` | symbol | 98 | <code>async function pickTask(filter, placeHolder) {</code> |
| `items` | symbol | 100 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `taskIdFrom` | symbol | 112 | <code>function taskIdFrom(arg) {</code> |
| `promptFileFor` | symbol | 120 | <code>async function promptFileFor(id) {</code> |
| `offerRelease` | symbol | 155 | <code>async function offerRelease(id, agent, exitCode) {</code> |
| `openTerminal` | symbol | 177 | <code>function openTerminal(id, agent, promptfile) {</code> |
| `runHeadless` | symbol | 188 | <code>function runHeadless(id, agent, promptfile) {</code> |
| `startAgentSession` | symbol | 210 | <code>async function startAgentSession(id, headless) {</code> |
| `cmdStartOnTask` | symbol | 256 | <code>async function cmdStartOnTask(arg) {</code> |
| `cmdStartHeadless` | symbol | 270 | <code>async function cmdStartHeadless(arg) {</code> |
| `cmdHandoff` | symbol | 277 | <code>async function cmdHandoff(arg) {</code> |
| `cmdResume` | symbol | 304 | <code>async function cmdResume(arg) {</code> |
| `cmdRunWave` | symbol | 325 | <code>async function cmdRunWave() {</code> |
| `cmdStop` | symbol | 338 | <code>async function cmdStop(arg) {</code> |
| `registerAgentCommands` | symbol | 369 | <code>function registerAgentCommands(ctx) {</code> |
| `register` | symbol | 383 | <code>function register(ctx, d) {</code> |
| `bump` | symbol | 424 | <code>const bump = () =&gt; {</code> |

## editors/vscode/client.js

[Open source](../editors/vscode/client.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LspClient` | symbol | 14 | <code>class LspClient {</code> |
| `constructor` | symbol | 15 | <code>constructor(bin, cwd, log) {</code> |
| `start` | symbol | 29 | <code>async start() {</code> |
| `dispose` | symbol | 72 | <code>dispose() {</code> |
| `onNotification` | symbol | 82 | <code>onNotification(method, fn) { this.handlers.set(method, fn); }</code> |
| `notify` | symbol | 101 | <code>notify(method, params) {</code> |
| `tryRequest` | symbol | 107 | <code>async tryRequest(method, params, fallback) {</code> |
| `_send` | symbol | 118 | <code>_send(msg) {</code> |
| `_consume` | symbol | 130 | <code>_consume(chunk) {</code> |
| `_dispatch` | symbol | 149 | <code>_dispatch(msg) {</code> |
| `uriOf` | symbol | 169 | <code>function uriOf(fsPath) {</code> |

## editors/vscode/extension.js

[Open source](../editors/vscode/extension.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `revalidate` | symbol | 25 | <code>let revalidate = () =&gt; {};</code> |
| `config` | symbol | 29 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `binary` | symbol | 30 | <code>function binary() { return config().get('binaryPath') &#124;&#124; 'cg'; }</code> |
| `workspaceRoot` | symbol | 32 | <code>function workspaceRoot() {</code> |
| `cg` | symbol | 38 | <code>function cg(args) {</code> |
| `cgJson` | symbol | 53 | <code>async function cgJson(args) {</code> |
| `TaskProvider` | symbol | 62 | <code>class TaskProvider {</code> |
| `constructor` | symbol | 63 | <code>constructor() {</code> |
| `refresh` | symbol | 69 | <code>async refresh() {</code> |
| `getTreeItem` | symbol | 85 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | symbol | 87 | <code>getChildren(el) {</code> |
| `claimFor` | symbol | 95 | <code>claimFor(id) {</code> |
| `claims` | symbol | 96 | <code>const claims = (this.model.status.claims) &#124;&#124; [];</code> |
| `waveNodes` | symbol | 100 | <code>waveNodes() {</code> |
| `taskNode` | symbol | 137 | <code>taskNode(t) {</code> |
| `hasDetail` | symbol | 138 | <code>const hasDetail = (t.symbols &amp;&amp; t.symbols.length) &#124;&#124;</code> |
| `detailNodes` | symbol | 174 | <code>detailNodes(t) {</code> |
| `ok` | symbol | 175 | <code>const ok = (b) =&gt; b</code> |
| `MemoryProvider` | symbol | 222 | <code>class MemoryProvider {</code> |
| `constructor` | symbol | 223 | <code>constructor() {</code> |
| `refresh` | symbol | 229 | <code>async refresh() {</code> |
| `getTreeItem` | symbol | 235 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | symbol | 237 | <code>getChildren() {</code> |
| `updateStatusBar` | symbol | 259 | <code>function updateStatusBar(model) {</code> |
| `updateScope` | symbol | 278 | <code>async function updateScope() {</code> |
| `show` | symbol | 291 | <code>function show(text) {</code> |
| `openReport` | symbol | 302 | <code>async function openReport(name, title, body) {</code> |
| `fence` | symbol | 313 | <code>function fence(text) {</code> |
| `pickTask` | symbol | 319 | <code>async function pickTask(statusFilter) {</code> |
| `taskIdFrom` | symbol | 339 | <code>function taskIdFrom(arg) {</code> |
| `afterMutation` | symbol | 345 | <code>async function afterMutation() {</code> |
| `cmdStart` | symbol | 351 | <code>async function cmdStart(arg) {</code> |
| `cmdImplemented` | symbol | 363 | <code>async function cmdImplemented(arg) {</code> |
| `cmdDone` | symbol | 375 | <code>async function cmdDone(arg) {</code> |
| `cmdDocs` | symbol | 403 | <code>async function cmdDocs(action) {</code> |
| `cmdClaim` | symbol | 413 | <code>async function cmdClaim(arg) {</code> |
| `cmdRelease` | symbol | 427 | <code>async function cmdRelease(arg) {</code> |
| `cmdTrace` | symbol | 435 | <code>async function cmdTrace(arg) {</code> |
| `cmdNext` | symbol | 442 | <code>async function cmdNext() {</code> |
| `cmdWave` | symbol | 453 | <code>async function cmdWave() {</code> |
| `cmdRender` | symbol | 458 | <code>async function cmdRender() {</code> |
| `cmdLint` | symbol | 464 | <code>async function cmdLint() {</code> |
| `cmdNewFeature` | symbol | 476 | <code>async function cmdNewFeature() {</code> |
| `cmdAddTask` | symbol | 493 | <code>async function cmdAddTask() {</code> |
| `cmdBrief` | symbol | 523 | <code>async function cmdBrief() {</code> |
| `cmdReview` | symbol | 528 | <code>async function cmdReview() {</code> |
| `cmdCheck` | symbol | 535 | <code>async function cmdCheck() {</code> |
| `cmdGuard` | symbol | 544 | <code>async function cmdGuard() {</code> |
| `cmdTestImpact` | symbol | 550 | <code>async function cmdTestImpact() {</code> |
| `cmdWhy` | symbol | 562 | <code>async function cmdWhy() {</code> |
| `cmdRemember` | symbol | 572 | <code>async function cmdRemember() {</code> |
| `cmdForget` | symbol | 593 | <code>async function cmdForget(arg) {</code> |
| `cmdSnapshot` | symbol | 603 | <code>async function cmdSnapshot() {</code> |
| `cmdSync` | symbol | 613 | <code>async function cmdSync() {</code> |
| `cmdHookInstall` | symbol | 619 | <code>async function cmdHookInstall() {</code> |
| `cmdOpenTask` | symbol | 624 | <code>async function cmdOpenTask(id) {</code> |
| `cmdActions` | symbol | 639 | <code>async function cmdActions() {</code> |
| `activate` | symbol | 669 | <code>async function activate(ctx) {</code> |
| `bump` | symbol | 755 | <code>const bump = () =&gt; {</code> |
| `deactivate` | symbol | 765 | <code>function deactivate() {</code> |

## editors/vscode/kvx.js

[Open source](../editors/vscode/kvx.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `lineInfo` | symbol | 38 | <code>function lineInfo(doc, line) {</code> |
| `findSection` | symbol | 47 | <code>function findSection(doc, name) {</code> |
| `register` | symbol | 57 | <code>function register(ctx, cgJson, workspaceRoot) {</code> |
| `provideDefinition` | symbol | 62 | <code>provideDefinition(doc, pos) {</code> |
| `key` | symbol | 67 | <code>const key = (/^\s*([A-Za-z_0-9]+)\s*=/.exec(line) &#124;&#124; [])[1];</code> |
| `provideCompletionItems` | symbol | 88 | <code>async provideCompletionItems(doc, pos) {</code> |
| `key` | symbol | 93 | <code>const key = (/^\s*([A-Za-z_0-9]+)\s*=/.exec(line) &#124;&#124; [])[1];</code> |
| `provideHover` | symbol | 136 | <code>provideHover(doc, pos) {</code> |
| `provideDocumentSymbols` | symbol | 152 | <code>provideDocumentSymbols(doc) {</code> |

## editors/vscode/language.js

[Open source](../editors/vscode/language.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `toRange` | symbol | 19 | <code>function toRange(r) {</code> |
| `toLocation` | symbol | 24 | <code>function toLocation(l) {</code> |
| `docParams` | symbol | 28 | <code>function docParams(doc, pos) {</code> |
| `register` | symbol | 34 | <code>function register(ctx, client, diagnostics) {</code> |
| `one` | symbol | 35 | <code>const one = (r) =&gt; (Array.isArray(r) ? r : r ? [r] : []).map(toLocation);</code> |
| `provideDefinition` | symbol | 39 | <code>async provideDefinition(doc, pos) {</code> |
| `provideReferences` | symbol | 46 | <code>async provideReferences(doc, pos) {</code> |
| `provideHover` | symbol | 53 | <code>async provideHover(doc, pos) {</code> |
| `provideDocumentSymbols` | symbol | 67 | <code>async provideDocumentSymbols(doc) {</code> |
| `provideWorkspaceSymbols` | symbol | 78 | <code>async provideWorkspaceSymbols(query) {</code> |
| `provideCodeLenses` | symbol | 88 | <code>async provideCodeLenses(doc) {</code> |
| `sync` | symbol | 121 | <code>const sync = (doc, method) =&gt; {</code> |
| `revalidate` | symbol | 145 | <code>return function revalidate() {</code> |

## kvx/impl/go/canonical.go

[Open source](../kvx/impl/go/canonical.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Canonical` | symbol | 17 | <code>func (d *Doc) Canonical() string {</code> |
| `Hash` | symbol | 41 | <code>func (d *Doc) Hash() string {</code> |

## kvx/impl/go/kvx.go

[Open source](../kvx/impl/go/kvx.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Doc` | symbol | 35 | <code>type Doc struct {</code> |
| `NewDoc` | symbol | 47 | <code>func NewDoc() *Doc {</code> |
| `ParseFile` | symbol | 55 | <code>func ParseFile(path string) (*Doc, error) {</code> |
| `Parse` | symbol | 65 | <code>func Parse(r io.Reader, name string) (*Doc, error) {</code> |
| `ensure` | symbol | 108 | <code>func (d *Doc) ensure(section string) {</code> |
| `stripComment` | symbol | 115 | <code>func stripComment(line string) string {</code> |
| `Has` | symbol | 131 | <code>func (d *Doc) Has(section string) bool {</code> |
| `Str` | symbol | 137 | <code>func (d *Doc) Str(section, key string) string {</code> |
| `Bool` | symbol | 150 | <code>func (d *Doc) Bool(section, key string, fallback bool) bool {</code> |
| `List` | symbol | 160 | <code>func (d *Doc) List(section, key string) []string {</code> |
| `Keys` | symbol | 190 | <code>func (d *Doc) Keys(section string) []string {</code> |
| `Raw` | symbol | 196 | <code>func (d *Doc) Raw(section, key string) string {</code> |
| `IsList` | symbol | 204 | <code>func (d *Doc) IsList(section, key string) bool {</code> |
| `OrderedKV` | symbol | 211 | <code>func (d *Doc) OrderedKV(section, prefix string) [][2]string {</code> |
| `Sections` | symbol | 223 | <code>func (d *Doc) Sections() []string { return d.order }</code> |
| `SectionsWithPrefix` | symbol | 227 | <code>func (d *Doc) SectionsWithPrefix(prefix string) []string {</code> |
| `UintOr` | symbol | 239 | <code>func (d *Doc) UintOr(section, key string, fallback uint64) uint64 {</code> |
| `splitList` | symbol | 251 | <code>func splitList(s string) []string {</code> |
| `unquote` | symbol | 269 | <code>func unquote(s string) string {</code> |
| `interpolate` | symbol | 277 | <code>func interpolate(s string) string {</code> |
| `SortDottedIDs` | symbol | 287 | <code>func SortDottedIDs(ids []string) {</code> |

## src/agent.c

[Open source](../src/agent.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `dir_lang` | symbol | 14 | <code>static void dir_lang(DirAgg *d, const char *lang) {</code> |
| `cmd_agentmd` | symbol | 54 | <code>int cmd_agentmd(Cg *cg, bool write_files) {</code> |

## src/cg.h

[Open source](../src/cg.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_H` | symbol | 7 | <code>#define CG_H</code> |
| `_GNU_SOURCE` | symbol | 9 | <code>#define _GNU_SOURCE</code> |
| `CG_DIR` | symbol | 18 | <code>#define CG_DIR      ".codegraph"</code> |
| `CG_DB` | symbol | 19 | <code>#define CG_DB       ".codegraph/graph.db"</code> |
| `CG_OBJECTS` | symbol | 20 | <code>#define CG_OBJECTS  ".codegraph/objects"</code> |
| `CG_HEAD` | symbol | 21 | <code>#define CG_HEAD     ".codegraph/HEAD"</code> |
| `CG_IGNORE` | symbol | 22 | <code>#define CG_IGNORE   ".cgignore"</code> |
| `CG_VERSION` | symbol | 23 | <code>#define CG_VERSION  "0.9.0"</code> |
| `CG_MCP_VERSION` | symbol | 24 | <code>#define CG_MCP_VERSION "2025-11-25"</code> |
| `CG_AGENT_CONTEXT` | symbol | 25 | <code>#define CG_AGENT_CONTEXT ".codify/agent-context.md"</code> |
| `CG_DOC_TASK` | symbol | 26 | <code>#define CG_DOC_TASK "@docs"</code> |
| `CG_DOCS_DIR` | symbol | 27 | <code>#define CG_DOCS_DIR ".codegraph/docs"</code> |
| `path_format` | symbol | 61 | <code>bool path_format(char *out, size_t cap, const char *fmt, ...)</code> |
| `hash_lines` | symbol | 74 | <code>void hash_lines(const char *data, size_t len, int from, int to,</code> |
| `MAX_DEFS_PER_LINE` | symbol | 94 | <code>#define MAX_DEFS_PER_LINE 4</code> |
| `lang_parse` | symbol | 149 | <code>void lang_parse(const char *lang, const char *path, const char *src,</code> |
| `routes_scan_line` | symbol | 157 | <code>void routes_scan_line(const char *lang, const char *path, int lineno,</code> |
| `route_add` | symbol | 159 | <code>void route_add(ParseResult *pr, const char *framework, const char *method,</code> |
| `CG_EXIT_BUSY` | symbol | 178 | <code>#define CG_EXIT_BUSY 75</code> |
| `is_entrypoint` | symbol | 260 | <code>bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,</code> |
| `cmd_commit_with_options` | symbol | 283 | <code>int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,</code> |
| `runtime_event_ingest` | symbol | 289 | <code>int runtime_event_ingest(Cg *cg, const char *source, const char *payload,</code> |
| `runtime_classify_progress` | symbol | 298 | <code>int runtime_classify_progress(Cg *cg, const char *attempt,</code> |
| `vcs_find_commits` | symbol | 307 | <code>int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,</code> |
| `vcs_commits_for_path` | symbol | 313 | <code>int vcs_commits_for_path(Cg *cg, const char *path, int limit, char ***ids,</code> |
| `memory_add` | symbol | 323 | <code>long memory_add(Cg *cg, const char *type, const char *task, const char *body,</code> |
| `memory_query` | symbol | 327 | <code>int  memory_query(Cg *cg, const char *query, const char *task,</code> |
| `cmd_remember` | symbol | 335 | <code>int  cmd_remember(Cg *cg, const char *text, const char *type, const char *task,</code> |
| `cmd_recall` | symbol | 337 | <code>int  cmd_recall(Cg *cg, const char *query, const char *task, const char *type,</code> |
| `kvx_set_string` | symbol | 379 | <code>int   kvx_set_string(const char *path, const char *section, const char *key,</code> |
| `kvx_set_raw` | symbol | 382 | <code>int   kvx_set_raw(const char *path, const char *section, const char *key,</code> |
| `anchor_stale` | symbol | 422 | <code>int anchor_stale(Cg *cg,</code> |
| `cmd_handoff` | symbol | 438 | <code>int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,</code> |
| `work_close` | symbol | 445 | <code>int work_close(Cg *cg, const char *task, int nevidence, char **evidence,</code> |
| `orch_driver_argv` | symbol | 457 | <code>int orch_driver_argv(const char *driver, const char *extra_args,</code> |

## src/db.c

[Open source](../src/db.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SCHEMA_VERSION` | symbol | 130 | <code>#define SCHEMA_VERSION "14"</code> |
| `path_exists` | symbol | 134 | <code>static bool path_exists(const char *base, const char *name) {</code> |
| `is_project_dir` | symbol | 141 | <code>static bool is_project_dir(const char *base) {</code> |
| `cg_is_boundary` | symbol | 151 | <code>bool cg_is_boundary(const char *dir) {</code> |
| `cg_find_root_at` | symbol | 161 | <code>int cg_find_root_at(const char *start, char *out, size_t cap) {</code> |
| `cg_find_root` | symbol | 193 | <code>int cg_find_root(char *out, size_t cap) {</code> |
| `cmd_root` | symbol | 201 | <code>int cmd_root(bool json) {</code> |
| `cg_open` | symbol | 222 | <code>int cg_open(Cg *cg, bool create) {</code> |
| `cg_schema_upgrade` | symbol | 267 | <code>int cg_schema_upgrade(Cg *cg) {</code> |
| `cg_close` | symbol | 309 | <code>void cg_close(Cg *cg) {</code> |
| `cg_prep` | symbol | 314 | <code>sqlite3_stmt *cg_prep(Cg *cg, const char *sql) {</code> |
| `busy_rc` | symbol | 323 | <code>static bool busy_rc(int rc) {</code> |
| `cg_busy_report` | symbol | 328 | <code>void cg_busy_report(const char *what) {</code> |
| `cg_lock_wait_default` | symbol | 339 | <code>long cg_lock_wait_default(void) {</code> |
| `cg_begin_write` | symbol | 345 | <code>int cg_begin_write(Cg *cg) {</code> |
| `cg_exec` | symbol | 364 | <code>void cg_exec(Cg *cg, const char *sql) {</code> |
| `cg_meta_set` | symbol | 378 | <code>void cg_meta_set(Cg *cg, const char *k, const char *v) {</code> |
| `cg_meta_get` | symbol | 388 | <code>char *cg_meta_get(Cg *cg, const char *k) {</code> |

## src/docs.c

[Open source](../src/docs.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DOCS_EVIDENCE_CAP` | symbol | 13 | <code>#define DOCS_EVIDENCE_CAP 16000</code> |
| `DOCS_INVENTORY_CAP` | symbol | 14 | <code>#define DOCS_INVENTORY_CAP 256</code> |
| `docs_str` | symbol | 36 | <code>static char *docs_str(const Kvx *k, const char *sec, const char *key,</code> |
| `docs_free_list` | symbol | 42 | <code>static void docs_free_list(char **v, int n) {</code> |
| `docs_project_close` | symbol | 47 | <code>static void docs_project_close(DocsProject *p) {</code> |
| `docs_defaults` | symbol | 56 | <code>static int docs_defaults(char ***out, const char **items, int n) {</code> |
| `docs_tasks_qualified` | symbol | 63 | <code>static bool docs_tasks_qualified(const Kvx *spec) {</code> |
| `docs_project_open` | symbol | 83 | <code>static int docs_project_open(Cg *cg, DocsProject *p) {</code> |
| `docs_suffix` | symbol | 153 | <code>static bool docs_suffix(const char *name) {</code> |
| `docs_inventory_walk` | symbol | 159 | <code>static void docs_inventory_walk(const char *root, const char *rel, int depth,</code> |
| `docs_inventory` | symbol | 195 | <code>static int docs_inventory(const DocsProject *p, StrBuf *text, StrBuf *json) {</code> |
| `docs_targets_json` | symbol | 208 | <code>static void docs_targets_json(const DocsProject *p, StrBuf *b) {</code> |
| `docs_target_match` | symbol | 223 | <code>static bool docs_target_match(const DocsProject *p, const char *path) {</code> |
| `docs_regular` | symbol | 234 | <code>static bool docs_regular(const DocsProject *p, const char *rel) {</code> |
| `docs_string_in_file` | symbol | 247 | <code>static bool docs_string_in_file(const DocsProject *p, const char *rel,</code> |
| `docs_symbol_exists` | symbol | 258 | <code>static bool docs_symbol_exists(Cg *cg, const char *name, const char *path) {</code> |
| `docs_route_exists` | symbol | 269 | <code>static bool docs_route_exists(Cg *cg, const char *value, const char *path) {</code> |
| `docs_claims_template` | symbol | 291 | <code>static int docs_claims_template(DocsProject *p, const char *path) {</code> |
| `docs_plan` | symbol | 395 | <code>static int docs_plan(Cg *cg, bool json) {</code> |
| `argc` | symbol | 432 | <code>typedef struct { int argc; char **argv; bool json; } DocsSpecCall;</code> |
| `docs_call_spec` | symbol | 433 | <code>static int docs_call_spec(void *v) {</code> |
| `cg` | symbol | 446 | <code>typedef struct { Cg *cg; int which; const char *feature; } DocsCall;</code> |
| `docs_call_evidence` | symbol | 447 | <code>static int docs_call_evidence(void *v) {</code> |
| `docs_append_capture` | symbol | 460 | <code>static void docs_append_capture(StrBuf *packet, StrBuf *ledger,</code> |
| `docs_packet` | symbol | 489 | <code>static int docs_packet(Cg *cg, bool json) {</code> |
| `errors` | symbol | 621 | <code>typedef struct { int errors; int checks; StrBuf report; } DocsCheck;</code> |
| `docs_check_say` | symbol | 623 | <code>static void docs_check_say(DocsCheck *c, bool ok, const char *fmt, ...) {</code> |
| `docs_allowed_system_path` | symbol | 636 | <code>static bool docs_allowed_system_path(const DocsProject *p, const char *path) {</code> |
| `docs_check_links` | symbol | 645 | <code>static int docs_check_links(const DocsProject *p, const char *doc,</code> |
| `docs_claim_evidence` | symbol | 694 | <code>static bool docs_claim_evidence(const DocsProject *p, const char *evidence,</code> |
| `docs_check_claims` | symbol | 706 | <code>static int docs_check_claims(DocsProject *p, DocsCheck *c) {</code> |
| `docs_check` | symbol | 799 | <code>static int docs_check(Cg *cg, bool json) {</code> |
| `docs_trace` | symbol | 865 | <code>static int docs_trace(Cg *cg, bool json) {</code> |
| `docs_call_check` | symbol | 926 | <code>static int docs_call_check(void *v) { return docs_check((Cg *)v, false); }</code> |
| `docs_call_finish` | symbol | 927 | <code>static int docs_call_finish(void *v) {</code> |
| `docs_close` | symbol | 932 | <code>static int docs_close(Cg *cg, bool json) {</code> |
| `cmd_docs` | symbol | 974 | <code>int cmd_docs(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/gitint.c

[Open source](../src/gitint.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `git_available` | symbol | 14 | <code>bool git_available(const Cg *cg) {</code> |
| `cmd_git_sync` | symbol | 26 | <code>int cmd_git_sync(Cg *cg, int limit, bool json) {</code> |
| `git_churn_for_path` | symbol | 103 | <code>int git_churn_for_path(Cg *cg, const char *path) {</code> |
| `git_commit_mirror` | symbol | 115 | <code>int git_commit_mirror(Cg *cg, const char *message) {</code> |

## src/govern.c

[Open source](../src/govern.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `run_capture` | symbol | 22 | <code>static int run_capture(char **out, int (*fn)(void *), void *ctx) {</code> |
| `argc` | symbol | 26 | <code>typedef struct { int argc; char **argv; bool json; } SpecCall;</code> |
| `call_spec` | symbol | 28 | <code>static int call_spec(void *v) {</code> |
| `spec_sub` | symbol | 41 | <code>static int spec_sub(char **out, bool json, int argc, ...) {</code> |
| `has_spec_repo` | symbol | 51 | <code>static bool has_spec_repo(const char *root) {</code> |
| `lease_touches_overlap` | symbol | 61 | <code>static bool lease_touches_overlap(const char *a, const char *b) {</code> |
| `cmd_check` | symbol | 79 | <code>int cmd_check(Cg *cg, bool json, bool strict)</code> |
| `active_task_json` | symbol | 276 | <code>static char *active_task_json(bool *is_current) {</code> |
| `brief_cap_body` | symbol | 290 | <code>static void brief_cap_body(Memory *m) {</code> |
| `brief_memories` | symbol | 304 | <code>static int brief_memories(Cg *cg, const char *task_json, Memory **out) {</code> |
| `cmd_brief` | symbol | 349 | <code>int cmd_brief(Cg *cg, bool json)</code> |
| `path_in_scope` | symbol | 423 | <code>static bool path_in_scope(const char *task_json, const char *path) {</code> |
| `guard_stale_cb` | symbol | 462 | <code>static void guard_stale_cb(void *u, const char *path, int line,</code> |
| `cmd_guard` | symbol | 484 | <code>int cmd_guard(Cg *cg, int npath, char **pathv, bool json, bool strict)</code> |
| `cmd_review` | symbol | 606 | <code>int cmd_review(Cg *cg, bool json)</code> |
| `write_exec` | symbol | 774 | <code>static int write_exec(const char *path, const char *body) {</code> |
| `cmd_hook_install` | symbol | 794 | <code>int cmd_hook_install(Cg *cg)</code> |
| `cmd_hook_install_git` | symbol | 832 | <code>static int cmd_hook_install_git(Cg *cg, const char *bin)</code> |
| `handoff_field` | symbol | 887 | <code>static char *handoff_field(const char *body, const char *key) {</code> |
| `handoff_live_id` | symbol | 908 | <code>static long handoff_live_id(Cg *cg, const char *tag) {</code> |
| `handoff_files` | symbol | 921 | <code>static char *handoff_files(Cg *cg, int cap, int *count) {</code> |
| `cmd_handoff` | symbol | 938 | <code>int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,</code> |
| `resume_json_field` | symbol | 989 | <code>static void resume_json_field(StrBuf *b, const char *name, const char *v) {</code> |
| `cmd_resume` | symbol | 998 | <code>int cmd_resume(Cg *cg, const char *task, bool json, bool prompt)</code> |
| `cg` | symbol | 1166 | <code>typedef struct { Cg *cg; const char *query; } WorkCapture;</code> |
| `work_call_state` | symbol | 1167 | <code>static int work_call_state(void *v) {</code> |
| `work_call_progress` | symbol | 1170 | <code>static int work_call_progress(void *v) {</code> |
| `work_call_context` | symbol | 1173 | <code>static int work_call_context(void *v) {</code> |
| `work_call_tests` | symbol | 1177 | <code>static int work_call_tests(void *v) {</code> |
| `work_raw_json` | symbol | 1182 | <code>static void work_raw_json(StrBuf *b, const char *raw) {</code> |
| `work_last_event` | symbol | 1191 | <code>static long work_last_event(Cg *cg, const char *task) {</code> |
| `work_event_json` | symbol | 1201 | <code>static void work_event_json(Cg *cg, StrBuf *b, const char *task, long after,</code> |
| `work_memories_json` | symbol | 1239 | <code>static void work_memories_json(Cg *cg, StrBuf *b, const char *task) {</code> |
| `work_revision_create` | symbol | 1253 | <code>static void work_revision_create(Cg *cg, const char *task, long event_id,</code> |
| `work_open` | symbol | 1280 | <code>int work_open(Cg *cg, const char *task, bool json) {</code> |
| `work_workspace_delta` | symbol | 1340 | <code>static void work_workspace_delta(Cg *cg, StrBuf *b, const char *revision,</code> |
| `work_update` | symbol | 1364 | <code>int work_update(Cg *cg, const char *revision, bool json) {</code> |
| `work_supplied_evidence` | symbol | 1432 | <code>static const char *work_supplied_evidence(const char *clause, int n,</code> |
| `work_recorded_evidence` | symbol | 1441 | <code>static char *work_recorded_evidence(Cg *cg, const char *task,</code> |
| `work_close` | symbol | 1480 | <code>int work_close(Cg *cg, const char *requested, int nevidence, char **evidence,</code> |
| `cmd_work` | symbol | 1540 | <code>int cmd_work(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/graph.c

[Open source](../src/graph.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fts_quote` | symbol | 12 | <code>static char *fts_quote(const char *q) {          /* "..." literal, "" escaped */</code> |
| `fts_words` | symbol | 23 | <code>static char *fts_words(const char *q) {          /* tok* tok* for unicode61 */</code> |
| `file_snippet_n` | symbol | 43 | <code>static char *file_snippet_n(Cg *cg, const char *rel, int from, int to,</code> |
| `file_snippet` | symbol | 73 | <code>static char *file_snippet(Cg *cg, const char *rel, int from, int to) {</code> |
| `sym_from_stmt_at` | symbol | 84 | <code>static int sym_from_stmt_at(sqlite3_stmt *st, int off, SymRow *r) {</code> |
| `sym_from_stmt` | symbol | 100 | <code>static int sym_from_stmt(sqlite3_stmt *st, SymRow *r) {</code> |
| `SYM_COLS` | symbol | 104 | <code>#define SYM_COLS "s.id,s.name,s.kind,f.path,s.line,s.end_line,s.sig"</code> |
| `ci_has` | symbol | 109 | <code>static bool ci_has(const char *hay, const char *needle) {</code> |
| `doc_derivable` | symbol | 119 | <code>static bool doc_derivable(const char *doc, const char *name, const char *sig) {</code> |
| `DOC_MAX_BYTES` | symbol | 136 | <code>#define DOC_MAX_BYTES 700    /* per-symbol share: ~10 lines of prose */</code> |
| `body` | symbol | 138 | <code>typedef struct { char *body; bool stale, cut; } SymDoc;</code> |
| `body_first` | symbol | 142 | <code>static bool body_first(void) {</code> |
| `doc_take` | symbol | 152 | <code>static void doc_take(SymDoc *d, const char *body, bool stale) {</code> |
| `symbol_doc` | symbol | 169 | <code>static bool symbol_doc(Cg *cg, const SymRow *r, SymDoc *d) {</code> |
| `doc_render` | symbol | 210 | <code>static void doc_render(StrBuf *b, const SymDoc *d) {</code> |
| `anchor_stale` | symbol | 229 | <code>int anchor_stale(Cg *cg,</code> |
| `doc_json` | symbol | 273 | <code>static void doc_json(StrBuf *b, const SymDoc *d) {</code> |
| `defs_named` | symbol | 281 | <code>static int defs_named(Cg *cg, const char *name, SymRow *out, int cap) {</code> |
| `find_symbols` | symbol | 295 | <code>static int find_symbols(Cg *cg, const char *q, SymRow *out, int cap) {</code> |
| `find_symbols_all` | symbol | 331 | <code>static int find_symbols_all(Cg *cg, const char *q, SymRow *out, int cap) {</code> |
| `RESOLVE_MAX_DEFS` | symbol | 368 | <code>#define RESOLVE_MAX_DEFS 64</code> |
| `rank_path_penalized` | symbol | 371 | <code>static bool rank_path_penalized(const char *path) {</code> |
| `path_depth` | symbol | 389 | <code>static int path_depth(const char *p) {</code> |
| `module_matches` | symbol | 401 | <code>static bool module_matches(const char *module, const char *cand_path) {</code> |
| `resolve_best` | symbol | 440 | <code>static int resolve_best(Cg *cg, long from_fid, const char *from_path,</code> |
| `callers_of` | symbol | 493 | <code>static int callers_of(Cg *cg, const SymRow *def, SymRow *out, int cap) {</code> |
| `sym_path_line_cmp` | symbol | 549 | <code>static int sym_path_line_cmp(const void *a, const void *b) {</code> |
| `callees_of` | symbol | 559 | <code>static int callees_of(Cg *cg, long sym_id, SymRow *out, int cap) {</code> |
| `ref_count` | symbol | 636 | <code>static int ref_count(Cg *cg, const char *name) {</code> |
| `ref_count_resolved` | symbol | 647 | <code>static int ref_count_resolved(Cg *cg, const SymRow *def) {</code> |
| `MAX_TOK` | symbol | 673 | <code>#define MAX_TOK 8</code> |
| `tokenize` | symbol | 676 | <code>static int tokenize(const char *q, char toks[][128], int cap) {</code> |
| `ci_contains` | symbol | 693 | <code>static bool ci_contains(const char *hay, const char *needle) {</code> |
| `r` | symbol | 701 | <code>typedef struct { SymRow r; int score, hits, refs; } Cand;</code> |
| `cand_add` | symbol | 703 | <code>static void cand_add(Cand *c, int *nc, int cap, const SymRow *r, int score) {</code> |
| `cand_cmp` | symbol | 719 | <code>static int cand_cmp(const void *a, const void *b) {</code> |
| `find_symbols_tokenized` | symbol | 731 | <code>static int find_symbols_tokenized(Cg *cg, const char *q, SymRow *out, int cap) {</code> |
| `ep_interesting` | symbol | 779 | <code>static bool ep_interesting(const SymRow *r) {</code> |
| `ep_push` | symbol | 786 | <code>static bool ep_push(SymRow *out, int *n, int cap, const SymRow *r) {</code> |
| `ep_climb` | symbol | 795 | <code>static void ep_climb(Cg *cg, const SymRow *from, SymRow *out, int *n, int cap,</code> |
| `context_entry_points` | symbol | 812 | <code>static int context_entry_points(Cg *cg, const char *q, const SymRow *matched,</code> |
| `json_sym` | symbol | 838 | <code>static void json_sym(StrBuf *b, const SymRow *r) {</code> |
| `json_sym_compact` | symbol | 848 | <code>static void json_sym_compact(StrBuf *b, const SymRow *r) {</code> |
| `seen_has` | symbol | 860 | <code>static bool seen_has(const SeenSet *s, const char *name) {</code> |
| `seen_add` | symbol | 866 | <code>static void seen_add(SeenSet *s, const char *name) {</code> |
| `body_first_line` | symbol | 873 | <code>static int body_first_line(Cg *cg, const char *rel, const char *tok) {</code> |
| `cmd_search` | symbol | 896 | <code>int cmd_search(Cg *cg, const char *q, int limit, bool json) {</code> |
| `cmd_symbol` | symbol | 976 | <code>int cmd_symbol(Cg *cg, const char *name, bool json) {</code> |
| `inode_seen` | symbol | 1027 | <code>static bool inode_seen(INode *v, int n, const char *name) {</code> |
| `IMPACT_CAP` | symbol | 1033 | <code>#define IMPACT_CAP 400</code> |
| `impact_bfs` | symbol | 1036 | <code>static int impact_bfs(Cg *cg, const SymRow *root, int depth, bool up,</code> |
| `impact_json_dir` | symbol | 1069 | <code>static void impact_json_dir(StrBuf *b, const char *key, const INode *v, int n,</code> |
| `cmd_impact` | symbol | 1095 | <code>int cmd_impact(Cg *cg, const char *name, int depth, int budget, bool json) {</code> |
| `cmd_routes` | symbol | 1152 | <code>int cmd_routes(Cg *cg, const char *filter, bool json) {</code> |
| `first_line` | symbol | 1208 | <code>static void first_line(StrBuf *b, const char *body, int max) {</code> |
| `cmd_survey` | symbol | 1242 | <code>int cmd_survey(Cg *cg, const char *scope, int budget, bool json) {</code> |
| `js` | symbol | 1481 | <code>typedef struct { StrBuf *txt, *js; int n; } AnchStale;</code> |
| `anch_stale_cb` | symbol | 1483 | <code>static void anch_stale_cb(void *u, const char *path, int line,</code> |
| `cmd_anchors` | symbol | 1506 | <code>int cmd_anchors(Cg *cg, bool stale_only, bool unc_only, bool json) {</code> |
| `cmd_context` | symbol | 1622 | <code>int cmd_context(Cg *cg, const char *q, int budget, int limit, bool json) {</code> |
| `symbols_at_position` | symbol | 1954 | <code>static int symbols_at_position(Cg *cg, const char *path, int line,</code> |
| `graph_symbol_at` | symbol | 1971 | <code>int graph_symbol_at(Cg *cg, const char *path, int line, char *name,</code> |
| `cmd_show` | symbol | 1979 | <code>int cmd_show(Cg *cg, const char *name, bool full, bool json) {</code> |
| `TEST_PATH_SQL` | symbol | 2044 | <code>#define TEST_PATH_SQL \</code> |
| `graph_path_is_test` | symbol | 2051 | <code>bool graph_path_is_test(const char *path) {</code> |
| `tests_for_symbol` | symbol | 2087 | <code>static int tests_for_symbol(Cg *cg, const char *name, StrBuf *b, bool json,</code> |
| `graph_task_focus` | symbol | 2116 | <code>char *graph_task_focus(Cg *cg, const char *task_packet) {</code> |
| `cmd_test_impact` | symbol | 2142 | <code>int cmd_test_impact(Cg *cg, const char *name, bool json) {</code> |
| `cmd_why` | symbol | 2200 | <code>int cmd_why(Cg *cg, const char *name, bool json) {</code> |

## src/integrate.c

[Open source](../src/integrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ConfigKind` | symbol | 12 | <code>typedef enum { CFG_JSON, CFG_VSCODE, CFG_TOML } ConfigKind;</code> |
| `NADAPTERS` | symbol | 47 | <code>#define NADAPTERS ((int)(sizeof ADAPTERS / sizeof ADAPTERS[0]))</code> |
| `integrate_self` | symbol | 54 | <code>static void integrate_self(char out[4096]) {</code> |
| `integrate_path` | symbol | 62 | <code>static void integrate_path(const Cg *cg, const char *tmpl, char out[4700]) {</code> |
| `json_balanced` | symbol | 76 | <code>static bool json_balanced(const char *s) {</code> |
| `protocol_supported` | symbol | 95 | <code>static bool protocol_supported(const char *v) {</code> |
| `integrate_config_state` | symbol | 101 | <code>static ConfigState integrate_config_state(const Adapter *a,</code> |
| `integrate_action` | symbol | 128 | <code>static const char *integrate_action(const ConfigState *s) {</code> |
| `ensure_parent` | symbol | 135 | <code>static int ensure_parent(const char *path) {</code> |
| `backup_existing` | symbol | 144 | <code>static int backup_existing(const char *path, const char *body) {</code> |
| `integrate_entry` | symbol | 152 | <code>static char *integrate_entry(const char *bin, bool vscode) {</code> |
| `integrate_json_apply` | symbol | 161 | <code>static int integrate_json_apply(const Adapter *a, const char *path,</code> |
| `integrate_toml_apply` | symbol | 206 | <code>static int integrate_toml_apply(const char *path, const char *bin) {</code> |
| `asset_state` | symbol | 249 | <code>static const char *asset_state(const char *path, const char *marker) {</code> |
| `apply_asset` | symbol | 257 | <code>static int apply_asset(const char *path, const char *body, bool executable) {</code> |
| `host_shim_body` | symbol | 268 | <code>static char *host_shim_body(const char *host) {</code> |
| `cg` | symbol | 275 | <code>typedef struct { Cg *cg; } IntegrateAgentmd;</code> |
| `integrate_agentmd_call` | symbol | 276 | <code>static int integrate_agentmd_call(void *v) {</code> |
| `integrate_agent_context` | symbol | 285 | <code>static int integrate_agent_context(Cg *cg) {</code> |
| `integrate_apply_portable` | symbol | 311 | <code>int integrate_apply_portable(Cg *cg, bool quiet) {</code> |
| `adapter_json` | symbol | 337 | <code>static void adapter_json(const Adapter *a, const char *path,</code> |
| `integrate_plan` | symbol | 355 | <code>int integrate_plan(Cg *cg, bool json) {</code> |
| `integrate_apply` | symbol | 417 | <code>int integrate_apply(Cg *cg, bool json) {</code> |
| `doctor_find` | symbol | 467 | <code>static void doctor_find(StrBuf *findings, int *n, bool json,</code> |
| `integrate_doctor` | symbol | 483 | <code>int integrate_doctor(Cg *cg, bool json) {</code> |
| `integrate_detect` | symbol | 563 | <code>static int integrate_detect(Cg *cg, bool json) {</code> |
| `cmd_integrate` | symbol | 591 | <code>int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility) {</code> |

## src/json.c

[Open source](../src/json.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `skip_value` | symbol | 9 | <code>static const char *skip_value(const char *p) {</code> |
| `find_key` | symbol | 44 | <code>static const char *find_key(const char *obj, const char *key) {</code> |
| `unescape` | symbol | 72 | <code>static char *unescape(const char *s, size_t n) {</code> |
| `json_get_string` | symbol | 106 | <code>char *json_get_string(const char *obj, const char *key) {</code> |
| `json_get_int` | symbol | 118 | <code>long json_get_int(const char *obj, const char *key, long dflt) {</code> |
| `json_get_raw` | symbol | 124 | <code>char *json_get_raw(const char *obj, const char *key) {</code> |
| `json_get_object` | symbol | 135 | <code>char *json_get_object(const char *obj, const char *key) {</code> |
| `json_object_keys` | symbol | 146 | <code>int json_object_keys(const char *obj, char **keys, int cap) {</code> |

## src/kvx.c

[Open source](../src/kvx.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `strip_comment` | symbol | 19 | <code>static size_t strip_comment(char *s, size_t n) {</code> |
| `trim` | symbol | 30 | <code>static char *trim(char *s) {</code> |
| `kvx_add_section` | symbol | 37 | <code>static void kvx_add_section(Kvx *k, const char *sec) {</code> |
| `kvx_parse` | symbol | 47 | <code>Kvx *kvx_parse(const char *path) {</code> |
| `kvx_free` | symbol | 100 | <code>void kvx_free(Kvx *k) {</code> |
| `kvx_has` | symbol | 112 | <code>bool kvx_has(const Kvx *k, const char *sec) {</code> |
| `kvx_raw` | symbol | 118 | <code>const char *kvx_raw(const Kvx *k, const char *sec, const char *key) {</code> |
| `env_name` | symbol | 126 | <code>static bool env_name(const char *s, size_t n) {</code> |
| `interp_unquote` | symbol | 134 | <code>static char *interp_unquote(const char *raw) {</code> |
| `kvx_str` | symbol | 160 | <code>char *kvx_str(const Kvx *k, const char *sec, const char *key) {</code> |
| `kvx_long` | symbol | 166 | <code>long kvx_long(const Kvx *k, const char *sec, const char *key, long dflt) {</code> |
| `kvx_bool` | symbol | 176 | <code>bool kvx_bool(const Kvx *k, const char *sec, const char *key, bool dflt) {</code> |
| `kvx_list` | symbol | 185 | <code>int kvx_list(const Kvx *k, const char *sec, const char *key, char ***out) {</code> |
| `kvx_keys` | symbol | 226 | <code>int kvx_keys(const Kvx *k, const char *sec, const char ***out) {</code> |
| `kvx_subsections` | symbol | 238 | <code>int kvx_subsections(const Kvx *k, const char *prefix, char ***out) {</code> |
| `seg_int` | symbol | 259 | <code>static bool seg_int(const char *s, size_t n, long *out) {</code> |
| `dotted_cmp` | symbol | 273 | <code>static int dotted_cmp(const void *pa, const void *pb) {</code> |
| `kvx_sort_dotted` | symbol | 292 | <code>void kvx_sort_dotted(char **ids, int n) {</code> |
| `kvx_lock` | symbol | 301 | <code>static int kvx_lock(const char *path) {</code> |
| `kvx_unlock` | symbol | 309 | <code>static void kvx_unlock(int fd) {</code> |
| `kvx_set_status` | symbol | 313 | <code>int kvx_set_status(const char *path, const char *section, const char *value) {</code> |
| `sb_kvx_string` | symbol | 373 | <code>static void sb_kvx_string(StrBuf *b, const char *value) {</code> |
| `kvx_set_value` | symbol | 394 | <code>static int kvx_set_value(const char *path, const char *section, const char *key,</code> |
| `kvx_set_string` | symbol | 500 | <code>int kvx_set_string(const char *path, const char *section, const char *key,</code> |
| `kvx_set_raw` | symbol | 505 | <code>int kvx_set_raw(const char *path, const char *section, const char *key,</code> |

## src/lang.c

[Open source](../src/lang.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ID` | symbol | 10 | <code>#define ID "[A-Za-z_][A-Za-z0-9_]*"</code> |
| `NW` | symbol | 11 | <code>#define NW "(^&#124;[^A-Za-z0-9_])"          /* non-word boundary, consumes 0-1 */</code> |
| `kind` | symbol | 13 | <code>typedef struct { const char *kind; const char *pat; int group; } DefPat;</code> |
| `MAXPATS` | symbol | 26 | <code>#define MAXPATS 12</code> |
| `NLANGS` | symbol | 139 | <code>#define NLANGS ((int)(sizeof LANGS / sizeof LANGS[0]))</code> |
| `word_in` | symbol | 178 | <code>static bool word_in(const char *const *words, const char *s, size_t n) {</code> |
| `is_keyword` | symbol | 185 | <code>static bool is_keyword(const LangSpec *L, const char *s, size_t n) {</code> |
| `lang_global_init` | symbol | 191 | <code>void lang_global_init(void) {</code> |
| `spec_by_name` | symbol | 214 | <code>static const LangSpec *spec_by_name(const char *name) {</code> |
| `lang_for_path` | symbol | 220 | <code>const char *lang_for_path(const char *path) {</code> |
| `spec_for_path` | symbol | 227 | <code>static const LangSpec *spec_for_path(const char *path) {</code> |
| `CMT_MAX_BYTES` | symbol | 236 | <code>#define CMT_MAX_BYTES 4000        /* a span longer than this is a licence header */</code> |
| `add_cmt` | symbol | 238 | <code>static void add_cmt(ParseResult *pr, const char *body, int line, int end,</code> |
| `b` | symbol | 255 | <code>typedef struct { StrBuf b; int line, end; bool pure, open, below; } CmtAcc;</code> |
| `cmt_flush` | symbol | 257 | <code>static void cmt_flush(CmtAcc *a, ParseResult *pr) {</code> |
| `add_def` | symbol | 269 | <code>static void add_def(ParseResult *pr, const char *name, size_t nlen,</code> |
| `count_args` | symbol | 300 | <code>static int count_args(const char *clean, size_t open) {</code> |
| `add_ref` | symbol | 316 | <code>static void add_ref(ParseResult *pr, const char *name, size_t nlen, int line,</code> |
| `add_import` | symbol | 338 | <code>static void add_import(ParseResult *pr, const char *name, size_t nlen,</code> |
| `route_add` | symbol | 358 | <code>void route_add(ParseResult *pr, const char *framework, const char *method,</code> |
| `parse_result_free` | symbol | 372 | <code>void parse_result_free(ParseResult *pr) {</code> |
| `starts_with` | symbol | 390 | <code>static bool starts_with(const char *s, const char *pre) {</code> |
| `end` | symbol | 397 | <code>typedef struct { int start, end; } CmtRange;</code> |
| `cmt_mark` | symbol | 399 | <code>static void cmt_mark(CmtRange *cr, size_t a, size_t b) {</code> |
| `clean_line` | symbol | 415 | <code>static void clean_line(const LangSpec *L, const char *line, size_t n,</code> |
| `idstart` | symbol | 492 | <code>static bool idstart(char c) { return isalpha((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `idchar` | symbol | 493 | <code>static bool idchar(char c)  { return isalnum((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `lang_scope_end` | symbol | 502 | <code>static int lang_scope_end(const LangSpec *L, char *const *lines, int nlines,</code> |
| `skip_sp` | symbol | 543 | <code>static const char *skip_sp(const char *s) {</code> |
| `kw_at` | symbol | 548 | <code>static bool kw_at(const char *s, const char *kw) {</code> |
| `quoted_span` | symbol | 554 | <code>static bool quoted_span(const char *s, const char **out, size_t *n) {</code> |
| `seg_name` | symbol | 566 | <code>static void seg_name(const char *s, const char *e, const char **out, size_t *n) {</code> |
| `imp_js` | symbol | 581 | <code>static void imp_js(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_py` | symbol | 617 | <code>static void imp_py(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_go` | symbol | 659 | <code>static void imp_go(const char *line, int lineno, ParseResult *pr, int *state) {</code> |
| `imp_inc` | symbol | 682 | <code>static void imp_inc(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_rust` | symbol | 699 | <code>static void imp_rust(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_dot` | symbol | 735 | <code>static void imp_dot(const LangSpec *L, const char *line, int lineno,</code> |
| `lang_scan_imports` | symbol | 759 | <code>static void lang_scan_imports(const LangSpec *L, const char *line, int lineno,</code> |
| `lang_parse` | symbol | 772 | <code>void lang_parse(const char *lang, const char *path, const char *src,</code> |

## src/lsp.c

[Open source](../src/lsp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LSP_KIND_FN` | symbol | 22 | <code>#define LSP_KIND_FN 12</code> |
| `LSP_LOCK_WAIT_MS` | symbol | 29 | <code>#define LSP_LOCK_WAIT_MS 1500</code> |
| `LSP_INDEX_RETRY_MS` | symbol | 30 | <code>#define LSP_INDEX_RETRY_MS 3000</code> |
| `lsp_index` | symbol | 34 | <code>static void lsp_index(Cg *cg, const SysInfo *si) {</code> |
| `lsp_read` | symbol | 54 | <code>static char *lsp_read(void) {</code> |
| `lsp_send` | symbol | 73 | <code>static void lsp_send(const char *payload) {</code> |
| `lsp_reply` | symbol | 78 | <code>static void lsp_reply(const char *id, const char *result) {</code> |
| `lsp_notify` | symbol | 85 | <code>static void lsp_notify(const char *method, const char *params) {</code> |
| `uri_to_path` | symbol | 95 | <code>static void uri_to_path(const char *uri, char *out, size_t cap) {</code> |
| `path_to_uri` | symbol | 111 | <code>static void path_to_uri(const char *root, const char *rel, StrBuf *b) {</code> |
| `rel_of` | symbol | 119 | <code>static const char *rel_of(const Cg *cg, const char *abs) {</code> |
| `emit_location` | symbol | 127 | <code>static void emit_location(Cg *cg, StrBuf *b, const char *path, int line,</code> |
| `word_at` | symbol | 140 | <code>static bool word_at(const char *abs, int line0, int chr, char *out, size_t cap) {</code> |
| `lsp_hover` | symbol | 166 | <code>void lsp_hover(Cg *cg, const char *name, StrBuf *md) {</code> |
| `diag_add` | symbol | 207 | <code>static void diag_add(StrBuf *b, int *n, int line, int severity,</code> |
| `lsp_path_in_task_scope` | symbol | 221 | <code>bool lsp_path_in_task_scope(Cg *cg, const char *rel) {</code> |
| `lsp_diagnostics` | symbol | 241 | <code>void lsp_diagnostics(Cg *cg, const char *abs, StrBuf *out) {</code> |
| `publish_diagnostics` | symbol | 294 | <code>static void publish_diagnostics(Cg *cg, const char *uri, const char *abs) {</code> |
| `request_word` | symbol | 307 | <code>static bool request_word(Cg *cg, const char *params, char *word, size_t wcap,</code> |
| `cmd_lsp` | symbol | 328 | <code>int cmd_lsp(Cg *cg, const SysInfo *si) {</code> |

## src/main.c

[Open source](../src/main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `usage` | symbol | 6 | <code>static void usage(void) {</code> |
| `flag` | symbol | 106 | <code>static bool flag(int *argc, char **argv, const char *name) {</code> |
| `opt` | symbol | 118 | <code>static const char *opt(int *argc, char **argv, const char *name,</code> |
| `cmd_info` | symbol | 132 | <code>static int cmd_info(const SysInfo *si, Cg *cg, bool json) {</code> |
| `main` | symbol | 184 | <code>int main(int argc, char **argv) {</code> |

## src/mcp.c

[Open source](../src/mcp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `t_search` | symbol | 24 | <code>static int t_search(void *v) {</code> |
| `t_context` | symbol | 33 | <code>static int t_context(void *v) {</code> |
| `t_survey` | symbol | 45 | <code>static int t_survey(void *v) {</code> |
| `t_anchors` | symbol | 54 | <code>static int t_anchors(void *v) {</code> |
| `t_symbol` | symbol | 63 | <code>static int t_symbol(void *v) {</code> |
| `t_impact` | symbol | 71 | <code>static int t_impact(void *v) {</code> |
| `t_routes` | symbol | 82 | <code>static int t_routes(void *v) {</code> |
| `t_status` | symbol | 89 | <code>static int t_status(void *v)  { CallCtx *c = v; return cmd_status(c-&gt;cg, true); }</code> |
| `t_state` | symbol | 90 | <code>static int t_state(void *v)   { CallCtx *c = v; return cmd_state(c-&gt;cg, true); }</code> |
| `t_integrate` | symbol | 91 | <code>static int t_integrate(void *v) {</code> |
| `t_event_ingest` | symbol | 98 | <code>static int t_event_ingest(void *v) {</code> |
| `t_event_history` | symbol | 109 | <code>static int t_event_history(void *v) {</code> |
| `t_progress` | symbol | 116 | <code>static int t_progress(void *v) {</code> |
| `t_work_open` | symbol | 120 | <code>static int t_work_open(void *v) {</code> |
| `t_work_update` | symbol | 127 | <code>static int t_work_update(void *v) {</code> |
| `t_work_close` | symbol | 135 | <code>static int t_work_close(void *v) {</code> |
| `t_changes` | symbol | 149 | <code>static int t_changes(void *v) {</code> |
| `t_log` | symbol | 154 | <code>static int t_log(void *v) {</code> |
| `t_commit` | symbol | 159 | <code>static int t_commit(void *v) {</code> |
| `fold_stderr` | symbol | 171 | <code>static int fold_stderr(void) {</code> |
| `unfold_stderr` | symbol | 177 | <code>static void unfold_stderr(int saved) {</code> |
| `run_spec` | symbol | 183 | <code>static int run_spec(int argc, char **argv, bool json) {</code> |
| `t_spec_status` | symbol | 190 | <code>static int t_spec_status(void *v) {</code> |
| `t_spec_reconcile` | symbol | 195 | <code>static int t_spec_reconcile(void *v) {</code> |
| `t_spec_next` | symbol | 204 | <code>static int t_spec_next(void *v) {</code> |
| `t_spec_start` | symbol | 209 | <code>static int t_spec_start(void *v) {</code> |
| `t_spec_mode` | symbol | 218 | <code>static int t_spec_mode(void *v) {</code> |
| `t_spec_implemented` | symbol | 227 | <code>static int t_spec_implemented(void *v) {</code> |
| `t_spec_done` | symbol | 242 | <code>static int t_spec_done(void *v) {</code> |
| `t_spec_render` | symbol | 254 | <code>static int t_spec_render(void *v) {</code> |
| `t_spec_trace` | symbol | 262 | <code>static int t_spec_trace(void *v) {</code> |
| `t_docs` | symbol | 271 | <code>static int t_docs(void *v, const char *action) {</code> |
| `t_docs_status` | symbol | 276 | <code>static int t_docs_status(void *v) { return t_docs(v, "status"); }</code> |
| `t_docs_plan` | symbol | 277 | <code>static int t_docs_plan(void *v)   { return t_docs(v, "plan"); }</code> |
| `t_docs_packet` | symbol | 278 | <code>static int t_docs_packet(void *v) { return t_docs(v, "packet"); }</code> |
| `t_docs_check` | symbol | 279 | <code>static int t_docs_check(void *v)  { return t_docs(v, "check"); }</code> |
| `t_docs_trace` | symbol | 280 | <code>static int t_docs_trace(void *v)  { return t_docs(v, "trace"); }</code> |
| `t_docs_close` | symbol | 281 | <code>static int t_docs_close(void *v)  { return t_docs(v, "close"); }</code> |
| `t_remember` | symbol | 282 | <code>static int t_remember(void *v) {</code> |
| `t_recall` | symbol | 295 | <code>static int t_recall(void *v) {</code> |
| `t_show` | symbol | 306 | <code>static int t_show(void *v) {</code> |
| `t_why` | symbol | 317 | <code>static int t_why(void *v) {</code> |
| `t_test_impact` | symbol | 325 | <code>static int t_test_impact(void *v) {</code> |
| `t_brief` | symbol | 332 | <code>static int t_brief(void *v)  { CallCtx *c = v; return cmd_brief(c-&gt;cg, true); }</code> |
| `t_review` | symbol | 333 | <code>static int t_review(void *v) { CallCtx *c = v; return cmd_review(c-&gt;cg, true); }</code> |
| `t_check` | symbol | 334 | <code>static int t_check(void *v)  { CallCtx *c = v; return cmd_check(c-&gt;cg, true, false); }</code> |
| `t_guard` | symbol | 335 | <code>static int t_guard(void *v) {</code> |
| `t_git_sync` | symbol | 343 | <code>static int t_git_sync(void *v) {</code> |
| `t_spec_wave` | symbol | 348 | <code>static int t_spec_wave(void *v) {</code> |
| `t_spec_lint` | symbol | 353 | <code>static int t_spec_lint(void *v) {</code> |
| `t_spec_new` | symbol | 358 | <code>static int t_spec_new(void *v) {</code> |
| `t_spec_add` | symbol | 367 | <code>static int t_spec_add(void *v) {</code> |
| `t_spec_claim` | symbol | 398 | <code>static int t_spec_claim(void *v) {</code> |
| `t_spec_release` | symbol | 413 | <code>static int t_spec_release(void *v) {</code> |
| `t_spec_ready` | symbol | 428 | <code>static int t_spec_ready(void *v) {</code> |
| `t_spec_claim_next` | symbol | 433 | <code>static int t_spec_claim_next(void *v) {</code> |
| `t_handoff` | symbol | 446 | <code>static int t_handoff(void *v) {</code> |
| `t_resume` | symbol | 459 | <code>static int t_resume(void *v) {</code> |
| `S_QUERY` | symbol | 469 | <code>#define S_QUERY  "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \</code> |
| `S_CTX` | symbol | 471 | <code>#define S_CTX    "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \</code> |
| `S_SURVEY` | symbol | 475 | <code>#define S_SURVEY "{\"type\":\"object\",\"properties\":{\"scope\":{\"type\":" \</code> |
| `S_ANCHORS` | symbol | 479 | <code>#define S_ANCHORS "{\"type\":\"object\",\"properties\":{\"stale\":{\"type\":" \</code> |
| `S_NAME` | symbol | 483 | <code>#define S_NAME   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}," \</code> |
| `S_IMPACT` | symbol | 485 | <code>#define S_IMPACT "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \</code> |
| `S_FILTER` | symbol | 489 | <code>#define S_FILTER "{\"type\":\"object\",\"properties\":{\"filter\":{\"type\":\"string\"}}}"</code> |
| `S_EMPTY` | symbol | 490 | <code>#define S_EMPTY  "{\"type\":\"object\",\"properties\":{}}"</code> |
| `S_INTEGRATE` | symbol | 491 | <code>#define S_INTEGRATE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_EVENT` | symbol | 495 | <code>#define S_EVENT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_OPEN` | symbol | 499 | <code>#define S_WORK_OPEN "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_UPDATE` | symbol | 501 | <code>#define S_WORK_UPDATE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_CLOSE` | symbol | 504 | <code>#define S_WORK_CLOSE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RECONCILE` | symbol | 508 | <code>#define S_RECONCILE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_LIMIT` | symbol | 511 | <code>#define S_LIMIT  "{\"type\":\"object\",\"properties\":{\"limit\":{\"type\":\"integer\"}}}"</code> |
| `S_MSG` | symbol | 512 | <code>#define S_MSG    "{\"type\":\"object\",\"properties\":{\"message\":{\"type\":\"string\"}}," \</code> |
| `S_TASKID` | symbol | 514 | <code>#define S_TASKID "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_TASKDN` | symbol | 516 | <code>#define S_TASKDN "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_MODE` | symbol | 519 | <code>#define S_MODE   "{\"type\":\"object\",\"properties\":{\"mode\":{" \</code> |
| `S_CHECK` | symbol | 522 | <code>#define S_CHECK  "{\"type\":\"object\",\"properties\":{\"check\":{\"type\":\"boolean\"}}}"</code> |
| `S_TRACE` | symbol | 523 | <code>#define S_TRACE  "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_REMEMBER` | symbol | 525 | <code>#define S_REMEMBER "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_FEATURE` | symbol | 533 | <code>#define S_FEATURE "{\"type\":\"object\",\"properties\":{\"feature\":" \</code> |
| `S_PATHOPT` | symbol | 535 | <code>#define S_PATHOPT "{\"type\":\"object\",\"properties\":{\"path\":" \</code> |
| `S_SHOW` | symbol | 538 | <code>#define S_SHOW   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \</code> |
| `S_NAMEOPT` | symbol | 541 | <code>#define S_NAMEOPT "{\"type\":\"object\",\"properties\":{\"name\":" \</code> |
| `S_CLAIM` | symbol | 544 | <code>#define S_CLAIM  "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_ADD` | symbol | 549 | <code>#define S_ADD    "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RECALL` | symbol | 559 | <code>#define S_RECALL "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_CLAIMNEXT` | symbol | 564 | <code>#define S_CLAIMNEXT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RELEASE` | symbol | 569 | <code>#define S_RELEASE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_HANDOFF` | symbol | 575 | <code>#define S_HANDOFF "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RESUME` | symbol | 582 | <code>#define S_RESUME "{\"type\":\"object\",\"properties\":{" \</code> |
| `A_READ` | symbol | 589 | <code>#define A_READ  "{\"readOnlyHint\":true,\"destructiveHint\":false," \</code> |
| `A_WRITE` | symbol | 591 | <code>#define A_WRITE "{\"readOnlyHint\":false,\"destructiveHint\":false," \</code> |
| `A_MUTATE` | symbol | 593 | <code>#define A_MUTATE "{\"readOnlyHint\":false,\"destructiveHint\":true," \</code> |
| `NTOOLS` | symbol | 851 | <code>#define NTOOLS ((int)(sizeof TOOLS / sizeof TOOLS[0]))</code> |
| `mcp_tool_annotations` | symbol | 922 | <code>static void mcp_tool_annotations(int i, StrBuf *b) {</code> |
| `mcp_list_resources` | symbol | 928 | <code>static void mcp_list_resources(Cg *cg, StrBuf *r) {</code> |
| `mcp_list_prompts` | symbol | 969 | <code>static void mcp_list_prompts(StrBuf *r) {</code> |
| `send_line` | symbol | 983 | <code>static void send_line(StrBuf *b) {</code> |
| `reply_result` | symbol | 990 | <code>static void reply_result(const char *id, const char *result_json) {</code> |
| `reply_error` | symbol | 997 | <code>static void reply_error(const char *id, int code, const char *msg) {</code> |
| `cmd_mcp` | symbol | 1006 | <code>int cmd_mcp(Cg *cg, const SysInfo *si) {</code> |
| `self_path` | symbol | 1177 | <code>static int self_path(char *out, size_t cap) {</code> |
| `server_entry` | symbol | 1184 | <code>static char *server_entry(const char *bin, bool vscode_style) {</code> |
| `install_json` | symbol | 1195 | <code>static void install_json(const char *path, const char *root_key,</code> |
| `cmd_mcp_install` | symbol | 1243 | <code>int cmd_mcp_install(Cg *cg) {</code> |

## src/memory.c

[Open source](../src/memory.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `memory_open_quiet` | symbol | 17 | <code>bool memory_open_quiet(Cg *g) {</code> |
| `bind_opt` | symbol | 23 | <code>static void bind_opt(sqlite3_stmt *st, int i, const char *v) {</code> |
| `memory_add` | symbol | 28 | <code>long memory_add(Cg *cg, const char *type, const char *task, const char *body,</code> |
| `fts_query` | symbol | 81 | <code>static char *fts_query(const char *q) {</code> |
| `col_dup` | symbol | 101 | <code>static char *col_dup(sqlite3_stmt *st, int i) {</code> |
| `mem_row` | symbol | 106 | <code>static void mem_row(sqlite3_stmt *st, Memory *m) {</code> |
| `SUPERSEDED_RANK` | symbol | 123 | <code>#define SUPERSEDED_RANK \</code> |
| `memory_query` | symbol | 126 | <code>int memory_query(Cg *cg, const char *query, const char *task,</code> |
| `memory_clear` | symbol | 162 | <code>void memory_clear(Memory *m) {</code> |
| `memory_free` | symbol | 167 | <code>void memory_free(Memory *v, int n) {</code> |
| `memory_json` | symbol | 172 | <code>void memory_json(const Memory *m, StrBuf *b) {</code> |
| `memory_print_brief` | symbol | 188 | <code>void memory_print_brief(const Memory *m, const char *indent) {</code> |
| `cmd_remember` | symbol | 200 | <code>int cmd_remember(Cg *cg, const char *text, const char *type, const char *task,</code> |
| `cmd_recall` | symbol | 230 | <code>int cmd_recall(Cg *cg, const char *query, const char *task, const char *type,</code> |
| `cmd_forget` | symbol | 271 | <code>int cmd_forget(Cg *cg, const char *idstr) {</code> |
| `memory_supersede` | symbol | 296 | <code>int memory_supersede(Cg *cg, long old_id, long new_id) {</code> |
| `cmd_recall_near` | symbol | 319 | <code>int cmd_recall_near(Cg *cg, const char *path, int limit, bool json) {</code> |
| `cmd_memory_compact` | symbol | 360 | <code>int cmd_memory_compact(Cg *cg, bool dry_run, bool json) {</code> |

## src/orchestrate.c

[Open source](../src/orchestrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ORCH_MAX_SLOTS` | symbol | 26 | <code>#define ORCH_MAX_SLOTS 16</code> |
| `ORCH_MAX_ARGV` | symbol | 27 | <code>#define ORCH_MAX_ARGV  64</code> |
| `orch_on_signal` | symbol | 31 | <code>static void orch_on_signal(int sig) {</code> |
| `orch_raw_str` | symbol | 52 | <code>static char *orch_raw_str(const Kvx *k, const char *sec, const char *key) {</code> |
| `orch_cfg_load` | symbol | 65 | <code>static void orch_cfg_load(const Kvx *wf, OrchCfg *c) {</code> |
| `orch_cfg_free` | symbol | 79 | <code>static void orch_cfg_free(OrchCfg *c) {</code> |
| `argc` | symbol | 87 | <code>typedef struct { int argc; char **argv; bool json; } OrchSpecCall;</code> |
| `orch_call_spec` | symbol | 89 | <code>static int orch_call_spec(void *v) {</code> |
| `orch_spec` | symbol | 102 | <code>static int orch_spec(char **out, bool json, int argc, ...) {</code> |
| `g` | symbol | 112 | <code>typedef struct { Cg *g; const char *task; } OrchResumeCall;</code> |
| `orch_call_resume` | symbol | 114 | <code>static int orch_call_resume(void *v) {</code> |
| `orch_call_docs_packet` | symbol | 119 | <code>static int orch_call_docs_packet(void *v) {</code> |
| `orch_docs_ready` | symbol | 127 | <code>static bool orch_docs_ready(const char *id) {</code> |
| `split_args` | symbol | 133 | <code>static int split_args(const char *s, char **av, int n, int cap) {</code> |
| `orch_subst` | symbol | 150 | <code>static char *orch_subst(const char *tmpl, const char *promptfile,</code> |
| `orch_driver_argv` | symbol | 185 | <code>int orch_driver_argv(const char *driver, const char *extra_args,</code> |
| `orch_argv_free` | symbol | 218 | <code>static void orch_argv_free(char **av) {</code> |
| `orch_argv_print` | symbol | 222 | <code>static void orch_argv_print(char **av) {</code> |
| `orch_spec_root` | symbol | 235 | <code>static int orch_spec_root(char *out, size_t cap) {</code> |
| `orch_task_status` | symbol | 253 | <code>static char *orch_task_status(const char *specroot, const char *feature,</code> |
| `orch_abandon` | symbol | 294 | <code>static void orch_abandon(const char *specroot, const char *feature,</code> |
| `orch_note_failure` | symbol | 328 | <code>static void orch_note_failure(const char *feature, const char *id, int rc) {</code> |
| `orch_write_prompt` | symbol | 341 | <code>static int orch_write_prompt(const char *cgroot, const char *feature,</code> |
| `orch_spawn` | symbol | 375 | <code>static pid_t orch_spawn(char **av, const char *root, const char *promptfile,</code> |
| `orch_dry_run` | symbol | 411 | <code>static int orch_dry_run(const char *specroot, const char *cgroot,</code> |
| `orch_heartbeat` | symbol | 499 | <code>static int orch_heartbeat(OrchSlot *slot, long ttl_min) {</code> |
| `orch_live` | symbol | 515 | <code>static int orch_live(const OrchSlot *slots, int n) {</code> |
| `orch_reap` | symbol | 525 | <code>static int orch_reap(pid_t pid) {</code> |
| `cmd_spec_run` | symbol | 543 | <code>int cmd_spec_run(int argc, char **argv) {</code> |

## src/resolve.c

[Open source](../src/resolve.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `name` | symbol | 14 | <code>typedef struct { char *name; } ManifestDep;</code> |
| `manifest_add` | symbol | 22 | <code>static void manifest_add(Manifest *m, const char *name, size_t len) {</code> |
| `manifest_free` | symbol | 33 | <code>static void manifest_free(Manifest *m) {</code> |
| `manifest_has` | symbol | 39 | <code>static bool manifest_has(const Manifest *m, const char *module) {</code> |
| `load_package_json` | symbol | 53 | <code>static void load_package_json(const char *root, Manifest *js) {</code> |
| `load_go_mod` | symbol | 77 | <code>static void load_go_mod(const char *root, Manifest *go) {</code> |
| `load_requirements_txt` | symbol | 120 | <code>static void load_requirements_txt(const char *root, Manifest *py) {</code> |
| `load_pyproject_toml` | symbol | 148 | <code>static void load_pyproject_toml(const char *root, Manifest *py) {</code> |
| `load_cargo_toml` | symbol | 183 | <code>static void load_cargo_toml(const char *root, Manifest *rs) {</code> |
| `strip_ext` | symbol | 222 | <code>static void strip_ext(char *buf, size_t cap, const char *path) {</code> |
| `find_repo_file` | symbol | 230 | <code>static long find_repo_file(Cg *cg, const char *module, const char *from_path,</code> |
| `resolve_imports` | symbol | 376 | <code>void resolve_imports(Cg *cg) {</code> |
| `in_list` | symbol | 593 | <code>static bool in_list(const char *const *list, const char *name) {</code> |
| `c_builtin` | symbol | 600 | <code>static bool c_builtin(Cg *cg, long file_id, const char *name) {</code> |
| `is_resolving_lang` | symbol | 627 | <code>static bool is_resolving_lang(const char *lang) {</code> |
| `is_builtin` | symbol | 634 | <code>static bool is_builtin(Cg *cg, const char *lang, long file_id,</code> |
| `id` | symbol | 652 | <code>typedef struct { long id; long file_id; char path[512]; } Cand;</code> |
| `find_candidates` | symbol | 654 | <code>static int find_candidates(Cg *cg, const char *name, Cand *out, int cap) {</code> |
| `mod_matches` | symbol | 672 | <code>static bool mod_matches(const char *module, const char *cand_path) {</code> |
| `load_imports` | symbol | 711 | <code>static int load_imports(Cg *cg, long file_id, ImpCache *out, int cap) {</code> |
| `resolve_refs` | symbol | 728 | <code>void resolve_refs(Cg *cg) {</code> |
| `edit_distance` | symbol | 886 | <code>static int edit_distance(const char *a, const char *b) {</code> |
| `near_miss` | symbol | 904 | <code>static bool near_miss(Cg *cg, const char *name, char *out, size_t cap) {</code> |
| `file_calibrated` | symbol | 929 | <code>bool file_calibrated(Cg *cg, long file_id, const char *lang) {</code> |
| `ground_findings` | symbol | 988 | <code>int ground_findings(Cg *cg, const char *path, GroundFinding **out) {</code> |
| `ground_findings_free` | symbol | 1071 | <code>void ground_findings_free(GroundFinding *v, int n) {</code> |
| `kind_callable` | symbol | 1079 | <code>static bool kind_callable(const char *kind) {</code> |
| `contract_findings` | symbol | 1086 | <code>int contract_findings(Cg *cg, const char *path, ContractFinding **out) {</code> |
| `contract_findings_free` | symbol | 1154 | <code>void contract_findings_free(ContractFinding *v, int n) {</code> |
| `is_entrypoint` | symbol | 1162 | <code>bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,</code> |
| `hygiene_file` | symbol | 1211 | <code>static int hygiene_file(Cg *cg, const char *path, long file_id,</code> |
| `hygiene_findings` | symbol | 1276 | <code>int hygiene_findings(Cg *cg, const char *path, HygieneFinding **out) {</code> |
| `hygiene_findings_all` | symbol | 1291 | <code>int hygiene_findings_all(Cg *cg, HygieneFinding **out, int limit) {</code> |
| `hygiene_findings_free` | symbol | 1305 | <code>void hygiene_findings_free(HygieneFinding *v, int n) {</code> |

## src/routes.c

[Open source](../src/routes.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `NRP` | symbol | 85 | <code>#define NRP ((int)(sizeof RP / sizeof RP[0]))</code> |
| `routes_global_init` | symbol | 87 | <code>void routes_global_init(void) {</code> |
| `lang_in` | symbol | 103 | <code>static bool lang_in(const char *langs, const char *lang) {</code> |
| `upcase` | symbol | 110 | <code>static void upcase(char *s) {</code> |
| `routes_scan_line` | symbol | 114 | <code>void routes_scan_line(const char *lang, const char *path, int lineno,</code> |
| `routes_scan_file` | symbol | 153 | <code>void routes_scan_file(const char *path, ParseResult *pr) {</code> |

## src/runtime.c

[Open source](../src/runtime.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `state_git` | symbol | 20 | <code>static void state_git(const Cg *cg, GitState *s) {</code> |
| `g` | symbol | 47 | <code>typedef struct { Cg *g; bool json; } StateVcsCall;</code> |
| `state_call_vcs` | symbol | 48 | <code>static int state_call_vcs(void *v) {</code> |
| `json` | symbol | 53 | <code>typedef struct { bool json; bool reconcile; } StateSpecCall;</code> |
| `state_call_spec` | symbol | 54 | <code>static int state_call_spec(void *v) {</code> |
| `state_raw_json` | symbol | 61 | <code>static void state_raw_json(StrBuf *b, const char *raw) {</code> |
| `state_live_attempt` | symbol | 70 | <code>static bool state_live_attempt(Cg *cg, const char *agent, SpecAttempt *a,</code> |
| `cmd_state` | symbol | 99 | <code>int cmd_state(Cg *cg, bool json) {</code> |
| `runtime_key_cmp` | symbol | 170 | <code>static int runtime_key_cmp(const void *a, const void *b) {</code> |
| `runtime_json_object_valid` | symbol | 178 | <code>static bool runtime_json_object_valid(const char *payload) {</code> |
| `runtime_canonical_json` | symbol | 212 | <code>static char *runtime_canonical_json(const char *payload) {</code> |
| `runtime_first_string` | symbol | 240 | <code>static char *runtime_first_string(const char *payload,</code> |
| `runtime_first_raw` | symbol | 250 | <code>static char *runtime_first_raw(const char *payload,</code> |
| `runtime_kind` | symbol | 260 | <code>static char *runtime_kind(const char *payload) {</code> |
| `v` | symbol | 285 | <code>typedef struct { RuntimeFile *v; int n, cap; } RuntimeFiles;</code> |
| `runtime_files_push` | symbol | 287 | <code>static void runtime_files_push(RuntimeFiles *files, const char *path,</code> |
| `runtime_walk_files` | symbol | 304 | <code>static void runtime_walk_files(const char *root, const char *rel,</code> |
| `runtime_file_cmp` | symbol | 329 | <code>static int runtime_file_cmp(const void *a, const void *b) {</code> |
| `runtime_workspace_revision` | symbol | 334 | <code>void runtime_workspace_revision(Cg *cg, char out[65]) {</code> |
| `runtime_event_ingest` | symbol | 399 | <code>int runtime_event_ingest(Cg *cg, const char *source, const char *payload,</code> |
| `runtime_event_history` | symbol | 558 | <code>static int runtime_event_history(Cg *cg, int limit, bool json) {</code> |
| `runtime_contains_ci` | symbol | 622 | <code>static bool runtime_contains_ci(const char *s, const char *needle) {</code> |
| `runtime_sample_failure` | symbol | 635 | <code>static bool runtime_sample_failure(const RuntimeSample *s) {</code> |
| `runtime_sample_waiting` | symbol | 654 | <code>static bool runtime_sample_waiting(const RuntimeSample *s) {</code> |
| `runtime_threshold` | symbol | 666 | <code>static int runtime_threshold(const char *name, int dflt, int floor) {</code> |
| `runtime_classify_progress` | symbol | 676 | <code>int runtime_classify_progress(Cg *cg, const char *attempt,</code> |
| `runtime_progress_fields` | symbol | 830 | <code>static void runtime_progress_fields(StrBuf *b, const RuntimeProgress *p) {</code> |
| `runtime_progress` | symbol | 849 | <code>int runtime_progress(Cg *cg, bool json) {</code> |
| `cmd_event` | symbol | 921 | <code>int cmd_event(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/scan.c

[Open source](../src/scan.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MAX_FILE_BYTES` | symbol | 13 | <code>#define MAX_FILE_BYTES (8L * 1024 * 1024)   /* larger files: skip entirely */</code> |
| `MAX_FTS_BYTES` | symbol | 14 | <code>#define MAX_FTS_BYTES  (2L * 1024 * 1024)   /* larger: no body full-text */</code> |
| `RING_CAP` | symbol | 15 | <code>#define RING_CAP 256</code> |
| `INDEX_CHUNK` | symbol | 19 | <code>#define INDEX_CHUNK 96</code> |
| `rel` | symbol | 21 | <code>typedef struct { char *rel; long size, mtime; char dbhash[65]; } Walked;</code> |
| `path` | symbol | 22 | <code>typedef struct { char *path; long id, size, mtime; char hash[65]; } DbFile;</code> |
| `v` | symbol | 35 | <code>typedef struct { Walked *v; int n, cap; } WalkList;</code> |
| `walk_push` | symbol | 37 | <code>static void walk_push(WalkList *wl, const char *rel, long size, long mtime) {</code> |
| `walk_dir` | symbol | 49 | <code>static void walk_dir(const char *root, const char *rel, const Ignore *ig,</code> |
| `walked_cmp` | symbol | 76 | <code>static int walked_cmp(const void *a, const void *b) {</code> |
| `dbfile_cmp` | symbol | 79 | <code>static int dbfile_cmp(const void *a, const void *b) {</code> |
| `ring_push` | symbol | 98 | <code>static void ring_push(Pipe *p, Done *d) {</code> |
| `producer_done` | symbol | 109 | <code>static void producer_done(Pipe *p) {</code> |
| `ring_pop` | symbol | 116 | <code>static bool ring_pop(Pipe *p, Done *out) {</code> |
| `worker` | symbol | 132 | <code>static void *worker(void *arg) {</code> |
| `stmts_init` | symbol | 179 | <code>static void stmts_init(Cg *cg, Stmts *s) {</code> |
| `stmts_fin` | symbol | 216 | <code>static void stmts_fin(Stmts *s) {</code> |
| `step_reset` | symbol | 222 | <code>static void step_reset(sqlite3_stmt *st) {</code> |
| `purge_file_children` | symbol | 228 | <code>static void purge_file_children(Stmts *s, long file_id) {</code> |
| `write_done` | symbol | 239 | <code>static void write_done(Cg *cg, Stmts *s, const Walked *w, Done *d,</code> |
| `soft_insert` | symbol | 468 | <code>static void soft_insert(sqlite3_stmt *ins, long file_id, int line,</code> |
| `probe` | symbol | 484 | <code>static bool probe(sqlite3_stmt *st, const char *tok, char *out, size_t cap) {</code> |
| `anchor_edges` | symbol | 500 | <code>static void anchor_edges(Cg *cg, IndexStats *st) {</code> |
| `flush_chunk` | symbol | 584 | <code>static int flush_chunk(Cg *cg, Stmts *s, Walked *jobs, Done *chunk, int n,</code> |
| `cg_index` | symbol | 596 | <code>int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet) {</code> |

## src/sha256.c

[Open source](../src/sha256.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ROR` | symbol | 25 | <code>#define ROR(x,n) (((x) &gt;&gt; (n)) &#124; ((x) &lt;&lt; (32 - (n))))</code> |
| `sha_block` | symbol | 27 | <code>static void sha_block(Sha256 *s, const uint8_t *p) {</code> |
| `sha256_hex` | symbol | 52 | <code>void sha256_hex(const void *data, size_t len, char out_hex[65]) {</code> |

## src/spec.c

[Open source](../src/spec.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SPEC_BANNER_DFLT` | symbol | 27 | <code>#define SPEC_BANNER_DFLT "GENERATED by spec/specgen — DO NOT EDIT."</code> |
| `S` | symbol | 32 | <code>static char *S(const Kvx *k, const char *sec, const char *key) {</code> |
| `raw_is_list` | symbol | 37 | <code>static bool raw_is_list(const Kvx *k, const char *sec, const char *key) {</code> |
| `sb_humanize` | symbol | 45 | <code>static void sb_humanize(StrBuf *b, const char *k) {</code> |
| `count_dots` | symbol | 62 | <code>static int count_dots(const char *s) {</code> |
| `checkbox` | symbol | 68 | <code>static const char *checkbox(const char *status) {</code> |
| `uint_or` | symbol | 75 | <code>static unsigned long uint_or(const Kvx *k, const char *sec, const char *key,</code> |
| `FOR_KV` | symbol | 87 | <code>#define FOR_KV(k, secname, prefix, idx) \</code> |
| `entry_val` | symbol | 92 | <code>static char *entry_val(const Kvx *k, int i) {           /* interpolated */</code> |
| `spec_find_root` | symbol | 96 | <code>static int spec_find_root(char *out, size_t cap) {</code> |
| `read_include` | symbol | 113 | <code>static char *read_include(const char *fdir, const char *rel) {</code> |
| `writer_write` | symbol | 129 | <code>static int writer_write(Writer *w, const char *path, const char *content) {</code> |
| `build_brief` | symbol | 158 | <code>static char *build_brief(const Kvx *wf) {</code> |
| `adapter_render` | symbol | 219 | <code>static char *adapter_render(const char *label, const char *brief,</code> |
| `render_requirements` | symbol | 241 | <code>static char *render_requirements(const Kvx *f, const char *banner) {</code> |
| `render_design` | symbol | 274 | <code>static char *render_design(const Kvx *f, const char *fdir, const char *banner,</code> |
| `render_wave_graph` | symbol | 328 | <code>static void render_wave_graph(const Kvx *f, char **ids, int nids, StrBuf *b) {</code> |
| `render_tasks` | symbol | 375 | <code>static char *render_tasks(const Kvx *f, const char *fdir, const char *banner,</code> |
| `content` | symbol | 480 | <code>typedef struct { char *path, *content; } OutFile;</code> |
| `outfile_cmp` | symbol | 482 | <code>static int outfile_cmp(const void *a, const void *b) {</code> |
| `strp_cmp` | symbol | 486 | <code>static int strp_cmp(const void *a, const void *b) {</code> |
| `discover_features` | symbol | 490 | <code>static int discover_features(const char *specdir, char ***out) {</code> |
| `render_feature` | symbol | 514 | <code>static int render_feature(const char *root, const char *specdir,</code> |
| `spec_render` | symbol | 569 | <code>static int spec_render(const char *root, bool check, bool quiet) {</code> |
| `spec_render_json` | symbol | 634 | <code>static int spec_render_json(const char *root, bool check) {</code> |
| `spec_close` | symbol | 652 | <code>static void spec_close(Spec *s) {</code> |
| `spec_load` | symbol | 660 | <code>static int spec_load(Spec *s, const char *root_ov, const char *feature_ov,</code> |
| `task_sec` | symbol | 696 | <code>static void task_sec(char *buf, size_t cap, const char *id) {</code> |
| `task_exists` | symbol | 700 | <code>static bool task_exists(const Spec *s, const char *id) {</code> |
| `task_status` | symbol | 707 | <code>static char *task_status(const Spec *s, const char *id) {</code> |
| `spec_mode_is` | symbol | 713 | <code>static bool spec_mode_is(const Spec *s, const char *want) {</code> |
| `spec_prod_mode` | symbol | 721 | <code>static bool spec_prod_mode(const Spec *s) {</code> |
| `spec_parallel_mode` | symbol | 727 | <code>static bool spec_parallel_mode(const Spec *s) {</code> |
| `spec_docs_mode` | symbol | 736 | <code>static char *spec_docs_mode(const Spec *s) {</code> |
| `spec_all_tasks_qualified` | symbol | 743 | <code>static bool spec_all_tasks_qualified(const Spec *s) {</code> |
| `spec_docs_stage` | symbol | 758 | <code>static char *spec_docs_stage(const Spec *s) {</code> |
| `spec_docs_ready` | symbol | 776 | <code>static bool spec_docs_ready(const Spec *s) {</code> |
| `spec_docs_set_status` | symbol | 783 | <code>static int spec_docs_set_status(Spec *s, const char *status) {</code> |
| `json_docs_task` | symbol | 791 | <code>static void json_docs_task(StrBuf *b, const Spec *s) {</code> |
| `print_docs_task` | symbol | 806 | <code>static void print_docs_task(const Spec *s) {</code> |
| `task_is_leaf` | symbol | 818 | <code>static bool task_is_leaf(const Spec *s, const char *id) {</code> |
| `task_satisfies_requires` | symbol | 825 | <code>static bool task_satisfies_requires(const Spec *s, const char *id) {</code> |
| `task_unmet` | symbol | 834 | <code>static int task_unmet(const Spec *s, const char *id, char **unmet, int cap) {</code> |
| `task_eligible` | symbol | 850 | <code>static bool task_eligible(const Spec *s, const char *id) {</code> |
| `spec_next_id` | symbol | 864 | <code>static const char *spec_next_id(const Spec *s) {</code> |
| `clause_text` | symbol | 878 | <code>static char *clause_text(const Spec *s, const char *clause) {</code> |
| `print_task` | symbol | 897 | <code>static void print_task(const Spec *s, const char *id) {</code> |
| `json_task` | symbol | 955 | <code>static void json_task(const Spec *s, const char *id, StrBuf *b) {</code> |
| `spec_current` | symbol | 1023 | <code>static const char *spec_current(const Spec *s) {</code> |
| `spec_in_progress_count` | symbol | 1033 | <code>static int spec_in_progress_count(const Spec *s) {</code> |
| `spec_attempt_sweep` | symbol | 1050 | <code>static void spec_attempt_sweep(Cg *g) {</code> |
| `spec_attempt_next_fence` | symbol | 1064 | <code>static long spec_attempt_next_fence(Cg *g) {</code> |
| `spec_attempt_host` | symbol | 1074 | <code>static const char *spec_attempt_host(const char *host, char buf[256]) {</code> |
| `spec_attempt_session` | symbol | 1085 | <code>static const char *spec_attempt_session(const char *session) {</code> |
| `spec_attempt_begin` | symbol | 1093 | <code>static int spec_attempt_begin(Cg *g, const char *tag, const char *agent,</code> |
| `spec_attempt_heartbeat` | symbol | 1138 | <code>static int spec_attempt_heartbeat(Cg *g, const char *tag, const char *agent,</code> |
| `spec_attempt_finish` | symbol | 1178 | <code>static void spec_attempt_finish(Cg *g, const char *tag, const char *state,</code> |
| `spec_attempt_owned` | symbol | 1190 | <code>static bool spec_attempt_owned(Cg *g, const char *tag, const char *agent,</code> |
| `spec_require_owner` | symbol | 1212 | <code>static int spec_require_owner(Spec *s, const char *id, const char *agent,</code> |
| `spec_set_status_owned` | symbol | 1245 | <code>static int spec_set_status_owned(Spec *s, const char *id, const char *status,</code> |
| `spec_agent_leased` | symbol | 1287 | <code>static const char *spec_agent_leased(const Spec *s, const char *agent) {</code> |
| `spec_current_for_agent` | symbol | 1318 | <code>static const char *spec_current_for_agent(const Spec *s, const char *agent) {</code> |
| `spec_stale_tasks` | symbol | 1328 | <code>static int spec_stale_tasks(const Spec *s, const char ***out) {</code> |
| `join_list` | symbol | 1367 | <code>static char *join_list(const Kvx *k, const char *sec, const char *key) {</code> |
| `spec_note_outcome` | symbol | 1382 | <code>static void spec_note_outcome(Spec *s, const char *id, const char *body) {</code> |
| `spec_task_memories` | symbol | 1397 | <code>static int spec_task_memories(Spec *s, const char *id, Memory **out) {</code> |
| `spec_print_memories` | symbol | 1426 | <code>static void spec_print_memories(Spec *s, const char *id) {</code> |
| `spec_status_cmd` | symbol | 1438 | <code>static int spec_status_cmd(Spec *s, bool json) {</code> |
| `spec_mode_cmd` | symbol | 1569 | <code>static int spec_mode_cmd(Spec *s, const char *mode, bool json) {</code> |
| `spec_next_cmd` | symbol | 1595 | <code>static int spec_next_cmd(Spec *s, bool json) {</code> |
| `spec_docs_verified` | symbol | 1650 | <code>static bool spec_docs_verified(const Spec *s) {</code> |
| `spec_docs_finish` | symbol | 1661 | <code>int spec_docs_finish(Cg *cg, const char *feature) {</code> |
| `spec_docs_cmd` | symbol | 1672 | <code>static int spec_docs_cmd(Spec *s, const char *action, const char *agent,</code> |
| `spec_globs_overlap` | symbol | 1817 | <code>bool spec_globs_overlap(const char *a, const char *b) {</code> |
| `spec_touches_conflict` | symbol | 1832 | <code>static bool spec_touches_conflict(Spec *s, const char *id, char *other,</code> |
| `spec_live_leases` | symbol | 1914 | <code>static int spec_live_leases(const Spec *s, StrBuf *b, bool json) {</code> |
| `spec_wave_cmd` | symbol | 1957 | <code>static int spec_wave_cmd(Spec *s, bool json) {</code> |
| `spec_lease_upsert` | symbol | 2015 | <code>static int spec_lease_upsert(Cg *g, const char *tag, const char *agent,</code> |
| `spec_release_lease` | symbol | 2043 | <code>static void spec_release_lease(Spec *s, const char *id) {</code> |
| `spec_heartbeat_cmd` | symbol | 2063 | <code>static int spec_heartbeat_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_reconcile_cmd` | symbol | 2134 | <code>static int spec_reconcile_cmd(Spec *s, bool repair, bool json) {</code> |
| `spec_claim_cmd` | symbol | 2182 | <code>static int spec_claim_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_ready_cmd` | symbol | 2331 | <code>static int spec_ready_cmd(Spec *s, bool json) {</code> |
| `spec_claim_next_cmd` | symbol | 2431 | <code>static int spec_claim_next_cmd(Spec *s, const char *agent, const char *host,</code> |
| `spec_start_cmd` | symbol | 2605 | <code>static int spec_start_cmd(Spec *s, const char *id, bool force, bool json) {</code> |
| `spec_implemented_cmd` | symbol | 2698 | <code>static int spec_implemented_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_done_cmd` | symbol | 2788 | <code>static int spec_done_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_graph_open` | symbol | 2936 | <code>static bool spec_graph_open(Cg *g) {</code> |
| `graph_symbol_row` | symbol | 2950 | <code>static void graph_symbol_row(sqlite3_stmt *st, char *path, size_t pcap,</code> |
| `path_has_qualifier` | symbol | 2961 | <code>static bool path_has_qualifier(const char *path, const char *segment,</code> |
| `qualified_path_score` | symbol | 2984 | <code>static int qualified_path_score(const char *qualified, const char *path) {</code> |
| `graph_symbol_named` | symbol | 3000 | <code>static int graph_symbol_named(Cg *g, const char *lookup,</code> |
| `graph_symbol` | symbol | 3036 | <code>static int graph_symbol(Cg *g, const char *name, char *path, size_t pcap,</code> |
| `task_tag` | symbol | 3048 | <code>static void task_tag(const Spec *s, const char *id, char *out, size_t cap) {</code> |
| `pattern_hit` | symbol | 3058 | <code>static bool pattern_hit(const char *pat, char **paths, int np) {</code> |
| `spec_verify_task` | symbol | 3077 | <code>static int spec_verify_task(Spec *s, const char *id) {</code> |
| `trace_task` | symbol | 3132 | <code>static void trace_task(Spec *s, Cg *g, bool have_graph, const char *id,</code> |
| `spec_trace_cmd` | symbol | 3265 | <code>static int spec_trace_cmd(Spec *s, const char *id, bool json) {</code> |
| `spec_new_cmd` | symbol | 3407 | <code>static int spec_new_cmd(const char *root_ov, const char *feature, bool json) {</code> |
| `list_literal` | symbol | 3478 | <code>static char *list_literal(const char *csv) {</code> |
| `spec_add_cmd` | symbol | 3510 | <code>static int spec_add_cmd(Spec *s, const char *id, const TaskSpec *t,</code> |
| `b` | symbol | 3587 | <code>typedef struct { StrBuf b; int errors, warnings; } Lint;</code> |
| `lint_say` | symbol | 3589 | <code>static void lint_say(Lint *l, bool error, const char *id, const char *fmt, ...) {</code> |
| `lint_cycle` | symbol | 3601 | <code>static bool lint_cycle(Spec *s, const char *id, char **stack, int depth,</code> |
| `spec_lint_cmd` | symbol | 3633 | <code>static int spec_lint_cmd(Spec *s, bool json) {</code> |
| `spec_active_touches` | symbol | 3750 | <code>int spec_active_touches(char ***out) {</code> |
| `spec_active_tag` | symbol | 3763 | <code>char *spec_active_tag(void) {</code> |
| `spec_task_tag` | symbol | 3783 | <code>char *spec_task_tag(const char *requested) {</code> |
| `spec_resolve_task` | symbol | 3818 | <code>char *spec_resolve_task(const char *requested, const char *agent) {</code> |
| `spec_task_packet` | symbol | 3852 | <code>char *spec_task_packet(const char *requested) {</code> |
| `spec_task_memories_tag` | symbol | 3872 | <code>int spec_task_memories_tag(const char *requested, Memory **out) {</code> |
| `cmd_spec` | symbol | 3889 | <code>int cmd_spec(int argc, char **argv, bool json) {</code> |

## src/sysinfo.c

[Open source](../src/sysinfo.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `slurp` | symbol | 11 | <code>static char *slurp(const char *path) {</code> |
| `cgroup_cpu_quota` | symbol | 16 | <code>static double cgroup_cpu_quota(void) {</code> |
| `cgroup_mem_avail_kb` | symbol | 39 | <code>static long cgroup_mem_avail_kb(long *limit_kb_out) {</code> |
| `proc_meminfo` | symbol | 63 | <code>static void proc_meminfo(long *total_kb, long *avail_kb) {</code> |
| `sysinfo_detect` | symbol | 74 | <code>void sysinfo_detect(SysInfo *si) {</code> |

## src/util.c

[Open source](../src/util.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `path_format` | symbol | 5 | <code>bool path_format(char *out, size_t cap, const char *fmt, ...) {</code> |
| `xmalloc` | symbol | 23 | <code>void *xmalloc(size_t n) {</code> |
| `xrealloc` | symbol | 28 | <code>void *xrealloc(void *p, size_t n) {</code> |
| `xstrdup` | symbol | 33 | <code>char *xstrdup(const char *s) {</code> |
| `sb_init` | symbol | 40 | <code>void sb_init(StrBuf *b) { b-&gt;p = xmalloc(256); b-&gt;p[0] = 0; b-&gt;len = 0; b-&gt;cap = 256; }</code> |
| `sb_free` | symbol | 41 | <code>void sb_free(StrBuf *b) { free(b-&gt;p); b-&gt;p = NULL; b-&gt;len = b-&gt;cap = 0; }</code> |
| `sb_grow` | symbol | 42 | <code>static void sb_grow(StrBuf *b, size_t need) {</code> |
| `sb_putc` | symbol | 47 | <code>void sb_putc(StrBuf *b, char c) { sb_grow(b, 1); b-&gt;p[b-&gt;len++] = c; b-&gt;p[b-&gt;len] = 0; }</code> |
| `sb_puts` | symbol | 48 | <code>void sb_puts(StrBuf *b, const char *s) {</code> |
| `sb_printf` | symbol | 54 | <code>void sb_printf(StrBuf *b, const char *fmt, ...) {</code> |
| `sb_json_str` | symbol | 67 | <code>void sb_json_str(StrBuf *b, const char *s) {</code> |
| `read_entire_file` | symbol | 84 | <code>char *read_entire_file(const char *path, size_t *out_len) {</code> |
| `hash_lines` | symbol | 113 | <code>void hash_lines(const char *data, size_t len, int from, int to,</code> |
| `write_entire_file` | symbol | 130 | <code>int write_entire_file(const char *path, const void *data, size_t len) {</code> |
| `mkdirs` | symbol | 154 | <code>int mkdirs(const char *path) {</code> |
| `cg_capture` | symbol | 169 | <code>int cg_capture(char **out, int (*fn)(void *), void *ctx) {</code> |
| `now_ms` | symbol | 194 | <code>long now_ms(void) {</code> |
| `looks_binary` | symbol | 200 | <code>bool looks_binary(const char *data, size_t len) {</code> |
| `path_ext` | symbol | 207 | <code>const char *path_ext(const char *path) {</code> |
| `cg_agent_name` | symbol | 217 | <code>const char *cg_agent_name(const char *flag) {</code> |
| `ig_add_flags` | symbol | 239 | <code>static void ig_add_flags(Ignore *ig, const char *pat, bool negate,</code> |
| `ig_add` | symbol | 253 | <code>static void ig_add(Ignore *ig, const char *pat) {</code> |
| `ig_load_file` | symbol | 261 | <code>static void ig_load_file(Ignore *ig, const char *path) {</code> |
| `ig_load_nested` | symbol | 291 | <code>static void ig_load_nested(Ignore *ig, const char *root, const char *reldir) {</code> |
| `ig_walk_gitignores` | symbol | 320 | <code>static void ig_walk_gitignores(Ignore *ig, const char *root,</code> |
| `ignore_load` | symbol | 344 | <code>void ignore_load(Ignore *ig, const char *root) {</code> |
| `pat_match` | symbol | 357 | <code>static bool pat_match(const char *pat, const char *text, bool anchored) {</code> |
| `ig_entry_hits` | symbol | 362 | <code>static bool ig_entry_hits(const IgnorePat *e, const char *rel,</code> |
| `ignore_match` | symbol | 385 | <code>bool ignore_match(const Ignore *ig, const char *rel, bool is_dir) {</code> |
| `ignore_free` | symbol | 410 | <code>void ignore_free(Ignore *ig) {</code> |

## src/vcs.c

[Open source](../src/vcs.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `obj_path` | symbol | 17 | <code>static void obj_path(const Cg *cg, const char *hash, char *out, size_t cap) {</code> |
| `obj_write` | symbol | 21 | <code>static int obj_write(const Cg *cg, const void *data, size_t len, char hash[65]) {</code> |
| `obj_read` | symbol | 33 | <code>static char *obj_read(const Cg *cg, const char *hash, size_t *len) {</code> |
| `head_read` | symbol | 39 | <code>static int head_read(const Cg *cg, char hash[65]) {</code> |
| `head_write` | symbol | 49 | <code>static void head_write(const Cg *cg, const char *hash) {</code> |
| `resolve_commit` | symbol | 56 | <code>static int resolve_commit(const Cg *cg, const char *ref, char out[65]) {</code> |
| `v` | symbol | 85 | <code>typedef struct { MEnt *v; int n, cap; } Manifest;</code> |
| `man_push` | symbol | 87 | <code>static void man_push(Manifest *m, const char *hash, long size, const char *path) {</code> |
| `man_free` | symbol | 98 | <code>static void man_free(Manifest *m) {</code> |
| `ment_cmp` | symbol | 104 | <code>static int ment_cmp(const void *a, const void *b) {</code> |
| `snapshot_tree` | symbol | 109 | <code>static void snapshot_tree(const Cg *cg, Manifest *m, bool store) {</code> |
| `man_serialize` | symbol | 158 | <code>static char *man_serialize(const Manifest *m, size_t *len) {</code> |
| `man_load` | symbol | 166 | <code>static int man_load(const Cg *cg, const char *tree_hash, Manifest *m) {</code> |
| `commit_load` | symbol | 192 | <code>static int commit_load(const Cg *cg, const char *hash, Commit *c) {</code> |
| `cmd_commit_with_options` | symbol | 208 | <code>int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,</code> |
| `cmd_commit` | symbol | 277 | <code>int cmd_commit(Cg *cg, const char *msg, bool quiet) {</code> |
| `cmd_log` | symbol | 281 | <code>int cmd_log(Cg *cg, int limit, bool json) {</code> |
| `deleted` | symbol | 322 | <code>typedef struct { StrBuf added, modified, deleted; int na, nm, nd;</code> |
| `tree_status` | symbol | 325 | <code>static void tree_status(Cg *cg, TreeDiff *td, bool json) {</code> |
| `cmd_status` | symbol | 380 | <code>int cmd_status(Cg *cg, bool json) {</code> |
| `CHANGES_SYM_CAP` | symbol | 411 | <code>#define CHANGES_SYM_CAP 40</code> |
| `CHANGES_CAL_CAP` | symbol | 412 | <code>#define CHANGES_CAL_CAP 8</code> |
| `cmd_changes` | symbol | 414 | <code>int cmd_changes(Cg *cg, int limit, bool json) {</code> |
| `s` | symbol | 523 | <code>typedef struct { const char *s; size_t n; unsigned long h; } DLine;</code> |
| `split_dlines` | symbol | 525 | <code>static int split_dlines(char *data, size_t len, DLine **out) {</code> |
| `dl_eq` | symbol | 544 | <code>static bool dl_eq(const DLine *a, const DLine *b) {</code> |
| `emit_line` | symbol | 548 | <code>static void emit_line(StrBuf *b, char mark, const DLine *l) {</code> |
| `diff_blobs` | symbol | 557 | <code>static void diff_blobs(StrBuf *b, char *ad, size_t al, char *bd, size_t bl) {</code> |
| `cmd_diff` | symbol | 630 | <code>int cmd_diff(Cg *cg, const char *ra, const char *rb) {</code> |
| `has_def` | symbol | 707 | <code>static bool has_def(const ParseResult *pr, const char *name, const char *kind) {</code> |
| `has_route` | symbol | 715 | <code>static bool has_route(const ParseResult *pr, const RouteDef *r) {</code> |
| `count_lines` | symbol | 723 | <code>static long count_lines(const char *d, size_t n) {</code> |
| `cmp_u64` | symbol | 731 | <code>static int cmp_u64(const void *a, const void *b) {</code> |
| `line_hashes` | symbol | 736 | <code>static uint64_t *line_hashes(const char *d, size_t n, long *count) {</code> |
| `line_delta` | symbol | 758 | <code>static void line_delta(const char *od, size_t ol, const char *nd, size_t nl,</code> |
| `changelog_file` | symbol | 775 | <code>static void changelog_file(Cg *cg, StrBuf *md, const char *path,</code> |
| `cmd_changelog` | symbol | 835 | <code>int cmd_changelog(Cg *cg, int limit, const char *outfile) {</code> |
| `cmd_checkout` | symbol | 985 | <code>int cmd_checkout(Cg *cg, const char *id, bool force) {</code> |
| `v` | symbol | 1058 | <code>typedef struct { char **v; int n, cap; } PathSet;</code> |
| `ps_add` | symbol | 1060 | <code>static void ps_add(PathSet *p, const char *path) {</code> |
| `man_diff_paths` | symbol | 1071 | <code>static void man_diff_paths(const Manifest *a, const Manifest *b, PathSet *p) {</code> |
| `vcs_commits_for_path` | symbol | 1088 | <code>int vcs_commits_for_path(Cg *cg, const char *path, int limit, char ***ids,</code> |
| `vcs_find_commits` | symbol | 1139 | <code>int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,</code> |
| `vcs_changed_paths` | symbol | 1170 | <code>int vcs_changed_paths(Cg *cg, const char *needle, char ***out) {</code> |

## src/watch.c

[Open source](../src/watch.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `wd` | symbol | 18 | <code>typedef struct { int wd; char *rel; } Watch;</code> |
| `IN_MASK` | symbol | 27 | <code>#define IN_MASK (IN_CREATE &#124; IN_CLOSE_WRITE &#124; IN_DELETE &#124; IN_MOVED_FROM &#124; \</code> |
| `watch_add_dir` | symbol | 30 | <code>static void watch_add_dir(Watcher *w, const char *rel) {</code> |
| `wd_rel` | symbol | 64 | <code>static const char *wd_rel(Watcher *w, int wd) {</code> |
| `cmd_watch` | symbol | 70 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
| `cmd_watch` | symbol | 149 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
