#!/usr/bin/env bash
# VS Code extension: syntax, manifest coherence, the task UI, the memory
# browser, and the LSP client driven against the real cg binary. Everything
# the extension can be tested on without VS Code — which is most of what
# could actually break. Every source file is syntax-checked on every run.
#   manifest — identity, declared vs registered commands, menus, views, deps
#   refresh  — the one scheduler keeps a single chain in flight
#   tasks    — (task 5.1) task tree, filter, detail panel, indexed symbols
#   lsp      — the hand-written client against the real `cg lsp`
#   memories — (task 5.2) the memory browser panel and its pure filter
# Run one section: 14_vscode.sh tasks
. "$(dirname "$0")/../lib.sh"
section="${1:-all}"

want() { [ "$section" = all ] || [ "$section" = "$1" ]; }

EXT="$(cd "$(dirname "$0")/../../editors/vscode" && pwd)"

command -v node >/dev/null 2>&1 || { echo "14_vscode skipped (no node)"; exit 0; }

# ---- every source file parses
for f in "$EXT"/*.js; do
    node --check "$f" || fail "syntax error in $f"
done

if want manifest; then
# ---- the manifest and the code agree about which commands exist
node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
// commands are registered from extension.js, agents.js, acp.js, and tasks.js
const src = fs.readFileSync(path.join(dir, 'extension.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'agents.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'acp.js'), 'utf8') +
    fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8');

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
const board = ext + fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8');
if (/graph\.db/.test(ag) || /createFileSystemWatcher\([^)]*graph\.db/.test(board)) {
    throw new Error('the extension watches graph.db, which its own sync writes');
}
if (!/\['spec', 'trace', '--no-sync'\]/.test(board)) {
    throw new Error('the board refresh runs spec trace without --no-sync');
}
if (!/\['sync', '--max-age'/.test(ext)) {
    throw new Error('the board refresh does not sync with a freshness window');
}
if (!/function scheduleRefresh\(/.test(ext) || !/async function runRefresh\(/.test(ext)) {
    throw new Error('refresh scheduler entry points missing');
}
// the task views must not start a second clock of their own
if (/setInterval|createFileSystemWatcher/.test(
        fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8'))) {
    throw new Error('tasks.js schedules refreshes outside the one scheduler');
}
const activePoll = /ACTIVE_POLL_MS = (\d+)/.exec(ag);
if (!activePoll || Number(activePoll[1]) < 10000) {
    throw new Error('agent poll is faster than 10 s');
}
console.log('manifest coherent:', declared.length, 'commands');
JS
fi

if want refresh; then
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
fi

if want tasks; then
# ---- the task UI: manifest surface, the pure half under plain node, and the
# three symbols the graph must be able to resolve

node - "$EXT" <<'JS'
const fs = require('fs'), path = require('path');
const dir = process.argv[2];
const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
const declared = pkg.contributes.commands.map((c) => c.command);

// the task view is contributed and owned by tasks.js
const views = Object.values(pkg.contributes.views).flat().map((v) => v.id);
if (!views.includes('codifyTasks')) throw new Error('missing view: codifyTasks');
const tasksSrc = fs.readFileSync(path.join(dir, 'tasks.js'), 'utf8');
if (!/createTreeView\(\s*'codifyTasks'/.test(tasksSrc)) {
    throw new Error('codifyTasks is declared but tasks.js never creates it');
}
if (!/require\('\.\/tasks'\)/.test(fs.readFileSync(path.join(dir, 'extension.js'), 'utf8'))) {
    throw new Error('extension.js does not load tasks.js');
}

// every task-UI command is declared, and the view title and item menus reach
// the filters and the actions
const need = ['codify.tasks.detail', 'codify.tasks.filter',
    'codify.tasks.filterStatus', 'codify.tasks.filterWave',
    'codify.tasks.filterOwner', 'codify.tasks.search',
    'codify.tasks.clearFilters', 'codify.tasks.verify',
    'codify.tasks.openBranch', 'codify.tasks.copyPrompt'];
for (const c of need) {
    if (!declared.includes(c)) throw new Error(`command not contributed: ${c}`);
    if (!new RegExp(`'${c.replace(/\./g, '\\.')}':`).test(tasksSrc)) {
        throw new Error(`command not registered in tasks.js: ${c}`);
    }
}
const title = pkg.contributes.menus['view/title']
    .filter((m) => /codifyTasks/.test(m.when)).map((m) => m.command);
for (const c of ['codify.tasks.filter', 'codify.tasks.filterStatus',
                 'codify.tasks.filterWave', 'codify.tasks.filterOwner',
                 'codify.tasks.search', 'codify.tasks.clearFilters']) {
    if (!title.includes(c)) throw new Error(`filter missing from the view title: ${c}`);
}
const item = pkg.contributes.menus['view/item/context']
    .filter((m) => /codifyTasks/.test(m.when)).map((m) => m.command);
for (const c of ['codify.startTask', 'codify.doneTask', 'codify.claimTask',
                 'codify.releaseTask', 'codify.tasks.openBranch',
                 'codify.tasks.verify', 'codify.tasks.copyPrompt',
                 'codify.tasks.detail']) {
    if (!item.includes(c)) throw new Error(`action missing from the task menu: ${c}`);
}
// the upgrade ships as its own version
if (pkg.version === '1.2.8') throw new Error('extension version was not bumped');
console.log('task manifest ok:', need.length, 'commands');
JS

# the module loads without vscode, exports the three symbols, and its filter
# and grouping logic answer correctly on a fixture
cat > "$TMP/spec.kvx" <<'KVX'
[meta]
feature = "demo"
intro   = "A two-section demo feature."

[req.1]
title = "First requirement"
ac_1  = "WHEN a task renders THE row SHALL name its owner."

[task.1]
title   = "Indexing"
section = "One indexer"
status  = "pending"

[task.1.1]
title      = "Gate"          # done, nobody holds it
status     = "done"
wave       = 1
symbols    = ["gate_open"]
touches    = ["src/gate.c"]
verify_cmd = "make test"
reqs       = ["1.1"]
do_1       = "Take the lock."
do_2       = "Drain the marker."

[task.1.2]
title    = "Callers"
status   = "in_progress"
wave     = 2
requires = ["1.1"]

[task.2]
title   = "Editor"
section = "Editor surface"
status  = "pending"

[task.2.1]
title    = "Tree"
status   = "pending"
wave     = 2
requires = ["1.2"]
KVX

node - "$EXT" "$TMP/spec.kvx" <<'JS'
const fs = require('fs'), path = require('path');
const t = require(path.join(process.argv[2], 'tasks.js'));

for (const name of ['TaskTreeProvider', 'taskFilter', 'taskDetail']) {
    if (typeof t[name] !== 'function') {
        throw new Error(`tasks.js does not export ${name}`);
    }
}

const spec = t.readSpec(fs.readFileSync(process.argv[3], 'utf8'));
if (spec.feature !== 'demo') throw new Error('meta.feature: ' + spec.feature);
if (spec.clauses['1.1'] !== 'WHEN a task renders THE row SHALL name its owner.') {
    throw new Error('ac_1 did not become clause 1.1');
}
const gate = spec.byId.get('1.1');
if (gate.section !== 'One indexer') throw new Error('section not inherited: ' + gate.section);
if (gate.do.length !== 2 || gate.do[0] !== 'Take the lock.') {
    throw new Error('do steps: ' + JSON.stringify(gate.do));
}
if (gate.verify_cmd !== 'make test') throw new Error('verify_cmd: ' + gate.verify_cmd);
if (!spec.byId.get('1').group) throw new Error('a task without a wave is a heading');

// live state: trace carries the graph evidence, status the claims
const trace = { feature: 'demo', graph: true, tasks: [
    { id: '1.1', title: 'Gate', status: 'done', wave: 1,
      symbols: [{ name: 'gate_open', found: true, path: 'src/gate.c', line: 4,
                  kind: 'function', refs: 2 }],
      touches: [{ pattern: 'src/gate.c', changed: true }],
      commits: [{ id: 'abc123def456789', date: 1, message: 'gate' }],
      memories: [{ id: 1, type: 'decision', body: 'one writer', created: 1 }] },
    { id: '1.2', title: 'Callers', status: 'in_progress', wave: 2,
      symbols: [], touches: [], commits: [], memories: [] },
    { id: '2.1', title: 'Tree', status: 'pending', wave: 2,
      symbols: [], touches: [], commits: [], memories: [] },
]};
const status = { feature: 'demo', spec: 'spec/demo/spec.kvx', mode: 'parallel',
    tasks: 3, done: 1, next: { id: '2.1' }, claims: [
        { id: '1.2', agent: 'w-demo-2', role: 'worker', parent: 'fm-demo',
          branch: 'wave/demo/2', worktree: '/tmp/wt/demo-2',
          attempt_id: 'ff00ff00ff00', expires_in_min: 21 },
    ]};
const plan = { waves: [{ wave: 1, branch: 'wave/demo/1' },
                       { wave: 2, branch: 'wave/demo/2' }] };

const rows = t.mergeTasks(spec, trace, status, plan);
if (rows.length !== 3) throw new Error('rows: ' + rows.length);
const byId = new Map(rows.map((r) => [r.id, r]));
if (byId.get('1.1').section !== 'One indexer' ||
    byId.get('2.1').section !== 'Editor surface') {
    throw new Error('sections did not survive the merge');
}
if (byId.get('1.2').agent !== 'w-demo-2' || byId.get('1.2').role !== 'worker' ||
    byId.get('1.2').branch !== 'wave/demo/2' ||
    byId.get('1.2').worktree !== '/tmp/wt/demo-2') {
    throw new Error('claim owner/branch/worktree not merged onto the row');
}
if (byId.get('2.1').waveBranch !== 'wave/demo/2') {
    throw new Error('wave branch from the fleet plan is missing');
}
// 2.1 requires 1.2, which is in_progress: blocked. 1.2 requires 1.1 (done).
if (byId.get('2.1').blockers.length !== 1 ||
    byId.get('2.1').blockers[0].id !== '1.2') {
    throw new Error('blockers: ' + JSON.stringify(byId.get('2.1').blockers));
}
if (byId.get('1.2').blockers.length !== 0) {
    throw new Error('a done require must not block');
}

const ids = (f) => t.taskFilter(rows, f).map((r) => r.id).join(',');
if (ids({}) !== '1.1,1.2,2.1') throw new Error('unfiltered: ' + ids({}));
if (ids({ status: 'done' }) !== '1.1') throw new Error('status: ' + ids({ status: 'done' }));
if (ids({ status: 'open' }) !== '1.2,2.1') throw new Error('open: ' + ids({ status: 'open' }));
if (ids({ status: 'blocked' }) !== '2.1') throw new Error('blocked: ' + ids({ status: 'blocked' }));
if (ids({ wave: 2 }) !== '1.2,2.1') throw new Error('wave: ' + ids({ wave: 2 }));
if (ids({ wave: '1' }) !== '1.1') throw new Error('wave as string: ' + ids({ wave: '1' }));
if (ids({ owner: 'w-demo-2' }) !== '1.2') throw new Error('owner: ' + ids({ owner: 'w-demo-2' }));
if (ids({ owner: 'unclaimed' }) !== '1.1,2.1') throw new Error('unclaimed: ' + ids({ owner: 'unclaimed' }));
if (ids({ text: 'gate_open' }) !== '1.1') throw new Error('symbol search: ' + ids({ text: 'gate_open' }));
if (ids({ text: 'src/gate.c' }) !== '1.1') throw new Error('path search: ' + ids({ text: 'src/gate.c' }));
if (ids({ text: 'EDITOR' }) !== '2.1') throw new Error('section search is case-insensitive');
if (ids({ status: 'done', wave: 2 }) !== '') throw new Error('filters must combine');
if (ids({ status: 'nonsense' }) !== '') throw new Error('an unknown status matches nothing');
if (t.filterLabel({ status: 'pending', wave: 2, owner: 'w-demo-2', text: 'x' })
    !== 'pending · wave 2 · w-demo-2 · "x"') {
    throw new Error('filter label: ' + t.filterLabel({ status: 'pending' }));
}
if (t.filterLabel({ status: 'all', wave: 'all', owner: 'all', text: '' }) !== '') {
    throw new Error('an empty filter must leave the view title alone');
}

// the detail view decides what the panel may offer
const v = t.detailView(byId.get('1.2'), spec);
const act = new Map(v.actions.map((a) => [a.action, a]));
for (const a of ['start', 'done', 'claim', 'release', 'branch', 'verify', 'prompt']) {
    if (!act.has(a)) throw new Error('detail panel offers no ' + a);
}
if (!act.get('claim').disabled) throw new Error('a claimed task must not offer claim');
if (act.get('release').disabled) throw new Error('a claimed task must offer release');
if (act.get('branch').disabled) throw new Error('a task with a worktree must offer its branch');
if (t.detailView(byId.get('1.1'), spec).criteria[0].text !==
    spec.clauses['1.1']) {
    throw new Error('acceptance criteria text is not resolved for the panel');
}

// the panel is CSP-strict: one nonce, no eval, no remote anything
const html = t.detailHtml('N0NCE');
const csp = /<meta http-equiv="Content-Security-Policy"[^>]*content="([^"]+)"/
    .exec(html);
if (!csp) throw new Error('detail panel has no CSP');
if (!/default-src 'none'/.test(csp[1]) ||
    !/script-src 'nonce-N0NCE'/.test(csp[1]) ||
    !/style-src 'nonce-N0NCE'/.test(csp[1])) {
    throw new Error('CSP is not nonce-only: ' + csp[1]);
}
if (/unsafe-inline|unsafe-eval|https?:/.test(csp[1])) {
    throw new Error('CSP allows more than this panel: ' + csp[1]);
}
if (/<script(?![^>]*nonce="N0NCE")/.test(html)) throw new Error('un-nonced script tag');
if (/src="http|href="http/.test(html)) throw new Error('panel loads a remote resource');
if (/innerHTML/.test(html)) throw new Error('panel renders data through innerHTML');

// the resume prompt is built from the task's own declaration
const prompt = t.resumePrompt(byId.get('1.1'), { clauses: spec.clauses });
for (const needle of ['# resume: demo/1.1', 'Take the lock.', 'src/gate.c',
                      'gate_open', 'verify: make test', 'cg spec done 1.1',
                      'cg handoff --task 1.1', spec.clauses['1.1']]) {
    if (!prompt.includes(needle)) throw new Error('prompt lacks: ' + needle);
}
console.log('task model ok:', rows.length, 'rows');
JS

# the tree itself, driven against a stub vscode module: the grouping, the
# row contents, and what the view title says when a filter is on
node - "$EXT" "$TMP/spec.kvx" <<'JS'
const path = require('path'), Module = require('module');
const [, , dir, specfile] = process.argv;

/* the sliver of the VS Code API the task tree touches */
const items = [];
class TreeItem {
    constructor(label, state) { this.label = label; this.collapsibleState = state; }
}
const view = { dispose() {} };
const stub = {
    EventEmitter: class { constructor() { this.event = () => ({ dispose() {} }); }
        fire() {} },
    TreeItem,
    TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
    ThemeIcon: class { constructor(id, color) { this.id = id; this.color = color; } },
    ThemeColor: class { constructor(id) { this.id = id; } },
    MarkdownString: class { constructor() { this.value = ''; }
        appendMarkdown(s) { this.value += s; return this; } },
    window: {
        createTreeView: (id, opts) => { view.id = id; view.opts = opts; return view; },
        onDidCloseTerminal: () => ({ dispose() {} }),
    },
    commands: { registerCommand: () => ({ dispose() {} }) },
};
const load = Module._load;
Module._load = function (req) {
    if (req === 'vscode') return stub;
    return load.apply(this, arguments);
};
const t = require(path.join(dir, 'tasks.js'));

const trace = { feature: 'demo', graph: true, tasks: [
    { id: '1.1', title: 'Gate', status: 'done', wave: 1, symbols: [], touches: [] },
    { id: '1.2', title: 'Callers', status: 'in_progress', wave: 2, symbols: [], touches: [] },
    { id: '2.1', title: 'Tree', status: 'pending', wave: 2, symbols: [], touches: [] },
]};
const status = { feature: 'demo', spec: path.basename(specfile), mode: 'parallel',
    tasks: 3, done: 1, next: { id: '2.1' }, documentation: { configured: false },
    claims: [{ id: '1.2', agent: 'w-demo-2', role: 'worker',
               branch: 'wave/demo/2', worktree: '/tmp/wt/demo-2',
               expires_in_min: 21 }] };
const plan = { waves: [{ wave: 2, branch: 'wave/demo/2' }] };
const answers = { 'spec status': status, 'spec trace': trace, 'fleet plan': plan };

const ctx = { subscriptions: [], workspaceState: { get: () => null, update() {} } };
const provider = t.register(ctx, {
    cg: async () => ({ code: 0, stdout: '', stderr: '' }),
    cgJson: async (args) => answers[args.slice(0, 2).join(' ')] || null,
    workspaceRoot: () => path.dirname(specfile),
    show: () => {},
    state: ctx.workspaceState,
    sessionBadge: () => '',
});

(async () => {
    await provider.refresh();
    if (provider.rows.length !== 3) throw new Error('rows: ' + provider.rows.length);

    const roots = provider.getChildren();
    if (roots.length !== 1 || roots[0].label !== 'demo') {
        throw new Error('root is not the feature: ' + JSON.stringify(roots.map(r => r.label)));
    }
    if (!/1\/3 done/.test(roots[0].description)) {
        throw new Error('feature progress: ' + roots[0].description);
    }
    const sections = provider.getChildren(roots[0]);
    if (sections.map((s) => s.label).join(',') !== 'One indexer,Editor surface') {
        throw new Error('sections: ' + sections.map((s) => s.label).join(','));
    }
    const waves = provider.getChildren(sections[0]);
    if (waves.map((w) => w.label).join(',') !== 'Wave 1,Wave 2') {
        throw new Error('waves: ' + waves.map((w) => w.label).join(','));
    }
    const editorWaves = provider.getChildren(sections[1]);
    if (editorWaves.length !== 1 || !/wave\/demo\/2/.test(editorWaves[0].description)) {
        throw new Error('the wave does not name its branch: ' + editorWaves[0].description);
    }
    const leaves = provider.getChildren(waves[0]);
    if (leaves.length !== 1 || leaves[0].label !== '1.1  Gate') {
        throw new Error('task row: ' + JSON.stringify(leaves.map((l) => l.label)));
    }
    if (leaves[0].contextValue !== 'task-done') {
        throw new Error('contextValue: ' + leaves[0].contextValue);
    }
    if (leaves[0].command.command !== 'codify.tasks.detail') {
        throw new Error('a task row does not open its detail panel');
    }
    const owner = provider.getChildren(waves[1])[0];
    if (!owner || !/w-demo-2/.test(owner.description) ||
        !/wave\/demo\/2/.test(owner.description) ||
        !/in progress/.test(owner.description)) {
        throw new Error('owner, branch or status missing from the row: ' +
            (owner && owner.description));
    }
    const blocked = provider.getChildren(editorWaves[0])[0];
    if (!/blocked by 1\.2/.test(blocked.description)) {
        throw new Error('blockers missing from the row: ' + blocked.description);
    }

    // a filter narrows the tree and says so in the view title
    provider.setFilter({ status: 'done' });
    if (view.description !== 'done') {
        throw new Error('view title does not show the filter: ' + view.description);
    }
    const only = provider.getChildren(provider.getChildren(
        provider.getChildren(provider.getChildren()[0])[0])[0]);
    if (only.length !== 1 || only[0].label !== '1.1  Gate') {
        throw new Error('filtered tree: ' + JSON.stringify(only.map((i) => i.label)));
    }
    provider.setFilter({ status: 'implemented' });
    const none = provider.getChildren();
    if (none.length !== 1 || !/No task matches/.test(none[0].label)) {
        throw new Error('an empty filter needs an empty state, got ' +
            JSON.stringify(none.map((n) => n.label)));
    }
    provider.setFilter({ status: 'all' });
    if (view.description !== undefined) {
        throw new Error('clearing the filter leaves the title dirty');
    }
    console.log('task tree ok:', sections.length, 'sections');
})().catch((e) => { console.error(String(e.message || e)); process.exit(1); });
JS

# ---- cg resolves the three declared symbols in the extension source
rm -rf "$TMP/ext"
mkdir -p "$TMP/ext/editors/vscode"
cp "$EXT"/*.js "$TMP/ext/editors/vscode/"
cd "$TMP/ext"
"$CG" init >/dev/null
for sym in TaskTreeProvider taskFilter taskDetail; do
    out="$("$CG" symbol "$sym")"
    has "$out" "$sym"
    has "$out" "editors/vscode/tasks.js"
done
cd "$TMP"
echo "task symbols indexed"
fi

if want lsp; then
# ---- the LSP client speaks to the real server
rm -rf "$TMP/proj"
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
