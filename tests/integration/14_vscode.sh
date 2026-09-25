#!/usr/bin/env bash
# VS Code extension: syntax, manifest coherence, and the plain-Node halves of
# the extension driven against the real cg binary — which is most of what
# could actually break without VS Code in the room.
#   (always)  every file parses, the manifest and the code agree, the refresh
#             scheduler keeps one chain in flight
#   lsp       the language client against a real `cg lsp`
#   fleet     (task 5.3) the fleet view: its manifest surface and the join
#             behind FleetView, from JSON the real cg printed
# Run one section: 14_vscode.sh fleet
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

EXT="$(cd "$(dirname "$0")/../../editors/vscode" && pwd)"

command -v node >/dev/null 2>&1 || { echo "14_vscode skipped (no node)"; exit 0; }

# ---- every source file parses
for f in "$EXT"/*.js; do
    node --check "$f" || fail "syntax error in $f"
done

# ---- the manifest and the code agree about which commands exist
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
// commands are registered from extension.js, agents.js, acp.js, and fleet.js
const src = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'agents.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'acp.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'fleet.js'), 'utf8');

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

if want lsp; then
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
fi

# ---------------- fleet view (task 5.3) ----------------

if want fleet; then
    node --check "$EXT/fleet.js" || fail "syntax error in fleet.js"

    # ---- the manifest carries the view, its commands, its menus, and an
    #      empty state, and the view keeps the refresh contract
    node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const src = fs.readFileSync(path.join(dir, 'fleet.js'), 'utf8');
const ext = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8');

const views = Object.values(pkg.contributes.views).flat().map((v) => v.id);
if (!views.includes('codifyFleet')) throw new Error('missing view: codifyFleet');
if (!/createTreeView\(\s*'codifyFleet'/.test(src)) {
    throw new Error('codifyFleet is declared but never provided');
}
if (!/class FleetView/.test(src)) throw new Error('fleet.js declares no FleetView');

const declared = pkg.contributes.commands.map((c) => c.command);
for (const verb of ['refresh', 'openWorktree', 'begin', 'mergeUp', 'land',
                    'openPr', 'checkpoint']) {
    const c = `codify.fleet.${verb}`;
    if (!declared.includes(c)) throw new Error(`fleet command not declared: ${c}`);
    if (!src.includes(`'${c}':`)) throw new Error(`fleet command not registered: ${c}`);
}
const menus = Object.values(pkg.contributes.menus).flat()
    .filter((m) => /codifyFleet/.test(m.when || ''));
if (menus.length < 8) throw new Error(`fleet view has ${menus.length} menu entries`);
const welcome = (pkg.contributes.viewsWelcome || [])
    .find((w) => w.view === 'codifyFleet');
if (!welcome || !/hierarchy/.test(welcome.contents)) {
    throw new Error('the fleet view has no empty state');
}

// one scheduler: the view is driven from the extension's refresh chain and
// starts no timer or watcher of its own
if (!/fleetApi\.refresh\(/.test(ext)) {
    throw new Error('the fleet view is not hooked into the refresh chain');
}
if (/setInterval\(|createFileSystemWatcher\(/.test(src)) {
    throw new Error('the fleet view starts a timer or watcher of its own');
}
// and a refresh must never run `cg fleet pr`, which opens a pull request
const body = src.slice(src.indexOf('async refresh('), src.indexOf('_done() {'));
if (/'pr'/.test(body)) {
    throw new Error('a fleet refresh runs cg fleet pr, which opens one');
}
if (!/CALL_TIMEOUT_MS/.test(body)) {
    throw new Error('a fleet refresh has no timeout — the view could hang');
}
console.log('fleet manifest ok:', menus.length, 'menu entries');
JS

    # ---- the join, over JSON the real cg printed for a real fleet
    command -v git >/dev/null 2>&1 || fail "fleet section needs git"
    rm -rf "$TMP/fleet"
    mkdir -p "$TMP/fleet/src" "$TMP/fleet/lib" "$TMP/fleet/docs" "$TMP/json"
    cd "$TMP/fleet"
    git init -q -b main . 2>/dev/null || git init -q .
    git config user.email t@t; git config user.name t
    echo 'export function alpha(){}' > src/a.ts
    echo 'export function beta(){}'  > lib/b.ts
    echo '# doc' > docs/d.md
    "$CG" spec new fleet >/dev/null
    "$CG" spec mode parallel >/dev/null
    "$CG" spec add 2.1 --title "Alpha work" --wave 1 --touches 'src/*.ts' >/dev/null
    "$CG" spec add 2.2 --title "Beta work" --wave 1 --touches 'lib/*.ts' >/dev/null
    "$CG" spec add 3.1 --title "Docs work" --wave 2 --touches 'docs/*.md' >/dev/null
    "$CG" init >/dev/null
    printf '\n[hierarchy]\nmain = "main"\n' >> spec/workflow.kvx
    git add -A >/dev/null; git commit -qm base >/dev/null
    "$CG" fleet begin 2.1 >/dev/null
    CG_AGENT=gideon CG_ROLE=main "$CG" fleet status >/dev/null
    CG_AGENT=fm-fleet CG_ROLE=feature CG_PARENT=gideon CG_FEATURE=fleet \
        "$CG" fleet status >/dev/null
    CG_AGENT=gideon CG_ROLE=main "$CG" fleet status --json > "$TMP/json/status.json"
    "$CG" spec status --json > "$TMP/json/spec.json"
    "$CG" branches --json > "$TMP/json/branches.json"
    "$CG" fleet plan --json > "$TMP/json/plan.json"

    node - "$EXT" "$TMP/json" "$(date +%s)" <<'JS'
const path = require('path'), fs = require('fs');
const [, , dir, out, nowArg] = process.argv;
const { fleetTree, relAge, mergeState } = require(path.join(dir, 'fleet.js'));
const now = Number(nowArg);
const j = (n) => JSON.parse(fs.readFileSync(path.join(out, n), 'utf8'));
const eq = (got, want, what) => {
    if (got !== want) throw new Error(`${what}: ${JSON.stringify(got)} != ${JSON.stringify(want)}`);
};

// ---- Main Gideon -> feature manager -> wave workers -> tasks
const t = fleetTree(j('status.json'), j('spec.json'), j('branches.json'),
    { plan: j('plan.json'), now });
eq(t.hierarchy.configured, true, 'hierarchy configured');
eq(t.hierarchy.main, 'main', 'main branch');
eq(t.main.kind, 'main', 'root kind');
eq(t.main.agent, 'gideon', 'root agent');
eq(t.main.branch, 'main', 'root branch');
eq(t.main.live, true, 'root is live');
eq(t.main.children.length, 1, 'managers under main');
const m = t.main.children[0];
eq(m.kind, 'manager', 'manager kind');
eq(m.agent, 'fm-fleet', 'manager agent');
eq(m.feature, 'fleet', 'manager feature');
eq(m.branch, 'feature/fleet', 'manager branch');
eq(m.base, 'main', 'manager base');
eq(m.live, true, 'manager is live');
const waves = m.children.map((w) => w.wave);
if (String(waves) !== '0,1,2') throw new Error('waves: ' + waves);
for (const w of m.children) {
    eq(w.kind, 'worker', 'worker kind');
    eq(w.parent, 'fm-fleet', `${w.agent} reports to the manager`);
    eq(w.branch, `wave/fleet/${w.wave}`, `${w.agent} branch`);
    eq(w.base, 'feature/fleet', `${w.agent} base`);
}
const live = m.children.find((w) => w.wave === 1);
eq(live.agent, 'w-fleet-1', 'wave 1 agent');
eq(live.live, true, 'wave 1 is live');
eq(live.age.stale, false, 'a fresh heartbeat is not stale');
if (!/ago|just now/.test(live.age.text)) throw new Error('age: ' + live.age.text);
if (!live.attempt) throw new Error('wave 1 carries no attempt id');
if (!/wave-fleet-1$/.test(live.worktree || '')) {
    throw new Error('wave 1 worktree: ' + live.worktree);
}
eq(String(live.tasks.map((x) => x.id)), '2.1,2.2', 'wave 1 tasks');
eq(live.tasks[0].live, true, '2.1 is claimed');
if (typeof live.tasks[0].expiresInMin !== 'number') {
    throw new Error('2.1 has no lease left: ' + live.tasks[0].expiresInMin);
}
eq(live.tasks[1].live, false, '2.2 is unclaimed');
const planned = m.children.find((w) => w.wave === 2);
eq(planned.live, false, 'wave 2 has no agent yet');
eq(planned.age.text, 'never seen', 'wave 2 heartbeat');
eq(String(planned.tasks.map((x) => x.id)), '3.1', 'wave 2 tasks');
if (t.counts.live < 3) throw new Error('counts: ' + JSON.stringify(t.counts));

// ---- merge state and stale heartbeats, over heads the registry holds
const synth = fleetTree(
    { hierarchy: { configured: true, enabled: true, main: 'main', remote: 'origin' },
      agents: [
        { agent: 'g', role: 'main', seen: now },
        { agent: 'm1', role: 'feature', feature: 'x', seen: now },
        { agent: 'w1', role: 'worker', feature: 'x', wave: 1, seen: now - 300,
          tasks: ['x/1.1'] },
      ] },
    { feature: 'x', claims: [{ id: '1.1', agent: 'w1', role: 'worker', parent: 'm1',
        branch: 'wave/x/1', worktree: '/gone', attempt_id: 'abc123def456',
        expires_in_min: 12, host: 'h' }] },
    { branches: [
        { name: 'main', head: 'aaa', worktree: '/r' },
        { name: 'feature/x', head: 'bbb', base: 'main', worktree: '/f' },
        { name: 'wave/x/1', head: 'bbb', base: 'feature/x', worktree: '/gone' },
    ] },
    { now, exists: (p) => p !== '/gone' });
const sm = synth.main.children[0];
eq(sm.agent, 'm1', 'synthetic manager');
eq(sm.merge.state, 'unmerged', 'feature/x is not in main');
const sw = sm.children[0];
eq(sw.agent, 'w1', 'synthetic worker');
eq(sw.merge.state, 'in-sync', 'wave/x/1 is already in feature/x');
eq(sw.merge.worktreeMissing, true, 'a removed worktree is visible');
eq(sw.age.stale, true, 'five minutes of silence is stale');
eq(sw.attempt, 'abc123def456', 'attempt id');
eq(sw.tasks[0].expiresInMin, 12, 'lease left');
eq(synth.counts.stale, 1, 'one stale agent');

// ---- heartbeat ages
eq(relAge(now - 5, now).text, 'just now', 'fresh age');
eq(relAge(now - 200, now).stale, true, 'stale age');
eq(relAge(now - 3600, now).text, '60m ago', 'an hour still reads in minutes');
eq(relAge(now - 7200, now).text, '2h ago', 'hour age');
eq(relAge(0, now).text, 'never seen', 'no heartbeat');
eq(mergeState('nope', 'main', new Map()).state, 'absent', 'unknown branch');

// ---- nothing to show, and nothing that throws: no hierarchy, no cg,
//      and a `cg fleet tree` whose shape we do not know
const empty = fleetTree(null, null, null, { now });
eq(empty.hierarchy.configured, false, 'empty hierarchy');
eq(empty.main.children.length, 0, 'empty tree');
fleetTree({ agents: 'nonsense' }, { claims: 7 }, { branches: null }, { now });
const hinted = fleetTree(
    { hierarchy: { configured: true, main: 'main' },
      agents: [{ agent: 'g', role: 'main', seen: now },
               { agent: 'm1', role: 'feature', feature: 'x', seen: now },
               { agent: 'w9', seen: now, tasks: ['x/4.4'] }] },
    { feature: 'x', claims: [{ id: '4.4', agent: 'w9' }] }, null,
    { now, tree: { main: { agent: 'g', children: [
        { agent: 'm1', workers: [{ agent: 'w9' }] }] } } });
eq(hinted.main.children[0].children[0].agent, 'w9', 'tree hint places a worker');
fleetTree({ hierarchy: { configured: true } }, null, null, { now, tree: 'garbage' });
fleetTree({ hierarchy: { configured: true } }, null, null, { now, tree: [{ x: 1 }] });
console.log('fleet join ok');
JS

    # ---- the symbol the task promises resolves in the graph
    rm -rf "$TMP/ext"
    mkdir -p "$TMP/ext"
    cp "$EXT"/*.js "$TMP/ext/"
    cd "$TMP/ext"
    "$CG" init >/dev/null
    "$CG" index >/dev/null
    out="$("$CG" symbol FleetView)"
    has "$out" "class FleetView"
    has "$out" "fleet.js"
fi

echo "14_vscode ok ($section)"
