# Source reference

This is a source-navigation companion to the [architecture guide](ARCHITECTURE.md) and [contributor guide](../CONTRIBUTING.md), generated from Codify's own documentation evidence packet. It records indexed symbols, not promises that every symbol is public or stable. Static helpers, shared declarations, and JavaScript implementation details are included because the baseline coverage heuristic includes them.

The baseline contains 2317 observations in 47 files. Source links and line numbers refer to the checkout used for this documentation pass; rerun the workflow after implementation changes. The declaration column quotes the source line at the indexed location and may be only the first line of a multiline declaration. It is not an inferred behavioral contract.

For tests, deliberately invalid examples, and sample web routes, see the separate [test and fixture reference](TEST-REFERENCE.md). Go files under `kvx/impl/go/` are vendored reference tooling; the shipped `cg` build uses the C sources selected by the [Makefile](../Makefile).

## editors/vscode/acp.js

[Open source](../editors/vscode/acp.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AcpClient` | symbol | 29 | <code>function AcpClient(opts) {</code> |
| `extensionVersion` | symbol | 222 | <code>function extensionVersion() {</code> |
| `splitCommand` | symbol | 227 | <code>function splitCommand(s) {</code> |
| `normalizeCodexAdapterCommand` | symbol | 241 | <code>function normalizeCodexAdapterCommand(value) {</code> |
| `config` | symbol | 272 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `firstLine` | symbol | 274 | <code>function firstLine(s) {</code> |
| `driverId` | symbol | 279 | <code>function driverId(v) { return DRIVER_IDS.indexOf(v) &gt;= 0 ? v : 'codex'; }</code> |
| `diffStyle` | symbol | 283 | <code>function diffStyle() {</code> |
| `adapterCatalog` | symbol | 291 | <code>function adapterCatalog() {</code> |
| `custom` | symbol | 292 | <code>const custom = (config().get('acp.customCommand') &#124;&#124; '').trim();</code> |
| `adapterMap` | symbol | 303 | <code>function adapterMap() {</code> |
| `adapterCommand` | symbol | 314 | <code>function adapterCommand(override) {</code> |
| `custom` | symbol | 315 | <code>const custom = (config().get('acp.customCommand') &#124;&#124; '').trim();</code> |
| `rememberViewDriver` | symbol | 332 | <code>function rememberViewDriver(value) {</code> |
| `classifyUserText` | symbol | 345 | <code>function classifyUserText(raw) {</code> |
| `args` | symbol | 352 | <code>const args = (cmd[2] &#124;&#124; '').trim();</code> |
| `sessionTitle` | symbol | 363 | <code>function sessionTitle(raw) {</code> |
| `sessionRecord` | symbol | 379 | <code>function sessionRecord(row, driver) {</code> |
| `mergeSessionHistory` | symbol | 390 | <code>function mergeSessionHistory(rows, driver) {</code> |
| `rememberSession` | symbol | 407 | <code>function rememberSession(sess, extra) {</code> |
| `mcpServers` | symbol | 418 | <code>function mcpServers() {</code> |
| `workspacePath` | symbol | 426 | <code>function workspacePath(root, p) {</code> |
| `readTextFile` | symbol | 437 | <code>function readTextFile(root, params) {</code> |
| `writeTextFile` | symbol | 449 | <code>function writeTextFile(root, params) {</code> |
| `taskStatus` | symbol | 456 | <code>async function taskStatus(id) {</code> |
| `taskRow` | symbol | 466 | <code>async function taskRow(id) {</code> |
| `resumePrompt` | symbol | 477 | <code>async function resumePrompt(id) {</code> |
| `panelPost` | symbol | 497 | <code>function panelPost(sess, msg) {</code> |
| `panelHtml` | symbol | 501 | <code>function panelHtml(webview) {</code> |
| `sendPrompt` | symbol | 513 | <code>function sendPrompt(sess, text, echo) {</code> |
| `stopReason` | symbol | 534 | <code>const stopReason = (res &amp;&amp; res.stopReason) &#124;&#124; 'end_turn';</code> |
| `cancelTurn` | symbol | 560 | <code>function cancelTurn(sess) {</code> |
| `sessionRequest` | symbol | 568 | <code>function sessionRequest(sess, method, params) {</code> |
| `renderableToolCall` | symbol | 591 | <code>function renderableToolCall(call) {</code> |
| `sessionUpdate` | symbol | 617 | <code>function sessionUpdate(sess, params) {</code> |
| `u` | symbol | 618 | <code>const u = (params &amp;&amp; params.update) &#124;&#124; {};</code> |
| `endOfSession` | symbol | 682 | <code>async function endOfSession(sess, why) {</code> |
| `connectAgent` | symbol | 719 | <code>async function connectAgent(sess, driverOverride) {</code> |
| `publishConnectedSession` | symbol | 754 | <code>function publishConnectedSession(sess, res) {</code> |
| `connectSession` | symbol | 776 | <code>async function connectSession(sess, driverOverride) {</code> |
| `connectFailureHint` | symbol | 787 | <code>function connectFailureHint(sess, e) {</code> |
| `surfacePost` | symbol | 796 | <code>function surfacePost(sess, msg) {</code> |
| `openLocation` | symbol | 802 | <code>async function openLocation(p, line) {</code> |
| `openExternal` | symbol | 827 | <code>async function openExternal(href) {</code> |
| `boardInfo` | symbol | 871 | <code>async function boardInfo() {</code> |
| `runCgSlash` | symbol | 879 | <code>async function runCgSlash(sess, cmd, args, send) {</code> |
| `out` | symbol | 890 | <code>const out = ((r.stdout &#124;&#124; '') + (r.code === 0 ? '' : '\n' + (r.stderr &#124;&#124; ''))).trim();</code> |
| `ask` | symbol | 898 | <code>const ask = (spec.zero &amp;&amp; args) ? args : spec.ask;</code> |
| `attachTask` | symbol | 905 | <code>async function attachTask(sess, id) {</code> |
| `taskLifecycle` | symbol | 936 | <code>async function taskLifecycle(sess, verb, send) {</code> |
| `out` | symbol | 947 | <code>const out = ((r.stdout &#124;&#124; '') + (r.code === 0 ? '' : '\n' + (r.stderr &#124;&#124; ''))).trim();</code> |
| `pickTaskId` | symbol | 961 | <code>async function pickTaskId(placeHolder) {</code> |
| `items` | symbol | 963 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `handleSessionMessage` | symbol | 978 | <code>function handleSessionMessage(sess, msg) {</code> |
| `retryLast` | symbol | 1049 | <code>function retryLast(sess) {</code> |
| `showSessions` | symbol | 1067 | <code>async function showSessions(sess) {</code> |
| `switchSession` | symbol | 1076 | <code>async function switchSession(sess, sessionId, driver) {</code> |
| `sessionSlash` | symbol | 1089 | <code>async function sessionSlash(sess, cmd, args) {</code> |
| `newSession` | symbol | 1151 | <code>function newSession(webview, extra) {</code> |
| `openAgentPanel` | symbol | 1171 | <code>async function openAgentPanel(id, agent, promptText, claimed) {</code> |
| `startPanelSession` | symbol | 1222 | <code>async function startPanelSession(id) {</code> |
| `currentDriver` | symbol | 1261 | <code>function currentDriver() {</code> |
| `postView` | symbol | 1265 | <code>function postView(msg) {</code> |
| `viewIdle` | symbol | 1271 | <code>function viewIdle() { return !viewSession; }</code> |
| `focusView` | symbol | 1274 | <code>async function focusView() {</code> |
| `agentCapabilities` | symbol | 1284 | <code>function agentCapabilities(sess) {</code> |
| `listPastSessions` | symbol | 1291 | <code>async function listPastSessions(quiet) {</code> |
| `restorePastSession` | symbol | 1344 | <code>async function restorePastSession(sessionId, driver) {</code> |
| `startChatSession` | symbol | 1395 | <code>async function startChatSession(firstText, taskOpts, echo) {</code> |
| `startTaskInView` | symbol | 1432 | <code>async function startTaskInView(id) {</code> |
| `resetViewSession` | symbol | 1466 | <code>async function resetViewSession() {</code> |
| `postViewInit` | symbol | 1481 | <code>async function postViewInit() {</code> |
| `idleSlash` | symbol | 1505 | <code>async function idleSlash(cmd, args) {</code> |
| `chooseDriver` | symbol | 1552 | <code>async function chooseDriver(value) {</code> |
| `cmdConfigure` | symbol | 1574 | <code>async function cmdConfigure() {</code> |
| `registerAgentView` | symbol | 1612 | <code>function registerAgentView(ctx) {</code> |
| `resolveWebviewView` | symbol | 1614 | <code>resolveWebviewView(view) {</code> |
| `cmdOpenPanel` | symbol | 1666 | <code>async function cmdOpenPanel(arg) {</code> |
| `items` | symbol | 1670 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `cmdNewChat` | symbol | 1706 | <code>async function cmdNewChat() {</code> |
| `registerAcpCommands` | symbol | 1710 | <code>function registerAcpCommands(ctx) {</code> |
| `register` | symbol | 1721 | <code>function register(ctx, d) {</code> |

## editors/vscode/agents.js

[Open source](../editors/vscode/agents.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `config` | symbol | 32 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `firstLine` | symbol | 34 | <code>function firstLine(s) {</code> |
| `driverName` | symbol | 38 | <code>function driverName() {</code> |
| `driverBits` | symbol | 42 | <code>function driverBits() {</code> |
| `driverLaunch` | symbol | 54 | <code>function driverLaunch(promptfile) {</code> |
| `headlessLaunch` | symbol | 61 | <code>function headlessLaunch(promptfile) {</code> |
| `ensurePolling` | symbol | 71 | <code>function ensurePolling() {</code> |
| `stopPollingIfIdle` | symbol | 79 | <code>function stopPollingIfIdle() {</code> |
| `specMode` | symbol | 88 | <code>async function specMode() {</code> |
| `taskStatus` | symbol | 93 | <code>async function taskStatus(id) {</code> |
| `liveClaim` | symbol | 103 | <code>async function liveClaim(id) {</code> |
| `pickTask` | symbol | 108 | <code>async function pickTask(filter, placeHolder) {</code> |
| `items` | symbol | 110 | <code>const items = ((trace &amp;&amp; trace.tasks) &#124;&#124; [])</code> |
| `taskIdFrom` | symbol | 122 | <code>function taskIdFrom(arg) {</code> |
| `promptFileFor` | symbol | 130 | <code>async function promptFileFor(id) {</code> |
| `offerRelease` | symbol | 165 | <code>async function offerRelease(id, agent, exitCode) {</code> |
| `openTerminal` | symbol | 187 | <code>function openTerminal(id, agent, promptfile) {</code> |
| `runHeadless` | symbol | 198 | <code>function runHeadless(id, agent, promptfile) {</code> |
| `startAgentSession` | symbol | 220 | <code>async function startAgentSession(id, headless) {</code> |
| `cmdStartOnTask` | symbol | 266 | <code>async function cmdStartOnTask(arg) {</code> |
| `cmdStartHeadless` | symbol | 280 | <code>async function cmdStartHeadless(arg) {</code> |
| `cmdHandoff` | symbol | 287 | <code>async function cmdHandoff(arg) {</code> |
| `cmdResume` | symbol | 314 | <code>async function cmdResume(arg) {</code> |
| `cmdRunWave` | symbol | 335 | <code>async function cmdRunWave() {</code> |
| `cmdStop` | symbol | 348 | <code>async function cmdStop(arg) {</code> |
| `registerAgentCommands` | symbol | 379 | <code>function registerAgentCommands(ctx) {</code> |
| `register` | symbol | 393 | <code>function register(ctx, d) {</code> |
| `stripAnsi` | symbol | 461 | <code>function stripAnsi(text) {</code> |
| `diffLines` | symbol | 472 | <code>function diffLines(text) {</code> |
| `lcsRows` | symbol | 481 | <code>function lcsRows(a, b) {</code> |
| `trimContext` | symbol | 506 | <code>function trimContext(rows) {</code> |
| `diffRows` | symbol | 529 | <code>function diffRows(oldText, newText, maxRows) {</code> |
| `AgentPanel` | symbol | 564 | <code>class AgentPanel {</code> |
| `constructor` | symbol | 565 | <code>constructor(post) {</code> |
| `remember` | symbol | 576 | <code>remember(text, echo) {</code> |
| `retryTarget` | symbol | 580 | <code>retryTarget() { return this.last; }</code> |
| `beginTurn` | symbol | 582 | <code>beginTurn() {</code> |
| `endTurn` | symbol | 589 | <code>endTurn(stopReason) {</code> |
| `recordUsage` | symbol | 612 | <code>recordUsage(u) {</code> |
| `ask` | symbol | 645 | <code>ask(params) {</code> |
| `answer` | symbol | 668 | <code>answer(pid, optionId) {</code> |
| `settle` | symbol | 679 | <code>settle(why) {</code> |
| `pending` | symbol | 690 | <code>pending() { return this.permits.size; }</code> |
| `round6` | symbol | 693 | <code>function round6(n) {</code> |

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
| `revalidate` | symbol | 42 | <code>let revalidate = () =&gt; {};</code> |
| `serveConnected` | symbol | 55 | <code>function serveConnected() { return !!(serveClient &amp;&amp; serveClient.ready); }</code> |
| `config` | symbol | 69 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `binary` | symbol | 70 | <code>function binary() { return config().get('binaryPath') &#124;&#124; 'cg'; }</code> |
| `workspaceRoot` | symbol | 72 | <code>function workspaceRoot() {</code> |
| `cg` | symbol | 80 | <code>function cg(args) {</code> |
| `cgJson` | symbol | 96 | <code>async function cgJson(args) {</code> |
| `MemoryProvider` | symbol | 105 | <code>class MemoryProvider {</code> |
| `constructor` | symbol | 106 | <code>constructor() {</code> |
| `refresh` | symbol | 112 | <code>async refresh() {</code> |
| `getTreeItem` | symbol | 118 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | symbol | 120 | <code>getChildren() {</code> |
| `updateStatusBar` | symbol | 142 | <code>function updateStatusBar(model) {</code> |
| `updateScope` | symbol | 161 | <code>async function updateScope() {</code> |
| `show` | symbol | 174 | <code>function show(text) {</code> |
| `openReport` | symbol | 185 | <code>async function openReport(name, title, body) {</code> |
| `fence` | symbol | 196 | <code>function fence(text) {</code> |
| `pickTask` | symbol | 202 | <code>async function pickTask(statusFilter) {</code> |
| `taskIdFrom` | symbol | 221 | <code>function taskIdFrom(arg) {</code> |
| `autoSyncOn` | symbol | 233 | <code>async function autoSyncOn() {</code> |
| `runRefresh` | symbol | 246 | <code>async function runRefresh() {</code> |
| `scheduleRefresh` | symbol | 275 | <code>function scheduleRefresh(delayMs) {</code> |
| `afterMutation` | symbol | 279 | <code>function afterMutation() {</code> |
| `cmdStart` | symbol | 283 | <code>async function cmdStart(arg) {</code> |
| `cmdImplemented` | symbol | 295 | <code>async function cmdImplemented(arg) {</code> |
| `cmdDone` | symbol | 307 | <code>async function cmdDone(arg) {</code> |
| `cmdDocs` | symbol | 335 | <code>async function cmdDocs(action) {</code> |
| `cmdClaim` | symbol | 345 | <code>async function cmdClaim(arg) {</code> |
| `cmdRelease` | symbol | 359 | <code>async function cmdRelease(arg) {</code> |
| `cmdTrace` | symbol | 367 | <code>async function cmdTrace(arg) {</code> |
| `cmdNext` | symbol | 374 | <code>async function cmdNext() {</code> |
| `cmdWave` | symbol | 385 | <code>async function cmdWave() {</code> |
| `cmdRender` | symbol | 390 | <code>async function cmdRender() {</code> |
| `cmdLint` | symbol | 396 | <code>async function cmdLint() {</code> |
| `cmdNewFeature` | symbol | 408 | <code>async function cmdNewFeature() {</code> |
| `cmdAddTask` | symbol | 425 | <code>async function cmdAddTask() {</code> |
| `cmdBrief` | symbol | 455 | <code>async function cmdBrief() {</code> |
| `cmdReview` | symbol | 460 | <code>async function cmdReview() {</code> |
| `cmdCheck` | symbol | 467 | <code>async function cmdCheck() {</code> |
| `cmdGuard` | symbol | 476 | <code>async function cmdGuard() {</code> |
| `cmdTestImpact` | symbol | 482 | <code>async function cmdTestImpact() {</code> |
| `cmdWhy` | symbol | 494 | <code>async function cmdWhy() {</code> |
| `cmdRemember` | symbol | 504 | <code>async function cmdRemember() {</code> |
| `cmdForget` | symbol | 525 | <code>async function cmdForget(arg) {</code> |
| `cmdSnapshot` | symbol | 535 | <code>async function cmdSnapshot() {</code> |
| `cmdSync` | symbol | 545 | <code>async function cmdSync() {</code> |
| `cmdHookInstall` | symbol | 552 | <code>async function cmdHookInstall() {</code> |
| `cmdOpenTask` | symbol | 557 | <code>async function cmdOpenTask(id) {</code> |
| `cmdActions` | symbol | 573 | <code>async function cmdActions() {</code> |
| `activate` | symbol | 607 | <code>async function activate(ctx) {</code> |
| `bump` | symbol | 775 | <code>const bump = (uri) =&gt; {</code> |
| `deactivate` | symbol | 796 | <code>function deactivate() {</code> |

## editors/vscode/fleet.js

[Open source](../editors/vscode/fleet.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `relAge` | symbol | 48 | <code>function relAge(seen, now) {</code> |
| `mergeState` | symbol | 64 | <code>function mergeState(name, base, reg, exists) {</code> |
| `treeFacts` | symbol | 106 | <code>function treeFacts(tree) {</code> |
| `str` | symbol | 111 | <code>const str = (v) =&gt; (typeof v === 'string' &amp;&amp; v) ? v : null;</code> |
| `num` | symbol | 112 | <code>const num = (v) =&gt; (typeof v === 'number' &amp;&amp; Number.isFinite(v)) ? v : null;</code> |
| `t` | symbol | 117 | <code>const t = (m.tasks &amp;&amp; typeof m.tasks === 'object') ? m.tasks : {};</code> |
| `parentsFromTree` | symbol | 160 | <code>function parentsFromTree(tree) {</code> |
| `kids` | symbol | 163 | <code>const kids = (n) =&gt; [].concat(n.children &#124;&#124; [], n.managers &#124;&#124; [],</code> |
| `nameOf` | symbol | 166 | <code>const nameOf = (n) =&gt; typeof n.agent === 'string' ? n.agent</code> |
| `walk` | symbol | 168 | <code>const walk = (n, parent) =&gt; {</code> |
| `taskNode` | symbol | 189 | <code>function taskNode(id, claim, planned) {</code> |
| `fleetTree` | symbol | 222 | <code>function fleetTree(status, specStatus, branches, opts) {</code> |
| `arr` | symbol | 223 | <code>const arr = (v) =&gt; Array.isArray(v) ? v : [];</code> |
| `feature` | symbol | 243 | <code>const feature = (specStatus &amp;&amp; specStatus.feature) &#124;&#124;</code> |
| `seenOf` | symbol | 264 | <code>const seenOf = (name) =&gt; {</code> |
| `tasksOf` | symbol | 268 | <code>const tasksOf = (name) =&gt; {</code> |
| `claimFor` | symbol | 276 | <code>const claimFor = (id) =&gt; (claimsBy.get(name) &#124;&#124; []).find((c) =&gt; c.id === id);</code> |
| `waveTasks` | symbol | 287 | <code>const waveTasks = (name, planWave, live, held) =&gt; {</code> |
| `mainName` | symbol | 309 | <code>const mainName = (facts &amp;&amp; facts.main.agent) &#124;&#124; (mainRow &amp;&amp; mainRow.agent) &#124;&#124;</code> |
| `mainBranch` | symbol | 311 | <code>const mainBranch = (facts &amp;&amp; facts.main.branch) &#124;&#124;</code> |
| `addManager` | symbol | 317 | <code>const addManager = (agent, feat, live, seen, tf) =&gt; {</code> |
| `branch` | symbol | 319 | <code>const branch = (tf &amp;&amp; tf.branch) &#124;&#124;</code> |
| `base` | symbol | 322 | <code>const base = (tf &amp;&amp; tf.base) &#124;&#124; mainBranch;</code> |
| `live` | symbol | 349 | <code>const live = (m.seen &#124;&#124; 0) &gt; 0 &#124;&#124;</code> |
| `addWorker` | symbol | 367 | <code>const addWorker = (agent, feat, wave, live, seen, tf) =&gt; {</code> |
| `claim` | symbol | 376 | <code>const claim = (claimsBy.get(agent) &#124;&#124; [])[0];</code> |
| `branch` | symbol | 380 | <code>const branch = (tf &amp;&amp; tf.branch) &#124;&#124; (claim &amp;&amp; claim.branch) &#124;&#124;</code> |
| `base` | symbol | 382 | <code>const base = (tf &amp;&amp; tf.base) &#124;&#124; (planWave &amp;&amp; planWave.base) &#124;&#124;</code> |
| `live` | symbol | 406 | <code>const live = (w.heartbeat &#124;&#124; w.seen &#124;&#124; 0) &gt; 0 &#124;&#124;</code> |
| `managerFor` | symbol | 432 | <code>const managerFor = (feat) =&gt;</code> |
| `claim` | symbol | 437 | <code>const claim = (claimsBy.get(w.agent) &#124;&#124; [])[0];</code> |
| `byDotted` | symbol | 492 | <code>function byDotted(a, b) {</code> |
| `short` | symbol | 520 | <code>function short(s, n) {</code> |
| `withTimeout` | symbol | 525 | <code>function withTimeout(p, ms, onTimeout) {</code> |
| `FleetView` | symbol | 547 | <code>class FleetView {</code> |
| `constructor` | symbol | 548 | <code>constructor(deps) {</code> |
| `refresh` | symbol | 565 | <code>async refresh(specStatus) {</code> |
| `call` | symbol | 569 | <code>const call = (args) =&gt; withTimeout(cgJson(args), CALL_TIMEOUT_MS,</code> |
| `_done` | symbol | 600 | <code>_done() {</code> |
| `getTreeItem` | symbol | 613 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | symbol | 615 | <code>getChildren(el) {</code> |
| `noticeItem` | symbol | 629 | <code>noticeItem(label, icon, command) {</code> |
| `nodeItem` | symbol | 647 | <code>nodeItem(n) {</code> |
| `kids` | symbol | 648 | <code>const kids = (n.children &#124;&#124; []).map((c) =&gt; this.nodeItem(c))</code> |
| `agentIcon` | symbol | 688 | <code>agentIcon(n) {</code> |
| `agentTooltip` | symbol | 698 | <code>agentTooltip(n) {</code> |
| `taskItem` | symbol | 741 | <code>taskItem(t, owner) {</code> |
| `prItem` | symbol | 769 | <code>prItem(p) {</code> |
| `nodeOf` | symbol | 789 | <code>nodeOf(arg) { return arg &amp;&amp; arg.node ? arg.node : null; }</code> |
| `remember` | symbol | 794 | <code>remember(feature, pr) {</code> |
| `featureOf` | symbol | 808 | <code>function featureOf(node) {</code> |
| `run` | symbol | 814 | <code>async function run(args, title) {</code> |
| `parse` | symbol | 822 | <code>function parse(r) {</code> |
| `pickTask` | symbol | 828 | <code>async function pickTask(placeHolder) {</code> |
| `walk` | symbol | 832 | <code>const walk = (n) =&gt; {</code> |
| `taskIdOf` | symbol | 857 | <code>function taskIdOf(arg) {</code> |
| `cmdRefresh` | symbol | 864 | <code>async function cmdRefresh() {</code> |
| `cmdOpenWorktree` | symbol | 871 | <code>async function cmdOpenWorktree(arg) {</code> |
| `walk` | symbol | 876 | <code>const walk = (x) =&gt; {</code> |
| `cmdBegin` | symbol | 915 | <code>async function cmdBegin(arg) {</code> |
| `cmdMergeUp` | symbol | 935 | <code>async function cmdMergeUp(arg) {</code> |
| `cmdLand` | symbol | 970 | <code>async function cmdLand(arg) {</code> |
| `prFrom` | symbol | 1008 | <code>function prFrom(j) {</code> |
| `cmdOpenPr` | symbol | 1014 | <code>async function cmdOpenPr(arg) {</code> |
| `cmdCheckpoint` | symbol | 1051 | <code>async function cmdCheckpoint() {</code> |
| `register` | symbol | 1087 | <code>function register(ctx, d) {</code> |

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

## editors/vscode/memories.js

[Open source](../editors/vscode/memories.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `dayBound` | symbol | 38 | <code>function dayBound(value, end) {</code> |
| `fieldMatches` | symbol | 49 | <code>function fieldMatches(value, want) {</code> |
| `haystack` | symbol | 55 | <code>function haystack(m) {</code> |
| `memoryFilter` | symbol | 68 | <code>function memoryFilter(memories, filter) {</code> |
| `filterSource` | symbol | 99 | <code>function filterSource() {</code> |
| `panelHtml` | symbol | 109 | <code>function panelHtml(nonce) {</code> |
| `newNonce` | symbol | 115 | <code>function newNonce() {</code> |
| `output` | symbol | 119 | <code>function output(r) {</code> |
| `unsupported` | symbol | 126 | <code>function unsupported(r) {</code> |
| `jevKeyMissing` | symbol | 132 | <code>function jevKeyMissing(r) {</code> |
| `firstLine` | symbol | 136 | <code>function firstLine(r) {</code> |
| `skillFor` | symbol | 146 | <code>function skillFor(skills, id) {</code> |
| `classifyNote` | symbol | 154 | <code>function classifyNote(data, id) {</code> |
| `rows` | symbol | 155 | <code>const rows = (data &amp;&amp; Array.isArray(data.memories)) ? data.memories : [];</code> |
| `MemoryBrowser` | symbol | 165 | <code>class MemoryBrowser {</code> |
| `constructor` | symbol | 166 | <code>constructor(deps) {</code> |
| `open` | symbol | 178 | <code>open() {</code> |
| `dispose` | symbol | 199 | <code>dispose() {</code> |
| `post` | symbol | 203 | <code>post(msg) {</code> |
| `onMessage` | symbol | 257 | <code>async onMessage(msg) {</code> |
| `memory` | symbol | 297 | <code>memory(id) {</code> |
| `busy` | symbol | 301 | <code>busy(id, on, label) {</code> |
| `notice` | symbol | 305 | <code>notice(text, kind) {</code> |
| `openFile` | symbol | 311 | <code>async openFile(rel, line) {</code> |
| `openSymbol` | symbol | 329 | <code>async openSymbol(name) {</code> |
| `forget` | symbol | 344 | <code>async forget(id) {</code> |
| `supersede` | symbol | 364 | <code>async supersede(id) {</code> |
| `classify` | symbol | 391 | <code>async classify(id) {</code> |
| `classifyAll` | symbol | 408 | <code>async classifyAll() {</code> |
| `candidates` | symbol | 418 | <code>const candidates = (data &amp;&amp; data.candidates) &#124;&#124; [];</code> |
| `promote` | symbol | 430 | <code>async promote(id) {</code> |
| `file` | symbol | 438 | <code>const file = (data &amp;&amp; data.path) &#124;&#124; '';</code> |
| `openSkill` | symbol | 456 | <code>async openSkill(id) {</code> |
| `missing` | symbol | 481 | <code>missing(id) {</code> |
| `reportMissing` | symbol | 485 | <code>reportMissing(r, label) {</code> |
| `reloadAfterMutation` | symbol | 501 | <code>async reloadAfterMutation() {</code> |
| `pickMemory` | symbol | 510 | <code>async pickMemory(placeHolder) {</code> |
| `list` | symbol | 514 | <code>const list = (data &amp;&amp; data.memories) &#124;&#124; [];</code> |
| `idFrom` | symbol | 527 | <code>idFrom(arg) {</code> |
| `promoteFrom` | symbol | 534 | <code>async promoteFrom(arg) {</code> |
| `supersedeFrom` | symbol | 541 | <code>async supersedeFrom(arg) {</code> |
| `register` | symbol | 555 | <code>function register(ctx, deps) {</code> |

## editors/vscode/refresh.js

[Open source](../editors/vscode/refresh.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `createRefresher` | symbol | 18 | <code>function createRefresher(work, opts = {}) {</code> |
| `start` | symbol | 30 | <code>function start() {</code> |
| `schedule` | symbol | 55 | <code>function schedule(delayMs) {</code> |
| `dispose` | symbol | 74 | <code>function dispose() {</code> |

## editors/vscode/tasks.js

[Open source](../editors/vscode/tasks.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `stripComment` | symbol | 45 | <code>function stripComment(line) {</code> |
| `kvxUnquote` | symbol | 54 | <code>function kvxUnquote(raw) {</code> |
| `kvxList` | symbol | 62 | <code>function kvxList(raw) {</code> |
| `parseKvx` | symbol | 87 | <code>function parseKvx(text) {</code> |
| `readSpec` | symbol | 116 | <code>function readSpec(text) {</code> |
| `raw` | symbol | 118 | <code>const raw = (sec, key) =&gt; {</code> |
| `str` | symbol | 124 | <code>const str = (sec, key) =&gt; kvxUnquote(raw(sec, key) &#124;&#124; '');</code> |
| `list` | symbol | 125 | <code>const list = (sec, key) =&gt; kvxList(raw(sec, key) &#124;&#124; '');</code> |
| `requireMet` | symbol | 192 | <code>function requireMet(status, mode) {</code> |
| `asSymbols` | symbol | 197 | <code>function asSymbols(v) {</code> |
| `asTouches` | symbol | 201 | <code>function asTouches(v) {</code> |
| `mergeTasks` | symbol | 208 | <code>function mergeTasks(spec, trace, status, plan) {</code> |
| `mode` | symbol | 211 | <code>const mode = (status &amp;&amp; status.mode) &#124;&#124; 'standard';</code> |
| `feature` | symbol | 212 | <code>const feature = (spec &amp;&amp; spec.feature) &#124;&#124; (trace &amp;&amp; trace.feature) &#124;&#124;</code> |
| `statusOf` | symbol | 231 | <code>const statusOf = (id) =&gt; {</code> |
| `sp` | symbol | 239 | <code>const sp = (spec &amp;&amp; spec.byId.get(id)) &#124;&#124; {};</code> |
| `taskFilter` | symbol | 279 | <code>function taskFilter(rows, filter) {</code> |
| `haystack` | symbol | 308 | <code>function haystack(r) {</code> |
| `filterLabel` | symbol | 317 | <code>function filterLabel(filter) {</code> |
| `resumePrompt` | symbol | 336 | <code>function resumePrompt(row, opts) {</code> |
| `touches` | symbol | 359 | <code>const touches = (row.touches &#124;&#124; []).map((t) =&gt; t.pattern &#124;&#124; t);</code> |
| `symbols` | symbol | 361 | <code>const symbols = (row.symbols &#124;&#124; []).map((s) =&gt; s.name &#124;&#124; s);</code> |
| `mem` | symbol | 370 | <code>const mem = (row.memories &#124;&#124; []).slice(0, 5);</code> |
| `detailHtml` | symbol | 391 | <code>function detailHtml(nonce) {</code> |
| `detailView` | symbol | 745 | <code>function detailView(row, spec) {</code> |
| `blocked` | symbol | 749 | <code>const blocked = (row.blockers &#124;&#124; []).length &gt; 0;</code> |
| `clauses` | symbol | 750 | <code>const clauses = (spec &amp;&amp; spec.clauses) &#124;&#124; {};</code> |
| `icon` | symbol | 802 | <code>function icon(name, color) {</code> |
| `statusIcon` | symbol | 807 | <code>function statusIcon(row) {</code> |
| `statusWord` | symbol | 816 | <code>function statusWord(row) {</code> |
| `TaskTreeProvider` | symbol | 826 | <code>class TaskTreeProvider {</code> |
| `constructor` | symbol | 827 | <code>constructor(d) {</code> |
| `loadFilter` | symbol | 837 | <code>loadFilter() {</code> |
| `setFilter` | symbol | 844 | <code>setFilter(patch) {</code> |
| `describe` | symbol | 855 | <code>describe() {</code> |
| `visible` | symbol | 867 | <code>visible() { return taskFilter(this.rows, this.filter); }</code> |
| `refresh` | symbol | 872 | <code>async refresh() {</code> |
| `readSpecFile` | symbol | 891 | <code>readSpecFile(rel) {</code> |
| `fleetPlan` | symbol | 901 | <code>async fleetPlan() {</code> |
| `row` | symbol | 908 | <code>row(id) { return this.rows.find((r) =&gt; r.id === id); }</code> |
| `owners` | symbol | 910 | <code>owners() {</code> |
| `waves` | symbol | 914 | <code>waves() {</code> |
| `getTreeItem` | symbol | 920 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | symbol | 922 | <code>getChildren(el) {</code> |
| `featureNodes` | symbol | 931 | <code>featureNodes() {</code> |
| `docsNode` | symbol | 974 | <code>docsNode() {</code> |
| `sectionNodes` | symbol | 993 | <code>sectionNodes(rows, feature) {</code> |
| `waveNodes` | symbol | 1014 | <code>waveNodes(rows, parentKey) {</code> |
| `taskNode` | symbol | 1043 | <code>taskNode(row) {</code> |
| `tooltip` | symbol | 1063 | <code>tooltip(row) {</code> |
| `touches` | symbol | 1081 | <code>const touches = (row.touches &#124;&#124; []).map((t) =&gt; t.pattern).join(' ');</code> |
| `groupBy` | symbol | 1088 | <code>function groupBy(rows, key) {</code> |
| `taskDetail` | symbol | 1102 | <code>async function taskDetail(arg) {</code> |
| `postTask` | symbol | 1122 | <code>function postTask(id) {</code> |
| `refreshPanels` | symbol | 1139 | <code>function refreshPanels() {</code> |
| `panelMessage` | symbol | 1143 | <code>async function panelMessage(id, msg) {</code> |
| `openSymbol` | symbol | 1167 | <code>async function openSymbol(msg) {</code> |
| `text` | symbol | 1176 | <code>const text = (r.stdout &#124;&#124; '') + (r.stderr &#124;&#124; '');</code> |
| `openPath` | symbol | 1184 | <code>async function openPath(pattern) {</code> |
| `taskIdFrom` | symbol | 1203 | <code>function taskIdFrom(arg) {</code> |
| `resolveId` | symbol | 1212 | <code>async function resolveId(arg, placeHolder, filter) {</code> |
| `rows` | symbol | 1215 | <code>const rows = (provider ? provider.visible() : []).filter(filter &#124;&#124; (() =&gt; true));</code> |
| `cmdFilterStatus` | symbol | 1229 | <code>async function cmdFilterStatus() {</code> |
| `cmdFilterWave` | symbol | 1249 | <code>async function cmdFilterWave() {</code> |
| `cmdFilterOwner` | symbol | 1264 | <code>async function cmdFilterOwner() {</code> |
| `cmdSearch` | symbol | 1285 | <code>async function cmdSearch() {</code> |
| `cmdClearFilters` | symbol | 1295 | <code>function cmdClearFilters() {</code> |
| `cmdFilter` | symbol | 1300 | <code>async function cmdFilter() {</code> |
| `cmdVerify` | symbol | 1321 | <code>async function cmdVerify(arg) {</code> |
| `cmdOpenBranch` | symbol | 1345 | <code>async function cmdOpenBranch(arg) {</code> |
| `cmdCopyPrompt` | symbol | 1384 | <code>async function cmdCopyPrompt(arg) {</code> |
| `register` | symbol | 1399 | <code>function register(ctx, d) {</code> |

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
| `DirAgg` | symbol | 10 | <code>typedef struct { char name[128]; int files; long lines;</code> |
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
| `CG_VERSION` | symbol | 23 | <code>#define CG_VERSION  "1.1.0"</code> |
| `CG_MCP_VERSION` | symbol | 24 | <code>#define CG_MCP_VERSION "2025-11-25"</code> |
| `CG_AGENT_CONTEXT` | symbol | 25 | <code>#define CG_AGENT_CONTEXT ".codify/agent-context.md"</code> |
| `CG_DOC_TASK` | symbol | 26 | <code>#define CG_DOC_TASK "@docs"</code> |
| `CG_DOCS_DIR` | symbol | 27 | <code>#define CG_DOCS_DIR ".codegraph/docs"</code> |
| `SysInfo` | symbol | 30 | <code>typedef struct {</code> |
| `sysinfo_detect` | symbol | 44 | <code>void sysinfo_detect(SysInfo *si);</code> |
| `StrBuf` | symbol | 47 | <code>typedef struct { char *p; size_t len, cap; } StrBuf;</code> |
| `sb_init` | symbol | 48 | <code>void  sb_init(StrBuf *b);</code> |
| `sb_free` | symbol | 49 | <code>void  sb_free(StrBuf *b);</code> |
| `sb_putc` | symbol | 50 | <code>void  sb_putc(StrBuf *b, char c);</code> |
| `sb_puts` | symbol | 51 | <code>void  sb_puts(StrBuf *b, const char *s);</code> |
| `sb_printf` | symbol | 52 | <code>void  sb_printf(StrBuf *b, const char *fmt, ...);</code> |
| `sb_json_str` | symbol | 53 | <code>void  sb_json_str(StrBuf *b, const char *s);   /* emits "escaped" incl quotes */</code> |
| `sb_shquote` | symbol | 54 | <code>void  sb_shquote(StrBuf *b, const char *s);    /* 'single-quoted' for sh -c */</code> |
| `cg_find_exe` | symbol | 56 | <code>bool  cg_find_exe(const char *name, char *out, size_t cap);</code> |
| `xmalloc` | symbol | 58 | <code>void *xmalloc(size_t n);</code> |
| `xrealloc` | symbol | 59 | <code>void *xrealloc(void *p, size_t n);</code> |
| `xstrdup` | symbol | 60 | <code>char *xstrdup(const char *s);</code> |
| `read_entire_file` | symbol | 61 | <code>char *read_entire_file(const char *path, size_t *out_len); /* NUL-terminated */</code> |
| `write_entire_file` | symbol | 62 | <code>int   write_entire_file(const char *path, const void *data, size_t len);</code> |
| `mkdirs` | symbol | 63 | <code>int   mkdirs(const char *path);                 /* mkdir -p for dirs */</code> |
| `path_format` | symbol | 64 | <code>bool path_format(char *out, size_t cap, const char *fmt, ...)</code> |
| `now_ms` | symbol | 66 | <code>long  now_ms(void);</code> |
| `looks_binary` | symbol | 67 | <code>bool  looks_binary(const char *data, size_t len);</code> |
| `path_ext` | symbol | 68 | <code>const char *path_ext(const char *path);</code> |
| `cg_agent_name` | symbol | 70 | <code>const char *cg_agent_name(const char *flag);</code> |
| `cg_agent_role` | symbol | 72 | <code>const char *cg_agent_role(const char *flag);</code> |
| `cg_agent_parent` | symbol | 73 | <code>const char *cg_agent_parent(const char *flag);</code> |
| `sha256_hex` | symbol | 76 | <code>void sha256_hex(const void *data, size_t len, char out_hex[65]);</code> |
| `hash_lines` | symbol | 82 | <code>void hash_lines(const char *data, size_t len, int from, int to,</code> |
| `name_words` | symbol | 88 | <code>void name_words(const char *name, char *out, size_t cap);</code> |
| `IgnorePat` | symbol | 91 | <code>typedef struct {</code> |
| `Ignore` | symbol | 98 | <code>typedef struct {</code> |
| `ignore_load` | symbol | 102 | <code>void ignore_load(Ignore *ig, const char *root);</code> |
| `ignore_match` | symbol | 103 | <code>bool ignore_match(const Ignore *ig, const char *rel, bool is_dir);</code> |
| `ignore_free` | symbol | 104 | <code>void ignore_free(Ignore *ig);</code> |
| `MAX_DEFS_PER_LINE` | symbol | 107 | <code>#define MAX_DEFS_PER_LINE 4</code> |
| `SymDef` | symbol | 109 | <code>typedef struct {</code> |
| `SymRef` | symbol | 118 | <code>typedef struct {</code> |
| `ImportDef` | symbol | 129 | <code>typedef struct {</code> |
| `RouteDef` | symbol | 136 | <code>typedef struct {</code> |
| `CmtDef` | symbol | 148 | <code>typedef struct {</code> |
| `ParseResult` | symbol | 155 | <code>typedef struct {</code> |
| `lang_for_path` | symbol | 165 | <code>const char *lang_for_path(const char *path);       /* NULL if not source */</code> |
| `lang_parse` | symbol | 166 | <code>void lang_parse(const char *lang, const char *path, const char *src,</code> |
| `parse_result_free` | symbol | 168 | <code>void parse_result_free(ParseResult *pr);</code> |
| `lang_global_init` | symbol | 169 | <code>void lang_global_init(void);                        /* compile all regexes once */</code> |
| `routes_global_init` | symbol | 172 | <code>void routes_global_init(void);</code> |
| `routes_scan_file` | symbol | 173 | <code>void routes_scan_file(const char *path, ParseResult *pr);</code> |
| `routes_scan_line` | symbol | 174 | <code>void routes_scan_line(const char *lang, const char *path, int lineno,</code> |
| `route_add` | symbol | 176 | <code>void route_add(ParseResult *pr, const char *framework, const char *method,</code> |
| `Cg` | symbol | 180 | <code>typedef struct {</code> |
| `CG_EXIT_BUSY` | symbol | 218 | <code>#define CG_EXIT_BUSY 75</code> |
| `cg_open` | symbol | 220 | <code>int  cg_open(Cg *cg, bool create);                 /* finds root upward */</code> |
| `cg_begin_write` | symbol | 224 | <code>int  cg_begin_write(Cg *cg);</code> |
| `cg_lock_wait_default` | symbol | 225 | <code>long cg_lock_wait_default(void);                   /* CG_BUSY_TIMEOUT_MS */</code> |
| `cg_busy_report` | symbol | 228 | <code>void cg_busy_report(const char *what);</code> |
| `cg_close` | symbol | 229 | <code>void cg_close(Cg *cg);</code> |
| `cg_find_root` | symbol | 233 | <code>int  cg_find_root(char *out, size_t cap);</code> |
| `cg_find_root_at` | symbol | 235 | <code>int  cg_find_root_at(const char *start, char *out, size_t cap);</code> |
| `cg_find_project_at` | symbol | 240 | <code>int  cg_find_project_at(const char *start, char *root, char *shared,</code> |
| `cg_bkey` | symbol | 244 | <code>void cg_bkey(const Cg *cg, const char *name, char *out, size_t cap);</code> |
| `cg_is_boundary` | symbol | 246 | <code>bool cg_is_boundary(const char *dir);</code> |
| `cmd_root` | symbol | 247 | <code>int  cmd_root(bool json);                          /* print the bound root */</code> |
| `cg_prep` | symbol | 248 | <code>sqlite3_stmt *cg_prep(Cg *cg, const char *sql);</code> |
| `cg_exec` | symbol | 249 | <code>void cg_exec(Cg *cg, const char *sql);</code> |
| `cg_meta_set` | symbol | 250 | <code>void cg_meta_set(Cg *cg, const char *k, const char *v);</code> |
| `cg_meta_get` | symbol | 251 | <code>char *cg_meta_get(Cg *cg, const char *k);          /* malloc'd or NULL */</code> |
| `cg_schema_upgrade` | symbol | 254 | <code>int  cg_schema_upgrade(Cg *cg);</code> |
| `CG_CONFIG_FILE` | symbol | 262 | <code>#define CG_CONFIG_FILE "codify.kvx"</code> |
| `CgConfig` | symbol | 265 | <code>typedef struct {</code> |
| `config_load` | symbol | 275 | <code>const CgConfig *config_load(const char *root);</code> |
| `config_auto_sync` | symbol | 276 | <code>bool config_auto_sync(const char *root);</code> |
| `config_spec_rel` | symbol | 277 | <code>const char *config_spec_rel(const char *root);     /* "spec" */</code> |
| `config_context_rel` | symbol | 278 | <code>const char *config_context_rel(const char *root);  /* ".codify" */</code> |
| `config_skills_rel` | symbol | 279 | <code>const char *config_skills_rel(const char *root);   /* ".agents/skills" */</code> |
| `config_codemap_rel` | symbol | 280 | <code>const char *config_codemap_rel(const char *root);  /* "CODEMAP.md" */</code> |
| `config_spec_dir` | symbol | 282 | <code>bool config_spec_dir(const char *root, char *out, size_t cap);</code> |
| `config_workflow_path` | symbol | 283 | <code>bool config_workflow_path(const char *root, char *out, size_t cap);</code> |
| `config_feature_path` | symbol | 284 | <code>bool config_feature_path(const char *root, const char *feature, char *out,</code> |
| `config_context_dir` | symbol | 286 | <code>bool config_context_dir(const char *root, char *out, size_t cap);</code> |
| `config_context_path` | symbol | 287 | <code>bool config_context_path(const char *root, const char *name, char *out,</code> |
| `config_skills_dir` | symbol | 289 | <code>bool config_skills_dir(const char *root, char *out, size_t cap);</code> |
| `config_codemap_path` | symbol | 290 | <code>bool config_codemap_path(const char *root, char *out, size_t cap);</code> |
| `config_in_spec` | symbol | 292 | <code>bool config_in_spec(const char *root, const char *rel);</code> |
| `config_find_spec_root` | symbol | 294 | <code>int  config_find_spec_root(const char *start, char *out, size_t cap);</code> |
| `config_check` | symbol | 298 | <code>int  config_check(const char *root, StrBuf *text, StrBuf *json);</code> |
| `cmd_config` | symbol | 299 | <code>int  cmd_config(int argc, char **argv, bool json);</code> |
| `IndexStats` | symbol | 302 | <code>typedef struct {</code> |
| `IndexOpts` | symbol | 325 | <code>typedef struct {</code> |
| `cg_index_ex` | symbol | 346 | <code>int cg_index_ex(Cg *cg, const SysInfo *si, const IndexOpts *o, IndexStats *st);</code> |
| `cg_index` | symbol | 348 | <code>int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet);</code> |
| `syncgate_acquire` | symbol | 351 | <code>int  syncgate_acquire(const Cg *cg, long wait_ms);     /* fd or -1 */</code> |
| `syncgate_release` | symbol | 352 | <code>void syncgate_release(int fd);</code> |
| `syncgate_mark_dirty` | symbol | 353 | <code>void syncgate_mark_dirty(const Cg *cg, const char *const *paths, int npaths);</code> |
| `syncgate_is_dirty` | symbol | 354 | <code>bool syncgate_is_dirty(const Cg *cg);</code> |
| `syncgate_take_dirty` | symbol | 355 | <code>char *syncgate_take_dirty(const Cg *cg);               /* malloc'd or NULL */</code> |
| `syncgate_slot_count` | symbol | 356 | <code>int  syncgate_slot_count(const SysInfo *si);</code> |
| `syncgate_slot_acquire` | symbol | 357 | <code>int  syncgate_slot_acquire(const SysInfo *si);         /* fd or -1 */</code> |
| `syncgate_slot_release` | symbol | 358 | <code>void syncgate_slot_release(int fd);</code> |
| `syncgate_worker_budget` | symbol | 359 | <code>int  syncgate_worker_budget(const SysInfo *si, const IndexOpts *o, int jobs,</code> |
| `syncgate_background_nice` | symbol | 361 | <code>void syncgate_background_nice(void);</code> |
| `resolve_imports` | symbol | 364 | <code>void resolve_imports(Cg *cg);</code> |
| `resolve_refs` | symbol | 365 | <code>void resolve_refs(Cg *cg);</code> |
| `resolve_imports_scoped` | symbol | 370 | <code>void resolve_imports_scoped(Cg *cg);</code> |
| `resolve_refs_scoped` | symbol | 371 | <code>void resolve_refs_scoped(Cg *cg);</code> |
| `index_scope_begin` | symbol | 374 | <code>void index_scope_begin(Cg *cg);</code> |
| `index_scope_end` | symbol | 375 | <code>void index_scope_end(Cg *cg);</code> |
| `index_scope_bounded` | symbol | 378 | <code>bool index_scope_bounded(Cg *cg);</code> |
| `GroundFinding` | symbol | 381 | <code>typedef struct {</code> |
| `ground_findings` | symbol | 390 | <code>int ground_findings(Cg *cg, const char *path, GroundFinding **out);</code> |
| `ground_findings_free` | symbol | 391 | <code>void ground_findings_free(GroundFinding *v, int n);</code> |
| `file_calibrated` | symbol | 392 | <code>bool file_calibrated(Cg *cg, long file_id, const char *lang);</code> |
| `ContractFinding` | symbol | 395 | <code>typedef struct {</code> |
| `contract_findings` | symbol | 403 | <code>int contract_findings(Cg *cg, const char *path, ContractFinding **out);</code> |
| `contract_findings_free` | symbol | 404 | <code>void contract_findings_free(ContractFinding *v, int n);</code> |
| `HygieneFinding` | symbol | 407 | <code>typedef struct {</code> |
| `hygiene_findings` | symbol | 415 | <code>int hygiene_findings(Cg *cg, const char *path, HygieneFinding **out);</code> |
| `hygiene_findings_all` | symbol | 416 | <code>int hygiene_findings_all(Cg *cg, HygieneFinding **out, int limit);</code> |
| `hygiene_findings_free` | symbol | 417 | <code>void hygiene_findings_free(HygieneFinding *v, int n);</code> |
| `is_entrypoint` | symbol | 418 | <code>bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,</code> |
| `cmd_search` | symbol | 422 | <code>int cmd_search (Cg *cg, const char *q, int limit, bool json);</code> |
| `cmd_symbol` | symbol | 423 | <code>int cmd_symbol (Cg *cg, const char *name, bool json);</code> |
| `cmd_impact` | symbol | 424 | <code>int cmd_impact (Cg *cg, const char *name, int depth, int budget, bool json);</code> |
| `cmd_context` | symbol | 425 | <code>int cmd_context(Cg *cg, const char *q, int budget, int limit, bool json);</code> |
| `graph_task_focus` | symbol | 426 | <code>char *graph_task_focus(Cg *cg, const char *task_packet); /* malloc'd query */</code> |
| `graph_symbol_brief` | symbol | 429 | <code>int  graph_symbol_brief(Cg *cg, const char *name, int snippet_lines,</code> |
| `graph_glob_symbols` | symbol | 432 | <code>int  graph_glob_symbols(Cg *cg, const char *glob, int max_files, int max_syms,</code> |
| `task_packet_build` | symbol | 438 | <code>int  task_packet_build(Cg *cg, const char *tag, int budget, StrBuf *out);</code> |
| `manager_packet_build` | symbol | 440 | <code>int  manager_packet_build(Cg *cg, const char *feature, int budget, StrBuf *out);</code> |
| `packet_upstream_evidence` | symbol | 443 | <code>int  packet_upstream_evidence(Cg *cg, const char *feature, const char *req,</code> |
| `cmd_survey` | symbol | 446 | <code>int cmd_survey(Cg *cg, const char *scope, int budget, bool json);</code> |
| `cmd_anchors` | symbol | 448 | <code>int cmd_anchors(Cg *cg, bool stale_only, bool unc_only, bool json);</code> |
| `cmd_routes` | symbol | 449 | <code>int cmd_routes (Cg *cg, const char *filter, bool json);</code> |
| `cmd_show` | symbol | 450 | <code>int cmd_show   (Cg *cg, const char *name, bool full, bool json); /* one body */</code> |
| `cmd_test_impact` | symbol | 451 | <code>int cmd_test_impact(Cg *cg, const char *name, bool json);</code> |
| `cmd_why` | symbol | 452 | <code>int cmd_why    (Cg *cg, const char *name, bool json);   /* provenance join */</code> |
| `graph_path_is_test` | symbol | 453 | <code>bool graph_path_is_test(const char *path);</code> |
| `graph_symbol_at` | symbol | 455 | <code>int  graph_symbol_at(Cg *cg, const char *path, int line, char *name, size_t cap);</code> |
| `branch_scope_sql` | symbol | 464 | <code>const char *branch_scope_sql(const Cg *cg, const char *alias, char *out,</code> |
| `cg_scope_set` | symbol | 468 | <code>int  cg_scope_set(Cg *cg, const char *name, bool all);</code> |
| `branch_hit_label` | symbol | 472 | <code>const char *branch_hit_label(Cg *cg, long branch_id, char *out, size_t cap);</code> |
| `branch_tree` | symbol | 476 | <code>const char *branch_tree(Cg *cg, long branch_id, char *out, size_t cap);</code> |
| `cmd_commit` | symbol | 479 | <code>int cmd_commit  (Cg *cg, const char *msg, bool quiet);</code> |
| `cmd_commit_with_options` | symbol | 480 | <code>int cmd_commit_with_options(Cg *cg, const char *msg, bool quiet,</code> |
| `cmd_log` | symbol | 482 | <code>int cmd_log     (Cg *cg, int limit, bool json);</code> |
| `cmd_status` | symbol | 483 | <code>int cmd_status  (Cg *cg, bool json);</code> |
| `cmd_state` | symbol | 484 | <code>int cmd_state   (Cg *cg, bool json);              /* Git/snapshot/spec/live */</code> |
| `cmd_event` | symbol | 485 | <code>int cmd_event(Cg *cg, int argc, char **argv, bool json);</code> |
| `runtime_event_ingest` | symbol | 486 | <code>int runtime_event_ingest(Cg *cg, const char *source, const char *payload,</code> |
| `runtime_workspace_revision` | symbol | 488 | <code>void runtime_workspace_revision(Cg *cg, char out[65]);</code> |
| `RuntimeProgress` | symbol | 489 | <code>typedef struct {</code> |
| `runtime_classify_progress` | symbol | 495 | <code>int runtime_classify_progress(Cg *cg, const char *attempt,</code> |
| `runtime_progress` | symbol | 497 | <code>int runtime_progress(Cg *cg, bool json);</code> |
| `cmd_diff` | symbol | 498 | <code>int cmd_diff    (Cg *cg, const char *a, const char *b);</code> |
| `cmd_checkout` | symbol | 499 | <code>int cmd_checkout(Cg *cg, const char *id, bool force);</code> |
| `cmd_changes` | symbol | 500 | <code>int cmd_changes (Cg *cg, int limit, bool json); /* impact of uncommitted edits */</code> |
| `vcs_find_commits` | symbol | 506 | <code>int vcs_find_commits(Cg *cg, const char *needle, char ***ids, char ***msgs,</code> |
| `vcs_changed_paths` | symbol | 510 | <code>int vcs_changed_paths(Cg *cg, const char *needle, char ***out);</code> |
| `vcs_commits_for_path` | symbol | 513 | <code>int vcs_commits_for_path(Cg *cg, const char *path, int limit, char ***ids,</code> |
| `Memory` | symbol | 517 | <code>typedef struct {</code> |
| `memory_add` | symbol | 531 | <code>long memory_add(Cg *cg, const char *type, const char *task, const char *body,</code> |
| `memory_query` | symbol | 535 | <code>int  memory_query(Cg *cg, const char *query, const char *task,</code> |
| `memory_clear` | symbol | 537 | <code>void memory_clear(Memory *m);            /* free one entry's fields */</code> |
| `memory_free` | symbol | 538 | <code>void memory_free(Memory *v, int n);</code> |
| `memory_json` | symbol | 539 | <code>void memory_json(const Memory *m, StrBuf *b);</code> |
| `memory_print_brief` | symbol | 540 | <code>void memory_print_brief(const Memory *m, const char *indent);</code> |
| `memory_open_quiet` | symbol | 542 | <code>bool memory_open_quiet(Cg *g);</code> |
| `cmd_remember` | symbol | 543 | <code>int  cmd_remember(Cg *cg, const char *text, const char *type, const char *task,</code> |
| `cmd_recall` | symbol | 545 | <code>int  cmd_recall(Cg *cg, const char *query, const char *task, const char *type,</code> |
| `cmd_forget` | symbol | 547 | <code>int  cmd_forget(Cg *cg, const char *idstr);</code> |
| `memory_supersede` | symbol | 548 | <code>int  memory_supersede(Cg *cg, long old_id, long new_id);</code> |
| `cmd_recall_near` | symbol | 549 | <code>int  cmd_recall_near(Cg *cg, const char *path, int limit, bool json);</code> |
| `cmd_memory_compact` | symbol | 550 | <code>int  cmd_memory_compact(Cg *cg, bool dry_run, bool json);</code> |
| `memory_promote_branch` | symbol | 555 | <code>int  memory_promote_branch(Cg *cg, const char *from, const char *to);</code> |
| `memory_content_id` | symbol | 559 | <code>void memory_content_id(const char *type, const char *task, const char *body,</code> |
| `MemExportOpts` | symbol | 561 | <code>typedef struct {</code> |
| `MemImportOpts` | symbol | 567 | <code>typedef struct {</code> |
| `cmd_memory_export` | symbol | 574 | <code>int  cmd_memory_export(Cg *cg, const MemExportOpts *o, bool json);</code> |
| `cmd_memory_import` | symbol | 577 | <code>int  cmd_memory_import(Cg *cg, const MemImportOpts *o, bool json);</code> |
| `cmd_watch` | symbol | 580 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms);</code> |
| `watch_fleet` | symbol | 585 | <code>int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms);</code> |
| `json_get_string` | symbol | 588 | <code>char *json_get_string(const char *obj, const char *key);  /* malloc, unescaped */</code> |
| `json_string_value` | symbol | 589 | <code>char *json_string_value(const char *raw);  /* "\"a\\nb\"" -&gt; malloc "a\nb"; NULL if not a string */</code> |
| `json_get_int` | symbol | 590 | <code>long  json_get_int(const char *obj, const char *key, long dflt);</code> |
| `json_get_raw` | symbol | 591 | <code>char *json_get_raw(const char *obj, const char *key);     /* raw token, malloc */</code> |
| `json_get_object` | symbol | 592 | <code>char *json_get_object(const char *obj, const char *key);  /* balanced {...}   */</code> |
| `json_object_keys` | symbol | 593 | <code>int   json_object_keys(const char *obj, char **keys, int cap); /* malloc'd each */</code> |
| `json_array_items` | symbol | 596 | <code>int   json_array_items(const char *arr, char ***out);</code> |
| `cg_capture` | symbol | 599 | <code>int cg_capture(char **out, int (*fn)(void *), void *ctx);</code> |
| `KvxEntry` | symbol | 602 | <code>typedef struct { char *section, *key, *raw; } KvxEntry;</code> |
| `Kvx` | symbol | 603 | <code>typedef struct {</code> |
| `kvx_parse` | symbol | 609 | <code>Kvx  *kvx_parse(const char *path);                /* NULL on open/parse error */</code> |
| `kvx_free` | symbol | 610 | <code>void  kvx_free(Kvx *k);</code> |
| `kvx_has` | symbol | 611 | <code>bool  kvx_has(const Kvx *k, const char *sec);</code> |
| `kvx_raw` | symbol | 612 | <code>const char *kvx_raw(const Kvx *k, const char *sec, const char *key);</code> |
| `kvx_str` | symbol | 613 | <code>char *kvx_str(const Kvx *k, const char *sec, const char *key); /* malloc; NULL absent */</code> |
| `kvx_long` | symbol | 614 | <code>long  kvx_long(const Kvx *k, const char *sec, const char *key, long dflt);</code> |
| `kvx_bool` | symbol | 615 | <code>bool  kvx_bool(const Kvx *k, const char *sec, const char *key, bool dflt);</code> |
| `kvx_list` | symbol | 616 | <code>int   kvx_list(const Kvx *k, const char *sec, const char *key, char ***out);</code> |
| `kvx_keys` | symbol | 617 | <code>int   kvx_keys(const Kvx *k, const char *sec, const char ***out); /* borrowed */</code> |
| `kvx_subsections` | symbol | 618 | <code>int   kvx_subsections(const Kvx *k, const char *prefix, char ***out); /* file order */</code> |
| `kvx_sort_dotted` | symbol | 619 | <code>void  kvx_sort_dotted(char **ids, int n);</code> |
| `kvx_set_status` | symbol | 621 | <code>int   kvx_set_status(const char *path, const char *section, const char *value);</code> |
| `void` | symbol | 626 | <code>extern void (*kvx_status_hook)(const char *path, const char *section,</code> |
| `kvx_set_string` | symbol | 629 | <code>int   kvx_set_string(const char *path, const char *section, const char *key,</code> |
| `kvx_set_raw` | symbol | 632 | <code>int   kvx_set_raw(const char *path, const char *section, const char *key,</code> |
| `cmd_spec` | symbol | 635 | <code>int cmd_spec(int argc, char **argv, bool json);</code> |
| `spec_attempt_set_branch` | symbol | 639 | <code>int spec_attempt_set_branch(Cg *g, const char *tag, const char *branch,</code> |
| `SpecAttempt` | symbol | 641 | <code>typedef struct {</code> |
| `spec_claim` | symbol | 653 | <code>int spec_claim(Cg *g, const char *root, const char *feature, const char *id,</code> |
| `spec_active_tag` | symbol | 657 | <code>char *spec_active_tag(void);</code> |
| `spec_task_tag` | symbol | 659 | <code>char *spec_task_tag(const char *requested);</code> |
| `spec_active_touches` | symbol | 661 | <code>int   spec_active_touches(char ***out);</code> |
| `spec_globs_overlap` | symbol | 663 | <code>bool  spec_globs_overlap(const char *a, const char *b);</code> |
| `spec_resolve_task` | symbol | 666 | <code>char *spec_resolve_task(const char *requested, const char *agent);</code> |
| `spec_task_packet` | symbol | 668 | <code>char *spec_task_packet(const char *requested);</code> |
| `spec_task_memories_tag` | symbol | 670 | <code>int   spec_task_memories_tag(const char *requested, Memory **out);</code> |
| `cmd_lsp` | symbol | 673 | <code>int  cmd_lsp(Cg *cg, const SysInfo *si);</code> |
| `lsp_hover` | symbol | 674 | <code>void lsp_hover(Cg *cg, const char *name, StrBuf *md);</code> |
| `lsp_diagnostics` | symbol | 675 | <code>void lsp_diagnostics(Cg *cg, const char *abs, StrBuf *out);</code> |
| `lsp_path_in_task_scope` | symbol | 676 | <code>bool lsp_path_in_task_scope(Cg *cg, const char *rel);</code> |
| `anchor_stale` | symbol | 683 | <code>int anchor_stale(Cg *cg,</code> |
| `cmd_check` | symbol | 688 | <code>int cmd_check(Cg *cg, bool json, bool strict);   /* the single CI gate */</code> |
| `cmd_brief` | symbol | 689 | <code>int cmd_brief(Cg *cg, bool json);                /* session state in one call */</code> |
| `cmd_guard` | symbol | 690 | <code>int cmd_guard(Cg *cg, int npath, char **pathv, bool json, bool strict);</code> |
| `cmd_review` | symbol | 691 | <code>int cmd_review(Cg *cg, bool json);</code> |
| `cmd_hook_install` | symbol | 692 | <code>int cmd_hook_install(Cg *cg);</code> |
| `cmd_hook_post_edit` | symbol | 693 | <code>int cmd_hook_post_edit(Cg *cg, const SysInfo *si, bool json);</code> |
| `cmd_integrate` | symbol | 694 | <code>int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility);</code> |
| `integrate_plan` | symbol | 695 | <code>int integrate_plan(Cg *cg, bool json);</code> |
| `integrate_apply` | symbol | 696 | <code>int integrate_apply(Cg *cg, bool json);</code> |
| `integrate_doctor` | symbol | 697 | <code>int integrate_doctor(Cg *cg, bool json);</code> |
| `integrate_apply_portable` | symbol | 698 | <code>int integrate_apply_portable(Cg *cg, bool quiet);</code> |
| `cmd_handoff` | symbol | 700 | <code>int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,</code> |
| `cmd_resume` | symbol | 703 | <code>int cmd_resume(Cg *cg, const char *task, bool json, bool prompt);</code> |
| `cmd_work` | symbol | 704 | <code>int cmd_work(Cg *cg, int argc, char **argv, bool json);</code> |
| `work_open` | symbol | 705 | <code>int work_open(Cg *cg, const char *task, bool json);</code> |
| `work_update` | symbol | 706 | <code>int work_update(Cg *cg, const char *revision, bool json);</code> |
| `work_close` | symbol | 707 | <code>int work_close(Cg *cg, const char *task, int nevidence, char **evidence,</code> |
| `cmd_spec_run` | symbol | 713 | <code>int cmd_spec_run(int argc, char **argv);</code> |
| `cmd_fleet_up` | symbol | 719 | <code>int  cmd_fleet_up(Cg *cg, int argc, char **argv, bool json);</code> |
| `cmd_fleet_control` | symbol | 720 | <code>int  cmd_fleet_control(Cg *cg, const char *verb, int argc, char **argv,</code> |
| `cmd_fleet_runs` | symbol | 722 | <code>int  cmd_fleet_runs(Cg *cg, bool json);</code> |
| `fleet_supervisor_alive` | symbol | 723 | <code>bool fleet_supervisor_alive(const char *shared);</code> |
| `CG_EXIT_APPROVAL` | symbol | 728 | <code>#define CG_EXIT_APPROVAL 4</code> |
| `fleet_gate` | symbol | 729 | <code>int  fleet_gate(Cg *cg, const char *gate, const char *subject);</code> |
| `cmd_fleet_approvals` | symbol | 730 | <code>int  cmd_fleet_approvals(Cg *cg, int argc, char **argv, bool json);</code> |
| `DriverSpec` | symbol | 733 | <code>typedef struct {</code> |
| `driver_argv` | symbol | 745 | <code>int driver_argv(const DriverSpec *d, const char *root, const char *promptfile,</code> |
| `DriverEvent` | symbol | 747 | <code>typedef struct {</code> |
| `void` | symbol | 755 | <code>typedef void (*DriverEventFn)(const DriverEvent *e, void *ud);</code> |
| `driver_stream_parse` | symbol | 758 | <code>int driver_stream_parse(const char *line, DriverEventFn fn, void *ud);</code> |
| `DriverTap` | symbol | 759 | <code>typedef struct {</code> |
| `driver_tap_init` | symbol | 768 | <code>void driver_tap_init(DriverTap *t, const char *log, const char *agent,</code> |
| `driver_tap_poll` | symbol | 772 | <code>int  driver_tap_poll(DriverTap *t);</code> |
| `driver_tap_free` | symbol | 773 | <code>void driver_tap_free(DriverTap *t);</code> |
| `driver_steer` | symbol | 775 | <code>long driver_steer(Cg *cg, const char *agent, const char *message);</code> |
| `driver_steer_take` | symbol | 778 | <code>char *driver_steer_take(Cg *cg, const char *agent, const char *via);</code> |
| `EventRow` | symbol | 781 | <code>typedef struct {</code> |
| `int` | symbol | 786 | <code>typedef int (*EventFn)(const EventRow *e, void *ud);</code> |
| `events_install` | symbol | 787 | <code>int  events_install(Cg *cg);         /* triggers; called by cg_open */</code> |
| `events_emit` | symbol | 791 | <code>long events_emit(Cg *cg, const char *kind, const char *subject,</code> |
| `events_emit_as` | symbol | 795 | <code>long events_emit_as(Cg *cg, const char *kind, const char *subject,</code> |
| `events_emit_quiet` | symbol | 797 | <code>long events_emit_quiet(const char *kind, const char *subject,</code> |
| `events_bind` | symbol | 799 | <code>void events_bind(Cg *cg);            /* see events_kvx_status */</code> |
| `events_unbind` | symbol | 800 | <code>void events_unbind(void);</code> |
| `events_kvx_status` | symbol | 801 | <code>void events_kvx_status(const char *path, const char *section,</code> |
| `events_head` | symbol | 803 | <code>long events_head(Cg *cg);</code> |
| `events_pruned_through` | symbol | 804 | <code>long events_pruned_through(Cg *cg);</code> |
| `events_since` | symbol | 806 | <code>long events_since(Cg *cg, long since, const char *kinds, int limit,</code> |
| `events_json` | symbol | 808 | <code>void events_json(StrBuf *b, const EventRow *e);</code> |
| `cmd_events` | symbol | 809 | <code>int  cmd_events(Cg *cg, int argc, char **argv, bool json);</code> |
| `drift_spec_check` | symbol | 817 | <code>int  drift_spec_check(Cg *cg, const char *tree, const char *base,</code> |
| `drift_print` | symbol | 820 | <code>void drift_print(const char *report_json);</code> |
| `drift_collision_predict` | symbol | 822 | <code>bool drift_collision_predict(Cg *cg, const char *feature, const char *a,</code> |
| `cmd_drift` | symbol | 824 | <code>int  cmd_drift(Cg *cg, int argc, char **argv, bool json);</code> |
| `drift_interface_check` | symbol | 830 | <code>int  drift_interface_check(Cg *cg, const char *tree, const char *base_branch,</code> |
| `coverage_check` | symbol | 835 | <code>int  coverage_check(Cg *cg, const char *feature, StrBuf *out);</code> |
| `coverage_print` | symbol | 836 | <code>void coverage_print(const char *report_json, const char *feature);</code> |
| `drift_summary` | symbol | 838 | <code>int  drift_summary(Cg *cg, const char *feature, StrBuf *text, StrBuf *json);</code> |
| `graph_neighbors` | symbol | 840 | <code>int  graph_neighbors(Cg *cg, const char *name, char ***out);</code> |
| `RoleCaps` | symbol | 851 | <code>typedef struct {</code> |
| `FleetRole` | symbol | 862 | <code>typedef struct {</code> |
| `Hierarchy` | symbol | 870 | <code>typedef struct {</code> |
| `hier_load` | symbol | 887 | <code>bool hier_load(const Kvx *wf, Hierarchy *h);   /* defaults, then overrides */</code> |
| `hier_role_caps` | symbol | 890 | <code>void hier_role_caps(const Kvx *wf, Hierarchy *h);</code> |
| `hier_duration` | symbol | 892 | <code>long hier_duration(const char *s);</code> |
| `hier_free` | symbol | 893 | <code>void hier_free(Hierarchy *h);</code> |
| `hier_expand_task` | symbol | 897 | <code>void hier_expand_task(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `hier_per_task` | symbol | 899 | <code>bool hier_per_task(const Hierarchy *h);</code> |
| `fleet_merge_lock` | symbol | 904 | <code>int  fleet_merge_lock(const char *shared, const char *feature, long wait_ms);</code> |
| `fleet_merge_unlock` | symbol | 905 | <code>void fleet_merge_unlock(int fd);</code> |
| `hier_expand` | symbol | 906 | <code>void hier_expand(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `fleet_identity_record` | symbol | 908 | <code>int  fleet_identity_record(Cg *g);           /* no-op without CG_ROLE */</code> |
| `fleet_brief` | symbol | 909 | <code>void fleet_brief(Cg *cg, StrBuf *b, bool json);</code> |
| `fleet_worker_begin` | symbol | 916 | <code>int  fleet_worker_begin(Cg *cg, const char *id, const char *feature,</code> |
| `fleet_merge_up` | symbol | 918 | <code>int  fleet_merge_up(Cg *cg, const char *id, const char *feature, bool force,</code> |
| `fleet_feature_land` | symbol | 920 | <code>int  fleet_feature_land(Cg *cg, const char *feature, bool no_pr, bool json);</code> |
| `fleet_pr_open` | symbol | 921 | <code>int  fleet_pr_open(Cg *cg, const char *feature, bool dry_run, bool json);</code> |
| `fleet_checkpoint` | symbol | 922 | <code>int  fleet_checkpoint(Cg *cg, bool dry_run, bool json);</code> |
| `cmd_fleet` | symbol | 923 | <code>int  cmd_fleet(Cg *cg, int argc, char **argv, bool json);</code> |
| `FleetNode` | symbol | 928 | <code>typedef struct {</code> |
| `orch_spawn_manager` | symbol | 945 | <code>int orch_spawn_manager(Cg *cg, const char *feature, const char *driver,</code> |
| `orch_spawn_worker` | symbol | 950 | <code>int orch_spawn_worker(Cg *cg, const char *feature, const char *id,</code> |
| `orch_tree_status` | symbol | 955 | <code>int orch_tree_status(Cg *cg, const char *feature, bool json);</code> |
| `JevQuestion` | symbol | 967 | <code>typedef struct {</code> |
| `JevAnswer` | symbol | 974 | <code>typedef struct {</code> |
| `JevResult` | symbol | 983 | <code>typedef struct {</code> |
| `jev_question_noul` | symbol | 995 | <code>int  jev_question_noul(JevQuestion *q, const char *name,</code> |
| `jev_question_choice` | symbol | 998 | <code>int  jev_question_choice(JevQuestion *q, const char *name,</code> |
| `jev_question_score` | symbol | 1001 | <code>int  jev_question_score(JevQuestion *q, const char *name,</code> |
| `jev_question_free` | symbol | 1004 | <code>void jev_question_free(JevQuestion *q);</code> |
| `jev_request_json` | symbol | 1008 | <code>void jev_request_json(const char *model, const char *state_json,</code> |
| `jev_ask` | symbol | 1015 | <code>int  jev_ask(Cg *cg, const char *state_json, const JevQuestion *qs, int nq,</code> |
| `jev_ask_raw` | symbol | 1019 | <code>int  jev_ask_raw(Cg *cg, const char *body, JevResult *out);</code> |
| `jev_ask_at` | symbol | 1024 | <code>int  jev_ask_at(Cg *cg, const char *key, const char *model,</code> |
| `jev_answer` | symbol | 1027 | <code>const JevAnswer *jev_answer(const JevResult *r, const char *name);</code> |
| `jev_result_free` | symbol | 1028 | <code>void jev_result_free(JevResult *r);</code> |
| `cmd_jev` | symbol | 1029 | <code>int  cmd_jev(Cg *cg, int argc, char **argv, bool json);</code> |
| `jev_advisory_ready` | symbol | 1037 | <code>bool jev_advisory_ready(const char *what);</code> |
| `JevTriage` | symbol | 1038 | <code>typedef struct {</code> |
| `jev_triage_failure` | symbol | 1046 | <code>int  jev_triage_failure(Cg *cg, const char *output, JevTriage *out);</code> |
| `JevFinding` | symbol | 1047 | <code>typedef struct {</code> |
| `jev_rank_findings` | symbol | 1057 | <code>int  jev_rank_findings(Cg *cg, JevFinding *v, int n);</code> |
| `JevReadiness` | symbol | 1058 | <code>typedef struct {</code> |
| `jev_pr_readiness` | symbol | 1062 | <code>int  jev_pr_readiness(Cg *cg, const char *state_json, JevReadiness *out);</code> |
| `jev_report_error` | symbol | 1073 | <code>int  jev_report_error(const JevResult *r, const char *what);</code> |
| `memory_get` | symbol | 1076 | <code>bool memory_get(Cg *cg, long id, Memory *out);</code> |
| `cmd_memory_classify` | symbol | 1079 | <code>int  cmd_memory_classify(Cg *cg, const char *sel, int limit, bool json);</code> |
| `skill_render` | symbol | 1083 | <code>int  skill_render(Cg *cg, const Memory *m, char *path_out, size_t cap);</code> |
| `skill_findings` | symbol | 1086 | <code>int  skill_findings(Cg *cg, char ***out);</code> |
| `cmd_skills` | symbol | 1087 | <code>int  cmd_skills(Cg *cg, int argc, char **argv, bool json);</code> |
| `git_available` | symbol | 1089 | <code>bool git_available(const Cg *cg);</code> |
| `git_head` | symbol | 1094 | <code>bool git_head(const char *tree, char *branch, size_t bcap, char *sha,</code> |
| `git_worktree_main` | symbol | 1098 | <code>bool git_worktree_main(const char *tree, char *main_out, size_t cap);</code> |
| `cg_branch_resolve` | symbol | 1102 | <code>int  cg_branch_resolve(Cg *cg);</code> |
| `branch_register` | symbol | 1106 | <code>long branch_register(Cg *cg, const char *name, const char *worktree,</code> |
| `cmd_branches` | symbol | 1108 | <code>int  cmd_branches(Cg *cg, int argc, char **argv, bool json);</code> |
| `git_run` | symbol | 1112 | <code>int  git_run(const char *tree, const char *args, StrBuf *out);</code> |
| `git_branch_exists` | symbol | 1113 | <code>bool git_branch_exists(const char *tree, const char *branch);</code> |
| `git_worktree_add` | symbol | 1120 | <code>int  git_worktree_add(const char *tree, const char *path, const char *branch,</code> |
| `git_conflicted_paths` | symbol | 1124 | <code>int  git_conflicted_paths(const char *tree, char ***out);</code> |
| `git_ingest` | symbol | 1127 | <code>int  git_ingest(Cg *cg, int limit, long *ncommits, long *npaths, long *seen);</code> |
| `cmd_git_sync` | symbol | 1128 | <code>int  cmd_git_sync(Cg *cg, int limit, bool json);</code> |
| `git_churn_for_path` | symbol | 1129 | <code>int  git_churn_for_path(Cg *cg, const char *path);</code> |
| `git_commit_mirror` | symbol | 1130 | <code>int  git_commit_mirror(Cg *cg, const char *message);</code> |
| `cmd_mcp` | symbol | 1133 | <code>int cmd_mcp(Cg *cg, const SysInfo *si);            /* stdio MCP server */</code> |
| `mcp_tools_json` | symbol | 1137 | <code>void mcp_tools_json(StrBuf *r);                    /* {"tools":[...]} */</code> |
| `mcp_call_tool` | symbol | 1138 | <code>int  mcp_call_tool(Cg *cg, const SysInfo *si, const char *name,</code> |
| `cmd_tool` | symbol | 1140 | <code>int  cmd_tool(Cg *cg, const SysInfo *si, int argc, char **argv, bool json);</code> |
| `cmd_serve` | symbol | 1143 | <code>int  cmd_serve(Cg *cg, const SysInfo *si);</code> |
| `cmd_mcp_install` | symbol | 1144 | <code>int cmd_mcp_install(Cg *cg);                       /* wire into agent configs */</code> |
| `cmd_changelog` | symbol | 1146 | <code>int cmd_changelog(Cg *cg, int limit, const char *outfile);</code> |
| `ChangelogOpts` | symbol | 1149 | <code>typedef struct {</code> |
| `cmd_changelog_git` | symbol | 1155 | <code>int cmd_changelog_git(Cg *cg, const ChangelogOpts *o);</code> |
| `ChatModel` | symbol | 1162 | <code>typedef struct {</code> |
| `chat_model_config` | symbol | 1166 | <code>void  chat_model_config(const Cg *cg, ChatModel *m);</code> |
| `chat_model_ask` | symbol | 1169 | <code>char *chat_model_ask(const Cg *cg, const ChatModel *m, const char *prompt,</code> |
| `env_file_key` | symbol | 1172 | <code>void  env_file_key(const char *root, const char *want, char *out, size_t cap);</code> |
| `RecapOpts` | symbol | 1176 | <code>typedef struct {</code> |
| `cmd_recap` | symbol | 1186 | <code>int cmd_recap(Cg *cg, const RecapOpts *o);</code> |
| `cmd_agentmd` | symbol | 1187 | <code>int cmd_agentmd(Cg *cg, bool write_files);         /* graph agent context */</code> |
| `CodemapOpts` | symbol | 1191 | <code>typedef struct {</code> |
| `cmd_codemap` | symbol | 1196 | <code>int  cmd_codemap(Cg *cg, const CodemapOpts *o);</code> |
| `codemap_render` | symbol | 1199 | <code>int  codemap_render(Cg *cg, int budget, bool json, const char *self_rel,</code> |
| `codemap_default_path` | symbol | 1201 | <code>void codemap_default_path(const Cg *cg, char *out, size_t cap);</code> |
| `codemap_status` | symbol | 1204 | <code>int  codemap_status(Cg *cg, char *rel, size_t cap);</code> |
| `cmd_docs` | symbol | 1205 | <code>int cmd_docs(Cg *cg, int argc, char **argv, bool json); /* documentation closure */</code> |
| `spec_docs_finish` | symbol | 1206 | <code>int spec_docs_finish(Cg *cg, const char *feature); /* internal checked closure */</code> |

## src/codemap.c

[Open source](../src/codemap.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CM_MARKER` | symbol | 19 | <code>#define CM_MARKER "&lt;!-- codify-owned: codemap v1"</code> |
| `CM_BUDGET` | symbol | 20 | <code>#define CM_BUDGET 8000</code> |
| `CM_MIN_BUDGET` | symbol | 21 | <code>#define CM_MIN_BUDGET 300</code> |
| `CAP_MOD_SYMS` | symbol | 24 | <code>#define CAP_MOD_SYMS   12</code> |
| `CAP_MOD_FILES` | symbol | 25 | <code>#define CAP_MOD_FILES  40</code> |
| `CAP_MODULES` | symbol | 26 | <code>#define CAP_MODULES    24</code> |
| `CAP_TEST_FILES` | symbol | 27 | <code>#define CAP_TEST_FILES 40</code> |
| `CAP_ROUTES` | symbol | 28 | <code>#define CAP_ROUTES     25</code> |
| `CAP_DEPS` | symbol | 29 | <code>#define CAP_DEPS       30</code> |
| `CAP_DOCS` | symbol | 30 | <code>#define CAP_DOCS       24</code> |
| `CAP_SUBDIRS` | symbol | 31 | <code>#define CAP_SUBDIRS    8</code> |
| `CAP_COMMANDS` | symbol | 32 | <code>#define CAP_COMMANDS   96</code> |
| `codemap_default_path` | symbol | 36 | <code>void codemap_default_path(const Cg *cg, char *out, size_t cap) {</code> |
| `cm_spec_dir` | symbol | 41 | <code>static const char *cm_spec_dir(const Cg *cg) {</code> |
| `Cut` | symbol | 50 | <code>typedef struct { int tier; long rank; int seq; bool drop; } Cut;</code> |
| `CmFile` | symbol | 52 | <code>typedef struct {</code> |
| `CmLang` | symbol | 59 | <code>typedef struct { char *name; long files, lines; Cut cut; } CmLang;</code> |
| `CmBuild` | symbol | 60 | <code>typedef struct { char *tool, *manifest, *dir, *cmds; Cut cut; } CmBuild;</code> |
| `CmDir` | symbol | 62 | <code>typedef struct {</code> |
| `CmMain` | symbol | 70 | <code>typedef struct { char *path, *sig; char name[128]; int line; Cut cut; } CmMain;</code> |
| `CmPkg` | symbol | 71 | <code>typedef struct { char *manifest, *what; Cut cut; } CmPkg;</code> |
| `CmRoute` | symbol | 72 | <code>typedef struct {</code> |
| `CmModFile` | symbol | 78 | <code>typedef struct { CmFile *f; Cut cut; } CmModFile;</code> |
| `CmSym` | symbol | 79 | <code>typedef struct {</code> |
| `CmMod` | symbol | 85 | <code>typedef struct {</code> |
| `CmDep` | symbol | 94 | <code>typedef struct { char *from, *to; long imports, calls; Cut cut; } CmDep;</code> |
| `CmTestFile` | symbol | 96 | <code>typedef struct { CmFile *f; Cut cut; } CmTestFile;</code> |
| `CmTestDir` | symbol | 97 | <code>typedef struct {</code> |
| `CmFixture` | symbol | 103 | <code>typedef struct { char *path, *subs; long files; Cut cut; } CmFixture;</code> |
| `CmPtr` | symbol | 105 | <code>typedef struct { char *path, *what; Cut cut; } CmPtr;</code> |
| `Map` | symbol | 107 | <code>typedef struct {</code> |
| `VPUSH` | symbol | 139 | <code>#define VPUSH(v, n, c) \</code> |
| `cut_init` | symbol | 146 | <code>static void cut_init(Map *m, Cut *c, int tier, long rank) {</code> |
| `cut_add` | symbol | 152 | <code>static void cut_add(Map *m, Cut *c) {</code> |
| `num` | symbol | 162 | <code>static const char *num(long n, char *buf) {          /* 39334 -&gt; "39,334" */</code> |
| `starts_ci` | symbol | 175 | <code>static bool starts_ci(const char *s, const char *pre) {</code> |
| `strip_leader` | symbol | 180 | <code>static void strip_leader(const char **p, int *ll) {</code> |
| `has_alnum` | symbol | 202 | <code>static bool has_alnum(const char *p, int ll) {</code> |
| `boilerplate` | symbol | 208 | <code>static bool boilerplate(const char *p, int ll) {</code> |
| `sentence` | symbol | 220 | <code>static char *sentence(const char *s, int max) {</code> |
| `purpose_of` | symbol | 248 | <code>static char *purpose_of(const char *body, int max) {</code> |
| `md_title` | symbol | 277 | <code>static char *md_title(const char *body) {</code> |
| `md_plain` | symbol | 297 | <code>static void md_plain(StrBuf *b, const char *p, int ll) {</code> |
| `readme_prose` | symbol | 309 | <code>static char *readme_prose(const char *body, int max) {</code> |
| `clean_sig` | symbol | 338 | <code>static char *clean_sig(const char *sig) {</code> |
| `cm_skipped` | symbol | 362 | <code>static bool cm_skipped(const Map *m, const char *path) {</code> |
| `cm_fixture` | symbol | 369 | <code>static bool cm_fixture(const char *path) {</code> |
| `cm_test` | symbol | 379 | <code>static bool cm_test(const char *path) {</code> |
| `top_dir` | symbol | 384 | <code>static void top_dir(const char *path, char *out, size_t cap) {</code> |
| `mod_dir` | symbol | 390 | <code>static void mod_dir(const char *path, char *out, size_t cap) {</code> |
| `fn_skip` | symbol | 399 | <code>static void fn_skip(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `fn_test` | symbol | 404 | <code>static void fn_test(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `fn_top` | symbol | 409 | <code>static void fn_top(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `fn_mod` | symbol | 416 | <code>static void fn_mod(sqlite3_context *c, int n, sqlite3_value **v) {</code> |
| `cm_functions` | symbol | 424 | <code>static void cm_functions(Map *m, bool on) {</code> |
| `cm_prep` | symbol | 438 | <code>static sqlite3_stmt *cm_prep(Map *m, const char *alias, const char *head,</code> |
| `col` | symbol | 449 | <code>static const char *col(sqlite3_stmt *st, int i) {</code> |
| `byid_cmp` | symbol | 454 | <code>static int byid_cmp(const void *a, const void *b) {</code> |
| `file_by_id` | symbol | 459 | <code>static CmFile *file_by_id(Map *m, long id) {</code> |
| `file_by_path` | symbol | 469 | <code>static CmFile *file_by_path(Map *m, const char *path) {</code> |
| `dir_range` | symbol | 483 | <code>static void dir_range(const Map *m, const char *dir, int *lo, int *hi) {</code> |
| `tree_read` | symbol | 499 | <code>static char *tree_read(Map *m, const char *rel) {</code> |
| `load_files` | symbol | 507 | <code>static void load_files(Map *m) {</code> |
| `load_name` | symbol | 564 | <code>static void load_name(Map *m) {</code> |
| `lang_cmp` | symbol | 624 | <code>static int lang_cmp(const void *a, const void *b) {</code> |
| `load_langs` | symbol | 631 | <code>static void load_langs(Map *m) {</code> |
| `dir_of` | symbol | 654 | <code>static void dir_of(const char *path, char *out, size_t cap) {</code> |
| `add_build` | symbol | 659 | <code>static void add_build(Map *m, const char *tool, const char *manifest,</code> |
| `make_targets` | symbol | 675 | <code>static void make_targets(const char *body, StrBuf *b) {</code> |
| `load_builds` | symbol | 709 | <code>static void load_builds(Map *m) {</code> |
| `dir_purpose` | symbol | 778 | <code>static char *dir_purpose(Map *m, const char *dir) {</code> |
| `dir_get` | symbol | 810 | <code>static CmDir *dir_get(Map *m, const char *path, int depth) {</code> |
| `dir_cmp` | symbol | 819 | <code>static int dir_cmp(const void *a, const void *b) {</code> |
| `load_layout` | symbol | 823 | <code>static void load_layout(Map *m) {</code> |
| `LN` | symbol | 825 | <code>typedef struct { char lang[32]; long n; } LN;</code> |
| `dir_listed` | symbol | 919 | <code>static bool dir_listed(const Map *m, const CmDir *d) {</code> |
| `word_ok` | symbol | 932 | <code>static bool word_ok(const char *s, int n) {</code> |
| `cmd_push` | symbol | 941 | <code>static void cmd_push(StrBuf *b, int *n, char seen[][48], const char *s, int len) {</code> |
| `scan_commands` | symbol | 954 | <code>static int scan_commands(const char *body, StrBuf *b) {</code> |
| `load_entries` | symbol | 1000 | <code>static void load_entries(Map *m) {</code> |
| `modfile_cmp` | symbol | 1097 | <code>static int modfile_cmp(const void *a, const void *b) {</code> |
| `mod_cmp` | symbol | 1104 | <code>static int mod_cmp(const void *a, const void *b) {</code> |
| `mod_lookup` | symbol | 1111 | <code>static CmMod *mod_lookup(Map *m, const char *path) {</code> |
| `load_modules` | symbol | 1117 | <code>static void load_modules(Map *m) {</code> |
| `LN` | symbol | 1139 | <code>typedef struct { char lang[32]; long n; } LN;</code> |
| `dep_get` | symbol | 1235 | <code>static CmDep *dep_get(Map *m, const char *a, const char *b) {</code> |
| `dep_cmp` | symbol | 1245 | <code>static int dep_cmp(const void *a, const void *b) {</code> |
| `load_deps` | symbol | 1253 | <code>static void load_deps(Map *m) {</code> |
| `script_purpose` | symbol | 1283 | <code>static char *script_purpose(Map *m, const char *path) {</code> |
| `tdir_lookup` | symbol | 1305 | <code>static CmTestDir *tdir_lookup(Map *m, const char *path) {</code> |
| `fixture_root` | symbol | 1312 | <code>static void fixture_root(const char *path, char *out, size_t cap) {</code> |
| `tfile_cmp` | symbol | 1325 | <code>static int tfile_cmp(const void *a, const void *b) {</code> |
| `tdir_cmp` | symbol | 1331 | <code>static int tdir_cmp(const void *a, const void *b) {</code> |
| `load_tests` | symbol | 1335 | <code>static void load_tests(Map *m) {</code> |
| `add_ptr` | symbol | 1447 | <code>static void add_ptr(Map *m, const char *path, const char *what) {</code> |
| `load_pointers` | symbol | 1454 | <code>static void load_pointers(Map *m) {</code> |
| `kept` | symbol | 1555 | <code>static bool kept(const Cut *c) { return !c-&gt;drop; }</code> |
| `md_section_omitted` | symbol | 1557 | <code>static void md_section_omitted(StrBuf *b, const char *what) {</code> |
| `omit_add` | symbol | 1561 | <code>static void omit_add(StrBuf *o, long n, const char *one, const char *many) {</code> |
| `render_md` | symbol | 1568 | <code>static void render_md(Map *m, StrBuf *b) {</code> |
| `js_str_or_null` | symbol | 1860 | <code>static void js_str_or_null(StrBuf *b, const char *s) {</code> |
| `render_json` | symbol | 1864 | <code>static void render_json(Map *m, StrBuf *b, long md_len) {</code> |
| `cut_cmp` | symbol | 2115 | <code>static int cut_cmp(const void *a, const void *b) {</code> |
| `md_len_dropping` | symbol | 2122 | <code>static size_t md_len_dropping(Map *m, int k) {</code> |
| `collect_cuts` | symbol | 2131 | <code>static void collect_cuts(Map *m) {</code> |
| `fit` | symbol | 2162 | <code>static int fit(Map *m, size_t cap) {</code> |
| `map_free` | symbol | 2175 | <code>static void map_free(Map *m) {</code> |
| `codemap_render` | symbol | 2228 | <code>int codemap_render(Cg *cg, int budget, bool json, const char *self_rel,</code> |
| `marker_budget` | symbol | 2270 | <code>static int marker_budget(const char *body) {</code> |
| `out_rel` | symbol | 2281 | <code>static void out_rel(const Cg *cg, const char *abs, char *rel, size_t cap) {</code> |
| `codemap_status` | symbol | 2289 | <code>int codemap_status(Cg *cg, char *rel, size_t cap) {</code> |
| `cmd_codemap` | symbol | 2305 | <code>int cmd_codemap(Cg *cg, const CodemapOpts *o) {</code> |

## src/config.c

[Open source](../src/config.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CfgType` | symbol | 29 | <code>typedef enum { CFG_BOOL, CFG_PATH } CfgType;</code> |
| `CfgIssue` | symbol | 64 | <code>typedef struct {</code> |
| `CfgIssues` | symbol | 71 | <code>typedef struct { CfgIssue *v; int n, cap; } CfgIssues;</code> |
| `cfg_issue` | symbol | 73 | <code>static void cfg_issue(CfgIssues *is, const char *kind, const char *section,</code> |
| `cfg_issue` | symbol | 77 | <code>static void cfg_issue(CfgIssues *is, const char *kind, const char *section,</code> |
| `cfg_index` | symbol | 95 | <code>static int cfg_index(const char *section, const char *key) {</code> |
| `cfg_index_dotted` | symbol | 104 | <code>static int cfg_index_dotted(const char *dotted) {</code> |
| `cfg_known_section` | symbol | 112 | <code>static bool cfg_known_section(const char *section) {</code> |
| `cfg_parse_bool` | symbol | 119 | <code>static int cfg_parse_bool(const char *v) {</code> |
| `cfg_path_check` | symbol | 130 | <code>static const char *cfg_path_check(const char *v, char *out, size_t cap) {</code> |
| `cfg_slot` | symbol | 162 | <code>static char *cfg_slot(CgConfig *c, int i) {</code> |
| `cfg_defaults` | symbol | 172 | <code>static void cfg_defaults(CgConfig *c, const char *root) {</code> |
| `cfg_read` | symbol | 184 | <code>static void cfg_read(const char *root, CgConfig *c, CfgIssues *is) {</code> |
| `CfgNode` | symbol | 249 | <code>typedef struct CfgNode { CgConfig c; struct CfgNode *next; } CfgNode;</code> |
| `config_load` | symbol | 254 | <code>const CgConfig *config_load(const char *root) {</code> |
| `config_auto_sync` | symbol | 284 | <code>bool config_auto_sync(const char *root) { return config_load(root)-&gt;sync_auto; }</code> |
| `config_spec_rel` | symbol | 285 | <code>const char *config_spec_rel(const char *root) {</code> |
| `config_context_rel` | symbol | 288 | <code>const char *config_context_rel(const char *root) {</code> |
| `config_skills_rel` | symbol | 291 | <code>const char *config_skills_rel(const char *root) {</code> |
| `config_codemap_rel` | symbol | 294 | <code>const char *config_codemap_rel(const char *root) {</code> |
| `config_spec_dir` | symbol | 298 | <code>bool config_spec_dir(const char *root, char *out, size_t cap) {</code> |
| `config_workflow_path` | symbol | 302 | <code>bool config_workflow_path(const char *root, char *out, size_t cap) {</code> |
| `config_feature_path` | symbol | 307 | <code>bool config_feature_path(const char *root, const char *feature, char *out,</code> |
| `config_context_dir` | symbol | 313 | <code>bool config_context_dir(const char *root, char *out, size_t cap) {</code> |
| `config_context_path` | symbol | 317 | <code>bool config_context_path(const char *root, const char *name, char *out,</code> |
| `config_skills_dir` | symbol | 323 | <code>bool config_skills_dir(const char *root, char *out, size_t cap) {</code> |
| `config_codemap_path` | symbol | 327 | <code>bool config_codemap_path(const char *root, char *out, size_t cap) {</code> |
| `config_in_spec` | symbol | 331 | <code>bool config_in_spec(const char *root, const char *rel) {</code> |
| `config_find_spec_root` | symbol | 337 | <code>int config_find_spec_root(const char *start, char *out, size_t cap) {</code> |
| `cfg_issues_json` | symbol | 356 | <code>static void cfg_issues_json(const CgConfig *c, const CfgIssues *is,</code> |
| `config_check` | symbol | 379 | <code>int config_check(const char *root, StrBuf *text, StrBuf *json) {</code> |
| `cfg_root` | symbol | 397 | <code>static void cfg_root(char *out, size_t cap) {</code> |
| `cfg_value` | symbol | 408 | <code>static const char *cfg_value(const CgConfig *c, int i) {</code> |
| `cfg_setting_json` | symbol | 413 | <code>static void cfg_setting_json(const CgConfig *c, int i, StrBuf *b) {</code> |
| `cfg_list` | symbol | 429 | <code>static int cfg_list(const char *root, bool json) {</code> |
| `cfg_init` | symbol | 466 | <code>static int cfg_init(const char *root) {</code> |
| `cfg_get` | symbol | 483 | <code>static int cfg_get(const char *root, const char *dotted, bool json) {</code> |
| `cfg_set` | symbol | 503 | <code>static int cfg_set(const char *root, const char *dotted, const char *value) {</code> |
| `cmd_config` | symbol | 549 | <code>int cmd_config(int argc, char **argv, bool json) {</code> |

## src/db.c

[Open source](../src/db.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SCHEMA_VERSION` | symbol | 204 | <code>#define SCHEMA_VERSION "17"</code> |
| `path_exists` | symbol | 208 | <code>static bool path_exists(const char *base, const char *name) {</code> |
| `is_project_dir` | symbol | 215 | <code>static bool is_project_dir(const char *base) {</code> |
| `cg_is_boundary` | symbol | 225 | <code>bool cg_is_boundary(const char *dir) {</code> |
| `git_file_at` | symbol | 237 | <code>static bool git_file_at(const char *dir) {</code> |
| `cg_find_project_at` | symbol | 244 | <code>int cg_find_project_at(const char *start, char *root, char *shared,</code> |
| `cg_find_root_at` | symbol | 293 | <code>int cg_find_root_at(const char *start, char *out, size_t cap) {</code> |
| `cg_find_root` | symbol | 298 | <code>int cg_find_root(char *out, size_t cap) {</code> |
| `cg_bkey` | symbol | 304 | <code>void cg_bkey(const Cg *cg, const char *name, char *out, size_t cap) {</code> |
| `cmd_root` | symbol | 310 | <code>int cmd_root(bool json) {</code> |
| `cg_open` | symbol | 341 | <code>int cg_open(Cg *cg, bool create) {</code> |
| `cg_schema_upgrade` | symbol | 405 | <code>int cg_schema_upgrade(Cg *cg) {</code> |
| `cg_close` | symbol | 475 | <code>void cg_close(Cg *cg) {</code> |
| `cg_prep` | symbol | 480 | <code>sqlite3_stmt *cg_prep(Cg *cg, const char *sql) {</code> |
| `busy_rc` | symbol | 489 | <code>static bool busy_rc(int rc) {</code> |
| `cg_busy_report` | symbol | 494 | <code>void cg_busy_report(const char *what) {</code> |
| `cg_lock_wait_default` | symbol | 505 | <code>long cg_lock_wait_default(void) {</code> |
| `cg_begin_write` | symbol | 511 | <code>int cg_begin_write(Cg *cg) {</code> |
| `cg_exec` | symbol | 530 | <code>void cg_exec(Cg *cg, const char *sql) {</code> |
| `cg_meta_set` | symbol | 544 | <code>void cg_meta_set(Cg *cg, const char *k, const char *v) {</code> |
| `cg_meta_get` | symbol | 554 | <code>char *cg_meta_get(Cg *cg, const char *k) {</code> |

## src/docs.c

[Open source](../src/docs.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `DOCS_EVIDENCE_CAP` | symbol | 13 | <code>#define DOCS_EVIDENCE_CAP 16000</code> |
| `DOCS_INVENTORY_CAP` | symbol | 14 | <code>#define DOCS_INVENTORY_CAP 256</code> |
| `DocsProject` | symbol | 19 | <code>typedef struct {</code> |
| `docs_str` | symbol | 36 | <code>static char *docs_str(const Kvx *k, const char *sec, const char *key,</code> |
| `docs_free_list` | symbol | 42 | <code>static void docs_free_list(char **v, int n) {</code> |
| `docs_project_close` | symbol | 47 | <code>static void docs_project_close(DocsProject *p) {</code> |
| `docs_defaults` | symbol | 56 | <code>static int docs_defaults(char ***out, const char **items, int n) {</code> |
| `docs_tasks_qualified` | symbol | 63 | <code>static bool docs_tasks_qualified(const Kvx *spec) {</code> |
| `docs_project_open` | symbol | 83 | <code>static int docs_project_open(Cg *cg, DocsProject *p) {</code> |
| `docs_suffix` | symbol | 153 | <code>static bool docs_suffix(const char *name) {</code> |
| `docs_inventory_walk` | symbol | 159 | <code>static void docs_inventory_walk(const char *root, const char *rel, int depth,</code> |
| `docs_inventory` | symbol | 196 | <code>static int docs_inventory(const DocsProject *p, StrBuf *text, StrBuf *json) {</code> |
| `docs_targets_json` | symbol | 209 | <code>static void docs_targets_json(const DocsProject *p, StrBuf *b) {</code> |
| `docs_target_match` | symbol | 224 | <code>static bool docs_target_match(const DocsProject *p, const char *path) {</code> |
| `docs_regular` | symbol | 235 | <code>static bool docs_regular(const DocsProject *p, const char *rel) {</code> |
| `docs_string_in_file` | symbol | 248 | <code>static bool docs_string_in_file(const DocsProject *p, const char *rel,</code> |
| `docs_symbol_exists` | symbol | 259 | <code>static bool docs_symbol_exists(Cg *cg, const char *name, const char *path) {</code> |
| `docs_route_exists` | symbol | 270 | <code>static bool docs_route_exists(Cg *cg, const char *value, const char *path) {</code> |
| `docs_claims_template` | symbol | 298 | <code>static int docs_claims_template(DocsProject *p, const char *path) {</code> |
| `docs_plan` | symbol | 412 | <code>static int docs_plan(Cg *cg, bool json) {</code> |
| `DocsSpecCall` | symbol | 449 | <code>typedef struct { int argc; char **argv; bool json; } DocsSpecCall;</code> |
| `docs_call_spec` | symbol | 450 | <code>static int docs_call_spec(void *v) {</code> |
| `DocsCall` | symbol | 463 | <code>typedef struct { Cg *cg; int which; const char *feature; } DocsCall;</code> |
| `docs_call_evidence` | symbol | 464 | <code>static int docs_call_evidence(void *v) {</code> |
| `docs_append_capture` | symbol | 477 | <code>static void docs_append_capture(StrBuf *packet, StrBuf *ledger,</code> |
| `docs_packet` | symbol | 506 | <code>static int docs_packet(Cg *cg, bool json) {</code> |
| `DocsCheck` | symbol | 638 | <code>typedef struct { int errors; int checks; StrBuf report; } DocsCheck;</code> |
| `docs_check_say` | symbol | 640 | <code>static void docs_check_say(DocsCheck *c, bool ok, const char *fmt, ...) {</code> |
| `docs_allowed_system_path` | symbol | 653 | <code>static bool docs_allowed_system_path(const DocsProject *p, const char *path) {</code> |
| `docs_check_links` | symbol | 663 | <code>static int docs_check_links(const DocsProject *p, const char *doc,</code> |
| `docs_claim_evidence` | symbol | 712 | <code>static bool docs_claim_evidence(const DocsProject *p, const char *evidence,</code> |
| `docs_check_claims` | symbol | 724 | <code>static int docs_check_claims(DocsProject *p, DocsCheck *c) {</code> |
| `docs_check` | symbol | 817 | <code>static int docs_check(Cg *cg, bool json) {</code> |
| `docs_trace` | symbol | 883 | <code>static int docs_trace(Cg *cg, bool json) {</code> |
| `docs_call_check` | symbol | 944 | <code>static int docs_call_check(void *v) { return docs_check((Cg *)v, false); }</code> |
| `docs_call_finish` | symbol | 945 | <code>static int docs_call_finish(void *v) {</code> |
| `docs_close` | symbol | 950 | <code>static int docs_close(Cg *cg, bool json) {</code> |
| `cmd_docs` | symbol | 992 | <code>int cmd_docs(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/drift.c

[Open source](../src/drift.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `Hunk` | symbol | 18 | <code>typedef struct { int from, to; } Hunk;</code> |
| `FileDiff` | symbol | 19 | <code>typedef struct { char *path; Hunk *h; int nh, ch; } FileDiff;</code> |
| `list_free` | symbol | 21 | <code>static void list_free(char **v, int n) {</code> |
| `packet_strings` | symbol | 26 | <code>static int packet_strings(const char *packet, const char *key, char ***out) {</code> |
| `fd_get` | symbol | 41 | <code>static FileDiff *fd_get(FileDiff **v, int *n, int *cap, const char *path) {</code> |
| `fd_hunk` | symbol | 53 | <code>static void fd_hunk(FileDiff *f, int from, int to) {</code> |
| `drift_diff` | symbol | 65 | <code>static int drift_diff(const char *tree, const char *base, const char *head,</code> |
| `drift_exempt` | symbol | 133 | <code>static bool drift_exempt(const char *tree, const char *path) {</code> |
| `drift_in_touches` | symbol | 144 | <code>static bool drift_in_touches(const char *path, char **touches, int nt) {</code> |
| `drift_public` | symbol | 153 | <code>static bool drift_public(const char *path, const char *name, const char *kind,</code> |
| `drift_spec_check` | symbol | 172 | <code>int drift_spec_check(Cg *cg, const char *tree, const char *base,</code> |
| `drift_print` | symbol | 254 | <code>void drift_print(const char *report_json) {</code> |
| `drift_collision_predict` | symbol | 286 | <code>bool drift_collision_predict(Cg *cg, const char *feature, const char *a,</code> |
| `drift_active_feature` | symbol | 328 | <code>static char *drift_active_feature(Cg *cg) {</code> |
| `drift_open_tasks` | symbol | 338 | <code>static int drift_open_tasks(Cg *cg, const char *feature, char ***out) {</code> |
| `cmd_drift` | symbol | 361 | <code>int cmd_drift(Cg *cg, int argc, char **argv, bool json) {</code> |
| `blob_defs` | symbol | 457 | <code>static int blob_defs(const char *tree, const char *rev, const char *path,</code> |
| `def_named` | symbol | 486 | <code>static const SymDef *def_named(const ParseResult *pr, const char *name) {</code> |
| `drift_ref_sites` | symbol | 496 | <code>static int drift_ref_sites(Cg *cg, const char *name, long skip_branch,</code> |
| `drift_interface_check` | symbol | 538 | <code>int drift_interface_check(Cg *cg, const char *tree, const char *base_branch,</code> |
| `coverage_check` | symbol | 629 | <code>int coverage_check(Cg *cg, const char *feature, StrBuf *out) {</code> |
| `coverage_print` | symbol | 700 | <code>void coverage_print(const char *report_json, const char *feature) {</code> |
| `drift_summary` | symbol | 720 | <code>int drift_summary(Cg *cg, const char *feature, StrBuf *text, StrBuf *json) {</code> |

## src/events.c

[Open source](../src/events.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `EVENTS_KEEP_DFLT` | symbol | 22 | <code>#define EVENTS_KEEP_DFLT 50000</code> |
| `EVENTS_PRUNE_EVERY` | symbol | 23 | <code>#define EVENTS_PRUNE_EVERY 512</code> |
| `EV_NOW` | symbol | 26 | <code>#define EV_NOW "CAST((julianday('now')-2440587.5)*86400000 AS INTEGER)"</code> |
| `events_install` | symbol | 81 | <code>int events_install(Cg *cg) {</code> |
| `now_ms_wall` | symbol | 88 | <code>static long now_ms_wall(void) {</code> |
| `bind_or_null` | symbol | 94 | <code>static void bind_or_null(sqlite3_stmt *st, int i, const char *v) {</code> |
| `events_prune` | symbol | 101 | <code>static void events_prune(Cg *cg, long seq) {</code> |
| `events_emit` | symbol | 116 | <code>long events_emit(Cg *cg, const char *kind, const char *subject,</code> |
| `events_emit_as` | symbol | 121 | <code>long events_emit_as(Cg *cg, const char *kind, const char *subject,</code> |
| `events_emit_quiet` | symbol | 146 | <code>long events_emit_quiet(const char *kind, const char *subject,</code> |
| `events_bind` | symbol | 163 | <code>void events_bind(Cg *cg) { g_bound = cg; }</code> |
| `events_unbind` | symbol | 164 | <code>void events_unbind(void) { g_bound = NULL; }</code> |
| `feature_of` | symbol | 169 | <code>static bool feature_of(const char *path, char *out, size_t cap) {</code> |
| `events_kvx_status` | symbol | 184 | <code>void events_kvx_status(const char *path, const char *section,</code> |
| `events_head` | symbol | 212 | <code>long events_head(Cg *cg) {</code> |
| `events_pruned_through` | symbol | 223 | <code>long events_pruned_through(Cg *cg) {</code> |
| `EV_MAX_KINDS` | symbol | 230 | <code>#define EV_MAX_KINDS 16</code> |
| `events_since` | symbol | 234 | <code>long events_since(Cg *cg, long since, const char *kinds, int limit,</code> |
| `events_json` | symbol | 296 | <code>void events_json(StrBuf *b, const EventRow *e) {</code> |
| `EV_OPT` | symbol | 299 | <code>#define EV_OPT(name, v) do { sb_puts(b, ",\"" name "\":"); \</code> |
| `ev_on_signal` | symbol | 315 | <code>static void ev_on_signal(int sig) { (void)sig; g_ev_stop = 1; }</code> |
| `ev_print` | symbol | 317 | <code>static int ev_print(const EventRow *e, void *ud) {</code> |
| `EvRing` | symbol | 341 | <code>typedef struct { long *v; long cap; long n; } EvRing;</code> |
| `ev_ring_add` | symbol | 343 | <code>static int ev_ring_add(const EventRow *e, void *ud) {</code> |
| `cmd_events` | symbol | 350 | <code>int cmd_events(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/fleet.c

[Open source](../src/fleet.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `FleetIdentity` | symbol | 28 | <code>typedef struct {</code> |
| `fleet_identity` | symbol | 36 | <code>static void fleet_identity(FleetIdentity *id) {</code> |
| `bind_opt` | symbol | 46 | <code>static void bind_opt(sqlite3_stmt *st, int i, const char *v) {</code> |
| `fleet_identity_record` | symbol | 56 | <code>int fleet_identity_record(Cg *g) {</code> |
| `role_set` | symbol | 90 | <code>static void role_set(FleetRole *r, const char *name, const char *title,</code> |
| `hier_defaults` | symbol | 99 | <code>static void hier_defaults(Hierarchy *h) {</code> |
| `take_str` | symbol | 117 | <code>static void take_str(char **slot, const Kvx *k, const char *sec,</code> |
| `hier_duration` | symbol | 125 | <code>long hier_duration(const char *s) {</code> |
| `hier_problem` | symbol | 142 | <code>static void hier_problem(Hierarchy *h, const char *fmt, const char *role,</code> |
| `cap_raw` | symbol | 158 | <code>static char *cap_raw(const Kvx *wf, const char *sec, const char *key) {</code> |
| `cap_duration` | symbol | 171 | <code>static void cap_duration(Hierarchy *h, const Kvx *wf, const char *sec,</code> |
| `cap_count` | symbol | 183 | <code>static void cap_count(Hierarchy *h, const Kvx *wf, const char *sec,</code> |
| `hier_role_caps` | symbol | 200 | <code>void hier_role_caps(const Kvx *wf, Hierarchy *h) {</code> |
| `hier_load` | symbol | 289 | <code>bool hier_load(const Kvx *wf, Hierarchy *h) {</code> |
| `hier_free` | symbol | 327 | <code>void hier_free(Hierarchy *h) {</code> |
| `hier_expand` | symbol | 342 | <code>void hier_expand(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `hier_per_task` | symbol | 347 | <code>bool hier_per_task(const Hierarchy *h) {</code> |
| `hier_expand_task` | symbol | 355 | <code>void hier_expand_task(const Hierarchy *h, const char *tmpl, const char *feature,</code> |
| `fleet_workflow` | symbol | 389 | <code>static Kvx *fleet_workflow(const Cg *cg, char *path, size_t cap) {</code> |
| `role_title` | symbol | 394 | <code>static const char *role_title(const Hierarchy *h, const char *role) {</code> |
| `ago` | symbol | 401 | <code>static void ago(long seen, char *out, size_t cap) {</code> |
| `fleet_brief` | symbol | 411 | <code>void fleet_brief(Cg *cg, StrBuf *b, bool json) {</code> |
| `gate_bit` | symbol | 446 | <code>static unsigned gate_bit(const char *gate) {</code> |
| `approval_event` | symbol | 452 | <code>static void approval_event(Cg *cg, const char *kind, long id, const char *gate,</code> |
| `fleet_gate` | symbol | 474 | <code>int fleet_gate(Cg *cg, const char *gate, const char *subject) {</code> |
| `cmd_fleet_approvals` | symbol | 544 | <code>int cmd_fleet_approvals(Cg *cg, int argc, char **argv, bool json) {</code> |
| `C` | symbol | 609 | <code>#define C(i) ((const char *)sqlite3_column_text(st, i))</code> |
| `fmt_secs` | symbol | 644 | <code>static void fmt_secs(long s, char *out, size_t cap) {</code> |
| `approvals` | symbol | 652 | <code>static void approvals(unsigned bits, char *out, size_t cap, const char *sep) {</code> |
| `fleet_roles` | symbol | 664 | <code>static int fleet_roles(Cg *cg, bool json) {</code> |
| `agent_live_tasks` | symbol | 770 | <code>static char *agent_live_tasks(Cg *g, const char *agent) {</code> |
| `fleet_status` | symbol | 786 | <code>static int fleet_status(Cg *cg, bool json) {</code> |
| `PlanTask` | symbol | 907 | <code>typedef struct { char *id, *title, *status; long wave; } PlanTask;</code> |
| `plan_task_cmp` | symbol | 909 | <code>static int plan_task_cmp(const void *a, const void *b) {</code> |
| `LiveAgent` | symbol | 917 | <code>typedef struct { char *agent; long wave; char *role; } LiveAgent;</code> |
| `live_add` | symbol | 919 | <code>static void live_add(LiveAgent **v, int *n, int *cap, const char *agent,</code> |
| `live_names` | symbol | 933 | <code>static void live_names(const LiveAgent *v, int n, const char *role,</code> |
| `fleet_plan` | symbol | 945 | <code>static int fleet_plan(Cg *cg, const char *feature_ov, bool json) {</code> |
| `Lifecycle` | symbol | 1150 | <code>typedef struct {</code> |
| `lifecycle_close` | symbol | 1161 | <code>static void lifecycle_close(Lifecycle *c) {</code> |
| `fleet_merge_lock` | symbol | 1169 | <code>int fleet_merge_lock(const char *shared, const char *feature, long wait_ms) {</code> |
| `fleet_merge_unlock` | symbol | 1186 | <code>void fleet_merge_unlock(int fd) {</code> |
| `lifecycle_merge_lock` | symbol | 1193 | <code>static int lifecycle_merge_lock(Lifecycle *c) {</code> |
| `lifecycle_open` | symbol | 1203 | <code>static int lifecycle_open(Cg *cg, const char *feature_ov, Lifecycle *c) {</code> |
| `worktree_path` | symbol | 1244 | <code>static void worktree_path(const Lifecycle *c, const char *branch, char *out,</code> |
| `task_wave_status` | symbol | 1259 | <code>static bool task_wave_status(const char *specpath, const char *id, long *wave,</code> |
| `task_status_on_branch` | symbol | 1278 | <code>static bool task_status_on_branch(const Lifecycle *c, const char *branch,</code> |
| `tree_clean` | symbol | 1303 | <code>static bool tree_clean(const char *tree) {</code> |
| `commits_between` | symbol | 1311 | <code>static long commits_between(const char *tree, const char *base,</code> |
| `ensure_branch` | symbol | 1328 | <code>static bool ensure_branch(const char *tree, const char *branch,</code> |
| `excerpt` | symbol | 1344 | <code>static void excerpt(const StrBuf *b, char *out, size_t cap) {</code> |
| `json_str_or_null` | symbol | 1354 | <code>static void json_str_or_null(StrBuf *b, const char *s) {</code> |
| `put_conflicts` | symbol | 1358 | <code>static void put_conflicts(StrBuf *b, char **paths, int n, bool json) {</code> |
| `free_list` | symbol | 1372 | <code>static void free_list(char **v, int n) {</code> |
| `fleet_event` | symbol | 1378 | <code>static void fleet_event(Cg *cg, const char *kind, const char *subject,</code> |
| `ev_str` | symbol | 1387 | <code>static void ev_str(StrBuf *b, const char *key, const char *v) {</code> |
| `ev_long` | symbol | 1392 | <code>static void ev_long(StrBuf *b, const char *key, long v) {</code> |
| `fleet_worker_begin` | symbol | 1399 | <code>int fleet_worker_begin(Cg *cg, const char *id, const char *feature_ov,</code> |
| `ev_list` | symbol | 1534 | <code>static void ev_list(StrBuf *b, const char *key, char **v, int n) {</code> |
| `merge_event` | symbol | 1543 | <code>static void merge_event(Cg *cg, const Lifecycle *c, const char *id,</code> |
| `fleet_merge_up` | symbol | 1565 | <code>int fleet_merge_up(Cg *cg, const char *id, const char *feature_ov, bool force,</code> |
| `run_gate` | symbol | 1763 | <code>static int run_gate(const char *tree, const char *cmd, const char *logpath,</code> |
| `pr_open_core` | symbol | 1790 | <code>static int pr_open_core(Cg *cg, Lifecycle *c, bool dry_run, StrBuf *jb,</code> |
| `pr_event` | symbol | 1793 | <code>static void pr_event(Cg *cg, const Lifecycle *c, const char *outcome,</code> |
| `land_event` | symbol | 1805 | <code>static void land_event(Cg *cg, const Lifecycle *c, const char *outcome,</code> |
| `fleet_feature_land` | symbol | 1823 | <code>int fleet_feature_land(Cg *cg, const char *feature_ov, bool no_pr, bool json) {</code> |
| `find_gh` | symbol | 2027 | <code>static bool find_gh(char *out, size_t cap) {</code> |
| `run_in` | symbol | 2033 | <code>static int run_in(const char *tree, const char *cmd, StrBuf *out) {</code> |
| `write_pr_body` | symbol | 2058 | <code>static void write_pr_body(Cg *cg, const Lifecycle *c, const char *branch,</code> |
| `pr_open_core` | symbol | 2130 | <code>static int pr_open_core(Cg *cg, Lifecycle *c, bool dry_run, StrBuf *jb,</code> |
| `fleet_pr_open` | symbol | 2273 | <code>int fleet_pr_open(Cg *cg, const char *feature_ov, bool dry_run, bool json) {</code> |
| `OpenPr` | symbol | 2297 | <code>typedef struct { long number; char *head, *title, *url; } OpenPr;</code> |
| `fleet_checkpoint` | symbol | 2303 | <code>int fleet_checkpoint(Cg *cg, bool dry_run, bool json) {</code> |
| `cmd_fleet` | symbol | 2484 | <code>int cmd_fleet(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/gitint.c

[Open source](../src/gitint.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `git_available` | symbol | 20 | <code>bool git_available(const Cg *cg) {</code> |
| `chomp` | symbol | 31 | <code>static char *chomp(char *s) {</code> |
| `git_abs` | symbol | 40 | <code>static bool git_abs(const char *base, const char *p, char *out, size_t cap) {</code> |
| `git_dirs` | symbol | 54 | <code>static bool git_dirs(const char *tree, char *gitdir, char *common, size_t cap) {</code> |
| `git_worktree_main` | symbol | 86 | <code>bool git_worktree_main(const char *tree, char *main_out, size_t cap) {</code> |
| `git_ref_sha` | symbol | 99 | <code>static bool git_ref_sha(const char *common, const char *ref, char *sha,</code> |
| `git_head` | symbol | 130 | <code>bool git_head(const char *tree, char *branch, size_t bcap, char *sha,</code> |
| `git_run` | symbol | 155 | <code>int git_run(const char *tree, const char *args, StrBuf *out) {</code> |
| `git_branch_exists` | symbol | 177 | <code>bool git_branch_exists(const char *tree, const char *branch) {</code> |
| `git_worktree_add` | symbol | 189 | <code>int git_worktree_add(const char *tree, const char *path, const char *branch,</code> |
| `git_conflicted_paths` | symbol | 223 | <code>int git_conflicted_paths(const char *tree, char ***out) {</code> |
| `branch_register` | symbol | 249 | <code>long branch_register(Cg *cg, const char *name, const char *worktree,</code> |
| `cg_branch_resolve` | symbol | 274 | <code>int cg_branch_resolve(Cg *cg) {</code> |
| `ago` | symbol | 290 | <code>static void ago(long since, char *out, size_t cap) {</code> |
| `cmd_branches` | symbol | 301 | <code>int cmd_branches(Cg *cg, int argc, char **argv, bool json) {</code> |
| `git_ingest` | symbol | 363 | <code>int git_ingest(Cg *cg, int limit, long *ncommits_out, long *npaths_out,</code> |
| `cmd_git_sync` | symbol | 425 | <code>int cmd_git_sync(Cg *cg, int limit, bool json) {</code> |
| `git_churn_for_path` | symbol | 449 | <code>int git_churn_for_path(Cg *cg, const char *path) {</code> |
| `git_commit_mirror` | symbol | 461 | <code>int git_commit_mirror(Cg *cg, const char *message) {</code> |

## src/govern.c

[Open source](../src/govern.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `run_capture` | symbol | 22 | <code>static int run_capture(char **out, int (*fn)(void *), void *ctx) {</code> |
| `SpecCall` | symbol | 26 | <code>typedef struct { int argc; char **argv; bool json; } SpecCall;</code> |
| `call_spec` | symbol | 28 | <code>static int call_spec(void *v) {</code> |
| `spec_sub` | symbol | 41 | <code>static int spec_sub(char **out, bool json, int argc, ...) {</code> |
| `has_spec_repo` | symbol | 51 | <code>static bool has_spec_repo(const char *root) {</code> |
| `lease_touches_overlap` | symbol | 60 | <code>static bool lease_touches_overlap(const char *a, const char *b) {</code> |
| `cmd_check` | symbol | 78 | <code>int cmd_check(Cg *cg, bool json, bool strict)</code> |
| `active_task_json` | symbol | 299 | <code>static char *active_task_json(bool *is_current) {</code> |
| `brief_cap_body` | symbol | 313 | <code>static void brief_cap_body(Memory *m) {</code> |
| `brief_memories` | symbol | 327 | <code>static int brief_memories(Cg *cg, const char *task_json, Memory **out) {</code> |
| `brief_branches` | symbol | 373 | <code>static void brief_branches(Cg *cg, StrBuf *b, bool json) {</code> |
| `brief_feature` | symbol | 432 | <code>static char *brief_feature(Cg *cg, const char *task_json) {</code> |
| `cmd_brief` | symbol | 445 | <code>int cmd_brief(Cg *cg, bool json)</code> |
| `path_in_scope` | symbol | 566 | <code>static bool path_in_scope(const char *task_json, const char *path) {</code> |
| `GuardStale` | symbol | 597 | <code>typedef struct {</code> |
| `guard_stale_cb` | symbol | 605 | <code>static void guard_stale_cb(void *u, const char *path, int line,</code> |
| `guard_collect` | symbol | 628 | <code>static void guard_collect(JevFinding **v, int *n, int *cap, const char *kind,</code> |
| `cmd_guard` | symbol | 643 | <code>int cmd_guard(Cg *cg, int npath, char **pathv, bool json, bool strict)</code> |
| `cmd_review` | symbol | 795 | <code>int cmd_review(Cg *cg, bool json)</code> |
| `cmd_hook_install_git` | symbol | 966 | <code>static int cmd_hook_install_git(Cg *cg, const char *bin);</code> |
| `write_exec` | symbol | 968 | <code>static int write_exec(const char *path, const char *body) {</code> |
| `cmd_hook_install` | symbol | 991 | <code>int cmd_hook_install(Cg *cg)</code> |
| `cmd_hook_install_git` | symbol | 1029 | <code>static int cmd_hook_install_git(Cg *cg, const char *bin)</code> |
| `hook_read_stdin` | symbol | 1079 | <code>static char *hook_read_stdin(void) {</code> |
| `hook_edited_path` | symbol | 1092 | <code>static char *hook_edited_path(const char *payload) {</code> |
| `HookGuard` | symbol | 1103 | <code>typedef struct { Cg *cg; char *path; bool json; } HookGuard;</code> |
| `hook_guard_call` | symbol | 1105 | <code>static int hook_guard_call(void *u) {</code> |
| `HOOK_MAX_LINES` | symbol | 1111 | <code>#define HOOK_MAX_LINES 24</code> |
| `cmd_hook_post_edit` | symbol | 1120 | <code>int cmd_hook_post_edit(Cg *cg, const SysInfo *si, bool json) {</code> |
| `handoff_field` | symbol | 1207 | <code>static char *handoff_field(const char *body, const char *key) {</code> |
| `handoff_live_id` | symbol | 1228 | <code>static long handoff_live_id(Cg *cg, const char *tag) {</code> |
| `handoff_files` | symbol | 1241 | <code>static char *handoff_files(Cg *cg, int cap, int *count) {</code> |
| `cmd_handoff` | symbol | 1258 | <code>int cmd_handoff(Cg *cg, const char *task, const char *done, const char *next,</code> |
| `resume_json_field` | symbol | 1309 | <code>static void resume_json_field(StrBuf *b, const char *name, const char *v) {</code> |
| `cmd_resume` | symbol | 1320 | <code>int cmd_resume(Cg *cg, const char *task, bool json, bool prompt)</code> |
| `WorkCapture` | symbol | 1526 | <code>typedef struct { Cg *cg; const char *query; } WorkCapture;</code> |
| `work_call_state` | symbol | 1527 | <code>static int work_call_state(void *v) {</code> |
| `work_call_progress` | symbol | 1530 | <code>static int work_call_progress(void *v) {</code> |
| `work_call_context` | symbol | 1533 | <code>static int work_call_context(void *v) {</code> |
| `work_call_tests` | symbol | 1537 | <code>static int work_call_tests(void *v) {</code> |
| `work_raw_json` | symbol | 1542 | <code>static void work_raw_json(StrBuf *b, const char *raw) {</code> |
| `work_last_event` | symbol | 1551 | <code>static long work_last_event(Cg *cg, const char *task) {</code> |
| `work_event_json` | symbol | 1561 | <code>static void work_event_json(Cg *cg, StrBuf *b, const char *task, long after,</code> |
| `work_memories_json` | symbol | 1599 | <code>static void work_memories_json(Cg *cg, StrBuf *b, const char *task) {</code> |
| `work_revision_create` | symbol | 1613 | <code>static void work_revision_create(Cg *cg, const char *task, long event_id,</code> |
| `work_open` | symbol | 1640 | <code>int work_open(Cg *cg, const char *task, bool json) {</code> |
| `work_workspace_delta` | symbol | 1701 | <code>static void work_workspace_delta(Cg *cg, StrBuf *b, const char *revision,</code> |
| `packet_list` | symbol | 1725 | <code>static int packet_list(const char *packet, const char *key, char ***out);</code> |
| `list_free` | symbol | 1726 | <code>static void list_free(char **v, int n);</code> |
| `packet_scope` | symbol | 1727 | <code>static long packet_scope(Cg *cg);</code> |
| `work_upstream_delta` | symbol | 1732 | <code>static int work_upstream_delta(Cg *cg, const char *task, long since_s,</code> |
| `work_update` | symbol | 1805 | <code>int work_update(Cg *cg, const char *revision, bool json) {</code> |
| `work_supplied_evidence` | symbol | 1882 | <code>static const char *work_supplied_evidence(const char *clause, int n,</code> |
| `work_recorded_evidence` | symbol | 1891 | <code>static char *work_recorded_evidence(Cg *cg, const char *task,</code> |
| `work_close` | symbol | 1930 | <code>int work_close(Cg *cg, const char *requested, int nevidence, char **evidence,</code> |
| `cmd_work` | symbol | 1990 | <code>int cmd_work(Cg *cg, int argc, char **argv, bool json) {</code> |
| `packet_list` | symbol | 2012 | <code>static int packet_list(const char *packet, const char *key, char ***out) {</code> |
| `list_free` | symbol | 2027 | <code>static void list_free(char **v, int n) {</code> |
| `packet_scope` | symbol | 2035 | <code>static long packet_scope(Cg *cg) {</code> |
| `packet_upstream_evidence` | symbol | 2048 | <code>int packet_upstream_evidence(Cg *cg, const char *feature, const char *req,</code> |
| `PacketPart` | symbol | 2089 | <code>typedef struct { const char *name; StrBuf b; bool must; } PacketPart;</code> |
| `packet_assemble` | symbol | 2094 | <code>static int packet_assemble(PacketPart *parts, int n, int budget, StrBuf *out) {</code> |
| `task_packet_build` | symbol | 2123 | <code>int task_packet_build(Cg *cg, const char *tag, int budget, StrBuf *out) {</code> |
| `manager_packet_build` | symbol | 2278 | <code>int manager_packet_build(Cg *cg, const char *feature, int budget, StrBuf *out) {</code> |

## src/graph.c

[Open source](../src/graph.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `fts_quote` | symbol | 12 | <code>static char *fts_quote(const char *q) {          /* "..." literal, "" escaped */</code> |
| `fts_words` | symbol | 23 | <code>static char *fts_words(const char *q) {          /* tok* tok* for unicode61 */</code> |
| `scope_id` | symbol | 46 | <code>static long scope_id(const Cg *cg) {</code> |
| `branch_scope_sql` | symbol | 52 | <code>const char *branch_scope_sql(const Cg *cg, const char *alias, char *out,</code> |
| `cg_scope_set` | symbol | 63 | <code>int cg_scope_set(Cg *cg, const char *name, bool all) {</code> |
| `branch_hit_label` | symbol | 76 | <code>const char *branch_hit_label(Cg *cg, long branch_id, char *out, size_t cap) {</code> |
| `branch_tree` | symbol | 89 | <code>const char *branch_tree(Cg *cg, long branch_id, char *out, size_t cap) {</code> |
| `prep_scoped` | symbol | 106 | <code>static sqlite3_stmt *prep_scoped(Cg *cg, const char *head, const char *tail) {</code> |
| `file_snippet_n` | symbol | 115 | <code>static char *file_snippet_n(Cg *cg, long branch_id, const char *rel, int from,</code> |
| `file_snippet` | symbol | 146 | <code>static char *file_snippet(Cg *cg, long branch_id, const char *rel, int from,</code> |
| `SymRow` | symbol | 151 | <code>typedef struct {</code> |
| `sym_from_stmt_at` | symbol | 160 | <code>static int sym_from_stmt_at(sqlite3_stmt *st, int off, SymRow *r) {</code> |
| `sym_from_stmt` | symbol | 178 | <code>static int sym_from_stmt(sqlite3_stmt *st, SymRow *r) {</code> |
| `SYM_COLS` | symbol | 186 | <code>#define SYM_COLS \</code> |
| `ci_has` | symbol | 192 | <code>static bool ci_has(const char *hay, const char *needle) {</code> |
| `doc_derivable` | symbol | 202 | <code>static bool doc_derivable(const char *doc, const char *name, const char *sig) {</code> |
| `DOC_MAX_BYTES` | symbol | 219 | <code>#define DOC_MAX_BYTES 700    /* per-symbol share: ~10 lines of prose */</code> |
| `SymDoc` | symbol | 221 | <code>typedef struct { char *body; bool stale, cut; } SymDoc;</code> |
| `body_first` | symbol | 225 | <code>static bool body_first(void) {</code> |
| `doc_take` | symbol | 235 | <code>static void doc_take(SymDoc *d, const char *body, bool stale) {</code> |
| `symbol_doc_rows` | symbol | 254 | <code>static void symbol_doc_rows(Cg *cg, const SymRow *r, const SymRow *own,</code> |
| `symbol_doc` | symbol | 296 | <code>static bool symbol_doc(Cg *cg, const SymRow *r, SymDoc *d) {</code> |
| `doc_render` | symbol | 318 | <code>static void doc_render(StrBuf *b, const SymDoc *d) {</code> |
| `anchor_stale` | symbol | 338 | <code>int anchor_stale(Cg *cg,</code> |
| `doc_json` | symbol | 393 | <code>static void doc_json(StrBuf *b, const SymDoc *d) {</code> |
| `defs_named` | symbol | 401 | <code>static int defs_named(Cg *cg, const char *name, SymRow *out, int cap) {</code> |
| `find_symbols` | symbol | 417 | <code>static int find_symbols(Cg *cg, const char *q, SymRow *out, int cap) {</code> |
| `find_symbols_all` | symbol | 456 | <code>static int find_symbols_all(Cg *cg, const char *q, SymRow *out, int cap) {</code> |
| `RESOLVE_MAX_DEFS` | symbol | 495 | <code>#define RESOLVE_MAX_DEFS 64</code> |
| `rank_path_penalized` | symbol | 499 | <code>static bool rank_path_penalized(const char *path) {</code> |
| `path_depth` | symbol | 520 | <code>static int path_depth(const char *p) {</code> |
| `module_matches` | symbol | 532 | <code>static bool module_matches(const char *module, const char *cand_path) {</code> |
| `resolve_best` | symbol | 571 | <code>static int resolve_best(Cg *cg, long from_fid, const char *from_path,</code> |
| `callers_of` | symbol | 625 | <code>static int callers_of(Cg *cg, const SymRow *def, SymRow *out, int cap) {</code> |
| `sym_path_line_cmp` | symbol | 683 | <code>static int sym_path_line_cmp(const void *a, const void *b) {</code> |
| `callees_of` | symbol | 694 | <code>static int callees_of(Cg *cg, long sym_id, SymRow *out, int cap) {</code> |
| `ref_count` | symbol | 774 | <code>static int ref_count(Cg *cg, const char *name) {</code> |
| `ref_count_resolved` | symbol | 788 | <code>static int ref_count_resolved(Cg *cg, const SymRow *def) {</code> |
| `MAX_TERMS` | symbol | 830 | <code>#define MAX_TERMS 8</code> |
| `Terms` | symbol | 831 | <code>typedef struct { char t[MAX_TERMS][64]; int n; } Terms;</code> |
| `query_terms` | symbol | 836 | <code>static void query_terms(const char *q, Terms *T) {</code> |
| `term_hits` | symbol | 864 | <code>static bool term_hits(const char *t, const char *w, size_t wn) {</code> |
| `words_mask` | symbol | 872 | <code>static unsigned words_mask(const char *words, const Terms *T) {</code> |
| `text_mask` | symbol | 886 | <code>static unsigned text_mask(const char *text, size_t len, const Terms *T) {</code> |
| `popcount` | symbol | 902 | <code>static int popcount(unsigned m) {</code> |
| `Hit` | symbol | 910 | <code>typedef struct {</code> |
| `RANK_CAP` | symbol | 917 | <code>#define RANK_CAP 256</code> |
| `hit_get` | symbol | 919 | <code>static Hit *hit_get(Hit *h, int *nh, const SymRow *r, bool add) {</code> |
| `hit_cmp` | symbol | 929 | <code>static int hit_cmp(const void *a, const void *b) {</code> |
| `FileHit` | symbol | 941 | <code>typedef struct {</code> |
| `FILE_SCAN` | symbol | 950 | <code>#define FILE_SCAN 16</code> |
| `filehit_cmp` | symbol | 952 | <code>static int filehit_cmp(const void *a, const void *b) {</code> |
| `filehits_free` | symbol | 960 | <code>static void filehits_free(FileHit *f, int n) {</code> |
| `fts_terms` | symbol | 966 | <code>static char *fts_terms(const Terms *T, bool any) {</code> |
| `rank_bodies` | symbol | 980 | <code>static void rank_bodies(Cg *cg, const Terms *T, Hit *h, int *nh,</code> |
| `rank_query` | symbol | 1091 | <code>static int rank_query(Cg *cg, const char *q, SymRow *out, int cap,</code> |
| `ep_interesting` | symbol | 1255 | <code>static bool ep_interesting(const SymRow *r) {</code> |
| `ep_push` | symbol | 1264 | <code>static bool ep_push(SymRow *out, int *n, int cap, const SymRow *r) {</code> |
| `ep_climb` | symbol | 1273 | <code>static void ep_climb(Cg *cg, const SymRow *from, SymRow *out, int *n, int cap,</code> |
| `context_entry_points` | symbol | 1290 | <code>static int context_entry_points(Cg *cg, const char *q, const SymRow *matched,</code> |
| `hit_tag` | symbol | 1319 | <code>static const char *hit_tag(Cg *cg, const SymRow *r, char *out, size_t cap) {</code> |
| `json_sym` | symbol | 1327 | <code>static void json_sym(Cg *cg, StrBuf *b, const SymRow *r) {</code> |
| `json_sym_compact` | symbol | 1344 | <code>static void json_sym_compact(Cg *cg, StrBuf *b, const SymRow *r) {</code> |
| `SeenSet` | symbol | 1358 | <code>typedef struct { char v[96][256]; int n; } SeenSet;</code> |
| `seen_has` | symbol | 1360 | <code>static bool seen_has(const SeenSet *s, const char *name) {</code> |
| `seen_add` | symbol | 1366 | <code>static void seen_add(SeenSet *s, const char *name) {</code> |
| `filehit_put` | symbol | 1375 | <code>static void filehit_put(Cg *cg, StrBuf *b, const FileHit *f, bool json) {</code> |
| `cmd_search` | symbol | 1396 | <code>int cmd_search(Cg *cg, const char *q, int limit, bool json) {</code> |
| `cmd_symbol` | symbol | 1448 | <code>int cmd_symbol(Cg *cg, const char *name, bool json) {</code> |
| `INode` | symbol | 1502 | <code>typedef struct { char name[256]; char via[256]; int depth; SymRow loc; } INode;</code> |
| `inode_seen` | symbol | 1504 | <code>static bool inode_seen(INode *v, int n, const char *name) {</code> |
| `IMPACT_CAP` | symbol | 1510 | <code>#define IMPACT_CAP 400</code> |
| `impact_bfs` | symbol | 1513 | <code>static int impact_bfs(Cg *cg, const SymRow *root, int depth, bool up,</code> |
| `impact_json_dir` | symbol | 1547 | <code>static void impact_json_dir(Cg *cg, StrBuf *b, const char *key, const INode *v,</code> |
| `cmd_impact` | symbol | 1577 | <code>int cmd_impact(Cg *cg, const char *name, int depth, int budget, bool json) {</code> |
| `cmd_routes` | symbol | 1639 | <code>int cmd_routes(Cg *cg, const char *filter, bool json) {</code> |
| `first_line` | symbol | 1695 | <code>static void first_line(StrBuf *b, const char *body, int max) {</code> |
| `SurveySym` | symbol | 1722 | <code>typedef struct {</code> |
| `cmd_survey` | symbol | 1729 | <code>int cmd_survey(Cg *cg, const char *scope, int budget, bool json) {</code> |
| `AnchStale` | symbol | 1974 | <code>typedef struct { StrBuf *txt, *js; int n; } AnchStale;</code> |
| `anch_stale_cb` | symbol | 1976 | <code>static void anch_stale_cb(void *u, const char *path, int line,</code> |
| `DOC_VIA_DECL` | symbol | 2000 | <code>#define DOC_VIA_DECL \</code> |
| `cmd_anchors` | symbol | 2005 | <code>int cmd_anchors(Cg *cg, bool stale_only, bool unc_only, bool json) {</code> |
| `CTX_TAIL` | symbol | 2126 | <code>#define CTX_TAIL 96</code> |
| `CTX_MARK` | symbol | 2128 | <code>#define CTX_MARK 16</code> |
| `ctx_tail` | symbol | 2130 | <code>static void ctx_tail(StrBuf *b, int budget, int omitted, bool json) {</code> |
| `file_purpose` | symbol | 2147 | <code>static void file_purpose(Cg *cg, long file_id, char *out, size_t cap) {</code> |
| `ctx_fit` | symbol | 2166 | <code>static bool ctx_fit(StrBuf *b, StrBuf *it, size_t room, bool json, int *emitted,</code> |
| `ctx_omitted` | symbol | 2180 | <code>static void ctx_omitted(StrBuf *b, int emitted, int omitted, bool json) {</code> |
| `context_path_outline` | symbol | 2193 | <code>static int context_path_outline(Cg *cg, const char *q, int budget, bool json) {</code> |
| `CTX_OPEN_MAX` | symbol | 2435 | <code>#define CTX_OPEN_MAX 60           /* opening lines one hit may grow to */</code> |
| `CTX_MIN_BUDGET` | symbol | 2438 | <code>#define CTX_MIN_BUDGET 64</code> |
| `cmd_context` | symbol | 2440 | <code>int cmd_context(Cg *cg, const char *q, int budget, int limit, bool json) {</code> |
| `symbols_at_position` | symbol | 2769 | <code>static int symbols_at_position(Cg *cg, const char *path, int line,</code> |
| `graph_symbol_at` | symbol | 2786 | <code>int graph_symbol_at(Cg *cg, const char *path, int line, char *name,</code> |
| `cmd_show` | symbol | 2797 | <code>int cmd_show(Cg *cg, const char *name, bool full, bool json) {</code> |
| `TEST_PATH_SQL` | symbol | 2862 | <code>#define TEST_PATH_SQL \</code> |
| `graph_path_is_test` | symbol | 2869 | <code>bool graph_path_is_test(const char *path) {</code> |
| `tests_for_symbol` | symbol | 2905 | <code>static int tests_for_symbol(Cg *cg, const char *name, StrBuf *b, bool json,</code> |
| `graph_task_focus` | symbol | 2934 | <code>char *graph_task_focus(Cg *cg, const char *task_packet) {</code> |
| `cmd_test_impact` | symbol | 2960 | <code>int cmd_test_impact(Cg *cg, const char *name, bool json) {</code> |
| `cmd_why` | symbol | 3019 | <code>int cmd_why(Cg *cg, const char *name, bool json) {</code> |
| `path_is_header` | symbol | 3124 | <code>static bool path_is_header(const char *path) {</code> |
| `lang_family` | symbol | 3134 | <code>static const char *lang_family(const char *path) {</code> |
| `edges_prefer_impl` | symbol | 3144 | <code>static int edges_prefer_impl(Cg *cg, SymRow *e, int n, bool callers,</code> |
| `graph_symbol_brief` | symbol | 3170 | <code>int graph_symbol_brief(Cg *cg, const char *name, int snippet_lines,</code> |
| `graph_glob_symbols` | symbol | 3258 | <code>int graph_glob_symbols(Cg *cg, const char *glob, int max_files, int max_syms,</code> |
| `graph_neighbors` | symbol | 3292 | <code>int graph_neighbors(Cg *cg, const char *name, char ***out) {</code> |

## src/integrate.c

[Open source](../src/integrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ConfigKind` | symbol | 12 | <code>typedef enum { CFG_JSON, CFG_VSCODE, CFG_TOML } ConfigKind;</code> |
| `Adapter` | symbol | 14 | <code>typedef struct {</code> |
| `NADAPTERS` | symbol | 47 | <code>#define NADAPTERS ((int)(sizeof ADAPTERS / sizeof ADAPTERS[0]))</code> |
| `ConfigState` | symbol | 49 | <code>typedef struct {</code> |
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
| `IntegrateAgentmd` | symbol | 275 | <code>typedef struct { Cg *cg; } IntegrateAgentmd;</code> |
| `integrate_agentmd_call` | symbol | 276 | <code>static int integrate_agentmd_call(void *v) {</code> |
| `integrate_agent_context` | symbol | 285 | <code>static int integrate_agent_context(Cg *cg) {</code> |
| `integrate_apply_portable` | symbol | 312 | <code>int integrate_apply_portable(Cg *cg, bool quiet) {</code> |
| `adapter_json` | symbol | 338 | <code>static void adapter_json(const Adapter *a, const char *path,</code> |
| `integrate_plan` | symbol | 356 | <code>int integrate_plan(Cg *cg, bool json) {</code> |
| `integrate_apply` | symbol | 418 | <code>int integrate_apply(Cg *cg, bool json) {</code> |
| `doctor_find` | symbol | 468 | <code>static void doctor_find(StrBuf *findings, int *n, bool json,</code> |
| `integrate_doctor` | symbol | 484 | <code>int integrate_doctor(Cg *cg, bool json) {</code> |
| `integrate_detect` | symbol | 575 | <code>static int integrate_detect(Cg *cg, bool json) {</code> |
| `cmd_integrate` | symbol | 603 | <code>int cmd_integrate(Cg *cg, const char *action, bool json, bool compatibility) {</code> |

## src/jev.c

[Open source](../src/jev.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `JEV_DEFAULT_MODEL` | symbol | 35 | <code>#define JEV_DEFAULT_MODEL    "typesafe/jev-1.13"</code> |
| `JEV_DEFAULT_ENDPOINT` | symbol | 36 | <code>#define JEV_DEFAULT_ENDPOINT "https://openrouter.ai/api/alpha/decisions"</code> |
| `JEV_MAX_CHOICE` | symbol | 37 | <code>#define JEV_MAX_CHOICE       255</code> |
| `JEV_EXCERPT` | symbol | 38 | <code>#define JEV_EXCERPT          512</code> |
| `JEV_MAX_ANSWERS` | symbol | 39 | <code>#define JEV_MAX_ANSWERS      512</code> |
| `jev_config` | symbol | 51 | <code>static void jev_config(JevConfig *c) {</code> |
| `dup_list` | symbol | 73 | <code>static char **dup_list(const char *const *v, int n) {</code> |
| `jev_question_noul` | symbol | 80 | <code>int jev_question_noul(JevQuestion *q, const char *name,</code> |
| `jev_question_choice` | symbol | 98 | <code>int jev_question_choice(JevQuestion *q, const char *name,</code> |
| `jev_question_score` | symbol | 112 | <code>int jev_question_score(JevQuestion *q, const char *name,</code> |
| `jev_question_free` | symbol | 125 | <code>void jev_question_free(JevQuestion *q) {</code> |
| `jev_type_name` | symbol | 137 | <code>static const char *jev_type_name(int t) {</code> |
| `json_value_ok` | symbol | 143 | <code>static bool json_value_ok(const char *s) {</code> |
| `cmp_str_idx` | symbol | 175 | <code>static int cmp_str_idx(const void *a, const void *b, void *arg) {</code> |
| `sorted_order` | symbol | 180 | <code>static void sorted_order(char **v, int n, int *idx) {</code> |
| `sb_question` | symbol | 185 | <code>static void sb_question(StrBuf *b, const JevQuestion *q) {</code> |
| `jev_request_json` | symbol | 214 | <code>void jev_request_json(const char *model, const char *state_json,</code> |
| `sb_cfgquote` | symbol | 242 | <code>static void sb_cfgquote(StrBuf *b, const char *s) {</code> |
| `jev_tmp_dir` | symbol | 255 | <code>static int jev_tmp_dir(const Cg *cg, char *out, size_t cap) {</code> |
| `write_private` | symbol | 268 | <code>static int write_private(const char *path, const char *data) {</code> |
| `sleep_ms` | symbol | 281 | <code>static void sleep_ms(long ms) {</code> |
| `excerpt_of` | symbol | 287 | <code>static void excerpt_of(const char *s, char *out, size_t cap) {</code> |
| `curl_once` | symbol | 299 | <code>static int curl_once(const char *curl, const char *cfg, char **body,</code> |
| `jnum` | symbol | 333 | <code>static double jnum(const char *obj, const char *key, bool *ok) {</code> |
| `jev_parse` | symbol | 345 | <code>static int jev_parse(const char *resp, JevResult *out) {</code> |
| `jev_answer` | symbol | 425 | <code>const JevAnswer *jev_answer(const JevResult *r, const char *name) {</code> |
| `jev_result_free` | symbol | 431 | <code>void jev_result_free(JevResult *r) {</code> |
| `jev_log_path` | symbol | 443 | <code>static void jev_log_path(const Cg *cg, char *out, size_t cap) {</code> |
| `jev_log` | symbol | 449 | <code>static void jev_log(const Cg *cg, const JevConfig *c, const JevResult *r,</code> |
| `count_questions` | symbol | 492 | <code>static int count_questions(const char *body) {</code> |
| `jev_ask_raw` | symbol | 502 | <code>int jev_ask_raw(Cg *cg, const char *body_in, JevResult *out) {</code> |
| `jev_ask` | symbol | 613 | <code>int jev_ask(Cg *cg, const char *state_json, const JevQuestion *qs, int nq,</code> |
| `print_probabilities` | symbol | 635 | <code>static void print_probabilities(const char *probs, StrBuf *b) {</code> |
| `jev_result_json` | symbol | 645 | <code>static void jev_result_json(const JevResult *r, StrBuf *b) {</code> |
| `jev_result_text` | symbol | 675 | <code>static void jev_result_text(const JevResult *r, StrBuf *b) {</code> |
| `ask_push` | symbol | 719 | <code>static JevQuestion *ask_push(AskArgs *a) {</code> |
| `list_push` | symbol | 729 | <code>static void list_push(char ***v, int *n, const char *s) {</code> |
| `ask_usage` | symbol | 734 | <code>static int ask_usage(void) {</code> |
| `jev_ask_cli` | symbol | 743 | <code>static int jev_ask_cli(Cg *cg, int argc, char **argv, bool json) {</code> |
| `curl_version` | symbol | 889 | <code>static void curl_version(const char *curl, char *out, size_t cap) {</code> |
| `key_hint` | symbol | 911 | <code>static void key_hint(const char *key, char *out, size_t cap) {</code> |
| `log_stats` | symbol | 918 | <code>static long log_stats(const char *path, long *last_ts) {</code> |
| `jev_doctor` | symbol | 934 | <code>static int jev_doctor(Cg *cg, bool probe, bool json) {</code> |
| `jev_log_cmd` | symbol | 1026 | <code>static int jev_log_cmd(Cg *cg, int limit, bool json) {</code> |
| `cmd_jev` | symbol | 1098 | <code>int cmd_jev(Cg *cg, int argc, char **argv, bool json) {</code> |
| `JEV_TAIL_BYTES` | symbol | 1127 | <code>#define JEV_TAIL_BYTES 4096</code> |
| `JEV_TAIL_LINES` | symbol | 1128 | <code>#define JEV_TAIL_LINES 40</code> |
| `JEV_MAX_RANK` | symbol | 1129 | <code>#define JEV_MAX_RANK   50</code> |
| `jev_advisory_ready` | symbol | 1131 | <code>bool jev_advisory_ready(const char *what) {</code> |
| `jev_advisory_failed` | symbol | 1138 | <code>static void jev_advisory_failed(const char *what, const JevResult *r) {</code> |
| `jev_tail` | symbol | 1145 | <code>static void jev_tail(const char *s, StrBuf *out) {</code> |
| `answer_confidence` | symbol | 1164 | <code>static double answer_confidence(const JevAnswer *a) {</code> |
| `sb_confidence` | symbol | 1168 | <code>static void sb_confidence(StrBuf *b, double c) {</code> |
| `jev_triage_failure` | symbol | 1172 | <code>int jev_triage_failure(Cg *cg, const char *output, JevTriage *out) {</code> |
| `rank_sort` | symbol | 1249 | <code>static void rank_sort(JevFinding *v, int n) {</code> |
| `jev_rank_findings` | symbol | 1258 | <code>int jev_rank_findings(Cg *cg, JevFinding *v, int n) {</code> |
| `jev_pr_readiness` | symbol | 1324 | <code>int jev_pr_readiness(Cg *cg, const char *state_json, JevReadiness *out) {</code> |
| `jev_report_error` | symbol | 1360 | <code>int jev_report_error(const JevResult *r, const char *what) {</code> |

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
| `json_array_items` | symbol | 173 | <code>int json_array_items(const char *arr, char ***out) {</code> |

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
| `DefPat` | symbol | 13 | <code>typedef struct { const char *kind; const char *pat; int group; } DefPat;</code> |
| `ImpStyle` | symbol | 16 | <code>typedef enum {</code> |
| `MAXPATS` | symbol | 26 | <code>#define MAXPATS 12</code> |
| `LangSpec` | symbol | 27 | <code>typedef struct {</code> |
| `NLANGS` | symbol | 139 | <code>#define NLANGS ((int)(sizeof LANGS / sizeof LANGS[0]))</code> |
| `word_in` | symbol | 180 | <code>static bool word_in(const char *const *words, const char *s, size_t n) {</code> |
| `is_keyword` | symbol | 193 | <code>static bool is_keyword(const LangSpec *L, const char *s, size_t n) {</code> |
| `lang_global_init` | symbol | 199 | <code>void lang_global_init(void) {</code> |
| `spec_by_name` | symbol | 222 | <code>static const LangSpec *spec_by_name(const char *name) {</code> |
| `lang_for_path` | symbol | 228 | <code>const char *lang_for_path(const char *path) {</code> |
| `spec_for_path` | symbol | 235 | <code>static const LangSpec *spec_for_path(const char *path) {</code> |
| `CMT_MAX_BYTES` | symbol | 244 | <code>#define CMT_MAX_BYTES 4000        /* a span longer than this is a licence header */</code> |
| `add_cmt` | symbol | 246 | <code>static void add_cmt(ParseResult *pr, const char *body, int line, int end,</code> |
| `CmtAcc` | symbol | 263 | <code>typedef struct { StrBuf b; int line, end; bool pure, open, below; } CmtAcc;</code> |
| `cmt_flush` | symbol | 265 | <code>static void cmt_flush(CmtAcc *a, ParseResult *pr) {</code> |
| `PARAM_MAX` | symbol | 277 | <code>#define PARAM_MAX 16</code> |
| `PARAM_LEN` | symbol | 278 | <code>#define PARAM_LEN 64</code> |
| `idstart` | symbol | 280 | <code>static bool idstart(char c);</code> |
| `idchar` | symbol | 281 | <code>static bool idchar(char c);</code> |
| `params_capture` | symbol | 291 | <code>static bool params_capture(const char *after, bool cfam, bool cont,</code> |
| `add_def` | symbol | 346 | <code>static void add_def(ParseResult *pr, const char *name, size_t nlen,</code> |
| `count_args` | symbol | 378 | <code>static int count_args(const char *clean, size_t open) {</code> |
| `add_ref` | symbol | 394 | <code>static void add_ref(ParseResult *pr, const char *name, size_t nlen, int line,</code> |
| `add_import` | symbol | 416 | <code>static void add_import(ParseResult *pr, const char *name, size_t nlen,</code> |
| `route_add` | symbol | 436 | <code>void route_add(ParseResult *pr, const char *framework, const char *method,</code> |
| `parse_result_free` | symbol | 450 | <code>void parse_result_free(ParseResult *pr) {</code> |
| `starts_with` | symbol | 468 | <code>static bool starts_with(const char *s, const char *pre) {</code> |
| `CmtRange` | symbol | 475 | <code>typedef struct { int start, end; } CmtRange;</code> |
| `cmt_mark` | symbol | 477 | <code>static void cmt_mark(CmtRange *cr, size_t a, size_t b) {</code> |
| `CleanState` | symbol | 484 | <code>typedef struct {</code> |
| `clean_line` | symbol | 493 | <code>static void clean_line(const LangSpec *L, const char *line, size_t n,</code> |
| `idstart` | symbol | 570 | <code>static bool idstart(char c) { return isalpha((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `idchar` | symbol | 571 | <code>static bool idchar(char c)  { return isalnum((unsigned char)c) &#124;&#124; c == '_'; }</code> |
| `lang_scope_end` | symbol | 580 | <code>static int lang_scope_end(const LangSpec *L, char *const *lines, int nlines,</code> |
| `SIG_SPAN` | symbol | 625 | <code>#define SIG_SPAN 40</code> |
| `callable_end` | symbol | 626 | <code>static int callable_end(const LangSpec *L, char *const *lines, int nlines,</code> |
| `skip_sp` | symbol | 683 | <code>static const char *skip_sp(const char *s) {</code> |
| `kw_at` | symbol | 688 | <code>static bool kw_at(const char *s, const char *kw) {</code> |
| `quoted_span` | symbol | 694 | <code>static bool quoted_span(const char *s, const char **out, size_t *n) {</code> |
| `seg_name` | symbol | 706 | <code>static void seg_name(const char *s, const char *e, const char **out, size_t *n) {</code> |
| `imp_js` | symbol | 721 | <code>static void imp_js(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_py` | symbol | 757 | <code>static void imp_py(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_go` | symbol | 799 | <code>static void imp_go(const char *line, int lineno, ParseResult *pr, int *state) {</code> |
| `imp_inc` | symbol | 822 | <code>static void imp_inc(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_rust` | symbol | 839 | <code>static void imp_rust(const char *line, int lineno, ParseResult *pr) {</code> |
| `imp_dot` | symbol | 875 | <code>static void imp_dot(const LangSpec *L, const char *line, int lineno,</code> |
| `lang_scan_imports` | symbol | 899 | <code>static void lang_scan_imports(const LangSpec *L, const char *line, int lineno,</code> |
| `lang_parse` | symbol | 912 | <code>void lang_parse(const char *lang, const char *path, const char *src,</code> |

## src/lsp.c

[Open source](../src/lsp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LSP_KIND_FN` | symbol | 22 | <code>#define LSP_KIND_FN 12</code> |
| `LSP_LOCK_WAIT_MS` | symbol | 29 | <code>#define LSP_LOCK_WAIT_MS 1500</code> |
| `LSP_INDEX_RETRY_MS` | symbol | 30 | <code>#define LSP_INDEX_RETRY_MS 3000</code> |
| `LSP_FRESH_MS` | symbol | 31 | <code>#define LSP_FRESH_MS 3000</code> |
| `lsp_index` | symbol | 40 | <code>static void lsp_index(Cg *cg, const SysInfo *si, const char *abs) {</code> |
| `lsp_read` | symbol | 70 | <code>static char *lsp_read(void) {</code> |
| `lsp_send` | symbol | 89 | <code>static void lsp_send(const char *payload) {</code> |
| `lsp_reply` | symbol | 94 | <code>static void lsp_reply(const char *id, const char *result) {</code> |
| `lsp_notify` | symbol | 101 | <code>static void lsp_notify(const char *method, const char *params) {</code> |
| `uri_to_path` | symbol | 111 | <code>static void uri_to_path(const char *uri, char *out, size_t cap) {</code> |
| `path_to_uri` | symbol | 127 | <code>static void path_to_uri(const char *root, const char *rel, StrBuf *b) {</code> |
| `rel_of` | symbol | 135 | <code>static const char *rel_of(const Cg *cg, const char *abs) {</code> |
| `emit_location` | symbol | 143 | <code>static void emit_location(Cg *cg, StrBuf *b, const char *path, int line,</code> |
| `word_at` | symbol | 156 | <code>static bool word_at(const char *abs, int line0, int chr, char *out, size_t cap) {</code> |
| `lsp_hover` | symbol | 182 | <code>void lsp_hover(Cg *cg, const char *name, StrBuf *md) {</code> |
| `diag_add` | symbol | 224 | <code>static void diag_add(StrBuf *b, int *n, int line, int severity,</code> |
| `lsp_path_in_task_scope` | symbol | 238 | <code>bool lsp_path_in_task_scope(Cg *cg, const char *rel) {</code> |
| `lsp_diagnostics` | symbol | 258 | <code>void lsp_diagnostics(Cg *cg, const char *abs, StrBuf *out) {</code> |
| `publish_diagnostics` | symbol | 311 | <code>static void publish_diagnostics(Cg *cg, const char *uri, const char *abs) {</code> |
| `request_word` | symbol | 324 | <code>static bool request_word(Cg *cg, const char *params, char *word, size_t wcap,</code> |
| `cmd_lsp` | symbol | 345 | <code>int cmd_lsp(Cg *cg, const SysInfo *si) {</code> |

## src/main.c

[Open source](../src/main.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `usage` | symbol | 6 | <code>static void usage(void) {</code> |
| `flag` | symbol | 217 | <code>static bool flag(int *argc, char **argv, const char *name) {</code> |
| `opt` | symbol | 229 | <code>static const char *opt(int *argc, char **argv, const char *name,</code> |
| `cmd_info` | symbol | 243 | <code>static int cmd_info(const SysInfo *si, Cg *cg, bool json) {</code> |
| `FRESH_WINDOW_MS` | symbol | 314 | <code>#define FRESH_WINDOW_MS 3000</code> |
| `index_fresh` | symbol | 315 | <code>static void index_fresh(Cg *cg, const SysInfo *si) {</code> |
| `main` | symbol | 325 | <code>int main(int argc, char **argv) {</code> |

## src/mcp.c

[Open source](../src/mcp.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `CallCtx` | symbol | 18 | <code>typedef struct {</code> |
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
| `t_memory_export` | symbol | 305 | <code>static int t_memory_export(void *v) {</code> |
| `t_memory_import` | symbol | 323 | <code>static int t_memory_import(void *v) {</code> |
| `t_show` | symbol | 353 | <code>static int t_show(void *v) {</code> |
| `t_why` | symbol | 364 | <code>static int t_why(void *v) {</code> |
| `t_test_impact` | symbol | 372 | <code>static int t_test_impact(void *v) {</code> |
| `t_brief` | symbol | 379 | <code>static int t_brief(void *v)  { CallCtx *c = v; return cmd_brief(c-&gt;cg, true); }</code> |
| `t_review` | symbol | 380 | <code>static int t_review(void *v) { CallCtx *c = v; return cmd_review(c-&gt;cg, true); }</code> |
| `t_check` | symbol | 381 | <code>static int t_check(void *v)  { CallCtx *c = v; return cmd_check(c-&gt;cg, true, false); }</code> |
| `t_guard` | symbol | 382 | <code>static int t_guard(void *v) {</code> |
| `t_git_sync` | symbol | 390 | <code>static int t_git_sync(void *v) {</code> |
| `t_spec_wave` | symbol | 395 | <code>static int t_spec_wave(void *v) {</code> |
| `t_spec_lint` | symbol | 400 | <code>static int t_spec_lint(void *v) {</code> |
| `t_spec_new` | symbol | 405 | <code>static int t_spec_new(void *v) {</code> |
| `t_spec_add` | symbol | 414 | <code>static int t_spec_add(void *v) {</code> |
| `t_spec_claim` | symbol | 445 | <code>static int t_spec_claim(void *v) {</code> |
| `t_spec_release` | symbol | 460 | <code>static int t_spec_release(void *v) {</code> |
| `t_spec_ready` | symbol | 475 | <code>static int t_spec_ready(void *v) {</code> |
| `t_spec_claim_next` | symbol | 480 | <code>static int t_spec_claim_next(void *v) {</code> |
| `t_handoff` | symbol | 493 | <code>static int t_handoff(void *v) {</code> |
| `t_resume` | symbol | 506 | <code>static int t_resume(void *v) {</code> |
| `t_memory_classify` | symbol | 517 | <code>static int t_memory_classify(void *v) {</code> |
| `t_skills_list` | symbol | 527 | <code>static int t_skills_list(void *v) {</code> |
| `t_skills_promote` | symbol | 532 | <code>static int t_skills_promote(void *v) {</code> |
| `t_codemap` | symbol | 543 | <code>static int t_codemap(void *v) {</code> |
| `S_QUERY` | symbol | 553 | <code>#define S_QUERY  "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \</code> |
| `S_CTX` | symbol | 555 | <code>#define S_CTX    "{\"type\":\"object\",\"properties\":{\"query\":{\"type\":\"string\"}," \</code> |
| `S_SURVEY` | symbol | 559 | <code>#define S_SURVEY "{\"type\":\"object\",\"properties\":{\"scope\":{\"type\":" \</code> |
| `S_ANCHORS` | symbol | 563 | <code>#define S_ANCHORS "{\"type\":\"object\",\"properties\":{\"stale\":{\"type\":" \</code> |
| `S_NAME` | symbol | 567 | <code>#define S_NAME   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}}," \</code> |
| `S_IMPACT` | symbol | 569 | <code>#define S_IMPACT "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \</code> |
| `S_FILTER` | symbol | 573 | <code>#define S_FILTER "{\"type\":\"object\",\"properties\":{\"filter\":{\"type\":\"string\"}}}"</code> |
| `S_EMPTY` | symbol | 574 | <code>#define S_EMPTY  "{\"type\":\"object\",\"properties\":{}}"</code> |
| `S_INTEGRATE` | symbol | 575 | <code>#define S_INTEGRATE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_EVENT` | symbol | 579 | <code>#define S_EVENT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_OPEN` | symbol | 583 | <code>#define S_WORK_OPEN "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_UPDATE` | symbol | 585 | <code>#define S_WORK_UPDATE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_WORK_CLOSE` | symbol | 588 | <code>#define S_WORK_CLOSE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RECONCILE` | symbol | 592 | <code>#define S_RECONCILE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_LIMIT` | symbol | 595 | <code>#define S_LIMIT  "{\"type\":\"object\",\"properties\":{\"limit\":{\"type\":\"integer\"}}}"</code> |
| `S_MSG` | symbol | 596 | <code>#define S_MSG    "{\"type\":\"object\",\"properties\":{\"message\":{\"type\":\"string\"}}," \</code> |
| `S_TASKID` | symbol | 598 | <code>#define S_TASKID "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_TASKDN` | symbol | 600 | <code>#define S_TASKDN "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_MODE` | symbol | 603 | <code>#define S_MODE   "{\"type\":\"object\",\"properties\":{\"mode\":{" \</code> |
| `S_CHECK` | symbol | 606 | <code>#define S_CHECK  "{\"type\":\"object\",\"properties\":{\"check\":{\"type\":\"boolean\"}}}"</code> |
| `S_TRACE` | symbol | 607 | <code>#define S_TRACE  "{\"type\":\"object\",\"properties\":{\"id\":{\"type\":\"string\"," \</code> |
| `S_REMEMBER` | symbol | 609 | <code>#define S_REMEMBER "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_FEATURE` | symbol | 617 | <code>#define S_FEATURE "{\"type\":\"object\",\"properties\":{\"feature\":" \</code> |
| `S_PATHOPT` | symbol | 619 | <code>#define S_PATHOPT "{\"type\":\"object\",\"properties\":{\"path\":" \</code> |
| `S_SHOW` | symbol | 622 | <code>#define S_SHOW   "{\"type\":\"object\",\"properties\":{\"name\":{\"type\":\"string\"}," \</code> |
| `S_NAMEOPT` | symbol | 625 | <code>#define S_NAMEOPT "{\"type\":\"object\",\"properties\":{\"name\":" \</code> |
| `S_CLAIM` | symbol | 628 | <code>#define S_CLAIM  "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_ADD` | symbol | 633 | <code>#define S_ADD    "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RECALL` | symbol | 643 | <code>#define S_RECALL "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_MEMEXPORT` | symbol | 648 | <code>#define S_MEMEXPORT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_MEMIMPORT` | symbol | 657 | <code>#define S_MEMIMPORT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_CLAIMNEXT` | symbol | 669 | <code>#define S_CLAIMNEXT "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RELEASE` | symbol | 674 | <code>#define S_RELEASE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_HANDOFF` | symbol | 680 | <code>#define S_HANDOFF "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_RESUME` | symbol | 687 | <code>#define S_RESUME "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_CLASSIFY` | symbol | 690 | <code>#define S_CLASSIFY "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_PROMOTE` | symbol | 695 | <code>#define S_PROMOTE "{\"type\":\"object\",\"properties\":{" \</code> |
| `S_CODEMAP` | symbol | 698 | <code>#define S_CODEMAP "{\"type\":\"object\",\"properties\":{" \</code> |
| `A_READ` | symbol | 707 | <code>#define A_READ  "{\"readOnlyHint\":true,\"destructiveHint\":false," \</code> |
| `A_WRITE` | symbol | 709 | <code>#define A_WRITE "{\"readOnlyHint\":false,\"destructiveHint\":false," \</code> |
| `A_MUTATE` | symbol | 711 | <code>#define A_MUTATE "{\"readOnlyHint\":false,\"destructiveHint\":true," \</code> |
| `MCP_FRESH_MS` | symbol | 716 | <code>#define MCP_FRESH_MS 1500</code> |
| `MCP_GATE_WAIT_MS` | symbol | 717 | <code>#define MCP_GATE_WAIT_MS 1500</code> |
| `NTOOLS` | symbol | 1015 | <code>#define NTOOLS ((int)(sizeof TOOLS / sizeof TOOLS[0]))</code> |
| `mcp_tool_annotations` | symbol | 1086 | <code>static void mcp_tool_annotations(int i, StrBuf *b) {</code> |
| `mcp_resource_abs` | symbol | 1092 | <code>static void mcp_resource_abs(Cg *cg, const char *rel, char *out, size_t cap) {</code> |
| `mcp_list_resources` | symbol | 1104 | <code>static void mcp_list_resources(Cg *cg, StrBuf *r) {</code> |
| `mcp_list_prompts` | symbol | 1145 | <code>static void mcp_list_prompts(StrBuf *r) {</code> |
| `mcp_tools_json` | symbol | 1159 | <code>void mcp_tools_json(StrBuf *r) {</code> |
| `mcp_call_tool` | symbol | 1176 | <code>int mcp_call_tool(Cg *cg, const SysInfo *si, const char *name,</code> |
| `cmd_tool` | symbol | 1204 | <code>int cmd_tool(Cg *cg, const SysInfo *si, int argc, char **argv, bool json) {</code> |
| `send_line` | symbol | 1254 | <code>static void send_line(StrBuf *b) {</code> |
| `reply_result` | symbol | 1261 | <code>static void reply_result(const char *id, const char *result_json) {</code> |
| `reply_error` | symbol | 1268 | <code>static void reply_error(const char *id, int code, const char *msg) {</code> |
| `cmd_mcp` | symbol | 1277 | <code>int cmd_mcp(Cg *cg, const SysInfo *si) {</code> |
| `self_path` | symbol | 1426 | <code>static int self_path(char *out, size_t cap) {</code> |
| `server_entry` | symbol | 1433 | <code>static char *server_entry(const char *bin, bool vscode_style) {</code> |
| `install_json` | symbol | 1444 | <code>static void install_json(const char *path, const char *root_key,</code> |
| `cmd_mcp_install` | symbol | 1492 | <code>int cmd_mcp_install(Cg *cg) {</code> |

## src/memory.c

[Open source](../src/memory.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `memory_open_quiet` | symbol | 17 | <code>bool memory_open_quiet(Cg *g) {</code> |
| `bind_opt` | symbol | 23 | <code>static void bind_opt(sqlite3_stmt *st, int i, const char *v) {</code> |
| `memory_add` | symbol | 28 | <code>long memory_add(Cg *cg, const char *type, const char *task, const char *body,</code> |
| `fts_query` | symbol | 86 | <code>static char *fts_query(const char *q) {</code> |
| `col_dup` | symbol | 106 | <code>static char *col_dup(sqlite3_stmt *st, int i) {</code> |
| `mem_row` | symbol | 115 | <code>static void mem_row(sqlite3_stmt *st, Memory *m) {</code> |
| `memory_get` | symbol | 139 | <code>bool memory_get(Cg *cg, long id, Memory *out) {</code> |
| `mem_scope` | symbol | 153 | <code>static const char *mem_scope(Cg *cg, char *out, size_t cap) {</code> |
| `MEM_BRANCH_CTE` | symbol | 174 | <code>#define MEM_BRANCH_CTE \</code> |
| `MEM_BRANCH_WHERE` | symbol | 178 | <code>#define MEM_BRANCH_WHERE \</code> |
| `SUPERSEDED_RANK` | symbol | 185 | <code>#define SUPERSEDED_RANK \</code> |
| `memory_query` | symbol | 188 | <code>int memory_query(Cg *cg, const char *query, const char *task,</code> |
| `memory_clear` | symbol | 229 | <code>void memory_clear(Memory *m) {</code> |
| `memory_free` | symbol | 236 | <code>void memory_free(Memory *v, int n) {</code> |
| `memory_json` | symbol | 241 | <code>void memory_json(const Memory *m, StrBuf *b) {</code> |
| `memory_print_brief` | symbol | 267 | <code>void memory_print_brief(const Memory *m, const char *indent) {</code> |
| `cmd_remember` | symbol | 280 | <code>int cmd_remember(Cg *cg, const char *text, const char *type, const char *task,</code> |
| `cmd_recall` | symbol | 310 | <code>int cmd_recall(Cg *cg, const char *query, const char *task, const char *type,</code> |
| `cmd_forget` | symbol | 357 | <code>int cmd_forget(Cg *cg, const char *idstr) {</code> |
| `memory_supersede` | symbol | 382 | <code>int memory_supersede(Cg *cg, long old_id, long new_id) {</code> |
| `cmd_recall_near` | symbol | 405 | <code>int cmd_recall_near(Cg *cg, const char *path, int limit, bool json) {</code> |
| `cmd_memory_compact` | symbol | 449 | <code>int cmd_memory_compact(Cg *cg, bool dry_run, bool json) {</code> |
| `NCLASSES` | symbol | 518 | <code>#define NCLASSES ((int)(sizeof CLASS_KEYS / sizeof CLASS_KEYS[0]))</code> |
| `CLASSIFY_DEFAULT_LIMIT` | symbol | 519 | <code>#define CLASSIFY_DEFAULT_LIMIT 50</code> |
| `state_field` | symbol | 521 | <code>static void state_field(StrBuf *b, const char *key, const char *val) {</code> |
| `classify_state` | symbol | 529 | <code>static char *classify_state(const Memory *m) {</code> |
| `classify_one` | symbol | 545 | <code>static int classify_one(Cg *cg, Memory *m, double *reusable) {</code> |
| `classify_store` | symbol | 583 | <code>static void classify_store(Cg *cg, const Memory *m) {</code> |
| `classify_select` | symbol | 596 | <code>static int classify_select(Cg *cg, const char *sel, int limit, Memory **out) {</code> |
| `cmd_memory_classify` | symbol | 633 | <code>int cmd_memory_classify(Cg *cg, const char *sel, int limit, bool json) {</code> |
| `memory_promote_branch` | symbol | 713 | <code>int memory_promote_branch(Cg *cg, const char *from, const char *to) {</code> |
| `PORT_FORMAT` | symbol | 751 | <code>#define PORT_FORMAT  "codify-memories"</code> |
| `PORT_VERSION` | symbol | 752 | <code>#define PORT_VERSION 1</code> |
| `memory_content_id` | symbol | 757 | <code>void memory_content_id(const char *type, const char *task, const char *body,</code> |
| `db_has` | symbol | 769 | <code>static bool db_has(sqlite3 *db, const char *sql, const char *a,</code> |
| `db_has_column` | symbol | 780 | <code>static bool db_has_column(sqlite3 *db, const char *table, const char *col) {</code> |
| `db_has_table` | symbol | 785 | <code>static bool db_has_table(sqlite3 *db, const char *table) {</code> |
| `port_str` | symbol | 790 | <code>static void port_str(StrBuf *b, const char *key, const char *v) {</code> |
| `port_export` | symbol | 799 | <code>static int port_export(sqlite3 *db, const char *project,</code> |
| `base_name` | symbol | 889 | <code>static const char *base_name(const char *path) {</code> |
| `cmd_memory_export` | symbol | 894 | <code>int cmd_memory_export(Cg *cg, const MemExportOpts *o, bool json) {</code> |
| `jv_value` | symbol | 932 | <code>static const char *jv_value(const char *p, int depth);</code> |
| `jv_ws` | symbol | 934 | <code>static const char *jv_ws(const char *p) {</code> |
| `jv_string` | symbol | 939 | <code>static const char *jv_string(const char *p) {</code> |
| `jv_digits` | symbol | 958 | <code>static const char *jv_digits(const char *p) {</code> |
| `jv_number` | symbol | 964 | <code>static const char *jv_number(const char *p) {</code> |
| `jv_value` | symbol | 976 | <code>static const char *jv_value(const char *p, int depth) {</code> |
| `json_object_ok` | symbol | 1003 | <code>static bool json_object_ok(const char *s) {</code> |
| `port_get_str` | symbol | 1011 | <code>static char *port_get_str(const char *obj, const char *key, bool *bad) {</code> |
| `PortRec` | symbol | 1020 | <code>typedef struct {</code> |
| `port_rec_free` | symbol | 1035 | <code>static void port_rec_free(PortRec *r) {</code> |
| `port_type_ok` | symbol | 1044 | <code>static bool port_type_ok(const char *t) {</code> |
| `port_parse_line` | symbol | 1054 | <code>static const char *port_parse_line(const char *s, PortRec *r) {</code> |
| `PortIn` | symbol | 1094 | <code>typedef struct {</code> |
| `port_bad_line` | symbol | 1102 | <code>static void port_bad_line(PortIn *in, int line, const char *why) {</code> |
| `port_parse` | symbol | 1114 | <code>static int port_parse(char *text, PortIn *in, char *err, size_t errcap) {</code> |
| `CidRow` | symbol | 1179 | <code>typedef struct { char cid[65]; long row; } CidRow;</code> |
| `cid_cmp` | symbol | 1181 | <code>static int cid_cmp(const void *a, const void *b) {</code> |
| `cid_row` | symbol | 1188 | <code>static long cid_row(const CidRow *v, int n, const char *cid) {</code> |
| `target_cids` | symbol | 1200 | <code>static int target_cids(Cg *cg, CidRow **out) {</code> |
| `port_from_dir` | symbol | 1220 | <code>static int port_from_dir(Cg *cg, const char *dir, StrBuf *out,</code> |
| `port_step` | symbol | 1256 | <code>static bool port_step(Cg *cg, sqlite3_stmt *st, char *err, size_t errcap) {</code> |
| `port_insert` | symbol | 1264 | <code>static bool port_insert(Cg *cg, PortRec *r, char *err, size_t errcap) {</code> |
| `port_relink` | symbol | 1294 | <code>static int port_relink(Cg *cg, PortIn *in, const CidRow *tv, int tn,</code> |
| `port_plan` | symbol | 1349 | <code>static void port_plan(Cg *cg, PortIn *in, const MemImportOpts *o,</code> |
| `port_read_input` | symbol | 1405 | <code>static int port_read_input(Cg *cg, const MemImportOpts *o, char **text,</code> |
| `cmd_memory_import` | symbol | 1427 | <code>int cmd_memory_import(Cg *cg, const MemImportOpts *o, bool json) {</code> |

## src/orchestrate.c

[Open source](../src/orchestrate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ORCH_MAX_SLOTS` | symbol | 28 | <code>#define ORCH_MAX_SLOTS 16</code> |
| `ORCH_MAX_ARGV` | symbol | 29 | <code>#define ORCH_MAX_ARGV  64</code> |
| `orch_on_signal` | symbol | 33 | <code>static void orch_on_signal(int sig) {</code> |
| `OrchCfg` | symbol | 40 | <code>typedef struct {</code> |
| `orch_raw_str` | symbol | 54 | <code>static char *orch_raw_str(const Kvx *k, const char *sec, const char *key) {</code> |
| `orch_cfg_load` | symbol | 71 | <code>static void orch_cfg_load(const Kvx *wf, OrchCfg *c) {</code> |
| `orch_cfg_free` | symbol | 89 | <code>static void orch_cfg_free(OrchCfg *c) {</code> |
| `OrchSpecCall` | symbol | 97 | <code>typedef struct { int argc; char **argv; bool json; } OrchSpecCall;</code> |
| `orch_call_spec` | symbol | 99 | <code>static int orch_call_spec(void *v) {</code> |
| `orch_spec` | symbol | 112 | <code>static int orch_spec(char **out, bool json, int argc, ...) {</code> |
| `OrchResumeCall` | symbol | 122 | <code>typedef struct { Cg *g; const char *task; } OrchResumeCall;</code> |
| `orch_call_resume` | symbol | 124 | <code>static int orch_call_resume(void *v) {</code> |
| `orch_call_docs_packet` | symbol | 129 | <code>static int orch_call_docs_packet(void *v) {</code> |
| `orch_docs_ready` | symbol | 137 | <code>static bool orch_docs_ready(const char *id) {</code> |
| `orch_prompt_retry` | symbol | 157 | <code>static void orch_prompt_retry(const char *path, const char *feature,</code> |
| `orch_roles_load` | symbol | 160 | <code>static void orch_roles_load(const Hierarchy *h) {</code> |
| `orch_argv` | symbol | 177 | <code>static int orch_argv(const char *driver, const char *extra, const char *cmd,</code> |
| `orch_argv_free` | symbol | 190 | <code>static void orch_argv_free(char **av) {</code> |
| `orch_argv_print` | symbol | 194 | <code>static void orch_argv_print(char **av) {</code> |
| `orch_spec_root` | symbol | 207 | <code>static int orch_spec_root(char *out, size_t cap) {</code> |
| `orch_task_status` | symbol | 213 | <code>static char *orch_task_status(const char *specroot, const char *feature,</code> |
| `orch_abandon` | symbol | 254 | <code>static void orch_abandon(const char *specroot, const char *feature,</code> |
| `orch_event` | symbol | 289 | <code>static void orch_event(const char *kind, const char *role, const char *agent,</code> |
| `OE` | symbol | 296 | <code>#define OE(k, v) do { if (v) { sb_puts(&amp;p, ",\"" k "\":"); \</code> |
| `orch_note_failure` | symbol | 311 | <code>static void orch_note_failure(const char *feature, const char *id, int rc) {</code> |
| `orch_prompt_steer` | symbol | 327 | <code>static void orch_prompt_steer(const char *path, const char *agent) {</code> |
| `orch_write_prompt` | symbol | 345 | <code>static int orch_write_prompt(const char *cgroot, const char *feature,</code> |
| `orch_spawn` | symbol | 379 | <code>static pid_t orch_spawn(char **av, const char *root, const char *promptfile,</code> |
| `orch_dry_run` | symbol | 415 | <code>static int orch_dry_run(const char *specroot, const char *cgroot,</code> |
| `OrchSlot` | symbol | 492 | <code>typedef struct {</code> |
| `orch_heartbeat` | symbol | 504 | <code>static int orch_heartbeat(OrchSlot *slot, long ttl_min) {</code> |
| `orch_live` | symbol | 520 | <code>static int orch_live(const OrchSlot *slots, int n) {</code> |
| `orch_reap` | symbol | 530 | <code>static int orch_reap(pid_t pid) {</code> |
| `FleetRunOpts` | symbol | 552 | <code>typedef struct { const char *run_id; const char *resume; bool all; } FleetRunOpts;</code> |
| `orch_fleet_run` | symbol | 553 | <code>static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,</code> |
| `cmd_spec_run` | symbol | 558 | <code>int cmd_spec_run(int argc, char **argv) {</code> |
| `ORCH_WAKE_BACKOFF` | symbol | 965 | <code>#define ORCH_WAKE_BACKOFF  1          /* seconds between manager wakes */</code> |
| `ORCH_ROUNDS_DFLT` | symbol | 966 | <code>#define ORCH_ROUNDS_DFLT   16          /* manager wakes before giving up */</code> |
| `orch_hier` | symbol | 970 | <code>static Kvx *orch_hier(const char *tree, Hierarchy *h) {</code> |
| `orch_worktree_path` | symbol | 981 | <code>static void orch_worktree_path(const Hierarchy *h, const char *tree,</code> |
| `orch_excerpt` | symbol | 992 | <code>static void orch_excerpt(const StrBuf *b, char *out, size_t cap) {</code> |
| `orch_ahead` | symbol | 1004 | <code>static long orch_ahead(const char *tree, const char *base, const char *branch) {</code> |
| `OrchEnv` | symbol | 1029 | <code>typedef struct { char *v[ORCH_ENVN]; } OrchEnv;</code> |
| `orch_env_save` | symbol | 1031 | <code>static void orch_env_save(OrchEnv *s) {</code> |
| `orch_env_restore` | symbol | 1038 | <code>static void orch_env_restore(OrchEnv *s) {</code> |
| `orch_env_apply` | symbol | 1047 | <code>static void orch_env_apply(const FleetNode *n) {</code> |
| `orch_agent_record` | symbol | 1067 | <code>static void orch_agent_record(Cg *g, const FleetNode *n) {</code> |
| `orch_fleet_exec` | symbol | 1094 | <code>static pid_t orch_fleet_exec(char **av, const FleetNode *n,</code> |
| `OrchTask` | symbol | 1141 | <code>typedef struct {</code> |
| `orch_tasks_free` | symbol | 1151 | <code>static void orch_tasks_free(OrchTask *v, int n) {</code> |
| `orch_tasks_load` | symbol | 1163 | <code>static int orch_tasks_load(Cg *cg, const char *feature, const char *fwt,</code> |
| `orch_task_wave` | symbol | 1251 | <code>static long orch_task_wave(Cg *cg, const char *feature, const char *id) {</code> |
| `OrchSubtree` | symbol | 1263 | <code>typedef struct {</code> |
| `orch_subtree` | symbol | 1271 | <code>static void orch_subtree(Cg *cg, const char *feature, const char *fbranch,</code> |
| `OrchPlanCall` | symbol | 1291 | <code>typedef struct { Cg *g; const char *feature; } OrchPlanCall;</code> |
| `orch_call_plan` | symbol | 1293 | <code>static int orch_call_plan(void *v) {</code> |
| `orch_manager_prompt` | symbol | 1311 | <code>static int orch_manager_prompt(Cg *cg, const FleetNode *n, const char *path) {</code> |
| `orch_spawn_manager` | symbol | 1347 | <code>int orch_spawn_manager(Cg *cg, const char *feature, const char *driver,</code> |
| `OrchBeginCall` | symbol | 1442 | <code>typedef struct { Cg *g; const char *id; const char *feature; } OrchBeginCall;</code> |
| `orch_call_begin` | symbol | 1444 | <code>static int orch_call_begin(void *v) {</code> |
| `orch_json_into` | symbol | 1457 | <code>static void orch_json_into(const char *js, const char *key, char *out,</code> |
| `orch_spawn_worker` | symbol | 1464 | <code>int orch_spawn_worker(Cg *cg, const char *feature, const char *id,</code> |
| `orch_ago` | symbol | 1590 | <code>static void orch_ago(long seen, char *out, size_t cap) {</code> |
| `OrchWorkerRow` | symbol | 1599 | <code>typedef struct {</code> |
| `orch_worker_rows` | symbol | 1606 | <code>static int orch_worker_rows(Cg *cg, const char *feature, OrchWorkerRow **out) {</code> |
| `orch_tree_status` | symbol | 1663 | <code>int orch_tree_status(Cg *cg, const char *feature_ov, bool json) {</code> |
| `OrchFleetSlot` | symbol | 1802 | <code>typedef struct {</code> |
| `orch_live_fleet` | symbol | 1818 | <code>static int orch_live_fleet(const OrchFleetSlot *s, int n) {</code> |
| `orch_finished_id` | symbol | 1824 | <code>static bool orch_finished_id(const OrchTask *v, int n, const char *id) {</code> |
| `orch_attempts` | symbol | 1837 | <code>static int orch_attempts(char **tried, int ntried, const char *id) {</code> |
| `orch_collides` | symbol | 1854 | <code>static bool orch_collides(const char *a, const char *b) {</code> |
| `orch_task_slots` | symbol | 1889 | <code>static bool orch_task_slots(const OrchTask *t, const OrchFleetSlot *slots,</code> |
| `orch_next_task` | symbol | 1900 | <code>static bool orch_next_task(const OrchTask *v, int n, char **tried, int ntried,</code> |
| `orch_node_heartbeat` | symbol | 1916 | <code>static int orch_node_heartbeat(const FleetNode *n, long ttl_min) {</code> |
| `proc_start_time` | symbol | 1930 | <code>static long proc_start_time(pid_t pid) {</code> |
| `proc_alive` | symbol | 1955 | <code>static bool proc_alive(pid_t pid, long start) {</code> |
| `sup_lock_path` | symbol | 1964 | <code>static int sup_lock_path(const char *shared, char *out, size_t cap) {</code> |
| `sup_lock_take` | symbol | 1971 | <code>static int sup_lock_take(const char *shared) {</code> |
| `fleet_supervisor_alive` | symbol | 1980 | <code>bool fleet_supervisor_alive(const char *shared) {</code> |
| `Sup` | symbol | 1988 | <code>typedef struct {</code> |
| `sup_event` | symbol | 2014 | <code>static void sup_event(Sup *s, const char *state, const char *reason) {</code> |
| `sup_save` | symbol | 2027 | <code>static void sup_save(Sup *s) {</code> |
| `sup_set_state` | symbol | 2041 | <code>static void sup_set_state(Sup *s, const char *state, const char *reason) {</code> |
| `sup_control` | symbol | 2057 | <code>static void sup_control(Sup *s) {</code> |
| `sup_node_add` | symbol | 2067 | <code>static long sup_node_add(Sup *s, const FleetNode *n, const char *log,</code> |
| `sup_node_end` | symbol | 2096 | <code>static void sup_node_end(Sup *s, long id, const char *state, int exit,</code> |
| `sup_gone` | symbol | 2115 | <code>static bool sup_gone(pid_t pid, long start, bool adopted, int *crc) {</code> |
| `sup_kill` | symbol | 2129 | <code>static void sup_kill(pid_t pid, long start, bool adopted) {</code> |
| `sup_terminate` | symbol | 2141 | <code>static void sup_terminate(Sup *s) {</code> |
| `sup_tap_adopt` | symbol | 2159 | <code>static void sup_tap_adopt(DriverTap *t, const char *log, const char *agent,</code> |
| `fleet_run_resume` | symbol | 2172 | <code>static int fleet_run_resume(Sup *s) {</code> |
| `COL` | symbol | 2208 | <code>#define COL(i) ((const char *)sqlite3_column_text(st, i))</code> |
| `wall_ms_now` | symbol | 2263 | <code>static long wall_ms_now(void) {</code> |
| `sup_slot_begin` | symbol | 2269 | <code>static void sup_slot_begin(Cg *g, OrchFleetSlot *sl) {</code> |
| `sup_tree_fp` | symbol | 2281 | <code>static void sup_tree_fp(const char *wt, char out[65]) {</code> |
| `sup_progressed` | symbol | 2306 | <code>static bool sup_progressed(Sup *s, OrchFleetSlot *sl) {</code> |
| `sup_note` | symbol | 2334 | <code>static void sup_note(Sup *s, const char *kind, const OrchFleetSlot *sl,</code> |
| `HandoffCall` | symbol | 2348 | <code>typedef struct { Cg *cg; const char *task, *blocked, *note; } HandoffCall;</code> |
| `sup_handoff_call` | symbol | 2349 | <code>static int sup_handoff_call(void *v) {</code> |
| `sup_end_attempt` | symbol | 2357 | <code>static void sup_end_attempt(Sup *s, OrchFleetSlot *sl, const char *kind,</code> |
| `supervisor_budget_check` | symbol | 2374 | <code>static bool supervisor_budget_check(Sup *s, OrchFleetSlot *sl, long now) {</code> |
| `supervisor_stall_check` | symbol | 2395 | <code>static void supervisor_stall_check(Sup *s, OrchFleetSlot *sl, long now) {</code> |
| `sup_supervise` | symbol | 2427 | <code>static void sup_supervise(Sup *s) {</code> |
| `sup_esc_find` | symbol | 2438 | <code>static int sup_esc_find(Sup *s, const char *task) {</code> |
| `supervisor_escalate` | symbol | 2444 | <code>static void supervisor_escalate(Sup *s, const char *task, int level,</code> |
| `supervisor_retry` | symbol | 2498 | <code>static void supervisor_retry(Sup *s, const char *task, const char *why) {</code> |
| `sup_escalations_check` | symbol | 2505 | <code>static void sup_escalations_check(Sup *s, const OrchTask *v, int n) {</code> |
| `orch_prompt_retry` | symbol | 2524 | <code>static void orch_prompt_retry(const char *path, const char *feature,</code> |
| `sup_approval` | symbol | 2577 | <code>static int sup_approval(Sup *s, long *id) {</code> |
| `supervisor_tick` | symbol | 2592 | <code>static int supervisor_tick(Sup *s) {</code> |
| `run_id_new` | symbol | 2885 | <code>static void run_id_new(const char *feature, char *out, size_t cap) {</code> |
| `run_latest_open` | symbol | 2896 | <code>static bool run_latest_open(Cg *g, char *out, size_t cap, char *feature,</code> |
| `fleet_run_open` | symbol | 2913 | <code>static int fleet_run_open(Sup *s, const char *host) {</code> |
| `sup_feature_paths` | symbol | 2940 | <code>static void sup_feature_paths(Cg *g, const char *feature, char *fbranch,</code> |
| `feature_done` | symbol | 2953 | <code>static bool feature_done(Cg *g, const char *feature) {</code> |
| `feature_ready` | symbol | 2977 | <code>static bool feature_ready(Cg *g, const char *feature, char *waiting, size_t cap) {</code> |
| `features_open` | symbol | 2999 | <code>static int features_open(Cg *g, char ***out) {</code> |
| `sup_open` | symbol | 3030 | <code>static int sup_open(Cg *g, Sup *s, const char *feature, const OrchCfg *cfg,</code> |
| `sup_close` | symbol | 3090 | <code>static void sup_close(Sup *s) {</code> |
| `MainAgent` | symbol | 3105 | <code>typedef struct {</code> |
| `orch_main_prompt` | symbol | 3115 | <code>static int orch_main_prompt(Cg *g, const FleetNode *n, Sup *sups, int nsup,</code> |
| `orch_spawn_main` | symbol | 3158 | <code>static int orch_spawn_main(Cg *g, const char *driver, const char *extra,</code> |
| `main_wake` | symbol | 3190 | <code>static void main_wake(MainAgent *m, const char *reason) {</code> |
| `main_tick` | symbol | 3200 | <code>static void main_tick(Cg *g, MainAgent *m, Sup *sups, int nsup,</code> |
| `supervisor_run` | symbol | 3256 | <code>static int supervisor_run(Cg *g, char **features, int nfeat,</code> |
| `orch_fleet_run` | symbol | 3397 | <code>static int orch_fleet_run(const char *feature_ov, const OrchCfg *cfg,</code> |
| `self_exe` | symbol | 3534 | <code>static void self_exe(char *out, size_t cap) {</code> |
| `RunRef` | symbol | 3542 | <code>typedef struct { char run[40], feature[128], state[16]; int pid; bool alive; } RunRef;</code> |
| `run_ref` | symbol | 3544 | <code>static bool run_ref(Cg *cg, const char *run, RunRef *r) {</code> |
| `run_state_set` | symbol | 3565 | <code>static void run_state_set(Cg *cg, const char *run, const char *state,</code> |
| `run_cleanup` | symbol | 3589 | <code>static int run_cleanup(Cg *cg, const char *run, const char *feature) {</code> |
| `Live` | symbol | 3595 | <code>typedef struct { long id; char role[16], agent[128], task[64], attempt[65];</code> |
| `pos_arg` | symbol | 3631 | <code>static const char *pos_arg(int argc, char **argv) {</code> |
| `detach_supervisor` | symbol | 3639 | <code>static int detach_supervisor(Cg *cg, char **pass, int npass,</code> |
| `cmd_fleet_up` | symbol | 3716 | <code>int cmd_fleet_up(Cg *cg, int argc, char **argv, bool json) {</code> |
| `cmd_fleet_control` | symbol | 3764 | <code>int cmd_fleet_control(Cg *cg, const char *verb, int argc, char **argv,</code> |
| `cmd_fleet_runs` | symbol | 3853 | <code>int cmd_fleet_runs(Cg *cg, bool json) {</code> |

## src/recap.c

[Open source](../src/recap.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `RECAP_DECIDE_MODEL` | symbol | 48 | <code>#define RECAP_DECIDE_MODEL    "openrouter/upstage/solar-decide"</code> |
| `RECAP_DECIDE_ENDPOINT` | symbol | 49 | <code>#define RECAP_DECIDE_ENDPOINT "https://gateway.centra.ag/v1/systemone"</code> |
| `RECAP_CHUNK` | symbol | 50 | <code>#define RECAP_CHUNK           6       /* statements per call, 3 questions each; the</code> |
| `RECAP_CHUNK_CHARS` | symbol | 53 | <code>#define RECAP_CHUNK_CHARS     9000</code> |
| `RECAP_PARALLEL` | symbol | 54 | <code>#define RECAP_PARALLEL        6       /* decision calls in flight at once */</code> |
| `RECAP_MAX_SNIPPETS` | symbol | 55 | <code>#define RECAP_MAX_SNIPPETS    160</code> |
| `RECAP_USER_MAX` | symbol | 56 | <code>#define RECAP_USER_MAX        800</code> |
| `RECAP_ASSISTANT_MAX` | symbol | 57 | <code>#define RECAP_ASSISTANT_MAX   400</code> |
| `RECAP_TOOL_MAX` | symbol | 58 | <code>#define RECAP_TOOL_MAX        200</code> |
| `RECAP_KEEP_USERS` | symbol | 59 | <code>#define RECAP_KEEP_USERS      50</code> |
| `RECAP_MIN_TRUE` | symbol | 60 | <code>#define RECAP_MIN_TRUE        0.5</code> |
| `RECAP_MIN_NEED` | symbol | 61 | <code>#define RECAP_MIN_NEED        0.5</code> |
| `Snip` | symbol | 65 | <code>typedef struct {</code> |
| `Session` | symbol | 73 | <code>typedef struct {</code> |
| `NKINDS` | symbol | 98 | <code>#define NKINDS ((int)(sizeof KIND_KEYS / sizeof KIND_KEYS[0]))</code> |
| `KIND_NOISE` | symbol | 99 | <code>#define KIND_NOISE (NKINDS - 1)</code> |
| `sess_push` | symbol | 101 | <code>static void sess_push(Session *s, char role, const char *text) {</code> |
| `sess_file` | symbol | 138 | <code>static void sess_file(Session *s, const char *path) {</code> |
| `sess_free` | symbol | 146 | <code>static void sess_free(Session *s) {</code> |
| `strip_blocks` | symbol | 158 | <code>static void strip_blocks(char *t, const char *tag) {</code> |
| `user_words` | symbol | 175 | <code>static char *user_words(const char *raw) {</code> |
| `assistant_words` | symbol | 211 | <code>static void assistant_words(Session *s, const char *text) {</code> |
| `EMIT` | symbol | 217 | <code>#define EMIT(str) do { sess_push(s, 'a', (str)); if (clean.len) sb_putc(&amp;clean, ' '); sb_puts(&amp;clean, (str)); } while (0)</code> |
| `command_matters` | symbol | 259 | <code>static bool command_matters(const char *cmd) {</code> |
| `set_date` | symbol | 267 | <code>static void set_date(Session *s, const char *ts) {</code> |
| `claude_content` | symbol | 274 | <code>static void claude_content(Session *s, const char *msg, bool user) {</code> |
| `parse_claude` | symbol | 323 | <code>static int parse_claude(Session *s, FILE *f) {</code> |
| `codex_texts` | symbol | 351 | <code>static void codex_texts(Session *s, const char *content, char role) {</code> |
| `parse_codex` | symbol | 365 | <code>static int parse_codex(Session *s, FILE *f) {</code> |
| `Sessions` | symbol | 429 | <code>typedef struct { Session *v; int n, cap; } Sessions;</code> |
| `sessions_add` | symbol | 431 | <code>static void sessions_add(Sessions *ss, const Session *s) {</code> |
| `file_mtime` | symbol | 439 | <code>static long file_mtime(const char *path) {</code> |
| `claude_dir` | symbol | 446 | <code>static void claude_dir(const char *root, char *out, size_t cap) {</code> |
| `find_claude` | symbol | 457 | <code>static void find_claude(const char *root, long oldest, Sessions *out) {</code> |
| `codex_owned` | symbol | 478 | <code>static bool codex_owned(const char *path, const char *root) {</code> |
| `find_codex_in` | symbol | 497 | <code>static void find_codex_in(const char *dir, const char *root, long oldest,</code> |
| `find_codex` | symbol | 526 | <code>static void find_codex(const char *root, long oldest, Sessions *out) {</code> |
| `cmp_newest` | symbol | 537 | <code>static int cmp_newest(const void *a, const void *b) {</code> |
| `cmp_oldest` | symbol | 542 | <code>static int cmp_oldest(const void *a, const void *b) { return -cmp_newest(a, b); }</code> |
| `sess_cap` | symbol | 546 | <code>static void sess_cap(Session *s, int cap) {</code> |
| `Recap` | symbol | 566 | <code>typedef struct {</code> |
| `recap_config` | symbol | 575 | <code>static void recap_config(const Cg *cg, Recap *r) {</code> |
| `role_name` | symbol | 588 | <code>static const char *role_name(char r) {</code> |
| `chunk_state` | symbol | 595 | <code>static void chunk_state(const Session *s, int from, int to, StrBuf *b) {</code> |
| `cache_path` | symbol | 619 | <code>static void cache_path(const Recap *r, const char *state, char *out, size_t cap) {</code> |
| `cache_read` | symbol | 628 | <code>static bool cache_read(const char *path, Session *s, int from, int to) {</code> |
| `cache_write` | symbol | 647 | <code>static void cache_write(const char *path, const Session *s, int from, int to) {</code> |
| `decide_chunk` | symbol | 660 | <code>static int decide_chunk(Cg *cg, Recap *r, Session *s, int from, int to) {</code> |
| `Chunk` | symbol | 737 | <code>typedef struct { int sess, from, to; } Chunk;</code> |
| `chunks_of` | symbol | 739 | <code>static int chunks_of(const Sessions *ss, Chunk **out) {</code> |
| `chunk_cached` | symbol | 762 | <code>static bool chunk_cached(Recap *r, Session *s, const Chunk *c) {</code> |
| `decide_parallel` | symbol | 779 | <code>static void decide_parallel(Cg *cg, Recap *r, Sessions *ss, const Chunk *v, int n, int par) {</code> |
| `decide_all` | symbol | 797 | <code>static void decide_all(Cg *cg, Recap *r, Sessions *ss) {</code> |
| `Pick` | symbol | 819 | <code>typedef struct { int sess, idx; double score; } Pick;</code> |
| `snip_score` | symbol | 821 | <code>static double snip_score(const Snip *p) {</code> |
| `cmp_pick` | symbol | 827 | <code>static int cmp_pick(const void *a, const void *b) {</code> |
| `select_picks` | symbol | 834 | <code>static int select_picks(Sessions *ss, long budget) {</code> |
| `render_decided` | symbol | 859 | <code>static void render_decided(const Sessions *ss, const Recap *r, StrBuf *b) {</code> |
| `run_capture` | symbol | 887 | <code>static void run_capture(const char *cmd, StrBuf *out) {</code> |
| `repo_facts` | symbol | 896 | <code>static void repo_facts(Cg *cg, int since_days, StrBuf *b) {</code> |
| `write_brief` | symbol | 987 | <code>static char *write_brief(Cg *cg, Recap *r, const Sessions *ss, const char *facts,</code> |
| `agent_wanted` | symbol | 1031 | <code>static bool agent_wanted(const char *list, const char *agent) {</code> |
| `cmd_recap` | symbol | 1036 | <code>int cmd_recap(Cg *cg, const RecapOpts *o) {</code> |

## src/resolve.c

[Open source](../src/resolve.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ManifestDep` | symbol | 14 | <code>typedef struct { char *name; } ManifestDep;</code> |
| `Manifest` | symbol | 16 | <code>typedef struct {</code> |
| `manifest_add` | symbol | 22 | <code>static void manifest_add(Manifest *m, const char *name, size_t len) {</code> |
| `manifest_free` | symbol | 33 | <code>static void manifest_free(Manifest *m) {</code> |
| `manifest_has` | symbol | 39 | <code>static bool manifest_has(const Manifest *m, const char *module) {</code> |
| `load_package_json` | symbol | 54 | <code>static void load_package_json(const char *root, Manifest *js) {</code> |
| `load_go_mod` | symbol | 81 | <code>static void load_go_mod(const char *root, Manifest *go) {</code> |
| `load_requirements_txt` | symbol | 124 | <code>static void load_requirements_txt(const char *root, Manifest *py) {</code> |
| `load_pyproject_toml` | symbol | 152 | <code>static void load_pyproject_toml(const char *root, Manifest *py) {</code> |
| `load_cargo_toml` | symbol | 187 | <code>static void load_cargo_toml(const char *root, Manifest *rs) {</code> |
| `strip_ext` | symbol | 226 | <code>static void strip_ext(char *buf, size_t cap, const char *path) {</code> |
| `norm_dots` | symbol | 235 | <code>static void norm_dots(char *p) {</code> |
| `find_repo_file` | symbol | 265 | <code>static long find_repo_file(Cg *cg, const char *module, const char *from_path,</code> |
| `NEAR_MAX` | symbol | 456 | <code>#define NEAR_MAX 32</code> |
| `NearManifest` | symbol | 457 | <code>typedef struct { char dir[1024]; Manifest m; bool exists; } NearManifest;</code> |
| `near_manifest_has` | symbol | 459 | <code>static bool near_manifest_has(Cg *cg, NearManifest *near, int *nnear,</code> |
| `node_core_module` | symbol | 485 | <code>static bool node_core_module(const char *module) {</code> |
| `mod_matches` | symbol | 506 | <code>static bool mod_matches(const char *module, const char *cand_path);</code> |
| `resolve_imports_run` | symbol | 517 | <code>static void resolve_imports_run(Cg *cg, bool scoped) {</code> |
| `resolve_imports` | symbol | 667 | <code>void resolve_imports(Cg *cg)        { resolve_imports_run(cg, false); }</code> |
| `resolve_imports_scoped` | symbol | 668 | <code>void resolve_imports_scoped(Cg *cg) { resolve_imports_run(cg, true); }</code> |
| `in_list` | symbol | 857 | <code>static bool in_list(const char *const *list, const char *name) {</code> |
| `in_names` | symbol | 865 | <code>static bool in_names(const char *names, const char *name) {</code> |
| `C_HDR_MAX` | symbol | 886 | <code>#define C_HDR_MAX 64</code> |
| `C_HDR_LEN` | symbol | 887 | <code>#define C_HDR_LEN 48</code> |
| `c_load_headers` | symbol | 894 | <code>static void c_load_headers(Cg *cg, long file_id) {</code> |
| `c_builtin` | symbol | 917 | <code>static bool c_builtin(Cg *cg, long file_id, const char *name) {</code> |
| `c_builtin_reset` | symbol | 929 | <code>static void c_builtin_reset(void) { c_hdrs.file_id = -1; c_hdrs.n = 0; }</code> |
| `is_resolving_lang` | symbol | 932 | <code>static bool is_resolving_lang(const char *lang) {</code> |
| `is_builtin` | symbol | 939 | <code>static bool is_builtin(Cg *cg, const char *lang, long file_id,</code> |
| `Cand` | symbol | 957 | <code>typedef struct {</code> |
| `find_candidates` | symbol | 962 | <code>static int find_candidates(Cg *cg, const char *name, Cand *out, int cap) {</code> |
| `path_stem` | symbol | 985 | <code>static size_t path_stem(const char *path, const char **out) {</code> |
| `cand_definition` | symbol | 999 | <code>static int cand_definition(const Cand *c, int nc, int pick) {</code> |
| `mod_matches` | symbol | 1027 | <code>static bool mod_matches(const char *module, const char *cand_path) {</code> |
| `ImpCache` | symbol | 1064 | <code>typedef struct { char name[128]; char module[256]; } ImpCache;</code> |
| `load_imports` | symbol | 1066 | <code>static int load_imports(Cg *cg, long file_id, ImpCache *out, int cap) {</code> |
| `resolve_refs_run` | symbol | 1089 | <code>static void resolve_refs_run(Cg *cg, bool scoped) {</code> |
| `resolve_refs` | symbol | 1277 | <code>void resolve_refs(Cg *cg)        { resolve_refs_run(cg, false); }</code> |
| `resolve_refs_scoped` | symbol | 1278 | <code>void resolve_refs_scoped(Cg *cg) { resolve_refs_run(cg, true); }</code> |
| `edit_distance` | symbol | 1283 | <code>static int edit_distance(const char *a, const char *b) {</code> |
| `near_miss` | symbol | 1301 | <code>static bool near_miss(Cg *cg, const char *name, char *out, size_t cap) {</code> |
| `file_calibrated` | symbol | 1327 | <code>bool file_calibrated(Cg *cg, long file_id, const char *lang) {</code> |
| `ground_findings` | symbol | 1387 | <code>int ground_findings(Cg *cg, const char *path, GroundFinding **out) {</code> |
| `ground_findings_free` | symbol | 1472 | <code>void ground_findings_free(GroundFinding *v, int n) {</code> |
| `kind_callable` | symbol | 1480 | <code>static bool kind_callable(const char *kind) {</code> |
| `contract_findings` | symbol | 1487 | <code>int contract_findings(Cg *cg, const char *path, ContractFinding **out) {</code> |
| `contract_findings_free` | symbol | 1557 | <code>void contract_findings_free(ContractFinding *v, int n) {</code> |
| `is_entrypoint` | symbol | 1565 | <code>bool is_entrypoint(Cg *cg, long sym_id, const char *name, const char *kind,</code> |
| `hygiene_file` | symbol | 1614 | <code>static int hygiene_file(Cg *cg, const char *path, long file_id,</code> |
| `hygiene_findings` | symbol | 1680 | <code>int hygiene_findings(Cg *cg, const char *path, HygieneFinding **out) {</code> |
| `hygiene_findings_all` | symbol | 1698 | <code>int hygiene_findings_all(Cg *cg, HygieneFinding **out, int limit) {</code> |
| `hygiene_findings_free` | symbol | 1714 | <code>void hygiene_findings_free(HygieneFinding *v, int n) {</code> |

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
| `runtime_workspace_revision` | symbol | 338 | <code>void runtime_workspace_revision(Cg *cg, char out[65]) {</code> |
| `runtime_event_ingest` | symbol | 406 | <code>int runtime_event_ingest(Cg *cg, const char *source, const char *payload,</code> |
| `runtime_event_history` | symbol | 565 | <code>static int runtime_event_history(Cg *cg, int limit, bool json) {</code> |
| `runtime_contains_ci` | symbol | 629 | <code>static bool runtime_contains_ci(const char *s, const char *needle) {</code> |
| `runtime_sample_failure` | symbol | 642 | <code>static bool runtime_sample_failure(const RuntimeSample *s) {</code> |
| `runtime_sample_waiting` | symbol | 661 | <code>static bool runtime_sample_waiting(const RuntimeSample *s) {</code> |
| `runtime_threshold` | symbol | 673 | <code>static int runtime_threshold(const char *name, int dflt, int floor) {</code> |
| `runtime_classify_progress` | symbol | 683 | <code>int runtime_classify_progress(Cg *cg, const char *attempt,</code> |
| `runtime_progress_fields` | symbol | 837 | <code>static void runtime_progress_fields(StrBuf *b, const RuntimeProgress *p) {</code> |
| `runtime_progress` | symbol | 856 | <code>int runtime_progress(Cg *cg, bool json) {</code> |
| `cmd_event` | symbol | 928 | <code>int cmd_event(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/scan.c

[Open source](../src/scan.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `MAX_FILE_BYTES` | symbol | 13 | <code>#define MAX_FILE_BYTES (8L * 1024 * 1024)   /* larger files: skip entirely */</code> |
| `MAX_FTS_BYTES` | symbol | 14 | <code>#define MAX_FTS_BYTES  (2L * 1024 * 1024)   /* larger: no body full-text */</code> |
| `RING_CAP` | symbol | 15 | <code>#define RING_CAP 256</code> |
| `INDEX_CHUNK` | symbol | 20 | <code>#define INDEX_CHUNK 96</code> |
| `Walked` | symbol | 25 | <code>typedef struct {</code> |
| `DbFile` | symbol | 29 | <code>typedef struct { char *path; long id, size, mtime; char hash[65]; } DbFile;</code> |
| `Done` | symbol | 31 | <code>typedef struct {</code> |
| `WalkList` | symbol | 44 | <code>typedef struct { Walked *v; int n, cap; } WalkList;</code> |
| `walk_push` | symbol | 46 | <code>static void walk_push(WalkList *wl, const char *rel, long size, long mtime) {</code> |
| `walk_dir` | symbol | 61 | <code>static void walk_dir(const char *root, const char *rel, const Ignore *ig,</code> |
| `walked_cmp` | symbol | 88 | <code>static int walked_cmp(const void *a, const void *b) {</code> |
| `dbfile_cmp` | symbol | 91 | <code>static int dbfile_cmp(const void *a, const void *b) {</code> |
| `Pipe` | symbol | 97 | <code>typedef struct {</code> |
| `ring_push` | symbol | 110 | <code>static void ring_push(Pipe *p, Done *d) {</code> |
| `producer_done` | symbol | 121 | <code>static void producer_done(Pipe *p) {</code> |
| `ring_pop` | symbol | 128 | <code>static bool ring_pop(Pipe *p, Done *out) {</code> |
| `worker` | symbol | 144 | <code>static void *worker(void *arg) {</code> |
| `Stmts` | symbol | 194 | <code>typedef struct {</code> |
| `stmts_init` | symbol | 209 | <code>static void stmts_init(Cg *cg, Stmts *s) {</code> |
| `step_reset` | symbol | 302 | <code>static void step_reset(sqlite3_stmt *st);</code> |
| `scope_record_file` | symbol | 308 | <code>static void scope_record_file(Stmts *s, long file_id, bool added) {</code> |
| `scope_name` | symbol | 328 | <code>static void scope_name(Stmts *s, const char *name) {</code> |
| `stmts_fin` | symbol | 334 | <code>static void stmts_fin(Stmts *s) {</code> |
| `step_reset` | symbol | 340 | <code>static void step_reset(sqlite3_stmt *st) {</code> |
| `purge_file_children` | symbol | 346 | <code>static void purge_file_children(Stmts *s, long file_id) {</code> |
| `index_copy_rows` | symbol | 361 | <code>static void index_copy_rows(Cg *cg, Stmts *s, long file_id, long from,</code> |
| `write_done` | symbol | 382 | <code>static void write_done(Cg *cg, Stmts *s, const Walked *w, Done *d,</code> |
| `soft_insert` | symbol | 631 | <code>static void soft_insert(sqlite3_stmt *ins, long file_id, int line,</code> |
| `probe` | symbol | 647 | <code>static bool probe(sqlite3_stmt *st, const char *tok, char *out, size_t cap) {</code> |
| `index_scope_begin` | symbol | 660 | <code>void index_scope_begin(Cg *cg) {</code> |
| `index_scope_end` | symbol | 670 | <code>void index_scope_end(Cg *cg) {</code> |
| `count_sql` | symbol | 675 | <code>static long count_sql(Cg *cg, const char *sql) {</code> |
| `index_scope_bounded` | symbol | 682 | <code>bool index_scope_bounded(Cg *cg) {</code> |
| `scope_anchor_files` | symbol | 695 | <code>static void scope_anchor_files(Cg *cg) {</code> |
| `SOFT_FROM` | symbol | 750 | <code>#define SOFT_FROM "CASE WHEN s.decl=1 THEN NULL ELSE c.sym_id END"</code> |
| `anchor_edges_run` | symbol | 752 | <code>static void anchor_edges_run(Cg *cg, IndexStats *st, bool scoped) {</code> |
| `anchor_edges` | symbol | 847 | <code>static void anchor_edges(Cg *cg, IndexStats *st) {</code> |
| `anchor_edges_scoped` | symbol | 851 | <code>static void anchor_edges_scoped(Cg *cg, IndexStats *st) {</code> |
| `flush_chunk` | symbol | 858 | <code>static int flush_chunk(Cg *cg, Stmts *s, Walked *jobs, Done *chunk, int n,</code> |
| `target_rel` | symbol | 875 | <code>static bool target_rel(const char *root, const char *in, char *out, size_t cap) {</code> |
| `targets_cover` | symbol | 894 | <code>static bool targets_cover(char **t, int nt, const char *path) {</code> |
| `walk_targets` | symbol | 907 | <code>static void walk_targets(const char *root, const Ignore *ig, char **t, int nt,</code> |
| `note_targets` | symbol | 935 | <code>static int note_targets(const char *root, const char *note, char ***out,</code> |
| `targets_free` | symbol | 960 | <code>static void targets_free(char **t, int n) {</code> |
| `index_find_twins` | symbol | 971 | <code>static void index_find_twins(Cg *cg, WalkList *jobs, const IndexOpts *o) {</code> |
| `index_pass` | symbol | 1001 | <code>static int index_pass(Cg *cg, const SysInfo *si, const IndexOpts *o,</code> |
| `index_is_fresh` | symbol | 1163 | <code>static bool index_is_fresh(Cg *cg, long max_age_ms) {</code> |
| `index_report` | symbol | 1181 | <code>static void index_report(const IndexStats *st, const IndexOpts *o) {</code> |
| `cg_index_ex` | symbol | 1207 | <code>int cg_index_ex(Cg *cg, const SysInfo *si, const IndexOpts *o, IndexStats *st) {</code> |
| `cg_index` | symbol | 1381 | <code>int cg_index(Cg *cg, const SysInfo *si, bool full, IndexStats *st, bool quiet) {</code> |

## src/sha256.c

[Open source](../src/sha256.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ROR` | symbol | 25 | <code>#define ROR(x,n) (((x) &gt;&gt; (n)) &#124; ((x) &lt;&lt; (32 - (n))))</code> |
| `sha_block` | symbol | 27 | <code>static void sha_block(Sha256 *s, const uint8_t *p) {</code> |
| `sha256_hex` | symbol | 52 | <code>void sha256_hex(const void *data, size_t len, char out_hex[65]) {</code> |

## src/skills.c

[Open source](../src/skills.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SKILL_MARKER` | symbol | 23 | <code>#define SKILL_MARKER "codify-owned: memory-skill v1"</code> |
| `SKILL_SLUG_MAX` | symbol | 24 | <code>#define SKILL_SLUG_MAX 48</code> |
| `SkillFile` | symbol | 27 | <code>typedef struct { char rel[1200]; char slug[80]; long id; } SkillFile;</code> |
| `skill_title` | symbol | 30 | <code>static void skill_title(const Memory *m, char *out, size_t cap) {</code> |
| `skill_slug` | symbol | 45 | <code>static void skill_slug(const Memory *m, char *out, size_t cap) {</code> |
| `yaml_str` | symbol | 63 | <code>static void yaml_str(StrBuf *b, const char *s, size_t max) {</code> |
| `skill_memory_of` | symbol | 74 | <code>static long skill_memory_of(const char *body) {</code> |
| `skill_body` | symbol | 84 | <code>static char *skill_body(const Memory *m) {</code> |
| `skill_render` | symbol | 140 | <code>int skill_render(Cg *cg, const Memory *m, char *path_out, size_t cap) {</code> |
| `skill_scan` | symbol | 183 | <code>static int skill_scan(Cg *cg, SkillFile **out) {</code> |
| `skill_current` | symbol | 222 | <code>static bool skill_current(Cg *cg, const SkillFile *f, const Memory *m) {</code> |
| `skill_findings` | symbol | 233 | <code>int skill_findings(Cg *cg, char ***out) {</code> |
| `skill_candidates` | symbol | 266 | <code>static int skill_candidates(Cg *cg, Memory **out) {</code> |
| `skill_path_for` | symbol | 283 | <code>static const char *skill_path_for(const SkillFile *v, int n, long id) {</code> |
| `skill_row_json` | symbol | 288 | <code>static void skill_row_json(StrBuf *b, const Memory *m, const char *path,</code> |
| `skills_list` | symbol | 308 | <code>static int skills_list(Cg *cg, bool json) {</code> |
| `skills_promote` | symbol | 381 | <code>static int skills_promote(Cg *cg, const char *idstr, bool json) {</code> |
| `skills_render_all` | symbol | 432 | <code>static int skills_render_all(Cg *cg, bool json) {</code> |
| `cmd_skills` | symbol | 491 | <code>int cmd_skills(Cg *cg, int argc, char **argv, bool json) {</code> |

## src/spec.c

[Open source](../src/spec.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `SPEC_BANNER_DFLT` | symbol | 27 | <code>#define SPEC_BANNER_DFLT "GENERATED by %s/specgen — DO NOT EDIT."</code> |
| `S` | symbol | 32 | <code>static char *S(const Kvx *k, const char *sec, const char *key) {</code> |
| `raw_is_list` | symbol | 37 | <code>static bool raw_is_list(const Kvx *k, const char *sec, const char *key) {</code> |
| `sb_humanize` | symbol | 45 | <code>static void sb_humanize(StrBuf *b, const char *k) {</code> |
| `count_dots` | symbol | 62 | <code>static int count_dots(const char *s) {</code> |
| `checkbox` | symbol | 68 | <code>static const char *checkbox(const char *status) {</code> |
| `uint_or` | symbol | 75 | <code>static unsigned long uint_or(const Kvx *k, const char *sec, const char *key,</code> |
| `FOR_KV` | symbol | 87 | <code>#define FOR_KV(k, secname, prefix, idx) \</code> |
| `entry_val` | symbol | 92 | <code>static char *entry_val(const Kvx *k, int i) {           /* interpolated */</code> |
| `spec_find_root` | symbol | 96 | <code>static int spec_find_root(char *out, size_t cap) {</code> |
| `read_include` | symbol | 101 | <code>static char *read_include(const char *fdir, const char *rel) {</code> |
| `Writer` | symbol | 112 | <code>typedef struct {</code> |
| `writer_write` | symbol | 117 | <code>static int writer_write(Writer *w, const char *path, const char *content) {</code> |
| `build_brief` | symbol | 148 | <code>static char *build_brief(const Kvx *wf, const char *specrel) {</code> |
| `adapter_render` | symbol | 210 | <code>static char *adapter_render(const char *label, const char *brief,</code> |
| `render_requirements` | symbol | 232 | <code>static char *render_requirements(const Kvx *f, const char *banner) {</code> |
| `render_design` | symbol | 265 | <code>static char *render_design(const Kvx *f, const char *fdir, const char *banner,</code> |
| `render_wave_graph` | symbol | 319 | <code>static void render_wave_graph(const Kvx *f, char **ids, int nids, StrBuf *b) {</code> |
| `render_tasks` | symbol | 366 | <code>static char *render_tasks(const Kvx *f, const char *fdir, const char *banner,</code> |
| `OutFile` | symbol | 471 | <code>typedef struct { char *path, *content; } OutFile;</code> |
| `outfile_cmp` | symbol | 473 | <code>static int outfile_cmp(const void *a, const void *b) {</code> |
| `strp_cmp` | symbol | 477 | <code>static int strp_cmp(const void *a, const void *b) {</code> |
| `discover_features` | symbol | 481 | <code>static int discover_features(const char *specdir, char ***out) {</code> |
| `render_feature` | symbol | 505 | <code>static int render_feature(const char *root, const char *specdir,</code> |
| `spec_render` | symbol | 560 | <code>static int spec_render(const char *root, bool check, bool quiet) {</code> |
| `spec_render_json` | symbol | 630 | <code>static int spec_render_json(const char *root, bool check) {</code> |
| `Spec` | symbol | 639 | <code>typedef struct {</code> |
| `spec_close` | symbol | 648 | <code>static void spec_close(Spec *s) {</code> |
| `spec_load` | symbol | 656 | <code>static int spec_load(Spec *s, const char *root_ov, const char *feature_ov,</code> |
| `task_sec` | symbol | 701 | <code>static void task_sec(char *buf, size_t cap, const char *id) {</code> |
| `task_exists` | symbol | 705 | <code>static bool task_exists(const Spec *s, const char *id) {</code> |
| `task_status` | symbol | 712 | <code>static char *task_status(const Spec *s, const char *id) {</code> |
| `spec_mode_is` | symbol | 718 | <code>static bool spec_mode_is(const Spec *s, const char *want) {</code> |
| `spec_prod_mode` | symbol | 726 | <code>static bool spec_prod_mode(const Spec *s) {</code> |
| `spec_parallel_mode` | symbol | 732 | <code>static bool spec_parallel_mode(const Spec *s) {</code> |
| `task_is_leaf` | symbol | 736 | <code>static bool task_is_leaf(const Spec *s, const char *id);</code> |
| `spec_docs_mode` | symbol | 741 | <code>static char *spec_docs_mode(const Spec *s) {</code> |
| `spec_all_tasks_qualified` | symbol | 748 | <code>static bool spec_all_tasks_qualified(const Spec *s) {</code> |
| `spec_docs_stage` | symbol | 763 | <code>static char *spec_docs_stage(const Spec *s) {</code> |
| `spec_docs_ready` | symbol | 781 | <code>static bool spec_docs_ready(const Spec *s) {</code> |
| `spec_docs_set_status` | symbol | 788 | <code>static int spec_docs_set_status(Spec *s, const char *status) {</code> |
| `json_docs_task` | symbol | 796 | <code>static void json_docs_task(StrBuf *b, const Spec *s) {</code> |
| `print_docs_task` | symbol | 811 | <code>static void print_docs_task(const Spec *s) {</code> |
| `task_is_leaf` | symbol | 823 | <code>static bool task_is_leaf(const Spec *s, const char *id) {</code> |
| `task_satisfies_requires` | symbol | 830 | <code>static bool task_satisfies_requires(const Spec *s, const char *id) {</code> |
| `task_unmet` | symbol | 839 | <code>static int task_unmet(const Spec *s, const char *id, char **unmet, int cap) {</code> |
| `task_eligible` | symbol | 855 | <code>static bool task_eligible(const Spec *s, const char *id) {</code> |
| `spec_next_id` | symbol | 869 | <code>static const char *spec_next_id(const Spec *s) {</code> |
| `clause_text` | symbol | 883 | <code>static char *clause_text(const Spec *s, const char *clause) {</code> |
| `print_task` | symbol | 902 | <code>static void print_task(const Spec *s, const char *id) {</code> |
| `json_task` | symbol | 960 | <code>static void json_task(const Spec *s, const char *id, StrBuf *b) {</code> |
| `spec_current` | symbol | 1028 | <code>static const char *spec_current(const Spec *s) {</code> |
| `spec_in_progress_count` | symbol | 1038 | <code>static int spec_in_progress_count(const Spec *s) {</code> |
| `spec_attempt_sweep` | symbol | 1055 | <code>static void spec_attempt_sweep(Cg *g) {</code> |
| `spec_attempt_next_fence` | symbol | 1069 | <code>static long spec_attempt_next_fence(Cg *g) {</code> |
| `spec_attempt_host` | symbol | 1079 | <code>static const char *spec_attempt_host(const char *host, char buf[256]) {</code> |
| `spec_attempt_session` | symbol | 1090 | <code>static const char *spec_attempt_session(const char *session) {</code> |
| `spec_attempt_begin` | symbol | 1099 | <code>static int spec_attempt_begin(Cg *g, const char *tag, const char *agent,</code> |
| `spec_attempt_set_branch` | symbol | 1145 | <code>int spec_attempt_set_branch(Cg *g, const char *tag, const char *branch,</code> |
| `spec_attempt_heartbeat` | symbol | 1164 | <code>static int spec_attempt_heartbeat(Cg *g, const char *tag, const char *agent,</code> |
| `spec_attempt_finish` | symbol | 1205 | <code>static void spec_attempt_finish(Cg *g, const char *tag, const char *state,</code> |
| `spec_attempt_owned` | symbol | 1217 | <code>static bool spec_attempt_owned(Cg *g, const char *tag, const char *agent,</code> |
| `spec_release_lease` | symbol | 1234 | <code>static void spec_release_lease(Spec *s, const char *id);</code> |
| `spec_require_owner` | symbol | 1239 | <code>static int spec_require_owner(Spec *s, const char *id, const char *agent,</code> |
| `spec_set_status_owned` | symbol | 1272 | <code>static int spec_set_status_owned(Spec *s, const char *id, const char *status,</code> |
| `spec_agent_leased` | symbol | 1317 | <code>static const char *spec_agent_leased(const Spec *s, const char *agent) {</code> |
| `spec_current_for_agent` | symbol | 1348 | <code>static const char *spec_current_for_agent(const Spec *s, const char *agent) {</code> |
| `spec_stale_tasks` | symbol | 1358 | <code>static int spec_stale_tasks(const Spec *s, const char ***out) {</code> |
| `join_list` | symbol | 1397 | <code>static char *join_list(const Kvx *k, const char *sec, const char *key) {</code> |
| `spec_note_outcome` | symbol | 1412 | <code>static void spec_note_outcome(Spec *s, const char *id, const char *body) {</code> |
| `spec_task_memories` | symbol | 1427 | <code>static int spec_task_memories(Spec *s, const char *id, Memory **out) {</code> |
| `spec_print_memories` | symbol | 1456 | <code>static void spec_print_memories(Spec *s, const char *id) {</code> |
| `spec_live_leases` | symbol | 1466 | <code>static int spec_live_leases(const Spec *s, StrBuf *b, bool json);</code> |
| `spec_status_cmd` | symbol | 1468 | <code>static int spec_status_cmd(Spec *s, bool json) {</code> |
| `spec_mode_cmd` | symbol | 1601 | <code>static int spec_mode_cmd(Spec *s, const char *mode, bool json) {</code> |
| `spec_next_cmd` | symbol | 1627 | <code>static int spec_next_cmd(Spec *s, bool json) {</code> |
| `spec_docs_verified` | symbol | 1682 | <code>static bool spec_docs_verified(const Spec *s) {</code> |
| `spec_docs_finish` | symbol | 1693 | <code>int spec_docs_finish(Cg *cg, const char *feature) {</code> |
| `spec_docs_cmd` | symbol | 1704 | <code>static int spec_docs_cmd(Spec *s, const char *action, const char *agent,</code> |
| `spec_globs_overlap` | symbol | 1849 | <code>bool spec_globs_overlap(const char *a, const char *b) {</code> |
| `spec_touches_conflict` | symbol | 1864 | <code>static bool spec_touches_conflict(Spec *s, const char *id, char *other,</code> |
| `spec_live_leases` | symbol | 1946 | <code>static int spec_live_leases(const Spec *s, StrBuf *b, bool json) {</code> |
| `spec_wave_cmd` | symbol | 2017 | <code>static int spec_wave_cmd(Spec *s, bool json) {</code> |
| `spec_lease_upsert` | symbol | 2075 | <code>static int spec_lease_upsert(Cg *g, const char *tag, const char *agent,</code> |
| `spec_release_lease` | symbol | 2103 | <code>static void spec_release_lease(Spec *s, const char *id) {</code> |
| `spec_heartbeat_cmd` | symbol | 2123 | <code>static int spec_heartbeat_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_reconcile_cmd` | symbol | 2194 | <code>static int spec_reconcile_cmd(Spec *s, bool repair, bool json) {</code> |
| `spec_claim_take` | symbol | 2242 | <code>static int spec_claim_take(Cg *g, Spec *s, const char *id, const char *agent,</code> |
| `spec_claim` | symbol | 2313 | <code>int spec_claim(Cg *g, const char *root, const char *feature, const char *id,</code> |
| `spec_claim_cmd` | symbol | 2331 | <code>static int spec_claim_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_ready_cmd` | symbol | 2415 | <code>static int spec_ready_cmd(Spec *s, bool json) {</code> |
| `spec_claim_next_cmd` | symbol | 2515 | <code>static int spec_claim_next_cmd(Spec *s, const char *agent, const char *host,</code> |
| `spec_start_cmd` | symbol | 2691 | <code>static int spec_start_cmd(Spec *s, const char *id, bool force, bool json) {</code> |
| `spec_verify_task` | symbol | 2782 | <code>static int spec_verify_task(Spec *s, const char *id);</code> |
| `spec_implemented_cmd` | symbol | 2784 | <code>static int spec_implemented_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_run_verify` | symbol | 2879 | <code>static int spec_run_verify(const char *root, const char *cmd, char *tail,</code> |
| `spec_done_cmd` | symbol | 2909 | <code>static int spec_done_cmd(Spec *s, const char *id, const char *agent,</code> |
| `spec_graph_open` | symbol | 3087 | <code>static bool spec_graph_open(Cg *g, bool sync) {</code> |
| `graph_symbol_row` | symbol | 3108 | <code>static void graph_symbol_row(sqlite3_stmt *st, char *path, size_t pcap,</code> |
| `path_has_qualifier` | symbol | 3119 | <code>static bool path_has_qualifier(const char *path, const char *segment,</code> |
| `qualified_path_score` | symbol | 3142 | <code>static int qualified_path_score(const char *qualified, const char *path) {</code> |
| `graph_symbol_named` | symbol | 3159 | <code>static int graph_symbol_named(Cg *g, const char *lookup,</code> |
| `graph_symbol` | symbol | 3202 | <code>static int graph_symbol(Cg *g, const char *name, char *path, size_t pcap,</code> |
| `task_tag` | symbol | 3214 | <code>static void task_tag(const Spec *s, const char *id, char *out, size_t cap) {</code> |
| `pattern_hit` | symbol | 3224 | <code>static bool pattern_hit(const char *pat, char **paths, int np) {</code> |
| `spec_verify_task` | symbol | 3244 | <code>static int spec_verify_task(Spec *s, const char *id) {</code> |
| `trace_task` | symbol | 3302 | <code>static void trace_task(Spec *s, Cg *g, bool have_graph, const char *id,</code> |
| `spec_trace_cmd` | symbol | 3435 | <code>static int spec_trace_cmd(Spec *s, const char *id, bool sync, bool json) {</code> |
| `spec_new_cmd` | symbol | 3577 | <code>static int spec_new_cmd(const char *root_ov, const char *feature, bool json) {</code> |
| `list_literal` | symbol | 3649 | <code>static char *list_literal(const char *csv) {</code> |
| `TaskSpec` | symbol | 3674 | <code>typedef struct {</code> |
| `spec_add_cmd` | symbol | 3681 | <code>static int spec_add_cmd(Spec *s, const char *id, const TaskSpec *t,</code> |
| `Lint` | symbol | 3758 | <code>typedef struct { StrBuf b; int errors, warnings; } Lint;</code> |
| `lint_say` | symbol | 3760 | <code>static void lint_say(Lint *l, bool error, const char *id, const char *fmt, ...) {</code> |
| `lint_cycle` | symbol | 3772 | <code>static bool lint_cycle(Spec *s, const char *id, char **stack, int depth,</code> |
| `spec_lint_cmd` | symbol | 3804 | <code>static int spec_lint_cmd(Spec *s, bool json) {</code> |
| `spec_active_touches` | symbol | 3921 | <code>int spec_active_touches(char ***out) {</code> |
| `spec_active_tag` | symbol | 3934 | <code>char *spec_active_tag(void) {</code> |
| `spec_task_tag` | symbol | 3954 | <code>char *spec_task_tag(const char *requested) {</code> |
| `spec_resolve_task` | symbol | 3989 | <code>char *spec_resolve_task(const char *requested, const char *agent) {</code> |
| `spec_load_tag` | symbol | 4025 | <code>static int spec_load_tag(Spec *s, const char *requested, const char **id_out) {</code> |
| `spec_task_packet` | symbol | 4035 | <code>char *spec_task_packet(const char *requested) {</code> |
| `spec_task_memories_tag` | symbol | 4054 | <code>int spec_task_memories_tag(const char *requested, Memory **out) {</code> |
| `cmd_spec` | symbol | 4070 | <code>int cmd_spec(int argc, char **argv, bool json) {</code> |

## src/syncgate.c

[Open source](../src/syncgate.c)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `GATE_POLL_MS` | symbol | 38 | <code>#define GATE_POLL_MS 40</code> |
| `DIRTY_MAX_BYTES` | symbol | 39 | <code>#define DIRTY_MAX_BYTES (256 * 1024)</code> |
| `gate_path` | symbol | 46 | <code>static void gate_path(const Cg *cg, const char *name, char *out, size_t cap) {</code> |
| `sleep_ms` | symbol | 57 | <code>static void sleep_ms(long ms) {</code> |
| `syncgate_acquire` | symbol | 64 | <code>int syncgate_acquire(const Cg *cg, long wait_ms) {</code> |
| `syncgate_release` | symbol | 81 | <code>void syncgate_release(int fd) {</code> |
| `dirty_lock` | symbol | 88 | <code>static int dirty_lock(const Cg *cg) {</code> |
| `syncgate_mark_dirty` | symbol | 98 | <code>void syncgate_mark_dirty(const Cg *cg, const char *const *paths, int npaths) {</code> |
| `syncgate_is_dirty` | symbol | 123 | <code>bool syncgate_is_dirty(const Cg *cg) {</code> |
| `syncgate_take_dirty` | symbol | 134 | <code>char *syncgate_take_dirty(const Cg *cg) {</code> |
| `slot_dir` | symbol | 152 | <code>static int slot_dir(char *out, size_t cap) {</code> |
| `syncgate_slot_count` | symbol | 163 | <code>int syncgate_slot_count(const SysInfo *si) {</code> |
| `syncgate_slot_acquire` | symbol | 171 | <code>int syncgate_slot_acquire(const SysInfo *si) {</code> |
| `syncgate_slot_release` | symbol | 186 | <code>void syncgate_slot_release(int fd) {</code> |
| `syncgate_worker_budget` | symbol | 194 | <code>int syncgate_worker_budget(const SysInfo *si, const IndexOpts *o, int jobs,</code> |
| `syncgate_background_nice` | symbol | 217 | <code>void syncgate_background_nice(void) {</code> |

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
| `xmalloc` | symbol | 24 | <code>void *xmalloc(size_t n) {</code> |
| `xrealloc` | symbol | 29 | <code>void *xrealloc(void *p, size_t n) {</code> |
| `xstrdup` | symbol | 34 | <code>char *xstrdup(const char *s) {</code> |
| `sb_init` | symbol | 41 | <code>void sb_init(StrBuf *b) { b-&gt;p = xmalloc(256); b-&gt;p[0] = 0; b-&gt;len = 0; b-&gt;cap = 256; }</code> |
| `sb_free` | symbol | 42 | <code>void sb_free(StrBuf *b) { free(b-&gt;p); b-&gt;p = NULL; b-&gt;len = b-&gt;cap = 0; }</code> |
| `sb_grow` | symbol | 43 | <code>static void sb_grow(StrBuf *b, size_t need) {</code> |
| `sb_putc` | symbol | 48 | <code>void sb_putc(StrBuf *b, char c) { sb_grow(b, 1); b-&gt;p[b-&gt;len++] = c; b-&gt;p[b-&gt;len] = 0; }</code> |
| `sb_puts` | symbol | 49 | <code>void sb_puts(StrBuf *b, const char *s) {</code> |
| `sb_printf` | symbol | 55 | <code>void sb_printf(StrBuf *b, const char *fmt, ...) {</code> |
| `sb_json_str` | symbol | 68 | <code>void sb_json_str(StrBuf *b, const char *s) {</code> |
| `sb_shquote` | symbol | 87 | <code>void sb_shquote(StrBuf *b, const char *s) {</code> |
| `cg_find_exe` | symbol | 96 | <code>bool cg_find_exe(const char *name, char *out, size_t cap) {</code> |
| `read_entire_file` | symbol | 118 | <code>char *read_entire_file(const char *path, size_t *out_len) {</code> |
| `hash_lines` | symbol | 147 | <code>void hash_lines(const char *data, size_t len, int from, int to,</code> |
| `name_words` | symbol | 164 | <code>void name_words(const char *name, char *out, size_t cap) {</code> |
| `write_entire_file` | symbol | 189 | <code>int write_entire_file(const char *path, const void *data, size_t len) {</code> |
| `mkdirs` | symbol | 213 | <code>int mkdirs(const char *path) {</code> |
| `cg_capture` | symbol | 228 | <code>int cg_capture(char **out, int (*fn)(void *), void *ctx) {</code> |
| `now_ms` | symbol | 253 | <code>long now_ms(void) {</code> |
| `looks_binary` | symbol | 259 | <code>bool looks_binary(const char *data, size_t len) {</code> |
| `path_ext` | symbol | 266 | <code>const char *path_ext(const char *path) {</code> |
| `cg_agent_name` | symbol | 276 | <code>const char *cg_agent_name(const char *flag) {</code> |
| `cg_agent_role` | symbol | 288 | <code>const char *cg_agent_role(const char *flag) {</code> |
| `cg_agent_parent` | symbol | 294 | <code>const char *cg_agent_parent(const char *flag) {</code> |
| `ig_add_flags` | symbol | 315 | <code>static void ig_add_flags(Ignore *ig, const char *pat, bool negate,</code> |
| `ig_add` | symbol | 329 | <code>static void ig_add(Ignore *ig, const char *pat) {</code> |
| `ig_load_file` | symbol | 337 | <code>static void ig_load_file(Ignore *ig, const char *path) {</code> |
| `ig_load_nested` | symbol | 367 | <code>static void ig_load_nested(Ignore *ig, const char *root, const char *reldir) {</code> |
| `ig_walk_gitignores` | symbol | 396 | <code>static void ig_walk_gitignores(Ignore *ig, const char *root,</code> |
| `ignore_load` | symbol | 420 | <code>void ignore_load(Ignore *ig, const char *root) {</code> |
| `pat_match` | symbol | 433 | <code>static bool pat_match(const char *pat, const char *text, bool anchored) {</code> |
| `ig_entry_hits` | symbol | 438 | <code>static bool ig_entry_hits(const IgnorePat *e, const char *rel,</code> |
| `ignore_match` | symbol | 461 | <code>bool ignore_match(const Ignore *ig, const char *rel, bool is_dir) {</code> |
| `ignore_free` | symbol | 486 | <code>void ignore_free(Ignore *ig) {</code> |

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
| `Watch` | symbol | 18 | <code>typedef struct { int wd; char *rel; } Watch;</code> |
| `Watcher` | symbol | 19 | <code>typedef struct {</code> |
| `IN_MASK` | symbol | 27 | <code>#define IN_MASK (IN_CREATE &#124; IN_CLOSE_WRITE &#124; IN_DELETE &#124; IN_MOVED_FROM &#124; \</code> |
| `watch_add_dir` | symbol | 30 | <code>static void watch_add_dir(Watcher *w, const char *rel) {</code> |
| `wd_rel` | symbol | 64 | <code>static const char *wd_rel(Watcher *w, int wd) {</code> |
| `WATCH_MAX_TARGETS` | symbol | 74 | <code>#define WATCH_MAX_TARGETS 256</code> |
| `Pending` | symbol | 75 | <code>typedef struct { char **v; int n; bool whole; } Pending;</code> |
| `pending_add` | symbol | 77 | <code>static void pending_add(Pending *p, const char *rel) {</code> |
| `pending_clear` | symbol | 86 | <code>static void pending_clear(Pending *p) {</code> |
| `watch_drain` | symbol | 96 | <code>static bool watch_drain(Watcher *w, Pending *pend) {</code> |
| `watch_sync` | symbol | 124 | <code>static int watch_sync(Cg *cg, const SysInfo *si, const Pending *p,</code> |
| `watch_auto_off` | symbol | 139 | <code>static bool watch_auto_off(const char *root) {</code> |
| `cmd_watch` | symbol | 147 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
| `FleetWatch` | symbol | 220 | <code>typedef struct {</code> |
| `FLEET_POLL_MS` | symbol | 232 | <code>#define FLEET_POLL_MS 3000</code> |
| `fleet_watch_open` | symbol | 234 | <code>static FleetWatch *fleet_watch_open(const Cg *parent, long id,</code> |
| `fleet_watch_close` | symbol | 259 | <code>static void fleet_watch_close(FleetWatch *f) {</code> |
| `fleet_scan` | symbol | 272 | <code>static void fleet_scan(Cg *cg, FleetWatch ***pv, int *pn) {</code> |
| `watch_fleet` | symbol | 328 | <code>int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
| `watch_fleet` | symbol | 396 | <code>int watch_fleet(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
| `cmd_watch` | symbol | 403 | <code>int cmd_watch(Cg *cg, const SysInfo *si, int debounce_ms) {</code> |
