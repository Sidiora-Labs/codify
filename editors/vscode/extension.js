/* Codify VS Code extension — task board + kvx tooling over the cg CLI.
 * Plain JS, zero dependencies, no build step. */
const vscode = require('vscode');
const cp = require('child_process');
const path = require('path');

let provider;
let statusItem;
let out;

function config() { return vscode.workspace.getConfiguration('codify'); }

function workspaceRoot() {
    const f = vscode.workspace.workspaceFolders;
    return f && f.length ? f[0].uri.fsPath : undefined;
}

/* run cg with args; resolves {code, stdout, stderr} and never rejects */
function cg(args) {
    const feature = config().get('feature');
    const full = feature ? [...args, '-f', feature] : args;
    return new Promise((resolve) => {
        cp.execFile(config().get('binaryPath') || 'cg', full,
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
    if (r.code !== 0) return null;
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
    }

    getTreeItem(el) { return el; }

    getChildren(el) {
        if (!this.model) return [];
        if (!el) return this.waveNodes();
        if (el.kind === 'wave') return el.tasks.map((t) => this.taskNode(t));
        if (el.kind === 'task') return this.detailNodes(el.task);
        return [];
    }

    waveNodes() {
        const byWave = new Map();
        for (const t of this.model.trace.tasks) {
            if (!byWave.has(t.wave)) byWave.set(t.wave, []);
            byWave.get(t.wave).push(t);
        }
        return [...byWave.keys()].sort((a, b) => a - b).map((w) => {
            const tasks = byWave.get(w);
            const done = tasks.filter((t) => t.status === 'done').length;
            const it = new vscode.TreeItem(`Wave ${w}`,
                done === tasks.length
                    ? vscode.TreeItemCollapsibleState.Collapsed
                    : vscode.TreeItemCollapsibleState.Expanded);
            it.kind = 'wave';
            it.tasks = tasks;
            it.description = `${done}/${tasks.length} done`;
            it.iconPath = new vscode.ThemeIcon(done === tasks.length ? 'layers-dot' : 'layers');
            return it;
        });
    }

    taskNode(t) {
        const hasDetail = (t.symbols && t.symbols.length) ||
            (t.touches && t.touches.length) || (t.commits && t.commits.length);
        const it = new vscode.TreeItem(`${t.id}  ${t.title}`, hasDetail
            ? vscode.TreeItemCollapsibleState.Collapsed
            : vscode.TreeItemCollapsibleState.None);
        it.kind = 'task';
        it.task = t;
        it.id = `task:${t.id}`;
        it.contextValue = `task-${t.status}`;
        const next = this.model.status.next && this.model.status.next.id === t.id;
        it.description = t.status === 'in_progress' ? 'in progress'
            : next ? 'next' : t.status;
        it.iconPath =
            t.status === 'done' ? new vscode.ThemeIcon('pass-filled', new vscode.ThemeColor('testing.iconPassed'))
            : t.status === 'in_progress' ? new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.yellow'))
            : next ? new vscode.ThemeIcon('circle-outline', new vscode.ThemeColor('charts.blue'))
            : new vscode.ThemeIcon('circle-outline');
        it.tooltip = `[task.${t.id}] ${t.title}\nstatus: ${t.status}   wave: ${t.wave}`;
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
            if (s.found) it.command = {
                command: 'vscode.open', title: 'Open',
                arguments: [vscode.Uri.file(path.join(workspaceRoot() || '', s.path))],
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
        return nodes;
    }
}

function updateStatusBar(model) {
    if (!model) { statusItem.hide(); return; }
    const s = model.status;
    const pct = s.tasks ? Math.round((s.done / s.tasks) * 100) : 0;
    statusItem.text = `$(checklist) ${s.feature} ${s.done}/${s.tasks}`;
    statusItem.tooltip = `Codify: ${pct}% done` +
        (s.next ? ` — next: ${s.next.id} ${s.next.title}` : ' — all tasks done');
    statusItem.show();
}

/* ---------------- commands ---------------- */

function show(text) {
    out.clear();
    out.appendLine(text.trimEnd());
    out.show(true);
}

async function pickTask(statusFilter) {
    const trace = provider.model && provider.model.trace;
    if (!trace) return undefined;
    const items = trace.tasks
        .filter((t) => !statusFilter || t.status === statusFilter)
        .map((t) => ({ label: `${t.id}  ${t.title}`, description: t.status, id: t.id }));
    if (!items.length) return undefined;
    const pick = await vscode.window.showQuickPick(items, { placeHolder: 'Codify task' });
    return pick && pick.id;
}

function taskIdFrom(arg) {
    if (typeof arg === 'string') return arg;
    if (arg && arg.task) return arg.task.id;
    return undefined;
}

async function cmdStart(arg) {
    const id = taskIdFrom(arg) || await pickTask('pending');
    if (!id) return;
    const r = await cg(['spec', 'start', id]);
    if (r.code !== 0) vscode.window.showErrorMessage(`cg spec start ${id} failed`, { detail: r.stderr });
    show(r.stdout + r.stderr);
    provider.refresh();
}

async function cmdDone(arg) {
    const id = taskIdFrom(arg) || await pickTask('in_progress');
    if (!id) return;
    const r = await cg(['spec', 'done', id]);
    show(r.stdout + r.stderr);
    if (r.code !== 0) {
        const pick = await vscode.window.showWarningMessage(
            `Task ${id} was NOT marked done — its checks failed. See the Codify output for details.`,
            'Force done');
        if (pick === 'Force done') {
            const f = await cg(['spec', 'done', id, '--force']);
            show(f.stdout + f.stderr);
        }
    }
    provider.refresh();
}

async function cmdTrace(arg) {
    const id = taskIdFrom(arg) || await pickTask();
    if (!id) return;
    const r = await cg(['spec', 'trace', id]);
    show(r.stdout + r.stderr);
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

async function cmdRender() {
    const r = await cg(['spec', 'render']);
    show(r.stdout + r.stderr);
    provider.refresh();
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

/* ---------------- activation ---------------- */

function activate(ctx) {
    out = vscode.window.createOutputChannel('Codify');
    provider = new TaskProvider();
    statusItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 50);
    statusItem.command = 'codify.nextTask';

    ctx.subscriptions.push(
        out, statusItem,
        vscode.window.registerTreeDataProvider('codifyTasks', provider),
        vscode.commands.registerCommand('codify.refresh', () => provider.refresh()),
        vscode.commands.registerCommand('codify.nextTask', cmdNext),
        vscode.commands.registerCommand('codify.startTask', cmdStart),
        vscode.commands.registerCommand('codify.doneTask', cmdDone),
        vscode.commands.registerCommand('codify.traceTask', cmdTrace),
        vscode.commands.registerCommand('codify.render', cmdRender),
        vscode.commands.registerCommand('codify.openTask', cmdOpenTask),
    );

    const watcher = vscode.workspace.createFileSystemWatcher('**/spec/**/*.kvx');
    let timer;
    const bump = () => { clearTimeout(timer); timer = setTimeout(() => provider.refresh(), 300); };
    watcher.onDidChange(bump); watcher.onDidCreate(bump); watcher.onDidDelete(bump);
    ctx.subscriptions.push(watcher);

    provider.refresh();
}

function deactivate() {}

module.exports = { activate, deactivate };
