# Source reference

This is a source-navigation companion to the [architecture guide](ARCHITECTURE.md) and [contributor guide](../CONTRIBUTING.md), generated from Codify's own documentation evidence packet. It records indexed symbols, not promises that every symbol is public or stable. Static helpers, shared declarations, and JavaScript implementation details are included because the baseline coverage heuristic includes them.

The baseline contains 2658 observations in 55 files. Source links and line numbers refer to the checkout used for this documentation pass; rerun the workflow after implementation changes. The declaration column quotes the source line at the indexed location and may be only the first line of a multiline declaration. It is not an inferred behavioral contract.

For tests, deliberately invalid examples, and sample web routes, see the separate [test and fixture reference](TEST-REFERENCE.md). Go files under `kvx/impl/go/` are vendored reference tooling; the shipped `cg` build uses the C sources selected by the [Makefile](../Makefile).

## editors/vscode/acp.js

[Open source](../editors/vscode/acp.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AcpClient` | function | 29 | <code>function AcpClient(opts) {</code> |
| `extensionVersion` | function | 222 | <code>function extensionVersion() {</code> |
| `splitCommand` | function | 227 | <code>function splitCommand(s) {</code> |
| `normalizeCodexAdapterCommand` | function | 241 | <code>function normalizeCodexAdapterCommand(value) {</code> |
| `loadCaps` | function | 271 | <code>async function loadCaps() {</code> |
| `config` | function | 282 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `firstLine` | function | 284 | <code>function firstLine(s) {</code> |
| `driverId` | function | 289 | <code>function driverId(v) { return DRIVER_IDS.indexOf(v) &gt;= 0 ? v : 'codex'; }</code> |
| `diffStyle` | function | 293 | <code>function diffStyle() {</code> |
| `adapterCatalog` | function | 301 | <code>function adapterCatalog() {</code> |
| `custom` | function | 302 | <code>const custom = (config().get('acp.customCommand') &#124;&#124; '').trim();</code> |
| `adapterMap` | function | 313 | <code>function adapterMap() {</code> |
| `adapterCommand` | function | 324 | <code>function adapterCommand(override) {</code> |
| `custom` | function | 325 | <code>const custom = (config().get('acp.customCommand') &#124;&#124; '').trim();</code> |
| `rememberViewDriver` | function | 342 | <code>function rememberViewDriver(value) {</code> |
| `classifyUserText` | function | 355 | <code>function classifyUserText(raw) {</code> |
| `args` | function | 362 | <code>const args = (cmd[2] &#124;&#124; '').trim();</code> |
| `sessionTitle` | function | 373 | <code>function sessionTitle(raw) {</code> |
| `sessionRecord` | function | 389 | <code>function sessionRecord(row, driver) {</code> |
| `mergeSessionHistory` | function | 400 | <code>function mergeSessionHistory(rows, driver) {</code> |
| `rememberSession` | function | 417 | <code>function rememberSession(sess, extra) {</code> |
| `mcpServers` | function | 428 | <code>function mcpServers() {</code> |
| `workspacePath` | function | 436 | <code>function workspacePath(root, p) {</code> |
| `readTextFile` | function | 447 | <code>function readTextFile(root, params) {</code> |
| `writeTextFile` | function | 459 | <code>function writeTextFile(root, params) {</code> |
| `taskStatus` | function | 466 | <code>async function taskStatus(id) {</code> |
| `taskRow` | function | 476 | <code>async function taskRow(id) {</code> |
| `resumePrompt` | function | 487 | <code>async function resumePrompt(id) {</code> |
| `panelPost` | function | 507 | <code>function panelPost(sess, msg) {</code> |
| `panelHtml` | function | 511 | <code>function panelHtml(webview) {</code> |
| `sendPrompt` | function | 523 | <code>function sendPrompt(sess, text, echo) {</code> |
| `stopReason` | function | 544 | <code>const stopReason = (res &amp;&amp; res.stopReason) &#124;&#124; 'end_turn';</code> |
| `cancelTurn` | function | 570 | <code>function cancelTurn(sess) {</code> |
| `sessionRequest` | function | 578 | <code>function sessionRequest(sess, method, params) {</code> |
| `renderableToolCall` | function | 601 | <code>function renderableToolCall(call) {</code> |
| `sessionUpdate` | function | 627 | <code>function sessionUpdate(sess, params) {</code> |
| `u` | function | 628 | <code>const u = (params &amp;&amp; params.update) &#124;&#124; {};</code> |
| `endOfSession` | function | 692 | <code>async function endOfSession(sess, why) {</code> |
| `connectAgent` | function | 729 | <code>async function connectAgent(sess, driverOverride) {</code> |
| `publishConnectedSession` | function | 764 | <code>function publishConnectedSession(sess, res) {</code> |
| `connectSession` | function | 786 | <code>async function connectSession(sess, driverOverride) {</code> |
| `connectFailureHint` | function | 797 | <code>function connectFailureHint(sess, e) {</code> |
| `surfacePost` | function | 806 | <code>function surfacePost(sess, msg) {</code> |
| `openLocation` | function | 812 | <code>async function openLocation(p, line) {</code> |
| `openExternal` | function | 837 | <code>async function openExternal(href) {</code> |
| `boardInfo` | function | 881 | <code>async function boardInfo() {</code> |
| `runCgSlash` | function | 889 | <code>async function runCgSlash(sess, cmd, args, send) {</code> |
| `out` | function | 900 | <code>const out = ((r.stdout &#124;&#124; '') + (r.code === 0 ? '' : '\n' + (r.stderr &#124;&#124; ''))).trim();</code> |
| `ask` | function | 908 | <code>const ask = (spec.zero &amp;&amp; args) ? args : spec.ask;</code> |
| `runToolSlash` | function | 916 | <code>async function runToolSlash(sess, name, args, send) {</code> |
| `out` | function | 920 | <code>let out = (r.stdout &#124;&#124; '').trim();</code> |
| `attachAgent` | function | 937 | <code>async function attachAgent(sess, name) {</code> |
| `agent` | function | 938 | <code>let agent = (name &#124;&#124; '').trim();</code> |
| `live` | function | 940 | <code>const live = ((status &amp;&amp; status.agents) &#124;&#124; []).filter((a) =&gt; a &amp;&amp; a.agent);</code> |
| `rows` | function | 956 | <code>const rows = (back.stdout &#124;&#124; '').split('\n').filter(Boolean)</code> |
| `agentEventOf` | function | 978 | <code>function agentEventOf(e, agent) {</code> |
| `postAgentEvent` | function | 983 | <code>function postAgentEvent(sess, e) {</code> |
| `detachAgent` | function | 999 | <code>function detachAgent(sess, quiet) {</code> |
| `steerAgent` | function | 1007 | <code>async function steerAgent(sess, agent, text) {</code> |
| `listApprovals` | function | 1015 | <code>async function listApprovals(sess) {</code> |
| `rows` | function | 1017 | <code>const rows = (j &amp;&amp; j.approvals) &#124;&#124; [];</code> |
| `decideApproval` | function | 1023 | <code>async function decideApproval(sess, id, reject, note) {</code> |
| `watchFleetEvents` | function | 1035 | <code>function watchFleetEvents() {</code> |
| `attachTask` | function | 1052 | <code>async function attachTask(sess, id) {</code> |
| `taskLifecycle` | function | 1083 | <code>async function taskLifecycle(sess, verb, send) {</code> |
| `out` | function | 1094 | <code>const out = ((r.stdout &#124;&#124; '') + (r.code === 0 ? '' : '\n' + (r.stderr &#124;&#124; ''))).trim();</code> |
| `pickTaskId` | function | 1108 | <code>async function pickTaskId(placeHolder) {</code> |
| `items` | function | 1110 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `handleSessionMessage` | function | 1125 | <code>function handleSessionMessage(sess, msg) {</code> |
| `retryLast` | function | 1207 | <code>function retryLast(sess) {</code> |
| `showSessions` | function | 1225 | <code>async function showSessions(sess) {</code> |
| `switchSession` | function | 1234 | <code>async function switchSession(sess, sessionId, driver) {</code> |
| `sessionSlash` | function | 1247 | <code>async function sessionSlash(sess, cmd, args) {</code> |
| `newSession` | function | 1338 | <code>function newSession(webview, extra) {</code> |
| `openAgentPanel` | function | 1358 | <code>async function openAgentPanel(id, agent, promptText, claimed) {</code> |
| `startPanelSession` | function | 1410 | <code>async function startPanelSession(id) {</code> |
| `currentDriver` | function | 1449 | <code>function currentDriver() {</code> |
| `postView` | function | 1453 | <code>function postView(msg) {</code> |
| `viewIdle` | function | 1459 | <code>function viewIdle() { return !viewSession; }</code> |
| `focusView` | function | 1462 | <code>async function focusView() {</code> |
| `agentCapabilities` | function | 1472 | <code>function agentCapabilities(sess) {</code> |
| `listPastSessions` | function | 1479 | <code>async function listPastSessions(quiet) {</code> |
| `restorePastSession` | function | 1532 | <code>async function restorePastSession(sessionId, driver) {</code> |
| `startChatSession` | function | 1583 | <code>async function startChatSession(firstText, taskOpts, echo) {</code> |
| `startTaskInView` | function | 1620 | <code>async function startTaskInView(id) {</code> |
| `resetViewSession` | function | 1654 | <code>async function resetViewSession() {</code> |
| `postViewInit` | function | 1669 | <code>async function postViewInit() {</code> |
| `idleSlash` | function | 1695 | <code>async function idleSlash(cmd, args) {</code> |
| `chooseDriver` | function | 1742 | <code>async function chooseDriver(value) {</code> |
| `cmdConfigure` | function | 1764 | <code>async function cmdConfigure() {</code> |
| `registerAgentView` | function | 1802 | <code>function registerAgentView(ctx) {</code> |
| `resolveWebviewView` | method | 1804 | <code>resolveWebviewView(view) {</code> |
| `cmdOpenPanel` | function | 1856 | <code>async function cmdOpenPanel(arg) {</code> |
| `items` | function | 1860 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `cmdNewChat` | function | 1896 | <code>async function cmdNewChat() {</code> |
| `registerAcpCommands` | function | 1900 | <code>function registerAcpCommands(ctx) {</code> |
| `register` | function | 1911 | <code>function register(ctx, d) {</code> |

## editors/vscode/agents.js

[Open source](../editors/vscode/agents.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `config` | function | 32 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `firstLine` | function | 34 | <code>function firstLine(s) {</code> |
| `driverName` | function | 38 | <code>function driverName() {</code> |
| `driverBits` | function | 42 | <code>function driverBits() {</code> |
| `driverLaunch` | function | 54 | <code>function driverLaunch(promptfile) {</code> |
| `headlessLaunch` | function | 61 | <code>function headlessLaunch(promptfile) {</code> |
| `ensurePolling` | function | 71 | <code>function ensurePolling() {</code> |
| `stopPollingIfIdle` | function | 79 | <code>function stopPollingIfIdle() {</code> |
| `specMode` | function | 88 | <code>async function specMode() {</code> |
| `taskStatus` | function | 93 | <code>async function taskStatus(id) {</code> |
| `liveClaim` | function | 103 | <code>async function liveClaim(id) {</code> |
| `pickTask` | function | 108 | <code>async function pickTask(filter, placeHolder) {</code> |
| `items` | function | 110 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `taskIdFrom` | function | 122 | <code>function taskIdFrom(arg) {</code> |
| `promptFileFor` | function | 130 | <code>async function promptFileFor(id) {</code> |
| `offerRelease` | function | 165 | <code>async function offerRelease(id, agent, exitCode) {</code> |
| `openTerminal` | function | 187 | <code>function openTerminal(id, agent, promptfile) {</code> |
| `runHeadless` | function | 198 | <code>function runHeadless(id, agent, promptfile) {</code> |
| `startAgentSession` | function | 220 | <code>async function startAgentSession(id, headless) {</code> |
| `cmdStartOnTask` | function | 266 | <code>async function cmdStartOnTask(arg) {</code> |
| `cmdStartHeadless` | function | 280 | <code>async function cmdStartHeadless(arg) {</code> |
| `cmdHandoff` | function | 287 | <code>async function cmdHandoff(arg) {</code> |
| `cmdResume` | function | 314 | <code>async function cmdResume(arg) {</code> |
| `cmdRunWave` | function | 335 | <code>async function cmdRunWave() {</code> |
| `cmdStop` | function | 348 | <code>async function cmdStop(arg) {</code> |
| `registerAgentCommands` | function | 379 | <code>function registerAgentCommands(ctx) {</code> |
| `register` | function | 393 | <code>function register(ctx, d) {</code> |
| `stripAnsi` | function | 461 | <code>function stripAnsi(text) {</code> |
| `diffLines` | function | 472 | <code>function diffLines(text) {</code> |
| `lcsRows` | function | 481 | <code>function lcsRows(a, b) {</code> |
| `trimContext` | function | 506 | <code>function trimContext(rows) {</code> |
| `diffRows` | function | 529 | <code>function diffRows(oldText, newText, maxRows) {</code> |
| `AgentPanel` | class | 564 | <code>class AgentPanel {</code> |
| `constructor` | method | 565 | <code>constructor(post) {</code> |
| `remember` | method | 576 | <code>remember(text, echo) {</code> |
| `retryTarget` | method | 580 | <code>retryTarget() { return this.last; }</code> |
| `beginTurn` | method | 582 | <code>beginTurn() {</code> |
| `endTurn` | method | 589 | <code>endTurn(stopReason) {</code> |
| `recordUsage` | method | 612 | <code>recordUsage(u) {</code> |
| `ask` | method | 645 | <code>ask(params) {</code> |
| `answer` | method | 668 | <code>answer(pid, optionId) {</code> |
| `settle` | method | 679 | <code>settle(why) {</code> |
| `pending` | method | 690 | <code>pending() { return this.permits.size; }</code> |
| `round6` | function | 693 | <code>function round6(n) {</code> |
| `ChatCapabilities` | class | 705 | <code>class ChatCapabilities {</code> |
| `constructor` | method | 706 | <code>constructor(tools) {</code> |
| `fromListJson` | method | 713 | <code>static fromListJson(text) {</code> |
| `has` | method | 717 | <code>has(name) { return this.tools.has(name); }</code> |
| `commands` | method | 720 | <code>commands() {</code> |
| `props` | function | 723 | <code>const props = (t.inputSchema &amp;&amp; t.inputSchema.properties) &#124;&#124; {};</code> |
| `args` | method | 735 | <code>args(name, text) {</code> |
| `props` | function | 737 | <code>const props = (t &amp;&amp; t.inputSchema &amp;&amp; t.inputSchema.properties) &#124;&#124; {};</code> |
| `req` | function | 738 | <code>const req = (t &amp;&amp; t.inputSchema &amp;&amp; t.inputSchema.required) &#124;&#124; [];</code> |
| `typed` | method | 752 | <code>static typed(schema, v) {</code> |
| `t` | function | 753 | <code>const t = (schema &amp;&amp; schema.type) &#124;&#124; 'string';</code> |
| `approvalCard` | function | 763 | <code>function approvalCard(ev) {</code> |
| `p` | function | 764 | <code>const p = (ev &amp;&amp; ev.payload) &#124;&#124; {};</code> |
| `Window` | class | 784 | <code>class Window {</code> |
| `constructor` | method | 785 | <code>constructor(keep, page) {</code> |
| `push` | method | 792 | <code>push(item) {</code> |
| `expand` | method | 805 | <code>expand() {</code> |

## editors/vscode/client.js

[Open source](../editors/vscode/client.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LspClient` | class | 14 | <code>class LspClient {</code> |
| `constructor` | method | 15 | <code>constructor(bin, cwd, log) {</code> |
| `start` | method | 29 | <code>async start() {</code> |
| `dispose` | method | 72 | <code>dispose() {</code> |
| `onNotification` | method | 82 | <code>onNotification(method, fn) { this.handlers.set(method, fn); }</code> |
| `notify` | method | 101 | <code>notify(method, params) {</code> |
| `tryRequest` | method | 107 | <code>async tryRequest(method, params, fallback) {</code> |
| `_send` | method | 118 | <code>_send(msg) {</code> |
| `_consume` | method | 130 | <code>_consume(chunk) {</code> |
| `_dispatch` | method | 149 | <code>_dispatch(msg) {</code> |
| `uriOf` | function | 169 | <code>function uriOf(fsPath) {</code> |

## editors/vscode/extension.js

[Open source](../editors/vscode/extension.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `revalidate` | function | 42 | <code>let revalidate = () =&gt; {};</code> |
| `serveConnected` | function | 55 | <code>function serveConnected() { return !!(serveClient &amp;&amp; serveClient.ready); }</code> |
| `config` | function | 69 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `binary` | function | 70 | <code>function binary() { return config().get('binaryPath') &#124;&#124; 'cg'; }</code> |
| `workspaceRoot` | function | 72 | <code>function workspaceRoot() {</code> |
| `cg` | function | 80 | <code>function cg(args) {</code> |
| `cgJson` | function | 96 | <code>async function cgJson(args) {</code> |
| `MemoryProvider` | class | 105 | <code>class MemoryProvider {</code> |
| `constructor` | method | 106 | <code>constructor() {</code> |
| `refresh` | method | 112 | <code>async refresh() {</code> |
| `getTreeItem` | method | 118 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | method | 120 | <code>getChildren() {</code> |
| `updateStatusBar` | function | 142 | <code>function updateStatusBar(model) {</code> |
| `updateScope` | function | 161 | <code>async function updateScope() {</code> |
| `show` | function | 174 | <code>function show(text) {</code> |
| `openReport` | function | 185 | <code>async function openReport(name, title, body) {</code> |
| `fence` | function | 196 | <code>function fence(text) {</code> |
| `pickTask` | function | 202 | <code>async function pickTask(statusFilter) {</code> |
| `taskIdFrom` | function | 221 | <code>function taskIdFrom(arg) {</code> |
| `autoSyncOn` | function | 233 | <code>async function autoSyncOn() {</code> |
| `runRefresh` | function | 246 | <code>async function runRefresh() {</code> |
| `scheduleRefresh` | function | 275 | <code>function scheduleRefresh(delayMs) {</code> |
| `afterMutation` | function | 279 | <code>function afterMutation() {</code> |
| `cmdStart` | function | 283 | <code>async function cmdStart(arg) {</code> |
| `cmdImplemented` | function | 295 | <code>async function cmdImplemented(arg) {</code> |
| `cmdDone` | function | 307 | <code>async function cmdDone(arg) {</code> |
| `cmdDocs` | function | 335 | <code>async function cmdDocs(action) {</code> |
| `cmdClaim` | function | 345 | <code>async function cmdClaim(arg) {</code> |
| `cmdRelease` | function | 359 | <code>async function cmdRelease(arg) {</code> |
| `cmdTrace` | function | 367 | <code>async function cmdTrace(arg) {</code> |
| `cmdNext` | function | 374 | <code>async function cmdNext() {</code> |
| `cmdWave` | function | 385 | <code>async function cmdWave() {</code> |
| `cmdRender` | function | 390 | <code>async function cmdRender() {</code> |
| `cmdLint` | function | 396 | <code>async function cmdLint() {</code> |
| `cmdNewFeature` | function | 408 | <code>async function cmdNewFeature() {</code> |
| `cmdAddTask` | function | 425 | <code>async function cmdAddTask() {</code> |
| `cmdBrief` | function | 455 | <code>async function cmdBrief() {</code> |
| `cmdReview` | function | 460 | <code>async function cmdReview() {</code> |
| `cmdCheck` | function | 467 | <code>async function cmdCheck() {</code> |
| `cmdGuard` | function | 476 | <code>async function cmdGuard() {</code> |
| `cmdTestImpact` | function | 482 | <code>async function cmdTestImpact() {</code> |
| `cmdWhy` | function | 494 | <code>async function cmdWhy() {</code> |
| `cmdRemember` | function | 504 | <code>async function cmdRemember() {</code> |
| `cmdForget` | function | 525 | <code>async function cmdForget(arg) {</code> |
| `cmdSnapshot` | function | 535 | <code>async function cmdSnapshot() {</code> |
| `cmdSync` | function | 545 | <code>async function cmdSync() {</code> |
| `cmdHookInstall` | function | 552 | <code>async function cmdHookInstall() {</code> |
| `cmdOpenTask` | function | 557 | <code>async function cmdOpenTask(id) {</code> |
| `cmdActions` | function | 573 | <code>async function cmdActions() {</code> |
| `activate` | function | 607 | <code>async function activate(ctx) {</code> |
| `bump` | function | 775 | <code>const bump = (uri) =&gt; {</code> |
| `deactivate` | function | 796 | <code>function deactivate() {</code> |

## editors/vscode/fleet.js

[Open source](../editors/vscode/fleet.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `relAge` | function | 49 | <code>function relAge(seen, now) {</code> |
| `mergeState` | function | 65 | <code>function mergeState(name, base, reg, exists) {</code> |
| `treeFacts` | function | 107 | <code>function treeFacts(tree) {</code> |
| `str` | function | 112 | <code>const str = (v) =&gt; (typeof v === 'string' &amp;&amp; v) ? v : null;</code> |
| `num` | function | 113 | <code>const num = (v) =&gt; (typeof v === 'number' &amp;&amp; Number.isFinite(v)) ? v : null;</code> |
| `t` | function | 118 | <code>const t = (m.tasks &amp;&amp; typeof m.tasks === 'object') ? m.tasks : {};</code> |
| `parentsFromTree` | function | 161 | <code>function parentsFromTree(tree) {</code> |
| `kids` | function | 164 | <code>const kids = (n) =&gt; [].concat(n.children &#124;&#124; [], n.managers &#124;&#124; [],</code> |
| `nameOf` | function | 167 | <code>const nameOf = (n) =&gt; typeof n.agent === 'string' ? n.agent</code> |
| `walk` | function | 169 | <code>const walk = (n, parent) =&gt; {</code> |
| `taskNode` | function | 190 | <code>function taskNode(id, claim, planned) {</code> |
| `fleetTree` | function | 223 | <code>function fleetTree(status, specStatus, branches, opts) {</code> |
| `arr` | function | 224 | <code>const arr = (v) =&gt; Array.isArray(v) ? v : [];</code> |
| `feature` | function | 244 | <code>const feature = (specStatus &amp;&amp; specStatus.feature) &#124;&#124;</code> |
| `seenOf` | function | 265 | <code>const seenOf = (name) =&gt; {</code> |
| `tasksOf` | function | 269 | <code>const tasksOf = (name) =&gt; {</code> |
| `claimFor` | function | 277 | <code>const claimFor = (id) =&gt; (claimsBy.get(name) &#124;&#124; []).find((c) =&gt; c.id === id);</code> |
| `waveTasks` | function | 288 | <code>const waveTasks = (name, planWave, live, held) =&gt; {</code> |
| `mainName` | function | 310 | <code>const mainName = (facts &amp;&amp; facts.main.agent) &#124;&#124; (mainRow &amp;&amp; mainRow.agent) &#124;&#124;</code> |
| `mainBranch` | function | 312 | <code>const mainBranch = (facts &amp;&amp; facts.main.branch) &#124;&#124;</code> |
| `addManager` | function | 318 | <code>const addManager = (agent, feat, live, seen, tf) =&gt; {</code> |
| `branch` | function | 320 | <code>const branch = (tf &amp;&amp; tf.branch) &#124;&#124;</code> |
| `base` | function | 323 | <code>const base = (tf &amp;&amp; tf.base) &#124;&#124; mainBranch;</code> |
| `live` | function | 350 | <code>const live = (m.seen &#124;&#124; 0) &gt; 0 &#124;&#124;</code> |
| `addWorker` | function | 368 | <code>const addWorker = (agent, feat, wave, live, seen, tf) =&gt; {</code> |
| `claim` | function | 377 | <code>const claim = (claimsBy.get(agent) &#124;&#124; [])[0];</code> |
| `branch` | function | 381 | <code>const branch = (tf &amp;&amp; tf.branch) &#124;&#124; (claim &amp;&amp; claim.branch) &#124;&#124;</code> |
| `base` | function | 383 | <code>const base = (tf &amp;&amp; tf.base) &#124;&#124; (planWave &amp;&amp; planWave.base) &#124;&#124;</code> |
| `live` | function | 407 | <code>const live = (w.heartbeat &#124;&#124; w.seen &#124;&#124; 0) &gt; 0 &#124;&#124;</code> |
| `managerFor` | function | 433 | <code>const managerFor = (feat) =&gt;</code> |
| `claim` | function | 438 | <code>const claim = (claimsBy.get(w.agent) &#124;&#124; [])[0];</code> |
| `startPlan` | function | 497 | <code>function startPlan(input) {</code> |
| `open` | function | 507 | <code>const open = (i.runs &#124;&#124; []).filter((r) =&gt; ['running', 'paused', 'draining', 'stopping'].includes(r.state));</code> |
| `secs` | function | 515 | <code>const secs = (s) =&gt; !s ? '—' : s % 3600 === 0 ? `${s / 3600}h` : s % 60 === 0 ? `${s / 60}m` : `${s}s`;</code> |
| `coll` | function | 530 | <code>const coll = (i.collisions &amp;&amp; i.collisions.collisions) &#124;&#124; [];</code> |
| `workers` | function | 538 | <code>const workers = (roles.roles &#124;&#124; []).find((r) =&gt; r.name === 'worker');</code> |
| `liveDecorate` | function | 550 | <code>function liveDecorate(model, input) {</code> |
| `agents` | function | 553 | <code>const agents = (i.live &amp;&amp; i.live.agents) &#124;&#124; {};</code> |
| `walk` | function | 566 | <code>const walk = (n) =&gt; {</code> |
| `byDotted` | function | 595 | <code>function byDotted(a, b) {</code> |
| `short` | function | 623 | <code>function short(s, n) {</code> |
| `withTimeout` | function | 628 | <code>function withTimeout(p, ms, onTimeout) {</code> |
| `FleetView` | class | 650 | <code>class FleetView {</code> |
| `constructor` | method | 651 | <code>constructor(deps) {</code> |
| `refresh` | method | 668 | <code>async refresh(specStatus) {</code> |
| `call` | function | 672 | <code>const call = (args) =&gt; withTimeout(cgJson(args), CALL_TIMEOUT_MS,</code> |
| `_done` | method | 715 | <code>_done() {</code> |
| `getTreeItem` | method | 735 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | method | 737 | <code>getChildren(el) {</code> |
| `noticeItem` | method | 757 | <code>noticeItem(label, icon, command) {</code> |
| `nodeItem` | method | 775 | <code>nodeItem(n) {</code> |
| `kids` | function | 776 | <code>const kids = (n.children &#124;&#124; []).map((c) =&gt; this.nodeItem(c))</code> |
| `approvalItem` | method | 821 | <code>approvalItem(a) {</code> |
| `agentIcon` | method | 831 | <code>agentIcon(n) {</code> |
| `agentTooltip` | method | 841 | <code>agentTooltip(n) {</code> |
| `taskBadges` | method | 884 | <code>taskBadges(t) {</code> |
| `taskItem` | method | 894 | <code>taskItem(t, owner) {</code> |
| `prItem` | method | 926 | <code>prItem(p) {</code> |
| `nodeOf` | method | 946 | <code>nodeOf(arg) { return arg &amp;&amp; arg.node ? arg.node : null; }</code> |
| `remember` | method | 951 | <code>remember(feature, pr) {</code> |
| `featureOf` | function | 965 | <code>function featureOf(node) {</code> |
| `run` | function | 971 | <code>async function run(args, title) {</code> |
| `parse` | function | 979 | <code>function parse(r) {</code> |
| `pickTask` | function | 985 | <code>async function pickTask(placeHolder) {</code> |
| `walk` | function | 989 | <code>const walk = (n) =&gt; {</code> |
| `taskIdOf` | function | 1014 | <code>function taskIdOf(arg) {</code> |
| `cmdRefresh` | function | 1021 | <code>async function cmdRefresh() {</code> |
| `cmdOpenWorktree` | function | 1028 | <code>async function cmdOpenWorktree(arg) {</code> |
| `walk` | function | 1033 | <code>const walk = (x) =&gt; {</code> |
| `cmdBegin` | function | 1072 | <code>async function cmdBegin(arg) {</code> |
| `cmdMergeUp` | function | 1092 | <code>async function cmdMergeUp(arg) {</code> |
| `cmdLand` | function | 1127 | <code>async function cmdLand(arg) {</code> |
| `prFrom` | function | 1165 | <code>function prFrom(j) {</code> |
| `cmdOpenPr` | function | 1171 | <code>async function cmdOpenPr(arg) {</code> |
| `cmdCheckpoint` | function | 1208 | <code>async function cmdCheckpoint() {</code> |
| `cmdStart` | function | 1248 | <code>async function cmdStart(arg) {</code> |
| `fleetControl` | function | 1291 | <code>async function fleetControl(verb, label) {</code> |
| `cmdStop` | function | 1300 | <code>async function cmdStop() {</code> |
| `cmdOpenTranscript` | function | 1316 | <code>async function cmdOpenTranscript(arg) {</code> |
| `ids` | function | 1325 | <code>const ids = (n.tasks &#124;&#124; []).map((t) =&gt; t.id);</code> |
| `cmdApprove` | function | 1337 | <code>async function cmdApprove(arg) {</code> |
| `items` | function | 1341 | <code>const items = ((j &amp;&amp; j.approvals) &#124;&#124; []).map((x) =&gt; ({</code> |
| `register` | function | 1364 | <code>function register(ctx, d) {</code> |

## editors/vscode/kvx.js

[Open source](../editors/vscode/kvx.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `lineInfo` | function | 38 | <code>function lineInfo(doc, line) {</code> |
| `findSection` | function | 47 | <code>function findSection(doc, name) {</code> |
| `register` | function | 57 | <code>function register(ctx, cgJson, workspaceRoot) {</code> |
| `provideDefinition` | method | 62 | <code>provideDefinition(doc, pos) {</code> |
| `key` | function | 67 | <code>const key = (/^\s*([A-Za-z_0-9]+)\s*=/.exec(line) &#124;&#124; [])[1];</code> |
| `provideCompletionItems` | method | 88 | <code>async provideCompletionItems(doc, pos) {</code> |
| `key` | function | 93 | <code>const key = (/^\s*([A-Za-z_0-9]+)\s*=/.exec(line) &#124;&#124; [])[1];</code> |
| `provideCodeLenses` | method | 138 | <code>provideCodeLenses(doc) {</code> |
| `provideHover` | method | 160 | <code>provideHover(doc, pos) {</code> |
| `provideDocumentSymbols` | method | 176 | <code>provideDocumentSymbols(doc) {</code> |

## editors/vscode/language.js

[Open source](../editors/vscode/language.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `toRange` | function | 19 | <code>function toRange(r) {</code> |
| `toLocation` | function | 24 | <code>function toLocation(l) {</code> |
| `docParams` | function | 28 | <code>function docParams(doc, pos) {</code> |
| `register` | function | 34 | <code>function register(ctx, client, diagnostics) {</code> |
| `one` | function | 35 | <code>const one = (r) =&gt; (Array.isArray(r) ? r : r ? [r] : []).map(toLocation);</code> |
| `provideDefinition` | method | 39 | <code>async provideDefinition(doc, pos) {</code> |
| `provideReferences` | method | 46 | <code>async provideReferences(doc, pos) {</code> |
| `provideHover` | method | 53 | <code>async provideHover(doc, pos) {</code> |
| `provideDocumentSymbols` | method | 67 | <code>async provideDocumentSymbols(doc) {</code> |
| `provideWorkspaceSymbols` | method | 78 | <code>async provideWorkspaceSymbols(query) {</code> |
| `provideCodeLenses` | method | 88 | <code>async provideCodeLenses(doc) {</code> |
| `sync` | function | 121 | <code>const sync = (doc, method) =&gt; {</code> |
| `revalidate` | function | 145 | <code>return function revalidate() {</code> |

## editors/vscode/memories.js

[Open source](../editors/vscode/memories.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `dayBound` | function | 38 | <code>function dayBound(value, end) {</code> |
| `fieldMatches` | function | 49 | <code>function fieldMatches(value, want) {</code> |
| `haystack` | function | 55 | <code>function haystack(m) {</code> |
| `memoryFilter` | function | 68 | <code>function memoryFilter(memories, filter) {</code> |
| `filterSource` | function | 99 | <code>function filterSource() {</code> |
| `panelHtml` | function | 109 | <code>function panelHtml(nonce) {</code> |
| `newNonce` | function | 115 | <code>function newNonce() {</code> |
| `output` | function | 119 | <code>function output(r) {</code> |
| `unsupported` | function | 126 | <code>function unsupported(r) {</code> |
| `jevKeyMissing` | function | 132 | <code>function jevKeyMissing(r) {</code> |
| `firstLine` | function | 136 | <code>function firstLine(r) {</code> |
| `skillFor` | function | 146 | <code>function skillFor(skills, id) {</code> |
| `classifyNote` | function | 154 | <code>function classifyNote(data, id) {</code> |
| `rows` | function | 155 | <code>const rows = (data &amp;&amp; Array.isArray(data.memories)) ? data.memories : [];</code> |
| `MemoryBrowser` | class | 165 | <code>class MemoryBrowser {</code> |
| `constructor` | method | 166 | <code>constructor(deps) {</code> |
| `open` | method | 178 | <code>open() {</code> |
| `dispose` | method | 199 | <code>dispose() {</code> |
| `post` | method | 203 | <code>post(msg) {</code> |
| `onMessage` | method | 257 | <code>async onMessage(msg) {</code> |
| `memory` | method | 297 | <code>memory(id) {</code> |
| `busy` | method | 301 | <code>busy(id, on, label) {</code> |
| `notice` | method | 305 | <code>notice(text, kind) {</code> |
| `openFile` | method | 311 | <code>async openFile(rel, line) {</code> |
| `openSymbol` | method | 329 | <code>async openSymbol(name) {</code> |
| `forget` | method | 344 | <code>async forget(id) {</code> |
| `supersede` | method | 364 | <code>async supersede(id) {</code> |
| `classify` | method | 391 | <code>async classify(id) {</code> |
| `classifyAll` | method | 408 | <code>async classifyAll() {</code> |
| `candidates` | function | 418 | <code>const candidates = (data &amp;&amp; data.candidates) &#124;&#124; [];</code> |
| `promote` | method | 430 | <code>async promote(id) {</code> |
| `file` | function | 438 | <code>const file = (data &amp;&amp; data.path) &#124;&#124; '';</code> |
| `openSkill` | method | 456 | <code>async openSkill(id) {</code> |
| `missing` | method | 481 | <code>missing(id) {</code> |
| `reportMissing` | method | 485 | <code>reportMissing(r, label) {</code> |
| `reloadAfterMutation` | method | 501 | <code>async reloadAfterMutation() {</code> |
| `pickMemory` | method | 510 | <code>async pickMemory(placeHolder) {</code> |
| `list` | function | 514 | <code>const list = (data &amp;&amp; data.memories) &#124;&#124; [];</code> |
| `idFrom` | method | 527 | <code>idFrom(arg) {</code> |
| `promoteFrom` | method | 534 | <code>async promoteFrom(arg) {</code> |
| `supersedeFrom` | method | 541 | <code>async supersedeFrom(arg) {</code> |
| `register` | function | 555 | <code>function register(ctx, deps) {</code> |

## editors/vscode/refresh.js

[Open source](../editors/vscode/refresh.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `createRefresher` | function | 18 | <code>function createRefresher(work, opts = {}) {</code> |
| `start` | function | 30 | <code>function start() {</code> |
| `schedule` | function | 55 | <code>function schedule(delayMs) {</code> |
| `dispose` | function | 74 | <code>function dispose() {</code> |

## editors/vscode/serve.js

[Open source](../editors/vscode/serve.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ServeClient` | class | 21 | <code>class ServeClient {</code> |
| `constructor` | method | 22 | <code>constructor(bin, cwd, log) {</code> |
| `on` | method | 40 | <code>on(name, fn) { (this.listeners[name] &#124;&#124; (this.listeners[name] = [])).push(fn); }</code> |
| `_emit` | method | 41 | <code>_emit(name, arg) { for (const fn of this.listeners[name] &#124;&#124; []) { try { fn(arg); } catch (e) { this.log(`serve ${name} handler: ${e.message}`); } } }</code> |
| `start` | method | 46 | <code>async start() {</code> |
| `_reconnect` | method | 94 | <code>_reconnect() {</code> |
| `exec` | method | 138 | <code>async exec(args) {</code> |
| `tool` | method | 147 | <code>async tool(name, args) {</code> |
| `tools` | method | 151 | <code>async tools() {</code> |
| `subscribe` | method | 156 | <code>async subscribe(kinds) {</code> |
| `cancel` | method | 164 | <code>async cancel(reqId) {</code> |
| `_consume` | method | 168 | <code>_consume(chunk) {</code> |
| `_dispatch` | method | 181 | <code>_dispatch(msg) {</code> |
| `_kill` | method | 199 | <code>_kill() {</code> |
| `dispose` | method | 208 | <code>dispose() {</code> |
| `liveModel` | function | 223 | <code>function liveModel() {</code> |
| `splitSubject` | function | 228 | <code>function splitSubject(subject) {</code> |
| `applyEvent` | function | 234 | <code>function applyEvent(model, ev) {</code> |

## editors/vscode/tasks.js

[Open source](../editors/vscode/tasks.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `stripComment` | function | 45 | <code>function stripComment(line) {</code> |
| `kvxUnquote` | function | 54 | <code>function kvxUnquote(raw) {</code> |
| `kvxList` | function | 62 | <code>function kvxList(raw) {</code> |
| `parseKvx` | function | 87 | <code>function parseKvx(text) {</code> |
| `readSpec` | function | 116 | <code>function readSpec(text) {</code> |
| `raw` | function | 118 | <code>const raw = (sec, key) =&gt; {</code> |
| `str` | function | 124 | <code>const str = (sec, key) =&gt; kvxUnquote(raw(sec, key) &#124;&#124; '');</code> |
| `list` | function | 125 | <code>const list = (sec, key) =&gt; kvxList(raw(sec, key) &#124;&#124; '');</code> |
| `requireMet` | function | 192 | <code>function requireMet(status, mode) {</code> |
| `asSymbols` | function | 197 | <code>function asSymbols(v) {</code> |
| `asTouches` | function | 201 | <code>function asTouches(v) {</code> |
| `mergeTasks` | function | 208 | <code>function mergeTasks(spec, trace, status, plan) {</code> |
| `mode` | function | 211 | <code>const mode = (status &amp;&amp; status.mode) &#124;&#124; 'standard';</code> |
| `feature` | function | 212 | <code>const feature = (spec &amp;&amp; spec.feature) &#124;&#124; (trace &amp;&amp; trace.feature) &#124;&#124;</code> |
| `statusOf` | function | 231 | <code>const statusOf = (id) =&gt; {</code> |
| `sp` | function | 239 | <code>const sp = (spec &amp;&amp; spec.byId.get(id)) &#124;&#124; {};</code> |
| `patchRows` | function | 277 | <code>function patchRows(rows, feature, applied) {</code> |
| `taskFilter` | function | 293 | <code>function taskFilter(rows, filter) {</code> |
| `haystack` | function | 322 | <code>function haystack(r) {</code> |
| `filterLabel` | function | 331 | <code>function filterLabel(filter) {</code> |
| `resumePrompt` | function | 350 | <code>function resumePrompt(row, opts) {</code> |
| `touches` | function | 373 | <code>const touches = (row.touches &#124;&#124; []).map((t) =&gt; t.pattern &#124;&#124; t);</code> |
| `symbols` | function | 375 | <code>const symbols = (row.symbols &#124;&#124; []).map((s) =&gt; s.name &#124;&#124; s);</code> |
| `mem` | function | 384 | <code>const mem = (row.memories &#124;&#124; []).slice(0, 5);</code> |
| `detailHtml` | function | 405 | <code>function detailHtml(nonce) {</code> |
| `detailView` | function | 759 | <code>function detailView(row, spec) {</code> |
| `blocked` | function | 763 | <code>const blocked = (row.blockers &#124;&#124; []).length &gt; 0;</code> |
| `clauses` | function | 764 | <code>const clauses = (spec &amp;&amp; spec.clauses) &#124;&#124; {};</code> |
| `icon` | function | 816 | <code>function icon(name, color) {</code> |
| `statusIcon` | function | 821 | <code>function statusIcon(row) {</code> |
| `statusWord` | function | 830 | <code>function statusWord(row) {</code> |
| `TaskTreeProvider` | class | 840 | <code>class TaskTreeProvider {</code> |
| `constructor` | method | 841 | <code>constructor(d) {</code> |
| `loadFilter` | method | 851 | <code>loadFilter() {</code> |
| `setFilter` | method | 858 | <code>setFilter(patch) {</code> |
| `describe` | method | 869 | <code>describe() {</code> |
| `visible` | method | 881 | <code>visible() { return taskFilter(this.rows, this.filter); }</code> |
| `refresh` | method | 886 | <code>async refresh() {</code> |
| `applyEvent` | method | 907 | <code>applyEvent(applied) {</code> |
| `readSpecFile` | method | 917 | <code>readSpecFile(rel) {</code> |
| `fleetPlan` | method | 927 | <code>async fleetPlan() {</code> |
| `row` | method | 934 | <code>row(id) { return this.rows.find((r) =&gt; r.id === id); }</code> |
| `owners` | method | 936 | <code>owners() {</code> |
| `waves` | method | 940 | <code>waves() {</code> |
| `getTreeItem` | method | 946 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | method | 948 | <code>getChildren(el) {</code> |
| `featureNodes` | method | 957 | <code>featureNodes() {</code> |
| `docsNode` | method | 1000 | <code>docsNode() {</code> |
| `sectionNodes` | method | 1019 | <code>sectionNodes(rows, feature) {</code> |
| `waveNodes` | method | 1040 | <code>waveNodes(rows, parentKey) {</code> |
| `taskNode` | method | 1069 | <code>taskNode(row) {</code> |
| `tooltip` | method | 1089 | <code>tooltip(row) {</code> |
| `touches` | function | 1107 | <code>const touches = (row.touches &#124;&#124; []).map((t) =&gt; t.pattern).join(' ');</code> |
| `groupBy` | function | 1114 | <code>function groupBy(rows, key) {</code> |
| `taskDetail` | function | 1128 | <code>async function taskDetail(arg) {</code> |
| `postTask` | function | 1148 | <code>function postTask(id) {</code> |
| `refreshPanels` | function | 1165 | <code>function refreshPanels() {</code> |
| `panelMessage` | function | 1169 | <code>async function panelMessage(id, msg) {</code> |
| `openSymbol` | function | 1193 | <code>async function openSymbol(msg) {</code> |
| `text` | function | 1202 | <code>const text = (r.stdout &#124;&#124; '') + (r.stderr &#124;&#124; '');</code> |
| `openPath` | function | 1210 | <code>async function openPath(pattern) {</code> |
| `taskIdFrom` | function | 1229 | <code>function taskIdFrom(arg) {</code> |
| `resolveId` | function | 1238 | <code>async function resolveId(arg, placeHolder, filter) {</code> |
| `rows` | function | 1241 | <code>const rows = (provider ? provider.visible() : []).filter(filter &#124;&#124; (() =&gt; true));</code> |
| `cmdFilterStatus` | function | 1255 | <code>async function cmdFilterStatus() {</code> |
| `cmdFilterWave` | function | 1275 | <code>async function cmdFilterWave() {</code> |
| `cmdFilterOwner` | function | 1290 | <code>async function cmdFilterOwner() {</code> |
| `cmdSearch` | function | 1311 | <code>async function cmdSearch() {</code> |
| `cmdClearFilters` | function | 1321 | <code>function cmdClearFilters() {</code> |
| `cmdFilter` | function | 1326 | <code>async function cmdFilter() {</code> |
| `cmdVerify` | function | 1347 | <code>async function cmdVerify(arg) {</code> |
| `cmdOpenBranch` | function | 1371 | <code>async function cmdOpenBranch(arg) {</code> |
| `cmdCopyPrompt` | function | 1410 | <code>async function cmdCopyPrompt(arg) {</code> |
| `register` | function | 1425 | <code>function register(ctx, d) {</code> |

## kvx/impl/go/canonical.go

[Open source](../kvx/impl/go/canonical.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Canonical` | method | 17 | <code>func (d *Doc) Canonical() string {</code> |
| `Hash` | method | 41 | <code>func (d *Doc) Hash() string {</code> |

## kvx/impl/go/kvx.go

[Open source](../kvx/impl/go/kvx.go)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Doc` | type | 35 | <code>type Doc struct {</code> |
| `NewDoc` | function | 47 | <code>func NewDoc() *Doc {</code> |
| `ParseFile` | function | 55 | <code>func ParseFile(path string) (*Doc, error) {</code> |
| `Parse` | function | 65 | <code>func Parse(r io.Reader, name string) (*Doc, error) {</code> |
| `ensure` | method | 108 | <code>func (d *Doc) ensure(section string) {</code> |
| `stripComment` | function | 115 | <code>func stripComment(line string) string {</code> |
| `Has` | method | 131 | <code>func (d *Doc) Has(section string) bool {</code> |
| `Str` | method | 137 | <code>func (d *Doc) Str(section, key string) string {</code> |
| `Bool` | method | 150 | <code>func (d *Doc) Bool(section, key string, fallback bool) bool {</code> |
| `List` | method | 160 | <code>func (d *Doc) List(section, key string) []string {</code> |
| `Keys` | method | 190 | <code>func (d *Doc) Keys(section string) []string {</code> |
| `Raw` | method | 196 | <code>func (d *Doc) Raw(section, key string) string {</code> |
| `IsList` | method | 204 | <code>func (d *Doc) IsList(section, key string) bool {</code> |
| `OrderedKV` | method | 211 | <code>func (d *Doc) OrderedKV(section, prefix string) [][2]string {</code> |
| `Sections` | method | 223 | <code>func (d *Doc) Sections() []string { return d.order }</code> |
| `SectionsWithPrefix` | method | 227 | <code>func (d *Doc) SectionsWithPrefix(prefix string) []string {</code> |
| `UintOr` | method | 239 | <code>func (d *Doc) UintOr(section, key string, fallback uint64) uint64 {</code> |
| `splitList` | function | 251 | <code>func splitList(s string) []string {</code> |
| `unquote` | function | 269 | <code>func unquote(s string) string {</code> |
| `interpolate` | function | 277 | <code>func interpolate(s string) string {</code> |
| `SortDottedIDs` | function | 287 | <code>func SortDottedIDs(ids []string) {</code> |

## scripts/format_changelog.py

[Open source](../scripts/format_changelog.py)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FormatError` | class | 90 | <code>class FormatError(ValueError):</code> |
| `git` | function | 94 | <code>def git(repo: Path, *args: str) -&gt; str:</code> |
| `Dates` | class | 105 | <code>class Dates:</code> |
| `__init__` | function | 108 | <code>def __init__(self, repo: Path):</code> |
| `_records` | function | 126 | <code>def _records(payload: str) -&gt; dict[str, tuple[str, str, str, str]]:</code> |
| `resolve` | function | 140 | <code>def resolve(self, commit: str) -&gt; tuple[str, str]:</code> |
| `metadata` | function | 168 | <code>def metadata(self, commit: str) -&gt; tuple[str, str, str]:</code> |
| `metadata_token` | function | 205 | <code>def metadata_token(value: str) -&gt; str:</code> |
| `quoted_subject` | function | 211 | <code>def quoted_subject(subject: str) -&gt; str:</code> |
| `entry_type` | function | 223 | <code>def entry_type(subject: str) -&gt; str:</code> |
| `Entry` | class | 244 | <code>class Entry:</code> |
| `parse_entry` | function | 250 | <code>def parse_entry(</code> |
| `section` | function | 282 | <code>def section(body: str, dates: Dates, newline: str, missing_metadata: str) -&gt; str:</code> |
| `format_changelog` | function | 375 | <code>def format_changelog(text: str, repo: Path, missing_metadata: str = "recover") -&gt; str:</code> |
| `atomic_output` | function | 396 | <code>def atomic_output(path: Path, content: bytes, mode: int = 0o644) -&gt; None:</code> |
| `main` | function | 410 | <code>def main(argv: list[str] &#124; None = None) -&gt; int:</code> |

## src/agent.c

[Open source](../src/agent.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DirAgg` | typedef | 10 | <code>typedef struct { char name[128]; int files; long lines;</code> |
| `dir_lang` | function | 14 | <code>static void dir_lang(DirAgg *d, const char *lang) {</code> |
| `cmd_agentmd` | function | 54 | <code>int cmd_agentmd(Cg *cg, bool write_files) {</code> |

## src/cg.h

[Open source](../src/cg.h)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CG_H` | macro | 7 | <code>#define CG_H</code> |
| `_GNU_SOURCE` | macro | 9 | <code>#define _GNU_SOURCE</code> |
| `CG_DIR` | macro | 18 | <code>#define CG_DIR      ".codegraph"</code> |
| `CG_DB` | macro | 19 | <code>#define CG_DB       ".codegraph/graph.db"</code> |
| `CG_OBJECTS` | macro | 20 | <code>#define CG_OBJECTS  ".codegraph/objects"</code> |
| `CG_HEAD` | macro | 21 | <code>#define CG_HEAD     ".codegraph/HEAD"</code> |
| `CG_IGNORE` | macro | 22 | <code>#define CG_IGNORE   ".cgignore"</code> |
| `CG_VERSION` | macro | 23 | <code>#define CG_VERSION  "1.4.0"</code> |
| `CG_MCP_VERSION` | macro | 24 | <code>#define CG_MCP_VERSION "2025-11-25"</code> |
| `CG_AGENT_CONTEXT` | macro | 25 | <code>#define CG_AGENT_CONTEXT ".codify/agent-context.md"</code> |
| `CG_DOC_TASK` | macro | 26 | <code>#define CG_DOC_TASK "@docs"</code> |
| `CG_DOCS_DIR` | macro | 27 | <code>#define CG_DOCS_DIR ".codegraph/docs"</code> |
| `SysInfo` | typedef | 30 | <code>typedef struct {</code> |
| `sysinfo_detect` | function | 44 | <code>void sysinfo_detect(SysInfo *si);</code> |
| `CG_MAX_WORKERS` | macro | 48 | <code>#define CG_MAX_WORKERS 64</code> |
| `StrBuf` | typedef | 51 | <code>typedef struct { char *p; size_t len, cap; } StrBuf;</code> |
| `sb_init` | function | 52 | <code>void  sb_init(StrBuf *b);</code> |
| `sb_free` | function | 53 | <code>void  sb_free(StrBuf *b);</code> |
| `sb_putc` | function | 54 | <code>void  sb_putc(StrBuf *b, char c);</code> |
| `sb_puts` | function | 55 | <code>void  sb_puts(StrBuf *b, const char *s);</code> |
| `sb_printf` | function | 56 | <code>void  sb_printf(StrBuf *b, const char *fmt, ...);</code> |
| `sb_json_str` | function | 57 | <code>void  sb_json_str(StrBuf *b, const char *s);   /* emits "escaped" incl quotes */</code> |
| `sb_shquote` | function | 58 | <code>void  sb_shquote(StrBuf *b, const char *s);    /* 'single-quoted' for sh -c */</code> |
| `cg_find_exe` | function | 60 | <code>bool  cg_find_exe(const char *name, char *out, size_t cap);</code> |
| `xmalloc` | function | 62 | <code>void *xmalloc(size_t n);</code> |
| `xrealloc` | function | 63 | <code>void *xrealloc(void *p, size_t n);</code> |
| `xstrdup` | function | 64 | <code>char *xstrdup(const char *s);</code> |
| `read_entire_file` | function | 65 | <code>char *read_entire_file(const char *path, size_t *out_len); /* NUL-terminated */</code> |
| `write_entire_file` | function | 66 | <code>int   write_entire_file(const char *path, const void *data, size_t len);</code> |
| `mkdirs` | function | 67 | <code>int   mkdirs(const char *path);                 /* mkdir -p for dirs */</code> |
| `path_format` | function | 68 | <code>bool path_format(char *out, size_t cap, const char *fmt, ...)</code> |
| `now_ms` | function | 70 | <code>long  now_ms(void);</code> |
| `looks_binary` | function | 71 | <code>bool  looks_binary(const char *data, size_t len);</code> |
| `path_ext` | function | 72 | <code>const char *path_ext(const char *path);</code> |
| `cg_agent_name` | function | 74 | <code>const char *cg_agent_name(const char *flag);</code> |
| `cg_agent_role` | function | 76 | <code>const char *cg_agent_role(const char *flag);</code> |
| `cg_agent_parent` | function | 77 | <code>const char *cg_agent_parent(const char *flag);</code> |
| `sha256_hex` | function | 80 | <code>void sha256_hex(const void *data, size_t len, char out_hex[65]);</code> |
| `hash_lines` | function | 86 | <code>void hash_lines(const char *data, size_t len, int from, int to,</code> |
| `name_words` | function | 92 | <code>void name_words(const char *name, char *out, size_t cap);</code> |
| `IgnorePat` | typedef | 95 | <code>typedef struct {</code> |
| `Ignore` | typedef | 102 | <code>typedef struct {</code> |
| `ignore_load` | function | 106 | <code>void ignore_load(Ignore *ig, const char *root);</code> |
| `ignore_match` | function | 107 | <code>bool ignore_match(const Ignore *ig, const char *rel, bool is_dir);</code> |
| `ignore_free` | function | 108 | <code>void ignore_free(Ignore *ig);</code> |
| `MAX_DEFS_PER_LINE` | macro | 111 | <code>#define MAX_DEFS_PER_LINE 4</code> |
| `SymDef` | typedef | 113 | <code>typedef struct {</code> |
| `SymRef` | typedef | 122 | <code>typedef struct {</code> |
| `ImportDef` | typedef | 133 | <code>typedef struct {</code> |
| `RouteDef` | typedef | 140 | <code>typedef struct {</code> |
| `CmtDef` | typedef | 152 | <code>typedef struct {</code> |
| `ParseResult` | typedef | 159 | <code>typedef struct {</code> |
| `lang_for_path` | function | 169 | <code>const char *lang_for_path(const char *path);       /* NULL if not source */</code> |
| `lang_parse` | function | 170 | <code>void lang_parse(const char *lang, const char *path, const char *src,</code> |
| `parse_result_free` | function | 172 | <code>void parse_result_free(ParseResult *pr);</code> |
| `lang_global_init` | function | 173 | <code>void lang_global_init(void);                        /* compile all regexes once */</code> |
| `routes_global_init` | function | 176 | <code>void routes_global_init(void);</code> |
| `routes_scan_file` | function | 177 | <code>void routes_scan_file(const char *path, ParseResult *pr);</code> |
| `routes_scan_line` | function | 178 | <code>void routes_scan_line(const char *lang, const char *path, int lineno,</code> |
| `route_add` | function | 180 | <code>void route_add(ParseResult *pr, const char *framework, const char *method,</code> |
| `Cg` | typedef | 184 | <code>typedef struct {</code> |
| `CG_EXIT_BUSY` | macro | 222 | <code>#define CG_EXIT_BUSY 75</code> |
| `cg_open` | function | 224 | <code>int  cg_open(Cg *cg, bool create);                 /* finds root upward */</code> |
| `cg_begin_write` | function | 228 | <code>int  cg_begin_write(Cg *cg);</code> |
| `cg_lock_wait_default` | function | 229 | <code>long cg_lock_wait_default(void);                   /* CG_BUSY_TIMEOUT_MS */</code> |
| `cg_busy_report` | function | 232 | <code>void cg_busy_report(const char *what);</code> |
| `cg_close` | function | 233 | <code>void cg_close(Cg *cg);</code> |
| `cg_find_root` | function | 237 | <code>int  cg_find_root(char *out, size_t cap);</code> |
| `cg_find_root_at` | function | 239 | <code>int  cg_find_root_at(const char *start, char *out, size_t cap);</code> |
| `cg_find_project_at` | function | 244 | <code>int  cg_find_project_at(const char *start, char *root, char *shared,</code> |
| `cg_bkey` | function | 248 | <code>void cg_bkey(const Cg *cg, const char *name, char *out, size_t cap);</code> |
| `cg_is_boundary` | function | 250 | <code>bool cg_is_boundary(const char *dir);</code> |
| `cmd_root` | function | 251 | <code>int  cmd_root(bool json);                          /* print the bound root */</code> |
| `cg_prep` | function | 252 | <code>sqlite3_stmt *cg_prep(Cg *cg, const char *sql);</code> |
| `cg_exec` | function | 253 | <code>void cg_exec(Cg *cg, const char *sql);</code> |
| `cg_meta_set` | function | 254 | <code>void cg_meta_set(Cg *cg, const char *k, const char *v);</code> |
| `cg_meta_get` | function | 255 | <code>char *cg_meta_get(Cg *cg, const char *k);          /* malloc'd or NULL */</code> |
| `cg_schema_upgrade` | function | 258 | <code>int  cg_schema_upgrade(Cg *cg);</code> |
| `CG_CONFIG_FILE` | macro | 266 | <code>#define CG_CONFIG_FILE "codify.kvx"</code> |
| `CgConfig` | typedef | 269 | <code>typedef struct {</code> |
| `config_load` | function | 280 | <code>const CgConfig *config_load(const char *root);</code> |
| `config_auto_sync` | function | 281 | <code>bool config_auto_sync(const char *root);</code> |
| `config_spec_rel` | function | 282 | <code>const char *config_spec_rel(const char *root);     /* "spec" */</code> |
| `config_context_rel` | function | 283 | <code>const char *config_context_rel(const char *root);  /* ".codify" */</code> |
| `config_skills_rel` | function | 284 | <code>const char *config_skills_rel(const char *root);   /* ".agents/skills" */</code> |
| `config_codemap_rel` | function | 285 | <code>const char *config_codemap_rel(const char *root);  /* "CODEMAP.md" */</code> |
| `config_index_workers` | function | 287 | <code>int  config_index_workers(const char *root);</code> |
| `config_parse_workers` | function | 290 | <code>int  config_parse_workers(const char *v);</code> |
| `config_spec_dir` | function | 292 | <code>bool config_spec_dir(const char *root, char *out, size_t cap);</code> |
| `config_workflow_path` | function | 293 | <code>bool config_workflow_path(const char *root, char *out, size_t cap);</code> |
| `config_feature_path` | function | 294 | <code>bool config_feature_path(const char *root, const char *feature, char *out,</code> |
| `config_context_dir` | function | 296 | <code>bool config_context_dir(const char *root, char *out, size_t cap);</code> |
| `config_context_path` | function | 297 | <code>bool config_context_path(const char *root, const char *name, char *out,</code> |
| `config_skills_dir` | function | 299 | <code>bool config_skills_dir(const char *root, char *out, size_t cap);</code> |
| `config_codemap_path` | function | 300 | <code>bool config_codemap_path(const char *root, char *out, size_t cap);</code> |
| `config_in_spec` | function | 302 | <code>bool config_in_spec(const char *root, const char *rel);</code> |
| `config_find_spec_root` | function | 304 | <code>int  config_find_spec_root(const char *start, char *out, size_t cap);</code> |
| `config_check` | function | 308 | <code>int  config_check(const char *root, StrBuf *text, StrBuf *json);</code> |
| `cmd_config` | function | 309 | <code>int  cmd_config(int argc, char **argv, bool json);</code> |
| `IndexStats` | typedef | 312 | <code>typedef struct {</code> |
| `IndexOpts` | typedef | 335 | <code>typedef struct {</code> |
| `cg_index_ex` | function | 359 | <code>int cg_index_ex(Cg *cg, const SysInfo *si, const IndexOpts *o, IndexStats *st);</code> |
| `cg_index` | function | 361 | <code>int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet);</code> |
| `progress_request` | function | 365 | <code>void progress_request(bool want);   /* the command a person runs asks for it */</code> |
| `progress_begin` | function | 366 | <code>void progress_begin(const IndexOpts *o);</code> |
| `progress_step` | function | 367 | <code>void progress_step(const char *step);   /* cg init's named steps */</code> |
| `progress_phase` | function | 368 | <code>void progress_phase(const char *phase, long done, long total);</code> |
| `progress_flush` | function | 369 | <code>void progress_flush(void);              /* draw now: bounded points only */</code> |
| `progress_tick` | function | 370 | <code>void progress_tick(long done, long total, const char *path);</code> |
| `progress_workers` | function | 371 | <code>void progress_workers(int n);</code> |
| `progress_wait` | function | 372 | <code>void progress_wait(const char *what, long waited_ms);  /* NULL clears */</code> |
| `progress_end` | function | 373 | <code>void progress_end(void);                /* erases the line; call before output */</code> |
| `progress_begin_write` | function | 374 | <code>int  progress_begin_write(Cg *cg);      /* cg_begin_write, wait shown */</code> |
| `syncgate_acquire` | function | 377 | <code>int  syncgate_acquire(const Cg *cg, long wait_ms);     /* fd or -1 */</code> |
| `syncgate_release` | function | 378 | <code>void syncgate_release(int fd);</code> |
| `syncgate_mark_dirty` | function | 379 | <code>void syncgate_mark_dirty(const Cg *cg, const char *const *paths, int npaths);</code> |
| `syncgate_is_dirty` | function | 380 | <code>bool syncgate_is_dirty(const Cg *cg);</code> |
| `syncgate_take_dirty` | function | 381 | <code>char *syncgate_take_dirty(const Cg *cg);               /* malloc'd or NULL */</code> |
| `syncgate_slot_count` | function | 382 | <code>int  syncgate_slot_count(const SysInfo *si);</code> |
| `syncgate_slot_acquire` | function | 383 | <code>int  syncgate_slot_acquire(const SysInfo *si);         /* fd or -1 */</code> |
| `syncgate_slot_release` | function | 384 | <code>void syncgate_slot_release(int fd);</code> |
| `syncgate_worker_request` | function | 389 | <code>int  syncgate_worker_request(const char *root, const SysInfo *si, int flag,</code> |
| `syncgate_worker_budget` | function | 391 | <code>int  syncgate_worker_budget(const char *root, const SysInfo *si,</code> |
| `syncgate_background_nice` | function | 393 | <code>void syncgate_background_nice(void);</code> |
| `resolve_imports` | function | 396 | <code>void resolve_imports(Cg *cg);</code> |
| `resolve_refs` | function | 397 | <code>void resolve_refs(Cg *cg);</code> |
| `resolve_imports_scoped` | function | 402 | <code>void resolve_imports_scoped(Cg *cg);</code> |
| `resolve_refs_scoped` | function | 403 | <code>void resolve_refs_scoped(Cg *cg);</code> |
| `index_scope_begin` | function | 406 | <code>void index_scope_begin(Cg *cg);</code> |
| `index_scope_end` | function | 407 | <code>void index_scope_end(Cg *cg);</code> |
| `index_scope_bounded` | function | 410 | <code>bool index_scope_bounded(Cg *cg);</code> |
| `GroundFinding` | typedef | 413 | <code>typedef struct {</code> |
| `ground_findings` | function | 422 | <code>int ground_findings(Cg *cg, const char *path, GroundFinding **out);</code> |
| `ground_findings_free` | function | 423 | <code>void ground_findings_free(GroundFinding *v, int n);</code> |
| `file_calibrated` | function | 424 | <code>bool file_calibrated(Cg *cg, long file_id, const char *lang);</code> |
| `ContractFinding` | typedef | 427 | <code>typedef struct {</code> |
| `contract_findings` | function | 435 | <code>int contract_findings(Cg *cg, const char *path, ContractFinding **out);</code> |
| `contract_findings_free` | function | 436 | <code>void contract_findings_free(ContractFinding *v, int n);</code> |
| `HygieneFinding` | typedef | 439 | <code>typedef struct {</code> |
| `hygiene_findings` | function | 447 | <code>int hygiene_findings(Cg *cg, const char *path, HygieneFinding **out);</code> |
| `hygiene_findings_all` | function | 448 | <code>int hygiene_findings_all(Cg *cg, HygieneFinding **out, int limit);</code> |
| `hygiene_findings_free` | function | 449 | <code>void hygiene_findings_free(HygieneFinding *v, int n);</code> |
| `is_entrypoint` | function | 450 | <code>bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,</code> |
| `cmd_search` | function | 454 | <code>int cmd_search (Cg *cg, const char *q, int limit, bool json);</code> |
| `cmd_symbol` | function | 455 | <code>int cmd_symbol (Cg *cg, const char *name, bool json);</code> |
| `cmd_impact` | function | 456 | <code>int cmd_impact (Cg *cg, const char *name, int depth, int budget, bool json);</code> |
| `cmd_context` | function | 457 | <code>int cmd_context(Cg *cg, const char *q, int budget, int limit, bool json);</code> |
| `graph_task_focus` | function | 458 | <code>char *graph_task_focus(Cg *cg, const char *task_packet); /* malloc'd query */</code> |
| `graph_symbol_brief` | function | 461 | <code>int  graph_symbol_brief(Cg *cg, const char *name, int snippet_lines,</code> |
| `graph_glob_symbols` | function | 464 | <code>int  graph_glob_symbols(Cg *cg, const char *glob, int max_files, int max_syms,</code> |
| `task_packet_build` | function | 470 | <code>int  task_packet_build(Cg *cg, const char *tag, int budget, StrBuf *out);</code> |
| `manager_packet_build` | function | 472 | <code>int  manager_packet_build(Cg *cg, const char *feature, int budget, StrBuf *out);</code> |
| `packet_upstream_evidence` | function | 475 | <code>int  packet_upstream_evidence(Cg *cg, const char *feature, const char *req,</code> |
| `cmd_survey` | function | 478 | <code>int cmd_survey(Cg *cg, const char *scope, int budget, bool json);</code> |
| `cmd_anchors` | function | 480 | <code>int cmd_anchors(Cg *cg, bool stale_only, bool unc_only, bool json);</code> |
| `cmd_routes` | function | 481 | <code>int cmd_routes (Cg *cg, const char *filter, bool json);</code> |
| `cmd_show` | function | 482 | <code>int cmd_show   (Cg *cg, const char *name, bool full, bool json); /* one body */</code> |
| `cmd_test_impact` | function | 483 | <code>int cmd_test_impact(Cg *cg, const char *name, bool json);</code> |
| `cmd_why` | function | 484 | <code>int cmd_why    (Cg *cg, const char *name, bool json);   /* provenance join */</code> |
| `graph_path_is_test` | function | 485 | <code>bool graph_path_is_test(const char *path);</code> |
| `graph_symbol_at` | function | 487 | <code>int  graph_symbol_at(Cg *cg, const char *path, int line, char *name, size_t cap);</code> |
| `branch_scope_sql` | function | 496 | <code>const char *branch_scope_sql(const Cg *cg, const char *alias, char *out,</code> |
| `cg_scope_set` | function | 500 | <code>int  cg_scope_set(Cg *cg, const char *name, bool all);</code> |
| `branch_hit_label` | function | 504 | <code>const char *branch_hit_label(Cg *cg, long branch_id, char *out, size_t cap);</code> |
| `branch_tree` | function | 508 | <code>const char *branch_tree(Cg *cg, long branch_id, char *out, size_t cap);</code> |
| `cmd_commit` | function | 511 | <code>int cmd_commit  (Cg *cg, const char *msg, bool quiet);</code> |
| `cmd_commit_with_options` | function | 512 | <code>int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,</code> |
| `cmd_log` | function | 514 | <code>int cmd_log     (Cg *cg, int limit, bool json);</code> |
| `cmd_status` | function | 515 | <code>int cmd_status  (Cg *cg, bool json);</code> |
| `cmd_state` | function | 516 | <code>int cmd_state   (Cg *cg, bool json);              /* Git/snapshot/spec/live */</code> |
| `cmd_event` | function | 517 | <code>int cmd_event(Cg *cg, int argc, char **argv, bool json);</code> |
| `runtime_event_ingest` | function | 518 | <code>int runtime_event_ingest(Cg *cg, const char *source, const char *payload,</code> |
| `runtime_workspace_revision` | function | 520 | <code>void runtime_workspace_revision(Cg *cg, char out[65]);</code> |
| `RuntimeProgress` | typedef | 521 | <code>typedef struct {</code> |
| `runtime_classify_progress` | function | 527 | <code>int runtime_classify_progress(Cg *cg, const char *attempt,</code> |
| `runtime_progress` | function | 529 | <code>int runtime_progress(Cg *cg, bool json);</code> |
| `cmd_diff` | function | 530 | <code>int cmd_diff    (Cg *cg, const char *a, const char *b);</code> |
| `cmd_checkout` | function | 531 | <code>int cmd_checkout(Cg *cg, const char *id, bool force);</code> |
| `cmd_changes` | function | 532 | <code>int cmd_changes (Cg *cg, int limit, bool json); /* impact of uncommitted edits */</code> |
| `vcs_find_commits` | function | 538 | <code>int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,</code> |
| `vcs_changed_paths` | function | 542 | <code>int vcs_changed_paths(Cg *cg, const char *needle, char ***out);</code> |
| `vcs_commits_for_path` | function | 545 | <code>int vcs_commits_for_path(Cg *cg, const char *path, int limit, char ***ids,</code> |
| `Memory` | typedef | 549 | <code>typedef struct {</code> |
| `memory_add` | function | 563 | <code>long memory_add(Cg *cg, const char *type, const char *task, const char *body,</code> |
| `memory_query` | function | 567 | <code>int  memory_query(Cg *cg, const char *query, const char *task,</code> |
| `memory_clear` | function | 569 | <code>void memory_clear(Memory *m);            /* free one entry's fields */</code> |
| `memory_free` | function | 570 | <code>void memory_free(Memory *v, int n);</code> |
| `memory_json` | function | 571 | <code>void memory_json(const Memory *m, StrBuf *b);</code> |
| `memory_print_brief` | function | 572 | <code>void memory_print_brief(const Memory *m, const char *indent);</code> |
| `memory_open_quiet` | function | 574 | <code>bool memory_open_quiet(Cg *g);</code> |
| `cmd_remember` | function | 575 | <code>int  cmd_remember(Cg *cg, const char *text, const char *type, const char *task,</code> |
| `cmd_recall` | function | 577 | <code>int  cmd_recall(Cg *cg, const char *query, const char *task, const char *type,</code> |
| `cmd_forget` | function | 579 | <code>int  cmd_forget(Cg *cg, const char *idstr);</code> |
| `memory_supersede` | function | 580 | <code>int  memory_supersede(Cg *cg, long old_id, long new_id);</code> |
| `cmd_recall_near` | function | 581 | <code>int  cmd_recall_near(Cg *cg, const char *path, int limit, bool json);</code> |
| `cmd_memory_compact` | function | 582 | <code>int  cmd_memory_compact(Cg *cg, bool dry_run, bool json);</code> |
| `memory_promote_branch` | function | 587 | <code>int  memory_promote_branch(Cg *cg, const char *from, const char *to);</code> |
| `memory_content_id` | function | 591 | <code>void memory_content_id(const char *type, const char *task, const char *body,</code> |
| `MemExportOpts` | typedef | 593 | <code>typedef struct {</code> |
| `MemImportOpts` | typedef | 599 | <code>typedef struct {</code> |
| `cmd_memory_export` | function | 606 | <code>int  cmd_memory_export(Cg *cg, const MemExportOpts *o, bool json);</code> |
| `cmd_memory_import` | function | 609 | <code>int  cmd_memory_import(Cg *cg, const MemImportOpts *o, bool json);</code> |
| `cmd_watch` | function | 612 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms);</code> |
| `watch_fleet` | function | 617 | <code>int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms);</code> |
| `json_get_string` | function | 620 | <code>char *json_get_string(const char *obj, const char *key);  /* malloc, unescaped */</code> |
| `json_string_value` | function | 621 | <code>char *json_string_value(const char *raw);  /* "\"a\\nb\"" -&gt; malloc "a\nb"; NULL if not a string */</code> |
| `json_get_int` | function | 622 | <code>long  json_get_int(const char *obj, const char *key, long dflt);</code> |
| `json_get_raw` | function | 623 | <code>char *json_get_raw(const char *obj, const char *key);     /* raw token, malloc */</code> |
| `json_get_object` | function | 624 | <code>char *json_get_object(const char *obj, const char *key);  /* balanced {...}   */</code> |
| `json_object_keys` | function | 625 | <code>int   json_object_keys(const char *obj, char **keys, int cap); /* malloc'd each */</code> |
| `json_array_items` | function | 628 | <code>int   json_array_items(const char *arr, char ***out);</code> |
| `cg_capture` | function | 631 | <code>int cg_capture(char **out, int (*fn)(void *), void *ctx);</code> |
| `KvxEntry` | typedef | 634 | <code>typedef struct { char *section, *key, *raw; } KvxEntry;</code> |
| `Kvx` | typedef | 635 | <code>typedef struct {</code> |
| `kvx_parse` | function | 641 | <code>Kvx  *kvx_parse(const char *path);                /* NULL on open/parse error */</code> |
| `kvx_free` | function | 642 | <code>void  kvx_free(Kvx *k);</code> |
| `kvx_has` | function | 643 | <code>bool  kvx_has(const Kvx *k, const char *sec);</code> |
| `kvx_raw` | function | 644 | <code>const char *kvx_raw(const Kvx *k, const char *sec, const char *key);</code> |
| `kvx_str` | function | 645 | <code>char *kvx_str(const Kvx *k, const char *sec, const char *key); /* malloc; NULL absent */</code> |
| `kvx_long` | function | 646 | <code>long  kvx_long(const Kvx *k, const char *sec, const char *key, long dflt);</code> |
| `kvx_bool` | function | 647 | <code>bool  kvx_bool(const Kvx *k, const char *sec, const char *key, bool dflt);</code> |
| `kvx_list` | function | 648 | <code>int   kvx_list(const Kvx *k, const char *sec, const char *key, char ***out);</code> |
| `kvx_keys` | function | 649 | <code>int   kvx_keys(const Kvx *k, const char *sec, const char ***out); /* borrowed */</code> |
| `kvx_subsections` | function | 650 | <code>int   kvx_subsections(const Kvx *k, const char *prefix, char ***out); /* file order */</code> |
| `kvx_sort_dotted` | function | 651 | <code>void  kvx_sort_dotted(char **ids, int n);</code> |
| `kvx_set_status` | function | 653 | <code>int   kvx_set_status(const char *path, const char *section, const char *value);</code> |
| `void` | function | 658 | <code>extern void (*kvx_status_hook)(const char *path, const char *section,</code> |
| `kvx_set_string` | function | 661 | <code>int   kvx_set_string(const char *path, const char *section, const char *key,</code> |
| `kvx_set_raw` | function | 664 | <code>int   kvx_set_raw(const char *path, const char *section, const char *key,</code> |
| `cmd_spec` | function | 667 | <code>int cmd_spec(int argc, char **argv, bool json);</code> |
| `spec_attempt_set_branch` | function | 671 | <code>int spec_attempt_set_branch(Cg *g, const char *tag, const char *branch,</code> |
| `SpecAttempt` | typedef | 673 | <code>typedef struct {</code> |
| `spec_claim` | function | 685 | <code>int spec_claim(Cg *g, const char *root, const char *feature, const char *id,</code> |
| `spec_active_tag` | function | 689 | <code>char *spec_active_tag(void);</code> |
| `spec_task_tag` | function | 691 | <code>char *spec_task_tag(const char *requested);</code> |
| `spec_active_touches` | function | 693 | <code>int   spec_active_touches(char ***out);</code> |
| `spec_globs_overlap` | function | 695 | <code>bool  spec_globs_overlap(const char *a, const char *b);</code> |
| `spec_resolve_task` | function | 698 | <code>char *spec_resolve_task(const char *requested, const char *agent);</code> |
| `spec_task_packet` | function | 700 | <code>char *spec_task_packet(const char *requested);</code> |
| `spec_task_memories_tag` | function | 702 | <code>int   spec_task_memories_tag(const char *requested, Memory **out);</code> |
| `cmd_lsp` | function | 705 | <code>int  cmd_lsp(Cg *cg, const SysInfo *si);</code> |
| `lsp_hover` | function | 706 | <code>void lsp_hover(Cg *cg, const char *name, StrBuf *md);</code> |
| `lsp_diagnostics` | function | 707 | <code>void lsp_diagnostics(Cg *cg, const char *abs, StrBuf *out);</code> |
| `lsp_path_in_task_scope` | function | 708 | <code>bool lsp_path_in_task_scope(Cg *cg, const char *rel);</code> |
| `anchor_stale` | function | 715 | <code>int anchor_stale(Cg *cg,</code> |
| `cmd_check` | function | 720 | <code>int cmd_check(Cg *cg, bool json, bool strict);   /* the single CI gate */</code> |
| `cmd_brief` | function | 721 | <code>int cmd_brief(Cg *cg, bool json);                /* session state in one call */</code> |
| `cmd_guard` | function | 722 | <code>int cmd_guard(Cg *cg, int npath, char **pathv, bool json, bool strict);</code> |
| `cmd_review` | function | 723 | <code>int cmd_review(Cg *cg, bool json);</code> |
| `cmd_hook_install` | function | 724 | <code>int cmd_hook_install(Cg *cg);</code> |
| `cmd_hook_post_edit` | function | 725 | <code>int cmd_hook_post_edit(Cg *cg, const SysInfo *si, bool json);</code> |
| `cmd_integrate` | function | 726 | <code>int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility);</code> |
| `integrate_plan` | function | 727 | <code>int integrate_plan(Cg *cg, bool json);</code> |
| `integrate_apply` | function | 728 | <code>int integrate_apply(Cg *cg, bool json);</code> |
| `integrate_doctor` | function | 729 | <code>int integrate_doctor(Cg *cg, bool json);</code> |
| `integrate_apply_portable` | function | 730 | <code>int integrate_apply_portable(Cg *cg, bool quiet);</code> |
| `cmd_handoff` | function | 732 | <code>int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,</code> |
| `cmd_resume` | function | 735 | <code>int cmd_resume(Cg *cg, const char *task, bool json, bool prompt);</code> |
| `cmd_work` | function | 736 | <code>int cmd_work(Cg *cg, int argc, char **argv, bool json);</code> |
| `work_open` | function | 737 | <code>int work_open(Cg *cg, const char *task, bool json);</code> |
| `work_update` | function | 738 | <code>int work_update(Cg *cg, const char *revision, bool json);</code> |
| `work_close` | function | 739 | <code>int work_close(Cg *cg, const char *task, int nevidence, char **evidence,</code> |
| `cmd_spec_run` | function | 745 | <code>int cmd_spec_run(int argc, char **argv);</code> |
| `cmd_fleet_up` | function | 751 | <code>int  cmd_fleet_up(Cg *cg, int argc, char **argv, bool json);</code> |
| `cmd_fleet_control` | function | 752 | <code>int  cmd_fleet_control(Cg *cg, const char *verb, int argc, char **argv,</code> |
| `cmd_fleet_runs` | function | 754 | <code>int  cmd_fleet_runs(Cg *cg, bool json);</code> |
| `fleet_supervisor_alive` | function | 755 | <code>bool fleet_supervisor_alive(const char *shared);</code> |
| `CG_EXIT_APPROVAL` | macro | 760 | <code>#define CG_EXIT_APPROVAL 4</code> |
| `fleet_gate` | function | 761 | <code>int  fleet_gate(Cg *cg, const char *gate, const char *subject);</code> |
| `cmd_fleet_approvals` | function | 762 | <code>int  cmd_fleet_approvals(Cg *cg, int argc, char **argv, bool json);</code> |
| `DriverSpec` | typedef | 765 | <code>typedef struct {</code> |
| `driver_argv` | function | 777 | <code>int driver_argv(const DriverSpec *d, const char *root, const char *promptfile,</code> |
| `DriverEvent` | typedef | 779 | <code>typedef struct {</code> |
| `void` | function | 787 | <code>typedef void (*DriverEventFn)(const DriverEvent *e, void *ud);</code> |
| `driver_stream_parse` | function | 790 | <code>int driver_stream_parse(const char *line, DriverEventFn fn, void *ud);</code> |
| `DriverTap` | typedef | 791 | <code>typedef struct {</code> |
| `driver_tap_init` | function | 800 | <code>void driver_tap_init(DriverTap *t, const char *log, const char *agent,</code> |
| `driver_tap_poll` | function | 804 | <code>int  driver_tap_poll(DriverTap *t);</code> |
| `driver_tap_free` | function | 805 | <code>void driver_tap_free(DriverTap *t);</code> |
| `driver_steer` | function | 807 | <code>long driver_steer(Cg *cg, const char *agent, const char *message);</code> |
| `driver_steer_take` | function | 810 | <code>char *driver_steer_take(Cg *cg, const char *agent, const char *via);</code> |
| `EventRow` | typedef | 813 | <code>typedef struct {</code> |
| `int` | function | 818 | <code>typedef int (*EventFn)(const EventRow *e, void *ud);</code> |
| `events_install` | function | 819 | <code>int  events_install(Cg *cg);         /* triggers; called by cg_open */</code> |
| `events_emit` | function | 823 | <code>long events_emit(Cg *cg, const char *kind, const char *subject,</code> |
| `events_emit_as` | function | 827 | <code>long events_emit_as(Cg *cg, const char *kind, const char *subject,</code> |
| `events_emit_quiet` | function | 829 | <code>long events_emit_quiet(const char *kind, const char *subject,</code> |
| `events_bind` | function | 831 | <code>void events_bind(Cg *cg);            /* see events_kvx_status */</code> |
| `events_unbind` | function | 832 | <code>void events_unbind(void);</code> |
| `events_kvx_status` | function | 833 | <code>void events_kvx_status(const char *path, const char *section,</code> |
| `events_head` | function | 835 | <code>long events_head(Cg *cg);</code> |
| `events_pruned_through` | function | 836 | <code>long events_pruned_through(Cg *cg);</code> |
| `events_since` | function | 838 | <code>long events_since(Cg *cg, long since, const char *kinds, int limit,</code> |
| `events_json` | function | 840 | <code>void events_json(StrBuf *b, const EventRow *e);</code> |
| `cmd_events` | function | 841 | <code>int  cmd_events(Cg *cg, int argc, char **argv, bool json);</code> |
| `events_emit_at` | function | 844 | <code>long events_emit_at(Cg *cg, long at_ms, const char *kind, const char *subject,</code> |
| `JOURNAL_VERSION` | macro | 853 | <code>#define JOURNAL_VERSION 1</code> |
| `JournalMode` | typedef | 854 | <code>typedef enum {</code> |
| `journal_append` | function | 860 | <code>int  journal_append(Cg *cg, const char *op, const char *args,</code> |
| `journal_replay` | function | 864 | <code>int  journal_replay(Cg *cg, JournalMode mode);</code> |
| `journal_begin` | function | 868 | <code>int  journal_begin(Cg *cg);</code> |
| `journal_busy_seen` | function | 869 | <code>bool journal_busy_seen(void);</code> |
| `journal_mark_busy` | function | 870 | <code>void journal_mark_busy(void);</code> |
| `journal_queued_count` | function | 871 | <code>int  journal_queued_count(void);          /* records this process appended */</code> |
| `journal_announced` | function | 872 | <code>void journal_announced(void);             /* the command said "queued" itself */</code> |
| `journal_set_command` | function | 873 | <code>void journal_set_command(const char *cmd, const char *sub);</code> |
| `journal_pending` | function | 874 | <code>int  journal_pending(const Cg *cg, int *failed);  /* pending; failed via ptr */</code> |
| `journal_queued_memories` | function | 877 | <code>int  journal_queued_memories(const Cg *cg, const char *query,</code> |
| `cmd_journal` | function | 879 | <code>int  cmd_journal(Cg *cg, int argc, char **argv, bool json);</code> |
| `cg_busy_why` | function | 882 | <code>void cg_busy_why(const char *why);</code> |
| `spec_journal_apply` | function | 885 | <code>int  spec_journal_apply(Cg *g, const char *op, const char *args,</code> |
| `govern_journal_apply` | function | 887 | <code>int  govern_journal_apply(Cg *g, const char *op, const char *args,</code> |
| `runtime_journal_apply` | function | 890 | <code>int  runtime_journal_apply(Cg *g, const char *args, char *err, size_t errcap);</code> |
| `memory_add_at` | function | 891 | <code>long memory_add_at(Cg *cg, long created, const char *branch, const char *type,</code> |
| `cmd_remember_ex` | function | 894 | <code>int  cmd_remember_ex(Cg *cg, const char *text, const char *type,</code> |
| `drift_spec_check` | function | 904 | <code>int  drift_spec_check(Cg *cg, const char *tree, const char *base,</code> |
| `drift_print` | function | 907 | <code>void drift_print(const char *report_json);</code> |
| `drift_collision_predict` | function | 909 | <code>bool drift_collision_predict(Cg *cg, const char *feature, const char *a,</code> |
| `cmd_drift` | function | 911 | <code>int  cmd_drift(Cg *cg, int argc, char **argv, bool json);</code> |
| `drift_interface_check` | function | 917 | <code>int  drift_interface_check(Cg *cg, const char *tree, const char *base_branch,</code> |
| `coverage_check` | function | 922 | <code>int  coverage_check(Cg *cg, const char *feature, StrBuf *out);</code> |
| `coverage_print` | function | 923 | <code>void coverage_print(const char *report_json, const char *feature);</code> |
| `drift_summary` | function | 925 | <code>int  drift_summary(Cg *cg, const char *feature, StrBuf *text, StrBuf *json);</code> |
| `graph_neighbors` | function | 927 | <code>int  graph_neighbors(Cg *cg, const char *name, char ***out);</code> |
| `RoleCaps` | typedef | 938 | <code>typedef struct {</code> |
| `FleetRole` | typedef | 949 | <code>typedef struct {</code> |
| `Hierarchy` | typedef | 957 | <code>typedef struct {</code> |
| `hier_load` | function | 974 | <code>bool hier_load(const Kvx *wf, Hierarchy *h);   /* defaults, then overrides */</code> |
| `hier_role_caps` | function | 977 | <code>void hier_role_caps(const Kvx *wf, Hierarchy *h);</code> |
| `hier_duration` | function | 979 | <code>long hier_duration(const char *s);</code> |
| `hier_free` | function | 980 | <code>void hier_free(Hierarchy *h);</code> |
| `hier_expand_task` | function | 984 | <code>void hier_expand_task(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `hier_per_task` | function | 986 | <code>bool hier_per_task(const Hierarchy *h);</code> |
| `fleet_merge_lock` | function | 991 | <code>int  fleet_merge_lock(const char *shared, const char *feature, long wait_ms);</code> |
| `fleet_merge_unlock` | function | 992 | <code>void fleet_merge_unlock(int fd);</code> |
| `hier_expand` | function | 993 | <code>void hier_expand(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `fleet_identity_record` | function | 995 | <code>int  fleet_identity_record(Cg *g);           /* no-op without CG_ROLE */</code> |
| `fleet_brief` | function | 996 | <code>void fleet_brief(Cg *cg, StrBuf *b, bool json);</code> |
| `fleet_worker_begin` | function | 1003 | <code>int  fleet_worker_begin(Cg *cg, const char *id, const char *feature,</code> |
| `fleet_merge_up` | function | 1005 | <code>int  fleet_merge_up(Cg *cg, const char *id, const char *feature, bool force,</code> |
| `fleet_feature_land` | function | 1007 | <code>int  fleet_feature_land(Cg *cg, const char *feature, bool no_pr, bool json);</code> |
| `fleet_pr_open` | function | 1008 | <code>int  fleet_pr_open(Cg *cg, const char *feature, bool dry_run, bool json);</code> |
| `fleet_checkpoint` | function | 1009 | <code>int  fleet_checkpoint(Cg *cg, bool dry_run, bool json);</code> |
| `cmd_fleet` | function | 1010 | <code>int  cmd_fleet(Cg *cg, int argc, char **argv, bool json);</code> |
| `FleetNode` | typedef | 1015 | <code>typedef struct {</code> |
| `orch_spawn_manager` | function | 1032 | <code>int orch_spawn_manager(Cg *cg, const char *feature, const char *driver,</code> |
| `orch_spawn_worker` | function | 1037 | <code>int orch_spawn_worker(Cg *cg, const char *feature, const char *id,</code> |
| `orch_tree_status` | function | 1042 | <code>int orch_tree_status(Cg *cg, const char *feature, bool json);</code> |
| `JevQuestion` | typedef | 1054 | <code>typedef struct {</code> |
| `JevAnswer` | typedef | 1061 | <code>typedef struct {</code> |
| `JevResult` | typedef | 1070 | <code>typedef struct {</code> |
| `jev_question_noul` | function | 1082 | <code>int  jev_question_noul(JevQuestion *q, const char *name,</code> |
| `jev_question_choice` | function | 1085 | <code>int  jev_question_choice(JevQuestion *q, const char *name,</code> |
| `jev_question_score` | function | 1088 | <code>int  jev_question_score(JevQuestion *q, const char *name,</code> |
| `jev_question_free` | function | 1091 | <code>void jev_question_free(JevQuestion *q);</code> |
| `jev_request_json` | function | 1095 | <code>void jev_request_json(const char *model, const char *state_json,</code> |
| `jev_ask` | function | 1102 | <code>int  jev_ask(Cg *cg, const char *state_json, const JevQuestion *qs, int nq,</code> |
| `jev_ask_raw` | function | 1106 | <code>int  jev_ask_raw(Cg *cg, const char *body, JevResult *out);</code> |
| `jev_ask_at` | function | 1111 | <code>int  jev_ask_at(Cg *cg, const char *key, const char *model,</code> |
| `jev_answer` | function | 1114 | <code>const JevAnswer *jev_answer(const JevResult *r, const char *name);</code> |
| `jev_result_free` | function | 1115 | <code>void jev_result_free(JevResult *r);</code> |
| `cmd_jev` | function | 1116 | <code>int  cmd_jev(Cg *cg, int argc, char **argv, bool json);</code> |
| `jev_advisory_ready` | function | 1124 | <code>bool jev_advisory_ready(const char *what);</code> |
| `JevTriage` | typedef | 1125 | <code>typedef struct {</code> |
| `jev_triage_failure` | function | 1133 | <code>int  jev_triage_failure(Cg *cg, const char *output, JevTriage *out);</code> |
| `JevFinding` | typedef | 1134 | <code>typedef struct {</code> |
| `jev_rank_findings` | function | 1144 | <code>int  jev_rank_findings(Cg *cg, JevFinding *v, int n);</code> |
| `JevReadiness` | typedef | 1145 | <code>typedef struct {</code> |
| `jev_pr_readiness` | function | 1149 | <code>int  jev_pr_readiness(Cg *cg, const char *state_json, JevReadiness *out);</code> |
| `jev_report_error` | function | 1160 | <code>int  jev_report_error(const JevResult *r, const char *what);</code> |
| `memory_get` | function | 1163 | <code>bool memory_get(Cg *cg, long id, Memory *out);</code> |
| `cmd_memory_classify` | function | 1166 | <code>int  cmd_memory_classify(Cg *cg, const char *sel, int limit, bool json);</code> |
| `skill_render` | function | 1170 | <code>int  skill_render(Cg *cg, const Memory *m, char *path_out, size_t cap);</code> |
| `skill_findings` | function | 1173 | <code>int  skill_findings(Cg *cg, char ***out);</code> |
| `cmd_skills` | function | 1174 | <code>int  cmd_skills(Cg *cg, int argc, char **argv, bool json);</code> |
| `git_available` | function | 1176 | <code>bool git_available(const Cg *cg);</code> |
| `git_head` | function | 1181 | <code>bool git_head(const char *tree, char *branch, size_t bcap, char *sha,</code> |
| `git_worktree_main` | function | 1185 | <code>bool git_worktree_main(const char *tree, char *main_out, size_t cap);</code> |
| `cg_branch_resolve` | function | 1189 | <code>int  cg_branch_resolve(Cg *cg);</code> |
| `branch_register` | function | 1193 | <code>long branch_register(Cg *cg, const char *name, const char *worktree,</code> |
| `cmd_branches` | function | 1195 | <code>int  cmd_branches(Cg *cg, int argc, char **argv, bool json);</code> |
| `git_run` | function | 1199 | <code>int  git_run(const char *tree, const char *args, StrBuf *out);</code> |
| `git_branch_exists` | function | 1200 | <code>bool git_branch_exists(const char *tree, const char *branch);</code> |
| `git_worktree_add` | function | 1207 | <code>int  git_worktree_add(const char *tree, const char *path, const char *branch,</code> |
| `git_conflicted_paths` | function | 1211 | <code>int  git_conflicted_paths(const char *tree, char ***out);</code> |
| `git_ingest` | function | 1214 | <code>int  git_ingest(Cg *cg, int limit, long *ncommits, long *npaths, long *seen);</code> |
| `cmd_git_sync` | function | 1215 | <code>int  cmd_git_sync(Cg *cg, int limit, bool json);</code> |
| `git_churn_for_path` | function | 1216 | <code>int  git_churn_for_path(Cg *cg, const char *path);</code> |
| `git_commit_mirror` | function | 1217 | <code>int  git_commit_mirror(Cg *cg, const char *message);</code> |
| `cmd_mcp` | function | 1220 | <code>int cmd_mcp(Cg *cg, const SysInfo *si);            /* stdio MCP server */</code> |
| `mcp_tools_json` | function | 1224 | <code>void mcp_tools_json(StrBuf *r);                    /* {"tools":[...]} */</code> |
| `mcp_call_tool` | function | 1225 | <code>int  mcp_call_tool(Cg *cg, const SysInfo *si, const char *name,</code> |
| `cmd_tool` | function | 1227 | <code>int  cmd_tool(Cg *cg, const SysInfo *si, int argc, char **argv, bool json);</code> |
| `cmd_serve` | function | 1230 | <code>int  cmd_serve(Cg *cg, const SysInfo *si);</code> |
| `cmd_mcp_install` | function | 1231 | <code>int cmd_mcp_install(Cg *cg);                       /* wire into agent configs */</code> |
| `cmd_changelog` | function | 1233 | <code>int cmd_changelog(Cg *cg, int limit, const char *outfile);</code> |
| `ChangelogOpts` | typedef | 1236 | <code>typedef struct {</code> |
| `cmd_changelog_git` | function | 1242 | <code>int cmd_changelog_git(Cg *cg, const ChangelogOpts *o);</code> |
| `ChatModel` | typedef | 1249 | <code>typedef struct {</code> |
| `chat_model_config` | function | 1253 | <code>void  chat_model_config(const Cg *cg, ChatModel *m);</code> |
| `chat_model_ask` | function | 1256 | <code>char *chat_model_ask(const Cg *cg, const ChatModel *m, const char *prompt,</code> |
| `env_file_key` | function | 1259 | <code>void  env_file_key(const char *root, const char *want, char *out, size_t cap);</code> |
| `RecapOpts` | typedef | 1263 | <code>typedef struct {</code> |
| `cmd_recap` | function | 1273 | <code>int cmd_recap(Cg *cg, const RecapOpts *o);</code> |
| `cmd_agentmd` | function | 1274 | <code>int cmd_agentmd(Cg *cg, bool write_files);         /* graph agent context */</code> |
| `CodemapOpts` | typedef | 1278 | <code>typedef struct {</code> |
| `cmd_codemap` | function | 1283 | <code>int  cmd_codemap(Cg *cg, const CodemapOpts *o);</code> |
| `codemap_render` | function | 1286 | <code>int  codemap_render(Cg *cg, int budget, bool json, const char *self_rel,</code> |
| `codemap_default_path` | function | 1288 | <code>void codemap_default_path(const Cg *cg, char *out, size_t cap);</code> |
| `codemap_status` | function | 1291 | <code>int  codemap_status(Cg *cg, char *rel, size_t cap);</code> |
| `cmd_docs` | function | 1292 | <code>int cmd_docs(Cg *cg, int argc, char **argv, bool json); /* documentation closure */</code> |
| `spec_docs_finish` | function | 1293 | <code>int spec_docs_finish(Cg *cg, const char *feature); /* internal checked closure */</code> |
| `help_overview` | function | 1299 | <code>void help_overview(void);</code> |
| `help_command` | function | 1300 | <code>int  help_command(const char *name);</code> |
| `cmd_help` | function | 1301 | <code>int  cmd_help(int argc, char **argv);</code> |
| `help_route` | function | 1302 | <code>int  help_route(int argc, char **argv);</code> |
| `help_usage` | function | 1303 | <code>void help_usage(const char *name);              /* "usage: cg ..." on stderr */</code> |
| `help_suggest` | function | 1304 | <code>void help_suggest(const char *name);            /* closest names, on stderr */</code> |
| `help_known` | function | 1305 | <code>bool help_known(const char *name);              /* a top-level row or alias */</code> |

## src/changelog.c

[Open source](../src/changelog.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `git_capture` | function | 36 | <code>static int git_capture(const char *tree, const char *args, StrBuf *out) {</code> |
| `repo_url` | function | 55 | <code>static void repo_url(const char *tree, char *out, size_t cap) {</code> |
| `Tag` | typedef | 79 | <code>typedef struct { char name[128]; long when; } Tag;</code> |
| `tags_load` | function | 81 | <code>static int tags_load(const char *tree, Tag **out) {</code> |
| `version_source` | function | 111 | <code>static const char *version_source(const char *tree, char *path, size_t cap) {</code> |
| `version_parse` | function | 124 | <code>static void version_parse(const char *src, const char *body, char *out, size_t cap) {</code> |
| `version_at` | function | 145 | <code>static void version_at(const char *tree, const char *src, const char *rev,</code> |
| `version_now` | function | 159 | <code>static void version_now(const char *tree, const char *src, char *out, size_t cap) {</code> |
| `Boundary` | typedef | 170 | <code>typedef struct { char name[128]; char commit[65]; long when; } Boundary;</code> |
| `boundaries_load` | function | 172 | <code>static int boundaries_load(const char *tree, const char *src, Boundary **out) {</code> |
| `ADD` | macro | 176 | <code>#define ADD(nm, cm, wh) do { \</code> |
| `Entry` | typedef | 232 | <code>typedef struct {</code> |
| `entry_free` | function | 241 | <code>static void entry_free(Entry *e) {</code> |
| `NGROUPS` | macro | 259 | <code>#define NGROUPS ((int)(sizeof GROUPS / sizeof GROUPS[0]))</code> |
| `re_init` | function | 265 | <code>static void re_init(void) {</code> |
| `upper_first` | function | 274 | <code>static char *upper_first(const char *s) {</code> |
| `trimdup` | function | 280 | <code>static char *trimdup(const char *s, size_t n) {</code> |
| `entry_parse` | function | 291 | <code>static void entry_parse(Entry *e, const char *subject, const char *body) {</code> |
| `commits_load` | function | 343 | <code>static int commits_load(const char *tree, const char *range, Entry **out) {</code> |
| `Release` | typedef | 378 | <code>typedef struct {</code> |
| `group_rank` | function | 385 | <code>static int group_rank(const char *g) {</code> |
| `render_release` | function | 391 | <code>static void render_release(StrBuf *md, const Release *r, Entry *v, int n,</code> |
| `Summ` | typedef | 464 | <code>typedef ChatModel Summ;</code> |
| `env_file_key` | function | 468 | <code>void env_file_key(const char *root, const char *want, char *out, size_t cap) {</code> |
| `chat_model_config` | function | 497 | <code>void chat_model_config(const Cg *cg, ChatModel *s) {</code> |
| `summ_config` | macro | 515 | <code>#define summ_config chat_model_config</code> |
| `cfgquote` | function | 517 | <code>static void cfgquote(StrBuf *b, const char *s) {</code> |
| `write_private` | function | 526 | <code>static int write_private(const char *path, const char *data) {</code> |
| `summ_ask` | function | 540 | <code>static char *summ_ask(const Cg *cg, const Summ *s, const Release *r,</code> |
| `chat_model_ask` | function | 560 | <code>char *chat_model_ask(const Cg *cg, const ChatModel *s, const char *prompt_text,</code> |
| `highlights_body` | function | 665 | <code>static const char *highlights_body(const char *text) {</code> |
| `summ_cache_path` | function | 680 | <code>static void summ_cache_path(const Cg *cg, const Release *r, const Summ *s,</code> |
| `cmd_changelog_git` | function | 692 | <code>int cmd_changelog_git(Cg *cg, const ChangelogOpts *o) {</code> |

## src/codemap.c

[Open source](../src/codemap.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CM_MARKER` | macro | 19 | <code>#define CM_MARKER "&lt;!-- codify-owned: codemap v1"</code> |
| `CM_BUDGET` | macro | 20 | <code>#define CM_BUDGET 8000</code> |
| `CM_MIN_BUDGET` | macro | 21 | <code>#define CM_MIN_BUDGET 300</code> |
| `CAP_MOD_SYMS` | macro | 24 | <code>#define CAP_MOD_SYMS   12</code> |
| `CAP_MOD_FILES` | macro | 25 | <code>#define CAP_MOD_FILES  40</code> |
| `CAP_MODULES` | macro | 26 | <code>#define CAP_MODULES    24</code> |
| `CAP_TEST_FILES` | macro | 27 | <code>#define CAP_TEST_FILES 40</code> |
| `CAP_ROUTES` | macro | 28 | <code>#define CAP_ROUTES     25</code> |
| `CAP_DEPS` | macro | 29 | <code>#define CAP_DEPS       30</code> |
| `CAP_DOCS` | macro | 30 | <code>#define CAP_DOCS       24</code> |
| `CAP_SUBDIRS` | macro | 31 | <code>#define CAP_SUBDIRS    8</code> |
| `CAP_COMMANDS` | macro | 32 | <code>#define CAP_COMMANDS   96</code> |
| `codemap_default_path` | function | 36 | <code>void codemap_default_path(const Cg *cg, char *out, size_t cap) {</code> |
| `cm_spec_dir` | function | 41 | <code>static const char *cm_spec_dir(const Cg *cg) {</code> |
| `Cut` | typedef | 50 | <code>typedef struct { int tier; long rank; int seq; bool drop; } Cut;</code> |
| `CmFile` | typedef | 52 | <code>typedef struct {</code> |
| `CmLang` | typedef | 59 | <code>typedef struct { char *name; long files, lines; Cut cut; } CmLang;</code> |
| `CmBuild` | typedef | 60 | <code>typedef struct { char *tool, *manifest, *dir, *cmds; Cut cut; } CmBuild;</code> |
| `CmDir` | typedef | 62 | <code>typedef struct {</code> |
| `CmMain` | typedef | 70 | <code>typedef struct { char *path, *sig; char name[128]; int line; Cut cut; } CmMain;</code> |
| `CmPkg` | typedef | 71 | <code>typedef struct { char *manifest, *what; Cut cut; } CmPkg;</code> |
| `CmRoute` | typedef | 72 | <code>typedef struct {</code> |
| `CmModFile` | typedef | 78 | <code>typedef struct { CmFile *f; Cut cut; } CmModFile;</code> |
| `CmSym` | typedef | 79 | <code>typedef struct {</code> |
| `CmMod` | typedef | 85 | <code>typedef struct {</code> |
| `CmDep` | typedef | 94 | <code>typedef struct { char *from, *to; long imports, calls; Cut cut; } CmDep;</code> |
| `CmTestFile` | typedef | 96 | <code>typedef struct { CmFile *f; Cut cut; } CmTestFile;</code> |
| `CmTestDir` | typedef | 97 | <code>typedef struct {</code> |
| `CmFixture` | typedef | 103 | <code>typedef struct { char *path, *subs; long files; Cut cut; } CmFixture;</code> |
| `CmPtr` | typedef | 105 | <code>typedef struct { char *path, *what; Cut cut; } CmPtr;</code> |
| `Map` | typedef | 107 | <code>typedef struct {</code> |
| `VPUSH` | macro | 139 | <code>#define VPUSH(v, n, c) \</code> |
| `cut_init` | function | 146 | <code>static void cut_init(Map *m, Cut *c, int tier, long rank) {</code> |
| `cut_add` | function | 152 | <code>static void cut_add(Map *m, Cut *c) {</code> |
| `num` | function | 162 | <code>static const char *num(long n, char *buf) {          /* 39334 -&gt; "39,334" */</code> |
| `starts_ci` | function | 175 | <code>static bool starts_ci(const char *s, const char *pre) {</code> |
| `strip_leader` | function | 180 | <code>static void strip_leader(const char **p, int *ll) {</code> |
| `has_alnum` | function | 202 | <code>static bool has_alnum(const char *p, int ll) {</code> |
| `boilerplate` | function | 208 | <code>static bool boilerplate(const char *p, int ll) {</code> |
| `sentence` | function | 220 | <code>static char *sentence(const char *s, int max) {</code> |
| `purpose_of` | function | 248 | <code>static char *purpose_of(const char *body, int max) {</code> |
| `md_title` | function | 277 | <code>static char *md_title(const char *body) {</code> |
| `md_plain` | function | 297 | <code>static void md_plain(StrBuf *b, const char *p, int ll) {</code> |
| `readme_prose` | function | 309 | <code>static char *readme_prose(const char *body, int max) {</code> |
| `clean_sig` | function | 338 | <code>static char *clean_sig(const char *sig) {</code> |
| `cm_skipped` | function | 362 | <code>static bool cm_skipped(const Map *m, const char *path) {</code> |
| `cm_fixture` | function | 369 | <code>static bool cm_fixture(const char *path) {</code> |
| `cm_test` | function | 379 | <code>static bool cm_test(const char *path) {</code> |
| `top_dir` | function | 384 | <code>static void top_dir(const char *path, char *out, size_t cap) {</code> |
| `mod_dir` | function | 390 | <code>static void mod_dir(const char *path, char *out, size_t cap) {</code> |
| `fn_skip` | function | 399 | <code>static void fn_skip(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `fn_test` | function | 404 | <code>static void fn_test(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `fn_top` | function | 409 | <code>static void fn_top(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `fn_mod` | function | 416 | <code>static void fn_mod(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `cm_functions` | function | 424 | <code>static void cm_functions(Map *m, bool on) {</code> |
| `cm_prep` | function | 438 | <code>static sqlite3_stmt *cm_prep(Map *m, const char *alias, const char *head,</code> |
| `col` | function | 449 | <code>static const char *col(sqlite3_stmt *st, int i) {</code> |
| `byid_cmp` | function | 454 | <code>static int byid_cmp(const void *a, const void *b) {</code> |
| `file_by_id` | function | 459 | <code>static CmFile *file_by_id(Map *m, long id) {</code> |
| `file_by_path` | function | 469 | <code>static CmFile *file_by_path(Map *m, const char *path) {</code> |
| `dir_range` | function | 483 | <code>static void dir_range(const Map *m, const char *dir, int *lo, int *hi) {</code> |
| `tree_read` | function | 499 | <code>static char *tree_read(Map *m, const char *rel) {</code> |
| `load_files` | function | 507 | <code>static void load_files(Map *m) {</code> |
| `load_name` | function | 564 | <code>static void load_name(Map *m) {</code> |
| `lang_cmp` | function | 624 | <code>static int lang_cmp(const void *a, const void *b) {</code> |
| `load_langs` | function | 631 | <code>static void load_langs(Map *m) {</code> |
| `dir_of` | function | 654 | <code>static void dir_of(const char *path, char *out, size_t cap) {</code> |
| `add_build` | function | 659 | <code>static void add_build(Map *m, const char *tool, const char *manifest,</code> |
| `make_targets` | function | 675 | <code>static void make_targets(const char *body, StrBuf *b) {</code> |
| `load_builds` | function | 709 | <code>static void load_builds(Map *m) {</code> |
| `dir_purpose` | function | 778 | <code>static char *dir_purpose(Map *m, const char *dir) {</code> |
| `dir_get` | function | 810 | <code>static CmDir *dir_get(Map *m, const char *path, int depth) {</code> |
| `dir_cmp` | function | 819 | <code>static int dir_cmp(const void *a, const void *b) {</code> |
| `load_layout` | function | 823 | <code>static void load_layout(Map *m) {</code> |
| `LN` | typedef | 825 | <code>typedef struct { char lang[32]; long n; } LN;</code> |
| `dir_listed` | function | 919 | <code>static bool dir_listed(const Map *m, const CmDir *d) {</code> |
| `word_ok` | function | 932 | <code>static bool word_ok(const char *s, int n) {</code> |
| `cmd_push` | function | 941 | <code>static void cmd_push(StrBuf *b, int *n, char seen[][48], const char *s, int len) {</code> |
| `scan_commands` | function | 954 | <code>static int scan_commands(const char *body, StrBuf *b) {</code> |
| `load_entries` | function | 1000 | <code>static void load_entries(Map *m) {</code> |
| `modfile_cmp` | function | 1097 | <code>static int modfile_cmp(const void *a, const void *b) {</code> |
| `mod_cmp` | function | 1104 | <code>static int mod_cmp(const void *a, const void *b) {</code> |
| `mod_lookup` | function | 1111 | <code>static CmMod *mod_lookup(Map *m, const char *path) {</code> |
| `load_modules` | function | 1117 | <code>static void load_modules(Map *m) {</code> |
| `LN` | typedef | 1139 | <code>typedef struct { char lang[32]; long n; } LN;</code> |
| `dep_get` | function | 1235 | <code>static CmDep *dep_get(Map *m, const char *a, const char *b) {</code> |
| `dep_cmp` | function | 1245 | <code>static int dep_cmp(const void *a, const void *b) {</code> |
| `load_deps` | function | 1253 | <code>static void load_deps(Map *m) {</code> |
| `script_purpose` | function | 1283 | <code>static char *script_purpose(Map *m, const char *path) {</code> |
| `tdir_lookup` | function | 1305 | <code>static CmTestDir *tdir_lookup(Map *m, const char *path) {</code> |
| `fixture_root` | function | 1312 | <code>static void fixture_root(const char *path, char *out, size_t cap) {</code> |
| `tfile_cmp` | function | 1325 | <code>static int tfile_cmp(const void *a, const void *b) {</code> |
| `tdir_cmp` | function | 1331 | <code>static int tdir_cmp(const void *a, const void *b) {</code> |
| `load_tests` | function | 1335 | <code>static void load_tests(Map *m) {</code> |
| `add_ptr` | function | 1447 | <code>static void add_ptr(Map *m, const char *path, const char *what) {</code> |
| `load_pointers` | function | 1454 | <code>static void load_pointers(Map *m) {</code> |
| `kept` | function | 1555 | <code>static bool kept(const Cut *c) { return !c-&gt;drop; }</code> |
| `md_section_omitted` | function | 1557 | <code>static void md_section_omitted(StrBuf *b, const char *what) {</code> |
| `omit_add` | function | 1561 | <code>static void omit_add(StrBuf *o, long n, const char *one, const char *many) {</code> |
| `render_md` | function | 1568 | <code>static void render_md(Map *m, StrBuf *b) {</code> |
| `js_str_or_null` | function | 1860 | <code>static void js_str_or_null(StrBuf *b, const char *s) {</code> |
| `render_json` | function | 1864 | <code>static void render_json(Map *m, StrBuf *b, long md_len) {</code> |
| `cut_cmp` | function | 2115 | <code>static int cut_cmp(const void *a, const void *b) {</code> |
| `md_len_dropping` | function | 2122 | <code>static size_t md_len_dropping(Map *m, int k) {</code> |
| `collect_cuts` | function | 2131 | <code>static void collect_cuts(Map *m) {</code> |
| `fit` | function | 2162 | <code>static int fit(Map *m, size_t cap) {</code> |
| `map_free` | function | 2175 | <code>static void map_free(Map *m) {</code> |
| `codemap_render` | function | 2228 | <code>int codemap_render(Cg *cg, int budget, bool json, const char *self_rel,</code> |
| `marker_budget` | function | 2270 | <code>static int marker_budget(const char *body) {</code> |
| `out_rel` | function | 2281 | <code>static void out_rel(const Cg *cg, const char *abs, char *rel, size_t cap) {</code> |
| `codemap_status` | function | 2289 | <code>int codemap_status(Cg *cg, char *rel, size_t cap) {</code> |
| `cmd_codemap` | function | 2305 | <code>int cmd_codemap(Cg *cg, const CodemapOpts *o) {</code> |

## src/config.c

[Open source](../src/config.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CfgType` | typedef | 32 | <code>typedef enum { CFG_BOOL, CFG_PATH, CFG_INT } CfgType;</code> |
| `CfgIssue` | typedef | 72 | <code>typedef struct {</code> |
| `CfgIssues` | typedef | 79 | <code>typedef struct { CfgIssue *v; int n, cap; } CfgIssues;</code> |
| `cfg_issue` | function | 81 | <code>static void cfg_issue(CfgIssues *is, const char *kind, const char *section,</code> |
| `cfg_issue` | function | 85 | <code>static void cfg_issue(CfgIssues *is, const char *kind, const char *section,</code> |
| `cfg_index` | function | 103 | <code>static int cfg_index(const char *section, const char *key) {</code> |
| `cfg_index_dotted` | function | 112 | <code>static int cfg_index_dotted(const char *dotted) {</code> |
| `cfg_known_section` | function | 120 | <code>static bool cfg_known_section(const char *section) {</code> |
| `cfg_parse_bool` | function | 127 | <code>static int cfg_parse_bool(const char *v) {</code> |
| `config_parse_workers` | function | 135 | <code>int config_parse_workers(const char *v) {</code> |
| `cfg_path_check` | function | 151 | <code>static const char *cfg_path_check(const char *v, char *out, size_t cap) {</code> |
| `cfg_slot` | function | 183 | <code>static char *cfg_slot(CgConfig *c, int i) {</code> |
| `cfg_defaults` | function | 193 | <code>static void cfg_defaults(CgConfig *c, const char *root) {</code> |
| `cfg_read` | function | 205 | <code>static void cfg_read(const char *root, CgConfig *c, CfgIssues *is) {</code> |
| `CfgNode` | struct | 282 | <code>typedef struct CfgNode { CgConfig c; struct CfgNode *next; } CfgNode;</code> |
| `config_load` | function | 287 | <code>const CgConfig *config_load(const char *root) {</code> |
| `config_auto_sync` | function | 317 | <code>bool config_auto_sync(const char *root) { return config_load(root)-&gt;sync_auto; }</code> |
| `config_spec_rel` | function | 318 | <code>const char *config_spec_rel(const char *root) {</code> |
| `config_context_rel` | function | 321 | <code>const char *config_context_rel(const char *root) {</code> |
| `config_skills_rel` | function | 324 | <code>const char *config_skills_rel(const char *root) {</code> |
| `config_codemap_rel` | function | 327 | <code>const char *config_codemap_rel(const char *root) {</code> |
| `config_index_workers` | function | 330 | <code>int config_index_workers(const char *root) {</code> |
| `config_spec_dir` | function | 334 | <code>bool config_spec_dir(const char *root, char *out, size_t cap) {</code> |
| `config_workflow_path` | function | 338 | <code>bool config_workflow_path(const char *root, char *out, size_t cap) {</code> |
| `config_feature_path` | function | 343 | <code>bool config_feature_path(const char *root, const char *feature, char *out,</code> |
| `config_context_dir` | function | 349 | <code>bool config_context_dir(const char *root, char *out, size_t cap) {</code> |
| `config_context_path` | function | 353 | <code>bool config_context_path(const char *root, const char *name, char *out,</code> |
| `config_skills_dir` | function | 359 | <code>bool config_skills_dir(const char *root, char *out, size_t cap) {</code> |
| `config_codemap_path` | function | 363 | <code>bool config_codemap_path(const char *root, char *out, size_t cap) {</code> |
| `config_in_spec` | function | 367 | <code>bool config_in_spec(const char *root, const char *rel) {</code> |
| `config_find_spec_root` | function | 373 | <code>int config_find_spec_root(const char *start, char *out, size_t cap) {</code> |
| `cfg_issues_json` | function | 392 | <code>static void cfg_issues_json(const CgConfig *c, const CfgIssues *is,</code> |
| `config_check` | function | 415 | <code>int config_check(const char *root, StrBuf *text, StrBuf *json) {</code> |
| `cfg_core_warning` | function | 431 | <code>static void cfg_core_warning(const char *root, char *out, size_t cap) {</code> |
| `cfg_root` | function | 450 | <code>static void cfg_root(char *out, size_t cap) {</code> |
| `cfg_value` | function | 461 | <code>static const char *cfg_value(const CgConfig *c, int i) {</code> |
| `cfg_setting_json` | function | 472 | <code>static void cfg_setting_json(const CgConfig *c, int i, StrBuf *b) {</code> |
| `cfg_list` | function | 491 | <code>static int cfg_list(const char *root, bool json) {</code> |
| `cfg_init` | function | 528 | <code>static int cfg_init(const char *root) {</code> |
| `cfg_get` | function | 545 | <code>static int cfg_get(const char *root, const char *dotted, bool json) {</code> |
| `cfg_set` | function | 565 | <code>static int cfg_set(const char *root, const char *dotted, const char *value) {</code> |
| `cmd_config` | function | 624 | <code>int cmd_config(int argc, char **argv, bool json) {</code> |

## src/db.c

[Open source](../src/db.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SCHEMA_VERSION` | macro | 204 | <code>#define SCHEMA_VERSION "17"</code> |
| `path_exists` | function | 208 | <code>static bool path_exists(const char *base, const char *name) {</code> |
| `is_project_dir` | function | 215 | <code>static bool is_project_dir(const char *base) {</code> |
| `cg_is_boundary` | function | 225 | <code>bool cg_is_boundary(const char *dir) {</code> |
| `git_file_at` | function | 237 | <code>static bool git_file_at(const char *dir) {</code> |
| `cg_find_project_at` | function | 244 | <code>int cg_find_project_at(const char *start, char *root, char *shared,</code> |
| `cg_find_root_at` | function | 293 | <code>int cg_find_root_at(const char *start, char *out, size_t cap) {</code> |
| `cg_find_root` | function | 298 | <code>int cg_find_root(char *out, size_t cap) {</code> |
| `cg_bkey` | function | 304 | <code>void cg_bkey(const Cg *cg, const char *name, char *out, size_t cap) {</code> |
| `cmd_root` | function | 310 | <code>int cmd_root(bool json) {</code> |
| `cg_open` | function | 341 | <code>int cg_open(Cg *cg, bool create) {</code> |
| `cg_schema_upgrade` | function | 409 | <code>int cg_schema_upgrade(Cg *cg) {</code> |
| `cg_close` | function | 479 | <code>void cg_close(Cg *cg) {</code> |
| `cg_prep` | function | 484 | <code>sqlite3_stmt *cg_prep(Cg *cg, const char *sql) {</code> |
| `busy_rc` | function | 493 | <code>static bool busy_rc(int rc) {</code> |
| `cg_busy_why` | function | 500 | <code>void cg_busy_why(const char *why) { g_busy_why = why; }</code> |
| `cg_busy_report` | function | 506 | <code>void cg_busy_report(const char *what) {</code> |
| `cg_lock_wait_default` | function | 522 | <code>long cg_lock_wait_default(void) {</code> |
| `cg_begin_write` | function | 528 | <code>int cg_begin_write(Cg *cg) {</code> |
| `cg_exec` | function | 549 | <code>void cg_exec(Cg *cg, const char *sql) {</code> |
| `cg_meta_set` | function | 563 | <code>void cg_meta_set(Cg *cg, const char *k, const char *v) {</code> |
| `cg_meta_get` | function | 573 | <code>char *cg_meta_get(Cg *cg, const char *k) {</code> |

## src/docs.c

[Open source](../src/docs.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DOCS_EVIDENCE_CAP` | macro | 13 | <code>#define DOCS_EVIDENCE_CAP 16000</code> |
| `DOCS_INVENTORY_CAP` | macro | 14 | <code>#define DOCS_INVENTORY_CAP 256</code> |
| `DocsProject` | typedef | 19 | <code>typedef struct {</code> |
| `docs_str` | function | 36 | <code>static char *docs_str(const Kvx *k, const char *sec, const char *key,</code> |
| `docs_free_list` | function | 42 | <code>static void docs_free_list(char **v, int n) {</code> |
| `docs_project_close` | function | 47 | <code>static void docs_project_close(DocsProject *p) {</code> |
| `docs_defaults` | function | 56 | <code>static int docs_defaults(char ***out, const char **items, int n) {</code> |
| `docs_tasks_qualified` | function | 63 | <code>static bool docs_tasks_qualified(const Kvx *spec) {</code> |
| `docs_project_open` | function | 83 | <code>static int docs_project_open(Cg *cg, DocsProject *p) {</code> |
| `docs_suffix` | function | 153 | <code>static bool docs_suffix(const char *name) {</code> |
| `docs_inventory_walk` | function | 159 | <code>static void docs_inventory_walk(const char *root, const char *rel, int depth,</code> |
| `docs_inventory` | function | 196 | <code>static int docs_inventory(const DocsProject *p, StrBuf *text, StrBuf *json) {</code> |
| `docs_targets_json` | function | 209 | <code>static void docs_targets_json(const DocsProject *p, StrBuf *b) {</code> |
| `docs_target_match` | function | 224 | <code>static bool docs_target_match(const DocsProject *p, const char *path) {</code> |
| `docs_regular` | function | 235 | <code>static bool docs_regular(const DocsProject *p, const char *rel) {</code> |
| `docs_string_in_file` | function | 248 | <code>static bool docs_string_in_file(const DocsProject *p, const char *rel,</code> |
| `docs_symbol_exists` | function | 259 | <code>static bool docs_symbol_exists(Cg *cg, const char *name, const char *path) {</code> |
| `docs_route_exists` | function | 270 | <code>static bool docs_route_exists(Cg *cg, const char *value, const char *path) {</code> |
| `docs_claims_template` | function | 298 | <code>static int docs_claims_template(DocsProject *p, const char *path) {</code> |
| `docs_plan` | function | 412 | <code>static int docs_plan(Cg *cg, bool json) {</code> |
| `DocsSpecCall` | typedef | 449 | <code>typedef struct { int argc; char **argv; bool json; } DocsSpecCall;</code> |
| `docs_call_spec` | function | 450 | <code>static int docs_call_spec(void *v) {</code> |
| `DocsCall` | typedef | 463 | <code>typedef struct { Cg *cg; int which; const char *feature; } DocsCall;</code> |
| `docs_call_evidence` | function | 464 | <code>static int docs_call_evidence(void *v) {</code> |
| `docs_append_capture` | function | 477 | <code>static void docs_append_capture(StrBuf *packet, StrBuf *ledger,</code> |
| `docs_packet` | function | 506 | <code>static int docs_packet(Cg *cg, bool json) {</code> |
| `DocsCheck` | typedef | 638 | <code>typedef struct { int errors; int checks; StrBuf report; } DocsCheck;</code> |
| `docs_check_say` | function | 640 | <code>static void docs_check_say(DocsCheck *c, bool ok, const char *fmt, ...) {</code> |
| `docs_allowed_system_path` | function | 653 | <code>static bool docs_allowed_system_path(const DocsProject *p, const char *path) {</code> |
| `docs_check_links` | function | 663 | <code>static int docs_check_links(const DocsProject *p, const char *doc,</code> |
| `docs_claim_evidence` | function | 712 | <code>static bool docs_claim_evidence(const DocsProject *p, const char *evidence,</code> |
| `docs_check_claims` | function | 724 | <code>static int docs_check_claims(DocsProject *p, DocsCheck *c) {</code> |
| `docs_check` | function | 817 | <code>static int docs_check(Cg *cg, bool json) {</code> |
| `docs_trace` | function | 883 | <code>static int docs_trace(Cg *cg, bool json) {</code> |
| `docs_call_check` | function | 944 | <code>static int docs_call_check(void *v) { return docs_check((Cg *)v, false); }</code> |
| `docs_call_finish` | function | 945 | <code>static int docs_call_finish(void *v) {</code> |
| `docs_close` | function | 950 | <code>static int docs_close(Cg *cg, bool json) {</code> |
| `cmd_docs` | function | 992 | <code>int cmd_docs(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/drift.c

[Open source](../src/drift.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Hunk` | typedef | 18 | <code>typedef struct { int from, to; } Hunk;</code> |
| `FileDiff` | typedef | 19 | <code>typedef struct { char *path; Hunk *h; int nh, ch; } FileDiff;</code> |
| `list_free` | function | 21 | <code>static void list_free(char **v, int n) {</code> |
| `packet_strings` | function | 26 | <code>static int packet_strings(const char *packet, const char *key, char ***out) {</code> |
| `fd_get` | function | 41 | <code>static FileDiff *fd_get(FileDiff **v, int *n, int *cap, const char *path) {</code> |
| `fd_hunk` | function | 53 | <code>static void fd_hunk(FileDiff *f, int from, int to) {</code> |
| `drift_diff` | function | 65 | <code>static int drift_diff(const char *tree, const char *base, const char *head,</code> |
| `drift_exempt` | function | 133 | <code>static bool drift_exempt(const char *tree, const char *path) {</code> |
| `drift_in_touches` | function | 144 | <code>static bool drift_in_touches(const char *path, char **touches, int nt) {</code> |
| `drift_public` | function | 153 | <code>static bool drift_public(const char *path, const char *name, const char *kind,</code> |
| `drift_spec_check` | function | 172 | <code>int drift_spec_check(Cg *cg, const char *tree, const char *base,</code> |
| `drift_print` | function | 254 | <code>void drift_print(const char *report_json) {</code> |
| `drift_collision_predict` | function | 286 | <code>bool drift_collision_predict(Cg *cg, const char *feature, const char *a,</code> |
| `drift_active_feature` | function | 328 | <code>static char *drift_active_feature(Cg *cg) {</code> |
| `drift_open_tasks` | function | 338 | <code>static int drift_open_tasks(Cg *cg, const char *feature, char ***out) {</code> |
| `cmd_drift` | function | 361 | <code>int cmd_drift(Cg *cg, int argc, char **argv, bool json) {</code> |
| `blob_defs` | function | 457 | <code>static int blob_defs(const char *tree, const char *rev, const char *path,</code> |
| `def_named` | function | 486 | <code>static const SymDef *def_named(const ParseResult *pr, const char *name) {</code> |
| `drift_ref_sites` | function | 496 | <code>static int drift_ref_sites(Cg *cg, const char *name, long skip_branch,</code> |
| `drift_interface_check` | function | 538 | <code>int drift_interface_check(Cg *cg, const char *tree, const char *base_branch,</code> |
| `coverage_check` | function | 629 | <code>int coverage_check(Cg *cg, const char *feature, StrBuf *out) {</code> |
| `coverage_print` | function | 700 | <code>void coverage_print(const char *report_json, const char *feature) {</code> |
| `drift_summary` | function | 720 | <code>int drift_summary(Cg *cg, const char *feature, StrBuf *text, StrBuf *json) {</code> |

## src/drivers.c

[Open source](../src/drivers.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `split_into` | function | 29 | <code>static int split_into(const char *s, char **av, int n, int cap) {</code> |
| `subst` | function | 46 | <code>static char *subst(const char *tmpl, const DriverSpec *d, const char *pf,</code> |
| `driver_argv` | function | 74 | <code>int driver_argv(const DriverSpec *d, const char *root, const char *promptfile,</code> |
| `raw_num` | function | 116 | <code>static double raw_num(const char *obj, const char *key, double dflt) {</code> |
| `raw_true` | function | 123 | <code>static bool raw_true(const char *obj, const char *key) {</code> |
| `tool_detail` | function | 132 | <code>static char *tool_detail(const char *input) {</code> |
| `emit_usage` | function | 142 | <code>static void emit_usage(DriverEventFn fn, void *ud, const char *usage,</code> |
| `parse_claude` | function | 157 | <code>static int parse_claude(const char *line, const char *type, DriverEventFn fn,</code> |
| `parse_codex` | function | 225 | <code>static int parse_codex(const char *line, const char *type, DriverEventFn fn,</code> |
| `driver_stream_parse` | function | 288 | <code>int driver_stream_parse(const char *line, DriverEventFn fn, void *ud) {</code> |
| `wall_ms` | function | 302 | <code>static long wall_ms(void) {</code> |
| `driver_tap_init` | function | 308 | <code>void driver_tap_init(DriverTap *t, const char *log, const char *agent,</code> |
| `driver_tap_free` | function | 319 | <code>void driver_tap_free(DriverTap *t) {</code> |
| `TAP_TEXT_MAX` | macro | 323 | <code>#define TAP_TEXT_MAX 600</code> |
| `TapCtx` | typedef | 325 | <code>typedef struct { DriverTap *t; StrBuf *batch; int n; } TapCtx;</code> |
| `clip` | function | 327 | <code>static void clip(StrBuf *b, const char *key, const char *v) {</code> |
| `tap_on` | function | 343 | <code>static void tap_on(const DriverEvent *e, void *ud) {</code> |
| `driver_tap_poll` | function | 401 | <code>int driver_tap_poll(DriverTap *t) {</code> |
| `driver_steer` | function | 448 | <code>long driver_steer(Cg *cg, const char *agent, const char *message) {</code> |
| `SteerAcc` | typedef | 461 | <code>typedef struct { StrBuf *b; long last; int n; } SteerAcc;</code> |
| `steer_add` | function | 463 | <code>static int steer_add(const EventRow *e, void *ud) {</code> |
| `driver_steer_take` | function | 477 | <code>char *driver_steer_take(Cg *cg, const char *agent, const char *via) {</code> |

## src/events.c

[Open source](../src/events.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EVENTS_KEEP_DFLT` | macro | 22 | <code>#define EVENTS_KEEP_DFLT 50000</code> |
| `EVENTS_PRUNE_EVERY` | macro | 23 | <code>#define EVENTS_PRUNE_EVERY 512</code> |
| `EV_NOW` | macro | 26 | <code>#define EV_NOW "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"</code> |
| `events_install` | function | 81 | <code>int events_install(Cg *cg) {</code> |
| `now_ms_wall` | function | 88 | <code>static long now_ms_wall(void) {</code> |
| `bind_or_null` | function | 94 | <code>static void bind_or_null(sqlite3_stmt *st, int i, const char *v) {</code> |
| `events_prune` | function | 101 | <code>static void events_prune(Cg *cg, long seq) {</code> |
| `events_emit` | function | 116 | <code>long events_emit(Cg *cg, const char *kind, const char *subject,</code> |
| `events_insert` | function | 121 | <code>static long events_insert(Cg *cg, long at_ms, const char *kind,</code> |
| `events_emit_at` | function | 146 | <code>long events_emit_at(Cg *cg, long at_ms, const char *kind, const char *subject,</code> |
| `events_queue` | function | 156 | <code>static long events_queue(Cg *cg, long at, const char *kind,</code> |
| `events_emit_as` | function | 179 | <code>long events_emit_as(Cg *cg, const char *kind, const char *subject,</code> |
| `events_emit_quiet` | function | 207 | <code>long events_emit_quiet(const char *kind, const char *subject,</code> |
| `events_bind` | function | 224 | <code>void events_bind(Cg *cg) { g_bound = cg; }</code> |
| `events_unbind` | function | 225 | <code>void events_unbind(void) { g_bound = NULL; }</code> |
| `feature_of` | function | 230 | <code>static bool feature_of(const char *path, char *out, size_t cap) {</code> |
| `events_kvx_status` | function | 245 | <code>void events_kvx_status(const char *path, const char *section,</code> |
| `events_head` | function | 273 | <code>long events_head(Cg *cg) {</code> |
| `events_pruned_through` | function | 284 | <code>long events_pruned_through(Cg *cg) {</code> |
| `EV_MAX_KINDS` | macro | 291 | <code>#define EV_MAX_KINDS 16</code> |
| `events_since` | function | 295 | <code>long events_since(Cg *cg, long since, const char *kinds, int limit,</code> |
| `events_json` | function | 357 | <code>void events_json(StrBuf *b, const EventRow *e) {</code> |
| `EV_OPT` | macro | 360 | <code>#define EV_OPT(name, v) do { sb_puts(b, ",\"" name "\":"); \</code> |
| `ev_on_signal` | function | 376 | <code>static void ev_on_signal(int sig) { (void)sig; g_ev_stop = 1; }</code> |
| `ev_print` | function | 378 | <code>static int ev_print(const EventRow *e, void *ud) {</code> |
| `EvRing` | typedef | 402 | <code>typedef struct { long *v; long cap; long n; } EvRing;</code> |
| `ev_ring_add` | function | 404 | <code>static int ev_ring_add(const EventRow *e, void *ud) {</code> |
| `cmd_events` | function | 411 | <code>int cmd_events(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/fleet.c

[Open source](../src/fleet.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FleetIdentity` | typedef | 28 | <code>typedef struct {</code> |
| `fleet_identity` | function | 36 | <code>static void fleet_identity(FleetIdentity *id) {</code> |
| `bind_opt` | function | 46 | <code>static void bind_opt(sqlite3_stmt *st, int i, const char *v) {</code> |
| `fleet_identity_record` | function | 56 | <code>int fleet_identity_record(Cg *g) {</code> |
| `role_set` | function | 90 | <code>static void role_set(FleetRole *r, const char *name, const char *title,</code> |
| `hier_defaults` | function | 99 | <code>static void hier_defaults(Hierarchy *h) {</code> |
| `take_str` | function | 117 | <code>static void take_str(char **slot, const Kvx *k, const char *sec,</code> |
| `hier_duration` | function | 125 | <code>long hier_duration(const char *s) {</code> |
| `hier_problem` | function | 142 | <code>static void hier_problem(Hierarchy *h, const char *fmt, const char *role,</code> |
| `cap_raw` | function | 158 | <code>static char *cap_raw(const Kvx *wf, const char *sec, const char *key) {</code> |
| `cap_duration` | function | 171 | <code>static void cap_duration(Hierarchy *h, const Kvx *wf, const char *sec,</code> |
| `cap_count` | function | 183 | <code>static void cap_count(Hierarchy *h, const Kvx *wf, const char *sec,</code> |
| `hier_role_caps` | function | 200 | <code>void hier_role_caps(const Kvx *wf, Hierarchy *h) {</code> |
| `hier_load` | function | 289 | <code>bool hier_load(const Kvx *wf, Hierarchy *h) {</code> |
| `hier_free` | function | 327 | <code>void hier_free(Hierarchy *h) {</code> |
| `hier_expand` | function | 342 | <code>void hier_expand(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `hier_per_task` | function | 347 | <code>bool hier_per_task(const Hierarchy *h) {</code> |
| `hier_expand_task` | function | 355 | <code>void hier_expand_task(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `fleet_workflow` | function | 389 | <code>static Kvx *fleet_workflow(const Cg *cg, char *path, size_t cap) {</code> |
| `role_title` | function | 394 | <code>static const char *role_title(const Hierarchy *h, const char *role) {</code> |
| `ago` | function | 401 | <code>static void ago(long seen, char *out, size_t cap) {</code> |
| `fleet_brief` | function | 411 | <code>void fleet_brief(Cg *cg, StrBuf *b, bool json) {</code> |
| `gate_bit` | function | 446 | <code>static unsigned gate_bit(const char *gate) {</code> |
| `approval_event` | function | 452 | <code>static void approval_event(Cg *cg, const char *kind, long id, const char *gate,</code> |
| `fleet_gate` | function | 474 | <code>int fleet_gate(Cg *cg, const char *gate, const char *subject) {</code> |
| `cmd_fleet_approvals` | function | 544 | <code>int cmd_fleet_approvals(Cg *cg, int argc, char **argv, bool json) {</code> |
| `C` | macro | 609 | <code>#define C(i) ((const char *)sqlite3_column_text(st, i))</code> |
| `fmt_secs` | function | 644 | <code>static void fmt_secs(long s, char *out, size_t cap) {</code> |
| `approvals` | function | 652 | <code>static void approvals(unsigned bits, char *out, size_t cap, const char *sep) {</code> |
| `fleet_roles` | function | 664 | <code>static int fleet_roles(Cg *cg, bool json) {</code> |
| `agent_live_tasks` | function | 770 | <code>static char *agent_live_tasks(Cg *g, const char *agent) {</code> |
| `fleet_status` | function | 786 | <code>static int fleet_status(Cg *cg, bool json) {</code> |
| `PlanTask` | typedef | 907 | <code>typedef struct { char *id, *title, *status; long wave; } PlanTask;</code> |
| `plan_task_cmp` | function | 909 | <code>static int plan_task_cmp(const void *a, const void *b) {</code> |
| `LiveAgent` | typedef | 917 | <code>typedef struct { char *agent; long wave; char *role; } LiveAgent;</code> |
| `live_add` | function | 919 | <code>static void live_add(LiveAgent **v, int *n, int *cap, const char *agent,</code> |
| `live_names` | function | 933 | <code>static void live_names(const LiveAgent *v, int n, const char *role,</code> |
| `fleet_plan` | function | 945 | <code>static int fleet_plan(Cg *cg, const char *feature_ov, bool json) {</code> |
| `Lifecycle` | typedef | 1150 | <code>typedef struct {</code> |
| `lifecycle_close` | function | 1161 | <code>static void lifecycle_close(Lifecycle *c) {</code> |
| `fleet_merge_lock` | function | 1169 | <code>int fleet_merge_lock(const char *shared, const char *feature, long wait_ms) {</code> |
| `fleet_merge_unlock` | function | 1186 | <code>void fleet_merge_unlock(int fd) {</code> |
| `lifecycle_merge_lock` | function | 1193 | <code>static int lifecycle_merge_lock(Lifecycle *c) {</code> |
| `lifecycle_open` | function | 1203 | <code>static int lifecycle_open(Cg *cg, const char *feature_ov, Lifecycle *c) {</code> |
| `worktree_path` | function | 1244 | <code>static void worktree_path(const Lifecycle *c, const char *branch, char *out,</code> |
| `task_wave_status` | function | 1259 | <code>static bool task_wave_status(const char *specpath, const char *id, long *wave,</code> |
| `task_status_on_branch` | function | 1278 | <code>static bool task_status_on_branch(const Lifecycle *c, const char *branch,</code> |
| `tree_clean` | function | 1303 | <code>static bool tree_clean(const char *tree) {</code> |
| `commits_between` | function | 1311 | <code>static long commits_between(const char *tree, const char *base,</code> |
| `ensure_branch` | function | 1328 | <code>static bool ensure_branch(const char *tree, const char *branch,</code> |
| `excerpt` | function | 1344 | <code>static void excerpt(const StrBuf *b, char *out, size_t cap) {</code> |
| `json_str_or_null` | function | 1354 | <code>static void json_str_or_null(StrBuf *b, const char *s) {</code> |
| `put_conflicts` | function | 1358 | <code>static void put_conflicts(StrBuf *b, char **paths, int n, bool json) {</code> |
| `free_list` | function | 1372 | <code>static void free_list(char **v, int n) {</code> |
| `fleet_event` | function | 1378 | <code>static void fleet_event(Cg *cg, const char *kind, const char *subject,</code> |
| `ev_str` | function | 1387 | <code>static void ev_str(StrBuf *b, const char *key, const char *v) {</code> |
| `ev_long` | function | 1392 | <code>static void ev_long(StrBuf *b, const char *key, long v) {</code> |
| `fleet_worker_begin` | function | 1399 | <code>int fleet_worker_begin(Cg *cg, const char *id, const char *feature_ov,</code> |
| `ev_list` | function | 1534 | <code>static void ev_list(StrBuf *b, const char *key, char **v, int n) {</code> |
| `merge_event` | function | 1543 | <code>static void merge_event(Cg *cg, const Lifecycle *c, const char *id,</code> |
| `fleet_merge_up` | function | 1565 | <code>int fleet_merge_up(Cg *cg, const char *id, const char *feature_ov, bool force,</code> |
| `run_gate` | function | 1763 | <code>static int run_gate(const char *tree, const char *cmd, const char *logpath,</code> |
| `pr_open_core` | function | 1790 | <code>static int pr_open_core(Cg *cg, Lifecycle *c, bool dry_run, StrBuf *jb,</code> |
| `pr_event` | function | 1793 | <code>static void pr_event(Cg *cg, const Lifecycle *c, const char *outcome,</code> |
| `land_event` | function | 1805 | <code>static void land_event(Cg *cg, const Lifecycle *c, const char *outcome,</code> |
| `fleet_feature_land` | function | 1823 | <code>int fleet_feature_land(Cg *cg, const char *feature_ov, bool no_pr, bool json) {</code> |
| `find_gh` | function | 2027 | <code>static bool find_gh(char *out, size_t cap) {</code> |
| `run_in` | function | 2033 | <code>static int run_in(const char *tree, const char *cmd, StrBuf *out) {</code> |
| `write_pr_body` | function | 2058 | <code>static void write_pr_body(Cg *cg, const Lifecycle *c, const char *branch,</code> |
| `pr_open_core` | function | 2130 | <code>static int pr_open_core(Cg *cg, Lifecycle *c, bool dry_run, StrBuf *jb,</code> |
| `fleet_pr_open` | function | 2273 | <code>int fleet_pr_open(Cg *cg, const char *feature_ov, bool dry_run, bool json) {</code> |
| `OpenPr` | typedef | 2297 | <code>typedef struct { long number; char *head, *title, *url; } OpenPr;</code> |
| `fleet_checkpoint` | function | 2303 | <code>int fleet_checkpoint(Cg *cg, bool dry_run, bool json) {</code> |
| `cmd_fleet` | function | 2484 | <code>int cmd_fleet(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/gitint.c

[Open source](../src/gitint.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `git_available` | function | 20 | <code>bool git_available(const Cg *cg) {</code> |
| `chomp` | function | 31 | <code>static char *chomp(char *s) {</code> |
| `git_abs` | function | 40 | <code>static bool git_abs(const char *base, const char *p, char *out, size_t cap) {</code> |
| `git_dirs` | function | 54 | <code>static bool git_dirs(const char *tree, char *gitdir, char *common, size_t cap) {</code> |
| `git_worktree_main` | function | 86 | <code>bool git_worktree_main(const char *tree, char *main_out, size_t cap) {</code> |
| `git_ref_sha` | function | 99 | <code>static bool git_ref_sha(const char *common, const char *ref, char *sha,</code> |
| `git_head` | function | 130 | <code>bool git_head(const char *tree, char *branch, size_t bcap, char *sha,</code> |
| `git_run` | function | 155 | <code>int git_run(const char *tree, const char *args, StrBuf *out) {</code> |
| `git_branch_exists` | function | 177 | <code>bool git_branch_exists(const char *tree, const char *branch) {</code> |
| `git_worktree_add` | function | 189 | <code>int git_worktree_add(const char *tree, const char *path, const char *branch,</code> |
| `git_conflicted_paths` | function | 223 | <code>int git_conflicted_paths(const char *tree, char ***out) {</code> |
| `branch_register` | function | 249 | <code>long branch_register(Cg *cg, const char *name, const char *worktree,</code> |
| `cg_branch_resolve` | function | 274 | <code>int cg_branch_resolve(Cg *cg) {</code> |
| `ago` | function | 290 | <code>static void ago(long since, char *out, size_t cap) {</code> |
| `cmd_branches` | function | 301 | <code>int cmd_branches(Cg *cg, int argc, char **argv, bool json) {</code> |
| `git_ingest` | function | 363 | <code>int git_ingest(Cg *cg, int limit, long *ncommits_out, long *npaths_out,</code> |
| `cmd_git_sync` | function | 425 | <code>int cmd_git_sync(Cg *cg, int limit, bool json) {</code> |
| `git_churn_for_path` | function | 449 | <code>int git_churn_for_path(Cg *cg, const char *path) {</code> |
| `git_commit_mirror` | function | 461 | <code>int git_commit_mirror(Cg *cg, const char *message) {</code> |

## src/govern.c

[Open source](../src/govern.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `run_capture` | function | 22 | <code>static int run_capture(char **out, int (*fn)(void *), void *ctx) {</code> |
| `SpecCall` | typedef | 26 | <code>typedef struct { int argc; char **argv; bool json; } SpecCall;</code> |
| `call_spec` | function | 28 | <code>static int call_spec(void *v) {</code> |
| `spec_sub` | function | 41 | <code>static int spec_sub(char **out, bool json, int argc, ...) {</code> |
| `has_spec_repo` | function | 51 | <code>static bool has_spec_repo(const char *root) {</code> |
| `lease_touches_overlap` | function | 60 | <code>static bool lease_touches_overlap(const char *a, const char *b) {</code> |
| `cmd_check` | function | 78 | <code>int cmd_check(Cg *cg, bool json, bool strict)</code> |
| `active_task_json` | function | 313 | <code>static char *active_task_json(bool *is_current) {</code> |
| `brief_cap_body` | function | 327 | <code>static void brief_cap_body(Memory *m) {</code> |
| `brief_memories` | function | 341 | <code>static int brief_memories(Cg *cg, const char *task_json, Memory **out) {</code> |
| `brief_branches` | function | 387 | <code>static void brief_branches(Cg *cg, StrBuf *b, bool json) {</code> |
| `brief_feature` | function | 446 | <code>static char *brief_feature(Cg *cg, const char *task_json) {</code> |
| `cmd_brief` | function | 459 | <code>int cmd_brief(Cg *cg, bool json)</code> |
| `path_in_scope` | function | 590 | <code>static bool path_in_scope(const char *task_json, const char *path) {</code> |
| `GuardStale` | typedef | 621 | <code>typedef struct {</code> |
| `guard_stale_cb` | function | 629 | <code>static void guard_stale_cb(void *u, const char *path, int line,</code> |
| `guard_collect` | function | 652 | <code>static void guard_collect(JevFinding **v, int *n, int *cap, const char *kind,</code> |
| `cmd_guard` | function | 667 | <code>int cmd_guard(Cg *cg, int npath, char **pathv, bool json, bool strict)</code> |
| `cmd_review` | function | 819 | <code>int cmd_review(Cg *cg, bool json)</code> |
| `cmd_hook_install_git` | function | 990 | <code>static int cmd_hook_install_git(Cg *cg, const char *bin);</code> |
| `write_exec` | function | 992 | <code>static int write_exec(const char *path, const char *body) {</code> |
| `cmd_hook_install` | function | 1015 | <code>int cmd_hook_install(Cg *cg)</code> |
| `cmd_hook_install_git` | function | 1053 | <code>static int cmd_hook_install_git(Cg *cg, const char *bin)</code> |
| `hook_read_stdin` | function | 1103 | <code>static char *hook_read_stdin(void) {</code> |
| `hook_edited_path` | function | 1116 | <code>static char *hook_edited_path(const char *payload) {</code> |
| `HookGuard` | typedef | 1127 | <code>typedef struct { Cg *cg; char *path; bool json; } HookGuard;</code> |
| `hook_guard_call` | function | 1129 | <code>static int hook_guard_call(void *u) {</code> |
| `HOOK_MAX_LINES` | macro | 1135 | <code>#define HOOK_MAX_LINES 24</code> |
| `cmd_hook_post_edit` | function | 1144 | <code>int cmd_hook_post_edit(Cg *cg, const SysInfo *si, bool json) {</code> |
| `handoff_field` | function | 1231 | <code>static char *handoff_field(const char *body, const char *key) {</code> |
| `handoff_live_id` | function | 1252 | <code>static long handoff_live_id(Cg *cg, const char *tag) {</code> |
| `handoff_store` | function | 1266 | <code>static long handoff_store(Cg *cg, const char *tag, const char *body,</code> |
| `handoff_files` | function | 1278 | <code>static char *handoff_files(Cg *cg, int cap, int *count) {</code> |
| `cmd_handoff` | function | 1295 | <code>int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,</code> |
| `resume_json_field` | function | 1385 | <code>static void resume_json_field(StrBuf *b, const char *name, const char *v) {</code> |
| `cmd_resume` | function | 1396 | <code>int cmd_resume(Cg *cg, const char *task, bool json, bool prompt)</code> |
| `WorkCapture` | typedef | 1602 | <code>typedef struct { Cg *cg; const char *query; } WorkCapture;</code> |
| `work_call_state` | function | 1603 | <code>static int work_call_state(void *v) {</code> |
| `work_call_progress` | function | 1606 | <code>static int work_call_progress(void *v) {</code> |
| `work_call_context` | function | 1609 | <code>static int work_call_context(void *v) {</code> |
| `work_call_tests` | function | 1613 | <code>static int work_call_tests(void *v) {</code> |
| `work_raw_json` | function | 1618 | <code>static void work_raw_json(StrBuf *b, const char *raw) {</code> |
| `work_last_event` | function | 1627 | <code>static long work_last_event(Cg *cg, const char *task) {</code> |
| `work_event_json` | function | 1637 | <code>static void work_event_json(Cg *cg, StrBuf *b, const char *task, long after,</code> |
| `work_memories_json` | function | 1675 | <code>static void work_memories_json(Cg *cg, StrBuf *b, const char *task) {</code> |
| `work_revision_store` | function | 1692 | <code>static void work_revision_store(Cg *cg, const char *revision, long created,</code> |
| `work_revision_create` | function | 1736 | <code>static bool work_revision_create(Cg *cg, const char *task, long event_id,</code> |
| `work_open` | function | 1784 | <code>int work_open(Cg *cg, const char *task, bool json) {</code> |
| `work_workspace_delta` | function | 1851 | <code>static void work_workspace_delta(Cg *cg, StrBuf *b, const char *revision,</code> |
| `packet_list` | function | 1875 | <code>static int packet_list(const char *packet, const char *key, char ***out);</code> |
| `list_free` | function | 1876 | <code>static void list_free(char **v, int n);</code> |
| `packet_scope` | function | 1877 | <code>static long packet_scope(Cg *cg);</code> |
| `work_upstream_delta` | function | 1882 | <code>static int work_upstream_delta(Cg *cg, const char *task, long since_s,</code> |
| `work_update` | function | 1955 | <code>int work_update(Cg *cg, const char *revision, bool json) {</code> |
| `work_supplied_evidence` | function | 2045 | <code>static const char *work_supplied_evidence(const char *clause, int n,</code> |
| `work_recorded_evidence` | function | 2054 | <code>static char *work_recorded_evidence(Cg *cg, const char *task,</code> |
| `work_close` | function | 2093 | <code>int work_close(Cg *cg, const char *requested, int nevidence, char **evidence,</code> |
| `govern_journal_apply` | function | 2195 | <code>int govern_journal_apply(Cg *cg, const char *op, const char *args,</code> |
| `cmd_work` | function | 2262 | <code>int cmd_work(Cg *cg, int argc, char **argv, bool json) {</code> |
| `packet_list` | function | 2284 | <code>static int packet_list(const char *packet, const char *key, char ***out) {</code> |
| `list_free` | function | 2299 | <code>static void list_free(char **v, int n) {</code> |
| `packet_scope` | function | 2307 | <code>static long packet_scope(Cg *cg) {</code> |
| `packet_upstream_evidence` | function | 2320 | <code>int packet_upstream_evidence(Cg *cg, const char *feature, const char *req,</code> |
| `PacketPart` | typedef | 2361 | <code>typedef struct { const char *name; StrBuf b; bool must; } PacketPart;</code> |
| `packet_assemble` | function | 2366 | <code>static int packet_assemble(PacketPart *parts, int n, int budget, StrBuf *out) {</code> |
| `task_packet_build` | function | 2395 | <code>int task_packet_build(Cg *cg, const char *tag, int budget, StrBuf *out) {</code> |
| `manager_packet_build` | function | 2550 | <code>int manager_packet_build(Cg *cg, const char *feature, int budget, StrBuf *out) {</code> |

## src/graph.c

[Open source](../src/graph.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fts_quote` | function | 12 | <code>static char *fts_quote(const char *q) {          /* "..." literal, "" escaped */</code> |
| `fts_words` | function | 23 | <code>static char *fts_words(const char *q) {          /* tok* tok* for unicode61 */</code> |
| `scope_id` | function | 46 | <code>static long scope_id(const Cg *cg) {</code> |
| `branch_scope_sql` | function | 52 | <code>const char *branch_scope_sql(const Cg *cg, const char *alias, char *out,</code> |
| `cg_scope_set` | function | 63 | <code>int cg_scope_set(Cg *cg, const char *name, bool all) {</code> |
| `branch_hit_label` | function | 76 | <code>const char *branch_hit_label(Cg *cg, long branch_id, char *out, size_t cap) {</code> |
| `branch_tree` | function | 89 | <code>const char *branch_tree(Cg *cg, long branch_id, char *out, size_t cap) {</code> |
| `prep_scoped` | function | 106 | <code>static sqlite3_stmt *prep_scoped(Cg *cg, const char *head, const char *tail) {</code> |
| `file_snippet_n` | function | 115 | <code>static char *file_snippet_n(Cg *cg, long branch_id, const char *rel, int from,</code> |
| `file_snippet` | function | 146 | <code>static char *file_snippet(Cg *cg, long branch_id, const char *rel, int from,</code> |
| `SymRow` | typedef | 151 | <code>typedef struct {</code> |
| `sym_from_stmt_at` | function | 160 | <code>static int sym_from_stmt_at(sqlite3_stmt *st, int off, SymRow *r) {</code> |
| `sym_from_stmt` | function | 178 | <code>static int sym_from_stmt(sqlite3_stmt *st, SymRow *r) {</code> |
| `SYM_COLS` | macro | 186 | <code>#define SYM_COLS \</code> |
| `ci_has` | function | 192 | <code>static bool ci_has(const char *hay, const char *needle) {</code> |
| `doc_derivable` | function | 202 | <code>static bool doc_derivable(const char *doc, const char *name, const char *sig) {</code> |
| `DOC_MAX_BYTES` | macro | 219 | <code>#define DOC_MAX_BYTES 700    /* per-symbol share: ~10 lines of prose */</code> |
| `SymDoc` | typedef | 221 | <code>typedef struct { char *body; bool stale, cut; } SymDoc;</code> |
| `body_first` | function | 225 | <code>static bool body_first(void) {</code> |
| `doc_take` | function | 235 | <code>static void doc_take(SymDoc *d, const char *body, bool stale) {</code> |
| `symbol_doc_rows` | function | 254 | <code>static void symbol_doc_rows(Cg *cg, const SymRow *r, const SymRow *own,</code> |
| `symbol_doc` | function | 296 | <code>static bool symbol_doc(Cg *cg, const SymRow *r, SymDoc *d) {</code> |
| `doc_render` | function | 318 | <code>static void doc_render(StrBuf *b, const SymDoc *d) {</code> |
| `anchor_stale` | function | 338 | <code>int anchor_stale(Cg *cg,</code> |
| `doc_json` | function | 393 | <code>static void doc_json(StrBuf *b, const SymDoc *d) {</code> |
| `defs_named` | function | 401 | <code>static int defs_named(Cg *cg, const char *name, SymRow *out, int cap) {</code> |
| `find_symbols` | function | 417 | <code>static int find_symbols(Cg *cg, const char *q, SymRow *out, int cap) {</code> |
| `find_symbols_all` | function | 456 | <code>static int find_symbols_all(Cg *cg, const char *q, SymRow *out, int cap) {</code> |
| `RESOLVE_MAX_DEFS` | macro | 495 | <code>#define RESOLVE_MAX_DEFS 64</code> |
| `rank_path_penalized` | function | 499 | <code>static bool rank_path_penalized(const char *path) {</code> |
| `path_depth` | function | 520 | <code>static int path_depth(const char *p) {</code> |
| `module_matches` | function | 532 | <code>static bool module_matches(const char *module, const char *cand_path) {</code> |
| `resolve_best` | function | 571 | <code>static int resolve_best(Cg *cg, long from_fid, const char *from_path,</code> |
| `callers_of` | function | 625 | <code>static int callers_of(Cg *cg, const SymRow *def, SymRow *out, int cap) {</code> |
| `sym_path_line_cmp` | function | 683 | <code>static int sym_path_line_cmp(const void *a, const void *b) {</code> |
| `callees_of` | function | 694 | <code>static int callees_of(Cg *cg, long sym_id, SymRow *out, int cap) {</code> |
| `ref_count` | function | 774 | <code>static int ref_count(Cg *cg, const char *name) {</code> |
| `ref_count_resolved` | function | 788 | <code>static int ref_count_resolved(Cg *cg, const SymRow *def) {</code> |
| `MAX_TERMS` | macro | 830 | <code>#define MAX_TERMS 8</code> |
| `Terms` | typedef | 831 | <code>typedef struct { char t[MAX_TERMS][64]; int n; } Terms;</code> |
| `query_terms` | function | 836 | <code>static void query_terms(const char *q, Terms *T) {</code> |
| `term_hits` | function | 864 | <code>static bool term_hits(const char *t, const char *w, size_t wn) {</code> |
| `words_mask` | function | 872 | <code>static unsigned words_mask(const char *words, const Terms *T) {</code> |
| `text_mask` | function | 886 | <code>static unsigned text_mask(const char *text, size_t len, const Terms *T) {</code> |
| `popcount` | function | 902 | <code>static int popcount(unsigned m) {</code> |
| `Hit` | typedef | 910 | <code>typedef struct {</code> |
| `RANK_CAP` | macro | 917 | <code>#define RANK_CAP 256</code> |
| `hit_get` | function | 919 | <code>static Hit *hit_get(Hit *h, int *nh, const SymRow *r, bool add) {</code> |
| `hit_cmp` | function | 929 | <code>static int hit_cmp(const void *a, const void *b) {</code> |
| `FileHit` | typedef | 941 | <code>typedef struct {</code> |
| `FILE_SCAN` | macro | 950 | <code>#define FILE_SCAN 16</code> |
| `filehit_cmp` | function | 952 | <code>static int filehit_cmp(const void *a, const void *b) {</code> |
| `filehits_free` | function | 960 | <code>static void filehits_free(FileHit *f, int n) {</code> |
| `fts_terms` | function | 966 | <code>static char *fts_terms(const Terms *T, bool any) {</code> |
| `rank_bodies` | function | 980 | <code>static void rank_bodies(Cg *cg, const Terms *T, Hit *h, int *nh,</code> |
| `rank_query` | function | 1091 | <code>static int rank_query(Cg *cg, const char *q, SymRow *out, int cap,</code> |
| `ep_interesting` | function | 1255 | <code>static bool ep_interesting(const SymRow *r) {</code> |
| `ep_push` | function | 1264 | <code>static bool ep_push(SymRow *out, int *n, int cap, const SymRow *r) {</code> |
| `ep_climb` | function | 1273 | <code>static void ep_climb(Cg *cg, const SymRow *from, SymRow *out, int *n, int cap,</code> |
| `context_entry_points` | function | 1290 | <code>static int context_entry_points(Cg *cg, const char *q, const SymRow *matched,</code> |
| `hit_tag` | function | 1319 | <code>static const char *hit_tag(Cg *cg, const SymRow *r, char *out, size_t cap) {</code> |
| `json_sym` | function | 1327 | <code>static void json_sym(Cg *cg, StrBuf *b, const SymRow *r) {</code> |
| `json_sym_compact` | function | 1344 | <code>static void json_sym_compact(Cg *cg, StrBuf *b, const SymRow *r) {</code> |
| `SeenSet` | typedef | 1358 | <code>typedef struct { char v[96][256]; int n; } SeenSet;</code> |
| `seen_has` | function | 1360 | <code>static bool seen_has(const SeenSet *s, const char *name) {</code> |
| `seen_add` | function | 1366 | <code>static void seen_add(SeenSet *s, const char *name) {</code> |
| `filehit_put` | function | 1375 | <code>static void filehit_put(Cg *cg, StrBuf *b, const FileHit *f, bool json) {</code> |
| `cmd_search` | function | 1396 | <code>int cmd_search(Cg *cg, const char *q, int limit, bool json) {</code> |
| `cmd_symbol` | function | 1448 | <code>int cmd_symbol(Cg *cg, const char *name, bool json) {</code> |
| `INode` | typedef | 1502 | <code>typedef struct { char name[256]; char via[256]; int depth; SymRow loc; } INode;</code> |
| `inode_seen` | function | 1504 | <code>static bool inode_seen(INode *v, int n, const char *name) {</code> |
| `IMPACT_CAP` | macro | 1510 | <code>#define IMPACT_CAP 400</code> |
| `impact_bfs` | function | 1513 | <code>static int impact_bfs(Cg *cg, const SymRow *root, int depth, bool up,</code> |
| `impact_json_dir` | function | 1547 | <code>static void impact_json_dir(Cg *cg, StrBuf *b, const char *key, const INode *v,</code> |
| `cmd_impact` | function | 1577 | <code>int cmd_impact(Cg *cg, const char *name, int depth, int budget, bool json) {</code> |
| `cmd_routes` | function | 1639 | <code>int cmd_routes(Cg *cg, const char *filter, bool json) {</code> |
| `first_line` | function | 1695 | <code>static void first_line(StrBuf *b, const char *body, int max) {</code> |
| `SurveySym` | typedef | 1722 | <code>typedef struct {</code> |
| `cmd_survey` | function | 1729 | <code>int cmd_survey(Cg *cg, const char *scope, int budget, bool json) {</code> |
| `AnchStale` | typedef | 1974 | <code>typedef struct { StrBuf *txt, *js; int n; } AnchStale;</code> |
| `anch_stale_cb` | function | 1976 | <code>static void anch_stale_cb(void *u, const char *path, int line,</code> |
| `DOC_VIA_DECL` | macro | 2000 | <code>#define DOC_VIA_DECL \</code> |
| `cmd_anchors` | function | 2005 | <code>int cmd_anchors(Cg *cg, bool stale_only, bool unc_only, bool json) {</code> |
| `CTX_TAIL` | macro | 2126 | <code>#define CTX_TAIL 96</code> |
| `CTX_MARK` | macro | 2128 | <code>#define CTX_MARK 16</code> |
| `ctx_tail` | function | 2130 | <code>static void ctx_tail(StrBuf *b, int budget, int omitted, bool json) {</code> |
| `file_purpose` | function | 2147 | <code>static void file_purpose(Cg *cg, long file_id, char *out, size_t cap) {</code> |
| `ctx_fit` | function | 2166 | <code>static bool ctx_fit(StrBuf *b, StrBuf *it, size_t room, bool json, int *emitted,</code> |
| `ctx_omitted` | function | 2180 | <code>static void ctx_omitted(StrBuf *b, int emitted, int omitted, bool json) {</code> |
| `context_path_outline` | function | 2193 | <code>static int context_path_outline(Cg *cg, const char *q, int budget, bool json) {</code> |
| `CTX_OPEN_MAX` | macro | 2435 | <code>#define CTX_OPEN_MAX 60           /* opening lines one hit may grow to */</code> |
| `CTX_MIN_BUDGET` | macro | 2438 | <code>#define CTX_MIN_BUDGET 64</code> |
| `cmd_context` | function | 2440 | <code>int cmd_context(Cg *cg, const char *q, int budget, int limit, bool json) {</code> |
| `symbols_at_position` | function | 2769 | <code>static int symbols_at_position(Cg *cg, const char *path, int line,</code> |
| `graph_symbol_at` | function | 2786 | <code>int graph_symbol_at(Cg *cg, const char *path, int line, char *name,</code> |
| `cmd_show` | function | 2797 | <code>int cmd_show(Cg *cg, const char *name, bool full, bool json) {</code> |
| `TEST_PATH_SQL` | macro | 2862 | <code>#define TEST_PATH_SQL \</code> |
| `graph_path_is_test` | function | 2869 | <code>bool graph_path_is_test(const char *path) {</code> |
| `tests_for_symbol` | function | 2905 | <code>static int tests_for_symbol(Cg *cg, const char *name, StrBuf *b, bool json,</code> |
| `graph_task_focus` | function | 2934 | <code>char *graph_task_focus(Cg *cg, const char *task_packet) {</code> |
| `cmd_test_impact` | function | 2960 | <code>int cmd_test_impact(Cg *cg, const char *name, bool json) {</code> |
| `cmd_why` | function | 3019 | <code>int cmd_why(Cg *cg, const char *name, bool json) {</code> |
| `path_is_header` | function | 3124 | <code>static bool path_is_header(const char *path) {</code> |
| `lang_family` | function | 3134 | <code>static const char *lang_family(const char *path) {</code> |
| `edges_prefer_impl` | function | 3144 | <code>static int edges_prefer_impl(Cg *cg, SymRow *e, int n, bool callers,</code> |
| `graph_symbol_brief` | function | 3170 | <code>int graph_symbol_brief(Cg *cg, const char *name, int snippet_lines,</code> |
| `graph_glob_symbols` | function | 3258 | <code>int graph_glob_symbols(Cg *cg, const char *glob, int max_files, int max_syms,</code> |
| `graph_neighbors` | function | 3292 | <code>int graph_neighbors(Cg *cg, const char *name, char ***out) {</code> |

## src/help.c

[Open source](../src/help.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `HelpCmd` | typedef | 21 | <code>typedef struct {</code> |
| `HelpGroup` | typedef | 36 | <code>typedef struct { const char *key, *title, *blurb; } HelpGroup;</code> |
| `NGROUPS` | macro | 49 | <code>#define NGROUPS (int)(sizeof GROUPS / sizeof GROUPS[0])</code> |
| `NHELP` | macro | 859 | <code>#define NHELP (int)(sizeof HELP / sizeof HELP[0])</code> |
| `help_width` | function | 869 | <code>static int help_width(void) {</code> |
| `help_styled` | function | 884 | <code>static bool help_styled(void) {</code> |
| `Out` | typedef | 895 | <code>typedef struct { StrBuf b; int width; bool style; int col; } Out;</code> |
| `dwidth` | function | 898 | <code>static int dwidth(const char *s, size_t n) {</code> |
| `o_raw` | function | 905 | <code>static void o_raw(Out *o, const char *s, size_t n) {</code> |
| `o_str` | function | 909 | <code>static void o_str(Out *o, const char *s) { o_raw(o, s, strlen(s)); }</code> |
| `o_nl` | function | 910 | <code>static void o_nl(Out *o) { sb_putc(&amp;o-&gt;b, '\n'); o-&gt;col = 0; }</code> |
| `o_pad` | function | 911 | <code>static void o_pad(Out *o, int to) { while (o-&gt;col &lt; to) o_raw(o, " ", 1); }</code> |
| `o_on` | function | 912 | <code>static void o_on(Out *o, const char *sgr) {</code> |
| `BOLD` | macro | 915 | <code>#define BOLD "\033[1m"</code> |
| `DIM` | macro | 916 | <code>#define DIM  "\033[2m"</code> |
| `OFF` | macro | 917 | <code>#define OFF  "\033[0m"</code> |
| `o_wrap` | function | 922 | <code>static void o_wrap(Out *o, const char *s, int indent) {</code> |
| `o_init` | function | 950 | <code>static void o_init(Out *o) {</code> |
| `o_flush` | function | 956 | <code>static void o_flush(Out *o, FILE *f) {</code> |
| `in_list` | function | 963 | <code>static bool in_list(const char *list, const char *name) {</code> |
| `help_find` | function | 975 | <code>static const HelpCmd *help_find(const char *name) {</code> |
| `help_known` | function | 985 | <code>bool help_known(const char *name) { return help_find(name) != NULL; }</code> |
| `is_child` | function | 988 | <code>static bool is_child(const HelpCmd *c, const char *parent) {</code> |
| `group_of` | function | 993 | <code>static const HelpGroup *group_of(const HelpCmd *c) {</code> |
| `row` | function | 1003 | <code>static void row(Out *o, const char *name, const char *args, const char *sum,</code> |
| `left_col` | function | 1017 | <code>static int left_col(const Out *o) {</code> |
| `flags_block` | function | 1022 | <code>static void flags_block(Out *o, const char *flags, int lcol) {</code> |
| `help_overview` | function | 1042 | <code>void help_overview(void) {</code> |
| `section` | function | 1071 | <code>static void section(Out *o, const char *title) {</code> |
| `detail` | function | 1076 | <code>static void detail(Out *o, const HelpCmd *c) {</code> |
| `edit_dist` | function | 1128 | <code>static int edit_dist(const char *a, const char *b) {</code> |
| `help_suggest` | function | 1144 | <code>void help_suggest(const char *name) {</code> |
| `find_words` | function | 1174 | <code>static const HelpCmd *find_words(int n, char **w) {</code> |
| `help_command` | function | 1188 | <code>int help_command(const char *name) {</code> |
| `help_all` | function | 1201 | <code>static void help_all(void) {</code> |
| `json_list` | function | 1213 | <code>static void json_list(StrBuf *b, const char *list, char sep) {</code> |
| `json_flags` | function | 1230 | <code>static void json_flags(StrBuf *b, const char *flags) {</code> |
| `help_json` | function | 1253 | <code>static void help_json(void) {</code> |
| `help_usage` | function | 1319 | <code>void help_usage(const char *name) {</code> |
| `cmd_help` | function | 1325 | <code>int cmd_help(int argc, char **argv) {</code> |
| `help_route` | function | 1355 | <code>int help_route(int argc, char **argv) {</code> |

## src/integrate.c

[Open source](../src/integrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ConfigKind` | typedef | 12 | <code>typedef enum { CFG_JSON, CFG_VSCODE, CFG_TOML } ConfigKind;</code> |
| `Adapter` | typedef | 14 | <code>typedef struct {</code> |
| `NADAPTERS` | macro | 47 | <code>#define NADAPTERS ((int)(sizeof ADAPTERS / sizeof ADAPTERS[0]))</code> |
| `ConfigState` | typedef | 49 | <code>typedef struct {</code> |
| `integrate_self` | function | 54 | <code>static void integrate_self(char out[4096]) {</code> |
| `integrate_path` | function | 62 | <code>static void integrate_path(const Cg *cg, const char *tmpl, char out[4700]) {</code> |
| `json_balanced` | function | 76 | <code>static bool json_balanced(const char *s) {</code> |
| `protocol_supported` | function | 95 | <code>static bool protocol_supported(const char *v) {</code> |
| `integrate_config_state` | function | 101 | <code>static ConfigState integrate_config_state(const Adapter *a,</code> |
| `integrate_action` | function | 128 | <code>static const char *integrate_action(const ConfigState *s) {</code> |
| `ensure_parent` | function | 135 | <code>static int ensure_parent(const char *path) {</code> |
| `backup_existing` | function | 144 | <code>static int backup_existing(const char *path, const char *body) {</code> |
| `integrate_entry` | function | 152 | <code>static char *integrate_entry(const char *bin, bool vscode) {</code> |
| `integrate_json_apply` | function | 161 | <code>static int integrate_json_apply(const Adapter *a, const char *path,</code> |
| `integrate_toml_apply` | function | 206 | <code>static int integrate_toml_apply(const char *path, const char *bin) {</code> |
| `asset_state` | function | 249 | <code>static const char *asset_state(const char *path, const char *marker) {</code> |
| `apply_asset` | function | 257 | <code>static int apply_asset(const char *path, const char *body, bool executable) {</code> |
| `host_shim_body` | function | 268 | <code>static char *host_shim_body(const char *host) {</code> |
| `IntegrateAgentmd` | typedef | 275 | <code>typedef struct { Cg *cg; } IntegrateAgentmd;</code> |
| `integrate_agentmd_call` | function | 276 | <code>static int integrate_agentmd_call(void *v) {</code> |
| `integrate_agent_context` | function | 285 | <code>static int integrate_agent_context(Cg *cg) {</code> |
| `integrate_apply_portable` | function | 312 | <code>int integrate_apply_portable(Cg *cg, bool quiet) {</code> |
| `adapter_json` | function | 338 | <code>static void adapter_json(const Adapter *a, const char *path,</code> |
| `integrate_plan` | function | 356 | <code>int integrate_plan(Cg *cg, bool json) {</code> |
| `integrate_apply` | function | 418 | <code>int integrate_apply(Cg *cg, bool json) {</code> |
| `doctor_find` | function | 468 | <code>static void doctor_find(StrBuf *findings, int *n, bool json,</code> |
| `integrate_doctor` | function | 484 | <code>int integrate_doctor(Cg *cg, bool json) {</code> |
| `integrate_detect` | function | 575 | <code>static int integrate_detect(Cg *cg, bool json) {</code> |
| `cmd_integrate` | function | 603 | <code>int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility) {</code> |

## src/jev.c

[Open source](../src/jev.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `JEV_DEFAULT_MODEL` | macro | 35 | <code>#define JEV_DEFAULT_MODEL    "typesafe/jev-1.13"</code> |
| `JEV_DEFAULT_ENDPOINT` | macro | 36 | <code>#define JEV_DEFAULT_ENDPOINT "https://openrouter.ai/api/alpha/decisions"</code> |
| `JEV_MAX_CHOICE` | macro | 37 | <code>#define JEV_MAX_CHOICE       255</code> |
| `JEV_EXCERPT` | macro | 38 | <code>#define JEV_EXCERPT          512</code> |
| `JEV_MAX_ANSWERS` | macro | 39 | <code>#define JEV_MAX_ANSWERS      512</code> |
| `JevConfig` | typedef | 41 | <code>typedef struct {</code> |
| `jev_config` | function | 51 | <code>static void jev_config(JevConfig *c) {</code> |
| `dup_list` | function | 73 | <code>static char **dup_list(const char *const *v, int n) {</code> |
| `jev_question_noul` | function | 80 | <code>int jev_question_noul(JevQuestion *q, const char *name,</code> |
| `jev_question_choice` | function | 98 | <code>int jev_question_choice(JevQuestion *q, const char *name,</code> |
| `jev_question_score` | function | 112 | <code>int jev_question_score(JevQuestion *q, const char *name,</code> |
| `jev_question_free` | function | 125 | <code>void jev_question_free(JevQuestion *q) {</code> |
| `jev_type_name` | function | 137 | <code>static const char *jev_type_name(int t) {</code> |
| `json_value_ok` | function | 143 | <code>static bool json_value_ok(const char *s) {</code> |
| `cmp_str_idx` | function | 175 | <code>static int cmp_str_idx(const void *a, const void *b, void *arg) {</code> |
| `sorted_order` | function | 180 | <code>static void sorted_order(char **v, int n, int *idx) {</code> |
| `sb_question` | function | 185 | <code>static void sb_question(StrBuf *b, const JevQuestion *q) {</code> |
| `jev_request_json` | function | 214 | <code>void jev_request_json(const char *model, const char *state_json,</code> |
| `sb_cfgquote` | function | 242 | <code>static void sb_cfgquote(StrBuf *b, const char *s) {</code> |
| `jev_tmp_dir` | function | 255 | <code>static int jev_tmp_dir(const Cg *cg, char *out, size_t cap) {</code> |
| `write_private` | function | 268 | <code>static int write_private(const char *path, const char *data) {</code> |
| `sleep_ms` | function | 281 | <code>static void sleep_ms(long ms) {</code> |
| `excerpt_of` | function | 287 | <code>static void excerpt_of(const char *s, char *out, size_t cap) {</code> |
| `curl_once` | function | 299 | <code>static int curl_once(const char *curl, const char *cfg, char **body,</code> |
| `jnum` | function | 333 | <code>static double jnum(const char *obj, const char *key, bool *ok) {</code> |
| `jev_parse` | function | 345 | <code>static int jev_parse(const char *resp, JevResult *out) {</code> |
| `jev_answer` | function | 425 | <code>const JevAnswer *jev_answer(const JevResult *r, const char *name) {</code> |
| `jev_result_free` | function | 431 | <code>void jev_result_free(JevResult *r) {</code> |
| `jev_log_path` | function | 443 | <code>static void jev_log_path(const Cg *cg, char *out, size_t cap) {</code> |
| `jev_log` | function | 449 | <code>static void jev_log(const Cg *cg, const JevConfig *c, const JevResult *r,</code> |
| `count_questions` | function | 492 | <code>static int count_questions(const char *body) {</code> |
| `jev_ask_raw_cfg` | function | 502 | <code>static int jev_ask_raw_cfg(Cg *cg, const JevConfig *cp, const char *body_in,</code> |
| `jev_ask_raw` | function | 505 | <code>int jev_ask_raw(Cg *cg, const char *body_in, JevResult *out) {</code> |
| `jev_ask_raw_cfg` | function | 511 | <code>static int jev_ask_raw_cfg(Cg *cg, const JevConfig *cp, const char *body_in,</code> |
| `jev_ask` | function | 622 | <code>int jev_ask(Cg *cg, const char *state_json, const JevQuestion *qs, int nq,</code> |
| `jev_ask_at` | function | 642 | <code>int jev_ask_at(Cg *cg, const char *key, const char *model,</code> |
| `print_probabilities` | function | 671 | <code>static void print_probabilities(const char *probs, StrBuf *b) {</code> |
| `jev_result_json` | function | 681 | <code>static void jev_result_json(const JevResult *r, StrBuf *b) {</code> |
| `jev_result_text` | function | 711 | <code>static void jev_result_text(const JevResult *r, StrBuf *b) {</code> |
| `AskArgs` | typedef | 751 | <code>typedef struct {</code> |
| `ask_push` | function | 755 | <code>static JevQuestion *ask_push(AskArgs *a) {</code> |
| `list_push` | function | 765 | <code>static void list_push(char ***v, int *n, const char *s) {</code> |
| `ask_usage` | function | 770 | <code>static int ask_usage(void) {</code> |
| `jev_ask_cli` | function | 779 | <code>static int jev_ask_cli(Cg *cg, int argc, char **argv, bool json) {</code> |
| `curl_version` | function | 925 | <code>static void curl_version(const char *curl, char *out, size_t cap) {</code> |
| `key_hint` | function | 947 | <code>static void key_hint(const char *key, char *out, size_t cap) {</code> |
| `log_stats` | function | 954 | <code>static long log_stats(const char *path, long *last_ts) {</code> |
| `jev_doctor` | function | 970 | <code>static int jev_doctor(Cg *cg, bool probe, bool json) {</code> |
| `jev_log_cmd` | function | 1062 | <code>static int jev_log_cmd(Cg *cg, int limit, bool json) {</code> |
| `cmd_jev` | function | 1134 | <code>int cmd_jev(Cg *cg, int argc, char **argv, bool json) {</code> |
| `JEV_TAIL_BYTES` | macro | 1163 | <code>#define JEV_TAIL_BYTES 4096</code> |
| `JEV_TAIL_LINES` | macro | 1164 | <code>#define JEV_TAIL_LINES 40</code> |
| `JEV_MAX_RANK` | macro | 1165 | <code>#define JEV_MAX_RANK   50</code> |
| `jev_advisory_ready` | function | 1167 | <code>bool jev_advisory_ready(const char *what) {</code> |
| `jev_advisory_failed` | function | 1174 | <code>static void jev_advisory_failed(const char *what, const JevResult *r) {</code> |
| `jev_tail` | function | 1181 | <code>static void jev_tail(const char *s, StrBuf *out) {</code> |
| `answer_confidence` | function | 1200 | <code>static double answer_confidence(const JevAnswer *a) {</code> |
| `sb_confidence` | function | 1204 | <code>static void sb_confidence(StrBuf *b, double c) {</code> |
| `jev_triage_failure` | function | 1208 | <code>int jev_triage_failure(Cg *cg, const char *output, JevTriage *out) {</code> |
| `rank_sort` | function | 1285 | <code>static void rank_sort(JevFinding *v, int n) {</code> |
| `jev_rank_findings` | function | 1294 | <code>int jev_rank_findings(Cg *cg, JevFinding *v, int n) {</code> |
| `jev_pr_readiness` | function | 1360 | <code>int jev_pr_readiness(Cg *cg, const char *state_json, JevReadiness *out) {</code> |
| `jev_report_error` | function | 1396 | <code>int jev_report_error(const JevResult *r, const char *what) {</code> |

## src/journal.c

[Open source](../src/journal.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `JOURNAL_SUBDIR` | macro | 37 | <code>#define JOURNAL_SUBDIR CG_DIR "/journal"</code> |
| `journal_set_command` | function | 46 | <code>void journal_set_command(const char *cmd, const char *sub) {</code> |
| `journal_busy_seen` | function | 54 | <code>bool journal_busy_seen(void) { return g_busy_seen; }</code> |
| `journal_mark_busy` | function | 55 | <code>void journal_mark_busy(void) { g_busy_seen = true; }</code> |
| `journal_queued_count` | function | 56 | <code>int  journal_queued_count(void) { return g_queued; }</code> |
| `journal_announced` | function | 57 | <code>void journal_announced(void) { g_announced = true; }</code> |
| `journal_dir` | function | 59 | <code>static void journal_dir(const Cg *cg, char *out, size_t cap) {</code> |
| `journal_atexit` | function | 66 | <code>static void journal_atexit(void) {</code> |
| `journal_append` | function | 75 | <code>int journal_append(Cg *cg, const char *op, const char *args,</code> |
| `name_cmp` | function | 130 | <code>static int name_cmp(const void *a, const void *b) {</code> |
| `list_records` | function | 135 | <code>static int list_records(const char *dir, char ***out) {</code> |
| `free_list` | function | 157 | <code>static void free_list(char **v, int n) {</code> |
| `journal_pending` | function | 162 | <code>int journal_pending(const Cg *cg, int *failed) {</code> |
| `any_pending` | function | 179 | <code>static bool any_pending(const Cg *cg) {</code> |
| `rc_busy` | function | 197 | <code>static bool rc_busy(int rc) {</code> |
| `begin_wait` | function | 203 | <code>static int begin_wait(Cg *cg, long wait_ms) {</code> |
| `journal_begin` | function | 211 | <code>int journal_begin(Cg *cg) {</code> |
| `set_err` | function | 227 | <code>static void set_err(char *err, size_t cap, const char *msg) {</code> |
| `apply_record` | function | 234 | <code>static int apply_record(Cg *cg, const char *rec, char *err, size_t cap) {</code> |
| `already_applied` | function | 309 | <code>static bool already_applied(Cg *cg, const char *id) {</code> |
| `mark_applied` | function | 321 | <code>static void mark_applied(Cg *cg, const char *id) {</code> |
| `fail_record` | function | 335 | <code>static void fail_record(const char *dir, const char *name, const char *err) {</code> |
| `order_own_first` | function | 353 | <code>static void order_own_first(char **v, int n) {</code> |
| `journal_replay` | function | 370 | <code>int journal_replay(Cg *cg, JournalMode mode) {</code> |
| `ci_contains` | function | 491 | <code>static bool ci_contains(const char *hay, const char *needle, size_t n) {</code> |
| `query_hits` | function | 504 | <code>static bool query_hits(const char *q, const char *body, const char *task,</code> |
| `journal_queued_memories` | function | 522 | <code>int journal_queued_memories(const Cg *cg, const char *query, const char *task,</code> |
| `when_str` | function | 570 | <code>static void when_str(long at_ms, char *out, size_t cap) {</code> |
| `list_one` | function | 578 | <code>static void list_one(const char *dir, const char *name, const char *error,</code> |
| `journal_list` | function | 613 | <code>static int journal_list(Cg *cg, bool json) {</code> |
| `drop_in` | function | 646 | <code>static int drop_in(const char *dir, const char *only, bool err_too) {</code> |
| `cmd_journal` | function | 669 | <code>int cmd_journal(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/json.c

[Open source](../src/json.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `skip_value` | function | 9 | <code>static const char *skip_value(const char *p) {</code> |
| `find_key` | function | 44 | <code>static const char *find_key(const char *obj, const char *key) {</code> |
| `unescape` | function | 72 | <code>static char *unescape(const char *s, size_t n) {</code> |
| `json_string_value` | function | 106 | <code>char *json_string_value(const char *raw) {</code> |
| `json_get_string` | function | 118 | <code>char *json_get_string(const char *obj, const char *key) {</code> |
| `json_get_int` | function | 130 | <code>long json_get_int(const char *obj, const char *key, long dflt) {</code> |
| `json_get_raw` | function | 136 | <code>char *json_get_raw(const char *obj, const char *key) {</code> |
| `json_get_object` | function | 147 | <code>char *json_get_object(const char *obj, const char *key) {</code> |
| `json_object_keys` | function | 158 | <code>int json_object_keys(const char *obj, char **keys, int cap) {</code> |
| `json_array_items` | function | 185 | <code>int json_array_items(const char *arr, char ***out) {</code> |

## src/kvx.c

[Open source](../src/kvx.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `strip_comment` | function | 19 | <code>static size_t strip_comment(char *s, size_t n) {</code> |
| `trim` | function | 30 | <code>static char *trim(char *s) {</code> |
| `kvx_add_section` | function | 37 | <code>static void kvx_add_section(Kvx *k, const char *sec) {</code> |
| `kvx_parse` | function | 47 | <code>Kvx *kvx_parse(const char *path) {</code> |
| `kvx_free` | function | 100 | <code>void kvx_free(Kvx *k) {</code> |
| `kvx_has` | function | 112 | <code>bool kvx_has(const Kvx *k, const char *sec) {</code> |
| `kvx_raw` | function | 118 | <code>const char *kvx_raw(const Kvx *k, const char *sec, const char *key) {</code> |
| `env_name` | function | 126 | <code>static bool env_name(const char *s, size_t n) {</code> |
| `interp_unquote` | function | 134 | <code>static char *interp_unquote(const char *raw) {</code> |
| `kvx_str` | function | 160 | <code>char *kvx_str(const Kvx *k, const char *sec, const char *key) {</code> |
| `kvx_long` | function | 166 | <code>long kvx_long(const Kvx *k, const char *sec, const char *key, long dflt) {</code> |
| `kvx_bool` | function | 176 | <code>bool kvx_bool(const Kvx *k, const char *sec, const char *key, bool dflt) {</code> |
| `kvx_list` | function | 185 | <code>int kvx_list(const Kvx *k, const char *sec, const char *key, char ***out) {</code> |
| `kvx_keys` | function | 226 | <code>int kvx_keys(const Kvx *k, const char *sec, const char ***out) {</code> |
| `kvx_subsections` | function | 238 | <code>int kvx_subsections(const Kvx *k, const char *prefix, char ***out) {</code> |
| `seg_int` | function | 259 | <code>static bool seg_int(const char *s, size_t n, long *out) {</code> |
| `dotted_cmp` | function | 273 | <code>static int dotted_cmp(const void *pa, const void *pb) {</code> |
| `kvx_sort_dotted` | function | 292 | <code>void kvx_sort_dotted(char **ids, int n) {</code> |
| `kvx_lock` | function | 301 | <code>static int kvx_lock(const char *path) {</code> |
| `kvx_unlock` | function | 309 | <code>static void kvx_unlock(int fd) {</code> |
| `old_scalar` | function | 317 | <code>static void old_scalar(const char *after_eq, char *out, size_t cap) {</code> |
| `kvx_set_status` | function | 327 | <code>int kvx_set_status(const char *path, const char *section, const char *value) {</code> |
| `sb_kvx_string` | function | 389 | <code>static void sb_kvx_string(StrBuf *b, const char *value) {</code> |
| `kvx_set_value` | function | 410 | <code>static int kvx_set_value(const char *path, const char *section, const char *key,</code> |
| `kvx_set_string` | function | 521 | <code>int kvx_set_string(const char *path, const char *section, const char *key,</code> |
| `kvx_set_raw` | function | 526 | <code>int kvx_set_raw(const char *path, const char *section, const char *key,</code> |

## src/lang.c

[Open source](../src/lang.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ID` | macro | 10 | <code>#define ID "[A-Za-z_][A-Za-z0-9_]*"</code> |
| `NW` | macro | 11 | <code>#define NW "(^&#124;[^A-Za-z0-9_])"          /* non-word boundary, consumes 0-1 */</code> |
| `DefPat` | typedef | 13 | <code>typedef struct { const char *kind; const char *pat; int group; } DefPat;</code> |
| `ImpStyle` | typedef | 16 | <code>typedef enum {</code> |
| `MAXPATS` | macro | 26 | <code>#define MAXPATS 12</code> |
| `LangSpec` | typedef | 27 | <code>typedef struct {</code> |
| `NLANGS` | macro | 139 | <code>#define NLANGS ((int)(sizeof LANGS / sizeof LANGS[0]))</code> |
| `word_in` | function | 180 | <code>static bool word_in(const char *const *words, const char *s, size_t n) {</code> |
| `is_keyword` | function | 193 | <code>static bool is_keyword(const LangSpec *L, const char *s, size_t n) {</code> |
| `lang_global_init` | function | 199 | <code>void lang_global_init(void) {</code> |
| `spec_by_name` | function | 222 | <code>static const LangSpec *spec_by_name(const char *name) {</code> |
| `lang_for_path` | function | 228 | <code>const char *lang_for_path(const char *path) {</code> |
| `spec_for_path` | function | 235 | <code>static const LangSpec *spec_for_path(const char *path) {</code> |
| `CMT_MAX_BYTES` | macro | 244 | <code>#define CMT_MAX_BYTES 4000        /* a span longer than this is a licence header */</code> |
| `add_cmt` | function | 246 | <code>static void add_cmt(ParseResult *pr, const char *body, int line, int end,</code> |
| `CmtAcc` | typedef | 263 | <code>typedef struct { StrBuf b; int line, end; bool pure, open, below; } CmtAcc;</code> |
| `cmt_flush` | function | 265 | <code>static void cmt_flush(CmtAcc *a, ParseResult *pr) {</code> |
| `PARAM_MAX` | macro | 277 | <code>#define PARAM_MAX 16</code> |
| `PARAM_LEN` | macro | 278 | <code>#define PARAM_LEN 64</code> |
| `idstart` | function | 280 | <code>static bool idstart(char c);</code> |
| `idchar` | function | 281 | <code>static bool idchar(char c);</code> |
| `params_capture` | function | 291 | <code>static bool params_capture(const char *after, bool cfam, bool cont,</code> |
| `add_def` | function | 346 | <code>static void add_def(ParseResult *pr, const char *name, size_t nlen,</code> |
| `count_args` | function | 378 | <code>static int count_args(const char *clean, size_t open) {</code> |
| `add_ref` | function | 394 | <code>static void add_ref(ParseResult *pr, const char *name, size_t nlen, int line,</code> |
| `add_import` | function | 416 | <code>static void add_import(ParseResult *pr, const char *name, size_t nlen,</code> |
| `route_add` | function | 436 | <code>void route_add(ParseResult *pr, const char *framework, const char *method,</code> |
| `parse_result_free` | function | 450 | <code>void parse_result_free(ParseResult *pr) {</code> |
| `starts_with` | function | 468 | <code>static bool starts_with(const char *s, const char *pre) {</code> |
| `CmtRange` | typedef | 475 | <code>typedef struct { int start, end; } CmtRange;</code> |
| `cmt_mark` | function | 477 | <code>static void cmt_mark(CmtRange *cr, size_t a, size_t b) {</code> |
| `CleanState` | typedef | 484 | <code>typedef struct {</code> |
| `clean_line` | function | 493 | <code>static void clean_line(const LangSpec *L, const char *line, size_t n,</code> |
| `idstart` | function | 570 | <code>static bool idstart(char c) { return isalpha((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `idchar` | function | 571 | <code>static bool idchar(char c)  { return isalnum((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `lang_scope_end` | function | 580 | <code>static int lang_scope_end(const LangSpec *L, char *const *lines, int nlines,</code> |
| `SIG_SPAN` | macro | 625 | <code>#define SIG_SPAN 40</code> |
| `callable_end` | function | 626 | <code>static int callable_end(const LangSpec *L, char *const *lines, int nlines,</code> |
| `skip_sp` | function | 683 | <code>static const char *skip_sp(const char *s) {</code> |
| `kw_at` | function | 688 | <code>static bool kw_at(const char *s, const char *kw) {</code> |
| `quoted_span` | function | 694 | <code>static bool quoted_span(const char *s, const char **out, size_t *n) {</code> |
| `seg_name` | function | 706 | <code>static void seg_name(const char *s, const char *e, const char **out, size_t *n) {</code> |
| `imp_js` | function | 721 | <code>static void imp_js(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_py` | function | 757 | <code>static void imp_py(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_go` | function | 799 | <code>static void imp_go(const char *line, int lineno, ParseResult *pr, int *state) {</code> |
| `imp_inc` | function | 822 | <code>static void imp_inc(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_rust` | function | 839 | <code>static void imp_rust(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_dot` | function | 875 | <code>static void imp_dot(const LangSpec *L, const char *line, int lineno,</code> |
| `lang_scan_imports` | function | 899 | <code>static void lang_scan_imports(const LangSpec *L, const char *line, int lineno,</code> |
| `lang_parse` | function | 912 | <code>void lang_parse(const char *lang, const char *path, const char *src,</code> |

## src/lsp.c

[Open source](../src/lsp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LSP_KIND_FN` | macro | 22 | <code>#define LSP_KIND_FN 12</code> |
| `LSP_LOCK_WAIT_MS` | macro | 29 | <code>#define LSP_LOCK_WAIT_MS 1500</code> |
| `LSP_INDEX_RETRY_MS` | macro | 30 | <code>#define LSP_INDEX_RETRY_MS 3000</code> |
| `LSP_FRESH_MS` | macro | 31 | <code>#define LSP_FRESH_MS 3000</code> |
| `lsp_index` | function | 40 | <code>static void lsp_index(Cg *cg, const SysInfo *si, const char *abs) {</code> |
| `lsp_read` | function | 70 | <code>static char *lsp_read(void) {</code> |
| `lsp_send` | function | 89 | <code>static void lsp_send(const char *payload) {</code> |
| `lsp_reply` | function | 94 | <code>static void lsp_reply(const char *id, const char *result) {</code> |
| `lsp_notify` | function | 101 | <code>static void lsp_notify(const char *method, const char *params) {</code> |
| `uri_to_path` | function | 111 | <code>static void uri_to_path(const char *uri, char *out, size_t cap) {</code> |
| `path_to_uri` | function | 127 | <code>static void path_to_uri(const char *root, const char *rel, StrBuf *b) {</code> |
| `rel_of` | function | 135 | <code>static const char *rel_of(const Cg *cg, const char *abs) {</code> |
| `emit_location` | function | 143 | <code>static void emit_location(Cg *cg, StrBuf *b, const char *path, int line,</code> |
| `word_at` | function | 156 | <code>static bool word_at(const char *abs, int line0, int chr, char *out, size_t cap) {</code> |
| `lsp_hover` | function | 182 | <code>void lsp_hover(Cg *cg, const char *name, StrBuf *md) {</code> |
| `diag_add` | function | 224 | <code>static void diag_add(StrBuf *b, int *n, int line, int severity,</code> |
| `lsp_path_in_task_scope` | function | 238 | <code>bool lsp_path_in_task_scope(Cg *cg, const char *rel) {</code> |
| `lsp_diagnostics` | function | 258 | <code>void lsp_diagnostics(Cg *cg, const char *abs, StrBuf *out) {</code> |
| `publish_diagnostics` | function | 311 | <code>static void publish_diagnostics(Cg *cg, const char *uri, const char *abs) {</code> |
| `request_word` | function | 324 | <code>static bool request_word(Cg *cg, const char *params, char *word, size_t wcap,</code> |
| `cmd_lsp` | function | 345 | <code>int cmd_lsp(Cg *cg, const SysInfo *si) {</code> |

## src/main.c

[Open source](../src/main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `usage` | function | 7 | <code>static void usage(void) {</code> |
| `flag` | function | 11 | <code>static bool flag(int *argc, char **argv, const char *name) {</code> |
| `opt` | function | 23 | <code>static const char *opt(int *argc, char **argv, const char *name,</code> |
| `workers_opt` | function | 40 | <code>static bool workers_opt(int *argc, char **argv, const char *cmd, int *out) {</code> |
| `cmd_info` | function | 54 | <code>static int cmd_info(const SysInfo *si, Cg *cg, bool json, int flag_workers) {</code> |
| `FRESH_WINDOW_MS` | macro | 133 | <code>#define FRESH_WINDOW_MS 3000</code> |
| `index_fresh` | function | 134 | <code>static void index_fresh(Cg *cg, const SysInfo *si) {</code> |
| `main` | function | 144 | <code>int main(int argc, char **argv) {</code> |

## src/mcp.c

[Open source](../src/mcp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CallCtx` | typedef | 18 | <code>typedef struct {</code> |
| `t_search` | function | 24 | <code>static int t_search(void *v) {</code> |
| `t_context` | function | 33 | <code>static int t_context(void *v) {</code> |
| `t_survey` | function | 45 | <code>static int t_survey(void *v) {</code> |
| `t_anchors` | function | 54 | <code>static int t_anchors(void *v) {</code> |
| `t_symbol` | function | 63 | <code>static int t_symbol(void *v) {</code> |
| `t_impact` | function | 71 | <code>static int t_impact(void *v) {</code> |
| `t_routes` | function | 82 | <code>static int t_routes(void *v) {</code> |
| `t_status` | function | 89 | <code>static int t_status(void *v)  { CallCtx *c = v; return cmd_status(c-&gt;cg, true); }</code> |
| `t_state` | function | 90 | <code>static int t_state(void *v)   { CallCtx *c = v; return cmd_state(c-&gt;cg, true); }</code> |
| `t_integrate` | function | 91 | <code>static int t_integrate(void *v) {</code> |
| `t_event_ingest` | function | 98 | <code>static int t_event_ingest(void *v) {</code> |
| `t_event_history` | function | 109 | <code>static int t_event_history(void *v) {</code> |
| `t_progress` | function | 116 | <code>static int t_progress(void *v) {</code> |
| `t_work_open` | function | 120 | <code>static int t_work_open(void *v) {</code> |
| `t_work_update` | function | 127 | <code>static int t_work_update(void *v) {</code> |
| `t_work_close` | function | 135 | <code>static int t_work_close(void *v) {</code> |
| `t_changes` | function | 149 | <code>static int t_changes(void *v) {</code> |
| `t_log` | function | 154 | <code>static int t_log(void *v) {</code> |
| `t_commit` | function | 159 | <code>static int t_commit(void *v) {</code> |
| `fold_stderr` | function | 171 | <code>static int fold_stderr(void) {</code> |
| `unfold_stderr` | function | 177 | <code>static void unfold_stderr(int saved) {</code> |
| `run_spec` | function | 183 | <code>static int run_spec(int argc, char **argv, bool json) {</code> |
| `t_spec_status` | function | 190 | <code>static int t_spec_status(void *v) {</code> |
| `t_spec_reconcile` | function | 195 | <code>static int t_spec_reconcile(void *v) {</code> |
| `t_spec_next` | function | 204 | <code>static int t_spec_next(void *v) {</code> |
| `t_spec_start` | function | 209 | <code>static int t_spec_start(void *v) {</code> |
| `t_spec_mode` | function | 218 | <code>static int t_spec_mode(void *v) {</code> |
| `t_spec_implemented` | function | 227 | <code>static int t_spec_implemented(void *v) {</code> |
| `t_spec_done` | function | 242 | <code>static int t_spec_done(void *v) {</code> |
| `t_spec_render` | function | 254 | <code>static int t_spec_render(void *v) {</code> |
| `t_spec_trace` | function | 262 | <code>static int t_spec_trace(void *v) {</code> |
| `t_docs` | function | 271 | <code>static int t_docs(void *v, const char *action) {</code> |
| `t_docs_status` | function | 276 | <code>static int t_docs_status(void *v) { return t_docs(v, "status"); }</code> |
| `t_docs_plan` | function | 277 | <code>static int t_docs_plan(void *v)   { return t_docs(v, "plan"); }</code> |
| `t_docs_packet` | function | 278 | <code>static int t_docs_packet(void *v) { return t_docs(v, "packet"); }</code> |
| `t_docs_check` | function | 279 | <code>static int t_docs_check(void *v)  { return t_docs(v, "check"); }</code> |
| `t_docs_trace` | function | 280 | <code>static int t_docs_trace(void *v)  { return t_docs(v, "trace"); }</code> |
| `t_docs_close` | function | 281 | <code>static int t_docs_close(void *v)  { return t_docs(v, "close"); }</code> |
| `t_remember` | function | 282 | <code>static int t_remember(void *v) {</code> |
| `t_recall` | function | 295 | <code>static int t_recall(void *v) {</code> |
| `t_memory_export` | function | 305 | <code>static int t_memory_export(void *v) {</code> |
| `t_memory_import` | function | 323 | <code>static int t_memory_import(void *v) {</code> |
| `t_show` | function | 353 | <code>static int t_show(void *v) {</code> |
| `t_why` | function | 364 | <code>static int t_why(void *v) {</code> |
| `t_test_impact` | function | 372 | <code>static int t_test_impact(void *v) {</code> |
| `t_brief` | function | 379 | <code>static int t_brief(void *v)  { CallCtx *c = v; return cmd_brief(c-&gt;cg, true); }</code> |
| `t_review` | function | 380 | <code>static int t_review(void *v) { CallCtx *c = v; return cmd_review(c-&gt;cg, true); }</code> |
| `t_check` | function | 381 | <code>static int t_check(void *v)  { CallCtx *c = v; return cmd_check(c-&gt;cg, true, false); }</code> |
| `t_guard` | function | 382 | <code>static int t_guard(void *v) {</code> |
| `t_git_sync` | function | 390 | <code>static int t_git_sync(void *v) {</code> |
| `t_spec_wave` | function | 395 | <code>static int t_spec_wave(void *v) {</code> |
| `t_spec_lint` | function | 400 | <code>static int t_spec_lint(void *v) {</code> |
| `t_spec_new` | function | 405 | <code>static int t_spec_new(void *v) {</code> |
| `t_spec_add` | function | 414 | <code>static int t_spec_add(void *v) {</code> |
| `t_spec_claim` | function | 445 | <code>static int t_spec_claim(void *v) {</code> |
| `t_spec_release` | function | 460 | <code>static int t_spec_release(void *v) {</code> |
| `t_spec_ready` | function | 475 | <code>static int t_spec_ready(void *v) {</code> |
| `t_spec_claim_next` | function | 480 | <code>static int t_spec_claim_next(void *v) {</code> |
| `t_handoff` | function | 493 | <code>static int t_handoff(void *v) {</code> |
| `t_resume` | function | 506 | <code>static int t_resume(void *v) {</code> |
| `t_memory_classify` | function | 517 | <code>static int t_memory_classify(void *v) {</code> |
| `t_skills_list` | function | 527 | <code>static int t_skills_list(void *v) {</code> |
| `t_skills_promote` | function | 532 | <code>static int t_skills_promote(void *v) {</code> |
| `t_codemap` | function | 543 | <code>static int t_codemap(void *v) {</code> |
| `S_QUERY` | macro | 553 | <code>#define S_QUERY  "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \</code> |
| `S_CTX` | macro | 555 | <code>#define S_CTX    "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \</code> |
| `S_SURVEY` | macro | 559 | <code>#define S_SURVEY "{\"type\":\"object\",\"properties\":{\"scope\":{\"type\":" \</code> |
| `S_ANCHORS` | macro | 563 | <code>#define S_ANCHORS "{\"type\":\"object\",\"properties\":{\"stale\":{\"type\":" \</code> |
| `S_NAME` | macro | 567 | <code>#define S_NAME   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}," \</code> |
| `S_IMPACT` | macro | 569 | <code>#define S_IMPACT "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \</code> |
| `S_FILTER` | macro | 573 | <code>#define S_FILTER "{\"type\":\"object\",\"properties\":{\"filter\":{\"type\":\"string\"}}}"</code> |
| `S_EMPTY` | macro | 574 | <code>#define S_EMPTY  "{\"type\":\"object\",\"properties\":{}}"</code> |
| `S_INTEGRATE` | macro | 575 | <code>#define S_INTEGRATE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_EVENT` | macro | 579 | <code>#define S_EVENT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_OPEN` | macro | 583 | <code>#define S_WORK_OPEN "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_UPDATE` | macro | 585 | <code>#define S_WORK_UPDATE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_CLOSE` | macro | 588 | <code>#define S_WORK_CLOSE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RECONCILE` | macro | 592 | <code>#define S_RECONCILE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_LIMIT` | macro | 595 | <code>#define S_LIMIT  "{\"type\":\"object\",\"properties\":{\"limit\":{\"type\":\"integer\"}}}"</code> |
| `S_MSG` | macro | 596 | <code>#define S_MSG    "{\"type\":\"object\",\"properties\":{\"message\":{\"type\":\"string\"}}," \</code> |
| `S_TASKID` | macro | 598 | <code>#define S_TASKID "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_TASKDN` | macro | 600 | <code>#define S_TASKDN "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_MODE` | macro | 603 | <code>#define S_MODE   "{\"type\":\"object\",\"properties\":{\"mode\":{" \</code> |
| `S_CHECK` | macro | 606 | <code>#define S_CHECK  "{\"type\":\"object\",\"properties\":{\"check\":{\"type\":\"boolean\"}}}"</code> |
| `S_TRACE` | macro | 607 | <code>#define S_TRACE  "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_REMEMBER` | macro | 609 | <code>#define S_REMEMBER "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_FEATURE` | macro | 617 | <code>#define S_FEATURE "{\"type\":\"object\",\"properties\":{\"feature\":" \</code> |
| `S_PATHOPT` | macro | 619 | <code>#define S_PATHOPT "{\"type\":\"object\",\"properties\":{\"path\":" \</code> |
| `S_SHOW` | macro | 622 | <code>#define S_SHOW   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \</code> |
| `S_NAMEOPT` | macro | 625 | <code>#define S_NAMEOPT "{\"type\":\"object\",\"properties\":{\"name\":" \</code> |
| `S_CLAIM` | macro | 628 | <code>#define S_CLAIM  "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_ADD` | macro | 633 | <code>#define S_ADD    "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RECALL` | macro | 643 | <code>#define S_RECALL "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_MEMEXPORT` | macro | 648 | <code>#define S_MEMEXPORT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_MEMIMPORT` | macro | 657 | <code>#define S_MEMIMPORT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_CLAIMNEXT` | macro | 669 | <code>#define S_CLAIMNEXT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RELEASE` | macro | 674 | <code>#define S_RELEASE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_HANDOFF` | macro | 680 | <code>#define S_HANDOFF "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RESUME` | macro | 687 | <code>#define S_RESUME "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_CLASSIFY` | macro | 690 | <code>#define S_CLASSIFY "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_PROMOTE` | macro | 695 | <code>#define S_PROMOTE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_CODEMAP` | macro | 698 | <code>#define S_CODEMAP "{\"type\":\"object\",\"properties\":{" \</code> |
| `A_READ` | macro | 707 | <code>#define A_READ  "{\"readOnlyHint\":true,\"destructiveHint\":false," \</code> |
| `A_WRITE` | macro | 709 | <code>#define A_WRITE "{\"readOnlyHint\":false,\"destructiveHint\":false," \</code> |
| `A_MUTATE` | macro | 711 | <code>#define A_MUTATE "{\"readOnlyHint\":false,\"destructiveHint\":true," \</code> |
| `MCP_FRESH_MS` | macro | 716 | <code>#define MCP_FRESH_MS 1500</code> |
| `MCP_GATE_WAIT_MS` | macro | 717 | <code>#define MCP_GATE_WAIT_MS 1500</code> |
| `NTOOLS` | macro | 1015 | <code>#define NTOOLS ((int)(sizeof TOOLS / sizeof TOOLS[0]))</code> |
| `mcp_tool_annotations` | function | 1086 | <code>static void mcp_tool_annotations(int i, StrBuf *b) {</code> |
| `mcp_resource_abs` | function | 1092 | <code>static void mcp_resource_abs(Cg *cg, const char *rel, char *out, size_t cap) {</code> |
| `mcp_list_resources` | function | 1104 | <code>static void mcp_list_resources(Cg *cg, StrBuf *r) {</code> |
| `mcp_list_prompts` | function | 1145 | <code>static void mcp_list_prompts(StrBuf *r) {</code> |
| `mcp_tools_json` | function | 1159 | <code>void mcp_tools_json(StrBuf *r) {</code> |
| `mcp_call_tool` | function | 1176 | <code>int mcp_call_tool(Cg *cg, const SysInfo *si, const char *name,</code> |
| `cmd_tool` | function | 1204 | <code>int cmd_tool(Cg *cg, const SysInfo *si, int argc, char **argv, bool json) {</code> |
| `send_line` | function | 1254 | <code>static void send_line(StrBuf *b) {</code> |
| `reply_result` | function | 1261 | <code>static void reply_result(const char *id, const char *result_json) {</code> |
| `reply_error` | function | 1268 | <code>static void reply_error(const char *id, int code, const char *msg) {</code> |
| `cmd_mcp` | function | 1277 | <code>int cmd_mcp(Cg *cg, const SysInfo *si) {</code> |
| `self_path` | function | 1426 | <code>static int self_path(char *out, size_t cap) {</code> |
| `server_entry` | function | 1433 | <code>static char *server_entry(const char *bin, bool vscode_style) {</code> |
| `install_json` | function | 1444 | <code>static void install_json(const char *path, const char *root_key,</code> |
| `cmd_mcp_install` | function | 1492 | <code>int cmd_mcp_install(Cg *cg) {</code> |

## src/memory.c

[Open source](../src/memory.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `memory_open_quiet` | function | 17 | <code>bool memory_open_quiet(Cg *g) {</code> |
| `bind_opt` | function | 23 | <code>static void bind_opt(sqlite3_stmt *st, int i, const char *v) {</code> |
| `memory_add` | function | 28 | <code>long memory_add(Cg *cg, const char *type, const char *task, const char *body,</code> |
| `memory_add_at` | function | 36 | <code>long memory_add_at(Cg *cg, long created, const char *branch, const char *type,</code> |
| `fts_query` | function | 95 | <code>static char *fts_query(const char *q) {</code> |
| `col_dup` | function | 115 | <code>static char *col_dup(sqlite3_stmt *st, int i) {</code> |
| `mem_row` | function | 124 | <code>static void mem_row(sqlite3_stmt *st, Memory *m) {</code> |
| `memory_get` | function | 148 | <code>bool memory_get(Cg *cg, long id, Memory *out) {</code> |
| `mem_scope` | function | 162 | <code>static const char *mem_scope(Cg *cg, char *out, size_t cap) {</code> |
| `MEM_BRANCH_CTE` | macro | 183 | <code>#define MEM_BRANCH_CTE \</code> |
| `MEM_BRANCH_WHERE` | macro | 187 | <code>#define MEM_BRANCH_WHERE \</code> |
| `SUPERSEDED_RANK` | macro | 194 | <code>#define SUPERSEDED_RANK \</code> |
| `memory_query` | function | 197 | <code>int memory_query(Cg *cg, const char *query, const char *task,</code> |
| `memory_clear` | function | 238 | <code>void memory_clear(Memory *m) {</code> |
| `memory_free` | function | 245 | <code>void memory_free(Memory *v, int n) {</code> |
| `memory_json` | function | 250 | <code>void memory_json(const Memory *m, StrBuf *b) {</code> |
| `memory_print_brief` | function | 276 | <code>void memory_print_brief(const Memory *m, const char *indent) {</code> |
| `cmd_remember` | function | 289 | <code>int cmd_remember(Cg *cg, const char *text, const char *type, const char *task,</code> |
| `cmd_remember_ex` | function | 297 | <code>int cmd_remember_ex(Cg *cg, const char *text, const char *type,</code> |
| `cmd_recall` | function | 370 | <code>int cmd_recall(Cg *cg, const char *query, const char *task, const char *type,</code> |
| `cmd_forget` | function | 453 | <code>int cmd_forget(Cg *cg, const char *idstr) {</code> |
| `memory_supersede` | function | 478 | <code>int memory_supersede(Cg *cg, long old_id, long new_id) {</code> |
| `cmd_recall_near` | function | 501 | <code>int cmd_recall_near(Cg *cg, const char *path, int limit, bool json) {</code> |
| `cmd_memory_compact` | function | 545 | <code>int cmd_memory_compact(Cg *cg, bool dry_run, bool json) {</code> |
| `NCLASSES` | macro | 614 | <code>#define NCLASSES ((int)(sizeof CLASS_KEYS / sizeof CLASS_KEYS[0]))</code> |
| `CLASSIFY_DEFAULT_LIMIT` | macro | 615 | <code>#define CLASSIFY_DEFAULT_LIMIT 50</code> |
| `state_field` | function | 617 | <code>static void state_field(StrBuf *b, const char *key, const char *val) {</code> |
| `classify_state` | function | 625 | <code>static char *classify_state(const Memory *m) {</code> |
| `classify_one` | function | 641 | <code>static int classify_one(Cg *cg, Memory *m, double *reusable) {</code> |
| `classify_store` | function | 679 | <code>static void classify_store(Cg *cg, const Memory *m) {</code> |
| `classify_select` | function | 692 | <code>static int classify_select(Cg *cg, const char *sel, int limit, Memory **out) {</code> |
| `cmd_memory_classify` | function | 729 | <code>int cmd_memory_classify(Cg *cg, const char *sel, int limit, bool json) {</code> |
| `memory_promote_branch` | function | 809 | <code>int memory_promote_branch(Cg *cg, const char *from, const char *to) {</code> |
| `PORT_FORMAT` | macro | 847 | <code>#define PORT_FORMAT  "codify-memories"</code> |
| `PORT_VERSION` | macro | 848 | <code>#define PORT_VERSION 1</code> |
| `memory_content_id` | function | 853 | <code>void memory_content_id(const char *type, const char *task, const char *body,</code> |
| `db_has` | function | 865 | <code>static bool db_has(sqlite3 *db, const char *sql, const char *a,</code> |
| `db_has_column` | function | 876 | <code>static bool db_has_column(sqlite3 *db, const char *table, const char *col) {</code> |
| `db_has_table` | function | 881 | <code>static bool db_has_table(sqlite3 *db, const char *table) {</code> |
| `port_str` | function | 886 | <code>static void port_str(StrBuf *b, const char *key, const char *v) {</code> |
| `port_export` | function | 895 | <code>static int port_export(sqlite3 *db, const char *project,</code> |
| `base_name` | function | 985 | <code>static const char *base_name(const char *path) {</code> |
| `cmd_memory_export` | function | 990 | <code>int cmd_memory_export(Cg *cg, const MemExportOpts *o, bool json) {</code> |
| `jv_value` | function | 1028 | <code>static const char *jv_value(const char *p, int depth);</code> |
| `jv_ws` | function | 1030 | <code>static const char *jv_ws(const char *p) {</code> |
| `jv_string` | function | 1035 | <code>static const char *jv_string(const char *p) {</code> |
| `jv_digits` | function | 1054 | <code>static const char *jv_digits(const char *p) {</code> |
| `jv_number` | function | 1060 | <code>static const char *jv_number(const char *p) {</code> |
| `jv_value` | function | 1072 | <code>static const char *jv_value(const char *p, int depth) {</code> |
| `json_object_ok` | function | 1099 | <code>static bool json_object_ok(const char *s) {</code> |
| `port_get_str` | function | 1107 | <code>static char *port_get_str(const char *obj, const char *key, bool *bad) {</code> |
| `PortRec` | typedef | 1116 | <code>typedef struct {</code> |
| `port_rec_free` | function | 1131 | <code>static void port_rec_free(PortRec *r) {</code> |
| `port_type_ok` | function | 1140 | <code>static bool port_type_ok(const char *t) {</code> |
| `port_parse_line` | function | 1150 | <code>static const char *port_parse_line(const char *s, PortRec *r) {</code> |
| `PortIn` | typedef | 1190 | <code>typedef struct {</code> |
| `port_bad_line` | function | 1198 | <code>static void port_bad_line(PortIn *in, int line, const char *why) {</code> |
| `port_parse` | function | 1210 | <code>static int port_parse(char *text, PortIn *in, char *err, size_t errcap) {</code> |
| `CidRow` | typedef | 1275 | <code>typedef struct { char cid[65]; long row; } CidRow;</code> |
| `cid_cmp` | function | 1277 | <code>static int cid_cmp(const void *a, const void *b) {</code> |
| `cid_row` | function | 1284 | <code>static long cid_row(const CidRow *v, int n, const char *cid) {</code> |
| `target_cids` | function | 1296 | <code>static int target_cids(Cg *cg, CidRow **out) {</code> |
| `port_from_dir` | function | 1316 | <code>static int port_from_dir(Cg *cg, const char *dir, StrBuf *out,</code> |
| `port_step` | function | 1352 | <code>static bool port_step(Cg *cg, sqlite3_stmt *st, char *err, size_t errcap) {</code> |
| `port_insert` | function | 1360 | <code>static bool port_insert(Cg *cg, PortRec *r, char *err, size_t errcap) {</code> |
| `port_relink` | function | 1390 | <code>static int port_relink(Cg *cg, PortIn *in, const CidRow *tv, int tn,</code> |
| `port_plan` | function | 1445 | <code>static void port_plan(Cg *cg, PortIn *in, const MemImportOpts *o,</code> |
| `port_read_input` | function | 1501 | <code>static int port_read_input(Cg *cg, const MemImportOpts *o, char **text,</code> |
| `cmd_memory_import` | function | 1523 | <code>int cmd_memory_import(Cg *cg, const MemImportOpts *o, bool json) {</code> |

## src/orchestrate.c

[Open source](../src/orchestrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ORCH_MAX_SLOTS` | macro | 28 | <code>#define ORCH_MAX_SLOTS 16</code> |
| `ORCH_MAX_ARGV` | macro | 29 | <code>#define ORCH_MAX_ARGV  64</code> |
| `orch_on_signal` | function | 33 | <code>static void orch_on_signal(int sig) {</code> |
| `OrchCfg` | typedef | 40 | <code>typedef struct {</code> |
| `orch_raw_str` | function | 54 | <code>static char *orch_raw_str(const Kvx *k, const char *sec, const char *key) {</code> |
| `orch_cfg_load` | function | 71 | <code>static void orch_cfg_load(const Kvx *wf, OrchCfg *c) {</code> |
| `orch_cfg_free` | function | 89 | <code>static void orch_cfg_free(OrchCfg *c) {</code> |
| `OrchSpecCall` | typedef | 97 | <code>typedef struct { int argc; char **argv; bool json; } OrchSpecCall;</code> |
| `orch_call_spec` | function | 99 | <code>static int orch_call_spec(void *v) {</code> |
| `orch_spec` | function | 112 | <code>static int orch_spec(char **out, bool json, int argc, ...) {</code> |
| `OrchResumeCall` | typedef | 122 | <code>typedef struct { Cg *g; const char *task; } OrchResumeCall;</code> |
| `orch_call_resume` | function | 124 | <code>static int orch_call_resume(void *v) {</code> |
| `orch_call_docs_packet` | function | 129 | <code>static int orch_call_docs_packet(void *v) {</code> |
| `orch_docs_ready` | function | 137 | <code>static bool orch_docs_ready(const char *id) {</code> |
| `orch_prompt_retry` | function | 157 | <code>static void orch_prompt_retry(const char *path, const char *feature,</code> |
| `orch_roles_load` | function | 160 | <code>static void orch_roles_load(const Hierarchy *h) {</code> |
| `orch_argv` | function | 177 | <code>static int orch_argv(const char *driver, const char *extra, const char *cmd,</code> |
| `orch_argv_free` | function | 190 | <code>static void orch_argv_free(char **av) {</code> |
| `orch_argv_print` | function | 194 | <code>static void orch_argv_print(char **av) {</code> |
| `orch_spec_root` | function | 207 | <code>static int orch_spec_root(char *out, size_t cap) {</code> |
| `orch_task_status` | function | 213 | <code>static char *orch_task_status(const char *specroot, const char *feature,</code> |
| `orch_abandon` | function | 254 | <code>static void orch_abandon(const char *specroot, const char *feature,</code> |
| `orch_event` | function | 289 | <code>static void orch_event(const char *kind, const char *role, const char *agent,</code> |
| `OE` | macro | 296 | <code>#define OE(k, v) do { if (v) { sb_puts(&amp;p, ",\"" k "\":"); \</code> |
| `orch_note_failure` | function | 311 | <code>static void orch_note_failure(const char *feature, const char *id, int rc) {</code> |
| `orch_prompt_steer` | function | 327 | <code>static void orch_prompt_steer(const char *path, const char *agent) {</code> |
| `orch_write_prompt` | function | 345 | <code>static int orch_write_prompt(const char *cgroot, const char *feature,</code> |
| `orch_spawn` | function | 379 | <code>static pid_t orch_spawn(char **av, const char *root, const char *promptfile,</code> |
| `orch_dry_run` | function | 415 | <code>static int orch_dry_run(const char *specroot, const char *cgroot,</code> |
| `OrchSlot` | typedef | 492 | <code>typedef struct {</code> |
| `orch_heartbeat` | function | 504 | <code>static int orch_heartbeat(OrchSlot *slot, long ttl_min) {</code> |
| `orch_live` | function | 520 | <code>static int orch_live(const OrchSlot *slots, int n) {</code> |
| `orch_reap` | function | 530 | <code>static int orch_reap(pid_t pid) {</code> |
| `FleetRunOpts` | typedef | 552 | <code>typedef struct { const char *run_id; const char *resume; bool all; } FleetRunOpts;</code> |
| `orch_fleet_run` | function | 553 | <code>static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,</code> |
| `cmd_spec_run` | function | 558 | <code>int cmd_spec_run(int argc, char **argv) {</code> |
| `ORCH_WAKE_BACKOFF` | macro | 965 | <code>#define ORCH_WAKE_BACKOFF  1          /* seconds between manager wakes */</code> |
| `ORCH_ROUNDS_DFLT` | macro | 966 | <code>#define ORCH_ROUNDS_DFLT   16          /* manager wakes before giving up */</code> |
| `orch_hier` | function | 970 | <code>static Kvx *orch_hier(const char *tree, Hierarchy *h) {</code> |
| `orch_worktree_path` | function | 981 | <code>static void orch_worktree_path(const Hierarchy *h, const char *tree,</code> |
| `orch_excerpt` | function | 992 | <code>static void orch_excerpt(const StrBuf *b, char *out, size_t cap) {</code> |
| `orch_ahead` | function | 1004 | <code>static long orch_ahead(const char *tree, const char *base, const char *branch) {</code> |
| `OrchEnv` | typedef | 1029 | <code>typedef struct { char *v[ORCH_ENVN]; } OrchEnv;</code> |
| `orch_env_save` | function | 1031 | <code>static void orch_env_save(OrchEnv *s) {</code> |
| `orch_env_restore` | function | 1038 | <code>static void orch_env_restore(OrchEnv *s) {</code> |
| `orch_env_apply` | function | 1047 | <code>static void orch_env_apply(const FleetNode *n) {</code> |
| `orch_agent_record` | function | 1067 | <code>static void orch_agent_record(Cg *g, const FleetNode *n) {</code> |
| `orch_fleet_exec` | function | 1094 | <code>static pid_t orch_fleet_exec(char **av, const FleetNode *n,</code> |
| `OrchTask` | typedef | 1141 | <code>typedef struct {</code> |
| `orch_tasks_free` | function | 1151 | <code>static void orch_tasks_free(OrchTask *v, int n) {</code> |
| `orch_tasks_load` | function | 1163 | <code>static int orch_tasks_load(Cg *cg, const char *feature, const char *fwt,</code> |
| `orch_task_wave` | function | 1251 | <code>static long orch_task_wave(Cg *cg, const char *feature, const char *id) {</code> |
| `OrchSubtree` | typedef | 1263 | <code>typedef struct {</code> |
| `orch_subtree` | function | 1271 | <code>static void orch_subtree(Cg *cg, const char *feature, const char *fbranch,</code> |
| `OrchPlanCall` | typedef | 1291 | <code>typedef struct { Cg *g; const char *feature; } OrchPlanCall;</code> |
| `orch_call_plan` | function | 1293 | <code>static int orch_call_plan(void *v) {</code> |
| `orch_manager_prompt` | function | 1311 | <code>static int orch_manager_prompt(Cg *cg, const FleetNode *n, const char *path) {</code> |
| `orch_spawn_manager` | function | 1347 | <code>int orch_spawn_manager(Cg *cg, const char *feature, const char *driver,</code> |
| `OrchBeginCall` | typedef | 1442 | <code>typedef struct { Cg *g; const char *id; const char *feature; } OrchBeginCall;</code> |
| `orch_call_begin` | function | 1444 | <code>static int orch_call_begin(void *v) {</code> |
| `orch_json_into` | function | 1457 | <code>static void orch_json_into(const char *js, const char *key, char *out,</code> |
| `orch_spawn_worker` | function | 1464 | <code>int orch_spawn_worker(Cg *cg, const char *feature, const char *id,</code> |
| `orch_ago` | function | 1590 | <code>static void orch_ago(long seen, char *out, size_t cap) {</code> |
| `OrchWorkerRow` | typedef | 1599 | <code>typedef struct {</code> |
| `orch_worker_rows` | function | 1606 | <code>static int orch_worker_rows(Cg *cg, const char *feature, OrchWorkerRow **out) {</code> |
| `orch_tree_status` | function | 1663 | <code>int orch_tree_status(Cg *cg, const char *feature_ov, bool json) {</code> |
| `OrchFleetSlot` | typedef | 1802 | <code>typedef struct {</code> |
| `orch_live_fleet` | function | 1818 | <code>static int orch_live_fleet(const OrchFleetSlot *s, int n) {</code> |
| `orch_finished_id` | function | 1824 | <code>static bool orch_finished_id(const OrchTask *v, int n, const char *id) {</code> |
| `orch_attempts` | function | 1837 | <code>static int orch_attempts(char **tried, int ntried, const char *id) {</code> |
| `orch_collides` | function | 1854 | <code>static bool orch_collides(const char *a, const char *b) {</code> |
| `orch_task_slots` | function | 1889 | <code>static bool orch_task_slots(const OrchTask *t, const OrchFleetSlot *slots,</code> |
| `orch_next_task` | function | 1900 | <code>static bool orch_next_task(const OrchTask *v, int n, char **tried, int ntried,</code> |
| `orch_node_heartbeat` | function | 1916 | <code>static int orch_node_heartbeat(const FleetNode *n, long ttl_min) {</code> |
| `proc_start_time` | function | 1930 | <code>static long proc_start_time(pid_t pid) {</code> |
| `proc_alive` | function | 1955 | <code>static bool proc_alive(pid_t pid, long start) {</code> |
| `sup_lock_path` | function | 1964 | <code>static int sup_lock_path(const char *shared, char *out, size_t cap) {</code> |
| `sup_lock_take` | function | 1971 | <code>static int sup_lock_take(const char *shared) {</code> |
| `fleet_supervisor_alive` | function | 1980 | <code>bool fleet_supervisor_alive(const char *shared) {</code> |
| `Sup` | typedef | 1988 | <code>typedef struct {</code> |
| `sup_event` | function | 2014 | <code>static void sup_event(Sup *s, const char *state, const char *reason) {</code> |
| `sup_save` | function | 2027 | <code>static void sup_save(Sup *s) {</code> |
| `sup_set_state` | function | 2041 | <code>static void sup_set_state(Sup *s, const char *state, const char *reason) {</code> |
| `sup_control` | function | 2057 | <code>static void sup_control(Sup *s) {</code> |
| `sup_node_add` | function | 2067 | <code>static long sup_node_add(Sup *s, const FleetNode *n, const char *log,</code> |
| `sup_node_end` | function | 2096 | <code>static void sup_node_end(Sup *s, long id, const char *state, int exit,</code> |
| `sup_gone` | function | 2115 | <code>static bool sup_gone(pid_t pid, long start, bool adopted, int *crc) {</code> |
| `sup_kill` | function | 2129 | <code>static void sup_kill(pid_t pid, long start, bool adopted) {</code> |
| `sup_terminate` | function | 2141 | <code>static void sup_terminate(Sup *s) {</code> |
| `sup_tap_adopt` | function | 2159 | <code>static void sup_tap_adopt(DriverTap *t, const char *log, const char *agent,</code> |
| `fleet_run_resume` | function | 2172 | <code>static int fleet_run_resume(Sup *s) {</code> |
| `COL` | macro | 2208 | <code>#define COL(i) ((const char *)sqlite3_column_text(st, i))</code> |
| `wall_ms_now` | function | 2263 | <code>static long wall_ms_now(void) {</code> |
| `sup_slot_begin` | function | 2269 | <code>static void sup_slot_begin(Cg *g, OrchFleetSlot *sl) {</code> |
| `sup_tree_fp` | function | 2281 | <code>static void sup_tree_fp(const char *wt, char out[65]) {</code> |
| `sup_progressed` | function | 2306 | <code>static bool sup_progressed(Sup *s, OrchFleetSlot *sl) {</code> |
| `sup_note` | function | 2334 | <code>static void sup_note(Sup *s, const char *kind, const OrchFleetSlot *sl,</code> |
| `HandoffCall` | typedef | 2348 | <code>typedef struct { Cg *cg; const char *task, *blocked, *note; } HandoffCall;</code> |
| `sup_handoff_call` | function | 2349 | <code>static int sup_handoff_call(void *v) {</code> |
| `sup_end_attempt` | function | 2357 | <code>static void sup_end_attempt(Sup *s, OrchFleetSlot *sl, const char *kind,</code> |
| `supervisor_budget_check` | function | 2374 | <code>static bool supervisor_budget_check(Sup *s, OrchFleetSlot *sl, long now) {</code> |
| `supervisor_stall_check` | function | 2395 | <code>static void supervisor_stall_check(Sup *s, OrchFleetSlot *sl, long now) {</code> |
| `sup_supervise` | function | 2427 | <code>static void sup_supervise(Sup *s) {</code> |
| `sup_esc_find` | function | 2438 | <code>static int sup_esc_find(Sup *s, const char *task) {</code> |
| `supervisor_escalate` | function | 2444 | <code>static void supervisor_escalate(Sup *s, const char *task, int level,</code> |
| `supervisor_retry` | function | 2498 | <code>static void supervisor_retry(Sup *s, const char *task, const char *why) {</code> |
| `sup_escalations_check` | function | 2505 | <code>static void sup_escalations_check(Sup *s, const OrchTask *v, int n) {</code> |
| `orch_prompt_retry` | function | 2524 | <code>static void orch_prompt_retry(const char *path, const char *feature,</code> |
| `sup_approval` | function | 2577 | <code>static int sup_approval(Sup *s, long *id) {</code> |
| `supervisor_tick` | function | 2592 | <code>static int supervisor_tick(Sup *s) {</code> |
| `run_id_new` | function | 2885 | <code>static void run_id_new(const char *feature, char *out, size_t cap) {</code> |
| `run_latest_open` | function | 2896 | <code>static bool run_latest_open(Cg *g, char *out, size_t cap, char *feature,</code> |
| `fleet_run_open` | function | 2913 | <code>static int fleet_run_open(Sup *s, const char *host) {</code> |
| `sup_feature_paths` | function | 2940 | <code>static void sup_feature_paths(Cg *g, const char *feature, char *fbranch,</code> |
| `feature_done` | function | 2953 | <code>static bool feature_done(Cg *g, const char *feature) {</code> |
| `feature_ready` | function | 2977 | <code>static bool feature_ready(Cg *g, const char *feature, char *waiting, size_t cap) {</code> |
| `features_open` | function | 2999 | <code>static int features_open(Cg *g, char ***out) {</code> |
| `sup_open` | function | 3030 | <code>static int sup_open(Cg *g, Sup *s, const char *feature, const OrchCfg *cfg,</code> |
| `sup_close` | function | 3090 | <code>static void sup_close(Sup *s) {</code> |
| `MainAgent` | typedef | 3105 | <code>typedef struct {</code> |
| `orch_main_prompt` | function | 3115 | <code>static int orch_main_prompt(Cg *g, const FleetNode *n, Sup *sups, int nsup,</code> |
| `orch_spawn_main` | function | 3158 | <code>static int orch_spawn_main(Cg *g, const char *driver, const char *extra,</code> |
| `main_wake` | function | 3190 | <code>static void main_wake(MainAgent *m, const char *reason) {</code> |
| `main_tick` | function | 3200 | <code>static void main_tick(Cg *g, MainAgent *m, Sup *sups, int nsup,</code> |
| `supervisor_run` | function | 3256 | <code>static int supervisor_run(Cg *g, char **features, int nfeat,</code> |
| `orch_fleet_run` | function | 3397 | <code>static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,</code> |
| `self_exe` | function | 3534 | <code>static void self_exe(char *out, size_t cap) {</code> |
| `RunRef` | typedef | 3542 | <code>typedef struct { char run[40], feature[128], state[16]; int pid; bool alive; } RunRef;</code> |
| `run_ref` | function | 3544 | <code>static bool run_ref(Cg *cg, const char *run, RunRef *r) {</code> |
| `run_state_set` | function | 3565 | <code>static void run_state_set(Cg *cg, const char *run, const char *state,</code> |
| `run_cleanup` | function | 3589 | <code>static int run_cleanup(Cg *cg, const char *run, const char *feature) {</code> |
| `Live` | typedef | 3595 | <code>typedef struct { long id; char role[16], agent[128], task[64], attempt[65];</code> |
| `pos_arg` | function | 3631 | <code>static const char *pos_arg(int argc, char **argv) {</code> |
| `detach_supervisor` | function | 3639 | <code>static int detach_supervisor(Cg *cg, char **pass, int npass,</code> |
| `cmd_fleet_up` | function | 3716 | <code>int cmd_fleet_up(Cg *cg, int argc, char **argv, bool json) {</code> |
| `cmd_fleet_control` | function | 3764 | <code>int cmd_fleet_control(Cg *cg, const char *verb, int argc, char **argv,</code> |
| `cmd_fleet_runs` | function | 3853 | <code>int cmd_fleet_runs(Cg *cg, bool json) {</code> |

## src/progress.c

[Open source](../src/progress.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FIRST_DRAW_MS` | macro | 28 | <code>#define FIRST_DRAW_MS  250</code> |
| `TTY_EVERY_MS` | macro | 29 | <code>#define TTY_EVERY_MS   100</code> |
| `PLAIN_EVERY_MS` | macro | 30 | <code>#define PLAIN_EVERY_MS 2000</code> |
| `WRITE_SLICE_MS` | macro | 31 | <code>#define WRITE_SLICE_MS 100</code> |
| `MAX_PHASES` | macro | 32 | <code>#define MAX_PHASES     8</code> |
| `active` | function | 53 | <code>static bool active(void) {</code> |
| `term_width` | function | 57 | <code>static int term_width(void) {</code> |
| `erase` | function | 66 | <code>static void erase(void) {</code> |
| `compose` | function | 74 | <code>static void compose(char *out, size_t cap, long now) {</code> |
| `ADD` | macro | 76 | <code>#define ADD(...) do { if (n &lt; cap) \</code> |
| `render` | function | 95 | <code>static void render(bool entered, bool force) {</code> |
| `at_exit_erase` | function | 132 | <code>static void at_exit_erase(void) { erase(); }</code> |
| `progress_request` | function | 134 | <code>void progress_request(bool want) {</code> |
| `progress_begin` | function | 151 | <code>void progress_begin(const IndexOpts *o) {</code> |
| `progress_step` | function | 160 | <code>void progress_step(const char *step) {</code> |
| `progress_phase` | function | 171 | <code>void progress_phase(const char *phase, long done, long total) {</code> |
| `progress_tick` | function | 182 | <code>void progress_tick(long done, long total, const char *path) {</code> |
| `progress_flush` | function | 191 | <code>void progress_flush(void) {</code> |
| `progress_workers` | function | 195 | <code>void progress_workers(int n) {</code> |
| `progress_wait` | function | 199 | <code>void progress_wait(const char *what, long waited_ms) {</code> |
| `progress_end` | function | 210 | <code>void progress_end(void) {</code> |
| `progress_begin_write` | function | 221 | <code>int progress_begin_write(Cg *cg) {</code> |

## src/recap.c

[Open source](../src/recap.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RECAP_DECIDE_MODEL` | macro | 48 | <code>#define RECAP_DECIDE_MODEL    "openrouter/upstage/solar-decide"</code> |
| `RECAP_DECIDE_ENDPOINT` | macro | 49 | <code>#define RECAP_DECIDE_ENDPOINT "https://gateway.centra.ag/v1/systemone"</code> |
| `RECAP_CHUNK` | macro | 50 | <code>#define RECAP_CHUNK           6       /* statements per call, 3 questions each; the</code> |
| `RECAP_CHUNK_CHARS` | macro | 53 | <code>#define RECAP_CHUNK_CHARS     9000</code> |
| `RECAP_PARALLEL` | macro | 54 | <code>#define RECAP_PARALLEL        6       /* decision calls in flight at once */</code> |
| `RECAP_MAX_SNIPPETS` | macro | 55 | <code>#define RECAP_MAX_SNIPPETS    160</code> |
| `RECAP_USER_MAX` | macro | 56 | <code>#define RECAP_USER_MAX        800</code> |
| `RECAP_ASSISTANT_MAX` | macro | 57 | <code>#define RECAP_ASSISTANT_MAX   400</code> |
| `RECAP_TOOL_MAX` | macro | 58 | <code>#define RECAP_TOOL_MAX        200</code> |
| `RECAP_KEEP_USERS` | macro | 59 | <code>#define RECAP_KEEP_USERS      50</code> |
| `RECAP_MIN_TRUE` | macro | 60 | <code>#define RECAP_MIN_TRUE        0.5</code> |
| `RECAP_MIN_NEED` | macro | 61 | <code>#define RECAP_MIN_NEED        0.5</code> |
| `Snip` | typedef | 65 | <code>typedef struct {</code> |
| `Session` | typedef | 73 | <code>typedef struct {</code> |
| `NKINDS` | macro | 98 | <code>#define NKINDS ((int)(sizeof KIND_KEYS / sizeof KIND_KEYS[0]))</code> |
| `KIND_NOISE` | macro | 99 | <code>#define KIND_NOISE (NKINDS - 1)</code> |
| `sess_push` | function | 101 | <code>static void sess_push(Session *s, char role, const char *text) {</code> |
| `sess_file` | function | 138 | <code>static void sess_file(Session *s, const char *path) {</code> |
| `sess_free` | function | 146 | <code>static void sess_free(Session *s) {</code> |
| `strip_blocks` | function | 158 | <code>static void strip_blocks(char *t, const char *tag) {</code> |
| `user_words` | function | 175 | <code>static char *user_words(const char *raw) {</code> |
| `assistant_words` | function | 211 | <code>static void assistant_words(Session *s, const char *text) {</code> |
| `EMIT` | macro | 217 | <code>#define EMIT(str) do { sess_push(s, 'a', (str)); if (clean.len) sb_putc(&amp;clean, ' '); sb_puts(&amp;clean, (str)); } while (0)</code> |
| `command_matters` | function | 259 | <code>static bool command_matters(const char *cmd) {</code> |
| `set_date` | function | 267 | <code>static void set_date(Session *s, const char *ts) {</code> |
| `claude_content` | function | 274 | <code>static void claude_content(Session *s, const char *msg, bool user) {</code> |
| `parse_claude` | function | 323 | <code>static int parse_claude(Session *s, FILE *f) {</code> |
| `codex_texts` | function | 351 | <code>static void codex_texts(Session *s, const char *content, char role) {</code> |
| `parse_codex` | function | 365 | <code>static int parse_codex(Session *s, FILE *f) {</code> |
| `Sessions` | typedef | 429 | <code>typedef struct { Session *v; int n, cap; } Sessions;</code> |
| `sessions_add` | function | 431 | <code>static void sessions_add(Sessions *ss, const Session *s) {</code> |
| `file_mtime` | function | 439 | <code>static long file_mtime(const char *path) {</code> |
| `claude_dir` | function | 446 | <code>static void claude_dir(const char *root, char *out, size_t cap) {</code> |
| `find_claude` | function | 457 | <code>static void find_claude(const char *root, long oldest, Sessions *out) {</code> |
| `codex_owned` | function | 478 | <code>static bool codex_owned(const char *path, const char *root) {</code> |
| `find_codex_in` | function | 497 | <code>static void find_codex_in(const char *dir, const char *root, long oldest,</code> |
| `find_codex` | function | 526 | <code>static void find_codex(const char *root, long oldest, Sessions *out) {</code> |
| `cmp_newest` | function | 537 | <code>static int cmp_newest(const void *a, const void *b) {</code> |
| `cmp_oldest` | function | 542 | <code>static int cmp_oldest(const void *a, const void *b) { return -cmp_newest(a, b); }</code> |
| `sess_cap` | function | 546 | <code>static void sess_cap(Session *s, int cap) {</code> |
| `Recap` | typedef | 566 | <code>typedef struct {</code> |
| `recap_config` | function | 575 | <code>static void recap_config(const Cg *cg, Recap *r) {</code> |
| `role_name` | function | 588 | <code>static const char *role_name(char r) {</code> |
| `chunk_state` | function | 595 | <code>static void chunk_state(const Session *s, int from, int to, StrBuf *b) {</code> |
| `cache_path` | function | 619 | <code>static void cache_path(const Recap *r, const char *state, char *out, size_t cap) {</code> |
| `cache_read` | function | 628 | <code>static bool cache_read(const char *path, Session *s, int from, int to) {</code> |
| `cache_write` | function | 647 | <code>static void cache_write(const char *path, const Session *s, int from, int to) {</code> |
| `decide_chunk` | function | 660 | <code>static int decide_chunk(Cg *cg, Recap *r, Session *s, int from, int to) {</code> |
| `Chunk` | typedef | 737 | <code>typedef struct { int sess, from, to; } Chunk;</code> |
| `chunks_of` | function | 739 | <code>static int chunks_of(const Sessions *ss, Chunk **out) {</code> |
| `chunk_cached` | function | 762 | <code>static bool chunk_cached(Recap *r, Session *s, const Chunk *c) {</code> |
| `decide_parallel` | function | 779 | <code>static void decide_parallel(Cg *cg, Recap *r, Sessions *ss, const Chunk *v, int n, int par) {</code> |
| `decide_all` | function | 797 | <code>static void decide_all(Cg *cg, Recap *r, Sessions *ss) {</code> |
| `Pick` | typedef | 819 | <code>typedef struct { int sess, idx; double score; } Pick;</code> |
| `snip_score` | function | 821 | <code>static double snip_score(const Snip *p) {</code> |
| `cmp_pick` | function | 827 | <code>static int cmp_pick(const void *a, const void *b) {</code> |
| `select_picks` | function | 834 | <code>static int select_picks(Sessions *ss, long budget) {</code> |
| `render_decided` | function | 859 | <code>static void render_decided(const Sessions *ss, const Recap *r, StrBuf *b) {</code> |
| `run_capture` | function | 887 | <code>static void run_capture(const char *cmd, StrBuf *out) {</code> |
| `repo_facts` | function | 896 | <code>static void repo_facts(Cg *cg, int since_days, StrBuf *b) {</code> |
| `write_brief` | function | 987 | <code>static char *write_brief(Cg *cg, Recap *r, const Sessions *ss, const char *facts,</code> |
| `agent_wanted` | function | 1031 | <code>static bool agent_wanted(const char *list, const char *agent) {</code> |
| `cmd_recap` | function | 1036 | <code>int cmd_recap(Cg *cg, const RecapOpts *o) {</code> |

## src/resolve.c

[Open source](../src/resolve.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ManifestDep` | typedef | 14 | <code>typedef struct { char *name; } ManifestDep;</code> |
| `Manifest` | typedef | 16 | <code>typedef struct {</code> |
| `manifest_add` | function | 22 | <code>static void manifest_add(Manifest *m, const char *name, size_t len) {</code> |
| `manifest_free` | function | 33 | <code>static void manifest_free(Manifest *m) {</code> |
| `manifest_has` | function | 39 | <code>static bool manifest_has(const Manifest *m, const char *module) {</code> |
| `load_package_json` | function | 54 | <code>static void load_package_json(const char *root, Manifest *js) {</code> |
| `load_go_mod` | function | 81 | <code>static void load_go_mod(const char *root, Manifest *go) {</code> |
| `load_requirements_txt` | function | 124 | <code>static void load_requirements_txt(const char *root, Manifest *py) {</code> |
| `load_pyproject_toml` | function | 152 | <code>static void load_pyproject_toml(const char *root, Manifest *py) {</code> |
| `load_cargo_toml` | function | 187 | <code>static void load_cargo_toml(const char *root, Manifest *rs) {</code> |
| `strip_ext` | function | 226 | <code>static void strip_ext(char *buf, size_t cap, const char *path) {</code> |
| `norm_dots` | function | 235 | <code>static void norm_dots(char *p) {</code> |
| `find_repo_file` | function | 265 | <code>static long find_repo_file(Cg *cg, const char *module, const char *from_path,</code> |
| `NEAR_MAX` | macro | 456 | <code>#define NEAR_MAX 32</code> |
| `NearManifest` | typedef | 457 | <code>typedef struct { char dir[1024]; Manifest m; bool exists; } NearManifest;</code> |
| `near_manifest_has` | function | 459 | <code>static bool near_manifest_has(Cg *cg, NearManifest *near, int *nnear,</code> |
| `node_core_module` | function | 485 | <code>static bool node_core_module(const char *module) {</code> |
| `mod_matches` | function | 506 | <code>static bool mod_matches(const char *module, const char *cand_path);</code> |
| `resolve_imports_run` | function | 517 | <code>static void resolve_imports_run(Cg *cg, bool scoped) {</code> |
| `resolve_imports` | function | 667 | <code>void resolve_imports(Cg *cg)        { resolve_imports_run(cg, false); }</code> |
| `resolve_imports_scoped` | function | 668 | <code>void resolve_imports_scoped(Cg *cg) { resolve_imports_run(cg, true); }</code> |
| `in_list` | function | 857 | <code>static bool in_list(const char *const *list, const char *name) {</code> |
| `in_names` | function | 865 | <code>static bool in_names(const char *names, const char *name) {</code> |
| `C_HDR_MAX` | macro | 886 | <code>#define C_HDR_MAX 64</code> |
| `C_HDR_LEN` | macro | 887 | <code>#define C_HDR_LEN 48</code> |
| `c_load_headers` | function | 894 | <code>static void c_load_headers(Cg *cg, long file_id) {</code> |
| `c_builtin` | function | 917 | <code>static bool c_builtin(Cg *cg, long file_id, const char *name) {</code> |
| `c_builtin_reset` | function | 929 | <code>static void c_builtin_reset(void) { c_hdrs.file_id = -1; c_hdrs.n = 0; }</code> |
| `is_resolving_lang` | function | 932 | <code>static bool is_resolving_lang(const char *lang) {</code> |
| `is_builtin` | function | 939 | <code>static bool is_builtin(Cg *cg, const char *lang, long file_id,</code> |
| `Cand` | typedef | 957 | <code>typedef struct {</code> |
| `find_candidates` | function | 962 | <code>static int find_candidates(Cg *cg, const char *name, Cand *out, int cap) {</code> |
| `path_stem` | function | 985 | <code>static size_t path_stem(const char *path, const char **out) {</code> |
| `cand_definition` | function | 999 | <code>static int cand_definition(const Cand *c, int nc, int pick) {</code> |
| `mod_matches` | function | 1027 | <code>static bool mod_matches(const char *module, const char *cand_path) {</code> |
| `ImpCache` | typedef | 1064 | <code>typedef struct { char name[128]; char module[256]; } ImpCache;</code> |
| `load_imports` | function | 1066 | <code>static int load_imports(Cg *cg, long file_id, ImpCache *out, int cap) {</code> |
| `resolve_refs_run` | function | 1089 | <code>static void resolve_refs_run(Cg *cg, bool scoped) {</code> |
| `resolve_refs` | function | 1277 | <code>void resolve_refs(Cg *cg)        { resolve_refs_run(cg, false); }</code> |
| `resolve_refs_scoped` | function | 1278 | <code>void resolve_refs_scoped(Cg *cg) { resolve_refs_run(cg, true); }</code> |
| `edit_distance` | function | 1283 | <code>static int edit_distance(const char *a, const char *b) {</code> |
| `near_miss` | function | 1301 | <code>static bool near_miss(Cg *cg, const char *name, char *out, size_t cap) {</code> |
| `file_calibrated` | function | 1327 | <code>bool file_calibrated(Cg *cg, long file_id, const char *lang) {</code> |
| `ground_findings` | function | 1387 | <code>int ground_findings(Cg *cg, const char *path, GroundFinding **out) {</code> |
| `ground_findings_free` | function | 1472 | <code>void ground_findings_free(GroundFinding *v, int n) {</code> |
| `kind_callable` | function | 1480 | <code>static bool kind_callable(const char *kind) {</code> |
| `contract_findings` | function | 1487 | <code>int contract_findings(Cg *cg, const char *path, ContractFinding **out) {</code> |
| `contract_findings_free` | function | 1557 | <code>void contract_findings_free(ContractFinding *v, int n) {</code> |
| `is_entrypoint` | function | 1565 | <code>bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,</code> |
| `hygiene_file` | function | 1614 | <code>static int hygiene_file(Cg *cg, const char *path, long file_id,</code> |
| `hygiene_findings` | function | 1680 | <code>int hygiene_findings(Cg *cg, const char *path, HygieneFinding **out) {</code> |
| `hygiene_findings_all` | function | 1698 | <code>int hygiene_findings_all(Cg *cg, HygieneFinding **out, int limit) {</code> |
| `hygiene_findings_free` | function | 1714 | <code>void hygiene_findings_free(HygieneFinding *v, int n) {</code> |

## src/routes.c

[Open source](../src/routes.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RoutePat` | typedef | 13 | <code>typedef struct {</code> |
| `NRP` | macro | 85 | <code>#define NRP ((int)(sizeof RP / sizeof RP[0]))</code> |
| `routes_global_init` | function | 87 | <code>void routes_global_init(void) {</code> |
| `lang_in` | function | 103 | <code>static bool lang_in(const char *langs, const char *lang) {</code> |
| `upcase` | function | 110 | <code>static void upcase(char *s) {</code> |
| `routes_scan_line` | function | 114 | <code>void routes_scan_line(const char *lang, const char *path, int lineno,</code> |
| `routes_scan_file` | function | 153 | <code>void routes_scan_file(const char *path, ParseResult *pr) {</code> |

## src/runtime.c

[Open source](../src/runtime.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GitState` | typedef | 13 | <code>typedef struct {</code> |
| `state_git` | function | 20 | <code>static void state_git(const Cg *cg, GitState *s) {</code> |
| `StateVcsCall` | typedef | 47 | <code>typedef struct { Cg *g; bool json; } StateVcsCall;</code> |
| `state_call_vcs` | function | 48 | <code>static int state_call_vcs(void *v) {</code> |
| `StateSpecCall` | typedef | 53 | <code>typedef struct { bool json; bool reconcile; } StateSpecCall;</code> |
| `state_call_spec` | function | 54 | <code>static int state_call_spec(void *v) {</code> |
| `state_raw_json` | function | 61 | <code>static void state_raw_json(StrBuf *b, const char *raw) {</code> |
| `state_live_attempt` | function | 70 | <code>static bool state_live_attempt(Cg *cg, const char *agent, SpecAttempt *a,</code> |
| `cmd_state` | function | 99 | <code>int cmd_state(Cg *cg, bool json) {</code> |
| `runtime_key_cmp` | function | 178 | <code>static int runtime_key_cmp(const void *a, const void *b) {</code> |
| `runtime_json_object_valid` | function | 186 | <code>static bool runtime_json_object_valid(const char *payload) {</code> |
| `runtime_canonical_json` | function | 220 | <code>static char *runtime_canonical_json(const char *payload) {</code> |
| `runtime_first_string` | function | 248 | <code>static char *runtime_first_string(const char *payload,</code> |
| `runtime_first_raw` | function | 258 | <code>static char *runtime_first_raw(const char *payload,</code> |
| `runtime_kind` | function | 268 | <code>static char *runtime_kind(const char *payload) {</code> |
| `RuntimeFile` | typedef | 286 | <code>typedef struct {</code> |
| `RuntimeFiles` | typedef | 293 | <code>typedef struct { RuntimeFile *v; int n, cap; } RuntimeFiles;</code> |
| `runtime_files_push` | function | 295 | <code>static void runtime_files_push(RuntimeFiles *files, const char *path,</code> |
| `runtime_walk_files` | function | 312 | <code>static void runtime_walk_files(const char *root, const char *rel,</code> |
| `runtime_file_cmp` | function | 337 | <code>static int runtime_file_cmp(const void *a, const void *b) {</code> |
| `runtime_workspace_revision` | function | 346 | <code>void runtime_workspace_revision(Cg *cg, char out[65]) {</code> |
| `RuntimeEventRow` | typedef | 421 | <code>typedef struct {</code> |
| `runtime_event_store` | function | 430 | <code>static int runtime_event_store(Cg *cg, const RuntimeEventRow *r,</code> |
| `runtime_journal_apply` | function | 468 | <code>int runtime_journal_apply(Cg *cg, const char *args, char *err,</code> |
| `runtime_event_queue` | function | 501 | <code>static bool runtime_event_queue(Cg *cg, const RuntimeEventRow *r) {</code> |
| `runtime_event_ingest` | function | 524 | <code>int runtime_event_ingest(Cg *cg, const char *source, const char *payload,</code> |
| `runtime_event_history` | function | 680 | <code>static int runtime_event_history(Cg *cg, int limit, bool json) {</code> |
| `RuntimeSample` | typedef | 737 | <code>typedef struct {</code> |
| `runtime_contains_ci` | function | 744 | <code>static bool runtime_contains_ci(const char *s, const char *needle) {</code> |
| `runtime_sample_failure` | function | 757 | <code>static bool runtime_sample_failure(const RuntimeSample *s) {</code> |
| `runtime_sample_waiting` | function | 776 | <code>static bool runtime_sample_waiting(const RuntimeSample *s) {</code> |
| `runtime_threshold` | function | 788 | <code>static int runtime_threshold(const char *name, int dflt, int floor) {</code> |
| `runtime_classify_progress` | function | 798 | <code>int runtime_classify_progress(Cg *cg, const char *attempt,</code> |
| `runtime_progress_fields` | function | 952 | <code>static void runtime_progress_fields(StrBuf *b, const RuntimeProgress *p) {</code> |
| `runtime_progress` | function | 971 | <code>int runtime_progress(Cg *cg, bool json) {</code> |
| `cmd_event` | function | 1043 | <code>int cmd_event(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/scan.c

[Open source](../src/scan.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MAX_FILE_BYTES` | macro | 13 | <code>#define MAX_FILE_BYTES (8L * 1024 * 1024)   /* larger files: skip entirely */</code> |
| `MAX_FTS_BYTES` | macro | 14 | <code>#define MAX_FTS_BYTES  (2L * 1024 * 1024)   /* larger: no body full-text */</code> |
| `RING_CAP` | macro | 15 | <code>#define RING_CAP 256</code> |
| `INDEX_CHUNK` | macro | 20 | <code>#define INDEX_CHUNK 96</code> |
| `Walked` | typedef | 25 | <code>typedef struct {</code> |
| `DbFile` | typedef | 29 | <code>typedef struct { char *path; long id, size, mtime; char hash[65]; } DbFile;</code> |
| `Done` | typedef | 31 | <code>typedef struct {</code> |
| `WalkList` | typedef | 44 | <code>typedef struct { Walked *v; int n, cap; } WalkList;</code> |
| `walk_push` | function | 46 | <code>static void walk_push(WalkList *wl, const char *rel, long size, long mtime) {</code> |
| `walk_dir` | function | 61 | <code>static void walk_dir(const char *root, const char *rel, const Ignore *ig,</code> |
| `walked_cmp` | function | 89 | <code>static int walked_cmp(const void *a, const void *b) {</code> |
| `dbfile_cmp` | function | 92 | <code>static int dbfile_cmp(const void *a, const void *b) {</code> |
| `Pipe` | typedef | 98 | <code>typedef struct {</code> |
| `ring_push` | function | 111 | <code>static void ring_push(Pipe *p, Done *d) {</code> |
| `producer_done` | function | 122 | <code>static void producer_done(Pipe *p) {</code> |
| `ring_pop` | function | 129 | <code>static bool ring_pop(Pipe *p, Done *out) {</code> |
| `worker` | function | 145 | <code>static void *worker(void *arg) {</code> |
| `Stmts` | typedef | 195 | <code>typedef struct {</code> |
| `stmts_init` | function | 210 | <code>static void stmts_init(Cg *cg, Stmts *s) {</code> |
| `step_reset` | function | 303 | <code>static void step_reset(sqlite3_stmt *st);</code> |
| `scope_record_file` | function | 309 | <code>static void scope_record_file(Stmts *s, long file_id, bool added) {</code> |
| `scope_name` | function | 329 | <code>static void scope_name(Stmts *s, const char *name) {</code> |
| `stmts_fin` | function | 335 | <code>static void stmts_fin(Stmts *s) {</code> |
| `step_reset` | function | 341 | <code>static void step_reset(sqlite3_stmt *st) {</code> |
| `purge_file_children` | function | 347 | <code>static void purge_file_children(Stmts *s, long file_id) {</code> |
| `index_copy_rows` | function | 362 | <code>static void index_copy_rows(Cg *cg, Stmts *s, long file_id, long from,</code> |
| `write_done` | function | 383 | <code>static void write_done(Cg *cg, Stmts *s, const Walked *w, Done *d,</code> |
| `soft_insert` | function | 632 | <code>static void soft_insert(sqlite3_stmt *ins, long file_id, int line,</code> |
| `probe` | function | 648 | <code>static bool probe(sqlite3_stmt *st, const char *tok, char *out, size_t cap) {</code> |
| `index_scope_begin` | function | 661 | <code>void index_scope_begin(Cg *cg) {</code> |
| `index_scope_end` | function | 671 | <code>void index_scope_end(Cg *cg) {</code> |
| `count_sql` | function | 676 | <code>static long count_sql(Cg *cg, const char *sql) {</code> |
| `index_scope_bounded` | function | 683 | <code>bool index_scope_bounded(Cg *cg) {</code> |
| `scope_anchor_files` | function | 696 | <code>static void scope_anchor_files(Cg *cg) {</code> |
| `SOFT_FROM` | macro | 751 | <code>#define SOFT_FROM "CASE WHEN s.decl=1 THEN NULL ELSE c.sym_id END"</code> |
| `anchor_edges_run` | function | 753 | <code>static void anchor_edges_run(Cg *cg, IndexStats *st, bool scoped) {</code> |
| `anchor_edges` | function | 848 | <code>static void anchor_edges(Cg *cg, IndexStats *st) {</code> |
| `anchor_edges_scoped` | function | 852 | <code>static void anchor_edges_scoped(Cg *cg, IndexStats *st) {</code> |
| `flush_chunk` | function | 859 | <code>static int flush_chunk(Cg *cg, Stmts *s, Walked *jobs, Done *chunk, int n,</code> |
| `target_rel` | function | 876 | <code>static bool target_rel(const char *root, const char *in, char *out, size_t cap) {</code> |
| `targets_cover` | function | 895 | <code>static bool targets_cover(char **t, int nt, const char *path) {</code> |
| `walk_targets` | function | 908 | <code>static void walk_targets(const char *root, const Ignore *ig, char **t, int nt,</code> |
| `note_targets` | function | 936 | <code>static int note_targets(const char *root, const char *note, char ***out,</code> |
| `targets_free` | function | 961 | <code>static void targets_free(char **t, int n) {</code> |
| `index_find_twins` | function | 972 | <code>static void index_find_twins(Cg *cg, WalkList *jobs, const IndexOpts *o) {</code> |
| `index_pass` | function | 1002 | <code>static int index_pass(Cg *cg, const SysInfo *si, const IndexOpts *o,</code> |
| `index_is_fresh` | function | 1178 | <code>static bool index_is_fresh(Cg *cg, long max_age_ms) {</code> |
| `index_report` | function | 1196 | <code>static void index_report(const IndexStats *st, const IndexOpts *o) {</code> |
| `cg_index_ex` | function | 1223 | <code>int cg_index_ex(Cg *cg, const SysInfo *si, const IndexOpts *o, IndexStats *st) {</code> |
| `cg_index` | function | 1408 | <code>int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet) {</code> |

## src/serve.c

[Open source](../src/serve.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SERVE_PROTOCOL` | macro | 31 | <code>#define SERVE_PROTOCOL  "codify-serve/1"</code> |
| `SERVE_MAX_JOBS` | macro | 32 | <code>#define SERVE_MAX_JOBS  32</code> |
| `SERVE_MAX_SUBS` | macro | 33 | <code>#define SERVE_MAX_SUBS  16</code> |
| `SERVE_BATCH` | macro | 34 | <code>#define SERVE_BATCH     500</code> |
| `SERVE_POLL_MS` | macro | 35 | <code>#define SERVE_POLL_MS   150     /* change check without inotify */</code> |
| `SERVE_SAFETY_MS` | macro | 36 | <code>#define SERVE_SAFETY_MS 1000    /* re-check even with inotify */</code> |
| `SERVE_MIN_GAP_MS` | macro | 37 | <code>#define SERVE_MIN_GAP_MS 15     /* coalesce a burst of WAL writes */</code> |
| `SERVE_OUT_CAP` | macro | 38 | <code>#define SERVE_OUT_CAP   (16L &lt;&lt; 20)</code> |
| `Sub` | typedef | 40 | <code>typedef struct {</code> |
| `Job` | typedef | 45 | <code>typedef struct {</code> |
| `mono_ms` | function | 57 | <code>static long mono_ms(void) {</code> |
| `send_raw` | function | 63 | <code>static void send_raw(const char *p, size_t n) {</code> |
| `send_msg` | function | 81 | <code>static void send_msg(StrBuf *b) {</code> |
| `reply` | function | 87 | <code>static void reply(const char *id, const char *result) {</code> |
| `reply_err` | function | 93 | <code>static void reply_err(const char *id, int code, const char *msg) {</code> |
| `set_nonblock` | function | 104 | <code>static void set_nonblock(int fd) {</code> |
| `job_spawn` | function | 109 | <code>static int job_spawn(Job *jobs, const Cg *cg, char **argv, const char *id,</code> |
| `job_drain` | function | 152 | <code>static bool job_drain(Job *j, int fd, StrBuf *b) {</code> |
| `job_finish` | function | 168 | <code>static void job_finish(Job *j, int status) {</code> |
| `Batch` | typedef | 203 | <code>typedef struct { StrBuf *b; int n; long last; } Batch;</code> |
| `batch_add` | function | 205 | <code>static int batch_add(const EventRow *e, void *ud) {</code> |
| `serve_push` | function | 213 | <code>static void serve_push(Cg *cg, Sub *s) {</code> |
| `Server` | typedef | 249 | <code>typedef struct {</code> |
| `raw_or` | function | 258 | <code>static char *raw_or(const char *obj, const char *key) {</code> |
| `serve_dispatch` | function | 262 | <code>static void serve_dispatch(Server *sv, const char *line) {</code> |
| `kill_jobs` | function | 383 | <code>static void kill_jobs(Job *jobs) {</code> |
| `cmd_serve` | function | 399 | <code>int cmd_serve(Cg *cg, const SysInfo *si) {</code> |

## src/sha256.c

[Open source](../src/sha256.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Sha256` | typedef | 4 | <code>typedef struct {</code> |
| `ROR` | macro | 25 | <code>#define ROR(x,n) (((x) &gt;&gt; (n)) &#124; ((x) &lt;&lt; (32 - (n))))</code> |
| `sha_block` | function | 27 | <code>static void sha_block(Sha256 *s, const uint8_t *p) {</code> |
| `sha256_hex` | function | 52 | <code>void sha256_hex(const void *data, size_t len, char out_hex[65]) {</code> |

## src/skills.c

[Open source](../src/skills.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SKILL_MARKER` | macro | 23 | <code>#define SKILL_MARKER "codify-owned: memory-skill v1"</code> |
| `SKILL_SLUG_MAX` | macro | 24 | <code>#define SKILL_SLUG_MAX 48</code> |
| `SkillFile` | typedef | 27 | <code>typedef struct { char rel[1200]; char slug[80]; long id; } SkillFile;</code> |
| `skill_title` | function | 30 | <code>static void skill_title(const Memory *m, char *out, size_t cap) {</code> |
| `skill_slug` | function | 45 | <code>static void skill_slug(const Memory *m, char *out, size_t cap) {</code> |
| `yaml_str` | function | 63 | <code>static void yaml_str(StrBuf *b, const char *s, size_t max) {</code> |
| `skill_memory_of` | function | 74 | <code>static long skill_memory_of(const char *body) {</code> |
| `skill_body` | function | 84 | <code>static char *skill_body(const Memory *m) {</code> |
| `skill_render` | function | 140 | <code>int skill_render(Cg *cg, const Memory *m, char *path_out, size_t cap) {</code> |
| `skill_scan` | function | 183 | <code>static int skill_scan(Cg *cg, SkillFile **out) {</code> |
| `skill_current` | function | 222 | <code>static bool skill_current(Cg *cg, const SkillFile *f, const Memory *m) {</code> |
| `skill_findings` | function | 233 | <code>int skill_findings(Cg *cg, char ***out) {</code> |
| `skill_candidates` | function | 266 | <code>static int skill_candidates(Cg *cg, Memory **out) {</code> |
| `skill_path_for` | function | 283 | <code>static const char *skill_path_for(const SkillFile *v, int n, long id) {</code> |
| `skill_row_json` | function | 288 | <code>static void skill_row_json(StrBuf *b, const Memory *m, const char *path,</code> |
| `skills_list` | function | 308 | <code>static int skills_list(Cg *cg, bool json) {</code> |
| `skills_promote` | function | 381 | <code>static int skills_promote(Cg *cg, const char *idstr, bool json) {</code> |
| `skills_render_all` | function | 432 | <code>static int skills_render_all(Cg *cg, bool json) {</code> |
| `cmd_skills` | function | 491 | <code>int cmd_skills(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/spec.c

[Open source](../src/spec.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SPEC_BANNER_DFLT` | macro | 27 | <code>#define SPEC_BANNER_DFLT "GENERATED by %s/specgen — DO NOT EDIT."</code> |
| `S` | function | 32 | <code>static char *S(const Kvx *k, const char *sec, const char *key) {</code> |
| `raw_is_list` | function | 37 | <code>static bool raw_is_list(const Kvx *k, const char *sec, const char *key) {</code> |
| `sb_humanize` | function | 45 | <code>static void sb_humanize(StrBuf *b, const char *k) {</code> |
| `count_dots` | function | 62 | <code>static int count_dots(const char *s) {</code> |
| `checkbox` | function | 68 | <code>static const char *checkbox(const char *status) {</code> |
| `uint_or` | function | 75 | <code>static unsigned long uint_or(const Kvx *k, const char *sec, const char *key,</code> |
| `FOR_KV` | macro | 87 | <code>#define FOR_KV(k, secname, prefix, idx) \</code> |
| `entry_val` | function | 92 | <code>static char *entry_val(const Kvx *k, int i) {           /* interpolated */</code> |
| `spec_find_root` | function | 96 | <code>static int spec_find_root(char *out, size_t cap) {</code> |
| `read_include` | function | 101 | <code>static char *read_include(const char *fdir, const char *rel) {</code> |
| `Writer` | typedef | 112 | <code>typedef struct {</code> |
| `writer_write` | function | 117 | <code>static int writer_write(Writer *w, const char *path, const char *content) {</code> |
| `build_brief` | function | 148 | <code>static char *build_brief(const Kvx *wf, const char *specrel) {</code> |
| `adapter_render` | function | 210 | <code>static char *adapter_render(const char *label, const char *brief,</code> |
| `render_requirements` | function | 232 | <code>static char *render_requirements(const Kvx *f, const char *banner) {</code> |
| `render_design` | function | 265 | <code>static char *render_design(const Kvx *f, const char *fdir, const char *banner,</code> |
| `render_wave_graph` | function | 319 | <code>static void render_wave_graph(const Kvx *f, char **ids, int nids, StrBuf *b) {</code> |
| `render_tasks` | function | 366 | <code>static char *render_tasks(const Kvx *f, const char *fdir, const char *banner,</code> |
| `OutFile` | typedef | 471 | <code>typedef struct { char *path, *content; } OutFile;</code> |
| `outfile_cmp` | function | 473 | <code>static int outfile_cmp(const void *a, const void *b) {</code> |
| `strp_cmp` | function | 477 | <code>static int strp_cmp(const void *a, const void *b) {</code> |
| `discover_features` | function | 481 | <code>static int discover_features(const char *specdir, char ***out) {</code> |
| `render_feature` | function | 505 | <code>static int render_feature(const char *root, const char *specdir,</code> |
| `spec_render` | function | 560 | <code>static int spec_render(const char *root, bool check, bool quiet) {</code> |
| `spec_render_json` | function | 630 | <code>static int spec_render_json(const char *root, bool check) {</code> |
| `Spec` | typedef | 639 | <code>typedef struct {</code> |
| `spec_close` | function | 648 | <code>static void spec_close(Spec *s) {</code> |
| `spec_load` | function | 656 | <code>static int spec_load(Spec *s, const char *root_ov, const char *feature_ov,</code> |
| `task_sec` | function | 701 | <code>static void task_sec(char *buf, size_t cap, const char *id) {</code> |
| `task_exists` | function | 705 | <code>static bool task_exists(const Spec *s, const char *id) {</code> |
| `task_status` | function | 712 | <code>static char *task_status(const Spec *s, const char *id) {</code> |
| `spec_mode_is` | function | 718 | <code>static bool spec_mode_is(const Spec *s, const char *want) {</code> |
| `spec_prod_mode` | function | 726 | <code>static bool spec_prod_mode(const Spec *s) {</code> |
| `spec_parallel_mode` | function | 732 | <code>static bool spec_parallel_mode(const Spec *s) {</code> |
| `task_is_leaf` | function | 736 | <code>static bool task_is_leaf(const Spec *s, const char *id);</code> |
| `spec_docs_mode` | function | 741 | <code>static char *spec_docs_mode(const Spec *s) {</code> |
| `spec_all_tasks_qualified` | function | 748 | <code>static bool spec_all_tasks_qualified(const Spec *s) {</code> |
| `spec_docs_stage` | function | 763 | <code>static char *spec_docs_stage(const Spec *s) {</code> |
| `spec_docs_ready` | function | 781 | <code>static bool spec_docs_ready(const Spec *s) {</code> |
| `spec_docs_set_status` | function | 788 | <code>static int spec_docs_set_status(Spec *s, const char *status) {</code> |
| `json_docs_task` | function | 796 | <code>static void json_docs_task(StrBuf *b, const Spec *s) {</code> |
| `print_docs_task` | function | 811 | <code>static void print_docs_task(const Spec *s) {</code> |
| `task_is_leaf` | function | 823 | <code>static bool task_is_leaf(const Spec *s, const char *id) {</code> |
| `task_satisfies_requires` | function | 830 | <code>static bool task_satisfies_requires(const Spec *s, const char *id) {</code> |
| `task_unmet` | function | 839 | <code>static int task_unmet(const Spec *s, const char *id, char **unmet, int cap) {</code> |
| `task_eligible` | function | 855 | <code>static bool task_eligible(const Spec *s, const char *id) {</code> |
| `spec_next_id` | function | 869 | <code>static const char *spec_next_id(const Spec *s) {</code> |
| `clause_text` | function | 883 | <code>static char *clause_text(const Spec *s, const char *clause) {</code> |
| `print_task` | function | 902 | <code>static void print_task(const Spec *s, const char *id) {</code> |
| `json_task` | function | 960 | <code>static void json_task(const Spec *s, const char *id, StrBuf *b) {</code> |
| `spec_current` | function | 1028 | <code>static const char *spec_current(const Spec *s) {</code> |
| `spec_in_progress_count` | function | 1038 | <code>static int spec_in_progress_count(const Spec *s) {</code> |
| `spec_attempt_sweep` | function | 1055 | <code>static void spec_attempt_sweep(Cg *g) {</code> |
| `spec_claim_begin` | function | 1089 | <code>static void spec_claim_begin(Cg *g) {</code> |
| `spec_attempt_next_fence` | function | 1097 | <code>static long spec_attempt_next_fence(Cg *g) {</code> |
| `spec_attempt_host` | function | 1107 | <code>static const char *spec_attempt_host(const char *host, char buf[256]) {</code> |
| `spec_attempt_session` | function | 1118 | <code>static const char *spec_attempt_session(const char *session) {</code> |
| `spec_attempt_begin` | function | 1127 | <code>static int spec_attempt_begin(Cg *g, const char *tag, const char *agent,</code> |
| `spec_attempt_set_branch` | function | 1173 | <code>int spec_attempt_set_branch(Cg *g, const char *tag, const char *branch,</code> |
| `spec_attempt_heartbeat` | function | 1192 | <code>static int spec_attempt_heartbeat(Cg *g, const char *tag, const char *agent,</code> |
| `spec_attempt_finish` | function | 1233 | <code>static void spec_attempt_finish(Cg *g, const char *tag, const char *state,</code> |
| `spec_attempt_owned` | function | 1245 | <code>static bool spec_attempt_owned(Cg *g, const char *tag, const char *agent,</code> |
| `spec_release_lease` | function | 1262 | <code>static void spec_release_lease(Spec *s, const char *id);</code> |
| `spec_queue_release` | function | 1268 | <code>static int spec_queue_release(Cg *g, const char *tag, const char *agent,</code> |
| `spec_require_owner` | function | 1295 | <code>static int spec_require_owner(Spec *s, const char *id, const char *agent,</code> |
| `spec_set_status_owned` | function | 1328 | <code>static int spec_set_status_owned(Spec *s, const char *id, const char *status,</code> |
| `spec_agent_leased` | function | 1385 | <code>static const char *spec_agent_leased(const Spec *s, const char *agent) {</code> |
| `spec_current_for_agent` | function | 1416 | <code>static const char *spec_current_for_agent(const Spec *s, const char *agent) {</code> |
| `spec_stale_tasks` | function | 1426 | <code>static int spec_stale_tasks(const Spec *s, const char ***out) {</code> |
| `join_list` | function | 1465 | <code>static char *join_list(const Kvx *k, const char *sec, const char *key) {</code> |
| `spec_note_outcome` | function | 1480 | <code>static void spec_note_outcome(Spec *s, const char *id, const char *body) {</code> |
| `spec_task_memories` | function | 1516 | <code>static int spec_task_memories(Spec *s, const char *id, Memory **out) {</code> |
| `spec_print_memories` | function | 1545 | <code>static void spec_print_memories(Spec *s, const char *id) {</code> |
| `spec_live_leases` | function | 1555 | <code>static int spec_live_leases(const Spec *s, StrBuf *b, bool json);</code> |
| `spec_status_cmd` | function | 1557 | <code>static int spec_status_cmd(Spec *s, bool json) {</code> |
| `spec_mode_cmd` | function | 1690 | <code>static int spec_mode_cmd(Spec *s, const char *mode, bool json) {</code> |
| `spec_next_cmd` | function | 1716 | <code>static int spec_next_cmd(Spec *s, bool json) {</code> |
| `spec_docs_verified` | function | 1771 | <code>static bool spec_docs_verified(const Spec *s) {</code> |
| `spec_docs_finish` | function | 1782 | <code>int spec_docs_finish(Cg *cg, const char *feature) {</code> |
| `spec_docs_cmd` | function | 1793 | <code>static int spec_docs_cmd(Spec *s, const char *action, const char *agent,</code> |
| `spec_globs_overlap` | function | 1938 | <code>bool spec_globs_overlap(const char *a, const char *b) {</code> |
| `spec_touches_conflict` | function | 1953 | <code>static bool spec_touches_conflict(Spec *s, const char *id, char *other,</code> |
| `spec_live_leases` | function | 2035 | <code>static int spec_live_leases(const Spec *s, StrBuf *b, bool json) {</code> |
| `spec_wave_cmd` | function | 2106 | <code>static int spec_wave_cmd(Spec *s, bool json) {</code> |
| `spec_lease_upsert` | function | 2164 | <code>static int spec_lease_upsert(Cg *g, const char *tag, const char *agent,</code> |
| `spec_release_lease` | function | 2192 | <code>static void spec_release_lease(Spec *s, const char *id) {</code> |
| `spec_heartbeat_cmd` | function | 2212 | <code>static int spec_heartbeat_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_reconcile_cmd` | function | 2313 | <code>static int spec_reconcile_cmd(Spec *s, bool repair, bool json) {</code> |
| `spec_claim_take` | function | 2361 | <code>static int spec_claim_take(Cg *g, Spec *s, const char *id, const char *agent,</code> |
| `spec_claim` | function | 2432 | <code>int spec_claim(Cg *g, const char *root, const char *feature, const char *id,</code> |
| `spec_claim_cmd` | function | 2450 | <code>static int spec_claim_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_ready_cmd` | function | 2551 | <code>static int spec_ready_cmd(Spec *s, bool json) {</code> |
| `spec_claim_next_cmd` | function | 2651 | <code>static int spec_claim_next_cmd(Spec *s, const char *agent, const char *host,</code> |
| `spec_start_cmd` | function | 2827 | <code>static int spec_start_cmd(Spec *s, const char *id, bool force, bool json) {</code> |
| `spec_verify_task` | function | 2918 | <code>static int spec_verify_task(Spec *s, const char *id);</code> |
| `spec_implemented_cmd` | function | 2920 | <code>static int spec_implemented_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_run_verify` | function | 3015 | <code>static int spec_run_verify(const char *root, const char *cmd, char *tail,</code> |
| `spec_done_cmd` | function | 3045 | <code>static int spec_done_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_journal_apply` | function | 3217 | <code>int spec_journal_apply(Cg *g, const char *op, const char *args, char *err,</code> |
| `spec_graph_open` | function | 3281 | <code>static bool spec_graph_open(Cg *g, bool sync) {</code> |
| `graph_symbol_row` | function | 3302 | <code>static void graph_symbol_row(sqlite3_stmt *st, char *path, size_t pcap,</code> |
| `path_has_qualifier` | function | 3313 | <code>static bool path_has_qualifier(const char *path, const char *segment,</code> |
| `qualified_path_score` | function | 3336 | <code>static int qualified_path_score(const char *qualified, const char *path) {</code> |
| `graph_symbol_named` | function | 3353 | <code>static int graph_symbol_named(Cg *g, const char *lookup,</code> |
| `graph_symbol` | function | 3396 | <code>static int graph_symbol(Cg *g, const char *name, char *path, size_t pcap,</code> |
| `task_tag` | function | 3408 | <code>static void task_tag(const Spec *s, const char *id, char *out, size_t cap) {</code> |
| `pattern_hit` | function | 3418 | <code>static bool pattern_hit(const char *pat, char **paths, int np) {</code> |
| `spec_verify_task` | function | 3438 | <code>static int spec_verify_task(Spec *s, const char *id) {</code> |
| `trace_task` | function | 3496 | <code>static void trace_task(Spec *s, Cg *g, bool have_graph, const char *id,</code> |
| `spec_trace_cmd` | function | 3629 | <code>static int spec_trace_cmd(Spec *s, const char *id, bool sync, bool json) {</code> |
| `spec_new_cmd` | function | 3771 | <code>static int spec_new_cmd(const char *root_ov, const char *feature, bool json) {</code> |
| `list_literal` | function | 3843 | <code>static char *list_literal(const char *csv) {</code> |
| `TaskSpec` | typedef | 3868 | <code>typedef struct {</code> |
| `spec_add_cmd` | function | 3875 | <code>static int spec_add_cmd(Spec *s, const char *id, const TaskSpec *t,</code> |
| `Lint` | typedef | 3952 | <code>typedef struct { StrBuf b; int errors, warnings; } Lint;</code> |
| `lint_say` | function | 3954 | <code>static void lint_say(Lint *l, bool error, const char *id, const char *fmt, ...) {</code> |
| `lint_cycle` | function | 3966 | <code>static bool lint_cycle(Spec *s, const char *id, char **stack, int depth,</code> |
| `spec_lint_cmd` | function | 3998 | <code>static int spec_lint_cmd(Spec *s, bool json) {</code> |
| `spec_active_touches` | function | 4115 | <code>int spec_active_touches(char ***out) {</code> |
| `spec_active_tag` | function | 4128 | <code>char *spec_active_tag(void) {</code> |
| `spec_task_tag` | function | 4148 | <code>char *spec_task_tag(const char *requested) {</code> |
| `spec_resolve_task` | function | 4183 | <code>char *spec_resolve_task(const char *requested, const char *agent) {</code> |
| `spec_load_tag` | function | 4219 | <code>static int spec_load_tag(Spec *s, const char *requested, const char **id_out) {</code> |
| `spec_task_packet` | function | 4229 | <code>char *spec_task_packet(const char *requested) {</code> |
| `spec_task_memories_tag` | function | 4248 | <code>int spec_task_memories_tag(const char *requested, Memory **out) {</code> |
| `cmd_spec` | function | 4264 | <code>int cmd_spec(int argc, char **argv, bool json) {</code> |

## src/syncgate.c

[Open source](../src/syncgate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GATE_POLL_MS` | macro | 38 | <code>#define GATE_POLL_MS 40</code> |
| `DIRTY_MAX_BYTES` | macro | 39 | <code>#define DIRTY_MAX_BYTES (256 * 1024)</code> |
| `gate_path` | function | 46 | <code>static void gate_path(const Cg *cg, const char *name, char *out, size_t cap) {</code> |
| `sleep_ms` | function | 57 | <code>static void sleep_ms(long ms) {</code> |
| `syncgate_acquire` | function | 64 | <code>int syncgate_acquire(const Cg *cg, long wait_ms) {</code> |
| `syncgate_release` | function | 83 | <code>void syncgate_release(int fd) {</code> |
| `dirty_lock` | function | 90 | <code>static int dirty_lock(const Cg *cg) {</code> |
| `syncgate_mark_dirty` | function | 100 | <code>void syncgate_mark_dirty(const Cg *cg, const char *const *paths, int npaths) {</code> |
| `syncgate_is_dirty` | function | 125 | <code>bool syncgate_is_dirty(const Cg *cg) {</code> |
| `syncgate_take_dirty` | function | 136 | <code>char *syncgate_take_dirty(const Cg *cg) {</code> |
| `slot_dir` | function | 154 | <code>static int slot_dir(char *out, size_t cap) {</code> |
| `syncgate_slot_count` | function | 165 | <code>int syncgate_slot_count(const SysInfo *si) {</code> |
| `syncgate_slot_acquire` | function | 173 | <code>int syncgate_slot_acquire(const SysInfo *si) {</code> |
| `syncgate_slot_release` | function | 188 | <code>void syncgate_slot_release(int fd) {</code> |
| `syncgate_worker_request` | function | 192 | <code>int syncgate_worker_request(const char *root, const SysInfo *si, int flag,</code> |
| `syncgate_worker_budget` | function | 214 | <code>int syncgate_worker_budget(const char *root, const SysInfo *si,</code> |
| `syncgate_background_nice` | function | 237 | <code>void syncgate_background_nice(void) {</code> |

## src/sysinfo.c

[Open source](../src/sysinfo.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `slurp` | function | 11 | <code>static char *slurp(const char *path) {</code> |
| `cgroup_cpu_quota` | function | 16 | <code>static double cgroup_cpu_quota(void) {</code> |
| `cgroup_mem_avail_kb` | function | 39 | <code>static long cgroup_mem_avail_kb(long *limit_kb_out) {</code> |
| `proc_meminfo` | function | 63 | <code>static void proc_meminfo(long *total_kb, long *avail_kb) {</code> |
| `sysinfo_detect` | function | 74 | <code>void sysinfo_detect(SysInfo *si) {</code> |

## src/util.c

[Open source](../src/util.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `path_format` | function | 5 | <code>bool path_format(char *out, size_t cap, const char *fmt, ...) {</code> |
| `xmalloc` | function | 24 | <code>void *xmalloc(size_t n) {</code> |
| `xrealloc` | function | 29 | <code>void *xrealloc(void *p, size_t n) {</code> |
| `xstrdup` | function | 34 | <code>char *xstrdup(const char *s) {</code> |
| `sb_init` | function | 41 | <code>void sb_init(StrBuf *b) { b-&gt;p = xmalloc(256); b-&gt;p[0] = 0; b-&gt;len = 0; b-&gt;cap = 256; }</code> |
| `sb_free` | function | 42 | <code>void sb_free(StrBuf *b) { free(b-&gt;p); b-&gt;p = NULL; b-&gt;len = b-&gt;cap = 0; }</code> |
| `sb_grow` | function | 43 | <code>static void sb_grow(StrBuf *b, size_t need) {</code> |
| `sb_putc` | function | 48 | <code>void sb_putc(StrBuf *b, char c) { sb_grow(b, 1); b-&gt;p[b-&gt;len++] = c; b-&gt;p[b-&gt;len] = 0; }</code> |
| `sb_puts` | function | 49 | <code>void sb_puts(StrBuf *b, const char *s) {</code> |
| `sb_printf` | function | 55 | <code>void sb_printf(StrBuf *b, const char *fmt, ...) {</code> |
| `sb_json_str` | function | 68 | <code>void sb_json_str(StrBuf *b, const char *s) {</code> |
| `sb_shquote` | function | 87 | <code>void sb_shquote(StrBuf *b, const char *s) {</code> |
| `cg_find_exe` | function | 96 | <code>bool cg_find_exe(const char *name, char *out, size_t cap) {</code> |
| `read_entire_file` | function | 118 | <code>char *read_entire_file(const char *path, size_t *out_len) {</code> |
| `hash_lines` | function | 147 | <code>void hash_lines(const char *data, size_t len, int from, int to,</code> |
| `name_words` | function | 164 | <code>void name_words(const char *name, char *out, size_t cap) {</code> |
| `write_entire_file` | function | 189 | <code>int write_entire_file(const char *path, const void *data, size_t len) {</code> |
| `mkdirs` | function | 213 | <code>int mkdirs(const char *path) {</code> |
| `cg_capture` | function | 228 | <code>int cg_capture(char **out, int (*fn)(void *), void *ctx) {</code> |
| `now_ms` | function | 253 | <code>long now_ms(void) {</code> |
| `looks_binary` | function | 259 | <code>bool looks_binary(const char *data, size_t len) {</code> |
| `path_ext` | function | 266 | <code>const char *path_ext(const char *path) {</code> |
| `cg_agent_name` | function | 276 | <code>const char *cg_agent_name(const char *flag) {</code> |
| `cg_agent_role` | function | 288 | <code>const char *cg_agent_role(const char *flag) {</code> |
| `cg_agent_parent` | function | 294 | <code>const char *cg_agent_parent(const char *flag) {</code> |
| `ig_add_flags` | function | 315 | <code>static void ig_add_flags(Ignore *ig, const char *pat, bool negate,</code> |
| `ig_add` | function | 329 | <code>static void ig_add(Ignore *ig, const char *pat) {</code> |
| `ig_load_file` | function | 337 | <code>static void ig_load_file(Ignore *ig, const char *path) {</code> |
| `ig_load_nested` | function | 367 | <code>static void ig_load_nested(Ignore *ig, const char *root, const char *reldir) {</code> |
| `ig_walk_gitignores` | function | 396 | <code>static void ig_walk_gitignores(Ignore *ig, const char *root,</code> |
| `ignore_load` | function | 420 | <code>void ignore_load(Ignore *ig, const char *root) {</code> |
| `pat_match` | function | 433 | <code>static bool pat_match(const char *pat, const char *text, bool anchored) {</code> |
| `ig_entry_hits` | function | 438 | <code>static bool ig_entry_hits(const IgnorePat *e, const char *rel,</code> |
| `ignore_match` | function | 461 | <code>bool ignore_match(const Ignore *ig, const char *rel, bool is_dir) {</code> |
| `ignore_free` | function | 486 | <code>void ignore_free(Ignore *ig) {</code> |

## src/vcs.c

[Open source](../src/vcs.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `obj_path` | function | 17 | <code>static void obj_path(const Cg *cg, const char *hash, char *out, size_t cap) {</code> |
| `obj_write` | function | 21 | <code>static int obj_write(const Cg *cg, const void *data, size_t len, char hash[65]) {</code> |
| `obj_read` | function | 33 | <code>static char *obj_read(const Cg *cg, const char *hash, size_t *len) {</code> |
| `head_read` | function | 39 | <code>static int head_read(const Cg *cg, char hash[65]) {</code> |
| `head_write` | function | 49 | <code>static void head_write(const Cg *cg, const char *hash) {</code> |
| `resolve_commit` | function | 56 | <code>static int resolve_commit(const Cg *cg, const char *ref, char out[65]) {</code> |
| `MEnt` | typedef | 84 | <code>typedef struct { char hash[65]; long size; char *path; } MEnt;</code> |
| `Manifest` | typedef | 85 | <code>typedef struct { MEnt *v; int n, cap; } Manifest;</code> |
| `man_push` | function | 87 | <code>static void man_push(Manifest *m, const char *hash, long size, const char *path) {</code> |
| `man_free` | function | 98 | <code>static void man_free(Manifest *m) {</code> |
| `ment_cmp` | function | 104 | <code>static int ment_cmp(const void *a, const void *b) {</code> |
| `snapshot_tree` | function | 109 | <code>static void snapshot_tree(const Cg *cg, Manifest *m, bool store) {</code> |
| `Frame` | typedef | 113 | <code>typedef struct { char rel[4096]; } Frame;</code> |
| `man_serialize` | function | 158 | <code>static char *man_serialize(const Manifest *m, size_t *len) {</code> |
| `man_load` | function | 166 | <code>static int man_load(const Cg *cg, const char *tree_hash, Manifest *m) {</code> |
| `Commit` | typedef | 186 | <code>typedef struct {</code> |
| `commit_load` | function | 192 | <code>static int commit_load(const Cg *cg, const char *hash, Commit *c) {</code> |
| `cmd_commit_with_options` | function | 208 | <code>int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,</code> |
| `cmd_commit` | function | 277 | <code>int cmd_commit(Cg *cg, const char *msg, bool quiet) {</code> |
| `cmd_log` | function | 281 | <code>int cmd_log(Cg *cg, int limit, bool json) {</code> |
| `TreeDiff` | typedef | 322 | <code>typedef struct { StrBuf added, modified, deleted; int na, nm, nd;</code> |
| `tree_status` | function | 325 | <code>static void tree_status(Cg *cg, TreeDiff *td, bool json) {</code> |
| `cmd_status` | function | 380 | <code>int cmd_status(Cg *cg, bool json) {</code> |
| `CHANGES_SYM_CAP` | macro | 411 | <code>#define CHANGES_SYM_CAP 40</code> |
| `CHANGES_CAL_CAP` | macro | 412 | <code>#define CHANGES_CAL_CAP 8</code> |
| `cmd_changes` | function | 414 | <code>int cmd_changes(Cg *cg, int limit, bool json) {</code> |
| `DLine` | typedef | 523 | <code>typedef struct { const char *s; size_t n; unsigned long h; } DLine;</code> |
| `split_dlines` | function | 525 | <code>static int split_dlines(char *data, size_t len, DLine **out) {</code> |
| `dl_eq` | function | 544 | <code>static bool dl_eq(const DLine *a, const DLine *b) {</code> |
| `emit_line` | function | 548 | <code>static void emit_line(StrBuf *b, char mark, const DLine *l) {</code> |
| `diff_blobs` | function | 557 | <code>static void diff_blobs(StrBuf *b, char *ad, size_t al, char *bd, size_t bl) {</code> |
| `Op` | typedef | 592 | <code>typedef struct { char mark; int ai, bi; } Op;</code> |
| `cmd_diff` | function | 630 | <code>int cmd_diff(Cg *cg, const char *ra, const char *rb) {</code> |
| `has_def` | function | 707 | <code>static bool has_def(const ParseResult *pr, const char *name, const char *kind) {</code> |
| `has_route` | function | 715 | <code>static bool has_route(const ParseResult *pr, const RouteDef *r) {</code> |
| `count_lines` | function | 723 | <code>static long count_lines(const char *d, size_t n) {</code> |
| `cmp_u64` | function | 731 | <code>static int cmp_u64(const void *a, const void *b) {</code> |
| `line_hashes` | function | 736 | <code>static uint64_t *line_hashes(const char *d, size_t n, long *count) {</code> |
| `line_delta` | function | 758 | <code>static void line_delta(const char *od, size_t ol, const char *nd, size_t nl,</code> |
| `changelog_file` | function | 775 | <code>static void changelog_file(Cg *cg, StrBuf *md, const char *path,</code> |
| `cmd_changelog` | function | 835 | <code>int cmd_changelog(Cg *cg, int limit, const char *outfile) {</code> |
| `cmd_checkout` | function | 985 | <code>int cmd_checkout(Cg *cg, const char *id, bool force) {</code> |
| `PathSet` | typedef | 1058 | <code>typedef struct { char **v; int n, cap; } PathSet;</code> |
| `ps_add` | function | 1060 | <code>static void ps_add(PathSet *p, const char *path) {</code> |
| `man_diff_paths` | function | 1071 | <code>static void man_diff_paths(const Manifest *a, const Manifest *b, PathSet *p) {</code> |
| `vcs_commits_for_path` | function | 1088 | <code>int vcs_commits_for_path(Cg *cg, const char *path, int limit, char ***ids,</code> |
| `vcs_find_commits` | function | 1139 | <code>int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,</code> |
| `vcs_changed_paths` | function | 1170 | <code>int vcs_changed_paths(Cg *cg, const char *needle, char ***out) {</code> |

## src/watch.c

[Open source](../src/watch.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Watch` | typedef | 18 | <code>typedef struct { int wd; char *rel; } Watch;</code> |
| `Watcher` | typedef | 19 | <code>typedef struct {</code> |
| `IN_MASK` | macro | 27 | <code>#define IN_MASK (IN_CREATE &#124; IN_CLOSE_WRITE &#124; IN_DELETE &#124; IN_MOVED_FROM &#124; \</code> |
| `watch_add_dir` | function | 30 | <code>static void watch_add_dir(Watcher *w, const char *rel) {</code> |
| `wd_rel` | function | 64 | <code>static const char *wd_rel(Watcher *w, int wd) {</code> |
| `WATCH_MAX_TARGETS` | macro | 74 | <code>#define WATCH_MAX_TARGETS 256</code> |
| `Pending` | typedef | 75 | <code>typedef struct { char **v; int n; bool whole; } Pending;</code> |
| `pending_add` | function | 77 | <code>static void pending_add(Pending *p, const char *rel) {</code> |
| `pending_clear` | function | 86 | <code>static void pending_clear(Pending *p) {</code> |
| `watch_drain` | function | 96 | <code>static bool watch_drain(Watcher *w, Pending *pend) {</code> |
| `watch_sync` | function | 124 | <code>static int watch_sync(Cg *cg, const SysInfo *si, const Pending *p,</code> |
| `watch_auto_off` | function | 139 | <code>static bool watch_auto_off(const char *root) {</code> |
| `cmd_watch` | function | 147 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
| `FleetWatch` | typedef | 220 | <code>typedef struct {</code> |
| `FLEET_POLL_MS` | macro | 232 | <code>#define FLEET_POLL_MS 3000</code> |
| `fleet_watch_open` | function | 234 | <code>static FleetWatch *fleet_watch_open(const Cg *parent, long id,</code> |
| `fleet_watch_close` | function | 259 | <code>static void fleet_watch_close(FleetWatch *f) {</code> |
| `fleet_scan` | function | 272 | <code>static void fleet_scan(Cg *cg, FleetWatch ***pv, int *pn) {</code> |
| `watch_fleet` | function | 328 | <code>int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
| `watch_fleet` | function | 396 | <code>int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
| `cmd_watch` | function | 403 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
