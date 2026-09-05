/* Codify VS Code extension — the whole workflow, in the editor.
 *
 * Language features come from `cg lsp` through a hand-written client, so the
 * extension keeps Codify's promise: zero dependencies, no build step. Every
 * other feature shells out to the same `cg` commands a person would type, so
 * there is one implementation of the workflow, not two.
 *
 * Plain JS, zero dependencies, no build step. */
const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');
const { LspClient } = require('./client');
const language = require('./language');
const kvx = require('./kvx');
const agents = require('./agents');
const acp = require('./acp');

let provider;
let memories;
let statusItem;
let scopeItem;
let out;
let client;
let diagnostics;
let revalidate = () => {};
let agentApi = { hasTerminal: () => false };
let acpApi = { hasPanel: () => false };

function config() { return vscode.workspace.getConfiguration('codify'); }
function binary() { return config().get('binaryPath') || 'cg'; }

function workspaceRoot() {
    const f = vscode.workspace.workspaceFolders;
    return f && f.length ? f[0].uri.fsPath : undefined;
}

/* run cg with args; resolves {code, stdout, stderr} and never rejects */
function cg(args) {
    const feature = config().get('feature');
    const specish = args[0] === 'spec' || args[0] === 'docs';
    const full = feature && specish ? [...args, '-f', feature] : args;
    return new Promise((resolve) => {
        cp.execFile(binary(), full,
            { cwd: workspaceRoot(), maxBuffer: 16 * 1024 * 1024 },
            (err, stdout, stderr) => resolve({
                code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
                stdout: stdout || '',
                stderr: stderr || '',
            }));
    });
}

async function cgJson(args) {
    const r = await cg([...args, '--json']);
    /* exit codes carry meaning (lint returns 2, check returns 1); parse the
     * payload regardless and let the caller decide what the code means */
    try { return JSON.parse(r.stdout); } catch { return null; }
}

/* ---------------- task board ---------------- */

class TaskProvider {
    constructor() {
        this._em = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._em.event;
        this.model = null;   /* {status, trace} or null */
    }

    async refresh() {
        const status = await cgJson(['spec', 'status']);
        if (!status) {
            this.model = null;
        } else {
            const trace = await cgJson(['spec', 'trace']);
            this.model = { status, trace: trace || { graph: false, tasks: [] } };
        }
        this._em.fire();
        updateStatusBar(this.model);
        updateScope();
        vscode.commands.executeCommand('setContext', 'codify.hasSpec', !!this.model);
        vscode.commands.executeCommand('setContext', 'codify.parallel',
            !!this.model && this.model.status.mode === 'parallel');
    }

    getTreeItem(el) { return el; }

    getChildren(el) {
        if (!this.model) return [];
        if (!el) return this.waveNodes();
        if (el.kind === 'wave') return el.tasks.map((t) => this.taskNode(t));
        if (el.kind === 'task') return this.detailNodes(el.task);
        return [];
    }

    claimFor(id) {
        const claims = (this.model.status.claims) || [];
        return claims.find((c) => c.id === id);
    }

    waveNodes() {
        const byWave = new Map();
        for (const t of this.model.trace.tasks) {
            if (!byWave.has(t.wave)) byWave.set(t.wave, []);
            byWave.get(t.wave).push(t);
        }
        const nodes = [...byWave.keys()].sort((a, b) => a - b).map((w) => {
            const tasks = byWave.get(w);
            const done = tasks.filter((t) => t.status === 'done').length;
            const impl = tasks.filter((t) => t.status === 'implemented').length;
            const it = new vscode.TreeItem(`Wave ${w}`,
                done === tasks.length
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.Expanded);
            it.kind = 'wave';
            it.tasks = tasks;
            it.description = impl
                ? `${done}/${tasks.length} done · ${impl} implemented`
                : `${done}/${tasks.length} done`;
            it.iconPath = new vscode.ThemeIcon(
                done === tasks.length ? 'layers-dot' : 'layers');
            return it;
        });
        const d = this.model.status.documentation;
        if (d && d.configured && d.mode !== 'off') {
            const task = { id: '@docs', title: 'Generate and verify project documentation',
                status: d.status, wave: 'closure', virtual: true };
            const it = new vscode.TreeItem('Documentation closure',
                d.status === 'done' ? vscode.TreeItemCollapsibleState.Collapsed
                                    : vscode.TreeItemCollapsibleState.Expanded);
            it.kind = 'wave'; it.tasks = [task];
            it.description = d.status; it.iconPath = new vscode.ThemeIcon('book');
            nodes.push(it);
        }
        return nodes;
    }

    taskNode(t) {
        const hasDetail = (t.symbols && t.symbols.length) ||
            (t.touches && t.touches.length) || (t.commits && t.commits.length) ||
            (t.memories && t.memories.length);
        const it = new vscode.TreeItem(`${t.id}  ${t.title}`, hasDetail
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        it.kind = 'task';
        it.task = t;
        it.id = `task:${t.id}`;
        it.contextValue = `task-${t.status}`;
        const next = this.model.status.next && this.model.status.next.id === t.id;
        const claim = this.claimFor(t.id);
        const term = agentApi.hasTerminal(t.id) ? ' $(terminal)'
            : acpApi.hasPanel(t.id) ? ' $(comment-discussion)' : '';
        it.description = claim ? `${t.status} · $(person) ${claim.agent}${term}`
            : term ? `${t.status}${term}`
            : t.status === 'in_progress' ? 'in progress'
            : t.status === 'implemented' ? 'qualification pending'
            : next ? 'next' : t.status;
        it.iconPath =
            t.status === 'done' ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
            : t.status === 'implemented' ? new vscode.ThemeIcon('circle-large-filled', new vscode.ThemeColor('charts.purple'))
            : t.status === 'in_progress' ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow'))
            : next ? new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'))
            : new vscode.ThemeIcon('circle-outline');
        const lines = [`[task.${t.id}] ${t.title}`,
            `status: ${t.status}   wave: ${t.wave}`];
        if (claim) lines.push(`claimed by ${claim.agent} (${claim.expires_in_min} min left)`);
        if (t.touches && t.touches.length) {
            lines.push('touches: ' + t.touches.map((c) => c.pattern).join(' '));
        }
        it.tooltip = lines.join('\n');
        it.command = { command: 'codify.openTask', title: 'Open task', arguments: [t.id] };
        return it;
    }

    detailNodes(t) {
        const ok = (b) => b
            ? new vscode.ThemeIcon('check', new vscode.ThemeColor('testing.iconPassed'))
            : new vscode.ThemeIcon('close', new vscode.ThemeColor('testing.iconFailed'));
        const nodes = [];
        for (const s of t.symbols || []) {
            const it = new vscode.TreeItem(s.name);
            it.iconPath = ok(s.found);
            it.description = s.found
                ? `${s.path}:${s.line}  ${s.kind}, ${s.refs} refs`
                : 'not in graph';
            it.contextValue = s.found ? 'symbol' : 'symbol-missing';
            it.symbolName = s.name;
            if (s.found) it.command = {
                command: 'vscode.open', title: 'Open',
                arguments: [
                    vscode.Uri.file(path.join(workspaceRoot() || '', s.path)),
                    { selection: new vscode.Range(s.line - 1, 0, s.line - 1, 0) },
                ],
            };
            nodes.push(it);
        }
        for (const c of t.touches || []) {
            const it = new vscode.TreeItem(c.pattern);
            it.iconPath = ok(c.changed);
            it.description = c.changed ? 'changed' : 'no matching change';
            nodes.push(it);
        }
        for (const c of t.commits || []) {
            const it = new vscode.TreeItem(c.id.slice(0, 12));
            it.iconPath = new vscode.ThemeIcon('git-commit');
            it.description = c.message;
            it.tooltip = new Date(c.date * 1000).toLocaleString();
            nodes.push(it);
        }
        for (const m of t.memories || []) {
            const it = new vscode.TreeItem(m.body);
            it.iconPath = new vscode.ThemeIcon('lightbulb');
            it.description = m.type;
            it.tooltip = `${m.type} — ${new Date(m.created * 1000).toLocaleString()}`;
            nodes.push(it);
        }
        return nodes;
    }
}

/* ---------------- memory view ---------------- */

class MemoryProvider {
    constructor() {
        this._em = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._em.event;
        this.items = [];
    }

    async refresh() {
        const r = await cgJson(['recall', '-n', '40']);
        this.items = (r && r.memories) || [];
        this._em.fire();
    }

    getTreeItem(el) { return el; }

    getChildren() {
        if (!this.items.length) return [];
        const icon = {
            decision: 'law', constraint: 'lock', outcome: 'history',
            preference: 'heart', fact: 'note',
        };
        return this.items.map((m) => {
            const it = new vscode.TreeItem(m.body);
            it.description = m.task ? `${m.type} · ${m.task}` : m.type;
            it.iconPath = new vscode.ThemeIcon(icon[m.type] || 'note');
            it.tooltip = `${m.type}\n${new Date(m.created * 1000).toLocaleString()}` +
                (m.symbols ? `\nsymbols: ${m.symbols}` : '') +
                (m.files ? `\nfiles: ${m.files}` : '');
            it.contextValue = 'memory';
            it.memoryId = m.id;
            return it;
        });
    }
}

/* ---------------- status bar ---------------- */

function updateStatusBar(model) {
    if (!model) { statusItem.hide(); return; }
    const s = model.status;
    const pct = s.tasks ? Math.round((s.done / s.tasks) * 100) : 0;
    const cur = s.current;
    statusItem.text = cur
        ? `$(play-circle) ${cur.id} ${s.done}/${s.tasks}`
        : `$(checklist) ${s.feature} ${s.done}/${s.tasks}`;
    statusItem.tooltip = new vscode.MarkdownString(
        `**Codify** — ${s.feature} (${s.mode} mode)\n\n` +
        `${pct}% done` +
        (cur ? `\n\nIn progress: **${cur.id}** ${cur.title}` : '') +
        (s.next ? `\n\nNext: **${s.next.id}** ${s.next.title}` : '') +
        `\n\n_Click for actions._`);
    statusItem.show();
}

/* The scope indicator is the ambient half of `cg guard`: it says, without
 * being asked, when edits have wandered outside what the task declared. */
async function updateScope() {
    const r = await cgJson(['guard']);
    if (!r || !r.guarded || !r.count) { scopeItem.hide(); return; }
    scopeItem.text = `$(warning) ${r.count} out of scope`;
    scopeItem.tooltip = new vscode.MarkdownString(
        `**Outside task ${r.task}'s declared scope**\n\n` +
        r.out_of_scope.map((p) => `- \`${p}\``).join('\n') +
        '\n\n_Advisory only. Click to review._');
    scopeItem.show();
}

/* ---------------- output and reports ---------------- */

function show(text) {
    out.clear();
    out.appendLine((text || '').trimEnd());
    out.show(true);
}

/* Reports read far better as rendered markdown than as console text, and a
 * virtual document costs nothing to produce. */
const REPORTS = new Map();
const SCHEME = 'codify';

async function openReport(name, title, body) {
    REPORTS.set(name, `# ${title}\n\n${body}`);
    const uri = vscode.Uri.parse(`${SCHEME}:${name}.md`);
    reportEmitter.fire(uri);
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: true });
    await vscode.commands.executeCommand('markdown.showPreview', uri);
}

const reportEmitter = new vscode.EventEmitter();

function fence(text) {
    return '```\n' + (text || '').trimEnd() + '\n```';
}

/* ---------------- commands ---------------- */

async function pickTask(statusFilter) {
    const trace = provider.model && provider.model.trace;
    if (!trace) return undefined;
    const items = trace.tasks
        .filter((t) => !statusFilter || t.status === statusFilter)
        .map((t) => ({
            label: `${t.id}  ${t.title}`,
            description: t.status,
            detail: (t.touches || []).map((c) => c.pattern).join('  '),
            id: t.id,
        }));
    if (!items.length) {
        vscode.window.showInformationMessage(
            statusFilter ? `No ${statusFilter} tasks.` : 'No tasks.');
        return undefined;
    }
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Codify task' });
    return pick && pick.id;
}

function taskIdFrom(arg) {
    if (typeof arg === 'string') return arg;
    if (arg && arg.task) return arg.task.id;
    return undefined;
}

async function afterMutation() {
    await provider.refresh();
    await memories.refresh();
    revalidate();          /* scope depends on which task is in progress */
}

async function cmdStart(arg) {
    const id = taskIdFrom(arg) || await pickTask('pending');
    if (!id) return;
    const r = await cg(id === '@docs'
        ? ['spec', 'docs', 'start'] : ['spec', 'start', id]);
    show(r.stdout + r.stderr);
    if (r.code !== 0) {
        vscode.window.showErrorMessage(`cg spec start ${id} refused — see the Codify output.`);
    }
    afterMutation();
}

async function cmdImplemented(arg) {
    const id = taskIdFrom(arg) || await pickTask('in_progress');
    if (!id) return;
    const r = await cg(['spec', 'implemented', id]);
    show(r.stdout + r.stderr);
    if (r.code !== 0) {
        vscode.window.showWarningMessage(
            `Task ${id} was not marked implemented — its source checks failed.`);
    }
    afterMutation();
}

async function cmdDone(arg) {
    const id = taskIdFrom(arg) || await pickTask('in_progress');
    if (!id) return;
    const r = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification,
          title: `Qualifying ${id} — running verify_cmd and graph checks` },
        () => cg(id === '@docs' ? ['docs', 'close'] : ['spec', 'done', id]));
    show(r.stdout + r.stderr);
    if (r.code !== 0) {
        /* The refusal is the feature. Offer the override, but name what it
         * means rather than presenting it as the obvious next click. */
        const pick = await vscode.window.showWarningMessage(
            `Task ${id} did NOT qualify. See the Codify output for which check failed.`,
            ...(id === '@docs' ? ['Show output'] : ['Show output', 'Force done anyway']));
        if (pick === 'Show output') out.show(true);
        if (pick === 'Force done anyway') {
            const confirm = await vscode.window.showWarningMessage(
                `Force ${id} to done? This records a task as complete whose checks did not pass.`,
                { modal: true }, 'Force');
            if (confirm === 'Force') {
                const f = await cg(['spec', 'done', id, '--force']);
                show(f.stdout + f.stderr);
            }
        }
    }
    afterMutation();
}

async function cmdDocs(action) {
    const r = await cg(['docs', action]);
    if (action === 'plan' || action === 'trace')
        openReport(`docs-${action}`, `Documentation ${action}`, fence(r.stdout + r.stderr));
    else show(r.stdout + r.stderr);
    if (r.code !== 0) vscode.window.showWarningMessage(
        `Documentation ${action} did not pass — see the Codify output.`);
    afterMutation();
}

async function cmdClaim(arg) {
    const id = taskIdFrom(arg) || await pickTask();
    if (!id) return;
    const agent = await vscode.window.showInputBox({
        prompt: 'Claim this task for which agent?',
        value: config().get('agentName') || 'me',
    });
    if (!agent) return;
    const r = await cg(['spec', 'claim', id, '--agent', agent]);
    show(r.stdout + r.stderr);
    if (r.code !== 0) vscode.window.showErrorMessage(`Claim refused — see the Codify output.`);
    afterMutation();
}

async function cmdRelease(arg) {
    const id = taskIdFrom(arg) || await pickTask();
    if (!id) return;
    const r = await cg(['spec', 'release', id]);
    show(r.stdout + r.stderr);
    afterMutation();
}

async function cmdTrace(arg) {
    const id = taskIdFrom(arg) || await pickTask();
    if (!id) return;
    const r = await cg(['spec', 'trace', id]);
    openReport('trace', `Trace — task ${id}`, fence(r.stdout + r.stderr));
}

async function cmdNext() {
    const r = await cg(['spec', 'next']);
    show(r.stdout + r.stderr);
    const next = provider.model && provider.model.status.next;
    if (next) {
        const pick = await vscode.window.showInformationMessage(
            `Next: ${next.id} — ${next.title}`, 'Start it');
        if (pick === 'Start it') cmdStart(next.id);
    }
}

async function cmdWave() {
    const r = await cg(['spec', 'wave']);
    show(r.stdout + r.stderr);
}

async function cmdRender() {
    const r = await cg(['spec', 'render']);
    show(r.stdout + r.stderr);
    afterMutation();
}

async function cmdLint() {
    const r = await cg(['spec', 'lint']);
    show(r.stdout + r.stderr);
    if (r.code === 2) {
        vscode.window.showErrorMessage('Spec lint found errors — see the Codify output.');
    } else if (/warn/.test(r.stdout)) {
        vscode.window.showWarningMessage('Spec lint found warnings — see the Codify output.');
    } else {
        vscode.window.showInformationMessage('Spec lint is clean.');
    }
}

async function cmdNewFeature() {
    const feature = await vscode.window.showInputBox({
        prompt: 'New feature spec name',
        placeHolder: 'payments',
        validateInput: (v) => /^[A-Za-z0-9_-]+$/.test(v || '')
            ? null : 'Letters, digits, - and _ only',
    });
    if (!feature) return;
    const r = await cg(['spec', 'new', feature]);
    show(r.stdout + r.stderr);
    if (r.code === 0) {
        const file = path.join(workspaceRoot() || '', 'spec', feature, 'spec.kvx');
        vscode.window.showTextDocument(await vscode.workspace.openTextDocument(file));
    }
    afterMutation();
}

async function cmdAddTask() {
    const id = await vscode.window.showInputBox({
        prompt: 'Task id (dotted numbers)', placeHolder: '2.1',
        validateInput: (v) => /^[0-9]+(\.[0-9]+)*$/.test(v || '')
            ? null : 'Dotted numbers only, e.g. 2.1',
    });
    if (!id) return;
    const title = await vscode.window.showInputBox({ prompt: `Title for task ${id}` });
    if (!title) return;
    const wave = await vscode.window.showInputBox({
        prompt: 'Wave (blank for 0)', value: '0',
    });
    const touches = await vscode.window.showInputBox({
        prompt: 'Paths or globs this task changes (comma separated, optional)',
        placeHolder: 'src/*.ts, docs/api.md',
    });
    const symbols = await vscode.window.showInputBox({
        prompt: 'Symbols this task introduces (comma separated, optional)',
        placeHolder: 'refundCharge',
    });
    const args = ['spec', 'add', id, '--title', title];
    if (wave) args.push('--wave', wave);
    if (touches) args.push('--touches', touches);
    if (symbols) args.push('--symbols', symbols);
    const r = await cg(args);
    show(r.stdout + r.stderr);
    afterMutation();
    if (r.code === 0) cmdOpenTask(id);
}

async function cmdBrief() {
    const r = await cg(['brief']);
    openReport('brief', 'Session brief', fence(r.stdout + r.stderr));
}

async function cmdReview() {
    const r = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Codify: reviewing change' },
        () => cg(['review']));
    openReport('review', 'Review', fence(r.stdout + r.stderr));
}

async function cmdCheck() {
    const r = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Window, title: 'Codify: checking repository' },
        () => cg(['check']));
    show(r.stdout + r.stderr);
    if (r.code !== 0) vscode.window.showErrorMessage('cg check found failures.');
    else vscode.window.showInformationMessage('cg check passed.');
}

async function cmdGuard() {
    const r = await cg(['guard']);
    show(r.stdout + r.stderr);
    updateScope();
}

async function cmdTestImpact() {
    const ed = vscode.window.activeTextEditor;
    let name;
    if (ed) {
        const range = ed.document.getWordRangeAtPosition(ed.selection.active);
        if (range) name = ed.document.getText(range);
    }
    const r = await cg(name ? ['test-impact', name] : ['test-impact']);
    openReport('test-impact', name ? `Tests touching ${name}` : 'Tests touching your changes',
        fence(r.stdout + r.stderr));
}

async function cmdWhy() {
    const ed = vscode.window.activeTextEditor;
    if (!ed) return;
    const range = ed.document.getWordRangeAtPosition(ed.selection.active);
    const name = range ? ed.document.getText(range) : undefined;
    if (!name) return;
    const r = await cg(['why', name]);
    openReport('why', `Why ${name} exists`, fence(r.stdout + r.stderr));
}

async function cmdRemember() {
    const text = await vscode.window.showInputBox({
        prompt: 'What is worth knowing in a later session?',
        placeHolder: 'Sessions rotate on login',
    });
    if (!text) return;
    const type = await vscode.window.showQuickPick(
        ['decision', 'constraint', 'fact', 'preference', 'outcome'],
        { placeHolder: 'Memory type' });
    if (!type) return;
    const args = ['remember', text, '--type', type];
    const ed = vscode.window.activeTextEditor;
    if (ed && ed.document.uri.scheme === 'file') {
        const rel = path.relative(workspaceRoot() || '', ed.document.uri.fsPath);
        if (rel && !rel.startsWith('..')) args.push('--files', rel);
    }
    const r = await cg(args);
    show(r.stdout + r.stderr);
    memories.refresh();
}

async function cmdForget(arg) {
    const id = arg && arg.memoryId;
    if (id === undefined) return;
    const pick = await vscode.window.showWarningMessage(
        'Delete this memory permanently?', { modal: true }, 'Delete');
    if (pick !== 'Delete') return;
    await cg(['forget', String(id)]);
    memories.refresh();
}

async function cmdSnapshot() {
    const message = await vscode.window.showInputBox({
        prompt: 'Snapshot message (auto-tagged with the in-progress task)',
    });
    if (!message) return;
    const r = await cg(['commit', '-m', message]);
    show(r.stdout + r.stderr);
    afterMutation();
}

async function cmdSync() {
    const r = await cg(['sync']);
    show(r.stdout + r.stderr);
    revalidate();
}

async function cmdHookInstall() {
    const r = await cg(['hook', 'install']);
    show(r.stdout + r.stderr);
}

async function cmdOpenTask(id) {
    const model = provider.model;
    if (!model || !model.status.spec) return;
    const uri = vscode.Uri.file(path.join(workspaceRoot() || '', model.status.spec));
    const doc = await vscode.workspace.openTextDocument(uri);
    const ed = await vscode.window.showTextDocument(doc);
    const ix = doc.getText().indexOf(`[task.${id}]`);
    if (ix >= 0) {
        const pos = doc.positionAt(ix);
        ed.selection = new vscode.Selection(pos, pos);
        ed.revealRange(new vscode.Range(pos, pos), vscode.TextEditorRevealType.InCenter);
    }
}

/* One menu instead of a dozen memorised command names. */
async function cmdActions() {
    const s = provider.model && provider.model.status;
    const items = [
        { label: '$(rocket) Session brief', cmd: 'codify.brief' },
        { label: '$(checklist) Next eligible task', cmd: 'codify.nextTask' },
        { label: '$(layers) Current wave', cmd: 'codify.wave' },
        { label: '$(git-compare) Review the change', cmd: 'codify.review' },
        { label: '$(beaker) Tests touching this change', cmd: 'codify.testImpact' },
        { label: '$(shield) Check edit scope', cmd: 'codify.guard' },
        { label: '$(verified) Check the repository', cmd: 'codify.check' },
        { label: '$(book) Documentation plan', cmd: 'codify.docsPlan' },
        { label: '$(check) Check documentation', cmd: 'codify.docsCheck' },
        { label: '$(git-commit) Trace documentation', cmd: 'codify.docsTrace' },
        { label: '$(lightbulb) Remember a decision', cmd: 'codify.remember' },
        { label: '$(save) Snapshot the working tree', cmd: 'codify.snapshot' },
        { label: '$(add) New feature spec', cmd: 'codify.newFeature' },
        { label: '$(diff-added) Add a task', cmd: 'codify.addTask' },
        { label: '$(law) Lint the spec', cmd: 'codify.lint' },
        { label: '$(sync) Sync the index', cmd: 'codify.sync' },
        { label: '$(plug) Install hooks', cmd: 'codify.hookInstall' },
    ];
    const pick = await vscode.window.showQuickPick(items, {
        placeHolder: s ? `${s.feature} — ${s.done}/${s.tasks} done (${s.mode} mode)`
                       : 'Codify',
    });
    if (pick) vscode.commands.executeCommand(pick.cmd);
}

/* ---------------- activation ---------------- */

async function activate(ctx) {
    out = vscode.window.createOutputChannel('Codify');
    provider = new TaskProvider();
    memories = new MemoryProvider();
    diagnostics = vscode.languages.createDiagnosticCollection('codify');

    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.command = 'codify.actions';
    scopeItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 49);
    scopeItem.command = 'codify.guard';
    scopeItem.backgroundColor = new vscode.ThemeColor('statusBarItem.warningBackground');

    ctx.subscriptions.push(
        out, statusItem, scopeItem, diagnostics,
        vscode.window.registerTreeDataProvider('codifyTasks', provider),
        vscode.window.registerTreeDataProvider('codifyMemories', memories),
        vscode.workspace.registerTextDocumentContentProvider(SCHEME, {
            onDidChange: reportEmitter.event,
            provideTextDocumentContent: (uri) =>
                REPORTS.get(uri.path.replace(/\.md$/, '')) || '',
        }),
    );

    const cmds = {
        'codify.refresh': () => afterMutation(),
        'codify.actions': cmdActions,
        'codify.nextTask': cmdNext,
        'codify.wave': cmdWave,
        'codify.startTask': cmdStart,
        'codify.implementedTask': cmdImplemented,
        'codify.doneTask': cmdDone,
        'codify.claimTask': cmdClaim,
        'codify.releaseTask': cmdRelease,
        'codify.traceTask': cmdTrace,
        'codify.render': cmdRender,
        'codify.lint': cmdLint,
        'codify.newFeature': cmdNewFeature,
        'codify.addTask': cmdAddTask,
        'codify.openTask': cmdOpenTask,
        'codify.brief': cmdBrief,
        'codify.review': cmdReview,
        'codify.check': cmdCheck,
        'codify.docsPlan': () => cmdDocs('plan'),
        'codify.docsPacket': () => cmdDocs('packet'),
        'codify.docsCheck': () => cmdDocs('check'),
        'codify.docsTrace': () => cmdDocs('trace'),
        'codify.guard': cmdGuard,
        'codify.why': cmdWhy,
        'codify.testImpact': cmdTestImpact,
        'codify.remember': cmdRemember,
        'codify.forget': cmdForget,
        'codify.snapshot': cmdSnapshot,
        'codify.sync': cmdSync,
        'codify.hookInstall': cmdHookInstall,
    };
    for (const [name, fn] of Object.entries(cmds)) {
        ctx.subscriptions.push(vscode.commands.registerCommand(name, fn));
    }

    kvx.register(ctx, cgJson, workspaceRoot);
    agentApi = agents.register(ctx, {
        cg, cgJson, refresh: () => afterMutation(), workspaceRoot,
    });
    acpApi = acp.register(ctx, {
        cg, cgJson, refresh: () => afterMutation(), workspaceRoot,
        startTerminal: agentApi.startTerminal,
    });

    /* Language features are best-effort: a workspace with no .codegraph, or
     * no cg on PATH, still gets the spec tooling above. */
    const root = workspaceRoot();
    if (root && config().get('languageServer') !== false) {
        client = new LspClient(binary(), root, (m) => out.appendLine(m));
        ctx.subscriptions.push({ dispose: () => client.dispose() });
        if (await client.start()) {
            revalidate = language.register(ctx, client, diagnostics);
            out.appendLine('language server ready');
        } else {
            out.appendLine(
                'language features are off — run `cg init` here, or set ' +
                'codify.binaryPath if cg is not on PATH.');
        }
    }

    const watcher = vscode.workspace.createFileSystemWatcher('**/spec/**/*.kvx');
    let timer;
    const bump = () => {
        clearTimeout(timer);
        timer = setTimeout(() => afterMutation(), 300);
    };
    watcher.onDidChange(bump); watcher.onDidCreate(bump); watcher.onDidDelete(bump);
    ctx.subscriptions.push(watcher);

    afterMutation();
}

function deactivate() {
    if (client) client.dispose();
}

module.exports = { activate, deactivate };
