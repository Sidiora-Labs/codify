# Source reference: VS Code extension

This part of the [source reference](../SOURCE-REFERENCE.md) lists the indexed declarations of the editor extension under `editors/vscode/`: 424 declarations in 11 files at revision `a2a367f9` of the Hyperfide 2.0 development tree (`hyperfide version` 2.0.0-dev, not a release). Method, column meanings and caveats are described in the entry point; source links resolve from this directory and line numbers refer to revision `a2a367f9`.

## editors/vscode/acp.js

[Open source](../../editors/vscode/acp.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `AcpClient` | function | 29 | <code>function AcpClient(opts) {</code> |
| `extensionVersion` | function | 222 | <code>function extensionVersion() {</code> |
| `splitCommand` | function | 227 | <code>function splitCommand(s) {</code> |
| `normalizeCodexAdapterCommand` | function | 241 | <code>function normalizeCodexAdapterCommand(value) {</code> |
| `panels` | variable | 258 | <code>const panels = new Map();    /&#42; task id -&gt; editor-panel session &#42;/</code> |
| `loadCaps` | function | 271 | <code>async function loadCaps() {</code> |
| `config` | function | 282 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `firstLine` | function | 284 | <code>function firstLine(s) {</code> |
| `driverId` | function | 289 | <code>function driverId(v) { return DRIVER_IDS.indexOf(v) &gt;= 0 ? v : 'codex'; }</code> |
| `diffStyle` | function | 293 | <code>function diffStyle() {</code> |
| `adapterCatalog` | function | 301 | <code>function adapterCatalog() {</code> |
| `adapterMap` | function | 313 | <code>function adapterMap() {</code> |
| `adapterCommand` | function | 324 | <code>function adapterCommand(override) {</code> |
| `rememberViewDriver` | function | 342 | <code>function rememberViewDriver(value) {</code> |
| `classifyUserText` | function | 355 | <code>function classifyUserText(raw) {</code> |
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
| `cancelTurn` | function | 570 | <code>function cancelTurn(sess) {</code> |
| `sessionRequest` | function | 578 | <code>function sessionRequest(sess, method, params) {</code> |
| `renderableToolCall` | function | 601 | <code>function renderableToolCall(call) {</code> |
| `sessionUpdate` | function | 627 | <code>function sessionUpdate(sess, params) {</code> |
| `endOfSession` | function | 692 | <code>async function endOfSession(sess, why) {</code> |
| `connectAgent` | function | 729 | <code>async function connectAgent(sess, driverOverride) {</code> |
| `publishConnectedSession` | function | 764 | <code>function publishConnectedSession(sess, res) {</code> |
| `connectSession` | function | 786 | <code>async function connectSession(sess, driverOverride) {</code> |
| `connectFailureHint` | function | 797 | <code>function connectFailureHint(sess, e) {</code> |
| `surfacePost` | function | 806 | <code>function surfacePost(sess, msg) {</code> |
| `openLocation` | function | 812 | <code>async function openLocation(p, line) {</code> |
| `openExternal` | function | 837 | <code>async function openExternal(href) {</code> |
| `CG_CMDS` | object | 846 | <code>const CG_CMDS = {</code> |
| `boardInfo` | function | 881 | <code>async function boardInfo() {</code> |
| `runCgSlash` | function | 889 | <code>async function runCgSlash(sess, cmd, args, send) {</code> |
| `runToolSlash` | function | 916 | <code>async function runToolSlash(sess, name, args, send) {</code> |
| `attachAgent` | function | 937 | <code>async function attachAgent(sess, name) {</code> |
| `agentEventOf` | function | 978 | <code>function agentEventOf(e, agent) {</code> |
| `postAgentEvent` | function | 983 | <code>function postAgentEvent(sess, e) {</code> |
| `detachAgent` | function | 999 | <code>function detachAgent(sess, quiet) {</code> |
| `steerAgent` | function | 1007 | <code>async function steerAgent(sess, agent, text) {</code> |
| `listApprovals` | function | 1015 | <code>async function listApprovals(sess) {</code> |
| `decideApproval` | function | 1023 | <code>async function decideApproval(sess, id, reject, note) {</code> |
| `watchFleetEvents` | function | 1035 | <code>function watchFleetEvents() {</code> |
| `attachTask` | function | 1052 | <code>async function attachTask(sess, id) {</code> |
| `taskLifecycle` | function | 1083 | <code>async function taskLifecycle(sess, verb, send) {</code> |
| `pickTaskId` | function | 1108 | <code>async function pickTaskId(placeHolder) {</code> |
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
| `cmdNewChat` | function | 1896 | <code>async function cmdNewChat() {</code> |
| `registerAcpCommands` | function | 1900 | <code>function registerAcpCommands(ctx) {</code> |
| `register` | function | 1911 | <code>function register(ctx, d) {</code> |

## editors/vscode/agents.js

[Open source](../../editors/vscode/agents.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `sessions` | variable | 23 | <code>const sessions = new Map();  /&#42; key (task id or wave:N) -&gt; {terminal?, execution?, agent, wave?} &#42;/</code> |
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
| `args` | method | 735 | <code>args(name, text) {</code> |
| `typed` | method | 752 | <code>static typed(schema, v) {</code> |
| `approvalCard` | function | 763 | <code>function approvalCard(ev) {</code> |
| `Window` | class | 784 | <code>class Window {</code> |
| `constructor` | method | 785 | <code>constructor(keep, page) {</code> |
| `push` | method | 792 | <code>push(item) {</code> |
| `expand` | method | 805 | <code>expand() {</code> |
| `hiddenCount` | method | 811 | <code>get hiddenCount() { return this.hidden.length; }</code> |
| `size` | method | 812 | <code>get size() { return this.shown.length + this.hidden.length; }</code> |

## editors/vscode/client.js

[Open source](../../editors/vscode/client.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `LspClient` | class | 14 | <code>class LspClient {</code> |
| `constructor` | method | 15 | <code>constructor(bin, cwd, log) {</code> |
| `start` | method | 29 | <code>async start() {</code> |
| `dispose` | method | 72 | <code>dispose() {</code> |
| `onNotification` | method | 82 | <code>onNotification(method, fn) { this.handlers.set(method, fn); }</code> |
| `request` | method | 84 | <code>request(method, params, timeoutMs = 20000) {</code> |
| `notify` | method | 101 | <code>notify(method, params) {</code> |
| `tryRequest` | method | 107 | <code>async tryRequest(method, params, fallback) {</code> |
| `_send` | method | 118 | <code>_send(msg) {</code> |
| `_consume` | method | 130 | <code>_consume(chunk) {</code> |
| `_dispatch` | method | 149 | <code>_dispatch(msg) {</code> |
| `uriOf` | function | 169 | <code>function uriOf(fsPath) {</code> |

## editors/vscode/extension.js

[Open source](../../editors/vscode/extension.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `revalidate` | function | 42 | <code>let revalidate = () =&gt; {};</code> |
| `serveConnected` | function | 55 | <code>function serveConnected() { return !!(serveClient &amp;&amp; serveClient.ready); }</code> |
| `config` | function | 69 | <code>function config() { return vscode.workspace.getConfiguration('codify'); }</code> |
| `binary` | function | 70 | <code>function binary() {</code> |
| `commandAliases` | function | 86 | <code>function commandAliases(name) {</code> |
| `registerCommands` | function | 89 | <code>function registerCommands(ctx, cmds) {</code> |
| `workspaceRoot` | function | 100 | <code>function workspaceRoot() {</code> |
| `cg` | function | 108 | <code>function cg(args) {</code> |
| `cgJson` | function | 124 | <code>async function cgJson(args) {</code> |
| `MemoryProvider` | class | 133 | <code>class MemoryProvider {</code> |
| `constructor` | method | 134 | <code>constructor() {</code> |
| `refresh` | method | 140 | <code>async refresh() {</code> |
| `getTreeItem` | method | 146 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | method | 148 | <code>getChildren() {</code> |
| `updateStatusBar` | function | 170 | <code>function updateStatusBar(model) {</code> |
| `updateScope` | function | 189 | <code>async function updateScope() {</code> |
| `show` | function | 202 | <code>function show(text) {</code> |
| `REPORTS` | variable | 210 | <code>const REPORTS = new Map();</code> |
| `openReport` | function | 213 | <code>async function openReport(name, title, body) {</code> |
| `reportEmitter` | variable | 222 | <code>const reportEmitter = new vscode.EventEmitter();</code> |
| `fence` | function | 224 | <code>function fence(text) {</code> |
| `pickTask` | function | 230 | <code>async function pickTask(statusFilter) {</code> |
| `taskIdFrom` | function | 249 | <code>function taskIdFrom(arg) {</code> |
| `autoSyncOn` | function | 261 | <code>async function autoSyncOn() {</code> |
| `runRefresh` | function | 274 | <code>async function runRefresh() {</code> |
| `scheduleRefresh` | function | 303 | <code>function scheduleRefresh(delayMs) {</code> |
| `afterMutation` | function | 307 | <code>function afterMutation() {</code> |
| `cmdStart` | function | 311 | <code>async function cmdStart(arg) {</code> |
| `cmdImplemented` | function | 323 | <code>async function cmdImplemented(arg) {</code> |
| `cmdDone` | function | 335 | <code>async function cmdDone(arg) {</code> |
| `cmdDocs` | function | 363 | <code>async function cmdDocs(action) {</code> |
| `cmdClaim` | function | 373 | <code>async function cmdClaim(arg) {</code> |
| `cmdRelease` | function | 387 | <code>async function cmdRelease(arg) {</code> |
| `cmdTrace` | function | 395 | <code>async function cmdTrace(arg) {</code> |
| `cmdNext` | function | 402 | <code>async function cmdNext() {</code> |
| `cmdWave` | function | 413 | <code>async function cmdWave() {</code> |
| `cmdRender` | function | 418 | <code>async function cmdRender() {</code> |
| `cmdLint` | function | 424 | <code>async function cmdLint() {</code> |
| `cmdNewFeature` | function | 436 | <code>async function cmdNewFeature() {</code> |
| `cmdAddTask` | function | 453 | <code>async function cmdAddTask() {</code> |
| `cmdBrief` | function | 483 | <code>async function cmdBrief() {</code> |
| `cmdReview` | function | 488 | <code>async function cmdReview() {</code> |
| `cmdCheck` | function | 495 | <code>async function cmdCheck() {</code> |
| `cmdGuard` | function | 504 | <code>async function cmdGuard() {</code> |
| `cmdTestImpact` | function | 510 | <code>async function cmdTestImpact() {</code> |
| `cmdWhy` | function | 522 | <code>async function cmdWhy() {</code> |
| `cmdRemember` | function | 532 | <code>async function cmdRemember() {</code> |
| `cmdForget` | function | 553 | <code>async function cmdForget(arg) {</code> |
| `cmdSnapshot` | function | 563 | <code>async function cmdSnapshot() {</code> |
| `cmdSync` | function | 573 | <code>async function cmdSync() {</code> |
| `cmdHookInstall` | function | 580 | <code>async function cmdHookInstall() {</code> |
| `cmdOpenTask` | function | 585 | <code>async function cmdOpenTask(id) {</code> |
| `cmdActions` | function | 601 | <code>async function cmdActions() {</code> |
| `activate` | function | 635 | <code>async function activate(ctx) {</code> |
| `deactivate` | function | 822 | <code>function deactivate() {</code> |

## editors/vscode/fleet.js

[Open source](../../editors/vscode/fleet.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `relAge` | function | 51 | <code>function relAge(seen, now) {</code> |
| `mergeState` | function | 67 | <code>function mergeState(name, base, reg, exists) {</code> |
| `treeFacts` | function | 112 | <code>function treeFacts(tree) {</code> |
| `parentsFromTree` | function | 168 | <code>function parentsFromTree(tree) {</code> |
| `planShape` | function | 202 | <code>function planShape(plan) {</code> |
| `taskNode` | function | 239 | <code>function taskNode(id, claim, planned) {</code> |
| `fleetTree` | function | 272 | <code>function fleetTree(status, specStatus, branches, opts) {</code> |
| `nativeNode` | function | 579 | <code>function nativeNode(n, depth, ctx, rootTranscript) {</code> |
| `nativeCounts` | function | 624 | <code>function nativeCounts(nodes) {</code> |
| `nativeNodes` | function | 644 | <code>function nativeNodes(native, opts) {</code> |
| `patchSessions` | function | 666 | <code>function patchSessions(sessions, liveNative, now) {</code> |
| `startPlan` | function | 723 | <code>function startPlan(input) {</code> |
| `liveDecorate` | function | 776 | <code>function liveDecorate(model, input) {</code> |
| `byDotted` | function | 821 | <code>function byDotted(a, b) {</code> |
| `ROLE_TITLE` | object | 839 | <code>const ROLE_TITLE = { main: 'Main Gideon', feature: 'Feature Manager',</code> |
| `roleTitle` | function | 844 | <code>function roleTitle(n) {</code> |
| `STATUS_ICON` | object | 853 | <code>const STATUS_ICON = {</code> |
| `short` | function | 860 | <code>function short(s, n) {</code> |
| `withTimeout` | function | 865 | <code>function withTimeout(p, ms, onTimeout) {</code> |
| `projectionNodes` | function | 891 | <code>function projectionNodes(proj, now) {</code> |
| `findingBadge` | function | 922 | <code>function findingBadge(projection, branch) {</code> |
| `FleetView` | class | 927 | <code>class FleetView {</code> |
| `constructor` | method | 928 | <code>constructor(deps) {</code> |
| `refresh` | method | 947 | <code>async refresh(specStatus) {</code> |
| `_done` | method | 996 | <code>_done() {</code> |
| `getTreeItem` | method | 1016 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | method | 1018 | <code>getChildren(el) {</code> |
| `projectionRoot` | method | 1046 | <code>projectionRoot() {</code> |
| `findingItem` | method | 1066 | <code>findingItem(f, i) {</code> |
| `findingBranchItem` | method | 1088 | <code>findingBranchItem(f, b, i) {</code> |
| `nativeModel` | method | 1111 | <code>async nativeModel(status, tree, branches, call) {</code> |
| `patchLive` | method | 1125 | <code>patchLive() {</code> |
| `sessionsRoot` | method | 1134 | <code>sessionsRoot() {</code> |
| `sessionItem` | method | 1158 | <code>sessionItem(n) {</code> |
| `noticeItem` | method | 1212 | <code>noticeItem(label, icon, command) {</code> |
| `nodeItem` | method | 1230 | <code>nodeItem(n) {</code> |
| `approvalItem` | method | 1279 | <code>approvalItem(a) {</code> |
| `agentIcon` | method | 1289 | <code>agentIcon(n) {</code> |
| `agentTooltip` | method | 1299 | <code>agentTooltip(n) {</code> |
| `taskBadges` | method | 1342 | <code>taskBadges(t) {</code> |
| `taskItem` | method | 1352 | <code>taskItem(t, owner) {</code> |
| `prItem` | method | 1384 | <code>prItem(p) {</code> |
| `nodeOf` | method | 1404 | <code>nodeOf(arg) { return arg &amp;&amp; arg.node ? arg.node : null; }</code> |
| `remember` | method | 1409 | <code>remember(feature, pr) {</code> |
| `featureOf` | function | 1423 | <code>function featureOf(node) {</code> |
| `run` | function | 1429 | <code>async function run(args, title) {</code> |
| `parse` | function | 1437 | <code>function parse(r) {</code> |
| `pickTask` | function | 1443 | <code>async function pickTask(placeHolder) {</code> |
| `taskIdOf` | function | 1472 | <code>function taskIdOf(arg) {</code> |
| `cmdRefresh` | function | 1479 | <code>async function cmdRefresh() {</code> |
| `cmdOpenWorktree` | function | 1486 | <code>async function cmdOpenWorktree(arg) {</code> |
| `cmdBegin` | function | 1530 | <code>async function cmdBegin(arg) {</code> |
| `cmdMergeUp` | function | 1550 | <code>async function cmdMergeUp(arg) {</code> |
| `landTarget` | function | 1587 | <code>function landTarget(node, feature) {</code> |
| `cmdLand` | function | 1597 | <code>async function cmdLand(arg) {</code> |
| `prFrom` | function | 1637 | <code>function prFrom(j) {</code> |
| `cmdOpenPr` | function | 1643 | <code>async function cmdOpenPr(arg) {</code> |
| `cmdCheckpoint` | function | 1682 | <code>async function cmdCheckpoint() {</code> |
| `cmdStart` | function | 1722 | <code>async function cmdStart(arg) {</code> |
| `fleetControl` | function | 1765 | <code>async function fleetControl(verb, label) {</code> |
| `cmdStop` | function | 1774 | <code>async function cmdStop() {</code> |
| `cmdOpenTranscript` | function | 1790 | <code>async function cmdOpenTranscript(arg) {</code> |
| `cmdApprove` | function | 1811 | <code>async function cmdApprove(arg) {</code> |
| `sessionNodes` | function | 1838 | <code>function sessionNodes() {</code> |
| `cmdOpenSessionWorktree` | function | 1846 | <code>async function cmdOpenSessionWorktree(arg) {</code> |
| `cmdOpenSessionTranscript` | function | 1866 | <code>async function cmdOpenSessionTranscript(arg) {</code> |
| `register` | function | 1891 | <code>function register(ctx, d) {</code> |
| `visible` | method | 1940 | <code>get visible() { return view.visible; },</code> |

## editors/vscode/kvx.js

[Open source](../../editors/vscode/kvx.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `KVX` | object | 11 | <code>const KVX = { scheme: 'file', language: 'kvx' };</code> |
| `TASK_KEYS` | object | 14 | <code>const TASK_KEYS = {</code> |
| `META_KEYS` | object | 30 | <code>const META_KEYS = {</code> |
| `lineInfo` | function | 38 | <code>function lineInfo(doc, line) {</code> |
| `findSection` | function | 47 | <code>function findSection(doc, name) {</code> |
| `register` | function | 57 | <code>function register(ctx, cgJson, workspaceRoot) {</code> |
| `provideDefinition` | method | 62 | <code>provideDefinition(doc, pos) {</code> |
| `provideCompletionItems` | method | 88 | <code>async provideCompletionItems(doc, pos) {</code> |
| `provideCodeLenses` | method | 138 | <code>provideCodeLenses(doc) {</code> |
| `provideHover` | method | 160 | <code>provideHover(doc, pos) {</code> |
| `provideDocumentSymbols` | method | 176 | <code>provideDocumentSymbols(doc) {</code> |

## editors/vscode/language.js

[Open source](../../editors/vscode/language.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `toRange` | function | 19 | <code>function toRange(r) {</code> |
| `toLocation` | function | 24 | <code>function toLocation(l) {</code> |
| `docParams` | function | 28 | <code>function docParams(doc, pos) {</code> |
| `register` | function | 34 | <code>function register(ctx, client, diagnostics) {</code> |
| `provideDefinition` | method | 39 | <code>async provideDefinition(doc, pos) {</code> |
| `provideReferences` | method | 46 | <code>async provideReferences(doc, pos) {</code> |
| `provideHover` | method | 53 | <code>async provideHover(doc, pos) {</code> |
| `provideDocumentSymbols` | method | 67 | <code>async provideDocumentSymbols(doc) {</code> |
| `provideWorkspaceSymbols` | method | 78 | <code>async provideWorkspaceSymbols(query) {</code> |
| `provideCodeLenses` | method | 88 | <code>async provideCodeLenses(doc) {</code> |

## editors/vscode/memories.js

[Open source](../../editors/vscode/memories.js)

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
| `MemoryBrowser` | class | 165 | <code>class MemoryBrowser {</code> |
| `constructor` | method | 166 | <code>constructor(deps) {</code> |
| `open` | method | 178 | <code>open() {</code> |
| `dispose` | method | 199 | <code>dispose() {</code> |
| `post` | method | 203 | <code>post(msg) {</code> |
| `load` | method | 213 | <code>async load(opts = {}) {</code> |
| `refresh` | method | 249 | <code>async refresh(opts = {}) {</code> |
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
| `promote` | method | 430 | <code>async promote(id) {</code> |
| `openSkill` | method | 456 | <code>async openSkill(id) {</code> |
| `missing` | method | 481 | <code>missing(id) {</code> |
| `reportMissing` | method | 485 | <code>reportMissing(r, label) {</code> |
| `reloadAfterMutation` | method | 501 | <code>async reloadAfterMutation() {</code> |
| `pickMemory` | method | 510 | <code>async pickMemory(placeHolder) {</code> |
| `idFrom` | method | 527 | <code>idFrom(arg) {</code> |
| `promoteFrom` | method | 534 | <code>async promoteFrom(arg) {</code> |
| `supersedeFrom` | method | 541 | <code>async supersedeFrom(arg) {</code> |
| `register` | function | 555 | <code>function register(ctx, deps) {</code> |

## editors/vscode/refresh.js

[Open source](../../editors/vscode/refresh.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `createRefresher` | function | 18 | <code>function createRefresher(work, opts = {}) {</code> |
| `inFlight` | method | 86 | <code>get inFlight() { return running !== null; },</code> |
| `runs` | method | 87 | <code>get runs() { return runs; },</code> |

## editors/vscode/serve.js

[Open source](../../editors/vscode/serve.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `ServeClient` | class | 21 | <code>class ServeClient {</code> |
| `constructor` | method | 22 | <code>constructor(bin, cwd, log) {</code> |
| `on` | method | 40 | <code>on(name, fn) { (this.listeners&#91;name&#93; &#124;&#124; (this.listeners&#91;name&#93; = &#91;&#93;)).push(fn); }</code> |
| `_emit` | method | 41 | <code>_emit(name, arg) { for (const fn of this.listeners&#91;name&#93; &#124;&#124; &#91;&#93;) { try { fn(arg); } catch (e) { this.log(&#96;serve ${name} handler: ${e.message}&#96;); } } }</code> |
| `start` | method | 46 | <code>async start() {</code> |
| `_reconnect` | method | 102 | <code>_reconnect() {</code> |
| `request` | method | 123 | <code>request(method, params, timeoutMs = CALL_TIMEOUT_MS) {</code> |
| `exec` | method | 146 | <code>async exec(args) {</code> |
| `tool` | method | 155 | <code>async tool(name, args) {</code> |
| `tools` | method | 159 | <code>async tools() {</code> |
| `subscribe` | method | 164 | <code>async subscribe(kinds) {</code> |
| `snapshot` | method | 174 | <code>async snapshot(all) {</code> |
| `cancel` | method | 178 | <code>async cancel(reqId) {</code> |
| `_consume` | method | 182 | <code>_consume(chunk) {</code> |
| `_dispatch` | method | 195 | <code>_dispatch(msg) {</code> |
| `_kill` | method | 213 | <code>_kill() {</code> |
| `dispose` | method | 222 | <code>dispose() {</code> |
| `liveModel` | function | 237 | <code>function liveModel() {</code> |
| `splitSubject` | function | 242 | <code>function splitSubject(subject) {</code> |
| `applyEvent` | function | 248 | <code>function applyEvent(model, ev) {</code> |
| `applyNative` | function | 328 | <code>function applyNative(model, ev) {</code> |
| `applySnapshot` | function | 366 | <code>function applySnapshot(model, snap) {</code> |

## editors/vscode/tasks.js

[Open source](../../editors/vscode/tasks.js)

| Indexed name | Kind | Line | Source declaration |
| --- | --- | ---: | --- |
| `panels` | variable | 32 | <code>const panels = new Map();      /&#42; task id -&gt; {panel, webview} detail panels &#42;/</code> |
| `verifyTerms` | variable | 33 | <code>const verifyTerms = new Map(); /&#42; task id -&gt; terminal running its verify_cmd &#42;/</code> |
| `stripComment` | function | 45 | <code>function stripComment(line) {</code> |
| `kvxUnquote` | function | 54 | <code>function kvxUnquote(raw) {</code> |
| `kvxList` | function | 62 | <code>function kvxList(raw) {</code> |
| `parseKvx` | function | 87 | <code>function parseKvx(text) {</code> |
| `readSpec` | function | 116 | <code>function readSpec(text) {</code> |
| `requireMet` | function | 192 | <code>function requireMet(status, mode) {</code> |
| `asSymbols` | function | 197 | <code>function asSymbols(v) {</code> |
| `asTouches` | function | 201 | <code>function asTouches(v) {</code> |
| `mergeTasks` | function | 208 | <code>function mergeTasks(spec, trace, status, plan) {</code> |
| `patchRows` | function | 292 | <code>function patchRows(rows, feature, applied) {</code> |
| `taskFilter` | function | 308 | <code>function taskFilter(rows, filter) {</code> |
| `haystack` | function | 337 | <code>function haystack(r) {</code> |
| `filterLabel` | function | 346 | <code>function filterLabel(filter) {</code> |
| `resumePrompt` | function | 365 | <code>function resumePrompt(row, opts) {</code> |
| `detailHtml` | function | 420 | <code>function detailHtml(nonce) {</code> |
| `detailView` | function | 774 | <code>function detailView(row, spec) {</code> |
| `icon` | function | 831 | <code>function icon(name, color) {</code> |
| `statusIcon` | function | 836 | <code>function statusIcon(row) {</code> |
| `statusWord` | function | 845 | <code>function statusWord(row) {</code> |
| `TaskTreeProvider` | class | 855 | <code>class TaskTreeProvider {</code> |
| `constructor` | method | 856 | <code>constructor(d) {</code> |
| `loadFilter` | method | 866 | <code>loadFilter() {</code> |
| `setFilter` | method | 873 | <code>setFilter(patch) {</code> |
| `describe` | method | 884 | <code>describe() {</code> |
| `visible` | method | 896 | <code>visible() { return taskFilter(this.rows, this.filter); }</code> |
| `refresh` | method | 901 | <code>async refresh() {</code> |
| `applyEvent` | method | 922 | <code>applyEvent(applied) {</code> |
| `readSpecFile` | method | 932 | <code>readSpecFile(rel) {</code> |
| `fleetPlan` | method | 942 | <code>async fleetPlan() {</code> |
| `row` | method | 949 | <code>row(id) { return this.rows.find((r) =&gt; r.id === id); }</code> |
| `owners` | method | 951 | <code>owners() {</code> |
| `waves` | method | 955 | <code>waves() {</code> |
| `getTreeItem` | method | 961 | <code>getTreeItem(el) { return el; }</code> |
| `getChildren` | method | 963 | <code>getChildren(el) {</code> |
| `featureNodes` | method | 972 | <code>featureNodes() {</code> |
| `docsNode` | method | 1015 | <code>docsNode() {</code> |
| `sectionNodes` | method | 1034 | <code>sectionNodes(rows, feature) {</code> |
| `waveNodes` | method | 1055 | <code>waveNodes(rows, parentKey) {</code> |
| `taskNode` | method | 1084 | <code>taskNode(row) {</code> |
| `tooltip` | method | 1104 | <code>tooltip(row) {</code> |
| `groupBy` | function | 1129 | <code>function groupBy(rows, key) {</code> |
| `taskDetail` | function | 1143 | <code>async function taskDetail(arg) {</code> |
| `postTask` | function | 1163 | <code>function postTask(id) {</code> |
| `refreshPanels` | function | 1180 | <code>function refreshPanels() {</code> |
| `panelMessage` | function | 1184 | <code>async function panelMessage(id, msg) {</code> |
| `openSymbol` | function | 1208 | <code>async function openSymbol(msg) {</code> |
| `openPath` | function | 1225 | <code>async function openPath(pattern) {</code> |
| `taskIdFrom` | function | 1244 | <code>function taskIdFrom(arg) {</code> |
| `resolveId` | function | 1253 | <code>async function resolveId(arg, placeHolder, filter) {</code> |
| `cmdFilterStatus` | function | 1270 | <code>async function cmdFilterStatus() {</code> |
| `cmdFilterWave` | function | 1290 | <code>async function cmdFilterWave() {</code> |
| `cmdFilterOwner` | function | 1305 | <code>async function cmdFilterOwner() {</code> |
| `cmdSearch` | function | 1326 | <code>async function cmdSearch() {</code> |
| `cmdClearFilters` | function | 1336 | <code>function cmdClearFilters() {</code> |
| `cmdFilter` | function | 1341 | <code>async function cmdFilter() {</code> |
| `cmdVerify` | function | 1362 | <code>async function cmdVerify(arg) {</code> |
| `cmdOpenBranch` | function | 1386 | <code>async function cmdOpenBranch(arg) {</code> |
| `cmdCopyPrompt` | function | 1425 | <code>async function cmdCopyPrompt(arg) {</code> |
| `register` | function | 1440 | <code>function register(ctx, d) {</code> |
