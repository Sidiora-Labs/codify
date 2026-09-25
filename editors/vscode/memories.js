/* Codify memory browser — project memory as a place you can search, not a
 * list you scroll.
 *
 * The tree view in extension.js answers "what was decided lately". This
 * answers "what do we know about X": full text across every memory, filters
 * by type, Jev class, task, branch and date, and a detail pane whose symbols
 * and files are links back into the code. That needs a layout a TreeView
 * cannot give, so it is a webview — CSP-strict, nonce'd, no remote anything.
 *
 * The panel owns no timer and no watcher. It loads when it opens, after an
 * action it ran itself, and from the extension's one refresh chain
 * (refresh.js). Everything it knows comes from `cg` through the deps handed
 * in at registration, so there is one implementation of the workflow.
 *
 * Commands that arrive with a newer cg (`cg memory classify`, `cg skills`)
 * are called optimistically and answered with a plain "not available in this
 * cg build" notice when the binary does not know them — the panel stays
 * usable rather than failing silently or hanging.
 */

/* Required lazily: memoryFilter below is pure, and the test suite drives it
 * under plain node where no vscode module exists. */
let vscode = null;
try { vscode = require('vscode'); } catch { /* headless: pure parts only */ }
const fs = require('fs');
const path = require('path');

/* One recall per load. Filtering is client side and instant, so the panel
 * holds the working set rather than re-querying on every keystroke. */
const MEMORY_LIMIT = 500;

/* Sentinel for "this field is empty", so a filter can ask for memories with
 * no task or no class without colliding with "any". */
const NONE = '__none__';

/* ---------------- the filter (pure, testable under plain node) ---------- */

function dayBound(value, end) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'number') return Math.floor(value);
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value).trim());
    if (!m) return null;
    const d = end
        ? new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59, 999)
        : new Date(+m[1], +m[2] - 1, +m[3], 0, 0, 0, 0);
    return Math.floor(d.getTime() / 1000);
}

function fieldMatches(value, want) {
    if (!want) return true;                       /* any */
    if (want === NONE) return !value;
    return String(value === null || value === undefined ? '' : value) === want;
}

function haystack(m) {
    return [m.body, m.type, m.class, m.task, m.branch, m.symbols, m.files,
        m.source].filter(Boolean).join(' \u0001 ').toLowerCase();
}

/* Match a set of memories against the filter bar, in input order.
 *
 * Every field is optional on both sides: `class`, `confidence` and `branch`
 * only exist in newer cg builds, and a memory missing one is excluded only
 * when that field is what the filter asks about. Text is an AND of
 * case-insensitive substrings over body, type, class, task, branch, symbols,
 * files and source — the same fields the detail pane shows, so a hit is
 * always visible in the row it matched. */
function memoryFilter(memories, filter) {
    const f = filter || {};
    const terms = String(f.text || '').toLowerCase().split(/\s+/).filter(Boolean);
    const from = dayBound(f.from, false);
    const to = dayBound(f.to, true);
    const out = [];
    for (const m of memories || []) {
        if (!m || typeof m !== 'object') continue;
        if (!fieldMatches(m.type, f.type)) continue;
        if (!fieldMatches(m.class, f.class)) continue;
        if (!fieldMatches(m.task, f.task)) continue;
        if (!fieldMatches(m.branch, f.branch)) continue;
        const created = Number(m.created) || 0;
        if (from !== null && created < from) continue;
        if (to !== null && created > to) continue;
        if (terms.length) {
            const hay = haystack(m);
            if (!terms.every((t) => hay.indexOf(t) >= 0)) continue;
        }
        out.push(m);
    }
    return out;
}

/* ---------------- the panel ---------------- */

/* The webview cannot require a module, and a filter written twice is a filter
 * that disagrees with itself. The panel gets the real function instead: the
 * source of memoryFilter and its helpers is injected into the nonce'd script
 * tag, so what the test drives under node is what the user types against. No
 * eval, no remote fetch — just this file's own text. */
function filterSource() {
    return [
        `var NONE = ${JSON.stringify(NONE)};`,
        dayBound.toString(),
        fieldMatches.toString(),
        haystack.toString(),
        memoryFilter.toString(),
    ].join('\n');
}

function panelHtml(nonce) {
    const raw = fs.readFileSync(path.join(__dirname, 'memorypanel.html'), 'utf8');
    return raw.replace(/\$\{nonce\}/g, nonce)
        .replace(/\$\{filter\}/g, () => filterSource());
}

function newNonce() {
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function output(r) {
    return `${(r && r.stderr) || ''}\n${(r && r.stdout) || ''}`;
}

/* A cg call that answered with usage or "unknown command" is a build that
 * predates the feature, not a failure of the memory the user clicked. */
function unsupported(r) {
    return /unknown command|unknown subcommand|^usage:|\nusage:/i.test(output(r));
}

/* Jev is mandatory for the commands built on it and never silently degrades,
 * so a missing key is a setup answer, not an error to decode. */
function jevKeyMissing(r) {
    return /OPENROUTER_API_KEY/.test(output(r));
}

function firstLine(r) {
    const line = output(r).split('\n').map((l) => l.trim()).find(Boolean);
    return line || 'cg reported no detail';
}

/* `cg skills list --json` is keyed by the memory each skill came from: its
 * `id` IS the memory id, `path` is null until it is promoted, and `stale`
 * means the rendered file has drifted from the memory. A memory Jev never
 * classed a skill is simply absent. Pure, so the test can drive it against
 * the real payload. */
function skillFor(skills, id) {
    const list = Array.isArray(skills) ? skills
        : (skills && (skills.skills || skills.list)) || [];
    return list.find((s) => s && Number(s.id) === Number(id)) || null;
}

/* What Jev just decided about one memory, in one sentence. `candidate` is
 * the field that matters: it is what `cg skills promote` draws from. */
function classifyNote(data, id) {
    const rows = (data && Array.isArray(data.memories)) ? data.memories : [];
    const m = rows.find((x) => x && Number(x.id) === Number(id)) || rows[0];
    if (!m || !m.class) return `Jev classified #${id}.`;
    const pct = m.confidence === undefined || m.confidence === null
        ? '' : ` (${Math.round(Number(m.confidence) * 100)}% sure)`;
    const candidate = m.candidate
        ? ' — a skill candidate, ready to promote.' : '.';
    return `Jev classified #${id} as ${m.class}${pct}${candidate}`;
}

class MemoryBrowser {
    constructor(deps) {
        this.deps = deps;              /* {cg, cgJson, workspaceRoot, refresh} */
        this.panel = null;
        this.memories = [];
        this.source = 'all';           /* 'all' | 'search' */
        this.query = '';               /* the deep-search query, if any */
        this.loading = false;
        this.loadedAt = 0;
    }

    /* ---- panel lifecycle ---- */

    open() {
        if (this.panel) {
            this.panel.reveal(undefined, false);
            if (!this.loading) this.load();
            return;
        }
        this.panel = vscode.window.createWebviewPanel(
            'codifyMemoryBrowser', 'Codify memories',
            vscode.ViewColumn.Active,
            { enableScripts: true, retainContextWhenHidden: true });
        this.panel.webview.html = panelHtml(newNonce());
        this.panel.webview.onDidReceiveMessage((msg) => {
            /* a bad message must never take the panel down with it */
            Promise.resolve()
                .then(() => this.onMessage(msg))
                .catch((e) => this.post({ type: 'error',
                    text: `The browser hit an error: ${e && e.message ? e.message : e}` }));
        });
        this.panel.onDidDispose(() => { this.panel = null; });
    }

    dispose() {
        if (this.panel) { this.panel.dispose(); this.panel = null; }
    }

    post(msg) {
        if (!this.panel) return;
        try { this.panel.webview.postMessage(msg); } catch { /* disposed */ }
    }

    /* ---- loading ---- */

    /* One load at a time. The scheduler's silent refresh never shows the
     * progress bar and never queues behind an in-flight load: the panel is a
     * reader, and a reader that blinks is a reader nobody trusts. */
    async load(opts = {}) {
        if (!this.panel || this.loading) return;
        this.loading = true;
        if (!opts.silent) this.post({ type: 'loading', on: true });
        try {
            const args = ['recall'];
            if (opts.query) args.push(opts.query);
            args.push('-n', String(MEMORY_LIMIT), '--json');
            const r = await this.deps.cg(args);
            let data = null;
            try { data = JSON.parse(r.stdout); } catch { data = null; }
            if (!data || !Array.isArray(data.memories)) {
                this.post({ type: 'error', text: r.code !== 0
                    ? `cg recall failed: ${firstLine(r)}`
                    : 'cg recall returned no readable JSON.' });
                return;
            }
            this.memories = data.memories;
            this.source = opts.query ? 'search' : 'all';
            this.query = opts.query || '';
            this.loadedAt = Date.now();
            this.post({
                type: 'data',
                memories: this.memories,
                source: this.source,
                query: this.query,
                limit: MEMORY_LIMIT,
                at: this.loadedAt,
            });
        } finally {
            this.loading = false;
            if (!opts.silent) this.post({ type: 'loading', on: false });
        }
    }

    /* Called by the extension's single refresh chain; a no-op when closed. */
    async refresh(opts = {}) {
        if (!this.panel) return;
        if (this.source === 'search') return;   /* keep the user's search set */
        await this.load({ silent: opts.silent !== false });
    }

    /* ---- webview messages ---- */

    async onMessage(msg) {
        if (!msg || typeof msg !== 'object') return;
        const id = msg.id === undefined ? undefined : Number(msg.id);
        switch (msg.type) {
        case 'ready':
            await this.load();
            return;
        case 'reload':
            this.source = 'all';
            await this.load();
            return;
        case 'search':
            await this.load({ query: String(msg.query || '').trim() || undefined });
            return;
        case 'openFile':
            await this.openFile(String(msg.path || ''), msg.line);
            return;
        case 'openSymbol':
            await this.openSymbol(String(msg.name || ''));
            return;
        case 'forget':
            await this.forget(id);
            return;
        case 'supersede':
            await this.supersede(id);
            return;
        case 'classify':
            await this.classify(id);
            return;
        case 'promote':
            await this.promote(id);
            return;
        case 'openSkill':
            await this.openSkill(id);
            return;
        default:
            return;
        }
    }

    memory(id) {
        return this.memories.find((m) => Number(m.id) === Number(id));
    }

    busy(id, on, label) {
        this.post({ type: 'busy', id, on: !!on, label: label || '' });
    }

    notice(text, kind) {
        this.post({ type: 'notice', text, kind: kind || 'info' });
    }

    /* ---- links back into the code ---- */

    async openFile(rel, line) {
        if (!rel) return;
        const root = this.deps.workspaceRoot() || '';
        const abs = path.isAbsolute(rel) ? rel : path.join(root, rel);
        try {
            const doc = await vscode.workspace.openTextDocument(vscode.Uri.file(abs));
            const n = Number(line) > 0 ? Number(line) - 1 : 0;
            await vscode.window.showTextDocument(doc, {
                preview: true,
                selection: new vscode.Range(n, 0, n, 0),
            });
        } catch {
            this.notice(`${rel} is not in this workspace any more.`, 'warn');
        }
    }

    /* A memory's symbols are names, not locations: the graph turns one into
     * the other, which is also the honest answer when the symbol is gone. */
    async openSymbol(name) {
        if (!name) return;
        const r = await this.deps.cg(['symbol', name, '--json']);
        let data = null;
        try { data = JSON.parse(r.stdout); } catch { data = null; }
        const def = data && Array.isArray(data.definitions) ? data.definitions[0] : null;
        if (!def) {
            this.notice(`${name} is not in the graph — the code it names may be gone.`, 'warn');
            return;
        }
        await this.openFile(def.path, def.line);
    }

    /* ---- actions ---- */

    async forget(id) {
        const m = this.memory(id);
        if (!m) { this.missing(id); return; }
        const pick = await vscode.window.showWarningMessage(
            `Forget memory #${id}? This deletes it permanently.`,
            { modal: true, detail: m.body }, 'Forget');
        if (pick !== 'Forget') return;
        this.busy(id, true, 'Forgetting…');
        try {
            const r = await this.deps.cg(['forget', String(id)]);
            if (r.code !== 0) { this.notice(`cg forget failed: ${firstLine(r)}`, 'error'); return; }
            this.notice(`Forgot memory #${id}.`, 'info');
            await this.reloadAfterMutation();
        } finally { this.busy(id, false); }
    }

    /* Supersede is not an edit: the old memory stays as history and a new one
     * replaces it, which is what `cg remember --supersedes` records. The
     * task, symbols and files carry over so the replacement keeps its
     * anchors. */
    async supersede(id) {
        const m = this.memory(id);
        if (!m) { this.missing(id); return; }
        const text = await vscode.window.showInputBox({
            prompt: `New memory that replaces #${id}`,
            value: m.body || '',
            ignoreFocusOut: true,
            validateInput: (v) => (v || '').trim() ? null : 'The replacement cannot be empty',
        });
        if (!text || !text.trim()) return;
        this.busy(id, true, 'Superseding…');
        try {
            const args = ['remember', text.trim(), '--type', m.type || 'decision'];
            if (m.task) args.push('--task', m.task);
            if (m.symbols) args.push('--symbols', m.symbols);
            if (m.files) args.push('--files', m.files);
            args.push('--supersedes', String(id));
            const r = await this.deps.cg(args);
            if (r.code !== 0) {
                this.notice(`cg remember --supersedes failed: ${firstLine(r)}`, 'error');
                return;
            }
            this.notice(`Memory #${id} superseded.`, 'info');
            await this.reloadAfterMutation();
        } finally { this.busy(id, false); }
    }

    async classify(id) {
        if (id === undefined) return;
        this.busy(id, true, 'Asking Jev…');
        try {
            const r = await this.deps.cg(['memory', 'classify', String(id), '--json']);
            if (r.code !== 0) { this.reportMissing(r, 'cg memory classify'); return; }
            let data = null;
            try { data = JSON.parse(r.stdout); } catch { data = null; }
            this.notice(classifyNote(data, id), 'info');
            await this.reloadAfterMutation();
        } finally { this.busy(id, false); }
    }

    /* Every memory Jev has not seen yet, in one call, behind a progress
     * notification because this one talks to the network. */
    async classifyAll() {
        const r = await vscode.window.withProgress(
            { location: vscode.ProgressLocation.Notification,
              title: 'Codify: classifying memories with Jev' },
            () => this.deps.cg(['memory', 'classify', '--unclassified', '--json']));
        if (r.code !== 0) { this.reportMissing(r, 'cg memory classify'); return; }
        let data = null;
        try { data = JSON.parse(r.stdout); } catch { data = null; }
        const n = data && (data.classified !== undefined ? data.classified
            : Array.isArray(data.memories) ? data.memories.length : undefined);
        const candidates = (data && data.candidates) || [];
        vscode.window.showInformationMessage(
            (n === undefined ? 'Memories classified.' : `Classified ${n} memories.`) +
            (candidates.length
                ? ` ${candidates.length} skill candidate${candidates.length === 1 ? '' : 's'}.`
                : ''));
        await this.reloadAfterMutation();
    }

    /* Promotion answers with the path it wrote, so the offer to open it needs
     * no second call — and `written: false` means the file was already
     * current, which is worth saying rather than claiming a fresh render. */
    async promote(id) {
        if (id === undefined) return;
        this.busy(id, true, 'Promoting…');
        try {
            const r = await this.deps.cg(['skills', 'promote', String(id), '--json']);
            if (r.code !== 0) { this.reportMissing(r, 'cg skills promote'); return; }
            let data = null;
            try { data = JSON.parse(r.stdout); } catch { data = null; }
            const file = (data && data.path) || '';
            this.notice(data && data.written === false
                ? `Memory #${id} is already rendered at ${file}.`
                : `Memory #${id} promoted to ${file || '.agents/skills'}.`, 'info');
            await this.reloadAfterMutation();
            const pick = await vscode.window.showInformationMessage(
                `Memory #${id} is a skill at ${file || '.agents/skills'}.`,
                'Open SKILL.md');
            if (pick === 'Open SKILL.md') {
                if (file) await this.openFile(file);
                else await this.openSkill(id);
            }
        } finally { this.busy(id, false); }
    }

    /* The skill a memory became lives on disk; cg owns the slug and the path,
     * so ask it rather than guessing — and say which step is missing when
     * there is no file yet. */
    async openSkill(id) {
        const r = await this.deps.cg(['skills', 'list', '--json']);
        if (r.code !== 0) { this.reportMissing(r, 'cg skills list'); return; }
        let data = null;
        try { data = JSON.parse(r.stdout); } catch { data = null; }
        const skill = skillFor(data, id);
        if (!skill) {
            this.notice(`Memory #${id} is not a skill candidate — classify it ` +
                'with Jev first.', 'warn');
            return;
        }
        if (!skill.path) {
            this.notice(`Memory #${id} is a skill candidate but has not been ` +
                'promoted yet.', 'warn');
            return;
        }
        if (skill.stale) {
            this.notice(`${skill.path} has drifted from memory #${id} — ` +
                '`cg skills render` refreshes it.', 'warn');
        }
        await this.openFile(skill.path);
    }

    /* An action on a memory the working set no longer holds: say so rather
     * than doing nothing, which reads as a broken button. */
    missing(id) {
        this.notice(`Memory #${id} is not in the loaded set any more — reload.`, 'warn');
    }

    reportMissing(r, label) {
        if (unsupported(r)) {
            this.notice(`${label} is not available in this cg build.`, 'warn');
            return;
        }
        if (jevKeyMissing(r)) {
            this.notice(`${label} needs a Jev key: set OPENROUTER_API_KEY and ` +
                'check it with `cg jev doctor`.', 'warn');
            return;
        }
        this.notice(`${label} failed: ${firstLine(r)}`, 'error');
    }

    /* A mutation changes what every other Codify surface shows, so it goes
     * through the extension's one scheduler — and the panel reloads its own
     * working set at once rather than waiting for it. */
    async reloadAfterMutation() {
        const wasSearch = this.source === 'search';
        await this.load(wasSearch ? { query: this.query, silent: true }
            : { silent: true });
        if (this.deps.refresh) this.deps.refresh();
    }

    /* ---- entry points that may arrive without a memory ---- */

    async pickMemory(placeHolder) {
        const r = await this.deps.cg(['recall', '-n', String(MEMORY_LIMIT), '--json']);
        let data = null;
        try { data = JSON.parse(r.stdout); } catch { data = null; }
        const list = (data && data.memories) || [];
        if (!list.length) {
            vscode.window.showInformationMessage('No project memories yet.');
            return undefined;
        }
        const pick = await vscode.window.showQuickPick(list.map((m) => ({
            label: m.body,
            description: `#${m.id} · ${m.type}${m.task ? ` · ${m.task}` : ''}`,
            id: m.id,
        })), { placeHolder, matchOnDescription: true });
        return pick && pick.id;
    }

    idFrom(arg) {
        if (typeof arg === 'number') return arg;
        if (typeof arg === 'string' && /^#?\d+$/.test(arg)) return Number(arg.replace('#', ''));
        if (arg && arg.memoryId !== undefined) return Number(arg.memoryId);
        return undefined;
    }

    async promoteFrom(arg) {
        const id = this.idFrom(arg) ?? await this.pickMemory('Promote which memory to a skill?');
        if (id === undefined) return;
        if (!this.memory(id)) this.open();
        await this.promote(id);
    }

    async supersedeFrom(arg) {
        const id = this.idFrom(arg) ?? await this.pickMemory('Supersede which memory?');
        if (id === undefined) return;
        if (!this.memory(id)) {
            /* the input box needs the old body, so load before asking */
            this.open();
            await this.load({ silent: true });
        }
        await this.supersede(id);
    }
}

/* ---------------- registration ---------------- */

function register(ctx, deps) {
    const browser = new MemoryBrowser(deps);
    ctx.subscriptions.push({ dispose: () => browser.dispose() });
    return {
        open: () => browser.open(),
        refresh: () => browser.refresh({ silent: true }),
        classifyAll: () => browser.classifyAll(),
        promote: (arg) => browser.promoteFrom(arg),
        supersede: (arg) => browser.supersedeFrom(arg),
    };
}

module.exports = {
    MemoryBrowser, memoryFilter, register, panelHtml, filterSource,
    skillFor, classifyNote, unsupported, jevKeyMissing,
    NONE, MEMORY_LIMIT,
};
