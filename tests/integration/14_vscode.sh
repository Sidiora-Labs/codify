#!/usr/bin/env bash
# VS Code extension: syntax, manifest coherence, and the LSP client driven
# against the real cg binary. The client is plain Node, so it is testable
# without VS Code — which is most of what could actually break.
#   core     — syntax, manifest, refresh scheduler, LSP client
#   memories — (task 5.2) the memory browser panel and its pure filter
# Run one section: 14_vscode.sh memories
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

EXT="$(cd "$(dirname "$0")/../../editors/vscode" && pwd)"

command -v node >/dev/null 2>&1 || { echo "14_vscode skipped (no node)"; exit 0; }

if want core; then

# ---- every source file parses
for f in "$EXT"/*.js; do
    node --check "$f" || fail "syntax error in $f"
done

# ---- the manifest and the code agree about which commands exist
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
// commands are registered from extension.js, agents.js, and acp.js
const src = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'agents.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'acp.js'), 'utf8');

if (pkg.publisher !== 'SidioraLabs' || pkg.name !== 'codify-workflow') {
    throw new Error(`unexpected Marketplace identity: ${pkg.publisher}.${pkg.name}`);
}
const readme = fs.readFileSync(path.join(dir, 'README.md'), 'utf8');
if (!readme.includes('`SidioraLabs.codify-workflow`')) {
    throw new Error('README does not name the Marketplace identity SidioraLabs.codify-workflow');
}
const changelog = fs.readFileSync(path.join(dir, 'CHANGELOG.md'), 'utf8');
if (!changelog.includes(`extension ${pkg.version}`)) {
    throw new Error(`CHANGELOG has no entry for extension ${pkg.version}`);
}
if (!/^\d+\.\d+\.\d+$/.test(pkg.version)) {
    throw new Error(`invalid installed extension version: ${pkg.version}`);
}
const { AcpClient } = require(path.join(dir, 'acp.js'));
const probe = new AcpClient();
probe.start = async () => {};
probe.request = async (method, params) => {
    if (method !== 'initialize' || params.clientInfo.version !== pkg.version)
        throw new Error('ACP handshake does not advertise the installed version');
    return { protocolVersion: 1 };
};
probe.initialize().catch((e) => { console.error(e); process.exitCode = 1; });
if (!/version: extensionVersion\(\)/.test(src)) {
    throw new Error('agent view does not receive the installed extension version');
}
const codexAdapter = pkg.contributes.configuration.properties['codify.acp.codexCommand'];
if (!codexAdapter || codexAdapter.default !==
    'npx -y @agentclientprotocol/codex-acp@1.7.0') {
    throw new Error(`unexpected Codex ACP default: ${codexAdapter && codexAdapter.default}`);
}
if (/zed-industries\/codex-acp/.test(codexAdapter.description || '')) {
    throw new Error('manifest still recommends the legacy Codex ACP adapter');
}

const declared = pkg.contributes.commands.map((c) => c.command);
const registered = [...src.matchAll(/'(codify\.[A-Za-z.]+)':/g)].map((m) => m[1]);

for (const c of declared) {
    if (!registered.includes(c)) throw new Error(`declared but not registered: ${c}`);
}
for (const c of registered) {
    if (!declared.includes(c)) throw new Error(`registered but not declared: ${c}`);
}

// menu entries may only reference declared commands
const menus = Object.values(pkg.contributes.menus).flat();
for (const m of menus) {
    if (!declared.includes(m.command)) {
        throw new Error(`menu references unknown command: ${m.command}`);
    }
}

// views the code registers must exist in the manifest
const views = Object.values(pkg.contributes.views).flat().map((v) => v.id);
for (const v of ['codifyTasks', 'codifyMemories', 'codifyAgentView']) {
    if (!views.includes(v)) throw new Error(`missing view: ${v}`);
}
if (!/registerTreeDataProvider\('codifyMemories'/.test(src)) {
    throw new Error('codifyMemories view is declared but never populated');
}
if (!/registerWebviewViewProvider\(\s*'codifyAgentView'/.test(src)) {
    throw new Error('codifyAgentView is declared but never provided');
}

// the extension must not have grown dependencies: the whole point is that
// `vsce package` needs no npm install
if (pkg.dependencies || pkg.devDependencies) {
    throw new Error('extension must stay dependency-free');
}

// every refresh goes through one scheduler: no watcher on the database the
// extension itself writes, trace answers from the last index, and the
// poll is slow
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
const ag = fs.readFileSync(path.join(dir, 'agents.js'), 'utf8');
if (/graph\.db/.test(ag) || /createFileSystemWatcher\([^)]*graph\.db/.test(ext)) {
    throw new Error('the extension watches graph.db, which its own sync writes');
}
if (!/\['spec', 'trace', '--no-sync'\]/.test(ext)) {
    throw new Error('the board refresh runs spec trace without --no-sync');
}
if (!/\['sync', '--max-age'/.test(ext)) {
    throw new Error('the board refresh does not sync with a freshness window');
}
if (!/function scheduleRefresh\(/.test(ext) || !/async function runRefresh\(/.test(ext)) {
    throw new Error('refresh scheduler entry points missing');
}
const activePoll = /ACTIVE_POLL_MS = (\d+)/.exec(ag);
if (!activePoll || Number(activePoll[1]) < 10000) {
    throw new Error('agent poll is faster than 10 s');
}
console.log('manifest coherent:', declared.length, 'commands');
JS

# ---- the refresh scheduler keeps one chain in flight
node - "$EXT" <<'JS'
const path = require('path');
const { createRefresher } = require(path.join(process.argv[2], 'refresh.js'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
    // a burst debounces into one run
    let runs = 0;
    let r = createRefresher(async () => { runs += 1; await sleep(50); },
        { debounceMs: 30, minGapMs: 100 });
    const burst = [];
    for (let i = 0; i < 10; i++) burst.push(r.schedule());
    await Promise.all(burst);
    if (runs !== 1) throw new Error(`burst ran ${runs} times, expected 1`);

    // a request during a run queues exactly one trailing run
    runs = 0;
    const first = r.schedule(0);
    await sleep(10);
    if (!r.inFlight) throw new Error('urgent request did not start at once');
    const during = [r.schedule(0), r.schedule(), r.schedule(0)];
    await first;
    await Promise.all(during);
    if (runs !== 2) throw new Error(`trailing runs: ${runs}, expected 2`);

    // the floor keeps hinted runs apart; an urgent one ignores it
    const stamps = [];
    r = createRefresher(async () => { stamps.push(Date.now()); },
        { debounceMs: 10, minGapMs: 200 });
    await r.schedule();
    await r.schedule();
    if (stamps[1] - stamps[0] < 180) {
        throw new Error(`floor ignored: ${stamps[1] - stamps[0]}ms apart`);
    }
    await r.schedule(0);
    if (stamps[2] - stamps[1] > 100) {
        throw new Error(`urgent run waited ${stamps[2] - stamps[1]}ms`);
    }

    // a failing refresh never wedges the scheduler
    let n = 0;
    r = createRefresher(async () => { n += 1; if (n === 1) throw new Error('boom'); },
        { debounceMs: 5, minGapMs: 5 });
    await r.schedule(0);
    await r.schedule(0);
    if (n !== 2 || r.inFlight) throw new Error('scheduler wedged after a failure');
    r.dispose();
    console.log('refresh scheduler ok');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

# ---- the LSP client speaks to the real server
cp -r "$FIXTURES/sample" "$TMP/proj"
cd "$TMP/proj"
"$CG" init >/dev/null

node - "$EXT" "$CG" "$TMP/proj" <<'JS'
const path = require('path');
const { LspClient } = require(path.join(process.argv[2], 'client.js'));
const [, , , bin, root] = process.argv;

(async () => {
    const logs = [];
    const c = new LspClient(bin, root, (m) => logs.push(m));
    const ok = await c.start();
    if (!ok) throw new Error('client failed to start: ' + logs.join('; '));

    const uri = 'file://' + root + '/src/util.ts';
    const src = require('fs').readFileSync(root + '/src/util.ts', 'utf8')
        .split('\n');
    const line = src.findIndex((l) => l.includes('formatName'));
    const character = src[line].indexOf('formatName') + 2;
    const at = { textDocument: { uri }, position: { line, character } };

    const defs = await c.request('textDocument/definition', at);
    if (!defs || !defs.length) throw new Error('no definition');
    if (!defs[0].uri.endsWith('src/util.ts')) {
        throw new Error('definition uri: ' + defs[0].uri);
    }
    if (defs[0].range.start.line !== line) {
        throw new Error(`definition line ${defs[0].range.start.line} != ${line}`);
    }

    const refs = await c.request('textDocument/references', at);
    if (!refs || !refs.length) throw new Error('no references');

    const hover = await c.request('textDocument/hover', at);
    if (!hover || !/formatName/.test(hover.contents.value)) {
        throw new Error('hover: ' + JSON.stringify(hover));
    }

    const syms = await c.request('workspace/symbol', { query: 'formatName' });
    if (!syms.some((s) => s.name === 'formatName')) {
        throw new Error('workspace symbols: ' + JSON.stringify(syms));
    }

    const lenses = await c.request('textDocument/codeLens',
        { textDocument: { uri } });
    if (!lenses.length) throw new Error('no code lenses');

    // diagnostics arrive as a notification after didOpen
    const got = new Promise((resolve) => {
        c.onNotification('textDocument/publishDiagnostics', resolve);
        c.notify('textDocument/didOpen', {
            textDocument: { uri, languageId: 'typescript', version: 1, text: '' },
        });
    });
    const diag = await Promise.race([
        got,
        new Promise((_, r) => setTimeout(() => r(new Error('no diagnostics')), 15000)),
    ]);
    if (diag.uri !== uri) throw new Error('diagnostics uri: ' + diag.uri);

    // an unimplemented method must answer rather than hang
    const none = await c.request('textDocument/formatting',
        { textDocument: { uri } });
    if (none !== null) throw new Error('expected null for unknown method');

    c.dispose();
    console.log('lsp client ok');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

# ---- large payloads survive framing (the buffer must not be split on chars)
node - "$EXT" "$CG" "$TMP/proj" <<'JS'
const path = require('path');
const { LspClient } = require(path.join(process.argv[2], 'client.js'));
const [, , , bin, root] = process.argv;

(async () => {
    const c = new LspClient(bin, root, () => {});
    if (!await c.start()) throw new Error('client failed to start');
    // an empty query returns every symbol in one large frame
    const all = await c.request('workspace/symbol', { query: '' });
    if (!Array.isArray(all) || all.length < 3) {
        throw new Error('expected many symbols, got ' + JSON.stringify(all).slice(0, 200));
    }
    for (const s of all) {
        if (!s.location || !s.location.uri) throw new Error('malformed symbol');
    }
    c.dispose();
    console.log('lsp framing ok (' + all.length + ' symbols in one frame)');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

fi   # core

# ---- the memory browser (task 5.2): a CSP-strict webview whose filter is
#      pure enough to drive from node, and whose symbols are in the graph
if want memories; then

node --check "$EXT/memories.js" || fail "syntax error in memories.js"

# the manifest contributes the browser's commands and extension.js registers
# them, so the panel is reachable from the palette and the Memory view
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');
const mem = fs.readFileSync(path.join(dir, 'memories.js'), 'utf8');

const declared = pkg.contributes.commands.map((c) => c.command);
for (const c of ['codify.memories.browse', 'codify.memories.classifyAll',
                 'codify.memories.promote', 'codify.memories.supersede']) {
    if (!declared.includes(c)) throw new Error(`manifest does not contribute ${c}`);
    if (!new RegExp(`'${c.replace(/\./g, '\\.')}':`).test(ext)) {
        throw new Error(`${c} is contributed but never registered`);
    }
}
if (!/memorybrowser\.register\(/.test(ext)) {
    throw new Error('extension.js never registers the memory browser');
}
// one refresh scheduler: the browser rides it and owns no timer or watcher
if (!/await memoryApi\.refresh\(\)/.test(ext)) {
    throw new Error('the memory browser is not refreshed from runRefresh');
}
if (/setInterval|setTimeout|createFileSystemWatcher/.test(mem)) {
    throw new Error('memories.js runs a timer or watcher of its own');
}
if (pkg.dependencies || pkg.devDependencies) {
    throw new Error('extension must stay dependency-free');
}
console.log('memory browser contributed:', declared.filter(
    (c) => c.startsWith('codify.memories.')).length, 'commands');
JS

# the webview is CSP-strict: nonce'd inline style and script, nothing remote,
# no eval, no inline handlers — and the rendered page has no placeholder left
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const file = path.join(dir, 'memorypanel.html');
const html = fs.readFileSync(file, 'utf8');

const meta = /<meta http-equiv="Content-Security-Policy"\s+content="([^"]*)"/.exec(html);
if (!meta) throw new Error('memorypanel.html has no Content-Security-Policy meta tag');
const csp = meta[1];
for (const needle of ["default-src 'none'", "style-src 'nonce-${nonce}'",
                      "script-src 'nonce-${nonce}'"]) {
    if (!csp.includes(needle)) throw new Error(`CSP is missing ${needle}: ${csp}`);
}
if (/unsafe-inline|unsafe-eval/.test(csp)) throw new Error(`CSP is not strict: ${csp}`);
if (/https?:\/\//.test(html)) throw new Error('memorypanel.html loads a remote URL');
if (/\beval\s*\(|new Function\s*\(/.test(html)) throw new Error('memorypanel.html evals');
if (/<[^>]*\son[a-z]+\s*=/i.test(html)) {
    throw new Error('memorypanel.html uses an inline event handler (CSP blocks it)');
}
for (const m of html.matchAll(/<(script|style)\b([^>]*)>/g)) {
    if (!/nonce="\$\{nonce\}"/.test(m[2])) {
        throw new Error(`<${m[1]}> without the nonce placeholder`);
    }
}

// the panel filters with the real memoryFilter, injected rather than copied
const { panelHtml, filterSource } = require(path.join(dir, 'memories.js'));
const page = panelHtml('N0NCE-123');
if (/\$\{[a-zA-Z]+\}/.test(page)) {
    throw new Error('rendered panel still carries a ${} placeholder');
}
if (!page.includes('nonce="N0NCE-123"')) throw new Error('the nonce was not applied');
if (!page.includes(filterSource())) throw new Error('memoryFilter was not injected');

// the inline script is the one JS the syntax sweep cannot see: compile it
const inline = /<script nonce="[^"]*">([\s\S]*?)<\/script>/.exec(page);
if (!inline) throw new Error('rendered panel has no inline script');
new (require('vm').Script)(inline[1], { filename: 'memorypanel.html script' });
console.log('memorypanel CSP ok');
JS

# the filter itself, under plain node against a recall-shaped fixture.
# TZ is pinned because the date range is local-midnight to local-midnight.
cat > "$TMP/memories.json" <<'JSON'
{"count":4,"memories":[
{"id":4,"created":1709640000,"type":"outcome","task":"codify-v10/2.2","branch":"wave/codify-v10/2","class":"noise","confidence":0.31,"body":"verify_cmd failed twice before it passed","source":"spec done"},
{"id":3,"created":1708430400,"type":"fact","task":null,"body":"The graph lives in .codegraph beside the code","source":"manual"},
{"id":2,"created":1706097600,"type":"constraint","body":"No new link-time dependencies: libsqlite3 and libc only","source":"manual"},
{"id":1,"created":1704888000,"type":"decision","task":"codify-v10/5.2","branch":"main","class":"skill","confidence":0.82,"body":"Sessions rotate on login","symbols":"rotateSession,MemoryBrowser","files":"src/auth.ts","source":"manual"}
]}
JSON

TZ=UTC node - "$EXT" "$TMP/memories.json" <<'JS'
const fs = require('fs'), path = require('path'), vm = require('vm');
const [, , dir, fixture] = process.argv;
const { memoryFilter, filterSource, NONE } = require(path.join(dir, 'memories.js'));
const all = JSON.parse(fs.readFileSync(fixture, 'utf8')).memories;

const ids = (v) => v.map((m) => m.id);
function eq(got, want, what) {
    const a = JSON.stringify(ids(got)), b = JSON.stringify(want);
    if (a !== b) throw new Error(`${what}: ${a} != ${b}`);
}

eq(memoryFilter(all, {}), [4, 3, 2, 1], 'no filter keeps recall order');
eq(memoryFilter(all, null), [4, 3, 2, 1], 'a missing filter matches everything');
eq(memoryFilter(null, { text: 'x' }), [], 'no memories is not a crash');

// full text: body, symbols, files, source — case-insensitive, AND of terms
eq(memoryFilter(all, { text: 'login' }), [1], 'body text');
eq(memoryFilter(all, { text: 'ROTATESESSION' }), [1], 'symbol text, any case');
eq(memoryFilter(all, { text: 'src/auth.ts' }), [1], 'file text');
eq(memoryFilter(all, { text: 'spec done' }), [4], 'source text');
eq(memoryFilter(all, { text: 'new link' }), [2], 'every term must hit');
eq(memoryFilter(all, { text: 'login dependencies' }), [], 'terms are an AND');

// the filter bar
eq(memoryFilter(all, { type: 'constraint' }), [2], 'type');
eq(memoryFilter(all, { class: 'skill' }), [1], 'Jev class');
eq(memoryFilter(all, { class: NONE }), [3, 2], 'unclassified');
eq(memoryFilter(all, { task: 'codify-v10/5.2' }), [1], 'task');
eq(memoryFilter(all, { task: NONE }), [3, 2], 'no task, null or absent');
eq(memoryFilter(all, { branch: 'main' }), [1], 'branch');
eq(memoryFilter(all, { branch: NONE }), [3, 2], 'no branch');
eq(memoryFilter(all, { from: '2024-02-01' }), [4, 3], 'from is inclusive');
eq(memoryFilter(all, { to: '2024-01-24' }), [2, 1], 'to is inclusive');
eq(memoryFilter(all, { from: '2024-02-20', to: '2024-02-20' }), [3], 'one day');
eq(memoryFilter(all, { text: 'failed', type: 'outcome', branch: 'wave/codify-v10/2',
    from: '2024-03-01' }), [4], 'every filter at once');
eq(memoryFilter(all, { from: 'nonsense' }), [4, 3, 2, 1], 'a half-typed date filters nothing');

// rows from an older cg carry no class, confidence or branch: they must still
// list, and still disappear only when that field is what is being filtered on
eq(memoryFilter([{ id: 9, created: 1704888000, type: 'fact', body: 'old row' }], {}),
    [9], 'sparse row');
eq(memoryFilter([{ id: 9, created: 1704888000, type: 'fact', body: 'old row' }],
    { class: 'skill' }), [], 'sparse row excluded by a class filter');
if (all.length !== 4) throw new Error('memoryFilter mutated its input');

// the panel's copy is the same function
const ctx = vm.createContext({});
vm.runInContext(filterSource() + '\nthis.f = memoryFilter;', ctx);
eq(ctx.f(all, { text: 'login' }), [1], 'the injected filter agrees');
console.log('memoryFilter ok:', all.length, 'fixture memories');
JS

# ---- the symbols the task declares resolve in the graph
mkdir -p "$TMP/memproj/editors/vscode"
cp "$EXT/memories.js" "$TMP/memproj/editors/vscode/memories.js"
cd "$TMP/memproj"
"$CG" init >/dev/null
"$CG" index >/dev/null
out="$("$CG" symbol MemoryBrowser --json)"
has "$out" '"name":"MemoryBrowser"'
has "$out" '"kind":"class"'
has "$out" 'editors/vscode/memories.js'
out="$("$CG" symbol memoryFilter --json)"
has "$out" '"name":"memoryFilter"'
has "$out" '"kind":"function"'

fi   # memories

echo "14_vscode ok ($section)"
