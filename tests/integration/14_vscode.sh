#!/usr/bin/env bash
# VS Code extension: syntax, manifest coherence, and the LSP client driven
# against the real cg binary. The client is plain Node, so it is testable
# without VS Code — which is most of what could actually break.
. "$(dirname "$0")/../lib.sh"

EXT="$(cd "$(dirname "$0")/../../editors/vscode" && pwd)"

command -v node >/dev/null 2>&1 || { echo "14_vscode skipped (no node)"; exit 0; }

# ---- every source file parses
for f in "$EXT"/*.js; do
    node --check "$f" || fail "syntax error in $f"
done

# ---- agent chat (5.3): the pure chat core, provable without VS Code
# A named section, so it can be run on its own with `14_vscode.sh chat`;
# with no argument the whole file runs, this section included.
SECTION="${1:-}"
if [ -z "$SECTION" ] || [ "$SECTION" = chat ]; then
node - "$EXT" <<'JS'
const path = require('path');
const { AgentPanel, diffRows, stripAnsi } =
    require(path.join(process.argv[2], 'agents.js'));
const check = (cond, what) => { if (!cond) throw new Error(what); };

// a real line diff: the common lines stay put, only the edit moves
const d = diffRows('a\nb\nc\nd\n', 'a\nB\nc\nd\n');
check(d.added === 1 && d.removed === 1, `one line changed, got +${d.added}/-${d.removed}`);
check(d.rows.filter((r) => r.t === 'ctx').length === 3, 'unchanged lines kept as context');
const del = d.rows.find((r) => r.t === 'del');
const add = d.rows.find((r) => r.t === 'add');
check(del.s === 'b' && del.o === 2 && del.n === 0, 'removed row keeps its old line number');
check(add.s === 'B' && add.n === 2 && add.o === 0, 'added row keeps its new line number');

// long unchanged runs collapse instead of flooding the panel
const long = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n') + '\n';
const tail = diffRows(long, long + 'tail\n');
check(tail.rows.some((r) => r.t === 'gap'), 'unchanged runs collapse into a gap');
check(tail.rows.length < 20, `a one-line change draws a small diff, got ${tail.rows.length}`);
check(/\d+ unchanged/.test(tail.rows.find((r) => r.t === 'gap').s),
    'the gap says how much it hides');

// a runaway diff is bounded and says what it cut
const huge = diffRows('x\n'.repeat(5000), 'y\n'.repeat(5000), 50);
check(huge.rows.length === 50 && huge.truncated > 0, 'oversized diffs are cut with a count');
check(diffRows('same\n', 'same\n').rows.every((r) => r.t !== 'add' && r.t !== 'del'),
    'an unchanged file shows no edits');
check(diffRows(null, 'new\n').added === 1, 'a created file is all additions');

// escape sequences never reach the webview
check(stripAnsi('\u001b[1;31mred\u001b[0m') === 'red', 'SGR colours stripped');
check(stripAnsi('\u001b]0;title\u0007done') === 'done', 'OSC title sequences stripped');
check(stripAnsi('plain') === 'plain', 'plain text is untouched');
check(stripAnsi(undefined) === '', 'missing output is empty, not "undefined"');

// the ledger: adapters that report totals and adapters that report deltas
// must both produce a total that only grows
const totals = new AgentPanel(() => {});
totals.beginTurn();
totals.recordUsage({ cost: 0.10, tokens: 1000 });
check(totals.endTurn('end_turn').cost === 0.1, 'first turn costs what was reported');
totals.beginTurn();
totals.recordUsage({ cost: 0.30, tokens: 3000 });
const t2 = totals.endTurn('end_turn');
check(Math.abs(t2.cost - 0.2) < 1e-9, `running totals become per-turn deltas: ${t2.cost}`);
check(t2.sessionCost === 0.3 && t2.turns === 2, 'session total tracks the adapter');
const deltas = new AgentPanel(() => {});
deltas.beginTurn(); deltas.recordUsage({ cost: 0.10 }); deltas.endTurn('end_turn');
deltas.beginTurn(); deltas.recordUsage({ cost: 0.05 });
check(Math.abs(deltas.endTurn('end_turn').sessionCost - 0.15) < 1e-9,
    'per-message costs accumulate into the session total');
check(new AgentPanel(() => {}).retryTarget() === null, 'nothing to retry before a prompt');

console.log('chat core ok');
JS
    if [ "$SECTION" = chat ]; then
        echo "14_vscode chat ok"
        exit 0
    fi
fi

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

echo "14_vscode ok"
